/**
 * Attendance Routes
 * GET /api/attendance/daily?date=YYYY-MM-DD
 * Returns all active staff with their attendance data for the given date.
 */
import express from 'express';
import pool    from '../db.js';
import { registerClient, broadcastNotification } from '../services/liveNotifications.js';
import { buildPunchNotification }                from '../services/punchNotification.js';
import { logError } from '../utils/logError.js';

// A DATE column value (JS Date at local midnight, or a string) as 'YYYY-MM-DD'.
const dateOnlyStr = (v) => !v ? null : (v instanceof Date
  ? `${v.getFullYear()}-${String(v.getMonth()+1).padStart(2,'0')}-${String(v.getDate()).padStart(2,'0')}`
  : String(v).slice(0, 10));
import { resolveEmployeeScope } from './attendanceScope.js';
import { resolveOrgEmployeeIds, canManagerManualPost } from './orgScope.js';
import { notifyUsers } from '../services/internalMessages.js';
import { notifyApproversOf, notifyApplicantOf } from '../services/approvalNotify.js';
import { sendMissingAttendanceApplication, sendManualPostingApplication } from '../services/emailService.js';
import { requireRole } from '../middleware/roleGuard.js';
import { logAudit } from '../services/auditLog.js';
import { authorizeRecoAction, authorizeOwnEditDelete } from '../services/recoApprovalGuard.js';

const router = express.Router();

// â”€â”€ helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const pad2 = (n) => String(Math.round(n)).padStart(2, '0');
const minsToHHMM = (mins) => `${pad2(Math.floor(mins / 60))}:${pad2(mins % 60)}`;

