import { useEffect, useState } from 'react';
import { useNavigate } from '../lib/router';
import { useApp } from '../context';
import AuthImg from './AuthImg';
import { authFetch, api, fmtMoney, fmtStamp, openPdf, waLink } from '../lib/api';
import { fmtAd, fmtBs } from '../lib/dates';
import { DOCS, payLabel, statusLabel } from '../lib/docs';
import { useShortcuts } from '../lib/keys';
import { amountInWords } from '../lib/words';
import { Kbd } from './inputs';
import { exportSerials } from './SerialDialog';
import { DeleteDialog } from './Guards';
import TaskDialog, { PRIORITIES } from './TaskDialog';
import TaskPopup from './TaskPopup';

const NAMES = { QT: 'Quotation', PO: 'Purchase Order', PB: 'Purchase Bill', PR: 'Debit Note', SO: 'Sales Order', SI: 'Tax Invoice', SR: 'Credit Note' };

/** "Mobile: 98…  WhatsApp: 98…" (WhatsApp shown only when it differs from the mobile) */
const partyPhones = (d) => {
  const m = d.party_mobile, w = d.party_whatsapp;
  return [m && `Mobile: ${m}`, w && w !== m && `WhatsApp: ${w}`].filter(Boolean).join(' · ');
};

/** Printable invoice / order / note in IRD layout: Print (counts copies), Email, WhatsApp, Cancel. */
import { loadXlsx, styleGrid, styleTitle } from '../lib/xlsxStyled';
import { IcoCancel, IcoClose, IcoDelete, IcoEdit, IcoExport, IcoMail, IcoNext, IcoPrint, IcoReturn, IcoSms, IcoWhatsApp } from './ToolIcons';

const LEVEL_NAMES ={ mrp: 'Retail (MRP)', dealer: 'Dealer', partner: 'Partner' };

