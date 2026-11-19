import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { PaymentProvider } from '../src/payments/provider.js';
import { expireStaleOrders, placeOrder, settleOrder } from '../src/services/orders.js';
import { ADMIN, mcpCall, setup } from './helpers.js';

let t: Awaited<ReturnType<typeof setup>> | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const claude = { id: 'agt_claude', name: 'Claude', platform: 'Anthropic', protocol: 'mcp' as const, status: 'active' as const };
const stockOf = async (id: string) =>
  (await t!.ctx.db.query<{ stock: number }>('SELECT stock FROM products WHERE id = $1', [id]))[0]!.stock;

describe('settlement guards', () => {
  it('refuses to settle a cart that changed after authorisation', async () => {
    t = await setup({ payments: fakeGateway() });
    const { order } = await placeOrder(t.ctx, {
      agent: claude,
      protocol: 'mcp',
      items: [{ product_id: 'prd_dry_milk_1', quantity: 1 }],
      mandateToken: t.mandate.token,
    });
    expect(order.status).toBe('awaiting_payment'); // gateway cannot auto-capture
    await t.ctx.db.query('UPDATE order_items SET quantity = 10 WHERE order_id = $1', [order.id]);
    await expect(settleOrder(t.ctx, order.id, { provider: 'x', paymentId: 'p1' }, 'test')).rejects.toThrow(/hash mismatch/);
  });

  it('blocks replay of a used cart mandate', async () => {
    t = await setup();
    const { data } = await mcpCall(t.http, 'checkout', { items: [{ product_id: 'prd_dry_milk_1', quantity: 1 }], mandate_token: t.mandate.token });
    expect(data.status).toBe('paid');
    // Force the order back to awaiting_payment and try to capture again with the same mandate.
    await t.ctx.db.query(`UPDATE orders SET status = 'awaiting_payment' WHERE id = $1`, [data.order_id]);
    await expect(settleOrder(t.ctx, data.order_id, { provider: 'x', paymentId: 'p2' }, 'test')).rejects.toThrow(/replay blocked/);
  });
});

describe('risk review', () => {
  it('holds high-velocity agents for merchant review; approval completes the order', async () => {
    t = await setup();
    t.ctx.risk.velocityMaxOrders = 2;
    const buy = () => mcpCall(t!.http, 'checkout', { items: [{ product_id: 'prd_dry_milk_1', quantity: 1 }], mandate_token: t!.mandate.token });
    await buy();
    await buy();
    const { data } = await buy();
    expect(data.status).toBe('in_review');

    const review = await t.http.post(`/admin/orders/${data.order_id}/review`).set(ADMIN).send({ decision: 'approve' }).expect(200);
    expect(review.body.status).toBe('paid');
  });

  it('releases reserved stock when the merchant rejects', async () => {
    t = await setup();
    const before = await stockOf('prd_elc_airfryer');
    const { data } = await mcpCall(t.http, 'checkout', { items: [{ product_id: 'prd_elc_airfryer', quantity: 1 }] });
    expect(data.status).toBe('in_review'); // ₹7,499 > ₹5,000 high-value threshold
    expect(await stockOf('prd_elc_airfryer')).toBe(before - 1);
    await t.http.post(`/admin/orders/${data.order_id}/review`).set(ADMIN).send({ decision: 'reject' }).expect(200);
    expect(await stockOf('prd_elc_airfryer')).toBe(before);
  });
});

describe('mandate budget', () => {
  it('cannot be overspent by concurrent orders', async () => {
    t = await setup();
    const m = await t.http
      .post('/admin/mandates')
      .set(ADMIN)
      .send({ label: 'tight', subject: 'household_demo', max_order_paise: 50_000, budget_paise: 50_000, category_rules: { staples: 'auto' } })
      .expect(201);
    const order = () =>
      placeOrder(t!.ctx, { agent: claude, protocol: 'mcp', items: [{ product_id: 'prd_stp_atta_5', quantity: 1 }], mandateToken: m.body.token });
    const results = await Promise.all([order(), order()]); // ₹285 each against a ₹500 budget
    const statuses = results.map((r) => r.order.status).sort();
    expect(statuses).toEqual(['blocked', 'paid']);
  });
});

describe('expiry', () => {
  it('expires stale approvals and returns stock', async () => {
    t = await setup();
    const before = await stockOf('prd_bby_wipes');
    const { data } = await mcpCall(t.http, 'checkout', { items: [{ product_id: 'prd_bby_wipes', quantity: 2 }] });
    expect(data.status).toBe('pending_approval');
    await t.ctx.db.query(`UPDATE orders SET approval_expires_at = now() - interval '1 minute' WHERE id = $1`, [data.order_id]);
    expect(await expireStaleOrders(t.ctx)).toBe(1);
    expect(await stockOf('prd_bby_wipes')).toBe(before);
  });
});

describe('razorpay webhook', () => {
  it('verifies the signature, settles once, and ignores duplicates', async () => {
    t = await setup({ payments: fakeGateway() });
    const { data } = await mcpCall(t.http, 'checkout', { items: [{ product_id: 'prd_dry_milk_1', quantity: 1 }], mandate_token: t.mandate.token });
    expect(data.status).toBe('awaiting_payment');
    const [o] = await t.ctx.db.query<{ payment_ref: string }>('SELECT payment_ref FROM orders WHERE id = $1', [data.order_id]);
    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1', order_id: o!.payment_ref, status: 'captured' } } } });
    const sig = createHmac('sha256', 'whsec').update(body).digest('hex');
    const send = (signature: string) =>
      t!.http.post('/webhooks/razorpay').set('Content-Type', 'application/json').set('x-razorpay-signature', signature).set('x-razorpay-event-id', 'evt_1').send(body);

    await send('bad').expect(401);
    expect((await send(sig).expect(200)).body.status).toBe('ok');
    expect((await send(sig).expect(200)).body.status).toBe('duplicate');
    const [paid] = await t.ctx.db.query<{ status: string }>('SELECT status FROM orders WHERE id = $1', [data.order_id]);
    expect(paid!.status).toBe('paid');
  });
});

/** A gateway that behaves like Razorpay (no auto-capture, HMAC webhooks) without the network. */
function fakeGateway(): PaymentProvider {
  let n = 0;
  return {
    mode: 'razorpay',
    publicKeyId: 'rzp_test_fake',
    canAutoCapture: false,
    createPayment: async () => ({ ref: `order_fake_${++n}_${Date.now()}` }),
    verifyCheckoutSignature: () => false,
    verifyWebhookSignature: (raw, sig) => createHmac('sha256', 'whsec').update(raw).digest('hex') === sig,
  };
}
