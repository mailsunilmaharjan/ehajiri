/* Customers (Sundry Debtors) and Suppliers (Sundry Creditors). Port of routers/parties.py.
 * Each party is a ledger under 1202 Trade Receivables or 2201 Trade Payables, so its statement is the
 * normal Ledger report. A party can have many contact persons. */
import { Router } from 'express';
import { q, one, tx } from '../../services/accounts/accDb.js';
import { ah, bad, audit, checkPan, money, nz, int, num, userOf } from '../../services/accounts/common.js';

const router = Router();
const GROUP_OF = { customer: '1202', supplier: '2201' };
const LEVELS = ['mrp', 'dealer', 'partner'];
const BAL_SQL = ' a.opening_balance + COALESCE((SELECT SUM(l.dr - l.cr) FROM acc_voucher_lines l JOIN acc_vouchers v ON v.id = l.voucher_id'
  + "   WHERE l.account_id = a.id AND v.status = 'posted'), 0) AS balance";
const PHONE_RE = /^[+\d][\d\s\-/]{5,24}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const OTHER = { customer: 'supplier', supplier: 'customer' };
// balance (Dr +) of the linked counterpart ledger, so a "Both" party can show its net position
const LINKED_BAL_SQL = ' (SELECT b.opening_balance + COALESCE((SELECT SUM(l.dr - l.cr) FROM acc_voucher_lines l JOIN acc_vouchers v ON v.id = l.voucher_id'
  + "   WHERE l.account_id = b.id AND v.status = 'posted'), 0) FROM acc_ledgers b WHERE b.id = a.linked_party_id) AS linked_balance";

const contactsOf = async (pid) => (await q('SELECT * FROM acc_party_contacts WHERE account_id = %s ORDER BY sort, id', [pid])).rows;

router.get('/parties', ah(async (req, res) => {
  const where = ['a.party_type IS NOT NULL'], params = [];
  if (req.query.type) { where.push('a.party_type = %s'); params.push(req.query.type); }
  if (!(req.query.include_inactive === 'true' || req.query.include_inactive === '1')) where.push('a.active = 1');
  const rows = (await q(
    `SELECT a.*, g.name AS group_name,${BAL_SQL},${LINKED_BAL_SQL},`
    + ' (SELECT MAX(v.vdate) FROM acc_voucher_lines l JOIN acc_vouchers v ON v.id = l.voucher_id'
    + "   WHERE l.account_id = a.id AND v.status = 'posted') AS last_date,"
    + ' (SELECT COUNT(*) FROM acc_party_contacts c WHERE c.account_id = a.id) AS contact_count,'
    + " (SELECT string_agg(c.name, E'\\n' ORDER BY c.sort, c.id) FROM acc_party_contacts c WHERE c.account_id = a.id) AS contact_names,"
    + " (SELECT c.name || COALESCE(' · ' || c.mobile1, '') FROM acc_party_contacts c WHERE c.account_id = a.id ORDER BY c.sort, c.id LIMIT 1) AS main_contact,"
    + " (SELECT COALESCE(NULLIF(u.full_name, ''), u.username) FROM users u WHERE u.username = COALESCE(a.updated_by, a.created_by)) AS saved_by_name"
    + ' FROM acc_ledgers a JOIN acc_groups g ON g.id = a.group_id'
    + ` WHERE ${where.join(' AND ')} ORDER BY a.name`, params)).rows;
  for (const r of rows) { r.balance = money(r.balance); if (r.linked_balance != null) r.linked_balance = money(r.linked_balance); }
  res.json(rows);
}));

router.get('/parties/:pid', ah(async (req, res) => {
  const pid = +req.params.pid;
  const r = await one(`SELECT a.*,${BAL_SQL},${LINKED_BAL_SQL} FROM acc_ledgers a WHERE a.id = %s AND a.party_type IS NOT NULL`, [pid]) || bad('Party not found.', 404);
  r.balance = money(r.balance);
  if (r.linked_balance != null) r.linked_balance = money(r.linked_balance);
  r.contacts = await contactsOf(pid);
  res.json(r);
}));

