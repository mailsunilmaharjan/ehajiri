/* Stock quantities and weighted-average valuation (NAS 2 / NFRS: LIFO not allowed).
 * Port of NepalAccounts/server/app/stock.py.
 *
 * Values are recomputed from acc_stock_moves in date order, so back-dated entries are always
 * valued correctly in reports.
 */
import { q, one, marks } from './accDb.js';
import { money } from './common.js';

export async function currentQty(t, itemId) {
  const r = await t.one('SELECT COALESCE(SUM(qty_in - qty_out), 0) AS q FROM acc_stock_moves WHERE item_id = %s', [itemId]);
  return Math.round(r.q * 1000) / 1000;
}

export async function firstFyStart() {
  const r = await one('SELECT MIN(start_date) AS d FROM acc_fiscal_years');
  return r.d;
}

/** Keep the item's opening-stock move and the Stock in Hand opening balance in line. */
export async function syncOpening(t, item) {
  await t.query("DELETE FROM acc_stock_moves WHERE item_id = %s AND kind = 'opening'", [item.id]);
  if (item.opening_qty && item.opening_qty > 0) {
    const start = (await t.one('SELECT MIN(start_date) AS d FROM acc_fiscal_years')).d;
    await t.query(
      "INSERT INTO acc_stock_moves (item_id, move_date, kind, qty_in, rate, fixed_rate) VALUES (%s, %s, 'opening', %s, %s, 1)",
      [item.id, start, item.opening_qty, item.opening_rate]);
  }
  const total = (await t.one('SELECT COALESCE(SUM(opening_qty * opening_rate), 0) AS v FROM acc_items WHERE active = 1')).v;
  await t.query("UPDATE acc_ledgers SET opening_balance = %s WHERE system_key = 'stock'", [money(total)]);
}

/** Moves per item, each with running qty / avg rate / value after the move. Returns { [itemId]: [...] }. */
export async function valuate(itemIds = null, toDate = null) {
  const where = [], params = [];
  if (itemIds !== null) {
    if (!itemIds.length) return {};
    where.push(`m.item_id IN (${marks(itemIds)})`);
    params.push(...itemIds);
  }
  if (toDate) { where.push('m.move_date <= %s'); params.push(toDate); }
  const rows = (await q(
    'SELECT m.*, d.doc_no, d.doc_type, d.party_name, i.purchase_price'
    + ' FROM acc_stock_moves m LEFT JOIN acc_docs d ON d.id = m.doc_id JOIN acc_items i ON i.id = m.item_id'
    + (where.length ? ` WHERE ${where.join(' AND ')}` : '')
    + " ORDER BY m.item_id, m.move_date, CASE m.kind WHEN 'opening' THEN 0 ELSE 1 END, m.id",
    params)).rows;
  const out = {};
  const state = {};
  for (const r of rows) {
    let [qty, value] = state[r.item_id] || [0, 0];
    const avg = qty > 0 ? value / qty : (r.rate || r.purchase_price || 0);
    const rate = r.fixed_rate ? r.rate : avg;
    qty = Math.round((qty + r.qty_in - r.qty_out) * 1000) / 1000;
    value = value + (r.qty_in - r.qty_out) * rate;
    if (qty <= 0) value = 0;
    state[r.item_id] = [qty, value];
    Object.assign(r, {
      move_rate: Math.round(rate * 10000) / 10000, bal_qty: qty, bal_value: money(value),
      avg_rate: qty > 0 ? Math.round((value / qty) * 10000) / 10000 : 0,
    });
    (out[r.item_id] ||= []).push(r);
  }
  return out;
}
