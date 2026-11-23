import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useGrid } from '../components/DataGrid';
import { useNavigate, useSearchParams } from '../lib/router';
import { useApp } from '../context';
import { api, fmtBal, fmtMoney, waLink } from '../lib/api';
import { useShortcuts } from '../lib/keys';
import { Amount, Kbd, LastSaved } from '../components/inputs';
import ContextMenu from '../components/ContextMenu';
import { fmtDate, fmtDateShort } from '../lib/dates';
import SearchableSelect from '../../Common/SearchableSelect.jsx';

const LEVELS = [['mrp', 'Retail (MRP)'], ['dealer', 'Dealer'], ['partner', 'Partner']];
const blankContact = () => ({ name: '', post: '', dept: '', mobile1: '', mobile2: '', email: '', remarks: '' });

const HDR = { sn: 'sn', sno: 'sn', ledger: 'name', name: 'name', customer: 'name', customername: 'name', pan: 'pan', panno: 'pan', vat: 'pan', address: 'address', city: 'city',
  suppliersname: 'name', suppliername: 'name', supplier: 'name', suppliers: 'name', homephone: 'home_phone', resphone: 'home_phone',
  officephone: 'office_phone', phone: 'office_phone', email: 'email', mobile: 'phone', mobileno: 'phone', customergroup: 'group', group: 'group', contactperson: 'contact' };
// no header row pasted -> assume the sheet's standard column order
const POS_CUS = ['sn', 'name', 'pan', 'address', 'city', 'office_phone', 'email', 'phone', 'group', 'contact'];
const POS_SUP = ['name', 'pan', 'address', 'city', 'office_phone', 'home_phone', 'email', 'phone'];
/** Tab-separated text pasted from Excel -> [{ name, pan, address, city, office_phone, email, phone, group, contact }] */
function parsePasted(text, isCus) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').filter((l) => l.trim());
  if (!lines.length) return [];
  let map = isCus ? POS_CUS : POS_SUP, start = 0;
  // header names vary ("PAN", "PAN / VAT No.", "VAT No" …) — anything mentioning PAN or VAT is the PAN column
  const head = lines[0].split('\t').map((h) => { const t = h.toLowerCase().replace(/[^a-z]/g, ''); return HDR[t] || (/pan|vat/.test(t) ? 'pan' : /mobile/.test(t) ? 'phone' : null); });
  if (head.includes('name')) { map = head; start = 1; }
  const out = [];
  for (const line of lines.slice(start)) {
    const cells = line.split('\t'), r = {};
    map.forEach((f, i) => { if (f && f !== 'sn') r[f] = (cells[i] || '').replace(/^"|"$/g, '').trim(); });
    if (!r.phone && r.home_phone) r.phone = r.home_phone;   // no mobile -> use the home phone
    delete r.home_phone;
    if (r.name) out.push({ pan: '', address: '', city: '', office_phone: '', email: '', phone: '', group: '', contact: '', ...r });
  }
  return out;
}

