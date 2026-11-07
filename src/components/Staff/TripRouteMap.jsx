import React, { useEffect, useMemo, useState } from 'react';
import api from '../../api/client.js';
import { formatNepalTime } from '../../utils/dateUtils.js';
import { CHECKOUT_STATUS_LABEL } from './FieldVisitJourneyPanel.jsx';

/**
 * The recorded route of one field-visit trip, drawn as a plain SVG sketch
 * (no map library / tiles — deliberately dependency-free): the GPS breadcrumb
 * path with numbered markers for Office Out, each client Check In / Check Out
 * and Office In, and a leg list with the distance of each leg (GPS route when
 * tracking recorded it, otherwise the straight-line estimate).
 * Data: GET /field-visit/sessions/:id/track + the session's stops (passed in).
 */
const W = 860, H = 520, PAD = 46;

const COLORS = { out: '#1a56db', in: '#c2410c', checkout: '#7c3aed', office: '#166534' };

const TripRouteMap = ({ session, onClose }) => {
  const [track, setTrack] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    api.get(`/field-visit/sessions/${session.id}/track`)
      .then(r => { if (alive) setTrack(r); })
      .catch(e => { if (alive) setError(e.message || 'Failed to load route'); });
    return () => { alive = false; };
  }, [session.id]);

  // Ordered marker list.
  const markers = useMemo(() => {
    const m = [];
    if (session.officeOutLat != null) m.push({ kind: 'out', lat: session.officeOutLat, lng: session.officeOutLng, label: 'Office Out', at: session.officeOutAt, sub: session.officeOutPlace });
    session.stops.forEach(s => {
      const nm = s.checkInClientName || s.customerName || s.taskTitle || 'Client';
      if (s.checkInLat != null) m.push({ kind: 'in', lat: s.checkInLat, lng: s.checkInLng, label: `Check In — ${nm}`, at: s.checkInAt, sub: s.checkInPlace });
      if (s.checkOutLat != null) m.push({ kind: 'checkout', lat: s.checkOutLat, lng: s.checkOutLng, label: `Check Out — ${nm}`, at: s.checkOutAt,
        sub: s.checkOutWorkProgress ? (CHECKOUT_STATUS_LABEL[s.checkOutWorkProgress] || s.checkOutWorkProgress) : '' });
    });
    if (session.officeInLat != null) m.push({ kind: 'office', lat: session.officeInLat, lng: session.officeInLng, label: 'Back at Office', at: session.officeInAt, sub: session.officeInPlace });
    return m;
  }, [session]);

  const points = track?.points || [];

  const { project, ok } = useMemo(() => {
    const all = [...points.map(p => [Number(p.lat), Number(p.lng)]), ...markers.map(m => [Number(m.lat), Number(m.lng)])];
    if (all.length < 1) return { project: null, ok: false };
    const lats = all.map(a => a[0]), lngs = all.map(a => a[1]);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const k = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);          // keep true proportions
    const w = Math.max((maxLng - minLng) * k, 1e-5), h = Math.max(maxLat - minLat, 1e-5);
    const scale = Math.min((W - 2 * PAD) / w, (H - 2 * PAD) / h);
    const offX = (W - w * scale) / 2, offY = (H - h * scale) / 2;
    return {
      ok: true,
      project: (lat, lng) => [offX + (lng - minLng) * k * scale, H - (offY + (lat - minLat) * scale)],
    };
  }, [points, markers]);

  const path = project && points.length > 1
    ? points.map((p, i) => { const [x, y] = project(Number(p.lat), Number(p.lng)); return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`; }).join(' ')
    : '';
  const dashed = project && markers.length > 1 && !path
    ? markers.map((m, i) => { const [x, y] = project(Number(m.lat), Number(m.lng)); return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`; }).join(' ')
    : '';

  // Leg list (distance + source).
  const legs = [];
  session.stops.forEach((s, i) => {
    const nm = s.checkInClientName || s.customerName || s.taskTitle || 'Client';
    if (s.checkInAt) legs.push({ text: `${i === 0 ? 'Office' : 'Previous stop'} → ${nm}`, km: s.travelKm, min: s.travelMinutes, tracked: s.distanceSource === 'tracked' });
  });
  if (session.officeInAt) legs.push({ text: 'Last stop → Office', km: session.travelKm, min: session.travelMinutes, tracked: session.distanceSource === 'tracked' });
  const totalKm = legs.reduce((n, l) => n + (l.km != null ? Number(l.km) : 0), 0);

  return (
    <div className="modal-overlay" style={{ zIndex: 2100 }} onClick={onClose}>
      <div className="modal" style={{ maxWidth: 940, width: '96vw' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>🗺️ Trip Route — {session.employeeName}</h2>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
              {points.length ? `${points.length} GPS points recorded` : 'No GPS points recorded for this trip — showing the check-in/out locations only'}
              {track?.distanceKm != null ? ` · path length ${track.distanceKm.toFixed(2)} km` : ''}
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ maxHeight: '78vh', overflowY: 'auto' }}>
          {error && <div style={{ color: '#b91c1c', marginBottom: 8 }}>{error}</div>}
          {!ok ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#9ca3af' }}>{track ? 'No location data recorded for this trip.' : 'Loading…'}</div>
          ) : (
            <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 10 }}>
              <text x={W - 12} y={20} textAnchor="end" fontSize="11" fill="#9ca3af">N ↑ · not to a fixed scale</text>
              {path && <path d={path} fill="none" stroke="#1a56db" strokeWidth="3" strokeOpacity=".7" strokeLinejoin="round" strokeLinecap="round" />}
              {dashed && <path d={dashed} fill="none" stroke="#94a3b8" strokeWidth="2" strokeDasharray="6 5" />}
              {markers.map((m, i) => {
                const [x, y] = project(Number(m.lat), Number(m.lng));
                return (
                  <g key={i}>
                    <title>{`${m.label}${m.at ? ` · ${formatNepalTime(m.at)}` : ''}${m.sub ? ` · ${m.sub}` : ''}`}</title>
                    <circle cx={x} cy={y} r="12" fill={COLORS[m.kind]} stroke="#fff" strokeWidth="2.5" />
                    <text x={x} y={y + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff">{i + 1}</text>
                  </g>
                );
              })}
            </svg>
          )}

          {markers.length > 0 && (
            <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 6 }}>
              {markers.map((m, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12.5 }}>
                  <span style={{ background: COLORS[m.kind], color: '#fff', borderRadius: '50%', width: 20, height: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{i + 1}</span>
                  <span><b>{m.label}</b>{m.at ? ` · ${formatNepalTime(m.at)}` : ''}{m.sub ? <span style={{ color: '#6b7280' }}> · {m.sub}</span> : null}</span>
                </div>
              ))}
            </div>
          )}

          {legs.length > 0 && (
            <div style={{ marginTop: 14, borderTop: '2px solid #d1d5db', background: '#f1f5f9', padding: '8px 10px', fontSize: 12.5 }}>
              <div style={{ fontWeight: 700, color: '#374151', marginBottom: 4 }}>Legs · total {totalKm.toFixed(1)} km</div>
              {legs.map((l, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, justifyContent: 'space-between' }}>
                  <span>{l.text}</span>
                  <span style={{ color: '#374151', whiteSpace: 'nowrap' }}>
                    {l.km != null ? `${Number(l.km).toFixed(1)} km ${l.tracked ? '(GPS route)' : '(est.)'}` : '—'}{l.min != null ? ` · ${l.min}m` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TripRouteMap;
