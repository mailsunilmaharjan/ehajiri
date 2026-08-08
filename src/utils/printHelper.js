/**
 * Shared print & Excel helper for all attendance reports.
 * Provides consistent company header, footer, and CSS across every report.
 */

/* ── CSS injected into every print window ──────────────────── */
export function getPrintCSS(isLandscape = false) {
  return `
    @page { size: A4 ${isLandscape ? 'landscape' : 'portrait'}; margin: 8mm; }
    * { -webkit-print-color-adjust:exact; print-color-adjust:exact; box-sizing:border-box; }
    body { font-family:Arial,Helvetica,sans-serif; font-size:10px; margin:0; padding:0; }

    /* Header: logo left, info centred, spacer balances */
    .print-header {
      display:grid; grid-template-columns:48px 1fr 48px;
      align-items:center; gap:0;
      margin-bottom:8px; padding-bottom:8px; border-bottom:2px solid #374151;
    }
    .ph-logo  { grid-column:1; align-self:flex-start; }
    .ph-info  { grid-column:2; text-align:center; }
    .ph-space { grid-column:3; }
    .ph-info .co-name   { font-size:15px; font-weight:800; color:#1f2937; margin-bottom:2px; }
    .ph-info .co-sub    { font-size:10px; color:#6b7280; margin-bottom:4px; }
    .ph-info .rpt-title { font-size:13px; font-weight:800; color:#1e40af; }
    .ph-info .rpt-sub   { font-size:11px; color:#374151; font-weight:600; margin:2px 0; }

    /* Footer */
    .print-footer { margin-top:36px; display:flex; justify-content:space-between; gap:24px; }
    .pf-col       { flex:1; text-align:center; }
    .pf-line      { border-bottom:1.5px dotted #374151; height:28px; margin-bottom:6px; }
    .pf-label     { font-size:11px; font-weight:700; color:#374151; }

    /* Summary bar */
    .summary-bar { font-size:10px; padding:4px 8px; background:#f9fafb;
                   border:1px solid #e5e7eb; border-radius:4px; margin-bottom:6px; }

    /* Table defaults */
    table { border-collapse:collapse; width:100%; }
    th { background:#efefef; color:#374151; font-weight:700;
         padding:5px 7px; border:1px solid #dedede; text-align:center; white-space:nowrap; }
    td { vertical-align:middle; }
  `;
}

/* ── Company header HTML ──────────────────────────────────────── */
export function getHeaderHtml(settings, language, reportTitle, reportSub = '') {
  const name = language === 'np'
    ? (settings.companyNameNp    || settings.companyNameEn    || '')
    : (settings.companyNameEn    || settings.companyNameNp    || '');
  const addr = language === 'np'
    ? (settings.companyAddressNp || settings.companyAddressEn || '')
    : (settings.companyAddressEn || settings.companyAddressNp || '');
  const phone = settings.companyPhone ? ` · Tel: ${settings.companyPhone}` : '';
  const logoTag = settings.companyLogo
    ? `<img src="${settings.companyLogo}" style="height:40px;object-fit:contain;" />`
    : '';
  return `
<div class="print-header">
  <div class="ph-logo">${logoTag}</div>
  <div class="ph-info">
    <div class="co-name">${name}</div>
    <div class="co-sub">${addr}${phone}</div>
    <div class="rpt-title">${reportTitle}</div>
    ${reportSub ? `<div class="rpt-sub">${reportSub}</div>` : ''}
  </div>
  <div class="ph-space"></div>
</div>`;
}

/* ── Signature footer HTML ──────────────────────────────────── */
export function getFooterHtml() {
  return `
<div class="print-footer">
  <div class="pf-col"><div class="pf-line"></div><div class="pf-label">Prepared by</div></div>
  <div class="pf-col"><div class="pf-line"></div><div class="pf-label">Recommend By</div></div>
  <div class="pf-col"><div class="pf-line"></div><div class="pf-label">Approved by</div></div>
</div>`;
}

/* ── Full print document builder ─────────────────────────────── */
export function buildPrintDoc({ settings, language, reportTitle, reportSub = '',
  contentHtml, isLandscape = false, extraStyle = '' }) {
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8"><title>${reportTitle}</title>
<style>${getPrintCSS(isLandscape)}${extraStyle}</style>
</head><body>
${getHeaderHtml(settings, language, reportTitle, reportSub)}
${contentHtml}
${getFooterHtml()}
<script>window.onload=function(){window.focus();window.print();setTimeout(()=>window.close(),1000);}</script>
</body></html>`;
}

/* ── Open in a new window and print ─────────────────────────── */
export function openPrintWindow(htmlDoc, landscape = false) {
  const w = window.open('', '_blank',
    `width=${landscape ? 1300 : 900},height=${landscape ? 900 : 1200},scrollbars=yes`);
  if (w) { w.document.write(htmlDoc); w.document.close(); }
}

/* ── Excel (CSV) header rows ─────────────────────────────────── */
export function getExcelHeaderRows(settings, language, reportTitle, reportSub = '', summaryLine = '') {
  const name = language === 'np'
    ? (settings.companyNameNp    || settings.companyNameEn    || '')
    : (settings.companyNameEn    || settings.companyNameNp    || '');
  const addr = language === 'np'
    ? (settings.companyAddressNp || settings.companyAddressEn || '')
    : (settings.companyAddressEn || settings.companyAddressNp || '');
  const phone = settings.companyPhone ? ` | Tel: ${settings.companyPhone}` : '';
  const rows = [
    `"${name}"`,
    `"${addr}${phone}"`,
    `"${reportTitle}"`,
    reportSub   ? `"${reportSub}"`   : null,
    summaryLine ? `"${summaryLine}"` : null,
    '""',   // blank separator row
  ];
  return rows.filter(Boolean).join('\n') + '\n';
}

/* ── Trigger CSV download ────────────────────────────────────── */
export function downloadCSV(csvContent, filename) {
  const BOM  = '﻿';
  const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}
