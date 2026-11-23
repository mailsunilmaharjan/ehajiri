/* Import Purchases: PI → payment → shipping documents → "Goods Arrived in Godown".
 * Modelled on order.zkattendance.com's Import Purchases (LicenseAdmin/server/routes/importPurchases.js).
 *
 * An import is only a tracking record until the goods arrive. NOTHING reaches the purchase books or stock before that.
 * "Goods Arrived" is refused until the shipping documents are complete — CI no., Packing List no., Customs document no.
 * AND the Commercial Invoice and Packing List files — and then posts ONE normal Purchase (PB) document:
 *      Dr Purchase  Cr Supplier   (product value in NPR = foreign amount × bank exchange rate; no VAT — customs VAT is not supplier VAT)
 * and brings the goods into stock at their LANDED cost (product value + import expenses shared by value).
 * The expenses themselves are not posted again: they are paid / booked through normal vouchers.
 */
import { Router } from 'express';
import { q, one, tx } from '../../services/accounts/accDb.js';
import { ah, bad, audit, money, nz, dnz, num, int, userOf } from '../../services/accounts/common.js';
import { saveImage, removeImage, serveImage } from '../../services/accounts/files.js';
import { postDoc, getDoc } from './docs.js';

const router = Router();

export const EXPENSE_TYPES = ['Bank Expenses', 'Customs Expenses', 'Logistic Expenses', 'Agent Expenses', 'Transportation Expenses', 'Labour Expenses'];
const CURRENCIES = ['USD', 'EUR', 'CNY', 'INR', 'GBP', 'NPR'];
const PAY_MODES = ['TT', 'LC', 'Advance', 'Credit', 'Other'];
const PAY_STATUS = ['Pending', 'TT Completed', 'Partly Paid', 'Paid', 'Cancelled'];
/** file slots on an import → label (used in the "what is missing" messages) */
const SLOTS = { pi: 'Proforma Invoice', payment_proof: 'Payment proof', commercial_invoice: 'Commercial Invoice', packing_list: 'Packing List', customs: 'Customs document', bank_docs: 'Bank (Bipini) document' };

const parseFiles = (s) => {
  let f = {};
  try { f = JSON.parse(s || '{}') || {}; } catch { f = {}; }
  for (const k of Object.keys(SLOTS)) f[k] = Array.isArray(f[k]) ? f[k] : [];
  return f;
};

/** Landed-cost sheet: product value in NPR, expenses shared by value, cost per unit, optional MRP from the multiplier. */
export function costing(p, items, expenses) {
  const rate = p.currency === 'NPR' ? 1 : num(p.exchange_rate);   // 0 = not entered yet (Payment tab)
  const exp = money(expenses.reduce((s, e) => s + num(e.amount), 0));
  const rows = items.map((it) => ({ ...it, npr: money(num(it.total) * rate) }));
  const prod = money(rows.reduce((s, r) => s + r.npr, 0));
  for (const r of rows) {
    r.share = prod ? money(exp * r.npr / prod) : 0;
    r.landed = money(r.npr + r.share);
    r.cost_unit = num(r.qty) ? Math.round(r.landed / num(r.qty) * 100) / 100 : 0;
    r.mrp = p.mrp_multiplier ? Math.round(r.cost_unit * num(p.mrp_multiplier) * 100) / 100 : null;
  }
  return { rate, products_npr: prod, expenses_npr: exp, landed_total: money(prod + exp), rows };
}

/** What still blocks "Goods Arrived". Empty list = ready. */
function missingFor(p, items, files) {
  const m = [];
  if (!p.supplier_id) m.push('Choose the supplier (Import From) from your Suppliers list');
  if (!items.length) m.push('Add at least one product');
  const unmapped = items.filter((i) => !i.item_id).map((i) => i.product_name);
  if (unmapped.length) m.push(`Pick the Accounts product for: ${unmapped.join(', ')}`);
  if (p.currency !== 'NPR' && num(p.exchange_rate) <= 0) m.push('Enter the bank exchange rate (Payment tab)');
  if (!nz(p.ci_no)) m.push('Enter the Commercial Invoice (CI) No.');
  if (!files.commercial_invoice.length) m.push('Upload the Commercial Invoice file');
  if (!nz(p.packing_list_no)) m.push('Enter the Packing List No.');
  if (!files.packing_list.length) m.push('Upload the Packing List file');
  if (!nz(p.customs_doc_no)) m.push('Enter the Customs Document No.');
  return m;
}

