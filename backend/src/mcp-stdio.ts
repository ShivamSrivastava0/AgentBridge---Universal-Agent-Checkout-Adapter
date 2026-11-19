/**
 * stdio ⇄ Streamable HTTP bridge for MCP clients that only launch local
 * processes (e.g. Claude Desktop's `command` config). It forwards every tool
 * call to the running AgentBridge API, so there is a single source of truth
 * and no second process touching the database.
 *
 *   AGENTBRIDGE_URL=http://localhost:3001 AGENTBRIDGE_AGENT_KEY=ak_... npm run mcp:stdio
 *
 * Nothing in this file may write to stdout except the MCP transport.
 */
import 'dotenv/config';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const baseUrl = process.env.AGENTBRIDGE_URL ?? 'http://localhost:3001';
const agentKey = process.env.AGENTBRIDGE_AGENT_KEY ?? process.env.DEMO_AGENT_KEY_CLAUDE ?? 'ak_demo_claude_mcp_0001';

async function main() {
  const upstream = new Client({ name: 'agentbridge-stdio-bridge', version: '2.0.0' });
  await upstream.connect(
    new StreamableHTTPClientTransport(new URL('/mcp', baseUrl), {
      requestInit: { headers: { Authorization: `Bearer ${agentKey}` } },
    }),
  );

  const server = new Server(
    { name: 'agentbridge', version: '2.0.0' },
    { capabilities: { tools: {} }, instructions: upstream.getInstructions() ?? '' },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => upstream.listTools());
  server.setRequestHandler(CallToolRequestSchema, async (req) =>
    upstream.callTool({ name: req.params.name, arguments: req.params.arguments ?? {} }),
  );

  await server.connect(new StdioServerTransport());
  process.stderr.write(`agentbridge stdio bridge → ${baseUrl}/mcp\n`);
}

main().catch((err) => {
  process.stderr.write(`bridge failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
