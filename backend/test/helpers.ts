import request from 'supertest';
import { createApp, createContext, seed } from '../src/app.js';
import type { AppContext } from '../src/context.js';
import { createDatabase } from '../src/db/client.js';
import { orderAccessToken } from '../src/services/orders.js';

export const KEYS = {
  claude: 'ak_demo_claude_mcp_0001',
  chatgpt: 'ak_demo_chatgpt_acp_0001',
  gemini: 'ak_demo_gemini_ap2_0001',
};
export const ADMIN = { 'x-admin-key': 'dev_admin_key_change_me_please' };

export async function setup(overrides: Partial<AppContext> = {}) {
  const db = await createDatabase({ dataDir: 'memory://' });
  const ctx = await createContext({ db, ...overrides });
  await seed(ctx);
  const app = createApp(ctx);
  const http = request(app);
  const [mandate] = await ctx.db.query<{ id: string; token: string }>('SELECT id, token FROM mandates LIMIT 1');
  return { ctx, app, http, mandate: mandate!, close: () => db.close() };
}

export function shopToken(orderId: string) {
  return orderAccessToken(orderId);
}

/** Call an MCP tool over Streamable HTTP and parse its JSON text result. */
export async function mcpCall(http: ReturnType<typeof request>, name: string, args: Record<string, unknown>, key = KEYS.claude) {
  const res = await http
    .post('/mcp')
    .set('Authorization', `Bearer ${key}`)
    .set('Accept', 'application/json, text/event-stream')
    .send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  const result = res.body.result as { content: { text: string }[]; isError?: boolean };
  const text = result.content[0]!.text;
  return { isError: !!result.isError, text, data: result.isError ? null : JSON.parse(text) };
}
