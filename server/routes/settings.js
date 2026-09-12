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
      FLAG_KEYS.chat in settings || FLAG_KEYS.task in settings || FLAG_KEYS.guestRegistration in settings
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
  payrollItems     : { table: 'payroll_items',      cols: ['name','type','calc_method','calc_value','formula','taxable','ranking_order'] },
  payrollTaxSlabs  : { table: 'payroll_tax_slabs',  cols: ['yearly_income_slab','effective_date','income_from','income_to','rate_percent','ranking_order'] },
};

router.get('/:list', async (req, res) => {
  const cfg = SETUP_TABLES[req.params.list];
  if (!cfg) return res.status(404).json({ error: 'Unknown list' });
  try {
    const { rows } = await pool.query(`SELECT * FROM ${cfg.table} ORDER BY id`);
    res.json(rows.map(snakeToCamel));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:list', canManageSettings, async (req, res) => {
  const cfg = SETUP_TABLES[req.params.list];
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
  const cfg = SETUP_TABLES[req.params.list];
  if (!cfg) return res.status(404).json({ error: 'Unknown list' });
  const sets = cfg.cols.map((c, i) => `${c}=$${i + 1}`).join(',');
  const vals = [...cfg.cols.map(c => camelVal(req.body, c)), req.params.id];
  try {
    const { rows } = await pool.query(
      `UPDATE ${cfg.table} SET ${sets} WHERE id=$${vals.length} RETURNING *`, vals
    );
    // No row matched — an id that no longer exists (e.g. already deleted, or
    // a stale id lingering in client state). Without this check, rows[0] is
    // undefined and res.json(undefined) sends a 200 with a completely empty
    // body, which the client's fetch wrapper then fails to parse as JSON —
    // a real failure disguised as a crash instead of a clear error.
    if (!rows[0]) return res.status(404).json({ error: 'Record not found — it may have already been deleted.' });
    res.json(snakeToCamel(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:list/:id', canManageSettings, async (req, res) => {
  const cfg = SETUP_TABLES[req.params.list];
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
  return val ?? null;
}

export default router;
