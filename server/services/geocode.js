/* Reverse geocoding: GPS coordinates -> a readable place name ("Kantipath, Kathmandu, Bagmati").
   Uses OpenStreetMap Nominatim (free, no key) with BigDataCloud as a fallback. Results are cached by position (~11 m) and
   outgoing requests are spaced >= 1.1 s apart, as the Nominatim usage policy asks. Never throws: a failure just means no name. */

const UA = 'eHajiri-attendance/1.0 (reverse geocoding for staff check-in)';
const cache = new Map();           // "27.7172,85.3240" -> string
let chain = Promise.resolve();     // serialises outgoing lookups
let lastCall = 0;
let fetchImpl = (...a) => fetch(...a);
export const _setFetch = (f) => { fetchImpl = f; };
export const _clearCache = () => cache.clear();

const key = (lat, lng) => `${Number(lat).toFixed(4)},${Number(lng).toFixed(4)}`;
const clean = (parts) => [...new Set(parts.map(s => String(s || '').trim()).filter(Boolean))];

async function nominatim(lat, lng) {
  const r = await fetchImpl(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=en&lat=${lat}&lon=${lng}`,
    { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(7000) });
  if (!r.ok) throw new Error('nominatim ' + r.status);
  const j = await r.json();
  const a = j.address || {};
  const first = j.name || a.amenity || a.building || a.shop || a.office || a.tourism || '';
  const parts = clean([first, a.road || a.pedestrian, a.neighbourhood || a.suburb || a.quarter, a.city || a.town || a.village || a.municipality || a.city_district, a.state]);
  if (parts.length) return parts.slice(0, 4).join(', ');
  return clean(String(j.display_name || '').split(',')).slice(0, 4).join(', ');
}

async function bigDataCloud(lat, lng) {
  const r = await fetchImpl(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`,
    { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(7000) });
  if (!r.ok) throw new Error('bdc ' + r.status);
  const j = await r.json();
  return clean([j.locality, j.city, j.principalSubdivision, j.countryName]).slice(0, 4).join(', ');
}

/** @returns {Promise<string>} the place name, or '' when it can't be found. */
export function reverseGeocode(lat, lng) {
  const la = Number(lat), ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) return Promise.resolve('');
  const k = key(la, ln);
  if (cache.has(k)) return Promise.resolve(cache.get(k));
  const job = chain.then(async () => {
    if (cache.has(k)) return cache.get(k);
    const wait = 1100 - (Date.now() - lastCall);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastCall = Date.now();
    let place = '';
    try { place = await nominatim(la, ln); } catch { /* try the fallback */ }
    if (!place) { try { place = await bigDataCloud(la, ln); } catch { /* no name */ } }
    if (place) { if (cache.size >= 500) cache.delete(cache.keys().next().value); cache.set(k, place); }
    return place;
  }).catch(() => '');
  chain = job.then(() => undefined, () => undefined);
  return job;
}
