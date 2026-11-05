import { Router } from 'express';
import pool from '../db.js';
import { logAudit } from '../services/auditLog.js';
import { startStandaloneBridge, stopStandaloneBridge } from '../services/standaloneBridgeLauncher.js';
import { startStandaloneScheduler, stopStandaloneScheduler } from '../services/standaloneScheduler.js';
import { invalidateModuleFlagsCache, FLAG_KEYS } from '../utils/moduleFlags.js';
import { invalidateAppSettingsCache } from '../utils/appSettings.js';
import { requireRole } from '../middleware/roleGuard.js';

const router = Router();
// GET routes are readable by any authenticated role (employees need these to
// render their own dashboard); only writes are restricted to admin/superAdmin.
const canManageSettings = requireRole('admin', 'superAdmin');

/* ─── Generic key-value settings ─── */
router.get('/', async (_req, res) => {
  try {
    const [{ rows: settingsRows }, { rows: statusRows }, { rows: weekendRows }] = await Promise.all([
      pool.query('SELECT key, value FROM app_settings'),
      pool.query(`
        SELECT id, name,
               status_type  AS "statusType",
               is_default   AS "isDefault",
               is_system    AS "isSystem"
        FROM employee_statuses
        ORDER BY id
      `),
      pool.query(`
        SELECT id, weekends,
               effective_date AS "effectiveDate",
               changed_date   AS "changedDate",
               changed_by     AS "changedBy",
               reason
        FROM weekend_history
        ORDER BY effective_date
      `),
    ]);

    const obj = {};
    settingsRows.forEach(r => { obj[r.key] = r.value; });

    /* Always inject live statuses/weekend history from their dedicated tables
       so the frontend sees DB-authoritative data — these are what attendance
       reports actually query (weekend_history in particular drives every
       report's Present/Absent/Weekend classification), not whatever's cached
       in this generic blob. Reports never read app_settings directly, so a
       weekendHistory edit that only landed here would silently never apply. */
    if (statusRows.length > 0 || weekendRows.length > 0) {
      if (!obj.main) obj.main = {};
      obj.main = { ...(typeof obj.main === 'object' ? obj.main : {}) };
      if (statusRows.length > 0)  obj.main.statuses = statusRows;
      if (weekendRows.length > 0) obj.main.weekendHistory = weekendRows;
    }

    /* The setup lists below are edited through PUT /settings/:list/:id, which
       needs the REAL table id. A blob list can carry stale client-made ids
       (Date.now() timestamps — "value 1785664208899 is out of range for type
       integer" on edit), so re-key each list from its table, keeping any
       extra blob fields by matching id, then name. Empty table = leave alone. */
    if (obj.main && typeof obj.main === 'object') {
      obj.main = { ...obj.main };
      for (const key of ['branches', 'departments', 'posts', 'grades', 'modes', 'religions', 'jobTimings']) {
        const cfg = SETUP_TABLES[key];
        if (!cfg || !Array.isArray(obj.main[key])) continue;
        try {
          const { rows } = await pool.query(`SELECT id, ${cfg.cols.join(',')} FROM ${cfg.table} ORDER BY id`);
          if (!rows.length) continue;
          const blob = obj.main[key];
          const byId = new Map(blob.map(x => [String(x.id), x]));
          const byName = new Map(blob.map(x => [String(x.name || '').trim().toLowerCase(), x]));
          obj.main[key] = rows.map(r => {
            const live = snakeToCamel(r);
            const old = byName.get(String(r.name || "").trim().toLowerCase()) || byId.get(String(r.id)) || {};
            return { ...old, ...live };
          });
        } catch (e) { /* keep the blob list as-is */ }
      }
    }

    res.json(obj);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Every module toggle in Role & Permission Management → Module Controls is
// Super-Admin-only to flip — enforced here too, not just hidden client-side,
// so a plain Admin can't bypass it with a raw API call. Deliberately NOT
// license-gated: license.payload.features stays pure display (see
// server/utils/licenseFeatures.js) — a tenant's license record living in
// LicenseAdmin's central registry and the copy actually active on that
// tenant's own server can drift out of sync (editing a license there doesn't
// push it to the tenant), which made "Enable" dead-end with a confusing
// "not in your license" error even right after a license was updated. A
// straightforward Super-Admin on/off switch has no such failure mode.
const SUPER_ADMIN_ONLY_FLAGS = [
  FLAG_KEYS.onlineAttendance,
  FLAG_KEYS.dutyRoster,
  FLAG_KEYS.chat,
  FLAG_KEYS.task,
  FLAG_KEYS.guestRegistration,
  FLAG_KEYS.standaloneDevice,
  FLAG_KEYS.smsGateway,
  FLAG_KEYS.supportHelp,
];

router.put('/', canManageSettings, async (req, res) => {
  const settings = req.body; // { key: value, ... }

  for (const flagKey of SUPER_ADMIN_ONLY_FLAGS) {
    if (flagKey in settings && req.user.role !== 'superAdmin') {
      return res.status(403).json({ error: 'Only a Super Admin can change this module.' });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Settings → Official Setting's Post / Department / Branch lists (and the
    // company name, which doubles as the HQ branch) live in this `main` blob,
    // while staff records store those values by NAME. Renaming an entry used
    // to leave every staff member on the old text — it then matched nothing
    // (blank Staff Detail dropdowns, full names instead of short names in
    // reports). Carry renames through to users, matched by list entry id.
    if (settings.main && typeof settings.main === 'object') {
      const prevRow = (await client.query("SELECT value FROM app_settings WHERE key='main'")).rows[0];
      let prev = prevRow?.value;
      if (typeof prev === 'string') { try { prev = JSON.parse(prev); } catch { prev = null; } }
      if (prev && typeof prev === 'object') {
        const renames = [];
        for (const [listKey, col] of [['posts', 'position'], ['departments', 'department'], ['branches', 'branch']]) {
          const oldById = new Map((prev[listKey] || []).map(x => [String(x.id), x.name]));
          // An id used by more than one entry (seen live: two "Electrician"
          // posts sharing id 6) can't be matched reliably — skip it rather
          // than "renaming" staff back and forth between the duplicates.
          const idCount = {};
          [...(prev[listKey] || []), ...(settings.main[listKey] || [])].forEach(x => { idCount[String(x.id)] = (idCount[String(x.id)] || 0) + 1; });
          for (const x of (settings.main[listKey] || [])) {
            if (idCount[String(x.id)] > 2) continue;
            const oldName = oldById.get(String(x.id));
            if (oldName && x.name && oldName !== x.name) renames.push([col, oldName, x.name]);
          }
        }
        // Staff at HQ carry the HQ branch name — the Company Short Name, or
        // "Head Office" when unset (hqBranchName in src/utils/branchUtils.js).
        const hqName = (m) => String(m.companyShortName || '').trim() || 'Head Office';
        const nextMain = 'companyShortName' in settings.main
          ? settings.main
          : { ...settings.main, companyShortName: prev.companyShortName };
        const prevHQ = hqName(prev), nextHQ = hqName(nextMain);
        if (prevHQ && nextHQ && prevHQ !== nextHQ) {
          renames.push(['branch', prevHQ, nextHQ]);
        }
        for (const [col, oldName, newName] of renames) {
          await client.query(`UPDATE users SET ${col}=$1 WHERE ${col}=$2`, [newName, oldName]);
        }
      }
    }
    for (const [key, value] of Object.entries(settings)) {
      await client.query(
        `INSERT INTO app_settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()`,
        [key, JSON.stringify(value)]
      );
    }
    await client.query('COMMIT');
    logAudit({ actor: req.user, action: 'update', entity: 'settings', entityId: null, before: null, after: settings });

    if ('main' in settings) invalidateAppSettingsCache();

    if (FLAG_KEYS.standaloneDevice in settings) {
      invalidateModuleFlagsCache();
      if (settings[FLAG_KEYS.standaloneDevice]) {
        await startStandaloneBridge();
        startStandaloneScheduler();
      } else {
        stopStandaloneScheduler();
        stopStandaloneBridge();
      }
    } else if (FLAG_KEYS.attendanceDevice in settings) {
      invalidateModuleFlagsCache();
    } else if (
      FLAG_KEYS.onlineAttendance in settings || FLAG_KEYS.dutyRoster in settings ||
      FLAG_KEYS.chat in settings || FLAG_KEYS.task in settings || FLAG_KEYS.guestRegistration in settings ||
      FLAG_KEYS.supportHelp in settings
    ) {
      invalidateModuleFlagsCache();
    }

    res.json({ success: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

/* ─── Setup lists (fiscal years, departments, etc.) ─── */
const SETUP_TABLES = {
  fiscalYears      : { table: 'fiscal_years',      cols: ['name','start_date','end_date','is_default','is_system'] },
  branches         : { table: 'branches',           cols: ['name','short_name','address','phone','ranking_order'] },
  departments      : { table: 'departments',        cols: ['name','short_name','ranking_order','is_default','is_system'] },
  posts            : { table: 'posts',              cols: ['name','short_name','ranking_order','is_default','is_system'] },
  grades           : { table: 'grades',             cols: ['name'] },
  modes            : { table: 'employment_modes',   cols: ['name','is_default','is_system'] },
  religions        : { table: 'religions',          cols: ['name','is_default','is_system'] },
  statuses         : { table: 'employee_statuses',  cols: ['name','status_type','is_default','is_system'] },
  jobTimings       : { table: 'job_timings',        cols: ['name','is_default','is_system'] },
  weekendHistory   : { table: 'weekend_history',    cols: ['weekends','effective_date','changed_date','changed_by','reason'] },
  taskCategories   : { table: 'task_categories',    cols: ['name','ranking_order'] },
  taskPriorities   : { table: 'task_priorities',    cols: ['name','color','ranking_order'] },
  payrollItems     : { table: 'payroll_items',      cols: ['name','type','calc_method','calc_value','formula','taxable','payment_mode','category','applies_gender','prorate','ranking_order'] },
  payrollTaxSlabs  : { table: 'payroll_tax_slabs',  cols: ['yearly_income_slab','effective_date','income_from','income_to','rate_percent','applies_to','is_sst','ranking_order'] },
};

/* Role / staff page permissions (Settings → Role & Permission Management).
   Stored server-side so a change made by an admin applies to every user —
   it used to live only in the admin's own browser localStorage, so other
   logins (e.g. a Branch Manager) never saw their pages disabled. Any
   authenticated user may read it (their own client enforces it); writes go
   through PUT / with key `page_permissions`, which is admin-only. */
router.get('/page-permissions', async (_req, res) => {
  try {
    const { rows } = await pool.query("SELECT value FROM app_settings WHERE key='page_permissions'");
    let v = rows[0]?.value ?? null;
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = null; } }
    res.json(v && typeof v === 'object' ? v : {});
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:list', async (req, res) => {
  const cfg = (Object.hasOwn(SETUP_TABLES, req.params.list) ? SETUP_TABLES[req.params.list] : undefined);
  if (!cfg) return res.status(404).json({ error: 'Unknown list' });
  try {
    const { rows } = await pool.query(`SELECT * FROM ${cfg.table} ORDER BY id`);
    res.json(rows.map(snakeToCamel));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:list', canManageSettings, async (req, res) => {
  const cfg = (Object.hasOwn(SETUP_TABLES, req.params.list) ? SETUP_TABLES[req.params.list] : undefined);
  if (!cfg) return res.status(404).json({ error: 'Unknown list' });
  const vals = cfg.cols.map(c => camelVal(req.body, c));
  const placeholders = cfg.cols.map((_, i) => `$${i + 1}`).join(',');
  try {
    const { rows } = await pool.query(
      `INSERT INTO ${cfg.table} (${cfg.cols.join(',')}) VALUES (${placeholders}) RETURNING *`,
      vals
    );
    res.status(201).json(snakeToCamel(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:list/:id', canManageSettings, async (req, res) => {
  const cfg = (Object.hasOwn(SETUP_TABLES, req.params.list) ? SETUP_TABLES[req.params.list] : undefined);
  if (!cfg) return res.status(404).json({ error: 'Unknown list' });
  const sets = cfg.cols.map((c, i) => `${c}=$${i + 1}`).join(',');
  const vals = [...cfg.cols.map(c => camelVal(req.body, c)), req.params.id];
  // Staff records store Branch / Department / Post by NAME (users.branch /
  // .department / .position), not id — so renaming one here used to leave
  // every staff member on the old text, which then matched nothing in
  // Settings (blank Staff Detail dropdowns, full names instead of short names
  // in reports). Carry the rename through to users in the same transaction.
  const USER_COL = { branches: 'branch', departments: 'department', posts: 'position' }[req.params.list];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const before = USER_COL
      ? (await client.query(`SELECT name FROM ${cfg.table} WHERE id=$1`, [req.params.id])).rows[0]
      : null;
    const { rows } = await client.query(
      `UPDATE ${cfg.table} SET ${sets} WHERE id=$${vals.length} RETURNING *`, vals
    );
    // No row matched — an id that no longer exists (e.g. already deleted, or
    // a stale id lingering in client state). Without this check, rows[0] is
    // undefined and res.json(undefined) sends a 200 with a completely empty
    // body, which the client's fetch wrapper then fails to parse as JSON —
    // a real failure disguised as a crash instead of a clear error.
    if (!rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Record not found — it may have already been deleted.' }); }
    const oldName = before?.name, newName = rows[0].name;
    if (USER_COL && oldName && newName && oldName !== newName) {
      await client.query(`UPDATE users SET ${USER_COL}=$1 WHERE ${USER_COL}=$2`, [newName, oldName]);
    }
    await client.query('COMMIT');
    res.json(snakeToCamel(rows[0]));
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

router.delete('/:list/:id', canManageSettings, async (req, res) => {
  const cfg = (Object.hasOwn(SETUP_TABLES, req.params.list) ? SETUP_TABLES[req.params.list] : undefined);
  if (!cfg) return res.status(404).json({ error: 'Unknown list' });
  try {
    await pool.query(`DELETE FROM ${cfg.table} WHERE id=$1`, [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ─── helpers ─── */
function snakeToCamel(obj) {
  if (!obj) return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const camel = k.replace(/_([a-z])/g, (_, l) => l.toUpperCase());
    out[camel] = v;
  }
  return out;
}

function camelVal(body, snakeKey) {
  const camel = snakeKey.replace(/_([a-z])/g, (_, l) => l.toUpperCase());
  const val = body[camel] ?? body[snakeKey];
  // `typeof null === 'object'` in JS — without this check, a field a caller
  // deliberately sent as null (e.g. Payroll Items' formula, unused unless
  // calcMethod is 'formula') got JSON.stringify'd into the literal string
  // "null" instead of a real SQL NULL.
  if (val !== undefined && val !== null && typeof val === 'object') return JSON.stringify(val);
  // A blank form field arrives as "" — for an integer/date column (e.g. a
  // Post with no Ranking Order) Postgres rejects that outright ("invalid
  // input syntax for type integer"), so every edit of such a row failed.
  // Blank means "not set": store NULL.
  if (typeof val === 'string' && val.trim() === '') return null;
  return val ?? null;
}

export default router;
