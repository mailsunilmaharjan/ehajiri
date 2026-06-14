import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'ehajiri_jwt_secret_change_me';

/**
 * Validates `Authorization: Bearer <token>`, verifies the JWT, and attaches
 * the decoded payload to req.user. Returns 401 JSON on missing/invalid/expired
 * tokens — mirrors licenseGuard's JSON error shape so existing clients (which
 * already read err.data) handle it the same way.
 */
export function authGuard(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ authError: true, error: 'Authentication required' });
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ authError: true, error: 'Session expired — please log in again' });
  }
}

export function signToken(user) {
  return jwt.sign(
    {
      id         : user.id,
      employeeId : user.employeeId,
      role       : user.role,
      branch     : user.branch,
      department : user.department,
    },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}
