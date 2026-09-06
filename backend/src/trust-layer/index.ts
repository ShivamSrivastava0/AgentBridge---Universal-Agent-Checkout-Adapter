import { Router } from 'express';
import { db } from '../db';
import { v4 as uuidv4 } from 'uuid';

export const trustRoutes = Router();

// Simple Rule-Based Engine for Trust & Fraud
export function evaluateOrder(orderId: string) {
  const order = db.prepare('SELECT * FROM "Order" WHERE id = ?').get(orderId) as any;
  if (!order) return { error: 'Order not found' };

  let flagged = false;
  let reasons: string[] = [];

  // Rule 1: High value transaction
  if (order.amount > 100000) { // > $1000.00
    flagged = true;
    reasons.push('High value transaction limit exceeded');
  }

  // Rule 2: Mandate limit check
  if (order.mandate_id) {
    const mandate = db.prepare('SELECT * FROM Mandate WHERE id = ?').get(order.mandate_id) as any;
    if (mandate && order.amount > mandate.max_amount) {
      flagged = true;
      reasons.push('Transaction amount exceeds mandate max limit');
    }
  }

  // Rule 3: Velocity Check (e.g. > 3 orders in last 5 minutes from same agent/merchant)
  const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const recentOrders = db.prepare(`
    SELECT count(*) as count FROM "Order" 
    WHERE merchant_id = ? AND agent_type = ? AND created_at > ?
  `).get(order.merchant_id, order.agent_type, fiveMinsAgo) as { count: number };

  if (recentOrders.count > 3) {
    flagged = true;
    reasons.push('High velocity: Too many orders in 5 minutes');
  }

  // Update order status if flagged
  if (flagged) {
    db.prepare('UPDATE "Order" SET flagged = 1, status = ? WHERE id = ?').run('FLAGGED', orderId);
    
    // Insert into FraudFlag
    const insertFlag = db.prepare('INSERT INTO FraudFlag (id, order_id, reason) VALUES (?, ?, ?)');
    for (const reason of reasons) {
      insertFlag.run(`flag_${uuidv4()}`, orderId, reason);
    }
  }

  return { flagged, reasons };
}

trustRoutes.post('/check', (req, res) => {
  const { orderId } = req.body;
  try {
    const result = evaluateOrder(orderId);
    if (result.error) return res.status(404).json(result);
    
    res.json({ orderId, status: 'checked', flagged: result.flagged, reasons: result.reasons });
  } catch (err: any) {
    res.status(500).json({ error: 'Trust check failed', details: err.message });
  }
});

// Settlement Mock endpoint (usually webhook from Razorpay)
trustRoutes.post('/settle', (req, res) => {
  const { orderId, razorpayPaymentId } = req.body;
  // Basic update
  try {
    const order = db.prepare('SELECT * FROM "Order" WHERE id = ?').get(orderId) as any;
    if (!order) return res.status(404).json({ error: 'Order not found' });
    
    if (order.flagged) {
      return res.status(400).json({ error: 'Cannot settle a flagged order' });
    }

    db.prepare('UPDATE "Order" SET status = ?, razorpay_order_id = ? WHERE id = ?')
      .run('COMPLETED', razorpayPaymentId, orderId);
    
    res.json({ status: 'settled', orderId });
  } catch (err) {
    res.status(500).json({ error: 'Settlement failed' });
  }
});
