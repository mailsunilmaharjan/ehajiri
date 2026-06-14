/**
 * ZKTeco ADMS Push Protocol Routes
 * Converted from Java ZktecoController (Niroj Tamang / Udaan Tech Solutions)
 * and cross-checked against ZKTeco ADMS Developer Guide (ZLM60 firmware 8.0.4.3)
 *
 * Supports:  M2F, SenseFace, K40 Pro, MB2000, SenseFace 4A/7A
 * Paths:     /iclock/*  AND  /iclock/*.aspx  (Java controller handles both)
 *
 * Device config:  Server Address = <your IP>  |  Port = 5000  |  HTTP
 */

import express from 'express';
import pool   from '../db.js';
import { logError } from '../utils/logError.js';
import {
  upsertDevice,
  getDeviceStamp,
  updateDeviceStamp,
  incrementLogCount,
  parseAttlog,
  saveAttlogs,
  parseKeyValueLine,
  saveDeviceUser,
  saveFingerprintRecord,
  parseDeviceInfo,
  parseInfoString,
  saveDeviceInfo,
  getNextCommand,
  markCommandSent,
  markCommandDoneByCmdId,
  buildInitResponse,
  queueCommand,
} from '../services/zktecoService.js';

const router = express.Router();

// Raw text body — ADMS bodies are plain text
router.use(express.text({ type: '*/*', limit: '10mb' }));

// ── Helpers ────────────────────────────────────────────────────────────────
const getSN    = (req) => (req.query.SN || '').trim();
const clientIp = (req) => (
  req.headers['x-forwarded-for']?.split(',')[0].trim() ||
  req.socket?.remoteAddress || ''
).replace(/^::ffff:/i, '');

/** Classify every line in a POST body by type (Java: parseDeviceData) */
function classifyLines(body) {
  const att = [], users = [], fps = [], info = [], cards = [], oplogs = [], biophotos = [];
  for (const raw of body.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const upper = line.toUpperCase();
    if      (line.startsWith('~'))           info.push(line);
    else if (upper.startsWith('USER'))       users.push(line);
    else if (upper.startsWith('FP'))         fps.push(line);
    else if (upper.startsWith('CARD'))       cards.push(line);
    else if (upper.startsWith('OPLOG'))      oplogs.push(line);
    else if (upper.startsWith('BIOPHOTO'))   biophotos.push(line);
    else                                     att.push(line);
  }
  return { att, users, fps, cards, info, oplogs, biophotos };
}

/** Deduplicate PENDING queue on reconnect (prevents flooding) */
async function deduplicatePending(sn) {
  await pool.query(`
    DELETE FROM zkteco_commands
    WHERE device_sn=$1 AND status='PENDING'
      AND id NOT IN (
        SELECT MIN(id) FROM zkteco_commands
        WHERE device_sn=$1 AND status='PENDING'
        GROUP BY command_payload
      )
  `, [sn, sn]);
}

/** Queue UserValidTimeFun=1 once per device (guide §16 checklist) */
async function queueUserValidTimeFun(sn) {
  const { rows } = await pool.query(
    `SELECT id FROM zkteco_commands
     WHERE device_sn=$1 AND status IN ('PENDING','SENT')
       AND command_payload LIKE '%UserValidTimeFun%'
     LIMIT 1`,
    [sn]
  );
  if (!rows[0]) await queueCommand(sn, 'SET OPTION', 'UserValidTimeFun=1');
}

/**
 * Auto-restore stored FP templates — guide §16 checklist item.
 *
 * IMPORTANT: Only restores if a RESTART command was recently DONE (device just rebooted,
 * wiping templates from RAM). Running on every handshake floods the queue and blocks all
 * user commands (e.g. Get All Logs takes 25+ min when 50 FINGERTMP clog the FIFO queue).
 */
