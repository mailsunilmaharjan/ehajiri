import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from '../lib/router';
import { useApp } from '../context';
import { AccountSelect, Amount, BsDateInput, Kbd } from '../components/inputs';
import VoucherView from '../components/VoucherView';
import { PasswordPrompt } from '../components/Guards';
import { api, fmtBal, fmtMoney } from '../lib/api';
import { useShortcuts } from '../lib/keys';
import { amountInWords } from '../lib/words';

/* Simple entry screens — the user never chooses Debit/Credit; we build the voucher lines:
   expense           Dr expense heads (+ Input VAT)        Cr Cash/Bank (or Supplier, if on credit)
   supplier_payment  Dr Supplier                           Cr Cash/Bank
   receipt           Dr Cash/Bank                          Cr Customer
   transfer          Dr To (cash/bank)                     Cr From (cash/bank)
   asset_purchase    Dr fixed asset(s) (+ Input VAT)       Cr Cash/Bank (or Supplier, if on credit)
   asset_sale        Dr Cash/Bank (or Customer) + Dr Accumulated Depreciation
                     Cr fixed asset (cost) + Cr Output VAT, and the difference to Gain (Cr) / Loss (Dr) on Sale of Assets
   journal           Dr "To" account                       Cr "From" account   (per row)            */
export const KINDS = {
  expense: { title: 'Expense', icon: '💸', hint: 'Rent, electricity, salary, fuel, office expenses… paid now or on credit.' },
  supplier_payment: { title: 'Supplier Payment', icon: '📤', hint: 'Money paid to a supplier — reduces what we owe them.' },
  receipt: { title: 'Payment Received', icon: '📥', hint: 'Money received from a customer — reduces what they owe us.' },
  capital_loan: { title: 'Capital / Loan Received', icon: '💰', hint: 'Owner/partner capital or a director / bank loan received into Cash or Bank.' },
  staff_advance: { title: 'Staff Advance / Loan', icon: '👷', hint: 'Give advance salary or a loan to staff — and record it when deducted from salary or repaid.' },
  transfer: { title: 'Cash / Bank Transfer', icon: '🔁', hint: 'Cash deposited to bank, cash withdrawn, bank to bank.' },
  asset_purchase: { title: 'Asset Purchase', icon: '🏢', hint: 'Buy a fixed asset — computer, furniture, vehicle, equipment, land… paid now or on credit.' },
  asset_sale: { title: 'Asset Sale', icon: '🏷️', hint: 'Sell an old fixed asset — profit or loss on the sale is worked out for you.' },
  journal: { title: 'Journal Voucher', icon: '📒', hint: 'Adjustments: move an amount FROM one account TO another (e.g. depreciation, capital introduced, write-offs).' },
};
/** Every voucher type in one searchable list — choosing one opens that voucher form. */
export const VOUCHER_TYPES = [
  ...Object.entries(KINDS).map(([k, m]) => ({ id: k, name: `${m.icon} ${m.title}`, group_name: m.hint, path: `/entry/${k}` })),
  { id: 'advanced', name: '⚙️ Advanced Voucher (Dr / Cr)', group_name: 'Enter debit and credit lines yourself', path: '/voucher/JV' },
];
export function VoucherTypePicker({ current, disabled, children }) {
  const nav = useNavigate();
  return (
    <div className="vtype-bar">
      <span className="vtype-label">Voucher Type</span>
      {disabled ? <b className="vtype-fixed">{VOUCHER_TYPES.find((t) => t.id === current)?.name}</b> : (
        <AccountSelect accounts={VOUCHER_TYPES} value={current} placeholder="Search voucher type…"
          onChange={(id) => { const t = VOUCHER_TYPES.find((x) => x.id === id); if (t && t.id !== current) nav(t.path); }} />
      )}
      {children}
    </div>
  );
}
const VTYPE = { expense: 'PV', supplier_payment: 'PV', receipt: 'RV', capital_loan: 'RV', transfer: 'CV', journal: 'JV' };
const STAFF_ACTIONS = [['give', 'Give to staff (paid from Cash / Bank)'], ['deduct', 'Deducted from salary'], ['repay', 'Repaid by staff (into Cash / Bank)']];
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const row = () => ({ account_id: null, amount: '', note: '' });
const jrow = () => ({ from_id: null, to_id: null, amount: '', note: '' });

