import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../api/client.js';
import DataGrid from '../DataGrid/DataGrid.jsx';
import useDateFormat from '../../hooks/useDateFormat.js';
import PayslipView, { printPayslip } from './PayslipView.jsx';
import { PageHeader, PrimaryBtn, GhostBtn, Modal, Field, TextIn, DateInput, StatusPill, useToast, todayISO, money } from './payrollUi.jsx';

/* Payroll → Payroll Runs. draft (review / correct) → approved → locked (final: posts advance recoveries and the SSF/PF/CIT/insurance ledger). */

const monthRange = (offset) => {
  const d = new Date(); d.setMonth(d.getMonth() + offset, 1);
  const y = d.getFullYear(), m = d.getMonth(), p = (n) => String(n).padStart(2, '0');
  return { start: `${y}-${p(m + 1)}-01`, end: `${y}-${p(m + 1)}-${p(new Date(y, m + 1, 0).getDate())}`, label: d.toLocaleString('en', { month: 'long', year: 'numeric' }) };
};

const Tile = ({ label, value, color }) => (
  <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 14px', minWidth: 140, flex: 1 }}>
    <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>{label}</div>
    <div style={{ fontSize: 18, fontWeight: 800, color: color || '#1e293b' }}>{money(value)}</div>
  </div>
);

/* ───────────────────────── list of runs ───────────────────────── */
function RunList() {
  const navigate = useNavigate();
  const fd = useDateFormat();
  const [runs, setRuns] = useState([]);
  const [yearly, setYearly] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toast, node] = useToast();

  const load = useCallback(() => {
    Promise.all([api.get('/payroll/runs'), api.get('/settings/payrollItems')])
      .then(([r, i]) => { setRuns(r); setYearly(i.filter(x => x.paymentMode === 'yearly')); })
      .catch(e => toast(e.message, 'error')).finally(() => setLoading(false));
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const openNew = (offset = -1) => { const m = monthRange(offset); setError(''); setForm({ label: m.label, periodStart: m.start, periodEnd: m.end, includeItemIds: [], notes: '' }); };
  const create = async () => {
    setSaving(true); setError('');
    try { const r = await api.post('/payroll/runs', form); toast(`Run created with ${r.slips} payslips`); setForm(null); navigate(`/payroll/run/${r.id}`); }
    catch (e) { setError(e.message); } finally { setSaving(false); }
  };
  const toggle = (id) => setForm(f => ({ ...f, includeItemIds: f.includeItemIds.includes(id) ? f.includeItemIds.filter(x => x !== id) : [...f.includeItemIds, id] }));

  const cols = useMemo(() => [
    { field: 'label', header: 'Payroll run', minWidth: 170, render: v => <b>{v}</b> },
    { field: 'period_start', header: 'Period', width: 210, render: (v, r) => `${fd(v)} → ${fd(r.period_end)}` },
    { field: 'status', header: 'Status', width: 100, render: v => <StatusPill status={v} /> },
    { field: 'slips', header: 'Staff', width: 70, align: 'right' },
    { field: 'gross', header: 'Gross', width: 130, align: 'right', render: v => money(v) },
    { field: 'deductions', header: 'Deductions', width: 130, align: 'right', render: v => money(v) },
    { field: 'net', header: 'Net pay', width: 130, align: 'right', render: v => <b>{money(v)}</b> },
    { field: 'employer_cost', header: 'Employer cost', width: 130, align: 'right', render: v => money(v) },
  ], [fd]);

  if (loading) return <div style={{ padding: 48, textAlign: 'center', color: '#9ca3af' }}>Loading…</div>;
  return (
    <div style={{ padding: '20px 24px' }}>
      <PageHeader title="🧾 Payroll Runs"><PrimaryBtn onClick={() => openNew(-1)}>+ New payroll run</PrimaryBtn></PageHeader>
      <DataGrid columns={cols} data={runs} defaultPageSize={20} compact showFilterButton={false} onRowDoubleClick={(r) => navigate(`/payroll/run/${r.id}`)}
        contextMenu={[{ label: 'Open', icon: '📂', onClick: (r) => navigate(`/payroll/run/${r.id}`) }]} />
      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 8 }}>Double-click a run to open it.</div>

      {form && (
        <Modal title="New payroll run" onClose={() => setForm(null)}
          footer={<><GhostBtn onClick={() => setForm(null)}>Cancel</GhostBtn><PrimaryBtn disabled={saving} onClick={create}>{saving ? 'Calculating…' : 'Create & calculate'}</PrimaryBtn></>}>
          <div style={{ display: 'flex', gap: 8 }}>
            <GhostBtn onClick={() => openNew(0)}>This month</GhostBtn><GhostBtn onClick={() => openNew(-1)}>Last month</GhostBtn>
            <span style={{ fontSize: 11.5, color: '#6b7280', alignSelf: 'center' }}>or set any period (e.g. a Nepali month) below</span>
          </div>
          <Field label="Run name" required><TextIn value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} /></Field>
          <div style={{ display: 'flex', gap: 10 }}>
            <Field label="Period start" required style={{ flex: 1 }}><DateInput value={form.periodStart} onChange={v => setForm(f => ({ ...f, periodStart: v }))} /></Field>
            <Field label="Period end" required style={{ flex: 1 }}><DateInput value={form.periodEnd} onChange={v => setForm(f => ({ ...f, periodEnd: v }))} /></Field>
          </div>
          {yearly.length > 0 && (
            <Field label="Pay yearly items in this run" hint="Each yearly item (e.g. Festival Bonus) is paid once per fiscal year — tick it only in the run where it is due. The system skips anyone already paid this year.">
              {yearly.map(i => (
                <label key={i.id} style={{ fontSize: 13, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="checkbox" checked={form.includeItemIds.includes(i.id)} onChange={() => toggle(i.id)} />
                  {i.name} <span style={{ color: '#9ca3af' }}>({i.calcMethod === 'months_of_basic' ? `${i.calcValue} month(s) of basic` : i.calcMethod === 'percent_of_basic' ? `${i.calcValue}% of basic` : money(i.calcValue)})</span>
                </label>
              ))}
            </Field>
          )}
          <Field label="Notes"><TextIn value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></Field>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Pay days come from the attendance report for this period; you can correct any employee before approving.</div>
          {error && <span style={{ fontSize: 12, color: '#dc2626' }}>{error}</span>}
        </Modal>
      )}
      {node}
    </div>
  );
}

