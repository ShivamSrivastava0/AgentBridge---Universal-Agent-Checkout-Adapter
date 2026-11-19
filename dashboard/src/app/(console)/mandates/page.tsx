'use client';

import { useState } from 'react';
import { Card, CopyButton, EmptyState, ErrorState, Meter, PageHeader, Skeleton } from '@/components/ui';
import { ApiError, admin, useAdmin, useLiveReload } from '@/lib/api';
import { AUTONOMY_LEVELS, AUTONOMY_META, formatDateTime, formatPaise, titleCase, type AutonomyLevel } from '@/lib/format';
import type { Agent, Mandate } from '@/lib/types';

const CATEGORIES = ['staples', 'dairy', 'produce', 'beverages', 'snacks', 'household', 'personal_care', 'health', 'baby', 'electronics', 'footwear', 'apparel'];
const DEFAULT_RULES: Record<string, AutonomyLevel> = {
  staples: 'auto',
  dairy: 'auto',
  produce: 'auto',
  beverages: 'auto',
  snacks: 'auto',
  household: 'auto',
  personal_care: 'auto',
  health: 'confirm',
  baby: 'confirm',
  electronics: 'confirm',
  footwear: 'shortlist',
  apparel: 'shortlist',
};
const HEALTH_TAGS = ['contains:peanuts', 'contains:tree_nuts', 'contains:gluten', 'contains:dairy', 'contains:egg', 'contains:soy', 'high_sugar', 'caffeine'];

export default function MandatesPage() {
  const { data, error, reload } = useAdmin<{ mandates: Mandate[] }>('/mandates');
  const agents = useAdmin<{ agents: Agent[] }>('/agents');
  useLiveReload(reload, (e) => e.type.startsWith('mandate') || e.type.startsWith('order'));
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader
        kicker="SPENDING PERMISSIONS"
        title="Mandates"
        description="A mandate is a signed permission a shopper gives an agent: how much it may spend, what it may buy on its own, and what it may never buy."
        actions={
          <button className="btn btn-primary" onClick={() => setCreating((v) => !v)}>
            {creating ? 'Close' : 'New mandate'}
          </button>
        }
      />
      {creating && (
        <CreateMandate
          agents={agents.data?.agents ?? []}
          onCreated={() => {
            setCreating(false);
            void reload();
          }}
        />
      )}
      {error && <ErrorState error={error} onRetry={reload} />}
      {!data && !error && <Skeleton rows={5} />}
      {data?.mandates.length === 0 && (
        <section className="section-block">
          <EmptyState title="No mandates yet">Create one to let an agent buy within limits.</EmptyState>
        </section>
      )}
      <div className="stack">
        {data?.mandates.map((m) => <MandateCard key={m.id} m={m} agents={agents.data?.agents ?? []} onChange={reload} />)}
      </div>
    </>
  );
}

