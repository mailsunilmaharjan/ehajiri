import crypto from 'crypto';
import fs from 'fs';
import pool from '../db.js';

/* Push notifications to the eHajiri Android app through Firebase Cloud Messaging (HTTP v1).
   No npm packages: the OAuth token is a service-account JWT signed with Node's crypto.
   Fully optional — without FCM_SERVICE_ACCOUNT_FILE (path to the Firebase service-account JSON) every call is a quiet no-op,
   so the rest of the app behaves exactly as before. Sending never throws and never blocks the request that triggered it. */

let fetchImpl = (...a) => fetch(...a);
export const _setFetch = (f) => { fetchImpl = f; };            // tests only

let saCache = { path: null, mtime: 0, sa: null };
function serviceAccount() {
  const p = process.env.FCM_SERVICE_ACCOUNT_FILE;
  if (!p) return null;
  try {
    const m = fs.statSync(p).mtimeMs;
    if (saCache.path === p && saCache.mtime === m) return saCache.sa;
    const sa = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!sa.project_id || !sa.client_email || !sa.private_key) throw new Error('service account file is missing project_id / client_email / private_key');
    saCache = { path: p, mtime: m, sa };
    return sa;
  } catch (e) {
    if (saCache.path !== p || saCache.sa !== null) console.error('[push] cannot read FCM_SERVICE_ACCOUNT_FILE:', e.message);
    saCache = { path: p, mtime: 0, sa: null };
    return null;
  }
}
export const pushEnabled = () => !!serviceAccount();

const b64u = (b) => Buffer.from(b).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
let tokenCache = { value: null, exp: 0 };
async function accessToken(sa) {
  if (tokenCache.value && Date.now() < tokenCache.exp - 60_000) return tokenCache.value;
  const iat = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64u(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600 }));
  const sig = crypto.createSign('RSA-SHA256').update(`${head}.${claim}`).sign(sa.private_key);
  const r = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${b64u(sig)}` }),
    signal: AbortSignal.timeout(10_000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`token request failed (${r.status}) ${j.error_description || j.error || ''}`);
  tokenCache = { value: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  return tokenCache.value;
}

/** Outcome of one device: 'ok' | 'gone' (token no longer valid -> remove it) | 'error' */
async function sendOne(sa, access, token, { title, body, data }) {
  const flat = {}; for (const [k, v] of Object.entries(data || {})) if (v != null) flat[k] = String(v);
  const r = await fetchImpl(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access}` },
    body: JSON.stringify({ message: { token, notification: { title: String(title).slice(0, 120), body: String(body || '').slice(0, 300) }, data: flat,
      android: { priority: 'HIGH', notification: { sound: 'default', channel_id: 'ehajiri_alerts', default_sound: true, default_vibrate_timings: true, notification_priority: 'PRIORITY_HIGH' } } } }),
    signal: AbortSignal.timeout(10_000),
  });
  if (r.ok) return 'ok';
  const j = await r.json().catch(() => ({}));
  const status = j?.error?.status, code = j?.error?.details?.find?.(d => d.errorCode)?.errorCode;
  if (r.status === 404 || code === 'UNREGISTERED' || status === 'NOT_FOUND' || (r.status === 400 && status === 'INVALID_ARGUMENT')) return 'gone';
  console.error('[push] FCM error', r.status, status || '', j?.error?.message || '');
  return 'error';
}

/** Send a notification to every registered device of the given users. Never throws. */
export async function sendPushToUsers(userIds, { title, body, data } = {}) {
  try {
    const sa = serviceAccount();
    const ids = [...new Set((userIds || []).map(Number))].filter(n => Number.isInteger(n) && n > 0);
    if (!sa || !ids.length || !title) return { sent: 0, removed: 0 };
    const { rows } = await pool.query('SELECT id, token FROM push_devices WHERE user_id = ANY($1) AND active', [ids]);
    if (!rows.length) return { sent: 0, removed: 0 };
    const access = await accessToken(sa);
    let sent = 0; const gone = [];
    for (let i = 0; i < rows.length; i += 8) {
      const out = await Promise.all(rows.slice(i, i + 8).map(async d => ({ d, res: await sendOne(sa, access, d.token, { title, body, data }).catch(() => 'error') })));
      for (const { d, res } of out) { if (res === 'ok') sent++; else if (res === 'gone') gone.push(d.id); }
    }
    if (gone.length) await pool.query('DELETE FROM push_devices WHERE id = ANY($1)', [gone]);
    return { sent, removed: gone.length };
  } catch (e) {
    console.error('[push] send failed:', e.message);
    return { sent: 0, removed: 0, error: e.message };
  }
}

/** Fire-and-forget convenience for request handlers. */
export const pushLater = (userIds, payload) => { sendPushToUsers(userIds, payload).catch(() => {}); };
