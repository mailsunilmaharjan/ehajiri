import { cloneElement, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from '../lib/router';
import { useApp } from '../context';
import { ReportButtons, ReportHeader } from '../components/Report';
import { AccountSelect, PeriodBar } from '../components/inputs';
import { RemarksRow, UpdatedBy, useGrid } from '../components/DataGrid';
import DocView from '../components/DocView';
import VoucherView from '../components/VoucherView';
import { authFetch, api, fmtBal, fmtMoney, waLink } from '../lib/api';
import { fmtAd, fmtBs, fmtSaved } from '../lib/dates';

const BILL_TITLE = { SI: 'Sales Invoice', SR: 'Sales Return', PB: 'Purchase Bill', PR: 'Purchase Return' };

/** Challan No. / VAT Bill (sales) or Supplier Bill No. (purchase) shown in Particulars. */
function BillRefs({ r, inTitle = false }) {
  // inTitle: Detail View already shows VAT Bill / Supplier Bill in the bill title, so only Challan No. is left here
  const b = r.bill;
  if (!b || r.memo) return null;
  const sales = b.doc_type === 'SI' || b.doc_type === 'SR';
  if (inTitle && !sales) return null;
  return (
    <span className="ld-refs">
      {sales ? <>
        <span className="ld-ref">Challan No.: <b>{b.challan_no || '—'}</b></span>
        {!inTitle && <span className="ld-ref vat">VAT Bill: <b>{b.vat_bill_no || '—'}</b></span>}
      </> : b.supplier_bill_no && <span className="ld-ref">Supplier Bill No.: <b>{b.supplier_bill_no}</b></span>}
    </span>
  );
}

export default function Ledger() {
  const { fy, today, accounts, company, notify, canEdit } = useApp();
  const [sp, setSp] = useSearchParams();
  const accountId = Number(sp.get('account')) || null;
  // a party that is both customer and supplier: one combined statement by default (switch off to see just this ledger)
  const combined = sp.get('combined') !== '0';
  const [from, setFrom] = useState(sp.get('from') || fy.start_date);
  const [to, setTo] = useState(sp.get('to') || today);
  const [data, setData] = useState(null);
  const [doc, setDoc] = useState(null);         // bill opened from a ledger row
  const [vch, setVch] = useState(null);         // voucher opened from a ledger row
  const [busy, setBusy] = useState('');
  // Summarized = one line per voucher; Detail = product lines + bill totals under each bill (remembered per browser)
  const [view, setView] = useState(() => { try { return localStorage.getItem('ledgerView') || 'summary'; } catch { return 'summary'; } });
  const pickView = (v) => { setView(v); try { localStorage.setItem('ledgerView', v); } catch { /* private mode */ } };
  const detail = view === 'detail';
  const area = useRef(null);
  const lrows = useMemo(() => (data?.rows || []).map((r, i) => ({ ...r, _k: i })), [data]);
  const g = useGrid({ rows: lrows, getId: (r) => r._k, onOpen: (r) => openRow(r) });
  const curRow = g.curRow;
  const COLS = detail ? 12 : 9;
  const sign = (r) => (r.vtype === 'SR' || r.vtype === 'PR' ? -1 : 1);
  const billSum = (k) => lrows.reduce((s, r) => s + (r.bill ? sign(r) * (k === 'taxable' ? r.bill.taxable + r.bill.exempt : r.bill.vat) : 0), 0);
  const amt = (n) => (n ? fmtMoney(n) : '');

  /** Detail View: one voucher = a heading row, a row per product and a bold bill-total row; Debit/Credit/Balance span them all. */
  const detailRows = (r, i) => {
    const items = r.items || [];
    const span = items.length ? items.length + 2 : 1;
    const gp = g.rowProps(r, `ld-grp ${r.memo ? `pdc-memo pdc-${r.cheque_status}` : ''}`);
    const rp = (extra, k) => ({ ...gp, key: `${r._k}${k}`, className: `${gp.className} ${extra}` });
    // bills: "Sales Invoice  VAT Bill: 009" (the voucher no. is already in its own column)
    const b = r.bill;
    const billNo = b && (b.doc_type === 'SI' || b.doc_type === 'SR')
      ? <span className="ld-billno">VAT Bill: <b>{b.vat_bill_no || '—'}</b></span>
      : b?.supplier_bill_no ? <span className="ld-billno">Supplier Bill: <b>{b.supplier_bill_no}</b></span> : null;
    const title = r.memo ? 'Post-dated Cheque'
      : b ? <>{BILL_TITLE[r.vtype] || r.day_type}{billNo}</> : `${r.day_type} ${r.voucher_no}`;
    const out = [
      <tr {...rp(`ld-head ${items.length ? '' : 'ld-end'}`, 'h')}>
        {cloneElement(g.tickTd(r), { rowSpan: span, className: 'sel ld-span' })}
        <td className="sn ld-span" rowSpan={span}>{i + 1}</td>
        <td className="nowrap ld-top ld-span" rowSpan={span}>{fmtBs(r.vdate)}<div className="ld-ad">{fmtAd(r.vdate)}</div></td>
        <td className="nowrap ld-top ld-span" rowSpan={span}>
          <a className="vno" onClick={() => openRow(r)}>{r.voucher_no}</a>
          <div><span className={`vt-chip vt-${r.vtype}`}>{r.day_type}</span></div>
          <BillRefs r={r} inTitle />
        </td>
        <td>
          <div className="ld-title">{title}</div>
          {/* bills: the product lines say it all; other vouchers still show the other account */}
          {r.memo ? <div className="ld-line">🧾 {r.particulars}</div>
            : !items.length && <div className="ld-sub">{r.dr > 0 ? 'By ' : 'To '}{r.particulars}</div>}
          {!items.length && r.narration && !r.memo && <div className="ld-line">• {r.narration}</div>}
        </td>
        <td /><td /><td /><td />
        <td className={`num ld-amt ld-span ${items.length ? 'ld-bottom' : ''}`} rowSpan={span}>{amt(r.dr)}</td>
        <td className={`num ld-amt ld-span ${items.length ? 'ld-bottom' : ''}`} rowSpan={span}>{amt(r.cr)}</td>
        <td className={`num ld-bal ld-span ${items.length ? 'ld-bottom' : ''}`} rowSpan={span}>{fmtBal(r.balance)}</td>
      </tr>,
    ];
    items.forEach((it, k) => out.push(
      <tr {...rp('ld-item', `i${k}`)}>
        <td className="ld-prod"><span className="ld-dot">•</span>{it.item}{it.discount ? <span className="ld-disc">disc. {fmtMoney(it.discount)}</span> : null}
          {it.serials && <div className="ld-serials"><span>S/N:</span> {it.serials}</div>}</td>
        <td className="num nowrap">{it.qty} <span className="ld-unit">{it.unit}</span></td>
        <td className="num">{fmtMoney(it.rate)}</td>
        <td className="num">{fmtMoney(it.amount)}</td>
        <td className="num">{amt(it.vat)}</td>
      </tr>,
    ));
    if (items.length && r.bill) out.push(
      <tr {...rp('ld-subtotal ld-end', 's')}>
        <td className="ld-sublabel">Bill total{r.bill.discount > 0 && <span className="ld-disc">after discount {fmtMoney(r.bill.discount)}</span>}</td>
        <td /><td />
        <td className="num ld-tax">{fmtMoney(r.bill.taxable + r.bill.exempt)}</td>
        <td className="num ld-vat">{fmtMoney(r.bill.vat)}</td>
      </tr>,
    );
    return out;
  };

  const load = () => {
    if (!accountId) { setData(null); return; }
    api.get('/reports/ledger', { account_id: accountId, date_from: from, date_to: to, combined }).then(setData);
  };
  useEffect(load, [accountId, from, to, combined]);
  // A party that is both customer and supplier has two ledgers — show the other one and the net position
  const [both, setBoth] = useState(null);
  useEffect(() => {
    setBoth(null);
    const acc = accounts.find((a) => a.id === accountId);
    if (!acc?.linked_party_id) return;
    api.get(`/parties/${accountId}`).then((p) => setBoth({ other: accounts.find((a) => a.id === p.linked_party_id), own: p.balance, linked: p.linked_balance, type: p.party_type })).catch(() => {});
  }, [accountId, accounts, data]);

  const openRow = async (r) => {
    try {
      // bills (and cheque memo lines) open the bill; receipts / payments — even auto ones from a bill — open the voucher
      if (r.voucher_id && !['PB', 'PR', 'SI', 'SR'].includes(r.vtype)) setVch(await api.get(`/vouchers/${r.voucher_id}`));
      else if (r.source_doc_id) setDoc(await api.get(`/docs/${r.source_doc_id}`));
      else if (r.voucher_id) setVch(await api.get(`/vouchers/${r.voucher_id}`));
    } catch (e) { notify(e.message, 'err'); }
  };

  const params = () => new URLSearchParams({ account_id: accountId, date_from: from, date_to: to, detail, combined }).toString();
  const pdfFile = async () => {
    const res = await authFetch(`/reports/ledger/pdf?${params()}`);
    if (!res.ok) throw new Error('Could not make the PDF.');
    const name = (res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'Ledger.pdf';
    return new File([await res.blob()], name, { type: 'application/pdf' });
  };
  const download = (file) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file); a.download = file.name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  const party = data?.account;
  const msg = () => `Namaste ${party.name},\nPlease find your ledger statement from ${company.name} for ${fmtBs(from)} to ${fmtBs(to)}.\n`
    + `Closing balance: Rs ${fmtMoney(Math.abs(data.closing))} ${data.closing > 0 ? 'Dr (receivable)' : data.closing < 0 ? 'Cr (payable)' : ''}`;

  const emailPdf = async () => {
    const to_ = prompt('Send the ledger PDF to this email:', party.email || '');
    if (to_ === null) return;
    setBusy('email');
    try { const r = await api.post('/reports/ledger/email', { account_id: accountId, date_from: from, date_to: to, to: to_, detail, combined }); notify(`Ledger PDF emailed to ${r.to}`); }
    catch (e) { notify(e.message, 'err'); }
    setBusy('');
  };
  const whatsappPdf = async () => {
    setBusy('wa');
    try {
      const file = await pdfFile();
      if (navigator.canShare?.({ files: [file] })) {
        // Windows / Android share sheet → pick WhatsApp; the PDF goes as an attachment
        await navigator.share({ files: [file], title: file.name, text: msg() });
      } else {
        download(file);
        window.open(waLink(party.whatsapp || party.phone, `${msg()}\n(PDF attached)`), '_blank', 'noopener');
        notify('PDF downloaded — attach it in the WhatsApp chat that just opened.');
      }
    } catch (e) { if (e.name !== 'AbortError') notify(e.message, 'err'); }
    setBusy('');
  };
  const pdfDownload = async () => {
    setBusy('pdf');
    try { download(await pdfFile()); } catch (e) { notify(e.message, 'err'); }
    setBusy('');
  };

  return (
    <>
      <header className="page-head"><h1>Ledger Statement</h1>
        <span className="spacer" />
        <span className="view-toggle" role="group" aria-label="Ledger view">
          <button type="button" className={detail ? '' : 'on'} onClick={() => pickView('summary')} title="One line per voucher">☰ Summarized</button>
          <button type="button" className={detail ? 'on' : ''} onClick={() => pickView('detail')} title="Product lines and bill totals under each bill">▤ Detail View</button>
        </span>
      </header>
      <PeriodBar from={from} to={to} fy={fy} onChange={(f, t) => { setFrom(f); setTo(t); }}>
        <div className="ledger-search" data-find title="Ctrl+F">
          <AccountSelect autoFocus accounts={accounts} value={accountId} onChange={(id) => setSp({ account: id })} placeholder="Search / choose a ledger…"
            filter={(a) => !(combined && a.linked_party_id && a.party_type === 'supplier')} />
        </div>
        <span className="spacer" />
        {data && (
          <ReportButtons areaRef={area} title="Ledger" subtitle={data.account.name} from={from} to={to}
            busy={busy} onEmail={canEdit ? emailPdf : undefined} onWhatsApp={whatsappPdf} onPdf={pdfDownload} />
        )}
      </PeriodBar>
      {data && both?.other && (
        <div className="toolbar" style={{ marginBottom: 8, flexWrap: 'wrap', gap: 10 }}>
          <label className="check"><input type="checkbox" checked={combined} onChange={(e) => setSp({ account: accountId, ...(e.target.checked ? {} : { combined: '0' }) })} /> <b>Combined statement</b> — customer + supplier of the same party in one ledger</label>
          <span className="muted">Receivable {fmtBal(both.type === 'customer' ? both.own : both.linked)} · Payable {fmtBal(both.type === 'customer' ? both.linked : both.own)} · Net <b>{fmtBal(Number(both.own) + Number(both.linked))}</b></span>
          {!combined && <button type="button" className="ghost" onClick={() => setSp({ account: both.other.id, combined: '0' })}>Open {both.type === 'customer' ? 'supplier' : 'customer'} ledger →</button>}
        </div>
      )}
      {data && (
        <section className="card print-area" ref={area}>
          <ReportHeader title="Ledger" subtitle={`${data.account.name} (${data.account.group_name})`} from={from} to={to} />
          <table ref={g.gridRef} className={`grid ledger-grid dg-soft ${detail ? 'ledger-detail' : ''}`}>
            {detail ? (
              <thead><tr>{g.tickTh}<th className="sn">SN</th><th className="nowrap" style={{ width: 120 }}>Miti | Date</th><th style={{ width: 150 }}>Voucher / Bill No.</th>
                <th>Particulars &amp; Product Details</th><th className="num" style={{ width: 70 }}>Qty</th><th className="num" style={{ width: 100 }}>Rate (Rs.)</th>
                <th className="num" style={{ width: 115 }}>Taxable (Rs.)</th><th className="num" style={{ width: 105 }}>VAT {company.vat_rate}% (Rs.)</th>
                <th className="num" style={{ width: 115 }}>Debit</th><th className="num" style={{ width: 115 }}>Credit</th><th className="num" style={{ width: 130 }}>Balance</th></tr></thead>
            ) : (
              <thead><tr>{g.tickTh}<th className="sn">SN</th><th className="nowrap" style={{ width: 200 }}>Miti | Date</th><th style={{ width: 150 }}>Voucher No.</th><th style={{ width: 150 }}>Voucher Type</th><th>Particulars</th>
                <th className="num" style={{ width: 120 }}>Debit</th><th className="num" style={{ width: 120 }}>Credit</th><th className="num" style={{ width: 140 }}>Balance</th></tr></thead>
            )}
            <tbody>
              <tr className="sub"><td className="sel" /><td className="sn" /><td colSpan={COLS - 3}>Opening balance</td><td className="num">{fmtBal(data.opening)}</td></tr>
              {detail ? lrows.map((r, i) => detailRows(r, i)) : lrows.map((r, i) => (
                <tr key={r._k} {...g.rowProps(r, r.memo ? `pdc-memo pdc-${r.cheque_status}` : '')}>
                  {g.tickTd(r)}
                  <td className="sn">{i + 1}</td>
                  <td className="nowrap">{fmtBs(r.vdate)}<span className="dl-sep">|</span>{fmtAd(r.vdate)}</td>
                  <td className="nowrap"><a className="vno" title={r.memo ? 'Post-dated cheque — open the bill' : r.source_doc_id ? 'Open' : 'Open the voucher'} onClick={() => openRow(r)}>{r.voucher_no}</a></td>
                  <td className="nowrap"><span className={`vt-chip vt-${r.vtype}`}>{r.day_type}</span></td>
                  <td>
                    {r.memo ? <span className="pdc-text">🧾 {r.particulars}</span> : <>{r.dr > 0 ? 'By ' : 'To '}{r.particulars}</>}
                    <BillRefs r={r} />
                    {/* narration sits in the remarks box on screen; on paper it stays under the line */}
                    {r.narration && !r.memo && <div className="muted small print-only">{r.narration}</div>}
                  </td>
                  <td className="num">{r.dr ? fmtMoney(r.dr) : ''}</td>
                  <td className="num">{r.cr ? fmtMoney(r.cr) : ''}</td>
                  <td className="num">{fmtBal(r.balance)}</td>
                </tr>
              ))}
              {g.blankRows(COLS)}
              {!detail && <RemarksRow g={g} cols={COLS} empty="Click a row to see its narration."
                right={curRow && <UpdatedBy name={curRow.saved_by_name} when={fmtSaved(curRow.updated_at || curRow.created_at)} />}>
                {curRow && <>
                  <div><b>Narration — {curRow.voucher_no}:</b> {curRow.narration || <span className="muted">no narration</span>}</div>
                  <div className="rm-pay"><b>Voucher Type:</b> {curRow.day_type}
                    {curRow.reference && <> · <b>Ref.</b> {curRow.reference}</>}
                    {curRow.note && <> · <b>Note</b> {curRow.note}</>}</div>
                </>}
              </RemarksRow>}
            </tbody>
            <tfoot>
              {detail ? (
                <tr><th colSpan={7}>Period total</th><th className="num ld-tax">{fmtMoney(billSum('taxable'))}</th><th className="num ld-vat">{fmtMoney(billSum('vat'))}</th>
                  <th className="num">{fmtMoney(data.total_dr)}</th><th className="num">{fmtMoney(data.total_cr)}</th><th /></tr>
              ) : (
                <tr><th colSpan={6}>Period total</th><th className="num">{fmtMoney(data.total_dr)}</th><th className="num">{fmtMoney(data.total_cr)}</th><th /></tr>
              )}
              <tr><th colSpan={COLS - 1}>Closing balance</th><th className="num">{fmtBal(data.closing)}</th></tr>
            </tfoot>
          </table>
        </section>
      )}
      {!accountId && <p className="muted">Choose a ledger to see its statement.</p>}
      {doc && <DocView doc={doc} onClose={() => setDoc(null)} onChanged={() => load()} />}
      {vch && <VoucherView v={vch} onClose={() => setVch(null)} onChanged={(v) => { setVch(v); load(); }} />}
    </>
  );
}
