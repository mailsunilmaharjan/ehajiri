/**
 * ZKTeco ADMS Push Protocol Service
 * Implemented per: ZKTeco ADMS Developer Implementation Guide (ZLM60 firmware 8.0.4.3)
 *
 * Supported: M2F, SenseFace, K40 Pro, MB2000, SenseFace 4A/7A
 *
 * CRITICAL NOTES FROM GUIDE:
 *  - transTimes must be LOWERCASE 't' — firmware silently ignores 'TransTimes'
 *  - TransFlag MUST be numeric bitmask '1111000000' — text format silently ignored
 *  - OPERLOGStamp MUST always be 0 — echoing stamp stops OPERLOG (= no FP templates)
 *  - FP template data arrives via table=OPERLOG, NOT table=FP
 *  - After every handshake: queue SET OPTION UserValidTimeFun=1
 *  - Command IDs must be per-device monotonically increasing integers
 */

import pool from '../db.js';
import { getCurrentUserId } from './requestContext.js';

export const CHECK_TYPE_LABELS  = { 0:'Check In', 1:'Check Out', 2:'Break Out', 3:'Break In', 4:'OT In', 5:'OT Out' };
export const VERIFY_TYPE_LABELS = { 1:'Fingerprint', 2:'Password', 4:'Card', 8:'Face', 20:'Password' };
export const PRIVILEGE_LABELS   = { 0:'User', 1:'Enroller', 2:'Manager', 6:'Admin', 14:'Super Admin' };
export const FINGER_LABELS      = [
  'Right Index','Left Index','Right Middle','Left Middle',
  'Right Ring','Left Ring','Right Pinky','Left Pinky','Right Thumb','Left Thumb',
];
export const fingerLabel = (id) => FINGER_LABELS[id] || `Finger ${id}`;

// ── Timestamp helpers ──────────────────────────────────────────────────────

/** Format a JS Date as device local time string: "YYYY-MM-DD HH:MM:SS" */
export function formatZkTime(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())} ` +
         `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// ── Device helpers ─────────────────────────────────────────────────────────

export async function upsertDevice(sn, ipAddress, opts = {}) {
  const { firmware, platform } = opts;
  const { rows } = await pool.query(
    `INSERT INTO zkteco_devices (serial_number, name, ip_address, last_seen, last_ip, firmware_ver, platform)
     VALUES ($1,$2,$3,NOW(),$4,$5,$6)
     ON CONFLICT (serial_number) DO UPDATE SET
       last_seen    = NOW(),
       last_ip      = COALESCE(EXCLUDED.last_ip,      zkteco_devices.last_ip),
       firmware_ver = COALESCE(EXCLUDED.firmware_ver, zkteco_devices.firmware_ver),
       platform     = COALESCE(EXCLUDED.platform,     zkteco_devices.platform)
     RETURNING *`,
    [sn, sn, ipAddress, ipAddress, firmware||null, platform||null]
  );
  return rows[0];
}

/**
 * The device's OWN LAN address (e.g. 192.168.1.201). The address a request
 * arrives from is only the router/gateway (or 127.0.0.1 behind the relay), so
 * the real one has to come from what the device reports about itself: the INFO
 * CSV on every poll, or an IPAddress= field in its info report. Picks the first
 * private-range IPv4 found, ignoring firmware-version-looking tokens.
 */
export function findLanIp(text) {
  if (!text) return null;
  const re = /(?<![\d.])((?:10|192\.168|172\.(?:1[6-9]|2\d|3[01]))(?:\.\d{1,3}){2,3})(?![\d.])/g;
  for (const m of String(text).matchAll(re)) {
    const octets = m[1].split('.').map(Number);
    if (octets.length === 4 && octets.every(o => o >= 0 && o <= 255)) return m[1];
  }
  return null;
}

export async function saveLanIp(sn, text) {
  const lan = findLanIp(text);
  if (!lan) return;
  await pool.query(
    `UPDATE zkteco_devices SET lan_ip=$1 WHERE serial_number=$2 AND lan_ip IS DISTINCT FROM $1`,
    [lan, sn]
  );
}

export async function getDevice(sn) {
  const { rows } = await pool.query('SELECT * FROM zkteco_devices WHERE serial_number=$1', [sn]);
  return rows[0] || null;
}

export async function getDeviceStamp(sn) {
  const { rows } = await pool.query('SELECT attlog_stamp FROM zkteco_devices WHERE serial_number=$1', [sn]);
  return rows[0]?.attlog_stamp ?? null;
}

export async function updateDeviceStamp(sn) {
  const stamp = Math.floor(Date.now() / 1000).toString();
  await pool.query('UPDATE zkteco_devices SET attlog_stamp=$1 WHERE serial_number=$2', [stamp, sn]);
  return stamp;
}

export async function resetDeviceStamp(sn) {
  await pool.query('UPDATE zkteco_devices SET attlog_stamp=NULL WHERE serial_number=$1', [sn]);
}

export async function incrementLogCount(sn, count) {
  if (!count) return;
  await pool.query(
    'UPDATE zkteco_devices SET log_count=COALESCE(log_count,0)+$1 WHERE serial_number=$2',
    [count, sn]
  );
}

// ── Command queue ──────────────────────────────────────────────────────────

/**
 * Queue a command for a device.
 * Uses DB auto-increment id as cmdId (small integer) — firmware requires small IDs.
 */
