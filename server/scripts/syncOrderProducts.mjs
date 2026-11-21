/* Two-way product sync: order.zkattendance.com (LicenseAdmin `products`) <-> Planet tenant Accounts (`acc_items`).
 *
 *   node server/scripts/syncOrderProducts.mjs            dry run (prints what it WOULD do, writes nothing)
 *   node server/scripts/syncOrderProducts.mjs --apply    perform the sync
 *
 * Connection details come from a config file OUTSIDE the repo (secrets): C:\Attendance\product-sync\config.json
 *   { "licenseadmin": {host,port,user,password,database}, "planet": {host,port,user,password,database},
 *     "overrides": { "<LicenseAdmin product id>": <acc_items id> } }
 * Override CONFIG path with env PRODUCT_SYNC_CONFIG.
 *
 * How it works
 *  - A mapping table `product_sync_map` (created in the LicenseAdmin DB) links product <-> item and stores a hash of
 *    each side as of the last sync. A side counts as "changed" when its hash differs from the stored one.
 *  - Only ONE side changed -> copy changed fields to the other. BOTH changed -> the side with the newer updated_at wins.
 *  - New product on either side -> created on the other. Deletions are NOT synced (never removes data).
 *  - Synced: name, category / sub-category, HS code, MRP, dealer rate, partner rate, VAT type, details, specifications,
 *    website link, image. NOT synced: stock (Accounts computes it from vouchers), purchase price, units, serials.
 *  - Planet-only items that existed before the first run (and all Services) are marked 'excluded' and never pushed.
 */
import fs from 'fs';
import crypto from 'crypto';
import pg from 'pg';

const CONFIG = process.env.PRODUCT_SYNC_CONFIG || 'C:\\Attendance\\product-sync\\config.json';
const APPLY = process.argv.includes('--apply');
const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
const la = new pg.Pool({ ...cfg.licenseadmin, max: 2 });
const ac = new pg.Pool({ ...cfg.planet, max: 2 });
const overrides = cfg.overrides || {};
const log = (...a) => console.log(APPLY ? '[apply]' : '[dry]  ', ...a);

/* ───────── normalisation ───────── */
const s = (v) => String(v ?? '').trim();
const n2 = (v) => Number(v || 0).toFixed(2);
const sha = (x) => crypto.createHash('sha1').update(x).digest('hex');

