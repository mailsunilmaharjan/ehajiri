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
