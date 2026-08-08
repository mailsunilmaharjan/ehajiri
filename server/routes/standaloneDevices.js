/**
 * ⚠ StandAlone SDK code (legacy zkemkeeper.dll COM control) — DISABLED BY
 * DEFAULT. This entire router is mounted behind requireModuleEnabled(FLAG_KEYS
 * .standaloneDevice) in server/index.js, itself default OFF (migration 47) and
 * only re-enableable from Settings → Role Management → Module Controls. The UI
 * tab that calls these routes is likewise hidden from every role, including
 * Admin/Super Admin, until that flag is turned on. Nothing below executes on a
 * fresh install unless someone explicitly opts in — see CLAUDE.md's "StandAlone
 * ZKTeco devices" section for the COM-registration prerequisite that makes it
 * fragile enough to keep gated.
 *
 * Standalone ZKTeco device REST API — consumed by the Settings → "StandAlone
 * Device" tab. Unlike /api/zkteco (ADMS push), these devices are PULLED from
 * via the standalone-bridge process (legacy SDK / zkemkeeper.dll COM control),
 * so every operation here is a synchronous call-and-wait, not a queued command.
 * Base: /api/standalone
 */

import express from 'express';
import crypto  from 'crypto';
import pool    from '../db.js';
import { requireRole } from '../middleware/roleGuard.js';
import {
  bridgeDisconnect, bridgeGetInfo, bridgeGetTime, bridgeSetTime,
  bridgeEnable, bridgeRestart, bridgePowerOff, bridgeRefresh,
  bridgeClearLogs,
  bridgeGetUsers, bridgeSetUser, bridgeDeleteUser,
  bridgeGetFingerprint, bridgeSetFingerprint, bridgeDeleteFingerprint,
  bridgeSendCommand, bridgeClearAdmin, bridgeClearAllUsers, bridgeBackup,
  bridgeGetUserBiometrics, bridgeGetFace, bridgeSetFace, bridgeDeleteFace,
  bridgeSetTimeZone, bridgeGetTimeZone, bridgeSetGroupTimeZone, bridgeSetUserGroup,
} from '../services/standaloneDeviceService.js';
import { connectDevice, syncDeviceLogs } from '../services/standaloneAttendanceSync.js';
import { parseAttlog, saveAttlogs } from '../services/zktecoService.js';

// Weekly punch-acceptance schedule, encoded the way the legacy SDK's
// SetTZInfo/GetTZInfo wants it: 7 days (Sun..Sat) x 8 chars (HHMM start +
// HHMM end), no separators — same Sun/Mon/Tue/... keys eHajiri already uses
// for zkteco_timezones.schedule (ADMS AccTimeZone), so both pipelines share
// one schedule definition. The SDK only supports ONE interval per day.
const TZ_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const toHHMM = (t) => (t || '00:00').replace(':', '').padStart(4, '0').slice(0, 4);
function buildTzString(schedule) {
  return TZ_DAYS.map((day) => {
    const interval = schedule?.[day]?.[0];
    if (!interval || interval.closed) return '00000000';
    return toHHMM(interval.s) + toHHMM(interval.e);
  }).join('');
}
function parseTzString(tz) {
  const schedule = {};
  for (let i = 0; i < 7; i++) {
    const block = (tz || '').slice(i * 8, i * 8 + 8).padEnd(8, '0');
    const s = block.slice(0, 4), e = block.slice(4, 8);
    schedule[TZ_DAYS[i]] = [{ s: `${s.slice(0, 2)}:${s.slice(2, 4)}`, e: `${e.slice(0, 2)}:${e.slice(2, 4)}` }];
  }
  return schedule;
}

const router = express.Router();
const canManageDevices = requireRole('admin', 'branchManager', 'superAdmin');
const canDeleteAllLogs = requireRole('admin', 'superAdmin');

async function getDeviceById(id) {
  const { rows } = await pool.query('SELECT * FROM standalone_devices WHERE id=$1', [id]);
  if (!rows[0]) throw Object.assign(new Error('Device not found'), { status: 404 });
  return rows[0];
}

// ═══════════════════════════════════════════════════════
//  DEVICE CRUD
// ═══════════════════════════════════════════════════════

