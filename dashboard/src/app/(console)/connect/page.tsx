import type { Metadata } from 'next';
import { serverConfig } from '@/lib/server-config';
import type { Agent } from '@/lib/types';
import { ConnectView, type Discovery } from './ConnectView';

export const metadata: Metadata = { title: 'Connect agents' };
export const dynamic = 'force-dynamic';

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

export default async function ConnectPage() {
  const data = await load();
  return <ConnectView data={data} apiUrl={serverConfig.apiUrl} />;
}
