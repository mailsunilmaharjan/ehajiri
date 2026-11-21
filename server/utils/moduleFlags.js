/**
 * Global on/off feature flags — device-integration modules (standaloneDevice,
 * seeded OFF by migration 47) plus Email Setup (seeded OFF by migration 75),
 * Guest Registration/Online Attendance/Duty Roster/Chat/Task (all seeded OFF),
 * all stored in the generic app_settings key-value table. attendanceDevice
 * defaults ON (migration 120) — every other flag defaults OFF, INCLUDING the Help assistant and Field Visit
 * route tracking (both were always-on before; they are now opt-in per tenant like the rest); a Super Admin
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
  // Nepal Accounts (accounting + inventory). Defaults OFF like every flag except attendanceDevice
  // a Super Admin must switch it on per tenant.
  accounting:       'module_accounting_enabled',
  // Help assistant widget (floating Help button). Defaults OFF — a Super Admin enables it per tenant.
  supportHelp:      'module_support_help_enabled',
  // Field Visit continuous route tracking (the "📡 Tracking field visit" chip + GPS recording while a trip is open).
  // Defaults OFF — a Super Admin enables it per tenant.
  fieldVisitTracking: 'module_field_visit_tracking_enabled',
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

  // Accounts is a LICENSED module: on a hosted tenant it may only run when the active license lists the
  // "Accounting" feature (LicenseAdmin → Licenses). Tenants that already had it on when gating was introduced
  // were grandfathered by migration 172 (module_accounting_license_override). Desktop / dev installs
  // (no TENANT_ID) are not gated.
  let accountingLicensed = true;
  if (process.env.TENANT_ID) {
    const ov = (await pool.query("SELECT value FROM app_settings WHERE key='module_accounting_license_override'")).rows[0]?.value;
    if (!(ov === true || ov === 'true')) {
      const lic = (await pool.query('SELECT payload FROM license WHERE is_active = TRUE ORDER BY activated_at DESC LIMIT 1')).rows[0];
      const feats = Array.isArray(lic?.payload?.features) ? lic.payload.features : [];
      accountingLicensed = feats.some(f => /^(accounting|accounts)$/i.test(String(f).trim()));
    }
  }

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
    accountingEnabled:        map[FLAG_KEYS.accounting]        === true && accountingLicensed,
    accountingLicensed,
    supportHelpEnabled:       map[FLAG_KEYS.supportHelp]       === true,
    fieldVisitTrackingEnabled: map[FLAG_KEYS.fieldVisitTracking] === true,
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
  if (flagKey === FLAG_KEYS.accounting)        return flags.accountingEnabled;
  if (flagKey === FLAG_KEYS.supportHelp)      return flags.supportHelpEnabled;
  if (flagKey === FLAG_KEYS.fieldVisitTracking) return flags.fieldVisitTrackingEnabled;
  return false;
}
