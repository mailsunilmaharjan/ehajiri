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
