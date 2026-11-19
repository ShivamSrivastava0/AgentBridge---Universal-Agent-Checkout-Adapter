import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import type { Quote } from '../domain/types.js';
import { AppError, notFound } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { formatPaise } from '../lib/money.js';
import { agentRateLimit, parse, requireAgent } from '../http/middleware.js';
import { buildQuote, searchProducts } from '../services/catalog.js';
import { agentOrderView, cancelOrder, getOrderWithItems, placeOrder, type OrderRow } from '../services/orders.js';

/**
 * Agentic Commerce Protocol (ACP) adapter: the checkout-session API used by
 * ChatGPT Instant Checkout. Amounts are integer minor units (paise).
 * Every session completes through the same core `placeOrder` as MCP and AP2.
 */

const AcpItems = z.array(z.object({ id: z.string().min(1), quantity: z.number().int().min(1).max(100) })).min(1).max(50);
const CreateSession = z.object({
  items: AcpItems,
  buyer: z.object({ reference: z.string().max(64).optional() }).passthrough().optional(),
});
const UpdateSession = z.object({ items: AcpItems.optional() });
const CompleteSession = z.object({
  payment_data: z
    .object({
      /** An AgentBridge intent mandate (signed JWT) authorising the agent to spend. */
      token: z.string().optional(),
      provider: z.string().optional(),
    })
    .optional(),
});

interface SessionRow {
  id: string;
  agent_id: string;
  status: string;
  items: { id: string; quantity: number }[];
  buyer: { reference?: string } | null;
  order_id: string | null;
}

export function acpRouter(ctx: AppContext): Router {
  const r = Router();

  // Product feed (public, read-only): what agents index for discovery.
  r.get('/feed', async (_req, res) => {
    const products = await searchProducts(ctx.db, ctx.merchantId, { limit: 200 });
    res.json({
      merchant_id: ctx.merchantId,
      generated_at: new Date().toISOString(),
      products: products.map((p) => ({
        id: p.id,
        title: p.name,
        brand: p.brand,
        description: p.description,
        product_category: p.category,
        price: { amount: p.price_paise, currency: p.currency.toLowerCase(), display: formatPaise(p.price_paise) },
        availability: p.stock > 0 ? 'in_stock' : 'out_of_stock',
        inventory_quantity: p.stock,
        attributes: { unit: p.unit, tags: p.tags },
        enable_checkout: true,
      })),
    });
  });

  r.use('/checkout_sessions', agentRateLimit, requireAgent(ctx));

  r.post('/checkout_sessions', async (req, res) => {
    const body = parse(CreateSession, req.body);
    const quote = await buildQuote(ctx.db, ctx.merchantId, toCart(body.items));
    const id = newId('cs');
    await ctx.db.query(
      `INSERT INTO checkout_sessions (id, agent_id, merchant_id, status, items, buyer)
       VALUES ($1,$2,$3,'ready_for_payment',$4::jsonb,$5::jsonb)`,
      [id, req.agent!.id, ctx.merchantId, JSON.stringify(body.items), JSON.stringify(body.buyer ?? null)],
    );
    res.status(201).json(sessionView(ctx, { id, status: 'ready_for_payment' }, quote, null));
  });

  r.get('/checkout_sessions/:id', async (req, res) => {
    const s = await loadSession(ctx, req.params.id, req.agent!.id);
    res.json(await renderSession(ctx, s));
  });

  r.post('/checkout_sessions/:id', async (req, res) => {
    const s = await loadSession(ctx, req.params.id, req.agent!.id);
    assertOpen(s);
    const body = parse(UpdateSession, req.body);
    if (body.items) {
      await buildQuote(ctx.db, ctx.merchantId, toCart(body.items)); // validates stock & products
      await ctx.db.query(`UPDATE checkout_sessions SET items = $2::jsonb, updated_at = now() WHERE id = $1`, [
        s.id,
        JSON.stringify(body.items),
      ]);
      s.items = body.items;
    }
    res.json(await renderSession(ctx, s));
  });

  r.post('/checkout_sessions/:id/complete', async (req, res) => {
    const s = await loadSession(ctx, req.params.id, req.agent!.id);
    if (s.order_id) return res.json(await renderSession(ctx, s)); // idempotent
    assertOpen(s);
    const body = parse(CompleteSession, req.body ?? {});
    const { order } = await placeOrder(ctx, {
      agent: req.agent!,
      protocol: 'acp',
      items: toCart(s.items),
      mandateToken: body.payment_data?.token,
      idempotencyKey: req.header('idempotency-key') ?? `acp:${s.id}`,
      buyerRef: s.buyer?.reference,
    });
    const status = acpStatus(order);
    await ctx.db.query(`UPDATE checkout_sessions SET status = $2, order_id = $3, updated_at = now() WHERE id = $1`, [
      s.id,
      status,
      order.id,
    ]);
    res.json(await renderSession(ctx, { ...s, status, order_id: order.id }));
  });

  r.post('/checkout_sessions/:id/cancel', async (req, res) => {
    const s = await loadSession(ctx, req.params.id, req.agent!.id);
    if (s.status === 'completed') throw new AppError('invalid_state', 'Completed sessions cannot be cancelled');
    if (s.order_id) {
      const { order } = await getOrderWithItems(ctx.db, s.order_id);
      if (['pending_approval', 'in_review', 'awaiting_payment'].includes(order.status)) {
        await cancelOrder(ctx, order.id, `agent:${req.agent!.id}`);
      }
    }
    await ctx.db.query(`UPDATE checkout_sessions SET status = 'canceled', updated_at = now() WHERE id = $1`, [s.id]);
    res.json(await renderSession(ctx, { ...s, status: 'canceled' }));
  });

  return r;
}

