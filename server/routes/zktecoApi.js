/**
 * ZKTeco REST API Routes — consumed by eHajiri Settings UI
 * Base: /api/zkteco
 *
 * All device operations queue ADMS commands per the Developer Guide.
 * Command formats corrected per guide vs. previous implementation:
 *   OLD: DATA DELETE tableName=user\nUSER\tPIN=X  →  NEW: DATA DELETE USERINFO PIN=X
 *   OLD: DATA UPDATE tableName=user\nUSER\t...    →  NEW: DATA UPDATE USERINFO PIN=X\t...
 *   OLD: DATA QUERY tableName=user                →  NEW: DATA QUERY USERINFO
 *   OLD: SETTIME YYYY-MM-DD HH:MM:SS              →  NEW: SET OPTION ServerLocalTime=YYYY-MM-DD HH:MM:SS
 *   OLD: DATA UPDATE (for sync)                   →  correct: reset stamp + DATA QUERY USERINFO
 */

import express from 'express';
import pool    from '../db.js';
import { requireRole } from '../middleware/roleGuard.js';
import { logError } from '../utils/logError.js';

const canManageDevices = requireRole('admin', 'branchManager', 'superAdmin');
import {
  resetDeviceStamp,
  queueCommand,
  formatZkTime,
  parseAttlog,
  saveAttlogs,
  incrementLogCount,
  parseKeyValueLine,
  saveDeviceUser,
  // Java ZktecoService method equivalents
  addOrUpdateUserOnDevice,
  grantAccessWithFinger,
  deleteUserFromDevice,
  unlockDoor,
  rebootDevice,
  cancelAlarm,
  enrollFingerprint,
  enrollCard,
  checkDevice,
} from '../services/zktecoService.js';

const router = express.Router();

// ── helpers ───────────────────────────────────────────────────────────────

// ZKTeco expects "YYYY-MM-DD HH:MM:SS" (space, not ISO T). Normalize both formats.
const fmtDt = (dt) => dt ? String(dt).replace('T', ' ').slice(0, 19) : '';

// Convert "HH:MM" to "HHMM" (4-digit, no colon) for AccTimeZone ADMS commands.
const toZkTime = (t) => (t || '00:00').replace(':', '').padStart(4, '0');

/**
 * Build DATA UPDATE AccTimeZone params from a zkteco_timezones row.
 * Protocol order: Sun Mon Tues Wed Thurs Fri Sat
 * Only Interval 1 (index 0) is used — the device command supports one slot per day.
 */
function buildAccTimeZoneParams(tz) {
  const s = typeof tz.schedule === 'string' ? JSON.parse(tz.schedule) : (tz.schedule || {});
  const st = (day, f) => toZkTime(s[day]?.[0]?.[f]);
  return [
    `UID=${tz.id}`,
    `SunStart=${st('Sun','s')}`,   `SunEnd=${st('Sun','e')}`,
    `MonStart=${st('Mon','s')}`,   `MonEnd=${st('Mon','e')}`,
    `TuesStart=${st('Tue','s')}`,  `TuesEnd=${st('Tue','e')}`,
    `WedStart=${st('Wed','s')}`,   `WedEnd=${st('Wed','e')}`,
    `ThursStart=${st('Thu','s')}`, `ThursEnd=${st('Thu','e')}`,
    `FriStart=${st('Fri','s')}`,   `FriEnd=${st('Fri','e')}`,
    `SatStart=${st('Sat','s')}`,   `SatEnd=${st('Sat','e')}`,
  ].join('\t');
}

/**
 * Build DATA UPDATE AccGroup params from a zkteco_access_levels row.
 * TZ is a 16-char bitmask: position N-1 (0-indexed) = '1' for timezone UID N.
 */
function buildAccGroupParams(level) {
  const tzId = level.timezone_id || 1;
  const idx  = Math.max(0, Math.min(15, tzId - 1));
  const tzMask = '0'.repeat(idx) + '1' + '0'.repeat(15 - idx);
  return `ID=${level.id}\tVerify=0\tValidHoliday=0\tTZ=${tzMask}`;
}

/** Push AccTimeZone command for one timezone to ALL active devices. */
async function pushAccTimeZoneToAllDevices(tzRow) {
  const { rows: devices } = await pool.query(
    `SELECT serial_number FROM zkteco_devices WHERE active=TRUE AND serial_number IS NOT NULL`
  );
  const params = buildAccTimeZoneParams(tzRow);
  for (const d of devices) {
    await queueCommand(d.serial_number, 'DATA UPDATE AccTimeZone', params);
  }
  return devices.length;
}

/** Push AccGroup command for one access level to ALL active devices. */
async function pushAccGroupToAllDevices(levelRow) {
  const { rows: devices } = await pool.query(
    `SELECT serial_number FROM zkteco_devices WHERE active=TRUE AND serial_number IS NOT NULL`
  );
  const params = buildAccGroupParams(levelRow);
  for (const d of devices) {
    await queueCommand(d.serial_number, 'DATA UPDATE AccGroup', params);
  }
  return devices.length;
}

// Build the standard DATA UPDATE USERINFO param string.
// Official format: PIN\tName\tPri\tPasswd\tCard\tGrp\tTZ\tCategory
// Extended fields Expires/StartDatetime/EndDatetime are device-firmware-dependent;
// date separator MUST be space not T — devices reject ISO format.
function buildUserInfoParams({ pin, name='', privilege=0, passwd='', card='',
  expires=0, startDatetime='2000-01-01 00:00:00', endDatetime='2099-12-31 23:59:00' }) {
  const sd = fmtDt(startDatetime) || '2000-01-01 00:00:00';
  const ed = fmtDt(endDatetime)   || '2099-12-31 23:59:00';
  return `PIN=${pin}\tName=${name}\tPri=${privilege}\tPasswd=${passwd}\tCard=${card}\tGrp=1\tTZ=1\tVerify=0\tExpires=${expires}\tStartDatetime=${sd}\tEndDatetime=${ed}`;
}

async function getSnById(id) {
  const { rows } = await pool.query('SELECT serial_number FROM zkteco_devices WHERE id=$1', [id]);
  if (!rows[0]) throw Object.assign(new Error('Device not found'), { status:404 });
  if (!rows[0].serial_number) throw Object.assign(new Error('Device has no serial number yet'), { status:400 });
  return rows[0].serial_number;
}

/**
 * Push all users in an area (with their stored FP templates) to a specific device.
 * Called when: (a) device is assigned to an area, (b) manual "Sync Area" trigger.
 */
async function syncAreaToDevice(areaId, targetSn) {
  const { rows: users } = await pool.query(
    'SELECT * FROM zkteco_users WHERE area_id=$1', [areaId]
  );
  let cmdCount = 0;
  for (const u of users) {
    // Push user record
    const uParams = buildUserInfoParams({ pin:u.pin, name:u.name, privilege:u.privilege||0, card:u.card_no||'' });
    await queueCommand(targetSn, 'DATA UPDATE USERINFO', uParams);
    cmdCount++;
    // Push fingerprint templates stored for this user (any device_sn)
    const { rows: fps } = await pool.query(
      `SELECT * FROM zkteco_fingerprints WHERE pin=$1 AND template_data IS NOT NULL ORDER BY finger_id`,
      [u.pin]
    );
    for (const fp of fps) {
      const fpParams = `PIN=${fp.pin}\tFID=${fp.finger_id}\tSize=${fp.template_size}\tValid=${fp.valid||1}\tTMP=${fp.template_data}`;
      await queueCommand(targetSn, 'DATA UPDATE FINGERTMP', fpParams);
      cmdCount++;
    }
  }
  console.log(`[ZK Area] syncAreaToDevice: area=${areaId} → device=${targetSn} — ${cmdCount} commands`);
  return { cmdCount, userCount: users.length };
}

/**
 * Push a single user (+ their FP templates) to all active devices in an area.
 * Called when: a user is uploaded to any device in the area.
 */
async function pushUserToAreaDevices(areaId, pin, name, privilege, cardNo, excludeSn) {
  const { rows: devices } = await pool.query(
    `SELECT serial_number FROM zkteco_devices
     WHERE area_id=$1 AND serial_number IS NOT NULL AND active=TRUE`,
    [areaId]
  );
  const { rows: fps } = await pool.query(
    `SELECT * FROM zkteco_fingerprints WHERE pin=$1 AND template_data IS NOT NULL ORDER BY finger_id`,
    [pin]
  );
  let pushed = 0;
  for (const d of devices) {
    if (d.serial_number === excludeSn) continue; // skip the origin device (already done)
    const uParams = buildUserInfoParams({ pin, name:name||'', privilege:privilege||0, card:cardNo||'' });
    await queueCommand(d.serial_number, 'DATA UPDATE USERINFO', uParams);
    for (const fp of fps) {
      const fpParams = `PIN=${fp.pin}\tFID=${fp.finger_id}\tSize=${fp.template_size}\tValid=${fp.valid||1}\tTMP=${fp.template_data}`;
      await queueCommand(d.serial_number, 'DATA UPDATE FINGERTMP', fpParams);
    }
    pushed++;
  }
  console.log(`[ZK Area] pushUserToAreaDevices: PIN=${pin} pushed to ${pushed} area devices`);
  return pushed;
}

/**
 * Delete a user from all active devices in an area.
 * Called when: a user is deleted from any device in the area.
 */
async function deleteUserFromAreaDevices(areaId, pin, excludeSn) {
  const { rows: devices } = await pool.query(
    `SELECT serial_number FROM zkteco_devices
     WHERE area_id=$1 AND serial_number IS NOT NULL AND active=TRUE`,
    [areaId]
  );
  let deleted = 0;
  for (const d of devices) {
    if (d.serial_number === excludeSn) continue;
    await queueCommand(d.serial_number, 'DATA DELETE USERINFO', `PIN=${pin}`);
    deleted++;
  }
  console.log(`[ZK Area] deleteUserFromAreaDevices: PIN=${pin} deleted from ${deleted} area devices`);
  return deleted;
}

// ═══════════════════════════════════════════════════════
//  DEVICES
// ═══════════════════════════════════════════════════════

