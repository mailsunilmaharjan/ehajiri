import React, { useEffect, useMemo, useState } from 'react';
import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useData } from '../context/DataContext.jsx';
import Avatar from '../components/Common/Avatar.jsx';
import { getNepalTodayISO } from '../utils/dateUtils.js';
import { Empty, Spinner, useMT } from './kit.jsx';

/* Where is everyone right now — Office | Field Visit | On Leave | On Office Visit.
   Data = today's daily attendance (leave / office-visit flags, same scope as the website) + today's field-visit trips.
   Priority when someone is more than one: On Leave > On Office Visit > Field Visit > Office. */

export const STATUS = {
  office:   { label: 'Office',          chip: { background: '#dcfce7', color: '#166534' }, icon: '🏢' },
  field:    { label: 'Field Visit',     chip: { background: '#dbeafe', color: '#1e40af' }, icon: '🚗' },
  leave:    { label: 'On Leave',        chip: { background: '#ede9fe', color: '#5b21b6' }, icon: '🌴' },
  visit:    { label: 'On Office Visit', chip: { background: '#ccfbf1', color: '#115e59' }, icon: '🧳' },
};
const hhmm = (v) => { if (!v) return ''; const d = new Date(v); return isNaN(d) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }); };

/** rows = today's daily attendance rows, sessions = today's field-visit trips (null while loading). */
export function useStaffToday() {
  const { currentUser, isEmployee, isBranchManager, isDeptHead } = useAuth();
  const [rows, setRows] = useState(null);
  const [sessions, setSessions] = useState(null);
  const today = getNepalTodayISO();
  const scoped = isBranchManager || isDeptHead;
  useEffect(() => {
    if (!currentUser || isEmployee) return;
    api.get(`/attendance/daily?date=${today}${scoped ? '&orgScope=1' : ''}`).then(d => setRows(d.rows || [])).catch(() => setRows([]));
    api.get(`/field-visit/report?startDate=${today}&endDate=${today}`).then(d => setSessions(d?.sessions || [])).catch(() => setSessions([]));
  }, [currentUser?.id, isEmployee, scoped, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const loaded = rows !== null && sessions !== null;
  const status = useMemo(() => {
    const m = {};
    (rows || []).forEach(r => { m[r.id] = r.hasLeave ? 'leave' : r.hasVisit ? 'visit' : 'office'; });
    (sessions || []).forEach(s => { if (s.status === 'active' && m[s.employeeId] !== 'leave' && m[s.employeeId] !== 'visit') m[s.employeeId] = 'field'; });
    return m;
  }, [rows, sessions]);
  return { rows: rows || [], sessions: sessions || [], loaded, status };
}

/** The list itself — filter chips, search, and a status badge on every person. */
export function StaffStatusList({ people, status, rows, sessions, loaded, initial = 'all' }) {
  const mt = useMT();
  const [f, setF] = useState(initial);
  const [q, setQ] = useState('');
  const byRow = Object.fromEntries((rows || []).map(r => [r.id, r]));
  const trip = {}; (sessions || []).forEach(s => { if (!trip[s.employeeId] || s.status === 'active') trip[s.employeeId] = s; });
  const st = (e) => status[e.id] || 'office';
  const counts = { all: people.length };
  Object.keys(STATUS).forEach(k => { counts[k] = people.filter(e => st(e) === k).length; });
  const list = people.filter(e => (f === 'all' || st(e) === f) && (!q.trim() || [e.fullName, e.employeeId, e.position, e.department].filter(Boolean).join(' ').toLowerCase().includes(q.trim().toLowerCase())));
  return (<>
    <div className="m-row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
      {[['all', 'All'], ...Object.entries(STATUS).map(([k, v]) => [k, v.label])].map(([k, l]) => (
        <button key={k} type="button" className={`m-chip ${f === k ? 'ok' : 'gray'}`} style={{ border: 0, padding: '7px 11px', fontSize: 12.5 }} onClick={() => setF(k)}>
          {mt(l)} {loaded ? counts[k] : ''}
        </button>
      ))}
    </div>
    <input className="m-input" placeholder={`🔍 ${mt('Search')}`} value={q} onChange={e => setQ(e.target.value)} style={{ marginBottom: 8 }} />
    {!loaded && <div className="m-empty"><Spinner dark /></div>}
    {loaded && list.length === 0 && <Empty icon="👥" text={mt('Nothing here yet')} />}
    {list.map(e => {
      const s = STATUS[st(e)]; const r = byRow[e.id]; const t = trip[e.id];
      const sub = st(e) === 'field' && t ? `${mt('Out since')} ${hhmm(t.officeOutAt)}` : st(e) === 'office' && r?.timeIn ? `${mt('In')} ${String(r.timeIn).slice(0, 5)}` : '';
      return (
        <div key={e.id} className="m-mini" style={{ cursor: 'default' }}>
          <Avatar photo={e.profilePhoto} name={e.fullName} size={36} preview={false} />
          <span className="m-grow" style={{ minWidth: 0 }}>
            <b className="m-ell" style={{ display: 'block' }}>{e.fullName}</b>
            <span className="m-muted m-ell" style={{ display: 'block', fontSize: 12 }}>{[e.position, e.department].filter(Boolean).join(' · ')}</span>
          </span>
          <span style={{ textAlign: 'right' }}>
            <span className="m-chip" style={s.chip}>{s.icon} {mt(s.label)}</span>
            {sub && <span className="m-jsub" style={{ display: 'block' }}>{sub}</span>}
          </span>
        </div>
      );
    })}
  </>);
}

/* The Staff screen (More → Staff): everyone in my scope, with where they are today. */
export default function MobileStaff() {
  const { employees } = useData();
  const today = useStaffToday();
  const people = (employees || []).filter(e => e.active);
  return (
    <div style={{ padding: '4px 12px 12px' }}>
      <StaffStatusList people={people} {...today} />
    </div>
  );
}