function phone(p, label) {
  const v = String(p || '').trim();
  if (v && !PHONE_RE.test(v)) bad(`${label} “${v}” is not a phone number — use digits only (e.g. 9841234567), or clear it.`);
  return v || null;
}
function email(e, label) {
  const v = String(e || '').trim();
  if (v && !EMAIL_RE.test(v)) bad(`${label}: not a valid email address.`);
  return v || null;
}

async function checkParty(b, exclude = 0, linkedId = 0) {
  if (!GROUP_OF[b.party_type]) bad('Choose Customer or Supplier.');
  if (!nz(b.name)) bad('Name is required.');
  b.price_level = b.price_level || 'mrp';
  if (!LEVELS.includes(b.price_level)) bad('Unknown price level.');
  b.credit_days = int(b.credit_days); b.credit_limit = num(b.credit_limit); b.opening_balance = num(b.opening_balance);
  if (b.credit_days < 0 || b.credit_limit < 0) bad("Credit days and limit can't be negative.");
  const clash = await one('SELECT id, party_type, linked_party_id FROM acc_ledgers WHERE LOWER(name) = LOWER(%s) AND id <> %s AND id <> %s', [String(b.name).trim(), exclude, linkedId]);
  if (clash) {
    if (clash.party_type === OTHER[b.party_type] && !clash.linked_party_id) {
      bad(`A ledger with this name already exists — "${String(b.name).trim()}" is already a ${clash.party_type}. Open that ${clash.party_type} and tick “Also a ${b.party_type}” instead of adding it again.`);
    }
    bad('A ledger with this name already exists.');
  }
  const pan = checkPan(b.pan);
  if (pan && await one('SELECT id FROM acc_ledgers WHERE pan = %s AND party_type = %s AND id <> %s', [pan, b.party_type, exclude])) bad(`Another ${b.party_type} already has PAN ${pan}.`);
  b.phone = phone(b.phone, 'Mobile No.'); b.whatsapp = phone(b.whatsapp, 'WhatsApp Mobile No.'); b.office_phone = phone(b.office_phone, 'Office Phone');
  b.email = email(b.email, 'Email');
  b.transport_name = nz(b.transport_name); b.transport_phone = phone(b.transport_phone, 'Transport Phone'); b.transport_address = nz(b.transport_address);
  const clean = [];
  (b.contacts || []).forEach((c, i) => {
    const any = ['name', 'mobile1', 'mobile2', 'email', 'remarks'].some((k) => String(c?.[k] || '').trim());
    if (!any) return;   // empty row
    if (!String(c.name || '').trim()) bad(`Contact person ${i + 1}: name is required.`);
    clean.push({
      name: c.name.trim(), post: nz(c.post), dept: nz(c.dept),
      mobile1: phone(c.mobile1, `Contact person ${c.name} — Mobile 1`), mobile2: phone(c.mobile2, `Contact person ${c.name} — Mobile 2`),
      email: email(c.email, `Contact ${c.name} email`), remarks: nz(c.remarks),
    });
  });
  b.contacts = clean;
  b.contact_person = clean.length ? clean[0].name : null;
  return pan;
}

async function saveContacts(t, pid, contacts) {
  await t.query('DELETE FROM acc_party_contacts WHERE account_id = %s', [pid]);
  for (let i = 0; i < contacts.length; i++) {
    const c = contacts[i];
    await t.query('INSERT INTO acc_party_contacts (account_id, name, post, dept, mobile1, mobile2, email, remarks, sort) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)',
      [pid, c.name, c.post, c.dept, c.mobile1, c.mobile2, c.email, c.remarks, i]);
  }
}
const saveTransport = (t, pid, b) => t.query('UPDATE acc_ledgers SET transport_name = %s, transport_phone = %s, transport_address = %s WHERE id = %s',
  [b.transport_name, b.transport_phone, b.transport_address, pid]);

