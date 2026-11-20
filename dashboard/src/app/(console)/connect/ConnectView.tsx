'use client';

import { AnimatePresence, motion } from 'motion/react';
import { BadgeCheck, Fingerprint, Lock, Plug, ServerCrash } from 'lucide-react';
import { useState } from 'react';
import { AgentAvatar } from '@/components/icons';
import { Card, CopyButton, Disclosure, EmptyState, PageHeader, Reveal, Tabs, Term } from '@/components/ui';
import { GLOSSARY, PROTOCOL_META, formatPaise, timeAgo } from '@/lib/format';
import type { Agent, Protocol } from '@/lib/types';

export interface Discovery {
  merchant_id: string;
  protocols: {
    acp: { feed: string; checkout_sessions: string };
    mcp: { transport: string; url: string };
    ap2: { checkout: string; verify: string };
  };
  mandates: { issuer: string; jwks_uri: string; alg: string };
}

export function ConnectView({ data, apiUrl }: { data: { doc: Discovery; agents: Agent[] } | null; apiUrl: string }) {
  const [tab, setTab] = useState<Protocol>('mcp');

  if (!data) {
    return (
      <>
        <PageHeader icon={Plug} title="Connect agents" />
        <section className="card">
          <EmptyState icon={ServerCrash} title="Can’t reach the AgentBridge API">
            Start it with <code>npm run dev</code> in <code>backend/</code> (expected at <code>{apiUrl}</code>).
          </EmptyState>
        </section>
      </>
    );
  }
  const { doc, agents } = data;
  const base = doc.protocols.mcp.url.replace(/\/mcp$/, '');

  const guides: Record<Protocol, { steps: { title: string; text: string; code?: string }[] }> = {
    mcp: {
      steps: [
        { title: 'Add AgentBridge to Claude Desktop', text: 'Paste this into Settings → Developer → Edit config, then restart Claude.', code: JSON.stringify({ mcpServers: { agentbridge: { command: 'npx', args: ['tsx', 'src/mcp-stdio.ts'], cwd: '<path-to>/AgentBridge/backend', env: { AGENTBRIDGE_URL: base, AGENTBRIDGE_AGENT_KEY: '<agent key>' } } } }, null, 2) },
        { title: 'Or connect any MCP client over HTTP', text: 'Point it at this URL and send the agent key as a Bearer token.', code: doc.protocols.mcp.url },
        { title: 'Give Claude a spending rule', text: 'Copy a key from Spending rules and tell Claude to use it at checkout. Without one, every order waits for the shopper.' },
      ],
    },
    acp: {
      steps: [
        { title: 'Share your product feed', text: 'ChatGPT reads your catalog from this public feed.', code: doc.protocols.acp.feed },
        {
          title: 'Checkout sessions',
          text: 'ChatGPT creates a checkout session, then completes it. The spending rule goes in payment_data.token.',
          code: `curl -X POST ${doc.protocols.acp.checkout_sessions} \\\n  -H "Authorization: Bearer <agent key>" \\\n  -H "Content-Type: application/json" \\\n  -d '{"items":[{"id":"prd_dry_milk_1","quantity":2}]}'`,
        },
      ],
    },
    ap2: {
      steps: [
        { title: 'Verify a spending rule', text: 'Gemini can check a rule is valid before relying on it.', code: doc.protocols.ap2.verify },
        {
          title: 'Checkout with the rule attached',
          text: 'If the rules allow it, the reply includes a signed approval for that exact cart.',
          code: `curl -X POST ${doc.protocols.ap2.checkout} \\\n  -H "Authorization: Bearer <agent key>" \\\n  -H "Content-Type: application/json" \\\n  -d '{"intent_mandate":"<spending rule key>","cart":{"items":[{"product_id":"prd_bev_tea","quantity":1}]}}'`,
        },
      ],
    },
  };

  return (
    <>
      <PageHeader
        icon={Plug}
        title="Connect agents"
        description={
          <>
            Each AI assistant shops in its own <Term tip={GLOSSARY.protocols}>protocol</Term>. AgentBridge speaks all three, so you connect once and every order follows the same rules.
          </>
        }
      />

      <Reveal className="agent-cards">
        {agents.map((a) => (
          <motion.article key={a.id} className="card agent-card" variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }} whileHover={{ y: -3 }}>
            <div className="row">
              <AgentAvatar protocol={a.protocol} size={44} />
              <div>
                <b>{a.name}</b>
                <span className="muted small">
                  {a.platform} · {PROTOCOL_META[a.protocol].name}
                </span>
              </div>
              <span className={`pill pill-sm ${a.status === 'active' ? 'tone-good' : 'tone-muted'}`}>{a.status === 'active' ? 'Connected' : 'Disabled'}</span>
            </div>
            <div className="agent-stats">
              <span>
                <b>{a.orders}</b> orders
              </span>
              <span>
                <b>{formatPaise(a.paid_volume_paise)}</b> paid
              </span>
              <span>
                <b>{a.blocked}</b> blocked
              </span>
            </div>
            <span className="muted small">
              Key <span className="mono">{a.key_prefix}…</span> · {a.last_seen_at ? `last active ${timeAgo(a.last_seen_at)}` : 'not used yet'}
            </span>
          </motion.article>
        ))}
      </Reveal>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Setup guide</h2>
            <p>Pick an assistant to see how to connect it.</p>
          </div>
        </div>
        <div className="card-pad">
          <Tabs
            label="Assistant"
            value={tab}
            onChange={setTab}
            items={(['mcp', 'acp', 'ap2'] as const).map((p) => ({ value: p, label: `${PROTOCOL_META[p].agent} · ${PROTOCOL_META[p].short}` }))}
          />
          <AnimatePresence mode="wait">
            <motion.ol key={tab} className="guide" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
              {guides[tab].steps.map((s, i) => (
                <li key={s.title}>
                  <span className="guide-num">{i + 1}</span>
                  <div className="guide-body">
                    <b>{s.title}</b>
                    <span className="muted">{s.text}</span>
                    {s.code && (
                      <div className="code-block">
                        <pre className="code">{s.code}</pre>
                        <CopyButton value={s.code} />
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </motion.ol>
          </AnimatePresence>
        </div>
      </section>

      <Reveal className="grid-3">
        <Card title={<span className="row-inline"><Lock size={17} /> Can’t be forged</span>}>
          <p className="muted small">Spending rules are signed with your store’s private key (ES256). Change a single number and the signature breaks, so the order is refused.</p>
        </Card>
        <Card title={<span className="row-inline"><Fingerprint size={17} /> One cart, one payment</span>}>
          <p className="muted small">Every approval is tied to the exact cart and can only be used once. Edited or replayed carts can’t be charged.</p>
        </Card>
        <Card title={<span className="row-inline"><BadgeCheck size={17} /> Anyone can verify</span>}>
          <p className="muted small">Public keys are published so any platform can check a rule is genuine without being able to create one.</p>
        </Card>
      </Reveal>

      <Disclosure title="Developer reference">
        <dl className="facts">
          <dt>Discovery</dt>
          <dd className="mono break">{base}/.well-known/agentbridge.json</dd>
          <dt>Public keys</dt>
          <dd className="mono break">{doc.mandates.jwks_uri}</dd>
          <dt>Issuer</dt>
          <dd className="mono">{doc.mandates.issuer}</dd>
          <dt>Signing</dt>
          <dd className="mono">{doc.mandates.alg} (ECDSA P-256)</dd>
          <dt>Auth</dt>
          <dd className="mono">Authorization: Bearer &lt;agent key&gt;</dd>
        </dl>
      </Disclosure>
    </>
  );
}
