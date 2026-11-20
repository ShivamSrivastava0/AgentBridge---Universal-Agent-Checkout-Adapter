'use client';

import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, ArrowRight, Check, KeyRound, Plus, ShieldCheck, ShieldOff } from 'lucide-react';
import { useState } from 'react';
import { BudgetRing } from '@/components/charts';
import { AgentAvatar, CategoryIcon } from '@/components/icons';
import { CopyButton, EmptyState, ErrorState, Overlay, PageHeader, Skeleton, Term } from '@/components/ui';
import { ApiError, admin, useAdmin, useLiveReload } from '@/lib/api';
import { AUTONOMY_LEVELS, AUTONOMY_META, GLOSSARY, formatDateTime, formatPaise, titleCase, type AutonomyLevel } from '@/lib/format';
import type { Agent, Mandate } from '@/lib/types';

const CATEGORIES = ['staples', 'dairy', 'produce', 'beverages', 'snacks', 'household', 'personal_care', 'health', 'baby', 'electronics', 'footwear', 'apparel'];

const PRESETS: Record<string, { label: string; help: string; rules: Record<string, AutonomyLevel> }> = {
  cautious: {
    label: 'Cautious',
    help: 'Ask about everything',
    rules: Object.fromEntries(CATEGORIES.map((c) => [c, ['footwear', 'apparel', 'electronics'].includes(c) ? 'shortlist' : 'confirm'])),
  },
  balanced: {
    label: 'Balanced',
    help: 'Auto-buy everyday essentials',
    rules: {
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
    },
  },
  handsoff: {
    label: 'Hands-off',
    help: 'Auto-buy all but taste-driven items',
    rules: Object.fromEntries(CATEGORIES.map((c) => [c, ['footwear', 'apparel'].includes(c) ? 'shortlist' : 'auto'])),
  },
};

const HEALTH_TAGS: { tag: string; label: string }[] = [
  { tag: 'contains:peanuts', label: 'Peanuts' },
  { tag: 'contains:tree_nuts', label: 'Tree nuts' },
  { tag: 'contains:gluten', label: 'Gluten' },
  { tag: 'contains:dairy', label: 'Dairy' },
  { tag: 'contains:egg', label: 'Egg' },
  { tag: 'contains:soy', label: 'Soy' },
  { tag: 'high_sugar', label: 'High sugar' },
  { tag: 'caffeine', label: 'Caffeine' },
];

export default function RulesPage() {
  const { data, error, reload } = useAdmin<{ mandates: Mandate[] }>('/mandates');
  const agents = useAdmin<{ agents: Agent[] }>('/agents');
  useLiveReload(reload, (e) => e.type.startsWith('mandate') || e.type.startsWith('order'));
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader
        icon={ShieldCheck}
        title="Spending rules"
        description={
          <>
            A <Term tip={GLOSSARY.rule}>spending rule</Term> is the permission a shopper gives an AI agent: how much it may spend, what it may buy on its own, and what it must never buy.
          </>
        }
        actions={
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <Plus size={16} /> New spending rule
          </button>
        }
      />

      <div className="level-legend">
        {AUTONOMY_LEVELS.map((l) => (
          <span key={l} className={`level-chip lv-${l}`} title={AUTONOMY_META[l].help}>
            <b>{AUTONOMY_META[l].label}</b> {AUTONOMY_META[l].help}
          </span>
        ))}
      </div>

      {error && <ErrorState error={error} onRetry={reload} />}
      {!data && !error && <Skeleton rows={3} height={120} />}
      {data?.mandates.length === 0 && (
        <section className="card">
          <EmptyState icon={ShieldCheck} title="No spending rules yet" action={<button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>Create one</button>}>
            Without one, every agent order needs the shopper’s approval.
          </EmptyState>
        </section>
      )}
      <motion.div className="stack" initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.08 } } }}>
        {data?.mandates.map((m) => <RuleCard key={m.id} m={m} agents={agents.data?.agents ?? []} onChange={reload} />)}
      </motion.div>

      <Overlay open={creating} onClose={() => setCreating(false)} title="New spending rule">
        <Wizard
          agents={agents.data?.agents ?? []}
          onDone={() => {
            setCreating(false);
            reload();
          }}
        />
      </Overlay>
    </>
  );
}

