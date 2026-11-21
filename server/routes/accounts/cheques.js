/* Post-dated cheques taken or given on bills. Port of routers/cheques.py.
 *
 * A cheque bill sits on the party's ledger (the bill), but the cheque itself moves no money until it is
 * deposited (received) or presented (issued). Then a Receipt / Payment voucher is posted:
 *   received  Dr Bank  Cr Customer/Supplier
 *   issued    Dr Supplier/Customer  Cr Bank
 * Bounced cheques post nothing; the bill stays outstanding on the party.
 */
import { Router } from 'express';
import { q, tx, advisoryLock } from '../../services/accounts/accDb.js';
import { ah, bad, audit, nz, userOf, ensureFiscalYear } from '../../services/accounts/common.js';
import { bsStr, isIsoDate } from '../../services/accounts/nepaliDate.js';

const router = Router();

async function list(where = '1=1', params = [], run = { query: q }) {
  const rows = (await run.query(
    'SELECT c.*, p.name AS party_name, d.doc_no, d.doc_type, d.doc_date, b.name AS bank_account, v.voucher_no'
    + ' FROM acc_cheques c LEFT JOIN acc_ledgers p ON p.id = c.party_id LEFT JOIN acc_docs d ON d.id = c.doc_id'
    + ' LEFT JOIN acc_ledgers b ON b.id = c.bank_account_id LEFT JOIN acc_vouchers v ON v.id = c.voucher_id'
    + ` WHERE ${where} ORDER BY c.cheque_date, c.id`, params)).rows;
  for (const r of rows) r.cheque_date_bs = bsStr(r.cheque_date);
  return rows;
}
async function getCheque(cid, run) {
  const rows = await list('c.id = %s', [cid], run);
  if (!rows.length) bad('Cheque not found.', 404);
  return rows[0];
}

router.get('/cheques', ah(async (req, res) => {
  const where = ["c.status <> 'cancelled'"], params = [];
  if (req.query.status) { where.push('c.status = %s'); params.push(req.query.status); }
  if (req.query.direction) { where.push('c.direction = %s'); params.push(req.query.direction); }
  if (req.query.party_id) { where.push('c.party_id = %s'); params.push(+req.query.party_id); }
  res.json(await list(where.join(' AND '), params));
}));

/** Received cheque deposited (or our issued cheque presented) — post the money now. */
router.post('/cheques/:cid/deposit', ah(async (req, res) => {
  const cid = +req.params.cid, b = req.body || {};
  const user = userOf(req);
  const on = String(b.date || '').slice(0, 10);
  if (!isIsoDate(on)) bad('Invalid date.');
  await tx(async (t) => {
    await t.query('SELECT id FROM acc_cheques WHERE id = %s FOR UPDATE', [cid]);
    const c = await getCheque(cid, t);
    if (c.status !== 'pending') bad(`This cheque is already ${c.status}.`);
    const bank = await t.one("SELECT * FROM acc_ledgers WHERE id = %s AND kind = 'bank' AND active = 1", [b.bank_account_id]);
    if (!bank) bad('Choose the bank account.');
    const fy = await ensureFiscalYear(on, t);
    if (fy.is_closed) bad(`Fiscal year ${fy.name} is closed.`);
    const received = c.direction === 'received';
    const vtype = received ? 'RV' : 'PV';
    const narr = `Cheque ${c.cheque_no} (${c.cheque_bank || '-'}) ${received ? 'from' : 'to'} ${c.party_name} ${received ? 'deposited' : 'cleared'} — ${c.doc_no || ''}`.trim();
    const lines = received ? [[bank.id, c.amount, 0], [c.party_id, 0, c.amount]] : [[c.party_id, c.amount, 0], [bank.id, 0, c.amount]];
    await advisoryLock(t, `v:${fy.id}:${vtype}`);
    const seq = (await t.one('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM acc_vouchers WHERE fy_id = %s AND vtype = %s', [fy.id, vtype])).n;
    const vno = `${vtype}/${fy.name.replace('/', '-')}/${String(seq).padStart(4, '0')}`;
    const vid = (await t.one(
      'INSERT INTO acc_vouchers (fy_id, vtype, seq, voucher_no, vdate, narration, reference, amount, created_by, source_doc_id, kind) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id',
      [fy.id, vtype, seq, vno, on, narr, `Chq ${c.cheque_no}`, c.amount, user, c.doc_id, received ? 'receipt' : 'supplier_payment'])).id;
    for (let i = 0; i < lines.length; i++) await t.query('INSERT INTO acc_voucher_lines (voucher_id, account_id, dr, cr, sort) VALUES (%s,%s,%s,%s,%s)', [vid, lines[i][0], lines[i][1], lines[i][2], i]);
    await t.query("UPDATE acc_cheques SET status='cleared', bank_account_id=%s, cleared_date=%s, voucher_id=%s, note=%s, updated_by=%s, updated_at=NOW() WHERE id=%s",
      [bank.id, on, vid, nz(b.note), user, cid]);
    if (c.doc_id) await t.query("UPDATE acc_reminders SET status='done', done_by=%s, done_at=NOW() WHERE doc_id=%s AND kind='cheque' AND status='open'", [user, c.doc_id]);
    await audit(t, user, 'deposit', 'cheque', cid, { cheque_no: c.cheque_no, amount: c.amount, voucher: vno });
  });
  res.json(await getCheque(cid));
}));

