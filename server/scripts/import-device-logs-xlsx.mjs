#!/usr/bin/env node
/**
 * Device-log migration: Excel (.xlsx/.xls/.csv) -> zkteco_attendance_logs of ONE tenant.
 *
 * Expected columns (header row, any order, case-insensitive):
 *   PersonalId  VerifyMode  InOutMode  SignInDate  SignInTime  [BranchId IpAddress SerialNum Id SignInDateTime]
 *
 *   PersonalId   -> pin  (matched to users.device_id to set employee_id)
 *   VerifyMode   -> verify_type          InOutMode -> check_type
 *   SignInDateTime -> check_time (Nepal local time, stored as timestamptz). AUTHORITATIVE when present,
 *                   because SignInDate cells are often day/month-swapped in exported sheets.
 *                   Falls back to SignInDate + SignInTime only if SignInDateTime is missing.
 *
 * The same punch repeated for several IPs/branches in the sheet (same PersonalId + same
 * date/time) is collapsed to ONE log row.
 *
 * SAFE BY DEFAULT: nothing is written unless --commit is given.
 *
 * Usage (run from the ehajiri/server folder):
 *   node scripts/import-device-logs-xlsx.mjs --file "C:\path\logs.xlsx" --db etms_padt_276b34            # dry run
 *   node scripts/import-device-logs-xlsx.mjs --file "C:\path\logs.xlsx" --db etms_padt_276b34 --commit   # write
 *   node scripts/import-device-logs-xlsx.mjs --db etms_padt_276b34 --rollback <BATCH_ID>                 # undo a batch
 *
 * Options:
 *   --date-format dmy|mdy|ymd   how TEXT dates are read (default dmy). Real Excel date cells are
 *                               read as true dates and ignore this.
 *   --tz Asia/Kathmandu         timezone the sheet times are in (default Asia/Kathmandu)
 *   --device-sn XLSX-IMPORT     device_sn stored on imported rows (SerialNum in the sheet is NULL)
 *   --include-unmatched         also import PINs that match no staff (employee_id = NULL).
 *                               Default: skipped and listed in the report.
 *   --skip-pins 9999,0          PINs to ignore (e.g. test/admin ids)
 */
import 'dotenv/config';
import pg from 'pg';
import XLSX from 'xlsx';
import fs from 'fs';

const args = process.argv.slice(2);
const opt = (name, def = null) => { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def; };
const flag = (name) => args.includes('--' + name);

const FILE = opt('file');
const DB = opt('db');
const COMMIT = flag('commit');
const ROLLBACK = opt('rollback');
const DATE_FMT = (opt('date-format', 'dmy') || 'dmy').toLowerCase();
const TZ = opt('tz', 'Asia/Kathmandu');
const DEVICE_SN = opt('device-sn', 'XLSX-IMPORT');
const INCLUDE_UNMATCHED = flag('include-unmatched');
const SKIP_PINS = new Set((opt('skip-pins', '') || '').split(',').map(s => s.trim()).filter(Boolean));

const die = (m) => { console.error('ERROR: ' + m); process.exit(1); };
if (!DB) die('--db <tenant database name> is required (e.g. etms_padt_276b34). It is never taken from .env, so a wrong tenant can not be hit by accident.');
if (!ROLLBACK && !FILE) die('--file <excel file> is required');
if (!['dmy', 'mdy', 'ymd'].includes(DATE_FMT)) die('--date-format must be dmy, mdy or ymd');

const pool = new pg.Pool({
  host: process.env.DB_HOST || 'localhost', port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'postgres', password: process.env.DB_PASS || 'postgres',
  database: DB, max: 2,
});
const TAG = 'XLSX-IMPORT';

/* ───────────── rollback ───────────── */
if (ROLLBACK) {
  const like = `${TAG} ${ROLLBACK}%`;
  const c = (await pool.query('SELECT count(*)::int n FROM zkteco_attendance_logs WHERE device_sn=$1 AND raw_line LIKE $2', [DEVICE_SN, like])).rows[0].n;
  console.log(`Batch ${ROLLBACK}: ${c} imported rows found in ${DB}.`);
  if (!COMMIT) { console.log('Dry run. Add --commit to delete them.'); await pool.end(); process.exit(0); }
  const d = await pool.query('DELETE FROM zkteco_attendance_logs WHERE device_sn=$1 AND raw_line LIKE $2', [DEVICE_SN, like]);
  console.log(`Deleted ${d.rowCount} rows.`); await pool.end(); process.exit(0);
}

