import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { ORDER_STATUSES, PROTOCOLS } from '../domain/types.js';
import { notFound } from '../lib/errors.js';
import { listAgents } from '../services/agents.js';
import { searchProducts } from '../services/catalog.js';
import { CreateMandateInput, createMandate, listMandates, revokeMandate } from '../services/mandates.js';
import { getOrderEvents, getOrderWithItems, orderLink, reviewOrder } from '../services/orders.js';
import { getStats } from '../services/stats.js';
import { inspectToken } from '../trust/mandates.js';
import { parse, requireAdmin } from './middleware.js';

const ListOrders = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  protocol: z.enum(PROTOCOLS).optional(),
  q: z.string().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const Review = z.object({ decision: z.enum(['approve', 'reject']), note: z.string().max(500).optional() });

const UpdateProduct = z
  .object({
    price_paise: z.number().int().min(0).max(100_000_000).optional(),
    stock: z.number().int().min(0).max(1_000_000).optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

/** Merchant console API. Called server-to-server by the dashboard with ADMIN_API_KEY. */
export function adminRouter(ctx: AppContext): Router {
  const r = Router();
  r.use(requireAdmin);

  r.get('/config', (_req, res) => {
    res.json({
      merchant_id: ctx.merchantId,
      payments_mode: ctx.payments.mode,
      razorpay_key_id: ctx.payments.publicKeyId,
      risk: ctx.risk,
    });
  });

  r.get('/stats', async (_req, res) => {
    res.json(await getStats(ctx));
  });

  r.get('/orders', async (req, res) => {
    const f = parse(ListOrders, req.query);
    const where = ['o.merchant_id = $1'];
    const params: unknown[] = [ctx.merchantId];
    if (f.status) where.push(`o.status = $${params.push(f.status)}`);
    if (f.protocol) where.push(`o.protocol = $${params.push(f.protocol)}`);
    if (f.q) where.push(`(o.id ILIKE $${params.push(`%${f.q}%`)} OR a.name ILIKE $${params.length})`);
    const orders = await ctx.db.query(
      `SELECT o.id, o.protocol, o.status, o.total_paise, o.currency, o.risk_score, o.created_at, o.buyer_ref,
         o.decision->>'outcome' AS outcome, o.decision->>'summary' AS summary,
         a.id AS agent_id, a.name AS agent_name, a.platform AS agent_platform,
         m.label AS mandate_label,
         (SELECT count(*)::int FROM order_items i WHERE i.order_id = o.id) AS item_count
       FROM orders o JOIN agents a ON a.id = o.agent_id LEFT JOIN mandates m ON m.id = o.intent_mandate_id
       WHERE ${where.join(' AND ')}
       ORDER BY o.created_at DESC LIMIT ${f.limit}`,
      params,
    );
    res.json({ orders });
  });

  r.get('/orders/:id', async (req, res) => {
    const { order, items } = await getOrderWithItems(ctx.db, req.params.id);
    const events = await getOrderEvents(ctx.db, order.id);
    const [agent] = await ctx.db.query('SELECT id, name, platform, protocol FROM agents WHERE id = $1', [order.agent_id]);
    const [mandate] = order.intent_mandate_id
      ? await ctx.db.query('SELECT id, label, subject, max_order_paise, budget_paise FROM mandates WHERE id = $1', [order.intent_mandate_id])
      : [];
    res.json({
      order: { ...order, cart_mandate: undefined },
      cart_mandate: order.cart_mandate ? { token: order.cart_mandate, decoded: inspectToken(order.cart_mandate) } : null,
      items,
      events,
      agent,
      mandate: mandate ?? null,
      shopper_link: orderLink(ctx, order.id),
    });
  });

  r.post('/orders/:id/review', async (req, res) => {
    const body = parse(Review, req.body);
    await reviewOrder(ctx, req.params.id, body.decision, body.note);
    const { order } = await getOrderWithItems(ctx.db, req.params.id);
    res.json({ id: order.id, status: order.status });
  });

  r.get('/products', async (req, res) => {
    const f = parse(z.object({ q: z.string().max(80).optional(), category: z.string().max(40).optional() }), req.query);
    res.json({ products: await searchProducts(ctx.db, ctx.merchantId, { query: f.q, category: f.category, includeInactive: true, limit: 200 }) });
  });

  r.patch('/products/:id', async (req, res) => {
    const body = parse(UpdateProduct, req.body);
    const sets: string[] = [];
    const params: unknown[] = [req.params.id, ctx.merchantId];
    for (const [k, v] of Object.entries(body)) if (v !== undefined) sets.push(`${k} = $${params.push(v)}`);
    const [p] = await ctx.db.query(
      `UPDATE products SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 AND merchant_id = $2 RETURNING *`,
      params,
    );
    if (!p) throw notFound('Product');
    ctx.events.publish({ type: 'product.updated', data: { product_id: req.params.id } });
    res.json(p);
  });

  r.get('/mandates', async (_req, res) => {
    res.json({ mandates: await listMandates(ctx) });
  });

  r.post('/mandates', async (req, res) => {
    const body = parse(CreateMandateInput, req.body);
    const mandate = await createMandate(ctx, body);
    ctx.events.publish({ type: 'mandate.created', data: { mandate_id: mandate.id } });
    res.status(201).json(mandate);
  });

  r.post('/mandates/:id/revoke', async (req, res) => {
    res.json(await revokeMandate(ctx, req.params.id));
  });

  r.get('/agents', async (_req, res) => {
    res.json({ agents: await listAgents(ctx.db) });
  });

  /** Live event stream (Server-Sent Events) for the console. */
  r.get('/events', (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write(`event: ready\ndata: {}\n\n`);
    const unsubscribe = ctx.events.subscribe((e) => res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
    const heartbeat = setInterval(() => res.write(`: ping\n\n`), 20_000);
    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  return r;
}
