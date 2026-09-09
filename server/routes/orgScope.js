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
  if (role === 'departmentHead' && department) {
    // A Department Head is scoped to their own branch too, not the whole
    // department company-wide — a multi-branch company (confirmed live on
    // the Omni tenant: "Sales" spans 8 different branches) would otherwise
    // hand a dept head visibility into every other branch's staff in their
    // department, not just their own local team. branchValue is additive
    // (level/value stay 'department'/department name) so any consumer that
    // predates this and only checks level/value keeps working — it just
    // won't get the branch narrowing until it's updated to look at it too.
    return branch ? { level: 'department', value: department, branchValue: branch }
                   : { level: 'department', value: department };
  }
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
  const params = [scope.value];
  let where = `LOWER(TRIM(${col})) = LOWER(TRIM($1))`;
  if (scope.branchValue) {
    params.push(scope.branchValue);
    where += ` AND LOWER(TRIM(branch)) = LOWER(TRIM($2))`;
  }
  const { rows } = await pool.query(`SELECT id FROM users WHERE ${where}`, params);
  return rows.map(r => r.id);
}

// Employees for whom req.user is explicitly configured as recommender or
// approver (Staff Detail → "Set Recommendator & Approval"), regardless of
// department/branch. That feature exists specifically to let someone act
// outside their own org unit — e.g. a department head approving a request
// from a different department — so a branch/department-narrowed employee-id
// list (resolveOrgEmployeeIds) must be widened with this before it's used to
// filter leaves/office_visits, or the assigned approver never even receives
// the record to evaluate. Returns [] when the caller has no such assignments.
export async function resolveRecoApprovalEmployeeIds(req) {
  const uid = req.user?.id;
  if (!uid) return [];
  const { rows } = await pool.query(
    `SELECT employee_id FROM reco_approval_assignments
     WHERE $1 = ANY(recommender_ids) OR $1 = ANY(approver_ids)`,
    [uid]
  );
  return rows.map(r => r.employee_id);
}
