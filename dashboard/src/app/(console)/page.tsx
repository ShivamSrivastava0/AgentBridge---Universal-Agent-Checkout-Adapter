'use client';

import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Bell, Boxes, ShieldCheck, Sparkles, TrendingUp, Wallet, Zap } from 'lucide-react';
import Link from 'next/link';
import { useCallback } from 'react';
import { AreaChart, Donut } from '@/components/charts';
import { GettingStarted } from '@/components/GettingStarted';
import { AgentAvatar, StatusPill } from '@/components/icons';
import { AnimatedNumber } from '@/components/motion';
import { Pipeline } from '@/components/Pipeline';
import { Card, EmptyState, ErrorState, PageHeader, Reveal, Skeleton, Term } from '@/components/ui';
import { useAdmin, useLiveReload } from '@/lib/api';
import { GLOSSARY, PROTOCOL_META, formatPaise, formatPaiseShort, timeAgo } from '@/lib/format';
import type { OrderListItem, Stats } from '@/lib/types';

export default function HomePage() {
  const stats = useAdmin<Stats>('/stats');
  const recent = useAdmin<{ orders: OrderListItem[] }>('/orders?limit=7');
  useLiveReload(() => {
    stats.reload();
    recent.reload();
  });

  const rupees = useCallback((n: number) => formatPaiseShort(n), []);
  const percent = useCallback((n: number) => `${Math.round(n)}%`, []);

  if (stats.error) return <ErrorState error={stats.error} onRetry={stats.reload} />;
  const s = stats.data;
  const t = s?.totals;
  const autoRate = t && t.orders > 0 ? (t.auto_approved / t.orders) * 100 : 0;
  const attention = (t?.in_review ?? 0) + (t?.pending_approval ?? 0);
  const outcome = (k: string) => s?.by_outcome.find((o) => o.outcome === k)?.orders ?? 0;

  return (
    <>
      <PageHeader
        title="Welcome back"
        description="AI assistants shop at your store through AgentBridge. Here’s what they bought, what was stopped, and what needs you."
        actions={
          <Link className="btn btn-primary" href="/try">
            <Sparkles size={16} /> Watch an agent shop
          </Link>
        }
      />

      <AnimatePresence>
        {attention > 0 && (
          <motion.div className="attention-banner" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <span className="attention-icon">
              <Bell size={18} />
            </span>
            <div>
              <strong>
                {attention} order{attention === 1 ? '' : 's'} waiting on a decision
              </strong>
              <span>
                {t?.in_review ?? 0} for you to review · {t?.pending_approval ?? 0} waiting for the shopper
              </span>
            </div>
            <Link className="btn btn-soft" href="/attention">
              Review now <ArrowRight size={16} />
            </Link>
          </motion.div>
        )}
      </AnimatePresence>

      <GettingStarted />

      <Reveal className="kpis">
        <Kpi icon={Wallet} tone="accent" label="Money earned" value={t ? <AnimatedNumber value={t.paid_volume_paise} format={rupees} /> : '—'} foot={t ? `${t.paid_orders} paid orders` : ''} />
        <Kpi
          icon={Zap}
          label={<Term tip={GLOSSARY.autoRate}>Handled automatically</Term>}
          value={t ? <AnimatedNumber value={autoRate} format={percent} /> : '—'}
          foot="No human needed"
        />
        <Kpi
          icon={Bell}
          tone={attention > 0 ? 'warn' : undefined}
          label="Waiting on someone"
          value={t ? <AnimatedNumber value={attention} /> : '—'}
          foot={<Link href="/attention">See what’s waiting →</Link>}
        />
        <Kpi
          icon={ShieldCheck}
          tone="bad"
          label={<Term tip="Orders blocked by a spending rule or rejected after review. That money never left the shopper’s account.">Spending stopped</Term>}
          value={t ? <AnimatedNumber value={t.protected_paise} format={rupees} /> : '—'}
          foot={t ? `${t.blocked} orders blocked by rules` : ''}
        />
      </Reveal>

      <Reveal className="grid-main">
        <Card title="How every agent order works" subtitle="Each order passes through the same four steps, whichever AI sent it.">
          <Pipeline />
        </Card>
        <Card title="How orders were decided" subtitle="Since you started">
          {s ? (
            <Donut
              center={{ value: String(t?.orders ?? 0), label: 'orders' }}
              segments={[
                { label: 'Bought automatically', value: outcome('approve'), color: 'var(--good)' },
                { label: 'Asked the shopper', value: outcome('needs_approval'), color: 'var(--warn)' },
                { label: 'Flagged for review', value: outcome('review'), color: 'var(--info)' },
                { label: 'Blocked', value: outcome('block'), color: 'var(--bad)' },
              ]}
            />
          ) : (
            <Skeleton rows={5} />
          )}
        </Card>
      </Reveal>

      <Reveal className="grid-main">
        <Card
          title={
            <span className="row-inline">
              <span className="pulse-dot" /> Live activity
            </span>
          }
          subtitle="New orders appear here the moment an agent places them."
          action={
            <Link className="btn btn-ghost btn-sm" href="/orders">
              All orders <ArrowRight size={14} />
            </Link>
          }
          pad={false}
        >
          {!recent.data ? (
            <div className="card-pad">
              <Skeleton rows={6} height={40} />
            </div>
          ) : recent.data.orders.length === 0 ? (
            <EmptyState title="No orders yet" action={<Link className="btn btn-primary btn-sm" href="/try">Run your first agent order</Link>}>
              Orders from AI agents will appear here live.
            </EmptyState>
          ) : (
            <ul className="activity">
              <AnimatePresence initial={false}>
                {recent.data.orders.map((o) => (
                  <motion.li key={o.id} layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0 }} transition={{ duration: 0.35 }}>
                    <Link href={`/orders/${o.id}`} className="activity-row">
                      <AgentAvatar protocol={o.protocol} />
                      <span className="activity-main">
                        <strong>
                          {o.agent_name} ordered {o.item_count} item{o.item_count === 1 ? '' : 's'} · {formatPaise(o.total_paise)}
                        </strong>
                        <small>{o.summary}</small>
                      </span>
                      <span className="activity-side">
                        <StatusPill status={o.status} size="sm" />
                        <small>{timeAgo(o.created_at)}</small>
                      </span>
                    </Link>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </Card>

        <div className="stack">
          <Card title="Money earned, last 14 days">
            {s ? (
              <AreaChart
                points={s.daily.map((d) => ({
                  label: new Date(d.day).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
                  value: d.paid_volume_paise,
                  sub: `${d.orders} orders`,
                }))}
              />
            ) : (
              <Skeleton rows={4} />
            )}
          </Card>
          <Card title={<Term tip={GLOSSARY.protocols}>Where orders come from</Term>}>
            {s ? (
              <ul className="channels">
                {(['mcp', 'acp', 'ap2'] as const).map((p) => {
                  const row = s.by_protocol.find((r) => r.protocol === p);
                  const share = t && t.orders ? ((row?.orders ?? 0) / t.orders) * 100 : 0;
                  return (
                    <li key={p}>
                      <AgentAvatar protocol={p} size={32} />
                      <span className="channel-main">
                        <span className="row-between">
                          <strong>{PROTOCOL_META[p].agent}</strong>
                          <small>{row?.orders ?? 0} orders</small>
                        </span>
                        <span className={`bar bar-${p}`}>
                          <motion.span initial={{ width: 0 }} animate={{ width: `${share}%` }} transition={{ duration: 0.9 }} />
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <Skeleton />
            )}
          </Card>
          {s && s.low_stock.length > 0 && (
            <Card title={<span className="row-inline"><Boxes size={17} /> Running low</span>} action={<Link className="btn btn-ghost btn-sm" href="/products">Restock</Link>}>
              <ul className="low-stock">
                {s.low_stock.map((p) => (
                  <li key={p.id}>
                    <span>{p.name}</span>
                    <b className={p.stock < 5 ? 'text-bad' : 'text-warn'}>{p.stock} left</b>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </Reveal>
    </>
  );
}

function Kpi({ icon: Icon, label, value, foot, tone }: { icon: typeof TrendingUp; label: React.ReactNode; value: React.ReactNode; foot: React.ReactNode; tone?: 'accent' | 'warn' | 'bad' }) {
  return (
    <motion.article className={`kpi ${tone ? `kpi-${tone}` : ''}`} variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0 } }} whileHover={{ y: -3 }}>
      <div className="kpi-top">
        <span className="kpi-icon">
          <Icon size={18} strokeWidth={2.2} />
        </span>
        <span className="kpi-label">{label}</span>
      </div>
      <strong className="kpi-value">{value}</strong>
      <span className="kpi-foot">{foot}</span>
    </motion.article>
  );
}
