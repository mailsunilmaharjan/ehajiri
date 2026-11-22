import { Router } from 'express';
import { q, one, tx } from '../../services/accounts/accDb.js';
import { ah, bad, audit, checkPan, nz, flag, int, num, userOf, ensureFiscalYear } from '../../services/accounts/common.js';
import { bsStr, todayAd } from '../../services/accounts/nepaliDate.js';
import { requireAdmin } from '../../services/accounts/authz.js';
import * as notify from '../../services/accounts/notify.js';

const router = Router();
const SECRET = ['smtp_password'];
const LEGACY_SMTP = ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_from', 'smtp_tls'];   // unused — email now comes from Settings › Email Setup
const ADMIN_ONLY = ['wa_gateway_url', 'wa_method'];

/** Role name the ported screens understand: admin | accountant (can edit) | viewer (read-only). */
export const accRole = (u) => (u.isAdmin ? 'admin' : u.perm.edit ? 'accountant' : 'viewer');

function pub(c, req, extra) {
  const out = { ...c };
  for (const k of [...SECRET, ...LEGACY_SMTP]) delete out[k];
  if (!req.accUser.isAdmin) for (const k of ADMIN_ONLY) delete out[k];
  for (const k of ['vat_registered', 'auto_email_si', 'auto_email_pb', 'auto_wa_si', 'auto_wa_pb']) if (k in out) out[k] = !!out[k];
  out.email_ready = extra.email_ready;
  out.wa_ready = !!extra.wa_gateway_url;
  return out;
}

async function companyPayload(req) {
  const c = await one('SELECT * FROM acc_company WHERE id = 1');
  const today = todayAd();
  const fy = await ensureFiscalYear(today);
  return {
    company: pub(c, req, { ...c, email_ready: await notify.emailReady().catch(() => false) }),
    user: { id: req.accUser.id, username: req.accUser.username, full_name: req.accUser.fullName, role: accRole(req.accUser), is_super: req.accUser.role === 'superAdmin', must_change: false },
    today, today_bs: bsStr(today), current_fy: fy,
  };
}

router.get('/company', ah(async (req, res) => res.json(await companyPayload(req))));

router.put('/company', ah(async (req, res) => {
  requireAdmin(req);
  const b = req.body || {};
  if (!nz(b.name)) bad('Company name is required.');
  const dd = b.date_display || 'BS';
  if (!['BS', 'AD', 'Both'].includes(dd)) bad('Date display must be BS, AD or Both.');
  const wam = b.wa_method || 'GET';
  if (!['GET', 'POST'].includes(wam)) bad('WhatsApp method must be GET or POST.');
  const wa = nz(b.wa_gateway_url);
  if (wa && !/^https?:\/\//.test(wa)) bad('WhatsApp gateway URL must start with https://');
  const alertDays = int(b.alert_days, 7);
  if (alertDays < 0 || alertDays > 90) bad('Alert days must be 0–90.');
  const pan = checkPan(b.pan);
  const vatReg = b.vat_registered === undefined ? 1 : flag(b.vat_registered);
  if (vatReg && !pan) bad('A VAT-registered business must enter its 9-digit PAN/VAT number.');
  const user = userOf(req);
  await tx(async (t) => {
    await t.query(
      'UPDATE acc_company SET name=%s, name_np=%s, address=%s, phone=%s, email=%s, pan=%s, vat_registered=%s, vat_rate=%s,'
      + ' date_display=%s, alert_days=%s, auto_email_si=%s, auto_email_pb=%s, auto_wa_si=%s, auto_wa_pb=%s,'
      + ' wa_gateway_url=%s, wa_method=%s,'
      + ' updated_by=%s, updated_at=NOW() WHERE id = 1',
      [String(b.name).trim(), nz(b.name_np), nz(b.address), nz(b.phone), nz(b.email), pan, vatReg, num(b.vat_rate, 13),
        dd, alertDays, flag(b.auto_email_si), flag(b.auto_email_pb), flag(b.auto_wa_si), flag(b.auto_wa_pb),
        wa, wam,
        user]);
    const detail = { ...b }; delete detail.smtp_password;
    await audit(t, user, 'update', 'company', 1, detail);
  });
  res.json(await companyPayload(req));
}));

router.post('/notify/test', ah(async (req, res) => {
  requireAdmin(req);
  const { channel, to } = req.body || {};
  if (channel === 'email') await notify.sendEmail(to, 'Test email from eHajiri Accounts', '<p>Email settings work. ✔</p>');
  else if (channel === 'whatsapp') await notify.sendWhatsapp(to, 'Test message from eHajiri Accounts. WhatsApp settings work.');
  else bad('Unknown channel.');
  res.json({ ok: true });
}));

router.get('/fiscal-years', ah(async (_req, res) => {
  const rows = (await q('SELECT * FROM acc_fiscal_years ORDER BY start_date DESC')).rows;
  for (const r of rows) { r.start_bs = bsStr(r.start_date); r.end_bs = bsStr(r.end_date); }
  res.json(rows);
}));

router.get('/audit-log', ah(async (req, res) => {
  if (!req.accUser.perm.edit) bad("Viewers can't see the audit trail.", 403);
  const { username, entity, q: text, date_from, date_to } = req.query;
  const where = [], params = [];
  if (username) { where.push('a.username = %s'); params.push(username); }
  if (entity) { where.push('a.entity = %s'); params.push(entity); }
  if (text) { where.push('(a.detail ILIKE %s OR a.action ILIKE %s)'); params.push(`%${text}%`, `%${text}%`); }
  if (date_from) { where.push('a.at >= %s::date'); params.push(date_from); }
  if (date_to) { where.push("a.at < (%s::date + 1)"); params.push(date_to); }
  const limit = Math.min(int(req.query.limit, 300), 2000);
  res.json((await q(
    `SELECT a.*, COALESCE(NULLIF(u.full_name, ''), a.username) AS user_name
       FROM acc_audit_log a LEFT JOIN users u ON LOWER(u.username) = LOWER(a.username)${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY a.id DESC LIMIT %s`,
    [...params, limit])).rows);
}));

/** eHajiri's active staff — for "assign to" pickers (the demo had its own users list). */
router.get('/users/list', ah(async (_req, res) => {
  const pool = (await import('../../db.js')).default;
  const { rows } = await pool.query("SELECT username, full_name FROM users WHERE COALESCE(active, TRUE) = TRUE ORDER BY username");
  res.json(rows);
}));

/** Staff cards (name, post, department, contact, photo) for the follow-up avatars shown in the document grids. */
router.get('/users/cards', ah(async (req, res) => {
  const names = String(req.query.u || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 60);
  if (!names.length) return res.json([]);
  const pool = (await import('../../db.js')).default;
  const { rows } = await pool.query(
    `SELECT username, full_name, position, department, branch, phone, email, profile_photo
       FROM users WHERE username = ANY($1::text[])`, [names]);
  res.json(rows);
}));

export default router;
