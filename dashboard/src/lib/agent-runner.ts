'use client';

import type { OrderStatus, Outcome } from './format';
import type { PolicyCheck } from './types';

export type AgentKey = 'claude' | 'chatgpt' | 'gemini';

export interface WireStep {
  label: string;
  method: string;
  path: string;
  body?: unknown;
  status: number;
  response: unknown;
}

export interface RunResult {
  steps: WireStep[];
  order_id?: string;
  status?: OrderStatus;
  outcome?: Outcome;
  summary?: string;
  checks?: PolicyCheck[];
  approval_url?: string;
  error?: string;
}

interface Line {
  product_id: string;
  quantity: number;
}

async function call(steps: WireStep[], label: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = text;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  steps.push({ label, method, path: path.replace(/^\/api\/agent\/\w+/, ''), body, status: res.status, response: json });
  return { status: res.status, json: json as Record<string, unknown> };
}

const errMsg = (j: Record<string, unknown>) => (j?.error as { message?: string } | undefined)?.message ?? 'Request failed';

/**
 * Runs a checkout exactly as each AI platform would, through the console's
 * server-side proxy (which adds that agent's API key).
 */
export async function runCheckout(agent: AgentKey, items: Line[], mandateToken?: string): Promise<RunResult> {
  const steps: WireStep[] = [];
  const base = `/api/agent/${agent}`;
  try {
    if (agent === 'claude') {
      const rpc = (name: string, args: unknown) => ({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } });
      const accept = { accept: 'application/json, text/event-stream' };
      await call(steps, 'MCP tool: quote_cart', 'POST', `${base}/mcp`, rpc('quote_cart', { items }), accept);
      const r = await call(steps, 'MCP tool: checkout', 'POST', `${base}/mcp`, rpc('checkout', { items, ...(mandateToken ? { mandate_token: mandateToken } : {}) }), accept);
      const result = (r.json?.result ?? {}) as { content?: { text: string }[]; isError?: boolean };
      const text = result.content?.[0]?.text ?? '';
      if (result.isError) return { steps, error: text.replace(/^\w+: /, '') };
      return { steps, ...fromView(JSON.parse(text)) };
    }
    if (agent === 'chatgpt') {
      const created = await call(steps, 'ACP: create checkout session', 'POST', `${base}/acp/checkout_sessions`, {
        items: items.map((l) => ({ id: l.product_id, quantity: l.quantity })),
      });
      if (created.status >= 400) return { steps, error: errMsg(created.json) };
      const done = await call(
        steps,
        'ACP: complete checkout',
        'POST',
        `${base}/acp/checkout_sessions/${created.json.id}/complete`,
        mandateToken ? { payment_data: { provider: 'agentbridge', token: mandateToken } } : {},
      );
      if (done.status >= 400) return { steps, error: errMsg(done.json) };
      const o = done.json.order as { id: string; status: OrderStatus; permalink_url: string | null; decision: { outcome: Outcome; summary: string; checks: PolicyCheck[] } };
      return { steps, order_id: o.id, status: o.status, outcome: o.decision.outcome, summary: o.decision.summary, checks: o.decision.checks, approval_url: o.permalink_url ?? undefined };
    }
    if (!mandateToken) return { steps, error: 'Gemini’s protocol (AP2) only works with a signed spending rule. Pick one and try again.' };
    const v = await call(steps, 'AP2: verify spending rule', 'POST', `${base}/ap2/mandates/verify`, { mandate: mandateToken });
    if (v.status >= 400) return { steps, error: errMsg(v.json) };
    const r = await call(steps, 'AP2: checkout', 'POST', `${base}/ap2/checkout`, { intent_mandate: mandateToken, cart: { items } });
    if (r.status >= 400) return { steps, error: errMsg(r.json) };
    return { steps, ...fromView(r.json) };
  } catch (e) {
    return { steps, error: e instanceof Error ? e.message : String(e) };
  }
}

function fromView(v: Record<string, unknown>): Omit<RunResult, 'steps'> {
  const d = v.decision as { outcome: Outcome; summary: string; checks: PolicyCheck[] };
  return {
    order_id: v.order_id as string,
    status: v.status as OrderStatus,
    outcome: d?.outcome,
    summary: d?.summary,
    checks: d?.checks,
    approval_url: v.approval_url as string | undefined,
  };
}

/** Change the limits inside a signed token while keeping the old signature (a forgery). */
export function forgeToken(token: string): string {
  const [h, p, s] = token.split('.');
  const payload = JSON.parse(atob(p!.replace(/-/g, '+').replace(/_/g, '/')));
  payload.max_order_paise = 99_999_900;
  payload.budget_paise = 99_999_900;
  const forged = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${h}.${forged}.${s}`;
}

/** Shorten JWTs so request logs stay readable. */
export function prettyJson(v: unknown): string {
  return JSON.stringify(
    v,
    (_k, val) => (typeof val === 'string' && /^ey[\w-]+\.[\w-]+\.[\w-]+$/.test(val) ? `${val.slice(0, 24)}…(signed, ${val.length} chars)` : val),
    2,
  );
}
