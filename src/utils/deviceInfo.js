/** Best-effort "which device saved this" string for audit trails (Last Saved
 * By / PC info) — a browser never exposes a real machine name to a web page,
 * so this is navigator.userAgent + platform, the same signal
 * OnlineAttendanceApplyModal.jsx already captures for its own device info. */
export function getDeviceInfo() {
  if (typeof navigator === 'undefined') return '';
  return `${navigator.userAgent} | ${navigator.platform || ''}`.trim();
}

/** Collapses the raw getDeviceInfo() string into a short "Browser on OS" label
 * for display — the full string is kept as a tooltip by the caller. */
export function summarizeDeviceInfo(deviceInfo) {
  if (!deviceInfo) return '';
  const ua = deviceInfo.split('|')[0] || deviceInfo;
  let browser = 'Browser';
  if (/Edg\//.test(ua))          browser = 'Edge';
  else if (/OPR\//.test(ua))     browser = 'Opera';
  else if (/Chrome\//.test(ua))  browser = 'Chrome';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Safari\//.test(ua))  browser = 'Safari';
  let os = 'PC';
  if (/Windows/.test(ua))          os = 'Windows';
  else if (/Mac OS X/.test(ua))    os = 'macOS';
  else if (/Android/.test(ua))     os = 'Android';
  else if (/iPhone|iPad/.test(ua)) os = 'iOS';
  else if (/Linux/.test(ua))       os = 'Linux';
  return `${browser} on ${os}`;
}
