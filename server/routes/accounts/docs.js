/* Purchase Order / Purchase / Purchase Return and Sales Quotation / Order / Invoice / Return.
 * Port of routers/docs.py — same rules, same numbers.
 *
 * Posting (periodic inventory, as used by most Nepali businesses):
 *   Purchase        Dr Purchase + Input VAT        Cr Supplier
 *   Purchase Return Dr Supplier                    Cr Purchase Return + Input VAT
 *   Sales Invoice   Dr Customer                    Cr Sales + Output VAT
 *   Sales Return    Dr Sales Return + Output VAT   Cr Customer
 *   (walk-in customer with no ledger: Cash/Bank instead of Customer)
 * Payment on the bill:
 *   Cash / QR-bank  + auto Receipt (RV) / Payment (PV) voucher between the party and the cash/bank ledger
 *   Cheque          + row in the post-dated cheque register; posts only when deposited
 *   Credit          nothing more — stays outstanding on the party
 * Orders and quotations don't touch the books or stock.
 *
 * Edit   = undo the document's effects (stock, serials, voucher lines) and post it again under the
 *          same number — needs the user's own password; before/after goes to the audit trail.
 * Delete = needs an admin (password on the spot, or an approval request). Full snapshot is audited.
 *
 * Lines may be entered VAT-inclusive (e.g. MRP or a % off MRP): VAT is then worked back out of the
 * amount so the bill total equals what was typed.
 *
 * Every write runs in ONE transaction and uses `t` for ALL reads and writes inside it.
 */
import { Router } from 'express';
import { q, one, tx, advisoryLock, marks } from '../../services/accounts/accDb.js';
import { ah, bad, audit, money, round3, nz, dnz, num, int, flag, userOf, periodEnd, ensureFiscalYear, nepMoney } from '../../services/accounts/common.js';
import { bsStr, isIsoDate, addDays } from '../../services/accounts/nepaliDate.js';
import { currentQty } from '../../services/accounts/stock.js';
import { confirmPassword, adminApproval } from '../../services/accounts/authz.js';
import { syncDocTasks } from '../../services/accounts/docTasks.js';
import { saveImage, removeImage, serveImage } from '../../services/accounts/files.js';
import { systemAccount } from './accounts.js';
import { cleanSerials } from './items.js';
import { cleanTerms } from './quotes.js';
import * as notify from '../../services/accounts/notify.js';

const router = Router();
const dbRun = { query: q, one };

export const PAY_MODES = { credit: 'Credit', cash: 'Cash', cheque: 'Cheque', bank: 'QR Payment / Bank Transfer' };
export const DOCS = {
  QT: { name: 'Sales Quotation', side: 'sales', role: 'order' },
  PO: { name: 'Purchase Order', side: 'purchase', role: 'order' },
  PB: { name: 'Purchase', side: 'purchase', role: 'bill', from: 'PO' },
  PR: { name: 'Purchase Return', side: 'purchase', role: 'return', of: 'PB' },
  SO: { name: 'Sales Order', side: 'sales', role: 'order', from: 'QT' },
  SI: { name: 'Sales Invoice', side: 'sales', role: 'bill', from: 'SO' },
  SR: { name: 'Sales Return', side: 'sales', role: 'return', of: 'SI' },
};
const STOCK_KIND = { PB: ['purchase', 1], PR: ['purchase_return', -1], SI: ['sale', -1], SR: ['sales_return', 1] };
const MONEY_IN = ['SI', 'PR'];     // customer pays us / supplier refunds us; PB and SR are money going out
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

const isoOrBad = (s, label) => {
  if (!s) return null;
  const d = String(s).slice(0, 10);
  if (!isIsoDate(d)) bad(`Invalid ${label}.`);
  return d;
};
const nsig = (n) => String(Math.round(n * 1000) / 1000);   // 3 -> "3", 2.5 -> "2.5"
const withoutNull = (set) => [...set].filter((x) => x !== null && x !== undefined);

/* ────────────────────────────── reading ────────────────────────────── */
export async function getDoc(did, run = dbRun) {
  const d = await run.one(
    'SELECT d.*, f.name AS fy, r.doc_no AS ref_doc_no, r.doc_type AS ref_doc_type, ca.name AS cash_account,'
    + ' v.voucher_no, p.email AS party_email, COALESCE(p.whatsapp, p.phone) AS party_phone, p.phone AS party_mobile, p.whatsapp AS party_whatsapp, p.contact_person AS party_contact, p.credit_days AS party_credit_days,'
    + ' pv.voucher_no AS pay_voucher_no, pv.status AS pay_voucher_status'
    + ' FROM acc_docs d JOIN acc_fiscal_years f ON f.id = d.fy_id'
    + ' LEFT JOIN acc_docs r ON r.id = d.ref_doc_id LEFT JOIN acc_ledgers ca ON ca.id = d.cash_account_id'
    + ' LEFT JOIN acc_vouchers v ON v.id = d.voucher_id LEFT JOIN acc_ledgers p ON p.id = d.party_id'
    + ' LEFT JOIN acc_vouchers pv ON pv.id = d.pay_voucher_id WHERE d.id = %s', [did]);
  if (!d) bad('Document not found.', 404);
  d.doc_date_bs = bsStr(d.doc_date);
  d.type_name = DOCS[d.doc_type].name;
  if (d.doc_type === 'QT') {
    try { d.qt_terms_list = JSON.parse(d.qt_terms || '[]'); } catch { d.qt_terms_list = []; }
    const tp = d.qt_template_id ? await run.one('SELECT name FROM acc_quote_templates WHERE id = %s', [d.qt_template_id]) : null;
    d.qt_template_name = tp ? tp.name : null;
    const so = await run.one("SELECT doc_no FROM acc_docs WHERE ref_doc_id = %s AND doc_type = 'SO' AND status <> 'cancelled' ORDER BY id DESC LIMIT 1", [did]);
    d.converted_to = so ? so.doc_no : null;
    d.tasks = (await run.query(
      "SELECT r.*, COALESCE(NULLIF(u.full_name, ''), r.assigned_to) AS assigned_name FROM acc_reminders r"
      + " LEFT JOIN users u ON u.username = r.assigned_to WHERE r.doc_id = %s AND r.kind = 'followup' ORDER BY r.status DESC, r.remind_on", [did])).rows;
  }
  d.lines = (await run.query(
    'SELECT l.*, i.name AS item, i.code, i.hs_code, i.item_type, i.track_serial, i.mrp, u.name AS unit FROM acc_doc_lines l'
    + ' JOIN acc_items i ON i.id = l.item_id JOIN acc_units u ON u.id = i.unit_id WHERE l.doc_id = %s ORDER BY l.sort', [did])).rows;
  const ser = (await run.query(
    'SELECT ls.line_id, s.serial_no FROM acc_line_serials ls JOIN acc_serials s ON s.id = ls.serial_id'
    + ' JOIN acc_doc_lines l ON l.id = ls.line_id WHERE l.doc_id = %s ORDER BY s.serial_no', [did])).rows;
  const byLine = {};
  for (const s of ser) (byLine[s.line_id] ||= []).push(s.serial_no);
  for (const l of d.lines) {
    l.serials = byLine[l.id] || [];
    if (l.rate_excl === null || l.rate_excl === undefined) l.rate_excl = l.rate;
    l.warranty_until = d.doc_type === 'SI' && l.warranty_months ? periodEnd(d.doc_date, l.warranty_months) : null;
  }
  if (DOCS[d.doc_type].role === 'bill') {
    const ret = d.doc_type === 'PB' ? 'PR' : 'SR';
    const returned = (await run.query(
      "SELECT l.item_id, SUM(l.qty) AS q FROM acc_doc_lines l JOIN acc_docs r ON r.id = l.doc_id"
      + " WHERE r.ref_doc_id = %s AND r.doc_type = %s AND r.status = 'posted' GROUP BY l.item_id", [did, ret])).rows;
    const rq = Object.fromEntries(returned.map((r) => [r.item_id, r.q]));
    const retSerials = new Set((await run.query(
      "SELECT s.serial_no FROM acc_line_serials ls JOIN acc_serials s ON s.id = ls.serial_id JOIN acc_doc_lines l ON l.id = ls.line_id"
      + " JOIN acc_docs r ON r.id = l.doc_id WHERE r.ref_doc_id = %s AND r.doc_type = %s AND r.status = 'posted'", [did, ret])).rows.map((r) => r.serial_no));
    for (const l of d.lines) {
      l.returned = round3(rq[l.item_id] || 0);
      l.returnable_serials = l.serials.filter((s) => !retSerials.has(s));
    }
  }
  d.cheque = await run.one(
    'SELECT c.*, a.name AS bank_account, v.voucher_no FROM acc_cheques c LEFT JOIN acc_ledgers a ON a.id = c.bank_account_id'
    + ' LEFT JOIN acc_vouchers v ON v.id = c.voucher_id WHERE c.doc_id = %s ORDER BY c.id DESC LIMIT 1', [did]);
  d.notifications = (await run.query('SELECT * FROM acc_notifications WHERE doc_id = %s ORDER BY id DESC', [did])).rows;
  d.pending_delete = await run.one("SELECT id, requested_by FROM acc_approvals WHERE entity = 'doc' AND entity_id = %s AND status = 'pending'", [did]);
  const { displayName } = await import('../../services/accounts/authz.js');
  d.created_by_name = await displayName(d.created_by);
  d.updated_by_name = d.updated_by ? await displayName(d.updated_by) : null;
  return d;
}

