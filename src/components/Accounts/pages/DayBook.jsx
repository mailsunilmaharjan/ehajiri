import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context';
import { Link } from '../lib/router';
import { ReportButtons, ReportHeader } from '../components/Report';
import { PeriodBar } from '../components/inputs';
import VoucherView from '../components/VoucherView';
import { RemarksRow, UpdatedBy, useGrid } from '../components/DataGrid';
import { api, fmtMoney } from '../lib/api';
import { fmtAd, fmtBs, fmtSaved, fmtBsShort } from '../lib/dates';

const COLS = 10;
const VAT_KEYS = ['input_vat', 'output_vat'];
const sum = (list, f) => list.reduce((s, x) => s + f(x), 0);

/** One voucher → one row: debit ledgers, credit ledgers and the VAT part kept apart. */
function split(v) {
  const vatLines = v.lines.filter((l) => VAT_KEYS.includes(l.system_key));
  const rest = v.lines.filter((l) => !VAT_KEYS.includes(l.system_key));
  const vat = sum(vatLines, (l) => l.dr + l.cr);
  return {
    dr: rest.filter((l) => l.dr > 0).map((l) => ({ name: l.account, amt: l.dr })),
    cr: rest.filter((l) => l.cr > 0).map((l) => ({ name: l.account, amt: l.cr })),
    vat, vatName: vatLines.map((l) => l.account).join(', '),
    amount: Math.round((v.amount - vat) * 100) / 100,
  };
}

/** Ledger names; when a side has more than one ledger each gets its own amount. */
function Accs({ list }) {
  if (list.length <= 1) return list[0]?.name || '';
  return list.map((a, i) => <div key={i} className="db-acc">{a.name} <span className="muted small">{fmtMoney(a.amt)}</span></div>);
}

/** Day Book. With `fixedType` (e.g. 'JV') it is the list of just that voucher type — used by the Journal Voucher Entries page. */
export default function DayBook({ fixedType = '', fixedKind = '', title = 'Day Book', sub = '', newTo = '', newLabel = 'journal voucher' }) {
  const { fy, today } = useApp();
  const [from, setFrom] = useState(fy.start_date);
  const [to, setTo] = useState(today);
  const [vtypeSel, setVtype] = useState('');
  const vtype = fixedType || vtypeSel;
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(null);
  const area = useRef(null);
  const g = useGrid({ rows, onOpen: setOpen });
  const curV = g.curRow;

  const load = () => api.get('/reports/day-book', { date_from: from, date_to: to, ...(vtype ? { vtype } : {}), ...(fixedKind ? { kind: fixedKind } : {}) }).then(setRows);
  useEffect(() => { load(); }, [from, to, vtype, fixedKind]);

  const posted = rows.filter((v) => v.status === 'posted');
  return (
    <>
      <header className="page-head"><h1>{title}</h1>{sub && <span className="muted">{sub}</span>}{newTo && <><span className="spacer" /><Link className="btn edit-only" data-new title="F1 / Alt+N" to={newTo}>+ New {newLabel} <kbd className="kbd">F1</kbd></Link></>}</header>
      <PeriodBar from={from} to={to} fy={fy} onChange={(f, t) => { setFrom(f); setTo(t); }}>
        {!fixedType && !fixedKind && <select value={vtype} onChange={(e) => setVtype(e.target.value)}>
          <option value="">All vouchers</option>
          <option value="PB">Purchase</option><option value="PR">Purchase Return</option>
          <option value="SI">Sales</option><option value="SR">Sales Return</option>
          <option value="RV">Amount Received</option><option value="PV">Amount Paid</option>
          <option value="CV">Cash / Bank Transfer</option><option value="JV">Journal</option>
        </select>}
        <span className="spacer" />
        <ReportButtons areaRef={area} title={title} from={from} to={to} />
      </PeriodBar>
      <section className="card print-area" ref={area}>
        <ReportHeader title={title} from={from} to={to} />
        <table ref={g.gridRef} className="grid dg-soft daybook-grid">
          <thead><tr>
            {g.tickTh}<th className="sn">SN</th><th className="nowrap" style={{ width: 190 }}>Miti | Date</th><th style={{ width: 140 }}>Voucher No.</th>
            <th style={{ width: 150 }}>Voucher Type</th><th>Particulars (Debit A/c)</th><th>To (Credit A/c)</th>
            <th className="num" style={{ width: 120 }}>Amount</th><th className="num" style={{ width: 110 }}>VAT</th><th className="num" style={{ width: 130 }}>Total</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={COLS} className="muted">No vouchers in this period.</td></tr>}
            {rows.map((v, idx) => {
              const s = split(v);
              return (
                <tr key={v.id} {...g.rowProps(v, v.status === 'cancelled' ? 'cancelled' : '')}>
                  {g.tickTd(v)}
                  <td className="sn">{idx + 1}</td>
                  <td className="nowrap">{fmtBsShort(v.vdate)}<span className="dl-sep">|</span>{fmtAd(v.vdate)}</td>
                  <td className="nowrap"><a onClick={() => setOpen(v)}>{v.voucher_no}</a>{v.status === 'cancelled' && <span className="tag">cancelled</span>}</td>
                  <td className="nowrap"><span className={`vt-chip vt-${v.vtype}`}>{v.day_type || v.type_name}</span></td>
                  <td><Accs list={s.dr} />
                    {/* on paper the narration stays under the voucher; on screen it is in the remarks box */}
                    {v.narration && !v.source_doc_id && <div className="muted small print-only">({v.narration})</div>}</td>
                  <td><Accs list={s.cr} /></td>
                  <td className="num">{fmtMoney(s.amount)}</td>
                  <td className="num">{s.vat ? <span className="db-vat" title={s.vatName}>{fmtMoney(s.vat)}</span> : ''}</td>
                  <td className="num b">{fmtMoney(v.amount)}</td>
                </tr>
              );
            })}
            {g.blankRows(COLS)}
            <RemarksRow g={g} cols={COLS} empty="Click a voucher to see its remarks. Double-click to open it."
              right={curV && <UpdatedBy name={curV.saved_by_name} when={fmtSaved(curV.updated_at || curV.created_at)} />}>
              {curV && <>
                <div><b>Remarks — {curV.voucher_no}:</b> {curV.narration || <span className="muted">no remarks on this voucher</span>}</div>
                <div className="rm-pay"><b>Entries:</b> {curV.lines.map((l) => `${l.cr > 0 ? 'To ' : ''}${l.account} ${fmtMoney(l.dr || l.cr)} ${l.dr ? 'Dr' : 'Cr'}`).join(' · ')}</div>
                <div className="rm-pay"><b>Voucher Type:</b> {curV.day_type}
                  {curV.reference && <> · <b>Ref.</b> {curV.reference}</>}
                  {curV.status === 'cancelled' && <> · <span className="neg">cancelled</span></>}</div>
              </>}
            </RemarksRow>
          </tbody>
          <tfoot><tr><th colSpan={7} className="num">Total ({posted.length} posted vouchers)</th>
            <th className="num">{fmtMoney(sum(posted, (v) => split(v).amount))}</th>
            <th className="num">{fmtMoney(sum(posted, (v) => split(v).vat))}</th>
            <th className="num">{fmtMoney(sum(posted, (v) => v.amount))}</th></tr></tfoot>
        </table>
      </section>
      {open && <VoucherView v={open} onClose={() => setOpen(null)} onChanged={(v) => { setOpen(v); load(); }} />}
    </>
  );
}
