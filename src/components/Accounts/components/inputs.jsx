import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { adToBs, altDate, bsToAd, BS_DATA, BS_MAX, BS_MIN, BS_MONTHS, fmtAd, fmtDate } from '../lib/dates';

/** Money box with Nepali grouping while typing: 10,000 · 1,00,000 · 12,34,567.50.
 *  onChange gets the plain number text (no commas) in e.target.value, like a normal input. */
export function Amount({ value, onChange, decimals = 2, type, min, max, step, ...rest }) {
  const ref = useRef(null);
  const show = (raw) => {
    if (raw === '' || raw == null) return '';
    const s = String(raw);
    const [i, d] = s.split('.');
    const whole = i === '' ? (d !== undefined ? '0' : '') : Number(i).toLocaleString('en-IN');
    return whole + (d !== undefined ? `.${d}` : '');
  };
  const handle = (e) => {
    const el = e.target;
    const caret = el.selectionStart ?? el.value.length;
    const keep = el.value.slice(0, caret).replace(/[^\d.]/g, '').length;     // digits left of the caret
    let raw = el.value.replace(/[^\d.]/g, '');
    const dot = raw.indexOf('.');
    if (dot >= 0) raw = decimals ? `${raw.slice(0, dot)}.${raw.slice(dot + 1).replace(/\./g, '').slice(0, decimals)}` : raw.slice(0, dot);
    raw = raw.replace(/^0+(?=\d)/, '');
    onChange?.({ target: { value: raw } });
    requestAnimationFrame(() => {        // put the caret back after the same number of digits
      const v = ref.current?.value || '';
      let n = 0; let pos = 0;
      if (keep > 0) { pos = v.length; for (let k = 0; k < v.length; k += 1) { if (/[\d.]/.test(v[k])) n += 1; if (n === keep) { pos = k + 1; break; } } }
      try { ref.current?.setSelectionRange(pos, pos); } catch { /* not focused */ }
    });
  };
  return <input ref={ref} type="text" inputMode="decimal" autoComplete="off" data-nocap {...rest} value={show(value)} onChange={handle} />;
}

/** A date in the default calendar; hover shows the other one. */
export const D = ({ iso }) => (iso ? <span className="date-hover" title={altDate(iso)}>{fmtDate(iso)}</span> : null);
import { focusNext } from '../lib/keys';
import { api, fmtStamp } from '../lib/api';

/** "Created by … · Last saved by … on …" footer for edit forms */
export function LastSaved({ row }) {
  if (!row || (!row.created_by && !row.updated_by)) return null;
  return (
    <div className="last-saved">
      {row.created_by && <span>Created by <b>{row.created_by}</b>{row.created_at && ` · ${fmtStamp(row.created_at)}`}</span>}
      {row.updated_by && <span>Last saved by <b>{row.updated_by}</b>{row.updated_at && ` · ${fmtStamp(row.updated_at)}`}</span>}
    </div>
  );
}

/** Small line icons for grid action buttons (always render, no emoji font needed). */
const ICONS = {
  view: 'M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12zm11 3a3 3 0 100-6 3 3 0 000 6z',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
  delete: 'M4 7h16M9 7V4h6v3m-8 0l1 13h8l1-13M10 11v6M14 11v6',
};
export const Ico = ({ name }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={ICONS[name]} /></svg>
);

/** Small hint shown on buttons: Save (Ctrl+S) */
export const Kbd = ({ children }) => <kbd className="kbd">{children}</kbd>;

const pad2 = (n) => String(n).padStart(2, '0');

/** Find a month from typed text: "ka" → Kartik, "7" → Kartik, "mag" → Magh. Returns 1-12 or null. */
function matchMonths(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return BS_MONTHS.map((_, i) => i + 1);
  if (/^\d{1,2}$/.test(t)) { const n = Number(t); return n >= 1 && n <= 12 ? [n] : []; }
  const starts = BS_MONTHS.map((m, i) => [m, i + 1]).filter(([m]) => m.toLowerCase().startsWith(t)).map(([, i]) => i);
  if (starts.length) return starts;
  return BS_MONTHS.map((m, i) => [m, i + 1]).filter(([m]) => m.toLowerCase().includes(t)).map(([, i]) => i);
}