/* ───────────── read sheet ───────────── */
// Streaming .xlsx reader (constant memory): big sheets (700k+ rows) make SheetJS thrash/hang.
// Pipes `unzip -p` for sharedStrings + sheet1 and keeps only the columns this tool uses.
const WANTED = new Set(['personalid', 'pin', 'userid', 'verifymode', 'inoutmode', 'signindate', 'signintime', 'signindatetime', 'branchid', 'ipaddress', 'id']);
const colIdx = (ref) => { let n = 0; for (const ch of ref.match(/^[A-Z]+/)[0]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
async function readXlsxStream(file) {
  const { execFileSync, spawn } = await import('child_process');
  let sst = [];
  try {
    const x = execFileSync('unzip', ['-p', file, 'xl/sharedStrings.xml'], { maxBuffer: 1 << 30 }).toString('utf8');
    sst = [...x.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => unesc([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join('')));
  } catch { /* no shared strings */ }
  const child = spawn('unzip', ['-p', file, 'xl/worksheets/sheet1.xml'], { stdio: ['ignore', 'pipe', 'inherit'] });
  child.stdout.setEncoding('utf8');
  const table = []; let keep = null; let buf = '';
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  const handleRow = (inner) => {
    const cells = [];
    cellRe.lastIndex = 0; let m;
    while ((m = cellRe.exec(inner))) {
      const attrs = m[1], body = m[2] || '';
      const ref = attrs.match(/\br="([A-Z]+\d+)"/); if (!ref) continue;
      const t = (attrs.match(/\bt="(\w+)"/) || [])[1];
      const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      let val = null;
      if (t === 's') val = v != null ? sst[+v] : null;
      else if (t === 'inlineStr') val = unesc([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join(''));
      else if (t === 'str') val = v != null ? unesc(v) : null;
      else if (v != null) val = t === 'b' ? v === '1' : Number(v);
      cells[colIdx(ref[1])] = val;
    }
    if (!keep) {
      keep = []; cells.forEach((h, i) => { if (WANTED.has(String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, ''))) keep.push(i); });
      table.push(keep.map(i => cells[i]));
    } else {
      const out = new Array(keep.length); for (let k = 0; k < keep.length; k++) out[k] = cells[keep[k]] ?? null;
      table.push(out);
    }
  };
  for await (const chunk of child.stdout) {
    buf += chunk; let last = 0; rowRe.lastIndex = 0; let m;
    while ((m = rowRe.exec(buf))) { handleRow(m[1]); last = rowRe.lastIndex; }
    buf = buf.slice(last);
  }
  return table;
}
let table;
if (/\.xlsx$/i.test(FILE)) { table = await readXlsxStream(FILE); }
else {
  const wb = XLSX.read(fs.readFileSync(FILE), { type: 'buffer', cellDates: false, raw: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) die('No sheet found in file');
  table = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
}
if (!table.length) die('Sheet is empty');
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const head = table[0].map(norm);
const col = (...names) => { for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; } return -1; };
const C = {
  pin: col('personalid', 'pin', 'userid'), verify: col('verifymode'), inout: col('inoutmode'),
  date: col('signindate'), time: col('signintime'), dt: col('signindatetime'),
  branch: col('branchid'), ip: col('ipaddress'), src: col('id'),
};
if (C.pin < 0) die('Column "PersonalId" not found in header row. Found: ' + table[0].join(', '));
if ((C.date < 0 || C.time < 0) && C.dt < 0) die('Need SignInDate + SignInTime (or SignInDateTime) columns.');

const pad = (n) => String(n).padStart(2, '0');
// Returns {y,m,d} (+ optional H,M,S) from an Excel serial number or a text date.
const parseDate = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') { const p = XLSX.SSF.parse_date_code(v); return p ? { y: p.y, m: p.m, d: p.d, H: p.H, M: p.M, S: Math.round(p.S) } : null; }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  let a = +m[1], b = +m[2], c = +m[3], y, mo, d;
  if (m[1].length === 4 || DATE_FMT === 'ymd') { y = a; mo = b; d = c; }
  else if (DATE_FMT === 'mdy') { mo = a; d = b; y = c; }
  else { d = a; mo = b; y = c; }
  if (y < 100) y += 2000;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d, H: m[4] != null ? +m[4] : undefined, M: m[5] != null ? +m[5] : undefined, S: m[6] != null ? +m[6] : 0 };
};
const parseTime = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') { const t = Math.round((v % 1) * 86400); return { H: Math.floor(t / 3600) % 24, M: Math.floor(t % 3600 / 60), S: t % 60 }; }
  const m = String(v).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  return m ? { H: +m[1], M: +m[2], S: m[3] ? +m[3] : 0 } : null;
};