router.post('/cheques/:cid/bounce', ah(async (req, res) => {
  const cid = +req.params.cid;
  const reason = String(req.body?.reason || '').trim();
  const user = userOf(req);
  await tx(async (t) => {
    await t.query('SELECT id FROM acc_cheques WHERE id = %s FOR UPDATE', [cid]);
    const c = await getCheque(cid, t);
    if (c.status !== 'pending') bad(`This cheque is already ${c.status}.`);
    if (reason.length < 3) bad('Give a reason (e.g. insufficient funds).');
    await t.query("UPDATE acc_cheques SET status='bounced', note=%s, updated_by=%s, updated_at=NOW() WHERE id=%s", [reason, user, cid]);
    if (c.doc_id) await t.query("UPDATE acc_reminders SET status='done', done_by=%s, done_at=NOW() WHERE doc_id=%s AND kind='cheque' AND status='open'", [user, c.doc_id]);
    await audit(t, user, 'bounce', 'cheque', cid, { cheque_no: c.cheque_no, reason });
  });
  res.json(await getCheque(cid));
}));

/** Back to pending: a deposit is reversed by cancelling its voucher (kept on record). */
router.post('/cheques/:cid/undo', ah(async (req, res) => {
  const cid = +req.params.cid;
  const reason = String(req.body?.reason || '').trim();
  const user = userOf(req);
  await tx(async (t) => {
    await t.query('SELECT id FROM acc_cheques WHERE id = %s FOR UPDATE', [cid]);
    const c = await getCheque(cid, t);
    if (!['cleared', 'bounced'].includes(c.status)) bad('Only a deposited or bounced cheque can be undone.');
    if (reason.length < 3) bad('Give a reason.');
    if (c.voucher_id) {
      const fy = await t.one('SELECT f.is_closed FROM acc_vouchers v JOIN acc_fiscal_years f ON f.id = v.fy_id WHERE v.id = %s', [c.voucher_id]);
      if (fy && fy.is_closed) bad('Fiscal year of the deposit is closed.');
      await t.query("UPDATE acc_vouchers SET status='cancelled', cancel_reason=%s, cancelled_by=%s, cancelled_at=NOW() WHERE id = %s", [`Cheque deposit undone: ${reason}`, user, c.voucher_id]);
    }
    await t.query("UPDATE acc_cheques SET status='pending', bank_account_id=NULL, cleared_date=NULL, voucher_id=NULL, note=%s, updated_by=%s, updated_at=NOW() WHERE id=%s", [reason, user, cid]);
    await audit(t, user, 'undo', 'cheque', cid, { cheque_no: c.cheque_no, was: c.status, reason });
  });
  res.json(await getCheque(cid));
}));

export default router;
