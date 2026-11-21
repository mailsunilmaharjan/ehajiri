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
  // current fiscal year selected by default (full year, so the Fiscal Year drop-down shows it)
  const [to, setTo] = useState(fy.end_date || today);
  const [split, setSplit] = useState(false);
  const [showCogs, setShowCogs] = useState(false);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const area = useRef(null);

  useEffect(() => { setData(null); setErr(''); api.get('/reports/monthly-profit', { date_from: from, date_to: to }).then(setData).catch((e) => setErr(e?.message || 'Could not load the report.')); }, [from, to]);

  const groups = split ? (data?.expense_groups || []) : [];
  const m = (v) => (v ? fmtMoney(v) : '—');
  const best = data ? Math.max(...data.months.map((x) => x.net_profit), 0) : 0;
  // Profit shown in green, a loss in red with "(Loss)"
  const PL = ({ v }) => (v < 0
    ? <span className="neg"><b>{fmtMoney(-v)}</b> <small>(Loss)</small></span>
    : <span className="pos"><b>{fmtMoney(v)}</b></span>);

  return (
    <>
      <div className="acc-reportcard">
      <header className="acc-formhead no-print">
        <span className="acc-head-ic">📅</span>
        <span className="acc-head-txt"><h1>Monthly Expenses &amp; Profit</h1><small>Income, expenses and profit for each Nepali month · stock at weighted average cost</small></span>
      </header>
      <PeriodBar from={from} to={to} fy={fy} onChange={(f, t) => { setFrom(f); setTo(t); }}>
        <label className="check"><input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} /> Split expenses by group</label>
        <label className="check"><input type="checkbox" checked={showCogs} onChange={(e) => setShowCogs(e.target.checked)} /> Show cost of goods</label>
        <span className="spacer" />
        <ReportButtons areaRef={area} title="Monthly Expenses & Profit" from={from} to={to} />
      </PeriodBar>
      {err && <div className="notice">⚠ {err}</div>}
      {!data && !err && <div className="muted" style={{ padding: 12 }}>Loading…</div>}
      {data && (
        <section className="card print-area" ref={area}>
          <ReportHeader title="Monthly Expenses & Profit" from={from} to={to} />
          <div className="pl-kpis mp-kpis no-print">
            <div><span>Purchase</span><b>Rs. {fmtMoney(data.totals.purchases)}</b></div>
            <div><span>Sales</span><b>Rs. {fmtMoney(data.totals.sales)}</b></div>
            <div><span>Income</span><b>Rs. {fmtMoney(data.totals.other_income)}</b></div>
            <div><span>Expenses</span><b>Rs. {fmtMoney(data.totals.expenses)}</b></div>
            <div className={data.totals.damage ? 'loss' : ''}><span>Damage / Loss</span><b>Rs. {fmtMoney(data.totals.damage)}</b></div>
            <div className={data.totals.net_profit < 0 ? 'loss' : 'profit'}><span>{data.totals.net_profit < 0 ? 'Net Loss' : 'Net Profit'}</span><b>Rs. {fmtMoney(Math.abs(data.totals.net_profit))}</b></div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="grid tb dg-soft mp-table">
              <thead><tr>
                <th className="sn">SN</th><th>Month</th>
                <th className="num">Purchase</th><th className="num">Sales</th>
                {showCogs && <><th className="num">Cost of Goods</th><th className="num">Gross Profit</th></>}
                <th className="num">Income</th>
                {groups.map((x) => <th key={x.code} className="num mp-exp" title={x.name}>{x.name}</th>)}
                <th className="num">Expenses</th><th className="num">Damage / Loss</th><th className="num">Profit / Loss</th>
              </tr></thead>
              <tbody>
                {data.months.map((r, i) => (
                  <tr key={r.key}>
                    <td className="sn">{i + 1}</td>
                    <td><b>{r.label}</b></td>
                    <td className="num">{m(r.purchases)}</td>
                    <td className="num">{m(r.sales)}</td>
                    {showCogs && <><td className="num">{m(r.cogs)}</td>
                      <td className={`num ${r.gross_profit < 0 ? 'neg' : ''}`}>{m(r.gross_profit)}</td></>}
                    <td className="num">{m(r.other_income)}</td>
                    {groups.map((x) => <td key={x.code} className="num mp-exp">{m(r.expense_by_group[x.code])}</td>)}
                    <td className="num">{m(r.expenses)}</td>
                    <td className={`num ${r.damage ? 'neg' : ''}`}>{m(r.damage)}</td>
                    <td className="num">
                      <PL v={r.net_profit} />{r.net_profit > 0 && r.net_profit === best && <span title="Best month"> ★</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr>
                <th colSpan={2}>Total</th>
                <th className="num">{fmtMoney(data.totals.purchases)}</th><th className="num">{fmtMoney(data.totals.sales)}</th>
                {showCogs && <><th className="num">{fmtMoney(data.totals.cogs)}</th><th className="num">{fmtMoney(data.totals.gross_profit)}</th></>}
                <th className="num">{fmtMoney(data.totals.other_income)}</th>
                {groups.map((x) => <th key={x.code} className="num">{fmtMoney(data.totals.expense_by_group[x.code])}</th>)}
                <th className="num">{fmtMoney(data.totals.expenses)}</th><th className="num">{fmtMoney(data.totals.damage)}</th>
                <th className="num"><PL v={data.totals.net_profit} /></th>
              </tr></tfoot>
            </table>
          </div>
          <p className="muted small" style={{ margin: '10px 4px 0' }}>
            Profit / Loss = Sales − cost of goods (opening stock + purchase − closing stock) + Income − Expenses − Damage / Loss.
            Damage / Loss = expense ledgers named loss, damage, write-off, wastage, shortage, breakage or expired. The monthly figures add up to the Profit &amp; Loss Account for the same period.
          </p>
        </section>
      )}
      </div>
    </>
  );
}
