import React, { useState, useEffect, useMemo } from 'react';
import api from '../../api/client.js';
import DataGrid from '../DataGrid/DataGrid.jsx';
import useDateFormat from '../../hooks/useDateFormat.js';
import { downloadSheet } from './payrollExport.js';
import { PageHeader, GhostBtn, Field, SelectIn, useToast, money } from './payrollUi.jsx';

/* Payroll → Reports. Pick a payroll run, see the register, and download the statements an office needs:
   register, bank advice, income-tax (TDS) statement, SSF / PF / CIT / insurance statements. */

const N = { numeric: true };
export default function PayrollReports() {
  const fd = useDateFormat();
  const [runs, setRuns] = useState([]);
  const [runId, setRunId] = useState('');
  const [reg, setReg] = useState(null);
  const [toast, node] = useToast();

  useEffect(() => { api.get('/payroll/runs').then(r => { setRuns(r); const first = r.find(x => x.status !== 'draft') || r[0]; if (first) setRunId(String(first.id)); }).catch(e => toast(e.message, 'error')); }, [toast]);
  useEffect(() => { if (runId) api.get(`/payroll/runs/${runId}/register`).then(setReg).catch(e => toast(e.message, 'error')); }, [runId, toast]);

  const rows = reg?.rows || [];
  const period = reg ? `${reg.run.label} (${fd(reg.run.period_start)} → ${fd(reg.run.period_end)})` : '';
  const dl = (name, title, columns, data, totals) => downloadSheet({ filename: `${name}_${reg.run.label.replace(/\s+/g, '_')}.xlsx`, sheetName: name, title, subtitle: period, columns, rows: data, totals });

  const exports = [
    ['📥 Payroll register', () => dl('Payroll_Register', 'Payroll register', [
      { header: 'Employee', key: 'name', width: 26 }, { header: 'Code', key: 'code', width: 10 }, { header: 'Department', key: 'department' }, { header: 'Days', key: 'payableDays', ...N },
      { header: 'Basic', key: 'basic', ...N }, { header: 'Grade', key: 'grade', ...N }, { header: 'Allowances / bonus', key: 'allowances', ...N }, { header: 'Gross', key: 'gross', ...N },
      { header: 'SSF (emp)', key: 'ssfEmployee', ...N }, { header: 'PF (emp)', key: 'pfEmployee', ...N }, { header: 'CIT', key: 'cit', ...N }, { header: 'Insurance', key: 'insurance', ...N },
      { header: 'Income tax', key: 'tax', ...N }, { header: 'Advance', key: 'advance', ...N }, { header: 'Other ded.', key: 'otherDeductions', ...N },
      { header: 'Total deductions', key: 'totalDeductions', ...N }, { header: 'Net pay', key: 'net', ...N }, { header: 'SSF (employer)', key: 'ssfEmployer', ...N }, { header: 'PF (employer)', key: 'pfEmployer', ...N },
    ], rows, ['basic', 'grade', 'allowances', 'gross', 'ssfEmployee', 'pfEmployee', 'cit', 'insurance', 'tax', 'advance', 'otherDeductions', 'totalDeductions', 'net', 'ssfEmployer', 'pfEmployer'])],
    ['🏦 Bank advice', () => dl('Bank_Advice', 'Salary transfer (bank advice)', [
      { header: 'Employee', key: 'name', width: 28 }, { header: 'Bank', key: 'bankName' }, { header: 'Account no.', key: 'bankAccount', width: 24 }, { header: 'Net pay', key: 'net', ...N },
    ], rows.filter(r => r.net > 0), ['net'])],
    ['🧾 Income tax (TDS)', () => dl('Tax_Statement', 'Income tax (TDS) statement', [
      { header: 'Employee', key: 'name', width: 28 }, { header: 'PAN', key: 'pan' }, { header: 'Gross pay', key: 'gross', ...N }, { header: 'Tax deducted', key: 'tax', ...N },
    ], rows, ['gross', 'tax'])],
    ['📒 SSF statement', () => dl('SSF_Statement', 'SSF contribution statement', [
      { header: 'Employee', key: 'name', width: 28 }, { header: 'SSF no.', key: 'ssfNo' }, { header: 'Employee share', key: 'ssfEmployee', ...N }, { header: 'Employer share', key: 'ssfEmployer', ...N },
    ], rows.filter(r => r.ssfEmployee || r.ssfEmployer), ['ssfEmployee', 'ssfEmployer'])],
    ['📒 PF statement', () => dl('PF_Statement', 'Provident Fund contribution statement', [
      { header: 'Employee', key: 'name', width: 28 }, { header: 'PF no.', key: 'pfNo' }, { header: 'Employee share', key: 'pfEmployee', ...N }, { header: 'Employer share', key: 'pfEmployer', ...N },
    ], rows.filter(r => r.pfEmployee || r.pfEmployer), ['pfEmployee', 'pfEmployer'])],
    ['📒 CIT & insurance', () => dl('CIT_Insurance', 'CIT and insurance statement', [
      { header: 'Employee', key: 'name', width: 28 }, { header: 'CIT no.', key: 'citNo' }, { header: 'CIT', key: 'cit', ...N }, { header: 'Insurance premium', key: 'insurance', ...N },
    ], rows.filter(r => r.cit || r.insurance), ['cit', 'insurance'])],
  ];

  const cols = useMemo(() => [
    { field: 'name', header: 'Employee', minWidth: 160 }, { field: 'department', header: 'Department', width: 120 },
    { field: 'payableDays', header: 'Days', width: 70, align: 'center' },
    { field: 'gross', header: 'Gross', width: 110, align: 'right', render: v => money(v) },
    { field: 'ssfEmployee', header: 'SSF', width: 100, align: 'right', render: v => (v ? money(v) : '—') },
    { field: 'pfEmployee', header: 'PF', width: 100, align: 'right', render: v => (v ? money(v) : '—') },
    { field: 'cit', header: 'CIT', width: 90, align: 'right', render: v => (v ? money(v) : '—') },
    { field: 'insurance', header: 'Insurance', width: 90, align: 'right', render: v => (v ? money(v) : '—') },
    { field: 'tax', header: 'Tax', width: 100, align: 'right', render: v => money(v) },
    { field: 'advance', header: 'Advance', width: 100, align: 'right', render: v => (v ? money(v) : '—') },
    { field: 'totalDeductions', header: 'Deductions', width: 110, align: 'right', render: v => money(v) },
    { field: 'net', header: 'Net pay', width: 110, align: 'right', render: v => <b>{money(v)}</b> },
  ], []);

  return (
    <div style={{ padding: '20px 24px' }}>
      <PageHeader title="📊 Payroll Reports" />
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 14 }}>
        <Field label="Payroll run" style={{ minWidth: 280 }}>
          <SelectIn value={runId} onChange={e => setRunId(e.target.value)}>
            {runs.length === 0 && <option value="">No payroll runs yet</option>}
            {runs.map(r => <option key={r.id} value={r.id}>{r.label} — {r.status}</option>)}
          </SelectIn>
        </Field>
        {reg && exports.map(([label, fn]) => <GhostBtn key={label} onClick={fn} disabled={!rows.length}>{label}</GhostBtn>)}
      </div>
      {reg?.run.status === 'draft' && <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', borderRadius: 8, padding: '8px 12px', fontSize: 13, marginBottom: 10 }}>This run is still a draft — figures may change until it is approved and locked.</div>}
      {reg && <DataGrid columns={cols} data={rows} defaultPageSize={25} compact showFilterButton={false} />}
      {node}
    </div>
  );
}
