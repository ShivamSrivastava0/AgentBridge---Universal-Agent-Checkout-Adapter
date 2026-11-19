import type {
  AutonomyLevel,
  CheckResult,
  IntentMandateClaims,
  PolicyCheck,
  PolicyDecision,
  PolicyOutcome,
  Quote,
} from '../domain/types.js';
import { formatPaise } from '../lib/money.js';

export interface RiskConfig {
  highValuePaise: number;
  velocityMaxOrders: number;
  velocityWindowSeconds: number;
  maxLineQuantity: number;
}

export interface PolicyInput {
  quote: Quote;
  agentId: string;
  /** Verified claims of the intent mandate, or null when the agent has none. */
  mandate: IntentMandateClaims | null;
  /** Amount already committed under this mandate (paid or in flight). */
  mandateSpentPaise: number;
  /** Products this subject has bought before. Used to escalate brand-new items. */
  previouslyPurchased: ReadonlySet<string>;
  /** Orders the same agent placed inside the velocity window. */
  recentAgentOrders: number;
  risk: RiskConfig;
}

const SEVERITY: Record<CheckResult, number> = { pass: 0, escalate: 1, review: 2, block: 3 };
const RISK_WEIGHT: Partial<Record<string, number>> = {
  'risk.high_value': 40,
  'risk.velocity': 35,
  'risk.quantity': 25,
};

/**
 * Pure, deterministic policy engine. Every decision is explained by the list of
 * checks so the merchant console and the agent can show *why*.
 *
 * Precedence: block > review (merchant fraud review) > escalate (user approval) > pass.
 */
export function evaluatePolicy(input: PolicyInput): PolicyDecision {
  const { quote, mandate, risk } = input;
  const checks: PolicyCheck[] = [];
  const add = (rule: string, result: CheckResult, message: string, line_no?: number) =>
    checks.push(line_no === undefined ? { rule, result, message } : { rule, result, message, line_no });

  // ── Mandate checks ────────────────────────────────────────────────────────
  if (!mandate) {
    add('mandate.present', 'escalate', 'No spending mandate presented. The user must approve this order.');
  } else {
    add('mandate.present', 'pass', `Signed intent mandate ${mandate.mandate_id} verified.`);

    if (mandate.agent_id && mandate.agent_id !== input.agentId) {
      add('mandate.agent', 'block', 'This mandate was granted to a different agent.');
    }
    if (mandate.currency !== quote.currency) {
      add('mandate.currency', 'block', `Mandate currency ${mandate.currency} does not match cart currency ${quote.currency}.`);
    }

    const remaining = mandate.budget_paise - input.mandateSpentPaise;
    if (quote.total_paise > remaining) {
      add(
        'mandate.budget',
        'block',
        `Cart total ${formatPaise(quote.total_paise)} exceeds remaining budget ${formatPaise(Math.max(remaining, 0))}.`,
      );
    } else {
      add('mandate.budget', 'pass', `Within budget (${formatPaise(remaining - quote.total_paise)} left after this order).`);
    }

    if (quote.total_paise > mandate.max_order_paise) {
      add(
        'mandate.order_cap',
        'escalate',
        `Cart total ${formatPaise(quote.total_paise)} is above the per-order cap of ${formatPaise(mandate.max_order_paise)}.`,
      );
    } else {
      add('mandate.order_cap', 'pass', `Under the per-order cap of ${formatPaise(mandate.max_order_paise)}.`);
    }

    // Per-line autonomy and health/safety tag rules.
    const blocked = new Set(mandate.blocked_tags);
    for (const line of quote.lines) {
      const hit = line.tags.find((t) => blocked.has(t));
      if (hit) {
        add('mandate.blocked_tag', 'block', `"${line.name}" is tagged ${hit}, which this household blocks.`, line.line_no);
        continue;
      }

      const level: AutonomyLevel = mandate.category_rules[line.category] ?? mandate.default_level;
      switch (level) {
        case 'block':
          add('autonomy.category', 'block', `Category "${line.category}" is not allowed for this agent.`, line.line_no);
          break;
        case 'shortlist':
          add(
            'autonomy.category',
            'escalate',
            `"${line.name}" is a taste-driven purchase (${line.category}). The agent may only suggest it; the user picks.`,
            line.line_no,
          );
          break;
        case 'confirm':
          add('autonomy.category', 'escalate', `Category "${line.category}" requires user confirmation.`, line.line_no);
          break;
        case 'auto':
          if (mandate.escalate_new_items && !input.previouslyPurchased.has(line.product_id)) {
            add(
              'autonomy.new_item',
              'escalate',
              `"${line.name}" has never been bought before. New items need a one-tap approval.`,
              line.line_no,
            );
          } else {
            add('autonomy.category', 'pass', `"${line.name}" is a repeat ${line.category} item; agent may auto-buy.`, line.line_no);
          }
          break;
      }
    }
  }

  // ── Risk checks (apply with or without a mandate) ────────────────────────
  if (quote.total_paise > risk.highValuePaise) {
    add('risk.high_value', 'review', `High-value order above ${formatPaise(risk.highValuePaise)} sent for merchant review.`);
  }
  if (input.recentAgentOrders >= risk.velocityMaxOrders) {
    add(
      'risk.velocity',
      'review',
      `Agent placed ${input.recentAgentOrders} orders in the last ${Math.round(risk.velocityWindowSeconds / 60)} min (limit ${risk.velocityMaxOrders}).`,
    );
  }
  for (const line of quote.lines) {
    if (line.quantity > risk.maxLineQuantity) {
      add('risk.quantity', 'review', `Unusual quantity: ${line.quantity} × "${line.name}".`, line.line_no);
    }
  }

  // ── Combine ──────────────────────────────────────────────────────────────
  const worst = checks.reduce<CheckResult>((acc, c) => (SEVERITY[c.result] > SEVERITY[acc] ? c.result : acc), 'pass');
  const outcome: PolicyOutcome =
    worst === 'block' ? 'block' : worst === 'review' ? 'review' : worst === 'escalate' ? 'needs_approval' : 'approve';
  const requires_user_approval = checks.some((c) => c.result === 'escalate');
  const risk_score = Math.min(
    100,
    checks.reduce((sum, c) => sum + (c.result === 'review' ? (RISK_WEIGHT[c.rule] ?? 20) : 0), 0),
  );

  return { outcome, requires_user_approval, risk_score, checks, summary: summarize(outcome, checks) };
}

function summarize(outcome: PolicyOutcome, checks: PolicyCheck[]): string {
  const first = (r: CheckResult) => checks.find((c) => c.result === r)?.message;
  switch (outcome) {
    case 'approve':
      return 'Approved automatically: every item is within the mandate.';
    case 'block':
      return `Blocked: ${first('block')}`;
    case 'review':
      return `Held for merchant review: ${first('review')}`;
    case 'needs_approval':
      return `Waiting for user approval: ${first('escalate')}`;
  }
}
