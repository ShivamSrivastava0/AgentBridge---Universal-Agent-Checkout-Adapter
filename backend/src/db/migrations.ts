import type { Database } from './client.js';
import { logger } from '../lib/logger.js';

/**
 * Ordered, append-only schema migrations. Never edit a shipped migration;
 * add a new one instead.
 */
const MIGRATIONS: { id: string; sql: string }[] = [
  {
    id: '001_initial_schema',
    sql: /* sql */ `
      CREATE TABLE merchants (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        currency    TEXT NOT NULL DEFAULT 'INR',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE products (
        id           TEXT PRIMARY KEY,
        merchant_id  TEXT NOT NULL REFERENCES merchants(id),
        sku          TEXT NOT NULL,
        name         TEXT NOT NULL,
        brand        TEXT,
        description  TEXT NOT NULL DEFAULT '',
        category     TEXT NOT NULL,
        unit         TEXT NOT NULL DEFAULT '1 pc',
        price_paise  INTEGER NOT NULL CHECK (price_paise >= 0),
        currency     TEXT NOT NULL DEFAULT 'INR',
        stock        INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
        tags         TEXT[] NOT NULL DEFAULT '{}',
        active       BOOLEAN NOT NULL DEFAULT TRUE,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (merchant_id, sku)
      );
      CREATE INDEX products_category_idx ON products (merchant_id, category);

      CREATE TABLE agents (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        platform      TEXT NOT NULL,
        protocol      TEXT NOT NULL CHECK (protocol IN ('acp', 'mcp', 'ap2')),
        api_key_hash  TEXT NOT NULL UNIQUE,
        key_prefix    TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
        last_seen_at  TIMESTAMPTZ,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      -- Standing "intent" mandates a user grants to an agent. The signed token is
      -- the source of truth for limits; this row tracks revocation and spend.
      CREATE TABLE mandates (
        id                  TEXT PRIMARY KEY,
        merchant_id         TEXT NOT NULL REFERENCES merchants(id),
        subject             TEXT NOT NULL,
        agent_id            TEXT REFERENCES agents(id),
        label               TEXT NOT NULL,
        max_order_paise     INTEGER NOT NULL CHECK (max_order_paise > 0),
        budget_paise        INTEGER NOT NULL CHECK (budget_paise > 0),
        currency            TEXT NOT NULL DEFAULT 'INR',
        category_rules      JSONB NOT NULL DEFAULT '{}'::jsonb,
        default_level       TEXT NOT NULL,
        blocked_tags        TEXT[] NOT NULL DEFAULT '{}',
        escalate_new_items  BOOLEAN NOT NULL DEFAULT TRUE,
        token               TEXT NOT NULL,
        expires_at          TIMESTAMPTZ NOT NULL,
        revoked_at          TIMESTAMPTZ,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE orders (
        id                      TEXT PRIMARY KEY,
        merchant_id             TEXT NOT NULL REFERENCES merchants(id),
        agent_id                TEXT NOT NULL REFERENCES agents(id),
        protocol                TEXT NOT NULL CHECK (protocol IN ('acp', 'mcp', 'ap2')),
        status                  TEXT NOT NULL CHECK (status IN (
                                  'blocked', 'pending_approval', 'in_review', 'awaiting_payment',
                                  'paid', 'rejected', 'expired', 'cancelled')),
        subtotal_paise          INTEGER NOT NULL,
        total_paise             INTEGER NOT NULL,
        currency                TEXT NOT NULL,
        cart_hash               TEXT NOT NULL,
        buyer_ref               TEXT,
        intent_mandate_id       TEXT REFERENCES mandates(id),
        cart_mandate            TEXT,
        cart_mandate_jti        TEXT,
        requires_user_approval  BOOLEAN NOT NULL DEFAULT FALSE,
        risk_score              INTEGER NOT NULL DEFAULT 0,
        decision                JSONB NOT NULL,
        idempotency_key         TEXT,
        access_token_hash       TEXT NOT NULL,
        payment_provider        TEXT,
        payment_ref             TEXT,
        payment_id              TEXT,
        approval_expires_at     TIMESTAMPTZ,
        paid_at                 TIMESTAMPTZ,
        created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (agent_id, idempotency_key)
      );
      CREATE INDEX orders_status_idx ON orders (status, created_at DESC);
      CREATE INDEX orders_agent_recent_idx ON orders (agent_id, created_at DESC);
      CREATE INDEX orders_mandate_idx ON orders (intent_mandate_id);
      CREATE UNIQUE INDEX orders_payment_ref_idx ON orders (payment_ref) WHERE payment_ref IS NOT NULL;

      CREATE TABLE order_items (
        order_id          TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        line_no           INTEGER NOT NULL,
        product_id        TEXT NOT NULL REFERENCES products(id),
        sku               TEXT NOT NULL,
        name              TEXT NOT NULL,
        category          TEXT NOT NULL,
        tags              TEXT[] NOT NULL DEFAULT '{}',
        unit_price_paise  INTEGER NOT NULL,
        quantity          INTEGER NOT NULL CHECK (quantity > 0),
        line_total_paise  INTEGER NOT NULL,
        PRIMARY KEY (order_id, line_no)
      );
      CREATE INDEX order_items_product_idx ON order_items (product_id);

      -- Append-only audit trail of everything that happens to an order.
      CREATE TABLE order_events (
        id          BIGSERIAL PRIMARY KEY,
        order_id    TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        type        TEXT NOT NULL,
        actor       TEXT NOT NULL,
        data        JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX order_events_order_idx ON order_events (order_id, id);

      -- Replay protection: each cart mandate can settle exactly one payment.
      CREATE TABLE used_cart_mandates (
        jti        TEXT PRIMARY KEY,
        order_id   TEXT NOT NULL REFERENCES orders(id),
        used_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE checkout_sessions (
        id          TEXT PRIMARY KEY,
        agent_id    TEXT NOT NULL REFERENCES agents(id),
        merchant_id TEXT NOT NULL REFERENCES merchants(id),
        status      TEXT NOT NULL,
        items       JSONB NOT NULL,
        buyer       JSONB,
        order_id    TEXT REFERENCES orders(id),
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE webhook_events (
        id           TEXT PRIMARY KEY,
        provider     TEXT NOT NULL,
        type         TEXT NOT NULL,
        payload      JSONB NOT NULL,
        received_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `,
  },
];

export async function migrate(db: Database): Promise<void> {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const applied = new Set(
    (await db.query<{ id: string }>('SELECT id FROM schema_migrations')).map((r) => r.id),
  );
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    await db.tx(async (q) => {
      await q.exec(m.sql);
      await q.query('INSERT INTO schema_migrations (id) VALUES ($1)', [m.id]);
    });
    logger.info({ migration: m.id }, 'database: migration applied');
  }
}
