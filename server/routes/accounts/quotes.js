/* Quotation templates (look of the Sales Quotation PDF). Port of routers/quotes.py.
 *
 * A template holds: colours, logo, cover photo, signature, stamp, company-profile pages (images, or pages
 * picked from an uploaded PDF such as an existing quotation deck), the contact lines shown on the
 * quotation, "Prepared by", and the default validity / terms / notes copied onto new quotations.
 * Files are stored in the tenant database (acc_files, folder 'quote-templates').
 */
import { Router } from 'express';
import { q, one, tx } from '../../services/accounts/accDb.js';
import { ah, bad, audit, nz, userOf } from '../../services/accounts/common.js';
import { saveImage, removeImage, serveImage, getFile } from '../../services/accounts/files.js';
import { todayAd } from '../../services/accounts/nepaliDate.js';

const router = Router();
const FOLDER = 'quote-templates';
const SLOTS = { logo: 'logo_file', cover: 'cover_file', sign: 'sign_file', stamp: 'stamp_file', brand_zk: 'brand_zk_file', brand_yoi: 'brand_yoi_file' };

/** [[term, details], ...] — blank rows dropped, lengths capped. */
export function cleanTerms(rows) {
  const out = [];
  for (const r of rows || []) {
    const k = String(r?.[0] ?? '').trim().slice(0, 80), v = String(r?.[1] ?? '').trim().slice(0, 600);
    if (k || v) out.push([k, v]);
  }
  return out.slice(0, 30);
}

/** '2-5, 7' -> [1, 2, 3, 4, 6] (0-based). Empty = every page. Out-of-range pages are skipped. */
export function pageList(spec, count) {
  const s = String(spec || '').trim();
  if (!s) return Array.from({ length: count }, (_, i) => i);
  const out = [];
  for (const part0 of s.split(',')) {
    const part = part0.trim();
    if (!part) continue;
    const [a, b] = part.split('-');
    const lo = parseInt(a, 10), hi = parseInt(b ?? a, 10);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
    for (let p = Math.min(lo, hi); p <= Math.max(lo, hi); p++) if (p >= 1 && p <= count && !out.includes(p - 1)) out.push(p - 1);
  }
  return out;
}

async function pdfPageCount(name) {
  const f = await getFile(FOLDER, name);
  if (!f) return 0;
  try {
    const { PDFDocument } = await import('pdf-lib');
    return (await PDFDocument.load(f.data, { ignoreEncryption: true })).getPageCount();
  } catch (e) {
    if (e.code === 'ERR_MODULE_NOT_FOUND') bad('PDF pages need the "pdf-lib" package on the server (not installed yet). Ask your administrator.', 501);
    return 0;
  }
}

async function parseTpl(t0) {
  const t = { ...t0 };
  try { t.terms_list = JSON.parse(t.terms || '[]'); } catch { t.terms_list = []; }
  try { t.profile_list = JSON.parse(t.profile_files || '[]'); } catch { t.profile_list = []; }
  for (const p of t.profile_list) {
    if (String(p.file || '').toLowerCase().endsWith('.pdf')) {
      p.page_count = await pdfPageCount(p.file).catch(() => 0);
      p.used_pages = pageList(p.pages, p.page_count).length;
    } else { p.page_count = 1; p.used_pages = 1; }
  }
  t.is_default = !!t.is_default;
  t.uses = (await one('SELECT COUNT(*) AS n FROM acc_docs WHERE qt_template_id = %s', [t.id])).n;
  return t;
}

export async function getTemplate(tid) {
  let t = tid ? await one('SELECT * FROM acc_quote_templates WHERE id = %s', [tid]) : null;
  t = t || await one('SELECT * FROM acc_quote_templates ORDER BY is_default DESC, id LIMIT 1');
  if (!t) bad('No quotation template. Add one under Sales › Quotation Templates.');
  return parseTpl(t);
}

