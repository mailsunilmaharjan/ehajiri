import { Router } from 'express';
import pool from '../db.js';
import { logAudit } from '../services/auditLog.js';

const router = Router();

const toVisit = r => ({
  id            : r.id,
  employeeId    : r.employee_id,
  purpose       : r.purpose,
  location      : r.location,
  fromDate      : r.from_date,
  fromTime      : r.from_time,
  toDate        : r.to_date,
  toTime        : r.to_time,
  description   : r.description,
  status        : r.status,
  appliedDate   : r.applied_date,
  approvedBy    : r.approved_by,
  approvedDate  : r.approved_date,
  comment       : r.comment,
  recommendedBy : r.recommended_by,
});

router.get('/', async (_req, res) => {
  try { res.json((await pool.query('SELECT * FROM office_visits ORDER BY id')).rows.map(toVisit)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
  const { employeeId,purpose,location,fromDate,fromTime,toDate,toTime,description } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO office_visits (employee_id,purpose,location,from_date,from_time,to_date,to_time,description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [employeeId,purpose,location,fromDate,fromTime,toDate,toTime,description]
    );
    res.status(201).json(toVisit(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:id/recommend', async (req, res) => {
  const { recommendedBy } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE office_visits SET recommended_by=$1 WHERE id=$2 RETURNING *`,
      [recommendedBy, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Visit not found' });
    res.json(toVisit(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:id/approve', async (req, res) => {
  const { approvedBy, comment } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE office_visits SET status='approved', approved_by=$1, approved_date=CURRENT_DATE, comment=$2
       WHERE id=$3 RETURNING *`,
      [approvedBy, comment || '', req.params.id]
    );
    if (rows[0]) logAudit({ actor: req.user, action: 'approve', entity: 'visit', entityId: req.params.id, before: null, after: toVisit(rows[0]) });
    res.json(toVisit(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:id/reject', async (req, res) => {
  const { approvedBy, comment } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE office_visits SET status='rejected', approved_by=$1, approved_date=CURRENT_DATE, comment=$2
       WHERE id=$3 RETURNING *`,
      [approvedBy, comment || '', req.params.id]
    );
    if (rows[0]) logAudit({ actor: req.user, action: 'reject', entity: 'visit', entityId: req.params.id, before: null, after: toVisit(rows[0]) });
    res.json(toVisit(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM office_visits WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
