import { mkdirSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

export type Row = Record<string, unknown>;

/** The minimal surface the app needs. Implemented by node-postgres and PGlite. */
export interface Queryable {
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Run one or more statements without parameters (used by migrations). */
  exec(sql: string): Promise<void>;
}

export interface Database extends Queryable {
  readonly kind: 'postgres' | 'pglite';
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

class PgDatabase implements Database {
  readonly kind = 'postgres' as const;
  constructor(private readonly pool: pg.Pool) {}

  async query<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.pool.query(sql, params);
    return res.rows as T[];
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn({
        query: async <R = Row>(sql: string, params: unknown[] = []) =>
          (await client.query(sql, params)).rows as R[],
        exec: async (sql: string) => {
          await client.query(sql);
        },
      });
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  close() {
    return this.pool.end();
  }
}

class PgliteDatabase implements Database {
  readonly kind = 'pglite' as const;
  constructor(private readonly db: PGlite) {}

  async query<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.db.query<T>(sql, params);
    return res.rows;
  }

  async exec(sql: string): Promise<void> {
    await this.db.exec(sql);
  }

  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) =>
      fn({
        query: async <R = Row>(sql: string, params: unknown[] = []) => (await tx.query<R>(sql, params)).rows,
        exec: async (sql: string) => {
          await tx.exec(sql);
        },
      }),
    );
  }

  close() {
    return this.db.close();
  }
}

export async function createDatabase(opts: { url?: string | undefined; dataDir?: string } = {}): Promise<Database> {
  const url = opts.url ?? env.DATABASE_URL;
  if (url) {
    // BIGINT/NUMERIC aggregates come back as strings from node-postgres; we cast to int in SQL instead.
    const pool = new pg.Pool({
      connectionString: url,
      max: 10,
      ssl: /sslmode=require|neon\.tech|supabase/.test(url) ? { rejectUnauthorized: false } : undefined,
    });
    logger.info('database: connected to Postgres');
    return new PgDatabase(pool);
  }

  const dataDir = opts.dataDir ?? env.PGLITE_DATA_DIR;
  if (dataDir.startsWith('memory://')) {
    return new PgliteDatabase(await PGlite.create());
  }
  const resolved = path.resolve(dataDir);
  mkdirSync(resolved, { recursive: true });
  logger.info({ dataDir: resolved }, 'database: using embedded Postgres (PGlite)');
  return new PgliteDatabase(await PGlite.create(resolved));
}
