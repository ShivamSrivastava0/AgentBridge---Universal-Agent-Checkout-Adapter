import type { AppContext } from '../context.js';

export async function getStats(ctx: AppContext) {
  const q = ctx.db;
  const [totals] = await q.query<{
    orders: number;
    paid_orders: number;
    paid_volume_paise: number;
    blocked: number;
    in_review: number;
    pending_approval: number;
    auto_approved: number;
    protected_paise: number;
  }>(
    `SELECT count(*)::int AS orders,
       count(*) FILTER (WHERE status = 'paid')::int AS paid_orders,
       coalesce(sum(total_paise) FILTER (WHERE status = 'paid'), 0)::int AS paid_volume_paise,
       count(*) FILTER (WHERE status = 'blocked')::int AS blocked,
       count(*) FILTER (WHERE status = 'in_review')::int AS in_review,
       count(*) FILTER (WHERE status = 'pending_approval')::int AS pending_approval,
       count(*) FILTER (WHERE decision->>'outcome' = 'approve')::int AS auto_approved,
       coalesce(sum(total_paise) FILTER (WHERE status IN ('blocked','rejected')), 0)::int AS protected_paise
     FROM orders WHERE merchant_id = $1`,
    [ctx.merchantId],
  );

  const byProtocol = await q.query<{ protocol: string; orders: number; paid_volume_paise: number }>(
    `SELECT protocol, count(*)::int AS orders,
       coalesce(sum(total_paise) FILTER (WHERE status = 'paid'), 0)::int AS paid_volume_paise
     FROM orders WHERE merchant_id = $1 GROUP BY protocol ORDER BY protocol`,
    [ctx.merchantId],
  );

  const byStatus = await q.query<{ status: string; orders: number }>(
    `SELECT status, count(*)::int AS orders FROM orders WHERE merchant_id = $1 GROUP BY status`,
    [ctx.merchantId],
  );

  const byOutcome = await q.query<{ outcome: string; orders: number }>(
    `SELECT decision->>'outcome' AS outcome, count(*)::int AS orders
     FROM orders WHERE merchant_id = $1 GROUP BY 1 ORDER BY 1`,
    [ctx.merchantId],
  );

  const daily = await q.query<{ day: string; orders: number; paid_volume_paise: number }>(
    `SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
       count(o.id)::int AS orders,
       coalesce(sum(o.total_paise) FILTER (WHERE o.status = 'paid'), 0)::int AS paid_volume_paise
     FROM generate_series(current_date - 13, current_date, interval '1 day') AS d(day)
     LEFT JOIN orders o ON o.merchant_id = $1 AND o.created_at::date = d.day::date
     GROUP BY d.day ORDER BY d.day`,
    [ctx.merchantId],
  );

  const topRules = await q.query<{ rule: string; hits: number }>(
    `SELECT c->>'rule' AS rule, count(*)::int AS hits
     FROM orders o, jsonb_array_elements(o.decision->'checks') c
     WHERE o.merchant_id = $1 AND c->>'result' <> 'pass'
     GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
    [ctx.merchantId],
  );

  const lowStock = await q.query<{ id: string; name: string; stock: number }>(
    `SELECT id, name, stock FROM products WHERE merchant_id = $1 AND active AND stock < 15 ORDER BY stock LIMIT 6`,
    [ctx.merchantId],
  );

  return {
    totals,
    by_protocol: byProtocol,
    by_outcome: byOutcome,
    by_status: Object.fromEntries(byStatus.map((r) => [r.status, r.orders])),
    daily,
    top_rules: topRules,
    low_stock: lowStock,
    payments_mode: ctx.payments.mode,
  };
}
