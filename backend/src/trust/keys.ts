import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as jose from 'jose';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

export const MANDATE_ALG = 'ES256';

interface SigningKey {
  kid: string;
  privateKey: CryptoKey;
  publicJwk: jose.JWK;
  jwks: ReturnType<typeof jose.createLocalJWKSet>;
}

let current: SigningKey | null = null;

/**
 * Loads the wallet's ES256 signing key. Mandates are signed with the private key
 * and verified only with the public key (published at /.well-known/jwks.json),
 * so anyone can verify a mandate but only the issuer can create one.
 */
export async function initSigningKey(): Promise<SigningKey> {
  if (current) return current;

  let privateJwk: jose.JWK | null = null;
  if (env.MANDATE_SIGNING_JWK) {
    privateJwk = JSON.parse(env.MANDATE_SIGNING_JWK) as jose.JWK;
  } else if (env.NODE_ENV !== 'test' && existsSync(env.MANDATE_KEY_FILE)) {
    privateJwk = JSON.parse(readFileSync(env.MANDATE_KEY_FILE, 'utf8')) as jose.JWK;
  }

  if (!privateJwk) {
    privateJwk = await generatePrivateJwk();
    if (env.NODE_ENV !== 'test') {
      mkdirSync(path.dirname(path.resolve(env.MANDATE_KEY_FILE)), { recursive: true });
      writeFileSync(env.MANDATE_KEY_FILE, JSON.stringify(privateJwk, null, 2), { mode: 0o600 });
      logger.warn({ file: env.MANDATE_KEY_FILE }, 'trust: generated a new dev mandate signing key');
    }
  }

  const kid = privateJwk.kid ?? (await jose.calculateJwkThumbprint(privateJwk));
  const privateKey = (await jose.importJWK({ ...privateJwk, alg: MANDATE_ALG }, MANDATE_ALG)) as CryptoKey;
  const { d: _private, ...pub } = privateJwk;
  const publicJwk: jose.JWK = { ...pub, kid, alg: MANDATE_ALG, use: 'sig' };

  current = { kid, privateKey, publicJwk, jwks: jose.createLocalJWKSet({ keys: [publicJwk] }) };
  return current;
}

export function signingKey(): SigningKey {
  if (!current) throw new Error('Signing key not initialised; call initSigningKey() at startup');
  return current;
}

export function publicJwks(): { keys: jose.JWK[] } {
  return { keys: [signingKey().publicJwk] };
}

export async function generatePrivateJwk(): Promise<jose.JWK> {
  const { privateKey } = await jose.generateKeyPair(MANDATE_ALG, { extractable: true });
  const jwk = await jose.exportJWK(privateKey);
  return { ...jwk, kid: await jose.calculateJwkThumbprint(jwk), alg: MANDATE_ALG };
}
