'use client';

import {
  Apple,
  Baby,
  Ban,
  CircleAlert,
  CircleCheck,
  CircleX,
  Clock,
  Coffee,
  Cookie,
  Cpu,
  CreditCard,
  Footprints,
  Hand,
  Milk,
  Package,
  Pill,
  ScanEye,
  Shirt,
  Sparkles,
  SprayCan,
  Wheat,
  type LucideIcon,
} from 'lucide-react';
import { OUTCOME_META, PROTOCOL_META, STATUS_META, type OrderStatus, type Outcome } from '@/lib/format';
import type { Protocol } from '@/lib/types';

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  staples: Wheat,
  dairy: Milk,
  produce: Apple,
  snacks: Cookie,
  beverages: Coffee,
  personal_care: Sparkles,
  household: SprayCan,
  health: Pill,
  baby: Baby,
  footwear: Footprints,
  apparel: Shirt,
  electronics: Cpu,
};

export function CategoryIcon({ category, size = 18 }: { category: string; size?: number }) {
  const Icon = CATEGORY_ICONS[category] ?? Package;
  return (
    <span className={`cat-icon cat-${category}`} aria-hidden="true">
      <Icon size={size} strokeWidth={1.8} />
    </span>
  );
}

const STATUS_ICONS: Record<OrderStatus, LucideIcon> = {
  paid: CircleCheck,
  awaiting_payment: CreditCard,
  pending_approval: Hand,
  in_review: ScanEye,
  blocked: Ban,
  rejected: CircleX,
  expired: Clock,
  cancelled: CircleX,
};

export function StatusPill({ status, size = 'md' }: { status: OrderStatus; size?: 'sm' | 'md' }) {
  const meta = STATUS_META[status];
  const Icon = STATUS_ICONS[status] ?? CircleAlert;
  return (
    <span className={`pill tone-${meta.tone} pill-${size}`} title={meta.help}>
      <Icon size={size === 'sm' ? 13 : 15} strokeWidth={2.2} />
      {meta.label}
    </span>
  );
}

const OUTCOME_ICONS: Record<Outcome, LucideIcon> = { approve: CircleCheck, needs_approval: Hand, review: ScanEye, block: Ban };

export function OutcomePill({ outcome }: { outcome: Outcome }) {
  const meta = OUTCOME_META[outcome];
  const Icon = OUTCOME_ICONS[outcome];
  return (
    <span className={`pill tone-${meta.tone}`} title={meta.help}>
      <Icon size={15} strokeWidth={2.2} />
      {meta.label}
    </span>
  );
}

/** Round avatar for an agent platform, colour-coded by protocol. */
export function AgentAvatar({ protocol, size = 36 }: { protocol: Protocol; size?: number }) {
  const meta = PROTOCOL_META[protocol];
  return (
    <span className={`agent-avatar av-${protocol}`} style={{ width: size, height: size, fontSize: size * 0.42 }} title={`${meta.agent} via ${meta.name}`}>
      {meta.agent[0]}
    </span>
  );
}

export function ProtocolChip({ protocol }: { protocol: Protocol }) {
  const meta = PROTOCOL_META[protocol];
  return (
    <span className={`proto-chip proto-${protocol}`} title={meta.name}>
      {meta.short}
    </span>
  );
}
