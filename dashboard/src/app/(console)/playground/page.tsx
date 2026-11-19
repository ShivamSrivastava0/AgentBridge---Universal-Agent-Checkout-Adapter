'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Card, DecisionTrace, PageHeader, ProtocolTag, StatusBadge } from '@/components/ui';
import { useAdmin } from '@/lib/api';
import { formatPaise, type OrderStatus } from '@/lib/format';
import type { Mandate, PolicyCheck, Product, Protocol } from '@/lib/types';

type AgentKey = 'claude' | 'chatgpt' | 'gemini';
type MandateMode = 'mandate' | 'none' | 'tampered';
interface Line {
  product_id: string;
  quantity: number;
}

const AGENTS: Record<AgentKey, { name: string; protocol: Protocol; blurb: string }> = {
  claude: { name: 'Claude', protocol: 'mcp', blurb: 'MCP tools over Streamable HTTP (JSON-RPC)' },
  chatgpt: { name: 'ChatGPT', protocol: 'acp', blurb: 'ACP checkout sessions (REST)' },
  gemini: { name: 'Gemini', protocol: 'ap2', blurb: 'AP2 intent mandate → cart mandate' },
};

const SCENARIOS: { id: string; title: string; expect: string; agent: AgentKey; mandate: MandateMode; items: Line[] }[] = [
  {
    id: 'restock',
    title: 'Weekly restock',
    expect: 'Repeat essentials → paid automatically',
    agent: 'claude',
    mandate: 'mandate',
    items: [
      { product_id: 'prd_dry_milk_1', quantity: 2 },
      { product_id: 'prd_stp_atta_5', quantity: 1 },
      { product_id: 'prd_prd_onion', quantity: 2 },
    ],
  },
  {
    id: 'new',
    title: 'Something new',
    expect: 'Never bought paneer before → asks the user',
    agent: 'chatgpt',
    mandate: 'mandate',
    items: [
      { product_id: 'prd_dry_milk_1', quantity: 1 },
      { product_id: 'prd_dry_paneer', quantity: 2 },
    ],
  },
  {
    id: 'shoes',
    title: '“Buy me running shoes”',
    expect: 'Taste-driven → shortlist only, user picks',
    agent: 'gemini',
    mandate: 'mandate',
    items: [{ product_id: 'prd_fw_run_blk', quantity: 1 }],
  },
  {
    id: 'allergen',
    title: 'Peanut butter',
    expect: 'Household blocks peanuts → refused by server',
    agent: 'claude',
    mandate: 'mandate',
    items: [
      { product_id: 'prd_snk_pbutter', quantity: 1 },
      { product_id: 'prd_prd_banana', quantity: 1 },
    ],
  },
  {
    id: 'review',
    title: 'Air fryer',
    expect: '₹7,499 → over cap + merchant fraud review',
    agent: 'chatgpt',
    mandate: 'mandate',
    items: [{ product_id: 'prd_elc_airfryer', quantity: 1 }],
  },
  {
    id: 'tampered',
    title: 'Forged mandate',
    expect: 'Edited token → signature check fails',
    agent: 'gemini',
    mandate: 'tampered',
    items: [{ product_id: 'prd_bev_tea', quantity: 10 }],
  },
  {
    id: 'nomandate',
    title: 'No mandate',
    expect: 'Agent has no permission → user approves',
    agent: 'chatgpt',
    mandate: 'none',
    items: [{ product_id: 'prd_stp_rice_5', quantity: 1 }],
  },
];

interface Step {
  label: string;
  method: string;
  path: string;
  body?: unknown;
  status?: number;
  response?: unknown;
}

interface Outcome {
  order_id?: string;
  status?: OrderStatus;
  summary?: string;
  checks?: PolicyCheck[];
  approval_url?: string;
  error?: string;
}

