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
  getDevice,
  getDeviceStamp,
  updateDeviceStamp,
  recoverGapIfNeeded,
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
  pushBioPhotoToDevice,
  checkTimezoneAccess,
  checkValidityWindow,
  consumeValidityUse,
} from '../services/zktecoService.js';

/** Push a freshly-captured fingerprint/face template to every other active
 * device sharing the same area, so a sample enrolled on one device doesn't
 * need a manual re-push to reach its siblings. */
async function pushTemplateToAreaSiblings(originSn, fn) {
  const { rows: [origin] } = await pool.query(
    'SELECT area_id FROM zkteco_devices WHERE serial_number=$1', [originSn]
  );
  if (!origin?.area_id) return;
  const { rows: siblings } = await pool.query(
    `SELECT serial_number FROM zkteco_devices
     WHERE area_id=$1 AND serial_number<>$2 AND active=TRUE`,
    [origin.area_id, originSn]
  );
  for (const { serial_number } of siblings) await fn(serial_number);
}

/** Rebuild the full DATA UPDATE USERINFO payload from a user's just-saved
 * record and push it to every area sibling. Always reads back the current
 * row (rather than forwarding the triggering event's raw fields) so a
 * CARD-only update doesn't blank out Name/Privilege/Passwd on the sibling,
 * and vice versa. Mirrors the FP/BIOPHOTO sibling pushes above — without
 * this, a user enrolled (or card-assigned) on one device never reaches the
 * other device sharing its area at all. */
