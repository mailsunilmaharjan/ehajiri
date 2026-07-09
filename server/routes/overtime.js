/**
 * Overtime Approval Routes
 * GET  /api/overtime?startDate=&endDate=   — list OT records (calculated + approval status)
 * POST /api/overtime/generate              — upsert pending OT records from attendance logs
 * PATCH /api/overtime/:id/approve          — approve one record
 * PATCH /api/overtime/:id/reject           — reject one record
 * POST  /api/overtime/bulk-approve         — approve multiple by ids
 * DELETE /api/overtime/:id                 — delete (reset) one record
 */
import { Router } from 'express';
import pool       from '../db.js';
import { logError } from '../utils/logError.js';
import { resolveOrgScope } from './orgScope.js';

const router  = Router();
const pad2    = (n) => String(Math.round(n)).padStart(2, '0');
const toHHMM  = (m) => `${pad2(Math.floor(Math.abs(m)/60))}:${pad2(Math.abs(m)%60)}`;
const toDateS = (v) => {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().split('T')[0];
  return String(v).split('T')[0];
};

const DOW_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

/* ── GET /api/overtime?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&status=pending ─ */
router.get('/', async (req, res) => {
  const { startDate, endDate, status } = req.query;
  if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate are required' });

  const scope = resolveOrgScope(req);
  const scopeParams = [];
  let scopeCond = '';
  if (scope.level === 'department') { scopeParams.push(scope.value); scopeCond = `AND u.department = $${scopeParams.length + 3}`; }
  else if (scope.level === 'branch') { scopeParams.push(scope.value); scopeCond = `AND u.branch = $${scopeParams.length + 3}`; }
  else if (scope.level === 'self')   { scopeParams.push(scope.value); scopeCond = `AND u.id = $${scopeParams.length + 3}`; }

  try {
    // 1. Load default shift (start, end, grace, name)
    const shiftRow = await pool.query(`SELECT * FROM shifts WHERE make_default=TRUE LIMIT 1`);
    const defShift  = shiftRow.rows[0];
    const shiftStart = defShift?.start_time?.toString().substring(0, 5) || '10:00';
    const shiftEnd   = defShift?.end_time?.toString().substring(0, 5)   || '17:00';
    const shiftName  = defShift?.name_en || defShift?.name || 'Standard';
    const graceSt    = defShift?.grace_period_start || 0;
    const graceEd    = defShift?.grace_period_end   || 0;

    const [sh, sm] = shiftStart.split(':').map(Number);
    const [eh, em] = shiftEnd.split(':').map(Number);
    const shiftStartMins = sh * 60 + sm;
    const shiftEndMins   = eh * 60 + em;

    // 2. All attendance logs in range with at least 2 punches
    //    Join shifts for shift name; use department/position strings from users directly
    const { rows: logRows } = await pool.query(`
      SELECT
        z.employee_id,
        z.check_time::date              AS date,
        MIN(z.check_time)               AS time_in,
        MAX(z.check_time)               AS time_out,
        COUNT(*)::int                   AS punches,
        u.full_name,
        u.department,
        u.position,
        u.employee_id                   AS emp_code,
        COALESCE(s.name_en, s.name, $3) AS emp_shift_name,
        -- Try to get short names from lookup tables, fall back to raw strings
        COALESCE(br.short_name, '')     AS branch_short,
        COALESCE(p.short_name,  u.position,   '') AS post_short,
        COALESCE(d.short_name,  u.department, '') AS dept_short,
        u.grade, u.gender, u.mode,
        u.timing_type                   AS "timingType"
      FROM zkteco_attendance_logs z
      JOIN users u ON u.id = z.employee_id
      LEFT JOIN shifts      s  ON s.code = u.shift
      LEFT JOIN branches    br ON br.name = u.branch
      LEFT JOIN posts       p  ON p.name  = u.position
      LEFT JOIN departments d  ON d.name  = u.department
      WHERE z.check_time::date BETWEEN $1 AND $2
        AND z.employee_id IS NOT NULL
        AND u.active = TRUE
        AND u.eligible_for_ot = TRUE
        ${scopeCond}
      GROUP BY z.employee_id, z.check_time::date,
               u.full_name, u.department, u.position, u.employee_id,
               br.short_name, p.short_name, d.short_name, s.name_en, s.name,
               u.grade, u.gender, u.mode, u.timing_type
      HAVING COUNT(*) >= 2
    `, [startDate, endDate, shiftName, ...scopeParams]);

    // 3. Existing approval records
    const { rows: approvals } = await pool.query(`
      SELECT oa.*, u.full_name AS approved_by_name
      FROM overtime_approvals oa
      LEFT JOIN users u ON u.id = oa.approved_by
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

      // Actual times in minutes (using local time components)
      const actualInMins  = inDt.getHours() * 60 + inDt.getMinutes();
      const actualOutMins = outDt.getHours() * 60 + outDt.getMinutes();

      // OT in IN: positive = came early (extra before shift), negative = came late
      const rawOTinIN  = shiftStartMins - actualInMins;  // +early / -late
      // Apply grace: within grace window → treat as 0
      const otInINMins = rawOTinIN > 0
        ? rawOTinIN                                          // early arrival
        : (Math.abs(rawOTinIN) > graceSt ? rawOTinIN : 0);  // late beyond grace

      // OT in OUT: positive = stayed late, negative = left early
      const rawOTinOUT  = actualOutMins - shiftEndMins;  // +late / -early
      const otInOUTMins = rawOTinOUT > 0
        ? rawOTinOUT                                           // late departure
        : (Math.abs(rawOTinOUT) > graceEd ? rawOTinOUT : 0); // early beyond grace

      // Net calculated OT
      const netOTMins = otInINMins + otInOUTMins;
      if (netOTMins <= 0 && rawOTinOUT <= 0) continue; // nothing to show

      const key  = `${r.employee_id}-${ds}`;
      const appr = approvalMap.get(key);

      // Manager-approved OT (from DB, editable) or default to calculated
      const approvedOTMins = appr?.ot_minutes ?? (netOTMins > 0 ? netOTMins : 0);

      // Day of week
      const dayOfWeek = DOW_SHORT[new Date(dy, mo - 1, dd).getDay()];

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
        shiftName      : r.emp_shift_name || shiftName,
        grade      : r.grade      || '—',
        gender     : r.gender     || '—',
        mode       : r.mode       || '—',
        timingType : r.timingType || '—',
        shiftStart,
        shiftEnd,
        date           : ds,
        day            : dayOfWeek,
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
        comment        : appr?.comment || '',
      };

      if (!status || status === 'all' || rec.status === status) records.push(rec);
    }

    // Sort: pending first, then by date desc
    records.sort((a, b) => {
      if (a.status === 'pending' && b.status !== 'pending') return -1;
      if (a.status !== 'pending' && b.status === 'pending') return  1;
      return b.date.localeCompare(a.date);
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

/* ── PATCH /api/overtime/:id/approve ─────────────────────────────────────────── */
router.patch('/:id/approve', async (req, res) => {
  const { approvedBy, comment, approvedOTMins } = req.body;
  try {
    const { rows } = await pool.query(`
      UPDATE overtime_approvals
         SET status='approved', approved_by=$1, approved_date=CURRENT_DATE, comment=$2,
             ot_minutes=COALESCE($3, ot_minutes)
       WHERE id=$4
       RETURNING *
    `, [approvedBy || null, comment || '', approvedOTMins ?? null, req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'OT record not found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── PATCH /api/overtime/:id/reject ──────────────────────────────────────────── */
router.patch('/:id/reject', async (req, res) => {
  const { approvedBy, comment } = req.body;
  try {
    const { rows } = await pool.query(`
      UPDATE overtime_approvals
         SET status='rejected', approved_by=$1, approved_date=CURRENT_DATE, comment=$2
       WHERE id=$3
       RETURNING *
    `, [approvedBy || null, comment || '', req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'OT record not found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── POST /api/overtime/approve-inline — approve/reject by empId+date (no DB id yet) ─ */
router.post('/approve-inline', async (req, res) => {
  const { employeeId, date, otMinutes, action, approvedBy, comment } = req.body;
  if (!employeeId || !date || !action) return res.status(400).json({ error: 'employeeId, date, action required' });

  const status = action === 'approve' ? 'approved' : 'rejected';
  try {
    const { rows } = await pool.query(`
      INSERT INTO overtime_approvals (employee_id, date, ot_minutes, status, approved_by, approved_date, comment)
      VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, $6)
      ON CONFLICT (employee_id, date) DO UPDATE
        SET ot_minutes=$3, status=$4, approved_by=$5, approved_date=CURRENT_DATE, comment=$6
      RETURNING *
    `, [employeeId, date, otMinutes || 0, status, approvedBy || null, comment || '']);
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── POST /api/overtime/bulk-approve ─────────────────────────────────────────── */
router.post('/bulk-approve', async (req, res) => {
  const { records, action, approvedBy, comment } = req.body; // records: [{employeeId, date, otMinutes}]
  if (!records?.length) return res.status(400).json({ error: 'No records provided' });

  const status = action === 'approve' ? 'approved' : 'rejected';
  try {
    let count = 0;
    for (const r of records) {
      await pool.query(`
        INSERT INTO overtime_approvals (employee_id, date, ot_minutes, status, approved_by, approved_date, comment)
        VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, $6)
        ON CONFLICT (employee_id, date) DO UPDATE
          SET ot_minutes=$3, status=$4, approved_by=$5, approved_date=CURRENT_DATE, comment=$6
      `, [r.employeeId, r.date, r.otMinutes || 0, status, approvedBy || null, comment || '']);
      count++;
    }
    res.json({ success: true, count });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── DELETE /api/overtime/:id — reset approval (back to pending) ─────────────── */
router.delete('/:id', async (req, res) => {
  try {
    await pool.query(`UPDATE overtime_approvals SET status='pending', approved_by=NULL, approved_date=NULL, comment='' WHERE id=$1`, [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
