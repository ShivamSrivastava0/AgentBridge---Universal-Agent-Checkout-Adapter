import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

// Require Anthropic API Key
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Missing ANTHROPIC_API_KEY in .env");
  process.exit(1);
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

async function runDemo() {
  console.log("Starting MCP Agent Demo...");

  // 1. Connect to the MCP server
  // In a real environment, the MCP server might be a separate process.
  // Here we use npx tsx to run our server in a child process
  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', 'src/index.ts'],
    env: { ...process.env, START_MCP: 'true' }
  });

  const mcpClient = new Client({ name: "demo-client", version: "1.0.0" }, { capabilities: {} });
  await mcpClient.connect(transport);
  console.log("Connected to MCP Server via stdio");

  // 2. Fetch tools from MCP server
  const toolsResponse = await mcpClient.listTools();
  const mcpTools = toolsResponse.tools.map((t: any) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema
  }));

  console.log("Agent received tools:", mcpTools.map(t => t.name).join(', '));

  // 3. Prompt the agent
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: "Please find the Agent Compute Credits in the catalog and buy 1 of them." }
  ];

  console.log("User: Please find the Agent Compute Credits in the catalog and buy 1 of them.");

  let response = await anthropic.messages.create({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 1024,
    tools: mcpTools,
    messages
  });

  // 4. Handle Agent Tool Calls
  while (response.stop_reason === 'tool_use') {
    const toolUse = response.content.find(c => c.type === 'tool_use') as Anthropic.ToolUseBlock;
    console.log(`Agent wants to call tool: ${toolUse.name}`, toolUse.input);
    
    // Call our MCP Server
    const toolResult = await mcpClient.callTool({
      name: toolUse.name,
      arguments: toolUse.input as any
    });

    console.log(`Tool Result:`, toolResult.content);

    // Send back to agent
    messages.push({
      role: 'assistant',
      content: response.content
    });
    
    messages.push({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: typeof toolResult.content === 'string' ? toolResult.content : JSON.stringify(toolResult.content)
        }
      ]
    });

    response = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1024,
      tools: mcpTools,
      messages
    });
  }

  // 5. Final Answer
  const finalAnswer = response.content.find(c => c.type === 'text') as Anthropic.TextBlock;
  console.log("Agent Final Answer:");
  console.log(finalAnswer?.text);
  
  process.exit(0);
}

runDemo().catch(console.error);
