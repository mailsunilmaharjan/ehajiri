/**
 * Shared connect + log-sync logic for standalone devices, used by both the
 * manual "Connect" / "Fetch Logs" REST routes (standaloneDevices.js) and the
 * background auto-connect/auto-poll scheduler (standaloneScheduler.js) —
 * kept in one place so both paths behave identically.
 */

import pool from '../db.js';
import { bridgeConnect, bridgeGetInfo, bridgeGetLogs, bridgeSetTime } from './standaloneDeviceService.js';
import { saveAttlogs } from './zktecoService.js';

export async function connectDevice(device) {
  const result = await bridgeConnect(device.id, device.ip_address, device.port, device.comm_password);
  await pool.query(
    `UPDATE standalone_devices SET connection_status='connected', last_connected_at=NOW(), last_error=NULL WHERE id=$1`,
    [device.id]
  );

  // A device whose clock was never synced stamps every punch with its own
  // (wrong) idea of "now" — pushing the PC's time on every fresh connect
  // fixes this automatically instead of relying on someone remembering to
  // click "Sync Time to Now". Best-effort: a failure here shouldn't fail
  // the connect itself.
  try { await bridgeSetTime(device.id); } catch { /* device may not support it — connect still succeeded */ }

  return result;
}

// Only reject truly impossible values now: a device that was never clock-synced
// can carry years of genuine history stamped under a wrong (but not insane)
// clock setting — that's real attendance data and must NOT be silently
// dropped just for being "old". A future-dated punch, on the other hand, is
// never legitimate (no device can log a punch that hasn't happened yet), so
// that direction stays strict. 2001 is the floor against true garbage
// (the original bug this filter was built for produced values like
// year=1 or year spanning into the 2100s from an unconnected/demo session).
// Year 2000 itself is excluded on purpose, not just as an arbitrary floor:
// it's the literal RTC factory-reset default on these ZK devices, so a punch
// landing exactly there is the device's clock having no real time at all —
// not a "wrong but stable" clock holding genuine old history.
const MIN_PLAUSIBLE_YEAR = 2001;
const isPlausibleLogYear = (year) => year >= MIN_PLAUSIBLE_YEAR && year <= new Date().getFullYear();

export async function syncDeviceLogs(device) {
  let dev = device;
  // The bridge's CZKEM session lives only as long as the bridge process —
  // it's gone after a server/bridge restart even though connection_status
  // in the DB still says "connected" from before. (Re)connect whenever
  // we're not in a known-good state so callers (manual "Fetch Logs" button,
  // scheduler) don't have to remember to connect first.
  if (dev.connection_status !== 'connected') {
    await connectDevice(dev);
    dev = { ...dev, connection_status: 'connected' };
  }
  if (!dev.serial_number) {
    const info = (await bridgeGetInfo(dev.id)).data;
    if (info?.serialNumber) {
      await pool.query('UPDATE standalone_devices SET serial_number=$1 WHERE id=$2', [info.serialNumber, dev.id]);
      dev = { ...dev, serial_number: info.serialNumber };
    }
  }
  if (!dev.serial_number) {
    return { ok: false, error: 'Device has no serial number yet — connect and "Get Info" first' };
  }

  const result = await bridgeGetLogs(dev.id);
  const logs = result.data || [];

  const records = [];
  const skippedSamples = [];
  let skippedImplausible = 0;
  for (const l of logs) {
    const checkTime = new Date(l.year, l.month - 1, l.day, l.hour, l.minute, l.second);
    if (!isPlausibleLogYear(l.year) || Number.isNaN(checkTime.getTime())) {
      skippedImplausible++;
      if (skippedSamples.length < 5) skippedSamples.push({ enrollNumber: l.enrollNumber, year: l.year, month: l.month, day: l.day });
      continue;
    }
    records.push({
      pin: String(l.enrollNumber),
      checkTime,
      checkType: l.inOutMode,
      verifyType: l.verifyMode,
      workCode: l.workCode,
      rawLine: `STANDALONE_SDK enroll=${l.enrollNumber} verify=${l.verifyMode} inout=${l.inOutMode}`,
    });
  }

  const inserted = await saveAttlogs(dev.serial_number, records);

  return {
    ok: true, fetched: logs.length, inserted, skippedImplausible,
    skippedSamples: skippedSamples.length ? skippedSamples : undefined,
    warning: skippedImplausible > 0
      ? `${skippedImplausible} record(s) had an implausible year and were skipped — see skippedSamples for examples. This usually means corrupted/stale entries in the device's old log buffer (inconsistent garbage years for the same enrollNumber), not the device's current clock — reconnecting won't change historical entries already stored on the device. If they're not real punches, clearing the device's attendance log will stop them from being re-skipped on every sync.`
      : undefined,
  };
}