export async function queueCommand(deviceSn, commandType, params = '') {
  const { rows: [stub] } = await pool.query(
    `INSERT INTO zkteco_commands (device_sn, command_payload, status, created_by_user_id)
     VALUES ($1,'__PENDING__','PENDING',$2) RETURNING id`,
    [deviceSn, getCurrentUserId()]
  );
  const cmdId = stub.id;
  const payload = params
    ? `C:${cmdId}:${commandType} ${params}`.trimEnd()
    : `C:${cmdId}:${commandType}`;
  const { rows } = await pool.query(
    'UPDATE zkteco_commands SET command_payload=$1 WHERE id=$2 RETURNING *',
    [payload, cmdId]
  );
  return rows[0];
}

// ── Auto-recovery: backfill ATTLOG after a real outage ────────────────────
// If a device reconnects (options=all handshake) after being silent for
// longer than this, the passive ATTLOGStamp-based push isn't reliable on
// all firmware — some devices echo a placeholder Stamp (seen in the wild:
// literal "9999") and just keep re-sending their recent onboard buffer
// instead of resuming from where they actually left off. The only reliable
// way to force a specific-range replay is the explicit DATA QUERY ATTLOG
// command (same one "Get All Logs" in Settings issues by hand). Detect the
// gap here and issue that pull automatically instead of depending on
// someone noticing missing reports days or weeks later.
const GAP_RECOVERY_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2h — past any routine reconnect blip

export async function recoverGapIfNeeded(sn, previousLastSeen) {
  if (!previousLastSeen) return; // brand-new device — nothing to recover
  const gapMs = Date.now() - new Date(previousLastSeen).getTime();
  if (gapMs < GAP_RECOVERY_THRESHOLD_MS) return;

  // Don't pile on if a backfill pull is already in flight for this device
  // (e.g. the same reconnect firing options=all more than once in a row).
  const { rows: existing } = await pool.query(
    `SELECT id FROM zkteco_commands
     WHERE device_sn=$1 AND status IN ('PENDING','SENT')
       AND command_payload LIKE '%DATA QUERY ATTLOG%'
     LIMIT 1`,
    [sn]
  );
  if (existing[0]) return;

  // 15min safety buffer for clock skew between server and device.
  const startTime = formatZkTime(new Date(new Date(previousLastSeen).getTime() - 15 * 60000));
  const endTime    = formatZkTime();
  await queueCommand(sn, 'RELOAD OPTIONS');
  await queueCommand(sn, 'DATA QUERY ATTLOG', `StartTime=${startTime}\tEndTime=${endTime}`);
  console.log(`[ZK] Auto-recovery: SN=${sn} silent for ${(gapMs/3600000).toFixed(1)}h — queued backfill pull ${startTime} → ${endTime}`);
}

export async function getNextCommand(deviceSn) {
  // Bulk template restores (DATA UPDATE FINGERTMP / BIOPHOTO) carry a full
  // base64 template per row and are the known cause of multi-minute FIFO
  // clogs (e.g. autoRestoreTemplates() after a reboot can queue 50+ of
  // these — "Get All Logs takes 25+ min" per the note above). A device only
  // pulls one command per poll cycle, so a live admin waiting on ENROLL_FP/
  // ENROLL_BIO would otherwise sit behind that whole backlog. Sink those two
  // bulky types to the back of this device's queue; everything else
  // (enroll, user upload/delete, unlock, etc.) still runs oldest-first.
  const { rows } = await pool.query(
    `SELECT id, command_payload FROM zkteco_commands
     WHERE device_sn=$1 AND status='PENDING'
     ORDER BY
       CASE WHEN command_payload LIKE 'C:%:DATA UPDATE FINGERTMP%'
              OR command_payload LIKE 'C:%:DATA UPDATE BIOPHOTO%'
            THEN 1 ELSE 0 END,
       created_at ASC
     LIMIT 1`,
    [deviceSn]
  );
  return rows[0] || null;
}

export async function markCommandSent(id) {
  await pool.query(`UPDATE zkteco_commands SET status='SENT',sent_at=NOW() WHERE id=$1`, [id]);
}

export async function markCommandDone(id) {
  await pool.query(`UPDATE zkteco_commands SET status='DONE',done_at=NOW() WHERE id=$1`, [id]);
}

export async function markCommandDoneByCmdId(rawCmdId) {
  const id = parseInt(rawCmdId, 10);
  if (!id) return;
  const r = await pool.query(
    `UPDATE zkteco_commands SET status='DONE',done_at=NOW() WHERE id=$1 AND status!='DONE' RETURNING id`,
    [id]
  );
  if (r.rowCount) return;
  await pool.query(
    `UPDATE zkteco_commands SET status='DONE',done_at=NOW() WHERE command_payload LIKE $1 AND status!='DONE'`,
    [`C:${id}:%`]
  );
}

// ── ATTLOG parsing & storage ───────────────────────────────────────────────

/**
 * Parse ATTLOG rows from device.
 * Row format (per guide): PIN\tTimestamp\tVerifyStatus\tInOut\tDoorId
 */
export function parseAttlog(body) {
  const records = [];
  for (const raw of body.replace(/\r/g,'').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const data  = line.startsWith('ATTLOG\t') ? line.slice(7) : line;
    const parts = data.split('\t');
    if (parts.length < 4) { console.warn(`[ZK] ATTLOG line skipped (only ${parts.length} field(s)): ${line.substring(0, 120)}`); continue; }
    const [pin, dateStr, verifyStatus, inOut] = parts;
    if (!pin || !dateStr) { console.warn(`[ZK] ATTLOG line skipped (missing pin/date): ${line.substring(0, 120)}`); continue; }
    const checkTime = new Date(dateStr.replace(' ', 'T'));
    if (isNaN(checkTime.getTime())) { console.warn(`[ZK] ATTLOG line skipped (unparseable date "${dateStr}"): ${line.substring(0, 120)}`); continue; }
    records.push({
      pin       : pin.trim(),
      checkTime,
      checkType : parseInt(inOut)        || 0,
      verifyType: parseInt(verifyStatus) || 0,
      workCode  : 0,
      rawLine   : line,
    });
  }
  return records;
}

