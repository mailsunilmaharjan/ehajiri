import pool from '../db.js';

/**
 * Blocks any request if no active, non-expired license exists.
 * Apply to all protected API routes. Skip /api/license/* and /api/auth/login
 * (those handle themselves).
 */
export async function licenseGuard(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT payload FROM license WHERE is_active = TRUE LIMIT 1`
    );
    if (!rows.length) {
      return res.status(403).json({
        licenseError: true,
        error: 'Subscription has been Expired, Contact to your Distributor',
      });
    }
    const payload = rows[0].payload;
    if (new Date(payload.expires) < new Date()) {
      return res.status(403).json({
        licenseError: true,
        error: 'Subscription has been Expired, Contact to your Distributor',
      });
    }
    next();
  } catch {
    return res.status(403).json({
      licenseError: true,
      error: 'License verification failed. Contact your distributor.',
    });
  }
}
