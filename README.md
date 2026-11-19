# AgentBridge

**One checkout for every AI agent, with cryptographic spending mandates so agents can buy for you without getting your wallet.**

ChatGPT, Claude and Gemini each speak a different commerce protocol (ACP, MCP, AP2). AgentBridge lets a merchant integrate **once** and accept orders from all three. Every order, whatever protocol it arrives on, goes through the same core:

1. **Price** the cart from the merchant's catalog (agent-supplied prices are never trusted).
2. **Verify** the user's signed **intent mandate** (ES256 JWT): budget, per-order cap, what the agent may buy on its own, what it may never buy.
3. **Decide** with an explainable policy engine: approve, ask the user, hold for fraud review, or block. Every decision lists the rule that produced it.
4. **Authorise** the exact cart with a single-use **cart mandate** bound to the cart's sha256 hash.
5. **Settle** through Razorpay (or a simulator). Settlement refuses a cart that changed or a mandate that was used before.

The demo merchant is a household-essentials store, which is where autonomous buying makes sense. The engine itself is domain-agnostic.

## The problem it solves: "buy me shoes under ₹5,000"

You don't want an agent picking shoes for you. You might want it to reorder milk. AgentBridge makes that distinction **enforceable by the server, not just suggested in a prompt**: each mandate sets an *autonomy level* per category.

| Level | Example | What the agent may do |
|---|---|---|
| `auto` | Milk, atta, detergent you've bought before | Buy within limits, no human needed |
| `confirm` | OTC medicine, baby products | Build the cart; the user approves with one tap |
| `shortlist` | Shoes, clothes, electronics | Only suggest; the user picks |
| `block` | Anything the user rules out | Never |

On top of that: **new items** (never bought by this household) always need approval; **blocked tags** such as `contains:peanuts` act as a health guardrail; and **risk rules** (high value, velocity, odd quantities) send orders to a merchant review queue.

## Architecture

```
   ChatGPT ──ACP──┐                         ┌── Policy engine (pure, explainable)
   Claude ───MCP──┼──► Protocol adapters ───┼── Mandate verification (ES256 / JWKS)
   Gemini ───AP2──┘         │               └── Risk rules (value, velocity, quantity)
                            ▼
                  Core checkout (one code path)
         quote → verify → decide → reserve stock → audit log
                            │
          ┌─────────────────┼──────────────────────┐
          ▼                 ▼                      ▼
   Cart mandate      Razorpay / simulator    Live events (SSE)
  (sha256-bound,    + verified webhooks      → merchant console
   single-use)
```

| Path | What |
|---|---|
| `backend/src/protocols/` | ACP checkout sessions, MCP server (Streamable HTTP), AP2 mandate checkout |
| `backend/src/services/orders.ts` | The single checkout path, approvals, review, settlement, expiry |
| `backend/src/trust/` | Policy engine, ES256 key management, intent and cart mandates |
| `backend/src/db/` | Postgres layer (node-postgres or embedded PGlite), migrations, seed |
| `backend/src/mcp-stdio.ts` | stdio ⇄ HTTP bridge so Claude Desktop can connect |
| `backend/src/demo/claude-agent.ts` | A real Claude agent shopping over MCP |
| `dashboard/` | Next.js merchant console, agent playground and shopper approval page |

## Engineering details

- **One code path for three protocols.** Each adapter only translates. Pricing, policy, stock and settlement live in one place and are tested once.
- **Asymmetric mandate signing.** Mandates are ES256 JWTs. Only the wallet's private key can issue one; anyone can verify with the public key at `/.well-known/jwks.json`. Forged or edited tokens fail signature verification.
- **Tamper and replay protection.** The cart mandate carries the cart's sha256 hash and a unique `jti`. Settlement recomputes the hash from stored line items and records the `jti`, so a modified cart or a reused mandate is refused.
- **Concurrency-safe money.** Integer paise everywhere. The mandate row is locked (`SELECT … FOR UPDATE`) during checkout so parallel orders can't overspend a budget. Stock is reserved atomically (`UPDATE … WHERE stock >= n`) and released on reject or expiry.
- **Idempotency.** Each agent's `idempotency_key` is unique per agent, ACP sessions complete once, and webhooks are de-duplicated by event id.
- **Verified payments.** Razorpay checkout signatures and webhook HMACs are checked over the raw body with constant-time comparison.
- **Auditability.** An append-only `order_events` log records every step, and each policy decision is stored with the full rule trace.
- **Secrets stay server-side.** The console talks to the API through a Next.js server proxy that adds the admin key, so the browser never sees admin or agent keys.
- **Tests.** 30 Vitest tests run against a real (in-memory) Postgres. They cover the policy engine, all three protocols, tampering, replay, concurrent budget spend, review, expiry and webhooks.

