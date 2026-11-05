/**
 * Overtime Approval Routes
 * GET  /api/overtime?startDate=&endDate=   — list OT records (calculated + approval status)
 * POST /api/overtime/generate              — upsert pending OT records from attendance logs
 * PATCH /api/overtime/:id/recommend        — recommend one record (has a DB row already)
 * POST  /api/overtime/recommend-inline     — recommend by empId+date (no DB row yet)
 * PATCH /api/overtime/:id/approve          — approve one record
 * PATCH /api/overtime/:id/reject           — reject one record
 * POST  /api/overtime/approve-inline       — approve/reject by empId+date (no DB row yet)
 * POST  /api/overtime/bulk-approve         — approve multiple by ids
 * DELETE /api/overtime/:id                 — delete (reset) one record
 *
 * Every route that sets status/approved_by/recommended_by — including
 * bulk-approve and approve-leave — runs through authorizeRecoAction (same
 * guard Leave/Office Visit use) for any non-privileged caller: the acting
 * user must be the employee's configured approver/recommender and can never
 * act on their own application, and while Recommendation Compulsory is on,
 * approval requires an existing recommendation and the configured
 * recommender can never also approve. Only admin/superAdmin may record
 * someone ELSE as the approver/recommender (bulk-approve/approve-leave's
 * "record a decision someone else already made" pickers) — everyone else is
 * always recorded as themselves.
 */
import { notifyApplicantOf, notifyApproversNext } from '../services/approvalNotify.js';
import { Router } from 'express';
import pool       from '../db.js';
import { logError } from '../utils/logError.js';
import { resolveOrgScope, resolveOrgEmployeeIds, canManagerManualPost } from './orgScope.js';
import { loadRosterMap, getEffectiveRoster, isRosterWeekend, bucketPunchesByShiftDay, resolveWinterShift } from './attendance.js';
import { authorizeRecoAction } from '../services/recoApprovalGuard.js';

const router  = Router();
const PRIVILEGED_ROLES = ['admin', 'superAdmin'];

// Branch Manager / Branch Area Manager approving OT for their own branch staff
// or themself counts as their Manual Posting and is allowed outright (see
// canManagerManualPost); everyone else goes through the normal configured
// recommender/approver check.
async function authorizeOtAction(req, employeeId, action, opts) {
  if (await canManagerManualPost(req, employeeId).catch(() => false)) return null;
  return authorizeRecoAction(req, employeeId, action, opts);
}
const pad2    = (n) => String(Math.round(n)).padStart(2, '0');
const toHHMM  = (m) => `${pad2(Math.floor(Math.abs(m)/60))}:${pad2(Math.abs(m)%60)}`;
const toDateS = (v) => {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().split('T')[0];
  return String(v).split('T')[0];
};

const DOW_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

/* Reverses a previously-granted "Provide Next Day Leave" credit on a single
   overtime_approvals row, if it has one — shared by reject and reset (DELETE)
   so a mistaken grant never leaves a stuck credit in leave_balances. Caller
   owns the transaction; this only reads/writes within it. */
async function reverseLeaveGrant(client, approvalId) {
  const { rows } = await client.query(
    `SELECT employee_id, leave_type_code, leave_days FROM overtime_approvals WHERE id=$1`,
    [approvalId]
  );
  const row = rows[0];
  if (!row?.leave_type_code || !row?.leave_days) return;
  await client.query(
    `UPDATE leave_balances SET balance = balance - $1 WHERE employee_id=$2 AND leave_type_code=$3`,
    [row.leave_days, row.employee_id, row.leave_type_code]
  );
}

