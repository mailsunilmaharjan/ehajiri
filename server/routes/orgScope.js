import pool from '../db.js';

/**
 * Org-hierarchy scoping — mirrors attendanceScope.js's shape, but for
 * department/branch/self scoping (rather than binary self-vs-everyone),
 * used by features that need Dept. Head / Branch Manager to only ever
 * see/act on their own department's or branch's staff (e.g. Duty Roster,
 * OT Approval).
 */
export function resolveOrgScope(req) {
  const { role, department, branch, id } = req.user || {};
  if (role === 'admin' || role === 'superAdmin') return { level: 'all' };
  if (role === 'branchManager' && branch) return { level: 'branch', value: branch };
  if (role === 'departmentHead' && department) return { level: 'department', value: department };
  return { level: 'self', value: id };
}

// Resolves an org-scope into an actual list of employee IDs, for routes that
// need to filter a result set down to "my branch" / "my department" rather
// than just knowing the scope level. Mirrors AuthContext.jsx's filterByRole()
// matching rule exactly (case-insensitive, trimmed) so a manager sees the
// same set of people here as everywhere else in the app. Returns null when
// there's no restriction (admin/superAdmin) — caller should skip filtering.
export async function resolveOrgEmployeeIds(req) {
  const scope = resolveOrgScope(req);
  if (scope.level === 'all') return null;
  if (scope.level === 'self') return [scope.value];
  const col = scope.level === 'branch' ? 'branch' : 'department';
  const { rows } = await pool.query(
    `SELECT id FROM users WHERE LOWER(TRIM(${col})) = LOWER(TRIM($1))`,
    [scope.value]
  );
  return rows.map(r => r.id);
}