async function nextCode(t, g) {
  let n = (await t.one('SELECT COUNT(*) AS n FROM acc_ledgers WHERE group_id = %s', [g.id])).n + 1;
  const mk = () => `${g.code}-${String(n).padStart(3, '0')}`;
  while (await t.one('SELECT 1 AS x FROM acc_ledgers WHERE code = %s', [mk()])) n++;
  return mk();
}

/** The same business in its other role: a second ledger (receivable <-> payable) sharing name, PAN, contacts and transport, linked both ways. */
async function createCounterpart(t, src, user) {
  const other = OTHER[src.party_type];
  const g = await t.one('SELECT * FROM acc_groups WHERE code = %s', [GROUP_OF[other]]);
  const r = await t.one(
    'INSERT INTO acc_ledgers (code, name, name_np, group_id, kind, party_type, opening_balance, pan, phone, whatsapp, office_phone,'
    + ' email, address, contact_person, credit_limit, credit_days, price_level, active, created_by, updated_by, updated_at, linked_party_id,'
    + ' transport_name, transport_phone, transport_address)'
    + " VALUES (%s,%s,%s,%s,'party',%s,0,%s,%s,%s,%s,%s,%s,%s,0,0,'mrp',1,%s,%s,NOW(),%s,%s,%s,%s) RETURNING *",
    [await nextCode(t, g), src.name, src.name_np, g.id, other, src.pan, src.phone, src.whatsapp, src.office_phone, src.email, src.address,
      src.contact_person, user, user, src.id, src.transport_name, src.transport_phone, src.transport_address]);
  await t.query('UPDATE acc_ledgers SET linked_party_id = %s WHERE id = %s', [r.id, src.id]);
  const contacts = (await t.query('SELECT * FROM acc_party_contacts WHERE account_id = %s ORDER BY sort, id', [src.id])).rows;
  await saveContacts(t, r.id, contacts);
  return r;
}

/** Keep the identity details of both halves of a "Both" party identical (balances, credit terms and active flag stay per role). */
async function syncCounterpart(t, linkedId, b) {
  await t.query('UPDATE acc_ledgers SET name=%s, name_np=%s, pan=%s, phone=%s, whatsapp=%s, office_phone=%s, email=%s, address=%s, contact_person=%s,'
    + ' transport_name=%s, transport_phone=%s, transport_address=%s, updated_by=%s, updated_at=NOW() WHERE id = %s',
    [String(b.name).trim(), nz(b.name_np), b.pan_clean, b.phone, b.whatsapp, b.office_phone, b.email, nz(b.address), b.contact_person,
      b.transport_name, b.transport_phone, b.transport_address, b.user, linkedId]);
  await saveContacts(t, linkedId, b.contacts);
}

router.post('/parties', ah(async (req, res) => {
  const b = req.body || {};
  const pan = await checkParty(b);
  const user = userOf(req);
  const row = await tx(async (t) => {
    const g = await t.one('SELECT * FROM acc_groups WHERE code = %s', [GROUP_OF[b.party_type]]);
    const code = await nextCode(t, g);
    const r = await t.one(
      'INSERT INTO acc_ledgers (code, name, name_np, group_id, kind, party_type, opening_balance, pan, phone, whatsapp, office_phone,'
      + ' email, address, contact_person, credit_limit, credit_days, price_level, active, created_by, updated_by, updated_at)'
      + " VALUES (%s,%s,%s,%s,'party',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW()) RETURNING *",
      [code, String(b.name).trim(), nz(b.name_np), g.id, b.party_type, money(b.opening_balance), pan, b.phone, b.whatsapp, b.office_phone,
        b.email, nz(b.address), b.contact_person, money(b.credit_limit), b.credit_days, b.price_level, b.active === false ? 0 : 1, user, user]);
    await saveContacts(t, r.id, b.contacts);
    await saveTransport(t, r.id, b);
    if (b.also_other_role) {
      const full = await t.one('SELECT * FROM acc_ledgers WHERE id = %s', [r.id]);
      const c = await createCounterpart(t, full, user);
      await audit(t, user, 'create', OTHER[b.party_type], c.id, { linked_to: r.id, name: c.name });
      r.linked_party_id = c.id;
    }
    await audit(t, user, 'create', b.party_type, r.id, b);
    return r;
  });
  res.json(row);
}));

