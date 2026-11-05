import React from 'react';
import { money } from './payrollUi.jsx';

/* Read-only payslip (used by Payroll Runs and My Payslips). `slip` is the object from GET .../slips/:id. */
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function payslipHtml(slip) {
  const e = slip.employee, row = (l) => `<tr><td>${esc(l.name)}</td><td style="text-align:right">${money(l.amount)}</td></tr>`;
  const earn = slip.lines.filter(l => l.kind === 'earning'), ded = slip.lines.filter(l => l.kind === 'deduction'), er = slip.lines.filter(l => l.kind === 'employer');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Payslip - ${esc(e.name)}</title>
  <style>body{font-family:Arial,sans-serif;font-size:12px;color:#111;margin:24px}h2{margin:0 0 4px}table{width:100%;border-collapse:collapse}
  td,th{border:1px solid #ccc;padding:5px 8px}th{background:#efefef;text-align:left}.meta td{border:none;padding:2px 8px 2px 0}.tot td{font-weight:700;background:#f1f5f9}
  .net{margin-top:12px;padding:10px;border:2px solid #111;font-size:15px;font-weight:700;display:flex;justify-content:space-between}</style></head><body>
  <h2>Payslip - ${esc(slip.run.label)}</h2><div>${esc(slip.run.periodStart)} to ${esc(slip.run.periodEnd)}</div><br>
  <table class="meta"><tr><td><b>Employee</b></td><td>${esc(e.name)} ${e.code ? '(' + esc(e.code) + ')' : ''}</td><td><b>Department</b></td><td>${esc(e.department)}</td></tr>
  <tr><td><b>Designation</b></td><td>${esc(e.position)}</td><td><b>Branch</b></td><td>${esc(e.branch)}</td></tr>
  <tr><td><b>PAN</b></td><td>${esc(e.pan)}</td><td><b>Bank</b></td><td>${esc(e.bankName)} ${esc(e.bankAccount)}</td></tr>
  <tr><td><b>Days</b></td><td colspan="3">Payable ${slip.days.payable} of ${slip.days.base} (absent ${slip.days.absent}, unpaid leave ${slip.days.unpaidLeave})</td></tr></table><br>
  <table><tr><th>Earnings</th><th style="text-align:right">Amount</th></tr>${earn.map(row).join('')}<tr class="tot"><td>Gross</td><td style="text-align:right">${money(slip.gross)}</td></tr></table><br>
  <table><tr><th>Deductions</th><th style="text-align:right">Amount</th></tr>${ded.map(row).join('')}<tr class="tot"><td>Total deductions</td><td style="text-align:right">${money(slip.totalDeductions)}</td></tr></table>
  ${er.length ? `<br><table><tr><th>Employer contributions (not deducted)</th><th style="text-align:right">Amount</th></tr>${er.map(row).join('')}</table>` : ''}
  <div class="net"><span>Net pay</span><span>${money(slip.net)}</span></div></body></html>`;
}

export function printPayslip(slip) {
  const w = window.open('', '_blank', 'width=820,height=900');
  if (!w) return;
  w.document.write(payslipHtml(slip)); w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
}

const Block = ({ title, lines, total, totalLabel, color }) => (
  <div style={{ flex: 1, minWidth: 260 }}>
    <div style={{ background: '#efefef', color: '#374151', fontWeight: 700, fontSize: 12, padding: '7px 10px', borderBottom: '2px solid #dedede' }}>{title}</div>
    {lines.map((l, i) => (
      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', fontSize: 13, borderBottom: '1px solid #f1f5f9' }}>
        <span>{l.name}</span><span>{money(l.amount)}</span>
      </div>
    ))}
    {total != null && (
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 10px', fontSize: 13, fontWeight: 700, background: '#f1f5f9', borderTop: '2px solid #d1d5db', color }}>
        <span>{totalLabel}</span><span>{money(total)}</span>
      </div>
    )}
  </div>
);

export default function PayslipView({ slip }) {
  const earn = slip.lines.filter(l => l.kind === 'earning'), ded = slip.lines.filter(l => l.kind === 'deduction'), er = slip.lines.filter(l => l.kind === 'employer');
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 13, marginBottom: 10, color: '#374151' }}>
        <span><b>{slip.employee.name}</b> {slip.employee.code ? `(${slip.employee.code})` : ''}</span>
        <span>{slip.employee.department || ''}{slip.employee.position ? ' · ' + slip.employee.position : ''}</span>
        <span>{slip.run.periodStart} → {slip.run.periodEnd}</span>
        <span>Payable <b>{slip.days.payable}</b> / {slip.days.base} days (absent {slip.days.absent}, unpaid leave {slip.days.unpaidLeave})</span>
      </div>
      {slip.warnings?.length > 0 && (
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', borderRadius: 8, padding: '8px 12px', fontSize: 12, marginBottom: 10 }}>
          {slip.warnings.map((w, i) => <div key={i}>⚠️ {w}</div>)}
        </div>
      )}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <Block title="Earnings" lines={earn} total={slip.gross} totalLabel="Gross" color="#065f46" />
        <Block title="Deductions" lines={ded} total={slip.totalDeductions} totalLabel="Total deductions" color="#991b1b" />
      </div>
      {er.length > 0 && <div style={{ marginTop: 12 }}><Block title="Employer contributions (not deducted from pay)" lines={er} /></div>}
      <div style={{ marginTop: 14, padding: '12px 14px', border: '2px solid #1a56db', borderRadius: 10, display: 'flex', justifyContent: 'space-between', fontSize: 17, fontWeight: 800, color: '#1a56db' }}>
        <span>Net pay</span><span>{money(slip.net)}</span>
      </div>
    </div>
  );
}
