import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import useDateFormat from '../hooks/useDateFormat.js';
import { getNepalTodayISO, adToBS, BS_MONTHS_EN, BS_MONTHS_NP, toNepaliDigits } from '../utils/dateUtils.js';
import { useSettings } from '../context/SettingsContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { monthRange } from './hooks.js';
import { Empty, Sheet, Spinner, useMT } from './kit.jsx';
import { DateField } from './fields.jsx';
import { ExchangeSheet, ExchangeTab } from './MobileExchange.jsx';
import { useStaffScope } from './MobileScope.jsx';

/* Duty Roster on the phone.
   "My Duty"  : the shifts assigned to me, current and upcoming first (everyone).
   "Team"     : for people who have Duty Roster edit rights (Admin / Branch Admin / Department Head / permitted staff):
                the roster of the staff they manage, add + edit (+ delete with delete rights). The server applies the same
                branch / department scope as the website, so nobody can roster staff outside their own area.
   Opening the page marks the "Duty roster ..." notices as read, which clears the red dot on Home. */
const hm = (v) => {
  const s = String(v || '').slice(0, 5); if (!s) return '';
  const [h, m] = s.split(':').map(Number); if (isNaN(h)) return s;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
const asList = (v) => (Array.isArray(v) ? v : []);
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const shiftIdsOf = (r) => (asList(r.shiftIds).length ? asList(r.shiftIds) : (r.shiftId ? [r.shiftId] : []));

function RosterCard({ r, i, shifts, today, fd, mt, who, onClick }) {
  const from = String(r.dateFrom).slice(0, 10), to = String(r.dateTo).slice(0, 10);
  const now = from <= today && to >= today;
  const list = shiftIdsOf(r).map(id => shifts[String(id)]).filter(Boolean);
  const off = [...asList(r.offDays), ...asList(r.dayOffDays), ...asList(r.nightOffDays)];
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className={`m-roster m-z${i % 2}`} onClick={onClick} style={onClick ? { width: '100%', textAlign: 'left', border: 0, font: 'inherit', display: 'block' } : undefined}>
      {who && <div style={{ marginBottom: 4 }}><b>{r.employeeName}</b>{r.department ? <span className="m-muted"> · {r.department}</span> : null}</div>}
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
      {off.length > 0 && <div className="m-muted" style={{ marginTop: 4 }}>{mt('Off days')}: {[...new Set(off.map(d => String(d).slice(0, 10)))].join(', ')}</div>}
    </Tag>
  );
}