// Nepal is UTC+5:45 — shift times stored as Nepal local, punches stored as UTC.
// This converts a Nepal-local HH:MM on a given date to the equivalent UTC Date object.
// Exported for attendanceNotificationScheduler.js, which needs the same
// conversion to know when "N minutes after shift start/end" has elapsed.
export const NEPAL_MS = (5 * 60 + 45) * 60000; // 345 min in ms
export const shiftToUTC = (y, m, d, h, min) => new Date(Date.UTC(y, m - 1, d, h, min) - NEPAL_MS);

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
 * Returns a Map of employee_id → total APPROVED OT minutes across the whole
 * range — the true "Total OT that has been approved" figure the OT Approval
 * page itself reports, unlike the per-report OT figures elsewhere in this
 * file which only accumulate OT on days that also independently tripped a
 * raw late-checkout/present condition (missing e.g. a weekend/holiday OT
 * grant that doesn't hit that condition). Exported for the report routes
 * below that need a correct period total rather than a per-day value.
 */
export const loadApprovedOTSumMap = async (startDate, endDate) => {
  try {
    const { rows } = await pool.query(
      // OT dated before the staff's Attendance Date is never counted.
      `SELECT o.employee_id, COALESCE(SUM(o.ot_minutes), 0)::int AS total
       FROM overtime_approvals o
       LEFT JOIN users u ON u.id = o.employee_id
       WHERE o.status = 'approved' AND o.date BETWEEN $1 AND $2
         AND (u.attendance_date IS NULL OR o.date >= u.attendance_date)
       GROUP BY o.employee_id`,
      [startDate, endDate]
    );
    const m = new Map();
    rows.forEach(r => m.set(r.employee_id, r.total || 0));
    return m;
  } catch {
    return new Map();
  }
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

// Case/whitespace-insensitive match against a Public Holiday's scope array
// (Settings → Public Holiday's Gender/Branch/Department/Religion/Handicapped
// dropdowns) — an empty array or the special 'All' entry means unscoped,
// i.e. matches every employee. `empValue` may be null (no employee given, or
// the employee has no value for that field), which only matches an unscoped
// entry. `idToNameMap` (Map<string,string>) resolves a scope entry that's a
// lookup-table id to its name before comparing — the Branch/Department/
// Religion dropdowns in Settings → Public Holiday save the record's id, not
// its name (see PublicHolidaySection's branchOpts/deptOpts/religionOpts in
// Settings.jsx), while users.branch/department/religion store the name —
// without resolving through this map, a holiday scoped to any specific
// branch/department/religion (anything other than "All") could never match
// anyone. Omit it for scope fields that are already plain label values
// (Gender, Handicapped) — there's no id to resolve.
const holidayScopeMatches = (scopeArr, empValue, idToNameMap = null) => {
  if (!scopeArr || !scopeArr.length || scopeArr.includes('All')) return true;
  if (empValue == null || empValue === '') return false;
  const norm = (v) => String(v).toLowerCase().trim();
  const resolved = idToNameMap ? scopeArr.map(v => idToNameMap.get(String(v)) || v) : scopeArr;
  return resolved.some(v => norm(v) === norm(empValue));
};

// Cheap in-process cache for the Branch/Department/Religion id→name lookups
// holidayScopeMatches needs above — these lookup lists rarely change, so a
// short TTL avoids 3 extra queries on every single report request.
let _holidayScopeLookupCache   = null;
let _holidayScopeLookupCacheAt = 0;
const loadHolidayScopeLookups = async () => {
  if (_holidayScopeLookupCache && (Date.now() - _holidayScopeLookupCacheAt) < 60_000) {
    return _holidayScopeLookupCache;
  }
  const [bRes, dRes, rRes] = await Promise.all([
    pool.query('SELECT id, name FROM branches'),
    pool.query('SELECT id, name FROM departments'),
    pool.query('SELECT id, name FROM religions'),
  ]);
  const toMap = (rows) => new Map(rows.map(r => [String(r.id), r.name]));
  _holidayScopeLookupCache = {
    branchNameById:   toMap(bRes.rows),
    deptNameById:     toMap(dRes.rows),
    religionNameById: toMap(rRes.rows),
  };
  _holidayScopeLookupCacheAt = Date.now();
  return _holidayScopeLookupCache;
};

// Returns holiday name if dateStr falls within a configured public holiday
// AND `emp` is within that holiday's scope, else null. Each scope field
// defaults to ['All'] (everyone) in Settings → Public Holiday, so an
// unscoped holiday still matches every employee same as before — only a
// holiday scoped to e.g. Gender=Female now excludes everyone else. `emp` is
// optional: {gender, branch, department, religion, handicapped}; omitting it
// (no employee in view yet) only matches fully-unscoped holidays. Async —
// loads the id→name lookups once (cached) — so every call site now does
// `await makeHolidayChecker(publicHolidays)` instead of a plain call.
const makeHolidayChecker = async (holidays) => {
  const { branchNameById, deptNameById, religionNameById } = await loadHolidayScopeLookups();
  return (dateStr, emp = null) => {
    const h = holidays.find(ph => {
      if (!ph.startDate || !ph.endDate || dateStr < ph.startDate || dateStr > ph.endDate) return false;
      return holidayScopeMatches(ph.gender,      emp?.gender)
          && holidayScopeMatches(ph.branch,      emp?.branch,     branchNameById)
          && holidayScopeMatches(ph.department,  emp?.department, deptNameById)
          && holidayScopeMatches(ph.religion,    emp?.religion,   religionNameById)
          && holidayScopeMatches(ph.handicapped, emp ? (emp.handicapped ? 'Yes' : 'No') : null);
    });
    return h?.name || null;
  };
};

// â”€â”€ Duty roster rotation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// A roster row can carry more than one shift (Create/Edit Roster's multi-select) —
// shiftIds is the selection in the order checked, and the shift that applies on
// any given date within [dateFrom, dateTo] cycles through that list one-per-day
// starting at dateFrom (day 0 = shiftIds[0], day 1 = shiftIds[1], ... wrapping).
// A single-shift roster (shiftIds.length === 1) always resolves to that one shift,
// same as before multi-select existed.
function loadShiftsById(rows) {
  const map = {};
  for (const s of rows) {
    map[s.id] = {
      id: s.id,
      name: s.name,
      startTime: s.start_time?.toString().substring(0, 5) || null,
      endTime:   s.end_time?.toString().substring(0, 5)   || null,
      graceSt:   s.grace_period_start ?? 0,
      graceEd:   s.grace_period_end   ?? 0,
      workHours: s.work_hours || 8,
      // System Day Off / Night Off are is_off=true. A tenant can also create its own
      // zero-length off shift (00:00–00:00, name contains "off", e.g. "Due Day Off") —
      // the roster screen already shows those as off, so reports/ledgers must too.
      isSystemOff: !!s.is_off,
      isOff:     !!s.is_off || (/off/i.test(s.name || '') && String(s.start_time || '').substring(0, 5) === String(s.end_time || '').substring(0, 5)),
      winterPolicyEnabled: !!s.winter_policy_enabled,
      winterPolicy:        s.winter_policy || null,
    };
  }
  return map;
}

// Looks up an is_off=true shift by name convention among all configured
// shifts — used to resolve Create Roster (Staff Wise)'s day-of-week Day
// Off/Night Off checkboxes to an actual shift (so its time-fields/name
// apply exactly like the Department Wise per-day shift picker's explicit
// selection would), without needing the UI to also pick a specific shift id.
// 'night' matches any is_off shift whose name contains "night"; 'day'
// matches the first is_off shift that does NOT — same /night/i convention
// already used elsewhere (e.g. Present/Absent Report's DO/NO split).
function findOffShiftByType(shiftsById, type) {
  const offShifts = Object.values(shiftsById).filter(s => s.isSystemOff);
  if (type === 'night') return offShifts.find(s => /night/i.test(s.name)) || null;
  return offShifts.find(s => !/night/i.test(s.name)) || null;
}

// What an off day is called on reports. The two system shifts keep their classic
// 'Day Off' / 'Night Off' names; a tenant's own off shift (e.g. "Due Day Off") reports
// under its own name so it shows exactly as picked in the roster.
const offTypeName = (shiftName) => {
  const n = String(shiftName || '').trim();
  if (n === 'Day Off' || n === 'Night Off') return n;
  if (!n) return 'Day Off';
  return n;
};
// Short on-grid label: "Day Off"→"D/O", "Night Off"→"N/O" inside the name ("Due Day Off" → "Due D/O").
const offShortLabel = (shiftName) => String(shiftName || '').split('Night Off').join('N/O').split('Day Off').join('D/O');

function resolveRotationShift(entry, dateStr, shiftsById) {
  const ids = (entry.shiftIds && entry.shiftIds.length) ? entry.shiftIds : (entry.shiftId ? [entry.shiftId] : []);
  if (!ids.length) return null;
  const dayIndex = Math.round((new Date(dateStr) - new Date(entry.dateFrom)) / 86400000);
  const idx = ((dayIndex % ids.length) + ids.length) % ids.length; // safe for any sign
  const shift = shiftsById[ids[idx]] || null;
  if (!shift) return null;
  // Apply the shift's own Winter Facilities Policy override (if any) for
  // this specific date — see resolveWinterShift() below. Returns a copy so
  // the cached shiftsById entry (reused across every date it's rotated to)
  // is never mutated.
  const eff = resolveWinterShift(dateStr, shift.startTime, shift.endTime, shift.graceSt, shift.graceEd,
                                  shift.winterPolicyEnabled, shift.winterPolicy);
  return { ...shift, startTime: eff.shiftStart, endTime: eff.shiftEnd, graceSt: eff.graceStart, graceEd: eff.graceEnd };
}

// Among roster entries that all directly cover the same date (e.g. a
// single-day Calendar View override landing inside a broader date-range
// roster), the most specific one should win — the narrower the date span,
// the more deliberately targeted it is. Ties (equal span) break toward the
// most recently created (highest id).
function pickMostSpecificEntry(candidates) {
  if (candidates.length <= 1) return candidates[0] || null;
  const span = (e) => (new Date(e.dateTo) - new Date(e.dateFrom));
  return candidates.slice().sort((a, b) => span(a) - span(b) || (b.id || 0) - (a.id || 0))[0];
}

// Company Settings → "Log Duration for Time Out (Minutes)" — punches within
// this many minutes of a shift-day's first punch are never taken as its time
// out. Devices often record one finger/face press as 2-3 logs seconds apart
// (seen on Eastern: every punch doubled ~3s apart); without this the
// duplicate became the "time out", so a day with only a check-in showed
// IN = OUT. 0/unset keeps the previous behaviour.
export const loadTimeOutMinGap = async () => {
  try {
    const { rows } = await pool.query("SELECT value FROM app_settings WHERE key='main'");
    let main = rows[0]?.value;
    if (typeof main === 'string') { try { main = JSON.parse(main); } catch { main = null; } }
    const n = parseInt(main?.timeOutMinGapMinutes, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch { return 0; }
};

// â”€â”€ Load all duty roster entries overlapping a date range â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Returns map: empId â†’ [ { dateFrom, dateTo, offDays, shiftIds, shiftId } ], plus a
// non-enumerable _shiftsById lookup (shift id â†’ resolved fields) that
// getEffectiveRoster() uses to resolve the correct day's shift via rotation —
// attached to the map itself so callers don't need to thread a second value
// through everywhere loadRosterMap() is already called. _timeOutMinGap rides
// along the same way for bucketPunchesByShiftDay (see loadTimeOutMinGap).
export const loadRosterMap = async (startDate, endDate) => {
  try {
    const [rosterRes, shiftsRes, timeOutMinGap] = await Promise.all([
      pool.query(`
        SELECT dr.id,
               dr.employee_id,
               dr.date_from::text  AS date_from,
               dr.date_to::text    AS date_to,
               dr.off_days,
               dr.day_off_days,
               dr.night_off_days,
               dr.shift_id,
               dr.shift_ids
        FROM   duty_roster dr
        WHERE  (dr.date_from <= $2 AND dr.date_to >= $1)
            OR dr.id IN (
                 SELECT DISTINCT ON (employee_id) id
                 FROM   duty_roster
                 WHERE  date_to < $1
                 ORDER  BY employee_id, date_to DESC, created_at DESC
               )
        ORDER  BY dr.employee_id, dr.date_to DESC
      `, [startDate, endDate]),
      pool.query(`SELECT id, name, start_time, end_time, grace_period_start, grace_period_end, work_hours, is_off, winter_policy_enabled, winter_policy FROM shifts`),
      loadTimeOutMinGap(),
    ]);
    const map = {};
    for (const r of rosterRes.rows) {
      if (!map[r.employee_id]) map[r.employee_id] = [];
      map[r.employee_id].push({
        id:            r.id,
        dateFrom:      String(r.date_from).split('T')[0],
        dateTo:        String(r.date_to).split('T')[0],
        offDays:       Array.isArray(r.off_days)       ? r.off_days       : [],
        dayOffDays:    Array.isArray(r.day_off_days)   ? r.day_off_days   : [],
        nightOffDays:  Array.isArray(r.night_off_days) ? r.night_off_days : [],
        shiftIds: Array.isArray(r.shift_ids) ? r.shift_ids : (r.shift_id ? [r.shift_id] : []),
        shiftId:  r.shift_id,
      });
    }
    Object.defineProperty(map, '_shiftsById', { value: loadShiftsById(shiftsRes.rows), enumerable: false });
    Object.defineProperty(map, '_timeOutMinGap', { value: timeOutMinGap, enumerable: false });
    return map;
  } catch { return {}; }
};

// Returns the roster entry active for empId on dateStr (or the most recent
// past one as a fallback), resolved to THAT date's effective shift — same
// flat shape report code has always read (shiftName/shiftStart/shiftEnd/
// graceSt/graceEd/workHours/offDays), plus isOff for Day Off/Night Off.
// Returns null if there's no roster entry at all for this employee.
export const getEffectiveRoster = (rosterMap, empId, dateStr) => {
  const entries = rosterMap[empId] || [];
  const covering = entries.filter(e => e.dateFrom <= dateStr && e.dateTo >= dateStr);
  const exact = pickMostSpecificEntry(covering);
  const entry = exact ||
                entries.filter(e => e.dateTo < dateStr).sort((a, b) => b.dateTo.localeCompare(a.dateTo))[0] ||
                null;
  if (!entry) return null;
  const shiftsById = rosterMap._shiftsById || {};
  // Create Roster (Staff Wise)'s day-of-week Day Off/Night Off checkboxes —
  // a recurring pattern across the whole date range, same as offDays/Weekend
  // already was, just distinguishing which kind of off day it is. Only
  // honored for an entry that actually covers dateStr (exact), never the
  // most-recent-past fallback, same reasoning as isOff below. Night Off
  // checked wins over Day Off if a day-of-week were ever marked under both.
  let shift = null;
  if (exact) {
    const [gy, gm, gd] = dateStr.split('-').map(Number);
    const dayKey = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(gy, gm - 1, gd).getDay()];
    if (entry.nightOffDays?.includes(dayKey))    shift = findOffShiftByType(shiftsById, 'night');
    else if (entry.dayOffDays?.includes(dayKey)) shift = findOffShiftByType(shiftsById, 'day');
  }
  if (!shift) shift = resolveRotationShift(entry, dateStr, shiftsById);
  return {
    dateFrom: entry.dateFrom, dateTo: entry.dateTo, offDays: entry.offDays,
    shiftId:    shift?.id        ?? null,
    shiftName:  shift?.name      ?? null,
    shiftStart: shift?.startTime ?? null,
    shiftEnd:   shift?.endTime   ?? null,
    graceSt:    shift?.graceSt   ?? 0,
    graceEd:    shift?.graceEd   ?? 0,
    workHours:  shift?.workHours ?? 8,
    // Day Off/Night Off is a specific date-range designation, not an ongoing
    // pattern — only honor it when this entry actually covers dateStr, never
    // when it's being used as a "last known shift" fallback for a future date
    // past its range (otherwise a single-day Day Off would mark every day
    // after it as off too, forever, until the next roster entry is created).
    isOff:      exact ? !!shift?.isOff : false,
    // Same "actually covers dateStr, not a stale past fallback" distinction
    // as isOff above — isRosterWeekend uses this to know whether the roster
    // is authoritative for this exact date, or whether it's just the most
    // recent shift on file with nothing really scheduled here.
    hasExactEntry: !!exact,
  };
};

// Once a roster entry actually covers this date, it's authoritative for
// whether the day is off — the company-wide weekend pattern (Settings →
// Weekend Management) only fills in when there's no roster override for
// this date at all. Previously a roster-assigned working day still showed
// as "Weekend" whenever it fell on the company's Sat/Sun pattern (unless
// that specific roster entry also carried its own recurring offDays), so a
// staff member roster'd to actually work a Saturday still had that Saturday
// reported as Weekend in every attendance report — the roster's Day
// Off/Night Off assignments are what make a day "weekend" for that staff
// member once a roster is set, not the calendar day of week.
//
// That fix over-corrected one case: `roster.offDays` empty doesn't
// necessarily mean "this person has zero weekly offs" — the common case is
// a roster entry that only assigned a shift/rotation (e.g. via the bulk
// dept-wise roster tool) without ever touching the weekly-off pattern at
// all. Treating an empty offDays list as "never off" made every Sat/Sun
// report as a working day with no punch, i.e. AB instead of Weekend, for
// any staff with a roster but no explicit weekly-off configured. Only defer
// to the roster's offDays when it actually lists some; an empty list still
// falls back to the company weekend pattern.
export function isRosterWeekend(roster, dayKey, weekends, defaultShiftId) {
  if (roster?.isOff) return true;
  if (roster?.hasExactEntry && roster.offDays?.length > 0) {
    return roster.offDays.includes(dayKey);
  }
  return weekends.includes(dayKey);
}

// Groups raw punch timestamps into "shift-days" instead of plain calendar
// dates — needed because a shift that crosses midnight (e.g. 18:00-02:00)
// splits one overnight session across two calendar dates, and every report
// that used to just GROUP BY check_time::date paired the wrong punches
// together (a morning checkout landing on day N+1 got matched with day
// N+1's own evening check-in, producing a nonsensical ~12h "shift" while
// day N showed a check-in with no checkout at all).
//
// Rule: a punch before noon rolls back onto the PREVIOUS calendar date when
// that previous date's effective shift for this employee crosses midnight
// (shiftEnd < shiftStart) — i.e. it's the tail end of last night's session,
// not a fresh same-day check-in. Everything else groups by its own plain
// calendar date, same as before.
//
// Unrostered overnight: the roster doesn't always match the shift actually
// worked (Eastern, 12-Ashwin-2083: rostered 06AM-02PM, actually worked
// 18:03 → 05:53 next morning). A morning punch also rolls back when the
// previous day holds only an evening check-in still waiting for its time
// out — at/after noon AND at/after that day's own shift end, so it can't be
// a late arrival for that day's shift — and the morning punch comes 4-16h
// after it. Duplicates right behind a rolled-back punch follow it.
//
// Known limitation: on the exact day a roster transitions from a night
// shift to a day shift, an early check-in for the new day shift could still
// misattribute back a day if it lands before noon — a rotation-boundary
// edge case, not the general case this fixes.
//
// punchTimestamps: Date/timestamptz values for ONE employee, any source.
// Returns Map<'YYYY-MM-DD', { timeIn: Date, timeOut: Date, punchCount }>.
export function bucketPunchesByShiftDay(punchTimestamps, empId, rosterMap, defaultShift) {
  const buckets = new Map();
  const shiftCache = new Map();
  const gapMs = (rosterMap?._timeOutMinGap || 0) * 60000;
  // Punches this close together count as one press for the overnight rule.
  const clusterMs = Math.max(gapMs, 5 * 60000);

  const shiftTimes = (dateStr) => {
    if (shiftCache.has(dateStr)) return shiftCache.get(dateStr);
    const roster = getEffectiveRoster(rosterMap, empId, dateStr);
    const start = roster?.shiftStart || defaultShift?.start_time?.toString().substring(0, 5);
    const end   = roster?.shiftEnd   || defaultShift?.end_time?.toString().substring(0, 5);
    const t = { start, end, crosses: !!(start && end && end < start) };
    shiftCache.set(dateStr, t);
    return t;
  };
  const shiftCrossesMidnight = (dateStr) => shiftTimes(dateStr).crosses;
  const localHHMM = (ts) => new Date(ts.getTime() + NEPAL_MS).toISOString().slice(11, 16);

  // Is `prev`'s bucket an evening check-in still open for this morning punch?
  const openOvernight = (prevDateStr, ts) => {
    const b = buckets.get(prevDateStr);
    if (!b) return false;
    if (b._overnightOut) return ts - b._overnightOut <= clusterMs; // duplicate of the out
    if (b._all.some(t => t - b.timeIn > clusterMs)) return false;   // already has a time out
    // Must start well after that day's own shift ended (2h+), not just after
    // it — a day worker who forgot to punch in leaves a lone check-OUT at
    // ~shift end, which would otherwise swallow the next morning's check-in
    // and cascade one day off for the rest of the range. Off/unknown shift:
    // 16:00 or later.
    const toMin = (hhmm) => +hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5);
    const inMin = toMin(localHHMM(b.timeIn));
    const { end } = shiftTimes(prevDateStr);
    const minStart = end && end !== '00:00' ? Math.max(toMin(end) + 120, 12 * 60) : 16 * 60;
    if (inMin < minStart) return false;
    const gap = ts - b.timeIn;
    return gap >= 4 * 3600000 && gap <= 16 * 3600000;
  };

  const sorted = punchTimestamps.filter(Boolean)
    .map(raw => (raw instanceof Date ? raw : new Date(raw)))
    .sort((a, b) => a - b);

  for (const ts of sorted) {
    // Nepal-local calendar date this instant falls on — shift forward by
    // the Nepal offset and read UTC fields, mirroring shiftToUTC's inverse,
    // so this doesn't depend on the server OS's own timezone setting.
    const local = new Date(ts.getTime() + NEPAL_MS);
    const Y = local.getUTCFullYear(), M = local.getUTCMonth() + 1, D = local.getUTCDate();
    let dateStr = `${Y}-${String(M).padStart(2, '0')}-${String(D).padStart(2, '0')}`;

    const noon = shiftToUTC(Y, M, D, 12, 0);
    if (ts < noon) {
      const prevDateStr = new Date(Date.UTC(Y, M - 1, D - 1)).toISOString().split('T')[0];
      if (shiftCrossesMidnight(prevDateStr)) dateStr = prevDateStr;
      else if (openOvernight(prevDateStr, ts)) {
        dateStr = prevDateStr;
        buckets.get(prevDateStr)._overnightOut = ts;
      }
    }

    const bucket = buckets.get(dateStr) || { timeIn: null, timeOut: null, punchCount: 0, _all: [] };
    if (!bucket.timeIn  || ts < bucket.timeIn)  bucket.timeIn  = ts;
    if (!bucket.timeOut || ts > bucket.timeOut) bucket.timeOut = ts;
    bucket.punchCount++;
    bucket._all.push(ts);
    buckets.set(dateStr, bucket);
  }

  // Log Duration for Time Out — drop punches within the gap of the first
  // punch from time-out consideration. A day left with nothing past the gap
  // gets the exact shape a genuine single-punch day already has (count 1,
  // out = in), which every caller already reads as "no time out".
  for (const bucket of buckets.values()) {
    if (gapMs) {
      const outs = bucket._all.filter(t => t - bucket.timeIn >= gapMs);
      bucket.punchCount = 1 + outs.length;
      bucket.timeOut = outs.length ? bucket.timeOut : bucket.timeIn;
    }
    delete bucket._all;
    delete bucket._overnightOut;
  }
  return buckets;
}

// ── Winter Facilities Policy — a shift can carry an alternate start/end time
// + grace periods that apply only within a configured [startDate, endDate]
// AD-date range (e.g. 10:00-17:00 normally, 10:00-16:00 in winter); outside
// that range (or when the policy is off/unset) the shift's normal resolved
// start/end/grace apply unchanged. `date` and the policy's startDate/endDate
// are all plain 'YYYY-MM-DD' AD strings, so they compare lexicographically.
export function resolveWinterShift(date, shiftStart, shiftEnd, graceStart, graceEnd, winterPolicyEnabled, winterPolicy) {
  const normal = { shiftStart, shiftEnd, graceStart, graceEnd };
  if (!winterPolicyEnabled || !winterPolicy) return normal;
  const wp = typeof winterPolicy === 'string' ? JSON.parse(winterPolicy) : winterPolicy;
  if (!wp?.startDate || !wp?.endDate) return normal;
  if (date < wp.startDate || date > wp.endDate) return normal;
  return {
    shiftStart : wp.startTime || shiftStart,
    shiftEnd   : wp.endTime   || shiftEnd,
    graceStart : wp.gracePeriodStart ?? graceStart,
    graceEnd   : wp.gracePeriodEnd   ?? graceEnd,
  };
}

// ── Core per-day attendance computation (shared by the /daily route and the
//    daily notification scheduler — single source of truth for
//    Present/Absent/Late/Early classification) ───────────────────────────────────────
export async function computeDailyAttendance(date) {
    // â”€â”€ 1. Effective weekends + public holidays for the date â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const [wkRes, publicHolidays] = await Promise.all([
      pool.query(`SELECT weekends FROM weekend_history WHERE effective_date <= $1 ORDER BY effective_date DESC, id DESC LIMIT 1`, [date]),
      loadPublicHolidays(),
    ]);
    const weekends    = wkRes.rows[0]?.weekends || ['Sat'];
    // Per-employee, not a single company-wide value — a holiday can be
    // scoped to a gender/branch/department/religion/handicapped subset (see
    // makeHolidayChecker), so this is resolved per row further down instead
    // of once here.
    const getHoliday  = await makeHolidayChecker(publicHolidays);

    const DOW_KEYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    // Use local interpretation of the date to avoid UTC-shift problems
    const [Y, M, D]  = date.split('-').map(Number);
    const datObj     = new Date(Y, M - 1, D);
    const dayKey     = DOW_KEYS[datObj.getDay()];
    const isWeekend  = weekends.includes(dayKey);

    // â”€â”€ 2. Main query: staff + shifts + leaves + visits (attendance punches
    //    are fetched + bucketed separately below — see step 2b — since a
    //    shift crossing midnight needs roster-aware shift-day bucketing that
    //    a plain `check_time::date = $1` filter can't express: the checkout
    //    for a shift starting on $1 lands on $1+1's calendar date and would
    //    be silently excluded by that filter). â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const { rows } = await pool.query(`
      WITH
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
        u.eligible_for_ot,
        u.gender,
        u.religion,
        u.handicapped,

        /* shift fields — roster shift > employee shift > default */
        COALESCE(rs.name,               s.name,               ds.name)               AS shift_name,
        COALESCE(rs.start_time,         s.start_time,         ds.start_time)         AS shift_start,
        COALESCE(rs.end_time,           s.end_time,           ds.end_time)           AS shift_end,
        COALESCE(rs.grace_period_start, s.grace_period_start, ds.grace_period_start, 0) AS grace_start,
        COALESCE(rs.grace_period_end,   s.grace_period_end,   ds.grace_period_end,   0) AS grace_end,
        COALESCE(rs.work_hours,         s.work_hours,         ds.work_hours,         8) AS work_hours,
        COALESCE(rs.winter_policy_enabled, s.winter_policy_enabled, ds.winter_policy_enabled, FALSE) AS winter_policy_enabled,
        COALESCE(rs.winter_policy,         s.winter_policy,         ds.winter_policy)         AS winter_policy,
        dr.off_days AS roster_off_days,
        dr.shift_id AS roster_shift_id,
        ds.id       AS default_shift_id,
        /* Day Off/Night Off only applies for a roster entry that actually
           covers this date (prio=1) — never carried forward from the
           most-recent-past fallback (prio=2), or a single-day Day Off would
           mark every subsequent day as off too, forever. */
        CASE WHEN dr.prio = 1 THEN COALESCE(rs.is_off OR (rs.name ILIKE '%off%' AND rs.start_time = rs.end_time), FALSE) ELSE FALSE END AS roster_is_off,
        /* Same prio=1 (actually covers this date, not the past fallback)
           distinction as roster_is_off above — isRosterWeekend uses this to
           know whether the roster is authoritative for this exact date. */
        COALESCE(dr.prio = 1, FALSE) AS roster_has_entry,

        /* post short name — fallback to first 5 chars of name */
        COALESCE(NULLIF(TRIM(p.short_name),''), LEFT(p.name,5))  AS post_short,
        p.name        AS post_full,

        /* dept short name — fallback to first 5 chars of name */
        COALESCE(NULLIF(TRIM(d.short_name),''), LEFT(d.name,5))  AS dept_short,
        d.name        AS dept_full,

        /* branch short name */
        COALESCE(NULLIF(TRIM(br.short_name),''), LEFT(br.name,4)) AS branch_short,
        br.name       AS branch_name,

        /* Attendance Date — absent/present counting starts here (not Join Date) */
        u.attendance_date::text AS att_start,

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
      LEFT   JOIN LATERAL (SELECT * FROM def_shift) ds ON TRUE
      LEFT   JOIN shifts      s   ON s.code  = u.shift
      /* duty roster: entry covering this date, or most recent past entry as fallback.
         shift_id resolves through shift_ids (rotation: cycles through the selected
         shifts one per day, starting at date_from) when set, falling back to the
         single shift_id column for older rows that predate multi-shift rosters. */
      LEFT   JOIN LATERAL (
        SELECT sub.off_days, sub.prio,
               CASE
                 /* Create Roster (Staff Wise)'s day-of-week Day Off/Night Off
                    checkboxes — a recurring pattern across the whole date
                    range, resolved the same way an explicit shift-rotation
                    pick would be (see getEffectiveRoster's identical logic in
                    JS). Only for an entry that actually covers this date
                    (prio=1), never the past-entry fallback. Night wins if a
                    day-of-week were ever marked under both. */
                 WHEN sub.prio = 1 AND sub.night_off_days ? to_char($1::date, 'Dy') THEN
                   (SELECT id FROM shifts WHERE is_off = TRUE AND name ILIKE '%night%' ORDER BY id LIMIT 1)
                 WHEN sub.prio = 1 AND sub.day_off_days ? to_char($1::date, 'Dy') THEN
                   (SELECT id FROM shifts WHERE is_off = TRUE AND name NOT ILIKE '%night%' ORDER BY id LIMIT 1)
                 WHEN sub.shift_ids IS NOT NULL AND jsonb_array_length(sub.shift_ids) > 0 THEN
                   (sub.shift_ids ->> MOD(MOD(($1::date - sub.date_from), jsonb_array_length(sub.shift_ids))
                                          + jsonb_array_length(sub.shift_ids), jsonb_array_length(sub.shift_ids)))::int
                 ELSE sub.shift_id
               END AS shift_id
        FROM (
          (SELECT dr2.off_days, dr2.day_off_days, dr2.night_off_days, dr2.shift_id, dr2.shift_ids, dr2.date_from, 1 AS prio
           FROM   duty_roster dr2
           WHERE  dr2.employee_id = u.id
             AND  $1::date BETWEEN dr2.date_from AND dr2.date_to
           /* Most specific (narrowest span) roster entry wins when more than
              one directly covers this date — e.g. a single-day Calendar View
              override landing inside a broader date-range roster. */
           ORDER  BY (dr2.date_to - dr2.date_from) ASC, dr2.created_at DESC LIMIT 1)
          UNION ALL
          (SELECT dr2.off_days, dr2.day_off_days, dr2.night_off_days, dr2.shift_id, dr2.shift_ids, dr2.date_from, 2 AS prio
           FROM   duty_roster dr2
           WHERE  dr2.employee_id = u.id
             AND  dr2.date_to < $1::date
           ORDER  BY dr2.date_to DESC, dr2.created_at DESC LIMIT 1)
        ) sub ORDER BY sub.prio LIMIT 1
      ) dr ON TRUE
      LEFT   JOIN shifts      rs  ON rs.id = dr.shift_id
      LEFT   JOIN LATERAL (SELECT * FROM posts WHERE name = u.position ORDER BY id LIMIT 1) p ON TRUE
      LEFT   JOIN LATERAL (SELECT * FROM departments WHERE name = u.department ORDER BY id LIMIT 1) d ON TRUE
      LEFT   JOIN LATERAL (SELECT * FROM branches WHERE name = u.branch ORDER BY id LIMIT 1) br ON TRUE
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
      ORDER  BY br.ranking_order ASC NULLS LAST, u.ranking_order ASC NULLS LAST, u.full_name ASC
    `, [date]);

    // â”€â”€ 2b. Attendance punches for this date, shift-day bucketed â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Widen by a day on each side: a shift starting the evening before
    // $1 needs $1-1 available so bucketPunchesByShiftDay can tell it was a
    // night shift, and one starting on $1 needs $1+1 for its own checkout.
    {
      const empIds = rows.map(r => r.id);
      if (empIds.length) {
        // Pure UTC-based date math (Date.UTC + JS's own day/month rollover)
        // — deliberately avoids new Date(dateString) + getDate()/setDate(),
        // which read/write LOCAL calendar fields and would silently shift by
        // a day depending on the server OS's own timezone (confirmed
        // America/Los_Angeles on this box, per db.js's own comment).
        const [Y, M, D] = date.split('-').map(Number);
        const rangeStart = new Date(Date.UTC(Y, M - 1, D - 1)).toISOString().split('T')[0];
        const rangeEnd   = new Date(Date.UTC(Y, M - 1, D + 1)).toISOString().split('T')[0];

        const [rawPunchRes, rosterMap, defShiftRes, otSumMap] = await Promise.all([
          pool.query(`
            SELECT employee_id, check_time FROM zkteco_attendance_logs
            WHERE  employee_id = ANY($1::int[]) AND check_time::date BETWEEN $2 AND $3
            UNION ALL
            SELECT employee_id, (date + check_in)::timestamp::timestamptz AS check_time
            FROM   attendance_manual_postings
            WHERE  employee_id = ANY($1::int[]) AND date BETWEEN $2 AND $3 AND check_in IS NOT NULL AND status = 'approved'
            UNION ALL
            SELECT employee_id, (date + check_out)::timestamp::timestamptz AS check_time
            FROM   attendance_manual_postings
            WHERE  employee_id = ANY($1::int[]) AND date BETWEEN $2 AND $3 AND check_out IS NOT NULL AND status = 'approved'
          `, [empIds, rangeStart, rangeEnd]),
          loadRosterMap(rangeStart, rangeEnd),
          pool.query(`SELECT * FROM shifts WHERE make_default = TRUE LIMIT 1`),
          loadApprovedOTSumMap(date, date),
        ]);
        const defaultShift = defShiftRes.rows[0];

        const punchesByEmp = new Map();
        for (const r of rawPunchRes.rows) {
          if (!punchesByEmp.has(r.employee_id)) punchesByEmp.set(r.employee_id, []);
          punchesByEmp.get(r.employee_id).push(r.check_time);
        }

        for (const row of rows) {
          const buckets = bucketPunchesByShiftDay(punchesByEmp.get(row.id) || [], row.id, rosterMap, defaultShift);
          const today = buckets.get(date);
          row.time_in     = today?.timeIn     ?? null;
          row.time_out    = today?.timeOut    ?? null;
          row.punch_count = today?.punchCount ?? null;
          row.ot_approved_mins = otSumMap.get(row.id) || 0;
        }
      }
    }

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
         WHERE  mp.date = $1 AND mp.status = 'approved'
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
    // ── 4. Compute derived fields (Late In, Early Out, OT, Status) per row ──
    // Staff whose Attendance Date is still ahead of this date aren't counted
    // (neither Present nor Absent), whatever punches/leaves exist.
    const computed = rows.filter(r => !(r.att_start && date < r.att_start)).map(r => {
      const {
        time_in, time_out,
        shift_start: rawShiftStart, shift_end: rawShiftEnd,
        grace_start: rawGraceStart, grace_end: rawGraceEnd, work_hours,
        winter_policy_enabled, winter_policy,
        leave_id, leave_type_name, visit_id, visit_purpose, visit_location,
        leave_appr_name, leave_reco_name, leave_reason, leave_comment,
        visit_appr_name, visit_reco_name,
        roster_off_days, roster_is_off, roster_shift_id, roster_has_entry, default_shift_id,
      } = r;

      // Scoped to this employee's gender/branch/department/religion/handicapped —
      // a holiday set up for e.g. Gender=Female only applies to female staff;
      // everyone else treats the date as a normal working day.
      const holidayName = getHoliday(date, r);

      // Winter Facilities Policy — swap in the shift's winter start/end/grace
      // when `date` falls inside the configured winter range.
      const { shiftStart: shift_start, shiftEnd: shift_end, graceStart: grace_start, graceEnd: grace_end } =
        resolveWinterShift(date, rawShiftStart, rawShiftEnd, rawGraceStart, rawGraceEnd, winter_policy_enabled, winter_policy);

      // Per-employee weekend: today's roster shift being Day Off/Night Off
      // (roster_is_off) always counts as weekend; otherwise, once a roster
      // entry actually covers this date (roster_has_entry), it's
      // authoritative over the company-wide weekend pattern — see
      // isRosterWeekend().
      const isEmpWeekend = isRosterWeekend(
        { isOff: roster_is_off, offDays: roster_off_days, shiftId: roster_shift_id, hasExactEntry: roster_has_entry },
        dayKey, weekends, default_shift_id,
      );

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
      // Day Off/Night Off is a specific roster designation, not just the
      // company-wide weekend pattern — show it as such instead of the
      // generic "Weekend" label. roster_is_off is already gated to a roster
      // entry actually covering this date (never a stale fallback), so
      // shift_name from the same resolved roster shift is safe to trust here.
      // Public Holiday takes priority over a same-day Leave record — the
      // day doesn't count as leave taken (it isn't a working day to begin
      // with regardless of the leave application), it's simply a holiday.
      // Leave detail is still preserved in remarks below either way.
      if (roster_is_off)        status = r.shift_name || 'Weekend';
      else if (isEmpWeekend)    status = 'Weekend';
      else if (time_in)         status = 'Present';
      else if (holidayName)     status = 'Public Holiday';
      else if (leave_id)        status = leave_type_name || 'Leave';
      // An approved Office Visit with no punch is its own outcome, not an
      // absence — this used to fall through to the 'Absent' default even
      // though `hasVisit` (below) was already correctly flagged, so the
      // Absent tab/tile silently counted every visit day too.
      else if (visit_id)        status = 'Office Visit';

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
        shiftStart          : shift_start || null,
        shiftEnd            : shift_end   || null,
        mode                : r.mode        || null,
        grade               : r.grade       || null,
        punchCount          : r.punch_count || 0,
        timeIn              : time_in  ? new Date(time_in).toISOString()  : null,
        timeOut             : (time_out && hasCheckOut) ? new Date(time_out).toISOString() : null,
        totalHrs,
        lateIn,
        earlyOut,
        ot,
        eligibleForOt       : !!r.eligible_for_ot,
        otApprovedMins      : r.ot_approved_mins || 0,
        otApprovedFormatted : r.eligible_for_ot && r.ot_approved_mins ? minsToHHMM(r.ot_approved_mins) : null,
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

    return { dayKey, isWeekend, weekends, rows: computed };
}

// ── GET /daily ──────────────────────────────────────────────────────
router.get('/daily', async (req, res) => {
  const date = (req.query.date || new Date().toISOString().split('T')[0]).trim();
  const { scopeEmployeeId, isScoped } = resolveEmployeeScope(req);
  try {
    const { dayKey, isWeekend, weekends, rows: computed } = await computeDailyAttendance(date);
    let scopedRows = isScoped
      ? computed.filter(r => String(r.id) === String(scopeEmployeeId))
      : computed;
    if (!isScoped && req.query.orgScope === '1') {
      const ids = await resolveOrgEmployeeIds(req);
      if (ids) scopedRows = computed.filter(r => ids.includes(r.id));
    }
    res.json({ date, dayKey, isWeekend, weekends, rows: scopedRows });
  } catch (err) {
    logError('[Attendance/daily]', err);
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€ GET /staff-ledger — individual staff attendance ledger â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/staff-ledger', async (req, res) => {
  const { scopeEmployeeId, isScoped } = resolveEmployeeScope(req, req.query.employeeId);
  const employeeId = isScoped ? scopeEmployeeId : parseInt(req.query.employeeId);

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
               s.grace_period_end AS grace_ed,
               s.winter_policy_enabled AS shift_winter_enabled, s.winter_policy AS shift_winter_policy
         FROM  users u
         LEFT  JOIN LATERAL (SELECT * FROM posts WHERE name = u.position ORDER BY id LIMIT 1) p ON TRUE
         LEFT  JOIN LATERAL (SELECT * FROM departments WHERE name = u.department ORDER BY id LIMIT 1) d ON TRUE
         LEFT  JOIN LATERAL (SELECT * FROM branches WHERE name = u.branch ORDER BY id LIMIT 1) br ON TRUE
         LEFT  JOIN shifts      s  ON s.code=u.shift
         WHERE u.id=$1`
      : `SELECT u.*, s.name AS shift_name, s.start_time AS shift_start,
               s.end_time AS shift_end, s.grace_period_start AS grace_st,
               s.grace_period_end AS grace_ed,
               s.winter_policy_enabled AS shift_winter_enabled, s.winter_policy AS shift_winter_policy
         FROM  users u
         LEFT  JOIN shifts s ON s.code=u.shift
         WHERE u.active=TRUE AND (u.is_system IS NOT TRUE AND u.role NOT IN ('superAdmin'))
         ORDER BY (SELECT MIN(b.ranking_order) FROM branches b WHERE b.name = u.branch) ASC NULLS LAST,
                  u.ranking_order ASC NULLS LAST, u.full_name ASC`;

    const empRes = await pool.query(empQ, employeeId ? [employeeId] : []);
    if (!empRes.rows.length) return res.json({ employee:null, days:[], summary:{} });
    const emp = empRes.rows[0];

    // â”€â”€ Weekends + public holidays â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const [wkRes, publicHolidays] = await Promise.all([
      pool.query(`SELECT weekends FROM weekend_history WHERE effective_date<=$1 ORDER BY effective_date DESC, id DESC LIMIT 1`, [endDate]),
      loadPublicHolidays(),
    ]);
    const weekends   = wkRes.rows[0]?.weekends || ['Sat'];
    const getHoliday = await makeHolidayChecker(publicHolidays);
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
    // Winter policy source: the employee's own shift if they have one, else the org default shift.
    const shiftWinterEnabled = emp.shift_start ? emp.shift_winter_enabled : defShift?.winter_policy_enabled;
    const shiftWinterPolicy  = emp.shift_start ? emp.shift_winter_policy  : defShift?.winter_policy;

    // â”€â”€ Duty roster entries for this employee in the period â”€â”€â”€â”€â”€â”€â”€
    const [rosterRes, ledgerShiftsRes] = await Promise.all([
      pool.query(`
        SELECT dr.id, dr.date_from::text AS date_from, dr.date_to::text AS date_to,
               dr.off_days, dr.day_off_days, dr.night_off_days,
               dr.shift_id, dr.shift_ids
        FROM   duty_roster dr
        WHERE  dr.employee_id = $1
          AND  ((dr.date_from <= $2 AND dr.date_to >= $3)
             OR dr.id = (SELECT id FROM duty_roster WHERE employee_id=$1 AND date_to < $3
                         ORDER BY date_to DESC, created_at DESC LIMIT 1))
        ORDER  BY dr.date_to DESC
      `, [emp.id, endDate, startDate]),
      pool.query(`SELECT id, name, start_time, end_time, grace_period_start, grace_period_end, work_hours, is_off, winter_policy_enabled, winter_policy FROM shifts`),
    ]);
    const ledgerShiftsById = loadShiftsById(ledgerShiftsRes.rows);
    const rosterEntries = rosterRes.rows.map(r => ({
      id:           r.id,
      dateFrom:     String(r.date_from).split('T')[0],
      dateTo:       String(r.date_to).split('T')[0],
      offDays:      Array.isArray(r.off_days)       ? r.off_days       : [],
      dayOffDays:   Array.isArray(r.day_off_days)   ? r.day_off_days   : [],
      nightOffDays: Array.isArray(r.night_off_days) ? r.night_off_days : [],
      shiftIds: Array.isArray(r.shift_ids) ? r.shift_ids : (r.shift_id ? [r.shift_id] : []),
      shiftId:  r.shift_id,
    }));
    // Resolves rotation + Day Off/Night Off for the given date — same flat
    // shape (shiftName/shiftStart/shiftEnd/graceSt/graceEd/offDays/isOff)
    // every consumer below already expects.
    const getEmpRoster = (ds) => {
      const covering = rosterEntries.filter(e => e.dateFrom <= ds && e.dateTo >= ds);
      const exact = pickMostSpecificEntry(covering);
      const entry = exact ||
                    rosterEntries.filter(e => e.dateTo < ds).sort((a, b) => b.dateTo.localeCompare(a.dateTo))[0] ||
                    null;
      if (!entry) return null;
      // Day-of-week Day Off/Night Off override — see getEffectiveRoster's
      // identical comment above for why.
      let shift = null;
      if (exact) {
        const [gy, gm, gd] = ds.split('-').map(Number);
        const dayKey = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(gy, gm - 1, gd).getDay()];
        if (entry.nightOffDays?.includes(dayKey))    shift = findOffShiftByType(ledgerShiftsById, 'night');
        else if (entry.dayOffDays?.includes(dayKey)) shift = findOffShiftByType(ledgerShiftsById, 'day');
      }
      if (!shift) shift = resolveRotationShift(entry, ds, ledgerShiftsById);
      return {
        offDays: entry.offDays,
        shiftId:    shift?.id        ?? null,
        shiftName:  shift?.name      ?? null,
        shiftStart: shift?.startTime ?? null,
        shiftEnd:   shift?.endTime   ?? null,
        graceSt:    shift?.graceSt   ?? 0,
        graceEd:    shift?.graceEd   ?? 0,
        // Only honor Day Off/Night Off when this entry actually covers ds —
        // see getEffectiveRoster's comment above for why the past-entry
        // fallback must never carry isOff forward.
        isOff:      exact ? !!shift?.isOff : false,
        // Same distinction — isRosterWeekend uses this to know whether the
        // roster is authoritative for this exact date (see its own comment).
        hasExactEntry: !!exact,
      };
    };

    // â”€â”€ Attendance logs for the period, shift-day bucketed â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Widened by a day on each side: a shift crossing midnight (e.g.
    // 18:00-02:00) splits one overnight session's punches across two
    // calendar dates — the extra day lets bucketPunchesByShiftDay see
    // "yesterday" to correctly roll an early-morning checkout back onto the
    // shift-day it actually belongs to, instead of grouping by plain
    // calendar date and pairing the wrong punches together.
    const rangeStart = toDateStr(new Date(new Date(startDate).getTime() - 86400000));
    const rangeEnd   = toDateStr(new Date(new Date(endDate).getTime()   + 86400000));
    const rawLogsRes = await pool.query(`
      SELECT check_time FROM zkteco_attendance_logs
      WHERE  employee_id=$1 AND check_time::date BETWEEN $2 AND $3
      UNION ALL
      SELECT (date + check_in)::timestamp::timestamptz AS check_time
      FROM   attendance_manual_postings
      WHERE  employee_id=$1 AND date BETWEEN $2 AND $3 AND check_in IS NOT NULL AND status = 'approved'
      UNION ALL
      SELECT (date + check_out)::timestamp::timestamptz AS check_time
      FROM   attendance_manual_postings
      WHERE  employee_id=$1 AND date BETWEEN $2 AND $3 AND check_out IS NOT NULL AND status = 'approved'`,
      [emp.id, rangeStart, rangeEnd]
    );
    // Wrap this endpoint's own already-loaded roster data into the shape
    // getEffectiveRoster()/bucketPunchesByShiftDay() expect from loadRosterMap,
    // rather than issuing a second, redundant roster query.
    const rosterMapForBucketing = { [emp.id]: rosterEntries };
    Object.defineProperty(rosterMapForBucketing, '_shiftsById', { value: ledgerShiftsById, enumerable: false });
    Object.defineProperty(rosterMapForBucketing, '_timeOutMinGap', { value: await loadTimeOutMinGap(), enumerable: false });
    const shiftBuckets = bucketPunchesByShiftDay(rawLogsRes.rows.map(r => r.check_time), emp.id, rosterMapForBucketing, defShift);
    const logsByDay = {};
    for (const [dateStr, b] of shiftBuckets) {
      logsByDay[dateStr] = { time_in: b.timeIn, time_out: b.timeOut, punches: b.punchCount };
    }

    // â”€â”€ Approved leaves â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const leaveRes = await pool.query(`
      SELECT l.from_date, l.to_date, lt.name AS leave_type, l.half_day,
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
    const leaveHalfDates = {}; // ds -> true when that leave record is a half-day application
    const leaveRecoMap = {};
    for (const l of leaveRes.rows) {
      const from=new Date(l.from_date), to=new Date(l.to_date);
      for (let d=new Date(from);d<=to;d.setDate(d.getDate()+1)) {
        const ds=d.toISOString().split('T')[0];
        if (ds>=startDate&&ds<=endDate) {
          leaveDates[ds] = l.leave_type || 'Leave';
          leaveHalfDates[ds] = !!l.half_day;
          if (l.reco_name || l.appr_name) leaveRecoMap[ds] = { recoName: l.reco_name, apprName: l.appr_name };
        }
      }
    }

    // â”€â”€ Approved office visits â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const visitRes = await pool.query(`
      SELECT ov.from_date, ov.to_date, ov.purpose, ov.location,
             ru.full_name AS reco_name, au.full_name AS appr_name,
             ov.approved_by AS appr_id, au.profile_photo AS appr_photo
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

    // â”€â”€ Load approved OT with stored minutes + approver name/date/comment (for Remarks) â”€â”€
    const approvedOTSet = await loadApprovedOTMap(startDate, endDate); // key â†’ ot_minutes
    const approvedOTDetails = new Map(); // key â†’ { approverName, otMins, approvedDate, comment }
    try {
      const { rows: otRows } = await pool.query(`
        SELECT oa.employee_id, oa.date::text AS dt, oa.ot_minutes, oa.comment,
               oa.approved_date::text AS approved_date, u.full_name AS approver_name
        FROM overtime_approvals oa
        LEFT JOIN users u ON u.id = oa.approved_by
        WHERE oa.status = 'approved' AND oa.date BETWEEN $1 AND $2
      `, [startDate, endDate]);
      otRows.forEach(r => approvedOTDetails.set(`${r.employee_id}-${r.dt}`, {
        approverName: r.approver_name || null,
        otMins: r.ot_minutes || 0,
        approvedDate: r.approved_date || null,
        comment: r.comment || null,
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
         WHERE  mp.employee_id = $1 AND mp.date BETWEEN $2 AND $3 AND mp.status = 'approved'
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
    let presentCount=0,absentCount=0,leaveCount=0,visitCount=0,lateCount=0,earlyCount=0,otMins=0,totalMins=0;

    // Iterate every calendar day in the range using Date objects
    let sn = 0;
    let cur   = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate   + 'T00:00:00');
    // Present/Absent counting starts at the staff's Attendance Date.
    const ledgerAttStart = dateOnlyStr(emp.attendance_date);

    while (cur <= end) {
      sn++;
      const dt      = new Date(cur);
      const dateStr = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
      if (ledgerAttStart && dateStr < ledgerAttStart) {
        sn--; cur.setDate(cur.getDate() + 1); continue;
      }
      const dayKey  = DOW[dt.getDay()];
      const dayFull = DOW_FULL[dt.getDay()];

      // Roster override for this specific day
      const dayRoster    = getEmpRoster(dateStr);
      const isWeekend    = isRosterWeekend(dayRoster, dayKey, weekends, defShift?.id);
      // Effective shift times: roster (already winter-adjusted by resolveRotationShift)
      // > employee default/system default, winter-adjusted here per-date.
      const fallbackShift = resolveWinterShift(dateStr, shiftStart, shiftEnd, graceSt, graceEd, shiftWinterEnabled, shiftWinterPolicy);
      const effShiftStart = dayRoster?.shiftStart || fallbackShift.shiftStart;
      const effShiftEnd   = dayRoster?.shiftEnd   || fallbackShift.shiftEnd;
      const effGraceSt    = dayRoster?.graceSt    != null ? dayRoster.graceSt    : fallbackShift.graceStart;
      const effGraceEd    = dayRoster?.graceEd    != null ? dayRoster.graceEd    : fallbackShift.graceEnd;

      if (!isWeekend) totalWorkingDays++;

      const log        = logsByDay[dateStr];
      const leave      = leaveDates[dateStr];
      const visit      = visitDates[dateStr];
      const phName     = getHoliday(dateStr, emp);

      let status='Absent', timeIn=null, timeOut=null, lateMins=null,
          earlyMins=null, otMinDay=null, totalMinDay=null, remarks='';
      let inStatusStr=null, outStatusStr=null;
      let isHalfDayLeave = false;

      if (isWeekend) {
        // Day Off/Night Off is a specific roster designation, not just the
        // company-wide weekend pattern — show it as such instead of the
        // generic "Weekend" label (dayRoster.isOff only reflects a roster
        // entry actually covering this date, never a stale fallback — see
        // getEffectiveRoster's isOff comment).
        status = dayRoster?.isOff ? (dayRoster.shiftName || 'Weekend') : 'Weekend';
        // Still show the real punch if the employee actually worked this
        // day despite being scheduled off — previously this branch left
        // timeIn/timeOut at their initial null regardless of a real punch,
        // so "present in weekend" never displayed (and its own summary
        // stat, which already just checks isWeekend && timeIn, silently
        // always read 0).
        if (log?.time_in) {
          timeIn  = log.time_in;
          timeOut = (log.punches >= 2) ? (log.time_out || null) : null;
          if (timeOut) {
            const worked = Math.round((new Date(timeOut) - new Date(timeIn)) / 60000);
            if (worked > 0) { totalMinDay = worked; totalMins += worked; }
          }
        }
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
              outStatusStr  = `OT ${minsToHHMM(approvedMins)}`;
              otMinDay      = approvedMins;
              otMins       += approvedMins;
            } else {
              outStatusStr = `Late Out ${minsToHHMM(rawOutDiff)}`;
            }
          }

          const worked = Math.round((outDt - inDt) / 60000);
          if (worked > 0) { totalMinDay = worked; totalMins += worked; }
        }

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
        // Public Holiday takes priority over a same-day Leave record — the
        // day doesn't count as leave taken (a holiday isn't a working day
        // to begin with), it's simply a holiday. If a leave was also
        // recorded for it, note that in remarks instead of silently
        // dropping it, but don't add it to leaveCount.
        status = 'Public Holiday';
        isHalfDayLeave = !!leaveHalfDates[dateStr];
        remarks = leave ? `${phName} | Leave: ${leave}${isHalfDayLeave ? ' (½ Half Day)' : ''}` : phName;
      } else if (leave) {
        isHalfDayLeave = !!leaveHalfDates[dateStr];
        status = leave; leaveCount += isHalfDayLeave ? 0.5 : 1;
        const leaveReco = leaveRecoMap[dateStr];
        const lMeta = [];
        if (leaveReco?.recoName) lMeta.push(`Recom. by ${leaveReco.recoName}`);
        if (leaveReco?.apprName) lMeta.push(`App. by ${leaveReco.apprName}`);
        const lParts = [];
        if (lMeta.length) lParts.push(lMeta.join(', '));
        lParts.push(`Leave: ${leave}${isHalfDayLeave ? ' (½ Half Day)' : ''}`);
        remarks = lParts.join(' | ');
      } else if (visit) {
        // An approved Office Visit is its own attendance outcome — it used
        // to still fall into absentCount even though the status label below
        // correctly said "Office Visit", so the Absent tile over-counted
        // every visit day.
        status = 'Office Visit';
        visitCount++;
        const vMeta = [];
        if (visit.reco_name) vMeta.push(`Recom. by ${visit.reco_name}`);
        if (visit.appr_name) vMeta.push(`App. by ${visit.appr_name}`);
        const vParts = [];
        if (vMeta.length) vParts.push(vMeta.join(', '));
        if (visit.purpose)  vParts.push(`Office Visit: ${visit.purpose}`);
        if (visit.location) vParts.push(visit.location);
        remarks = vParts.join(' | ');
      } else {
        absentCount++;
      }

      // Total approved OT for this exact day — independent of the OUT-status
      // narrative above (which only ever flags OT when the raw checkout also
      // happened to land after shift end); this is the OT column's value and
      // must reflect whatever the OT Approval page actually approved.
      const otApprovedDetailDay = approvedOTDetails.get(`${emp.id}-${dateStr}`);
      const otApprovedMinsDay   = otApprovedDetailDay?.otMins ?? 0;

      // Surface who approved it, when, and any comment left on the OT
      // Approval page — independent of whatever else is already in remarks
      // (leave/visit/holiday text), so it shows up regardless of status.
      if (otApprovedMinsDay > 0) {
        const otParts = [`OT ✅ ${minsToHHMM(otApprovedMinsDay)}`];
        if (otApprovedDetailDay?.approverName) {
          otParts.push(`App. by: ${otApprovedDetailDay.approverName}${otApprovedDetailDay.approvedDate ? ` on ${otApprovedDetailDay.approvedDate}` : ''}`);
        }
        if (otApprovedDetailDay?.comment) otParts.push(`Reason: ${otApprovedDetailDay.comment}`);
        const otRemark = otParts.join(' | ');
        remarks = remarks ? `${remarks} | ${otRemark}` : otRemark;
      }

      days.push({
        sn, dateStr, dayKey, dayFull, isWeekend,
        shiftName       : dayRoster?.shiftName || shiftName,
        shiftStart      : effShiftStart,
        shiftEnd        : effShiftEnd,
        hasRoster       : !!dayRoster,
        status, timeIn, timeOut,
        punches         : log?.punches || 0,
        lateMins, earlyMins, otMins:otMinDay, totalMins:totalMinDay,
        lateFormatted   : inStatusStr,
        earlyFormatted  : outStatusStr,
        otFormatted     : otMinDay   ? minsToHHMM(otMinDay)   : null,
        totalFormatted  : totalMinDay? minsToHHMM(totalMinDay): null,
        otApprovedMins      : otApprovedMinsDay,
        otApprovedFormatted : otApprovedMinsDay ? minsToHHMM(otApprovedMinsDay) : null,
        // Structured office-visit fields (place/reason + the approver's own
        // id/name/photo) for consumers that want to render these directly
        // instead of parsing them back out of the combined `remarks` text —
        // e.g. Dashboard's "My Office Visit this Month" card.
        visitPlace          : visit?.location   || null,
        visitReason         : visit?.purpose    || null,
        visitApproverId     : visit?.appr_id    || null,
        visitApproverName   : visit?.appr_name  || null,
        visitApproverPhoto  : visit?.appr_photo || null,
        remarks, leave, isHalfDayLeave, hasVisit:!!visit, isPublicHoliday: !!phName, holidayName: phName||null,
      });

      cur.setDate(cur.getDate() + 1);  // advance to next day
    }

    // Total approved OT across the whole period — a plain SUM over
    // overtime_approvals, unlike `otMins` above which only accumulates on
    // days that also independently tripped the late-checkout condition (so
    // e.g. a weekend/holiday OT grant wouldn't show up in that total).
    const otApprovedSumMap  = await loadApprovedOTSumMap(startDate, endDate);
    const otApprovedMinsSum = otApprovedSumMap.get(emp.id) || 0;

    const summary = {
      totalWorkingDays, presentCount, absentCount, leaveCount, visitCount,
      lateCount, earlyCount, otMins, totalMins,
      attendanceRate: totalWorkingDays>0 ? Math.round((presentCount+leaveCount)/totalWorkingDays*100) : 0,
      otFormatted   : otMins>0 ? minsToHHMM(otMins) : '0:00',
      otApprovedMins      : otApprovedMinsSum,
      otApprovedFormatted : otApprovedMinsSum > 0 ? minsToHHMM(otApprovedMinsSum) : '0:00',
    };

    res.json({
      employee: {
        id: emp.id, empCode: emp.employee_id, fullName: emp.full_name,
        position: emp.position || '—', postShort: emp.post_short || emp.position || '—',
        department: emp.department || '—', deptShort: emp.dept_short || emp.department || '—',
        branch: emp.branch || '—', branchShort: emp.branch_short || '—',
        grade: emp.grade || null, mode: emp.mode || null,
        shiftName, shiftStart, shiftEnd, joinDate: emp.join_date,
        eligibleForOt: !!emp.eligible_for_ot,
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
      pool.query(`SELECT weekends FROM weekend_history WHERE effective_date <= $1 ORDER BY effective_date DESC, id DESC LIMIT 1`, [endDate]),
      loadPublicHolidays(),
    ]);
    const weekends   = wkRes.rows[0]?.weekends || ['Sat'];
    const getHoliday = await makeHolidayChecker(publicHolidays);
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
    const { scopeEmployeeId, isScoped } = resolveEmployeeScope(req);
    // employeeId (optional) narrows everything below to one staff member —
    // see the identical note on /present-absent; the Yearly Present/Absent
    // report also hits this endpoint (for late/early stats) over a full
    // year for just its one selected staff member.
    const requestedEmployeeId = req.query.employeeId ? parseInt(req.query.employeeId) : null;
    const effectiveEmployeeId = isScoped ? scopeEmployeeId : requestedEmployeeId;
    // A management-role caller (branchManager/departmentHead) with no single
    // employeeId requested is narrowed to their own branch/department instead
    // — same org-scope helper Duty Roster/OT Approval already use — when the
    // client opts in via ?orgScope=1. Without this, a Dept Head saw every
    // department's staff, not just their own (confirmed on Omni tenant).
    const orgScopeIds = (!effectiveEmployeeId && req.query.orgScope === '1')
      ? await resolveOrgEmployeeIds(req) : null;

    // â”€â”€ All active employees (with per-employee shift info) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const empRes = await pool.query(`
      SELECT u.id, u.employee_id AS "empCode", u.full_name AS "fullName",
             u.department, u.position, u.branch, u.gender, u.religion, u.handicapped,
             u.shift, u.eligible_for_ot, u.attendance_date AS "attendanceDate",
             s.start_time AS shift_start, s.end_time AS shift_end,
             s.grace_period_start AS grace_st, s.grace_period_end AS grace_ed,
             s.winter_policy_enabled AS shift_winter_enabled, s.winter_policy AS shift_winter_policy
      FROM   users u
      LEFT   JOIN shifts s ON s.code = u.shift
      WHERE  u.active=TRUE AND (u.is_system IS NOT TRUE AND u.role NOT IN ('superAdmin'))
             ${effectiveEmployeeId ? 'AND u.id = $1' : orgScopeIds ? 'AND u.id = ANY($1)' : ''}
      ORDER  BY (SELECT MIN(b.ranking_order) FROM branches b WHERE b.name = u.branch) ASC NULLS LAST,
               u.ranking_order ASC NULLS LAST, u.full_name ASC
    `, effectiveEmployeeId ? [effectiveEmployeeId] : orgScopeIds ? [orgScopeIds] : []);
    const employees = isScoped
      ? empRes.rows.filter(emp => String(emp.id) === String(scopeEmployeeId))
      : empRes.rows;

    // â”€â”€ Duty roster map for the period â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Widened by a day each side — bucketPunchesByShiftDay (below) needs to
    // resolve "yesterday"'s shift at the range's start boundary.
    const rangeStartHalf = toDateStr(new Date(new Date(startDate).getTime() - 86400000));
    const rangeEndHalf   = toDateStr(new Date(new Date(endDate).getTime()   + 86400000));
    const rosterMapHalf = await loadRosterMap(rangeStartHalf, rangeEndHalf);

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

    // â”€â”€ Attendance logs for period, shift-day bucketed â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Raw punches only (widened range) — bucketPunchesByShiftDay does the
    // MIN/MAX aggregation per employee below, roster-aware, instead of a
    // plain GROUP BY check_time::date (which pairs the wrong punches
    // together for a shift that crosses midnight).
    const empIdClauseHalf = effectiveEmployeeId ? 'AND employee_id = $3' : '';
    const rawLogsResHalf = await pool.query(`
      SELECT employee_id, check_time FROM zkteco_attendance_logs
      WHERE  check_time::date BETWEEN $1 AND $2 AND employee_id IS NOT NULL ${empIdClauseHalf}
      UNION ALL
      SELECT employee_id, (date + check_in)::timestamp::timestamptz AS check_time
      FROM   attendance_manual_postings
      WHERE  date BETWEEN $1 AND $2 AND check_in IS NOT NULL AND status = 'approved' ${empIdClauseHalf}
      UNION ALL
      SELECT employee_id, (date + check_out)::timestamp::timestamptz AS check_time
      FROM   attendance_manual_postings
      WHERE  date BETWEEN $1 AND $2 AND check_out IS NOT NULL AND status = 'approved' ${empIdClauseHalf}
    `, effectiveEmployeeId ? [rangeStartHalf, rangeEndHalf, effectiveEmployeeId] : [rangeStartHalf, rangeEndHalf]);

    const rawByEmpHalf = new Map();
    for (const r of rawLogsResHalf.rows) {
      if (!rawByEmpHalf.has(r.employee_id)) rawByEmpHalf.set(r.employee_id, []);
      rawByEmpHalf.get(r.employee_id).push(r.check_time);
    }
    const logsMap = {};  // empId → { ‘YYYY-MM-DD’: { timeIn, timeOut, punches } }
    for (const emp of employees) {
      const buckets = bucketPunchesByShiftDay(rawByEmpHalf.get(emp.id) || [], emp.id, rosterMapHalf, defShift);
      logsMap[emp.id] = {};
      for (const [dateStr, b] of buckets) {
        if (dateStr < startDate || dateStr > endDate) continue;
        logsMap[emp.id][dateStr] = { timeIn: b.timeIn, timeOut: b.timeOut, punches: b.punchCount };
      }
    }

    // â”€â”€ Leaves for period â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const leavesRes = await pool.query(`
      SELECT l.employee_id, l.from_date, l.to_date, lt.name AS leave_type, l.half_day
      FROM   leaves l
      LEFT   JOIN leave_types lt ON lt.code = l.leave_type_code
      WHERE  l.status='approved'
        AND  l.from_date <= $2 AND l.to_date >= $1
        ${effectiveEmployeeId ? 'AND l.employee_id = $3' : ''}
    `, effectiveEmployeeId ? [startDate, endDate, effectiveEmployeeId] : [startDate, endDate]);

    const leaveMap = {};      // empId â†’ [dates]
    const halfLeaveMap = {};  // empId â†’ Set of half-day leave dates (subset of leaveMap)
    for (const l of leavesRes.rows) {
      if (!leaveMap[l.employee_id])     leaveMap[l.employee_id]     = [];
      if (!halfLeaveMap[l.employee_id]) halfLeaveMap[l.employee_id] = new Set();
      const from = new Date(l.from_date);
      const to   = new Date(l.to_date);
      for (let d = new Date(from); d <= to; d.setDate(d.getDate()+1)) {
        const ds = d.toISOString().split('T')[0];
        if (ds >= startDate && ds <= endDate) {
          leaveMap[l.employee_id].push(ds);
          if (l.half_day) halfLeaveMap[l.employee_id].add(ds);
        }
      }
    }

    // â”€â”€ Office visits for period â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const visitRes2 = await pool.query(`
      SELECT employee_id, from_date, to_date FROM office_visits
      WHERE  status='approved' AND from_date <= $2 AND to_date >= $1
             ${effectiveEmployeeId ? 'AND employee_id = $3' : ''}
    `, effectiveEmployeeId ? [startDate, endDate, effectiveEmployeeId] : [startDate, endDate]);
    const visitMap2 = {};  // empId â†’ Set of visit dates
    for (const v of visitRes2.rows) {
      if (!visitMap2[v.employee_id]) visitMap2[v.employee_id] = new Set();
      const from = new Date(v.from_date), to = new Date(v.to_date);
      for (let d = new Date(from); d <= to; d.setDate(d.getDate()+1)) {
        const ds = d.toISOString().split('T')[0];
        if (ds >= startDate && ds <= endDate) visitMap2[v.employee_id].add(ds);
      }
    }

    // â”€â”€ Approved OT — true period total per employee (not gated on a
    // matching raw late-checkout condition, unlike the old per-day
    // accumulation this replaces — see loadApprovedOTSumMap's own comment) â”€â”€
    const halfApprovedOTSumMap = await loadApprovedOTSumMap(startDate, endDate);

    // â”€â”€ Per-employee analytics â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const pad2   = (n) => String(Math.round(n)).padStart(2,'0');
    const toHHMM = (mins) => `${pad2(Math.floor(Math.abs(mins)/60))}:${pad2(Math.abs(mins)%60)}`;

    const stats = employees.map(emp => {
      const empLogs      = logsMap[emp.id]     || {};
      const empLeave     = new Set(leaveMap[emp.id] || []);
      const empHalfLeave = halfLeaveMap[emp.id] || new Set();
      const empVisit = visitMap2[emp.id] || new Set();

      // Per-employee roster — resolves rotation + Day Off/Night Off for the given date
      const getEmpRosterH = (ds) => getEffectiveRoster(rosterMapHalf, emp.id, ds);

      // Employee's own shift (fallback to default)
      const empShiftStartH = emp.shift_start?.toString().substring(0,5) || defShift?.start_time?.toString().substring(0,5) || '10:00';
      const empShiftEndH   = emp.shift_end?.toString().substring(0,5)   || defShift?.end_time?.toString().substring(0,5)   || '17:00';
      const empGraceStH    = emp.grace_st ?? defShift?.grace_period_start ?? 0;
      const empGraceEdH    = emp.grace_ed ?? defShift?.grace_period_end   ?? 0;
      const empWinterEnabledH = emp.shift_start ? emp.shift_winter_enabled : defShift?.winter_policy_enabled;
      const empWinterPolicyH  = emp.shift_start ? emp.shift_winter_policy  : defShift?.winter_policy;

      // Compute per-employee working days (roster off days override system weekends)
      let empTotalWorkingDays = 0;
      const empWorkingDatesH = [];
      const attStartH = dateOnlyStr(emp.attendanceDate);
      for (const { dateStr, dayKey } of allDatesHalf) {
        // Before the staff's Attendance Date: never counted.
        if (attStartH && dateStr < attStartH) continue;
        const roster   = getEmpRosterH(dateStr);
        const isEmpWkd = isRosterWeekend(roster, dayKey, weekends, defShift?.id);
        const phName2  = getHoliday(dateStr, emp);
        if (!isEmpWkd && !phName2) {
          empWorkingDatesH.push({ dateStr, dayKey, roster });
          empTotalWorkingDays++;
        }
      }

      let presentDays = 0, absentDays = 0, leaveDays = 0;
      let lateCount = 0, earlyCount = 0, totalMins = 0;
      let lateMinsTotal = 0, earlyMinsTotal = 0;
      // True period total for this employee — a plain sum of approved OT
      // records, independent of the per-day late-checkout math below.
      const otMinutes = halfApprovedOTSumMap.get(emp.id) || 0;

      for (const { dateStr, roster } of empWorkingDatesH) {
        if (empLeave.has(dateStr)) { leaveDays += empHalfLeave.has(dateStr) ? 0.5 : 1; continue; }
        // Approved office visit — already counted in officialVisitDays below;
        // without this check a visit day with no punch fell through to the
        // absent branch just below, double-counting it as both a visit AND
        // an absence (this is what previously made absentDays == officialVisitDays
        // whenever every "absence" was actually a sanctioned visit).
        if (empVisit.has(dateStr)) continue;

        const log = empLogs[dateStr];
        if (!log || !log.timeIn) { absentDays++; continue; }

        presentDays++;
        const inDt  = new Date(log.timeIn);
        const outDt = (log.timeOut && log.punches >= 2) ? new Date(log.timeOut) : null;

        // Effective shift: roster (already winter-adjusted) > employee > default,
        // with the employee/default fallback winter-adjusted here per-date.
        const fallbackShiftH = resolveWinterShift(dateStr, empShiftStartH, empShiftEndH, empGraceStH, empGraceEdH, empWinterEnabledH, empWinterPolicyH);
        const shiftStart = roster?.shiftStart || fallbackShiftH.shiftStart;
        const shiftEnd   = roster?.shiftEnd   || fallbackShiftH.shiftEnd;
        const graceSt    = roster?.graceSt    != null ? roster.graceSt    : fallbackShiftH.graceStart;
        const graceEd    = roster?.graceEd    != null ? roster.graceEd    : fallbackShiftH.graceEnd;

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

      // Nothing before the staff's Attendance Date counts toward these either.
      const fromAttH          = (d) => !attStartH || d >= attStartH;
      const empWeekendDates   = weekendDates.filter(fromAttH);
      const empHolidayDates   = holidayDates.filter(fromAttH);
      const weekendPresent    = empWeekendDates.filter(d => empLogs[d]?.timeIn).length;
      const holidayPresent    = empHolidayDates.filter(d => empLogs[d]?.timeIn).length;
      const officialVisitDays = [...empVisit].filter(fromAttH).length;

      const requiredMins = presentDays * ((defShift?.work_hours || 8) * 60);
      const lackMins     = Math.max(0, requiredMins - totalMins);

      return {
        id           : emp.id,
        empCode      : emp.empCode,
        fullName     : emp.fullName,
        department   : emp.department || '—',
        position     : emp.position   || '—',
        branch       : emp.branch     || '—',
        eligibleForOt: !!emp.eligible_for_ot,
        totalWorkingDays: empTotalWorkingDays,
        // Full calendar days in the period (Weekend + Holiday + Leave +
        // Official Visit + Present + Absent all add up to this) — distinct
        // from totalWorkingDays (excludes weekend/holiday), which several
        // other reports sharing this endpoint still rely on for their own
        // "Total" meaning and for the attendanceRate denominator above, so
        // this is added alongside it rather than replacing it.
        totalCalendarDays: allDatesHalf.filter(x => fromAttH(x.dateStr)).length,
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
        weekendDays     : empWeekendDates.length,
        weekendPresent,
        holidayDays     : empHolidayDates.length,
        holidayPresent,
        officialVisitDays,
        workedHrsFormatted : totalMins > 0 ? toHHMM(totalMins)  : '0:00',
        lackHrsFormatted   : lackMins  > 0 ? toHHMM(lackMins)   : '0:00',
        otFormatted        : (emp.eligible_for_ot && otMinutes > 0) ? toHHMM(otMinutes) : '—',
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
      insights.push({ type:'positive', icon:'🌟', text:`Excellent half-month! Average attendance rate is ${avgAttRate}% — above target.` });
    else if (avgAttRate >= 75)
      insights.push({ type:'neutral', icon:'📊', text:`Average attendance rate is ${avgAttRate}%. ${Math.ceil((90-avgAttRate)/100*totalEmp)} more staff needed for 90%+ target.` });
    else
      insights.push({ type:'warning', icon:'⚠️', text:`Attendance rate is ${avgAttRate}% — significantly below 90% target. Immediate action needed.` });

    if (perfectAtt > 0)
      insights.push({ type:'positive', icon:'🏆', text:`${perfectAtt} staff member${perfectAtt>1?'s':''} achieved perfect attendance with zero absences or late arrivals!` });

    if (totalLate > 0) {
      const pct = Math.round((stats.filter(s=>s.lateCount>0).length/totalEmp)*100);
      insights.push({ type: pct>50?'warning':'neutral', icon:'⏰', text:`${pct}% of staff had at least one late arrival. Top offender: ${mostLate[0]?.fullName||'—'} (${mostLate[0]?.lateCount||0} times).` });
    }

    if (mostAbsent[0]?.absentDays >= 5)
      insights.push({ type:'warning', icon:'📅', text:`${stats.filter(s=>s.absentDays>=3).length} staff with 3+ absences. ${mostAbsent[0]?.fullName} has the most at ${mostAbsent[0]?.absentDays} days.` });

    if (totalOTMins > 0) {
      const otHrs = Math.round(totalOTMins/60);
      insights.push({ type:'positive', icon:'💪', text:`Total team overtime: ${otHrs} hours. ${mostOT[0]?.fullName||'—'} contributed the most (${mostOT[0]?.otFormatted||'—'}).` });
    }

    res.json({
      period: { year, month, half, startDate, endDate,
                totalDays: workingDays.length + weekendDates.length + holidayDates.length,
                totalWorkingDays, weekendDays: weekendDates.length, holidayDays: holidayDates.length },
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
  const pad   = (n) => String(n).padStart(2,'0');

  // Accept explicit startDate/endDate (Nepali/BS-month mode — a BS month
  // doesn't align to a single AD year/month, so it can't be expressed as
  // one) OR fall back to the plain AD year/month pair, same convention as
  // /half-in-out and friends.
  let startDate = req.query.startDate;
  let endDate   = req.query.endDate;
  if (!startDate || !endDate) {
    const lastDayOfMonth = new Date(year, month, 0).getDate();
    startDate = `${year}-${pad(month)}-01`;
    endDate   = `${year}-${pad(month)}-${pad(lastDayOfMonth)}`;
  }
  const totalDays = Math.round((new Date(endDate + 'T00:00:00') - new Date(startDate + 'T00:00:00')) / 86400000) + 1;

  try {
    const [wkRes, publicHolidays] = await Promise.all([
      pool.query(`SELECT weekends FROM weekend_history WHERE effective_date <= $1 ORDER BY effective_date DESC, id DESC LIMIT 1`, [endDate]),
      loadPublicHolidays(),
    ]);
    const weekends   = wkRes.rows[0]?.weekends || ['Sat'];
    const getHoliday = await makeHolidayChecker(publicHolidays);
    const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

    // Working days = non-weekend, non-public-holiday days in the period.
    // Iterates startDate → endDate directly (rather than day-1..lastDayOfMonth
    // of a single year/month) so this works whether the range is a plain AD
    // month or an arbitrary BS-month-derived AD span.
    const workingDays = [];
    let weekendDays = 0, holidayDays = 0;
    for (let dt = new Date(startDate + 'T00:00:00'), endDt = new Date(endDate + 'T00:00:00'); dt <= endDt; dt.setDate(dt.getDate() + 1)) {
      const key     = DOW[dt.getDay()];
      const dateStr = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
      if (weekends.includes(key)) weekendDays++;
      else if (getHoliday(dateStr)) holidayDays++;
      else workingDays.push(dateStr);
    }
    const totalWorkingDays = workingDays.length;

    const shiftRes = await pool.query(`SELECT * FROM shifts WHERE make_default=TRUE LIMIT 1`);
    const defShift = shiftRes.rows[0];

    const hmActiveParam = req.query.active !== 'false';
    const empRes = await pool.query(`
      SELECT u.id, u.employee_id AS "empCode", u.full_name AS "fullName",
             u.department, u.position, u.branch, u.gender, u.religion, u.handicapped,
             u.shift, u.eligible_for_ot, u.attendance_date AS "attendanceDate",
             s.start_time AS shift_start, s.end_time AS shift_end,
             s.grace_period_start AS grace_st, s.grace_period_end AS grace_ed,
             s.winter_policy_enabled AS shift_winter_enabled, s.winter_policy AS shift_winter_policy
      FROM   users u
      LEFT   JOIN shifts s ON s.code = u.shift
      WHERE  u.active=$1 AND (u.is_system IS NOT TRUE AND u.role NOT IN ('superAdmin'))
      ORDER  BY (SELECT MIN(b.ranking_order) FROM branches b WHERE b.name = u.branch) ASC NULLS LAST,
               u.ranking_order ASC NULLS LAST, u.full_name ASC
    `, [hmActiveParam]);
    const { scopeEmployeeId, isScoped } = resolveEmployeeScope(req);
    // Stats are computed over EVERY active employee regardless of scope — a scoped
    // (employee-role) caller's `stats` array is narrowed back down to just their own
    // row further below, only after using the full array to compute their rank.
    // This keeps the existing single-employee response shape (and MonthlyReport.jsx's
    // rendering) unchanged, while allowing a privacy-safe rank number to be derived.
    const employees = empRes.rows;

    // â”€â”€ Duty roster map for the month â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Widened a day each side — bucketPunchesByShiftDay needs "yesterday"'s
    // shift resolvable even for the 1st of the month.
    const rangeStartMon = toDateStr(new Date(new Date(startDate).getTime() - 86400000));
    const rangeEndMon   = toDateStr(new Date(new Date(endDate).getTime()   + 86400000));
    const rosterMapMon = await loadRosterMap(rangeStartMon, rangeEndMon);

    // â”€â”€ Build all calendar dates in the period â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const allDatesMon = [];
    for (let dt = new Date(startDate + 'T00:00:00'), endDt = new Date(endDate + 'T00:00:00'); dt <= endDt; dt.setDate(dt.getDate() + 1)) {
      const dayKey  = DOW[dt.getDay()];
      const dateStr = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
      allDatesMon.push({ dateStr, dayKey });
    }

    // â”€â”€ Attendance logs for the month, shift-day bucketed â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Raw punches only (widened range) — bucketPunchesByShiftDay aggregates
    // per employee below, roster-aware, instead of GROUP BY check_time::date
    // (which mispairs punches for a shift that crosses midnight).
    const rawLogsResMon = await pool.query(`
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
    `, [rangeStartMon, rangeEndMon]);

    const rawByEmpMon = new Map();
    for (const r of rawLogsResMon.rows) {
      if (!rawByEmpMon.has(r.employee_id)) rawByEmpMon.set(r.employee_id, []);
      rawByEmpMon.get(r.employee_id).push(r.check_time);
    }
    const logsMap = {};
    for (const emp of employees) {
      const buckets = bucketPunchesByShiftDay(rawByEmpMon.get(emp.id) || [], emp.id, rosterMapMon, defShift);
      logsMap[emp.id] = {};
      for (const [dateStr, b] of buckets) {
        if (dateStr < startDate || dateStr > endDate) continue;
        logsMap[emp.id][dateStr] = { timeIn: b.timeIn, timeOut: b.timeOut, punches: b.punchCount };
      }
    }

    const leavesRes = await pool.query(`
      SELECT l.employee_id, l.from_date, l.to_date, lt.name AS leave_type, l.half_day
      FROM leaves l LEFT JOIN leave_types lt ON lt.code = l.leave_type_code
      WHERE l.status='approved' AND l.from_date <= $2 AND l.to_date >= $1
    `, [startDate, endDate]);

    const leaveMap = {};
    const halfLeaveMap = {}; // empId â†’ Set of half-day leave dates (subset of leaveMap)
    for (const l of leavesRes.rows) {
      if (!leaveMap[l.employee_id])     leaveMap[l.employee_id]     = [];
      if (!halfLeaveMap[l.employee_id]) halfLeaveMap[l.employee_id] = new Set();
      const from = new Date(l.from_date), to = new Date(l.to_date);
      for (let d = new Date(from); d <= to; d.setDate(d.getDate()+1)) {
        const ds = d.toISOString().split('T')[0];
        if (ds >= startDate && ds <= endDate) {
          leaveMap[l.employee_id].push(ds);
          if (l.half_day) halfLeaveMap[l.employee_id].add(ds);
        }
      }
    }

    const pad2   = (n) => String(Math.round(n)).padStart(2,'0');
    const toHHMM = (mins) => `${pad2(Math.floor(Math.abs(mins)/60))}:${pad2(Math.abs(mins)%60)}`;

    // True period total per employee — see loadApprovedOTSumMap's comment
    // for why this replaces the old per-day-conditional accumulation.
    const monthlyApprovedOTSumMap = await loadApprovedOTSumMap(startDate, endDate);

    let stats = employees.map(emp => {
      const empLogs      = logsMap[emp.id] || {};
      const empLeave     = new Set(leaveMap[emp.id] || []);
      const empHalfLeave = halfLeaveMap[emp.id] || new Set();

      // Per-employee roster — resolves rotation + Day Off/Night Off for the given date
      const getEmpRosterM = (ds) => getEffectiveRoster(rosterMapMon, emp.id, ds);

      // Employee's own shift (fallback to default)
      const empShiftStartM = emp.shift_start?.toString().substring(0,5) || defShift?.start_time?.toString().substring(0,5) || '10:00';
      const empShiftEndM   = emp.shift_end?.toString().substring(0,5)   || defShift?.end_time?.toString().substring(0,5)   || '17:00';
      const empGraceStM    = emp.grace_st ?? defShift?.grace_period_start ?? 0;
      const empGraceEdM    = emp.grace_ed ?? defShift?.grace_period_end   ?? 0;
      const empWinterEnabledM = emp.shift_start ? emp.shift_winter_enabled : defShift?.winter_policy_enabled;
      const empWinterPolicyM  = emp.shift_start ? emp.shift_winter_policy  : defShift?.winter_policy;

      // Compute per-employee working days (roster off days override system weekends)
      let empTotalWorkingDays = 0;
      const empWorkingDatesM = [];
      const attStartM = dateOnlyStr(emp.attendanceDate);
      for (const { dateStr, dayKey } of allDatesMon) {
        // Before the staff's Attendance Date: never counted.
        if (attStartM && dateStr < attStartM) continue;
        const roster   = getEmpRosterM(dateStr);
        const isEmpWkd = isRosterWeekend(roster, dayKey, weekends, defShift?.id);
        const phName3  = getHoliday(dateStr, emp);
        if (!isEmpWkd && !phName3) {
          empWorkingDatesM.push({ dateStr, roster });
          empTotalWorkingDays++;
        }
      }

      let presentDays=0, absentDays=0, leaveDays=0, lateCount=0, earlyCount=0;
      let totalMins=0, lateMinsTotal=0, earlyMinsTotal=0;
      // Missing Attendance — checked in but never checked out (single punch),
      // so the day counts as Present above but has no real worked-hours data.
      // Extra Shift — minutes actually worked beyond the day's own scheduled
      // shift length, on top of whatever's separately approved as OT.
      let missingAttendanceDays = 0, extraShiftMinutes = 0;
      const otMinutes = monthlyApprovedOTSumMap.get(emp.id) || 0;

      for (const { dateStr, roster } of empWorkingDatesM) {
        if (empLeave.has(dateStr)) { leaveDays += empHalfLeave.has(dateStr) ? 0.5 : 1; continue; }
        const log = empLogs[dateStr];
        if (!log || !log.timeIn) { absentDays++; continue; }
        presentDays++;
        const inDt  = new Date(log.timeIn);
        const outDt = (log.timeOut && log.punches >= 2) ? new Date(log.timeOut) : null;
        if (!outDt) missingAttendanceDays++;

        // Effective shift: roster (already winter-adjusted) > employee > default,
        // with the employee/default fallback winter-adjusted here per-date.
        const fallbackShiftM = resolveWinterShift(dateStr, empShiftStartM, empShiftEndM, empGraceStM, empGraceEdM, empWinterEnabledM, empWinterPolicyM);
        const shiftStart = roster?.shiftStart || fallbackShiftM.shiftStart;
        const shiftEnd   = roster?.shiftEnd   || fallbackShiftM.shiftEnd;
        const graceSt    = roster?.graceSt    != null ? roster.graceSt    : fallbackShiftM.graceStart;
        const graceEd    = roster?.graceEd    != null ? roster.graceEd    : fallbackShiftM.graceEnd;

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
          const worked = Math.round((outDt - inDt) / 60000);
          if (worked > 0) totalMins += worked;
          const scheduledMins = Math.round((eDt - sDt) / 60000);
          if (worked > scheduledMins) extraShiftMinutes += (worked - scheduledMins);
        }
      }

      const attendanceRate   = empTotalWorkingDays > 0 ? Math.round(((presentDays+leaveDays)/empTotalWorkingDays)*100) : 0;
      const punctualityScore = presentDays > 0 ? Math.round(((presentDays-lateCount)/presentDays)*100) : 0;
      return {
        id:emp.id, empCode:emp.empCode, fullName:emp.fullName,
        department:emp.department||'—', position:emp.position||'—', branch:emp.branch||'—',
        eligibleForOt: !!emp.eligible_for_ot,
        totalWorkingDays: empTotalWorkingDays, presentDays, absentDays, leaveDays,
        lateCount, earlyCount, otMinutes, totalMins, lateMinsTotal, earlyMinsTotal,
        missingAttendanceDays, extraShiftMinutes,
        attendanceRate, punctualityScore,
        otFormatted     : (emp.eligible_for_ot && otMinutes>0) ? toHHMM(otMinutes) : '—',
        avgLateFormatted: lateCount>0 ? toHHMM(Math.round(lateMinsTotal/lateCount)) : '—',
      };
    });

    // A scoped (employee-role) caller only ever gets their OWN row back below — but
    // their rank is computed here, over everyone, before narrowing. Only the rank
    // number/total is returned to them, never any other employee's data.
    let myRanks = null;
    if (isScoped) {
      const rankOf = (key) => {
        const sorted = [...stats].sort((a, b) => b[key] - a[key]);
        const idx = sorted.findIndex(s => String(s.id) === String(scopeEmployeeId));
        return idx === -1 ? null : idx + 1;
      };
      myRanks = {
        total       : stats.length,
        punctuality : rankOf('punctualityScore'),
        lateArrivals: rankOf('lateCount'),
        earlyOut    : rankOf('earlyCount'),
        absences    : rankOf('absentDays'),
        attendance  : rankOf('presentDays'),
      };
      stats = stats.filter(s => String(s.id) === String(scopeEmployeeId));
    } else if (req.query.orgScope === '1') {
      const ids = await resolveOrgEmployeeIds(req);
      if (ids) stats = stats.filter(s => ids.includes(s.id));
    }

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
    if (avgAttRate>=90) insights.push({ type:'positive', icon:'🌟', text:`Excellent month! Average attendance is ${avgAttRate}% — above target.` });
    else if (avgAttRate>=75) insights.push({ type:'neutral', icon:'📊', text:`Monthly attendance is ${avgAttRate}%. ${Math.ceil((90-avgAttRate)/100*totalEmp)} more staff needed for 90%+ target.` });
    else insights.push({ type:'warning', icon:'⚠️', text:`Monthly attendance is ${avgAttRate}% — below 90% target.` });
    if (perfectAtt>0) insights.push({ type:'positive', icon:'🏆', text:`${perfectAtt} staff achieved perfect attendance for the full month!` });
    if (totalLate>0) {
      const pct=Math.round((stats.filter(s=>s.lateCount>0).length/totalEmp)*100);
      insights.push({ type:pct>50?'warning':'neutral', icon:'⏰', text:`${pct}% of staff had at least one late arrival. Most: ${mostLate[0]?.fullName||'—'} (${mostLate[0]?.lateCount||0} times).` });
    }
    if (mostAbsent[0]?.absentDays>=5) insights.push({ type:'warning', icon:'📅', text:`${stats.filter(s=>s.absentDays>=3).length} staff with 3+ absences. Most: ${mostAbsent[0]?.fullName} (${mostAbsent[0]?.absentDays} days).` });
    if (totalOTMins>0) insights.push({ type:'positive', icon:'💪', text:`Total monthly OT: ${Math.round(totalOTMins/60)} hours. Top: ${mostOT[0]?.fullName||'—'} (${mostOT[0]?.otFormatted||'—'}).` });

    res.json({
      period: { year, month, startDate, endDate, totalDays, totalWorkingDays, weekendDays, holidayDays },
      summary: { totalEmp, totalPresent, totalAbsent, totalLeave, totalLate, totalOTMins, avgAttRate, perfectAtt },
      rankings: { topPunctual, mostLate, mostEarlyOut, mostAbsent, mostOT, mostPresent },
      insights, allStats: stats,
      myRanks,
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
      pool.query(`SELECT weekends FROM weekend_history WHERE effective_date <= $1 ORDER BY effective_date DESC, id DESC LIMIT 1`, [endDate]),
      loadPublicHolidays(),
    ]);
    const weekends   = wkRes.rows[0]?.weekends || ['Sat'];
    const getHoliday = await makeHolidayChecker(publicHolidays);
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

    const { scopeEmployeeId, isScoped } = resolveEmployeeScope(req);
    // employeeId (optional) narrows everything below to one staff member —
    // see the identical note on /present-absent; the Yearly In & Out report
    // hits this endpoint over a full year for just its one selected staff
    // member.
    const requestedEmployeeId = req.query.employeeId ? parseInt(req.query.employeeId) : null;
    const effectiveEmployeeId = isScoped ? scopeEmployeeId : requestedEmployeeId;
    // Management-role caller (branchManager/departmentHead), no single
    // employeeId requested → narrow to their own branch/department (opt-in
    // via ?orgScope=1) instead of every employee — see /half-monthly's
    // identical comment for why this is needed.
    const orgScopeIds = (!effectiveEmployeeId && req.query.orgScope === '1')
      ? await resolveOrgEmployeeIds(req) : null;
    const [empRes, leavesRes, visitRes] = await Promise.all([
      pool.query(`
        SELECT u.id, u.employee_id AS "empCode", u.full_name AS "fullName",
               NULLIF(TRIM(COALESCE(p.short_name,'')), '')  AS "postShort",
               NULLIF(TRIM(COALESCE(dd.short_name,'')), '') AS "deptShort",
               NULLIF(TRIM(COALESCE(br.short_name,'')), '') AS "branchShort",
               u.position, u.department, u.branch, u.gender, u.religion, u.handicapped, u.eligible_for_ot,
               u.grade, u.mode, u.timing_type AS "timingType", u.shift,
               COALESCE(u.attendance_date, u.join_date)::text AS "joinDateStr",
               u.attendance_date::text AS "attStartStr"
        FROM   users u
        LEFT JOIN LATERAL (SELECT * FROM posts WHERE name = u.position ORDER BY id LIMIT 1) p ON TRUE
        LEFT JOIN LATERAL (SELECT * FROM departments WHERE name = u.department ORDER BY id LIMIT 1) dd ON TRUE
        LEFT JOIN LATERAL (SELECT * FROM branches WHERE name = u.branch ORDER BY id LIMIT 1) br ON TRUE
        WHERE  u.active = TRUE AND (u.is_system IS NOT TRUE AND u.role NOT IN ('superAdmin'))
               ${effectiveEmployeeId ? 'AND u.id = $1' : orgScopeIds ? 'AND u.id = ANY($1)' : ''}
        ORDER  BY br.ranking_order ASC NULLS LAST, u.ranking_order ASC NULLS LAST, u.full_name ASC
      `, effectiveEmployeeId ? [effectiveEmployeeId] : orgScopeIds ? [orgScopeIds] : []),
      pool.query(`
        SELECT l.employee_id, l.from_date, l.to_date, lt.name AS leave_type, l.leave_type_code, l.half_day
        FROM   leaves l LEFT JOIN leave_types lt ON lt.code = l.leave_type_code
        WHERE  l.status='approved' AND l.from_date <= $2 AND l.to_date >= $1
               ${effectiveEmployeeId ? 'AND l.employee_id = $3' : ''}
      `, effectiveEmployeeId ? [startDate, endDate, effectiveEmployeeId] : [startDate, endDate]),
      pool.query(`
        SELECT employee_id, from_date, to_date, purpose, location
        FROM   office_visits WHERE status='approved' AND from_date <= $2 AND to_date >= $1
               ${effectiveEmployeeId ? 'AND employee_id = $3' : ''}
      `, effectiveEmployeeId ? [startDate, endDate, effectiveEmployeeId] : [startDate, endDate]),
    ]);

    // Build per-employee leave map — a half-day leave still has a real punch
    // (the employee worked the other half), so callers need to know both the
    // leave type AND whether it's half-day to show "13:00 / AL 1/2" instead
    // of just silently showing the time with no indication leave was taken.
    const leaveMap = {};
    for (const l of leavesRes.rows) {
      if (!leaveMap[l.employee_id]) leaveMap[l.employee_id] = {};
      const from = new Date(l.from_date), to = new Date(l.to_date);
      for (let d = new Date(from); d <= to; d.setDate(d.getDate()+1)) {
        const ds = d.toISOString().split('T')[0];
        if (ds >= startDate && ds <= endDate) {
          leaveMap[l.employee_id][ds] = { name: l.leave_type || 'Leave', code: l.leave_type_code || null, halfDay: !!l.half_day };
        }
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

    // Default shift for OT calculation
    const shiftRes = await pool.query(`SELECT * FROM shifts WHERE make_default=TRUE LIMIT 1`);
    const defShift  = shiftRes.rows[0];
    const shiftEnd  = defShift?.end_time?.toString().substring(0,5) || '17:00';

    // Approved OT from overtime_approvals (manager-set, authoritative) — per
    // day for the OT row, and a true period sum for the Total OT column.
    const approvedOTMap    = await loadApprovedOTMap(startDate, endDate);
    const approvedOTSumMap = await loadApprovedOTSumMap(startDate, endDate);

    // â”€â”€ Attendance logs, shift-day bucketed â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Widened by a day each side + roster map, so bucketPunchesByShiftDay can
    // correctly roll an early-morning checkout back onto the shift-day it
    // actually belongs to for a shift crossing midnight (a plain GROUP BY
    // check_time::date pairs the wrong punches together in that case).
    const rangeStartIO = toDateStr(new Date(new Date(startDate).getTime() - 86400000));
    const rangeEndIO   = toDateStr(new Date(new Date(endDate).getTime()   + 86400000));
    const empIdClauseIO = effectiveEmployeeId ? 'AND employee_id = $3' : '';
    const [rawLogsResIO, rosterMapIO] = await Promise.all([
      pool.query(`
        SELECT employee_id, check_time FROM zkteco_attendance_logs
        WHERE  check_time::date BETWEEN $1 AND $2 AND employee_id IS NOT NULL ${empIdClauseIO}
        UNION ALL
        SELECT employee_id, (date + check_in)::timestamp::timestamptz AS check_time
        FROM   attendance_manual_postings
        WHERE  date BETWEEN $1 AND $2 AND check_in IS NOT NULL AND status = 'approved' ${empIdClauseIO}
        UNION ALL
        SELECT employee_id, (date + check_out)::timestamp::timestamptz AS check_time
        FROM   attendance_manual_postings
        WHERE  date BETWEEN $1 AND $2 AND check_out IS NOT NULL AND status = 'approved' ${empIdClauseIO}
      `, effectiveEmployeeId ? [rangeStartIO, rangeEndIO, effectiveEmployeeId] : [rangeStartIO, rangeEndIO]),
      loadRosterMap(rangeStartIO, rangeEndIO),
    ]);

    const rawByEmpIO = new Map();
    for (const r of rawLogsResIO.rows) {
      if (!rawByEmpIO.has(r.employee_id)) rawByEmpIO.set(r.employee_id, []);
      rawByEmpIO.get(r.employee_id).push(r.check_time);
    }
    const logsMap = {};
    for (const emp of empRes.rows) {
      const buckets = bucketPunchesByShiftDay(rawByEmpIO.get(emp.id) || [], emp.id, rosterMapIO, defShift);
      logsMap[emp.id] = {};
      for (const [dateStr, b] of buckets) {
        if (dateStr < startDate || dateStr > endDate) continue;
        logsMap[emp.id][dateStr] = {
          timeIn:  b.timeIn,
          timeOut: b.punchCount >= 2 ? b.timeOut : null,
          punches: b.punchCount,
        };
      }
    }

    const [seH, seM] = shiftEnd.split(':').map(Number);
    const _now = new Date();
    const todayStrIO = `${_now.getFullYear()}-${String(_now.getMonth()+1).padStart(2,'0')}-${String(_now.getDate()).padStart(2,'0')}`;

    const employees = (isScoped
      ? empRes.rows.filter(emp => String(emp.id) === String(scopeEmployeeId))
      : empRes.rows).map(emp => {
      const empLogs  = logsMap[emp.id]     || {};
      const empLeave = leaveMap[emp.id]    || {};
      const empVisit = visitMapIO[emp.id]  || {};
      const days = {};
      // Days before the staff's Attendance Date are blank and uncounted —
      // no punch, leave, visit, OT, weekend or holiday marker.
      for (const { date, dayKey } of dates) {
        if (emp.attStartStr && date < emp.attStartStr) {
          days[date] = {
            timeIn: null, timeOut: null, punches: 0, workedHrs: null, otHrs: null,
            isWeekend: false, offType: null, isHoliday: false, holidayName: null,
            leave: null, visit: null, absent: false,
          };
          continue;
        }
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

        // Per-employee roster override — the dates[] array's own isWeekend is
        // just the flat company-wide pattern shared by everyone; once a
        // roster entry actually covers this date for THIS employee, it's
        // authoritative (see isRosterWeekend()), same as every other report.
        const empRoster    = getEffectiveRoster(rosterMapIO, emp.id, date);
        const empIsWeekend = isRosterWeekend(empRoster, dayKey, weekends, defShift?.id);
        const offType = empRoster?.isOff
          ? offTypeName(empRoster.shiftName)
          : null;
        // Per-employee holiday override — same reasoning as empIsWeekend
        // above: the shared dates[] holiday flag is unscoped (used only as a
        // fallback), a holiday scoped to e.g. Gender=Female must not show for
        // everyone else.
        const empHolidayName = getHoliday(date, emp);

        const empLeaveDay = empLeave[date] || null;
        const empVisitDay = empVisit[date] || null;
        // "AB" on the In & Out reports: a past working day with no punch at all
        // (neither IN nor OUT) and nothing else explaining it — not a holiday,
        // weekend, day off, leave or office visit, not in the future, and not
        // before the staff member's join date.
        const absent = !rawIn && !rawOut && !empHolidayName && !empIsWeekend && !offType
          && !empLeaveDay && !empVisitDay
          && date <= todayStrIO
          && !(emp.joinDateStr && date < emp.joinDateStr);

        days[date] = {
          timeIn:  rawIn,
          timeOut: rawOut,
          punches: log?.punches || 0,
          workedHrs, otHrs,
          isWeekend: empIsWeekend, offType,
          isHoliday: !!empHolidayName, holidayName: empHolidayName || null,
          leave : empLeaveDay,
          visit : empVisitDay,
          absent,
        };
      }
      // Total worked minutes across all days
      const totalWorkedMins = Object.values(days).reduce((sum, d) => {
        if (!d.workedHrs) return sum;
        const [h, m] = d.workedHrs.split(':').map(Number);
        return sum + h*60 + m;
      }, 0);

      const totalApprovedOTMins = approvedOTSumMap.get(emp.id) || 0;
      return {
        id: emp.id, empCode: emp.empCode, fullName: emp.fullName,
        postShort:   emp.postShort   || abbrev(emp.position)   || '—',
        deptShort:   emp.deptShort   || abbrev(emp.department) || '—',
        branchShort: emp.branchShort || abbrev(emp.branch)     || '—',
        // Full (non-abbreviated) values — needed by the Advance Search
        // filter in MonthlyInOutReport/HalfInOutReport, which compares
        // against these exact field names (matching /attendance/daily's
        // convention). Without these the filter always compared a real
        // string to undefined and silently zeroed out the grid.
        position: emp.position, department: emp.department, branch: emp.branch,
        grade: emp.grade, mode: emp.mode, timingType: emp.timingType, shift: emp.shift,
        eligibleForOt: !!emp.eligible_for_ot,
        totalWorkedHrs: totalWorkedMins > 0 ? minsToHHMM(totalWorkedMins) : '—',
        totalApprovedOTMins,
        totalApprovedOTFormatted: (emp.eligible_for_ot && totalApprovedOTMins > 0) ? minsToHHMM(totalApprovedOTMins) : '—',
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
    const [wkRes, publicHolidays, defShiftRes] = await Promise.all([
      pool.query(`SELECT weekends FROM weekend_history WHERE effective_date <= $1 ORDER BY effective_date DESC, id DESC LIMIT 1`, [endDate]),
      loadPublicHolidays(),
      pool.query(`SELECT * FROM shifts WHERE make_default=TRUE LIMIT 1`),
    ]);
    const weekends   = wkRes.rows[0]?.weekends || ['Sat'];
    const getHoliday = await makeHolidayChecker(publicHolidays);
    const DOW        = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const defShift   = defShiftRes.rows[0];
    const defShiftId = defShift?.id ?? null;

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
    const { scopeEmployeeId, isScoped } = resolveEmployeeScope(req);
    const empRes = await pool.query(`
      SELECT u.id, u.full_name AS "fullName", u.position, u.department, u.branch,
             u.gender, u.religion, u.handicapped,
             u.shift AS "shiftCode", u.grade, u.mode, u.timing_type AS "timingType",
             NULLIF(TRIM(COALESCE(p.short_name,'')),  '') AS "postShort",
             NULLIF(TRIM(COALESCE(dd.short_name,'')), '') AS "deptShort",
             NULLIF(TRIM(COALESCE(br.short_name,'')), '') AS "branchShort",
             COALESCE(s.start_time,  ds.start_time)  AS "shiftStart",
             COALESCE(s.end_time,    ds.end_time)    AS "shiftEnd",
             COALESCE(s.grace_period_start, ds.grace_period_start, 0) AS "graceSt",
             COALESCE(s.grace_period_end,   ds.grace_period_end,   0) AS "graceEd",
             COALESCE(s.winter_policy_enabled, ds.winter_policy_enabled, FALSE) AS "winterEnabled",
             COALESCE(s.winter_policy,         ds.winter_policy)                AS "winterPolicy"
      FROM   users u
      LEFT   JOIN LATERAL (SELECT * FROM shifts WHERE make_default=TRUE LIMIT 1) ds ON TRUE
      LEFT JOIN shifts       s  ON s.code = u.shift
      LEFT JOIN LATERAL (SELECT * FROM posts WHERE LOWER(TRIM(name)) = LOWER(TRIM(u.position)) ORDER BY id LIMIT 1) p ON TRUE
      LEFT JOIN LATERAL (SELECT * FROM departments WHERE LOWER(TRIM(name)) = LOWER(TRIM(u.department)) ORDER BY id LIMIT 1) dd ON TRUE
      LEFT JOIN LATERAL (SELECT * FROM branches WHERE LOWER(TRIM(name)) = LOWER(TRIM(u.branch)) ORDER BY id LIMIT 1) br ON TRUE
      WHERE  u.active = $1 AND (u.is_system IS NOT TRUE AND u.role NOT IN ('superAdmin'))
      ORDER  BY br.ranking_order ASC NULLS LAST, u.ranking_order ASC NULLS LAST, u.full_name ASC
    `, [req.query.active !== 'false']);

    // Load duty roster map for the period — widened a day each side so
    // bucketPunchesByShiftDay (below) can resolve "yesterday"'s shift even
    // at the range's start boundary.
    const rangeStartLE = toDateStr(new Date(new Date(startDate).getTime() - 86400000));
    const rangeEndLE   = toDateStr(new Date(new Date(endDate).getTime()   + 86400000));
    const rosterMapLE = await loadRosterMap(rangeStartLE, rangeEndLE);

    // â”€â”€ Attendance logs for the period, shift-day bucketed â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Raw punches only (widened range) — bucketPunchesByShiftDay aggregates
    // per employee below instead of GROUP BY check_time::date, which pairs
    // the wrong punches together for a shift crossing midnight.
    const rawLogsResLE = await pool.query(`
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
    `, [rangeStartLE, rangeEndLE]);

    const rawByEmpLE = new Map();
    for (const r of rawLogsResLE.rows) {
      if (!rawByEmpLE.has(r.employee_id)) rawByEmpLE.set(r.employee_id, []);
      rawByEmpLE.get(r.employee_id).push(r.check_time);
    }
    const logsMap = {};
    for (const emp of empRes.rows) {
      const buckets = bucketPunchesByShiftDay(rawByEmpLE.get(emp.id) || [], emp.id, rosterMapLE, defShift);
      logsMap[emp.id] = {};
      for (const [dateStr, b] of buckets) {
        if (dateStr < startDate || dateStr > endDate) continue;
        logsMap[emp.id][dateStr] = {
          timeIn:  b.timeIn,
          timeOut: b.punchCount >= 2 ? b.timeOut : null,
          punches: b.punchCount,
        };
      }
    }

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
    let employees = isScoped
      ? empRes.rows.filter(emp => String(emp.id) === String(scopeEmployeeId))
      : empRes.rows;
    // Management-role caller, not self-scoped → narrow to their own
    // branch/department (opt-in via ?orgScope=1) — see /half-monthly's
    // identical comment for why this is needed.
    if (!isScoped && req.query.orgScope === '1') {
      const ids = await resolveOrgEmployeeIds(req);
      if (ids) employees = employees.filter(emp => ids.includes(emp.id));
    }
    const records = [];
    for (const emp of employees) {
      const empLogs = logsMap[emp.id] || {};
      // Per-employee roster — resolves rotation + Day Off/Night Off for the given date
      const getEmpRosterLE = (ds) => getEffectiveRoster(rosterMapLE, emp.id, ds);

      const empShiftStartLE = emp.shiftStart?.toString().substring(0,5) || '10:00';
      const empShiftEndLE   = emp.shiftEnd?.toString().substring(0,5)   || '17:00';
      const empGraceStLE    = emp.graceSt || 0;
      const empGraceEdLE    = emp.graceEd || 0;
      const empWinterEnabledLE = emp.winterEnabled;
      const empWinterPolicyLE  = emp.winterPolicy;

      for (const { dateStr, dayKey } of allDatesLE) {
        const roster = getEmpRosterLE(dateStr);
        if (isRosterWeekend(roster, dayKey, weekends, defShiftId) || getHoliday(dateStr, emp)) continue;  // off day / holiday — skip

        const log = empLogs[dateStr];
        if (!log || !log.timeIn) continue;  // absent — skip

        // Effective shift: roster (already winter-adjusted) > employee default,
        // with the employee/default fallback winter-adjusted here per-date.
        const fallbackShiftLE = resolveWinterShift(dateStr, empShiftStartLE, empShiftEndLE, empGraceStLE, empGraceEdLE, empWinterEnabledLE, empWinterPolicyLE);
        const shiftStart = roster?.shiftStart || fallbackShiftLE.shiftStart;
        const shiftEnd   = roster?.shiftEnd   || fallbackShiftLE.shiftEnd;
        const graceSt    = roster?.graceSt    != null ? roster.graceSt    : fallbackShiftLE.graceStart;
        const graceEd    = roster?.graceEd    != null ? roster.graceEd    : fallbackShiftLE.graceEnd;

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
    const [wkRes, publicHolidays, defShiftRes] = await Promise.all([
      pool.query(`SELECT weekends FROM weekend_history WHERE effective_date <= $1 ORDER BY effective_date DESC, id DESC LIMIT 1`, [endDate]),
      loadPublicHolidays(),
      pool.query(`SELECT * FROM shifts WHERE make_default=TRUE LIMIT 1`),
    ]);
    const weekends   = wkRes.rows[0]?.weekends || ['Sat'];
    const getHoliday = await makeHolidayChecker(publicHolidays);
    const DOW        = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const defShift   = defShiftRes.rows[0];
    const defShiftId = defShift?.id ?? null;
    // Per-employee roster override (Day Off/Night Off, custom off-days, shift
    // rotation) — this endpoint used to only ever apply the company-wide
    // weekend, so a staff member's own roster (e.g. off day moved from Sat to
    // Sun, or a duty assigned across a date range) never showed up here even
    // though it worked correctly on Daily/Monthly/Half-Monthly. Widened a day
    // each side so bucketPunchesByShiftDay (below) can resolve "yesterday"'s
    // shift even at the range's start boundary.
    const rangeStartPA = toDateStr(new Date(new Date(startDate).getTime() - 86400000));
    const rangeEndPA   = toDateStr(new Date(new Date(endDate).getTime()   + 86400000));
    const rosterMapPA = await loadRosterMap(rangeStartPA, rangeEndPA);

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

    // Employees — active=true by default; pass ?active=false for not-working staff.
    // employeeId (optional) narrows everything below to one staff member —
    // the Yearly Present/Absent report calls this endpoint over a FULL YEAR
    // just to read one selected staff member's own calendar (see
    // YearlyPresentAbsentReport.jsx), but this endpoint used to always
    // compute and return every active employee's full day-by-day matrix
    // regardless, which dominated that report's load time. isScoped (branch
    // manager/dept head) always wins over a requested employeeId, same as
    // the isScoped filter already below.
    const activeParam = req.query.active !== 'false';
    const { scopeEmployeeId, isScoped } = resolveEmployeeScope(req);
    const requestedEmployeeId  = req.query.employeeId ? parseInt(req.query.employeeId) : null;
    const effectiveEmployeeId  = isScoped ? scopeEmployeeId : requestedEmployeeId;
    const empRes = await pool.query(`
      SELECT u.id, u.employee_id AS "empCode", u.full_name AS "fullName",
             u.branch, u.department, u.position, u.grade, u.mode,
             u.gender, u.religion, u.handicapped,
             u.timing_type AS "timingType", u.shift, u.eligible_for_ot, u.attendance_date AS "attendanceDate",
             NULLIF(TRIM(COALESCE(p.short_name,'')),  '') AS "postShort",
             NULLIF(TRIM(COALESCE(dd.short_name,'')), '') AS "deptShort",
             NULLIF(TRIM(COALESCE(br.short_name,'')), '') AS "branchShort"
      FROM   users u
      LEFT JOIN LATERAL (SELECT * FROM posts WHERE LOWER(TRIM(name)) = LOWER(TRIM(u.position)) ORDER BY id LIMIT 1) p ON TRUE
      LEFT JOIN LATERAL (SELECT * FROM departments WHERE LOWER(TRIM(name)) = LOWER(TRIM(u.department)) ORDER BY id LIMIT 1) dd ON TRUE
      LEFT JOIN LATERAL (SELECT * FROM branches WHERE LOWER(TRIM(name)) = LOWER(TRIM(u.branch)) ORDER BY id LIMIT 1) br ON TRUE
      WHERE  u.active = $1 AND (u.is_system IS NOT TRUE AND u.role NOT IN ('superAdmin'))
             ${effectiveEmployeeId ? 'AND u.id = $2' : ''}
      ORDER  BY br.ranking_order ASC NULLS LAST, u.ranking_order ASC NULLS LAST, u.full_name ASC
    `, effectiveEmployeeId ? [activeParam, effectiveEmployeeId] : [activeParam]);
    let employees = isScoped
      ? empRes.rows.filter(emp => String(emp.id) === String(scopeEmployeeId))
      : empRes.rows;
    // Management-role caller, not self-scoped → narrow to their own
    // branch/department (opt-in via ?orgScope=1) — see /half-monthly's
    // identical comment for why this is needed.
    if (!isScoped && req.query.orgScope === '1') {
      const ids = await resolveOrgEmployeeIds(req);
      if (ids) employees = employees.filter(emp => ids.includes(emp.id));
    }

    // â”€â”€ Attendance logs, shift-day bucketed â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Raw punches (widened range) — bucketPunchesByShiftDay aggregates per
    // employee below instead of GROUP BY check_time::date, which could show
    // a night-shift employee "Present" on both calendar dates a single
    // overnight session happens to touch (or miss it on the day it actually
    // belongs to), instead of once on the correct shift-day.
    const empIdClausePA = effectiveEmployeeId ? 'AND employee_id = $3' : '';
    const rawLogsResPA = await pool.query(`
      SELECT employee_id, check_time FROM zkteco_attendance_logs
      WHERE  check_time::date BETWEEN $1 AND $2 AND employee_id IS NOT NULL ${empIdClausePA}
      UNION ALL
      SELECT employee_id, (date + check_in)::timestamp::timestamptz AS check_time
      FROM   attendance_manual_postings
      WHERE  date BETWEEN $1 AND $2 AND check_in IS NOT NULL AND status = 'approved' ${empIdClausePA}
      UNION ALL
      SELECT employee_id, (date + check_out)::timestamp::timestamptz AS check_time
      FROM   attendance_manual_postings
      WHERE  date BETWEEN $1 AND $2 AND check_out IS NOT NULL AND status = 'approved' ${empIdClausePA}
    `, effectiveEmployeeId ? [rangeStartPA, rangeEndPA, effectiveEmployeeId] : [rangeStartPA, rangeEndPA]);

    const rawByEmpPA = new Map();
    for (const r of rawLogsResPA.rows) {
      if (!rawByEmpPA.has(r.employee_id)) rawByEmpPA.set(r.employee_id, []);
      rawByEmpPA.get(r.employee_id).push(r.check_time);
    }
    const logsMap = {};
    for (const emp of employees) {
      const buckets = bucketPunchesByShiftDay(rawByEmpPA.get(emp.id) || [], emp.id, rosterMapPA, defShift);
      logsMap[emp.id] = {};
      for (const [dateStr, b] of buckets) {
        if (dateStr < startDate || dateStr > endDate) continue;
        logsMap[emp.id][dateStr] = { hasIn: !!b.timeIn, punches: b.punchCount };
      }
    }

    // Approved leaves (include half_day flag)
    const leavesRes = await pool.query(`
      SELECT l.employee_id, l.from_date, l.to_date, l.half_day, l.leave_type_code
      FROM   leaves l WHERE l.status='approved' AND l.from_date <= $2 AND l.to_date >= $1
             ${effectiveEmployeeId ? 'AND l.employee_id = $3' : ''}
    `, effectiveEmployeeId ? [startDate, endDate, effectiveEmployeeId] : [startDate, endDate]);

    const leaveCodeMap = {}; // empId -> { date -> leave type code }
    const leaveMap = {};    // empId â†’ Set of date strings (full day leave)
    const halfLeaveMap = {}; // empId â†’ Set of date strings (half day leave)
    for (const l of leavesRes.rows) {
      if (!leaveMap[l.employee_id])     leaveMap[l.employee_id]     = new Set();
      if (!halfLeaveMap[l.employee_id]) halfLeaveMap[l.employee_id] = new Set();
      const from = new Date(l.from_date), to = new Date(l.to_date);
      const isHalf = !!l.half_day;
      if (!leaveCodeMap[l.employee_id]) leaveCodeMap[l.employee_id] = {};
      for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
        const ds = d.toISOString().split('T')[0];
        if (ds >= startDate && ds <= endDate) {
          if (l.leave_type_code && (!isHalf || !leaveCodeMap[l.employee_id][ds])) leaveCodeMap[l.employee_id][ds] = l.leave_type_code;
          if (isHalf) halfLeaveMap[l.employee_id].add(ds);
          else        leaveMap[l.employee_id].add(ds);
        }
      }
    }

    // Approved office visits
    const visitRes = await pool.query(`
      SELECT employee_id, from_date, to_date FROM office_visits
      WHERE  status='approved' AND from_date <= $2 AND to_date >= $1
             ${effectiveEmployeeId ? 'AND employee_id = $3' : ''}
    `, effectiveEmployeeId ? [startDate, endDate, effectiveEmployeeId] : [startDate, endDate]);

    const visitMap = {};
    for (const v of visitRes.rows) {
      if (!visitMap[v.employee_id]) visitMap[v.employee_id] = new Set();
      const from = new Date(v.from_date), to = new Date(v.to_date);
      for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
        const ds = d.toISOString().split('T')[0];
        if (ds >= startDate && ds <= endDate) visitMap[v.employee_id].add(ds);
      }
    }

    // Approved OT total per employee for the period — "Sum Total OT" column
    const approvedOTSumMapPA = await loadApprovedOTSumMap(startDate, endDate);

    // Build per-employee day matrix
    const todayNPPA = new Date(Date.now() + 5.75 * 3600 * 1000).toISOString().slice(0, 10);
    const employees_out = employees.map(emp => {
      const empLogs      = logsMap[emp.id]      || {};
      const empLeave     = leaveMap[emp.id]     || new Set();
      const empHalfLeave = halfLeaveMap[emp.id] || new Set();
      const empVisit     = visitMap[emp.id]     || new Set();

      let totalP=0, totalAB=0, totalL=0, totalOV=0, totalPH=0, totalH=0;
      const days = {};
      const attStartPA = dateOnlyStr(emp.attendanceDate);

      for (const { date, dayKey } of dates) {
        const log      = empLogs[date];
        // Before the staff's Attendance Date nothing is shown or counted —
        // no punch, leave, office visit, OT, manual posting or roster:
        // 'NA' renders as a blank dash.
        if (attStartPA && date < attStartPA) { days[date] = 'NA'; continue; }
        const leave    = empLeave.has(date);
        const halfLeave= empHalfLeave.has(date);
        const visit    = empVisit.has(date);
        const punches  = log?.punches || 0;
        // Per-employee, not the shared dates[] flag — a holiday scoped to
        // e.g. Gender=Female must not mark everyone else's day as PH too.
        const isHoliday = !!getHoliday(date, emp);
        let st;

        // Roster override: once a roster entry covers this date, it's
        // authoritative for whether it's a working day — see isRosterWeekend().
        const roster       = getEffectiveRoster(rosterMapPA, emp.id, date);
        const empIsWeekend = isRosterWeekend(roster, dayKey, weekends, defShiftId);

        if (empIsWeekend) {
          // Distinguish the roster's own Day Off/Night Off from the plain
          // company-wide weekend, same as the other reports. A plain weekend
          // day with an actual punch-in is "Present on Weekend" (WP), same
          // idea as the isHoliday branch below — it used to be swallowed
          // into the generic 'H' weekend code with no sign the staff showed up.
          // WP1 flags a single punch (in, no out) the same way P1 does on a
          // normal working day — still full present credit, just visibly
          // incomplete.
          if (log?.hasIn && !roster?.isOff) { st = punches === 1 ? 'WP1' : 'WP'; totalP++; }
          else st = roster?.isOff ? (roster.shiftName === 'Night Off' ? 'NO' : roster.shiftName === 'Day Off' ? 'DO' : (!roster.shiftName ? 'DO' : `OFF:${offShortLabel(roster.shiftName)}`)) : 'H';
          totalH++;
        }
        // Punch-present cases first (unaffected by leave/holiday labeling —
        // showing up is the most concrete fact about the day), THEN
        // Public Holiday, THEN Leave — a holiday isn't a working day to
        // begin with, so it takes priority over a same-day Leave record
        // (no punch); the day no longer counts toward totalL either, same
        // reasoning as computeDailyAttendance/staff-ledger above.
        else if (log?.hasIn && isHoliday){ st = punches === 1 ? 'PP1' : 'PP'; totalP++; }  // Present on Public Holiday
        else if (log?.hasIn && halfLeave){ st='PLH'; totalL+=0.5; totalP+=0.5; }  // Present + half-day leave
        else if (log?.hasIn && punches===1){ st='P1'; totalP++; }  // Single punch
        else if (log?.hasIn)             { st='P';  totalP++;  }
        else if (isHoliday)              { st='PH'; totalPH++; }
        else if (leave)                  { st='L';  totalL++;    }
        else if (halfLeave)              { st='LH'; totalL+=0.5; }  // Half-day leave, no attendance
        else if (visit)                  { st='OV'; totalOV++; }
        // Future days only: not yet absent — leave blank; TODAY with no punch/leave/visit shows AB (no punch/leave/visit posted).
        else if (date > todayNPPA)       { st='NA'; }
        else                             { st='AB'; totalAB++; }

        days[date] = st;
      }

      const otApprovedMins = approvedOTSumMapPA.get(emp.id) || 0;
      return {
        id: emp.id, empCode: emp.empCode, fullName: emp.fullName,
        branch: emp.branch || '', department: emp.department || '',
        position: emp.position || '', grade: emp.grade || '',
        mode: emp.mode || '', timingType: emp.timingType || '',
        shift: emp.shift || '',
        postShort:   emp.postShort   || abbrev(emp.position)   || '—',
        deptShort:   emp.deptShort   || abbrev(emp.department) || '—',
        branchShort: emp.branchShort || abbrev(emp.branch)     || '—',
        eligibleForOt: !!emp.eligible_for_ot,
        otApprovedMins,
        otApprovedFormatted: (emp.eligible_for_ot && otApprovedMins > 0) ? minsToHHMM(otApprovedMins) : '—',
        days, leaveCodes: leaveCodeMap[emp.id] || {}, totalP, totalAB, totalL, totalOV, totalPH, totalH,
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

// â”€â”€ GET /trend â€” daily present/absent/leave counts over a rolling window,
// for the Dashboard's trend sparkline. Deliberately modeled on /present-absent's
// range-query pattern (a handful of BETWEEN-bounded queries regardless of range
// length) rather than looping computeDailyAttendance() per day, which would mean
// up to 5 sequential DB round-trips PER day (incl. a per-employee LATERAL join) â€”
// too expensive to run 7-30 times in one request.
router.get('/trend', async (req, res) => {
  const pad = (n) => String(n).padStart(2, '0');
  const days = Math.min(30, Math.max(1, parseInt(req.query.days, 10) || 7));
  const endDate = (req.query.end || new Date().toISOString().split('T')[0]).trim();

  const endD   = new Date(endDate + 'T00:00:00');
  const startD = new Date(endD);
  startD.setDate(startD.getDate() - (days - 1));
  const startDate = `${startD.getFullYear()}-${pad(startD.getMonth() + 1)}-${pad(startD.getDate())}`;

  try {
    const [wkRes, publicHolidays] = await Promise.all([
      pool.query(`SELECT weekends FROM weekend_history WHERE effective_date <= $1 ORDER BY effective_date DESC, id DESC LIMIT 1`, [endDate]),
      loadPublicHolidays(),
    ]);
    const weekends   = wkRes.rows[0]?.weekends || ['Sat'];
    const getHoliday = await makeHolidayChecker(publicHolidays);
    const DOW        = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

    // Note: unlike computeDailyAttendance(), this uses only company-wide
    // weekend_history (no per-employee duty-roster off-day override) â€” an
    // acceptable simplification for a sparkline, not for authoritative reports.
    const dates = [];
    let cur = new Date(startDate + 'T00:00:00');
    const lastD = new Date(endDate + 'T00:00:00');
    while (cur <= lastD) {
      const dayKey  = DOW[cur.getDay()];
      const dateStr = `${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}`;
      dates.push({ date: dateStr, isWeekend: weekends.includes(dayKey), isHoliday: !!getHoliday(dateStr) });
      cur.setDate(cur.getDate() + 1);
    }

    const { scopeEmployeeId, isScoped } = resolveEmployeeScope(req);
    const empRes = await pool.query(
      `SELECT u.id, u.attendance_date::text AS att FROM users u WHERE u.active = true AND (u.is_system IS NOT TRUE AND u.role NOT IN ('superAdmin'))`
    );
    let employeeIds = empRes.rows.map(r => r.id);
    if (isScoped) {
      employeeIds = employeeIds.filter(id => String(id) === String(scopeEmployeeId));
    } else if (req.query.orgScope === '1') {
      const ids = await resolveOrgEmployeeIds(req);
      if (ids) employeeIds = employeeIds.filter(id => ids.includes(id));
    }
    const idSet = new Set(employeeIds.map(String));
    // Attendance Date per staff — days before it aren't counted as present/absent.
    const attStartTr = new Map(empRes.rows.filter(r => r.att).map(r => [String(r.id), r.att]));

    // Raw punches (widened range) bucketed by shift-day per employee — a
    // plain GROUP BY check_time::date could show a night-shift employee
    // present on the wrong calendar date (or miss/double-count them across
    // the two dates one overnight session touches). Still keeps this
    // endpoint's own documented simplification of company-wide-only
    // weekend/holiday detection above — only the punch grouping is fixed.
    const rangeStartTr = toDateStr(new Date(new Date(startDate).getTime() - 86400000));
    const rangeEndTr   = toDateStr(new Date(new Date(endDate).getTime()   + 86400000));
    const [rawLogsResTr, rosterMapTr, defShiftResTr] = await Promise.all([
      pool.query(`
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
      `, [rangeStartTr, rangeEndTr]),
      loadRosterMap(rangeStartTr, rangeEndTr),
      pool.query(`SELECT * FROM shifts WHERE make_default=TRUE LIMIT 1`),
    ]);
    const defShiftTr = defShiftResTr.rows[0];

    const rawByEmpTr = new Map();
    for (const r of rawLogsResTr.rows) {
      if (!rawByEmpTr.has(r.employee_id)) rawByEmpTr.set(r.employee_id, []);
      rawByEmpTr.get(r.employee_id).push(r.check_time);
    }
    const presentMap = {}; // dateStr -> Set of employeeIds with a punch that shift-day
    for (const empId of employeeIds) {
      const buckets = bucketPunchesByShiftDay(rawByEmpTr.get(empId) || [], empId, rosterMapTr, defShiftTr);
      for (const [dateStr, b] of buckets) {
        if (dateStr < startDate || dateStr > endDate || !b.timeIn) continue;
        if (!presentMap[dateStr]) presentMap[dateStr] = new Set();
        presentMap[dateStr].add(String(empId));
      }
    }

    const leavesRes = await pool.query(`
      SELECT l.employee_id, l.from_date, l.to_date
      FROM   leaves l WHERE l.status='approved' AND l.from_date <= $2 AND l.to_date >= $1
    `, [startDate, endDate]);
    const leaveMap = {}; // dateStr -> Set of employeeIds on approved leave
    for (const l of leavesRes.rows) {
      const from = new Date(l.from_date), to = new Date(l.to_date);
      for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
        const ds = d.toISOString().split('T')[0];
        if (ds >= startDate && ds <= endDate) {
          if (!leaveMap[ds]) leaveMap[ds] = new Set();
          leaveMap[ds].add(String(l.employee_id));
        }
      }
    }

    const out = dates.map(({ date, isWeekend, isHoliday }) => {
      if (isWeekend || isHoliday) return { date, present: 0, absent: 0, leave: 0 };
      const presentSet = presentMap[date] || new Set();
      const leaveSet    = leaveMap[date]  || new Set();
      let present = 0, absent = 0, leave = 0;
      for (const id of idSet) {
        if (attStartTr.get(id) && date < attStartTr.get(id)) continue;
        if (presentSet.has(id))    present++;
        else if (leaveSet.has(id)) leave++;
        else                       absent++;
      }
      return { date, present, absent, leave };
    });

    res.json({ days: out });
  } catch (err) {
    logError('[Attendance/trend]', err);
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
    const { scopeEmployeeId, isScoped } = resolveEmployeeScope(req);
    const [wkRows, publicHolidays, empRows, shiftRow] = await Promise.all([
      pool.query(`SELECT weekends, effective_date FROM weekend_history WHERE effective_date <= $1 ORDER BY effective_date ASC, id ASC`, [endDate]),
      loadPublicHolidays(),
      pool.query(`
        SELECT u.id, u.employee_id AS "empCode", u.full_name AS "fullName", u.department, u.position, u.branch,
               u.gender, u.religion, u.handicapped, u.shift, COALESCE(u.attendance_date, u.join_date) AS "joinDate",
               s.start_time AS shift_start, s.end_time AS shift_end,
               s.grace_period_start AS grace_st, s.grace_period_end AS grace_ed,
               s.winter_policy_enabled AS shift_winter_enabled, s.winter_policy AS shift_winter_policy
        FROM users u
        LEFT JOIN shifts s ON s.code = u.shift
        WHERE u.active=TRUE AND (u.is_system IS NOT TRUE AND u.role NOT IN ('superAdmin'))
        ORDER BY (SELECT MIN(b.ranking_order) FROM branches b WHERE b.name = u.branch) ASC NULLS LAST, u.ranking_order ASC NULLS LAST, u.full_name ASC`),
      pool.query(`SELECT * FROM shifts WHERE make_default=TRUE LIMIT 1`),
    ]);

    let employees = isScoped
      ? empRows.rows.filter(emp => String(emp.id) === String(scopeEmployeeId))
      : empRows.rows;
    // Management-role caller, not self-scoped → narrow to their own
    // branch/department (opt-in via ?orgScope=1) — see /half-monthly's
    // identical comment for why this is needed.
    if (!isScoped && req.query.orgScope === '1') {
      const ids = await resolveOrgEmployeeIds(req);
      if (ids) employees = employees.filter(emp => ids.includes(emp.id));
    }
    const defShift  = shiftRow.rows[0];
    const getHoliday = await makeHolidayChecker(publicHolidays);
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

    // All days in the year, unfiltered — kept alongside the company-wide
    // workingDays list below so each employee's roster (Day Off/Night Off,
    // or a custom recurring off-day) can correctly turn a normally-working
    // day into non-working FOR THEM, or vice versa, instead of every
    // employee being stuck with the same company-wide weekend regardless of
    // what's actually on their roster.
    const allYearDates = [];
    // All working days in the year (weekends + public holidays excluded) — company-wide default
    const workingDays = [];
    let yearTotalDays = 0, yearWeekendDays = 0, yearHolidayDays = 0;
    const cur = new Date(adYear, 0, 1);
    const end = new Date(adYear, 11, 31);
    while (cur <= end) {
      const ds  = `${cur.getFullYear()}-${pad(cur.getMonth()+1)}-${pad(cur.getDate())}`;
      const dow = DOW_KEYS[cur.getDay()];
      const isWkd = getWeekends(ds).includes(dow);
      const holidayName = getHoliday(ds);
      yearTotalDays++;
      if (isWkd) yearWeekendDays++;
      else if (holidayName) yearHolidayDays++;
      else workingDays.push(ds);
      allYearDates.push({ ds, dow, isHoliday: !!holidayName });
      cur.setDate(cur.getDate()+1);
    }
    // globalWorkingDays used only for the year total chip in the summary
    const globalWorkingDays = workingDays.length;
    // Widened a day each side — bucketPunchesByShiftDay needs "yesterday"'s
    // shift resolvable even for Jan 1st.
    const rangeStartYr = toDateStr(new Date(new Date(startDate).getTime() - 86400000));
    const rangeEndYr   = toDateStr(new Date(new Date(endDate).getTime()   + 86400000));
    const rosterMapYr = await loadRosterMap(rangeStartYr, rangeEndYr);

    // â”€â”€ Fetch entire year's raw punches, shift-day bucketed per employee â”€â”€
    // (widened range) — bucketPunchesByShiftDay aggregates below instead of
    // GROUP BY check_time::date, which pairs the wrong punches together for
    // a shift crossing midnight.
    const rawLogsResYr = await pool.query(`
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
    `, [rangeStartYr, rangeEndYr]);

    const rawByEmpYr = new Map();
    for (const r of rawLogsResYr.rows) {
      if (!rawByEmpYr.has(r.employee_id)) rawByEmpYr.set(r.employee_id, []);
      rawByEmpYr.get(r.employee_id).push(r.check_time);
    }
    const logsMap = {};
    for (const emp of employees) {
      const buckets = bucketPunchesByShiftDay(rawByEmpYr.get(emp.id) || [], emp.id, rosterMapYr, defShift);
      logsMap[emp.id] = {};
      for (const [dateStr, b] of buckets) {
        if (dateStr < startDate || dateStr > endDate) continue;
        logsMap[emp.id][dateStr] = { timeIn: b.timeIn, timeOut: b.timeOut, punches: b.punchCount };
      }
    }

    // Fetch all approved leaves for the year
    const lvRes = await pool.query(`
      SELECT l.employee_id, l.from_date, l.to_date,
             lt.name AS leave_type, lt.code AS leave_code,
             l.days AS leave_days_count, l.half_day
      FROM leaves l
      LEFT JOIN leave_types lt ON lt.code = l.leave_type_code
      WHERE l.status = 'approved'
        AND l.from_date <= $2 AND l.to_date >= $1
    `, [startDate, endDate]);

    const leaveMap     = {};  // empId â†’ Set of date strings on leave
    const halfLeaveMap = {};  // empId â†’ Set of half-day leave dates (subset of leaveMap)
    const leaveDaysMap = {};  // empId â†’ total approved leave days (authoritative — sums the stored `days`, 0.5-aware)
    for (const l of lvRes.rows) {
      if (!leaveMap[l.employee_id])     leaveMap[l.employee_id]     = new Set();
      if (!halfLeaveMap[l.employee_id]) halfLeaveMap[l.employee_id] = new Set();
      if (!leaveDaysMap[l.employee_id]) leaveDaysMap[l.employee_id] = 0;
      leaveDaysMap[l.employee_id] += parseFloat(l.leave_days_count || 0);
      const from = new Date(l.from_date), to = new Date(l.to_date);
      for (let d = new Date(from); d <= to; d.setDate(d.getDate()+1)) {
        const ds = d.toISOString().split('T')[0];
        if (ds >= startDate && ds <= endDate) {
          leaveMap[l.employee_id].add(ds);
          if (l.half_day) halfLeaveMap[l.employee_id].add(ds);
        }
      }
    }

    // Only approved OT counts in yearly analytics — use manager-set value
    const yearlyApprovedOTSet = await loadApprovedOTMap(startDate, endDate);

    const shiftStart = defShift?.start_time?.toString().substring(0,5) || '10:00';
    const shiftEnd   = defShift?.end_time?.toString().substring(0,5)   || '17:00';
    const graceSt    = defShift?.grace_period_start || 0;
    const graceEd    = defShift?.grace_period_end   || 0;
    const defWinterEnabled = defShift?.winter_policy_enabled;
    const defWinterPolicy  = defShift?.winter_policy;

    // Per-month breakdown for trend chart
    const monthlyTrend = Array.from({ length: 12 }, (_, mi) => ({
      month: mi, present: 0, absent: 0, leave: 0, late: 0, otMins: 0, staff: 0
    }));

    const allStats = employees.map(emp => {
      const empLogs      = logsMap[emp.id] || {};
      const empLeave     = leaveMap[emp.id] || new Set();
      const empHalfLeave = halfLeaveMap[emp.id] || new Set();

      // Effective start = Attendance Date (falls back to Join Date; if within this year) or Jan 1 of the year
      const rawJoin = emp.joinDate
        ? (emp.joinDate instanceof Date
            ? emp.joinDate.toISOString().split('T')[0]
            : String(emp.joinDate).split('T')[0])
        : startDate;
      const empStartDate = rawJoin > startDate ? rawJoin : startDate;

      // Only count working days on/after the employee's join date, with this
      // employee's own roster (if any) overriding the company-wide weekend
      // for each date — same override every other roster-aware report applies.
      const empWorkingDays = allYearDates
        // d.isHoliday is the shared, unscoped flag — re-checked per employee
        // here since a holiday can be limited to e.g. Gender=Female.
        .filter(d => d.ds >= empStartDate && !getHoliday(d.ds, emp))
        .filter(d => {
          const roster = getEffectiveRoster(rosterMapYr, emp.id, d.ds);
          return !isRosterWeekend(roster, d.dow, getWeekends(d.ds), defShift?.id);
        })
        .map(d => d.ds);
      const empTotalWorkDays = empWorkingDays.length;

      let presentDays=0, absentDays=0, leaveDays=0;
      let lateCount=0, earlyCount=0, otMins=0;
      let lateMinsTotal=0, earlyMinsTotal=0, totalWorkedMins=0;

      for (const ds of empWorkingDays) {
        const mi = parseInt(ds.split('-')[1]) - 1;
        if (empLeave.has(ds)) {
          const halfDay = empHalfLeave.has(ds) ? 0.5 : 1;
          leaveDays += halfDay;
          monthlyTrend[mi].leave += halfDay;
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

        // Effective shift for this employee on this date: roster override
        // (assigned/changed via Duty Roster) > the employee's own shift >
        // the company default — same precedence every other roster-aware
        // report uses. Previously this used the company default shift for
        // every employee's late/early/OT math regardless of their own shift
        // or any roster assignment.
        const rosterYr = getEffectiveRoster(rosterMapYr, emp.id, ds);
        const empShiftStartYr = emp.shift_start?.toString().substring(0,5) || shiftStart;
        const empShiftEndYr   = emp.shift_end?.toString().substring(0,5)   || shiftEnd;
        const empGraceStYr    = emp.grace_st ?? graceSt;
        const empGraceEdYr    = emp.grace_ed ?? graceEd;
        const empWinterEnabledYr = emp.shift_start ? emp.shift_winter_enabled : defWinterEnabled;
        const empWinterPolicyYr  = emp.shift_start ? emp.shift_winter_policy  : defWinterPolicy;
        const fallbackShiftYr = resolveWinterShift(ds, empShiftStartYr, empShiftEndYr, empGraceStYr, empGraceEdYr, empWinterEnabledYr, empWinterPolicyYr);
        const effShiftStartYr = rosterYr?.shiftStart || fallbackShiftYr.shiftStart;
        const effShiftEndYr   = rosterYr?.shiftEnd   || fallbackShiftYr.shiftEnd;
        const effGraceStYr    = rosterYr?.graceSt    != null ? rosterYr.graceSt : fallbackShiftYr.graceStart;
        const effGraceEdYr    = rosterYr?.graceEd    != null ? rosterYr.graceEd : fallbackShiftYr.graceEnd;
        const [sh, sm] = effShiftStartYr.split(':').map(Number);
        const [eh, em] = effShiftEndYr.split(':').map(Number);
        const [y2, mo2, dd2] = ds.split('-').map(Number);
        const sDt = shiftToUTC(y2, mo2, dd2, sh, sm);
        const eDt = shiftToUTC(y2, mo2, dd2, eh, em);
        if (eDt <= sDt) eDt.setUTCDate(eDt.getUTCDate()+1);

        const lateMins = Math.round((inDt - sDt) / 60000) - effGraceStYr;
        if (lateMins > 0) { lateCount++; lateMinsTotal += lateMins; monthlyTrend[mi].late++; }

        if (outDt) {
          const earlyMins = Math.round((eDt - outDt) / 60000) - effGraceEdYr;
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
      totalDays        : yearTotalDays,
      weekendDays      : yearWeekendDays,
      holidayDays      : yearHolidayDays,
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
// Punch notifications are scoped per viewer, same rule as every other list in
// the app (orgScope.js): Admin → everyone, Branch Manager → own branch, Dept
// Head → own department (in own branch), Branch Area Manager / Dept Incharge
// → their covered branches/departments, staff → only their own punches. The
// allowed-id set is refreshed every 5 minutes so newly added/transferred staff
// are picked up without a reconnect.
router.get('/live', async (req, res) => {
  let allowed = null;       // null = unrestricted (admin)
  let fetched = false;
  const load = async () => {
    try {
      const ids = await resolveOrgEmployeeIds(req);
      allowed = ids ? new Set(ids.map(Number)) : null;
      fetched = true;
    } catch (e) { logError('[attendance/live scope]', e); }
  };
  await load();
  // Until the scope has loaded at least once, show nothing rather than everything.
  const canSee = (empId) => fetched && (allowed === null || allowed.has(Number(empId)));
  const timer = setInterval(load, 5 * 60 * 1000);
  const cleanup = registerClient(res, canSee);
  req.on('close', () => { clearInterval(timer); cleanup(); });
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
        mp.created_at, mp.updated_at, mp.status, mp.comment,
        mp.applied_date AS "appliedDate", mp.approved_date AS "approvedDate",
        mp.employee_id       AS "employeeId",
        mp.recommended_by    AS "recommendedById",
        mp.approved_by       AS "approvedById",
        mp.updated_by         AS "updatedById",
        mp.updated_device     AS "updatedDevice",
        u.full_name          AS "fullName",
        u.employee_id        AS "staffId",
        COALESCE(NULLIF(TRIM(p.short_name),''),  LEFT(u.position,5))   AS "postShort",
        COALESCE(NULLIF(TRIM(dd.short_name),''), LEFT(u.department,5)) AS "deptShort",
        COALESCE(NULLIF(TRIM(br.short_name),''), LEFT(u.branch,4))     AS "branchShort",
        cb.full_name         AS "createdBy",
        rb.full_name         AS "recommendedByName",
        ab.full_name         AS "approvedByName",
        ub.full_name          AS "updatedByName"
      FROM attendance_manual_postings mp
      JOIN  users u  ON u.id = mp.employee_id
      LEFT JOIN LATERAL (SELECT * FROM posts WHERE LOWER(TRIM(name)) = LOWER(TRIM(u.position)) ORDER BY id LIMIT 1) p ON TRUE
      LEFT JOIN LATERAL (SELECT * FROM departments WHERE LOWER(TRIM(name)) = LOWER(TRIM(u.department)) ORDER BY id LIMIT 1) dd ON TRUE
      LEFT JOIN LATERAL (SELECT * FROM branches WHERE LOWER(TRIM(name)) = LOWER(TRIM(u.branch)) ORDER BY id LIMIT 1) br ON TRUE
      LEFT JOIN users cb ON cb.id = mp.created_by
      LEFT JOIN users rb ON rb.id = mp.recommended_by
      LEFT JOIN users ab ON ab.id = mp.approved_by
      LEFT JOIN users ub ON ub.id = mp.updated_by
      ORDER BY mp.date DESC, u.full_name ASC
    `);
    res.json(rows);
  } catch (e) {
    logError('[manual-postings GET]', e);
    res.status(500).json({ error: e.message });
  }
});

