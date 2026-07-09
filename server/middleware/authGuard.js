import jwt from 'jsonwebtoken';
import { requestContext } from '../services/requestContext.js';
import pool from '../db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'ehajiri_jwt_secret_change_me';

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
    },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}
