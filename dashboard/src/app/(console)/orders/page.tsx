'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EmptyState, ErrorState, PageHeader, ProtocolTag, Skeleton, StatusBadge } from '@/components/ui';
import { useAdmin, useLiveReload } from '@/lib/api';
import { STATUS_META, formatPaise, timeAgo, type OrderStatus } from '@/lib/format';
import type { OrderListItem } from '@/lib/types';

const FILTERS: (OrderStatus | 'all')[] = ['all', 'paid', 'pending_approval', 'in_review', 'awaiting_payment', 'blocked', 'rejected', 'expired'];

export default function OrdersPage() {
  const router = useRouter();
  const [status, setStatus] = useState<OrderStatus | 'all'>('all');
  const [protocol, setProtocol] = useState('');
  const [q, setQ] = useState('');
  const params = new URLSearchParams({ limit: '100' });
  if (status !== 'all') params.set('status', status);
  if (protocol) params.set('protocol', protocol);
  if (q.trim()) params.set('q', q.trim());
  const { data, error, loading, reload } = useAdmin<{ orders: OrderListItem[] }>(`/orders?${params}`);
  useLiveReload(reload);

  return (
    <>
      <PageHeader kicker="ACTIVITY" title="Orders" description="Every checkout from every agent, with the policy decision that shaped it." />

      <div className="toolbar">
        <div className="tabs" role="tablist" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <button key={f} role="tab" aria-selected={status === f} className={`tab ${status === f ? 'active' : ''}`} onClick={() => setStatus(f)}>
              {f === 'all' ? 'All' : STATUS_META[f].label}
            </button>
          ))}
        </div>
        <div className="toolbar-right">
          <select className="input input-sm" value={protocol} onChange={(e) => setProtocol(e.target.value)} aria-label="Filter by protocol">
            <option value="">All protocols</option>
            <option value="acp">ACP · ChatGPT</option>
            <option value="mcp">MCP · Claude</option>
            <option value="ap2">AP2 · Gemini</option>
          </select>
          <label className="search-box">
            <span className="search-icon" aria-hidden="true" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Order id or agent" aria-label="Search orders" />
          </label>
        </div>
      </div>

      {error && <ErrorState error={error} onRetry={reload} />}
      <section className="section-block">
        <div className="table-frame">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Order</th>
                <th scope="col">Agent</th>
                <th scope="col">Decision</th>
                <th scope="col" className="num">
                  Total
                </th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {data?.orders.map((o) => (
                <tr key={o.id} className="clickable" onClick={() => router.push(`/orders/${o.id}`)}>
                  <td>
                    <Link href={`/orders/${o.id}`} className="mono strong" onClick={(e) => e.stopPropagation()}>
                      {o.id}
                    </Link>
                    <span className="sub">
                      {timeAgo(o.created_at)} · {o.item_count} item{o.item_count === 1 ? '' : 's'}
                    </span>
                  </td>
                  <td>
                    <ProtocolTag protocol={o.protocol} /> <span className="agent-name">{o.agent_name}</span>
                    <span className="sub">{o.mandate_label ? `Mandate: ${o.mandate_label}` : 'No mandate'}</span>
                  </td>
                  <td className="wrap">
                    <span className="clamp">{o.summary}</span>
                  </td>
                  <td className="num mono">{formatPaise(o.total_paise)}</td>
                  <td>
                    <StatusBadge status={o.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading && !data && (
            <div className="card-body">
              <Skeleton rows={6} />
            </div>
          )}
          {data && data.orders.length === 0 && <EmptyState title="No orders match these filters" />}
        </div>
        {data && <div className="table-footer">Showing {data.orders.length} most recent</div>}
      </section>
    </>
  );
}
