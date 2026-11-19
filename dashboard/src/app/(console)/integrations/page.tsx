import type { Metadata } from 'next';
import { serverConfig } from '@/lib/server-config';
import { formatPaise } from '@/lib/format';
import type { Agent } from '@/lib/types';

export const metadata: Metadata = { title: 'Integrations' };
export const dynamic = 'force-dynamic';

interface Discovery {
  merchant_id: string;
  protocols: {
    acp: { feed: string; checkout_sessions: string };
    mcp: { transport: string; url: string };
    ap2: { checkout: string; verify: string };
  };
  mandates: { issuer: string; jwks_uri: string; alg: string };
}

async function load() {
  try {
    const [doc, agents] = await Promise.all([
      fetch(`${serverConfig.apiUrl}/.well-known/agentbridge.json`, { cache: 'no-store' }).then((r) => r.json() as Promise<Discovery>),
      fetch(`${serverConfig.apiUrl}/admin/agents`, { cache: 'no-store', headers: { 'x-admin-key': serverConfig.adminKey } }).then(
        (r) => r.json() as Promise<{ agents: Agent[] }>,
      ),
    ]);
    return { doc, agents: agents.agents };
  } catch {
    return null;
  }
}

export default async function IntegrationsPage() {
  const data = await load();
  if (!data) {
    return (
      <div className="alert alert-bad">
        <div>
          <strong>AgentBridge API is not reachable</strong> at <span className="mono">{serverConfig.apiUrl}</span>. Start it with{' '}
          <span className="mono">npm run dev</span> in <span className="mono">backend/</span>.
        </div>
      </div>
    );
  }
  const { doc, agents } = data;
  const claudeDesktop = JSON.stringify(
    {
      mcpServers: {
        agentbridge: {
          command: 'npx',
          args: ['tsx', 'src/mcp-stdio.ts'],
          cwd: '<path-to>/AgentBridge/backend',
          env: { AGENTBRIDGE_URL: doc.protocols.mcp.url.replace(/\/mcp$/, ''), AGENTBRIDGE_AGENT_KEY: '<agent api key>' },
        },
      },
    },
    null,
    2,
  );

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">
            CONNECT ONCE <span className="eyebrow-rule" />
          </p>
          <h1>Integrations</h1>
          <p className="page-description">
            One catalog, one policy engine, one settlement path, exposed in the language each agent platform speaks. Agents authenticate with their own
            API key; mandates are verified with the public keys below.
          </p>
        </div>
      </section>

      <div className="grid-1-1">
        <section className="section-block">
          <div className="section-heading">
            <div>
              <p className="section-kicker">
                <span className="protocol-tag protocol-mcp">MCP</span> CLAUDE &amp; ANY MCP CLIENT
              </p>
              <h2>Model Context Protocol</h2>
            </div>
          </div>
          <div className="card-body">
            <p className="small">
              Streamable HTTP endpoint: <code>{doc.protocols.mcp.url}</code>. Tools: <code>search_products</code>, <code>list_categories</code>,{' '}
              <code>quote_cart</code>, <code>checkout</code>, <code>get_order_status</code>.
            </p>
            <p className="label">Claude Desktop (stdio bridge)</p>
            <pre className="code">{claudeDesktop}</pre>
          </div>
        </section>

        <section className="section-block">
          <div className="section-heading">
            <div>
              <p className="section-kicker">
                <span className="protocol-tag protocol-acp">ACP</span> CHATGPT
              </p>
              <h2>Agentic Commerce Protocol</h2>
            </div>
          </div>
          <div className="card-body">
            <p className="small">
              Product feed <code>{doc.protocols.acp.feed}</code> and checkout sessions at <code>{doc.protocols.acp.checkout_sessions}</code>. Pass an intent
              mandate as <code>payment_data.token</code> on <code>/complete</code>.
            </p>
            <pre className="code">{`curl -X POST ${doc.protocols.acp.checkout_sessions} \\
  -H "Authorization: Bearer <agent api key>" \\
  -H "Content-Type: application/json" \\
  -d '{"items":[{"id":"prd_dry_milk_1","quantity":2}]}'`}</pre>
          </div>
        </section>

        <section className="section-block">
          <div className="section-heading">
            <div>
              <p className="section-kicker">
                <span className="protocol-tag protocol-ap2">AP2</span> GEMINI
              </p>
              <h2>Agent Payments Protocol</h2>
            </div>
          </div>
          <div className="card-body">
            <p className="small">
              Present a signed intent mandate with the cart at <code>{doc.protocols.ap2.checkout}</code>. If policy allows, the response carries a
              single-use <strong>cart mandate</strong> bound to the cart’s sha256 hash.
            </p>
            <pre className="code">{`curl -X POST ${doc.protocols.ap2.checkout} \\
  -H "Authorization: Bearer <agent api key>" \\
  -H "Content-Type: application/json" \\
  -d '{"intent_mandate":"<jwt>","cart":{"items":[{"product_id":"prd_bev_tea","quantity":1}]}}'`}</pre>
          </div>
        </section>

        <section className="section-block">
          <div className="section-heading">
            <div>
              <p className="section-kicker">TRUST</p>
              <h2>Mandate verification</h2>
            </div>
          </div>
          <div className="card-body">
            <dl className="facts">
              <dt>Issuer</dt>
              <dd className="mono">{doc.mandates.issuer}</dd>
              <dt>Algorithm</dt>
              <dd className="mono">{doc.mandates.alg} (ECDSA P-256)</dd>
              <dt>Public keys</dt>
              <dd className="mono">
                <a href={doc.mandates.jwks_uri} target="_blank" rel="noreferrer">
                  {doc.mandates.jwks_uri}
                </a>
              </dd>
              <dt>Discovery</dt>
              <dd className="mono">/.well-known/agentbridge.json</dd>
            </dl>
            <p className="muted small">Anyone can verify a mandate with the public key; only the wallet holding the private key can issue one.</p>
          </div>
        </section>
      </div>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <p className="section-kicker">REGISTERED</p>
            <h2>Agents</h2>
          </div>
        </div>
        <div className="table-frame">
          <table className="data-table">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Protocol</th>
                <th>API key</th>
                <th className="num">Orders</th>
                <th className="num">Blocked</th>
                <th className="num">Paid volume</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.id}>
                  <td>
                    <strong>{a.name}</strong>
                    <span className="sub">{a.platform}</span>
                  </td>
                  <td>
                    <span className={`protocol-tag protocol-${a.protocol}`}>{a.protocol.toUpperCase()}</span>
                  </td>
                  <td className="mono">{a.key_prefix}…</td>
                  <td className="num">{a.orders}</td>
                  <td className="num">{a.blocked}</td>
                  <td className="num mono">{formatPaise(a.paid_volume_paise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
