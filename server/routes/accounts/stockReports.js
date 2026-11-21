/* Stock summary / stock ledger (weighted average) and serial-number lookup.
 * Ports of routers/stock_reports.py and routers/serials.py. */
import { Router } from 'express';
import { q, one } from '../../services/accounts/accDb.js';
import { ah, bad, money } from '../../services/accounts/common.js';
import { bsStr, todayAd } from '../../services/accounts/nepaliDate.js';
import { valuate } from '../../services/accounts/stock.js';

const router = Router();
const KIND_NAME = { opening: 'Opening stock', purchase: 'Purchase', purchase_return: 'Purchase Return', sale: 'Sales', sales_return: 'Sales Return' };

// opening stock entered on the product counts as opening even on the first day
const isOpening = (m, dateFrom) => m.move_date < dateFrom || (m.kind === 'opening' && m.move_date <= dateFrom);

router.get('/reports/stock-summary', ah(async (req, res) => {
  const { date_from, date_to, category_id } = req.query;
  const hideZero = req.query.hide_zero === undefined ? true : (req.query.hide_zero === 'true' || req.query.hide_zero === '1');
  if (!date_from || !date_to) bad('Choose a date range.');
  const where = ['i.active = 1', "i.item_type = 'goods'"], params = [];
  if (category_id) { where.push('(i.category_id = %s OR c.parent_id = %s)'); params.push(+category_id, +category_id); }
  const items = (await q(
    'SELECT i.id, i.code, i.name, i.reorder_level, i.mrp, u.name AS unit, c.name AS category, pc.name AS parent_category'
    + ' FROM acc_items i JOIN acc_units u ON u.id = i.unit_id LEFT JOIN acc_item_categories c ON c.id = i.category_id'
    + ` LEFT JOIN acc_item_categories pc ON pc.id = c.parent_id WHERE ${where.join(' AND ')} ORDER BY i.name`, params)).rows;
  const moves = await valuate(items.map((i) => i.id), date_to);
  const out = [];
  for (const it of items) {
    const ms = moves[it.id] || [];
    const before = ms.filter((m) => isOpening(m, date_from)), during = ms.filter((m) => !isOpening(m, date_from));
    const oQty = before.length ? before[before.length - 1].bal_qty : 0, oVal = before.length ? before[before.length - 1].bal_value : 0;
    const cQty = ms.length ? ms[ms.length - 1].bal_qty : 0, cVal = ms.length ? ms[ms.length - 1].bal_value : 0;
    const inQ = Math.round(during.reduce((a, m) => a + m.qty_in, 0) * 1000) / 1000;
    const outQ = Math.round(during.reduce((a, m) => a + m.qty_out, 0) * 1000) / 1000;
    const inV = money(during.reduce((a, m) => a + m.qty_in * m.move_rate, 0));
    const outV = money(during.reduce((a, m) => a + m.qty_out * m.move_rate, 0));
    if (hideZero && !(oQty || inQ || outQ || cQty)) continue;
    out.push({
      ...it, category: [it.parent_category, it.category].filter(Boolean).join(' › '),
      opening_qty: oQty, opening_value: oVal, in_qty: inQ, in_value: inV, out_qty: outQ, out_value: outV,
      closing_qty: cQty, closing_value: cVal, avg_rate: cQty > 0 ? Math.round(cVal / cQty * 100) / 100 : 0,
      low: !!it.reorder_level && cQty <= it.reorder_level,
    });
  }
  const totals = Object.fromEntries(['opening_value', 'in_value', 'out_value', 'closing_value'].map((k) => [k, money(out.reduce((a, r) => a + r[k], 0))]));
  res.json({ rows: out, totals });
}));

router.get('/reports/stock-ledger', ah(async (req, res) => {
  const itemId = +req.query.item_id, { date_from, date_to } = req.query;
  const it = await one('SELECT i.*, u.name AS unit FROM acc_items i JOIN acc_units u ON u.id = i.unit_id WHERE i.id = %s', [itemId]) || bad('Product not found.', 404);
  const ms = (await valuate([itemId], date_to))[itemId] || [];
  const before = ms.filter((m) => isOpening(m, date_from));
  const rows = ms.filter((m) => !isOpening(m, date_from)).map((m) => ({
    date: m.move_date, date_bs: bsStr(m.move_date), doc_id: m.doc_id, doc_no: m.doc_no, doc_type: m.doc_type,
    particulars: m.party_name || KIND_NAME[m.kind], kind: KIND_NAME[m.kind], qty_in: m.qty_in, qty_out: m.qty_out,
    rate: Math.round(m.move_rate * 100) / 100, value: money((m.qty_in - m.qty_out) * m.move_rate),
    bal_qty: m.bal_qty, avg_rate: Math.round(m.avg_rate * 100) / 100, bal_value: m.bal_value,
  }));
  res.json({
    item: it,
    opening: { qty: before.length ? before[before.length - 1].bal_qty : 0, value: before.length ? before[before.length - 1].bal_value : 0 },
    rows,
    total_in: Math.round(rows.reduce((a, r) => a + r.qty_in, 0) * 1000) / 1000,
    total_out: Math.round(rows.reduce((a, r) => a + r.qty_out, 0) * 1000) / 1000,
    closing: { qty: ms.length ? ms[ms.length - 1].bal_qty : 0, value: ms.length ? ms[ms.length - 1].bal_value : 0 },
  });
}));

router.get('/serials', ah(async (req, res) => {
  const status = req.query.status === undefined ? 'in_stock' : req.query.status;
  let sql = 'SELECT id, serial_no, status, warranty_until FROM acc_serials WHERE item_id = %s';
  const params = [+req.query.item_id];
  if (status) { sql += ' AND status = %s'; params.push(status); }
  res.json((await q(`${sql} ORDER BY serial_no`, params)).rows);
}));

router.get('/serials/lookup', ah(async (req, res) => {
  const text = String(req.query.q || '').trim();
  if (text.length < 2) return res.json([]);
  const rows = (await q(
    'SELECT s.*, i.name AS item, i.code FROM acc_serials s JOIN acc_items i ON i.id = s.item_id WHERE s.serial_no ILIKE %s ORDER BY s.serial_no LIMIT 50', [`%${text}%`])).rows;
  const today = todayAd();
  for (const r of rows) {
    r.history = (await q(
      'SELECT d.id AS doc_id, d.doc_no, d.doc_type, d.doc_date, d.party_name, d.status FROM acc_line_serials ls'
      + ' JOIN acc_doc_lines l ON l.id = ls.line_id JOIN acc_docs d ON d.id = l.doc_id WHERE ls.serial_id = %s ORDER BY d.doc_date, d.id', [r.id])).rows;
    for (const h of r.history) h.doc_date_bs = bsStr(h.doc_date);
    r.warranty_status = !r.warranty_until ? null : r.warranty_until >= today ? 'in warranty' : 'expired';
  }
  res.json(rows);
}));

export default router;
