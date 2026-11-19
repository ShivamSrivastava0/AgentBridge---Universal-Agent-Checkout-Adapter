'use client';

import Link from 'next/link';
import { DecisionTrace, EmptyState, ErrorState, PageHeader, ProtocolTag, Skeleton } from '@/components/ui';
import { ReviewBar } from '@/components/ReviewBar';
import { useAdmin, useLiveReload } from '@/lib/api';
import { formatPaise, timeAgo } from '@/lib/format';
import type { OrderDetail, OrderListItem } from '@/lib/types';

export default function ReviewPage() {
  const { data, error, reload } = useAdmin<{ orders: OrderListItem[] }>('/orders?status=in_review&limit=50');
  useLiveReload(reload);

  return (
    <>
      <PageHeader
        kicker="TRUST & SAFETY"
        title="Review queue"
        description="Orders the risk rules held back: unusually large, too fast, or odd quantities. Stock stays reserved until you decide."
      />
      {error && <ErrorState error={error} onRetry={reload} />}
      {!data && !error && <Skeleton rows={4} />}
      {data && data.orders.length === 0 && (
        <section className="section-block">
          <EmptyState title="Nothing to review">
            High-value and high-velocity orders land here. Try the “Air fryer” scenario in the playground.
          </EmptyState>
        </section>
      )}
      <div className="stack">
        {data?.orders.map((o) => <ReviewCard key={o.id} order={o} onDone={reload} />)}
      </div>
    </>
  );
}

function ReviewCard({ order, onDone }: { order: OrderListItem; onDone: () => void }) {
  const { data } = useAdmin<OrderDetail>(`/orders/${order.id}`);
  return (
    <section className="section-block">
      <div className="section-heading">
        <div>
          <p className="section-kicker">
            <ProtocolTag protocol={order.protocol} /> {order.agent_name} · {timeAgo(order.created_at)}
          </p>
          <h2>
            <Link href={`/orders/${order.id}`}>{formatPaise(order.total_paise)}</Link>{' '}
            <span className="muted small mono">{order.id}</span>
          </h2>
        </div>
        <span className="risk">Risk {order.risk_score}/100</span>
      </div>
      <div className="card-body">
        {data ? (
          <>
            <p className="muted small">{data.items.map((i) => `${i.quantity} × ${i.name}`).join(', ')}</p>
            <DecisionTrace checks={data.order.decision.checks} showPasses={false} />
          </>
        ) : (
          <Skeleton rows={2} />
        )}
      </div>
      <ReviewBar id={order.id} onDone={onDone} />
    </section>
  );
}
