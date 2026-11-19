import 'dotenv/config';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  /** Postgres connection string. When empty, an embedded Postgres (PGlite) is used. */
  DATABASE_URL: z.string().optional(),
  /** Directory for embedded Postgres data, or "memory://" for an in-memory database. */
  PGLITE_DATA_DIR: z.string().default('./.data/pg'),

  PUBLIC_API_URL: z.string().url().default('http://localhost:3001'),
  PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  /** Server secret used to derive per-order shopper access tokens. */
  APP_SECRET: z.string().min(16).default('dev_app_secret_change_me_please'),

  /** Secret the merchant console (dashboard server) uses to call admin endpoints. */
  ADMIN_API_KEY: z.string().min(16).default('dev_admin_key_change_me_please'),

  /** ES256 private JWK (JSON) used by the AgentBridge wallet to sign mandates. */
  MANDATE_SIGNING_JWK: z.string().optional(),
  MANDATE_KEY_FILE: z.string().default('./.data/mandate-signing-key.json'),
  MANDATE_ISSUER: z.string().default('urn:agentbridge:wallet'),

  /** Seed demo agents with these API keys (dev/demo only). */
  SEED_DEMO_DATA: bool.default(true),
  DEMO_AGENT_KEY_CLAUDE: z.string().default('ak_demo_claude_mcp_0001'),
  DEMO_AGENT_KEY_CHATGPT: z.string().default('ak_demo_chatgpt_acp_0001'),
  DEMO_AGENT_KEY_GEMINI: z.string().default('ak_demo_gemini_ap2_0001'),

  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

  RISK_HIGH_VALUE_PAISE: z.coerce.number().int().positive().default(500_000),
  RISK_VELOCITY_MAX_ORDERS: z.coerce.number().int().positive().default(5),
  RISK_VELOCITY_WINDOW_SECONDS: z.coerce.number().int().positive().default(300),
  ORDER_APPROVAL_TTL_MINUTES: z.coerce.number().int().positive().default(60),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production') {
    if (env.ADMIN_API_KEY.startsWith('dev_')) throw new Error('ADMIN_API_KEY must be set in production');
    if (env.APP_SECRET.startsWith('dev_')) throw new Error('APP_SECRET must be set in production');
    if (!env.MANDATE_SIGNING_JWK) throw new Error('MANDATE_SIGNING_JWK must be set in production');
  }
  return env;
}

export const env = loadEnv();

export const paymentsMode: 'razorpay' | 'simulated' =
  env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET ? 'razorpay' : 'simulated';
