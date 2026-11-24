/* Chart of accounts: groups, ledgers, bank QR codes. Port of routers/accounts.py. */
import { Router } from 'express';
import { q, one, tx } from '../../services/accounts/accDb.js';
import { ah, bad, audit, checkPan, money, nz, flag, userOf } from '../../services/accounts/common.js';
import { adminApproval } from '../../services/accounts/authz.js';
import { saveImage, removeImage, serveImage } from '../../services/accounts/files.js';
import { LEDGERS } from '../../services/accounts/seed.js';

const router = Router();
const KINDS = ['general', 'cash', 'bank', 'party', 'tax'];
const BANK_ROOT = '1203';   // Cash and Cash Equivalents: user sub-groups under it are bank sub-ledgers
const GROUP_BANK_FIELDS = ['bank_account_name', 'bank_account_no', 'bank_branch', 'address', 'phone', 'contact_person', 'contact_mobile'];
const BANK_FIELDS = ['bank_account_name', 'bank_account_no', 'bank_branch', 'contact_person', 'contact_mobile'];
const PHONE_RE = /^[+\d][\d\s\-/]{5,24}$/;
const BANKNO_RE = /^[A-Za-z0-9\-/ ]{4,40}$/;

/** True when a group with this parent sits anywhere under Cash and Cash Equivalents. */
async function isBankParent(parentId, run = { one }) {
  let seen = 0;
  while (parentId && seen < 20) {
    const p = await run.one('SELECT id, code, parent_id FROM acc_groups WHERE id = %s', [parentId]);
    if (!p) return false;
    if (p.code === BANK_ROOT) return true;
    parentId = p.parent_id; seen++;
  }
  return false;
}

/** A bank sub-group can't take entries itself, so it gets one main Bank ledger with the same name
 *  (kept in sync on rename). Returns the ledger id, or null if the group isn't a bank sub-group. */
export async function ensureGroupLedger(t, gid, user = 'system') {
  const g = await t.one('SELECT * FROM acc_groups WHERE id = %s', [gid]);
  if (!g || g.is_system || !(await isBankParent(g.parent_id, t))) return null;
  const cur = await t.one('SELECT * FROM acc_ledgers WHERE bank_group_id = %s', [gid]);
  let name = g.name;
  const clash = await t.one('SELECT id FROM acc_ledgers WHERE LOWER(name) = LOWER(%s) AND id <> %s', [name, cur ? cur.id : 0]);
  if (clash) name = `${g.name} A/c`;
  if (cur) {
    if (cur.name !== name) await t.query('UPDATE acc_ledgers SET name = %s, updated_by = %s, updated_at = NOW() WHERE id = %s', [name, user, cur.id]);
    return cur.id;
  }
  let n = 1;
  while (await t.one('SELECT 1 AS x FROM acc_ledgers WHERE code = %s', [`${g.code}-${String(n).padStart(3, '0')}`])) n++;
  const row = await t.one(
    "INSERT INTO acc_ledgers (code, name, name_np, group_id, kind, bank_group_id, created_by, updated_by, updated_at)"
    + " VALUES (%s, %s, %s, %s, 'bank', %s, %s, %s, NOW()) RETURNING id",
    [`${g.code}-${String(n).padStart(3, '0')}`, name, g.name_np, gid, gid, user, user]);
  await audit(t, user, 'create', 'account', row.id, { name, reason: `main ledger for bank sub-group '${g.name}'` });
  return row.id;
}

/** Startup/first-use: make sure every bank sub-group has its main ledger (adds only). */
export async function syncBankGroupLedgers() {
  await tx(async (t) => {
    for (const g of (await t.query('SELECT id FROM acc_groups WHERE is_system = 0')).rows) await ensureGroupLedger(t, g.id);
  });
}