router.get('/docs', ah(async (req, res) => {
  const { doc_type, date_from, date_to, status, party_id } = req.query;
  if (!DOCS[doc_type]) bad('Unknown document type.');
  const where = ['d.doc_type = %s'], params = [doc_type];
  if (date_from) { where.push('d.doc_date >= %s'); params.push(date_from); }
  if (date_to) { where.push('d.doc_date <= %s'); params.push(date_to); }
  if (status) { where.push('d.status = %s'); params.push(status); }
  if (party_id) { where.push('d.party_id = %s'); params.push(+party_id); }
  const rows = (await q(
    'SELECT d.*, r.doc_no AS ref_doc_no, (SELECT COUNT(*) FROM acc_doc_lines l WHERE l.doc_id = d.id) AS line_count,'
    + " COALESCE(NULLIF(u.full_name, ''), u.username, COALESCE(d.updated_by, d.created_by)) AS saved_by_name,"
    + " COALESCE(NULLIF(cu.full_name, ''), d.created_by) AS created_by_name,"
    + ' ca.name AS cash_account, pv.voucher_no AS pay_voucher_no, pv.status AS pay_voucher_status,'
    + ' (SELECT c.status FROM acc_cheques c WHERE c.doc_id = d.id ORDER BY c.id DESC LIMIT 1) AS cheque_status,'
    + " (SELECT COALESCE(array_agg(DISTINCT rr.assigned_to), '{}') FROM acc_reminders rr LEFT JOIN tasks tk ON tk.id = rr.task_id"
    + "   WHERE rr.doc_id = d.id AND rr.kind = 'followup' AND rr.status = 'open' AND rr.assigned_to IS NOT NULL AND COALESCE(tk.status, 'pending') NOT IN ('completed','cancelled')) AS task_users,"
    + ' pa.phone AS party_mobile, pa.whatsapp AS party_whatsapp, pa.contact_person AS party_contact, pa.transport_name AS party_transport_name, pa.transport_phone AS party_transport_phone, pa.transport_address AS party_transport_address'
    + ' FROM acc_docs d LEFT JOIN acc_docs r ON r.id = d.ref_doc_id LEFT JOIN acc_ledgers pa ON pa.id = d.party_id'
    + ' LEFT JOIN acc_ledgers ca ON ca.id = d.cash_account_id LEFT JOIN acc_vouchers pv ON pv.id = d.pay_voucher_id'
    + ' LEFT JOIN users u ON u.username = COALESCE(d.updated_by, d.created_by)'
    + ' LEFT JOIN users cu ON cu.username = d.created_by'
    + ` WHERE ${where.join(' AND ')} ORDER BY d.doc_date DESC, d.id DESC`, params)).rows;
  const noMail = (s) => (s ? String(s).split('@')[0] : s);     // a name, never an e-mail address
  for (const r of rows) { r.doc_date_bs = bsStr(r.doc_date); r.saved_by_name = noMail(r.saved_by_name); r.created_by_name = noMail(r.created_by_name); }
  res.json(rows);
}));

router.get('/docs/:did', ah(async (req, res) => res.json(await getDoc(+req.params.did))));

export function pdfName(d) {
  let base = d.doc_no.replace(/\//g, '-');
  if (d.doc_type === 'QT') base += `_${String(d.party_name || '').replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)}`;
  return `${base}.pdf`;
}

export async function docPdfBytes(d, user) {
  const company = await one('SELECT * FROM acc_company WHERE id = 1');
  if (d.doc_type === 'QT') return (await import('./quotes.js')).buildQuotationPdf(d, company);
  let banks = [];
  if (['SO', 'SI'].includes(d.doc_type)) {
    const { bankAccountsFor } = await import('./accounts.js');
    const { getFile } = await import('../../services/accounts/files.js');
    banks = (await bankAccountsFor(d.cash_account_id)).slice(0, 3);
    for (const b of banks) {
      const f = b.qr_image ? await getFile('bank-qr', b.qr_image).catch(() => null) : null;
      b.qr_data = f && /png|jpe?g/i.test(f.mime || '') ? f.data : null;     // pdfkit draws PNG / JPG only
    }
  }
  // names, not e-mail addresses, on paper
  const { displayName } = await import('../../services/accounts/authz.js');
  d = { ...d, created_by: d.created_by_name || await displayName(d.created_by) };
  return (await import('../../services/accounts/pdf.js')).docPdf(company, d, await displayName(user), banks);
}

router.get('/docs/:did/pdf', ah(async (req, res) => {
  const d = await getDoc(+req.params.did);
  const buf = await docPdfBytes(d, userOf(req));
  const how = req.query.inline === 'true' || req.query.inline === '1' ? 'inline' : 'attachment';
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `${how}; filename="${pdfName(d)}"` }).send(buf);
}));

router.get('/docs/:did/client-logo', ah(async (req, res) => {
  const d = await one('SELECT qt_client_logo FROM acc_docs WHERE id = %s', [+req.params.did]);
  await serveImage(res, 'quotes', d?.qt_client_logo);
}));
router.get('/docs/:did/proof', ah(async (req, res) => {
  const d = await one('SELECT pay_proof FROM acc_docs WHERE id = %s', [+req.params.did]);
  await serveImage(res, 'proofs', d?.pay_proof);
}));
router.get('/docs/:did/transport-file', ah(async (req, res) => {
  const d = await one('SELECT transport_file FROM acc_docs WHERE id = %s', [+req.params.did]);
  await serveImage(res, 'transport', d?.transport_file);
}));

/** 'Via Transport': transporter name, its bill (bilty) no. and a scan of it. Doesn't touch the books. */
router.post('/docs/:did/transport', ah(async (req, res) => {
  const did = +req.params.did, b = req.body || {};
  const d = await one('SELECT id, doc_no, transport_file FROM acc_docs WHERE id = %s', [did]) || bad('Document not found.', 404);
  const name = nz(b.transport_name), bill = nz(b.transport_bill_no);
  let file = d.transport_file;
  if (b.remove_file) file = null;
  if (b.file_data) file = await saveImage('transport', `doc${did}`, b.file_data, 5, true);
  if (!(name || bill || file)) file = null;
  const user = userOf(req);
  await tx(async (t) => {
    await t.query('UPDATE acc_docs SET transport_name=%s, transport_bill_no=%s, transport_file=%s, transport_by=%s, transport_at=NOW() WHERE id=%s', [name, bill, file, user, did]);
    await audit(t, user, 'transport', 'doc', did, { doc_no: d.doc_no, transport: name, bill_no: bill, file: !!file });
  });
  if (d.transport_file && d.transport_file !== file) await removeImage('transport', d.transport_file);
  res.json(await getDoc(did));
}));

