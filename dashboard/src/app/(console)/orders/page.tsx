'use client';

import { AnimatePresence, motion } from 'motion/react';
import { ChevronRight, Receipt, Search } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { AgentAvatar, StatusPill } from '@/components/icons';
import { EmptyState, ErrorState, PageHeader, Skeleton, Tabs } from '@/components/ui';
import { useAdmin, useLiveReload } from '@/lib/api';
import { formatPaise, timeAgo, type OrderStatus } from '@/lib/format';
import type { OrderListItem, Stats } from '@/lib/types';

type Filter = 'all' | 'attention' | OrderStatus;

const FILTERS: { value: Filter; label: string; statuses?: OrderStatus[] }[] = [
  { value: 'all', label: 'All' },
  { value: 'attention', label: 'Needs a decision', statuses: ['in_review', 'pending_approval'] },
  { value: 'paid', label: 'Paid', statuses: ['paid'] },
  { value: 'awaiting_payment', label: 'Awaiting payment', statuses: ['awaiting_payment'] },
  { value: 'blocked', label: 'Blocked', statuses: ['blocked'] },
  { value: 'rejected', label: 'Rejected / expired', statuses: ['rejected', 'expired', 'cancelled'] },
];

export default function OrdersPage() {
  const [filter, setFilter] = useState<Filter>('all');
  const [protocol, setProtocol] = useState('');
  const [q, setQ] = useState('');
  const stats = useAdmin<Stats>('/stats');
  const { data, error, reload } = useAdmin<{ orders: OrderListItem[] }>(`/orders?limit=200${protocol ? `&protocol=${protocol}` : ''}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`);
  useLiveReload(() => {
    reload();
    stats.reload();
  });

  const active = FILTERS.find((f) => f.value === filter)!;
  const rows = (data?.orders ?? []).filter((o) => !active.statuses || active.statuses.includes(o.status));
  const count = (f: (typeof FILTERS)[number]) =>
    f.statuses ? f.statuses.reduce((n, st) => n + (stats.data?.by_status[st] ?? 0), 0) : stats.data?.totals.orders;

  return (
    <>
      <PageHeader icon={Receipt} title="Orders" description="Every purchase an AI agent tried to make at your store, and what happened to it." />

      <div className="toolbar">
        <Tabs label="Filter orders" value={filter} onChange={setFilter} items={FILTERS.map((f) => ({ value: f.value, label: f.label, count: count(f) }))} />
        <div className="toolbar-right">
          <select className="input" value={protocol} onChange={(e) => setProtocol(e.target.value)} aria-label="Filter by AI assistant">
            <option value="">All assistants</option>
            <option value="mcp">Claude</option>
            <option value="acp">ChatGPT</option>
            <option value="ap2">Gemini</option>
          </select>
          <label className="search">
            <Search size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search order or agent" aria-label="Search orders" />
          </label>
        </div>
      </div>

      {error && <ErrorState error={error} onRetry={reload} />}
      <section className="card">
        {!data ? (
          <div className="card-pad">
            <Skeleton rows={8} height={44} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState title="No orders here" icon={Receipt}>
            {filter === 'all' ? 'Orders from AI agents will show up here.' : 'Nothing matches this filter right now.'}
          </EmptyState>
        ) : (
          <ul className="order-list">
            <AnimatePresence initial={false}>
              {rows.map((o, i) => (
                <motion.li key={o.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ delay: Math.min(i, 12) * 0.025 }}>
                  <Link href={`/orders/${o.id}`} className="order-row">
                    <AgentAvatar protocol={o.protocol} />
                    <span className="order-main">
                      <strong>
                        {o.agent_name} · {o.item_count} item{o.item_count === 1 ? '' : 's'}
                      </strong>
                      <small>{o.summary}</small>
                    </span>
                    <span className="order-meta">
                      <StatusPill status={o.status} size="sm" />
                      <small>
                        {timeAgo(o.created_at)} · <span className="mono">{o.id.slice(0, 12)}</span>
                      </small>
                    </span>
                    <span className="order-amount">{formatPaise(o.total_paise)}</span>
                    <ChevronRight size={18} className="order-chevron" />
                  </Link>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
        {data && rows.length > 0 && <div className="card-foot">Showing {rows.length} orders</div>}
      </section>
    </>
  );
}