const BASE_SQL = 'SELECT p.*, s.name AS supplier_name, d.doc_no AS pb_doc_no, d.status AS pb_status'
  + ' FROM acc_import_purchases p LEFT JOIN acc_ledgers s ON s.id = p.supplier_id LEFT JOIN acc_docs d ON d.id = p.pb_doc_id';

async function full(id, run = { query: q, one }) {
  const p = await run.one(`${BASE_SQL} WHERE p.id = %s`, [id]);
  if (!p) return null;
  return shape(p, run);
}
async function shape(p, run = { query: q, one }) {
  p.items = (await run.query(
    'SELECT i.*, a.code, a.track_serial FROM acc_import_items i LEFT JOIN acc_items a ON a.id = i.item_id WHERE i.import_id = %s ORDER BY i.sort, i.id', [p.id])).rows;
  p.expenses = (await run.query('SELECT * FROM acc_import_expenses WHERE import_id = %s ORDER BY sort, id', [p.id])).rows;
  p.files = parseFiles(p.files);
  p.arrived = !!p.pb_doc_id && p.pb_status === 'posted';
  p.costing = costing(p, p.items, p.expenses);
  p.total_tt_npr = money(num(p.grand_total) * p.costing.rate);
  p.missing = p.arrived ? [] : missingFor(p, p.items, p.files);
  return p;
}

function cleanItems(raw) {
  if (!Array.isArray(raw) || !raw.length) bad('Add at least one product.');
  return raw.map((r, i) => {
    const name = String(r.product_name || '').trim();
    if (!name) bad(`Row ${i + 1}: choose the product.`);
    const qty = num(r.qty), rate = num(r.rate);
    if (qty <= 0) bad(`${name}: quantity must be more than 0.`);
    if (rate < 0) bad(`${name}: rate can't be negative.`);
    return { item_id: r.item_id ? +r.item_id : null, product_name: name, hs_code: nz(r.hs_code), rate, qty, total: money(qty * rate), remarks: nz(r.remarks) };
  });
}

async function header(b, existingId = 0) {
  const pi = String(b.pi_no || '').trim();
  if (!pi) bad('PI No is required.');
  if (await one('SELECT id FROM acc_import_purchases WHERE LOWER(pi_no) = LOWER(%s) AND id <> %s', [pi, existingId])) bad(`PI No ${pi} already exists.`);
  const currency = CURRENCIES.includes(b.currency) ? b.currency : 'USD';
  const rate = currency === 'NPR' ? 1 : Math.max(0, num(b.exchange_rate));   // optional here — entered on the Payment tab
  let supplier = null;
  if (b.supplier_id) {
    supplier = await one("SELECT id, name FROM acc_ledgers WHERE id = %s AND party_type = 'supplier'", [+b.supplier_id]) || bad('Choose a supplier from the Suppliers list.');
  }
  return { pi, currency, rate, supplier };
}

/* ─────────────── read ─────────────── */
router.get('/imports', ah(async (_req, res) => {
  const rows = (await q(`${BASE_SQL} ORDER BY p.pi_date DESC NULLS LAST, p.id DESC`)).rows;
  for (const r of rows) await shape(r);
  res.json(rows);
}));

router.get('/imports/file/:name', ah(async (req, res) => { await serveImage(res, 'imports', req.params.name); }));

router.get('/imports/:id', ah(async (req, res) => res.json(await full(+req.params.id) || bad('Import purchase not found.', 404))));

