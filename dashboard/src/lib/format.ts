const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
const inrCompact = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

export const formatPaise = (p: number) => inr.format(p / 100);
export const formatPaiseShort = (p: number) => inrCompact.format(p / 100);

export function timeAgo(iso: string | Date): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function formatDateTime(iso: string | Date): string {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
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

export type Tone = 'good' | 'warn' | 'bad' | 'info' | 'muted';

/** Status in words a merchant understands, plus one line of "what this means". */
export const STATUS_META: Record<OrderStatus, { label: string; tone: Tone; help: string }> = {
  paid: { label: 'Paid', tone: 'good', help: 'Payment received. The order is confirmed.' },
  awaiting_payment: { label: 'Awaiting payment', tone: 'info', help: 'Approved. Waiting for the shopper to pay.' },
  pending_approval: { label: 'Waiting for shopper', tone: 'warn', help: 'The agent couldn’t buy this alone, so the shopper has to approve it.' },
  in_review: { label: 'Needs your review', tone: 'bad', help: 'This order looked risky. You decide whether it goes ahead.' },
  blocked: { label: 'Blocked', tone: 'bad', help: 'It broke the shopper’s spending rules, so it was stopped automatically.' },
  rejected: { label: 'Rejected', tone: 'muted', help: 'Declined by the shopper or by you.' },
  expired: { label: 'Expired', tone: 'muted', help: 'Nobody approved it in time.' },
  cancelled: { label: 'Cancelled', tone: 'muted', help: 'The agent cancelled it.' },
};

export type Outcome = 'approve' | 'needs_approval' | 'review' | 'block';
export const OUTCOME_META: Record<Outcome, { label: string; tone: Tone; help: string }> = {
  approve: { label: 'Bought automatically', tone: 'good', help: 'Everything was within the shopper’s rules.' },
  needs_approval: { label: 'Asked the shopper', tone: 'warn', help: 'Something needed a human yes.' },
  review: { label: 'Flagged for review', tone: 'bad', help: 'Risk checks held it for you.' },
  block: { label: 'Blocked', tone: 'bad', help: 'It broke a rule the shopper set.' },
};

export const AUTONOMY_LEVELS = ['auto', 'confirm', 'shortlist', 'block'] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

export const AUTONOMY_META: Record<AutonomyLevel, { label: string; short: string; help: string; tone: Tone }> = {
  auto: { label: 'Buy automatically', short: 'Auto', help: 'Repeat items within budget. No need to ask.', tone: 'good' },
  confirm: { label: 'Ask me first', short: 'Ask', help: 'The agent builds the cart; the shopper taps approve.', tone: 'info' },
  shortlist: { label: 'Only suggest', short: 'Suggest', help: 'Taste-driven items. The agent suggests, the shopper picks.', tone: 'warn' },
  block: { label: 'Never buy', short: 'Never', help: 'The agent may not buy this at all.', tone: 'bad' },
};

/** Every rule the policy engine can apply, in plain language. */
export const RULE_META: Record<string, { label: string; help: string }> = {
  'mandate.present': { label: 'Permission to spend', help: 'Did the agent carry a signed spending rule from the shopper?' },
  'mandate.agent': { label: 'Right agent', help: 'Was this spending rule given to this particular agent?' },
  'mandate.currency': { label: 'Currency', help: 'Is the cart in the same currency as the budget?' },
  'mandate.budget': { label: 'Total budget', help: 'Is there enough budget left for this order?' },
  'mandate.order_cap': { label: 'Per-order limit', help: 'Is the order below the most the agent may spend at once?' },
  'mandate.blocked_tag': { label: 'Health & safety', help: 'Does any item contain something the household avoids, like peanuts?' },
  'autonomy.category': { label: 'Allowed to buy this', help: 'May the agent buy this kind of product on its own?' },
  'autonomy.new_item': { label: 'Bought before', help: 'Has this household bought this item before? New items need a yes.' },
  'risk.high_value': { label: 'Large order', help: 'Is the order unusually expensive?' },
  'risk.velocity': { label: 'Ordering too fast', help: 'Is this agent placing many orders in a short time?' },
  'risk.quantity': { label: 'Unusual quantity', help: 'Is an item being bought in a suspiciously large amount?' },
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

export const PROTOCOL_META = {
  acp: { agent: 'ChatGPT', company: 'OpenAI', name: 'Agentic Commerce Protocol', short: 'ACP' },
  mcp: { agent: 'Claude', company: 'Anthropic', name: 'Model Context Protocol', short: 'MCP' },
  ap2: { agent: 'Gemini', company: 'Google', name: 'Agent Payments Protocol', short: 'AP2' },
} as const;

export const GLOSSARY = {
  rule: 'A spending rule (technically an “intent mandate”) is a digitally signed permission a shopper gives an AI agent: how much it may spend, what it may buy on its own and what it must never buy. Agents can’t edit it, because any change breaks the signature.',
  receipt: 'A signed cart approval (“cart mandate”) covers one exact cart. If anyone changes the cart after approval, or tries to reuse it, payment is refused.',
  protocols: 'ACP, MCP and AP2 are the three “languages” AI assistants use to shop. AgentBridge speaks all three, so you only integrate once.',
  review: 'Large or unusually fast orders are held for you to check before any money moves. Their stock stays reserved while you decide.',
  autoRate: 'The share of orders the agent completed on its own because everything was within the shopper’s rules.',
} as const;
