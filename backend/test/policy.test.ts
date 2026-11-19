import { describe, expect, it } from 'vitest';
import type { IntentMandateClaims, Quote } from '../src/domain/types.js';
import { evaluatePolicy, type PolicyInput } from '../src/trust/policy.js';

const line = (id: string, category: string, price: number, qty = 1, tags: string[] = []) => ({
  line_no: 1,
  product_id: id,
  sku: id,
  name: id,
  category,
  tags,
  unit_price_paise: price,
  quantity: qty,
  line_total_paise: price * qty,
});

function quote(lines: ReturnType<typeof line>[]): Quote {
  const total = lines.reduce((s, l) => s + l.line_total_paise, 0);
  return { merchant_id: 'm', currency: 'INR', lines: lines.map((l, i) => ({ ...l, line_no: i + 1 })), subtotal_paise: total, total_paise: total, cart_hash: 'h' };
}

const mandate: IntentMandateClaims = {
  mandate_id: 'man_1',
  merchant_id: 'm',
  subject: 'u',
  agent_id: null,
  max_order_paise: 300_000,
  budget_paise: 1_000_000,
  currency: 'INR',
  category_rules: { dairy: 'auto', footwear: 'shortlist', health: 'confirm', alcohol: 'block' },
  default_level: 'confirm',
  blocked_tags: ['contains:peanuts'],
  escalate_new_items: true,
  expires_at: new Date(Date.now() + 86_400_000).toISOString(),
};

const base = (q: Quote, over: Partial<PolicyInput> = {}): PolicyInput => ({
  quote: q,
  agentId: 'agt_1',
  mandate,
  mandateSpentPaise: 0,
  previouslyPurchased: new Set(['milk']),
  recentAgentOrders: 0,
  risk: { highValuePaise: 500_000, velocityMaxOrders: 5, velocityWindowSeconds: 300, maxLineQuantity: 20 },
  ...over,
});

describe('policy engine', () => {
  it('auto-approves repeat items in an auto category within limits', () => {
    const d = evaluatePolicy(base(quote([line('milk', 'dairy', 6800, 2)])));
    expect(d.outcome).toBe('approve');
    expect(d.requires_user_approval).toBe(false);
  });

  it('escalates a never-bought item even in an auto category', () => {
    const d = evaluatePolicy(base(quote([line('paneer', 'dairy', 9500)])));
    expect(d.outcome).toBe('needs_approval');
    expect(d.checks.some((c) => c.rule === 'autonomy.new_item')).toBe(true);
  });

  it('never lets an agent buy taste-driven items on its own (shortlist)', () => {
    const d = evaluatePolicy(base(quote([line('shoes', 'footwear', 229_900)])));
    expect(d.outcome).toBe('needs_approval');
    expect(d.summary).toMatch(/user picks/);
  });

  it('blocks items carrying a blocked health tag', () => {
    const d = evaluatePolicy(base(quote([line('milk', 'dairy', 6800), line('nuts', 'snacks', 6000, 1, ['contains:peanuts'])])));
    expect(d.outcome).toBe('block');
  });

  it('blocks blocked categories and orders over the remaining budget', () => {
    expect(evaluatePolicy(base(quote([line('wine', 'alcohol', 90_000)]))).outcome).toBe('block');
    expect(evaluatePolicy(base(quote([line('milk', 'dairy', 6800)]), { mandateSpentPaise: 999_000 })).outcome).toBe('block');
  });

  it('escalates orders above the per-order cap', () => {
    const d = evaluatePolicy(base(quote([line('milk', 'dairy', 6800, 50)]), { risk: { highValuePaise: 1e9, velocityMaxOrders: 5, velocityWindowSeconds: 300, maxLineQuantity: 100 } }));
    expect(d.outcome).toBe('needs_approval');
    expect(d.checks.find((c) => c.rule === 'mandate.order_cap')?.result).toBe('escalate');
  });

  it('blocks a mandate bound to another agent', () => {
    const d = evaluatePolicy(base(quote([line('milk', 'dairy', 6800)]), { mandate: { ...mandate, agent_id: 'agt_other' } }));
    expect(d.outcome).toBe('block');
  });

  it('sends velocity and high-value anomalies to merchant review, outranking user approval', () => {
    const v = evaluatePolicy(base(quote([line('milk', 'dairy', 6800)]), { recentAgentOrders: 5 }));
    expect(v.outcome).toBe('review');
    expect(v.risk_score).toBeGreaterThan(0);
    const h = evaluatePolicy(base(quote([line('tv', 'electronics', 900_000)]), { mandate: null }));
    expect(h.outcome).toBe('review');
    expect(h.requires_user_approval).toBe(true);
  });

  it('requires user approval when no mandate is presented', () => {
    const d = evaluatePolicy(base(quote([line('milk', 'dairy', 6800)]), { mandate: null }));
    expect(d.outcome).toBe('needs_approval');
  });
});