async function autoRestoreTemplates(sn) {
  // Check if a RESTART was completed in the last 5 minutes (device just rebooted)
  const { rows: restarted } = await pool.query(
    `SELECT id FROM zkteco_commands
     WHERE device_sn=$1 AND status='DONE'
       AND command_payload LIKE 'C:%:RESTART'
       AND done_at > NOW() - INTERVAL '5 minutes'
     LIMIT 1`,
    [sn]
  );
  if (!restarted[0]) return;   // no recent restart — don't auto-restore

  // Also skip if FINGERTMP commands are already queued
  const { rows: pending } = await pool.query(
    `SELECT id FROM zkteco_commands
     WHERE device_sn=$1 AND status IN ('PENDING','SENT')
       AND command_payload LIKE 'C:%:DATA UPDATE FINGERTMP%'
     LIMIT 1`,
    [sn]
  );
  if (pending[0]) return;

  const { rows: templates } = await pool.query(
    `SELECT pin, finger_id, template_size, valid, template_data
     FROM   zkteco_fingerprints
     WHERE  device_sn=$1 AND template_data IS NOT NULL
     ORDER  BY pin::int, finger_id`,
    [sn]
  );
  if (!templates.length) return;

  for (const fp of templates) {
    // Guide §6: Size must be binary byte count, not base64 length
    const binarySize = fp.template_data
      ? Buffer.byteLength(fp.template_data, 'base64')
      : fp.template_size;
    await queueCommand(sn, 'DATA UPDATE FINGERTMP',
      `PIN=${fp.pin}\tFID=${fp.finger_id}\tSize=${binarySize}\tValid=${fp.valid||1}\tTMP=${fp.template_data}`
    );
  }
  console.log(`[ZK] Post-restart: queued ${templates.length} FINGERTMP restore for ${sn} (guide §6)`);
}

// ── Timezone access check ─────────────────────────────────────────────────
// Returns true if the employee is allowed at the given time per access rules.
// Checks person-level first, then department-level. If no rule exists → allow.
const DOW_KEYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