function RuleCard({ m, agents, onChange }: { m: Mandate; agents: Agent[]; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const expired = new Date(m.expires_at) < new Date();
  const state = m.revoked_at ? 'Turned off' : expired ? 'Expired' : 'Active';
  const agent = agents.find((a) => a.id === m.agent_id);
  const left = Math.max(0, m.budget_paise - m.spent_paise);

  return (
    <motion.section className={`card rule-card ${state !== 'Active' ? 'is-off' : ''}`} variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0 } }}>
      <div className="rule-top">
        <BudgetRing used={m.spent_paise} total={m.budget_paise} />
        <div className="rule-summary">
          <div className="row">
            <h2>{m.label}</h2>
            <span className={`pill ${state === 'Active' ? 'tone-good' : 'tone-muted'}`}>{state}</span>
          </div>
          <p className="rule-sentence">
            {agent ? <strong>{agent.name}</strong> : <strong>Any connected agent</strong>} may spend up to <strong>{formatPaise(m.max_order_paise)}</strong> per order,{' '}
            <strong>{formatPaise(m.budget_paise)}</strong> in total, for shopper <span className="mono">{m.subject}</span>.
          </p>
          <div className="rule-stats">
            <span>
              <b>{formatPaise(left)}</b> left
            </span>
            <span>
              <b>{m.orders}</b> orders
            </span>
            <span>Expires {formatDateTime(m.expires_at)}</span>
          </div>
        </div>
      </div>

      <div className="rule-cats">
        {CATEGORIES.map((c) => {
          const lvl = (m.category_rules[c] ?? m.default_level) as AutonomyLevel;
          return (
            <span key={c} className={`rule-cat lv-${lvl}`} title={`${titleCase(c)}: ${AUTONOMY_META[lvl].label}`}>
              <CategoryIcon category={c} size={15} />
              <span>{titleCase(c)}</span>
              <b>{AUTONOMY_META[lvl].short}</b>
            </span>
          );
        })}
      </div>

      <div className="rule-foot">
        <span className="small muted">
          {m.blocked_tags.length ? `Never buys: ${m.blocked_tags.map((t) => HEALTH_TAGS.find((h) => h.tag === t)?.label ?? t).join(', ')}` : 'No health restrictions'}
          {m.escalate_new_items ? ' · Asks before buying anything new' : ''}
        </span>
        <div className="row">
          <CopyButton value={m.token} label="Copy key for the agent" />
          {state === 'Active' && (
            <button
              className="btn btn-danger btn-sm"
              disabled={busy}
              onClick={async () => {
                if (!confirm(`Turn off “${m.label}”? Any agent using it will be refused immediately.`)) return;
                setBusy(true);
                try {
                  await admin.post(`/mandates/${m.id}/revoke`);
                  onChange();
                } finally {
                  setBusy(false);
                }
              }}
            >
              <ShieldOff size={14} /> Turn off
            </button>
          )}
        </div>
      </div>
    </motion.section>
  );
}

// ── Wizard ─────────────────────────────────────────────────────────────

const STEP_TITLES = ['Who', 'Budget', 'What it can buy', 'Health & safety', 'Review'];

