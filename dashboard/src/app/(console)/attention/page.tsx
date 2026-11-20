'use client';

import { AnimatePresence, motion } from 'motion/react';
import { Bell, ExternalLink, Hand, PartyPopper, ScanEye } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { AgentAvatar, CategoryIcon } from '@/components/icons';
import { ReviewBar } from '@/components/ReviewBar';
import { DecisionChecklist, EmptyState, ErrorState, PageHeader, Skeleton, Tabs, Term } from '@/components/ui';
import { useAdmin, useLiveReload } from '@/lib/api';
import { GLOSSARY, formatPaise, timeAgo } from '@/lib/format';
import type { OrderDetail, OrderListItem } from '@/lib/types';

type View = 'review' | 'shopper';

export default function AttentionPage() {
  const [view, setView] = useState<View>('review');
  const review = useAdmin<{ orders: OrderListItem[] }>('/orders?status=in_review&limit=50');
  const shopper = useAdmin<{ orders: OrderListItem[] }>('/orders?status=pending_approval&limit=50');
  useLiveReload(() => {
    review.reload();
    shopper.reload();
  });
  const current = view === 'review' ? review : shopper;

  return (
    <>
      <PageHeader
        icon={Bell}
        title="Needs attention"
        description={
          <>
            Orders that couldn’t complete on their own. <Term tip={GLOSSARY.review}>Flagged orders</Term> wait for you; the rest wait for the shopper to tap approve.
          </>
        }
      />
      <div className="toolbar">
        <Tabs
          label="Which queue"
          value={view}
          onChange={setView}
          items={[
            { value: 'review', label: 'For you to review', count: review.data?.orders.length },
            { value: 'shopper', label: 'Waiting for shopper', count: shopper.data?.orders.length },
          ]}
        />
      </div>

      {current.error && <ErrorState error={current.error} onRetry={current.reload} />}
      {!current.data && !current.error && <Skeleton rows={4} height={60} />}
      {current.data?.orders.length === 0 && (
        <section className="card">
          <EmptyState
            icon={PartyPopper}
            title={view === 'review' ? 'All clear: nothing to review' : 'No shopper approvals pending'}
            action={
              <Link className="btn btn-soft btn-sm" href="/try">
                Try the “Air fryer” scenario
              </Link>
            }
          >
            {view === 'review' ? 'Large or unusually fast orders will appear here for you to approve or reject.' : 'Orders the agent wasn’t allowed to complete alone appear here.'}
          </EmptyState>
        </section>
      )}
      <div className="stack">
        <AnimatePresence>
          {current.data?.orders.map((o) => (
            <motion.div key={o.id} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 60, height: 0, marginBottom: -16 }} transition={{ duration: 0.35 }}>
              <AttentionCard order={o} kind={view} onDone={() => (view === 'review' ? review.reload() : shopper.reload())} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </>
  );
}

function AttentionCard({ order, kind, onDone }: { order: OrderListItem; kind: View; onDone: () => void }) {
  const { data } = useAdmin<OrderDetail>(`/orders/${order.id}`);
  return (
    <section className={`card attention-card kind-${kind}`}>
      <div className="attention-head">
        <AgentAvatar protocol={order.protocol} size={42} />
        <div>
          <Link href={`/orders/${order.id}`} className="attention-title">
            {order.agent_name} wants to spend {formatPaise(order.total_paise)}
          </Link>
          <span className="muted small">
            {timeAgo(order.created_at)} · {order.mandate_label ? `under “${order.mandate_label}”` : 'no spending rule'}
          </span>
        </div>
        {kind === 'review' ? (
          <span className="risk-badge">
            <ScanEye size={15} /> Risk {order.risk_score}/100
          </span>
        ) : (
          <span className="pill tone-warn">
            <Hand size={15} /> Shopper decides
          </span>
        )}
      </div>
      <div className="card-pad attention-body">
        {data ? (
          <>
            <ul className="mini-items">
              {data.items.map((i) => (
                <li key={i.line_no}>
                  <CategoryIcon category={i.category} size={15} />
                  {i.quantity} × {i.name}
                </li>
              ))}
            </ul>
            <DecisionChecklist checks={data.order.decision.checks} onlyIssues />
          </>
        ) : (
          <Skeleton rows={3} />
        )}
      </div>
      {kind === 'review' ? (
        <ReviewBar id={order.id} onDone={onDone} />
      ) : (
        data && (
          <div className="review-bar">
            <span className="review-icon warn">
              <Hand size={20} />
            </span>
            <div className="review-text">
              <strong>Nothing for you to do</strong>
              <span>The shopper got an approval link from {order.agent_name}. You can open it to see exactly what they see.</span>
            </div>
            <a className="btn btn-soft" href={data.shopper_link} target="_blank" rel="noreferrer">
              Shopper view <ExternalLink size={14} />
            </a>
          </div>
        )
      )}
    </section>
  );
}
