import React, { useEffect, useState } from 'react';
import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import useDateFormat from '../hooks/useDateFormat.js';
import { getNepalTodayISO } from '../utils/dateUtils.js';
import { Empty, Spinner, useMT } from './kit.jsx';

/* My duty roster: the shifts assigned to me, current and upcoming first.
   Opening the page marks the "Duty roster ..." notices as read, which clears the red dot on Home. */
const hm = (v) => {
  const s = String(v || '').slice(0, 5); if (!s) return '';
  const [h, m] = s.split(':').map(Number); if (isNaN(h)) return s;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
const asList = (v) => (Array.isArray(v) ? v : []);

export default function MobileRoster() {
  const mt = useMT();
  const fd = useDateFormat();
  const { currentUser } = useAuth();
  const [rows, setRows] = useState(null);
  const [shifts, setShifts] = useState({});
  const [err, setErr] = useState('');
  const today = getNepalTodayISO();

  useEffect(() => {
    api.get('/shifts').then(r => setShifts(Object.fromEntries((Array.isArray(r) ? r : []).map(s => [String(s.id), s])))).catch(() => {});
    api.get('/duty-roster').then(r => { setRows(Array.isArray(r) ? r : []); setErr(''); }).catch(e => { setErr(e.message || 'Could not load'); setRows([]); });
    api.get('/messages').then(r => {
      (Array.isArray(r) ? r : []).filter(m => !m.is_read && /^duty roster/i.test(m.subject || ''))
        .forEach(m => api.put(`/messages/${m.id}/read`, {}).catch(() => {}));
    }).catch(() => {});
  }, []);

  const mine = (rows || [])
    .filter(r => String(r.employeeDbId) === String(currentUser?.id) && String(r.dateTo || '').slice(0, 10) >= today)
    .sort((a, b) => String(a.dateFrom).localeCompare(String(b.dateFrom)));

  return (
    <div style={{ padding: '4px 12px 12px' }}>
      {rows === null && <div className="m-empty"><Spinner dark /></div>}
      {err && <div className="m-err">{err}</div>}
      {rows && !err && mine.length === 0 && <Empty text={mt('No duty roster assigned')} />}
      {mine.map((r, i) => {
        const from = String(r.dateFrom).slice(0, 10), to = String(r.dateTo).slice(0, 10);
        const now = from <= today && to >= today;
        const ids = asList(r.shiftIds).length ? asList(r.shiftIds) : (r.shiftId ? [r.shiftId] : []);
        const list = ids.map(id => shifts[String(id)]).filter(Boolean);
        const off = [...asList(r.offDays), ...asList(r.dayOffDays), ...asList(r.nightOffDays)];
        return (
          <div key={r.id} className={`m-roster m-z${i % 2}`}>
            <div className="m-row" style={{ marginBottom: 6 }}>
              <b className="m-grow">{from === to ? fd(from) : `${fd(from)} → ${fd(to)}`}</b>
              {now && <span className="m-chip ok">{mt('Current')}</span>}
            </div>
            {(list.length ? list : [{ name: r.shiftName, startTime: r.startTime, endTime: r.endTime, id: 'x' }]).filter(s => s.name).map(s => (
              <div key={s.id} className="m-roster-shift">
                <span className="m-grow">{s.name}</span>
                <span className="m-muted">{hm(s.startTime)}{s.endTime ? ' – ' + hm(s.endTime) : ''}</span>
              </div>
            ))}
            {off.length > 0 && <div className="m-muted" style={{ marginTop: 4 }}>{mt('Off days')}: {off.map(d => String(d).slice(0, 10)).join(', ')}</div>}
          </div>
        );
      })}
    </div>
  );
}
