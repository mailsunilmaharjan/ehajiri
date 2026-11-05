import React, { useEffect, useMemo, useState } from 'react';
import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useSettings } from '../context/SettingsContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import useDateFormat from '../hooks/useDateFormat.js';
import { adToBS, BS_MONTHS_EN, BS_MONTHS_NP, toNepaliDigits, getNepalTodayISO } from '../utils/dateUtils.js';
import { Empty, Icon, Spinner, useMT } from './kit.jsx';
import { monthRange } from './hooks.js';
import { useNavigate } from 'react-router-dom';
import { useModuleFlags } from '../context/ModuleFlagsContext.jsx';
import Directory from './MobileDirectory.jsx';
import Avatar from '../components/Common/Avatar.jsx';
import { StaffScopeBar, useStaffScope, DEFAULT_SCOPE } from './MobileScope.jsx';

/* Attendance on the phone: a menu of report types (Monthly Ledger, Summary, Present / Absent, IN & OUT, Late / Early, Absent days,
   Overtime). Every report is built from the same staff ledger the website's reports use, for the month you pick. */

const hhmm = (v) => { if (!v) return '–'; const d = new Date(v); return isNaN(d) ? String(v).slice(0, 5) : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }); };
const KIND = (s = '') => {
  const x = String(s).toLowerCase();
  if (x === 'present') return ['ok', 'Present'];
  if (x === 'absent') return ['bad', 'Absent'];
  if (x.includes('holiday')) return ['info', 'Holiday'];
  if (x.includes('weekend') || x.includes('off')) return ['gray', 'Weekend'];
  if (x.includes('visit')) return ['info', 'Office Visit'];
  return ['warn', s];     // leave types and anything else
};
const hm = (mins) => { const m = Math.round(Number(mins) || 0); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };
const cleanLate = (s = '') => String(s).replace(/^(Late By|Late In|Early Out|Early By)\s*/i, '');

const REPORTS = [
  { key: 'ledger',  icon: '📒', bg: '#e8f0ff', title: 'Monthly Ledger',      sub: 'Day by day record' },
  { key: 'summary', icon: '📊', bg: '#e6f7ee', title: 'Summary',             sub: 'Totals and attendance rate' },
  { key: 'pa',      icon: '🗓️', bg: '#fff3dc', title: 'Present / Absent',    sub: 'Calendar colours' },
  { key: 'inout',   icon: '🕘', bg: '#efe9ff', title: 'IN & OUT',            sub: 'Check in and out times' },
  { key: 'late',    icon: '⏰', bg: '#ffeaea', title: 'Late in and Early out', sub: 'Days you were late or left early' },
  { key: 'absent',  icon: '🚫', bg: '#ffe9ef', title: 'Absent Days',         sub: 'Days marked absent' },
  { key: 'ot',      icon: '⚡', bg: '#e3f6f8', title: 'Overtime',            sub: 'Approved and worked extra hours' },
  { key: 'roster',   icon: '🗓️', bg: '#e0e7ff', title: 'Duty Roster', sub: 'Your shifts and off days', page: 'dutyRoster', flag: 'dutyRosterEnabled' },
  { key: 'staff',    icon: '👥', bg: '#e8f0ff', title: 'Staff',       sub: 'Staff directory',          dir: true },
  { key: 'contacts', icon: '📇', bg: '#ccfbf1', title: 'Contacts',    sub: 'Customers and contacts',   dir: true, page: 'staffContact' },
  { key: 'notes',    icon: '📝', bg: '#fef3c7', title: 'Notes',       sub: 'Your notes',               dir: true, page: 'myNotes' },
];

