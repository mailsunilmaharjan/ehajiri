import express, { Router } from 'express';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import pool from '../db.js';
import { APP_VERSION, DB_VERSION } from '../version.js';
import { migrateBackupData, runMigrations } from '../migrations/runner.js';
import { ensureLicenseTable } from './license.js';

const router = Router();

async function buildJsonBackup(by) {
  const [
      users, shifts, leaveTypes, leaveBalances, leaves, officeVisits,
      fiscalYears, branches, departments, posts, grades,
      modes, religions, statuses, jobTimings, weekendHistory, appSettings,
      staffNotes,
    ] = await Promise.all([
      pool.query('SELECT * FROM users'),
      pool.query('SELECT * FROM shifts'),
      pool.query('SELECT * FROM leave_types'),
      pool.query('SELECT * FROM leave_balances'),
      pool.query('SELECT * FROM leaves'),
      pool.query('SELECT * FROM office_visits'),
      pool.query('SELECT * FROM fiscal_years'),
      pool.query('SELECT * FROM branches'),
      pool.query('SELECT * FROM departments'),
      pool.query('SELECT * FROM posts'),
      pool.query('SELECT * FROM grades'),
      pool.query('SELECT * FROM employment_modes'),
      pool.query('SELECT * FROM religions'),
      pool.query('SELECT * FROM employee_statuses'),
      pool.query('SELECT * FROM job_timings'),
      pool.query('SELECT * FROM weekend_history'),
      pool.query('SELECT * FROM app_settings'),
      pool.query('SELECT * FROM staff_notes').catch(() => ({ rows: [] })),
    ]);

    return {
      meta: {
        appVersion : APP_VERSION,
        dbVersion  : DB_VERSION,
        exportedAt : new Date().toISOString(),
        exportedBy : by || 'System',
      },
      data: {
        users          : users.rows,
        shifts         : shifts.rows,
        leaveTypes     : leaveTypes.rows,
        leaveBalances  : leaveBalances.rows,
        leaves         : leaves.rows,
        officeVisits   : officeVisits.rows,
        fiscalYears    : fiscalYears.rows,
        branches       : branches.rows,
        departments    : departments.rows,
        posts          : posts.rows,
        grades         : grades.rows,
        employmentModes: modes.rows,
        religions      : religions.rows,
        employeeStatuses: statuses.rows,
        jobTimings     : jobTimings.rows,
        weekendHistory : weekendHistory.rows,
        appSettings    : appSettings.rows,
        staffNotes     : staffNotes.rows,
      },
    };
}