/** Turns a Contact (Staff › Contact) into an Accounts customer — used when a quotation made for a contact becomes a sales order / invoice. Reuses the customer if it already exists. */
router.post('/parties/from-contact', ah(async (req, res) => {
  const cid = +req.body?.contact_id || bad('Contact is required.');
  const user = userOf(req);
  const row = await tx(async (t) => {
    const have = await t.one("SELECT * FROM acc_ledgers WHERE contact_id = %s AND party_type = 'customer' ORDER BY id LIMIT 1", [cid]);
    if (have) return have;
    const c = await t.one('SELECT * FROM staff_contacts WHERE id = %s', [cid]) || bad('Contact not found.', 404);
    const company = c.contact_info === 'company';
    const name = String((company ? c.company_name || c.person_name : c.person_name) || '').trim() || bad('That contact has no name.');
    const same = await t.one("SELECT * FROM acc_ledgers WHERE party_type = 'customer' AND LOWER(name) = LOWER(%s) ORDER BY id LIMIT 1", [name]);
    if (same) { await t.query('UPDATE acc_ledgers SET contact_id = %s WHERE id = %s', [cid, same.id]); return { ...same, contact_id: cid }; }
    const persons = (await t.query('SELECT * FROM staff_contact_persons WHERE contact_id = %s ORDER BY id', [cid])).rows;
    const g = await t.one('SELECT * FROM acc_groups WHERE code = %s', [GROUP_OF.customer]);
    const first = persons[0]?.name || (company ? null : name);
    const r = await t.one(
      'INSERT INTO acc_ledgers (code, name, group_id, kind, party_type, opening_balance, phone, office_phone, email, address, contact_person, credit_limit, credit_days,'
      + " price_level, active, created_by, updated_by, updated_at, contact_id) VALUES (%s,%s,%s,'party','customer',0,%s,%s,%s,%s,%s,0,0,'mrp',1,%s,%s,NOW(),%s) RETURNING *",
      [await nextCode(t, g), name, g.id, nz(c.mobile1), nz(company ? c.company_phone : c.office_phone), nz(company ? c.company_email || c.email : c.email),
        nz(company ? c.company_address || c.address : c.address), first, user, user, cid]);
    const list = persons.length ? persons : (!company && name ? [{ name, mobile1: c.mobile1, mobile2: c.mobile2, email: c.email }] : []);
    await saveContacts(t, r.id, list.map((p) => ({ name: p.name, post: nz(p.post), dept: nz(p.department), mobile1: nz(p.mobile1), mobile2: nz(p.mobile2), email: nz(p.email), remarks: null })));
    await audit(t, user, 'create', 'customer', r.id, { name, from_contact: cid });
    return r;
  });
  res.json(row);
}));