/* ─────────────── create / edit ─────────────── */
async function saveBody(t, id, b, user) {
  const { pi, currency, rate, supplier } = await header(b, id || 0);
  const items = cleanItems(b.items);
  const grand = money(items.reduce((s, i) => s + i.total, 0));
  const vals = [pi, dnz(b.pi_date), supplier ? supplier.id : null, supplier ? supplier.name : nz(b.import_from), nz(b.country),
    PAY_MODES.includes(b.payment_mode) ? b.payment_mode : 'TT', nz(b.payment_mode_other),
    PAY_STATUS.includes(b.payment_status) ? b.payment_status : 'Pending', dnz(b.payment_completed_date),
    currency, rate, grand];
  if (id) {
    // payment mode / status / date / exchange rate belong to the Payment tab (PATCH …/panel) — saving the detail tab must not overwrite them
    await t.query('UPDATE acc_import_purchases SET pi_no=%s, pi_date=%s, supplier_id=%s, import_from=%s, country=%s, currency=%s, grand_total=%s, updated_by=%s, updated_at=NOW() WHERE id=%s',
      [pi, dnz(b.pi_date), supplier ? supplier.id : null, supplier ? supplier.name : nz(b.import_from), nz(b.country), currency, grand, user, id]);
    await t.query('UPDATE acc_import_purchases SET payment_mode=%s, payment_condition=%s, custom_via=%s WHERE id=%s',
      [PAY_MODES.includes(b.payment_mode) ? b.payment_mode : 'TT', nz(b.payment_condition), nz(b.custom_via), id]);
    await t.query('DELETE FROM acc_import_items WHERE import_id = %s', [id]);
  } else {
    id = (await t.one('INSERT INTO acc_import_purchases (pi_no, pi_date, supplier_id, import_from, country, payment_mode, payment_mode_other, payment_status,'
      + ' payment_completed_date, currency, exchange_rate, grand_total, created_by) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id', [...vals, user])).id;
    await t.query('UPDATE acc_import_purchases SET payment_condition=%s, custom_via=%s WHERE id=%s', [nz(b.payment_condition), nz(b.custom_via), id]);
  }
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    await t.query('INSERT INTO acc_import_items (import_id, item_id, product_name, hs_code, rate, qty, total, sort, remarks) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)',
      [id, it.item_id, it.product_name, it.hs_code, it.rate, it.qty, it.total, i, it.remarks]);
  }
  return { id, pi, grand };
}

async function mustBeOpen(id) {
  const p = await one(`${BASE_SQL} WHERE p.id = %s`, [id]) || bad('Import purchase not found.', 404);
  if (p.pb_doc_id && p.pb_status === 'posted') bad(`Goods have already arrived (Purchase ${p.pb_doc_no}). Cancel that purchase first to change this import.`);
  return p;
}

router.post('/imports', ah(async (req, res) => {
  const user = userOf(req);
  const id = await tx(async (t) => {
    const r = await saveBody(t, 0, req.body || {}, user);
    await audit(t, user, 'create', 'import_purchase', r.id, { pi_no: r.pi, total: r.grand });
    return r.id;
  });
  res.json(await full(id));
}));

router.put('/imports/:id', ah(async (req, res) => {
  const id = +req.params.id, user = userOf(req);
  await mustBeOpen(id);
  await tx(async (t) => {
    const r = await saveBody(t, id, req.body || {}, user);
    await audit(t, user, 'update', 'import_purchase', id, { pi_no: r.pi, total: r.grand });
  });
  res.json(await full(id));
}));

router.put('/imports/:id/expenses', ah(async (req, res) => {
  const id = +req.params.id, user = userOf(req);
  await mustBeOpen(id);
  const list = (Array.isArray(req.body?.expenses) ? req.body.expenses : [])
    .map((e) => ({ type: EXPENSE_TYPES.includes(e.expense_type) ? e.expense_type : 'Bank Expenses', title: String(e.title || '').trim(), amount: money(e.amount) }))
    .filter((e) => e.title || e.amount);
  for (const e of list) if (!e.title) bad('Every expense needs a title.');
  await tx(async (t) => {
    await t.query('DELETE FROM acc_import_expenses WHERE import_id = %s', [id]);
    for (let i = 0; i < list.length; i++) {
      await t.query('INSERT INTO acc_import_expenses (import_id, expense_type, title, amount, sort) VALUES (%s,%s,%s,%s,%s)', [id, list[i].type, list[i].title, list[i].amount, i]);
    }
    await t.query('UPDATE acc_import_purchases SET updated_by=%s, updated_at=NOW() WHERE id=%s', [user, id]);
    await audit(t, user, 'update', 'import_purchase', id, { expenses: list.length, total: money(list.reduce((s, e) => s + e.amount, 0)) });
  });
  res.json(await full(id));
}));

