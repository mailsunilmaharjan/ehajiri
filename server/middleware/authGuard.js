import jwt from 'jsonwebtoken';
import { requestContext } from '../services/requestContext.js';
import pool from '../db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'ehajiri_jwt_secret_change_me';
// Separate from JWT_SECRET on purpose — mirrors LicenseAdmin's own
// server/services/security.js (signSsoToken/SSO_SECRET), which is what
// actually mints these for the Tenant Companies grid's "Open Software"
// action. Must match that file's default exactly unless SSO_SECRET is set.
const SSO_SECRET = process.env.SSO_SECRET || 'EHAJIRI_SSO_SECRET_2026_v1';

// Chat "online" presence piggybacks on normal API traffic instead of a dedicated
// heartbeat endpoint — every authenticated request touches last_seen_at, throttled
// per user so an active session doesn't issue a write on every single request.
const PRESENCE_THROTTLE_MS = 20_000;
const lastTouched = new Map();
function touchPresence(userId) {
  const now = Date.now();
  if (now - (lastTouched.get(userId) || 0) < PRESENCE_THROTTLE_MS) return;
  lastTouched.set(userId, now);
  pool.query('UPDATE users SET last_seen_at = NOW() WHERE id = $1', [userId]).catch(() => {});
}

/**
 * Validates `Authorization: Bearer <token>`, verifies the JWT, and attaches
 * the decoded payload to req.user. Returns 401 JSON on missing/invalid/expired
 * tokens — mirrors licenseGuard's JSON error shape so existing clients (which
 * already read err.data) handle it the same way.
 *
 * Also accepts the token as a `?token=` query param — the browser's native
 * EventSource API (used for the /attendance/live SSE stream and chat) cannot
 * set custom headers, so that's the only way it can authenticate.
 */
export function authGuard(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : (req.query.token || null);

  if (!token) {
    return res.status(401).json({ authError: true, error: 'Authentication required' });
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    // Every tenant process shares the same JWT_SECRET (one physical .env file
    // read by every NSSM service) with no tenant claim in the payload — a
    // token minted by one company's login is otherwise a cryptographically
    // valid token for every OTHER company's process too, and since every
    // tenant seeds low sequential ids, it can silently authenticate as a
    // *different* local user in that other company's own database (confirmed
    // in production: a Tenant Planet employee's leave application landed on
    // an unrelated employee's record in Tenant ayurbed-office this way).
    // Every tenant process now has TENANT_ID configured, so this is
    // unconditional: any token missing a tenantId claim (minted before this
    // rollout) or carrying a foreign one is rejected outright, not just on a
    // mismatch between two present values. This forces exactly one re-login
    // for anyone still holding a pre-rollout token — acceptable once, to
    // close a real cross-tenant data leak.
    if (process.env.TENANT_ID && String(req.user.tenantId) !== String(process.env.TENANT_ID)) {
      return res.status(401).json({ authError: true, error: 'Session expired — please log in again' });
    }
    touchPresence(req.user.id);
    requestContext.run({ userId: req.user.id }, next);
  } catch {
    return res.status(401).json({ authError: true, error: 'Session expired — please log in again' });
  }
}

export function signToken(user) {
  return jwt.sign(
    {
      id         : user.id,
      employeeId : user.employeeId,
      role       : user.role,
      branch     : user.branch,
      department : user.department,
      tenantId   : process.env.TENANT_ID || undefined,
    },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

// Cross-tenant login redirect (shared hub → a company's own subdomain) used
// to put the plaintext email straight in the URL (?email=...), which then
// sits in browser history, address-bar autocomplete, and every access log
// between here and there. This carries just the email in a short-lived,
// purpose-tagged token instead — the destination page exchanges it for the
// real email via one background call (GET /auth/resolve-redirect-token)
// rather than ever rendering it in the URL. No id/role/tenantId claims, so
// even if someone tried to replay it as a Bearer token, authGuard's req.user
// would have nothing usable in it. Reuses the same JWT_SECRET every tenant
// process already shares (see authGuard's own comment above) — that's exactly
// what lets the DESTINATION tenant's process (not the one that issued it)
// verify it.
export function signRedirectEmailToken(email) {
  return jwt.sign({ purpose: 'login-redirect', email }, JWT_SECRET, { expiresIn: '2m' });
}

export function verifyRedirectEmailToken(token) {
  const payload = jwt.verify(token, JWT_SECRET);
  if (payload.purpose !== 'login-redirect' || !payload.email) throw new Error('Not a redirect token');
  return payload.email;
}

// LicenseAdmin's "Open Software (Admin/Super Admin)" action on the Tenant
// Companies grid mints one of these (server/services/security.js's
// signSsoToken) instead of ever knowing/embedding that seed account's real
// password. Verified here with the same SSO_SECRET, HS256-only (matches the
// signing side exactly) and returns null rather than throwing on any
// failure — callers treat an invalid/expired/tampered token as "no session",
// never a 500.
export function verifySsoToken(token) {
  try {
    const payload = jwt.verify(token, SSO_SECRET, { algorithms: ['HS256'] });
    if (payload.purpose !== 'sso' || !payload.email) return null;
    return payload.email;
  } catch {
    return null;
  }
}
