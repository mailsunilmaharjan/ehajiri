import { Router } from 'express';
import pool from '../db.js';

/* Live support chat relay. The browser talks only to THIS tenant's server; we vouch
   for who the user is (from their login, never from the request body) and forward
   to LicenseAdmin (LICENSE_ADMIN_URL) with the shared INTERNAL_API_KEY. Chats are
   stored centrally in LicenseAdmin and answered from its Super Admin inbox. */
const router = Router();

const base = () => process.env.LICENSE_ADMIN_URL;
const TENANT_ID = () => Number(process.env.TENANT_ID) || null;

async function relay(method, path, { query, body } = {}) {
  const url = base();
  const key = process.env.INTERNAL_API_KEY;
  if (!url || !key || !TENANT_ID()) return { status: 503, data: { error: 'Live support is not available on this installation.' } };
  const qs = query ? '?' + new URLSearchParams(query).toString() : '';
  try {
    const r = await fetch(`${url}/api/support-live${path}${qs}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-internal-key': key },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(6000),
    });
    const data = await r.json().catch(() => ({}));
    return { status: r.status === 401 ? 502 : r.status, data: r.status === 401 ? { error: 'Live support is unavailable right now.' } : data };
  } catch {
    return { status: 502, data: { error: 'Live support is unreachable right now. Please try again shortly.' } };
  }
}

const names = new Map();   // userId -> { name, at }
async function identity(req) {
  const id = req.user.id;
  let n = names.get(id);
  if (!n || Date.now() - n.at > 300_000) {
    const { rows } = await pool.query('SELECT full_name FROM users WHERE id=$1', [id]);
    n = { name: rows[0]?.full_name || '', at: Date.now() };
    names.set(id, n);
  }
  return { tenantId: TENANT_ID(), userId: id, userName: n.name, userRole: req.user.role };
}
const send = (res, { status, data }) => res.status(status).json(data);

router.post('/start', async (req, res) => {
  const who = await identity(req);
  send(res, await relay('POST', '/start', { body: {
    ...who,
    message: String(req.body?.message || '').slice(0, 1000),
    page: String(req.body?.page || '').slice(0, 300),
    language: req.body?.language === 'np' ? 'np' : 'en',
  } }));
});

router.get('/chat', async (req, res) => {
  const who = await identity(req);
  const query = { tenantId: who.tenantId, userId: who.userId };
  if (req.query.chatId) { query.chatId = String(req.query.chatId); query.after = String(req.query.after || 0); }
  send(res, await relay('GET', '/chat', { query }));
});

router.post('/message', async (req, res) => {
  const who = await identity(req);
  send(res, await relay('POST', '/message', { body: { ...who, chatId: req.body?.chatId, body: String(req.body?.body || '').slice(0, 1000) } }));
});

router.post('/close', async (req, res) => {
  const who = await identity(req);
  send(res, await relay('POST', '/close', { body: { ...who, chatId: req.body?.chatId } }));
});

// Admin-approved answers, cached briefly so every Help open isn't a LicenseAdmin round trip.
let kbCache = { at: 0, rows: [] };
router.get('/kb', async (_req, res) => {
  if (Date.now() - kbCache.at < 60_000) return res.json(kbCache.rows);
  const r = await relay('GET', '/kb');
  if (r.status === 200 && Array.isArray(r.data)) kbCache = { at: Date.now(), rows: r.data };
  res.json(kbCache.rows);
});

export default router;
