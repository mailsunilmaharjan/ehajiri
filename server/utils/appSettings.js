/**
 * Small in-process cache over the generic `app_settings` "main" JSON blob,
 * for individual flags that need to be read on hot write paths (Leave/Office
 * Visit apply) without a DB round-trip on every request. Mirrors
 * moduleFlags.js's short-TTL cache shape, but that file caches dedicated
 * app_settings keys — this one reads fields out of the 'main' blob instead,
 * since that's where the frontend's SettingsContext already stores
 * leaveBackdateEnabled/recoApprovalCompulsory alongside nepaliDigits/etc.
 */
import pool from '../db.js';

const TTL_MS = 5000;
let cache = null;
let cachedAt = 0;

async function getMain() {
  const now = Date.now();
  if (cache === null || now - cachedAt >= TTL_MS) {
    const { rows } = await pool.query(`SELECT value FROM app_settings WHERE key='main'`);
    cache = rows[0]?.value || {};
    cachedAt = now;
  }
  return cache;
}

export async function isLeaveBackdateEnabled() {
  const main = await getMain();
  return main.leaveBackdateEnabled !== false; // default true (unrestricted) if unset/missing
}

export async function isRecoApprovalCompulsory() {
  const main = await getMain();
  return main.recoApprovalCompulsory === true; // default false (optional) if unset/missing
}

export async function getCompanyName() {
  const main = await getMain();
  return (main.companyNameEn || main.companyNameNp || '').trim() || 'Us';
}

export function invalidateAppSettingsCache() {
  cache = null;
}
