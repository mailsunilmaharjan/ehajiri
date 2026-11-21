import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from '../lib/router';
import { RemarksRow, useGrid } from '../components/DataGrid';
import { useApp } from '../context';
import { ReportButtons, ReportHeader } from '../components/Report';
import { PeriodBar } from '../components/inputs';
import { api, fmtMoney } from '../lib/api';
import { fmtDate } from '../lib/dates';

const q = (n) => (n ? Number(n).toLocaleString('en-IN', { maximumFractionDigits: 3 }) : '');

export default function StockSummary() {
  const { fy, today, company } = useApp();
  const [from, setFrom] = useState(fy.start_date);
  const [to, setTo] = useState(today);
  const [cats, setCats] = useState([]);
  const [cat, setCat] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [srch, setSrch] = useState('');
  const [data, setData] = useState(null);
  const area = useRef(null);

  useEffect(() => { api.get('/categories').then(setCats); }, []);
  useEffect(() => {
    api.get('/reports/stock-summary', { date_from: from, date_to: to, ...(cat ? { category_id: cat } : {}) }).then(setData);
  }, [from, to, cat]);

  const rows = useMemo(() => {
    const s = srch.trim().toLowerCase();
    return (data?.rows || []).filter((r) => (!lowOnly || r.low) && (!s || `${r.name} ${r.category || ''} ${r.code || ''}`.toLowerCase().includes(s)));
  }, [data, lowOnly, srch]);
  const mains = cats.filter((c) => !c.parent_id);
  const nav = useNavigate();
  const g = useGrid({ rows, onOpen: (r) => nav(`/stock-ledger?item=${r.id}&from=${from}&to=${to}`) });
  const COLS = 13;
  return (
    <>
      <header className="page-head"><h1>Stock Summary</h1><span className="muted">weighted average cost</span></header>
      <PeriodBar from={from} to={to} fy={fy} onChange={(f, t) => { setFrom(f); setTo(t); }}>
        <select value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">All categories</option>
          {mains.map((c) => [<option key={c.id} value={c.id}>{c.name}</option>,
            ...cats.filter((s) => s.parent_id === c.id).map((s) => <option key={s.id} value={s.id}>&nbsp;&nbsp;› {s.name}</option>)])}
        </select>
        <label className="check"><input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} /> Re-order needed</label>
        <span className="spacer" />
        <span className="tb-search"><input data-find title="Ctrl+F" placeholder="Search product or category…" value={srch} onChange={(e) => setSrch(e.target.value)} />{srch && <button type="button" className="link" onClick={() => setSrch('')}>✕</button>}</span>
        <ReportButtons areaRef={area} title="Stock Summary" from={from} to={to} />
      </PeriodBar>
      {data && (
        <section className="card print-area" ref={area}>
          <ReportHeader title="Stock Summary" from={from} to={to} />
          <table ref={g.gridRef} className="grid tb dg-soft">
            <thead>
              <tr><th rowSpan={2} className="sel">{g.tickTh.props.children}</th><th rowSpan={2} className="sn">SN</th><th rowSpan={2}>Product</th><th rowSpan={2}>Category</th><th colSpan={2} className="c">Opening</th><th colSpan={2} className="c">Inward</th>
                <th colSpan={2} className="c">Outward</th><th colSpan={3} className="c">Closing</th></tr>
              <tr><th className="num">Qty</th><th className="num">Value</th><th className="num">Qty</th><th className="num">Value</th>
                <th className="num">Qty</th><th className="num">Value</th><th className="num">Qty</th><th className="num">Avg rate</th><th className="num">Value</th></tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={COLS} className="muted">No stock.</td></tr>}
              {rows.map((r, idx) => (
                <tr key={r.id} {...g.rowProps(r)}>
                  {g.tickTd(r)}
                  <td className="sn">{idx + 1}</td>
                  <td><Link to={`/stock-ledger?item=${r.id}&from=${from}&to=${to}`}>{r.name}</Link>{r.low && <span className="tag st-cancelled">re-order</span>}</td>
                  <td className="small">{r.category}</td>
                  <td className="num">{q(r.opening_qty)}</td><td className="num">{r.opening_value ? fmtMoney(r.opening_value) : ''}</td>
                  <td className="num">{q(r.in_qty)}</td><td className="num">{r.in_value ? fmtMoney(r.in_value) : ''}</td>
                  <td className="num">{q(r.out_qty)}</td><td className="num">{r.out_value ? fmtMoney(r.out_value) : ''}</td>
                  <td className="num"><b>{q(r.closing_qty) || 0}</b> <small className="muted">{r.unit}</small></td>
                  <td className="num">{fmtMoney(r.avg_rate)}</td><td className="num">{fmtMoney(r.closing_value)}</td>
                </tr>
              ))}
              {g.blankRows(COLS)}
              <RemarksRow g={g} cols={COLS} empty="Click a product to see its details. Double-click or Enter opens its stock ledger.">
                {g.curRow && <>
                  <div><b>{g.curRow.name}</b> · {g.curRow.category || '—'}{g.curRow.low && <span className="tag st-cancelled">re-order</span>}</div>
                  <div className="rm-pay"><b>Closing:</b> {q(g.curRow.closing_qty) || 0} {g.curRow.unit} · avg rate Rs.{fmtMoney(g.curRow.avg_rate)} · value Rs.{fmtMoney(g.curRow.closing_value)}</div>
                </>}
              </RemarksRow>
            </tbody>
            <tfoot><tr><th colSpan={4}>Total</th><th /><th className="num">{fmtMoney(data.totals.opening_value)}</th>
              <th /><th className="num">{fmtMoney(data.totals.in_value)}</th><th /><th className="num">{fmtMoney(data.totals.out_value)}</th>
              <th /><th /><th className="num">{fmtMoney(data.totals.closing_value)}</th></tr></tfoot>
          </table>
        </section>
      )}
    </>
  );
}
