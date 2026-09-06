import { Router } from 'express';
import { db } from '../db';

export const acpRoutes = Router();

// ACP product feed endpoint
acpRoutes.get('/feed', (req, res) => {
  try {
    const products = db.prepare('SELECT * FROM Product').all();
    
    // Format according to standard ACP feed requirements
    const feed = products.map((p: any) => ({
      id: p.id,
      title: p.name,
      price: {
        amount: p.price / 100, // typically feeds expect standard currency units, not cents
        currency: p.currency
      },
      availability: p.stock > 0 ? 'in_stock' : 'out_of_stock'
    }));

    res.json({ products: feed });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate ACP feed' });
  }
});

// ACP checkout endpoint
acpRoutes.post('/checkout', (req, res) => {
  const { productId, quantity, agentId } = req.body;
  
  try {
    // Basic validation
    if (!productId || !quantity) {
      return res.status(400).json({ error: 'Missing productId or quantity' });
    }

    const product = db.prepare('SELECT * FROM Product WHERE id = ?').get(productId) as any;
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Mock ACP checkout session response
    // In a real flow, this would create a Razorpay Payment Link or similar,
    // and return a URL for the user to complete payment.
    const checkoutUrl = `http://localhost:3000/checkout?pid=${productId}&q=${quantity}&agent=${agentId || 'unknown'}`;

    res.json({
      status: 'success',
      checkoutUrl,
      expiresIn: 3600 // 1 hour
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});
