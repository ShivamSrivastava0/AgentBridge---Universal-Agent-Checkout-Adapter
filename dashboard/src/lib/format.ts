const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
const inrCompact = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

export const formatPaise = (p: number) => inr.format(p / 100);
export const formatPaiseShort = (p: number) => inrCompact.format(p / 100);

export function timeAgo(iso: string | Date): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function formatDateTime(iso: string | Date): string {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export type OrderStatus =
  | 'blocked'
  | 'pending_approval'
  | 'in_review'
  | 'awaiting_payment'
  | 'paid'
  | 'rejected'
  | 'expired'
  | 'cancelled';

export const STATUS_META: Record<OrderStatus, { label: string; tone: 'good' | 'warn' | 'bad' | 'info' | 'muted' }> = {
  paid: { label: 'Paid', tone: 'good' },
  awaiting_payment: { label: 'Awaiting payment', tone: 'info' },
  pending_approval: { label: 'Needs user approval', tone: 'warn' },
  in_review: { label: 'In fraud review', tone: 'bad' },
  blocked: { label: 'Blocked by mandate', tone: 'bad' },
  rejected: { label: 'Rejected', tone: 'muted' },
  expired: { label: 'Expired', tone: 'muted' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
};

export const AUTONOMY_LEVELS = ['auto', 'confirm', 'shortlist', 'block'] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

export const AUTONOMY_META: Record<AutonomyLevel, { label: string; help: string }> = {
  auto: { label: 'Auto-buy', help: 'Agent may buy repeat items within limits' },
  confirm: { label: 'Confirm', help: 'User approves each order with one tap' },
  shortlist: { label: 'Shortlist only', help: 'Taste-driven: agent suggests, user picks' },
  block: { label: 'Never', help: 'Agent may not buy this category' },
};

export const RULE_LABELS: Record<string, string> = {
  'mandate.present': 'Mandate',
  'mandate.agent': 'Agent binding',
  'mandate.currency': 'Currency',
  'mandate.budget': 'Budget',
  'mandate.order_cap': 'Per-order cap',
  'mandate.blocked_tag': 'Health / safety tag',
  'autonomy.category': 'Category autonomy',
  'autonomy.new_item': 'New item',
  'risk.high_value': 'High value',
  'risk.velocity': 'Velocity',
  'risk.quantity': 'Unusual quantity',
};

export const CATEGORY_LABELS: Record<string, string> = {
  staples: 'Staples',
  dairy: 'Dairy & eggs',
  produce: 'Fruit & veg',
  snacks: 'Snacks',
  beverages: 'Beverages',
  personal_care: 'Personal care',
  household: 'Household',
  health: 'Health (OTC)',
  baby: 'Baby',
  footwear: 'Footwear',
  apparel: 'Apparel',
  electronics: 'Electronics',
};

export const titleCase = (s: string) => CATEGORY_LABELS[s] ?? s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
