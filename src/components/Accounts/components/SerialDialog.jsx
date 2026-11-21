import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useShortcuts } from '../lib/keys';
import { Kbd } from './inputs';

/** Split pasted Excel cells / lines / commas into clean, unique serial numbers. */
export function parseSerials(text) {
  const seen = new Set();
  return String(text || '').split(/[\r\n\t,;]+/).map((s) => s.trim())
    .filter((s) => s && s.toLowerCase() !== 'serial no' && s.toLowerCase() !== 'serial' && !seen.has(s.toUpperCase()) && seen.add(s.toUpperCase()));
}

export async function exportSerials(serials, name) {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.aoa_to_sheet([['Serial No'], ...serials.map((s) => [s])]);
  ws['!cols'] = [{ wch: 28 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Serials');
  XLSX.writeFile(wb, `${name.replace(/[^\w-]+/g, '_')}_serials.xlsx`);
}

export async function importSerialsFile(file) {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer());
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false });
  return parseSerials(rows.map((r) => r[0] ?? '').join('\n'));
}

/** "SN0001" → { prefix: 'SN', num: 1, width: 4 }; null when it doesn't end in digits. */
function splitSerial(s) {
  const m = /^(.*?)(\d+)$/.exec(String(s || '').trim());
  return m ? { prefix: m[1].toUpperCase(), num: Number(m[2]), width: m[2].length } : null;
}

/** Every serial from `from` to `to` (same prefix, counting the trailing number), or an error message. */
export function serialRange(from, to, limit = 20000) {
  const a = splitSerial(from); const b = splitSerial(to);
  if (!a || !b) return { error: 'Both serials must end in a number, e.g. SN0001 to SN4000.' };
  if (a.prefix !== b.prefix) return { error: `The two serials start differently ("${a.prefix}" and "${b.prefix}").` };
  if (b.num < a.num) return { error: '"To" must be after "From".' };
  if (b.num - a.num + 1 > limit) return { error: `That is more than ${limit} serials.` };
  const head = String(from).trim().slice(0, String(from).trim().length - a.width);
  const out = [];
  for (let n = a.num; n <= b.num; n++) out.push(head + String(n).padStart(a.width, '0'));
  return { list: out };
}

const SHOW_MAX = 300;   // chips drawn at once — search or use a range for the rest

/**
 * Enter serial numbers for one line.
 *  mode 'in'   (Purchase, Sales Return, opening stock): type / paste / import
 *  mode 'pick' (Sales Invoice, Purchase Return): choose from serials in stock (or paste to tick them)
 * `allowed` limits a return to the serials on the original bill.
 */
