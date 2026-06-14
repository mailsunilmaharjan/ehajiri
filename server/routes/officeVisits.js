import { Router } from 'express';
import pool from '../db.js';

const router = Router();

const mapRow = (r) => ({
  id: r.id,
  employeeId: r.employee_id,
  purpose: r.purpose,
  location: r.location,
  fromDate: r.from_date,
  fromTime: r.from_time,
  toDate: r.to_date,
  toTime: r.to_time,
  description: r.description,
  status: r.status,
  appliedDate: r.applied_date,
  approvedBy: r.approved_by,
  approvedDate: r.approved_date,
  comment: r.comment,
});

// GET /api/office-visits
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, employee_id, purpose, location,
              to_char(from_date,'YYYY-MM-DD') AS from_date, from_time,
              to_char(to_date,'YYYY-MM-DD')   AS to_date,   to_time,
              description, status,
              to_char(applied_date,'YYYY-MM-DD')  AS applied_date,
              approved_by,
              to_char(approved_date,'YYYY-MM-DD') AS approved_date,
              comment
       FROM office_visits ORDER BY id ASC`
    );
    res.json(rows.map(mapRow));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/office-visits
router.post('/', async (req, res) => {
  const { employeeId, purpose, location, fromDate, fromTime, toDate, toTime, description } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO office_visits (employee_id,purpose,location,from_date,from_time,to_date,to_time,description,applied_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,CURRENT_DATE)
       RETURNING id, employee_id, purpose, location,
                 to_char(from_date,'YYYY-MM-DD') AS from_date, from_time,
                 to_char(to_date,'YYYY-MM-DD') AS to_date, to_time,
                 description, status,
                 to_char(applied_date,'YYYY-MM-DD') AS applied_date,
                 approved_by, approved_date, comment`,
      [employeeId, purpose, location, fromDate, fromTime, toDate, toTime, description]
    );
    res.status(201).json(mapRow(rows[0]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/office-visits/:id
router.put('/:id', async (req, res) => {
  const { status, approvedBy, comment, purpose, location, fromDate, fromTime, toDate, toTime, description } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE office_visits
       SET status=$1,
           approved_by=$2,
           approved_date=CASE WHEN $1 IN ('approved','rejected') THEN CURRENT_DATE ELSE NULL END,
           comment=$3,
           purpose=COALESCE($4,purpose), location=COALESCE($5,location),
           from_date=COALESCE($6,from_date), from_time=COALESCE($7,from_time),
           to_date=COALESCE($8,to_date), to_time=COALESCE($9,to_time),
           description=COALESCE($10,description)
       WHERE id=$11
       RETURNING id, employee_id, purpose, location,
                 to_char(from_date,'YYYY-MM-DD') AS from_date, from_time,
                 to_char(to_date,'YYYY-MM-DD') AS to_date, to_time,
                 description, status,
                 to_char(applied_date,'YYYY-MM-DD') AS applied_date,
                 approved_by,
                 to_char(approved_date,'YYYY-MM-DD') AS approved_date,
                 comment`,
      [status, approvedBy ?? null, comment ?? null, purpose ?? null, location ?? null,
       fromDate ?? null, fromTime ?? null, toDate ?? null, toTime ?? null, description ?? null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(mapRow(rows[0]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/office-visits/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM office_visits WHERE id=$1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
