import { createHmac } from 'node:crypto';
import { env } from '../config/env.js';
import type { AppContext } from '../context.js';
import type { Queryable } from '../db/client.js';
import type {
  Agent,
  CartItemInput,
  IntentMandateClaims,
  OrderStatus,
  PolicyDecision,
  Protocol,
  QuoteLine,
} from '../domain/types.js';
import { AppError, notFound } from '../lib/errors.js';
import { newId, safeEqual, sha256Hex } from '../lib/ids.js';
import { logger } from '../lib/logger.js';
import { evaluatePolicy } from '../trust/policy.js';
import { signCartMandate, verifyCartMandate, verifyIntentMandate, type CartMandateInput } from '../trust/mandates.js';
import { buildQuote, cartHash } from './catalog.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface OrderRow {
  id: string;
  merchant_id: string;
  agent_id: string;
  protocol: Protocol;
  status: OrderStatus;
  subtotal_paise: number;
  total_paise: number;
  currency: string;
  cart_hash: string;
  buyer_ref: string | null;
  intent_mandate_id: string | null;
  cart_mandate: string | null;
  cart_mandate_jti: string | null;
  requires_user_approval: boolean;
  risk_score: number;
  decision: PolicyDecision;
  idempotency_key: string | null;
  payment_provider: string | null;
  payment_ref: string | null;
  payment_id: string | null;
  approval_expires_at: Date | null;
  paid_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface OrderItemRow extends QuoteLine {
  order_id: string;
}

export interface OrderEventRow {
  id: number;
  order_id: string;
  type: string;
  actor: string;
  data: Record<string, unknown>;
  created_at: Date;
}

/** Statuses that hold stock and count against a mandate's budget. */
const ACTIVE_STATUSES: OrderStatus[] = ['pending_approval', 'in_review', 'awaiting_payment', 'paid'];
const RELEASABLE_STATUSES: OrderStatus[] = ['pending_approval', 'in_review', 'awaiting_payment'];

// ─── Shopper access tokens ─────────────────────────────────────────────────

/** Capability token for the shopper's approval/payment page. Derived, never stored in plain text. */
export function orderAccessToken(orderId: string): string {
  return createHmac('sha256', env.APP_SECRET).update(`order-access:${orderId}`).digest('base64url').slice(0, 32);
}

export function checkOrderAccess(orderId: string, token: string | undefined): void {
  if (!token || !safeEqual(orderAccessToken(orderId), token)) {
    throw new AppError('forbidden', 'Invalid or missing order access token');
  }
}

