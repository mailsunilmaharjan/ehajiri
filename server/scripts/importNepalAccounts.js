/* One-off import of a NepalAccounts demo database (SQLite) into a tenant's eHajiri Postgres DB.
 *
 *   DRY RUN (default — reads only, changes nothing):
 *     DB_NAME=<tenant db> node server/scripts/importNepalAccounts.js <accounts.db> [<uploads dir>]
 *   APPLY:
 *     DB_NAME=<tenant db> node server/scripts/importNepalAccounts.js <accounts.db> [<uploads dir>] --apply --confirm-db <tenant db>
 *
 * Safety:
 *   - the target is whatever DB_NAME / server/.env resolves to; it is printed, and --apply refuses unless
 *     --confirm-db repeats that exact name (the .env default is the PRODUCTION database)
 *   - refuses if the target already holds Accounts transactions (vouchers, bills or products). A freshly
 *     enabled tenant only holds the auto-seeded chart of accounts, which is replaced by the demo's own
 *   - everything runs in ONE transaction: any failure rolls the whole import back
 *   - the demo's own users / sessions are NOT imported (eHajiri's users are used); "created_by"-style columns keep
 *     the demo's usernames as plain text
 *   - ids are preserved so every link between rows stays intact; sequences are reset afterwards
 *   - uploaded files (product photos, bank QR, quotation logos/covers/profile PDFs, bills) go into acc_files
 *
 * Needs Node 22+ (uses the built-in node:sqlite).
 */
import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import pool from '../db.js';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--confirm-db');
const srcPath = positional[0];
if (!srcPath || !fs.existsSync(srcPath)) { console.error('Usage: importNepalAccounts.js <accounts.db> [<uploads dir>] [--apply --confirm-db <db>]'); process.exit(2); }
const uploads = positional[1] || path.join(path.dirname(path.resolve(srcPath)), 'uploads');
const APPLY = flag('--apply');

// source table -> [target table, self-referencing columns to fill in after the insert]
const TABLES = [
  ['fiscal_years', 'acc_fiscal_years', []],
  ['account_groups', 'acc_groups', ['parent_id']],
  ['accounts', 'acc_ledgers', []],
  ['party_contacts', 'acc_party_contacts', []],
  ['vouchers', 'acc_vouchers', []],
  ['voucher_lines', 'acc_voucher_lines', []],
  ['units', 'acc_units', []],
  ['item_categories', 'acc_item_categories', ['parent_id']],
  ['items', 'acc_items', []],
  ['quote_templates', 'acc_quote_templates', []],
  ['inv_docs', 'acc_docs', ['ref_doc_id']],
  ['inv_lines', 'acc_doc_lines', []],
  ['stock_moves', 'acc_stock_moves', []],
  ['serials', 'acc_serials', []],
  ['line_serials', 'acc_line_serials', []],
  ['notifications', 'acc_notifications', []],
  ['approvals', 'acc_approvals', []],
  ['reminders', 'acc_reminders', []],
  ['cheques', 'acc_cheques', []],
  ['audit_log', 'acc_audit_log', []],
];
const WIPE = ['acc_files', 'acc_audit_log', 'acc_cheques', 'acc_reminders', 'acc_approvals', 'acc_notifications', 'acc_line_serials', 'acc_serials',
  'acc_stock_moves', 'acc_doc_lines', 'acc_docs', 'acc_quote_templates', 'acc_items', 'acc_item_categories', 'acc_units', 'acc_voucher_lines',
  'acc_vouchers', 'acc_party_contacts', 'acc_ledgers', 'acc_groups', 'acc_fiscal_years', 'acc_company'];
const FOLDERS = ['items', 'bank-qr', 'quote-templates', 'quotes', 'proofs', 'transport'];
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', pdf: 'application/pdf' };

const src = new DatabaseSync(srcPath, { readOnly: true });
const srcRows = (t) => src.prepare(`SELECT * FROM ${t}`).all();
const q = (c, sql, p) => c.query(sql, p);

async function targetCols(c, table) {
  const { rows } = await q(c, 'SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1', [table]);
  return Object.fromEntries(rows.map((r) => [r.column_name, r.data_type]));
}

function convert(v, type) {
  if (v === undefined) return null;
  if (typeof v === 'bigint') v = Number(v);
  if (v === '' && /^(date|timestamp)/.test(type)) return null;
  if (type === 'timestamp with time zone' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v)) return `${v}+00`;   // demo stored UTC
  if (type === 'bytea') return Buffer.from(v);
  return v;
}

