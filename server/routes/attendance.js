﻿/**
 * Attendance Routes
 * GET /api/attendance/daily?date=YYYY-MM-DD
 * Returns all active staff with their attendance data for the given date.
 */
import express from 'express';
import pool    from '../db.js';
import { registerClient, broadcastNotification } from '../services/liveNotifications.js';
import { buildPunchNotification }                from '../services/punchNotification.js';
import { logError } from '../utils/logError.js';

const router = express.Router();

// â”€â”€ helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const pad2 = (n) => String(Math.round(n)).padStart(2, '0');
const minsToHHMM = (mins) => `${pad2(Math.floor(mins / 60))}:${pad2(mins % 60)}`;

// Nepal is UTC+5:45 — shift times stored as Nepal local, punches stored as UTC.
// This converts a Nepal-local HH:MM on a given date to the equivalent UTC Date object.
const NEPAL_MS = (5 * 60 + 45) * 60000; // 345 min in ms
const shiftToUTC = (y, m, d, h, min) => new Date(Date.UTC(y, m - 1, d, h, min) - NEPAL_MS);

/**
 * Returns a Map of "employeeId-YYYY-MM-DD" â†’ approvedOTMinutes for all APPROVED
 * OT records in range.  The manager-set ot_minutes value is the authoritative OT.
 */
const loadApprovedOTMap = async (startDate, endDate) => {
  try {
    const { rows } = await pool.query(
      `SELECT employee_id, date::text AS dt, ot_minutes
       FROM overtime_approvals
       WHERE status = 'approved' AND date BETWEEN $1 AND $2`,
      [startDate, endDate]
    );
    const m = new Map();
    rows.forEach(r => m.set(`${r.employee_id}-${r.dt}`, r.ot_minutes || 0));
    return m;
  } catch {
    return new Map(); // table may not exist yet — fail safe â†’ no OT shown
  }
};
// Convenience wrapper — returns Set of approved keys (for legacy checks)
const loadApprovedOTSet = async (startDate, endDate) => {
  const m = await loadApprovedOTMap(startDate, endDate);
  return new Set(m.keys());
};

/**
 * Safe date-string conversion.
 * pg returns DATE columns as strings "YYYY-MM-DD" (not Date objects),
 * while TIMESTAMP columns come back as Date objects.
 * This handles both so callers don't crash on .toISOString().
 */
const toDateStr = (val) => {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString().split('T')[0];
  return String(val).split('T')[0];   // already "YYYY-MM-DD" from pg DATE type
};

/**
 * Generate a short abbreviation for a name when no short_name is stored.
 * Multi-word: initials  â†’  "General Manager" â†’ "GM", "Branch Head" â†’ "BH"
 * Single word: first 5  â†’  "Administration" â†’ "Admin"
 */
const abbrev = (name) => {
  if (!name) return null;
  const words = name.trim().split(/\s+/);
  if (words.length > 1) return words.map(w => w[0].toUpperCase()).join('');
  return name.slice(0, 5).toUpperCase();  // single word â†’ e.g. "pokhara" â†’ "POKHA"
};

// Load public holidays once per request from app_settings main blob
const loadPublicHolidays = async () => {
  try {
    const { rows } = await pool.query("SELECT value FROM app_settings WHERE key='main'");
    return rows[0]?.value?.publicHolidays || [];
  } catch { return []; }
};

// Returns holiday name if dateStr falls within any configured public holiday, else null
const makeHolidayChecker = (holidays) => (dateStr) => {
  const h = holidays.find(ph => ph.startDate && ph.endDate && dateStr >= ph.startDate && dateStr <= ph.endDate);
  return h?.name || null;
};

// â”€â”€ Load all duty roster entries overlapping a date range â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Returns map: empId â†’ [ { dateFrom, dateTo, offDays, shiftName, shiftStart, shiftEnd, graceSt, graceEd, workHours } ]
const loadRosterMap = async (startDate, endDate) => {
  try {
    const { rows } = await pool.query(`
      SELECT dr.employee_id,
             dr.date_from::text  AS date_from,
             dr.date_to::text    AS date_to,
             dr.off_days,
             s.name              AS shift_name,
             s.start_time        AS shift_start,
             s.end_time          AS shift_end,
             s.grace_period_start AS grace_st,
             s.grace_period_end   AS grace_ed,
             s.work_hours
      FROM   duty_roster dr
      LEFT   JOIN shifts s ON s.id = dr.shift_id
      WHERE  (dr.date_from <= $2 AND dr.date_to >= $1)
          OR dr.id IN (
               SELECT DISTINCT ON (employee_id) id
               FROM   duty_roster
               WHERE  date_to < $1
               ORDER  BY employee_id, date_to DESC, created_at DESC
             )
      ORDER  BY dr.employee_id, dr.date_to DESC
    `, [startDate, endDate]);
    const map = {};
    for (const r of rows) {
      if (!map[r.employee_id]) map[r.employee_id] = [];
      map[r.employee_id].push({
        dateFrom:   String(r.date_from).split('T')[0],
        dateTo:     String(r.date_to).split('T')[0],
        offDays:    Array.isArray(r.off_days) ? r.off_days : [],
        shiftName:  r.shift_name  || null,
        shiftStart: r.shift_start?.toString().substring(0, 5) || null,
        shiftEnd:   r.shift_end?.toString().substring(0, 5)   || null,
        graceSt:    r.grace_st  ?? 0,
        graceEd:    r.grace_ed  ?? 0,
        workHours:  r.work_hours || 8,
      });
    }
    return map;
  } catch { return {}; }
};

// Returns the first roster entry active for empId on dateStr, or null
const getEffectiveRoster = (rosterMap, empId, dateStr) => {
  const entries = rosterMap[empId] || [];
  return entries.find(e => e.dateFrom <= dateStr && e.dateTo >= dateStr) ||
         entries.filter(e => e.dateTo < dateStr).sort((a, b) => b.dateTo.localeCompare(a.dateTo))[0] ||
         null;
};