/* Add / edit one roster entry */
function RosterForm({ row, shifts, staff, onClose, onSaved, canDel }) {
  const mt = useMT();
  const { currentUser } = useAuth();
  const today = getNepalTodayISO();
  const [empId, setEmpId] = useState(row ? String(row.employeeDbId) : '');
  const [shiftIds, setShiftIds] = useState(row ? shiftIdsOf(row).map(String) : []);
  const [dateFrom, setDateFrom] = useState(row ? String(row.dateFrom).slice(0, 10) : today);
  const [dateTo, setDateTo] = useState(row ? String(row.dateTo).slice(0, 10) : today);
  const [offDays, setOffDays] = useState(row ? asList(row.offDays) : []);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [sq, setSq] = useState('');
  // ticked shifts always stay in the list; the search only narrows the rest
  const pickable = Object.values(shifts).filter(s => s.active !== false
    && (!sq.trim() || shiftIds.includes(String(s.id)) || String(s.name || '').toLowerCase().includes(sq.trim().toLowerCase())));
  const people = useMemo(() => staff
    .filter(e => !q.trim() || [e.fullName, e.employeeId, e.department].filter(Boolean).join(' ').toLowerCase().includes(q.trim().toLowerCase())).slice(0, 60), [staff, q]);
  const toggleShift = (id) => setShiftIds(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));
  const toggleDay = (d) => setOffDays(p => (p.includes(d) ? p.filter(x => x !== d) : [...p, d]));

  const save = async () => {
    if (!empId) return setErr(mt('Please select a staff member.'));
    if (!shiftIds.length) return setErr(mt('Please select at least one shift.'));
    if (!dateFrom || !dateTo) return setErr(mt('Please set date range.'));
    if (dateTo < dateFrom) return setErr(mt('Date To must be on or after Date From.'));
    setBusy(true); setErr('');
    try {
      const body = {
        shiftIds: shiftIds.map(Number), dateFrom, dateTo, offDays,
        dayOffDays: row ? asList(row.dayOffDays) : [], nightOffDays: row ? asList(row.nightOffDays) : [],
        doubleDuty: !!(row?.doubleDuty && shiftIds.length > 1), replaceOverrides: false,
      };
      if (row) await api.put(`/duty-roster/${row.id}`, body);
      else await api.post('/duty-roster', { ...body, employeeId: Number(empId), createdBy: currentUser?.fullName || currentUser?.username || 'Admin' });
      onSaved();
    } catch (e) { setErr(e?.message || mt('Failed')); setBusy(false); }
  };
  const del = async () => {
    if (!window.confirm(mt('Delete this duty roster entry?'))) return;
    setBusy(true); setErr('');
    try { await api.delete(`/duty-roster/${row.id}`); onSaved(); } catch (e) { setErr(e?.message || mt('Failed')); setBusy(false); }
  };

  return (
    <Sheet title={row ? `🗓️ ${mt('Edit duty roster')}` : `🗓️ ${mt('Add duty roster')}`} onClose={() => !busy && onClose()}
      footer={<><button className="m-btn m-ghost" disabled={busy} onClick={onClose}>{mt('Cancel')}</button>
        <button className="m-btn" disabled={busy} onClick={save}>{busy ? '…' : mt('Save')}</button></>}>
      {err && <div className="m-err">{err}</div>}
      <div className="m-field"><label>{mt('Staff')} <span style={{ color: '#dc2626' }}>*</span></label>
        {row ? <div className="m-input m-locked">{row.employeeName}{row.department ? ` · ${row.department}` : ''}</div> : (<>
          <input className="m-input" placeholder={`🔍 ${mt('Search')}`} value={q} onChange={e => setQ(e.target.value)} style={{ marginBottom: 6 }} />
          <div style={{ maxHeight: 190, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 10 }}>
            {people.length === 0 && <div className="m-muted" style={{ padding: 10 }}>{mt('Nothing here yet')}</div>}
            {people.map(e => (
              <label key={e.id} className="m-check" style={{ padding: '8px 10px', borderBottom: '1px solid #f1f5f9' }}>
                <input type="radio" name="rosterstaff" checked={String(e.id) === empId} onChange={() => setEmpId(String(e.id))} />
                <span>{e.fullName}{e.department ? <small className="m-muted"> · {e.department}</small> : null}</span>
              </label>
            ))}
          </div></>)}
      </div>
      <div className="m-field"><label>{mt('Shifts')} <span style={{ color: '#dc2626' }}>*</span></label>
        <input className="m-input" placeholder={`🔍 ${mt('Search')}`} value={sq} onChange={e => setSq(e.target.value)} style={{ marginBottom: 6 }} />
        {pickable.length === 0 && <div className="m-muted" style={{ padding: 6 }}>{mt('Nothing here yet')}</div>}
        {pickable.map(s => {
          const at = shiftIds.indexOf(String(s.id));
          return (
            <label key={s.id} className="m-check" style={{ padding: '6px 2px' }}>
              <input type="checkbox" checked={at >= 0} onChange={() => toggleShift(String(s.id))} />
              <span>{s.name} <small className="m-muted">{hm(s.startTime)}{s.endTime ? ' – ' + hm(s.endTime) : ''}</small>{at >= 0 && shiftIds.length > 1 ? <b> · #{at + 1}</b> : null}</span>
            </label>
          );
        })}
        {shiftIds.length > 1 && <div className="m-jsub">{mt('Several shifts rotate in the order ticked')}</div>}
      </div>
      <div className="m-row" style={{ gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}><DateField label={mt('Date From')} value={dateFrom} onChange={(v) => { setDateFrom(v); if (dateTo < v) setDateTo(v); }} required /></div>
        <div style={{ flex: 1, minWidth: 0 }}><DateField label={mt('Date To')} value={dateTo} min={dateFrom} onChange={setDateTo} required /></div>
      </div>
      <div className="m-field"><label>{mt('Weekend / Off days')}</label>
        <div className="m-row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {DAYS.map(d => <button key={d} type="button" className={`m-chip ${offDays.includes(d) ? 'ok' : 'gray'}`} style={{ border: 0, padding: '8px 11px', fontSize: 13 }} onClick={() => toggleDay(d)}>{d}</button>)}
        </div>
      </div>
      {row && canDel && <button className="m-btn m-block m-warn" disabled={busy} onClick={del}>🗑️ {mt('Delete')}</button>}
    </Sheet>
  );
}

/* My Duty — day by day for one month (this month first, ‹ › to change month), 1st half (1–15) / 2nd half (16–end) / whole month.
   Opens on the half that today falls in. Months follow the company calendar (Nepali BS or English AD). */
const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/* One colour per kind of day, so the month reads at a glance. */
const KIND = {
  weekend:  { label: 'Weekend',        bg: '#dbeafe', bar: '#2563eb', chip: { background: '#bfdbfe', color: '#1e3a8a' } },
  dayoff:   { label: 'Day Off',        bg: '#ffedd5', bar: '#ea580c', chip: { background: '#fed7aa', color: '#9a3412' } },
  nightoff: { label: 'Night Off',      bg: '#ede9fe', bar: '#7c3aed', chip: { background: '#ddd6fe', color: '#5b21b6' } },
  exchange: { label: 'Exchange Duty',  bg: '#fce7f3', bar: '#db2777', chip: { background: '#fbcfe8', color: '#9d174d' } },
  holiday:  { label: 'Holiday',        bg: '#fef3c7', bar: '#d97706', chip: { background: '#fde68a', color: '#92400e' } },
  leave:    { label: 'Leave',          bg: '#dcfce7', bar: '#16a34a', chip: { background: '#bbf7d0', color: '#166534' } },
};
const kindOf = (d, exchanged) => {
  if (d.isPublicHoliday) return 'holiday';
  if (d.leave) return 'leave';
  if (exchanged) return 'exchange';   // an approved swap wins over the day's own type; the shift names are still listed
  const nm = String(d.shiftName || '') + ' ' + String(d.status || '');
  if (/night\s*off/i.test(nm)) return 'nightoff';
  if (/day\s*off/i.test(nm)) return 'dayoff';
  if (d.isWeekend) return 'weekend';
  return null;
};

function MyDuty({ mt, fd, today, onExchanged }) {
  const { currentUser } = useAuth();
  const { settings } = useSettings();
  const { language } = useLanguage();
  const cal = settings.defaultCalendar === 'np' ? 'np' : 'en';
  const dom = (iso) => (cal === 'np' ? (adToBS(iso)?.day || 0) : Number(String(iso).slice(8, 10)));
  const [off, setOff] = useState(0);
  const [half, setHalf] = useState(() => (dom(today) <= 15 ? 1 : 2));   // 1 | 2 | 0 = whole month
  const [days, setDays] = useState(null); const [err, setErr] = useState('');
  const [exDates, setExDates] = useState(new Set());   // days I swapped through an approved Duty Exchange
  const [ex, setEx] = useState(null);                    // { date, duty } for the exchange sheet
  const [sent, setSent] = useState(false);
  const todayRef = useRef(null);
  const mr = monthRange(off, cal);
  const label = cal === 'np'
    ? `${(language === 'np' ? BS_MONTHS_NP : BS_MONTHS_EN)[mr.bs.month - 1]} ${language === 'np' ? toNepaliDigits(mr.bs.year) : mr.bs.year}`
    : `${EN_MONTHS[mr.ad.month]} ${mr.ad.year}`;

  useEffect(() => {
    if (!currentUser?.id) return;
    setDays(null); setErr('');
    api.get(`/attendance/staff-ledger?employeeId=${currentUser.id}&startDate=${mr.start}&endDate=${mr.end}`)
      .then(r => setDays(r?.days || [])).catch(e => { setErr(e?.message || 'Could not load'); setDays([]); });
  }, [currentUser?.id, mr.start, mr.end]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api.get('/duty-exchange/mine').then(r => setExDates(new Set((Array.isArray(r) ? r : []).filter(x => x.status === 'approved').map(x => x.date)))).catch(() => {});
  }, [sent]);
  useEffect(() => { if (days && todayRef.current) todayRef.current.scrollIntoView({ block: 'center' }); }, [days, half]);

  const shown = (days || []).filter(d => half === 0 || (half === 1 ? dom(d.dateStr) <= 15 : dom(d.dateStr) > 15));
  return (<>
    <div className="m-row" style={{ marginBottom: 8, gap: 8 }}>
      <button className="m-btn m-ghost" style={{ width: 44, padding: 0 }} onClick={() => setOff(o => o - 1)} aria-label="Previous month">‹</button>
      <b className="m-grow" style={{ textAlign: 'center', fontSize: 16 }}>{label}</b>
      <button className="m-btn m-ghost" style={{ width: 44, padding: 0 }} onClick={() => setOff(o => o + 1)} aria-label="Next month">›</button>
    </div>
    <div className="m-seg" style={{ marginBottom: 10 }}>
      {[[1, '1st half'], [2, '2nd half'], [0, 'All month']].map(([k, l]) => <button key={k} className={half === k ? 'on' : ''} onClick={() => setHalf(k)}>{mt(l)}</button>)}
    </div>
    <div className="m-row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
      {['weekend', 'dayoff', 'nightoff', 'exchange'].map(k => <span key={k} className="m-chip" style={KIND[k].chip}>{mt(KIND[k].label)}</span>)}
    </div>
    {sent && <div className="m-okbox" style={{ marginBottom: 8 }}>✅ {mt('Exchange request sent. See the Exchange tab.')}</div>}
    {days === null && <div className="m-empty"><Spinner dark /></div>}
    {err && <div className="m-err">{err}</div>}
    {days && !err && shown.length === 0 && <Empty text={mt('No duty roster assigned')} />}
    {shown.map((d, i) => {
      const isToday = d.dateStr === today;
      const names = String(d.shiftName || '').split(/\r?\n/).filter(x => x && x !== '—');
      const kind = kindOf(d, exDates.has(d.dateStr)); const K = kind ? KIND[kind] : null;
      const tag = d.isPublicHoliday ? (d.holidayName || mt('Holiday')) : d.leave ? mt('Leave') : null;
      const canEx = d.dateStr >= today && !d.isWeekend && !tag && kind !== 'dayoff' && kind !== 'nightoff' && d.hasRoster;
      const wd = WD[new Date(d.dateStr + 'T00:00:00').getDay()];
      return (
        <div key={d.dateStr} ref={isToday ? todayRef : undefined} className={`m-roster m-z${i % 2}`}
          style={{ ...(K ? { background: K.bg, borderLeft: `5px solid ${K.bar}` } : {}), ...(isToday ? { outline: '3px solid #1a56db', boxShadow: '0 4px 14px rgba(26,86,219,.35)' } : {}) }}>
          <div className="m-row">
            <b className="m-grow">{fd(d.dateStr)} <span className="m-muted">· {wd}</span></b>
            {isToday && <span className="m-chip" style={{ background: '#1a56db', color: '#fff' }}>● {mt('Today')}</span>}
            {K && <span className="m-chip" style={K.chip}>{tag || mt(K.label)}</span>}
          </div>
          {!d.isWeekend && !tag && kind !== 'dayoff' && kind !== 'nightoff' && names.map(n => (
            <div key={n} className="m-roster-shift">
              <span className="m-grow">{n}</span>
              {names.length === 1 && d.shiftStart && <span className="m-muted">{hm(d.shiftStart)}{d.shiftEnd ? ' – ' + hm(d.shiftEnd) : ''}</span>}
            </div>
          ))}
          {canEx && <button className="m-btn m-xs m-ghost" style={{ marginTop: 6 }} onClick={() => setEx({ date: d.dateStr, duty: names.join(' + ') })}>🔄 {mt('Exchange')}</button>}
        </div>
      );
    })}
    {ex && <ExchangeSheet date={ex.date} myDuty={ex.duty} onClose={() => setEx(null)} onDone={() => { setEx(null); setSent(true); onExchanged?.(); }} />}
  </>);
}