export default function SimpleVoucher() {
  const { kind, id } = useParams();
  const editId = Number(id) || null;
  const meta = KINDS[kind] || KINDS.journal;
  const nav = useNavigate();
  const { accounts, today, notify, company, fy } = useApp();
  const isExp = kind === 'expense' || kind === 'asset_purchase';   // same form: heads grid + paid now / on credit
  const [parties, setParties] = useState([]);
  const [f, setF] = useState(null);
  const [rows, setRows] = useState([row()]);
  const [jrows, setJrows] = useState([jrow()]);
  const [saved, setSaved] = useState(null);
  const [orig, setOrig] = useState(null);
  const [askPw, setAskPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [staff, setStaff] = useState([]);
  const loadStaff = () => api.get('/staff').then((s) => { setStaff(s); return s; });

  const cashBank = useMemo(() => accounts.filter((a) => a.kind === 'cash' || a.kind === 'bank'), [accounts]);
  const expenseHeads = useMemo(() => accounts.filter((a) => a.nature === 'X' || a.group_code === '1101' || a.group_code === '1204')
    .filter((a) => !['purchase', 'purchase_return', 'sales', 'sales_return'].includes(a.system_key))
    .sort((a, b) => (a.nature === b.nature ? a.name.localeCompare(b.name) : a.nature === 'X' ? -1 : 1)), [accounts]);
  // Capital / Loan Received: equity (capital) accounts and borrowings — not cash/bank, drawings or retained earnings
  const capitalLoanSources = useMemo(() => accounts.filter((a) => a.kind !== 'cash' && a.kind !== 'bank'
    && ((a.nature === 'E' && !['drawings', 'retained_earnings'].includes(a.system_key))
      || ['2101', '2202'].includes(a.group_code) || /loan|borrow/i.test(a.name))), [accounts]);
  // fixed assets = ledgers under Property, Plant and Equipment (1101) or Intangible Assets (1102), not Accumulated Depreciation
  const assetHeads = useMemo(() => accounts.filter((a) => /^110[12]/.test(a.group_code || '') && a.system_key !== 'acc_dep')
    .sort((a, b) => a.name.localeCompare(b.name)), [accounts]);
  const accDep = accounts.find((a) => a.system_key === 'acc_dep');
  const outputVat = accounts.find((a) => a.system_key === 'output_vat');
  const gainAcc = accounts.find((a) => a.system_key === 'asset_sale_gain');
  const lossAcc = accounts.find((a) => a.system_key === 'asset_sale_loss');
  const inputVat = accounts.find((a) => a.system_key === 'input_vat');
  const salaryAcc = accounts.find((a) => a.system_key === 'salary');
  const defCash = cashBank.find((a) => a.system_key === 'cash')?.id || cashBank[0]?.id || null;

  useEffect(() => {
    setSaved(null);
    const ptype = kind === 'receipt' || kind === 'asset_sale' ? 'customer' : 'supplier';
    api.get('/parties', { type: ptype }).then(setParties);
    const base = { vdate: today, cash_id: defCash, to_cash_id: cashBank.find((a) => a.id !== defCash)?.id || null, party_id: null,
      amount: '', reference: '', narration: '', paid_by: 'cash', vat_bill: false, staff_id: null, staff_action: 'give', staff_type: 'advance',
      asset_id: null, cost: '', dep: '' };
    const staffReady = kind === 'staff_advance' ? loadStaff() : Promise.resolve([]);
    if (!editId) { setOrig(null); setF(base); setRows([row()]); setJrows([jrow()]); return; }
    Promise.all([api.get(`/vouchers/${editId}`), staffReady]).then(([v, st]) => {
      setOrig(v);
      const cb = (l) => cashBank.some((a) => a.id === l.account_id);
      const dr = v.lines.filter((l) => l.dr > 0); const cr = v.lines.filter((l) => l.cr > 0);
      const g = { ...base, vdate: v.vdate, reference: v.reference || '', narration: v.narration || '' };
      if (kind === 'asset_sale') {
        const assetLine = cr.find((l) => assetHeads.some((a) => a.id === l.account_id));
        const vatLine = cr.find((l) => l.account_id === outputVat?.id);
        const depLine = dr.find((l) => l.account_id === accDep?.id);
        const money = dr.find((l) => l !== depLine && l.account_id !== lossAcc?.id);
        setF({ ...g, asset_id: assetLine?.account_id || null, cost: assetLine?.cr || '', dep: depLine?.dr || '', vat_bill: !!vatLine,
          amount: money?.dr || '', paid_by: money && !cb(money) ? 'credit' : 'cash',
          cash_id: money && cb(money) ? money.account_id : defCash, party_id: money && !cb(money) ? money.account_id : null });
      } else if (isExp) {
        const credit = cr[0];
        const vatLine = dr.find((l) => l.account_id === inputVat?.id);
        const exp = dr.filter((l) => l !== vatLine);
        const sumNet = exp.reduce((s, l) => s + l.dr, 0);
        let rs = exp.map((l) => ({ account_id: l.account_id, note: l.note || '',
          amount: vatLine ? r2(l.dr + (vatLine.dr * l.dr) / sumNet) : l.dr }));
        if (vatLine && rs.length) { const diff = r2(credit.cr - rs.reduce((s, x) => s + x.amount, 0)); rs[rs.length - 1].amount = r2(rs[rs.length - 1].amount + diff); }
        setF({ ...g, paid_by: cb(credit) ? 'cash' : 'credit', cash_id: cb(credit) ? credit.account_id : defCash,
          party_id: cb(credit) ? null : credit.account_id, vat_bill: !!vatLine });
        setRows(rs.length ? rs : [row()]);
      } else if (kind === 'supplier_payment') {
        setF({ ...g, party_id: dr[0]?.account_id, cash_id: cr[0]?.account_id, amount: v.amount });
      } else if (kind === 'receipt' || kind === 'capital_loan') {
        setF({ ...g, party_id: cr[0]?.account_id, cash_id: dr[0]?.account_id, amount: v.amount });
      } else if (kind === 'transfer') {
        setF({ ...g, cash_id: cr[0]?.account_id, to_cash_id: dr[0]?.account_id, amount: v.amount });
      } else if (kind === 'staff_advance') {
        const s = st.find((x) => v.lines.some((l) => l.account_id === x.advance_id || l.account_id === x.loan_id));
        const sl = v.lines.find((l) => s && (l.account_id === s.advance_id || l.account_id === s.loan_id));
        const other = v.lines.find((l) => l !== sl);
        const action = sl?.dr > 0 ? 'give' : cb(other || {}) ? 'repay' : 'deduct';
        setF({ ...g, staff_id: s?.id || null, staff_type: sl && s && sl.account_id === s.loan_id ? 'loan' : 'advance', staff_action: action,
          cash_id: action === 'deduct' ? defCash : other?.account_id, amount: v.amount });
      } else {
        const pairs = [];
        for (let i = 0; i < v.lines.length; i += 2) {
          const a = v.lines[i]; const b = v.lines[i + 1] || {};
          const d = a.dr > 0 ? a : b; const c = a.dr > 0 ? b : a;
          pairs.push({ to_id: d.account_id, from_id: c.account_id, amount: d.dr || c.cr, note: d.note || '' });
        }
        setF(g); setJrows([...pairs, jrow()]);
      }
    }).catch((e) => notify(e.message, 'err'));
  }, [kind, editId]);

  const party = parties.find((p) => p.id === f?.party_id);
  const vatRate = company.vat_registered ? company.vat_rate : 0;

  /** Build the Dr/Cr lines from the simple form. */
  const build = () => {
    const L = [];
    if (kind === 'asset_sale') {
      const amt = r2(f.amount || 0);
      const vat = f.vat_bill && vatRate ? r2(amt - amt / (1 + vatRate / 100)) : 0;
      const cost = r2(f.cost || 0); const dep = r2(f.dep || 0);
      const diff = r2(amt - vat - (cost - dep));                       // + gain / − loss
      L.push({ account_id: f.paid_by === 'cash' ? f.cash_id : f.party_id, dr: amt, cr: 0 });
      if (dep > 0) L.push({ account_id: accDep?.id, dr: dep, cr: 0, note: 'Depreciation on asset sold' });
      if (diff < 0) L.push({ account_id: lossAcc?.id, dr: -diff, cr: 0, note: 'Loss on sale' });
      if (cost > 0) L.push({ account_id: f.asset_id, dr: 0, cr: cost, note: 'Asset sold' });
      if (vat > 0) L.push({ account_id: outputVat?.id, dr: 0, cr: vat, note: 'Output VAT' });
      if (diff > 0) L.push({ account_id: gainAcc?.id, dr: 0, cr: diff, note: 'Gain on sale' });
      return { vtype: f.paid_by === 'cash' ? 'RV' : 'JV', lines: L, total: r2(amt + dep + Math.max(-diff, 0)), amt, vat, cost, dep, diff };
    }
    if (isExp) {
      const rs = rows.filter((r) => r.account_id && Number(r.amount) > 0);
      const total = r2(rs.reduce((s, r) => s + Number(r.amount), 0));
      let vat = 0;
      rs.forEach((r) => {
        const net = f.vat_bill && vatRate ? r2(Number(r.amount) / (1 + vatRate / 100)) : r2(r.amount);
        vat += r2(Number(r.amount) - net);
        L.push({ account_id: r.account_id, dr: net, cr: 0, note: r.note });
      });
      if (r2(vat) > 0) L.push({ account_id: inputVat.id, dr: r2(vat), cr: 0, note: 'Input VAT' });
      L.push({ account_id: f.paid_by === 'cash' ? f.cash_id : f.party_id, dr: 0, cr: total });
      return { vtype: f.paid_by === 'cash' ? 'PV' : 'JV', lines: L, total };
    }
    if (kind === 'journal') {
      const rs = jrows.filter((r) => r.from_id && r.to_id && Number(r.amount) > 0);
      rs.forEach((r) => { L.push({ account_id: r.to_id, dr: r2(r.amount), cr: 0, note: r.note }); L.push({ account_id: r.from_id, dr: 0, cr: r2(r.amount), note: r.note }); });
      return { vtype: 'JV', lines: L, total: r2(rs.reduce((s, r) => s + Number(r.amount), 0)) };
    }
    const amt = r2(f.amount);
    if (kind === 'supplier_payment') L.push({ account_id: f.party_id, dr: amt, cr: 0 }, { account_id: f.cash_id, dr: 0, cr: amt });
    if (kind === 'receipt' || kind === 'capital_loan') L.push({ account_id: f.cash_id, dr: amt, cr: 0 }, { account_id: f.party_id, dr: 0, cr: amt });
    if (kind === 'transfer') L.push({ account_id: f.to_cash_id, dr: amt, cr: 0 }, { account_id: f.cash_id, dr: 0, cr: amt });
    if (kind === 'staff_advance') {
      const s = staff.find((x) => x.id === f.staff_id);
      const led = s ? (f.staff_type === 'loan' ? s.loan_id : s.advance_id) : null;
      const note = f.staff_type === 'loan' ? 'Staff loan' : 'Advance salary';
      if (f.staff_action === 'give') { L.push({ account_id: led, dr: amt, cr: 0, note }, { account_id: f.cash_id, dr: 0, cr: amt }); return { vtype: 'PV', lines: L, total: amt }; }
      if (f.staff_action === 'repay') { L.push({ account_id: f.cash_id, dr: amt, cr: 0 }, { account_id: led, dr: 0, cr: amt, note }); return { vtype: 'RV', lines: L, total: amt }; }
      L.push({ account_id: salaryAcc?.id, dr: amt, cr: 0, note: 'Deducted from salary' }, { account_id: led, dr: 0, cr: amt, note });
      return { vtype: 'JV', lines: L, total: amt };
    }
    return { vtype: VTYPE[kind], lines: L, total: amt };
  };

  const validate = (b) => {
    if (kind === 'asset_sale') {
      if (!f.asset_id) return 'Choose the asset that was sold.';
      if (!(b.amt > 0)) return 'Enter the sale amount.';
      if (f.paid_by === 'credit' && !f.party_id) return 'Choose the buyer (customer).';
      if (b.dep > b.cost) return 'Depreciation can\'t be more than the cost of the asset.';
      if (!gainAcc || !lossAcc) return 'Gain / Loss on Sale of Assets ledgers are missing — refresh the page.';
      if (f.vat_bill && !outputVat) return 'The Output VAT ledger is missing.';
      if (b.dep > 0 && !accDep) return 'The Accumulated Depreciation ledger is missing.';
      return null;
    }
    if (!(b.total > 0)) return 'Enter an amount.';
    if (isExp && f.paid_by === 'credit' && !f.party_id) return 'Choose the supplier.';
    if ((kind === 'supplier_payment' || kind === 'receipt') && !f.party_id) return `Choose the ${kind === 'receipt' ? 'customer' : 'supplier'}.`;
    if (kind === 'capital_loan' && !f.party_id) return 'Choose where the money came from (Capital Account or a loan).';
    if (kind === 'transfer' && f.cash_id === f.to_cash_id) return 'From and To must be different accounts.';
    if (kind === 'staff_advance') {
      const s = staff.find((x) => x.id === f.staff_id);
      if (!s) return 'Choose the staff member.';
      if (f.staff_action === 'deduct' && !salaryAcc) return 'The "Salary and Wages" ledger is missing.';
      const owes = f.staff_type === 'loan' ? s.loan : s.advance;
      const before = editId ? Number(orig?.amount || 0) : 0;        // this voucher's own amount is already in the balance when editing
      if (f.staff_action !== 'give' && b.total > r2(owes + before) + 0.005) {
        return `${s.name} owes only Rs ${fmtMoney(owes + before)} on ${f.staff_type === 'loan' ? 'staff loan' : 'advance salary'}.`;
      }
    }
    if (kind === 'journal' && jrows.some((r) => (r.from_id || r.to_id || r.amount) && (!r.from_id || !r.to_id || !(Number(r.amount) > 0)))) return 'Each row needs From, To and an amount.';
    if (kind === 'journal' && jrows.some((r) => r.from_id && r.from_id === r.to_id)) return 'From and To can\'t be the same account.';
    return null;
  };

  const payload = () => {
    const b = build();
    return { vtype: editId ? orig.vtype : b.vtype, kind, vdate: f.vdate, reference: f.reference, narration: f.narration || defaultNarr(), lines: b.lines, total: b.total };
  };
  const defaultNarr = () => {
    const nm = (aid) => accounts.find((a) => a.id === aid)?.name || parties.find((p) => p.id === aid)?.name || '';
    if (kind === 'supplier_payment') return `Being payment made to ${nm(f.party_id)}`;
    if (kind === 'receipt') return `Being payment received from ${nm(f.party_id)}`;
    if (kind === 'capital_loan') {
      const src = accounts.find((a) => a.id === f.party_id);
      return src ? (src.nature === 'E' ? `Being capital introduced (${src.name})` : `Being loan received — ${src.name}`) : '';
    }
    if (kind === 'transfer') return `Being transfer from ${nm(f.cash_id)} to ${nm(f.to_cash_id)}`;
    if (kind === 'staff_advance') {
      const s = staff.find((x) => x.id === f.staff_id);
      if (!s) return '';
      const w = f.staff_type === 'loan' ? 'staff loan' : 'advance salary';
      if (f.staff_action === 'give') return `Being ${w} given to ${s.name}`;
      if (f.staff_action === 'repay') return `Being ${w} repaid by ${s.name}`;
      return `Being ${w} of ${s.name} deducted from salary`;
    }
    if (kind === 'expense') return `Being ${rows.filter((r) => r.account_id).map((r) => nm(r.account_id)).join(', ')} expense`;
    if (kind === 'asset_purchase') return `Being purchase of ${rows.filter((r) => r.account_id).map((r) => nm(r.account_id)).join(', ')}`;
    if (kind === 'asset_sale') return f.asset_id ? `Being sale of ${nm(f.asset_id)}${f.paid_by === 'credit' && f.party_id ? ` to ${nm(f.party_id)}` : ''}` : '';
    return '';
  };

  const save = async () => {
    if (busy || !f) return;
    const p = payload();
    const err = validate(p);
    if (err) { notify(err, 'err'); return; }
    if (editId) { setAskPw(true); return; }
    setBusy(true);
    try { const v = await api.post('/vouchers', p); notify(`${v.voucher_no} saved`); setSaved(v); if (kind === 'staff_advance') loadStaff(); }
    catch (e) { notify(e.message, 'err'); }
    setBusy(false);
  };
  const saveEdit = async (password) => {
    try { const v = await api.put(`/vouchers/${editId}`, { ...payload(), password }); setAskPw(false); notify(`${v.voucher_no} updated`); setSaved(v); }
    catch (e) { notify(e.message, 'err'); }
  };
  useShortcuts({ save, close: () => nav('/day-book') }, !saved && !askPw);

  if (!f) return <div className="muted">Loading…</div>;
  const b = build();
  const vatPart = isExp && f.vat_bill ? b.lines.find((l) => l.account_id === inputVat?.id)?.dr || 0 : 0;
  const setRow = (i, patch) => {
    let n = rows.map((r, j) => (j === i ? { ...r, ...patch } : r));
    if (i === n.length - 1 && n[i].account_id) n = [...n, row()];
    setRows(n);
  };
  const setJ = (i, patch) => {
    let n = jrows.map((r, j) => (j === i ? { ...r, ...patch } : r));
    if (i === n.length - 1 && n[i].from_id && n[i].to_id) n = [...n, jrow()];
    setJrows(n);
  };

  return (
    <>
      <header className="page-head">
        <h1>{meta.icon} {editId ? `Edit ${orig?.voucher_no || ''}` : meta.title}</h1><span className="muted">{meta.hint}</span>
        {orig?.edit_count > 0 && <span className="tag">edited {orig.edit_count}×</span>}
        <span className="spacer" /><span className="muted small">Enter = next · Ctrl+S = save · Esc = back</span>
      </header>
      <section className={`card entry-card v-${kind}`}>
        <VoucherTypePicker current={kind} disabled={!!editId}>
          <span className="vtype-date"><span className="vtype-label">Date (Miti) *</span>
            <BsDateInput value={f.vdate} onChange={(v) => setF({ ...f, vdate: v })} autoFocus={!editId} /></span>
        </VoucherTypePicker>
        <div className="doc-form three">

          {kind === 'asset_sale' && (() => {
            const pickAsset = async (aid) => {
              setF((x) => ({ ...x, asset_id: aid }));
              if (!aid) return;
              try {   // cost still on the books = the asset ledger's balance on the sale date
                const tb = await api.get('/reports/trial-balance', { date_from: fy.start_date, date_to: f.vdate, hide_zero: false });
                const bal = tb.rows.find((r) => r.id === aid)?.closing || 0;
                setF((x) => ({ ...x, cost: bal > 0 ? r2(bal) : '' }));
              } catch { /* user can type it */ }
            };
            return (
              <>
                <label>Asset Sold *
                  <AccountSelect accounts={assetHeads} value={f.asset_id} onChange={pickAsset} placeholder="Computer, Vehicle, Furniture…" />
                  <small>Not listed? Add a ledger under Property, Plant and Equipment in Chart of Accounts.</small>
                </label>
                <label>Received by
                  <select value={f.paid_by} onChange={(e) => setF({ ...f, paid_by: e.target.value })}>
                    <option value="cash">Cash / Bank (received now)</option><option value="credit">On credit (buyer pays later)</option>
                  </select>
                </label>
                {f.paid_by === 'cash' ? (
                  <label>Received in<select value={f.cash_id || ''} onChange={(e) => setF({ ...f, cash_id: Number(e.target.value) })}>
                    {cashBank.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
                ) : (
                  <label>Buyer (Customer) *<AccountSelect accounts={parties} value={f.party_id} onChange={(pid) => setF({ ...f, party_id: pid })} placeholder="Search customer…" /></label>
                )}
                <label>Sale Amount *<span className="money"><i>Rs.</i><Amount className="num big" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></span>
                  {f.vat_bill && <small>Includes {vatRate}% VAT</small>}</label>
                <label>Cost of Asset Sold (in books)<span className="money"><i>Rs.</i><Amount className="num" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} /></span>
                  <small>Filled from the asset ledger balance — change it if only part of the asset is sold.</small></label>
                <label>Depreciation Already Charged<span className="money"><i>Rs.</i><Amount className="num" value={f.dep} onChange={(e) => setF({ ...f, dep: e.target.value })} placeholder="0" /></span>
                  <small>Only if depreciation was kept in “Accumulated Depreciation”.</small></label>
                <label>Bill / Ref. No.<input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></label>
                {company.vat_registered && (
                  <label className="check"><input type="checkbox" checked={f.vat_bill} onChange={(e) => setF({ ...f, vat_bill: e.target.checked })} /> VAT bill — sale amount includes 13% VAT</label>
                )}
              </>
            );
          })()}

          {isExp && (
            <>
              <label>Paid by
                <select value={f.paid_by} onChange={(e) => setF({ ...f, paid_by: e.target.value })}>
                  <option value="cash">Cash / Bank (paid now)</option><option value="credit">On credit (supplier to be paid later)</option>
                </select>
              </label>
              {f.paid_by === 'cash' ? (
                <label>Paid from<select value={f.cash_id || ''} onChange={(e) => setF({ ...f, cash_id: Number(e.target.value) })}>
                  {cashBank.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
              ) : (
                <label>Supplier<AccountSelect accounts={parties} value={f.party_id} onChange={(pid) => setF({ ...f, party_id: pid })} placeholder="Search supplier…" /></label>
              )}
              <label>Bill / Ref. No.<input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></label>
              {company.vat_registered && (
                <label className="check"><input type="checkbox" checked={f.vat_bill} onChange={(e) => setF({ ...f, vat_bill: e.target.checked })} /> VAT bill — amounts include 13% VAT (claim input VAT)</label>
              )}
            </>
          )}

          {(kind === 'supplier_payment' || kind === 'receipt') && (
            <>
              <label>{kind === 'receipt' ? 'Customer' : 'Supplier'} *
                <AccountSelect accounts={parties} value={f.party_id} onChange={(pid) => {
                  const p = parties.find((x) => x.id === pid);
                  const due = p ? Math.abs(p.balance) : 0;
                  setF({ ...f, party_id: pid, amount: f.amount || (due ? r2(due) : '') });
                }} placeholder="Search…" />
                {party && <small>{kind === 'receipt' ? 'They owe' : 'We owe'}: <b>{fmtBal(party.balance)}</b></small>}
              </label>
              <label>{kind === 'receipt' ? 'Received in' : 'Paid from'}
                <select value={f.cash_id || ''} onChange={(e) => setF({ ...f, cash_id: Number(e.target.value) })}>
                  {cashBank.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
              <label>Amount *<span className="money"><i>Rs.</i><Amount type="number" min="0" step="0.01" className="num big" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></span></label>
              <label>Cheque / Ref. No.<input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder="Cheque no., eSewa / bank ref" /></label>
            </>
          )}

          {kind === 'capital_loan' && (
            <>
              <label>Received from (Capital / Loan) *
                <AccountSelect accounts={capitalLoanSources} value={f.party_id} onChange={(pid) => setF({ ...f, party_id: pid })}
                  placeholder="Capital Account, Director Loan, Bank Loan…" />
                <small>Not listed? Add a ledger under Equity or Borrowings in Chart of Accounts.</small>
              </label>
              <label>Received in
                <select value={f.cash_id || ''} onChange={(e) => setF({ ...f, cash_id: Number(e.target.value) })}>
                  {cashBank.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
              <label>Amount *<span className="money"><i>Rs.</i><Amount className="num big" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></span></label>
              <label>Cheque / Deposit Ref. No.<input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder="Cheque no. / deposit slip" /></label>
            </>
          )}

          {kind === 'staff_advance' && (() => {
            const s = staff.find((x) => x.id === f.staff_id);
            return (
              <>
                <label>Staff Name *
                  <AccountSelect accounts={staff.map((x) => ({ ...x, group_name: x.total ? `owes Rs ${fmtMoney(x.total)}` : 'nothing due' }))}
                    value={f.staff_id} onChange={(sid) => setF({ ...f, staff_id: sid })} placeholder="Search staff… (type a new name to add)"
                    onAdd={async (q) => {
                      try { const n = await api.post('/staff', { name: q }); await loadStaff(); setF((x) => ({ ...x, staff_id: n.id })); notify(`${n.name} added to staff`); }
                      catch (e) { notify(e.message, 'err'); }
                    }} />
                  {s && <small>Owes us — Advance salary: <b>Rs {fmtMoney(s.advance)}</b> · Staff loan: <b>Rs {fmtMoney(s.loan)}</b></small>}
                </label>
                <label>Entry for
                  <select value={f.staff_action} onChange={(e) => setF({ ...f, staff_action: e.target.value })}>
                    {STAFF_ACTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
                <label>Type
                  <select value={f.staff_type} onChange={(e) => setF({ ...f, staff_type: e.target.value })}>
                    <option value="advance">Advance Salary</option><option value="loan">Staff Loan</option>
                  </select>
                </label>
                {f.staff_action !== 'deduct' ? (
                  <label>{f.staff_action === 'give' ? 'Paid from' : 'Received in'}
                    <select value={f.cash_id || ''} onChange={(e) => setF({ ...f, cash_id: Number(e.target.value) })}>
                      {cashBank.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
                ) : (
                  <label>Deducted against<input readOnly tabIndex={-1} value={salaryAcc?.name || 'Salary and Wages'} /></label>
                )}
                <label>Amount *<span className="money"><i>Rs.</i><Amount className="num big" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></span></label>
                <label>Cheque / Ref. No.<input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder="Cheque no. / salary month" /></label>
                <div className="pay-note staff-note">
                  {f.staff_action === 'give' && 'Money goes out of Cash / Bank; the staff member now owes this amount.'}
                  {f.staff_action === 'deduct' && 'Use this when paying salary: record the cash actually paid as a Salary expense, and the deducted part here.'}
                  {f.staff_action === 'repay' && 'Staff paid back in cash or to the bank — what they owe goes down.'}
                </div>
              </>
            );
          })()}

          {kind === 'transfer' && (
            <>
              <label>From<select value={f.cash_id || ''} onChange={(e) => setF({ ...f, cash_id: Number(e.target.value) })}>
                {cashBank.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
              <label>To<select value={f.to_cash_id || ''} onChange={(e) => setF({ ...f, to_cash_id: Number(e.target.value) })}>
                {cashBank.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
              <label>Amount *<span className="money"><i>Rs.</i><Amount type="number" min="0" step="0.01" className="num big" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></span></label>
              <label>Cheque / Ref. No.<input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></label>
            </>
          )}
          {kind === 'journal' && <label>Reference<input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></label>}
        </div>

        {isExp && (
          <>
            <div className="section-label">{kind === 'asset_purchase' ? 'ASSETS BOUGHT' : 'EXPENSES'}</div>
            <table className="grid entry">
              <thead><tr><th className="sn">SN</th><th style={{ width: '45%' }}>{kind === 'asset_purchase' ? 'ASSET' : 'EXPENSE HEAD'}</th><th className="num" style={{ width: 160 }}>AMOUNT Rs.{f.vat_bill ? ' (incl. VAT)' : ''}</th><th>NOTE</th><th style={{ width: 30 }} /></tr></thead>
              <tbody>{rows.map((r, i) => (
                <tr key={i}>
                  <td className="sn">{i + 1}</td>
                  <td><AccountSelect accounts={kind === 'asset_purchase' ? assetHeads : expenseHeads} value={r.account_id} onChange={(aid) => setRow(i, { account_id: aid })}
                    placeholder={kind === 'asset_purchase' ? 'Computer, Furniture, Vehicle…' : 'Rent, Electricity, Salary…'}
                    onEmptyEnter={() => document.querySelector('.narr')?.focus()} /></td>
                  <td><Amount className="num" type="number" min="0" step="0.01" value={r.amount} onChange={(e) => setRow(i, { amount: e.target.value })} /></td>
                  <td><input value={r.note} onChange={(e) => setRow(i, { note: e.target.value })} /></td>
                  <td>{rows.length > 1 && <button type="button" className="link del-x" tabIndex={-1} onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button>}</td>
                </tr>))}</tbody>
            </table>
            {kind === 'asset_purchase' && <p className="muted small">Asset not listed? Add a ledger under Property, Plant and Equipment in Chart of Accounts.</p>}
          </>
        )}

        {kind === 'journal' && (
          <>
            <div className="section-label">ENTRIES — amount moves FROM → TO</div>
            <table className="grid entry">
              <thead><tr><th className="sn">SN</th><th style={{ width: '32%' }}>FROM (gives / source)</th><th style={{ width: '32%' }}>TO (receives / expense)</th>
                <th className="num" style={{ width: 140 }}>AMOUNT Rs.</th><th>NOTE</th><th style={{ width: 30 }} /></tr></thead>
              <tbody>{jrows.map((r, i) => (
                <tr key={i}>
                  <td className="sn">{i + 1}</td>
                  <td><AccountSelect accounts={accounts} value={r.from_id} onChange={(aid) => setJ(i, { from_id: aid })} placeholder="e.g. Capital Account"
                    onEmptyEnter={() => document.querySelector('.narr')?.focus()} /></td>
                  <td><AccountSelect accounts={accounts} value={r.to_id} onChange={(aid) => setJ(i, { to_id: aid })} placeholder="e.g. Cash in Hand" /></td>
                  <td><Amount className="num" type="number" min="0" step="0.01" value={r.amount} onChange={(e) => setJ(i, { amount: e.target.value })} /></td>
                  <td><input value={r.note} onChange={(e) => setJ(i, { note: e.target.value })} /></td>
                  <td>{jrows.length > 1 && <button type="button" className="link del-x" tabIndex={-1} onClick={() => setJrows(jrows.filter((_, j) => j !== i))}>✕</button>}</td>
                </tr>))}</tbody>
            </table>
            <p className="muted small">Examples: Owner brings cash → FROM Capital Account TO Cash in Hand. Yearly depreciation → FROM Accumulated Depreciation TO Depreciation.</p>
          </>
        )}

        <div className="inv-foot">
          <div className="words">
            <div className="section-label">IN WORDS</div>
            <div className="words-box">{amountInWords(b.total)}</div>
            <div className="section-label">NARRATION</div>
            <textarea className="narr" rows={2} value={f.narration} placeholder={defaultNarr() || 'Being …'} onChange={(e) => setF({ ...f, narration: e.target.value })} />
          </div>
          <div className="total-card">
            {isExp && vatPart > 0 && <div className="muted"><span>{kind === 'asset_purchase' ? 'Asset cost' : 'Expense'} (excl. VAT)</span><b>Rs.{fmtMoney(b.total - vatPart)}</b></div>}
            {vatPart > 0 && <div className="vat"><span>Input VAT {vatRate}%</span><b>Rs.{fmtMoney(vatPart)}</b></div>}
            {kind === 'asset_sale' ? (
              <>
                <div className="muted"><span>Book value (cost − depreciation)</span><b>Rs.{fmtMoney(b.cost - b.dep)}</b></div>
                {b.vat > 0 && <div className="vat"><span>Output VAT {vatRate}%</span><b>Rs.{fmtMoney(b.vat)}</b></div>}
                <div className={b.diff >= 0 ? 'gain' : 'loss'}><span>{b.diff >= 0 ? 'Profit on sale' : 'Loss on sale'}</span><b>Rs.{fmtMoney(Math.abs(b.diff))}</b></div>
                <div className="grand"><span>Sale Amount</span><b>Rs.{fmtMoney(b.amt)}</b></div>
              </>
            ) : <div className="grand"><span>Total</span><b>Rs.{fmtMoney(b.total)}</b></div>}
          </div>
        </div>
        <div className="actions">
          <button className="ghost" onClick={() => nav('/day-book')}>Cancel <Kbd>Esc</Kbd></button>
          <span className="muted small">Accounting entries (Dr/Cr) are made automatically.</span>
          <span className="spacer" />
          <button data-save disabled={busy || !(b.total > 0)} onClick={save}>{editId ? '🔒 Save changes' : `Save ${meta.title.toLowerCase()}`} <Kbd>Ctrl+S</Kbd></button>
        </div>
      </section>
      {askPw && <PasswordPrompt title={`Save changes to ${orig?.voucher_no}`} onConfirm={saveEdit} onClose={() => setAskPw(false)} />}
      {saved && <VoucherView v={saved} onClose={() => { setSaved(null); if (editId) nav('/day-book'); else { setF({ ...f, amount: '', reference: '', narration: '', asset_id: null, cost: '', dep: '' }); setRows([row()]); setJrows([jrow()]); } }} onChanged={setSaved} />}
    </>
  );
}
