import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from '../lib/router';
import { useApp } from '../context';
import { api, fmtMoney } from '../lib/api';
import { useShortcuts } from '../lib/keys';
import { AccountSelect, Amount, Kbd } from '../components/inputs';
import { fmtDateShort } from '../lib/dates';
import { amountInWords } from '../lib/words';
import DataGrid from '../../DataGrid/DataGrid.jsx';          // the very same grid as Staff Detail
import SearchableSelect from '../../Common/SearchableSelect.jsx';

const CURRENCIES = [['USD', '$ Dollar (USD)'], ['EUR', '€ Euro (EUR)'], ['CNY', '¥ Yuan (CNY)'], ['INR', '₹ Indian Rupee (INR)'], ['GBP', '£ Pound (GBP)'], ['NPR', 'Rs. Nepali Rupee (NPR)']];
const SYM = { USD: '$', EUR: '€', CNY: '¥', INR: '₹', GBP: '£', NPR: 'Rs.' };
const CUR_WORD = { USD: 'Dollars', EUR: 'Euros', CNY: 'Yuan', INR: 'Indian Rupees', GBP: 'Pounds', NPR: 'Rupees' };
const PAY_MODES = [['TT', 'TT (Telegraphic Transfer)'], ['LC', 'LC (Letter of Credit)'], ['Advance', 'Advance'], ['Credit', 'Credit'], ['Other', 'Other']];
const PAY_STATUS = ['Pending', 'TT Completed', 'Partly Paid', 'Paid', 'Cancelled'];
const EXP_CATS = [['Bank Expenses', '🏦', 'Bank charges, TT / LC commission, SWIFT, forex margin'], ['Customs Expenses', '🛃', 'Customs duty, VAT paid at customs, clearing fees'],
  ['Logistic Expenses', '🚢', 'Freight, insurance, port / handling, demurrage'], ['Agent Expenses', '🤝', 'Clearing & forwarding agent, commission'],
  ['Transportation & Others', '🚚', 'Local transport, labour, loading / unloading, other costs']];
const expCat = (t) => (EXP_CATS.some((c) => c[0] === t) ? t : t === 'Transportation Expenses' || t === 'Labour Expenses' ? 'Transportation & Others' : 'Bank Expenses');
const COUNTRIES = ['China', 'India', 'Hong Kong', 'Taiwan', 'Japan', 'South Korea', 'Singapore', 'Malaysia', 'Thailand', 'Vietnam', 'Indonesia', 'Bangladesh', 'Sri Lanka', 'Pakistan',
  'United Arab Emirates', 'Saudi Arabia', 'Qatar', 'Turkey', 'Germany', 'France', 'Italy', 'Spain', 'Netherlands', 'United Kingdom', 'Switzerland', 'Sweden', 'Poland',
  'Russia', 'United States', 'Canada', 'Brazil', 'Australia', 'New Zealand', 'South Africa', 'Egypt', 'Nepal'];
