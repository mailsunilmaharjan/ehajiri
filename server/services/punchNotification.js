/**
 * Builds a notification payload for a single attendance punch.
 * Calculates late-in / early-in compared to the employee's shift.
 */
import pool from '../db.js';
import { logError } from '../utils/logError.js';

const pad2 = n => String(Math.round(n)).padStart(2, '0');
const minsToHHMM = m => `${pad2(Math.floor(Math.abs(m) / 60))}:${pad2(Math.abs(m) % 60)}`;

export async function buildPunchNotification(employeeId, checkTime) {
  try {
    const empRes = await pool.query(`
      SELECT u.id, u.full_name, u.position, u.branch,
             COALESCE(NULLIF(TRIM(COALESCE(p.short_name,'')), ''),  LEFT(u.position,6)) AS post_short,
             COALESCE(NULLIF(TRIM(COALESCE(br.short_name,'')), ''), LEFT(u.branch,5))   AS branch_short,
             COALESCE(s.start_time, ds.start_time)           AS shift_start,
             COALESCE(s.grace_period_start, ds.grace_period_start, 0) AS grace_st
      FROM   users u
      CROSS  JOIN LATERAL (SELECT * FROM shifts WHERE make_default=TRUE LIMIT 1) ds
      LEFT JOIN shifts       s  ON s.code = u.shift
      LEFT JOIN posts        p  ON LOWER(TRIM(p.name))  = LOWER(TRIM(u.position))
      LEFT JOIN branches     br ON LOWER(TRIM(br.name)) = LOWER(TRIM(u.branch))
      WHERE  u.id = $1
    `, [employeeId]);

    if (!empRes.rows.length) return null;
    const emp = empRes.rows[0];

    const punchDt    = new Date(checkTime);
    const punchDate  = `${punchDt.getFullYear()}-${pad2(punchDt.getMonth()+1)}-${pad2(punchDt.getDate())}`;
    const timeIn     = `${pad2(punchDt.getHours())}:${pad2(punchDt.getMinutes())}`;

    // Compare with shift start
    const shiftStart = emp.shift_start?.toString().substring(0, 5) || '10:00';
    const [sh, sm]   = shiftStart.split(':').map(Number);
    const [py, pm, pd] = punchDate.split('-').map(Number);
    const sDt        = new Date(py, pm - 1, pd, sh, sm);
    const diffMins   = Math.round((punchDt - sDt) / 60000);
    const grace      = emp.grace_st || 0;

    let remarks = null;
    if (diffMins > grace) {
      remarks = `Late In by ${minsToHHMM(diffMins - grace)}`;
    } else if (diffMins < 0) {
      remarks = `Early In ${minsToHHMM(-diffMins)}`;
    }

    return {
      type        : 'attendance',
      employeeId  : emp.id,
      staffName   : emp.full_name,
      postShort   : emp.post_short   || emp.position || '',
      branchShort : emp.branch_short || emp.branch   || '',
      timeIn,
      remarks,
      ts          : new Date().toISOString(),
    };
  } catch (e) {
    logError('[punchNotification]', e);
    return null;
  }
}

/* ── Phone push for the live attendance popup ─────────────────────────────────────────────────
   The website popup (Settings → Live Attendance Notifications) only reaches pages that are open.
   When that setting is ON for the company, also send a push so it arrives with the app closed:
     · the staff member gets a confirmation for their first punch of the day;
     · admins and the staff member's branch manager / department head (and area managers / incharges
       covering them) get one when the arrival is LATE — the same people who see the popup.
   Only the first punch of the shift-day, so double presses and out-punches never spam anyone.
   A user can mute these in the app (push_devices.punch_alerts). Best effort: never throws. */
import { pushLater } from './pushService.js';

export async function pushPunchAlert(n, checkTime) {
  try {
    if (!n || !n.employeeId) return;
    // A device that was offline uploads its backlog in bulk — only a punch from the last 30 minutes is an alert.
    const ageMs = Date.now() - new Date(checkTime).getTime();
    if (!Number.isFinite(ageMs) || ageMs > 30 * 60000 || ageMs < -5 * 60000) return;
    const { rows: [st] } = await pool.query(`SELECT value FROM app_settings WHERE key='main'`);
    const v = st?.value && typeof st.value === 'string' ? JSON.parse(st.value) : st?.value;
    if (v?.liveAttendanceNotifications !== true) return;

    const { rows: [c] } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM zkteco_attendance_logs WHERE employee_id=$1 AND check_time::date = ($2::timestamptz)::date`,
      [n.employeeId, checkTime]);
    if (c.n > 1) return;                                       // not the first punch of the day

    const { rows: [emp] } = await pool.query(`SELECT branch, department FROM users WHERE id=$1`, [n.employeeId]);
    const data = { path: '/m/home', type: 'punch' };
    const note = n.remarks ? ` — ${n.remarks}` : '';
    pushLater([n.employeeId], { title: 'Attendance recorded', body: `In at ${n.timeIn}${note}`, data }, { topic: 'punch' });

    if (String(n.remarks || '').startsWith('Late')) {
      const { rows } = await pool.query(`
        SELECT id FROM users u
        WHERE u.active = TRUE AND u.id <> $1 AND (
          u.role IN ('admin','superAdmin')
          OR (u.role = 'branchManager' AND TRIM(COALESCE(u.branch,'')) <> '' AND LOWER(TRIM(u.branch)) = LOWER(TRIM($2)))
          OR (u.role = 'departmentHead' AND LOWER(TRIM(u.department)) = LOWER(TRIM($3))
              AND (TRIM(COALESCE(u.branch,'')) = '' OR LOWER(TRIM(u.branch)) = LOWER(TRIM($2))))
          OR (u.role = 'branchAreaManager' AND u.id IN (
                SELECT mbc.user_id FROM manager_branch_coverage mbc JOIN branches b ON b.id = mbc.branch_id
                WHERE LOWER(TRIM(b.name)) = LOWER(TRIM($2))))
          OR (u.role = 'departmentIncharge' AND u.id IN (
                SELECT mdc.user_id FROM manager_department_coverage mdc
                JOIN departments d ON d.id = mdc.department_id LEFT JOIN branches b ON b.id = mdc.branch_id
                WHERE LOWER(TRIM(d.name)) = LOWER(TRIM($3))
                  AND (mdc.branch_id IS NULL OR LOWER(TRIM(b.name)) = LOWER(TRIM($2)))))
        )`, [n.employeeId, emp?.branch || '', emp?.department || '']);
      if (rows.length) {
        pushLater(rows.map(r => r.id), {
          title: 'Late arrival',
          body: `${n.staffName}${n.postShort ? ' (' + n.postShort + ')' : ''} — ${n.remarks}, in at ${n.timeIn}`,
          data,
        }, { topic: 'punch' });
      }
    }
  } catch (e) { logError('[pushPunchAlert]', e); }
}
