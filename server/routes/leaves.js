import { Router } from 'express';
import pool from '../db.js';
import { validateBody } from '../middleware/validate.js';
import { logAudit } from '../services/auditLog.js';
import { sendLeaveApplication, sendLeaveStatusUpdate } from '../services/emailService.js';
import { logError } from '../utils/logError.js';
import { pushLater } from '../services/pushService.js';
import { notifyPeople, notifyApproversNext, notifyApplicantOf, resolveApplicationRecipients } from '../services/approvalNotify.js';
import { isLeaveBackdateEnabled } from '../utils/appSettings.js';
import { authorizeRecoAction, authorizeOwnEditDelete } from '../services/recoApprovalGuard.js';
import { findLeaveVisitConflict } from '../services/leaveVisitConflicts.js';
import { sandwichLeaveDays, loadLeaveOffDayRule, loadPublicHolidays, makeHolidayChecker } from './attendance.js';
import { resolveOrgScope, resolveOrgEmployeeIds, resolveRecoApprovalEmployeeIds, canManagerPostFor, canManagerManualPost, canManagerApplyFor } from './orgScope.js';

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
    // Picked recommender/approver + everyone configured for this staff member (admins if none).
    const ids = await resolveApplicationRecipients(leave.employeeId, [leave.reco, leave.approval, leave.recommendedBy]);
    if (!ids.length) return;

    const [{ rows: recipients }, { rows: [requester] }, { rows: [lt] }] = await Promise.all([
      pool.query(`SELECT email FROM users WHERE id = ANY($1::int[]) AND email IS NOT NULL AND email != ''`, [ids]),
      pool.query('SELECT full_name FROM users WHERE id=$1', [leave.employeeId]),
      pool.query('SELECT name FROM leave_types WHERE code=$1', [leave.leaveTypeCode]),
    ]);
    notifyPeople(leave.employeeId, ids, { subject: 'Leave request', body: `${requester?.full_name || 'A colleague'} applied for ${lt?.name || leave.leaveTypeCode} (${String(leave.fromDate).slice(0, 10)} to ${String(leave.toDate).slice(0, 10)}). Open Approvals.`, path: '/m/approvals' });
    pushLater(ids, { title: 'Leave request', body: `${requester?.full_name || 'A colleague'} applied for ${lt?.name || leave.leaveTypeCode} (${leave.fromDate} to ${leave.toDate})`, data: { path: '/m/approvals' } });
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
    notifyApplicantOf(leave.employeeId, leave.approvedBy, { subject: `Leave ${leave.status}`, body: `Your ${lt?.name || leave.leaveTypeCode} leave (${String(leave.fromDate).slice(0, 10)} to ${String(leave.toDate).slice(0, 10)}) was ${leave.status}.${leave.comment ? ' ' + leave.comment : ''}`, path: '/m/leave' });
    pushLater([leave.employeeId], { title: `Leave ${leave.status}`, body: `${lt?.name || leave.leaveTypeCode} (${leave.fromDate} to ${leave.toDate})${leave.comment ? ' - ' + leave.comment : ''}`, data: { path: '/m/leave' } });
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
  approvedAt     : r.approved_at,
  comment        : r.comment,
  recommendedBy  : r.recommended_by,
  recommendedDate: r.recommended_date,
  recommendedAt  : r.recommended_at,
  recommendComment: r.recommend_comment,
  recoId         : r.reco_id,
  approvalId     : r.approval_id,
  isManual       : !!r.is_manual,
  updatedBy      : r.updated_by,
  updatedAt      : r.updated_at,
  updatedDevice  : r.updated_device,
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

/* ── Leave Openings (Leave Calculation → Current Year / Previous Year tabs) ──
   Shaped as { [fyKey]: { [employeeId]: { [leaveTypeShort]: days } } } — the
   exact nested structure the frontend already works with, so it's a drop-in
   replacement for what used to be read out of localStorage. */