const TABS = [['detail', 'Purchase Detail'], ['docs', 'Payment & Documents'], ['exp', 'Import Expenses'], ['cost', 'Costing & Goods Arrived']];
const rs = (n) => `Rs.${fmtMoney(n).replace(/\.00$/, '')}`;
const fc = (cur, n) => `${SYM[cur] || cur}${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const blankRow = () => ({ _k: Math.random(), item_id: '', product_name: '', hs_code: '', rate: '', qty: '', remarks: '' });
/** ↑ / ↓ in the product grid: same column, previous / next row (the product search keeps ↑ ↓ for its list) — same as the Sales grid. */
function gridArrows(e) {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  const t = e.target;
  if (!(t instanceof HTMLElement) || t.closest('.acsel') || e.altKey) return;
  const td = t.closest('td'); const tr = td?.parentElement;
  const row = e.key === 'ArrowDown' ? tr?.nextElementSibling : tr?.previousElementSibling;
  const cell = row?.children[td.cellIndex];
  const el = cell && [...cell.querySelectorAll('input, select')].find((x) => !x.disabled && x.tabIndex !== -1);
  e.preventDefault();
  if (!el) return;
  el.focus(); el.select?.();
}
const dash = <span style={{ color: '#d1d5db' }}>—</span>;

/* ── Staff-Detail style building blocks: a titled panel and a labelled field ── */
const Panel = ({ title, right, children, style }) => (
  <div className="imp-pn" style={style}><div className="imp-pn-h"><span>{title}</span>{right}</div><div>{children}</div></div>
);
const Fg = ({ label, required, children, hint }) => (
  <div className="imp-fg"><div className="imp-fl">{label}{required && <b className="req"> *</b>}</div>{children}{hint && <div className="imp-hint">{hint}</div>}</div>
);

/** One document slot (PI, payment proof, CI, packing list …): list of uploaded files + Add File. */
function FileBox({ imp, slot, label, canEdit, reload, notify, required, compact }) {
  const ref = useRef(null);
  const files = imp.files[slot] || [];
  const pick = (f) => {
    if (!f) return;
    if (f.size > 8 * 1024 * 1024) { notify('File is larger than 8 MB.', 'err'); return; }
    const rd = new FileReader();
    rd.onload = async () => {
      try { await api.post(`/imports/${imp.id}/files`, { slot, name: f.name, data: rd.result }); await reload(imp.id); notify(`${label} uploaded`); }
      catch (e) { notify(e.message, 'err'); }
    };
    rd.readAsDataURL(f);
  };
  const del = async (file) => {
    if (!window.confirm('Remove this file?')) return;
    try { await api.del(`/imports/${imp.id}/files/${slot}/${file}`); await reload(imp.id); } catch (e) { notify(e.message, 'err'); }
  };
  return (
    <div className={`imp-files${compact ? ' imp-files-c' : ''}`}>
      <div className="imp-files-h">
        {!compact && <span>{label}{required && <b className="req"> *</b>}</span>}
        {canEdit && <button type="button" className="ghost imp-add" onClick={() => ref.current?.click()}>📎 {compact && files.length ? 'Add more' : 'Add File'}</button>}
        <input ref={ref} type="file" hidden accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e) => { pick(e.target.files[0]); e.target.value = ''; }} />
      </div>
      {files.length === 0 ? <div className="muted small">{compact ? (required ? 'Required — no file yet' : 'No file') : 'No files uploaded yet'}</div>
        : files.map((f) => (
          <div key={f.file} className="imp-file">
            <a href={`/api/accounts/imports/file/${f.file}`} target="_blank" rel="noopener">📄 {f.name}</a>
            {canEdit && <button type="button" className="link del-x" title="Remove" onClick={() => del(f.file)}>✕</button>}
          </div>
        ))}
    </div>
  );
}

/** Text / date field of the documents tab — saves itself when you leave it. */
function PanelField({ imp, name, label, type = 'text', canEdit, save, required, locked, row, cell }) {
  const [v, setV] = useState(imp[name] || '');
  useEffect(() => { setV(imp[name] || ''); }, [imp.id, imp[name]]); // eslint-disable-line react-hooks/exhaustive-deps
  const input = (
    <input className={cell ? 'imp-cell-in' : row ? '' : 'imp-in'} type={type} data-nocap value={v} disabled={!canEdit || locked}
      onChange={(e) => setV(e.target.value)} onBlur={() => { if ((v || '') !== (imp[name] || '')) save({ [name]: v }); }} />
  );
  if (cell) return input;
  if (row) return <label>{label}{required && <b className="req"> *</b>}{input}</label>;
  return <Fg label={label} required={required}>{input}</Fg>;
}

/** Bank exchange rate — optional when the PI is made; entered here once the bank gives it. Saves itself when you leave the box. */
function RateField({ imp, canEdit, save, row }) {
  const [v, setV] = useState(imp.exchange_rate > 0 ? String(Number(imp.exchange_rate)) : '');
  useEffect(() => { setV(imp.exchange_rate > 0 ? String(Number(imp.exchange_rate)) : ''); }, [imp.id, imp.exchange_rate]);
  const box = (
    <Amount className={row ? '' : 'imp-in'} decimals={4} value={v} disabled={!canEdit} onChange={(e) => setV(e.target.value)}
      onBlur={() => { if ((Number(v) || 0) !== (Number(imp.exchange_rate) || 0)) save({ exchange_rate: v }); }} />
  );
  const lab = `Bank Exchange Rate (${SYM[imp.currency] || imp.currency}1 = Rs.)`;
  if (row) return <label>{lab}{box}<small>Needed before goods can be received</small></label>;
  return <Fg label={lab} hint="Needed before the goods can be received">{box}</Fg>;
}

export default function Imports() {
  const { notify, canEdit, accounts, today } = useApp();
  const nav = useNavigate();
  const [rows, setRows] = useState(null);
  const [win, setWin] = useState(null);             // { id|null, tab }  — the Staff-style window
  const [form, setForm] = useState(null);           // Purchase Detail tab (new / edit)
  const [ex, setEx] = useState(null);               // Import Expenses tab draft: [{ _k, expense_type, title, amount }]
  const [arr, setArr] = useState(null);             // goods-arrived dialog
  const [suppliers, setSuppliers] = useState([]);
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [sp, setSp] = useSearchParams();

  const load = async () => { try { setRows(await api.get('/imports')); } catch (e) { notify(e.message, 'err'); setRows([]); } };
  useEffect(() => {
    load();
    api.get('/parties', { type: 'supplier' }).then(setSuppliers).catch(() => {});
    api.get('/items').then(setItems).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const reloadOne = async (id) => {
    const r = await api.get(`/imports/${id}`);
    setRows((a) => (a || []).map((x) => (x.id === id ? r : x)));
    return r;
  };
  const imp = win?.id ? (rows || []).find((r) => r.id === win.id) : null;
  const locked = !!imp?.arrived;

  const toForm = (r) => (r ? {
    id: r.id, pi_no: r.pi_no, pi_date: r.pi_date || '', supplier_id: r.supplier_id ? String(r.supplier_id) : '', country: r.country || 'China', payment_condition: r.payment_condition || '', custom_via: r.custom_via || '',
    payment_mode: r.payment_mode, payment_status: r.payment_status, payment_completed_date: r.payment_completed_date || '',
    currency: r.currency, exchange_rate: String(r.exchange_rate),
    items: r.items.map((i) => ({ _k: i.id, item_id: i.item_id ? String(i.item_id) : '', product_name: i.product_name, hs_code: i.hs_code || '', rate: String(i.rate), qty: String(i.qty), remarks: i.remarks || '' })),
  } : { pi_no: '', pi_date: today, supplier_id: '', country: 'China', payment_condition: '', custom_via: '', payment_mode: 'TT', payment_status: 'Pending', payment_completed_date: '', currency: 'USD', exchange_rate: '', items: [blankRow()] });

  const openWin = (r, tab = 'detail') => {
    if (!r && !canEdit) return;
    setForm(toForm(r)); setWin({ id: r ? r.id : null, tab });
  };
  const closeWin = () => { setWin(null); setForm(null); setPiPick(null); };
  useEffect(() => { if (sp.get('new') && canEdit && rows) { openWin(null); setSp({}, { replace: true }); } }, [sp, rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const setTab = (tab) => {
    if (!win.id && tab !== 'detail') { notify('Save the purchase detail first.', 'err'); return; }
    setWin({ ...win, tab });
  };

  const setItem = (k, patch) => setForm((f) => ({ ...f, items: f.items.map((r) => (r._k === k ? { ...r, ...patch } : r)) }));
  const pickProduct = (k, v) => {
    const it = items.find((x) => String(x.id) === String(v));
    setItem(k, it ? { item_id: String(it.id), product_name: it.name, hs_code: it.hs_code || '' } : { item_id: '' });
  };
  const itemOpts = useMemo(() => items.filter((i) => i.active).map((i) => ({ ...i,
    group_name: i.item_type === 'service' ? `${i.code} · service` : `${i.code} · stock ${i.stock} ${i.unit}` })), [items]);
  // F1 in a product cell → add a new product without leaving the form
  const [np, setNp] = useState(null);  // { k, name, hs_code, unit_id, category_id }
  const [units, setUnits] = useState([]);
  const [cats, setCats] = useState([]);
  const openNewProduct = async (k, typed) => {
    if (!canEdit || locked) return;
    try { if (!units.length) { const [u, c] = await Promise.all([api.get('/units'), api.get('/categories')]); setUnits(u); setCats(c); setNp({ k, name: typed || '', hs_code: '', category_id: '', unit_id: String((u.find((x) => x.name === 'Pcs') || u[0] || {}).id || '') }); return; } } catch (e) { notify(e.message, 'err'); return; }
    setNp({ k, name: typed || '', hs_code: '', category_id: '', unit_id: String((units.find((x) => x.name === 'Pcs') || units[0] || {}).id || '') });
  };
  const saveNewProduct = async () => {
    if (!np.name.trim()) { notify('Enter the product name.', 'err'); return; }
    if (!np.unit_id) { notify('Choose a unit.', 'err'); return; }
    try {
      const it = await api.post('/items', { name: np.name.trim(), hs_code: np.hs_code.trim(), unit_id: Number(np.unit_id), category_id: np.category_id ? Number(np.category_id) : null, item_type: 'goods' });
      const all = await api.get('/items'); setItems(all);
      setItem(np.k, { item_id: String(it.id), product_name: it.name, hs_code: it.hs_code || '' });
      setNp(null); notify(`Product ${it.name} added`);
    } catch (e) { notify(e.message, 'err'); }
  };
  const addRowRef = useRef(null);
  const addRow = () => {
    setForm((f) => ({ ...f, items: [...f.items, blankRow()] }));
    setTimeout(() => { const rows = document.querySelectorAll('.bill-grid tbody tr'); rows[rows.length - 1]?.querySelector('.acsel input')?.focus(); }, 0);
  };
  const formTotal = useMemo(() => (form ? form.items.reduce((s, r) => s + (Number(r.rate) || 0) * (Number(r.qty) || 0), 0) : 0), [form]);
  const formRate = form ? (form.currency === 'NPR' ? 1 : Number(imp?.exchange_rate) || 0) : 0;

  const [piPick, setPiPick] = useState(null);       // PI file chosen before the import is saved { name, data }
  const pickPi = (f) => {
    if (!f) return;
    if (f.size > 8 * 1024 * 1024) { notify('File is larger than 8 MB.', 'err'); return; }
    const rd = new FileReader(); rd.onload = () => setPiPick({ name: f.name, data: rd.result }); rd.readAsDataURL(f);
  };
  const piRef = useRef(null);
  const saveForm = async (e) => {
    e?.preventDefault();
    if (!form || busy || locked) return;
    setBusy(true);
    try {
      const body = { ...form, items: form.items.filter((r) => r.product_name || r.item_id || r.qty || r.rate) };
      let r = form.id ? await api.put(`/imports/${form.id}`, body) : await api.post('/imports', body);
      if (!form.id && piPick) { try { r = await api.post(`/imports/${r.id}/files`, { slot: 'pi', name: piPick.name, data: piPick.data }); } catch (e2) { notify(`Saved, but the PI file failed: ${e2.message}`, 'err'); } }
      setPiPick(null);
      await load();
      setForm(toForm(r)); setWin({ id: r.id, tab: form.id ? 'detail' : 'docs' });
      notify(`Import ${r.pi_no} saved${form.id ? '' : ' — now add the payment and shipping documents'}`);
    } catch (err) { notify(err.message, 'err'); }
    setBusy(false);
  };

  /* ───── expenses ───── */
  const openExp = (r) => {
    if (r.arrived) { notify('Goods already arrived — expenses are locked.', 'err'); return; }
    openWin(r, 'exp');
  };
  const expFrom = (r) => (r ? r.expenses.map((e) => ({ _k: e.id, expense_type: expCat(e.expense_type), title: e.title, amount: String(Number(e.amount)) })) : []);
  useEffect(() => { if (win?.tab === 'exp' && win.id) setEx(expFrom((rows || []).find((x) => x.id === win.id))); }, [win?.tab, win?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const exSet = (k, patch) => setEx((l) => l.map((x) => (x._k === k ? { ...x, ...patch } : x)));
  const exAdd = (cat) => setEx((l) => [...l, { _k: Math.random(), expense_type: cat, title: '', amount: '' }]);
  const exTotal = (cat) => (ex || []).filter((x) => !cat || x.expense_type === cat).reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const saveExp = async () => {
    if (!ex || !imp || busy || locked) return;
    setBusy(true);
    try {
      const r = await api.put(`/imports/${imp.id}/expenses`, { expenses: ex });
      setRows((a) => a.map((x) => (x.id === r.id ? r : x)));
      setEx(expFrom(r)); notify('Expenses saved');
    } catch (err) { notify(err.message, 'err'); }
    setBusy(false);
  };

  const savePanel = async (patch) => {
    try { const data = await api.patch(`/imports/${imp.id}/panel`, patch); setRows((a) => a.map((x) => (x.id === data.id ? data : x))); }
    catch (e) { notify(e.message, 'err'); }
  };

  /* ───── goods arrived ───── */
  const openArrive = (r) => {
    if (r.arrived) { notify(`Already arrived — Purchase ${r.pb_doc_no}`); return; }
    if (r.missing.length) { notify(`Complete these first:\n• ${r.missing.join('\n• ')}`, 'err'); openWin(r, 'cost'); return; }
    setArr({ r, date: today, bank: '', serials: {} });
  };
  const arrive = async () => {
    if (!arr || busy) return;
    setBusy(true);
    try {
      const out = await api.post(`/imports/${arr.r.id}/arrive`, { arrival_date: arr.date, bank_account_id: arr.bank || null, serials: arr.serials });
      setRows((a) => a.map((x) => (x.id === out.import.id ? out.import : x)));
      setArr(null); notify(`Goods arrived — Purchase ${out.purchase.doc_no} posted and stock updated`);
    } catch (err) { notify(err.message, 'err'); }
    setBusy(false);
  };

  /* ───── bank payment to the supplier (Payment voucher: Dr Supplier, Cr Bank) ───── */
  const [bp, setBp] = useState(null);
  const openBankPay = (r) => {
    if (!r.supplier_id) { notify('Choose the supplier on the Purchase Detail tab first.', 'err'); return; }
    const banks = accounts.filter((a) => a.kind === 'bank');
    if (!banks.length) { notify('Add a bank account first (Chart of Accounts).', 'err'); return; }
    setBp({ r, bank: String(banks[0].id), date: today, amount: String(Number(r.grand_total) || ''), rate: r.currency === 'NPR' ? '1' : (Number(r.exchange_rate) > 0 ? String(Number(r.exchange_rate)) : ''), ref: `TT ${r.pi_no}` });
  };
  const bpNpr = bp ? Math.round((Number(bp.amount) || 0) * (bp.r.currency === 'NPR' ? 1 : Number(bp.rate) || 0) * 100) / 100 : 0;
  const saveBankPay = async () => {
    if (!bp || busy) return;
    if (!bp.bank) { notify('Choose the bank account.', 'err'); return; }
    if (!(Number(bp.amount) > 0)) { notify('Enter the amount paid.', 'err'); return; }
    if (bp.r.currency !== 'NPR' && !(Number(bp.rate) > 0)) { notify('Enter the bank exchange rate used for this payment.', 'err'); return; }
    setBusy(true);
    try {
      const r = bp.r;
      const v = await api.post('/vouchers', {
        vtype: 'PV', kind: 'supplier_payment', vdate: bp.date, reference: bp.ref || null,
        narration: `Import ${r.pi_no} — bank payment to ${r.supplier_name}${r.currency === 'NPR' ? '' : ` (${fc(r.currency, bp.amount)} × ${bp.rate})`}`,
        lines: [{ account_id: r.supplier_id, dr: bpNpr, cr: 0 }, { account_id: +bp.bank, dr: 0, cr: bpNpr }],
      });
      const patch = { payment_status: Number(bp.amount) + 0.005 >= Number(r.grand_total) ? 'Paid' : 'Partly Paid', payment_completed_date: bp.date };
      if (!r.arrived && r.currency !== 'NPR' && !(Number(r.exchange_rate) > 0)) patch.exchange_rate = bp.rate;
      const data = await api.patch(`/imports/${r.id}/panel`, patch);
      setRows((a) => a.map((x) => (x.id === data.id ? data : x)));
      setBp(null); notify(`Bank payment posted — ${v.voucher_no}`);
    } catch (err) { notify(err.message, 'err'); }
    setBusy(false);
  };

  const remove = async (r) => {
    if (r.arrived) { notify('Goods already arrived — cancel the Purchase first.', 'err'); return; }
    if (!window.confirm(`Delete import ${r.pi_no}? Its files and expenses are deleted too.`)) return;
    try { await api.del(`/imports/${r.id}`); await load(); notify('Deleted'); } catch (e) { notify(e.message, 'err'); }
  };

  const onWin = !!win && !arr && !bp && !np;
  useShortcuts({ save: () => { if (win?.tab === 'detail') saveForm(); else if (win?.tab === 'exp') saveExp(); }, close: closeWin }, onWin);
  useShortcuts({ save: () => saveNewProduct(), close: () => setNp(null) }, !!np);
  useShortcuts({ save: () => saveBankPay(), close: () => setBp(null) }, !!bp);
  useShortcuts({ save: () => arrive(), close: () => setArr(null) }, !!arr);

  /* ───── the grid (same component and behaviour as Staff Detail) ───── */
  const statusBadge = (r) => (r.arrived
    ? <span className="imp-badge imp-arrived" title={`Purchase ${r.pb_doc_no}`}>Arrived · {r.pb_doc_no?.split('/').pop()}</span>
    : r.missing.length ? <span className="imp-badge imp-wait" title={r.missing.join('\n')}>In transit · {r.missing.length} to do</span>
      : <span className="imp-badge imp-ready">Ready to receive</span>);
  const columns = [
    { field: 'pi_no', header: 'PI No', width: 110, render: (v) => <b>{v}</b> },
    { field: 'pi_date', header: 'PI Date', width: 100, render: (v) => (v ? fmtDateShort(v) : dash) },
    { field: 'supplier_name', header: 'Import From', width: 190, render: (v, r) => v || r.import_from || dash },
    { field: 'country', header: 'Country', width: 90, render: (v) => v || dash },
    { field: 'payment_status', header: 'Payment', width: 140, render: (v, r) => `${r.payment_mode} · ${v}` },
    { field: 'id', header: 'Status', width: 150, render: (_v, r) => statusBadge(r) },
    { field: 'items', header: 'Products', width: 260, render: (v) => v.map((it) => `${it.product_name} × ${Number(it.qty).toLocaleString('en-IN')}`).join(', ') },
    { field: 'grand_total', header: 'PI Amount', width: 110, render: (v, r) => <span style={{ display: 'block', textAlign: 'right' }}>{fc(r.currency, v)}</span> },
    { field: 'total_tt_npr', header: 'Total TT (Rs.)', width: 120, render: (v) => <span style={{ display: 'block', textAlign: 'right' }}>{rs(v)}</span> },
    { field: 'costing', header: 'Landed Cost (Rs.)', width: 130, render: (v) => <b style={{ display: 'block', textAlign: 'right' }}>{rs(v.landed_total)}</b> },
    { field: 'arrival_date', header: 'Godown', width: 100, render: (v, r) => (r.arrived ? (v ? fmtDateShort(v) : '✓') : dash) },
  ];
  const ctx = [
    ...(canEdit ? [{ label: 'Add New', icon: '➕', onClick: () => openWin(null) }, 'divider'] : []),
    { label: 'Edit', icon: '✏️', onClick: (r) => openWin(r), visible: () => canEdit },
    { label: 'Delete', icon: '🗑', onClick: (r) => remove(r), visible: () => canEdit },
    'divider',
    { label: 'Bank Payment', icon: '🏦', onClick: (r) => openBankPay(r), visible: () => canEdit },
    { label: 'Add Expenses', icon: '💰', onClick: (r) => openExp(r), visible: () => canEdit },
    { label: 'View Costing', icon: '👁', onClick: (r) => openWin(r, 'cost') },
    { label: 'Goods Arrived in Godown', icon: '📦', onClick: (r) => openArrive(r), visible: (r) => canEdit && !r.arrived },
    { label: (r) => `Open Purchase ${r.pb_doc_no}`, icon: '🧾', onClick: () => nav('/docs/PB'), visible: (r) => r.arrived },
  ];

  const docStep = (ok, text) => <li className={ok ? 'ok' : ''}>{ok ? '✓' : '○'} {text}</li>;

  return (
    <>
      <DataGrid
        title="📦 Import Purchases"
        toolbar={canEdit && <button className="btn btn-primary" style={{ height: 32, fontSize: 13 }} onClick={() => openWin(null)}>+ New Import <kbd className="kbd">F1</kbd></button>}
        columns={columns}
        data={rows || []}
        loading={rows === null}
        defaultPageSize={25}
        showSearch
        showFilterButton={false}
        searchPlaceholder="Search PI, supplier, product, CI…"
        extraSearchFields={['import_from', 'ci_no', 'packing_list_no', 'customs_doc_no', 'pb_doc_no']}
        compact
        fillToBottom
        remarks={(r) => (
          <div>
            <b>PI {r.pi_no} — {r.supplier_name || r.import_from}:</b> {r.items.map((i) => `${i.product_name} × ${Number(i.qty).toLocaleString('en-IN')}`).join(', ')}.{' '}
            {r.arrived
              ? <>Goods arrived{r.arrival_date ? ` on ${fmtDateShort(r.arrival_date)}` : ''} — Purchase <b>{r.pb_doc_no}</b>.</>
              : r.missing.length ? <span style={{ color: '#b45309' }}>Still needed before Goods Arrived: {r.missing.join('; ')}.</span> : <span style={{ color: '#047857' }}>All documents are in — ready for Goods Arrived in Godown.</span>}
            {' '}CI {r.ci_no || '—'} · Packing List {r.packing_list_no || '—'} · Customs {r.customs_doc_no || '—'}
          </div>
        )}
        onRowDoubleClick={(r) => openWin(r)}
        contextMenu={ctx}
      />

      {/* ───── the window: Staff Detail look — header, tabs, titled panels, footer ───── */}
      {win && form && (
        <div className="imp-ov">
          <div className="imp-win" onClick={(e) => e.stopPropagation()}>
            <div className="imp-win-h">
              <div className="imp-win-ic">{win.id ? '✏️' : '＋'}</div>
              <div className="imp-win-t"><h2>{win.id ? `Import Purchase — ${imp?.pi_no || form.pi_no}` : 'New Import Purchase'}</h2>
                <p>{locked ? `Goods arrived — Purchase ${imp.pb_doc_no}. Cancel that purchase to change this import.` : 'PI → payment → shipping documents → goods arrived in godown'}</p></div>
              <button type="button" className="imp-x" onClick={closeWin}>✕</button>
            </div>
            <div className="imp-tabs">
              {TABS.map(([k, l]) => <button key={k} type="button" className={`tab-btn ${win.tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{l}</button>)}
            </div>

            <div className="imp-win-b">
              {win.tab === 'detail' && (
                <fieldset disabled={locked || !canEdit} className="imp-fs">
                  <div className="imp-pn" style={{ marginBottom: 12 }}>
                    <div className="imp-pn-h"><span>Purchase Information</span></div>
                    <div className="doc-form imp-top" style={{ margin: 0, padding: '14px 16px 6px' }}>
                      <label>PI No *<input autoFocus data-nocap value={form.pi_no} onChange={(e) => setForm({ ...form, pi_no: e.target.value })} /></label>
                      <label>PI Date<input type="date" value={form.pi_date} onChange={(e) => setForm({ ...form, pi_date: e.target.value })} /></label>
                      <label>Import From (Supplier) *
                        <SearchableSelect value={form.supplier_id} onChange={(v) => setForm({ ...form, supplier_id: v })} placeholder="— Select supplier —"
                          options={suppliers.filter((x) => x.active).map((x) => ({ value: String(x.id), label: x.name, sub: x.address || '' }))} />
                        <small>Not listed? <a onClick={() => nav('/suppliers?new=1')}>Add the supplier first</a></small>
                      </label>
                      <label>Country
                        <SearchableSelect value={form.country} onChange={(v) => setForm({ ...form, country: v })} placeholder="— Select country —"
                          options={(COUNTRIES.includes(form.country) || !form.country ? COUNTRIES : [form.country, ...COUNTRIES]).map((c) => ({ value: c, label: c }))} />
                      </label>
                    </div>
                    <div className="doc-form imp-top2" style={{ margin: 0, padding: '6px 16px 14px' }}>
                      <label>Payment Mode<select value={form.payment_mode} onChange={(e) => setForm({ ...form, payment_mode: e.target.value })}>{PAY_MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
                      <label>{form.payment_mode === 'LC' ? 'LC' : 'TT'} Condition<input value={form.payment_condition} placeholder={form.payment_mode === 'LC' ? 'e.g. LC at sight, 60 days usance' : 'e.g. 30% advance, 70% before shipment'} onChange={(e) => setForm({ ...form, payment_condition: e.target.value })} /></label>
                      <label>Custom Via<input value={form.custom_via} placeholder="e.g. Birgunj / Rasuwagadhi" onChange={(e) => setForm({ ...form, custom_via: e.target.value })} /></label>
                      <label>Invoice Currency<select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>{CURRENCIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
                      <div className="imp-pi-up">
                        <span className="imp-pi-l">Upload PI</span>
                        {imp ? <FileBox imp={imp} slot="pi" label="PI file" canEdit={canEdit && !locked} reload={reloadOne} notify={notify} />
                          : <div className="imp-files">
                            <div className="imp-files-h">
                              <button type="button" className="ghost imp-add" onClick={() => piRef.current?.click()}>📎 {piPick ? 'Change' : 'Add File'}</button>
                              <input ref={piRef} type="file" hidden accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e) => { pickPi(e.target.files[0]); e.target.value = ''; }} />
                            </div>
                            {piPick ? <div className="imp-file">📄 {piPick.name} <button type="button" className="link del-x" onClick={() => setPiPick(null)}>✕</button></div> : <div className="muted small">Photo or PDF, up to 8 MB</div>}
                          </div>}
                      </div>
                    </div>
                  </div>
                  <Panel title="Products" style={{ overflow: "visible" }}>
                    <table className="grid entry bill-grid">
                      <thead><tr>
                        <th className="sn">SN</th><th style={{ minWidth: 280 }}>PRODUCT NAME</th><th style={{ width: 110 }}>HS CODE</th>
                        <th className="num" style={{ width: 90 }}>QTY</th><th className="num" style={{ width: 130 }}>RATE ({SYM[form.currency] || form.currency})</th>
                        <th className="num" style={{ width: 140 }}>TOTAL ({SYM[form.currency] || form.currency})</th><th style={{ minWidth: 180 }}>REMARKS</th><th style={{ width: 30 }} />
                      </tr></thead>
                      <tbody onKeyDown={(e) => { if (e.key === 'F1' && !e.ctrlKey && !e.altKey && !e.shiftKey && e.target.closest?.('.acsel')) { e.preventDefault(); e.stopPropagation(); const row = e.target.closest('tr'); const k = form.items[[...row.parentNode.children].indexOf(row)]?._k; if (k != null) openNewProduct(k, e.target.value && !form.items.find((x) => x._k === k)?.item_id ? e.target.value : ''); return; } gridArrows(e); }}>
                        {form.items.map((r, i) => (
                          <tr key={r._k}>
                            <td className="sn">{i + 1}</td>
                            <td><AccountSelect accounts={itemOpts} value={r.item_id ? Number(r.item_id) : null} onChange={(v) => pickProduct(r._k, v)} placeholder="Search product…" onNew={(typed) => openNewProduct(r._k, typed)}
                              onEmptyEnter={() => addRowRef.current?.focus()} /></td>
                            <td><input data-nocap value={r.hs_code} onChange={(e) => setItem(r._k, { hs_code: e.target.value })} /></td>
                            <td><input className="num qty" type="number" min="0" step="0.001" value={r.qty} onChange={(e) => setItem(r._k, { qty: e.target.value })} /></td>
                            <td><Amount className="num rate" decimals={4} value={r.rate} onChange={(e) => setItem(r._k, { rate: e.target.value })}
                              onKeyDown={(e) => { if (e.key === 'Enter' && i === form.items.length - 1 && (Number(r.qty) || 0) > 0) { e.preventDefault(); addRow(); } }} /></td>
                            <td className="num tot">{(Number(r.rate) || 0) * (Number(r.qty) || 0) ? fc(form.currency, (Number(r.rate) || 0) * (Number(r.qty) || 0)) : '—'}</td>
                            <td><input value={r.remarks || ''} placeholder="Remarks" onChange={(e) => setItem(r._k, { remarks: e.target.value })} /></td>
                            <td>{form.items.length > 1 && <button type="button" className="link del-x" tabIndex={-1} title="Remove line" onClick={() => setForm({ ...form, items: form.items.filter((x) => x._k !== r._k) })}>✕</button>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="inv-foot tight">
                      <div className="words">
                        <button type="button" ref={addRowRef} className="ghost add-line" tabIndex={-1} onClick={addRow}>＋ Add Product</button>
                        <div className="section-label">IN WORDS</div>
                        <div className="words-box">{amountInWords(Math.round(formTotal)).replace(/Rupees?/i, CUR_WORD[form.currency] || form.currency)}</div>
                      </div>
                      <div className="total-card">
                        <div className="grand"><span>Grand Total</span><b>{fc(form.currency, formTotal)}</b></div>
                        {formRate > 0 && form.currency !== 'NPR' && <div className="muted"><span>In Nrs. @ {formRate}</span><b>{rs(formTotal * formRate)}</b></div>}
                      </div>
                    </div>
                  </Panel>
                  <div style={{ height: 220 }} />
                </fieldset>
              )}

              {win.tab === 'docs' && imp && (
                <>
                  <Panel title="Payment" right={canEdit && imp.supplier_id ? <button type="button" className="ghost imp-add" onClick={() => openBankPay(imp)}>🏦 Bank Payment</button> : null}>
                    <div className="doc-form imp-pay" style={{ margin: 0, padding: '16px 18px' }}>
                      <label>Payment Mode<span className="imp-static">{imp.payment_mode}{imp.payment_condition ? ` — ${imp.payment_condition}` : ''}</span></label>
                      <label>Payment Status<select disabled={!canEdit} value={imp.payment_status} onChange={(e) => savePanel({ payment_status: e.target.value })}>{PAY_STATUS.map((s) => <option key={s}>{s}</option>)}</select></label>
                      <PanelField row imp={imp} name="payment_completed_date" label="Date TT / Payment Date" type="date" canEdit={canEdit} save={savePanel} />
                      {imp.currency !== 'NPR' ? <RateField row imp={imp} canEdit={canEdit && !locked} save={savePanel} /> : <label>Exchange Rate<span className="imp-static">Rs. (no conversion)</span></label>}
                      <label>Total TT in Nrs.<span className="imp-static blue">{imp.costing.rate > 0 ? rs(imp.total_tt_npr) : '— enter the rate —'}</span></label>
                      <PanelField row imp={imp} name="est_ready_date" label="Estimate Goods Ready Date" type="date" canEdit={canEdit} save={savePanel} />
                    </div>
                  </Panel>
                  <Panel title="Documents" style={{ marginTop: 16 }}>
                    <div className="imp-tw">
                      <table className="imp-t imp-docs">
                        <thead><tr><th style={{ width: 210 }}>Document</th><th style={{ width: 200 }}>Number</th><th style={{ width: 160 }}>Date</th><th>Files</th></tr></thead>
                        <tbody>
                        <tr>
                          <td><b>Proforma Invoice (PI)</b></td>
                          <td><span className="muted">—</span></td>
                          <td><span className="muted">—</span></td>
                          <td><FileBox compact imp={imp} slot="pi" label="Proforma Invoice (PI)" canEdit={canEdit} reload={reloadOne} notify={notify} /></td>
                        </tr>
                        <tr>
                          <td><b>Payment Proof</b></td>
                          <td><span className="muted">—</span></td>
                          <td><span className="muted">—</span></td>
                          <td><FileBox compact imp={imp} slot="payment_proof" label="Payment Proof" canEdit={canEdit} reload={reloadOne} notify={notify} /></td>
                        </tr>
                        <tr>
                          <td><b>Commercial Invoice (CI)</b> <b className="req">*</b></td>
                          <td><PanelField cell imp={imp} name="ci_no" canEdit={canEdit} save={savePanel} /></td>
                          <td><PanelField cell imp={imp} name="ci_date" type="date" canEdit={canEdit} save={savePanel} /></td>
                          <td><FileBox compact imp={imp} slot="commercial_invoice" label="Commercial Invoice (CI)" canEdit={canEdit} reload={reloadOne} notify={notify} required /></td>
                        </tr>
                        <tr>
                          <td><b>Packing List</b> <b className="req">*</b></td>
                          <td><PanelField cell imp={imp} name="packing_list_no" canEdit={canEdit} save={savePanel} /></td>
                          <td><span className="muted">—</span></td>
                          <td><FileBox compact imp={imp} slot="packing_list" label="Packing List" canEdit={canEdit} reload={reloadOne} notify={notify} required /></td>
                        </tr>
                        <tr>
                          <td><b>Customs Document</b> <b className="req">*</b></td>
                          <td><PanelField cell imp={imp} name="customs_doc_no" canEdit={canEdit} save={savePanel} /></td>
                          <td><PanelField cell imp={imp} name="customs_doc_date" type="date" canEdit={canEdit} save={savePanel} /></td>
                          <td><FileBox compact imp={imp} slot="customs" label="Customs Document" canEdit={canEdit} reload={reloadOne} notify={notify} /></td>
                        </tr>
                        <tr>
                          <td><b>Bank (Bipini) Documents</b></td>
                          <td><span className="muted">—</span></td>
                          <td><span className="muted">—</span></td>
                          <td><FileBox compact imp={imp} slot="bank_docs" label="Bank (Bipini) Documents" canEdit={canEdit} reload={reloadOne} notify={notify} /></td>
                        </tr>
                        </tbody>
                      </table>
                    </div>
                    <div className="imp-hint" style={{ padding: '0 18px 14px' }}>* The Commercial Invoice and Packing List files, and the CI, Packing List and Customs numbers, are needed before goods can be received.</div>
                  </Panel>
                </>
              )}

              {win.tab === 'exp' && imp && ex && (
                <fieldset disabled={locked || !canEdit} className="imp-fs">
                  <div className="imp-exp-note">Amounts in Rs. They raise the landed cost per unit of each product; they are not posted again as expenses.</div>
                  <div className="imp-exp-grid">
                    {EXP_CATS.map(([cat, ic, hint]) => {
                      const list = ex.filter((x) => x.expense_type === cat);
                      return (
                        <Panel key={cat} title={`${ic} ${cat}`} right={<b className="green">{rs(exTotal(cat))}</b>}>
                          <div className="imp-hint" style={{ padding: '8px 18px 0' }}>{hint}</div>
                          <table className="imp-t imp-docs">
                            <tbody>
                              {list.length === 0 && <tr><td className="muted" colSpan={3}>No {cat.toLowerCase()} added.</td></tr>}
                              {list.map((x) => (
                                <tr key={x._k}>
                                  <td><input className="imp-cell-in" value={x.title} placeholder="Title / description" onChange={(e) => exSet(x._k, { title: e.target.value })} /></td>
                                  <td style={{ width: 150 }}><Amount className="imp-cell-in r" value={x.amount} placeholder="0.00" onChange={(e) => exSet(x._k, { amount: e.target.value })} /></td>
                                  <td className="c" style={{ width: 34 }}><button type="button" className="link del-x" tabIndex={-1} title="Remove" onClick={() => setEx((l) => l.filter((y) => y._k !== x._k))}>✕</button></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <div style={{ padding: '4px 18px 14px' }}><button type="button" className="ghost imp-add" onClick={() => exAdd(cat)}>＋ Add {cat === 'Transportation & Others' ? 'Expense' : cat.replace(' Expenses', '') + ' Expense'}</button></div>
                        </Panel>
                      );
                    })}
                  </div>
                  <div className="imp-pn imp-exp-total">
                    <div className="imp-exp-sum">
                      {EXP_CATS.map(([cat]) => <div key={cat}><span>{cat}</span><b>{rs(exTotal(cat))}</b></div>)}
                      <div className="grand"><span>Total Import Expenses</span><b>{rs(exTotal())}</b></div>
                    </div>
                    <div className="muted small" style={{ padding: '0 18px 14px' }}>In Words: {amountInWords(Math.round(exTotal()))}</div>
                  </div>
                </fieldset>
              )}

              {win.tab === 'cost' && imp && (() => {
                const c = imp.costing;
                return (
                  <div className="imp-cols imp-cols2">
                    <div className="imp-stack">
                      <Panel title="Product Costing" right={<span className="imp-mrp">MRP multiplier <input className="imp-in" style={{ width: 70 }} defaultValue={imp.mrp_multiplier || ''} placeholder="e.g. 2" disabled={!canEdit}
                        onBlur={(e) => savePanel({ mrp_multiplier: e.target.value })} /></span>}>
                        <div className="imp-tw">
                          <table className="imp-t"><thead><tr><th style={{ width: 40 }}>SN</th><th>Product</th><th>HS Code</th><th className="num">Qty</th><th className="num">Rate ({SYM[imp.currency] || imp.currency})</th><th className="num">Total ({SYM[imp.currency] || imp.currency})</th><th className="num">In Nrs.</th><th className="num">+ Expenses</th><th className="num">Cost / Unit</th><th className="num">MRP</th></tr></thead>
                            <tbody>{c.rows.map((x, i) => <tr key={x.id}><td className="c">{i + 1}</td><td>{x.product_name}</td><td>{x.hs_code}</td><td className="num">{Number(x.qty).toLocaleString('en-IN')}</td><td className="num">{fc(imp.currency, x.rate)}</td><td className="num">{fc(imp.currency, x.total)}</td><td className="num blue">{rs(x.npr)}</td><td className="num">{rs(x.share)}</td><td className="num green b">{rs(x.cost_unit)}</td><td className="num">{x.mrp ? rs(x.mrp) : ''}</td></tr>)}</tbody></table>
                        </div>
                        <div className="imp-sums">
                          <div>Products (In Nrs.): <b>{rs(c.products_npr)}</b></div><div>+ Expenses: <b>{rs(c.expenses_npr)}</b></div>
                          <div className="green" style={{ fontSize: 15 }}><b>Total Landed Cost: {rs(c.landed_total)}</b></div>
                        </div>
                      </Panel>
                      <Panel title="Expenses by category" right={!locked && canEdit ? <button type="button" className="ghost imp-add" onClick={() => openExp(imp)}>💰 Edit Expenses</button> : null}>
                        <div className="imp-tw"><table className="imp-t"><thead><tr><th>Category</th><th className="num">Amount (Rs.)</th></tr></thead>
                          <tbody>{EXP_CATS.map(([cat]) => <tr key={cat}><td>{cat}</td><td className="num">{rs(imp.expenses.filter((e) => expCat(e.expense_type) === cat).reduce((s, e) => s + Number(e.amount), 0))}</td></tr>)}
                            <tr><td><b>Total expenses</b></td><td className="num"><b>{rs(imp.costing.expenses_npr)}</b></td></tr></tbody></table></div>
                      </Panel>
                    </div>
                    <div className="imp-stack">
                      <Panel title="Goods Arrived in Godown">
                        <div className="imp-pad">
                          {imp.arrived ? (
                            <div className="imp-done">✅ Goods arrived{imp.arrival_date ? ` on ${fmtDateShort(imp.arrival_date)}` : ''}.<br />Purchase <b>{imp.pb_doc_no}</b> was posted and the stock is in the godown at landed cost {rs(c.landed_total)}.</div>
                          ) : (
                            <>
                              <div className="imp-fl" style={{ marginBottom: 6 }}>Must be complete before the goods can be received:</div>
                              <ul className="imp-check">
                                {docStep(!!imp.supplier_id, 'Supplier chosen')}
                                {docStep(imp.items.length > 0 && imp.items.every((i) => i.item_id), 'Every product matched to an Accounts product')}
                                {docStep(!!imp.ci_no, 'Commercial Invoice (CI) No.')}
                                {docStep(imp.files.commercial_invoice.length > 0, 'Commercial Invoice file')}
                                {docStep(!!imp.packing_list_no, 'Packing List No.')}
                                {docStep(imp.files.packing_list.length > 0, 'Packing List file')}
                                {docStep(!!imp.customs_doc_no, 'Customs Document No.')}
                              </ul>
                              <div className="imp-hint" style={{ margin: '8px 0' }}>Nothing reaches Purchases or Stock until you click the button below.</div>
                              {canEdit && <button type="button" className="imp-go" disabled={imp.missing.length > 0} onClick={() => openArrive(imp)}>📦 Goods Arrived in Godown</button>}
                            </>
                          )}
                        </div>
                      </Panel>
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="imp-win-f">
              <span className="imp-hint">{imp?.updated_by ? `Last saved by ${imp.updated_by}` : ''}</span>
              <div style={{ display: 'flex', gap: 10, marginLeft: 'auto' }}>
                <button type="button" className="btn btn-outline" onClick={closeWin}>{win.tab === 'detail' ? 'Cancel' : 'Close'} <Kbd>Esc</Kbd></button>
                {win.tab === 'detail' && canEdit && !locked && <button type="button" className="btn btn-primary" disabled={busy} onClick={saveForm}>💾 Save <Kbd>Ctrl+S</Kbd></button>}
                {win.tab === 'exp' && canEdit && !locked && <button type="button" className="btn btn-primary" disabled={busy} onClick={saveExp}>💾 Save Expenses <Kbd>Ctrl+S</Kbd></button>}
                {win.id && imp && !imp.arrived && canEdit && win.tab !== 'cost' && <button type="button" className="imp-go imp-go-sm" disabled={imp.missing.length > 0} title={imp.missing.length ? 'Complete the documents first' : ''} onClick={() => openArrive(imp)}>📦 Goods Arrived in Godown</button>}
              </div>
            </div>
          </div>
        </div>
      )}

      {np && (
        <div className="imp-ov imp-ov2">
          <div className="imp-win imp-win-sm">
            <div className="imp-win-h"><div className="imp-win-ic">📦</div><div className="imp-win-t"><h2>New Product</h2><p>Added to Products and selected on this line</p></div><button type="button" className="imp-x" onClick={() => setNp(null)}>✕</button></div>
            <div className="imp-win-b">
              <div className="doc-form" style={{ margin: 0, gridTemplateColumns: '1fr 1fr' }}>
                <label style={{ gridColumn: '1 / -1' }}>Product Name *<input autoFocus data-nocap value={np.name} onChange={(e) => setNp({ ...np, name: e.target.value })} /></label>
                <label>HS Code<input data-nocap value={np.hs_code} onChange={(e) => setNp({ ...np, hs_code: e.target.value })} /></label>
                <label>Unit *<select value={np.unit_id} onChange={(e) => setNp({ ...np, unit_id: e.target.value })}>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
                <label style={{ gridColumn: '1 / -1' }}>Category<select value={np.category_id} onChange={(e) => setNp({ ...np, category_id: e.target.value })}><option value="">— none —</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.parent_name ? `${c.parent_name} › ` : ''}{c.name}</option>)}</select></label>
              </div>
            </div>
            <div className="imp-win-f"><span /><div style={{ display: 'flex', gap: 10 }}>
              <button type="button" className="btn btn-outline" onClick={() => setNp(null)}>Cancel <Kbd>Esc</Kbd></button>
              <button type="button" className="btn btn-primary" onClick={saveNewProduct}>💾 Save Product</button>
            </div></div>
          </div>
        </div>
      )}

      {/* ───── bank payment ───── */}
      {bp && (
        <div className="imp-ov imp-ov2">
          <div className="imp-win imp-win-sm">
            <div className="imp-win-h"><div className="imp-win-ic">🏦</div>
              <div className="imp-win-t"><h2>Bank Payment — {bp.r.pi_no}</h2><p>Pays {bp.r.supplier_name} from your bank. Posts a Payment voucher (Dr Supplier, Cr Bank).</p></div>
              <button type="button" className="imp-x" onClick={() => setBp(null)}>✕</button></div>
            <div className="imp-win-b">
              <Panel title="Payment">
                <Fg label="Paid from (Bank)" required>
                  <select className="imp-in" autoFocus value={bp.bank} onChange={(e) => setBp({ ...bp, bank: e.target.value })}>
                    {accounts.filter((a) => a.kind === 'bank').map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select></Fg>
                <Fg label="Payment Date"><input className="imp-in" type="date" value={bp.date} onChange={(e) => setBp({ ...bp, date: e.target.value })} /></Fg>
                <Fg label={`Amount Paid (${SYM[bp.r.currency] || bp.r.currency})`} required hint={`PI total ${fc(bp.r.currency, bp.r.grand_total)}`}>
                  <Amount className="imp-in" decimals={2} value={bp.amount} onChange={(e) => setBp({ ...bp, amount: e.target.value })} /></Fg>
                {bp.r.currency !== 'NPR' && (
                  <Fg label={`Bank Exchange Rate (${SYM[bp.r.currency] || bp.r.currency}1 = Rs.)`} required>
                    <Amount className="imp-in" decimals={4} value={bp.rate} onChange={(e) => setBp({ ...bp, rate: e.target.value })} /></Fg>
                )}
                <Fg label="Amount debited from bank (Rs.)"><div className="imp-big blue">{bpNpr > 0 ? rs(bpNpr) : '—'}</div></Fg>
                <Fg label="Reference / TT No."><input className="imp-in" data-nocap value={bp.ref} onChange={(e) => setBp({ ...bp, ref: e.target.value })} /></Fg>
              </Panel>
            </div>
            <div className="imp-win-f"><span /><div style={{ display: 'flex', gap: 10 }}>
              <button type="button" className="btn btn-outline" onClick={() => setBp(null)}>Cancel <Kbd>Esc</Kbd></button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={saveBankPay}>💾 Post Payment <Kbd>Ctrl+S</Kbd></button></div></div>
          </div>
        </div>
      )}

      {/* ───── goods arrived ───── */}
      {arr && (
        <div className="imp-ov imp-ov2">
          <div className="imp-win imp-win-sm">
            <div className="imp-win-h"><div className="imp-win-ic">📦</div>
              <div className="imp-win-t"><h2>Goods Arrived in Godown — {arr.r.pi_no}</h2><p>Posts one Purchase to {arr.r.supplier_name} and brings the goods into stock</p></div>
              <button type="button" className="imp-x" onClick={() => setArr(null)}>✕</button></div>
            <div className="imp-win-b">
              <Panel title="Arrival">
                <Fg label="Arrival date"><input className="imp-in" type="date" value={arr.date} onChange={(e) => setArr({ ...arr, date: e.target.value })} /></Fg>
                <Fg label="Already paid from (optional)" hint="Only if the TT is not yet recorded — if you already used Bank Payment, leave this as No, or the supplier is paid twice.">
                  <select className="imp-in" value={arr.bank} onChange={(e) => setArr({ ...arr, bank: e.target.value })}>
                    <option value="">No — keep the amount payable to the supplier</option>
                    {accounts.filter((a) => a.kind === 'bank').map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select></Fg>
              </Panel>
              <Panel title="What will be posted" style={{ marginTop: 12 }}>
                <div className="imp-tw"><table className="imp-t"><thead><tr><th>Product</th><th className="num">Qty</th><th className="num">Purchase value (Rs.)</th><th className="num">Landed cost / unit</th></tr></thead>
                  <tbody>{arr.r.costing.rows.map((x) => <tr key={x.id}><td>{x.product_name}</td><td className="num">{Number(x.qty).toLocaleString('en-IN')}</td><td className="num">{rs(x.npr)}</td><td className="num green b">{rs(x.cost_unit)}</td></tr>)}</tbody></table></div>
                <div className="imp-sums"><div>Purchase (to supplier): <b>{rs(arr.r.costing.products_npr)}</b></div><div className="muted">Stock value incl. expenses: <b>{rs(arr.r.costing.landed_total)}</b></div>
                  <div className="muted small">CI {arr.r.ci_no} · Packing List {arr.r.packing_list_no} · Customs {arr.r.customs_doc_no}</div></div>
              </Panel>
              {arr.r.items.filter((i) => i.track_serial).map((i) => (
                <Panel key={i.id} title={`Serial numbers — ${i.product_name} (${Number(i.qty)} needed, one per line)`} style={{ marginTop: 12 }}>
                  <div className="imp-pad"><textarea className="imp-in" rows={4} style={{ height: 'auto' }} value={arr.serials[i.id] || ''} onChange={(e) => setArr({ ...arr, serials: { ...arr.serials, [i.id]: e.target.value } })} /></div>
                </Panel>
              ))}
            </div>
            <div className="imp-win-f"><span /><div style={{ display: 'flex', gap: 10 }}>
              <button type="button" className="btn btn-outline" onClick={() => setArr(null)}>Cancel <Kbd>Esc</Kbd></button>
              <button type="button" className="imp-go imp-go-sm" disabled={busy} onClick={arrive}>📦 Confirm Goods Arrived <Kbd>Ctrl+S</Kbd></button></div></div>
          </div>
        </div>
      )}
    </>
  );
}
