import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../context';
import { BsDateInput, D, Kbd } from '../components/inputs';
import ContextMenu from '../components/ContextMenu';
import { RemarksRow, useGrid } from '../components/DataGrid';
import DocView from '../components/DocView';
import { api, fmtMoney } from '../lib/api';
import { useShortcuts } from '../lib/keys';
import { shortDocNo } from '../lib/docs';

const TABS = [['pending', 'Pending'], ['cleared', 'Deposited / Cleared'], ['bounced', 'Bounced'], ['', 'All']];
const STATUS = { pending: 'pending', cleared: 'cleared', bounced: 'bounced' };

/**
 * Post-dated cheques from bills. Pending cheques move no money (the party ledger only shows a memo line).
 * Deposit / Clear posts a Receipt (received) or Payment (issued) voucher to the chosen bank.
 */
export default function Cheques() {
  const { accounts, today, canEdit, notify } = useApp();
  const [tab, setTab] = useState('pending');
  const [dir, setDir] = useState('');
  const [rows, setRows] = useState([]);
  const g = useGrid({ rows, onOpen: (r) => openBill(r) });
  const { setCur } = g;
  const [menu, setMenu] = useState(null);
  const [dep, setDep] = useState(null);     // cheque being deposited
  const [doc, setDoc] = useState(null);
  const banks = useMemo(() => accounts.filter((a) => a.kind === 'bank'), [accounts]);

  const load = () => api.get('/cheques', { ...(tab ? { status: tab } : {}), ...(dir ? { direction: dir } : {}) }).then(setRows)
    .catch((e) => notify(e.message, 'err'));
  useEffect(() => { load(); }, [tab, dir]);

  const total = rows.reduce((s, r) => s + r.amount, 0);
  const cols = canEdit ? 12 : 11;
  const overdue = (r) => r.status === 'pending' && r.cheque_date <= today;

  const act = async (url, body, msg) => {
    try { await api.post(url, body); notify(msg); load(); } catch (e) { notify(e.message, 'err'); }
  };
  const bounce = (r) => {
    const reason = prompt(`Cheque ${r.cheque_no} bounced?\nThe bill stays unpaid on ${r.party_name}'s ledger.\n\nReason:`, 'Insufficient funds');
    if (reason) act(`/cheques/${r.id}/bounce`, { reason }, `Cheque ${r.cheque_no} marked bounced`);
  };
  const undo = (r) => {
    const reason = prompt(`Undo ${r.status === 'cleared' ? `the deposit of cheque ${r.cheque_no} (voucher ${r.voucher_no} will be cancelled)` : `bounce of cheque ${r.cheque_no}`}?\n\nReason:`);
    if (reason) act(`/cheques/${r.id}/undo`, { reason }, `Cheque ${r.cheque_no} is pending again`);
  };
  const openBill = async (r) => { if (r.doc_id) setDoc(await api.get(`/docs/${r.doc_id}`)); };

  const rowMenu = (e, r) => {
    e.preventDefault(); setCur(r.id);
    setMenu({ x: e.clientX, y: e.clientY, title: `Cheque ${r.cheque_no}`, items: [
      canEdit && r.status === 'pending' && { label: r.direction === 'received' ? 'Deposit to bank…' : 'Mark cleared from bank…', icon: '🏦', onClick: () => setDep(r) },
      canEdit && r.status === 'pending' && { label: 'Bounced', icon: '↩', danger: true, onClick: () => bounce(r) },
      canEdit && r.status !== 'pending' && { label: r.status === 'cleared' ? 'Undo deposit' : 'Undo bounce', icon: '⟲', onClick: () => undo(r) },
      r.doc_id && { label: 'Open bill', icon: '👁', onClick: () => openBill(r) },
    ] });
  };

  return (
    <>
      <header className="page-head"><h1>Post-dated Cheques</h1></header>
      <div className="toolbar pdc-bar">
        <span className="pdc-tabs">
          {TABS.map(([v, l]) => <button key={v} type="button" className={tab === v ? 'on' : ''} onClick={() => setTab(v)}>{l}</button>)}
        </span>
        <select value={dir} onChange={(e) => setDir(e.target.value)}>
          <option value="">Received & issued</option>
          <option value="received">Received (from customers)</option>
          <option value="issued">Issued (to suppliers)</option>
        </select>
        <span className="spacer" />
        <span className="muted small">Pending cheques show on the party ledger as a note only — money posts when deposited.</span>
      </div>
      <section className="card">
        <table ref={g.gridRef} className="grid dg-soft">
          <thead><tr>
            {g.tickTh}<th className="sn">SN</th><th>Cheque Date</th><th>Cheque No.</th><th>Bank</th><th>Party</th><th>Type</th><th>Bill</th>
            <th className="num">Amount</th><th>Status</th><th>Deposited / Voucher</th>{canEdit && <th className="nowrap">Action</th>}
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={cols} className="muted">No cheques here.</td></tr>}
            {rows.map((r, i) => (
              <tr key={r.id} {...g.rowProps(r)} onContextMenu={(e) => rowMenu(e, r)}>
                {g.tickTd(r)}
                <td className="sn">{i + 1}</td>
                <td className="nowrap"><D iso={r.cheque_date} />{overdue(r) && <span className="tag st-due">due</span>}</td>
                <td className="nowrap mono">{r.cheque_no}</td>
                <td>{r.cheque_bank}</td>
                <td>{r.party_name}</td>
                <td>{r.direction === 'received' ? '⬇ Received' : '⬆ Issued'}</td>
                <td className="nowrap">{r.doc_no && <a onClick={(e) => { e.stopPropagation(); openBill(r); }}>{shortDocNo(r.doc_no)}</a>}</td>
                <td className="num">{fmtMoney(r.amount)}</td>
                <td><span className={`tag pdc-st-${r.status}`}>{STATUS[r.status] || r.status}</span>{r.status === 'bounced' && r.note && <div className="small muted">{r.note}</div>}</td>
                <td className="small">{r.status === 'cleared' && <>{r.bank_account} · <D iso={r.cleared_date} /> · {r.voucher_no}</>}</td>
                {canEdit && (
                  <td className="nowrap">
                    {r.status === 'pending' && <>
                      <button type="button" className="ghost pdc-btn" onClick={(e) => { e.stopPropagation(); setDep(r); }}>{r.direction === 'received' ? 'Deposit' : 'Cleared'}</button>
                      <button type="button" className="ghost pdc-btn bad" onClick={(e) => { e.stopPropagation(); bounce(r); }}>Bounced</button>
                    </>}
                    {r.status !== 'pending' && <button type="button" className="ghost pdc-btn" onClick={(e) => { e.stopPropagation(); undo(r); }}>Undo</button>}
                  </td>
                )}
              </tr>
            ))}
            {g.blankRows(cols)}
            <RemarksRow g={g} cols={cols} empty="Click a cheque to see its details. Double-click to open its bill.">
              {g.curRow && <>
                <div><b>Cheque {g.curRow.cheque_no}</b> · {g.curRow.cheque_bank || '—'} · Rs.{fmtMoney(g.curRow.amount)} · {g.curRow.direction === 'received' ? `received from ${g.curRow.party_name}` : `issued to ${g.curRow.party_name}`}</div>
                <div className="rm-pay"><b>Status:</b> {STATUS[g.curRow.status] || g.curRow.status}
                  {g.curRow.doc_no && <> · <b>Bill</b> {g.curRow.doc_no}</>}
                  {g.curRow.voucher_no && <> · <b>Voucher</b> {g.curRow.voucher_no}</>}
                  {g.curRow.note && <> · <b>Note</b> {g.curRow.note}</>}</div>
              </>}
            </RemarksRow>
          </tbody>
          <tfoot><tr><th colSpan={8} className="num">Total ({rows.length})</th><th className="num">{fmtMoney(total)}</th><th colSpan={canEdit ? 3 : 2} /></tr></tfoot>
        </table>
      </section>
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
      {dep && <DepositDialog cheque={dep} banks={banks} today={today} onClose={() => setDep(null)}
        onDone={() => { setDep(null); notify(`Cheque ${dep.cheque_no} posted`); load(); }} />}
      {doc && <DocView doc={doc} onClose={() => setDoc(null)} onChanged={() => load()} />}
    </>
  );
}

