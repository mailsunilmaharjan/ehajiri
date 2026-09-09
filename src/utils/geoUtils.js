// Straight-line (Haversine) distance + a rough bike/scooter travel-time
// estimate — used by the Field Visit journey panel to estimate the trip from
// the office to a client whose location was captured on an earlier visit
// (see staff_contacts.latitude/longitude, server/routes/fieldVisit.js).
// No maps/directions API is wired into this app, so this is deliberately an
// approximation, not a routed distance — a detour factor is applied since
// straight-line distance always understates real road distance, and the
// speed assumption is a reasonable Kathmandu city-traffic average.
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

export function estimateBikeTrip(lat1, lng1, lat2, lng2) {
  const km = haversineKm(lat1, lng1, lat2, lng2) * DETOUR_FACTOR;
  const minutes = Math.round((km / BIKE_KMH) * 60);
  return { km, minutes };
}

// getCurrentPosition wrapped in a Promise so a permission denial or timeout
// surfaces as a plain catchable error instead of a callback — same pattern
// OnlineAttendanceApplyModal.jsx uses for attendance GPS capture, shared here
// since Settings (Office Location) and the Field Visit journey panel both
// need it too.
export function getCurrentLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('This browser does not support location access.')); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos.coords),
      (err) => reject(new Error(
        err.code === err.PERMISSION_DENIED
          ? 'Location access was denied. Please allow location access and try again.'
          : 'Could not determine your location. Please try again.'
      )),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

export const deviceInfo = () => `${navigator.userAgent} | ${navigator.platform || ''}`.trim();