/** Prepared By = the eHajiri user who made the quotation; anything missing falls back to the template. */
export async function withPreparer(tpl, username) {
  const u = username ? await one('SELECT username, full_name, email, position, phone FROM users WHERE username = %s', [username]) : null;
  const sg = username ? await one('SELECT * FROM acc_quote_signers WHERE username = %s', [username]) : null;
  if (!u && !sg) return tpl;
  const out = { ...tpl };
  if (u) {
    out.prepared_name = String(u.full_name || '').trim() || tpl.prepared_name || u.username;
    for (const [col, key] of [['position', 'prepared_post'], ['phone', 'prepared_phone'], ['email', 'prepared_email']]) {
      if (String(u[col] || '').trim()) out[key] = String(u[col]).trim();
    }
  }
  if (sg) {   // staff-wise details set under Quotation Templates › Staff signatories win over the user profile
    for (const [col, key] of [['name', 'prepared_name'], ['post', 'prepared_post'], ['phone', 'prepared_phone'], ['email', 'prepared_email']]) {
      if (String(sg[col] || '').trim()) out[key] = String(sg[col]).trim();
    }
    out.signer = true;                       // this person has a record: never print someone else's (template) signature
    out.signer_file = sg.sign_file || null;
  }
  return out;
}

export async function itemsFor(d) {
  const ids = [...new Set(d.lines.map((l) => l.item_id))];
  if (!ids.length) return {};
  const rows = (await q(`SELECT id, features, specs, image_file FROM acc_items WHERE id IN (${ids.map(() => '%s').join(',')})`, ids)).rows;
  return Object.fromEntries(rows.map((r) => [r.id, r]));
}

export async function buildQuotationPdf(d, company) {
  const tpl = await withPreparer(await getTemplate(d.qt_template_id), d.created_by);
  return (await import('../../services/accounts/pdf.js')).quotationPdf(company, d, tpl, await itemsFor(d));
}

router.get('/quote-templates', ah(async (_req, res) => {
  const rows = (await q('SELECT * FROM acc_quote_templates ORDER BY is_default DESC, name')).rows;
  res.json(await Promise.all(rows.map(parseTpl)));
}));
router.get('/quote-templates/:tid', ah(async (req, res) => {
  res.json(await parseTpl(await one('SELECT * FROM acc_quote_templates WHERE id = %s', [+req.params.tid]) || bad('Template not found.', 404)));
}));

