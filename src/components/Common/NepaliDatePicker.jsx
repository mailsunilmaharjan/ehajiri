import React, { useState, useRef, useEffect, useLayoutEffect, forwardRef, useImperativeHandle } from 'react';
import { createPortal } from 'react-dom';
import { useSettings } from '../../context/SettingsContext.jsx';
import {
  adToBS, bsToAD, getBSDays, BS_MONTHS_NP, BS_MONTHS_EN, toNepaliDigits, formatDate, getNepalTodayISO,
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
 *   minDate    – (optional) AD ISO string — disable dates before this one
 *   maxDate    – (optional) AD ISO string — disable dates after this one
 */
const NepaliDatePicker = forwardRef(({ value, onChange, error, maxToday = false, minToday = false, minDate, maxDate }, ref) => {
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
  const inputRef      = useRef();
  const lastAD = useRef(value);

  // The trigger input is readOnly (typing does nothing), so "focus" for a
  // keyboard-shortcut jump means actually opening the calendar popup.
  useImperativeHandle(ref, () => ({ focus: () => { inputRef.current?.focus(); inputRef.current?.select?.(); } }));

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
  const cellISO     = (d) => adToISO(bsToAD(viewYear, viewMonth, d));
  const isBeforeMin = (d) => minDate && cellISO(d) < String(minDate).slice(0, 10);
  const isAfterMax  = (d) => maxDate && cellISO(d) > String(maxDate).slice(0, 10);
  const isToday = (d) =>
    viewYear === todayBs.year && viewMonth === todayBs.month && d === todayBs.day;
  const isSel   = (d) =>
    selected && viewYear === selected.year && viewMonth === selected.month && d === selected.day;

  const selectDate = (d) => {
    if (isFuture(d) || isPast(d) || isBeforeMin(d) || isAfterMax(d)) return;
    const ad = bsToAD(viewYear, viewMonth, d);
    if (!ad || isNaN(ad)) return;
    const iso = adToISO(ad);
    setSelected({ year:viewYear, month:viewMonth, day:d });
    lastAD.current = iso;
    onChange(iso);
    setIsOpen(false);
  };

  /* ── Typed entry (same behaviour as the Accounts BsDateInput) ──
     Day [2 digits] · Month [type "ka" → Kartik / pick from list / 1-12] · Year [4 digits].
     Valid, in-range dates are committed as soon as they're complete; the 📅 icon opens the calendar. */
  const MONTHS = settings.nepaliDigits ? BS_MONTHS_NP : BS_MONTHS_EN;
  const toLatin = (s) => String(s).replace(/[०-९]/g, c => '०१२३४५६७८९'.indexOf(c));
  const [dd, setDd] = useState('');
  const [mm, setMm] = useState(0);          // 1-12, 0 = none
  const [yy, setYy] = useState('');
  const [monText, setMonText] = useState(null); // text while the user types a month
  const [monOpen, setMonOpen] = useState(false);
  const [monHi, setMonHi] = useState(0);
  const [monRect, setMonRect] = useState(null);
  const monRef = useRef(); const yearRef = useRef();

  useEffect(() => {
    setDd(selected ? String(selected.day).padStart(2, '0') : '');
    setMm(selected ? selected.month : 0);
    setYy(selected ? String(selected.year) : '');
    setMonText(null);
  }, [selected]);

  const todayISO = getNepalTodayISO();
  const blockedISO = (iso) =>
    (maxToday && iso > todayISO) || (minToday && iso < todayISO) ||
    (minDate && iso < String(minDate).slice(0, 10)) || (maxDate && iso > String(maxDate).slice(0, 10));

  const commitTyped = (dStr, m, yStr) => {
    const d = Number(dStr), y = Number(yStr);
    if (!(d >= 1) || !(m >= 1 && m <= 12) || String(yStr).length !== 4 || y < 2000 || y > 2090) return false;
    const dd2 = Math.min(d, getBSDays(y, m) || 30);
    const ad = bsToAD(y, m, dd2);
    if (!ad || isNaN(ad)) return false;
    const iso = adToISO(ad);
    if (blockedISO(iso)) return false;
    setSelected({ year: y, month: m, day: dd2 });
    setViewYear(y); setViewMonth(m);
    lastAD.current = iso;
    if (iso !== value) onChange(iso);
    return true;
  };
  const revert = () => {
    setDd(selected ? String(selected.day).padStart(2, '0') : '');
    setMm(selected ? selected.month : 0);
    setYy(selected ? String(selected.year) : '');
    setMonText(null);
  };

  const matchMonths = (text) => {
    const t = String(toLatin(text || '')).trim().toLowerCase();
    const raw = String(text || '').trim();
    if (!t) return MONTHS.map((_, i) => i + 1);
    if (/^\d{1,2}$/.test(t)) { const n = Number(t); return n >= 1 && n <= 12 ? [n] : []; }
    const all = (names) => names.map((m, i) => [m, i + 1]);
    const starts = [...all(BS_MONTHS_EN), ...all(BS_MONTHS_NP)]
      .filter(([m]) => m.toLowerCase().startsWith(t) || m.startsWith(raw)).map(([, i]) => i);
    if (starts.length) return [...new Set(starts)];
    return [...new Set([...all(BS_MONTHS_EN), ...all(BS_MONTHS_NP)].filter(([m]) => m.toLowerCase().includes(t)).map(([, i]) => i))];
  };
  const monMatches = monOpen ? matchMonths(monText) : [];
  const pickMonth = (m, advance) => {
    setMm(m); setMonText(null); setMonOpen(false);
    const d = dd || (selected ? String(selected.day) : '1');
    if (!dd) setDd(String(d).padStart(2, '0'));
    commitTyped(d, m, yy);
    if (advance) setTimeout(() => { yearRef.current?.focus(); yearRef.current?.select(); }, 0);
  };
  const openMonthList = () => {
    if (monRef.current) { const r = monRef.current.getBoundingClientRect(); setMonRect({ left: r.left, top: r.bottom + 2 }); }
    setMonOpen(true); setMonHi(Math.max(0, mm - 1));
  };

  const seg = {
    border:'none', outline:'none', background:'transparent', padding:0, margin:0,
    fontSize:13, fontFamily:'inherit', color:'inherit', textAlign:'center', minWidth:0,
  };
  const sepStyle = { color:'#9ca3af', padding:'0 3px' };

  const navBtn = {
    background:'none', border:'1px solid #e5e7eb', borderRadius:6,
    padding:'4px 10px', cursor:'pointer', fontSize:13, color:'#374151', lineHeight:1,
  };

  return (
    <div ref={containerRef} style={{ position:'relative' }}>
      {/* Trigger input */}
      <div
        className={`form-control ${error ? 'error' : ''}`}
        style={{ fontSize:13, display:'flex', alignItems:'center', whiteSpace:'nowrap', overflow:'hidden' }}
      >
        <span role="button" aria-label="Open calendar" title="Open calendar"
          onClick={() => setIsOpen(p => !p)}
          style={{ fontSize:14, cursor:'pointer', marginRight:6 }}>📅</span>
        <input ref={inputRef} aria-label="Day" inputMode="numeric" maxLength={2} placeholder="DD"
          style={{ ...seg, width:'2.2ch' }}
          value={fmt(dd)}
          onFocus={e => e.target.select()}
          onChange={e => {
            const v = toLatin(e.target.value).replace(/\D/g, '').slice(0, 2);
            setDd(v);
            if (v.length === 2 && Number(v) >= 1 && mm && yy.length === 4) {
              commitTyped(v, mm, yy);
            }
            if (v.length === 2) { monRef.current?.focus(); }
          }}
          onBlur={() => {
            if (!dd && !selected) return;
            if (Number(dd) >= 1 && mm && yy.length === 4) {
              if (!commitTyped(dd, mm, yy)) revert();
            } else if (selected) revert();
          }}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); monRef.current?.focus(); } if (e.key === 'Escape') setIsOpen(false); }} />
        <span style={sepStyle}>-</span>
        <input ref={monRef} aria-label="Month" placeholder="Month" autoComplete="off"
          style={{ ...seg, width:`calc(${Math.max(String(monText ?? (mm ? MONTHS[mm-1] : '')).length, 5)}ch + 4px)` }}
          value={monText ?? (mm ? MONTHS[mm-1] : '')}
          onFocus={e => { e.target.select(); openMonthList(); }}
          onChange={e => { setMonText(e.target.value); setMonOpen(true); setMonHi(0); }}
          onKeyDown={e => {
            const list = matchMonths(monText);
            if (e.key === 'ArrowDown') { e.preventDefault(); setMonOpen(true); setMonHi(h => Math.min(h + 1, list.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setMonHi(h => Math.max(h - 1, 0)); }
            else if (e.key === 'Enter' || e.key === 'Tab') {
              const pick = list[monHi] ?? list[0];
              if (pick) { if (e.key === 'Enter') e.preventDefault(); pickMonth(pick, e.key === 'Enter'); }
            }
            else if (e.key === 'Escape' && monOpen) { e.preventDefault(); setMonOpen(false); setMonText(null); }
          }}
          onBlur={() => setTimeout(() => { setMonOpen(false); setMonText(null); }, 150)} />
        <span style={sepStyle}>-</span>
        <input ref={yearRef} aria-label="Year" inputMode="numeric" maxLength={4} placeholder="YYYY"
          style={{ ...seg, width:'4.4ch' }}
          value={fmt(yy)}
          onFocus={e => e.target.select()}
          onChange={e => {
            const v = toLatin(e.target.value).replace(/\D/g, '').slice(0, 4);
            setYy(v);
            if (v.length === 4 && dd && mm) commitTyped(dd, mm, v);
          }}
          onBlur={() => {
            if (Number(dd) >= 1 && mm && yy.length === 4) { if (!commitTyped(dd, mm, yy)) revert(); }
            else if (selected) revert();
          }}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (Number(dd) >= 1 && mm && yy.length === 4) commitTyped(dd, mm, yy); setIsOpen(false); } }} />
      </div>

      {monOpen && monRect && monMatches.length > 0 && (
        <ul style={{ position:'fixed', left:monRect.left, top:monRect.top, zIndex:1000000, margin:0, padding:0, listStyle:'none',
          background:'#fff', border:'1px solid #d1d5db', borderRadius:8, boxShadow:'0 8px 24px rgba(0,0,0,.14)',
          maxHeight:220, overflowY:'auto', minWidth:150, fontSize:13 }}>
          {monMatches.map((m, i) => (
            <li key={m} onMouseDown={e => { e.preventDefault(); pickMonth(m, true); }}
              style={{ padding:'5px 10px', cursor:'pointer', background: i === monHi ? '#eff6ff' : 'transparent', borderLeft: m === mm ? '3px solid #1a56db' : '3px solid transparent' }}>
              <span style={{ color:'#9ca3af', marginRight:8 }}>{String(m).padStart(2,'0')}</span>{MONTHS[m-1]}
            </li>
          ))}
        </ul>
      )}

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
              const blocked = future || past || isBeforeMin(d) || isAfterMax(d);
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
});

export default NepaliDatePicker;
