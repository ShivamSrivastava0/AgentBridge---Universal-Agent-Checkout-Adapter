'use client';

import { AnimatePresence, motion } from 'motion/react';
import {
  Ban,
  CircleCheck,
  ExternalLink,
  Hand,
  KeyRound,
  Play,
  Plus,
  RotateCcw,
  ScanEye,
  ShieldAlert,
  ShoppingBasket,
  Sparkles,
  Trash2,
  User,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { AgentAvatar, CategoryIcon, StatusPill } from '@/components/icons';
import { Pipeline, type PipelineStage } from '@/components/Pipeline';
import { DecisionChecklist, Disclosure, PageHeader, Term } from '@/components/ui';
import { forgeToken, prettyJson, runCheckout, type AgentKey, type RunResult } from '@/lib/agent-runner';
import { useAdmin } from '@/lib/api';
import { GLOSSARY, OUTCOME_META, PROTOCOL_META, formatPaise } from '@/lib/format';
import type { Mandate, Product, Protocol } from '@/lib/types';

type Permission = 'rule' | 'none' | 'forged';
interface Line {
  product_id: string;
  quantity: number;
}
interface Scenario {
  id: string;
  title: string;
  prompt: string;
  expect: string;
  icon: LucideIcon;
  agent: AgentKey;
  permission: Permission;
  items: Line[];
}

const AGENT_PROTOCOL: Record<AgentKey, Protocol> = { claude: 'mcp', chatgpt: 'acp', gemini: 'ap2' };

const SCENARIOS: Scenario[] = [
  {
    id: 'restock',
    title: 'Weekly restock',
    prompt: 'Restock our usual milk, atta and onions for the week.',
    expect: 'Bought automatically',
    icon: ShoppingBasket,
    agent: 'claude',
    permission: 'rule',
    items: [
      { product_id: 'prd_dry_milk_1', quantity: 2 },
      { product_id: 'prd_stp_atta_5', quantity: 1 },
      { product_id: 'prd_prd_onion', quantity: 2 },
    ],
  },
  {
    id: 'new',
    title: 'Trying something new',
    prompt: 'Get milk, and some paneer for dinner tonight.',
    expect: 'Asks the shopper (never bought paneer)',
    icon: Sparkles,
    agent: 'chatgpt',
    permission: 'rule',
    items: [
      { product_id: 'prd_dry_milk_1', quantity: 1 },
      { product_id: 'prd_dry_paneer', quantity: 2 },
    ],
  },
  {
    id: 'shoes',
    title: '“Buy me running shoes”',
    prompt: 'Buy me some running shoes, black ones.',
    expect: 'Only suggests. Shoes are personal taste',
    icon: Hand,
    agent: 'gemini',
    permission: 'rule',
    items: [{ product_id: 'prd_fw_run_blk', quantity: 1 }],
  },
  {
    id: 'allergen',
    title: 'Allergy protection',
    prompt: 'Grab a jar of peanut butter and some bananas.',
    expect: 'Blocked: household avoids peanuts',
    icon: ShieldAlert,
    agent: 'claude',
    permission: 'rule',
    items: [
      { product_id: 'prd_snk_pbutter', quantity: 1 },
      { product_id: 'prd_prd_banana', quantity: 1 },
    ],
  },
  {
    id: 'review',
    title: 'Big purchase',
    prompt: 'Order the Philips air fryer.',
    expect: 'Held for your review (₹7,499)',
    icon: ScanEye,
    agent: 'chatgpt',
    permission: 'rule',
    items: [{ product_id: 'prd_elc_airfryer', quantity: 1 }],
  },
  {
    id: 'forged',
    title: 'Tampered permission',
    prompt: 'Buy 10 packs of tea. (The agent secretly raised its own limit.)',
    expect: 'Refused: the signature doesn’t match',
    icon: KeyRound,
    agent: 'gemini',
    permission: 'forged',
    items: [{ product_id: 'prd_bev_tea', quantity: 10 }],
  },
  {
    id: 'none',
    title: 'No permission at all',
    prompt: 'Order a bag of basmati rice.',
    expect: 'Asks the shopper to approve',
    icon: User,
    agent: 'chatgpt',
    permission: 'none',
    items: [{ product_id: 'prd_stp_rice_5', quantity: 1 }],
  },
];

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function TryPage() {
  const mandates = useAdmin<{ mandates: Mandate[] }>('/mandates');
  const products = useAdmin<{ products: Product[] }>('/products');
  const active = (mandates.data?.mandates ?? []).filter((m) => !m.revoked_at && new Date(m.expires_at) > new Date());
  const byId = useMemo(() => new Map((products.data?.products ?? []).map((p) => [p.id, p])), [products.data]);

  const [mandateId, setMandateId] = useState('');
  const mandate = active.find((m) => m.id === mandateId) ?? active[0];

  const [current, setCurrent] = useState<Scenario | null>(null);
  const [stage, setStage] = useState<PipelineStage>('idle');
  const [result, setResult] = useState<RunResult | null>(null);
  const running = stage !== 'idle' && stage !== 'done';

  // Custom builder state
  const [agent, setAgent] = useState<AgentKey>('claude');
  const [permission, setPermission] = useState<Permission>('rule');
  const [items, setItems] = useState<Line[]>([{ product_id: 'prd_bev_tea', quantity: 1 }]);
  const [picker, setPicker] = useState('');

  const total = (lines: Line[]) => lines.reduce((s, l) => s + (byId.get(l.product_id)?.price_paise ?? 0) * l.quantity, 0);

  async function run(s: Scenario) {
    if (running) return;
    setCurrent(s);
    setResult(null);
    setStage('request');
    const token = s.permission === 'none' || !mandate ? undefined : s.permission === 'forged' ? forgeToken(mandate.token) : mandate.token;
    const [res] = await Promise.all([runCheckout(s.agent, s.items, token), wait(900)]);
    setStage('checks');
    await wait(900);
    setStage('decision');
    setResult(res);
    await wait(700);
    setStage('done');
  }

  const custom: Scenario = {
    id: 'custom',
    title: 'Your cart',
    prompt: `Please buy: ${items.map((l) => `${l.quantity} × ${byId.get(l.product_id)?.name ?? l.product_id}`).join(', ')}.`,
    expect: '',
    icon: ShoppingBasket,
    agent,
    permission,
    items,
  };

  const outcome = result?.error ? 'error' : result?.outcome;

  return (
    <>
      <PageHeader
        icon={Play}
        title="Try it live"
        description="Play the shopper. Pick a situation, and an AI assistant will try to buy it at your store using its real protocol. Watch AgentBridge check every rule and decide."
      />

      <div className="try-layout">
        <div className="try-left">
          <div className="section-label">1. Pick a situation</div>
          <motion.div className="scenario-list" initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.05 } } }}>
            {SCENARIOS.map((s) => (
              <motion.button
                key={s.id}
                className={`scenario ${current?.id === s.id ? 'on' : ''}`}
                disabled={running || !mandate}
                onClick={() => run(s)}
                variants={{ hidden: { opacity: 0, x: -10 }, show: { opacity: 1, x: 0 } }}
                whileHover={{ x: 3 }}
                whileTap={{ scale: 0.98 }}
              >
                <span className="scenario-icon">
                  <s.icon size={18} />
                </span>
                <span className="scenario-text">
                  <b>{s.title}</b>
                  <small>{s.expect}</small>
                </span>
                <AgentAvatar protocol={AGENT_PROTOCOL[s.agent]} size={26} />
              </motion.button>
            ))}
          </motion.div>

          <Disclosure title="Or build your own cart">
            <div className="form">
              <div className="field">
                <span>Which AI assistant?</span>
                <div className="choice-grid three">
                  {(Object.keys(AGENT_PROTOCOL) as AgentKey[]).map((k) => (
                    <button key={k} type="button" className={`choice ${agent === k ? 'on' : ''}`} onClick={() => setAgent(k)}>
                      <AgentAvatar protocol={AGENT_PROTOCOL[k]} size={24} />
                      <b>{PROTOCOL_META[AGENT_PROTOCOL[k]].agent}</b>
                      <small>{PROTOCOL_META[AGENT_PROTOCOL[k]].short}</small>
                    </button>
                  ))}
                </div>
              </div>
              <label className="field">
                <span>
                  <Term tip={GLOSSARY.rule}>Permission</Term>
                </span>
                <select className="input" value={permission} onChange={(e) => setPermission(e.target.value as Permission)}>
                  <option value="rule">Use a spending rule</option>
                  <option value="none">No permission</option>
                  <option value="forged">Tampered spending rule</option>
                </select>
              </label>
              <ul className="builder-cart">
                {items.map((l, i) => {
                  const p = byId.get(l.product_id);
                  return (
                    <li key={l.product_id}>
                      {p && <CategoryIcon category={p.category} size={15} />}
                      <span className="grow">{p?.name ?? l.product_id}</span>
                      <input
                        className="input input-xs"
                        type="number"
                        min={1}
                        max={100}
                        value={l.quantity}
                        aria-label="Quantity"
                        onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, quantity: Math.max(1, Number(e.target.value)) } : x)))}
                      />
                      <button className="icon-btn" onClick={() => setItems(items.filter((_, j) => j !== i))} aria-label="Remove">
                        <Trash2 size={15} />
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="row">
                <select className="input grow" value={picker} onChange={(e) => setPicker(e.target.value)} aria-label="Add product">
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
                  className="btn btn-soft"
                  disabled={!picker}
                  onClick={() => {
                    setItems([...items, { product_id: picker, quantity: 1 }]);
                    setPicker('');
                  }}
                >
                  <Plus size={15} /> Add
                </button>
              </div>
              <button className="btn btn-primary btn-block" disabled={running || items.length === 0 || !mandate} onClick={() => run(custom)}>
                <Play size={15} /> Send {formatPaise(total(items))} order
              </button>
            </div>
          </Disclosure>

          {active.length > 1 && (
            <label className="field small-field">
              <span>Spending rule used</span>
              <select className="input" value={mandate?.id ?? ''} onChange={(e) => setMandateId(e.target.value)}>
                {active.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} ({formatPaise(m.budget_paise - m.spent_paise)} left)
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <section className="card stage">
          <div className="section-label">2. Watch what happens</div>
          {!current ? (
            <div className="stage-empty">
              <motion.div className="stage-empty-art" animate={{ y: [0, -6, 0] }} transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}>
                <Sparkles size={34} />
              </motion.div>
              <strong>Pick a situation on the left</strong>
              <span>You’ll see the shopper’s request, the agent’s order, every rule AgentBridge checks, and the final decision.</span>
            </div>
          ) : (
            <div className="sim">
              <motion.div key={`u-${current.id}-${stage === 'request'}`} className="bubble bubble-user" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                <span className="bubble-who">
                  <User size={14} /> Shopper
                </span>
                {current.prompt}
              </motion.div>
              <motion.div className="bubble bubble-agent" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}>
                <span className="bubble-who">
                  <AgentAvatar protocol={AGENT_PROTOCOL[current.agent]} size={18} /> {PROTOCOL_META[AGENT_PROTOCOL[current.agent]].agent}
                </span>
                On it. Sending this to the store via {PROTOCOL_META[AGENT_PROTOCOL[current.agent]].short}
                {current.permission === 'rule' ? ' with your spending rule' : current.permission === 'forged' ? ' with a spending rule I edited' : ' (I have no spending permission)'}:
                <ul className="bubble-cart">
                  {current.items.map((l) => (
                    <li key={l.product_id}>
                      {l.quantity} × {byId.get(l.product_id)?.name ?? l.product_id}
                    </li>
                  ))}
                </ul>
                <b>{formatPaise(total(current.items))}</b>
              </motion.div>

              <Pipeline stage={stage} outcome={outcome} compact />

              <AnimatePresence>
                {stage === 'checks' && (
                  <motion.p className="checking" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    <span className="spinner" /> Checking budget, permissions, health tags and fraud signals…
                  </motion.p>
                )}
              </AnimatePresence>

              {result && (stage === 'decision' || stage === 'done') && (
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="verdict-wrap">
                  <Verdict result={result} />
                  {result.checks && <DecisionChecklist checks={result.checks} />}
                  {stage === 'done' && (
                    <motion.div className="row" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                      {result.order_id && (
                        <Link className="btn btn-soft" href={`/orders/${result.order_id}`}>
                          Open this order
                        </Link>
                      )}
                      {result.approval_url && (
                        <a className="btn btn-primary" href={result.approval_url} target="_blank" rel="noreferrer">
                          Approve as the shopper <ExternalLink size={14} />
                        </a>
                      )}
                      <button className="btn btn-ghost" onClick={() => run(current)}>
                        <RotateCcw size={15} /> Run again
                      </button>
                    </motion.div>
                  )}
                  {stage === 'done' && result.steps.length > 0 && (
                    <Disclosure title={`See the ${result.steps.length} raw API calls`}>
                      <ol className="wire">
                        {result.steps.map((st, i) => (
                          <li key={i}>
                            <div className="wire-head">
                              <span className={`http ${st.status < 300 ? 'ok' : 'err'}`}>{st.status}</span>
                              <span className="mono">
                                {st.method} {st.path}
                              </span>
                              <span className="muted small">{st.label}</span>
                            </div>
                            <div className="wire-body">
                              {st.body !== undefined && <pre className="code">{prettyJson(st.body)}</pre>}
                              <pre className="code code-alt">{prettyJson(st.response)}</pre>
                            </div>
                          </li>
                        ))}
                      </ol>
                    </Disclosure>
                  )}
                </motion.div>
              )}
            </div>
          )}
          <p className="stage-foot small muted">
            These are real orders against your store. Run more than 5 from one assistant within 5 minutes and the “ordering too fast” check kicks in.
          </p>
        </section>
      </div>
    </>
  );
}

