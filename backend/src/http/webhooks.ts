import express, { Router } from 'express';
import type { AppContext } from '../context.js';
import { logger } from '../lib/logger.js';
import { settleOrder } from '../services/orders.js';

interface RazorpayWebhook {
  event: string;
  payload?: { payment?: { entity?: { id: string; order_id: string; status: string } } };
}

/**
 * Razorpay webhooks. The signature is an HMAC of the *raw* body, so this router
 * parses its own body and must be mounted before the global JSON parser.
 */
export function webhooksRouter(ctx: AppContext): Router {
  const r = Router();

  r.post('/razorpay', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
    const signature = req.header('x-razorpay-signature') ?? '';
    const raw = req.body as Buffer;
    if (!Buffer.isBuffer(raw) || !ctx.payments.verifyWebhookSignature(raw, signature)) {
      logger.warn('webhook: rejected Razorpay webhook with invalid signature');
      return res.status(401).json({ error: { code: 'unauthorized', message: 'Invalid signature' } });
    }

    const event = JSON.parse(raw.toString('utf8')) as RazorpayWebhook;
    const eventId = req.header('x-razorpay-event-id') ?? `${event.event}:${event.payload?.payment?.entity?.id ?? Date.now()}`;

    // Webhooks are delivered at least once; record the id so duplicates are no-ops.
    const fresh = await ctx.db.query(
      `INSERT INTO webhook_events (id, provider, type, payload) VALUES ($1, 'razorpay', $2, $3::jsonb)
       ON CONFLICT (id) DO NOTHING RETURNING id`,
      [eventId, event.event, raw.toString('utf8')],
    );
    if (fresh.length === 0) return res.json({ status: 'duplicate' });

    const payment = event.payload?.payment?.entity;
    if ((event.event === 'payment.captured' || event.event === 'order.paid') && payment?.order_id) {
      const [order] = await ctx.db.query<{ id: string }>('SELECT id FROM orders WHERE payment_ref = $1', [payment.order_id]);
      if (order) {
        try {
          await settleOrder(ctx, order.id, { provider: 'razorpay', paymentId: payment.id }, 'webhook:razorpay');
        } catch (err) {
          logger.error({ err, orderId: order.id }, 'webhook: settlement failed');
        }
      }
    }
    res.json({ status: 'ok' });
  });

  return r;
}
