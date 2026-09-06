import { db } from '../db';
import { v4 as uuidv4 } from 'uuid';

export function syncCatalogMock() {
  const merchantId = 'merchant_mock_1';
  
  // Ensure merchant exists
  const merchantStmt = db.prepare('INSERT OR IGNORE INTO Merchant (id, razorpay_key, catalog_synced_at) VALUES (?, ?, ?)');
  merchantStmt.run(merchantId, 'rzp_test_mock', new Date().toISOString());

  // Mock Products
  const products = [
    { name: 'AI Premium Subscription', price: 4900, currency: 'USD', stock: 100 }, // $49.00
    { name: 'Agent Compute Credits (1000)', price: 1500, currency: 'USD', stock: 5000 },
    { name: 'Enterprise API Access', price: 19900, currency: 'USD', stock: 50 }
  ];

  const insertProduct = db.prepare('INSERT OR REPLACE INTO Product (id, merchant_id, name, price, currency, stock) VALUES (?, ?, ?, ?, ?, ?)');
  
  for (const p of products) {
    // Generate a consistent ID based on name to avoid duplicates on re-sync
    const id = `prod_${p.name.replace(/\s+/g, '_').toLowerCase()}`;
    insertProduct.run(id, merchantId, p.name, p.price, p.currency, p.stock);
  }

  // Update sync time
  db.prepare('UPDATE Merchant SET catalog_synced_at = ? WHERE id = ?').run(new Date().toISOString(), merchantId);
  
  return { success: true, count: products.length };
}

export function getProducts() {
  const stmt = db.prepare('SELECT * FROM Product');
  return stmt.all();
}