function MandateCard({ m, agents, onChange }: { m: Mandate; agents: Agent[]; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const expired = new Date(m.expires_at) < new Date();
  const state = m.revoked_at ? 'Revoked' : expired ? 'Expired' : 'Active';
  const grouped = AUTONOMY_LEVELS.map((lvl) => ({ lvl, cats: Object.entries(m.category_rules).filter(([, v]) => v === lvl).map(([k]) => k) }));
  const agent = agents.find((a) => a.id === m.agent_id);

  return (
    <section className={`section-block ${state !== 'Active' ? 'is-dim' : ''}`}>
      <div className="section-heading">
        <div>
          <p className="section-kicker">
            {m.subject} · {agent ? `only ${agent.name}` : 'any agent'} · expires {formatDateTime(m.expires_at)}
          </p>
          <h2>{m.label}</h2>
        </div>
        <div className="row">
          <span className={`badge ${state === 'Active' ? 'tone-good' : 'tone-muted'}`}>
            <span className="dot" />
            {state}
          </span>
          {state === 'Active' && (
            <button
              className="btn btn-sm btn-danger"
              disabled={busy}
              onClick={async () => {
                if (!confirm(`Revoke “${m.label}”? Agents holding this token will be refused immediately.`)) return;
                setBusy(true);
                try {
                  await admin.post(`/mandates/${m.id}/revoke`);
                  onChange();
                } finally {
                  setBusy(false);
                }
              }}
            >
              Revoke
            </button>
          )}
        </div>
      </div>
      <div className="card-body mandate-grid">
        <div>
          <p className="label">Budget committed</p>
          <p className="big mono">
            {formatPaise(m.spent_paise)} <small>of {formatPaise(m.budget_paise)}</small>
          </p>
          <Meter value={m.spent_paise} max={m.budget_paise} />
          <p className="muted small">
            Per-order cap {formatPaise(m.max_order_paise)} · {m.orders} orders · includes orders awaiting approval
          </p>
        </div>
        <div>
          <p className="label">Autonomy by category</p>
          <div className="autonomy">
            {grouped
              .filter((g) => g.cats.length > 0)
              .map((g) => (
                <div key={g.lvl} className={`autonomy-row lvl-${g.lvl}`}>
                  <span className="lvl">{AUTONOMY_META[g.lvl].label}</span>
                  <span>{g.cats.map(titleCase).join(', ')}</span>
                </div>
              ))}
            <div className="autonomy-row">
              <span className="lvl">Anything else</span>
              <span>{AUTONOMY_META[m.default_level].label}</span>
            </div>
          </div>
        </div>
        <div>
          <p className="label">Guardrails</p>
          <ul className="plain small">
            <li>{m.escalate_new_items ? 'New, never-bought items need approval' : 'New items follow category rules'}</li>
            <li>{m.blocked_tags.length ? `Never buy: ${m.blocked_tags.join(', ')}` : 'No blocked tags'}</li>
          </ul>
        </div>
      </div>
      <div className="card-footer">
        <span className="muted small">Signed ES256 intent mandate. Give this token to the agent.</span>
        <div className="row">
          <button className="btn btn-ghost btn-sm" onClick={() => setShowToken((v) => !v)}>
            {showToken ? 'Hide token' : 'Show token'}
          </button>
          <CopyButton value={m.token} label="Copy token" />
        </div>
      </div>
      {showToken && <pre className="code token">{m.token}</pre>}
    </section>
  );
}

function CreateMandate({ agents, onCreated }: { agents: Agent[]; onCreated: () => void }) {
  const [label, setLabel] = useState('Weekly essentials');
  const [subject, setSubject] = useState('household_demo');
  const [agentId, setAgentId] = useState('');
  const [maxOrder, setMaxOrder] = useState(2500);
  const [budget, setBudget] = useState(10000);
  const [days, setDays] = useState(30);
  const [rules, setRules] = useState<Record<string, AutonomyLevel>>(DEFAULT_RULES);
  const [defaultLevel, setDefaultLevel] = useState<AutonomyLevel>('confirm');
  const [tags, setTags] = useState<string[]>(['contains:peanuts']);
  const [escalateNew, setEscalateNew] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await admin.post('/mandates', {
        label,
        subject,
        agent_id: agentId || null,
        max_order_paise: Math.round(maxOrder * 100),
        budget_paise: Math.round(budget * 100),
        category_rules: rules,
        default_level: defaultLevel,
        blocked_tags: tags,
        escalate_new_items: escalateNew,
        expires_in_days: days,
      });
      onCreated();
    } catch (e) {
      setErr(e instanceof ApiError ? (Array.isArray(e.details) ? e.details.map((d: { path: string; message: string }) => `${d.path}: ${d.message}`).join('; ') : e.message) : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card kicker="ISSUE" title="New intent mandate" className="form-card">
      <form className="card-body form" onSubmit={submit}>
        <div className="form-grid">
          <label>
            <span>Name</span>
            <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} required maxLength={80} />
          </label>
          <label>
            <span>Shopper (subject)</span>
            <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} required maxLength={64} />
          </label>
          <label>
            <span>Agent</span>
            <select className="input" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              <option value="">Any registered agent</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.protocol.toUpperCase()})
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Per-order cap (₹)</span>
            <input className="input" type="number" min={1} value={maxOrder} onChange={(e) => setMaxOrder(Number(e.target.value))} required />
          </label>
          <label>
            <span>Total budget (₹)</span>
            <input className="input" type="number" min={1} value={budget} onChange={(e) => setBudget(Number(e.target.value))} required />
          </label>
          <label>
            <span>Valid for (days)</span>
            <input className="input" type="number" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))} required />
          </label>
        </div>

        <fieldset>
          <legend>What may the agent do in each category?</legend>
          <div className="rules-grid">
            {CATEGORIES.map((c) => (
              <label key={c} className="rule-row">
                <span>{titleCase(c)}</span>
                <select className="input input-sm" value={rules[c] ?? defaultLevel} onChange={(e) => setRules({ ...rules, [c]: e.target.value as AutonomyLevel })}>
                  {AUTONOMY_LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {AUTONOMY_META[l].label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <label className="rule-row">
              <span>Anything else</span>
              <select className="input input-sm" value={defaultLevel} onChange={(e) => setDefaultLevel(e.target.value as AutonomyLevel)}>
                {AUTONOMY_LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {AUTONOMY_META[l].label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="muted small">
            {AUTONOMY_LEVELS.map((l) => `${AUTONOMY_META[l].label}: ${AUTONOMY_META[l].help}.`).join(' ')}
          </p>
        </fieldset>

        <fieldset>
          <legend>Health &amp; safety: never buy items tagged</legend>
          <div className="chips">
            {HEALTH_TAGS.map((t) => (
              <label key={t} className={`chip ${tags.includes(t) ? 'on' : ''}`}>
                <input type="checkbox" checked={tags.includes(t)} onChange={(e) => setTags(e.target.checked ? [...tags, t] : tags.filter((x) => x !== t))} />
                {t}
              </label>
            ))}
          </div>
          <label className="check">
            <input type="checkbox" checked={escalateNew} onChange={(e) => setEscalateNew(e.target.checked)} />
            Ask before buying anything this shopper has never bought before
          </label>
        </fieldset>

        {err && <p className="error-text">{err}</p>}
        <div className="row end">
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Signing…' : 'Sign & issue mandate'}
          </button>
        </div>
      </form>
    </Card>
  );
}
