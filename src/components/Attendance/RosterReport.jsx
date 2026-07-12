import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import api from '../../api/client.js';
import { useSettings } from '../../context/SettingsContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useData } from '../../context/DataContext.jsx';
import { adToBS, bsToAD, getBSDays, BS_MONTHS_EN, BS_MONTHS_NP, toNepaliDigits } from '../../utils/dateUtils.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* ── Roster Menu dropdown ── */
const ROSTER_SUB_MENU = [
  { key: 'dashboard',  icon: '📊', label: 'Roster Dashboard' },
  { key: 'staff',      icon: '👤', label: 'Create Roster Staff Wise' },
  { key: 'department', icon: '🏢', label: 'Create Roster Department Wise' },
  { key: 'view',       icon: '📋', label: 'View Duty Roster Report' },
];

const RosterMenuBtn = ({ active, onSelect }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef();
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(p => !p)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 16px',
          height: 36, background: open ? '#1e40af' : '#1a56db', color: 'white', border: 'none',
          borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
          boxShadow: '0 2px 8px rgba(26,86,219,.3)', transition: 'background .15s' }}>
        <svg viewBox="0 0 20 20" fill="white" width="14" height="14">
          <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z"/>
          <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd"/>
        </svg>
        Roster Menu
        <svg viewBox="0 0 20 20" fill="white" width="12" height="12"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
        </svg>
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 500,
          background: 'white', border: '1px solid #e5e7eb', borderRadius: 10,
          boxShadow: '0 8px 28px rgba(0,0,0,.13)', overflow: 'hidden', minWidth: 260 }}>
          <div style={{ padding: '8px 14px', background: '#f9fafb', borderBottom: '1px solid #f3f4f6',
            fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.5px' }}>
            Roster Menu
          </div>
          {ROSTER_SUB_MENU.map((item, i) => {
            const isActive = active === item.key;
            return (
              <button key={item.key} onClick={() => { onSelect(item.key); setOpen(false); }}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9,
                  padding: '8px 14px', border: 'none',
                  borderBottom: i < ROSTER_SUB_MENU.length - 1 ? '1px solid #f0f0f0' : 'none',
                  textAlign: 'left', cursor: 'pointer', fontSize: 13,
                  background: isActive ? '#eff6ff' : 'white', color: isActive ? '#1e40af' : '#374151',
                  fontWeight: isActive ? 700 : 500 }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = '#f9fafb'; }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'white'; }}>
                <span style={{ fontSize: 17, flexShrink: 0 }}>{item.icon}</span>
                <span style={{ flex: 1 }}>{item.label}</span>
                {isActive
                  ? <svg viewBox="0 0 20 20" fill="#1a56db" width="13" height="13"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
                  : <svg viewBox="0 0 20 20" fill="#d1d5db" width="12" height="12"><path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd"/></svg>
                }
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

/* ── Stat card ── */
const StatCard = ({ icon, label, value, accent, bg, border }) => (
  <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 12,
    padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
    <div style={{ width: 40, height: 40, borderRadius: 10, background: accent + '18',
      border: `1.5px solid ${accent}30`, display: 'flex', alignItems: 'center',
      justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>{icon}</div>
    <div>
      <div style={{ fontSize: 24, fontWeight: 900, color: accent, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', marginTop: 2 }}>{label}</div>
    </div>
  </div>
);

/* ── Badge ── */
const Badge = ({ text, color, bg }) => (
  <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 6,
    fontSize: 11, fontWeight: 700, background: bg, color, border: `1px solid ${color}30` }}>
    {text}
  </span>
);

/* ── Day off pills ── */
const DayOffPills = ({ days }) => (
  <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
    {(days || []).map(d => (
      <span key={d} style={{ background: '#fee2e2', color: '#991b1b',
        borderRadius: 4, padding: '1px 5px', fontSize: 10, fontWeight: 700 }}>{d}</span>
    ))}
    {(!days || days.length === 0) && <span style={{ color: '#d1d5db', fontSize: 12 }}>—</span>}
  </div>
);

const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const SHIFT_COLORS = ['#1a56db','#059669','#7e3af2','#d97706','#dc2626','#0891b2','#be185d'];

/* ══════════════════════════════════════════
   Department Week Calendar
══════════════════════════════════════════ */
const DeptWeekView = ({ rosters, department, weekStart, settings }) => {
  const useNP   = settings?.defaultCalendar === 'np';
  const useNPDg = useNP && settings?.nepaliDigits;
  const fmtN    = n => useNPDg ? toNepaliDigits(n) : String(n);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    d.setHours(0, 0, 0, 0);
    return d;
  }), [weekStart]);

  const today = new Date(); today.setHours(0, 0, 0, 0);

  const deptRosters = useMemo(() => {
    const weekEnd = days[6];
    return rosters.filter(r => {
      if (r.department !== department) return false;
      const from = r.dateFrom ? new Date(r.dateFrom) : null;
      const to   = r.dateTo   ? new Date(r.dateTo)   : null;
      if (to   && to   < days[0]) return false;
      if (from && from > weekEnd)  return false;
      return true;
    });
  }, [rosters, department, days]);

  const staffList = useMemo(() => {
    const map = new Map();
    deptRosters.forEach(r => {
      if (r.employeeDbId && !map.has(r.employeeDbId))
        map.set(r.employeeDbId, r.employeeName || '—');
    });
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [deptRosters]);

  const getDayInfo = (employeeDbId, adDate) => {
    const dayStart = new Date(adDate); dayStart.setHours(0,  0,  0,  0);
    const dayEnd   = new Date(adDate); dayEnd.setHours(23, 59, 59, 999);
    for (const r of deptRosters) {
      if (r.employeeDbId !== employeeDbId) continue;
      const from = r.dateFrom ? new Date(r.dateFrom) : null;
      const to   = r.dateTo   ? new Date(r.dateTo)   : null;
      if (!((!from || from <= dayEnd) && (!to || to >= dayStart))) continue;
      const dayName = DAYS[dayStart.getDay()];
      const isOff   = (r.offDays || []).includes(dayName);
      return { isOff, shiftName: r.shiftName };
    }
    return null;
  };

  /* Format date label for column header */
  const fmtDayHeader = (d) => {
    if (useNP) {
      const bs = adToBS(d);
      if (bs) return { date: fmtN(bs.day), month: BS_MONTHS_EN[bs.month - 1] || '' };
    }
    return {
      date:  String(d.getDate()),
      month: d.toLocaleDateString('en-GB', { month: 'short' }),
    };
  };

  const HDR_COLOR = '#374151';

  if (staffList.length === 0) {
    return (
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12,
        padding: '40px', textAlign: 'center', color: '#9ca3af', fontSize: 14, fontWeight: 600 }}>
        No roster entries for "{department}" this week
      </div>
    );
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ background: '#efefef', borderBottom: '2px solid #dedede' }}>
            <th style={{ padding: '9px 12px', textAlign: 'center', fontWeight: 700,
              color: HDR_COLOR, fontSize: 14, borderRight: '1px solid #dedede', width: 48 }}>
              SN
            </th>
            <th style={{ padding: '9px 14px', textAlign: 'left', fontWeight: 700, color: HDR_COLOR,
              fontSize: 14, borderRight: '1px solid #dedede', minWidth: 160, whiteSpace: 'nowrap' }}>
              Staff Name
            </th>
            {days.map((d, i) => {
              const isToday  = d.toDateString() === today.toDateString();
              const { date, month } = fmtDayHeader(d);
              return (
                <th key={i} style={{ padding: '9px 10px', textAlign: 'center', fontWeight: 700,
                  fontSize: 12, color: isToday ? '#1a56db' : HDR_COLOR,
                  borderRight: i < 6 ? '1px solid #dedede' : 'none',
                  background: isToday ? '#eff6ff' : '#efefef', minWidth: 100 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 2 }}>{DAYS[d.getDay()]}</div>
                  <div style={{ fontSize: 14, fontWeight: 800 }}>{date} {month}</div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {staffList.map((s, si) => (
            <tr key={s.id} style={{ borderBottom: '1px solid #f3f4f6',
              background: si % 2 === 0 ? '#fff' : '#fafafa' }}>
              <td style={{ padding: '8px 12px', textAlign: 'center', fontSize: 13,
                fontWeight: 600, color: HDR_COLOR, borderRight: '1px solid #dedede',
                background: '#efefef' }}>
                {si + 1}
              </td>
              <td style={{ padding: '8px 14px', fontWeight: 600, color: '#111827', fontSize: 14,
                borderRight: '1px solid #e5e7eb', whiteSpace: 'nowrap' }}>{s.name}</td>
              {days.map((d, di) => {
                const info = getDayInfo(s.id, d);
                const isTd = d.toDateString() === today.toDateString();
                let bg = isTd ? '#f0f9ff' : 'transparent';
                let cell;
                if (!info) {
                  cell = <span style={{ color: '#d1d5db', fontSize: 13 }}>—</span>;
                } else if (info.isOff) {
                  bg   = '#fff5f5';
                  cell = <span style={{ fontSize: 12, fontWeight: 700, color: '#dc2626' }}>Day Off</span>;
                } else {
                  cell = <span style={{ fontSize: 12, fontWeight: 600, color: '#111827',
                    display: 'inline-block', maxWidth: 96, overflow: 'hidden',
                    textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                    {info.shiftName || 'On Duty'}
                  </span>;
                }
                return (
                  <td key={di} style={{ padding: '8px 8px', textAlign: 'center', background: bg,
                    borderRight: di < 6 ? '1px solid #f3f4f6' : 'none' }}>
                    {cell}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/* ══════════════════════════════════════════
   Staff Picker Modal
══════════════════════════════════════════ */
const StaffPickerModal = ({ open, onClose, onSelect, employees }) => {
  const [search,   setSearch]   = useState('');
  const [selected, setSelected] = useState(null);
  const list = useMemo(() => (employees || []).filter(s => s.active !== false), [employees]);

  useEffect(() => {
    if (!open) return;
    setSearch(''); setSelected(null);
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return list.filter(s =>
      !q ||
      (s.fullName   || '').toLowerCase().includes(q) ||
      (s.position   || '').toLowerCase().includes(q) ||
      (s.department || '').toLowerCase().includes(q) ||
      (s.deviceId   || '').toLowerCase().includes(q)
    );
  }, [list, search]);

  if (!open) return null;

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,.45)', display: 'flex',
        alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: 14, width: 580, maxWidth: '95vw',
        boxShadow: '0 20px 60px rgba(0,0,0,.22)', display: 'flex',
        flexDirection: 'column', maxHeight: '82vh', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #e5e7eb',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: '#f8fafc' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#111827' }}>👤 Staff Wise Report</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
              Select a staff member to view their monthly roster calendar
            </div>
          </div>
          <button onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer',
              color: '#9ca3af', fontSize: 20, lineHeight: 1, padding: '4px 8px',
              borderRadius: 6 }}
            onMouseEnter={e => e.currentTarget.style.background = '#f3f4f6'}
            onMouseLeave={e => e.currentTarget.style.background = 'none'}>✕</button>
        </div>

        {/* Search */}
        <div style={{ padding: '12px 20px', borderBottom: '1px solid #f0f0f0', background: '#fff' }}>
          <div style={{ position: 'relative' }}>
            <svg style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
              pointerEvents: 'none' }} viewBox="0 0 20 20" fill="#9ca3af" width="14" height="14">
              <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd"/>
            </svg>
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, post, department or machine ID…"
              style={{ width: '100%', height: 38, border: '1.5px solid #d1d5db', borderRadius: 8,
                padding: '0 12px 0 34px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
              onFocus={e => e.target.style.borderColor = '#1a56db'}
              onBlur={e  => e.target.style.borderColor = '#d1d5db'} />
          </div>
        </div>

        {/* Staff list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
              <tr style={{ background: '#efefef', borderBottom: '2px solid #dedede' }}>
                {['Name', 'Post', 'Department', 'Machine ID'].map((h, i) => (
                  <th key={h} style={{ padding: '9px 14px', textAlign: 'left',
                    fontWeight: 700, color: '#374151', fontSize: 12,
                    borderRight: i < 3 ? '1px solid #dedede' : 'none' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={4} style={{ textAlign: 'center', padding: '36px', color: '#9ca3af', fontSize: 13 }}>
                  No staff found
                </td></tr>
              ) : filtered.map((s, i) => {
                const isSel = selected?.id === s.id;
                return (
                  <tr key={s.id}
                    onClick={() => setSelected(isSel ? null : s)}
                    style={{ cursor: 'pointer', borderBottom: '1px solid #f3f4f6',
                      background: isSel ? '#eff6ff' : i % 2 === 0 ? '#fff' : '#fafafa',
                      outline: isSel ? '2px solid #1a56db' : 'none', outlineOffset: -2,
                      transition: 'background .1s' }}
                    onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = '#f0f9ff'; }}
                    onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = i % 2 === 0 ? '#fff' : '#fafafa'; }}>
                    <td style={{ padding: '9px 14px', fontWeight: isSel ? 700 : 500,
                      color: isSel ? '#1e40af' : '#111827' }}>
                      {s.fullName || '—'}
                      {s.employeeId && (
                        <span style={{ fontSize: 10, color: '#9ca3af', marginLeft: 6,
                          fontFamily: 'monospace' }}>{s.employeeId}</span>
                      )}
                    </td>
                    <td style={{ padding: '9px 14px', color: '#374151' }}>{s.position || '—'}</td>
                    <td style={{ padding: '9px 14px', color: '#374151' }}>{s.department || '—'}</td>
                    <td style={{ padding: '9px 14px' }}>
                      {s.deviceId
                        ? <span style={{ background: '#f3f4f6', borderRadius: 4,
                            padding: '2px 7px', fontSize: 11, fontFamily: 'monospace', color: '#374151' }}>
                            {s.deviceId}
                          </span>
                        : <span style={{ color: '#d1d5db' }}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid #e5e7eb',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: '#f9fafb' }}>
          <div style={{ fontSize: 12, color: '#6b7280' }}>
            {selected
              ? <span>Selected: <strong style={{ color: '#1e40af' }}>{selected.fullName}</strong></span>
              : <span>{filtered.length} staff listed — click a row to select</span>}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose}
              style={{ height: 36, padding: '0 16px', fontSize: 13, fontWeight: 600,
                background: '#fff', border: '1px solid #d1d5db', borderRadius: 8,
                cursor: 'pointer', color: '#374151' }}>
              Cancel
            </button>
            <button
              disabled={!selected}
              onClick={() => selected && onSelect(selected)}
              style={{ height: 36, padding: '0 20px', fontSize: 13, fontWeight: 700,
                background: selected ? '#1a56db' : '#e5e7eb',
                color: selected ? '#fff' : '#9ca3af',
                border: 'none', borderRadius: 8,
                cursor: selected ? 'pointer' : 'not-allowed',
                boxShadow: selected ? '0 2px 8px rgba(26,86,219,.3)' : 'none',
                transition: 'all .15s' }}>
              🔍 Search
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ══════════════════════════════════════════
   Staff Calendar View
══════════════════════════════════════════ */
const StaffCalendar = ({ staff, rosters, settings }) => {
  const useNP   = settings?.defaultCalendar === 'np';
  const useNPDg = settings?.nepaliDigits && useNP;
  const today   = new Date();
  const todayBS = adToBS(today);
  const fmt     = n => useNPDg ? toNepaliDigits(n) : String(n);

  /* ── Navigation state ── */
  const [navYear,  setNavYear]  = useState(() => useNP ? (todayBS?.year  || today.getFullYear()) : today.getFullYear());
  const [navMonth, setNavMonth] = useState(() => useNP ? (todayBS?.month || today.getMonth() + 1) : today.getMonth()); // BS: 1-12, AD: 0-11

  /* ── Month navigation ── */
  const goPrev = () => {
    if (useNP) {
      if (navMonth <= 1)  { setNavMonth(12); setNavYear(y => y - 1); }
      else                { setNavMonth(m => m - 1); }
    } else {
      if (navMonth <= 0)  { setNavMonth(11); setNavYear(y => y - 1); }
      else                { setNavMonth(m => m - 1); }
    }
  };
  const goNext = () => {
    if (useNP) {
      if (navMonth >= 12) { setNavMonth(1);  setNavYear(y => y + 1); }
      else                { setNavMonth(m => m + 1); }
    } else {
      if (navMonth >= 11) { setNavMonth(0);  setNavYear(y => y + 1); }
      else                { setNavMonth(m => m + 1); }
    }
  };

  /* ── Calendar geometry ── */
  let daysInMonth, firstDay, monthLabel;
  if (useNP) {
    daysInMonth = getBSDays(navYear, navMonth) || 30;
    const firstAD = bsToAD(navYear, navMonth, 1);
    firstDay  = firstAD ? firstAD.getDay() : 0;
    const mnName = BS_MONTHS_EN[navMonth - 1] || '';
    monthLabel = `${mnName} ${fmt(navYear)} BS`;
  } else {
    daysInMonth = new Date(navYear, navMonth + 1, 0).getDate();
    firstDay    = new Date(navYear, navMonth, 1).getDay();
    monthLabel  = new Date(navYear, navMonth, 1)
      .toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  }

  /* ── Get AD Date for a given calendar day ── */
  const getADDate = (d) => useNP ? bsToAD(navYear, navMonth, d) : new Date(navYear, navMonth, d);

  /* ── Check roster coverage for an AD date ── */
  const getDayInfo = (adDate) => {
    if (!adDate) return null;
    const dayStart = new Date(adDate); dayStart.setHours(0,  0,  0,  0);
    const dayEnd   = new Date(adDate); dayEnd.setHours(23, 59, 59, 999);
    for (const r of rosters) {
      const from = r.dateFrom ? new Date(r.dateFrom) : null;
      const to   = r.dateTo   ? new Date(r.dateTo)   : null;
      const covered = (!from || from <= dayEnd) && (!to || to >= dayStart);
      if (!covered) continue;
      const dayName = DAYS[dayStart.getDay()];
      const isOff   = (r.offDays || []).includes(dayName);
      return { isOff, shiftName: r.shiftName, startTime: r.startTime, endTime: r.endTime };
    }
    return null;
  };

  /* ── Is today ── */
  const isToday = (d) => {
    if (useNP) return todayBS && navYear === todayBS.year && navMonth === todayBS.month && d === todayBS.day;
    return d === today.getDate() && navMonth === today.getMonth() && navYear === today.getFullYear();
  };

  /* ── Build cells ── */
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  /* ── Stats for current nav month ── */
  let workDays = 0, offDays = 0, noDuty = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const info = getDayInfo(getADDate(d));
    if (!info)           noDuty++;
    else if (info.isOff) offDays++;
    else                 workDays++;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Staff info + stats bar */}
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12,
        padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: '#eff6ff',
          border: '1.5px solid #bfdbfe', display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: 18, color: '#1a56db', fontWeight: 800, flexShrink: 0 }}>
          {(staff.fullName || '?')[0].toUpperCase()}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>{staff.fullName}</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
            {[staff.position, staff.department, staff.deviceId ? `[${staff.deviceId}]` : null]
              .filter(Boolean).join(' · ')}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[
            { label: 'Work Days', value: workDays, color: '#059669', bg: '#f0fdf4', border: '#6ee7b7' },
            { label: 'Day Off',   value: offDays,  color: '#dc2626', bg: '#fff5f5', border: '#fca5a5' },
            { label: 'No Roster', value: noDuty,   color: '#6b7280', bg: '#f9fafb', border: '#e5e7eb' },
          ].map(s => (
            <div key={s.label} style={{ background: s.bg, border: `1px solid ${s.border}`,
              borderRadius: 8, padding: '7px 14px', textAlign: 'center', minWidth: 72 }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: s.color, lineHeight: 1 }}>{fmt(s.value)}</div>
              <div style={{ fontSize: 10, fontWeight: 600, color: '#6b7280', marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Calendar card */}
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>

        {/* Month nav + legend */}
        <div style={{ padding: '10px 16px', background: '#f8fafc', borderBottom: '1px solid #e5e7eb',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>

          {/* Prev / Month label / Next */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button onClick={goPrev}
              style={{ width: 30, height: 30, border: '1px solid #d1d5db', borderRadius: 7,
                background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center',
                justifyContent: 'center', color: '#374151', fontSize: 14 }}
              onMouseEnter={e => e.currentTarget.style.background = '#f3f4f6'}
              onMouseLeave={e => e.currentTarget.style.background = '#fff'}>‹</button>
            <span style={{ fontSize: 13, fontWeight: 800, color: '#111827', minWidth: 150, textAlign: 'center' }}>
              📅 {monthLabel}
            </span>
            <button onClick={goNext}
              style={{ width: 30, height: 30, border: '1px solid #d1d5db', borderRadius: 7,
                background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center',
                justifyContent: 'center', color: '#374151', fontSize: 14 }}
              onMouseEnter={e => e.currentTarget.style.background = '#f3f4f6'}
              onMouseLeave={e => e.currentTarget.style.background = '#fff'}>›</button>
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', gap: 12 }}>
            {[
              { bg: '#dbeafe', border: '#1a56db', label: 'Working' },
              { bg: '#fee2e2', border: '#dc2626', label: 'Day Off' },
              { bg: '#f3f4f6', border: '#d1d5db', label: 'No Roster' },
            ].map(l => (
              <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 11, height: 11, borderRadius: 3, flexShrink: 0,
                  background: l.bg, border: `1.5px solid ${l.border}` }} />
                <span style={{ fontSize: 12, color: '#6b7280' }}>{l.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Day-of-week header */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)',
          background: '#f8fafc', borderBottom: '2px solid #e5e7eb' }}>
          {DAYS.map(d => (
            <div key={d} style={{ padding: '8px 4px', textAlign: 'center',
              fontSize: 13, fontWeight: 700, color: d === 'Sun' ? '#dc2626' : '#6b7280' }}>
              {d}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)' }}>
          {cells.map((d, idx) => {
            if (d === null) return (
              <div key={`e-${idx}`} style={{
                minHeight: 82, background: '#fafafa',
                borderBottom: '1px solid #efefef',
                borderRight: (idx + 1) % 7 !== 0 ? '1px solid #efefef' : 'none'
              }} />
            );

            const adDate = getADDate(d);
            const info   = getDayInfo(adDate);
            const tod    = isToday(d);
            const dow    = (firstDay + d - 1) % 7;

            let bg = '#fff';
            if (info?.isOff) bg = '#fff8f8';
            else if (info)   bg = '#f0f8ff';

            return (
              <div key={d} style={{
                minHeight: 82, background: bg,
                borderBottom: '1px solid #e5e7eb',
                borderRight: (idx + 1) % 7 !== 0 ? '1px solid #e5e7eb' : 'none',
                padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 4,
                outline: tod ? '2px solid #1a56db' : 'none', outlineOffset: -2
              }}>
                {/* Day number */}
                <div style={{
                  alignSelf: 'flex-start', width: 26, height: 26, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, fontWeight: tod ? 800 : 500,
                  background: tod ? '#1a56db' : 'transparent',
                  color: tod ? '#fff' : dow === 0 ? '#dc2626' : '#374151'
                }}>{fmt(d)}</div>

                {/* Shift badge */}
                {info?.isOff ? (
                  <div style={{ background: '#fee2e2', color: '#991b1b', borderRadius: 4,
                    fontSize: 12, fontWeight: 700, padding: '3px 6px', textAlign: 'center' }}>
                    OFF
                  </div>
                ) : info ? (
                  <div style={{ background: '#dbeafe', color: '#1e40af', borderRadius: 4,
                    fontSize: 12, fontWeight: 700, padding: '3px 6px', textAlign: 'center', lineHeight: 1.4 }}>
                    {info.shiftName || 'On Duty'}
                    {info.startTime && (
                      <div style={{ fontSize: 11, fontWeight: 500, opacity: .75, marginTop: 1 }}>
                        {String(info.startTime).slice(0, 5)}
                        {info.endTime ? `–${String(info.endTime).slice(0, 5)}` : ''}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: '#d1d5db', textAlign: 'center', marginTop: 4 }}>–</div>
                )}
              </div>
            );
          })}
        </div>

        {/* Roster entries footer */}
        {rosters.length > 0 ? (
          <div style={{ padding: '8px 16px', background: '#f8fafc', borderTop: '1px solid #e5e7eb',
            display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11, color: '#6b7280' }}>
            {rosters.map((r, i) => (
              <span key={r.id || i} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                  background: SHIFT_COLORS[i % SHIFT_COLORS.length] }} />
                <strong style={{ color: '#374151' }}>{r.shiftName || 'Roster'}</strong>
                {': '}{fmtDate(r.dateFrom)} → {fmtDate(r.dateTo)}
                {r.offDays?.length > 0 && (
                  <span style={{ color: '#dc2626' }}> | Off: {r.offDays.join(', ')}</span>
                )}
              </span>
            ))}
          </div>
        ) : (
          <div style={{ padding: '18px', textAlign: 'center', color: '#9ca3af', fontSize: 13,
            borderTop: '1px solid #e5e7eb' }}>
            No roster assigned to this staff for this month.
          </div>
        )}
      </div>
    </div>
  );
};

/* ══════════════════════════════════════════
   Roster Report Page
══════════════════════════════════════════ */
const RosterReport = () => {
  const navigate         = useNavigate();
  const { settings }     = useSettings();
  const { currentUser }  = useAuth();
  const { filteredEmployees: employees } = useData();

  const [rosters,   setRosters]   = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);
  const [view,      setView]      = useState('staff'); // staff | department | shift
  const [search,    setSearch]    = useState('');

  /* StaffWise modal + calendar state */
  const [staffModalOpen, setStaffModalOpen] = useState(false);
  const [selectedStaff,  setSelectedStaff]  = useState(null);
  const [calView,        setCalView]        = useState(false);

  /* Department week view state */
  const [weekOffset, setWeekOffset] = useState(0);
  const [deptFilter, setDeptFilter] = useState('');

  /* Auto-select current user on first load */
  useEffect(() => {
    if (!currentUser || !employees.length) return;
    const me = employees.find(e => e.id === currentUser.id);
    if (me) { setSelectedStaff(me); setCalView(true); }
  }, [currentUser, employees]);

  /* HOD: auto-filter to their department */
  useEffect(() => {
    if (currentUser?.role === 'departmentHead' && currentUser.department) {
      setDeptFilter(currentUser.department);
    }
  }, [currentUser?.role, currentUser?.department]);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    api.get('/duty-roster')
      .then(ros => setRosters(ros))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  /* ── Current month window ── */
  const today      = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd   = new Date(today.getFullYear(), today.getMonth() + 1, 0);

  const useNP   = settings?.defaultCalendar === 'np';
  const useNPDg = useNP && settings?.nepaliDigits;
  const fmtN    = n => useNPDg ? toNepaliDigits(n) : String(n);
  const todayBS = adToBS(today);
  const monthLabel = useNP && todayBS
    ? `${BS_MONTHS_EN[todayBS.month - 1]} ${fmtN(todayBS.year)} BS`
    : today.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  /* ── Rosters active this month ── */
  const monthRosters = useMemo(() => rosters.filter(r => {
    const from = r.dateFrom ? new Date(r.dateFrom) : null;
    const to   = r.dateTo   ? new Date(r.dateTo)   : null;
    if (to   && to   < monthStart) return false;
    if (from && from > monthEnd)   return false;
    return true;
  }), [rosters]);

  /* ── Rosters for selected staff (for calendar) ── */
  const staffRosters = useMemo(() => {
    if (!selectedStaff) return [];
    return rosters.filter(r => r.employeeDbId === selectedStaff.id);
  }, [rosters, selectedStaff]);

  /* ── Stats ── */
  const shiftMap = useMemo(() => {
    const m = {};
    monthRosters.forEach(r => { if (r.shiftName) m[r.shiftName] = (m[r.shiftName] || 0) + 1; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [monthRosters]);

  const deptMap = useMemo(() => {
    const m = {};
    monthRosters.forEach(r => { if (r.department) m[r.department] = (m[r.department] || 0) + 1; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [monthRosters]);

  const uniqueStaff = useMemo(() =>
    new Set(monthRosters.map(r => r.employeeName || r.staffId)).size,
    [monthRosters]);

  /* ── Filtered rows for table ── */
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return monthRosters.filter(r =>
      !q ||
      (r.employeeName || '').toLowerCase().includes(q) ||
      (r.shiftName    || '').toLowerCase().includes(q) ||
      (r.department   || '').toLowerCase().includes(q) ||
      (r.branch       || '').toLowerCase().includes(q)
    );
  }, [monthRosters, search]);

  /* ── Group for shift view ── */
  const grouped = useMemo(() => {
    const m = {};
    filtered.forEach(r => {
      const k = r.shiftName || '(Not Set)';
      (m[k] = m[k] || []).push(r);
    });
    return Object.entries(m).sort((a, b) => b[1].length - a[1].length);
  }, [filtered]);

  /* ── Week calculations for Dept view ── */
  const weekStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - d.getDay() + weekOffset * 7);
    return d;
  }, [weekOffset]);

  const weekEnd = useMemo(() => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 6);
    return d;
  }, [weekStart]);

  const weekLabel = (() => {
    if (useNP) {
      const bsS = adToBS(weekStart);
      const bsE = adToBS(weekEnd);
      if (bsS && bsE) {
        const fS = `${BS_MONTHS_EN[bsS.month - 1]} ${fmtN(bsS.day)}`;
        const fE = `${BS_MONTHS_EN[bsE.month - 1]} ${fmtN(bsE.day)}, ${fmtN(bsE.year)} BS`;
        return `${fS} – ${fE}`;
      }
    }
    return `${weekStart.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} – ${weekEnd.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`;
  })();

  /* ── Print meta: fiscal year, month, week number ── */
  const printMeta = (() => {
    const bsS = adToBS(weekStart);
    const bsE = adToBS(weekEnd);

    // Fiscal year (Nepal: Shrawan=month4 starts new FY)
    let fiscalYear;
    if (useNP && bsS) {
      const fy1 = bsS.month >= 4 ? bsS.year : bsS.year - 1;
      const fy2 = String((fy1 + 1) % 100).padStart(2, '0');
      fiscalYear = `${fy1}/${fy2}`;
    } else {
      const y = weekStart.getFullYear();
      const m = weekStart.getMonth() + 1;
      const fy1 = m >= 7 ? y : y - 1;
      fiscalYear = `${fy1}/${String((fy1 + 1) % 100).padStart(2, '0')}`;
    }

    // Month name
    const monthName = useNP && bsS
      ? `${BS_MONTHS_EN[bsS.month - 1]} ${fmtN(bsS.year)} BS`
      : weekStart.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

    // Week number within the month (1st/2nd/3rd/4th)
    const weekDay = useNP && bsS ? bsS.day : weekStart.getDate();
    const weekNum = Math.ceil(weekDay / 7);
    const ordinals = ['1st', '2nd', '3rd', '4th', '5th'];
    const weekOrdinal = ordinals[weekNum - 1] || `${weekNum}th`;

    // Full date range label
    let rangeLabel;
    if (useNP && bsS && bsE) {
      rangeLabel = `${BS_MONTHS_EN[bsS.month - 1]} ${fmtN(bsS.day)} – ${BS_MONTHS_EN[bsE.month - 1]} ${fmtN(bsE.day)}, ${fmtN(bsE.year)} BS`;
    } else {
      rangeLabel = `${weekStart.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} – ${weekEnd.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`;
    }

    return { fiscalYear, monthName, weekOrdinal, rangeLabel };
  })();

  const depts = useMemo(() =>
    [...new Set(rosters.map(r => r.department).filter(Boolean))].sort(),
    [rosters]);

  const activeDept = deptFilter || (depts.length === 1 ? depts[0] : '');

  /* ── Dept week export ── */
  const handleDeptExport = () => {
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      d.setHours(0, 0, 0, 0);
      return d;
    });
    const wEnd = days[6];
    const dRosters = rosters.filter(r => {
      if (activeDept && r.department !== activeDept) return false;
      const from = r.dateFrom ? new Date(r.dateFrom) : null;
      const to   = r.dateTo   ? new Date(r.dateTo)   : null;
      if (to   && to   < days[0]) return false;
      if (from && from > wEnd)    return false;
      return true;
    });
    const staffMap = new Map();
    dRosters.forEach(r => {
      if (r.employeeDbId && !staffMap.has(r.employeeDbId))
        staffMap.set(r.employeeDbId, r.employeeName || '—');
    });
    const staffList = [...staffMap.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const getDayCell = (empId, adDate) => {
      const ds = new Date(adDate); ds.setHours(0,  0,  0,  0);
      const de = new Date(adDate); de.setHours(23, 59, 59, 999);
      for (const r of dRosters) {
        if (r.employeeDbId !== empId) continue;
        const from = r.dateFrom ? new Date(r.dateFrom) : null;
        const to   = r.dateTo   ? new Date(r.dateTo)   : null;
        if (!((!from || from <= de) && (!to || to >= ds))) continue;
        const isOff = (r.offDays || []).includes(DAYS[ds.getDay()]);
        return isOff ? 'Day Off' : (r.shiftName || 'On Duty');
      }
      return '';
    };
    const headers = ['Staff Name',
      ...days.map(d => `${DAYS[d.getDay()]} ${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'short' })}`)];
    const rows = staffList.map(s => [s.name, ...days.map(d => getDayCell(s.id, d))]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Weekly Roster');
    XLSX.writeFile(wb, `roster_${activeDept || 'all'}_${weekStart.toISOString().split('T')[0]}.xlsx`);
  };

  /* ── Handlers ── */
  const handleStaffSelect = (staff) => {
    setSelectedStaff(staff);
    setStaffModalOpen(false);
    setView('staff');
    setCalView(true);
  };

  const handleViewBtn = (key) => {
    if (key === 'staff') {
      setStaffModalOpen(true);
    } else {
      setCalView(false);
      setSelectedStaff(null);
      setView(key);
      setSearch('');
    }
  };

  /* ─────────── RENDER ─────────── */
  return (
    <div className="page-container">
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 10mm 12mm; }
          body * { visibility: hidden !important; }
          #dept-week-grid, #dept-week-grid * { visibility: visible !important; }
          #dept-week-grid {
            position: fixed !important;
            inset: 0;
            width: 277mm;
            overflow: visible !important;
            padding: 0;
          }
          #dept-week-grid .print-only { display: block !important; }
          #dept-week-grid table {
            width: 100% !important;
            table-layout: fixed !important;
            border-collapse: collapse !important;
            font-size: 10pt !important;
          }
          #dept-week-grid table th,
          #dept-week-grid table td {
            font-size: 10pt !important;
            padding: 5px 6px !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
            white-space: nowrap !important;
          }
          #dept-week-grid table th:first-child,
          #dept-week-grid table td:first-child { width: 6% !important; }
          #dept-week-grid table th:nth-child(2),
          #dept-week-grid table td:nth-child(2) { width: 18% !important; }
          #dept-week-grid table th:not(:first-child):not(:nth-child(2)),
          #dept-week-grid table td:not(:first-child):not(:nth-child(2)) { width: 10.85% !important; }
          #dept-week-grid span { font-size: 9pt !important; padding: 2px 4px !important; }
          #dept-week-grid table th div { font-size: 8pt !important; font-weight: 700 !important; margin: 0 !important; }
        }
      `}</style>

      {/* ── Staff Picker Modal ── */}
      <StaffPickerModal
        open={staffModalOpen}
        onClose={() => setStaffModalOpen(false)}
        onSelect={handleStaffSelect}
        employees={employees}
      />

      {/* ── Header ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">
            📋 View Duty Roster Report
            <span style={{ fontSize:14, fontWeight:600, color:'#6b7280', marginLeft:10 }}>
              [ {monthLabel} &nbsp;·&nbsp; {monthRosters.length} active rosters ]
            </span>
          </h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => window.print()}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 36,
              padding: '0 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              background: '#eff6ff', border: '1px solid #93c5fd', color: '#1d4ed8', borderRadius: 8 }}>
            🖨️ Print
          </button>
          <RosterMenuBtn active="view" onSelect={key => {
            if      (key === 'dashboard')  navigate('/attendance/roster-dashboard');
            else if (key === 'staff')      navigate('/attendance/duty-roster');
            else if (key === 'department') navigate('/attendance/duty-roster/dept');
          }} />
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '70px 0' }}>
          <div style={{ width: 42, height: 42, border: '4px solid #e5e7eb', borderTopColor: '#1a56db',
            borderRadius: '50%', animation: 'spin .8s linear infinite', margin: '0 auto 14px' }} />
          <div style={{ color: '#9ca3af', fontSize: 13, fontWeight: 600 }}>Loading roster data…</div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      ) : error ? (
        <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 10,
          padding: '14px 18px', color: '#991b1b', fontWeight: 600 }}>❌ {error}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* ── Report View Buttons ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

            {/* Row 1: view toggles */}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#6b7280' }}>View Report:</span>
              {[
                { key: 'staff',      label: 'Staff Wise',      icon: '👤' },
                { key: 'department', label: 'Department Wise', icon: '🏢' },
                { key: 'shift',      label: 'Shift Wise',      icon: '🔄' },
              ].map(btn => (
                <button key={btn.key} onClick={() => handleViewBtn(btn.key)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
                    height: 36, padding: '0 16px', fontSize: 13, fontWeight: 700,
                    cursor: 'pointer', borderRadius: 8, transition: 'all .15s',
                    background: view === btn.key ? '#1a56db' : '#f8fafc',
                    color:      view === btn.key ? '#fff'    : '#374151',
                    border:     view === btn.key ? 'none'    : '1px solid #d1d5db',
                    boxShadow:  view === btn.key ? '0 2px 8px rgba(26,86,219,.3)' : 'none',
                  }}>
                  {btn.icon} {btn.label}
                </button>
              ))}

              {/* Back to list button when in calendar view */}
              {calView && selectedStaff && (
                <button
                  onClick={() => { setCalView(false); setSelectedStaff(null); }}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5,
                    height: 36, padding: '0 14px', fontSize: 13, fontWeight: 600,
                    cursor: 'pointer', borderRadius: 8,
                    background: '#f0fdf4', color: '#059669', border: '1px solid #6ee7b7' }}>
                  ← Back to List
                </button>
              )}

              {/* Search — shift view only */}
              {!calView && view === 'shift' && (
                <div style={{ marginLeft: 'auto', position: 'relative' }}>
                  <svg style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
                    pointerEvents: 'none' }} viewBox="0 0 20 20" fill="#9ca3af" width="14" height="14">
                    <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd"/>
                  </svg>
                  <input value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="Search name, shift…"
                    style={{ height: 36, width: 200, border: '1px solid #d1d5db', borderRadius: 8,
                      padding: '0 10px 0 32px', fontSize: 13, outline: 'none' }}
                    onFocus={e => e.target.style.borderColor = '#1a56db'}
                    onBlur={e  => e.target.style.borderColor = '#d1d5db'} />
                </div>
              )}
            </div>

            {/* Row 2: Department week controls */}
            {view === 'department' && !calView && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
                background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 10,
                padding: '10px 14px' }}>

                {/* Dept selector */}
                <select
                  value={deptFilter}
                  onChange={e => setDeptFilter(e.target.value)}
                  disabled={currentUser?.role === 'departmentHead'}
                  style={{ height: 34, border: '1px solid #d1d5db', borderRadius: 8,
                    padding: '0 10px', fontSize: 13, fontWeight: 600, color: '#374151',
                    background: currentUser?.role === 'departmentHead' ? '#f3f4f6' : '#fff',
                    cursor: currentUser?.role === 'departmentHead' ? 'not-allowed' : 'pointer',
                    outline: 'none', minWidth: 160 }}>
                  <option value="">All Departments</option>
                  {depts.map(d => <option key={d} value={d}>{d}</option>)}
                </select>

                {/* Week nav */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button onClick={() => setWeekOffset(w => w - 1)}
                    style={{ width: 32, height: 32, border: '1px solid #d1d5db', borderRadius: 7,
                      background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center',
                      justifyContent: 'center', fontSize: 15, color: '#374151', fontWeight: 700 }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f3f4f6'}
                    onMouseLeave={e => e.currentTarget.style.background = '#fff'}>‹</button>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#111827',
                    minWidth: 190, textAlign: 'center' }}>📅 {weekLabel}</span>
                  <button onClick={() => setWeekOffset(w => w + 1)}
                    style={{ width: 32, height: 32, border: '1px solid #d1d5db', borderRadius: 7,
                      background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center',
                      justifyContent: 'center', fontSize: 15, color: '#374151', fontWeight: 700 }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f3f4f6'}
                    onMouseLeave={e => e.currentTarget.style.background = '#fff'}>›</button>
                  {weekOffset !== 0 && (
                    <button onClick={() => setWeekOffset(0)}
                      style={{ height: 30, padding: '0 12px', fontSize: 11, fontWeight: 700,
                        border: '1px solid #d1d5db', borderRadius: 7, background: '#fff',
                        cursor: 'pointer', color: '#6b7280' }}>
                      Today
                    </button>
                  )}
                </div>

                {/* Print + Export */}
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                  <button onClick={() => window.print()}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 34,
                      padding: '0 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      background: '#eff6ff', border: '1px solid #93c5fd', color: '#1d4ed8', borderRadius: 8 }}>
                    🖨️ Print
                  </button>
                  <button onClick={handleDeptExport}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 34,
                      padding: '0 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      background: '#f0fdf4', border: '1px solid #6ee7b7', color: '#065f46', borderRadius: 8 }}>
                    📥 Export Excel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ── Calendar view (Staff Wise) ── */}
          {calView && selectedStaff ? (
            <StaffCalendar
              staff={selectedStaff}
              rosters={staffRosters}
              settings={settings}
            />
          ) : view === 'department' ? (
            <div id="dept-week-grid">
              <div className="print-only" style={{ display: 'none', marginBottom: 10 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#111827', marginBottom: 4 }}>
                  Weekly Duty Roster &nbsp;|&nbsp; Department : {activeDept || 'All Departments'}
                </div>
                <div style={{ fontSize: 12, color: '#374151', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <span>Fiscal Year : {printMeta.fiscalYear}</span>
                  <span style={{ color: '#9ca3af' }}>|</span>
                  <span>Month : {printMeta.monthName}</span>
                  <span style={{ color: '#9ca3af' }}>|</span>
                  <span>From Date – To Date : {printMeta.rangeLabel}</span>
                  <span style={{ color: '#9ca3af' }}>|</span>
                  <span>{printMeta.weekOrdinal} Week</span>
                </div>
              </div>
              <DeptWeekView
                rosters={rosters}
                department={activeDept}
                weekStart={weekStart}
                settings={settings}
              />
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: '#9ca3af',
              fontSize: 14, fontWeight: 600 }}>No roster entries found for {monthLabel}</div>
          ) : view === 'staff' ? (
            /* Staff Wise Table */
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e5e7eb' }}>
                    {['#','Staff Name','Department','Shift','Date From','Date To','Day Off','Status'].map(h => (
                      <th key={h} style={{ padding: '10px 14px', textAlign: 'left',
                        fontSize: 11, fontWeight: 700, color: '#6b7280', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r, i) => {
                    const now   = new Date();
                    const from  = r.dateFrom ? new Date(r.dateFrom) : null;
                    const to    = r.dateTo   ? new Date(r.dateTo)   : null;
                    const isActive  = (!from || from <= now) && (!to || to >= now);
                    const isExpired = to && to < now;
                    const isFuture  = from && from > now;
                    return (
                      <tr key={r.id || i} style={{ borderBottom: '1px solid #f3f4f6',
                        background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                        <td style={{ padding: '8px 14px', color: '#9ca3af', fontSize: 12 }}>{i + 1}</td>
                        <td style={{ padding: '8px 14px', fontWeight: 600, color: '#111827' }}>
                          {r.employeeName || '—'}
                          {r.staffId && <div style={{ fontSize: 10, color: '#9ca3af', fontFamily: 'monospace' }}>{r.staffId}</div>}
                        </td>
                        <td style={{ padding: '8px 14px', color: '#374151' }}>{r.department || '—'}</td>
                        <td style={{ padding: '8px 14px' }}>
                          {r.shiftName
                            ? <Badge text={r.shiftName} color="#1a56db" bg="#eff6ff" />
                            : <span style={{ color: '#d1d5db' }}>—</span>}
                        </td>
                        <td style={{ padding: '8px 14px', color: '#374151', fontSize: 12 }}>{fmtDate(r.dateFrom)}</td>
                        <td style={{ padding: '8px 14px', color: '#374151', fontSize: 12 }}>{fmtDate(r.dateTo)}</td>
                        <td style={{ padding: '8px 14px' }}><DayOffPills days={r.offDays} /></td>
                        <td style={{ padding: '8px 14px' }}>
                          {isActive  && <Badge text="Active"  color="#059669" bg="#f0fdf4" />}
                          {isExpired && <Badge text="Expired" color="#dc2626" bg="#fff5f5" />}
                          {isFuture  && <Badge text="Future"  color="#7e3af2" bg="#f5f3ff" />}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ padding: '8px 14px', background: '#f8fafc', borderTop: '1px solid #e5e7eb',
                fontSize: 11, color: '#9ca3af' }}>
                {filtered.length} entries shown
              </div>
            </div>
          ) : (
            /* Shift Wise — grouped */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {grouped.map(([groupKey, rows], gi) => (
                <div key={groupKey} style={{ background: '#fff', border: '1px solid #e5e7eb',
                  borderRadius: 12, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 16px', background: '#f8fafc', borderBottom: '1px solid #e5e7eb' }}>
                    <span style={{ fontSize: 16 }}>🔄</span>
                    <span style={{ fontSize: 14, fontWeight: 800, color: '#111827' }}>{groupKey}</span>
                    <span style={{
                      background: SHIFT_COLORS[gi % SHIFT_COLORS.length], color: '#fff',
                      borderRadius: 10, fontSize: 11, fontWeight: 700,
                      padding: '2px 8px', marginLeft: 'auto',
                    }}>{rows.length} staff</span>
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
                        {['#','Staff Name','Department','Date From','Date To','Day Off','Status'].map(h => (
                          <th key={h} style={{ padding: '7px 14px', textAlign: 'left',
                            fontSize: 11, fontWeight: 700, color: '#9ca3af' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => {
                        const now  = new Date();
                        const from = r.dateFrom ? new Date(r.dateFrom) : null;
                        const to   = r.dateTo   ? new Date(r.dateTo)   : null;
                        const isActive  = (!from || from <= now) && (!to || to >= now);
                        const isExpired = to && to < now;
                        const isFuture  = from && from > now;
                        return (
                          <tr key={r.id || i} style={{ borderBottom: '1px solid #f9fafb',
                            background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                            <td style={{ padding: '7px 14px', color: '#9ca3af' }}>{i + 1}</td>
                            <td style={{ padding: '7px 14px', fontWeight: 600, color: '#111827' }}>
                              {r.employeeName || '—'}
                            </td>
                            <td style={{ padding: '7px 14px' }}>
                              {r.department
                                ? <Badge text={r.department} color="#7e3af2" bg="#f5f3ff" />
                                : <span style={{ color: '#d1d5db' }}>—</span>}
                            </td>
                            <td style={{ padding: '7px 14px', color: '#374151' }}>{fmtDate(r.dateFrom)}</td>
                            <td style={{ padding: '7px 14px', color: '#374151' }}>{fmtDate(r.dateTo)}</td>
                            <td style={{ padding: '7px 14px' }}><DayOffPills days={r.offDays} /></td>
                            <td style={{ padding: '7px 14px' }}>
                              {isActive  && <Badge text="Active"  color="#059669" bg="#f0fdf4" />}
                              {isExpired && <Badge text="Expired" color="#dc2626" bg="#fff5f5" />}
                              {isFuture  && <Badge text="Future"  color="#7e3af2" bg="#f5f3ff" />}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}

        </div>
      )}
    </div>
  );
};

export default RosterReport;
