'use client';

import { AnimatePresence, motion } from 'motion/react';
import { Ban, Clock, CreditCard, Lock, ScanEye, ShieldCheck } from 'lucide-react';
import Script from 'next/script';
import { use, useCallback, useEffect, useState } from 'react';
import { AgentAvatar, CategoryIcon, StatusPill } from '@/components/icons';
import { DecisionChecklist } from '@/components/ui';
import { ApiError, request } from '@/lib/api';
import { formatDateTime, formatPaise, titleCase, type OrderStatus } from '@/lib/format';
import type { OrderItem, PolicyDecision, Protocol } from '@/lib/types';

interface ShopperOrder {
  id: string;
  status: OrderStatus;
  protocol: Protocol;
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

/** Where an AI agent sends its user to approve, pay or decline an order. */
export default function ShopperOrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ t?: string }> }) {
  const { id } = use(params);
  const { t: token = '' } = use(searchParams);
  const [order, setOrder] = useState<ShopperOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
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
        if (!cancelled) setError(e instanceof ApiError && e.status === 403 ? 'This link is invalid or has been changed.' : e instanceof Error ? e.message : 'Failed to load');
      });
    return () => {
      cancelled = true;
    };
  }, [id, token, version]);

  const act = async (name: string, path: string, body?: unknown) => {
    setBusy(name);
    setError(null);
    try {
      await request(`/api/shop/orders/${id}/${path}`, { method: 'POST', headers: { 'x-order-token': token }, body: body ? JSON.stringify(body) : undefined });
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
      theme: { color: '#1f6b52' },
    }).open();
  };

  return (
    <div className="shop">
      <header className="shop-brand">
        <span className="brand-mark" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </span>
        <b>Northstar Essentials</b>
        <span className="shop-secure">
          <Lock size={13} /> Secured by AgentBridge
        </span>
      </header>

      <motion.main className="shop-card" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        {!order ? (
          error ? (
            <div className="shop-state">
              <Ban size={32} className="text-bad" />
              <b>Can’t open this order</b>
              <span className="muted">{error}</span>
            </div>
          ) : (
            <div className="shop-state">
              <span className="spinner" />
            </div>
          )
        ) : (
          <>
            {order.payment.mode === 'razorpay' && <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" />}
            <div className="shop-head">
              <AgentAvatar protocol={order.protocol} size={44} />
              <div>
                <span className="muted small">{order.agent?.name ?? 'Your assistant'} wants to buy</span>
                <h1>{formatPaise(order.total_paise)}</h1>
              </div>
              <StatusPill status={order.status} size="sm" />
            </div>

            <ul className="shop-items">
              {order.items.map((i) => (
                <li key={i.line_no}>
                  <CategoryIcon category={i.category} size={16} />
                  <span className="grow">
                    <b>
                      {i.quantity} × {i.name}
                    </b>
                    <small>{titleCase(i.category)}</small>
                  </span>
                  <span className="mono">{formatPaise(i.line_total_paise)}</span>
                </li>
              ))}
            </ul>

            <AnimatePresence mode="wait">
              <motion.div key={order.status} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.25 }}>
                {order.status === 'pending_approval' && (
                  <>
                    <h2 className="shop-why-title">Why we’re asking you</h2>
                    <DecisionChecklist checks={order.decision.checks} onlyIssues />
                    {order.approval_expires_at && (
                      <p className="muted small row-inline">
                        <Clock size={14} /> Approve before {formatDateTime(order.approval_expires_at)}
                      </p>
                    )}
                    <div className="shop-actions">
                      <button className="btn btn-ghost" disabled={!!busy} onClick={() => act('decline', 'decline')}>
                        {busy === 'decline' ? 'Declining…' : 'No, decline'}
                      </button>
                      <button className="btn btn-primary btn-lg" disabled={!!busy} onClick={() => act('approve', 'approve')}>
                        <ShieldCheck size={17} /> {busy === 'approve' ? 'Approving…' : 'Yes, approve'}
                      </button>
                    </div>
                  </>
                )}

                {order.status === 'awaiting_payment' && (
                  <>
                    <div className="notice notice-good">
                      <ShieldCheck size={18} />
                      <div>
                        <strong>Approved.</strong> A one-time approval was signed for exactly these items. Pay to place the order.
                      </div>
                    </div>
                    <div className="shop-actions">
                      <button className="btn btn-ghost" disabled={!!busy} onClick={() => act('decline', 'decline')}>
                        Cancel
                      </button>
                      <button className="btn btn-primary btn-lg" disabled={!!busy} onClick={order.payment.mode === 'razorpay' ? payWithRazorpay : () => act('pay', 'pay/simulate')}>
                        <CreditCard size={17} /> {busy === 'pay' ? 'Paying…' : `Pay ${formatPaise(order.total_paise)}`}
                        {order.payment.mode !== 'razorpay' && <small className="btn-note">test mode</small>}
                      </button>
                    </div>
                  </>
                )}

                {order.status === 'paid' && (
                  <div className="shop-success">
                    <SuccessCheck />
                    <b>Payment received. You’re all set!</b>
                    <span className="muted">Your order is confirmed and will be delivered soon.</span>
                  </div>
                )}

                {order.status === 'in_review' && (
                  <div className="notice notice-warn">
                    <ScanEye size={18} />
                    <div>
                      <strong>The store is double-checking this order.</strong> You’ll be asked to approve it if it’s cleared.
                    </div>
                  </div>
                )}

                {['blocked', 'rejected', 'expired', 'cancelled'].includes(order.status) && (
                  <div className="notice notice-bad">
                    <Ban size={18} />
                    <div>
                      <strong>This order won’t go ahead.</strong> {order.decision.outcome === 'block' ? order.decision.summary : `It was ${order.status}.`}
                    </div>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
            {error && <p className="text-bad small">{error}</p>}
          </>
        )}
      </motion.main>
      {order?.mandate_label && <p className="shop-foot muted small">Placed under your spending rule “{order.mandate_label}”.</p>}
    </div>
  );
}

function SuccessCheck() {
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" aria-hidden="true">
      <motion.circle cx="36" cy="36" r="32" fill="none" stroke="var(--good)" strokeWidth="4" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.5 }} />
      <motion.path d="M22 37 l10 10 l19 -21" fill="none" stroke="var(--good)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.4, delay: 0.45 }} />
    </svg>
  );
}