export default function MobileAttendance() {
  const mt = useMT();
  const fd = useDateFormat();
  const { currentUser, canView } = useAuth();
  const { flags } = useModuleFlags();
  const navigate = useNavigate();
  const menu = REPORTS.filter(r => (!r.page || canView(r.page)) && (!r.flag || flags[r.flag]));
  const { settings } = useSettings();
  const { language } = useLanguage();
  const [scope, setScope] = useState(DEFAULT_SCOPE);
  const SS = useStaffScope();
  const emp = scope.emp === 'me' ? currentUser : (SS.byId[String(scope.emp)] || currentUser);
  const [type, setType] = useState(null);       // null = report menu
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [pickDay, setPickDay] = useState(null);
  const cal = settings.defaultCalendar === 'np' ? 'np' : 'en';
  const range = useMemo(() => monthRange(offset, cal), [offset, cal]);
  const today = getNepalTodayISO();

  useEffect(() => {
    if (!type || REPORTS.find(r => r.key === type)?.dir) return undefined;
    let live = true;
    setData(null); setErr(''); setPickDay(null);
    api.get(`/attendance/staff-ledger?employeeId=${emp.id}&startDate=${range.start}&endDate=${range.end}`)
      .then(r => { if (live) setData(r); }).catch(e => { if (live) setErr(e.message || 'Could not load'); });
    return () => { live = false; };
  }, [type, emp.id, range.start, range.end]);

  const label = cal === 'np'
    ? `${(language === 'np' ? BS_MONTHS_NP : BS_MONTHS_EN)[range.bs.month - 1]} ${language === 'np' ? toNepaliDigits(range.bs.year) : range.bs.year}`
    : new Date(range.ad.year, range.ad.month, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const s = data?.summary || {};
  const days = data?.days || [];
  const dayNum = (d) => { const dt = new Date(d.dateStr + 'T00:00:00'); const n = cal === 'np' ? (adToBS(d.dateStr)?.day ?? dt.getDate()) : dt.getDate(); return language === 'np' && cal === 'np' ? toNepaliDigits(n) : n; };
  const wd = (d) => new Date(d.dateStr + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short' });
  const isOff = (d) => { const [c] = KIND(d.status); return d.isWeekend || c === 'gray' || c === 'info'; };
  const Day = ({ d }) => <div className={`m-day${isOff(d) ? ' off' : ''}`}><b>{dayNum(d)}</b><span>{wd(d)}</span></div>;
  const none = <Empty icon="🗓️" text={mt('No records this month')} />;

  /* ---------- report bodies ---------- */
  const TONE = { ok: ['#dcfce7', '#166534'], bad: ['#fee2e2', '#991b1b'], warn: ['#fef3c7', '#92400e'], info: ['#dbeafe', '#1e40af'], gray: ['#eceff4', '#6b7280'] };
  const Ledger = () => {
    const rate = s.attendanceRate ?? 0;
    const chips = [['Present', s.presentCount, 'ok'], ['Absent', s.absentCount, 'bad'], ['Leave', s.leaveCount, 'warn'], ['Late in', s.lateCount, 'warn'], ['Early out', s.earlyCount, 'bad']];
    return (<>
      <div className="m-lhero">
        <div className="m-row" style={{ gap: 10 }}>
          <Avatar photo={emp.profilePhoto} name={emp.fullName} size={42} preview={false} />
          <div className="m-grow" style={{ minWidth: 0 }}><b className="m-ell" style={{ display: 'block', fontSize: 16 }}>{emp.fullName}</b><span className="m-muted m-ell" style={{ display: 'block', fontSize: 12.5 }}>{[emp.position, emp.department].filter(Boolean).join(' · ')}</span></div>
          <div className="m-lrate"><b>{rate}%</b><span>{mt('Attendance')}</span></div>
        </div>
        <div className="m-bar"><div style={{ width: `${Math.min(100, rate)}%` }} /></div>
        <div className="m-lchips">{chips.map(([k, v, tn]) => <span key={k} className={`m-lchip ${tn}`}><b>{v ?? 0}</b>{mt(k)}</span>)}</div>
        <div className="m-muted" style={{ fontSize: 12.5 }}>⏱ {mt('Worked')} <b>{hm(s.totalMins)}</b> · {mt('Working days')} {s.totalWorkingDays ?? 0}{s.otApprovedFormatted ? ` · OT ${s.otApprovedFormatted}` : ''}</div>
      </div>
      {days.length === 0 && none}
      {days.map(d => {
        const [c, text] = KIND(d.status); const off = isOff(d) && !d.timeIn;
        const [bg, fg] = TONE[c] || TONE.gray;
        const badges = [d.lateFormatted && ['warn', `${mt('Late in')} ${cleanLate(d.lateFormatted)}`], d.earlyFormatted && ['bad', `${mt('Early out')} ${cleanLate(d.earlyFormatted)}`], d.otFormatted && ['info', `OT ${d.otFormatted}`]].filter(Boolean);
        return (
          <div key={d.dateStr} className={`m-lday${off ? ' off' : ''}${d.dateStr === today ? ' today' : ''}`} data-st={c}>
            <div className="m-ltile" style={{ background: bg, color: fg }}><b>{dayNum(d)}</b><span>{wd(d)}</span></div>
            <div className="m-grow" style={{ minWidth: 0 }}>
              <div className="m-row" style={{ gap: 6 }}><b style={{ color: fg }}>{c === 'warn' ? text : mt(text)}</b>{d.dateStr === today && <span className="m-chip info">{mt('Today')}</span>}</div>
              {d.timeIn
                ? <div className="m-ltimes"><span>↘ {hhmm(d.timeIn)}</span><span>↗ {d.timeOut ? hhmm(d.timeOut) : '—'}</span>{d.totalFormatted && <span className="m-lwork">⏱ {d.totalFormatted}</span>}</div>
                : (!off && <div className="m-muted" style={{ fontSize: 12.5 }}>{mt('No punch')}</div>)}
              {badges.length > 0 && <div className="m-lbadges">{badges.map(([tn, l], i) => <span key={i} className={`m-chip ${tn}`}>{l}</span>)}</div>}
            </div>
          </div>
        );
      })}
    </>);
  };

  const Summary = () => {
    const tiles = [
      ['Working days', s.totalWorkingDays ?? 0, '#1d4ed8', '#e8f0ff'], ['Present', s.presentCount ?? 0, '#166534', '#e6f7ee'],
      ['Absent', s.absentCount ?? 0, '#991b1b', '#ffe9e9'], ['Leave', s.leaveCount ?? 0, '#92400e', '#fff3dc'],
      ['Office Visit', s.visitCount ?? 0, '#0f766e', '#e0f5f2'], ['Late in', s.lateCount ?? 0, '#9a3412', '#ffeede'],
      ['Early out', s.earlyCount ?? 0, '#9f1239', '#ffe8ee'], ['Worked', hm(s.totalMins), '#5b21b6', '#efe9ff'],
    ];
    return (<>
      <div className="m-sumgrid">{tiles.map(([k, v, fg, bg]) => <div key={k} className="m-sumtile" style={{ background: bg }}><b style={{ color: fg }}>{v}</b><span>{mt(k)}</span></div>)}</div>
      <div className="m-card" style={{ padding: 14 }}>
        <div className="m-row"><span className="m-grow m-muted">{mt('Attendance')}</span><b>{s.attendanceRate ?? 0}%</b></div>
        <div className="m-bar"><div style={{ width: `${Math.min(100, s.attendanceRate || 0)}%` }} /></div>
        <div className="m-muted" style={{ marginTop: 6 }}>{(s.presentCount ?? 0) + (s.leaveCount ?? 0)} / {s.totalWorkingDays ?? 0} {mt('days')}</div>
      </div>
      <div className="m-card" style={{ padding: '4px 14px' }}>
        <div className="m-kv"><span>{mt('Overtime')}</span><b>{s.otApprovedFormatted || s.otFormatted || '0:00'}</b></div>
      </div>
    </>);
  };

  const PresentAbsent = () => {
    const first = days[0] ? new Date(days[0].dateStr + 'T00:00:00').getDay() : 0;
    const col = (d) => { const [c] = KIND(d.status); return d.dateStr > today ? 'future' : c; };
    const sel = days.find(d => d.dateStr === pickDay);
    return (<>
      <div className="m-card" style={{ padding: 12 }}>
        <div className="m-cal7 m-cal7h">{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w, i) => <span key={i}>{w}</span>)}</div>
        <div className="m-cal7">
          {Array.from({ length: first }).map((_, i) => <span key={'b' + i} />)}
          {days.map(d => (
            <button key={d.dateStr} className={`m-cd ${col(d)}${pickDay === d.dateStr ? ' sel' : ''}${d.dateStr === today ? ' today' : ''}`} onClick={() => setPickDay(d.dateStr)}>{dayNum(d)}</button>
          ))}
        </div>
        <div className="m-legend">
          {[['ok', 'Present'], ['bad', 'Absent'], ['warn', 'Leave'], ['info', 'Holiday'], ['gray', 'Weekend']].map(([c, l]) => <span key={c}><i className={`m-cd ${c}`} />{mt(l)}</span>)}
        </div>
      </div>
      {sel && (() => { const [c, text] = KIND(sel.status); return (
        <div className="m-card" style={{ padding: 14 }}>
          <div className="m-row"><b className="m-grow">{fd(sel.dateStr)} · {wd(sel)}</b><span className={`m-chip ${c}`}>{c === 'warn' ? text : mt(text)}</span></div>
          {sel.timeIn && <div style={{ marginTop: 6 }}>{hhmm(sel.timeIn)} – {hhmm(sel.timeOut)}{sel.totalFormatted ? ` · ${sel.totalFormatted}` : ''}</div>}
          {sel.remarks && <div className="m-muted" style={{ marginTop: 4, fontSize: 12.5 }}>{sel.remarks}</div>}
        </div>); })()}
      <div className="m-stats m-cols3">
        <div className="m-stat"><b style={{ color: 'var(--m-ok)' }}>{s.presentCount ?? 0}</b><span>{mt('Present')}</span></div>
        <div className="m-stat"><b style={{ color: 'var(--m-bad)' }}>{s.absentCount ?? 0}</b><span>{mt('Absent')}</span></div>
        <div className="m-stat"><b style={{ color: 'var(--m-warn)' }}>{s.leaveCount ?? 0}</b><span>{mt('Leave')}</span></div>
      </div>
    </>);
  };

  const InOut = () => {
    const rows = days.filter(d => d.timeIn || d.timeOut);
    return (
      <div className="m-card m-flat">
        {rows.length === 0 && none}
        {rows.length > 0 && <div className="m-thead"><span style={{ width: 46 }} /><span className="m-grow">{mt('In')}</span><span className="m-grow">{mt('Out')}</span><span style={{ width: 54, textAlign: 'right' }}>{mt('Worked')}</span></div>}
        {rows.map(d => (
          <div key={d.dateStr} className="m-list-item" data-st={KIND(d.status)[0]} style={{ cursor: 'default' }}>
            <Day d={d} />
            <b className="m-grow" style={{ fontSize: 14 }}>{hhmm(d.timeIn)}</b>
            <b className="m-grow" style={{ fontSize: 14 }}>{hhmm(d.timeOut)}</b>
            <span style={{ width: 54, textAlign: 'right', fontSize: 13 }} className="m-muted">{d.totalFormatted || '–'}</span>
          </div>
        ))}
      </div>
    );
  };

  const LateEarly = () => {
    const rows = days.filter(d => d.lateMins > 0 || d.earlyMins > 0);
    return (<>
      <div className="m-stats m-cols2">
        <div className="m-stat" style={{ background: '#ffeede' }}><b style={{ color: '#9a3412' }}>{s.lateCount ?? 0}</b><span>{mt('Late in')}</span></div>
        <div className="m-stat" style={{ background: '#ffe8ee' }}><b style={{ color: '#9f1239' }}>{s.earlyCount ?? 0}</b><span>{mt('Early out')}</span></div>
      </div>
      <div className="m-card m-flat">
        {rows.length === 0 && none}
        {rows.map(d => (
          <div key={d.dateStr} className="m-list-item" data-st={KIND(d.status)[0]} style={{ cursor: 'default' }}>
            <Day d={d} />
            <div className="m-grow"><b style={{ fontSize: 14 }}>{hhmm(d.timeIn)} – {hhmm(d.timeOut)}</b></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
              {d.lateMins > 0 && <span className="m-chip warn">{mt('Late in')} {cleanLate(d.lateFormatted) || `${d.lateMins}m`}</span>}
              {d.earlyMins > 0 && <span className="m-chip bad">{mt('Early out')} {cleanLate(d.earlyFormatted) || `${d.earlyMins}m`}</span>}
            </div>
          </div>
        ))}
      </div>
    </>);
  };

  const AbsentDays = () => {
    const rows = days.filter(d => d.status === 'Absent' && d.dateStr <= today);
    return (<>
      <div className="m-stats m-cols1"><div className="m-stat" style={{ background: '#ffe9e9' }}><b style={{ color: '#991b1b' }}>{rows.length}</b><span>{mt('Absent')}</span></div></div>
      <div className="m-card m-flat">
        {rows.length === 0 && none}
        {rows.map(d => (
          <div key={d.dateStr} className="m-list-item" data-st={KIND(d.status)[0]} style={{ cursor: 'default' }}>
            <Day d={d} /><div className="m-grow"><b>{fd(d.dateStr)}</b></div><span className="m-chip bad">{mt('Absent')}</span>
          </div>
        ))}
      </div>
    </>);
  };

  const Overtime = () => {
    const rows = days.filter(d => d.otApprovedMins > 0 || d.otMins > 0);
    return (<>
      <div className="m-stats m-cols1"><div className="m-stat" style={{ background: '#e3f6f8' }}><b style={{ color: '#0e7490' }}>{s.otApprovedFormatted || s.otFormatted || '0:00'}</b><span>{mt('Overtime')}</span></div></div>
      <div className="m-card m-flat">
        {rows.length === 0 && none}
        {rows.map(d => (
          <div key={d.dateStr} className="m-list-item" data-st={KIND(d.status)[0]} style={{ cursor: 'default' }}>
            <Day d={d} />
            <div className="m-grow"><b style={{ fontSize: 14 }}>{hhmm(d.timeIn)} – {hhmm(d.timeOut)}</b></div>
            <span className={`m-chip ${d.otApprovedMins > 0 ? 'ok' : 'gray'}`}>{d.otApprovedFormatted || d.otFormatted}{d.otApprovedMins > 0 ? ' ✓' : ''}</span>
          </div>
        ))}
      </div>
    </>);
  };

  const BODY = { ledger: Ledger, summary: Summary, pa: PresentAbsent, inout: InOut, late: LateEarly, absent: AbsentDays, ot: Overtime };

  /* ---------- the report menu ---------- */
  if (!type) {
    return (<>
      <StaffScopeBar scope={scope} setScope={setScope} />
      <div className="m-h2" style={{ marginTop: 2 }}>{mt('Reports')}</div>
      <div className="m-rgrid">
        {menu.map(r => (
          <button key={r.key} className="m-rcard" onClick={() => (r.key === 'roster' ? navigate('/m/roster') : setType(r.key))}>
            <span className="m-t-ico" style={{ background: r.bg }}>{r.icon}</span>
            <b>{mt(r.title)}</b>
            <small>{mt(r.sub)}</small>
          </button>
        ))}
      </div>
    </>);
  }

  const rep = REPORTS.find(r => r.key === type);
  const Body = BODY[type];
  return (<>
    <div className="m-rhead">
      <button className="m-rback" onClick={() => setType(null)} aria-label={mt('Reports menu')}><Icon name="back" size={20} /></button>
      <span className="m-grow"><span style={{ marginRight: 6 }}>{rep.icon}</span><b>{mt(rep.title)}</b></span>
      <select className="m-rsel" value={type} onChange={e => setType(e.target.value)} aria-label={mt('Reports')}>{menu.filter(r => r.key !== 'roster').map(r => <option key={r.key} value={r.key}>{mt(r.title)}</option>)}</select>
    </div>
    {rep.dir ? <Directory kind={type} /> : (<>
    <StaffScopeBar scope={scope} setScope={setScope} />
    <div className="m-monthbar">
      <button onClick={() => setOffset(o => o - 1)} aria-label="Previous month">‹</button>
      <b>{label}</b>
      <button onClick={() => setOffset(o => o + 1)} disabled={offset >= 0} aria-label="Next month">›</button>
    </div>
    {!data && !err && <div className="m-empty"><Spinner dark /></div>}
    {err && <div className="m-err">{err}</div>}
    {data && <Body />}
    </>)}
  </>);
}
