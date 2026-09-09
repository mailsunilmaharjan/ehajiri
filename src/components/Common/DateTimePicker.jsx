import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';

// Same portal/positioning pattern as NepaliDatePicker.jsx (fixed-position
// popup escaped via a portal so a modal's own overflow:hidden never clips
// it, flips upward when there's no room below). Built because the native
// <input type="datetime-local"> picker it replaces is rendered entirely by
// the browser/OS — there's no way to restyle it to match the app.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const pad = (n) => String(n).padStart(2, '0');

const parseLocal = (v) => {
  if (!v) return null;
  const [datePart, timePart] = v.split('T');
  const [y, m, d] = (datePart || '').split('-').map(Number);
  const [hh, mm] = (timePart || '00:00').split(':').map(Number);
  if (!y || !m || !d) return null;
  return { y, m, d, hh: hh || 0, mm: mm || 0 };
};

/**
 * Custom date + time picker popup, styled to match the app instead of
 * relying on the browser's native <input type="datetime-local"> chrome.
 *
 * Props:
 *   value    – "YYYY-MM-DDTHH:mm" local string (same shape datetime-local uses)
 *   onChange – called with that same string shape (or '' when cleared)
 */
const DateTimePicker = ({ value, onChange, placeholder = 'Select date & time', error }) => {
  const now = new Date();
  const parsed = parseLocal(value);

  const [viewYear, setViewYear] = useState(parsed?.y || now.getFullYear());
  const [viewMonth, setViewMonth] = useState(parsed?.m || now.getMonth() + 1);
  const [isOpen, setIsOpen] = useState(false);
  const [rect, setRect] = useState(null);
  const [panelH, setPanelH] = useState(0);
  const containerRef = useRef();
  const panelRef = useRef();

  useEffect(() => {
    const p = parseLocal(value);
    if (p) { setViewYear(p.y); setViewMonth(p.m); }
  }, [value]);

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

  const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
  const startDow = new Date(viewYear, viewMonth - 1, 1).getDay();
  const cells = [...Array(startDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  const isToday = (d) => viewYear === now.getFullYear() && viewMonth === now.getMonth() + 1 && d === now.getDate();
  const isSel = (d) => parsed && viewYear === parsed.y && viewMonth === parsed.m && d === parsed.d;

  const commit = (y, m, d, hh, mm) => onChange(`${y}-${pad(m)}-${pad(d)}T${pad(hh)}:${pad(mm)}`);

  const hour24 = parsed?.hh ?? 9;
  const minute = parsed?.mm ?? 0;
  const isPM = hour24 >= 12;
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;

  const selectDate = (d) => commit(viewYear, viewMonth, d, hour24, minute);
  const setTime = (h12, mm, pm) => {
    let h24 = h12 % 12;
    if (pm) h24 += 12;
    commit(parsed?.y || viewYear, parsed?.m || viewMonth, parsed?.d || now.getDate(), h24, mm);
  };
  const goToday = () => {
    const n = new Date();
    setViewYear(n.getFullYear()); setViewMonth(n.getMonth() + 1);
    commit(n.getFullYear(), n.getMonth() + 1, n.getDate(), n.getHours(), n.getMinutes());
  };

  const displayText = parsed
    ? `${MONTHS[parsed.m - 1].slice(0, 3)} ${parsed.d}, ${parsed.y} · ${hour12}:${pad(parsed.mm)} ${isPM ? 'PM' : 'AM'}`
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
                {MONTHS.map((mn, i) => <option key={i + 1} value={i + 1}>{mn}</option>)}
              </select>
              <select value={viewYear} onChange={e => setViewYear(Number(e.target.value))} style={{ ...selStyle, color: '#1a56db' }}>
                {Array.from({ length: 11 }, (_, i) => now.getFullYear() - 5 + i).map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <button type="button" onClick={nextMonth} style={navBtn}>►</button>
          </div>

          {/* Day headers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', marginBottom: 4 }}>
            {DAYS.map((d, i) => (
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
                  {d}
                </button>
              );
            })}
          </div>

          {/* Time row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, borderTop: '1px solid #f3f4f6', paddingTop: 10 }}>
            <span style={{ fontSize: 13 }}>🕒</span>
            <select value={hour12} onChange={e => setTime(Number(e.target.value), minute, isPM)} style={{ ...selStyle, flex: 1 }}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map(h => <option key={h} value={h}>{pad(h)}</option>)}
            </select>
            <span style={{ color: '#9ca3af' }}>:</span>
            <select value={minute} onChange={e => setTime(hour12, Number(e.target.value), isPM)} style={{ ...selStyle, flex: 1 }}>
              {Array.from({ length: 60 }, (_, i) => i).map(m => <option key={m} value={m}>{pad(m)}</option>)}
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
              Today
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

export default DateTimePicker;
