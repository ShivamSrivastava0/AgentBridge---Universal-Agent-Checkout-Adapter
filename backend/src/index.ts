import { createApp, createContext, seed } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { expireStaleOrders } from './services/orders.js';

async function main() {
  const ctx = await createContext();
  if (env.SEED_DEMO_DATA) await seed(ctx);

  const app = createApp(ctx);
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, db: ctx.db.kind, payments: ctx.payments.mode }, `AgentBridge API listening on ${env.PUBLIC_API_URL}`);
  });

  const sweeper = setInterval(() => {
    expireStaleOrders(ctx).catch((err) => logger.error({ err }, 'expiry sweep failed'));
  }, 60_000);

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    clearInterval(sweeper);
    server.close();
    await ctx.db.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