/** Side-panel fields (payment status, shipping document numbers, dates). Allowed after arrival too, except the amounts they drive. */
router.patch('/imports/:id/panel', ah(async (req, res) => {
  const id = +req.params.id, user = userOf(req), b = req.body || {};
  await one('SELECT id FROM acc_import_purchases WHERE id = %s', [id]) || bad('Import purchase not found.', 404);
  const sets = [], vals = [];
  const put = (col, v) => { sets.push(`${col} = %s`); vals.push(v); };
  if ('payment_mode' in b) put('payment_mode', PAY_MODES.includes(b.payment_mode) ? b.payment_mode : 'TT');
  if ('exchange_rate' in b || 'currency' in b) {
    const cur = await one('SELECT pi_no, currency, exchange_rate, pb_doc_id FROM acc_import_purchases WHERE id = %s', [id]);
    if (cur.pb_doc_id) bad('Goods have already arrived — the exchange rate is locked. Cancel the Purchase first to change it.');
    if ('exchange_rate' in b) put('exchange_rate', cur.currency === 'NPR' ? 1 : Math.max(0, num(b.exchange_rate)));
  }
  if ('payment_status' in b) put('payment_status', PAY_STATUS.includes(b.payment_status) ? b.payment_status : 'Pending');
  for (const c of ['payment_completed_date', 'est_ready_date', 'ci_date', 'customs_doc_date']) if (c in b) put(c, dnz(b[c]));
  for (const c of ['ci_no', 'packing_list_no', 'customs_doc_no']) if (c in b) put(c, nz(b[c]));
  if ('mrp_multiplier' in b) { const m = num(b.mrp_multiplier); put('mrp_multiplier', m > 0 ? m : null); }
  if (sets.length) {
    await tx(async (t) => {
      await t.query(`UPDATE acc_import_purchases SET ${sets.join(', ')}, updated_by = %s, updated_at = NOW() WHERE id = %s`, [...vals, user, id]);
      await audit(t, user, 'update', 'import_purchase', id, { fields: Object.keys(b) });
    });
  }
  res.json(await full(id));
}));

router.delete('/imports/:id', ah(async (req, res) => {
  const id = +req.params.id, user = userOf(req);
  const p = await mustBeOpen(id);
  const files = parseFiles(p.files);
  await tx(async (t) => {
    await t.query('DELETE FROM acc_import_purchases WHERE id = %s', [id]);
    await audit(t, user, 'delete', 'import_purchase', id, { pi_no: p.pi_no, total: p.grand_total });
  });
  for (const k of Object.keys(files)) for (const f of files[k]) await removeImage('imports', f.file);
  res.json({ ok: true });
}));

/* ─────────────── documents (PI, payment proof, CI, packing list, customs, bank) ─────────────── */
router.post('/imports/:id/files', ah(async (req, res) => {
  const id = +req.params.id, user = userOf(req), b = req.body || {};
  if (!SLOTS[b.slot]) bad('Unknown document type.');
  const p = await one('SELECT id, files FROM acc_import_purchases WHERE id = %s', [id]) || bad('Import purchase not found.', 404);
  const file = await saveImage('imports', `imp${id}-${b.slot}`, b.data, 8, true);
  const files = parseFiles(p.files);
  files[b.slot].push({ file, name: String(b.name || file).slice(0, 120) });
  await tx(async (t) => {
    await t.query('UPDATE acc_import_purchases SET files = %s, updated_by = %s, updated_at = NOW() WHERE id = %s', [JSON.stringify(files), user, id]);
    await audit(t, user, 'upload', 'import_purchase', id, { slot: b.slot, name: b.name });
  });
  res.json(await full(id));
}));