router.get('/devices', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT d.*,
             di.user_count,   di.fp_count,     di.max_user,    di.max_fp,
             di.device_name AS info_device_name,
             di.firmware_ver AS info_firmware,
             di.platform     AS info_platform,
             di.updated_at   AS info_updated,
             COUNT(DISTINCT l.id)::int  AS total_logs,
             COUNT(DISTINCT zu.id)::int AS actual_user_count,
             za.id           AS area_id,
             za.name         AS area_name,
             za.code         AS area_code
      FROM   zkteco_devices d
      LEFT   JOIN zkteco_device_info     di ON di.device_sn  = d.serial_number
      LEFT   JOIN zkteco_attendance_logs l  ON l.device_sn   = d.serial_number
      LEFT   JOIN zkteco_users           zu ON zu.device_sn  = d.serial_number
      LEFT   JOIN zkteco_areas           za ON za.id         = d.area_id
      GROUP  BY d.id, di.user_count, di.fp_count, di.max_user, di.max_fp,
                di.device_name, di.firmware_ver, di.platform, di.updated_at,
                za.id, za.name, za.code
      ORDER  BY d.created_at DESC
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/devices', async (req, res) => {
  const { name, serialNumber, ipAddress, port, model, deviceType, location, communicationKey } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO zkteco_devices (name,serial_number,ip_address,port,model,device_type,location,communication_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [name, serialNumber||null, ipAddress||null, port||4370, model||'Unknown', deviceType||'fingerprint', location||null, communicationKey||'0']
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code==='23505') return res.status(409).json({ error:'Serial number already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/devices/:id', async (req, res) => {
  const { name, location, communicationKey, active, timezoneOffset, areaId } = req.body;
  try {
    const current = await pool.query(
      'SELECT serial_number, timezone_offset, area_id FROM zkteco_devices WHERE id=$1',
      [req.params.id]
    );
    if (!current.rows[0]) return res.status(404).json({ error:'Device not found' });

    const newAreaId = areaId !== undefined ? (areaId ? parseInt(areaId) : null) : undefined;

    const { rows } = await pool.query(
      `UPDATE zkteco_devices SET
         name              = COALESCE($1, name),
         location          = COALESCE($2, location),
         communication_key = COALESCE($3, communication_key),
         active            = COALESCE($4, active),
         timezone_offset   = COALESCE($5, timezone_offset),
         area_id           = COALESCE($6, area_id)
       WHERE id=$7 RETURNING *`,
      [name, location, communicationKey, active,
       timezoneOffset ?? null,
       newAreaId ?? null,
       req.params.id]
    );

    const sn      = current.rows[0].serial_number;
    const oldTz   = current.rows[0].timezone_offset;
    const oldArea = current.rows[0].area_id;

    // Timezone change → RELOAD OPTIONS (device re-handshakes with new TimeZone=)
    if (sn && timezoneOffset !== undefined && parseInt(timezoneOffset) !== parseInt(oldTz)) {
      await queueCommand(sn, 'RELOAD OPTIONS');
      console.log(`[ZK API] Timezone changed ${sn}: ${oldTz}→${timezoneOffset}`);
    }

    // Area assignment/change → auto-sync all area users+FP templates to this device
    const finalArea = newAreaId ?? oldArea;
    if (sn && finalArea && finalArea !== oldArea && newAreaId !== undefined) {
      const result = await syncAreaToDevice(finalArea, sn);
      console.log(`[ZK API] Area set: ${sn} → area ${finalArea}, ${result.cmdCount} cmds for ${result.userCount} users`);
      return res.json({ ...rows[0], areaSyncQueued: result });
    }

    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/devices/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM zkteco_devices WHERE id=$1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error:'Device not found' });
    res.json({ ok:true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════
//  DEVICE OPERATIONS — all queue ADMS commands
// ═══════════════════════════════════════════════════════

// ── Get device info (CHECK command) ──────────────────────────────────────
router.post('/devices/:id/get-info', async (req, res) => {
  try {
    const sn  = await getSnById(req.params.id);
    const cmd = await queueCommand(sn, 'CHECK');
    res.json({ ok:true, sn, command:cmd.command_payload });
  } catch (err) { res.status(err.status||500).json({ error:err.message }); }
});

// ── Get all enrolled users + biometric data ───────────────────────────────
// Order: CHECK (updates UserCount) → DATA QUERY USERINFO → RELOAD OPTIONS (FP templates via OPERLOG)
router.post('/devices/:id/get-users', async (req, res) => {
  try {
    const sn = await getSnById(req.params.id);
    await pool.query(`DELETE FROM zkteco_commands WHERE device_sn=$1 AND status='PENDING'`, [sn]);
    // CHECK → updates user_count / fp_count in zkteco_device_info
    const cmd0 = await queueCommand(sn, 'CHECK');
    // DATA QUERY USERINFO → device pushes USER rows (name, card, passwd, fp/face counts)
    const cmd1 = await queueCommand(sn, 'DATA QUERY USERINFO');
    // RELOAD OPTIONS → re-handshake with OPERLOGStamp=0 → device re-pushes FP templates
    const cmd2 = await queueCommand(sn, 'RELOAD OPTIONS');
    res.json({
      ok      : true,
      sn,
      commands: [cmd0.command_payload, cmd1.command_payload, cmd2.command_payload],
      note    : 'CHECK + DATA QUERY USERINFO + RELOAD OPTIONS queued — users + FP templates arrive via OPERLOG',
    });
  } catch (err) { res.status(err.status||500).json({ error:err.message }); }
});

// ── Get All Logs — correct ADMS approach per guide ───────────────────────
router.post('/devices/:id/sync', async (req, res) => {
  try {
    const sn = await getSnById(req.params.id);
    await pool.query(`DELETE FROM zkteco_commands WHERE device_sn=$1 AND status='PENDING'`, [sn]);
    // Reset stamp → server will send ATTLOGStamp=None on next handshake → device re-pushes ALL
    await resetDeviceStamp(sn);
    const cmd = await queueCommand(sn, 'RELOAD OPTIONS');
    console.log(`[ZK API] Get All Logs: stamp=None + RELOAD OPTIONS queued for ${sn}`);
    res.json({
      ok     : true,
      sn,
      command: cmd.command_payload,
      message: 'ATTLOGStamp=None + RELOAD OPTIONS queued — device will re-push all logs on next handshake (~30s)',
    });
  } catch (err) { res.status(err.status||500).json({ error:err.message }); }
});

// ── Set device time — correct format per guide §14 ────────────────────────
// Guide: "SET OPTION ServerLocalTime=YYYY-MM-DD HH:MM:SS" (not SETTIME)
router.post('/devices/:id/set-time', async (req, res) => {
  try {
    const sn      = await getSnById(req.params.id);
    const timeStr = req.body.time ? formatZkTime(new Date(req.body.time)) : formatZkTime();
    const cmd     = await queueCommand(sn, 'SET OPTION', `ServerLocalTime=${timeStr}`);
    res.json({ ok:true, sn, time:timeStr, command:cmd.command_payload });
  } catch (err) { res.status(err.status||500).json({ error:err.message }); }
});

// ── Upload user to device — correct USERINFO format per guide §3 ──────────
// Guide format: DATA UPDATE USERINFO PIN=X\tName=Y\tPri=Z\t...
// Includes expiry fields for subscription gating
// Upload user to this device AND cascade to all devices in the same area
router.post('/devices/:id/upload-user', canManageDevices, async (req, res) => {
  const { pin, name, privilege=0, card='', passwd='', expires=0,
          startDatetime='2000-01-01T00:00:00', endDatetime='2099-12-31T23:59:00' } = req.body;
  if (!pin || !name) return res.status(400).json({ error:'pin and name are required' });
  try {
    const devRow = await pool.query(
      'SELECT serial_number, area_id FROM zkteco_devices WHERE id=$1', [req.params.id]
    );
    const sn     = devRow.rows[0]?.serial_number;
    const areaId = devRow.rows[0]?.area_id;
    if (!sn) throw Object.assign(new Error('Device has no serial number yet'), { status:400 });

    const uParams = buildUserInfoParams({ pin, name, privilege, passwd, card, expires, startDatetime, endDatetime });
    const cmd = await queueCommand(sn, 'DATA UPDATE USERINFO', uParams);

    // Mark this user as belonging to the area
    if (areaId) {
      await pool.query(
        `UPDATE zkteco_users SET area_id=$1 WHERE device_sn=$2 AND pin=$3`,
        [areaId, sn, pin]
      );
      // Push to all other devices in the same area
      const cascaded = await pushUserToAreaDevices(areaId, pin, name, privilege, card, sn);
      return res.json({ ok:true, sn, command:cmd.command_payload, areaCascaded:cascaded });
    }
    res.json({ ok:true, sn, command:cmd.command_payload });
  } catch (err) { res.status(err.status||500).json({ error:err.message }); }
});

// Delete user from this device AND from ALL devices in the same area
router.post('/devices/:id/delete-user', canManageDevices, async (req, res) => {
  const { pin } = req.body;
  if (!pin) return res.status(400).json({ error:'pin is required' });
  try {
    const devRow = await pool.query(
      'SELECT serial_number, area_id FROM zkteco_devices WHERE id=$1', [req.params.id]
    );
    const sn     = devRow.rows[0]?.serial_number;
    const areaId = devRow.rows[0]?.area_id;
    if (!sn) throw Object.assign(new Error('Device has no serial number yet'), { status:400 });

    const cmd = await queueCommand(sn, 'DATA DELETE USERINFO', `PIN=${pin}`);

    // Delete from all OTHER devices in the same area (area-only — not from unrelated devices)
    let areaDeleted = 0;
    if (areaId) {
      areaDeleted = await deleteUserFromAreaDevices(areaId, pin, sn);
    }
    res.json({ ok:true, sn, command:cmd.command_payload, areaDeletedFrom:areaDeleted });
  } catch (err) { res.status(err.status||500).json({ error:err.message }); }
});

// ── Manually trigger area sync for a device ───────────────────────────────
// Pushes all area users + FP templates to this device
router.post('/devices/:id/sync-area', async (req, res) => {
  try {
    const devRow = await pool.query(
      'SELECT serial_number, area_id FROM zkteco_devices WHERE id=$1', [req.params.id]
    );
    const sn     = devRow.rows[0]?.serial_number;
    const areaId = devRow.rows[0]?.area_id;
    if (!sn)     throw Object.assign(new Error('Device has no serial number yet'), { status:400 });
    if (!areaId) throw Object.assign(new Error('Device has no area assigned'), { status:400 });
    const result = await syncAreaToDevice(areaId, sn);
    res.json({ ok:true, sn, areaId, ...result });
  } catch (err) { res.status(err.status||500).json({ error:err.message }); }
});

// ── Enroll fingerprint — correct format per guide §5 ─────────────────────
// Guide: ENROLL_FP PIN=X\tName=Y\tFID=Z\tRETRY=3\tOVERWRITE=1
router.post('/devices/:id/enroll-fp', canManageDevices, async (req, res) => {
  const { pin, name='', fingerId=0, retry=3, overwrite=1 } = req.body;
  if (!pin) return res.status(400).json({ error:'pin is required' });
  try {
    const sn     = await getSnById(req.params.id);
    const params = `PIN=${pin}\tName=${name}\tFID=${fingerId}\tRETRY=${retry}\tOVERWRITE=${overwrite}`;
    const cmd    = await queueCommand(sn, 'ENROLL_FP', params);
    res.json({ ok:true, sn, command:cmd.command_payload });
  } catch (err) { res.status(err.status||500).json({ error:err.message }); }
});

// ── Enroll face ───────────────────────────────────────────────────────────
router.post('/devices/:id/enroll-face', canManageDevices, async (req, res) => {
  const { pin, name='', retry=3, overwrite=1 } = req.body;
  if (!pin) return res.status(400).json({ error:'pin is required' });
  try {
    const sn     = await getSnById(req.params.id);
    const params = `PIN=${pin}\tName=${name}\tRETRY=${retry}\tOVERWRITE=${overwrite}`;
    const cmd    = await queueCommand(sn, 'ENROLL_BIO', params);
    res.json({ ok:true, sn, command:cmd.command_payload });
  } catch (err) { res.status(err.status||500).json({ error:err.message }); }
});

// ── Cancel Alarm — Java: cancelAlarm(deviceSN) ───────────────────────────
router.post('/devices/:id/cancel-alarm', async (req, res) => {
  try {
    const sn  = await getSnById(req.params.id);
    const cmd = await cancelAlarm(sn);
    res.json({ ok:true, sn, command:cmd.command_payload });
  } catch (err) { res.status(err.status||500).json({ error:err.message }); }
});

// ── Enroll Card — Java: enrollCard(deviceSN, userPin, retry) ──────────────
// Uses ENROLL_ID command (card enrollment on device)
router.post('/devices/:id/enroll-card', canManageDevices, async (req, res) => {
  const { pin, retry = 3 } = req.body;
  if (!pin) return res.status(400).json({ error:'pin is required' });
  try {
    const sn  = await getSnById(req.params.id);
    const cmd = await enrollCard(sn, pin, retry);
    res.json({ ok:true, sn, command:cmd.command_payload });
  } catch (err) { res.status(err.status||500).json({ error:err.message }); }
});

// ── Grant Access With Finger — Java: grantAccessWithFinger(...) ───────────
// Combines: DATA UPDATE USERINFO + DATA UPDATE FINGERTMP (if template stored)
router.post('/devices/:id/grant-access-with-finger', async (req, res) => {
  const { pin, name, cardNumber = '', fingerprintTemplate, fingerPrintId, templateSize } = req.body;
  if (!pin || !name) return res.status(400).json({ error:'pin and name are required' });
  try {
    const sn = await getSnById(req.params.id);
    await grantAccessWithFinger(sn, name, pin, cardNumber, fingerprintTemplate, fingerPrintId, templateSize);
    res.json({ ok:true, sn, message:`User ${name} (PIN:${pin}) + FP template queued on ${sn}` });
  } catch (err) { res.status(err.status||500).json({ error:err.message }); }
});

// ── Unlock Door from Mobile App — Java: unlockDoorFromMobileApp(deviceSN) ─
router.post('/devices/:id/unlock-mobile', async (req, res) => {
  try {
    const sn  = await getSnById(req.params.id);
    const cmd = await unlockDoor(sn);   // same AC_UNLOCK, tracked separately
    res.json({ ok:true, sn, command:cmd.command_payload, source:'mobile' });
  } catch (err) { res.status(err.status||500).json({ error:err.message }); }
});

// ── Restore fingerprint templates to device (after reboot) ───────────────
// Guide §6: DATA UPDATE FINGERTMP PIN=X\tFID=Y\tSize=Z\tValid=1\tTMP=<base64>
// Must be done on every handshake for devices that wipe templates on reboot
router.post('/devices/:id/restore-templates', async (req, res) => {
  try {
    const sn = await getSnById(req.params.id);
    // Find all stored templates with actual template data
    const { rows } = await pool.query(
      `SELECT pin, finger_id, template_size, valid, template_data
       FROM   zkteco_fingerprints
       WHERE  device_sn=$1 AND template_data IS NOT NULL
       ORDER  BY pin::int, finger_id`,
      [sn]
    );
    if (!rows.length) {
      return res.json({ ok:true, sn, queued:0, message:'No stored templates to restore' });
    }
    let queued = 0;
    for (const fp of rows) {
      // Guide §6: Size MUST be binary byte count — Buffer.byteLength(base64, 'base64')
      // Never use template_data.length (base64 char count ≠ binary byte count)
      const binarySize = Buffer.byteLength(fp.template_data, 'base64');
      const params = `PIN=${fp.pin}\tFID=${fp.finger_id}\tSize=${binarySize}\tValid=${fp.valid||1}\tTMP=${fp.template_data}`;
      await queueCommand(sn, 'DATA UPDATE FINGERTMP', params);
      queued++;
    }
    console.log(`[ZK API] Queued ${queued} template restore commands for ${sn}`);
    res.json({ ok:true, sn, queued });
  } catch (err) { res.status(err.status||500).json({ error:err.message }); }
});

// ── Clear Admin privilege from device users ───────────────────────────────
// Two-stage: downgrade known DB admins immediately, then queue DATA QUERY
// USERINFO to catch any admin registered directly on the device.
// When users arrive via OPERLOG, clear_admin_pending flag triggers auto-downgrade.
router.post('/devices/:id/clear-admin', canManageDevices, async (req, res) => {
  const { pin } = req.body;        // optional: target specific PIN
  try {
    const sn = await getSnById(req.params.id);

    // Stage 1: downgrade any currently-known admin users in our DB
    let query, params;
    if (pin) {
      query  = 'SELECT * FROM zkteco_users WHERE device_sn=$1 AND pin=$2';
      params = [sn, pin];
    } else {
      query  = 'SELECT * FROM zkteco_users WHERE device_sn=$1 AND privilege >= 6';
      params = [sn];
    }
    const { rows } = await pool.query(query, params);
    let queued = 0;
    for (const u of rows) {
      const cmdParams = buildUserInfoParams({ pin:u.pin, name:u.name||'', privilege:0, card:u.card_no||'' });
      await queueCommand(sn, 'DATA UPDATE USERINFO', cmdParams);
      await pool.query('UPDATE zkteco_users SET privilege=0 WHERE device_sn=$1 AND pin=$2', [sn, u.pin]);
      queued++;
    }

    // Stage 2: sync fresh user list from device so any admin enrolled directly
    // on the device (not in our DB) gets discovered and auto-downgraded
    await queueCommand(sn, 'DATA QUERY USERINFO', 'USERINFO');
    if (!pin) {
      // Set flag — OPERLOG handler will auto-downgrade any Pri>=6 users that arrive
      await pool.query('UPDATE zkteco_devices SET clear_admin_pending=true WHERE serial_number=$1', [sn]);
    }

    console.log(`[ZK API] Clear admin: ${queued} known admins downgraded + user sync queued on ${sn}`);
    res.json({
      ok: true, sn, queued,
      users: rows.map(u => ({ pin: u.pin, name: u.name })),
      message: queued > 0
        ? `${queued} admin(s) downgraded. Syncing device users to catch any remaining admins...`
        : 'No admins in local DB — syncing users from device. Any device-side admins will be cleared automatically (~30s).',
    });
  } catch (err) { res.status(err.status||500).json({ error:err.message }); }
});

// ── Delete a single fingerprint slot from device ──────────────────────────
router.post('/devices/:id/delete-fp-slot', async (req, res) => {
  const { pin, fid } = req.body;
  if (!pin || fid == null) return res.status(400).json({ error:'pin and fid are required' });
  try {
    const sn  = await getSnById(req.params.id);
    const cmd = await queueCommand(sn, 'DATA DELETE FINGERTMP', `PIN=${pin}\tFID=${fid}`);
    await pool.query('DELETE FROM zkteco_fingerprints WHERE device_sn=$1 AND pin=$2 AND finger_id=$3', [sn, pin, fid]);
    console.log(`[ZK API] Delete FP slot PIN=${pin} FID=${fid} on ${sn}`);
    res.json({ ok:true, sn, command:cmd.command_payload });
  } catch (err) { res.status(err.status||500).json({ error:err.message }); }
});

// ── USB Upload — import attendance/user data from device USB export file ──
// ZKTeco devices can export data to USB as .dat files:
//   attlog.dat  : PIN\tDateTime\tVerify\tInOut\tWorkCode\n  (attendance records)
//   user.dat    : PIN\tName\tPri\tPasswd\tCard\tGrp\tTZs\tVerify\n  (user records)
//   oplog.dat   : operation logs (fingerprint enrollments etc.)
// Frontend reads file content and sends as { fileName, content } JSON.
router.post('/devices/:id/usb-upload', async (req, res) => {
  const { fileName = '', content = '' } = req.body;
  if (!content) return res.status(400).json({ error:'No file content provided' });

  try {
    const sn       = await getSnById(req.params.id);
    const fileType = fileName.toLowerCase();
    const lines    = content.replace(/\r/g,'').split('\n').filter(l => l.trim());

    let attInserted = 0, usersUpserted = 0, skipped = 0;

    // ── Detect and parse file type ──────────────────────────────────────
    if (fileType.includes('attlog') || lines[0]?.split('\t').length >= 4 && !lines[0]?.startsWith('USER') && !lines[0]?.startsWith('FP')) {
      // Attendance log format: PIN\tDateTime\tVerify\tInOut[\tWorkCode]
      const records = parseAttlog(lines.join('\n'));
      attInserted   = await saveAttlogs(sn, records);
      await incrementLogCount(sn, attInserted);
      skipped = records.length - attInserted;
      console.log(`[ZK USB] attlog ${sn}: ${records.length} parsed, ${attInserted} new`);
    }

    if (fileType.includes('user') || lines[0]?.startsWith('USER\t') || lines[0]?.split('\t').length >= 3) {
      // User data format — try both USER\t... prefix and raw tab format
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // Strip "USER\t" prefix if present
        const data = trimmed.startsWith('USER\t') ? trimmed.slice(5) : trimmed;

        // Try key=value format first (from OPERLOG style)
        if (data.includes('PIN=')) {
          const kv = parseKeyValueLine(data);
          if (kv.PIN) { await saveDeviceUser(sn, kv); usersUpserted++; }
        } else {
          // Positional format: PIN\tName\tPri\tPasswd\tCard\tGrp\tTZs\tVerify
          const parts = data.split('\t');
          if (parts.length >= 2 && parts[0]) {
            const kv = {
              PIN: parts[0], Name: parts[1]||'', Pri: parts[2]||'0',
              Passwd: parts[3]||'', Card: parts[4]||'0',
            };
            await saveDeviceUser(sn, kv);
            usersUpserted++;
          }
        }
      }
      console.log(`[ZK USB] user data ${sn}: ${usersUpserted} users`);
    }

    res.json({
      ok:true, sn, fileName, totalLines: lines.length,
      attInserted, usersUpserted, skipped,
      message: `Imported ${attInserted} attendance records + ${usersUpserted} users`,
    });
  } catch (err) {
    logError('[ZK USB] upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Unlock door (guide §12) ───────────────────────────────────────────────
router.post('/devices/:id/unlock', async (req, res) => {
  try {
    const sn  = await getSnById(req.params.id);
    const cmd = await queueCommand(sn, 'AC_UNLOCK');
    res.json({ ok:true, sn, command:cmd.command_payload });
  } catch (err) { res.status(err.status||500).json({ error:err.message }); }
});

// ── Set device timezone (Nepal Standard Time UTC+5:45) ───────────────────
// Three-command sequence:
//   1. SET OPTION MachineTZFunOn=0   — disable automatic DST adjustment
//   2. SET OPTION MachineTZ=+0545    — set fixed UTC+5:45 offset
//   3. RELOAD OPTIONS                — force re-handshake so device applies settings
router.post('/devices/:id/set-timezone', async (req, res) => {
  try {
    const sn   = await getSnById(req.params.id);
    const cmd1 = await queueCommand(sn, 'SET OPTION', 'MachineTZFunOn=0');
    const cmd2 = await queueCommand(sn, 'SET OPTION', 'MachineTZ=+0545');
    const cmd3 = await queueCommand(sn, 'RELOAD OPTIONS');
    res.json({ ok:true, sn, commands:[cmd1.command_payload, cmd2.command_payload, cmd3.command_payload] });
  } catch (err) { res.status(err.status||500).json({ error:err.message }); }
});

// ── Custom command — queue any raw ADMS command for the device ────────────
router.post('/devices/:id/custom-command', async (req, res) => {
  const { command } = req.body;
  if (!command?.trim()) return res.status(400).json({ error:'command is required' });
  try {
    const sn  = await getSnById(req.params.id);
    const cmd = await queueCommand(sn, command.trim());
    res.json({ ok:true, sn, command:cmd.command_payload });
  } catch (err) { res.status(err.status||500).json({ error:err.message }); }
});

// ── Force re-handshake (guide §13: RELOAD OPTIONS) ───────────────────────
router.post('/devices/:id/reload-options', async (req, res) => {
  try {
    const sn  = await getSnById(req.params.id);
    const cmd = await queueCommand(sn, 'RELOAD OPTIONS');
    res.json({ ok:true, sn, command:cmd.command_payload });
  } catch (err) { res.status(err.status||500).json({ error:err.message }); }
});

// ── Reboot device ─────────────────────────────────────────────────────────
// WARNING from guide: RESTART wipes all FP templates from device RAM
router.post('/devices/:id/reboot', async (req, res) => {
  try {
    const sn  = await getSnById(req.params.id);
    const cmd = await queueCommand(sn, 'RESTART');
    res.json({ ok:true, sn, command:cmd.command_payload,
      warning:'Device will wipe all FP templates from RAM on reboot. Auto-restore will run on next handshake if templates are stored server-side.' });
  } catch (err) { res.status(err.status||500).json({ error:err.message }); }
});

// ── Enable / Disable device ───────────────────────────────────────────────
router.post('/devices/:id/enable',  async (req, res) => {
  try { const sn=await getSnById(req.params.id); const cmd=await queueCommand(sn,'ENABLE');  res.json({ ok:true,sn,command:cmd.command_payload }); }
  catch (err) { res.status(err.status||500).json({ error:err.message }); }
});
router.post('/devices/:id/disable', async (req, res) => {
  try { const sn=await getSnById(req.params.id); const cmd=await queueCommand(sn,'DISABLE'); res.json({ ok:true,sn,command:cmd.command_payload }); }
  catch (err) { res.status(err.status||500).json({ error:err.message }); }
});

// ── Clear device attendance logs ─────────────────────────────────────────
router.post('/devices/:id/clear-attlog', async (req, res) => {
  try {
    const sn  = await getSnById(req.params.id);
    const cmd = await queueCommand(sn, 'DATA CLEAR', 'tableName=attlog');
    res.json({ ok:true, sn, command:cmd.command_payload });
  } catch (err) { res.status(err.status||500).json({ error:err.message }); }
});

// ═══════════════════════════════════════════════════════
//  SYNC DEVICE USERS → eHajiri STAFF
// ═══════════════════════════════════════════════════════

router.post('/sync-to-staff', async (req, res) => {
  try {
    const r1 = await pool.query(`
      UPDATE zkteco_users zu SET employee_id=u.id FROM users u
      WHERE TRIM(u.device_id)=TRIM(zu.pin) AND u.active=TRUE AND zu.employee_id IS NULL`);
    const r2 = await pool.query(`
      UPDATE zkteco_users zu SET employee_id=u.id FROM users u
      WHERE LOWER(REGEXP_REPLACE(TRIM(u.full_name),'\\s+',' ','g'))
          = LOWER(REGEXP_REPLACE(TRIM(zu.name),'\\s+',' ','g'))
        AND zu.name IS NOT NULL AND TRIM(zu.name)<>''
        AND zu.employee_id IS NULL AND u.active=TRUE`);
    const r3 = await pool.query(`
      UPDATE users u SET device_id=zu.pin FROM zkteco_users zu
      WHERE zu.employee_id=u.id AND (u.device_id IS NULL OR TRIM(u.device_id)='')`);
    await pool.query(`
      UPDATE zkteco_attendance_logs al SET employee_id=zu.employee_id
      FROM zkteco_users zu WHERE al.pin=zu.pin AND al.device_sn=zu.device_sn
        AND al.employee_id IS NULL AND zu.employee_id IS NOT NULL`);
    res.json({ ok:true, matched:r1.rowCount+r2.rowCount, byPin:r1.rowCount, byName:r2.rowCount, staffUpdated:r3.rowCount });
  } catch (err) { res.status(500).json({ error:err.message }); }
});

router.post('/device-users/:id/link', async (req, res) => {
  const { employeeId } = req.body;
  if (!employeeId) return res.status(400).json({ error:'employeeId required' });
  try {
    const { rows } = await pool.query(
      'UPDATE zkteco_users SET employee_id=$1 WHERE id=$2 RETURNING *',
      [employeeId, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error:'Device user not found' });
    const { pin, device_sn } = rows[0];
    await pool.query(
      `UPDATE users SET device_id=$1 WHERE id=$2 AND (device_id IS NULL OR TRIM(device_id)='')`,
      [pin, employeeId]
    );
    await pool.query(
      `UPDATE zkteco_attendance_logs SET employee_id=$1
       WHERE pin=$2 AND device_sn=$3 AND employee_id IS NULL`,
      [employeeId, pin, device_sn]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error:err.message }); }
});

router.post('/device-users/:id/unlink', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'UPDATE zkteco_users SET employee_id=NULL WHERE id=$1 RETURNING *',
      [req.params.id]
    );
    res.json(rows[0]||{ ok:true });
  } catch (err) { res.status(500).json({ error:err.message }); }
});

// ── Import device users → create/update staff ─────────────────────────────
router.post('/import-to-staff', async (req, res) => {
  const emailDomain = ((req.body.emailDomain||'planetinfosys.com.np')).trim().replace(/^@/,'');
  const { rows: dus } = await pool.query(`
    SELECT zu.*, d.name AS device_name FROM zkteco_users zu
    LEFT JOIN zkteco_devices d ON d.serial_number=zu.device_sn
    ORDER BY CASE WHEN zu.pin~'^[0-9]+$' THEN zu.pin::int ELSE 99999 END`);

  let created=0, updated=0, skipped=0;
  const results=[];
  for (const du of dus) {
    const pin    = du.pin.trim();
    const rawName = (du.name||'').trim();
    const name   = rawName && rawName!==pin ? rawName : `Staff ${pin}`;
    const email  = `${pin}@${emailDomain}`;
    const avatar = name[0]?.toUpperCase()||'S';
    try {
      if (du.employee_id) {
        await pool.query(`UPDATE users SET device_id=$1,email=CASE WHEN(email IS NULL OR TRIM(email)='')THEN $2 ELSE email END WHERE id=$3`,
          [pin,email,du.employee_id]);
        updated++; results.push({ pin,name,email,action:'updated' });
      } else {
        const existByPin = await pool.query('SELECT id FROM users WHERE TRIM(device_id)=$1 LIMIT 1',[pin]);
        if (existByPin.rows[0]) {
          const empId=existByPin.rows[0].id;
          await pool.query(`UPDATE users SET device_id=$1,email=CASE WHEN(email IS NULL OR TRIM(email)='')THEN $2 ELSE email END WHERE id=$3`,[pin,email,empId]);
          await pool.query('UPDATE zkteco_users SET employee_id=$1 WHERE id=$2',[empId,du.id]);
          updated++; results.push({ pin,name,email,action:'linked' });
        } else {
          const empCode=`DEV${pin}`, username=`dev${pin}`;
          const existDev=await pool.query('SELECT id FROM users WHERE employee_id=$1 OR username=$2 LIMIT 1',[empCode,username]);
          let empDbId;
          if (existDev.rows[0]) {
            empDbId=existDev.rows[0].id;
            await pool.query(`UPDATE users SET device_id=$1,email=CASE WHEN(email IS NULL OR TRIM(email)='')THEN $2 ELSE email END WHERE id=$3`,[pin,email,empDbId]);
            updated++; results.push({ pin,name,email,action:'updated' });
          } else {
            const { rows:[newEmp] } = await pool.query(
              `INSERT INTO users(employee_id,username,password,full_name,email,device_id,role,avatar,active,emp_status)
               VALUES($1,$2,$1,$3,$4,$5,'employee',$6,TRUE,'Active') RETURNING id`,
              [empCode,username,name,email,pin,avatar]);
            empDbId=newEmp.id;
            created++; results.push({ pin,name,email,action:'created',empCode });
          }
          await pool.query('UPDATE zkteco_users SET employee_id=$1 WHERE id=$2',[empDbId,du.id]);
          await pool.query(`UPDATE zkteco_attendance_logs SET employee_id=$1 WHERE pin=$2 AND device_sn=$3 AND employee_id IS NULL`,[empDbId,pin,du.device_sn]);
        }
      }
    } catch (err) { skipped++; results.push({ pin,name,email,action:'error',error:err.message }); }
  }
  res.json({ ok:true, created, updated, skipped, total:dus.length, results });
});

// ═══════════════════════════════════════════════════════
//  ATTENDANCE LOGS
// ═══════════════════════════════════════════════════════

router.get('/logs', async (req, res) => {
  const page=Math.max(1,parseInt(req.query.page||'1'));
  const limit=Math.min(200,parseInt(req.query.limit||'50'));
  const offset=(page-1)*limit;
  const { sn,pin,from,to } = req.query;
  const conds=[]; const params=[]; let p=1;
  if (sn)   { conds.push(`l.device_sn=$${p++}`);  params.push(sn);  }
  if (pin)  { conds.push(`l.pin=$${p++}`);          params.push(pin); }
  if (from) { conds.push(`l.check_time>=$${p++}`);  params.push(from); }
  if (to)   { conds.push(`l.check_time<=$${p++}`);  params.push(to+'T23:59:59Z'); }
  const where=conds.length?'WHERE '+conds.join(' AND '):'';
  try {
    const countRes=await pool.query(`SELECT COUNT(*) FROM zkteco_attendance_logs l ${where}`,params);
    const total=parseInt(countRes.rows[0].count);
    const dataRes=await pool.query(
      `SELECT l.*,u.full_name AS employee_name FROM zkteco_attendance_logs l
       LEFT JOIN users u ON u.id=l.employee_id ${where} ORDER BY l.check_time DESC
       LIMIT $${p++} OFFSET $${p}`,
      [...params,limit,offset]);
    res.json({ total,page,limit,rows:dataRes.rows });
  } catch (err) { res.status(500).json({ error:err.message }); }
});

router.delete('/logs', async (req, res) => {
  const { sn } = req.query;
  try {
    if (sn) await pool.query('DELETE FROM zkteco_attendance_logs WHERE device_sn=$1',[sn]);
    else    await pool.query('DELETE FROM zkteco_attendance_logs');
    res.json({ ok:true });
  } catch (err) { res.status(500).json({ error:err.message }); }
});

// ═══════════════════════════════════════════════════════
//  DEVICE USERS
// ═══════════════════════════════════════════════════════

router.get('/device-users', async (req, res) => {
  const { sn, pin } = req.query;
  try {
    const conditions = [];
    const params = [];
    if (sn)  { params.push(sn);  conditions.push(`zu.device_sn=$${params.length}`); }
    if (pin) { params.push(pin); conditions.push(`zu.pin=$${params.length}`); }
    const cond = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    // Aggregate fingerprint slots per user (array of {fid, template_size, has_template})
    const { rows } = await pool.query(`
      SELECT zu.*,
             e.full_name       AS employee_name,
             e.employee_id     AS staff_code,
             e.department      AS staff_dept,
             e.device_id       AS staff_device_id,
             COALESCE(
               json_agg(
                 json_build_object(
                   'fid',          f.finger_id,
                   'size',         f.template_size,
                   'has_template', (f.template_data IS NOT NULL)
                 ) ORDER BY f.finger_id
               ) FILTER (WHERE f.id IS NOT NULL),
               '[]'::json
             ) AS fp_slots,
             COUNT(f.id)::int AS fp_slots_count
      FROM   zkteco_users zu
      LEFT   JOIN users e ON e.id = zu.employee_id
      LEFT   JOIN zkteco_fingerprints f
               ON f.device_sn = zu.device_sn AND f.pin = zu.pin
      ${cond}
      GROUP  BY zu.id, e.full_name, e.employee_id, e.department, e.device_id
      ORDER  BY zu.device_sn,
                CASE WHEN zu.pin ~ '^[0-9]+$' THEN zu.pin::int ELSE 99999 END
    `, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error:err.message }); }
});

// Updates the local record AND pushes the change to the physical device via
// DATA UPDATE USERINFO (mirrors the queueing pattern clear-admin uses above) —
// without this, a privilege/name/card change here would silently never reach
// the hardware until the next full user sync.
router.put('/device-users/:id', canManageDevices, async (req, res) => {
  const { name, privilege, cardNo } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE zkteco_users
       SET name=COALESCE($1,name), privilege=COALESCE($2,privilege), card_no=COALESCE($3,card_no)
       WHERE id=$4 RETURNING *`,
      [name ?? null, privilege ?? null, cardNo ?? null, req.params.id]
    );
    const updated = rows[0];
    if (!updated) return res.status(404).json({ error:'Not found' });

    if (name !== undefined || privilege !== undefined || cardNo !== undefined) {
      const cmdParams = buildUserInfoParams({
        pin: updated.pin, name: updated.name || '', privilege: updated.privilege || 0, card: updated.card_no || '',
      });
      await queueCommand(updated.device_sn, 'DATA UPDATE USERINFO', cmdParams);
    }
    res.json(updated);
  } catch (err) { res.status(500).json({ error:err.message }); }
});

router.delete('/device-users/:id', async (req, res) => {
  try { await pool.query('DELETE FROM zkteco_users WHERE id=$1',[req.params.id]); res.json({ ok:true }); }
  catch (err) { res.status(500).json({ error:err.message }); }
});

// ── Clear attendance logs for all users on a device ───────────────────────
// Used by "Clear Users Logs" button in Device Users tab
router.delete('/device-users/logs/:deviceSn', async (req, res) => {
  const { deviceSn } = req.params;
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM zkteco_attendance_logs
       WHERE device_sn=$1`,
      [deviceSn]
    );
    // Also reset the attlog_stamp so the next sync fetches all logs again
    await pool.query(
      'UPDATE zkteco_devices SET attlog_stamp=NULL, log_count=0 WHERE serial_number=$1',
      [deviceSn]
    );
    res.json({ ok:true, deleted:rowCount, deviceSn });
  } catch (err) { res.status(500).json({ error:err.message }); }
});

// ═══════════════════════════════════════════════════════
//  FINGERPRINTS
// ═══════════════════════════════════════════════════════

router.get('/fingerprints', async (req, res) => {
  const { sn } = req.query;
  try {
    const cond=sn?'WHERE f.device_sn=$1':''; const params=sn?[sn]:[];
    const { rows }=await pool.query(
      `SELECT f.id,f.device_sn,f.pin,f.finger_id,f.template_size,f.valid,
              f.enrolled_at,(f.template_data IS NOT NULL) AS has_template,
              u.full_name AS employee_name
       FROM zkteco_fingerprints f
       LEFT JOIN zkteco_users zu ON zu.device_sn=f.device_sn AND zu.pin=f.pin
       LEFT JOIN users u ON u.id=zu.employee_id ${cond}
       ORDER BY f.device_sn,CASE WHEN f.pin~'^[0-9]+$' THEN f.pin::int ELSE 99999 END,f.finger_id`,
      params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error:err.message }); }
});