async function checkTimezoneAccess(employeeId, department, now) {
  // 1. Person-level rule — timezone resolved via access level (primary) or direct override
  let res = await pool.query(
    `SELECT tz.schedule
     FROM   zkteco_person_access pa
     LEFT   JOIN zkteco_access_levels al ON al.id = pa.access_level_id
     JOIN   zkteco_timezones tz
               ON tz.id = COALESCE(pa.timezone_id, al.timezone_id)
     WHERE  pa.employee_id = $1
     ORDER  BY pa.timezone_id NULLS LAST
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

// ══════════════════════════════════════════════════════════════════════════
// COMBINED HANDLER — matches Java @RequestMapping for all /iclock/* paths
// Supports both GET and POST on:
//   /iclock/getrequest   /iclock/getrequest.aspx
//   /iclock/cdata        /iclock/cdata.aspx
//   /iclock/devicecmd    /iclock/devicecmd.aspx
// ══════════════════════════════════════════════════════════════════════════

async function handleZkteco(req, res) {
  const sn     = getSN(req);
  const path   = req.path.toLowerCase();
  const method = req.method.toUpperCase();
  const ip     = clientIp(req);
  const body   = typeof req.body === 'string' ? req.body : '';

  res.set('Content-Type', 'text/plain;charset=UTF-8');
  res.set('Date', new Date().toUTCString());   // Java sets Date header

  if (!sn) return res.status(400).send('ERROR: Missing SN\n');

  try {
    // ────────────────────────────────────────────────────────────────────
    // GET REQUESTS
    // ────────────────────────────────────────────────────────────────────
    if (method === 'GET') {

      // ── Initialization handshake — ONLY when options=all ────────────────
      // Java: if ("all".equals(options)) → buildInitializationResponse
      // IMPORTANT: only options=all triggers full handshake.
      //   GET /cdata WITHOUT options=all → return commands (guide checklist item 3)
      if (req.query.options === 'all') {
        const firmware = req.query.pushver    || req.headers['x-device-firmver']  || null;
        const platform = req.query.DeviceName || req.headers['x-device-platform'] || null;

        await upsertDevice(sn, ip, { firmware, platform });
        await deduplicatePending(sn);
        await queueUserValidTimeFun(sn);
        await autoRestoreTemplates(sn);  // guide §16

        const stamp    = await getDeviceStamp(sn);
        const devRow   = await pool.query('SELECT timezone_offset FROM zkteco_devices WHERE serial_number=$1', [sn]);
        const tzOffset = devRow.rows[0]?.timezone_offset ?? 345;

        console.log(`[ZK] Handshake SN=${sn} IP=${ip} stamp=${stamp??'None'} TZ=${tzOffset}`);
        return res.send(buildInitResponse(sn, stamp, tzOffset));
      }

      // ── Command poll (getrequest OR cdata without options=all) ───────
      // Guide checklist: GET /cdata without options=all → return next command or OK
      // Java: zktecoService.getCommandsForDevice(deviceSN, deviceIpAddress)
      // Parse INFO CSV from query param (device sends firmware/FPCount here)
      if (req.query.INFO) {
        try {
          const parsed = parseInfoString(req.query.INFO);
          if (parsed.firmware) {
            await pool.query(
              `UPDATE zkteco_devices SET firmware_ver=COALESCE($1,firmware_ver), last_seen=NOW() WHERE serial_number=$2`,
              [parsed.firmware, sn]
            );
          }
          if (parsed.fpCount === -1) {
            console.warn(`[ZK] WARNING: SN=${sn} FPCount=-1 — hardware does not support FP export`);
          }
        } catch { /* ignore parse errors */ }
      }

      // Update last_seen
      await pool.query(`UPDATE zkteco_devices SET last_seen=NOW(), last_ip=$1 WHERE serial_number=$2`, [ip, sn]);

      const cmd = await getNextCommand(sn);
      if (cmd) {
        await markCommandSent(cmd.id);
        const payload = cmd.command_payload.endsWith('\r\n')
          ? cmd.command_payload : cmd.command_payload + '\r\n';
        console.log(`[ZK] CMD → ${sn}: ${payload.trim()}`);
        return res.send(payload);
      }
      return res.send('OK\n');
    }

    // ────────────────────────────────────────────────────────────────────
    // POST REQUESTS
    // ────────────────────────────────────────────────────────────────────
    if (method === 'POST') {

      // ── DeviceCmd — command result acknowledgement ────────────────────
      // Java: zktecoService.processCommandReturn(deviceSN, rawBody, deviceIpAddress)
      if (path.includes('/devicecmd')) {
        try {
          const match   = body && body.match(/CmdID=(\d+)|ID=(\d+)/i);
          const retMatch = body && body.match(/Return=(-?\d+)/i);
          const retCode  = retMatch ? parseInt(retMatch[1]) : null;

          if (match) {
            const cmdId = match[1] ?? match[2];
            await markCommandDoneByCmdId(cmdId);
            if (retCode === -3) {
              console.warn(`[ZK] CMD NOT SUPPORTED on ${sn} (Return=-3) CmdID=${cmdId}`);
              await pool.query(
                `UPDATE zkteco_commands SET status='ERROR' WHERE id=$1`,
                [parseInt(cmdId)]
              ).catch(()=>{});
            } else {
              console.log(`[ZK] CMD DONE ${sn} CmdID=${cmdId} Return=${retCode}`);
            }
          }

          // CHECK command may include device info in body
          if (body && (body.includes('~UserCount') || body.includes('~MaxUser'))) {
            const info = parseDeviceInfo(body);
            if (Object.keys(info).length) await saveDeviceInfo(sn, info);
          }
        } catch (err) {
          logError('[ZK] devicecmd error:', err);
        }
        return res.send('OK\n');
      }

      // ── PostVerifyData — real-time allow/deny (guide §10) ────────────
      const typeParam = (req.query.type || '').toUpperCase();
      if (typeParam === 'POSTVERIFYDATA' || (req.query.table||'').toUpperCase() === 'POSTVERIFYDATA') {
        try {
          const pin    = body.trim().split('\t')[0];
          const empRes = await pool.query(
            'SELECT id, active, department FROM users WHERE device_id=$1 LIMIT 1', [pin]
          );
          const emp = empRes.rows[0];

          // 1. Employee must exist and be active
          if (!emp?.active) {
            console.log(`[ZK] PostVerifyData PIN=${pin} → DENY (inactive/unknown)`);
            res.set('Content-Type', 'application/json');
            return res.json({ result: 0 });
          }

          // 2. Check timezone access rule (person-level first, then department)
          const tzAllowed = await checkTimezoneAccess(emp.id, emp.department, new Date());
          const allow = tzAllowed ? 1 : 0;
          console.log(`[ZK] PostVerifyData PIN=${pin} → ${allow ? 'ALLOW' : 'DENY (timezone rule)'}`);
          res.set('Content-Type', 'application/json');
          return res.json({ result: allow });
        } catch (err) {
          logError('[ZK] PostVerifyData error:', err);
          res.set('Content-Type', 'application/json');
          return res.json({ result: 0 });
        }
      }

      // ── cdata POST — device pushes data ──────────────────────────────
      // Java: zktecoService.processDeviceData(deviceSN, tableType, rawBody, deviceIpAddress)
      const table = (req.query.table || '').toUpperCase();

      if (!body.trim()) {
        await upsertDevice(sn, ip).catch(()=>{});
        return res.send('OK\n');
      }

      try {
        await upsertDevice(sn, ip);

        // Classify all body lines regardless of ?table= param
        // (Java does the same: loops all lines checking line prefix)
        const { att, users, fps, cards, info, biophotos } = classifyLines(body);

        // ── Attendance logs (ATTLOG) ────────────────────────────────────
        let attInserted = 0;
        if (att.length > 0 || table === 'ATTLOG') {
          const records = parseAttlog(att.join('\n'));
          if (records.length) {
            attInserted = await saveAttlogs(sn, records);
            // Guide §11: echo the device's own Stamp value back in the next handshake.
            // Using the DEVICE's ?Stamp= ensures the device continues from the right point.
            // Using server time (wrong) can cause device to think it's already up-to-date.
            const deviceStamp = req.query.Stamp || req.query.stamp;
            if (deviceStamp && deviceStamp !== '9999') {
              await pool.query(
                'UPDATE zkteco_devices SET attlog_stamp=$1 WHERE serial_number=$2',
                [deviceStamp, sn]
              );
            } else {
              await updateDeviceStamp(sn);
            }
            await incrementLogCount(sn, attInserted);
            console.log(`[ZK] ATTLOG ${sn}: ${records.length} parsed, ${attInserted} new, deviceStamp=${deviceStamp||'n/a'}`);
          }
        }

        // ── USER rows (from OPERLOG — DATA QUERY USERINFO response) ─────
        // Java: parseUserData + parseCardData (combined in USER line)
        let autoCleared = 0;
        for (const line of users) {
          const stripped = line.replace(/^USER[\s\t]+/i, '');
          const kv = parseKeyValueLine(stripped);
          if (kv.PIN) {
            await saveDeviceUser(sn, kv);
            // If clear_admin_pending flag is set, auto-downgrade any admin user that arrives
            const privilege = parseInt(kv.Pri) || 0;
            if (privilege >= 6) {
              const { rows: devRows } = await pool.query(
                'SELECT clear_admin_pending FROM zkteco_devices WHERE serial_number=$1', [sn]
              );
              if (devRows[0]?.clear_admin_pending) {
                const cmdP = `PIN=${kv.PIN}\tName=${kv.Name||''}\tPri=0\tPasswd=\tCard=${kv.Card||''}\tGrp=1\tTZ=1\tVerify=0\tExpires=0\tStartDatetime=2000-01-01 00:00:00\tEndDatetime=2099-12-31 23:59:00`;
                await queueCommand(sn, 'DATA UPDATE USERINFO', cmdP);
                await pool.query('UPDATE zkteco_users SET privilege=0 WHERE device_sn=$1 AND pin=$2', [sn, kv.PIN]);
                autoCleared++;
                console.log(`[ZK] Auto-cleared admin PIN=${kv.PIN} on ${sn}`);
              }
            }
          }
        }
        // Clear the pending flag once we've processed the user list
        if (users.length) {
          await pool.query(
            'UPDATE zkteco_devices SET clear_admin_pending=false WHERE serial_number=$1 AND clear_admin_pending=true',
            [sn]
          );
          console.log(`[ZK] USER rows ${sn}: ${users.length}${autoCleared ? ` (${autoCleared} admins auto-cleared)` : ''}`);
        }

        // ── FP rows (fingerprint templates from OPERLOG) ─────────────────
        // Java: parseFingerprintData → saveFingerPrintOfMember
        for (const line of fps) {
          const kv = parseKeyValueLine(line);
          const pin = kv['PIN'] ?? kv['FP PIN'];
          if (pin) {
            await saveFingerprintRecord(sn, kv);
            console.log(`[ZK] FP enrolled SN=${sn} PIN=${pin} FID=${kv.FID} Size=${kv.Size}`);
          } else {
            console.warn(`[ZK] FP row missing PIN: ${line.substring(0, 80)}`);
          }
        }

        // ── CARD rows ───────────────────────────────────────────────────
        // Java: parseCardData → saveCardOfMember
        for (const line of cards) {
          const kv = parseKeyValueLine(line);
          const pin = kv['PIN'];
          const cardNo = kv['Card'] ?? kv['CardNo'];
          if (pin && cardNo && cardNo.trim() !== '') {
            await pool.query(
              `UPDATE zkteco_users SET card_no=$1 WHERE device_sn=$2 AND pin=$3`,
              [cardNo, sn, pin]
            );
            console.log(`[ZK] Card saved SN=${sn} PIN=${pin} Card=${cardNo}`);
          }
        }

        // ── BIOPHOTO rows (face photos from enrollment) ─────────────────
        // Format: BIOPHOTO PIN=X\tFileName=face.jpg\tType=9\tSize=N\tContent=<base64>
        for (const line of biophotos) {
          const kv = parseKeyValueLine(line.replace(/^BIOPHOTO[\s\t]*/i, ''));
          const pin = kv['PIN'];
          const content = kv['Content'] || kv['TMP'];
          if (pin && content) {
            await pool.query(
              `UPDATE zkteco_users SET face_photo=$1 WHERE device_sn=$2 AND pin=$3`,
              [content, sn, pin]
            );
            console.log(`[ZK] Face photo saved SN=${sn} PIN=${pin} Size=${kv.Size||'?'}`);
          }
        }

        // ── Device info tilde lines (~UserCount etc.) ───────────────────
        if (info.length || body.includes('~UserCount') || body.includes('~MaxUser')) {
          const parsed = parseDeviceInfo(body);
          if (Object.keys(parsed).length) await saveDeviceInfo(sn, parsed);
        }

        // ATTLOG must return count (device uses it to advance stamp pointer)
        if (table === 'ATTLOG') return res.send(`OK: ${attInserted}\n`);
        return res.send('OK\n');

      } catch (err) {
        logError('[ZK] cdata POST error:', err);
        return res.send('OK\n');
      }
    }

    console.warn(`[ZK] Unsupported method: ${method} from ${sn}`);
    res.status(405).send('ERROR: Method Not Allowed\n');

  } catch (err) {
    logError(`[ZK] Unhandled error for ${sn}:`, err);
    res.status(200).send('OK\n');   // Java also returns 200 OK on error
  }
}

// ── Register all paths (with AND without .aspx — matches Java controller) ─
const PATHS = [
  '/getrequest',    '/getrequest.aspx',
  '/cdata',         '/cdata.aspx',
  '/devicecmd',     '/devicecmd.aspx',
];
PATHS.forEach(p => {
  router.get(p,  handleZkteco);
  router.post(p, handleZkteco);
});

// ── Ping — Java: @GetMapping({"/iclock/ping", "/iclock/ping.aspx"}) ────────
router.get(['/ping', '/ping.aspx'], (_req, res) => {
  res.set('Content-Type', 'text/plain;charset=UTF-8');
  res.send('OK\n');
});

export default router;
