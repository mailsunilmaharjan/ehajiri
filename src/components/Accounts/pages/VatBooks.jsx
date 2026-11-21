import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context';
import { ReportButtons, ReportHeader } from '../components/Report';
import { PeriodBar } from '../components/inputs';
import { api, fmtMoney } from '../lib/api';

/* IRD Nepal VAT registers, month by month (Nepali months):
 *   <VatBook kind="sales" />    — बिक्री खाता (Sales Book)
 *   <VatBook kind="purchase" /> — खरिद खाता (Purchase Book)
 * Each month has its own subtotal row; the grand total is at the bottom. Dates are in BS, as IRD requires. */

const SALES_COLS = [
  ['total', 'Total Sales'],
  ['exempt', 'Non-taxable Sales'],
  ['export', 'Export Sales'],
  ['taxable', 'Taxable Sales'],
  ['vat', 'VAT'],
];
const PURCH_COLS = [
  ['total', 'Total Purchase'],
  ['exempt', 'Non-taxable Purchase'],
  ['taxable', 'Taxable Purchase'],
  ['vat', 'VAT'],
  ['import_taxable', 'Taxable Import'],
  ['import_vat', 'Import VAT'],
  ['capital_taxable', 'Capital Purchase'],
  ['capital_vat', 'Capital VAT'],
];
const KIND_TAG = { credit_note: 'Credit note', debit_note: 'Debit note', cancelled: 'Cancelled', expense: 'Expense', capital: 'Asset' };

export function VatBook({ kind }) {
  const sales = kind === 'sales';
  const { fy, today, company } = useApp();
  const [from, setFrom] = useState(fy.start_date);
  const [to, setTo] = useState(fy.end_date || today);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const area = useRef(null);
  const cols = sales ? SALES_COLS : PURCH_COLS;
  const title = sales ? 'VAT Sales Book' : 'VAT Purchase Book';

  useEffect(() => {
    setData(null); setErr('');
    api.get(sales ? '/reports/vat-sales' : '/reports/vat-purchase', { date_from: from, date_to: to })
      .then(setData).catch((e) => setErr(e?.message || 'Could not load the report.'));
  }, [from, to, sales]);

  const m = (v) => (v ? fmtMoney(v) : '');
  const FIXED = 5;   // SN, Date, Bill no, Name, PAN
  let sn = 0;
  return (
    <>
      <div className="acc-reportcard">
        <header className="acc-formhead no-print">
          <span className="acc-head-ic">{sales ? '🧾' : '📦'}</span>
          <span className="acc-head-txt"><h1>{title}</h1>
            <small>IRD format · month-wise with monthly subtotals · dates in BS{company?.pan ? ` · PAN ${company.pan}` : ''}</small></span>
        </header>
        <PeriodBar from={from} to={to} fy={fy} onChange={(f, t) => { setFrom(f); setTo(t); }}>
          <span className="spacer" />
          <ReportButtons areaRef={area} title={title} from={from} to={to} />
        </PeriodBar>
        {err && <div className="notice">⚠ {err}</div>}
        {!data && !err && <div className="muted" style={{ padding: 12 }}>Loading…</div>}
        {data && (
          <section className="card print-area" ref={area}>
            <ReportHeader title={title} subtitle={company?.pan ? `PAN / VAT No.: ${company.pan}` : ''} from={from} to={to} />
            <div style={{ overflowX: 'auto' }}>
              <table className="grid tb dg-soft vat-book">
                <thead>
                  <tr>
                    <th className="sn">SN</th>
                    <th>Date (BS)</th>
                    <th>Bill No.</th>
                    <th>{sales ? 'Buyer' : 'Supplier'}</th>
                    <th>PAN</th>
                                                            {cols.map(([k, en]) => <th key={k} className="num">{en}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {data.months.length === 0 && <tr><td colSpan={FIXED + cols.length} className="muted">No {sales ? 'sales' : 'purchase'} bills in this period.</td></tr>}
                  {data.months.map((mo) => [
                    <tr key={`h${mo.key}`} className="vat-month"><td colSpan={FIXED + cols.length}>{mo.label}</td></tr>,
                    ...mo.rows.map((r) => {
                      sn += 1;
                      return (
                        <tr key={r.id} className={r.kind === 'cancelled' ? 'vat-cancel' : ''}>
                          <td className="sn">{sn}</td>
                          <td className="nowrap">{r.date_bs}</td>
                          <td className="mono nowrap">{r.bill_no}{KIND_TAG[r.kind] && <span className="tag">{KIND_TAG[r.kind]}</span>}
                            {r.ref_no && <div className="muted small">against {r.ref_no}</div>}</td>
                          <td>{r.party}</td>
                          <td className="mono">{r.pan || '—'}</td>
                                                                              {cols.map(([k]) => <td key={k} className="num">{m(r[k])}</td>)}
                        </tr>
                      );
                    }),
                    <tr key={`t${mo.key}`} className="vat-subtotal">
                      <td colSpan={FIXED}>{mo.label} — total ({mo.rows.length} bills)</td>
                      {cols.map(([k]) => <td key={k} className="num">{fmtMoney(mo.totals[k])}</td>)}
                    </tr>,
                  ])}
                </tbody>
                <tfoot><tr>
                  <th colSpan={FIXED}>Grand Total</th>
                  {cols.map(([k]) => <th key={k} className="num">{fmtMoney(data.totals[k])}</th>)}
                </tr></tfoot>
              </table>
            </div>
            <p className="muted small" style={{ margin: '10px 4px 0' }}>
              {sales
                ? 'Credit notes (Sales Returns) are shown as negative amounts; cancelled invoices are listed with zero value, as IRD requires.'
                : 'Debit notes (Purchase Returns) are shown as negative amounts. Expense and asset vouchers entered with a VAT bill are included; assets appear as capital purchase.'}
            </p>
          </section>
        )}
      </div>
    </>
  );
}

export const VatSales = () => <VatBook kind="sales" />;
export const VatPurchase = () => <VatBook kind="purchase" />;