import { broadcastNotification }   from './liveNotifications.js';
import { buildPunchNotification }  from './punchNotification.js';

// ── Access-window check ──────────────────────────────────────────────────
// Shared by PostVerifyData (real-time door-relay allow/deny, in routes/zkteco.js)
// AND saveAttlogs below (the attendance-log insert path). These are separate
// protocol mechanisms on the device — PostVerifyData only gates the door relay,
// it does NOT stop the device from pushing an ATTLOG record regardless of the
// answer. So the schedule must be enforced here too, or out-of-window punches
// still land in attendance history even though the door correctly stayed locked.
const DOW_KEYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

export async function checkTimezoneAccess(employeeId, department, now) {
  // 1. Person-level rule — timezone resolved via access level (primary) or direct override
  let res = await pool.query(
    `SELECT tz.schedule
     FROM   zkteco_person_access pa
     LEFT   JOIN zkteco_access_levels al ON al.id = pa.access_level_id
     JOIN   zkteco_timezones tz
               ON tz.id = COALESCE(pa.timezone_id, al.timezone_id)
     WHERE  pa.employee_id = $1
     ORDER  BY pa.timezone_id NULLS LAST, pa.id DESC
     LIMIT  1`,
    [employeeId]
  );

  // 2. Department-level fallback — same dual lookup
  if (!res.rows[0] && department) {
    res = await pool.query(
      `SELECT tz.schedule
       FROM   zkteco_dept_access da
       LEFT   JOIN zkteco_access_levels al ON al.id = da.access_level_id
       JOIN   zkteco_timezones tz
                 ON tz.id = COALESCE(da.timezone_id, al.timezone_id)
       WHERE  LOWER(TRIM(da.department)) = LOWER(TRIM($1))
       LIMIT  1`,
      [department]
    );
  }

  if (!res.rows[0]) return true; // no rule → always allow

  const schedule = typeof res.rows[0].schedule === 'string'
    ? JSON.parse(res.rows[0].schedule)
    : res.rows[0].schedule;

  const dayKey  = DOW_KEYS[now.getDay()];
  const current = now.getHours() * 60 + now.getMinutes();
  const intervals = schedule[dayKey] || [];

  for (const iv of intervals) {
    if (!iv?.s || !iv?.e) continue;
    const [sh, sm] = iv.s.split(':').map(Number);
    const [eh, em] = iv.e.split(':').map(Number);
    const start = sh * 60 + sm;
    const end   = eh * 60 + em;
    if (start === 0 && end === 0) continue; // 00:00–00:00 means no access
    if (current >= start && current <= end) return true;
  }

  return false; // outside all allowed windows
}

// ── Validity / Expiry window (Edit Staff → Validity/Expiry panel) ──────────
// Distinct from checkTimezoneAccess above: that's a RECURRING weekly time-of-
// day schedule; this is a per-person bounded window (date range and/or a
// use-count budget) set via /devices/:id/upload-user's expires/startDatetime/
// endDatetime/validCount fields. Modes mirror the device's own Expires value:
// 0 none | 1 date range | 2 use-count | 3 date range AND use-count.
export async function checkValidityWindow(employeeId, checkTime) {
  const { rows } = await pool.query(
    `SELECT access_expires, access_expiry_mode, access_valid_from, access_valid_to, access_valid_count
     FROM users WHERE id=$1`,
    [employeeId]
  );
  const emp = rows[0];
  if (!emp) return true;
  const mode = emp.access_expiry_mode ?? (emp.access_expires ? 1 : 0);
  if (mode === 0) return true;

  let dateOk = true;
  if (mode === 1 || mode === 3) {
    // Nepal local date (UTC+5:45) — plain UTC would read as "yesterday" for
    // ~6 hours every night, rejecting/admitting people a day early/late right
    // at the edges of their validity window.
    const nepalDate = new Date(checkTime.getTime() + 345 * 60000).toISOString().slice(0, 10);
    const validFrom = emp.access_valid_from ? String(emp.access_valid_from).slice(0, 10) : null;
    const validTo   = emp.access_valid_to   ? String(emp.access_valid_to).slice(0, 10)   : null;
    dateOk = (!validFrom || nepalDate >= validFrom) && (!validTo || nepalDate <= validTo);
  }
  const countOk = (mode === 2 || mode === 3) ? (emp.access_valid_count ?? 0) > 0 : true;
  return dateOk && countOk;
}

export async function consumeValidityUse(employeeId) {
  await pool.query(
    `UPDATE users SET access_valid_count = access_valid_count - 1 WHERE id=$1 AND access_valid_count > 0`,
    [employeeId]
  );
}

