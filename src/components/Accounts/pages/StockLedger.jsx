import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from '../lib/router';
import { useApp } from '../context';
import { ReportButtons, ReportHeader } from '../components/Report';
import { AccountSelect, PeriodBar } from '../components/inputs';
import DocView from '../components/DocView';
import { RemarksRow, useGrid } from '../components/DataGrid';
import { api, fmtMoney } from '../lib/api';
import { fmtAd, fmtBs } from '../lib/dates';

const q = (n) => (n ? Number(n).toLocaleString('en-IN', { maximumFractionDigits: 3 }) : '');

export default function StockLedger() {
  const { fy, today, company } = useApp();
  const [sp, setSp] = useSearchParams();
  const itemId = Number(sp.get('item')) || null;
  const [from, setFrom] = useState(sp.get('from') || fy.start_date);
  const [to, setTo] = useState(sp.get('to') || today);
  const [items, setItems] = useState([]);
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(null);
  const area = useRef(null);

  useEffect(() => { api.get('/items').then(setItems); }, []);
  useEffect(() => {
    if (!itemId) { setData(null); return; }
    api.get('/reports/stock-ledger', { item_id: itemId, date_from: from, date_to: to }).then(setData);
  }, [itemId, from, to]);
  const opts = useMemo(() => items.map((i) => ({ ...i, group_name: `${i.code} · ${i.stock} ${i.unit}` })), [items]);
  const srows = useMemo(() => (data?.rows || []).map((r, i) => ({ ...r, _k: i })), [data]);
  const openDoc = async (r) => { if (r.doc_id) setOpen(await api.get(`/docs/${r.doc_id}`)); };
  const g = useGrid({ rows: srows, getId: (r) => r._k, onOpen: openDoc });
  const COLS = 12;

  return (
    <>
      <header className="page-head"><h1>Stock Ledger</h1></header>
      <PeriodBar from={from} to={to} fy={fy} onChange={(f, t) => { setFrom(f); setTo(t); }}>
        <div className="ledger-search" data-find title="Ctrl+F"><AccountSelect autoFocus accounts={opts} value={itemId} onChange={(id) => setSp({ item: id })} placeholder="Search / choose a product…" /></div>
        <span className="spacer" />
        {data && <ReportButtons areaRef={area} title="Stock Ledger" subtitle={data.item.name} from={from} to={to} />}
      </PeriodBar>
      {!itemId && <p className="muted">Choose a product to see every movement in and out.</p>}
      {data && (
        <section className="card print-area" ref={area}>
          <ReportHeader title="Stock Ledger" subtitle={`${data.item.name} (${data.item.unit})`} from={from} to={to} />
          <table ref={g.gridRef} className="grid dg-soft">
            <thead><tr>{g.tickTh}<th className="sn">SN</th><th className="nowrap">Miti | Date</th><th>Voucher No.</th><th>Type</th><th>Particulars</th><th className="num">In</th><th className="num">Out</th>
              <th className="num">Rate</th><th className="num">Balance qty</th><th className="num">Avg rate</th><th className="num">Balance value</th></tr></thead>
            <tbody>
              <tr className="sub"><td className="sel" /><td className="sn" /><td colSpan={7}>Opening</td><td className="num">{q(data.opening.qty) || 0}</td><td /><td className="num">{fmtMoney(data.opening.value)}</td></tr>
              {srows.map((r, i) => (
                <tr key={r._k} {...g.rowProps(r)}>
                  {g.tickTd(r)}<td className="sn">{i + 1}</td>
                  <td className="nowrap">{fmtBs(r.date)}<span className="dl-sep">|</span>{fmtAd(r.date)}</td>
                  <td>{r.doc_id ? <a onClick={() => openDoc(r)}>{r.doc_no}</a> : '—'}</td>
                  <td className="small">{r.kind}</td><td>{r.particulars}</td>
                  <td className="num">{q(r.qty_in)}</td><td className="num">{q(r.qty_out)}</td>
                  <td className="num">{fmtMoney(r.rate)}</td><td className="num">{q(r.bal_qty) || 0}</td>
                  <td className="num">{fmtMoney(r.avg_rate)}</td><td className="num">{fmtMoney(r.bal_value)}</td>
                </tr>
              ))}
              {g.blankRows(COLS)}
              <RemarksRow g={g} cols={COLS} empty="Click a row to see its details. Double-click or Enter opens the bill.">
                {g.curRow && <>
                  <div><b>{g.curRow.doc_no || 'Movement'}</b> · {g.curRow.kind} · {g.curRow.particulars || '—'}</div>
                  <div className="rm-pay"><b>Qty:</b> {g.curRow.qty_in ? `in ${q(g.curRow.qty_in)}` : `out ${q(g.curRow.qty_out)}`} {data.item.unit} @ Rs.{fmtMoney(g.curRow.rate)}
                    {' · '}<b>Balance:</b> {q(g.curRow.bal_qty) || 0} {data.item.unit} · Rs.{fmtMoney(g.curRow.bal_value)}</div>
                </>}
              </RemarksRow>
            </tbody>
            <tfoot><tr><th colSpan={6}>Total / Closing</th><th className="num">{q(data.total_in)}</th><th className="num">{q(data.total_out)}</th>
              <th /><th className="num">{q(data.closing.qty) || 0}</th><th /><th className="num">{fmtMoney(data.closing.value)}</th></tr></tfoot>
          </table>
        </section>
      )}
      {open && <DocView doc={open} onClose={() => setOpen(null)} />}
    </>
  );
}