// â”€â”€ GET /daily â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/daily', async (req, res) => {
  const date = (req.query.date || new Date().toISOString().split('T')[0]).trim();

  try {
    // â”€â”€ 1. Effective weekends + public holidays for the date â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const [wkRes, publicHolidays] = await Promise.all([
      pool.query(`SELECT weekends FROM weekend_history WHERE effective_date <= $1 ORDER BY effective_date DESC LIMIT 1`, [date]),
      loadPublicHolidays(),
    ]);
    const weekends    = wkRes.rows[0]?.weekends || ['Sat'];
    const getHoliday  = makeHolidayChecker(publicHolidays);

    const DOW_KEYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    // Use local interpretation of the date to avoid UTC-shift problems
    const [Y, M, D]  = date.split('-').map(Number);
    const datObj     = new Date(Y, M - 1, D);
    const dayKey     = DOW_KEYS[datObj.getDay()];
    const isWeekend  = weekends.includes(dayKey);
    const holidayName = getHoliday(date);  // null when not a PH

    // â”€â”€ 2. Main query: staff + shifts + logs + leaves + visits â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const { rows } = await pool.query(`
      WITH
      /* first / last punch per employee on this date — ZKTeco + manual */
      punches AS (
        SELECT employee_id,
               MIN(time_in)     AS time_in,
               MAX(time_out)    AS time_out,
               SUM(cnt)::int    AS punch_count
        FROM (
          SELECT employee_id,
                 MIN(check_time) AS time_in,
                 MAX(check_time) AS time_out,
                 COUNT(*)        AS cnt
          FROM   zkteco_attendance_logs
          WHERE  check_time::date = $1::date AND employee_id IS NOT NULL
          GROUP  BY employee_id
          UNION ALL
          SELECT employee_id,
                 (date + check_in)::timestamp::timestamptz  AS time_in,
                 CASE WHEN check_out IS NOT NULL
                      THEN (date + check_out)::timestamp::timestamptz
                      ELSE NULL END                         AS time_out,
                 CASE WHEN check_out IS NOT NULL THEN 2 ELSE 1 END AS cnt
          FROM   attendance_manual_postings
          WHERE  date = $1::date AND check_in IS NOT NULL
        ) src
        GROUP BY employee_id
      ),
      /* default shift fallback */
      def_shift AS (
        SELECT * FROM shifts WHERE make_default = TRUE LIMIT 1
      )
      SELECT
        u.id,
        u.full_name,
        u.position,
        u.department,
        u.branch,
        u.device_id,
        u.shift             AS shift_code,
        u.mode,
        u.grade,

        /* shift fields — roster shift > employee shift > default */
        COALESCE(rs.name,               s.name,               ds.name)               AS shift_name,
        COALESCE(rs.start_time,         s.start_time,         ds.start_time)         AS shift_start,
        COALESCE(rs.end_time,           s.end_time,           ds.end_time)           AS shift_end,
        COALESCE(rs.grace_period_start, s.grace_period_start, ds.grace_period_start, 0) AS grace_start,
        COALESCE(rs.grace_period_end,   s.grace_period_end,   ds.grace_period_end,   0) AS grace_end,
        COALESCE(rs.work_hours,         s.work_hours,         ds.work_hours,         8) AS work_hours,
        dr.off_days AS roster_off_days,

        /* post short name — fallback to first 5 chars of name */
        COALESCE(NULLIF(TRIM(p.short_name),''), LEFT(p.name,5))  AS post_short,
        p.name        AS post_full,

        /* dept short name — fallback to first 5 chars of name */
        COALESCE(NULLIF(TRIM(d.short_name),''), LEFT(d.name,5))  AS dept_short,
        d.name        AS dept_full,

        /* branch short name */
        COALESCE(NULLIF(TRIM(br.short_name),''), LEFT(br.name,4)) AS branch_short,
        br.name       AS branch_name,

        /* attendance */
        al.time_in,
        al.time_out,
        al.punch_count,

        /* leave (approved, covers this date) */
        l.id          AS leave_id,
        l.leave_type_code,
        lt.name       AS leave_type_name,
        l.reason      AS leave_reason,
        l.comment     AS leave_comment,
        l_appr.full_name  AS leave_appr_name,
        l_reco.full_name  AS leave_reco_name,

        /* office visit (approved, covers this date) */
        ov.id         AS visit_id,
        ov.purpose    AS visit_purpose,
        ov.location   AS visit_location,
        ov_appr.full_name AS visit_appr_name,
        ov_reco.full_name AS visit_reco_name

      FROM   users u
      CROSS  JOIN LATERAL (SELECT * FROM def_shift) ds
      LEFT   JOIN shifts      s   ON s.code  = u.shift
      /* duty roster: entry covering this date, or most recent past entry as fallback */
      LEFT   JOIN LATERAL (
        SELECT sub.off_days, sub.shift_id
        FROM (
          (SELECT dr2.off_days, dr2.shift_id, 1 AS prio
           FROM   duty_roster dr2
           WHERE  dr2.employee_id = u.id
             AND  $1::date BETWEEN dr2.date_from AND dr2.date_to
           ORDER  BY dr2.created_at DESC LIMIT 1)
          UNION ALL
          (SELECT dr2.off_days, dr2.shift_id, 2 AS prio
           FROM   duty_roster dr2
           WHERE  dr2.employee_id = u.id
             AND  dr2.date_to < $1::date
           ORDER  BY dr2.date_to DESC, dr2.created_at DESC LIMIT 1)
        ) sub ORDER BY sub.prio LIMIT 1
      ) dr ON TRUE
      LEFT   JOIN shifts      rs  ON rs.id = dr.shift_id
      LEFT   JOIN posts       p   ON p.name  = u.position
      LEFT   JOIN departments d   ON d.name  = u.department
      LEFT   JOIN branches    br  ON br.name = u.branch
      LEFT   JOIN punches     al  ON al.employee_id = u.id
      LEFT   JOIN leaves      l   ON l.employee_id = u.id
                                 AND l.status = 'approved'
                                 AND $1::date BETWEEN l.from_date AND l.to_date
      LEFT   JOIN leave_types lt  ON lt.code  = l.leave_type_code
      LEFT   JOIN users       l_appr ON l_appr.id = l.approved_by
      LEFT   JOIN users       l_reco ON l_reco.id = l.recommended_by
      LEFT   JOIN office_visits ov ON ov.employee_id = u.id
                                  AND ov.status = 'approved'
                                  AND $1::date BETWEEN ov.from_date AND ov.to_date
      LEFT   JOIN users       ov_appr ON ov_appr.id = ov.approved_by
      LEFT   JOIN users       ov_reco ON ov_reco.id = ov.recommended_by
      WHERE  u.active = TRUE AND (u.is_system IS NOT TRUE AND u.role NOT IN ('superAdmin'))
      ORDER  BY u.ranking_order ASC NULLS LAST, u.full_name ASC
    `, [date]);

    // â”€â”€ 3. Load attendance remarks for this date (graceful if table not yet migrated) â”€â”€
    const remarksMap = {};
    try {
      const remarksRes = await pool.query(
        `SELECT employee_id, reason FROM attendance_remarks WHERE date = $1`, [date]
      );
      remarksRes.rows.forEach(r => { remarksMap[r.employee_id] = r.reason; });
    } catch (_) { /* table not yet created — skip */ }
    // Merge manual entry remarks (with Recom. by / App. by names)
    try {
      const manualRemarkRes = await pool.query(
        `SELECT mp.employee_id, mp.remark,
                ru.full_name AS reco_name,
                au.full_name AS appr_name
         FROM   attendance_manual_postings mp
         LEFT   JOIN users ru ON ru.id = mp.recommended_by
         LEFT   JOIN users au ON au.id = mp.approved_by
         WHERE  mp.date = $1
           AND  (mp.recommended_by IS NOT NULL OR mp.approved_by IS NOT NULL
                 OR (mp.remark IS NOT NULL AND mp.remark != ''))`, [date]
      );
      manualRemarkRes.rows.forEach(r => {
        const meta = [];
        if (r.reco_name) meta.push(`Recom. by ${r.reco_name}`);
        if (r.appr_name) meta.push(`App. by ${r.appr_name}`);
        const parts = [];
        if (meta.length) parts.push(meta.join(', '));
        if (r.remark?.trim()) parts.push(r.remark.trim());
        if (!parts.length) return;
        const manualStr = parts.join(' | ');
        remarksMap[r.employee_id] = remarksMap[r.employee_id]
          ? `${remarksMap[r.employee_id]} | ${manualStr}`
          : manualStr;
      });
    } catch (_) {}

    // â”€â”€ 4. Compute derived fields (Late In, Early Out, OT, Status) per row â”€â”€
    const computed = rows.map(r => {
      const {
        time_in, time_out, shift_start, shift_end,
        grace_start, grace_end, work_hours,
        leave_id, leave_type_name, visit_id, visit_purpose, visit_location,
        leave_appr_name, leave_reco_name, leave_reason, leave_comment,
        visit_appr_name, visit_reco_name,
        roster_off_days,
      } = r;

      // Per-employee weekend: roster off_days override system weekends for this date
      const empOffDays   = (roster_off_days && roster_off_days.length > 0) ? roster_off_days : weekends;
      const isEmpWeekend = empOffDays.includes(dayKey);

      // â”€â”€ Attendance time calculation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      let totalHrs = null, lateIn = null, earlyOut = null, ot = null;
      // Only use time_out when there are at least 2 punches (first punch â‰  last punch)
      const hasCheckOut = r.punch_count >= 2;

      if (time_in && shift_start && shift_end) {
        const inDt  = new Date(time_in);
        const outDt = (time_out && hasCheckOut) ? new Date(time_out) : null;

        // Build shift start/end as Nepal-local times expressed as UTC timestamps
        const [sH, sM] = shift_start.toString().split(':').map(Number);
        const [eH, eM] = shift_end.toString().split(':').map(Number);
        const sDt = shiftToUTC(Y, M, D, sH, sM);
        const eDt = shiftToUTC(Y, M, D, eH, eM);
        // Handle overnight shift
        if (eDt <= sDt) eDt.setUTCDate(eDt.getUTCDate() + 1);

        // Total hours — only when real check-out exists
        if (outDt) {
          const totalMins = Math.round((outDt - inDt) / 60000);
          if (totalMins > 0) totalHrs = minsToHHMM(totalMins);
        }

        // IN Status: Early In / On Time / Late By
        const rawInDiff  = Math.round((inDt - sDt) / 60000);
        const graceIn    = grace_start || 0;
        if (rawInDiff < 0) {
          lateIn = `Early In ${minsToHHMM(Math.abs(rawInDiff))}`;
        } else if (rawInDiff <= graceIn) {
          lateIn = `On Time`;
        } else {
          lateIn = `Late By ${minsToHHMM(rawInDiff - graceIn)}`;
        }

        if (outDt) {
          // OUT Status: Early Out / On Time / Late Out
          const rawOutDiff = Math.round((outDt - eDt) / 60000);
          const graceOut   = grace_end || 0;
          if (rawOutDiff < 0) {
            const earlyNet = Math.abs(rawOutDiff) - graceOut;
            if (earlyNet > 0) earlyOut = `Early Out ${minsToHHMM(earlyNet)}`;
            else earlyOut = `On Time`;
          } else if (rawOutDiff > 0) {
            earlyOut = `Late Out ${minsToHHMM(rawOutDiff)}`;
            ot = minsToHHMM(rawOutDiff);
          } else {
            earlyOut = `On Time`;
          }
        }
      }

      // â”€â”€ Status â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      let status = 'Absent';
      if (leave_id)            status = leave_type_name || 'Leave';
      else if (isEmpWeekend)   status = 'Weekend';
      else if (time_in)        status = 'Present';
      else if (holidayName)    status = 'Public Holiday';

      // â”€â”€ Remarks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const parts = [];
      if (leave_id) {
        const lMeta = [];
        if (leave_reco_name) lMeta.push(`Recom. by ${leave_reco_name}`);
        if (leave_appr_name) lMeta.push(`App. by ${leave_appr_name}`);
        if (lMeta.length) parts.push(lMeta.join(', '));
        if (leave_reason)   parts.push(leave_reason);
        if (leave_comment)  parts.push(leave_comment);
      }
      if (visit_id) {
        const vMeta = [];
        if (visit_reco_name) vMeta.push(`Recom. by ${visit_reco_name}`);
        if (visit_appr_name) vMeta.push(`App. by ${visit_appr_name}`);
        if (vMeta.length)    parts.push(vMeta.join(', '));
        if (visit_purpose)   parts.push(`Office Visit: ${visit_purpose}`);
        if (visit_location)  parts.push(visit_location);
      }
      // Show just the holiday name in remarks (no "Holiday:" prefix)
      if (holidayName) parts.push(holidayName);
      if (remarksMap[r.id]) parts.push(remarksMap[r.id]);
      const remarks = parts.join(' | ');

      return {
        id                  : r.id,
        fullName            : r.full_name,
        postShort           : r.post_short  || abbrev(r.position)     || '—',
        postFull            : r.post_full   || r.position             || '',
        deptShort           : r.dept_short  || abbrev(r.department)   || '—',
        deptFull            : r.dept_full   || r.department           || '',
        branchShort         : r.branch_short || abbrev(r.branch_name || r.branch) || '—',
        branchName          : r.branch_name || r.branch || '—',
        shiftCode           : r.shift_code  || null,
        shiftName           : r.shift_name  || '—',
        shiftStart          : r.shift_start || null,
        shiftEnd            : r.shift_end   || null,
        mode                : r.mode        || null,
        grade               : r.grade       || null,
        punchCount          : r.punch_count || 0,
        timeIn              : time_in  ? new Date(time_in).toISOString()  : null,
        timeOut             : (time_out && hasCheckOut) ? new Date(time_out).toISOString() : null,
        totalHrs,
        lateIn,
        earlyOut,
        ot,
        status,
        remarks,
        // raw flags for filtering
        hasLeave            : !!leave_id,
        leaveTypeName       : leave_type_name || null,
        hasVisit            : !!visit_id,
        isPublicHoliday     : !!holidayName,
        holidayName         : holidayName || null,
      };
    });

    res.json({ date, dayKey, isWeekend, weekends, rows: computed });
  } catch (err) {
    logError('[Attendance/daily]', err);
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€ GET /staff-ledger — individual staff attendance ledger â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/staff-ledger', async (req, res) => {
  const employeeId = parseInt(req.query.employeeId);

  // Accept EITHER explicit startDate/endDate (preferred — exact BS month boundaries)
  // OR legacy year/month/half approach
  let startDate = req.query.startDate;
  let endDate   = req.query.endDate;

  if (!startDate || !endDate) {
    const year  = parseInt(req.query.year)  || new Date().getFullYear();
    const month = parseInt(req.query.month) || (new Date().getMonth()+1);
    const half  = parseInt(req.query.half)  || 1;
    const pad  = (n) => String(n).padStart(2,'0');
    const startDay = half===1 ? 1 : 16;
    const lastDay  = new Date(year, month, 0).getDate();
    const endDay   = half===1 ? 15 : lastDay;
    startDate = `${year}-${pad(month)}-${pad(startDay)}`;
    endDate   = `${year}-${pad(month)}-${pad(endDay)}`;
  }
  const pad2        = (n) => String(Math.round(n)).padStart(2,'0');
  const minsToHHMM  = (m) => `${pad2(Math.floor(m/60))}:${pad2(m%60)}`;

  try {
    // â”€â”€ Employee info â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const empQ = employeeId
      ? `SELECT u.*,
               p.short_name AS post_short,
               d.short_name AS dept_short,
               br.short_name AS branch_short,
               br.name AS branch_name_full,
               s.name AS shift_name, s.start_time AS shift_start,
               s.end_time AS shift_end, s.grace_period_start AS grace_st,
               s.grace_period_end AS grace_ed
         FROM  users u
         LEFT  JOIN posts       p  ON p.name=u.position
         LEFT  JOIN departments d  ON d.name=u.department
         LEFT  JOIN branches    br ON br.name=u.branch
         LEFT  JOIN shifts      s  ON s.code=u.shift
         WHERE u.id=$1`
      : `SELECT u.*, s.name AS shift_name, s.start_time AS shift_start,
               s.end_time AS shift_end, s.grace_period_start AS grace_st,
               s.grace_period_end AS grace_ed
         FROM  users u
         LEFT  JOIN shifts s ON s.code=u.shift
         WHERE u.active=TRUE AND (u.is_system IS NOT TRUE AND u.role NOT IN ('superAdmin')) ORDER BY u.ranking_order ASC NULLS LAST,u.full_name ASC`;

    const empRes = await pool.query(empQ, employeeId ? [employeeId] : []);
    if (!empRes.rows.length) return res.json({ employee:null, days:[], summary:{} });
    const emp = empRes.rows[0];

    // â”€â”€ Weekends + public holidays â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const [wkRes, publicHolidays] = await Promise.all([
      pool.query(`SELECT weekends FROM weekend_history WHERE effective_date<=$1 ORDER BY effective_date DESC LIMIT 1`, [endDate]),
      loadPublicHolidays(),
    ]);
    const weekends   = wkRes.rows[0]?.weekends || ['Sat'];
    const getHoliday = makeHolidayChecker(publicHolidays);
    const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const DOW_FULL = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

    // â”€â”€ Default shift fallback â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const defShiftRes = await pool.query(`SELECT * FROM shifts WHERE make_default=TRUE LIMIT 1`);
    const defShift = defShiftRes.rows[0];
    const shiftStart = (emp.shift_start||defShift?.start_time)?.toString().substring(0,5)||'10:00';
    const shiftEnd   = (emp.shift_end  ||defShift?.end_time  )?.toString().substring(0,5)||'17:00';
    const graceSt    = emp.grace_st  || defShift?.grace_period_start || 0;
    const graceEd    = emp.grace_ed  || defShift?.grace_period_end   || 0;
    const shiftName  = emp.shift_name || defShift?.name || '—';

    // â”€â”€ Duty roster entries for this employee in the period â”€â”€â”€â”€â”€â”€â”€
    const rosterRes = await pool.query(`
      SELECT dr.date_from::text AS date_from, dr.date_to::text AS date_to, dr.off_days,
             s.name AS shift_name, s.start_time AS shift_start, s.end_time AS shift_end,
             s.grace_period_start AS grace_st, s.grace_period_end AS grace_ed
      FROM   duty_roster dr
      LEFT   JOIN shifts s ON s.id = dr.shift_id
      WHERE  dr.employee_id = $1
        AND  ((dr.date_from <= $2 AND dr.date_to >= $3)
           OR dr.id = (SELECT id FROM duty_roster WHERE employee_id=$1 AND date_to < $3
                       ORDER BY date_to DESC, created_at DESC LIMIT 1))
      ORDER  BY dr.date_to DESC
    `, [emp.id, endDate, startDate]);
    const rosterEntries = rosterRes.rows.map(r => ({
      dateFrom:   String(r.date_from).split('T')[0],
      dateTo:     String(r.date_to).split('T')[0],
      offDays:    Array.isArray(r.off_days) ? r.off_days : [],
      shiftName:  r.shift_name || null,
      shiftStart: r.shift_start?.toString().substring(0, 5) || null,
      shiftEnd:   r.shift_end?.toString().substring(0, 5)   || null,
      graceSt:    r.grace_st ?? 0,
      graceEd:    r.grace_ed ?? 0,
    }));
    const getEmpRoster = (ds) =>
      rosterEntries.find(e => e.dateFrom <= ds && e.dateTo >= ds) ||
      rosterEntries.filter(e => e.dateTo < ds).sort((a, b) => b.dateTo.localeCompare(a.dateTo))[0] ||
      null;

    // â”€â”€ Attendance logs for the period â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const logsRes = await pool.query(`
      SELECT day,
             MIN(time_in)  AS time_in,
             MAX(time_out) AS time_out,
             SUM(cnt)::int AS punches
      FROM (
        SELECT check_time::date AS day,
               MIN(check_time)  AS time_in,
               MAX(check_time)  AS time_out,
               COUNT(*)::int    AS cnt
        FROM   zkteco_attendance_logs
        WHERE  employee_id=$1 AND check_time::date BETWEEN $2 AND $3
        GROUP  BY check_time::date
        UNION ALL
        SELECT date AS day,
               (date + check_in)::timestamp::timestamptz AS time_in,
               CASE WHEN check_out IS NOT NULL
                    THEN (date + check_out)::timestamp::timestamptz
                    ELSE NULL END AS time_out,
               CASE WHEN check_out IS NOT NULL THEN 2 ELSE 1 END AS cnt
        FROM   attendance_manual_postings
        WHERE  employee_id=$1 AND date BETWEEN $2 AND $3 AND check_in IS NOT NULL
      ) src
      GROUP BY day`,
      [emp.id, startDate, endDate]
    );
    const logsByDay = {};
    for (const r of logsRes.rows) {
      logsByDay[toDateStr(r.day)] = r;
    }

    // â”€â”€ Approved leaves â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const leaveRes = await pool.query(`
      SELECT l.from_date, l.to_date, lt.name AS leave_type,
             ru.full_name AS reco_name, au.full_name AS appr_name
      FROM   leaves l
      LEFT   JOIN leave_types lt ON lt.code = l.leave_type_code
      LEFT   JOIN users ru ON ru.id = l.recommended_by
      LEFT   JOIN users au ON au.id = l.approved_by
      WHERE  l.employee_id=$1 AND l.status='approved'
        AND  l.from_date<=$2 AND l.to_date>=$3`,
      [emp.id, endDate, startDate]
    );
    const leaveDates = {};
    const leaveRecoMap = {};
    for (const l of leaveRes.rows) {
      const from=new Date(l.from_date), to=new Date(l.to_date);
      for (let d=new Date(from);d<=to;d.setDate(d.getDate()+1)) {
        const ds=d.toISOString().split('T')[0];
        if (ds>=startDate&&ds<=endDate) {
          leaveDates[ds] = l.leave_type || 'Leave';
          if (l.reco_name || l.appr_name) leaveRecoMap[ds] = { recoName: l.reco_name, apprName: l.appr_name };
        }
      }
    }

    // â”€â”€ Approved office visits â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const visitRes = await pool.query(`
      SELECT ov.from_date, ov.to_date, ov.purpose, ov.location,
             ru.full_name AS reco_name, au.full_name AS appr_name
      FROM   office_visits ov
      LEFT   JOIN users ru ON ru.id = ov.recommended_by
      LEFT   JOIN users au ON au.id = ov.approved_by
      WHERE  ov.employee_id=$1 AND ov.status='approved' AND ov.from_date<=$2 AND ov.to_date>=$3`,
      [emp.id, endDate, startDate]
    );
    const visitDates = {};
    for (const v of visitRes.rows) {
      const from=new Date(v.from_date), to=new Date(v.to_date);
      for (let d=new Date(from);d<=to;d.setDate(d.getDate()+1)) {
        const ds=d.toISOString().split('T')[0];
        if (ds>=startDate&&ds<=endDate) visitDates[ds]=v;
      }
    }

    // â”€â”€ Load approved OT with stored minutes + approver name (for Remarks) â”€â”€â”€â”€â”€â”€
    const approvedOTSet = await loadApprovedOTMap(startDate, endDate); // key â†’ ot_minutes
    const approvedOTDetails = new Map(); // key â†’ { approverName, otMins }
    try {
      const { rows: otRows } = await pool.query(`
        SELECT oa.employee_id, oa.date::text AS dt, oa.ot_minutes, u.full_name AS approver_name
        FROM overtime_approvals oa
        LEFT JOIN users u ON u.id = oa.approved_by
        WHERE oa.status = 'approved' AND oa.date BETWEEN $1 AND $2
      `, [startDate, endDate]);
      otRows.forEach(r => approvedOTDetails.set(`${r.employee_id}-${r.dt}`, {
        approverName: r.approver_name || null,
        otMins: r.ot_minutes || 0,
      }));
    } catch (_) { /* overtime_approvals may not exist yet */ }

    // â”€â”€ Load attendance remarks (graceful if table not yet migrated) â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const empRemarksMap = {};
    try {
      const empRemarksRes = await pool.query(
        `SELECT date, reason FROM attendance_remarks WHERE employee_id=$1 AND date BETWEEN $2 AND $3`,
        [emp.id, startDate, endDate]
      );
      empRemarksRes.rows.forEach(r => {
        const ds = r.date instanceof Date ? r.date.toISOString().split('T')[0] : String(r.date).split('T')[0];
        empRemarksMap[ds] = r.reason;
      });
    } catch (_) { /* table not yet created — skip */ }

    // Merge manual posting remarks (with Recom. by / App. by names)
    try {
      const manualLedgerRes = await pool.query(
        `SELECT mp.date, mp.remark,
                ru.full_name AS reco_name,
                au.full_name AS appr_name
         FROM   attendance_manual_postings mp
         LEFT   JOIN users ru ON ru.id = mp.recommended_by
         LEFT   JOIN users au ON au.id = mp.approved_by
         WHERE  mp.employee_id = $1 AND mp.date BETWEEN $2 AND $3
           AND  (mp.recommended_by IS NOT NULL OR mp.approved_by IS NOT NULL
                 OR (mp.remark IS NOT NULL AND mp.remark != ''))`,
        [emp.id, startDate, endDate]
      );
      manualLedgerRes.rows.forEach(r => {
        const ds = r.date instanceof Date ? r.date.toISOString().split('T')[0] : String(r.date).split('T')[0];
        const meta = [];
        if (r.reco_name) meta.push(`Recom. by ${r.reco_name}`);
        if (r.appr_name) meta.push(`App. by ${r.appr_name}`);
        const parts = [];
        if (meta.length) parts.push(meta.join(', '));
        if (r.remark?.trim()) parts.push(r.remark.trim());
        if (!parts.length) return;
        const manualStr = parts.join(' | ');
        empRemarksMap[ds] = empRemarksMap[ds] ? `${empRemarksMap[ds]} | ${manualStr}` : manualStr;
      });
    } catch (_) {}

    // â”€â”€ Build per-day records — date-range iterator (works with any start/endDate) â”€â”€â”€
    const days = []; let totalWorkingDays=0;
    let presentCount=0,absentCount=0,leaveCount=0,lateCount=0,earlyCount=0,otMins=0,totalMins=0;

    // Iterate every calendar day in the range using Date objects
    let sn = 0;
    let cur   = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate   + 'T00:00:00');

    while (cur <= end) {
      sn++;
      const dt      = new Date(cur);
      const dateStr = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
      const dayKey  = DOW[dt.getDay()];
      const dayFull = DOW_FULL[dt.getDay()];

      // Roster override for this specific day
      const dayRoster    = getEmpRoster(dateStr);
      const effOffDays   = dayRoster?.offDays?.length > 0 ? dayRoster.offDays : weekends;
      const isWeekend    = effOffDays.includes(dayKey);
      // Effective shift times: roster > employee default > system default
      const effShiftStart = dayRoster?.shiftStart || shiftStart;
      const effShiftEnd   = dayRoster?.shiftEnd   || shiftEnd;
      const effGraceSt    = dayRoster?.graceSt    != null ? dayRoster.graceSt    : graceSt;
      const effGraceEd    = dayRoster?.graceEd    != null ? dayRoster.graceEd    : graceEd;

      if (!isWeekend) totalWorkingDays++;

      const log        = logsByDay[dateStr];
      const leave      = leaveDates[dateStr];
      const visit      = visitDates[dateStr];
      const phName     = getHoliday(dateStr);

      let status='Absent', timeIn=null, timeOut=null, lateMins=null,
          earlyMins=null, otMinDay=null, totalMinDay=null, remarks='';
      let inStatusStr=null, outStatusStr=null;

      if (isWeekend) {
        status='Weekend';
      } else if (leave) {
        status = leave; leaveCount++;
        const leaveReco = leaveRecoMap[dateStr];
        const lMeta = [];
        if (leaveReco?.recoName) lMeta.push(`Recom. by ${leaveReco.recoName}`);
        if (leaveReco?.apprName) lMeta.push(`App. by ${leaveReco.apprName}`);
        const lParts = [];
        if (lMeta.length) lParts.push(lMeta.join(', '));
        lParts.push(`Leave: ${leave}`);
        if (phName) lParts.push(phName);
        remarks = lParts.join(' | ');
      } else if (log?.time_in) {
        presentCount++;
        status='Present';
        timeIn = log.time_in;
        // Only set time_out when there are at least 2 punch records
        timeOut = (log.punches >= 2) ? (log.time_out || null) : null;

        // â”€â”€ Time calculation using Nepal-local shift times â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const [sh,sm] = effShiftStart.split(':').map(Number);
        const [eh,em] = effShiftEnd.split(':').map(Number);
        const [dy,mo,dd] = dateStr.split('-').map(Number);

        const inDt = new Date(timeIn);
        const sDt  = shiftToUTC(dy, mo, dd, sh, sm);
        const eDt  = shiftToUTC(dy, mo, dd, eh, em);
        if (eDt <= sDt) eDt.setUTCDate(eDt.getUTCDate() + 1);

        // IN Status: Early In / On Time / Late By
        const rawInDiff = Math.round((inDt - sDt) / 60000);
        if (rawInDiff < 0) {
          inStatusStr = `Early In ${minsToHHMM(Math.abs(rawInDiff))}`;
        } else if (rawInDiff <= effGraceSt) {
          inStatusStr = `On Time`;
        } else {
          lateCount++;
          lateMins = rawInDiff - effGraceSt;
          inStatusStr = `Late By ${minsToHHMM(lateMins)}`;
        }

        // OUT Status: Early Out / On Time / Late Out
        if (timeOut) {
          const outDt      = new Date(timeOut);
          const rawOutDiff = Math.round((outDt - eDt) / 60000);

          if (rawOutDiff < 0) {
            const earlyNet = Math.abs(rawOutDiff) - effGraceEd;
            if (earlyNet > 0) { earlyCount++; earlyMins = earlyNet; outStatusStr = `Early Out ${minsToHHMM(earlyNet)}`; }
            else outStatusStr = `On Time`;
          } else if (rawOutDiff === 0) {
            outStatusStr = `On Time`;
          } else {
            const otKey = `${emp.id}-${dateStr}`;
            if (approvedOTSet.has(otKey)) {
              const detail       = approvedOTDetails.get(otKey);
              const approvedMins = detail?.otMins ?? rawOutDiff;
              const otStr        = minsToHHMM(approvedMins);
              outStatusStr  = `OT ${otStr}`;
              otMinDay      = approvedMins;
              otMins       += approvedMins;
              const otRemark = detail?.approverName
                ? `OT: ${otStr} | App. by: ${detail.approverName}`
                : `OT: ${otStr}`;
              remarks = remarks ? `${remarks} | ${otRemark}` : otRemark;
            } else {
              outStatusStr = `Late Out ${minsToHHMM(rawOutDiff)}`;
            }
          }

          const worked = Math.round((outDt - inDt) / 60000);
          if (worked > 0) { totalMinDay = worked; totalMins += worked; }
        }

        // OT remark already appended above (inside the approved OT block); preserve it
        if (visit) {
          const vMeta = [];
          if (visit.reco_name) vMeta.push(`Recom. by ${visit.reco_name}`);
          if (visit.appr_name) vMeta.push(`App. by ${visit.appr_name}`);
          const vParts = [];
          if (vMeta.length) vParts.push(vMeta.join(', '));
          if (visit.purpose)  vParts.push(`Office Visit: ${visit.purpose}`);
          if (visit.location) vParts.push(visit.location);
          const visitStr = vParts.join(' | ');
          if (visitStr) remarks = remarks ? `${visitStr} | ${remarks}` : visitStr;
        }
        if (phName) remarks = remarks ? `${remarks} | ${phName}` : phName;
        if (empRemarksMap[dateStr]) remarks = remarks ? `${remarks} | ${empRemarksMap[dateStr]}` : `${empRemarksMap[dateStr]}`;
      } else if (phName) {
        status  = 'Public Holiday';
        remarks = phName;
      } else {
        absentCount++;
        if (visit) {
          status = 'Office Visit';
          const vMeta = [];
          if (visit.reco_name) vMeta.push(`Recom. by ${visit.reco_name}`);
          if (visit.appr_name) vMeta.push(`App. by ${visit.appr_name}`);
          const vParts = [];
          if (vMeta.length) vParts.push(vMeta.join(', '));
          if (visit.purpose)  vParts.push(`Office Visit: ${visit.purpose}`);
          if (visit.location) vParts.push(visit.location);
          remarks = vParts.join(' | ');
        }
      }

      days.push({
        sn, dateStr, dayKey, dayFull, isWeekend,
        shiftName       : dayRoster?.shiftName || shiftName,
        shiftStart      : effShiftStart,
        shiftEnd        : effShiftEnd,
        status, timeIn, timeOut,
        punches         : log?.punches || 0,
        lateMins, earlyMins, otMins:otMinDay, totalMins:totalMinDay,
        lateFormatted   : inStatusStr,
        earlyFormatted  : outStatusStr,
        otFormatted     : otMinDay   ? minsToHHMM(otMinDay)   : null,
        totalFormatted  : totalMinDay? minsToHHMM(totalMinDay): null,
        remarks, leave, hasVisit:!!visit, isPublicHoliday: !!phName, holidayName: phName||null,
      });

      cur.setDate(cur.getDate() + 1);  // advance to next day
    }

    const summary = {
      totalWorkingDays, presentCount, absentCount, leaveCount,
      lateCount, earlyCount, otMins, totalMins,
      attendanceRate: totalWorkingDays>0 ? Math.round((presentCount+leaveCount)/totalWorkingDays*100) : 0,
      otFormatted   : otMins>0 ? minsToHHMM(otMins) : '0:00',
    };

    res.json({
      employee: {
        id: emp.id, empCode: emp.employee_id, fullName: emp.full_name,
        position: emp.position || '—', postShort: emp.post_short || emp.position || '—',
        department: emp.department || '—', deptShort: emp.dept_short || emp.department || '—',
        branch: emp.branch || '—', branchShort: emp.branch_short || '—',
        grade: emp.grade || null, mode: emp.mode || null,
        shiftName, shiftStart, shiftEnd, joinDate: emp.join_date,
      },
      period: { startDate, endDate, totalWorkingDays },   // no year/month/half — derived from startDate
      days,
      summary,
    });
  } catch (err) {
    logError('[attendance/staff-ledger]', err);
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€ GET /half-monthly — half-month analytics with AI-style insights â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/half-monthly', async (req, res) => {
  const now  = new Date();
  const pad  = (n) => String(n).padStart(2,'0');
  const half = parseInt(req.query.half) || (now.getDate() <= 15 ? 1 : 2);

  // Accept explicit startDate/endDate (BS calendar) OR compute from year/month (AD calendar)
  let startDate = req.query.startDate;
  let endDate   = req.query.endDate;
  if (!startDate || !endDate) {
    const y = parseInt(req.query.year)  || now.getFullYear();
    const m = parseInt(req.query.month) || (now.getMonth() + 1);
    const s = half === 1 ? 1 : 16;
    const e = half === 1 ? 15 : new Date(y, m, 0).getDate();
    startDate = `${y}-${pad(m)}-${pad(s)}`;
    endDate   = `${y}-${pad(m)}-${pad(e)}`;
  }
  // Always derive year/month from startDate so they're in scope for res.json
  const year  = parseInt(startDate.split('-')[0]);
  const month = parseInt(startDate.split('-')[1]);

  try {
    // â”€â”€ Effective weekends + public holidays for the period â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const [wkRes, publicHolidays] = await Promise.all([
      pool.query(`SELECT weekends FROM weekend_history WHERE effective_date <= $1 ORDER BY effective_date DESC LIMIT 1`, [endDate]),
      loadPublicHolidays(),
    ]);
    const weekends   = wkRes.rows[0]?.weekends || ['Sat'];
    const getHoliday = makeHolidayChecker(publicHolidays);
    const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

    // â”€â”€ Build date lists by iterating startDate â†’ endDate â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const workingDays = [], weekendDates = [], holidayDates = [];
    let cur2 = new Date(startDate + 'T00:00:00');
    const end2 = new Date(endDate + 'T00:00:00');
    while (cur2 <= end2) {
      const key     = DOW[cur2.getDay()];
      const dateStr = `${cur2.getFullYear()}-${pad(cur2.getMonth()+1)}-${pad(cur2.getDate())}`;
      const isWknd  = weekends.includes(key);
      const phName  = getHoliday(dateStr);
      if (isWknd)      weekendDates.push(dateStr);
      else if (phName) holidayDates.push(dateStr);
      else             workingDays.push(dateStr);
      cur2.setDate(cur2.getDate() + 1);
    }
    const totalWorkingDays = workingDays.length;

    // â”€â”€ Default shift â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const shiftRes = await pool.query(`SELECT * FROM shifts WHERE make_default=TRUE LIMIT 1`);
    const defShift = shiftRes.rows[0];

    // â”€â”€ All active employees (with per-employee shift info) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const empRes = await pool.query(`
      SELECT u.id, u.employee_id AS "empCode", u.full_name AS "fullName",
             u.department, u.position, u.shift,
             s.start_time AS shift_start, s.end_time AS shift_end,
             s.grace_period_start AS grace_st, s.grace_period_end AS grace_ed
      FROM   users u
      LEFT   JOIN shifts s ON s.code = u.shift
      WHERE  u.active=TRUE AND (u.is_system IS NOT TRUE AND u.role NOT IN ('superAdmin'))
      ORDER  BY u.ranking_order ASC NULLS LAST, u.full_name ASC
    `);
    const employees = empRes.rows;

    // â”€â”€ Duty roster map for the period â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const rosterMapHalf = await loadRosterMap(startDate, endDate);

    // â”€â”€ Build all calendar dates in range (for per-employee iteration) â”€
    const allDatesHalf = [];
    let curAllH = new Date(startDate + 'T00:00:00');
    const endAllH = new Date(endDate + 'T00:00:00');
    while (curAllH <= endAllH) {
      const dk = DOW[curAllH.getDay()];
      const ds = `${curAllH.getFullYear()}-${pad(curAllH.getMonth()+1)}-${pad(curAllH.getDate())}`;
      allDatesHalf.push({ dateStr: ds, dayKey: dk });
      curAllH.setDate(curAllH.getDate() + 1);
    }

    // â”€â”€ Attendance logs for period â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const logsRes = await pool.query(`
      SELECT employee_id, day,
             MIN(time_in)  AS time_in,
             MAX(time_out) AS time_out,
             SUM(cnt)::int AS punches
      FROM (
        SELECT employee_id, check_time::date AS day,
               MIN(check_time) AS time_in,
               MAX(check_time) AS time_out,
               COUNT(*)::int   AS cnt
        FROM   zkteco_attendance_logs
        WHERE  check_time::date BETWEEN $1 AND $2 AND employee_id IS NOT NULL
        GROUP  BY employee_id, check_time::date
        UNION ALL
        SELECT employee_id, date AS day,
               (date + check_in)::timestamp::timestamptz AS time_in,
               CASE WHEN check_out IS NOT NULL
                    THEN (date + check_out)::timestamp::timestamptz
                    ELSE NULL END AS time_out,
               CASE WHEN check_out IS NOT NULL THEN 2 ELSE 1 END AS cnt
        FROM   attendance_manual_postings
        WHERE  date BETWEEN $1 AND $2 AND check_in IS NOT NULL
      ) src
      GROUP BY employee_id, day
    `, [startDate, endDate]);

    const logsMap = {};  // empId → { ‘YYYY-MM-DD’: { timeIn, timeOut, punches } }
    for (const r of logsRes.rows) {
      if (!logsMap[r.employee_id]) logsMap[r.employee_id] = {};
      logsMap[r.employee_id][toDateStr(r.day)] = {
        timeIn: r.time_in, timeOut: r.time_out, punches: r.punches,
      };
    }

    // â”€â”€ Leaves for period â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const leavesRes = await pool.query(`
      SELECT l.employee_id, l.from_date, l.to_date, lt.name AS leave_type
      FROM   leaves l
      LEFT   JOIN leave_types lt ON lt.code = l.leave_type_code
      WHERE  l.status='approved'
        AND  l.from_date <= $2 AND l.to_date >= $1
    `, [startDate, endDate]);

    const leaveMap = {};  // empId â†’ Set of leave dates
    for (const l of leavesRes.rows) {
      if (!leaveMap[l.employee_id]) leaveMap[l.employee_id] = [];
      const from = new Date(l.from_date);
      const to   = new Date(l.to_date);
      for (let d = new Date(from); d <= to; d.setDate(d.getDate()+1)) {
        const ds = d.toISOString().split('T')[0];
        if (ds >= startDate && ds <= endDate) leaveMap[l.employee_id].push(ds);
      }
    }

    // â”€â”€ Office visits for period â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const visitRes2 = await pool.query(`
      SELECT employee_id, from_date, to_date FROM office_visits
      WHERE  status='approved' AND from_date <= $2 AND to_date >= $1
    `, [startDate, endDate]);
    const visitMap2 = {};  // empId â†’ Set of visit dates
    for (const v of visitRes2.rows) {
      if (!visitMap2[v.employee_id]) visitMap2[v.employee_id] = new Set();
      const from = new Date(v.from_date), to = new Date(v.to_date);
      for (let d = new Date(from); d <= to; d.setDate(d.getDate()+1)) {
        const ds = d.toISOString().split('T')[0];
        if (ds >= startDate && ds <= endDate) visitMap2[v.employee_id].add(ds);
      }
    }

    // â”€â”€ Approved OT map — key â†’ manager-set ot_minutes value â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const halfApprovedOTSet = await loadApprovedOTMap(startDate, endDate);

    // â”€â”€ Per-employee analytics â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const pad2   = (n) => String(Math.round(n)).padStart(2,'0');
    const toHHMM = (mins) => `${pad2(Math.floor(Math.abs(mins)/60))}:${pad2(Math.abs(mins)%60)}`;

    const stats = employees.map(emp => {
      const empLogs  = logsMap[emp.id]   || {};
      const empLeave = new Set(leaveMap[emp.id] || []);
      const empVisit = visitMap2[emp.id] || new Set();

      // Per-employee roster entries
      const empRosterEntriesH = rosterMapHalf[emp.id] || [];
      const getEmpRosterH = (ds) =>
        empRosterEntriesH.find(e => e.dateFrom <= ds && e.dateTo >= ds) ||
        empRosterEntriesH.filter(e => e.dateTo < ds).sort((a, b) => b.dateTo.localeCompare(a.dateTo))[0] ||
        null;

      // Employee's own shift (fallback to default)
      const empShiftStartH = emp.shift_start?.toString().substring(0,5) || defShift?.start_time?.toString().substring(0,5) || '10:00';
      const empShiftEndH   = emp.shift_end?.toString().substring(0,5)   || defShift?.end_time?.toString().substring(0,5)   || '17:00';
      const empGraceStH    = emp.grace_st ?? defShift?.grace_period_start ?? 0;
      const empGraceEdH    = emp.grace_ed ?? defShift?.grace_period_end   ?? 0;

      // Compute per-employee working days (roster off days override system weekends)
      let empTotalWorkingDays = 0;
      const empWorkingDatesH = [];
      for (const { dateStr, dayKey } of allDatesHalf) {
        const roster   = getEmpRosterH(dateStr);
        const effOff   = roster?.offDays?.length > 0 ? roster.offDays : weekends;
        const isEmpWkd = effOff.includes(dayKey);
        const phName2  = getHoliday(dateStr);
        if (!isEmpWkd && !phName2) {
          empWorkingDatesH.push({ dateStr, dayKey, roster });
          empTotalWorkingDays++;
        }
      }

      let presentDays = 0, absentDays = 0, leaveDays = 0;
      let lateCount = 0, earlyCount = 0, otMinutes = 0, totalMins = 0;
      let lateMinsTotal = 0, earlyMinsTotal = 0;

      for (const { dateStr, roster } of empWorkingDatesH) {
        if (empLeave.has(dateStr)) { leaveDays++; continue; }

        const log = empLogs[dateStr];
        if (!log || !log.timeIn) { absentDays++; continue; }

        presentDays++;
        const inDt  = new Date(log.timeIn);
        const outDt = (log.timeOut && log.punches >= 2) ? new Date(log.timeOut) : null;

        // Effective shift: roster > employee > default
        const shiftStart = roster?.shiftStart || empShiftStartH;
        const shiftEnd   = roster?.shiftEnd   || empShiftEndH;
        const graceSt    = roster?.graceSt    != null ? roster.graceSt    : empGraceStH;
        const graceEd    = roster?.graceEd    != null ? roster.graceEd    : empGraceEdH;

        const [sh, sm] = shiftStart.split(':').map(Number);
        const [eh, em] = shiftEnd.split(':').map(Number);
        const [dy, mo, dd] = dateStr.split('-').map(Number);

        const sDt = shiftToUTC(dy, mo, dd, sh, sm);
        const eDt = shiftToUTC(dy, mo, dd, eh, em);
        if (eDt <= sDt) eDt.setUTCDate(eDt.getUTCDate()+1);

        const lateMins = Math.round((inDt - sDt) / 60000) - graceSt;
        if (lateMins > 0) { lateCount++; lateMinsTotal += lateMins; }

        if (outDt) {
          const earlyMins = Math.round((eDt - outDt) / 60000) - graceEd;
          if (earlyMins > 0) { earlyCount++; earlyMinsTotal += earlyMins; }

          const otMinsRaw = Math.round((outDt - eDt) / 60000);
          if (otMinsRaw > 0) {
            const approvedMins = halfApprovedOTSet.get(`${emp.id}-${dateStr}`);
            if (approvedMins !== undefined) otMinutes += approvedMins;
          }

          const worked = Math.round((outDt - inDt) / 60000);
          if (worked > 0) totalMins += worked;
        }
      }

      const attendanceRate = empTotalWorkingDays > 0
        ? Math.round(((presentDays + leaveDays) / empTotalWorkingDays) * 100)
        : 0;

      const punctualityScore = presentDays > 0
        ? Math.round(((presentDays - lateCount) / presentDays) * 100)
        : 0;

      const weekendPresent    = weekendDates.filter(d => empLogs[d]?.timeIn).length;
      const holidayPresent    = holidayDates.filter(d => empLogs[d]?.timeIn).length;
      const officialVisitDays = empVisit.size;

      const requiredMins = presentDays * ((defShift?.work_hours || 8) * 60);
      const lackMins     = Math.max(0, requiredMins - totalMins);

      return {
        id           : emp.id,
        empCode      : emp.empCode,
        fullName     : emp.fullName,
        department   : emp.department || '—',
        position     : emp.position   || '—',
        totalWorkingDays: empTotalWorkingDays,
        presentDays,
        absentDays,
        leaveDays,
        lateCount,
        earlyCount,
        otMinutes,
        totalMins,
        lateMinsTotal,
        earlyMinsTotal,
        attendanceRate,
        punctualityScore,
        weekendDays     : weekendDates.length,
        weekendPresent,
        holidayDays     : holidayDates.length,
        holidayPresent,
        officialVisitDays,
        workedHrsFormatted : totalMins > 0 ? toHHMM(totalMins)  : '0:00',
        lackHrsFormatted   : lackMins  > 0 ? toHHMM(lackMins)   : '0:00',
        otFormatted        : otMinutes > 0 ? toHHMM(otMinutes)  : '—',
        avgLateFormatted   : lateCount > 0 ? toHHMM(Math.round(lateMinsTotal/lateCount)) : '—',
      };
    });

    // â”€â”€ Rankings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const sortBy = (key, asc = false) =>
      [...stats].sort((a, b) => asc ? a[key]-b[key] : b[key]-a[key]);

    const topPunctual  = sortBy('punctualityScore').filter(s=>s.presentDays>0).slice(0,5);
    const mostLate     = sortBy('lateCount').filter(s=>s.lateCount>0).slice(0,5);
    const mostEarlyOut = sortBy('earlyCount').filter(s=>s.earlyCount>0).slice(0,5);
    const mostAbsent   = sortBy('absentDays').filter(s=>s.absentDays>0).slice(0,5);
    const mostOT       = sortBy('otMinutes').filter(s=>s.otMinutes>0).slice(0,5);
    const mostPresent  = sortBy('presentDays').filter(s=>s.presentDays>0).slice(0,5);

    // â”€â”€ Summary totals â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const totalEmp      = stats.length;
    const totalPresent  = stats.reduce((a,s)=>a+s.presentDays,0);
    const totalAbsent   = stats.reduce((a,s)=>a+s.absentDays,0);
    const totalLeave    = stats.reduce((a,s)=>a+s.leaveDays,0);
    const totalLate     = stats.reduce((a,s)=>a+s.lateCount,0);
    const totalOTMins   = stats.reduce((a,s)=>a+s.otMinutes,0);
    const avgAttRate    = totalEmp>0 ? Math.round(stats.reduce((a,s)=>a+s.attendanceRate,0)/totalEmp) : 0;
    const perfectAtt    = stats.filter(s=>s.absentDays===0&&s.lateCount===0&&s.presentDays===totalWorkingDays).length;

    // â”€â”€ AI Insights â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const insights = [];
    if (avgAttRate >= 90)
      insights.push({ type:'positive', icon:'ðŸŒŸ', text:`Excellent half-month! Average attendance rate is ${avgAttRate}% — above target.` });
    else if (avgAttRate >= 75)
      insights.push({ type:'neutral', icon:'ðŸ“Š', text:`Average attendance rate is ${avgAttRate}%. ${Math.ceil((90-avgAttRate)/100*totalEmp)} more staff needed for 90%+ target.` });
    else
      insights.push({ type:'warning', icon:'âš ï¸', text:`Attendance rate is ${avgAttRate}% — significantly below 90% target. Immediate action needed.` });

    if (perfectAtt > 0)
      insights.push({ type:'positive', icon:'ðŸ†', text:`${perfectAtt} staff member${perfectAtt>1?'s':''} achieved perfect attendance with zero absences or late arrivals!` });

    if (totalLate > 0) {
      const pct = Math.round((stats.filter(s=>s.lateCount>0).length/totalEmp)*100);
      insights.push({ type: pct>50?'warning':'neutral', icon:'â°', text:`${pct}% of staff had at least one late arrival. Top offender: ${mostLate[0]?.fullName||'—'} (${mostLate[0]?.lateCount||0} times).` });
    }

    if (mostAbsent[0]?.absentDays >= 5)
      insights.push({ type:'warning', icon:'ðŸ“…', text:`${stats.filter(s=>s.absentDays>=3).length} staff with 3+ absences. ${mostAbsent[0]?.fullName} has the most at ${mostAbsent[0]?.absentDays} days.` });

    if (totalOTMins > 0) {
      const otHrs = Math.round(totalOTMins/60);
      insights.push({ type:'positive', icon:'ðŸ’ª', text:`Total team overtime: ${otHrs} hours. ${mostOT[0]?.fullName||'—'} contributed the most (${mostOT[0]?.otFormatted||'—'}).` });
    }

    res.json({
      period: { year, month, half, startDate, endDate, totalWorkingDays },
      summary: { totalEmp, totalPresent, totalAbsent, totalLeave, totalLate, totalOTMins, avgAttRate, perfectAtt },
      rankings: { topPunctual, mostLate, mostEarlyOut, mostAbsent, mostOT, mostPresent },
      insights,
      allStats: stats,
    });
  } catch (err) {
    logError('[attendance/half-monthly]', err);
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€ GET /monthly — full-month analytics dashboard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/monthly', async (req, res) => {
  const now   = new Date();
  const year  = parseInt(req.query.year)  || now.getFullYear();
  const month = parseInt(req.query.month) || (now.getMonth() + 1);

  const pad = (n) => String(n).padStart(2,'0');
  const lastDayOfMonth = new Date(year, month, 0).getDate();
  const startDate = `${year}-${pad(month)}-01`;
  const endDate   = `${year}-${pad(month)}-${pad(lastDayOfMonth)}`;

  try {
    const [wkRes, publicHolidays] = await Promise.all([
      pool.query(`SELECT weekends FROM weekend_history WHERE effective_date <= $1 ORDER BY effective_date DESC LIMIT 1`, [endDate]),
      loadPublicHolidays(),
    ]);
    const weekends   = wkRes.rows[0]?.weekends || ['Sat'];
    const getHoliday = makeHolidayChecker(publicHolidays);
    const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

    // Working days = non-weekend, non-public-holiday days in the month
    const workingDays = [];
    for (let d = 1; d <= lastDayOfMonth; d++) {
      const dt      = new Date(year, month - 1, d);
      const key     = DOW[dt.getDay()];
      const dateStr = `${year}-${pad(month)}-${pad(d)}`;
      if (!weekends.includes(key) && !getHoliday(dateStr)) workingDays.push(dateStr);
    }
    const totalWorkingDays = workingDays.length;

    const shiftRes = await pool.query(`SELECT * FROM shifts WHERE make_default=TRUE LIMIT 1`);
    const defShift = shiftRes.rows[0];

    const hmActiveParam = req.query.active !== 'false';
    const empRes = await pool.query(`
      SELECT u.id, u.employee_id AS "empCode", u.full_name AS "fullName",
             u.department, u.position, u.shift,
             s.start_time AS shift_start, s.end_time AS shift_end,
             s.grace_period_start AS grace_st, s.grace_period_end AS grace_ed
      FROM   users u
      LEFT   JOIN shifts s ON s.code = u.shift
      WHERE  u.active=$1
      ORDER  BY u.ranking_order ASC NULLS LAST, u.full_name ASC
    `, [hmActiveParam]);
    const employees = empRes.rows;

    // â”€â”€ Duty roster map for the month â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const rosterMapMon = await loadRosterMap(startDate, endDate);

    // â”€â”€ Build all calendar dates in the month â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const allDatesMon = [];
    for (let d = 1; d <= lastDayOfMonth; d++) {
      const dt      = new Date(year, month - 1, d);
      const dayKey  = DOW[dt.getDay()];
      const dateStr = `${year}-${pad(month)}-${pad(d)}`;
      allDatesMon.push({ dateStr, dayKey });
    }

    const logsRes = await pool.query(`
      SELECT employee_id, day,
             MIN(time_in) AS time_in, MAX(time_out) AS time_out, SUM(cnt)::int AS punches
      FROM (
        SELECT employee_id, check_time::date AS day,
               MIN(check_time) AS time_in, MAX(check_time) AS time_out, COUNT(*)::int AS cnt
        FROM zkteco_attendance_logs
        WHERE check_time::date BETWEEN $1 AND $2 AND employee_id IS NOT NULL
        GROUP BY employee_id, check_time::date
        UNION ALL
        SELECT employee_id, date AS day,
               (date + check_in)::timestamp::timestamptz AS time_in,
               CASE WHEN check_out IS NOT NULL
                    THEN (date + check_out)::timestamp::timestamptz
                    ELSE NULL END AS time_out,
               CASE WHEN check_out IS NOT NULL THEN 2 ELSE 1 END AS cnt
        FROM attendance_manual_postings
        WHERE date BETWEEN $1 AND $2 AND check_in IS NOT NULL
      ) src
      GROUP BY employee_id, day
    `, [startDate, endDate]);

    const logsMap = {};
    for (const r of logsRes.rows) {
      if (!logsMap[r.employee_id]) logsMap[r.employee_id] = {};
      logsMap[r.employee_id][toDateStr(r.day)] = { timeIn: r.time_in, timeOut: r.time_out, punches: r.punches };
    }

    const leavesRes = await pool.query(`
      SELECT l.employee_id, l.from_date, l.to_date, lt.name AS leave_type
      FROM leaves l LEFT JOIN leave_types lt ON lt.code = l.leave_type_code
      WHERE l.status='approved' AND l.from_date <= $2 AND l.to_date >= $1
    `, [startDate, endDate]);

    const leaveMap = {};
    for (const l of leavesRes.rows) {
      if (!leaveMap[l.employee_id]) leaveMap[l.employee_id] = [];
      const from = new Date(l.from_date), to = new Date(l.to_date);
      for (let d = new Date(from); d <= to; d.setDate(d.getDate()+1)) {
        const ds = d.toISOString().split('T')[0];
        if (ds >= startDate && ds <= endDate) leaveMap[l.employee_id].push(ds);
      }
    }

    const pad2   = (n) => String(Math.round(n)).padStart(2,'0');
    const toHHMM = (mins) => `${pad2(Math.floor(Math.abs(mins)/60))}:${pad2(Math.abs(mins)%60)}`;

    // Only approved OT counts in monthly report — use manager-set value
    const monthlyApprovedOTSet = await loadApprovedOTMap(startDate, endDate);

    const stats = employees.map(emp => {
      const empLogs  = logsMap[emp.id] || {};
      const empLeave = new Set(leaveMap[emp.id] || []);

      // Per-employee roster entries
      const empRosterEntriesM = rosterMapMon[emp.id] || [];
      const getEmpRosterM = (ds) =>
        empRosterEntriesM.find(e => e.dateFrom <= ds && e.dateTo >= ds) ||
        empRosterEntriesM.filter(e => e.dateTo < ds).sort((a, b) => b.dateTo.localeCompare(a.dateTo))[0] ||
        null;

      // Employee's own shift (fallback to default)
      const empShiftStartM = emp.shift_start?.toString().substring(0,5) || defShift?.start_time?.toString().substring(0,5) || '10:00';
      const empShiftEndM   = emp.shift_end?.toString().substring(0,5)   || defShift?.end_time?.toString().substring(0,5)   || '17:00';
      const empGraceStM    = emp.grace_st ?? defShift?.grace_period_start ?? 0;
      const empGraceEdM    = emp.grace_ed ?? defShift?.grace_period_end   ?? 0;

      // Compute per-employee working days (roster off days override system weekends)
      let empTotalWorkingDays = 0;
      const empWorkingDatesM = [];
      for (const { dateStr, dayKey } of allDatesMon) {
        const roster   = getEmpRosterM(dateStr);
        const effOff   = roster?.offDays?.length > 0 ? roster.offDays : weekends;
        const isEmpWkd = effOff.includes(dayKey);
        const phName3  = getHoliday(dateStr);
        if (!isEmpWkd && !phName3) {
          empWorkingDatesM.push({ dateStr, roster });
          empTotalWorkingDays++;
        }
      }

      let presentDays=0, absentDays=0, leaveDays=0, lateCount=0, earlyCount=0;
      let otMinutes=0, totalMins=0, lateMinsTotal=0, earlyMinsTotal=0;

      for (const { dateStr, roster } of empWorkingDatesM) {
        if (empLeave.has(dateStr)) { leaveDays++; continue; }
        const log = empLogs[dateStr];
        if (!log || !log.timeIn) { absentDays++; continue; }
        presentDays++;
        const inDt  = new Date(log.timeIn);
        const outDt = (log.timeOut && log.punches >= 2) ? new Date(log.timeOut) : null;

        // Effective shift: roster > employee > default
        const shiftStart = roster?.shiftStart || empShiftStartM;
        const shiftEnd   = roster?.shiftEnd   || empShiftEndM;
        const graceSt    = roster?.graceSt    != null ? roster.graceSt    : empGraceStM;
        const graceEd    = roster?.graceEd    != null ? roster.graceEd    : empGraceEdM;

        const [sh, sm] = shiftStart.split(':').map(Number);
        const [eh, em] = shiftEnd.split(':').map(Number);
        const [dy, mo, dd] = dateStr.split('-').map(Number);
        const sDt = shiftToUTC(dy, mo, dd, sh, sm);
        const eDt = shiftToUTC(dy, mo, dd, eh, em);
        if (eDt <= sDt) eDt.setUTCDate(eDt.getUTCDate()+1);
        const lateMins = Math.round((inDt - sDt) / 60000) - graceSt;
        if (lateMins > 0) { lateCount++; lateMinsTotal += lateMins; }
        if (outDt) {
          const earlyMins = Math.round((eDt - outDt) / 60000) - graceEd;
          if (earlyMins > 0) { earlyCount++; earlyMinsTotal += earlyMins; }
          const otMinsRaw = Math.round((outDt - eDt) / 60000);
          if (otMinsRaw > 0) {
            const approvedMins = monthlyApprovedOTSet.get(`${emp.id}-${dateStr}`);
            if (approvedMins !== undefined) otMinutes += approvedMins;
          }
          const worked = Math.round((outDt - inDt) / 60000);
          if (worked > 0) totalMins += worked;
        }
      }

      const attendanceRate   = empTotalWorkingDays > 0 ? Math.round(((presentDays+leaveDays)/empTotalWorkingDays)*100) : 0;
      const punctualityScore = presentDays > 0 ? Math.round(((presentDays-lateCount)/presentDays)*100) : 0;
      return {
        id:emp.id, empCode:emp.empCode, fullName:emp.fullName,
        department:emp.department||'—', position:emp.position||'—',
        totalWorkingDays: empTotalWorkingDays, presentDays, absentDays, leaveDays,
        lateCount, earlyCount, otMinutes, totalMins, lateMinsTotal, earlyMinsTotal,
        attendanceRate, punctualityScore,
        otFormatted     : otMinutes>0 ? toHHMM(otMinutes) : '—',
        avgLateFormatted: lateCount>0 ? toHHMM(Math.round(lateMinsTotal/lateCount)) : '—',
      };
    });

    const sortBy = (key, asc=false) => [...stats].sort((a,b)=>asc?a[key]-b[key]:b[key]-a[key]);
    const topPunctual  = sortBy('punctualityScore').filter(s=>s.presentDays>0).slice(0,5);
    const mostLate     = sortBy('lateCount').filter(s=>s.lateCount>0).slice(0,5);
    const mostEarlyOut = sortBy('earlyCount').filter(s=>s.earlyCount>0).slice(0,5);
    const mostAbsent   = sortBy('absentDays').filter(s=>s.absentDays>0).slice(0,5);
    const mostOT       = sortBy('otMinutes').filter(s=>s.otMinutes>0).slice(0,5);
    const mostPresent  = sortBy('presentDays').filter(s=>s.presentDays>0).slice(0,5);

    const totalEmp    = stats.length;
    const totalPresent= stats.reduce((a,s)=>a+s.presentDays,0);
    const totalAbsent = stats.reduce((a,s)=>a+s.absentDays,0);
    const totalLeave  = stats.reduce((a,s)=>a+s.leaveDays,0);
    const totalLate   = stats.reduce((a,s)=>a+s.lateCount,0);
    const totalOTMins = stats.reduce((a,s)=>a+s.otMinutes,0);
    const avgAttRate  = totalEmp>0 ? Math.round(stats.reduce((a,s)=>a+s.attendanceRate,0)/totalEmp) : 0;
    const perfectAtt  = stats.filter(s=>s.absentDays===0&&s.lateCount===0&&s.presentDays===totalWorkingDays).length;

    const insights = [];
    if (avgAttRate>=90) insights.push({ type:'positive', icon:'ðŸŒŸ', text:`Excellent month! Average attendance is ${avgAttRate}% — above target.` });
    else if (avgAttRate>=75) insights.push({ type:'neutral', icon:'ðŸ“Š', text:`Monthly attendance is ${avgAttRate}%. ${Math.ceil((90-avgAttRate)/100*totalEmp)} more staff needed for 90%+ target.` });
    else insights.push({ type:'warning', icon:'âš ï¸', text:`Monthly attendance is ${avgAttRate}% — below 90% target.` });
    if (perfectAtt>0) insights.push({ type:'positive', icon:'ðŸ†', text:`${perfectAtt} staff achieved perfect attendance for the full month!` });
    if (totalLate>0) {
      const pct=Math.round((stats.filter(s=>s.lateCount>0).length/totalEmp)*100);
      insights.push({ type:pct>50?'warning':'neutral', icon:'â°', text:`${pct}% of staff had at least one late arrival. Most: ${mostLate[0]?.fullName||'—'} (${mostLate[0]?.lateCount||0} times).` });
    }
    if (mostAbsent[0]?.absentDays>=5) insights.push({ type:'warning', icon:'ðŸ“…', text:`${stats.filter(s=>s.absentDays>=3).length} staff with 3+ absences. Most: ${mostAbsent[0]?.fullName} (${mostAbsent[0]?.absentDays} days).` });
    if (totalOTMins>0) insights.push({ type:'positive', icon:'ðŸ’ª', text:`Total monthly OT: ${Math.round(totalOTMins/60)} hours. Top: ${mostOT[0]?.fullName||'—'} (${mostOT[0]?.otFormatted||'—'}).` });

    res.json({
      period: { year, month, startDate, endDate, totalWorkingDays },
      summary: { totalEmp, totalPresent, totalAbsent, totalLeave, totalLate, totalOTMins, avgAttRate, perfectAtt },
      rankings: { topPunctual, mostLate, mostEarlyOut, mostAbsent, mostOT, mostPresent },
      insights, allStats: stats,
    });
  } catch (err) {
    logError('[attendance/monthly]', err);
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€ GET /half-in-out — day-by-day Time In / Time Out matrix for all staff â”€â”€â”€â”€
router.get('/half-in-out', async (req, res) => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');

  // Accept explicit startDate/endDate (used for Nepali calendar mode)
  // OR compute from year/month/half (AD calendar mode)
  let startDate = req.query.startDate;
  let endDate   = req.query.endDate;

  if (!startDate || !endDate) {
    const year  = parseInt(req.query.year)  || now.getFullYear();
    const month = parseInt(req.query.month) || (now.getMonth() + 1);
    const half  = parseInt(req.query.half)  || (now.getDate() <= 15 ? 1 : 2);
    const startDay = half === 1 ? 1 : 16;
    const endDay   = half === 1 ? 15 : new Date(year, month, 0).getDate();
    startDate = `${year}-${pad(month)}-${pad(startDay)}`;
    endDate   = `${year}-${pad(month)}-${pad(endDay)}`;
  }

  try {
    const [wkRes, publicHolidays] = await Promise.all([
      pool.query(`SELECT weekends FROM weekend_history WHERE effective_date <= $1 ORDER BY effective_date DESC LIMIT 1`, [endDate]),
      loadPublicHolidays(),
    ]);
    const weekends   = wkRes.rows[0]?.weekends || ['Sat'];
    const getHoliday = makeHolidayChecker(publicHolidays);
    const DOW        = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

    // Build dates by iterating from startDate to endDate (works for both AD and BS modes)
    const dates = [];
    let cur = new Date(startDate + 'T00:00:00');
    const endDt = new Date(endDate + 'T00:00:00');
    while (cur <= endDt) {
      const dayKey      = DOW[cur.getDay()];
      const dateStr     = `${cur.getFullYear()}-${pad(cur.getMonth()+1)}-${pad(cur.getDate())}`;
      const holidayName = getHoliday(dateStr);
      dates.push({ date: dateStr, dayNum: cur.getDate(), dayKey,
        isWeekend: weekends.includes(dayKey),
        isHoliday: !!holidayName,
        holidayName: holidayName || null });
      cur.setDate(cur.getDate() + 1);
    }

    const [empRes, leavesRes, visitRes] = await Promise.all([
      pool.query(`
        SELECT u.id, u.employee_id AS "empCode", u.full_name AS "fullName",
               NULLIF(TRIM(COALESCE(p.short_name,'')), '')  AS "postShort",
               NULLIF(TRIM(COALESCE(dd.short_name,'')), '') AS "deptShort",
               NULLIF(TRIM(COALESCE(br.short_name,'')), '') AS "branchShort",
               u.position, u.department, u.branch
        FROM   users u
        LEFT JOIN posts       p  ON p.name  = u.position
        LEFT JOIN departments dd ON dd.name = u.department
        LEFT JOIN branches    br ON br.name = u.branch
        WHERE  u.active = TRUE AND (u.is_system IS NOT TRUE AND u.role NOT IN ('superAdmin'))
        ORDER  BY u.ranking_order ASC NULLS LAST, u.full_name ASC
      `),
      pool.query(`
        SELECT l.employee_id, l.from_date, l.to_date, lt.name AS leave_type
        FROM   leaves l LEFT JOIN leave_types lt ON lt.code = l.leave_type_code
        WHERE  l.status='approved' AND l.from_date <= $2 AND l.to_date >= $1
      `, [startDate, endDate]),
      pool.query(`
        SELECT employee_id, from_date, to_date, purpose, location
        FROM   office_visits WHERE status='approved' AND from_date <= $2 AND to_date >= $1
      `, [startDate, endDate]),
    ]);

    // Build per-employee leave map
    const leaveMap = {};
    for (const l of leavesRes.rows) {
      if (!leaveMap[l.employee_id]) leaveMap[l.employee_id] = {};
      const from = new Date(l.from_date), to = new Date(l.to_date);
      for (let d = new Date(from); d <= to; d.setDate(d.getDate()+1)) {
        const ds = d.toISOString().split('T')[0];
        if (ds >= startDate && ds <= endDate) leaveMap[l.employee_id][ds] = l.leave_type || 'Leave';
      }
    }

    // Build per-employee visit map
    const visitMapIO = {};
    for (const v of visitRes.rows) {
      if (!visitMapIO[v.employee_id]) visitMapIO[v.employee_id] = {};
      const from = new Date(v.from_date), to = new Date(v.to_date);
      for (let d = new Date(from); d <= to; d.setDate(d.getDate()+1)) {
        const ds = d.toISOString().split('T')[0];
        if (ds >= startDate && ds <= endDate)
          visitMapIO[v.employee_id][ds] = { purpose: v.purpose||'', location: v.location||'' };
      }
    }

    const logsRes = await pool.query(`
      SELECT employee_id, day,
             MIN(time_in) AS time_in, MAX(time_out) AS time_out, SUM(cnt)::int AS punches
      FROM (
        SELECT employee_id, check_time::date AS day,
               MIN(check_time) AS time_in, MAX(check_time) AS time_out, COUNT(*)::int AS cnt
        FROM   zkteco_attendance_logs
        WHERE  check_time::date BETWEEN $1 AND $2 AND employee_id IS NOT NULL
        GROUP  BY employee_id, check_time::date
        UNION ALL
        SELECT employee_id, date AS day,
               (date + check_in)::timestamp::timestamptz AS time_in,
               CASE WHEN check_out IS NOT NULL
                    THEN (date + check_out)::timestamp::timestamptz
                    ELSE NULL END AS time_out,
               CASE WHEN check_out IS NOT NULL THEN 2 ELSE 1 END AS cnt
        FROM   attendance_manual_postings
        WHERE  date BETWEEN $1 AND $2 AND check_in IS NOT NULL
      ) src
      GROUP BY employee_id, day
    `, [startDate, endDate]);

    // Default shift for OT calculation
    const shiftRes = await pool.query(`SELECT * FROM shifts WHERE make_default=TRUE LIMIT 1`);
    const defShift  = shiftRes.rows[0];
    const shiftEnd  = defShift?.end_time?.toString().substring(0,5) || '17:00';

    // Approved OT from overtime_approvals (manager-set, authoritative)
    const approvedOTMap = await loadApprovedOTMap(startDate, endDate);

    const logsMap = {};
    for (const r of logsRes.rows) {
      if (!logsMap[r.employee_id]) logsMap[r.employee_id] = {};
      logsMap[r.employee_id][toDateStr(r.day)] = {
        timeIn:  r.time_in,
        timeOut: r.punches >= 2 ? r.time_out : null,
        punches: r.punches,
      };
    }

    const [seH, seM] = shiftEnd.split(':').map(Number);

    const employees = empRes.rows.map(emp => {
      const empLogs  = logsMap[emp.id]     || {};
      const empLeave = leaveMap[emp.id]    || {};
      const empVisit = visitMapIO[emp.id]  || {};
      const days = {};
      for (const { date } of dates) {
        const log     = empLogs[date];
        const inDt    = log?.timeIn  ? new Date(log.timeIn)  : null;
        const outDt   = log?.timeOut ? new Date(log.timeOut) : null;

        let workedHrs = null, otHrs = null;
        if (inDt && outDt) {
          const wMins = Math.max(0, Math.round((outDt - inDt) / 60000));
          if (wMins > 0) workedHrs = minsToHHMM(wMins);
        }
        /* Use approved OT (manager-set) — only show if approved */
        const approvedOTMins = approvedOTMap.get(`${emp.id}-${date}`);
        if (approvedOTMins != null && approvedOTMins > 0) {
          otHrs = minsToHHMM(approvedOTMins);
        }

        const rawIn  = log?.timeIn  ? new Date(log.timeIn).toISOString()  : null;
        const rawOut = log?.timeOut ? new Date(log.timeOut).toISOString() : null;

        days[date] = {
          timeIn:  rawIn,
          timeOut: rawOut,
          punches: log?.punches || 0,
          workedHrs, otHrs,
          leave : empLeave[date] || null,
          visit : empVisit[date] || null,
        };
      }
      // Total worked minutes across all days
      const totalWorkedMins = Object.values(days).reduce((sum, d) => {
        if (!d.workedHrs) return sum;
        const [h, m] = d.workedHrs.split(':').map(Number);
        return sum + h*60 + m;
      }, 0);

      return {
        id: emp.id, empCode: emp.empCode, fullName: emp.fullName,
        postShort:   emp.postShort   || abbrev(emp.position)   || '—',
        deptShort:   emp.deptShort   || abbrev(emp.department) || '—',
        branchShort: emp.branchShort || abbrev(emp.branch)     || '—',
        totalWorkedHrs: totalWorkedMins > 0 ? minsToHHMM(totalWorkedMins) : '—',
        days,
      };
    });

    res.json({ period: { startDate, endDate }, dates, employees });
  } catch (err) {
    logError('[attendance/half-in-out]', err);
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€ GET /half-late-early — flat list of late-in / early-out occurrences â”€â”€â”€â”€â”€â”€
router.get('/half-late-early', async (req, res) => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2,'0');
  const minsToHHMM = (m) => `${pad(Math.floor(m/60))}:${pad(m%60)}`;

  let startDate = req.query.startDate;
  let endDate   = req.query.endDate;
  if (!startDate || !endDate) {
    const y = parseInt(req.query.year)  || now.getFullYear();
    const m = parseInt(req.query.month) || (now.getMonth() + 1);
    const half = parseInt(req.query.half) || (now.getDate() <= 15 ? 1 : 2);
    const s = half === 1 ? 1 : 16;
    const e = half === 1 ? 15 : new Date(y, m, 0).getDate();
    startDate = `${y}-${pad(m)}-${pad(s)}`;
    endDate   = `${y}-${pad(m)}-${pad(e)}`;
  }

  try {
    const [wkRes, publicHolidays] = await Promise.all([
      pool.query(`SELECT weekends FROM weekend_history WHERE effective_date <= $1 ORDER BY effective_date DESC LIMIT 1`, [endDate]),
      loadPublicHolidays(),
    ]);
    const weekends   = wkRes.rows[0]?.weekends || ['Sat'];
    const getHoliday = makeHolidayChecker(publicHolidays);
    const DOW        = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

    // Build working dates list
    const workingDates = [];
    let cur = new Date(startDate + 'T00:00:00');
    const endDt = new Date(endDate + 'T00:00:00');
    while (cur <= endDt) {
      const dayKey  = DOW[cur.getDay()];
      const dateStr = `${cur.getFullYear()}-${pad(cur.getMonth()+1)}-${pad(cur.getDate())}`;
      if (!weekends.includes(dayKey) && !getHoliday(dateStr)) workingDates.push(dateStr);
      cur.setDate(cur.getDate() + 1);
    }

    // Employees with per-employee shift fallback to default
    const empRes = await pool.query(`
      SELECT u.id, u.full_name AS "fullName", u.position, u.department, u.branch,
             u.shift AS "shiftCode", u.grade, u.mode, u.timing_type AS "timingType",
             NULLIF(TRIM(COALESCE(p.short_name,'')),  '') AS "postShort",
             NULLIF(TRIM(COALESCE(dd.short_name,'')), '') AS "deptShort",
             NULLIF(TRIM(COALESCE(br.short_name,'')), '') AS "branchShort",
             COALESCE(s.start_time,  ds.start_time)  AS "shiftStart",
             COALESCE(s.end_time,    ds.end_time)    AS "shiftEnd",
             COALESCE(s.grace_period_start, ds.grace_period_start, 0) AS "graceSt",
             COALESCE(s.grace_period_end,   ds.grace_period_end,   0) AS "graceEd"
      FROM   users u
      CROSS  JOIN LATERAL (SELECT * FROM shifts WHERE make_default=TRUE LIMIT 1) ds
      LEFT JOIN shifts       s  ON s.code = u.shift
      LEFT JOIN posts        p  ON LOWER(TRIM(p.name))  = LOWER(TRIM(u.position))
      LEFT JOIN departments  dd ON LOWER(TRIM(dd.name)) = LOWER(TRIM(u.department))
      LEFT JOIN branches     br ON LOWER(TRIM(br.name)) = LOWER(TRIM(u.branch))
      WHERE  u.active = $1 AND (u.is_system IS NOT TRUE AND u.role NOT IN ('superAdmin'))
      ORDER  BY u.ranking_order ASC NULLS LAST, u.full_name ASC
    `, [req.query.active !== 'false']);

    // Attendance logs for the period
    const logsRes = await pool.query(`
      SELECT employee_id, day,
             MIN(time_in) AS time_in, MAX(time_out) AS time_out, SUM(cnt)::int AS punches
      FROM (
        SELECT employee_id, check_time::date AS day,
               MIN(check_time) AS time_in, MAX(check_time) AS time_out, COUNT(*)::int AS cnt
        FROM   zkteco_attendance_logs
        WHERE  check_time::date BETWEEN $1 AND $2 AND employee_id IS NOT NULL
        GROUP  BY employee_id, check_time::date
        UNION ALL
        SELECT employee_id, date AS day,
               (date + check_in)::timestamp::timestamptz AS time_in,
               CASE WHEN check_out IS NOT NULL
                    THEN (date + check_out)::timestamp::timestamptz
                    ELSE NULL END AS time_out,
               CASE WHEN check_out IS NOT NULL THEN 2 ELSE 1 END AS cnt
        FROM   attendance_manual_postings
        WHERE  date BETWEEN $1 AND $2 AND check_in IS NOT NULL
      ) src
      GROUP BY employee_id, day
    `, [startDate, endDate]);

    const logsMap = {};
    for (const r of logsRes.rows) {
      if (!logsMap[r.employee_id]) logsMap[r.employee_id] = {};
      logsMap[r.employee_id][toDateStr(r.day)] = {
        timeIn:  r.time_in,
        timeOut: r.punches >= 2 ? r.time_out : null,
        punches: r.punches,
      };
    }

    // Load duty roster map for the period
    const rosterMapLE = await loadRosterMap(startDate, endDate);

    // Build all calendar dates for per-employee working-day computation
    const allDatesLE = [];
    let curLE = new Date(startDate + 'T00:00:00');
    const endDtLE = new Date(endDate + 'T00:00:00');
    while (curLE <= endDtLE) {
      const dayKey  = DOW[curLE.getDay()];
      const dateStr = `${curLE.getFullYear()}-${pad(curLE.getMonth()+1)}-${pad(curLE.getDate())}`;
      allDatesLE.push({ dateStr, dayKey });
      curLE.setDate(curLE.getDate() + 1);
    }

    // Build flat records — one row per late/early occurrence
    const records = [];
    for (const emp of empRes.rows) {
      const empLogs = logsMap[emp.id] || {};
      const empRosterEntriesLE = rosterMapLE[emp.id] || [];
      const getEmpRosterLE = (ds) =>
        empRosterEntriesLE.find(e => e.dateFrom <= ds && e.dateTo >= ds) ||
        empRosterEntriesLE.filter(e => e.dateTo < ds).sort((a, b) => b.dateTo.localeCompare(a.dateTo))[0] ||
        null;

      const empShiftStartLE = emp.shiftStart?.toString().substring(0,5) || '10:00';
      const empShiftEndLE   = emp.shiftEnd?.toString().substring(0,5)   || '17:00';
      const empGraceStLE    = emp.graceSt || 0;
      const empGraceEdLE    = emp.graceEd || 0;

      for (const { dateStr, dayKey } of allDatesLE) {
        const roster   = getEmpRosterLE(dateStr);
        const effOff   = roster?.offDays?.length > 0 ? roster.offDays : weekends;
        if (effOff.includes(dayKey) || getHoliday(dateStr)) continue;  // off day / holiday — skip

        const log = empLogs[dateStr];
        if (!log || !log.timeIn) continue;  // absent — skip

        // Effective shift: roster > employee default
        const shiftStart = roster?.shiftStart || empShiftStartLE;
        const shiftEnd   = roster?.shiftEnd   || empShiftEndLE;
        const graceSt    = roster?.graceSt    != null ? roster.graceSt    : empGraceStLE;
        const graceEd    = roster?.graceEd    != null ? roster.graceEd    : empGraceEdLE;

        const [dy, mo, dd] = dateStr.split('-').map(Number);
        const [sh, sm] = shiftStart.split(':').map(Number);
        const [eh, em] = shiftEnd.split(':').map(Number);
        const inDt  = new Date(log.timeIn);
        const outDt = log.timeOut ? new Date(log.timeOut) : null;
        const sDt   = shiftToUTC(dy, mo, dd, sh, sm);
        const eDt   = shiftToUTC(dy, mo, dd, eh, em);
        if (eDt <= sDt) eDt.setUTCDate(eDt.getUTCDate() + 1);

        const lateInMins = Math.round((inDt - sDt) / 60000) - graceSt;
        let   earlyOutMins = 0;
        if (outDt) {
          const raw = Math.round((eDt - outDt) / 60000) - graceEd;
          if (raw > 0) earlyOutMins = raw;
        }

        if (lateInMins > 0 || earlyOutMins > 0) {
          records.push({
            id         : emp.id,
            fullName   : emp.fullName,
            postShort  : emp.postShort   || abbrev(emp.position)   || '—',
            deptShort  : emp.deptShort   || abbrev(emp.department) || '—',
            branchShort: emp.branchShort || abbrev(emp.branch)     || '—',
            position   : emp.position    || '',
            department : emp.department  || '',
            branch     : emp.branch      || '',
            grade      : emp.grade       || '',
            mode       : emp.mode        || '',
            timingType : emp.timingType  || '',
            shift      : roster?.shiftName || emp.shiftCode || '',
            date       : dateStr,
            shiftDisplay: `${shiftStart} - ${shiftEnd}`,
            timeIn     : log.timeIn  ? new Date(log.timeIn).toISOString()  : null,
            timeOut    : log.timeOut ? new Date(log.timeOut).toISOString() : null,
            punches    : log.punches,
            lateInMins, earlyOutMins,
            lateInFormatted  : lateInMins   > 0 ? `Late In by ${minsToHHMM(lateInMins)}`   : null,
            earlyOutFormatted: earlyOutMins > 0 ? `Early Out by ${minsToHHMM(earlyOutMins)}` : null,
          });
        }
      }
    }

    res.json({ period: { startDate, endDate }, records });
  } catch (err) {
    logError('[attendance/half-late-early]', err);
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€ GET /present-absent — day-by-day P/AB matrix for all staff â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/present-absent', async (req, res) => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2,'0');

  // Accept explicit startDate/endDate (monthly/BS calendar) OR compute from year/month/half
  let startDate = req.query.startDate;
  let endDate   = req.query.endDate;
  if (!startDate || !endDate) {
    const year  = parseInt(req.query.year)  || now.getFullYear();
    const month = parseInt(req.query.month) || (now.getMonth() + 1);
    const half  = parseInt(req.query.half)  || (now.getDate() <= 15 ? 1 : 2);
    const s = half === 1 ? 1 : 16;
    const e = half === 1 ? 15 : new Date(year, month, 0).getDate();
    startDate = `${year}-${pad(month)}-${pad(s)}`;
    endDate   = `${year}-${pad(month)}-${pad(e)}`;
  }

  try {
    const [wkRes, publicHolidays] = await Promise.all([
      pool.query(`SELECT weekends FROM weekend_history WHERE effective_date <= $1 ORDER BY effective_date DESC LIMIT 1`, [endDate]),
      loadPublicHolidays(),
    ]);
    const weekends   = wkRes.rows[0]?.weekends || ['Sat'];
    const getHoliday = makeHolidayChecker(publicHolidays);
    const DOW        = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

    // Build dates by iterating startDate â†’ endDate
    const dates = [];
    let paCur = new Date(startDate + 'T00:00:00');
    const paEnd = new Date(endDate + 'T00:00:00');
    while (paCur <= paEnd) {
      const dayKey      = DOW[paCur.getDay()];
      const dateStr     = `${paCur.getFullYear()}-${pad(paCur.getMonth()+1)}-${pad(paCur.getDate())}`;
      const isWeekend   = weekends.includes(dayKey);
      const holidayName = getHoliday(dateStr);
      dates.push({ date: dateStr, dayNum: paCur.getDate(), dayKey, isWeekend, isHoliday: !!holidayName, holidayName: holidayName || null });
      paCur.setDate(paCur.getDate() + 1);
    }
    const totalWorkingDays = dates.filter(d => !d.isWeekend && !d.isHoliday).length;

    // Employees — active=true by default; pass ?active=false for not-working staff
    const activeParam = req.query.active !== 'false';
    const empRes = await pool.query(`
      SELECT u.id, u.employee_id AS "empCode", u.full_name AS "fullName",
             u.branch, u.department, u.position, u.grade, u.mode,
             u.timing_type AS "timingType", u.shift,
             NULLIF(TRIM(COALESCE(p.short_name,'')),  '') AS "postShort",
             NULLIF(TRIM(COALESCE(dd.short_name,'')), '') AS "deptShort",
             NULLIF(TRIM(COALESCE(br.short_name,'')), '') AS "branchShort"
      FROM   users u
      LEFT JOIN posts       p  ON LOWER(TRIM(p.name))  = LOWER(TRIM(u.position))
      LEFT JOIN departments dd ON LOWER(TRIM(dd.name)) = LOWER(TRIM(u.department))
      LEFT JOIN branches    br ON LOWER(TRIM(br.name)) = LOWER(TRIM(u.branch))
      WHERE  u.active = $1 AND (u.is_system IS NOT TRUE AND u.role NOT IN ('superAdmin'))
      ORDER  BY u.ranking_order ASC NULLS LAST, u.full_name ASC
    `, [activeParam]);
    const employees = empRes.rows;

    // Attendance logs
    const logsRes = await pool.query(`
      SELECT employee_id, day, SUM(cnt)::int AS punches, MIN(time_in) AS time_in
      FROM (
        SELECT employee_id, check_time::date AS day, COUNT(*) AS cnt,
               MIN(check_time) AS time_in
        FROM   zkteco_attendance_logs
        WHERE  check_time::date BETWEEN $1 AND $2 AND employee_id IS NOT NULL
        GROUP  BY employee_id, check_time::date
        UNION ALL
        SELECT employee_id, date AS day,
               CASE WHEN check_out IS NOT NULL THEN 2 ELSE 1 END AS cnt,
               (date + check_in)::timestamp::timestamptz AS time_in
        FROM   attendance_manual_postings
        WHERE  date BETWEEN $1 AND $2 AND check_in IS NOT NULL
      ) src
      GROUP BY employee_id, day
    `, [startDate, endDate]);

    const logsMap = {};
    for (const r of logsRes.rows) {
      if (!logsMap[r.employee_id]) logsMap[r.employee_id] = {};
      logsMap[r.employee_id][toDateStr(r.day)] = { hasIn: !!r.time_in, punches: parseInt(r.punches, 10) || 0 };
    }

    // Approved leaves (include half_day flag)
    const leavesRes = await pool.query(`
      SELECT l.employee_id, l.from_date, l.to_date, l.half_day
      FROM   leaves l WHERE l.status='approved' AND l.from_date <= $2 AND l.to_date >= $1
    `, [startDate, endDate]);

    const leaveMap = {};     // empId â†’ Set of date strings (full day leave)
    const halfLeaveMap = {}; // empId â†’ Set of date strings (half day leave)
    for (const l of leavesRes.rows) {
      if (!leaveMap[l.employee_id])     leaveMap[l.employee_id]     = new Set();
      if (!halfLeaveMap[l.employee_id]) halfLeaveMap[l.employee_id] = new Set();
      const from = new Date(l.from_date), to = new Date(l.to_date);
      const isHalf = !!l.half_day;
      for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
        const ds = d.toISOString().split('T')[0];
        if (ds >= startDate && ds <= endDate) {
          if (isHalf) halfLeaveMap[l.employee_id].add(ds);
          else        leaveMap[l.employee_id].add(ds);
        }
      }
    }

    // Approved office visits
    const visitRes = await pool.query(`
      SELECT employee_id, from_date, to_date FROM office_visits
      WHERE  status='approved' AND from_date <= $2 AND to_date >= $1
    `, [startDate, endDate]);

    const visitMap = {};
    for (const v of visitRes.rows) {
      if (!visitMap[v.employee_id]) visitMap[v.employee_id] = new Set();
      const from = new Date(v.from_date), to = new Date(v.to_date);
      for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
        const ds = d.toISOString().split('T')[0];
        if (ds >= startDate && ds <= endDate) visitMap[v.employee_id].add(ds);
      }
    }

    // Build per-employee day matrix
    const employees_out = employees.map(emp => {
      const empLogs      = logsMap[emp.id]      || {};
      const empLeave     = leaveMap[emp.id]     || new Set();
      const empHalfLeave = halfLeaveMap[emp.id] || new Set();
      const empVisit     = visitMap[emp.id]     || new Set();

      let totalP=0, totalAB=0, totalL=0, totalOV=0, totalPH=0, totalH=0;
      const days = {};

      for (const { date, isWeekend, isHoliday } of dates) {
        const log      = empLogs[date];
        const leave    = empLeave.has(date);
        const halfLeave= empHalfLeave.has(date);
        const visit    = empVisit.has(date);
        const punches  = log?.punches || 0;
        let st;

        if (isWeekend)                   { st='H';  totalH++;  }
        else if (leave)                  { st='L';  totalL++;  }
        else if (halfLeave)              { st='LH'; totalL++;  }  // Half-day leave
        else if (log?.hasIn && isHoliday){ st='PP'; totalP++;  }  // Present on Public Holiday
        else if (log?.hasIn && punches===1){ st='P1'; totalP++; }  // Single punch
        else if (log?.hasIn)             { st='P';  totalP++;  }
        else if (isHoliday)              { st='PH'; totalPH++; }
        else if (visit)                  { st='OV'; totalOV++; }
        else                             { st='AB'; totalAB++; }

        days[date] = st;
      }

      return {
        id: emp.id, empCode: emp.empCode, fullName: emp.fullName,
        branch: emp.branch || '', department: emp.department || '',
        position: emp.position || '', grade: emp.grade || '',
        mode: emp.mode || '', timingType: emp.timingType || '',
        shift: emp.shift || '',
        postShort:   emp.postShort   || abbrev(emp.position)   || '—',
        deptShort:   emp.deptShort   || abbrev(emp.department) || '—',
        branchShort: emp.branchShort || abbrev(emp.branch)     || '—',
        days, totalP, totalAB, totalL, totalOV, totalPH, totalH,
      };
    });

    res.json({
      period: { startDate, endDate, totalWorkingDays },
      dates,
      employees: employees_out,
    });
  } catch (err) {
    logError('[attendance/present-absent]', err);
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€ Ensure attendance_remarks table exists (called from index.js post-migration) â”€â”€
export async function ensureRemarksTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS attendance_remarks (
        id          SERIAL       PRIMARY KEY,
        employee_id INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        date        DATE         NOT NULL,
        reason      TEXT         NOT NULL,
        type        VARCHAR(30)  DEFAULT 'general',
        created_at  TIMESTAMPTZ  DEFAULT NOW(),
        created_by  INTEGER      REFERENCES users(id),
        UNIQUE(employee_id, date, type)
      );
      CREATE INDEX IF NOT EXISTS idx_att_remarks_emp_date ON attendance_remarks(employee_id, date);
    `);
  } catch (e) { logError('[ensureRemarksTable]', e); }
}

