import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context';
import { ReportButtons, ReportHeader } from '../components/Report';
import { PeriodBar } from '../components/inputs';
import { api, fmtMoney } from '../lib/api';

/** Monthly Expenses & Profit: one row per Nepali month — sales, cost of goods, gross profit, other income,
 *  expenses (optionally split by expense group) and net profit. */
export default function MonthlyProfit() {
  const { fy, today } = useApp();
  const [from, setFrom] = useState(fy.start_date);
  const [to, setTo] = useState(today);
  const [split, setSplit] = useState(true);
  const [data, setData] = useState(null);
  const area = useRef(null);

  useEffect(() => { setData(null); api.get('/reports/monthly-profit', { date_from: from, date_to: to }).then(setData); }, [from, to]);

  const groups = split ? (data?.expense_groups || []) : [];
  const m = (v) => (v ? fmtMoney(v) : '—');
  const best = data ? Math.max(...data.months.map((x) => x.net_profit), 0) : 0;

  return (
    <>
      <header className="page-head"><h1>Monthly Expenses &amp; Profit</h1><span className="muted">by Nepali month · stock at weighted average cost</span></header>
      <PeriodBar from={from} to={to} fy={fy} onChange={(f, t) => { setFrom(f); setTo(t); }}>
        <label className="check"><input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} /> Split expenses by group</label>
        <span className="spacer" />
        <ReportButtons areaRef={area} title="Monthly Expenses & Profit" from={from} to={to} />
      </PeriodBar>
      {data && (
        <section className="card print-area" ref={area}>
          <ReportHeader title="Monthly Expenses & Profit" from={from} to={to} />
          <div className="pl-kpis no-print">
            <div><span>Sales</span><b>Rs. {fmtMoney(data.totals.sales)}</b></div>
            <div><span>Gross profit</span><b className={data.totals.gross_profit < 0 ? 'neg' : 'pos'}>Rs. {fmtMoney(data.totals.gross_profit)}</b></div>
            <div><span>Expenses</span><b>Rs. {fmtMoney(data.totals.expenses)}</b></div>
            <div className={data.totals.net_profit < 0 ? 'loss' : 'profit'}><span>{data.totals.net_profit < 0 ? 'Net loss' : 'Net profit'}</span><b>Rs. {fmtMoney(Math.abs(data.totals.net_profit))}</b></div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="grid tb dg-soft mp-table">
              <thead><tr>
                <th className="sn">SN</th><th>Month</th><th className="num">Sales</th><th className="num">Cost of Goods</th><th className="num">Gross Profit</th>
                <th className="num">Other Income</th>
                {groups.map((x) => <th key={x.code} className="num mp-exp" title={x.name}>{x.name}</th>)}
                <th className="num">Total Expenses</th><th className="num">Net Profit</th>
              </tr></thead>
              <tbody>
                {data.months.map((r, i) => (
                  <tr key={r.key}>
                    <td className="sn">{i + 1}</td>
                    <td><b>{r.label}</b></td>
                    <td className="num">{m(r.sales)}</td>
                    <td className="num">{m(r.cogs)}</td>
                    <td className={`num ${r.gross_profit < 0 ? 'neg' : ''}`}>{m(r.gross_profit)}</td>
                    <td className="num">{m(r.other_income)}</td>
                    {groups.map((x) => <td key={x.code} className="num mp-exp">{m(r.expense_by_group[x.code])}</td>)}
                    <td className="num"><b>{m(r.expenses)}</b></td>
                    <td className={`num ${r.net_profit < 0 ? 'neg' : 'pos'}`}>
                      <b>{fmtMoney(r.net_profit)}</b>{r.net_profit > 0 && r.net_profit === best && <span title="Best month"> ★</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr>
                <th colSpan={2}>Total</th>
                <th className="num">{fmtMoney(data.totals.sales)}</th><th className="num">{fmtMoney(data.totals.cogs)}</th>
                <th className="num">{fmtMoney(data.totals.gross_profit)}</th><th className="num">{fmtMoney(data.totals.other_income)}</th>
                {groups.map((x) => <th key={x.code} className="num">{fmtMoney(data.totals.expense_by_group[x.code])}</th>)}
                <th className="num">{fmtMoney(data.totals.expenses)}</th><th className="num">{fmtMoney(data.totals.net_profit)}</th>
              </tr></tfoot>
            </table>
          </div>
          <p className="muted small" style={{ margin: '10px 4px 0' }}>
            Cost of goods for each month = opening stock + purchases − closing stock of that month, so the monthly figures add up to the Profit &amp; Loss Account for the same period.
          </p>
        </section>
      )}
    </>
  );
}
