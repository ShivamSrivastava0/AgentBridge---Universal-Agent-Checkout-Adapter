import { forward } from '@/lib/server-config';

/** Shopper approval page → AgentBridge shop API. Access is by the per-order token in the link. */
async function handler(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const token = req.headers.get('x-order-token') ?? '';
  return forward(req, `/shop/${path.map(encodeURIComponent).join('/')}`, { 'x-order-token': token });
}

export const dynamic = 'force-dynamic';
export { handler as GET, handler as POST };
