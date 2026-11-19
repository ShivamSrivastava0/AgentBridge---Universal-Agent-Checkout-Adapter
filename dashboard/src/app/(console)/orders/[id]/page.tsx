'use client';

import Link from 'next/link';
import { use } from 'react';
import { Card, CopyButton, DecisionTrace, ErrorState, PageHeader, ProtocolTag, Skeleton, StatusBadge, Timeline } from '@/components/ui';
import { ReviewBar } from '@/components/ReviewBar';
import { useAdmin, useLiveReload } from '@/lib/api';
import { formatDateTime, formatPaise, titleCase } from '@/lib/format';
import type { OrderDetail } from '@/lib/types';

export default function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, reload } = useAdmin<OrderDetail>(`/orders/${id}`);
  useLiveReload(reload, (e) => e.order_id === id);

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Skeleton rows={8} />;
  const { order, items, events, agent, mandate, cart_mandate } = data;
  const d = order.decision;

  return (
    <>
      <Link href="/orders" className="back-link">
        ← Orders
      </Link>
      <PageHeader
        kicker={`${order.protocol.toUpperCase()} ORDER`}
        title={formatPaise(order.total_paise)}
        description={
          <>
            <span className="mono">{order.id}</span> · placed {formatDateTime(order.created_at)} by {agent.name} ({agent.platform})
          </>
        }
        actions={<StatusBadge status={order.status} />}
      />

      {order.status === 'in_review' && <ReviewBar id={order.id} onDone={reload} />}
      {order.status === 'pending_approval' && (
        <div className="alert alert-warn">
          <div>
            <strong>Waiting for the shopper.</strong> The agent was given an approval link. Open it to act as the shopper.
          </div>
          <a className="btn btn-sm" href={data.shopper_link} target="_blank" rel="noreferrer">
            Open shopper link ↗
          </a>
        </div>
      )}

      <div className="grid-2-1">
        <div className="stack">
          <Card kicker="POLICY ENGINE" title="Why this happened" action={<span className={`outcome outcome-${d.outcome}`}>Policy: {d.outcome.replace('_', ' ')}</span>}>
            <div className="card-body">
              <p className="decision-summary">{d.summary}</p>
              <DecisionTrace checks={d.checks} />
              {d.risk_score > 0 && <p className="muted small">Risk score: {d.risk_score}/100</p>}
            </div>
          </Card>

          <Card kicker="CART" title={`${items.length} line item${items.length === 1 ? '' : 's'}`}>
            <div className="table-frame">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Category</th>
                    <th className="num">Qty</th>
                    <th className="num">Price</th>
                    <th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.line_no}>
                      <td>
                        <strong>{i.name}</strong>
                        <span className="sub mono">{i.sku}</span>
                        {i.tags.length > 0 && (
                          <span className="tags">
                            {i.tags.map((t) => (
                              <span key={t} className={`tag ${t.startsWith('contains:') ? 'tag-warn' : ''}`}>
                                {t}
                              </span>
                            ))}
                          </span>
                        )}
                      </td>
                      <td>{titleCase(i.category)}</td>
                      <td className="num">{i.quantity}</td>
                      <td className="num mono">{formatPaise(i.unit_price_paise)}</td>
                      <td className="num mono">{formatPaise(i.line_total_paise)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4}>Total</td>
                    <td className="num mono strong">{formatPaise(order.total_paise)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>

          {cart_mandate?.decoded && (
            <Card kicker="AP2 · CRYPTOGRAPHY" title="Signed cart mandate" action={<CopyButton value={cart_mandate.token} label="Copy JWT" />}>
              <div className="card-body">
                <p className="muted small">
                  Single-use, ES256-signed authorisation bound to this exact cart (sha256 hash). Settlement re-computes the hash from the
                  stored items and refuses if anything changed or the token was used before.
                </p>
                <pre className="code">{JSON.stringify(cart_mandate.decoded, null, 2)}</pre>
              </div>
            </Card>
          )}
        </div>

        <div className="stack">
          <Card kicker="DETAILS" title="Order facts">
            <dl className="facts">
              <dt>Channel</dt>
              <dd>
                <ProtocolTag protocol={order.protocol} /> {agent.name}
              </dd>
              <dt>Buyer</dt>
              <dd className="mono">{order.buyer_ref ?? '—'}</dd>
              <dt>Mandate</dt>
              <dd>{mandate ? <Link href="/mandates">{mandate.label}</Link> : 'None presented'}</dd>
              <dt>Cart hash</dt>
              <dd className="mono truncate" title={order.cart_hash}>
                {order.cart_hash.slice(0, 20)}…
              </dd>
              <dt>Payment</dt>
              <dd>{order.payment_provider ? `${order.payment_provider}${order.payment_id ? ` · ${order.payment_id}` : ''}` : '—'}</dd>
              {order.approval_expires_at && (
                <>
                  <dt>Expires</dt>
                  <dd>{formatDateTime(order.approval_expires_at)}</dd>
                </>
              )}
            </dl>
          </Card>
          <Card kicker="AUDIT TRAIL" title="Timeline">
            <div className="card-body">
              <Timeline events={events} />
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