// ══════════════════════════════════════════════════════════
//  GET /api/backup  — export full database as JSON
// ══════════════════════════════════════════════════════════
router.get('/', async (req, res) => {
  try {
    const backup = await buildJsonBackup(req.query.by);
    res.setHeader('Content-Type', 'application/json');
    res.json(backup);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Timestamped, date-sortable filename stem: 2026-07-12_143512
function backupStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function resolveBackupDir(dir) {
  const bad = (msg) => { const e = new Error(msg); e.statusCode = 400; return e; };
  if (typeof dir !== 'string' || !dir.trim()) throw bad('Backup path is required');
  const abs = dir.trim();
  if (!path.isAbsolute(abs)) throw bad(`Backup path must be a full path (e.g. D:\\eHajiri Backups), got: ${abs}`);
  try { fs.mkdirSync(abs, { recursive: true }); }
  catch (e) { throw bad(`Cannot create backup folder "${abs}": ${e.message}`); }
  return abs;
}

// ══════════════════════════════════════════════════════════
//  GET /api/backup/default-path — suggested folder for first-time setup
// ══════════════════════════════════════════════════════════
router.get('/default-path', (_req, res) => {
  res.json({ path: path.join(os.homedir(), 'Documents', 'eHajiri Backups') });
});

// ══════════════════════════════════════════════════════════
//  POST /api/backup/save — write the JSON backup straight to a folder on
//  this machine (the server runs locally in the desktop app). Much faster
//  than the download route: no HTTP transfer of the payload and no
//  re-stringify in the browser. Body: { path, by }
// ══════════════════════════════════════════════════════════
router.post('/save', async (req, res) => {
  try {
    const dir = resolveBackupDir(req.body?.path);
    const backup = await buildJsonBackup(req.body?.by);
    const file = path.join(dir, `ehajiri-backup-v${APP_VERSION}-${backupStamp()}.json`);
    const json = JSON.stringify(backup);
    fs.writeFileSync(file, json);
    res.json({ file, sizeKb: Math.round(Buffer.byteLength(json) / 1024) });
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════════
//  POST /api/backup/sql/save — run pg_dump -Fc writing directly to a
//  folder on this machine. Body: { path }
// ══════════════════════════════════════════════════════════
router.post('/sql/save', (req, res) => {
  let dir;
  try { dir = resolveBackupDir(req.body?.path); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  const pgDumpPath = process.env.PG_DUMP_PATH || 'pg_dump';
  const file = path.join(dir, `ehajiri-backup-${backupStamp()}.backup`);

  const child = spawn(pgDumpPath, [
    '--host', process.env.DB_HOST || 'localhost',
    '--port', process.env.DB_PORT || '5432',
    '--username', process.env.DB_USER || 'postgres',
    '--no-owner',
    '--no-privileges',
    '--format=custom',
    '--file', file,
    process.env.DB_NAME || 'ehajiri_db',
  ], {
    env: { ...process.env, PGPASSWORD: process.env.DB_PASS || 'postgres' },
  });

  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });

  // On spawn failure (e.g. ENOENT) 'error' AND 'close' both fire — only the
  // first may respond, or Express throws ERR_HTTP_HEADERS_SENT.
  child.on('error', (err) => {
    if (res.headersSent) return;
    const hint = err.code === 'ENOENT'
      ? 'pg_dump not found — native SQL export is not bundled in this build. Use the JSON backup instead.'
      : err.message;
    res.status(500).json({ error: hint });
  });

  child.on('close', (code) => {
    if (res.headersSent) return;
    if (code !== 0) {
      console.error('[backup/sql/save] pg_dump exited with code', code, stderr);
      try { fs.unlinkSync(file); } catch {}
      return res.status(500).json({ error: stderr || `pg_dump exited with code ${code}` });
    }
    let sizeKb = 0;
    try { sizeKb = Math.round(fs.statSync(file).size / 1024); } catch {}
    res.json({ file, sizeKb });
  });
});

// ══════════════════════════════════════════════════════════
//  GET /api/backup/sql — export a native PostgreSQL dump via pg_dump in
//  custom format (-Fc): compressed, not human-readable in a text editor,
//  and covers ALL tables (attendance logs included). Restore outside the
//  app with standard tooling:  pg_restore -d ehajiri_db <file>.backup
//  This is for external/disaster-recovery use — it is NOT used by
//  /restore above, which stays JSON-based since only that format carries
//  meta.dbVersion for automatic schema migration.
// ══════════════════════════════════════════════════════════
router.get('/sql', (_req, res) => {
  const pgDumpPath = process.env.PG_DUMP_PATH || 'pg_dump';

  const child = spawn(pgDumpPath, [
    '--host', process.env.DB_HOST || 'localhost',
    '--port', process.env.DB_PORT || '5432',
    '--username', process.env.DB_USER || 'postgres',
    '--no-owner',
    '--no-privileges',
    '--format=custom',
    process.env.DB_NAME || 'ehajiri_db',
  ], {
    env: { ...process.env, PGPASSWORD: process.env.DB_PASS || 'postgres' },
  });

  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });

  // Only commit to a 200 + attachment response once pg_dump has actually
  // launched — an ENOENT (binary not bundled/found) fires 'error' instead
  // of 'spawn', so it can still be reported as a normal JSON error below.
  child.once('spawn', () => {
    const filename = `ehajiri-backup-${new Date().toISOString().split('T')[0]}.backup`;
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    child.stdout.pipe(res);
  });

  child.on('error', (err) => {
    if (res.headersSent) return res.destroy();
    const hint = err.code === 'ENOENT'
      ? 'pg_dump not found — native SQL export is not bundled in this build. Use the JSON backup instead.'
      : err.message;
    res.status(500).json({ error: hint });
  });

  child.on('close', (code) => {
    if (code === 0) return;
    console.error('[backup/sql] pg_dump exited with code', code, stderr);
    if (!res.headersSent) res.status(500).json({ error: stderr || `pg_dump exited with code ${code}` });
    else res.end();
  });
});

// Re-inserts previously SELECT *'d rows into `table`, using whatever
// columns each row actually has (JSONB columns need re-stringifying —
// node-postgres round-trips them as parsed JS objects/arrays on the way
// out, not as text). Table must already exist with a superset of those
// columns — true here since ensureLicenseTable()/migrations just ran.
async function reinsertRows(client, table, rows, jsonbCols = []) {
  await client.query(`DELETE FROM ${table}`);
  for (const row of rows) {
    const cols = Object.keys(row).filter((c) => c !== 'id'); // let SERIAL ids reassign
    const vals = cols.map((c) => jsonbCols.includes(c) && row[c] != null ? JSON.stringify(row[c]) : row[c]);
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');
    await client.query(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`, vals);
  }
}

// ══════════════════════════════════════════════════════════
//  POST /api/backup/restore-native — restore a pg_dump custom-format
//  (-Fc, "PGDMP" magic) dump produced by GET /sql above, via pg_restore.
//  Unlike the JSON /restore, this is a FULL replacement of every table
//  (attendance logs included). --single-transaction makes it atomic: if
//  anything fails, the database is left untouched. Afterwards the schema
//  migrations re-run, so a dump taken on an older app version still ends
//  up at the current schema (app_schema_version is part of the dump).
//
//  license/app_settings are the exception: pg_restore has no per-table
//  exclude option (--exclude-table exists on pg_dump, NOT pg_restore —
//  table filters there only support "include"), so instead this snapshots
//  both tables immediately before the restore and puts the exact same rows
//  back immediately after. This installation's own license and company
//  identity (Settings → Company Info) must never come from someone else's
//  dump — this restore is for bringing THIS tenant's own data back, not
//  for cloning another tenant's install onto this one.
// ══════════════════════════════════════════════════════════
router.post('/restore-native',
  express.raw({ type: 'application/octet-stream', limit: '2gb' }),
  async (req, res) => {
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length < 5 || buf.subarray(0, 5).toString('ascii') !== 'PGDMP') {
      return res.status(400).json({
        error: 'Not a PostgreSQL custom-format dump (PGDMP header missing). Use a .backup file from "Export SQL", or the JSON restore for .json backups.',
      });
    }

    const pgRestorePath = process.env.PG_RESTORE_PATH || 'pg_restore';
    const tmpFile = path.join(os.tmpdir(), `ehajiri-restore-${Date.now()}.backup`);

    try {
      fs.writeFileSync(tmpFile, buf);

      const [licenseSnapshot, appSettingsSnapshot] = await Promise.all([
        pool.query('SELECT * FROM license').then((r) => r.rows).catch(() => []),
        pool.query('SELECT * FROM app_settings').then((r) => r.rows).catch(() => []),
      ]);

      const stderr = await new Promise((resolve, reject) => {
        const child = spawn(pgRestorePath, [
          '--host', process.env.DB_HOST || 'localhost',
          '--port', process.env.DB_PORT || '5432',
          '--username', process.env.DB_USER || 'postgres',
          '--dbname', process.env.DB_NAME || 'ehajiri_db',
          '--clean', '--if-exists',
          '--no-owner', '--no-privileges',
          '--single-transaction',
          tmpFile,
        ], {
          env: { ...process.env, PGPASSWORD: process.env.DB_PASS || 'postgres' },
        });
        let err = '';
        child.stderr.on('data', (d) => { err += d.toString(); });
        child.on('error', (e) => reject(e.code === 'ENOENT'
          ? new Error('pg_restore not found — native restore is not bundled in this build. Use a JSON backup instead.')
          : e));
        child.on('close', (code) => code === 0
          ? resolve(err)
          : reject(new Error(err.split('\n').slice(-8).join('\n') || `pg_restore exited with code ${code}`)));
      });

      // The dump may be from an older app version — bring the schema forward,
      // including license's own columns (not part of the numbered migration
      // sequence), before restoring the pre-restore snapshot into them.
      await runMigrations();
      await ensureLicenseTable();
      const client = await pool.connect();
      try {
        await reinsertRows(client, 'license', licenseSnapshot, ['payload']);
        await reinsertRows(client, 'app_settings', appSettingsSnapshot, ['value']);
      } finally {
        client.release();
      }

      res.json({
        message: 'Database restored from PostgreSQL dump (all tables except license and Company Info, which stay this installation\'s own).',
        warnings: stderr.trim() || null,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    } finally {
      fs.unlink(tmpFile, () => {});
    }
  });

// ══════════════════════════════════════════════════════════
//  GET /api/backup/version  — current version info
// ══════════════════════════════════════════════════════════
router.get('/version', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT version, applied_at FROM app_schema_version ORDER BY version DESC LIMIT 1'
    );
    res.json({
      appVersion : APP_VERSION,
      dbVersion  : DB_VERSION,
      dbApplied  : rows[0]?.version ?? 0,
      dbAppliedAt: rows[0]?.applied_at ?? null,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════
//  POST /api/backup/restore  — restore from JSON backup
//  Handles version migration automatically
// ══════════════════════════════════════════════════════════
router.post('/restore', async (req, res) => {
  const { meta, data } = req.body;

  if (!meta || !data)
    return res.status(400).json({ error: 'Invalid backup format: missing meta or data' });

  const backupDbVersion = meta.dbVersion ?? 0;
  const currentDbVersion = DB_VERSION;
  const migrated = backupDbVersion < currentDbVersion;

  // Apply data-level migrations if backup is older
  const migratedData = migrated
    ? migrateBackupData(data, backupDbVersion, currentDbVersion)
    : data;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Truncate all tables (order matters for FK constraints)
    // staff_notes must be truncated before users (FK: staff_notes.user_id → users.id)
    await client.query(`
      TRUNCATE staff_notes, weekend_history, app_settings, job_timings, employee_statuses,
               religions, employment_modes, grades, posts, departments,
               branches, fiscal_years, leave_balances, leaves, office_visits,
               shifts, leave_types, users
      RESTART IDENTITY CASCADE
    `).catch(async () => {
      // staff_notes may not exist on older backups — truncate without it
      await client.query(`
        TRUNCATE weekend_history, app_settings, job_timings, employee_statuses,
                 religions, employment_modes, grades, posts, departments,
                 branches, fiscal_years, leave_balances, leaves, office_visits,
                 shifts, leave_types, users
        RESTART IDENTITY CASCADE
      `);
    });

    const d = migratedData;

    // Restore users
    for (const u of d.users || []) {
      await client.query(
        `INSERT INTO users (id,employee_id,username,password,full_name,role,department,position,shift,email,phone,join_date,gender,avatar,active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [u.id,u.employee_id,u.username,u.password,u.full_name,u.role,u.department,
         u.position,u.shift,u.email,u.phone,u.join_date,u.gender,u.avatar,u.active]
      );
    }
    if ((d.users||[]).length) await client.query(`SELECT setval('users_id_seq', (SELECT MAX(id) FROM users))`);

    // Restore shifts
    for (const s of d.shifts || []) {
      await client.query(
        `INSERT INTO shifts (id,name,name_en,code,start_time,end_time,work_hours,grace_period_start,grace_period_end,
         make_default,active,color,exceptional_day_enabled,exceptional_days,exceptional_start_time,
         exceptional_end_time,exceptional_work_hours,winter_policy_enabled,winter_policy)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        [s.id,s.name,s.name_en,s.code,s.start_time,s.end_time,s.work_hours,s.grace_period_start,
         s.grace_period_end,s.make_default,s.active,s.color,s.exceptional_day_enabled,
         JSON.stringify(s.exceptional_days||[]),s.exceptional_start_time,s.exceptional_end_time,
         s.exceptional_work_hours,s.winter_policy_enabled,s.winter_policy?JSON.stringify(s.winter_policy):null]
      );
    }
    if ((d.shifts||[]).length) await client.query(`SELECT setval('shifts_id_seq', (SELECT MAX(id) FROM shifts))`);

    // Restore leave_types
    for (const lt of d.leaveTypes || []) {
      await client.query(
        `INSERT INTO leave_types (id,name,code,total_days,color,name_en) VALUES ($1,$2,$3,$4,$5,$6)`,
        [lt.id,lt.name,lt.code,lt.total_days,lt.color,lt.name_en]
      );
    }
    if ((d.leaveTypes||[]).length) await client.query(`SELECT setval('leave_types_id_seq', (SELECT MAX(id) FROM leave_types))`);

    // Restore leave_balances
    for (const lb of d.leaveBalances || []) {
      await client.query(
        `INSERT INTO leave_balances (id,employee_id,leave_type_code,balance) VALUES ($1,$2,$3,$4)`,
        [lb.id,lb.employee_id,lb.leave_type_code,lb.balance]
      );
    }
    if ((d.leaveBalances||[]).length) await client.query(`SELECT setval('leave_balances_id_seq', (SELECT MAX(id) FROM leave_balances))`);

    // Restore leaves
    for (const l of d.leaves || []) {
      await client.query(
        `INSERT INTO leaves (id,employee_id,leave_type_code,from_date,to_date,days,reason,status,applied_date,approved_by,approved_date,comment)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [l.id,l.employee_id,l.leave_type_code,l.from_date,l.to_date,l.days,l.reason,
         l.status,l.applied_date,l.approved_by,l.approved_date,l.comment]
      );
    }
    if ((d.leaves||[]).length) await client.query(`SELECT setval('leaves_id_seq', (SELECT MAX(id) FROM leaves))`);

    // Restore office_visits
    for (const v of d.officeVisits || []) {
      await client.query(
        `INSERT INTO office_visits (id,employee_id,purpose,location,from_date,from_time,to_date,to_time,description,status,applied_date,approved_by,approved_date,comment)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [v.id,v.employee_id,v.purpose,v.location,v.from_date,v.from_time,v.to_date,v.to_time,
         v.description,v.status,v.applied_date,v.approved_by,v.approved_date,v.comment]
      );
    }
    if ((d.officeVisits||[]).length) await client.query(`SELECT setval('office_visits_id_seq', (SELECT MAX(id) FROM office_visits))`);

    // Restore setup tables
    const setupInserts = [
      { rows: d.fiscalYears,       table: 'fiscal_years',      seq: 'fiscal_years_id_seq',       q: `INSERT INTO fiscal_years (id,name,start_date,end_date,is_default,is_system) VALUES ($1,$2,$3,$4,$5,$6)`,   vals: r => [r.id,r.name,r.start_date,r.end_date,r.is_default,r.is_system] },
      { rows: d.branches,          table: 'branches',           seq: 'branches_id_seq',           q: `INSERT INTO branches (id,name,short_name,address,phone,ranking_order) VALUES ($1,$2,$3,$4,$5,$6)`,        vals: r => [r.id,r.name,r.short_name,r.address,r.phone,r.ranking_order] },
      { rows: d.departments,       table: 'departments',        seq: 'departments_id_seq',        q: `INSERT INTO departments (id,name,short_name,ranking_order,is_default,is_system) VALUES ($1,$2,$3,$4,$5,$6)`, vals: r => [r.id,r.name,r.short_name,r.ranking_order,r.is_default,r.is_system] },
      { rows: d.posts,             table: 'posts',              seq: 'posts_id_seq',              q: `INSERT INTO posts (id,name,short_name,ranking_order,is_default,is_system) VALUES ($1,$2,$3,$4,$5,$6)`,      vals: r => [r.id,r.name,r.short_name,r.ranking_order,r.is_default,r.is_system] },
      { rows: d.grades,            table: 'grades',             seq: 'grades_id_seq',             q: `INSERT INTO grades (id,name) VALUES ($1,$2)`,                                                               vals: r => [r.id,r.name] },
      { rows: d.employmentModes,   table: 'employment_modes',   seq: 'employment_modes_id_seq',   q: `INSERT INTO employment_modes (id,name,is_default,is_system) VALUES ($1,$2,$3,$4)`,                          vals: r => [r.id,r.name,r.is_default,r.is_system] },
      { rows: d.religions,         table: 'religions',          seq: 'religions_id_seq',          q: `INSERT INTO religions (id,name,is_default,is_system) VALUES ($1,$2,$3,$4)`,                                 vals: r => [r.id,r.name,r.is_default,r.is_system] },
      { rows: d.employeeStatuses,  table: 'employee_statuses',  seq: 'employee_statuses_id_seq',  q: `INSERT INTO employee_statuses (id,name,status_type,is_default,is_system) VALUES ($1,$2,$3,$4,$5)`,          vals: r => [r.id,r.name,r.status_type,r.is_default,r.is_system] },
      { rows: d.jobTimings,        table: 'job_timings',        seq: 'job_timings_id_seq',        q: `INSERT INTO job_timings (id,name,is_default,is_system) VALUES ($1,$2,$3,$4)`,                               vals: r => [r.id,r.name,r.is_default,r.is_system] },
      { rows: d.weekendHistory,    table: 'weekend_history',    seq: 'weekend_history_id_seq',    q: `INSERT INTO weekend_history (id,weekends,effective_date,changed_date,changed_by,reason) VALUES ($1,$2,$3,$4,$5,$6)`, vals: r => [r.id,JSON.stringify(r.weekends),r.effective_date,r.changed_date,r.changed_by,r.reason] },
    ];
    for (const { rows, table, seq, q, vals } of setupInserts) {
      for (const r of rows || []) await client.query(q, vals(r));
      if ((rows||[]).length) await client.query(`SELECT setval('${seq}', (SELECT MAX(id) FROM ${table}))`);
    }

    // Restore app_settings
    for (const s of d.appSettings || []) {
      await client.query(
        `INSERT INTO app_settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()`,
        [s.key, typeof s.value === 'string' ? s.value : JSON.stringify(s.value)]
      );
    }

    // Restore staff_notes (personal notes per user — must come after users)
    for (const n of d.staffNotes || []) {
      await client.query(
        `INSERT INTO staff_notes
           (id, user_id, note_name, note_type, note_details, username_title, username,
            password, security_type, totp_secret, gmail_account, remarks, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (id) DO NOTHING`,
        [n.id, n.user_id, n.note_name, n.note_type || 'normal', n.note_details,
         n.username_title, n.username, n.password, n.security_type || 'normal',
         n.totp_secret, n.gmail_account, n.remarks,
         n.created_at || new Date(), n.updated_at || new Date()]
      );
    }
    if ((d.staffNotes || []).length)
      await client.query(`SELECT setval('staff_notes_id_seq', (SELECT MAX(id) FROM staff_notes))`);

    await client.query('COMMIT');

    res.json({
      success  : true,
      migrated ,
      fromVersion: backupDbVersion,
      toVersion  : currentDbVersion,
      message  : migrated
        ? `Restored & migrated from DB v${backupDbVersion} → v${currentDbVersion}`
        : `Restored DB v${currentDbVersion} successfully`,
    });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

export default router;
