import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import api from '../../api/client.js';
import { useSettings } from '../../context/SettingsContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useData } from '../../context/DataContext.jsx';
import { adToBS, bsToAD, getBSDays, BS_MONTHS_EN, BS_MONTHS_NP, toNepaliDigits, getNepalNow, getNepalTodayISO } from '../../utils/dateUtils.js';
import NepaliDatePicker from '../Common/NepaliDatePicker.jsx';
import StaffDropdown    from '../Common/StaffDropdown.jsx';
import MultiCheckSelect from '../Common/MultiCheckSelect.jsx';
import { CATEGORIES, categorize, fmtPunchTime, dutyRosterRange, presentFlags } from '../../utils/attendanceCalendar.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* ── Date range input — BS picker for Nepali-calendar tenants, native
   input[type=date] otherwise (same pattern as DutyRoster.jsx's DateInput) ── */
const DateInput = ({ value, onChange, min }) => {
  const { settings } = useSettings();
  if (settings.defaultCalendar === 'np') {
    return <NepaliDatePicker value={value} onChange={onChange} />;
  }
  return (
    <input type="date" value={value} min={min} onChange={e => onChange(e.target.value)}
      style={{ height: 34, width: '100%', border: '1px solid #d1d5db', borderRadius: 7,
        padding: '0 10px', fontSize: 13, boxSizing: 'border-box', outline: 'none' }} />
  );
};

/* ── Post short-name lookup (matches DutyRosterDeptWise.jsx's convention) ── */
const getShortName = (fullName, list = []) => {
  if (!fullName) return '—';
  const found = list.find(x => (x.name || x) === fullName);
  if (found?.shortName || found?.short_name) return found.shortName || found.short_name;
  const words = fullName.trim().split(/\s+/);
  return words.length > 1 ? words.map(w => w[0].toUpperCase()).join('') : fullName.slice(0, 5);
};

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

const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

// Local-time YYYY-MM-DD (never UTC — matches the rest of the app's "local
// interpretation of the date" convention, avoiding day-shift near midnight).
const toISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const SHIFT_COLORS = ['#1a56db','#059669','#7e3af2','#d97706','#dc2626','#0891b2','#be185d'];

// Among roster entries covering the same date for the same staff member,
// the narrowest-span one wins — mirrors the backend's pickMostSpecificEntry
// (server/routes/attendance.js) and DutyRoster.jsx's identical helper, so a
// standalone single-day override (e.g. a "Day Off" applied to one date)
// correctly beats a broad ongoing shift assignment that also spans that date.
const pickMostSpecificRoster = (candidates) => {
  if (candidates.length <= 1) return candidates[0] || null;
  const span = (r) => (new Date(r.dateTo) - new Date(r.dateFrom));
  return candidates.slice().sort((a, b) => span(a) - span(b) || (b.id || 0) - (a.id || 0))[0];
};

// A shift record with no time range, or whose name reads as an off-type
// (Day Off / Night Off / etc.), isn't a real "shift" to group staff under —
// it's an override that should show up inside whatever real shift that
// person is actually on, not spawn its own department card.
const isOffTypeShift = (r) => !r.startTime || !r.endTime || /off/i.test(r.shiftName || '');

function getCurrentFY(fiscalYears = []) {
  const today = getNepalTodayISO();
  return fiscalYears.find(fy => fy.startDate <= today && fy.endDate >= today)
      || fiscalYears.find(fy => fy.isDefault)
      || fiscalYears[fiscalYears.length - 1]
      || null;
}

/* ── Company header for print output (hidden on screen, shown via the
   .print-only + #<container-id> .print-only { display:block } convention
   used across the roster print areas) ── */
const PrintCompanyHeader = ({ settings }) => {
  const name = settings.companyNameEn || settings.companyNameNp || '';
  const addr = [settings.companyAddressEn || settings.companyAddressNp,
    settings.companyPhone ? `Tel: ${settings.companyPhone}` : null].filter(Boolean).join(' · ');
  if (!name && !addr && !settings.companyLogo) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10,
      borderBottom: '2px solid #374151', paddingBottom: 8, marginBottom: 8 }}>
      {settings.companyLogo && <img src={settings.companyLogo} style={{ height: 42, objectFit: 'contain' }} />}
      <div style={{ flex: 1, textAlign: 'center' }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: '#1f2937' }}>{name}</div>
        {addr && <div style={{ fontSize: 11, color: '#6b7280' }}>{addr}</div>}
      </div>
    </div>
  );
};

