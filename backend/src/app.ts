import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { DEFAULT_MERCHANT_ID, type AppContext } from './context.js';
import { createDatabase, type Database } from './db/client.js';
import { migrate } from './db/migrations.js';
import { seedDemo } from './db/seed.js';
import { adminRouter } from './http/admin.js';
import { errorHandler, requestLogger } from './http/middleware.js';
import { shopRouter } from './http/shop.js';
import { webhooksRouter } from './http/webhooks.js';
import { EventBus } from './lib/events.js';
import { RazorpayPayments, SimulatedPayments, type PaymentProvider } from './payments/provider.js';
import { acpRouter } from './protocols/acp.js';
import { ap2Router } from './protocols/ap2.js';
import { mcpRouter } from './protocols/mcp.js';
import { initSigningKey, publicJwks } from './trust/keys.js';

export async function createContext(overrides: Partial<AppContext> & { db?: Database } = {}): Promise<AppContext> {
  await initSigningKey();
  const db = overrides.db ?? (await createDatabase());
  await migrate(db);
  const payments: PaymentProvider =
    overrides.payments ??
    (env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET
      ? new RazorpayPayments(env.RAZORPAY_KEY_ID, env.RAZORPAY_KEY_SECRET, env.RAZORPAY_WEBHOOK_SECRET)
      : new SimulatedPayments());
  return {
    db,
    events: overrides.events ?? new EventBus(),
    payments,
    merchantId: overrides.merchantId ?? DEFAULT_MERCHANT_ID,
    approvalTtlMinutes: overrides.approvalTtlMinutes ?? env.ORDER_APPROVAL_TTL_MINUTES,
    publicAppUrl: overrides.publicAppUrl ?? env.PUBLIC_APP_URL,
    risk: overrides.risk ?? {
      highValuePaise: env.RISK_HIGH_VALUE_PAISE,
      velocityMaxOrders: env.RISK_VELOCITY_MAX_ORDERS,
      velocityWindowSeconds: env.RISK_VELOCITY_WINDOW_SECONDS,
      maxLineQuantity: 20,
    },
  };
}

/** Seeds with simulated payments so demo history never creates real gateway orders. */
export async function seed(ctx: AppContext) {
  await seedDemo({ ...ctx, payments: new SimulatedPayments() });
}

export function createApp(ctx: AppContext) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGINS.split(',').map((o) => o.trim()),
      exposedHeaders: ['Mcp-Session-Id'],
    }),
  );
  app.use(requestLogger);

  // Raw-body routes first (signature verification needs the exact bytes).
  app.use('/webhooks', webhooksRouter(ctx));
  app.use(express.json({ limit: '256kb' }));

  app.get('/health', async (_req, res) => {
    await ctx.db.query('SELECT 1');
    res.json({ status: 'ok', database: ctx.db.kind, payments: ctx.payments.mode });
  });

  app.get('/.well-known/jwks.json', (_req, res) => {
    res.set('Cache-Control', 'public, max-age=300').json(publicJwks());
  });

  /** Discovery document: everything an agent platform needs to integrate. */
  app.get('/.well-known/agentbridge.json', (_req, res) => {
    const base = env.PUBLIC_API_URL;
    res.json({
      merchant_id: ctx.merchantId,
      name: 'Northstar Essentials',
      currency: 'INR',
      protocols: {
        acp: { feed: `${base}/acp/feed`, checkout_sessions: `${base}/acp/checkout_sessions` },
        mcp: { transport: 'streamable-http', url: `${base}/mcp` },
        ap2: { checkout: `${base}/ap2/checkout`, verify: `${base}/ap2/mandates/verify` },
      },
      mandates: { issuer: env.MANDATE_ISSUER, jwks_uri: `${base}/.well-known/jwks.json`, alg: 'ES256' },
      auth: 'Authorization: Bearer <agent api key>',
    });
  });

  app.use('/acp', acpRouter(ctx));
  app.use('/mcp', mcpRouter(ctx));
  app.use('/ap2', ap2Router(ctx));
  app.use('/shop', shopRouter(ctx));
  app.use('/admin', adminRouter(ctx));

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'Route not found' } });
  });
  app.use(errorHandler);
  return app;
}
