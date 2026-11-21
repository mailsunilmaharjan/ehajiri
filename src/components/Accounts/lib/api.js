// Accounts API client. Talks to eHajiri's /api/accounts with the signed-in user's Bearer token
// (same token as the rest of the app; no separate login). Tenant-prefixed like the rest of eHajiri.
import { getToken } from '../../../api/client.js';
import { getTenantPrefix } from '../../../utils/tenantPath.js';

const PREFIX = getTenantPrefix();
export const BASE = `${PREFIX}/api/accounts`;
const authHeaders = () => { const t = getToken(); return t ? { Authorization: `Bearer ${t}` } : {}; };

async function call(method, url, body) {
  let res;
  try {
    res = await fetch(`${BASE}${url}`, {
      method,
      headers: { ...authHeaders(), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch { throw new Error('Backend server not running'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.moduleDisabled = !!data.moduleDisabled;
    throw err;
  }
  return data;
}

export const api = {
  get: (url, params) => call('GET', params ? `${url}?${new URLSearchParams(params)}` : url),
  post: (url, body) => call('POST', url, body ?? {}),
  put: (url, body) => call('PUT', url, body),
  del: (url) => call('DELETE', url),
};

/** GET a file / PDF with the user's token. `url` is '/api/accounts/…' (as written in links) or a path under /api/accounts. */
export const authFetch = (url) => fetch(url.startsWith('/api/') ? `${PREFIX}${url}` : `${BASE}${url}`, { headers: authHeaders() });

/** Show a PDF / picture from the server in the app's own viewer (components/FileViewer.jsx). */
export async function openPdf(url, title) {
  window.dispatchEvent(new CustomEvent('ehl:open-file', { detail: { url, title } }));
}

/** Every <a href="/api/accounts/…" target="_blank"> (PDF previews, voucher / bill scans) opens in the viewer. */
export function installFileLinks(onError) {
  const onClick = (e) => {
    const a = e.target instanceof Element ? e.target.closest('.acc-app a[target="_blank"][href^="/api/accounts/"]') : null;
    if (!a || e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    openPdf(a.getAttribute('href')).catch((err) => onError?.(err.message));
  };
  document.addEventListener('click', onClick);
  return () => document.removeEventListener('click', onClick);
}

/** Nepali grouping: 12,34,567.00 */
export const fmtMoney = (n) =>
  Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Signed balance → "1,000.00 Dr" / "500.00 Cr" */
export const fmtBal = (n) => {
  const v = Number(n || 0);
  if (Math.abs(v) < 0.005) return '0.00';
  return `${fmtMoney(Math.abs(v))} ${v > 0 ? 'Dr' : 'Cr'}`;
};

/** Server stores UTC 'YYYY-MM-DD HH:MM:SS' → local readable time */
export const fmtStamp = (s) => {   // server sends Nepal local time 'YYYY-MM-DD HH:MM:SS'
  if (!s) return '';
  const d = new Date(String(s).replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

/** wa.me share link (works without any gateway) */
export const waLink = (phone, text) => {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.length === 10 && d.startsWith('9')) d = `977${d}`;
  return `https://wa.me/${d}?text=${encodeURIComponent(text)}`;
};
