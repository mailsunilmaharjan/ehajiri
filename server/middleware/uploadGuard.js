import crypto from 'crypto';
import { scanUpload } from '../services/uploadScanner.js';
import { logAudit } from '../services/auditLog.js';

/* ──────────────────────────────────────────────────────────────────────────
   Upload guard — scans every file that arrives inside a JSON body.
   The web app, the phone app and the Electron app all upload images and
   documents as base64 data URLs (profile photos, logos, leave / office-visit
   attachments, task and chat files, rich-text images, proof images ...), so one
   middleware in front of every /api route covers them all.
   A blocked upload gets HTTP 422 + { code:'UPLOAD_BLOCKED' }; nothing is saved.
   If the scanner itself fails, the request goes through (fail-open) — a scanner
   bug must never take the whole app down. A real detection is never skipped.
   ────────────────────────────────────────────────────────────────────────── */

const DATA_URL_RE = /data:([a-zA-Z0-9.+/_-]+)?((?:;[a-zA-Z0-9=._+-]+)*);base64,([A-Za-z0-9+/=_-]{16,})/g;
const NAME_KEYS = ['fileName', 'filename', 'name', 'originalName', 'attachmentName', 'attachment_name', 'file_name', 'title'];
const EXEMPT = [
  /^\/backup(\/|$)/,            // admin database backup / restore (huge, trusted, admin only)
  /^\/zkteco(\/|$)/, /^\/standalone-sync(\/|$)/, /^\/standalone(\/|$)/,   // attendance devices
  /^\/license(\/|$)/,
];

function collect(node, out, parentName, depth = 0, budget = { n: 0 }) {
  if (node == null || depth > 10 || budget.n++ > 50000) return;
  if (typeof node === 'string') {
    if (node.length < 40 || node.indexOf(';base64,') === -1) return;
    DATA_URL_RE.lastIndex = 0;
    let m;
    while ((m = DATA_URL_RE.exec(node)) !== null) out.push({ mime: (m[1] || '').toLowerCase(), b64: m[3], name: parentName || '' });
    return;
  }
  if (Array.isArray(node)) { for (const v of node) collect(v, out, parentName, depth + 1, budget); return; }
  if (typeof node === 'object') {
    let nm = '';
    for (const k of NAME_KEYS) if (typeof node[k] === 'string' && node[k].length < 300) { nm = node[k]; break; }
    for (const v of Object.values(node)) collect(v, out, nm || parentName, depth + 1, budget);
  }
}

export async function uploadGuard(req, res, next) {
  try {
    if (!['POST', 'PUT', 'PATCH'].includes(req.method)) return next();
    const body = req.body;
    if (!body || typeof body !== 'object') return next();
    const p = (req.path || '').split('?')[0];
    if (EXEMPT.some(r => r.test(p))) return next();

    const found = [];
    collect(body, found, '');
    if (!found.length) return next();

    const seen = new Set();
    const blocked = [];
    for (const f of found.slice(0, 60)) {
      let buf;
      try { buf = Buffer.from(f.b64.replace(/-/g, '+').replace(/_/g, '/'), 'base64'); } catch { continue; }
      if (!buf.length) continue;
      const h = crypto.createHash('sha1').update(buf).digest('hex');
      if (seen.has(h)) continue;
      seen.add(h);
      const r = await scanUpload(buf, { declaredMime: f.mime, filename: f.name });
      if (!r.ok) blocked.push({ name: f.name || '(unnamed file)', type: f.mime || 'unknown', reasons: r.reasons });
    }
    if (!blocked.length) return next();

    const summary = blocked.map(b => `${b.name}: ${b.reasons.join('; ')}`).join(' | ');
    console.warn(`[uploadGuard] BLOCKED ${req.method} ${req.originalUrl} user=${req.user?.id ?? '-'} ip=${req.ip} :: ${summary}`);
    logAudit({
      actor: req.user || null, action: 'upload_blocked', entity: 'upload', entityId: null,
      before: null, after: { path: req.originalUrl, method: req.method, ip: req.ip, blocked },
    }).catch(() => {});

    return res.status(422).json({
      error: `Upload blocked for safety — ${summary}. The file was NOT saved. Please upload a normal image or document.`,
      code: 'UPLOAD_BLOCKED',
      blocked,
    });
  } catch (e) {
    console.error('[uploadGuard] scanner error (allowing request):', e.message);
    return next();
  }
}