router.get('/devices', async (_req, res) => {
  try {
    // user_count/fingerprint_count used to come from COUNT(DISTINCT ...) over
    // two independent LEFT JOINs on the same device — fan-out (see the
    // identical fix + explanation in zktecoApi.js's GET /devices). Scoped as
    // scalar subqueries instead, same as log_count already was, so the join
    // itself stays 1:1 regardless of how many users/fingerprints pile up.
    const { rows } = await pool.query(`
      SELECT d.*,
             (SELECT COUNT(*)::int FROM standalone_users        u WHERE u.device_id = d.id) AS user_count,
             (SELECT COUNT(*)::int FROM standalone_fingerprints f WHERE f.device_id = d.id) AS fingerprint_count,
             (SELECT COUNT(*)::int FROM zkteco_attendance_logs zl WHERE zl.device_sn = d.serial_number) AS log_count
      FROM   standalone_devices d
      ORDER BY d.created_at DESC
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/devices', canManageDevices, async (req, res) => {
  const { name, ipAddress, port, commPassword, model, location } = req.body;
  if (!name || !ipAddress) return res.status(400).json({ error: 'name and ipAddress are required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO standalone_devices (name, ip_address, port, comm_password, model, location)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [name, ipAddress, port || 4370, commPassword || '', model || 'Unknown', location || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/devices/:id', canManageDevices, async (req, res) => {
  const { name, ipAddress, port, commPassword, location, active } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE standalone_devices SET
         name          = COALESCE($1, name),
         ip_address    = COALESCE($2, ip_address),
         port          = COALESCE($3, port),
         comm_password = COALESCE($4, comm_password),
         location      = COALESCE($5, location),
         active        = COALESCE($6, active)
       WHERE id=$7 RETURNING *`,
      [name, ipAddress, port, commPassword, location, active, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Device not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/devices/:id', canManageDevices, async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM standalone_devices WHERE id=$1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Device not found' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════
//  CONNECTION LIFECYCLE
// ═══════════════════════════════════════════════════════

router.post('/devices/:id/connect', canManageDevices, async (req, res) => {
  try {
    const device = await getDeviceById(req.params.id);
    const result = await connectDevice(device);
    res.json(result);
  } catch (err) {
    await pool.query(
      `UPDATE standalone_devices SET connection_status='error', last_error=$2 WHERE id=$1`,
      [req.params.id, err.message]
    ).catch(() => {});
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/devices/:id/disconnect', canManageDevices, async (req, res) => {
  try {
    const result = await bridgeDisconnect(req.params.id);
    await pool.query(`UPDATE standalone_devices SET connection_status='disconnected' WHERE id=$1`, [req.params.id]);
    res.json(result);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.post('/devices/:id/sync-info', canManageDevices, async (req, res) => {
  try {
    const result = await bridgeGetInfo(req.params.id);
    const info = result.data;
    await pool.query(
      `UPDATE standalone_devices SET
         serial_number = COALESCE($1, serial_number),
         firmware_ver  = $2, platform = $3, vendor = $4, product_code = $5, mac_address = $6
       WHERE id=$7`,
      [info.serialNumber || null, info.firmwareVersion, info.platform, info.vendor, info.productCode, info.deviceMac, req.params.id]
    );
    res.json(result);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════
//  REMOTE SYNC AGENT — a device-scoped bearer token that lets
//  standalone-bridge.exe run in "remote sync" mode (RemoteSyncAgent.cs) at a
//  site whose device this server can't reach directly, POSTing fetched logs
//  to POST /api/standalone-sync/logs instead of this server pulling them over
//  the loopback bridge. See middleware/standaloneSyncTokenGuard.js.
// ═══════════════════════════════════════════════════════

router.post('/devices/:id/sync-token', canManageDevices, async (req, res) => {
  try {
    const device = await getDeviceById(req.params.id);
    const token = crypto.randomBytes(32).toString('hex');
    await pool.query('UPDATE standalone_devices SET sync_token=$1 WHERE id=$2', [token, device.id]);
    const config = {
      deviceIp       : device.ip_address,
      devicePort     : device.port,
      commPassword   : device.comm_password || '',
      serverUrl      : req.body.serverUrl || `${req.protocol}://${req.get('host')}`,
      syncToken      : token,
      pollIntervalSec: 60,
    };
    res.json({ ok: true, token, config });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// Revoke — a leaked config.json (or a decommissioned site) should stop being
// able to push logs immediately, not just until someone remembers to delete
// the device row.
router.delete('/devices/:id/sync-token', canManageDevices, async (req, res) => {
  try {
    await pool.query('UPDATE standalone_devices SET sync_token=NULL WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════
//  CORE DEVICE COMMANDS
// ═══════════════════════════════════════════════════════

router.get('/devices/:id/time', async (req, res) => {
  try { res.json(await bridgeGetTime(req.params.id)); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.post('/devices/:id/time', canManageDevices, async (req, res) => {
  try { res.json(await bridgeSetTime(req.params.id, req.body.time)); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.post('/devices/:id/enable', canManageDevices, async (req, res) => {
  try { res.json(await bridgeEnable(req.params.id, true)); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.post('/devices/:id/disable', canManageDevices, async (req, res) => {
  try { res.json(await bridgeEnable(req.params.id, false)); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.post('/devices/:id/restart', canManageDevices, async (req, res) => {
  try { res.json(await bridgeRestart(req.params.id)); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.post('/devices/:id/poweroff', canManageDevices, async (req, res) => {
  try { res.json(await bridgePowerOff(req.params.id)); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.post('/devices/:id/refresh', canManageDevices, async (req, res) => {
  try { res.json(await bridgeRefresh(req.params.id)); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.post('/devices/:id/clear-admin', canManageDevices, async (req, res) => {
  try { res.json(await bridgeClearAdmin(req.params.id)); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.post('/devices/:id/users/clear-all', canManageDevices, async (req, res) => {
  try {
    const result = await bridgeClearAllUsers(req.params.id);
    await pool.query('DELETE FROM standalone_users WHERE device_id=$1', [req.params.id]);
    await pool.query('DELETE FROM standalone_fingerprints WHERE device_id=$1', [req.params.id]);
    res.json(result);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════
//  BACKUP — wraps the SDK's BackupData() call, which writes the device's
//  full user+template database to a local file on this PC.
// ═══════════════════════════════════════════════════════

router.post('/devices/:id/backup', canManageDevices, async (req, res) => {
  try {
    const device = await getDeviceById(req.params.id);
    const fileName = `${device.name.replace(/[^a-z0-9_-]/gi, '_')}-${Date.now()}.dat`;
    const result = await bridgeBackup(device.id, fileName);
    await pool.query(
      'INSERT INTO standalone_backups (device_id, file_path, taken_by) VALUES ($1,$2,$3)',
      [device.id, result.data, req.user?.id || null]
    );
    res.json(result);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.get('/backups', async (req, res) => {
  try {
    const { deviceId } = req.query;
    const params = [];
    let where = '';
    if (deviceId) { params.push(deviceId); where = 'WHERE b.device_id = $1'; }
    const { rows } = await pool.query(
      `SELECT b.*, d.name AS device_name
       FROM standalone_backups b
       JOIN standalone_devices d ON d.id = b.device_id
       ${where}
       ORDER BY b.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════
//  ATTENDANCE LOGS
// ═══════════════════════════════════════════════════════

// Fetched logs are written into zkteco_attendance_logs — the SAME table the
// ADMS-push pipeline uses — via the existing saveAttlogs() helper, keyed by
// the device's serial_number. This makes standalone-pulled punches show up
// in the existing Attendance reports automatically, with no report-side
// changes, and reuses saveAttlogs' employee-link + live-notification logic.
router.post('/devices/:id/logs/fetch', canManageDevices, async (req, res) => {
  try {
    const device = await getDeviceById(req.params.id);
    const result = await syncDeviceLogs(device);
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.delete('/devices/:id/logs', canManageDevices, async (req, res) => {
  try { res.json(await bridgeClearLogs(req.params.id)); }
  catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// Fallback path for devices with no usable network/SDK connection: many
// ZKTeco units can export their attendance buffer to a USB stick as a plain
// "PIN\tDateTime\tVerify\tInOut" file (same format the ADMS pipeline already
// parses) — admin plugs the stick into this PC and uploads that file here.
router.post('/devices/:id/usb-upload', canManageDevices, async (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'No file content provided' });
  try {
    let device = await getDeviceById(req.params.id);
    if (!device.serial_number) {
      const info = (await bridgeGetInfo(device.id).catch(() => null))?.data;
      if (info?.serialNumber) {
        await pool.query('UPDATE standalone_devices SET serial_number=$1 WHERE id=$2', [info.serialNumber, device.id]);
        device = await getDeviceById(device.id);
      }
    }
    if (!device.serial_number) {
      return res.status(400).json({ error: 'Device has no serial number yet — connect once (or set it manually) before importing a USB file' });
    }

    const records = parseAttlog(content);
    const inserted = await saveAttlogs(device.serial_number, records);
    res.json({ ok: true, parsed: records.length, inserted });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.get('/logs', async (req, res) => {
  try {
    const { deviceId, limit = 200, offset = 0 } = req.query;
    const params = [];
    let where = '';
    if (deviceId) {
      const device = await getDeviceById(deviceId);
      params.push(device.serial_number || '__none__');
      where = `WHERE l.device_sn = $${params.length}`;
    } else {
      // Scope to standalone devices only — this endpoint backs the StandAlone tab.
      where = `WHERE l.device_sn IN (SELECT serial_number FROM standalone_devices WHERE serial_number IS NOT NULL)`;
    }
    params.push(parseInt(limit), parseInt(offset));
    const { rows } = await pool.query(
      `SELECT l.*, d.name AS device_name
       FROM zkteco_attendance_logs l
       JOIN standalone_devices d ON d.serial_number = l.device_sn
       ${where}
       ORDER BY l.check_time DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json(rows);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// Permanently deletes all eHajiri-stored attendance log history for standalone
// devices (the device's own log buffer is untouched). Restricted to
// admin/superAdmin only — more sensitive than the per-device clear above.
router.delete('/logs', canDeleteAllLogs, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM zkteco_attendance_logs
       WHERE device_sn IN (SELECT serial_number FROM standalone_devices WHERE serial_number IS NOT NULL)`
    );
    res.json({ ok: true, deleted: rowCount });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════
//  USERS
// ═══════════════════════════════════════════════════════

router.post('/devices/:id/users/fetch', canManageDevices, async (req, res) => {
  try {
    const deviceId = req.params.id;
    const result = await bridgeGetUsers(deviceId);
    const users = result.data || [];
    for (const u of users) {
      await pool.query(
        `INSERT INTO standalone_users (device_id, enroll_number, name, privilege, password, enabled, card_no, last_sync)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
         ON CONFLICT (device_id, enroll_number) DO UPDATE SET
           name = EXCLUDED.name, privilege = EXCLUDED.privilege, password = EXCLUDED.password,
           enabled = EXCLUDED.enabled, card_no = EXCLUDED.card_no, last_sync = NOW()`,
        [deviceId, u.enrollNumber, u.name, u.privilege, u.password, u.enabled, u.cardNumber || '0']
      );
    }
    res.json({ ok: true, fetched: users.length });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.post('/devices/:id/users', canManageDevices, async (req, res) => {
  try {
    const deviceId = req.params.id;
    const { enrollNumber, name, password, privilege, enabled, cardNumber } = req.body;
    const result = await bridgeSetUser(deviceId, { enrollNumber, name, password: password || '', privilege: privilege || 0, enabled: enabled !== false, cardNumber: cardNumber || null });
    await pool.query(
      `INSERT INTO standalone_users (device_id, enroll_number, name, privilege, password, enabled, card_no, last_sync)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
       ON CONFLICT (device_id, enroll_number) DO UPDATE SET
         name = EXCLUDED.name, privilege = EXCLUDED.privilege, password = EXCLUDED.password,
         enabled = EXCLUDED.enabled, card_no = EXCLUDED.card_no, last_sync = NOW()`,
      [deviceId, enrollNumber, name, privilege || 0, password || '', enabled !== false, cardNumber || '0']
    );
    res.json(result);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.delete('/devices/:id/users/:enrollNumber', canManageDevices, async (req, res) => {
  try {
    const result = await bridgeDeleteUser(req.params.id, req.params.enrollNumber);
    await pool.query('DELETE FROM standalone_users WHERE device_id=$1 AND enroll_number=$2', [req.params.id, req.params.enrollNumber]);
    await pool.query('DELETE FROM standalone_fingerprints WHERE device_id=$1 AND enroll_number=$2', [req.params.id, req.params.enrollNumber]);
    res.json(result);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.get('/device-users', async (req, res) => {
  try {
    const { deviceId } = req.query;
    const params = [];
    let where = '';
    if (deviceId) { params.push(deviceId); where = 'WHERE u.device_id = $1'; }
    const { rows } = await pool.query(
      `SELECT u.*, d.name AS device_name,
              (SELECT COUNT(*)::int FROM standalone_fingerprints f
                 WHERE f.device_id = u.device_id AND f.enroll_number = u.enroll_number AND f.template_type = 'fp')   AS fp_count,
              (SELECT COUNT(*)::int FROM standalone_fingerprints f
                 WHERE f.device_id = u.device_id AND f.enroll_number = u.enroll_number AND f.template_type = 'face') AS face_count
       FROM standalone_users u
       JOIN standalone_devices d ON d.id = u.device_id
       ${where}
       ORDER BY u.enroll_number`,
      params
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════
//  FINGERPRINTS
// ═══════════════════════════════════════════════════════

router.get('/devices/:id/users/:enrollNumber/fingerprints/:fingerIndex', canManageDevices, async (req, res) => {
  try {
    const { id, enrollNumber, fingerIndex } = req.params;
    const result = await bridgeGetFingerprint(id, enrollNumber, fingerIndex);
    const tpl = result.data;
    await pool.query(
      `INSERT INTO standalone_fingerprints (device_id, enroll_number, finger_index, template_data, template_size, template_type)
       VALUES ($1,$2,$3,$4,$5,'fp')
       ON CONFLICT (device_id, enroll_number, finger_index, template_type) DO UPDATE SET
         template_data = EXCLUDED.template_data, template_size = EXCLUDED.template_size, enrolled_at = NOW()`,
      [id, enrollNumber, fingerIndex, tpl.templateData, tpl.templateLength]
    );
    res.json(result);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.post('/devices/:id/users/:enrollNumber/fingerprints/:fingerIndex', canManageDevices, async (req, res) => {
  try {
    const { id, enrollNumber, fingerIndex } = req.params;
    const { templateData } = req.body;
    const result = await bridgeSetFingerprint(id, enrollNumber, fingerIndex, templateData);
    await pool.query(
      `INSERT INTO standalone_fingerprints (device_id, enroll_number, finger_index, template_data, template_size, template_type)
       VALUES ($1,$2,$3,$4,$5,'fp')
       ON CONFLICT (device_id, enroll_number, finger_index, template_type) DO UPDATE SET
         template_data = EXCLUDED.template_data, template_size = EXCLUDED.template_size, enrolled_at = NOW()`,
      [id, enrollNumber, fingerIndex, templateData, (templateData || '').length]
    );
    res.json(result);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.delete('/devices/:id/users/:enrollNumber/fingerprints/:fingerIndex', canManageDevices, async (req, res) => {
  try {
    const { id, enrollNumber, fingerIndex } = req.params;
    const result = await bridgeDeleteFingerprint(id, enrollNumber, fingerIndex);
    await pool.query(
      `DELETE FROM standalone_fingerprints WHERE device_id=$1 AND enroll_number=$2 AND finger_index=$3 AND template_type='fp'`,
      [id, enrollNumber, fingerIndex]
    );
    res.json(result);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════
//  TIME SCHEDULE — weekly punch-acceptance windows (Sun..Sat). Reuses the
//  same zkteco_timezones table/schedule shape as the ADMS pipeline so a
//  schedule is defined once and can be pushed to either kind of device.
//  Pushing the schedule string alone does nothing on the device until a
//  group (and the users in it) is pointed at that slot.
// ═══════════════════════════════════════════════════════

router.post('/devices/:id/timezones/:tzIndex', canManageDevices, async (req, res) => {
  try {
    const { timezoneId, schedule } = req.body;
    let sched = schedule;
    if (!sched && timezoneId) {
      const { rows } = await pool.query('SELECT schedule FROM zkteco_timezones WHERE id=$1', [timezoneId]);
      if (!rows[0]) return res.status(404).json({ error: 'Time schedule not found' });
      sched = typeof rows[0].schedule === 'string' ? JSON.parse(rows[0].schedule) : rows[0].schedule;
    }
    if (!sched) return res.status(400).json({ error: 'schedule or timezoneId is required' });
    res.json(await bridgeSetTimeZone(req.params.id, req.params.tzIndex, buildTzString(sched)));
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.get('/devices/:id/timezones/:tzIndex', canManageDevices, async (req, res) => {
  try {
    const result = await bridgeGetTimeZone(req.params.id, req.params.tzIndex);
    res.json({ ...result, schedule: parseTzString(result.data) });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// Apply a pushed schedule slot to a user GROUP — every user in that group is
// then gated by it. Most devices default every normal user to group 1.
router.post('/devices/:id/groups/:groupNo/timezone', canManageDevices, async (req, res) => {
  try {
    const { tzIndex } = req.body;
    if (!tzIndex) return res.status(400).json({ error: 'tzIndex is required' });
    res.json(await bridgeSetGroupTimeZone(req.params.id, req.params.groupNo, tzIndex));
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// Move one user into a (schedule-gated) group, for finer-grained control
// than gating the whole default group.
router.post('/devices/:id/users/:enrollNumber/group', canManageDevices, async (req, res) => {
  try {
    const { groupNo } = req.body;
    if (groupNo === undefined) return res.status(400).json({ error: 'groupNo is required' });
    res.json(await bridgeSetUserGroup(req.params.id, req.params.enrollNumber, groupNo));
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// ── Face templates (mirrors fingerprints; not all firmware supports these) ──

router.get('/devices/:id/users/:enrollNumber/face/:faceIndex', canManageDevices, async (req, res) => {
  try {
    const { id, enrollNumber, faceIndex } = req.params;
    const result = await bridgeGetFace(id, enrollNumber, faceIndex);
    const tpl = result.data;
    await pool.query(
      `INSERT INTO standalone_fingerprints (device_id, enroll_number, finger_index, template_data, template_size, template_type)
       VALUES ($1,$2,$3,$4,$5,'face')
       ON CONFLICT (device_id, enroll_number, finger_index, template_type) DO UPDATE SET
         template_data = EXCLUDED.template_data, template_size = EXCLUDED.template_size, enrolled_at = NOW()`,
      [id, enrollNumber, faceIndex, tpl.templateData, tpl.templateLength]
    );
    res.json(result);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.post('/devices/:id/users/:enrollNumber/face/:faceIndex', canManageDevices, async (req, res) => {
  try {
    const { id, enrollNumber, faceIndex } = req.params;
    const { templateData } = req.body;
    const result = await bridgeSetFace(id, enrollNumber, faceIndex, templateData);
    await pool.query(
      `INSERT INTO standalone_fingerprints (device_id, enroll_number, finger_index, template_data, template_size, template_type)
       VALUES ($1,$2,$3,$4,$5,'face')
       ON CONFLICT (device_id, enroll_number, finger_index, template_type) DO UPDATE SET
         template_data = EXCLUDED.template_data, template_size = EXCLUDED.template_size, enrolled_at = NOW()`,
      [id, enrollNumber, faceIndex, templateData, (templateData || '').length]
    );
    res.json(result);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.delete('/devices/:id/users/:enrollNumber/face/:faceIndex', canManageDevices, async (req, res) => {
  try {
    const { id, enrollNumber, faceIndex } = req.params;
    const result = await bridgeDeleteFace(id, enrollNumber, faceIndex);
    await pool.query(
      `DELETE FROM standalone_fingerprints WHERE device_id=$1 AND enroll_number=$2 AND finger_index=$3 AND template_type='face'`,
      [id, enrollNumber, faceIndex]
    );
    res.json(result);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// ── Bulk biometric backup — every finger + face template for every known
//    user on the device, persisted into standalone_fingerprints. This is
//    what "download fingerprint/face/PIN backup" and device cloning use. ──

router.post('/devices/:id/biometrics/fetch-all', canManageDevices, async (req, res) => {
  try {
    const deviceId = req.params.id;
    const { rows: users } = await pool.query('SELECT enroll_number FROM standalone_users WHERE device_id=$1', [deviceId]);
    let fpCount = 0, faceCount = 0, errors = 0;

    for (const u of users) {
      try {
        const { data } = await bridgeGetUserBiometrics(deviceId, u.enroll_number);
        for (const fp of data.fingerprints || []) {
          await pool.query(
            `INSERT INTO standalone_fingerprints (device_id, enroll_number, finger_index, template_data, template_size, template_type)
             VALUES ($1,$2,$3,$4,$5,'fp')
             ON CONFLICT (device_id, enroll_number, finger_index, template_type) DO UPDATE SET
               template_data = EXCLUDED.template_data, template_size = EXCLUDED.template_size, enrolled_at = NOW()`,
            [deviceId, u.enroll_number, fp.fingerIndex, fp.templateData, fp.templateLength]
          );
          fpCount++;
        }
        if (data.face) {
          await pool.query(
            `INSERT INTO standalone_fingerprints (device_id, enroll_number, finger_index, template_data, template_size, template_type)
             VALUES ($1,$2,$3,$4,$5,'face')
             ON CONFLICT (device_id, enroll_number, finger_index, template_type) DO UPDATE SET
               template_data = EXCLUDED.template_data, template_size = EXCLUDED.template_size, enrolled_at = NOW()`,
            [deviceId, u.enroll_number, data.face.faceIndex, data.face.templateData, data.face.templateLength]
          );
          faceCount++;
        }
      } catch { errors++; }
    }
    res.json({ ok: true, users: users.length, fingerprints: fpCount, faces: faceCount, errors });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════
//  CLONE — push users + their backed-up biometric templates from one
//  standalone device's cache onto another device automatically.
// ═══════════════════════════════════════════════════════

router.post('/devices/:targetId/clone-from/:sourceId', canManageDevices, async (req, res) => {
  try {
    const { targetId, sourceId } = req.params;
    const { rows: users } = await pool.query('SELECT * FROM standalone_users WHERE device_id=$1', [sourceId]);

    let usersCopied = 0, templatesCopied = 0;
    const errors = [];

    for (const u of users) {
      try {
        await bridgeSetUser(targetId, {
          enrollNumber: u.enroll_number, name: u.name, password: u.password || '',
          privilege: u.privilege || 0, enabled: u.enabled !== false,
        });
        usersCopied++;
      } catch (err) {
        errors.push(`User ${u.enroll_number}: ${err.message}`);
        continue;
      }

      const { rows: templates } = await pool.query(
        'SELECT * FROM standalone_fingerprints WHERE device_id=$1 AND enroll_number=$2',
        [sourceId, u.enroll_number]
      );
      for (const t of templates) {
        try {
          if (t.template_type === 'face') {
            await bridgeSetFace(targetId, u.enroll_number, t.finger_index, t.template_data);
          } else {
            await bridgeSetFingerprint(targetId, u.enroll_number, t.finger_index, t.template_data);
          }
          templatesCopied++;
        } catch (err) {
          errors.push(`User ${u.enroll_number} template ${t.template_type}/${t.finger_index}: ${err.message}`);
        }
      }
    }

    res.json({ ok: true, usersCopied, templatesCopied, errorCount: errors.length, errors: errors.slice(0, 20) });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.get('/fingerprints', async (req, res) => {
  try {
    const { deviceId } = req.query;
    const params = [];
    let where = '';
    if (deviceId) { params.push(deviceId); where = 'WHERE f.device_id = $1'; }
    const { rows } = await pool.query(
      `SELECT f.*, d.name AS device_name
       FROM standalone_fingerprints f
       JOIN standalone_devices d ON d.id = f.device_id
       ${where}
       ORDER BY f.enroll_number, f.finger_index`,
      params
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════
//  GENERIC COMMAND (long tail: LCD, voice, work codes, daylight, holidays, etc.)
// ═══════════════════════════════════════════════════════

router.post('/devices/:id/command', canManageDevices, async (req, res) => {
  try {
    const { method, args } = req.body;
    if (!method) return res.status(400).json({ error: 'method is required' });
    res.json(await bridgeSendCommand(req.params.id, method, args || []));
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════
//  STATS
// ═══════════════════════════════════════════════════════

router.get('/stats', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM standalone_devices)             AS device_count,
        (SELECT COUNT(*)::int FROM standalone_devices WHERE connection_status='connected') AS connected_count,
        (SELECT COUNT(*)::int FROM zkteco_attendance_logs WHERE device_sn IN
           (SELECT serial_number FROM standalone_devices WHERE serial_number IS NOT NULL)) AS log_count,
        (SELECT COUNT(*)::int FROM standalone_users)               AS user_count,
        (SELECT COUNT(*)::int FROM standalone_fingerprints)        AS fingerprint_count
    `);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
