import type { Queryable } from '../db/client.js';
import type { Agent, Protocol } from '../domain/types.js';
import { sha256Hex } from '../lib/ids.js';

export async function authenticateAgent(q: Queryable, apiKey: string): Promise<Agent | null> {
  const [agent] = await q.query<Agent>(
    `UPDATE agents SET last_seen_at = now() WHERE api_key_hash = $1 AND status = 'active'
     RETURNING id, name, platform, protocol, status`,
    [sha256Hex(apiKey)],
  );
  return agent ?? null;
}

export async function upsertAgent(
  q: Queryable,
  a: { id: string; name: string; platform: string; protocol: Protocol; apiKey: string },
) {
  await q.query(
    `INSERT INTO agents (id, name, platform, protocol, api_key_hash, key_prefix)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (id) DO UPDATE SET api_key_hash = EXCLUDED.api_key_hash, key_prefix = EXCLUDED.key_prefix`,
    [a.id, a.name, a.platform, a.protocol, sha256Hex(a.apiKey), a.apiKey.slice(0, 12)],
  );
}

export async function listAgents(q: Queryable) {
  return q.query(
    `SELECT a.id, a.name, a.platform, a.protocol, a.status, a.key_prefix, a.last_seen_at, a.created_at,
       count(o.id)::int AS orders,
       coalesce(sum(o.total_paise) FILTER (WHERE o.status = 'paid'), 0)::int AS paid_volume_paise,
       count(o.id) FILTER (WHERE o.status = 'blocked')::int AS blocked
     FROM agents a LEFT JOIN orders o ON o.agent_id = a.id
     GROUP BY a.id ORDER BY a.created_at`,
  );
}