export default function DocView({ doc: initial, onClose, onChanged, autoPrint }) {
  const { company, notify, canEdit } = useApp();
  const nav = useNavigate();
  const [d, setD] = useState(initial);
  const [printing, setPrinting] = useState(false);
  const [sending, setSending] = useState('');
  const meta = DOCS[d.doc_type];
  const isSale = meta.side === 'sales';
  const isQuote = !!meta.quote;
  const pdfUrl = `/api/accounts/docs/${d.id}/pdf`;

  useEffect(() => {
    if (!printing) return undefined;
    const t = setTimeout(() => { window.print(); setPrinting(false); }, 50);
    return () => clearTimeout(t);
  }, [printing]);

  const print = async () => {
    // quotation: the presentation PDF opens in a new tab — print it from there (Ctrl+P)
    try {
      if (isQuote) await openPdf(`${pdfUrl}?inline=1`, `Quotation ${d.doc_no} — ${d.party_name}`);
      const nd = await api.post(`/docs/${d.id}/print`); setD(nd); onChanged?.(nd);
      if (!isQuote) setPrinting(true);
    } catch (err) { notify(err.message, 'err'); }
  };
  /** Quotation PDF as a file (for the share sheet / download). */
  const quoteFile = async () => {
    const res = await authFetch(pdfUrl);
    if (!res.ok) throw new Error('Could not make the PDF.');
    const name = (res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || `${d.doc_no.replace(/\//g, '-')}.pdf`;
    return new File([await res.blob()], name, { type: 'application/pdf' });
  };
  // opened from a list's right-click "Print": print straight away
  useEffect(() => { if (autoPrint) print(); }, []);
  const cancel = async () => {
    if (!(d.status === 'posted' || d.status === 'open')) return;
    const reason = prompt(`Cancel ${d.doc_no}?\nIt stays on record as cancelled (IRD).\n\nReason:`);
    if (!reason) return;
    try { const nd = await api.post(`/docs/${d.id}/cancel`, { reason }); setD(nd); onChanged?.(nd); notify('Cancelled'); }
    catch (err) { notify(err.message, 'err'); }
  };
  const send = async (channel) => {
    let to;
    if (isQuote && channel === 'email') {          // quotation: confirm / type the address; the PDF goes as an attachment
      to = prompt('Email the quotation PDF to:', d.party_email || '');
      if (to === null) return;
    }
    setSending(channel);
    try {
      const nd = await api.post(`/docs/${d.id}/send`, { channel, ...(to ? { to } : {}) }); setD(nd);
      notify(`${channel === 'email' ? 'Email' : 'WhatsApp'} sent${isQuote && channel === 'email' ? ' with the quotation PDF' : ''}`);
    } catch (err) { notify(err.message, 'err'); setD(await api.get(`/docs/${d.id}`)); }
    setSending('');
  };
  const shareText = isQuote ? [
    `Namaste ${d.party_name},${d.qt_attn ? `\nAttn: ${d.qt_attn}` : ''}`,
    `Please find attached our quotation for ${d.qt_subject || 'your requirement'}.`,
    `Quotation No.: ${d.doc_no} · Date: ${fmtBs(d.doc_date)}`, `Grand Total: Rs ${fmtMoney(d.total)} (incl. VAT)`,
    d.qt_validity ? `Validity: ${d.qt_validity}` : '', `— ${company.name}`,
  ].filter(Boolean).join('\n') : [
    `Namaste ${d.party_name},`, `${company.name} — ${NAMES[d.doc_type]} ${d.doc_no}`,
    `Miti: ${fmtBs(d.doc_date)}  Amount: Rs ${fmtMoney(d.total)}`,
    d.due_date && d.payment_mode === 'credit' ? `Due by: ${fmtBs(d.due_date)}` : '',
    ...d.lines.filter((l) => l.service_to).map((l) => `${l.item}: service valid till ${fmtBs(l.service_to)}`),
    'Thank you.',
  ].filter(Boolean).join('\n');

  /** Bank accounts to pay into: the one this bill was paid to, else every bank with an account no. / QR. */
  const bankShare = async () => {
    const list = await api.get('/bank-share');
    const mine = d.cash_account_id ? list.filter((b) => b.ledger_ids.includes(d.cash_account_id)) : [];
    return mine.length ? mine : list;
  };
  const bankText = (list) => (list.length ? ['*Pay to our bank account:*', ...list.map((b) => [`🏦 ${b.name}`, b.account_name && `A/c Name: ${b.account_name}`, b.account_no && `A/c No.: ${b.account_no}`, b.branch && `Branch: ${b.branch}`, b.qr && '(QR code on the bill)'].filter(Boolean).join('\n'))].join('\n') : '');

  const [expOpen, setExpOpen] = useState(false);
  const canSend = canEdit && !!d.party_id && d.status !== 'cancelled';
  /** WhatsApp: sent by the server when WhatsApp is set up, otherwise opens WhatsApp with the message ready. */
  const whatsapp = async () => {
    if (isSale) {
      // the quotation PDF itself: Windows / Android share sheet → WhatsApp; otherwise download it + open the chat
      setSending('whatsapp');
      try {
        // the bill as PDF + the bank account(s) to pay into: details in the message, QR image(s) as files
        const banks = isQuote || meta.role === 'return' ? [] : await bankShare();
        const text = [shareText, bankText(banks)].filter(Boolean).join('\n\n');
        const files = [await quoteFile()];      // the bill PDF — bank account + QR code are printed on it
        if (navigator.canShare?.({ files })) await navigator.share({ files, title: files[0].name, text });
        else {
          for (const file of files) {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(file); a.download = file.name; a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 4000);
          }
          const what = isQuote ? 'Quotation PDF' : 'Bill PDF';
          window.open(waLink(d.party_phone, `${text}\n(${what} attached)`), '_blank', 'noopener');
          notify(`${what} downloaded — attach it in the WhatsApp chat that just opened.`);
        }
      } catch (e) { if (e.name !== 'AbortError') notify(e.message, 'err'); }
      setSending('');
      return;
    }
    if (company.wa_ready && canSend && d.party_phone) send('whatsapp');
    else window.open(waLink(d.party_phone, shareText), '_blank', 'noopener');
  };
  const sms = () => {
    const phone = String(d.party_phone || '').replace(/[^\d+]/g, '');
    window.location.href = `sms:${phone}?body=${encodeURIComponent(shareText)}`;
  };
  const exportExcel = async () => {
    const XLSX = await loadXlsx();
    const rows = [
      [screenTitle, d.doc_no], [isSale ? 'Buyer' : 'Supplier', d.party_name], ['PAN', d.party_pan || ''], ['Miti', fmtBs(d.doc_date)], ['Date', d.doc_date],
      ['Payment', payLabel(d.payment_mode)], [],
      ['SN', 'Particulars', 'HS Code', 'Qty', 'Unit', 'Rate', 'Discount', 'Amount', 'Serial numbers'],
      ...d.lines.map((l, i) => [i + 1, l.item, l.hs_code || '', l.qty, l.unit, l.rate_excl, l.discount || 0, l.amount, l.serials.join(', ')]),
      [], ['', '', '', '', '', '', 'Gross amount', d.gross], ...(d.discount > 0 ? [['', '', '', '', '', '', 'Discount', d.discount]] : []),
      ['', '', '', '', '', '', 'Taxable amount', d.taxable], ['', '', '', '', '', '', `VAT ${company.vat_rate}%`, d.vat],
      ['', '', '', '', '', '', 'Total', d.total], [], ['In words', amountInWords(d.total)],
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 8 }, { wch: 40 }, { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 12 }, { wch: 16 }, { wch: 14 }, { wch: 30 }];
    // same look as the screen grid: grey heading + S.N., borders; totals block bordered with bold Total
    const top = 7;
    styleTitle(ws, XLSX, 1);
    styleGrid(XLSX, ws, { r0: top, r1: top + d.lines.length, headRows: 1, snCol: 0, cols: 9 });
    const tStart = top + d.lines.length + 2;
    const tEnd = rows.findIndex((r, i) => i >= tStart && r[6] === 'Total');
    for (let r = tStart; r <= tEnd; r++) {
      for (const c of [6, 7]) {
        const a = XLSX.utils.encode_cell({ r, c });
        const cell = ws[a] || (ws[a] = { t: 's', v: '' });
        if (cell.t === 'n') cell.z = '#,##0.00';
        cell.s = { border: { top: { style: 'thin', color: { rgb: 'BFBFBF' } }, bottom: { style: 'thin', color: { rgb: 'BFBFBF' } },
          left: { style: 'thin', color: { rgb: 'BFBFBF' } }, right: { style: 'thin', color: { rgb: 'BFBFBF' } } },
        font: { bold: r === tEnd }, fill: r === tEnd || c === 6 ? { patternType: 'solid', fgColor: { rgb: 'F4F4F4' } } : undefined,
        alignment: { horizontal: c === 7 ? 'right' : 'left' } };
      }
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, d.doc_type);
    XLSX.writeFile(wb, `${d.doc_no.replace(/\//g, '-')}.xlsx`);
  };
  const [delOpen, setDelOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  // Task button: if a task was already assigned for this document, show the Task module's history right here in a
  // pop-up (follow-ups, replies, status, new follow-up); otherwise offer the assign dialog.
  const linkedTasks = (d.tasks || []).filter((t) => t.task_id);
  const [popOpen, setPopOpen] = useState(false);
  const editable = canEdit && d.status !== 'cancelled' && d.status !== 'billed';
  useShortcuts({ close: onClose, del: canEdit ? () => setDelOpen(true) : undefined }, !delOpen && !taskOpen && !popOpen);

  let title = meta.print;
  if (d.doc_type === 'SI' && !company.vat_registered) title = 'INVOICE';
  // screen heading uses the plain document name (Sales Invoice); the printed copy keeps TAX INVOICE
  const screenTitle = meta.name;
  const copyNo = d.print_count - 1;   // first print is the original
  const partyLabel = isSale ? 'Buyer' : 'Supplier';
  const allSerials = d.lines.flatMap((l) => l.serials);

  return (
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`card invoice iv2 print-area ${isSale ? 'iv-sale' : 'iv-purchase'}`}>
        {/* form header (screen only) */}
        <div className="doc-titlebar no-print">
          <span className="dt-icon">{isSale ? '🧾' : '📦'}</span>
          <h2>{screenTitle}</h2>
          <span className="dt-no">{d.doc_no}</span>
          <span className={`tag st-${d.status}`}>{statusLabel(d.status, d.doc_type)}</span>
          {d.doc_type === 'SI' && d.print_count > 0 && <span className="tag">{copyNo === 0 ? 'Original printed' : `Copy of Original — ${copyNo}`}</span>}
        </div>

        {/* communication: send / print / export */}
        <div className="comm-bar tb2 no-print">
          {/* bill actions */}
          <span className="tb-group">
            {editable && <button type="button" onClick={() => nav(`/docs/${d.doc_type}/${d.id}/edit`)}><IcoEdit /> Edit</button>}
            {canEdit && (d.status === 'posted' || d.status === 'open') && <button type="button" onClick={cancel}><IcoCancel /> Cancel bill</button>}
            {canEdit && <button type="button" className="tb-del" disabled={!!d.pending_delete}
              title={d.pending_delete ? `Delete requested by ${d.pending_delete.requested_by}` : 'Delete (Ctrl+Del)'}
              onClick={() => setDelOpen(true)}><IcoDelete /> {d.pending_delete ? 'Delete requested' : 'Delete'}</button>}
            {canEdit && d.status === 'open' && meta.next && <button type="button" onClick={() => nav(`/docs/${meta.next}/new?ref=${d.id}`)}><IcoNext /> Make {DOCS[meta.next].name}</button>}
            {canEdit && d.status === 'posted' && meta.ret && <button type="button" onClick={() => nav(`/docs/${meta.ret}/new?ref=${d.id}`)}><IcoReturn /> Return</button>}
            {isQuote && d.status !== 'cancelled' && linkedTasks.length > 0
              ? <button type="button" title="Task follow-up history" onClick={() => setPopOpen(true)}>📌 Task</button>
              : isQuote && canEdit && d.status !== 'cancelled' && <button type="button" title="Assign a follow-up task" onClick={() => setTaskOpen(true)}>📌 Task</button>}
            <button type="button" title="Close (Esc)" onClick={onClose}><IcoClose /> Close</button>
          </span>
          <span className="spacer" />
          {/* send / print / export */}
          <span className="tb-group">
          <button type="button" disabled={!canSend || (!d.party_email && !isQuote) || !!sending}
            title={isQuote ? 'Email the quotation PDF' : d.party_email || 'No email saved for this party'} onClick={() => send('email')}>
            <IcoMail /> {sending === 'email' ? 'Sending…' : 'Send Email'}</button>
          <button type="button" disabled={d.status === 'cancelled' || !!sending} onClick={whatsapp}
            title={d.party_phone || 'No mobile saved — you can pick the contact in WhatsApp'}><IcoWhatsApp /> {sending === 'whatsapp' ? 'Sending…' : 'WhatsApp'}</button>
          <button type="button" disabled={d.status === 'cancelled' || !d.party_phone} onClick={sms}
            title={d.party_phone ? `SMS to ${d.party_phone}` : 'No mobile number saved'}><IcoSms /> SMS</button>
          <button type="button" onClick={print} title={isQuote ? 'Opens the quotation PDF — print it from there' : undefined}>
            <IcoPrint /> Print{d.doc_type === 'SI' && d.print_count > 0 ? ' copy' : ''}</button>
          <span className="comm-export">
            <button type="button" onClick={() => setExpOpen((x) => !x)}><IcoExport /> Export ▾</button>
            {expOpen && (
              <span className="comm-menu" onMouseLeave={() => setExpOpen(false)}>
                <button type="button" onClick={() => { setExpOpen(false); openPdf(pdfUrl, `${screenTitle} ${d.doc_no}`); }}>📄 PDF{isQuote ? ' (quotation)' : ''}</button>
                <button type="button" onClick={() => { setExpOpen(false); exportExcel(); }}>📊 Excel</button>
                {allSerials.length > 0 && <button type="button" onClick={() => { setExpOpen(false); exportSerials(allSerials, d.doc_no); }}>🔢 Serial numbers</button>}
              </span>
            )}
          </span>
          </span>
        </div>

        {d.doc_type === 'SI' && d.print_count > 0 && (
          <div className="copy-label print-only">{copyNo === 0 ? 'Original' : `Copy of Original — ${copyNo}`}</div>
        )}
        {/* ===== screen: full-width read-only form, laid out like the bill entry screen ===== */}
        <div className="dv no-print">
          {d.status === 'cancelled' && <div className="stamp">CANCELLED — {d.cancel_reason}</div>}
          <div className={`dv-top ${isSale ? 'sale' : ''}`}>
            <div className="dv-f wide">
              <label>{isSale ? 'Customer Name' : 'Supplier Name'}</label>
              <div className="dv-v"><b>{d.party_name}</b></div>
              <small>PAN {d.party_pan || '—'}{d.party_address ? ` · ${d.party_address}` : ''}</small>
              {(d.party_contact || d.party_mobile || d.party_whatsapp) && <small>{d.party_contact ? `Contact: ${d.party_contact}` : ''}{d.party_contact && (d.party_mobile || d.party_whatsapp) ? ' · ' : ''}{partyPhones(d)}</small>}
            </div>
            {isSale
              ? <div className="dv-f"><label>Type</label><div className="dv-v">{LEVEL_NAMES[d.price_level] || 'Retail (MRP)'}</div></div>
              : d.supplier_bill_no ? <div className="dv-f"><label>Supplier Bill No.</label><div className="dv-v">{d.supplier_bill_no}</div></div> : null}
            {(d.challan_no || d.vat_bill_no || d.doc_type === 'SI') && (
              <div className="dv-f"><label>Challan No. | VAT Bill</label>
                <div className="dv-v">Challan No.: <b>{d.challan_no || '—'}</b><span className="iv-sep">|</span>VAT Bill: <b>{d.vat_bill_no || '—'}</b></div></div>
            )}
            <div className="dv-f"><label>{isQuote ? 'Quotation Date' : meta.role === 'order' ? 'Order Date' : meta.role === 'return' ? 'Return Date' : 'Bill Date'}</label>
              <div className="dv-v">{fmtBs(d.doc_date)}<span className="iv-sep">|</span>{fmtAd(d.doc_date)}</div></div>
          </div>

          {isQuote && (
            <div className="dv-pay2 qt-info">
              {[['Subject', <b key="s">{d.qt_subject}</b>], d.qt_attn && ['Attn', d.qt_attn], d.qt_validity && ['Validity', d.qt_validity],
                ['Template', d.qt_template_name || '—'],
                d.converted_to && ['Converted to', <span key="c" className="mono">{d.converted_to}</span>],
                d.qt_client_logo && ['Client Logo', <AuthImg key="l" className="qt-logo-thumb" src={`/docs/${d.id}/client-logo`} alt="" />],
              ].filter(Boolean).map(([k, v], i) => (
                <span key={k} className="dv-pi">{i > 0 && <span className="iv-sep">|</span>}<span className="dv-pk">{k}:</span> {v}</span>
              ))}
            </div>
          )}
          {!isQuote && (() => {
            const paid = d.paid_amount ?? d.total;
            const left = Math.round((d.total - paid) * 100) / 100;
            const items = [
              ['Payment Mode', <b key="m">{payLabel(d.payment_mode)}</b>],
              (d.payment_mode === 'cash' || d.payment_mode === 'bank') && [isSale ? 'Received in' : 'Paid from', d.cash_account || '—'],
              d.payment_mode === 'bank' && ['Trans. ID', d.txn_id || '—'],
              d.payment_mode === 'cheque' && ['Cheque No.', `${d.cheque_no} · ${d.cheque_bank || '—'} · ${fmtBs(d.cheque_date)}`],
              ['cash', 'bank', 'cheque'].includes(d.payment_mode) && [isSale ? 'Received' : 'Paid', <b key="p">Rs.{fmtMoney(paid)}</b>],
              ['cash', 'bank', 'cheque'].includes(d.payment_mode) && left > 0.005 && ['Balance due', <b key="b" className="dv-baldue">Rs.{fmtMoney(left)}</b>],
              d.cheque && d.cheque.status !== 'cancelled' && ['Cheque', <span key="c" className={`tag pdc-st-${d.cheque.status}`}>
                {d.cheque.status === 'pending' ? 'Post-dated — not deposited' : d.cheque.status === 'cleared' ? `Deposited ${fmtBs(d.cheque.cleared_date)} · ${d.cheque.voucher_no}` : 'Bounced'}</span>],
              d.due_date && d.payment_mode === 'credit' && ['Due Date', <b key="d" className="dv-baldue">{fmtBs(d.due_date)}</b>],
              d.followup_user && ['Follow-up', `${d.followup_user} · ${fmtBs(d.followup_date)}`],
              d.pay_voucher_no && d.pay_voucher_status !== 'cancelled' && [`${['SI', 'PR'].includes(d.doc_type) ? 'Receipt' : 'Payment'} Voucher`, <span key="v" className="mono">{d.pay_voucher_no}</span>],
              d.pay_proof && ['Proof', <a key="pf" href={`/api/accounts/docs/${d.id}/proof`} target="_blank" rel="noopener">📎 View</a>],
              d.ref_doc_no && [meta.role === 'return' ? 'Against Bill' : 'From Order', <span key="r" className="mono">{d.ref_doc_no}</span>],
              (d.transport_name || d.transport_bill_no) && ['🚚 Via Transport', <span key="t">{d.transport_name || '—'}{d.transport_bill_no ? ` · Bill No. ${d.transport_bill_no}` : ''}
                {d.transport_file && <> · <a href={`/api/accounts/docs/${d.id}/transport-file`} target="_blank" rel="noopener">📎 View</a></>}</span>],
            ].filter(Boolean);
            return (
              <div className="dv-pay2">
                {items.map(([k, v], i) => (
                  <span key={k} className="dv-pi">{i > 0 && <span className="iv-sep">|</span>}<span className="dv-pk">{k}:</span> {v}</span>
                ))}
              </div>
            );
          })()}

          <div className="section-label">{isSale ? 'PRODUCT DETAILS' : 'ITEMS'}</div>
          <table className="grid dg-soft dv-items">
            <thead><tr>
              <th className="sn">SN</th><th>PRODUCT NAME</th><th>HS CODE</th><th className="num">QTY</th><th>UNIT</th><th className="num">MRP RS.</th>
              <th className="num">RATE</th><th>VAT TYPE</th><th className="num">DISCOUNT</th><th className="num">VAT EXCL. RS.</th><th className="num">TOTAL RS.</th>
            </tr></thead>
            <tbody>
              {d.lines.map((l, i) => (
                <tr key={l.id}>
                  <td className="sn">{i + 1}</td>
                  <td>
                    <b className="dv-item">{l.item}</b>{!l.vat_applicable && d.vat > 0 && <small className="muted"> (VAT exempt)</small>}
                    {l.serials.length > 0 && <div className="inv-sub iv-sn">S/N: {l.serials.join(', ')}</div>}
                    {l.warranty_until && <div className="inv-sub iv-wty">Warranty {l.warranty_months} months — till {fmtBs(l.warranty_until)}</div>}
                    {l.service_to && <div className="inv-sub">Service {fmtBs(l.service_from)} to <b>{fmtBs(l.service_to)}</b></div>}
                  </td>
                  <td className="nowrap">{l.hs_code}</td>
                  <td className="num">{l.qty}</td><td>{l.unit}</td>
                  <td className="num muted">{l.mrp ? fmtMoney(l.mrp) : ''}</td>
                  <td className="num">{fmtMoney(l.rate)}</td>
                  <td>{l.vat_applicable && d.vat > 0 ? (l.vat_inclusive ? 'Inclusive' : 'Exclusive') : 'Exempt'}</td>
                  <td className="num">{l.discount ? fmtMoney(l.discount) : ''}</td>
                  <td className="num dv-excl">{fmtMoney(l.qty ? l.amount / l.qty : 0)}</td>
                  <td className="num dv-tot">{fmtMoney(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="dv-foot">
            <div className="dv-words">
              <div className="section-label">IN WORDS</div>
              <div className="words-box">{amountInWords(d.total)}</div>
              <div className="section-label">REMARKS</div>
              <div className="dv-remarks">{d.narration || <span className="muted">—</span>}</div>
            </div>
            <div className="dv-totals">
              <div><span>Gross Total</span><b>Rs.{fmtMoney(d.gross)}</b></div>
              {d.discount > 0 && <div className="muted"><span>Discount</span><b>Rs.{fmtMoney(d.discount)}</b></div>}
              {d.exempt > 0 && <div className="muted"><span>of which VAT-exempt</span><b>Rs.{fmtMoney(d.exempt)}</b></div>}
              {Math.abs(d.taxable - d.gross) > 0.005 && <div><span>Taxable Amount</span><b>Rs.{fmtMoney(d.taxable)}</b></div>}
              <div className="vat"><span>VAT {company.vat_rate}%</span><b>Rs.{fmtMoney(d.vat)}</b></div>
              <div className="grand"><span>Grand Total</span><b>Rs.{fmtMoney(d.total)}</b></div>
            </div>
          </div>
          {isQuote && (d.qt_terms_list?.length > 0 || d.qt_notes) && (
            <>
              <div className="section-label">TERMS &amp; CONDITIONS</div>
              <table className="grid dg-soft qt-terms-view">
                <tbody>{(d.qt_terms_list || []).map(([k, v], i) => <tr key={i}><th>{k}</th><td>{v}</td></tr>)}</tbody>
              </table>
              {d.qt_notes && <div className="qt-notes-view"><b>Notes:</b> {d.qt_notes}</div>}
            </>
          )}
          {isQuote && d.tasks?.length > 0 && (
            <>
              <div className="section-label">📌 FOLLOW-UP TASKS</div>
              <table className="grid dg-soft qt-tasks">
                <thead><tr><th>Follow-up Date</th><th>Staff</th><th>Priority</th><th>Remarks</th><th>Status</th></tr></thead>
                <tbody>{d.tasks.map((t) => (
                  <tr key={t.id}>
                    <td className="nowrap">{fmtBs(t.remind_on)}</td><td>{t.assigned_name}</td>
                    <td><span className={`tag prio-${t.priority}`}>{PRIORITIES.find((p) => p[0] === t.priority)?.[1] || t.priority}</span></td>
                    <td>{t.note || <span className="muted">—</span>}</td>
                    <td>{t.status === 'done' ? `✔ done by ${t.done_by}` : 'open'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </>
          )}
        </div>

        {/* ===== paper: the tax invoice as printed (hidden on screen) ===== */}
        <div className="iv-sheet print-only">
        <div className="inv-head">
          {/* company details: on paper only (print), not on screen */}
          <div className="print-only">
            <b className="inv-company">{company.name}</b>
            {company.address && <div>{company.address}</div>}
            <div>{company.pan && <>{company.vat_registered ? 'VAT' : 'PAN'} No: <b>{company.pan}</b></>}{company.phone && <> · Ph: {company.phone}</>}</div>
          </div>
          <h2 className="print-only">{title}</h2>
        </div>
        {d.status === 'cancelled' && <div className="stamp">CANCELLED — {d.cancel_reason}</div>}
        <div className="inv-meta iv-meta">
          <div className="iv-party">
            <div className="iv-cap no-print">{isSale ? 'Bill to' : 'Supplier'}</div>
            <div className="iv-pname"><span className="print-inline">{partyLabel}: </span><b>{d.party_name}</b></div>
            {d.party_address && <div className="iv-line"><span className="print-inline">Address: </span>{d.party_address}</div>}
            {d.party_contact && <div className="iv-line">Contact person: <b>{d.party_contact}</b></div>}
            {partyPhones(d) && <div className="iv-line">{partyPhones(d)}</div>}
            <div className="iv-line">{partyLabel}'s PAN: <b>{d.party_pan || '—'}</b></div>
            {d.supplier_bill_no && <div className="iv-line">Supplier bill no: <b>{d.supplier_bill_no}</b>{d.supplier_bill_date && ` (${fmtBs(d.supplier_bill_date)})`}</div>}
          </div>
          <div className="r iv-info">
            <div className="iv-cap no-print">{meta.role === 'bill' && isSale ? 'Invoice' : meta.name} details</div>
            <div className="kv"><span>{meta.role === 'bill' && isSale ? 'Invoice' : meta.name} No:</span> <b className="mono">{d.doc_no}</b></div>
            <div className="kv"><span>Date:</span> <b>{fmtBs(d.doc_date)} <span className="iv-sep">|</span> {fmtAd(d.doc_date)}</b></div>
            {(d.challan_no || d.vat_bill_no) && (
              <div className="kv"><span>Challan No.:</span> <b>{d.challan_no || '—'} <span className="iv-sep">|</span> VAT Bill: {d.vat_bill_no || '—'}</b></div>
            )}
            {d.ref_doc_no && <div className="kv"><span>{meta.role === 'return' ? 'Against' : 'Order'}:</span> <b>{d.ref_doc_no}</b></div>}
            {d.due_date && d.payment_mode === 'credit' && <div className="kv due"><span>Due date:</span> <b>{fmtBs(d.due_date)}</b></div>}
          </div>
        </div>
        <table className="grid inv">
          <thead><tr><th className="sn">SN</th><th>Particulars</th><th>HS Code</th><th className="num">Qty</th><th>Unit</th><th className="num">Rate</th>
            <th className="num">Disc.</th><th className="num">Amount</th></tr></thead>
          <tbody>
            {d.lines.map((l, i) => (
              <tr key={l.id}>
                <td className="sn">{i + 1}</td>
                <td>
                  {l.item}{!l.vat_applicable && d.vat > 0 && <small className="muted"> (exempt)</small>}
                  {l.serials.length > 0 && <div className="inv-sub iv-sn">S/N: {l.serials.join(', ')}</div>}
                  {l.warranty_until && <div className="inv-sub iv-wty">Warranty {l.warranty_months} months — till {fmtBs(l.warranty_until)} ({fmtAd(l.warranty_until)})</div>}
                  {l.service_to && <div className="inv-sub">Service period {fmtBs(l.service_from)} to <b>{fmtBs(l.service_to)}</b></div>}
                </td>
                <td>{l.hs_code}</td><td className="num">{l.qty}</td><td>{l.unit}</td>
                <td className="num">{fmtMoney(l.rate_excl)}</td><td className="num">{l.discount ? fmtMoney(l.discount) : ''}</td>
                <td className="num">{fmtMoney(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="inv-foot">
          <div className="words">
            <div className="iv-words"><i>In words:</i> {amountInWords(d.total)}</div>
            {d.narration && <div className="iv-remarks"><span className="iv-rl">Remarks:</span> {d.narration}</div>}
            <div className="iv-txn">
              <div className="iv-cap">Transaction details</div>
              <div className="kv"><span>Payment:</span> <b className={`iv-pay pay-${d.payment_mode}`}>
                {d.payment_mode === 'cash' || d.payment_mode === 'bank' ? `${payLabel(d.payment_mode)} — ${d.cash_account || ''}` : payLabel(d.payment_mode)}</b></div>
              {d.payment_mode === 'cheque' && <div className="kv"><span>Cheque:</span> <b>{d.cheque_no} · {d.cheque_bank} · {fmtBs(d.cheque_date)}</b></div>}
              {d.payment_mode === 'bank' && d.txn_id && <div className="kv"><span>Trans. ID:</span> <b>{d.txn_id}</b></div>}
              {['cash', 'bank', 'cheque'].includes(d.payment_mode) && d.paid_amount != null && d.total - d.paid_amount > 0.005 && <>
                <div className="kv"><span>{isSale ? 'Received:' : 'Paid:'}</span> <b>Rs.{fmtMoney(d.paid_amount)}</b></div>
                <div className="kv"><span>Balance due:</span> <b>Rs.{fmtMoney(d.total - d.paid_amount)}</b></div>
              </>}
              {(d.transport_name || d.transport_bill_no) && (
                <div className="kv"><span>Via Transport:</span> <b>{d.transport_name || '—'}{d.transport_bill_no ? ` · Bill No. ${d.transport_bill_no}` : ''}</b></div>
              )}
              {d.pay_voucher_no && d.pay_voucher_status !== 'cancelled' && (
                <div className="kv no-print"><span>{['SI', 'PR'].includes(d.doc_type) ? 'Receipt' : 'Payment'} voucher:</span> <b className="mono">{d.pay_voucher_no}</b></div>
              )}
              {d.cheque && d.cheque.status !== 'cancelled' && (
                <div className="kv no-print"><span>Cheque status:</span>
                  <b className={`tag pdc-st-${d.cheque.status}`}>{d.cheque.status === 'pending' ? 'Post-dated — not deposited'
                    : d.cheque.status === 'cleared' ? `Deposited ${fmtBs(d.cheque.cleared_date)} · ${d.cheque.voucher_no}` : 'Bounced'}</b></div>
              )}
              {d.pay_proof && <div className="kv no-print"><span>Voucher:</span><a href={`/api/accounts/docs/${d.id}/proof`} target="_blank" rel="noopener">📎 Payment voucher</a></div>}
              {d.followup_user && <div className="kv no-print"><span>Follow-up:</span><b className="small">{d.followup_user} · {fmtBs(d.followup_date)}</b></div>}
            </div>
          </div>
          <table className="totals">
            <tbody>
              <tr className="t-gross"><td>Gross Amount</td><td className="num">{fmtMoney(d.gross)}</td></tr>
              {d.discount > 0 && <tr><td>Discount</td><td className="num">{fmtMoney(d.discount)}</td></tr>}
              {d.exempt > 0 && <tr><td>Non-taxable amount</td><td className="num">{fmtMoney(d.exempt)}</td></tr>}
              {/* taxable only when it differs from gross (discount or VAT-exempt items) */}
              {Math.abs(d.taxable - d.gross) > 0.005 && <tr><td>Taxable amount</td><td className="num">{fmtMoney(d.taxable)}</td></tr>}
              <tr className="t-vat"><td>VAT {company.vat_rate}%</td><td className="num">{fmtMoney(d.vat)}</td></tr>
              <tr className="grand"><td>Grand Total</td><td className="num">{fmtMoney(d.total)}</td></tr>
            </tbody>
          </table>
        </div>
        <div className="signs"><span>Prepared by: {d.created_by}</span><span>Received by</span><span>Authorised signature</span></div>
        <div className="printed small muted">Printed {new Date().toLocaleString()} {d.voucher_no ? `· Voucher ${d.voucher_no}` : ''}</div>
        </div>

        <div className="last-saved iv-audit no-print">
          <span>📝 Entered by <b>{d.created_by}</b> · {fmtStamp(d.created_at)}</span>
          {d.updated_by && <span>✏️ Last edited by <b>{d.updated_by}</b> · {fmtStamp(d.updated_at)} ({d.edit_count}×)</span>}
          {d.cancelled_by && <span>⛔ Cancelled by <b>{d.cancelled_by}</b> · {fmtStamp(d.cancelled_at)}</span>}
          {d.print_count > 0 && <span>🖨 Printed {d.print_count}×</span>}
        </div>
        {d.notifications?.length > 0 && (
          <div className="notif-log no-print">
            {d.notifications.slice(0, 4).map((n) => (
              <div key={n.id} className={n.status === 'sent' ? 'pos' : 'neg'}>
                {n.channel === 'email' ? '✉' : '🟢'} {n.status} to {n.recipient || '—'} · {fmtStamp(n.at)} by {n.created_by}{n.error && ` — ${n.error}`}
              </div>
            ))}
          </div>
        )}

      </div>
      {popOpen && <TaskPopup doc={d} tasks={linkedTasks} onClose={() => setPopOpen(false)} />}
      {taskOpen && <TaskDialog doc={d} onSkip={() => setTaskOpen(false)} onDone={(nd) => { setTaskOpen(false); setD(nd); onChanged?.(nd); }} />}
      {delOpen && (
        <DeleteDialog what={d.doc_no} url={`/docs/${d.id}/delete`} onClose={() => setDelOpen(false)}
          onDone={async (r) => { setDelOpen(false); if (r.deleted) { onChanged?.(null); onClose(); } else setD(await api.get(`/docs/${d.id}`)); }} />
      )}
    </div>
  );
}
