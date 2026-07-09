const MANAGEMENT_ROLES = new Set(['admin', 'superAdmin', 'branchManager', 'departmentHead']);

export function isEmployeeScopedUser(user) {
  const role = user?.role;
  if (!role) return false;
  return !MANAGEMENT_ROLES.has(role);
}

export function resolveEmployeeScope(req, requestedEmployeeId = null) {
  if (!req?.user?.id) {
    return { scopeEmployeeId: null, isScoped: false };
  }

  const userId = Number(req.user.id);
  if (!Number.isFinite(userId)) {
    return { scopeEmployeeId: null, isScoped: false };
  }

  if (!isEmployeeScopedUser(req.user)) {
    return { scopeEmployeeId: null, isScoped: false };
  }

  const requestedId = requestedEmployeeId != null ? Number(requestedEmployeeId) : null;
  const effectiveId = Number.isFinite(requestedId) && requestedId === userId ? requestedId : userId;

  return { scopeEmployeeId: effectiveId, isScoped: true };
}