const bad = []; const punches = new Map(); let dupCollapsed = 0; let rowsRead = 0; let dateDisagree = 0; let usedFallback = 0; const skipped = new Map();
for (let r = 1; r < table.length; r++) {
  const row = table[r]; if (!row || row.every(x => x == null || x === '')) continue;
  rowsRead++;
  const pin = row[C.pin] == null ? '' : String(row[C.pin]).trim().replace(/\.0+$/, '');
  if (!pin) { bad.push([r + 1, 'no PersonalId']); continue; }
  if (SKIP_PINS.has(pin)) { skipped.set(pin, (skipped.get(pin) || 0) + 1); continue; }
  // SignInDateTime (a real date+time) is the AUTHORITATIVE source when present: exported sheets often
  // have SignInDate cells with day/month swapped (text/CSV re-import artifact), which would silently
  // load punches on the wrong day. SignInDate + SignInTime are only the fallback.
  let d = null, t = null;
  if (C.dt >= 0) {
    const x = parseDate(row[C.dt]);
    if (x && x.H !== undefined) { d = { y: x.y, m: x.m, d: x.d }; t = { H: x.H, M: x.M, S: x.S }; }
  }
  if (d && t && C.date >= 0) {            // consistency report only — SignInDate never overrides SignInDateTime
    const y = parseDate(row[C.date]);
    if (y && !(y.y === d.y && y.m === d.m && y.d === d.d)) dateDisagree++;
  }
  if (!d || !t) {
    d = C.date >= 0 ? parseDate(row[C.date]) : null;
    t = C.time >= 0 ? parseTime(row[C.time]) : null;
    if (d && t) usedFallback++;
  }
  if (!d || !t) { bad.push([r + 1, `unreadable date/time (${row[C.date]} ${row[C.time]})`]); continue; }
  const local = `${d.y}-${pad(d.m)}-${pad(d.d)} ${pad(t.H)}:${pad(t.M)}:${pad(t.S)}`;
  const key = pin + '|' + local;
  if (punches.has(key)) { dupCollapsed++; continue; }
  punches.set(key, {
    pin, local,
    verify: C.verify >= 0 && Number.isFinite(+row[C.verify]) ? +row[C.verify] : 0,
    inout: C.inout >= 0 && Number.isFinite(+row[C.inout]) ? +row[C.inout] : 0,
    src: [C.branch >= 0 ? `branch=${row[C.branch]}` : '', C.ip >= 0 ? `ip=${row[C.ip]}` : '', C.src >= 0 ? `srcId=${row[C.src]}` : ''].filter(Boolean).join(' '),
  });
}

/* ───────────── match staff ───────────── */
const pins = [...new Set([...punches.values()].map(p => p.pin))];
const users = (await pool.query('SELECT id, device_id FROM users WHERE device_id = ANY($1::text[])', [pins])).rows;
const empByPin = new Map(users.map(u => [u.device_id, u.id]));
const unmatchedCount = new Map();
let toInsert = [];
for (const p of punches.values()) {
  const emp = empByPin.get(p.pin) ?? null;
  if (emp == null) { unmatchedCount.set(p.pin, (unmatchedCount.get(p.pin) || 0) + 1); if (!INCLUDE_UNMATCHED) continue; }
  toInsert.push({ ...p, emp });
}

