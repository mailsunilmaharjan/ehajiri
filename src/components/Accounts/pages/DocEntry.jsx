import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from '../lib/router';
import { useApp } from '../context';
import { AccountSelect, Amount, BsDateInput, Kbd } from '../components/inputs';
import DocView from '../components/DocView';
import SerialDialog from '../components/SerialDialog';
import { PasswordPrompt } from '../components/Guards';
import { api, fmtBal, fmtMoney } from '../lib/api';
import { addDays, fmtBs } from '../lib/dates';
import { DOCS, PAY_MODES } from '../lib/docs';
import { useShortcuts } from '../lib/keys';
import { amountInWords } from '../lib/words';
import { clearCart, getCart } from '../lib/cart';
import { QuoteTerms, QuoteTop, quoteDefaults, quoteFromDoc } from '../components/QuoteFields';
import { getTenantPrefix } from '../../../utils/tenantPath.js';
import TaskDialog from '../components/TaskDialog';

const LEVELS = [['mrp', 'Retail (MRP)'], ['dealer', 'Dealer'], ['partner', 'Partner']];
const RATE_LABEL = { mrp: 'MRP RATE', dealer: 'DEALER RATE', partner: 'PARTNER RATE' };
const emptyLine = () => ({ item_id: null, qty: '', rate: '', incl: false, disc: '', serials: [], service_from: '', service_to: '' });
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const NEPAL_BANKS = ['Agricultural Development Bank', 'Citizens Bank International', 'Everest Bank', 'Global IME Bank', 'Himalayan Bank',
  'Kumari Bank', 'Laxmi Sunrise Bank', 'Machhapuchchhre Bank', 'Nabil Bank', 'Nepal Bank Limited', 'Nepal Investment Mega Bank',
  'Nepal SBI Bank', 'NIC Asia Bank', 'NMB Bank', 'Prabhu Bank', 'Prime Commercial Bank', 'Rastriya Banijya Bank', 'Sanima Bank',
  'Siddhartha Bank', 'Standard Chartered Bank Nepal'];
const PAY_FIELDS = { cheque_no: '', cheque_bank: '', txn_id: '', pay_proof: null, pay_proof_data: null, pay_proof_name: '',
  followup_user: '', followup_date: '', followup_note: '' };

/** ↑ / ↓ in the product grid: same column, previous / next row (the product search keeps ↑ ↓ for its list). */
function gridArrows(e) {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  const t = e.target;
  if (!(t instanceof HTMLElement) || t.closest('.acsel') || e.altKey) return;
  const td = t.closest('td');
  const tr = td?.parentElement;
  const row = e.key === 'ArrowDown' ? tr?.nextElementSibling : tr?.previousElementSibling;
  const cell = row?.children[td.cellIndex];
  const el = cell && [...cell.querySelectorAll('input, select')].find((x) => !x.disabled && x.tabIndex !== -1);
  e.preventDefault();           // stop number boxes / VAT type changing their value
  if (!el) return;
  el.focus();
  el.select?.();
}
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

/** Service expiry: start + N months − 1 day (same rule as the server). */
function periodEnd(fromIso, months) {
  if (!fromIso || !months) return '';
  const [y, m, d] = fromIso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return addDays(t.toISOString().slice(0, 10), -1);
}

/** "500" → Rs 500 ; "10%" → 10 % of the line amount */
function discAmount(text, gross) {
  const s = String(text ?? '').trim();
  if (!s) return 0;
  if (s.endsWith('%')) return r2(gross * (Number(s.slice(0, -1)) || 0) / 100);
  return r2(Number(s) || 0);
}

