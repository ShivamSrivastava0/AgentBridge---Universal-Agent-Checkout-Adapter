import { forward, serverConfig } from '@/lib/server-config';

/** Merchant console → AgentBridge admin API. The admin key is added here, server-side. */
async function handler(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return forward(req, `/admin/${path.map(encodeURIComponent).join('/')}`, { 'x-admin-key': serverConfig.adminKey });
}

export const dynamic = 'force-dynamic';
export { handler as GET, handler as POST, handler as PATCH };
