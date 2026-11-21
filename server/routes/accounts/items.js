/* Products: units, categories / sub-categories, goods & services, MRP / dealer / partner prices,
 * warranty, service period and serial-number tracking. Port of routers/items.py. */
import { Router } from 'express';
import { q, one, tx } from '../../services/accounts/accDb.js';
import { ah, bad, audit, money, nz, flag, num, int, userOf } from '../../services/accounts/common.js';
import { syncOpening } from '../../services/accounts/stock.js';
import { saveImage, removeImage, serveImage } from '../../services/accounts/files.js';

const router = Router();

export function cleanSerials(raw) {
  const out = [], seen = new Set();
  for (const s0 of raw || []) {
    const s = String(s0).trim();
    if (s && !seen.has(s.toUpperCase())) { seen.add(s.toUpperCase()); out.push(s); }
  }
  return out;
}

router.get('/units', ah(async (_req, res) => res.json((await q('SELECT * FROM acc_units ORDER BY name')).rows)));

router.post('/units', ah(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) bad('Unit name is required.');
  if (await one('SELECT id FROM acc_units WHERE LOWER(name) = LOWER(%s)', [name])) bad('Unit already exists.');
  const row = await tx(async (t) => {
    const r = await t.one('INSERT INTO acc_units (name) VALUES (%s) RETURNING *', [name]);
    await audit(t, userOf(req), 'create', 'unit', r.id, { name });
    return r;
  });
  res.json(row);
}));

router.get('/categories', ah(async (_req, res) => res.json((await q(
  'SELECT c.*, (SELECT COUNT(*) FROM acc_items i WHERE i.category_id = c.id) AS items FROM acc_item_categories c ORDER BY c.rank ASC NULLS LAST, c.name')).rows)));

/** Ranking Order: blank = unranked (listed last), otherwise a whole number 1..9999. */
function rankOf(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 9999) bad('Ranking Order must be a whole number from 1 to 9999.');
  return n;
}

/** Extra fields of a MAIN category: HS code, effective date (YYYY-MM-DD), remarks, ranking order. */
function catExtra(b) {
  const date = String(b.effective_date || '').trim();
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) bad('Effective Date must be a valid date.');
  return [nz(b.hs_code), date || null, nz(b.remarks), rankOf(b.rank)];
}

async function checkCat(b, exclude = 0) {
  const name = String(b.name || '').trim();
  if (!name) bad('Name is required.');
  if (b.parent_id) {
    const p = await one('SELECT * FROM acc_item_categories WHERE id = %s', [b.parent_id]);
    if (!p || p.parent_id) bad('Sub-categories go under a main category (two levels only).');
  }
  if (await one('SELECT id FROM acc_item_categories WHERE LOWER(name) = LOWER(%s) AND COALESCE(parent_id, 0) = %s AND id <> %s', [name, b.parent_id || 0, exclude])) bad('That name already exists here.');
  return name;
}

router.post('/categories', ah(async (req, res) => {
  const b = req.body || {};
  const name = await checkCat(b);
  const row = await tx(async (t) => {
    const x = b.parent_id ? [null, null, null, null] : catExtra(b);
    const r = await t.one('INSERT INTO acc_item_categories (name, parent_id, hs_code, effective_date, remarks, rank) VALUES (%s, %s, %s, %s, %s, %s) RETURNING *', [name, b.parent_id || null, ...x]);
    await audit(t, userOf(req), 'create', 'category', r.id, b);
    return r;
  });
  res.json(row);
}));

router.put('/categories/:cid', ah(async (req, res) => {
  const cid = +req.params.cid;
  const cur = await one('SELECT * FROM acc_item_categories WHERE id = %s', [cid]) || bad('Category not found.', 404);
  const b = { ...req.body, parent_id: cur.parent_id };
  const name = await checkCat(b, cid);
  await tx(async (t) => {
    const x = cur.parent_id ? [null, null, null, null] : catExtra(b);
    await t.query('UPDATE acc_item_categories SET name = %s, hs_code = %s, effective_date = %s, remarks = %s, rank = %s WHERE id = %s', [name, ...x, cid]);
    await audit(t, userOf(req), 'update', 'category', cid, { name: [cur.name, name], rank: [cur.rank, b.rank] });
  });
  res.json({ ok: true });
}));

