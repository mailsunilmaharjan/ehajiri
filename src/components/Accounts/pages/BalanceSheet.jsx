import { useEffect, useRef, useState } from 'react';
import { Link } from '../lib/router';
import { useApp } from '../context';
import { ReportButtons, ReportHeader } from '../components/Report';
import { PeriodBar } from '../components/inputs';
import { api, fmtMoney } from '../lib/api';
import { fmtDate } from '../lib/dates';

/** Balance Sheet — Statement of Financial Position in the Nepal (NFRS / Companies Act) format:
 *  Assets (non-current, current) = Equity + Liabilities (non-current, current), with the previous year-end beside it. */
export default function BalanceSheet() {
  const { fy, today } = useApp();
  const [from, setFrom] = useState(fy.start_date);
  const [to, setTo] = useState(fy.end_date || today);
  const [detail, setDetail] = useState(false);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const area = useRef(null);

  useEffect(() => {
    setData(null); setErr('');
    api.get('/reports/balance-sheet', { date_from: from, date_to: to }).then(setData).catch((e) => setErr(e?.message || 'Could not load the report.'));
  }, [from, to]);

  const cols = data?.columns || ['cur'];
  const amt = (v) => (v < 0 ? `(${fmtMoney(-v)})` : fmtMoney(v));
  const link = (id) => `/ledger?account=${id}&from=${from}&to=${to}`;
  const Cells = ({ a, cls = 'num' }) => cols.map((k) => <td key={k} className={cls}>{a?.[k] ? amt(a[k]) : '–'}</td>);
  const Head = ({ label }) => <tr className="pl-head"><td colSpan={1 + cols.length}>{label}</td></tr>;

  const Section = ({ s, totalLabel }) => [
    <tr key={`s${s.code}`} className="sub"><td className="indent1"><b>{s.name}</b></td>{cols.map((k) => <td key={k} />)}</tr>,
    ...s.lines.flatMap((ln) => [
      <tr key={`l${s.code}-${ln.code}`} className={ln.profit ? 'bs-profit' : ''}><td className="indent2">{ln.name}</td><Cells a={ln.amt} /></tr>,
      ...(detail ? ln.ledgers.map((l) => (
        <tr key={`g${l.id}`} className="bs-ledger"><td className="indent3"><Link to={link(l.id)}>{l.name}</Link></td>
          {cols.map((k) => <td key={k} className="num muted">{l.amt[k] ? amt(l.amt[k]) : ''}</td>)}</tr>
      )) : []),
    ]),
    s.lines.length === 0 && <tr key={`e${s.code}`}><td className="indent2 muted">—</td>{cols.map((k) => <td key={k} />)}</tr>,
    <tr key={`t${s.code}`} className="pl-sum"><td className="indent1">{totalLabel || `Total ${s.name}`}</td><Cells a={s.total} /></tr>,
  ];

  const diff = data && cols.some((k) => data.difference[k]);

  return (
    <div className="acc-reportcard">
      <header className="acc-formhead no-print">
        <span className="acc-head-ic">⚖️</span>
        <span className="acc-head-txt"><h1>Balance Sheet</h1>
          <small>Statement of Financial Position · NFRS / Companies Act format · stock at weighted average cost</small></span>
      </header>
      <PeriodBar from={from} to={to} fy={fy} onChange={(f, t) => { setFrom(f); setTo(t); }}>
        <label className="check"><input type="checkbox" checked={detail} onChange={(e) => setDetail(e.target.checked)} /> Show ledgers</label>
        <span className="spacer" />
        <ReportButtons areaRef={area} title="Balance Sheet" subtitle={`as at ${fmtDate(to)}`} />
      </PeriodBar>
      {err && <div className="notice">⚠ {err}</div>}
      {!data && !err && <div className="muted" style={{ padding: 12 }}>Loading…</div>}
      {data && (
        <section className="card print-area pl-report" ref={area}>
          <ReportHeader title="Statement of Financial Position (Balance Sheet)" subtitle={`as at ${fmtDate(to)}`} />
          <table className="grid tb dg-soft pl-table bs-table">
            <thead><tr>
              <th>Particulars</th>
              <th className="num" style={{ width: 170 }}>As at {fmtDate(data.as_at)}<br /><small>Current year (Rs.)</small></th>
              {cols.includes('prev') && <th className="num" style={{ width: 170 }}>As at {fmtDate(data.prev_as_at)}<br /><small>Previous year (Rs.)</small></th>}
            </tr></thead>
            <tbody>
              <Head label="ASSETS" />
              {data.assets.map((s) => <Section key={s.code} s={s} />)}
              <tr className="pl-total"><td>TOTAL ASSETS</td><Cells a={data.total_assets} /></tr>

              <Head label="EQUITY AND LIABILITIES" />
              {data.equity.map((s) => <Section key={s.code} s={s} totalLabel="Total Equity" />)}
              {data.liabilities.length > 0 && <tr className="sub"><td className="muted small">Liabilities</td>{cols.map((k) => <td key={k} />)}</tr>}
              {data.liabilities.map((s) => <Section key={s.code} s={s} />)}
              {diff && <tr className="bs-diff"><td>Difference in opening balances</td><Cells a={data.difference} /></tr>}
            </tbody>
            <tfoot>
              <tr className="pl-profit"><th>TOTAL EQUITY AND LIABILITIES</th>
                {cols.map((k) => <th key={k} className="num">{amt(money2(data.total_equity_liabilities[k] + (data.difference[k] || 0)))}</th>)}</tr>
            </tfoot>
          </table>
          <p className="muted small" style={{ margin: '10px 4px 0' }}>
            Figures in brackets are negative. Profit for the year is the net profit from the Profit &amp; Loss Account for the selected period;
            inventories are closing stock at weighted average cost.{diff ? ' A difference means the ledger opening balances do not agree — check the Trial Balance.' : ''}
          </p>
        </section>
      )}
    </div>
  );
}

const money2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
