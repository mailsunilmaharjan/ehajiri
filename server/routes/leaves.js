import { Router } from 'express';
import pool from '../db.js';
import { logAudit } from '../services/auditLog.js';

const router = Router();

const toLeave = r => ({
  id             : r.id,
  employeeId     : r.employee_id,
  leaveTypeCode  : r.leave_type_code,
  fromDate       : r.from_date,
  toDate         : r.to_date,
  days           : parseFloat(r.days),
  reason         : r.reason,
  halfDay        : !!r.half_day,
  status         : r.status,
  appliedDate    : r.applied_date,
  approvedBy     : r.approved_by,
  approvedDate   : r.approved_date,
  comment        : r.comment,
  recommendedBy  : r.recommended_by,
});

/* ── Leave Types ── */
router.get('/types', async (_req, res) => {
  try { res.json((await pool.query('SELECT * FROM leave_types ORDER BY id')).rows.map(r => ({
    id: r.id, name: r.name, code: r.code, totalDays: r.total_days, color: r.color, nameEn: r.name_en
  }))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── Leave Balances ── */
router.get('/balances', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM leave_balances');
    // Group into { employeeId, AL:n, SL:n, ... }
    const map = {};
    rows.forEach(r => {
      if (!map[r.employee_id]) map[r.employee_id] = { employeeId: r.employee_id };
      map[r.employee_id][r.leave_type_code] = parseFloat(r.balance_days);
    });
    res.json(Object.values(map));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── Leaves CRUD ── */
router.get('/', async (_req, res) => {
  try { res.json((await pool.query('SELECT * FROM leaves ORDER BY id')).rows.map(toLeave)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
  const { employeeId, leaveTypeCode, fromDate, toDate, days, reason, halfDay,
          status, approvedBy, approvedDate } = req.body;

  const finalStatus  = ['approved','rejected','pending'].includes(status) ? status : 'pending';
  const finalAppBy   = finalStatus !== 'pending' ? (approvedBy   || null) : null;
  const finalAppDate = finalStatus !== 'pending' ? (approvedDate || new Date().toISOString().split('T')[0]) : null;

  try {
    const { rows } = await pool.query(
      `INSERT INTO leaves
         (employee_id,leave_type_code,from_date,to_date,days,reason,half_day,status,approved_by,approved_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [employeeId, leaveTypeCode, fromDate, toDate, days, reason, !!halfDay,
       finalStatus, finalAppBy, finalAppDate]
    );
    res.status(201).json(toLeave(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:id/recommend', async (req, res) => {
  const { recommendedBy } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE leaves SET recommended_by=$1 WHERE id=$2 RETURNING *`,
      [recommendedBy, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Leave not found' });
    res.json(toLeave(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:id/approve', async (req, res) => {
  const { approvedBy, comment } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE leaves SET status='approved', approved_by=$1, approved_date=CURRENT_DATE, comment=$2
       WHERE id=$3 RETURNING *`,
      [approvedBy, comment || '', req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Leave not found' });
    logAudit({ actor: req.user, action: 'approve', entity: 'leave', entityId: req.params.id, before: null, after: toLeave(rows[0]) });
    res.json(toLeave(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:id/reject', async (req, res) => {
  const { approvedBy, comment } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE leaves SET status='rejected', approved_by=$1, approved_date=CURRENT_DATE, comment=$2
       WHERE id=$3 RETURNING *`,
      [approvedBy, comment || '', req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Leave not found' });
    logAudit({ actor: req.user, action: 'reject', entity: 'leave', entityId: req.params.id, before: null, after: toLeave(rows[0]) });
    res.json(toLeave(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM leaves WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
