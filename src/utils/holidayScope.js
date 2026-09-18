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
