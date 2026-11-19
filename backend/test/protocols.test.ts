import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, KEYS, mcpCall, setup, shopToken } from './helpers.js';

let t: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => {
  t = await setup();
});
afterAll(() => t.close());

const stockOf = async (id: string) =>
  (await t.ctx.db.query<{ stock: number }>('SELECT stock FROM products WHERE id = $1', [id]))[0]!.stock;

describe('discovery', () => {
  it('publishes JWKS and a discovery document', async () => {
    const jwks = await t.http.get('/.well-known/jwks.json').expect(200);
    expect(jwks.body.keys[0]).toMatchObject({ kty: 'EC', crv: 'P-256', alg: 'ES256' });
    expect(jwks.body.keys[0].d).toBeUndefined(); // never leak the private key
    const doc = await t.http.get('/.well-known/agentbridge.json').expect(200);
    expect(Object.keys(doc.body.protocols)).toEqual(['acp', 'mcp', 'ap2']);
  });
});

describe('MCP (Streamable HTTP)', () => {
  it('rejects unauthenticated agents', async () => {
    await t.http.post('/mcp').send({ jsonrpc: '2.0', id: 1, method: 'tools/list' }).expect(401);
  });

  it('lists the commerce tools', async () => {
    const res = await t.http
      .post('/mcp')
      .set('Authorization', `Bearer ${KEYS.claude}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
      .expect(200);
    const names = res.body.result.tools.map((x: { name: string }) => x.name);
    expect(names).toEqual(expect.arrayContaining(['search_products', 'quote_cart', 'checkout', 'get_order_status']));
  });

  it('searches with tag exclusion', async () => {
    const { data } = await mcpCall(t.http, 'search_products', { query: 'peanut', exclude_tags: ['contains:peanuts'] });
    expect(data).toEqual([]);
  });

  it('auto-buys repeat items under a mandate and reserves stock', async () => {
    const before = await stockOf('prd_dry_milk_1');
    const { data } = await mcpCall(t.http, 'checkout', {
      items: [{ product_id: 'prd_dry_milk_1', quantity: 2 }],
      mandate_token: t.mandate.token,
    });
    expect(data.status).toBe('paid');
    expect(data.decision.outcome).toBe('approve');
    expect(await stockOf('prd_dry_milk_1')).toBe(before - 2);
  });

  it('returns a clear tool error for out-of-stock carts', async () => {
    const r = await mcpCall(t.http, 'quote_cart', { items: [{ product_id: 'prd_elc_airfryer', quantity: 99 }] });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/out_of_stock/);
  });
});

describe('ACP checkout sessions', () => {
  it('serves a public product feed in minor units', async () => {
    const res = await t.http.get('/acp/feed').expect(200);
    const atta = res.body.products.find((p: { id: string }) => p.id === 'prd_stp_atta_5');
    expect(atta.price).toMatchObject({ amount: 28500, currency: 'inr' });
  });

  it('runs create → complete → user approval → payment', async () => {
    const auth = { Authorization: `Bearer ${KEYS.chatgpt}` };
    const created = await t.http
      .post('/acp/checkout_sessions')
      .set(auth)
      .send({ items: [{ id: 'prd_stp_rice_5', quantity: 1 }] })
      .expect(201);
    expect(created.body.status).toBe('ready_for_payment');
    expect(created.body.totals.find((x: { type: string }) => x.type === 'total').amount).toBe(64900);

    // No mandate: the user must approve.
    const done = await t.http.post(`/acp/checkout_sessions/${created.body.id}/complete`).set(auth).send({}).expect(200);
    expect(done.body.status).toBe('in_progress');
    const orderId = done.body.order.id as string;
    expect(done.body.order.permalink_url).toContain(`/o/${orderId}?t=`);

    // Completing twice is idempotent.
    const again = await t.http.post(`/acp/checkout_sessions/${created.body.id}/complete`).set(auth).send({}).expect(200);
    expect(again.body.order.id).toBe(orderId);

    const tok = shopToken(orderId);
    await t.http.post(`/shop/orders/${orderId}/approve?t=${tok}`).expect(200);
    await t.http.post(`/shop/orders/${orderId}/pay/simulate?t=${tok}`).expect(200);

    const final = await t.http.get(`/acp/checkout_sessions/${created.body.id}`).set(auth).expect(200);
    expect(final.body.status).toBe('completed');
  });

  it('keeps sessions private to the agent that created them', async () => {
    const created = await t.http
      .post('/acp/checkout_sessions')
      .set({ Authorization: `Bearer ${KEYS.chatgpt}` })
      .send({ items: [{ id: 'prd_stp_salt', quantity: 1 }] })
      .expect(201);
    await t.http.get(`/acp/checkout_sessions/${created.body.id}`).set({ Authorization: `Bearer ${KEYS.gemini}` }).expect(404);
  });

  it('validates request bodies', async () => {
    const res = await t.http
      .post('/acp/checkout_sessions')
      .set({ Authorization: `Bearer ${KEYS.chatgpt}` })
      .send({ items: [{ id: 'prd_stp_salt', quantity: 0 }] })
      .expect(400);
    expect(res.body.error.code).toBe('validation_error');
  });
});

describe('AP2 mandates', () => {
  const auth = { Authorization: `Bearer ${KEYS.gemini}` };

  it('verifies a mandate and returns its signed limits', async () => {
    const res = await t.http.post('/ap2/mandates/verify').set(auth).send({ mandate: t.mandate.token }).expect(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.claims.blocked_tags).toContain('contains:peanuts');
  });

  it('issues a cart mandate on approval, and replays idempotently', async () => {
    const body = {
      intent_mandate: t.mandate.token,
      cart: { items: [{ product_id: 'prd_stp_dal_toor', quantity: 1 }] },
      idempotency_key: 'ap2-test-1',
    };
    const first = await t.http.post('/ap2/checkout').set(auth).send(body).expect(201);
    expect(first.body.status).toBe('paid');
    expect(first.body.cart_mandate).toMatch(/^ey/);
    const second = await t.http.post('/ap2/checkout').set(auth).send(body).expect(200);
    expect(second.body.order_id).toBe(first.body.order_id);
  });

  it('rejects tampered and revoked mandates', async () => {
    const tampered = t.mandate.token.slice(0, -4) + 'AAAA';
    const bad = await t.http
      .post('/ap2/checkout')
      .set(auth)
      .send({ intent_mandate: tampered, cart: { items: [{ product_id: 'prd_stp_salt', quantity: 1 }] } })
      .expect(422);
    expect(bad.body.error.code).toBe('invalid_mandate');

    const m = await t.http
      .post('/admin/mandates')
      .set(ADMIN)
      .send({ label: 'temp', subject: 'u2', max_order_paise: 10_000, budget_paise: 20_000 })
      .expect(201);
    await t.http.post(`/admin/mandates/${m.body.id}/revoke`).set(ADMIN).expect(200);
    const revoked = await t.http
      .post('/ap2/checkout')
      .set(auth)
      .send({ intent_mandate: m.body.token, cart: { items: [{ product_id: 'prd_stp_salt', quantity: 1 }] } })
      .expect(422);
    expect(revoked.body.error.message).toMatch(/revoked/);
  });
});

describe('shopper link', () => {
  it('refuses access without the right token', async () => {
    const { data } = await mcpCall(t.http, 'checkout', { items: [{ product_id: 'prd_hh_floor', quantity: 1 }] });
    await t.http.get(`/shop/orders/${data.order_id}?t=wrong`).expect(403);
    await t.http.get(`/shop/orders/${data.order_id}?t=${shopToken(data.order_id)}`).expect(200);
  });
});
