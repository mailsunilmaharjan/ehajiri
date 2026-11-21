/* Shared helpers for the Accounts module — port of NepalAccounts/server/app/common.py. */
import { AsyncLocalStorage } from 'async_hooks';
import { q, one } from './accDb.js';
import { fiscalYearOf } from './nepaliDate.js';

/** Per-request context (client IP for the audit trail). Set by the accounts guard. */
export const accCtx = new AsyncLocalStorage();

export class AccError extends Error {
  constructor(message, status = 400, extra = {}) { super(message); this.status = status; this.extra = extra; }
}
/** throw bad('message', 404) */
export const bad = (msg, status = 400, extra) => { throw new AccError(msg, status, extra); };

/** Wrap an async route handler so thrown AccErrors become { error } JSON responses. */
export const ah = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch((e) => {
    if (e instanceof AccError) return res.status(e.status).json({ error: e.message, ...e.extra });
    if (e && e.code === '23505') return res.status(409).json({ error: 'That record already exists (duplicate number or name). Please retry.' });
    if (e && e.code === '23503') return res.status(409).json({ error: 'This record is linked to other records and can\'t be changed that way.' });
    if (e && e.status && e.message) return res.status(e.status).json({ error: e.message });
    console.error('[accounts]', e);
    res.status(500).json({ error: 'Server error — please try again.' });
  });

export const money = (x) => Math.round((Number(x) || 0) * 100 + (Number(x) < 0 ? -1e-9 : 1e-9)) / 100;
export const round3 = (x) => Math.round((Number(x) || 0) * 1000) / 1000;
export const now = () => new Date().toISOString();
export const userOf = (req) => (req.accUser ? req.accUser.username : 'system');

export function checkPan(pan) {
  const p = String(pan || '').trim();
  if (p && !/^\d{9}$/.test(p)) bad('PAN / VAT number must be exactly 9 digits.');
  return p || null;
}

/** '' / undefined -> null, otherwise trimmed string. */
export const nz = (v) => { const s = (v === undefined || v === null) ? '' : String(v).trim(); return s || null; };
/** '' / undefined -> null, otherwise the date string (YYYY-MM-DD). */
export const dnz = (v) => { const s = nz(v); return s ? s.slice(0, 10) : null; };
export const int = (v, d = 0) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
export const flag = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);
export const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

export function addMonths(iso, n) {
  const [y0, m0, d0] = String(iso).slice(0, 10).split('-').map(Number);
  const m = m0 - 1 + n;
  const y = y0 + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  const dim = new Date(Date.UTC(y, mm + 1, 0)).getUTCDate();
  const d = Math.min(d0, dim);
  return `${y}-${String(mm + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
/** Last day of a service period: 12 months from 2026-01-15 -> 2027-01-14. */
export function periodEnd(startIso, months) {
  const e = addMonths(startIso, months);
  const d = new Date(Date.UTC(+e.slice(0, 4), +e.slice(5, 7) - 1, +e.slice(8, 10)) - 86400000);
  return d.toISOString().slice(0, 10);
}

export async function audit(t, user, action, entity, entityId, detail) {
  await t.query(
    'INSERT INTO acc_audit_log (username, action, entity, entity_id, detail, ip) VALUES (%s, %s, %s, %s, %s, %s)',
    [user, action, entity, entityId ?? null,
      detail !== undefined && detail !== null ? JSON.stringify(detail) : null,
      accCtx.getStore()?.ip || null],
  );
}

/** Existing fiscal year containing `iso`, creating it on first use. Accepts a tx runner or the pool. */
export async function ensureFiscalYear(iso, t = { query: q, one }) {
  const { name, start, end } = fiscalYearOf(iso);
  let fy = await t.one('SELECT * FROM acc_fiscal_years WHERE name = %s', [name]);
  if (!fy) {
    await t.query('INSERT INTO acc_fiscal_years (name, start_date, end_date) VALUES (%s, %s, %s) ON CONFLICT (name) DO NOTHING', [name, start, end]);
    fy = await t.one('SELECT * FROM acc_fiscal_years WHERE name = %s', [name]);
  }
  return fy;
}

/** 12,34,567.89 — Nepali digit grouping. */
export function nepMoney(n) {
  const [whole, dec] = Math.abs(Number(n) || 0).toFixed(2).split('.');
  let w = whole;
  if (w.length > 3) {
    const head = w.slice(0, -3), tail = w.slice(-3);
    const parts = [];
    for (let i = head.length; i > 0; i -= 2) parts.unshift(head.slice(Math.max(i - 2, 0), i));
    w = `${parts.join(',')},${tail}`;
  }
  return `${w}.${dec}`;
}
