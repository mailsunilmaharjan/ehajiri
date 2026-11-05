// Central place for security-critical secrets. There are NO built-in fallbacks:
// a missing secret stops the process at startup instead of silently falling
// back to a value that is public in the source / git history.
const KNOWN_DEFAULTS = new Set([
  'ehajiri_jwt_secret_change_me',
  'EHAJIRI_SSO_SECRET_2026_v1',
  'EHAJIRI_LICENSE_SECRET_2024_v2',
  'ehajiri_license_jwt_secret_2024_mobile',
  'ehajiri_session_secret_2024',
]);

// Passwords the tenant migrations (v30 etc.) seed into SYS001 / SYS002 on EVERY
// tenant. They are public in source control, so a login with one of them must
// never succeed on a hosted instance.
export const KNOWN_DEFAULT_PASSWORDS = ['#28O29@9837', '@dmin'];

export function requireSecret(name, { minLength = 24 } = {}) {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(`[security] ${name} is not set — refusing to start. Set it in server/.env (generate with: node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")`);
  }
  if (KNOWN_DEFAULTS.has(v)) {
    throw new Error(`[security] ${name} is set to a publicly known default value — refusing to start. Generate a unique secret.`);
  }
  if (v.length < minLength) {
    throw new Error(`[security] ${name} is too short (min ${minLength} chars) — refusing to start.`);
  }
  return v;
}

export const JWT_SECRET = requireSecret('JWT_SECRET');
export const SSO_SECRET = requireSecret('SSO_SECRET');