/** Click-to-open BS month calendar for BsDateInput's 📅 icon. value / onPick use AD ISO strings. */
function BsCalendar({ value, anchor, onPick, onClose }) {
  const b0 = adToBs(value) || { year: 2083, month: 1, day: 1 };
  const [vy, setVy] = useState(b0.year);
  const [vm, setVm] = useState(b0.month);
  const ref = useRef(null);
  const r = anchor.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.left, window.innerWidth - 268));
  const below = r.bottom + 4 + 290 <= window.innerHeight || r.top < 300;
  useEffect(() => {
    const down = (e) => { if (!ref.current?.contains(e.target) && !anchor.contains(e.target)) onClose(); };
    const key = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [anchor, onClose]);
  const step = (d) => { let m = vm + d; let y = vy; if (m < 1) { m = 12; y -= 1; } if (m > 12) { m = 1; y += 1; } if (BS_DATA[y]) { setVm(m); setVy(y); } };
  const days = BS_DATA[vy][vm - 1];
  const first = new Date(`${bsToAd(vy, vm, 1)}T00:00:00`).getDay();
  const cells = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const today = adToBs(new Date().toISOString().slice(0, 10));
  const sel = adToBs(value);
  const btn = { border: '1px solid #e5e7eb', background: '#fff', borderRadius: 6, padding: '2px 9px', cursor: 'pointer' };
  return createPortal(
    <div ref={ref} style={{ position: 'fixed', zIndex: 999999, left, top: below ? r.bottom + 4 : Math.max(8, r.top - 294), width: 260, background: '#fff', border: '1px solid #d1d5db', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.16)', padding: 10, font: '13px system-ui, sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 4 }}>
        <button type="button" style={btn} onClick={() => step(-1)}>◄</button>
        <select value={vm} onChange={(e) => setVm(Number(e.target.value))} style={{ border: 'none', fontWeight: 700, background: 'transparent' }}>
          {BS_MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
        <select value={vy} onChange={(e) => setVy(Number(e.target.value))} style={{ border: 'none', fontWeight: 700, color: '#1a56db', background: 'transparent' }}>
          {Object.keys(BS_DATA).map(Number).sort((a, c) => c - a).map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <button type="button" style={btn} onClick={() => step(1)}>►</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 1, textAlign: 'center' }}>
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => <div key={d} style={{ fontSize: 11, fontWeight: 700, color: i === 6 ? '#f05252' : '#6b7280', padding: '2px 0' }}>{d}</div>)}
        {cells.map((d, i) => {
          if (!d) return <div key={`e${i}`} />;
          const isSel = sel && sel.year === vy && sel.month === vm && sel.day === d;
          const isToday = today && today.year === vy && today.month === vm && today.day === d;
          return (
            <button key={d} type="button" onClick={() => { onPick(bsToAd(vy, vm, d)); onClose(); }}
              style={{ border: 'none', borderRadius: 6, padding: '6px 0', cursor: 'pointer', background: isSel ? '#1a56db' : isToday ? '#0e9f6e' : 'transparent', color: isSel || isToday ? '#fff' : (i % 7 === 6 ? '#f05252' : '#1f2937'), fontWeight: isSel || isToday ? 700 : 400 }}>{d}</button>
          );
        })}
      </div>
    </div>, document.body);
}

/**
 * Type a Nepali (BS) date: Day [number] · Month [type “ka” → Kartik, pick from the short list] · Year [number].
 * Enter moves Day → Month → Year → next field. value / onChange use AD ISO strings.
 */
