import type { Database } from './db/client.js';
import type { EventBus } from './lib/events.js';
import type { PaymentProvider } from './payments/provider.js';
import type { RiskConfig } from './trust/policy.js';

/** Everything a service needs, passed explicitly so tests can swap any part. */
export interface AppContext {
  db: Database;
  events: EventBus;
  payments: PaymentProvider;
  risk: RiskConfig;
  merchantId: string;
  approvalTtlMinutes: number;
  publicAppUrl: string;
}

export const DEFAULT_MERCHANT_ID = 'mer_northstar';