router.delete('/categories/:cid', ah(async (req, res) => {
  const cid = +req.params.cid;
  if (await one('SELECT 1 AS x FROM acc_items WHERE category_id = %s', [cid])) bad('Products use this category. Move them first.');
  if (await one('SELECT 1 AS x FROM acc_item_categories WHERE parent_id = %s', [cid])) bad('Delete its sub-categories first.');
  await tx(async (t) => {
    await t.query('DELETE FROM acc_item_categories WHERE id = %s', [cid]);
    await audit(t, userOf(req), 'delete', 'category', cid);
  });
  res.json({ ok: true });
}));

const ITEM_SQL = 'SELECT i.*, u.name AS unit, c.name AS category, pc.name AS parent_category, pc.id AS parent_category_id, COALESCE(pc.rank, c.rank) AS category_rank,'
  + ' COALESCE((SELECT SUM(qty_in - qty_out) FROM acc_stock_moves m WHERE m.item_id = i.id), 0) AS stock,'
  + " (SELECT COUNT(*) FROM acc_serials s WHERE s.item_id = i.id AND s.status = 'in_stock') AS serials_in_stock"
  + ' FROM acc_items i JOIN acc_units u ON u.id = i.unit_id'
  + ' LEFT JOIN acc_item_categories c ON c.id = i.category_id LEFT JOIN acc_item_categories pc ON pc.id = c.parent_id';

function parseItem(r) {
  try { r.specs = r.specs ? JSON.parse(r.specs) : []; } catch { r.specs = []; }
  r.has_image = !!r.image_file;
  return r;
}

router.get('/items', ah(async (req, res) => {
  const inc = req.query.include_inactive === 'true' || req.query.include_inactive === '1';
  const rows = (await q(`${ITEM_SQL}${inc ? '' : ' WHERE i.active = 1'} ORDER BY COALESCE(pc.rank, c.rank) ASC NULLS LAST, COALESCE(pc.name, c.name) ASC NULLS LAST, i.rank ASC NULLS LAST, i.name ASC`)).rows;
  for (const r of rows) { r.stock = Math.round(r.stock * 1000) / 1000; parseItem(r); }
  res.json(rows);
}));

// ── Dealer Rate Setting: one % for a whole category (or all products) ──
router.post('/items/rates', ah(async (req, res) => {
  const b = req.body || {};
  for (const [label, pct] of [['Dealer', b.dealer_pct], ['Partner', b.partner_pct]]) {
    if (pct !== undefined && pct !== null && !(pct >= 0 && pct < 100)) bad(`${label} % must be between 0 and 100.`);
  }
  if (b.vat_type && !['inclusive', 'exclusive'].includes(b.vat_type)) bad('VAT type must be Inclusive or Exclusive.');
  const where = ['i.mrp > 0'], params = [];
  if (b.category_id) {
    where.push('(i.category_id = %s OR i.category_id IN (SELECT id FROM acc_item_categories WHERE parent_id = %s))');
    params.push(b.category_id, b.category_id);
  }
  const rows = (await q(`SELECT i.* FROM acc_items i WHERE ${where.join(' AND ')}`, params)).rows;
  const user = userOf(req);
  await tx(async (t) => {
    for (const r of rows) {
      const dp = b.dealer_pct ?? r.dealer_pct, pp = b.partner_pct ?? r.partner_pct;
      await t.query(
        'UPDATE acc_items SET dealer_pct=%s, partner_pct=%s, dealer_price=%s, partner_price=%s, vat_type=%s, rate_updated_at=NOW(), rate_updated_by=%s WHERE id=%s',
        [dp, pp, dp ? money(r.mrp * (1 - dp / 100)) : r.dealer_price, pp ? money(r.mrp * (1 - pp / 100)) : r.partner_price, b.vat_type || r.vat_type, user, r.id]);
    }
    await audit(t, user, 'rate_setting', 'item', null, { ...b, products: rows.length });
  });
  res.json({ updated: rows.length });
}));

router.get('/items/:iid', ah(async (req, res) => {
  const iid = +req.params.iid;
  const r = await one(`${ITEM_SQL} WHERE i.id = %s`, [iid]) || bad('Product not found.', 404);
  parseItem(r);
  r.opening_serials = (await q("SELECT serial_no FROM acc_serials WHERE item_id = %s AND in_doc_id IS NULL AND status <> 'cancelled' ORDER BY id", [iid])).rows.map((s) => s.serial_no);
  res.json(r);
}));

