/* VAT reports in the Inland Revenue Department (IRD) Nepal formats, month by month (Nepali months):
 *
 *   GET /reports/vat-sales     — बिक्री खाता (Sales Book): every Sales Invoice, Sales Return (credit note) and
 *                                 cancelled invoice, with buyer PAN, total / non-taxable / export / taxable sales and VAT
 *   GET /reports/vat-purchase  — खरिद खाता (Purchase Book): every Purchase bill and Purchase Return (debit note) with
 *                                 supplier PAN, total / non-taxable / taxable purchase (local & import) and VAT
 *   GET /reports/vat-return    — monthly VAT return (मु.अ.कर विवरण): sales, purchases, output tax, input tax,
 *                                 adjustments, net tax payable / credit carried forward to next month
 *
 * Source figures are the bills' own taxable / exempt / VAT amounts (acc_docs). Expense and asset vouchers entered with a
 * VAT bill (Dr Input VAT) are purchases for IRD too: they are listed in the Purchase Book (assets as capital purchase)
 * and their VAT is claimed in the return. Output VAT charged in vouchers (e.g. asset sale) is added to output tax.
 */
import { Router } from 'express';
import { q, one } from '../../services/accounts/accDb.js';
import { ah, bad, money } from '../../services/accounts/common.js';
import { adToBs, bsToAd, addDays, isIsoDate, bsStr, BS_MONTHS } from '../../services/accounts/nepaliDate.js';

const router = Router();

function range(req) {
  const { date_from, date_to } = req.query;
  if (!date_from || !date_to) bad('Choose a date range.');
  if (!isIsoDate(date_from) || !isIsoDate(date_to)) bad('Dates must be YYYY-MM-DD.');
  if (date_from > date_to) bad('From date is after To date.');
  return [date_from, date_to];
}

/** Split a period at Nepali month boundaries -> [{ key, label, from, to }] */
function nepaliMonths(from, to) {
  const months = [];
  let start = from;
  while (start <= to) {
    const bs = adToBs(start);
    if (!bs) bad(`The date ${start} is outside the supported Nepali calendar.`);
    const [by, bm] = bs;
    let nextStart;
    try { nextStart = bsToAd(bm === 12 ? by + 1 : by, bm === 12 ? 1 : bm + 1, 1); } catch { nextStart = addDays(to, 1); }
    const end = nextStart <= to ? addDays(nextStart, -1) : to;
    months.push({ key: `${by}-${String(bm).padStart(2, '0')}`, label: `${BS_MONTHS[bm - 1]} ${by}`, from: start, to: end });
    start = addDays(end, 1);
    if (months.length > 60) bad('Choose a period of five years or less.');
  }
  return months;
}
const monthKey = (iso) => { const b = adToBs(iso); return b ? `${b[0]}-${String(b[1]).padStart(2, '0')}` : ''; };