export function orderLink(ctx: AppContext, orderId: string): string {
  return `${ctx.publicAppUrl}/o/${orderId}?t=${orderAccessToken(orderId)}`;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

async function recordEvent(q: Queryable, orderId: string, type: string, actor: string, data: Record<string, unknown> = {}) {
  await q.query('INSERT INTO order_events (order_id, type, actor, data) VALUES ($1, $2, $3, $4::jsonb)', [
    orderId,
    type,
    actor,
    JSON.stringify(data),
  ]);
}

async function lockOrder(q: Queryable, orderId: string): Promise<OrderRow> {
  const [row] = await q.query<OrderRow>('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
  if (!row) throw notFound('Order');
  return row;
}

async function setStatus(q: Queryable, orderId: string, status: OrderStatus, extra: Record<string, unknown> = {}) {
  const cols = Object.keys(extra);
  const sets = ['status = $2', 'updated_at = now()', ...cols.map((c, i) => `${c} = $${i + 3}`)];
  await q.query(`UPDATE orders SET ${sets.join(', ')} WHERE id = $1`, [orderId, status, ...Object.values(extra)]);
}

async function releaseStock(q: Queryable, orderId: string) {
  await q.query(
    `UPDATE products p SET stock = p.stock + i.quantity, updated_at = now()
     FROM order_items i WHERE i.order_id = $1 AND p.id = i.product_id`,
    [orderId],
  );
}

function assertStatus(order: OrderRow, allowed: OrderStatus[], action: string) {
  if (!allowed.includes(order.status)) {
    throw new AppError('invalid_state', `Cannot ${action} an order that is ${order.status}`);
  }
}

// ─── Checkout ──────────────────────────────────────────────────────────────

export interface PlaceOrderInput {
  agent: Agent;
  protocol: Protocol;
  items: CartItemInput[];
  mandateToken?: string | undefined;
  idempotencyKey?: string | undefined;
  buyerRef?: string | undefined;
}

export interface PlaceOrderResult {
  order: OrderRow;
  items: OrderItemRow[];
  replayed: boolean;
}

/**
 * The single checkout path every protocol adapter (ACP, MCP, AP2) converges on:
 * price the cart → verify mandate → evaluate policy → reserve stock → record.
 * Then, if approved, authorise the exact cart and (where possible) capture.
 */
export async function placeOrder(ctx: AppContext, input: PlaceOrderInput): Promise<PlaceOrderResult> {
  if (input.idempotencyKey) {
    const existing = await findByIdempotencyKey(ctx.db, input.agent.id, input.idempotencyKey);
    if (existing) return { ...(await getOrderWithItems(ctx.db, existing.id)), replayed: true };
  }

  // Signature/expiry/audience are verified before touching the database.
  const claims: IntentMandateClaims | null = input.mandateToken
    ? await verifyIntentMandate(input.mandateToken, ctx.merchantId)
    : null;

  const orderId = newId('ord');
  let decision: PolicyDecision;
  try {
    decision = await ctx.db.tx(async (q) => {
      if (claims) {
        // Lock the mandate row so concurrent orders cannot both spend the same budget.
        const [m] = await q.query<{ revoked_at: Date | null; merchant_id: string }>(
          'SELECT revoked_at, merchant_id FROM mandates WHERE id = $1 FOR UPDATE',
          [claims.mandate_id],
        );
        if (!m) throw new AppError('invalid_mandate', 'Mandate is not registered with this merchant');
        if (m.revoked_at) throw new AppError('invalid_mandate', 'Mandate has been revoked by the user');
      }

      const quote = await buildQuote(q, ctx.merchantId, input.items, { lock: true });

      const [spent] = claims
        ? await q.query<{ total: number }>(
            `SELECT coalesce(sum(total_paise), 0)::int AS total FROM orders
             WHERE intent_mandate_id = $1 AND status = ANY($2::text[])`,
            [claims.mandate_id, ACTIVE_STATUSES],
          )
        : [{ total: 0 }];

      const buyer = claims?.subject ?? input.buyerRef ?? null;
      const previous = buyer
        ? await q.query<{ product_id: string }>(
            `SELECT DISTINCT i.product_id FROM order_items i JOIN orders o ON o.id = i.order_id
             WHERE o.buyer_ref = $1 AND o.status = 'paid'`,
            [buyer],
          )
        : [];

      const [recent] = await q.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM orders
         WHERE agent_id = $1 AND created_at > now() - make_interval(secs => $2)`,
        [input.agent.id, ctx.risk.velocityWindowSeconds],
      );

      const d = evaluatePolicy({
        quote,
        agentId: input.agent.id,
        mandate: claims,
        mandateSpentPaise: spent?.total ?? 0,
        previouslyPurchased: new Set(previous.map((r) => r.product_id)),
        recentAgentOrders: recent?.n ?? 0,
        risk: ctx.risk,
      });

      const status: OrderStatus =
        d.outcome === 'block'
          ? 'blocked'
          : d.outcome === 'review'
            ? 'in_review'
            : d.outcome === 'needs_approval'
              ? 'pending_approval'
              : 'awaiting_payment';

      // Reserve stock atomically. Blocked orders reserve nothing.
      if (status !== 'blocked') {
        for (const line of quote.lines) {
          const updated = await q.query(
            `UPDATE products SET stock = stock - $1, updated_at = now() WHERE id = $2 AND stock >= $1 RETURNING id`,
            [line.quantity, line.product_id],
          );
          if (updated.length === 0) throw new AppError('out_of_stock', `"${line.name}" just went out of stock`);
        }
      }

      await q.query(
        `INSERT INTO orders (id, merchant_id, agent_id, protocol, status, subtotal_paise, total_paise, currency,
           cart_hash, buyer_ref, intent_mandate_id, requires_user_approval, risk_score, decision,
           idempotency_key, access_token_hash, approval_expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,
           CASE WHEN $5 IN ('pending_approval','in_review') THEN now() + make_interval(mins => $17) END)`,
        [
          orderId,
          ctx.merchantId,
          input.agent.id,
          input.protocol,
          status,
          quote.subtotal_paise,
          quote.total_paise,
          quote.currency,
          quote.cart_hash,
          buyer,
          claims?.mandate_id ?? null,
          d.requires_user_approval,
          d.risk_score,
          JSON.stringify(d),
          input.idempotencyKey ?? null,
          sha256Hex(orderAccessToken(orderId)),
          ctx.approvalTtlMinutes,
        ],
      );
      for (const l of quote.lines) {
        await q.query(
          `INSERT INTO order_items (order_id, line_no, product_id, sku, name, category, tags, unit_price_paise, quantity, line_total_paise)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [orderId, l.line_no, l.product_id, l.sku, l.name, l.category, l.tags, l.unit_price_paise, l.quantity, l.line_total_paise],
        );
      }
      await recordEvent(q, orderId, 'order.created', `agent:${input.agent.id}`, {
        protocol: input.protocol,
        total_paise: quote.total_paise,
        mandate_id: claims?.mandate_id ?? null,
      });
      await recordEvent(q, orderId, 'policy.evaluated', 'system:policy', {
        outcome: d.outcome,
        risk_score: d.risk_score,
        summary: d.summary,
      });
      return d;
    });
  } catch (err) {
    // Lost an idempotency race: return the order the other request created.
    if (input.idempotencyKey && isUniqueViolation(err)) {
      const existing = await findByIdempotencyKey(ctx.db, input.agent.id, input.idempotencyKey);
      if (existing) return { ...(await getOrderWithItems(ctx.db, existing.id)), replayed: true };
    }
    throw err;
  }

  ctx.events.publish({ type: 'order.created', order_id: orderId, protocol: input.protocol, status: decision.outcome });
  logger.info({ orderId, outcome: decision.outcome, agent: input.agent.id }, 'checkout: order placed');

  if (decision.outcome === 'approve') {
    await authorizeOrder(ctx, orderId, { type: 'intent_mandate', mandateId: claims!.mandate_id }, 'system:policy');
    if (ctx.payments.canAutoCapture) {
      await settleOrder(ctx, orderId, { provider: ctx.payments.mode, paymentId: newId('sim_pay') }, 'system:auto_capture');
    }
  }

  return { ...(await getOrderWithItems(ctx.db, orderId)), replayed: false };
}