/* ── GET /api/overtime?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&status=pending ─ */
router.get('/', async (req, res) => {
  const { startDate, endDate, status } = req.query;
  if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate are required' });

  const scope = resolveOrgScope(req);
  const scopeParams = [];
  let scopeCond = '';
  // Placeholder numbers must line up with the actual params array passed
  // below, `[shiftName, ...scopeParams]` — shiftName is always $1, so the
  // (single, if/else-if) scope param is $2. This previously used +3, a
  // leftover from a different query shape — since scopeParams never has
  // more than one entry, that always produced $4, a placeholder that never
  // appears anywhere the query text actually uses $2/$3, either. Postgres
  // can't infer a type for a placeholder it never sees referenced, so this
  // failed with "could not determine data type of parameter $2" whenever a
  // department/branch/self-scoped (non-admin) request hit this endpoint.
  if (scope.level === 'department') {
    scopeParams.push(scope.value);
    scopeCond = `AND u.department = $${scopeParams.length + 1}`;
    // Dept Head with a branch on their own profile — see orgScope.js.
    if (scope.branchValue) { scopeParams.push(scope.branchValue); scopeCond += ` AND u.branch = $${scopeParams.length + 1}`; }
  }
  else if (scope.level === 'branch') { scopeParams.push(scope.value); scopeCond = `AND u.branch = $${scopeParams.length + 1}`; }
  else if (scope.level === 'self')   { scopeParams.push(scope.value); scopeCond = `AND u.id = $${scopeParams.length + 1}`; }
  // Branch Area Manager / Department Incharge — several branches/departments
  // (manager_branch_coverage / manager_department_coverage), resolved the
  // same way every other OT-adjacent route does via resolveOrgEmployeeIds
  // rather than re-deriving the coverage JOIN inline here.
  else if (scope.level === 'branches' || scope.level === 'departments') {
    const coveredIds = await resolveOrgEmployeeIds(req);
    scopeParams.push(coveredIds || []);
    scopeCond = `AND u.id = ANY($${scopeParams.length + 1}::int[])`;
  }

  try {
    // 1. Load default shift (start, end, grace, name)
    const shiftRow = await pool.query(`SELECT * FROM shifts WHERE make_default=TRUE LIMIT 1`);
    const defShift  = shiftRow.rows[0];
    const shiftStart = defShift?.start_time?.toString().substring(0, 5) || '10:00';
    const shiftEnd   = defShift?.end_time?.toString().substring(0, 5)   || '17:00';
    const shiftName  = defShift?.name_en || defShift?.name || 'Standard';
    const graceSt    = defShift?.grace_period_start || 0;
    const graceEd    = defShift?.grace_period_end   || 0;

    // 1b. Weekend days + public holidays — needed below to stop the
    // shift-relative "nothing to show" filter from silently dropping
    // Present-on-Weekend/Holiday records (see comment at the filter itself).
    // Same app_settings.main source the frontend's own weekend/holiday
    // detection already uses (OvertimePage.jsx's settings.defaultWeekends /
    // settings.publicHolidays), so both sides agree on what counts as one.
    const { rows: mainRows } = await pool.query(`SELECT value FROM app_settings WHERE key='main'`);
    const appMain       = mainRows[0]?.value || {};
    const weekendDays   = appMain.defaultWeekends || ['Sat'];
    const publicHolidays = appMain.publicHolidays || [];
    const getHolidayName = (dateStr) => {
      const h = publicHolidays.find(ph => ph.startDate && ph.endDate && dateStr >= ph.startDate && dateStr <= ph.endDate);
      return h?.name || null;
    };

    // 1c. Duty roster — a staff member's roster-assigned Day Off/Night Off (or
    // a non-default shift's own off-days) is a personal rest day just like the
    // company-wide weekend, but was previously invisible to OT entirely since
    // this route only ever checked the company-wide weekend list. Reuses the
    // exact same rotation-resolution helpers every other attendance report
    // already relies on (attendance.js), rather than re-deriving roster logic
    // here. Widened a day each side so bucketPunchesByShiftDay (below) can
    // resolve "yesterday"'s shift even at the range's start boundary.
    const rangeStart = toDateS(new Date(new Date(startDate).getTime() - 86400000));
    const rangeEnd   = toDateS(new Date(new Date(endDate).getTime()   + 86400000));
    const rosterMap = await loadRosterMap(rangeStart, rangeEnd);

    // 2. Employee info for everyone in scope — attendance is fetched and
    //    shift-day bucketed separately below (see 2b), rather than joined
    //    here, since a shift crossing midnight needs roster-aware bucketing
    //    a plain `check_time::date` GROUP BY can't express.
    const { rows: userRows } = await pool.query(`
      SELECT
        u.id                             AS employee_id,
        u.full_name,
        u.department,
        u.position,
        u.employee_id                    AS emp_code,
        COALESCE(s.name_en, s.name, $1)  AS emp_shift_name,
        COALESCE(br.short_name, '')      AS branch_short,
        COALESCE(p.short_name,  u.position,   '') AS post_short,
        COALESCE(d.short_name,  u.department, '') AS dept_short,
        u.grade, u.gender, u.mode,
        u.timing_type                    AS "timingType",
        u.ranking_order                  AS staff_rank,
        br.ranking_order                 AS branch_rank,
        u.eligible_for_ot                AS eligible_for_ot,
        s.start_time                     AS shift_start,
        s.end_time                       AS shift_end,
        s.grace_period_start             AS grace_st,
        s.grace_period_end               AS grace_ed,
        s.winter_policy_enabled          AS shift_winter_enabled,
        s.winter_policy                  AS shift_winter_policy
      FROM users u
      LEFT JOIN shifts      s  ON s.code = u.shift
      LEFT JOIN LATERAL (SELECT * FROM branches WHERE name = u.branch ORDER BY id LIMIT 1) br ON TRUE
      LEFT JOIN LATERAL (SELECT * FROM posts WHERE name = u.position ORDER BY id LIMIT 1) p ON TRUE
      LEFT JOIN LATERAL (SELECT * FROM departments WHERE name = u.department ORDER BY id LIMIT 1) d ON TRUE
      WHERE u.active = TRUE
        ${scopeCond}
    `, [shiftName, ...scopeParams]);
    const userMap = new Map(userRows.map(u => [u.employee_id, u]));

    // 2b. Raw punches in the widened range — merges ZKTeco device logs with
    //     manually-posted attendance (attendance_manual_postings), the same
    //     UNION ALL pattern every other report in attendance.js already
    //     uses, then bucketed into shift-days per employee (instead of a
    //     plain GROUP BY check_time::date, which pairs the wrong punches
    //     together for a shift crossing midnight — see bucketPunchesByShiftDay).
    const { rows: rawRows } = await pool.query(`
      SELECT employee_id, check_time FROM zkteco_attendance_logs
      WHERE  check_time::date BETWEEN $1 AND $2 AND employee_id IS NOT NULL
      UNION ALL
      SELECT employee_id, (date + check_in)::timestamp::timestamptz AS check_time
      FROM   attendance_manual_postings
      WHERE  date BETWEEN $1 AND $2 AND check_in IS NOT NULL AND status = 'approved'
      UNION ALL
      SELECT employee_id, (date + check_out)::timestamp::timestamptz AS check_time
      FROM   attendance_manual_postings
      WHERE  date BETWEEN $1 AND $2 AND check_out IS NOT NULL AND status = 'approved'
    `, [rangeStart, rangeEnd]);

    const rawByEmp = new Map();
    for (const r of rawRows) {
      if (!rawByEmp.has(r.employee_id)) rawByEmp.set(r.employee_id, []);
      rawByEmp.get(r.employee_id).push(r.check_time);
    }

    const logRows = [];
    for (const [empId, timestamps] of rawByEmp) {
      const user = userMap.get(empId);
      if (!user) continue; // inactive or out of the requester's org scope
      const buckets = bucketPunchesByShiftDay(timestamps, empId, rosterMap, defShift);
      for (const [dateStr, b] of buckets) {
        if (dateStr < startDate || dateStr > endDate) continue;
        if (b.punchCount < 2) continue; // same "at least 2 punches" gate as before
        logRows.push({ ...user, date: dateStr, time_in: b.timeIn, time_out: b.timeOut, punches: b.punchCount });
      }
    }

    // 3. Existing approval records
    const { rows: approvals } = await pool.query(`
      SELECT oa.*, u.full_name AS approved_by_name, ru.full_name AS recommended_by_name
      FROM overtime_approvals oa
      LEFT JOIN users u  ON u.id  = oa.approved_by
      LEFT JOIN users ru ON ru.id = oa.recommended_by
      WHERE oa.date BETWEEN $1 AND $2
    `, [startDate, endDate]);
    const approvalMap = new Map();
    for (const a of approvals) {
      approvalMap.set(`${a.employee_id}-${toDateS(a.date)}`, a);
    }

    // 4. Build records with OT in IN, OT in OUT, net OT
    const records = [];

    for (const r of logRows) {
      const ds    = toDateS(r.date);
      const inDt  = new Date(r.time_in);
      const outDt = new Date(r.time_out);
      const [dy, mo, dd] = ds.split('-').map(Number);

      // Day of week + weekend/holiday check — a weekend/holiday Present day
      // has no meaningful "shift-relative" OT (the shift-based filter right
      // below doesn't apply to it), so it must never be skipped by that
      // check even when it happens to land near-zero on it. "Weekend" here
      // also includes a roster-assigned Day Off/Night Off (or a non-default
      // shift's own off-days) for this specific employee on this specific
      // date — a personal rest day, not just the company-wide pattern.
      const dayOfWeek     = DOW_SHORT[new Date(dy, mo - 1, dd).getDay()];
      const roster        = getEffectiveRoster(rosterMap, r.employee_id, ds);
      const isWeekendDay  = isRosterWeekend(roster, dayOfWeek, weekendDays, defShift?.id);
      const rosterOffType = roster?.isOff
        ? (roster.shiftName === 'Night Off' ? 'nightOff' : (roster.shiftName === 'Day Off' ? 'dayOff' : 'weekend'))
        : null;
      const holidayName   = getHolidayName(ds);
      const isSpecialDay  = isWeekendDay || !!holidayName;

      // Effective shift for THIS employee on THIS date: roster override (a
      // shift assigned/changed via Duty Roster) > the employee's own shift >
      // the company default — same precedence every other attendance report
      // already uses. Previously this route always used the company default
      // shift's start/end for every employee's OT math, so a roster-assigned
      // or individually-assigned shift never changed what OT Approval showed.
      const empShiftStart = r.shift_start?.toString().substring(0,5) || shiftStart;
      const empShiftEnd   = r.shift_end?.toString().substring(0,5)   || shiftEnd;
      const empGraceSt    = r.grace_st ?? graceSt;
      const empGraceEd    = r.grace_ed ?? graceEd;
      const empWinterEnabled = r.shift_start ? r.shift_winter_enabled : defShift?.winter_policy_enabled;
      const empWinterPolicy  = r.shift_start ? r.shift_winter_policy  : defShift?.winter_policy;
      const fallbackShift = resolveWinterShift(ds, empShiftStart, empShiftEnd, empGraceSt, empGraceEd, empWinterEnabled, empWinterPolicy);
      const effShiftStart = roster?.shiftStart || fallbackShift.shiftStart;
      const effShiftEnd   = roster?.shiftEnd   || fallbackShift.shiftEnd;
      const effGraceSt    = roster?.graceSt    != null ? roster.graceSt : fallbackShift.graceStart;
      const effGraceEd    = roster?.graceEd    != null ? roster.graceEd : fallbackShift.graceEnd;
      const [effSh, effSm] = effShiftStart.split(':').map(Number);
      const [effEh, effEm] = effShiftEnd.split(':').map(Number);
      const effShiftStartMins = effSh * 60 + effSm;
      const effShiftEndMins   = effEh * 60 + effEm;

      // Actual times in minutes (using local time components)
      const actualInMins  = inDt.getHours() * 60 + inDt.getMinutes();
      const actualOutMins = outDt.getHours() * 60 + outDt.getMinutes();

      // OT in IN: positive = came early (extra before shift), negative = came late
      const rawOTinIN  = effShiftStartMins - actualInMins;  // +early / -late
      // Apply grace: within grace window → treat as 0
      const otInINMins = rawOTinIN > 0
        ? rawOTinIN                                             // early arrival
        : (Math.abs(rawOTinIN) > effGraceSt ? rawOTinIN : 0);  // late beyond grace

      // OT in OUT: positive = stayed late, negative = left early
      const rawOTinOUT  = actualOutMins - effShiftEndMins;  // +late / -early
      const otInOUTMins = rawOTinOUT > 0
        ? rawOTinOUT                                              // late departure
        : (Math.abs(rawOTinOUT) > effGraceEd ? rawOTinOUT : 0); // early beyond grace

      // Net calculated OT — OT IN and OT OUT are independent signals (an
      // early arrival and a late departure are each their own overtime
      // credit, not netted against each other), so summing them here is
      // only ever used for the DB-approval default below, never for
      // deciding whether the record has anything worth showing.
      const netOTMins = otInINMins + otInOUTMins;
      // Regular working days stay gated by "Eligible for OT" (Employee
      // Management) — that flag means "authorized for paid OT," which only
      // makes sense relative to a shift's start/end. A weekend/holiday
      // Present record is a different thing (tracking who showed up on a
      // day off), so it's always kept regardless of both this flag and the
      // shift-relative math below, so OvertimePage.jsx's own weekend/
      // holiday-aware recalculation (and its "Present in Weekend"/"Present
      // in Public Holiday" filters) actually has the record to work with
      // instead of it being silently dropped here first.
      //
      // Skip only when NEITHER side has anything positive to show — e.g. a
      // 3-hour early arrival must never be silently dropped just because
      // the same person also left early that day (large negative
      // otInOUTMins used to drag the summed netOTMins below zero and hide
      // the whole record, along with its legitimate OT-in credit).
      if (!isSpecialDay) {
        if (!r.eligible_for_ot) continue;
        if (otInINMins <= 0 && otInOUTMins <= 0) continue;
      }

      const key  = `${r.employee_id}-${ds}`;
      const appr = approvalMap.get(key);

      // Manager-approved OT (from DB, editable) or default to calculated
      const approvedOTMins = appr?.ot_minutes ?? (netOTMins > 0 ? netOTMins : 0);

      const rec = {
        approvalId     : appr?.id || null,
        employeeId     : r.employee_id,
        empCode        : r.emp_code,
        fullName       : r.full_name,
        department     : r.department     || '—',
        deptShort      : r.dept_short     || r.department || '—',
        position       : r.position       || '—',
        postShort      : r.post_short     || r.position   || '—',
        branchShort    : r.branch_short   || '—',
        staffRank      : r.staff_rank,
        branchRank     : r.branch_rank,
        shiftName      : roster?.shiftName || r.emp_shift_name || shiftName,
        grade      : r.grade      || '—',
        gender     : r.gender     || '—',
        mode       : r.mode       || '—',
        timingType : r.timingType || '—',
        shiftStart : effShiftStart,
        shiftEnd   : effShiftEnd,
        date           : ds,
        day            : dayOfWeek,
        rosterOffType,
        timeIn         : `${String(inDt.getHours()).padStart(2,'0')}:${String(inDt.getMinutes()).padStart(2,'0')}`,
        timeOut        : `${String(outDt.getHours()).padStart(2,'0')}:${String(outDt.getMinutes()).padStart(2,'0')}`,
        // Signed OT components
        otInINMins,
        otInOUTMins,
        otInINFormatted  : otInINMins  >= 0 ? `+${toHHMM(otInINMins)}`  : `-${toHHMM(otInINMins)}`,
        otInOUTFormatted : otInOUTMins >= 0 ? `+${toHHMM(otInOUTMins)}` : `-${toHHMM(otInOUTMins)}`,
        // Calculated and approved OT
        otMinutes      : netOTMins > 0 ? netOTMins : 0,
        otFormatted    : netOTMins > 0 ? toHHMM(netOTMins) : '00:00',
        approvedOTMins,
        approvedOTFormatted : toHHMM(approvedOTMins),
        // Approval info
        status         : appr?.status || 'pending',
        approvedBy     : appr?.approved_by    || null,
        approvedByName : appr?.approved_by_name || null,
        approvedDate   : toDateS(appr?.approved_date),
        recommendedBy    : appr?.recommended_by      || null,
        recommendedByName: appr?.recommended_by_name || null,
        recommendedDate  : toDateS(appr?.recommended_date),
        comment        : appr?.comment || '',
        // "Provide Next Day Leave" conversion (set only via /approve-leave)
        leaveTypeCode  : appr?.leave_type_code || null,
        leaveDays      : appr?.leave_days != null ? parseFloat(appr.leave_days) : null,
      };

      if (!status || status === 'all' || rec.status === status) records.push(rec);
    }

    // Sort: pending first, then by date desc, then by branch/staff ranking order
    // (a tiebreak within the same status+date group — not a replacement of the
    // workflow-priority ordering above).
    records.sort((a, b) => {
      if (a.status === 'pending' && b.status !== 'pending') return -1;
      if (a.status !== 'pending' && b.status === 'pending') return  1;
      const dateCmp = b.date.localeCompare(a.date);
      if (dateCmp !== 0) return dateCmp;
      const brA = a.branchRank > 0 ? a.branchRank : Infinity;
      const brB = b.branchRank > 0 ? b.branchRank : Infinity;
      if (brA !== brB) return brA - brB;
      const srA = a.staffRank > 0 ? a.staffRank : Infinity;
      const srB = b.staffRank > 0 ? b.staffRank : Infinity;
      return srA - srB;
    });

    res.json({ records, total: records.length });
  } catch (e) {
    logError('[overtime GET]', e);
    res.status(500).json({ error: e.message });
  }
});

