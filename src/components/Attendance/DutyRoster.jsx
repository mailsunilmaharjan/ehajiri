import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client.js';
import { useAuth }     from '../../context/AuthContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import { useData }     from '../../context/DataContext.jsx';
import DataGrid        from '../DataGrid/DataGrid.jsx';
import Avatar          from '../Common/Avatar.jsx';
import NepaliDatePicker, { adToISO } from '../Common/NepaliDatePicker.jsx';
import EnglishDatePicker from '../Common/EnglishDatePicker.jsx';
import StaffDropdown   from '../Common/StaffDropdown.jsx';
import useDateFormat   from '../../hooks/useDateFormat.js';
import { adToBS, bsToAD, getBSDays, getNepalNow, getNepalTodayISO, BS_MONTHS_EN, toNepaliDigits } from '../../utils/dateUtils.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// The date-range Create/Edit Roster forms submit a rotation (shiftIds) plus
// separate day-of-week overrides (offDays/dayOffDays/nightOffDays) — there's
// no single date for the 'OFF' sentinel to attach to the way there is in
// Calendar View's per-day bulk-days call. Picking Weekend there (exclusive,
// via MultiShiftDropdown) is treated as "every day in this range is
// Weekend": strip the sentinel out of the rotation and union all 7 weekdays
// into offDays instead of leaving 'OFF' to hit shift_id as an invalid value.
const resolveWeekendPick = (shiftIds, offDays) => {
  if (!shiftIds.includes('OFF')) return { shiftIds, offDays };
  return { shiftIds: shiftIds.filter(id => id !== 'OFF'), offDays: [...new Set([...offDays, ...DAYS])] };
};

// Local-time YYYY-MM-DD (never UTC — avoids day-shift near midnight).
const toISODate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Among roster entries that all directly cover the same date, the most
// specific (narrowest span) one wins — mirrors the backend's
// pickMostSpecificEntry in server/routes/attendance.js, so what this
// calendar previews matches what reports will actually show.
const pickMostSpecificRoster = (candidates) => {
  if (candidates.length <= 1) return candidates[0] || null;
  const span = (r) => (new Date(r.dateTo) - new Date(r.dateFrom));
  return candidates.slice().sort((a, b) => span(a) - span(b) || (b.id || 0) - (a.id || 0))[0];
};

/* ── Date input: Nepali calendar or AD based on company setting ── */
const DateInput = ({ value, onChange }) => {
  const { settings } = useSettings();
  if (settings.defaultCalendar === 'np') {
    return <NepaliDatePicker value={value} onChange={onChange} />;
  }
  return <EnglishDatePicker value={value} onChange={onChange} />;
};