/** Bills of the given types with their product names / quantity / unit summarised for the register row. */
async function bills(types, from, to) {
  const docs = (await q(
    "SELECT d.id, d.doc_type, d.doc_no, d.doc_date, d.status, d.supplier_bill_no, d.supplier_bill_date, d.vat_bill_no,"
    + " COALESCE(NULLIF(d.party_name, ''), p.name, 'Cash') AS party, COALESCE(NULLIF(d.party_pan, ''), p.pan, '') AS pan,"
    + ' d.taxable, d.exempt, d.vat, d.total, rd.doc_no AS ref_no'
    + ' FROM acc_docs d LEFT JOIN acc_ledgers p ON p.id = d.party_id LEFT JOIN acc_docs rd ON rd.id = d.ref_doc_id'
    + ` WHERE d.doc_type IN (${types.map(() => '%s').join(',')}) AND d.doc_date BETWEEN %s AND %s`
    + " AND d.status IN ('posted','cancelled')"
    + ' ORDER BY d.doc_date, d.doc_no',
    [...types, from, to])).rows;
  if (!docs.length) return [];
  const lines = (await q(
    'SELECT l.doc_id, i.name, l.qty, u.name AS unit FROM acc_doc_lines l JOIN acc_items i ON i.id = l.item_id'
    + ` JOIN acc_units u ON u.id = i.unit_id WHERE l.doc_id IN (${docs.map(() => '%s').join(',')}) ORDER BY l.doc_id, l.sort, l.id`,
    docs.map((d) => d.id))).rows;
  const byDoc = new Map();
  for (const l of lines) (byDoc.get(l.doc_id) || byDoc.set(l.doc_id, []).get(l.doc_id)).push(l);
  return docs.map((d) => {
    const ls = byDoc.get(d.id) || [];
    const units = [...new Set(ls.map((l) => l.unit))];
    const qty = Math.round(ls.reduce((a, l) => a + l.qty, 0) * 1000) / 1000;
    const names = ls.map((l) => l.name);
    return { ...d, products: names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2} more` : names.join(', '),
      qty, unit: units.length === 1 ? units[0] : (units.length ? 'Mixed' : ''), date_bs: bsStr(d.doc_date), month: monthKey(d.doc_date) };
  });
}

/** Group register rows by Nepali month with subtotals of the numeric fields. */
function byMonth(months, rows, fields) {
  return months.map((m) => {
    const list = rows.filter((r) => r.month === m.key);
    const sub = {};
    for (const f of fields) sub[f] = money(list.reduce((a, r) => a + (r[f] || 0), 0));
    return { ...m, rows: list, totals: sub };
  }).filter((m) => m.rows.length);
}
const grand = (groups, fields) => Object.fromEntries(fields.map((f) => [f, money(groups.reduce((a, g) => a + g.totals[f], 0))]));

// ── बिक्री खाता — Sales Book ──────────────────────────────────────────────────────────────────────
const SALES_F = ['total', 'exempt', 'export', 'taxable', 'vat'];
router.get('/reports/vat-sales', ah(async (req, res) => {
  const [from, to] = range(req);
  const rows = (await bills(['SI', 'SR'], from, to)).map((d) => {
    const cancelled = d.status === 'cancelled';
    const sign = d.doc_type === 'SR' ? -1 : 1;                      // credit note reduces sales and tax
    const v = (x) => (cancelled ? 0 : money(sign * x));
    return {
      id: d.id, month: d.month, date: d.doc_date, date_bs: d.date_bs, bill_no: d.vat_bill_no || d.doc_no, doc_no: d.doc_no,
      kind: cancelled ? 'cancelled' : d.doc_type === 'SR' ? 'credit_note' : 'invoice', ref_no: d.ref_no || '',
      party: d.party, pan: d.pan, products: d.products, qty: d.qty, unit: d.unit,
      total: v(d.taxable + d.exempt), exempt: v(d.exempt), export: 0, taxable: v(d.taxable), vat: v(d.vat),
    };
  });
  const groups = byMonth(nepaliMonths(from, to), rows, SALES_F);
  res.json({ months: groups, totals: grand(groups, SALES_F) });
}));

// ── खरिद खाता — Purchase Book ─────────────────────────────────────────────────────────────────────
const PURCH_F = ['total', 'exempt', 'taxable', 'vat', 'import_taxable', 'import_vat', 'capital_taxable', 'capital_vat'];
router.get('/reports/vat-purchase', ah(async (req, res) => {
  const [from, to] = range(req);
  const rows = (await bills(['PB', 'PR'], from, to)).filter((d) => d.status !== 'cancelled').map((d) => {
    const sign = d.doc_type === 'PR' ? -1 : 1;                      // debit note reduces purchase and tax
    const v = (x) => money(sign * x);
    return {
      id: d.id, month: d.month, date: d.doc_date, date_bs: d.date_bs,
      bill_no: d.supplier_bill_no || d.doc_no, doc_no: d.doc_no, kind: d.doc_type === 'PR' ? 'debit_note' : 'bill', ref_no: d.ref_no || '',
      party: d.party, pan: d.pan, products: d.products, qty: d.qty, unit: d.unit,
      total: v(d.taxable + d.exempt), exempt: v(d.exempt), taxable: v(d.taxable), vat: v(d.vat),
      import_taxable: 0, import_vat: 0, capital_taxable: 0, capital_vat: 0,
    };
  });
  // expense / asset vouchers entered with a VAT bill (Dr Input VAT) are purchases too
  const vs = (await q(
    'SELECT v.id, v.voucher_no, v.vdate, v.reference, v.narration, v.kind,'
    + " SUM(CASE WHEN a.system_key = 'input_vat' THEN l.dr ELSE 0 END) AS vat,"
    + " SUM(CASE WHEN a.system_key IS DISTINCT FROM 'input_vat' AND a.kind NOT IN ('cash','bank','party','tax') THEN l.dr ELSE 0 END) AS taxable,"
    + " MAX(CASE WHEN a.kind = 'party' AND l.cr > 0 THEN a.name END) AS party, MAX(CASE WHEN a.kind = 'party' AND l.cr > 0 THEN a.pan END) AS pan"
    + ' FROM acc_vouchers v JOIN acc_voucher_lines l ON l.voucher_id = v.id JOIN acc_ledgers a ON a.id = l.account_id'
    + " WHERE v.status = 'posted' AND v.vtype IN ('JV','PV','RV','CV') AND v.vdate BETWEEN %s AND %s"
    + " GROUP BY v.id HAVING SUM(CASE WHEN a.system_key = 'input_vat' THEN l.dr ELSE 0 END) > 0 ORDER BY v.vdate, v.voucher_no",
    [from, to])).rows;
  for (const v of vs) {
    const capital = v.kind === 'asset_purchase';
    rows.push({
      id: `v${v.id}`, month: monthKey(v.vdate), date: v.vdate, date_bs: bsStr(v.vdate), bill_no: v.reference || v.voucher_no, doc_no: v.voucher_no,
      kind: capital ? 'capital' : 'expense', ref_no: '', party: v.party || v.narration || '—', pan: v.pan || '',
      products: capital ? 'Fixed asset' : 'Expense', qty: 0, unit: '',
      total: money(v.taxable), exempt: 0, taxable: capital ? 0 : money(v.taxable), vat: capital ? 0 : money(v.vat),
      import_taxable: 0, import_vat: 0, capital_taxable: capital ? money(v.taxable) : 0, capital_vat: capital ? money(v.vat) : 0,
    });
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const groups = byMonth(nepaliMonths(from, to), rows, PURCH_F);
  res.json({ months: groups, totals: grand(groups, PURCH_F) });
}));

// ── मूल्य अभिवृद्धि कर विवरण — monthly VAT return ────────────────────────────────────────────────────
router.get('/reports/vat-return', ah(async (req, res) => {
  const [from, to] = range(req);
  const months = nepaliMonths(from, to);
  const docs = (await q(
    "SELECT doc_type, doc_date, taxable, exempt, vat FROM acc_docs WHERE doc_type IN ('SI','SR','PB','PR')"
    + " AND status = 'posted' AND doc_date BETWEEN %s AND %s", [from, to])).rows;
  // Input / Output VAT entered by hand (journal, payment, receipt, contra) — e.g. VAT on an expense bill
  const adj = (await q(
    "SELECT v.vdate, a.system_key, l.dr, l.cr FROM acc_voucher_lines l JOIN acc_vouchers v ON v.id = l.voucher_id"
    + " JOIN acc_ledgers a ON a.id = l.account_id WHERE v.status = 'posted' AND v.vtype IN ('JV','PV','RV','CV')"
    + " AND a.system_key IN ('input_vat','output_vat') AND v.vdate BETWEEN %s AND %s", [from, to])).rows;
  // VAT credit brought forward = Input VAT minus Output VAT balance before the period (only if it is a credit)
  const before = await one(
    "SELECT COALESCE(SUM(CASE WHEN a.system_key = 'input_vat' THEN l.dr - l.cr ELSE 0 END), 0) AS input,"
    + " COALESCE(SUM(CASE WHEN a.system_key = 'output_vat' THEN l.cr - l.dr ELSE 0 END), 0) AS output"
    + " FROM acc_voucher_lines l JOIN acc_vouchers v ON v.id = l.voucher_id JOIN acc_ledgers a ON a.id = l.account_id"
    + " WHERE v.status = 'posted' AND a.system_key IN ('input_vat','output_vat') AND v.vdate < %s", [from]);
  let credit = money(Math.max(0, (before?.input || 0) - (before?.output || 0)));
  const openingCredit = credit;

  const out = months.map((m) => {
    const inM = (r) => r.doc_date >= m.from && r.doc_date <= m.to;
    const sum = (type, f) => money(docs.filter((r) => r.doc_type === type && inM(r)).reduce((a, r) => a + r[f], 0));
    const s = {
      sales_taxable: sum('SI', 'taxable'), sales_exempt: sum('SI', 'exempt'), sales_export: 0, sales_vat: sum('SI', 'vat'),
      sret_taxable: sum('SR', 'taxable'), sret_exempt: sum('SR', 'exempt'), sret_vat: sum('SR', 'vat'),
      purch_taxable: sum('PB', 'taxable'), purch_exempt: sum('PB', 'exempt'), purch_import: 0, purch_vat: sum('PB', 'vat'),
      pret_taxable: sum('PR', 'taxable'), pret_exempt: sum('PR', 'exempt'), pret_vat: sum('PR', 'vat'),
    };
    const a = adj.filter((r) => r.vdate >= m.from && r.vdate <= m.to);
    // only VAT claimed (Dr Input VAT) / charged (Cr Output VAT) — the opposite side is a VAT payment or set-off, not tax
    s.adj_input = money(a.filter((r) => r.system_key === 'input_vat').reduce((x, r) => x + r.dr, 0));
    s.adj_output = money(a.filter((r) => r.system_key === 'output_vat').reduce((x, r) => x + r.cr, 0));
    s.net_sales_taxable = money(s.sales_taxable - s.sret_taxable);
    s.net_sales_exempt = money(s.sales_exempt - s.sret_exempt);
    s.net_purch_taxable = money(s.purch_taxable - s.pret_taxable);
    s.net_purch_exempt = money(s.purch_exempt - s.pret_exempt);
    s.output_vat = money(s.sales_vat - s.sret_vat + s.adj_output);
    s.input_vat = money(s.purch_vat - s.pret_vat + s.adj_input);
    s.credit_bf = credit;
    const balance = money(s.output_vat - s.input_vat - credit);
    s.payable = balance > 0 ? balance : 0;            // tax to pay to IRD for the month
    s.credit_cf = balance < 0 ? money(-balance) : 0;  // credit carried to next month
    credit = s.credit_cf;
    return { ...m, ...s };
  });
  const keys = ['net_sales_taxable', 'net_sales_exempt', 'sales_export', 'output_vat', 'net_purch_taxable', 'net_purch_exempt', 'purch_import',
    'input_vat', 'adj_input', 'adj_output', 'payable', 'sales_taxable', 'sret_taxable', 'sales_vat', 'sret_vat', 'purch_taxable', 'pret_taxable', 'purch_vat', 'pret_vat'];
  const totals = Object.fromEntries(keys.map((k) => [k, money(out.reduce((a, r) => a + (r[k] || 0), 0))]));
  totals.credit_cf = out.length ? out[out.length - 1].credit_cf : 0;
  totals.credit_bf = openingCredit;
  res.json({ months: out, totals });
}));

export default router;
