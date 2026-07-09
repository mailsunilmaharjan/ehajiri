/**
 * Background auto-connect + auto-log-sync for standalone devices. Every
 * POLL_INTERVAL_MS, for every active device: syncDeviceLogs() (re)connects
 * if not currently connected (picks it up automatically once it's reachable
 * on the network), then pulls any new attendance logs into
 * zkteco_attendance_logs. Failures are recorded on the device row and
 * retried next tick — quiet by design, no log spam for an offline device.
 */

import pool from '../db.js';
import { syncDeviceLogs } from './standaloneAttendanceSync.js';
import { isModuleEnabled, FLAG_KEYS } from '../utils/moduleFlags.js';

const POLL_INTERVAL_MS = 60_000;
let timer = null;

async function tick() {
  if (!process.env.STANDALONE_BRIDGE_PORT) return; // bridge not running this session
  if (!(await isModuleEnabled(FLAG_KEYS.standaloneDevice))) return;

  let devices;
  try {
    devices = (await pool.query('SELECT * FROM standalone_devices WHERE active=TRUE')).rows;
  } catch {
    return; // DB hiccup — try again next tick
  }

  for (const device of devices) {
    try {
      await syncDeviceLogs(device); // connects first if not already connected
    } catch (err) {
      await pool.query(
        `UPDATE standalone_devices SET connection_status='error', last_error=$2 WHERE id=$1`,
        [device.id, err.message]
      ).catch(() => {});
    }
  }
}

export function startStandaloneScheduler() {
  if (timer) return;
  timer = setInterval(tick, POLL_INTERVAL_MS);
  tick(); // don't wait a full interval before the first attempt
  console.log(`[standalone-scheduler] auto-connect + auto-log-sync started (every ${POLL_INTERVAL_MS / 1000}s)`);
}

export function stopStandaloneScheduler() {
  if (timer) { clearInterval(timer); timer = null; }
}
