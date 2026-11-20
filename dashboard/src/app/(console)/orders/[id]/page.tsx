'use client';

import { motion } from 'motion/react';
import { ArrowLeft, Bot, CircleCheck, CreditCard, ExternalLink, Hand, ListChecks, ScanEye, Ban, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { use } from 'react';
import { AgentAvatar, CategoryIcon, OutcomePill, StatusPill } from '@/components/icons';
import { ReviewBar } from '@/components/ReviewBar';
import { Card, CopyButton, DecisionChecklist, Disclosure, ErrorState, Reveal, Skeleton, Term, Timeline } from '@/components/ui';
import { useAdmin, useLiveReload } from '@/lib/api';
import { GLOSSARY, PROTOCOL_META, STATUS_META, formatDateTime, formatPaise, titleCase } from '@/lib/format';
import type { OrderDetail } from '@/lib/types';

export default function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, reload } = useAdmin<OrderDetail>(`/orders/${id}`);
  useLiveReload(reload, (e) => e.order_id === id);

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Skeleton rows={10} height={24} />;
  const { order, items, events, agent, mandate, cart_mandate } = data;
  const proto = PROTOCOL_META[order.protocol];

  return (
    <>
      <Link href="/orders" className="back">
        <ArrowLeft size={16} /> All orders
      </Link>

      <motion.section className="order-hero" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <AgentAvatar protocol={order.protocol} size={52} />
        <div className="order-hero-main">
          <p>
            {agent.name} wanted to buy {items.length} item{items.length === 1 ? '' : 's'} via {proto.short}
          </p>
          <h1>{formatPaise(order.total_paise)}</h1>
          <span className="muted">
            {formatDateTime(order.created_at)} · <span className="mono">{order.id}</span>
          </span>
        </div>
        <div className="order-hero-status">
          <StatusPill status={order.status} />
          <span className="muted small">{STATUS_META[order.status].help}</span>
        </div>
      </motion.section>

      <Stepper detail={data} />

      {order.status === 'in_review' && (
        <div className="card attention-card">
          <ReviewBar id={order.id} onDone={reload} />
        </div>
      )}
      {order.status === 'pending_approval' && (
        <div className="notice notice-warn">
          <Hand size={18} />
          <div>
            <strong>Waiting for the shopper.</strong> {agent.name} gave the shopper an approval link. You can open it to see what they see.
          </div>
          <a className="btn btn-soft btn-sm" href={data.shopper_link} target="_blank" rel="noreferrer">
            Open shopper view <ExternalLink size={14} />
          </a>
        </div>
      )}

      <Reveal className="grid-main">
        <div className="stack">
          <Card title="Why this happened" subtitle={order.decision.summary} action={<OutcomePill outcome={order.decision.outcome} />}>
            <DecisionChecklist checks={order.decision.checks} />
          </Card>

          <Card title="What was in the cart" pad={false}>
            <ul className="cart-lines">
              {items.map((i) => (
                <li key={i.line_no}>
                  <CategoryIcon category={i.category} />
                  <span className="cart-line-main">
                    <strong>{i.name}</strong>
                    <small>
                      {titleCase(i.category)}
                      {i.tags
                        .filter((t) => t.startsWith('contains:'))
                        .map((t) => (
                          <span key={t} className="tag tag-warn">
                            {t.replace('contains:', 'contains ')}
                          </span>
                        ))}
                    </small>
                  </span>
                  <span className="cart-line-qty">
                    {i.quantity} × {formatPaise(i.unit_price_paise)}
                  </span>
                  <strong className="cart-line-total">{formatPaise(i.line_total_paise)}</strong>
                </li>
              ))}
              <li className="cart-total">
                <span>Total</span>
                <strong>{formatPaise(order.total_paise)}</strong>
              </li>
            </ul>
          </Card>
        </div>

        <div className="stack">
          <Card title="Order details">
            <dl className="facts">
              <dt>AI assistant</dt>
              <dd>
                {agent.name} ({agent.platform})
              </dd>
              <dt>Shopper</dt>
              <dd>{order.buyer_ref ?? 'Not identified'}</dd>
              <dt>
                <Term tip={GLOSSARY.rule}>Spending rule</Term>
              </dt>
              <dd>{mandate ? <Link href="/rules">{mandate.label}</Link> : 'None. The agent had no permission to spend'}</dd>
              <dt>Payment</dt>
              <dd>{order.paid_at ? `Paid ${formatDateTime(order.paid_at)}` : order.payment_ref ? 'Payment started' : 'Not started'}</dd>
            </dl>
          </Card>
          <Card title="History">
            <Timeline events={events} />
          </Card>
          <Disclosure title="Technical details (for developers)">
            <dl className="facts">
              <dt>Protocol</dt>
              <dd>{proto.name}</dd>
              <dt>Cart hash</dt>
              <dd className="mono break">{order.cart_hash}</dd>
              {order.payment_ref && (
                <>
                  <dt>Payment ref</dt>
                  <dd className="mono break">{order.payment_ref}</dd>
                </>
              )}
            </dl>
            {cart_mandate?.decoded && (
              <>
                <p className="small muted">
                  <Term tip={GLOSSARY.receipt}>Signed cart approval</Term> (ES256 JWT). Payment only goes through if this signature, the cart
                  hash and the one-time ID all match.
                </p>
                <pre className="code">{JSON.stringify(cart_mandate.decoded, null, 2)}</pre>
                <CopyButton value={cart_mandate.token} label="Copy signed token" />
              </>
            )}
          </Disclosure>
        </div>
      </Reveal>
    </>
  );
}

/** Where this order is in its life: asked → checked → decided → paid. */
function Stepper({ detail }: { detail: OrderDetail }) {
  const { order } = detail;
  const stopped = ['blocked', 'rejected', 'expired', 'cancelled'].includes(order.status);
  const waiting = order.status === 'pending_approval' || order.status === 'in_review';
  const steps: { label: string; icon: LucideIcon; state: 'done' | 'current' | 'todo' | 'stopped' }[] = [
    { label: 'Agent asked', icon: Bot, state: 'done' },
    { label: 'Rules checked', icon: ListChecks, state: 'done' },
    {
      label: waiting ? (order.status === 'in_review' ? 'Waiting for you' : 'Waiting for shopper') : stopped ? STATUS_META[order.status].label : 'Approved',
      icon: stopped ? Ban : waiting ? (order.status === 'in_review' ? ScanEye : Hand) : CircleCheck,
      state: stopped ? 'stopped' : waiting ? 'current' : 'done',
    },
    {
      label: order.status === 'paid' ? 'Paid' : 'Payment',
      icon: CreditCard,
      state: order.status === 'paid' ? 'done' : order.status === 'awaiting_payment' ? 'current' : 'todo',
    },
  ];
  return (
    <ol className="stepper">
      {steps.map((s, i) => (
        <motion.li key={i} className={`stepper-step ${s.state}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 * i }}>
          <span className="stepper-icon">
            <s.icon size={18} strokeWidth={2.2} />
          </span>
          <span>{s.label}</span>
          {i < steps.length - 1 && (
            <span className="stepper-line">
              <motion.span initial={{ scaleX: 0 }} animate={{ scaleX: s.state === 'done' && steps[i + 1]!.state !== 'todo' ? 1 : 0 }} transition={{ delay: 0.15 + 0.12 * i, duration: 0.4 }} />
            </span>
          )}
        </motion.li>
      ))}
    </ol>
  );
}
