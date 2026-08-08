/**
 * Small in-process cache over the generic `app_settings` "main" JSON blob,
 * for individual flags that need to be read on hot write paths (Leave/Office
 * Visit apply) without a DB round-trip on every request. Mirrors
 * moduleFlags.js's short-TTL cache shape, but that file caches dedicated
 * app_settings keys — this one reads a field out of the 'main' blob instead,
 * since that's where the frontend's SettingsContext already stores
 * leaveBackdateEnabled alongside nepaliDigits/defaultCalendar/etc.
 */
import pool from '../db.js';

const TTL_MS = 5000;
let cache = null;
let cachedAt = 0;

export async function isLeaveBackdateEnabled() {
  const now = Date.now();
  if (cache === null || now - cachedAt >= TTL_MS) {
    const { rows } = await pool.query(`SELECT value FROM app_settings WHERE key='main'`);
    cache = rows[0]?.value?.leaveBackdateEnabled !== false; // default true (unrestricted) if unset/missing
    cachedAt = now;
  }
  return cache;
}

export function invalidateAppSettingsCache() {
  cache = null;
}
