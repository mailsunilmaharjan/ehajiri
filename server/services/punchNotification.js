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
