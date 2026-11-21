/* Day Book, Ledger (with PDF / email) and Trial Balance. Port of routers/reports.py. */
import { Router } from 'express';
import { q, one, tx, marks } from '../../services/accounts/accDb.js';
import { ah, bad, audit, money, userOf, nepMoney } from '../../services/accounts/common.js';
import { bsStr, bsLong } from '../../services/accounts/nepaliDate.js';
import { KINDS, VTYPES } from './vouchers.js';
import * as notify from '../../services/accounts/notify.js';

const router = Router();
const POSTED = "v.status = 'posted'";
const truthy = (v, d) => (v === undefined ? d : v === 'true' || v === '1' || v === true);

// full name of whoever last saved the voucher (falls back to the username)
const SAVED_BY = "COALESCE((SELECT COALESCE(NULLIF(u.full_name, ''), u.username) FROM users u"
  + " WHERE u.username = COALESCE(v.updated_by, v.created_by)), COALESCE(v.updated_by, v.created_by))";

const DAY_TYPES = { PB: 'Purchase', PR: 'Purchase Return', SI: 'Sales', SR: 'Sales Return', RV: 'Amount Received', PV: 'Amount Paid', CV: 'Cash / Bank Transfer', JV: 'Journal' };
const DAY_KINDS = {
  expense: 'Expenses', supplier_payment: 'Amount Paid', receipt: 'Amount Received', capital_loan: 'Capital / Loan Received',
  staff_advance: 'Staff Advance / Loan', transfer: 'Cash / Bank Transfer', journal: 'Journal', asset_purchase: 'Asset Purchase', asset_sale: 'Asset Sale',
};
const dayType = (vtype, kind) => DAY_KINDS[kind || ''] || DAY_TYPES[vtype] || VTYPES[vtype] || vtype;

router.get('/reports/day-book', ah(async (req, res) => {
  const { date_from, date_to, vtype } = req.query;
  if (!date_from || !date_to) bad('Choose a date range.');
  const includeCancelled = truthy(req.query.include_cancelled, true);
  const params = [date_from, date_to];
  let sql = `SELECT v.*, ${SAVED_BY} AS saved_by_name FROM acc_vouchers v WHERE v.vdate BETWEEN %s AND %s`;
  if (vtype) { sql += ' AND v.vtype = %s'; params.push(vtype); }
  if (!includeCancelled) sql += ` AND ${POSTED}`;
  const vouchers = (await q(`${sql} ORDER BY v.vdate, v.id`, params)).rows;
  if (vouchers.length) {
    const ids = vouchers.map((v) => v.id);
    const lines = (await q(
      'SELECT l.*, a.name AS account, a.system_key FROM acc_voucher_lines l JOIN acc_ledgers a ON a.id = l.account_id'
      + ` WHERE l.voucher_id IN (${marks(ids)}) ORDER BY l.voucher_id, l.sort`, ids)).rows;
    const byV = {};
    for (const l of lines) (byV[l.voucher_id] ||= []).push(l);
    for (const v of vouchers) {
      v.lines = byV[v.id] || [];
      v.vdate_bs = bsStr(v.vdate);
      v.type_name = KINDS[v.kind || ''] || VTYPES[v.vtype];
      v.day_type = dayType(v.vtype, v.kind);
    }
  }
  res.json(vouchers);
}));

const chequeMemo = (c, balance) => {
  const on = c.doc_date || c.cheque_date;
  const word = c.direction === 'received' ? 'received' : 'issued';
  const state = c.status === 'bounced' ? 'bounced' : `dated ${bsLong(c.cheque_date)}, not yet ${word === 'received' ? 'deposited' : 'cleared'}`;
  return {
    memo: true, cheque_id: c.id, cheque_status: c.status, cheque_amount: c.amount, voucher_id: null, voucher_no: 'PDC', vtype: 'PDC', kind: null,
    source_doc_id: c.doc_id, day_type: 'Post-dated Cheque', vdate: on, vdate_bs: bsStr(on), reference: c.cheque_no, note: null, dr: 0, cr: 0, balance,
    particulars: `Post-dated cheque ${word}: No. ${c.cheque_no} (${c.cheque_bank || '-'}) Rs ${nepMoney(c.amount)} — ${state}`,
    narration: c.doc_no || '', items: [], bill: null,
  };
};