function DepositDialog({ cheque: c, banks, today, onClose, onDone }) {
  const { notify } = useApp();
  const [bank, setBank] = useState(banks[0]?.id || '');
  const [on, setOn] = useState(c.cheque_date > today ? today : c.cheque_date);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const received = c.direction === 'received';
  const save = async () => {
    if (busy || !bank) return;
    setBusy(true);
    try { await api.post(`/cheques/${c.id}/deposit`, { bank_account_id: Number(bank), date: on, note }); onDone(); }
    catch (e) { notify(e.message, 'err'); }
    setBusy(false);
  };
  useShortcuts({ save, close: onClose });
  return (
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card form">
        <h2>{received ? '🏦 Deposit cheque' : '🏦 Cheque cleared from bank'}</h2>
        <div className="pay-note full" style={{ gridColumn: '1 / -1' }}>
          Cheque <b>{c.cheque_no}</b> ({c.cheque_bank || '—'}) {received ? 'from' : 'to'} <b>{c.party_name}</b> — <b>Rs {fmtMoney(c.amount)}</b>
          <br />Posts a {received ? 'Receipt' : 'Payment'} voucher: {received ? `Dr Bank, Cr ${c.party_name}` : `Dr ${c.party_name}, Cr Bank`}.
        </div>
        <label>{received ? 'Deposited in' : 'Paid from'} (bank) *
          <select value={bank} onChange={(e) => setBank(e.target.value)}>
            {banks.length === 0 && <option value="">— add a bank account first —</option>}
            {banks.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label>{received ? 'Deposit date' : 'Cleared date'}<BsDateInput value={on} onChange={setOn} /></label>
        <label className="full">Note<input value={note} placeholder="Optional, e.g. deposit slip no." onChange={(e) => setNote(e.target.value)} /></label>
        <div className="actions full">
          <button type="button" className="ghost" onClick={onClose}>Cancel <Kbd>Esc</Kbd></button>
          <span className="spacer" />
          <button type="button" data-save disabled={busy || !bank} onClick={save}>Post <Kbd>Ctrl+S</Kbd></button>
        </div>
      </div>
    </div>
  );
}
