import { useEffect, useState } from 'react';
import DocView from '../components/DocView';
import { RemarksRow, useGrid } from '../components/DataGrid';
import { api } from '../lib/api';
import { fmtDate } from '../lib/dates';
import { DOCS } from '../lib/docs';

const STATUS = { in_stock: ['In stock', 'st-posted'], sold: ['Sold', 'st-open'], returned: ['Returned to supplier', 'st-cancelled'], cancelled: ['Cancelled', 'st-cancelled'] };

/** Find any serial number: where it came from, who bought it, warranty status. */
export default function SerialSearch() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(null);

  const openLast = async (r) => { const h = r.history[r.history.length - 1]; if (h) setOpen(await api.get(`/docs/${h.doc_id}`)); };
  const g = useGrid({ rows, onOpen: openLast });
  const COLS = 7;

  useEffect(() => {
    if (q.trim().length < 2) { setRows([]); return undefined; }
    const t = setTimeout(() => api.get('/serials/lookup', { q }).then(setRows), 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <>
      <header className="page-head"><h1>Serial No. Search</h1><span className="muted">Warranty check · history of every serial / IMEI</span></header>
      <div className="toolbar"><input autoFocus style={{ minWidth: 320 }} placeholder="Type or scan a serial number…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <section className="card">
        <table ref={g.gridRef} className="grid dg-soft">
          <thead><tr>{g.tickTh}<th className="sn">SN</th><th>Serial No.</th><th>Product</th><th>Status</th><th>Warranty till</th><th>History</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={COLS} className="muted">{q.length < 2 ? 'Type at least 2 characters.' : 'No match.'}</td></tr>}
            {rows.map((r, i) => (
              <tr key={r.id} {...g.rowProps(r)}>
                {g.tickTd(r)}
                <td className="sn">{i + 1}</td>
                <td className="mono"><b>{r.serial_no}</b></td>
                <td>{r.item} <small className="muted">{r.code}</small></td>
                <td><span className={`tag ${STATUS[r.status]?.[1]}`}>{STATUS[r.status]?.[0] || r.status}</span></td>
                <td>{r.warranty_until ? <>{fmtDate(r.warranty_until)} <span className={`tag ${r.warranty_status === 'in warranty' ? 'st-posted' : 'st-cancelled'}`}>{r.warranty_status}</span></> : '—'}</td>
                <td className="small">
                  {r.history.length === 0 && 'Opening stock'}
                  {r.history.map((h) => (
                    <div key={h.doc_id} className={h.status === 'cancelled' ? 'cancelled-txt' : ''}>
                      {fmtDate(h.doc_date)} · <a onClick={async () => setOpen(await api.get(`/docs/${h.doc_id}`))}>{h.doc_no}</a> · {DOCS[h.doc_type].name} · {h.party_name}
                    </div>
                  ))}
                </td>
              </tr>
            ))}
            {g.blankRows(COLS)}
            <RemarksRow g={g} cols={COLS} empty="Click a serial number to see its details. Enter opens its latest bill.">
              {g.curRow && <>
                <div><b>{g.curRow.serial_no}</b> · {g.curRow.item} · {STATUS[g.curRow.status]?.[0] || g.curRow.status}</div>
                <div className="rm-pay"><b>Warranty:</b> {g.curRow.warranty_until ? `${fmtDate(g.curRow.warranty_until)} (${g.curRow.warranty_status})` : '—'}
                  {' · '}<b>Bills:</b> {g.curRow.history.map((h) => h.doc_no).join(', ') || 'opening stock'}</div>
              </>}
            </RemarksRow>
          </tbody>
        </table>
      </section>
      {open && <DocView doc={open} onClose={() => setOpen(null)} />}
    </>
  );
}