function toCart(items: { id: string; quantity: number }[]) {
  return items.map((i) => ({ product_id: i.id, quantity: i.quantity }));
}

async function loadSession(ctx: AppContext, id: string, agentId: string): Promise<SessionRow> {
  const [s] = await ctx.db.query<SessionRow>(`SELECT * FROM checkout_sessions WHERE id = $1 AND agent_id = $2`, [id, agentId]);
  if (!s) throw notFound('Checkout session');
  return s;
}

function assertOpen(s: SessionRow) {
  if (s.status !== 'ready_for_payment') throw new AppError('invalid_state', `Checkout session is ${s.status}`);
}

/** Map AgentBridge order status onto ACP session status. */
function acpStatus(order: OrderRow): string {
  switch (order.status) {
    case 'paid':
      return 'completed';
    case 'blocked':
    case 'rejected':
    case 'expired':
    case 'cancelled':
      return 'canceled';
    default:
      return 'in_progress';
  }
}

async function renderSession(ctx: AppContext, s: SessionRow) {
  if (s.order_id) {
    const { order, items } = await getOrderWithItems(ctx.db, s.order_id);
    const quote: Quote = {
      merchant_id: order.merchant_id,
      currency: order.currency,
      lines: items,
      subtotal_paise: order.subtotal_paise,
      total_paise: order.total_paise,
      cart_hash: order.cart_hash,
    };
    return sessionView(ctx, { id: s.id, status: acpStatus(order) }, quote, order, items);
  }
  const quote = await buildQuote(ctx.db, ctx.merchantId, toCart(s.items)).catch(() => null);
  if (!quote) return { id: s.id, status: s.status, messages: [{ type: 'error', content_type: 'plain', content: 'Cart is no longer available' }] };
  return sessionView(ctx, { id: s.id, status: s.status }, quote, null);
}

function sessionView(
  ctx: AppContext,
  s: { id: string; status: string },
  quote: Quote,
  order: OrderRow | null,
  items?: Awaited<ReturnType<typeof getOrderWithItems>>['items'],
) {
  const agentView = order && items ? agentOrderView(ctx, order, items) : null;
  return {
    id: s.id,
    status: s.status,
    currency: quote.currency.toLowerCase(),
    payment_provider: { provider: ctx.payments.mode === 'razorpay' ? 'razorpay' : 'agentbridge_simulated', supported_payment_methods: ['card', 'upi'] },
    line_items: quote.lines.map((l) => ({
      id: `li_${l.line_no}`,
      item: { id: l.product_id, quantity: l.quantity },
      title: l.name,
      base_amount: l.line_total_paise,
      discount: 0,
      subtotal: l.line_total_paise,
      tax: 0,
      total: l.line_total_paise,
    })),
    totals: [
      { type: 'items_base_amount', display_text: 'Items', amount: quote.subtotal_paise },
      { type: 'subtotal', display_text: 'Subtotal', amount: quote.subtotal_paise },
      { type: 'tax', display_text: 'Tax', amount: 0 },
      { type: 'total', display_text: 'Total', amount: quote.total_paise },
    ],
    messages: agentView
      ? [{ type: agentView.status === 'blocked' ? 'error' : 'info', content_type: 'plain', content: `${agentView.decision.summary} ${agentView.next_action}` }]
      : [],
    links: [{ type: 'terms_of_use', url: ctx.publicAppUrl }],
    ...(agentView
      ? {
          order: {
            id: agentView.order_id,
            checkout_session_id: s.id,
            status: agentView.status,
            permalink_url: agentView.approval_url ?? null,
            decision: agentView.decision,
          },
        }
      : {}),
  };
}