/* ────────────────────────────── serials ────────────────────────────── */
async function checkSerials(t, docType, item, serials, ref) {
  const rows = [];
  for (const s of serials) {
    const r = await t.one('SELECT * FROM acc_serials WHERE item_id = %s AND UPPER(serial_no) = %s', [item.id, s.toUpperCase()]);
    if (docType === 'PB') {
      if (r && !['returned', 'cancelled'].includes(r.status)) bad(`${item.name}: serial ${s} is already ${r.status === 'in_stock' ? 'in stock' : r.status}.`);
    } else if (docType === 'SI') {
      if (!r || r.status !== 'in_stock') bad(`${item.name}: serial ${s} is not in stock.`);
    } else if (docType === 'SR') {
      if (!r || r.status !== 'sold' || r.out_doc_id !== ref.id) bad(`${item.name}: serial ${s} wasn't sold on ${ref.doc_no} (or is already returned).`);
    } else if (docType === 'PR') {
      if (!r || r.status !== 'in_stock') bad(`${item.name}: serial ${s} is not in stock, so it can't be returned.`);
      if (ref && r.in_doc_id !== ref.id) bad(`${item.name}: serial ${s} didn't come in on ${ref.doc_no}.`);
    }
    rows.push(r);
  }
  return rows;
}

/** Put serial numbers back to where they were before this document. */
async function reverseSerials(t, d) {
  const did = d.id, dt = d.doc_type;
  const rows = (await t.query(
    'SELECT s.* FROM acc_line_serials ls JOIN acc_serials s ON s.id = ls.serial_id JOIN acc_doc_lines l ON l.id = ls.line_id WHERE l.doc_id = %s', [did])).rows;
  for (const s of rows) {
    if (dt === 'PB') {
      if (s.status !== 'in_stock' || s.in_doc_id !== did) bad(`Serial ${s.serial_no} has already been sold or returned, so this purchase can't be changed.`);
      await t.query("UPDATE acc_serials SET status = 'cancelled' WHERE id = %s", [s.id]);
    } else if (dt === 'SI') {
      if (s.status !== 'sold' || s.out_doc_id !== did) bad(`Serial ${s.serial_no} has moved on since, so this invoice can't be changed.`);
      await t.query("UPDATE acc_serials SET status='in_stock', out_doc_id=NULL, warranty_until=NULL WHERE id=%s", [s.id]);
    } else if (dt === 'SR') {
      if (s.status !== 'in_stock') bad(`Serial ${s.serial_no} has been sold again, so this return can't be changed.`);
      await t.query("UPDATE acc_serials SET status='sold', out_doc_id=%s WHERE id=%s", [d.ref_doc_id, s.id]);
    } else if (dt === 'PR') {
      if (s.status !== 'returned' || s.out_doc_id !== did) bad(`Serial ${s.serial_no} has changed since, so this return can't be changed.`);
      await t.query("UPDATE acc_serials SET status='in_stock', out_doc_id=NULL WHERE id=%s", [s.id]);
    }
  }
}

async function guardChangeable(d, what, run = dbRun) {
  if (DOCS[d.doc_type].role === 'bill' && await run.one("SELECT 1 AS x FROM acc_docs WHERE ref_doc_id = %s AND doc_type IN ('PR','SR') LIMIT 1", [d.id])) {
    bad(`Returns were made against ${d.doc_no}. ${what[0].toUpperCase() + what.slice(1)} or cancel those returns first.`);
  }
  if (d.status === 'billed') {
    if (d.doc_type === 'QT') bad(`Quotation ${d.doc_no} is already converted to a Sales Order. Change the order instead.`);
    bad(`Order ${d.doc_no} is already billed. Change the bill instead.`);
  }
  if ((await run.one('SELECT is_closed FROM acc_fiscal_years WHERE id = %s', [d.fy_id])).is_closed) bad('Fiscal year is closed.');
}

/** A deposited cheque already moved money: undo the deposit first. */
async function guardCheque(d, what, run = dbRun) {
  const c = await run.one(
    "SELECT c.*, v.voucher_no FROM acc_cheques c LEFT JOIN acc_vouchers v ON v.id = c.voucher_id WHERE c.doc_id = %s AND c.status = 'cleared'", [d.id]);
  if (c) bad(`Cheque ${c.cheque_no} of ${d.doc_no} is already deposited (${c.voucher_no}). Undo the deposit in Post-dated Cheques before you ${what} this bill.`);
}

const snapshot = (d) => ({
  doc_no: d.doc_no, date: d.doc_date, party: d.party_name, total: d.total, vat: d.vat, status: d.status,
  lines: d.lines.map((l) => `${l.item} × ${nsig(l.qty)} @ ${nsig(l.rate)}${l.vat_inclusive ? ' incl' : ''}${l.serials.length ? ` S/N ${l.serials.join(',')}` : ''}`),
});

/* ────────────────────────────── posting ────────────────────────────── */
async function nextSeq(t, table, where, params, lockKey) {
  await advisoryLock(t, lockKey);
  return (await t.one(`SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM ${table} WHERE ${where}`, params)).n;
}