export async function saveAttlogs(deviceSn, records) {
  let inserted = 0;
  for (const r of records) {
    const empRes = await pool.query('SELECT id, department FROM users WHERE device_id=$1 LIMIT 1', [r.pin]);
    const employeeId = empRes.rows[0]?.id || null;

    // Reject punches outside the person's allowed access window — mirrors the
    // device's own "Invalid Time period" rejection so it isn't recorded as
    // valid attendance just because ATTLOG arrived independently of the relay.
    if (employeeId) {
      const allowed = await checkTimezoneAccess(employeeId, empRes.rows[0].department, r.checkTime);
      if (!allowed) {
        console.warn(`[ZK] ATTLOG rejected — outside access window: PIN=${r.pin} time=${r.checkTime.toISOString()}`);
        continue;
      }
      // Validity/Expiry (Date Range / Use Count) — this is the ONLY place
      // this actually gets enforced for devices that verify locally and just
      // push ATTLOG afterward (no PostVerifyData round-trip), which is most
      // plain attendance terminals. The device's own local biometric match
      // still succeeds either way — this is what stops it from counting as
      // real attendance once forwarded to the server.
      const withinValidity = await checkValidityWindow(employeeId, r.checkTime);
      if (!withinValidity) {
        console.warn(`[ZK] ATTLOG rejected — outside validity window: PIN=${r.pin} time=${r.checkTime.toISOString()}`);
        continue;
      }
    }

    try {
      const result = await pool.query(
        `INSERT INTO zkteco_attendance_logs
           (device_sn,pin,check_time,check_type,verify_type,work_code,raw_line,employee_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (device_sn,pin,check_time) DO NOTHING`,
        [deviceSn,r.pin,r.checkTime,r.checkType,r.verifyType,r.workCode,r.rawLine,employeeId]
      );
      if (result.rowCount > 0) {
        inserted++;
        if (employeeId) {
          await consumeValidityUse(employeeId);
          // Fire-and-forget: broadcast live notification
          buildPunchNotification(employeeId, r.checkTime)
            .then(n => { if (n) broadcastNotification(n); })
            .catch(() => {});
        }
      }
    } catch (err) {
      // 23505 = unique_violation on (device_sn,pin,check_time) — a genuine
      // resend/reconnect duplicate, safe to skip. Anything else (transient
      // connection error, etc.) was previously swallowed identically, silently
      // losing a real record with no trace — now it's at least logged.
      if (err.code !== '23505') {
        console.error(`[ZK] ATTLOG insert failed PIN=${r.pin} time=${r.checkTime.toISOString()}:`, err.message);
      }
    }
  }
  return inserted;
}

// ── Key-value line parser ──────────────────────────────────────────────────

/**
 * Parse KEY=VALUE fields from tab or space-separated line.
 * Example: "USER PIN=1\tName=John\tPri=0\tCard=0"
 */
export function parseKeyValueLine(line) {
  const data = {};
  const fields = line.includes('\t') ? line.split('\t') : line.split(/\s+/);
  for (const field of fields) {
    const idx = field.indexOf('=');
    if (idx < 0) continue;
    data[field.slice(0, idx).trim()] = field.slice(idx + 1).trim();
  }
  return data;
}

// ── User data ──────────────────────────────────────────────────────────────

/**
 * Save/update an enrolled user record from device OPERLOG.
 * USER row format (guide §8):
 *   USER PIN=X\tName=Y\tPri=Z\tPasswd=ABC\tCard=12345\tGrp=1\tVerify=-1\tVein=0\tFPCount=2\tFaceCount=1
 */
export async function saveDeviceUser(deviceSn, kv) {
  const pin       = kv.PIN;
  if (!pin) return;
  const name      = kv.Name     || '';
  const privilege = parseInt(kv.Pri)       || 0;
  const card      = kv.Card               || '0';
  const fpCount   = parseInt(kv.FPCount)  || 0;
  const faceCount = parseInt(kv.FaceCount)|| 0;
  // Passwd: empty string means no password — store NULL for clarity
  const passwd    = kv.Passwd && kv.Passwd.trim() !== '' ? kv.Passwd.trim() : null;

  const empRes    = await pool.query('SELECT id FROM users WHERE device_id=$1 LIMIT 1', [pin]);
  const employeeId = empRes.rows[0]?.id || null;

  // zkteco_users.area_id was added (migration 19) purely so syncAreaToDevice
  // could look up "everyone in this Area" — but this INSERT never set it, so
  // every row's area_id stayed NULL forever and that WHERE area_id=$1 query
  // matched nothing, silently. Same-Area devices could drift indefinitely
  // (an on-device walk-up enrollment cascades to siblings once via
  // cascadeToAreaSiblings — see below — but if a device joined the Area
  // *after* another already had users, no "new row" event ever fires for
  // that pre-existing gap, and "Sync Area" was the intended manual backfill
  // for exactly that case, except it always found zero users).
  const devRes  = await pool.query('SELECT area_id FROM zkteco_devices WHERE serial_number=$1', [deviceSn]);
  const areaId  = devRes.rows[0]?.area_id || null;

  const { rows } = await pool.query(
    `INSERT INTO zkteco_users
       (device_sn, pin, name, privilege, card_no, fp_count, face_count, passwd, employee_id, area_id, last_sync)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
     ON CONFLICT (device_sn, pin) DO UPDATE SET
       name        = EXCLUDED.name,
       privilege   = EXCLUDED.privilege,
       card_no     = EXCLUDED.card_no,
       fp_count    = EXCLUDED.fp_count,
       face_count  = EXCLUDED.face_count,
       passwd      = EXCLUDED.passwd,
       employee_id = COALESCE(EXCLUDED.employee_id, zkteco_users.employee_id),
       area_id     = COALESCE(EXCLUDED.area_id, zkteco_users.area_id),
       last_sync   = NOW()
     RETURNING (xmax = 0) AS is_new_row`,
    [deviceSn, pin, name, privilege, card, fpCount, faceCount, passwd, employeeId, areaId]
  );

  // Only for a genuinely new person on this device — an enrollment done
  // directly on the device itself (walk-up, no app involved), which is the
  // one path that never went through upload-user's own area cascade. A
  // routine re-report of an already-known user (the common case on every
  // OPERLOG batch) must NOT re-trigger this, or every device in an Area
  // would get its command queue flooded on every normal sync.
  if (rows[0]?.is_new_row) {
    await cascadeToAreaSiblings(deviceSn, pin).catch(err =>
      console.error(`[ZK Area] cascadeToAreaSiblings (new user) failed for PIN=${pin}:`, err.message || err));
  }
}

