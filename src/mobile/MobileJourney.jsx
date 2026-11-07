import React, { useCallback, useEffect, useState } from 'react';
import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { formatNepalTime, getNepalTodayISO } from '../utils/dateUtils.js';
import { Sheet, Spinner, useMT } from './kit.jsx';
import { tripTracker, notifyTripChanged } from '../utils/tripTracker.js';

/* Field Visit journey on the phone — same server flow and rules as the website's panel (server/routes/fieldVisit.js):
   Check out from Office → Check in at the client → Make Check out (remarks + status) → Next field visit, or Move to Office.
   Every point records the phone's GPS fix (and the server adds the place name) and the time spent between points is shown. */

const STATUS_OPTIONS = [['work_done', 'Complete'], ['pending_next_day', 'Pending'], ['cancelled', 'Cancelled']];
const STATUS_LABEL = Object.fromEntries(STATUS_OPTIONS);

const mins = (from, to) => (from && to ? Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60000)) : null);
const dur = (m) => (m == null ? '—' : m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);
const pin = (lat, lng) => (lat == null || lng == null ? null : `https://www.google.com/maps?q=${lat},${lng}`);

function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('This phone does not support location access.')); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(p.coords),
      (e) => reject(new Error(e.code === e.PERMISSION_DENIED ? 'Location access is off. Please allow location for eHajiri and try again.' : 'Could not find your location. Please try again.')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  });
}
const deviceInfo = () => String(navigator.userAgent || '').slice(0, 300);

function Where({ label, at, place, lat, lng, extra }) {
  const link = pin(lat, lng);
  return (
    <div className="m-jrow">
      <span className="m-jdot" />
      <div className="m-grow">
        <div className="m-row" style={{ gap: 8 }}><b className="m-grow">{label}</b><span className="m-muted" style={{ fontSize: 12.5 }}>{at ? formatNepalTime(at) : ''}</span></div>
        {(place || link) && <div className="m-muted m-jsub">{place ? `📍 ${place}` : ''}{link && <a href={link} target="_blank" rel="noreferrer" style={{ marginLeft: place ? 8 : 0 }}>{place ? '' : '📍 '}Map</a>}</div>}
        {extra}
      </div>
    </div>
  );
}
const Gap = ({ text }) => <div className="m-jgap"><span>⏱</span>{text}</div>;