// ═══════════════════════════════════════════════════════
//  COMMANDS
// ═══════════════════════════════════════════════════════

router.get('/commands', async (req, res) => {
  const { sn } = req.query;
  try {
    const cond=sn?'WHERE device_sn=$1':''; const params=sn?[sn]:[];
    const { rows }=await pool.query(
      `SELECT * FROM zkteco_commands ${cond} ORDER BY created_at DESC LIMIT 200`,params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error:err.message }); }
});

router.post('/commands', async (req, res) => {
  const { deviceSn, commandPayload } = req.body;
  if (!deviceSn||!commandPayload) return res.status(400).json({ error:'deviceSn and commandPayload required' });
  try {
    const { rows }=await pool.query(
      'INSERT INTO zkteco_commands(device_sn,command_payload) VALUES($1,$2) RETURNING *',
      [deviceSn,commandPayload]);
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error:err.message }); }
});

// ── Clear commands — delete all, by SN, or only PENDING ─────────────────
router.delete('/commands', async (req, res) => {
  const { sn, status } = req.query;
  try {
    const conds = []; const params = [];
    if (sn)     { conds.push(`device_sn=$${params.length+1}`);   params.push(sn); }
    if (status) { conds.push(`status=$${params.length+1}`);       params.push(status); }
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const { rowCount } = await pool.query(`DELETE FROM zkteco_commands ${where}`, params);
    res.json({ ok:true, deleted:rowCount });
  } catch (err) { res.status(500).json({ error:err.message }); }
});

