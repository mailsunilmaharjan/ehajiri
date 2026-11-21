import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context';
import { ReportButtons, ReportHeader } from '../components/Report';
import { PeriodBar } from '../components/inputs';
import { api, fmtMoney } from '../lib/api';

/** Monthly VAT return as filed with IRD: sales and output tax, purchases and input tax,
 *  credit brought forward, tax payable for the month or credit carried to the next month. */
export default function VatReturn() {
  const { fy, today, company } = useApp();
  const [from, setFrom] = useState(fy.start_date);
  const [to, setTo] = useState(fy.end_date || today);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(null);        // month key shown as the IRD form below
  const area = useRef(null);

  useEffect(() => {
    setData(null); setErr('');
    api.get('/reports/vat-return', { date_from: from, date_to: to }).then((d) => {
      setData(d);
      const withTx = [...d.months].reverse().find((x) => x.output_vat || x.input_vat);
      setOpen(withTx?.key || d.months[d.months.length - 1]?.key || null);
    }).catch((e) => setErr(e?.message || 'Could not load the report.'));
  }, [from, to]);

  const m = (v) => (v ? fmtMoney(v) : '—');
  const sel = data?.months.find((x) => x.key === open);
  const title = 'VAT Return';

  return (
    <>
      <div className="acc-reportcard">
        <header className="acc-formhead no-print">
          <span className="acc-head-ic">🏛️</span>
          <span className="acc-head-txt"><h1>{title}</h1>
            <small>Monthly VAT entry for IRD: output tax on sales − input tax on purchases = tax payable or credit carried forward</small></span>
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
            <div className="pl-kpis no-print">
              <div><span>Output VAT (sales)</span><b>Rs. {fmtMoney(data.totals.output_vat)}</b></div>
              <div><span>Input VAT (purchases)</span><b>Rs. {fmtMoney(data.totals.input_vat)}</b></div>
              <div className={data.totals.payable ? 'loss' : ''}><span>VAT paid / payable</span><b>Rs. {fmtMoney(data.totals.payable)}</b></div>
              <div className={data.totals.credit_cf ? 'profit' : ''}><span>Credit carried forward</span><b>Rs. {fmtMoney(data.totals.credit_cf)}</b></div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table className="grid tb dg-soft vat-return">
                <thead>
                  <tr>
                    <th rowSpan={2} className="sn">SN</th><th rowSpan={2}>Month</th>
                    <th colSpan={4} className="c">Sales</th>
                    <th colSpan={4} className="c">Purchase</th>
                    <th rowSpan={2} className="num">Credit b/f</th>
                    <th rowSpan={2} className="num">VAT payable</th>
                    <th rowSpan={2} className="num">Credit c/f</th>
                  </tr>
                  <tr>
                    <th className="num">Taxable</th><th className="num">Exempt</th>
                    <th className="num">Export</th><th className="num">Output VAT</th>
                    <th className="num">Taxable</th><th className="num">Exempt</th>
                    <th className="num">Import</th><th className="num">Input VAT</th>
                  </tr>
                </thead>
                <tbody>
                  {data.months.map((r, i) => (
                    <tr key={r.key} className={r.key === open ? 'selected' : ''} onClick={() => setOpen(r.key)} style={{ cursor: 'pointer' }}>
                      <td className="sn">{i + 1}</td><td><b>{r.label}</b></td>
                      <td className="num">{m(r.net_sales_taxable)}</td><td className="num">{m(r.net_sales_exempt)}</td>
                      <td className="num">{m(r.sales_export)}</td><td className="num"><b>{m(r.output_vat)}</b></td>
                      <td className="num">{m(r.net_purch_taxable)}</td><td className="num">{m(r.net_purch_exempt)}</td>
                      <td className="num">{m(r.purch_import)}</td><td className="num"><b>{m(r.input_vat)}</b></td>
                      <td className="num">{m(r.credit_bf)}</td>
                      <td className={`num ${r.payable ? 'neg' : ''}`}><b>{m(r.payable)}</b></td>
                      <td className={`num ${r.credit_cf ? 'pos' : ''}`}>{m(r.credit_cf)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr>
                  <th colSpan={2}>Total</th>
                  <th className="num">{fmtMoney(data.totals.net_sales_taxable)}</th><th className="num">{fmtMoney(data.totals.net_sales_exempt)}</th>
                  <th className="num">{fmtMoney(data.totals.sales_export)}</th><th className="num">{fmtMoney(data.totals.output_vat)}</th>
                  <th className="num">{fmtMoney(data.totals.net_purch_taxable)}</th><th className="num">{fmtMoney(data.totals.net_purch_exempt)}</th>
                  <th className="num">{fmtMoney(data.totals.purch_import)}</th><th className="num">{fmtMoney(data.totals.input_vat)}</th>
                  <th className="num">{fmtMoney(data.totals.credit_bf)}</th><th className="num">{fmtMoney(data.totals.payable)}</th>
                  <th className="num">{fmtMoney(data.totals.credit_cf)}</th>
                </tr></tfoot>
              </table>
            </div>

            {sel && (
              <div className="vat-form">
                <div className="vat-form-head">VAT Return — {sel.label}<span className="muted small"> · click a month above to change</span></div>
                <table className="grid tb vat-form-table">
                  <thead><tr><th>Particulars</th><th className="num">Value (Rs.)</th><th className="num">Tax (Rs.)</th></tr></thead>
                  <tbody>
                    <tr className="vat-month"><td colSpan={3}>Sales</td></tr>
                    <tr><td>Taxable sales</td><td className="num">{fmtMoney(sel.sales_taxable)}</td><td className="num">{fmtMoney(sel.sales_vat)}</td></tr>
                    <tr><td>Sales return</td><td className="num">({fmtMoney(sel.sret_taxable)})</td><td className="num">({fmtMoney(sel.sret_vat)})</td></tr>
                    <tr><td>Output VAT in vouchers, e.g. asset sale</td><td /><td className="num">{fmtMoney(sel.adj_output)}</td></tr>
                    <tr><td>Export</td><td className="num">{fmtMoney(sel.sales_export)}</td><td /></tr>
                    <tr><td>Exempt sales</td><td className="num">{fmtMoney(sel.net_sales_exempt)}</td><td /></tr>
                    <tr className="vat-subtotal"><td>Output tax</td><td className="num">{fmtMoney(sel.net_sales_taxable)}</td><td className="num">{fmtMoney(sel.output_vat)}</td></tr>
                    <tr className="vat-month"><td colSpan={3}>Purchase</td></tr>
                    <tr><td>Taxable purchase</td><td className="num">{fmtMoney(sel.purch_taxable)}</td><td className="num">{fmtMoney(sel.purch_vat)}</td></tr>
                    <tr><td>Purchase return</td><td className="num">({fmtMoney(sel.pret_taxable)})</td><td className="num">({fmtMoney(sel.pret_vat)})</td></tr>
                    <tr><td>Input VAT on expense &amp; asset bills</td><td /><td className="num">{fmtMoney(sel.adj_input)}</td></tr>
                    <tr><td>Import</td><td className="num">{fmtMoney(sel.purch_import)}</td><td /></tr>
                    <tr><td>Exempt purchase</td><td className="num">{fmtMoney(sel.net_purch_exempt)}</td><td /></tr>
                    <tr className="vat-subtotal"><td>Input tax</td><td className="num">{fmtMoney(sel.net_purch_taxable)}</td><td className="num">{fmtMoney(sel.input_vat)}</td></tr>
                    <tr className="vat-month"><td colSpan={3}>Tax calculation</td></tr>
                    <tr><td>Output − Input</td><td /><td className="num">{fmtMoney(sel.output_vat - sel.input_vat)}</td></tr>
                    <tr><td>Credit brought forward</td><td /><td className="num">({fmtMoney(sel.credit_bf)})</td></tr>
                  </tbody>
                  <tfoot>
                    {sel.payable
                      ? <tr className="pl-loss"><th>VAT payable to IRD</th><th /><th className="num">{fmtMoney(sel.payable)}</th></tr>
                      : <tr className="pl-profit"><th>Credit carried forward</th><th /><th className="num">{fmtMoney(sel.credit_cf)}</th></tr>}
                  </tfoot>
                </table>
              </div>
            )}
            <p className="muted small" style={{ margin: '10px 4px 0' }}>
              Figures come from posted Sales / Purchase bills and returns, plus Input VAT on expense and asset vouchers entered with a VAT bill.
              Credit brought forward at the start is the Input VAT ledger balance in excess of Output VAT before the period. Check against the VAT ledgers before filing.
            </p>
          </section>
        )}
      </div>
    </>
  );
}
