import { Router } from 'express';
import pool from '../db.js';
import { validateBody } from '../middleware/validate.js';
import { logAudit } from '../services/auditLog.js';
import { sendOfficeVisitApplication, sendOfficeVisitStatusUpdate } from '../services/emailService.js';
import { logError } from '../utils/logError.js';
import { pushLater } from '../services/pushService.js';
import { notifyPeople, notifyApproversNext, notifyApplicantOf } from '../services/approvalNotify.js';
import { isLeaveBackdateEnabled } from '../utils/appSettings.js';
import { authorizeRecoAction, authorizeOwnEditDelete } from '../services/recoApprovalGuard.js';
import { findLeaveVisitConflict } from '../services/leaveVisitConflicts.js';
import { resolveOrgScope, resolveOrgEmployeeIds, resolveRecoApprovalEmployeeIds, canManagerPostFor, canManagerManualPost, canManagerApplyFor } from './orgScope.js';
import { requireRole } from '../middleware/roleGuard.js';

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
    notifyPeople(visit.employeeId, ids, { subject: 'Office visit request', body: `${requester?.full_name || 'A colleague'}: ${visit.location || 'office visit'} (${String(visit.fromDate).slice(0, 10)} to ${String(visit.toDate).slice(0, 10)}). Open Approvals.`, path: '/m/approvals' });
    pushLater(ids, { title: 'Office visit request', body: `${requester?.full_name || 'A colleague'}: ${visit.location || 'visit'} (${visit.fromDate} to ${visit.toDate})`, data: { path: '/m/approvals' } });
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
    notifyApplicantOf(visit.employeeId, visit.approvedBy, { subject: `Office visit ${visit.status}`, body: `Your office visit (${String(visit.fromDate).slice(0, 10)} to ${String(visit.toDate).slice(0, 10)}) was ${visit.status}.${visit.comment ? ' ' + visit.comment : ''}`, path: '/m/leave' });
    pushLater([visit.employeeId], { title: `Office visit ${visit.status}`, body: `${visit.fromDate} to ${visit.toDate}${visit.comment ? ' - ' + visit.comment : ''}`, data: { path: '/m/leave' } });
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
  recoId         : r.reco_id,
  approvalId     : r.approval_id,
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
    let ids = (scope.level === 'branch' || scope.level === 'department'
                || scope.level === 'branches' || scope.level === 'departments')
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

