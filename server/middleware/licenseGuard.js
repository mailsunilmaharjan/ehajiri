import pool from '../db.js';

/**
 * Blocks any request if no active, non-expired license exists.
 * Apply to all protected API routes. Skip /api/license/* and /api/auth/login
 * (those handle themselves).
 */
// Shared across licenseGuard/login/sso-exchange so the "Subscription
// Expired" screen always has a distributor to point at, from whichever row
// last held that info even if there's no active license row anymore.
export async function getDistributorContact() {
  const { rows } = await pool.query(
    `SELECT distributor_name, distributor_contact_name, distributor_phone, distributor_email FROM license
     ORDER BY activated_at DESC LIMIT 1`
  );
  const row = rows[0] || {};
  return {
    distributorName       : row.distributor_name         || '',
    distributorContactName: row.distributor_contact_name || '',
    distributorPhone      : row.distributor_phone        || '',
    distributorEmail      : row.distributor_email        || '',
  };
}

// Days of advance warning shown after a successful login once the active
// license is within this window of its expiry date. Shared by /login and
// /sso-exchange so both login paths carry the same pre-expiry notice.
export const LICENSE_WARNING_DAYS = 30;

export async function getLicenseWarning(days = LICENSE_WARNING_DAYS) {
  const { rows } = await pool.query(
    `SELECT payload, distributor_name, distributor_contact_name, distributor_phone, distributor_email
     FROM license WHERE is_active = TRUE LIMIT 1`
  );
  const row = rows[0];
  const expires = row?.payload?.expires ? new Date(row.payload.expires) : null;
  if (!expires) return null;
  const daysLeft = Math.ceil((expires - new Date()) / (1000 * 60 * 60 * 24));
  // < 0 means already expired — that's licenseGuard/login's block to show,
  // not this "expiring soon" notice.
  if (daysLeft > days || daysLeft < 0) return null;
  return {
    expiresAt: row.payload.expires, daysLeft,
    distributorName       : row.distributor_name         || '',
    distributorContactName: row.distributor_contact_name || '',
    distributorPhone      : row.distributor_phone        || '',
    distributorEmail      : row.distributor_email        || '',
  };
}

export async function licenseGuard(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT payload, distributor_name, distributor_contact_name, distributor_phone, distributor_email
       FROM license WHERE is_active = TRUE LIMIT 1`
    );
    if (!rows.length) {
      return res.status(403).json({
        licenseError: true,
        error: 'Subscription has been Expired, Contact to your Distributor',
        ...await getDistributorContact(),
      });
    }
    const payload = rows[0].payload;
    if (new Date(payload.expires) < new Date()) {
      return res.status(403).json({
        licenseError: true,
        error: 'Subscription has been Expired, Contact to your Distributor',
        distributorName       : rows[0].distributor_name         || '',
        distributorContactName: rows[0].distributor_contact_name || '',
        distributorPhone      : rows[0].distributor_phone        || '',
        distributorEmail      : rows[0].distributor_email        || '',
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
