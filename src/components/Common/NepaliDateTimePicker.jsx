import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useSettings } from '../../context/SettingsContext.jsx';
import {
  adToBS, bsToAD, getBSDays, BS_MONTHS_NP, toNepaliDigits, formatDate, getNepalTodayISO,
} from '../../utils/dateUtils.js';

const NP_DAYS = ['आइत', 'सोम', 'मंगल', 'बुध', 'बिही', 'शुक्र', 'शनि'];
const pad = (n) => String(n).padStart(2, '0');

const parseLocal = (v) => {
  if (!v) return null;
  const [datePart, timePart] = v.split('T');
  if (!datePart) return null;
  const [hh, mm] = (timePart || '00:00').split(':').map(Number);
  return { datePart, hh: hh || 0, mm: mm || 0 };
};

/**
 * Same value/onChange contract as DateTimePicker.jsx ("YYYY-MM-DDTHH:mm" AD
 * local string, same shape a native datetime-local input uses) — only the
 * calendar grid, month/year navigation and display text are BS (Bikram
 * Sambat), same convention NepaliDatePicker.jsx already applies to date-only
 * fields. Used wherever a date+time field (e.g. Task's "Next Followup &
 * Time") needs to switch to Nepali the same way every date-only field
 * already does when Settings → Default Calendar is "np".
 *
 * Props:
 *   value    – "YYYY-MM-DDTHH:mm" AD local string (same as DateTimePicker)
 *   onChange – called with that same string shape (or '' when cleared)
 */
