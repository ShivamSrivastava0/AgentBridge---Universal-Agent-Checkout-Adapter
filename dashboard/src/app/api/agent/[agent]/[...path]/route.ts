import { forward, serverConfig } from '@/lib/server-config';

const ALLOWED_ROOTS = new Set(['acp', 'ap2', 'mcp']);

/**
 * Playground → protocol endpoints, acting as one of the demo agents.
 * Lets the console exercise the real ACP / MCP / AP2 APIs without exposing agent keys.
 */
async function handler(req: Request, ctx: { params: Promise<{ agent: string; path: string[] }> }) {
  if (!serverConfig.playgroundEnabled) return Response.json({ error: { message: 'Playground disabled' } }, { status: 404 });
  const { agent, path } = await ctx.params;
  const key = serverConfig.agentKeys[agent];
  if (!key || !ALLOWED_ROOTS.has(path[0] ?? '')) return Response.json({ error: { message: 'Not allowed' } }, { status: 404 });
  return forward(req, `/${path.map(encodeURIComponent).join('/')}`, { authorization: `Bearer ${key}` });
}

export const dynamic = 'force-dynamic';
export { handler as GET, handler as POST };
