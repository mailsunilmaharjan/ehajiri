import crypto from 'crypto';

/* ── Security headers (dependency-free subset of what helmet sets) ── */
export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.removeHeader('X-Powered-By');
  if (req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  }
  next();
}

/* ── CORS allow-list ──
   The SPA is served by this same server, so browsers call the API
   same-origin and need no CORS at all. Allowed: no Origin header (native
   apps, devices, curl), same-origin, localhost/127.0.0.1 (dev + Electron),
   and anything listed in CORS_ORIGINS (comma-separated). */
export function corsOptions() {
  const extra = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  return {
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      try {
        const u = new URL(origin);
        if (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]') return cb(null, true);
      } catch { return cb(null, false); }
      if (extra.includes(origin)) return cb(null, true);
      return cb(null, false);   // no CORS headers → browser blocks cross-origin reads
    },
  };
}
// Same-origin requests carry an Origin header too (POST/PUT); cors() already
// treats those as fine since the browser doesn't enforce CORS same-origin.

/* ── In-memory rate limiter (one process per tenant → no shared store needed) ── */
export function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xff || req.socket?.remoteAddress || 'unknown';
}

export function rateLimit({ windowMs, max, message = 'Too many requests — please try again later', key = clientIp }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, Math.max(windowMs, 60_000)).unref();
  return (req, res, next) => {
    const k = key(req); const now = Date.now();
    let e = hits.get(k);
    if (!e || e.reset <= now) { e = { n: 0, reset: now + windowMs }; hits.set(k, e); }
    if (++e.n > max) {
      res.setHeader('Retry-After', Math.ceil((e.reset - now) / 1000));
      return res.status(429).json({ error: message });
    }
    next();
  };
}

/* ── Login brute-force throttle with lockout ──
   Failures = any 401 response from the wrapped handler. Tracked per
   (ip, username) and, with a higher cap, per username alone so rotating
   source IPs does not bypass it. Success clears the counters. */
export function loginThrottle({ perPair = 8, perUser = 30, windowMs = 15 * 60_000, lockMs = 15 * 60_000 } = {}) {
  const fails = new Map(); // key -> { n, first, lockedUntil }
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of fails) if (now - v.first > windowMs && (v.lockedUntil || 0) <= now) fails.delete(k);
  }, 60_000).unref();

  const get = (k) => {
    const now = Date.now(); let e = fails.get(k);
    if (!e || (now - e.first > windowMs && (e.lockedUntil || 0) <= now)) { e = { n: 0, first: now, lockedUntil: 0 }; fails.set(k, e); }
    return e;
  };
  const bump = (k, cap) => { const e = get(k); if (++e.n >= cap) e.lockedUntil = Date.now() + lockMs; };

  return (req, res, next) => {
    const user = String(req.body?.username || req.body?.email || '').trim().toLowerCase().slice(0, 200);
    const pairKey = `p|${clientIp(req)}|${user}`;
    const userKey = `u|${user}`;
    const now = Date.now();
    for (const k of [pairKey, userKey]) {
      const e = fails.get(k);
      if (e && e.lockedUntil > now) {
        res.setHeader('Retry-After', Math.ceil((e.lockedUntil - now) / 1000));
        return res.status(429).json({ error: 'Too many failed attempts. Please try again in a few minutes.' });
      }
    }
    res.on('finish', () => {
      if (res.statusCode === 401) { bump(pairKey, perPair); bump(userKey, perUser); }
      else if (res.statusCode < 400) { fails.delete(pairKey); fails.delete(userKey); }
    });
    next();
  };
}

/* ── Body-size policy ──
   Unauthenticated surfaces get a small cap; authenticated routes keep the
   large cap because photo/import/restore uploads legitimately need it. */
export function pickJsonLimit(req) {
  const p = (req.originalUrl || req.url || '').split('?')[0];
  if (/^\/(t\/[^/]+\/)?api\/(auth|license|guest-checkin)(\/|$)/.test(p)) return '1mb';
  if (/\/api\/bug-reports\/?$/.test(p) && req.method === 'POST') return '1mb';
  return '50mb';
}

/* ── Constant-time string compare for API keys / tokens ── */
export function safeEqual(a, b) {
  const x = Buffer.from(String(a || '')); const y = Buffer.from(String(b || ''));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}
