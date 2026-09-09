import { Router } from 'express';
import pool from '../db.js';
import { logAudit } from '../services/auditLog.js';
import { sendOfficeVisitApplication, sendOfficeVisitStatusUpdate } from '../services/emailService.js';
import { logError } from '../utils/logError.js';
import { isLeaveBackdateEnabled } from '../utils/appSettings.js';
import { authorizeRecoAction, authorizeOwnEditDelete } from '../services/recoApprovalGuard.js';
import { resolveOrgScope, resolveOrgEmployeeIds, resolveRecoApprovalEmployeeIds } from './orgScope.js';

const router = Router();
const PRIVILEGED_ROLES = ['admin', 'superAdmin'];

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
    res.status(400).json({ error: 'Backdated office visit applications are currently disabled. Please select today or a later date.' });
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
  visitType     : r.visit_type,
  country       : r.country,
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
  approvedAt    : r.approved_at,
  comment       : r.comment,
  recommendedBy  : r.recommended_by,
  recommendedDate: r.recommended_date,
  recommendedAt  : r.recommended_at,
  recommendComment: r.recommend_comment,
  isManual      : !!r.is_manual,
  updatedBy     : r.updated_by,
  updatedAt     : r.updated_at,
  updatedDevice : r.updated_device,
});

router.get('/', async (req, res) => {
  try {
    // Same scoping rule as leaves.js's GET / — see its comment for why only
    // branchManager/departmentHead get narrowed here.
    const scope = resolveOrgScope(req);
    let ids = (scope.level === 'branch' || scope.level === 'department')
      ? await resolveOrgEmployeeIds(req) : null;
    if (ids) {
      // Widen with anyone this caller is explicitly configured to recommend/
      // approve for, regardless of department/branch — see
      // resolveRecoApprovalEmployeeIds's comment for why.
      const recoIds = await resolveRecoApprovalEmployeeIds(req);
      if (recoIds.length) ids = [...new Set([...ids, ...recoIds])];
    }
    const { rows } = ids
      ? await pool.query('SELECT * FROM office_visits WHERE employee_id = ANY($1) ORDER BY id', [ids])
      : await pool.query('SELECT * FROM office_visits ORDER BY id');
    res.json(rows.map(toVisit));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
  let { employeeId } = req.body;
  const { purpose,visitType,country,location,fromDate,fromTime,toDate,toTime,description,reco,approval,
          status, recommendedBy, recommendedDate, approvedBy, approvedDate, isManual, deviceInfo } = req.body;

  // Self-service Apply for Visit always posts about the caller's own record
  // — a raw API call can't override this. status/recommendedBy/approvedBy/
  // approvedDate/isManual are only ever taken from the request for admin/
  // superAdmin (the Manual Posting flow, which previously had no way to
  // actually persist these — this INSERT used to omit the columns entirely,
  // so an admin's manually-recorded Approved/Recommended By silently
  // vanished). For anyone else these stay unset, matching the always-pending
  // self-service behavior these columns' own defaults already gave. See
  // leaves.js's POST for the identical reasoning.
  const isPrivileged = PRIVILEGED_ROLES.includes(req.user.role);
  if (!isPrivileged) employeeId = req.user.id;

  const finalStatus  = isPrivileged && ['approved','rejected','pending'].includes(status) ? status : 'pending';
  const finalRecoBy   = isPrivileged ? (recommendedBy   || null) : null;
  const finalRecoDate = isPrivileged ? (recommendedDate || null) : null;
  const finalAppBy   = isPrivileged && finalStatus !== 'pending' ? (approvedBy   || null) : null;
  const finalAppDate = isPrivileged && finalStatus !== 'pending' ? (approvedDate || new Date().toISOString().split('T')[0]) : null;
  const finalIsManual = isPrivileged && isManual === true;

  try {
    if (await rejectIfBackdated(fromDate, res, isAdminManualBackdate(req))) return;
    const { rows } = await pool.query(
      `INSERT INTO office_visits
         (employee_id,purpose,visit_type,country,location,from_date,from_time,to_date,to_time,description,status,recommended_by,recommended_date,approved_by,approved_date,is_manual,updated_by,updated_at,updated_device)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW(),$18) RETURNING *`,
      [employeeId,purpose,visitType || 'National',visitType === 'International' ? (country || null) : null,location,fromDate,fromTime,toDate,toTime,description,
       finalStatus, finalRecoBy, finalRecoDate, finalAppBy, finalAppDate, finalIsManual,
       req.user.id, deviceInfo || null]
    );
    const visit = toVisit(rows[0]);
    if (finalStatus === 'pending') notifyVisitApplication({ ...visit, reco, approval });
    res.status(201).json(visit);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', async (req, res) => {
  const { employeeId, purpose, visitType, country, location, fromDate, fromTime, toDate, toTime, description,
          status, recommendedBy, recommendedDate, approvedBy, approvedDate, deviceInfo } = req.body;

  try {
    const { rows: existingRows } = await pool.query('SELECT employee_id, status, recommended_by FROM office_visits WHERE id=$1', [req.params.id]);
    if (!existingRows[0]) return res.status(404).json({ error: 'Visit not found' });
    const authError = authorizeOwnEditDelete(req, existingRows[0].employee_id, existingRows[0]);
    if (authError) return res.status(authError.status).json({ error: authError.error });

    // See leaves.js PUT for why: a non-privileged owner is only authorized
    // above because the visit is still pending/untouched, so status/
    // recommended*/approved*/employee_id are only ever taken from the
    // request for admin/superAdmin.
    const isPrivileged    = PRIVILEGED_ROLES.includes(req.user.role);
    const finalEmployeeId = isPrivileged ? employeeId : existingRows[0].employee_id;
    const finalStatus     = isPrivileged && ['approved','rejected','pending'].includes(status) ? status : 'pending';
    const finalRecoBy     = isPrivileged ? (recommendedBy   || null) : null;
    const finalRecoDate   = isPrivileged ? (recommendedDate || null) : null;
    const finalAppBy      = isPrivileged && finalStatus !== 'pending' ? (approvedBy   || null) : null;
    const finalAppDate    = isPrivileged && finalStatus !== 'pending' ? (approvedDate || null) : null;

    if (await rejectIfBackdated(fromDate, res, isAdminManualBackdate(req))) return;
    const { rows } = await pool.query(
      `UPDATE office_visits
       SET employee_id=$1, purpose=$2, visit_type=$3, country=$4, location=$5, from_date=$6, from_time=$7, to_date=$8, to_time=$9,
           description=$10, status=$11, recommended_by=$12, recommended_date=$13, approved_by=$14, approved_date=$15,
           updated_by=$16, updated_at=NOW(), updated_device=$17
       WHERE id=$18 RETURNING *`,
      [finalEmployeeId, purpose, visitType || 'National', visitType === 'International' ? (country || null) : null, location, fromDate, fromTime, toDate, toTime, description,
       finalStatus, finalRecoBy, finalRecoDate, finalAppBy, finalAppDate,
       req.user.id, deviceInfo || null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Visit not found' });
    const visit = toVisit(rows[0]);
    logAudit({ actor: req.user, action: 'edit', entity: 'visit', entityId: req.params.id, before: null, after: visit });
    res.json(visit);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:id/recommend', async (req, res) => {
  const { comment } = req.body;
  try {
    const { rows: existingRows } = await pool.query('SELECT employee_id FROM office_visits WHERE id=$1', [req.params.id]);
    if (!existingRows[0]) return res.status(404).json({ error: 'Visit not found' });
    const authError = await authorizeRecoAction(req, existingRows[0].employee_id, 'recommend');
    if (authError) return res.status(authError.status).json({ error: authError.error });

    const { rows } = await pool.query(
      `UPDATE office_visits SET recommended_by=$1, recommended_date=CURRENT_DATE, recommended_at=CURRENT_TIMESTAMP, recommend_comment=$3 WHERE id=$2 RETURNING *`,
      [req.user.id, req.params.id, comment || null]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Visit not found' });
    res.json(toVisit(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:id/approve', async (req, res) => {
  const { comment } = req.body;
  try {
    const { rows: existingRows } = await pool.query('SELECT employee_id, recommended_by FROM office_visits WHERE id=$1', [req.params.id]);
    if (!existingRows[0]) return res.status(404).json({ error: 'Visit not found' });
    const authError = await authorizeRecoAction(req, existingRows[0].employee_id, 'approve',
      { alreadyRecommended: !!existingRows[0].recommended_by });
    if (authError) return res.status(authError.status).json({ error: authError.error });

    const { rows } = await pool.query(
      `UPDATE office_visits SET status='approved', approved_by=$1, approved_date=CURRENT_DATE, approved_at=CURRENT_TIMESTAMP, comment=$2
       WHERE id=$3 RETURNING *`,
      [req.user.id, comment || '', req.params.id]
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
  const { comment } = req.body;
  try {
    const { rows: existingRows } = await pool.query('SELECT employee_id FROM office_visits WHERE id=$1', [req.params.id]);
    if (!existingRows[0]) return res.status(404).json({ error: 'Visit not found' });
    const authError = await authorizeRecoAction(req, existingRows[0].employee_id, 'reject');
    if (authError) return res.status(authError.status).json({ error: authError.error });

    const { rows } = await pool.query(
      `UPDATE office_visits SET status='rejected', approved_by=$1, approved_date=CURRENT_DATE, approved_at=CURRENT_TIMESTAMP, comment=$2
       WHERE id=$3 RETURNING *`,
      [req.user.id, comment || '', req.params.id]
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
    const { rows: existingRows } = await pool.query('SELECT employee_id, status, recommended_by FROM office_visits WHERE id=$1', [req.params.id]);
    if (!existingRows[0]) return res.status(404).json({ error: 'Visit not found' });
    const authError = authorizeOwnEditDelete(req, existingRows[0].employee_id, existingRows[0]);
    if (authError) return res.status(authError.status).json({ error: authError.error });

    await pool.query('DELETE FROM office_visits WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
