import { useEffect, useRef, useState } from 'react';
import { Link } from '../lib/router';
import { useApp } from '../context';
import { ReportButtons, ReportHeader } from '../components/Report';
import { PeriodBar } from '../components/inputs';
import { api, fmtMoney } from '../lib/api';

/** Profit & Loss Account (trading format): Sales − Cost of goods sold = Gross profit; + Other income − Expenses = Net profit. */
export default function ProfitLoss() {
  const { fy, today } = useApp();
  const [from, setFrom] = useState(fy.start_date);
  const [to, setTo] = useState(today);
  const [detail, setDetail] = useState(true);
  const [data, setData] = useState(null);
  const area = useRef(null);

  useEffect(() => { setData(null); api.get('/reports/profit-loss', { date_from: from, date_to: to }).then(setData); }, [from, to]);

  const link = (id) => `/ledger?account=${id}&from=${from}&to=${to}`;
  const Groups = ({ groups }) => groups.map((g) => [
    <tr key={`g${g.code}`} className={detail ? 'sub' : ''}><td className="indent1">{g.name}</td><td className="num">{detail ? '' : fmtMoney(g.total)}</td><td className="num">{detail ? fmtMoney(g.total) : ''}</td></tr>,
    ...(detail ? g.rows.map((r) => (
      <tr key={r.id}><td className="indent2"><Link to={link(r.id)}>{r.name}</Link></td><td className="num">{fmtMoney(r.amount)}</td><td /></tr>
    )) : []),
  ]);
  const Line = ({ label, value, cls = '', note }) => (
    <tr className={cls}><td>{label}{note && <span className="muted small"> {note}</span>}</td><td /><td className="num">{fmtMoney(value)}</td></tr>
  );
  const net = data?.net_profit || 0;

  return (
    <>
      <header className="page-head"><h1>Profit &amp; Loss Account</h1><span className="muted">trading format · stock at weighted average cost</span></header>
      <PeriodBar from={from} to={to} fy={fy} onChange={(f, t) => { setFrom(f); setTo(t); }}>
        <label className="check"><input type="checkbox" checked={detail} onChange={(e) => setDetail(e.target.checked)} /> Show ledgers</label>
        <span className="spacer" />
        <ReportButtons areaRef={area} title="Profit & Loss Account" from={from} to={to} />
      </PeriodBar>
      {data && (
        <section className="card print-area pl-report" ref={area}>
          <ReportHeader title="Profit & Loss Account" from={from} to={to} />
          <div className="pl-kpis no-print">
            <div><span>Sales</span><b>Rs. {fmtMoney(data.sales)}</b></div>
            <div><span>Gross profit</span><b className={data.gross_profit < 0 ? 'neg' : 'pos'}>Rs. {fmtMoney(data.gross_profit)}</b></div>
            <div><span>Expenses</span><b>Rs. {fmtMoney(data.expenses)}</b></div>
            <div className={net < 0 ? 'loss' : 'profit'}><span>{net < 0 ? 'Net loss' : 'Net profit'}</span><b>Rs. {fmtMoney(Math.abs(net))}</b></div>
          </div>
          <table className="grid tb dg-soft pl-table">
            <thead><tr><th>Particulars</th><th className="num" style={{ width: 160 }}>Amount</th><th className="num" style={{ width: 170 }}>Total</th></tr></thead>
            <tbody>
              <tr className="pl-head"><td colSpan={3}>Trading</td></tr>
              <Groups groups={data.sales_rows} />
              <Line label="Net sales" value={data.sales} cls="pl-sum" />
              <tr><td className="indent1">Opening stock</td><td className="num">{fmtMoney(data.opening_stock)}</td><td /></tr>
              {data.purchase_rows.map((g) => [
                <tr key={`p${g.code}`}><td className="indent1">Add: {g.name}</td><td className="num">{fmtMoney(g.total)}</td><td /></tr>,
                ...(detail ? g.rows.map((r) => <tr key={`pr${r.id}`}><td className="indent2"><Link to={link(r.id)}>{r.name}</Link></td><td className="num muted">{fmtMoney(r.amount)}</td><td /></tr>) : []),
              ])}
              <tr><td className="indent1">Less: Closing stock</td><td className="num">({fmtMoney(data.closing_stock)})</td><td /></tr>
              <Line label="Less: Cost of goods sold" value={data.cogs} cls="pl-sum" />
              <Line label={data.gross_profit < 0 ? 'Gross loss' : 'Gross profit'} value={data.gross_profit} cls="pl-total" />

              <tr className="pl-head"><td colSpan={3}>Profit &amp; Loss</td></tr>
              {data.other_income_rows.length > 0 && <>
                <tr><td colSpan={3} className="muted small">Add: Other income</td></tr>
                <Groups groups={data.other_income_rows} />
                <Line label="Total other income" value={data.other_income} cls="pl-sum" />
              </>}
              <tr><td colSpan={3} className="muted small">Less: Expenses</td></tr>
              {data.expense_rows.length ? <Groups groups={data.expense_rows} /> : <tr><td colSpan={3} className="muted">No expenses in this period.</td></tr>}
              <Line label="Total expenses" value={data.expenses} cls="pl-sum" />
            </tbody>
            <tfoot>
              <tr className={net < 0 ? 'pl-loss' : 'pl-profit'}><th>{net < 0 ? 'Net Loss' : 'Net Profit'}</th><th /><th className="num">{fmtMoney(Math.abs(net))}</th></tr>
            </tfoot>
          </table>
        </section>
      )}
    </>
  );
}