router.put('/parties/:pid', ah(async (req, res) => {
  const pid = +req.params.pid, b = req.body || {};
  const cur = await one('SELECT * FROM acc_ledgers WHERE id = %s AND party_type IS NOT NULL', [pid]) || bad('Party not found.', 404);
  if (cur.party_type !== b.party_type) bad("A customer can't be changed into a supplier. Create a new party instead.");
  const pan = await checkParty(b, pid, cur.linked_party_id || 0);
  const before = (await contactsOf(pid)).map((c) => c.name);
  const user = userOf(req);
  const row = await tx(async (t) => {
    const r = await t.one(
      'UPDATE acc_ledgers SET name=%s, name_np=%s, opening_balance=%s, pan=%s, phone=%s, whatsapp=%s, office_phone=%s, email=%s,'
      + ' address=%s, contact_person=%s, credit_limit=%s, credit_days=%s, price_level=%s, active=%s, updated_by=%s, updated_at=NOW()'
      + ' WHERE id = %s RETURNING *',
      [String(b.name).trim(), nz(b.name_np), money(b.opening_balance), pan, b.phone, b.whatsapp, b.office_phone, b.email, nz(b.address),
        b.contact_person, money(b.credit_limit), b.credit_days, b.price_level, b.active === false ? 0 : 1, user, pid]);
    await saveContacts(t, pid, b.contacts);
    await saveTransport(t, pid, b);
    let linkedId = cur.linked_party_id || 0;
    if (b.also_other_role === true && !linkedId) {
      const full = await t.one('SELECT * FROM acc_ledgers WHERE id = %s', [pid]);
      linkedId = (await createCounterpart(t, full, user)).id;
      await audit(t, user, 'create', OTHER[cur.party_type], linkedId, { linked_to: pid, name: r.name });
    } else if (linkedId) {
      if (b.also_other_role === false) {
        // un-link: only when the other side has never been used
        const used = await t.one('SELECT 1 AS x FROM acc_voucher_lines WHERE account_id = %s LIMIT 1', [linkedId])
          || await t.one('SELECT 1 AS x FROM acc_docs WHERE party_id = %s LIMIT 1', [linkedId])
          || Number((await t.one('SELECT opening_balance AS ob FROM acc_ledgers WHERE id = %s', [linkedId])).ob) !== 0;
        if (used) bad(`The ${OTHER[cur.party_type]} side of ${cur.name} already has transactions or an opening balance, so it can't be removed. Untick Active on it instead.`);
        await t.query('UPDATE acc_ledgers SET linked_party_id = NULL WHERE id IN (%s, %s)', [pid, linkedId]);
        await t.query('DELETE FROM acc_party_contacts WHERE account_id = %s', [linkedId]);
        await t.query('DELETE FROM acc_ledgers WHERE id = %s', [linkedId]);
        await audit(t, user, 'delete', OTHER[cur.party_type], linkedId, { name: cur.name, reason: 'no longer also ' + OTHER[cur.party_type] });
        linkedId = 0;
      } else {
        await syncCounterpart(t, linkedId, { ...b, pan_clean: pan, user });
      }
    }
    const changed = {};
    for (const [k, v] of Object.entries(b)) {
      if (k in cur && k !== 'contacts' && cur[k] !== v && !([null, ''].includes(cur[k]) && [null, '', undefined].includes(v))) changed[k] = [cur[k], v];
    }
    const after = b.contacts.map((c) => c.name);
    if (after.join('|') !== before.join('|')) changed.contacts = [before.join(', '), after.join(', ')];
    await audit(t, user, 'update', b.party_type, pid, changed);
    r.linked_party_id = linkedId || null;
    return r;
  });
  res.json(row);
}));

router.delete('/parties/:pid', ah(async (req, res) => {
  const pid = +req.params.pid;
  const cur = await one('SELECT * FROM acc_ledgers WHERE id = %s AND party_type IS NOT NULL', [pid]) || bad('Party not found.', 404);
  if (await one('SELECT 1 AS x FROM acc_voucher_lines WHERE account_id = %s LIMIT 1', [pid]) || await one('SELECT 1 AS x FROM acc_docs WHERE party_id = %s LIMIT 1', [pid])) {
    bad(`${cur.name} has transactions, so it can't be deleted. Untick Active instead.`);
  }
  await tx(async (t) => {
    await t.query('DELETE FROM acc_notifications WHERE party_id = %s', [pid]);
    await t.query('DELETE FROM acc_party_contacts WHERE account_id = %s', [pid]);
    await t.query('DELETE FROM acc_ledgers WHERE id = %s', [pid]);
    await audit(t, userOf(req), 'delete', cur.party_type, pid, { name: cur.name, pan: cur.pan });
  });
  res.json({ ok: true });
}));

export default router;
