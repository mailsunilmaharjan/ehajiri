import React, { useState, useEffect } from 'react';
import api from '../../api/client.js';
import SaveButton from '../Common/SaveButton.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import { formatNepalTime, getNepalTodayISO } from '../../utils/dateUtils.js';
import { getCurrentLocation, deviceInfo, estimateBikeTrip } from '../../utils/geoUtils.js';

/* Field Visit journey panel — replaces Followup History/Description in the
   side panel on the dedicated Field Visit page (Staff > Field Visit) only;
   the regular Task page still shows the normal Followup History/Description
   cards even for a field-visit-flagged task (see TaskList.jsx). Backed by
   field_visit_sessions/field_visit_stops (server/routes/fieldVisit.js) — one
   session per trip out of the office, one stop per client/task visited.
   Since the panel already knows exactly which task row is open, every action
   here targets THAT task directly — no separate destination picker: "Check
   Out from Office" and "Head Here Next" both post taskId directly, and
   continuing an in-progress trip to a DIFFERENT company is just a matter of
   clicking that company's own row (or picking it from the inline "Next Field
   Visit — Today" list once the current stop is closed). "Move to Office"
   mirrors a client Check In — mandatory GPS, computed travel stats for the
   return leg — instead of a single unverified click. Every timestamp is
   server-set, never client-supplied — "unchangeable Time" per the feature
   request. */

// Only asked at CHECK-OUT — "how did the visit end", not "did I arrive".
const CHECKOUT_STATUS_OPTIONS = [
  { value: 'work_done',        label: 'Work Done' },
  { value: 'pending_next_day', label: 'Pending for Next Day' },
  { value: 'cancelled',        label: 'Cancelled' },
];
const CHECKOUT_STATUS_LABEL = Object.fromEntries(CHECKOUT_STATUS_OPTIONS.map(o => [o.value, o.label]));

const fmtElapsed = (fromIso, toMs) => {
  if (!fromIso) return '—';
  const mins = Math.max(0, Math.round((toMs - new Date(fromIso).getTime()) / 60000));
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

// Once checked in, the client name typed at that moment (see "Client Office
// Name" below) is the most accurate label — it covers a task with no linked
// Contact record too, which customerName can't.
const stopLabel = (t) => t?.checkInClientName || (t?.customerName ? `${t.customerName} — ${t.taskTitle}` : t?.taskTitle) || 'this client';
const taskLabel = (t) => (t?.customerName ? `${t.customerName} — ${t.title}` : t?.title);
const mapsLink = (lat1, lng1, lat2, lng2) =>
  `https://www.google.com/maps/dir/?api=1&origin=${lat1},${lng1}&destination=${lat2},${lng2}&travelmode=driving`;
const pinLink = (lat, lng) => `https://www.google.com/maps?q=${lat},${lng}`;

// Distance/duration readout shared by the "just checked in" and "back at
// office" moments — actual (from real timestamps/GPS) next to the pre-visit
// bike-speed estimate, since the gap between them is the useful part.
const TravelStat = ({ km, minutes, estimatedMinutes, mapHref }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 11.5, color: '#6b7280' }}>
    <span>🚗 {km != null ? `${km.toFixed(1)} km` : '—'}</span>
    <span>·</span>
    <span>Taken {minutes != null ? `${minutes}m` : '—'}{estimatedMinutes != null ? ` (est. ${estimatedMinutes}m)` : ''}</span>
    {mapHref && <a href={mapHref} target="_blank" rel="noopener noreferrer" style={{ color: '#1a56db', fontWeight: 600, textDecoration: 'none' }}>🗺️ Map</a>}
  </div>
);