// ── product photo (stored in the tenant DB, served only to signed-in users) ──
router.post('/items/:iid/image', ah(async (req, res) => {
  const iid = +req.params.iid;
  const cur = await one('SELECT * FROM acc_items WHERE id = %s', [iid]) || bad('Product not found.', 404);
  const name = await saveImage('items', String(iid), req.body?.data_url, 3);
  await removeImage('items', cur.image_file);
  await tx(async (t) => {
    await t.query('UPDATE acc_items SET image_file = %s, updated_by = %s, updated_at = NOW() WHERE id = %s', [name, userOf(req), iid]);
    await audit(t, userOf(req), 'update', 'item', iid, { image: 'uploaded' });
  });
  res.json({ ok: true });
}));
router.get('/items/:iid/image', ah(async (req, res) => {
  const r = await one('SELECT image_file FROM acc_items WHERE id = %s', [+req.params.iid]);
  await serveImage(res, 'items', r?.image_file);
}));
router.delete('/items/:iid/image', ah(async (req, res) => {
  const iid = +req.params.iid;
  const r = await one('SELECT image_file FROM acc_items WHERE id = %s', [iid]) || bad('Product not found.', 404);
  await removeImage('items', r.image_file);
  await tx(async (t) => {
    await t.query('UPDATE acc_items SET image_file = NULL WHERE id = %s', [iid]);
    await audit(t, userOf(req), 'update', 'item', iid, { image: 'removed' });
  });
  res.json({ ok: true });
}));

