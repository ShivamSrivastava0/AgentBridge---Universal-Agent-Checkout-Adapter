import { Router } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { CartItemInput, type Agent } from '../domain/types.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { formatPaise } from '../lib/money.js';
import { agentRateLimit, requireAgent } from '../http/middleware.js';
import { buildQuote, listCategories, searchProducts } from '../services/catalog.js';
import { agentOrderView, getOrderWithItems, placeOrder } from '../services/orders.js';

const INSTRUCTIONS = `You are shopping at Northstar Essentials through AgentBridge.
- Prices are in Indian rupees; amounts in tool results are integer paise (₹1 = 100 paise).
- Always call quote_cart before checkout and tell the user the total.
- Pass the user's mandate_token to checkout if they gave you one. Without it, every order needs the user's approval.
- If checkout returns pending_approval, give the user the approval_url. Do not retry or split the order to get around a rule.
- Taste-driven categories (footwear, apparel, electronics) are shortlist-only: suggest options and let the user choose.`;

function json(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function toolError(err: unknown) {
  const message = err instanceof AppError ? `${err.code}: ${err.message}` : 'internal_error: tool failed';
  if (!(err instanceof AppError)) logger.error({ err }, 'mcp: tool failed');
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

/** One MCP server per authenticated agent; the tools close over the agent identity. */
export function createMcpServer(ctx: AppContext, agent: Agent): McpServer {
  const server = new McpServer({ name: 'agentbridge', version: '2.0.0' }, { instructions: INSTRUCTIONS });

  server.registerTool(
    'search_products',
    {
      title: 'Search products',
      description: 'Search the store catalog. Filter by text, category, max price (paise), and tags to exclude (e.g. "contains:peanuts").',
      inputSchema: {
        query: z.string().max(100).optional().describe('Free-text search, e.g. "toor dal" or "milk"'),
        category: z.string().optional().describe('Exact category, see list_categories'),
        max_price_paise: z.number().int().positive().optional(),
        exclude_tags: z.array(z.string()).optional().describe('Exclude products carrying any of these tags'),
        limit: z.number().int().min(1).max(50).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (a) => {
      try {
        const products = await searchProducts(ctx.db, ctx.merchantId, {
          query: a.query,
          category: a.category,
          maxPricePaise: a.max_price_paise,
          excludeTags: a.exclude_tags,
          limit: a.limit ?? 20,
        });
        return json(
          products.map((p) => ({
            product_id: p.id,
            name: p.name,
            brand: p.brand,
            category: p.category,
            unit: p.unit,
            price_paise: p.price_paise,
            price: formatPaise(p.price_paise),
            in_stock: p.stock,
            tags: p.tags,
          })),
        );
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerTool(
    'list_categories',
    { title: 'List categories', description: 'List catalog categories with product counts.', annotations: { readOnlyHint: true } },
    async () => {
      try {
        return json(await listCategories(ctx.db, ctx.merchantId));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerTool(
    'quote_cart',
    {
      title: 'Price a cart',
      description: 'Price a cart server-side and check stock. Does not place an order.',
      inputSchema: { items: z.array(CartItemInput).min(1).max(50) },
      annotations: { readOnlyHint: true },
    },
    async ({ items }) => {
      try {
        const q = await buildQuote(ctx.db, ctx.merchantId, items);
        return json({ ...q, total: formatPaise(q.total_paise) });
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerTool(
    'checkout',
    {
      title: 'Checkout',
      description:
        'Place an order. AgentBridge checks the cart against the user’s spending mandate and fraud rules, then either pays it, holds it for user approval, or blocks it, and explains why.',
      inputSchema: {
        items: z.array(CartItemInput).min(1).max(50),
        mandate_token: z.string().optional().describe('Signed intent mandate the user gave you'),
        idempotency_key: z.string().max(100).optional().describe('Reuse the same key when retrying the same checkout'),
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async (a) => {
      try {
        const { order, items } = await placeOrder(ctx, {
          agent,
          protocol: 'mcp',
          items: a.items,
          mandateToken: a.mandate_token,
          idempotencyKey: a.idempotency_key,
        });
        const view = agentOrderView(ctx, order, items);
        const { cart_mandate: _omit, ...rest } = view; // keep tool output readable for the model
        return json(rest);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerTool(
    'get_order_status',
    {
      title: 'Order status',
      description: 'Get the current status of an order this agent placed.',
      inputSchema: { order_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ order_id }) => {
      try {
        const { order, items } = await getOrderWithItems(ctx.db, order_id);
        if (order.agent_id !== agent.id) throw new AppError('not_found', 'Order not found');
        const { cart_mandate: _omit, ...view } = agentOrderView(ctx, order, items);
        return json(view);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  return server;
}

/** MCP over Streamable HTTP (stateless): remote MCP clients such as Claude connect here. */
export function mcpRouter(ctx: AppContext): Router {
  const r = Router();
  r.post('/', agentRateLimit, requireAgent(ctx), async (req, res) => {
    const server = createMcpServer(ctx, req.agent!);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  const notAllowed = (_req: unknown, res: import('express').Response) =>
    res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed (stateless server)' }, id: null });
  r.get('/', notAllowed);
  r.delete('/', notAllowed);
  return r;
}