/** Customers = Sundry Debtors, Suppliers = Sundry Creditors. Same grid and full-width form as the Sales Invoice screens. */
export default function Parties({ type }) {
  const { reload, notify, fy, today, canEdit, isSuper } = useApp();
  const nav = useNavigate();
  const isCus = type === 'customer';
  const word = isCus ? 'Customer' : 'Supplier';
  const otherWord = isCus ? 'Supplier' : 'Customer';
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [onlyDue, setOnlyDue] = useState(false);
  const [typeF, setTypeF] = useState('');       // Customers: price level (mrp / dealer / partner) · Suppliers: relation (both / only / sub / main)
  const [edit, setEdit] = useState(null);
  const [menu, setMenu] = useState(null);
  const [picked, setPicked] = useState(new Set());

  const load = () => api.get('/parties', { type, include_inactive: true }).then(setRows);
  const [sp, setSp] = useSearchParams();
  useEffect(() => { load(); setEdit(null); setCur(null); setTypeF(''); }, [type]);
  // ?new=1 (from Chart of Accounts → Parties) opens a blank customer / supplier form straight away
  useEffect(() => { if (sp.get('new') && canEdit) { open(null); setSp({}, { replace: true }); } }, [sp, type]);

  // ── Sub ledger: a sub-company under a main customer / supplier (own name, PAN, address, phone; same contact person) ──
  const [sub, setSub] = useState(null);       // { parent_id, name, pan, address, phone }
  const openSub = (parentId = '') => setSub({ parent_id: parentId ? String(parentId) : '', name: '', pan: '', address: '', phone: '' });
  // ?sub=1 (from Master → Parties → Create … Sub Ledger) opens the form straight away
  useEffect(() => { if (sp.get('sub') && canEdit) { openSub(); setSp({}, { replace: true }); } }, [sp, type]);
  const subParent = sub?.parent_id ? rows.find((r) => String(r.id) === String(sub.parent_id)) : null;
  const saveSub = async (e) => {
    e?.preventDefault();
    if (!sub) return;
    try {
      await api.post('/parties/sub-ledger', sub);
      setSub(null); await load(); await reload();
      notify(`${word} sub ledger saved`);
    } catch (err) { notify(err.message, 'err'); }
  };
  useShortcuts({ save: () => saveSub(), close: () => setSub(null) }, !!sub);

  // ── Make an existing customer / supplier a sub ledger of another one (right-click → Make sub ledger of…) ──
  const [mk, setMk] = useState(null);          // { row, parent_id }
  const saveMk = async (e) => {
    e?.preventDefault();
    if (!mk?.parent_id) return;
    try {
      await api.put(`/parties/${mk.row.id}/parent`, { parent_id: +mk.parent_id });
      const main = rows.find((r) => String(r.id) === String(mk.parent_id));
      setMk(null); await load(); await reload();
      notify(`${mk.row.name} is now a sub ledger of ${main?.name || 'the main ' + word.toLowerCase()}`);
    } catch (err) { notify(err.message, 'err'); }
  };
  const unSub = async (r) => {
    if (!window.confirm(`Take ${r.name} out of ${r.parent_name}? It stays as a normal ${word.toLowerCase()} with all its data.`)) return;
    try { await api.put(`/parties/${r.id}/parent`, { parent_id: null }); await load(); await reload(); notify(`${r.name} is no longer a sub ledger`); }
    catch (err) { notify(err.message, 'err'); }
  };
  useShortcuts({ save: () => saveMk(), close: () => setMk(null) }, !!mk);

  // ── Bulk import (Super Admin only): paste rows copied from Excel, preview, import ──
  // Columns: SN, Ledger, PAN, Address, City, Office Phone, Email, Mobile, Customer Group, Contact Person
  // (a header row, if pasted, is matched by name instead). Existing names are skipped by the server.
  const [bulk, setBulk] = useState(null);   // { text, busy, result }
  const bulkRows = useMemo(() => (bulk ? parsePasted(bulk.text, isCus) : []), [bulk?.text, isCus]);
  const existing = useMemo(() => new Set(rows.map((r) => r.name.trim().toLowerCase())), [rows]);
  const bulkNew = bulkRows.filter((r, i) => !existing.has(r.name.toLowerCase()) && bulkRows.findIndex((x) => x.name.toLowerCase() === r.name.toLowerCase()) === i);
  const runBulk = async () => {
    setBulk({ ...bulk, busy: true });
    try {
      const res = await api.post('/parties/bulk-import', { party_type: type, rows: bulkNew });
      await load(); await reload();
      setBulk({ ...bulk, busy: false, result: res });
      notify(`Imported ${res.added} ${word.toLowerCase()}(s)${res.skipped ? `, ${res.skipped} skipped` : ''}`, res.added ? 'ok' : 'err');
    } catch (err) { setBulk({ ...bulk, busy: false }); notify(err.message, 'err'); }
  };
  useShortcuts({ close: () => setBulk(null) }, !!bulk);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    const mainIds = new Set(rows.filter((r) => r.parent_party_id).map((r) => r.parent_party_id));
    const typeOk = (r) => {
      if (!typeF) return true;
      if (isCus) return r.price_level === typeF;
      if (typeF === 'both') return !!r.linked_party_id;
      if (typeF === 'only') return !r.linked_party_id;
      if (typeF === 'sub') return !!r.parent_party_id;
      if (typeF === 'main') return mainIds.has(r.id);
      return true;
    };
    return rows.filter((r) => typeOk(r) && (!s || `${r.name} ${r.pan || ''} ${r.phone || ''} ${r.whatsapp || ''} ${r.address || ''} ${r.main_contact || ''}`.toLowerCase().includes(s))
      && (!onlyDue || Math.abs(r.balance) > 0.005));
  }, [rows, q, onlyDue, typeF, isCus]);
  const total = shown.reduce((s, r) => s + r.balance, 0);

  // ── Tree view: a main customer / supplier can be opened (▸ / ▾) to show its sub ledgers just under it ──
  const [openIds, setOpenIds] = useState(() => new Set());
  const toggleOpen = (id) => setOpenIds((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const searching = !!q.trim();
  const allKids = useMemo(() => {            // every sub ledger of each main party (ignores the search / filter)
    const m = new Map();
    rows.forEach((r) => { if (r.parent_party_id) { if (!m.has(r.parent_party_id)) m.set(r.parent_party_id, []); m.get(r.parent_party_id).push(r); } });
    return m;
  }, [rows]);
  // A sub ledger always lives UNDER its main party — never as a separate row further down the list.
  // Filter / search: a main row is kept if it OR any of its sub ledgers matches. If only a sub ledger matches, the main row opens
  // by itself and shows just the matching sub ledgers; if the main row matches, its ▸ opens ALL its sub ledgers.
  const filtering = searching || onlyDue || !!typeF;
  const { display, metaOf } = useMemo(() => {
    const hit = new Set(shown.map((r) => r.id));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const out = [], meta = new Map();
    rows.forEach((r) => {
      if (r.parent_party_id && byId.has(r.parent_party_id)) return;       // listed under its main party below
      const kids = allKids.get(r.id) || [];
      const kidHits = kids.filter((k) => hit.has(k.id));
      const self = hit.has(r.id);
      if (!self && kidHits.length === 0) return;
      const autoOpen = filtering && !self && kidHits.length > 0;
      const isOpen = openIds.has(r.id) || autoOpen;
      out.push(r); meta.set(r.id, { depth: 0, hasKids: kids.length > 0, isOpen });
      if (isOpen) (self ? kids : kidHits).forEach((c) => { out.push(c); meta.set(c.id, { depth: 1, hasKids: false, isOpen: false }); });
    });
    return { display: out, metaOf: meta };
  }, [rows, shown, openIds, filtering, allKids]);
  const colCount = isCus ? 12 : 11;
  // ── Paging (like Staff Detail): a main party stays together with its open sub ledgers on one page ──
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [q, onlyDue, typeF, type, pageSize]);
  const groups = useMemo(() => {
    const gs = [];
    display.forEach((r) => { if ((metaOf.get(r.id)?.depth || 0) === 0 || !gs.length) gs.push([r]); else gs[gs.length - 1].push(r); });
    return gs;
  }, [display, metaOf]);
  const totalPages = Math.max(1, Math.ceil(groups.length / pageSize));
  const curPage = Math.min(page, totalPages);
  const pageRows = useMemo(() => groups.slice((curPage - 1) * pageSize, curPage * pageSize).flat(), [groups, curPage, pageSize]);
  const snBase = useMemo(() => groups.slice(0, (curPage - 1) * pageSize).reduce((n, gp) => n + gp.length, 0), [groups, curPage, pageSize]);
  const pageNumbers = useMemo(() => {
    const arr = [];
    if (totalPages <= 7) { for (let i = 1; i <= totalPages; i++) arr.push(i); }
    else {
      arr.push(1);
      if (curPage > 3) arr.push('...');
      for (let i = Math.max(2, curPage - 1); i <= Math.min(totalPages - 1, curPage + 1); i++) arr.push(i);
      if (curPage < totalPages - 2) arr.push('...');
      arr.push(totalPages);
    }
    return arr;
  }, [totalPages, curPage]);
  // standard grid: current row, ticks, ↑ / ↓ / Enter, blank rows + details box down to the screen bottom
  const g = useGrid({ rows: pageRows, onOpen: (r) => (canEdit ? open(r) : ledger(r)) });
  const { gridRef, cur, setCur, curRow, sel, setSel, remH } = g;
  // Staff-Details style layout: the card fills the screen, the table scrolls inside it under a frozen heading,
  // blank striped rows fill any spare room, and the remarks + totals stay pinned to the bottom edge.
  const cardRef = useRef(null), scrollRef = useRef(null);
  const [nBlank, setNBlank] = useState(0);
  useLayoutEffect(() => {
    const fit = () => {
      const card = cardRef.current, sc = scrollRef.current;
      if (!card || !sc) return;
      card.style.height = Math.max(280, window.innerHeight - (card.getBoundingClientRect().top + window.scrollY) - 4) + 'px';
      const real = [...sc.querySelectorAll('tbody > tr:not(.blank)')];
      const rowH = real[0]?.offsetHeight || 37;
      const used = (sc.querySelector('thead')?.offsetHeight || 0) + (sc.querySelector('tfoot')?.offsetHeight || 0) + real.reduce((t, r) => t + r.offsetHeight, 0);
      setNBlank(Math.max(0, Math.floor((sc.clientHeight - used) / rowH)));
    };
    fit();
    window.addEventListener('resize', fit);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    if (ro && gridRef.current) ro.observe(gridRef.current);
    return () => { window.removeEventListener('resize', fit); ro?.disconnect(); };
  }, [pageRows, curRow]); // eslint-disable-line react-hooks/exhaustive-deps
  const ledger = (r) => nav(`/ledger?account=${r.id}&from=${fy.start_date}&to=${today}`);

  const open = async (r) => {
    if (r) {
      const full = await api.get(`/parties/${r.id}`);
      const ob = Number(full.opening_balance);
      setEdit({ ...full, amount: Math.abs(ob) || '', side: ob < 0 ? 'pay' : 'take', active: !!full.active, also_other_role: !!full.linked_party_id,
        contacts: full.contacts.length ? full.contacts : [blankContact()] });
    } else {
      setEdit({ party_type: type, name: '', amount: '', side: isCus ? 'take' : 'pay', price_level: 'mrp', credit_limit: '', credit_days: '',
        active: true, also_other_role: false, contacts: [blankContact()] });
    }
    setPicked(new Set());
  };
  const set = (k) => (e) => setEdit({ ...edit, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  // phone boxes take digits (and + - / space) only, so letters can't sneak in
  const setPhone = (k) => (e) => setEdit({ ...edit, [k]: e.target.value.replace(/[^\d+\-/\s]/g, '') });
  const badPhone = (v) => !!v && /[^\d+\-/\s]/.test(v);   // an older saved value with letters in it
  // after a failed save, jump to the box the message is about
  const FIELD_OF = [['WhatsApp Mobile No.', 'whatsapp'], ['Mobile No.', 'phone'], ['Office Phone', 'office_phone'], ['Transport Phone', 'transport_phone'],
    ['Email', 'email'], ['PAN', 'pan'], ['Another', 'pan'], ['Name is required', 'name'], ['A ledger with this name', 'name'], ['The ', 'also_other_role']];
  const focusBad = (msg) => {
    const hit = FIELD_OF.find(([label]) => msg.startsWith(label) || msg.includes(`${label} `));
    const el = hit && document.querySelector(`.party-full [name="${hit[1]}"]`);
    if (el) { el.focus(); el.select?.(); el.classList.add('bad-field'); setTimeout(() => el.classList.remove('bad-field'), 4000); }
  };
  const setC = (i, k, v) => setEdit({ ...edit, contacts: edit.contacts.map((c, j) => (j === i ? { ...c, [k]: v } : c)) });

  const remove = async (p = edit) => {
    if (!p?.id || !confirm(`Delete "${p.name}"?\nOnly possible if there are no transactions.`)) return;
    try { await api.del(`/parties/${p.id}`); setEdit(null); await load(); await reload(); notify('Deleted'); }
    catch (err) { notify(err.message, 'err'); }
  };
  const save = async (e) => {
    e?.preventDefault();
    if (!edit) return;
    const amt = Number(edit.amount || 0);
    const body = { ...edit, party_type: type, also_other_role: !!edit.also_other_role, opening_balance: edit.side === 'pay' ? -amt : amt,
      credit_limit: Number(edit.credit_limit || 0), credit_days: Number(edit.credit_days || 0),
      contacts: edit.contacts.filter((c) => Object.values(c).some((v) => String(v || '').trim())) };
    try {
      if (edit.id) await api.put(`/parties/${edit.id}`, body); else await api.post('/parties', body);
      setEdit(null); await load(); await reload(); notify(`${word} saved`);
    } catch (err) { notify(err.message, 'err'); focusBad(err.message); }
  };
  useShortcuts({ save: () => save(), close: () => setEdit(null), del: () => remove() }, !!edit);

  const rowMenu = (e, r) => {
    e.preventDefault(); e.stopPropagation();
    if (r) setCur(r.id);
    setMenu({ x: e.clientX, y: e.clientY, title: r ? r.name : (isCus ? 'Customers' : 'Suppliers'), items: [
      canEdit && { icon: '➕', label: `Add ${word.toLowerCase()}`, onClick: () => open(null) },
      r && canEdit && { icon: '✏️', label: `Edit ${word.toLowerCase()}`, onClick: () => open(r) },
      r && canEdit && { icon: '🏢', label: 'Add sub ledger under this', onClick: () => openSub(r.parent_party_id || r.id) },
      r && canEdit && !rows.some((x) => x.parent_party_id === r.id) && { icon: '🔗', label: r.parent_party_id ? `Change main ${word.toLowerCase()} (sub ledger of…)` : 'Make sub ledger of…', onClick: () => setMk({ row: r, parent_id: r.parent_party_id ? String(r.parent_party_id) : '' }) },
      r && canEdit && r.parent_party_id && { icon: '↩️', label: 'Remove from sub ledger', onClick: () => unSub(r) },
      r && { icon: '📄', label: 'Ledger statement', onClick: () => ledger(r) },
      r && r.linked_party_id && { icon: '🔗', label: `${otherWord} ledger (same party)`, onClick: () => nav(`/ledger?account=${r.linked_party_id}&from=${fy.start_date}&to=${today}`) },
      r && canEdit && (isCus ? { icon: '📥', label: 'Receive payment', onClick: () => nav('/entry/receipt') } : { icon: '📤', label: 'Make payment', onClick: () => nav('/entry/supplier_payment') }),
      r && (r.whatsapp || r.phone) && { icon: '🟢', label: 'WhatsApp', onClick: () => window.open(waLink(r.whatsapp || r.phone, `Namaste ${r.name},`), '_blank', 'noopener') },
      r && canEdit && 'divider',
      r && canEdit && { icon: '🗑', label: 'Delete', danger: true, onClick: () => remove(r) },
    ] });
  };

  return (
    <>
      <header className="page-head">
        <h1>{isCus ? 'Customers' : 'Suppliers'}</h1>
        <span className="muted">{isCus ? 'Sundry Debtors' : 'Sundry Creditors'}</span>
        <span className="spacer" />
        {isSuper && <button className="ghost" title="Super Admin only — paste from Excel" onClick={() => setBulk({ text: '', busy: false, result: null })}>📋 Bulk import</button>}
        <button className="ghost edit-only" onClick={() => openSub()}>＋ Sub ledger</button>
        <button className="edit-only" data-new title="F1 / Alt+N" onClick={() => open(null)}>＋ New {word.toLowerCase()} <kbd className="kbd">F1</kbd></button>
      </header>
      {/* toolbar: filters on the left, search on the right (same place as the other grids) */}
      <div className="pdc-bar">
        <label className="check small"><input type="checkbox" checked={onlyDue} onChange={(e) => setOnlyDue(e.target.checked)} /> Only with balance</label>
        <select className="type-filter" value={typeF} onChange={(e) => setTypeF(e.target.value)} title={isCus ? 'Filter by customer type' : 'Filter suppliers'}>
          {isCus
            ? <><option value="">All types</option>{LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</>
            : <><option value="">All suppliers</option><option value="both">Also customer</option><option value="only">Supplier only</option><option value="main">Main (with sub ledgers)</option><option value="sub">Sub ledgers</option></>}
        </select>
        <span className="spacer" />
        <span className="muted small">{shown.length} of {rows.length}</span>
        <span className="tb-search"><input data-find title="Ctrl+F" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, PAN, phone, address, contact…" />{q && <button type="button" className="link" onClick={() => setQ('')}>✕</button>}</span>
      </div>
      <section className="card parties-card" ref={cardRef}>
        <div className="parties-scroll" ref={scrollRef}>
        <table ref={gridRef} className="grid dg-soft parties-grid" onContextMenu={(e) => rowMenu(e, null)}>
          <thead><tr>
            <th className="sel"><input type="checkbox" title="Select all" checked={pageRows.length > 0 && pageRows.every((r) => sel.has(r.id))}
              onChange={(e) => setSel(e.target.checked ? new Set(pageRows.map((r) => r.id)) : new Set())} /></th>
            <th className="sn">SN</th><th>Name</th><th>PAN</th><th>Office Phone</th><th>WhatsApp</th><th>Contact Person</th><th>Address</th>
            {isCus && <th className="nowrap">Type</th>}<th className="num nowrap">Credit</th><th className="nowrap">Last Txn</th><th className="num">Balance</th>
          </tr></thead>
          <tbody>
            {display.length === 0 && <tr><td colSpan={colCount} className="muted">No {isCus ? 'customers' : 'suppliers'} found.{canEdit && <> Press <kbd className="kbd">F1</kbd> to add a new {word.toLowerCase()} (or right-click).</>}</td></tr>}
            {pageRows.map((r, idx) => {
              const meta = metaOf.get(r.id) || { depth: 0, hasKids: false, isOpen: false };
              // like a thread-statistics tree: a closed main row shows the total of itself + its sub ledgers, an open one only its own balance
              const subSum = meta.hasKids && !meta.isOpen ? (allKids.get(r.id) || []).reduce((t, x) => t + x.balance, 0) : 0;
              const bal = r.balance + subSum;
              const over = isCus && r.credit_limit > 0 && r.balance > r.credit_limit;
              return (
                <tr key={r.id} data-id={r.id} className={`clickable ${meta.depth ? 'tv-child' : ''} ${r.active ? '' : 'inactive-row'} ${cur === r.id ? 'current' : ''} ${sel.has(r.id) ? 'selected' : ''}`}
                  onClick={() => setCur(r.id)} onDoubleClick={() => (canEdit ? open(r) : ledger(r))} onContextMenu={(e) => rowMenu(e, r)}>
                  <td className="sel" onDoubleClick={(e) => e.stopPropagation()}><input type="checkbox" checked={sel.has(r.id)}
                    onChange={() => setSel((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} /></td>
                  <td className="sn">{snBase + idx + 1}</td>
                  <td className="pname">
                    {meta.depth > 0 && <span className="tv-elbow" aria-hidden>└</span>}
                    {meta.hasKids
                      ? <button type="button" className="tv-tog" title={meta.isOpen ? 'Close sub ledgers' : `Open sub ledgers (${(allKids.get(r.id) || []).length})`}
                          onClick={(e) => { e.stopPropagation(); toggleOpen(r.id); }} onDoubleClick={(e) => e.stopPropagation()}>{meta.isOpen ? '▾' : '▸'}</button>
                      : (meta.depth === 0 && <span className="tv-tog tv-none" />)}
                    {r.name}{meta.hasKids && !meta.isOpen && <span className="tag" title="Balance includes its sub ledgers">{(allKids.get(r.id) || []).length} sub</span>}{r.parent_name && meta.depth === 0 && <span className="tag" title={`Sub ledger of ${r.parent_name}`}>↳ under {r.parent_name}</span>}{!r.active && <span className="tag">inactive</span>}{r.linked_party_id && <span className="tag tag-both" title={`Also a ${otherWord.toLowerCase()} — ${isCus ? 'payable' : 'receivable'} ${fmtBal(r.linked_balance)}`}>also {otherWord.toLowerCase()}</span>}</td>
                  <td>{r.pan}</td><td className="nowrap">{r.office_phone}</td>
                  <td className="nowrap">{(r.whatsapp || r.phone) && <a href={waLink(r.whatsapp || r.phone, `Namaste ${r.name},`)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{r.whatsapp || r.phone}</a>}</td>
                  <td>{r.main_contact}{r.contact_count > 1 && <span className="tag">+{r.contact_count - 1}</span>}</td>
                  <td>{r.address}</td>
                  {isCus && <td className="nowrap">{r.price_level && <span className={`lvl-badge lvl-${r.price_level}`}>{LEVELS.find((l) => l[0] === r.price_level)?.[1]}</span>}</td>}
                  <td className="num nowrap">{r.credit_days ? `${r.credit_days} d` : ''}{r.credit_limit ? ` · ${fmtMoney(r.credit_limit)}` : ''}</td>
                  <td className="nowrap">{r.last_date ? fmtDateShort(r.last_date) : ''}</td>
                  <td className={`num b ${over ? 'neg' : ''}`} title={subSum ? 'Includes its sub ledgers' : undefined}>{fmtBal(bal)}{over && <span className="tag">over limit</span>}</td>
                </tr>
              );
            })}
            {Array.from({ length: nBlank }, (_, k) => <tr key={`blank${k}`} className="blank">{Array.from({ length: colCount }, (__, j) => <td key={j} className={j === 0 ? "sel" : j === 1 ? "sn" : undefined}>&nbsp;</td>)}</tr>)}
            
          </tbody>
        </table>
        </div>
        <div className="parties-remarks">
              {curRow ? (
                <div className="rm-wrap">
                <div className="rm-grid">
                  <div><b>{curRow.name}</b>
                    {curRow.address && <> · {curRow.address}</>}{curRow.pan && <> · PAN {curRow.pan}</>}</div>
                  {curRow.transport_name && <div className="rm-pay"><b>🚚 Transport:</b> {[curRow.transport_name, curRow.transport_phone, curRow.transport_address].filter(Boolean).join(' · ')}</div>}
                  <div className="rm-pay"><b>Contact:</b> {[curRow.phone && `Mobile ${curRow.phone}`, curRow.whatsapp && `WhatsApp ${curRow.whatsapp}`,
                    curRow.office_phone && `Office ${curRow.office_phone}`, curRow.email, curRow.main_contact && `Person ${curRow.main_contact}`].filter(Boolean).join(' · ') || '—'}</div>
                  <div className="rm-pay"><b>Account:</b> Balance {fmtBal(curRow.balance)}
                    {curRow.credit_days ? ` · Credit ${curRow.credit_days} days` : ''}{curRow.credit_limit ? ` · Limit Rs.${fmtMoney(curRow.credit_limit)}` : ''}
                    {curRow.last_date ? ` · Last transaction ${fmtDate(curRow.last_date)}` : ''}</div>
                  {curRow.linked_party_id && <div className="rm-pay"><b>🔗 Also a {otherWord.toLowerCase()}:</b> {isCus ? 'payable' : 'receivable'} {fmtBal(curRow.linked_balance)} · Net position {fmtBal(Number(curRow.balance) + Number(curRow.linked_balance))}</div>}
                </div>
                <div className="rm-by"><b>Updated by:</b> {curRow.saved_by_name || curRow.updated_by || curRow.created_by || "—"}<br />{(curRow.updated_at || curRow.created_at) ? fmtDate(String(curRow.updated_at || curRow.created_at).slice(0, 10)) + " · " + new Date(curRow.updated_at || curRow.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}</div>
                </div>
              ) : <span className="muted">Click a {word.toLowerCase()} to see their details.</span>}
            </div>
              <div className="dg-footer parties-pager">
          <div className="dg-info">
            {groups.length > 0 ? (
              <span style={{ color: '#000', fontWeight: 700, fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                <span style={{ background: '#fef08a', border: '1px solid #facc15', borderRadius: 5, padding: '1px 8px' }}>Total Data : {groups.length}</span>
                <span>Total Page {(curPage - 1) * pageSize + 1}–{Math.min(curPage * pageSize, groups.length)}</span>
                {(q.trim() || onlyDue || typeF) && <span style={{ fontWeight: 400 }}>(filtered from {rows.filter((r) => !r.parent_party_id).length})</span>}
              </span>
            ) : <span>No records found</span>}
          </div>
          <div className="dg-paging">
            <div className="dg-pagesize">
              <label>Per page:</label>
              <select value={pageSize} onChange={(e) => setPageSize(+e.target.value)}>
                {[10, 25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="dg-page-btns">
              <button type="button" className="pg-btn" disabled={curPage === 1} onClick={() => setPage(1)} title="First">«</button>
              <button type="button" className="pg-btn" disabled={curPage === 1} onClick={() => setPage(curPage - 1)} title="Previous">‹</button>
              {pageNumbers.map((pg, k) => (pg === '...'
                ? <span key={k} className="pg-ellipsis">…</span>
                : <button type="button" key={k} className={`pg-btn ${pg === curPage ? 'active' : ''}`} onClick={() => setPage(pg)}>{pg}</button>))}
              <button type="button" className="pg-btn" disabled={curPage === totalPages} onClick={() => setPage(curPage + 1)} title="Next">›</button>
              <button type="button" className="pg-btn" disabled={curPage === totalPages} onClick={() => setPage(totalPages)} title="Last">»</button>
            </div>
          </div>
        </div>
      </section>
      {mk && (
        <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && setMk(null)}>
          <form className="card form acc-cardform" onSubmit={saveMk} autoComplete="off">
            <h2 className="acc-head"><span className="acc-head-ic">🔗</span><span className="acc-head-txt">Make Sub Ledger
              <small>{mk.row.name} keeps its own balance, PAN and history — it is only grouped under a main {word.toLowerCase()}</small></span></h2>
            <div className="acc-card">
              <div className="acc-step"><i>1</i>This ledger</div>
              <label className="full">{word} (becomes the sub ledger)<input readOnly tabIndex={-1} value={mk.row.name} /></label>
              <div className="acc-step"><i>2</i>Main {word.toLowerCase()}</div>
              <label className="full">Sub ledger of *
                <SearchableSelect value={mk.parent_id} onChange={(v) => setMk({ ...mk, parent_id: v })}
                  placeholder={`— Select the main ${word.toLowerCase()} —`}
                  options={rows.filter((r) => r.id !== mk.row.id && !r.parent_party_id && r.active).map((r) => ({ value: String(r.id), label: r.name,
                    sub: [r.pan && `PAN ${r.pan}`, r.address].filter(Boolean).join(' · ') }))} />
              </label>
            </div>
            <div className="actions">
              <span className="spacer" />
              <button type="button" className="ghost" onClick={() => setMk(null)}>Close <Kbd>Esc</Kbd></button>
              <button data-save disabled={!mk.parent_id}>Save <Kbd>Ctrl+S</Kbd></button>
            </div>
          </form>
        </div>
      )}
      {sub && (
        <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && setSub(null)}>
          <form className="card form acc-cardform" onSubmit={saveSub} autoComplete="off">
            <h2 className="acc-head"><span className="acc-head-ic">🏢</span><span className="acc-head-txt">Create {word} Sub Ledger
              <small>A sub company under a main {word.toLowerCase()} — its own ledger and balance; the contact person stays the same</small></span></h2>
            <div className="acc-card">
              <div className="acc-step"><i>1</i>Main {word.toLowerCase()}</div>
              <label className="full">Main {word} Name *
                <SearchableSelect value={sub.parent_id} onChange={(v) => setSub({ ...sub, parent_id: v })}
                  placeholder={`— Select the main ${word.toLowerCase()} —`}
                  options={rows.filter((r) => !r.parent_party_id).map((r) => ({ value: String(r.id), label: r.name,
                    sub: [r.pan && `PAN ${r.pan}`, r.address].filter(Boolean).join(' · ') }))} />
              </label>
              <label className="full">Contact Name (same as the main {word.toLowerCase()})
                <input readOnly tabIndex={-1} value={subParent ? (subParent.main_contact || subParent.contact_person || '—') : ''} placeholder="Choose the main party first" />
              </label>
            </div>
            <div className="acc-card">
              <div className="acc-step"><i>2</i>Sub company</div>
              <label className="full">Sub Company Name *<input autoFocus value={sub.name} onChange={(e) => setSub({ ...sub, name: e.target.value })} required /></label>
              <label>PAN / VAT No.<input value={sub.pan} maxLength={9} inputMode="numeric" placeholder="9 digits"
                onChange={(e) => setSub({ ...sub, pan: e.target.value.replace(/\D/g, '') })} /></label>
              <label>Phone<input value={sub.phone} inputMode="tel" placeholder="98XXXXXXXX"
                onChange={(e) => setSub({ ...sub, phone: e.target.value.replace(/[^\d+\-/\s]/g, '') })} /></label>
              <label className="full">Address<input value={sub.address} onChange={(e) => setSub({ ...sub, address: e.target.value })} /></label>
            </div>
            <div className="actions">
              <span className="spacer" />
              <button type="button" className="ghost" onClick={() => setSub(null)}>Close <Kbd>Esc</Kbd></button>
              <button data-save disabled={!sub.parent_id || !sub.name.trim()}>Save <Kbd>Ctrl+S</Kbd></button>
            </div>
          </form>
        </div>
      )}

      {bulk && (
        <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && setBulk(null)}>
          <div className="card form acc-cardform" style={{ width: 'min(1000px, 96vw)' }}>
            <h2 className="acc-head"><span className="acc-head-ic">📋</span><span className="acc-head-txt">Bulk Import {word}s
              <small>Paste rows copied from Excel: {isCus ? 'SN, Ledger, PAN, Address, City, Office Phone, Email, Mobile, Customer Group, Contact Person' : 'Suppliers Name, PAN, Address, City, Office Phone, Home Phone, Email, Mobile'} (header row optional)</small></span></h2>
            <div className="acc-card">
              {!bulk.result && <>
                <textarea autoFocus rows={6} style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }} value={bulk.text}
                  onChange={(e) => setBulk({ ...bulk, text: e.target.value })} placeholder="Paste here (Ctrl+V) — header row optional" />
                <div className="muted small" style={{ margin: '8px 0' }}>
                  {bulkRows.length ? `${bulkRows.length} found — ${bulkNew.length} new, ${bulkRows.length - bulkNew.length} already exist / duplicate (skipped)` : 'Retail (MRP) → Retail price level, Dealer → Dealer, Partner → Partner. Existing names are never changed.'}
                </div>
                {bulkRows.length > 0 && (
                  <div style={{ maxHeight: 280, overflow: 'auto' }}>
                    <table className="grid"><thead><tr><th>#</th><th>Ledger</th><th>PAN</th><th>Address</th><th>City</th><th>Office</th><th>Email</th><th>Mobile</th><th>Group</th><th>Contact</th><th></th></tr></thead>
                      <tbody>{bulkRows.slice(0, 300).map((r, i) => { const dup = !bulkNew.includes(r); return (
                        <tr key={i} style={dup ? { opacity: 0.45 } : undefined}><td>{i + 1}</td><td>{r.name}</td><td>{r.pan}</td><td>{r.address}</td><td>{r.city}</td><td>{r.office_phone}</td><td>{r.email}</td><td>{r.phone}</td><td>{r.group}</td><td>{r.contact}</td><td>{dup ? 'skip' : 'new'}</td></tr>); })}</tbody></table>
                    {bulkRows.length > 300 && <div className="muted small">Showing first 300 rows…</div>}
                  </div>)}
              </>}
              {bulk.result && (
                <div>
                  <b>{bulk.result.added} added, {bulk.result.skipped} skipped.</b>
                  <div style={{ maxHeight: 280, overflow: 'auto', marginTop: 8, fontSize: 12 }}>
                    {bulk.result.results.filter((x) => x.status === 'skipped' || x.warnings?.length).map((x) => (
                      <div key={x.row}>#{x.row} {x.name}: {x.status === 'skipped' ? x.reason : x.warnings.join('; ')}</div>))}
                  </div>
                </div>)}
            </div>
            <div className="actions">
              <span className="spacer" />
              <button type="button" className="ghost" onClick={() => setBulk(null)}>Close <Kbd>Esc</Kbd></button>
              {!bulk.result && <button type="button" disabled={!bulkNew.length || bulk.busy} onClick={runBulk}>{bulk.busy ? 'Importing…' : `Import ${bulkNew.length}`}</button>}
            </div>
          </div>
        </div>
      )}

      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}

      {edit && (
        <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && setEdit(null)}>
          <form className="card party-full" onSubmit={save} autoComplete="off">
            <div className="pf-title">
              <span className="acc-head-ic">{edit.id ? '✏️' : '＋'}</span>
              <span className="acc-head-txt"><h2>{edit.id ? `Edit ${word}` : `New ${word}`}</h2><small>{edit.id ? `Update this ${word.toLowerCase()}'s details` : `Add a new ${word.toLowerCase()} with contacts and opening balance`}</small></span>
              {edit.id && <span className="dt-no">{edit.code}</span>}
              {edit.id && !edit.active && <span className="tag">inactive</span>}
            </div>

            <div className="doc-form pf-top">
              <div className="acc-step"><i>1</i>{word} details</div>
              <label>{word} / Company Name *<input autoFocus name="name" autoComplete="nope" value={edit.name} onChange={set('name')} required /></label>
              <label>PAN / VAT No.<input name="pan" autoComplete="nope" value={edit.pan || ''} onChange={(e) => setEdit({ ...edit, pan: e.target.value.replace(/\D/g, '') })} maxLength={9} inputMode="numeric" placeholder="9 digits" /></label>
              {isCus ? (
                <label>Type (default price)
                  <select value={edit.price_level} onChange={set('price_level')}>{LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                </label>
              ) : <label>Company Email<input name="email" autoComplete="nope" data-nocap value={edit.email || ''} onChange={set('email')} placeholder="info@company.com" /></label>}
              {isCus && <label>Company Email<input name="email" autoComplete="nope" data-nocap value={edit.email || ''} onChange={set('email')} placeholder="info@company.com" /></label>}
              <label>Office Phone<input name="office_phone" autoComplete="nope" inputMode="tel" className={badPhone(edit.office_phone) ? 'bad-field' : ''} value={edit.office_phone || ''} onChange={setPhone('office_phone')} placeholder="01-4xxxxxx" /></label>
              <label>Mobile No.<input name="phone" autoComplete="nope" inputMode="tel" className={badPhone(edit.phone) ? 'bad-field' : ''}
                value={edit.phone || ''} onChange={setPhone('phone')} placeholder="98XXXXXXXX" />
                {badPhone(edit.phone) && <small className="neg">“{edit.phone}” is not a phone number — type the number or clear it.</small>}</label>
              <label>WhatsApp Mobile No.<input name="whatsapp" autoComplete="nope" inputMode="tel" className={badPhone(edit.whatsapp) ? 'bad-field' : ''} value={edit.whatsapp || ''} onChange={setPhone('whatsapp')} placeholder="Bills & reminders go here" /></label>
              <label className={isCus ? '' : 'pf-wide'}>Address<input name="address" autoComplete="nope" value={edit.address || ''} onChange={set('address')} placeholder="Registered address" /></label>
            </div>

            <div className="doc-form pf-both">
              <label className="check"><input type="checkbox" name="also_other_role" checked={!!edit.also_other_role} onChange={set('also_other_role')} />
                {' '}Also a <b>{otherWord.toLowerCase()}</b> — this business {isCus ? 'sells to us as well' : 'buys from us as well'}.
                {' '}<span className="muted small">It gets a second ledger ({isCus ? 'payable' : 'receivable'}) with the same name, PAN and contacts; credit and balances stay separate.</span></label>
            </div>

            <div className="doc-form pay-row pf-acc">
              <div className="acc-step"><i>2</i>Opening balance &amp; credit</div>
              <label>Opening Balance
                <select value={edit.side} onChange={(e) => setEdit({ ...edit, side: e.target.value })}>
                  <option value="take">Need to take payment from them (Dr)</option>
                  <option value="pay">Need to make payment to them (Cr)</option>
                </select>
              </label>
              <label>Amount (Rs) at start of books<Amount type="number" step="0.01" min="0" autoComplete="nope" value={edit.amount} onChange={set('amount')} placeholder="0.00" /></label>
              <label>Credit Period (days)<input type="number" min="0" autoComplete="nope" value={edit.credit_days} onChange={set('credit_days')} placeholder="e.g. 30" /></label>
              <label>Credit Limit (Rs)<Amount type="number" min="0" autoComplete="nope" value={edit.credit_limit} onChange={set('credit_limit')} placeholder="0 = no limit" /></label>
              {edit.id && <label className="check"><input type="checkbox" checked={edit.active} onChange={set('active')} /> Active</label>}
            </div>

            <div className="acc-step acc-step-out"><i>3</i>Recommended transport</div>
            <div className="doc-form pf-trans">
              <label>Transport Name<input name="transport_name" autoComplete="nope" value={edit.transport_name || ''} onChange={set('transport_name')} placeholder="e.g. Sajha Yatayat Cargo" /></label>
              <label>Phone<input name="transport_phone" autoComplete="nope" inputMode="tel" value={edit.transport_phone || ''} onChange={setPhone('transport_phone')} placeholder="Transport office phone" /></label>
              <label>Address<input name="transport_address" autoComplete="nope" value={edit.transport_address || ''} onChange={set('transport_address')} placeholder="Branch / pick-up address" /></label>
            </div>

            <div className="pf-contacts-head">
              <span className="acc-step"><i>4</i>Contact persons <span className="tag">{edit.contacts.filter((c) => c.name).length}</span></span>
              <span className="spacer" />
              {picked.size > 0 && <button type="button" className="ghost btn-sm" onClick={() => { setEdit({ ...edit, contacts: edit.contacts.filter((_, i) => !picked.has(i)) }); setPicked(new Set()); }}>Remove selected ({picked.size})</button>}
              <button type="button" className="ghost add-line" tabIndex={-1} onClick={() => setEdit({ ...edit, contacts: [...edit.contacts, blankContact()] })}>＋ Add Contact</button>
            </div>
            <table className="grid entry bill-grid pf-contacts">
              <thead><tr><th className="sn"><input type="checkbox" tabIndex={-1} checked={picked.size > 0 && picked.size === edit.contacts.length}
                onChange={(e) => setPicked(e.target.checked ? new Set(edit.contacts.map((_, i) => i)) : new Set())} /></th>
                <th className="sn">SN</th><th>NAME</th><th>POST</th><th>DEPT</th><th>MOBILE 1</th><th>MOBILE 2</th><th>EMAIL</th><th>REMARKS</th><th style={{ width: 30 }} /></tr></thead>
              <tbody>{edit.contacts.map((c, i) => (
                <tr key={i}>
                  <td className="sn"><input type="checkbox" tabIndex={-1} checked={picked.has(i)} onChange={() => setPicked((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; })} /></td>
                  <td className="sn">{i + 1}</td>
                  <td><input value={c.name} placeholder="Full name" onChange={(e) => {
                    const contacts = edit.contacts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x));
                    if (i === contacts.length - 1 && e.target.value) contacts.push(blankContact());
                    setEdit({ ...edit, contacts });
                  }} /></td>
                  <td><input value={c.post || ''} onChange={(e) => setC(i, 'post', e.target.value)} /></td>
                  <td><input value={c.dept || ''} onChange={(e) => setC(i, 'dept', e.target.value)} /></td>
                  <td><input autoComplete="nope" inputMode="tel" value={c.mobile1 || ''} onChange={(e) => setC(i, 'mobile1', e.target.value.replace(/[^\d+\-/\s]/g, ''))} /></td>
                  <td><input autoComplete="nope" inputMode="tel" value={c.mobile2 || ''} onChange={(e) => setC(i, 'mobile2', e.target.value.replace(/[^\d+\-/\s]/g, ''))} /></td>
                  <td><input data-nocap autoComplete="nope" value={c.email || ''} onChange={(e) => setC(i, 'email', e.target.value)} /></td>
                  <td><input autoComplete="nope" value={c.remarks || ''} placeholder="e.g. call after 2 pm" onChange={(e) => setC(i, 'remarks', e.target.value)} /></td>
                  <td>{edit.contacts.length > 1 && <button type="button" className="link del-x" tabIndex={-1} onClick={() => setEdit({ ...edit, contacts: edit.contacts.filter((_, j) => j !== i) })}>✕</button>}</td>
                </tr>
              ))}</tbody>
            </table>

            <LastSaved row={edit} />
            <div className="actions pf-actions">
              {edit.id && <button type="button" className="ghost" onClick={() => { setEdit(null); ledger(edit); }}>📄 Ledger</button>}
              {edit.id && <button type="button" className="danger edit-only" onClick={() => remove()}>Delete <kbd className="kbd">Ctrl+Del</kbd></button>}
              <span className="spacer" />
              <button type="button" className="ghost" onClick={() => setEdit(null)}>Cancel <Kbd>Esc</Kbd></button>
              <button data-save>{edit.id ? 'Update' : 'Save'} {word.toLowerCase()} <Kbd>Ctrl+S</Kbd></button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