/** combined: a party that is both customer and supplier has two linked ledgers — one statement shows both (sales, purchases, receipts, payments) with a single net running balance. */
export async function ledgerData(accountId, dateFrom, dateTo, combined = true) {
  const acc = await one(
    'SELECT a.*, g.nature, g.name AS group_name FROM acc_ledgers a JOIN acc_groups g ON g.id = a.group_id WHERE a.id = %s', [accountId]);
  if (!acc) bad('Ledger not found.', 404);
  const ids = combined && acc.linked_party_id ? [accountId, acc.linked_party_id] : [accountId];
  const before = (await one(
    `SELECT COALESCE(SUM(l.dr - l.cr), 0) AS b FROM acc_voucher_lines l JOIN acc_vouchers v ON v.id = l.voucher_id WHERE l.account_id IN (${marks(ids)}) AND ${POSTED} AND v.vdate < %s`,
    [...ids, dateFrom])).b;
  const openingSum = ids.length > 1
    ? Number((await one(`SELECT COALESCE(SUM(opening_balance), 0) AS ob FROM acc_ledgers WHERE id IN (${marks(ids)})`, ids)).ob)
    : acc.opening_balance;
  const opening = money(openingSum + before);
  let rows = (await q(
    'SELECT v.id AS voucher_id, v.voucher_no, v.vtype, v.kind, v.source_doc_id, v.vdate, v.narration, v.reference, l.dr, l.cr, l.note,'
    + ` v.updated_at, v.created_at, ${SAVED_BY} AS saved_by_name,`
    + " (SELECT string_agg(a2.name, ', ') FROM acc_voucher_lines l2 JOIN acc_ledgers a2 ON a2.id = l2.account_id"
    + '   WHERE l2.voucher_id = v.id AND l2.account_id <> l.account_id'
    + '   AND ((l.dr > 0 AND l2.cr > 0) OR (l.cr > 0 AND l2.dr > 0))) AS particulars'
    + ' FROM acc_voucher_lines l JOIN acc_vouchers v ON v.id = l.voucher_id'
    + ` WHERE l.account_id IN (${marks(ids)}) AND ${POSTED} AND v.vdate BETWEEN %s AND %s ORDER BY v.vdate, v.id, l.sort`,
    [...ids, dateFrom, dateTo])).rows;
  // product lines of purchase / sales / return bills shown under the ledger row
  const isBill = (r) => ['PB', 'PR', 'SI', 'SR'].includes(r.vtype);   // receipts/payments of a bill don't repeat its items
  const docIds = [...new Set(rows.filter((r) => r.source_doc_id && isBill(r)).map((r) => r.source_doc_id))].sort((a, b) => a - b);
  const items = {};
  let bills = {};
  if (docIds.length) {
    for (const li of (await q(
      'SELECT l.doc_id, i.name AS item, u.name AS unit, l.qty, COALESCE(l.rate_excl, l.rate) AS rate, l.discount, l.amount, l.vat,'
      + " (SELECT string_agg(s.serial_no, ', ') FROM acc_line_serials ls JOIN acc_serials s ON s.id = ls.serial_id WHERE ls.line_id = l.id) AS serials"
      + ` FROM acc_doc_lines l JOIN acc_items i ON i.id = l.item_id JOIN acc_units u ON u.id = i.unit_id WHERE l.doc_id IN (${marks(docIds)}) ORDER BY l.doc_id, l.sort`, docIds)).rows) {
      (items[li.doc_id] ||= []).push(li);
    }
    bills = Object.fromEntries((await q(
      `SELECT id, doc_no, doc_type, gross, discount, taxable, exempt, vat, total, challan_no, vat_bill_no, supplier_bill_no FROM acc_docs WHERE id IN (${marks(docIds)})`, docIds)).rows.map((d) => [d.id, d]));
  }
  let bal = opening;
  for (const r of rows) {
    bal = money(bal + r.dr - r.cr);
    r.balance = bal;
    r.vdate_bs = bsStr(r.vdate);
    r.items = isBill(r) ? (items[r.source_doc_id] || []) : [];
    r.bill = isBill(r) ? (bills[r.source_doc_id] || null) : null;
    r.day_type = dayType(r.vtype, r.kind);
  }
  // post-dated cheques of this party: shown as memo lines (no amount in Dr/Cr, balance unchanged)
  const memo = (await q(
    'SELECT c.*, d.doc_no, d.doc_date, d.doc_type FROM acc_cheques c LEFT JOIN acc_docs d ON d.id = c.doc_id'
    + ` WHERE c.party_id IN (${marks(ids)}) AND c.status IN ('pending','bounced') AND COALESCE(d.doc_date, c.cheque_date) BETWEEN %s AND %s`,
    [...ids, dateFrom, dateTo])).rows;
  if (memo.length) {
    const byDoc = {};
    for (const c of memo) (byDoc[c.doc_id] ||= []).push(c);
    const out = [];
    for (const r of rows) {   // a bill's own cheque goes right under the bill
      out.push(r);
      if (isBill(r) && byDoc[r.source_doc_id]) { for (const c of byDoc[r.source_doc_id]) out.push(chequeMemo(c, r.balance)); delete byDoc[r.source_doc_id]; }
    }
    const rest = Object.values(byDoc).flat().sort((a, b) => String(a.doc_date || a.cheque_date).localeCompare(String(b.doc_date || b.cheque_date)));
    for (const c of rest) {
      const on = c.doc_date || c.cheque_date;
      const at = out.filter((r) => r.vdate <= on).length;
      out.splice(at, 0, chequeMemo(c, at ? out[at - 1].balance : opening));
    }
    rows = out;
  }
  return {
    account: ids.length > 1 ? { ...acc, group_name: 'Customer & Supplier — combined', combined: true, linked_ids: ids } : acc, opening, rows,
    total_dr: money(rows.reduce((a, r) => a + r.dr, 0)), total_cr: money(rows.reduce((a, r) => a + r.cr, 0)), closing: bal,
  };
}