export default function Journey({ task, tasks, onOpenTask, onChanged, onAddVisit }) {
  const mt = useMT();
  const { currentUser } = useAuth();
  const [session, setSession] = useState(undefined);       // undefined loading · null no active trip
  const [now, setNow] = useState(Date.now());
  const [done, setDone] = useState(null);                  // summary shown after "Move to Office"
  const [cp, setCp] = useState(null);                      // 'office-out' | 'check-in' | 'check-out' | 'office-in'
  const [loc, setLoc] = useState({ status: 'checking' });
  const [f, setF] = useState({ client: '', place: '', status: 'work_done', remarks: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [cats, setCats] = useState([]); const [catId, setCatId] = useState('');
  const [ask, setAsk] = useState(false);                   // after a check-out: false | 'choose' | 'list'

  const load = useCallback(() => api.get('/field-visit/session/active').then(setSession).catch(() => setSession(null)), []);
  useEffect(() => { load(); }, [load, task.id]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), cp ? 1000 : 30000); return () => clearInterval(t); }, [cp]);   // live clock while the form is open
  useEffect(() => { if (cp === 'site' && !cats.length) api.get('/settings/taskCategories').then(r => setCats(Array.isArray(r) ? r : [])).catch(() => {}); }, [cp, cats.length]);

  const isAssignee = (task.assignees || []).some(a => String(a.id) === String(currentUser?.id));
  const stops = session?.stops || [];
  const activeStop = stops.length ? stops[stops.length - 1] : null;
  const isCurrent = !!activeStop && String(activeStop.taskId) === String(task.id);

  const locate = useCallback(async () => {
    setLoc({ status: 'checking' });
    try {
      const c = await getLocation();
      setLoc({ status: 'ready', lat: c.latitude, lng: c.longitude, accuracy: c.accuracy, place: '' });
      api.get(`/online-attendance/geocode?lat=${c.latitude}&lng=${c.longitude}`)
        .then(r => setLoc(l => (l.lat === c.latitude ? { ...l, place: r?.place || '' } : l))).catch(() => {});
    } catch (e) { setLoc({ status: 'error', error: e.message }); }
  }, []);
  const openCp = (mode) => { setCp(mode); setErr(''); setCatId(task.categoryId ? String(task.categoryId) : ''); setF({ client: task.customerName || '', place: '', status: 'work_done', remarks: '' }); locate(); };

  const submit = async () => {
    setBusy(true); setErr('');
    try {
      const c = await getLocation();     // a fresh fix at the moment of the tap
      const gps = { lat: c.latitude, lng: c.longitude, accuracy: c.accuracy, deviceInfo: deviceInfo() };
      // Upload buffered GPS points first so the server sums the real route for the leg being closed.
      if ((cp === 'site' && !activeStop?.checkInAt) || cp === 'check-in' || cp === 'office-in') await tripTracker.flush();
      if (cp === 'site') {
        if (!activeStop.checkInAt) {
          setSession(await api.post(`/field-visit/stops/${activeStop.id}/check-in`, { ...gps, remarks: f.remarks || null, clientName: f.client || null, locationName: loc.place || null }));
          setF(p => ({ ...p, remarks: '' }));          // the form stays open for the remarks + status + check out
        } else {
          setSession(await api.post(`/field-visit/stops/${activeStop.id}/check-out`, { ...gps, workProgress: f.status, remarks: f.remarks || null }));
          if (catId && String(task.categoryId || '') !== catId) {   // category changed on the form → reclassify the task (same as "Transfer for next task")
            try { await api.post(`/tasks/${task.id}/followups`, { mode: 'phone', description: f.remarks || mt('Field visit update'), nextCategoryId: Number(catId) }); } catch { /* the visit itself is saved */ }
          }
          setCp(null); setAsk('choose');
        }
        onChanged?.(); return;
      }
      if (cp === 'office-out') { setSession(await api.post('/field-visit/session/start', { taskId: task.id, ...gps })); notifyTripChanged(); }
      else if (cp === 'check-in') setSession(await api.post(`/field-visit/stops/${activeStop.id}/check-in`, { ...gps, remarks: f.remarks || null, clientName: f.client || null, locationName: f.place || loc.place || null }));
      else if (cp === 'check-out') setSession(await api.post(`/field-visit/stops/${activeStop.id}/check-out`, { ...gps, workProgress: f.status, remarks: f.remarks || null }));
      else if (cp === 'office-in') {
        const r = await api.post(`/field-visit/sessions/${session.id}/office-in`, gps);
        setDone({ officeInAt: r.officeInAt, travelMinutes: r.travelMinutes, travelKm: r.travelKm, tracked: r.distanceSource === 'tracked', tripMinutes: mins(session.officeOutAt, r.officeInAt) });
        setSession(null);
        notifyTripChanged();   // trip closed -> stop tracking
      }
      setCp(null); onChanged?.();
    } catch (e) { setErr(e?.message || mt('Failed')); } finally { setBusy(false); }
  };
  const headNext = async (taskId) => {
    setBusy(true); setErr('');
    try { setSession(await api.post(`/field-visit/sessions/${session.id}/next-stop`, { taskId })); onOpenTask?.(taskId); }
    catch (e) { setErr(e?.message || mt('Failed')); } finally { setBusy(false); }
  };

  // only the assignee runs the trip; show it once the visit is In Progress (or while a trip is already heading to / at this task)
  if (!task.isFieldVisit || !isAssignee) return null;
  if (session === undefined) return <div className="m-jcard"><Spinner dark /></div>;
  if (!isCurrent && !done && ['completed', 'cancelled'].includes(task.status)) return null;

  const today = getNepalTodayISO();
  const others = (tasks || []).filter(t => t.id !== task.id && t.isFieldVisit && !['completed', 'cancelled'].includes(t.status)
    && (t.assignees || []).some(a => String(a.id) === String(currentUser?.id)) && t.dueDate && String(t.dueDate).slice(0, 10) <= today);

  let body;
  if (!session) {
    body = (<>
      <div className="m-jhead">🏢 {mt('You are at the office')}</div>
      <button className="m-btn m-block" onClick={() => openCp('office-out')}>🚗 {mt('Moving from Office')} · {mt('Check out')}</button>
    </>);
  } else if (isCurrent && !activeStop.checkInAt) {
    body = (<>
      <div className="m-jhead">🚗 {mt('Heading here')}</div>
      <div className="m-muted">{mt('Left office at')} {formatNepalTime(session.officeOutAt)} · {dur(mins(stops.length > 1 ? stops[stops.length - 2].checkOutAt : session.officeOutAt, now))} {mt('ago')}</div>
      <button className="m-btn m-block m-ok" onClick={() => openCp('site')}>📍 {mt('Reached here')} · {mt('Check in')}</button>
    </>);
  } else if (isCurrent && !activeStop.checkOutAt) {
    body = (<>
      <div className="m-jhead">📍 {mt('Checked in')} · {formatNepalTime(activeStop.checkInAt)}</div>
      <div className="m-muted">{mt('Time here')}: <b>{dur(mins(activeStop.checkInAt, now))}</b></div>
      <button className="m-btn m-block m-bad" onClick={() => openCp('site')}>🚪 {mt('Check out')} · {mt('Task Status')} &amp; {mt('Remarks')}</button>
    </>);
  } else if (isCurrent) {
    body = (<>
      <div className="m-jhead">✅ {mt('Visit finished')} · {mt('Time here')} {dur(mins(activeStop.checkInAt, activeStop.checkOutAt))}</div>
      {others.length > 0 && <div className="m-muted" style={{ marginTop: 4 }}>{mt('Next field visit')}</div>}
      {others.map(t => <button key={t.id} className="m-btn m-block" disabled={busy} onClick={() => headNext(t.id)}>➡️ {t.customerName ? `${t.customerName} — ${t.title}` : t.title}</button>)}
      <button className="m-btn m-block m-warn" onClick={() => openCp('office-in')}>🏢 {mt('Check out to Office')}</button>
    </>);
  } else if (activeStop?.checkOutAt) {
    body = (<>
      <div className="m-jhead">{mt('You just finished a visit')}</div>
      <button className="m-btn m-block" disabled={busy} onClick={() => headNext(task.id)}>➡️ {mt('Head here next')}</button>
      <button className="m-btn m-block m-warn" onClick={() => openCp('office-in')}>🏢 {mt('Move to Office instead')}</button>
    </>);
  } else {
    body = (<>
      <div className="m-jhead">🚗 {mt('You are on another field visit')}</div>
      <button className="m-btn m-block" onClick={() => onOpenTask?.(activeStop.taskId)}>{mt('Open that visit')}</button>
    </>);
  }

  const siteIn = !!activeStop?.checkInAt;
  const cpTitle = { site: siteIn ? '🚪 ' + mt('Check out') + ' · ' + mt('Task Status') : '📍 ' + mt('Reached here') + ' · ' + mt('Check in'), 'office-out': '🚗 ' + mt('Moving from Office'), 'check-in': '📍 ' + mt('Check in'), 'check-out': '🚪 ' + mt('Make Check out'), 'office-in': '🏢 ' + mt('Check out to Office') }[cp];
  const cpGo = { site: siteIn ? mt('Check out') : mt('Check in'), 'office-out': mt('Check out'), 'check-in': mt('Check in'), 'check-out': mt('Check out'), 'office-in': mt('Check in') }[cp];

  return (<>
    <div className="m-jcard">
      <div className="m-jtitle">🚗 {mt('Journey')}</div>
      {err && !cp && <div className="m-err">{err}</div>}
      {done && (
        <div className="m-okbox" style={{ marginBottom: 8 }}>
          🏢 {mt('Back at office')} · {formatNepalTime(done.officeInAt)}<br />
          {mt('Travel back')}: {dur(done.travelMinutes)}{done.travelKm != null ? ` · ${Number(done.travelKm).toFixed(1)} km${done.tracked ? ' (GPS)' : ' (est.)'}` : ''} · {mt('Total trip')}: <b>{dur(done.tripMinutes)}</b>
        </div>
      )}
      {body}

      {session && (
        <div className="m-jtl">
          <Where label={mt('Office Out')} at={session.officeOutAt} place={session.officeOutPlace} lat={session.officeOutLat} lng={session.officeOutLng} />
          {stops.map((s, i) => {
            const prevAt = i === 0 ? session.officeOutAt : stops[i - 1].checkOutAt;
            const travel = s.checkInAt ? (s.travelMinutes ?? mins(prevAt, s.checkInAt)) : null;
            return (
              <React.Fragment key={s.id}>
                {s.checkInAt && <Gap text={`${mt('Travel')}: ${dur(travel)}${s.estimatedMinutes != null ? ` (${mt('est.')} ${s.estimatedMinutes}m)` : ''}${s.travelKm != null ? ` · ${Number(s.travelKm).toFixed(1)} km${s.distanceSource === 'tracked' ? ' (GPS)' : ' (est.)'}` : ''}`} />}
                {s.checkInAt && <Where label={`${mt('Check in')} · ${s.checkInClientName || s.customerName || s.taskTitle}`} at={s.checkInAt} place={s.checkInPlace || s.checkInLocationName} lat={s.checkInLat} lng={s.checkInLng}
                  extra={s.checkInRemarks && <div className="m-jsub">“{s.checkInRemarks}”</div>} />}
                {s.checkInAt && <Gap text={`${mt('Time here')}: ${dur(mins(s.checkInAt, s.checkOutAt || now))}${s.checkOutAt ? '' : ' …'}`} />}
                {s.checkOutAt && <Where label={`${mt('Check out')} · ${mt(STATUS_LABEL[s.checkOutWorkProgress] || '')}`} at={s.checkOutAt} place={s.checkOutPlace} lat={s.checkOutLat} lng={s.checkOutLng}
                  extra={s.checkOutRemarks && <div className="m-jsub">“{s.checkOutRemarks}”</div>} />}
              </React.Fragment>
            );
          })}
        </div>
      )}
    </div>

    {ask && (
      <Sheet title={mt('Another field visit?')} onClose={() => setAsk(false)}>
        <div className="m-okbox" style={{ marginBottom: 12 }}>✅ {mt('Visit finished')}{activeStop?.checkOutAt ? ` · ${mt('Time here')} ${dur(mins(activeStop.checkInAt, activeStop.checkOutAt))}` : ''}</div>
        {err && <div className="m-err">{err}</div>}
        {ask === 'choose' && (<>
          <button className="m-btn m-block" style={{ marginBottom: 10 }} onClick={() => setAsk('list')}>➡️ {mt('Yes, another field visit')}</button>
          {onAddVisit && <button className="m-btn m-block m-ghost" style={{ marginBottom: 10 }} onClick={() => { setAsk(false); onAddVisit(); }}>＋ {mt('Add a new field visit')}</button>}
          <button className="m-btn m-block m-warn" onClick={() => { setAsk(false); openCp('office-in'); }}>🏢 {mt('No, check out to Office')}</button>
        </>)}
        {ask === 'list' && (<>
          {others.length === 0 && <div className="m-muted" style={{ marginBottom: 10 }}>{mt('No other field visit is due today')}</div>}
          {onAddVisit && <button className="m-btn m-block m-ghost" style={{ marginBottom: 10 }} onClick={() => { setAsk(false); onAddVisit(); }}>＋ {mt('Add a new field visit')}</button>}
          {others.map(t => <button key={t.id} className="m-btn m-block" style={{ marginBottom: 10 }} disabled={busy} onClick={async () => { await headNext(t.id); setAsk(false); }}>➡️ {t.customerName ? `${t.customerName} — ${t.title}` : t.title}</button>)}
          <button className="m-btn m-block m-warn" onClick={() => { setAsk(false); openCp('office-in'); }}>🏢 {mt('No, check out to Office')}</button>
        </>)}
      </Sheet>
    )}

    {cp && (
      <Sheet title={cpTitle} onClose={() => !busy && setCp(null)}
        footer={<><button className="m-btn m-ghost" disabled={busy} onClick={() => setCp(null)}>{mt('Cancel')}</button>
          <button className="m-btn" disabled={busy || loc.status !== 'ready'} onClick={submit}>{busy ? '…' : cpGo}</button></>}>
        {err && <div className="m-err">{err}</div>}
        <div className={`m-locbox ${loc.status}`}>
          {loc.status === 'checking' && <>📍 {mt('Getting your location…')}</>}
          {loc.status === 'ready' && <>✅ {mt('Location verified')}{loc.place ? ` · ${loc.place}` : ''}<div className="m-jsub">{Number(loc.lat).toFixed(5)}, {Number(loc.lng).toFixed(5)} · ±{Math.round(loc.accuracy || 0)} m</div></>}
          {loc.status === 'error' && <>📍 {loc.error} <button className="m-link" onClick={locate}>{mt('Retry')}</button></>}
        </div>
        {cp === 'office-out' && <div className="m-muted" style={{ marginBottom: 8 }}>{mt('Your office location and the time are recorded now.')}<br />📍 {mt('Your location is captured only when you tap Check out / Check in on a field visit.')}</div>}
        {cp === 'site' && (<>
          <div className="m-field"><label>{mt('Check in Time')}</label>
            <input className="m-input m-locked" readOnly value={formatNepalTime(siteIn ? activeStop.checkInAt : new Date(now).toISOString())} />
            <div className="m-jsub">{siteIn ? mt('Recorded — cannot be changed') : mt('Current time — cannot be edited')}</div></div>
        </>)}
        {cp === 'site' && siteIn && (
          <div className="m-okbox" style={{ marginBottom: 12 }}>📍 {mt('Checked in')} · {formatNepalTime(activeStop.checkInAt)} · {mt('Time here')} <b>{dur(mins(activeStop.checkInAt, now))}</b>
            {(activeStop.checkInPlace || activeStop.checkInLocationName) && <div className="m-jsub">{activeStop.checkInPlace || activeStop.checkInLocationName}</div>}</div>
        )}
        {cp === 'site' && (
          <div className="m-field"><label>{mt('Task Category')}</label>
            <select className="m-input" value={catId} onChange={e => setCatId(e.target.value)}><option value="">—</option>{cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        )}
        {cp === 'check-in' && (<>
          <div className="m-field"><label>{mt('Client Office Name')}</label><input className="m-input" value={f.client} onChange={e => setF(p => ({ ...p, client: e.target.value }))} /></div>
          <div className="m-field"><label>{mt('Location Name')}</label><input className="m-input" value={f.place} placeholder={loc.place || ''} onChange={e => setF(p => ({ ...p, place: e.target.value }))} /></div>
        </>)}
        {(cp === 'check-in' || cp === 'check-out' || cp === 'site') && (
          <div className="m-field"><label>{mt('Remarks')}</label><textarea className="m-input" rows={3} value={f.remarks} onChange={e => setF(p => ({ ...p, remarks: e.target.value }))} /></div>
        )}
        {cp === 'site' && (
          <div className="m-field"><label>{mt('Check out Time')}</label>
            <input className="m-input m-locked" readOnly value={siteIn ? formatNepalTime(new Date(now).toISOString()) : '—'} />
            <div className="m-jsub">{siteIn ? mt('Current time — recorded when you check out') : mt('Available after check in')}</div></div>
        )}
        {(cp === 'check-out' || (cp === 'site' && siteIn)) && (
          <div className="m-field"><label>{mt('Status')}</label>
            <div className="m-statuspick">{STATUS_OPTIONS.map(([k, l]) => <button type="button" key={k} className={f.status === k ? 'on' : ''} onClick={() => setF(p => ({ ...p, status: k }))}>{mt(l)}</button>)}</div></div>
        )}
      </Sheet>
    )}
  </>);
}
