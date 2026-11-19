import { z } from 'zod';
import type { AppContext } from '../context.js';
import { AUTONOMY_LEVELS, type IntentMandateClaims } from '../domain/types.js';
import { AppError, notFound } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { signIntentMandate } from '../trust/mandates.js';

export const CreateMandateInput = z.object({
  label: z.string().trim().min(1).max(80),
  subject: z.string().trim().min(1).max(64),
  agent_id: z.string().nullable().default(null),
  max_order_paise: z.number().int().positive().max(10_000_000),
  budget_paise: z.number().int().positive().max(100_000_000),
  category_rules: z.record(z.string(), z.enum(AUTONOMY_LEVELS)).default({}),
  default_level: z.enum(AUTONOMY_LEVELS).default('confirm'),
  blocked_tags: z.array(z.string()).max(30).default([]),
  escalate_new_items: z.boolean().default(true),
  expires_in_days: z.number().int().min(1).max(365).default(30),
});
export type CreateMandateInput = z.infer<typeof CreateMandateInput>;

export interface MandateRow {
  id: string;
  merchant_id: string;
  subject: string;
  agent_id: string | null;
  label: string;
  max_order_paise: number;
  budget_paise: number;
  currency: string;
  category_rules: Record<string, string>;
  default_level: string;
  blocked_tags: string[];
  escalate_new_items: boolean;
  token: string;
  expires_at: Date;
  revoked_at: Date | null;
  created_at: Date;
}

/**
 * Issues a standing intent mandate. In production this is done by the user's
 * wallet app; here the merchant console stands in for that wallet.
 */
export async function createMandate(ctx: AppContext, input: CreateMandateInput) {
  if (input.max_order_paise > input.budget_paise) {
    throw new AppError('validation_error', 'Per-order cap cannot exceed the total budget');
  }
  if (input.agent_id) {
    const [agent] = await ctx.db.query('SELECT id FROM agents WHERE id = $1', [input.agent_id]);
    if (!agent) throw notFound('Agent');
  }
  const claims: IntentMandateClaims = {
    mandate_id: newId('man'),
    merchant_id: ctx.merchantId,
    subject: input.subject,
    agent_id: input.agent_id,
    max_order_paise: input.max_order_paise,
    budget_paise: input.budget_paise,
    currency: 'INR',
    category_rules: input.category_rules,
    default_level: input.default_level,
    blocked_tags: input.blocked_tags,
    escalate_new_items: input.escalate_new_items,
    expires_at: new Date(Date.now() + input.expires_in_days * 86_400_000).toISOString(),
  };
  const token = await signIntentMandate(claims);
  await ctx.db.query(
    `INSERT INTO mandates (id, merchant_id, subject, agent_id, label, max_order_paise, budget_paise, currency,
       category_rules, default_level, blocked_tags, escalate_new_items, token, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14)`,
    [
      claims.mandate_id,
      claims.merchant_id,
      claims.subject,
      claims.agent_id,
      input.label,
      claims.max_order_paise,
      claims.budget_paise,
      claims.currency,
      JSON.stringify(claims.category_rules),
      claims.default_level,
      claims.blocked_tags,
      claims.escalate_new_items,
      token,
      claims.expires_at,
    ],
  );
  return getMandate(ctx, claims.mandate_id);
}

export async function listMandates(ctx: AppContext) {
  return ctx.db.query<MandateRow & { spent_paise: number; orders: number }>(
    `SELECT m.*,
       coalesce(sum(o.total_paise) FILTER (WHERE o.status IN ('pending_approval','in_review','awaiting_payment','paid')), 0)::int AS spent_paise,
       count(o.id)::int AS orders
     FROM mandates m LEFT JOIN orders o ON o.intent_mandate_id = m.id
     WHERE m.merchant_id = $1
     GROUP BY m.id ORDER BY m.created_at DESC`,
    [ctx.merchantId],
  );
}

export async function getMandate(ctx: AppContext, id: string) {
  const rows = await listMandates(ctx);
  const m = rows.find((r) => r.id === id);
  if (!m) throw notFound('Mandate');
  return m;
}

export async function revokeMandate(ctx: AppContext, id: string) {
  const rows = await ctx.db.query(
    'UPDATE mandates SET revoked_at = now() WHERE id = $1 AND merchant_id = $2 AND revoked_at IS NULL RETURNING id',
    [id, ctx.merchantId],
  );
  if (rows.length === 0) throw new AppError('invalid_state', 'Mandate not found or already revoked');
  ctx.events.publish({ type: 'mandate.revoked', data: { mandate_id: id } });
  return getMandate(ctx, id);
}
