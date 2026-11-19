'use client';

import Script from 'next/script';
import { use, useCallback, useEffect, useState } from 'react';
import { DecisionTrace, StatusBadge } from '@/components/ui';
import { ApiError, request } from '@/lib/api';
import { formatDateTime, formatPaise, titleCase, type OrderStatus } from '@/lib/format';
import type { OrderItem, PolicyDecision } from '@/lib/types';

interface ShopperOrder {
  id: string;
  status: OrderStatus;
  protocol: string;
  total_paise: number;
  created_at: string;
  approval_expires_at: string | null;
  agent: { name: string; platform: string } | null;
  mandate_label: string | null;
  decision: PolicyDecision;
  items: OrderItem[];
  payment: { mode: 'simulated' | 'razorpay'; razorpay_key_id: string | null; razorpay_order_id: string | null };
}

declare global {
  interface Window {
    Razorpay?: new (opts: Record<string, unknown>) => { open: () => void };
  }
}

/**
 * The page an agent sends its user to. Explains what the agent wants to buy and
 * why it needs a human, then lets the user approve and pay, or decline.
 */
export default function ShopperOrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ t?: string }> }) {
  const { id } = use(params);
  const { t: token = '' } = use(searchParams);
  const [order, setOrder] = useState<ShopperOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const headers = { 'x-order-token': token };
  const [version, setVersion] = useState(0);
  const load = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let cancelled = false;
    request<ShopperOrder>(`/api/shop/orders/${id}`, { headers: { 'x-order-token': token } })
      .then((o) => {
        if (cancelled) return;
        setOrder(o);
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof ApiError && e.status === 403 ? 'This link is invalid or has been altered.' : e instanceof Error ? e.message : 'Failed to load');
      });
    return () => {
      cancelled = true;
    };
  }, [id, token, version]);

  const act = async (name: string, path: string, body?: unknown) => {
    setBusy(name);
    setError(null);
    try {
      await request(`/api/shop/orders/${id}/${path}`, { method: 'POST', headers, body: body ? JSON.stringify(body) : undefined });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  };

  const payWithRazorpay = () => {
    if (!order?.payment.razorpay_key_id || !order.payment.razorpay_order_id || !window.Razorpay) return;
    new window.Razorpay({
      key: order.payment.razorpay_key_id,
      order_id: order.payment.razorpay_order_id,
      amount: order.total_paise,
      currency: 'INR',
      name: 'Northstar Essentials',
      description: `Order ${order.id}`,
      handler: (resp: Record<string, string>) => void act('pay', 'pay/razorpay', resp),
      theme: { color: '#174e40' },
    }).open();
  };

  if (error && !order) {
    return (
      <Frame>
        <div className="alert alert-bad">
          <div>
            <strong>Can’t open this order.</strong> {error}
          </div>
        </div>
      </Frame>
    );
  }
  if (!order) return <Frame>Loading…</Frame>;

  const issues = order.decision.checks.filter((c) => c.result !== 'pass');
  return (
    <Frame>
      {order.payment.mode === 'razorpay' && <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" />}
      <p className="eyebrow">
        {order.agent ? `${order.agent.name.toUpperCase()} WANTS TO BUY` : 'ORDER'} <span className="eyebrow-rule" />
      </p>
      <div className="row space">
        <h1 className="shop-total">{formatPaise(order.total_paise)}</h1>
        <StatusBadge status={order.status} />
      </div>
      <p className="muted small">
        Northstar Essentials · {formatDateTime(order.created_at)}
        {order.mandate_label ? ` · under “${order.mandate_label}”` : ''}
      </p>

      <ul className="shop-items">
        {order.items.map((i) => (
          <li key={i.line_no}>
            <span>
              <strong>
                {i.quantity} × {i.name}
              </strong>
              <small>{titleCase(i.category)}</small>
            </span>
            <span className="mono">{formatPaise(i.line_total_paise)}</span>
          </li>
        ))}
      </ul>

      {order.status === 'pending_approval' && (
        <>
          <div className="shop-why">
            <strong>Why your approval is needed</strong>
            <DecisionTrace checks={issues} showPasses={false} />
          </div>
          {order.approval_expires_at && <p className="muted small">This request expires {formatDateTime(order.approval_expires_at)}.</p>}
          <div className="row end">
            <button className="btn" disabled={!!busy} onClick={() => act('decline', 'decline')}>
              {busy === 'decline' ? 'Declining…' : 'Decline'}
            </button>
            <button className="btn btn-primary" disabled={!!busy} onClick={() => act('approve', 'approve')}>
              {busy === 'approve' ? 'Approving…' : 'Approve order'}
            </button>
          </div>
        </>
      )}

      {order.status === 'awaiting_payment' && (
        <>
          <div className="alert alert-good">
            <div>
              <strong>Approved.</strong> A single-use cart mandate was signed for exactly these items. Complete payment to place the order.
            </div>
          </div>
          <div className="row end">
            <button className="btn" disabled={!!busy} onClick={() => act('decline', 'decline')}>
              Cancel
            </button>
            {order.payment.mode === 'razorpay' ? (
              <button className="btn btn-primary" disabled={!!busy} onClick={payWithRazorpay}>
                Pay {formatPaise(order.total_paise)} with Razorpay
              </button>
            ) : (
              <button className="btn btn-primary" disabled={!!busy} onClick={() => act('pay', 'pay/simulate')}>
                {busy === 'pay' ? 'Paying…' : `Pay ${formatPaise(order.total_paise)} (test mode)`}
              </button>
            )}
          </div>
        </>
      )}

      {order.status === 'paid' && (
        <div className="alert alert-good">
          <div>
            <strong>Paid. Thank you!</strong> Your order is confirmed and will be delivered soon.
          </div>
        </div>
      )}
      {order.status === 'in_review' && (
        <div className="alert alert-warn">
          <div>
            <strong>Under review.</strong> The store is double-checking this order. You’ll be asked to approve it if it clears.
          </div>
        </div>
      )}
      {['blocked', 'rejected', 'expired', 'cancelled'].includes(order.status) && (
        <div className="alert alert-bad">
          <div>
            <strong>This order will not go ahead.</strong> {order.decision.outcome === 'block' ? order.decision.summary : `It was ${order.status}.`}
          </div>
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="shop-page">
      <div className="shop-brand">
        <span className="brand-mark" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </span>
        <span className="brand-name">Northstar Essentials</span>
        <span className="muted small">secured by AgentBridge</span>
      </div>
      <main className="shop-card">{children}</main>
    </div>
  );
}