/* ── Enter key → Tab navigation inside modals ── */
const enterAsTab = (e) => {
  if (e.key !== 'Enter') return;
  if (['BUTTON', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
  if (e.target.type === 'checkbox') return;
  const container = e.currentTarget;
  const els = Array.from(container.querySelectorAll(
    'input:not([disabled]):not([type="hidden"]):not([type="checkbox"]), select:not([disabled]), [tabindex="0"]:not([disabled])'
  )).filter(el => {
    if (!el.offsetParent) return false;
    const pos = window.getComputedStyle(el.closest('[style]') || el).position;
    return true;
  });
  const idx = els.indexOf(document.activeElement);
  if (idx >= 0 && idx < els.length - 1) {
    e.preventDefault();
    els[idx + 1].focus();
  }
};

/* ── Sub-menu ─────────────────────────────────────────────────── */
const SUB_MENU = [
  { key: 'dashboard',  icon: '📊', label: 'Roster Dashboard' },
  { key: 'staff',      icon: '👤', label: 'Create Roster Staff Wise' },
  { key: 'department', icon: '🏢', label: 'Create Roster Department Wise' },
  { key: 'view',       icon: '📋', label: 'View Duty Roster Report' },
];

/* ── Roster Menu dropdown button ─────────────────────────────── */
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
          {SUB_MENU.map((item, i) => {
            const isActive = active === item.key;
            return (
              <button key={item.key} onClick={() => { onSelect(item.key); setOpen(false); }}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9,
                  padding: '8px 14px', border: 'none',
                  borderBottom: i < SUB_MENU.length - 1 ? '1px solid #f0f0f0' : 'none',
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

/* ── "+ Create Roster" dropdown — Date Range vs Calendar View ─── */
const CREATE_ROSTER_MENU = [
  { key: 'range',    icon: '📅', label: 'Date Range Staff Wise' },
  { key: 'calendar', icon: '🗓️', label: 'Calendar View Staff Wise' },
];

const CreateRosterMenuBtn = ({ onSelect }) => {
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
        style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 36,
          padding: '0 16px', background: open ? '#047857' : '#059669', color: 'white', border: 'none',
          borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
          boxShadow: '0 2px 8px rgba(5,150,105,.25)', transition: 'background .15s' }}>
        + Create Roster
        <svg viewBox="0 0 20 20" fill="white" width="12" height="12"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
        </svg>
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 500,
          background: 'white', border: '1px solid #e5e7eb', borderRadius: 10,
          boxShadow: '0 8px 28px rgba(0,0,0,.13)', overflow: 'hidden', minWidth: 240 }}>
          <div style={{ padding: '8px 14px', background: '#f9fafb', borderBottom: '1px solid #f3f4f6',
            fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.5px' }}>
            Create Roster
          </div>
          {CREATE_ROSTER_MENU.map((item, i) => (
            <button key={item.key} onClick={() => { onSelect(item.key); setOpen(false); }}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9,
                padding: '8px 14px', border: 'none',
                borderBottom: i < CREATE_ROSTER_MENU.length - 1 ? '1px solid #f0f0f0' : 'none',
                textAlign: 'left', cursor: 'pointer', fontSize: 13, background: 'white', color: '#374151', fontWeight: 500 }}
              onMouseEnter={e => e.currentTarget.style.background = '#f9fafb'}
              onMouseLeave={e => e.currentTarget.style.background = 'white'}>
              <span style={{ fontSize: 17, flexShrink: 0 }}>{item.icon}</span>
              <span style={{ flex: 1 }}>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/* ── Searchable Shift Dropdown ───────────────────────────────── */
// Multi-select shift picker — value is an array of shift ids in the order
// checked, which IS the rotation order (day 0 of the roster gets value[0],
// day 1 gets value[1], ... cycling). Checking one more shift just appends;
// unchecking removes it and closes the gap in the rotation automatically.
const MultiShiftDropdown = ({ shifts, value, onChange }) => {
  const [open,   setOpen]   = useState(false);
  const [search, setSearch] = useState('');
  const [defMsg, setDefMsg] = useState(false);
  const [rect,   setRect]   = useState(null); // raw trigger rect — { top, bottom, left, width }
  const [panelH, setPanelH] = useState(0);
  const [activeIndex, setActiveIndex] = useState(-1);
  const ref     = useRef();  // trigger
  const dropRef = useRef();  // portalled panel

  const inpRef = useRef();
  const itemRefs = useRef([]);

  // Panel is portalled to document.body (position:fixed) so it isn't
  // clipped by an ancestor's overflow:hidden — e.g. this dropdown sits
  // inside a modal with overflow:hidden for its rounded corners, which
  // silently truncated the absolutely-positioned panel and made shifts
  // near/after the fold unclickable.
  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (ref.current?.contains(e.target) || dropRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const scroll = (e) => {
      if (dropRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', scroll, true);
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('scroll', scroll, true); };
  }, [open]);

  useEffect(() => { if (open && inpRef.current) setTimeout(() => inpRef.current?.focus(), 20); }, [open]);

  // Weekend is a pure code-level pick (like DutyRosterDeptWise's ShiftCell) —
  // no shift row backs it, just the 'OFF' sentinel already understood by
  // POST /duty-roster/bulk-days. Modeled as a synthetic pseudo-shift so it
  // rides along every existing shifts-array code path below (sorting,
  // keyboard nav, exclusive-select) instead of needing its own parallel
  // handling everywhere.
  const WEEKEND_ITEM = { id: 'OFF', name: 'Weekend', isOff: true, isWeekend: true };
  const findShift = (id) => id === 'OFF' ? WEEKEND_ITEM : shifts.find(s => s.id === id);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const all = [WEEKEND_ITEM, ...shifts];
    const matches = all.filter(s => !q || s.name?.toLowerCase().includes(q) || s.code?.toLowerCase().includes(q));
    // Weekend / Day Off / Night Off pulled to the top, same treatment as the
    // per-day picker (Department Wise) — easier to spot than buried
    // alphabetically in the middle of the list with just a small "Off" badge.
    // The default shift applies automatically to anyone with no specific
    // roster entry — it's still shown (disabled — see the isDefault branch
    // below) so it's clear which shift that is, but pushed to the very end
    // since it's not a real pick from this list.
    const isDefault = s => s.makeDefault || s.make_default;
    return [
      ...matches.filter(s => s.isOff),
      ...matches.filter(s => !s.isOff && !isDefault(s)),
      ...matches.filter(s => !s.isOff && isDefault(s)),
    ];
  }, [shifts, search]);
  const firstNonOffIdx = filtered.findIndex(s => !s.isOff);
  itemRefs.current = [];

  const selectedShifts = value.map(findShift).filter(Boolean);

  // Weekend / Day Off / Night Off are exclusive, whole-day picks — same
  // spirit as ShiftCell's pickWeekend/pickOffShift — while regular shifts
  // stay multi-selectable among each other (rotation order = order checked).
  const toggle = (id) => {
    const item = findShift(id);
    if (item?.isOff) { onChange(value.includes(id) ? [] : [id]); return; }
    const base = value.some(v => findShift(v)?.isOff) ? [] : value;
    onChange(base.includes(id) ? base.filter(v => v !== id) : [...base, id]);
  };

  const shiftLabel = (s) => (s.isOff ? s.name : `${s.name} (${s.startTime} – ${s.endTime})`);

  // "Default" shift rows are inert placeholders, not selectable — arrow-key
  // navigation must skip over them.
  const isNavigable = (s) => !(s.makeDefault || s.make_default);
  const stepIndex = (from, dir) => {
    if (!filtered.length) return -1;
    let i = from;
    for (let n = 0; n < filtered.length; n++) {
      i = (i + dir + filtered.length) % filtered.length;
      if (isNavigable(filtered[i])) return i;
    }
    return -1;
  };

  const toggleOpen = () => {
    if (!ref.current) return;
    if (open) { setOpen(false); return; }
    const r = ref.current.getBoundingClientRect();
    setRect({ top: r.top, bottom: r.bottom, left: r.left, width: r.width });
    setActiveIndex(stepIndex(-1, 1));
    setOpen(true);
  };

  // Measure the panel's real height so we can decide whether it fits below
  // the trigger — flips upward when it doesn't fit below but does fit
  // above (same technique as NepaliDatePicker / ShiftCell).
  useLayoutEffect(() => {
    if (open && dropRef.current) {
      const h = dropRef.current.offsetHeight;
      if (h && h !== panelH) setPanelH(h);
    }
  }, [open, rect]);

  const openUpward = !!(rect && panelH &&
    (rect.bottom + 4 + panelH > window.innerHeight - 8) &&
    (rect.top - panelH - 4 >= 8));
  const panelTop = rect ? (openUpward ? rect.top - panelH - 4 : rect.bottom + 4) : 0;
  const handleTriggerKeyDown = e => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation();
      toggleOpen();
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };
  const handleSearchKeyDown = e => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => stepIndex(i, 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => stepIndex(i, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && filtered[activeIndex]) toggle(filtered[activeIndex].id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };
  useEffect(() => {
    if (open && activeIndex >= 0) itemRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);
  useEffect(() => { if (open) setActiveIndex(stepIndex(-1, 1)); }, [search]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div
        tabIndex={0}
        onClick={toggleOpen}
        onKeyDown={handleTriggerKeyDown}
        style={{ minHeight: 36, border: `1.5px solid ${open ? '#1a56db' : '#d1d5db'}`, borderRadius: 7,
          padding: '4px 10px', display: 'flex', alignItems: 'center', cursor: 'pointer',
          background: 'white', fontSize: 13, color: selectedShifts.length ? '#1f2937' : '#9ca3af',
          userSelect: 'none', outline: 'none', flexWrap: 'wrap', gap: 4,
          boxShadow: open ? '0 0 0 2px #bfdbfe' : 'none' }}>
        {selectedShifts.length === 0 && <span style={{ flex: 1 }}>Search and select shift(s)…</span>}
        {selectedShifts.length === 1 && <span style={{ flex: 1 }}>{shiftLabel(selectedShifts[0])}</span>}
        {selectedShifts.length > 1 && (
          <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {selectedShifts.map((s, i) => (
              <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4,
                background: '#eff6ff', color: '#1e40af', border: '1px solid #bfdbfe',
                borderRadius: 5, padding: '2px 7px', fontSize: 11.5, fontWeight: 600 }}>
                <span style={{ background: '#1e40af', color: 'white', borderRadius: '50%',
                  width: 14, height: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 9, fontWeight: 700 }}>{i + 1}</span>
                {s.name}
              </span>
            ))}
          </div>
        )}
        <svg viewBox="0 0 20 20" fill="#9ca3af" width="14" height="14"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s', flexShrink: 0 }}>
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
        </svg>
      </div>
      {open && rect && createPortal(
        <div ref={dropRef} style={{ position: 'fixed', top: panelTop, left: rect.left, width: rect.width, zIndex: 999999,
          background: 'white', border: '1px solid #e5e7eb', borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,.12)', overflow: 'hidden' }}>
          <div style={{ padding: '8px' }}>
            <input ref={inpRef} value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search shift…"
              onKeyDown={handleSearchKeyDown}
              style={{ width: '100%', height: 32, border: '1px solid #d1d5db', borderRadius: 6,
                padding: '0 10px', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
          </div>
          {selectedShifts.length > 1 && (
            <div style={{ padding: '4px 12px 8px', fontSize: 11, color: '#6b7280' }}>
              Rotates day-by-day in the order checked (1 → {selectedShifts.length} → repeats).
            </div>
          )}
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {filtered.map((s, idx) => {
              const isDefault = s.makeDefault || s.make_default;
              if (isDefault) return (
                <div key={s.id} ref={el => itemRefs.current[idx] = el}
                  onClick={() => { setDefMsg(true); setTimeout(() => setDefMsg(false), 3500); }}
                  style={{ padding: '8px 12px', cursor: 'not-allowed', fontSize: 12,
                    background: '#f9fafb', color: '#9ca3af',
                    borderTop: '2px solid #e5e7eb',
                    display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 600, color: '#9ca3af' }}>{s.name}</span>
                  <span style={{ color: '#9ca3af' }}>{s.startTime} – {s.endTime} · {s.workHours}h</span>
                  <span style={{ marginLeft: 'auto', background: '#f3f4f6', color: '#6b7280',
                    border: '1px solid #e5e7eb', borderRadius: 4, padding: '1px 7px',
                    fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px', flexShrink: 0 }}>
                    Default
                  </span>
                </div>
              );
              const checked = value.includes(s.id);
              const order   = checked ? value.indexOf(s.id) + 1 : null;
              const highlighted = idx === activeIndex;
              // Divider between the Day Off/Night Off group and the regular
              // shift list below it, only when both are actually present.
              const isFirstNonOff = idx === firstNonOffIdx && firstNonOffIdx > 0;
              return (
                <label key={s.id} ref={el => itemRefs.current[idx] = el}
                  onClick={e => e.stopPropagation()}
                  onMouseEnter={() => setActiveIndex(idx)}
                  style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 12,
                    background: checked ? '#eff6ff' : (highlighted ? '#f9fafb' : 'white'),
                    color: checked ? '#1e40af' : '#374151',
                    borderTop: isFirstNonOff ? '2px solid #e5e7eb' : '1px solid #f3f4f6',
                    display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={checked} onChange={() => toggle(s.id)}
                    style={{ width: 14, height: 14, cursor: 'pointer', accentColor: '#1a56db', flexShrink: 0 }} />
                  {order && <span style={{ background: '#1e40af', color: 'white', borderRadius: '50%',
                    width: 15, height: 15, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 9.5, fontWeight: 700, flexShrink: 0 }}>{order}</span>}
                  {s.isOff && <span style={{ fontSize: 13 }}>{s.isWeekend ? '🏖️' : /night/i.test(s.name) ? '🌙' : '☀️'}</span>}
                  <span style={{ fontWeight: 600 }}>{s.name}</span>
                  {s.isOff ? (
                    <span style={{ background: '#f3f4f6', color: '#6b7280', border: '1px solid #e5e7eb',
                      borderRadius: 4, padding: '1px 6px', fontSize: 9.5, fontWeight: 700,
                      textTransform: 'uppercase', letterSpacing: '.3px' }}>Off</span>
                  ) : (
                    <span style={{ color: '#6b7280' }}>{s.startTime} – {s.endTime} · {s.workHours}h</span>
                  )}
                </label>
              );
            })}
          </div>
          {/* Default shift warning message */}
          {defMsg && (
            <div style={{ padding: '8px 12px', background: '#fff7ed', borderTop: '1px solid #fed7aa',
              fontSize: 12, color: '#c2410c', display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14" style={{ flexShrink: 0 }}>
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
              </svg>
              The Default shift is applied automatically. Please select a specific shift to assign from the Roster.
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
};

/* ── Shared label ── */
const Label = ({ children }) => (
  <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 5 }}>{children}</div>
);

/* ── Weekend / Day Off / Night Off — three day-of-week checkbox rows,
   mutually exclusive per day (checking a day under one clears it from the
   other two). Whichever category a day-of-week is under is authoritative
   across the entire date range, overriding the shift rotation on that day —
   same as reports already treat Department Wise's per-day Day Off/Night Off
   assignments. ── */
const OFF_DAY_TYPES = [
  { key: 'weekend',  label: 'Weekend',   color: '#1a56db' },
  { key: 'dayOff',   label: 'Day Off',   color: '#d97706' },
  { key: 'nightOff', label: 'Night Off', color: '#7c3aed' },
];

const OffDayTypeRows = ({ offDays, dayOffDays, nightOffDays, onChange }) => {
  const sets = { weekend: offDays, dayOff: dayOffDays, nightOff: nightOffDays };
  const toggle = (type, day) => {
    const next = { weekend: [...offDays], dayOff: [...dayOffDays], nightOff: [...nightOffDays] };
    const isOn = next[type].includes(day);
    OFF_DAY_TYPES.forEach(({ key }) => { next[key] = next[key].filter(d => d !== day); });
    if (!isOn) next[type].push(day);
    onChange(next);
  };
  return (
    <div>
      <Label>Weekend / Day Off / Night Off</Label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {OFF_DAY_TYPES.map(({ key, label, color }) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ width: 76, flexShrink: 0, fontSize: 12, fontWeight: 700, color }}>{label}</span>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              {DAYS.map(day => (
                <label key={day} style={{ display: 'flex', alignItems: 'center', gap: 5,
                  cursor: 'pointer', fontSize: 13, color: '#374151', userSelect: 'none' }}>
                  <input type="checkbox" checked={sets[key].includes(day)} onChange={() => toggle(key, day)}
                    style={{ width: 15, height: 15, cursor: 'pointer', accentColor: color }} />
                  {day}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/* ── Disabled read-only field style ── */
const disStyle = {
  height: 34, border: '1px solid #e5e7eb', borderRadius: 7, padding: '0 10px',
  background: '#f9fafb', fontSize: 13, color: '#6b7280', display: 'flex',
  alignItems: 'center', userSelect: 'none',
};

/* ── Fiscal year helper ── */
const todayStr = () => getNepalTodayISO();

function getCurrentFY(fiscalYears = []) {
  const today = todayStr();
  return fiscalYears.find(fy => fy.startDate <= today && fy.endDate >= today)
      || fiscalYears.find(fy => fy.isDefault)
      || fiscalYears[fiscalYears.length - 1]
      || null;
}

// Returns { dateFrom, dateTo } as AD ISO strings for the first and last day of the current month.
// Uses BS month when useNepali=true, AD month otherwise.
function getDefaultDateRange(useNepali) {
  if (useNepali) {
    const bs = adToBS(getNepalTodayISO());
    if (bs) {
      const days  = getBSDays(bs.year, bs.month);
      const first = bsToAD(bs.year, bs.month, 1);
      const last  = bsToAD(bs.year, bs.month, days);
      if (first && last) return { dateFrom: adToISO(first), dateTo: adToISO(last) };
    }
  }
  const t = getNepalNow();
  const first = new Date(t.getFullYear(), t.getMonth(), 1);
  const last  = new Date(t.getFullYear(), t.getMonth() + 1, 0);
  const toISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return {
    dateFrom: toISO(first),
    dateTo:   toISO(last),
  };
}

/* ══════════════════════════════════════════════════════════════
   Create Roster Modal
══════════════════════════════════════════════════════════════ */
const CreateRosterModal = ({ employees, shifts, currentUser, onClose, onSaved }) => {
  const { settings } = useSettings();
  const useNepali    = settings.defaultCalendar === 'np';
  const defaultRange = getDefaultDateRange(useNepali);

  const [submitMode, setSubmitMode] = useState('create_new'); // 'create_new' | 'create_close'
  const [empId,    setEmpId]    = useState(null);
  const [shiftIds, setShiftIds] = useState([]); // order checked = rotation order
  const [dateFrom, setDateFrom] = useState(defaultRange.dateFrom);
  const [dateTo,   setDateTo]   = useState(defaultRange.dateTo);
  const [offDays,      setOffDays]      = useState(settings.defaultWeekends || []);
  const [dayOffDays,   setDayOffDays]   = useState([]);
  const [nightOffDays, setNightOffDays] = useState([]);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState('');

  const emp = employees.find(e => e.id === empId) || null;

  const handleOffDayTypesChange = (next) => {
    setOffDays(next.weekend);
    setDayOffDays(next.dayOff);
    setNightOffDays(next.nightOff);
  };

  const resetForm = useCallback(() => {
    setEmpId(null);
    setShiftIds([]);
    const range = getDefaultDateRange(settings.defaultCalendar === 'np');
    setDateFrom(range.dateFrom);
    setDateTo(range.dateTo);
    setOffDays(settings.defaultWeekends || []);
    setDayOffDays([]);
    setNightOffDays([]);
    setError('');
  }, [settings]);

  const handleSubmit = async () => {
    if (!empId)   return setError('Please select a staff member.');
    if (!shiftIds.length) return setError('Please select at least one shift.');
    if (!dateFrom || !dateTo) return setError('Please set date range.');
    if (dateTo < dateFrom)    return setError('Date To must be on or after Date From.');
    setError('');
    setSaving(true);
    try {
      const resolved = resolveWeekendPick(shiftIds, offDays);
      await api.post('/duty-roster', {
        employeeId: empId,
        shiftIds: resolved.shiftIds,
        dateFrom,
        dateTo,
        offDays: resolved.offDays,
        dayOffDays,
        nightOffDays,
        createdBy: currentUser?.fullName || currentUser?.username || 'Admin',
      });
      onSaved();
      if (submitMode === 'create_new') {
        resetForm();
      } else {
        onClose();
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'white', borderRadius: 14, width: '100%', maxWidth: 640,
        boxShadow: '0 20px 60px rgba(0,0,0,.25)', overflow: 'hidden', maxHeight: '92vh',
        display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div style={{ background: '#ffffff', padding: '16px 20px', borderBottom: '1px solid #e5e7eb',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <svg viewBox="0 0 20 20" fill="#1e40af" width="18" height="18">
              <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z"/>
              <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd"/>
            </svg>
            <span style={{ fontWeight: 700, fontSize: 15, color: '#1e40af' }}>Create Roster</span>
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        {/* Body */}
        <div
          style={{ padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}
          onKeyDown={enterAsTab}
        >
          {/* Staff Name — auto-opens on form open */}
          <div>
            <Label>Staff Name <span style={{ color: '#dc2626' }}>*</span></Label>
            <StaffDropdown employees={employees} value={empId} onChange={setEmpId} autoOpen={true} />
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 3 }}>
              Format: Name — Department — Attendance ID
            </div>
          </div>

          {/* Auto info (disabled) */}
          <div style={{ background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 8, padding: '8px 12px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#4f46e5', textTransform: 'uppercase',
              letterSpacing: '.5px', marginBottom: 6 }}>
              Staff Information (Auto-filled)
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {[
                ['Staff Name', emp?.fullName],
                ['Branch',     emp?.branch],
                ['Post',       emp?.position],
                ['Mobile',     emp?.phone],
              ].map(([label, val]) => (
                <div key={label}>
                  <div style={{ fontSize: 10, color: '#9ca3af', marginBottom: 2 }}>{label}</div>
                  <div style={{ ...disStyle, height: 26, fontSize: 12, padding: '0 8px', background: '#fff', border: '1px solid #e0e7ff' }}>{val || '—'}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Change Shift */}
          <div>
            <Label>Change Shift <span style={{ color: '#dc2626' }}>*</span></Label>
            <MultiShiftDropdown shifts={shifts} value={shiftIds} onChange={setShiftIds} />
          </div>

          {/* Date Range */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <Label>Date From <span style={{ color: '#dc2626' }}>*</span></Label>
              <DateInput value={dateFrom} onChange={setDateFrom} />
            </div>
            <div>
              <Label>Date To <span style={{ color: '#dc2626' }}>*</span></Label>
              <DateInput value={dateTo} onChange={setDateTo} />
            </div>
          </div>

          {/* Off Days */}
          <OffDayTypeRows offDays={offDays} dayOffDays={dayOffDays} nightOffDays={nightOffDays}
            onChange={handleOffDayTypesChange} />

          {/* Created By / Create Date */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <Label>Created By</Label>
              <div style={disStyle}>{currentUser?.fullName || currentUser?.username || '—'}</div>
            </div>
            <div>
              <Label>Create Date</Label>
              <div style={disStyle}>{todayStr()}</div>
            </div>
          </div>

          {error && (
            <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 8,
              padding: '10px 14px', color: '#991b1b', fontSize: 13, fontWeight: 600 }}>
              ⚠️ {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 20px', borderTop: '1px solid #f3f4f6',
          display: 'flex', alignItems: 'center', gap: 10, background: '#fafafa' }}>

          {/* Create & New / Close After toggle */}
          <div style={{ display: 'flex', borderRadius: 7, overflow: 'hidden',
            border: '1.5px solid #1a56db', flexShrink: 0 }}>
            <button
              onClick={() => setSubmitMode('create_new')}
              style={{ padding: '6px 13px', border: 'none', fontSize: 12, fontWeight: 700,
                cursor: 'pointer', transition: 'background .15s',
                background: submitMode === 'create_new' ? '#1a56db' : 'white',
                color: submitMode === 'create_new' ? 'white' : '#1a56db' }}>
              Create &amp; New
            </button>
            <button
              onClick={() => setSubmitMode('create_close')}
              style={{ padding: '6px 13px', border: 'none', borderLeft: '1.5px solid #1a56db',
                fontSize: 12, fontWeight: 700, cursor: 'pointer', transition: 'background .15s',
                background: submitMode === 'create_close' ? '#1a56db' : 'white',
                color: submitMode === 'create_close' ? 'white' : '#1a56db' }}>
              Close After
            </button>
          </div>

          <div style={{ flex: 1 }} />

          <button onClick={onClose}
            style={{ height: 36, padding: '0 18px', fontSize: 13, fontWeight: 600,
              background: 'white', border: '1px solid #d1d5db', color: '#374151',
              borderRadius: 8, cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={saving}
            style={{ height: 36, padding: '0 20px', fontSize: 13, fontWeight: 700,
              background: saving ? '#93c5fd' : '#1a56db', color: 'white',
              border: 'none', borderRadius: 8, cursor: saving ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 6 }}>
            {saving ? '⏳ Saving…'
              : submitMode === 'create_new' ? '✅ Create & New'
              : '✅ Create Roster'}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ══════════════════════════════════════════════════════════════
   Edit Roster Modal
══════════════════════════════════════════════════════════════ */
const EditRosterModal = ({ roster, shifts, onClose, onSaved }) => {
  const [shiftIds, setShiftIds] = useState(
    (Array.isArray(roster.shiftIds) && roster.shiftIds.length) ? roster.shiftIds : (roster.shiftId ? [roster.shiftId] : [])
  );
  const [dateFrom, setDateFrom] = useState(roster.dateFrom?.slice(0, 10) || '');
  const [dateTo,   setDateTo]   = useState(roster.dateTo?.slice(0, 10)   || '');
  const [offDays,      setOffDays]      = useState(roster.offDays      || []);
  const [dayOffDays,   setDayOffDays]   = useState(roster.dayOffDays   || []);
  const [nightOffDays, setNightOffDays] = useState(roster.nightOffDays || []);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState('');

  const handleOffDayTypesChange = (next) => {
    setOffDays(next.weekend);
    setDayOffDays(next.dayOff);
    setNightOffDays(next.nightOff);
  };

  const handleSubmit = async () => {
    if (!shiftIds.length) return setError('Please select at least one shift.');
    if (!dateFrom || !dateTo) return setError('Please set date range.');
    if (dateTo < dateFrom)    return setError('Date To must be on or after Date From.');
    setError('');
    setSaving(true);
    try {
      const resolved = resolveWeekendPick(shiftIds, offDays);
      await api.put(`/duty-roster/${roster.id}`, { shiftIds: resolved.shiftIds, dateFrom, dateTo, offDays: resolved.offDays, dayOffDays, nightOffDays });
      onSaved();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'white', borderRadius: 14, width: '100%', maxWidth: 640,
        boxShadow: '0 20px 60px rgba(0,0,0,.25)', overflow: 'hidden', maxHeight: '92vh',
        display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div style={{ background: '#ffffff', padding: '16px 20px', borderBottom: '1px solid #e5e7eb',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <svg viewBox="0 0 20 20" fill="#065f46" width="18" height="18">
              <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/>
            </svg>
            <span style={{ fontWeight: 700, fontSize: 15, color: '#065f46' }}>Edit Roster</span>
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        {/* Body */}
        <div
          style={{ padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}
          onKeyDown={enterAsTab}
        >
          {/* Staff info (read-only) */}
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', marginBottom: 10 }}>
              Staff Information
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[
                ['Staff Name',  roster.employeeName],
                ['Staff ID',    roster.staffId],
                ['Branch',      roster.branch],
                ['Post',        roster.position],
                ['Department',  roster.department],
                ['Device ID',   roster.deviceId],
              ].map(([label, val]) => (
                <div key={label}>
                  <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 3 }}>{label}</div>
                  <div style={disStyle}>{val || '—'}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Change Shift */}
          <div>
            <Label>Change Shift <span style={{ color: '#dc2626' }}>*</span></Label>
            <MultiShiftDropdown shifts={shifts} value={shiftIds} onChange={setShiftIds} />
          </div>

          {/* Date Range */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <Label>Date From <span style={{ color: '#dc2626' }}>*</span></Label>
              <DateInput value={dateFrom} onChange={setDateFrom} />
            </div>
            <div>
              <Label>Date To <span style={{ color: '#dc2626' }}>*</span></Label>
              <DateInput value={dateTo} onChange={setDateTo} />
            </div>
          </div>

          {/* Off Days */}
          <OffDayTypeRows offDays={offDays} dayOffDays={dayOffDays} nightOffDays={nightOffDays}
            onChange={handleOffDayTypesChange} />

          {error && (
            <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 8,
              padding: '10px 14px', color: '#991b1b', fontSize: 13, fontWeight: 600 }}>
              ⚠️ {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 20px', borderTop: '1px solid #f3f4f6',
          display: 'flex', justifyContent: 'flex-end', gap: 10, background: '#fafafa' }}>
          <button onClick={onClose}
            style={{ height: 36, padding: '0 18px', fontSize: 13, fontWeight: 600,
              background: 'white', border: '1px solid #d1d5db', color: '#374151',
              borderRadius: 8, cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={saving}
            style={{ height: 36, padding: '0 20px', fontSize: 13, fontWeight: 700,
              background: saving ? '#6ee7b7' : '#0e9f6e', color: 'white',
              border: 'none', borderRadius: 8, cursor: saving ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 6 }}>
            {saving ? '⏳ Saving…' : '✅ Update Roster'}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ══════════════════════════════════════════════════════════════
   AI Analysis Engine
══════════════════════════════════════════════════════════════ */
function analyzeRosters(rosters, employees) {
  const today = getNepalNow(); today.setHours(0, 0, 0, 0);
  const in30  = new Date(today); in30.setDate(today.getDate() + 30);
  const insights = [];

  const active   = rosters.filter(r => r.active !== false);
  const expired  = active.filter(r => r.dateTo  && new Date(r.dateTo)   < today);
  const current  = active.filter(r => (!r.dateFrom || new Date(r.dateFrom) <= today) &&
                                      (!r.dateTo   || new Date(r.dateTo)   >= today));
  const expiring = active.filter(r => r.dateTo && new Date(r.dateTo) >= today && new Date(r.dateTo) <= in30);
  const future   = active.filter(r => r.dateFrom && new Date(r.dateFrom) > today);

  /* ── 1. Summary ── */
  insights.push({
    type: 'summary',
    title: 'Roster Overview',
    icon: '📊',
    color: '#1a56db',
    bg: '#eff6ff',
    border: '#bfdbfe',
    items: [
      { label: 'Total Entries',   value: rosters.length,  note: '' },
      { label: 'Currently Active', value: current.length, note: '' },
      { label: 'Expired',         value: expired.length,  note: expired.length > 0 ? 'Need cleanup' : 'Clean' },
      { label: 'Expiring in 30d', value: expiring.length, note: expiring.length > 0 ? 'Action needed' : '' },
      { label: 'Future Rosters',  value: future.length,   note: '' },
    ],
  });

  /* ── 2. Shift distribution ── */
  const shiftCount = {};
  active.forEach(r => { if (r.shiftName) shiftCount[r.shiftName] = (shiftCount[r.shiftName] || 0) + 1; });
  const shiftEntries = Object.entries(shiftCount).sort((a, b) => b[1] - a[1]);
  if (shiftEntries.length > 0) {
    const total = shiftEntries.reduce((s, [, n]) => s + n, 0);
    insights.push({
      type: 'distribution',
      title: 'Shift Distribution',
      icon: '🔄',
      color: '#059669',
      bg: '#f0fdf4',
      border: '#86efac',
      items: shiftEntries.slice(0, 6).map(([name, count]) => ({
        label: name, value: count,
        pct: Math.round((count / total) * 100),
        barColor: '#059669',
      })),
    });
  }

  /* ── 3. Department coverage ── */
  const deptCount = {};
  active.forEach(r => { if (r.department) deptCount[r.department] = (deptCount[r.department] || 0) + 1; });
  const deptEntries = Object.entries(deptCount).sort((a, b) => b[1] - a[1]);
  if (deptEntries.length > 0) {
    const total = deptEntries.reduce((s, [, n]) => s + n, 0);
    insights.push({
      type: 'distribution',
      title: 'Department Coverage',
      icon: '🏢',
      color: '#7e3af2',
      bg: '#f5f3ff',
      border: '#ddd6fe',
      items: deptEntries.slice(0, 6).map(([name, count]) => ({
        label: name, value: count,
        pct: Math.round((count / total) * 100),
        barColor: '#7e3af2',
      })),
    });
  }

  /* ── 4. Staff without any roster ── */
  const assignedEmpIds = new Set(active.map(r => String(r.employeeId || r.staffId || r.employeeName)));
  const unassigned = employees.filter(e => e.active &&
    !assignedEmpIds.has(String(e.id)) &&
    !assignedEmpIds.has(e.fullName)
  );
  if (unassigned.length > 0) {
    insights.push({
      type: 'warning',
      title: 'Staff Without Roster Assignment',
      icon: '⚠️',
      color: '#d97706',
      bg: '#fffbeb',
      border: '#fcd34d',
      message: `${unassigned.length} active staff member${unassigned.length > 1 ? 's have' : ' has'} no roster entry.`,
      list: unassigned.slice(0, 8).map(e => `${e.fullName} (${e.department || '—'})`),
      extra: unassigned.length > 8 ? `…and ${unassigned.length - 8} more` : null,
    });
  }

  /* ── 5. Expiring soon ── */
  if (expiring.length > 0) {
    insights.push({
      type: 'warning',
      title: 'Rosters Expiring Within 30 Days',
      icon: '⏰',
      color: '#dc2626',
      bg: '#fff5f5',
      border: '#fca5a5',
      message: `${expiring.length} roster${expiring.length > 1 ? 's are' : ' is'} expiring soon.`,
      list: expiring.slice(0, 8).map(r => {
        const d = new Date(r.dateTo);
        const days = Math.ceil((d - today) / 86400000);
        return `${r.employeeName} — ${r.shiftName || '—'} (in ${days}d)`;
      }),
      extra: expiring.length > 8 ? `…and ${expiring.length - 8} more` : null,
    });
  }

  /* ── 6. Off-day pattern ── */
  const dayCount = {};
  DAYS.forEach(d => { dayCount[d] = 0; });
  active.forEach(r => {
    const days = new Set([...(r.offDays || []), ...(r.dayOffDays || []), ...(r.nightOffDays || [])]);
    days.forEach(d => { if (dayCount[d] !== undefined) dayCount[d]++; });
  });
  const maxDay = Math.max(...Object.values(dayCount));
  if (maxDay > 0) {
    insights.push({
      type: 'offdays',
      title: 'Off-Day Pattern',
      icon: '📅',
      color: '#0891b2',
      bg: '#f0f9ff',
      border: '#bae6fd',
      days: DAYS.map(d => ({ day: d, count: dayCount[d], pct: maxDay ? Math.round((dayCount[d] / maxDay) * 100) : 0 })),
    });
  }

  /* ── 7. Duplicate rosters (same staff, overlapping dates) ── */
  const byEmp = {};
  active.forEach(r => {
    const key = r.employeeName || r.staffId;
    if (key) (byEmp[key] = byEmp[key] || []).push(r);
  });
  const duplicates = Object.entries(byEmp)
    .filter(([, list]) => list.length > 1)
    .map(([name, list]) => ({ name, count: list.length }));
  if (duplicates.length > 0) {
    insights.push({
      type: 'info',
      title: 'Multiple Roster Entries Per Staff',
      icon: 'ℹ️',
      color: '#0369a1',
      bg: '#f0f9ff',
      border: '#7dd3fc',
      message: `${duplicates.length} staff member${duplicates.length > 1 ? 's have' : ' has'} more than one roster entry.`,
      list: duplicates.slice(0, 6).map(d => `${d.name} — ${d.count} entries`),
      extra: duplicates.length > 6 ? `…and ${duplicates.length - 6} more` : null,
    });
  }

  /* ── 8. Expired cleanup recommendation ── */
  if (expired.length > 5) {
    insights.push({
      type: 'recommendation',
      title: 'Recommendation: Clean Up Expired Rosters',
      icon: '🧹',
      color: '#6b7280',
      bg: '#f9fafb',
      border: '#d1d5db',
      message: `You have ${expired.length} expired roster entries. Archiving them will improve performance and readability.`,
    });
  }

  return insights;
}

/* ══════════════════════════════════════════════════════════════
   Calendar View Roster Modal — pick a staff member, click/select day(s)
   on a month calendar, assign a shift / Day Off / Night Off to the whole
   selection at once. Approved-leave days are shown but not selectable.
══════════════════════════════════════════════════════════════ */
const CalendarRosterModal = ({ employees, shifts, rosters, currentUser, initialStaffId, initialDate, onClose, onSaved }) => {
  const { settings } = useSettings();
  const { getApprovedLeaveForDate, getLeaveTypeColor } = useData();
  const useNP   = settings.defaultCalendar === 'np';
  const useNPDg = useNP && settings.nepaliDigits;
  const fmtN    = n => useNPDg ? toNepaliDigits(n) : String(n);
  const today   = getNepalNow();
  const todayBS = adToBS(getNepalTodayISO());
  const initDateBS = useNP && initialDate ? adToBS(initialDate) : null;
  const initDateAD = !useNP && initialDate ? new Date(initialDate) : null;

  const staffList = useMemo(
    () => employees.slice().sort((a, b) => (a.fullName || '').localeCompare(b.fullName || '')),
    [employees]
  );

  const [selectedStaffId, setSelectedStaffId] = useState(initialStaffId ?? staffList[0]?.id ?? null);
  const [navYear,  setNavYear]  = useState(() => useNP
    ? (initDateBS?.year  || todayBS?.year  || today.getFullYear())
    : (initDateAD?.getFullYear() ?? today.getFullYear()));
  const [navMonth, setNavMonth] = useState(() => useNP
    ? (initDateBS?.month || todayBS?.month || today.getMonth() + 1)
    : (initDateAD?.getMonth() ?? today.getMonth())); // BS: 1-12, AD: 0-11
  const [selectedDates,  setSelectedDates]  = useState(() => new Set());
  const [lastClicked,    setLastClicked]    = useState(null);
  const [pendingChoiceIds, setPendingChoiceIds] = useState([]);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState('');
  const [okMsg,    setOkMsg]    = useState('');

  const staff = staffList.find(e => e.id === selectedStaffId) || null;
  const staffIdx = staffList.findIndex(e => e.id === selectedStaffId);

  /* Switching staff or month invalidates any in-progress selection */
  useEffect(() => { setSelectedDates(new Set()); setLastClicked(null); setPendingChoiceIds([]); setError(''); }, [selectedStaffId, navYear, navMonth]);

  const goStaff = (delta) => {
    const idx = staffIdx + delta;
    if (idx < 0 || idx >= staffList.length) return;
    setSelectedStaffId(staffList[idx].id);
  };

  const scopeLabel =
    currentUser?.role === 'departmentHead' ? `Department: ${currentUser.department || '—'}` :
    currentUser?.role === 'branchManager'  ? `Branch: ${currentUser.branch || '—'}` :
    (currentUser?.role === 'admin' || currentUser?.role === 'superAdmin') ? 'All Staff' :
    'My Roster';

  const goPrevMonth = () => {
    if (useNP) { if (navMonth <= 1) { setNavMonth(12); setNavYear(y => y - 1); } else setNavMonth(m => m - 1); }
    else       { if (navMonth <= 0) { setNavMonth(11); setNavYear(y => y - 1); } else setNavMonth(m => m - 1); }
  };
  const goNextMonth = () => {
    if (useNP) { if (navMonth >= 12) { setNavMonth(1);  setNavYear(y => y + 1); } else setNavMonth(m => m + 1); }
    else       { if (navMonth >= 11) { setNavMonth(0);  setNavYear(y => y + 1); } else setNavMonth(m => m + 1); }
  };

  let daysInMonth, firstDay, monthLabel;
  if (useNP) {
    daysInMonth = getBSDays(navYear, navMonth) || 30;
    const firstAD = bsToAD(navYear, navMonth, 1);
    firstDay = firstAD ? firstAD.getDay() : 0;
    monthLabel = `${BS_MONTHS_EN[navMonth - 1] || ''} ${fmtN(navYear)} BS`;
  } else {
    daysInMonth = new Date(navYear, navMonth + 1, 0).getDate();
    firstDay    = new Date(navYear, navMonth, 1).getDay();
    monthLabel  = new Date(navYear, navMonth, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  }
  const getADDate = (d) => useNP ? bsToAD(navYear, navMonth, d) : new Date(navYear, navMonth, d);
  const isToday = (d) => useNP
    ? (todayBS && navYear === todayBS.year && navMonth === todayBS.month && d === todayBS.day)
    : (d === today.getDate() && navMonth === today.getMonth() && navYear === today.getFullYear());

  const staffRosters = useMemo(
    () => rosters.filter(r => r.employeeDbId === selectedStaffId),
    [rosters, selectedStaffId]
  );

  const getDayInfo = useCallback((adDate) => {
    if (!adDate || !staff) return null;
    const dayStart = new Date(adDate); dayStart.setHours(0, 0, 0, 0);
    const dateStr  = toISODate(dayStart);

    const leave = getApprovedLeaveForDate(staff.id, dateStr);
    if (leave) return { leave: { code: leave.leaveTypeCode, color: getLeaveTypeColor(leave.leaveTypeCode) } };

    const dayEnd = new Date(adDate); dayEnd.setHours(23, 59, 59, 999);
    const covering = staffRosters.filter(r => {
      const from = r.dateFrom ? new Date(r.dateFrom) : null;
      const to   = r.dateTo   ? new Date(r.dateTo)   : null;
      return (!from || from <= dayEnd) && (!to || to >= dayStart);
    });
    const r = pickMostSpecificRoster(covering);
    if (!r) return null;
    const dayName = DAYS[dayStart.getDay()];
    // Weekend/Day Off/Night Off are three independent day-of-week sets (see
    // OFF_DAY_TYPES) — a day counts as off if it falls in any of them, not
    // just the original weekend-only offDays column.
    const isOff = (r.offDays || []).includes(dayName)
      || (r.dayOffDays || []).includes(dayName)
      || (r.nightOffDays || []).includes(dayName);
    return { isOff, shiftName: r.shiftName, dateStr };
  }, [staff, staffRosters, getApprovedLeaveForDate, getLeaveTypeColor]);

  /* ── Cell click: plain click toggles; shift+click extends a contiguous
     range from the last-clicked day (skipping leave days either way) ── */
  const handleDayClick = (d, e) => {
    const info = getDayInfo(getADDate(d));
    if (info?.leave) return; // not editable while on approved leave
    const dateStr = toISODate(getADDate(d));

    if (e.shiftKey && lastClicked !== null) {
      const lo = Math.min(lastClicked, d), hi = Math.max(lastClicked, d);
      setSelectedDates(prev => {
        const next = new Set(prev);
        for (let x = lo; x <= hi; x++) {
          const xInfo = getDayInfo(getADDate(x));
          if (!xInfo?.leave) next.add(toISODate(getADDate(x)));
        }
        return next;
      });
    } else {
      setSelectedDates(prev => {
        const next = new Set(prev);
        if (next.has(dateStr)) next.delete(dateStr); else next.add(dateStr);
        return next;
      });
    }
    setLastClicked(d);
  };

  const pickableShifts = shifts.filter(s => !s.makeDefault && s.active !== false);

  const applyToSelectedDates = async (shiftIds) => {
    setError(''); setOkMsg(''); setSaving(true);
    try {
      await api.post('/duty-roster/bulk-days', {
        employeeId: selectedStaffId,
        dates: [...selectedDates],
        shiftIds,
        createdBy: currentUser?.fullName || currentUser?.username || 'Admin',
      });
      onSaved();
      setOkMsg(shiftIds.length ? `Applied to ${selectedDates.size} day(s).` : `Cleared override on ${selectedDates.size} day(s).`);
      setSelectedDates(new Set());
      setLastClicked(null);
      setPendingChoiceIds([]);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleApply = () => {
    if (!pendingChoiceIds.length) return setError('Pick at least one shift, Weekend, Day Off, or Night Off.');
    applyToSelectedDates(pendingChoiceIds);
  };
  const handleClear = () => applyToSelectedDates([]);

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'white', borderRadius: 14, width: '100%', maxWidth: 840,
        boxShadow: '0 20px 60px rgba(0,0,0,.25)', overflow: 'hidden', maxHeight: '94vh',
        display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div style={{ background: '#ffffff', padding: '16px 20px', borderBottom: '1px solid #e5e7eb',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18 }}>🗓️</span>
            <span style={{ fontWeight: 700, fontSize: 15, color: '#1e40af' }}>
              {initialStaffId ? 'Calendar View — Staff Roster' : 'Calendar View — Create Roster'}
            </span>
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div style={{ padding: '18px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* ── Staff navigation ── */}
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10,
            padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button onClick={() => goStaff(-1)} disabled={staffIdx <= 0}
              style={{ width: 32, height: 32, border: '1px solid #d1d5db', borderRadius: 7,
                background: '#fff', cursor: staffIdx <= 0 ? 'not-allowed' : 'pointer',
                color: staffIdx <= 0 ? '#d1d5db' : '#374151', fontSize: 15, fontWeight: 700 }}>‹</button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 200 }}>
              <div style={{ width: 34, height: 34, borderRadius: 9, background: '#eff6ff',
                border: '1.5px solid #bfdbfe', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 15, color: '#1a56db', fontWeight: 800, flexShrink: 0 }}>
                {(staff?.fullName || '?')[0].toUpperCase()}
              </div>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: '#111827' }}>{staff?.fullName || '—'}</div>
                <div style={{ fontSize: 11, color: '#6b7280' }}>
                  {[staff?.department, staff?.position].filter(Boolean).join(' · ') || '—'}
                </div>
              </div>
            </div>

            <button onClick={() => goStaff(1)} disabled={staffIdx >= staffList.length - 1}
              style={{ width: 32, height: 32, border: '1px solid #d1d5db', borderRadius: 7,
                background: '#fff', cursor: staffIdx >= staffList.length - 1 ? 'not-allowed' : 'pointer',
                color: staffIdx >= staffList.length - 1 ? '#d1d5db' : '#374151', fontSize: 15, fontWeight: 700 }}>›</button>

            <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', background: '#eef2ff',
              border: '1px solid #c7d2fe', borderRadius: 6, padding: '3px 9px' }}>{scopeLabel}</span>

            <div style={{ marginLeft: 'auto', minWidth: 260 }}>
              <StaffDropdown employees={staffList} value={selectedStaffId} onChange={setSelectedStaffId} />
            </div>
          </div>

          {/* ── Month nav + legend ── */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button onClick={goPrevMonth}
                style={{ width: 30, height: 30, border: '1px solid #d1d5db', borderRadius: 7,
                  background: '#fff', cursor: 'pointer', color: '#374151', fontSize: 14 }}>‹</button>
              <span style={{ fontSize: 13, fontWeight: 800, color: '#111827', minWidth: 150, textAlign: 'center' }}>
                📅 {monthLabel}
              </span>
              <button onClick={goNextMonth}
                style={{ width: 30, height: 30, border: '1px solid #d1d5db', borderRadius: 7,
                  background: '#fff', cursor: 'pointer', color: '#374151', fontSize: 14 }}>›</button>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 11.5, color: '#6b7280' }}>
              {[
                { bg: '#dbeafe', border: '#1a56db', label: 'Working' },
                { bg: '#fee2e2', border: '#dc2626', label: 'Day/Night Off' },
                { bg: '#fef3c7', border: '#d97706', label: 'Leave' },
                { bg: '#dbeafe', border: '#1a56db', label: 'Selected', ring: true },
              ].map(l => (
                <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 11, height: 11, borderRadius: 3, flexShrink: 0, background: l.bg,
                    border: l.ring ? '2px solid #1a56db' : `1.5px solid ${l.border}` }} />
                  {l.label}
                </div>
              ))}
            </div>
          </div>

          {/* ── Calendar grid ── */}
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', background: '#f8fafc', borderBottom: '2px solid #e5e7eb' }}>
              {DAYS.map(d => (
                <div key={d} style={{ padding: '7px 4px', textAlign: 'center', fontSize: 12,
                  fontWeight: 700, color: d === 'Sun' ? '#dc2626' : '#6b7280' }}>{d}</div>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)' }}>
              {cells.map((d, idx) => {
                if (d === null) return (
                  <div key={`e-${idx}`} style={{ minHeight: 68, background: '#fafafa',
                    borderBottom: '1px solid #efefef', borderRight: (idx + 1) % 7 !== 0 ? '1px solid #efefef' : 'none' }} />
                );
                const adDate = getADDate(d);
                const info   = getDayInfo(adDate);
                const dateStr = toISODate(adDate);
                const tod    = isToday(d);
                const dow    = (firstDay + d - 1) % 7;
                const isSel  = selectedDates.has(dateStr);
                const selectable = !info?.leave;

                let bg = '#fff';
                if (info?.leave) bg = '#fffbeb';
                else if (info?.isOff) bg = '#fff8f8';
                else if (info) bg = '#f0f8ff';
                if (isSel) bg = '#dbeafe';

                return (
                  <div key={d}
                    onClick={selectable ? (e) => handleDayClick(d, e) : undefined}
                    style={{
                      minHeight: 68, background: bg,
                      borderBottom: '1px solid #e5e7eb',
                      borderRight: (idx + 1) % 7 !== 0 ? '1px solid #e5e7eb' : 'none',
                      padding: '5px 7px', display: 'flex', flexDirection: 'column', gap: 3,
                      outline: isSel ? '2px solid #1a56db' : (tod ? '2px solid #93c5fd' : 'none'),
                      outlineOffset: -2,
                      cursor: selectable ? 'pointer' : 'not-allowed',
                      userSelect: 'none',
                    }}>
                    <div style={{ alignSelf: 'flex-start', width: 22, height: 22, borderRadius: '50%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12.5,
                      fontWeight: tod ? 800 : 500,
                      background: tod ? '#1a56db' : 'transparent',
                      color: tod ? '#fff' : dow === 0 ? '#dc2626' : '#374151' }}>{fmtN(d)}</div>
                    {info?.leave ? (
                      <div style={{ background: info.leave.color + '22', color: info.leave.color, borderRadius: 4,
                        fontSize: 10.5, fontWeight: 700, padding: '2px 5px', textAlign: 'center' }}>{info.leave.code}</div>
                    ) : info?.isOff ? (
                      <div style={{ background: '#fee2e2', color: '#991b1b', borderRadius: 4,
                        fontSize: 10.5, fontWeight: 700, padding: '2px 5px', textAlign: 'center' }}>OFF</div>
                    ) : info ? (
                      <div style={{ background: '#dbeafe', color: '#1e40af', borderRadius: 4, fontSize: 10.5,
                        fontWeight: 700, padding: '2px 5px', textAlign: 'center', overflow: 'hidden',
                        textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{info.shiftName || 'On Duty'}</div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ fontSize: 11, color: '#9ca3af' }}>
            💡 Click a day to select it, click again to deselect. Shift+click extends a range from the last day you clicked. Days on approved leave can't be edited here.
          </div>

          {error && (
            <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 8,
              padding: '10px 14px', color: '#991b1b', fontSize: 13, fontWeight: 600 }}>⚠️ {error}</div>
          )}
          {okMsg && !selectedDates.size && (
            <div style={{ background: '#f0fdf4', border: '1px solid #6ee7b7', borderRadius: 8,
              padding: '10px 14px', color: '#065f46', fontSize: 13, fontWeight: 600 }}>✅ {okMsg}</div>
          )}
        </div>

        {/* ── Apply bar ── */}
        {selectedDates.size > 0 && (
          <div style={{ padding: '12px 20px', borderTop: '1px solid #f3f4f6', background: '#fafafa',
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: '#374151' }}>
              {selectedDates.size} day{selectedDates.size !== 1 ? 's' : ''} selected
            </span>
            <div style={{ minWidth: 260 }}>
              <MultiShiftDropdown shifts={pickableShifts} value={pendingChoiceIds} onChange={setPendingChoiceIds} />
            </div>
            <button onClick={handleApply} disabled={saving || !pendingChoiceIds.length}
              style={{ height: 34, padding: '0 16px', fontSize: 12.5, fontWeight: 700,
                background: (saving || !pendingChoiceIds.length) ? '#93c5fd' : '#1a56db', color: 'white',
                border: 'none', borderRadius: 7, cursor: (saving || !pendingChoiceIds.length) ? 'not-allowed' : 'pointer' }}>
              {saving ? '⏳ Applying…' : `✅ Apply to ${selectedDates.size} day(s)`}
            </button>
            <button onClick={handleClear} disabled={saving}
              title="Remove any shift override on the selected day(s)"
              style={{ height: 34, padding: '0 14px', fontSize: 12.5, fontWeight: 600,
                background: '#fff5f5', border: '1px solid #fca5a5', color: '#dc2626',
                borderRadius: 7, cursor: saving ? 'not-allowed' : 'pointer' }}>
              🗑️ Clear
            </button>
            <button onClick={() => { setSelectedDates(new Set()); setLastClicked(null); setPendingChoiceIds([]); }}
              style={{ height: 34, padding: '0 14px', fontSize: 12.5, fontWeight: 600,
                background: '#fff', border: '1px solid #d1d5db', color: '#374151', borderRadius: 7, cursor: 'pointer' }}>
              Cancel Selection
            </button>
          </div>
        )}

        {/* Footer */}
        <div style={{ padding: '14px 20px', borderTop: '1px solid #f3f4f6',
          display: 'flex', justifyContent: 'flex-end', background: '#fafafa' }}>
          <button onClick={onClose}
            style={{ height: 36, padding: '0 18px', fontSize: 13, fontWeight: 600,
              background: 'white', border: '1px solid #d1d5db', color: '#374151',
              borderRadius: 8, cursor: 'pointer' }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

/* ── AI Analysis drawer ──────────────────────────────────────────── */
const RosterAIAnalysis = ({ rosters, employees, onClose }) => {
  const [phase, setPhase] = useState('thinking'); // thinking → done
  const [insights, setInsights] = useState([]);

  useEffect(() => {
    const t = setTimeout(() => {
      setInsights(analyzeRosters(rosters, employees));
      setPhase('done');
    }, 1400);
    return () => clearTimeout(t);
  }, []);

  const THINKING_STEPS = [
    'Scanning roster entries…',
    'Analyzing shift distribution…',
    'Checking department coverage…',
    'Identifying unassigned staff…',
    'Detecting expiring rosters…',
    'Reviewing off-day patterns…',
  ];
  const [stepIdx, setStepIdx] = useState(0);
  useEffect(() => {
    if (phase !== 'thinking') return;
    const t = setInterval(() => setStepIdx(p => (p + 1) % THINKING_STEPS.length), 220);
    return () => clearInterval(t);
  }, [phase]);

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 800,
      }} />

      {/* Drawer */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 480,
        background: '#fff', zIndex: 801,
        boxShadow: '-8px 0 40px rgba(0,0,0,.18)',
        display: 'flex', flexDirection: 'column',
        animation: 'slideInRight .25s ease',
      }}>
        {/* Header */}
        <div style={{
          padding: '18px 20px', borderBottom: '1px solid #e5e7eb',
          display: 'flex', alignItems: 'center', gap: 10,
          background: 'linear-gradient(135deg,#0f172a,#1e3a8a)',
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, flexShrink: 0,
          }}>🤖</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>Roster Analysis</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.55)', marginTop: 1 }}>
              {phase === 'thinking' ? 'Analyzing data…' : `${insights.length} insights found · ${rosters.length} entries`}
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.2)',
            borderRadius: 8, width: 30, height: 30, cursor: 'pointer',
            color: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>×</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
          {phase === 'thinking' ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', padding: '60px 20px', gap: 20 }}>
              <div style={{
                width: 56, height: 56, borderRadius: '50%',
                border: '3px solid #e5e7eb', borderTopColor: '#1a56db',
                animation: 'spin 0.8s linear infinite',
              }} />
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#1f2937', marginBottom: 8 }}>
                  Analyzing Roster Data
                </div>
                <div style={{ fontSize: 12, color: '#6b7280', height: 18, transition: 'opacity .2s' }}>
                  {THINKING_STEPS[stepIdx]}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {[0,1,2].map(i => (
                  <div key={i} style={{
                    width: 6, height: 6, borderRadius: '50%', background: '#1a56db',
                    animation: `bounce 1.2s ${i * 0.2}s ease-in-out infinite`,
                  }} />
                ))}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {insights.map((ins, i) => (
                <InsightCard key={i} ins={ins} />
              ))}
              <div style={{
                textAlign: 'center', padding: '12px 0 4px',
                fontSize: 11, color: '#9ca3af',
              }}>
                Analysis based on {rosters.length} roster entries · Generated just now
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {phase === 'done' && (
          <div style={{ padding: '12px 16px', borderTop: '1px solid #f3f4f6', background: '#fafafa' }}>
            <button onClick={onClose} style={{
              width: '100%', height: 36, border: '1px solid #d1d5db',
              borderRadius: 8, background: '#fff', fontSize: 13, fontWeight: 600,
              color: '#374151', cursor: 'pointer',
            }}>Close</button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes bounce { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
      `}</style>
    </>
  );
};

/* ── Insight Card renderer ── */
const InsightCard = ({ ins }) => {
  const cardStyle = {
    border: `1px solid ${ins.border}`,
    borderRadius: 12,
    background: ins.bg,
    padding: '14px 16px',
    overflow: 'hidden',
  };
  const titleRow = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      <span style={{ fontSize: 18 }}>{ins.icon}</span>
      <span style={{ fontSize: 13, fontWeight: 800, color: ins.color }}>{ins.title}</span>
    </div>
  );

  if (ins.type === 'summary') {
    return (
      <div style={cardStyle}>
        {titleRow}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
          {ins.items.map((item, i) => (
            <div key={i} style={{ background: '#fff', borderRadius: 8, padding: '10px 12px',
              border: '1px solid rgba(0,0,0,.06)', textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: ins.color }}>{item.value}</div>
              <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>{item.label}</div>
              {item.note && <div style={{ fontSize: 10, color: item.note === 'Clean' ? '#059669' : '#d97706',
                fontWeight: 600, marginTop: 2 }}>{item.note}</div>}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (ins.type === 'distribution') {
    const max = Math.max(...ins.items.map(x => x.value));
    return (
      <div style={cardStyle}>
        {titleRow}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {ins.items.map((item, i) => (
            <div key={i}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ fontSize: 12, color: '#374151', fontWeight: 500,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>
                  {item.label}
                </span>
                <span style={{ fontSize: 11, color: '#6b7280', flexShrink: 0 }}>
                  {item.value} ({item.pct}%)
                </span>
              </div>
              <div style={{ height: 6, background: 'rgba(0,0,0,.08)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 4,
                  background: ins.barColor,
                  width: `${Math.round((item.value / max) * 100)}%`,
                  transition: 'width .6s ease',
                }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (ins.type === 'offdays') {
    return (
      <div style={cardStyle}>
        {titleRow}
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
          {ins.days.map(({ day, count, pct }) => (
            <div key={day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{ fontSize: 10, color: '#6b7280', fontWeight: 600 }}>{count}</div>
              <div style={{ width: '100%', height: 50, display: 'flex', alignItems: 'flex-end',
                background: 'rgba(0,0,0,.04)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{
                  width: '100%', borderRadius: 4,
                  height: `${Math.max(pct, 4)}%`,
                  background: pct > 60 ? ins.color : pct > 30 ? '#7dd3fc' : '#bae6fd',
                  transition: 'height .6s ease',
                }} />
              </div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#374151' }}>{day}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  /* warning / info / recommendation */
  return (
    <div style={cardStyle}>
      {titleRow}
      {ins.message && (
        <div style={{ fontSize: 13, color: '#374151', marginBottom: ins.list ? 8 : 0, lineHeight: 1.5 }}>
          {ins.message}
        </div>
      )}
      {ins.list && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {ins.list.map((item, i) => (
            <div key={i} style={{
              fontSize: 12, color: ins.color, background: '#fff',
              border: `1px solid ${ins.border}`,
              borderRadius: 6, padding: '5px 10px', fontWeight: 500,
            }}>{item}</div>
          ))}
          {ins.extra && (
            <div style={{ fontSize: 11, color: '#9ca3af', padding: '2px 4px' }}>{ins.extra}</div>
          )}
        </div>
      )}
    </div>
  );
};

/* ══════════════════════════════════════════════════════════════
   Main DutyRoster Page
══════════════════════════════════════════════════════════════ */
const DutyRoster = () => {
  const navigate                   = useNavigate();
  const { currentUser, isAdmin, canEdit, canDelete } = useAuth();
  const canEditRoster   = canEdit('dutyRoster');
  const canDeleteRoster = canDelete('dutyRoster');
  const { settings }               = useSettings();
  const { bumpRosterVersion, filteredEmployees: employees, getEmployeeById } = useData();
  const fd = useDateFormat();

  const [showModal,      setShowModal]      = useState(false);
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const [editRoster,     setEditRoster]     = useState(null);
  const [viewCalRow,     setViewCalRow]     = useState(null);
  const [showAdvSearch,  setShowAdvSearch]  = useState(false);
  const [showAIAnalysis, setShowAIAnalysis] = useState(false);
  const [shifts,         setShifts]         = useState([]);
  const [rosters,        setRosters]        = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState(null);
  const [showClearModal, setShowClearModal] = useState(false);
  const [clearForm,      setClearForm]      = useState({ dateFrom:'', dateTo:'', branch:'', department:'', position:'', grade:'', mode:'Working' });
  const [clearLoading,   setClearLoading]   = useState(false);

  /* ── Advanced search filter state ── */
  const currentFY   = getCurrentFY(settings.fiscalYears || []);
  const currentFYId = currentFY?.id ?? null;

  const [advFilters, setAdvFilters] = useState({
    personName:      '',
    shifts:          [],
    departments:     [],
    posts:           [],
    branches:        [],
    genders:         [],
    grades:          [],
    workingOnly:     true,
    fiscalYearId:    currentFYId,   // default = current FY
    rosterDateFrom:  '',
    rosterDateTo:    '',
  });

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([api.get('/shifts'), api.get('/duty-roster')])
      .then(([shfts, ros]) => {
        setShifts(shfts);
        setRosters(ros);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (row) => {
    if (!confirm('Delete this roster entry?')) return;
    try { await api.delete(`/duty-roster/${row.id}`); load(); bumpRosterVersion(); }
    catch (e) { alert('Delete failed: ' + e.message); }
  };

  /* ── Advanced filter helpers ── */
  const setAF = (field, val) => setAdvFilters(p => ({ ...p, [field]: val }));
  const clearAdvFilters = () => setAdvFilters({
    personName: '', shifts: [], departments: [], posts: [],
    branches: [], genders: [], grades: [],
    workingOnly: true,
    fiscalYearId:   currentFYId,   // reset to current FY
    rosterDateFrom: '', rosterDateTo: '',
  });

  /* FY filter counts as active only when changed from the default current FY */
  const activeFilterCount =
    (advFilters.personName ? 1 : 0) +
    advFilters.shifts.length + advFilters.departments.length +
    advFilters.posts.length  + advFilters.branches.length +
    advFilters.genders.length + advFilters.grades.length +
    (advFilters.fiscalYearId !== currentFYId ? 1 : 0) +
    (advFilters.rosterDateFrom ? 1 : 0) +
    (advFilters.rosterDateTo   ? 1 : 0);

  const filteredRosters = useMemo(() => {
    const f = advFilters;
    return rosters.filter(r => {
      if (f.workingOnly && !r.active) return false;
      if (f.personName) {
        const ql = f.personName.toLowerCase();
        if (!(r.employeeName || '').toLowerCase().includes(ql)) return false;
      }
      if (f.shifts.length      && !f.shifts.includes(r.shiftName  || '')) return false;
      if (f.departments.length && !f.departments.includes(r.department || '')) return false;
      if (f.posts.length       && !f.posts.includes(r.position    || '')) return false;
      if (f.branches.length    && !f.branches.includes(r.branch   || '')) return false;
      if (f.genders.length     && !f.genders.includes(r.gender    || '')) return false;
      if (f.grades.length      && !f.grades.includes(r.grade      || '')) return false;
      // Fiscal Year overlap filter
      if (f.fiscalYearId) {
        const fy = (settings.fiscalYears || []).find(y => y.id === f.fiscalYearId);
        if (fy) {
          const from = (r.dateFrom || '').slice(0, 10);
          const to   = (r.dateTo   || '').slice(0, 10);
          if (to < fy.startDate || from > fy.endDate) return false;
        }
      }
      // Manual date range filters
      const from = (r.dateFrom || '').slice(0, 10);
      const to   = (r.dateTo   || '').slice(0, 10);
      if (f.rosterDateFrom && from < f.rosterDateFrom) return false;
      if (f.rosterDateTo   && to   > f.rosterDateTo)   return false;
      return true;
    });
  }, [rosters, advFilters, settings.fiscalYears]);

  /* ── Options for Advanced Search dropdowns ── */
  const sNames    = (key) => (settings[key] || []).map(x => x.name || x).filter(Boolean).sort();
  const uniq      = (field) => [...new Set(rosters.map(r => r[field]).filter(Boolean))].sort();
  const shiftOpts = shifts.map(s => s.name).filter(Boolean).sort();
  const deptOpts  = sNames('departments').length ? sNames('departments') : uniq('department');
  const postOpts  = sNames('posts').length       ? sNames('posts')       : uniq('position');
  const branchOpts= sNames('branches').length    ? sNames('branches')    : uniq('branch');
  const gradeOpts = sNames('grades').length      ? sNames('grades')      : uniq('grade');
  const genderOpts= ['male', 'female', 'other'];

  /* ── DataGrid columns (matching Staff Detail UI) ── */
  const columns = [
    { field: 'staffId',      header: 'Staff ID',   width: 90,
      render: v => v
        ? <span style={{ fontFamily:'monospace', fontSize:12, background:'#f3f4f6', padding:'2px 6px', borderRadius:4 }}>{v}</span>
        : <span style={{ color:'#d1d5db' }}>—</span> },
    { field: 'employeeName', header: 'Full Name',  width: 160,
      render: (v, row) => (
        <span style={{ display:'flex', alignItems:'center', gap:6, fontWeight:500 }}>
          <Avatar photo={getEmployeeById(row.employeeId)?.profilePhoto} name={v} size={20} />
          {v}
        </span>
      ) },
    { field: 'deviceId',     header: 'Device ID',  width: 90,
      render: v => v
        ? <span style={{ fontFamily:'monospace', fontSize:12, color:'#0369a1' }}>{v}</span>
        : <span style={{ color:'#d1d5db' }}>—</span> },
    { field: 'position',     header: 'Post',       width: 130,
      render: v => v || <span style={{ color:'#d1d5db' }}>—</span> },
    { field: 'department',   header: 'Department', width: 130,
      render: v => v || <span style={{ color:'#d1d5db' }}>—</span> },
    { field: 'branch',       header: 'Branch',     width: 120,
      render: v => v || <span style={{ color:'#d1d5db' }}>—</span> },
    { field: 'shiftName',    header: 'Shift',      width: 120,
      render: (v, r) => {
        if (!v) return <span style={{ color:'#d1d5db' }}>—</span>;
        const extra = (Array.isArray(r.shiftIds) ? r.shiftIds.length : 1) - 1;
        return (
          <span style={{ display:'inline-flex', alignItems:'center', gap:4 }}>
            <span style={{ background:'#eff6ff', color:'#1a56db', border:'1px solid #93c5fd',
              borderRadius:6, padding:'2px 8px', fontSize:12, fontWeight:600 }}>{v}</span>
            {extra > 0 && (
              <span title={`Rotates through ${extra + 1} shifts`}
                style={{ background:'#f3f4f6', color:'#6b7280', border:'1px solid #e5e7eb',
                  borderRadius:6, padding:'2px 6px', fontSize:11, fontWeight:700 }}>+{extra}</span>
            )}
          </span>
        );
      } },
    { field: 'dateFrom',     header: 'From Date',  width: 118,
      render: v => v ? fd(v) : <span style={{ color:'#d1d5db' }}>—</span> },
    { field: 'dateTo',       header: 'To Date',    width: 118,
      render: v => v ? fd(v) : <span style={{ color:'#d1d5db' }}>—</span> },
    { field: 'offDays',      header: 'Off Days',   width: 220, sortable: false,
      // Weekend/Day Off/Night Off are three independent day-of-week sets
      // (see OFF_DAY_TYPES) — all three used to be silently dropped here,
      // only offDays (Weekend) ever showed.
      render: (v, row) => {
        const badges = [
          ...(row.offDays      || []).map(d => ({ d, bg:'#eff6ff', color:'#1a56db' })),
          ...(row.dayOffDays   || []).map(d => ({ d, bg:'#fef3c7', color:'#92400e' })),
          ...(row.nightOffDays || []).map(d => ({ d, bg:'#f5f3ff', color:'#6d28d9' })),
        ];
        return badges.length > 0
          ? <div style={{ display:'flex', gap:3, flexWrap:'wrap' }}>
              {badges.map(({ d, bg, color }, i) => (
                <span key={`${d}-${i}`} style={{ background:bg, color, borderRadius:4,
                  padding:'1px 6px', fontSize:11, fontWeight:700 }}>{d}</span>
              ))}
            </div>
          : <span style={{ color:'#d1d5db' }}>—</span>;
      } },
    { field: '_actions', header: '', width: 155, sortable: false,
      render: (_, row) => (
        <div style={{ display:'flex', gap:5 }}>
          {canEditRoster && (
            <button onClick={e => { e.stopPropagation(); setEditRoster(row); }}
              style={{ height:28, padding:'0 10px', fontSize:12, fontWeight:600,
                background:'#eff6ff', border:'1px solid #93c5fd', color:'#1d4ed8',
                borderRadius:6, cursor:'pointer', whiteSpace:'nowrap' }}>
              ✏️ Edit
            </button>
          )}
          {canEditRoster && (
            <button onClick={e => { e.stopPropagation(); setViewCalRow(row); }}
              title="View Calendar"
              style={{ height:28, width:28, padding:0, fontSize:13, fontWeight:600,
                background:'#f5f3ff', border:'1px solid #ddd6fe', color:'#7c3aed',
                borderRadius:6, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
              📅
            </button>
          )}
          {canDeleteRoster && (
            <button onClick={e => { e.stopPropagation(); handleDelete(row); }}
              style={{ height:28, padding:'0 9px', fontSize:12, fontWeight:600,
                background:'#fff5f5', border:'1px solid #fca5a5', color:'#dc2626',
                borderRadius:6, cursor:'pointer' }}>
              🗑️
            </button>
          )}
        </div>
      )
    },
  ];

  /* ═══════════════════════════ RENDER ═══════════════════════════ */
  return (
    <div className="page-container">

      {/* ── Page Header ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">🗓️ Duty Roster</h1>
          <p className="page-subtitle">
            {filteredRosters.length} roster entr{filteredRosters.length !== 1 ? 'ies' : 'y'}
            {activeFilterCount > 0 && ` (filtered from ${rosters.length})`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Advanced Search */}
          <button onClick={() => setShowAdvSearch(true)} style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 13px', height: 36,
            background: activeFilterCount > 0 ? '#eff6ff' : '#f8fafc',
            border: `1px solid ${activeFilterCount > 0 ? '#1a56db' : '#d1d5db'}`,
            color: activeFilterCount > 0 ? '#1a56db' : '#374151',
            borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', position: 'relative',
          }}>
            <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
              <path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L12 11.414V15a1 1 0 01-.553.894l-4 2A1 1 0 016 17v-5.586L3.293 6.707A1 1 0 013 6V3z" clipRule="evenodd"/>
            </svg>
            Advanced Search
            {activeFilterCount > 0 && (
              <span style={{ background: '#ef4444', color: '#fff', borderRadius: 10,
                fontSize: 10, fontWeight: 700, padding: '1px 6px', minWidth: 18, textAlign: 'center' }}>
                {activeFilterCount}
              </span>
            )}
          </button>

          {/* AI Analysis */}
          <button onClick={() => setShowAIAnalysis(true)} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', height: 36,
            background: 'linear-gradient(135deg,#1e3a8a,#7e3af2)',
            border: 'none', color: '#fff',
            borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
            boxShadow: '0 2px 10px rgba(126,58,242,.35)',
          }}>
            🤖 Roster Analysis
          </button>

          <RosterMenuBtn active={null} onSelect={key => {
            if (key === 'dashboard')       navigate('/attendance/roster-dashboard');
            else if (key === 'staff')      navigate('/attendance/duty-roster');
            else if (key === 'department') navigate('/attendance/duty-roster/dept');
            else if (key === 'view')       navigate('/attendance/roster-report');
          }} />

          <button onClick={() => window.print()}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 14px',
              height: 36, background: '#eff6ff', border: '1px solid #93c5fd', color: '#1d4ed8',
              borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            🖨️ Print
          </button>
          {isAdmin && (
            <button onClick={() => {
              setClearForm(p => ({
                ...p,
                dateFrom: currentFY?.startDate?.slice(0,10) || '',
                dateTo:   currentFY?.endDate?.slice(0,10)   || '',
              }));
              setShowClearModal(true);
            }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 36,
                padding: '0 14px', background: '#fef2f2', color: '#dc2626',
                border: '1px solid #fca5a5', borderRadius: 8, fontSize: 13, fontWeight: 700,
                cursor: 'pointer' }}>
              🗑️ Clear Roster
            </button>
          )}
          {canEditRoster && (
            <CreateRosterMenuBtn onSelect={key => {
              if (key === 'range') setShowModal(true);
              else if (key === 'calendar') setShowCalendarModal(true);
            }} />
          )}
        </div>
      </div>

      {/* ── Tip bar ── */}
      {!loading && rosters.length > 0 && (
        <div style={{ fontSize: 12, color: '#6b7280', padding: '4px 2px', marginBottom: 4 }}>
          💡 Double-click a row to edit
        </div>
      )}

      {/* ── DataGrid ── */}
      {error ? (
        <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 8,
          padding: '14px 18px', color: '#991b1b', fontWeight: 600 }}>❌ {error}</div>
      ) : (
        <DataGrid
          columns={columns}
          data={filteredRosters}
          loading={loading}
          defaultPageSize={10}
          showSearch={true}
          searchPlaceholder="Search by name, shift, department…"
          onRowClick={canEditRoster ? (row) => setEditRoster(row) : undefined}
          onDeleteKey={canDeleteRoster ? (row) => handleDelete(row) : undefined}
          striped={true}
        />
      )}

      {/* ── Create Roster Modal ── */}
      {showModal && (
        <CreateRosterModal
          employees={employees.filter(e => e.active)}
          shifts={shifts}
          currentUser={currentUser}
          onClose={() => setShowModal(false)}
          onSaved={() => { load(); bumpRosterVersion(); }}
        />
      )}

      {/* ── Calendar View Roster Modal ── */}
      {showCalendarModal && (
        <CalendarRosterModal
          employees={employees.filter(e => e.active)}
          shifts={shifts}
          rosters={rosters}
          currentUser={currentUser}
          onClose={() => setShowCalendarModal(false)}
          onSaved={() => { load(); bumpRosterVersion(); }}
        />
      )}

      {/* ── View Calendar Modal (row action) ── */}
      {viewCalRow && (
        <CalendarRosterModal
          employees={employees}
          shifts={shifts}
          rosters={rosters}
          currentUser={currentUser}
          initialStaffId={viewCalRow.employeeDbId}
          initialDate={viewCalRow.dateFrom?.slice(0, 10)}
          onClose={() => setViewCalRow(null)}
          onSaved={() => { load(); bumpRosterVersion(); }}
        />
      )}

      {/* ── Edit Roster Modal (double-click) ── */}
      {editRoster && (
        <EditRosterModal
          roster={editRoster}
          shifts={shifts}
          onClose={() => setEditRoster(null)}
          onSaved={() => { load(); bumpRosterVersion(); }}
        />
      )}

      {/* ── AI Analysis Drawer ── */}
      {showAIAnalysis && (
        <RosterAIAnalysis
          rosters={rosters}
          employees={employees}
          onClose={() => setShowAIAnalysis(false)}
        />
      )}

      {/* ── Advanced Search Modal ── */}
      {showAdvSearch && (() => {
        /* ── Multi-Checkbox Select dropdown (inline) ── */
        const MCS = ({ label, value, onChange, options, displayFn }) => {
          const [open, setOpen] = React.useState(false);
          const [srch, setSrch] = React.useState('');
          const [activeIndex, setActiveIndex] = React.useState(-1);
          const ref  = React.useRef(null);
          const itemRefs = React.useRef([]);
          React.useEffect(() => {
            const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
            document.addEventListener('mousedown', h);
            return () => document.removeEventListener('mousedown', h);
          }, []);
          const filtered = srch ? options.filter(o => o.toLowerCase().includes(srch.toLowerCase())) : options;
          // "All" is always row 0 in the navigable list, followed by the filtered options
          const navItems = [null, ...filtered];
          itemRefs.current = [];
          const toggle   = v  => onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v]);
          const selectNav = v => v === null ? onChange([]) : toggle(v);
          const selLabel = value.length === 0 ? 'All'
            : value.length === 1 ? (displayFn ? displayFn(value[0]) : value[0])
            : `${value.length} selected`;
          const openWithHighlight = () => {
            const idx = value.length === 1 ? navItems.findIndex(v => v === value[0]) : 0;
            setActiveIndex(idx >= 0 ? idx : 0);
            setOpen(true);
          };
          const handleTriggerKeyDown = e => {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              open ? setOpen(false) : openWithHighlight();
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
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
              setOpen(false);
            }
          };
          React.useEffect(() => {
            if (open && activeIndex >= 0) itemRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
          }, [activeIndex, open]);
          React.useEffect(() => { if (open) setActiveIndex(navItems.length ? 0 : -1); }, [srch]);

          return (
            <div ref={ref} style={{ position: 'relative' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#1f2937', marginBottom: 5 }}>{label}</div>
              <div
                tabIndex={0}
                onKeyDown={handleTriggerKeyDown}
                onClick={() => { open ? setOpen(false) : openWithHighlight(); }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 10px', border: `1.5px solid ${open ? '#1a56db' : '#d1d5db'}`,
                  borderRadius: 7, background: 'white', cursor: 'pointer', fontSize: 13,
                  color: value.length > 0 ? '#1e40af' : '#9ca3af', minHeight: 42,
                  fontWeight: value.length > 0 ? 600 : 400,
                  boxShadow: open ? '0 0 0 2px #bfdbfe' : 'none', outline: 'none', userSelect: 'none',
                }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {selLabel}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, marginLeft: 6 }}>
                  {value.length > 0 && (
                    <span style={{ background: '#1a56db', color: 'white', borderRadius: 10,
                      fontSize: 10, fontWeight: 700, padding: '1px 6px', minWidth: 18, textAlign: 'center' }}>
                      {value.length}
                    </span>
                  )}
                  {value.length > 0 && (
                    <span onMouseDown={e => { e.preventDefault(); e.stopPropagation(); onChange([]); }}
                      style={{ color: '#9ca3af', fontSize: 16, lineHeight: 1, cursor: 'pointer' }}
                      onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                      onMouseLeave={e => e.currentTarget.style.color = '#9ca3af'}>×</span>
                  )}
                  <span style={{ fontSize: 9, color: '#9ca3af' }}>{open ? '▲' : '▼'}</span>
                </div>
              </div>
              {open && (
                <div style={{
                  position: 'absolute', top: 'calc(100% + 3px)', left: 0, right: 0, zIndex: 9999,
                  background: 'white', border: '1.5px solid #1a56db', borderRadius: 8,
                  boxShadow: '0 8px 24px rgba(0,0,0,.18)', maxHeight: 220,
                  display: 'flex', flexDirection: 'column',
                }}>
                  <div style={{ padding: '6px 8px', borderBottom: '1px solid #e5e7eb', flexShrink: 0 }}>
                    <input autoFocus type="text" value={srch} onChange={e => setSrch(e.target.value)}
                      placeholder="Search…" onClick={e => e.stopPropagation()}
                      onKeyDown={handleSearchKeyDown}
                      style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 5,
                        padding: '5px 8px', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
                  </div>
                  <div style={{ overflowY: 'auto', flex: 1 }}>
                    {navItems.map((v, i) => {
                      const isAll = v === null;
                      const sel   = isAll ? value.length === 0 : value.includes(v);
                      const highlighted = i === activeIndex;
                      return (
                        <div key={v ?? '__all'} ref={el => itemRefs.current[i] = el}
                          onMouseDown={e => { e.preventDefault(); selectNav(v); }}
                          onMouseEnter={() => setActiveIndex(i)}
                          style={{ padding: '8px 11px', display: 'flex', alignItems: 'center', gap: 8,
                            cursor: 'pointer', background: sel ? '#eff6ff' : (highlighted ? '#f8fafc' : 'white'),
                            borderBottom: isAll ? '1px solid #f1f5f9' : '1px solid #f9fafb' }}>
                          <span style={{ width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                            border: `2px solid ${sel ? '#1a56db' : '#d1d5db'}`,
                            background: sel ? '#1a56db' : 'white',
                            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {sel && <svg viewBox="0 0 12 12" fill="none" width="9" height="9"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round"/></svg>}
                          </span>
                          <span style={{ fontSize: 13, color: sel ? '#1e40af' : '#374151', fontWeight: sel ? 600 : 400 }}>
                            {isAll ? 'All' : (displayFn ? displayFn(v) : v)}
                          </span>
                        </div>
                      );
                    })}
                    {filtered.length === 0 && (
                      <div style={{ padding: '10px 11px', fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>No results</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        };

        return (
          <div className="modal-overlay">
            <div onClick={e => e.stopPropagation()}
              style={{
                background: 'white', borderRadius: 14, width: '96vw', maxWidth: 980,
                maxHeight: '88vh', display: 'flex', flexDirection: 'column',
                boxShadow: '0 25px 60px rgba(0,0,0,.22)', overflow: 'hidden',
              }}>

              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '16px 24px', borderBottom: '2px solid #e5e7eb',
                background: '#ffffff', flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <svg viewBox="0 0 20 20" fill="#1a56db" width="18" height="18">
                    <path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L12 11.414V15a1 1 0 01-.553.894l-4 2A1 1 0 016 17v-5.586L3.293 6.707A1 1 0 013 6V3z" clipRule="evenodd"/>
                  </svg>
                  <span style={{ fontSize: 17, fontWeight: 800, color: '#111827' }}>Advanced Search</span>
                  {activeFilterCount > 0 && (
                    <span style={{ background: '#1a56db', color: '#fff', borderRadius: 10,
                      fontSize: 12, fontWeight: 700, padding: '2px 10px' }}>
                      {activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''} active
                    </span>
                  )}
                  <span style={{ fontSize: 13, color: '#6b7280' }}>
                    — {filteredRosters.length} of {rosters.length} entries shown
                  </span>
                </div>
                <button onClick={() => setShowAdvSearch(false)}
                  style={{ background: '#f3f4f6', border: 'none', borderRadius: '50%',
                    width: 36, height: 36, fontSize: 18, cursor: 'pointer', color: '#6b7280',
                    display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  ×
                </button>
              </div>

              {/* Body */}
              <div style={{ overflowY: 'auto', flex: 1, padding: '20px 24px',
                display: 'flex', flexDirection: 'column', gap: 18 }}>

                {/* Person Name search */}
                <div style={{ position: 'relative' }}>
                  <svg viewBox="0 0 20 20" fill="currentColor" width="15" height="15"
                    style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)',
                      color: '#9ca3af', pointerEvents: 'none' }}>
                    <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd"/>
                  </svg>
                  <input
                    type="text"
                    value={advFilters.personName}
                    onChange={e => setAF('personName', e.target.value)}
                    placeholder="Search by Person Name…"
                    autoFocus
                    style={{ width: '100%', boxSizing: 'border-box', padding: '11px 14px 11px 34px',
                      border: '1.5px solid #d1d5db', borderRadius: 8, fontSize: 14, outline: 'none', fontFamily: 'inherit' }}
                    onFocus={e => e.target.style.borderColor = '#1a56db'}
                    onBlur={e => e.target.style.borderColor = '#d1d5db'}
                  />
                </div>

                {/* Filter grid — 4 columns */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
                  <MCS label="Shift"      value={advFilters.shifts}      onChange={v => setAF('shifts', v)}      options={shiftOpts} />
                  <MCS label="Department" value={advFilters.departments} onChange={v => setAF('departments', v)} options={deptOpts}  />
                  <MCS label="Post"       value={advFilters.posts}       onChange={v => setAF('posts', v)}       options={postOpts}  />
                  <MCS label="Branch"     value={advFilters.branches}    onChange={v => setAF('branches', v)}    options={branchOpts}/>
                  <MCS
                    label="Gender"
                    value={advFilters.genders}
                    onChange={v => setAF('genders', v)}
                    options={genderOpts}
                    displayFn={v => v.charAt(0).toUpperCase() + v.slice(1)}
                  />
                  <MCS label="Grade"      value={advFilters.grades}      onChange={v => setAF('grades', v)}      options={gradeOpts} />

                  {/* Status: Working only — always checked, disabled */}
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#1f2937', marginBottom: 5 }}>Status</div>
                    <label
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                        border: '1.5px solid #1a56db', borderRadius: 7, userSelect: 'none', minHeight: 42,
                        background: '#eff6ff', cursor: 'not-allowed', opacity: 0.85 }}>
                      <input
                        type="checkbox"
                        checked={true}
                        disabled
                        style={{ width: 16, height: 16, accentColor: '#1a56db', cursor: 'not-allowed' }}
                      />
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#1e40af' }}>Working only</span>
                    </label>
                  </div>
                </div>

                {/* Fiscal Year + Date Range */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginTop: 4 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#1f2937', marginBottom: 5 }}>Fiscal Year</div>
                    <select
                      value={advFilters.fiscalYearId ?? ''}
                      onChange={e => setAF('fiscalYearId', e.target.value ? parseInt(e.target.value) : null)}
                      style={{ width: '100%', height: 42, border: '1.5px solid #d1d5db', borderRadius: 7,
                        padding: '0 10px', fontSize: 13, outline: 'none', background: 'white', cursor: 'pointer',
                        color: advFilters.fiscalYearId ? '#1e40af' : '#9ca3af', fontWeight: advFilters.fiscalYearId ? 600 : 400 }}
                      onFocus={e => e.target.style.borderColor = '#1a56db'}
                      onBlur={e => e.target.style.borderColor = '#d1d5db'}
                    >
                      <option value="">All Fiscal Years</option>
                      {(settings.fiscalYears || []).map(fy => (
                        <option key={fy.id} value={fy.id}>{fy.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#1f2937', marginBottom: 5 }}>From Date</div>
                    <DateInput value={advFilters.rosterDateFrom} onChange={v => setAF('rosterDateFrom', v)} />
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#1f2937', marginBottom: 5 }}>To Date</div>
                    <DateInput value={advFilters.rosterDateTo} onChange={v => setAF('rosterDateTo', v)} />
                  </div>
                </div>

                {/* Actions row — not fixed, scrolls with content */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
                  gap: 10, paddingTop: 8, borderTop: '1px solid #f3f4f6', marginTop: 4 }}>
                  <span style={{ fontSize: 12, color: '#6b7280', marginRight: 'auto' }}>
                    <strong style={{ color: '#111827' }}>{filteredRosters.length}</strong>
                    {' '}of <strong style={{ color: '#111827' }}>{rosters.length}</strong> entries
                  </span>
                  {activeFilterCount > 0 && (
                    <button onClick={clearAdvFilters}
                      style={{ height: 34, padding: '0 14px', fontSize: 13, fontWeight: 600,
                        background: 'white', border: '1px solid #d1d5db', color: '#374151',
                        borderRadius: 7, cursor: 'pointer' }}>
                      ✕ Clear
                    </button>
                  )}
                  <button onClick={() => setShowAdvSearch(false)}
                    style={{ height: 34, padding: '0 20px', fontSize: 13, fontWeight: 700,
                      background: '#1a56db', color: 'white', border: 'none',
                      borderRadius: 7, cursor: 'pointer' }}>
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ══════════ CLEAR DUTY ROSTER MODAL ══════════ */}
      {showClearModal && (
        <div className="modal-overlay" style={{ zIndex:1100 }}>
          <div className="modal modal-sm" style={{ zIndex:1200, maxWidth:480 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 style={{ color:'#991b1b' }}>🗑️ Clear Duty Roster</h2>
              <button className="modal-close" onClick={() => setShowClearModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ background:'#fff7ed', border:'1px solid #fed7aa', borderRadius:8, padding:'10px 14px', marginBottom:16, fontSize:13, color:'#92400e' }}>
                ⚠️ This permanently deletes all matching duty roster records. This action cannot be undone.
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                <div className="form-group" style={{ marginBottom:0 }}>
                  <label className="form-label" style={{ fontSize:12 }}>From Date</label>
                  <DateInput value={clearForm.dateFrom}
                    onChange={v => setClearForm(p => ({ ...p, dateFrom:v }))} />
                </div>
                <div className="form-group" style={{ marginBottom:0 }}>
                  <label className="form-label" style={{ fontSize:12 }}>To Date</label>
                  <DateInput value={clearForm.dateTo}
                    onChange={v => setClearForm(p => ({ ...p, dateTo:v }))} />
                </div>
                <div className="form-group" style={{ marginBottom:0 }}>
                  <label className="form-label" style={{ fontSize:12 }}>Branch</label>
                  <select className="form-control" style={{ fontSize:13 }}
                    value={clearForm.branch}
                    onChange={e => setClearForm(p => ({ ...p, branch:e.target.value }))}>
                    <option value="">— All Branches —</option>
                    {(settings.branches || []).map(b => <option key={b.name} value={b.name}>{b.name}</option>)}
                  </select>
                </div>
                <div className="form-group" style={{ marginBottom:0 }}>
                  <label className="form-label" style={{ fontSize:12 }}>Department</label>
                  <select className="form-control" style={{ fontSize:13 }}
                    value={clearForm.department}
                    onChange={e => setClearForm(p => ({ ...p, department:e.target.value }))}>
                    <option value="">— All Departments —</option>
                    {(settings.departments || []).map(d => <option key={d.name} value={d.name}>{d.name}</option>)}
                  </select>
                </div>
                <div className="form-group" style={{ marginBottom:0 }}>
                  <label className="form-label" style={{ fontSize:12 }}>Post</label>
                  <select className="form-control" style={{ fontSize:13 }}
                    value={clearForm.position}
                    onChange={e => setClearForm(p => ({ ...p, position:e.target.value }))}>
                    <option value="">— All Posts —</option>
                    {(settings.posts || []).map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                  </select>
                </div>
                <div className="form-group" style={{ marginBottom:0 }}>
                  <label className="form-label" style={{ fontSize:12 }}>Grade</label>
                  <select className="form-control" style={{ fontSize:13 }}
                    value={clearForm.grade}
                    onChange={e => setClearForm(p => ({ ...p, grade:e.target.value }))}>
                    <option value="">— All Grades —</option>
                    {(settings.grades || []).map(g => <option key={g.name} value={g.name}>{g.name}</option>)}
                  </select>
                </div>
                <div className="form-group" style={{ marginBottom:0, gridColumn:'1 / 3' }}>
                  <label className="form-label" style={{ fontSize:12 }}>Mode</label>
                  <select className="form-control" style={{ fontSize:13 }}
                    value={clearForm.mode}
                    onChange={e => setClearForm(p => ({ ...p, mode:e.target.value }))}>
                    <option value="Working">Working only</option>
                    <option value="">— All Modes —</option>
                    {(settings.modes || []).map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ marginTop:14, fontSize:12, color:'#6b7280' }}>
                Leave a filter blank to match all records. At least one filter is recommended.
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setShowClearModal(false)} disabled={clearLoading}>Cancel</button>
              <button
                disabled={clearLoading}
                style={{ background:'#dc2626', color:'white', border:'none', borderRadius:6,
                  padding:'8px 20px', fontSize:13, fontWeight:700,
                  cursor: clearLoading ? 'not-allowed' : 'pointer', opacity: clearLoading ? 0.7 : 1 }}
                onClick={async () => {
                  if (!window.confirm('Permanently delete all matching duty roster records?')) return;
                  setClearLoading(true);
                  try {
                    const r = await api.delete('/duty-roster/clear', clearForm);
                    const deleted = r?.deleted ?? 0;
                    const trimmed = r?.trimmed ?? 0;
                    const seeded  = r?.seeded  ?? 0;
                    setShowClearModal(false);
                    load();
                    bumpRosterVersion();
                    const parts = [];
                    if (deleted > 0) parts.push(`Deleted ${deleted} roster record${deleted !== 1 ? 's' : ''}`);
                    if (trimmed > 0) parts.push(`trimmed ${trimmed} longer roster${trimmed !== 1 ? 's' : ''} to outside the cleared dates`);
                    const msg = parts.length ? `✅ ${parts.join('; ')}.` : '✅ No matching roster records found.';
                    alert(seeded > 0
                      ? `${msg}\n📋 Default shift assigned to ${seeded} staff member${seeded !== 1 ? 's' : ''}.`
                      : msg);
                  } catch (e) {
                    alert('Error: ' + (e.message || 'Failed to clear roster'));
                  } finally {
                    setClearLoading(false);
                  }
                }}>
                {clearLoading ? '⏳ Clearing...' : '🗑️ Clear Roster'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default DutyRoster;