export default function PlaygroundPage() {
  const mandates = useAdmin<{ mandates: Mandate[] }>('/mandates');
  const products = useAdmin<{ products: Product[] }>('/products');
  const activeMandates = (mandates.data?.mandates ?? []).filter((m) => !m.revoked_at && new Date(m.expires_at) > new Date());

  const [agent, setAgent] = useState<AgentKey>('claude');
  const [mandateMode, setMandateMode] = useState<MandateMode>('mandate');
  const [mandateId, setMandateId] = useState('');
  const [items, setItems] = useState<Line[]>(SCENARIOS[0]!.items);
  const [picker, setPicker] = useState('');
  const [steps, setSteps] = useState<Step[]>([]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [running, setRunning] = useState(false);

  const mandate = activeMandates.find((m) => m.id === mandateId) ?? activeMandates[0];
  const byId = useMemo(() => new Map((products.data?.products ?? []).map((p) => [p.id, p])), [products.data]);
  const total = items.reduce((s, l) => s + (byId.get(l.product_id)?.price_paise ?? 0) * l.quantity, 0);

  const tokenFor = (mode: MandateMode): string | undefined =>
    mode === 'none' || !mandate ? undefined : mode === 'tampered' ? tamper() : mandate.token;

  async function call(step: Step, push: (s: Step) => void, headers: Record<string, string> = {}) {
    const res = await fetch(step.path, {
      method: step.method,
      headers: { 'content-type': 'application/json', ...headers },
      body: step.body === undefined ? undefined : JSON.stringify(step.body),
    });
    const text = await res.text();
    let json: unknown = text;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    push({ ...step, status: res.status, response: json });
    return { status: res.status, json: json as Record<string, unknown> };
  }

  async function run(a = agent, mode = mandateMode, lines = items) {
    setRunning(true);
    setSteps([]);
    setOutcome(null);
    const log: Step[] = [];
    const push = (s: Step) => {
      log.push(s);
      setSteps([...log]);
    };
    const tok = tokenFor(mode);
    try {
      const base = `/api/agent/${a}`;
      if (a === 'claude') {
        const rpc = (name: string, args: unknown) => ({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } });
        const accept = { accept: 'application/json, text/event-stream' };
        await call({ label: 'MCP · quote_cart', method: 'POST', path: `${base}/mcp`, body: rpc('quote_cart', { items: lines }) }, push, accept);
        const r = await call(
          { label: 'MCP · checkout', method: 'POST', path: `${base}/mcp`, body: rpc('checkout', { items: lines, ...(tok ? { mandate_token: tok } : {}) }) },
          push,
          accept,
        );
        const result = (r.json?.result ?? {}) as { content?: { text: string }[]; isError?: boolean };
        const text = result.content?.[0]?.text ?? '';
        if (result.isError) setOutcome({ error: text });
        else setOutcome(fromAgentView(JSON.parse(text)));
      } else if (a === 'chatgpt') {
        const created = await call(
          {
            label: 'ACP · create checkout session',
            method: 'POST',
            path: `${base}/acp/checkout_sessions`,
            body: { items: lines.map((l) => ({ id: l.product_id, quantity: l.quantity })) },
          },
          push,
        );
        if (created.status >= 400) throw new Error(errMsg(created.json));
        const done = await call(
          {
            label: 'ACP · complete',
            method: 'POST',
            path: `${base}/acp/checkout_sessions/${created.json.id}/complete`,
            body: tok ? { payment_data: { provider: 'agentbridge', token: tok } } : {},
          },
          push,
        );
        if (done.status >= 400) throw new Error(errMsg(done.json));
        const o = done.json.order as { id: string; status: OrderStatus; permalink_url: string | null; decision: { summary: string; checks: PolicyCheck[] } };
        setOutcome({ order_id: o.id, status: o.status, summary: o.decision.summary, checks: o.decision.checks, approval_url: o.permalink_url ?? undefined });
      } else {
        if (!tok) {
          push({ label: 'AP2 · checkout', method: 'POST', path: `${base}/ap2/checkout`, status: 0, response: 'AP2 requires an intent mandate. Choose a mandate first.' });
          throw new Error('AP2 checkouts must carry a signed intent mandate.');
        }
        const v = await call({ label: 'AP2 · verify intent mandate', method: 'POST', path: `${base}/ap2/mandates/verify`, body: { mandate: tok } }, push);
        if (v.status >= 400) throw new Error(errMsg(v.json));
        const r = await call(
          { label: 'AP2 · checkout', method: 'POST', path: `${base}/ap2/checkout`, body: { intent_mandate: tok, cart: { items: lines } } },
          push,
        );
        if (r.status >= 400) throw new Error(errMsg(r.json));
        setOutcome(fromAgentView(r.json));
      }
    } catch (e) {
      setOutcome({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      setRunning(false);
    }
  }

  /** Edit claims in the payload (raise the limits) but keep the original signature. */
  function tamper() {
    if (!mandate) return undefined;
    const [h, p, s] = mandate.token.split('.');
    const payload = JSON.parse(atob(p!.replace(/-/g, '+').replace(/_/g, '/')));
    payload.max_order_paise = 99_999_900;
    payload.budget_paise = 99_999_900;
    return `${h}.${btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.${s}`;
  }

  const runScenario = (s: (typeof SCENARIOS)[number]) => {
    setAgent(s.agent);
    setMandateMode(s.mandate);
    setItems(s.items);
    void run(s.agent, s.mandate, s.items);
  };

  return (
    <>
      <PageHeader
        kicker="TRY IT"
        title="Agent playground"
        description="Act as ChatGPT, Claude or Gemini and send a real checkout through ACP, MCP or AP2. Every request below hits the live API, and the result shows up across the console in real time."
      />

      <Card kicker="ONE CLICK" title="Scenarios">
        <div className="scenarios">
          {SCENARIOS.map((s) => (
            <button key={s.id} className="scenario" disabled={running || !mandate} onClick={() => runScenario(s)}>
              <span className="scenario-top">
                <ProtocolTag protocol={AGENTS[s.agent].protocol} />
                <strong>{s.title}</strong>
              </span>
              <small>{s.expect}</small>
            </button>
          ))}
        </div>
        <p className="muted small card-body">
          Rules are live: run more than five orders from one agent within five minutes and the velocity rule will hold the next one for review.
        </p>
      </Card>

      <div className="grid-1-1">
        <Card kicker="BUILD" title="Custom checkout">
          <div className="card-body form">
            <div className="segmented" role="radiogroup" aria-label="Agent">
              {(Object.keys(AGENTS) as AgentKey[]).map((k) => (
                <button key={k} role="radio" aria-checked={agent === k} className={agent === k ? 'on' : ''} onClick={() => setAgent(k)}>
                  <strong>{AGENTS[k].name}</strong>
                  <small>{AGENTS[k].blurb}</small>
                </button>
              ))}
            </div>

            <div className="form-grid two">
              <label>
                <span>Mandate</span>
                <select className="input" value={mandateMode} onChange={(e) => setMandateMode(e.target.value as MandateMode)}>
                  <option value="mandate">Use a signed mandate</option>
                  <option value="none">No mandate</option>
                  <option value="tampered">Forged (edited) mandate</option>
                </select>
              </label>
              <label>
                <span>Which mandate</span>
                <select className="input" value={mandate?.id ?? ''} onChange={(e) => setMandateId(e.target.value)} disabled={mandateMode === 'none'}>
                  {activeMandates.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label} ({formatPaise(m.budget_paise - m.spent_paise)} left)
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div>
              <p className="label">Cart</p>
              <ul className="cart">
                {items.map((l, i) => {
                  const p = byId.get(l.product_id);
                  return (
                    <li key={l.product_id}>
                      <span className="list-main">
                        <strong>{p?.name ?? l.product_id}</strong>
                        <small>{p ? `${p.category} · ${formatPaise(p.price_paise)}` : ''}</small>
                      </span>
                      <input
                        className="input input-sm input-num"
                        type="number"
                        min={1}
                        max={100}
                        value={l.quantity}
                        aria-label="Quantity"
                        onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, quantity: Math.max(1, Number(e.target.value)) } : x)))}
                      />
                      <button className="btn btn-ghost btn-sm" onClick={() => setItems(items.filter((_, j) => j !== i))} aria-label="Remove">
                        ✕
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="row">
                <select className="input" value={picker} onChange={(e) => setPicker(e.target.value)} aria-label="Add product">
                  <option value="">Add a product…</option>
                  {products.data?.products
                    .filter((p) => p.active && !items.some((l) => l.product_id === p.id))
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {formatPaise(p.price_paise)}
                      </option>
                    ))}
                </select>
                <button
                  className="btn"
                  disabled={!picker}
                  onClick={() => {
                    setItems([...items, { product_id: picker, quantity: 1 }]);
                    setPicker('');
                  }}
                >
                  Add
                </button>
              </div>
            </div>

            <div className="row space">
              <span className="mono strong">Cart total {formatPaise(total)}</span>
              <button className="btn btn-primary" disabled={running || items.length === 0} onClick={() => run()}>
                {running ? 'Running…' : `Checkout as ${AGENTS[agent].name}`}
              </button>
            </div>
          </div>
        </Card>

        <Card kicker="RESULT" title="What AgentBridge decided">
          <div className="card-body">
            {!outcome && !running && <p className="muted">Pick a scenario or build a cart, then run it.</p>}
            {running && <p className="muted">Calling the API…</p>}
            {outcome?.error && (
              <div className="alert alert-bad">
                <div>
                  <strong>Refused before an order was created.</strong> {outcome.error}
                </div>
              </div>
            )}
            {outcome?.status && (
              <div className="stack">
                <div className="row space">
                  <StatusBadge status={outcome.status} />
                  <Link className="btn btn-ghost btn-sm" href={`/orders/${outcome.order_id}`}>
                    Open order →
                  </Link>
                </div>
                <p className="decision-summary">{outcome.summary}</p>
                {outcome.checks && <DecisionTrace checks={outcome.checks} showPasses={false} />}
                {outcome.approval_url && (
                  <a className="btn" href={outcome.approval_url} target="_blank" rel="noreferrer">
                    Open the shopper’s approval link ↗
                  </a>
                )}
              </div>
            )}
          </div>
        </Card>
      </div>

      {steps.length > 0 && (
        <Card kicker="WIRE" title="Protocol requests">
          <ol className="wire">
            {steps.map((s, i) => (
              <li key={i}>
                <div className="wire-head">
                  <span className="mono strong">{s.method}</span>
                  <span className="mono">{s.path.replace(/^\/api\/agent\/\w+/, '')}</span>
                  <span className="muted small">{s.label}</span>
                  {s.status !== undefined && <span className={`http http-${s.status < 300 && s.status > 0 ? 'ok' : 'err'}`}>{s.status || '—'}</span>}
                </div>
                <div className="wire-body">
                  {s.body !== undefined && <pre className="code">{redact(s.body)}</pre>}
                  {s.response !== undefined && <pre className="code code-response">{redact(s.response)}</pre>}
                </div>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </>
  );
}

function fromAgentView(v: Record<string, unknown>): Outcome {
  const d = v.decision as { summary: string; checks: PolicyCheck[] };
  return {
    order_id: v.order_id as string,
    status: v.status as OrderStatus,
    summary: d?.summary,
    checks: d?.checks,
    approval_url: v.approval_url as string | undefined,
  };
}

function errMsg(j: Record<string, unknown>): string {
  const e = j?.error as { message?: string } | undefined;
  return e?.message ?? 'Request failed';
}

/** Shorten JWTs so the wire log stays readable. */
function redact(v: unknown): string {
  return JSON.stringify(
    v,
    (_k, val) => (typeof val === 'string' && /^ey[\w-]+\.[\w-]+\.[\w-]+$/.test(val) ? `${val.slice(0, 24)}…(signed JWT, ${val.length} chars)` : val),
    2,
  );
}