/** Validate and post a document (new, or re-post of an edited one). Runs inside a transaction. */
async function post(t, b, user, existing = null) {
  const meta = DOCS[b.doc_type] || bad('Unknown document type.');
  const ddate = isoOrBad(b.doc_date, 'date') || bad('Date is required.');
  const co = await t.one('SELECT * FROM acc_company WHERE id = 1');
  const isOrder = meta.role === 'order';
  b.payment_mode = b.payment_mode || 'credit';
  if (b.doc_type === 'QT') {    // a quotation has no payment terms of its own — they are agreed on the order / bill
    Object.assign(b, { payment_mode: 'credit', cash_account_id: null, followup_user: null, paid_amount: null });
    if (!nz(b.qt_subject)) bad('Enter the quotation subject, e.g. Attendance Device with Software.');
  }

  let party = null;
  if (b.party_id) {
    party = await t.one('SELECT * FROM acc_ledgers WHERE id = %s AND active = 1', [b.party_id]);
    const want = meta.side === 'purchase' ? 'supplier' : 'customer';
    if (!party || party.party_type !== want) bad(`Choose a ${want}.`);
  }
  const mode = b.payment_mode;
  if (!PAY_MODES[mode]) bad('Payment mode must be Credit, Cash, Cheque or QR Payment / Bank Transfer.');
  if (isOrder && !party && b.doc_type !== 'QT') bad('Choose the party for this order.');   // a quotation can be for a Contact
  if (['credit', 'cheque'].includes(mode) && !party && b.doc_type !== 'QT') {   // a quotation may be for a Contact (no Accounts customer yet)
    bad(`${PAY_MODES[mode]} needs a ${meta.side === 'purchase' ? 'supplier' : 'customer'}. For walk-in customers choose Cash or QR Payment / Bank Transfer.`);
  }
  if (['cash', 'bank'].includes(mode)) {
    const ca = await t.one('SELECT * FROM acc_ledgers WHERE id = %s AND kind = %s AND active = 1', [b.cash_account_id || 0, mode === 'cash' ? 'cash' : 'bank']);
    if (!ca) bad(mode === 'cash' ? 'Choose the Cash ledger.' : 'Choose the bank account the money goes through.');
  } else b.cash_account_id = null;

  let chqDate = null;
  if (mode === 'cheque') {
    b.cheque_no = String(b.cheque_no || '').trim(); b.cheque_bank = String(b.cheque_bank || '').trim();
    chqDate = isoOrBad(b.cheque_date, 'cheque date');
    if (!b.cheque_no || !chqDate || !b.cheque_bank) bad('Enter the cheque number, cheque date and bank name.');
  } else { b.cheque_no = b.cheque_date = b.cheque_bank = null; }
  if (mode === 'bank') {
    b.txn_id = String(b.txn_id || '').trim();
    if (!b.txn_id && !isOrder) bad('Enter the transaction ID of the QR payment / bank transfer.');
  } else { b.txn_id = null; b.pay_proof = null; b.pay_proof_data = null; }

  let fuDate = null;
  if (mode === 'credit' && nz(b.followup_user)) {
    b.followup_user = String(b.followup_user).trim();
    const u = await t.query('SELECT 1 AS x FROM users WHERE username = %s AND COALESCE(active, TRUE) = TRUE', [b.followup_user]);
    if (!u.rows.length) bad('Choose an active user for the follow-up task.');
    fuDate = isoOrBad(b.followup_date, 'follow-up date') || bad('Choose the follow-up date.');
  } else { b.followup_user = null; b.followup_note = null; }
  if (meta.side === 'purchase' && !party) bad('Choose the supplier.');
  const pname = (party ? party.name : String(b.party_name || '').trim()) || 'Cash';
  const ppan = party ? party.pan : nz(b.party_pan);
  const paddr = party ? party.address : nz(b.party_address);

  let due = null;
  if (['SI', 'PB', 'SO', 'PO'].includes(b.doc_type)) {
    due = isoOrBad(b.due_date, 'due date');
    if (due && due < ddate) bad("Due date can't be before the bill date.");
    if (mode === 'cheque') due = chqDate;
    else if (mode !== 'credit') due = null;
    if (!due) due = addDays(ddate, (party && mode === 'credit' ? party.credit_days : 0) || 0);
  }

  let ref = null;
  if (b.ref_doc_id) {
    ref = await getDoc(b.ref_doc_id, t);
    const expect = meta.of || meta.from;
    if (!expect || ref.doc_type !== expect) bad("That reference document doesn't fit here.");
    const sameRef = existing && existing.ref_doc_id === ref.id;
    if (meta.from && ref.status !== 'open' && !sameRef) {
      const word = ref.doc_type === 'QT' && ref.status === 'billed' ? 'converted' : ref.status;
      bad(`${ref.doc_no} is already ${word}.`);
    }
    if (meta.role === 'return' && ref.status !== 'posted') bad(`${ref.doc_no} is cancelled.`);
    if (ref.party_id && ref.party_id !== (party ? party.id : null)) bad('Party must be the same as on the referenced document.');
    if (ref.doc_date > b.doc_date) bad("Date can't be before the referenced document.");
  }
  if (b.doc_type === 'SR' && !ref) bad('A sales return (credit note) must refer to the original invoice (IRD rule).');
  if (meta.side === 'purchase' && meta.role === 'bill' && !nz(b.supplier_bill_no)) bad("Enter the supplier's bill number (needed for the purchase register).");

  const vatBill = b.vat_bill === undefined ? true : !!flag(b.vat_bill);
  const vatOn = !!co.vat_registered && (meta.side === 'purchase' ? vatBill : true);
  const vatRate = vatOn ? Number(co.vat_rate) : 0;

  const lines = [], itemQty = {}, seenSerials = new Set();
  for (const ln of b.lines || []) {
    const qty = num(ln.qty), rate = num(ln.rate), discPct = num(ln.discount_pct);
    if (!ln.item_id || qty === 0) continue;
    const it = await t.one('SELECT * FROM acc_items WHERE id = %s', [ln.item_id]);
    if (!it || (!it.active && !existing)) bad('A product is missing or inactive.');
    if (qty < 0 || rate < 0 || !(discPct >= 0 && discPct <= 100)) bad(`${it.name}: check quantity, rate and discount.`);
    const isService = it.item_type === 'service';
    let sfrom = null, sto = null;
    if (isService) {
      sfrom = isoOrBad(ln.service_from, 'service start') || ddate;
      sto = isoOrBad(ln.service_to, 'service expiry') || (it.service_months ? periodEnd(sfrom, it.service_months) : null);
      if (sto && sto < sfrom) bad(`${it.name}: service expiry is before its start.`);
    }
    let serials = [];
    if (it.track_serial && !isOrder) {
      serials = cleanSerials(ln.serials);
      if (qty !== Math.trunc(qty)) bad(`${it.name}: serial-tracked products need a whole-number quantity.`);
      if (serials.length !== Math.trunc(qty)) bad(`${it.name}: quantity is ${nsig(qty)}, so enter ${Math.trunc(qty)} serial numbers (${serials.length} given).`);
      for (const s of serials) {
        const key = `${it.id}|${s.toUpperCase()}`;
        if (seenSerials.has(key)) bad(`${it.name}: serial ${s} is entered twice.`);
        seenSerials.add(key);
      }
    }
    // amounts: rate as typed (VAT-inclusive or not), discount as amount or %
    const grossE = money(qty * rate);
    const discE = ln.discount !== undefined && ln.discount !== null && ln.discount !== '' ? money(ln.discount) : money(grossE * discPct / 100);
    if (discE < 0 || discE > grossE + 0.005) bad(`${it.name}: discount can't be more than the amount.`);
    const netE = money(grossE - discE);
    const vatOk = !!it.vat_applicable && vatOn;
    const incl = !!flag(ln.vat_inclusive) && vatOk;
    let amount, vat, discX;
    if (incl) {
      amount = money(netE / (1 + vatRate / 100)); vat = money(netE - amount); discX = money(discE / (1 + vatRate / 100));
    } else { amount = netE; vat = vatOk ? money(netE * vatRate / 100) : 0; discX = discE; }
    const grossX = money(amount + discX);
    lines.push({
      item: it, qty: round3(qty), rate: money(rate), rate_excl: qty ? Math.round(grossX / qty * 10000) / 10000 : 0,
      vat_inclusive: incl ? 1 : 0, discount_pct: grossE ? Math.round(discE / grossE * 100 * 10000) / 10000 : 0,
      discount: discX, gross: grossX, amount, vat_applicable: vatOk ? 1 : 0, vat, note: nz(ln.note), serials,
      service_from: sfrom, service_to: sto,
      warranty_months: isService ? 0 : (ln.warranty_months !== undefined && ln.warranty_months !== null && ln.warranty_months !== '' ? int(ln.warranty_months) : it.warranty_months),
      is_service: isService,
    });
    itemQty[it.id] = (itemQty[it.id] || 0) + round3(qty);
  }
  if (!lines.length) bad('Add at least one product.');

  if (meta.role === 'return' && ref) {
    const avail = Object.fromEntries(ref.lines.map((l) => [l.item_id, l.qty - (l.returned || 0)]));
    for (const [iid, qn] of Object.entries(itemQty)) {
      if (!(iid in avail)) bad("A returned product isn't on the original bill.");
      if (qn > avail[iid] + 0.0005) bad(`${lines.find((l) => String(l.item.id) === iid).item.name}: only ${nsig(avail[iid])} left to return on ${ref.doc_no}.`);
    }
  }

  const sum = (f, pred = () => true) => money(lines.filter(pred).reduce((a, l) => a + f(l), 0));
  const taxable = sum((l) => l.amount, (l) => l.vat_applicable);
  const exempt = sum((l) => l.amount, (l) => !l.vat_applicable);
  const vat = sum((l) => l.vat);
  const total = money(taxable + exempt + vat);
  const gross = sum((l) => l.gross);
  const discount = sum((l) => l.discount);

  // amount received / paid now; the rest stays outstanding on the party
  let paid = null;
  if (['cash', 'bank', 'cheque'].includes(mode)) {
    const hasPaid = b.paid_amount !== undefined && b.paid_amount !== null && b.paid_amount !== '';
    paid = hasPaid ? money(b.paid_amount) : total;
    const word = MONEY_IN.includes(b.doc_type) ? 'received' : 'paid';
    if (paid <= 0) bad(`Enter the amount ${word}.`);
    if (paid > total + 0.005) bad(`Amount ${word} (${nepMoney(paid)}) is more than the bill total (${nepMoney(total)}).`);
    if (!party && Math.abs(paid - total) > 0.005) bad('A walk-in customer must pay the full bill. Choose a customer to leave a balance due.');
  }
  b.paid_amount = paid;

  const fy = await ensureFiscalYear(ddate, t);
  if (fy.is_closed) bad(`Fiscal year ${fy.name} is closed.`);
  if (existing && fy.id !== existing.fy_id) bad('An edited document must stay in its own fiscal year.');

  if (['SI', 'PR'].includes(b.doc_type)) {
    for (const [iid, qn] of Object.entries(itemQty)) {
      const l0 = lines.find((l) => String(l.item.id) === iid);
      if (l0.is_service) continue;
      const have = await currentQty(t, +iid);
      if (qn > have + 0.0005) bad(`Not enough stock of ${l0.item.name}: ${nsig(have)} available, ${nsig(qn)} needed.`);
    }
  }
  const serialRows = [];
  for (const l of lines) serialRows.push(l.serials.length ? await checkSerials(t, b.doc_type, l.item, l.serials, ref) : []);

  const header = [party ? party.id : null, pname, ppan, paddr, mode, b.cash_account_id || null, b.ref_doc_id || null,
    nz(b.supplier_bill_no), dnz(b.supplier_bill_date), vatOn ? 1 : 0, nz(b.price_level),
    gross, discount, taxable, exempt, vat, total, nz(b.narration), due,
    mode === 'cheque' ? nz(b.cheque_details) : null, b.doc_date,
    b.cheque_no, chqDate, b.cheque_bank, b.txn_id,
    b.followup_user, fuDate, nz(b.followup_note)];
  let did, seq, docNo;
  if (existing) {
    ({ id: did, seq, doc_no: docNo } = existing);
    await t.query(
      'UPDATE acc_docs SET party_id=%s, party_name=%s, party_pan=%s, party_address=%s, payment_mode=%s, cash_account_id=%s,'
      + ' ref_doc_id=%s, supplier_bill_no=%s, supplier_bill_date=%s, vat_bill=%s, price_level=%s, gross=%s, discount=%s,'
      + ' taxable=%s, exempt=%s, vat=%s, total=%s, narration=%s, due_date=%s, cheque_details=%s, doc_date=%s,'
      + ' cheque_no=%s, cheque_date=%s, cheque_bank=%s, txn_id=%s, followup_user=%s, followup_date=%s, followup_note=%s,'
      + ' updated_by=%s, updated_at=NOW(), edit_count = edit_count + 1 WHERE id = %s',
      [...header, user, did]);
  } else {
    seq = await nextSeq(t, 'acc_docs', 'fy_id = %s AND doc_type = %s', [fy.id, b.doc_type], `doc:${fy.id}:${b.doc_type}`);
    docNo = `${b.doc_type}/${fy.name.replace('/', '-')}/${String(seq).padStart(4, '0')}`;
    did = (await t.one(
      'INSERT INTO acc_docs (party_id, party_name, party_pan, party_address, payment_mode, cash_account_id, ref_doc_id,'
      + ' supplier_bill_no, supplier_bill_date, vat_bill, price_level, gross, discount, taxable, exempt, vat, total, narration,'
      + ' due_date, cheque_details, doc_date, cheque_no, cheque_date, cheque_bank, txn_id, followup_user, followup_date,'
      + ` followup_note, fy_id, doc_type, seq, doc_no, status, created_by) VALUES (${Array(34).fill('%s').join(', ')}) RETURNING id`,
      [...header, fy.id, b.doc_type, seq, docNo, isOrder ? 'open' : 'posted', user])).id;
  }
  await t.query('UPDATE acc_docs SET challan_no = %s, vat_bill_no = %s, paid_amount = %s WHERE id = %s', [nz(b.challan_no), nz(b.vat_bill_no), b.paid_amount, did]);
  if (b.doc_type === 'QT') await saveQuoteFields(t, did, b, existing, party);
  // an order / invoice made from a quotation that was written for a Contact: the quotation now belongs to the customer too
  if (ref && ref.doc_type === 'QT' && !ref.party_id && party) await t.query('UPDATE acc_docs SET party_id = %s WHERE id = %s', [party.id, ref.id]);
  await saveProof(t, did, b, existing);
  await setReminders(t, did, docNo, meta, b, pname, total, chqDate, fuDate, user);

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const line = await t.one(
      'INSERT INTO acc_doc_lines (doc_id, item_id, qty, rate, rate_excl, vat_inclusive, discount_pct, discount, amount,'
      + ' vat_applicable, vat, note, sort, service_from, service_to, warranty_months)'
      + ` VALUES (${Array(16).fill('%s').join(', ')}) RETURNING id`,
      [did, l.item.id, l.qty, l.rate, l.rate_excl, l.vat_inclusive, l.discount_pct, l.discount, l.amount, l.vat_applicable, l.vat, l.note, i, l.service_from, l.service_to, l.warranty_months]);
    for (let k = 0; k < l.serials.length; k++) {
      const s = l.serials[k], r = serialRows[i][k];
      let sid;
      if (b.doc_type === 'PB') {
        if (r) { await t.query("UPDATE acc_serials SET status='in_stock', in_doc_id=%s, out_doc_id=NULL, warranty_until=NULL WHERE id=%s", [did, r.id]); sid = r.id; }
        else sid = (await t.one("INSERT INTO acc_serials (item_id, serial_no, status, in_doc_id) VALUES (%s, %s, 'in_stock', %s) RETURNING id", [l.item.id, s, did])).id;
      } else if (b.doc_type === 'SI') {
        const w = l.warranty_months ? periodEnd(ddate, l.warranty_months) : null;
        await t.query("UPDATE acc_serials SET status='sold', out_doc_id=%s, warranty_until=%s WHERE id=%s", [did, w, r.id]); sid = r.id;
      } else if (b.doc_type === 'SR') {
        await t.query("UPDATE acc_serials SET status='in_stock', out_doc_id=NULL WHERE id=%s", [r.id]); sid = r.id;
      } else {   // PR
        await t.query("UPDATE acc_serials SET status='returned', out_doc_id=%s WHERE id=%s", [did, r.id]); sid = r.id;
      }
      await t.query('INSERT INTO acc_line_serials (line_id, serial_id) VALUES (%s, %s)', [line.id, sid]);
    }
  }

  if (!isOrder) {
    const [kind, sign] = STOCK_KIND[b.doc_type];
    for (const l of lines) {
      if (l.is_service) continue;
      const netRate = l.qty ? l.amount / l.qty : 0;
      await t.query(
        'INSERT INTO acc_stock_moves (item_id, doc_id, move_date, kind, qty_in, qty_out, rate, fixed_rate) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)',
        [l.item.id, did, b.doc_date, kind, sign > 0 ? l.qty : 0, sign < 0 ? l.qty : 0, Math.round(netRate * 10000) / 10000, ['PB', 'PR'].includes(b.doc_type) ? 1 : 0]);
      if (b.doc_type === 'PB') await t.query('UPDATE acc_items SET purchase_price = %s WHERE id = %s', [money(netRate), l.item.id]);
    }

    // the bill always goes to the party's ledger; the payment is a separate auto voucher (cash / QR-bank)
    // or a post-dated cheque that posts only when deposited. Walk-in customers (no party) go straight to cash/bank.
    const moneySide = party ? party.id : b.cash_account_id;
    const net = money(taxable + exempt);
    const vatKey = meta.side === 'purchase' ? 'input_vat' : 'output_vat';
    const mainKey = { PB: 'purchase', PR: 'purchase_return', SI: 'sales', SR: 'sales_return' }[b.doc_type];
    let vlines;
    if (['PB', 'SR'].includes(b.doc_type)) vlines = [[await systemAccount(t, mainKey), net, 0], [await systemAccount(t, vatKey), vat, 0], [moneySide, 0, total]];
    else vlines = [[moneySide, total, 0], [await systemAccount(t, mainKey), 0, net], [await systemAccount(t, vatKey), 0, vat]];
    vlines = vlines.filter((x) => x[1] || x[2]);
    const narr = b.narration || `${meta.name} ${docNo} — ${pname}${b.supplier_bill_no ? ` (bill ${b.supplier_bill_no})` : ''}`;
    let vid = existing ? existing.voucher_id : null;
    if (vid) {
      await t.query('UPDATE acc_vouchers SET vdate=%s, narration=%s, reference=%s, amount=%s, updated_by=%s, updated_at=NOW(), edit_count = edit_count + 1 WHERE id=%s',
        [b.doc_date, narr, nz(b.supplier_bill_no), total, user, vid]);
    } else {
      vid = (await t.one(
        'INSERT INTO acc_vouchers (fy_id, vtype, seq, voucher_no, vdate, narration, reference, amount, created_by, source_doc_id) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id',
        [fy.id, b.doc_type, seq, docNo, b.doc_date, narr, nz(b.supplier_bill_no), total, user, did])).id;
      await t.query('UPDATE acc_docs SET voucher_id = %s WHERE id = %s', [vid, did]);
    }
    for (let i = 0; i < vlines.length; i++) {
      await t.query('INSERT INTO acc_voucher_lines (voucher_id, account_id, dr, cr, sort) VALUES (%s,%s,%s,%s,%s)', [vid, vlines[i][0], vlines[i][1], vlines[i][2], i]);
    }
    await postPayment(t, did, docNo, b, party, pname, b.paid_amount || total, fy, user, existing);
    await syncCheque(t, did, b, party, b.paid_amount || total, chqDate, user);
  }

  if (ref && meta.from) {     // order billed / quotation converted to an order
    await t.query("UPDATE acc_docs SET status = 'billed' WHERE id = %s", [ref.id]);
    await t.query("DELETE FROM acc_reminders WHERE doc_id = %s AND status = 'open'", [ref.id]);   // the bill carries them now
  }
  return did;
}

