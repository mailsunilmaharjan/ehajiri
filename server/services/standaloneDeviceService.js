/**
 * ⚠ StandAlone SDK code — DISABLED BY DEFAULT, see routes/standaloneDevices.js's
 * top-of-file note. This client only ever gets called from that (module-flag-
 * gated) router, so in practice it's unreachable until an admin/superAdmin
 * turns the StandAlone Device module on from Role Management.
 *
 * Thin HTTP client for the standalone-bridge process — the x86 .NET helper
 * that wraps ZKTeco's legacy Standalone SDK (zkemkeeper.dll COM control).
 * Electron starts the bridge and passes its port via STANDALONE_BRIDGE_PORT;
 * this module is the only thing in the Node server that talks to it.
 */

function bridgeBase() {
  const port = process.env.STANDALONE_BRIDGE_PORT;
  if (!port) {
    throw Object.assign(
      new Error('Standalone device bridge is not running (Windows-only feature, or not yet started)'),
      { status: 503 }
    );
  }
  return `http://127.0.0.1:${port}`;
}

async function bridgeRequest(method, path, body) {
  const res = await fetch(`${bridgeBase()}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw Object.assign(
      new Error(data.error || `Standalone bridge error (HTTP ${res.status})`),
      { status: res.status >= 400 ? res.status : 502, errorCode: data.errorCode }
    );
  }
  return data;
}

export const bridgeConnect        = (id, ip, port, password) => bridgeRequest('POST', `/devices/${id}/connect`, { ip, port, password });
export const bridgeDisconnect     = (id) => bridgeRequest('POST', `/devices/${id}/disconnect`);
export const bridgeGetInfo        = (id) => bridgeRequest('GET',  `/devices/${id}/info`);
export const bridgeGetTime        = (id) => bridgeRequest('GET',  `/devices/${id}/time`);
export const bridgeSetTime        = (id, time) => bridgeRequest('POST', `/devices/${id}/time`, { time });
export const bridgeEnable         = (id, enabled) => bridgeRequest('POST', `/devices/${id}/enable`, { enabled });
export const bridgeRestart        = (id) => bridgeRequest('POST', `/devices/${id}/restart`);
export const bridgePowerOff       = (id) => bridgeRequest('POST', `/devices/${id}/poweroff`);
export const bridgeRefresh        = (id) => bridgeRequest('POST', `/devices/${id}/refresh`);
export const bridgeGetLogs        = (id) => bridgeRequest('GET',  `/devices/${id}/logs`);
export const bridgeClearLogs      = (id) => bridgeRequest('POST', `/devices/${id}/logs/clear`);
export const bridgeGetUsers       = (id) => bridgeRequest('GET',  `/devices/${id}/users`);
export const bridgeSetUser        = (id, user) => bridgeRequest('POST', `/devices/${id}/users`, user);
export const bridgeDeleteUser     = (id, enrollNumber) => bridgeRequest('DELETE', `/devices/${id}/users/${enrollNumber}`);
export const bridgeGetFingerprint = (id, enrollNumber, fingerIndex) => bridgeRequest('GET', `/devices/${id}/users/${enrollNumber}/fingerprints/${fingerIndex}`);
export const bridgeSetFingerprint = (id, enrollNumber, fingerIndex, templateData) => bridgeRequest('POST', `/devices/${id}/users/${enrollNumber}/fingerprints/${fingerIndex}`, { templateData });
export const bridgeDeleteFingerprint = (id, enrollNumber, fingerIndex) => bridgeRequest('DELETE', `/devices/${id}/users/${enrollNumber}/fingerprints/${fingerIndex}`);
export const bridgeSendCommand    = (id, method, args) => bridgeRequest('POST', `/devices/${id}/command`, { method, args });
export const bridgeClearAdmin     = (id) => bridgeRequest('POST', `/devices/${id}/clear-admin`);
export const bridgeClearAllUsers  = (id) => bridgeRequest('POST', `/devices/${id}/users/clear-all`);
export const bridgeBackup         = (id, fileName) => bridgeRequest('POST', `/devices/${id}/backup`, { fileName });
export const bridgeGetUserBiometrics = (id, enrollNumber) => bridgeRequest('GET', `/devices/${id}/users/${enrollNumber}/biometrics`);
export const bridgeGetFace        = (id, enrollNumber, faceIndex) => bridgeRequest('GET', `/devices/${id}/users/${enrollNumber}/face/${faceIndex}`);
export const bridgeSetFace        = (id, enrollNumber, faceIndex, templateData) => bridgeRequest('POST', `/devices/${id}/users/${enrollNumber}/face/${faceIndex}`, { templateData });
export const bridgeDeleteFace     = (id, enrollNumber, faceIndex) => bridgeRequest('DELETE', `/devices/${id}/users/${enrollNumber}/face/${faceIndex}`);
export const bridgeSetTimeZone      = (id, tzIndex, tz) => bridgeRequest('POST', `/devices/${id}/timezones/${tzIndex}`, { tz });
export const bridgeGetTimeZone      = (id, tzIndex) => bridgeRequest('GET', `/devices/${id}/timezones/${tzIndex}`);
export const bridgeSetGroupTimeZone = (id, groupNo, tzIndex) => bridgeRequest('POST', `/devices/${id}/groups/${groupNo}/timezone`, { tzIndex });
export const bridgeSetUserGroup     = (id, enrollNumber, groupNo) => bridgeRequest('POST', `/devices/${id}/users/${enrollNumber}/group`, { groupNo });
