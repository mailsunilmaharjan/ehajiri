import { Router } from 'express';
import pool from '../db.js';
import { resolveOrgScope } from './orgScope.js';

const router = Router();

const DAY_KEYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Appends the requester's org-scope condition to a WHERE clause targeting users u / duty_roster dr. */
function scopeCondition(scope, params) {
  if (scope.level === 'department') { params.push(scope.value); return `AND u.department = $${params.length}`; }
  if (scope.level === 'branch')     { params.push(scope.value); return `AND u.branch = $${params.length}`; }
  if (scope.level === 'self')       { params.push(scope.value); return `AND dr.employee_id = $${params.length}`; }
  return '';
}

/** True if the given employee row falls within the requester's org scope. */
async function isEmployeeInScope(scope, employeeId) {
  if (scope.level === 'all') return true;
  if (scope.level === 'self') return String(scope.value) === String(employeeId);
  const field = scope.level === 'department' ? 'department' : 'branch';
  const { rows } = await pool.query(`SELECT 1 FROM users WHERE id=$1 AND ${field}=$2`, [employeeId, scope.value]);
  return rows.length > 0;
}

/* ── GET /api/duty-roster  — list roster entries within the requester's scope ── */
router.get('/', async (req, res) => {
  const scope = resolveOrgScope(req);
  const params = [];
  const cond = scopeCondition(scope, params);
  try {
    const { rows } = await pool.query(`
      SELECT
        dr.id,
        u.employee_id    AS "staffId",
        u.full_name      AS "employeeName",
        u.department,
        u.position,
        u.branch,
        u.phone,
        u.email,
        u.device_id      AS "deviceId",
        u.gender,
        u.grade,
        u.active,
        dr.employee_id          AS "employeeDbId",
        dr.shift_id             AS "shiftId",
        dr.shift_ids            AS "shiftIds",
        s.name                  AS "shiftName",
        s.start_time::text      AS "startTime",
        s.end_time::text        AS "endTime",
        dr.date_from::text      AS "dateFrom",
        dr.date_to::text        AS "dateTo",
        dr.off_days      AS "offDays",
        dr.created_by    AS "createdBy",
        dr.created_at    AS "createdAt"
      FROM duty_roster dr
      JOIN users  u ON u.id = dr.employee_id
      LEFT JOIN shifts s ON s.id = dr.shift_id
      WHERE 1=1 ${cond}
      ORDER BY dr.created_at DESC
    `, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── POST /api/duty-roster  — create a roster entry (target employee must be in-scope) ──
   Accepts either the new shiftIds (array, order = rotation order across the date
   range) or the legacy single shiftId — shift_id is always kept as shiftIds[0] so
   any older code path still reading the single column keeps working. */
router.post('/', async (req, res) => {
  const { employeeId, shiftId, shiftIds, dateFrom, dateTo, offDays, createdBy } = req.body;
  const ids = Array.isArray(shiftIds) && shiftIds.length ? shiftIds : (shiftId ? [shiftId] : []);
  try {
    const scope = resolveOrgScope(req);
    if (scope.level === 'self' || !(await isEmployeeInScope(scope, employeeId))) {
      return res.status(403).json({ error: 'Not authorized to create a roster entry for this employee' });
    }
    const { rows } = await pool.query(`
      INSERT INTO duty_roster (employee_id, shift_id, shift_ids, date_from, date_to, off_days, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, employee_id AS "employeeId", shift_id AS "shiftId", shift_ids AS "shiftIds",
                date_from AS "dateFrom", date_to AS "dateTo",
                off_days AS "offDays", created_by AS "createdBy", created_at AS "createdAt"
    `, [employeeId, ids[0] || null, JSON.stringify(ids), dateFrom, dateTo, JSON.stringify(offDays || []), createdBy]);
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── PUT /api/duty-roster/:id  — update a roster entry (must be in-scope) ── */
router.put('/:id', async (req, res) => {
  const { shiftId, shiftIds, dateFrom, dateTo, offDays } = req.body;
  const ids = Array.isArray(shiftIds) && shiftIds.length ? shiftIds : (shiftId ? [shiftId] : []);
  try {
    const scope = resolveOrgScope(req);
    const { rows: existing } = await pool.query('SELECT employee_id FROM duty_roster WHERE id=$1', [req.params.id]);
    if (!existing.length) return res.status(404).json({ error: 'Not found' });
    if (scope.level === 'self' || !(await isEmployeeInScope(scope, existing[0].employee_id))) {
      return res.status(403).json({ error: 'Not authorized to edit this roster entry' });
    }
    const { rows } = await pool.query(`
      UPDATE duty_roster
      SET shift_id = $1, shift_ids = $2, date_from = $3, date_to = $4, off_days = $5
      WHERE id = $6
      RETURNING id
    `, [ids[0] || null, JSON.stringify(ids), dateFrom, dateTo, JSON.stringify(offDays || []), req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── POST /api/duty-roster/bulk-days  — Calendar View + Exchange Duty: upsert
   one single-day roster row (date_from = date_to = date) per date, for one
   employee, in one transaction. shiftIds empty/omitted means "clear" —
   deletes the exact single-day row for that date if one exists, leaves
   everything else alone (the day then falls back to whatever a broader
   roster entry or the default shift would give). shiftIds containing the
   'OFF' sentinel (same convention as the frontend's per-cell values) marks
   that single day OFF via off_days instead of assigning a shift.

   forceBlank (Department Wise "Edit Shifts" grid only): when true AND
   shiftIds is empty, UPSERTS a row pinned to the company's default shift
   (make_default=true) instead of deleting. Needed because that grid always
   saves ONE base roster entry spanning the whole searched period (the
   period's most-common shift) plus per-day overrides for whatever differs
   from it — a day the admin deliberately left blank differs from that base
   shift too, but a plain delete/no-op just falls through to the (non-blank)
   base entry underneath it, silently resurrecting a shift the admin never
   asked for on that date. Keeping a narrow row pinned to the default shift
   here means pickMostSpecificRoster/getEffectiveRoster resolve that exact
   date to the default shift — same outcome as "no roster entry at all"
   everywhere else in the app, but now visible in the grid instead of
   showing as a blank dash — rather than the wider (non-default) entry
   winning. ── */
router.post('/bulk-days', async (req, res) => {
  const { employeeId, dates, shiftIds, createdBy, forceBlank } = req.body;
  const rawIds = Array.isArray(shiftIds) ? shiftIds : [];
  const isOff  = rawIds.includes('OFF');
  const ids    = isOff ? [] : rawIds;
  if (!employeeId || !Array.isArray(dates) || !dates.length) {
    return res.status(400).json({ error: 'employeeId and dates[] are required' });
  }
  const scope = resolveOrgScope(req);
  if (scope.level === 'self' || !(await isEmployeeInScope(scope, employeeId))) {
    return res.status(403).json({ error: 'Not authorized to edit this roster entry' });
  }
  let defaultShiftId = null;
  if (forceBlank && !isOff && !ids.length) {
    const { rows: defRows } = await pool.query(`SELECT id FROM shifts WHERE make_default = TRUE LIMIT 1`);
    defaultShiftId = defRows[0]?.id ?? null;
  }
  const client = await pool.connect();
  let created = 0, updated = 0, deleted = 0;
  try {
    await client.query('BEGIN');
    for (const date of dates) {
      const { rows: existing } = await client.query(
        `SELECT id FROM duty_roster WHERE employee_id=$1 AND date_from=$2 AND date_to=$2`,
        [employeeId, date]
      );
      if (isOff) {
        const offDays = JSON.stringify([DAY_KEYS[new Date(date).getUTCDay()]]);
        if (existing.length) {
          await client.query(
            `UPDATE duty_roster SET shift_id=NULL, shift_ids='[]', off_days=$1 WHERE id=$2`,
            [offDays, existing[0].id]
          );
          updated++;
        } else {
          await client.query(
            `INSERT INTO duty_roster (employee_id, shift_id, shift_ids, date_from, date_to, off_days, created_by)
             VALUES ($1, NULL, '[]', $2, $2, $3, $4)`,
            [employeeId, date, offDays, createdBy]
          );
          created++;
        }
      } else if (ids.length) {
        if (existing.length) {
          await client.query(
            `UPDATE duty_roster SET shift_id=$1, shift_ids=$2, off_days='[]' WHERE id=$3`,
            [ids[0], JSON.stringify(ids), existing[0].id]
          );
          updated++;
        } else {
          await client.query(
            `INSERT INTO duty_roster (employee_id, shift_id, shift_ids, date_from, date_to, off_days, created_by)
             VALUES ($1, $2, $3, $4, $4, '[]', $5)`,
            [employeeId, ids[0], JSON.stringify(ids), date, createdBy]
          );
          created++;
        }
      } else if (forceBlank) {
        const defIds = defaultShiftId ? [defaultShiftId] : [];
        if (existing.length) {
          await client.query(
            `UPDATE duty_roster SET shift_id=$1, shift_ids=$2, off_days='[]' WHERE id=$3`,
            [defaultShiftId, JSON.stringify(defIds), existing[0].id]
          );
          updated++;
        } else {
          await client.query(
            `INSERT INTO duty_roster (employee_id, shift_id, shift_ids, date_from, date_to, off_days, created_by)
             VALUES ($1, $2, $3, $4, $4, '[]', $5)`,
            [employeeId, defaultShiftId, JSON.stringify(defIds), date, createdBy]
          );
          created++;
        }
      } else if (existing.length) {
        await client.query(`DELETE FROM duty_roster WHERE id=$1`, [existing[0].id]);
        deleted++;
      }
    }
    await client.query('COMMIT');
    res.json({ success: true, created, updated, deleted });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

/* ── DELETE /api/duty-roster/clear  — bulk delete + re-seed default shift ── */
router.delete('/clear', async (req, res) => {
  const { dateFrom, dateTo, branch, department, position, grade, mode } = req.body;
  const scope = resolveOrgScope(req);
  if (scope.level === 'self') {
    return res.status(403).json({ error: 'Not authorized to bulk-clear roster entries' });
  }
  try {
    // ── Build DELETE filter ────────────────────────────────────────────────
    const conds  = ['dr.employee_id = u.id'];
    const params = [];

    if (dateFrom)   { params.push(dateFrom);   conds.push(`dr.date_to   >= $${params.length}`); }
    if (dateTo)     { params.push(dateTo);     conds.push(`dr.date_from <= $${params.length}`); }
    if (branch)     { params.push(branch);     conds.push(`u.branch      = $${params.length}`); }
    if (department) { params.push(department); conds.push(`u.department  = $${params.length}`); }
    if (position)   { params.push(position);   conds.push(`u.position    = $${params.length}`); }
    if (grade)      { params.push(grade);      conds.push(`u.grade       = $${params.length}`); }

    // "Working only" means active employees — NOT a value stored in u.mode
    if (mode === 'Working') {
      conds.push(`u.active = TRUE`);
    } else if (mode) {
      params.push(mode);
      conds.push(`u.mode = $${params.length}`);
    }

    // Requester's org-scope always narrows the delete, regardless of the caller-supplied filters above.
    if (scope.level === 'department') { params.push(scope.value); conds.push(`u.department = $${params.length}`); }
    if (scope.level === 'branch')     { params.push(scope.value); conds.push(`u.branch = $${params.length}`); }

    const { rowCount } = await pool.query(
      `DELETE FROM duty_roster dr USING users u WHERE ${conds.join(' AND ')}`,
      params
    );

    // ── Auto-seed default shift for all matching staff with no roster ──────
    // Find the default shift
    const shiftRes = await pool.query(
      `SELECT id FROM shifts WHERE make_default = TRUE AND active = TRUE LIMIT 1`
    );
    const defaultShiftId = shiftRes.rows[0]?.id ?? null;

    let seeded = 0;
    if (defaultShiftId && dateFrom && dateTo) {
      // Find all matching active staff who have no roster row in the given range
      const staffConds  = ['u.active = TRUE'];
      const staffParams = [];

      if (branch)     { staffParams.push(branch);     staffConds.push(`u.branch     = $${staffParams.length}`); }
      if (department) { staffParams.push(department); staffConds.push(`u.department = $${staffParams.length}`); }
      if (position)   { staffParams.push(position);   staffConds.push(`u.position   = $${staffParams.length}`); }
      if (grade)      { staffParams.push(grade);      staffConds.push(`u.grade      = $${staffParams.length}`); }
      if (mode && mode !== 'Working') {
        staffParams.push(mode);
        staffConds.push(`u.mode = $${staffParams.length}`);
      }
      if (scope.level === 'department') { staffParams.push(scope.value); staffConds.push(`u.department = $${staffParams.length}`); }
      if (scope.level === 'branch')     { staffParams.push(scope.value); staffConds.push(`u.branch = $${staffParams.length}`); }

      staffParams.push(dateFrom);
      staffParams.push(dateTo);
      const dfIdx = staffParams.length - 1;
      const dtIdx = staffParams.length;

      const { rows: staff } = await pool.query(
        `SELECT u.id FROM users u
         WHERE ${staffConds.join(' AND ')}
           AND NOT EXISTS (
             SELECT 1 FROM duty_roster dr
             WHERE dr.employee_id = u.id
               AND dr.date_to   >= $${dfIdx}
               AND dr.date_from <= $${dtIdx}
           )`,
        staffParams
      );

      for (const s of staff) {
        await pool.query(
          `INSERT INTO duty_roster (employee_id, shift_id, date_from, date_to, off_days, created_by)
           VALUES ($1, $2, $3, $4, '[]', 'system')
           ON CONFLICT DO NOTHING`,
          [s.id, defaultShiftId, dateFrom, dateTo]
        );
        seeded++;
      }
    }

    res.json({ success: true, deleted: rowCount, seeded, defaultShiftId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── DELETE /api/duty-roster/:id ── */
router.delete('/:id', async (req, res) => {
  try {
    const scope = resolveOrgScope(req);
    const { rows: existing } = await pool.query('SELECT employee_id FROM duty_roster WHERE id=$1', [req.params.id]);
    if (!existing.length) return res.status(404).json({ error: 'Not found' });
    if (scope.level === 'self' || !(await isEmployeeInScope(scope, existing[0].employee_id))) {
      return res.status(403).json({ error: 'Not authorized to delete this roster entry' });
    }
    await pool.query('DELETE FROM duty_roster WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
