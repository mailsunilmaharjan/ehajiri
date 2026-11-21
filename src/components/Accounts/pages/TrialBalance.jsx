import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from '../lib/router';
import { RemarksRow, useGrid } from '../components/DataGrid';
import { useApp } from '../context';
import { ReportButtons, ReportHeader } from '../components/Report';
import { PeriodBar } from '../components/inputs';
import { api, fmtMoney } from '../lib/api';
import { fmtDate } from '../lib/dates';

const dr = (v) => (v > 0 ? fmtMoney(v) : '');
const cr = (v) => (v < 0 ? fmtMoney(-v) : '');

export default function TrialBalance() {
  const { fy, today, company } = useApp();
  const [from, setFrom] = useState(fy.start_date);
  const [to, setTo] = useState(today);
  const [data, setData] = useState(null);
  const [grouped, setGrouped] = useState(true);
  const area = useRef(null);

  useEffect(() => { api.get('/reports/trial-balance', { date_from: from, date_to: to }).then(setData); }, [from, to]);

  const groups = useMemo(() => {
    const m = new Map();
    (data?.rows || []).forEach((r) => {
      if (!m.has(r.group_code)) m.set(r.group_code, { name: r.group_name, rows: [], opening: 0, dr: 0, cr: 0, closing: 0 });
      const g = m.get(r.group_code);
      g.rows.push(r); g.opening += r.opening; g.dr += r.dr; g.cr += r.cr; g.closing += r.closing;
    });
    return [...m.values()];
  }, [data]);

  const t = data?.totals;
  const link = (r) => `/ledger?account=${r.id}&from=${from}&to=${to}`;
  const nav = useNavigate();
  const tbRows = useMemo(() => groups.flatMap((x) => x.rows), [groups]);   // same order as on screen
  const g = useGrid({ rows: tbRows, onOpen: (r) => nav(link(r)) });
  const sn = new Map(tbRows.map((r, i) => [r.id, i + 1]));
  const COLS = 9;
  return (
    <>
      <header className="page-head"><h1>Trial Balance</h1></header>
      <PeriodBar from={from} to={to} fy={fy} onChange={(f, tt) => { setFrom(f); setTo(tt); }}>
        <label className="check"><input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} /> Group subtotals</label>
        <span className="spacer" />
        <ReportButtons areaRef={area} title="Trial Balance" from={from} to={to} />
      </PeriodBar>
      {data && (
        <section className="card print-area" ref={area}>
          <ReportHeader title="Trial Balance" from={from} to={to} />
          {Math.abs(t.difference) > 0.005 && <div className="notice">Out of balance by {fmtMoney(Math.abs(t.difference))} — check ledger opening balances.</div>}
          <table ref={g.gridRef} className="grid tb dg-soft">
            <thead>
              <tr><th rowSpan={2} className="sel">{g.tickTh.props.children}</th><th rowSpan={2} className="sn">SN</th><th rowSpan={2}>Particulars</th><th colSpan={2} className="c">Opening</th><th colSpan={2} className="c">During period</th><th colSpan={2} className="c">Closing</th></tr>
              <tr><th className="num">Dr</th><th className="num">Cr</th><th className="num">Dr</th><th className="num">Cr</th><th className="num">Dr</th><th className="num">Cr</th></tr>
            </thead>
            <tbody>
              {groups.map((grp) => [
                grouped && (
                  <tr key={grp.name} className="sub">
                    <td className="sel" /><td className="sn" /><td>{grp.name}</td><td className="num">{dr(grp.opening)}</td><td className="num">{cr(grp.opening)}</td>
                    <td className="num">{fmtMoney(grp.dr)}</td><td className="num">{fmtMoney(grp.cr)}</td>
                    <td className="num">{dr(grp.closing)}</td><td className="num">{cr(grp.closing)}</td>
                  </tr>
                ),
                ...grp.rows.map((r) => (
                  <tr key={r.id} {...g.rowProps(r)}>
                    {g.tickTd(r)}<td className="sn">{sn.get(r.id)}</td>
                    <td className={grouped ? 'indent2' : ''}><Link to={link(r)}>{r.name}</Link></td>
                    <td className="num">{dr(r.opening)}</td><td className="num">{cr(r.opening)}</td>
                    <td className="num">{r.dr ? fmtMoney(r.dr) : ''}</td><td className="num">{r.cr ? fmtMoney(r.cr) : ''}</td>
                    <td className="num">{dr(r.closing)}</td><td className="num">{cr(r.closing)}</td>
                  </tr>
                )),
              ])}
              {g.blankRows(COLS)}
              <RemarksRow g={g} cols={COLS} empty="Click a ledger to see its details. Double-click or Enter opens its statement.">
                {g.curRow && <>
                  <div><b>{g.curRow.name}</b> <span className="muted">({g.curRow.code})</span> · {g.curRow.group_name}</div>
                  <div className="rm-pay"><b>Closing balance:</b> Rs.{fmtMoney(Math.abs(g.curRow.closing))} {g.curRow.closing > 0 ? 'Dr' : g.curRow.closing < 0 ? 'Cr' : ''}
                    {' · '}<b>During period:</b> Dr {fmtMoney(g.curRow.dr)} · Cr {fmtMoney(g.curRow.cr)}</div>
                </>}
              </RemarksRow>
            </tbody>
            <tfoot>
              <tr><th colSpan={3}>Total</th>
                <th className="num">{fmtMoney(t.opening_dr)}</th><th className="num">{fmtMoney(t.opening_cr)}</th>
                <th className="num">{fmtMoney(t.dr)}</th><th className="num">{fmtMoney(t.cr)}</th>
                <th className="num">{fmtMoney(t.closing_dr)}</th><th className="num">{fmtMoney(t.closing_cr)}</th></tr>
            </tfoot>
          </table>
        </section>
      )}
    </>
  );
}