/**
 * Mirrors a user (+ their fingerprint templates) into the LOCAL bookkeeping
 * for a device a push was just queued to. The physical device applies a
 * commanded DATA UPDATE USERINFO/FINGERTMP fine on its own (confirmed via
 * its own CHECK-reported user_count/fp_count going up correctly) but does
 * not reliably echo it back as an OPERLOG report the way an organic,
 * on-device enrollment does — so without this, zkteco_users/
 * zkteco_fingerprints for the TARGET device silently never catch up, and
 * the Devices grid's Users/Finger/Face/Card columns stay stuck at their old
 * counts forever even though the real biometric data landed correctly.
 * Called by every "push a user to another device" path (copy-user,
 * copy-users, area cascade — both the app-initiated one in
 * routes/zktecoApi.js and cascadeToAreaSiblings below) right after queuing
 * the commands, instead of waiting on a device echo that may never come.
 */
export async function recordPushedUserLocally(targetSn, user, fingerprints = []) {
  await pool.query(
    `INSERT INTO zkteco_users (device_sn, pin, name, privilege, card_no, employee_id, face_photo, last_sync)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
     ON CONFLICT (device_sn, pin) DO UPDATE SET
       name        = EXCLUDED.name,
       privilege   = EXCLUDED.privilege,
       card_no     = EXCLUDED.card_no,
       employee_id = COALESCE(EXCLUDED.employee_id, zkteco_users.employee_id),
       face_photo  = COALESCE(EXCLUDED.face_photo, zkteco_users.face_photo),
       last_sync   = NOW()`,
    [targetSn, user.pin, user.name || '', user.privilege || 0, user.cardNo || '0', user.employeeId || null, user.facePhoto || null]
  );
  for (const fp of fingerprints) {
    await pool.query(
      `INSERT INTO zkteco_fingerprints (device_sn,pin,finger_id,template_size,valid,template_data,enrolled_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW())
       ON CONFLICT (device_sn,pin,finger_id) DO UPDATE SET
         template_size = EXCLUDED.template_size,
         valid         = EXCLUDED.valid,
         template_data = COALESCE(EXCLUDED.template_data, zkteco_fingerprints.template_data),
         enrolled_at   = NOW()`,
      [targetSn, user.pin, fp.finger_id, fp.template_size, fp.valid || 1, fp.template_data]
    );
  }
}

/**
 * A person enrolled directly on one device (walk-up, no app involved) only
 * ever lands in THIS device's zkteco_users/zkteco_fingerprints — nothing
 * pushes them onward to other devices sharing the same Area, so devices in
 * one Area silently drift apart over time (confirmed on a live tenant: two
 * devices in the same Area, 7 people apart, neither side ever informed the
 * other). Enrolling *through the app* already cascades itself (see
 * pushUserToAreaDevices in routes/zktecoApi.js, called from the
 * upload-user route) — this covers the other path, called from
 * saveDeviceUser/saveFingerprintRecord below whenever either lands a
 * genuinely NEW row for a device that belongs to an Area.
 *
 * Deliberately self-contained rather than importing pushUserToAreaDevices
 * from the route layer (routes depend on services here, not the reverse).
 * Pushes with the device's plain default Grp — these people were never run
 * through the app's own Access Level picker to begin with (that's an
 * app-mediated concept a keypad enrollment has no way to set), so there is
 * no "real" Access Level to preserve here, unlike the app-initiated cascade.
 */
async function cascadeToAreaSiblings(originSn, pin) {
  const { rows: devRows } = await pool.query(
    'SELECT area_id FROM zkteco_devices WHERE serial_number=$1', [originSn]
  );
  const areaId = devRows[0]?.area_id;
  if (!areaId) return;

  const { rows: siblings } = await pool.query(
    `SELECT serial_number FROM zkteco_devices
     WHERE area_id=$1 AND serial_number IS NOT NULL AND active=TRUE AND serial_number <> $2`,
    [areaId, originSn]
  );
  if (!siblings.length) return;

  const { rows: userRows } = await pool.query(
    'SELECT name, privilege, card_no, passwd, employee_id, face_photo FROM zkteco_users WHERE device_sn=$1 AND pin=$2',
    [originSn, pin]
  );
  const u = userRows[0];
  if (!u) return;

  // Validity / Expiry has run out → keep them off every device (enforceAccessValidity).
  const { rows: [exp] } = await pool.query(`SELECT 1 FROM users WHERE device_id=$1 AND access_blocked=TRUE`, [pin]);
  if (exp) return;

  const { rows: fps } = await pool.query(
    'SELECT * FROM zkteco_fingerprints WHERE pin=$1 AND template_data IS NOT NULL ORDER BY finger_id',
    [pin]
  );
  const { rows: faceTmps } = await pool.query(
    'SELECT * FROM zkteco_face_templates WHERE pin=$1 AND template_data IS NOT NULL ORDER BY face_id',
    [pin]
  );

  const uParams = `PIN=${pin}\tName=${u.name || ''}\tPri=${u.privilege || 0}\tPasswd=${u.passwd || ''}\tCard=${u.card_no || ''}\tGrp=1\tTZ=0000000000000000\tVerify=0`;
  for (const sib of siblings) {
    await queueCommand(sib.serial_number, 'DATA UPDATE USERINFO', uParams);
    for (const fp of fps) {
      const fpParams = `PIN=${fp.pin}\tFID=${fp.finger_id}\tSize=${fp.template_size}\tValid=${fp.valid || 1}\tTMP=${fp.template_data}`;
      await queueCommand(sib.serial_number, 'DATA UPDATE FINGERTMP', fpParams);
    }
    for (const face of faceTmps) {
      await pushFaceTemplateToDevice(sib.serial_number, face.pin, face.face_id, face.template_size, face.valid || 1, face.template_data);
    }
    await recordPushedUserLocally(sib.serial_number,
      { pin, name: u.name, privilege: u.privilege, cardNo: u.card_no, employeeId: u.employee_id, facePhoto: u.face_photo },
      fps);
  }
  console.log(`[ZK Area] cascadeToAreaSiblings: PIN=${pin} from ${originSn} pushed to ${siblings.length} area sibling(s)`);
}

