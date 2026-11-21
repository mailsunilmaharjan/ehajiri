/* Profit reports:
 *   GET /reports/profit-loss     — Profit & Loss Account (trading format) for a period
 *   GET /reports/bill-profit     — Bill-wise profit: each Sales Invoice / Sales Return with its cost of goods
 *   GET /reports/monthly-profit  — Month by month (Nepali months): income, cost of goods, expenses, net profit
 *
 * How the figures are worked out
 *   • Income / expense amounts come from posted voucher lines, by ledger group:
 *       4101… Revenue from Operations (Sales, Sales Return, Service Income)  -> Sales
 *       4102… and any other Income group                                     -> Other income
 *       5101… Cost of Sales (Purchase, Purchase Return, Freight, Customs)    -> Purchases (trading)
 *       any other Expense group                                              -> Expenses
 *   • Cost of goods sold = Opening stock + Purchases − Closing stock. Stock is valued with the
 *     module's own weighted-average valuation (services/accounts/stock.js), so it matches Stock Summary.
 *   • Bill-wise cost = each sale's own stock movement at its weighted-average rate.
 */
import { Router } from 'express';
import { q, one } from '../../services/accounts/accDb.js';
import { ah, bad, money } from '../../services/accounts/common.js';
import { valuate } from '../../services/accounts/stock.js';
import { adToBs, bsToAd, addDays, isIsoDate, BS_MONTHS } from '../../services/accounts/nepaliDate.js';

// expense ledgers that are a damage / loss (shown in their own column, not in ordinary expenses)
const DAMAGE_RE = /damage|loss|write[s-]?off|wastage|shortage|breakage|expired/i;

const router = Router();
const POSTED = "v.status = 'posted'";

function range(req) {
  const { date_from, date_to } = req.query;
  if (!date_from || !date_to) bad('Choose a date range.');
  if (!isIsoDate(date_from) || !isIsoDate(date_to)) bad('Dates must be YYYY-MM-DD.');
  if (date_from > date_to) bad('From date is after To date.');
  return [date_from, date_to];
}

/** 'rev' | 'other_inc' | 'purch' | 'exp' | null for a ledger group (by code prefix + nature). */
function section(groupCode, nature) {
  const c = String(groupCode || '');
  if (nature === 'I') return c.startsWith('4101') ? 'rev' : 'other_inc';
  if (nature === 'X') return c.startsWith('5101') ? 'purch' : 'exp';
  return null;
}

/** Income & expense ledgers with their movement between two dates (inclusive). */
async function plLedgers(from, to) {
  const rows = (await q(
    'SELECT a.id, a.code, a.name, g.code AS group_code, g.name AS group_name, g.nature,'
    + ` COALESCE(SUM(CASE WHEN ${POSTED} AND v.vdate BETWEEN %s AND %s THEN l.dr - l.cr END), 0) AS net`
    + ' FROM acc_ledgers a JOIN acc_groups g ON g.id = a.group_id'
    + ' LEFT JOIN acc_voucher_lines l ON l.account_id = a.id LEFT JOIN acc_vouchers v ON v.id = l.voucher_id'
    + " WHERE g.nature IN ('I','X')"
    + ' GROUP BY a.id, g.id ORDER BY g.code, a.code',
    [from, to])).rows;
  return rows.map((r) => ({ ...r, section: section(r.group_code, r.nature), net: money(r.net) }));
}

/** Stock value on a date (end of that day), from the weighted-average valuation. */
function stockValueAt(movesByItem, date) {
  let total = 0;
  for (const moves of Object.values(movesByItem)) {
    let last = null;
    for (const m of moves) { if (m.move_date <= date) last = m; else break; }
    if (last) total += last.bal_value;
  }
  return money(total);
}

/** Sum a section; income sections are shown as positive (credit balance). */
const sumSec = (rows, sec) => money(rows.filter((r) => r.section === sec).reduce((a, r) => a + (sec === 'rev' || sec === 'other_inc' ? -r.net : r.net), 0));

function plFigures(ledgers, openingStock, closingStock) {
  const sales = sumSec(ledgers, 'rev');
  const purchases = sumSec(ledgers, 'purch');
  const cogs = money(openingStock + purchases - closingStock);
  const gross = money(sales - cogs);
  const otherIncome = sumSec(ledgers, 'other_inc');
  const expenses = sumSec(ledgers, 'exp');
  const net = money(gross + otherIncome - expenses);
  return { sales, opening_stock: openingStock, purchases, closing_stock: closingStock, cogs, gross_profit: gross,
    other_income: otherIncome, expenses, net_profit: net };
}