/* ───────────────────────── one run ───────────────────────── */
function RunDetail({ runId }) {
  const fd = useDateFormat();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [slip, setSlip] = useState(null);
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, node] = useToast();

  const load = useCallback(() => api.get(`/payroll/runs/${runId}`).then(setData).catch(e => toast(e.message, 'error')), [runId, toast]);
  useEffect(() => { load(); }, [load]);

  const openSlip = async (row) => {
    const s = await api.get(`/payroll/runs/${runId}/slips/${row.id}`).catch(e => { toast(e.message, 'error'); return null; });
    if (!s) return;
    setSlip(s);
    setEdit({ absentDays: s.adjustments?.absentDays ?? '', unpaidLeaveDays: s.adjustments?.unpaidLeaveDays ?? '', extras: (s.adjustments?.extras || []).map(x => ({ ...x })) });
  };
  const saveEdit = async () => {
    setBusy(true);
    try {
      const s = await api.put(`/payroll/runs/${runId}/slips/${slip.id}`, { absentDays: edit.absentDays === '' ? null : Number(edit.absentDays), unpaidLeaveDays: edit.unpaidLeaveDays === '' ? null : Number(edit.unpaidLeaveDays), extras: edit.extras });
      setSlip(s); toast('Recalculated'); load();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  const run = data?.run;
  const act = async (what, confirmMsg) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(true);
    try { await api.post(`/payroll/runs/${runId}/${what}`, {}); toast('Done'); await load(); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const del = async () => { if (!window.confirm('Delete this draft run?')) return; await api.delete(`/payroll/runs/${runId}`).catch(e => toast(e.message, 'error')); navigate('/payroll/run'); };

  const cols = useMemo(() => [
    { field: 'full_name', header: 'Employee', minWidth: 170, render: (v, r) => <span><b>{v}</b>{r.employee_id ? <span style={{ color: '#9ca3af' }}> · {r.employee_id}</span> : null}</span> },
    { field: 'department', header: 'Department', width: 130 },
    { field: 'payable_days', header: 'Days', width: 90, align: 'center', render: (v, r) => `${v} / ${r.base_days}` },
    { field: 'gross', header: 'Gross', width: 120, align: 'right', render: v => money(v) },
    { field: 'total_deductions', header: 'Deductions', width: 120, align: 'right', render: v => money(v) },
    { field: 'tax', header: 'Tax', width: 100, align: 'right', render: v => money(v) },
    { field: 'net', header: 'Net pay', width: 120, align: 'right', render: v => <b>{money(v)}</b> },
    { field: 'warnings', header: '⚠', width: 50, align: 'center', render: v => (v?.length ? <span title={v.join('\n')} style={{ color: '#b45309', fontWeight: 700 }}>{v.length}</span> : '') },
  ], []);

  if (!data) return <div style={{ padding: 48, textAlign: 'center', color: '#9ca3af' }}>Loading…</div>;
  const draft = run.status === 'draft';
  const warnCount = data.slips.filter(s => s.warnings?.length).length;
  return (
    <div style={{ padding: '20px 24px' }}>
      <PageHeader title={`🧾 ${run.label}`} back="/payroll/run">
        <StatusPill status={run.status} />
        {draft && <GhostBtn disabled={busy} onClick={() => act('rebuild', 'Recalculate every payslip from the latest attendance and salary data? Your manual corrections are kept.')}>🔄 Recalculate all</GhostBtn>}
        {draft && <PrimaryBtn disabled={busy} onClick={() => act('approve', warnCount ? `${warnCount} payslip(s) have warnings. Approve anyway?` : null)}>✔ Approve</PrimaryBtn>}
        {run.status === 'approved' && <GhostBtn disabled={busy} onClick={() => act('reopen')}>↩ Reopen</GhostBtn>}
        {run.status === 'approved' && <PrimaryBtn disabled={busy} style={{ background: '#047857' }} onClick={() => act('lock', 'LOCK this run? This is final: advance installments are recovered and the SSF / PF / CIT / insurance ledgers are updated. A locked run cannot be changed.')}>🔒 Lock (final)</PrimaryBtn>}
        {draft && <GhostBtn disabled={busy} onClick={del}>🗑 Delete</GhostBtn>}
      </PageHeader>
      <div style={{ fontSize: 13, color: '#4b5563', marginBottom: 12 }}>{fd(run.period_start)} → {fd(run.period_end)}{data.yearlyItems.length ? ` · includes yearly: ${data.yearlyItems.map(y => y.name).join(', ')}` : ''}{run.notes ? ` · ${run.notes}` : ''}</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <Tile label="Gross pay" value={data.totals.gross} /><Tile label="Deductions" value={data.totals.deductions} color="#991b1b" /><Tile label="Income tax" value={data.totals.tax} />
        <Tile label="Net pay" value={data.totals.net} color="#065f46" /><Tile label="Employer contributions" value={data.totals.employerCost} />
      </div>
      {warnCount > 0 && draft && <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', borderRadius: 8, padding: '8px 12px', fontSize: 13, marginBottom: 10 }}>⚠️ {warnCount} payslip(s) need a look (see the ⚠ column).</div>}
      <DataGrid columns={cols} data={data.slips} defaultPageSize={25} compact showFilterButton={false} onRowDoubleClick={openSlip}
        contextMenu={[{ label: 'Open payslip', icon: '📄', onClick: openSlip }]} />
      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 8 }}>Double-click an employee to see the payslip{draft ? ' and correct absent days or add one-off adjustments' : ''}.</div>

      {slip && edit && (
        <Modal wide title={`Payslip — ${slip.employee.name}`} onClose={() => setSlip(null)}
          footer={<><GhostBtn onClick={() => printPayslip(slip)}>🖨 Print</GhostBtn><GhostBtn onClick={() => setSlip(null)}>Close</GhostBtn></>}>
          <PayslipView slip={slip} />
          {draft && (
            <div style={{ border: '1px dashed #93c5fd', background: '#f8fbff', borderRadius: 10, padding: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Corrections for this month</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <Field label="Absent days" hint={`leave blank = from attendance (${slip.days.absent})`} style={{ width: 170 }}><TextIn type="number" step="0.5" value={edit.absentDays} onChange={e => setEdit(x => ({ ...x, absentDays: e.target.value }))} /></Field>
                <Field label="Unpaid-leave days" hint="blank = from approved unpaid leave" style={{ width: 170 }}><TextIn type="number" step="0.5" value={edit.unpaidLeaveDays} onChange={e => setEdit(x => ({ ...x, unpaidLeaveDays: e.target.value }))} /></Field>
              </div>
              <div style={{ fontWeight: 600, fontSize: 12, margin: '10px 0 4px' }}>One-off adjustments (bonus, arrears, penalty, recovery…)</div>
              {edit.extras.map((x, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                  <TextIn style={{ width: 200 }} placeholder="Description" value={x.name} onChange={e => setEdit(s => ({ ...s, extras: s.extras.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)) }))} />
                  <select value={x.type} onChange={e => setEdit(s => ({ ...s, extras: s.extras.map((y, j) => (j === i ? { ...y, type: e.target.value } : y)) }))} style={{ height: 36, border: '1px solid #d1d5db', borderRadius: 7 }}><option value="earning">Earning</option><option value="deduction">Deduction</option></select>
                  <TextIn style={{ width: 110 }} type="number" placeholder="Amount" value={x.amount} onChange={e => setEdit(s => ({ ...s, extras: s.extras.map((y, j) => (j === i ? { ...y, amount: e.target.value } : y)) }))} />
                  {x.type === 'earning' && <label style={{ fontSize: 12, alignSelf: 'center' }}><input type="checkbox" checked={x.taxable !== false} onChange={e => setEdit(s => ({ ...s, extras: s.extras.map((y, j) => (j === i ? { ...y, taxable: e.target.checked } : y)) }))} /> taxable</label>}
                  <button className="btn btn-outline btn-sm" onClick={() => setEdit(s => ({ ...s, extras: s.extras.filter((_, j) => j !== i) }))}>✕</button>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 8 }}>
                <GhostBtn onClick={() => setEdit(s => ({ ...s, extras: [...s.extras, { name: '', type: 'earning', amount: '', taxable: true }] }))}>+ Add adjustment</GhostBtn>
                <PrimaryBtn disabled={busy} onClick={saveEdit}>{busy ? 'Recalculating…' : '💾 Save & recalculate'}</PrimaryBtn>
              </div>
            </div>
          )}
        </Modal>
      )}
      {node}
    </div>
  );
}

export default function PayrollRun() {
  const { id } = useParams();
  return id ? <RunDetail runId={id} /> : <RunList />;
}