const FieldVisitJourneyPanel = ({ task, tasks, currentUser, showToast }) => {
  const { settings } = useSettings();
  const [session, setSession] = useState(undefined); // undefined = loading, null = no active trip, object = active
  const [now, setNow] = useState(Date.now());
  const [starting, setStarting]   = useState(false);
  const [advancing, setAdvancing] = useState(null); // null | the taskId currently being advanced to

  const load = () => { api.get('/field-visit/session/active').then(setSession).catch(() => setSession(null)); };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const isAssignee = Array.isArray(task.assignees) && task.assignees.some(a => String(a.id) === String(currentUser?.id));

  // ── Checkpoint modal — GPS always; Client/Location name only for a client
  // Check In; Status only for a client Check Out; Remarks for either client
  // step. "office-in" ("Move to Office") only ever needs the GPS confirmation. ──
  const [checkpoint, setCheckpoint]   = useState(null); // 'check-in' | 'check-out' | 'office-in' | null
  const [cpClientName, setCpClientName]     = useState('');
  const [cpLocationName, setCpLocationName] = useState('');
  const [cpStatus, setCpStatus]       = useState('work_done');
  const [cpRemarks, setCpRemarks]     = useState('');
  const [cpSaving, setCpSaving]       = useState(false);
  const [cpError, setCpError]         = useState('');
  const [locStatus, setLocStatus]     = useState('checking'); // checking | ready | error
  const [locError, setLocError]       = useState('');

  const acquireLocation = async () => {
    setLocStatus('checking'); setLocError('');
    try { await getCurrentLocation(); setLocStatus('ready'); }
    catch (e) { setLocError(e.message || 'Could not determine your location.'); setLocStatus('error'); }
  };
  const openCheckpoint = (mode) => {
    setCheckpoint(mode);
    // Pre-filled from the linked Contact if there is one, but always
    // editable — covers a task with no Contact attached (e.g. "No client
    // linked" tasks), and lets a visit's actual destination be corrected.
    setCpClientName(task.customerName || '');
    setCpLocationName(''); setCpStatus('work_done'); setCpRemarks(''); setCpError('');
    acquireLocation();
  };
  const submitCheckpoint = async () => {
    setCpSaving(true); setCpError('');
    try {
      const c = await getCurrentLocation();
      const payload = { lat: c.latitude, lng: c.longitude, accuracy: c.accuracy, deviceInfo: deviceInfo() };
      if (checkpoint === 'check-in' || checkpoint === 'check-out') payload.remarks = cpRemarks || null;
      if (checkpoint === 'check-in') { payload.clientName = cpClientName || null; payload.locationName = cpLocationName || null; }
      if (checkpoint === 'check-out') payload.workProgress = cpStatus;

      if (checkpoint === 'office-in') {
        const result = await api.post(`/field-visit/sessions/${session.id}/office-in`, payload);
        setSession(null);
        showToast?.(
          result.travelKm != null
            ? `Back at office — ${result.travelKm.toFixed(1)} km · ${result.travelMinutes}m from your last stop`
            : 'Back at office — trip complete'
        );
      } else {
        const result = await api.post(`/field-visit/stops/${activeStop.id}/${checkpoint}`, payload);
        setSession(result);
        showToast?.(checkpoint === 'check-in' ? 'Checked in' : 'Checked out');
      }
      setCheckpoint(null);
    } catch (e) { setCpError(e.message || 'Failed'); }
    finally { setCpSaving(false); }
  };

  const startTrip = async () => {
    setStarting(true);
    try {
      // Record where the office is: best-effort GPS fix with the Office Out (the trip still starts without one)
      let fix = {};
      try { const c = await getCurrentLocation(); fix = { lat: c.latitude, lng: c.longitude, accuracy: c.accuracy, deviceInfo: deviceInfo() }; } catch { /* no GPS */ }
      const result = await api.post('/field-visit/session/start', { taskId: task.id, ...fix });
      setSession(result);
      showToast?.('Checked out from office');
    } catch (e) { showToast?.(e.message || 'Failed to check out from office', 'error'); }
    finally { setStarting(false); }
  };
  const headHereNext = async (targetTaskId) => {
    setAdvancing(targetTaskId);
    try {
      const result = await api.post(`/field-visit/sessions/${session.id}/next-stop`, { taskId: targetTaskId });
      setSession(result);
    } catch (e) { showToast?.(e.message || 'Failed', 'error'); }
    finally { setAdvancing(null); }
  };

  const cardShell = (bg, border, children) => (
    <div style={{ flexShrink: 0, border: `1px solid ${border}`, borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ background: bg, padding: '9px 14px', display: 'flex', alignItems: 'center', gap: 7, borderBottom: `1px solid ${border}` }}>
        <span style={{ fontSize: 12 }}>🚗</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: '#1d4ed8', letterSpacing: '.4px' }}>JOURNEY STATUS</span>
      </div>
      <div style={{ padding: '10px 12px', background: '#fff', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {children}
      </div>
    </div>
  );

  const actionBtn = (label, onClick, bg = '#1a56db', disabled = false) => (
    <button onClick={onClick} disabled={disabled}
      style={{ background: bg, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px',
        fontSize: 12.5, fontWeight: 700, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? .6 : 1, whiteSpace: 'nowrap' }}>
      {label}
    </button>
  );

  if (session === undefined) return cardShell('#eff6ff', '#dbeafe', <span style={{ fontSize: 12, color: '#9ca3af' }}>Loading…</span>);
  if (!isAssignee) return null; // only an assignee can act on their own field visit

  const stops = session?.stops || [];
  const activeStop = stops.length ? stops[stops.length - 1] : null;
  const isCurrentTask = activeStop && String(activeStop.taskId) === String(task.id);

  // Today's OTHER open field-visit tasks assigned to this user — feeds the
  // inline "Next Field Visit" list once a stop is closed.
  const todayNepal = getNepalTodayISO();
  const otherTodayTasks = (tasks || []).filter(t =>
    t.id !== task.id && t.isFieldVisit && t.status !== 'completed' &&
    Array.isArray(t.assignees) && t.assignees.some(a => String(a.id) === String(currentUser?.id)) &&
    t.dueDate && String(t.dueDate).split('T')[0] <= todayNepal
  );

  // Distance/time estimate from the office to this client — only possible
  // once BOTH Settings > Company Information's Office Location is set AND
  // this contact has a GPS fix on file from an earlier visit (see the "Note"
  // in the feature request: check-in saves the client's location for this).
  const officeLoc = settings.officeLatitude != null && settings.officeLongitude != null
    ? { lat: settings.officeLatitude, lng: settings.officeLongitude } : null;
  const clientLoc = task.customerLat != null && task.customerLng != null
    ? { lat: task.customerLat, lng: task.customerLng } : null;
  const tripEstimate = (officeLoc && clientLoc)
    ? estimateBikeTrip(officeLoc.lat, officeLoc.lng, clientLoc.lat, clientLoc.lng) : null;

  const nextVisitList = (label) => otherTodayTasks.length > 0 && (
    <div>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.3px', marginBottom: 6 }}>{label}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {otherTodayTasks.map(t => (
          <button key={t.id} onClick={() => headHereNext(t.id)} disabled={advancing !== null}
            style={{ display: 'flex', alignItems: 'center', gap: 6, textAlign: 'left', background: '#eff6ff',
              border: '1px solid #dbeafe', borderRadius: 7, padding: '7px 10px', fontSize: 12.5, color: '#1d4ed8',
              fontWeight: 600, cursor: advancing !== null ? 'default' : 'pointer', opacity: advancing !== null ? .6 : 1 }}>
            ➡️ {advancing === t.id ? 'Heading Over…' : (t.customerName ? `${t.customerName} — ${t.title}` : t.title)}
          </button>
        ))}
      </div>
    </div>
  );

  const officeLabel = settings.officeLocationName || 'Office';
  const moveToOfficeBtn = (label, closingBtnState) => actionBtn(label, () => openCheckpoint('office-in'), '#6b7280', closingBtnState);

  let body;
  if (!session) {
    body = (
      <>
        <span style={{ fontSize: 13, color: '#374151' }}>Not currently on a field visit trip for this task.</span>
        {tripEstimate && (
          <span style={{ fontSize: 12, color: '#6b7280' }}>
            📍 Estimated from office: ~{tripEstimate.km.toFixed(1)} km · ~{tripEstimate.minutes} min by bike
          </span>
        )}
        {actionBtn(starting ? 'Checking Out…' : '🚗 Check Out from Office', startTrip, '#1a56db', starting)}
      </>
    );
  } else if (isCurrentTask && !activeStop.checkInAt) {
    body = (
      <>
        <span style={{ fontSize: 13, color: '#1d4ed8' }}>
          🚗 Heading here — left office at {formatNepalTime(session.officeOutAt)} ({fmtElapsed(stops.length > 1 ? stops[stops.length - 2].checkOutAt : session.officeOutAt, now)} ago)
        </span>
        {actionBtn('📍 Check In', () => openCheckpoint('check-in'), '#16a34a')}
      </>
    );
  } else if (isCurrentTask && !activeStop.checkOutAt) {
    body = (
      <>
        <span style={{ fontSize: 13, color: '#166534' }}>
          📍 Checked in since {formatNepalTime(activeStop.checkInAt)} ({fmtElapsed(activeStop.checkInAt, now)})
        </span>
        {activeStop.checkInLocationName && (
          <a href={pinLink(activeStop.checkInLat, activeStop.checkInLng)} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 12, color: '#166534', fontWeight: 600, textDecoration: 'none' }}>
            📍 {activeStop.checkInLocationName}
          </a>
        )}
        {activeStop.travelKm != null && (() => {
          // The map link must trace the ACTUAL leg just traveled — office
          // only for a trip's first stop; the previous stop's own checkout
          // point for every stop after that (chained via "Head Here Next").
          const prevStop = stops.length > 1 ? stops[stops.length - 2] : null;
          const fromLoc = prevStop ? { lat: prevStop.checkOutLat, lng: prevStop.checkOutLng } : officeLoc;
          return (
            <TravelStat km={activeStop.travelKm} minutes={activeStop.travelMinutes} estimatedMinutes={activeStop.estimatedMinutes}
              mapHref={fromLoc ? mapsLink(fromLoc.lat, fromLoc.lng, activeStop.checkInLat, activeStop.checkInLng) : null} />
          );
        })()}
        {actionBtn('🚪 Check Out', () => openCheckpoint('check-out'), '#dc2626')}
      </>
    );
  } else if (isCurrentTask) {
    body = (
      <>
        <span style={{ fontSize: 13, color: '#92400e' }}>
          ✅ Total Hour Stayed: {fmtElapsed(activeStop.checkInAt, new Date(activeStop.checkOutAt).getTime())}
        </span>
        {nextVisitList('Next Field Visit — Today')}
        {moveToOfficeBtn(`🏢 Move to ${officeLabel}`)}
      </>
    );
  } else if (activeStop.checkOutAt) {
    body = (
      <>
        <span style={{ fontSize: 13, color: '#374151' }}>
          You just finished your visit to <strong>{stopLabel(activeStop)}</strong>.
        </span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {actionBtn(advancing === task.id ? 'Heading Over…' : `➡️ Head Here Next`, () => headHereNext(task.id), '#1a56db', advancing !== null)}
          {moveToOfficeBtn(`🏢 Move to ${officeLabel} Instead`)}
        </div>
      </>
    );
  } else {
    body = (
      <span style={{ fontSize: 13, color: '#374151' }}>
        You're currently on a field visit to <strong>{stopLabel(activeStop)}</strong> — finish that stop before starting a new one.
      </span>
    );
  }

  const cpTitle = checkpoint === 'check-in' ? `📍 Check In at ${taskLabel(task)}`
    : checkpoint === 'check-out' ? `🚪 Check Out from ${stopLabel(activeStop)}`
    : `🏢 Check In at ${officeLabel}`;
  const cpSaveLabel = checkpoint === 'check-in' ? 'Check In' : checkpoint === 'check-out' ? 'Check Out' : 'Check In';
  const cpSaveIcon  = checkpoint === 'check-in' ? '📍' : checkpoint === 'check-out' ? '🚪' : '🏢';

  return (
    <>
      {cardShell(
        !session ? '#f8fafc' : isCurrentTask && !activeStop.checkInAt ? '#eff6ff'
          : isCurrentTask && !activeStop.checkOutAt ? '#f0fdf4'
          : isCurrentTask ? '#fffbeb' : '#f8fafc',
        !session ? '#e2e8f0' : isCurrentTask && !activeStop.checkInAt ? '#dbeafe'
          : isCurrentTask && !activeStop.checkOutAt ? '#bbf7d0'
          : isCurrentTask ? '#fde68a' : '#e2e8f0',
        body
      )}

      {/* Check In (GPS + Client/Location name + Remarks) / Check Out (GPS +
          Status + Remarks) / Move to Office (GPS only, mirrors a client
          Check In for the return leg) */}
      {checkpoint && (
        <div className="modal-overlay" onClick={() => !cpSaving && setCheckpoint(null)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{cpTitle}</h2>
              <button className="modal-close" onClick={() => setCheckpoint(null)}>✕</button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {cpError && (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#991b1b' }}>
                  {cpError}
                </div>
              )}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                background: locStatus === 'ready' ? '#f0fdf4' : locStatus === 'error' ? '#fef2f2' : '#f9fafb',
                border: `1px solid ${locStatus === 'ready' ? '#bbf7d0' : locStatus === 'error' ? '#fecaca' : '#e5e7eb'}`,
                borderRadius: 8, padding: '8px 12px', fontSize: 12,
              }}>
                <span style={{ color: locStatus === 'ready' ? '#065f46' : locStatus === 'error' ? '#991b1b' : '#6b7280' }}>
                  {locStatus === 'checking' && '📍 Getting your location…'}
                  {locStatus === 'ready' && '📍 Location ready'}
                  {locStatus === 'error' && `📍 ${locError}`}
                </span>
                {locStatus === 'error' && (
                  <button onClick={acquireLocation}
                    style={{ background: 'none', border: '1px solid #fca5a5', color: '#991b1b', borderRadius: 6,
                      fontSize: 11.5, fontWeight: 700, padding: '3px 9px', cursor: 'pointer' }}>
                    🔄 Retry
                  </button>
                )}
              </div>

              {/* Client/Location name — client Check In only. Covers a task
                  with no linked Contact (customerName pre-fills it when there
                  IS one, but it's always editable), and a free-text place
                  label saved alongside the raw GPS pin since coordinates
                  alone aren't meaningful to someone reading the log later. */}
              {checkpoint === 'check-in' && (
                <>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Client Office Name</label>
                    <input type="text" value={cpClientName} onChange={e => setCpClientName(e.target.value)}
                      placeholder="e.g. Cyber Security Army Barak"
                      style={{ height: 36, width: '100%', border: '1px solid #d1d5db', borderRadius: 7, padding: '0 10px', fontSize: 13, boxSizing: 'border-box', outline: 'none' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Location Name</label>
                    <input type="text" value={cpLocationName} onChange={e => setCpLocationName(e.target.value)}
                      placeholder="e.g. 3rd Floor, ABC Complex, New Baneshwor"
                      style={{ height: 36, width: '100%', border: '1px solid #d1d5db', borderRadius: 7, padding: '0 10px', fontSize: 13, boxSizing: 'border-box', outline: 'none' }} />
                  </div>
                </>
              )}

              {/* Status is only meaningful once the visit is over, not on arrival */}
              {checkpoint === 'check-out' && (
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Status</label>
                  <select value={cpStatus} onChange={e => setCpStatus(e.target.value)}
                    style={{ height: 36, width: '100%', border: '1px solid #d1d5db', borderRadius: 7, padding: '0 8px', fontSize: 13 }}>
                    {CHECKOUT_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              )}
              {checkpoint !== 'office-in' && (
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Remarks</label>
                  <textarea value={cpRemarks} onChange={e => setCpRemarks(e.target.value)} rows={3}
                    style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 7, padding: '8px 10px', fontSize: 13, resize: 'vertical', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setCheckpoint(null)}>Cancel</button>
              <SaveButton onClick={submitCheckpoint} disabled={cpSaving || locStatus !== 'ready'}
                icon={cpSaving ? '⏳' : cpSaveIcon}
                label={cpSaving ? 'Saving…' : cpSaveLabel} />
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export { CHECKOUT_STATUS_LABEL };
export default FieldVisitJourneyPanel;