/* ── POST /api/overtime/generate — upsert pending records from attendance logs ─ */
router.post('/generate', async (req, res) => {
  const { startDate, endDate } = req.body;
  if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate required' });

  try {
    const shiftRow = await pool.query(`SELECT * FROM shifts WHERE make_default=TRUE LIMIT 1`);
    const defShift = shiftRow.rows[0];
    const shiftEnd = defShift?.end_time?.toString().substring(0, 5) || '17:00';
    const graceEd  = defShift?.grace_period_end || 0;
    const [eh, em] = shiftEnd.split(':').map(Number);

    const { rows: logRows } = await pool.query(`
      SELECT employee_id, check_time::date AS date,
             MAX(check_time) AS time_out, COUNT(*)::int AS punches
      FROM zkteco_attendance_logs
      WHERE check_time::date BETWEEN $1 AND $2
        AND employee_id IS NOT NULL
      GROUP BY employee_id, check_time::date
      HAVING COUNT(*) >= 2
    `, [startDate, endDate]);

    let inserted = 0;
    for (const r of logRows) {
      const ds    = toDateS(r.date);
      const outDt = new Date(r.time_out);
      const [dy, mo, dd] = ds.split('-').map(Number);
      const eDt   = new Date(dy, mo-1, dd, eh, em);
      const rawOT = Math.round((outDt - eDt) / 60000) - graceEd;
      if (rawOT <= 0) continue;

      await pool.query(`
        INSERT INTO overtime_approvals (employee_id, date, ot_minutes, status)
        VALUES ($1, $2, $3, 'pending')
        ON CONFLICT (employee_id, date) DO NOTHING
      `, [r.employee_id, ds, rawOT]);
      inserted++;
    }

    res.json({ success: true, inserted });
  } catch (e) {
    logError('[overtime generate]', e);
    res.status(500).json({ error: e.message });
  }
});