function Wizard({ agents, onDone }: { agents: Agent[]; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [label, setLabel] = useState('Weekly essentials');
  const [subject, setSubject] = useState('household_demo');
  const [agentId, setAgentId] = useState('');
  const [days, setDays] = useState(30);
  const [budget, setBudget] = useState(10000);
  const [maxOrder, setMaxOrder] = useState(2500);
  const [rules, setRules] = useState<Record<string, AutonomyLevel>>(PRESETS.balanced!.rules);
  const [tags, setTags] = useState<string[]>(['contains:peanuts']);
  const [escalateNew, setEscalateNew] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const go = (n: number) => {
    setDir(n > step ? 1 : -1);
    setStep(n);
  };
  const canNext = step !== 0 || (label.trim() && subject.trim());
  const agentName = agents.find((a) => a.id === agentId)?.name ?? 'Any agent';
  const autoCats = CATEGORIES.filter((c) => rules[c] === 'auto').map(titleCase);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await admin.post('/mandates', {
        label,
        subject,
        agent_id: agentId || null,
        max_order_paise: Math.round(maxOrder * 100),
        budget_paise: Math.round(budget * 100),
        category_rules: rules,
        default_level: 'confirm',
        blocked_tags: tags,
        escalate_new_items: escalateNew,
        expires_in_days: days,
      });
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? (Array.isArray(e.details) ? e.details.map((d: { message: string }) => d.message).join('; ') : e.message) : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wizard">
      <ol className="wizard-steps">
        {STEP_TITLES.map((t, i) => (
          <li key={t} className={i === step ? 'current' : i < step ? 'done' : ''}>
            <button type="button" onClick={() => i < step && go(i)} disabled={i > step}>
              <span>{i < step ? <Check size={13} strokeWidth={3} /> : i + 1}</span>
              {t}
            </button>
          </li>
        ))}
      </ol>

      <div className="wizard-stage">
        <AnimatePresence mode="wait" custom={dir} initial={false}>
          <motion.div
            key={step}
            custom={dir}
            initial={{ opacity: 0, x: 30 * dir }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 * dir }}
            transition={{ duration: 0.22 }}
            className="wizard-pane"
          >
            {step === 0 && (
              <div className="form">
                <label className="field">
                  <span>Give it a name</span>
                  <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} autoFocus />
                </label>
                <label className="field">
                  <span>Shopper ID</span>
                  <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={64} />
                  <small>The household or customer this rule belongs to.</small>
                </label>
                <div className="field">
                  <span>Which AI agent can use it?</span>
                  <div className="choice-grid">
                    <button type="button" className={`choice ${agentId === '' ? 'on' : ''}`} onClick={() => setAgentId('')}>
                      <KeyRound size={18} />
                      <b>Any agent</b>
                      <small>Whoever holds the key</small>
                    </button>
                    {agents.map((a) => (
                      <button key={a.id} type="button" className={`choice ${agentId === a.id ? 'on' : ''}`} onClick={() => setAgentId(a.id)}>
                        <AgentAvatar protocol={a.protocol} size={26} />
                        <b>{a.name}</b>
                        <small>Only {a.name}</small>
                      </button>
                    ))}
                  </div>
                </div>
                <label className="field">
                  <span>Valid for {days} days</span>
                  <input type="range" min={1} max={90} value={days} onChange={(e) => setDays(Number(e.target.value))} />
                </label>
              </div>
            )}

            {step === 1 && (
              <div className="form">
                <Slider label="Total budget" value={budget} min={500} max={50000} step={500} onChange={(v) => {
                  setBudget(v);
                  if (maxOrder > v) setMaxOrder(v);
                }} help="The most the agent can spend overall before the rule runs out." />
                <Slider label="Limit per order" value={maxOrder} min={100} max={budget} step={100} onChange={setMaxOrder} help="Bigger orders need the shopper’s approval." />
              </div>
            )}

            {step === 2 && (
              <div className="form">
                <div className="preset-row">
                  {Object.entries(PRESETS).map(([k, p]) => (
                    <button key={k} type="button" className="preset" onClick={() => setRules(p.rules)}>
                      <b>{p.label}</b>
                      <small>{p.help}</small>
                    </button>
                  ))}
                </div>
                <div className="cat-rules">
                  {CATEGORIES.map((c) => (
                    <div key={c} className="cat-rule">
                      <span className="cat-rule-name">
                        <CategoryIcon category={c} size={16} />
                        {titleCase(c)}
                      </span>
                      <div className="level-picker" role="radiogroup" aria-label={`${titleCase(c)} permission`}>
                        {AUTONOMY_LEVELS.map((l) => (
                          <button key={l} type="button" role="radio" aria-checked={rules[c] === l} className={`lv-${l} ${rules[c] === l ? 'on' : ''}`} onClick={() => setRules({ ...rules, [c]: l })} title={AUTONOMY_META[l].help}>
                            {rules[c] === l && <motion.span layoutId={`lv-${c}`} className="level-bg" transition={{ type: 'spring', stiffness: 500, damping: 36 }} />}
                            <span>{AUTONOMY_META[l].short}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="form">
                <div className="field">
                  <span>Never buy anything containing…</span>
                  <div className="chips">
                    {HEALTH_TAGS.map(({ tag, label: l }) => {
                      const on = tags.includes(tag);
                      return (
                        <motion.button key={tag} type="button" whileTap={{ scale: 0.94 }} className={`chip ${on ? 'on' : ''}`} onClick={() => setTags(on ? tags.filter((x) => x !== tag) : [...tags, tag])} aria-pressed={on}>
                          {on && <Check size={13} strokeWidth={3} />}
                          {l}
                        </motion.button>
                      );
                    })}
                  </div>
                  <small>The server refuses these items even if the agent is told otherwise.</small>
                </div>
                <label className="toggle-row">
                  <span>
                    <b>Ask before buying something new</b>
                    <small>Items this shopper has never bought need a one-tap approval, even in “Buy automatically” categories.</small>
                  </span>
                  <span className="switch">
                    <input type="checkbox" checked={escalateNew} onChange={(e) => setEscalateNew(e.target.checked)} />
                    <span />
                  </span>
                </label>
              </div>
            )}

            {step === 4 && (
              <div className="review-summary">
                <p className="big-sentence">
                  <b>{agentName}</b> may spend up to <b>{formatPaise(maxOrder * 100)}</b> per order and <b>{formatPaise(budget * 100)}</b> in total, for the next <b>{days} days</b>.
                </p>
                <ul className="summary-list">
                  <li>
                    <b>Buys automatically:</b> {autoCats.length ? autoCats.join(', ') : 'nothing'}
                  </li>
                  <li>
                    <b>Asks first:</b> {CATEGORIES.filter((c) => rules[c] === 'confirm').map(titleCase).join(', ') || 'nothing'}
                  </li>
                  <li>
                    <b>Only suggests:</b> {CATEGORIES.filter((c) => rules[c] === 'shortlist').map(titleCase).join(', ') || 'nothing'}
                  </li>
                  <li>
                    <b>Never buys:</b> {[...CATEGORIES.filter((c) => rules[c] === 'block').map(titleCase), ...tags.map((t) => HEALTH_TAGS.find((h) => h.tag === t)?.label ?? t)].join(', ') || 'nothing restricted'}
                  </li>
                  {escalateNew && <li>Asks before buying anything new</li>}
                </ul>
                <p className="small muted">
                  We’ll sign this with the store’s private key. The agent gets a key it can use but can’t change.
                </p>
                {err && <p className="text-bad">{err}</p>}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="wizard-foot">
        <button className="btn btn-ghost" onClick={() => go(step - 1)} disabled={step === 0}>
          <ArrowLeft size={16} /> Back
        </button>
        {step < STEP_TITLES.length - 1 ? (
          <button className="btn btn-primary" onClick={() => go(step + 1)} disabled={!canNext}>
            Next <ArrowRight size={16} />
          </button>
        ) : (
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            <ShieldCheck size={16} /> {busy ? 'Signing…' : 'Create & sign rule'}
          </button>
        )}
      </div>
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange, help }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; help: string }) {
  return (
    <label className="field slider-field">
      <span className="row-between">
        <span>{label}</span>
        <motion.b key={value} initial={{ scale: 1.15 }} animate={{ scale: 1 }} className="slider-value">
          {formatPaise(value * 100)}
        </motion.b>
      </span>
      <input type="range" min={min} max={max} step={step} value={Math.min(value, max)} onChange={(e) => onChange(Number(e.target.value))} />
      <small>{help}</small>
    </label>
  );
}
