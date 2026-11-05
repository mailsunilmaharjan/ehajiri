// ══════════════════════════════════════════════
//  eHajiri — API Client (fetch-based)
//  All requests go through /api (Vite proxies → :5000), or through
//  /t/<subdomain>/api when reached via the shared-login hub's path-based
//  tenant routing — see utils/tenantPath.js.
// ══════════════════════════════════════════════
import { getTenantPrefix } from '../utils/tenantPath.js';

const BASE = `${getTenantPrefix()}/api`;

// For the handful of call sites that can't go through the api.* wrapper
// above (EventSource, raw fetch for file upload/download, window.open,
// plain href) — same BASE, so they stay correctly tenant-prefixed too.
export const apiUrl = (path) => `${BASE}${path}`;

// URL for the /attendance/live SSE stream. EventSource can't send headers, so
// instead of putting the long-lived JWT in the query string this asks the
// server for a 60 s single-use ticket. Falls back to ?token= against an older
// server that doesn't have /auth/stream-ticket yet. Returns null if signed out.
export async function liveStreamUrl() {
  const token = getToken();
  if (!token) return null;
  try {
    const r = await fetch(`${BASE}/auth/stream-ticket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: '{}',
    });
    if (r.ok) {
      const { ticket } = await r.json();
      if (ticket) return `${BASE}/attendance/live?ticket=${encodeURIComponent(ticket)}`;
    }
  } catch { /* fall through */ }
  return `${BASE}/attendance/live?token=${encodeURIComponent(token)}`;
}

const TOKEN_KEY = 'auth_token';

export const getToken = () => {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
};
export const setToken = (token) => {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {}
};

// Set by AuthContext so a 401 (expired/invalid token) can trigger a clean logout.
let onUnauthorized = null;
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const opts = { method, headers };
  if (body !== undefined) opts.body = JSON.stringify(body);

  let res;
  try {
    res = await fetch(`${BASE}${path}`, opts);
  } catch {
    throw new Error('Backend server not running');
  }

  // Detect HTML responses (proxy fallback / 404 from Vite)
  const ct = res.headers.get('Content-Type') || '';
  if (!ct.includes('application/json')) {
    throw new Error('Backend server not running');
  }

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    let data = {};
    try { data = await res.json(); msg = data.error || msg; } catch {}
    if (res.status === 401 && data.authError && onUnauthorized) onUnauthorized();
    const err = new Error(msg);
    err.data = data;   // attach full response so callers can read licenseError etc.
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export const api = {
  get   : (path)        => request('GET',    path),
  post  : (path, body)  => request('POST',   path, body),
  put   : (path, body)  => request('PUT',    path, body),
  patch : (path, body)  => request('PATCH',  path, body),
  delete: (path, body)  => request('DELETE', path, body),
};

export default api;