/* ───────────── report ───────────── */
const BATCH = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
const locals = toInsert.map(p => p.local).sort();
console.log('==================== DEVICE LOG IMPORT ====================');
console.log(`Mode            : ${COMMIT ? 'COMMIT (writing)' : 'DRY RUN (nothing written)'}`);
console.log(`Database        : ${DB}`);
console.log(`File            : ${FILE}`);
console.log(`Text date format: ${DATE_FMT}    Timezone: ${TZ}    device_sn: ${DEVICE_SN}`);
console.log(`Rows read       : ${rowsRead}`);
console.log(`Unreadable rows : ${bad.length}${bad.length ? '  e.g. ' + bad.slice(0, 5).map(b => `row ${b[0]} (${b[1]})`).join('; ') : ''}`);
console.log(`Date source     : SignInDateTime column (authoritative). ${dateDisagree} rows had a different SignInDate (ignored); ${usedFallback} rows had to fall back to SignInDate+SignInTime`);
console.log(`Duplicate rows  : ${dupCollapsed} (same PersonalId + same date/time, e.g. repeated per IP/branch) collapsed`);
if (skipped.size) console.log(`Skipped PINs    : ${[...skipped].map(([k, v]) => `${k}(${v})`).join(', ')}`);
console.log(`Unique punches  : ${punches.size}`);
console.log(`Matched staff   : ${users.length} of ${pins.length} PINs`);
if (unmatchedCount.size) console.log(`${INCLUDE_UNMATCHED ? 'Importing unmatched' : 'NOT imported (no staff with this Device ID)'}: ${[...unmatchedCount].map(([k, v]) => `PIN ${k} (${v} punches)`).join(', ')}`);
if (locals.length) console.log(`Date range      : ${locals[0]}  ->  ${locals[locals.length - 1]}`);
console.log('Sample (first 5 as it will be stored, Nepal time):');
toInsert.slice(0, 5).forEach(p => console.log(`   PIN ${p.pin}  ${p.local}  in/out=${p.inout} verify=${p.verify}  employee_id=${p.emp}`));

if (!toInsert.length) { console.log('\nNothing to import.'); await pool.end(); process.exit(0); }

const insertSql = `
  INSERT INTO zkteco_attendance_logs (device_sn, pin, check_time, check_type, verify_type, work_code, raw_line, employee_id, synced)
  SELECT $1, x.pin, (x.local::timestamp AT TIME ZONE $2), x.inout, x.verify, 0, x.raw, x.emp, FALSE
  FROM unnest($3::text[], $4::text[], $5::int[], $6::int[], $7::text[], $8::int[]) AS x(pin, local, inout, verify, raw, emp)
  ON CONFLICT (device_sn, pin, check_time) DO NOTHING`;

const client = await pool.connect();
try {
  await client.query('BEGIN');
  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += 2000) {
    const b = toInsert.slice(i, i + 2000);
    const r = await client.query(insertSql, [DEVICE_SN, TZ, b.map(p => p.pin), b.map(p => p.local), b.map(p => p.inout), b.map(p => p.verify),
      b.map(p => `${TAG} ${BATCH} ${p.src}`.trim()), b.map(p => p.emp)]);
    inserted += r.rowCount;
  }
  console.log(`\nWould insert    : ${inserted} new rows  (${toInsert.length - inserted} already present, skipped by the unique index)`);
  if (COMMIT) {
    await client.query('COMMIT');
    console.log(`COMMITTED. Batch id: ${BATCH}`);
    console.log(`To undo this import:  node scripts/import-device-logs-xlsx.mjs --db ${DB} --rollback ${BATCH} --commit`);
  } else {
    await client.query('ROLLBACK');
    console.log('Dry run finished — nothing was written. Re-run with --commit to import.');
  }
} catch (e) {
  await client.query('ROLLBACK'); die('Import failed, nothing written: ' + e.message);
} finally { client.release(); await pool.end(); }
