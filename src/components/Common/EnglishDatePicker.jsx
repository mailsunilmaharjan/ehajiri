import React, { useState, useRef, useEffect, useLayoutEffect, forwardRef, useImperativeHandle } from 'react';
import { createPortal } from 'react-dom';
import { useSettings } from '../../context/SettingsContext.jsx';
import { formatDate, getNepalTodayISO } from '../../utils/dateUtils.js';

const EN_DAYS   = ['Su','Mo','Tu','We','Th','Fr','Sa'];
const EN_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const toISO = (y, m, d) => `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
const parseISO = (v) => {
  if (!v) return null;
  const [y, m, d] = String(v).split('-').map(Number);
  if (!y || !m || !d) return null;
  return { year: y, month: m, day: d };
};

/**
 * English (AD/Gregorian) calendar date-picker popup — same custom look and
 * interaction as NepaliDatePicker, so switching a tenant's Default Calendar
 * to AD doesn't drop back to the plain, un-stylable native <input type=date>
 * browser widget (which looks/behaves differently per OS/browser and can't
 * be made to match the rest of the app).
 *
 * Props:
 *   value      – AD ISO string (YYYY-MM-DD)
 *   onChange   – called with an AD ISO string on date selection
 *   error      – boolean, turns input border red
 *   maxToday   – (default false) disable future dates
 *   minToday   – (default false) disable past dates (yesterday or earlier)
 *   minDate    – (optional) AD ISO string — disable dates before this one
 *   maxDate    – (optional) AD ISO string — disable dates after this one
 */
const EnglishDatePicker = forwardRef(({ value, onChange, error, maxToday = false, minToday = false, minDate, maxDate }, ref) => {
  const { settings } = useSettings();

  const todayISO = getNepalTodayISO();
  const today    = parseISO(todayISO);

  const [selected,  setSelected]  = useState(() => parseISO(value));
  const [viewYear,  setViewYear]  = useState(() => parseISO(value)?.year  || today.year);
  const [viewMonth, setViewMonth] = useState(() => parseISO(value)?.month || today.month);
  const [isOpen,    setIsOpen]    = useState(false);
  const [rect,      setRect]      = useState(null);
  const [panelH,    setPanelH]    = useState(0);
  const containerRef = useRef();
  const panelRef      = useRef();
  const inputRef      = useRef();
  const lastValue = useRef(value);

  // The trigger input is readOnly (typing does nothing), so "focus" for a
  // keyboard-shortcut jump means actually opening the calendar popup.
  useImperativeHandle(ref, () => ({ focus: () => { inputRef.current?.focus(); setIsOpen(true); } }));

  useEffect(() => {
    if (value !== lastValue.current) {
      lastValue.current = value;
      const parsed = parseISO(value);
      setSelected(parsed);
      if (parsed) { setViewYear(parsed.year); setViewMonth(parsed.month); }
    }
  }, [value]);

  /* Portalled to document.body so the calendar isn't clipped by an
     ancestor's overflow:hidden — same reasoning as NepaliDatePicker. */
  useEffect(() => {
    if (!isOpen) { setRect(null); return; }
    if (containerRef.current) {
      const r = containerRef.current.getBoundingClientRect();
      const PANEL_W = 280;
      const left = Math.min(r.left, window.innerWidth - PANEL_W - 8);
      setRect({ triggerTop: r.top, triggerBottom: r.bottom, left: Math.max(8, left) });
    }
    const close = (e) => {
      if (containerRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return;
      setIsOpen(false);
    };
    const scroll = (e) => {
      if (panelRef.current?.contains(e.target)) return;
      setIsOpen(false);
    };
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', scroll, true);
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('scroll', scroll, true); };
  }, [isOpen]);

  useLayoutEffect(() => {
    if (isOpen && panelRef.current) {
      const h = panelRef.current.offsetHeight;
      if (h && h !== panelH) setPanelH(h);
    }
  }, [isOpen, rect]);

  const openUpward = !!(rect && panelH &&
    (rect.triggerBottom + 4 + panelH > window.innerHeight - 8) &&
    (rect.triggerTop - panelH - 4 >= 8));
  const panelTop = rect
    ? (openUpward ? rect.triggerTop - panelH - 4 : rect.triggerBottom + 4)
    : 0;

  const prevMonth = () => {
    if (viewMonth===1) { setViewMonth(12); setViewYear(y => y-1); }
    else setViewMonth(m => m-1);
  };
  const nextMonth = () => {
    if (viewMonth===12) { setViewMonth(1); setViewYear(y => y+1); }
    else setViewMonth(m => m+1);
  };
  const goToday = () => { setViewYear(today.year); setViewMonth(today.month); };

  const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
  const startDow    = new Date(viewYear, viewMonth - 1, 1).getDay(); // 0 = Sunday
  const cells = [
    ...Array(startDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const isFuture = (d) => maxToday && (
    viewYear > today.year ||
    (viewYear === today.year && viewMonth > today.month) ||
    (viewYear === today.year && viewMonth === today.month && d > today.day)
  );
  const isPast = (d) => minToday && (
    viewYear < today.year ||
    (viewYear === today.year && viewMonth < today.month) ||
    (viewYear === today.year && viewMonth === today.month && d < today.day)
  );
  const isBeforeMin = (d) => minDate && toISO(viewYear, viewMonth, d) < minDate;
  const isAfterMax  = (d) => maxDate && toISO(viewYear, viewMonth, d) > maxDate;
  const isToday = (d) => viewYear === today.year && viewMonth === today.month && d === today.day;
  const isSel   = (d) => selected && viewYear === selected.year && viewMonth === selected.month && d === selected.day;

  const selectDate = (d) => {
    if (isFuture(d) || isPast(d) || isBeforeMin(d) || isAfterMax(d)) return;
    const iso = toISO(viewYear, viewMonth, d);
    setSelected({ year: viewYear, month: viewMonth, day: d });
    lastValue.current = iso;
    onChange(iso);
    setIsOpen(false);
  };

  const displayText = value
    ? formatDate(value, {
        calendar:     'en',
        format:       settings.defaultDateFormat || 'dd-MMM-yyyy',
        nepaliDigits: false,
      })
    : '';

  const navBtn = {
    background:'none', border:'1px solid #e5e7eb', borderRadius:6,
    padding:'4px 10px', cursor:'pointer', fontSize:13, color:'#374151', lineHeight:1,
  };

  return (
    <div ref={containerRef} style={{ position:'relative' }}>
      <input
        ref={inputRef}
        type="text"
        readOnly
        className={`form-control ${error ? 'error' : ''}`}
        style={{ fontSize:13, cursor:'pointer', caretColor:'transparent' }}
        placeholder="Pick a date"
        value={displayText}
        onClick={() => setIsOpen(p => !p)}
      />

      {isOpen && rect && createPortal(
        <div ref={panelRef} style={{
          position:'fixed', top:panelTop, left:rect.left, zIndex:999999,
          background:'white', border:'1px solid #d1d5db', borderRadius:10,
          boxShadow:'0 8px 24px rgba(0,0,0,.14)', padding:'12px 14px',
          minWidth:280,
        }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
            <button type="button" onClick={prevMonth} style={navBtn}>◄</button>
            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
              <select value={viewMonth} onChange={e => setViewMonth(Number(e.target.value))}
                style={{ border:'none', fontWeight:700, fontSize:14, cursor:'pointer', outline:'none', background:'transparent', color:'#111827' }}>
                {EN_MONTHS.map((mn, i) => <option key={i+1} value={i+1}>{mn}</option>)}
              </select>
              <select value={viewYear} onChange={e => setViewYear(Number(e.target.value))}
                style={{ border:'none', fontWeight:700, fontSize:14, cursor:'pointer', outline:'none', background:'transparent', color:'#1a56db' }}>
                {Array.from({ length:111 }, (_, i) => (today.year - 100) + i).map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
              <button type="button" onClick={goToday}
                style={{ ...navBtn, fontSize:11, padding:'3px 8px', color:'#0e9f6e', borderColor:'#0e9f6e' }}>
                Today
              </button>
            </div>
            <button type="button" onClick={nextMonth} style={navBtn}>►</button>
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', marginBottom:4 }}>
            {EN_DAYS.map((d, i) => (
              <div key={d} style={{
                textAlign:'center', fontSize:11, fontWeight:700, padding:'3px 0',
                color: i===6 ? '#f05252' : i===0 ? '#e3a008' : '#6b7280',
              }}>
                {d}
              </div>
            ))}
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:1 }}>
            {cells.map((d, i) => {
              if (!d) return <div key={i} />;
              const future  = isFuture(d);
              const past    = isPast(d);
              const blocked = future || past || isBeforeMin(d) || isAfterMax(d);
              const isTod  = isToday(d);
              const sel    = isSel(d);
              const dow    = (startDow + d - 1) % 7;
              return (
                <button key={i} type="button" onClick={() => selectDate(d)} disabled={blocked}
                  style={{
                    border:'none', borderRadius:6, padding:'6px 2px',
                    fontSize:13, textAlign:'center', lineHeight:1,
                    cursor:     blocked ? 'not-allowed' : 'pointer',
                    background: sel   ? '#1a56db' : isTod ? '#0e9f6e' : 'transparent',
                    color:      sel || isTod ? 'white'
                              : blocked      ? '#d1d5db'
                              : dow===0      ? '#e3a008'
                              : dow===6      ? '#f05252'
                              :                '#1f2937',
                    fontWeight: sel || isTod ? 700 : 400,
                    transition: 'background .1s',
                  }}
                  onMouseEnter={e => { if (!sel && !isTod && !blocked) e.currentTarget.style.background='#f0f7ff'; }}
                  onMouseLeave={e => { if (!sel && !isTod && !blocked) e.currentTarget.style.background='transparent'; }}>
                  {d}
                </button>
              );
            })}
          </div>

          <div style={{ borderTop:'1px solid #f3f4f6', marginTop:8, paddingTop:6, fontSize:11, color:'#9ca3af', textAlign:'center' }}>
            {EN_MONTHS[viewMonth-1]} {viewYear} · {daysInMonth} days
          </div>
        </div>,
        document.body
      )}
    </div>
  );
});

export default EnglishDatePicker;
