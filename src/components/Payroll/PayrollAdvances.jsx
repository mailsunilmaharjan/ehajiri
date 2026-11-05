import React, { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../../api/client.js';
import DataGrid from '../DataGrid/DataGrid.jsx';
import useDateFormat from '../../hooks/useDateFormat.js';
import { PageHeader, PrimaryBtn, GhostBtn, Modal, Field, TextIn, SelectIn, DateInput, Tabs, StatusPill, useToast, todayISO, money } from './payrollUi.jsx';

/* Payroll → Advances. A policy sets the limits (max amount, multiple of basic, installments, interest, minimum service);
   an advance is checked against its policy, approved, then recovered in equal installments through each payroll run. */

const blankPolicy = { name: '', maxAmount: '', maxBasicMultiple: '', maxInstallments: '', interestPct: '0', minServiceMonths: '0', maxOutstanding: '', allowMultiple: false, active: true };

export default function PayrollAdvances() {
  const fd = useDateFormat();
  const [tab, setTab] = useState('advances');
  const [advances, setAdvances] = useState([]);
  const [policies, setPolicies] = useState([]);
  const [emps, setEmps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);       // new advance
  const [pol, setPol] = useState(null);         // policy modal
  const [view, setView] = useState(null);       // schedule modal
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toast, node] = useToast();

  const load = useCallback(() => {
    Promise.all([api.get('/payroll/advances'), api.get('/payroll/advance-policies'), api.get('/payroll/salary')])
      .then(([a, p, e]) => { setAdvances(a); setPolicies(p); setEmps(e.filter(x => x.hasSalary)); })
      .catch(e => toast(e.message, 'error')).finally(() => setLoading(false));
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const act = async (a, what) => {
    if (what === 'cancel' && !window.confirm('Cancel this advance?')) return;
    try { await api.post(`/payroll/advances/${a.id}/${what}`, {}); toast(`Advance ${what === 'approve' ? 'approved' : what + 'ed'}`); load(); } catch (e) { toast(e.message, 'error'); }
  };
  const openView = async (a) => { const d = await api.get(`/payroll/advances/${a.id}`).catch(e => { toast(e.message, 'error'); return null; }); if (d) setView(d); };

  const policy = form && policies.find(p => String(p.id) === String(form.policyId));
  const est = useMemo(() => {
    if (!form || !(Number(form.amount) > 0) || !(Number(form.installments) > 0)) return null;
    const total = Number(form.amount) * (1 + (policy ? Number(policy.interest_pct) : 0) / 100);
    return { total, each: total / Number(form.installments) };
  }, [form, policy]);

  const saveAdvance = async () => {
    setSaving(true); setError('');
    try {
      await api.post('/payroll/advances', { ...form, userId: Number(form.userId), policyId: form.policyId ? Number(form.policyId) : null, amount: Number(form.amount), installments: Number(form.installments) });
      toast('Advance recorded (pending approval)'); setForm(null); load();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };
  const savePolicy = async () => {
    setSaving(true); setError('');
    try {
      if (pol.id) await api.put(`/payroll/advance-policies/${pol.id}`, pol); else await api.post('/payroll/advance-policies', pol);
      toast('Policy saved'); setPol(null); load();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };
  const delPolicy = async (p) => { if (window.confirm('Delete this policy? Existing advances keep working.')) { await api.delete(`/payroll/advance-policies/${p.id}`).catch(e => toast(e.message, 'error')); load(); } };
  const editPolicy = (p) => setPol({ id: p.id, name: p.name, maxAmount: p.max_amount ?? '', maxBasicMultiple: p.max_basic_multiple ?? '', maxInstallments: p.max_installments ?? '', interestPct: p.interest_pct ?? 0,
    minServiceMonths: p.min_service_months ?? 0, maxOutstanding: p.max_outstanding ?? '', allowMultiple: p.allow_multiple, active: p.active });

  const advCols = useMemo(() => [
    { field: 'full_name', header: 'Employee', minWidth: 160 },
    { field: 'policy_name', header: 'Policy', width: 130, render: v => v || '—' },
    { field: 'amount', header: 'Advance', width: 110, align: 'right', render: v => money(v) },
    { field: 'installments', header: 'Installments', width: 130, render: (v, r) => `${v} × ${money(r.installment_amount)}` },
    { field: 'total_payable', header: 'Total (+ interest)', width: 130, align: 'right', render: v => money(v) },
    { field: 'recovered', header: 'Recovered', width: 110, align: 'right', render: v => money(v) },
    { field: 'balance', header: 'Balance', width: 110, align: 'right', render: v => <b>{money(v)}</b> },
    { field: 'start_date', header: 'First deduction', width: 120, render: v => fd(v) },
    { field: 'status', header: 'Status', width: 100, render: v => <StatusPill status={v} /> },
    { field: 'actions', header: 'Actions', width: 230, sortable: false, filterable: false, render: (_, a) => (
      <div style={{ display: 'flex', gap: 6 }}>
        <button className="btn btn-outline btn-sm" onClick={() => openView(a)}>Schedule</button>
        {a.status === 'pending' && <button className="btn btn-primary btn-sm" onClick={() => act(a, 'approve')}>Approve</button>}
        {a.status === 'pending' && <button className="btn btn-outline btn-sm" onClick={() => act(a, 'reject')}>Reject</button>}
        {['pending', 'running'].includes(a.status) && a.recovered === 0 && <button className="btn btn-outline btn-sm" onClick={() => act(a, 'cancel')}>Cancel</button>}
      </div>) },
  ], [fd]); // eslint-disable-line react-hooks/exhaustive-deps

  const polCols = useMemo(() => [
    { field: 'name', header: 'Policy', minWidth: 160 },
    { field: 'max_amount', header: 'Max amount', width: 120, align: 'right', render: v => (v == null ? '—' : money(v)) },
    { field: 'max_basic_multiple', header: 'Max × basic', width: 100, render: v => (v == null ? '—' : `${Number(v)}×`) },
    { field: 'max_installments', header: 'Max installments', width: 130, render: v => v ?? '—' },
    { field: 'interest_pct', header: 'Interest', width: 90, render: v => `${Number(v)}%` },
    { field: 'min_service_months', header: 'Min service', width: 100, render: v => `${v} mo` },
    { field: 'allow_multiple', header: 'Multiple at once', width: 130, render: v => (v ? 'Yes' : 'No') },
    { field: 'active', header: 'Active', width: 80, render: v => (v ? 'Yes' : 'No') },
    { field: 'actions', header: '', width: 120, sortable: false, filterable: false, render: (_, p) => (
      <div style={{ display: 'flex', gap: 6 }}><button className="btn btn-outline btn-sm" onClick={() => editPolicy(p)}>✏️</button><button className="btn btn-outline btn-sm" onClick={() => delPolicy(p)}>🗑</button></div>) },
  ], []); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <div style={{ padding: 48, textAlign: 'center', color: '#9ca3af' }}>Loading…</div>;
  return (
    <div style={{ padding: '20px 24px' }}>
      <PageHeader title="💳 Advances">
        {tab === 'advances' && <PrimaryBtn onClick={() => { setError(''); setForm({ userId: '', policyId: policies.find(p => p.active)?.id || '', amount: '', installments: '3', startDate: todayISO(), reason: '' }); }}>+ New advance</PrimaryBtn>}
        {tab === 'policies' && <PrimaryBtn onClick={() => { setError(''); setPol({ ...blankPolicy }); }}>+ New policy</PrimaryBtn>}
      </PageHeader>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'advances', label: `Advances (${advances.length})` }, { key: 'policies', label: `Advance policies (${policies.length})` }]} />
      {tab === 'advances' && <DataGrid columns={advCols} data={advances} defaultPageSize={20} compact showFilterButton={false} />}
      {tab === 'policies' && (<>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>A policy's limits are checked every time an advance is entered. Interest is a flat % of the advance, spread over the installments.</div>
        <DataGrid columns={polCols} data={policies} defaultPageSize={20} compact showFilterButton={false} />
      </>)}

      {form && (
        <Modal title="New salary advance" onClose={() => setForm(null)}
          footer={<><GhostBtn onClick={() => setForm(null)}>Cancel</GhostBtn><PrimaryBtn disabled={saving} onClick={saveAdvance}>{saving ? 'Saving…' : '💾 Save'}</PrimaryBtn></>}>
          <Field label="Employee" required hint="Only employees with a salary set up are listed."><SelectIn value={form.userId} onChange={e => setForm(f => ({ ...f, userId: e.target.value }))}><option value="">Select…</option>{emps.map(e => <option key={e.user_id} value={e.user_id}>{e.full_name} — basic {money(e.basic)}</option>)}</SelectIn></Field>
          <Field label="Advance policy"><SelectIn value={form.policyId} onChange={e => setForm(f => ({ ...f, policyId: e.target.value }))}><option value="">No policy (no limits checked)</option>{policies.filter(p => p.active).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</SelectIn></Field>
          <div style={{ display: 'flex', gap: 10 }}>
            <Field label="Amount" required style={{ flex: 1 }}><TextIn type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} /></Field>
            <Field label="No. of installments" required style={{ flex: 1 }}><TextIn type="number" value={form.installments} onChange={e => setForm(f => ({ ...f, installments: e.target.value }))} /></Field>
          </div>
          {est && <div style={{ background: '#f0f9ff', color: '#075985', borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>Total payable <b>{money(est.total)}</b> → <b>{money(est.each)}</b> deducted from salary each pay run{policy && Number(policy.interest_pct) > 0 ? ` (includes ${Number(policy.interest_pct)}% interest)` : ''}.</div>}
          <Field label="First deduction from" required hint="Recovery starts with the first payroll run ending on or after this date."><DateInput value={form.startDate} onChange={v => setForm(f => ({ ...f, startDate: v }))} /></Field>
          <Field label="Reason"><TextIn value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} /></Field>
          {error && <span style={{ fontSize: 12, color: '#dc2626' }}>{error}</span>}
        </Modal>
      )}

      {pol && (
        <Modal title={pol.id ? 'Edit advance policy' : 'New advance policy'} onClose={() => setPol(null)}
          footer={<><GhostBtn onClick={() => setPol(null)}>Cancel</GhostBtn><PrimaryBtn disabled={saving} onClick={savePolicy}>{saving ? 'Saving…' : '💾 Save'}</PrimaryBtn></>}>
          <Field label="Policy name" required><TextIn value={pol.name} onChange={e => setPol(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Festival advance, Medical advance" /></Field>
          <div style={{ display: 'flex', gap: 10 }}>
            <Field label="Max amount" style={{ flex: 1 }} hint="blank = no limit"><TextIn type="number" value={pol.maxAmount} onChange={e => setPol(p => ({ ...p, maxAmount: e.target.value }))} /></Field>
            <Field label="Max × monthly basic" style={{ flex: 1 }} hint="e.g. 3 = three months' basic"><TextIn type="number" value={pol.maxBasicMultiple} onChange={e => setPol(p => ({ ...p, maxBasicMultiple: e.target.value }))} /></Field>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Field label="Max installments" style={{ flex: 1 }}><TextIn type="number" value={pol.maxInstallments} onChange={e => setPol(p => ({ ...p, maxInstallments: e.target.value }))} /></Field>
            <Field label="Interest % (flat)" style={{ flex: 1 }}><TextIn type="number" step="0.01" value={pol.interestPct} onChange={e => setPol(p => ({ ...p, interestPct: e.target.value }))} /></Field>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Field label="Min. service (months)" style={{ flex: 1 }}><TextIn type="number" value={pol.minServiceMonths} onChange={e => setPol(p => ({ ...p, minServiceMonths: e.target.value }))} /></Field>
            <Field label="Max total outstanding" style={{ flex: 1 }} hint="across all advances of one employee"><TextIn type="number" value={pol.maxOutstanding} onChange={e => setPol(p => ({ ...p, maxOutstanding: e.target.value }))} /></Field>
          </div>
          <label style={{ fontSize: 13 }}><input type="checkbox" checked={pol.allowMultiple} onChange={e => setPol(p => ({ ...p, allowMultiple: e.target.checked }))} /> Allow a new advance while an earlier one is still being repaid</label>
          <label style={{ fontSize: 13 }}><input type="checkbox" checked={pol.active} onChange={e => setPol(p => ({ ...p, active: e.target.checked }))} /> Active</label>
          {error && <span style={{ fontSize: 12, color: '#dc2626' }}>{error}</span>}
        </Modal>
      )}

      {view && (
        <Modal wide title={`Advance #${view.advance.id} — ${view.advance.full_name}`} onClose={() => setView(null)}>
          <div style={{ fontSize: 13 }}>Amount <b>{money(view.advance.amount)}</b> · Total payable <b>{money(view.advance.total_payable)}</b> · Balance <b>{money(view.advance.balance)}</b> · <StatusPill status={view.advance.status} /></div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ background: '#efefef', textAlign: 'left' }}><th style={{ padding: 7 }}>#</th><th>Due from</th><th style={{ textAlign: 'right' }}>Installment</th></tr></thead>
            <tbody>{view.schedule.map(r => <tr key={r.no} style={{ borderTop: '1px solid #f1f5f9' }}><td style={{ padding: 7 }}>{r.no}</td><td>{fd(r.period)}</td><td style={{ textAlign: 'right' }}>{money(r.amount)}</td></tr>)}</tbody>
          </table>
          <div style={{ fontWeight: 700, fontSize: 13 }}>Recovered through payroll</div>
          {view.recoveries.length === 0 ? <div style={{ fontSize: 12, color: '#9ca3af' }}>Nothing recovered yet.</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <tbody>{view.recoveries.map(r => <tr key={r.id} style={{ borderTop: '1px solid #f1f5f9' }}><td style={{ padding: 7 }}>{fd(r.period_end)}</td><td style={{ textAlign: 'right' }}>{money(r.amount)}</td></tr>)}</tbody>
            </table>
          )}
        </Modal>
      )}
      {node}
    </div>
  );
}