// ═══════════════════════════════════════════════════════
//  STATS
// ═══════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════
//  AREAS — hierarchical access control zones
//  Hierarchy: Company (root) → Branches → Sub-areas
// ═══════════════════════════════════════════════════════

/* Build a flat list ordered by tree depth (parent before children).
   Also resolves full breadcrumb for display. */
async function getAreasOrdered() {
  const { rows } = await pool.query(`
    WITH RECURSIVE area_tree AS (
      -- Root areas (no parent)
      SELECT id, code, name, parent_id, description, sort_order, 0 AS depth,
             name::TEXT AS breadcrumb,
             ARRAY[id]  AS path
      FROM   zkteco_areas
      WHERE  parent_id IS NULL

      UNION ALL

      -- Children
      SELECT a.id, a.code, a.name, a.parent_id, a.description, a.sort_order,
             at.depth + 1,
             (at.breadcrumb || ' › ' || a.name)::TEXT,
             at.path || a.id
      FROM   zkteco_areas a
      JOIN   area_tree at ON at.id = a.parent_id
    )
    SELECT at.*,
           p.name AS parent_name,
           (
             SELECT COUNT(*)::int FROM zkteco_devices d
             WHERE  TRIM(LOWER(d.location)) = TRIM(LOWER(at.name))
                 OR d.location ILIKE '%' || at.name || '%'
           ) AS device_qty,
           (
             SELECT COUNT(*)::int FROM users u
             WHERE  TRIM(LOWER(u.branch)) = TRIM(LOWER(at.name))
                 OR TRIM(LOWER(u.department)) = TRIM(LOWER(at.name))
           ) AS employee_qty
    FROM   area_tree at
    LEFT   JOIN zkteco_areas p ON p.id = at.parent_id
    ORDER  BY at.path
  `);
  return rows;
}