function cleanBank(b, isBank) {
  if (!isBank) { for (const k of GROUP_BANK_FIELDS) b[k] = null; return; }
  for (const k of GROUP_BANK_FIELDS) b[k] = nz(b[k]);
  for (const [k, label] of [['phone', 'Phone'], ['contact_mobile', 'Contact mobile']]) {
    if (b[k] && !PHONE_RE.test(b[k])) bad(`${label}: use digits only.`);
  }
  if (b.bank_account_no && !BANKNO_RE.test(b.bank_account_no)) bad('Bank account no.: letters, numbers and dashes only.');
}

router.get('/groups', ah(async (_req, res) => {
  const rows = (await q('SELECT * FROM acc_groups ORDER BY code')).rows;
  for (const r of rows) r.is_bank_group = !r.is_system && (await isBankParent(r.parent_id));
  res.json(rows);
}));

router.post('/groups', ah(async (req, res) => {
  const b = req.body || {};
  const parent = await one('SELECT * FROM acc_groups WHERE id = %s', [b.parent_id || 0]);
  if (!parent) bad('Parent group not found.');
  if (!nz(b.name)) bad('Group name is required.');
  cleanBank(b, await isBankParent(parent.id));
  let n = (await one('SELECT COUNT(*) AS n FROM acc_groups WHERE parent_id = %s', [parent.id])).n;
  const mk = () => (parent.code.length < 4 ? `${parent.code}${String(n + 1).padStart(2, '0')}` : `${parent.code}-${String(n + 1).padStart(2, '0')}`);
  let code = mk();
  while (await one('SELECT 1 AS x FROM acc_groups WHERE code = %s', [code])) { n++; code = mk(); }
  const user = userOf(req);
  const row = await tx(async (t) => {
    const r = await t.one(
      'INSERT INTO acc_groups (code, name, name_np, nature, parent_id, sort, bank_account_no, bank_branch, address, phone,'
      + ' contact_person, contact_mobile, updated_by, updated_at, bank_account_name)'
      + ' VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW(),%s) RETURNING *',
      [code, String(b.name).trim(), nz(b.name_np), parent.nature, parent.id, 999, b.bank_account_no, b.bank_branch, b.address,
        b.phone, b.contact_person, b.contact_mobile, user, b.bank_account_name]);
    await audit(t, user, 'create', 'group', r.id, b);
    await ensureGroupLedger(t, r.id, user);
    return r;
  });
  res.json(row);
}));

router.put('/groups/:gid', ah(async (req, res) => {
  const gid = +req.params.gid, b = req.body || {};
  const g = await one('SELECT * FROM acc_groups WHERE id = %s', [gid]) || bad('Group not found.', 404);
  if (g.is_system) bad("Standard NFRS groups can't be renamed (financial statements depend on them). Add a sub-group instead.");
  if (!nz(b.name)) bad('Group name is required.');
  cleanBank(b, await isBankParent(g.parent_id));
  const user = userOf(req);
  await tx(async (t) => {
    await t.query(
      'UPDATE acc_groups SET name=%s, name_np=%s, bank_account_no=%s, bank_branch=%s, address=%s, phone=%s,'
      + ' contact_person=%s, contact_mobile=%s, updated_by=%s, updated_at=NOW(), bank_account_name=%s WHERE id = %s',
      [String(b.name).trim(), nz(b.name_np), b.bank_account_no, b.bank_branch, b.address, b.phone, b.contact_person, b.contact_mobile, user, b.bank_account_name, gid]);
    const changed = {};
    for (const k of Object.keys(b)) if (k in g && k !== 'parent_id' && String(g[k] ?? '') !== String(b[k] ?? '')) changed[k] = [g[k], b[k]];
    await audit(t, user, 'update', 'group', gid, changed);
    await ensureGroupLedger(t, gid, user);
  });
  res.json({ ok: true });
}));

