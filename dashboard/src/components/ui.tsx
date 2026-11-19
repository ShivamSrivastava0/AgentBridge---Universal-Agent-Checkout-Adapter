'use client';

import { useState, type ReactNode } from 'react';
import { RULE_LABELS, STATUS_META, formatDateTime, type OrderStatus } from '@/lib/format';
import type { OrderEvent, PolicyCheck, Protocol } from '@/lib/types';

export function PageHeader({ kicker, title, description, actions }: { kicker: string; title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <section className="page-heading">
      <div>
        <p className="eyebrow">
          {kicker} <span className="eyebrow-rule" />
        </p>
        <h1>{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </section>
  );
}

export function Card({ title, kicker, action, children, className = '' }: { title?: string; kicker?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`section-block ${className}`}>
      {(title || action) && (
        <div className="section-heading">
          <div>
            {kicker && <p className="section-kicker">{kicker}</p>}
            {title && <h2>{title}</h2>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatusBadge({ status }: { status: OrderStatus }) {
  const meta = STATUS_META[status] ?? { label: status, tone: 'muted' as const };
  return (
    <span className={`badge tone-${meta.tone}`}>
      <span className="dot" />
      {meta.label}
    </span>
  );
}

export function ProtocolTag({ protocol }: { protocol: Protocol }) {
  return <span className={`protocol-tag protocol-${protocol}`}>{protocol.toUpperCase()}</span>;
}

const RESULT_LABEL: Record<PolicyCheck['result'], string> = { pass: 'Pass', escalate: 'Ask user', review: 'Review', block: 'Block' };

/** The explanation of a policy decision: one row per rule evaluated. */
export function DecisionTrace({ checks, showPasses = true }: { checks: PolicyCheck[]; showPasses?: boolean }) {
  const rows = showPasses ? checks : checks.filter((c) => c.result !== 'pass');
  if (rows.length === 0) return <p className="muted small">Every rule passed.</p>;
  return (
    <ul className="trace">
      {rows.map((c, i) => (
        <li key={i} className={`trace-row result-${c.result}`}>
          <span className="trace-result">{RESULT_LABEL[c.result]}</span>
          <span className="trace-body">
            <strong>{RULE_LABELS[c.rule] ?? c.rule}</strong>
            <span>{c.message}</span>
          </span>
          <code className="trace-rule">{c.rule}</code>
        </li>
      ))}
    </ul>
  );
}

const EVENT_LABELS: Record<string, string> = {
  'order.created': 'Order placed by agent',
  'policy.evaluated': 'Policy evaluated',
  'cart_mandate.issued': 'Cart mandate signed (ES256)',
  'payment.captured': 'Payment captured',
  'order.approved_by_user': 'Approved by user',
  'order.declined_by_user': 'Declined by user',
  'review.approved': 'Cleared by merchant review',
  'review.rejected': 'Rejected in merchant review',
  'order.cancelled': 'Cancelled',
  'order.expired': 'Approval window expired',
};

export function Timeline({ events }: { events: OrderEvent[] }) {
  return (
    <ol className="timeline">
      {events.map((e, i) => (
        <li key={e.id ?? i}>
          <span className="timeline-dot" />
          <div>
            <strong>{EVENT_LABELS[e.type] ?? e.type}</strong>
            <span className="muted small">
              {formatDateTime(e.created_at)} · {e.actor}
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard blocked; ignore */
        }
      }}
    >
      {done ? 'Copied' : label}
    </button>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children && <span>{children}</span>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="alert alert-bad" role="alert">
      <div>
        <strong>Couldn’t load this.</strong> <span>{error.message}</span>
      </div>
      {onRetry && (
        <button className="btn btn-sm" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="skeleton" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} />
      ))}
    </div>
  );
}

export function Meter({ value, max, tone }: { value: number; max: number; tone?: 'warn' | 'bad' }) {
  const pct = Math.min(100, max > 0 ? (value / max) * 100 : 0);
  const t = tone ?? (pct > 90 ? 'bad' : pct > 70 ? 'warn' : undefined);
  return (
    <span className={`meter ${t ? `meter-${t}` : ''}`} role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <span style={{ width: `${pct}%` }} />
    </span>
  );
}