// ── Profit & Loss Account ───────────────────────────────────────────────────────────────────────
router.get('/reports/profit-loss', ah(async (req, res) => {
  const [from, to] = range(req);
  const ledgers = await plLedgers(from, to);
  const moves = await valuate(null, to);
  const openingStock = stockValueAt(moves, addDays(from, -1));
  const closingStock = stockValueAt(moves, to);
  const fig = plFigures(ledgers, openingStock, closingStock);

  const pick = (sec) => {
    const groups = new Map();
    for (const r of ledgers.filter((x) => x.section === sec)) {
      const amt = money(sec === 'rev' || sec === 'other_inc' ? -r.net : r.net);
      if (!amt) continue;
      if (!groups.has(r.group_code)) groups.set(r.group_code, { code: r.group_code, name: r.group_name, total: 0, rows: [] });
      const g = groups.get(r.group_code);
      g.rows.push({ id: r.id, code: r.code, name: r.name, amount: amt });
      g.total = money(g.total + amt);
    }
    return [...groups.values()];
  };
  res.json({ ...fig, sales_rows: pick('rev'), purchase_rows: pick('purch'), other_income_rows: pick('other_inc'), expense_rows: pick('exp') });
}));

// ── Bill-wise profit ───────────────────────────────────────────────────────────────────────────
router.get('/reports/bill-profit', ah(async (req, res) => {
  const [from, to] = range(req);
  const docs = (await q(
    "SELECT d.id, d.doc_type, d.doc_no, d.doc_date, COALESCE(p.name, d.party_name, 'Cash') AS party,"
    + ' d.taxable + d.exempt AS sales_value, d.total, d.vat'
    + ' FROM acc_docs d LEFT JOIN acc_ledgers p ON p.id = d.party_id'
    + " WHERE d.doc_type IN ('SI','SR') AND d.status IN ('posted','billed') AND d.doc_date BETWEEN %s AND %s"
    + ' ORDER BY d.doc_date, d.doc_no',
    [from, to])).rows;
  // cost of each bill = its own stock movements at the weighted-average rate
  const moves = await valuate(null, to);
  const costByDoc = new Map();
  for (const list of Object.values(moves)) {
    for (const m of list) {
      if (!m.doc_id) continue;
      if (m.kind === 'sale') costByDoc.set(m.doc_id, (costByDoc.get(m.doc_id) || 0) + m.qty_out * m.move_rate);
      else if (m.kind === 'sales_return') costByDoc.set(m.doc_id, (costByDoc.get(m.doc_id) || 0) + m.qty_in * m.move_rate);
    }
  }
  const lineCount = new Map((await q(
    "SELECT l.doc_id, COUNT(*) AS n FROM acc_doc_lines l JOIN acc_docs d ON d.id = l.doc_id"
    + " WHERE d.doc_type IN ('SI','SR') AND d.doc_date BETWEEN %s AND %s GROUP BY l.doc_id", [from, to])).rows.map((r) => [r.doc_id, r.n]));
  const rows = docs.map((d) => {
    const sign = d.doc_type === 'SR' ? -1 : 1;           // a return takes sales and cost back
    const sales = money(sign * d.sales_value);
    const cost = money(sign * (costByDoc.get(d.id) || 0));
    const profit = money(sales - cost);
    return { id: d.id, doc_type: d.doc_type, doc_no: d.doc_no, doc_date: d.doc_date, party: d.party, items: lineCount.get(d.id) || 0,
      sales, cost, profit, margin: sales ? Math.round((profit / sales) * 10000) / 100 : 0 };
  });
  const tot = (k) => money(rows.reduce((a, r) => a + r[k], 0));
  const totals = { sales: tot('sales'), cost: tot('cost'), profit: tot('profit') };
  totals.margin = totals.sales ? Math.round((totals.profit / totals.sales) * 10000) / 100 : 0;
  res.json({ rows, totals });
}));