router.post('/groups/:gid/qr', ah(async (req, res) => {
  const gid = +req.params.gid;
  const g = await one('SELECT * FROM acc_groups WHERE id = %s', [gid]) || bad('Group not found.', 404);
  if (g.is_system || !(await isBankParent(g.parent_id))) bad('A QR image can only be added to a bank sub-group under Cash and Cash Equivalents.');
  const name = await saveImage('bank-qr', `g${gid}`, req.body?.data_url, 2);
  await removeImage('bank-qr', g.qr_image);
  await tx(async (t) => {
    await t.query('UPDATE acc_groups SET qr_image = %s, updated_by = %s, updated_at = NOW() WHERE id = %s', [name, userOf(req), gid]);
    await audit(t, userOf(req), 'update', 'group', gid, { qr_image: 'uploaded' });
  });
  res.json({ ok: true });
}));
router.get('/groups/:gid/qr', ah(async (req, res) => {
  const g = await one('SELECT qr_image FROM acc_groups WHERE id = %s', [+req.params.gid]) || bad('Group not found.', 404);
  await serveImage(res, 'bank-qr', g.qr_image);
}));
router.delete('/groups/:gid/qr', ah(async (req, res) => {
  const gid = +req.params.gid;
  const g = await one('SELECT qr_image FROM acc_groups WHERE id = %s', [gid]) || bad('Group not found.', 404);
  await removeImage('bank-qr', g.qr_image);
  await tx(async (t) => {
    await t.query('UPDATE acc_groups SET qr_image = NULL WHERE id = %s', [gid]);
    await audit(t, userOf(req), 'update', 'group', gid, { qr_image: 'removed' });
  });
  res.json({ ok: true });
}));

router.delete('/groups/:gid', ah(async (req, res) => {
  const gid = +req.params.gid;
  const g = await one('SELECT * FROM acc_groups WHERE id = %s', [gid]) || bad('Group not found.', 404);
  if (g.is_system) bad("Standard NFRS groups can't be deleted.");
  const main = await one('SELECT * FROM acc_ledgers WHERE bank_group_id = %s', [gid]);
  if (await one('SELECT 1 AS x FROM acc_ledgers WHERE group_id = %s AND id <> %s', [gid, main ? main.id : 0])
      || await one('SELECT 1 AS x FROM acc_groups WHERE parent_id = %s', [gid])) bad('Move or delete its ledgers and sub-groups first.');
  if (main) await checkDeletable(main);
  await tx(async (t) => {
    if (main) await t.query('DELETE FROM acc_ledgers WHERE id = %s', [main.id]);
    await t.query('DELETE FROM acc_groups WHERE id = %s', [gid]);
    await audit(t, userOf(req), 'delete', 'group', gid, { name: g.name });
  });
  await removeImage('bank-qr', g.qr_image);
  res.json({ ok: true });
}));

router.get('/accounts', ah(async (req, res) => {
  // hide_in_entry: a bank sub-group's automatic main ledger (and a general Bank ledger whose group has bank
  // sub-groups) is hidden from voucher/bill pickers — unless it already holds entries or a balance.
  let sql = 'SELECT a.*, g.name AS group_name, g.code AS group_code, g.nature,'
    + ' (SELECT COUNT(*) FROM acc_voucher_lines l WHERE l.account_id = a.id) AS used,'
    + ' CASE WHEN NOT EXISTS (SELECT 1 FROM acc_voucher_lines l2 WHERE l2.account_id = a.id)'
    + '   AND ABS(COALESCE(a.opening_balance, 0)) < 0.005 AND ('
    + '     (a.bank_group_id IS NOT NULL'
    + '       AND EXISTS (SELECT 1 FROM acc_ledgers b WHERE b.group_id = a.group_id AND b.id <> a.id AND b.active = 1))'
    + "     OR (a.kind = 'bank' AND a.bank_group_id IS NULL"
    + '       AND EXISTS (SELECT 1 FROM acc_groups sg WHERE sg.parent_id = a.group_id AND sg.is_system = 0'
    + '                   AND EXISTS (SELECT 1 FROM acc_ledgers m WHERE m.bank_group_id = sg.id AND m.active = 1))))'
    + '   THEN 1 ELSE 0 END AS hide_in_entry'
    + ' FROM acc_ledgers a JOIN acc_groups g ON g.id = a.group_id';
  if (!(req.query.include_inactive === 'true' || req.query.include_inactive === '1')) sql += ' WHERE a.active = 1';
  res.json((await q(`${sql} ORDER BY a.code`)).rows);
}));

