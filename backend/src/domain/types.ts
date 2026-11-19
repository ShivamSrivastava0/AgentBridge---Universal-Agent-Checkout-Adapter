import { z } from 'zod';

export const PROTOCOLS = ['acp', 'mcp', 'ap2'] as const;
export type Protocol = (typeof PROTOCOLS)[number];

/**
 * How much freedom an agent has for a category of purchase.
 *  - auto:      agent may buy within limits without asking (repeat, low-taste items)
 *  - confirm:   agent may build the cart, the user approves with one tap
 *  - shortlist: subjective purchases (shoes, clothes). Agent may only suggest; the user chooses
 *  - block:     never allowed
 */
export const AUTONOMY_LEVELS = ['auto', 'confirm', 'shortlist', 'block'] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

export const ORDER_STATUSES = [
  'blocked',
  'pending_approval',
  'in_review',
  'awaiting_payment',
  'paid',
  'rejected',
  'expired',
  'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const CartItemInput = z.object({
  product_id: z.string().min(1).max(64),
  quantity: z.number().int().min(1).max(100),
});
export type CartItemInput = z.infer<typeof CartItemInput>;

export const CartInput = z.array(CartItemInput).min(1).max(50);

export interface Product {
  id: string;
  merchant_id: string;
  sku: string;
  name: string;
  brand: string | null;
  description: string;
  category: string;
  unit: string;
  price_paise: number;
  currency: string;
  stock: number;
  tags: string[];
  active: boolean;
}

export interface Agent {
  id: string;
  name: string;
  platform: string;
  protocol: Protocol;
  status: 'active' | 'disabled';
}

export interface QuoteLine {
  line_no: number;
  product_id: string;
  sku: string;
  name: string;
  category: string;
  tags: string[];
  unit_price_paise: number;
  quantity: number;
  line_total_paise: number;
}

export interface Quote {
  merchant_id: string;
  currency: string;
  lines: QuoteLine[];
  subtotal_paise: number;
  total_paise: number;
  /** sha256 over the canonical cart; cart mandates are bound to this value. */
  cart_hash: string;
}

/** Limits carried inside a signed intent mandate. */
export interface IntentMandateClaims {
  mandate_id: string;
  merchant_id: string;
  subject: string;
  agent_id: string | null;
  max_order_paise: number;
  budget_paise: number;
  currency: string;
  category_rules: Record<string, AutonomyLevel>;
  default_level: AutonomyLevel;
  blocked_tags: string[];
  escalate_new_items: boolean;
  expires_at: string;
}

export type CheckResult = 'pass' | 'escalate' | 'review' | 'block';

export interface PolicyCheck {
  rule: string;
  result: CheckResult;
  message: string;
  line_no?: number;
}

export type PolicyOutcome = 'approve' | 'needs_approval' | 'review' | 'block';

export interface PolicyDecision {
  outcome: PolicyOutcome;
  requires_user_approval: boolean;
  risk_score: number;
  checks: PolicyCheck[];
  summary: string;
}
