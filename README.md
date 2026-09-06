# AgentBridge

AgentBridge is a unified API layer that allows merchants to connect their Razorpay catalog once and become checkout-ready across all major AI agent protocols. 

Every AI platform speaks a different checkout language:
- ChatGPT uses **ACP** (Agent Context Protocol)
- Claude uses **MCP** (Model Context Protocol)
- Google uses **AP2/UCP** (Cryptographic Mandates)

AgentBridge sits in the middle. It normalizes the catalog, exposes the correct tool schemas, verifies agent trust/fraud parameters, and settles everything into a single Razorpay account.

## Architecture

```
[AI Agents (ChatGPT, Claude, Gemini)]
        |
        v
[AgentBridge Adapter Core]  <----  [Razorpay Catalog]
        |
        v
[Trust & Fraud Engine] (Validates Mandates, Spending Velocity)
        |
        v
[Razorpay Settlement]
```

## Setup & Running

This project uses a monorepo-style structure:
- `backend/`: Node.js Express server (SQLite db)
- `dashboard/`: Next.js frontend

### 1. Start the Backend
```bash
cd backend
npm install
npm run dev
```

### 2. Start the Dashboard
```bash
cd dashboard
npm install
npm run dev
```

### 3. Demo the MCP Agent (Claude)
We include a demo script that instantiates a real Anthropic Claude agent and hooks it up to our MCP server to complete a purchase.
Ensure you have set `ANTHROPIC_API_KEY` in `backend/.env`.

```bash
cd backend
npx tsx src/demo/mcp_agent.ts
```

## Features Complete
- Canonical local SQLite db
- Mock Razorpay Catalog Sync
- ACP feed and checkout endpoints
- MCP tool definitions (`search_products`, `create_order`, `get_order_status`)
- AP2 Cryptographic Mandate Signing & Verification using JWTs
- Trust & Fraud engine flagging anomalies (e.g. Velocity checking, high-amount bounds)
- Glassmorphism Next.js Merchant Dashboard

*No real API keys are exposed in this repository.*
