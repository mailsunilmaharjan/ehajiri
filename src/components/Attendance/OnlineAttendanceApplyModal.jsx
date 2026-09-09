import React, { useState, useEffect } from 'react';
import api from '../../api/client.js';
import { useOnlineAttendanceApply } from '../../context/OnlineAttendanceApplyContext.jsx';
import useDateFormat from '../../hooks/useDateFormat.js';

const fmtTime = (iso) => iso ? new Date(iso).toLocaleTimeString('en-US', {
  hour: '2-digit', minute: '2-digit',
}) : '—';

const STATUS_PILL = {
  pending : { bg: '#fffbeb', color: '#92400e', label: '⏳ Pending Approval' },
  approved: { bg: '#f0fdf4', color: '#065f46', label: '✅ Approved' },
  rejected: { bg: '#fef2f2', color: '#991b1b', label: '❌ Rejected' },
};

// GPS + a best-effort device string are mandatory on every Check In/Out —
// getCurrentPosition wrapped in a Promise so a permission denial or timeout
// surfaces as a plain catchable error instead of a callback. Never lets the
// call through without a resolved position — that's the actual enforcement
// of "location is mandatory", not just a UI nicety.
function getLocation() {
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

const deviceInfo = () => `${navigator.userAgent} | ${navigator.platform || ''}`.trim();

const OnlineAttendanceApplyModal = () => {
  const { isOpen, close } = useOnlineAttendanceApply();
  const fd = useDateFormat();
  const [loading, setLoading] = useState(true);
  const [record, setRecord] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Location is acquired proactively the moment the modal opens — the
  // Check In/Out button stays disabled until this resolves, instead of only
  // discovering a denied/failed permission after the user has already
  // tapped it. 'checking' | 'ready' | 'error'.
  const [locStatus, setLocStatus] = useState('checking');
  const [locError, setLocError] = useState('');

  const acquireLocation = async () => {
    setLocStatus('checking');
    setLocError('');
    try {
      await getLocation();
      setLocStatus('ready');
    } catch (err) {
      setLocError(err.message || 'Could not determine your location.');
      setLocStatus('error');
    }
  };

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const today = await api.get('/online-attendance/today');
      setRecord(today);
    } catch (err) {
      setError(err.message || 'Failed to load today\'s status');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) { load(); acquireLocation(); }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClose = () => { close(); setError(''); };

  const submit = async (kind) => {
    setBusy(true);
    setError('');
    try {
      // Re-acquire fresh coordinates at submit time (the modal may have sat
      // open a while since the initial check) rather than reusing the
      // possibly-stale one from acquireLocation — the button being enabled
      // only proves permission was granted, not that this exact fix is current.
      const c = await getLocation();
      const saved = await api.post(`/online-attendance/${kind}`, {
        lat: c.latitude, lng: c.longitude, accuracy: c.accuracy, deviceInfo: deviceInfo(),
      });
      setRecord(saved);
    } catch (err) {
      setError(err.message || `${kind === 'check-in' ? 'Check In' : 'Check Out'} failed`);
    } finally {
      setBusy(false);
    }
  };

  if (!isOpen) return null;

  const pill = record?.status ? STATUS_PILL[record.status] : null;
  const locationReady = locStatus === 'ready';

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>🌐 Online Attendance</h2>
          <button className="modal-close" onClick={handleClose}>✕</button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '24px 24px 28px', textAlign: 'center' }}>
          {loading ? (
            <div style={{ color: '#9ca3af', padding: '20px 0' }}>Loading…</div>
          ) : (
            <>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#374151' }}>{fd(new Date())}</div>

              {error && (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 12px', fontSize: 12.5, color: '#991b1b', textAlign: 'left' }}>
                  {error}
                </div>
              )}

              {/* Check-in time is display-only everywhere it appears — never
                  an editable input, matching "check in/out time should be
                  non-editable" — the server always stamps NOW() itself. */}
              {record?.checkInAt && (
                <div style={{ display: 'flex', justifyContent: 'space-between', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>
                  <span style={{ color: '#6b7280' }}>Checked in</span>
                  <span style={{ fontWeight: 700, color: '#111827' }}>{fmtTime(record.checkInAt)}</span>
                </div>
              )}
              {record?.checkOutAt && (
                <div style={{ display: 'flex', justifyContent: 'space-between', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>
                  <span style={{ color: '#6b7280' }}>Checked out</span>
                  <span style={{ fontWeight: 700, color: '#111827' }}>{fmtTime(record.checkOutAt)}</span>
                </div>
              )}

              {/* Location gate — the Check In/Out button below stays disabled
                  until this resolves, so a denied/failed permission is caught
                  and explained up front instead of only after tapping a
                  button that was always going to fail. */}
              {(!record?.checkInAt || (record?.checkInAt && !record?.checkOutAt)) && (
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                  background: locStatus === 'ready' ? '#f0fdf4' : locStatus === 'error' ? '#fef2f2' : '#f9fafb',
                  border: `1px solid ${locStatus === 'ready' ? '#bbf7d0' : locStatus === 'error' ? '#fecaca' : '#e5e7eb'}`,
                  borderRadius: 8, padding: '8px 12px', fontSize: 12, textAlign: 'left',
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
              )}

              {!record?.checkInAt && (
                <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ fontSize: 12.5, color: '#065f46' }}>
                    Your current location and device will be recorded with this check-in.
                  </div>
                  <button onClick={() => submit('check-in')} disabled={busy || !locationReady}
                    title={!locationReady ? 'Waiting for location access' : undefined}
                    style={{ padding: '14px 0', borderRadius: 12, border: 'none', background: '#00A651', color: '#fff',
                      fontSize: 15, fontWeight: 800, cursor: (busy || !locationReady) ? 'not-allowed' : 'pointer', opacity: (busy || !locationReady) ? .5 : 1 }}>
                    {busy ? 'Checking In…' : '✅ Check In'}
                  </button>
                </div>
              )}

              {record?.checkInAt && !record?.checkOutAt && (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ fontSize: 12.5, color: '#991b1b' }}>
                    Your current location and device will be recorded with this check-out.
                  </div>
                  <button onClick={() => submit('check-out')} disabled={busy || !locationReady}
                    title={!locationReady ? 'Waiting for location access' : undefined}
                    style={{ padding: '14px 0', borderRadius: 12, border: 'none', background: '#dc2626', color: '#fff',
                      fontSize: 15, fontWeight: 800, cursor: (busy || !locationReady) ? 'not-allowed' : 'pointer', opacity: (busy || !locationReady) ? .5 : 1 }}>
                    {busy ? 'Checking Out…' : '🚪 Check Out'}
                  </button>
                </div>
              )}

              {record?.checkInAt && record?.checkOutAt && (
                <div style={{ marginTop: 4 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: '#111827', marginBottom: 8 }}>
                    You've completed today's online attendance
                  </div>
                  {pill && (
                    <span style={{ display: 'inline-block', padding: '4px 12px', borderRadius: 12, fontSize: 12, fontWeight: 700, background: pill.bg, color: pill.color }}>
                      {pill.label}
                    </span>
                  )}
                </div>
              )}
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-outline" onClick={handleClose}>Close</button>
        </div>
      </div>
    </div>
  );
};

export default OnlineAttendanceApplyModal;
