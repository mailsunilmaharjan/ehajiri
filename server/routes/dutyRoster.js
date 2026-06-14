import { Router } from 'express';
import pool from '../db.js';

const router = Router();

/* ── GET /api/duty-roster  — list all roster entries ── */
router.get('/', async (_req, res) => {
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
      ORDER BY dr.created_at DESC
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── POST /api/duty-roster  — create a roster entry ── */
router.post('/', async (req, res) => {
  const { employeeId, shiftId, dateFrom, dateTo, offDays, createdBy } = req.body;
  try {
    const { rows } = await pool.query(`
      INSERT INTO duty_roster (employee_id, shift_id, date_from, date_to, off_days, created_by)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, employee_id AS "employeeId", shift_id AS "shiftId",
                date_from AS "dateFrom", date_to AS "dateTo",
                off_days AS "offDays", created_by AS "createdBy", created_at AS "createdAt"
    `, [employeeId, shiftId || null, dateFrom, dateTo, JSON.stringify(offDays || []), createdBy]);
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── PUT /api/duty-roster/:id  — update a roster entry ── */
router.put('/:id', async (req, res) => {
  const { shiftId, dateFrom, dateTo, offDays } = req.body;
  try {
    const { rows } = await pool.query(`
      UPDATE duty_roster
      SET shift_id = $1, date_from = $2, date_to = $3, off_days = $4
      WHERE id = $5
      RETURNING id
    `, [shiftId || null, dateFrom, dateTo, JSON.stringify(offDays || []), req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── DELETE /api/duty-roster/clear  — bulk delete + re-seed default shift ── */
router.delete('/clear', async (req, res) => {
  const { dateFrom, dateTo, branch, department, position, grade, mode } = req.body;
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
    await pool.query('DELETE FROM duty_roster WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
