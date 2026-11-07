import api from '../api/client.js';
import { isMobileMode } from './native.js';

/**
 * Field Visit route tracker (web + mobile share this).
 *
 * Runs ONLY while a field-visit trip is open (Check Out from Office -> Check In
 * at Office) — the TripTrackerHost component starts/stops it from the server's
 * "active trip" state. Records GPS fixes as breadcrumbs and uploads them in
 * batches to POST /field-visit/sessions/:id/track-points, where the server sums
 * the real travelled distance at each Check In / Office In.
 *
 * Browser: navigator.geolocation.watchPosition — works while the page/app is
 * open. Native Android (Capacitor): if the community Background Geolocation
 * plugin is installed it is used instead, which keeps recording with the phone
 * locked / app in the background (see MOBILE_TRACKING.md).
 *
 * The buffer is in memory only (not localStorage): this app is multi-tenant on
 * one origin, so a stored buffer keyed by session id could be replayed into a
 * different tenant's trip with the same id.
 */
const MIN_INTERVAL_MS = 20 * 1000;   // at most one fix per 20s while moving slowly
const MIN_MOVE_M      = 25;          // ...or sooner if moved at least this far
const FLUSH_EVERY_MS  = 30 * 1000;
const MAX_BUFFER      = 2000;
const BATCH           = 300;

const toRad = (d) => (d * Math.PI) / 180;
const metres = (a, b) => {
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};

let sessionId = null;
let watchId = null;
let bgWatcherId = null;
let flushTimer = null;
let buffer = [];
let last = null;
let sending = null;
const listeners = new Set();
const status = { tracking: false, sent: 0, buffered: 0, lastFixAt: null, error: '' };

const emit = () => { status.buffered = buffer.length; listeners.forEach(fn => { try { fn({ ...status }); } catch { /* ignore */ } }); };

function onFix(c) {
  const lat = Number(c.latitude), lng = Number(c.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  const at = c.time ? new Date(c.time).getTime() : Date.now();
  const pt = { lat, lng, accuracy: c.accuracy ?? null, speed: c.speed != null && c.speed >= 0 ? c.speed : null, recordedAt: new Date(at).toISOString(), t: at };
  if (last && at - last.t < MIN_INTERVAL_MS && metres(last, pt) < MIN_MOVE_M) return;
  last = pt;
  buffer.push({ lat: pt.lat, lng: pt.lng, accuracy: pt.accuracy, speed: pt.speed, recordedAt: pt.recordedAt });
  if (buffer.length > MAX_BUFFER) buffer = buffer.slice(-MAX_BUFFER);
  status.lastFixAt = pt.recordedAt; status.error = '';
  emit();
}

function onGeoError(e) {
  status.error = e?.code === 1 ? 'Location permission is off — tracking paused.' : 'Waiting for a GPS signal…';
  emit();
}

async function flush() {
  if (!sessionId) return;
  if (sending) return sending;
  sending = (async () => {
    try {
      while (buffer.length && sessionId) {
        const chunk = buffer.slice(0, BATCH);
        try {
          await api.post(`/field-visit/sessions/${sessionId}/track-points`, { points: chunk });
          buffer = buffer.slice(chunk.length);
          status.sent += chunk.length; status.error = '';
        } catch (e) {
          // Trip already closed on the server -> nothing more to record.
          if (/closed|not found/i.test(e?.message || '')) { stop(); return; }
          status.error = 'Offline — will retry'; break;
        }
      }
    } finally { sending = null; emit(); }
  })();
  return sending;
}

function start(id) {
  if (!id || sessionId === id) return;
  stop();
  sessionId = id; buffer = []; last = null; status.sent = 0; status.error = ''; status.lastFixAt = null;

  const bg = typeof window !== 'undefined' ? window.Capacitor?.Plugins?.BackgroundGeolocation : null;
  if (bg?.addWatcher) {
    bg.addWatcher({
      backgroundTitle: 'eHajiri — Field Visit',
      backgroundMessage: 'Recording your route until you check in at the office.',
      requestPermissions: true, stale: false, distanceFilter: 10,
    }, (loc, err) => {
      if (err) { onGeoError({ code: err.code === 'NOT_AUTHORIZED' ? 1 : 2 }); return; }
      if (loc) onFix(loc);
    }).then(wid => { if (sessionId === id) bgWatcherId = wid; else bg.removeWatcher?.({ id: wid }); }).catch(() => onGeoError({}));
  } else if (typeof navigator !== 'undefined' && navigator.geolocation) {
    watchId = navigator.geolocation.watchPosition(
      (p) => onFix({ ...p.coords, time: p.timestamp }), onGeoError,
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 });
  } else {
    status.error = 'This device cannot record location.';
  }
  flushTimer = setInterval(flush, FLUSH_EVERY_MS);
  document.addEventListener('visibilitychange', onVisibility);
  status.tracking = true; emit();
}

function onVisibility() { if (document.visibilityState === 'hidden') flush(); }

function stop() {
  if (watchId != null) { navigator.geolocation?.clearWatch(watchId); watchId = null; }
  if (bgWatcherId != null) { window.Capacitor?.Plugins?.BackgroundGeolocation?.removeWatcher?.({ id: bgWatcherId }); bgWatcherId = null; }
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
  document.removeEventListener('visibilitychange', onVisibility);
  sessionId = null; buffer = []; last = null; sending = null;
  status.tracking = false; emit();
}

export const tripTracker = {
  start, stop, flush,
  subscribe(fn) { listeners.add(fn); fn({ ...status }); return () => listeners.delete(fn); },
  getStatus: () => ({ ...status }),
  /** Re-read the server's active trip and start/stop tracking to match. */
  async sync() {
    if (isMobileMode()) { stop(); return; }   // phone app: GPS only at the Check in / Check out taps, never a continuous route
    try {
      const s = await api.get('/field-visit/session/active');
      if (s?.id) start(s.id); else stop();
    } catch { /* offline / not logged in — leave as is */ }
  },
};

// Panels dispatch this after Check Out from Office / Office In so tracking follows immediately.
export const notifyTripChanged = () => { tripTracker.sync(); };
