import { useEffect, useMemo, useRef, useState } from 'react';
import { RemarksRow, useGrid } from '../components/DataGrid';
import { useApp } from '../context';
import { ReportButtons, ReportHeader } from '../components/Report';
import { PeriodBar } from '../components/inputs';
import { api, fmtMoney } from '../lib/api';
import { fmtDate } from '../lib/dates';

/** Bill-wise Profit & Loss: every Sales Invoice (and Sales Return) with its cost of goods and profit. */
export default function BillProfit() {
  const { fy, today } = useApp();
  const [from, setFrom] = useState(fy.start_date);
  // current fiscal year selected by default (full year, so the Fiscal Year drop-down shows it)
  const [to, setTo] = useState(fy.end_date || today);
  const [show, setShow] = useState('all');        // all | profit | loss
  const [search, setSearch] = useState('');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const area = useRef(null);

  useEffect(() => { setData(null); setErr(''); api.get('/reports/bill-profit', { date_from: from, date_to: to }).then(setData).catch((e) => setErr(e?.message || 'Could not load the report.')); }, [from, to]);

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (data?.rows || []).filter((r) => (show === 'all' || (show === 'loss' ? r.profit < 0 : r.profit >= 0))
      && (!s || `${r.doc_no} ${r.party}`.toLowerCase().includes(s)));
  }, [data, show, search]);
  const tot = useMemo(() => {
    const t = { sales: 0, cost: 0, profit: 0 };
    rows.forEach((r) => { t.sales += r.sales; t.cost += r.cost; t.profit += r.profit; });
    t.margin = t.sales ? (t.profit / t.sales) * 100 : 0;
    return t;
  }, [rows]);
  const g = useGrid({ rows });
  const COLS = 11;
  const pct = (v) => `${(Math.round(v * 100) / 100).toFixed(2)}%`;

  return (
    <>
      <div className="acc-reportcard">
      <header className="acc-formhead no-print">
        <span className="acc-head-ic">🧾</span>
        <span className="acc-head-txt"><h1>Bill-wise Profit &amp; Loss</h1><small>Profit on every sales bill · sales value excl. VAT · cost at weighted average</small></span>
      </header>
      <PeriodBar from={from} to={to} fy={fy} onChange={(f, t) => { setFrom(f); setTo(t); }}>
        <select value={show} onChange={(e) => setShow(e.target.value)}>
          <option value="all">All bills</option><option value="profit">Profit only</option><option value="loss">Loss only</option>
        </select>
        <input placeholder="Search bill no. / customer…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 220 }} />
        <span className="spacer" />
        <ReportButtons areaRef={area} title="Bill-wise Profit & Loss" from={from} to={to} />
      </PeriodBar>
      {err && <div className="notice">⚠ {err}</div>}
      {!data && !err && <div className="muted" style={{ padding: 12 }}>Loading…</div>}
      {data && (
        <section className="card print-area" ref={area}>
          <ReportHeader title="Bill-wise Profit & Loss" from={from} to={to} />
          <table ref={g.gridRef} className="grid tb dg-soft">
            <thead><tr>
              <th className="sel">{g.tickTh.props.children}</th><th className="sn">SN</th><th>Date</th><th>Bill No.</th><th>Customer</th>
              <th className="num">Items</th><th className="num">Sales (excl. VAT)</th><th className="num">Cost of Goods</th><th className="num">Profit</th><th className="num">Margin</th><th />
            </tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={COLS} className="muted">No sales bills in this period.</td></tr>}
              {rows.map((r, i) => (
                <tr key={r.id} {...g.rowProps(r)}>
                  {g.tickTd(r)}<td className="sn">{i + 1}</td>
                  <td>{fmtDate(r.doc_date)}</td>
                  <td className="mono">{r.doc_no}{r.doc_type === 'SR' && <span className="tag">return</span>}</td>
                  <td>{r.party}</td>
                  <td className="num">{r.items}</td>
                  <td className="num">{fmtMoney(r.sales)}</td>
                  <td className="num">{fmtMoney(r.cost)}</td>
                  <td className={`num ${r.profit < 0 ? 'neg' : 'pos'}`}><b>{fmtMoney(r.profit)}</b></td>
                  <td className={`num ${r.profit < 0 ? 'neg' : ''}`}>{pct(r.margin)}</td>
                  <td />
                </tr>
              ))}
              {g.blankRows(COLS)}
              <RemarksRow g={g} cols={COLS} empty="Click a bill to see how its profit is worked out.">
                {g.curRow && <>
                  <div><b>{g.curRow.doc_no}</b> · {g.curRow.party} · {fmtDate(g.curRow.doc_date)}</div>
                  <div className="rm-pay">Sales Rs.{fmtMoney(g.curRow.sales)} − Cost Rs.{fmtMoney(g.curRow.cost)} = <b>{g.curRow.profit < 0 ? 'Loss' : 'Profit'} Rs.{fmtMoney(Math.abs(g.curRow.profit))}</b> ({pct(g.curRow.margin)})
                    {g.curRow.cost === 0 && g.curRow.sales > 0 && <span className="muted"> · no stock cost (service items)</span>}</div>
                </>}
              </RemarksRow>
            </tbody>
            <tfoot><tr>
              <th colSpan={6}>Total ({rows.length} bills)</th>
              <th className="num">{fmtMoney(tot.sales)}</th><th className="num">{fmtMoney(tot.cost)}</th>
              <th className="num">{fmtMoney(tot.profit)}</th><th className="num">{pct(tot.margin)}</th><th />
            </tr></tfoot>
          </table>
        </section>
      )}
      </div>
    </>
  );
}
