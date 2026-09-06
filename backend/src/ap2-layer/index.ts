import { Router } from 'express';
import * as jose from 'jose';
import { db } from '../db';
import { v4 as uuidv4 } from 'uuid';

export const ap2Routes = Router();

// For demo purposes, we'll use a fixed symmetric secret to sign and verify mandates.
const SECRET = new TextEncoder().encode('super_secret_agent_bridge_key_123');

ap2Routes.post('/mandate/verify', async (req, res) => {
  const { mandateToken, merchantId } = req.body;

  try {
    // Verify the JWT mandate
    const { payload } = await jose.jwtVerify(mandateToken, SECRET);

    // Validate payload fields
    if (payload.merchantId !== merchantId) {
      return res.status(400).json({ error: 'Mandate not valid for this merchant' });
    }

    // Save mandate to DB
    const mandateId = `man_${uuidv4()}`;
    const expiry = payload.exp ? new Date(payload.exp * 1000).toISOString() : new Date(Date.now() + 3600000).toISOString();
    
    db.prepare(`
      INSERT INTO Mandate (id, agent_type, merchant_id, max_amount, expiry, signature)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(mandateId, 'ap2_gemini', merchantId, payload.maxAmount, expiry, mandateToken);

    res.json({ status: 'verified', mandateId });
  } catch (err: any) {
    console.error(err);
    res.status(401).json({ error: 'Invalid mandate signature', details: err.message });
  }
});

// Helper endpoint for the DEMO: Generates a signed mandate (usually done by the Agent's secure enclave)
ap2Routes.post('/demo/generate-mandate', async (req, res) => {
  const { merchantId, maxAmount } = req.body;
  
  try {
    const alg = 'HS256';
    const jwt = await new jose.SignJWT({ merchantId, maxAmount })
      .setProtectedHeader({ alg })
      .setIssuedAt()
      .setIssuer('urn:agent:gemini:ap2')
      .setExpirationTime('1h')
      .sign(SECRET);

    res.json({ mandateToken: jwt });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate token' });
  }
});