// ── Monthly expenses & profit (Nepali months) ──────────────────────────────────────────────────
router.get('/reports/monthly-profit', ah(async (req, res) => {
  const [from, to] = range(req);
  // split the period at Nepali month boundaries
  const months = [];
  let start = from;
  while (start <= to) {
    const bs = adToBs(start);
    if (!bs) bad(`The date ${start} is outside the supported Nepali calendar.`);
    const [by, bm] = bs;
    const nextY = bm === 12 ? by + 1 : by;
    const nextM = bm === 12 ? 1 : bm + 1;
    let nextStart;
    try { nextStart = bsToAd(nextY, nextM, 1); } catch { nextStart = addDays(to, 1); }
    const end = nextStart <= to ? addDays(nextStart, -1) : to;
    months.push({ key: `${by}-${String(bm).padStart(2, '0')}`, label: `${BS_MONTHS[bm - 1]} ${by}`, from: start, to: end });
    start = addDays(end, 1);
    if (months.length > 60) bad('Choose a period of five years or less.');
  }
  const moves = await valuate(null, to);
  const expenseGroups = new Map();     // group code -> name (columns of the expense breakdown)
  const out = [];
  for (const m of months) {
    const ledgers = await plLedgers(m.from, m.to);
    const fig = plFigures(ledgers, stockValueAt(moves, addDays(m.from, -1)), stockValueAt(moves, m.to));
    const byGroup = {};
    let damage = 0;
    for (const r of ledgers.filter((x) => x.section === 'exp' && x.net)) {
      if (DAMAGE_RE.test(r.name)) { damage += r.net; continue; }
      byGroup[r.group_code] = money((byGroup[r.group_code] || 0) + r.net);
      expenseGroups.set(r.group_code, r.group_name);
    }
    damage = money(damage);
    // ordinary expenses exclude damage / loss; net profit is unchanged (both are taken off)
    out.push({ ...m, ...fig, expenses: money(fig.expenses - damage), damage, expense_by_group: byGroup });
  }
  const sumK = (k) => money(out.reduce((a, r) => a + r[k], 0));
  const totals = { sales: sumK('sales'), purchases: sumK('purchases'), cogs: sumK('cogs'), gross_profit: sumK('gross_profit'),
    other_income: sumK('other_income'), expenses: sumK('expenses'), damage: sumK('damage'), net_profit: sumK('net_profit'), expense_by_group: {} };
  for (const code of expenseGroups.keys()) totals.expense_by_group[code] = money(out.reduce((a, r) => a + (r.expense_by_group[code] || 0), 0));
  res.json({ months: out, totals, expense_groups: [...expenseGroups.entries()].sort().map(([code, name]) => ({ code, name })) });
}));

// ── Balance Sheet (Statement of Financial Position, NFRS / Companies Act format) ──────────────────
// GET /reports/balance-sheet?date_from=<FY start>&date_to=<as at>
// Two columns: as at date_to, and as at the day before date_from (previous year-end) when that year exists.
// Lines are the chart's ledger groups, rolled up to the group directly under each section
// (Non-Current Assets, Current Assets, Equity, Non-Current Liabilities, Current Liabilities).
// • Inventories = closing stock at weighted-average cost (same figure as the P&L), not the Stock-in-Hand ledger.
// • Income/expense ledgers are not closed into a ledger, so profit is worked out here and shown under Equity:
//     profit to date  = −(income + expense balances) + closing stock − Stock-in-Hand ledger   (keeps the sheet balanced)
//     profit for year = the P&L net profit from the year's start; previous years = the rest.
async function fyStartFor(date) {
  const r = await one('SELECT start_date FROM acc_fiscal_years WHERE start_date <= %s AND end_date >= %s ORDER BY start_date DESC LIMIT 1', [date, date]);
  return r ? String(r.start_date).slice(0, 10) : null;
}

async function bsColumn(date, fyStart, ledgers) {
  const bal = new Map((await q(
    'SELECT a.id, a.opening_balance + COALESCE(SUM(CASE WHEN v.status = \'posted\' AND v.vdate <= %s THEN l.dr - l.cr END), 0) AS bal'
    + ' FROM acc_ledgers a LEFT JOIN acc_voucher_lines l ON l.account_id = a.id LEFT JOIN acc_vouchers v ON v.id = l.voucher_id'
    + ' GROUP BY a.id', [date])).rows.map((r) => [r.id, money(r.bal)]));
  const moves = await valuate(null, date);
  const closingStock = stockValueAt(moves, date);
  let ix = 0, stockLedger = 0;
  for (const l of ledgers) {
    const b = bal.get(l.id) || 0;
    if (l.nature === 'I' || l.nature === 'X') ix += b;
    if (l.system_key === 'stock') stockLedger += b;
  }
  const profitToDate = money(-ix + closingStock - stockLedger);
  let profitYear = 0;
  if (fyStart) {
    const fig = plFigures(await plLedgers(fyStart, date), stockValueAt(moves, addDays(fyStart, -1)), closingStock);
    profitYear = fig.net_profit;
  }
  // amount per ledger, shown the natural way round: assets as debit balance, equity/liabilities as credit balance
  const amt = new Map();
  for (const l of ledgers) {
    if (l.nature === 'I' || l.nature === 'X') continue;
    const b = l.system_key === 'stock' ? closingStock : (bal.get(l.id) || 0);
    amt.set(l.id, money(l.nature === 'A' ? b : -b));
  }
  return { amt, profitYear, profitPrev: money(profitToDate - profitYear) };
}