const isManualPostingAdmin = (req) => ['admin', 'superAdmin'].includes(req.user?.role);

router.post('/manual-postings', async (req, res) => {
  let { employeeId, date, checkIn, checkOut, remark, recommendedBy, approvedBy, isManual, deviceInfo } = req.body;
  // Branch Manager / Branch Area Manager posting from the Manual Posting grid
  // (isManual) for their own branch staff or themself lands Approved, same as
  // admin — see canManagerManualPost. The FAB's self-service "Inform Late
  // In/Early Out" sends no isManual, so it still goes in as Pending.
  const isAdmin = isManualPostingAdmin(req)
    || (isManual === true && await canManagerManualPost(req, employeeId).catch(() => false));
  if (!isAdmin && isManual === true) {
    return res.status(403).json({ error: 'You can only manually post for staff in your own branch.' });
  }

  // Self-service "Inform Late In/Early Out" (FAB, staff role) always posts
  // about the caller's own record, never anyone else's — a raw API call
  // can't override this by sending a different employeeId. Admin's own
  // manual-postings tool (ManualPostings.jsx grid) is unaffected — it can
  // still target any employee and lands as an immediately-approved record,
  // exactly as it always has.
  if (!isAdmin) employeeId = req.user?.id;
  if (!employeeId || !date) return res.status(400).json({ error: 'Employee and date are required' });

  // Mirrors leaves.js's POST: pending status leaves approved_by/approved_date
  // null — those are only ever set by an actual /approve or /reject call,
  // never at submission time. recommendedBy is likewise only persisted for
  // admin (the Manual Posting tool, backfilling/recording a decision that
  // already happened) — for a plain self-service submission it must NOT be
  // written into recommended_by at creation, since that column is meant to
  // be set only by the dedicated /recommend action once someone genuinely
  // acts on it (recommended_by ending up non-null the instant a staff
  // member merely picks a name in the apply form made every submission look
  // already-recommended, defeating "Recommendation Compulsory" entirely).
  const status = isAdmin ? 'approved' : 'pending';
  const finalRecoBy     = isAdmin ? (recommendedBy || null) : null;
  const finalApprovedBy = status === 'approved' ? (approvedBy || null) : null;

  try {
    const { rows } = await pool.query(`
      INSERT INTO attendance_manual_postings
        (employee_id, date, check_in, check_out, remark, recommended_by, approved_by, created_by, status, updated_by, updated_device)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *
    `, [employeeId, date, checkIn || null, checkOut || null, remark || null,
        finalRecoBy, finalApprovedBy, req.user?.id || null, status,
        req.user?.id || null, deviceInfo || null]);

    // Best-effort notification — never fail the request over email/message issues.
    try {
      const staffRow = (await pool.query('SELECT full_name FROM users WHERE id=$1', [employeeId])).rows[0];
      const notifyIds = [recommendedBy, approvedBy].filter(Boolean).map(Number);
      if (notifyIds.length) {
        const { rows: recipients } = await pool.query(
          `SELECT id, email, full_name FROM users WHERE id = ANY($1::int[])`, [notifyIds]
        );
        for (const r of recipients) {
          if (r.email) {
            await sendManualPostingApplication({
              to: r.email, fullName: staffRow?.full_name || '',
              date, checkIn, checkOut, remark: remark || '',
            });
          }
        }
        await notifyUsers({
          senderId: req.user?.id || employeeId,
          recipientIds: notifyIds,
          subject: `Manual Attendance Entry: ${staffRow?.full_name || ''}`,
          body: `A manual attendance entry was posted for ${staffRow?.full_name || 'a staff member'} on ${date}.`,
          path: '/m/approvals',
        });
      } else if (!isAdmin) {
        // the apply form named nobody: use the employee's configured recommenders/approvers (or admins) so it is never silent
        await notifyApproversOf(employeeId, {
          subject: `Late In / Early Out for approval: ${staffRow?.full_name || ''}`,
          body: `${staffRow?.full_name || 'A staff member'} applied for Late In / Early Out on ${date}${remark ? ' - ' + remark : ''}.`,
          path: '/m/approvals',
        });
      }
    } catch (notifyErr) {
      logError('[manual-postings POST notify]', notifyErr);
    }

    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') {
      return res.status(400).json({ error: 'A manual entry already exists for this staff member on this date — edit the existing one instead.' });
    }
    logError('[manual-postings POST]', e);
    res.status(500).json({ error: e.message });
  }
});

