import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client.js';
import { useSettings } from '../../context/SettingsContext.jsx';
import { useAuth }     from '../../context/AuthContext.jsx';
import { useData }     from '../../context/DataContext.jsx';
import { adToBS, bsToAD, getBSDays, BS_MONTHS_EN } from '../../utils/dateUtils.js';
import { adToISO } from '../Common/NepaliDatePicker.jsx';
import SearchableSelect from '../Common/SearchableSelect.jsx';

const DAY_KEYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

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

function getCurrentFY(fiscalYears = []) {
  const today = new Date().toISOString().split('T')[0];
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

/* ── Multi-Checkbox Select ── */
const MCS = ({ label, value, onChange, options, displayFn }) => {
  const [open, setOpen] = useState(false);
  const [srch, setSrch] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const filtered = srch ? options.filter(o => o.toLowerCase().includes(srch.toLowerCase())) : options;
  const toggle   = v => onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v]);
  const selLabel = value.length === 0 ? 'All'
    : value.length === 1 ? (displayFn ? displayFn(value[0]) : value[0])
    : `${value.length} selected`;

  return (
    <div ref={ref} style={{ position:'relative' }}>
      {label && <div style={{ fontSize:11, fontWeight:700, color:'#374151', marginBottom:4 }}>{label}</div>}
      <div onClick={() => setOpen(p => !p)} tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter') setOpen(p => !p); if (e.key === 'Escape') setOpen(false); }}
        style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
          padding:'7px 9px', border:`1.5px solid ${open ? '#1a56db' : '#d1d5db'}`, borderRadius:7,
          background:'white', cursor:'pointer', fontSize:12, color: value.length > 0 ? '#1e40af' : '#9ca3af',
          fontWeight: value.length > 0 ? 600 : 400, minHeight:36, outline:'none', userSelect:'none',
          boxShadow: open ? '0 0 0 2px #bfdbfe' : 'none' }}>
        <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 }}>{selLabel}</span>
        <div style={{ display:'flex', alignItems:'center', gap:3, flexShrink:0, marginLeft:4 }}>
          {value.length > 0 && <span style={{ background:'#1a56db', color:'white', borderRadius:10, fontSize:9, fontWeight:700, padding:'1px 5px' }}>{value.length}</span>}
          {value.length > 0 && (
            <span onMouseDown={e => { e.preventDefault(); e.stopPropagation(); onChange([]); }}
              style={{ color:'#9ca3af', fontSize:14, lineHeight:1, cursor:'pointer' }}>x</span>
          )}
          <span style={{ fontSize:9, color:'#9ca3af' }}>{open ? '^' : 'v'}</span>
        </div>
      </div>
      {open && (
        <div style={{ position:'absolute', top:'calc(100% + 2px)', left:0, right:0, zIndex:9999,
          background:'white', border:'1.5px solid #1a56db', borderRadius:8,
          boxShadow:'0 8px 24px rgba(0,0,0,.18)', maxHeight:200, display:'flex', flexDirection:'column' }}>
          <div style={{ padding:'5px 7px', borderBottom:'1px solid #e5e7eb', flexShrink:0 }}>
            <input autoFocus type="text" value={srch} onChange={e => setSrch(e.target.value)}
              placeholder="Search..." onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}
              style={{ width:'100%', border:'1px solid #d1d5db', borderRadius:5, padding:'4px 7px',
                fontSize:12, outline:'none', boxSizing:'border-box' }} />
          </div>
          <div style={{ overflowY:'auto', flex:1 }}>
            {[{ v: null, label: 'All' }, ...filtered.map(o => ({ v: o, label: displayFn ? displayFn(o) : o }))].map(({ v, label: lbl }) => {
              const isAll = v === null;
              const sel   = isAll ? value.length === 0 : value.includes(v);
              return (
                <div key={v ?? '__all'} onMouseDown={e => { e.preventDefault(); isAll ? onChange([]) : toggle(v); }}
                  style={{ padding:'6px 10px', display:'flex', alignItems:'center', gap:7, cursor:'pointer',
                    background: sel ? '#eff6ff' : 'white', borderBottom:'1px solid #f9fafb' }}
                  onMouseEnter={e => { if (!sel) e.currentTarget.style.background = '#f8fafc'; }}
                  onMouseLeave={e => { if (!sel) e.currentTarget.style.background = 'white'; }}>
                  <span style={{ width:13, height:13, borderRadius:3, flexShrink:0, border:`2px solid ${sel ? '#1a56db' : '#d1d5db'}`,
                    background: sel ? '#1a56db' : 'white', display:'flex', alignItems:'center', justifyContent:'center' }}>
                    {sel && <svg viewBox="0 0 12 12" fill="none" width="8" height="8"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round"/></svg>}
                  </span>
                  <span style={{ fontSize:12, color: sel ? '#1e40af' : '#374151', fontWeight: sel ? 600 : 400 }}>{lbl}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

/* ── Per-cell Shift Dropdown ── value = string[] (shiftIds or 'OFF') ── */
const ShiftCell = ({ value = [], onChange, shifts, isColHeader }) => {
  const [open, setOpen] = useState(false);
  const [srch, setSrch] = useState('');
  const [dropPos, setDropPos] = useState({ top: 0, left: 0 });
  const ref        = useRef(null);
  const triggerRef = useRef(null);
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setSrch(''); } };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const handleOpen = () => {
    if (!open && triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      setDropPos({ top: r.bottom + 4, left: r.left });
    }
    setOpen(p => !p);
  };

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
  const toggleOff = () => onChange(isOff ? [] : ['OFF']);
  const clearAll  = () => onChange([]);

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

  const hasSel = isOff || selIds.length > 0;

  return (
    <div ref={ref} style={{ position:'relative' }}>
      {/* Trigger — plain text, left-aligned, no pill/border */}
      <div ref={triggerRef} onClick={handleOpen}
        style={{ cursor:'pointer', userSelect:'none', display:'inline-block',
          padding:'2px 4px', minWidth: isColHeader ? 64 : 36, textAlign:'left',
          background: open ? '#f0f9ff' : 'transparent', borderRadius:4 }}>
        {triggerContent}
        {!hasSel && (
          <span style={{ fontSize:13, color: isColHeader ? '#9ca3af' : '#d1d5db' }}>
            {isColHeader ? 'Set Shift' : '—'}
          </span>
        )}
      </div>

      {open && (
        <div style={{ position:'fixed', top: dropPos.top, left: dropPos.left, zIndex:99999,
          background:'white', border:'1.5px solid #1a56db', borderRadius:10,
          boxShadow:'0 8px 28px rgba(0,0,0,.18)', width:220,
          display:'flex', flexDirection:'column', maxHeight:280 }}>

          {/* Search */}
          <div style={{ padding:'7px 8px', borderBottom:'1px solid #e5e7eb', flexShrink:0 }}>
            <input autoFocus type="text" value={srch} onChange={e => setSrch(e.target.value)}
              placeholder="Search shift..." onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}
              style={{ width:'100%', border:'1.5px solid #d1d5db', borderRadius:7, padding:'5px 9px',
                fontSize:12, outline:'none', boxSizing:'border-box' }}
              onFocus={e => e.target.style.borderColor = '#1a56db'}
              onBlur={e => e.target.style.borderColor = '#d1d5db'} />
          </div>

          <div style={{ overflowY:'auto', flex:1 }}>
            {/* Clear */}
            {hasSel && (
              <div onMouseDown={e => { e.preventDefault(); clearAll(); setOpen(false); setSrch(''); }}
                style={{ padding:'5px 12px', fontSize:12, color:'#6b7280', cursor:'pointer',
                  borderBottom:'1px solid #f1f5f9', display:'flex', alignItems:'center', gap:5 }}
                onMouseEnter={e => e.currentTarget.style.background = '#f9fafb'}
                onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                <svg viewBox="0 0 12 12" fill="none" width="10" height="10"><path d="M2 2l8 8M10 2l-8 8" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round"/></svg>
                Clear selection
              </div>
            )}

            {/* OFF — single checkbox */}
            <div onMouseDown={e => { e.preventDefault(); toggleOff(); }}
              style={{ padding:'6px 12px', display:'flex', alignItems:'center', gap:8, cursor:'pointer',
                background: isOff ? '#fff5f5' : 'white', borderBottom:'1px solid #f1f5f9' }}
              onMouseEnter={e => { if (!isOff) e.currentTarget.style.background = '#f8fafc'; }}
              onMouseLeave={e => { if (!isOff) e.currentTarget.style.background = isOff ? '#fff5f5' : 'white'; }}>
              <input type="checkbox" checked={isOff} readOnly
                style={{ width:13, height:13, cursor:'pointer', accentColor:'#dc2626', flexShrink:0 }} />
              <span style={{ fontSize:13, fontWeight:700, color: isOff ? '#dc2626' : '#374151' }}>OFF</span>
              <span style={{ fontSize:11, color:'#9ca3af', marginLeft:'auto' }}>Day Off</span>
            </div>

            {/* Normal shifts — multi-select checkboxes */}
            {filtered.map(s => {
              const sel  = selIds.includes(s.id);
              const time = s.start_time && s.end_time ? `${s.start_time.slice(0,5)}-${s.end_time.slice(0,5)}` : '';
              return (
                <div key={s.id}
                  onMouseDown={e => { e.preventDefault(); if (!isOff) toggleShift(s.id); }}
                  style={{ padding:'6px 12px', display:'flex', alignItems:'center', gap:8,
                    cursor: isOff ? 'not-allowed' : 'pointer',
                    background: sel ? '#eff6ff' : 'white', borderBottom:'1px solid #f9fafb',
                    opacity: isOff ? .4 : 1 }}
                  onMouseEnter={e => { if (!sel && !isOff) e.currentTarget.style.background = '#f8fafc'; }}
                  onMouseLeave={e => { if (!isOff) e.currentTarget.style.background = sel ? '#eff6ff' : 'white'; }}>
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
  padding: '8px 8px',
  fontSize: 13,
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
  padding: '6px 8px',
  fontSize: 13,
  color: '#374151',
  borderBottom: '1px solid #f3f4f6',
  borderRight: '1px solid #f3f4f6',
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

/* ══════════════════════════════════════════════════
   Main Page
══════════════════════════════════════════════════ */
const DutyRosterDeptWise = () => {
  const navigate     = useNavigate();
  const { settings } = useSettings();
  const { canEdit }  = useAuth();
  const canEditRoster = canEdit('dutyRoster');
  const { filteredEmployees: employees } = useData();

  const currentFY    = getCurrentFY(settings.fiscalYears || []);
  const currentFYId  = currentFY?.id ?? null;
  const todayBS      = adToBS(new Date()) || { year: 2083, month: 2, day: 1 };

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

  const [viewEditMode,      setViewEditMode]      = useState(false);
  const [viewColShifts,     setViewColShifts]     = useState({});
  const [viewEditOverrides, setViewEditOverrides] = useState({});

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

  // When first-date cell for an employee is set, copy to ALL cells in that row
  const setCellShift = (empId, dateStr, val) => {
    const isFirst = periodDates.length > 0 && dateStr === periodDates[0].adDateStr;
    if (isFirst) {
      setCellOverrides(p => {
        const next = { ...p };
        periodDates.forEach(({ adDateStr }) => { next[`${empId}_${adDateStr}`] = val; });
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
    } else {
      setCellOverrides(p => {
        const next = { ...p, [`${empId}_${dateStr}`]: val };
        if (val?.includes('OFF')) {
          const idx  = periodDates.findIndex(d => d.adDateStr === dateStr);
          const dKey = periodDates[idx]?.dayKey;
          periodDates.slice(idx + 1).forEach(d => {
            if (d.dayKey === dKey) next[`${empId}_${d.adDateStr}`] = ['OFF'];
          });
        }
        return next;
      });
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
  // Staff dropdown options: Name - Post - Dept - DeviceID (working only)
  const staffOptions = useMemo(() =>
    employees
      .filter(e => e.active)
      .map(e => {
        const parts = [
          e.full_name || e.fullName,
          e.position,
          e.department,
          e.device_id || e.deviceId,
        ].filter(Boolean);
        return { value: String(e.id), label: parts.join(' - ') };
      }),
  [employees]);

  // Convert a date value from the API (may be "2025-05-13T18:15:00.000Z" due to Nepal timezone)
  // back to the correct Nepal local date string "YYYY-MM-DD"
  const rosterDateStr = (val) => {
    if (!val) return '';
    const s = String(val);
    if (!s.includes('T')) return s.slice(0, 10); // already plain string
    // pg returns DATE as UTC timestamp with -5:45 offset; add Nepal offset (+345 min) to recover date
    return new Date(new Date(s).getTime() + 345 * 60000).toISOString().split('T')[0];
  };

  const getExistingShift = useCallback((empId, dateStr, dayKey) => {
    const id = typeof empId === 'string' ? parseInt(empId) : empId;
    const entry = rosters
      .filter(r => {
        // API returns employeeDbId (from GET /api/duty-roster JOIN alias)
        const rid = r.employeeDbId ?? r.employee_id ?? r.employeeId;
        return Number(rid) === Number(id);
      })
      .sort((a, b) => rosterDateStr(b.date_from || b.dateFrom)
                        .localeCompare(rosterDateStr(a.date_from || a.dateFrom)))
      .find(r => {
        const from = rosterDateStr(r.date_from || r.dateFrom);
        const to   = rosterDateStr(r.date_to   || r.dateTo);
        return from <= dateStr && to >= dateStr;
      });
    if (!entry) return null;
    const offDays = entry.off_days || entry.offDays || [];
    if (Array.isArray(offDays) && offDays.includes(dayKey)) return 'OFF';
    return entry.shiftName || entry.shift_name || null;
  }, [rosters]);

  const viewEmployeesFiltered = useMemo(() => {
    if (viewDates.length === 0) return viewEmployees;
    return viewEmployees.filter(emp =>
      viewDates.some(({ adDateStr, dayKey }) => getExistingShift(emp.id, adDateStr, dayKey) !== null)
    );
  }, [viewEmployees, viewDates, getExistingShift]);

  const shiftNameToIds = useCallback((shiftName) => {
    if (!shiftName) return [];
    if (shiftName === 'OFF') return ['OFF'];
    const s = shifts.find(sh => sh.name === shiftName);
    return s ? [s.id] : [];
  }, [shifts]);

  const getViewEffective = useCallback((empId, dateStr, dayKey) => {
    const k = `${empId}_${dateStr}`;
    if (k in viewEditOverrides) return viewEditOverrides[k];
    if (dateStr in viewColShifts) return viewColShifts[dateStr];
    return shiftNameToIds(getExistingShift(empId, dateStr, dayKey));
  }, [viewEditOverrides, viewColShifts, shiftNameToIds, getExistingShift]);

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

  const setViewCellShift = (empId, dateStr, val) => {
    const isFirst = viewDates.length > 0 && dateStr === viewDates[0].adDateStr;
    if (isFirst) {
      setViewEditOverrides(p => {
        const next = { ...p };
        viewDates.forEach(({ adDateStr }) => { next[`${empId}_${adDateStr}`] = val; });
        return next;
      });
    } else {
      setViewEditOverrides(p => ({ ...p, [`${empId}_${dateStr}`]: val }));
    }
  };

  const handleViewSave = async () => {
    if (viewDates.length === 0) return;
    setSaving(true);
    setError('');
    try {
      const dateFrom = viewDates[0].adDateStr;
      const dateTo   = viewDates[viewDates.length - 1].adDateStr;
      const entries  = [];
      for (const emp of viewEmployeesFiltered) {
        const shiftCounts = {};
        const offDaySet   = new Set();
        for (const { adDateStr, dayKey } of viewDates) {
          const eff = getViewEffective(emp.id, adDateStr, dayKey);
          if (eff.includes('OFF')) offDaySet.add(dayKey);
          else eff.forEach(id => { shiftCounts[id] = (shiftCounts[id] || 0) + 1; });
        }
        const primaryShiftId = Object.keys(shiftCounts).sort((a, b) => shiftCounts[b] - shiftCounts[a])[0];
        if (!primaryShiftId) continue;
        entries.push({ employeeId: emp.id, shiftId: parseInt(primaryShiftId), dateFrom, dateTo, offDays: [...offDaySet] });
      }
      if (entries.length === 0) return setError('No shifts to save.');
      await Promise.all(entries.map(e => api.post('/duty-roster', e)));
      const freshRosters = await api.get('/duty-roster');
      setRosters(freshRosters || []);
      setViewEditMode(false);
      setViewColShifts({});
      setViewEditOverrides({});
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
      const dateFrom = periodDates[0].adDateStr;
      const dateTo   = periodDates[periodDates.length - 1].adDateStr;

      // Build ONE entry per employee — same format as individual +Create Roster
      const skippedNames = [];
      const entries = filteredEmployees.map(emp => {
        const shiftCounts = {};
        const offDaySet   = new Set();
        for (const { adDateStr, dayKey } of periodDates) {
          const eff = getEffective(emp.id, adDateStr);  // string[]
          if (eff.includes('OFF')) offDaySet.add(dayKey);
          else eff.forEach(sid => { shiftCounts[sid] = (shiftCounts[sid] || 0) + 1; });
        }
        // Primary shift = most frequently assigned non-OFF shift
        const primaryShiftId = Object.keys(shiftCounts)
          .sort((a, b) => shiftCounts[b] - shiftCounts[a])[0];
        if (!primaryShiftId) {
          skippedNames.push(emp.full_name || emp.fullName || `ID:${emp.id}`);
          return null; // no shift assigned — skip silently
        }
        return {
          employeeId: emp.id,
          shiftId:    parseInt(primaryShiftId),
          dateFrom,
          dateTo,
          offDays:    [...offDaySet],
        };
      }).filter(Boolean);

      if (entries.length === 0) {
        const names = skippedNames.join(', ');
        return setError(`No shifts assigned for any staff. Please assign a shift in the grid before saving.\nStaff without shift: ${names}`);
      }

      // Save all entries (same API as individual +Create Roster)
      await Promise.all(entries.map(e => api.post('/duty-roster', e)));

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
      const nowBS = adToBS(new Date()) || todayBS;
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
            style={{ height:36, padding:'0 14px', fontSize:13, fontWeight:600,
              background:'white', border:'1px solid #d1d5db', color:'#374151', borderRadius:8, cursor:'pointer' }}>
            Back
          </button>
          {/* Advanced Search toggle */}
          <button onClick={() => setShowAdvSearch(p => !p)}
            style={{ height:36, padding:'0 13px', fontSize:13, fontWeight:600, display:'flex', alignItems:'center', gap:5,
              background: showAdvSearch ? '#eff6ff' : '#f8fafc',
              border: `1px solid ${showAdvSearch ? '#1a56db' : '#d1d5db'}`,
              color: showAdvSearch ? '#1a56db' : '#374151', borderRadius:8, cursor:'pointer' }}>
            <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
              <path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L12 11.414V15a1 1 0 01-.553.894l-4 2A1 1 0 016 17v-5.586L3.293 6.707A1 1 0 013 6V3z" clipRule="evenodd"/>
            </svg>
            Advanced Search
          </button>
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
          </div>

          {/* Row 2: Department + Staff + Working Only + Search + Clear */}
          <div style={{ display:'flex', gap:10, alignItems:'flex-end', flexWrap:'wrap' }}>

            {/* Department */}
            <div style={{ flex:'0 0 220px' }}>
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
              <label style={{ display:'inline-flex', alignItems:'center', gap:7, cursor:'not-allowed',
                padding:'8px 12px', background:'#eff6ff', border:'1.5px solid #1a56db', borderRadius:7,
                fontSize:13, fontWeight:700, color:'#1e40af', userSelect:'none', height:36, boxSizing:'border-box' }}>
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
                setShowAdvSearch(false);
              }}
              style={{ height:38, padding:'0 26px', fontSize:13, fontWeight:700,
                background:'#1a56db', color:'white', border:'none', borderRadius:7, cursor:'pointer',
                boxShadow:'0 2px 8px rgba(26,86,219,.3)', whiteSpace:'nowrap', flexShrink:0 }}>
              Search
            </button>

            {/* Clear */}
            {(advSearch.staffIds.length > 0 || advSearch.departments.length > 0) && (
              <button onClick={() => { setAS('staffIds', []); setAS('departments', []); setGridSearched(false); }}
                style={{ height:38, padding:'0 14px', fontSize:12, background:'white', border:'1px solid #d1d5db',
                  color:'#6b7280', borderRadius:7, cursor:'pointer', flexShrink:0 }}>
                Clear
              </button>
            )}

            {/* Create Roster → opens popup modal directly */}
            <button
              onClick={() => {
                setColShifts({}); setCellOverrides({});
                setGridVisible(false);
                setShowCreateModal(true);
                setShowConfig(true);
              }}
              style={{ height:38, padding:'0 16px', fontSize:13, fontWeight:700,
                background:'#059669', color:'white', border:'none', borderRadius:7,
                cursor:'pointer', flexShrink:0,
                boxShadow:'0 2px 8px rgba(5,150,105,.3)' }}>
              + Create Roster
            </button>
            {/* View Roster */}
            <button
              onClick={() => setPageMode('view')}
              style={{ height:38, padding:'0 16px', fontSize:13, fontWeight:700,
                background: pageMode === 'view' ? '#1a56db' : 'white',
                color:      pageMode === 'view' ? 'white'   : '#374151',
                border:'1.5px solid #d1d5db', borderRadius:7, cursor:'pointer', flexShrink:0 }}>
              View Roster
            </button>
          </div>
        </div>
      )}

      {/* View Roster controls */}
      {pageMode === 'view' && (
        <div style={{ background:'#f8fafc', border:'1px solid #e5e7eb', borderRadius:10, padding:'14px 18px', marginBottom:14 }}>
          <div style={{ display:'flex', flexWrap:'wrap', gap:14, alignItems:'flex-end' }}>
            {/* Monthly / Weekly toggle */}
            <div>
              <div style={{ fontSize:11, fontWeight:700, color:'#374151', marginBottom:6 }}>View Type</div>
              <div style={{ display:'flex', gap:0, border:'1.5px solid #d1d5db', borderRadius:8, overflow:'hidden' }}>
                {[['monthly','Monthly'],['weekly','Weekly']].map(([k,lbl]) => (
                  <button key={k} onClick={() => { setViewType(k); setViewPeriodNum(1); }}
                    style={{ padding:'6px 16px', border:'none', cursor:'pointer', fontSize:13, fontWeight:700,
                      background: viewType === k ? '#1a56db' : 'white',
                      color:      viewType === k ? 'white'   : '#6b7280',
                      borderRight: k === 'monthly' ? '1px solid #d1d5db' : 'none' }}>
                    {lbl}
                  </button>
                ))}
              </div>
            </div>
            {/* BS Year — disabled, auto-derived from Fiscal Year in Advanced Search */}
            <div>
              <div style={{ fontSize:11, fontWeight:700, color:'#374151', marginBottom:4 }}>
                BS Year
                <span style={{ marginLeft:5, fontSize:10, color:'#9ca3af', fontWeight:400 }}>(from FY)</span>
              </div>
              <div style={{ height:36, border:'1.5px solid #e5e7eb', borderRadius:7, padding:'0 12px',
                fontSize:13, fontWeight:700, color:'#374151', background:'#f9fafb',
                display:'flex', alignItems:'center', cursor:'not-allowed', userSelect:'none',
                minWidth:80 }}>
                {advBsYear}
              </div>
            </div>
            {/* Month — from Advanced Search, read-only */}
            <div>
              <div style={{ fontSize:11, fontWeight:700, color:'#374151', marginBottom:4 }}>
                Month
                <span style={{ marginLeft:5, fontSize:10, color:'#9ca3af', fontWeight:400 }}>(from Adv. Search)</span>
              </div>
              <div style={{ height:36, border:'1.5px solid #93c5fd', borderRadius:7, padding:'0 14px',
                fontSize:13, fontWeight:700, color:'#1e40af', background:'#eff6ff',
                display:'flex', alignItems:'center', userSelect:'none' }}>
                {BS_MONTHS_EN[viewBsMonth - 1]}
              </div>
            </div>
            {/* Period selector */}
            <div>
              <div style={{ fontSize:11, fontWeight:700, color:'#374151', marginBottom:4 }}>
                {viewType === 'monthly' ? 'Half' : 'Week'}
              </div>
              <div style={{ display:'flex', gap:6 }}>
                {viewType === 'monthly' ? (
                  [1,2].map(h => (
                    <button key={h} onClick={() => setViewPeriodNum(h)}
                      style={{ padding:'6px 14px', border:`2px solid ${viewPeriodNum === h ? '#1a56db' : '#e5e7eb'}`,
                        borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:700,
                        background: viewPeriodNum === h ? '#eff6ff' : 'white',
                        color:      viewPeriodNum === h ? '#1e40af' : '#374151' }}>
                      {h === 1 ? '1st Half' : '2nd Half'}
                    </button>
                  ))
                ) : (
                  [1,2,3,4].map(w => (
                    <button key={w} onClick={() => setViewPeriodNum(w)}
                      style={{ padding:'6px 12px', border:`2px solid ${viewPeriodNum === w ? '#1a56db' : '#e5e7eb'}`,
                        borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:700,
                        background: viewPeriodNum === w ? '#eff6ff' : 'white',
                        color:      viewPeriodNum === w ? '#1e40af' : '#374151' }}>
                      {['1st','2nd','3rd','4th'][w-1]} Wk
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
          {viewDates.length > 0 && (
            <div style={{ marginTop:8, display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:8 }}>
              <div style={{ fontSize:12, color:'#6b7280' }}>
                Showing: {viewDates[0].adDateStr} to {viewDates[viewDates.length-1].adDateStr}
                &nbsp;·&nbsp; {viewDates.length} days &nbsp;·&nbsp; {viewEmployeesFiltered.length} staff
              </div>
              <div style={{ display:'flex', gap:8 }}>
                {!viewEditMode ? (
                  canEditRoster && <button
                    onClick={() => { setViewEditMode(true); setViewColShifts({}); setViewEditOverrides({}); }}
                    style={{ height:32, padding:'0 14px', fontSize:12, fontWeight:700,
                      background:'#f59e0b', color:'white', border:'none', borderRadius:7, cursor:'pointer',
                      boxShadow:'0 2px 6px rgba(245,158,11,.3)' }}>
                    ✏️ Edit Shifts
                  </button>
                ) : (
                  <>
                    <button onClick={() => { setViewEditMode(false); setViewColShifts({}); setViewEditOverrides({}); }}
                      style={{ height:32, padding:'0 12px', fontSize:12, fontWeight:600,
                        background:'white', border:'1px solid #d1d5db', color:'#374151', borderRadius:7, cursor:'pointer' }}>
                      Cancel
                    </button>
                    <button onClick={handleViewSave} disabled={saving}
                      style={{ height:32, padding:'0 14px', fontSize:12, fontWeight:700,
                        background: saving ? '#9ca3af' : '#059669', color:'white', border:'none',
                        borderRadius:7, cursor: saving ? 'not-allowed' : 'pointer' }}>
                      {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
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
        <div style={{ overflowX:'auto', border:'1px solid #e5e7eb', borderRadius:10 }}>
          <table style={{ borderCollapse:'collapse', fontSize:13, tableLayout:'fixed' }}>
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
              {viewEmployeesFiltered.length === 0 ? (
                <tr>
                  <td colSpan={5 + viewDates.length}
                    style={{ textAlign:'center', padding:'40px', color:'#9ca3af', fontSize:13 }}>
                    No staff found. Try adjusting the search filters.
                  </td>
                </tr>
              ) : viewEmployeesFiltered.map((emp, idx) => (
                <tr key={emp.id} style={{ background: idx % 2 === 0 ? 'white' : '#fafafa' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f0f7ff'}
                  onMouseLeave={e => e.currentTarget.style.background = idx % 2 === 0 ? 'white' : '#fafafa'}>
                  <td style={{ ...tdSt(true, 0), background:'#efefef', color:'#374151', fontWeight:700, textAlign:'center' }}>{idx + 1}</td>
                  <td style={{ ...tdSt(true, 1), fontWeight:600 }}>{emp.full_name || emp.fullName}</td>
                  <td style={{ ...tdSt(true, 2) }} title={emp.position}>{getShortName(emp.position, settings.posts)}</td>
                  <td style={{ ...tdSt(true, 3) }} title={emp.department}>{getShortName(emp.department, settings.departments)}</td>
                  <td style={{ ...tdSt(true, 4), boxShadow:'3px 0 6px rgba(0,0,0,.08)' }} title={emp.branch}>{getShortName(emp.branch, settings.branches)}</td>
                  {viewDates.map(({ adDateStr, dayKey }) => {
                    if (viewEditMode) {
                      const eff = getViewEffective(emp.id, adDateStr, dayKey);
                      const isOverridden = `${emp.id}_${adDateStr}` in viewEditOverrides;
                      return (
                        <td key={adDateStr} style={{ ...tdSt(false,-1), textAlign:'left', padding:'3px 4px',
                          background: eff.includes('OFF') ? '#fff5f5' : eff.length > 0 ? '#f0f9ff' : 'inherit' }}>
                          <div style={{ position:'relative', display:'inline-block' }}>
                            <ShiftCell value={eff} onChange={v => setViewCellShift(emp.id, adDateStr, v)} shifts={shifts} isColHeader={false} />
                            {isOverridden && (
                              <span title="Override" style={{ position:'absolute', top:-2, right:-2, width:6, height:6, background:'#f59e0b', borderRadius:'50%' }} />
                            )}
                          </div>
                        </td>
                      );
                    }
                    const shift = getExistingShift(emp.id, adDateStr, dayKey);
                    const isOff = shift === 'OFF';
                    return (
                      <td key={adDateStr}
                        style={{ ...tdSt(false,-1), textAlign:'center', padding:'4px 6px',
                          background: isOff ? '#fff5f5' : shift ? '#f0fdf4' : 'inherit' }}>
                        {isOff ? (
                          <span style={{ fontSize:13, fontWeight:700, color:'#dc2626' }}>OFF</span>
                        ) : shift ? (
                          <span style={{ fontSize:13, color:'#111827' }}>{shift}</span>
                        ) : (
                          <span style={{ color:'#d1d5db', fontSize:13 }}>—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
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
            <div style={{ background:'#059669', padding:'14px 20px', display:'flex',
              alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
              <div>
                <span style={{ fontWeight:800, fontSize:15, color:'white' }}>
                  Create Roster — {periodLabel}
                </span>
                <span style={{ marginLeft:10, color:'rgba(255,255,255,.8)', fontSize:12 }}>
                  {filteredEmployees.length} staff
                </span>
              </div>
              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                {canEditRoster && (
                  <button onClick={handleSave} disabled={saving}
                    style={{ height:34, padding:'0 18px', fontSize:13, fontWeight:700,
                      background: saving ? 'rgba(255,255,255,.4)' : 'white', color: saving ? 'white' : '#059669',
                      border:'none', borderRadius:7, cursor: saving ? 'not-allowed' : 'pointer' }}>
                    {saving ? 'Saving...' : 'Save Roster'}
                  </button>
                )}
                <button onClick={() => { setShowCreateModal(false); setGridVisible(false); }}
                  style={{ background:'rgba(255,255,255,.2)', border:'none', borderRadius:6,
                    width:30, height:30, cursor:'pointer', color:'white', fontSize:18 }}>x</button>
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
          <table style={{ borderCollapse:'collapse', fontSize:13, tableLayout:'fixed' }}>
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
                <tr key={emp.id} style={{ background: hasAnyShift ? (idx % 2 === 0 ? 'white' : '#fafafa') : '#fff7ed' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f0f7ff'}
                  onMouseLeave={e => e.currentTarget.style.background = hasAnyShift ? (idx % 2 === 0 ? 'white' : '#fafafa') : '#fff7ed'}>
                  <td style={{ ...tdSt(true, 0), background: hasAnyShift ? '#efefef' : '#fed7aa',
                    color:'#374151', fontWeight:700, textAlign:'center' }}>
                    {idx + 1}
                    {!hasAnyShift && <div style={{ fontSize:9, color:'#c2410c' }}>!</div>}
                  </td>
                  <td style={{ ...tdSt(true, 1), fontWeight:600 }}
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
                  {periodDates.map(({ adDateStr }, di) => {
                    const eff = getEffective(emp.id, adDateStr);  // string[]
                    const isOff        = eff.includes('OFF');
                    const isOverridden = `${emp.id}_${adDateStr}` in cellOverrides;
                    const bgColor      = isOff ? '#fff5f5' : eff.length > 0 ? '#f0f9ff' : 'inherit';
                    return (
                      <td key={adDateStr} style={{ ...tdSt(false,-1), textAlign:'left', padding:'3px 4px', background: bgColor }}>
                        <div style={{ position:'relative', display:'inline-block' }}>
                          <ShiftCell value={eff} onChange={v => setCellShift(emp.id, adDateStr, v)} shifts={shifts} isColHeader={false} />
                          {isOverridden && (
                            <span title="Override" style={{ position:'absolute', top:-2, right:-2, width:6, height:6, background:'#f59e0b', borderRadius:'50%' }} />
                          )}
                          {di === 0 && <div style={{ fontSize:9, color:'#059669', textAlign:'center', marginTop:1 }}>fills row</div>}
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
                      <tr key={i} style={{ background: i % 2 === 0 ? 'white' : '#fafafa' }}>
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

            <div style={{ background:'#059669', padding:'16px 22px',
              display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
              <span style={{ fontWeight:800, fontSize:16, color:'white' }}>Create Roster — Department Wise</span>
              <button onClick={() => setShowConfig(false)}
                style={{ background:'rgba(255,255,255,.2)', border:'none', borderRadius:6,
                  width:30, height:30, cursor:'pointer', color:'white', fontSize:18, lineHeight:1 }}>x</button>
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

    </div>
  );
};

export default DutyRosterDeptWise;