## Run it locally

Requires Node 20+. No database install needed: the API uses embedded Postgres (PGlite) unless you set `DATABASE_URL`.

```bash
# 1. API (http://localhost:3001). Seeds a catalog, three demo agents, purchase history and a mandate.
cd backend
npm install
npm run dev

# 2. Console (http://localhost:3000)
cd dashboard
npm install
npm run dev
```

Open the console and go to **Agent playground**. Each scenario sends a real ACP, MCP or AP2 request and shows the wire traffic and the decision:

| Scenario | Protocol | Result |
|---|---|---|
| Weekly restock | MCP | Paid automatically (repeat items under mandate) |
| Something new | ACP | Needs user approval (never bought paneer) |
| "Buy me running shoes" | AP2 | Shortlist only: the user picks |
| Peanut butter | MCP | Blocked (household blocks `contains:peanuts`) |
| Air fryer | ACP | Over the per-order cap and held for fraud review |
| Forged mandate | AP2 | Rejected: signature verification failed |
| No mandate | ACP | User approves via the shopper link, then pays |

### Use it from a real Claude agent

```bash
cd backend
# Copy a token from Console → Mandates → "Copy token"
ANTHROPIC_API_KEY=sk-ant-... MANDATE_TOKEN=ey... npm run demo:agent -- "Restock our usual milk and atta"
```

Or add it to Claude Desktop with the config shown on **Console → Integrations**.

### Tests

```bash
cd backend && npm test
```

## API surface

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /.well-known/agentbridge.json` | none | Discovery: protocol endpoints, issuer, JWKS |
| `GET /.well-known/jwks.json` | none | Public keys for mandate verification |
| `GET /acp/feed` | none | ACP product feed |
| `POST /acp/checkout_sessions[/:id[/complete\|/cancel]]` | agent key | ACP checkout sessions |
| `POST /mcp` | agent key | MCP Streamable HTTP: `search_products`, `quote_cart`, `checkout`, `get_order_status`, `list_categories` |
| `POST /ap2/mandates/verify`, `/ap2/cart`, `/ap2/checkout` | agent key | AP2 mandate flow |
| `/shop/orders/:id/*` | per-order token | Shopper approve / decline / pay |
| `POST /webhooks/razorpay` | HMAC signature | Payment confirmation |
| `/admin/*` | admin key | Merchant console API, including the live SSE stream at `/admin/events` |

## Configuration and deployment

Copy `backend/.env.example` and `dashboard/.env.example`. For production:

- Set `DATABASE_URL` (e.g. Neon Postgres). Migrations run on start.
- Set `ADMIN_API_KEY` and `APP_SECRET`, and set `MANDATE_SIGNING_JWK` from `npm run keys:generate`. The API refuses to start in production without them.
- Add Razorpay **test** keys to switch from simulated payments to real Checkout. Point the webhook at `/webhooks/razorpay`.
- Set `ENABLE_PLAYGROUND=false` on the console if it shouldn't act as demo agents.

The API is a plain Node service (`npm run build && npm start`), so Render, Railway or Fly all work. The console deploys to Vercel.

## Roadmap

- Merchant authentication and multi-merchant tenancy (the schema is already keyed by `merchant_id`)
- Tokenised recurring payments (Razorpay mandates) so approved orders can be captured without the user present in live mode
- Per-agent API key management in the console
- Third-party mandate issuers via remote JWKS
- Merchant catalog import (CSV / Razorpay catalog sync)