// Admins can always edit any entry; a staff member can edit their own
// self-service entry too, but only while it's still pending — once anyone
// has acted on it (recommended/approved/rejected) it's locked, same rule as
// Leave/Office Visit.
const MANUAL_POSTING_PRIVILEGED_ROLES = ['admin', 'superAdmin'];

// Branch Manager / Branch Area Manager editing or deleting a Manual Posting:
// any in-scope staff member's entry, or their own entry only when they
// posted it themself from the Manual Posting grid (created_by = them and
// already approved) — their own self-service Pending "Inform Late In" keeps
// the normal owner rule. No is_manual column on this table, hence created_by.
async function canManageManualPosting(req, row, newEmployeeId) {
  const self = String(req.user.id);
  const targets = [row.employee_id, newEmployeeId ?? row.employee_id];
  if (targets.some(id => String(id) === self)
      && !(String(row.created_by) === self && row.status === 'approved')) return false;
  return canManagerManualPost(req, ...targets).catch(() => false);
}

router.put('/manual-postings/:id', async (req, res) => {
  const { employeeId, date, checkIn, checkOut, remark, recommendedBy, approvedBy, deviceInfo } = req.body;
  try {
    const { rows: existingRows } = await pool.query('SELECT employee_id, status, recommended_by, created_by FROM attendance_manual_postings WHERE id=$1', [req.params.id]);
    if (!existingRows[0]) return res.status(404).json({ error: 'Not found' });
    const managerOk = await canManageManualPosting(req, existingRows[0], employeeId);
    const authError = managerOk ? null : authorizeOwnEditDelete(req, existingRows[0].employee_id, existingRows[0]);
    if (authError) return res.status(authError.status).json({ error: authError.error });

    // See leaves.js PUT for why: recommended_by/approved_by/employee_id are
    // only ever taken from the request for admin/superAdmin (or a Branch
    // Manager's Manual Posting, above) — a non-privileged owner is only
    // authorized above because their entry is still pending/untouched.
    const isPrivileged = MANUAL_POSTING_PRIVILEGED_ROLES.includes(req.user.role) || managerOk;
    const finalEmployeeId = isPrivileged ? employeeId : existingRows[0].employee_id;
    const finalRecoBy     = isPrivileged ? (recommendedBy || null) : null;
    const finalAppBy      = isPrivileged ? (approvedBy    || null) : null;

    const { rows } = await pool.query(`
      UPDATE attendance_manual_postings
      SET employee_id=$1, date=$2, check_in=$3, check_out=$4, remark=$5,
          recommended_by=$6, approved_by=$7, updated_at=NOW(), updated_by=$8, updated_device=$9
      WHERE id=$10 RETURNING *
    `, [finalEmployeeId, date, checkIn || null, checkOut || null, remark || null,
        finalRecoBy, finalAppBy, req.user.id, deviceInfo || null, req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) {
    logError('[manual-postings PUT]', e);
    res.status(500).json({ error: e.message });
  }
});

router.patch('/manual-postings/:id/recommend', async (req, res) => {
  try {
    const { rows: existingRows } = await pool.query('SELECT employee_id FROM attendance_manual_postings WHERE id=$1', [req.params.id]);
    if (!existingRows[0]) return res.status(404).json({ error: 'Not found' });
    const authError = await authorizeRecoAction(req, existingRows[0].employee_id, 'recommend');
    if (authError) return res.status(authError.status).json({ error: authError.error });

    const { rows } = await pool.query(
      `UPDATE attendance_manual_postings SET recommended_by=$1, comment=COALESCE(NULLIF($3,''), comment), updated_at=NOW() WHERE id=$2 RETURNING *`,
      [req.user.id, req.params.id, String(req.body?.comment || '').slice(0, 500)]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) {
    logError('[manual-postings recommend]', e);
    res.status(500).json({ error: e.message });
  }
});

router.patch('/manual-postings/:id/approve', async (req, res) => {
  const { comment } = req.body;
  try {
    const { rows: existingRows } = await pool.query('SELECT employee_id, recommended_by FROM attendance_manual_postings WHERE id=$1', [req.params.id]);
    if (!existingRows[0]) return res.status(404).json({ error: 'Not found' });
    const authError = await authorizeRecoAction(req, existingRows[0].employee_id, 'approve',
      { alreadyRecommended: !!existingRows[0].recommended_by });
    if (authError) return res.status(authError.status).json({ error: authError.error });

    const { rows } = await pool.query(`
      UPDATE attendance_manual_postings SET status='approved', approved_by=$1, approved_date=CURRENT_DATE, comment=$2, updated_at=NOW()
      WHERE id=$3 RETURNING *
    `, [req.user.id, comment || '', req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    notifyApplicantOf(rows[0].employee_id, req.user.id, { subject: 'Late In / Early Out approved', body: `Your Late In / Early Out for ${String(rows[0].date).slice(0, 10)} was approved.${comment ? ' ' + comment : ''}`, path: '/m/leave' });
    logAudit({ actor: req.user, action: 'approve', entity: 'manual-posting', entityId: req.params.id, before: null, after: rows[0] });
    res.json(rows[0]);
  } catch (e) {
    logError('[manual-postings approve]', e);
    res.status(500).json({ error: e.message });
  }
});

router.patch('/manual-postings/:id/reject', async (req, res) => {
  const { comment } = req.body;
  try {
    const { rows: existingRows } = await pool.query('SELECT employee_id FROM attendance_manual_postings WHERE id=$1', [req.params.id]);
    if (!existingRows[0]) return res.status(404).json({ error: 'Not found' });
    const authError = await authorizeRecoAction(req, existingRows[0].employee_id, 'reject');
    if (authError) return res.status(authError.status).json({ error: authError.error });

    const { rows } = await pool.query(`
      UPDATE attendance_manual_postings SET status='rejected', approved_by=$1, approved_date=CURRENT_DATE, comment=$2, updated_at=NOW()
      WHERE id=$3 RETURNING *
    `, [req.user.id, comment || '', req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    notifyApplicantOf(rows[0].employee_id, req.user.id, { subject: 'Late In / Early Out rejected', body: `Your Late In / Early Out for ${String(rows[0].date).slice(0, 10)} was rejected.${comment ? ' Reason: ' + comment : ''}`, path: '/m/leave' });
    logAudit({ actor: req.user, action: 'reject', entity: 'manual-posting', entityId: req.params.id, before: null, after: rows[0] });
    res.json(rows[0]);
  } catch (e) {
    logError('[manual-postings reject]', e);
    res.status(500).json({ error: e.message });
  }
});

router.delete('/manual-postings/:id', async (req, res) => {
  try {
    const { rows: existingRows } = await pool.query('SELECT employee_id, status, recommended_by, created_by FROM attendance_manual_postings WHERE id=$1', [req.params.id]);
    if (!existingRows[0]) return res.status(404).json({ error: 'Not found' });
    const managerOk = await canManageManualPosting(req, existingRows[0]);
    const authError = managerOk ? null : authorizeOwnEditDelete(req, existingRows[0].employee_id, existingRows[0]);
    if (authError) return res.status(authError.status).json({ error: authError.error });

    await pool.query('DELETE FROM attendance_manual_postings WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    logError('[manual-postings DELETE]', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Missing Attendance Requests ──────────────────────────────────────────────
// Employee-initiated "I was actually present but attendance wasn't recorded"
// requests. Notifies the assigned recommender/approver by email + in-app
// message; approval upserts a real attendance_manual_postings row.

const toMissingRequest = r => ({
  id: r.id, employeeId: r.employee_id, employeeName: r.employee_name,
  date: r.date, checkIn: r.check_in, checkOut: r.check_out, reason: r.reason,
  recommendedBy: r.recommended_by, recommendedByName: r.recommended_by_name,
  approvedBy: r.approved_by, approvedByName: r.approved_by_name,
  status: r.status, comment: r.comment,
  createdAt: r.created_at, decidedAt: r.decided_at,
});

router.get('/missing-requests', async (req, res) => {
  const { scopeEmployeeId, isScoped } = resolveEmployeeScope(req);
  try {
    const { rows } = await pool.query(`
      SELECT mr.*, u.full_name AS employee_name,
             rb.full_name AS recommended_by_name, ab.full_name AS approved_by_name
      FROM   attendance_missing_requests mr
      JOIN   users u  ON u.id = mr.employee_id
      LEFT   JOIN users rb ON rb.id = mr.recommended_by
      LEFT   JOIN users ab ON ab.id = mr.approved_by
      WHERE  ($1::boolean IS FALSE) OR (mr.employee_id = $2 OR mr.recommended_by = $2 OR mr.approved_by = $2)
      ORDER  BY mr.created_at DESC
    `, [isScoped, scopeEmployeeId]);
    let requests = rows.map(toMissingRequest);
    if (!isScoped && req.query.orgScope === '1') {
      const ids = await resolveOrgEmployeeIds(req);
      if (ids) requests = requests.filter(r => ids.includes(r.employeeId));
    }
    res.json(requests);
  } catch (e) {
    logError('[missing-requests GET]', e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/missing-requests', async (req, res) => {
  const { date, checkIn, checkOut, reason, recommendedBy, approvedBy } = req.body;
  // Self-service always posts about the caller's own record. Only
  // admin/superAdmin (posting on an employee's behalf from a grid's context
  // menu) can target someone else — same rule as Leave/Office Visit posting.
  let { employeeId } = req.body;
  const isPrivileged = MANUAL_POSTING_PRIVILEGED_ROLES.includes(req.user.role);
  if (!isPrivileged || !employeeId) employeeId = req.user.id;
  if (!date || !reason?.trim()) {
    return res.status(400).json({ error: 'Date and reason are required' });
  }
  try {
    const { rows } = await pool.query(`
      INSERT INTO attendance_missing_requests
        (employee_id, date, check_in, check_out, reason, recommended_by, approved_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *
    `, [employeeId, date, checkIn || null, checkOut || null, reason.trim(),
        recommendedBy || null, approvedBy || null]);
    const request = rows[0];

    // Best-effort notification — never fail the request over email/message issues.
    try {
      const requester = (await pool.query('SELECT full_name FROM users WHERE id=$1', [employeeId])).rows[0];
      const notifyIds = [recommendedBy, approvedBy].filter(Boolean).map(Number);
      if (notifyIds.length) {
        const { rows: recipients } = await pool.query(
          `SELECT id, email, full_name FROM users WHERE id = ANY($1::int[])`, [notifyIds]
        );
        for (const r of recipients) {
          if (r.email) {
            await sendMissingAttendanceApplication({
              to: r.email, fullName: requester?.full_name || '',
              date, checkIn, checkOut, reason: reason.trim(),
            });
          }
        }
        await notifyUsers({
          senderId: employeeId,
          recipientIds: notifyIds,
          subject: `Missing Attendance Request: ${requester?.full_name || ''}`,
          body: `${requester?.full_name || 'A staff member'} requested missing attendance for ${date}. Reason: ${reason.trim()}`,
          path: '/m/approvals',
        });
      }
    } catch (notifyErr) {
      logError('[missing-requests POST notify]', notifyErr);
    }

    res.status(201).json(toMissingRequest(request));
  } catch (e) {
    logError('[missing-requests POST]', e);
    res.status(500).json({ error: e.message });
  }
});

router.patch('/missing-requests/:id/recommend', async (req, res) => {
  const { comment } = req.body;
  try {
    const { rows } = await pool.query('SELECT * FROM attendance_missing_requests WHERE id=$1', [req.params.id]);
    const existing = rows[0];
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const authError = await authorizeRecoAction(req, existing.employee_id, 'recommend');
    if (authError) return res.status(authError.status).json({ error: authError.error });
    if (existing.status !== 'pending') {
      return res.status(400).json({ error: `Cannot recommend a request that is already ${existing.status}` });
    }
    const { rows: updated } = await pool.query(`
      UPDATE attendance_missing_requests SET status='recommended', comment=$1 WHERE id=$2 RETURNING *
    `, [comment || null, req.params.id]);
    res.json(toMissingRequest(updated[0]));
  } catch (e) {
    logError('[missing-requests recommend]', e);
    res.status(500).json({ error: e.message });
  }
});

router.patch('/missing-requests/:id/approve', async (req, res) => {
  const { comment } = req.body;
  try {
    const { rows } = await pool.query('SELECT * FROM attendance_missing_requests WHERE id=$1', [req.params.id]);
    const existing = rows[0];
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const authError = await authorizeRecoAction(req, existing.employee_id, 'approve',
      { alreadyRecommended: existing.status === 'recommended' || existing.status === 'approved' });
    if (authError) return res.status(authError.status).json({ error: authError.error });
    if (!['pending', 'recommended'].includes(existing.status)) {
      return res.status(400).json({ error: `Cannot approve a request that is already ${existing.status}` });
    }
    const { rows: updated } = await pool.query(`
      UPDATE attendance_missing_requests
      SET status='approved', comment=$1, decided_at=NOW()
      WHERE id=$2 RETURNING *
    `, [comment || null, req.params.id]);
    notifyApplicantOf(existing.employee_id, req.user.id, { subject: 'Missing attendance approved', body: `Your missing attendance request for ${String(existing.date).slice(0, 10)} was approved.${comment ? ' ' + comment : ''}`, path: '/m/leave' });

    await pool.query(`
      INSERT INTO attendance_manual_postings
        (employee_id, date, check_in, check_out, remark, recommended_by, approved_by, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (employee_id, date) DO UPDATE SET
        check_in = EXCLUDED.check_in, check_out = EXCLUDED.check_out,
        remark = EXCLUDED.remark, recommended_by = EXCLUDED.recommended_by,
        approved_by = EXCLUDED.approved_by, status = 'approved', updated_at = NOW()
    `, [existing.employee_id, existing.date, existing.check_in, existing.check_out,
        `Missing attendance request: ${existing.reason}`,
        existing.recommended_by, req.user.id, existing.employee_id]);

    res.json(toMissingRequest(updated[0]));
  } catch (e) {
    logError('[missing-requests approve]', e);
    res.status(500).json({ error: e.message });
  }
});

router.patch('/missing-requests/:id/reject', async (req, res) => {
  const { comment } = req.body;
  try {
    const { rows } = await pool.query('SELECT * FROM attendance_missing_requests WHERE id=$1', [req.params.id]);
    const existing = rows[0];
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const authError = await authorizeRecoAction(req, existing.employee_id, 'reject');
    if (authError) return res.status(authError.status).json({ error: authError.error });
    if (!['pending', 'recommended'].includes(existing.status)) {
      return res.status(400).json({ error: `Cannot reject a request that is already ${existing.status}` });
    }
    const { rows: updated } = await pool.query(`
      UPDATE attendance_missing_requests
      SET status='rejected', comment=$1, decided_at=NOW()
      WHERE id=$2 RETURNING *
    `, [comment || null, req.params.id]);
    notifyApplicantOf(existing.employee_id, req.user.id, { subject: 'Missing attendance rejected', body: `Your missing attendance request for ${String(existing.date).slice(0, 10)} was rejected.${comment ? ' Reason: ' + comment : ''}`, path: '/m/leave' });
    res.json(toMissingRequest(updated[0]));
  } catch (e) {
    logError('[missing-requests reject]', e);
    res.status(500).json({ error: e.message });
  }
});

router.delete('/missing-requests/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM attendance_missing_requests WHERE id=$1', [req.params.id]);
    const existing = rows[0];
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const authError = authorizeOwnEditDelete(req, existing.employee_id, existing);
    if (authError) return res.status(authError.status).json({ error: authError.error });
    await pool.query('DELETE FROM attendance_missing_requests WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    logError('[missing-requests DELETE]', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Relink attendance logs to staff ─────────────────────────────────────────
// A punch's employee_id is normally resolved once, at insert time, by
// matching pin → users.device_id (see saveAttlogs() in zktecoService.js).
// If a bulk import brings in historical logs before staff's Device ID is
// set, or a device_id gets assigned/corrected after logs already streamed
// in, those rows stay employee_id=NULL forever — computeDailyAttendance()
// (and every other report) explicitly excludes NULL employee_id rows, so a
// staff member with real punches on file can still show as Absent. This
// re-runs that same match against CURRENT users.device_id values, so fixing
// or backfilling a Device ID retroactively repairs every past report too.
// Staff Ledger right-click → Delete Time In / Time Out Log (Admin only).
// Removes the raw device log(s) behind one displayed punch so the report
// re-pairs from what's left — e.g. a stray duplicate that became the Time
// Out. Matches to the second, the precision devices record at. The deleted
// rows go to the audit log in full so one can be re-inserted if needed.
// Approved Manual Postings aren't device logs — they're removed from the
// Manual Postings page instead, so this returns a pointer there.
router.post('/logs/delete-punch', requireRole('admin', 'superAdmin'), async (req, res) => {
  try {
    const employeeId = parseInt(req.body?.employeeId, 10);
    const ts = new Date(req.body?.checkTime);
    if (!employeeId || isNaN(ts)) return res.status(400).json({ error: 'employeeId and checkTime are required' });
    const { rows } = await pool.query(`
      DELETE FROM zkteco_attendance_logs
      WHERE employee_id = $1 AND date_trunc('second', check_time) = date_trunc('second', $2::timestamptz)
      RETURNING *`, [employeeId, ts.toISOString()]);
    if (!rows.length) {
      return res.status(404).json({ error: 'No device log found at this time — if it came from a Manual Posting, delete it from Attendance → Manual Postings.' });
    }
    for (const r of rows) {
      logAudit({ actor: req.user, action: 'delete', entity: 'attendance-log', entityId: r.id, before: r, after: null });
    }
    res.json({ deleted: rows.length });
  } catch (e) {
    logError('[attendance delete-punch]', e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/relink-logs', requireRole('admin', 'superAdmin'), async (req, res) => {
  try {
    const { rowCount } = await pool.query(`
      UPDATE zkteco_attendance_logs l
      SET employee_id = u.id
      FROM users u
      WHERE l.employee_id IS NULL AND u.device_id = l.pin
    `);
    const { rows: stillUnmatched } = await pool.query(`
      SELECT pin, COUNT(*)::int AS count
      FROM zkteco_attendance_logs
      WHERE employee_id IS NULL
      GROUP BY pin
      ORDER BY count DESC
    `);
    // Read-only roster / default-shift check over the recent window — changes
    // nothing, just lists punches that look off against the duty roster so an
    // admin can review them. A failure here never fails the relink itself.
    let rosterCheck = null;
    try {
      const days = Math.min(92, Math.max(1, parseInt(req.body?.days, 10) || 31));
      const todayNP = new Date(Date.now() + NEPAL_MS).toISOString().slice(0, 10);
      const startDate = new Date(Date.parse(todayNP) - (days - 1) * 86400000).toISOString().slice(0, 10);
      const rangeStart = toDateStr(new Date(Date.parse(startDate) - 86400000));
      const rangeEnd   = toDateStr(new Date(Date.parse(todayNP) + 86400000));
      const [rawRes, rosterMap, defRes, empRes] = await Promise.all([
        pool.query(`
          SELECT employee_id, check_time FROM zkteco_attendance_logs
          WHERE check_time::date BETWEEN $1 AND $2 AND employee_id IS NOT NULL
          UNION ALL
          SELECT employee_id, (date + check_in)::timestamp::timestamptz FROM attendance_manual_postings
          WHERE date BETWEEN $1 AND $2 AND check_in IS NOT NULL AND status = 'approved'
          UNION ALL
          SELECT employee_id, (date + check_out)::timestamp::timestamptz FROM attendance_manual_postings
          WHERE date BETWEEN $1 AND $2 AND check_out IS NOT NULL AND status = 'approved'`,
          [rangeStart, rangeEnd]),
        loadRosterMap(rangeStart, rangeEnd),
        pool.query(`SELECT * FROM shifts WHERE make_default=TRUE LIMIT 1`),
        pool.query(`SELECT id, full_name, employee_id AS code, attendance_date::text AS att FROM users WHERE active = TRUE AND (is_system IS NOT TRUE AND role NOT IN ('superAdmin'))`),
      ]);
      const defShift = defRes.rows[0];
      const byEmp = new Map();
      for (const r of rawRes.rows) {
        if (!byEmp.has(r.employee_id)) byEmp.set(r.employee_id, []);
        byEmp.get(r.employee_id).push(r.check_time);
      }
      const offDayPunches = [], singlePunchDays = [], otMismatches = [];
      // Staff with an evening check-in left open and a next-morning punch
      // sitting alone on the following day, on days no roster entry covers —
      // the signature of a night shift whose roster was never created.
      const unrosteredNight = new Map(); // empId → { employeeId, name, code, dates[] }
      const localHour = (ts) => new Date(ts.getTime() + NEPAL_MS).getUTCHours();
      const nextDay = (d) => new Date(Date.parse(d) + 86400000).toISOString().slice(0, 10);
      const bucketsByEmp = new Map();
      for (const emp of empRes.rows) {
        const punches = byEmp.get(emp.id);
        if (!punches?.length) continue;
        const buckets = bucketPunchesByShiftDay(punches, emp.id, rosterMap, defShift);
        bucketsByEmp.set(emp.id, buckets);
        for (const [date, b] of buckets) {
          if (date < startDate || date > todayNP) continue;
          if (emp.att && date < emp.att) continue; // before Attendance Date: not reported on
          const roster = getEffectiveRoster(rosterMap, emp.id, date);
          const base = { employeeId: emp.id, name: emp.full_name, code: emp.code, date };
          if (roster?.isOff) {
            offDayPunches.push({ ...base, kind: offTypeName(roster.shiftName), punches: b.punchCount });
          } else if (b.punchCount === 1 && date < todayNP) {
            singlePunchDays.push({ ...base, shift: roster?.shiftName || defShift?.name || null });
          }
          if (!roster?.hasExactEntry && b.punchCount === 1 && localHour(b.timeIn) >= 16) {
            const nb = buckets.get(nextDay(date));
            if (nb && localHour(nb.timeIn) < 12) {
              if (!unrosteredNight.has(emp.id)) unrosteredNight.set(emp.id, { employeeId: emp.id, name: emp.full_name, code: emp.code, dates: [] });
              unrosteredNight.get(emp.id).dates.push(date);
            }
          }
        }
      }

      // Approved OT is stored against a fixed date — flag approvals whose date
      // no longer has any attendance (e.g. the roster change moved the punches
      // to the adjacent shift-day) so it can be re-approved on the right day.
      const otRes = await pool.query(
        `SELECT employee_id, date::text AS dt, ot_minutes FROM overtime_approvals
         WHERE status = 'approved' AND date BETWEEN $1 AND $2 AND ot_minutes > 0`,
        [startDate, todayNP]);
      const empById = new Map(empRes.rows.map(e => [e.id, e]));
      for (const o of otRes.rows) {
        const emp = empById.get(o.employee_id);
        if (!emp) continue;
        if (emp.att && o.dt < emp.att) continue;
        const buckets = bucketsByEmp.get(o.employee_id);
        if (buckets?.has(o.dt)) continue;
        const prev = toDateStr(new Date(Date.parse(o.dt) - 86400000));
        const adjacent = buckets?.has(nextDay(o.dt)) ? nextDay(o.dt) : buckets?.has(prev) ? prev : null;
        otMismatches.push({
          employeeId: emp.id, name: emp.full_name, code: emp.code, date: o.dt,
          otMinutes: o.ot_minutes, punchesOn: adjacent,
        });
      }

      const byDate = (a, b) => b.date.localeCompare(a.date);
      offDayPunches.sort(byDate); singlePunchDays.sort(byDate); otMismatches.sort(byDate);
      const likelyNight = [...unrosteredNight.values()]
        .filter(x => x.dates.length >= 2)
        .map(x => ({ ...x, count: x.dates.length, dates: x.dates.sort().slice(-5) }))
        .sort((a, b) => b.count - a.count);
      rosterCheck = {
        startDate, endDate: todayNP, days,
        offDayPunchCount: offDayPunches.length,
        singlePunchCount: singlePunchDays.length,
        offDayPunches: offDayPunches.slice(0, 50),
        singlePunchDays: singlePunchDays.slice(0, 50),
        unrosteredNightCount: likelyNight.length,
        unrosteredNight: likelyNight.slice(0, 50),
        otMismatchCount: otMismatches.length,
        otMismatches: otMismatches.slice(0, 50),
      };
    } catch (ce) {
      logError('[attendance/relink-logs roster-check]', ce);
    }
    res.json({ relinked: rowCount, stillUnmatched, rosterCheck });
  } catch (e) {
    logError('[attendance/relink-logs]', e);
    res.status(500).json({ error: e.message });
  }
});

export default router;

