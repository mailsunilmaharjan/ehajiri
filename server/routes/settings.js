import { Router } from 'express';
import pool from '../db.js';
import { logAudit } from '../services/auditLog.js';
import { startStandaloneBridge, stopStandaloneBridge } from '../services/standaloneBridgeLauncher.js';
import { startStandaloneScheduler, stopStandaloneScheduler } from '../services/standaloneScheduler.js';
import { invalidateModuleFlagsCache, FLAG_KEYS } from '../utils/moduleFlags.js';
import { requireRole } from '../middleware/roleGuard.js';

const router = Router();
// GET routes are readable by any authenticated role (employees need these to
// render their own dashboard); only writes are restricted to admin/superAdmin.
const canManageSettings = requireRole('admin', 'superAdmin');

/* ─── Generic key-value settings ─── */
router.get('/', async (_req, res) => {
  try {
    const [{ rows: settingsRows }, { rows: statusRows }] = await Promise.all([
      pool.query('SELECT key, value FROM app_settings'),
      pool.query(`
        SELECT id, name,
               status_type  AS "statusType",
               is_default   AS "isDefault",
               is_system    AS "isSystem"
        FROM employee_statuses
        ORDER BY id
      `),
    ]);

    const obj = {};
    settingsRows.forEach(r => { obj[r.key] = r.value; });

    /* Always inject live statuses from the dedicated table so the frontend
       sees DB-authoritative system data even before the user saves settings. */
    if (statusRows.length > 0) {
      if (!obj.main) obj.main = {};
      obj.main = { ...(typeof obj.main === 'object' ? obj.main : {}), statuses: statusRows };
    }

    res.json(obj);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/', canManageSettings, async (req, res) => {
  const settings = req.body; // { key: value, ... }
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
  branches         : { table: 'branches',           cols: ['name','short_name','address','phone'] },
  departments      : { table: 'departments',        cols: ['name','short_name','ranking_order','is_default','is_system'] },
  posts            : { table: 'posts',              cols: ['name','short_name','ranking_order','is_default','is_system'] },
  grades           : { table: 'grades',             cols: ['name'] },
  modes            : { table: 'employment_modes',   cols: ['name','is_default','is_system'] },
  religions        : { table: 'religions',          cols: ['name','is_default','is_system'] },
  statuses         : { table: 'employee_statuses',  cols: ['name','status_type','is_default','is_system'] },
  jobTimings       : { table: 'job_timings',        cols: ['name','is_default','is_system'] },
  weekendHistory   : { table: 'weekend_history',    cols: ['weekends','effective_date','changed_date','changed_by','reason'] },
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
  if (val !== undefined && typeof val === 'object') return JSON.stringify(val);
  return val ?? null;
}

export default router;
