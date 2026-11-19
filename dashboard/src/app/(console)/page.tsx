'use client';

import Link from 'next/link';
import { Card, EmptyState, ErrorState, PageHeader, ProtocolTag, Skeleton, StatusBadge } from '@/components/ui';
import { useAdmin, useLiveReload } from '@/lib/api';
import { RULE_LABELS, formatPaise, formatPaiseShort, timeAgo } from '@/lib/format';
import type { OrderListItem, Stats } from '@/lib/types';

const PROTOCOL_AGENT: Record<string, string> = { acp: 'ChatGPT · Agentic Commerce Protocol', mcp: 'Claude · Model Context Protocol', ap2: 'Gemini · Agent Payments Protocol' };

export default function OverviewPage() {
  const stats = useAdmin<Stats>('/stats');
  const recent = useAdmin<{ orders: OrderListItem[] }>('/orders?limit=8');
  useLiveReload(() => {
    void stats.reload();
    void recent.reload();
  });

  if (stats.error) return <ErrorState error={stats.error} onRetry={stats.reload} />;
  const s = stats.data;
  const t = s?.totals;
  const autoRate = t && t.orders > 0 ? Math.round((t.auto_approved / t.orders) * 100) : 0;
  const waiting = (t?.pending_approval ?? 0) + (t?.in_review ?? 0);

  return (
    <>
      <PageHeader
        kicker="MERCHANT OVERVIEW"
        title="Commerce, connected."
        description="Every order your store receives from AI agents, which rules approved or stopped it, and why."
        actions={
          <Link className="btn btn-primary" href="/playground">
            Run an agent checkout
          </Link>
        }
      />

      <section className="metrics-grid" aria-label="Key metrics">
        <article className="metric-card metric-primary">
          <div className="metric-topline">
            <span>Paid volume</span>
          </div>
          <strong className="metric-value">{t ? formatPaiseShort(t.paid_volume_paise) : '—'}</strong>
          <span className="metric-caption">{t ? `${t.paid_orders} paid orders` : 'Loading'}</span>
        </article>
        <article className="metric-card">
          <div className="metric-topline">
            <span>Auto-approved by mandate</span>
          </div>
          <strong className="metric-value">{t ? `${autoRate}%` : '—'}</strong>
          <span className="metric-caption">Orders that needed no human</span>
        </article>
        <article className={`metric-card ${waiting > 0 ? 'metric-warn' : ''}`}>
          <div className="metric-topline">
            <span>Waiting on a human</span>
          </div>
          <strong className="metric-value">{t ? waiting : '—'}</strong>
          <span className="metric-caption">
            {t ? (
              <>
                {t.pending_approval} user approvals · <Link href="/review">{t.in_review} in review</Link>
              </>
            ) : (
              'Loading'
            )}
          </span>
        </article>
        <article className={`metric-card ${t && t.blocked > 0 ? 'metric-alert' : ''}`}>
          <div className="metric-topline">
            <span>Stopped by policy</span>
          </div>
          <strong className="metric-value">{t ? formatPaiseShort(t.protected_paise) : '—'}</strong>
          <span className="metric-caption">{t ? `${t.blocked} orders blocked by mandates` : 'Loading'}</span>
        </article>
      </section>

      <div className="grid-2-1">
        <Card kicker="LAST 14 DAYS" title="Paid volume">
          <div className="card-body">{s ? <VolumeChart daily={s.daily} /> : <Skeleton rows={4} />}</div>
        </Card>
        <Card kicker="CHANNELS" title="Agent protocols">
          <div className="card-body">
            {s ? (
              <ul className="list">
                {(['acp', 'mcp', 'ap2'] as const).map((p) => {
                  const row = s.by_protocol.find((r) => r.protocol === p);
                  return (
                    <li key={p} className="list-row">
                      <ProtocolTag protocol={p} />
                      <span className="list-main">
                        <strong>{PROTOCOL_AGENT[p]}</strong>
                        <small>{row ? `${row.orders} orders · ${formatPaise(row.paid_volume_paise)} paid` : 'No orders yet'}</small>
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <Skeleton />
            )}
          </div>
        </Card>
      </div>

      <div className="grid-2-1">
        <Card
          kicker="LIVE"
          title="Recent agent orders"
          action={
            <Link className="btn btn-ghost btn-sm" href="/orders">
              All orders →
            </Link>
          }
        >
          {recent.data ? (
            recent.data.orders.length === 0 ? (
              <EmptyState title="No orders yet">Run a checkout from the Agent playground to see it appear here live.</EmptyState>
            ) : (
              <ul className="feed">
                {recent.data.orders.map((o) => (
                  <li key={o.id}>
                    <Link href={`/orders/${o.id}`} className="feed-row">
                      <ProtocolTag protocol={o.protocol} />
                      <span className="feed-main">
                        <strong>
                          {o.agent_name} · {o.item_count} item{o.item_count === 1 ? '' : 's'} · {formatPaise(o.total_paise)}
                        </strong>
                        <small>{o.summary}</small>
                      </span>
                      <span className="feed-side">
                        <StatusBadge status={o.status} />
                        <small>{timeAgo(o.created_at)}</small>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <div className="card-body">
              <Skeleton rows={5} />
            </div>
          )}
        </Card>

        <div className="stack">
          <Card kicker="TRUST LAYER" title="Rules that fired">
            <div className="card-body">
              {s && s.top_rules.length > 0 ? (
                <ul className="bars">
                  {s.top_rules.map((r) => (
                    <li key={r.rule}>
                      <span>{RULE_LABELS[r.rule] ?? r.rule}</span>
                      <span className="bar">
                        <span style={{ width: `${(r.hits / s.top_rules[0]!.hits) * 100}%` }} />
                      </span>
                      <b>{r.hits}</b>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted small">No rule has stopped an order yet.</p>
              )}
            </div>
          </Card>
          <Card kicker="INVENTORY" title="Running low">
            <div className="card-body">
              {s && s.low_stock.length > 0 ? (
                <ul className="list compact">
                  {s.low_stock.map((p) => (
                    <li key={p.id} className="list-row">
                      <span className="list-main">
                        <strong>{p.name}</strong>
                      </span>
                      <span className={`stock ${p.stock < 5 ? 'stock-bad' : 'stock-warn'}`}>{p.stock} left</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted small">All products are well stocked.</p>
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function VolumeChart({ daily }: { daily: Stats['daily'] }) {
  const max = Math.max(1, ...daily.map((d) => d.paid_volume_paise));
  const total = daily.reduce((s, d) => s + d.paid_volume_paise, 0);
  return (
    <div className="chart">
      <p className="chart-total">
        {formatPaise(total)} <small>paid in the last 14 days</small>
      </p>
      <div className="chart-bars" role="img" aria-label="Paid volume per day for the last 14 days">
        {daily.map((d) => (
          <div key={d.day} className="chart-col" title={`${d.day}: ${formatPaise(d.paid_volume_paise)} · ${d.orders} orders`}>
            <span className="chart-bar" style={{ height: `${Math.max(d.paid_volume_paise > 0 ? 4 : 0, (d.paid_volume_paise / max) * 100)}%` }} />
            <span className="chart-label">{new Date(d.day).getDate()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