router.delete('/imports/:id/files/:slot/:file', ah(async (req, res) => {
  const id = +req.params.id, user = userOf(req), { slot, file } = req.params;
  if (!SLOTS[slot]) bad('Unknown document type.');
  const p = await one('SELECT id, files FROM acc_import_purchases WHERE id = %s', [id]) || bad('Import purchase not found.', 404);
  const files = parseFiles(p.files);
  files[slot] = files[slot].filter((f) => f.file !== file);
  await tx(async (t) => {
    await t.query('UPDATE acc_import_purchases SET files = %s, updated_by = %s, updated_at = NOW() WHERE id = %s', [JSON.stringify(files), user, id]);
    await audit(t, user, 'remove_file', 'import_purchase', id, { slot });
  });
  await removeImage('imports', file);
  res.json(await full(id));
}));

/* ─────────────── Goods Arrived in Godown ─────────────── */
router.post('/imports/:id/arrive', ah(async (req, res) => {
  const id = +req.params.id, user = userOf(req), b = req.body || {};
  const arrival = dnz(b.arrival_date) || bad('Choose the date the goods arrived.');
  const did = await tx(async (t) => {
    const raw = await t.one('SELECT id FROM acc_import_purchases WHERE id = %s FOR UPDATE', [id]) || bad('Import purchase not found.', 404);
    const p = await full(raw.id, t);
    if (p.arrived) bad(`Goods already arrived — Purchase ${p.pb_doc_no} was posted.`);
    if (p.missing.length) bad(`Can't mark goods arrived yet:\n• ${p.missing.join('\n• ')}`);

    const serials = b.serials || {};
    const cs = p.costing;
    const lines = p.items.map((it) => ({
      item_id: it.item_id, qty: it.qty, rate: num(it.rate) * cs.rate,
      serials: it.track_serial ? (Array.isArray(serials[it.id]) ? serials[it.id] : String(serials[it.id] || '').split(/[\n,]+/)).map((s) => String(s).trim()).filter(Boolean) : [],
    }));
    const paid = b.bank_account_id ? +b.bank_account_id : null;
    const narr = `Import ${p.pi_no} · CI ${p.ci_no} · Packing List ${p.packing_list_no} · Customs ${p.customs_doc_no}`
      + ` — ${p.currency === 'NPR' ? '' : `${p.currency} ${num(p.grand_total).toLocaleString('en-IN')} × ${cs.rate} `}goods received in godown`;
    const doc = {
      doc_type: 'PB', doc_date: arrival, party_id: p.supplier_id, vat_bill: false,
      payment_mode: paid ? 'bank' : 'credit', cash_account_id: paid, txn_id: paid ? (nz(b.txn_id) || `TT ${p.pi_no}`) : null,
      supplier_bill_no: p.ci_no, supplier_bill_date: p.ci_date || p.pi_date, challan_no: p.packing_list_no,
      narration: narr, lines,
    };
    const pb = await postDoc(t, doc, user);

    // stock at LANDED cost: product value + expenses shared by value, per unit (the PB itself carries the product value only)
    const perItem = {};
    for (const r of cs.rows) { const k = r.item_id; perItem[k] = perItem[k] || { qty: 0, landed: 0 }; perItem[k].qty += num(r.qty); perItem[k].landed += r.landed; }
    for (const [itemId, v] of Object.entries(perItem)) {
      const unit = v.qty ? Math.round(v.landed / v.qty * 10000) / 10000 : 0;
      await t.query("UPDATE acc_stock_moves SET rate = %s WHERE doc_id = %s AND item_id = %s AND kind = 'purchase'", [unit, pb, +itemId]);
      await t.query('UPDATE acc_items SET purchase_price = %s WHERE id = %s', [money(unit), +itemId]);
    }
    await t.query("UPDATE acc_import_purchases SET status='arrived', pb_doc_id=%s, arrival_date=%s, arrived_at=NOW(), arrived_by=%s, updated_by=%s, updated_at=NOW() WHERE id=%s",
      [pb, arrival, user, user, id]);
    const d = await t.one('SELECT doc_no, total FROM acc_docs WHERE id = %s', [pb]);
    await audit(t, user, 'arrived', 'import_purchase', id, { pi_no: p.pi_no, purchase: d.doc_no, total: d.total, landed_total: cs.landed_total });
    return pb;
  });
  res.json({ import: await full(id), purchase: await getDoc(did) });
}));

export default router;
