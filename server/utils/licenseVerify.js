// Ed25519 license verification. The matching PRIVATE key exists only in
// LicenseAdmin's .env (LICENSE_SIGNING_KEY) — a tenant/desktop install can
// verify keys but can never mint one. The public key below is public by
// design; override with LICENSE_PUBLIC_KEY (base64 of the PEM) if rotated.
import crypto from 'crypto';

const BUILT_IN_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAOJiLTmJT8RxY19NBXU8nUYrcujctOqiV09FN8BuLpdo=
-----END PUBLIC KEY-----`;

function publicKey() {
  const env = process.env.LICENSE_PUBLIC_KEY;
  const pem = env ? Buffer.from(env, 'base64').toString() : BUILT_IN_PUBLIC_KEY;
  return crypto.createPublicKey(pem);
}

/** @param {string} encoded base64url payload  @param {string} sigB64url */
export function verifyEd25519(encoded, sigB64url) {
  try {
    return crypto.verify(null, Buffer.from(encoded), publicKey(), Buffer.from(sigB64url, 'base64url'));
  } catch { return false; }
}