const client = await pool.connect();
let exit = 0;
try {
  const info = (await q(client, 'SELECT current_database() AS db, inet_server_port() AS port')).rows[0];
  console.log(`Source : ${path.resolve(srcPath)}  (user_version ${src.prepare('PRAGMA user_version').get().user_version})`);
  console.log(`Target : database "${info.db}" on port ${info.port}  (${APPLY ? 'APPLY' : 'dry run'})`);
  const need = (await q(client, "SELECT to_regclass('acc_ledgers') AS t")).rows[0].t;
  if (!need) throw new Error('acc_* tables are missing in the target — start the server once so migration v167 runs.');

  const busy = [];
  for (const t of ['acc_vouchers', 'acc_docs', 'acc_items']) {
    const n = (await q(client, `SELECT COUNT(*)::int AS n FROM ${t}`)).rows[0].n;
    if (n) busy.push(`${t}=${n}`);
  }
  if (busy.length) throw new Error(`Target already has Accounts data (${busy.join(', ')}). Import is only for an empty / freshly enabled tenant.`);

  const plan = [];
  for (const [s, t, selfCols] of TABLES) {
    const rows = srcRows(s), cols = await targetCols(client, t);
    plan.push({ s, t, selfCols, rows, cols });
    console.log(`  ${s.padEnd(16)} -> ${t.padEnd(22)} ${String(rows.length).padStart(5)} rows`);
  }
  const files = [];
  for (const f of FOLDERS) {
    const dir = path.join(uploads, f);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const ext = name.split('.').pop().toLowerCase();
      if (MIME[ext] && fs.statSync(path.join(dir, name)).isFile()) files.push({ kind: f, name, mime: MIME[ext], file: path.join(dir, name) });
    }
  }
  console.log(`  files            -> acc_files               ${String(files.length).padStart(5)} files (${uploads})`);

  if (!APPLY) { console.log('\nDry run only — nothing was changed. Add --apply --confirm-db <name> to import.'); process.exit(0); }
  if (val('--confirm-db') !== info.db) throw new Error(`--confirm-db must be exactly "${info.db}" (the database this run would change).`);

  await q(client, 'BEGIN');
  await q(client, `TRUNCATE ${WIPE.join(', ')} RESTART IDENTITY CASCADE`);

  // company (single row)
  const co = src.prepare('SELECT * FROM company WHERE id = 1').get();
  const coCols = await targetCols(client, 'acc_company');
  const ck = Object.keys(co).filter((k) => k in coCols);
  await q(client, `INSERT INTO acc_company (${ck.join(', ')}) VALUES (${ck.map((_, i) => `$${i + 1}`).join(', ')})`, ck.map((k) => convert(co[k], coCols[k])));

  for (const { t, selfCols, rows, cols } of plan) {
    if (!rows.length) continue;
    const keys = Object.keys(rows[0]).filter((k) => k in cols);
    const deferred = [];
    for (const r of rows) {
      const vals = keys.map((k) => (selfCols.includes(k) ? null : convert(r[k], cols[k])));
      await q(client, `INSERT INTO ${t} (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})`, vals);
      for (const sc of selfCols) if (keys.includes(sc) && r[sc] !== null && r[sc] !== undefined) deferred.push([sc, r[sc], r.id]);
    }
    for (const [col, ref, id] of deferred) await q(client, `UPDATE ${t} SET ${col} = $1 WHERE id = $2`, [ref, id]);
  }
  for (const f of files) await q(client, 'INSERT INTO acc_files (kind, name, mime, data) VALUES ($1,$2,$3,$4) ON CONFLICT (kind, name) DO NOTHING', [f.kind, f.name, f.mime, fs.readFileSync(f.file)]);

  for (const { t } of plan) {
    if (!(await targetCols(client, t)).id) continue;
    await q(client, `SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 1), (SELECT MAX(id) FROM ${t}) IS NOT NULL)`);
  }
  await q(client, "INSERT INTO acc_audit_log (username, action, entity, detail) VALUES ('import', 'import', 'database', $1)", [JSON.stringify({ from: path.basename(srcPath), files: files.length })]);

  // sanity: every voucher must still balance after the copy
  const bad = (await q(client, 'SELECT COUNT(*)::int AS n FROM (SELECT voucher_id FROM acc_voucher_lines GROUP BY voucher_id HAVING ROUND(SUM(dr - cr), 2) <> 0) x')).rows[0].n;
  if (bad) throw new Error(`${bad} imported voucher(s) do not balance — import cancelled.`);
  await q(client, 'COMMIT');
  console.log('\nImported OK (committed).');
} catch (e) {
  await q(client, 'ROLLBACK').catch(() => {});
  console.error('\nNOT imported:', e.message);
  exit = 1;
} finally {
  client.release();
  await pool.end();
  process.exit(exit);
}
