import React, { useState, useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useData } from '../../context/DataContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import NepaliDatePicker from '../Common/NepaliDatePicker.jsx';
import { formatNepalTime, getNepalTodayISO } from '../../utils/dateUtils.js';
import { CHECKOUT_STATUS_LABEL } from './FieldVisitJourneyPanel.jsx';

// "Track Flow of Staff" — a day's full field-visit movement for one employee,
// plotted as a numbered route on an OpenStreetMap/Leaflet map (office out ->
// every check-in/check-out -> office in), each leg labeled with its recorded
// distance. Leaflet's default marker icons resolve to relative image paths
// that break under Vite's bundling, so every marker here is a small inline
// divIcon instead of the library's default pin image.
const dot = (num, bg) => L.divIcon({
  className: '',
  html: `<div style="width:24px;height:24px;border-radius:50%;background:${bg};color:#fff;
    display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;
    border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)">${num}</div>`,
  iconSize: [24, 24], iconAnchor: [12, 12],
});
const legLabel = (km) => L.divIcon({
  className: '',
  html: `<div style="background:#fff;border:1px solid #d1d5db;border-radius:10px;padding:1px 7px;
    font-size:10.5px;font-weight:700;color:#374151;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.18)">${km.toFixed(1)} km</div>`,
  iconSize: null,
});

