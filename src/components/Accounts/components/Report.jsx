import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context';
import { IcoExport, IcoMail, IcoPrint, IcoWhatsApp } from './ToolIcons';
import { fmtDate } from '../lib/dates';
import { exportTable } from '../lib/xlsxStyled';

/** Company + report title: appears only on paper (print) and in the Excel export, never on screen. */
export function ReportHeader({ title, subtitle, from, to }) {
  const { company } = useApp();
  return (
    <div className="report-title print-only">
      <b>{company.name}</b>
      {(company.address || company.pan) && <div className="small">{[company.address, company.pan && `PAN: ${company.pan}`].filter(Boolean).join(' · ')}</div>}
      <div className="rt-title">{title}{subtitle && <>: <b>{subtitle}</b></>}</div>
      {from && <small>{fmtDate(from)} to {fmtDate(to)}</small>}
    </div>
  );
}

/** Print + Export to Excel (with the same company header on top). `areaRef` points at the element holding the table. */
// Same look as the Sales Invoice toolbar: one joined group  ✉ Send Email | WhatsApp | Print | Export ▾ (PDF / Excel).
// onEmail / onWhatsApp / onPdf are optional — pages that can't send just get Print + Export.
export function ReportButtons({ areaRef, title, subtitle, from, to, file, onEmail, onWhatsApp, onPdf, busy = '' }) {
  const { company, notify } = useApp();
  const [expOpen, setExpOpen] = useState(false);
  const expRef = useRef(null);
  useEffect(() => {
    if (!expOpen) return undefined;
    const close = (e) => expRef.current && !expRef.current.contains(e.target) && setExpOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [expOpen]);
  const exportXlsx = async () => {
    const table = areaRef.current?.querySelector('table');
    if (!table) return;
    try {
      const head = [[company.name], [[company.address, company.pan && `PAN: ${company.pan}`].filter(Boolean).join(' · ')],
        [`${title}${subtitle ? `: ${subtitle}` : ''}`], ...(from ? [[`${fmtDate(from)} to ${fmtDate(to)}`]] : [])];
      await exportTable({ table, head, sheetName: title,
        file: `${(file || `${title}${subtitle ? `-${subtitle}` : ''}`).replace(/[^\w-]+/g, '_')}.xlsx` });
    } catch (e) { notify(`Export failed: ${e.message}`, 'err'); }
  };
  return (
    <span className="tb-group rpt-tools no-print">
      {onEmail && <button type="button" disabled={!!busy} onClick={onEmail}><IcoMail /> {busy === 'email' ? 'Sending…' : 'Send Email'}</button>}
      {onWhatsApp && <button type="button" disabled={!!busy} onClick={onWhatsApp}><IcoWhatsApp /> {busy === 'wa' ? 'Preparing…' : 'WhatsApp'}</button>}
      <button type="button" onClick={() => window.print()}><IcoPrint /> Print</button>
      <span className="comm-export" ref={expRef}>
        <button type="button" disabled={busy === 'pdf'} onClick={() => setExpOpen((x) => !x)}><IcoExport /> {busy === 'pdf' ? 'Preparing…' : 'Export ▾'}</button>
        {expOpen && (
          <span className="comm-menu">
            {onPdf && <button type="button" onClick={() => { setExpOpen(false); onPdf(); }}>📄 PDF</button>}
            <button type="button" onClick={() => { setExpOpen(false); exportXlsx(); }}>📊 Excel</button>
          </span>
        )}
      </span>
    </span>
  );
}