/** Bank accounts a customer can pay into (name, account no., branch + whether it has a QR) — shared with a bill on WhatsApp. */
export async function bankAccounts() {
  const groups = (await q('SELECT * FROM acc_groups WHERE is_system = 0 ORDER BY code')).rows;
  const ledgers = (await q("SELECT id, name, bank_account_name, bank_account_no, bank_branch, qr_image, bank_group_id FROM acc_ledgers WHERE kind = 'bank' AND active = 1 ORDER BY code")).rows;
  const out = [];
  for (const g of groups) {
    if (!(await isBankParent(g.parent_id))) continue;
    if (!g.bank_account_no && !g.qr_image) continue;
    out.push({ name: g.name, account_name: g.bank_account_name, account_no: g.bank_account_no, branch: g.bank_branch, qr: g.qr_image ? `/api/accounts/groups/${g.id}/qr` : null, qr_image: g.qr_image,
      ledger_ids: ledgers.filter((l) => l.bank_group_id === g.id).map((l) => l.id) });
  }
  for (const l of ledgers) {
    if (l.bank_group_id || (!l.bank_account_no && !l.qr_image)) continue;
    out.push({ name: l.name, account_name: l.bank_account_name, account_no: l.bank_account_no, branch: l.bank_branch, qr: l.qr_image ? `/api/accounts/accounts/${l.id}/qr` : null, qr_image: l.qr_image, ledger_ids: [l.id] });
  }
  return out;
}
/** Bank accounts a customer can pay into: the one this bill was received in, else every bank with an account no. / QR. */
export async function bankAccountsFor(cashAccountId) {
  const list = await bankAccounts();
  const mine = cashAccountId ? list.filter((b) => b.ledger_ids.includes(+cashAccountId)) : [];
  return mine.length ? mine : list;
}
router.get('/bank-share', ah(async (_req, res) => res.json((await bankAccounts()).map(({ qr_image, ...b }) => b))));

async function validateLedger(b, excludeId = 0) {
  if (!nz(b.name)) bad('Ledger name is required.');
  b.kind = b.kind || 'general';
  if (!KINDS.includes(b.kind)) bad('Unknown ledger type.');
  if (b.kind === 'bank') {
    for (const k of [...BANK_FIELDS, 'phone', 'address']) b[k] = nz(b[k]);
    for (const [k, label] of [['phone', 'Phone'], ['contact_mobile', 'Contact mobile']]) if (b[k] && !PHONE_RE.test(b[k])) bad(`${label}: use digits only.`);
    if (b.bank_account_no && !BANKNO_RE.test(b.bank_account_no)) bad('Bank account no.: letters, numbers and dashes only.');
  } else for (const k of BANK_FIELDS) b[k] = null;
  const g = await one('SELECT * FROM acc_groups WHERE id = %s', [b.group_id]);
  if (!g) bad('Group not found.');
  if (g.parent_id === null) bad('Choose a sub-group, not a primary group (Assets, Liabilities ...).');
  if (await one('SELECT id FROM acc_ledgers WHERE LOWER(name) = LOWER(%s) AND id <> %s', [String(b.name).trim(), excludeId])) bad('A ledger with this name already exists.');
  return g;
}

