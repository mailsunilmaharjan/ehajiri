import api from '../api/client.js';

// Same message on the same page reported over and over (a render loop, a
// polling request that keeps failing) would otherwise flood the Bug Finder
// table — de-dupe by (page + message) for a short window.
const recentlyReported = new Map(); // "page|message" → timestamp
const DEDUPE_WINDOW_MS = 30_000;

/**
 * Report a frontend crash to the Bug Finder log (Settings → Bug Finder).
 * Fire-and-forget — a failure here must never surface to the user or throw,
 * since it's usually called from inside error-handling paths already.
 */
export function reportBug({ message, stack, page }) {
  const key  = `${page || window.location.pathname}|${String(message).slice(0, 200)}`;
  const now  = Date.now();
  const last = recentlyReported.get(key);
  if (last && now - last < DEDUPE_WINDOW_MS) return;
  recentlyReported.set(key, now);

  api.post('/bug-reports', {
    source : 'frontend',
    page   : page || window.location.pathname,
    message: String(message || 'Unknown error').slice(0, 5000),
    stack  : stack ? String(stack).slice(0, 10000) : null,
  }).catch(() => { /* never let reporting itself fail user-visibly */ });
}

/** Wires window.onerror + unhandledrejection so uncaught crashes outside
 *  React's render cycle (event handlers, timers, fetches) get logged too.
 *  Call once at app startup. */
export function installGlobalErrorReporting() {
  window.addEventListener('error', (event) => {
    reportBug({ message: event.message, stack: event.error?.stack });
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    reportBug({
      message: reason?.message || String(reason),
      stack  : reason?.stack,
    });
  });
}