// ── Fingerprint storage (with full template data) ─────────────────────────

/**
 * Save fingerprint record from device OPERLOG.
 * Stores the actual base64 template for later device restore.
 * FP row: "FP PIN=X\tFID=Y\tSize=Z\tValid=1\tTMP=<base64>"
 */
export async function saveFingerprintRecord(deviceSn, kv) {
  const pin      = kv['PIN'] ?? kv['FP PIN'];
  const fingerId = parseInt(kv.FID)  || 0;
  const size     = parseInt(kv.Size) || 0;
  const valid    = parseInt(kv.Valid) ?? 1;
  const tmpData  = kv.TMP || null;

  if (!pin) return;

  // Calculate real binary size if template data available
  let realSize = size;
  if (tmpData) {
    try { realSize = Buffer.byteLength(tmpData, 'base64'); } catch { realSize = size; }
  }

  // Checked before the upsert (not RETURNING (xmax=0), which only tells us
  // the ROW was new — a routine full resync re-reports an already-known
  // template on every RELOAD OPTIONS, which would re-cascade it every time
  // otherwise). Only a template going from absent to present is new.
  const existing = await pool.query(
    'SELECT template_data FROM zkteco_fingerprints WHERE device_sn=$1 AND pin=$2 AND finger_id=$3',
    [deviceSn, pin, fingerId]
  );
  const hadTemplate = !!existing.rows[0]?.template_data;

  await pool.query(
    `INSERT INTO zkteco_fingerprints (device_sn,pin,finger_id,template_size,valid,template_data,enrolled_at)
     VALUES ($1,$2,$3,$4,$5,$6,NOW())
     ON CONFLICT (device_sn,pin,finger_id) DO UPDATE SET
       template_size = EXCLUDED.template_size,
       valid         = EXCLUDED.valid,
       template_data = COALESCE(EXCLUDED.template_data, zkteco_fingerprints.template_data),
       enrolled_at   = NOW()`,
    [deviceSn, pin, fingerId, realSize, valid, tmpData]
  );

  // Same walk-up-enrollment gap as saveDeviceUser above — a template that
  // just became available for the first time on this device should reach
  // any sibling devices in the same Area too.
  if (tmpData && !hadTemplate) {
    await cascadeToAreaSiblings(deviceSn, pin).catch(err =>
      console.error(`[ZK Area] cascadeToAreaSiblings (new fingerprint) failed for PIN=${pin}:`, err.message || err));
  }
}

/**
 * Mirrors saveFingerprintRecord above, for face templates. Per the official
 * Attendance PUSH Communication Protocol (2025-04-29) §11.10, a device
 * reports an enrolled/updated face template back as an OPERLOG line
 * "FACE PIN=X FID=Y SIZE=Z VALID=W TMP=<base64>" — previously unhandled by
 * classifyLines() in routes/zkteco.js, so every such line fell into the
 * plain-attendance catch-all (parseAttlog misread it as a punch-in record,
 * corrupting attendance_logs) and the template itself was just discarded.
 */
export async function saveFaceTemplateRecord(deviceSn, kv) {
  const pin     = kv.PIN;
  const faceId  = parseInt(kv.FID)  || 0;
  const size    = parseInt(kv.Size) || 0;
  const valid   = parseInt(kv.Valid) ?? 1;
  const tmpData = kv.TMP || null;

  if (!pin) return;

  let realSize = size;
  if (tmpData) {
    try { realSize = Buffer.byteLength(tmpData, 'base64'); } catch { realSize = size; }
  }

  const existing = await pool.query(
    'SELECT template_data FROM zkteco_face_templates WHERE device_sn=$1 AND pin=$2 AND face_id=$3',
    [deviceSn, pin, faceId]
  );
  const hadTemplate = !!existing.rows[0]?.template_data;

  await pool.query(
    `INSERT INTO zkteco_face_templates (device_sn,pin,face_id,template_size,valid,template_data,enrolled_at)
     VALUES ($1,$2,$3,$4,$5,$6,NOW())
     ON CONFLICT (device_sn,pin,face_id) DO UPDATE SET
       template_size = EXCLUDED.template_size,
       valid         = EXCLUDED.valid,
       template_data = COALESCE(EXCLUDED.template_data, zkteco_face_templates.template_data),
       enrolled_at   = NOW()`,
    [deviceSn, pin, faceId, realSize, valid, tmpData]
  );

  if (tmpData && !hadTemplate) {
    await cascadeToAreaSiblings(deviceSn, pin).catch(err =>
      console.error(`[ZK Area] cascadeToAreaSiblings (new face template) failed for PIN=${pin}:`, err.message || err));
  }
}

/**
 * Push a face template to a device — Guide §12.1.1.4 DATA UPDATE FACE.
 * NOTE the field order differs from FINGERTMP: Valid comes before Size here.
 */