/** Cash / QR-bank bill with a party: auto Receipt (RV) or Payment (PV) voucher between the party and cash/bank. */
async function postPayment(t, did, docNo, b, party, pname, total, fy, user, existing) {
  const old = existing ? existing.pay_voucher_id : null;
  const want = !!party && ['cash', 'bank'].includes(b.payment_mode);
  if (!want) {
    if (old) {   // payment mode changed away from cash / bank: void the old receipt/payment
      await t.query("UPDATE acc_vouchers SET status='cancelled', cancel_reason=%s, cancelled_by=%s, cancelled_at=NOW() WHERE id = %s AND status <> 'cancelled'",
        [`${docNo} changed to ${PAY_MODES[b.payment_mode]}`, user, old]);
      await t.query('UPDATE acc_docs SET pay_voucher_id = NULL WHERE id = %s', [did]);
    }
    return;
  }
  const vtype = MONEY_IN.includes(b.doc_type) ? 'RV' : 'PV';
  const how = b.payment_mode === 'bank' ? 'QR / bank transfer' : 'Cash';
  const word = vtype === 'RV' ? 'received from' : 'paid to';
  const narr = `${how} ${word} ${pname} against ${docNo}${b.txn_id ? ` (Trans. ID ${b.txn_id})` : ''}`;
  const lines = vtype === 'RV' ? [[b.cash_account_id, total, 0], [party.id, 0, total]] : [[party.id, total, 0], [b.cash_account_id, 0, total]];
  const oldV = old ? await t.one('SELECT * FROM acc_vouchers WHERE id = %s', [old]) : null;
  let pid;
  if (oldV && oldV.status !== 'cancelled' && oldV.vtype === vtype) {
    pid = old;
    await t.query('UPDATE acc_vouchers SET vdate=%s, narration=%s, reference=%s, amount=%s, updated_by=%s, updated_at=NOW(), edit_count = edit_count + 1 WHERE id=%s',
      [b.doc_date, narr, b.txn_id, total, user, pid]);
    await t.query('DELETE FROM acc_voucher_lines WHERE voucher_id = %s', [pid]);
  } else {
    const seq = await nextSeq(t, 'acc_vouchers', 'fy_id = %s AND vtype = %s', [fy.id, vtype], `v:${fy.id}:${vtype}`);
    const vno = `${vtype}/${fy.name.replace('/', '-')}/${String(seq).padStart(4, '0')}`;
    pid = (await t.one(
      'INSERT INTO acc_vouchers (fy_id, vtype, seq, voucher_no, vdate, narration, reference, amount, created_by, source_doc_id, kind) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id',
      [fy.id, vtype, seq, vno, b.doc_date, narr, b.txn_id, total, user, did, vtype === 'RV' ? 'receipt' : 'supplier_payment'])).id;
    await t.query('UPDATE acc_docs SET pay_voucher_id = %s WHERE id = %s', [pid, did]);
  }
  for (let i = 0; i < lines.length; i++) {
    await t.query('INSERT INTO acc_voucher_lines (voucher_id, account_id, dr, cr, sort) VALUES (%s,%s,%s,%s,%s)', [pid, lines[i][0], lines[i][1], lines[i][2], i]);
  }
}

