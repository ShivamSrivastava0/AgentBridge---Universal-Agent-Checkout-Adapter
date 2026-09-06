import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { db } from '../db';
import { v4 as uuidv4 } from 'uuid';

export const mcpServer = new Server({
  name: "agent-bridge-mcp",
  version: "1.0.0"
}, {
  capabilities: {
    tools: {}
  }
});

// Setup tools
mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "search_products",
        description: "Search the merchant's catalog for products",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query for product name" }
          }
        }
      },
      {
        name: "create_order",
        description: "Create an order for a specific product",
        inputSchema: {
          type: "object",
          properties: {
            product_id: { type: "string" },
            quantity: { type: "number", default: 1 }
          },
          required: ["product_id"]
        }
      },
      {
        name: "get_order_status",
        description: "Check the status of an order",
        inputSchema: {
          type: "object",
          properties: {
            order_id: { type: "string" }
          },
          required: ["order_id"]
        }
      }
    ]
  };
});

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;

    if (name === 'search_products') {
      const query = args?.query as string || '';
      const products = db.prepare('SELECT * FROM Product WHERE name LIKE ?').all(`%${query}%`);
      return {
        content: [{ type: 'text', text: JSON.stringify(products, null, 2) }]
      };
    }

    if (name === 'create_order') {
      const productId = args?.product_id as string;
      const product = db.prepare('SELECT * FROM Product WHERE id = ?').get(productId) as any;
      
      if (!product) {
        return { content: [{ type: 'text', text: 'Product not found' }] };
      }

      const orderId = `ord_${uuidv4()}`;
      
      db.prepare(`
        INSERT INTO "Order" (id, merchant_id, agent_type, amount, status, flagged)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(orderId, product.merchant_id, 'mcp_claude', product.price, 'PENDING', 0);

      return {
        content: [{ type: 'text', text: JSON.stringify({ order_id: orderId, status: 'PENDING', amount: product.price }) }]
      };
    }

    if (name === 'get_order_status') {
      const orderId = args?.order_id as string;
      const order = db.prepare('SELECT * FROM "Order" WHERE id = ?').get(orderId);
      
      if (!order) {
        return { content: [{ type: 'text', text: 'Order not found' }] };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(order, null, 2) }]
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (err: any) {
    return {
      content: [{ type: 'text', text: `Error: ${err.message}` }],
      isError: true
    };
  }
});

// Since the MCP server typically runs via stdio, we might expose it separately, 
// or expose it over SSE (Server-Sent Events) via Express. 
// For this unified backend, if we want an Express endpoint, we'd need SSE.
// We'll provide a separate entrypoint for the stdio MCP server for demo purposes.

export async function runMcpServerStdio() {
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error("AgentBridge MCP Server running on stdio");
}