/* ── PATCH /api/overtime/:id/recommend ───────────────────────────────────────── */
router.patch('/:id/recommend', async (req, res) => {
  try {
    const { rows: existingRows } = await pool.query('SELECT employee_id FROM overtime_approvals WHERE id=$1', [req.params.id]);
    if (!existingRows[0]) return res.status(404).json({ error: 'OT record not found' });
    const authError = await authorizeOtAction(req, existingRows[0].employee_id, 'recommend');
    if (authError) return res.status(authError.status).json({ error: authError.error });

    const { rows } = await pool.query(
      `UPDATE overtime_approvals SET recommended_by=$1, recommended_date=CURRENT_DATE, comment=COALESCE(NULLIF($3,''), comment) WHERE id=$2 RETURNING *`,
      [req.user.id, req.params.id, String(req.body?.comment || '').slice(0, 500)]
    );
    if (!rows[0]) return res.status(404).json({ error: 'OT record not found' });
    notifyApproversNext(existingRows[0].employee_id, req.user.id, { subject: 'Overtime recommended — needs approval', body: `An overtime record for ${String(rows[0].date).slice(0, 10)} was recommended and is waiting for your approval.`, path: '/m/approvals' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── POST /api/overtime/recommend-inline — recommend by empId+date (no DB row yet) ─
   A calculated OT record only gets a row in overtime_approvals once someone acts
   on it (see approvalId: appr?.id || null in the GET above), so recommending one
   that's never been touched needs the same insert-or-update-by-(employee,date)
   shape as approve-inline below, rather than requiring a PATCH :id first. */
router.post('/recommend-inline', async (req, res) => {
  const { employeeId, date, otMinutes, comment } = req.body;
  if (!employeeId || !date) return res.status(400).json({ error: 'employeeId and date required' });
  try {
    const authError = await authorizeOtAction(req, employeeId, 'recommend');
    if (authError) return res.status(authError.status).json({ error: authError.error });

    const { rows } = await pool.query(`
      INSERT INTO overtime_approvals (employee_id, date, ot_minutes, status, recommended_by, recommended_date, comment)
      VALUES ($1, $2, $3, 'pending', $4, CURRENT_DATE, $5)
      ON CONFLICT (employee_id, date) DO UPDATE
        SET recommended_by=$4, recommended_date=CURRENT_DATE, comment=COALESCE(NULLIF($5,''), overtime_approvals.comment)
      RETURNING *
    `, [employeeId, date, otMinutes || 0, req.user.id, String(comment || '').slice(0, 500)]);
    notifyApproversNext(employeeId, req.user.id, { subject: 'Overtime recommended — needs approval', body: `An overtime record for ${String(date).slice(0, 10)} was recommended and is waiting for your approval.`, path: '/m/approvals' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── PATCH /api/overtime/:id/approve ─────────────────────────────────────────── */
router.patch('/:id/approve', async (req, res) => {
  const { comment, approvedOTMins } = req.body;
  try {
    const { rows: existingRows } = await pool.query(
      'SELECT employee_id, recommended_by FROM overtime_approvals WHERE id=$1', [req.params.id]
    );
    if (!existingRows[0]) return res.status(404).json({ error: 'OT record not found' });
    const authError = await authorizeOtAction(req, existingRows[0].employee_id, 'approve',
      { alreadyRecommended: !!existingRows[0].recommended_by });
    if (authError) return res.status(authError.status).json({ error: authError.error });

    const { rows } = await pool.query(`
      UPDATE overtime_approvals
         SET status='approved', approved_by=$1, approved_date=CURRENT_DATE, comment=$2,
             ot_minutes=COALESCE($3, ot_minutes)
       WHERE id=$4
       RETURNING *
    `, [req.user.id, comment || '', approvedOTMins ?? null, req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'OT record not found' });
    notifyApplicantOf(existingRows[0].employee_id, req.user.id, { subject: 'Overtime approved', body: `Your overtime for ${String(rows[0].date).slice(0, 10)} was approved.${comment ? ' ' + comment : ''}`, path: '/m/attendance' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── PATCH /api/overtime/:id/reject ──────────────────────────────────────────── */
router.patch('/:id/reject', async (req, res) => {
  const { comment } = req.body;
  const { rows: existingRows } = await pool.query(
    'SELECT employee_id FROM overtime_approvals WHERE id=$1', [req.params.id]
  );
  if (!existingRows[0]) return res.status(404).json({ error: 'OT record not found' });
  const authError = await authorizeOtAction(req, existingRows[0].employee_id, 'reject');
  if (authError) return res.status(authError.status).json({ error: authError.error });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Reversing a prior leave-in-lieu grant on reject — a mistaken grant
    // must not leave a stuck credit sitting in the employee's balance.
    await reverseLeaveGrant(client, req.params.id);
    const { rows } = await client.query(`
      UPDATE overtime_approvals
         SET status='rejected', approved_by=$1, approved_date=CURRENT_DATE, comment=$2,
             leave_type_code=NULL, leave_days=NULL
       WHERE id=$3
       RETURNING *
    `, [req.user.id, comment || '', req.params.id]);
    if (!rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'OT record not found' }); }
    await client.query('COMMIT');
    notifyApplicantOf(existingRows[0].employee_id, req.user.id, { subject: 'Overtime rejected', body: `Your overtime for ${String(rows[0].date).slice(0, 10)} was rejected.${comment ? ' Reason: ' + comment : ''}`, path: '/m/attendance' });
    res.json(rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

/* ── POST /api/overtime/approve-inline — approve/reject by empId+date (no DB id yet) ─ */
router.post('/approve-inline', async (req, res) => {
  const { employeeId, date, otMinutes, action, comment } = req.body;
  if (!employeeId || !date || !action) return res.status(400).json({ error: 'employeeId, date, action required' });

  const status = action === 'approve' ? 'approved' : 'rejected';
  try {
    const { rows: existingRows } = await pool.query(
      'SELECT recommended_by FROM overtime_approvals WHERE employee_id=$1 AND date=$2', [employeeId, date]
    );
    const authError = await authorizeOtAction(req, employeeId, action,
      { alreadyRecommended: !!existingRows[0]?.recommended_by });
    if (authError) return res.status(authError.status).json({ error: authError.error });

    const { rows } = await pool.query(`
      INSERT INTO overtime_approvals (employee_id, date, ot_minutes, status, approved_by, approved_date, comment)
      VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, $6)
      ON CONFLICT (employee_id, date) DO UPDATE
        SET ot_minutes=$3, status=$4, approved_by=$5, approved_date=CURRENT_DATE, comment=$6
      RETURNING *
    `, [employeeId, date, otMinutes || 0, status, req.user.id, comment || '']);
    notifyApplicantOf(employeeId, req.user.id, { subject: `Overtime ${status}`, body: `Your overtime for ${String(date).slice(0, 10)} was ${status}.${comment ? ' ' + comment : ''}`, path: '/m/attendance' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── POST /api/overtime/approve-leave — convert a "Present" weekend/holiday
   record into a leave-balance credit instead of paid OT minutes ("Provide
   Next Day Leave"). Positive, additive credit only (no negative `leaves`
   row) — writes straight to leave_balances.balance. Reverses any prior
   grant on the same record first, so re-picking a different type/day-count
   for the same record never double-credits. ─────────────────────────────── */
router.post('/approve-leave', async (req, res) => {
  const { employeeId, date, leaveTypeCode, leaveDays, approvedBy, comment } = req.body;
  if (!employeeId || !date || !leaveTypeCode) {
    return res.status(400).json({ error: 'employeeId, date and leaveTypeCode are required' });
  }
  const days = Math.round(Number(leaveDays) * 10) / 10;
  if (!(days > 0) || days > 2 || !Number.isInteger(days * 2)) {
    return res.status(400).json({ error: 'Leave days must be greater than 0, at most 2, in half-day steps (e.g. 0.5, 1, 1.5, 2)' });
  }

  // This is an 'approve' action (it sets status='approved' and credits a
  // leave balance) — must go through the same guard as every other approve
  // endpoint. Previously this route trusted employeeId/approvedBy straight
  // from the body with no check at all, so any authenticated user could
  // credit themselves (or anyone) leave in lieu of OT.
  const isPrivileged = PRIVILEGED_ROLES.includes(req.user.role);
  if (!isPrivileged) {
    const { rows: existingApprRows } = await pool.query(
      'SELECT recommended_by FROM overtime_approvals WHERE employee_id=$1 AND date=$2', [employeeId, date]
    );
    const authError = await authorizeOtAction(req, employeeId, 'approve',
      { alreadyRecommended: !!existingApprRows[0]?.recommended_by });
    if (authError) return res.status(authError.status).json({ error: authError.error });
  }
  // Only a privileged user may record someone ELSE as the approver (proxy
  // entry for a decision made outside the app) — everyone else is always
  // recorded as themselves, matching the authorizeRecoAction check above.
  const finalApprovedBy = isPrivileged ? (approvedBy || req.user.id) : req.user.id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Reverse any leave already granted for this exact record before applying
    // the new one — otherwise editing a grant (different type or day count)
    // would stack on top of the old credit instead of replacing it.
    const { rows: existingRows } = await client.query(
      `SELECT leave_type_code, leave_days FROM overtime_approvals WHERE employee_id=$1 AND date=$2`,
      [employeeId, date]
    );
    const existing = existingRows[0];
    if (existing?.leave_type_code && existing?.leave_days) {
      await client.query(
        `UPDATE leave_balances SET balance = balance - $1 WHERE employee_id=$2 AND leave_type_code=$3`,
        [existing.leave_days, employeeId, existing.leave_type_code]
      );
    }

    await client.query(
      `INSERT INTO leave_balances (employee_id, leave_type_code, balance)
       VALUES ($1, $2, $3)
       ON CONFLICT (employee_id, leave_type_code)
       DO UPDATE SET balance = leave_balances.balance + $3`,
      [employeeId, leaveTypeCode, days]
    );

    const { rows: mainRows } = await client.query(`SELECT value FROM app_settings WHERE key='main'`);
    const leaveTypeName = (mainRows[0]?.value?.leaveTypeConfigs || [])
      .find(lt => lt.shortName === leaveTypeCode)?.name || leaveTypeCode;
    const autoComment  = `Converted to ${days} day(s) ${leaveTypeName} (worked ${date})`;
    const finalComment = comment ? `${autoComment} — ${comment}` : autoComment;

    const { rows } = await client.query(
      `INSERT INTO overtime_approvals
         (employee_id, date, ot_minutes, status, approved_by, approved_date, comment, leave_type_code, leave_days)
       VALUES ($1, $2, 0, 'approved', $3, CURRENT_DATE, $4, $5, $6)
       ON CONFLICT (employee_id, date) DO UPDATE
         SET ot_minutes=0, status='approved', approved_by=$3, approved_date=CURRENT_DATE,
             comment=$4, leave_type_code=$5, leave_days=$6
       RETURNING *`,
      [employeeId, date, finalApprovedBy, finalComment, leaveTypeCode, days]
    );

    const { rows: balRows } = await client.query(
      `SELECT balance FROM leave_balances WHERE employee_id=$1 AND leave_type_code=$2`,
      [employeeId, leaveTypeCode]
    );

    await client.query('COMMIT');
    res.json({ ...rows[0], newBalance: balRows[0] ? parseFloat(balRows[0].balance) : null });
  } catch (e) {
    await client.query('ROLLBACK');
    logError('[overtime approve-leave]', e);
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

/* ── POST /api/overtime/bulk-approve ─────────────────────────────────────────── */
router.post('/bulk-approve', async (req, res) => {
  const { records, action, approvedBy, approvedDate, comment,
          recommendedBy, recommendedDate } = req.body; // records: [{employeeId, date, otMinutes}]
  if (!records?.length) return res.status(400).json({ error: 'No records provided' });

  const status = action === 'approve' ? 'approved' : 'rejected';
  const isPrivileged = PRIVILEGED_ROLES.includes(req.user.role);
  // Only a privileged user may record someone ELSE as approver/recommender
  // (proxy entry for a decision made outside the app, e.g. "Approve All") —
  // everyone else is always recorded as themselves and can never self-act.
  const finalApprovedBy    = isPrivileged ? (approvedBy || req.user.id) : req.user.id;
  const finalRecommendedBy = isPrivileged ? (recommendedBy || null)     : null;
  try {
    let count = 0, skipped = 0;
    for (const r of records) {
      if (!isPrivileged) {
        const { rows: existingRows } = await pool.query(
          'SELECT recommended_by FROM overtime_approvals WHERE employee_id=$1 AND date=$2', [r.employeeId, r.date]
        );
        const authError = await authorizeOtAction(req, r.employeeId, action,
          { alreadyRecommended: !!existingRows[0]?.recommended_by });
        if (authError) { skipped++; continue; }
      }
      await pool.query(`
        INSERT INTO overtime_approvals
          (employee_id, date, ot_minutes, status, approved_by, approved_date, comment, recommended_by, recommended_date)
        VALUES ($1, $2, $3, $4, $5, COALESCE($7, CURRENT_DATE), $6, $8, $9)
        ON CONFLICT (employee_id, date) DO UPDATE
          SET ot_minutes=$3, status=$4, approved_by=$5, approved_date=COALESCE($7, CURRENT_DATE), comment=$6,
              recommended_by=$8, recommended_date=$9
      `, [r.employeeId, r.date, r.otMinutes || 0, status, finalApprovedBy, comment || '',
          approvedDate || null, finalRecommendedBy, recommendedDate || null]);
      count++;
    }
    res.json({ success: true, count, skipped });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── DELETE /api/overtime/:id — reset approval (back to pending) ─────────────── */
router.delete('/:id', async (req, res) => {
  // Resetting an OT decision (and reversing its leave-in-lieu credit) used to
  // have no authorization at all — any logged-in user could reset anyone's OT
  // approval by id. Same rule as rejecting it.
  const { rows: ex } = await pool.query('SELECT employee_id FROM overtime_approvals WHERE id=$1', [req.params.id]);
  if (!ex[0]) return res.status(404).json({ error: 'OT record not found' });
  const authError = await authorizeOtAction(req, ex[0].employee_id, 'reject');
  if (authError) return res.status(authError.status).json({ error: authError.error });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await reverseLeaveGrant(client, req.params.id);
    await client.query(`
      UPDATE overtime_approvals
         SET status='pending', approved_by=NULL, approved_date=NULL, comment='',
             leave_type_code=NULL, leave_days=NULL
       WHERE id=$1
    `, [req.params.id]);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

export default router;