export function BsDateInput({ value, onChange, showAd = true, autoFocus = false }) {
  const b = adToBs(value) || { year: 2083, month: 1, day: 1 };
  const [day, setDay] = useState(pad2(b.day));
  const [mon, setMon] = useState(BS_MONTHS[b.month - 1]);
  const [year, setYear] = useState(String(b.year));
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [calOpen, setCalOpen] = useState(false);
  const icoRef = useRef(null);
  const dayRef = useRef(null);
  const latest = useRef(value);
  latest.current = value;
  const cur = () => adToBs(latest.current) || b;

  // follow outside changes (e.g. FY button, edit loaded)
  useEffect(() => { setDay(pad2(b.day)); setMon(BS_MONTHS[b.month - 1]); setYear(String(b.year)); }, [value]);
  useEffect(() => { if (autoFocus) setTimeout(() => { dayRef.current?.focus(); dayRef.current?.select(); }, 60); }, [autoFocus]);

  const commit = (d, m, y) => {
    if (!BS_DATA[y] || !(m >= 1 && m <= 12) || !(d >= 1)) return;
    const max = BS_DATA[y][m - 1];
    const iso = bsToAd(y, m, Math.min(d, max));
    if (iso && iso !== value) onChange(iso);
  };
  const matches = matchMonths(mon === BS_MONTHS[b.month - 1] ? '' : mon);
  const pickMonth = (m) => { setMon(BS_MONTHS[m - 1]); setOpen(false); commit(Number(day) || b.day, m, Number(year) || b.year); };
  const sel = (e) => e.target.select();

  return (
    <span className="bsd" data-nocap>
      <span className="bsd-ico" ref={icoRef} role="button" aria-label="Open calendar" title="Open calendar" style={{ cursor: 'pointer' }}
        onClick={() => setCalOpen((o) => !o)}>📅</span>
      {calOpen && icoRef.current && <BsCalendar value={value} anchor={icoRef.current} onPick={(iso) => iso && iso !== value && onChange(iso)} onClose={() => setCalOpen(false)} />}
      <input ref={dayRef} className="bsd-day" aria-label="Day" inputMode="numeric" maxLength={2} value={day} placeholder="DD" onFocus={sel}
        onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 2); setDay(v); if (v.length === 2 && Number(v) >= 1) commit(Number(v), b.month, b.year); }}
        onBlur={() => {   // one digit typed ("5") is saved when leaving the box
          const d = Number(day); const c = cur();
          if (d >= 1) { const max = BS_DATA[c.year]?.[c.month - 1] || 32; commit(d, c.month, c.year); setDay(pad2(Math.min(d, max))); } else setDay(pad2(c.day));
        }} />
      <span className="bsd-sep">-</span>
      <span className="bsd-mwrap">
        <input className="bsd-mon" aria-label="Month" value={mon} placeholder="Month"
          style={{ width: `calc(${Math.max(String(mon || '').length, 4)}ch + 10px)` }}
          onFocus={(e) => { e.target.select(); setOpen(true); setHi(Math.max(0, b.month - 1)); }}
          onChange={(e) => { setMon(e.target.value); setOpen(true); setHi(0); }}
          onKeyDown={(e) => {
            const list = matchMonths(mon === BS_MONTHS[b.month - 1] ? '' : mon);
            if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, list.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
            else if (e.key === 'Enter' || e.key === 'Tab') { if (list[hi] || list[0]) pickMonth(list[hi] || list[0]); }   // Enter then moves to Year
            else if (e.key === 'Escape' && open) { e.preventDefault(); setOpen(false); setMon(BS_MONTHS[b.month - 1]); }
          }}
          onBlur={() => setTimeout(() => { setOpen(false); setMon(BS_MONTHS[cur().month - 1]); }, 150)} />
        {open && matches.length > 0 && (
          <ul className="bsd-list">
            {matches.map((m, i) => (
              <li key={m} className={i === hi ? 'hi' : ''} onMouseDown={(e) => { e.preventDefault(); pickMonth(m); }}>
                <span className="bsd-mn">{pad2(m)}</span>{BS_MONTHS[m - 1]}
              </li>
            ))}
          </ul>
        )}
      </span>
      <span className="bsd-sep">-</span>
      <input className="bsd-year" aria-label="Year" inputMode="numeric" maxLength={4} value={year} placeholder="YYYY" onFocus={sel}
        onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 4); setYear(v); if (v.length === 4 && BS_DATA[Number(v)]) commit(b.day, b.month, Number(v)); }}
        onBlur={() => setYear(String(cur().year))} />
      {showAd && <span className="bsd-ad" title="English date (AD)">{fmtAd(value)}</span>}
    </span>
  );
}

