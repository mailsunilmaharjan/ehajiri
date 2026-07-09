import { Router } from 'express';
import pool from '../db.js';
import { logAudit } from '../services/auditLog.js';
import { sendOfficeVisitApplication, sendOfficeVisitStatusUpdate } from '../services/emailService.js';
import { logError } from '../utils/logError.js';

const router = Router();

/* Best-effort email lookup + send — never let a notification failure affect the request. */
async function notifyVisitApplication(visit) {
  try {
    const recommendedBy = Array.isArray(visit.reco) ? visit.reco[0] : (visit.recommendedBy || visit.reco || null);
    const approvedBy    = Array.isArray(visit.approval) ? visit.approval[0] : (visit.approval || null);
    const ids = [recommendedBy, approvedBy].filter(Boolean).map(Number);
    if (!ids.length) return;

    const [{ rows: recipients }, { rows: [requester] }] = await Promise.all([
      pool.query(`SELECT email FROM users WHERE id = ANY($1::int[]) AND email IS NOT NULL AND email != ''`, [ids]),
      pool.query('SELECT full_name FROM users WHERE id=$1', [visit.employeeId]),
    ]);
    for (const r of recipients) {
      await sendOfficeVisitApplication({
        to: r.email, fullName: requester?.full_name || '', destination: visit.location,
        fromDate: visit.fromDate, toDate: visit.toDate, purpose: visit.purpose,
      });
    }
  } catch (err) {
    logError('[visits notifyVisitApplication]', err);
  }
}

async function notifyVisitStatusUpdate(visit) {
  try {
    const { rows: [employee] } = await pool.query('SELECT email, full_name FROM users WHERE id=$1', [visit.employeeId]);
    if (!employee?.email) return;
    await sendOfficeVisitStatusUpdate({
      to: employee.email, fullName: employee.full_name, status: visit.status,
      fromDate: visit.fromDate, toDate: visit.toDate, comment: visit.comment,
    });
  } catch (err) {
    logError('[visits notifyVisitStatusUpdate]', err);
  }
}

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
  const { employeeId,purpose,location,fromDate,fromTime,toDate,toTime,description,reco,approval } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO office_visits (employee_id,purpose,location,from_date,from_time,to_date,to_time,description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [employeeId,purpose,location,fromDate,fromTime,toDate,toTime,description]
    );
    const visit = toVisit(rows[0]);
    notifyVisitApplication({ ...visit, reco, approval });
    res.status(201).json(visit);
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
    if (rows[0]) {
      const visit = toVisit(rows[0]);
      logAudit({ actor: req.user, action: 'approve', entity: 'visit', entityId: req.params.id, before: null, after: visit });
      notifyVisitStatusUpdate(visit);
    }
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
    if (rows[0]) {
      const visit = toVisit(rows[0]);
      logAudit({ actor: req.user, action: 'reject', entity: 'visit', entityId: req.params.id, before: null, after: visit });
      notifyVisitStatusUpdate(visit);
    }
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
