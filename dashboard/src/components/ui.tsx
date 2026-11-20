'use client';

import { AnimatePresence, motion } from 'motion/react';
import {
  Ban,
  Check,
  ChevronDown,
  CircleCheck,
  Copy,
  Hand,
  HelpCircle,
  Inbox,
  RotateCcw,
  ScanEye,
  TriangleAlert,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useId, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { RULE_META, formatDateTime } from '@/lib/format';
import type { OrderEvent, PolicyCheck } from '@/lib/types';
import { ease, fadeUp, stagger } from './motion';

// ── Layout ─────────────────────────────────────────────────────────────

export function PageHeader({ title, description, actions, icon: Icon }: { title: string; description?: ReactNode; actions?: ReactNode; icon?: LucideIcon }) {
  return (
    <motion.header className="page-header" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease }}>
      <div className="page-header-text">
        <h1>
          {Icon && (
            <span className="page-icon">
              <Icon size={22} strokeWidth={2} />
            </span>
          )}
          {title}
        </h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </motion.header>
  );
}

export function Card({
  title,
  subtitle,
  action,
  children,
  className = '',
  pad = true,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  pad?: boolean;
}) {
  return (
    <motion.section className={`card ${className}`} variants={fadeUp}>
      {(title || action) && (
        <div className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      <div className={pad ? 'card-pad' : ''}>{children}</div>
    </motion.section>
  );
}

/** Grid whose children (Cards) animate in one after another. */
export function Reveal({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={className} variants={stagger(0.07)} initial="hidden" animate="show">
      {children}
    </motion.div>
  );
}

// ── Explanations ───────────────────────────────────────────────────────

/** A word with a hover/focus explanation, for jargon. */
export function Term({ children, tip }: { children: ReactNode; tip: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="term" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" className="term-btn" aria-describedby={id} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onClick={() => setOpen((v) => !v)}>
        {children}
        <HelpCircle size={13} strokeWidth={2.2} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.span
            id={id}
            role="tooltip"
            className="tooltip"
            initial={{ opacity: 0, y: 4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.97 }}
            transition={{ duration: 0.15 }}
          >
            {tip}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

const CHECK_ICON: Record<PolicyCheck['result'], LucideIcon> = { pass: CircleCheck, escalate: Hand, review: ScanEye, block: Ban };
const CHECK_WORD: Record<PolicyCheck['result'], string> = { pass: 'OK', escalate: 'Needs a yes', review: 'Review', block: 'Stopped' };

/** The policy decision as a checklist anyone can read. */
export function DecisionChecklist({ checks, onlyIssues = false }: { checks: PolicyCheck[]; onlyIssues?: boolean }) {
  // Merge repeated passing rules (one per cart line) so the list stays short.
  const rows = (onlyIssues ? checks.filter((c) => c.result !== 'pass') : checks).filter(
    (c, i, all) => c.result !== 'pass' || all.findIndex((x) => x.rule === c.rule && x.result === 'pass') === i,
  );
  if (rows.length === 0) {
    return (
      <p className="all-clear">
        <CircleCheck size={16} /> Every check passed.
      </p>
    );
  }
  return (
    <motion.ul className="checklist" variants={stagger(0.08)} initial="hidden" animate="show">
      {rows.map((c, i) => {
        const Icon = CHECK_ICON[c.result];
        const meta = RULE_META[c.rule];
        return (
          <motion.li key={`${c.rule}-${i}`} className={`check-row r-${c.result}`} variants={fadeUp}>
            <span className="check-icon">
              <Icon size={18} strokeWidth={2.2} />
            </span>
            <span className="check-text">
              <span className="check-title">
                {meta?.label ?? c.rule}
                <span className="check-word">{CHECK_WORD[c.result]}</span>
              </span>
              <span className="check-msg">{c.message}</span>
            </span>
          </motion.li>
        );
      })}
    </motion.ul>
  );
}

const EVENT_LABELS: Record<string, string> = {
  'order.created': 'Agent placed the order',
  'policy.evaluated': 'Rules checked',
  'cart_mandate.issued': 'Cart approval signed',
  'payment.captured': 'Payment received',
  'order.approved_by_user': 'Shopper approved',
  'order.declined_by_user': 'Shopper declined',
  'review.approved': 'You approved after review',
  'review.rejected': 'You rejected after review',
  'order.cancelled': 'Cancelled',
  'order.expired': 'Approval window expired',
};

export function Timeline({ events }: { events: OrderEvent[] }) {
  return (
    <motion.ol className="timeline" variants={stagger(0.06)} initial="hidden" animate="show">
      {events.map((e, i) => (
        <motion.li key={e.id ?? i} variants={fadeUp}>
          <span className="timeline-dot" />
          <div>
            <strong>{EVENT_LABELS[e.type] ?? e.type}</strong>
            <span>
              {formatDateTime(e.created_at)} · {actorLabel(e.actor)}
            </span>
          </div>
        </motion.li>
      ))}
    </motion.ol>
  );
}

function actorLabel(actor: string) {
  if (actor.startsWith('agent:')) return 'AI agent';
  if (actor.startsWith('system:')) return 'AgentBridge';
  if (actor.startsWith('webhook:')) return 'Payment provider';
  return actor === 'user' ? 'Shopper' : actor === 'merchant' ? 'You' : actor;
}

// ── Controls ───────────────────────────────────────────────────────────

export function Tabs<T extends string>({
  value,
  onChange,
  items,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { value: T; label: ReactNode; count?: number }[];
  label: string;
}) {
  const group = useId();
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {items.map((it) => (
        <button key={it.value} role="tab" aria-selected={value === it.value} className={`tab ${value === it.value ? 'active' : ''}`} onClick={() => onChange(it.value)}>
          {value === it.value && <motion.span layoutId={`tab-${group}`} className="tab-bg" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
          <span className="tab-label">
            {it.label}
            {it.count !== undefined && it.count > 0 && <span className="tab-count">{it.count}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-soft btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard blocked */
        }
      }}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={String(done)} className="row-inline" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.12 }}>
          {done ? <Check size={14} /> : <Copy size={14} />}
          {done ? 'Copied' : label}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

export function Disclosure({ title, children, defaultOpen = false }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`disclosure ${open ? 'open' : ''}`}>
      <button type="button" className="disclosure-btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span>{title}</span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown size={18} />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.28, ease }} style={{ overflow: 'hidden' }}>
            <div className="disclosure-body">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Centered dialog (variant="modal") or right-side panel (variant="drawer"). */
export function Overlay({
  open,
  onClose,
  title,
  children,
  variant = 'modal',
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  variant?: 'modal' | 'drawer';
  footer?: ReactNode;
}) {
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);
  if (!mounted) return null;
  const panel =
    variant === 'drawer'
      ? { initial: { x: '100%' }, animate: { x: 0 }, exit: { x: '100%' } }
      : { initial: { opacity: 0, y: 24, scale: 0.97 }, animate: { opacity: 1, y: 0, scale: 1 }, exit: { opacity: 0, y: 16, scale: 0.98 } };
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className={`overlay overlay-${variant}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
          <motion.div className={`overlay-panel panel-${variant}`} role="dialog" aria-modal="true" {...panel} transition={{ duration: 0.32, ease }}>
            <div className="overlay-head">
              <h2>{title}</h2>
              <button className="icon-btn" onClick={onClose} aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <div className="overlay-body">{children}</div>
            {footer && <div className="overlay-foot">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

const noopSubscribe = () => () => {};

// ── States ─────────────────────────────────────────────────────────────

export function EmptyState({ title, children, icon: Icon = Inbox, action }: { title: string; children?: ReactNode; icon?: LucideIcon; action?: ReactNode }) {
  return (
    <motion.div className="empty" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}>
      <span className="empty-icon">
        <Icon size={26} strokeWidth={1.6} />
      </span>
      <strong>{title}</strong>
      {children && <span>{children}</span>}
      {action}
    </motion.div>
  );
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="notice notice-bad" role="alert">
      <TriangleAlert size={18} />
      <div>
        <strong>Couldn’t load this.</strong> {error.message}
      </div>
      {onRetry && (
        <button className="btn btn-soft btn-sm" onClick={onRetry}>
          <RotateCcw size={14} /> Retry
        </button>
      )}
    </div>
  );
}

export function Skeleton({ rows = 3, height = 14 }: { rows?: number; height?: number }) {
  return (
    <div className="skeleton" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} style={{ height }} />
      ))}
    </div>
  );
}

export function Meter({ value, max }: { value: number; max: number }) {
  const pct = Math.min(100, max > 0 ? (value / max) * 100 : 0);
  const tone = pct > 90 ? 'bad' : pct > 70 ? 'warn' : 'good';
  return (
    <span className={`meter meter-${tone}`} role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <motion.span initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.9, ease }} />
    </span>
  );
}
