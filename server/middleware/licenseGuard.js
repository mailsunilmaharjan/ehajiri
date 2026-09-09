import pool from '../db.js';
import { logError } from '../utils/logError.js';

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

// licenseGuard runs in front of EVERY protected API call, so re-querying the
// license row on every single request means a request-heavy flow (e.g. a
// burst of Field Visit GPS check-in/out writes) can starve this tiny SELECT
// of a pool connection right along with everything else, making a purely
// transient DB hiccup masquerade as a license failure app-wide. The license
// row essentially never changes between admin actions, so cache the last
// good read for a short window and fall back to it on a transient error
// instead of failing closed on every request.
let cachedLicenseRow; // undefined = never fetched, null = no active license row
let cachedAt = 0;
const CACHE_TTL_MS = 60_000;

async function fetchActiveLicenseRow() {
  const { rows } = await pool.query(
    `SELECT payload, distributor_name, distributor_contact_name, distributor_phone, distributor_email
     FROM license WHERE is_active = TRUE LIMIT 1`
  );
  return rows[0] || null;
}

export async function licenseGuard(req, res, next) {
  try {
    if (cachedLicenseRow === undefined || Date.now() - cachedAt > CACHE_TTL_MS) {
      cachedLicenseRow = await fetchActiveLicenseRow();
      cachedAt = Date.now();
    }
    await respondFromRow(cachedLicenseRow, res, next);
  } catch (err) {
    // Transient failure (pool momentarily saturated, brief connection drop,
    // etc.) — serve the last known-good license state instead of blocking
    // every request in the app. Only a cache that's never been populated at
    // all (or whose fallback itself fails, e.g. the DB is still down) falls
    // through to the generic message below — but a response always goes out
    // either way, never left hanging.
    if (cachedLicenseRow !== undefined) {
      try { await respondFromRow(cachedLicenseRow, res, next); return; } catch { /* fall through */ }
    }
    logError('[licenseGuard]', err);
    res.status(403).json({
      licenseError: true,
      error: 'License verification failed. Contact your distributor.',
    });
  }
}

async function respondFromRow(row, res, next) {
  if (!row) {
    const contact = await getDistributorContact();
    res.status(403).json({
      licenseError: true,
      error: 'Subscription has been Expired, Contact to your Distributor',
      ...contact,
    });
    return;
  }
  if (new Date(row.payload.expires) < new Date()) {
    res.status(403).json({
      licenseError: true,
      error: 'Subscription has been Expired, Contact to your Distributor',
      distributorName       : row.distributor_name         || '',
      distributorContactName: row.distributor_contact_name || '',
      distributorPhone      : row.distributor_phone        || '',
      distributorEmail      : row.distributor_email        || '',
    });
    return;
  }
  next();
}