const NepaliDateTimePicker = ({ value, onChange, placeholder = 'मिति र समय छान्नुस्', error }) => {
  const { settings } = useSettings();
  const useNp = settings.nepaliDigits;
  const fmt = (n) => useNp ? toNepaliDigits(n) : String(n);

  const todayBs = adToBS(getNepalTodayISO()) || { year: 2082, month: 1, day: 1 };
  const parsed = parseLocal(value);
  const parsedBs = parsed ? adToBS(parsed.datePart) : null;

  const [viewYear, setViewYear] = useState(() => parsedBs?.year || todayBs.year);
  const [viewMonth, setViewMonth] = useState(() => parsedBs?.month || todayBs.month);
  const [isOpen, setIsOpen] = useState(false);
  const [rect, setRect] = useState(null);
  const [panelH, setPanelH] = useState(0);
  const containerRef = useRef();
  const panelRef = useRef();
  const lastValue = useRef(value);

  useEffect(() => {
    if (value !== lastValue.current) {
      lastValue.current = value;
      const p = parseLocal(value);
      const bs = p ? adToBS(p.datePart) : null;
      if (bs) { setViewYear(bs.year); setViewMonth(bs.month); }
    }
  }, [value]);

  // Same portal/positioning pattern as NepaliDatePicker.jsx / DateTimePicker.jsx.
  useEffect(() => {
    if (!isOpen) { setRect(null); return; }
    if (containerRef.current) {
      const r = containerRef.current.getBoundingClientRect();
      const PANEL_W = 300;
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
  const panelTop = rect ? (openUpward ? rect.triggerTop - panelH - 4 : rect.triggerBottom + 4) : 0;

  const prevMonth = () => { if (viewMonth === 1) { setViewMonth(12); setViewYear(y => y - 1); } else setViewMonth(m => m - 1); };
  const nextMonth = () => { if (viewMonth === 12) { setViewMonth(1); setViewYear(y => y + 1); } else setViewMonth(m => m + 1); };

  const daysInMonth = getBSDays(viewYear, viewMonth) || 30;
  const firstAD = bsToAD(viewYear, viewMonth, 1);
  const startDow = firstAD ? firstAD.getDay() : 0;
  const cells = [...Array(startDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  const isToday = (d) => viewYear === todayBs.year && viewMonth === todayBs.month && d === todayBs.day;
  const isSel = (d) => parsedBs && viewYear === parsedBs.year && viewMonth === parsedBs.month && d === parsedBs.day;

  const commit = (bsY, bsM, bsD, hh, mm) => {
    const ad = bsToAD(bsY, bsM, bsD);
    if (!ad || isNaN(ad)) return;
    const iso = `${ad.getFullYear()}-${pad(ad.getMonth() + 1)}-${pad(ad.getDate())}`;
    onChange(`${iso}T${pad(hh)}:${pad(mm)}`);
  };

  const hour24 = parsed?.hh ?? 9;
  const minute = parsed?.mm ?? 0;
  const isPM = hour24 >= 12;
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;

  const selectDate = (d) => commit(viewYear, viewMonth, d, hour24, minute);
  const setTime = (h12, mm, pm) => {
    let h24 = h12 % 12;
    if (pm) h24 += 12;
    commit(parsedBs?.year || viewYear, parsedBs?.month || viewMonth, parsedBs?.day || todayBs.day, h24, mm);
  };
  const goToday = () => {
    setViewYear(todayBs.year); setViewMonth(todayBs.month);
    const n = new Date();
    commit(todayBs.year, todayBs.month, todayBs.day, n.getHours(), n.getMinutes());
  };

  const displayText = parsed
    ? `${formatDate(parsed.datePart, { calendar: 'np', format: settings.defaultDateFormat || 'dd-MMM-yyyy', nepaliDigits: useNp })} · ${fmt(pad(hour12))}:${fmt(pad(minute))} ${isPM ? 'PM' : 'AM'}`
    : '';

  const navBtn = { background: 'none', border: '1px solid #e5e7eb', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 13, color: '#374151', lineHeight: 1 };
  const selStyle = { border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 13, padding: '4px 6px', cursor: 'pointer', outline: 'none', background: 'white', color: '#111827', fontWeight: 600 };

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <input type="text" readOnly className={`form-control ${error ? 'error' : ''}`}
        style={{ fontSize: 13, cursor: 'pointer', caretColor: 'transparent' }}
        placeholder={placeholder} value={displayText}
        onClick={() => setIsOpen(p => !p)} />

      {isOpen && rect && createPortal(
        <div ref={panelRef} style={{
          position: 'fixed', top: panelTop, left: rect.left, zIndex: 999999,
          background: 'white', border: '1px solid #d1d5db', borderRadius: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,.14)', padding: '12px 14px', width: 300, boxSizing: 'border-box',
        }}>
          {/* Month / Year navigation */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <button type="button" onClick={prevMonth} style={navBtn}>◄</button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <select value={viewMonth} onChange={e => setViewMonth(Number(e.target.value))} style={selStyle}>
                {BS_MONTHS_NP.map((mn, i) => <option key={i + 1} value={i + 1}>{mn}</option>)}
              </select>
              <select value={viewYear} onChange={e => setViewYear(Number(e.target.value))} style={{ ...selStyle, color: '#1a56db' }}>
                {Array.from({ length: 91 }, (_, i) => 2000 + i).map(y => <option key={y} value={y}>{fmt(y)}</option>)}
              </select>
            </div>
            <button type="button" onClick={nextMonth} style={navBtn}>►</button>
          </div>

          {/* Day headers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', marginBottom: 4 }}>
            {NP_DAYS.map((d, i) => (
              <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, padding: '3px 0',
                color: i === 0 ? '#e3a008' : i === 6 ? '#f05252' : '#6b7280' }}>{d}</div>
            ))}
          </div>

          {/* Day cells */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 1, marginBottom: 10 }}>
            {cells.map((d, i) => {
              if (!d) return <div key={i} />;
              const today = isToday(d);
              const sel = isSel(d);
              const dow = (startDow + d - 1) % 7;
              return (
                <button key={i} type="button" onClick={() => selectDate(d)}
                  style={{
                    border: 'none', borderRadius: 6, padding: '6px 2px', fontSize: 13, textAlign: 'center', lineHeight: 1,
                    cursor: 'pointer',
                    background: sel ? '#1a56db' : today ? '#e0f2fe' : 'transparent',
                    color: sel ? 'white' : today ? '#0369a1' : dow === 0 ? '#e3a008' : dow === 6 ? '#f05252' : '#1f2937',
                    fontWeight: sel || today ? 700 : 400,
                    transition: 'background .1s',
                  }}
                  onMouseEnter={e => { if (!sel) e.currentTarget.style.background = '#f0f7ff'; }}
                  onMouseLeave={e => { if (!sel) e.currentTarget.style.background = today ? '#e0f2fe' : 'transparent'; }}>
                  {fmt(d)}
                </button>
              );
            })}
          </div>

          {/* Time row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, borderTop: '1px solid #f3f4f6', paddingTop: 10 }}>
            <span style={{ fontSize: 13 }}>🕒</span>
            <select value={hour12} onChange={e => setTime(Number(e.target.value), minute, isPM)} style={{ ...selStyle, flex: 1 }}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map(h => <option key={h} value={h}>{fmt(pad(h))}</option>)}
            </select>
            <span style={{ color: '#9ca3af' }}>:</span>
            <select value={minute} onChange={e => setTime(hour12, Number(e.target.value), isPM)} style={{ ...selStyle, flex: 1 }}>
              {Array.from({ length: 60 }, (_, i) => i).map(m => <option key={m} value={m}>{fmt(pad(m))}</option>)}
            </select>
            <div style={{ display: 'flex', border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden', flexShrink: 0 }}>
              {['AM', 'PM'].map(p => (
                <button key={p} type="button" onClick={() => setTime(hour12, minute, p === 'PM')}
                  style={{ border: 'none', padding: '5px 9px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
                    background: (p === 'PM') === isPM ? '#1a56db' : 'white',
                    color: (p === 'PM') === isPM ? 'white' : '#6b7280' }}>
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Footer actions */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, paddingTop: 8, borderTop: '1px solid #f3f4f6' }}>
            <button type="button" onClick={() => { onChange(''); setIsOpen(false); }}
              style={{ background: 'none', border: 'none', color: '#dc2626', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
              Clear
            </button>
            <button type="button" onClick={goToday}
              style={{ background: 'none', border: 'none', color: '#0e9f6e', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
              आज
            </button>
            <button type="button" onClick={() => setIsOpen(false)}
              style={{ background: '#1a56db', border: 'none', color: 'white', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                padding: '5px 14px', borderRadius: 6 }}>
              Done
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default NepaliDateTimePicker;
