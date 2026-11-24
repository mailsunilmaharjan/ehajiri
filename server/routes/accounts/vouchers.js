/* Manual vouchers (Journal / Payment / Receipt / Contra). Port of routers/vouchers.py.
 * Bills post their own vouchers (see docs.js); those can't be edited here. */
import { Router } from 'express';
import { q, one, tx, advisoryLock } from '../../services/accounts/accDb.js';
import { ah, bad, audit, money, nz, dnz, userOf, ensureFiscalYear, nepMoney } from '../../services/accounts/common.js';
import { bsStr, isIsoDate } from '../../services/accounts/nepaliDate.js';
import { confirmPassword, adminApproval } from '../../services/accounts/authz.js';
import { requestDelete } from './docs.js';
import * as notify from '../../services/accounts/notify.js';

const router = Router();

export const VTYPES = { JV: 'Journal', PV: 'Payment', RV: 'Receipt', CV: 'Contra', PB: 'Purchase', PR: 'Purchase Return', SI: 'Sales', SR: 'Sales Return' };
const MANUAL = ['JV', 'PV', 'RV', 'CV'];
export const KINDS = {
  expense: 'Expense', supplier_payment: 'Supplier Payment', receipt: 'Payment Received', capital_loan: 'Capital / Loan Received',
  staff_advance: 'Staff Advance / Loan', journal: 'Journal', transfer: 'Cash / Bank Transfer', asset_purchase: 'Asset Purchase', asset_sale: 'Asset Sale',
};

async function check(b, run = { one }) {
  if (!MANUAL.includes(b.vtype)) bad('Unknown voucher type.');
  if (b.kind && !KINDS[b.kind]) bad('Unknown voucher kind.');
  if (!isIsoDate(String(b.vdate || '').slice(0, 10))) bad('Invalid date.');
  const lines = [];
  for (const ln of b.lines || []) {
    const dr = money(ln.dr), cr = money(ln.cr);
    if (dr === 0 && cr === 0) continue;
    if (dr < 0 || cr < 0) bad("Amounts can't be negative.");
    if (dr && cr) bad('A line can be either Debit or Credit, not both.');
    const acc = await run.one('SELECT id, name, kind, active FROM acc_ledgers WHERE id = %s', [ln.account_id]);
    if (!acc || !acc.active) bad('One of the ledgers is missing or inactive.');
    lines.push({ account_id: ln.account_id, dr, cr, note: nz(ln.note), kind: acc.kind, name: acc.name });
  }
  if (lines.length < 2) bad('A voucher needs at least one Debit and one Credit line.');
  const tdr = money(lines.reduce((a, l) => a + l.dr, 0)), tcr = money(lines.reduce((a, l) => a + l.cr, 0));
  if (tdr !== tcr) bad(`Debit (${nepMoney(tdr)}) and Credit (${nepMoney(tcr)}) must be equal.`);
  if (new Set(lines.map((l) => l.account_id)).size === 1) bad("Debit and Credit can't be the same ledger.");
  const cashbank = (l) => ['cash', 'bank'].includes(l.kind);
  if (b.vtype === 'PV' && !lines.some((l) => cashbank(l) && l.cr)) bad('Payment voucher: credit a Cash or Bank ledger (money going out).');
  if (b.vtype === 'RV' && !lines.some((l) => cashbank(l) && l.dr)) bad('Receipt voucher: debit a Cash or Bank ledger (money coming in).');
  if (b.vtype === 'CV' && !lines.every(cashbank)) bad('Contra voucher is only for Cash and Bank transfers (deposit, withdrawal).');
  return [lines, tdr];
}