router.post('/', validateBody({ employeeId: {"type":"scalar","max":100}, purpose: { max: 4000 }, visitType: { type: 'scalar', max: 100 }, country: { type: 'scalar', max: 200 }, location: { max: 4000 }, fromDate: {"type":"scalar","max":40}, toDate: {"type":"scalar","max":40}, fromTime: {"type":"scalar","max":40}, toTime: {"type":"scalar","max":40}, description: { max: 20000 }, status: { type: 'scalar', max: 40 }, recommendedBy: {"type":"scalar","max":100}, approvedBy: {"type":"scalar","max":100} }), async (req, res) => {
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
  // Branch Manager / Branch Area Manager Manual Posting for a staff member in
  // their own scope (not themselves) counts as privileged too — previously
  // only admin/superAdmin did, so a Branch Manager's manual entry was silently
  // rewritten into THEIR OWN pending application (wrong staff, status reset
  // to Pending, Recommended/Approved By dropped). Includes the manager's OWN
  // record too — see canManagerManualPost.
  const isPrivileged = PRIVILEGED_ROLES.includes(req.user.role)
    || (isManual === true && await canManagerManualPost(req, employeeId).catch(() => false));
  // A Manual Posting that isn't allowed must fail loudly, not be quietly
  // rewritten into the caller's own pending application.
  if (!isPrivileged && isManual === true) {
    return res.status(403).json({ error: 'You can only manually post for staff in your own branch.' });
  }
  // A manager applying (Pending) on behalf of a staff member in their own
  // scope keeps that staff member — see canManagerApplyFor. Anyone else
  // always applies for themselves.
  const onBehalf = !isPrivileged && await canManagerApplyFor(req, employeeId).catch(() => false);
  if (!isPrivileged && !onBehalf) employeeId = req.user.id;

  const finalStatus  = isPrivileged && ['approved','rejected','pending'].includes(status) ? status : 'pending';
  const finalRecoBy   = isPrivileged ? (recommendedBy   || null) : null;
  const finalRecoDate = isPrivileged ? (recommendedDate || null) : null;
  const finalAppBy   = isPrivileged && finalStatus !== 'pending' ? (approvedBy   || null) : null;
  const finalAppDate = isPrivileged && finalStatus !== 'pending' ? (approvedDate || new Date().toISOString().split('T')[0]) : null;
  const finalIsManual = isPrivileged && isManual === true;
  // The specific recommender/approver the applicant picked from Set
  // Recommendator & Approval's configured candidates — see leaves.js's POST
  // for the identical reasoning (migration 142).
  // A privileged Manual Posting has no reco/approval picker — fall back to the
  // Recommended By / Approved By it names, so a Pending manual entry still
  // records (and the grid shows) who is to recommend/approve it.
  const recoId     = (Array.isArray(reco)     ? (reco[0]     || null) : (reco     || null))
                  || (isPrivileged ? (recommendedBy || null) : null);
  const approvalId = (Array.isArray(approval) ? (approval[0] || null) : (approval || null))
                  || (isPrivileged ? (approvedBy || null) : null);

  try {
    if (await rejectIfBackdated(fromDate, res, isAdminManualBackdate(req))) return;
    // No two leave/office-visit entries for one staff member on the same day
    // (see findLeaveVisitConflict) — enforced here for every save path.
    if (finalStatus !== 'rejected') {
      const clash = await findLeaveVisitConflict({ kind: 'visit', employeeId: employeeId, fromDate, toDate });
      if (clash) return res.status(409).json(clash);
    }
    const { rows } = await pool.query(
      `INSERT INTO office_visits
         (employee_id,purpose,visit_type,country,location,from_date,from_time,to_date,to_time,description,status,recommended_by,recommended_date,approved_by,approved_date,is_manual,reco_id,approval_id,updated_by,updated_at,updated_device)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NOW(),$20) RETURNING *`,
      [employeeId,purpose,visitType || 'National',visitType === 'International' ? (country || null) : null,location,fromDate,fromTime,toDate,toTime,description,
       finalStatus, finalRecoBy, finalRecoDate, finalAppBy, finalAppDate, finalIsManual,
       recoId, approvalId, req.user.id, deviceInfo || null]
    );
    const visit = toVisit(rows[0]);
    if (finalStatus === 'pending') notifyVisitApplication({ ...visit, reco, approval });
    res.status(201).json(visit);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* POST /api/visits/import — Admin/Super Admin bulk create from a pasted/Excel
   historical register (see employees.js's /import for the same shape).
   Every row here is trusted as already-decided history rather than a fresh
   self-service application, so unlike POST / it lands pre-approved:
   status 'approved' (unless the row says otherwise), is_manual true —
   matching how the existing Manual Posting flow (isAdminManualBackdate)
   already records admin-entered visits, just for many rows at once.
   approvedBy/recommendedBy (Staff IDs, already resolved from names
   client-side) preserve who actually approved/recommended it historically;
   approvedBy falls back to the importing admin when absent/unresolved
   since every row needs SOME approver, recommendedBy just stays unset. */
router.post('/import', requireRole('admin', 'superAdmin'), async (req, res) => {
  const { visits } = req.body;
  if (!Array.isArray(visits) || visits.length === 0)
    return res.status(400).json({ error: 'No visits provided' });

  const created = [], errors = [];

  try {
    const candidates = [];
    for (const v of visits) {
      if (!v.employeeId || !v.purpose || !v.fromDate || !v.toDate) {
        errors.push({ employeeId: v.employeeId || '?', error: 'Staff ID, Purpose, From Date and To Date are required' });
        continue;
      }
      candidates.push(v);
    }

    // Resolve Staff ID (the public users.employee_id, e.g. "5000") to the
    // internal users.id the office_visits FK actually uses — one batched
    // lookup instead of a round trip per row (see employees.js's /import
    // for why that matters at 100+ rows). Also covers approvedBy/
    // recommendedBy, which the client resolves to Staff IDs client-side the
    // same way it resolves the subject (by matching pasted names against
    // the staff list) before this ever reaches the server.
    const staffIds = [...new Set(candidates.flatMap(v =>
      [v.employeeId, v.approvedBy, v.recommendedBy].filter(Boolean).map(x => String(x).trim())
    ))];
    const { rows: userRows } = staffIds.length
      ? await pool.query('SELECT id, employee_id FROM users WHERE employee_id = ANY($1::text[])', [staffIds])
      : { rows: [] };
    const idByStaffId = new Map(userRows.map(r => [r.employee_id, r.id]));

    const client = await pool.connect();
    try {
      for (const v of candidates) {
        const staffId = String(v.employeeId).trim();
        const internalId = idByStaffId.get(staffId);
        if (!internalId) { errors.push({ employeeId: staffId, error: 'No staff found with this Staff ID' }); continue; }
        if (v.toDate < v.fromDate) { errors.push({ employeeId: staffId, error: 'To Date is before From Date' }); continue; }

        // The historical approver/recommender named in the source record,
        // if it resolved to a real staff member — falls back to the
        // importing admin as approver (never fabricates a
        // recommender) rather than blocking the whole row over a name that
        // didn't match, since who approved it matters less than the
        // subject/dates/purpose actually being correct.
        const approvedById   = (v.approvedBy   && idByStaffId.get(String(v.approvedBy).trim()))   || req.user.id;
        const recommendedById = v.recommendedBy && idByStaffId.get(String(v.recommendedBy).trim());

        try {
          if (v.status !== 'rejected') {
            const clash = await findLeaveVisitConflict({ kind: 'visit', employeeId: internalId, fromDate: v.fromDate, toDate: v.toDate });
            if (clash) { errors.push({ employeeId: staffId, error: clash.error }); continue; }
          }
          await client.query(
            `INSERT INTO office_visits
               (employee_id,purpose,visit_type,country,location,from_date,from_time,to_date,to_time,description,
                status,applied_date,approved_by,approved_date,recommended_by,recommended_date,is_manual,updated_by,updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,true,$17,NOW())`,
            [internalId, v.purpose, v.visitType || 'National',
             v.visitType === 'International' ? (v.country || null) : null,
             v.location || null, v.fromDate, v.fromTime || null, v.toDate, v.toTime || null,
             v.description || null, ['approved', 'pending', 'rejected'].includes(v.status) ? v.status : 'approved',
             v.appliedDate || v.fromDate, approvedById, v.approvedDate || v.toDate,
             recommendedById || null, recommendedById ? (v.recommendedDate || v.fromDate) : null, req.user.id]
          );
          created.push(staffId);
        } catch (e) {
          errors.push({ employeeId: staffId, error: e.message });
        }
      }
    } finally {
      client.release();
    }

    if (created.length) {
      logAudit({ actor: req.user, action: 'bulk-import', entity: 'visit', entityId: null, before: null, after: { created: created.length, errors: errors.length } });
    }
    res.json({ created: created.length, errors });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/:id', validateBody({ employeeId: {"type":"scalar","max":100}, purpose: { max: 4000 }, visitType: { type: 'scalar', max: 100 }, country: { type: 'scalar', max: 200 }, location: { max: 4000 }, fromDate: {"type":"scalar","max":40}, toDate: {"type":"scalar","max":40}, fromTime: {"type":"scalar","max":40}, toTime: {"type":"scalar","max":40}, description: { max: 20000 }, status: { type: 'scalar', max: 40 }, recommendedBy: {"type":"scalar","max":100}, approvedBy: {"type":"scalar","max":100} }), async (req, res) => {
  const { employeeId, purpose, visitType, country, location, fromDate, fromTime, toDate, toTime, description,
          status, recommendedBy, recommendedDate, approvedBy, approvedDate, deviceInfo } = req.body;

  try {
    const { rows: existingRows } = await pool.query('SELECT employee_id, status, recommended_by, is_manual FROM office_visits WHERE id=$1', [req.params.id]);
    if (!existingRows[0]) return res.status(404).json({ error: 'Visit not found' });
    // A Branch Manager editing an in-scope staff member's visit (not their
    // own) is treated like an admin edit — see canManagerPostFor. Their own
    // Manual Posting stays editable by them too (canManagerManualPost).
    const targetIds = [existingRows[0].employee_id, employeeId ?? existingRows[0].employee_id];
    const managerOk = await canManagerPostFor(req, ...targetIds)
      || (existingRows[0].is_manual && await canManagerManualPost(req, ...targetIds));
    const authError = managerOk ? null : authorizeOwnEditDelete(req, existingRows[0].employee_id, existingRows[0]);
    if (authError) return res.status(authError.status).json({ error: authError.error });

    // See leaves.js PUT for why: a non-privileged owner is only authorized
    // above because the visit is still pending/untouched, so status/
    // recommended*/approved*/employee_id are only ever taken from the
    // request for admin/superAdmin.
    const isPrivileged    = PRIVILEGED_ROLES.includes(req.user.role) || managerOk;
    const finalEmployeeId = isPrivileged ? employeeId : existingRows[0].employee_id;
    const finalStatus     = isPrivileged && ['approved','rejected','pending'].includes(status) ? status : 'pending';
    const finalRecoBy     = isPrivileged ? (recommendedBy   || null) : null;
    const finalRecoDate   = isPrivileged ? (recommendedDate || null) : null;
    const finalAppBy      = isPrivileged && finalStatus !== 'pending' ? (approvedBy   || null) : null;
    const finalAppDate    = isPrivileged && finalStatus !== 'pending' ? (approvedDate || null) : null;

    if (await rejectIfBackdated(fromDate, res, isAdminManualBackdate(req))) return;
    // No two leave/office-visit entries for one staff member on the same day
    // (see findLeaveVisitConflict) — enforced here for every save path.
    if (finalStatus !== 'rejected') {
      const clash = await findLeaveVisitConflict({ kind: 'visit', employeeId: finalEmployeeId, fromDate, toDate, excludeId: Number(req.params.id) });
      if (clash) return res.status(409).json(clash);
    }
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

router.patch('/:id/recommend', validateBody({ comment: { max: 2000 } }), async (req, res) => {
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
    notifyApproversNext(existingRows[0].employee_id, req.user.id, { subject: 'Office visit recommended — needs approval', body: `An office visit (${String(rows[0].from_date).slice(0, 10)} to ${String(rows[0].to_date).slice(0, 10)}) was recommended and is waiting for your approval.`, path: '/m/approvals' });
    res.json(toVisit(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:id/approve', validateBody({ comment: { max: 2000 } }), async (req, res) => {
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

router.patch('/:id/reject', validateBody({ comment: { max: 2000 } }), async (req, res) => {
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
    const { rows: existingRows } = await pool.query('SELECT employee_id, status, recommended_by, is_manual FROM office_visits WHERE id=$1', [req.params.id]);
    if (!existingRows[0]) return res.status(404).json({ error: 'Visit not found' });
    // Same rule as PUT above — see leaves.js DELETE.
    const managerOk = await canManagerPostFor(req, existingRows[0].employee_id)
      || (existingRows[0].is_manual && await canManagerManualPost(req, existingRows[0].employee_id));
    const authError = managerOk ? null : authorizeOwnEditDelete(req, existingRows[0].employee_id, existingRows[0]);
    if (authError) return res.status(authError.status).json({ error: authError.error });

    await pool.query('DELETE FROM office_visits WHERE id=$1', [req.params.id]);
    logAudit({ actor: req.user, action: 'delete', entity: 'visit', entityId: req.params.id, before: existingRows[0], after: null });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