/** Cheque bill: keep one row in the post-dated cheque register. It posts nothing until deposited. */
async function syncCheque(t, did, b, party, total, chqDate, user) {
  const row = await t.one("SELECT * FROM acc_cheques WHERE doc_id = %s AND status IN ('pending','cleared','bounced') ORDER BY id DESC LIMIT 1", [did]);
  if (b.payment_mode !== 'cheque' || !party) {
    if (row) await t.query("UPDATE acc_cheques SET status='cancelled', updated_by=%s, updated_at=NOW() WHERE id=%s", [user, row.id]);
    return;
  }
  const direction = MONEY_IN.includes(b.doc_type) ? 'received' : 'issued';
  if (row && row.status === 'pending') {
    await t.query('UPDATE acc_cheques SET party_id=%s, direction=%s, cheque_no=%s, cheque_bank=%s, cheque_date=%s, amount=%s, updated_by=%s, updated_at=NOW() WHERE id=%s',
      [party.id, direction, b.cheque_no, b.cheque_bank, chqDate, total, user, row.id]);
  } else if (!row || (row.status === 'bounced' && row.cheque_no !== b.cheque_no)) {   // a new cheque after a bounce
    await t.query('INSERT INTO acc_cheques (doc_id, party_id, direction, cheque_no, cheque_bank, cheque_date, amount, created_by) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)',
      [did, party.id, direction, b.cheque_no, b.cheque_bank, chqDate, total, user]);
  }
}

/** Subject, Attn, validity, template, terms & conditions, notes and the client's logo. */
async function saveQuoteFields(t, did, b, existing, party) {
  const s = (v, n) => String(v || '').trim().slice(0, n) || null;
  let tid = b.qt_template_id && await t.one('SELECT 1 AS x FROM acc_quote_templates WHERE id = %s', [b.qt_template_id]) ? b.qt_template_id : null;
  if (!tid) { const row = await t.one('SELECT id FROM acc_quote_templates ORDER BY is_default DESC, id LIMIT 1'); tid = row ? row.id : null; }
  const old = existing ? existing.qt_client_logo : null;
  let logo = b.qt_client_logo && b.qt_client_logo === old ? b.qt_client_logo : null;
  if (b.qt_client_logo_data) logo = await saveImage('quotes', `doc${did}-logo`, b.qt_client_logo_data, 3);
  const cid = !party && +b.contact_id ? (await t.one('SELECT id FROM staff_contacts WHERE id = %s', [+b.contact_id]))?.id || null : null;
  await t.query('UPDATE acc_docs SET contact_id=' + (cid ? +cid : 'NULL') + ', qt_subject=%s, qt_attn=%s, qt_validity=%s, qt_template_id=%s, qt_terms=%s, qt_notes=%s, qt_client_logo=%s WHERE id=%s',
    [s(b.qt_subject, 160), s(b.qt_attn, 120), s(b.qt_validity, 160), tid, JSON.stringify(cleanTerms(b.qt_terms)), s(b.qt_notes, 1500), logo, did]);
  if (old && old !== logo) await removeImage('quotes', old);
}

