import React, { useCallback, useEffect, useState } from 'react';
import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { formatNepalTime, getNepalTodayISO } from '../utils/dateUtils.js';
import { Sheet, Spinner, useMT } from './kit.jsx';

/* Field Visit page — the day's trip as a whole:
   top    : "Check out from Office" (grabs location + time, pick the first field visit, trip starts)
   bottom : "Check in at Office" once the visits are done (location + time), then Today's Journey summary.
   Per-visit Check in / Check out stays on each task (MobileJourney). */

const STATUS_LABEL = { work_done: 'Complete', pending_next_day: 'Pending', cancelled: 'Cancelled' };
const mins = (a, b) => (a && b ? Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000)) : null);
const dur = (m) => (m == null ? '—' : m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);
const getLocation = () => new Promise((res, rej) => {
  if (!navigator.geolocation) { rej(new Error('This phone does not support location access.')); return; }
  navigator.geolocation.getCurrentPosition((p) => res(p.coords),
    (e) => rej(new Error(e.code === e.PERMISSION_DENIED ? 'Location access is off. Please allow location for eHajiri and try again.' : 'Could not find your location. Please try again.')),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
});

export default function TripBar({ tasks, onOpenTask, onChanged, onSession, children }) {
  const mt = useMT();
  const { currentUser } = useAuth();
  const [session, setSession] = useState(undefined);        // undefined loading · null none open
  const [today, setToday] = useState([]);                   // today's trips (for the journey summary)
  const [sheet, setSheet] = useState(null);                 // 'out' | 'in'
  const [loc, setLoc] = useState({ status: 'checking' });
  const [pick, setPick] = useState(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [now, setNow] = useState(Date.now());

  const iso = getNepalTodayISO();
  const load = useCallback(async () => {
    try { setSession(await api.get('/field-visit/session/active')); } catch { setSession(null); }
    try { const r = await api.get(`/field-visit/report?startDate=${iso}&endDate=${iso}&employeeId=${currentUser.id}`); setToday(r?.sessions || []); } catch { setToday([]); }
  }, [iso, currentUser?.id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { onSession?.(session || null); }, [session]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!sheet) return undefined; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [sheet]);

  const mineDue = (tasks || []).filter(t => t.isFieldVisit && !['completed', 'cancelled'].includes(t.status)
    && (t.assignees || []).some(a => String(a.id) === String(currentUser?.id)) && t.dueDate && String(t.dueDate).slice(0, 10) <= iso)
    .sort((a, b) => (a.myOrder == null ? 1e9 : a.myOrder) - (b.myOrder == null ? 1e9 : b.myOrder));

  const locate = useCallback(async () => {
    setLoc({ status: 'checking' });
    try {
      const c = await getLocation();
      setLoc({ status: 'ready', lat: c.latitude, lng: c.longitude, accuracy: c.accuracy, place: '' });
      api.get(`/online-attendance/geocode?lat=${c.latitude}&lng=${c.longitude}`).then(r => setLoc(l => (l.lat === c.latitude ? { ...l, place: r?.place || '' } : l))).catch(() => {});
    } catch (e) { setLoc({ status: 'error', error: e.message }); }
  }, []);
  const open = (mode) => { setErr(''); setSheet(mode); setPick(mineDue[0]?.id ?? null); locate(); };

  const stops = session?.stops || [];
  const lastStop = stops.length ? stops[stops.length - 1] : null;
  const canOfficeIn = !!session && (!lastStop || !!lastStop.checkOutAt);

  const submit = async () => {
    setBusy(true); setErr('');
    try {
      const c = await getLocation();
      const gps = { lat: c.latitude, lng: c.longitude, accuracy: c.accuracy, deviceInfo: String(navigator.userAgent || '').slice(0, 300) };
      if (sheet === 'out') {
        if (!pick) throw new Error(mt('Select a field visit first'));
        await api.post('/field-visit/session/start', { taskId: pick, ...gps });
        setSheet(null); await load(); onChanged?.(); onOpenTask?.(pick);
      } else {
        await api.post(`/field-visit/sessions/${session.id}/office-in`, gps);
        setSheet(null); await load(); onChanged?.();
      }
    } catch (e) { setErr(e?.message || mt('Failed')); } finally { setBusy(false); }
  };

  const finished = today.filter(s => s.officeInAt);
  return (<>
    {session === undefined ? <div className="m-empty"><Spinner dark /></div> : !session ? (
      <button className="m-btn m-block" style={{ marginBottom: 12 }} onClick={() => open('out')}>🚗 {mt('Check out from Office')}</button>
    ) : (
      <div className="m-jcard" style={{ marginBottom: 12 }}>
        <div className="m-jhead">🚗 {mt('Trip in progress')} · {mt('Office Out')} {formatNepalTime(session.officeOutAt)}</div>
        {lastStop && !lastStop.checkOutAt && <button className="m-btn m-block m-ghost" style={{ marginTop: 8 }} onClick={() => onOpenTask?.(lastStop.taskId)}>{mt('Open that visit')}</button>}
      </div>
    )}

    {children}

    {session && (
      <div style={{ marginTop: 6, marginBottom: 12 }}>
        <button className="m-btn m-block m-warn" disabled={!canOfficeIn} onClick={() => open('in')}>🏢 {mt('Check in at Office')}</button>
        {!canOfficeIn && <div className="m-muted" style={{ marginTop: 6, fontSize: 12.5 }}>{mt('Check out from your current visit first')}</div>}
      </div>
    )}

    {today.length > 0 && (
      <div className="m-jcard">
        <div className="m-jtitle">🗓️ {mt('Today’s Journey')}</div>
        {today.map(s => (
          <div key={s.id} style={{ marginBottom: 10 }}>
            <div className="m-jhead" style={{ fontSize: 14 }}>🚗 {mt('Office Out')} {formatNepalTime(s.officeOutAt)}{s.officeInAt ? ` → 🏢 ${mt('Office In')} ${formatNepalTime(s.officeInAt)}` : ` · ${mt('on the way')}`}</div>
            {(s.stops || []).map(st => (
              <div key={st.id} className="m-jgap" style={{ display: 'block' }}>
                📍 <b>{st.checkInClientName || st.customerName || st.taskTitle}</b>
                <div className="m-muted" style={{ fontSize: 12.5 }}>
                  {st.checkInAt ? `${mt('Check in')} ${formatNepalTime(st.checkInAt)}` : mt('Not reached yet')}
                  {st.checkOutAt ? ` → ${mt('Check out')} ${formatNepalTime(st.checkOutAt)} · ${dur(mins(st.checkInAt, st.checkOutAt))}` : ''}
                  {st.checkOutWorkProgress ? ` · ${mt(STATUS_LABEL[st.checkOutWorkProgress] || '')}` : ''}
                  {st.travelKm != null ? ` · ${Number(st.travelKm).toFixed(1)} km` : ''}
                </div>
              </div>
            ))}
            {s.officeInAt && <div className="m-muted" style={{ fontSize: 12.5 }}>⏱ {mt('Total trip')}: <b>{dur(mins(s.officeOutAt, s.officeInAt))}</b>{s.travelKm != null ? ` · ${mt('Travel back')} ${Number(s.travelKm).toFixed(1)} km` : ''}</div>}
          </div>
        ))}
        {finished.length === 0 && <div className="m-muted" style={{ fontSize: 12.5 }}>{mt('Finish the trip with Check in at Office')}</div>}
      </div>
    )}

    {sheet && (
      <Sheet title={sheet === 'out' ? '🚗 ' + mt('Check out from Office') : '🏢 ' + mt('Check in at Office')} onClose={() => !busy && setSheet(null)}
        footer={<><button className="m-btn m-ghost" disabled={busy} onClick={() => setSheet(null)}>{mt('Cancel')}</button>
          <button className="m-btn" disabled={busy || loc.status !== 'ready' || (sheet === 'out' && !pick)} onClick={submit}>{busy ? '…' : (sheet === 'out' ? mt('Check out') : mt('Check in'))}</button></>}>
        {err && <div className="m-err">{err}</div>}
        <div className={`m-locbox ${loc.status}`}>
          {loc.status === 'checking' && <>📍 {mt('Getting your location…')}</>}
          {loc.status === 'ready' && <>✅ {mt('Location verified')}{loc.place ? ` · ${loc.place}` : ''}<div className="m-jsub">{Number(loc.lat).toFixed(5)}, {Number(loc.lng).toFixed(5)} · ±{Math.round(loc.accuracy || 0)} m</div></>}
          {loc.status === 'error' && <>📍 {loc.error} <button className="m-link" onClick={locate}>{mt('Retry')}</button></>}
        </div>
        <div className="m-field"><label>{sheet === 'out' ? mt('Check out Time') : mt('Check in Time')}</label>
          <input className="m-input m-locked" readOnly value={formatNepalTime(new Date(now).toISOString())} />
          <div className="m-jsub">{mt('Current time — cannot be edited')}</div></div>
        {sheet === 'out' && (
          <div className="m-field"><label>{mt('Go to which field visit first?')}</label>
            {mineDue.length === 0 && <div className="m-muted">{mt('No field visit is due today')}</div>}
            {mineDue.map(t => (
              <label key={t.id} className="m-check" style={{ padding: '6px 2px' }}>
                <input type="radio" name="firstvisit" checked={pick === t.id} onChange={() => setPick(t.id)} />
                <span>{t.customerName ? `${t.customerName} — ${t.title}` : t.title}</span>
              </label>
            ))}
          </div>
        )}
      </Sheet>
    )}
  </>);
}
