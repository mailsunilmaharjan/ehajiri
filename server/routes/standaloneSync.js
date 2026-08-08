/**
 * ⚠ StandAlone SDK code — DISABLED BY DEFAULT, see routes/standaloneDevices.js's
 * top-of-file note; mounted behind the same requireModuleEnabled(FLAG_KEYS
 * .standaloneDevice) gate in server/index.js.
 *
 * Ingestion endpoint for the remote sync agent — the standalone-bridge.exe
 * run in "remote sync" mode (RemoteSyncAgent.cs) at a site whose legacy
 * Standalone-SDK ZKTeco device isn't reachable from this server directly
 * (e.g. a centrally-hosted tenant with the device on the client's own LAN).
 * That agent holds the COM connection to the device itself and POSTs
 * fetched logs here instead of this server pulling them over a loopback
 * bridge (which only works when the bridge runs on the same machine — see
 * services/standaloneDeviceService.js).
 *
 * Auth is a per-device bearer token (standaloneSyncTokenGuard), not a user
 * JWT — this runs unattended with nobody logged in. Base: /api/standalone-sync
 */

import express from 'express';
import pool    from '../db.js';
import { saveAttlogs } from '../services/zktecoService.js';

const router = express.Router();

router.post('/logs', async (req, res) => {
  const device = req.standaloneDevice;
  const { serialNumber, records } = req.body;
  if (!Array.isArray(records)) return res.status(400).json({ error: 'records array is required' });

  try {
    let sn = device.serial_number;
    if (!sn && serialNumber) {
      await pool.query('UPDATE standalone_devices SET serial_number=$1 WHERE id=$2', [serialNumber, device.id]);
      sn = serialNumber;
    }
    if (!sn) {
      return res.status(400).json({ error: 'Device has no serial number yet — agent must report one on its first sync' });
    }

    const parsed = records.map(r => ({
      pin       : String(r.pin),
      checkTime : new Date(r.checkTime),
      checkType : r.checkType  || 0,
      verifyType: r.verifyType || 0,
      workCode  : r.workCode   || 0,
      rawLine   : `REMOTE_SYNC_AGENT enroll=${r.pin} verify=${r.verifyType} inout=${r.checkType}`,
    })).filter(r => !Number.isNaN(r.checkTime.getTime()));

    const inserted = await saveAttlogs(sn, parsed);

    await pool.query(
      `UPDATE standalone_devices SET
         connection_status='connected', last_connected_at=NOW(), last_sync_ping_at=NOW(), last_error=NULL
       WHERE id=$1`,
      [device.id]
    );

    res.json({ ok: true, fetched: records.length, inserted });
  } catch (err) {
    await pool.query(
      `UPDATE standalone_devices SET connection_status='error', last_error=$2 WHERE id=$1`,
      [device.id, err.message]
    ).catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

export default router;
