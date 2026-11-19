# AgentBridge Console

Next.js merchant console for AgentBridge. See the [root README](../README.md) for the full picture.

- **Overview**: live metrics, paid volume, rules that fired, low stock
- **Orders / order detail**: decision trace, audit timeline, decoded cart mandate
- **Review queue**: approve or reject orders held by risk rules
- **Mandates**: issue, inspect and revoke signed spending mandates
- **Catalog**: edit price, stock and listing
- **Agent playground**: send real ACP / MCP / AP2 checkouts as ChatGPT, Claude or Gemini
- **Shopper page** (`/o/[id]`): where an agent sends its user to approve and pay

The browser never talks to the API directly. Route handlers under `src/app/api/` proxy requests server-side and add the admin key or a demo agent key, so no secrets reach the client. Live updates use the API's Server-Sent Events stream.

```bash
cp .env.example .env.local   # optional; defaults match the API's dev defaults
npm install
npm run dev                  # http://localhost:3000 (expects the API on :3001)
```