export async function getVoucher(vid, run = { query: q, one }) {
  const v = await run.one('SELECT v.*, f.name AS fy FROM acc_vouchers v JOIN acc_fiscal_years f ON f.id = v.fy_id WHERE v.id = %s', [vid]);
  if (!v) bad('Voucher not found.', 404);
  v.vdate_bs = bsStr(v.vdate);
  v.type_name = KINDS[v.kind || ''] || VTYPES[v.vtype];
  v.lines = (await run.query(
    'SELECT l.*, a.name AS account, a.code, a.email AS ledger_email, a.party_type, a.kind AS ledger_kind FROM acc_voucher_lines l JOIN acc_ledgers a ON a.id = l.account_id WHERE l.voucher_id = %s ORDER BY l.sort', [vid])).rows;
  // The other side of a Payment / Receipt (not cash/bank): a customer / supplier / any ledger with an email — default "Email voucher" recipient.
  const pl = v.lines.filter((l) => !['cash', 'bank'].includes(l.ledger_kind));
  const party = pl.find((l) => l.party_type && l.ledger_email) || pl.find((l) => l.party_type) || pl.find((l) => l.ledger_email) || null;
  v.party_id = party?.account_id ?? null; v.party_name = party?.account ?? null; v.party_email = party?.ledger_email ?? null;
  v.pending_delete = await run.one("SELECT id, requested_by FROM acc_approvals WHERE entity = 'voucher' AND entity_id = %s AND status = 'pending'", [vid]);
  return v;
}

router.post('/vouchers', ah(async (req, res) => {
  const b = req.body || {};
  const user = userOf(req);
  const vid = await tx(async (t) => {
    const [lines, total] = await check(b, t);
    const fy = await ensureFiscalYear(String(b.vdate).slice(0, 10), t);
    if (fy.is_closed) bad(`Fiscal year ${fy.name} is closed.`);
    await advisoryLock(t, `v:${fy.id}:${b.vtype}`);
    const seq = (await t.one('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM acc_vouchers WHERE fy_id = %s AND vtype = %s', [fy.id, b.vtype])).n;
    const vno = `${b.vtype}/${fy.name.replace('/', '-')}/${String(seq).padStart(4, '0')}`;
    const v = await t.one(
      'INSERT INTO acc_vouchers (fy_id, vtype, seq, voucher_no, vdate, narration, reference, amount, created_by, kind) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id',
      [fy.id, b.vtype, seq, vno, String(b.vdate).slice(0, 10), nz(b.narration), nz(b.reference), total, user, nz(b.kind)]);
    for (let i = 0; i < lines.length; i++) {
      await t.query('INSERT INTO acc_voucher_lines (voucher_id, account_id, dr, cr, note, sort) VALUES (%s,%s,%s,%s,%s,%s)', [v.id, lines[i].account_id, lines[i].dr, lines[i].cr, lines[i].note, i]);
    }
    await audit(t, user, 'create', 'voucher', v.id, { voucher_no: vno, amount: total });
    return v.id;
  });
  res.json(await getVoucher(vid));
}));

router.get('/vouchers/:vid', ah(async (req, res) => res.json(await getVoucher(+req.params.vid))));

/** Email a Payment / Receipt voucher to the party (uses the central Settings › Email Setup SMTP). */
router.post('/vouchers/:vid/send', ah(async (req, res) => {
  const vid = +req.params.vid, b = req.body || {};
  const v = await getVoucher(vid);
  if (!['PV', 'RV'].includes(v.vtype)) bad('Only Payment and Receipt vouchers can be emailed.');
  if (v.status === 'cancelled') bad("A cancelled voucher can't be emailed.");
  await notify.sendVoucher(v, userOf(req), b.to, b.text);
  res.json({ ok: true });
}));

router.post('/vouchers/:vid/cancel', ah(async (req, res) => {
  const vid = +req.params.vid;
  const reason = String(req.body?.reason || '').trim();
  const user = userOf(req);
  await tx(async (t) => {
    await t.query('SELECT id FROM acc_vouchers WHERE id = %s FOR UPDATE', [vid]);
    const v = await t.one('SELECT * FROM acc_vouchers WHERE id = %s', [vid]) || bad('Voucher not found.', 404);
    if (v.status === 'cancelled') bad('Already cancelled.');
    if (v.source_doc_id) bad(`${v.voucher_no} was posted from a purchase/sales document. Cancel that document instead.`);
    if (reason.length < 3) bad('Give a reason for cancelling.');
    if ((await t.one('SELECT is_closed FROM acc_fiscal_years WHERE id = %s', [v.fy_id])).is_closed) bad('Fiscal year is closed.');
    await t.query("UPDATE acc_vouchers SET status='cancelled', cancel_reason=%s, cancelled_by=%s, cancelled_at=NOW() WHERE id = %s", [reason, user, vid]);
    await audit(t, user, 'cancel', 'voucher', vid, { voucher_no: v.voucher_no, reason });
  });
  res.json(await getVoucher(vid));
}));

