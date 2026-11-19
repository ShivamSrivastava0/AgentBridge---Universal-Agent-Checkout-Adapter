import type { AutonomyLevel, OrderStatus } from './format';

export type Protocol = 'acp' | 'mcp' | 'ap2';
export type CheckResult = 'pass' | 'escalate' | 'review' | 'block';

export interface PolicyCheck {
  rule: string;
  result: CheckResult;
  message: string;
  line_no?: number;
}

export interface PolicyDecision {
  outcome: 'approve' | 'needs_approval' | 'review' | 'block';
  requires_user_approval: boolean;
  risk_score: number;
  checks: PolicyCheck[];
  summary: string;
}

export interface OrderListItem {
  id: string;
  protocol: Protocol;
  status: OrderStatus;
  total_paise: number;
  currency: string;
  risk_score: number;
  created_at: string;
  buyer_ref: string | null;
  outcome: PolicyDecision['outcome'];
  summary: string;
  agent_id: string;
  agent_name: string;
  agent_platform: string;
  mandate_label: string | null;
  item_count: number;
}

export interface OrderItem {
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

export interface OrderEvent {
  id?: number;
  type: string;
  actor: string;
  data?: Record<string, unknown>;
  created_at: string;
}

export interface OrderDetail {
  order: {
    id: string;
    protocol: Protocol;
    status: OrderStatus;
    subtotal_paise: number;
    total_paise: number;
    currency: string;
    cart_hash: string;
    buyer_ref: string | null;
    intent_mandate_id: string | null;
    cart_mandate_jti: string | null;
    risk_score: number;
    decision: PolicyDecision;
    payment_provider: string | null;
    payment_ref: string | null;
    payment_id: string | null;
    approval_expires_at: string | null;
    paid_at: string | null;
    created_at: string;
  };
  cart_mandate: { token: string; decoded: { header: Record<string, unknown>; payload: Record<string, unknown> } | null } | null;
  items: OrderItem[];
  events: OrderEvent[];
  agent: { id: string; name: string; platform: string; protocol: Protocol };
  mandate: { id: string; label: string; subject: string; max_order_paise: number; budget_paise: number } | null;
  shopper_link: string;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  brand: string | null;
  category: string;
  unit: string;
  price_paise: number;
  currency: string;
  stock: number;
  tags: string[];
  active: boolean;
}

export interface Mandate {
  id: string;
  label: string;
  subject: string;
  agent_id: string | null;
  max_order_paise: number;
  budget_paise: number;
  currency: string;
  category_rules: Record<string, AutonomyLevel>;
  default_level: AutonomyLevel;
  blocked_tags: string[];
  escalate_new_items: boolean;
  token: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  spent_paise: number;
  orders: number;
}

export interface Agent {
  id: string;
  name: string;
  platform: string;
  protocol: Protocol;
  status: string;
  key_prefix: string;
  last_seen_at: string | null;
  orders: number;
  paid_volume_paise: number;
  blocked: number;
}

export interface Stats {
  totals: {
    orders: number;
    paid_orders: number;
    paid_volume_paise: number;
    blocked: number;
    in_review: number;
    pending_approval: number;
    auto_approved: number;
    protected_paise: number;
  };
  by_protocol: { protocol: Protocol; orders: number; paid_volume_paise: number }[];
  by_outcome: { outcome: string; orders: number }[];
  daily: { day: string; orders: number; paid_volume_paise: number }[];
  top_rules: { rule: string; hits: number }[];
  low_stock: { id: string; name: string; stock: number }[];
  payments_mode: 'simulated' | 'razorpay';
}