// â”€â”€ GET /yearly-analytics — full-year per-staff ranking & insights â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/yearly-analytics', async (req, res) => {
  const pad  = (n) => String(n).padStart(2,'0');
  const year = parseInt(req.query.year) || new Date().getFullYear();

  // Support BS year â†’ approximate AD year
  const adYear = req.query.bsYear
    ? (() => { const d = new Date(parseInt(req.query.bsYear) - 57, 3, 14); return d.getFullYear(); })()
    : year;

  const startDate = `${adYear}-01-01`;
  const endDate   = `${adYear}-12-31`;

  try {
    const [wkRows, publicHolidays, empRows, shiftRow] = await Promise.all([
      pool.query(`SELECT weekends, effective_date FROM weekend_history WHERE effective_date <= $1 ORDER BY effective_date ASC`, [endDate]),
      loadPublicHolidays(),
      pool.query(`SELECT id, employee_id AS "empCode", full_name AS "fullName", department, position, shift, join_date AS "joinDate" FROM users WHERE active=TRUE ORDER BY ranking_order ASC NULLS LAST, full_name ASC`),
      pool.query(`SELECT * FROM shifts WHERE make_default=TRUE LIMIT 1`),
    ]);

    const employees = empRows.rows;
    const defShift  = shiftRow.rows[0];
    const getHoliday = makeHolidayChecker(publicHolidays);
    const DOW_KEYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

    // Build working-days list with per-day weekend awareness (weekend policy can change mid-year)
    const wkHistory = wkRows.rows; // sorted ASC by effective_date
    const getWeekends = (dateStr) => {
      let wds = ['Sat'];
      for (const w of wkHistory) {
        const ed = w.effective_date instanceof Date ? w.effective_date.toISOString().split('T')[0] : String(w.effective_date).split('T')[0];
        if (ed <= dateStr) wds = w.weekends;
      }
      return wds;
    };

    // All working days in the year (weekends + public holidays excluded)
    const workingDays = [];
    const cur = new Date(adYear, 0, 1);
    const end = new Date(adYear, 11, 31);
    while (cur <= end) {
      const ds  = `${cur.getFullYear()}-${pad(cur.getMonth()+1)}-${pad(cur.getDate())}`;
      const dow = DOW_KEYS[cur.getDay()];
      if (!getWeekends(ds).includes(dow) && !getHoliday(ds)) workingDays.push(ds);
      cur.setDate(cur.getDate()+1);
    }
    // globalWorkingDays used only for the year total chip in the summary
    const globalWorkingDays = workingDays.length;

    // Fetch entire year's punch logs in one query
    const logsRes = await pool.query(`
      SELECT employee_id, day,
             MIN(time_in) AS time_in, MAX(time_out) AS time_out, SUM(cnt)::int AS punches
      FROM (
        SELECT employee_id, check_time::date AS day,
               MIN(check_time) AS time_in, MAX(check_time) AS time_out, COUNT(*)::int AS cnt
        FROM zkteco_attendance_logs
        WHERE check_time >= $1 AND check_time <= ($2::date + interval '1 day')
          AND employee_id IS NOT NULL
        GROUP BY employee_id, check_time::date
        UNION ALL
        SELECT employee_id, date AS day,
               (date + check_in)::timestamp::timestamptz AS time_in,
               CASE WHEN check_out IS NOT NULL
                    THEN (date + check_out)::timestamp::timestamptz
                    ELSE NULL END AS time_out,
               CASE WHEN check_out IS NOT NULL THEN 2 ELSE 1 END AS cnt
        FROM attendance_manual_postings
        WHERE date BETWEEN $1::date AND $2::date AND check_in IS NOT NULL
      ) src
      GROUP BY employee_id, day
    `, [startDate, endDate]);

    const logsMap = {};
    for (const r of logsRes.rows) {
      if (!logsMap[r.employee_id]) logsMap[r.employee_id] = {};
      logsMap[r.employee_id][toDateStr(r.day)] = { timeIn: r.time_in, timeOut: r.time_out, punches: r.punches };
    }

    // Fetch all approved leaves for the year
    const lvRes = await pool.query(`
      SELECT l.employee_id, l.from_date, l.to_date,
             lt.name AS leave_type, lt.code AS leave_code,
             l.days AS leave_days_count
      FROM leaves l
      LEFT JOIN leave_types lt ON lt.code = l.leave_type_code
      WHERE l.status = 'approved'
        AND l.from_date <= $2 AND l.to_date >= $1
    `, [startDate, endDate]);

    const leaveMap     = {};  // empId â†’ Set of date strings on leave
    const leaveDaysMap = {};  // empId â†’ total approved leave days
    for (const l of lvRes.rows) {
      if (!leaveMap[l.employee_id])     leaveMap[l.employee_id]     = new Set();
      if (!leaveDaysMap[l.employee_id]) leaveDaysMap[l.employee_id] = 0;
      leaveDaysMap[l.employee_id] += parseFloat(l.leave_days_count || 0);
      const from = new Date(l.from_date), to = new Date(l.to_date);
      for (let d = new Date(from); d <= to; d.setDate(d.getDate()+1)) {
        const ds = d.toISOString().split('T')[0];
        if (ds >= startDate && ds <= endDate) leaveMap[l.employee_id].add(ds);
      }
    }

    // Only approved OT counts in yearly analytics — use manager-set value
    const yearlyApprovedOTSet = await loadApprovedOTMap(startDate, endDate);

    const shiftStart = defShift?.start_time?.toString().substring(0,5) || '10:00';
    const shiftEnd   = defShift?.end_time?.toString().substring(0,5)   || '17:00';
    const graceSt    = defShift?.grace_period_start || 0;
    const graceEd    = defShift?.grace_period_end   || 0;

    // Per-month breakdown for trend chart
    const monthlyTrend = Array.from({ length: 12 }, (_, mi) => ({
      month: mi, present: 0, absent: 0, leave: 0, late: 0, otMins: 0, staff: 0
    }));

    const allStats = employees.map(emp => {
      const empLogs  = logsMap[emp.id] || {};
      const empLeave = leaveMap[emp.id] || new Set();

      // Effective start = join date (if within this year) or Jan 1 of the year
      const rawJoin = emp.joinDate
        ? (emp.joinDate instanceof Date
            ? emp.joinDate.toISOString().split('T')[0]
            : String(emp.joinDate).split('T')[0])
        : startDate;
      const empStartDate = rawJoin > startDate ? rawJoin : startDate;

      // Only count working days on/after the employee's join date
      const empWorkingDays   = workingDays.filter(d => d >= empStartDate);
      const empTotalWorkDays = empWorkingDays.length;

      let presentDays=0, absentDays=0, leaveDays=0;
      let lateCount=0, earlyCount=0, otMins=0;
      let lateMinsTotal=0, earlyMinsTotal=0, totalWorkedMins=0;

      for (const ds of empWorkingDays) {
        const mi = parseInt(ds.split('-')[1]) - 1;
        if (empLeave.has(ds)) {
          leaveDays++;
          monthlyTrend[mi].leave++;
          continue;
        }
        const log = empLogs[ds];
        if (!log?.timeIn) {
          absentDays++;
          monthlyTrend[mi].absent++;
          continue;
        }
        presentDays++;
        monthlyTrend[mi].present++;
        monthlyTrend[mi].staff++;

        const inDt  = new Date(log.timeIn);
        const outDt = (log.timeOut && log.punches >= 2) ? new Date(log.timeOut) : null;
        const [sh, sm] = shiftStart.split(':').map(Number);
        const [eh, em] = shiftEnd.split(':').map(Number);
        const [y2, mo2, dd2] = ds.split('-').map(Number);
        const sDt = shiftToUTC(y2, mo2, dd2, sh, sm);
        const eDt = shiftToUTC(y2, mo2, dd2, eh, em);
        if (eDt <= sDt) eDt.setUTCDate(eDt.getUTCDate()+1);

        const lateMins = Math.round((inDt - sDt) / 60000) - graceSt;
        if (lateMins > 0) { lateCount++; lateMinsTotal += lateMins; monthlyTrend[mi].late++; }

        if (outDt) {
          const earlyMins = Math.round((eDt - outDt) / 60000) - graceEd;
          if (earlyMins > 0) { earlyCount++; earlyMinsTotal += earlyMins; }
          const ot = Math.round((outDt - eDt) / 60000);
          if (ot > 0) {
            const approvedMins = yearlyApprovedOTSet.get(`${emp.id}-${ds}`);
            if (approvedMins !== undefined) { otMins += approvedMins; monthlyTrend[mi].otMins += approvedMins; }
          }
          const worked = Math.round((outDt - inDt) / 60000);
          if (worked > 0) totalWorkedMins += worked;
        }
      }

      // Rates use the employee's own working day count (from join date)
      const attRate       = empTotalWorkDays > 0 ? Math.round(((presentDays+leaveDays)/empTotalWorkDays)*100) : 0;
      const punctualScore = presentDays > 0 ? Math.round(((presentDays-lateCount)/presentDays)*100) : 0;
      const leaveTaken    = leaveDaysMap[emp.id] || leaveDays;
      const avgLateMins   = lateCount  > 0 ? Math.round(lateMinsTotal  / lateCount)  : 0;
      const avgEarlyMins  = earlyCount > 0 ? Math.round(earlyMinsTotal / earlyCount) : 0;
      const isPerfect     = absentDays === 0 && lateCount === 0 && presentDays > 0 && empTotalWorkDays > 0;

      return {
        id: emp.id, empCode: emp.empCode, fullName: emp.fullName,
        department: emp.department || '—', position: emp.position || '—',
        joinDate: empStartDate,
        totalWorkingDays: empTotalWorkDays,   // days counted only from join date
        presentDays, absentDays, leaveDays: leaveTaken,
        lateCount, earlyCount, otMins, totalWorkedMins,
        lateMinsTotal, earlyMinsTotal, avgLateMins, avgEarlyMins,
        attRate, punctualScore, isPerfect,
      };
    });

    const sortDesc = (key) => [...allStats].sort((a, b) => b[key] - a[key]);
    const sortAsc  = (key) => [...allStats].sort((a, b) => a[key] - b[key]);

    const top5 = (arr, minKey, minVal=1) => arr.filter(s => s[minKey] >= minVal).slice(0, 5);

    const rankings = {
      mostPunctual  : top5(sortDesc('punctualScore'), 'presentDays', 1),
      leastPunctual : sortAsc('attRate').filter(s => s.totalWorkingDays > 0).slice(0, 5),
      mostLate      : top5(sortDesc('lateCount'),    'lateCount',    1),
      mostEarlyOut  : top5(sortDesc('earlyCount'),   'earlyCount',   1),
      mostLeave     : top5(sortDesc('leaveDays'),    'leaveDays',    1),
      mostAbsent    : top5(sortDesc('absentDays'),   'absentDays',   1),
      mostOT        : top5(sortDesc('otMins'),       'otMins',       1),
      perfectAtt    : allStats.filter(s => s.isPerfect).sort((a,b)=>b.presentDays-a.presentDays),
    };

    // Department summary — denominator uses sum of each staff's own working days
    const deptMap = {};
    for (const s of allStats) {
      const d = s.department;
      if (!deptMap[d]) deptMap[d] = { dept: d, staff:0, present:0, absent:0, leave:0, late:0, totalWorkDays:0 };
      deptMap[d].staff++;
      deptMap[d].present       += s.presentDays;
      deptMap[d].absent        += s.absentDays;
      deptMap[d].leave         += s.leaveDays;
      deptMap[d].late          += s.lateCount;
      deptMap[d].totalWorkDays += s.totalWorkingDays;  // sum of each member's own working days
    }
    const deptStats = Object.values(deptMap).map(d => ({
      ...d,
      attRate: d.totalWorkDays > 0
        ? Math.round(((d.present + d.leave) / d.totalWorkDays) * 100) : 0,
    })).sort((a,b) => b.attRate - a.attRate);

    const summary = {
      totalStaff       : allStats.length,
      totalWorkingDays : globalWorkingDays,   // full-year count for reference
      grandPresent     : allStats.reduce((s,e)=>s+e.presentDays, 0),
      grandAbsent      : allStats.reduce((s,e)=>s+e.absentDays,  0),
      grandLeave       : allStats.reduce((s,e)=>s+e.leaveDays,   0),
      grandLate        : allStats.reduce((s,e)=>s+e.lateCount,   0),
      grandOTHrs       : Math.round(allStats.reduce((s,e)=>s+e.otMins, 0) / 60),
      avgAttRate       : allStats.length > 0 ? Math.round(allStats.reduce((s,e)=>s+e.attRate,0)/allStats.length) : 0,
      perfectCount     : allStats.filter(s=>s.isPerfect).length,
    };

    res.json({ year: adYear, summary, rankings, deptStats, monthlyTrend, allStats });
  } catch (err) {
    logError('[attendance/yearly-analytics]', err);
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€ POST /remark — save an attendance reason for a specific employee+date â”€â”€â”€â”€â”€â”€
router.post('/remark', async (req, res) => {
  const { employeeId, date, reason, type = 'late_early' } = req.body;
  if (!employeeId || !date || !reason) {
    return res.status(400).json({ error: 'employeeId, date and reason are required' });
  }
  try {
    const r = await pool.query(`
      INSERT INTO attendance_remarks (employee_id, date, reason, type)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (employee_id, date, type)
      DO UPDATE SET reason = EXCLUDED.reason, created_at = NOW()
      RETURNING *
    `, [employeeId, date, reason, type]);
    res.json(r.rows[0]);
  } catch (err) {
    logError('[attendance/remark POST]', err);
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€ GET /remarks — get all remarks for a date range â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/remarks', async (req, res) => {
  const { startDate, endDate, employeeId } = req.query;
  try {
    let q = `SELECT employee_id, date, reason, type FROM attendance_remarks WHERE 1=1`;
    const params = [];
    if (startDate) { params.push(startDate); q += ` AND date >= $${params.length}`; }
    if (endDate)   { params.push(endDate);   q += ` AND date <= $${params.length}`; }
    if (employeeId){ params.push(employeeId); q += ` AND employee_id = $${params.length}`; }
    q += ' ORDER BY date, employee_id';
    const r = await pool.query(q, params);
    // Return as map: { "empId-YYYY-MM-DD": reason }
    const map = {};
    r.rows.forEach(row => {
      map[`${row.employee_id}-${row.date instanceof Date ? row.date.toISOString().split('T')[0] : row.date}`] = row.reason;
    });
    res.json(map);
  } catch (err) {
    logError('[attendance/remarks GET]', err);
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€ GET /live — Server-Sent Events stream for real-time punch notifications â”€â”€â”€
router.get('/live', (req, res) => {
  const cleanup = registerClient(res);
  req.on('close', cleanup);
});

// â”€â”€ POST /notify-punch — called internally by ZKTeco service after saving a log â”€
router.post('/notify-punch', async (req, res) => {
  const { employeeId, checkTime } = req.body;
  if (!employeeId || !checkTime) return res.json({ ok: false });
  try {
    const notification = await buildPunchNotification(employeeId, checkTime);
    if (notification) broadcastNotification(notification);
    res.json({ ok: true });
  } catch (e) {
    logError('[notify-punch]', e);
    res.json({ ok: false });
  }
});

// ── Manual Postings CRUD ─────────────────────────────────────────────────────

router.get('/manual-postings', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        mp.id, mp.date, mp.check_in, mp.check_out, mp.remark,
        mp.created_at, mp.updated_at,
        mp.employee_id       AS "employeeId",
        mp.recommended_by    AS "recommendedById",
        mp.approved_by       AS "approvedById",
        u.full_name          AS "fullName",
        u.employee_id        AS "staffId",
        cb.full_name         AS "createdBy",
        rb.full_name         AS "recommendedByName",
        ab.full_name         AS "approvedByName"
      FROM attendance_manual_postings mp
      JOIN  users u  ON u.id = mp.employee_id
      LEFT JOIN users cb ON cb.id = mp.created_by
      LEFT JOIN users rb ON rb.id = mp.recommended_by
      LEFT JOIN users ab ON ab.id = mp.approved_by
      ORDER BY mp.date DESC, u.full_name ASC
    `);
    res.json(rows);
  } catch (e) {
    logError('[manual-postings GET]', e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/manual-postings', async (req, res) => {
  const { employeeId, date, checkIn, checkOut, remark, recommendedBy, approvedBy } = req.body;
  if (!employeeId || !date) return res.status(400).json({ error: 'Employee and date are required' });
  try {
    const { rows } = await pool.query(`
      INSERT INTO attendance_manual_postings
        (employee_id, date, check_in, check_out, remark, recommended_by, approved_by, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *
    `, [employeeId, date, checkIn || null, checkOut || null, remark || null,
        recommendedBy || null, approvedBy || null, req.user?.id || null]);
    res.status(201).json(rows[0]);
  } catch (e) {
    logError('[manual-postings POST]', e);
    res.status(500).json({ error: e.message });
  }
});

router.put('/manual-postings/:id', async (req, res) => {
  const { employeeId, date, checkIn, checkOut, remark, recommendedBy, approvedBy } = req.body;
  try {
    const { rows } = await pool.query(`
      UPDATE attendance_manual_postings
      SET employee_id=$1, date=$2, check_in=$3, check_out=$4, remark=$5,
          recommended_by=$6, approved_by=$7, updated_at=NOW()
      WHERE id=$8 RETURNING *
    `, [employeeId, date, checkIn || null, checkOut || null, remark || null,
        recommendedBy || null, approvedBy || null, req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) {
    logError('[manual-postings PUT]', e);
    res.status(500).json({ error: e.message });
  }
});

router.delete('/manual-postings/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM attendance_manual_postings WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    logError('[manual-postings DELETE]', e);
    res.status(500).json({ error: e.message });
  }
});

export default router;

