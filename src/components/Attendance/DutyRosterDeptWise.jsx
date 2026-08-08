import React, { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client.js';
import { useSettings } from '../../context/SettingsContext.jsx';
import { useAuth }     from '../../context/AuthContext.jsx';
import { useData }     from '../../context/DataContext.jsx';
import { adToBS, bsToAD, getBSDays, BS_MONTHS_EN, getNepalTodayISO } from '../../utils/dateUtils.js';
import { adToISO } from '../Common/NepaliDatePicker.jsx';
import SearchableSelect from '../Common/SearchableSelect.jsx';
import MCS              from '../Common/MultiCheckSelect.jsx';
import ExchangeDutyModal from './ExchangeDutyModal.jsx';

const DAY_KEYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const DAY_KEYS_FULL = { Sun:'Sunday', Mon:'Monday', Tue:'Tuesday', Wed:'Wednesday', Thu:'Thursday', Fri:'Friday', Sat:'Saturday' };

// Sticky column minWidths and cumulative left offsets
const STICKY_WIDTHS = [40, 160, 65, 65, 68];  // SN, Name, Post, Dept, Branch
const STICKY_LEFTS  = STICKY_WIDTHS.reduce((acc, w, i) => {
  acc.push(i === 0 ? 0 : acc[i - 1] + STICKY_WIDTHS[i - 1]);
  return acc;
}, []);  // [0, 40, 200, 265, 330]

const DATE_COL_W = 120;  // date column width px

const abbrev = name => {
  if (!name) return '—';
  const words = name.trim().split(/\s+/);
  if (words.length > 1) return words.map(w => w[0].toUpperCase()).join('');
  return name.slice(0, 5);
};

const getShortName = (fullName, list = []) => {
  if (!fullName) return '—';
  const found = list.find(x => (x.name || x) === fullName);
  return found?.shortName || found?.short_name || abbrev(fullName);
};

// Formats a ShiftCell-style value (string[] of shiftIds or ['OFF']) the same
// way ShiftCell's own trigger does, for use outside the cell (Exchange Duty
// modal's "Duty" column).
const formatDutyText = (eff, shifts) => {
  const arr = Array.isArray(eff) ? eff : [];
  if (arr.includes('OFF')) return 'OFF';
  if (arr.length === 0) return '—';
  return arr.map(id => {
    const s = shifts.find(sh => sh.id === id);
    if (!s) return null;
    return s.start_time && s.end_time
      ? `${s.start_time.slice(0,5)}-${s.end_time.slice(0,5)}`
      : s.name;
  }).filter(Boolean).join(', ') || '—';
};

// Stable color per exchange partner (not per cell) so every cell exchanged
// with the same person reads as the same color, and different partners are
// easy to tell apart when one row has exchanged with more than one person.
const EXCHANGE_COLORS = ['#1a56db', '#059669', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];
const colorForPartner = (partnerId) => EXCHANGE_COLORS[Math.abs(Number(partnerId) || 0) % EXCHANGE_COLORS.length];

function getCurrentFY(fiscalYears = []) {
  const today = getNepalTodayISO();
  return fiscalYears.find(fy => fy.startDate <= today && fy.endDate >= today)
      || fiscalYears.find(fy => fy.isDefault)
      || fiscalYears[fiscalYears.length - 1]
      || null;
}

function getPeriodDates(bsYear, bsMonth, periodType, weekOrHalf) {
  const totalDays = getBSDays(bsYear, bsMonth);
  let startDay, endDay;
  if (periodType === 'weekly') {
    startDay = (weekOrHalf - 1) * 7 + 1;
    endDay   = weekOrHalf === 4 ? totalDays : Math.min(weekOrHalf * 7, totalDays);
  } else {
    startDay = weekOrHalf === 1 ? 1 : 16;
    endDay   = weekOrHalf === 1 ? Math.min(15, totalDays) : totalDays;
  }
  const dates = [];
  for (let d = startDay; d <= endDay; d++) {
    const ad = bsToAD(bsYear, bsMonth, d);
    if (!ad) continue;
    dates.push({ bsDay: d, adDateStr: adToISO(ad), dayKey: DAY_KEYS[ad.getDay()] });
  }
  return dates;
}

/* ── Per-cell Shift Dropdown ── value = string[] (shiftIds or 'OFF') ──
   header (optional, per-cell instances only): { name, post, dateLabel } —
   shown at the top of the panel so it's unambiguous which staff/day is
   being edited. */
const ShiftCell = ({ value = [], onChange, shifts, isColHeader, onExchange, header, hideEmptyDash }) => {
  const [open, setOpen] = useState(false);
  const [srch, setSrch] = useState('');
  const [triggerRect, setTriggerRect] = useState(null); // live-tracked, not a one-time snapshot
  const [panelH, setPanelH] = useState(0);
  const [activeIndex, setActiveIndex] = useState(-1);
  const ref        = useRef(null);
  const triggerRef = useRef(null);
  const panelRef    = useRef(null);
  const itemRefs   = useRef([]);
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setSrch(''); } };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const updateTriggerRect = () => { if (triggerRef.current) setTriggerRect(triggerRef.current.getBoundingClientRect()); };

  const handleOpen = () => {
    if (!open) updateTriggerRect();
    setOpen(p => !p);
  };

  // Keep the panel glued to its trigger cell while the grid (horizontal
  // scroll container) or the page itself scrolls, instead of staying at
  // the position captured once at open-time.
  useEffect(() => {
    if (!open) return;
    updateTriggerRect();
    window.addEventListener('scroll', updateTriggerRect, true);
    window.addEventListener('resize', updateTriggerRect);
    return () => {
      window.removeEventListener('scroll', updateTriggerRect, true);
      window.removeEventListener('resize', updateTriggerRect);
    };
  }, [open]);

  // Measure the panel's real height so we can decide whether it fits below
  // the trigger — flips upward when it doesn't fit below but does fit
  // above (same technique as NepaliDatePicker).
  useLayoutEffect(() => {
    if (open && panelRef.current) {
      const h = panelRef.current.offsetHeight;
      if (h && h !== panelH) setPanelH(h);
    }
  }, [open, triggerRect]);

  const PANEL_W = 250;
  const openUpward = !!(triggerRect && panelH &&
    (triggerRect.bottom + 4 + panelH > window.innerHeight - 8) &&
    (triggerRect.top - panelH - 4 >= 8));
  const panelTop  = triggerRect ? (openUpward ? triggerRect.top - panelH - 4 : triggerRect.bottom + 4) : 0;
  const panelLeft = triggerRect ? Math.max(8, Math.min(triggerRect.left, window.innerWidth - PANEL_W - 8)) : 0;

  const arr = Array.isArray(value) ? value : [];
  const isOff = arr.includes('OFF');
  const selIds = arr.filter(v => v !== 'OFF');

  const normalShifts  = shifts.filter(s => !s.make_default);
  const defaultShifts = shifts.filter(s =>  s.make_default);
  const filterFn = s => s.name.toLowerCase().includes(srch.toLowerCase());
  const filtered         = srch ? normalShifts.filter(filterFn)  : normalShifts;
  const filteredDefaults = srch ? defaultShifts.filter(filterFn) : defaultShifts;

  const toggleShift = id => {
    if (isOff) return; // off mode — no shift select
    const next = selIds.includes(id) ? selIds.filter(x => x !== id) : [...selIds, id];
    onChange(next.length ? next : []);
  };
  const clearAll  = () => onChange([]);

  const hasSel = isOff || selIds.length > 0;
  const canExchange = !isColHeader && !!onExchange;

  // Navigable rows in visual order: optional "Clear selection", "Exchange
  // Duty", then the filtered normal shifts — the disabled "Default" rows
  // below aren't selectable so arrow-key navigation skips them.
  const navItems = [
    ...(hasSel ? [{ type: 'clear' }] : []),
    ...(canExchange ? [{ type: 'exchange' }] : []),
    ...filtered.map(s => ({ type: 'shift', id: s.id })),
  ];
  itemRefs.current = [];
  const selectNav = (item) => {
    if (!item) return;
    if (item.type === 'clear') { clearAll(); }
    else if (item.type === 'exchange') { onExchange?.(); setOpen(false); setSrch(''); }
    else if (item.type === 'shift' && !isOff) { toggleShift(item.id); }
  };
  const handleSearchKeyDown = e => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => (navItems.length ? (i + 1) % navItems.length : -1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => (navItems.length ? (i - 1 + navItems.length) % navItems.length : -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < navItems.length) selectNav(navItems[activeIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false); setSrch('');
    }
  };
  useEffect(() => {
    if (open && activeIndex >= 0) itemRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);
  useEffect(() => { if (open) setActiveIndex(navItems.length ? 0 : -1); }, [srch, open]);

  // Trigger display — plain text, black font, no pill
  const triggerContent = isOff ? (
    <span style={{ fontSize:13, fontWeight:700, color:'#dc2626' }}>OFF</span>
  ) : selIds.length > 0 ? (
    <div style={{ display:'flex', flexDirection:'column', gap:0, lineHeight:'17px' }}>
      {selIds.map(id => {
        const s = shifts.find(sh => sh.id === id);
        if (!s) return null;
        const t = s.start_time && s.end_time
          ? `${s.start_time.slice(0,5)} - ${s.end_time.slice(0,5)}`
          : s.name.substring(0, 10);
        return <span key={id} style={{ fontSize:13, color:'#111827' }}>{t}</span>;
      })}
    </div>
  ) : null;

  return (
    <div ref={ref} style={{ position:'relative' }}>
      {/* Trigger — plain text, left-aligned, no pill/border */}
      <div ref={triggerRef} onClick={handleOpen}
        style={{ cursor:'pointer', userSelect:'none', display:'inline-block',
          padding:'2px 4px', minWidth: isColHeader ? 64 : 36, textAlign:'left',
          background: open ? '#f0f9ff' : 'transparent', borderRadius:4 }}>
        {triggerContent}
        {!hasSel && !(hideEmptyDash && !isColHeader) && (
          <span style={{ fontSize:13, color: isColHeader ? '#9ca3af' : '#d1d5db' }}>
            {isColHeader ? 'Set Shift' : '—'}
          </span>
        )}
      </div>

      {open && triggerRect && (
        <div ref={panelRef} style={{ position:'fixed', top: panelTop, left: panelLeft, zIndex:99999,
          background:'white', border:'1.5px solid #1a56db', borderRadius:10,
          boxShadow:'0 8px 28px rgba(0,0,0,.18)', width:PANEL_W,
          display:'flex', flexDirection:'column', maxHeight:320 }}>

          {/* Arrow pointing at the trigger cell */}
          <div style={{ position:'absolute', left:16, width:0, height:0,
            ...(openUpward
              ? { bottom:-9, borderLeft:'8px solid transparent', borderRight:'8px solid transparent', borderTop:'9px solid #1a56db' }
              : { top:-9,    borderLeft:'8px solid transparent', borderRight:'8px solid transparent', borderBottom:'9px solid #1a56db' }) }} />
          <div style={{ position:'absolute', left:17.5, width:0, height:0,
            ...(openUpward
              ? { bottom:-6.5, borderLeft:'6.5px solid transparent', borderRight:'6.5px solid transparent', borderTop:'7px solid white' }
              : { top:-6.5,    borderLeft:'6.5px solid transparent', borderRight:'6.5px solid transparent', borderBottom:'7px solid white' }) }} />

          {/* Header — which staff / which day this popup is editing */}
          {header && (
            <div style={{ padding:'8px 12px', borderBottom:'1px solid #e5e7eb', background:'#f8fafc',
              borderRadius:'8px 8px 0 0', flexShrink:0 }}>
              <div style={{ fontSize:12.5, fontWeight:700, color:'#111827' }}>
                {header.name}{header.post && <span style={{ fontWeight:500, color:'#6b7280' }}> | {header.post}</span>}
              </div>
              <div style={{ fontSize:11, color:'#6b7280', marginTop:1 }}>{header.dateLabel}</div>
            </div>
          )}

          {/* Search */}
          <div style={{ padding:'7px 8px', borderBottom:'1px solid #e5e7eb', flexShrink:0 }}>
            <input autoFocus type="text" value={srch} onChange={e => setSrch(e.target.value)}
              placeholder="Search shift..." onClick={e => e.stopPropagation()} onKeyDown={handleSearchKeyDown}
              style={{ width:'100%', border:'1.5px solid #d1d5db', borderRadius:7, padding:'5px 9px',
                fontSize:12, outline:'none', boxSizing:'border-box' }}
              onFocus={e => e.target.style.borderColor = '#1a56db'}
              onBlur={e => e.target.style.borderColor = '#d1d5db'} />
          </div>

          <div style={{ overflowY:'auto', flex:1 }}>
            {/* Clear */}
            {hasSel && (
              <div ref={el => itemRefs.current[0] = el}
                onMouseDown={e => { e.preventDefault(); clearAll(); }}
                onMouseEnter={() => setActiveIndex(0)}
                style={{ padding:'5px 12px', fontSize:12, color:'#6b7280', cursor:'pointer',
                  borderBottom:'1px solid #f1f5f9', display:'flex', alignItems:'center', gap:5,
                  background: activeIndex === 0 ? '#f9fafb' : 'white' }}>
                <svg viewBox="0 0 12 12" fill="none" width="10" height="10"><path d="M2 2l8 8M10 2l-8 8" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round"/></svg>
                Clear selection
              </div>
            )}

            {/* Exchange Duty */}
            {canExchange && (
              <div ref={el => itemRefs.current[hasSel ? 1 : 0] = el}
                onMouseDown={e => { e.preventDefault(); onExchange(); setOpen(false); setSrch(''); }}
                onMouseEnter={() => setActiveIndex(hasSel ? 1 : 0)}
                style={{ padding:'6px 12px', display:'flex', alignItems:'center', gap:8, cursor:'pointer',
                  background: activeIndex === (hasSel ? 1 : 0) ? '#eff6ff' : 'white',
                  borderBottom:'1px solid #f1f5f9' }}>
                <span style={{ fontSize:14 }}>🔄</span>
                <span style={{ fontSize:13, fontWeight:700, color:'#1a56db' }}>Exchange Duty</span>
                <span style={{ fontSize:11, color:'#9ca3af', marginLeft:'auto' }}>Swap with staff</span>
              </div>
            )}

            {/* Normal shifts — multi-select checkboxes */}
            {filtered.map((s, i) => {
              const sel  = selIds.includes(s.id);
              const navIdx = (hasSel ? 1 : 0) + (canExchange ? 1 : 0) + i;
              const highlighted = activeIndex === navIdx;
              const time = s.start_time && s.end_time ? `${s.start_time.slice(0,5)}-${s.end_time.slice(0,5)}` : '';
              return (
                <div key={s.id} ref={el => itemRefs.current[navIdx] = el}
                  onMouseDown={e => { e.preventDefault(); if (!isOff) toggleShift(s.id); }}
                  onMouseEnter={() => setActiveIndex(navIdx)}
                  style={{ padding:'6px 12px', display:'flex', alignItems:'center', gap:8,
                    cursor: isOff ? 'not-allowed' : 'pointer',
                    background: sel ? '#eff6ff' : (highlighted ? '#f8fafc' : 'white'), borderBottom:'1px solid #f9fafb',
                    opacity: isOff ? .4 : 1 }}>
                  <input type="checkbox" checked={sel} readOnly
                    style={{ width:13, height:13, cursor: isOff ? 'not-allowed' : 'pointer', accentColor:'#1a56db', flexShrink:0 }} />
                  <span style={{ fontSize:13, fontWeight: sel ? 600 : 400, color: sel ? '#1e40af' : '#111827',
                    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1, textAlign:'left' }}>
                    {s.name}
                  </span>
                  {time && <span style={{ fontSize:11, color:'#9ca3af', flexShrink:0 }}>{time}</span>}
                </div>
              );
            })}

            {/* Default shifts — labeled "Default", disabled, no checkbox */}
            {filteredDefaults.length > 0 && (
              <>
                <div style={{ padding:'4px 12px', fontSize:10, fontWeight:700, color:'#9ca3af',
                  background:'#f9fafb', borderTop:'1px solid #e5e7eb', textTransform:'uppercase', letterSpacing:.5 }}>
                  Default (disabled)
                </div>
                {filteredDefaults.map(s => {
                  const time = s.start_time && s.end_time ? `${s.start_time.slice(0,5)}-${s.end_time.slice(0,5)}` : '';
                  return (
                    <div key={s.id} style={{ padding:'6px 12px', display:'flex', alignItems:'center', gap:8,
                      cursor:'not-allowed', background:'#f9fafb', borderBottom:'1px solid #f9fafb', opacity:.5 }}
                      title="Default shift — cannot be selected">
                      <input type="checkbox" disabled style={{ width:13, height:13, flexShrink:0 }} />
                      <span style={{ fontSize:13, color:'#9ca3af', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {s.name}
                        <span style={{ marginLeft:6, fontSize:10, background:'#f3f4f6', color:'#9ca3af', padding:'1px 5px', borderRadius:4 }}>Default</span>
                      </span>
                      {time && <span style={{ fontSize:11, color:'#d1d5db', flexShrink:0 }}>{time}</span>}
                    </div>
                  );
                })}
              </>
            )}

            {filtered.length === 0 && filteredDefaults.length === 0 && (
              <div style={{ padding:'12px', fontSize:12, color:'#9ca3af', textAlign:'center' }}>No shifts found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/* ── Table style helpers ── */
const thSt = (sticky, colIdx = -1) => ({
  padding: '4px 8px',
  fontSize: 12.5,
  fontWeight: 700,
  color: '#374151',
  borderBottom: '2px solid #dedede',
  borderRight: '1px solid #dedede',
  background: '#efefef',
  textAlign: 'left',
  whiteSpace: 'nowrap',
  ...(sticky && colIdx >= 0 ? {
    position:'sticky', left: STICKY_LEFTS[colIdx], zIndex:2,
    minWidth: STICKY_WIDTHS[colIdx], width: STICKY_WIDTHS[colIdx],
  } : {}),
});

const tdSt = (sticky, colIdx = -1) => ({
  padding: '3px 8px',
  fontSize: 12.5,
  color: '#374151',
  borderBottom: '1px solid #dedede',
  borderRight: '1px solid #dedede',
  whiteSpace: 'nowrap',
  ...(sticky && colIdx >= 0 ? {
    position:'sticky', left: STICKY_LEFTS[colIdx], zIndex:1, background:'inherit',
    minWidth: STICKY_WIDTHS[colIdx], width: STICKY_WIDTHS[colIdx],
  } : {}),
});

/* ── Roster Menu ──────────────────────────────────────────────── */
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
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(p => !p)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 12px',
          height: 30, background: open ? '#1e40af' : '#1a56db', color: 'white', border: 'none',
          borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer',
          boxShadow: '0 2px 8px rgba(26,86,219,.3)', transition: 'background .15s' }}>
        <svg viewBox="0 0 20 20" fill="white" width="12" height="12">
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

/* ══════════════════════════════════════════════════
   Main Page
══════════════════════════════════════════════════ */
const DutyRosterDeptWise = () => {
  const navigate     = useNavigate();
  const { settings } = useSettings();
  const { canEdit, currentUser } = useAuth();
  const canEditRoster = canEdit('dutyRoster');
  const { filteredEmployees: employees, getApprovedLeaveForDate, getLeaveTypeName } = useData();

  const currentFY    = getCurrentFY(settings.fiscalYears || []);
  const currentFYId  = currentFY?.id ?? null;
  const todayBS      = adToBS(getNepalTodayISO()) || { year: 2083, month: 2, day: 1 };

  const [shifts,     setShifts]     = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [showConfig,      setShowConfig]      = useState(false);
  const [gridVisible,     setGridVisible]     = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false); // entire create workflow as modal

  /* ── Advanced Search (persistent top bar) ── */
  const [showAdvSearch,  setShowAdvSearch]  = useState(true); // open by default
  const [gridSearched,   setGridSearched]   = useState(false);
  const [advSearch, setAdvSearch] = useState({
    fiscalYearId:  currentFYId,
    bsMonth:       todayBS.month,
    staffIds:      [],       // array — multi-select staff
    departments:   [],       // array — multi-select departments
    workingOnly:   true,
  });
  const setAS = (k, v) => setAdvSearch(p => ({ ...p, [k]: v }));

  /* ── View Roster mode — default to 'view' ── */
  const [pageMode,      setPageMode]      = useState('view'); // default = view
  const [viewType,      setViewType]      = useState('monthly'); // 'monthly' | 'weekly'
  const [viewPeriodNum, setViewPeriodNum] = useState(1);
  // viewBsYear is derived from the selected FY — not manually set
  const [viewBsYear,    setViewBsYear]    = useState(todayBS.year); // overridden below
  const [viewBsMonth,   setViewBsMonth]   = useState(todayBS.month);
  const [rosters,       setRosters]       = useState([]); // existing duty_roster entries

  const [config, setConfig] = useState({
    fiscalYearId:  currentFYId,
    branches:      [],
    departments:   [],
    posts:         [],
    modes:         [],
    grades:        [],
    workingOnly:   true,
    periodType:    'halfMonthly',
    bsYear:        todayBS.year,
    bsMonth:       todayBS.month,
    weekOrHalf:    1,
  });
  const setC = (k, v) => setConfig(p => ({ ...p, [k]: v }));

  const periodDates = useMemo(() =>
    gridVisible ? getPeriodDates(config.bsYear, config.bsMonth, config.periodType, config.weekOrHalf) : [],
  [config, gridVisible]);

  // value = string[] per cell ([] = empty, ['OFF'] = off day, [id1, id2] = multiple shifts)
  const [colShifts,     setColShifts]     = useState({});  // dateStr -> string[]
  const [cellOverrides, setCellOverrides] = useState({});  // empId_dateStr -> string[]
  const [savedResults,  setSavedResults]  = useState(null);

  // Exchange Duty (Create Roster grid) — modal context + session-only "just
  // exchanged" badge map (empId_dateStr -> partner's display name).
  const [exchangeModal,   setExchangeModal]   = useState(null); // { empId, dateStr } | null
  const [exchangeBadges,  setExchangeBadges]  = useState({});
  const [exchangeSaving,  setExchangeSaving]  = useState(false);

  const [viewEditMode,      setViewEditMode]      = useState(false);
  const [viewColShifts,     setViewColShifts]     = useState({});
  const [viewEditOverrides, setViewEditOverrides] = useState({});
  const [viewRemovedEmpIds, setViewRemovedEmpIds] = useState(() => new Set()); // staff removed via the row "x" while editing, excluded from Save Changes

  // Exchange Duty (View Roster edit grid) — same idea, separate state.
  const [viewExchangeModal,  setViewExchangeModal]  = useState(null);
  const [viewExchangeBadges, setViewExchangeBadges] = useState({});
  const [viewExchangeSaving, setViewExchangeSaving] = useState(false);

  const getEffective = useCallback((empId, dateStr) => {
    const k = `${empId}_${dateStr}`;
    return k in cellOverrides ? cellOverrides[k] : (colShifts[dateStr] ?? []);
  }, [colShifts, cellOverrides]);

  // When OFF is set, mark ALL subsequent occurrences of same day-of-week in the period
  const applyAutoOff = (map, dateStr) => {
    if (!map[dateStr]?.includes('OFF')) return;
    const idx    = periodDates.findIndex(d => d.adDateStr === dateStr);
    const dayKey = periodDates[idx]?.dayKey;
    if (!dayKey) return;
    // Mark every later date in the period that falls on the same day-of-week
    periodDates.slice(idx + 1).forEach(d => {
      if (d.dayKey === dayKey) map[d.adDateStr] = ['OFF'];
    });
  };

  // When first-date column header is set, copy to ALL column headers
  const setColShift = (dateStr, val) => {
    const isFirst = periodDates.length > 0 && dateStr === periodDates[0].adDateStr;
    if (isFirst) {
      const filled = {};
      periodDates.forEach(({ adDateStr }) => { filled[adDateStr] = val; });
      applyAutoOff(filled, dateStr);
      setColShifts(filled);
    } else {
      setColShifts(p => {
        const next = { ...p, [dateStr]: val };
        applyAutoOff(next, dateStr);
        return next;
      });
    }
  };

  // Sets the shift for a single employee's single day only.
  const setCellShift = (empId, dateStr, val) => {
    setCellOverrides(p => {
      const next = { ...p, [`${empId}_${dateStr}`]: val };
      // Auto-OFF: same day-of-week next occurrence
      if (val?.includes('OFF')) {
        const idx  = periodDates.findIndex(d => d.adDateStr === dateStr);
        const dKey = periodDates[idx]?.dayKey;
        periodDates.slice(idx + 1).forEach(d => {
          if (d.dayKey === dKey) next[`${empId}_${d.adDateStr}`] = ['OFF'];
        });
      }
      return next;
    });
  };

  // Swaps two employees' duty for one specific date, persisted immediately
  // via the existing single-day upsert endpoint (independent of the bulk
  // period Save) so it survives regardless of whether the surrounding
  // period is ever saved.
  const confirmExchange = async (target) => {
    if (!exchangeModal || !target) return;
    const { empId, dateStr } = exchangeModal;
    const effA = getEffective(empId, dateStr);
    const effB = getEffective(target.id, dateStr);
    const createdBy = currentUser?.fullName || currentUser?.username || 'Admin';
    setExchangeSaving(true);
    setError('');
    try {
      await Promise.all([
        api.post('/duty-roster/bulk-days', { employeeId: empId,     dates: [dateStr], shiftIds: effB, createdBy }),
        api.post('/duty-roster/bulk-days', { employeeId: target.id, dates: [dateStr], shiftIds: effA, createdBy }),
      ]);
      setCellOverrides(p => ({ ...p, [`${empId}_${dateStr}`]: effB, [`${target.id}_${dateStr}`]: effA }));
      const empObj = filteredEmployees.find(e => e.id === empId);
      const empName    = empObj?.full_name || empObj?.fullName || '';
      const targetName = target.full_name  || target.fullName  || '';
      setExchangeBadges(p => ({ ...p,
        [`${empId}_${dateStr}`]:     { name: targetName, partnerId: target.id },
        [`${target.id}_${dateStr}`]: { name: empName,    partnerId: empId },
      }));
      setExchangeModal(null);
    } catch (e) {
      setError(e.message || 'Failed to exchange duty.');
    } finally {
      setExchangeSaving(false);
    }
  };

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([api.get('/shifts'), api.get('/duty-roster')])
      .then(([shfts, ros]) => {
        setShifts(shfts || []);
        setRosters(ros || []);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const filteredEmployees = useMemo(() => {
    if (!gridVisible) return [];
    const f = config;
    return employees.filter(e => {
      if (f.workingOnly && !e.active) return false;
      if (f.branches.length    && !f.branches.includes(e.branch      || '')) return false;
      if (f.departments.length && !f.departments.includes(e.department || '')) return false;
      if (f.posts.length       && !f.posts.includes(e.position        || '')) return false;
      if (f.modes.length       && !f.modes.includes(e.mode            || '')) return false;
      if (f.grades.length      && !f.grades.includes(e.grade          || '')) return false;
      return true;
    });
  }, [employees, config, gridVisible]);

  /* ── View mode: period dates + filtered employees ── */
  const viewDates = useMemo(() =>
    pageMode === 'view' ? getPeriodDates(viewBsYear, viewBsMonth, viewType === 'monthly' ? 'halfMonthly' : 'weekly', viewPeriodNum) : [],
  [pageMode, viewBsYear, viewBsMonth, viewType, viewPeriodNum]);

  // Filter employees for view mode using advSearch filters
  const viewEmployees = useMemo(() => {
    if (pageMode !== 'view' || !gridSearched) return [];
    return employees.filter(e => {
      if (advSearch.workingOnly && !e.active) return false;
      if (advSearch.staffIds.length > 0 && !advSearch.staffIds.includes(String(e.id))) return false;
      if (advSearch.departments.length > 0 && !advSearch.departments.includes(e.department || '')) return false;
      return true;
    });
  }, [employees, pageMode, advSearch, gridSearched]);

  // Look up existing roster shift for emp+date from saved duty_roster entries
  // Staff dropdown options: Name - Post - Dept - DeviceID (working only), scoped
  // to whichever department(s) are picked so the list doesn't offer staff the
  // search can't actually return.
  const staffOptions = useMemo(() =>
    employees
      .filter(e => e.active)
      .filter(e => advSearch.departments.length === 0 || advSearch.departments.includes(e.department || ''))
      .map(e => {
        const parts = [
          e.full_name || e.fullName,
          e.position,
          e.department,
          e.device_id || e.deviceId,
        ].filter(Boolean);
        return { value: String(e.id), label: parts.join(' - ') };
      }),
  [employees, advSearch.departments]);

  // Convert a date value from the API (may be "2025-05-13T18:15:00.000Z" due to Nepal timezone)
  // back to the correct Nepal local date string "YYYY-MM-DD"
  const rosterDateStr = (val) => {
    if (!val) return '';
    const s = String(val);
    if (!s.includes('T')) return s.slice(0, 10); // already plain string
    // pg returns DATE as UTC timestamp with -5:45 offset; add Nepal offset (+345 min) to recover date
    return new Date(new Date(s).getTime() + 345 * 60000).toISOString().split('T')[0];
  };

  // When more than one roster row covers the same date (a single-day
  // override landing inside a broader range assignment), the narrowest-span
  // row wins, tied by highest id — same convention as the backend's
  // pickMostSpecificEntry (server/routes/attendance.js) and RosterReport.jsx's
  // pickMostSpecificRoster, so this grid never disagrees with what actual
  // attendance processing or the report page would resolve for that date.
  const pickMostSpecificRoster = useCallback((candidates) => {
    if (candidates.length <= 1) return candidates[0] || null;
    const span = r => new Date(rosterDateStr(r.date_to || r.dateTo)) - new Date(rosterDateStr(r.date_from || r.dateFrom));
    return candidates.slice().sort((a, b) => span(a) - span(b) || (b.id || 0) - (a.id || 0))[0];
  }, []);

  // Returns { isOff, ids, label } for the roster row covering this date, or
  // null if none exists. `ids` is the full shiftIds array (not just the
  // first id) so a multi-shift single-day override round-trips correctly;
  // `label` is a display string for the read-only grid.
  const getExistingShift = useCallback((empId, dateStr, dayKey) => {
    const id = typeof empId === 'string' ? parseInt(empId) : empId;
    const covering = rosters.filter(r => {
      // API returns employeeDbId (from GET /api/duty-roster JOIN alias)
      const rid = r.employeeDbId ?? r.employee_id ?? r.employeeId;
      if (Number(rid) !== Number(id)) return false;
      const from = rosterDateStr(r.date_from || r.dateFrom);
      const to   = rosterDateStr(r.date_to   || r.dateTo);
      return from <= dateStr && to >= dateStr;
    });
    const entry = pickMostSpecificRoster(covering);
    if (!entry) return null;
    const offDays = entry.off_days || entry.offDays || [];
    const isOff = Array.isArray(offDays) && offDays.includes(dayKey);
    const rawIds = entry.shiftIds || entry.shift_ids;
    const shiftId = entry.shiftId ?? entry.shift_id;
    const ids = Array.isArray(rawIds) && rawIds.length ? rawIds : (shiftId ? [shiftId] : []);
    const label = isOff ? 'OFF' : (
      ids.map(sid => shifts.find(s => s.id === sid)?.name).filter(Boolean).join(', ')
      || entry.shiftName || entry.shift_name || null
    );
    return { isOff, ids, label };
  }, [rosters, shifts, pickMostSpecificRoster]);

  /* Approved leave overrides the shift/off display for that day — short code
     (e.g. "AL") shown in the cell, full detail in the tooltip. */
  const getLeaveInfo = useCallback((empId, dateStr) => {
    const leave = getApprovedLeaveForDate(empId, dateStr);
    if (!leave) return null;
    return {
      code:          leave.leaveTypeCode,
      name:          getLeaveTypeName(leave.leaveTypeCode),
      approvedBy:    leave.approvedBy    || '—',
      recommendedBy: leave.recommendedBy || '—',
    };
  }, [getApprovedLeaveForDate, getLeaveTypeName]);

  // This is the "Create Roster" grid, not a report — it must include staff who
  // don't have a roster entry yet (that's the whole point of assigning one via
  // Edit Shifts). Previously this filtered down to only staff who already had
  // an existing shift covering the period, which meant a newly-searched staff
  // member with no prior roster just silently vanished from the grid.
  const viewEmployeesFiltered = viewEmployees;

  // Staff still in the batch after any row "x" removals during Edit Shifts.
  const visibleViewEmployees = useMemo(() =>
    viewEmployeesFiltered.filter(e => !viewRemovedEmpIds.has(e.id)),
  [viewEmployeesFiltered, viewRemovedEmpIds]);

  const getViewEffective = useCallback((empId, dateStr, dayKey) => {
    const k = `${empId}_${dateStr}`;
    if (k in viewEditOverrides) return viewEditOverrides[k];
    if (dateStr in viewColShifts) return viewColShifts[dateStr];
    const existing = getExistingShift(empId, dateStr, dayKey);
    if (!existing) return [];
    return existing.isOff ? ['OFF'] : existing.ids;
  }, [viewEditOverrides, viewColShifts, getExistingShift]);

  const setViewColShift = (dateStr, val) => {
    const isFirst = viewDates.length > 0 && dateStr === viewDates[0].adDateStr;
    if (isFirst) {
      const filled = {};
      viewDates.forEach(({ adDateStr }) => { filled[adDateStr] = val; });
      setViewColShifts(filled);
    } else {
      setViewColShifts(p => ({ ...p, [dateStr]: val }));
    }
  };

  // Sets the shift for a single employee's single day only.
  const setViewCellShift = (empId, dateStr, val) => {
    setViewEditOverrides(p => ({ ...p, [`${empId}_${dateStr}`]: val }));
  };

  // Same swap as confirmExchange (Create Roster grid) — View Roster edit
  // mode keeps its own modal/badge state but shares the same persistence.
  const confirmViewExchange = async (target) => {
    if (!viewExchangeModal || !target) return;
    const { empId, dateStr, dayKey } = viewExchangeModal;
    const effA = getViewEffective(empId, dateStr, dayKey);
    const effB = getViewEffective(target.id, dateStr, dayKey);
    const createdBy = currentUser?.fullName || currentUser?.username || 'Admin';
    setViewExchangeSaving(true);
    setError('');
    try {
      await Promise.all([
        api.post('/duty-roster/bulk-days', { employeeId: empId,     dates: [dateStr], shiftIds: effB, createdBy }),
        api.post('/duty-roster/bulk-days', { employeeId: target.id, dates: [dateStr], shiftIds: effA, createdBy }),
      ]);
      setViewEditOverrides(p => ({ ...p, [`${empId}_${dateStr}`]: effB, [`${target.id}_${dateStr}`]: effA }));
      const empObj = viewEmployeesFiltered.find(e => e.id === empId);
      const empName    = empObj?.full_name || empObj?.fullName || '';
      const targetName = target.full_name  || target.fullName  || '';
      setViewExchangeBadges(p => ({ ...p,
        [`${empId}_${dateStr}`]:     { name: targetName, partnerId: target.id },
        [`${target.id}_${dateStr}`]: { name: empName,    partnerId: empId },
      }));
      setViewExchangeModal(null);
    } catch (e) {
      setError(e.message || 'Failed to exchange duty.');
    } finally {
      setViewExchangeSaving(false);
    }
  };

  // Exchange Duty candidates: always the current employee's own department,
  // from the full staff directory — not viewEmployeesFiltered, which is
  // narrowed by whatever the Advanced Search filters happen to be (e.g. a
  // single staff member searched up alone would otherwise leave no one to
  // exchange with, even though same-department colleagues exist).
  const viewExchangeEmployee = useMemo(() =>
    employees.find(e => e.id === viewExchangeModal?.empId) || null,
  [employees, viewExchangeModal]);
  const viewExchangeCandidates = useMemo(() => {
    if (!viewExchangeEmployee) return [];
    return employees.filter(e =>
      e.active && e.id !== viewExchangeEmployee.id &&
      (e.department || '') === (viewExchangeEmployee.department || ''));
  }, [employees, viewExchangeEmployee]);

  // True if there's already a plain single-day roster row (date_from ===
  // date_to === dateStr) for this employee — used by the Save flows below to
  // know whether a day matching the base needs its stale override cleared.
  const hasSingleDayRow = useCallback((empId, dateStr) => rosters.some(r => {
    const rid = r.employeeDbId ?? r.employee_id ?? r.employeeId;
    if (Number(rid) !== Number(empId)) return false;
    const from = rosterDateStr(r.date_from || r.dateFrom);
    const to   = rosterDateStr(r.date_to   || r.dateTo);
    return from === dateStr && to === dateStr;
  }), [rosters]);

  // Order-independent comparison of two ShiftCell-style values (string[] of
  // shiftIds or ['OFF']).
  const sameEff = (a, b) => {
    const as = new Set(a.map(String)), bs = new Set(b.map(String));
    if (as.size !== bs.size) return false;
    for (const v of as) if (!bs.has(v)) return false;
    return true;
  };

  const handleViewSave = async () => {
    if (viewDates.length === 0) return;
    setSaving(true);
    setError('');
    try {
      const dateFrom   = viewDates[0].adDateStr;
      const dateTo     = viewDates[viewDates.length - 1].adDateStr;
      const createdBy  = currentUser?.fullName || currentUser?.username || 'Admin';
      const entries        = [];
      const overrideCalls  = [];
      for (const emp of visibleViewEmployees) {
        const shiftCounts = {};
        const offDaySet   = new Set();
        const perDate      = [];
        for (const { adDateStr, dayKey } of viewDates) {
          const eff = getViewEffective(emp.id, adDateStr, dayKey);
          perDate.push({ adDateStr, dayKey, eff });
          if (eff.includes('OFF')) offDaySet.add(dayKey);
          else eff.forEach(id => { shiftCounts[id] = (shiftCounts[id] || 0) + 1; });
        }
        const primaryShiftId = Object.keys(shiftCounts).sort((a, b) => shiftCounts[b] - shiftCounts[a])[0];
        if (!primaryShiftId) continue;
        entries.push({ employeeId: emp.id, shiftId: parseInt(primaryShiftId), dateFrom, dateTo, offDays: [...offDaySet] });

        // Every day that deviates from this base gets a genuine single-day
        // override persisted via bulk-days (same mechanism Exchange Duty
        // already uses); every day that now matches the base but still has
        // a stale override row (e.g. a prior Exchange Duty swap, or an
        // earlier Save) gets that row cleared. This is what makes per-day
        // assignments actually stick instead of being discarded to the
        // period's majority shift, and what makes a stuck override
        // editable/removable again through the normal grid.
        for (const { adDateStr, dayKey, eff } of perDate) {
          const baseVal = offDaySet.has(dayKey) ? ['OFF'] : [primaryShiftId];
          if (!sameEff(baseVal, eff)) {
            // A day left genuinely blank (eff.length === 0) needs forceBlank
            // so it persists as "no shift" instead of a plain delete/no-op
            // falling through to the non-blank base entry above.
            overrideCalls.push({ employeeId: emp.id, dates: [adDateStr], shiftIds: eff, createdBy, forceBlank: eff.length === 0 });
          } else if (hasSingleDayRow(emp.id, adDateStr)) {
            overrideCalls.push({ employeeId: emp.id, dates: [adDateStr], shiftIds: [], createdBy });
          }
        }
      }
      if (entries.length === 0) return setError('No shifts to save.');
      await Promise.all([
        ...entries.map(e => api.post('/duty-roster', e)),
        ...overrideCalls.map(c => api.post('/duty-roster/bulk-days', c)),
      ]);
      const freshRosters = await api.get('/duty-roster');
      setRosters(freshRosters || []);
      setViewEditMode(false);
      setViewColShifts({});
      setViewEditOverrides({});
      setViewRemovedEmpIds(new Set());
      setSuccessMsg(`Shifts updated for ${entries.length} staff.`);
    } catch (e) {
      setError(e.message || 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const sNames     = key => (settings[key] || []).map(x => x.name || x).filter(Boolean).sort();
  const uniq       = field => [...new Set(employees.map(e => e[field]).filter(Boolean))].sort();
  const branchOpts = sNames('branches').length    ? sNames('branches')    : uniq('branch');
  const deptOpts   = sNames('departments').length ? sNames('departments') : uniq('department');
  const postOpts   = sNames('posts').length       ? sNames('posts')       : uniq('position');
  const modeOpts   = [...new Set(employees.map(e => e.mode).filter(Boolean))].sort();
  const gradeOpts  = sNames('grades').length      ? sNames('grades')      : uniq('grade');

  const periodLabel = useMemo(() => {
    const mName = BS_MONTHS_EN[config.bsMonth - 1];
    if (config.periodType === 'weekly') {
      return `${['1st','2nd','3rd','4th'][config.weekOrHalf - 1]} Week of ${mName} ${config.bsYear}`;
    }
    return `${config.weekOrHalf === 1 ? '1st Half' : '2nd Half'} of ${mName} ${config.bsYear}`;
  }, [config]);

  const fyYears = useMemo(() => {
    const fy = (settings.fiscalYears || []).find(f => f.id === config.fiscalYearId);
    if (!fy) return [todayBS.year];
    const bsStart = adToBS(new Date(fy.startDate));
    const bsEnd   = adToBS(new Date(fy.endDate));
    if (!bsStart || !bsEnd) return [todayBS.year];
    const years = [];
    for (let y = bsStart.year; y <= bsEnd.year; y++) years.push(y);
    return years;
  }, [config.fiscalYearId, settings.fiscalYears, todayBS.year]);

  // BS Year for the config form is derived from the selected Fiscal Year — disabled/auto
  const configFY      = (settings.fiscalYears || []).find(f => f.id === config.fiscalYearId);
  const configBsStart = configFY ? adToBS(new Date(configFY.startDate)) : null;
  const configBsYear  = configBsStart?.year ?? todayBS.year;
  // Keep config.bsYear in sync with FY
  React.useEffect(() => { if (configBsYear !== config.bsYear) setC('bsYear', configBsYear); },
    [configBsYear]);

  // BS Year for View Roster = derived from selected FY in Advanced Search (disabled — fixed by FY)
  const advFY      = (settings.fiscalYears || []).find(f => f.id === advSearch.fiscalYearId);
  const advBsStart = advFY ? adToBS(new Date(advFY.startDate)) : null;
  const advBsYear  = advBsStart?.year ?? todayBS.year;
  // Keep viewBsYear in sync
  React.useEffect(() => { setViewBsYear(advBsYear); }, [advBsYear]);

  const handleGenerate = () => {
    setColShifts({});
    setCellOverrides({});
    setGridVisible(true);
    setShowConfig(false);
    setError('');
    setSuccessMsg('');
  };

  const handleSave = async () => {
    if (filteredEmployees.length === 0) return setError('No employees to create roster for.');
    if (periodDates.length === 0)       return setError('No dates in selected period.');
    setError('');
    setSaving(true);
    try {
      const dateFrom  = periodDates[0].adDateStr;
      const dateTo    = periodDates[periodDates.length - 1].adDateStr;
      const createdBy = currentUser?.fullName || currentUser?.username || 'Admin';

      // Build ONE base entry per employee — same format as individual
      // +Create Roster — plus a genuine single-day override (same mechanism
      // Exchange Duty already uses) for every date whose actual assignment
      // deviates from that base, so per-day variety persists instead of
      // being collapsed to the period's majority shift.
      const skippedNames  = [];
      const entries        = [];
      const overrideCalls  = [];
      for (const emp of filteredEmployees) {
        const shiftCounts = {};
        const offDaySet   = new Set();
        const perDate      = [];
        for (const { adDateStr, dayKey } of periodDates) {
          const eff = getEffective(emp.id, adDateStr);  // string[]
          perDate.push({ adDateStr, dayKey, eff });
          if (eff.includes('OFF')) offDaySet.add(dayKey);
          else eff.forEach(sid => { shiftCounts[sid] = (shiftCounts[sid] || 0) + 1; });
        }
        // Primary shift = most frequently assigned non-OFF shift
        const primaryShiftId = Object.keys(shiftCounts)
          .sort((a, b) => shiftCounts[b] - shiftCounts[a])[0];
        if (!primaryShiftId) {
          skippedNames.push(emp.full_name || emp.fullName || `ID:${emp.id}`);
          continue; // no shift assigned — skip silently
        }
        entries.push({
          employeeId: emp.id,
          shiftId:    parseInt(primaryShiftId),
          dateFrom,
          dateTo,
          offDays:    [...offDaySet],
        });

        for (const { adDateStr, dayKey, eff } of perDate) {
          const baseVal = offDaySet.has(dayKey) ? ['OFF'] : [primaryShiftId];
          if (!sameEff(baseVal, eff)) {
            overrideCalls.push({ employeeId: emp.id, dates: [adDateStr], shiftIds: eff, createdBy });
          } else if (hasSingleDayRow(emp.id, adDateStr)) {
            overrideCalls.push({ employeeId: emp.id, dates: [adDateStr], shiftIds: [], createdBy });
          }
        }
      }

      if (entries.length === 0) {
        const names = skippedNames.join(', ');
        return setError(`No shifts assigned for any staff. Please assign a shift in the grid before saving.\nStaff without shift: ${names}`);
      }

      // Save all entries (same API as individual +Create Roster)
      await Promise.all([
        ...entries.map(e => api.post('/duty-roster', e)),
        ...overrideCalls.map(c => api.post('/duty-roster/bulk-days', c)),
      ]);

      // Reload roster data so view is fresh
      const freshRosters = await api.get('/duty-roster');
      setRosters(freshRosters || []);

      setSavedResults({ dateFrom, dateTo, periodLabel, createdAt: new Date().toLocaleString(), entries, employees: filteredEmployees, shifts });
      const skipMsg = skippedNames.length > 0
        ? ` | ${skippedNames.length} skipped (no shift assigned): ${skippedNames.join(', ')}`
        : '';
      setSuccessMsg(`Roster saved for ${entries.length} staff — ${periodLabel}.${skipMsg}`);

      // Close create modal and show view grid with current week
      setShowCreateModal(false);
      setGridVisible(false);
      const nowBS = adToBS(getNepalTodayISO()) || todayBS;
      const currentWeek = Math.min(4, Math.ceil(nowBS.day / 7));
      setPageMode('view');
      setViewType('weekly');
      setViewBsMonth(nowBS.month);
      setViewPeriodNum(currentWeek);
      if (!gridSearched) setGridSearched(true); // auto-show view grid after save
    } catch (e) {
      setError(e.message || 'Failed to save rosters.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-container">
      <style>{`
        @media print {
          @page { size: A5 landscape; margin: 6mm; }
          body * { visibility: hidden !important; }
          #deptwise-print-area, #deptwise-print-area * { visibility: visible !important; }
          #deptwise-print-area {
            position: fixed !important;
            inset: 0;
            width: 195mm;
            overflow: visible !important;
            padding: 0;
          }
          #deptwise-print-area .print-only { display: block !important; }
          #deptwise-print-area colgroup col { width: auto !important; }
          #deptwise-print-area table {
            width: 100% !important;
            table-layout: auto !important;
            border-collapse: collapse !important;
            font-size: 6.5pt !important;
          }
          #deptwise-print-area table th,
          #deptwise-print-area table td {
            font-size: 6.5pt !important;
            padding: 2px 3px !important;
            overflow: visible !important;
            white-space: nowrap !important;
          }
          #deptwise-print-area table th div { font-size: 6pt !important; margin: 0 !important; }
        }
      `}</style>

      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Create Roster — Department Wise</h1>
          {gridVisible && pageMode === 'create' && (
            <p className="page-subtitle" style={{ color:'#1a56db', fontWeight:600 }}>
              {periodLabel} &nbsp;·&nbsp; {filteredEmployees.length} staff
            </p>
          )}
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <button onClick={() => navigate('/attendance/duty-roster')}
            style={{ height:30, padding:'0 11px', fontSize:12, fontWeight:600,
              background:'white', border:'1px solid #d1d5db', color:'#374151', borderRadius:7, cursor:'pointer' }}>
            Back
          </button>
          {/* Advanced Search toggle */}
          <button onClick={() => setShowAdvSearch(p => !p)}
            style={{ height:30, padding:'0 10px', fontSize:12, fontWeight:600, display:'flex', alignItems:'center', gap:4,
              background: showAdvSearch ? '#eff6ff' : '#f8fafc',
              border: `1px solid ${showAdvSearch ? '#1a56db' : '#d1d5db'}`,
              color: showAdvSearch ? '#1a56db' : '#374151', borderRadius:7, cursor:'pointer' }}>
            <svg viewBox="0 0 20 20" fill="currentColor" width="12" height="12">
              <path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L12 11.414V15a1 1 0 01-.553.894l-4 2A1 1 0 016 17v-5.586L3.293 6.707A1 1 0 013 6V3z" clipRule="evenodd"/>
            </svg>
            {showAdvSearch ? 'Hide Search' : 'Show Search'}
          </button>
          {pageMode === 'view' && gridSearched && viewDates.length > 0 && (
            <button onClick={() => window.print()}
              style={{ height:30, padding:'0 11px', fontSize:12, fontWeight:600, display:'flex', alignItems:'center', gap:4,
                background:'#eff6ff', border:'1px solid #93c5fd', color:'#1d4ed8', borderRadius:7, cursor:'pointer' }}>
              🖨️ Print
            </button>
          )}
          <RosterMenuBtn active="department" onSelect={key => {
            if (key === 'dashboard')       navigate('/attendance/roster-dashboard');
            else if (key === 'staff')      navigate('/attendance/duty-roster');
            else if (key === 'view')       navigate('/attendance/roster-report');
          }} />
          {pageMode === 'create' && (
            <button onClick={() => setShowConfig(true)}
              style={{ height:36, padding:'0 18px', fontSize:13, fontWeight:700,
                background:'#059669', color:'white', border:'none', borderRadius:8, cursor:'pointer',
                boxShadow:'0 2px 8px rgba(5,150,105,.3)' }}>
              {gridVisible ? 'Change Period' : 'Create Roster'}
            </button>
          )}
          {pageMode === 'create' && gridVisible && canEditRoster && (
            <button onClick={handleSave} disabled={saving}
              style={{ height:36, padding:'0 18px', fontSize:13, fontWeight:700,
                background: saving ? '#9ca3af' : '#1a56db', color:'white', border:'none',
                borderRadius:8, cursor: saving ? 'not-allowed' : 'pointer' }}>
              {saving ? 'Saving...' : 'Save Roster'}
            </button>
          )}
        </div>
      </div>

      {/* Advanced Search Panel */}
      {showAdvSearch && (
        <div style={{ background:'#f8fafc', border:'1px solid #e5e7eb', borderRadius:10,
          padding:'16px 18px', marginBottom:14 }}>

          {/* Row 1: FY + Month */}
          <div style={{ display:'flex', flexWrap:'wrap', gap:14, alignItems:'flex-start', marginBottom:12 }}>

            {/* Fiscal Year */}
            <div style={{ flex:'0 0 150px' }}>
              <div style={{ fontSize:11, fontWeight:700, color:'#374151', marginBottom:4 }}>Fiscal Year</div>
              <select value={advSearch.fiscalYearId ?? ''}
                onChange={e => setAS('fiscalYearId', e.target.value ? parseInt(e.target.value) : null)}
                style={{ width:'100%', height:36, border:'1.5px solid #d1d5db', borderRadius:7, padding:'0 8px',
                  fontSize:13, outline:'none', background:'white', cursor:'pointer' }}
                onFocus={e => e.target.style.borderColor = '#1a56db'}
                onBlur={e => e.target.style.borderColor = '#d1d5db'}>
                <option value="">All Fiscal Years</option>
                {(settings.fiscalYears || []).map(fy => <option key={fy.id} value={fy.id}>{fy.name}</option>)}
              </select>
            </div>

            {/* Month */}
            <div style={{ flex:'1 1 280px' }}>
              <div style={{ fontSize:11, fontWeight:700, color:'#374151', marginBottom:4 }}>Month</div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
                {BS_MONTHS_EN.map((m, i) => (
                  <button key={m} onClick={() => { setAS('bsMonth', i + 1); setViewBsMonth(i + 1); }}
                    style={{ padding:'4px 9px', border:`1.5px solid ${advSearch.bsMonth === i+1 ? '#1a56db' : '#e5e7eb'}`,
                      borderRadius:6, cursor:'pointer', fontSize:12, fontWeight:600,
                      background: advSearch.bsMonth === i+1 ? '#1a56db' : 'white',
                      color:      advSearch.bsMonth === i+1 ? 'white'   : '#374151' }}>
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {/* View Type — Monthly / Weekly */}
            <div>
              <div style={{ fontSize:11, fontWeight:700, color:'#374151', marginBottom:4 }}>View Type</div>
              <div style={{ display:'flex', gap:0, border:'1.5px solid #d1d5db', borderRadius:8, overflow:'hidden' }}>
                {[['monthly','Monthly'],['weekly','Weekly']].map(([k,lbl]) => (
                  <button key={k} onClick={() => { setViewType(k); setViewPeriodNum(1); }}
                    style={{ padding:'6px 14px', border:'none', cursor:'pointer', fontSize:12.5, fontWeight:700,
                      background: viewType === k ? '#1a56db' : 'white',
                      color:      viewType === k ? 'white'   : '#6b7280',
                      borderRight: k === 'monthly' ? '1px solid #d1d5db' : 'none' }}>
                    {lbl}
                  </button>
                ))}
              </div>
            </div>

            {/* Half / Week period selector */}
            <div>
              <div style={{ fontSize:11, fontWeight:700, color:'#374151', marginBottom:4 }}>
                {viewType === 'monthly' ? 'Half' : 'Week'}
              </div>
              <div style={{ display:'flex', gap:6 }}>
                {viewType === 'monthly' ? (
                  [1,2].map(h => (
                    <button key={h} onClick={() => setViewPeriodNum(h)}
                      style={{ padding:'5px 12px', border:`1.5px solid ${viewPeriodNum === h ? '#1a56db' : '#e5e7eb'}`,
                        borderRadius:7, cursor:'pointer', fontSize:12.5, fontWeight:700,
                        background: viewPeriodNum === h ? '#eff6ff' : 'white',
                        color:      viewPeriodNum === h ? '#1e40af' : '#374151' }}>
                      {h === 1 ? '1st Half' : '2nd Half'}
                    </button>
                  ))
                ) : (
                  [1,2,3,4].map(w => (
                    <button key={w} onClick={() => setViewPeriodNum(w)}
                      style={{ padding:'5px 10px', border:`1.5px solid ${viewPeriodNum === w ? '#1a56db' : '#e5e7eb'}`,
                        borderRadius:7, cursor:'pointer', fontSize:12.5, fontWeight:700,
                        background: viewPeriodNum === w ? '#eff6ff' : 'white',
                        color:      viewPeriodNum === w ? '#1e40af' : '#374151' }}>
                      {['1st','2nd','3rd','4th'][w-1]} Wk
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Row 2: Department + Staff + Working Only + Search + Clear */}
          <div style={{ display:'flex', gap:10, alignItems:'flex-end', flexWrap:'wrap' }}>

            {/* Department */}
            <div style={{ flex:'0 0 340px' }}>
              <div style={{ fontSize:11, fontWeight:700, color:'#374151', marginBottom:4 }}>Department</div>
              <MCS
                label={null}
                value={advSearch.departments}
                onChange={v => setAS('departments', v)}
                options={deptOpts}
              />
            </div>

            {/* Staff — multi-select */}
            <div style={{ flex:'1 1 300px', minWidth:220 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'#374151', marginBottom:4 }}>
                Staff
                <span style={{ marginLeft:6, fontSize:10, color:'#9ca3af', fontWeight:400 }}>Name · Post · Dept · Device ID</span>
              </div>
              <SearchableSelect
                value={advSearch.staffIds}
                onChange={v => setAS('staffIds', Array.isArray(v) ? v : (v ? [v] : []))}
                options={staffOptions}
                placeholder="Search and select staff..."
                multiple={true}
              />
            </div>

            {/* Working Only */}
            <div>
              <label style={{ display:'inline-flex', alignItems:'center', gap:6, cursor:'not-allowed',
                padding:'0 10px', background:'#eff6ff', border:'1.5px solid #1a56db', borderRadius:7,
                fontSize:12, fontWeight:700, color:'#1e40af', userSelect:'none', height:30, boxSizing:'border-box' }}>
                <input type="checkbox" checked={true} disabled style={{ accentColor:'#1a56db', cursor:'not-allowed' }} />
                Working Only
              </label>
            </div>

            {/* Search button */}
            <button
              onClick={() => {
                setViewBsMonth(advSearch.bsMonth);
                setPageMode('view');
                setGridSearched(true);
              }}
              style={{ height:32, padding:'0 20px', fontSize:12, fontWeight:700,
                background:'#1a56db', color:'white', border:'none', borderRadius:7, cursor:'pointer',
                boxShadow:'0 2px 8px rgba(26,86,219,.3)', whiteSpace:'nowrap', flexShrink:0 }}>
              Search
            </button>

            {/* Clear */}
            {(advSearch.staffIds.length > 0 || advSearch.departments.length > 0) && (
              <button onClick={() => { setAS('staffIds', []); setAS('departments', []); setGridSearched(false); }}
                style={{ height:32, padding:'0 12px', fontSize:11, background:'white', border:'1px solid #d1d5db',
                  color:'#6b7280', borderRadius:7, cursor:'pointer', flexShrink:0 }}>
                Clear
              </button>
            )}

            {/* Edit Shifts / Cancel + Save Changes — only once a period is loaded */}
            {pageMode === 'view' && viewDates.length > 0 && (
              !viewEditMode ? (
                canEditRoster && <button
                  onClick={() => { setViewEditMode(true); setViewColShifts({}); setViewEditOverrides({}); setViewRemovedEmpIds(new Set()); }}
                  style={{ height:32, padding:'0 13px', fontSize:12, fontWeight:700,
                    background:'#f59e0b', color:'white', border:'none', borderRadius:7, cursor:'pointer',
                    flexShrink:0, boxShadow:'0 2px 8px rgba(245,158,11,.3)' }}>
                  ✏️ Edit Shifts
                </button>
              ) : (
                <>
                  <button onClick={() => { setViewEditMode(false); setViewColShifts({}); setViewEditOverrides({}); setViewRemovedEmpIds(new Set()); }}
                    style={{ height:32, padding:'0 12px', fontSize:12, fontWeight:600,
                      background:'white', border:'1px solid #d1d5db', color:'#374151', borderRadius:7,
                      cursor:'pointer', flexShrink:0 }}>
                    Cancel
                  </button>
                  <button onClick={handleViewSave} disabled={saving}
                    style={{ height:32, padding:'0 13px', fontSize:12, fontWeight:700,
                      background: saving ? '#9ca3af' : '#059669', color:'white', border:'none',
                      borderRadius:7, cursor: saving ? 'not-allowed' : 'pointer', flexShrink:0 }}>
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                </>
              )
            )}
            {/* View Roster */}
            <button
              onClick={() => setPageMode('view')}
              style={{ height:32, padding:'0 13px', fontSize:12, fontWeight:700,
                background: pageMode === 'view' ? '#1a56db' : 'white',
                color:      pageMode === 'view' ? 'white'   : '#374151',
                border:'1.5px solid #d1d5db', borderRadius:7, cursor:'pointer', flexShrink:0 }}>
              View Roster
            </button>
          </div>
        </div>
      )}

      {/* Feedback */}
      {error && (
        <div style={{ background:'#fee2e2', border:'1px solid #fca5a5', borderRadius:8,
          padding:'10px 14px', color:'#991b1b', fontSize:13, fontWeight:600, marginBottom:12,
          display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          {error}
          <button onClick={() => setError('')} style={{ background:'none', border:'none', cursor:'pointer', color:'#991b1b', fontWeight:700, fontSize:16 }}>x</button>
        </div>
      )}
      {successMsg && (
        <div style={{ background:'#f0fdf4', border:'1px solid #86efac', borderRadius:8,
          padding:'10px 14px', color:'#065f46', fontSize:13, fontWeight:600, marginBottom:12 }}>
          {successMsg}
        </div>
      )}

      {/* View Roster DataGrid */}
      {pageMode === 'view' && gridSearched && viewDates.length > 0 && !loading && (
        <div id="deptwise-print-area">
          <div style={{ fontSize:12, color:'#6b7280', marginBottom:8 }}>
            Showing: {viewDates[0].adDateStr} to {viewDates[viewDates.length-1].adDateStr}
            &nbsp;·&nbsp; {viewDates.length} days &nbsp;·&nbsp; {visibleViewEmployees.length} staff
            {viewEditMode && viewRemovedEmpIds.size > 0 && (
              <span style={{ color:'#dc2626', fontWeight:600 }}> &nbsp;({viewRemovedEmpIds.size} removed)</span>
            )}
          </div>
          <div className="print-only" style={{ display:'none', marginBottom:8 }}>
            <div style={{ fontSize:14, fontWeight:800, color:'#111827', marginBottom:3 }}>
              Duty Roster — Department Wise
            </div>
            <div style={{ fontSize:10, color:'#374151', display:'flex', gap:10, flexWrap:'wrap' }}>
              <span>BS Year: {advBsYear}</span>
              <span>|</span>
              <span>Month: {BS_MONTHS_EN[viewBsMonth - 1]}</span>
              <span>|</span>
              <span>{viewType === 'monthly' ? (viewPeriodNum === 1 ? '1st Half' : '2nd Half') : `${['1st','2nd','3rd','4th'][viewPeriodNum-1]} Week`}</span>
              <span>|</span>
              <span>{viewDates[0].adDateStr} to {viewDates[viewDates.length-1].adDateStr}</span>
            </div>
          </div>
          <div style={{ overflowX:'auto', border:'1px solid #e5e7eb', borderRadius:10 }}>
          <table style={{ borderCollapse:'collapse', fontSize:12.5, tableLayout:'fixed' }}>
            <colgroup>
              {STICKY_WIDTHS.map((w, i) => <col key={i} style={{ width:w, minWidth:w }} />)}
              {viewDates.map(({ adDateStr }) => <col key={adDateStr} style={{ width:DATE_COL_W, minWidth:DATE_COL_W }} />)}
            </colgroup>
            <thead>
              <tr style={{ background:'#efefef' }}>
                <th style={thSt(true, 0)}>SN</th>
                <th style={thSt(true, 1)}>Name</th>
                <th style={thSt(true, 2)}>Post</th>
                <th style={thSt(true, 3)}>Dept.</th>
                <th style={{ ...thSt(true, 4), boxShadow:'3px 0 6px rgba(0,0,0,.10)' }}>Branch</th>
                {viewDates.map(({ bsDay, adDateStr, dayKey }) => (
                  <th key={adDateStr}
                    style={{ ...thSt(false,-1), textAlign:'center', width:DATE_COL_W, minWidth:DATE_COL_W,
                      color: dayKey === 'Sun' ? '#dc2626' : dayKey === 'Sat' ? '#d97706' : '#374151' }}>
                    <div style={{ fontWeight:700 }}>{String(bsDay).padStart(2,'0')}</div>
                    <div style={{ fontSize:11, opacity:.8 }}>{dayKey}</div>
                  </th>
                ))}
              </tr>
              {viewEditMode && (
                <tr style={{ background:'#fffbeb', borderBottom:'2px solid #fcd34d' }}>
                  <td style={{ ...tdSt(true, 0) }} colSpan={4}>
                    <span style={{ fontSize:11, fontWeight:700, color:'#92400e', paddingLeft:4 }}>Set shift for all</span>
                  </td>
                  <td style={{ ...tdSt(true, 4), boxShadow:'3px 0 6px rgba(0,0,0,.10)' }} />
                  {viewDates.map(({ adDateStr }, di) => (
                    <td key={adDateStr} style={{ ...tdSt(false,-1), padding:'4px 6px', textAlign:'left' }}>
                      <ShiftCell
                        value={viewColShifts[adDateStr] ?? []}
                        onChange={v => setViewColShift(adDateStr, v)}
                        shifts={shifts}
                        isColHeader={true}
                      />
                      {di === 0 && (viewColShifts[adDateStr]?.length > 0) && (
                        <div style={{ fontSize:10, color:'#059669', textAlign:'center', marginTop:2 }}>all filled</div>
                      )}
                    </td>
                  ))}
                </tr>
              )}
            </thead>
            <tbody>
              {visibleViewEmployees.length === 0 ? (
                <tr>
                  <td colSpan={5 + viewDates.length}
                    style={{ textAlign:'center', padding:'40px', color:'#9ca3af', fontSize:13 }}>
                    No staff found. Try adjusting the search filters.
                  </td>
                </tr>
              ) : visibleViewEmployees.map((emp, idx) => (
                <tr key={emp.id} style={{ background: idx % 2 === 0 ? 'white' : '#f3f4f6' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f5f5f5'}
                  onMouseLeave={e => e.currentTarget.style.background = idx % 2 === 0 ? 'white' : '#f3f4f6'}>
                  <td style={{ ...tdSt(true, 0), background:'#efefef', color:'#374151', fontWeight:700, textAlign:'center' }}>{idx + 1}</td>
                  <td style={{ ...tdSt(true, 1), fontWeight:600 }}>{emp.full_name || emp.fullName}</td>
                  <td style={{ ...tdSt(true, 2) }} title={emp.position}>{getShortName(emp.position, settings.posts)}</td>
                  <td style={{ ...tdSt(true, 3) }} title={emp.department}>{getShortName(emp.department, settings.departments)}</td>
                  <td style={{ ...tdSt(true, 4), boxShadow:'3px 0 6px rgba(0,0,0,.08)' }} title={emp.branch}>
                    {viewEditMode ? (
                      <div style={{ position:'relative', paddingRight:14 }}>
                        <button
                          type="button"
                          onClick={() => setViewRemovedEmpIds(prev => { const next = new Set(prev); next.add(emp.id); return next; })}
                          title="Remove this staff — excluded when you Save Changes"
                          style={{ position:'absolute', top:-4, right:-6, width:15, height:15, lineHeight:'13px',
                            border:'none', borderRadius:'50%', background:'#fee2e2', color:'#dc2626',
                            fontSize:11, fontWeight:700, cursor:'pointer', padding:0 }}>
                          ×
                        </button>
                        {getShortName(emp.branch, settings.branches)}
                      </div>
                    ) : getShortName(emp.branch, settings.branches)}
                  </td>
                  {viewDates.map(({ bsDay, adDateStr, dayKey }) => {
                    if (viewEditMode) {
                      const eff = getViewEffective(emp.id, adDateStr, dayKey);
                      const isOverridden = `${emp.id}_${adDateStr}` in viewEditOverrides;
                      const exchangedWith = viewExchangeBadges[`${emp.id}_${adDateStr}`];
                      const cellHeader = {
                        name: emp.full_name || emp.fullName,
                        post: emp.position,
                        dateLabel: `${String(bsDay).padStart(2,'0')}-${BS_MONTHS_EN[viewBsMonth-1]}-${viewBsYear} - ${DAY_KEYS_FULL[dayKey]}`,
                      };
                      return (
                        <td key={adDateStr} style={{ ...tdSt(false,-1), textAlign:'left', padding:'3px 4px',
                          background: eff.includes('OFF') ? '#fff5f5' : eff.length > 0 ? '#f0fdf4' : 'inherit' }}>
                          <div style={{ position:'relative', display:'inline-block' }}
                            title={exchangedWith ? `Exchanged with ${exchangedWith.name}` : undefined}>
                            <ShiftCell value={eff} onChange={v => setViewCellShift(emp.id, adDateStr, v)} shifts={shifts} header={cellHeader}
                              isColHeader={false} hideEmptyDash={!!exchangedWith}
                              onExchange={() => setViewExchangeModal({ empId: emp.id, dateStr: adDateStr, dayKey })} />
                            {isOverridden && (
                              <span title="Override" style={{ position:'absolute', top:-2, right:-2, width:6, height:6, background:'#f59e0b', borderRadius:'50%' }} />
                            )}
                            {exchangedWith && (
                              <div style={{ fontSize:9, lineHeight:'12px', fontWeight:700, color: colorForPartner(exchangedWith.partnerId) }}>
                                <div>Duty Exchange</div>
                                <div style={{ fontWeight:600 }}>{exchangedWith.name}</div>
                              </div>
                            )}
                          </div>
                        </td>
                      );
                    }
                    const existing = getExistingShift(emp.id, adDateStr, dayKey);
                    const isOff = !!existing?.isOff;
                    const shift = existing?.label || null;
                    const leave = getLeaveInfo(emp.id, adDateStr);
                    return (
                      <td key={adDateStr}
                        style={{ ...tdSt(false,-1), textAlign:'center', padding:'4px 6px',
                          background: leave ? '#fffbeb' : isOff ? '#fff5f5' : shift ? '#f0fdf4' : 'inherit' }}>
                        {leave ? (
                          <span
                            title={`${leave.name} — Approved by: ${leave.approvedBy} & Recommended by: ${leave.recommendedBy}`}
                            style={{ fontWeight:700, color:'#d97706', cursor:'help', borderBottom:'1px dotted #d97706' }}>
                            {leave.code}
                          </span>
                        ) : isOff ? (
                          <span style={{ fontWeight:700, color:'#dc2626' }}>OFF</span>
                        ) : shift ? (
                          <span style={{ color:'#111827' }}>{shift}</span>
                        ) : (
                          <span style={{ color:'#d1d5db' }}>—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Empty state (create mode only) */}
      {pageMode === 'create' && !gridVisible && !showConfig && (
        <div style={{ textAlign:'center', padding:'80px 20px', color:'#9ca3af' }}>
          <div style={{ fontSize:48, marginBottom:16 }}>🏢</div>
          <div style={{ fontSize:17, fontWeight:700, color:'#374151', marginBottom:8 }}>Create Roster for Department</div>
          <div style={{ fontSize:14, color:'#6b7280', marginBottom:24 }}>
            Click "Create Roster" to select filters and period, then assign shifts in the grid.
          </div>
          <button onClick={() => setShowConfig(true)}
            style={{ height:40, padding:'0 24px', fontSize:14, fontWeight:700,
              background:'#059669', color:'white', border:'none', borderRadius:8, cursor:'pointer' }}>
            Create Roster
          </button>
        </div>
      )}

      {/* Create Roster Modal — full-screen, contains config + shift grid */}
      {showCreateModal && gridVisible && !showConfig && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.45)', zIndex:1000,
          display:'flex', flexDirection:'column', overflow:'hidden' }}
          onClick={() => { setShowCreateModal(false); setGridVisible(false); }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background:'#f8fafc', flex:1, display:'flex', flexDirection:'column',
              margin:'20px', borderRadius:14, boxShadow:'0 25px 60px rgba(0,0,0,.3)',
              overflow:'hidden', maxHeight:'calc(100vh - 40px)' }}>

            {/* Modal header */}
            <div style={{ background:'#ffffff', borderBottom:'1px solid #e5e7eb', padding:'14px 20px', display:'flex',
              alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
              <div>
                <span style={{ fontWeight:800, fontSize:15, color:'#111827' }}>
                  Create Roster — {periodLabel}
                </span>
                <span style={{ marginLeft:10, color:'#6b7280', fontSize:12 }}>
                  {filteredEmployees.length} staff
                </span>
              </div>
              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                {canEditRoster && (
                  <button onClick={handleSave} disabled={saving}
                    style={{ height:34, padding:'0 18px', fontSize:13, fontWeight:700,
                      background: saving ? '#a7f3d0' : '#059669', color:'white',
                      border:'none', borderRadius:7, cursor: saving ? 'not-allowed' : 'pointer' }}>
                    {saving ? 'Saving...' : 'Save Roster'}
                  </button>
                )}
                <button className="modal-close"
                  onClick={() => { setShowCreateModal(false); setGridVisible(false); }}>✕</button>
              </div>
            </div>

            {/* Error/success feedback */}
            {error && (
              <div style={{ background:'#fee2e2', padding:'8px 16px', color:'#991b1b', fontSize:13, fontWeight:600, flexShrink:0 }}>
                {error}
                <button onClick={() => setError('')} style={{ float:'right', background:'none', border:'none', cursor:'pointer', color:'#991b1b', fontSize:15 }}>x</button>
              </div>
            )}

            {/* Scrollable grid area */}
            <div style={{ overflowX:'auto', overflowY:'auto', flex:1, padding:'0' }}>

      {/* Roster Grid (create mode) */}
      {!loading && (
        <div style={{ overflowX:'auto', border:'1px solid #e5e7eb', borderRadius:10 }}>
          <table style={{ borderCollapse:'collapse', fontSize:12.5, tableLayout:'fixed' }}>
            <colgroup>
              {STICKY_WIDTHS.map((w, i) => <col key={i} style={{ width: w, minWidth: w }} />)}
              {periodDates.map(({ adDateStr }) => (
                <col key={adDateStr} style={{ width: DATE_COL_W, minWidth: DATE_COL_W }} />
              ))}
            </colgroup>
            <thead>
              <tr style={{ background:'#efefef' }}>
                <th style={thSt(true, 0)}>SN</th>
                <th style={thSt(true, 1)}>Name</th>
                <th style={thSt(true, 2)}>Post</th>
                <th style={thSt(true, 3)}>Dept.</th>
                <th style={{ ...thSt(true, 4), boxShadow:'3px 0 6px rgba(0,0,0,.10)' }}>Branch</th>
                {periodDates.map(({ bsDay, adDateStr, dayKey }, di) => (
                  <th key={adDateStr}
                    style={{ ...thSt(false,-1), textAlign:'center', width:DATE_COL_W, minWidth:DATE_COL_W,
                      color: dayKey === 'Sun' ? '#dc2626' : dayKey === 'Sat' ? '#d97706' : '#374151' }}>
                    <div style={{ fontWeight:700 }}>{String(bsDay).padStart(2,'0')}</div>
                    <div style={{ fontSize:11, opacity:.8 }}>{dayKey}</div>
                    {di === 0 && <div style={{ fontSize:10, color:'#059669', fontWeight:600 }}>fills all</div>}
                  </th>
                ))}
              </tr>
              <tr style={{ background:'#f8fafc', borderBottom:'2px solid #dedede' }}>
                <td style={{ ...tdSt(true, 0) }} colSpan={4}>
                  <span style={{ fontSize:11, fontWeight:700, color:'#6b7280', paddingLeft:4 }}>Set shift for all</span>
                </td>
                <td style={{ ...tdSt(true, 4), boxShadow:'3px 0 6px rgba(0,0,0,.10)' }} />
                {periodDates.map(({ adDateStr }, di) => (
                  <td key={adDateStr} style={{ ...tdSt(false,-1), padding:'4px 6px', textAlign:'left' }}>
                    <ShiftCell
                      value={colShifts[adDateStr] ?? []}
                      onChange={v => setColShift(adDateStr, v)}
                      shifts={shifts}
                      isColHeader={true}
                    />
                    {di === 0 && (colShifts[adDateStr]?.length > 0) && (
                      <div style={{ fontSize:10, color:'#059669', textAlign:'center', marginTop:2 }}>all filled</div>
                    )}
                  </td>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredEmployees.length === 0 ? (
                <tr>
                  <td colSpan={5 + periodDates.length}
                    style={{ textAlign:'center', padding:'40px', color:'#9ca3af', fontSize:13 }}>
                    No staff match the selected filters.
                  </td>
                </tr>
              ) : filteredEmployees.map((emp, idx) => {
                // Warn if no shift assigned for this employee
                const hasAnyShift = periodDates.some(({ adDateStr }) => {
                  const eff = getEffective(emp.id, adDateStr);
                  return eff.length > 0 && !eff.includes('OFF');
                });
                return (
                <tr key={emp.id} style={{ background: idx % 2 === 0 ? 'white' : '#f3f4f6' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f5f5f5'}
                  onMouseLeave={e => e.currentTarget.style.background = idx % 2 === 0 ? 'white' : '#f3f4f6'}>
                  <td style={{ ...tdSt(true, 0), background:'#efefef',
                    color:'#374151', fontWeight:700, textAlign:'center' }}>
                    {idx + 1}
                    {!hasAnyShift && <div style={{ fontSize:9, color:'#c2410c' }}>!</div>}
                  </td>
                  <td style={{ ...tdSt(true, 1), fontWeight:600,
                    boxShadow: !hasAnyShift ? 'inset 3px 0 0 #f97316' : undefined }}
                    title={!hasAnyShift ? 'No shift assigned — this staff will NOT be saved' : ''}>
                    {emp.full_name || emp.fullName}
                    {!hasAnyShift && (
                      <div style={{ fontSize:10, color:'#c2410c', fontWeight:400 }}>
                        ⚠ No shift — won't save
                      </div>
                    )}
                  </td>
                  <td style={{ ...tdSt(true, 2) }} title={emp.position}>{getShortName(emp.position, settings.posts)}</td>
                  <td style={{ ...tdSt(true, 3) }} title={emp.department}>{getShortName(emp.department, settings.departments)}</td>
                  <td style={{ ...tdSt(true, 4), boxShadow:'3px 0 6px rgba(0,0,0,.08)' }} title={emp.branch}>{getShortName(emp.branch, settings.branches)}</td>
                  {periodDates.map(({ bsDay, adDateStr, dayKey }) => {
                    const eff = getEffective(emp.id, adDateStr);  // string[]
                    const isOff        = eff.includes('OFF');
                    const isOverridden = `${emp.id}_${adDateStr}` in cellOverrides;
                    const bgColor      = isOff ? '#fff5f5' : eff.length > 0 ? '#f0fdf4' : 'inherit';
                    const exchangedWith = exchangeBadges[`${emp.id}_${adDateStr}`];
                    const cellHeader = {
                      name: emp.full_name || emp.fullName,
                      post: emp.position,
                      dateLabel: `${String(bsDay).padStart(2,'0')}-${BS_MONTHS_EN[config.bsMonth-1]}-${config.bsYear} - ${DAY_KEYS_FULL[dayKey]}`,
                    };
                    return (
                      <td key={adDateStr} style={{ ...tdSt(false,-1), textAlign:'left', padding:'3px 4px', background: bgColor }}>
                        <div style={{ position:'relative', display:'inline-block' }}
                          title={exchangedWith ? `Exchanged with ${exchangedWith.name}` : undefined}>
                          <ShiftCell value={eff} onChange={v => setCellShift(emp.id, adDateStr, v)} shifts={shifts} header={cellHeader}
                            isColHeader={false} hideEmptyDash={!!exchangedWith}
                            onExchange={() => setExchangeModal({ empId: emp.id, dateStr: adDateStr })} />
                          {isOverridden && (
                            <span title="Override" style={{ position:'absolute', top:-2, right:-2, width:6, height:6, background:'#f59e0b', borderRadius:'50%' }} />
                          )}
                          {exchangedWith && (
                            <div style={{ fontSize:9, lineHeight:'12px', fontWeight:700, color: colorForPartner(exchangedWith.partnerId) }}>
                              <div>Duty Exchange</div>
                              <div style={{ fontWeight:600 }}>{exchangedWith.name}</div>
                            </div>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Saved Summary Grid */}
      {savedResults && (
        <div style={{ marginTop:20 }}>
          <div style={{ fontSize:14, fontWeight:800, color:'#111827', marginBottom:10, display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ background:'#f0fdf4', color:'#065f46', border:'1px solid #86efac', borderRadius:6, padding:'3px 10px', fontSize:12 }}>
              Roster Saved
            </span>
            <span style={{ color:'#6b7280', fontSize:13, fontWeight:500 }}>{savedResults.periodLabel}</span>
            <button onClick={() => setSavedResults(null)} style={{ marginLeft:'auto', background:'none', border:'none', cursor:'pointer', color:'#9ca3af', fontSize:16 }}>x</button>
          </div>
          <div style={{ overflowX:'auto', border:'1px solid #e5e7eb', borderRadius:10 }}>
            <table style={{ borderCollapse:'collapse', fontSize:12, width:'100%' }}>
              <thead>
                <tr style={{ background:'#efefef' }}>
                  {['SN','Branch','Department','Set Roster Date','Shift','Staff Count','Created By'].map(h => (
                    <th key={h} style={{ padding:'8px 12px', fontWeight:700, color:'#374151', borderBottom:'2px solid #dedede', borderRight:'1px solid #dedede', whiteSpace:'nowrap', textAlign:'left', fontSize:12 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const groups = {};
                  savedResults.entries.forEach(entry => {
                    const emp = savedResults.employees.find(e => e.id === entry.employeeId);
                    if (!emp) return;
                    const key = `${emp.branch || '—'}___${emp.department || '—'}`;
                    if (!groups[key]) groups[key] = { branch: emp.branch || '—', department: emp.department || '—', count: 0, shiftIds: new Set() };
                    groups[key].count++;
                    groups[key].shiftIds.add(entry.shiftId);
                  });
                  return Object.values(groups).map((g, i) => {
                    const shiftNames = [...g.shiftIds].map(id => savedResults.shifts.find(s => s.id === id)?.name || id).join(', ');
                    return (
                      <tr key={i} style={{ background: i % 2 === 0 ? 'white' : '#f3f4f6' }}>
                        <td style={{ padding:'7px 12px', borderBottom:'1px solid #f3f4f6', borderRight:'1px solid #f3f4f6', color:'#6b7280' }}>{i + 1}</td>
                        <td style={{ padding:'7px 12px', borderBottom:'1px solid #f3f4f6', borderRight:'1px solid #f3f4f6', fontWeight:600 }}>{g.branch}</td>
                        <td style={{ padding:'7px 12px', borderBottom:'1px solid #f3f4f6', borderRight:'1px solid #f3f4f6' }}>{g.department}</td>
                        <td style={{ padding:'7px 12px', borderBottom:'1px solid #f3f4f6', borderRight:'1px solid #f3f4f6', whiteSpace:'nowrap' }}>
                          <span style={{ background:'#eff6ff', color:'#1e40af', borderRadius:5, padding:'2px 8px', fontSize:11, fontWeight:600 }}>
                            {savedResults.dateFrom} to {savedResults.dateTo}
                          </span>
                        </td>
                        <td style={{ padding:'7px 12px', borderBottom:'1px solid #f3f4f6', borderRight:'1px solid #f3f4f6' }}>
                          <span style={{ background:'#f0f9ff', color:'#0369a1', borderRadius:5, padding:'2px 8px', fontSize:11 }}>{shiftNames}</span>
                        </td>
                        <td style={{ padding:'7px 12px', borderBottom:'1px solid #f3f4f6', borderRight:'1px solid #f3f4f6', textAlign:'center', fontWeight:700, color:'#059669' }}>{g.count}</td>
                        <td style={{ padding:'7px 12px', borderBottom:'1px solid #f3f4f6', color:'#6b7280', fontSize:11 }}>{savedResults.createdAt}</td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}

            </div>{/* end scrollable grid area */}
          </div>{/* end modal inner */}
        </div>
      )}{/* end showCreateModal */}

      {/* Config Popup — appears on top of createModal overlay when showConfig is true */}
      {showConfig && (
        <div className="modal-overlay">
          <div onClick={e => e.stopPropagation()}
            style={{ background:'white', borderRadius:14, width:'94vw', maxWidth:820,
              maxHeight:'90vh', display:'flex', flexDirection:'column',
              boxShadow:'0 25px 60px rgba(0,0,0,.22)', overflow:'hidden' }}>

            <div style={{ background:'#ffffff', borderBottom:'1px solid #e5e7eb', padding:'16px 22px',
              display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
              <span style={{ fontWeight:800, fontSize:16, color:'#111827' }}>Create Roster — Department Wise</span>
              <button className="modal-close" onClick={() => setShowConfig(false)}>✕</button>
            </div>

            <div style={{ overflowY:'auto', flex:1, padding:'20px 24px', display:'flex', flexDirection:'column', gap:18 }}>

              {/* Staff Filters */}
              <div>
                <div style={{ fontSize:12, fontWeight:800, color:'#374151', marginBottom:10, textTransform:'uppercase', letterSpacing:.5 }}>Staff Filters</div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12 }}>
                  <div>
                    <div style={{ fontSize:11, fontWeight:700, color:'#374151', marginBottom:4 }}>Fiscal Year</div>
                    <select value={config.fiscalYearId ?? ''}
                      onChange={e => setC('fiscalYearId', e.target.value ? parseInt(e.target.value) : null)}
                      style={{ width:'100%', height:36, border:'1.5px solid #d1d5db', borderRadius:7,
                        padding:'0 8px', fontSize:12, outline:'none', background:'white', cursor:'pointer',
                        color: config.fiscalYearId ? '#1e40af' : '#9ca3af', fontWeight: config.fiscalYearId ? 600 : 400 }}
                      onFocus={e => e.target.style.borderColor = '#1a56db'}
                      onBlur={e => e.target.style.borderColor = '#d1d5db'}>
                      <option value="">All Fiscal Years</option>
                      {(settings.fiscalYears || []).map(fy => <option key={fy.id} value={fy.id}>{fy.name}</option>)}
                    </select>
                  </div>
                  <MCS label="Branch"     value={config.branches}    onChange={v => setC('branches', v)}    options={branchOpts} />
                  <MCS label="Department" value={config.departments} onChange={v => setC('departments', v)} options={deptOpts}   />
                  <MCS label="Post"       value={config.posts}       onChange={v => setC('posts', v)}       options={postOpts}   />
                  <MCS label="Mode"       value={config.modes}       onChange={v => setC('modes', v)}       options={modeOpts}   />
                  <MCS label="Grade"      value={config.grades}      onChange={v => setC('grades', v)}      options={gradeOpts}  />
                </div>
                <div style={{ marginTop:10 }}>
                  <label style={{ display:'inline-flex', alignItems:'center', gap:8, cursor:'not-allowed',
                    padding:'7px 12px', background:'#eff6ff', border:'1.5px solid #1a56db', borderRadius:7,
                    fontSize:12, fontWeight:700, color:'#1e40af', opacity:.85, userSelect:'none' }}>
                    <input type="checkbox" checked={true} disabled style={{ width:15, height:15, accentColor:'#1a56db', cursor:'not-allowed' }} />
                    Status: Working Only
                  </label>
                </div>
              </div>

              <hr style={{ border:'none', borderTop:'1px solid #f3f4f6' }} />

              {/* Roster Period */}
              <div>
                <div style={{ fontSize:12, fontWeight:800, color:'#374151', marginBottom:12, textTransform:'uppercase', letterSpacing:.5 }}>Roster Period</div>

                {/* Weekly / Half Monthly toggle + BS Year (disabled, from FY) — same row */}
                <div style={{ display:'flex', gap:10, marginBottom:16, alignItems:'center', flexWrap:'wrap' }}>
                  <div style={{ display:'flex', gap:0, border:'1.5px solid #d1d5db', borderRadius:8, overflow:'hidden' }}>
                    {[['weekly','Weekly'],['halfMonthly','Half Monthly']].map(([key, lbl]) => (
                      <button key={key} onClick={() => { setC('periodType', key); setC('weekOrHalf', 1); }}
                        style={{ padding:'8px 20px', border:'none', cursor:'pointer', fontSize:13, fontWeight:700,
                          background: config.periodType === key ? '#1a56db' : 'white',
                          color:      config.periodType === key ? 'white'   : '#6b7280',
                          transition:'background .15s',
                          borderRight: key === 'weekly' ? '1px solid #d1d5db' : 'none' }}>
                        {lbl}
                      </button>
                    ))}
                  </div>

                  {/* BS Year — auto-derived from Fiscal Year, disabled */}
                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                    <span style={{ fontSize:11, fontWeight:700, color:'#6b7280' }}>BS Year</span>
                    <div style={{ height:36, padding:'0 14px', border:'1.5px solid #e5e7eb', borderRadius:7,
                      background:'#f9fafb', fontSize:13, fontWeight:700, color:'#374151',
                      display:'flex', alignItems:'center', cursor:'not-allowed', userSelect:'none', minWidth:64 }}>
                      {configBsYear}
                    </div>
                    <span style={{ fontSize:10, color:'#9ca3af' }}>(from Fiscal Year)</span>
                  </div>
                </div>

                {/* Month — only for Half Monthly */}
                {config.periodType === 'halfMonthly' && (
                  <div style={{ marginBottom:14 }}>
                    <div style={{ fontSize:11, fontWeight:700, color:'#374151', marginBottom:4 }}>Month</div>
                    <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                      {BS_MONTHS_EN.map((m, i) => (
                        <button key={m} onClick={() => setC('bsMonth', i + 1)}
                          style={{ padding:'5px 10px', border:`1.5px solid ${config.bsMonth === i+1 ? '#1a56db' : '#e5e7eb'}`,
                            borderRadius:6, cursor:'pointer', fontSize:12, fontWeight:600,
                            background: config.bsMonth === i+1 ? '#1a56db' : 'white',
                            color:      config.bsMonth === i+1 ? 'white'   : '#374151' }}>
                          {m}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Week selector — only for Weekly */}
                {config.periodType === 'weekly' && (
                  <div>
                    <div style={{ fontSize:11, fontWeight:700, color:'#374151', marginBottom:6 }}>Select Week</div>
                    <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                      {[1,2,3,4].map(w => {
                        const totalDays = getBSDays(config.bsYear, config.bsMonth);
                        const start = (w-1)*7+1, end = w===4 ? totalDays : Math.min(w*7, totalDays);
                        return (
                          <button key={w} onClick={() => setC('weekOrHalf', w)}
                            style={{ padding:'8px 16px', border:`2px solid ${config.weekOrHalf === w ? '#1a56db' : '#e5e7eb'}`,
                              borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:700,
                              background: config.weekOrHalf === w ? '#eff6ff' : 'white',
                              color:      config.weekOrHalf === w ? '#1e40af' : '#374151' }}>
                            {['1st','2nd','3rd','4th'][w-1]} Week
                            <div style={{ fontSize:10, color:'#9ca3af', fontWeight:400 }}>Day {start}-{end}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Half selector — only for Half Monthly */}
                {config.periodType === 'halfMonthly' && (
                  <div>
                    <div style={{ fontSize:11, fontWeight:700, color:'#374151', marginBottom:6 }}>Select Half</div>
                    <div style={{ display:'flex', gap:8 }}>
                      {[1,2].map(h => {
                        const totalDays = getBSDays(config.bsYear, config.bsMonth);
                        const start = h===1 ? 1 : 16, end = h===1 ? Math.min(15, totalDays) : totalDays;
                        return (
                          <button key={h} onClick={() => setC('weekOrHalf', h)}
                            style={{ padding:'8px 20px', border:`2px solid ${config.weekOrHalf === h ? '#1a56db' : '#e5e7eb'}`,
                              borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:700,
                              background: config.weekOrHalf === h ? '#eff6ff' : 'white',
                              color:      config.weekOrHalf === h ? '#1e40af' : '#374151' }}>
                            {h===1 ? '1st Half' : '2nd Half'}
                            <div style={{ fontSize:10, color:'#9ca3af', fontWeight:400 }}>Day {start}-{end}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Preview */}
                <div style={{ background:'#f8fafc', borderRadius:8, padding:'10px 14px', marginTop:12,
                  border:'1px solid #e5e7eb', fontSize:12, color:'#374151' }}>
                  <span style={{ fontWeight:700 }}>Preview: </span>
                  {periodLabel} &nbsp;·&nbsp;
                  {(() => {
                    const dates = getPeriodDates(config.bsYear, config.bsMonth, config.periodType, config.weekOrHalf);
                    return `${dates.length} days (${dates[0]?.adDateStr || '?'} to ${dates[dates.length-1]?.adDateStr || '?'})`;
                  })()}
                </div>
              </div>

              {/* Actions */}
              <div style={{ display:'flex', justifyContent:'flex-end', gap:10 }}>
                <button onClick={() => { setShowConfig(false); setShowCreateModal(false); setGridVisible(false); }}
                  style={{ height:38, padding:'0 18px', fontSize:13, fontWeight:600,
                    background:'white', border:'1px solid #d1d5db', color:'#374151', borderRadius:8, cursor:'pointer' }}>
                  Cancel
                </button>
                <button onClick={handleGenerate}
                  style={{ height:38, padding:'0 22px', fontSize:13, fontWeight:700,
                    background:'#059669', color:'white', border:'none', borderRadius:8, cursor:'pointer' }}>
                  Generate Grid
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Exchange Duty — Create Roster grid */}
      <ExchangeDutyModal
        open={!!exchangeModal}
        onClose={() => setExchangeModal(null)}
        employee={filteredEmployees.find(e => e.id === exchangeModal?.empId)}
        dateStr={exchangeModal?.dateStr}
        candidates={filteredEmployees.filter(e => e.id !== exchangeModal?.empId)}
        getDutyText={empId => formatDutyText(getEffective(empId, exchangeModal?.dateStr), shifts)}
        saving={exchangeSaving}
        onConfirm={confirmExchange}
      />

      {/* Exchange Duty — View Roster edit grid */}
      <ExchangeDutyModal
        open={!!viewExchangeModal}
        onClose={() => setViewExchangeModal(null)}
        employee={viewExchangeEmployee}
        dateStr={viewExchangeModal?.dateStr}
        candidates={viewExchangeCandidates}
        getDutyText={empId => formatDutyText(getViewEffective(empId, viewExchangeModal?.dateStr, viewExchangeModal?.dayKey), shifts)}
        saving={viewExchangeSaving}
        onConfirm={confirmViewExchange}
      />

    </div>
  );
};

export default DutyRosterDeptWise;
