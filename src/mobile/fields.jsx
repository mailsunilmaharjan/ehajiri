import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSettings } from '../context/SettingsContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import useDateFormat from '../hooks/useDateFormat.js';
import Avatar from '../components/Common/Avatar.jsx';
import { getNepalTodayISO, adToBS, bsToAD, getBSDays, BS_MONTHS_EN, BS_MONTHS_NP, toNepaliDigits } from '../utils/dateUtils.js';
import { Icon, useMT } from './kit.jsx';

/* Building blocks for the phone forms: a full-width calendar (Nepali BS or English AD, per the company setting), a one-tap
   approver chooser, and a plain "HH:MM" time box. */

const pad = (n) => String(n).padStart(2, '0');
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const WD_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WD_NP = ['आइत', 'सोम', 'मंगल', 'बुध', 'बिही', 'शुक्र', 'शनि'];
const AD_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The calendar itself - a bottom sheet that uses the whole screen width, with big tappable day cells. */
function CalendarSheet({ value, min, max, cal, onPick, onClose }) {
  const mt = useMT();
  const { language } = useLanguage();
  const np = cal === 'np';
  const today = getNepalTodayISO();
  const start = value || today;
  const [view, setView] = useState(() => {
    if (np) { const b = adToBS(start); return { y: b.year, m: b.month }; }
    const d = new Date(start + 'T00:00:00'); return { y: d.getFullYear(), m: d.getMonth() + 1 };
  });
  const digits = (n) => (language === 'np' ? toNepaliDigits(n) : String(n));

  const { cells, title } = useMemo(() => {
    const out = [];
    let first, count, name;
    if (np) { first = bsToAD(view.y, view.m, 1); count = getBSDays(view.y, view.m); name = `${(language === 'np' ? BS_MONTHS_NP : BS_MONTHS_EN)[view.m - 1]} ${digits(view.y)}`; }
    else { first = new Date(view.y, view.m - 1, 1); count = new Date(view.y, view.m, 0).getDate(); name = `${AD_MONTHS[view.m - 1]} ${view.y}`; }
    for (let i = 0; i < first.getDay(); i++) out.push(null);
    for (let d = 1; d <= count; d++) { const ad = new Date(first.getFullYear(), first.getMonth(), first.getDate() + d - 1); out.push({ d, iso: isoOf(ad) }); }
    return { cells: out, title: name };
  }, [view, np, language]); // eslint-disable-line react-hooks/exhaustive-deps

  const step = (dm) => setView(v => { let m = v.m + dm, y = v.y; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; } return { y, m }; });
  const goToday = () => { if (np) { const b = adToBS(today); setView({ y: b.year, m: b.month }); } else { const d = new Date(today + 'T00:00:00'); setView({ y: d.getFullYear(), m: d.getMonth() + 1 }); } };
  const off = (iso) => (min && iso < min) || (max && iso > max);

  return createPortal(
    <div className="m-cal-back" onClick={onClose}>
      <div className="m-cal" onClick={e => e.stopPropagation()} role="dialog" aria-label="Calendar">
        <div className="m-sheet-grab" />
        <div className="m-cal-head">
          <button type="button" onClick={() => step(-12)} aria-label="Previous year">«</button>
          <button type="button" onClick={() => step(-1)} aria-label="Previous month">‹</button>
          <b>{title}</b>
          <button type="button" onClick={() => step(1)} aria-label="Next month">›</button>
          <button type="button" onClick={() => step(12)} aria-label="Next year">»</button>
        </div>
        <div className="m-cal-grid m-cal-wd">{(language === 'np' ? WD_NP : WD_EN).map((w, i) => <span key={w} className={i === 6 ? 'sat' : ''}>{w}</span>)}</div>
        <div className="m-cal-grid">
          {cells.map((c, i) => c
            ? <button type="button" key={c.iso} disabled={off(c.iso)}
                className={`m-cal-day${c.iso === value ? ' sel' : ''}${c.iso === today ? ' today' : ''}${(i % 7) === 6 ? ' sat' : ''}`}
                onClick={() => onPick(c.iso)}>{digits(c.d)}</button>
            : <span key={`e${i}`} />)}
        </div>
        <div className="m-cal-foot">
          <button type="button" className="m-btn m-ghost" onClick={onClose}>{mt('Cancel')}</button>
          <button type="button" className="m-btn" disabled={off(today)} onClick={() => { goToday(); onPick(today); }}>{mt('Today')}</button>
        </div>
      </div>
    </div>,
    document.body);
}

/** A date box: shows the date in the company's format; tapping opens the big calendar. */
export function DateField({ label, value, onChange, min, max, required, error }) {
  const { settings } = useSettings();
  const fd = useDateFormat();
  const [open, setOpen] = useState(false);
  const cal = settings.defaultCalendar === 'np' ? 'np' : 'en';
  return (
    <div className="m-field">
      {label && <label>{label}{required && <span style={{ color: '#dc2626' }}> *</span>}</label>}
      <button type="button" className={`m-input m-datebtn${error ? ' err' : ''}`} onClick={() => setOpen(true)}>
        <span>{value ? fd(value) : '—'}</span><Icon name="cal" size={20} />
      </button>
      {error && <div className="m-ferr">{error}</div>}
      {open && <CalendarSheet value={value} min={min} max={max} cal={cal} onClose={() => setOpen(false)} onPick={(iso) => { onChange(iso); setOpen(false); }} />}
    </div>
  );
}

/** One person is shown ticked automatically; several are listed to tap on. */
export function PersonPick({ label, ids, getEmp, value, onChange, required, error }) {
  const mt = useMT();
  const list = (ids || []).map(String);
  return (
    <div className="m-field">
      <label>{label}{required && <span style={{ color: '#dc2626' }}> *</span>}</label>
      {list.length === 0 && <div className="m-person none">{mt('— Not configured —')}</div>}
      {list.map(id => {
        const e = getEmp(id);
        const on = String(value) === id;
        return (
          <button type="button" key={id} className={`m-person${on ? ' on' : ''}`} onClick={() => list.length > 1 && onChange(id)} disabled={list.length === 1}>
            <Avatar photo={e?.profilePhoto} name={e?.fullName || '#'} size={36} preview={false} />
            <span className="m-grow"><b>{e?.fullName || `#${id}`}</b><small>{[e?.position, e?.department].filter(Boolean).join(' · ')}</small></span>
            <span className="m-person-tick">{on ? <Icon name="check" size={18} /> : null}</span>
          </button>
        );
      })}
      {error && <div className="m-ferr">{error}</div>}
    </div>
  );
}

/** Plain-text time box, "HH:MM" (24 hour). Typing 1030 becomes 10:30. */
export const cleanTime = (s) => {
  const d = String(s || '').replace(/\D/g, '').slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d;
};
export const validTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s || '');
export function TimeText({ label, value, onChange, required, error, placeholder = 'HH:MM', right }) {
  return (
    <div className="m-field">
      {label && <label>{label}{required && <span style={{ color: '#dc2626' }}> *</span>}</label>}
      <div className="m-pw">
        <input className={`m-input${error ? ' err' : ''}`} inputMode="numeric" autoComplete="off" placeholder={placeholder} maxLength={5}
          value={value || ''} onChange={e => onChange(cleanTime(e.target.value))} style={right ? { paddingRight: 96 } : undefined} />
        {right}
      </div>
      {error && <div className="m-ferr">{error}</div>}
    </div>
  );
}
