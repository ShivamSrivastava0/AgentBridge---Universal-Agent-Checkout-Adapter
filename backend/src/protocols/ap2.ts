import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { CartInput } from '../domain/types.js';
import { agentRateLimit, parse, requireAgent } from '../http/middleware.js';
import { buildQuote } from '../services/catalog.js';
import { agentOrderView, getOrderWithItems, placeOrder } from '../services/orders.js';
import { verifyIntentMandate } from '../trust/mandates.js';

/**
 * AP2 (Agent Payments Protocol) adapter. AP2 authorises payments with signed
 * mandates: an Intent Mandate (the user's standing instructions) and a Cart
 * Mandate (approval of one exact cart). Signatures are ES256; the public keys
 * are at /.well-known/jwks.json.
 */

const Checkout = z.object({
  intent_mandate: z.string().min(10),
  cart: z.object({ items: CartInput }),
  idempotency_key: z.string().max(100).optional(),
});

export function ap2Router(ctx: AppContext): Router {
  const r = Router();
  r.use(agentRateLimit, requireAgent(ctx));

  /** Let an agent check a mandate before relying on it. */
  r.post('/mandates/verify', async (req, res) => {
    const { mandate } = parse(z.object({ mandate: z.string().min(10) }), req.body);
    const claims = await verifyIntentMandate(mandate, ctx.merchantId);
    const [row] = await ctx.db.query<{ revoked_at: Date | null }>('SELECT revoked_at FROM mandates WHERE id = $1', [claims.mandate_id]);
    res.json({ valid: !!row && !row.revoked_at, revoked: !!row?.revoked_at, claims });
  });

  /** Build the cart contents an agent would ask the user to sign. */
  r.post('/cart', async (req, res) => {
    const { items } = parse(z.object({ items: CartInput }), req.body);
    const quote = await buildQuote(ctx.db, ctx.merchantId, items);
    res.json({
      cart_contents: { merchant_id: quote.merchant_id, currency: quote.currency, lines: quote.lines, total_paise: quote.total_paise },
      cart_hash: quote.cart_hash,
    });
  });

  /** Present an intent mandate plus cart; receive a signed cart mandate if policy allows. */
  r.post('/checkout', async (req, res) => {
    const body = parse(Checkout, req.body);
    const { order, items, replayed } = await placeOrder(ctx, {
      agent: req.agent!,
      protocol: 'ap2',
      items: body.cart.items,
      mandateToken: body.intent_mandate,
      idempotencyKey: body.idempotency_key,
    });
    res.status(replayed ? 200 : 201).json(agentOrderView(ctx, order, items));
  });

  r.get('/orders/:id', async (req, res) => {
    const { order, items } = await getOrderWithItems(ctx.db, req.params.id);
    if (order.agent_id !== req.agent!.id) return res.status(404).json({ error: { code: 'not_found', message: 'Order not found' } });
    res.json(agentOrderView(ctx, order, items));
  });

  return r;
}