/** QR / bank transfer payment voucher (photo or PDF) kept with the document. */
async function saveProof(t, did, b, existing) {
  const old = existing ? existing.pay_proof : null;
  let name = b.pay_proof && b.pay_proof === old ? b.pay_proof : null;
  if (b.pay_proof_data) name = await saveImage('proofs', `doc${did}`, b.pay_proof_data, 5, true);
  await t.query('UPDATE acc_docs SET pay_proof = %s WHERE id = %s', [name, did]);
  if (old && old !== name) await removeImage('proofs', old);
}

/** Cheque: remind the day before and on the cheque date. Credit: follow-up task for the chosen user. */
async function setReminders(t, did, docNo, meta, b, pname, total, chqDate, fuDate, user) {
  const oldTask = await t.one("SELECT task_id FROM acc_reminders WHERE doc_id = %s AND kind = 'followup' AND status = 'open' AND task_id IS NOT NULL ORDER BY id LIMIT 1", [did]);
  await t.query("DELETE FROM acc_reminders WHERE doc_id = %s AND status = 'open'", [did]);
  const want = [];
  const amt = `Rs ${nepMoney(total)}`;
  if (chqDate) {
    const what = meta.side === 'sales'
      ? `Deposit cheque ${b.cheque_no} (${b.cheque_bank}) from ${pname}, ${amt} — ${docNo}`
      : `Cheque ${b.cheque_no} (${b.cheque_bank}) given to ${pname}, ${amt}, will be presented — keep the balance ready — ${docNo}`;
    want.push(['cheque', addDays(chqDate, -1), `Tomorrow: ${what}`, null], ['cheque', chqDate, `Today: ${what}`, null]);
  }
  if (fuDate) {
    const word = meta.side === 'sales' ? 'collect' : 'pay';
    const note = nz(b.followup_note) ? ` — ${String(b.followup_note).trim()}` : '';
    want.push(['followup', fuDate, `Follow up ${pname} to ${word} ${amt} on ${docNo}${note}`, b.followup_user]);
  }
  for (const [kind, on, title, who] of want) {
    if (await t.one("SELECT 1 AS x FROM acc_reminders WHERE doc_id = %s AND kind = %s AND remind_on = %s AND status = 'done'", [did, kind, on])) continue;   // already ticked off earlier
    await t.query('INSERT INTO acc_reminders (doc_id, kind, remind_on, title, assigned_to, created_by, task_id) VALUES (%s,%s,%s,%s,%s,%s,%s)', [did, kind, on, title, who, user, kind === 'followup' ? (oldTask?.task_id ?? null) : null]);
  }
}

/* ────────────────────────────── routes: write ────────────────────────────── */
router.post('/docs', ah(async (req, res) => {
  const b = req.body || {};
  const user = userOf(req);
  const did = await tx(async (t) => {
    const id = await post(t, b, user);
    const d = await t.one('SELECT doc_no, party_name, total FROM acc_docs WHERE id = %s', [id]);
    await audit(t, user, 'create', 'doc', id, { doc_no: d.doc_no, party: d.party_name, total: d.total });
    return id;
  });
  await syncDocTasks(did, user);          // follow-up on a credit bill -> real Task + notifications
  const out = await getDoc(did);
  notify.autoSend(out, user);
  res.json(out);
}));

/** Edit a posted bill / order: needs admin approval (admin password). Keeps its number. */
router.put('/docs/:did', ah(async (req, res) => {
  const did = +req.params.did, b = req.body || {};
  const approver = await adminApproval(req, b.admin_username, b.password);
  const user = userOf(req);
  await tx(async (t) => {
    await t.query('SELECT id FROM acc_docs WHERE id = %s FOR UPDATE', [did]);
    const d = await getDoc(did, t);
    if (d.status === 'cancelled') bad("A cancelled document can't be edited.");
    if (b.doc_type !== d.doc_type) bad("Document type can't change.");
    await guardChangeable(d, 'edit', t);
    await guardCheque(d, 'edit', t);
    b.ref_doc_id = d.ref_doc_id;
    await reverseSerials(t, d);
    await t.query('DELETE FROM acc_line_serials WHERE line_id IN (SELECT id FROM acc_doc_lines WHERE doc_id = %s)', [did]);
    await t.query('DELETE FROM acc_stock_moves WHERE doc_id = %s', [did]);
    await t.query('DELETE FROM acc_doc_lines WHERE doc_id = %s', [did]);
    if (d.voucher_id) await t.query('DELETE FROM acc_voucher_lines WHERE voucher_id = %s', [d.voucher_id]);
    await post(t, b, user, d);
    // the edit must not leave stock below zero (e.g. purchase reduced after goods were sold)
    const ids = new Set([...d.lines.map((l) => l.item_id), ...(b.lines || []).map((l) => +l.item_id)]);
    for (const iid of ids) {
      const qn = await currentQty(t, iid);
      if (qn < -0.0005) bad(`This change would make stock of ${(await t.one('SELECT name FROM acc_items WHERE id = %s', [iid])).name} negative (${nsig(qn)}).`);
    }
    await audit(t, user, 'edit', 'doc', did, { approved_by: approver, before: snapshot(d), after: snapshot(await getDoc(did, t)) });
  });
  await syncDocTasks(did, user);
  res.json(await getDoc(did));
}));

export async function deleteDocNow(t, d, user, approver, reason) {
  const did = d.id;
  if (await t.one('SELECT 1 AS x FROM acc_docs WHERE ref_doc_id = %s LIMIT 1', [did])) bad(`Other documents refer to ${d.doc_no} (returns or a bill made from this order). Delete those first.`);
  if ((await t.one('SELECT is_closed FROM acc_fiscal_years WHERE id = %s', [d.fy_id])).is_closed) bad('Fiscal year is closed.');
  await guardCheque(d, 'delete', t);
  if (d.status !== 'cancelled') {
    await reverseSerials(t, d);
    if (d.ref_doc_id && DOCS[d.doc_type].from) await t.query("UPDATE acc_docs SET status = 'open' WHERE id = %s AND status = 'billed'", [d.ref_doc_id]);
  }
  await t.query('DELETE FROM acc_line_serials WHERE line_id IN (SELECT id FROM acc_doc_lines WHERE doc_id = %s)', [did]);
  for (const s of (await t.query('SELECT id FROM acc_serials WHERE in_doc_id = %s', [did])).rows) {
    if (await t.one('SELECT 1 AS x FROM acc_line_serials WHERE serial_id = %s', [s.id])) await t.query('UPDATE acc_serials SET in_doc_id = NULL WHERE id = %s', [s.id]);
    else await t.query('DELETE FROM acc_serials WHERE id = %s', [s.id]);
  }
  await t.query('UPDATE acc_serials SET out_doc_id = NULL WHERE out_doc_id = %s', [did]);
  await t.query('DELETE FROM acc_stock_moves WHERE doc_id = %s', [did]);
  await t.query('DELETE FROM acc_notifications WHERE doc_id = %s', [did]);
  await t.query('DELETE FROM acc_reminders WHERE doc_id = %s', [did]);
  await t.query('DELETE FROM acc_doc_lines WHERE doc_id = %s', [did]);
  await t.query('DELETE FROM acc_cheques WHERE doc_id = %s', [did]);
  await t.query('DELETE FROM acc_docs WHERE id = %s', [did]);
  for (const vid of withoutNull(new Set([d.voucher_id, d.pay_voucher_id]))) {
    await t.query('DELETE FROM acc_voucher_lines WHERE voucher_id = %s', [vid]);
    await t.query('DELETE FROM acc_vouchers WHERE id = %s', [vid]);
  }
  await t.query("UPDATE acc_approvals SET status = 'approved', decided_by = %s, decided_at = NOW() WHERE entity = 'doc' AND entity_id = %s AND status = 'pending'", [approver, did]);
  await audit(t, user, 'delete', 'doc', did, { approved_by: approver, reason, deleted: snapshot(d) });
  // files are removed only after the transaction commits (see callers) — return what to clean up
  return [['proofs', d.pay_proof], ['transport', d.transport_file], ['quotes', d.qt_client_logo]];
}

