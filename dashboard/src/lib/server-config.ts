import 'server-only';

/** Server-side configuration. None of these values are ever sent to the browser. */
export const serverConfig = {
  apiUrl: (process.env.AGENTBRIDGE_API_URL ?? 'http://localhost:3001').replace(/\/$/, ''),
  adminKey: process.env.ADMIN_API_KEY ?? 'dev_admin_key_change_me_please',
  playgroundEnabled: (process.env.ENABLE_PLAYGROUND ?? 'true') === 'true',
  agentKeys: {
    claude: process.env.DEMO_AGENT_KEY_CLAUDE ?? 'ak_demo_claude_mcp_0001',
    chatgpt: process.env.DEMO_AGENT_KEY_CHATGPT ?? 'ak_demo_chatgpt_acp_0001',
    gemini: process.env.DEMO_AGENT_KEY_GEMINI ?? 'ak_demo_gemini_ap2_0001',
  } as Record<string, string>,
};

/** Forward a request to the AgentBridge API, streaming the response back (works for SSE too). */
export async function forward(req: Request, target: string, headers: Record<string, string>): Promise<Response> {
  const url = new URL(req.url);
  const init: RequestInit & { duplex?: 'half' } = {
    method: req.method,
    headers: {
      ...headers,
      ...(req.headers.get('content-type') ? { 'content-type': req.headers.get('content-type')! } : {}),
      ...(req.headers.get('accept') ? { accept: req.headers.get('accept')! } : {}),
      ...(req.headers.get('idempotency-key') ? { 'idempotency-key': req.headers.get('idempotency-key')! } : {}),
    },
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text(),
    cache: 'no-store',
    signal: req.signal,
  };
  let upstream: Response;
  try {
    upstream = await fetch(`${serverConfig.apiUrl}${target}${url.search}`, init);
  } catch {
    return Response.json(
      { error: { code: 'upstream_unavailable', message: `AgentBridge API is not reachable at ${serverConfig.apiUrl}` } },
      { status: 502 },
    );
  }
  const out = new Headers();
  for (const h of ['content-type', 'cache-control', 'mcp-session-id']) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}
