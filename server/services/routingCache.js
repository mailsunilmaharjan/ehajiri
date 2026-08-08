// In-memory subdomain -> localhost port map for the shared-login hub's
// path-based tenant routing (attend.zkattendance.com/t/<subdomain>/...).
// Only ever started on the one process with ENABLE_TENANT_RESOLVE=true —
// every other tenant process imports this file (it's part of the same
// unmodified codebase) but never calls start(), so it's inert there.
//
// Polled rather than fetched per-request: a network round-trip to
// LicenseAdmin on every single proxied API call would make the hub's
// reliability depend on LicenseAdmin being up for every request, not just
// at login. getPort() falls back to a one-off refreshOne() on a cache miss
// (a tenant created after the last poll) or a stale port (the rare case of
// a tenant's Windows service being reprovisioned on a different port),
// so a 30s-stale cache costs one extra request rather than a hard failure.
const DIRECTORY_URL = process.env.LICENSE_ADMIN_URL;
const DIRECTORY_KEY = process.env.DIRECTORY_API_KEY;

const POLL_MS = 30_000;
let cache = new Map(); // subdomain -> app_port
let pollTimer = null;

async function fetchTable() {
  const res = await fetch(`${DIRECTORY_URL}/api/tenant-companies/routing-table`, {
    headers: { 'x-directory-key': DIRECTORY_KEY },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`routing-table fetch failed: HTTP ${res.status}`);
  return res.json();
}

async function refreshAll() {
  try {
    const rows = await fetchTable();
    const next = new Map();
    for (const r of rows) next.set(r.subdomain, r.app_port);
    cache = next;
  } catch { /* keep serving the last-known-good cache */ }
}

// Single-tenant lookup, used by tenantPathProxy.js when the bulk cache
// doesn't (yet, or no longer) have an answer for one specific subdomain.
export async function refreshOne(subdomain) {
  try {
    const res = await fetch(`${DIRECTORY_URL}/api/tenant-companies/routing-table?subdomain=${encodeURIComponent(subdomain)}`, {
      headers: { 'x-directory-key': DIRECTORY_KEY },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const { app_port } = await res.json();
    if (app_port) cache.set(subdomain, app_port);
    return app_port || null;
  } catch {
    return null;
  }
}

export function getPort(subdomain) {
  return cache.get(subdomain) || null;
}

export function start() {
  if (!DIRECTORY_URL || !DIRECTORY_KEY) return; // not provisioned for this yet — no-op
  if (pollTimer) return; // already started
  refreshAll();
  pollTimer = setInterval(refreshAll, POLL_MS);
}

export function stop() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}