export async function requestDelete(t, entity, entityId, entityNo, reason, user) {
  if (await t.one("SELECT 1 AS x FROM acc_approvals WHERE entity = %s AND entity_id = %s AND status = 'pending'", [entity, entityId])) bad('A delete request for this is already waiting for the admin.');
  await t.query('INSERT INTO acc_approvals (entity, entity_id, entity_no, reason, requested_by) VALUES (%s, %s, %s, %s, %s)', [entity, entityId, entityNo, reason, user]);
  await audit(t, user, 'request_delete', entity, entityId, { no: entityNo, reason });
}

export async function cleanupFiles(list) {
  for (const [folder, name] of list || []) await removeImage(folder, name);
}

router.post('/docs/:did/delete', ah(async (req, res) => {
  const did = +req.params.did, b = req.body || {};
  const reason = String(b.reason || '').trim();
  if (reason.length < 3) bad('Give a reason for deleting.');
  const user = userOf(req);
  if (b.request_only) {
    const d = await getDoc(did);
    await tx((t) => requestDelete(t, 'doc', did, d.doc_no, reason, user));
    return res.json({ requested: true });
  }
  const approver = await adminApproval(req, b.admin_username, b.admin_password);
  const files = await tx(async (t) => {
    await t.query('SELECT id FROM acc_docs WHERE id = %s FOR UPDATE', [did]);
    return deleteDocNow(t, await getDoc(did, t), user, approver, reason);
  });
  await cleanupFiles(files);
  res.json({ deleted: true });
}));

router.post('/docs/:did/cancel', ah(async (req, res) => {
  const did = +req.params.did;
  const reason = String(req.body?.reason || '').trim();
  const user = userOf(req);
  await tx(async (t) => {
    await t.query('SELECT id FROM acc_docs WHERE id = %s FOR UPDATE', [did]);
    const d = await getDoc(did, t);
    if (['cancelled', 'billed'].includes(d.status)) {
      const word = d.doc_type === 'QT' && d.status === 'billed' ? 'converted to a Sales Order' : d.status;
      bad(`This ${d.type_name.toLowerCase()} is ${word} and can't be cancelled.`);
    }
    if (reason.length < 3) bad('Give a reason for cancelling.');
    if ((await t.one('SELECT is_closed FROM acc_fiscal_years WHERE id = %s', [d.fy_id])).is_closed) bad('Fiscal year is closed.');
    if (DOCS[d.doc_type].role === 'bill' && d.lines.some((l) => l.returned)) bad('Returns were made against this bill. Cancel those returns first.');
    await guardCheque(d, 'cancel', t);
    if (['PB', 'SR'].includes(d.doc_type)) {
      for (const l of d.lines) {
        if (l.item_type === 'goods' && (await currentQty(t, l.item_id)) - l.qty < -0.0005) bad(`Can't cancel: ${l.item} has already been sold or returned.`);
      }
    }
    await reverseSerials(t, d);
    await t.query('DELETE FROM acc_stock_moves WHERE doc_id = %s', [did]);
    await t.query("UPDATE acc_docs SET status='cancelled', cancel_reason=%s, cancelled_by=%s, cancelled_at=NOW() WHERE id = %s", [reason, user, did]);
    await t.query("DELETE FROM acc_reminders WHERE doc_id = %s AND status = 'open'", [did]);
    for (const vid of withoutNull(new Set([d.voucher_id, d.pay_voucher_id]))) {
      await t.query("UPDATE acc_vouchers SET status='cancelled', cancel_reason=%s, cancelled_by=%s, cancelled_at=NOW() WHERE id = %s AND status <> 'cancelled'", [reason, user, vid]);
    }
    await t.query("UPDATE acc_cheques SET status='cancelled', updated_by=%s, updated_at=NOW() WHERE doc_id=%s AND status IN ('pending','bounced')", [user, did]);
    if (d.ref_doc_id && DOCS[d.doc_type].from) await t.query("UPDATE acc_docs SET status = 'open' WHERE id = %s AND status = 'billed'", [d.ref_doc_id]);
    await audit(t, user, 'cancel', 'doc', did, { doc_no: d.doc_no, reason });
  });
  res.json(await getDoc(did));
}));

/** IRD: the first print is the original; every later print says 'Copy of Original'. */
router.post('/docs/:did/print', ah(async (req, res) => {
  const did = +req.params.did;
  const d = await getDoc(did);
  await tx(async (t) => {
    await t.query('UPDATE acc_docs SET print_count = print_count + 1 WHERE id = %s', [did]);
    await audit(t, userOf(req), 'print', 'doc', did, { doc_no: d.doc_no, copy: d.print_count });
  });
  res.json(await getDoc(did));
}));

/** Follow-up task on a quotation (or any document): who, how urgent, when, remarks. Shows under Alerts. */
router.post('/docs/:did/task', ah(async (req, res) => {
  const did = +req.params.did, b = req.body || {};
  const d = await getDoc(did);
  if (d.status === 'cancelled') bad('This document is cancelled.');
  const who = await one('SELECT username, full_name FROM users WHERE username = %s AND COALESCE(active, TRUE) = TRUE', [String(b.assigned_to || '').trim()]);
  if (!who) bad('Choose the staff member for this task.');
  const priority = b.priority || 'normal';
  if (!PRIORITIES.includes(priority)) bad('Priority must be Low, Normal, High or Urgent.');
  const on = isoOrBad(b.remind_on, 'follow-up date') || bad('Choose the follow-up date.');
  const note = String(b.note || '').trim().slice(0, 500) || null;
  const what = d.doc_type === 'QT' && d.qt_subject ? `quotation for ${d.qt_subject}` : d.type_name.toLowerCase();
  const title = `Follow up ${d.party_name} on ${what} — ${d.doc_no} (Rs ${nepMoney(d.total)})`;
  const user = userOf(req);
  await tx(async (t) => {
    await t.query("INSERT INTO acc_reminders (doc_id, kind, remind_on, title, assigned_to, created_by, priority, note) VALUES (%s, 'followup', %s, %s, %s, %s, %s, %s)", [did, on, title, who.username, user, priority, note]);
    await audit(t, user, 'task', 'doc', did, { doc_no: d.doc_no, to: who.username, on, priority });
  });
  await syncDocTasks(did, user);          // appears in the staff member's Task list + bell / phone notification
  res.json(await getDoc(did));
}));

router.post('/docs/:did/send', ah(async (req, res) => {
  const did = +req.params.did, b = req.body || {};
  if (!['email', 'whatsapp'].includes(b.channel)) bad('Unknown channel.');
  const d = await getDoc(did);
  if (d.status === 'cancelled') bad('This document is cancelled.');
  await notify.sendDoc(d, b.channel, userOf(req), b.text, b.to);
  await tx((t) => audit(t, userOf(req), `send_${b.channel}`, 'doc', did, { doc_no: d.doc_no }));
  res.json(await getDoc(did));
}));

export default router;

export { post as postDoc };