/**
 * Sign a single-use cart mandate bound to this exact cart and open a payment.
 * Moves the order to awaiting_payment.
 */
async function authorizeOrder(
  ctx: AppContext,
  orderId: string,
  authorizedBy: CartMandateInput['authorizedBy'],
  actor: string,
): Promise<void> {
  await ctx.db.tx(async (q) => {
    const order = await lockOrder(q, orderId);
    assertStatus(order, ['awaiting_payment', 'pending_approval', 'in_review'], 'authorise');
    if (order.cart_mandate) return;
    const { token, jti } = await signCartMandate({
      orderId,
      merchantId: order.merchant_id,
      subject: order.buyer_ref ?? `agent:${order.agent_id}`,
      cartHash: order.cart_hash,
      totalPaise: order.total_paise,
      currency: order.currency,
      authorizedBy,
    });
    const payment = await ctx.payments.createPayment({ id: orderId, total_paise: order.total_paise, currency: order.currency });
    await setStatus(q, orderId, 'awaiting_payment', {
      cart_mandate: token,
      cart_mandate_jti: jti,
      payment_provider: ctx.payments.mode,
      payment_ref: payment.ref,
      approval_expires_at: null,
    });
    await recordEvent(q, orderId, 'cart_mandate.issued', actor, { jti, authorized_by: authorizedBy, payment_ref: payment.ref });
  });
  ctx.events.publish({ type: 'order.updated', order_id: orderId, status: 'awaiting_payment' });
}

// ─── Human decisions ───────────────────────────────────────────────────────

/** Shopper approves an order the agent could not place on its own. */
export async function approveByUser(ctx: AppContext, orderId: string): Promise<void> {
  const [order] = await ctx.db.query<OrderRow>('SELECT * FROM orders WHERE id = $1', [orderId]);
  if (!order) throw notFound('Order');
  assertStatus(order, ['pending_approval'], 'approve');
  await ctx.db.query(`UPDATE orders SET requires_user_approval = false WHERE id = $1`, [orderId]);
  await ctx.db.query(`INSERT INTO order_events (order_id, type, actor) VALUES ($1, 'order.approved_by_user', 'user')`, [orderId]);
  await authorizeOrder(ctx, orderId, { type: 'user' }, 'user');
}

