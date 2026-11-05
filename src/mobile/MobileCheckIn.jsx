import React, { useCallback, useEffect, useState } from 'react';
import api from '../api/client.js';
import { useOnlineAttendanceApply } from '../context/OnlineAttendanceApplyContext.jsx';
import useDateFormat from '../hooks/useDateFormat.js';
import { Icon, Sheet, Spinner, StatusChip, useMT } from './kit.jsx';

/* Phone version of the Online Attendance check-in / check-out screen: shows WHERE you are (place name, address line, a small
   map) before you tap, and the place for each punch afterwards. Same server rules as the website's popup. */

const tm = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—');

function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('This phone does not support location access.')); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(p.coords),
      (e) => reject(new Error(e.code === e.PERMISSION_DENIED ? 'Location access is off. Please allow location for eHajiri and try again.' : 'Could not find your location. Please try again.')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  });
}

/** OpenStreetMap tile around the point, with the pin placed at the exact spot inside it. */
function MiniMap({ lat, lng }) {
  const z = 16, n = 2 ** z;
  const x = ((lng + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const tx = Math.floor(x), ty = Math.floor(y);
  // 3x3 tiles so the pin can sit in the middle of the picture
  const tiles = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) tiles.push({ key: `${dx}${dy}`, src: `https://tile.openstreetmap.org/${z}/${tx + dx}/${ty + dy}.png`, dx, dy });
  const px = (x - tx + 1) * 256, py = (y - ty + 1) * 256;      // pin position inside the 768x768 block
  return (
    <div className="m-map" aria-hidden="true">
      <div className="m-map-inner" style={{ transform: `translate(${-(px - 150)}px, ${-(py - 80)}px)` }}>
        {tiles.map(t => <img key={t.key} src={t.src} alt="" style={{ left: (t.dx + 1) * 256, top: (t.dy + 1) * 256 }} />)}
        <span className="m-map-pin" style={{ left: px, top: py }}>📍</span>
      </div>
    </div>
  );
}

export default function MobileCheckIn() {
  const { isOpen, close } = useOnlineAttendanceApply();
  const mt = useMT();
  const fd = useDateFormat();
  const [rec, setRec] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loc, setLoc] = useState({ status: 'checking' });   // checking | ready | error  (+ lat,lng,accuracy,place,error)
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const locate = useCallback(async () => {
    setLoc({ status: 'checking' });
    try {
      const c = await getLocation();
      setLoc({ status: 'ready', lat: c.latitude, lng: c.longitude, accuracy: c.accuracy, place: '' });
      api.get(`/online-attendance/geocode?lat=${c.latitude}&lng=${c.longitude}`)
        .then(r => setLoc(l => (l.lat === c.latitude ? { ...l, place: r?.place || '', placeDone: true } : l)))
        .catch(() => setLoc(l => ({ ...l, placeDone: true })));
    } catch (e) { setLoc({ status: 'error', error: e.message }); }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setErr(''); setLoading(true);
    api.get('/online-attendance/today').then(setRec).catch(e => setErr(e.message || 'Could not load')).finally(() => setLoading(false));
    locate();
  }, [isOpen, locate]);

  if (!isOpen) return null;

  const punch = async (kind) => {
    setBusy(true); setErr('');
    try {
      const c = await getLocation();     // fresh fix at the moment of the tap
      const saved = await api.post(`/online-attendance/${kind}`, { lat: c.latitude, lng: c.longitude, accuracy: c.accuracy, deviceInfo: `${navigator.userAgent} | ${navigator.platform || ''}`.trim() });
      setRec(saved);
    } catch (e) { setErr(e.message || 'Failed'); } finally { setBusy(false); }
  };

  const hasIn = !!rec?.checkInAt, hasOut = !!rec?.checkOutAt;
  const kind = !hasIn ? 'check-in' : !hasOut ? 'check-out' : null;
  const ready = loc.status === 'ready';

  return (
    <Sheet title={mt('Online Attendance')} onClose={close}>
      {loading ? <div className="m-empty"><Spinner dark /></div> : (<>
        <div className="m-muted" style={{ textAlign: 'center', marginBottom: 10 }}>{fd(new Date())}</div>

        {(kind || loc.status !== 'ready') && (
          <div className={`m-loc ${loc.status}`}>
            {ready && <MiniMap lat={loc.lat} lng={loc.lng} />}
            <div className="m-loc-text">
              <span className="m-loc-ico"><Icon name="pin" size={20} /></span>
              <div className="m-grow">
                {loc.status === 'checking' && <b>{mt('Finding your location…')}</b>}
                {loc.status === 'error' && <><b style={{ color: '#991b1b' }}>{mt('Location is off')}</b><div className="m-muted">{loc.error}</div></>}
                {ready && <>
                  <b>{loc.place || (loc.placeDone ? mt('Your current location') : mt('Finding the place name…'))}</b>
                  <div className="m-muted" style={{ fontSize: 12 }}>{loc.lat.toFixed(5)}, {loc.lng.toFixed(5)}{loc.accuracy ? ` · ±${Math.round(loc.accuracy)} m` : ''}</div>
                </>}
              </div>
              <button className="m-icon-btn" style={{ background: '#f3f4f6', color: '#374151', width: 36, height: 36 }} onClick={locate} aria-label="Refresh location">↻</button>
            </div>
          </div>
        )}

        {err && <div className="m-err">{err}</div>}

        {kind && (
          <button className={`m-punch ${kind === 'check-in' ? 'in' : 'out'}`} disabled={busy || !ready} onClick={() => punch(kind)}>
            <span className="m-punch-ico"><Icon name="finger" size={44} /></span>
            <b>{busy ? '…' : kind === 'check-in' ? mt('Check In') : mt('Check Out')}</b>
            <span>{ready ? mt('Your location and phone are recorded') : mt('Waiting for location')}</span>
          </button>
        )}

        {(hasIn || hasOut) && (
          <div className="m-card m-flat" style={{ marginTop: 14 }}>
            {hasIn && <div className="m-kv" style={{ alignItems: 'flex-start' }}><span>{mt('Checked in')}</span><b style={{ textAlign: 'right' }}>{tm(rec.checkInAt)}{rec.checkInPlace && <small className="m-place">{rec.checkInPlace}</small>}</b></div>}
            {hasOut && <div className="m-kv" style={{ alignItems: 'flex-start' }}><span>{mt('Checked out')}</span><b style={{ textAlign: 'right' }}>{tm(rec.checkOutAt)}{rec.checkOutPlace && <small className="m-place">{rec.checkOutPlace}</small>}</b></div>}
          </div>
        )}

        {hasIn && hasOut && (
          <div style={{ textAlign: 'center', marginTop: 14 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>{mt("You've completed today's online attendance")}</div>
            <StatusChip status={rec.status || 'pending'} />
            <div className="m-muted" style={{ marginTop: 8, fontSize: 12 }}>{mt('Your approver has been notified')}</div>
          </div>
        )}
      </>)}
    </Sheet>
  );
}
