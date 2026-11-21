import { useState } from 'react';
import { useNavigate } from '../lib/router';
import { useApp } from '../context';
import { api, fmtMoney, fmtStamp } from '../lib/api';
import { useShortcuts } from '../lib/keys';
import { Kbd } from './inputs';
import { DeleteDialog } from './Guards';
import { fmtAd, fmtBs } from '../lib/dates';

/** Printable voucher: Edit (password), Cancel (kept on record), Delete (admin approval). */
export default function VoucherView({ v, onClose, onChanged }) {
  const { company, notify, canEdit } = useApp();
  const nav = useNavigate();
  const [del, setDel] = useState(false);
  const tdr = v.lines.reduce((s, l) => s + l.dr, 0);
  const tcr = v.lines.reduce((s, l) => s + l.cr, 0);
  const manual = !v.source_doc_id;

  const cancel = async () => {
    const reason = prompt(`Cancel ${v.voucher_no}?\nThe number stays used and the entry is kept for audit.\n\nReason:`);
    if (!reason) return;
    try { onChanged?.(await api.post(`/vouchers/${v.id}/cancel`, { reason })); notify('Voucher cancelled'); }
    catch (err) { notify(err.message, 'err'); }
  };

  const [sending, setSending] = useState(false);
  const canMail = canEdit && manual && ['PV', 'RV'].includes(v.vtype) && v.status === 'posted';
  const sendMail = async () => {
    const to = prompt(`Email ${v.type_name} voucher ${v.voucher_no} to:`, v.party_email || '');
    if (!to) return;
    setSending(true);
    try { await api.post(`/vouchers/${v.id}/send`, { to }); notify(`Voucher emailed to ${to}`); }
    catch (err) { notify(err.message, 'err'); }
    setSending(false);
  };

  useShortcuts({ close: onClose, del: () => canEdit && manual && setDel(true) }, !del);

  return (
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card voucher print-area">
        <div className="v-company">
          <div className="print-only">
            <b>{company.name}</b>
            {company.address && <div>{company.address}</div>}
            {company.pan && <div>PAN: {company.pan}</div>}
          </div>
          <h2>{v.type_name} Voucher</h2>
        </div>
        {v.status === 'cancelled' && <div className="stamp">CANCELLED — {v.cancel_reason}</div>}
        <div className="v-meta">
          <span>Voucher No: <b>{v.voucher_no}</b></span>
          <span>Miti: <b>{fmtBs(v.vdate)}</b> ({fmtAd(v.vdate)})</span>
          {v.reference && <span>Ref: {v.reference}</span>}
        </div>
        <table className="grid">
          <thead><tr><th className="sn">SN</th><th>Particulars</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
          <tbody>
            {v.lines.map((l, i) => (
              <tr key={l.id}>
                <td className="sn">{i + 1}</td>
                <td>{l.cr > 0 && <span className="indent">To </span>}{l.account}{l.note && <small className="muted"> — {l.note}</small>}</td>
                <td className="num">{l.dr ? fmtMoney(l.dr) : ''}</td>
                <td className="num">{l.cr ? fmtMoney(l.cr) : ''}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><th /><th>Total</th><th className="num">{fmtMoney(tdr)}</th><th className="num">{fmtMoney(tcr)}</th></tr></tfoot>
        </table>
        {v.narration && <p><i>Narration:</i> {v.narration}</p>}
        <div className="signs"><span>Prepared by: {v.created_by}</span><span>Checked by</span><span>Approved by</span></div>
        <div className="last-saved no-print">
          <span>Entered by <b>{v.created_by}</b> · {fmtStamp(v.created_at)}</span>
          {v.updated_by && <span>Last edited by <b>{v.updated_by}</b> · {fmtStamp(v.updated_at)} ({v.edit_count}×)</span>}
          {v.cancelled_by && <span>Cancelled by <b>{v.cancelled_by}</b> · {fmtStamp(v.cancelled_at)}</span>}
          {!manual && <span>Posted from a purchase/sales bill — edit or delete the bill instead.</span>}
        </div>
        <div className="actions no-print">
          {canEdit && manual && v.status === 'posted' && <button className="ghost" onClick={() => nav(v.kind ? `/entry/${v.kind}/${v.id}/edit` : `/voucher/${v.vtype}/${v.id}/edit`)}>✏️ Edit</button>}
          {canEdit && manual && v.status === 'posted' && <button className="ghost" onClick={cancel}>Cancel voucher</button>}
          {canEdit && manual && <button className="danger" onClick={() => setDel(true)}>🗑 Delete <kbd className="kbd">Ctrl+Del</kbd></button>}
          <span className="spacer" />
          {canMail && <button className="ghost" disabled={sending} onClick={sendMail}
            title={v.party_email || 'No email saved for this party — you can type one'}>✉ {sending ? 'Sending…' : 'Email'}</button>}
          <button className="ghost" onClick={() => window.print()}>Print</button>
          <button onClick={onClose}>Close <Kbd>Esc</Kbd></button>
        </div>
      </div>
      {del && <DeleteDialog what={v.voucher_no} url={`/vouchers/${v.id}/delete`} onClose={() => setDel(false)}
        onDone={(r) => { setDel(false); if (r.deleted) { onChanged?.(null); onClose(); } }} />}
    </div>
  );
}
