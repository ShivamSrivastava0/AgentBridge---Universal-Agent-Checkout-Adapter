import * as jose from 'jose';
import { z } from 'zod';
import { env } from '../config/env.js';
import { AUTONOMY_LEVELS, type IntentMandateClaims } from '../domain/types.js';
import { AppError } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { MANDATE_ALG, signingKey } from './keys.js';

const INTENT_TYP = 'intent-mandate+jwt';
const CART_TYP = 'cart-mandate+jwt';

const IntentPayload = z.object({
  jti: z.string(),
  aud: z.string(),
  sub: z.string(),
  exp: z.number(),
  agent_id: z.string().nullable(),
  max_order_paise: z.number().int().positive(),
  budget_paise: z.number().int().positive(),
  currency: z.string(),
  category_rules: z.record(z.string(), z.enum(AUTONOMY_LEVELS)),
  default_level: z.enum(AUTONOMY_LEVELS),
  blocked_tags: z.array(z.string()),
  escalate_new_items: z.boolean(),
});

/**
 * Intent mandate: a standing, user-signed permission ("this agent may spend up to
 * ₹X, these categories automatically, never these tags"). Modelled on AP2's
 * Intent Mandate. Signed by the wallet's private key.
 */
export async function signIntentMandate(c: IntentMandateClaims): Promise<string> {
  const key = signingKey();
  return new jose.SignJWT({
    agent_id: c.agent_id,
    max_order_paise: c.max_order_paise,
    budget_paise: c.budget_paise,
    currency: c.currency,
    category_rules: c.category_rules,
    default_level: c.default_level,
    blocked_tags: c.blocked_tags,
    escalate_new_items: c.escalate_new_items,
  })
    .setProtectedHeader({ alg: MANDATE_ALG, kid: key.kid, typ: INTENT_TYP })
    .setIssuer(env.MANDATE_ISSUER)
    .setAudience(c.merchant_id)
    .setSubject(c.subject)
    .setJti(c.mandate_id)
    .setIssuedAt()
    .setExpirationTime(Math.floor(new Date(c.expires_at).getTime() / 1000))
    .sign(key.privateKey);
}

export async function verifyIntentMandate(token: string, merchantId: string): Promise<IntentMandateClaims> {
  let payload: jose.JWTPayload;
  try {
    ({ payload } = await jose.jwtVerify(token, signingKey().jwks, {
      issuer: env.MANDATE_ISSUER,
      audience: merchantId,
      typ: INTENT_TYP,
      algorithms: [MANDATE_ALG],
    }));
  } catch (err) {
    throw new AppError('invalid_mandate', `Intent mandate rejected: ${describeJoseError(err)}`);
  }
  const parsed = IntentPayload.safeParse(payload);
  if (!parsed.success) throw new AppError('invalid_mandate', 'Intent mandate is missing required claims');
  const p = parsed.data;
  return {
    mandate_id: p.jti,
    merchant_id: p.aud,
    subject: p.sub,
    agent_id: p.agent_id,
    max_order_paise: p.max_order_paise,
    budget_paise: p.budget_paise,
    currency: p.currency,
    category_rules: p.category_rules,
    default_level: p.default_level,
    blocked_tags: p.blocked_tags,
    escalate_new_items: p.escalate_new_items,
    expires_at: new Date(p.exp * 1000).toISOString(),
  };
}

export interface CartMandateInput {
  orderId: string;
  merchantId: string;
  subject: string;
  cartHash: string;
  totalPaise: number;
  currency: string;
  /** Who authorised this exact cart: the user directly, or an intent mandate. */
  authorizedBy: { type: 'user' } | { type: 'intent_mandate'; mandateId: string } | { type: 'merchant_review'; note?: string };
}

/**
 * Cart mandate: authorisation for one exact cart (bound by its sha256 hash),
 * single-use (unique jti), short-lived. Settlement refuses to capture without it.
 */
export async function signCartMandate(input: CartMandateInput): Promise<{ token: string; jti: string }> {
  const key = signingKey();
  const jti = newId('cm');
  const token = await new jose.SignJWT({
    order_id: input.orderId,
    cart_hash: input.cartHash,
    total_paise: input.totalPaise,
    currency: input.currency,
    authorized_by: input.authorizedBy,
  })
    .setProtectedHeader({ alg: MANDATE_ALG, kid: key.kid, typ: CART_TYP })
    .setIssuer(env.MANDATE_ISSUER)
    .setAudience(input.merchantId)
    .setSubject(input.subject)
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(key.privateKey);
  return { token, jti };
}

export async function verifyCartMandate(
  token: string,
  expected: { merchantId: string; orderId: string; cartHash: string; totalPaise: number },
): Promise<{ jti: string }> {
  let payload: jose.JWTPayload;
  try {
    ({ payload } = await jose.jwtVerify(token, signingKey().jwks, {
      issuer: env.MANDATE_ISSUER,
      audience: expected.merchantId,
      typ: CART_TYP,
      algorithms: [MANDATE_ALG],
    }));
  } catch (err) {
    throw new AppError('invalid_mandate', `Cart mandate rejected: ${describeJoseError(err)}`);
  }
  if (payload.order_id !== expected.orderId) throw new AppError('invalid_mandate', 'Cart mandate is for a different order');
  if (payload.cart_hash !== expected.cartHash)
    throw new AppError('invalid_mandate', 'Cart was modified after it was authorised (hash mismatch)');
  if (payload.total_paise !== expected.totalPaise) throw new AppError('invalid_mandate', 'Cart total does not match mandate');
  if (!payload.jti) throw new AppError('invalid_mandate', 'Cart mandate has no jti');
  return { jti: payload.jti };
}

/** Decode without verifying, for display only. */
export function inspectToken(token: string): { header: jose.ProtectedHeaderParameters; payload: jose.JWTPayload } | null {
  try {
    return { header: jose.decodeProtectedHeader(token), payload: jose.decodeJwt(token) };
  } catch {
    return null;
  }
}

function describeJoseError(err: unknown): string {
  if (err instanceof jose.errors.JWTExpired) return 'mandate has expired';
  if (err instanceof jose.errors.JWSSignatureVerificationFailed) return 'signature verification failed';
  if (err instanceof jose.errors.JWTClaimValidationFailed) return `claim "${err.claim}" invalid (${err.reason})`;
  if (err instanceof jose.errors.JOSEError) return err.code;
  return 'malformed token';
}
