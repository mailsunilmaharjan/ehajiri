import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useData } from '../context/DataContext.jsx';
import { StaffStatusList, useStaffToday } from './MobileStaff.jsx';
import { Empty, Sheet, useMT } from './kit.jsx';

/* Today's company summary for Admin / Branch Manager / Department Head (the roles the website dashboard shows
   "Overview Statistics" to): Total staff with male / female, Present, Absent, Late in, Early out, On leave, On office visit.
   Same numbers and the same scope as the website — /attendance/daily for today, narrowed to the manager's own team. */
const tm = (v) => { if (!v) return '–'; const t = String(v); if (/^[0-9]{2}:[0-9]{2}/.test(t)) return t.slice(0, 5); const d = new Date(v); return isNaN(d) ? t.slice(0, 5) : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }); };

export default function MobileSummary() {
  const mt = useMT();
  const { currentUser, isEmployee } = useAuth();
  const { employees } = useData();
  const [open, setOpen] = useState(null);   // which tile's report is open
  const today = useStaffToday();            // today's attendance rows + field-visit trips + where everyone is
  const rows = today.loaded ? today.rows : (today.rows.length ? today.rows : null);

  if (isEmployee || !currentUser) return null;

  const active = (employees || []).filter(e => e.active);
  const g = Object.fromEntries((employees || []).map(e => [e.id, e.gender]));
  const mf = (list) => ({ m: list.filter(r => g[r.id] === 'male').length, f: list.filter(r => g[r.id] === 'female').length });
  const R = rows || [];
  const present = R.filter(r => r.status === 'Present');
  const absent = R.filter(r => r.status === 'Absent');
  const late = R.filter(r => r.lateIn && r.lateIn.startsWith('Late By'));
  const early = R.filter(r => r.earlyOut && r.earlyOut.startsWith('Early Out'));
  const leave = R.filter(r => r.hasLeave);
  const visit = R.filter(r => r.hasVisit);
  const v = (n) => (rows === null ? '…' : n);
  const cards = [
    { k: 'Total Staff', n: active.length, ic: '👥', bg: '#fff7ed', bd: '#fed7aa', split: mf(active), always: true, list: active, total: true },
    { k: 'Present', n: present.length, ic: '✅', bg: '#f0fdf4', bd: '#bbf7d0', split: mf(present), list: present },
    { k: 'Absent', n: absent.length, ic: '❌', bg: '#fff5f5', bd: '#fecaca', split: mf(absent), list: absent },
    { k: 'Late in', n: late.length, ic: '⏰', bg: '#eff6ff', bd: '#bfdbfe', split: mf(late), list: late },
    { k: 'Early out', n: early.length, ic: '🏃', bg: '#fefce8', bd: '#fde68a', split: mf(early), list: early },
    { k: 'On Leave', n: leave.length, ic: '🌴', bg: '#f5f3ff', bd: '#ddd6fe', list: leave },
    { k: 'Office Visit', n: visit.length, ic: '🏢', bg: '#f0fdfa', bd: '#99f6e4', list: visit },
  ];
  const tot = mf(active);
  return (
    <div className="m-dcard">
      <div className="m-dcard-h"><b>{mt('Today’s Summary')}</b>
        <span className="m-muted" style={{ fontSize: 12 }}>
          {mt('Male')} {tot.m} · {mt('Female')} {tot.f}
        </span></div>
      <div className="m-sumgrid">
        {cards.map(c => (
          <button key={c.k} type="button" className="m-sumcard" style={{ background: c.bg, borderColor: c.bd }} onClick={() => setOpen(c)}>
            <span className="m-sum-ic">{c.ic}</span>
            <b>{c.always ? c.n : v(c.n)}</b>
            <span className="m-sum-l">{mt(c.k)}</span>
            {c.split && rows !== null && <span className="m-sum-mf">{mt('M')} {c.split.m} · {mt('F')} {c.split.f}</span>}
          </button>
        ))}
      </div>
      {open && (
        <Sheet title={`${open.ic} ${mt(open.k)} · ${open.list.length}`} onClose={() => setOpen(null)} footer={<button className="m-btn" onClick={() => setOpen(null)}>{mt('Close')}</button>}>
          {open.total && <StaffStatusList people={active} {...today} />}
          {!open.total && open.list.length === 0 && <Empty text={mt('Nothing here yet')} />}
          {!open.total && open.list.map((r, i) => (
            <div key={(r.id ?? i) + '-' + i} className="m-mini" style={{ cursor: 'default' }}>
              <span className="m-grow" style={{ minWidth: 0 }}>
                <b className="m-ell" style={{ display: 'block' }}>{r.fullName || r.employeeName}</b>
                <span className="m-muted m-ell" style={{ display: 'block', fontSize: 12 }}>{[r.postFull || r.position, r.department].filter(Boolean).join(' · ')}</span>
              </span>
              <span style={{ textAlign: 'right', fontSize: 12 }}>
                {!open.total && (r.timeIn || r.timeOut) && <span style={{ display: 'block' }}>{tm(r.timeIn)} – {tm(r.timeOut)}</span>}
                {open.k === 'Late in' && <span className="m-pill warn">{r.lateIn}</span>}
                {open.k === 'Early out' && <span className="m-pill bad">{r.earlyOut}</span>}
              </span>
            </div>
          ))}
        </Sheet>
      )}
    </div>
  );
}

/* Dashboard "Field Visit": who has gone out of the office on a field trip today (checked out from Office, or went straight to a
   client) — where they are now, or when they came back. */
export function FieldVisitCard() {
  const mt = useMT();
  const { isEmployee, currentUser } = useAuth();
  const { sessions, loaded } = useStaffToday();
  if (isEmployee || !currentUser) return null;
  const hhmm = (v) => (v ? new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }) : '');
  const list = [...sessions].sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) || String(a.officeOutAt).localeCompare(String(b.officeOutAt)));
  const out = list.filter(x => x.status === 'active').length;
  return (
    <div className="m-dcard">
      <div className="m-dcard-h"><b>🚗 {mt('Field Visit')}</b><span className="m-muted" style={{ fontSize: 12 }}>{loaded ? `${mt('Out now')} ${out} · ${mt('Today')} ${list.length}` : '…'}</span></div>
      {loaded && list.length === 0 && <div className="m-muted">{mt('No one has gone for a field visit today')}</div>}
      {list.map(x => {
        const stops = x.stops || [];
        const last = stops[stops.length - 1];
        const at = last ? (last.checkInClientName || last.customerName || last.taskTitle) : '';
        const state = x.status !== 'active' ? `${mt('Back at office')} ${hhmm(x.officeInAt)}`
          : last && last.checkInAt && !last.checkOutAt ? `📍 ${mt('Checked in')} ${hhmm(last.checkInAt)}${at ? ' · ' + at : ''}`
          : last && !last.checkInAt ? `➡️ ${mt('Moving here')}${at ? ': ' + at : ''}`
          : `${mt('On the way')}`;
        const done = stops.filter(z => z.checkOutAt).length;
        return (
          <div key={x.id} className="m-mini" style={{ cursor: 'default', opacity: x.status === 'active' ? 1 : .7 }}>
            <span className="m-grow" style={{ minWidth: 0 }}>
              <b className="m-ell" style={{ display: 'block' }}>{x.employeeName}</b>
              <span className="m-muted" style={{ display: 'block', fontSize: 12 }}>{mt('Left office')} {hhmm(x.officeOutAt)} · {state}</span>
            </span>
            <span className="m-pill ok">{done}/{stops.length}</span>
          </div>
        );
      })}
    </div>
  );
}