router.post('/accounts', ah(async (req, res) => {
  const b = req.body || {};
  const g = await validateLedger(b);
  const pan = checkPan(b.pan);
  const user = userOf(req);
  const row = await tx(async (t) => {
    let n = (await t.one('SELECT COUNT(*) AS n FROM acc_ledgers WHERE group_id = %s', [g.id])).n;
    const mk = () => `${g.code}-${String(n + 1).padStart(3, '0')}`;
    let code = mk();
    while (await t.one('SELECT 1 AS x FROM acc_ledgers WHERE code = %s', [code])) { n++; code = mk(); }
    const r = await t.one(
      'INSERT INTO acc_ledgers (code, name, name_np, group_id, kind, opening_balance, pan, phone, address, active,'
      + ' created_by, updated_by, updated_at, bank_account_no, bank_branch, contact_person, contact_mobile, bank_account_name)'
      + ' VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW(),%s,%s,%s,%s,%s) RETURNING *',
      [code, String(b.name).trim(), nz(b.name_np), g.id, b.kind, money(b.opening_balance), pan, nz(b.phone), nz(b.address),
        b.active === false ? 0 : 1, user, user, b.bank_account_no, b.bank_branch, b.contact_person, b.contact_mobile, b.bank_account_name]);
    await audit(t, user, 'create', 'account', r.id, b);
    return r;
  });
  res.json(row);
}));

router.put('/accounts/:aid', ah(async (req, res) => {
  const aid = +req.params.aid, b = req.body || {};
  const cur = await one('SELECT * FROM acc_ledgers WHERE id = %s', [aid]) || bad('Ledger not found.', 404);
  // system ledgers (automatic posting): name, group and type are fixed — only the opening balance / bank details / contact can change
  if (cur.system_key) Object.assign(b, { name: cur.name, name_np: cur.name_np, group_id: cur.group_id, kind: cur.kind });
  await validateLedger(b, aid);
  const active = b.active === false ? 0 : 1;

  if (cur.system_key && !active) bad("System ledgers are used by automatic posting and can't be deactivated.");
  const pan = checkPan(b.pan);
  const user = userOf(req);
  const row = await tx(async (t) => {
    const r = await t.one(
      'UPDATE acc_ledgers SET name=%s, name_np=%s, group_id=%s, kind=%s, opening_balance=%s,'
      + ' pan=%s, phone=%s, address=%s, active=%s, updated_by=%s, updated_at=NOW(),'
      + ' bank_account_no=%s, bank_branch=%s, contact_person=%s, contact_mobile=%s, bank_account_name=%s WHERE id = %s RETURNING *',
      [String(b.name).trim(), nz(b.name_np), b.group_id, b.kind, money(b.opening_balance), pan, nz(b.phone), nz(b.address), active, user,
        b.bank_account_no, b.bank_branch, b.contact_person, b.contact_mobile, b.bank_account_name, aid]);
    const changed = {};
    for (const k of Object.keys(b)) if (k in cur && String(cur[k] ?? '') !== String(b[k] ?? '')) changed[k] = [cur[k], b[k]];
    await audit(t, user, 'update', 'account', aid, changed);
    return r;
  });
  res.json(row);
}));

router.post('/accounts/:aid/qr', ah(async (req, res) => {
  const aid = +req.params.aid;
  const cur = await one('SELECT * FROM acc_ledgers WHERE id = %s', [aid]) || bad('Ledger not found.', 404);
  if (cur.kind !== 'bank') bad('A QR image can only be added to a Bank ledger.');
  const name = await saveImage('bank-qr', String(aid), req.body?.data_url, 2);
  await removeImage('bank-qr', cur.qr_image);
  await tx(async (t) => {
    await t.query('UPDATE acc_ledgers SET qr_image = %s, updated_by = %s, updated_at = NOW() WHERE id = %s', [name, userOf(req), aid]);
    await audit(t, userOf(req), 'update', 'account', aid, { qr_image: 'uploaded' });
  });
  res.json({ ok: true });
}));
router.get('/accounts/:aid/qr', ah(async (req, res) => {
  const cur = await one('SELECT qr_image FROM acc_ledgers WHERE id = %s', [+req.params.aid]) || bad('Ledger not found.', 404);
  await serveImage(res, 'bank-qr', cur.qr_image);
}));
router.delete('/accounts/:aid/qr', ah(async (req, res) => {
  const aid = +req.params.aid;
  const cur = await one('SELECT qr_image FROM acc_ledgers WHERE id = %s', [aid]) || bad('Ledger not found.', 404);
  await removeImage('bank-qr', cur.qr_image);
  await tx(async (t) => {
    await t.query('UPDATE acc_ledgers SET qr_image = NULL WHERE id = %s', [aid]);
    await audit(t, userOf(req), 'update', 'account', aid, { qr_image: 'removed' });
  });
  res.json({ ok: true });
}));

