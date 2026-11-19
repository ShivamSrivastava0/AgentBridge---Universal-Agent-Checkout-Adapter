/** Prints a fresh ES256 private JWK for MANDATE_SIGNING_JWK (production). */
import { generatePrivateJwk } from '../trust/keys.js';

const jwk = await generatePrivateJwk();
process.stdout.write(`MANDATE_SIGNING_JWK='${JSON.stringify(jwk)}'\n`);