export async function pushFaceTemplateToDevice(deviceSn, pin, faceId, templateSize, valid, templateData) {
  return queueCommand(deviceSn, 'DATA UPDATE FACE',
    `PIN=${pin}\tFID=${faceId}\tValid=${valid ?? 1}\tSize=${templateSize}\tTMP=${templateData}`
  );
}

// ── Device info ────────────────────────────────────────────────────────────

export function parseDeviceInfo(rawBody) {
  const info = {};
  // Real device payloads vary in shape: some send one `~Key=Value` per line,
  // but others (e.g. SpeedFace-V4L Pro's CHECK response) pack the whole thing
  // into a single comma-separated line mixing tilde-prefixed and bare keys —
  // splitting on newlines alone collapsed everything after the first `=` into
  // one bogus field, leaving UserCount/FPCount/etc. permanently unparsed.
  // Split on both so either shape parses correctly.
  for (const raw of rawBody.replace(/\r/g,'').split(/[\n,]/)) {
    const t = raw.trim().replace(/^~/, '');
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    if (!key) continue;
    info[key] = t.slice(eq + 1).trim();
  }
  return info;
}

/**
 * Parse the INFO CSV string from getrequest query param.
 * Format: "Ver 8.0.4.3, ..., <FPCount>, <FaceCount>, ..."
 * Index 10 = FPCount
 */
export function parseInfoString(infoStr) {
  if (!infoStr) return {};
  const parts = infoStr.split(',').map(s => s.trim());
  return {
    firmware  : parts[0] || null,
    fpCount   : parseInt(parts[10]) ?? null,
    faceCount : parseInt(parts[11]) ?? null,
  };
}

export async function saveDeviceInfo(deviceSn, info) {
  await pool.query(
    `INSERT INTO zkteco_device_info
       (device_sn,user_count,fp_count,max_user,max_fp,device_name,firmware_ver,platform,raw_info,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
     ON CONFLICT (device_sn) DO UPDATE SET
       user_count   = EXCLUDED.user_count,
       fp_count     = EXCLUDED.fp_count,
       max_user     = EXCLUDED.max_user,
       max_fp       = EXCLUDED.max_fp,
       device_name  = COALESCE(EXCLUDED.device_name,  zkteco_device_info.device_name),
       firmware_ver = COALESCE(EXCLUDED.firmware_ver, zkteco_device_info.firmware_ver),
       platform     = COALESCE(EXCLUDED.platform,     zkteco_device_info.platform),
       raw_info     = EXCLUDED.raw_info,
       updated_at   = NOW()`,
    [
      deviceSn,
      parseInt(info.UserCount) || 0,
      parseInt(info.FPCount)   || 0,
      // Real field names are MaxUserCount/MaxFingerCount (confirmed from a
      // live SpeedFace-V4L Pro payload) — MaxUser/MaxFP never matched
      // anything, so these always stored as 0 regardless of actual capacity.
      parseInt(info.MaxUserCount) || 0,
      parseInt(info.MaxFingerCount) || 0,
      info.DeviceName          || null,
      info['Firmware Version'] || info.FirmwareVersion || null,
      info.Platform            || null,
      JSON.stringify(info),
    ]
  );
}

// ── ADMS response builder ──────────────────────────────────────────────────

/**
 * Build the ADMS registration response.
 *
 * CRITICAL (from guide):
 *   - transTimes = LOWERCASE 't' (TransTimes is silently ignored by firmware)
 *   - TransFlag  = numeric bitmask '1111000000'
 *     Bit 1=AttLog, 2=OpLog, 3=AttPhoto, 4=EnrollFP (MUST be 1 for template capture)
 *   - OPERLOGStamp MUST always be 0
 *     (echoing the stamp causes device to stop pushing OPERLOG = no FP templates)
 */
// ── Java ZktecoService methods (all map to queueCommand) ──────────────────

/**
 * Java: addUserToDevice(deviceSN, fullName, userIdOnDevice, cardNumber, delays)
 * Java: updateUserOnDevice(..., fingerprintTemplate, templateSize, appUserId, branchId)
 * Guide §3: DATA UPDATE USERINFO
 */
export async function addOrUpdateUserOnDevice(deviceSn, fullName, pin, cardNumber = '', privilege = 0, expires = 0, endDatetime = '2099-12-31 23:59:00') {
  const ed = endDatetime.replace('T', ' ').slice(0, 19);
  return queueCommand(deviceSn, 'DATA UPDATE USERINFO',
    `PIN=${pin}\tName=${fullName}\tPri=${privilege}\tPasswd=\tCard=${cardNumber||''}\tGrp=1\tTZ=0000000000000000\tVerify=0\tExpires=${expires}\tStartDatetime=2000-01-01 00:00:00\tEndDatetime=${ed}`
  );
}

/**
 * Java: grantAccessWithFinger(deviceSN, fullName, cardNumber, userIdOnDevice, delays, ...)
 * Combines upload user + restore fingerprint template in one call.
 */
export async function grantAccessWithFinger(deviceSn, fullName, pin, cardNumber, fingerprintTemplate, fingerPrintId, templateSize) {
  // Step 1: Push user record
  await addOrUpdateUserOnDevice(deviceSn, fullName, pin, cardNumber);
  // Step 2: Restore fingerprint template (if available)
  if (fingerprintTemplate && fingerPrintId != null) {
    const size = templateSize ?? (Buffer.byteLength(fingerprintTemplate, 'base64'));
    await queueCommand(deviceSn, 'DATA UPDATE FINGERTMP',
      `PIN=${pin}\tFID=${fingerPrintId}\tSize=${size}\tValid=1\tTMP=${fingerprintTemplate}`
    );
  }
}