export default function MobileRoster() {
  const mt = useMT();
  const fd = useDateFormat();
  const { currentUser, canEdit, canDelete } = useAuth();
  const S = useStaffScope();
  const [rows, setRows] = useState(null);
  const [shifts, setShifts] = useState({});
  const [err, setErr] = useState('');
  const loc = useLocation();
  const [tab, setTab] = useState(() => (new URLSearchParams(loc.search).get('tab') === 'exchange' ? 'exchange' : 'mine'));
  const [form, setForm] = useState(null);       // null | 'new' | row
  const [q, setQ] = useState('');
  const today = getNepalTodayISO();
  const manage = !!canEdit?.('dutyRoster');   // same right the website uses to show Add / Edit on Duty Roster

  const load = useCallback(() => {
    api.get('/duty-roster').then(r => { setRows(Array.isArray(r) ? r : []); setErr(''); }).catch(e => { setErr(e.message || 'Could not load'); setRows([]); });
  }, []);
  useEffect(() => {
    api.get('/shifts').then(r => setShifts(Object.fromEntries((Array.isArray(r) ? r : []).map(s => [String(s.id), s])))).catch(() => {});
    load();
    api.get('/messages').then(r => {
      (Array.isArray(r) ? r : []).filter(m => !m.is_read && /^duty roster/i.test(m.subject || ''))
        .forEach(m => api.put(`/messages/${m.id}/read`, {}).catch(() => {}));
    }).catch(() => {});
  }, [load]);

  const mine = (rows || [])
    .filter(r => String(r.employeeDbId) === String(currentUser?.id) && String(r.dateTo || '').slice(0, 10) >= today)
    .sort((a, b) => String(a.dateFrom).localeCompare(String(b.dateFrom)));
  const team = (rows || [])
    .filter(r => String(r.dateTo || '').slice(0, 10) >= today
      && (!q.trim() || [r.employeeName, r.staffId, r.department].filter(Boolean).join(' ').toLowerCase().includes(q.trim().toLowerCase())))
    .sort((a, b) => String(a.dateFrom).localeCompare(String(b.dateFrom)) || String(a.employeeName).localeCompare(String(b.employeeName)));

  return (
    <div style={{ padding: '4px 12px 12px' }}>
      <div className="m-seg" style={{ marginBottom: 10 }}>
        <button className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>{mt('My Duty')}</button>
        <button className={tab === 'exchange' ? 'on' : ''} onClick={() => setTab('exchange')}>{mt('Exchange')}</button>
        {manage && <button className={tab === 'team' ? 'on' : ''} onClick={() => setTab('team')}>{mt('Team Duty')}</button>}
      </div>
      {rows === null && <div className="m-empty"><Spinner dark /></div>}
      {err && <div className="m-err">{err}</div>}

      {tab === 'mine' && <>
        <MyDuty mt={mt} fd={fd} today={today} />
      </>}

      {tab === 'exchange' && <ExchangeTab />}

      {tab === 'team' && manage && <>
        <button className="m-btn m-block" style={{ marginBottom: 10 }} onClick={() => setForm('new')}>＋ {mt('Add duty roster')}</button>
        <input className="m-input" style={{ marginBottom: 10 }} placeholder={`🔍 ${mt('Search')}`} value={q} onChange={e => setQ(e.target.value)} />
        {rows && !err && team.length === 0 && <Empty text={mt('No duty roster assigned')} />}
        {team.map((r, i) => <RosterCard key={r.id} r={r} i={i} shifts={shifts} today={today} fd={fd} mt={mt} who onClick={() => setForm(r)} />)}
      </>}

      {form && (
        <RosterForm row={form === 'new' ? null : form} shifts={shifts} staff={S.list} canDel={!!canDelete?.('dutyRoster')}
          onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />
      )}
    </div>
  );
}