function Verdict({ result }: { result: RunResult }) {
  if (result.error) {
    return (
      <div className="verdict tone-bad">
        <motion.span className="verdict-icon" initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 400, damping: 15 }}>
          <Ban size={26} />
        </motion.span>
        <div>
          <strong>Refused before any order was created</strong>
          <span>{result.error}</span>
        </div>
      </div>
    );
  }
  const meta = result.outcome ? OUTCOME_META[result.outcome] : null;
  const Icon = result.outcome === 'approve' ? CircleCheck : result.outcome === 'needs_approval' ? Hand : result.outcome === 'block' ? Ban : ScanEye;
  return (
    <div className={`verdict tone-${meta?.tone ?? 'muted'}`}>
      <motion.span className="verdict-icon" initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 400, damping: 15 }}>
        <Icon size={26} />
      </motion.span>
      <div>
        <strong>{meta?.label}</strong>
        <span>{result.summary}</span>
      </div>
      {result.status && <StatusPill status={result.status} size="sm" />}
      {result.outcome === 'approve' && <Burst />}
    </div>
  );
}

/** Small celebratory burst for an automatic purchase. */
function Burst() {
  return (
    <span className="burst" aria-hidden="true">
      {Array.from({ length: 10 }, (_, i) => {
        const a = (i / 10) * Math.PI * 2;
        return (
          <motion.i
            key={i}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
            animate={{ x: Math.cos(a) * 46, y: Math.sin(a) * 46, opacity: 0, scale: 0.4 }}
            transition={{ duration: 0.8, ease: 'easeOut', delay: 0.15 }}
          />
        );
      })}
    </span>
  );
}
