import { useEffect, useRef, useState } from 'react';
import { useGrid } from '../components/DataGrid';
import { Link, useNavigate, useParams, useSearchParams } from '../lib/router';
import { useApp } from '../context';
import { D, PeriodBar } from '../components/inputs';
import DocView from '../components/DocView';
import ContextMenu from '../components/ContextMenu';
import TransportDialog from '../components/TransportDialog';
import { DeleteDialog } from '../components/Guards';
import { api, fmtMoney, waLink } from '../lib/api';
import { fmtAd, fmtBs, fmtDate, fmtBsShort } from '../lib/dates';
import { DOCS, payLabel, shortDocNo, statusLabel } from '../lib/docs';
import Avatar from '../../Common/Avatar.jsx';
import HoverCard from '../../Common/HoverCard.jsx';

/** Register of one document type: purchase/sales orders, bills and returns. */
export default function DocList() {
  const { type } = useParams();
  const meta = DOCS[type];
  const { fy, today, canEdit, company } = useApp();
  const [from, setFrom] = useState(fy.start_date);
  const [to, setTo] = useState(today);
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(null);
  const [del, setDel] = useState(null);
  const [q, setQ] = useState('');
  const nav = useNavigate();

  const load = () => api.get('/docs', { doc_type: type, date_from: from, date_to: to, ...(status ? { status } : {}) }).then(setAll);
  const [all, setAll] = useState([]);
  // staff cards (photo + details) for the people who have a follow-up task on these documents
  const [cards, setCards] = useState({});
  useEffect(() => {
    const need = [...new Set(all.flatMap((r) => r.task_users || []))].filter((u) => !(u in cards));
    if (!need.length) return;
    api.get('/users/cards', { u: need.join(',') })
      .then((list) => setCards((c) => { const n = { ...c }; need.forEach((u) => { n[u] = null; }); list.forEach((x) => { n[x.username] = x; }); return n; }))
      .catch(() => {});
  }, [all]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const s = q.trim().toLowerCase();
    setRows(s ? all.filter((r) => `${r.party_name} ${r.party_pan || ''} ${r.doc_no} ${r.supplier_bill_no || ''} ${r.challan_no || ''} ${r.vat_bill_no || ''} ${r.qt_subject || ''} ${r.qt_attn || ''}`.toLowerCase().includes(s)) : all);
  }, [all, q]);
  useEffect(() => { setStatus(''); setOpen(null); setQ(''); }, [type]);
  useEffect(() => { load(); }, [type, from, to, status]);

  const view = async (id, print = false) => setOpen({ doc: await api.get(`/docs/${id}`), print });
  // deep link from a Task (?open=<doc id>): open that bill straight away, then drop the parameter
  const [sp, setSp] = useSearchParams();
  const fromTask = useRef(!!sp.get('fromTask'));        // opened from the Task page in its own tab: closing the bill closes that tab
  useEffect(() => {
    const o = Number(sp.get('open'));
    if (o) { view(o).catch(() => {}); setSp({}, { replace: true }); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const isQuote = !!meta.quote;
  const live = rows.filter((r) => r.status !== 'cancelled');
  const total = (list, k) => list.reduce((s, r) => s + r[k], 0);
  const byUser = true;                   // every list shows "Updated By"; a status other than posted shows as a tag by the No.
  const transportOk = ['PB', 'SI', 'PR', 'SR'].includes(type);
  const [trans, setTrans] = useState(null);
  const showMobile = !isQuote;           // Mobile column (WhatsApp no.) on orders, invoices and returns
  const footSpan = 7 + (type === 'PB' ? 1 : 0) + (type === 'SI' ? 2 : 0) + (showMobile ? 1 : 0);
  // click the number → WhatsApp chat with this row's details
  const waRow = (r) => {
    const phone = r.party_whatsapp || r.party_mobile;
    const text = [`Namaste ${r.party_name},`, `${meta.name} No.: ${r.doc_no}`, `Miti: ${fmtBs(r.doc_date)} (${fmtAd(r.doc_date)})`,
      `Payment: ${payLabel(r.payment_mode)}`, `Taxable: Rs ${fmtMoney(r.taxable + r.exempt)} · VAT: Rs ${fmtMoney(r.vat)}`, `Total: Rs ${fmtMoney(r.total)}`,
      r.narration && `Remarks: ${r.narration}`, `— ${company?.name || ''}`].filter(Boolean).join('\n');
    window.open(waLink(phone, text), '_blank', 'noopener');
  };
  const colCount = footSpan + 3;         // + Taxable, VAT, Total   (Updated By + mobile now sit in the remarks box)
  // standard grid: current row, ticks, ↑ / ↓ / Enter, blank rows + remarks box down to the screen bottom
  const g = useGrid({ rows, onOpen: (r) => view(r.id) });
  const { gridRef, cur, setCur, curRow, sel, setSel, remH } = g;

  // "2026-11-11 08:15:00" (UTC, as saved) → "25-Kartik-2083 2:00 PM" local
  const stamp = (s) => {
    if (!s) return '';
    const d = new Date(`${s.replace(' ', 'T')}Z`);
    if (Number.isNaN(d.getTime())) return s;
    return `${fmtDate(d.toLocaleDateString('en-CA'))} ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  };
  const savedTip = (r) => [`Created: ${stamp(r.created_at)}${r.created_by_name ? ` by ${r.created_by_name}` : ''}`,
    r.updated_at ? `Modified: ${stamp(r.updated_at)} by ${r.saved_by_name}${r.edit_count > 1 ? ` (${r.edit_count} edits)` : ''}` : 'Modified: never'].join('\n');

  // row selection (checkbox column) — totals of the selected bills show in the footer
  useEffect(() => { setSel(new Set()); }, [type, all]);
  const toggleSel = g.toggle;

  /** One line of payment details for the remarks box under the grid. */
  const payDetail = (r) => {
    const bits = [payLabel(r.payment_mode)];
    if ((r.payment_mode === 'cash' || r.payment_mode === 'bank') && r.cash_account) bits.push(r.cash_account);
    if (r.payment_mode === 'bank' && r.txn_id) bits.push(`Trans. ID ${r.txn_id}`);
    if (r.payment_mode === 'cheque') {
      bits.push(`Cheque ${r.cheque_no || ''} (${r.cheque_bank || '—'}) dated ${r.cheque_date ? fmtDate(r.cheque_date) : '—'}`);
      if (r.cheque_status) bits.push(r.cheque_status === 'pending' ? 'not deposited yet' : r.cheque_status === 'cleared' ? 'deposited' : r.cheque_status);
    }
    if (r.paid_amount != null && r.total - r.paid_amount > 0.005) {
      bits.push(`received Rs.${fmtMoney(r.paid_amount)}, balance Rs.${fmtMoney(r.total - r.paid_amount)}`);
    }
    if (r.payment_mode === 'credit' && r.due_date) bits.push(`due ${fmtDate(r.due_date)}`);
    if (r.pay_voucher_no && r.pay_voucher_status !== 'cancelled') bits.push(`voucher ${r.pay_voucher_no}`);
    return bits.join(' · ');
  };

  // right-click menu: Add, View, Edit, Delete, Print, select
  const [menu, setMenu] = useState(null);
  const rowMenu = (e, r) => {
    e.preventDefault(); e.stopPropagation();
    const editable = r && r.status !== 'cancelled' && r.status !== 'billed';
    setMenu({ x: e.clientX, y: e.clientY, title: r ? shortDocNo(r.doc_no) : meta.name, items: [
      canEdit && { label: `Add ${meta.name}`, icon: '➕', onClick: () => nav(`/docs/${type}/new`) },
      r && { label: 'View', icon: '👁', onClick: () => view(r.id) },
      r && canEdit && { label: 'Edit', icon: '✏️', disabled: !editable, hint: editable ? 'Asks your password' : `Can't edit a ${r.status} ${meta.name.toLowerCase()}`,
        onClick: () => nav(`/docs/${type}/${r.id}/edit`) },
      r && canEdit && { label: 'Delete', icon: '🗑', danger: true, hint: 'Needs admin', onClick: () => setDel(r) },
      r && { label: 'Print', icon: '🖨', onClick: () => view(r.id, true) },
      r && transportOk && canEdit && { label: r.transport_name || r.transport_bill_no ? 'Via Transport (edit)…' : 'Via Transport…', icon: '🚚',
        disabled: r.status === 'cancelled', onClick: () => setTrans(r) },
      'divider',
      r && { label: sel.has(r.id) ? 'Unselect this row' : 'Select this row', icon: '☑', onClick: () => toggleSel(r.id) },
      { label: 'Select all', icon: '✅', disabled: !rows.length, onClick: () => setSel(new Set(rows.map((x) => x.id))) },
      { label: 'Clear selection', icon: '⬜', disabled: !sel.size, onClick: () => setSel(new Set()) },
    ] });
  };

  return (
    <>
      <header className="page-head">
        <h1>{meta.name}</h1>
        <span className="spacer" />
        {isQuote && <Link className="btn ghost" to="/quote-templates">🎨 Templates</Link>}
        <Link className="btn edit-only" data-new title="F1 / Alt+N" to={`/docs/${type}/new`}>+ New {meta.name.toLowerCase()} <kbd className="kbd">F1</kbd></Link>
      </header>
      <PeriodBar from={from} to={to} fy={fy} onChange={(f, t) => { setFrom(f); setTo(t); }}>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>
          {meta.role === 'order'
            ? <><option value="open">Pending</option><option value="billed">{isQuote ? 'Converted to order' : 'Billed'}</option></>
            : <option value="posted">Posted</option>}
          <option value="cancelled">Cancelled</option>
        </select>
        <span className="tb-search"><input data-find title="Ctrl+F" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder={`Search by ${meta.side === 'sales' ? 'Customer' : 'Supplier'}, PAN or bill no…`} />{q && <button type="button" className="link" onClick={() => setQ('')}>✕</button>}</span>
      </PeriodBar>
      <section className="card">
        <table ref={gridRef} className="grid doc-list dg-soft" onContextMenu={(e) => rowMenu(e, null)}>
          <thead><tr>
            <th className="sel"><input type="checkbox" title="Select all" checked={rows.length > 0 && rows.every((r) => sel.has(r.id))}
              onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} /></th>
            <th className="sn">SN</th><th className="nowrap">Miti | Date</th>
            {type === 'PB' && <th className="nowrap">Supplier Bill No.</th>}<th>No.</th>
            {type === 'SI' && <><th className="nowrap">Challan</th><th className="nowrap">VAT Bill</th></>}
            <th>{meta.side === 'sales' ? 'Customer' : 'Supplier'}</th><th>PAN</th>{showMobile && <th className="nowrap">Mobile</th>}<th>{isQuote ? 'Subject' : 'Payment'}</th>
            <th className="num">Taxable</th><th className="num">VAT</th><th className="num">Total</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={colCount} className="muted">Nothing in this period. Right-click to add.</td></tr>}
            {rows.map((r, idx) => (
              <tr key={r.id} data-id={r.id} className={`clickable ${r.status === 'cancelled' ? 'cancelled' : ''} ${sel.has(r.id) ? 'selected' : ''} ${cur === r.id ? 'current' : ''}`}
                onClick={() => setCur(r.id)} onDoubleClick={() => view(r.id)} onContextMenu={(e) => { setCur(r.id); rowMenu(e, r); }}>
                <td className="sel" onDoubleClick={(e) => e.stopPropagation()}><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggleSel(r.id)} /></td>
                <td className="sn">{idx + 1}</td>
                <td className="nowrap">{fmtBsShort(r.doc_date)}<span className="dl-sep">|</span>{fmtAd(r.doc_date)}</td>
                {type === 'PB' && <td className="nowrap">{r.supplier_bill_no}</td>}
                <td className="nowrap"><a title={r.doc_no} onClick={() => view(r.id)}>{shortDocNo(r.doc_no)}</a>
                  {r.status !== 'posted' && <span className={`tag st-${r.status}`}>{statusLabel(r.status, type)}</span>}
                  {r.transport_name || r.transport_bill_no ? <span className="tr-mark" title={`Via ${r.transport_name || 'transport'}${r.transport_bill_no ? ` · bill ${r.transport_bill_no}` : ''}`}>🚚</span> : null}</td>
                {type === 'SI' && <><td className="nowrap">{r.challan_no}</td><td className="nowrap">{r.vat_bill_no}</td></>}
                <td>{r.party_id ? <a className="dl-party" title={`Open ${r.party_name} details`} onClick={(e) => { e.stopPropagation(); nav(`/${meta.side === 'sales' ? 'customers' : 'suppliers'}?open=${r.party_id}`); }}>{r.party_name}</a> : r.party_name}
                  {(r.task_users || []).length > 0 && <span className="muted" style={{ marginLeft: 10, fontSize: 11.5 }}>Task assigned to</span>}
                  {(r.task_users || []).slice(0, 3).map((u) => {
                    const p = cards[u];
                    const nm = p?.full_name || u;
                    return (
                      <HoverCard key={u} minWidth={200} fontSize={12}
                        trigger={<span style={{ display: 'inline-flex', verticalAlign: 'middle', marginLeft: 5 }}><Avatar photo={p?.profile_photo} name={nm} size={20} preview={false} /></span>}
                        content={<div style={{ lineHeight: 1.6 }}>
                          <div style={{ fontWeight: 700, color: '#111827' }}>{nm}</div>
                          {p && <div style={{ color: '#6b7280' }}>{[p.position, p.department].filter(Boolean).join(' · ')}</div>}
                          {p?.branch && <div style={{ color: '#6b7280' }}>{p.branch}</div>}
                          {p?.phone && <div style={{ color: '#374151' }}>📞 {p.phone}</div>}
                          {p?.email && <div style={{ color: '#374151' }}>✉️ {p.email}</div>}
                          <div style={{ color: '#1a56db', marginTop: 2 }}>Follow-up task assigned</div>
                        </div>} />
                    );
                  })}
                  {(r.task_users || []).length > 3 && <span className="muted" style={{ marginLeft: 4 }}>+{r.task_users.length - 3}</span>}
                </td><td>{r.party_pan}</td>
                {showMobile && <td className="nowrap">{(r.party_whatsapp || r.party_mobile) && (
                  <a className="dl-wa" title={`WhatsApp ${r.party_name} with this ${meta.name.toLowerCase()}`}
                    onClick={(e) => { e.stopPropagation(); waRow(r); }} onDoubleClick={(e) => e.stopPropagation()}>
                    <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="#25d366" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .3-3.4-.7-2.9-1.2-4.7-4.1-4.9-4.3-.1-.2-1.2-1.6-1.2-3s.7-2.2 1-2.5c.3-.3.6-.3.8-.3h.6c.2 0 .4 0 .6.5l.9 2.1c.1.2.1.4 0 .6l-.4.6-.4.4c-.1.2-.3.3-.1.6.2.3.8 1.4 1.8 2.2 1.2 1.1 2.3 1.4 2.6 1.6.3.1.5.1.7-.1l.9-1.1c.2-.3.4-.2.7-.1l2 1c.3.1.5.2.6.3.1.2.1.7-.1 1.3z"/></svg>
                    {r.party_whatsapp || r.party_mobile}</a>)}</td>}
                <td>{isQuote ? r.qt_subject : payLabel(r.payment_mode)}</td>
                <td className="num">{fmtMoney(r.taxable + r.exempt)}</td><td className="num">{fmtMoney(r.vat)}</td>
                <td className="num" title={savedTip(r)}>{fmtMoney(r.total)}</td>
              </tr>
            ))}
            {g.blankRows(colCount)}
            <tr className="remarks-row"><td colSpan={colCount} style={{ height: remH }}>
              {curRow ? (
                <div className="rm-split"><div className="rm-grid">
                  <div><b>Remarks — {shortDocNo(curRow.doc_no)}:</b> {curRow.narration || <span className="muted">no remarks on this bill</span>}</div>
                  {isQuote
                    ? <div className="rm-pay"><b>Quotation:</b> {[curRow.qt_subject, curRow.qt_attn && `Attn ${curRow.qt_attn}`, curRow.qt_validity && `valid ${curRow.qt_validity}`,
                      curRow.status === 'billed' ? 'converted to a Sales Order' : curRow.status === 'open' ? 'waiting for the client' : curRow.status].filter(Boolean).join(' · ')}</div>
                    : <div className="rm-pay"><b>Payment:</b> {payDetail(curRow)}</div>}
                  {(curRow.transport_name || curRow.transport_bill_no || curRow.transport_file) && (
                    <div className="rm-pay"><b>🚚 Via Transport:</b> {curRow.transport_name || '—'}
                      {curRow.transport_bill_no && <> · Bill No. {curRow.transport_bill_no}</>}
                      {curRow.transport_file && <> · <a href={`/api/accounts/docs/${curRow.id}/transport-file`} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}>📎 View bill</a></>}
                    </div>
                  )}
                </div>
                <div className="rm-right" title={savedTip(curRow)}>
                  <div><b>Updated by:</b> {curRow.saved_by_name || '—'}</div>
                  {(curRow.party_whatsapp || curRow.party_mobile) && <div><b>{curRow.party_whatsapp ? 'WhatsApp' : 'Mobile'}:</b> {curRow.party_whatsapp || curRow.party_mobile}</div>}
                  {curRow.party_contact && <div><b>Contact:</b> {curRow.party_contact}</div>}
                </div></div>
              ) : <span className="muted">Click a bill to see its remarks and payment details.</span>}
            </td></tr>
          </tbody>
          <tfoot>
            <tr><th colSpan={footSpan} className="num">Total ({live.length})</th>
              <th className="num">{fmtMoney(total(live, 'taxable') + total(live, 'exempt'))}</th><th className="num">{fmtMoney(total(live, 'vat'))}</th>
              <th className="num">{fmtMoney(total(live, 'total'))}</th></tr>
          </tfoot>
        </table>
      </section>
      {open && <DocView key={open.doc.id} doc={open.doc} autoPrint={open.print} onClose={() => { setOpen(null); if (fromTask.current && window.opener) window.close(); }} onChanged={() => load()} />}
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
      {trans && <TransportDialog doc={trans} onClose={() => setTrans(null)} onSaved={() => { setTrans(null); load(); }} />}
      {del && <DeleteDialog what={del.doc_no} url={`/docs/${del.id}/delete`} onClose={() => setDel(null)} onDone={() => { setDel(null); load(); }} />}
    </>
  );
}