// ── List all areas ────────────────────────────────────────────────────────
router.get('/areas', async (_req, res) => {
  try { res.json(await getAreasOrdered()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Create area ───────────────────────────────────────────────────────────
router.post('/areas', async (req, res) => {
  const { name, parentId, description, sortOrder } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  // Auto-generate code from name: uppercase slug
  const baseCode = name.trim().toUpperCase().replace(/[^A-Z0-9]/g,'-').replace(/-+/g,'-').slice(0,20);
  let code = baseCode;
  // Ensure uniqueness
  const exist = await pool.query('SELECT id FROM zkteco_areas WHERE code=$1', [code]);
  if (exist.rows[0]) code = `${baseCode}-${Date.now().toString(36).toUpperCase().slice(-4)}`;

  try {
    const { rows } = await pool.query(
      `INSERT INTO zkteco_areas (code, name, parent_id, description, sort_order)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [code, name.trim(), parentId||null, description||null, sortOrder||0]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code==='23505') return res.status(409).json({ error:'Area code already exists' });
    res.status(500).json({ error: err.message });
  }
});

// ── Update area ───────────────────────────────────────────────────────────
router.put('/areas/:id', async (req, res) => {
  const { name, parentId, description, sortOrder } = req.body;
  try {
    // Prevent circular reference — cannot set parent to self or descendant
    if (parentId) {
      const areas = await getAreasOrdered();
      const descendants = new Set();
      const collect = (pid) => {
        areas.filter(a => a.parent_id === pid).forEach(a => { descendants.add(a.id); collect(a.id); });
      };
      collect(parseInt(req.params.id));
      if (descendants.has(parseInt(parentId)) || parseInt(parentId) === parseInt(req.params.id)) {
        return res.status(400).json({ error:'Cannot set a descendant or self as parent' });
      }
    }
    const { rows } = await pool.query(
      `UPDATE zkteco_areas SET
         name        = COALESCE($1, name),
         parent_id   = $2,
         description = COALESCE($3, description),
         sort_order  = COALESCE($4, sort_order)
       WHERE id=$5 RETURNING *`,
      [name, parentId||null, description, sortOrder, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error:'Area not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Delete area ───────────────────────────────────────────────────────────
router.delete('/areas/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM zkteco_areas WHERE id=$1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error:'Area not found' });
    res.json({ ok:true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Seed initial areas from company + branches ────────────────────────────
// Creates a root company area, then one area per branch as children.
router.post('/areas/seed', async (req, res) => {
  try {
    const settingsRes = await pool.query(`SELECT value FROM app_settings WHERE key='general' LIMIT 1`);
    const general    = settingsRes.rows[0]?.value || {};
    const companyName = general.companyName || general.company_name || 'Company';

    const branchesRes = await pool.query('SELECT name FROM branches ORDER BY id');
    const branches    = branchesRes.rows.map(r => r.name).filter(Boolean);

    let created = 0;

    // Create root company area
    const rootCode = 'COMPANY';
    const rootExist = await pool.query('SELECT id FROM zkteco_areas WHERE code=$1', [rootCode]);
    let rootId;
    if (!rootExist.rows[0]) {
      const r = await pool.query(
        `INSERT INTO zkteco_areas (code, name, parent_id, sort_order) VALUES ($1,$2,NULL,0) RETURNING id`,
        [rootCode, companyName]
      );
      rootId = r.rows[0].id;
      created++;
    } else {
      rootId = rootExist.rows[0].id;
    }

    // Create branch areas as children of root
    for (let i = 0; i < branches.length; i++) {
      const bCode = branches[i].toUpperCase().replace(/[^A-Z0-9]/g,'-').replace(/-+/g,'-').slice(0,20);
      const exist = await pool.query('SELECT id FROM zkteco_areas WHERE code=$1', [bCode]);
      if (!exist.rows[0]) {
        await pool.query(
          `INSERT INTO zkteco_areas (code, name, parent_id, sort_order) VALUES ($1,$2,$3,$4)`,
          [bCode, branches[i], rootId, i + 1]
        );
        created++;
      }
    }

    res.json({ ok:true, created, company:companyName, branches });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════
//  TIME ZONES
// ═══════════════════════════════════════════════════════

router.get('/timezones', async (_req, res) => {
  try { res.json((await pool.query('SELECT * FROM zkteco_timezones ORDER BY id')).rows); }
  catch (err) { res.status(500).json({ error:err.message }); }
});

router.post('/timezones', async (req, res) => {
  const { name, remarks, schedule } = req.body;
  if (!name) return res.status(400).json({ error:'name required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO zkteco_timezones (name, remarks, schedule) VALUES ($1,$2,$3) RETURNING *`,
      [name, remarks||null, JSON.stringify(schedule||{})]
    );
    const pushed = await pushAccTimeZoneToAllDevices(rows[0]);
    res.status(201).json({ ...rows[0], pushedToDevices: pushed });
  } catch (err) {
    if (err.code==='23505') return res.status(409).json({ error:'Time zone name already exists' });
    res.status(500).json({ error:err.message });
  }
});

router.put('/timezones/:id', async (req, res) => {
  const { name, remarks, schedule } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE zkteco_timezones SET
         name=COALESCE($1,name), remarks=COALESCE($2,remarks), schedule=COALESCE($3,schedule)
       WHERE id=$4 RETURNING *`,
      [name, remarks, schedule ? JSON.stringify(schedule) : null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error:'Not found' });
    const pushed = await pushAccTimeZoneToAllDevices(rows[0]);
    res.json({ ...rows[0], pushedToDevices: pushed });
  } catch (err) { res.status(500).json({ error:err.message }); }
});

router.delete('/timezones/:id', async (req, res) => {
  try {
    // System time zones ("24-Hour Accessible", "No Access") cannot be deleted
    const { rows } = await pool.query('SELECT name FROM zkteco_timezones WHERE id=$1', [req.params.id]);
    const name = rows[0]?.name;
    if (!name) return res.status(404).json({ error:'Not found' });
    if (name === '24-Hour Accessible' || name === 'No Access') {
      return res.status(403).json({ error:`"${name}" is a system record and cannot be deleted.` });
    }
    await pool.query('DELETE FROM zkteco_timezones WHERE id=$1', [req.params.id]);
    res.json({ ok:true });
  } catch (err) { res.status(500).json({ error:err.message }); }
});

// ═══════════════════════════════════════════════════════
//  ACCESS LEVELS
// ═══════════════════════════════════════════════════════

router.get('/access-levels', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT al.*, tz.name AS timezone_name, za.name AS area_name,
             COUNT(pa.id)::int AS personnel_count
      FROM   zkteco_access_levels al
      LEFT   JOIN zkteco_timezones      tz ON tz.id = al.timezone_id
      LEFT   JOIN zkteco_areas          za ON za.id = al.area_id
      LEFT   JOIN zkteco_person_access  pa ON pa.access_level_id = al.id
      GROUP  BY al.id, tz.name, za.name
      ORDER  BY al.id
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error:err.message }); }
});

router.post('/access-levels', async (req, res) => {
  const { name, timezoneId, areaId, remarks } = req.body;
  if (!name) return res.status(400).json({ error:'name required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO zkteco_access_levels (name, timezone_id, area_id, remarks)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [name, timezoneId||null, areaId||null, remarks||null]
    );
    const pushed = await pushAccGroupToAllDevices(rows[0]);
    res.status(201).json({ ...rows[0], pushedToDevices: pushed });
  } catch (err) {
    if (err.code==='23505') return res.status(409).json({ error:'Access level name already exists' });
    res.status(500).json({ error:err.message });
  }
});

router.put('/access-levels/:id', async (req, res) => {
  const { name, timezoneId, areaId, remarks } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE zkteco_access_levels SET
         name=COALESCE($1,name), timezone_id=$2, area_id=$3, remarks=COALESCE($4,remarks)
       WHERE id=$5 RETURNING *`,
      [name, timezoneId||null, areaId||null, remarks, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error:'Not found' });
    const pushed = await pushAccGroupToAllDevices(rows[0]);
    res.json({ ...rows[0], pushedToDevices: pushed });
  } catch (err) { res.status(500).json({ error:err.message }); }
});

router.delete('/access-levels/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM zkteco_access_levels WHERE id=$1', [req.params.id]);
    res.json({ ok:true });
  } catch (err) { res.status(500).json({ error:err.message }); }
});