/**
 * Push a JPEG face photo to a ZKTeco facial-recognition device.
 * dataUrl: full data-URL  "data:image/jpeg;base64,/9j/..."  OR raw base64 string.
 * Guide: DATA UPDATE BIOPHOTO  PIN=X\tFileName=face.jpg\tType=9\tSize=N\tContent=<base64>
 */
export async function pushBioPhotoToDevice(deviceSn, pin, dataUrl) {
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  const size   = Buffer.byteLength(base64, 'base64');
  return queueCommand(deviceSn, 'DATA UPDATE BIOPHOTO',
    `PIN=${pin}\tFileName=face.jpg\tType=9\tSize=${size}\tContent=${base64}`
  );
}

/**
 * Java: deleteUserFromDevice(deviceSN, userIdOnDevice, delays)
 * Guide §4: DATA DELETE USERINFO
 */
export async function deleteUserFromDevice(deviceSn, pin) {
  return queueCommand(deviceSn, 'DATA DELETE USERINFO', `PIN=${pin}`);
}

/**
 * Java: unlockDoor(deviceSN) + unlockDoorFromMobileApp(deviceSN)
 * Guide §12: AC_UNLOCK
 */
export async function unlockDoor(deviceSn) {
  return queueCommand(deviceSn, 'AC_UNLOCK');
}

/**
 * Java: rebootDevice(deviceSN)
 * Guide §17 WARNING: wipes all FP templates from RAM
 */
export async function rebootDevice(deviceSn) {
  return queueCommand(deviceSn, 'RESTART');
}

/**
 * Java: cancelAlarm(deviceSN)
 * ZKTeco alarm cancel command (device-specific, may return -3 on some firmware)
 */
export async function cancelAlarm(deviceSn) {
  return queueCommand(deviceSn, 'AC_ALARM_CANCEL');
}

/**
 * Java: enrollCard(deviceSN, userPin, retry)
 * Card enrollment command (some firmware supports ENROLL_ID)
 */
export async function enrollCard(deviceSn, pin, retry = 3) {
  // ENROLL_ID is the standard card enrollment command on ZKTeco devices
  return queueCommand(deviceSn, 'ENROLL_ID', `PIN=${pin}\tRETRY=${retry}`);
}

/**
 * Java: checkDevice(deviceSN) — CHECK command (may return -3 on GED firmware)
 */
export async function checkDevice(deviceSn) {
  return queueCommand(deviceSn, 'CHECK');
}

/**
 * Java: logDevice(deviceSN) — just returns current queue for the device
 */
export async function getDeviceLog(deviceSn) {
  const { rows } = await pool.query(
    `SELECT * FROM zkteco_commands WHERE device_sn=$1 ORDER BY created_at DESC LIMIT 50`,
    [deviceSn]
  );
  return rows;
}

export function buildInitResponse(sn, stamp = null, tzOffset = 345) {
  // Guide §11: use stored stamp so device sends only NEW records.
  // When stamp=NULL (after reset): send 0 → device re-sends ALL records from epoch.
  // Both 0 and "None" trigger full re-push; 0 is more universally supported by firmware.
  // ZKTeco ADMS: 'None' = send all records from beginning (guide §11)
  // '0' is ambiguous on some firmware; 'None' is the official "no stamp" value
  const attlogStamp = stamp != null ? stamp : 'None';
  const gmtDate     = new Date().toUTCString();
  return [
    `GET OPTION FROM: ${sn}`,
    `ATTLOGStamp=${attlogStamp}`,
    `OPERLOGStamp=0`,         // ALWAYS 0 per guide — echoing stops OPERLOG push
    `BIODATAStamp=0`,
    `ATTPHOTOStamp=0`,
    `IDCARDStamp=0`,
    `ERRORLOGStamp=0`,
    // ErrorDelay: seconds before the device retries after a network
    // disconnect/error. Was 60 — the "Brief Analysis of TA Push Protocol"
    // reference doc's own example uses 10; any transient network blip was
    // costing a full extra minute of the device looking "stuck" before it
    // even retried, on top of normal poll latency.
    `ErrorDelay=10`,
    `Delay=5`, // heartbeat interval — doc recommends 1-5s; already at that range's ceiling
    `TimeZone=${tzOffset}`,
    `transTimes=00:00;14:05`, // lowercase 't' — CRITICAL per guide
    `TransInterval=1`,
    // TransFlag is a 12-position bitmask (doc: 1=attlog 2=oplog 3=attphoto
    // 4=new-fingerprint 5=new-user 6=fingerprint-picture 7=modify-user
    // 8=modify-fingerprint 9=new-face 10=user-photo 11=workcode 12=biophoto).
    // Was "1111000000" — only 10 digits, with positions 8 and 9 (modify
    // fingerprint / newly registered FACE) both off. That means a face or a
    // re-enrolled/overwritten fingerprint captured on the device — including
    // via this app's own Enroll Face / Enroll FP (OVERWRITE=1) commands —
    // was never proactively reported back via OPERLOG; only a manual
    // "Get All Users" pull would ever pick it up. All 12 on, matching the
    // doc's own reference value, so every enrollment/modification type
    // reaches the server on its own.
    `TransFlag=111111111111`,
    `Realtime=1`,
    `Encrypt=None`,  // guide §1 specifies Encrypt=None
    `ServerVer=2.4.1`,
    `PushProtVer=2.4.1`,
    `SupportPing=1`,
    `PostSelfDefineDataType=PostVerifyData`,
    `Date=${gmtDate}`,
    '',
  ].join('\r\n');
}