/** Searchable ledger picker. accounts = [{id, code, name, group_name}] */
export function AccountSelect({ accounts, value, onChange, placeholder = 'Search ledger…', filter, onEmptyEnter, onAdd, autoFocus }) {
  const list = useMemo(() => (filter ? accounts.filter(filter) : accounts), [accounts, filter]);
  const current = list.find((a) => a.id === value) || accounts.find((a) => a.id === value);
  // A party that is both customer and supplier has two ledgers with the same name — tell them apart (only when both are in this list)
  const dupNames = useMemo(() => {
    const c = new Map();
    for (const a of list) if (a.linked_party_id) c.set(a.name, (c.get(a.name) || 0) + 1);
    return c;
  }, [list]);
  const label = (a) => (a && a.linked_party_id && dupNames.get(a.name) > 1 ? `${a.name} (${a.party_type === 'supplier' ? 'Supplier' : 'Customer'})` : a?.name);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const box = useRef(null);

  useEffect(() => {
    const close = (e) => box.current && !box.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    const m = s ? list.filter((a) => `${a.name} ${a.code} ${a.group_name}`.toLowerCase().includes(s)) : list;
    return m.slice(0, 50);
  }, [q, list]);

  const input = useRef(null);
  const arrowed = useRef(false);
  const hiRef = useRef(null);
  const quietFocus = useRef(false);   // auto-focus on page open: cursor in the box, list stays closed if something is already chosen
  useEffect(() => { hiRef.current?.scrollIntoView({ block: 'nearest' }); }, [hi, open]);
  useEffect(() => {
    if (!autoFocus || !input.current) return;
    quietFocus.current = !!value;
    input.current.focus();
    input.current.select?.();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (a, advance) => {
    onChange(a.id); setOpen(false); setQ('');
    if (advance && input.current) { const el = input.current; setTimeout(() => focusNext(el), 30); }
  };

  return (
    <div className="acsel" ref={box}>
      <input
        ref={input}
        value={open ? q : label(current) || ''}
        placeholder={open && current ? label(current) : placeholder}
        onFocus={() => { if (quietFocus.current) { quietFocus.current = false; return; } setOpen(true); setQ(''); arrowed.current = false; setHi(Math.max(0, list.slice(0, 50).findIndex((a) => a.id === value))); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { setQ(e.target.value); setHi(0); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); arrowed.current = true; setOpen(true); setHi((h) => Math.min(h + 1, matches.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); arrowed.current = true; setOpen(true); setHi((h) => Math.max(h - 1, 0)); }
          // Enter picks the highlighted row — after typing, or after moving with ↑ / ↓
          else if (e.key === 'Enter' && open && (q || arrowed.current) && matches[hi]) { e.preventDefault(); arrowed.current = false; pick(matches[hi], true); }
          else if (e.key === 'Enter' && !q && !value && onEmptyEnter) { e.preventDefault(); setOpen(false); onEmptyEnter(); }
          else if (e.key === 'Enter' && open && !q) { e.preventDefault(); setOpen(false); focusNext(e.currentTarget); }
          else if (e.key === 'Escape' && open) { e.preventDefault(); setOpen(false); }
          else if (e.key === 'Tab') setOpen(false);
        }}
      />
      {open && (
        <ul className="acsel-list">
          {matches.length === 0 && <li className="muted">Nothing found</li>}
          {onAdd && q && <li className="add" onMouseDown={(e) => { e.preventDefault(); setOpen(false); onAdd(q); }}>+ Add “{q}”</li>}
          {matches.map((a, i) => (
            <li key={a.id} ref={i === hi ? hiRef : undefined} className={`${i === hi ? 'hi' : ''} ${a.id === value ? 'cur' : ''}`} onMouseDown={(e) => { e.preventDefault(); pick(a, true); }}>
              <span>{label(a)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** From / To in BS with a Fiscal Year dropdown (all fiscal years, newest first) that fills both dates. */
export function PeriodBar({ from, to, onChange, fy, children }) {
  const [fys, setFys] = useState([]);
  useEffect(() => { api.get('/fiscal-years').then((r) => Array.isArray(r) && setFys(r)).catch(() => {}); }, []);
  const list = fys.length ? fys : (fy ? [fy] : []);
  const match = list.find((f) => f.start_date === from && f.end_date === to);
  return (
    <div className="toolbar">
      <label>From <BsDateInput value={from} onChange={(v) => onChange(v, to)} showAd={false} /></label>
      <label>To <BsDateInput value={to} onChange={(v) => onChange(from, v)} showAd={false} /></label>
      {list.length > 0 && (
        <select aria-label="Fiscal Year" value={match ? String(match.id) : ''}
          onChange={(e) => { const f = list.find((x) => String(x.id) === e.target.value); if (f) onChange(f.start_date, f.end_date); }}>
          {!match && <option value="">Fiscal Year…</option>}
          {list.map((f) => <option key={f.id} value={String(f.id)}>FY {f.name}</option>)}
        </select>
      )}
      {children}
    </div>
  );
}