router.get('/reports/balance-sheet', ah(async (req, res) => {
  const [from, to] = range(req);
  const groups = (await q('SELECT id, code, name, nature, parent_id, sort FROM acc_groups ORDER BY sort, code')).rows;
  const ledgers = (await q(
    'SELECT a.id, a.code, a.name, a.system_key, a.group_id, g.nature FROM acc_ledgers a JOIN acc_groups g ON g.id = a.group_id ORDER BY a.code')).rows;

  const prevAsAt = addDays(from, -1);
  const prevFyStart = await fyStartFor(prevAsAt);
  const cols = { cur: await bsColumn(to, from, ledgers) };
  if (prevFyStart) cols.prev = await bsColumn(prevAsAt, prevFyStart, ledgers);
  const keys = Object.keys(cols);
  const zero = () => Object.fromEntries(keys.map((k) => [k, 0]));
  const add = (t, a) => { for (const k of keys) t[k] = money(t[k] + (a[k] || 0)); };
  const nonZero = (a) => keys.some((k) => a[k]);

  // group tree: section = child of a root (A/L) or the root itself (E); line = child of the section
  const byId = new Map(groups.map((g) => [g.id, g]));
  const chain = (g) => { const c = []; for (let x = g; x; x = x.parent_id ? byId.get(x.parent_id) : null) c.unshift(x); return c; };
  const sections = new Map();   // section group id -> { name, nature, lines: Map(line id -> line) }
  for (const l of ledgers) {
    if (l.nature === 'I' || l.nature === 'X') continue;
    const c = chain(byId.get(l.group_id));
    const sec = l.nature === 'E' ? c[0] : (c[1] || c[0]);
    const line = l.nature === 'E' ? (c[1] || c[0]) : (c[2] || c[1] || c[0]);
    if (!sections.has(sec.id)) sections.set(sec.id, { code: sec.code, name: sec.name, nature: l.nature, sort: sec.sort, lines: new Map() });
    const s = sections.get(sec.id);
    if (!s.lines.has(line.id)) s.lines.set(line.id, { code: line.code, name: line.name, sort: line.sort, amt: zero(), ledgers: [] });
    const ln = s.lines.get(line.id);
    const a = Object.fromEntries(keys.map((k) => [k, cols[k].amt.get(l.id) || 0]));
    if (!nonZero(a)) continue;
    ln.ledgers.push({ id: l.id, name: l.system_key === 'stock' ? `${l.name} (closing stock)` : l.name, amt: a });
    add(ln.amt, a);
  }
  const bySort = (x, y) => (x.sort - y.sort) || String(x.code).localeCompare(String(y.code));
  const out = (nature) => [...sections.values()].filter((s) => s.nature === nature).sort(bySort).map((s) => {
    const lines = [...s.lines.values()].sort(bySort).filter((ln) => nonZero(ln.amt));
    if (nature === 'E') {
      const prev = Object.fromEntries(keys.map((k) => [k, cols[k].profitPrev]));
      const year = Object.fromEntries(keys.map((k) => [k, cols[k].profitYear]));
      if (nonZero(prev)) lines.push({ code: 'pp', name: 'Accumulated profit / (loss) of previous years', amt: prev, ledgers: [] });
      lines.push({ code: 'py', name: 'Profit / (loss) for the year', amt: year, ledgers: [], profit: true });
    }
    const total = zero();
    for (const ln of lines) add(total, ln.amt);
    return { code: s.code, name: s.name, lines, total };
  });
  const sideTotal = (secs) => { const t = zero(); for (const s of secs) add(t, s.total); return t; };
  const assets = out('A');
  const equity = out('E');
  const liabilities = out('L');
  const totalAssets = sideTotal(assets);
  const totalEL = sideTotal([...equity, ...liabilities]);
  const difference = Object.fromEntries(keys.map((k) => [k, money(totalAssets[k] - totalEL[k])]));
  res.json({ as_at: to, prev_as_at: prevFyStart ? prevAsAt : null, columns: keys,
    assets, equity, liabilities, total_assets: totalAssets, total_equity_liabilities: totalEL, difference });
}));

export default router;