const vsnap = (v) => ({
  voucher_no: v.voucher_no, date: v.vdate, amount: v.amount, narration: v.narration,
  lines: v.lines.map((l) => `${l.account} Dr ${l.dr} Cr ${l.cr}`),
});

export async function manualVoucher(vid, run = { query: q, one }) {
  const v = await getVoucher(vid, run);
  if (v.source_doc_id) bad(`${v.voucher_no} was posted from a purchase/sales document. Edit or delete that document instead.`);
  if ((await run.one('SELECT is_closed FROM acc_fiscal_years WHERE id = %s', [v.fy_id])).is_closed) bad('Fiscal year is closed.');
  return v;
}

/** Edit a manual voucher (same number): needs admin approval (admin password). */
router.put('/vouchers/:vid', ah(async (req, res) => {
  const vid = +req.params.vid, b = req.body || {};
  const approver = await adminApproval(req, b.admin_username, b.password);   // edit needs admin approval
  const user = userOf(req);
  await tx(async (t) => {
    await t.query('SELECT id FROM acc_vouchers WHERE id = %s FOR UPDATE', [vid]);
    const v = await manualVoucher(vid, t);
    if (v.status === 'cancelled') bad("A cancelled voucher can't be edited.");
    if (b.vtype !== v.vtype) bad("Voucher type can't change.");
    const [lines, total] = await check(b, t);
    const fy = await ensureFiscalYear(String(b.vdate).slice(0, 10), t);
    if (fy.id !== v.fy_id) bad('An edited voucher must stay in its own fiscal year.');
    await t.query('UPDATE acc_vouchers SET vdate=%s, narration=%s, reference=%s, amount=%s, updated_by=%s, updated_at=NOW(), edit_count = edit_count + 1 WHERE id=%s',
      [String(b.vdate).slice(0, 10), nz(b.narration), nz(b.reference), total, user, vid]);
    await t.query('DELETE FROM acc_voucher_lines WHERE voucher_id = %s', [vid]);
    for (let i = 0; i < lines.length; i++) {
      await t.query('INSERT INTO acc_voucher_lines (voucher_id, account_id, dr, cr, note, sort) VALUES (%s,%s,%s,%s,%s,%s)', [vid, lines[i].account_id, lines[i].dr, lines[i].cr, lines[i].note, i]);
    }
    await audit(t, user, 'edit', 'voucher', vid, { approved_by: approver, before: vsnap(v), after: vsnap(await getVoucher(vid, t)) });
  });
  res.json(await getVoucher(vid));
}));

export async function deleteVoucherNow(t, v, user, approver, reason) {
  await t.query('DELETE FROM acc_voucher_lines WHERE voucher_id = %s', [v.id]);
  await t.query('DELETE FROM acc_vouchers WHERE id = %s', [v.id]);
  await t.query("UPDATE acc_approvals SET status='approved', decided_by=%s, decided_at=NOW() WHERE entity='voucher' AND entity_id=%s AND status='pending'", [approver, v.id]);
  await audit(t, user, 'delete', 'voucher', v.id, { approved_by: approver, reason, deleted: vsnap(v) });
}

router.post('/vouchers/:vid/delete', ah(async (req, res) => {
  const vid = +req.params.vid, b = req.body || {};
  const reason = String(b.reason || '').trim();
  if (reason.length < 3) bad('Give a reason for deleting.');
  const v = await manualVoucher(vid);
  const user = userOf(req);
  if (b.request_only) {
    await tx((t) => requestDelete(t, 'voucher', vid, v.voucher_no, reason, user));
    return res.json({ requested: true });
  }
  const approver = await adminApproval(req, b.admin_username, b.admin_password);
  await tx(async (t) => {
    await t.query('SELECT id FROM acc_vouchers WHERE id = %s FOR UPDATE', [vid]);
    await deleteVoucherNow(t, await manualVoucher(vid, t), user, approver, reason);
  });
  res.json({ deleted: true });
}));

export default router;
