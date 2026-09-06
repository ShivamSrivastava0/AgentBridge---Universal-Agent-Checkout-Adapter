import Database from 'better-sqlite3';
import path from 'path';

// Define DB path
const dbPath = path.resolve(__dirname, '../../data.db');

export const db = new Database(dbPath, { verbose: console.log });

export function initDb() {
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS Merchant (
      id TEXT PRIMARY KEY,
      razorpay_key TEXT,
      catalog_synced_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS Product (
      id TEXT PRIMARY KEY,
      merchant_id TEXT,
      name TEXT,
      price INTEGER, -- in cents/paise
      currency TEXT,
      stock INTEGER,
      FOREIGN KEY(merchant_id) REFERENCES Merchant(id)
    );

    CREATE TABLE IF NOT EXISTS Mandate (
      id TEXT PRIMARY KEY,
      agent_type TEXT,
      merchant_id TEXT,
      max_amount INTEGER,
      expiry DATETIME,
      signature TEXT,
      FOREIGN KEY(merchant_id) REFERENCES Merchant(id)
    );

    CREATE TABLE IF NOT EXISTS "Order" (
      id TEXT PRIMARY KEY,
      merchant_id TEXT,
      agent_type TEXT,
      mandate_id TEXT,
      amount INTEGER,
      status TEXT, -- PENDING, COMPLETED, FAILED, FLAGGED
      flagged BOOLEAN DEFAULT 0,
      razorpay_order_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(merchant_id) REFERENCES Merchant(id),
      FOREIGN KEY(mandate_id) REFERENCES Mandate(id)
    );

    CREATE TABLE IF NOT EXISTS FraudFlag (
      id TEXT PRIMARY KEY,
      order_id TEXT,
      reason TEXT,
      resolved BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(order_id) REFERENCES "Order"(id)
    );
  `);

  console.log("Database initialized successfully.");
}

// Types
export interface Product {
  id: string;
  merchant_id: string;
  name: string;
  price: number;
  currency: string;
  stock: number;
}

export interface Order {
  id: string;
  merchant_id: string;
  agent_type: string;
  mandate_id: string | null;
  amount: number;
  status: string;
  flagged: boolean;
  razorpay_order_id: string | null;
  created_at: string;
}