export default function SerialDialog({ item, mode, value, qty, allowed, extra, strict, onSave, onClose }) {
  const [text, setText] = useState((value || []).join('\n'));
  const [stock, setStock] = useState([]);
  const [picked, setPicked] = useState(new Set(value || []));
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState('');
  const fileRef = useRef(null);

  useEffect(() => {
    if (mode === 'pick' && !allowed) {
      api.get('/serials', { item_id: item.id, status: 'in_stock' })
        .then((r) => setStock([...new Set([...(extra || []), ...r.map((s) => s.serial_no)])]));
    }
    if (allowed) setStock(allowed);
  }, [item.id, mode, allowed]);

  const list = mode === 'pick' || allowed ? [...picked] : parseSerials(text);
  const shown = useMemo(() => stock.filter((s) => !q || s.toLowerCase().includes(q.toLowerCase())), [stock, q]);
  const want = Number(qty) || 0;

  // strict (bills/returns): the count must match the quantity typed on the line
  const countOk = !strict || !want || list.length === want;
  const done = () => {
    if (!countOk) { setMsg(`Quantity is ${want} — enter exactly ${want} serial number${want > 1 ? 's' : ''} (now ${list.length}).`); return; }
    onSave(list);
  };
  const toggle = (s) => {
    const n = new Set(picked);
    if (n.has(s)) n.delete(s);
    else if (strict && want && n.size >= want) { setMsg(`Quantity is ${want} — untick one first.`); return; }
    else n.add(s);
    setPicked(n);
  };
  useShortcuts({ save: done, close: onClose });

  const stockByKey = useMemo(() => new Map(stock.map((s) => [s.toUpperCase(), s])), [stock]);
  const pasteTick = (txt) => {
    const wantList = Array.isArray(txt) ? txt : parseSerials(txt);
    const n = new Set(picked);
    let ok = 0; let full = 0;
    wantList.forEach((s) => {
      const real = stockByKey.get(String(s).toUpperCase());
      if (!real) return;
      if (n.has(real)) { ok++; return; }
      if (strict && want && n.size >= want) { full++; return; }
      n.add(real); ok++;
    });
    setPicked(n);
    const missing = wantList.length - ok - full;
    setMsg(`${ok} ticked${missing ? `, ${missing} not ${allowed ? 'on the original bill' : 'in stock'}` : ''}${full ? `, ${full} left out (quantity is ${want})` : ''}.`);
  };

  // range: From … To
  const [rFrom, setRFrom] = useState('');
  const [rTo, setRTo] = useState('');
  const applyRange = () => {
    const r = serialRange(rFrom, rTo);
    if (r.error) { setMsg(r.error); return; }
    if (mode === 'pick' || allowed) pasteTick(r.list);
    else {
      const merged = parseSerials([...parseSerials(text), ...r.list].join('\n'));
      setText(merged.join('\n'));
      setMsg(`${r.list.length} serials added (${r.list[0]} … ${r.list[r.list.length - 1]}).`);
    }
    setRFrom(''); setRTo('');
  };

  // scan box (pick mode): scan or type one serial, Enter ticks it
  const [scan, setScan] = useState('');
  const scanOne = () => {
    const s = scan.trim();
    if (!s) return;
    const real = stockByKey.get(s.toUpperCase());
    if (!real) setMsg(`${s} is not ${allowed ? 'on the original bill' : 'in stock'}.`);
    else if (picked.has(real)) setMsg(`${real} is already ticked.`);
    else if (strict && want && picked.size >= want) setMsg(`Quantity is ${want} — untick one first.`);
    else { setPicked(new Set([...picked, real])); setMsg(`✔ ${real}`); }
    setScan('');
  };
  const onFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const s = await importSerialsFile(f);
      if (mode === 'pick' || allowed) pasteTick(s.join('\n'));
      else { setText(s.join('\n')); setMsg(`${s.length} serial numbers imported.`); }
    } catch { setMsg('Could not read that file. Use .xlsx or .csv with serials in the first column.'); }
  };

  return (
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card form serial-dlg" data-enter="off" data-nocap>
        <h2>Serial numbers — {item.name}</h2>
        <div className="serial-bar">
          <span className={list.length === want ? 'pos' : 'warn'}><b>{list.length}</b> entered{want ? ` · quantity ${want}` : ''}</span>
          <span className="spacer" />
          <button type="button" className="ghost" onClick={() => fileRef.current?.click()}>⬆ Import Excel/CSV</button>
          <button type="button" className="ghost" disabled={!list.length} onClick={() => exportSerials(list, item.name)}>⬇ Export Excel</button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.txt" hidden onChange={onFile} />
        </div>
        <div className="serial-range">
          <span className="lbl">Range</span>
          <input placeholder="From  e.g. SN0001" value={rFrom} onChange={(e) => setRFrom(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.nextElementSibling?.nextElementSibling?.focus(); } }} />
          <span>to</span>
          <input placeholder="To  e.g. SN4000" value={rTo} onChange={(e) => setRTo(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyRange(); } }} />
          <button type="button" className="ghost" disabled={!rFrom.trim() || !rTo.trim()} onClick={applyRange}>
            {mode === 'pick' || allowed ? 'Tick range' : 'Add range'}</button>
          {rFrom.trim() && rTo.trim() && !serialRange(rFrom, rTo).error && <span className="muted small">{serialRange(rFrom, rTo).list.length} serials</span>}
        </div>
        {mode === 'in' && !allowed ? (
          <label className="full">One per line — copy a column from Excel and paste here (Ctrl+V), or scan with a barcode reader
            <textarea autoFocus rows={12} className="mono" value={text} onChange={(e) => setText(e.target.value)} placeholder={'SN0001\nSN0002\nSN0003'} />
            {list.length > 0 && <button type="button" className="link small" onClick={() => { setText(''); setMsg(''); }}>Clear all</button>}
          </label>
        ) : (
          <div className="full">
            <div className="inline">
              <input autoFocus className="scan-box" placeholder="Scan / type a serial, Enter ticks it" value={scan} onChange={(e) => setScan(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); scanOne(); } }} />
              <input placeholder={`Search ${stock.length} available…`} value={q} onChange={(e) => setQ(e.target.value)} />
              <button type="button" className="ghost" onClick={() => setPicked(new Set([...picked, ...shown.filter((s) => !picked.has(s)).slice(0, Math.max(want - picked.size, 0))]))}>Tick first {Math.max(want - picked.size, 0)}</button>
              <button type="button" className="ghost" onClick={() => setPicked(new Set())}>Clear</button>
            </div>
            {picked.size > 0 && (
              <div className="serial-picked">
                <b>Ticked ({picked.size}):</b>
                {[...picked].slice(0, 40).map((s) => <span key={s} className="serial-chip on small">{s} <button type="button" className="link" onClick={() => toggle(s)}>✕</button></span>)}
                {picked.size > 40 && <span className="muted small">+ {picked.size - 40} more (Export Excel to see all)</span>}
              </div>
            )}
            {shown.length > SHOW_MAX && <div className="muted small">Showing {SHOW_MAX} of {shown.length} — search, scan or use Range to reach the rest.</div>}
            <div className="serial-grid">
              {shown.length === 0 && <span className="muted">No serial numbers {allowed ? 'left to return on this bill' : 'in stock'}{q ? ' match the search' : ''}.</span>}
              {shown.slice(0, SHOW_MAX).map((s) => (
                <label key={s} className={`serial-chip ${picked.has(s) ? 'on' : ''}`}>
                  <input type="checkbox" checked={picked.has(s)} onChange={() => toggle(s)} /> {s}
                </label>
              ))}
            </div>
            <label className="full">Or paste serials from Excel to tick them
              <textarea rows={3} className="mono" onPaste={(e) => { e.preventDefault(); pasteTick(e.clipboardData.getData('text')); }} placeholder="Ctrl+V here" />
            </label>
          </div>
        )}
        {msg && <div className="info">{msg}</div>}
        <div className="actions">
          <span className="muted small">{strict && want ? `Enter exactly ${want} serial number${want > 1 ? 's' : ''}.` : 'Quantity will be set to the number of serials.'}</span>
          <span className="spacer" />
          <button type="button" className="ghost" onClick={onClose}>Close <Kbd>Esc</Kbd></button>
          <button type="button" data-save disabled={!countOk} title={countOk ? '' : `Needs ${want} serial numbers`} onClick={done}>OK <Kbd>Ctrl+S</Kbd></button>
        </div>
      </div>
    </div>
  );
}