export async function declineByUser(ctx: AppContext, orderId: string): Promise<void> {
  await terminate(ctx, orderId, 'rejected', ['pending_approval', 'awaiting_payment'], 'user', 'order.declined_by_user');
}

/** Merchant resolves an order held by fraud/risk rules. */
export async function reviewOrder(
  ctx: AppContext,
  orderId: string,
  decision: 'approve' | 'reject',
  note: string | undefined,
): Promise<void> {
  if (decision === 'reject') {
    await terminate(ctx, orderId, 'rejected', ['in_review'], 'merchant', 'review.rejected', { note });
    return;
  }
  const [order] = await ctx.db.query<OrderRow>('SELECT * FROM orders WHERE id = $1', [orderId]);
  if (!order) throw notFound('Order');
  assertStatus(order, ['in_review'], 'review');
  await ctx.db.query(`INSERT INTO order_events (order_id, type, actor, data) VALUES ($1, 'review.approved', 'merchant', $2::jsonb)`, [
    orderId,
    JSON.stringify({ note: note ?? null }),
  ]);

  if (order.requires_user_approval) {
    // The merchant cleared the risk flag, but the user still has to say yes.
    await ctx.db.query(
      `UPDATE orders SET status = 'pending_approval', approval_expires_at = now() + make_interval(mins => $2), updated_at = now() WHERE id = $1`,
      [orderId, ctx.approvalTtlMinutes],
    );
    ctx.events.publish({ type: 'order.updated', order_id: orderId, status: 'pending_approval' });
    return;
  }
  // Mandate covered everything except the risk flag: proceed as an auto-approved order.
  await authorizeOrder(
    ctx,
    orderId,
    order.intent_mandate_id ? { type: 'intent_mandate', mandateId: order.intent_mandate_id } : { type: 'merchant_review' },
    'merchant',
  );
  if (ctx.payments.canAutoCapture && order.intent_mandate_id) {
    await settleOrder(ctx, orderId, { provider: ctx.payments.mode, paymentId: newId('sim_pay') }, 'system:auto_capture');
  }
}

export async function cancelOrder(ctx: AppContext, orderId: string, actor: string): Promise<void> {
  await terminate(ctx, orderId, 'cancelled', RELEASABLE_STATUSES, actor, 'order.cancelled');
}

async function terminate(
  ctx: AppContext,
  orderId: string,
  to: OrderStatus,
  from: OrderStatus[],
  actor: string,
  eventType: string,
  data: Record<string, unknown> = {},
) {
  await ctx.db.tx(async (q) => {
    const order = await lockOrder(q, orderId);
    assertStatus(order, from, to === 'cancelled' ? 'cancel' : 'reject');
    await releaseStock(q, orderId);
    await setStatus(q, orderId, to, { approval_expires_at: null });
    await recordEvent(q, orderId, eventType, actor, data);
  });
  ctx.events.publish({ type: 'order.updated', order_id: orderId, status: to });
}

/** Expire approvals nobody acted on and release their stock. Run periodically. */
export async function expireStaleOrders(ctx: AppContext): Promise<number> {
  const stale = await ctx.db.query<{ id: string }>(
    `SELECT id FROM orders WHERE status IN ('pending_approval', 'in_review') AND approval_expires_at < now()`,
  );
  for (const { id } of stale) {
    try {
      await terminate(ctx, id, 'expired', ['pending_approval', 'in_review'], 'system:expiry', 'order.expired');
    } catch (err) {
      logger.warn({ err, orderId: id }, 'expiry: skipped');
    }
  }
  return stale.length;
}

// ─── Settlement ────────────────────────────────────────────────────────────

/**
 * Marks an order paid. Refuses unless a valid, unused cart mandate matches the
 * cart exactly as stored. This is the last line of defence against a tampered
 * or replayed checkout.
 */
