import React, { useState, useEffect } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import { useLeaveApply } from '../../context/LeaveApplyContext.jsx';
import { useOfficeVisitApply } from '../../context/OfficeVisitApplyContext.jsx';
import { useManualPostingApply } from '../../context/ManualPostingApplyContext.jsx';
import { getNepalNow, getNepalTodayISO, adToBS, bsToAD, getBSDays, BS_MONTHS_EN, toNepaliDigits } from '../../utils/dateUtils.js';
import { CATEGORIES, categorize, fmtPunchTime, dutyRosterRange, presentFlags } from '../../utils/attendanceCalendar.js';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const toISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const selActionBtnStyle = (color, bg, disabled = false) => ({
  border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 700,
  fontFamily: 'inherit', color: disabled ? '#9ca3af' : color, background: disabled ? '#f1f5f9' : bg,
  cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.7 : 1,
});

/* Read-only month calendar for the logged-in employee's own attendance +
   duty roster. Self-fetches /attendance/staff-ledger for whatever month is
   navigated to (independent of Dashboard.jsx's own current-month myLedger,
   which still drives the Leave/Visit/Late-Early lists and the Attendance
   Overview donut) — mirrors RosterReport.jsx's StaffCalendar so an admin
   viewing this same employee's roster there sees an identical calendar. */