// ═══════════════════════════════════════════════════════
//  ACCESS LEVEL MEMBERS — personnel assigned to a specific level
// ═══════════════════════════════════════════════════════

router.get('/access-levels/:id/members', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT pa.id AS pa_id,
             u.id, u.employee_id AS emp_code, u.full_name,
             SPLIT_PART(u.full_name,' ',1)                              AS first_name,
             SUBSTR(u.full_name, LENGTH(SPLIT_PART(u.full_name,' ',1))+2) AS last_name,
             u.department, u.ranking_order, u.active
      FROM   zkteco_person_access pa
      JOIN   users u ON u.id = pa.employee_id
      WHERE  pa.access_level_id = $1
      ORDER  BY u.ranking_order ASC NULLS LAST, u.full_name ASC
    `, [req.params.id]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error:err.message }); }
});

// Batch-add members to an access level (replaces previous entries for the same area)
router.post('/access-levels/:id/members', async (req, res) => {
  const { employeeIds } = req.body;
  if (!Array.isArray(employeeIds) || !employeeIds.length)
    return res.status(400).json({ error:'employeeIds array required' });
  try {
    const lvRes = await pool.query(
      'SELECT timezone_id, area_id FROM zkteco_access_levels WHERE id=$1', [req.params.id]
    );
    const lv = lvRes.rows[0];
    let added = 0;
    for (const empId of employeeIds) {
      try {
        await pool.query(
          `INSERT INTO zkteco_person_access (employee_id, access_level_id, timezone_id, area_id)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (employee_id, area_id) DO UPDATE SET
             access_level_id=$2, timezone_id=$3`,
          [empId, req.params.id, lv?.timezone_id||null, lv?.area_id||null]
        );
        added++;
      } catch { /* skip duplicate */ }
    }
    res.json({ ok:true, added });
  } catch (err) { res.status(500).json({ error:err.message }); }
});

// Remove one member from an access level
router.delete('/access-levels/:id/members/:employeeId', async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM zkteco_person_access WHERE access_level_id=$1 AND employee_id=$2',
      [req.params.id, req.params.employeeId]
    );
    res.json({ ok:true });
  } catch (err) { res.status(500).json({ error:err.message }); }
});

// ═══════════════════════════════════════════════════════
//  ACCESS BY PERSON
// ═══════════════════════════════════════════════════════

router.get('/person-access', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT pa.*, u.full_name, u.employee_id AS emp_code, u.department,
             al.name AS level_name, tz.name AS timezone_name, za.name AS area_name
      FROM   zkteco_person_access pa
      JOIN   users u ON u.id = pa.employee_id
      LEFT   JOIN zkteco_access_levels al ON al.id = pa.access_level_id
      LEFT   JOIN zkteco_timezones     tz ON tz.id = pa.timezone_id
      LEFT   JOIN zkteco_areas         za ON za.id = pa.area_id
      ORDER  BY u.full_name
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error:err.message }); }
});

router.post('/person-access', async (req, res) => {
  const { employeeId, accessLevelId, timezoneId, areaId } = req.body;
  if (!employeeId) return res.status(400).json({ error:'employeeId required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO zkteco_person_access (employee_id, access_level_id, timezone_id, area_id)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (employee_id, area_id) DO UPDATE SET
         access_level_id=$2, timezone_id=$3
       RETURNING *`,
      [employeeId, accessLevelId||null, timezoneId||null, areaId||null]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error:err.message }); }
});