router.get('/reports/ledger', ah(async (req, res) => {
  const { account_id, date_from, date_to } = req.query;
  if (!account_id || !date_from || !date_to) bad('Choose a ledger and a date range.');
  res.json(await ledgerData(+account_id, date_from, date_to, truthy(req.query.combined, true)));
}));

async function ledgerPdf(accountId, dateFrom, dateTo, user, detail = true, combined = true) {
  const data = await ledgerData(accountId, dateFrom, dateTo, combined);
  if (!detail) for (const r of data.rows) { r.items = []; r.bill = null; }   // "Summarized": one line per voucher
  const company = await one('SELECT * FROM acc_company WHERE id = 1');
  const pdf = await (await import('../../services/accounts/pdf.js')).ledgerPdf(company, data, dateFrom, dateTo, user);
  const name = `${`Ledger_${data.account.name}_${bsStr(dateFrom)}_to_${bsStr(dateTo)}`.replace(/[^\w-]+/g, '_')}.pdf`;
  return [pdf, data, name];
}

router.get('/reports/ledger/pdf', ah(async (req, res) => {
  const { account_id, date_from, date_to } = req.query;
  const [pdf, data, name] = await ledgerPdf(+account_id, date_from, date_to, userOf(req), truthy(req.query.detail, true), truthy(req.query.combined, true));
  await tx((t) => audit(t, userOf(req), 'pdf', 'ledger', +account_id, { account: data.account.name, from: date_from, to: date_to }));
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${name}"` }).send(pdf);
}));

