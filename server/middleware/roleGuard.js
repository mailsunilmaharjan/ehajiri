/**
 * Middleware factory — restricts a route to a specific allowlist of roles.
 * Must run after authGuard (relies on req.user.role being populated).
 *
 *   router.post('/devices/:id/enroll-fp', requireRole('admin','branchManager','superAdmin'), handler)
 */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ authError: true, error: 'Authentication required' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ authError: true, error: 'You do not have permission to perform this action' });
    }
    next();
  };
}
