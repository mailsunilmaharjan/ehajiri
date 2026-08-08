import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useSettings } from '../../context/SettingsContext.jsx';
import {
  adToBS, bsToAD, getBSDays, BS_MONTHS_NP, toNepaliDigits, formatDate, getNepalTodayISO,
} from '../../utils/dateUtils.js';

const NP_DAYS = ['आइत','सोम','मंगल','बुध','बिही','शुक्र','शनि'];

export const adToISO = (d) =>
  d && !isNaN(d)
    ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    : '';

/**
 * Nepali (BS) calendar date-picker popup.
 *
 * Props:
 *   value      – AD ISO string (stored/output format)
 *   onChange   – called with AD ISO string on date selection
 *   error      – boolean, turns input border red
 *   maxToday   – (default false) disable future BS dates
 *   minToday   – (default false) disable past BS dates (yesterday or earlier)
 */
const NepaliDatePicker = ({ value, onChange, error, maxToday = false, minToday = false }) => {
  const { settings } = useSettings();
  const useNp = settings.nepaliDigits;
  const fmt   = (n) => useNp ? toNepaliDigits(n) : String(n);

  const todayBs  = adToBS(getNepalTodayISO()) || { year:2082, month:1, day:1 };
  const parseBs  = (v) => v ? adToBS(new Date(v)) || null : null;

  const [selected,  setSelected]  = useState(() => parseBs(value));
  const [viewYear,  setViewYear]  = useState(() => parseBs(value)?.year  || todayBs.year);
  const [viewMonth, setViewMonth] = useState(() => parseBs(value)?.month || todayBs.month);
  const [isOpen,    setIsOpen]    = useState(false);
  const [rect,      setRect]      = useState(null);
  const [panelH,    setPanelH]    = useState(0);
  const containerRef = useRef(); // trigger
  const panelRef      = useRef(); // portalled calendar panel
  const lastAD = useRef(value);

  useEffect(() => {
    if (value !== lastAD.current) {
      lastAD.current = value;
      const bs = parseBs(value);
      setSelected(bs);
      if (bs) { setViewYear(bs.year); setViewMonth(bs.month); }
    }
  }, [value]);

  /* Portalled to document.body (position:fixed) so the calendar isn't
     clipped by an ancestor's overflow:hidden — e.g. a modal card that uses
     overflow:hidden to keep its own rounded corners. */
  useEffect(() => {
    if (!isOpen) { setRect(null); return; }
    if (containerRef.current) {
      const r = containerRef.current.getBoundingClientRect();
      // Panel has minWidth:280 and no intrinsic edge-awareness — clamp so it
      // never overflows the right edge on narrow (phone-width) viewports.
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

  // Measure the panel's real height once it's mounted so we can decide
  // whether it fits below the trigger — fields near the bottom of a modal
  // (e.g. Recommended/Approved Date) otherwise get their calendar clipped
  // by the viewport edge. Flips upward only when there's no room below but
  // there is room above; every other picker keeps opening downward as before.
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

  /* month / year navigation */
  const prevMonth = () => {
    if (viewMonth===1) { setViewMonth(12); setViewYear(y => y-1); }
    else setViewMonth(m => m-1);
  };
  const nextMonth = () => {
    if (viewMonth===12) { setViewMonth(1); setViewYear(y => y+1); }
    else setViewMonth(m => m+1);
  };
  const goToday = () => { setViewYear(todayBs.year); setViewMonth(todayBs.month); };

  /* build grid */
  const daysInMonth = getBSDays(viewYear, viewMonth) || 30;
  const firstAD     = bsToAD(viewYear, viewMonth, 1);
  const startDow    = firstAD ? firstAD.getDay() : 0; // 0 = Sunday
  const cells = [
    ...Array(startDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const isFuture = (d) => maxToday && (
    viewYear > todayBs.year ||
    (viewYear === todayBs.year && viewMonth > todayBs.month) ||
    (viewYear === todayBs.year && viewMonth === todayBs.month && d > todayBs.day)
  );

  const isPast = (d) => minToday && (
    viewYear < todayBs.year ||
    (viewYear === todayBs.year && viewMonth < todayBs.month) ||
    (viewYear === todayBs.year && viewMonth === todayBs.month && d < todayBs.day)
  );
  const isToday = (d) =>
    viewYear === todayBs.year && viewMonth === todayBs.month && d === todayBs.day;
  const isSel   = (d) =>
    selected && viewYear === selected.year && viewMonth === selected.month && d === selected.day;

  const selectDate = (d) => {
    if (isFuture(d) || isPast(d)) return;
    const ad = bsToAD(viewYear, viewMonth, d);
    if (!ad || isNaN(ad)) return;
    const iso = adToISO(ad);
    setSelected({ year:viewYear, month:viewMonth, day:d });
    lastAD.current = iso;
    onChange(iso);
    setIsOpen(false);
  };

  /* display text using the app's date format setting */
  const displayText = value
    ? formatDate(value, {
        calendar:    settings.defaultCalendar   || 'np',
        format:      settings.defaultDateFormat || 'dd-MMM-yyyy',
        nepaliDigits: settings.nepaliDigits     || false,
      })
    : '';

  const navBtn = {
    background:'none', border:'1px solid #e5e7eb', borderRadius:6,
    padding:'4px 10px', cursor:'pointer', fontSize:13, color:'#374151', lineHeight:1,
  };

  return (
    <div ref={containerRef} style={{ position:'relative' }}>
      {/* Trigger input */}
      <input
        type="text"
        readOnly
        className={`form-control ${error ? 'error' : ''}`}
        style={{ fontSize:13, cursor:'pointer', caretColor:'transparent' }}
        placeholder="मिति छान्नुस् (BS)"
        value={displayText}
        onClick={() => setIsOpen(p => !p)}
      />

      {/* Calendar popup */}
      {isOpen && rect && createPortal(
        <div ref={panelRef} style={{
          position:'fixed', top:panelTop, left:rect.left, zIndex:999999,
          background:'white', border:'1px solid #d1d5db', borderRadius:10,
          boxShadow:'0 8px 24px rgba(0,0,0,.14)', padding:'12px 14px',
          minWidth:280,
        }}>
          {/* Month / Year navigation */}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
            <button type="button" onClick={prevMonth} style={navBtn}>◄</button>
            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
              <select value={viewMonth} onChange={e => setViewMonth(Number(e.target.value))}
                style={{ border:'none', fontWeight:700, fontSize:14, cursor:'pointer', outline:'none', background:'transparent', color:'#111827' }}>
                {BS_MONTHS_NP.map((mn, i) => <option key={i+1} value={i+1}>{mn}</option>)}
              </select>
              <select value={viewYear} onChange={e => setViewYear(Number(e.target.value))}
                style={{ border:'none', fontWeight:700, fontSize:14, cursor:'pointer', outline:'none', background:'transparent', color:'#1a56db' }}>
                {Array.from({ length:91 }, (_, i) => 2000+i).map(y => (
                  <option key={y} value={y}>{fmt(y)}</option>
                ))}
              </select>
              <button type="button" onClick={goToday}
                style={{ ...navBtn, fontSize:11, padding:'3px 8px', color:'#0e9f6e', borderColor:'#0e9f6e' }}>
                आज
              </button>
            </div>
            <button type="button" onClick={nextMonth} style={navBtn}>►</button>
          </div>

          {/* Day headers */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', marginBottom:4 }}>
            {NP_DAYS.map((d, i) => (
              <div key={d} style={{
                textAlign:'center', fontSize:11, fontWeight:700, padding:'3px 0',
                color: i===6 ? '#f05252' : i===0 ? '#e3a008' : '#6b7280',
              }}>
                {d}
              </div>
            ))}
          </div>

          {/* Day cells */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:1 }}>
            {cells.map((d, i) => {
              if (!d) return <div key={i} />;
              const future  = isFuture(d);
              const past    = isPast(d);
              const blocked = future || past;
              const today  = isToday(d);
              const sel    = isSel(d);
              const dow    = (startDow + d - 1) % 7;
              return (
                <button key={i} type="button" onClick={() => selectDate(d)} disabled={blocked}
                  style={{
                    border:'none', borderRadius:6, padding:'6px 2px',
                    fontSize:13, textAlign:'center', lineHeight:1,
                    cursor:     blocked ? 'not-allowed' : 'pointer',
                    background: sel   ? '#1a56db' : today ? '#0e9f6e' : 'transparent',
                    color:      sel || today ? 'white'
                              : blocked      ? '#d1d5db'
                              : dow===0      ? '#e3a008'
                              : dow===6      ? '#f05252'
                              :                '#1f2937',
                    fontWeight: sel || today ? 700 : 400,
                    transition: 'background .1s',
                  }}
                  onMouseEnter={e => { if (!sel && !today && !blocked) e.currentTarget.style.background='#f0f7ff'; }}
                  onMouseLeave={e => { if (!sel && !today && !blocked) e.currentTarget.style.background='transparent'; }}>
                  {fmt(d)}
                </button>
              );
            })}
          </div>

          {/* Footer */}
          <div style={{ borderTop:'1px solid #f3f4f6', marginTop:8, paddingTop:6, fontSize:11, color:'#9ca3af', textAlign:'center' }}>
            {fmt(viewYear)}-{BS_MONTHS_NP[viewMonth-1]}&nbsp;·&nbsp;{fmt(daysInMonth)} दिन
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default NepaliDatePicker;
