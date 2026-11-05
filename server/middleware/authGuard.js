import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { requestContext } from '../services/requestContext.js';
import pool from '../db.js';

import { JWT_SECRET, SSO_SECRET } from '../utils/secrets.js';
// JWT_SECRET / SSO_SECRET have NO built-in fallbacks (utils/secrets.js): the
// process refuses to start if they are missing or a known default. SSO_SECRET
// is kept separate from JWT_SECRET on purpose — it must match LicenseAdmin's
// own SSO_SECRET, which is what mints the "Open Software" tokens.

// Single-use SSO tokens: a jti is consumed once a session is issued from it.
const usedSsoJti = new Map(); // jti -> exp (ms)
export function consumeSsoJti(jti, expMs) {
  const now = Date.now();
  for (const [k, v] of usedSsoJti) if (v <= now) usedSsoJti.delete(k);
  if (!jti) return true;                 // tokens minted before jti rollout
  if (usedSsoJti.has(jti)) return false; // replay
  usedSsoJti.set(jti, expMs || now + 130_000);
  return true;
}

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

// ── Single-use SSE stream tickets ──────────────────────────────────────────
// EventSource cannot send an Authorization header, so the long-lived JWT used
// to ride in the URL (access logs, history, Referer). POST /auth/stream-ticket
// (authenticated) now returns a 60-second, single-use ticket for that one
// connection instead. ?token= keeps working until ALLOW_QUERY_TOKEN=false.
const streamTickets = new Map(); // ticket -> { user, exp }
export function issueStreamTicket(user) {
  const now = Date.now();
  for (const [k, v] of streamTickets) if (v.exp <= now) streamTickets.delete(k);
  const ticket = crypto.randomBytes(24).toString('hex');
  streamTickets.set(ticket, { user: { ...user }, exp: now + 60_000 });
  return ticket;
}
function takeStreamTicket(ticket) {
  const e = streamTickets.get(ticket);
  if (!e) return null;
  streamTickets.delete(ticket);               // single use
  return e.exp > Date.now() ? e.user : null;
}

// ── Server-side session state ──────────────────────────────────────────────
// A JWT alone is valid for 30 days and carries role/branch/department as they
// were at login. This re-reads the user's CURRENT state (cached briefly) so:
//   • a demoted/deactivated/deleted user loses access within seconds, not 30 days
//   • role/branch/department seen by every route are the live DB values
//   • a password change/reset (users.sessions_valid_after) kills older tokens
// If the lookup itself fails (DB hiccup, column not migrated yet) we fall back
// to the token's claims rather than lock everyone out.
const SESSION_CACHE_MS = 15_000;
const sessionCache = new Map(); // userId -> { at, row }
export function invalidateSession(userId) { sessionCache.delete(Number(userId)); }

async function loadSessionState(userId) {
  const id = Number(userId);
  if (!Number.isInteger(id)) return { missing: true };
  const hit = sessionCache.get(id);
  if (hit && Date.now() - hit.at < SESSION_CACHE_MS) return hit.row;
  try {
    const { rows } = await pool.query(
      'SELECT role, branch, department, active, sessions_valid_after FROM users WHERE id = $1', [id]);
    const row = rows[0] || { missing: true };
    sessionCache.set(id, { at: Date.now(), row });
    if (sessionCache.size > 5000) sessionCache.clear();
    return row;
  } catch {
    return null;   // unknown — caller falls back to token claims
  }
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
  // ?token= is accepted ONLY for the SSE stream (browser EventSource cannot set
  // headers). Everywhere else the token must be in the header so it never lands
  // in access logs / history / Referer for normal API calls.
  const isSse  = req.method === 'GET' && /\/attendance\/live\/?$/.test((req.originalUrl || '').split('?')[0]);
  const ticketUser = (isSse && req.query.ticket) ? takeStreamTicket(String(req.query.ticket)) : null;
  const allowQueryToken = process.env.ALLOW_QUERY_TOKEN !== 'false';
  const token  = ticketUser ? 'ticket'
    : header.startsWith('Bearer ') ? header.slice(7)
    : (isSse && allowQueryToken ? (req.query.token || null) : null);

  if (!token) {
    return res.status(401).json({ authError: true, error: 'Authentication required' });
  }
  try {
    req.user = ticketUser || jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
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
    loadSessionState(req.user.id).then((st) => {
      const reject = () => res.status(401).json({ authError: true, error: 'Session expired — please log in again' });
      if (st) {
        if (st.missing || st.active === false) return reject();
        if (st.sessions_valid_after && Number(req.user.iat || 0) < Math.floor(new Date(st.sessions_valid_after).getTime() / 1000)) return reject();
        req.user.role       = st.role;
        req.user.branch     = st.branch;
        req.user.department = st.department;
      }
      touchPresence(req.user.id);
      requestContext.run({ userId: req.user.id }, next);
    }).catch(() => res.status(401).json({ authError: true, error: 'Session expired — please log in again' }));
    return;
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
    { algorithm: 'HS256', expiresIn: '30d' }
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
export function verifySsoPayload(token) {
  try {
    const payload = jwt.verify(token, SSO_SECRET, { algorithms: ['HS256'] });
    if (payload.purpose !== 'sso' || !payload.email) return null;
    return payload;
  } catch {
    return null;
  }
}

export function verifySsoToken(token) {
  return verifySsoPayload(token)?.email || null;
}