function htmlToText(h) {
  return s(h).replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\/(div|p|li|h\d|tr)>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .split('\n').map((l) => l.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
const textToHtml = (t) => s(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');

function normSpecs(x) {
  let a = x;
  if (typeof a === 'string') { try { a = JSON.parse(a); } catch { a = []; } }
  if (!Array.isArray(a)) a = [];
  return a.map((p) => (Array.isArray(p) ? [s(p[0]), s(p[1])] : [s(p?.key), s(p?.value)])).filter((p) => p[0]).slice(0, 60);
}

const SIGS = [
  { ext: 'png', mime: 'image/png', t: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { ext: 'jpg', mime: 'image/jpeg', t: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'webp', mime: 'image/webp', t: (b) => b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' },
];
function decodeDataUrl(u) {
  const b64 = s(u).split(',').pop();
  if (!b64 || !/^[A-Za-z0-9+/=\s]+$/.test(b64)) return null;
  const raw = Buffer.from(b64, 'base64');
  const kind = SIGS.find((k) => k.t(raw));
  return kind ? { raw, kind } : null;
}

/* canonical form shared by both sides; `_img` carries image bytes (not hashed directly: imgHash is) */
function canonLA(p) {
  const img = p.image ? decodeDataUrl(p.image) : null;
  return {
    name: s(p.name), category: s(p.category), sub: s(p.sub_category), hs: s(p.hscode),
    mrp: n2(p.mrp), dealer: n2(p.dealer_rate), partner: n2(p.partner_rate),
    vat: s(p.vat_type).toLowerCase() === 'exclusive' ? 'exclusive' : 'inclusive',
    details: htmlToText(p.details), specs: normSpecs(p.specifications), website: s(p.website_link), rank: p.rank == null ? '' : String(p.rank),
    imgHash: img ? sha(img.raw) : '', _img: img,
  };
}
const hashOf = (c) => sha(JSON.stringify({ ...c, _img: undefined }));
const FIELDS = ['name', 'category', 'sub', 'hs', 'mrp', 'dealer', 'partner', 'vat', 'details', 'specs', 'website', 'rank', 'imgHash'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isBlank = (k, v) => v === '' || v === '0.00' || (Array.isArray(v) && !v.length);

/* ───────── Accounts side ───────── */
async function loadAcc() {
  const cats = (await ac.query('SELECT id, name, parent_id FROM acc_item_categories')).rows;
  const byId = new Map(cats.map((c) => [c.id, c]));
  const items = (await ac.query('SELECT * FROM acc_items')).rows;
  const files = new Map((await ac.query("SELECT name, mime, data FROM acc_files WHERE kind = 'items'")).rows.map((f) => [f.name, f]));
  return { cats, byId, items, files };
}
function canonAcc(i, A) {
  const c = i.category_id ? A.byId.get(i.category_id) : null;
  const parent = c?.parent_id ? A.byId.get(c.parent_id) : null;
  const f = i.image_file ? A.files.get(i.image_file) : null;
  const img = f ? { raw: f.data, kind: SIGS.find((k) => k.mime === f.mime) || SIGS[1] } : null;
  return {
    name: s(i.name), category: parent ? parent.name : (c?.name || ''), sub: parent ? c.name : '', hs: s(i.hs_code),
    mrp: n2(i.mrp), dealer: n2(i.dealer_price), partner: n2(i.partner_price),
    vat: i.vat_type === 'exclusive' ? 'exclusive' : 'inclusive',
    details: s(i.features), specs: normSpecs(i.specs), website: s(i.website), rank: i.rank == null ? '' : String(i.rank),
    imgHash: img ? sha(img.raw) : '', _img: img,
  };
}

async function accCategoryId(t, category, sub) {
  if (!category && !sub) return null;
  const find = async (name, parent) => (await t.query(
    `SELECT id FROM acc_item_categories WHERE LOWER(name) = LOWER($1) AND ${parent ? 'parent_id = $2' : 'parent_id IS NULL AND $2::int IS NULL'} LIMIT 1`, [name, parent])).rows[0]?.id;
  let pid = null;
  if (category) {
    pid = await find(category, null);
    if (!pid) pid = (await t.query('INSERT INTO acc_item_categories (name, parent_id) VALUES ($1, NULL) RETURNING id', [category])).rows[0].id;
  }
  if (!sub) return pid;
  let sid = await find(sub, pid);
  if (!sid) sid = (await t.query('INSERT INTO acc_item_categories (name, parent_id) VALUES ($1, $2) RETURNING id', [sub, pid])).rows[0].id;
  return sid;
}

/** Create (id = null) or update an acc_item so that it matches `src`. Only differing fields are written. */
async function writeAcc(id, src, A) {
  const c = await ac.connect();
  try {
    await c.query('BEGIN');
    let cur = id ? (await c.query('SELECT * FROM acc_items WHERE id = $1 FOR UPDATE', [id])).rows[0] : null;
    const have = cur ? canonAcc(cur, A) : null;
    const diff = (k) => !have || !same(have[k], src[k]);
    const set = {};
    if (diff('name')) set.name = src.name;
    if (diff('category') || diff('sub')) set.category_id = await accCategoryId(c, src.category, src.sub);
    if (diff('hs')) set.hs_code = src.hs || null;
    if (diff('mrp')) set.mrp = src.mrp;
    if (diff('dealer')) set.dealer_price = src.dealer;
    if (diff('partner')) set.partner_price = src.partner;
    if (diff('mrp') || diff('dealer') || diff('partner')) {
      const mrp = Number(src.mrp), pct = (p) => (mrp > 0 && Number(p) > 0 ? Math.min(99.99, Math.max(0, Math.round((1 - Number(p) / mrp) * 10000) / 100)) : 0);
      set.dealer_pct = pct(src.dealer); set.partner_pct = pct(src.partner);
    }
    if (diff('vat')) set.vat_type = src.vat;
    if (diff('details')) set.features = src.details || null;
    if (diff('specs')) set.specs = src.specs.length ? JSON.stringify(src.specs) : null;
    if (diff('website')) set.website = src.website || null;
    if (diff('rank')) set.rank = src.rank === '' ? null : Number(src.rank);
    if (!cur) {
      let n = Number((await c.query('SELECT COUNT(*)::int AS n FROM acc_items')).rows[0].n) + 1;
      while ((await c.query('SELECT 1 FROM acc_items WHERE code = $1', [`P${String(n).padStart(4, '0')}`])).rowCount) n++;
      set.code = `P${String(n).padStart(4, '0')}`; set.unit_id = 1; set.item_type = 'goods'; set.vat_applicable = 1;
      set.created_by = 'order-sync';
    }
    set.updated_by = 'order-sync';
    const cols = Object.keys(set);
    if (!cur) {
      cur = (await c.query(`INSERT INTO acc_items (${cols.join(', ')}, updated_at, rate_updated_at, rate_updated_by) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}, NOW(), NOW(), 'order-sync') RETURNING *`, cols.map((k) => set[k]))).rows[0];
    } else {
      const rate = ['mrp', 'dealer_price', 'partner_price', 'vat_type'].some((k) => k in set);
      await c.query(`UPDATE acc_items SET ${cols.map((k, i) => `${k} = $${i + 1}`).join(', ')}, updated_at = NOW()${rate ? ", rate_updated_at = NOW(), rate_updated_by = 'order-sync'" : ''} WHERE id = $${cols.length + 1}`, [...cols.map((k) => set[k]), cur.id]);
    }
    if (diff('imgHash')) {
      const old = cur.image_file;
      let name = null;
      if (src._img) {
        name = `${cur.id}-${crypto.randomBytes(6).toString('hex')}.${src._img.kind.ext}`;
        await c.query("INSERT INTO acc_files (kind, name, mime, data) VALUES ('items', $1, $2, $3)", [name, src._img.kind.mime, src._img.raw]);
      }
      await c.query('UPDATE acc_items SET image_file = $1 WHERE id = $2', [name, cur.id]);
      if (old) await c.query("DELETE FROM acc_files WHERE kind = 'items' AND name = $1", [old]);
    }
    await c.query('COMMIT');
    return cur.id;
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}

/* ───────── LicenseAdmin side ───────── */
async function writeLA(id, src, cur) {
  const have = cur ? canonLA(cur) : null;
  const diff = (k) => !have || !same(have[k], src[k]);
  const c = await la.connect();
  try {
    await c.query('BEGIN');
    if (src.category && diff('category')) await c.query('INSERT INTO product_categories (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [src.category]);
    if (src.category && src.sub && (diff('category') || diff('sub'))) {
      await c.query('INSERT INTO product_subcategories (name, category_id) SELECT $1, id FROM product_categories WHERE name = $2 ON CONFLICT DO NOTHING', [src.sub, src.category]);
    }
    const set = {};
    if (diff('name')) set.name = src.name;
    if (diff('category')) set.category = src.category;
    if (diff('sub')) set.sub_category = src.sub;
    if (diff('hs')) set.hscode = src.hs;
    if (diff('mrp')) set.mrp = src.mrp;
    if (diff('dealer')) set.dealer_rate = src.dealer;
    if (diff('partner')) set.partner_rate = src.partner;
    if (diff('vat')) set.vat_type = src.vat === 'exclusive' ? 'Exclusive' : 'Inclusive';
    if (diff('details')) set.details = textToHtml(src.details);
    if (diff('specs')) set.specifications = JSON.stringify(src.specs.map(([key, value]) => ({ key, value })));
    if (diff('website')) set.website_link = src.website;
    if (diff('rank')) set.rank = src.rank === '' ? null : Number(src.rank);
    if (diff('imgHash')) set.image = src._img ? `data:${src._img.kind.mime};base64,${src._img.raw.toString('base64')}` : '';
    if (!cur) { set.stock = 'Yes'; }
    const cols = Object.keys(set);
    let pid = id;
    if (!cur) {
      pid = (await c.query(`INSERT INTO products (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`, cols.map((k) => set[k]))).rows[0].id;
    } else if (cols.length) {
      await c.query(`UPDATE products SET ${cols.map((k, i) => `${k} = $${i + 1}`).join(', ')}, updated_at = NOW() WHERE id = $${cols.length + 1}`, [...cols.map((k) => set[k]), id]);
    }
    await c.query('COMMIT');
    return pid;
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}

/* Category Ranking Order: matched by name (case-insensitive); last synced value kept in product_sync_catrank.
   Only one side changed -> copied across; both changed -> the order site wins. */
async function syncCategoryRanks() {
  const hasMeta = (await ac.query("SELECT 1 FROM information_schema.columns WHERE table_name = 'acc_item_categories' AND column_name = 'hs_code'")).rowCount > 0;
  if (APPLY) await la.query('ALTER TABLE product_sync_catrank ADD COLUMN IF NOT EXISTS meta TEXT');
  const hasT = (await la.query("SELECT to_regclass('product_sync_catrank') AS t")).rows[0].t;
  const hasMetaCol = hasT && (await la.query("SELECT 1 FROM information_schema.columns WHERE table_name = 'product_sync_catrank' AND column_name = 'meta'")).rowCount > 0;
  const last = new Map(hasT ? (await la.query(`SELECT name_lc, rank${hasMetaCol ? ', meta' : ''} FROM product_sync_catrank`)).rows.map((r) => [r.name_lc, r]) : []);
  const L = new Map((await la.query("SELECT name, rank, hscode, TO_CHAR(effective_date, 'YYYY-MM-DD') AS eff, remarks FROM product_categories")).rows.map((r) => [r.name.trim().toLowerCase(), r]));
  const C = new Map((await ac.query(`SELECT id, name, rank${hasMeta ? ', hs_code, effective_date, remarks' : ''} FROM acc_item_categories WHERE parent_id IS NULL`)).rows.map((r) => [r.name.trim().toLowerCase(), r]));
  const pick = (lv, av, had, lastv) => (lv === av ? lv : !had ? (lv ?? av) : lv !== lastv ? lv : av);   // order site wins ties
  for (const [k, lr] of L) {
    const cr = C.get(k); if (!cr) continue;
    const prev = last.get(k), had = !!prev;
    // ranking order
    const lv = lr.rank ?? null, av = cr.rank ?? null;
    const rt = pick(lv, av, had, prev?.rank ?? null);
    if (lv !== av) {
      log(`CATEGORY RANK  "${lr.name}": order site ${lv ?? '—'} / Planet ${av ?? '—'}  ->  ${rt ?? '—'}`);
      if (APPLY) {
        if (lv !== rt) await la.query('UPDATE product_categories SET rank = $1, updated_at = NOW() WHERE name = $2', [rt, lr.name]);
        if (av !== rt) await ac.query('UPDATE acc_item_categories SET rank = $1 WHERE id = $2', [rt, cr.id]);
      }
    }
    // HS code / effective date / remarks (one snapshot string)
    let metaStr = prev?.meta ?? null;
    if (hasMeta) {
      const lm = { hs: s(lr.hscode), eff: s(lr.eff), rem: s(lr.remarks) }, am = { hs: s(cr.hs_code), eff: s(cr.effective_date), rem: s(cr.remarks) };
      const ls = JSON.stringify(lm), as = JSON.stringify(am);
      const mt = pick(ls, as, !!prev?.meta, prev?.meta ?? null), m = JSON.parse(mt);
      if (ls !== as) {
        log(`CATEGORY INFO  "${lr.name}": HS/date/remarks differ -> ${mt === ls ? 'order site' : 'Planet'} value`);
        if (APPLY) {
          if (ls !== mt) await la.query('UPDATE product_categories SET hscode = $1, effective_date = $2, remarks = $3, updated_at = NOW() WHERE name = $4', [m.hs, m.eff || null, m.rem, lr.name]);
          if (as !== mt) await ac.query('UPDATE acc_item_categories SET hs_code = $1, effective_date = $2, remarks = $3 WHERE id = $4', [m.hs || null, m.eff || null, m.rem || null, cr.id]);
        }
      }
      metaStr = mt;
    }
    if (APPLY) await la.query('INSERT INTO product_sync_catrank (name_lc, rank, meta) VALUES ($1, $2, $3) ON CONFLICT (name_lc) DO UPDATE SET rank = $2, meta = $3', [k, rt, metaStr]);
  }
}

/* ───────── main ───────── */
async function main() {
  if (APPLY) {
    await la.query(`CREATE TABLE IF NOT EXISTS product_sync_map (
      id SERIAL PRIMARY KEY, la_product_id INTEGER UNIQUE, acc_item_id INTEGER UNIQUE,
      status TEXT NOT NULL DEFAULT 'linked', la_hash TEXT, acc_hash TEXT, linked_at TIMESTAMPTZ DEFAULT NOW(), synced_at TIMESTAMPTZ)`);
  }
  const hasRank = (await ac.query("SELECT 1 FROM information_schema.columns WHERE table_name = 'acc_items' AND column_name = 'rank'")).rowCount > 0;
  if (!hasRank) { log('Planet has no acc_items.rank column yet (schema v170 not applied) — skipping this run'); return; }
  if (APPLY) {
    await la.query('ALTER TABLE product_sync_map ADD COLUMN IF NOT EXISTS hver INTEGER NOT NULL DEFAULT 1');
    await la.query('CREATE TABLE IF NOT EXISTS product_sync_catrank (name_lc TEXT PRIMARY KEY, rank INTEGER)');
  }
  const hasMap = (await la.query("SELECT to_regclass('product_sync_map') AS t")).rows[0].t;
  const maps = hasMap ? (await la.query('SELECT * FROM product_sync_map')).rows : [];
  const firstRun = maps.length === 0;
  const laRows = (await la.query('SELECT * FROM products ORDER BY id')).rows;
  const A = await loadAcc();
  const laById = new Map(laRows.map((p) => [p.id, p]));
  const accById = new Map(A.items.map((i) => [i.id, i]));
  const mappedLA = new Set(maps.filter((m) => m.la_product_id).map((m) => m.la_product_id));
  const mappedAcc = new Set(maps.filter((m) => m.acc_item_id).map((m) => m.acc_item_id));
  const stats = { created_acc: 0, created_la: 0, linked: 0, to_acc: 0, to_la: 0, excluded: 0, unchanged: 0 };
  const saveMap = async (laId, accId, status = 'linked') => {
    if (!APPLY) return;
    const L = laId ? (await la.query('SELECT * FROM products WHERE id = $1', [laId])).rows[0] : null;
    const Ai = accId ? (await ac.query('SELECT * FROM acc_items WHERE id = $1', [accId])).rows[0] : null;
    const Af = Ai ? await loadAcc() : null;
    const lh = L ? hashOf(canonLA(L)) : null, ah = Ai ? hashOf(canonAcc(Ai, Af)) : null;
    await la.query(`INSERT INTO product_sync_map (la_product_id, acc_item_id, status, la_hash, acc_hash, synced_at) VALUES ($1,$2,$3,$4,$5,NOW())
      ON CONFLICT (la_product_id) DO UPDATE SET acc_item_id = $2, status = $3, la_hash = $4, acc_hash = $5, synced_at = NOW(), hver = 2`, [laId, accId, status, lh, ah]);
  };

  // 0) one-off: links made before Ranking Order existed — copy the order site's rank into Planet, then re-record hashes
  for (const m of maps.filter((x) => x.status === 'linked' && x.la_product_id && x.acc_item_id && (x.hver || 1) < 2)) {
    const p = laById.get(m.la_product_id), i = accById.get(m.acc_item_id);
    if (!p || !i) continue;
    const lc = canonLA(p), acn = canonAcc(i, A);
    if (FIELDS.some((k) => k !== 'rank' && !same(lc[k], acn[k]))) { log(`WARN  re-baseline skipped for "${p.name}": fields differ on the two sites`); continue; }
    log(`RANK  "${p.name}" rank ${lc.rank || '—'} -> Planet`);
    if (APPLY) { if (lc.rank !== acn.rank) await ac.query('UPDATE acc_items SET rank = $1 WHERE id = $2', [lc.rank === '' ? null : Number(lc.rank), i.id]); await saveMap(p.id, i.id); }
    m.hver = APPLY ? 2 : 1; m.rebased = true;
  }
  // 1) products on the order site with no link yet -> link to an existing Planet item, or create one
  const freeAcc = () => A.items.filter((i) => !mappedAcc.has(i.id));
  for (const p of laRows.filter((x) => !mappedLA.has(x.id))) {
    const ovr = overrides[p.id];
    const match = freeAcc().find((i) => i.id === ovr) || freeAcc().find((i) => i.name.trim().toLowerCase() === p.name.trim().toLowerCase());
    if (match) {
      // "keep Planet's data": Planet values win, order-site values only fill Planet's blanks
      const pc = canonAcc(match, A), oc = canonLA(p), merged = { ...pc };
      for (const k of FIELDS) if (isBlank(k, pc[k]) && !isBlank(k, oc[k])) merged[k] = oc[k];
      merged._img = pc.imgHash ? pc._img : oc._img;           // image bytes follow whichever hash won
      log(`LINK  order #${p.id} "${p.name}"  <->  Planet #${match.id} "${match.name}" (Planet data kept, blanks filled)`);
      stats.linked++;
      if (APPLY) { await writeAcc(match.id, merged, A); await writeLA(p.id, merged, p); }
      mappedAcc.add(match.id); mappedLA.add(p.id);
      await saveMap(p.id, match.id);
    } else {
      log(`NEW→Planet  order #${p.id} "${p.name}"`);
      stats.created_acc++;
      if (APPLY) { const id = await writeAcc(null, canonLA(p), A); mappedAcc.add(id); mappedLA.add(p.id); await saveMap(p.id, id); }
    }
  }
  // 2) Planet items with no link: first run -> excluded; later -> new goods go to the order site
  for (const i of A.items.filter((x) => !mappedAcc.has(x.id))) {
    if (firstRun || i.item_type !== 'goods' || !i.active) {
      log(`SKIP  Planet #${i.id} "${i.name}" (${firstRun ? 'existed before first sync' : i.item_type !== 'goods' ? 'service' : 'inactive'}) — not pushed`);
      stats.excluded++;
      if (APPLY) await la.query("INSERT INTO product_sync_map (acc_item_id, status) VALUES ($1, 'excluded') ON CONFLICT (acc_item_id) DO NOTHING", [i.id]);
    } else {
      log(`NEW→Order site  Planet #${i.id} "${i.name}"`);
      stats.created_la++;
      if (APPLY) { const pid = await writeLA(null, canonAcc(i, A), null); mappedAcc.add(i.id); await saveMap(pid, i.id); }
    }
  }
  // 3) already-linked pairs: push whichever side changed
  for (const m of maps.filter((x) => x.status === 'linked' && x.la_product_id && x.acc_item_id && (x.hver || 1) >= 2 && !x.rebased)) {
    const p = laById.get(m.la_product_id), i = accById.get(m.acc_item_id);
    if (!p || !i) { log(`WARN  link ${m.id} points at a deleted record (order #${m.la_product_id} / Planet #${m.acc_item_id}); left alone`); continue; }
    const lc = canonLA(p), acn = canonAcc(i, A);
    const lChanged = hashOf(lc) !== m.la_hash, aChanged = hashOf(acn) !== m.acc_hash;
    if (!lChanged && !aChanged) { stats.unchanged++; continue; }
    const winner = lChanged && aChanged ? (new Date(p.updated_at) >= new Date(i.updated_at || 0) ? 'la' : 'acc') : lChanged ? 'la' : 'acc';
    if (winner === 'la') {
      log(`UPDATE→Planet  "${p.name}"${aChanged ? ' (both changed; order site newer)' : ''}  fields: ${FIELDS.filter((k) => !same(lc[k], acn[k])).join(', ') || 'none'}`);
      stats.to_acc++;
      if (APPLY) await writeAcc(i.id, lc, A);
    } else {
      log(`UPDATE→Order site  "${i.name}"${lChanged ? ' (both changed; Planet newer)' : ''}  fields: ${FIELDS.filter((k) => !same(lc[k], acn[k])).join(', ') || 'none'}`);
      stats.to_la++;
      if (APPLY) await writeLA(p.id, acn, p);
    }
    await saveMap(p.id, i.id);
  }
  await syncCategoryRanks();
  log('summary', JSON.stringify(stats));
}

main().then(() => Promise.all([la.end(), ac.end()])).catch(async (e) => { console.error('SYNC FAILED:', e.message); await Promise.allSettled([la.end(), ac.end()]); process.exit(1); });