async function checkItem(b, exclude = 0) {
  b.name = String(b.name || '');
  if (!b.name.trim()) bad('Product name is required.');
  b.item_type = b.item_type || 'goods';
  if (!['goods', 'service'].includes(b.item_type)) bad('Type must be Goods or Service.');
  b.service_months = int(b.service_months); b.warranty_months = int(b.warranty_months);
  b.track_serial = flag(b.track_serial); b.vat_applicable = b.vat_applicable === undefined ? 1 : flag(b.vat_applicable);
  for (const k of ['purchase_price', 'mrp', 'dealer_price', 'partner_price', 'dealer_pct', 'partner_pct', 'reorder_level', 'opening_qty', 'opening_rate']) b[k] = num(b[k]);
  if (b.item_type === 'service') {
    Object.assign(b, { track_serial: 0, opening_qty: 0, opening_rate: 0, reorder_level: 0, opening_serials: [] });
    if (!(b.service_months >= 0 && b.service_months <= 120)) bad('Service period must be 0–120 months.');
  }
  if (!(b.warranty_months >= 0 && b.warranty_months <= 240)) bad('Warranty must be 0–240 months.');
  b.vat_type = b.vat_type || 'inclusive';
  if (!['inclusive', 'exclusive'].includes(b.vat_type)) bad('VAT type must be Inclusive or Exclusive.');
  if (b.website && !/^https?:\/\//.test(String(b.website).trim())) b.website = `https://${String(b.website).trim()}`;
  b.specs = (b.specs || []).filter((p) => String(p?.[0] ?? '').trim()).slice(0, 60).map(([k, v]) => [String(k).trim().slice(0, 80), String(v ?? '').trim().slice(0, 300)]);
  for (const [label, pct] of [['Dealer', b.dealer_pct], ['Partner', b.partner_pct]]) {
    if (!(pct >= 0 && pct < 100)) bad(`${label} % must be between 0 and 100.`);
    if (pct && !b.mrp) bad(`${label} % is taken off MRP, so enter the MRP first.`);
  }
  if (b.dealer_pct) b.dealer_price = money(b.mrp * (1 - b.dealer_pct / 100));
  if (b.partner_pct) b.partner_price = money(b.mrp * (1 - b.partner_pct / 100));
  if (!(await one('SELECT id FROM acc_units WHERE id = %s', [b.unit_id]))) bad('Choose a unit.');
  if (b.category_id && !(await one('SELECT id FROM acc_item_categories WHERE id = %s', [b.category_id]))) bad('Category not found.');
  if (Math.min(b.purchase_price, b.mrp, b.dealer_price, b.partner_price, b.opening_qty, b.opening_rate) < 0) bad("Prices and quantities can't be negative.");
  if (await one('SELECT id FROM acc_items WHERE LOWER(name) = LOWER(%s) AND id <> %s', [b.name.trim(), exclude])) bad('A product with this name already exists.');
  if (b.code && await one('SELECT id FROM acc_items WHERE code = %s AND id <> %s', [String(b.code).trim(), exclude])) bad('Product code already used.');
  if (b.barcode && await one('SELECT id FROM acc_items WHERE barcode = %s AND id <> %s', [String(b.barcode).trim(), exclude])) bad('Barcode already used by another product.');
  if (b.track_serial) {
    b.opening_serials = cleanSerials(b.opening_serials);
    if (b.opening_qty !== Math.trunc(b.opening_qty)) bad('Serial-tracked products need whole-number quantities.');
    if (b.opening_serials.length !== Math.trunc(b.opening_qty)) bad(`Opening quantity is ${b.opening_qty}, so enter exactly ${Math.trunc(b.opening_qty)} opening serial numbers (${b.opening_serials.length} given).`);
  }
}

const COLS = ['name', 'name_np', 'category_id', 'unit_id', 'barcode', 'hs_code', 'vat_applicable', 'purchase_price', 'mrp', 'dealer_price',
  'partner_price', 'reorder_level', 'opening_qty', 'opening_rate', 'active', 'item_type', 'service_months', 'warranty_months', 'track_serial',
  'dealer_pct', 'partner_pct', 'vat_type', 'website', 'features', 'specs', 'rank'];
const RATE_KEYS = ['mrp', 'dealer_price', 'partner_price', 'dealer_pct', 'partner_pct', 'vat_type'];

const itemValues = (b) => [
  b.name.trim(), nz(b.name_np), b.category_id || null, b.unit_id, nz(b.barcode), nz(b.hs_code),
  b.vat_applicable, money(b.purchase_price), money(b.mrp), money(b.dealer_price), money(b.partner_price), b.reorder_level,
  Math.round(b.opening_qty * 1000) / 1000, money(b.opening_rate), b.active === false ? 0 : 1,
  b.item_type, b.item_type === 'service' ? b.service_months : 0, b.warranty_months, b.track_serial,
  Math.round(b.dealer_pct * 100) / 100, Math.round(b.partner_pct * 100) / 100, b.vat_type, nz(b.website),
  nz(b.features), b.specs && b.specs.length ? JSON.stringify(b.specs) : null, rankOf(b.rank),
];

async function syncOpeningSerials(t, iid, serials) {
  const current = {};
  for (const r of (await t.query("SELECT * FROM acc_serials WHERE item_id = %s AND in_doc_id IS NULL AND status <> 'cancelled'", [iid])).rows) current[r.serial_no.toUpperCase()] = r;
  const wanted = {};
  for (const s of serials) wanted[s.toUpperCase()] = s;
  for (const [key, r] of Object.entries(current)) {
    if (key in wanted) continue;
    if (r.status !== 'in_stock') bad(`Opening serial ${r.serial_no} was already sold and can't be removed.`);
    if (await t.one('SELECT 1 AS x FROM acc_line_serials WHERE serial_id = %s', [r.id])) await t.query("UPDATE acc_serials SET status = 'cancelled' WHERE id = %s", [r.id]);
    else await t.query('DELETE FROM acc_serials WHERE id = %s', [r.id]);
  }
  for (const [key, s] of Object.entries(wanted)) {
    if (key in current) continue;
    const clash = await t.one('SELECT * FROM acc_serials WHERE item_id = %s AND UPPER(serial_no) = %s', [iid, key]);
    if (clash && !['returned', 'cancelled'].includes(clash.status)) bad(`Serial ${s} already exists for this product.`);
    if (clash) await t.query("UPDATE acc_serials SET status='in_stock', in_doc_id=NULL, out_doc_id=NULL, warranty_until=NULL WHERE id=%s", [clash.id]);
    else await t.query("INSERT INTO acc_serials (item_id, serial_no, status) VALUES (%s, %s, 'in_stock')", [iid, s]);
  }
}

router.post('/items', ah(async (req, res) => {
  const b = req.body || {};
  await checkItem(b);
  const user = userOf(req);
  const row = await tx(async (t) => {
    let code = nz(b.code);
    if (!code) {
      let n = (await t.one('SELECT COUNT(*) AS n FROM acc_items')).n + 1;
      while (await t.one('SELECT 1 AS x FROM acc_items WHERE code = %s', [`P${String(n).padStart(4, '0')}`])) n++;
      code = `P${String(n).padStart(4, '0')}`;
    }
    const cols = [...COLS, 'code', 'created_by', 'updated_by'];
    const r = await t.one(
      `INSERT INTO acc_items (${cols.join(', ')}, updated_at, rate_updated_at, rate_updated_by) VALUES (${cols.map(() => '%s').join(', ')}, NOW(), NOW(), %s) RETURNING *`,
      [...itemValues(b), code, user, user, user]);
    await syncOpening(t, r);
    if (b.track_serial) await syncOpeningSerials(t, r.id, b.opening_serials);
    await audit(t, user, 'create', 'item', r.id, b);
    return r;
  });
  res.json(row);
}));

router.put('/items/:iid', ah(async (req, res) => {
  const iid = +req.params.iid, b = req.body || {};
  const cur = await one('SELECT * FROM acc_items WHERE id = %s', [iid]) || bad('Product not found.', 404);
  await checkItem(b, iid);
  if (cur.item_type !== b.item_type && await one('SELECT 1 AS x FROM acc_doc_lines WHERE item_id = %s LIMIT 1', [iid])) bad('This product is already on bills, so it can\'t switch between Goods and Service.');
  if (cur.track_serial && !b.track_serial && await one("SELECT 1 AS x FROM acc_serials WHERE item_id = %s AND status = 'in_stock' AND in_doc_id IS NOT NULL LIMIT 1", [iid])) bad("Serial numbers are in stock from purchases, so serial tracking can't be turned off.");
  if (!cur.track_serial && b.track_serial && await one("SELECT 1 AS x FROM acc_stock_moves WHERE item_id = %s AND kind <> 'opening' LIMIT 1", [iid])) bad('Turn on serial tracking before the first purchase or sale of this product.');
  const user = userOf(req);
  const row = await tx(async (t) => {
    const sets = COLS.map((c) => `${c}=%s`).join(', ');
    const r = await t.one(`UPDATE acc_items SET ${sets}, code=%s, updated_by=%s, updated_at=NOW() WHERE id = %s RETURNING *`,
      [...itemValues(b), nz(b.code) || cur.code, user, iid]);
    if (RATE_KEYS.some((k) => String(cur[k]) !== String(r[k]))) await t.query('UPDATE acc_items SET rate_updated_at = NOW(), rate_updated_by = %s WHERE id = %s', [user, iid]);
    await syncOpening(t, r);
    if (b.track_serial) await syncOpeningSerials(t, iid, b.opening_serials);
    const stock = (await t.one('SELECT COALESCE(SUM(qty_in - qty_out), 0) AS q FROM acc_stock_moves WHERE item_id = %s', [iid])).q;
    if (stock < -0.0005) bad('Opening stock that low would make current stock negative.');
    const changed = {};
    for (const [k, v] of Object.entries(b)) {
      if (k in cur && String(cur[k]) !== String(v) && !([null, '', 0].includes(cur[k]) && [null, '', 0, false, undefined].includes(v))) changed[k] = [cur[k], v];
    }
    await audit(t, user, 'update', 'item', iid, changed);
    return r;
  });
  res.json(row);
}));

router.delete('/items/:iid', ah(async (req, res) => {
  const iid = +req.params.iid;
  const cur = await one('SELECT * FROM acc_items WHERE id = %s', [iid]) || bad('Product not found.', 404);
  if (await one('SELECT 1 AS x FROM acc_doc_lines WHERE item_id = %s LIMIT 1', [iid])) bad(`${cur.name} is on purchase/sales documents, so it can't be deleted. Untick Active instead.`);
  await tx(async (t) => {
    await t.query('DELETE FROM acc_stock_moves WHERE item_id = %s', [iid]);
    await t.query('DELETE FROM acc_serials WHERE item_id = %s', [iid]);
    await t.query('DELETE FROM acc_items WHERE id = %s', [iid]);
    await syncOpening(t, { id: iid, opening_qty: 0, opening_rate: 0 });
    await audit(t, userOf(req), 'delete', 'item', iid, { name: cur.name, code: cur.code });
  });
  await removeImage('items', cur.image_file);
  res.json({ ok: true });
}));

export default router;
