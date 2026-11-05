/**
 * Client-side mirror of server/routes/attendance.js's holidayScopeMatches /
 * makeHolidayChecker — a Public Holiday (Settings → Public Holiday) can be
 * limited to a Gender/Branch/Department/Religion/Handicapped subset, so
 * "is `ds` a holiday" always needs the specific employee it's being checked
 * for, not just the date. Used by leave-day calculators (LeaveApplyModal,
 * LeaveVisitPage) so a holiday that doesn't apply to this employee never
 * silently eats one of their leave days.
 */

// Case/whitespace-insensitive match against a holiday's scope array — an
// empty array or the special 'All' entry means unscoped (matches everyone).
// `idToNameMap` resolves a scope entry that's a lookup-table id to its name
// before comparing — the Branch/Department/Religion dropdowns in Settings →
// Public Holiday save the record's id, not its name (see
// PublicHolidaySection's branchOpts/deptOpts/religionOpts in Settings.jsx),
// while an employee's branch/department/religion are stored as names.
const holidayScopeMatches = (scopeArr, empValue, idToNameMap = null) => {
  if (!scopeArr || !scopeArr.length || scopeArr.includes('All')) return true;
  if (empValue == null || empValue === '') return false;
  const norm = (v) => String(v).toLowerCase().trim();
  const resolved = idToNameMap ? scopeArr.map(v => idToNameMap.get(String(v)) || v) : scopeArr;
  return resolved.some(v => norm(v) === norm(empValue));
};

const idMap = (list) => new Map((list || []).map(x => [String(x.id), x.name]));

/** Returns the holiday name if `ds` (YYYY-MM-DD) falls within a configured
 *  public holiday that `emp` is in scope for, else null. `settings` is the
 *  app settings object (publicHolidays + branches/departments/religions for
 *  id→name resolution). `emp` may be null/undefined — only fully-unscoped
 *  holidays match in that case. */
export function getHolidayNameForEmployee(settings, ds, emp) {
  const branchNameById   = idMap(settings?.branches);
  const deptNameById     = idMap(settings?.departments);
  const religionNameById = idMap(settings?.religions);
  const h = (settings?.publicHolidays || []).find(ph => {
    if (!ph.startDate || !ph.endDate || ds < ph.startDate || ds > ph.endDate) return false;
    return holidayScopeMatches(ph.gender,      emp?.gender)
        && holidayScopeMatches(ph.branch,      emp?.branch,     branchNameById)
        && holidayScopeMatches(ph.department,  emp?.department, deptNameById)
        && holidayScopeMatches(ph.religion,    emp?.religion,   religionNameById)
        && holidayScopeMatches(ph.handicapped, emp ? (emp.handicapped ? 'Yes' : 'No') : null);
  });
  return h?.name || null;
}

export function isHolidayForEmployee(settings, ds, emp) {
  return !!getHolidayNameForEmployee(settings, ds, emp);
}

const WEEKDAY_NUM = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };

// weekend_history.effective_date comes back from the API either as a plain
// YYYY-MM-DD or as a pg DATE serialised to a UTC timestamp (local midnight in
// Nepal → "…-05T18:15:00Z" for the 6th) — read the latter in local time so it
// isn't a day early.
const toLocalISO = (v) => {
  const s = String(v || '');
  if (s.length <= 10) return s;
  const d = new Date(s);
  if (isNaN(d)) return s.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Weekend day names in effect on `ds`, from Settings → Weekend History
 *  (latest entry with effectiveDate <= ds) — the same rule every attendance
 *  report applies server-side. `defaultWeekends` is only a fallback: it's a
 *  stale single value that isn't updated when a history entry is added
 *  elsewhere, so a Sat→Sat+Sun change never reached the leave calculator. */
export function getWeekendsForDate(settings, ds) {
  const entry = (settings?.weekendHistory || [])
    .map(h => ({ ...h, eff: toLocalISO(h.effectiveDate) }))
    .filter(h => h.eff && h.eff <= ds && Array.isArray(h.weekends))
    .sort((a, b) => (a.eff < b.eff ? 1 : a.eff > b.eff ? -1 : (Number(b.id) || 0) - (Number(a.id) || 0)))[0];
  return entry?.weekends || settings?.defaultWeekends || ['Sat'];
}

/** Number of leave days between fromDate and toDate (YYYY-MM-DD, inclusive)
 *  for `emp`, honouring the leave type's "Reduce Weekend" / "Reduce Public
 *  Holiday" settings. Iterates in UTC so the per-day YYYY-MM-DD string never
 *  shifts — the old calculators built a local-midnight Date and read it back
 *  with toISOString(), which in Nepal (UTC+5:45) yields the PREVIOUS day, so
 *  a holiday inside the range was checked against the wrong date and never
 *  deducted. Half day is the caller's concern. */
export function countLeaveDays(settings, ltConfig, fromDate, toDate, emp) {
  const fromStr = String(fromDate || '').slice(0, 10);
  const toStr   = String(toDate   || '').slice(0, 10);
  if (!fromStr || !toStr) return 0;
  const from = new Date(fromStr + 'T00:00:00Z');
  const to   = new Date(toStr   + 'T00:00:00Z');
  if (isNaN(from) || isNaN(to) || to < from) return 0;
  let count = 0;
  for (let d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    const ds = d.toISOString().slice(0, 10);
    if (ltConfig?.reduceWeekend
        && getWeekendsForDate(settings, ds).some(w => WEEKDAY_NUM[w] === d.getUTCDay())) continue;
    if (ltConfig?.reducePublicHoliday && isHolidayForEmployee(settings, ds, emp)) continue;
    count++;
  }
  return count;
}
