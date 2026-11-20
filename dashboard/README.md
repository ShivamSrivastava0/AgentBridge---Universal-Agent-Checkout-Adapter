# AgentBridge Console

Next.js merchant console for AgentBridge. See the [root README](../README.md) for the full picture.

Built for merchants first: plain-language statuses, hover explanations for every technical term, and animated feedback (Motion) throughout. Light and dark themes.

| Page | What it's for |
|---|---|
| **Home** | Getting-started checklist, animated "how an order works" pipeline, key numbers, decision breakdown, live activity |
| **Orders** / order page | Every agent purchase; progress stepper, plain-language rule checklist, history, technical details on demand |
| **Needs attention** | Orders held for your review (approve / reject) and orders waiting on the shopper |
| **Spending rules** | Budget rings per rule and a 5-step wizard to create one |
| **Products** | Card grid with stock levels; slide-in editor for price, stock and visibility |
| **Try it live** | Pick a situation and watch an AI assistant shop, step by step, through its real protocol |
| **Connect agents** | Setup guides for Claude, ChatGPT and Gemini |
| **Shopper page** (`/o/[id]`) | Where an agent sends its user to approve and pay |

The browser never talks to the API directly. Route handlers under `src/app/api/` proxy requests server-side and add the admin key or a demo agent key, so no secrets reach the client. Live updates use the API's Server-Sent Events stream.

```bash
cp .env.example .env.local   # optional; defaults match the API's dev defaults
npm install
npm run dev                  # http://localhost:3000 (expects the API on :3001)
```