export async function settleOrder(
  ctx: AppContext,
  orderId: string,
  payment: { provider: string; paymentId: string },
  actor: string,
): Promise<OrderRow> {
  const settled = await ctx.db.tx(async (q) => {
    const order = await lockOrder(q, orderId);
    if (order.status === 'paid') {
      if (order.payment_id === payment.paymentId) return order; // idempotent webhook/callback
      throw new AppError('conflict', 'Order is already paid');
    }
    assertStatus(order, ['awaiting_payment'], 'settle');
    if (!order.cart_mandate) throw new AppError('invalid_mandate', 'Order has no cart mandate');

    const items = await q.query<OrderItemRow>('SELECT * FROM order_items WHERE order_id = $1 ORDER BY line_no', [orderId]);
    const recomputed = cartHash(order.merchant_id, order.currency, items, order.total_paise);
    const { jti } = await verifyCartMandate(order.cart_mandate, {
      merchantId: order.merchant_id,
      orderId,
      cartHash: recomputed,
      totalPaise: order.total_paise,
    });
    const used = await q.query('INSERT INTO used_cart_mandates (jti, order_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING jti', [
      jti,
      orderId,
    ]);
    if (used.length === 0) throw new AppError('invalid_mandate', 'Cart mandate has already been used (replay blocked)');

    await setStatus(q, orderId, 'paid', { payment_id: payment.paymentId, paid_at: new Date() });
    await recordEvent(q, orderId, 'payment.captured', actor, { provider: payment.provider, payment_id: payment.paymentId, jti });
    return { ...order, status: 'paid' as const };
  });
  ctx.events.publish({ type: 'order.updated', order_id: orderId, status: 'paid' });
  return settled;
}

// ─── Reads ─────────────────────────────────────────────────────────────────

async function findByIdempotencyKey(q: Queryable, agentId: string, key: string) {
  const [row] = await q.query<{ id: string }>('SELECT id FROM orders WHERE agent_id = $1 AND idempotency_key = $2', [agentId, key]);
  return row ?? null;
}

export async function getOrderWithItems(q: Queryable, orderId: string): Promise<{ order: OrderRow; items: OrderItemRow[] }> {
  const [order] = await q.query<OrderRow>('SELECT * FROM orders WHERE id = $1', [orderId]);
  if (!order) throw notFound('Order');
  const items = await q.query<OrderItemRow>('SELECT * FROM order_items WHERE order_id = $1 ORDER BY line_no', [orderId]);
  return { order, items };
}

export async function getOrderEvents(q: Queryable, orderId: string): Promise<OrderEventRow[]> {
  return q.query<OrderEventRow>('SELECT * FROM order_events WHERE order_id = $1 ORDER BY id', [orderId]);
}

/** Order as returned to agents: status, explanation, and what to do next. */
export function agentOrderView(ctx: AppContext, order: OrderRow, items: OrderItemRow[]) {
  const needsHuman = order.status === 'pending_approval' || (order.status === 'awaiting_payment' && !ctx.payments.canAutoCapture);
  return {
    order_id: order.id,
    status: order.status,
    protocol: order.protocol,
    currency: order.currency,
    total_paise: order.total_paise,
    items: items.map((i) => ({
      product_id: i.product_id,
      name: i.name,
      quantity: i.quantity,
      unit_price_paise: i.unit_price_paise,
      line_total_paise: i.line_total_paise,
    })),
    decision: {
      outcome: order.decision.outcome,
      summary: order.decision.summary,
      checks: order.decision.checks.filter((c) => c.result !== 'pass'),
    },
    next_action: nextAction(order),
    ...(needsHuman ? { approval_url: orderLink(ctx, order.id) } : {}),
    ...(order.cart_mandate ? { cart_mandate: order.cart_mandate } : {}),
    created_at: new Date(order.created_at).toISOString(),
  };
}

function nextAction(order: OrderRow): string {
  switch (order.status) {
    case 'paid':
      return 'Done. The order is paid and will be fulfilled.';
    case 'awaiting_payment':
      return 'Authorised. Share approval_url with the user to complete payment.';
    case 'pending_approval':
      return 'Ask the user to review and approve this order at approval_url. Do not retry.';
    case 'in_review':
      return 'Held for merchant fraud review. Check back with get_order_status.';
    case 'blocked':
      return 'Blocked by the user’s mandate. Adjust the cart; do not retry the same items.';
    default:
      return `Order is ${order.status}.`;
  }
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === '23505';
}