function cleanTpl(b) {
  const name = String(b.name || '').trim();
  if (!name) bad('Give the template a name.');
  const [c1, c2, c3] = [b.color1 || '#2E7D32', b.color2 || '#6CBE45', b.color3 || '#0B6FB8'];
  for (const c of [c1, c2, c3]) if (!/^#[0-9a-fA-F]{6}$/.test(c)) bad('Colours must look like #2E7D32.');
  const paper = b.paper || 'A4';
  if (!['A4', 'WIDE'].includes(paper)) bad('Paper size must be A4 or Widescreen.');
  return [name, b.is_default ? 1 : 0, paper, c1, c2, c3, nz(b.website), nz(b.phones), nz(b.address), nz(b.prepared_name), nz(b.prepared_post),
    nz(b.prepared_phone), nz(b.prepared_email), nz(b.validity), JSON.stringify(cleanTerms(b.terms)), nz(b.notes)];
}
const COLS = ['name', 'is_default', 'paper', 'color1', 'color2', 'color3', 'website', 'phones', 'address', 'prepared_name', 'prepared_post', 'prepared_phone', 'prepared_email', 'validity', 'terms', 'notes'];

router.post('/quote-templates', ah(async (req, res) => {
  const vals = cleanTpl(req.body || {});
  const user = userOf(req);
  const tid = await tx(async (t) => {
    if (await t.one('SELECT 1 AS x FROM acc_quote_templates WHERE LOWER(name) = LOWER(%s)', [vals[0]])) bad('A template with this name already exists.');
    if (vals[1]) await t.query('UPDATE acc_quote_templates SET is_default = 0');
    const id = (await t.one(`INSERT INTO acc_quote_templates (${COLS.join(', ')}, created_by, updated_by, updated_at) VALUES (${COLS.map(() => '%s').join(', ')}, %s, %s, NOW()) RETURNING id`, [...vals, user, user])).id;
    await audit(t, user, 'create', 'quote_template', id, { name: vals[0] });
    return id;
  });
  res.json(await parseTpl(await one('SELECT * FROM acc_quote_templates WHERE id = %s', [tid])));
}));

router.put('/quote-templates/:tid', ah(async (req, res) => {
  const tid = +req.params.tid, b = req.body || {};
  const cur = await one('SELECT * FROM acc_quote_templates WHERE id = %s', [tid]) || bad('Template not found.', 404);
  let vals = cleanTpl(b);
  const user = userOf(req);
  const oldProfile = JSON.parse(cur.profile_files || '[]');
  let profile = oldProfile, removed = [];
  if (Array.isArray(b.profile_list)) {
    const known = new Set(oldProfile.map((p) => p.file));
    profile = b.profile_list.filter((p) => known.has(p.file)).map((p) => ({ file: p.file, pages: nz(p.pages), label: nz(p.label) }));
    const keep = new Set(profile.map((p) => p.file));
    removed = [...known].filter((f) => !keep.has(f));
  }
  await tx(async (t) => {
    if (await t.one('SELECT 1 AS x FROM acc_quote_templates WHERE LOWER(name) = LOWER(%s) AND id <> %s', [vals[0], tid])) bad('A template with this name already exists.');
    if (vals[1]) await t.query('UPDATE acc_quote_templates SET is_default = 0');
    else if (cur.is_default) vals = [vals[0], 1, ...vals.slice(2)];      // one template always stays the default
    await t.query(`UPDATE acc_quote_templates SET ${COLS.map((c) => `${c} = %s`).join(', ')}, profile_files = %s, updated_by = %s, updated_at = NOW() WHERE id = %s`, [...vals, JSON.stringify(profile), user, tid]);
    await audit(t, user, 'update', 'quote_template', tid, { name: vals[0], removed_pages: removed });
  });
  for (const f of removed) await removeImage(FOLDER, f);
  res.json(await parseTpl(await one('SELECT * FROM acc_quote_templates WHERE id = %s', [tid])));
}));

router.delete('/quote-templates/:tid', ah(async (req, res) => {
  const tid = +req.params.tid;
  const cur = await one('SELECT * FROM acc_quote_templates WHERE id = %s', [tid]) || bad('Template not found.', 404);
  if ((await one('SELECT COUNT(*) AS n FROM acc_quote_templates')).n <= 1) bad('Keep at least one quotation template.');
  if (await one('SELECT 1 AS x FROM acc_docs WHERE qt_template_id = %s LIMIT 1', [tid])) bad('Quotations use this template. Change their template first, or keep it.');
  await tx(async (t) => {
    await t.query('DELETE FROM acc_quote_templates WHERE id = %s', [tid]);
    if (cur.is_default) await t.query('UPDATE acc_quote_templates SET is_default = 1 WHERE id = (SELECT MIN(id) FROM acc_quote_templates)');
    await audit(t, userOf(req), 'delete', 'quote_template', tid, { name: cur.name });
  });
  for (const col of Object.values(SLOTS)) await removeImage(FOLDER, cur[col]);
  for (const p of JSON.parse(cur.profile_files || '[]')) await removeImage(FOLDER, p.file);
  res.json({ deleted: true });
}));

router.post('/quote-templates/:tid/upload', ah(async (req, res) => {
  const tid = +req.params.tid, b = req.body || {};
  const cur = await one('SELECT * FROM acc_quote_templates WHERE id = %s', [tid]) || bad('Template not found.', 404);
  const user = userOf(req);
  if (SLOTS[b.slot]) {
    const name = await saveImage(FOLDER, `t${tid}-${b.slot}`, b.data, 5);
    await tx(async (t) => {
      await t.query(`UPDATE acc_quote_templates SET ${SLOTS[b.slot]} = %s, updated_by = %s, updated_at = NOW() WHERE id = %s`, [name, user, tid]);
      await audit(t, user, 'upload', 'quote_template', tid, { slot: b.slot });
    });
    await removeImage(FOLDER, cur[SLOTS[b.slot]]);
  } else if (b.slot === 'profile') {
    const name = await saveImage(FOLDER, `t${tid}-page`, b.data, 25, true);
    if (name.endsWith('.pdf')) {
      let n = 0;
      try { n = await pdfPageCount(name); } catch (e) { await removeImage(FOLDER, name); throw e; }
      if (!n) { await removeImage(FOLDER, name); bad("Couldn't read that PDF. Save it again from PowerPoint (File › Export › PDF) and retry."); }
      if (b.pages && !pageList(b.pages, n).length) { await removeImage(FOLDER, name); bad(`The PDF has ${n} pages — check the page numbers (e.g. 2-5, 7).`); }
    }
    const profile = JSON.parse(cur.profile_files || '[]');
    profile.push({ file: name, pages: nz(b.pages), label: nz(b.label) });
    await tx(async (t) => {
      await t.query('UPDATE acc_quote_templates SET profile_files = %s, updated_by = %s, updated_at = NOW() WHERE id = %s', [JSON.stringify(profile), user, tid]);
      await audit(t, user, 'upload', 'quote_template', tid, { slot: 'profile', label: b.label });
    });
  } else bad('Unknown upload.');
  res.json(await parseTpl(await one('SELECT * FROM acc_quote_templates WHERE id = %s', [tid])));
}));

router.delete('/quote-templates/:tid/upload/:slot', ah(async (req, res) => {
  const tid = +req.params.tid, slot = req.params.slot;
  const cur = await one('SELECT * FROM acc_quote_templates WHERE id = %s', [tid]) || bad('Template not found.', 404);
  if (!SLOTS[slot]) bad('Unknown picture.');
  await tx(async (t) => {
    await t.query(`UPDATE acc_quote_templates SET ${SLOTS[slot]} = NULL, updated_by = %s, updated_at = NOW() WHERE id = %s`, [userOf(req), tid]);
    await audit(t, userOf(req), 'remove', 'quote_template', tid, { slot });
  });
  await removeImage(FOLDER, cur[SLOTS[slot]]);
  res.json(await parseTpl(await one('SELECT * FROM acc_quote_templates WHERE id = %s', [tid])));
}));

router.get('/quote-templates/:tid/file/:name', ah(async (req, res) => {
  const cur = await one('SELECT * FROM acc_quote_templates WHERE id = %s', [+req.params.tid]) || bad('Template not found.', 404);
  const own = new Set([...Object.values(SLOTS).map((c) => cur[c]), ...JSON.parse(cur.profile_files || '[]').map((p) => p.file)]);
  if (!own.has(req.params.name)) bad('No such file.', 404);
  await serveImage(res, FOLDER, req.params.name);
}));

/** Sample quotation with this template: the latest quotation if there is one, else two products. */
router.get('/quote-templates/:tid/preview', ah(async (req, res) => {
  const tid = +req.params.tid;
  const tpl = await withPreparer(await getTemplate(tid), req.accUser.username);
  const { getDoc } = await import('./docs.js');
  const last = await one("SELECT id FROM acc_docs WHERE doc_type = 'QT' ORDER BY id DESC LIMIT 1");
  let d;
  if (last) {
    d = await getDoc(last.id);
    d.qt_template_id = tid;
    if (!d.qt_terms_list?.length) { d.qt_terms_list = tpl.terms_list; d.qt_notes = d.qt_notes || tpl.notes; }
  } else {
    const items = (await q('SELECT i.id, i.name, i.mrp, u.name AS unit FROM acc_items i JOIN acc_units u ON u.id = i.unit_id WHERE i.active = 1 ORDER BY (i.image_file IS NULL), i.id LIMIT 2')).rows;
    const lines = items.map((i) => ({ item_id: i.id, item: i.name, qty: 1, unit: i.unit, amount: Math.round((i.mrp || 0) / 1.13 * 100) / 100, warranty_months: 0 }));
    const taxable = Math.round(lines.reduce((a, l) => a + l.amount, 0) * 100) / 100, vat = Math.round(taxable * 0.13 * 100) / 100;
    d = { doc_no: 'QT/SAMPLE/0001', doc_date: todayAd(), party_name: 'Sample Client Pvt. Ltd.', party_address: 'Kathmandu, Nepal', qt_attn: 'Purchase Manager',
      qt_subject: 'Attendance Device with Software', qt_validity: tpl.validity, lines, gross: taxable, discount: 0, taxable, exempt: 0, vat, total: Math.round((taxable + vat) * 100) / 100,
      qt_terms_list: tpl.terms_list, qt_notes: tpl.notes };
  }
  const company = await one('SELECT * FROM acc_company WHERE id = 1');
  const pdf = await (await import('../../services/accounts/pdf.js')).quotationPdf(company, d, tpl, await itemsFor(d));
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="Quotation-preview.pdf"' }).send(pdf);
}));

/* ── Contacts (Staff › Contact) offered as the customer of a Sales Quotation ── */
router.get('/quote-contacts', ah(async (req, res) => {
  const me = await one('SELECT id FROM users WHERE username = %s', [userOf(req)]);
  const rows = (await q(
    `SELECT c.id,
            CASE WHEN c.contact_info = 'company' THEN COALESCE(NULLIF(c.company_name, ''), c.person_name) ELSE c.person_name END AS name,
            CASE WHEN c.contact_info = 'company' THEN COALESCE(NULLIF(c.company_address, ''), c.address) ELSE c.address END AS address,
            c.mobile1 AS phone, c.contact_info,
            (SELECT json_agg(json_build_object('id', p.id, 'name', p.name, 'post', p.post, 'mobile1', p.mobile1) ORDER BY p.id)
               FROM staff_contact_persons p WHERE p.contact_id = c.id) AS persons,
            (SELECT a.id FROM acc_ledgers a WHERE a.contact_id = c.id AND a.party_type = 'customer' ORDER BY a.id LIMIT 1) AS party_id
       FROM staff_contacts c WHERE c.contact_type = 'public' OR c.created_by = %s ORDER BY 2`, [me ? me.id : 0])).rows;
  res.json(rows.filter((r) => String(r.name || '').trim()));
}));

/** Quick "+ Add" of a new Contact from the quotation form (same Contact list as Staff › Contact). */
router.post('/quote-contacts', ah(async (req, res) => {
  const b = req.body || {}, name = String(b.name || '').trim().slice(0, 200);
  if (!name) bad('Enter the customer name.');
  const me = await one('SELECT id FROM users WHERE username = %s', [userOf(req)]);
  const person = String(b.contact_person || '').trim().slice(0, 120);
  const mobile = String(b.phone || '').trim().slice(0, 40) || null, address = String(b.address || '').trim().slice(0, 300) || null;
  const id = await tx(async (t) => {
    const r = await t.one(
      "INSERT INTO staff_contacts (contact_type, contact_info, company_name, mobile1, company_address, created_by) VALUES ('public', 'company', %s, %s, %s, %s) RETURNING id",
      [name, mobile, address, me ? me.id : null]);
    if (person) await t.query('INSERT INTO staff_contact_persons (contact_id, name, mobile1) VALUES (%s, %s, %s)', [r.id, person, mobile]);
    return r.id;
  });
  res.json({ id, name, address, phone: mobile, contact_info: 'company', persons: person ? [{ name: person, mobile1: mobile }] : [], party_id: null });
}));

/* ── Staff signatories: name / post / phone / e-mail / signature per eHajiri user, used as "Prepared by" ── */
const SIGNER_FOLDER = 'quote-signers';
const clip = (v, n) => String(v ?? '').trim().slice(0, n) || null;

router.get('/quote-signers', ah(async (req, res) => {
  const signers = (await q('SELECT username, name, post, phone, email, sign_file, updated_by, updated_at FROM acc_quote_signers ORDER BY LOWER(COALESCE(name, username))')).rows;
  const users = (await q("SELECT username, full_name, position, phone, email FROM users WHERE COALESCE(emp_status, 'Active') = 'Active' ORDER BY LOWER(COALESCE(full_name, username))")).rows;
  res.json({ signers, users });
}));

router.put('/quote-signers/:username', ah(async (req, res) => {
  const username = String(req.params.username).trim(), b = req.body || {}, user = userOf(req);
  if (!await one('SELECT 1 AS x FROM users WHERE username = %s', [username])) bad('Staff member not found.', 404);
  await q(`INSERT INTO acc_quote_signers (username, name, post, phone, email, updated_by, updated_at) VALUES (%s, %s, %s, %s, %s, %s, NOW())
    ON CONFLICT (username) DO UPDATE SET name = EXCLUDED.name, post = EXCLUDED.post, phone = EXCLUDED.phone, email = EXCLUDED.email, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
  [username, clip(b.name, 120), clip(b.post, 120), clip(b.phone, 60), clip(b.email, 120), user]);
  res.json(await one('SELECT username, name, post, phone, email, sign_file, updated_by, updated_at FROM acc_quote_signers WHERE username = %s', [username]));
}));

router.post('/quote-signers/:username/signature', ah(async (req, res) => {
  const username = String(req.params.username).trim();
  if (!await one('SELECT 1 AS x FROM users WHERE username = %s', [username])) bad('Staff member not found.', 404);
  const cur = await one('SELECT sign_file FROM acc_quote_signers WHERE username = %s', [username]);
  const name = await saveImage(SIGNER_FOLDER, `sig-${username}`, req.body?.data, 2);
  await q(`INSERT INTO acc_quote_signers (username, sign_file, updated_by, updated_at) VALUES (%s, %s, %s, NOW())
    ON CONFLICT (username) DO UPDATE SET sign_file = EXCLUDED.sign_file, updated_by = EXCLUDED.updated_by, updated_at = NOW()`, [username, name, userOf(req)]);
  if (cur?.sign_file) await removeImage(SIGNER_FOLDER, cur.sign_file);
  res.json(await one('SELECT username, name, post, phone, email, sign_file, updated_by, updated_at FROM acc_quote_signers WHERE username = %s', [username]));
}));

router.delete('/quote-signers/:username/signature', ah(async (req, res) => {
  const username = String(req.params.username).trim();
  const cur = await one('SELECT sign_file FROM acc_quote_signers WHERE username = %s', [username]);
  await q('UPDATE acc_quote_signers SET sign_file = NULL, updated_by = %s, updated_at = NOW() WHERE username = %s', [userOf(req), username]);
  if (cur?.sign_file) await removeImage(SIGNER_FOLDER, cur.sign_file);
  res.json({ ok: true });
}));

router.delete('/quote-signers/:username', ah(async (req, res) => {
  const username = String(req.params.username).trim();
  const cur = await one('SELECT sign_file FROM acc_quote_signers WHERE username = %s', [username]);
  await q('DELETE FROM acc_quote_signers WHERE username = %s', [username]);
  if (cur?.sign_file) await removeImage(SIGNER_FOLDER, cur.sign_file);
  res.json({ deleted: true });
}));

router.get('/quote-signers/:username/file/:name', ah(async (req, res) => {
  const cur = await one('SELECT sign_file FROM acc_quote_signers WHERE username = %s', [String(req.params.username).trim()]);
  if (!cur || cur.sign_file !== req.params.name) bad('No such file.', 404);
  await serveImage(res, SIGNER_FOLDER, req.params.name);
}));

export default router;