const MyMonthlyCalendar = ({ employeeId, onViewFull }) => {
  const { canView } = useAuth();
  const { settings } = useSettings();
  const { open: openLeaveApply }         = useLeaveApply();
  const { open: openOfficeVisitApply }   = useOfficeVisitApply();
  const { open: openManualPostingApply } = useManualPostingApply();
  const useNP   = settings?.defaultCalendar === 'np';
  const useNPDg = useNP && settings?.nepaliDigits;
  const today   = getNepalNow();
  const todayBS = adToBS(getNepalTodayISO());
  const todayStr = getNepalTodayISO();
  const fmt = n => useNPDg ? toNepaliDigits(n) : String(n);

  const [navYear,  setNavYear]  = useState(() => useNP ? (todayBS?.year  || today.getFullYear()) : today.getFullYear());
  const [navMonth, setNavMonth] = useState(() => useNP ? (todayBS?.month || today.getMonth() + 1) : today.getMonth()); // BS: 1-12, AD: 0-11

  const goPrev = () => {
    if (useNP) { if (navMonth <= 1)  { setNavMonth(12); setNavYear(y => y - 1); } else setNavMonth(m => m - 1); }
    else       { if (navMonth <= 0)  { setNavMonth(11); setNavYear(y => y - 1); } else setNavMonth(m => m - 1); }
  };
  const goNext = () => {
    if (useNP) { if (navMonth >= 12) { setNavMonth(1);  setNavYear(y => y + 1); } else setNavMonth(m => m + 1); }
    else       { if (navMonth >= 11) { setNavMonth(0);  setNavYear(y => y + 1); } else setNavMonth(m => m + 1); }
  };

  let daysInMonth, firstDay, monthLabel;
  if (useNP) {
    daysInMonth = getBSDays(navYear, navMonth) || 30;
    const firstAD = bsToAD(navYear, navMonth, 1);
    firstDay = firstAD ? firstAD.getDay() : 0;
    monthLabel = `${BS_MONTHS_EN[navMonth - 1] || ''} ${fmt(navYear)} BS`;
  } else {
    daysInMonth = new Date(navYear, navMonth + 1, 0).getDate();
    firstDay    = new Date(navYear, navMonth, 1).getDay();
    monthLabel  = new Date(navYear, navMonth, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  }
  const getADDate = (d) => useNP ? bsToAD(navYear, navMonth, d) : new Date(navYear, navMonth, d);

  const [ledgerByDate, setLedgerByDate] = useState({});
  useEffect(() => {
    if (!employeeId) { setLedgerByDate({}); return; }
    const firstAdDate = getADDate(1);
    const lastAdDate  = getADDate(daysInMonth);
    if (!firstAdDate || !lastAdDate) { setLedgerByDate({}); return; }
    api.get(`/attendance/staff-ledger?employeeId=${employeeId}&startDate=${toISO(firstAdDate)}&endDate=${toISO(lastAdDate)}`)
      .then(res => {
        const map = {};
        (res.days || []).forEach(d => { map[d.dateStr] = d; });
        setLedgerByDate(map);
      })
      .catch(() => setLedgerByDate({}));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId, navYear, navMonth, useNP]);

  // Multi-day selection for the "Apply Leave / Office Visit / Late In &
  // Early Out" action bar below. Plain two-click range picking — no
  // modifier key needed, since most staff using this wouldn't know to
  // shift+click: click a first day (picks it alone), click a second day
  // (turns it into a from→to range spanning both, in either order),
  // click again (once a range is already complete) to start a fresh
  // selection. Clicking the same lone day twice clears it. Shift+click is
  // still honored as an explicit "extend the current range" shortcut.
  // Office Visit and Late In/Early Out only ever apply to a single day,
  // so their buttons stay disabled whenever a multi-day range is picked.
  const [selRange, setSelRange] = useState(null); // { start: dateStr, end: dateStr } | null

  const onDayClick = (dateStr, e) => {
    if (!dateStr) return;
    setSelRange(prev => {
      if (e.shiftKey && prev?.start) {
        return { start: prev.start < dateStr ? prev.start : dateStr, end: prev.start < dateStr ? dateStr : prev.start };
      }
      if (!prev || prev.start !== prev.end) return { start: dateStr, end: dateStr }; // no selection, or a range already complete -> start fresh
      if (prev.start === dateStr) return null; // clicking the same lone day again clears it
      return { start: prev.start < dateStr ? prev.start : dateStr, end: prev.start < dateStr ? dateStr : prev.start };
    });
  };
  const isSelected = (dateStr) => !!dateStr && !!selRange && dateStr >= selRange.start && dateStr <= selRange.end;
  const isSingleDaySel = selRange && selRange.start === selRange.end;

  const fmtSelDate = (ds) => {
    if (!ds) return '';
    if (useNP) {
      const bs = adToBS(ds);
      return bs ? `${fmt(bs.day)} ${BS_MONTHS_EN[bs.month - 1]} ${fmt(bs.year)}` : ds;
    }
    return new Date(ds + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const isToday = (d) => useNP
    ? (todayBS && navYear === todayBS.year && navMonth === todayBS.month && d === todayBS.day)
    : (d === today.getDate() && navMonth === today.getMonth() && navYear === today.getFullYear());

  const cells = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <div className="adb-card" style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '14px 18px', borderBottom: '1px solid #eef1f5' }}>
        <p className="adb-title">My Monthly Calendar with Duty Roster</p>
        {onViewFull && <button className="adb-link" onClick={onViewFull}>View Full Roster →</button>}
      </div>

      {/* Month nav + legend */}
      <div style={{ padding: '10px 18px', background: '#f8fafc', borderBottom: '1px solid #eef1f5',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
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
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {Object.values(CATEGORIES).map(c => (
            <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 11, height: 11, borderRadius: 3, flexShrink: 0, background: c.bg, border: `1.5px solid ${c.color}` }} />
              <span style={{ fontSize: 12, color: '#6b7280' }}>{c.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Day-of-week header */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', background: '#f8fafc', borderBottom: '2px solid #e5e7eb' }}>
        {DOW.map((d, i) => (
          <div key={d} style={{ padding: '8px 4px', textAlign: 'center', fontSize: 13, fontWeight: 700,
            color: i === 0 ? '#dc2626' : i === 6 ? '#d97706' : '#6b7280' }}>{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', flex: 1 }}>
        {cells.map((d, idx) => {
          if (d === null) return (
            <div key={`e-${idx}`} style={{ minHeight: 82, background: '#fafafa',
              borderBottom: '1px solid #efefef', borderRight: (idx + 1) % 7 !== 0 ? '1px solid #efefef' : 'none' }} />
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

          const sel = isSelected(dateStr);
          return (
            <div key={d} onClick={(e) => onDayClick(dateStr, e)}
              style={{ minHeight: 82, background: sel ? '#eff6ff' : st.bg, cursor: dateStr ? 'pointer' : 'default',
              borderBottom: '1px solid #e5e7eb', borderRight: (idx + 1) % 7 !== 0 ? '1px solid #e5e7eb' : 'none',
              padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 4,
              outline: sel ? '2px solid #1a56db' : tod ? '2px solid #1a56db' : 'none', outlineOffset: -2 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 4 }}>
                <span style={{ flexShrink: 0, width: 26, height: 26, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
                  fontWeight: tod ? 800 : 500, background: tod ? '#1a56db' : 'transparent',
                  color: tod ? '#fff' : dow === 0 ? '#dc2626' : '#374151' }}>{fmt(d)}</span>
                {rosterRange && (
                  <span style={{ fontSize: 10.5, color: '#0f3d57', fontWeight: 600, lineHeight: 1.3, textAlign: 'right' }}>
                    Duty Roster<br />{rosterRange}
                  </span>
                )}
              </div>
              {label && (
                <span style={{ fontSize: 11, fontWeight: 700, color: st.color, overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
              )}
              {flags.length > 0 && (
                <span style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                  {flags.map(f => (
                    <span key={f.label} style={{ fontSize: 9, fontWeight: 700, color: f.color, background: f.bg,
                      border: `1px solid ${f.border}`, borderRadius: 20, padding: '1px 6px', lineHeight: 1.5 }}>{f.label}</span>
                  ))}
                </span>
              )}
              {timeIn && (
                <span style={{ fontSize: 10.5, color: '#64748b', fontWeight: 600 }}>
                  {timeIn}{timeOut ? ` – ${timeOut}` : ''}
                </span>
              )}
              {!label && !timeIn && !rosterRange && (
                <span style={{ fontSize: 12, color: '#d1d5db', textAlign: 'center', marginTop: 4 }}>–</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Selection action bar — pick a day (shift+click to extend into a
          range) to apply Leave/Office Visit/Late In & Early Out for it
          directly, instead of opening the FAB and typing the date by hand.
          Office Visit and Late In/Early Out only ever cover one day. */}
      {selRange && (
        <div style={{ padding: '10px 18px', borderTop: '1px solid #eef1f5', background: '#f8fafc',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 6 }}>
            📌 {fmtSelDate(selRange.start)}{!isSingleDaySel && ` – ${fmtSelDate(selRange.end)}`}
            <button onClick={() => setSelRange(null)}
              style={{ border: 'none', background: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 11.5, fontWeight: 600 }}>
              ✕ clear
            </button>
          </span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {canView('leaveApply') && (
              <button
                onClick={() => { openLeaveApply(null, { fromDate: selRange.start, toDate: selRange.end }); setSelRange(null); }}
                style={selActionBtnStyle('#7c3aed', '#ede9fe')}>📝 Apply Leave</button>
            )}
            {canView('officeVisitApply') && (
              <button disabled={!isSingleDaySel} title={!isSingleDaySel ? 'Office Visit is single-day — select one day' : ''}
                onClick={() => { openOfficeVisitApply(null, { fromDate: selRange.start, toDate: selRange.end }); setSelRange(null); }}
                style={selActionBtnStyle('#0d9488', '#ccfbf1', !isSingleDaySel)}>🏢 Office Visit</button>
            )}
            {canView('manualPostingApply') && (
              <button disabled={!isSingleDaySel} title={!isSingleDaySel ? 'Late In/Early Out is single-day — select one day' : ''}
                onClick={() => { openManualPostingApply(selRange.start); setSelRange(null); }}
                style={selActionBtnStyle('#b45309', '#fef3c7', !isSingleDaySel)}>⏱️ Late In/Early Out</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default MyMonthlyCalendar;