router.post('/reports/ledger/email', ah(async (req, res) => {
  const b = req.body || {};
  const user = userOf(req);
  const [pdf, data, name] = await ledgerPdf(+b.account_id, b.date_from, b.date_to, user, b.detail !== false, b.combined !== false);
  const acc = data.account;
  const to = String(b.to || acc.email || '').trim();
  if (!to) bad(`${acc.name} has no email saved. Type an address to send to.`);
  const company = await one('SELECT * FROM acc_company WHERE id = 1');
  const bal = data.closing;
  const side = bal > 0 ? 'receivable from you' : bal < 0 ? 'payable to you' : 'nil';
  const html = `<p>Namaste ${acc.name},</p><p>Please find attached your ledger statement from <b>${company.name}</b> for ${bsStr(b.date_from)} to ${bsStr(b.date_to)} (BS).</p>`
    + `<p>Closing balance: <b>Rs ${nepMoney(bal)}</b> (${side}).</p><p>Thank you.</p>`;
  try {
    await notify.sendEmail(to, `Ledger statement — ${company.name}`, html, [{ filename: name, content: pdf, contentType: 'application/pdf' }]);
    await notify.log('email', null, +b.account_id, to, `Ledger statement ${name}`, 'sent', null, user);
  } catch (e) {
    await notify.log('email', null, +b.account_id, to, `Ledger statement ${name}`, 'failed', e.message, user);
    throw e;
  }
  await tx((t) => audit(t, user, 'send_email', 'ledger', +b.account_id, { to, from: b.date_from, to_date: b.date_to }));
  res.json({ ok: true, to });
}));

router.get('/reports/trial-balance', ah(async (req, res) => {
  const { date_from, date_to } = req.query;
  if (!date_from || !date_to) bad('Choose a date range.');
  const hideZero = truthy(req.query.hide_zero, true);
  const rows = (await q(
    'SELECT a.id, a.code, a.name, a.opening_balance, g.id AS group_id, g.code AS group_code, g.name AS group_name, g.nature,'
    + ` COALESCE(SUM(CASE WHEN ${POSTED} AND v.vdate < %s THEN l.dr - l.cr END), 0) AS bal_before,`
    + ` COALESCE(SUM(CASE WHEN ${POSTED} AND v.vdate BETWEEN %s AND %s THEN l.dr END), 0) AS dr,`
    + ` COALESCE(SUM(CASE WHEN ${POSTED} AND v.vdate BETWEEN %s AND %s THEN l.cr END), 0) AS cr`
    + ' FROM acc_ledgers a JOIN acc_groups g ON g.id = a.group_id'
    + ' LEFT JOIN acc_voucher_lines l ON l.account_id = a.id LEFT JOIN acc_vouchers v ON v.id = l.voucher_id'
    + ' GROUP BY a.id, g.id ORDER BY g.code, a.code',
    [date_from, date_from, date_to, date_from, date_to])).rows;
  const out = [];
  for (const r of rows) {
    const opening = money(r.opening_balance + r.bal_before);
    const closing = money(opening + r.dr - r.cr);
    if (hideZero && !(opening || r.dr || r.cr || closing)) continue;
    out.push({ id: r.id, code: r.code, name: r.name, group_code: r.group_code, group_name: r.group_name, nature: r.nature, opening, dr: money(r.dr), cr: money(r.cr), closing });
  }
  const tot = (f) => money(out.reduce((a, x) => a + f(x), 0));
  const totals = {
    opening_dr: tot((x) => Math.max(x.opening, 0)), opening_cr: tot((x) => Math.max(-x.opening, 0)),
    dr: tot((x) => x.dr), cr: tot((x) => x.cr),
    closing_dr: tot((x) => Math.max(x.closing, 0)), closing_cr: tot((x) => Math.max(-x.closing, 0)),
  };
  totals.difference = money(totals.closing_dr - totals.closing_cr);
  res.json({ rows: out, totals });
}));

export default router;
