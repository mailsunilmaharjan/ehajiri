import { Router } from 'express';
import pool from '../db.js';
import { logAudit } from '../services/auditLog.js';
import { sendLeaveApplication, sendLeaveStatusUpdate } from '../services/emailService.js';
import { logError } from '../utils/logError.js';
import { isLeaveBackdateEnabled } from '../utils/appSettings.js';

const router = Router();

/* Rejects fromDate values before today when the Super Admin has disabled
   backdating (Settings → Leave & Office Visit Backdate Apply). Frontend date
   pickers already disable past dates in this case, but that's trivially
   bypassed via a direct API call, so this is the real enforcement point.
   allowPast overrides this regardless of the setting — reserved for an
   admin's Manual Posting entry (backfilling/correcting records is the whole
   point of that form), never the normal self-service Apply flow. */
async function rejectIfBackdated(fromDate, res, allowPast) {
  if (!fromDate || allowPast || await isLeaveBackdateEnabled()) return false;
  const { rows } = await pool.query('SELECT CURRENT_DATE::text AS today');
  if (fromDate < rows[0].today) {
    res.status(400).json({ error: 'Backdated leave applications are currently disabled. Please select today or a later date.' });
    return true;
  }
  return false;
}

/* Manual Posting + Admin (or Super Admin) login only — matches the frontend's
   own allowPast gate on LeaveDateInput in LeaveVisitPage.jsx's Manual Posting
   forms. Checked server-side too since a raw API call could otherwise set
   isManual:true regardless of who's actually calling. */
const isAdminManualBackdate = (req) =>
  req.body?.isManual === true && ['admin', 'superAdmin'].includes(req.user?.role);

/* Best-effort email lookup + send — never let a notification failure affect the request. */
async function notifyLeaveApplication(leave) {
  try {
    const recommendedBy = Array.isArray(leave.reco) ? leave.reco[0] : (leave.recommendedBy || leave.reco || null);
    const approvedBy    = Array.isArray(leave.approval) ? leave.approval[0] : (leave.approval || null);
    const ids = [recommendedBy, approvedBy].filter(Boolean).map(Number);
    if (!ids.length) return;

    const [{ rows: recipients }, { rows: [requester] }, { rows: [lt] }] = await Promise.all([
      pool.query(`SELECT email FROM users WHERE id = ANY($1::int[]) AND email IS NOT NULL AND email != ''`, [ids]),
      pool.query('SELECT full_name FROM users WHERE id=$1', [leave.employeeId]),
      pool.query('SELECT name FROM leave_types WHERE code=$1', [leave.leaveTypeCode]),
    ]);
    for (const r of recipients) {
      await sendLeaveApplication({
        to: r.email, fullName: requester?.full_name || '',
        leaveType: lt?.name || leave.leaveTypeCode, fromDate: leave.fromDate, toDate: leave.toDate,
        days: leave.days, reason: leave.reason,
      });
    }
  } catch (err) {
    logError('[leaves notifyLeaveApplication]', err);
  }
}

async function notifyLeaveStatusUpdate(leave) {
  try {
    const [{ rows: [employee] }, { rows: [lt] }] = await Promise.all([
      pool.query('SELECT email, full_name FROM users WHERE id=$1', [leave.employeeId]),
      pool.query('SELECT name FROM leave_types WHERE code=$1', [leave.leaveTypeCode]),
    ]);
    if (!employee?.email) return;
    await sendLeaveStatusUpdate({
      to: employee.email, fullName: employee.full_name, status: leave.status,
      leaveType: lt?.name || leave.leaveTypeCode, fromDate: leave.fromDate, toDate: leave.toDate,
      comment: leave.comment,
    });
  } catch (err) {
    logError('[leaves notifyLeaveStatusUpdate]', err);
  }
}

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
  recommendedDate: r.recommended_date,
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
      map[r.employee_id][r.leave_type_code] = parseFloat(r.balance);
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
          status, recommendedBy, recommendedDate, approvedBy, approvedDate, reco, approval } = req.body;

  const finalStatus  = ['approved','rejected','pending'].includes(status) ? status : 'pending';
  const finalAppBy   = finalStatus !== 'pending' ? (approvedBy   || null) : null;
  const finalAppDate = finalStatus !== 'pending' ? (approvedDate || new Date().toISOString().split('T')[0]) : null;

  try {
    if (await rejectIfBackdated(fromDate, res, isAdminManualBackdate(req))) return;
    const { rows } = await pool.query(
      `INSERT INTO leaves
         (employee_id,leave_type_code,from_date,to_date,days,reason,half_day,status,recommended_by,recommended_date,approved_by,approved_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [employeeId, leaveTypeCode, fromDate, toDate, days, reason, !!halfDay,
       finalStatus, recommendedBy || null, recommendedDate || null, finalAppBy, finalAppDate]
    );
    const leave = toLeave(rows[0]);
    if (finalStatus === 'pending') notifyLeaveApplication({ ...leave, reco, approval });
    res.status(201).json(leave);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', async (req, res) => {
  const { employeeId, leaveTypeCode, fromDate, toDate, days, reason, halfDay,
          status, recommendedBy, recommendedDate, approvedBy, approvedDate } = req.body;

  const finalStatus  = ['approved','rejected','pending'].includes(status) ? status : 'pending';
  const finalAppBy   = finalStatus !== 'pending' ? (approvedBy   || null) : null;
  const finalAppDate = finalStatus !== 'pending' ? (approvedDate || null) : null;

  try {
    if (await rejectIfBackdated(fromDate, res, isAdminManualBackdate(req))) return;
    const { rows } = await pool.query(
      `UPDATE leaves
       SET employee_id=$1, leave_type_code=$2, from_date=$3, to_date=$4, days=$5,
           reason=$6, half_day=$7, status=$8, recommended_by=$9, recommended_date=$10, approved_by=$11, approved_date=$12
       WHERE id=$13 RETURNING *`,
      [employeeId, leaveTypeCode, fromDate, toDate, days, reason, !!halfDay,
       finalStatus, recommendedBy || null, recommendedDate || null, finalAppBy, finalAppDate, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Leave not found' });
    const leave = toLeave(rows[0]);
    logAudit({ actor: req.user, action: 'edit', entity: 'leave', entityId: req.params.id, before: null, after: leave });
    res.json(leave);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:id/recommend', async (req, res) => {
  const { recommendedBy } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE leaves SET recommended_by=$1, recommended_date=CURRENT_DATE WHERE id=$2 RETURNING *`,
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
    const leave = toLeave(rows[0]);
    logAudit({ actor: req.user, action: 'approve', entity: 'leave', entityId: req.params.id, before: null, after: leave });
    notifyLeaveStatusUpdate(leave);
    res.json(leave);
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
    const leave = toLeave(rows[0]);
    logAudit({ actor: req.user, action: 'reject', entity: 'leave', entityId: req.params.id, before: null, after: leave });
    notifyLeaveStatusUpdate(leave);
    res.json(leave);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM leaves WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