/* ══════════════════════════════════════════
   Department Week Calendar
══════════════════════════════════════════ */
const DeptWeekView = ({ rosters, department, weekStart, weekEnd, settings }) => {
  const { getApprovedLeaveForDate, getLeaveTypeColor } = useData();
  const useNP   = settings?.defaultCalendar === 'np';
  const useNPDg = useNP && settings?.nepaliDigits;
  const fmtN    = n => useNPDg ? toNepaliDigits(n) : String(n);

  /* Arbitrary-length date range (not fixed to 7 days) — from weekStart to
     weekEnd inclusive, driven by the From Date / To Date range picker. */
  const days = useMemo(() => {
    const span = Math.max(0, Math.round((weekEnd - weekStart) / 86400000));
    return Array.from({ length: span + 1 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      d.setHours(0, 0, 0, 0);
      return d;
    });
  }, [weekStart, weekEnd]);

  const today = getNepalNow(); today.setHours(0, 0, 0, 0);

  const deptRosters = useMemo(() => {
    const rangeEnd = days[days.length - 1];
    return rosters.filter(r => {
      if (r.department !== department) return false;
      const from = r.dateFrom ? new Date(r.dateFrom) : null;
      const to   = r.dateTo   ? new Date(r.dateTo)   : null;
      if (to   && to   < days[0])   return false;
      if (from && from > rangeEnd)  return false;
      return true;
    });
  }, [rosters, department, days]);

  const staffList = useMemo(() => {
    const map = new Map();
    deptRosters.forEach(r => {
      if (r.employeeDbId && !map.has(r.employeeDbId))
        map.set(r.employeeDbId, { name: r.employeeName || '—', position: r.position || '' });
    });
    return [...map.entries()]
      .map(([id, v]) => ({ id, name: v.name, position: v.position }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [deptRosters]);

  const getDayInfo = (employeeDbId, adDate) => {
    const dayStart = new Date(adDate); dayStart.setHours(0,  0,  0,  0);
    const dayEnd   = new Date(adDate); dayEnd.setHours(23, 59, 59, 999);

    // Approved leave takes precedence over whatever the roster says for this
    // day — a staff member on leave isn't meaningfully "on duty" or "off",
    // they're on leave, and the short code should read as such.
    const leave = getApprovedLeaveForDate(employeeDbId, toISO(dayStart));
    if (leave) return { leave: { code: leave.leaveTypeCode, color: getLeaveTypeColor(leave.leaveTypeCode) } };

    const covering = deptRosters.filter(r => {
      if (r.employeeDbId !== employeeDbId) return false;
      const from = r.dateFrom ? new Date(r.dateFrom) : null;
      const to   = r.dateTo   ? new Date(r.dateTo)   : null;
      return (!from || from <= dayEnd) && (!to || to >= dayStart);
    });
    const r = pickMostSpecificRoster(covering);
    if (!r) return null;
    const dayName = DAYS[dayStart.getDay()];
    const isOff = (r.offDays || []).includes(dayName) || isOffTypeShift(r);
    return { isOff, shiftName: r.shiftName };
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
        No roster entries for "{department}" in this date range
      </div>
    );
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
        <thead>
          <tr style={{ background: '#efefef', borderBottom: '2px solid #dedede' }}>
            <th style={{ padding: '4px 8px', textAlign: 'center', fontWeight: 700,
              color: HDR_COLOR, fontSize: 12.5, borderRight: '1px solid #dedede', width: 48 }}>
              SN
            </th>
            <th style={{ padding: '4px 8px', textAlign: 'left', fontWeight: 700, color: HDR_COLOR,
              fontSize: 12.5, borderRight: '1px solid #dedede', minWidth: 160, whiteSpace: 'nowrap' }}>
              Staff Name
            </th>
            <th style={{ padding: '4px 8px', textAlign: 'center', fontWeight: 700, color: HDR_COLOR,
              fontSize: 12.5, borderRight: '1px solid #dedede', minWidth: 70, whiteSpace: 'nowrap' }}>
              Post
            </th>
            {days.map((d, i) => {
              const isToday  = d.toDateString() === today.toDateString();
              const { date, month } = fmtDayHeader(d);
              return (
                <th key={i} style={{ padding: '4px 8px', textAlign: 'center', fontWeight: 700,
                  fontSize: 12.5, color: isToday ? '#1a56db' : HDR_COLOR,
                  borderRight: i < days.length - 1 ? '1px solid #dedede' : 'none',
                  background: isToday ? '#eff6ff' : '#efefef', minWidth: 100 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 2 }}>{DAYS[d.getDay()]}</div>
                  <div style={{ fontSize: 11, fontWeight: 800 }}>{date} {month}</div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {staffList.map((s, si) => (
            <tr key={s.id} style={{ borderBottom: '1px solid #f3f4f6',
              background: si % 2 === 0 ? '#fff' : '#f3f4f6' }}>
              <td style={{ padding: '3px 8px', textAlign: 'center', fontSize: 12.5,
                fontWeight: 600, color: HDR_COLOR, borderRight: '1px solid #dedede',
                background: '#efefef' }}>
                {si + 1}
              </td>
              <td style={{ padding: '3px 8px', fontWeight: 600, color: '#111827', fontSize: 12.5,
                borderRight: '1px solid #e5e7eb', whiteSpace: 'nowrap' }}>{s.name}</td>
              <td style={{ padding: '3px 8px', textAlign: 'center', color: '#374151', fontSize: 12.5,
                borderRight: '1px solid #e5e7eb', whiteSpace: 'nowrap' }} title={s.position}>
                {getShortName(s.position, settings?.posts)}
              </td>
              {days.map((d, di) => {
                const info = getDayInfo(s.id, d);
                const isTd = d.toDateString() === today.toDateString();
                let bg = isTd ? '#f0f9ff' : 'transparent';
                let cell;
                if (!info) {
                  cell = <span style={{ color: '#d1d5db', fontSize: 12.5 }}>—</span>;
                } else if (info.leave) {
                  bg   = info.leave.color + '18';
                  cell = <span style={{ fontSize: 12, fontWeight: 700, color: info.leave.color }}>{info.leave.code}</span>;
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
                  <td key={di} style={{ padding: '3px 8px', textAlign: 'center', background: bg,
                    borderRight: di < days.length - 1 ? '1px solid #f3f4f6' : 'none' }}>
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
   Department Shift Grid — Shift Wise view. One table per department: a
   shared day-column header, then a divider row + that shift's staff for
   each real shift the department is running (Day Off / Night Off style
   entries never get their own section — see isOffTypeShift — they surface
   as a "Day Off" cell inside whichever real shift the person is on).
══════════════════════════════════════════ */
const DeptShiftGrid = ({ rosters, department, shiftNames, weekStart, weekEnd, settings }) => {
  const { getApprovedLeaveForDate, getLeaveTypeColor } = useData();
  const useNP   = settings?.defaultCalendar === 'np';
  const useNPDg = useNP && settings?.nepaliDigits;
  const fmtN    = n => useNPDg ? toNepaliDigits(n) : String(n);

  const days = useMemo(() => {
    const span = Math.max(0, Math.round((weekEnd - weekStart) / 86400000));
    return Array.from({ length: span + 1 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      d.setHours(0, 0, 0, 0);
      return d;
    });
  }, [weekStart, weekEnd]);

  const today = getNepalNow(); today.setHours(0, 0, 0, 0);

  /* Every roster row for this department in range — deliberately not
     shift-filtered, so a standalone off-type override still resolves on
     whichever day it covers even though it's grouped under the person's
     real shift below. */
  const deptRosters = useMemo(() => {
    const rangeEnd = days[days.length - 1];
    return rosters.filter(r => {
      if (r.department !== department) return false;
      const from = r.dateFrom ? new Date(r.dateFrom) : null;
      const to   = r.dateTo   ? new Date(r.dateTo)   : null;
      if (to   && to   < days[0])   return false;
      if (from && from > rangeEnd)  return false;
      return true;
    });
  }, [rosters, department, days]);

  const getDayInfo = (employeeDbId, adDate) => {
    const dayStart = new Date(adDate); dayStart.setHours(0,  0,  0,  0);
    const dayEnd   = new Date(adDate); dayEnd.setHours(23, 59, 59, 999);

    const leave = getApprovedLeaveForDate(employeeDbId, toISO(dayStart));
    if (leave) return { leave: { code: leave.leaveTypeCode, color: getLeaveTypeColor(leave.leaveTypeCode) } };

    const covering = deptRosters.filter(r => {
      if (r.employeeDbId !== employeeDbId) return false;
      const from = r.dateFrom ? new Date(r.dateFrom) : null;
      const to   = r.dateTo   ? new Date(r.dateTo)   : null;
      return (!from || from <= dayEnd) && (!to || to >= dayStart);
    });
    const r = pickMostSpecificRoster(covering);
    if (!r) return null;
    const dayName = DAYS[dayStart.getDay()];
    const isOff = (r.offDays || []).includes(dayName) || isOffTypeShift(r);
    return { isOff, shiftName: r.shiftName };
  };

  /* One section per real shift — staff membership comes from that shift's
     own roster rows only (an off-type override alone doesn't put someone
     on a shift), sorted by name within the section. */
  const sections = useMemo(() => shiftNames.map(shiftName => {
    const map = new Map();
    deptRosters
      .filter(r => r.shiftName === shiftName)
      .forEach(r => {
        if (r.employeeDbId && !map.has(r.employeeDbId))
          map.set(r.employeeDbId, { name: r.employeeName || '—', position: r.position || '' });
      });
    const staffList = [...map.entries()]
      .map(([id, v]) => ({ id, name: v.name, position: v.position }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { shiftName, staffList };
  }).filter(s => s.staffList.length > 0), [deptRosters, shiftNames]);

  const fmtDayHeader = (d) => {
    if (useNP) {
      const bs = adToBS(d);
      if (bs) return { date: fmtN(bs.day), month: BS_MONTHS_EN[bs.month - 1] || '' };
    }
    return { date: String(d.getDate()), month: d.toLocaleDateString('en-GB', { month: 'short' }) };
  };

  const HDR_COLOR = '#374151';
  const colCount = 3 + days.length;

  if (sections.length === 0) {
    return (
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12,
        padding: '40px', textAlign: 'center', color: '#9ca3af', fontSize: 14, fontWeight: 600 }}>
        No roster entries for "{department}" in this date range
      </div>
    );
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
        <thead>
          <tr style={{ background: '#efefef', borderBottom: '2px solid #dedede' }}>
            <th style={{ padding: '4px 8px', textAlign: 'center', fontWeight: 700,
              color: HDR_COLOR, fontSize: 12.5, borderRight: '1px solid #dedede', width: 48 }}>SN</th>
            <th style={{ padding: '4px 8px', textAlign: 'left', fontWeight: 700, color: HDR_COLOR,
              fontSize: 12.5, borderRight: '1px solid #dedede', minWidth: 160, whiteSpace: 'nowrap' }}>Staff Name</th>
            <th style={{ padding: '4px 8px', textAlign: 'center', fontWeight: 700, color: HDR_COLOR,
              fontSize: 12.5, borderRight: '1px solid #dedede', minWidth: 70, whiteSpace: 'nowrap' }}>Post</th>
            {days.map((d, i) => {
              const isToday  = d.toDateString() === today.toDateString();
              const { date, month } = fmtDayHeader(d);
              return (
                <th key={i} style={{ padding: '4px 8px', textAlign: 'center', fontWeight: 700,
                  fontSize: 12.5, color: isToday ? '#1a56db' : HDR_COLOR,
                  borderRight: i < days.length - 1 ? '1px solid #dedede' : 'none',
                  background: isToday ? '#eff6ff' : '#efefef', minWidth: 100 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 2 }}>{DAYS[d.getDay()]}</div>
                  <div style={{ fontSize: 11, fontWeight: 800 }}>{date} {month}</div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sections.map(({ shiftName, staffList }, si) => (
            <React.Fragment key={shiftName}>
              <tr>
                <td colSpan={colCount} style={{ padding: '7px 14px', background: '#f8fafc',
                  borderTop: '2px solid #dedede', borderBottom: '1px solid #e5e7eb' }}>
                  <span style={{ fontSize: 13 }}>🔄</span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: '#111827', marginLeft: 8 }}>
                    {department} : {shiftName}
                  </span>
                  <span style={{
                    background: SHIFT_COLORS[si % SHIFT_COLORS.length], color: '#fff',
                    borderRadius: 10, fontSize: 11, fontWeight: 700,
                    padding: '2px 8px', marginLeft: 10,
                  }}>No. of Staff: {staffList.length}</span>
                </td>
              </tr>
              {staffList.map((s, ri) => (
                <tr key={s.id} style={{ borderBottom: '1px solid #f3f4f6',
                  background: ri % 2 === 0 ? '#fff' : '#f3f4f6' }}>
                  <td style={{ padding: '3px 8px', textAlign: 'center', fontSize: 12.5,
                    fontWeight: 600, color: HDR_COLOR, borderRight: '1px solid #dedede',
                    background: '#efefef' }}>
                    {ri + 1}
                  </td>
                  <td style={{ padding: '3px 8px', fontWeight: 600, color: '#111827', fontSize: 12.5,
                    borderRight: '1px solid #e5e7eb', whiteSpace: 'nowrap' }}>{s.name}</td>
                  <td style={{ padding: '3px 8px', textAlign: 'center', color: '#374151', fontSize: 12.5,
                    borderRight: '1px solid #e5e7eb', whiteSpace: 'nowrap' }} title={s.position}>
                    {getShortName(s.position, settings?.posts)}
                  </td>
                  {days.map((d, di) => {
                    const info = getDayInfo(s.id, d);
                    const isTd = d.toDateString() === today.toDateString();
                    let bg = isTd ? '#f0f9ff' : 'transparent';
                    let cell;
                    if (!info) {
                      cell = <span style={{ color: '#d1d5db', fontSize: 12.5 }}>—</span>;
                    } else if (info.leave) {
                      bg   = info.leave.color + '18';
                      cell = <span style={{ fontSize: 12, fontWeight: 700, color: info.leave.color }}>{info.leave.code}</span>;
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
                      <td key={di} style={{ padding: '3px 8px', textAlign: 'center', background: bg,
                        borderRight: di < days.length - 1 ? '1px solid #f3f4f6' : 'none' }}>
                        {cell}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/* ══════════════════════════════════════════
   Shift Wise Filter Popup — Department + Fiscal Year/Month + Date Range,
   opened on every "Shift Wise" tab click.
══════════════════════════════════════════ */
const ShiftFilterModal = ({ open, onClose, depts, deptFilter, onDeptChange,
  fiscalYears, filterFYId, onFYChange, filterMonth, onMonthChange, monthLabel,
  rangeFrom, rangeTo, onRangeFromChange, onRangeToChange }) => {
  if (!open) return null;
  const Lbl = ({ children }) => (
    <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 5 }}>{children}</div>
  );
  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,.45)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 14, width: 520, maxWidth: '95vw',
        boxShadow: '0 20px 60px rgba(0,0,0,.22)', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #e5e7eb',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#111827' }}>🔄 Shift Wise Filters</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>Showing: {monthLabel}</div>
          </div>
          <button onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer',
              color: '#9ca3af', fontSize: 20, lineHeight: 1, padding: '4px 8px', borderRadius: 6 }}
            onMouseEnter={e => e.currentTarget.style.background = '#f3f4f6'}
            onMouseLeave={e => e.currentTarget.style.background = 'none'}>✕</button>
        </div>

        {/* Body */}
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: '0 0 130px' }}>
              <Lbl>Fiscal Year</Lbl>
              <select value={filterFYId ?? ''} onChange={e => onFYChange(e.target.value ? parseInt(e.target.value) : null)}
                style={{ width: '100%', height: 36, border: '1.5px solid #d1d5db', borderRadius: 7,
                  padding: '0 8px', fontSize: 13, fontWeight: 600, color: '#374151', outline: 'none',
                  background: 'white', cursor: 'pointer' }}>
                {fiscalYears.map(fy => <option key={fy.id} value={fy.id}>{fy.name}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <Lbl>Department</Lbl>
              <MultiCheckSelect value={deptFilter} onChange={onDeptChange}
                options={depts} placeholder="All Departments" />
            </div>
          </div>

          <div>
            <Lbl>Month</Lbl>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {BS_MONTHS_EN.map((m, i) => (
                <button key={m} onClick={() => onMonthChange(i + 1)}
                  style={{ padding: '5px 10px', border: `1.5px solid ${filterMonth === i + 1 ? '#1a56db' : '#e5e7eb'}`,
                    borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                    background: filterMonth === i + 1 ? '#1a56db' : 'white',
                    color:      filterMonth === i + 1 ? 'white'   : '#374151' }}>
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <Lbl>From Date</Lbl>
              <DateInput value={rangeFrom} onChange={onRangeFromChange} />
            </div>
            <div style={{ flex: 1 }}>
              <Lbl>To Date</Lbl>
              <DateInput value={rangeTo} onChange={onRangeToChange} min={rangeFrom} />
            </div>
          </div>
          <div style={{ fontSize: 11, color: '#9ca3af' }}>
            💡 Defaults to the week of the month containing today's date.
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 20px', borderTop: '1px solid #e5e7eb',
          display: 'flex', justifyContent: 'flex-end', background: '#f9fafb' }}>
          <button onClick={onClose}
            style={{ height: 36, padding: '0 22px', fontSize: 13, fontWeight: 700,
              background: '#1a56db', color: '#fff', border: 'none', borderRadius: 8,
              cursor: 'pointer', boxShadow: '0 2px 8px rgba(26,86,219,.3)' }}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
};

/* ══════════════════════════════════════════
   Staff Calendar View
══════════════════════════════════════════ */
const StaffCalendar = ({ staff, rosters, settings, initialYear, initialMonth, onMonthChange,
  employees, canChangeStaff, onChangeStaff }) => {
  const useNP    = settings?.defaultCalendar === 'np';
  const useNPDg  = settings?.nepaliDigits && useNP;
  const today    = getNepalNow();
  const todayBS  = adToBS(getNepalTodayISO());
  const todayStr = getNepalTodayISO();
  const fmt      = n => useNPDg ? toNepaliDigits(n) : String(n);

  /* ── Navigation state ── */
  const [navYear,  setNavYear]  = useState(() => initialYear  ?? (useNP ? (todayBS?.year  || today.getFullYear()) : today.getFullYear()));
  const [navMonth, setNavMonth] = useState(() => initialMonth ?? (useNP ? (todayBS?.month || today.getMonth() + 1) : today.getMonth())); // BS: 1-12, AD: 0-11

  /* Jump to the filter's month whenever the selected staff or the outer
     Fiscal Year / Month filter changes — free prev/next navigation after
     that is left alone (not fought back every render). */
  useEffect(() => {
    if (initialYear != null && initialMonth != null) { setNavYear(initialYear); setNavMonth(initialMonth); }
  }, [staff?.id, initialYear, initialMonth]);

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

  useEffect(() => { onMonthChange?.(monthLabel); }, [monthLabel]);

  /* ── Get AD Date for a given calendar day ── */
  const getADDate = (d) => useNP ? bsToAD(navYear, navMonth, d) : new Date(navYear, navMonth, d);

  /* ── Attendance ledger for the navigated staff+month — same
     /attendance/staff-ledger source and day categorization the Dashboard's
     My Monthly Calendar uses, so both render a day identically. Refetches
     whenever the viewed staff or navigated month changes. ── */
  const [ledgerByDate, setLedgerByDate] = useState({});
  useEffect(() => {
    if (!staff?.id) { setLedgerByDate({}); return; }
    const firstAdDate = getADDate(1);
    const lastAdDate  = getADDate(daysInMonth);
    if (!firstAdDate || !lastAdDate) { setLedgerByDate({}); return; }
    api.get(`/attendance/staff-ledger?employeeId=${staff.id}&startDate=${toISO(firstAdDate)}&endDate=${toISO(lastAdDate)}`)
      .then(res => {
        const map = {};
        (res.days || []).forEach(d => { map[d.dateStr] = d; });
        setLedgerByDate(map);
      })
      .catch(() => setLedgerByDate({}));
  }, [staff?.id, navYear, navMonth, useNP]);

  /* ── Is today ── */
  const isToday = (d) => {
    if (useNP) return todayBS && navYear === todayBS.year && navMonth === todayBS.month && d === todayBS.day;
    return d === today.getDate() && navMonth === today.getMonth() && navYear === today.getFullYear();
  };

  /* ── Build cells ── */
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  /* ── Stats for current nav month — Present/Absent/Late-In/Early-Out/Leave,
     capped at "not after today" so a partially/fully future month doesn't
     count not-yet-happened days as Absent (a fully past month is
     unaffected — every day in it is already <= today). ── */
  let presentDays = 0, absentDays = 0, lateInDays = 0, earlyOutDays = 0, leaveDays = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const adDate = getADDate(d);
    if (!adDate) continue;
    const dateStr = toISO(adDate);
    if (dateStr > todayStr) continue;
    const entry = ledgerByDate[dateStr];
    if (!entry) continue;
    if (entry.leave) leaveDays++;
    else if (entry.status === 'Present') presentDays++;
    else if (entry.status !== 'Weekend') absentDays++;
    if (entry.lateMins)  lateInDays++;
    if (entry.earlyMins) earlyOutDays++;
  }

  /* ── Prev/next staff, within the role-scoped employees list — narrowed
     further by an optional Department filter (defaults to All Departments). ── */
  const [deptFilter, setDeptFilter] = useState('');
  const allStaff = employees || [];
  const deptOpts = useMemo(() =>
    [...new Set(allStaff.map(e => e.department).filter(Boolean))].sort(),
    [allStaff]);
  const staffList = useMemo(() =>
    deptFilter ? allStaff.filter(e => e.department === deptFilter) : allStaff,
    [allStaff, deptFilter]);
  const staffIdx  = staffList.findIndex(e => e.id === staff.id);
  const goStaffPrev = () => { if (staffIdx > 0) onChangeStaff?.(staffList[staffIdx - 1].id); };
  const goStaffNext = () => { if (staffIdx >= 0 && staffIdx < staffList.length - 1) onChangeStaff?.(staffList[staffIdx + 1].id); };

  /* Filtering to a department that doesn't include the currently-viewed
     staff jumps to the first person in that department instead of leaving
     prev/next pointing at nobody (staffIdx === -1). */
  useEffect(() => {
    if (!canChangeStaff || !deptFilter) return;
    if (!staffList.some(e => e.id === staff.id) && staffList.length) {
      onChangeStaff?.(staffList[0].id);
    }
  }, [deptFilter]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Staff info + stats bar */}
      <div className="src-cal-statbar" style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12,
        padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        {/* Department filter — narrows prev/next + search to one
            department; defaults to All Departments. Admin, Branch Manager,
            Department Head only, same as the rest of this bar. */}
        {canChangeStaff && (
          <div className="no-print" style={{ minWidth: 220 }}>
            <MultiCheckSelect single label="Department"
              value={deptFilter ? [deptFilter] : []}
              onChange={arr => setDeptFilter(arr[0] || '')}
              options={deptOpts} placeholder="All Departments" />
          </div>
        )}
        {/* Prev/next staff — Admin, Branch Manager, Department Head only;
            scoped to the same role-filtered employees list as everywhere
            else (own branch for a Branch Manager, own department for a
            Department Head, everyone for Admin/SuperAdmin). */}
        {canChangeStaff && (
          <button className="no-print" onClick={goStaffPrev} disabled={staffIdx <= 0}
            style={{ width: 32, height: 32, border: '1px solid #d1d5db', borderRadius: 7,
              background: '#fff', cursor: staffIdx <= 0 ? 'not-allowed' : 'pointer',
              color: staffIdx <= 0 ? '#d1d5db' : '#374151', fontSize: 15, fontWeight: 700, flexShrink: 0 }}>
            ‹
          </button>
        )}
        {/* Avatar + name/role — redundant on paper with the "Monthly Duty
            Roster | Name" title already printed above, so hidden for print
            (display:contents keeps them as normal flex children on screen). */}
        <div className="src-cal-avatarblock" style={{ display: 'contents' }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: '#eff6ff',
            border: '1.5px solid #bfdbfe', display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontSize: 18, color: '#1a56db', fontWeight: 800, flexShrink: 0 }}>
            {(staff.fullName || '?')[0].toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            <div className="src-cal-staffname" style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>{staff.fullName}</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
              {[staff.position, staff.department, staff.deviceId ? `[${staff.deviceId}]` : null]
                .filter(Boolean).join(' · ')}
            </div>
          </div>
        </div>
        <div className="src-cal-summary-print" style={{ display: 'none', fontSize: 11, fontWeight: 700, color: '#111827' }}>
          Monthly Summary Details
        </div>
        {canChangeStaff && (
          <button className="no-print" onClick={goStaffNext} disabled={staffIdx < 0 || staffIdx >= staffList.length - 1}
            style={{ width: 32, height: 32, border: '1px solid #d1d5db', borderRadius: 7,
              background: '#fff', cursor: (staffIdx < 0 || staffIdx >= staffList.length - 1) ? 'not-allowed' : 'pointer',
              color: (staffIdx < 0 || staffIdx >= staffList.length - 1) ? '#d1d5db' : '#374151',
              fontSize: 15, fontWeight: 700, flexShrink: 0 }}>
            ›
          </button>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[
            { label: 'Present',    value: presentDays,   color: '#059669', bg: '#f0fdf4', border: '#6ee7b7' },
            { label: 'Absent',     value: absentDays,    color: '#dc2626', bg: '#fff5f5', border: '#fca5a5' },
            { label: 'Late In',    value: lateInDays,    color: '#0f3d57', bg: '#eff6ff', border: '#bfdbfe' },
            { label: 'Early Out',  value: earlyOutDays,  color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe' },
            { label: 'Leave',      value: leaveDays,     color: '#d97706', bg: '#fffbeb', border: '#fde68a' },
          ].map(s => (
            <div key={s.label} className="src-cal-stat" style={{ background: s.bg, border: `1px solid ${s.border}`,
              borderRadius: 8, padding: '7px 14px', textAlign: 'center', minWidth: 72 }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: s.color, lineHeight: 1 }}>{fmt(s.value)}</div>
              <div style={{ fontSize: 10, fontWeight: 600, color: '#6b7280', marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
        {/* Inline staff filter — replaces the old "Change Staff" popup */}
        {canChangeStaff && (
          <div className="no-print" style={{ minWidth: 340, flexBasis: 340, flexGrow: 1 }}>
            <StaffDropdown employees={staffList} value={staff.id}
              onChange={id => onChangeStaff?.(id)} />
          </div>
        )}
      </div>

      {/* Calendar card */}
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>

        {/* Month nav + legend */}
        <div style={{ padding: '10px 16px', background: '#f8fafc', borderBottom: '1px solid #e5e7eb',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>

          {/* Prev / Month label / Next */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button className="no-print" onClick={goPrev}
              style={{ width: 30, height: 30, border: '1px solid #d1d5db', borderRadius: 7,
                background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center',
                justifyContent: 'center', color: '#374151', fontSize: 14 }}
              onMouseEnter={e => e.currentTarget.style.background = '#f3f4f6'}
              onMouseLeave={e => e.currentTarget.style.background = '#fff'}>‹</button>
            <span className="src-cal-monthlabel" style={{ fontSize: 13, fontWeight: 800, color: '#111827', minWidth: 150, textAlign: 'center' }}>
              📅 {monthLabel}
            </span>
            <button className="no-print" onClick={goNext}
              style={{ width: 30, height: 30, border: '1px solid #d1d5db', borderRadius: 7,
                background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center',
                justifyContent: 'center', color: '#374151', fontSize: 14 }}
              onMouseEnter={e => e.currentTarget.style.background = '#f3f4f6'}
              onMouseLeave={e => e.currentTarget.style.background = '#fff'}>›</button>
          </div>

          {/* Legend — same categories/colors as the Dashboard's My Monthly Calendar.
              Print gets a separate plain-text "code = label" key instead
              (src-cal-legend-print, below) since print strips all color. */}
          <div className="src-cal-legend" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {Object.values(CATEGORIES).map(c => (
              <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 11, height: 11, borderRadius: 3, flexShrink: 0,
                  background: c.bg, border: `1.5px solid ${c.color}` }} />
                <span style={{ fontSize: 12, color: '#6b7280' }}>{c.label}</span>
              </div>
            ))}
          </div>
          <div className="src-cal-legend-print" style={{ display: 'none', fontSize: 8, color: '#000' }}>
            {Object.values(CATEGORIES).map(c => `${c.shortCode} = ${c.label}`).join('   ·   ')}
          </div>
        </div>

        {/* Day-of-week header */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)',
          background: '#f8fafc', borderBottom: '2px solid #e5e7eb' }}>
          {DAYS.map(d => (
            <div key={d} className="src-cal-dow" style={{ padding: '8px 4px', textAlign: 'center',
              fontSize: 13, fontWeight: 700, color: d === 'Sun' ? '#dc2626' : '#6b7280' }}>
              {d}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="src-cal-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)' }}>
          {cells.map((d, idx) => {
            if (d === null) return (
              <div key={`e-${idx}`} className="src-cal-cell" style={{
                minHeight: 82, background: '#fafafa',
                borderBottom: '1px solid #efefef',
                borderRight: (idx + 1) % 7 !== 0 ? '1px solid #efefef' : 'none'
              }} />
            );

            const adDate   = getADDate(d);
            const dateStr  = adDate ? toISO(adDate) : null;
            const entry    = dateStr ? ledgerByDate[dateStr] : null;
            const isFuture = dateStr ? dateStr > todayStr : false;
            const cat      = categorize(entry, isFuture);
            const st       = cat ? CATEGORIES[cat] : { bg: isFuture ? '#ffffff' : '#fafafa', color: '#cbd5e1' };
            const tod      = isToday(d);
            const dow      = (firstDay + d - 1) % 7;
            const timeIn   = fmtPunchTime(entry?.timeIn);
            const timeOut  = fmtPunchTime(entry?.timeOut);
            const label    = cat === 'holiday' ? (entry.holidayName || st.label)
                            : cat === 'leave'   ? entry.leave
                            : (cat ? st.label : null);
            const rosterRange = dutyRosterRange(entry, cat, !!timeIn);
            const flags       = cat === 'present' ? presentFlags(entry) : [];
            // Compact 24-hour print-only equivalents — "12:00 PM - 6:00 PM"
            // is far too wide for a ~26mm-wide print column at any readable
            // size; "12:00-18:00" fits on one line.
            const rosterRangePrint = rosterRange ? `${(entry.shiftStart || '').slice(0, 5)}-${(entry.shiftEnd || '').slice(0, 5)}` : null;
            const timeInPrint  = entry?.timeIn  ? new Date(entry.timeIn).toTimeString().slice(0, 5)  : null;
            const timeOutPrint = entry?.timeOut ? new Date(entry.timeOut).toTimeString().slice(0, 5) : null;

            return (
              <div key={d} className="src-cal-cell" style={{
                minHeight: 82, background: st.bg,
                borderBottom: '1px solid #e5e7eb',
                borderRight: (idx + 1) % 7 !== 0 ? '1px solid #e5e7eb' : 'none',
                padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 4,
                outline: tod ? '2px solid #1a56db' : 'none', outlineOffset: -2
              }}>
                {/* Day number + Duty Roster (top row, roster on the right — screen only;
                    print moves its version below, full-width, see .src-cal-roster-print) */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 4 }}>
                  <div className="src-cal-daynum" style={{
                    flexShrink: 0, width: 26, height: 26, borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, fontWeight: tod ? 800 : 500,
                    background: tod ? '#1a56db' : 'transparent',
                    color: tod ? '#fff' : dow === 0 ? '#dc2626' : '#374151'
                  }}>{fmt(d)}</div>
                  {rosterRange && (
                    <span className="src-cal-roster-full" style={{ fontSize: 10.5, color: '#0f3d57', fontWeight: 600, lineHeight: 1.3, textAlign: 'right' }}>
                      Duty Roster<br />{rosterRange}
                    </span>
                  )}
                </div>

                {rosterRange && (
                  <div className="src-cal-roster-print" style={{ display: 'none', color: '#0f3d57', fontWeight: 700 }}>
                    Roster {rosterRangePrint}
                  </div>
                )}

                {label && (
                  <div className="src-cal-label" style={{ fontSize: 11, fontWeight: 700, color: st.color, overflow: 'hidden',
                    textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
                )}
                {cat && (
                  <div className="src-cal-label-short" style={{ display: 'none', fontWeight: 700, color: st.color }}>
                    {CATEGORIES[cat].shortCode}
                  </div>
                )}
                {flags.length > 0 && (
                  <div className="src-cal-flags" style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                    {flags.map(f => (
                      <span key={f.label} style={{ fontSize: 9, fontWeight: 700, color: f.color, background: f.bg,
                        border: `1px solid ${f.border}`, borderRadius: 20, padding: '1px 6px', lineHeight: 1.5 }}>{f.label}</span>
                    ))}
                  </div>
                )}
                {timeIn && (
                  <div>
                    <div className="src-cal-time" style={{ fontSize: 10.5, color: '#64748b', fontWeight: 600 }}>
                      {timeIn}{timeOut ? ` – ${timeOut}` : ''}
                    </div>
                    <div className="src-cal-punch-print" style={{ display: 'none', color: '#64748b', fontWeight: 700 }}>
                      Punch {timeInPrint}{timeOutPrint ? `-${timeOutPrint}` : ''}
                    </div>
                  </div>
                )}
                {!label && !timeIn && !rosterRange && (
                  <div style={{ fontSize: 12, color: '#d1d5db', textAlign: 'center', marginTop: 4 }}>–</div>
                )}
              </div>
            );
          })}
        </div>

        {/* Roster entries footer */}
        {rosters.length > 0 ? (
          <div className="src-cal-footer" style={{ padding: '8px 16px', background: '#f8fafc', borderTop: '1px solid #e5e7eb',
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
  const { currentUser, isAdmin, isBranchManager, isDeptHead } = useAuth();
  const canChangeStaff = isAdmin || isBranchManager || isDeptHead;
  const { filteredEmployees: employees, getApprovedLeaveForDate } = useData();

  const [rosters,   setRosters]   = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);
  const [view,      setView]      = useState('staff'); // staff | department | shift
  const [search,    setSearch]    = useState('');

  /* Staff Wise state — the flat all-staff grid and staff-picker popup are
     both gone; it's always the calendar view for selectedStaff, switched
     via the inline prev/next + search built into StaffCalendar itself. */
  const [selectedStaff, setSelectedStaff] = useState(null);

  /* Department view state — explicit From Date / To Date range instead of
     week-stepping; empty until the default-week effect below seeds it.
     deptFilter is multi-select: [] means "All Departments". */
  const [rangeFrom,  setRangeFrom]  = useState('');
  const [rangeTo,    setRangeTo]    = useState('');
  const [deptFilter, setDeptFilter] = useState([]);

  /* Shift Wise state — its own popup filter (Department + Month + Date
     Range), opened whenever the "Shift Wise" tab is clicked. */
  const [shiftFilterOpen, setShiftFilterOpen] = useState(false);
  const [shiftDeptFilter, setShiftDeptFilter] = useState([]);
  const [shiftRangeFrom,  setShiftRangeFrom]  = useState('');
  const [shiftRangeTo,    setShiftRangeTo]    = useState('');

  /* Report month filter (Fiscal Year + Month) — drives which month's data
     shows in Staff Wise / Shift Wise, which week Department Wise opens on,
     and which month the Staff calendar opens on. */
  const today   = getNepalNow();
  const todayBS = adToBS(getNepalTodayISO());
  const currentFYObj = useMemo(() => getCurrentFY(settings.fiscalYears || []), [settings.fiscalYears]);
  const [filterFYId,  setFilterFYId]  = useState(() => currentFYObj?.id ?? null);
  const [filterMonth, setFilterMonth] = useState(() => todayBS?.month || 1); // BS month, 1-12
  const [calMonthLabel, setCalMonthLabel] = useState('');

  /* Default Staff Wise to the logged-in user's own calendar. A login with
     no linked staff record (e.g. a bare admin account) has no "own"
     roster to show — elevated roles fall back to the first staff member
     instead of leaving the page blank; a regular employee login in that
     situation just sees the "no roster" message (see render below). */
  useEffect(() => {
    if (!currentUser || !employees.length || selectedStaff) return;
    const me = employees.find(e => e.id === currentUser.id);
    if (me) { setSelectedStaff(me); }
    else if (canChangeStaff) {
      const first = [...employees].sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''))[0];
      if (first) setSelectedStaff(first);
    }
  }, [currentUser, employees, canChangeStaff, selectedStaff]);

  /* HOD: auto-filter to their department */
  useEffect(() => {
    if (currentUser?.role === 'departmentHead' && currentUser.department) {
      setDeptFilter([currentUser.department]);
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

  const useNP   = settings?.defaultCalendar === 'np';
  const useNPDg = useNP && settings?.nepaliDigits;
  const fmtN    = n => useNPDg ? toNepaliDigits(n) : String(n);

  /* ── Filter month window (Fiscal Year + Month, BS-native like the rest
     of the roster pages) — replaces the old "always today's month" logic ── */
  const filterFYObj = useMemo(() =>
    (settings.fiscalYears || []).find(fy => fy.id === filterFYId) || currentFYObj,
    [settings.fiscalYears, filterFYId, currentFYObj]);
  const filterYear = useMemo(() => {
    const bs = filterFYObj ? adToBS(new Date(filterFYObj.startDate)) : null;
    return bs?.year || todayBS?.year || today.getFullYear();
  }, [filterFYObj, todayBS, today]);
  const monthStart = useMemo(() =>
    bsToAD(filterYear, filterMonth, 1) || new Date(today.getFullYear(), today.getMonth(), 1),
    [filterYear, filterMonth, today]);
  const daysInFilterMonth = useMemo(() => getBSDays(filterYear, filterMonth) || 30, [filterYear, filterMonth]);
  const monthEnd = useMemo(() =>
    bsToAD(filterYear, filterMonth, daysInFilterMonth) || new Date(today.getFullYear(), today.getMonth() + 1, 0),
    [filterYear, filterMonth, daysInFilterMonth, today]);
  const monthLabel = `${BS_MONTHS_EN[filterMonth - 1] || ''} ${fmtN(filterYear)} BS`;

  /* Shift Wise's default date range — the day-of-month "week bucket" that
     today falls in (day 3 → 1st week → days 1-7, day 10 → 2nd week →
     days 8-14, etc.), same weekly bucketing DutyRosterDeptWise uses. Only
     anchored to today when the filter is actually on the current month;
     otherwise defaults to the 1st week since "today" means nothing there. */
  const shiftDefaultRange = useMemo(() => {
    const onCurrentMonth = todayBS && filterYear === todayBS.year && filterMonth === todayBS.month;
    const day = onCurrentMonth ? todayBS.day : 1;
    const weekNum = Math.ceil(day / 7);
    const startDay = (weekNum - 1) * 7 + 1;
    const endDay = Math.min(weekNum * 7, daysInFilterMonth);
    return {
      start: bsToAD(filterYear, filterMonth, startDay) || monthStart,
      end:   bsToAD(filterYear, filterMonth, endDay)   || monthEnd,
    };
  }, [filterYear, filterMonth, daysInFilterMonth, todayBS, monthStart, monthEnd]);

  /* Re-seed the Shift Wise range whenever Fiscal Year / Month changes. */
  useEffect(() => {
    setShiftRangeFrom(toISO(shiftDefaultRange.start));
    setShiftRangeTo(toISO(shiftDefaultRange.end));
  }, [filterFYId, filterMonth]);

  const shiftWeekStart = useMemo(() => {
    if (!shiftRangeFrom) return shiftDefaultRange.start;
    const d = new Date(shiftRangeFrom + 'T00:00:00'); d.setHours(0, 0, 0, 0);
    return d;
  }, [shiftRangeFrom, shiftDefaultRange]);
  const shiftWeekEnd = useMemo(() => {
    if (!shiftRangeTo) return shiftDefaultRange.end;
    const d = new Date(shiftRangeTo + 'T00:00:00'); d.setHours(0, 0, 0, 0);
    return d < shiftWeekStart ? shiftWeekStart : d;
  }, [shiftRangeTo, shiftDefaultRange, shiftWeekStart]);

  /* Seed for the Staff calendar's initial month — BS terms when the tenant
     uses the Nepali calendar, else the equivalent AD month/year. */
  const initialCalYear  = useNP ? filterYear  : monthStart.getFullYear();
  const initialCalMonth = useNP ? filterMonth : monthStart.getMonth();

  /* ── Rosters active this month ── */
  const monthRosters = useMemo(() => rosters.filter(r => {
    const from = r.dateFrom ? new Date(r.dateFrom) : null;
    const to   = r.dateTo   ? new Date(r.dateTo)   : null;
    if (to   && to   < monthStart) return false;
    if (from && from > monthEnd)   return false;
    return true;
  }), [rosters, monthStart, monthEnd]);

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

  /* ── Shift Wise's own scope — its popup filter (Department + Date Range)
     rather than the Fiscal Year/Month-only `filtered`, plus the same search
     box. ── */
  const shiftRosters = useMemo(() => {
    const q = search.toLowerCase();
    return rosters.filter(r => {
      if (shiftDeptFilter.length && !shiftDeptFilter.includes(r.department)) return false;
      const from = r.dateFrom ? new Date(r.dateFrom) : null;
      const to   = r.dateTo   ? new Date(r.dateTo)   : null;
      if (to   && to   < shiftWeekStart) return false;
      if (from && from > shiftWeekEnd)   return false;
      return !q ||
        (r.employeeName || '').toLowerCase().includes(q) ||
        (r.shiftName    || '').toLowerCase().includes(q) ||
        (r.department   || '').toLowerCase().includes(q) ||
        (r.branch       || '').toLowerCase().includes(q);
    });
  }, [rosters, shiftDeptFilter, shiftWeekStart, shiftWeekEnd, search]);

  /* ── Departments → real shift names for Shift Wise view. Off-type entries
     (Day Off / Night Off / no time range) are excluded here — they aren't
     a "shift" to group under; DeptShiftGrid surfaces them inline as a Day
     Off cell within whichever real shift that person is actually on. ── */
  const groupedByDeptShift = useMemo(() => {
    const byDept = {};
    shiftRosters.forEach(r => {
      if (isOffTypeShift(r)) return;
      const dept  = r.department || '(No Department)';
      const shift = r.shiftName  || '(Not Set)';
      const set = (byDept[dept] = byDept[dept] || new Set());
      set.add(shift);
    });
    return Object.entries(byDept)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dept, shiftSet]) => ({
        dept,
        shiftNames: [...shiftSet].sort(),
      }));
  }, [shiftRosters]);

  /* ── Date range for Dept view — defaults to the first week (Sun–Sat) of
     the filtered month, but From Date / To Date are freely editable. ── */
  const defaultWeekStart = useMemo(() => {
    const d = new Date(monthStart);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - d.getDay());
    return d;
  }, [monthStart]);
  const defaultWeekEnd = useMemo(() => {
    const d = new Date(defaultWeekStart);
    d.setDate(d.getDate() + 6);
    return d;
  }, [defaultWeekStart]);

  /* Re-seed the range whenever the Fiscal Year / Month filter changes. */
  useEffect(() => {
    setRangeFrom(toISO(defaultWeekStart));
    setRangeTo(toISO(defaultWeekEnd));
  }, [filterFYId, filterMonth]);

  const weekStart = useMemo(() => {
    if (!rangeFrom) return defaultWeekStart;
    const d = new Date(rangeFrom + 'T00:00:00'); d.setHours(0, 0, 0, 0);
    return d;
  }, [rangeFrom, defaultWeekStart]);

  const weekEnd = useMemo(() => {
    if (!rangeTo) return defaultWeekEnd;
    const d = new Date(rangeTo + 'T00:00:00'); d.setHours(0, 0, 0, 0);
    return d < weekStart ? weekStart : d;
  }, [rangeTo, defaultWeekEnd, weekStart]);

  /* ── Print meta: fiscal year, month, week number ── */
  const printMeta = (() => {
    const bsS = adToBS(weekStart);
    const bsE = adToBS(weekEnd);

    // Fiscal year — prefer the actual selected Fiscal Year's name; fall back
    // to a heuristic (Nepal: Shrawan=month4 starts new FY) if none is set.
    let fiscalYear = filterFYObj?.name;
    if (!fiscalYear) {
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
    }

    // Month name
    const monthName = useNP && bsS
      ? `${BS_MONTHS_EN[bsS.month - 1]} ${fmtN(bsS.year)} BS`
      : weekStart.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

    // Full date range label
    let rangeLabel;
    if (useNP && bsS && bsE) {
      rangeLabel = `${BS_MONTHS_EN[bsS.month - 1]} ${fmtN(bsS.day)} – ${BS_MONTHS_EN[bsE.month - 1]} ${fmtN(bsE.day)}, ${fmtN(bsE.year)} BS`;
    } else {
      rangeLabel = `${weekStart.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} – ${weekEnd.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`;
    }

    return { fiscalYear, monthName, rangeLabel };
  })();

  const depts = useMemo(() =>
    [...new Set(rosters.map(r => r.department).filter(Boolean))].sort(),
    [rosters]);

  /* Departments that actually have a roster entry overlapping the current
     date range — used for the "All Departments" multi-grid view so it
     doesn't render a wall of empty department cards. */
  const deptsInRange = useMemo(() => {
    const set = new Set();
    rosters.forEach(r => {
      if (!r.department) return;
      const from = r.dateFrom ? new Date(r.dateFrom) : null;
      const to   = r.dateTo   ? new Date(r.dateTo)   : null;
      if (to   && to   < weekStart) return;
      if (from && from > weekEnd)   return;
      set.add(r.department);
    });
    return [...set].sort();
  }, [rosters, weekStart, weekEnd]);

  /* Which departments to render — an explicit multi-select always wins;
     "All Departments" (empty selection) falls back to whichever depts
     actually have data this range (or the one department that exists
     at all, for a single-department tenant). */
  const deptsToShow = deptFilter.length > 0
    ? deptFilter
    : (depts.length === 1 ? depts : deptsInRange);
  const deptLabel = deptFilter.length === 0 ? 'All Departments' : deptFilter.join(', ');

  /* ── Dept week export ── */
  const handleDeptExport = () => {
    const span = Math.max(0, Math.round((weekEnd - weekStart) / 86400000));
    const days = Array.from({ length: span + 1 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      d.setHours(0, 0, 0, 0);
      return d;
    });
    const wEnd = days[days.length - 1];
    const dRosters = rosters.filter(r => {
      if (deptFilter.length && !deptFilter.includes(r.department)) return false;
      const from = r.dateFrom ? new Date(r.dateFrom) : null;
      const to   = r.dateTo   ? new Date(r.dateTo)   : null;
      if (to   && to   < days[0]) return false;
      if (from && from > wEnd)    return false;
      return true;
    });
    const staffMap = new Map();
    dRosters.forEach(r => {
      if (r.employeeDbId && !staffMap.has(r.employeeDbId))
        staffMap.set(r.employeeDbId, { name: r.employeeName || '—', position: r.position || '' });
    });
    const staffList = [...staffMap.entries()]
      .map(([id, v]) => ({ id, name: v.name, position: v.position }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const getDayCell = (empId, adDate) => {
      const ds = new Date(adDate); ds.setHours(0,  0,  0,  0);
      const de = new Date(adDate); de.setHours(23, 59, 59, 999);
      const leave = getApprovedLeaveForDate(empId, toISO(ds));
      if (leave) return `Leave (${leave.leaveTypeCode})`;
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
    const headers = ['Staff Name', 'Post',
      ...days.map(d => `${DAYS[d.getDay()]} ${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'short' })}`)];
    const rows = staffList.map(s => [s.name, getShortName(s.position, settings.posts), ...days.map(d => getDayCell(s.id, d))]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Roster');
    XLSX.writeFile(wb, `roster_${deptFilter.length ? deptFilter.join('-') : 'all'}_${weekStart.toISOString().split('T')[0]}.xlsx`);
  };

  /* ── Handlers ── */
  const handleChangeStaffId = (id) => {
    const emp = employees.find(e => e.id === id);
    if (emp) setSelectedStaff(emp);
  };

  const handleViewBtn = (key) => {
    if (key === 'staff') {
      // Jump straight to the logged-in user's own monthly calendar + duty
      // roster — the inline prev/next + search built into the calendar's
      // own header lets an elevated role look up anyone else.
      const me = employees.find(e => e.id === currentUser?.id);
      setView('staff');
      if (me) { setSelectedStaff(me); }
      // No linked employee record for this login (e.g. a bare system admin
      // account) — elevated roles fall back to the first staff member; a
      // regular employee login without a staff record just sees nothing.
      else if (canChangeStaff) {
        const first = [...employees].sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''))[0];
        if (first) setSelectedStaff(first);
      }
    } else {
      setSelectedStaff(null);
      setView(key);
      setSearch('');
      if (key === 'shift') setShiftFilterOpen(true);
    }
  };

  /* ─────────── RENDER ─────────── */
  return (
    <div className="page-container">
      <style>{`
        /* @page isn't scoped to an element — with one per print block, only
           the last declaration in the stylesheet would ever apply, no
           matter which view's grid is actually visible. One dynamic rule,
           keyed off the active view, replaces all of those. */
        @media print {
          @page { size: A4 ${view === 'staff' ? 'portrait' : 'landscape'}; margin: 10mm 12mm; }
        }
        @media print {
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
          /* Only the 3 sticky columns (SN, Staff Name, Post) get an explicit
             width — the remaining date columns (a variable count, since the
             range is no longer fixed to 7 days) auto-share what's left
             under table-layout:fixed. */
          #dept-week-grid table th:nth-child(1),
          #dept-week-grid table td:nth-child(1) { width: 4%  !important; }
          #dept-week-grid table th:nth-child(2),
          #dept-week-grid table td:nth-child(2) { width: 16% !important; }
          #dept-week-grid table th:nth-child(3),
          #dept-week-grid table td:nth-child(3) { width: 8%  !important; }
          #dept-week-grid span { font-size: 9pt !important; padding: 2px 4px !important; }
          #dept-week-grid table th div { font-size: 8pt !important; font-weight: 700 !important; margin: 0 !important; }
        }
        @media print {
          body * { visibility: hidden !important; }
          #shift-wise-print, #shift-wise-print * { visibility: visible !important; }
          #shift-wise-print {
            position: fixed !important;
            inset: 0;
            width: 277mm;
            overflow: visible !important;
            padding: 8mm !important;
            border: 1.5px solid #374151 !important;
            box-sizing: border-box !important;
            background: #fff !important;
          }
          #shift-wise-print .print-only { display: block !important; }
          #shift-wise-print table {
            width: 100% !important;
            table-layout: fixed !important;
            border-collapse: collapse !important;
            font-size: 8.5pt !important;
          }
          #shift-wise-print table th,
          #shift-wise-print table td {
            font-size: 8.5pt !important;
            padding: 3px 5px !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
            white-space: nowrap !important;
          }
          /* Only the 3 sticky columns (SN, Staff Name, Post) get an
             explicit width — the day columns auto-share the rest. */
          #shift-wise-print table th:nth-child(1),
          #shift-wise-print table td:nth-child(1) { width: 4%  !important; }
          #shift-wise-print table th:nth-child(2),
          #shift-wise-print table td:nth-child(2) { width: 16% !important; }
          #shift-wise-print table th:nth-child(3),
          #shift-wise-print table td:nth-child(3) { width: 8%  !important; }
          #shift-wise-print span { font-size: 7.5pt !important; padding: 1px 3px !important; }
          #shift-wise-print table th div { font-size: 7pt !important; font-weight: 700 !important; margin: 0 !important; }
        }
        @media print {
          body * { visibility: hidden !important; }
          #staff-cal-print, #staff-cal-print * { visibility: visible !important; }
          #staff-cal-print {
            position: fixed !important;
            inset: 0;
            width: 186mm; /* A4 portrait (210mm) minus the 12mm left/right @page margin */
            overflow: visible !important;
            padding: 6mm !important;
            border: none !important;
            box-sizing: border-box !important;
            background: #fff !important;
          }
          #staff-cal-print .print-only { display: block !important; }
          /* Interactive-only chrome (department filter, staff/month nav
             arrows, staff search) makes no sense on paper — hidden here
             rather than in the on-screen styles. */
          #staff-cal-print .no-print { display: none !important; }

          /* Compact every section so a full month's calendar — header,
             stats bar, legend, 5-6 week grid, roster footer, signatures —
             reliably fits one A4 portrait page instead of spilling onto a
             second sheet. Colors stay exactly as shown on screen (st.bg /
             st.color are already set inline in the JSX — nothing to
             override here); short letter codes (P/A/L/…) still replace the
             full-text category labels to save space, explained by a plain
             key below the calendar instead of the colored swatch legend. */
          #staff-cal-print .src-cal-statbar { padding: 5px 8px !important; gap: 6px !important; }
          #staff-cal-print .src-cal-staffname { font-size: 10pt !important; font-weight: 700 !important; }
          #staff-cal-print .src-cal-monthlabel { font-size: 10pt !important; font-weight: 700 !important; }
          #staff-cal-print .src-cal-stat { padding: 2px 6px !important; min-width: 0 !important; }
          #staff-cal-print .src-cal-stat > div:first-child { font-size: 10pt !important; font-weight: 700 !important; }
          #staff-cal-print .src-cal-stat > div:last-child  { font-size: 10pt !important; font-weight: 700 !important; margin-top: 0 !important; }
          #staff-cal-print .src-cal-dow { padding: 2px !important; font-size: 7pt !important; }

          /* Grid items default to min-width:auto (min-content) — any child
             wide enough (a long unbroken string, a fixed-px element) grows
             its column past its 1fr share and pushes the whole grid off the
             page. Forcing min-width:0 + overflow:hidden makes every cell
             obey its 1fr column no matter what's inside it. */
          #staff-cal-print .src-cal-cell {
            min-height: 16mm !important; min-width: 0 !important; overflow: hidden !important;
            padding: 2px 3px !important; gap: 1px !important;
          }
          #staff-cal-print .src-cal-cell * { overflow-wrap: anywhere !important; white-space: normal !important; }

          /* Date number — small, plain, normal weight, no circle and no
             today outline (removes all the today-only badge/outline styling
             so every date reads the same plain way on paper). */
          #staff-cal-print .src-cal-daynum {
            font-size: 8pt !important; font-weight: 400 !important; width: 14px !important; height: 14px !important;
            background: transparent !important; border: none !important;
          }
          #staff-cal-print .src-cal-cell { outline: none !important; }
          #staff-cal-print .src-cal-avatarblock { display: none !important; }
          #staff-cal-print .src-cal-summary-print { display: block !important; margin-bottom: 4px !important; }
          /* Duty Roster / Punch Time — compact 24h print-only values ("Roster
             12:00-18:00") swap in for the verbose on-screen text, each its
             own full-width line below the date instead of squeezed beside
             it, and small enough to never need to wrap at all. */
          #staff-cal-print .src-cal-roster-full,
          #staff-cal-print .src-cal-time,
          #staff-cal-print .src-cal-flags { display: none !important; }
          #staff-cal-print .src-cal-roster-print,
          #staff-cal-print .src-cal-punch-print { display: block !important; font-size: 6.5pt !important; }
          #staff-cal-print .src-cal-label { font-size: 7pt !important; }
          #staff-cal-print .src-cal-label-short { font-size: 8pt !important; }
          #staff-cal-print .src-cal-footer { padding: 3px 6px !important; gap: 6px !important; font-size: 6pt !important; }
          #staff-cal-print .src-cal-legend { display: none !important; }
          #staff-cal-print .src-cal-legend-print { display: block !important; margin-top: 4px !important; font-size: 6.5pt !important; }
          #staff-cal-print .src-cal-label { display: none !important; }
          #staff-cal-print .src-cal-label-short { display: block !important; }
        }
      `}</style>

      {/* ── Shift Wise Filter Popup ── */}
      <ShiftFilterModal
        open={shiftFilterOpen}
        onClose={() => setShiftFilterOpen(false)}
        depts={depts}
        deptFilter={shiftDeptFilter}
        onDeptChange={setShiftDeptFilter}
        fiscalYears={settings.fiscalYears || []}
        filterFYId={filterFYId}
        onFYChange={setFilterFYId}
        filterMonth={filterMonth}
        onMonthChange={setFilterMonth}
        monthLabel={monthLabel}
        rangeFrom={shiftRangeFrom}
        rangeTo={shiftRangeTo}
        onRangeFromChange={setShiftRangeFrom}
        onRangeToChange={setShiftRangeTo}
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

      {/* ── Fiscal Year + Month filter ── */}
      <div style={{ background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 10,
        padding: '10px 14px', marginBottom: 14, display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-end' }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#374151', marginBottom: 4 }}>Fiscal Year</div>
          <select value={filterFYId ?? ''} onChange={e => setFilterFYId(e.target.value ? parseInt(e.target.value) : null)}
            style={{ height: 34, border: '1.5px solid #d1d5db', borderRadius: 7, padding: '0 8px',
              fontSize: 13, fontWeight: 600, color: '#374151', outline: 'none', background: 'white',
              cursor: 'pointer', minWidth: 110 }}>
            {(settings.fiscalYears || []).map(fy => <option key={fy.id} value={fy.id}>{fy.name}</option>)}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#374151', marginBottom: 4 }}>Month</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {BS_MONTHS_EN.map((m, i) => (
              <button key={m} onClick={() => setFilterMonth(i + 1)}
                style={{ padding: '5px 10px', border: `1.5px solid ${filterMonth === i + 1 ? '#1a56db' : '#e5e7eb'}`,
                  borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                  background: filterMonth === i + 1 ? '#1a56db' : 'white',
                  color:      filterMonth === i + 1 ? 'white'   : '#374151' }}>
                {m}
              </button>
            ))}
          </div>
        </div>
        <div style={{ fontSize: 12, color: '#6b7280' }}>
          Showing: <strong style={{ color: '#111827' }}>{monthLabel}</strong>
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

              {/* Search — shift view only */}
              {view === 'shift' && (
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
            {view === 'department' && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap',
                background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 10,
                padding: '10px 14px' }}>

                {/* Dept selector — Department Head is locked to their own
                    department (set by the effect above), so they just get
                    a static badge instead of an editable multi-select. */}
                {currentUser?.role === 'departmentHead' ? (
                  <div style={{ height: 36, display: 'flex', alignItems: 'center', padding: '0 12px',
                    fontSize: 13, fontWeight: 600, color: '#374151', background: '#f3f4f6',
                    border: '1px solid #d1d5db', borderRadius: 8, minWidth: 280 }}>
                    Department: {currentUser.department || '—'}
                  </div>
                ) : (
                  <div style={{ minWidth: 280 }}>
                    <MultiCheckSelect value={deptFilter} onChange={setDeptFilter}
                      options={depts} placeholder="All Departments" />
                  </div>
                )}

                {/* Date Range */}
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                  <div style={{ minWidth: 140 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', marginBottom: 2 }}>From Date</div>
                    <DateInput value={rangeFrom} onChange={setRangeFrom} />
                  </div>
                  <span style={{ color: '#9ca3af', paddingBottom: 8 }}>→</span>
                  <div style={{ minWidth: 140 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', marginBottom: 2 }}>To Date</div>
                    <DateInput value={rangeTo} onChange={setRangeTo} min={rangeFrom} />
                  </div>
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
          {view === 'staff' ? (
            selectedStaff ? (
              <div id="staff-cal-print">
                <div className="print-only" style={{ display: 'none', marginBottom: 10 }}>
                  <PrintCompanyHeader settings={settings} />
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#111827', marginBottom: 4 }}>
                    Monthly Duty Roster &nbsp;|&nbsp; {selectedStaff.fullName}
                  </div>
                  <div style={{ fontSize: 14, color: '#374151', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <span>{[selectedStaff.position, selectedStaff.department].filter(Boolean).join(' · ') || '—'}</span>
                    <span style={{ color: '#9ca3af' }}>|</span>
                    <span>Month : {calMonthLabel || monthLabel}</span>
                  </div>
                </div>
                <StaffCalendar
                  staff={selectedStaff}
                  rosters={staffRosters}
                  settings={settings}
                  initialYear={initialCalYear}
                  initialMonth={initialCalMonth}
                  onMonthChange={setCalMonthLabel}
                  employees={employees}
                  canChangeStaff={canChangeStaff}
                  onChangeStaff={handleChangeStaffId}
                />
                <div className="print-only" style={{ display: 'none', marginTop: 30 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 40 }}>
                    {['Prepared by', 'Approved by'].map(label => (
                      <div key={label} style={{ flex: 1, textAlign: 'center' }}>
                        <div style={{ borderBottom: '1.5px dotted #374151', height: 30, marginBottom: 6 }} />
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#374151' }}>{label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : canChangeStaff ? (
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12,
                padding: '40px', textAlign: 'center' }}>
                <div style={{ color: '#9ca3af', fontSize: 14, fontWeight: 600, marginBottom: 14 }}>
                  No staff selected.
                </div>
                <div style={{ maxWidth: 340, margin: '0 auto' }}>
                  <StaffDropdown employees={employees} value={null} onChange={handleChangeStaffId} />
                </div>
              </div>
            ) : (
              /* Regular employees are locked to their own calendar — no
                 linked staff record means there's nothing to show them. */
              <div style={{ textAlign: 'center', padding: '40px 20px', color: '#9ca3af',
                fontSize: 14, fontWeight: 600 }}>No roster found for your account</div>
            )
          ) : view === 'department' ? (
            <div id="dept-week-grid">
              <div className="print-only" style={{ display: 'none', marginBottom: 10 }}>
                <PrintCompanyHeader settings={settings} />
                <div style={{ fontSize: 15, fontWeight: 800, color: '#111827', marginBottom: 4 }}>
                  Duty Roster &nbsp;|&nbsp; Department : {deptLabel}
                </div>
                <div style={{ fontSize: 12, color: '#374151', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <span>Fiscal Year : {printMeta.fiscalYear}</span>
                  <span style={{ color: '#9ca3af' }}>|</span>
                  <span>Month : {printMeta.monthName}</span>
                  <span style={{ color: '#9ca3af' }}>|</span>
                  <span>From Date – To Date : {printMeta.rangeLabel}</span>
                </div>
              </div>
              {deptsToShow.length === 0 ? (
                <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12,
                  padding: '40px', textAlign: 'center', color: '#9ca3af', fontSize: 14, fontWeight: 600 }}>
                  No roster entries in this date range
                </div>
              ) : deptsToShow.length === 1 ? (
                <DeptWeekView
                  rosters={rosters}
                  department={deptsToShow[0]}
                  weekStart={weekStart}
                  weekEnd={weekEnd}
                  settings={settings}
                />
              ) : (
                /* Multiple departments — one grid per department, same
                   grouped-card convention as the Shift Wise view. */
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {deptsToShow.map(d => (
                    <div key={d}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <span style={{ fontSize: 15 }}>🏢</span>
                        <span style={{ fontSize: 14, fontWeight: 800, color: '#111827' }}>{d}</span>
                      </div>
                      <DeptWeekView
                        rosters={rosters}
                        department={d}
                        weekStart={weekStart}
                        weekEnd={weekEnd}
                        settings={settings}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : groupedByDeptShift.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: '#9ca3af',
              fontSize: 14, fontWeight: 600 }}>No roster entries in this date range</div>
          ) : (
            /* Shift Wise — one grid per department; every real shift that
               department runs this period is a section within it, e.g.:
               🏢 Nursing
                  🔄 Nursing : 07pm–07am   No. of Staff: 4
                  1. Staff Name  Post  1 | 2 | 3 | ...
                  🔄 Nursing : 07am–16pm  No. of Staff: 6
                  1. Staff Name  Post  1 | 2 | 3 | ... */
            <div id="shift-wise-print">
              <div className="print-only" style={{ display: 'none', marginBottom: 10 }}>
                <PrintCompanyHeader settings={settings} />
                <div style={{ fontSize: 15, fontWeight: 800, color: '#111827', marginBottom: 4 }}>
                  Duty Roster — Shift Wise &nbsp;|&nbsp; Department : {shiftDeptFilter.length ? shiftDeptFilter.join(', ') : 'All Departments'}
                </div>
                <div style={{ fontSize: 12, color: '#374151', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <span>Fiscal Year : {filterFYObj?.name || filterYear}</span>
                  <span style={{ color: '#9ca3af' }}>|</span>
                  <span>Month : {monthLabel}</span>
                  <span style={{ color: '#9ca3af' }}>|</span>
                  <span>From Date – To Date : {fmtDate(shiftWeekStart)} – {fmtDate(shiftWeekEnd)}</span>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
                {groupedByDeptShift.map(({ dept, shiftNames }) => (
                  <div key={dept}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      <span style={{ fontSize: 16 }}>🏢</span>
                      <span style={{ fontSize: 15, fontWeight: 800, color: '#111827' }}>{dept}</span>
                    </div>
                    <DeptShiftGrid
                      rosters={rosters}
                      department={dept}
                      shiftNames={shiftNames}
                      weekStart={shiftWeekStart}
                      weekEnd={shiftWeekEnd}
                      settings={settings}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
};

export default RosterReport;
