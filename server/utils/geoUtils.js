// Server-side mirror of src/utils/geoUtils.js — straight-line (Haversine)
// distance + a rough bike/scooter travel-time estimate, used by
// server/routes/fieldVisit.js to compute and PERSIST the actual travel leg
// into each Field Visit check-in (office -> first stop, or previous stop's
// checkout -> next stop). No maps/directions API is wired into this app, so
// this is deliberately an approximation, not a routed distance.
const EARTH_RADIUS_KM = 6371;
const DETOUR_FACTOR = 1.3;
const BIKE_KMH = 20;

export function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// { km, minutes } — km is what actually gets stored as the leg's distance
// ("Distance Map: 3 km"); minutes here is the pure speed-based ESTIMATE
// ("Estimate Time travel by Bike"), kept separate from the real elapsed
// wall-clock duration (computed directly from timestamps in fieldVisit.js)
// so both can be shown side by side — the gap between them is the whole
// point (traffic, a detour, time spent finding parking, etc).
export function estimateBikeTrip(lat1, lng1, lat2, lng2) {
  const km = haversineKm(lat1, lng1, lat2, lng2) * DETOUR_FACTOR;
  const minutes = Math.round((km / BIKE_KMH) * 60);
  return { km, minutes };
}

// Real travelled distance from recorded GPS breadcrumbs (oldest first).
// Noise handling so a phone sitting still / a bad fix doesn't inflate km:
//  - drop points with poor accuracy (> MAX_ACCURACY_M)
//  - skip steps shorter than MIN_STEP_M (stationary jitter)
//  - skip steps implying an impossible speed (> MAX_KMH) — a GPS jump
// Returns { km, points } where points = usable fixes; km is null when fewer
// than 2 usable fixes exist (caller then falls back to the straight-line
// estimate).
const MAX_ACCURACY_M = 100;
const MIN_STEP_M = 15;
const MAX_KMH = 140;
export function trackDistanceKm(points) {
  const good = (points || []).filter(p =>
    Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)) &&
    (p.accuracy == null || Number(p.accuracy) <= MAX_ACCURACY_M));
  good.sort((x, y) => new Date(x.recordedAt ?? x.recorded_at) - new Date(y.recordedAt ?? y.recorded_at));
  if (good.length < 2) return { km: null, points: good.length };
  let km = 0, last = good[0];
  for (let i = 1; i < good.length; i++) {
    const p = good[i];
    const step = haversineKm(Number(last.lat), Number(last.lng), Number(p.lat), Number(p.lng));
    const hours = (new Date(p.recordedAt ?? p.recorded_at) - new Date(last.recordedAt ?? last.recorded_at)) / 3600000;
    if (step * 1000 < MIN_STEP_M) continue;                       // jitter — keep `last`
    if (hours > 0 && step / hours > MAX_KMH) continue;            // GPS jump — outlier, keep the previous anchor
    km += step; last = p;
  }
  return { km, points: good.length };
}