const StaffTrackFlowModal = ({ onClose }) => {
  const { currentUser, isAdmin, isSuperAdmin, isBranchManager, isDeptHead } = useAuth();
  const { employees } = useData();
  const { settings } = useSettings();
  const canPickAnyone = isAdmin || isSuperAdmin || isBranchManager || isDeptHead;

  const [employeeId, setEmployeeId] = useState(canPickAnyone ? (employees[0]?.id ?? currentUser?.id ?? '') : currentUser?.id ?? '');
  const [date,       setDate]       = useState(getNepalTodayISO());
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');
  const [track,      setTrack]      = useState(null);

  const mapElRef   = useRef(null);
  const mapRef     = useRef(null);
  const layerRef   = useRef(null);

  useEffect(() => {
    if (!employeeId || !date) return;
    setLoading(true); setError('');
    api.get(`/field-visit/employee/${employeeId}/track?date=${date}`)
      .then(setTrack)
      .catch(e => { setError(e.message || 'Failed to load'); setTrack(null); })
      .finally(() => setLoading(false));
  }, [employeeId, date]);

  // Map — created once
  useEffect(() => {
    if (!mapElRef.current || mapRef.current) return;
    const map = L.map(mapElRef.current, { zoomControl: true }).setView([27.7172, 85.3240], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors', maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    // A modal mounts while display:none-ish sizing hasn't settled yet in some
    // layouts — invalidateSize once after paint so tiles fill the container.
    setTimeout(() => map.invalidateSize(), 50);
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Route — redrawn whenever the loaded track changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    layerRef.current?.clearLayers();
    const group = layerRef.current || L.layerGroup().addTo(map);
    layerRef.current = group;

    const officeLoc = settings.officeLatitude != null && settings.officeLongitude != null
      ? [settings.officeLatitude, settings.officeLongitude] : null;

    let seq = 0, prevPoint = null;
    const bounds = [];
    const plot = (lat, lng, color, popupHtml, legKm) => {
      if (lat == null || lng == null) return;
      seq += 1;
      const pt = [lat, lng];
      if (prevPoint) {
        L.polyline([prevPoint, pt], { color: '#1a56db', weight: 3, opacity: .6 }).addTo(group);
        if (legKm != null) {
          const mid = [(prevPoint[0] + pt[0]) / 2, (prevPoint[1] + pt[1]) / 2];
          L.marker(mid, { icon: legLabel(legKm), interactive: false }).addTo(group);
        }
      }
      L.marker(pt, { icon: dot(seq, color) }).addTo(group).bindPopup(popupHtml);
      bounds.push(pt);
      prevPoint = pt;
    };

    (track?.sessions || []).forEach(session => {
      if (officeLoc && session.stops[0]?.isFirstStopOfSession) {
        plot(officeLoc[0], officeLoc[1], '#1a56db',
          `<b>🚗 Check Out — Office</b><br>${formatNepalTime(session.officeOutAt)}`);
      }
      session.stops.forEach(s => {
        plot(s.checkInLat, s.checkInLng, '#c2410c',
          `<b>📍 Check In${s.checkInClientName ? ` — ${s.checkInClientName}` : ''}</b><br>${s.checkInAt ? formatNepalTime(s.checkInAt) : '—'}` +
          (s.checkInLocationName ? `<br>${s.checkInLocationName}` : '') +
          (s.travelMinutes != null ? `<br>Time Taken: ${s.travelMinutes}m` : ''),
          s.travelKm);
        plot(s.checkOutLat, s.checkOutLng, '#7c3aed',
          `<b>🚪 Check Out${s.checkInClientName ? ` — ${s.checkInClientName}` : ''}</b><br>${s.checkOutAt ? formatNepalTime(s.checkOutAt) : '—'}` +
          (s.checkOutWorkProgress ? `<br>Status: ${CHECKOUT_STATUS_LABEL[s.checkOutWorkProgress] || s.checkOutWorkProgress}` : ''));
      });
      if (session.officeInAt) {
        plot(session.officeInLat, session.officeInLng, '#166534',
          `<b>🏢 Check In — Back to Office</b><br>${formatNepalTime(session.officeInAt)}`,
          session.travelKm);
      }
    });

    if (bounds.length >= 2) map.fitBounds(L.latLngBounds(bounds), { padding: [32, 32] });
    else if (bounds.length === 1) map.setView(bounds[0], 15);
    else if (officeLoc) map.setView(officeLoc, 14);
  }, [track, settings.officeLatitude, settings.officeLongitude]);

  const stopCount = (track?.sessions || []).reduce((n, s) => n + s.stops.length, 0);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 820, width: '100%' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>🛰️ Track Flow of Staff</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ minWidth: 220, flex: 1 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Staff</label>
              {canPickAnyone ? (
                <select value={employeeId} onChange={e => setEmployeeId(e.target.value)}
                  style={{ height: 36, width: '100%', border: '1px solid #d1d5db', borderRadius: 7, padding: '0 8px', fontSize: 13 }}>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.fullName}</option>)}
                </select>
              ) : (
                <div style={{ height: 36, display: 'flex', alignItems: 'center', fontSize: 13, color: '#374151', fontWeight: 600 }}>
                  {currentUser?.fullName || 'You'}
                </div>
              )}
            </div>
            <div style={{ width: 200 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Date</label>
              {settings.defaultCalendar === 'np'
                ? <NepaliDatePicker value={date} onChange={setDate} maxToday />
                : <input type="date" value={date} max={getNepalTodayISO()} onChange={e => setDate(e.target.value)}
                    style={{ height: 36, width: '100%', border: '1px solid #d1d5db', borderRadius: 7, padding: '0 10px', fontSize: 13, boxSizing: 'border-box' }} />}
            </div>
          </div>

          {error && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#991b1b' }}>
              {error}
            </div>
          )}

          <div style={{ position: 'relative' }}>
            <div ref={mapElRef} style={{ height: 460, width: '100%', borderRadius: 10, overflow: 'hidden', border: '1px solid #e5e7eb' }} />
            {loading && (
              <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#6b7280', borderRadius: 10 }}>
                Loading…
              </div>
            )}
            {!loading && !error && stopCount === 0 && (
              <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#9ca3af', borderRadius: 10 }}>
                No field visit movement recorded for this day
              </div>
            )}
          </div>

          {stopCount > 0 && (
            <div style={{ fontSize: 11.5, color: '#6b7280', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#1a56db', marginRight: 4 }} />Office</span>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#c2410c', marginRight: 4 }} />Check In</span>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#7c3aed', marginRight: 4 }} />Check Out</span>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#166534', marginRight: 4 }} />Back to Office</span>
              <span style={{ marginLeft: 'auto' }}>Numbers show the order of movement · click a pin for details</span>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-outline" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};

export default StaffTrackFlowModal;