/** Quick "+ Add" customer / supplier without leaving the bill. */
function QuickParty({ type, name, onSaved, onClose, asContact = false }) {
  const { notify } = useApp();
  const [f, setF] = useState({ name: name || '', contact_person: '', pan: '', phone: '', address: '', credit_days: '', price_level: 'mrp', also_other_role: false });
  const save = async (e) => {
    e?.preventDefault();
    try {
      // the contact person goes into the same contact list the Parties page uses (Parties › Contact persons)
      if (asContact) { const c = await api.post('/quote-contacts', { name: f.name, contact_person: f.contact_person, phone: f.phone, address: f.address }); notify(`${c.name} added to Contacts`); onSaved(c); return; }
      const p = await api.post('/parties', { ...f, party_type: type, credit_days: Number(f.credit_days || 0),
        contacts: f.contact_person.trim() ? [{ name: f.contact_person.trim() }] : [] });
      notify(`${p.name} added`);
      onSaved(p);
    } catch (err) { notify(err.message, 'err'); }
  };
  useShortcuts({ save, close: onClose });
  return (
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="card form" onSubmit={save}>
        <h2>➕ New {asContact ? 'contact' : type}</h2>
        <label>Name *<input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></label>
        {!asContact && <label>PAN / VAT No.<input value={f.pan} maxLength={9} onChange={(e) => setF({ ...f, pan: e.target.value })} /></label>}
        <label>Mobile<input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
        <label>Contact person<input value={f.contact_person} maxLength={120} onChange={(e) => setF({ ...f, contact_person: e.target.value })} placeholder="e.g. Anita Baidhya" /></label>
        <label>Address<input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></label>
        {!asContact && <label>Credit period (days)<input type="number" min="0" value={f.credit_days} onChange={(e) => setF({ ...f, credit_days: e.target.value })} /></label>}
        {type === 'customer' && !asContact && (
          <label>Type<select value={f.price_level} onChange={(e) => setF({ ...f, price_level: e.target.value })}>
            {LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        )}
        {!asContact && <label className="check"><input type="checkbox" checked={f.also_other_role} onChange={(e) => setF({ ...f, also_other_role: e.target.checked })} /> Also a {type === 'customer' ? 'supplier' : 'customer'} (same business, both ways)</label>}
        <div className="actions"><span className="spacer" />
          <button type="button" className="ghost" onClick={onClose}>Close <Kbd>Esc</Kbd></button>
          <button data-save>Add <Kbd>Ctrl+S</Kbd></button>
        </div>
      </form>
    </div>
  );
}

export default function DocEntry() {
  const { type, id } = useParams();
  const editId = Number(id) || null;
  const [sp] = useSearchParams();
  const refId = editId ? null : Number(sp.get('ref')) || null;
  const fromCart = !editId && !refId && sp.get('cart') === '1';
  const meta = DOCS[type];
  const isSale = meta.side === 'sales';
  const isQuote = !!meta.quote;
  const [templates, setTemplates] = useState([]);
  const nav = useNavigate();
  const { company, accounts, today, notify } = useApp();
  const remarksRef = useRef(null);
  const proofRef = useRef(null);

  const [items, setItems] = useState([]);
  const [parties, setParties] = useState([]);
  const [ref, setRef] = useState(null);
  const [orig, setOrig] = useState(null);       // document being edited
  const [f, setF] = useState(null);
  const [lines, setLines] = useState([emptyLine(), emptyLine()]);
  const [saved, setSaved] = useState(null);
  const [busy, setBusy] = useState(false);
  const [serialFor, setSerialFor] = useState(null);
  const [addParty, setAddParty] = useState(null);
  const [contacts, setContacts] = useState([]);       // Contact list (Staff › Contact): the customer of a Sales Quotation
  const [askPw, setAskPw] = useState(false);
  const [askTask, setAskTask] = useState(null);
  const [users, setUsers] = useState([]);

  const cashList = useMemo(() => accounts.filter((a) => a.kind === 'cash'), [accounts]);
  const bankList = useMemo(() => accounts.filter((a) => a.kind === 'bank'), [accounts]);
  const defCash = cashList.find((a) => a.system_key === 'cash')?.id || cashList[0]?.id || null;
  const bankNames = useMemo(() => [...new Set([...bankList.map((a) => a.name), ...NEPAL_BANKS])], [bankList]);
  useEffect(() => { api.get('/users/list').then(setUsers).catch(() => setUsers([])); }, []);
  const vatRate = company.vat_registered ? company.vat_rate : 0;

  const fromDocLine = (l, isReturn) => ({
    item_id: l.item_id, rate: l.rate, incl: !!l.vat_inclusive,
    disc: l.discount ? String(r2(l.vat_inclusive ? l.discount * (1 + vatRate / 100) : l.discount)) : '',
    qty: isReturn ? r2(l.qty - (l.returned || 0)) : l.qty,
    max: isReturn ? r2(l.qty - (l.returned || 0)) : null,
    allowed: isReturn && l.track_serial ? l.returnable_serials : null,
    serials: isReturn && l.track_serial ? l.returnable_serials : (l.serials || []),
    service_from: l.service_from || '', service_to: l.service_to || '',
  });

  useEffect(() => {
    setSaved(null);
    (async () => {
      const [it, pa, tpls, cts] = await Promise.all([api.get('/items', { include_inactive: !!editId }), api.get('/parties', { type: isSale ? 'customer' : 'supplier' }),
        isQuote ? api.get('/quote-templates') : Promise.resolve([]), isQuote ? api.get('/quote-contacts').catch(() => []) : Promise.resolve([])]);
      setItems(it); setParties(pa); setTemplates(tpls); setContacts(cts);
      const base = {
        doc_date: today, party_id: null, contact_id: null, party_name: '', party_pan: '', party_address: '',
        payment_mode: isSale && meta.role !== 'order' ? 'cash' : 'credit',
        cash_account_id: defCash,
        supplier_bill_no: '', supplier_bill_date: today, challan_no: '', vat_bill_no: '', paid_amount: null, vat_bill: true, price_level: 'mrp', narration: '',
        credit_days: '', cheque_details: '', cheque_date: today, ...PAY_FIELDS,
        ...(isQuote ? quoteDefaults(tpls.find((t) => t.is_default) || tpls[0]) : {}),
      };
      const payOf = (d) => ({
        payment_mode: d.payment_mode || 'credit', cash_account_id: d.cash_account_id || defCash,
        cheque_no: d.cheque_no || '', cheque_date: d.cheque_date || today, cheque_bank: d.cheque_bank || '', txn_id: d.txn_id || '',
        followup_user: d.followup_user || '', followup_date: d.followup_date || '', followup_note: d.followup_note || '',
      });
      if (editId) {
        const d = await api.get(`/docs/${editId}`);
        setOrig(d); setRef(null);
        setF({ ...base, ...d, ...payOf(d), party_name: d.party_id ? '' : d.party_name, party_pan: d.party_id ? '' : (d.party_pan || ''),
          credit_days: d.due_date && d.payment_mode === 'credit' ? String(daysBetween(d.doc_date, d.due_date)) : '', cheque_details: d.cheque_details || '',
          pay_proof: d.pay_proof || null, pay_proof_data: null, pay_proof_name: '',
          supplier_bill_no: d.supplier_bill_no || '', challan_no: d.challan_no || '', vat_bill_no: d.vat_bill_no || '',
          paid_amount: d.paid_amount != null && Math.abs(d.paid_amount - d.total) > 0.005 ? String(d.paid_amount) : null, narration: d.narration || '', vat_bill: !!d.vat_bill, price_level: d.price_level || 'mrp',
          ...(isQuote ? quoteFromDoc(d) : {}) });
        setLines([...d.lines.map((l) => fromDocLine(l, false)), emptyLine()]);
      } else if (refId) {
        const r = await api.get(`/docs/${refId}`);
        setRef(r); setOrig(null);
        // quotation made for a Contact: turn the contact into an Accounts customer now (reused if it already exists)
        let plist = pa;
        if (!r.party_id && r.contact_id && isSale) {
          try { const cp = await api.post('/parties/from-contact', { contact_id: r.contact_id }); r.party_id = cp.id; plist = await api.get('/parties', { type: 'customer' }); setParties(plist); notify(`${cp.name} is now an Accounts customer`); }
          catch (e) { notify(e.message, 'err'); }
        }
        const party = plist.find((p) => p.id === r.party_id);
        // a bill made from an order keeps the order's payment terms; a return starts as credit (or cash for walk-in)
        const pay = meta.role === 'bill' ? payOf(r) : { payment_mode: r.party_id ? 'credit' : 'cash' };
        setF({ ...base, party_id: r.party_id, party_name: r.party_id ? '' : r.party_name, party_pan: r.party_id ? '' : r.party_pan || '',
          ...pay, price_level: r.price_level || 'mrp', vat_bill: !!r.vat_bill || isSale,
          credit_days: String(party?.credit_days || ''), cheque_details: r.cheque_details || '' });
        const ls = r.lines.map((l) => fromDocLine(l, meta.role === 'return')).filter((l) => l.qty > 0);
        setLines([...ls, emptyLine()]);
      } else if (fromCart) {
        setRef(null); setOrig(null); setF(base);
        const byId = Object.fromEntries(it.map((x) => [x.id, x]));
        const ls = getCart().filter((c) => byId[c.item_id]).map((c) => {
          const item = byId[c.item_id];
          const incl = isSale && !!item.vat_applicable && item.vat_type !== 'exclusive';
          return { ...emptyLine(), item_id: c.item_id, qty: c.qty, rate: isSale ? item.mrp || '' : item.purchase_price || '', incl: isSale ? incl : false,
            service_from: item.item_type === 'service' ? today : '', service_to: item.item_type === 'service' ? periodEnd(today, item.service_months) : '' };
        });
        setLines([...ls, emptyLine()]);
      } else {
        setRef(null); setOrig(null); setLines([emptyLine(), emptyLine()]);
        // opened from a Task (＋ New Quotation): start with that task's customer and contact person already chosen
        const pre = isQuote ? cts.find((c) => String(c.id) === String(sp.get('contact'))) : null;
        const who = pre ? pre.persons?.find((p) => String(p.id) === String(sp.get('person'))) || pre.persons?.[0] : null;
        const b2 = isQuote && sp.get('subject') ? { ...base, qt_subject: sp.get('subject').slice(0, 160) } : base;   // the task's name becomes the quotation subject
        setF(pre ? { ...b2, contact_id: pre.id, party_name: pre.name, party_address: pre.address || '', qt_attn: who?.name || (pre.contact_info === 'personal' ? pre.name : '') } : b2);
      }
    })().catch((e) => notify(e.message, 'err'));
  }, [type, refId, editId, fromCart]);

  const party = parties.find((p) => p.id === f?.party_id);
  const contactList = useMemo(() => contacts.map((c) => ({ ...c, code: c.phone || '', group_name: c.address || '' })), [contacts]);
  const contactSel = contacts.find((c) => c.id === f?.contact_id);
  const pickContact = (c) => { if (!c) return; setF((x) => ({ ...x, contact_id: c.id, party_id: null, party_name: c.name, party_address: c.address || '',
    qt_attn: c.persons?.[0]?.name || (c.contact_info === 'personal' ? c.name : '') })); };
  const itemOpts = useMemo(() => items.filter((i) => i.active || editId).map((i) => ({ ...i,
    group_name: i.item_type === 'service' ? `${i.code} · service${i.service_months ? ` ${i.service_months} m` : ''}` : `${i.code} · stock ${i.stock} ${i.unit}` })), [items, editId]);
  const itemById = useMemo(() => Object.fromEntries(items.map((i) => [i.id, i])), [items]);
  const vatOn = company.vat_registered && (isSale || f?.vat_bill);
  const lineVat = vatOn ? company.vat_rate : 0;
  const hasDue = f && ['SI', 'PB', 'SO', 'PO'].includes(type) && f.payment_mode === 'credit';
  const dueDate = f ? addDays(f.doc_date, Number(f.credit_days || 0)) : null;

  /** Default rate + VAT type for a product: MRP and %-off-MRP prices include VAT; fixed dealer/partner/cost don't. */
  const priceOf = (it, level = f.price_level) => {
    if (!isSale) return { rate: it.purchase_price || '', incl: false };
    const incl = !!it.vat_applicable && it.vat_type !== 'exclusive';
    if (level === 'dealer' && it.dealer_price) return { rate: it.dealer_price, incl };
    if (level === 'partner' && it.partner_price) return { rate: it.partner_price, incl };
    return { rate: it.mrp || '', incl: !!it.mrp && incl };
  };

  const setLine = (i, patch) => {
    let next = lines.map((l, j) => (j === i ? { ...l, ...patch } : l));
    if (i === next.length - 1 && next[i].item_id) next = [...next, emptyLine()];
    setLines(next);
  };
  const pickItem = (i, idv) => {
    const it = itemById[idv];
    const p = priceOf(it);
    const from = it.item_type === 'service' ? (lines[i].service_from || f.doc_date) : '';
    setLine(i, { item_id: idv, qty: lines[i].qty || 1, rate: p.rate, incl: p.incl, serials: [], service_from: from,
      service_to: it.item_type === 'service' ? periodEnd(from, it.service_months) : '' });
  };
  const pickParty = (pid, list = parties) => {
    const p = list.find((x) => x.id === pid);
    const level = p?.price_level || 'mrp';
    const prevContact = parties.find((y) => y.id === f?.party_id)?.contact_person || '';
    setF((x) => ({ ...x, party_id: pid,
      // quotation: Attn. follows the customer's main contact person unless it was typed by hand
      ...(isQuote && !editId && p?.contact_person && (!x.qt_attn || x.qt_attn === prevContact) ? { qt_attn: p.contact_person } : {}), price_level: isSale ? level : x.price_level, credit_days: String(p?.credit_days || ''),
      payment_mode: pid && x.payment_mode === 'cash' && isSale && !editId ? 'credit'
        : !pid && ['credit', 'cheque'].includes(x.payment_mode) ? 'cash' : x.payment_mode }));
    if (isSale && !ref) setLines((ls) => ls.map((l) => (l.item_id ? { ...l, ...priceOf(itemById[l.item_id], level) } : l)));
  };
  const changeLevel = (level) => {
    setF({ ...f, price_level: level });
    setLines((ls) => ls.map((l) => (l.item_id ? { ...l, ...priceOf(itemById[l.item_id], level) } : l)));
  };

  const calc = useMemo(() => {
    let taxable = 0, exempt = 0, vat = 0, discount = 0;
    const per = lines.map((l) => {
      const it = itemById[l.item_id];
      if (!it) return null;
      const gross = r2(Number(l.qty || 0) * Number(l.rate || 0));
      const disc = Math.min(discAmount(l.disc, gross), gross);
      const net = r2(gross - disc);
      const vatOk = !!it.vat_applicable && lineVat > 0;
      let amt; let v;
      if (vatOk && l.incl) { amt = r2(net / (1 + lineVat / 100)); v = r2(net - amt); }
      else { amt = net; v = vatOk ? r2(amt * lineVat / 100) : 0; }
      if (vatOk) taxable += amt; else exempt += amt;
      vat += v; discount += disc;
      const needSerial = !!it.track_serial && meta.role !== 'order';
      // grid shows cost per unit without VAT (rate/1.13 when the rate includes VAT), and Total = that × Qty
      const qty = Number(l.qty || 0);
      const unit = qty > 0 ? r2(amt / qty) : 0;
      return { gross, disc, amt, unit, vat: v, total: r2(amt + v), vatOk, needSerial,
        serialOk: !needSerial || l.serials.length === Number(l.qty),
        short: (type === 'SI' || type === 'PR') && it.item_type === 'goods' && !editId && Number(l.qty) > it.stock };
    });
    taxable = r2(taxable); exempt = r2(exempt); vat = r2(vat);
    return { per, taxable, exempt, vat, discount: r2(discount), total: r2(taxable + exempt + vat) };
  }, [lines, itemById, lineVat, type, editId]);

  const body = () => ({
    ...f, doc_type: type, ref_doc_id: editId ? orig.ref_doc_id : refId, due_date: hasDue ? dueDate : null,
    party_id: f.party_id || null,
    followup_date: f.followup_user ? (f.followup_date || dueDate) : null,
    cheque_date: f.payment_mode === 'cheque' ? f.cheque_date : null,
    supplier_bill_date: null,
    paid_amount: ['cash', 'bank', 'cheque'].includes(f.payment_mode) && f.party_id && f.paid_amount !== null && f.paid_amount !== undefined
      ? Number(f.paid_amount || 0) : null,
    lines: lines.filter((l) => l.item_id && Number(l.qty) > 0).map((l, i) => ({
      item_id: l.item_id, qty: Number(l.qty), rate: Number(l.rate || 0), vat_inclusive: !!l.incl,
      discount: calc.per[lines.indexOf(l)]?.disc || 0, serials: l.serials,
      service_from: l.service_from || null, service_to: l.service_to || null,
    })),
  });

  const save = async () => {
    if (busy || calc.total <= 0) return;
    const missing = lines.findIndex((l, i) => calc.per[i] && !calc.per[i].serialOk && Number(l.qty) > 0);
    if (missing >= 0) { notify(`Line ${missing + 1}: enter the serial numbers.`, 'err'); setSerialFor(missing); return; }
    if (editId) { setAskPw(true); return; }
    setBusy(true);
    try {
      const d = await api.post('/docs', body());
      notify(`${d.doc_no} saved`);
      // tell the Task form that sent us here, so its Quotation field refreshes and selects this one
      if (isQuote && sp.get('fromTask')) { try { const ch = new BroadcastChannel('ehajiri-quotation'); ch.postMessage({ type: 'saved', prefix: getTenantPrefix(), docId: d.id, docNo: d.doc_no }); ch.close(); } catch { /* old browser: pick it by hand */ } }
      if (fromCart) clearCart();
      if (isQuote) setAskTask(d);        // a new quotation: assign who follows it up, then show it
      else setSaved(d);
    } catch (err) { notify(err.message, 'err'); }
    setBusy(false);
  };
  const saveEdit = async (password) => {
    try {
      const d = await api.put(`/docs/${editId}`, { ...body(), password });
      setAskPw(false);
      notify(`${d.doc_no} updated`);
      setSaved(d);
    } catch (err) { notify(err.message, 'err'); }
  };

  const dirty = lines.some((l) => l.item_id);
  useShortcuts({
    save,
    close: () => { if (!dirty || confirm('Leave without saving?')) nav(`/docs/${type}`); },
  }, !saved && !askTask && serialFor === null && !addParty && !askPw);

  if (!f) return <div className="muted">Loading…</div>;
  const setMode = (m) => setF({ ...f, payment_mode: m,
    cash_account_id: m === 'cash' ? defCash : m === 'bank' ? (bankList.some((a) => a.id === f.cash_account_id) ? f.cash_account_id : bankList[0]?.id || null) : f.cash_account_id });
  const pickProof = (file) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { notify('Payment voucher is larger than 5 MB.', 'err'); return; }
    const rd = new FileReader();
    rd.onload = () => setF((x) => ({ ...x, pay_proof_data: rd.result, pay_proof_name: file.name }));
    rd.readAsDataURL(file);
  };
  const minusDay = (iso) => addDays(iso, -1);
  const overLimit = isSale && party && party.credit_limit > 0 && ['credit', 'cheque'].includes(f.payment_mode)
    && party.balance + calc.total - (orig?.total || 0) > party.credit_limit;
  const serialLine = serialFor !== null ? lines[serialFor] : null;
  const serialMode = type === 'SI' || type === 'PR' ? 'pick' : 'in';
  const partyWord = isSale ? 'Customer' : 'Supplier';
  const dateWord = isQuote ? 'Quotation Date' : meta.role === 'order' ? 'Order Date' : meta.role === 'return' ? 'Return Date' : 'Bill Date';

  return (
    <>
      <header className="page-head">
        <h1>{editId ? `✏️ Edit ${meta.name} ${orig?.doc_no || ''}` : `New ${meta.name}`}</h1>
        {ref && <span className="tag">{meta.role === 'return' ? 'against' : ref.doc_type === 'QT' ? 'from quotation' : 'from order'} {ref.doc_no}</span>}
        {orig?.edit_count > 0 && <span className="tag">edited {orig.edit_count}×</span>}
        <span className="spacer" />
        <span className="muted small">Enter = next · Ctrl+S = save · Esc = back</span>
      </header>
      <section className="card entry-card">
        <div className={`doc-form bill-top ${type === 'SI' ? 'si' : isSale || type === 'PB' ? '' : 'two'}`}>
          <div className="acc-step"><i>1</i>{isQuote ? 'Quotation details' : `${partyWord} & bill details`}</div>
          <label>{partyWord} Name *
            <span className="inline">
              {isQuote && !f.party_id ? (
                <AccountSelect accounts={contactList} value={f.contact_id} onChange={(cid) => pickContact(contacts.find((c) => c.id === cid))}
                  placeholder="Search Contact list…" onAdd={(q) => setAddParty({ name: q })} />
              ) : (
                <AccountSelect accounts={parties} value={f.party_id} onChange={(pid) => pickParty(pid)}
                  placeholder={isSale && meta.role !== 'order' ? 'Search… (empty = walk-in cash)' : 'Search…'}
                  onAdd={(q) => setAddParty({ name: q })} />
              )}
              <button type="button" className="ghost add-btn" tabIndex={-1} onClick={() => setAddParty({ name: '' })}>＋ Add</button>
            </span>
            {isQuote && !f.party_id && contactSel && <small>{[contactSel.phone, contactSel.address].filter(Boolean).join(' · ') || 'Contact'}{contactSel.party_id ? ' · already an Accounts customer' : ' · becomes an Accounts customer when converted to an order / invoice'}</small>}
            {party && <small>PAN {party.pan || '—'} · Balance {fmtBal(party.balance)}{party.credit_limit ? ` · Limit ${fmtMoney(party.credit_limit)}` : ''}</small>}
          </label>
          {isSale ? (
            <label>Type
              <select value={f.price_level} onChange={(e) => changeLevel(e.target.value)}>
                {LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          ) : type === 'PB' ? (
            <label>Supplier Bill No. *<input value={f.supplier_bill_no} onChange={(e) => setF({ ...f, supplier_bill_no: e.target.value })} /></label>
          ) : null}
          {type === 'SI' && (
            <>
              <label>Challan No.<input data-nocap value={f.challan_no} onChange={(e) => setF({ ...f, challan_no: e.target.value })} /></label>
              <label>VAT Bill No.<input data-nocap value={f.vat_bill_no} onChange={(e) => setF({ ...f, vat_bill_no: e.target.value })} /></label>
            </>
          )}
          <label>{dateWord}
            <BsDateInput value={f.doc_date} onChange={(v) => setF({ ...f, doc_date: v })} />
          </label>
        </div>

        {isSale && !f.party_id && meta.role !== 'order' && (
          <div className="doc-form three">
            <label>Customer name (walk-in)<input value={f.party_name} onChange={(e) => setF({ ...f, party_name: e.target.value })} placeholder="Cash" /></label>
            <label>Customer PAN<input value={f.party_pan} maxLength={9} onChange={(e) => setF({ ...f, party_pan: e.target.value })} /></label>
            <span />
          </div>
        )}

        {isQuote && <QuoteTop f={f} setF={setF} templates={templates} docId={editId}
          party={isQuote && f.contact_id && !f.party_id ? { contact_names: (contactSel?.persons || []).map((p) => p.name).join('\n') } : party} />}
        {!isQuote && <div className={`doc-form pay-row pay-${f.payment_mode}`}>
          <div className="acc-step"><i>2</i>Payment</div>
          <label>Payment Mode
            <select value={f.payment_mode} onChange={(e) => setMode(e.target.value)}>
              {PAY_MODES.map(([v, l]) => <option key={v} value={v} disabled={!f.party_id && (v === 'credit' || v === 'cheque')}>{l}</option>)}
            </select>
          </label>

          {f.payment_mode === 'credit' && (
            <>
              {hasDue && (
                <label>Credit Period (days)
                  <span className="credit-days">
                    <input type="number" min="0" max="9999" placeholder="30" value={f.credit_days}
                      onChange={(e) => setF({ ...f, credit_days: e.target.value.replace(/\D/g, '').slice(0, 4) })} />
                    {Number(f.credit_days) > 0 && <b className="bs-label">due {fmtBs(dueDate)}</b>}
                  </span>
                </label>
              )}
              <label>Follow-up Task — Assign to
                <select value={f.followup_user} onChange={(e) => setF({ ...f, followup_user: e.target.value })}>
                  <option value="">— No follow-up task —</option>
                  {users.map((u) => <option key={u.username} value={u.username}>{u.full_name ? `${u.full_name} (${u.username})` : u.username}</option>)}
                </select>
              </label>
              {f.followup_user && (
                <>
                  <label>Follow-up Date
                    <BsDateInput value={f.followup_date || dueDate} onChange={(v) => setF({ ...f, followup_date: v })} showAd={false} />
                  </label>
                  <label>Task Note
                    <input placeholder="e.g. Call accounts dept. for payment" value={f.followup_note} onChange={(e) => setF({ ...f, followup_note: e.target.value })} />
                  </label>
                </>
              )}
            </>
          )}

          {f.payment_mode === 'cash' && (
            <label>{isSale ? 'Received in' : 'Paid from'}
              <select value={f.cash_account_id || ''} onChange={(e) => setF({ ...f, cash_account_id: Number(e.target.value) })}>
                {cashList.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
          )}

          {f.payment_mode === 'cheque' && (
            <>
              <label>Cheque No. *<input data-nocap value={f.cheque_no} placeholder="e.g. 00451234" onChange={(e) => setF({ ...f, cheque_no: e.target.value })} /></label>
              <label>Cheque Date *
                <BsDateInput value={f.cheque_date} onChange={(v) => setF({ ...f, cheque_date: v })} showAd={false} />
              </label>
              <label>Bank Name *
                <input list="nepal-banks" value={f.cheque_bank} placeholder={isSale ? "Customer's bank" : 'Our bank'} onChange={(e) => setF({ ...f, cheque_bank: e.target.value })} />
                <datalist id="nepal-banks">{bankNames.map((n) => <option key={n} value={n} />)}</datalist>
              </label>
              <div className="pay-note">⏰ Reminders on <b>{fmtBs(minusDay(f.cheque_date))}</b> (1 day before) and <b>{fmtBs(f.cheque_date)}</b> (cheque date) — shown under Alerts.
                {meta.role !== 'order' && <> The cheque goes to <b>Post-dated Cheques</b>: the party ledger shows it as a note, and the money posts only when you mark it deposited.</>}</div>
            </>
          )}

          {f.payment_mode === 'bank' && (
            <>
              <label>{isSale ? 'Received in (Bank)' : 'Paid from (Bank)'} *
                <select value={f.cash_account_id || ''} onChange={(e) => setF({ ...f, cash_account_id: Number(e.target.value) })}>
                  {bankList.length === 0 && <option value="">— add a bank account first —</option>}
                  {bankList.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
              <label>Trans. ID {meta.role !== 'order' && '*'}<input data-nocap value={f.txn_id} placeholder="QR / transfer reference" onChange={(e) => setF({ ...f, txn_id: e.target.value })} /></label>
              <label>Payment Voucher
                <span className="proof-box">
                  <button type="button" className="ghost proof-btn" onClick={() => proofRef.current?.click()}>
                    📎 {f.pay_proof_data ? 'Change' : f.pay_proof ? 'Replace' : 'Upload'}</button>
                  <input ref={proofRef} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" hidden
                    onChange={(e) => { pickProof(e.target.files[0]); e.target.value = ''; }} />
                  {f.pay_proof_data ? <span className="proof-name" title={f.pay_proof_name}>{f.pay_proof_name}</span>
                    : f.pay_proof ? <a href={`/api/accounts/docs/${editId}/proof`} target="_blank" rel="noopener" className="proof-name">View saved voucher</a>
                      : <span className="muted small">Photo or PDF, up to 5 MB</span>}
                  {(f.pay_proof_data || f.pay_proof) && <button type="button" className="link del-x" tabIndex={-1} title="Remove"
                    onClick={() => setF({ ...f, pay_proof: null, pay_proof_data: null, pay_proof_name: '' })}>✕</button>}
                </span>
              </label>
            </>
          )}

          {['cash', 'bank', 'cheque'].includes(f.payment_mode) && f.party_id && (() => {
            const paid = f.paid_amount === null || f.paid_amount === undefined ? calc.total : Number(f.paid_amount || 0);
            const left = Math.round((calc.total - paid) * 100) / 100;
            return (
              <label>{isSale ? 'Received Amount' : 'Paid Amount'}
                <Amount className="num paid-amt" value={f.paid_amount ?? (calc.total || '')} onChange={(e) => setF({ ...f, paid_amount: e.target.value })} />
                {left > 0.005 && <small className="bal-due">Remaining balance Rs.{fmtMoney(left)} — stays on {party?.name || 'the party'}'s ledger</small>}
                {left < -0.005 && <small className="neg">More than the bill total (Rs.{fmtMoney(calc.total)})</small>}
              </label>
            );
          })()}
          {!isSale && company.vat_registered && (
            <label className="check"><input type="checkbox" checked={f.vat_bill} onChange={(e) => setF({ ...f, vat_bill: e.target.checked })} /> VAT bill (claim input VAT)</label>
          )}
        </div>}

        <div className="acc-step acc-step-out"><i>{isQuote ? 2 : 3}</i>{isSale ? 'Product details' : 'Items'}</div>
        <table className="grid entry bill-grid">
          <thead><tr>
            <th className="sn">SN</th><th style={{ minWidth: 280 }}>PRODUCT NAME</th><th style={{ width: 90 }}>HS CODE</th>
            <th className="num" style={{ width: 80 }}>QTY</th><th className="num" style={{ width: 105 }}>MRP Rs.</th>
            <th className="num" style={{ width: 120 }}>{isSale ? RATE_LABEL[f.price_level] : 'RATE'}</th><th style={{ width: 110 }}>VAT TYPE</th>
            <th className="num" style={{ width: 100 }}>DISCOUNT</th><th className="num" style={{ width: 115 }}>VAT EXCL. Rs.</th>
            <th className="num" style={{ width: 115 }}>TOTAL Rs.</th><th style={{ width: 30 }} />
          </tr></thead>
          <tbody onKeyDown={gridArrows}>
            {lines.map((l, i) => {
              const it = itemById[l.item_id];
              const c = calc.per[i];
              const isService = it?.item_type === 'service';
              return (
                <tr key={i}>
                  <td className="sn">{i + 1}</td>
                  <td>
                    <AccountSelect accounts={itemOpts} value={l.item_id} onChange={(idv) => pickItem(i, idv)} placeholder="Search product…"
                      onEmptyEnter={() => remarksRef.current?.focus()} />
                    {c?.short && <small className="neg">Only {it.stock} in stock</small>}
                    {l.max != null && <small className="muted"> max {l.max}</small>}
                    {c?.needSerial && (
                      <button type="button" tabIndex={-1} className={`serial-btn ${c.serialOk ? 'ok' : ''}`} onClick={() => setSerialFor(i)}>
                        S/N {l.serials.length}/{Number(l.qty) || 0} {c.serialOk ? '✔' : '— enter serials'}
                      </button>
                    )}
                    {!isService && it?.warranty_months > 0 && isSale && <small className="muted"> · {it.warranty_months} m warranty</small>}
                    {isService && (
                      <div className="svc-dates">
                        <span>Service</span>
                        <input type="date" tabIndex={-1} value={l.service_from} onChange={(e) => setLine(i, { service_from: e.target.value, service_to: periodEnd(e.target.value, it.service_months) || l.service_to })} />
                        <span>to</span>
                        <input type="date" tabIndex={-1} value={l.service_to} onChange={(e) => setLine(i, { service_to: e.target.value })} />
                        <small className="muted">{l.service_to ? `expires ${fmtBs(l.service_to)}` : 'no expiry'}</small>
                      </div>
                    )}
                  </td>
                  <td className="small muted nowrap">{it?.hs_code}</td>
                  <td><input className="num qty" type="number" min="0" step={it?.track_serial ? 1 : 0.001} value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })}
                    onKeyDown={(e) => {
                      // serial-tracked product: after Qty, ask for exactly that many serial numbers
                      if ((e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) && c?.needSerial && Number(l.qty) > 0 && !c.serialOk) {
                        e.preventDefault(); setSerialFor(i);
                      }
                    }} /></td>
                  <td className="num ro">{it?.mrp ? fmtMoney(it.mrp) : ''}</td>
                  <td><Amount className="num rate" type="number" min="0" step="0.01" value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} /></td>
                  <td>
                    <select className="vat-type" value={l.incl ? 'incl' : 'excl'} disabled={!c?.vatOk}
                      onChange={(e) => setLine(i, { incl: e.target.value === 'incl' })}>
                      <option value="incl">Inclusive</option><option value="excl">Exclusive</option>
                    </select>
                  </td>
                  <td><input className="num" placeholder="Rs or %" value={l.disc} onChange={(e) => setLine(i, { disc: e.target.value })} /></td>
                  <td className="num excl" title="Cost per unit, without VAT">{c ? fmtMoney(c.unit) : ''}</td>
                  <td className="num tot" title="Cost per unit × Qty (VAT is added in the totals below)">{c ? fmtMoney(c.amt) : '—'}</td>
                  <td>{lines.length > 1 && <button type="button" className="link del-x" tabIndex={-1} title="Remove line" onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="inv-foot tight">
          <div className="words">
            <button type="button" className="ghost add-line" tabIndex={-1} onClick={() => setLines([...lines, emptyLine()])}>＋ Add Product</button>
            <div className="section-label">IN WORDS</div>
            <div className="words-box">{amountInWords(calc.total)}</div>
            <div className="section-label">REMARKS</div>
            <textarea ref={remarksRef} rows={2} value={f.narration} placeholder={isQuote ? 'Internal remarks (not printed on the quotation)…' : `Optional remarks for this ${meta.role === 'order' ? 'order' : 'bill'}…`}
              onChange={(e) => setF({ ...f, narration: e.target.value })} />
            {overLimit && <div className="notice">This takes {party.name} over their credit limit of {fmtMoney(party.credit_limit)}.</div>}
          </div>
          <div className="total-card">
            <div><span>Gross Total</span><b>Rs.{fmtMoney(r2(calc.taxable + calc.exempt))}</b></div>
            {calc.discount > 0 && <div className="muted"><span>Discount given</span><b>Rs.{fmtMoney(calc.discount)}</b></div>}
            {calc.exempt > 0 && <div className="muted"><span>of which VAT-exempt</span><b>Rs.{fmtMoney(calc.exempt)}</b></div>}
            <div className="vat"><span>VAT {lineVat}%</span><b>Rs.{fmtMoney(calc.vat)}</b></div>
            <div className="grand"><span>Grand Total</span><b>Rs.{fmtMoney(calc.total)}</b></div>
          </div>
        </div>
        {isQuote && <QuoteTerms f={f} setF={setF} templates={templates} />}
        <div className="actions">
          <button className="ghost" onClick={() => nav(`/docs/${type}`)}>Cancel <Kbd>Esc</Kbd></button>
          <span className="spacer" />
          <button data-save disabled={busy || calc.total <= 0} onClick={save}>{editId ? '🔒 Save changes' : `Save ${meta.name.toLowerCase()}`} <Kbd>Ctrl+S</Kbd></button>
        </div>
      </section>
      {serialLine && (
        <SerialDialog item={itemById[serialLine.item_id]} mode={serialMode} value={serialLine.serials}
          extra={editId ? orig?.lines.find((x) => x.item_id === serialLine.item_id)?.serials : null}
          strict qty={Number(serialLine.qty) || 0} allowed={serialLine.allowed || (type === 'PR' && ref ? ref.lines.find((x) => x.item_id === serialLine.item_id)?.returnable_serials : null)}
          onClose={() => setSerialFor(null)}
          onSave={(list) => {
            const row = serialFor;
            setLine(row, { serials: list }); setSerialFor(null);
            // carry on to the Rate box of the same row
            setTimeout(() => document.querySelectorAll('.bill-grid tbody tr')[row]?.querySelector('input.rate')?.focus(), 0);
          }} />
      )}
      {addParty && (
        <QuickParty type={isSale ? 'customer' : 'supplier'} name={addParty.name} asContact={isQuote && !f.party_id} onClose={() => setAddParty(null)}
          onSaved={async (p) => {
            if (isQuote && !f.party_id) { setContacts((cs) => [...cs, p]); pickContact(p); setAddParty(null); return; }
            const pa = await api.get('/parties', { type: isSale ? 'customer' : 'supplier' });
            setParties(pa); setAddParty(null); pickParty(p.id, pa);
          }} />
      )}
      {askPw && <PasswordPrompt title={`Save changes to ${orig?.doc_no}`} onConfirm={saveEdit} onClose={() => setAskPw(false)} />}
      {askTask && <TaskDialog doc={askTask} onDone={(nd) => { setAskTask(null); setSaved(nd); }}
        onSkip={() => { const d = askTask; setAskTask(null); setSaved(d); }} />}
      {saved && <DocView doc={saved} onClose={() => nav(`/docs/${type}`)} />}
    </>
  );
}