router.delete('/person-access/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM zkteco_person_access WHERE id=$1', [req.params.id]);
    res.json({ ok:true });
  } catch (err) { res.status(500).json({ error:err.message }); }
});

// ═══════════════════════════════════════════════════════
//  ACCESS BY DEPARTMENT
// ═══════════════════════════════════════════════════════

router.get('/dept-access', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT da.*,
             al.name AS level_name, tz.name AS timezone_name, za.name AS area_name,
             COUNT(u.id)::int AS member_count
      FROM   zkteco_dept_access da
      LEFT   JOIN zkteco_access_levels al ON al.id = da.access_level_id
      LEFT   JOIN zkteco_timezones     tz ON tz.id = da.timezone_id
      LEFT   JOIN zkteco_areas         za ON za.id = da.area_id
      LEFT   JOIN users u ON LOWER(TRIM(u.department)) = LOWER(TRIM(da.department))
      GROUP  BY da.id, al.name, tz.name, za.name
      ORDER  BY da.department
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error:err.message }); }
});

router.post('/dept-access', async (req, res) => {
  const { department, accessLevelId, timezoneId, areaId } = req.body;
  if (!department) return res.status(400).json({ error:'department required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO zkteco_dept_access (department, access_level_id, timezone_id, area_id)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (department, area_id) DO UPDATE SET
         access_level_id=$2, timezone_id=$3
       RETURNING *`,
      [department, accessLevelId||null, timezoneId||null, areaId||null]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error:err.message }); }
});

router.delete('/dept-access/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM zkteco_dept_access WHERE id=$1', [req.params.id]);
    res.json({ ok:true });
  } catch (err) { res.status(500).json({ error:err.message }); }
});

// ═══════════════════════════════════════════════════════
//  EXPORT / IMPORT USERS (cross-device migration)
// ═══════════════════════════════════════════════════════

// Export all users + FP templates for one device (or all devices) as JSON
// Usage: GET /api/zkteco/export-users?sn=GED7240400055
router.get('/export-users', async (req, res) => {
  const { sn } = req.query;
  try {
    const userRows = sn
      ? (await pool.query('SELECT * FROM zkteco_users WHERE device_sn=$1 ORDER BY pin', [sn])).rows
      : (await pool.query('SELECT * FROM zkteco_users ORDER BY device_sn, pin')).rows;

    const users = [];
    for (const u of userRows) {
      const fpRows = (await pool.query(
        `SELECT finger_id, template_size, valid, template_data
         FROM zkteco_fingerprints WHERE device_sn=$1 AND pin=$2 ORDER BY finger_id`,
        [u.device_sn, u.pin]
      )).rows;
      users.push({
        pin          : u.pin,
        name         : u.name         || '',
        privilege    : u.privilege    || 0,
        card         : u.card_no      || '',
        passwd       : u.passwd       || '',
        fpTemplates  : fpRows.map(f => ({
          fid      : f.finger_id,
          size     : f.template_size,
          valid    : f.valid ?? 1,
          template : f.template_data,   // null if no backup
        })),
        facePhoto          : u.face_photo || null,
        originalDeviceSn   : u.device_sn,
      });
    }

    const filename = `users_${sn || 'all'}_${new Date().toISOString().slice(0,10)}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json({
      exportedAt : new Date().toISOString(),
      sourceSn   : sn || null,
      userCount  : users.length,
      users,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Import users JSON + push ALL stored users+FP templates to a target device
// Body: { users: [ { pin, name, privilege, card, passwd, fpTemplates, facePhoto } ] }
router.post('/devices/:id/import-users', async (req, res) => {
  const { users } = req.body;
  if (!Array.isArray(users)) return res.status(400).json({ error: 'users array required' });
  try {
    const sn = await getSnById(req.params.id);
    let userCount = 0, fpCount = 0;

    for (const u of users) {
      if (!u.pin) continue;

      // Upsert into zkteco_users for this target device
      await pool.query(
        `INSERT INTO zkteco_users (device_sn, pin, name, privilege, card_no, passwd, last_sync)
         VALUES ($1,$2,$3,$4,$5,$6,NOW())
         ON CONFLICT (device_sn, pin) DO UPDATE SET
           name=$3, privilege=$4, card_no=$5, passwd=$6, last_sync=NOW()`,
        [sn, u.pin, u.name||'', u.privilege||0, u.card||'0', u.passwd||null]
      );

      // Queue DATA UPDATE USERINFO
      const uParams = buildUserInfoParams({
        pin: u.pin, name: u.name||'', privilege: u.privilege||0,
        passwd: u.passwd||'', card: u.card||'',
      });
      await queueCommand(sn, 'DATA UPDATE USERINFO', uParams);
      userCount++;

      // Upsert FP templates and queue DATA UPDATE FINGERTMP
      for (const fp of u.fpTemplates || []) {
        if (!fp.template) continue;
        await pool.query(
          `INSERT INTO zkteco_fingerprints (device_sn, pin, finger_id, template_size, valid, template_data, enrolled_at)
           VALUES ($1,$2,$3,$4,$5,$6,NOW())
           ON CONFLICT (device_sn, pin, finger_id) DO UPDATE SET
             template_size=EXCLUDED.template_size, valid=EXCLUDED.valid,
             template_data=EXCLUDED.template_data, enrolled_at=NOW()`,
          [sn, u.pin, fp.fid, fp.size||0, fp.valid??1, fp.template]
        );
        await queueCommand(sn, 'DATA UPDATE FINGERTMP',
          `PIN=${u.pin}\tFID=${fp.fid}\tSize=${fp.size||0}\tValid=${fp.valid??1}\tTMP=${fp.template}`
        );
        fpCount++;
      }
    }

    res.json({ ok: true, sn, userCount, fpCount,
      message: `${userCount} users + ${fpCount} FP templates queued for "${sn}"` });
  } catch (err) { res.status(err.status||500).json({ error: err.message }); }
});

// Push ALL users already stored in DB for a device back to that device
// Useful after a device reset or to push to a second device in the same area
router.post('/devices/:id/push-stored-users', async (req, res) => {
  try {
    const sn = await getSnById(req.params.id);
    const users = (await pool.query(
      'SELECT * FROM zkteco_users WHERE device_sn=$1', [sn]
    )).rows;

    let userCount = 0, fpCount = 0;
    for (const u of users) {
      const uParams = buildUserInfoParams({
        pin: u.pin, name: u.name||'', privilege: u.privilege||0,
        passwd: u.passwd||'', card: u.card_no||'',
      });
      await queueCommand(sn, 'DATA UPDATE USERINFO', uParams);
      userCount++;

      const fps = (await pool.query(
        `SELECT * FROM zkteco_fingerprints WHERE device_sn=$1 AND pin=$2 AND template_data IS NOT NULL`,
        [sn, u.pin]
      )).rows;
      for (const fp of fps) {
        await queueCommand(sn, 'DATA UPDATE FINGERTMP',
          `PIN=${fp.pin}\tFID=${fp.finger_id}\tSize=${fp.template_size}\tValid=${fp.valid||1}\tTMP=${fp.template_data}`
        );
        fpCount++;
      }
    }
    res.json({ ok: true, sn, userCount, fpCount,
      message: `${userCount} users + ${fpCount} FP templates re-queued` });
  } catch (err) { res.status(err.status||500).json({ error: err.message }); }
});

// ── Push ALL access rules (AccTimeZone + AccGroup + AccHoliday) to one device ──
// Triggered by "Push Access Rules to Device" button in Access Rule UI
router.post('/devices/:id/push-access-rules', async (req, res) => {
  try {
    const sn = await getSnById(req.params.id);

    // Push all AccTimeZone records
    const { rows: tzRows } = await pool.query('SELECT * FROM zkteco_timezones ORDER BY id');
    for (const tz of tzRows) {
      await queueCommand(sn, 'DATA UPDATE AccTimeZone', buildAccTimeZoneParams(tz));
    }

    // Push all AccGroup records
    const { rows: lvRows } = await pool.query('SELECT * FROM zkteco_access_levels ORDER BY id');
    for (const lv of lvRows) {
      await queueCommand(sn, 'DATA UPDATE AccGroup', buildAccGroupParams(lv));
    }

    // Push all AccHoliday records
    const { rows: hRows } = await pool.query('SELECT * FROM zkteco_acc_holidays ORDER BY id');
    for (const h of hRows) {
      const tzId = h.timezone_id || 1;
      await queueCommand(sn, 'DATA UPDATE AccHoliday',
        `UID=${h.id}\tHolidayName=${h.holiday_name}\tStartDate=${h.start_date}\tEndDate=${h.end_date}\tTimeZone=${tzId}`
      );
    }

    // Push all AccUnLockComb records
    const { rows: ucRows } = await pool.query('SELECT * FROM zkteco_unlock_comb ORDER BY uid');
    for (const uc of ucRows) {
      await queueCommand(sn, 'DATA UPDATE AccUnLockComb',
        `UID=${uc.uid}\tGroup1=${uc.group1||0}\tGroup2=${uc.group2||0}\tGroup3=${uc.group3||0}\tGroup4=${uc.group4||0}\tGroup5=${uc.group5||0}`
      );
    }

    console.log(`[ZK API] Push Access Rules: ${sn} — ${tzRows.length} TZ + ${lvRows.length} Groups + ${hRows.length} Holidays + ${ucRows.length} UnlockComb`);
    res.json({
      ok: true, sn,
      timezones: tzRows.length, groups: lvRows.length,
      holidays: hRows.length, unlockCombos: ucRows.length,
    });
  } catch (err) { res.status(err.status||500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════
//  ACC HOLIDAYS — DATA UPDATE AccHoliday
// ═══════════════════════════════════════════════════════

router.get('/acc-holidays', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT h.*, tz.name AS timezone_name
      FROM   zkteco_acc_holidays h
      LEFT   JOIN zkteco_timezones tz ON tz.id = h.timezone_id
      ORDER  BY h.start_date, h.id
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error:err.message }); }
});

router.post('/acc-holidays', async (req, res) => {
  const { holidayName, startDate, endDate, timezoneId, remarks } = req.body;
  if (!holidayName || !startDate || !endDate)
    return res.status(400).json({ error:'holidayName, startDate, endDate required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO zkteco_acc_holidays (holiday_name,start_date,end_date,timezone_id,remarks)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [holidayName, startDate, endDate, timezoneId||null, remarks||null]
    );
    // Push to all active devices
    const { rows: devices } = await pool.query(
      `SELECT serial_number FROM zkteco_devices WHERE active=TRUE AND serial_number IS NOT NULL`
    );
    const h = rows[0];
    for (const d of devices) {
      await queueCommand(d.serial_number, 'DATA UPDATE AccHoliday',
        `UID=${h.id}\tHolidayName=${h.holiday_name}\tStartDate=${h.start_date}\tEndDate=${h.end_date}\tTimeZone=${h.timezone_id||1}`
      );
    }
    res.status(201).json({ ...rows[0], pushedToDevices: devices.length });
  } catch (err) { res.status(500).json({ error:err.message }); }
});

router.put('/acc-holidays/:id', async (req, res) => {
  const { holidayName, startDate, endDate, timezoneId, remarks } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE zkteco_acc_holidays SET
         holiday_name=COALESCE($1,holiday_name), start_date=COALESCE($2,start_date),
         end_date=COALESCE($3,end_date), timezone_id=$4, remarks=COALESCE($5,remarks)
       WHERE id=$6 RETURNING *`,
      [holidayName, startDate, endDate, timezoneId||null, remarks, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error:'Not found' });
    const h = rows[0];
    const { rows: devices } = await pool.query(
      `SELECT serial_number FROM zkteco_devices WHERE active=TRUE AND serial_number IS NOT NULL`
    );
    for (const d of devices) {
      await queueCommand(d.serial_number, 'DATA UPDATE AccHoliday',
        `UID=${h.id}\tHolidayName=${h.holiday_name}\tStartDate=${h.start_date}\tEndDate=${h.end_date}\tTimeZone=${h.timezone_id||1}`
      );
    }
    res.json({ ...rows[0], pushedToDevices: devices.length });
  } catch (err) { res.status(500).json({ error:err.message }); }
});

router.delete('/acc-holidays/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM zkteco_acc_holidays WHERE id=$1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error:'Not found' });
    res.json({ ok:true });
  } catch (err) { res.status(500).json({ error:err.message }); }
});

// ═══════════════════════════════════════════════════════
//  ACC UNLOCK COMBINATIONS — DATA UPDATE AccUnLockComb
// ═══════════════════════════════════════════════════════

router.get('/unlock-combos', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM zkteco_unlock_comb ORDER BY uid');
    res.json(rows);
  } catch (err) { res.status(500).json({ error:err.message }); }
});

router.post('/unlock-combos', async (req, res) => {
  const { uid, group1=0, group2=0, group3=0, group4=0, group5=0, remarks } = req.body;
  if (uid == null) return res.status(400).json({ error:'uid required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO zkteco_unlock_comb (uid,group1,group2,group3,group4,group5,remarks)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [uid, group1, group2, group3, group4, group5, remarks||null]
    );
    const uc = rows[0];
    const { rows: devices } = await pool.query(
      `SELECT serial_number FROM zkteco_devices WHERE active=TRUE AND serial_number IS NOT NULL`
    );
    for (const d of devices) {
      await queueCommand(d.serial_number, 'DATA UPDATE AccUnLockComb',
        `UID=${uc.uid}\tGroup1=${uc.group1}\tGroup2=${uc.group2}\tGroup3=${uc.group3}\tGroup4=${uc.group4}\tGroup5=${uc.group5}`
      );
    }
    res.status(201).json({ ...uc, pushedToDevices: devices.length });
  } catch (err) {
    if (err.code==='23505') return res.status(409).json({ error:'UID already exists' });
    res.status(500).json({ error:err.message });
  }
});

router.put('/unlock-combos/:id', async (req, res) => {
  const { uid, group1, group2, group3, group4, group5, remarks } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE zkteco_unlock_comb SET
         uid=COALESCE($1,uid), group1=COALESCE($2,group1), group2=COALESCE($3,group2),
         group3=COALESCE($4,group3), group4=COALESCE($5,group4), group5=COALESCE($6,group5),
         remarks=COALESCE($7,remarks)
       WHERE id=$8 RETURNING *`,
      [uid, group1, group2, group3, group4, group5, remarks, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error:'Not found' });
    const uc = rows[0];
    const { rows: devices } = await pool.query(
      `SELECT serial_number FROM zkteco_devices WHERE active=TRUE AND serial_number IS NOT NULL`
    );
    for (const d of devices) {
      await queueCommand(d.serial_number, 'DATA UPDATE AccUnLockComb',
        `UID=${uc.uid}\tGroup1=${uc.group1}\tGroup2=${uc.group2}\tGroup3=${uc.group3}\tGroup4=${uc.group4}\tGroup5=${uc.group5}`
      );
    }
    res.json({ ...uc, pushedToDevices: devices.length });
  } catch (err) { res.status(500).json({ error:err.message }); }
});

router.delete('/unlock-combos/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM zkteco_unlock_comb WHERE id=$1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error:'Not found' });
    res.json({ ok:true });
  } catch (err) { res.status(500).json({ error:err.message }); }
});

router.get('/stats', async (_req, res) => {
  try {
    const [devRes,logRes,cmdRes,usrRes,fpRes]=await Promise.all([
      pool.query('SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE active)::int AS active FROM zkteco_devices'),
      pool.query(`SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE check_time>=NOW()-INTERVAL '24 hours')::int AS today FROM zkteco_attendance_logs`),
      pool.query(`SELECT COUNT(*) FILTER(WHERE status='PENDING')::int AS pending FROM zkteco_commands`),
      pool.query('SELECT COUNT(*)::int AS total FROM zkteco_users'),
      pool.query('SELECT COUNT(*)::int AS total, COUNT(*) FILTER(WHERE template_data IS NOT NULL)::int AS with_template FROM zkteco_fingerprints'),
    ]);
    res.json({
      devices  : devRes.rows[0],
      logs     : logRes.rows[0],
      commands : cmdRes.rows[0],
      users    : usrRes.rows[0],
      fingerprints: fpRes.rows[0],
    });
  } catch (err) { res.status(500).json({ error:err.message }); }
});

export default router;
