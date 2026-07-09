/**
 * Global on/off feature flags for the device-integration modules, stored in
 * the generic app_settings key-value table. Both default OFF (seeded by
 * migration 47) — an admin/superAdmin must explicitly enable each from
 * Settings before any device integration becomes active.
 *
 * Cached briefly in-process since /iclock is a hot path for ADMS devices
 * polling frequently; invalidate() is called right after a toggle is saved
 * so changes still take effect within this request, not after the TTL.
 */

import pool from '../db.js';

export const FLAG_KEYS = {
  attendanceDevice: 'module_attendance_device_enabled',
  standaloneDevice: 'module_standalone_device_enabled',
};

const TTL_MS = 5000;
let cache = null;
let cachedAt = 0;

export async function getModuleFlags() {
  const now = Date.now();
  if (cache && now - cachedAt < TTL_MS) return cache;

  const { rows } = await pool.query(
    'SELECT key, value FROM app_settings WHERE key = ANY($1)',
    [Object.values(FLAG_KEYS)]
  );
  const map = Object.fromEntries(rows.map(r => [r.key, r.value]));

  cache = {
    attendanceDeviceEnabled: map[FLAG_KEYS.attendanceDevice] === true,
    standaloneDeviceEnabled: map[FLAG_KEYS.standaloneDevice] === true,
  };
  cachedAt = now;
  return cache;
}

export function invalidateModuleFlagsCache() {
  cache = null;
}

export async function isModuleEnabled(flagKey) {
  const flags = await getModuleFlags();
  if (flagKey === FLAG_KEYS.attendanceDevice) return flags.attendanceDeviceEnabled;
  if (flagKey === FLAG_KEYS.standaloneDevice) return flags.standaloneDeviceEnabled;
  return false;
}
