import { Router, type Request } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { AppError } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import {
  approveByUser,
  checkOrderAccess,
  declineByUser,
  getOrderEvents,
  getOrderWithItems,
  settleOrder,
} from '../services/orders.js';
import { parse } from './middleware.js';

const RazorpayCallback = z.object({
  razorpay_order_id: z.string(),
  razorpay_payment_id: z.string(),
  razorpay_signature: z.string(),
});

function token(req: Request): string | undefined {
  return req.header('x-order-token') ?? (typeof req.query.t === 'string' ? req.query.t : undefined);
}

/**
 * Shopper-facing endpoints behind the approval link an agent hands to its user.
 * Access is by a per-order capability token, so no shopper account is needed.
 */
export function shopRouter(ctx: AppContext): Router {
  const r = Router();

  r.use('/orders/:id', (req, _res, next) => {
    checkOrderAccess(req.params.id!, token(req));
    next();
  });

  r.get('/orders/:id', async (req, res) => {
    const { order, items } = await getOrderWithItems(ctx.db, req.params.id);
    const events = await getOrderEvents(ctx.db, order.id);
    const [agent] = await ctx.db.query<{ name: string; platform: string }>('SELECT name, platform FROM agents WHERE id = $1', [order.agent_id]);
    const [mandate] = order.intent_mandate_id
      ? await ctx.db.query<{ label: string }>('SELECT label FROM mandates WHERE id = $1', [order.intent_mandate_id])
      : [];
    res.json({
      id: order.id,
      status: order.status,
      protocol: order.protocol,
      currency: order.currency,
      total_paise: order.total_paise,
      created_at: order.created_at,
      approval_expires_at: order.approval_expires_at,
      agent: agent ?? null,
      mandate_label: mandate?.label ?? null,
      decision: order.decision,
      items,
      events: events.map((e) => ({ type: e.type, actor: e.actor, created_at: e.created_at })),
      payment: {
        mode: ctx.payments.mode,
        razorpay_key_id: ctx.payments.publicKeyId,
        razorpay_order_id: ctx.payments.mode === 'razorpay' ? order.payment_ref : null,
      },
    });
  });

  r.post('/orders/:id/approve', async (req, res) => {
    await approveByUser(ctx, req.params.id);
    res.json({ ok: true });
  });

  r.post('/orders/:id/decline', async (req, res) => {
    await declineByUser(ctx, req.params.id);
    res.json({ ok: true });
  });

  r.post('/orders/:id/pay/simulate', async (req, res) => {
    if (ctx.payments.mode !== 'simulated') throw new AppError('forbidden', 'Simulated payments are disabled');
    await settleOrder(ctx, req.params.id, { provider: 'simulated', paymentId: newId('sim_pay') }, 'user');
    res.json({ ok: true });
  });

  /** Razorpay Checkout success handler: verify the signature, then settle. */
  r.post('/orders/:id/pay/razorpay', async (req, res) => {
    const body = parse(RazorpayCallback, req.body);
    const { order } = await getOrderWithItems(ctx.db, req.params.id);
    if (order.payment_ref !== body.razorpay_order_id) throw new AppError('payment_error', 'Payment is for a different order');
    const ok = ctx.payments.verifyCheckoutSignature({
      orderRef: body.razorpay_order_id,
      paymentId: body.razorpay_payment_id,
      signature: body.razorpay_signature,
    });
    if (!ok) throw new AppError('payment_error', 'Invalid Razorpay payment signature');
    await settleOrder(ctx, order.id, { provider: 'razorpay', paymentId: body.razorpay_payment_id }, 'user');
    res.json({ ok: true });
  });

  return r;
}