/** A ledger can be deleted only while it holds nothing: no entries, no opening balance, not used on bills. */
async function checkDeletable(cur) {
  const n = await one('SELECT COUNT(*) AS n, COALESCE(SUM(dr - cr), 0) AS bal FROM acc_voucher_lines WHERE account_id = %s', [cur.id]);
  if (n.n) bad(`“${cur.name}” has ${n.n} entr${n.n === 1 ? 'y' : 'ies'} (balance Rs ${Math.abs(n.bal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}). A ledger with entries can't be deleted — untick Active instead.`);
  if (Math.abs(cur.opening_balance || 0) > 0.005) bad(`“${cur.name}” has an opening balance of Rs ${Math.abs(cur.opening_balance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}. Set it to 0 first, then delete.`);
  if (await one('SELECT 1 AS x FROM acc_docs WHERE party_id = %s OR cash_account_id = %s LIMIT 1', [cur.id, cur.id])) bad(`“${cur.name}” is used on purchase/sales bills, so it can't be deleted.`);
}

router.post('/accounts/:aid/delete', ah(async (req, res) => {
  const aid = +req.params.aid, b = req.body || {};
  const cur = await one('SELECT * FROM acc_ledgers WHERE id = %s', [aid]) || bad('Ledger not found.', 404);
  if (cur.system_key) bad("This is a system ledger used by automatic posting — it can't be deleted.");
  await checkDeletable(cur);
  let approver = null;
  if (cur.system_key) approver = await adminApproval(req, b.admin_username, b.admin_password);
  await tx(async (t) => {
    await t.query('DELETE FROM acc_party_contacts WHERE account_id = %s', [aid]);
    await t.query('DELETE FROM acc_notifications WHERE party_id = %s', [aid]);
    await t.query('DELETE FROM acc_ledgers WHERE id = %s', [aid]);
    await audit(t, userOf(req), 'delete', 'account', aid, { name: cur.name, code: cur.code, system: cur.system_key, approved_by: approver, reason: b.reason });
  });
  await removeImage('bank-qr', cur.qr_image);
  res.json({ ok: true });
}));

/** Id of a system ledger (sales, input_vat …). If an admin deleted it, it is re-created in its standard group. */
export async function systemAccount(t, key) {
  const r = await t.one('SELECT id FROM acc_ledgers WHERE system_key = %s', [key]);
  if (r) return r.id;
  const def = LEDGERS.find((x) => x[4] === key);
  if (!def) throw new Error(`Unknown system ledger '${key}'.`);
  const [gcode, name0, np, kind] = def;
  const g = await t.one('SELECT id, code FROM acc_groups WHERE code = %s', [gcode]);
  let n = (await t.one('SELECT COUNT(*) AS n FROM acc_ledgers WHERE group_id = %s', [g.id])).n + 1;
  while (await t.one('SELECT 1 AS x FROM acc_ledgers WHERE code = %s', [`${gcode}-${String(n).padStart(3, '0')}`])) n++;
  let name = name0;
  if (await t.one('SELECT 1 AS x FROM acc_ledgers WHERE LOWER(name) = LOWER(%s)', [name])) name = `${name} (system)`;
  const row = await t.one(
    "INSERT INTO acc_ledgers (code, name, name_np, group_id, kind, system_key, created_by) VALUES (%s,%s,%s,%s,%s,%s,'system') RETURNING id",
    [`${gcode}-${String(n).padStart(3, '0')}`, name, np, g.id, kind, key]);
  await audit(t, 'system', 'create', 'account', row.id, { name, reason: `system ledger '${key}' was missing — re-created` });
  return row.id;
}

export default router;
