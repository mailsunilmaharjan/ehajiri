/**
 * Global on/off feature flags — device-integration modules (standaloneDevice,
 * seeded OFF by migration 47) plus Email Setup (seeded OFF by migration 75),
 * Guest Registration/Online Attendance/Duty Roster/Chat/Task (all seeded OFF),
 * all stored in the generic app_settings key-value table. attendanceDevice
 * defaults ON (migration 120) — every other flag defaults OFF; a Super Admin
 * must explicitly enable the rest before they become active (Super-Admin
 * only, not license-gated — see RoleManagement.jsx and settings.js's
 * SUPER_ADMIN_ONLY_FLAGS).
 *
 * Cached briefly in-process since /iclock is a hot path for ADMS devices
 * polling frequently; invalidate() is called right after a toggle is saved
 * so changes still take effect within this request, not after the TTL.
 */

import pool from '../db.js';

export const FLAG_KEYS = {
  attendanceDevice: 'module_attendance_device_enabled',
  standaloneDevice: 'module_standalone_device_enabled',
  emailSetup:       'module_email_setup_enabled',
  guestRegistration: 'module_guest_registration_enabled',
  onlineAttendance: 'module_online_attendance_enabled',
  dutyRoster:       'module_duty_roster_enabled',
  chat:             'module_chat_enabled',
  task:             'module_task_enabled',
  smsGateway:       'module_sms_gateway_enabled',
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
    attendanceDeviceEnabled:  map[FLAG_KEYS.attendanceDevice]  === true,
    standaloneDeviceEnabled:  map[FLAG_KEYS.standaloneDevice]  === true,
    emailSetupEnabled:        map[FLAG_KEYS.emailSetup]        === true,
    guestRegistrationEnabled: map[FLAG_KEYS.guestRegistration] === true,
    onlineAttendanceEnabled:  map[FLAG_KEYS.onlineAttendance]  === true,
    dutyRosterEnabled:        map[FLAG_KEYS.dutyRoster]        === true,
    chatEnabled:              map[FLAG_KEYS.chat]              === true,
    taskEnabled:              map[FLAG_KEYS.task]              === true,
    smsGatewayEnabled:        map[FLAG_KEYS.smsGateway]        === true,
  };
  cachedAt = now;
  return cache;
}

export function invalidateModuleFlagsCache() {
  cache = null;
}

export async function isModuleEnabled(flagKey) {
  const flags = await getModuleFlags();
  if (flagKey === FLAG_KEYS.attendanceDevice)  return flags.attendanceDeviceEnabled;
  if (flagKey === FLAG_KEYS.standaloneDevice)  return flags.standaloneDeviceEnabled;
  if (flagKey === FLAG_KEYS.emailSetup)        return flags.emailSetupEnabled;
  if (flagKey === FLAG_KEYS.guestRegistration) return flags.guestRegistrationEnabled;
  if (flagKey === FLAG_KEYS.onlineAttendance)  return flags.onlineAttendanceEnabled;
  if (flagKey === FLAG_KEYS.dutyRoster)        return flags.dutyRosterEnabled;
  if (flagKey === FLAG_KEYS.chat)              return flags.chatEnabled;
  if (flagKey === FLAG_KEYS.task)              return flags.taskEnabled;
  if (flagKey === FLAG_KEYS.smsGateway)        return flags.smsGatewayEnabled;
  return false;
}
