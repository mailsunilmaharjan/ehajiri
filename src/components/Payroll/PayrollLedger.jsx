import React, { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../../api/client.js';
import DataGrid from '../DataGrid/DataGrid.jsx';
import useDateFormat from '../../hooks/useDateFormat.js';
import { downloadSheet } from './payrollExport.js';
import { PageHeader, PrimaryBtn, GhostBtn, Modal, Field, TextIn, SelectIn, DateInput, Tabs, useToast, todayISO, money } from './payrollUi.jsx';

/* Payroll → Fund Ledger: SSF, PF, CIT and insurance. Contributions are posted automatically when a payroll run is locked;
   opening balances, adjustments and withdrawals are entered here. */

const FUNDS = [
  { key: 'SSF', label: 'SSF', long: 'Social Security Fund', numField: 'ssf_no' },
  { key: 'PF', label: 'PF', long: 'Provident Fund', numField: 'pf_no' },
  { key: 'CIT', label: 'CIT', long: 'Citizen Investment Trust', numField: 'cit_no' },
  { key: 'INS', label: 'Insurance', long: 'Insurance premiums', numField: null },
];
const TYPE_LABEL = { contribution: 'Contribution', opening: 'Opening balance', adjustment: 'Adjustment', withdrawal: 'Withdrawal' };

export default function PayrollLedger() {
  const fd = useDateFormat();
  const [fund, setFund] = useState('SSF');
  const [asOf, setAsOf] = useState(todayISO());
  const [summary, setSummary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [emps, setEmps] = useState([]);
  const [detail, setDetail] = useState(null);     // { user, data }
  const [entry, setEntry] = useState(null);
  const [error, setError] = useState('');
  const [toast, node] = useToast();
  const f = FUNDS.find(x => x.key === fund);

  const load = useCallback(() => {
    setLoading(true);
    api.get(`/payroll/ledger/summary?fund=${fund}&asOf=${asOf}`).then(r => setSummary(r.rows)).catch(e => toast(e.message, 'error')).finally(() => setLoading(false));
  }, [fund, asOf, toast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get('/payroll/salary').then(setEmps).catch(() => {}); }, []);

  const openDetail = async (userId, name) => {
    const data = await api.get(`/payroll/ledger?userId=${userId}&fund=${fund}`).catch(e => { toast(e.message, 'error'); return null; });
    if (data) setDetail({ userId, name, data });
  };
  const saveEntry = async () => {
    setError('');
    try {
      await api.post('/payroll/ledger/entry', { ...entry, userId: Number(entry.userId), fundCode: fund });
      toast('Entry added'); setEntry(null); load();
      if (detail && Number(entry.userId) === detail.userId) openDetail(detail.userId, detail.name);
    } catch (e) { setError(e.message); }
  };
  const delEntry = async (id) => {
    if (!window.confirm('Delete this manual entry?')) return;
    await api.delete(`/payroll/ledger/entry/${id}`).catch(e => toast(e.message, 'error'));
    openDetail(detail.userId, detail.name); load();
  };

  const totals = useMemo(() => ({ e: summary.reduce((s, r) => s + r.employee, 0), r: summary.reduce((s, r) => s + r.employer, 0) }), [summary]);
  const cols = useMemo(() => [
    { field: 'full_name', header: 'Employee', minWidth: 170, render: (v, r) => <span><b>{v}</b>{r.employee_id ? <span style={{ color: '#9ca3af' }}> · {r.employee_id}</span> : null}</span> },
    { field: 'department', header: 'Department', width: 140 },
    ...(f.numField ? [{ field: f.numField, header: `${f.label} no.`, width: 130, render: v => v || '—' }] : []),
    { field: 'employee', header: 'Employee share', width: 140, align: 'right', render: v => money(v) },
    { field: 'employer', header: 'Employer share', width: 140, align: 'right', render: v => money(v) },
    { field: 'total', header: 'Balance', width: 140, align: 'right', render: v => <b>{money(v)}</b> },
  ], [f]);

  const exportSummary = () => downloadSheet({
    filename: `${fund}_ledger_${asOf}.xlsx`, sheetName: `${fund} ledger`, title: `${f.long} ledger`, subtitle: `Balance as of ${asOf}`,
    columns: [{ header: 'Employee', key: 'full_name', width: 28 }, { header: 'Department', key: 'department' }, ...(f.numField ? [{ header: `${f.label} no.`, key: f.numField }] : []),
      { header: 'Employee share', key: 'employee', numeric: true }, { header: 'Employer share', key: 'employer', numeric: true }, { header: 'Balance', key: 'total', numeric: true }],
    rows: summary, totals: ['employee', 'employer', 'total'],
  });
  const exportDetail = () => downloadSheet({
    filename: `${fund}_${detail.name.replace(/\s+/g, '_')}.xlsx`, sheetName: fund, title: `${f.long} — ${detail.name}`,
    columns: [{ header: 'Date', key: 'periodEnd' }, { header: 'Type', key: 'type' }, { header: 'Note', key: 'note', width: 28 }, { header: 'Employee', key: 'employee', numeric: true }, { header: 'Employer', key: 'employer', numeric: true }, { header: 'Balance', key: 'balance', numeric: true }],
    rows: detail.data.rows.map(r => ({ ...r, type: TYPE_LABEL[r.type] || r.type })), totals: ['employee', 'employer'],
  });

  return (
    <div style={{ padding: '20px 24px' }}>
      <PageHeader title="📒 Fund Ledger">
        <GhostBtn onClick={exportSummary} disabled={!summary.length}>📥 Excel</GhostBtn>
        <PrimaryBtn onClick={() => { setError(''); setEntry({ userId: '', entryType: 'opening', periodEnd: todayISO(), employeeAmt: '', employerAmt: '', note: '' }); }}>+ Manual entry</PrimaryBtn>
      </PageHeader>
      <Tabs value={fund} onChange={setFund} tabs={FUNDS.map(x => ({ key: x.key, label: `${x.label} — ${x.long}` }))} />
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', marginBottom: 12, flexWrap: 'wrap' }}>
        <Field label="Balance as of" style={{ width: 200 }}><DateInput value={asOf} onChange={setAsOf} /></Field>
        <div style={{ fontSize: 13, color: '#374151' }}>Employee <b>{money(totals.e)}</b> · Employer <b>{money(totals.r)}</b> · Total <b>{money(totals.e + totals.r)}</b></div>
      </div>
      {loading ? <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>Loading…</div>
        : <DataGrid columns={cols} data={summary} defaultPageSize={25} compact showFilterButton={false} onRowDoubleClick={(r) => openDetail(r.user_id, r.full_name)} />}
      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 8 }}>Double-click an employee for their full ledger. Contributions appear after a payroll run is locked.</div>

      {detail && (
        <Modal wide title={`${f.long} — ${detail.name}`} onClose={() => setDetail(null)}
          footer={<><GhostBtn onClick={exportDetail}>📥 Excel</GhostBtn><GhostBtn onClick={() => setDetail(null)}>Close</GhostBtn></>}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ background: '#efefef', textAlign: 'left' }}><th style={{ padding: 7 }}>Date</th><th>Type</th><th>Note</th><th style={{ textAlign: 'right' }}>Employee</th><th style={{ textAlign: 'right' }}>Employer</th><th style={{ textAlign: 'right' }}>Balance</th><th /></tr></thead>
            <tbody>
              {detail.data.rows.length === 0 && <tr><td colSpan={7} style={{ padding: 20, textAlign: 'center', color: '#9ca3af' }}>No entries yet.</td></tr>}
              {detail.data.rows.map(r => (
                <tr key={r.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                  <td style={{ padding: 7 }}>{fd(r.periodEnd)}</td><td>{TYPE_LABEL[r.type] || r.type}</td><td>{r.note}</td>
                  <td style={{ textAlign: 'right', color: r.employee < 0 ? '#991b1b' : undefined }}>{money(r.employee)}</td><td style={{ textAlign: 'right', color: r.employer < 0 ? '#991b1b' : undefined }}>{money(r.employer)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(r.balance)}</td>
                  <td>{!r.runId && <button className="btn btn-outline btn-sm" onClick={() => delEntry(r.id)}>🗑</button>}</td>
                </tr>))}
            </tbody>
          </table>
        </Modal>
      )}

      {entry && (
        <Modal title={`Manual ${f.label} entry`} onClose={() => setEntry(null)}
          footer={<><GhostBtn onClick={() => setEntry(null)}>Cancel</GhostBtn><PrimaryBtn onClick={saveEntry}>💾 Save</PrimaryBtn></>}>
          <Field label="Employee" required><SelectIn value={entry.userId} onChange={e => setEntry(x => ({ ...x, userId: e.target.value }))}><option value="">Select…</option>{emps.map(e => <option key={e.user_id} value={e.user_id}>{e.full_name}</option>)}</SelectIn></Field>
          <Field label="Entry type" hint="Opening = balance brought forward before payroll started here. Withdrawal reduces the balance.">
            <SelectIn value={entry.entryType} onChange={e => setEntry(x => ({ ...x, entryType: e.target.value }))}><option value="opening">Opening balance</option><option value="adjustment">Adjustment</option><option value="withdrawal">Withdrawal</option></SelectIn>
          </Field>
          <Field label="Date" required><DateInput value={entry.periodEnd} onChange={v => setEntry(x => ({ ...x, periodEnd: v }))} /></Field>
          <div style={{ display: 'flex', gap: 10 }}>
            <Field label="Employee amount" style={{ flex: 1 }}><TextIn type="number" value={entry.employeeAmt} onChange={e => setEntry(x => ({ ...x, employeeAmt: e.target.value }))} /></Field>
            <Field label="Employer amount" style={{ flex: 1 }}><TextIn type="number" value={entry.employerAmt} onChange={e => setEntry(x => ({ ...x, employerAmt: e.target.value }))} /></Field>
          </div>
          <Field label="Note"><TextIn value={entry.note} onChange={e => setEntry(x => ({ ...x, note: e.target.value }))} /></Field>
          {error && <span style={{ fontSize: 12, color: '#dc2626' }}>{error}</span>}
        </Modal>
      )}
      {node}
    </div>
  );
}
