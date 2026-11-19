/**
 * A real Claude agent shopping through AgentBridge over MCP (Streamable HTTP).
 *
 *   1. Start the API:           npm run dev
 *   2. Copy a mandate token from the console (Mandates page), then:
 *      ANTHROPIC_API_KEY=... MANDATE_TOKEN=ey... npm run demo:agent -- "Restock milk and atta for the week"
 *
 * The agent discovers the tools from the MCP server, plans a cart, and checks
 * out. AgentBridge, not the prompt, decides what it is allowed to buy.
 */
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const API = process.env.AGENTBRIDGE_URL ?? 'http://localhost:3001';
const AGENT_KEY = process.env.DEMO_AGENT_KEY_CLAUDE ?? 'ak_demo_claude_mcp_0001';
const MODEL = process.env.CLAUDE_MODEL ?? 'claude-opus-5-5';
const task = process.argv.slice(2).join(' ') || 'Restock our usual milk and atta for this week, and get us some running shoes.';
const mandate = process.env.MANDATE_TOKEN;

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

async function main() {
  const mcp = new Client({ name: 'agentbridge-claude-demo', version: '2.0.0' });
  await mcp.connect(
    new StreamableHTTPClientTransport(new URL('/mcp', API), {
      requestInit: { headers: { Authorization: `Bearer ${AGENT_KEY}` } },
    }),
  );
  const { tools } = await mcp.listTools();
  console.log(dim(`Connected to ${API}/mcp; tools: ${tools.map((t) => t.name).join(', ')}`));

  const anthropic = new Anthropic();
  const system = [
    mcp.getInstructions() ?? '',
    mandate
      ? `The user has granted you this spending mandate token. Pass it as mandate_token on checkout:\n${mandate}`
      : 'The user has not granted a mandate, so every order will need their approval.',
    'Be concise. Finish by telling the user exactly what was bought, what needs their approval (with the link), and what was refused and why.',
  ].join('\n\n');

  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: task }];
  console.log(`${bold('User:')} ${task}\n`);

  for (let turn = 0; turn < 12; turn++) {
    const response = await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      system,
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description ?? '',
        input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
      })),
      messages,
    });

    if (response.stop_reason === 'refusal') {
      console.log(`Claude declined the request (${response.stop_details?.category ?? 'unspecified'}).`);
      break;
    }

    messages.push({ role: 'assistant', content: response.content });
    for (const block of response.content) {
      if (block.type === 'text' && block.text.trim()) console.log(`${bold('Claude:')} ${block.text}\n`);
    }

    const calls = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    if (response.stop_reason !== 'tool_use' || calls.length === 0) break;

    // Run every tool call from this turn, then return all results in one message.
    const results = await Promise.all(
      calls.map(async (call): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        console.log(dim(`→ ${call.name} ${JSON.stringify(call.input).replace(mandate ?? '\0', '<mandate>').slice(0, 160)}`));
        try {
          const out = await mcp.callTool({ name: call.name, arguments: call.input as Record<string, unknown> });
          const text = (out.content as { type: string; text?: string }[]).map((c) => c.text ?? '').join('\n');
          console.log(dim(`← ${text.replace(/\s+/g, ' ').slice(0, 200)}\n`));
          return { type: 'tool_result', tool_use_id: call.id, content: text, is_error: !!out.isError };
        } catch (err) {
          return { type: 'tool_result', tool_use_id: call.id, content: String(err), is_error: true };
        }
      }),
    );
    messages.push({ role: 'user', content: results });
  }

  await mcp.close();
}

main().catch((err) => {
  if (err instanceof Anthropic.AuthenticationError) console.error('Set ANTHROPIC_API_KEY (or run `ant auth login`).');
  else console.error(err);
  process.exit(1);
});