async function pushUserToAreaSiblings(originSn, pin) {
  const { rows: [u] } = await pool.query(
    'SELECT name, privilege, card_no, passwd FROM zkteco_users WHERE device_sn=$1 AND pin=$2',
    [originSn, pin]
  );
  if (!u) return;
  const card   = (u.card_no && u.card_no !== '0') ? u.card_no : '';
  const params = `PIN=${pin}\tName=${u.name||''}\tPri=${u.privilege||0}\tPasswd=${u.passwd||''}\tCard=${card}\tGrp=1\tTZ=0000000000000000\tVerify=0\tExpires=0\tStartDatetime=2000-01-01 00:00:00\tEndDatetime=2099-12-31 23:59:00`;
  await pushTemplateToAreaSiblings(originSn, (siblingSn) => queueCommand(siblingSn, 'DATA UPDATE USERINFO', params));
}

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
    // BIODATA rows (biometric enrollment metadata, "BIODATA Pin=X\t...") don't
    // match any category above and used to fall through to the `att` catch-all
    // — parseAttlog would then treat "BIODATA Pin=X" as a literal ATTLOG PIN
    // (its first tab-separated field), inserting a garbage attendance_logs row
    // that can never match a real employee. Not currently acted on, just kept
    // out of the attendance bucket.
    else if (upper.startsWith('BIODATA'))    continue;
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
  `, [sn]);
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

        const priorDevice = await getDevice(sn);
        await upsertDevice(sn, ip, { firmware, platform });
        await recoverGapIfNeeded(sn, priorDevice?.last_seen);
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

      // Upsert (not a plain UPDATE) — a device can reach this poll endpoint
      // without ever having a row here yet. That happens whenever the
      // gateway's own "approve device for a tenant" step (LicenseAdmin's
      // Serial Numbers page) happens AFTER the device's one-time
      // options=all handshake: at handshake time the device wasn't
      // resolvable to any tenant, so the gateway answered with its own
      // fallback OK instead of ever reaching this server — no row was ever
      // created — and most devices never repeat that handshake again until
      // a reboot, so a plain UPDATE here would silently no-op forever and
      // the device would never appear in this tenant's Attendance Device
      // list despite polling successfully (confirmed: SN=GED7240401865 on
      // lmcedu, approved well after its only handshake, stuck exactly here).
      await upsertDevice(sn, ip);

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
            // Any negative Return is a failure, not just -3 ("not supported") —
            // e.g. SenseFace enrollment failures (no face presented, camera busy,
            // duplicate, timeout) come back as other negative codes and were
            // previously logged as if they'd succeeded.
            if (retCode != null && retCode < 0) {
              console.warn(`[ZK] CMD FAILED on ${sn} (Return=${retCode}) CmdID=${cmdId}`);
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
            `SELECT id, active, department FROM users WHERE device_id=$1 LIMIT 1`, [pin]
          );
          const emp = empRes.rows[0];

          // 1. Employee must exist and be active
          if (!emp?.active) {
            console.log(`[ZK] PostVerifyData PIN=${pin} → DENY (inactive/unknown)`);
            res.set('Content-Type', 'application/json');
            return res.json({ result: 0 });
          }

          // 2. Validity/expiry — re-checked here independently of the device's own
          // Expires/StartDatetime/EndDatetime/VaildCount fields (firmware-dependent, not
          // guaranteed to be enforced on-device), so this is the authoritative gate for
          // devices that actually call PostVerifyData. Shared with saveAttlogs(), which
          // is the gate that matters for devices that verify locally and just push
          // ATTLOG afterward without ever hitting this endpoint.
          const withinValidity = await checkValidityWindow(emp.id, new Date());
          if (!withinValidity) {
            console.log(`[ZK] PostVerifyData PIN=${pin} → DENY (outside validity window)`);
            res.set('Content-Type', 'application/json');
            return res.json({ result: 0 });
          }

          // 3. Check timezone access rule (person-level first, then department)
          const tzAllowed = await checkTimezoneAccess(emp.id, emp.department, new Date());
          const allow = tzAllowed ? 1 : 0;

          // Consume one use now that access is actually being granted — mirrors the
          // device's own VaildCount decrement, atomically guarded so concurrent scans
          // can't drive it negative.
          if (allow) await consumeValidityUse(emp.id);

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
        let attReceived = 0;
        if (att.length > 0 || table === 'ATTLOG') {
          const records = parseAttlog(att.join('\n'));
          attReceived = records.length;
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
                const cmdP = `PIN=${kv.PIN}\tName=${kv.Name||''}\tPri=0\tPasswd=\tCard=${kv.Card||''}\tGrp=1\tTZ=0000000000000000\tVerify=0\tExpires=0\tStartDatetime=2000-01-01 00:00:00\tEndDatetime=2099-12-31 23:59:00`;
                await queueCommand(sn, 'DATA UPDATE USERINFO', cmdP);
                await pool.query('UPDATE zkteco_users SET privilege=0 WHERE device_sn=$1 AND pin=$2', [sn, kv.PIN]);
                autoCleared++;
                console.log(`[ZK] Auto-cleared admin PIN=${kv.PIN} on ${sn}`);
              }
            }
            // Pushed after the auto-downgrade above (not right after saveDeviceUser)
            // so a privilege>=6 arrival that gets auto-cleared never propagates the
            // stale admin privilege to area siblings first.
            await pushUserToAreaSiblings(sn, kv.PIN);
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
            if (kv.TMP) {
              const fpParams = `PIN=${pin}\tFID=${kv.FID||0}\tSize=${kv.Size||0}\tValid=${kv.Valid??1}\tTMP=${kv.TMP}`;
              await pushTemplateToAreaSiblings(sn, (siblingSn) => queueCommand(siblingSn, 'DATA UPDATE FINGERTMP', fpParams));
            }
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
            await pushUserToAreaSiblings(sn, pin);
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
            await pushTemplateToAreaSiblings(sn, (siblingSn) => pushBioPhotoToDevice(siblingSn, pin, content));
          }
        }

        // ── Device info tilde lines (~UserCount etc.) ───────────────────
        if (info.length || body.includes('~UserCount') || body.includes('~MaxUser')) {
          const parsed = parseDeviceInfo(body);
          if (Object.keys(parsed).length) await saveDeviceInfo(sn, parsed);
        }

        // ATTLOG must return count (device uses it to advance stamp pointer).
        // Echo records RECEIVED/parsed, not records newly INSERTED — a resend
        // of already-stored rows (reconnect, retry) is a legitimate 0-new-rows
        // outcome from the server's dedup, but the device sent that count of
        // records successfully; echoing the smaller "inserted" count here made
        // the device think part of the batch failed, which is a very plausible
        // cause of records silently going missing across a large bulk pull.
        if (table === 'ATTLOG') return res.send(`OK: ${attReceived}\n`);
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