router.get('/openings', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT fy_key, employee_id, leave_type_short, days FROM leave_openings');
    const result = {};
    rows.forEach(r => {
      if (!result[r.fy_key]) result[r.fy_key] = {};
      if (!result[r.fy_key][r.employee_id]) result[r.fy_key][r.employee_id] = {};
      result[r.fy_key][r.employee_id][r.leave_type_short] = parseFloat(r.days);
    });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* Body: { entries: [{ fyKey, employeeId, leaveTypeShort, days }] } — days is a
   number to upsert, or null/undefined to clear (delete) that cell. Only the
   cells that actually changed need to be sent. */
router.put('/openings', async (req, res) => {
  const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const e of entries) {
      const { fyKey, employeeId, leaveTypeShort } = e;
      if (!fyKey || !employeeId || !leaveTypeShort) continue;
      if (e.days === null || e.days === undefined || e.days === '') {
        await client.query(
          'DELETE FROM leave_openings WHERE fy_key=$1 AND employee_id=$2 AND leave_type_short=$3',
          [fyKey, employeeId, leaveTypeShort]
        );
      } else {
        await client.query(
          `INSERT INTO leave_openings (fy_key, employee_id, leave_type_short, days, updated_at)
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (fy_key, employee_id, leave_type_short)
           DO UPDATE SET days = EXCLUDED.days, updated_at = NOW()`,
          [fyKey, employeeId, leaveTypeShort, Number(e.days)]
        );
      }
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});


/* Sandwich days — a weekend / public-holiday run sitting directly between two
   approved leave days whose type has Reduce Weekend + Reduce Public Holiday OFF
   is part of the leave, so it is deducted from the balance too (the attendance
   reports already show it as leave). Returns Map(leaveId -> extra days), the
   extra being credited to the leave that ends right before the gap. Derived at
   read time — never stored — so editing/rejecting/deleting a leave updates it. */
export const leaveSandwichExtras = async (leaveRows) => {
  const extras = new Map();
  try {
    const byEmp = new Map();
    for (const r of leaveRows) {
      if (r.status !== 'approved') continue;
      if (!byEmp.has(r.employee_id)) byEmp.set(r.employee_id, []);
      byEmp.get(r.employee_id).push(r);
    }
    const cands = [...byEmp.entries()].filter(([, ls]) => ls.length > 1);
    if (!cands.length) return extras;
    const rule = await loadLeaveOffDayRule();
    const [wk, holidays, users] = await Promise.all([
      pool.query('SELECT weekends, effective_date FROM weekend_history ORDER BY effective_date, id'),
      loadPublicHolidays(),
      pool.query('SELECT id, gender, branch, department, religion, handicapped FROM users WHERE id = ANY($1)', [cands.map(([id]) => id)]),
    ]);
    const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const wkHist = wk.rows.map(r => ({ eff: String(r.effective_date instanceof Date ? r.effective_date.toISOString() : r.effective_date).slice(0, 10), w: r.weekends || [] }));
    const weekendsOn = ds => { let w = null; for (const h of wkHist) if (h.eff <= ds) w = h.w; return w || ['Sat']; };
    const getHoliday = await makeHolidayChecker(holidays);
    const userById = new Map(users.rows.map(u => [u.id, u]));
    const day = v => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);
    for (const [empId, ls] of cands) {
      const emp = userById.get(empId); if (!emp) continue;
      const codeByDate = new Map(), idByDate = new Map();
      let min = null, max = null;
      for (const l of ls) {
        const f = day(l.from_date), t = day(l.to_date);
        for (let d = new Date(f + 'T00:00:00Z'); d <= new Date(t + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
          const ds = d.toISOString().slice(0, 10);
          codeByDate.set(ds, l.leave_type_code); idByDate.set(ds, l.id);
        }
        if (!min || f < min) min = f; if (!max || t > max) max = t;
      }
      const dates = [];
      for (let d = new Date(min + 'T00:00:00Z'); d <= new Date(max + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) dates.push(d.toISOString().slice(0, 10));
      const sw = sandwichLeaveDays(dates, ds => codeByDate.get(ds) || null,
        ds => weekendsOn(ds).includes(DOW[new Date(ds + 'T00:00:00Z').getUTCDay()]),
        ds => !!getHoliday(ds, emp), rule);
      for (const [ds] of sw) {
        const owner = idByDate.get(dates[dates.indexOf(ds) - 1]) ?? idByDate.get([...dates.slice(0, dates.indexOf(ds))].reverse().find(d => idByDate.has(d)));
        if (owner != null) extras.set(owner, (extras.get(owner) || 0) + 1);
      }
    }
  } catch (e) { logError?.('leaveSandwichExtras', e); }
  return extras;
};

/* 'Provide Only on Balance' — enforced server-side for EVERY save path (apply,
   manual posting, bulk import, edit). Balance = previous-year + current-year
   opening (Leave Calculation) + credits, minus approved AND pending leaves of
   the default fiscal year (pending counts, so stacking applications can't
   overrun it). Returns an error string, or null when OK / not applicable. */
async function checkLeaveBalance({ employeeId, leaveTypeCode, days, excludeId = null }) {
  const want = Number(days);
  if (!employeeId || !leaveTypeCode || !(want > 0)) return null;
  const { rows: sr } = await pool.query("SELECT value FROM app_settings WHERE key='main'");
  let main = sr[0]?.value; if (typeof main === 'string') { try { main = JSON.parse(main); } catch { main = null; } }
  const lt = (main?.leaveTypeConfigs || []).find(l => l.shortName === leaveTypeCode);
  if (!lt?.provideOnlyOnBalance) return null;
  const fys = main?.fiscalYears || [];
  const fy = fys.find(f => f.isDefault) || fys[0];
  if (!fy) return null;
  const fyId = String(fy.id);
  const { rows: op } = await pool.query(
    'SELECT fy_key, days FROM leave_openings WHERE employee_id=$1 AND leave_type_short=$2 AND fy_key = ANY($3)',
    [employeeId, leaveTypeCode, [fyId, 'prev_' + fyId]]);
  const opening = op.reduce((s, r) => s + Number(r.days || 0), 0);
  const { rows: cr } = await pool.query('SELECT balance FROM leave_balances WHERE employee_id=$1 AND leave_type_code=$2', [employeeId, leaveTypeCode]);
  const credit = Number(cr[0]?.balance || 0);
  const { rows: us } = await pool.query(
    "SELECT COALESCE(SUM(days),0) AS used FROM leaves WHERE employee_id=$1 AND leave_type_code=$2 AND status IN ('approved','pending') AND from_date >= $3 AND from_date <= $4 AND ($5::int IS NULL OR id <> $5)",
    [employeeId, leaveTypeCode, fy.startDate, fy.endDate, excludeId]);
  const { rows: mine } = await pool.query(
    "SELECT id, employee_id, leave_type_code, from_date, to_date, status FROM leaves WHERE employee_id=$1 AND status='approved' AND from_date >= $2 AND from_date <= $3",
    [employeeId, fy.startDate, fy.endDate]);
  const sandwichUsed = [...(await leaveSandwichExtras(mine))].reduce((sum, [id, x]) => {
    const l = mine.find(m => m.id === id);
    return l && l.leave_type_code === leaveTypeCode && id !== excludeId ? sum + x : sum;
  }, 0);
  const avail = Math.max(0, opening + credit - Number(us[0].used || 0) - sandwichUsed);
  return want > avail
    ? `Insufficient balance for ${lt.name || leaveTypeCode} — requested ${want} day(s), available ${avail} day(s).`
    : null;
}

/* ── Leaves CRUD ── */
router.get('/', async (req, res) => {
  try {
    // Only a branchManager/departmentHead is narrowed to their own
    // branch/department here — admin/superAdmin stay unrestricted, and a
    // plain employee stays unrestricted too (this list already feeds
    // company-wide "who's on leave" style widgets for every role; scoping
    // that down to self-only would be a much bigger behavior change than
    // what was actually asked for — narrowing management roles to their
    // own team).
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
      ? await pool.query('SELECT * FROM leaves WHERE employee_id = ANY($1) ORDER BY id', [ids])
      : await pool.query('SELECT * FROM leaves ORDER BY id');
    const extras = await leaveSandwichExtras(rows);
    res.json(rows.map(r => { const l = toLeave(r); const x = extras.get(r.id); if (x) { l.sandwichDays = x; l.days = Number(l.days) + x; } return l; }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', validateBody({ employeeId: {"type":"scalar","max":100}, leaveTypeCode: { type: 'scalar', max: 30 }, fromDate: {"type":"scalar","max":40}, toDate: {"type":"scalar","max":40}, days: { type: 'scalar', max: 20 }, reason: { max: 20000 }, status: { type: 'scalar', max: 40 }, recommendedBy: {"type":"scalar","max":100}, approvedBy: {"type":"scalar","max":100}, recommendedDate: {"type":"scalar","max":40}, approvedDate: {"type":"scalar","max":40} }), async (req, res) => {
  let { employeeId } = req.body;
  const { leaveTypeCode, fromDate, toDate, days, reason, halfDay,
          status, recommendedBy, recommendedDate, approvedBy, approvedDate, reco, approval, isManual, deviceInfo } = req.body;

  // Self-service Apply Leave always posts about the caller's own record — a
  // raw API call can't override this by sending a different employeeId.
  // Likewise, status/recommendedBy/recommendedDate/approvedBy/approvedDate/
  // isManual are only ever taken from the request for admin/superAdmin (the
  // Manual Posting flow) — for anyone else these would let a plain apply
  // request create itself pre-approved, or pre-mark recommended_by as
  // already-recommended before the actual recommender has done anything
  // (that column is meant to be set only by the dedicated /recommend action
  // — see authorizeRecoAction's compulsory-recommend-first check).
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

  const finalStatus   = isPrivileged && ['approved','rejected','pending'].includes(status) ? status : 'pending';
  const finalRecoBy   = isPrivileged ? (recommendedBy   || null) : null;
  const finalRecoDate = isPrivileged ? (recommendedDate || null) : null;
  const finalAppBy    = isPrivileged && finalStatus !== 'pending' ? (approvedBy   || null) : null;
  const finalAppDate  = isPrivileged && finalStatus !== 'pending' ? (approvedDate || new Date().toISOString().split('T')[0]) : null;
  const finalIsManual = isPrivileged && isManual === true;
  // The specific recommender/approver the applicant picked from Set
  // Recommendator & Approval's configured candidates (LeaveVisitPage.jsx's
  // Apply form) — unlike recommendedBy/approvedBy above, this is never
  // privileged-gated: it's just recording the applicant's own choice, not an
  // outcome. See migration 142.
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
      const clash = await findLeaveVisitConflict({ kind: 'leave', employeeId: employeeId, fromDate, toDate, leaveTypeCode });
      if (clash) return res.status(409).json(clash);
    }
    if (finalStatus !== 'rejected') {
      const balErr = await checkLeaveBalance({ employeeId, leaveTypeCode, days });
      if (balErr) return res.status(409).json({ error: balErr });
    }
    const { rows } = await pool.query(
      `INSERT INTO leaves
         (employee_id,leave_type_code,from_date,to_date,days,reason,half_day,status,recommended_by,recommended_date,approved_by,approved_date,is_manual,reco_id,approval_id,updated_by,updated_at,updated_device)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),$17) RETURNING *`,
      [employeeId, leaveTypeCode, fromDate, toDate, days, reason, !!halfDay,
       finalStatus, finalRecoBy, finalRecoDate, finalAppBy, finalAppDate, finalIsManual,
       recoId, approvalId, req.user.id, deviceInfo || null]
    );
    const leave = toLeave(rows[0]);
    if (finalStatus === 'pending') notifyLeaveApplication({ ...leave, reco, approval });
    res.status(201).json(leave);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', validateBody({ employeeId: {"type":"scalar","max":100}, leaveTypeCode: { type: 'scalar', max: 30 }, fromDate: {"type":"scalar","max":40}, toDate: {"type":"scalar","max":40}, days: { type: 'scalar', max: 20 }, reason: { max: 20000 }, status: { type: 'scalar', max: 40 }, recommendedBy: {"type":"scalar","max":100}, approvedBy: {"type":"scalar","max":100}, recommendedDate: {"type":"scalar","max":40}, approvedDate: {"type":"scalar","max":40} }), async (req, res) => {
  const { employeeId, leaveTypeCode, fromDate, toDate, days, reason, halfDay,
          status, recommendedBy, recommendedDate, approvedBy, approvedDate, deviceInfo } = req.body;

  try {
    const { rows: existingRows } = await pool.query('SELECT employee_id, status, recommended_by, is_manual FROM leaves WHERE id=$1', [req.params.id]);
    if (!existingRows[0]) return res.status(404).json({ error: 'Leave not found' });
    // A Branch Manager editing an in-scope staff member's leave (not their
    // own) is treated like an admin edit — see canManagerPostFor. Their own
    // Manual Posting stays editable by them too (canManagerManualPost).
    const targetIds = [existingRows[0].employee_id, employeeId ?? existingRows[0].employee_id];
    const managerOk = await canManagerPostFor(req, ...targetIds)
      || (existingRows[0].is_manual && await canManagerManualPost(req, ...targetIds));
    const authError = managerOk ? null : authorizeOwnEditDelete(req, existingRows[0].employee_id, existingRows[0]);
    if (authError) return res.status(authError.status).json({ error: authError.error });

    // A non-privileged owner is only authorized above because the leave is
    // still pending/untouched — editing it must not be a backdoor to also
    // set its own outcome, so status/recommended*/approved* are only ever
    // taken from the request for admin/superAdmin (or the dedicated
    // recommend/approve/reject endpoints, which set them independently).
    const isPrivileged = PRIVILEGED_ROLES.includes(req.user.role) || managerOk;
    // Also don't let a non-privileged owner reassign their own leave to a
    // different employee_id via this same edit.
    const finalEmployeeId = isPrivileged ? employeeId : existingRows[0].employee_id;
    const finalStatus  = isPrivileged && ['approved','rejected','pending'].includes(status) ? status : 'pending';
    const finalRecoBy  = isPrivileged ? (recommendedBy   || null) : null;
    const finalRecoDate= isPrivileged ? (recommendedDate || null) : null;
    const finalAppBy   = isPrivileged && finalStatus !== 'pending' ? (approvedBy   || null) : null;
    const finalAppDate = isPrivileged && finalStatus !== 'pending' ? (approvedDate || null) : null;

    if (await rejectIfBackdated(fromDate, res, isAdminManualBackdate(req))) return;
    // No two leave/office-visit entries for one staff member on the same day
    // (see findLeaveVisitConflict) — enforced here for every save path.
    if (finalStatus !== 'rejected') {
      const clash = await findLeaveVisitConflict({ kind: 'leave', employeeId: finalEmployeeId, fromDate, toDate, leaveTypeCode, excludeId: Number(req.params.id) });
      if (clash) return res.status(409).json(clash);
    }
    if (finalStatus !== 'rejected') {
      const balErr = await checkLeaveBalance({ employeeId: finalEmployeeId, leaveTypeCode, days, excludeId: Number(req.params.id) });
      if (balErr) return res.status(409).json({ error: balErr });
    }
    const { rows } = await pool.query(
      `UPDATE leaves
       SET employee_id=$1, leave_type_code=$2, from_date=$3, to_date=$4, days=$5,
           reason=$6, half_day=$7, status=$8, recommended_by=$9, recommended_date=$10, approved_by=$11, approved_date=$12,
           updated_by=$13, updated_at=NOW(), updated_device=$14
       WHERE id=$15 RETURNING *`,
      [finalEmployeeId, leaveTypeCode, fromDate, toDate, days, reason, !!halfDay,
       finalStatus, finalRecoBy, finalRecoDate, finalAppBy, finalAppDate,
       req.user.id, deviceInfo || null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Leave not found' });
    const leave = toLeave(rows[0]);
    logAudit({ actor: req.user, action: 'edit', entity: 'leave', entityId: req.params.id, before: null, after: leave });
    res.json(leave);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:id/recommend', validateBody({ comment: { max: 2000 } }), async (req, res) => {
  const { comment } = req.body;
  try {
    const { rows: existingRows } = await pool.query('SELECT employee_id, approval_id, reco_id FROM leaves WHERE id=$1', [req.params.id]);
    if (!existingRows[0]) return res.status(404).json({ error: 'Leave not found' });
    const authError = await authorizeRecoAction(req, existingRows[0].employee_id, 'recommend', { pickedId: existingRows[0].reco_id });
    if (authError) return res.status(authError.status).json({ error: authError.error });

    const { rows } = await pool.query(
      `UPDATE leaves SET recommended_by=$1, recommended_date=CURRENT_DATE, recommended_at=CURRENT_TIMESTAMP, recommend_comment=$3 WHERE id=$2 RETURNING *`,
      [req.user.id, req.params.id, comment || null]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Leave not found' });
    notifyApproversNext(existingRows[0].employee_id, req.user.id, { subject: 'Leave recommended — needs approval', body: `A leave request (${String(rows[0].from_date).slice(0, 10)} to ${String(rows[0].to_date).slice(0, 10)}) was recommended and is waiting for your approval.`, path: '/m/approvals', pickedApproverId: existingRows[0].approval_id });
    res.json(toLeave(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:id/approve', validateBody({ comment: { max: 2000 } }), async (req, res) => {
  const { comment } = req.body;
  try {
    const { rows: existingRows } = await pool.query('SELECT employee_id, recommended_by, approval_id FROM leaves WHERE id=$1', [req.params.id]);
    if (!existingRows[0]) return res.status(404).json({ error: 'Leave not found' });
    const authError = await authorizeRecoAction(req, existingRows[0].employee_id, 'approve',
      { alreadyRecommended: !!existingRows[0].recommended_by, pickedId: existingRows[0].approval_id });
    if (authError) return res.status(authError.status).json({ error: authError.error });

    const { rows } = await pool.query(
      `UPDATE leaves SET status='approved', approved_by=$1, approved_date=CURRENT_DATE, approved_at=CURRENT_TIMESTAMP, comment=$2
       WHERE id=$3 RETURNING *`,
      [req.user.id, comment || '', req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Leave not found' });
    const leave = toLeave(rows[0]);
    logAudit({ actor: req.user, action: 'approve', entity: 'leave', entityId: req.params.id, before: null, after: leave });
    notifyLeaveStatusUpdate(leave);
    res.json(leave);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:id/reject', validateBody({ comment: { max: 2000 } }), async (req, res) => {
  const { comment } = req.body;
  try {
    const { rows: existingRows } = await pool.query('SELECT employee_id, approval_id FROM leaves WHERE id=$1', [req.params.id]);
    if (!existingRows[0]) return res.status(404).json({ error: 'Leave not found' });
    const authError = await authorizeRecoAction(req, existingRows[0].employee_id, 'reject', { pickedId: existingRows[0].approval_id });
    if (authError) return res.status(authError.status).json({ error: authError.error });

    const { rows } = await pool.query(
      `UPDATE leaves SET status='rejected', approved_by=$1, approved_date=CURRENT_DATE, approved_at=CURRENT_TIMESTAMP, comment=$2
       WHERE id=$3 RETURNING *`,
      [req.user.id, comment || '', req.params.id]
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
    const { rows: existingRows } = await pool.query('SELECT employee_id, status, recommended_by, is_manual FROM leaves WHERE id=$1', [req.params.id]);
    if (!existingRows[0]) return res.status(404).json({ error: 'Leave not found' });
    // Same rule as PUT above: a Branch Manager / Branch Area Manager may
    // delete an in-scope staff member's leave, or their own Manual Posting
    // — the frontend already offers Delete to them (isManager).
    const managerOk = await canManagerPostFor(req, existingRows[0].employee_id)
      || (existingRows[0].is_manual && await canManagerManualPost(req, existingRows[0].employee_id));
    const authError = managerOk ? null : authorizeOwnEditDelete(req, existingRows[0].employee_id, existingRows[0]);
    if (authError) return res.status(authError.status).json({ error: authError.error });

    await pool.query('DELETE FROM leaves WHERE id=$1', [req.params.id]);
    logAudit({ actor: req.user, action: 'delete', entity: 'leave', entityId: req.params.id, before: existingRows[0], after: null });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
