/** Drops all tables and re-runs migrations + demo seed. Refuses to run in production. */
import { createContext, seed } from '../app.js';
import { env } from '../config/env.js';
import { createDatabase } from '../db/client.js';

if (env.NODE_ENV === 'production') {
  process.stderr.write('Refusing to reset a production database.\n');
  process.exit(1);
}

const db = await createDatabase();
await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
const ctx = await createContext({ db });
await seed(ctx);
await db.close();
process.stderr.write('Database reset and demo data seeded.\n');
