import React, { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../../api/client.js';
import DataGrid from '../DataGrid/DataGrid.jsx';
import useDateFormat from '../../hooks/useDateFormat.js';
import { PageHeader, PrimaryBtn, GhostBtn, Modal, Field, TextIn, SelectIn, DateInput, Tabs, StatusPill, useToast, todayISO, money } from './payrollUi.jsx';

/* Payroll → Salary Setup. Each employee's salary is a history of revisions (the latest one in force on the pay-run date is used).
   Increments create a new revision and set the next increment date. Case-basis allowances (e.g. Maternity) are assigned under "Cases". */

const blank = () => ({ effectiveFrom: todayISO(), basic: '', gradeAmount: '', maritalStatus: 'single', ssfEnrolled: false, pfEnrolled: false, citMonthly: '', insuranceMonthly: '',
  panNo: '', ssfNo: '', pfNo: '', citNo: '', bankName: '', bankAccount: '', nextIncrementDate: '', changeNote: '', items: {}, scaleId: '', gradeCode: '', gradesEarned: '0' });

export default function PayrollSalary() {
  const fd = useDateFormat();
  const [tab, setTab] = useState('employees');
  const [emps, setEmps] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [onlyDue, setOnlyDue] = useState(false);
  const [form, setForm] = useState(null);            // salary modal: { user, ...fields }
  const [inc, setInc] = useState(null);              // increment modal
  const [hist, setHist] = useState(null);            // history modal
  const [cases, setCases] = useState([]);
  const [scales, setScales] = useState([]);
  const [caseForm, setCaseForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toast, node] = useToast();

  const load = useCallback(() => {
    Promise.all([api.get('/payroll/salary'), api.get('/settings/payrollItems'), api.get('/payroll/cases'), api.get('/payroll/scales')])
      .then(([e, i, c, s]) => { setEmps(e); setItems(i); setCases(c); setScales(s); })
      .catch(e => toast(e.message, 'error')).finally(() => setLoading(false));
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const monthlyItems = items.filter(i => i.paymentMode === 'monthly');
  const yearlyItems = items.filter(i => i.paymentMode === 'yearly');
  const caseItems = items.filter(i => i.paymentMode === 'need_basis');
  const dueCount = emps.filter(e => e.incrementDue).length;

  const openSalary = async (row) => {
    setError('');
    const d = await api.get(`/payroll/salary/${row.user_id}`).catch(e => { toast(e.message, 'error'); return null; });
    if (!d) return;
    const c = d.current;
    const f = blank();
    if (c) Object.assign(f, {
      basic: String(Number(c.basic)), gradeAmount: String(Number(c.grade_amount)), maritalStatus: c.marital_status, ssfEnrolled: c.ssf_enrolled, pfEnrolled: c.pf_enrolled,
      citMonthly: String(Number(c.cit_monthly)), insuranceMonthly: String(Number(c.insurance_monthly)), panNo: c.pan_no || '', ssfNo: c.ssf_no || '', pfNo: c.pf_no || '',
      citNo: c.cit_no || '', bankName: c.bank_name || '', bankAccount: c.bank_account || '', nextIncrementDate: c.next_increment_date || '',
      scaleId: c.scale_id ? String(c.scale_id) : '', gradeCode: c.grade_code || '', gradesEarned: String(c.grades_earned || 0),
    });
    f.items = Object.fromEntries((d.items || []).map(i => [i.item_id, i.amount == null ? '' : String(Number(i.amount))]));
    setForm({ user: d.user, hasCurrent: !!c, ...f });
  };
  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const toggleItem = (id) => setForm(f => { const it = { ...f.items }; if (id in it) delete it[id]; else it[id] = ''; return { ...f, items: it }; });

  const saveSalary = async () => {
    setSaving(true); setError('');
    try {
      await api.post(`/payroll/salary/${form.user.id}`, {
        ...form, changeType: form.hasCurrent ? 'revision' : 'initial',
        items: Object.entries(form.items).map(([itemId, amount]) => ({ itemId: Number(itemId), amount })),
      });
      toast('Salary saved'); setForm(null); load();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  const openIncrement = (row) => { setError(''); setInc({ row, mode: row.grade_code ? 'grade' : 'percent', value: '', effectiveDate: row.next_increment_date || todayISO(), note: '' }); };
  const preview = inc && inc.mode !== 'grade' && inc.value !== '' ? (inc.mode === 'percent' ? inc.row.basic * (1 + Number(inc.value) / 100) : inc.row.basic + Number(inc.value)) : null;
  // pay-scale link of the open salary form: the grade decides basic and grade amount
  const formScale = form ? scales.find(s => String(s.id) === String(form.scaleId)) : null;
  const formGrade = formScale ? formScale.grades.find(g => g.code === form.gradeCode) : null;
  const gradePv = formGrade ? { basic: formGrade.startSalary, grade: formGrade.gradeRate * Number(form.gradesEarned || 0) } : null;
  const saveIncrement = async () => {
    setSaving(true); setError('');
    try {
      const r = await api.post(`/payroll/salary/${inc.row.user_id}/increment`, { mode: inc.mode, value: Number(inc.value), effectiveDate: inc.effectiveDate, note: inc.note });
      toast(inc.mode === 'grade' ? `Grade ${r.gradesEarned} — grade amount ${money(r.newGradeAmount)}; next increment ${fd(r.nextIncrementDate)}` : `New basic ${money(r.newBasic)} — next increment ${fd(r.nextIncrementDate)}`); setInc(null); load();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  const openHistory = async (row) => { const d = await api.get(`/payroll/salary/${row.user_id}`).catch(e => { toast(e.message, 'error'); return null; }); if (d) setHist(d); };

  const saveCase = async () => {
    setSaving(true); setError('');
    try { await api.post('/payroll/cases', { ...caseForm, userId: Number(caseForm.userId), itemId: Number(caseForm.itemId) }); toast('Case added'); setCaseForm(null); load(); }
    catch (e) { setError(e.message); } finally { setSaving(false); }
  };
  const cancelCase = async (c) => { if (!window.confirm('Cancel this case allowance?')) return; await api.delete(`/payroll/cases/${c.id}`).catch(e => toast(e.message, 'error')); load(); };

  const rows = useMemo(() => (onlyDue ? emps.filter(e => e.incrementDue) : emps), [emps, onlyDue]);
  const columns = useMemo(() => [
    { field: 'full_name', header: 'Employee', minWidth: 170, render: (v, r) => <span><b>{v}</b>{r.employee_id ? <span style={{ color: '#9ca3af' }}> · {r.employee_id}</span> : null}</span> },
    { field: 'department', header: 'Department', width: 140 },
    { field: 'basic', header: 'Basic', width: 110, align: 'right', render: (v, r) => (r.hasSalary ? money(v) : <span style={{ color: '#dc2626', fontWeight: 600 }}>Not set</span>) },
    { field: 'grade_amount', header: 'Grade', width: 100, align: 'right', render: (v, r) => (r.hasSalary ? money(v) : '—') },
    { field: 'ssf_enrolled', header: 'Fund', width: 80, align: 'center', render: (_, r) => (r.ssf_enrolled ? 'SSF' : r.pf_enrolled ? 'PF' : '—') },
    { field: 'effective_from', header: 'Effective', width: 110, render: v => (v ? fd(v) : '—') },
    { field: 'next_increment_date', header: 'Next increment', width: 140,
      render: (v, r) => (v ? <span style={{ color: r.incrementDue ? '#dc2626' : '#374151', fontWeight: r.incrementDue ? 700 : 400 }}>{fd(v)}{r.incrementDue ? ' ⏰ due' : ''}</span> : '—') },
    { field: 'actions', header: 'Actions', width: 170, sortable: false, filterable: false,
      render: (_, r) => (
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn btn-outline btn-sm" onClick={e => { e.stopPropagation(); openSalary(r); }}>{r.hasSalary ? '✏️ Salary' : '+ Set up'}</button>
          {r.hasSalary && <button className="btn btn-outline btn-sm" title="Apply increment" onClick={e => { e.stopPropagation(); openIncrement(r); }}>📈</button>}
          {r.hasSalary && <button className="btn btn-outline btn-sm" title="History" onClick={e => { e.stopPropagation(); openHistory(r); }}>🕘</button>}
        </div>) },
  ], [fd]); // eslint-disable-line react-hooks/exhaustive-deps

  const caseCols = useMemo(() => [
    { field: 'full_name', header: 'Employee', minWidth: 160 },
    { field: 'item_name', header: 'Allowance', minWidth: 160 },
    { field: 'from_date', header: 'From', width: 110, render: v => fd(v) },
    { field: 'to_date', header: 'To', width: 110, render: v => fd(v) },
    { field: 'amount', header: 'Amount', width: 110, align: 'right', render: v => (v == null ? 'item default' : money(v)) },
    { field: 'reason', header: 'Reason', minWidth: 160 },
    { field: 'status', header: 'Status', width: 100, render: v => <StatusPill status={v} /> },
    { field: 'actions', header: '', width: 80, sortable: false, filterable: false, render: (_, c) => (c.status === 'active' ? <button className="btn btn-outline btn-sm" onClick={() => cancelCase(c)}>Cancel</button> : null) },
  ], [fd]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <div style={{ padding: 48, textAlign: 'center', color: '#9ca3af' }}>Loading…</div>;
  return (
    <div style={{ padding: '20px 24px' }}>
      <PageHeader title="👥 Salary Setup">
        {tab === 'cases' && <PrimaryBtn onClick={() => { setError(''); setCaseForm({ userId: '', itemId: '', fromDate: todayISO(), toDate: todayISO(), amount: '', reason: '' }); }}>+ New case allowance</PrimaryBtn>}
      </PageHeader>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'employees', label: `Employees (${emps.length})` }, { key: 'cases', label: `Case allowances (${cases.filter(c => c.status === 'active').length})` }]} />

      {tab === 'employees' && (<>
        {dueCount > 0 && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 10, padding: '9px 14px', fontSize: 13, marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
            ⏰ <b>{dueCount}</b> employee{dueCount > 1 ? 's have' : ' has'} an increment due within the next month.
            <button className="btn btn-outline btn-sm" onClick={() => setOnlyDue(o => !o)}>{onlyDue ? 'Show everyone' : 'Show only these'}</button>
          </div>
        )}
        <DataGrid columns={columns} data={rows} defaultPageSize={20} compact showFilterButton={false} onRowDoubleClick={openSalary} />
      </>)}
      {tab === 'cases' && (
        <>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>A case allowance is paid in every payroll run whose period overlaps its dates (e.g. a Maternity allowance during maternity leave). Items are defined under Payroll Items with payment mode “Case basis”.</div>
          <DataGrid columns={caseCols} data={cases} defaultPageSize={20} compact showFilterButton={false} />
        </>
      )}

      {form && (
        <Modal wide title={`${form.hasCurrent ? 'Revise salary' : 'Set up salary'} — ${form.user.full_name}`} onClose={() => setForm(null)}
          footer={<><GhostBtn onClick={() => setForm(null)}>Cancel</GhostBtn><PrimaryBtn disabled={saving} onClick={saveSalary}>{saving ? 'Saving…' : '💾 Save'}</PrimaryBtn></>}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
            <Field label="Effective from" required hint="Saving on an existing date overwrites that revision."><DateInput value={form.effectiveFrom} onChange={v => setF('effectiveFrom', v)} /></Field>
            <Field label="Basic salary (monthly)" required hint={gradePv ? 'Taken from the pay-scale grade' : undefined}><TextIn type="number" disabled={!!gradePv} value={gradePv ? gradePv.basic : form.basic} onChange={e => setF('basic', e.target.value)} /></Field>
            <Field label="Grade allowance (monthly)" hint={gradePv ? `${form.gradesEarned || 0} grade(s) × ${formGrade.gradeRate}` : 'Grade amount, if any'}><TextIn type="number" disabled={!!gradePv} value={gradePv ? gradePv.grade : form.gradeAmount} onChange={e => setF('gradeAmount', e.target.value)} /></Field>
            <Field label="Tax status"><SelectIn value={form.maritalStatus} onChange={e => setF('maritalStatus', e.target.value)}><option value="single">Single</option><option value="couple">Couple</option></SelectIn></Field>
            <Field label="Next increment date"><DateInput value={form.nextIncrementDate} onChange={v => setF('nextIncrementDate', v)} /></Field>
            <Field label="Change note"><TextIn value={form.changeNote} onChange={e => setF('changeNote', e.target.value)} placeholder="e.g. Promotion" /></Field>
          </div>

          {scales.length > 0 && (
            <div style={{ border: '1px solid #bfdbfe', background: '#f8fbff', borderRadius: 10, padding: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Government pay scale (optional)</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
                <Field label="Pay scale"><SelectIn value={form.scaleId} onChange={e => setForm(f => ({ ...f, scaleId: e.target.value, gradeCode: '', gradesEarned: '0' }))}>
                  <option value="">Not on a pay scale (enter salary directly)</option>{scales.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</SelectIn></Field>
                <Field label="Grade / post"><SelectIn disabled={!formScale} value={form.gradeCode} onChange={e => setF('gradeCode', e.target.value)}>
                  <option value="">Select…</option>{(formScale?.grades || []).map(g => <option key={g.code} value={g.code}>{g.label} ({g.code})</option>)}</SelectIn></Field>
                <Field label="Grades earned" hint={formGrade?.maxGrades != null ? `maximum ${formGrade.maxGrades}` : undefined}><TextIn type="number" min="0" disabled={!formGrade} value={form.gradesEarned} onChange={e => setF('gradesEarned', e.target.value)} /></Field>
              </div>
              {gradePv && <div style={{ marginTop: 8, fontSize: 13, color: '#1e40af' }}>Salary from the scale: basic <b>{money(gradePv.basic)}</b> + grade amount <b>{money(gradePv.grade)}</b> = <b>{money(gradePv.basic + gradePv.grade)}</b></div>}
            </div>
          )}

          <div style={{ fontWeight: 700, fontSize: 13, marginTop: 6 }}>Funds & deductions</div>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 13 }}>
            <label><input type="checkbox" checked={form.ssfEnrolled} onChange={e => setForm(f => ({ ...f, ssfEnrolled: e.target.checked, pfEnrolled: e.target.checked ? false : f.pfEnrolled }))} /> Enrolled in SSF</label>
            <label><input type="checkbox" checked={form.pfEnrolled} onChange={e => setForm(f => ({ ...f, pfEnrolled: e.target.checked, ssfEnrolled: e.target.checked ? false : f.ssfEnrolled }))} /> Enrolled in PF</label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
            <Field label="CIT contribution (monthly)"><TextIn type="number" value={form.citMonthly} onChange={e => setF('citMonthly', e.target.value)} /></Field>
            <Field label="Insurance premium (monthly)"><TextIn type="number" value={form.insuranceMonthly} onChange={e => setF('insuranceMonthly', e.target.value)} /></Field>
            <Field label="PAN"><TextIn value={form.panNo} onChange={e => setF('panNo', e.target.value)} /></Field>
            <Field label="SSF no."><TextIn value={form.ssfNo} onChange={e => setF('ssfNo', e.target.value)} /></Field>
            <Field label="PF no."><TextIn value={form.pfNo} onChange={e => setF('pfNo', e.target.value)} /></Field>
            <Field label="CIT no."><TextIn value={form.citNo} onChange={e => setF('citNo', e.target.value)} /></Field>
            <Field label="Bank"><TextIn value={form.bankName} onChange={e => setF('bankName', e.target.value)} /></Field>
            <Field label="Bank account no."><TextIn value={form.bankAccount} onChange={e => setF('bankAccount', e.target.value)} /></Field>
          </div>

          <div style={{ fontWeight: 700, fontSize: 13, marginTop: 6 }}>Monthly allowances & deductions for this employee</div>
          {monthlyItems.length === 0 ? <div style={{ fontSize: 12, color: '#9ca3af' }}>No monthly items defined yet (Payroll Items).</div> : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 8 }}>
              {monthlyItems.map(i => (
                <div key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, border: '1px solid #e5e7eb', borderRadius: 8, padding: '6px 10px', background: i.id in form.items ? '#f0f9ff' : '#fff' }}>
                  <input type="checkbox" checked={i.id in form.items} onChange={() => toggleItem(i.id)} />
                  <span style={{ flex: 1 }}>{i.name} <span style={{ color: '#9ca3af' }}>({i.type === 'deduction' ? 'deduction' : 'earning'}; {i.calcMethod === 'percent_of_basic' ? i.calcValue + '% of basic' : money(i.calcValue)})</span></span>
                  {i.id in form.items && <input type="number" placeholder="override" value={form.items[i.id]} onChange={e => setForm(f => ({ ...f, items: { ...f.items, [i.id]: e.target.value } }))} style={{ width: 90, height: 28, border: '1px solid #d1d5db', borderRadius: 6, padding: '0 6px' }} />}
                </div>
              ))}
            </div>
          )}
          {yearlyItems.length > 0 && <div style={{ fontSize: 11.5, color: '#6b7280' }}>Yearly items ({yearlyItems.map(i => i.name).join(', ')}) apply to everyone when ticked in a payroll run. To change one employee's amount, tick the item here and enter an override (0 = exclude).</div>}
          {yearlyItems.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 8 }}>
              {yearlyItems.map(i => (
                <div key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, border: '1px solid #e5e7eb', borderRadius: 8, padding: '6px 10px', background: i.id in form.items ? '#fefce8' : '#fff' }}>
                  <input type="checkbox" checked={i.id in form.items} onChange={() => toggleItem(i.id)} />
                  <span style={{ flex: 1 }}>{i.name} <span style={{ color: '#9ca3af' }}>(yearly)</span></span>
                  {i.id in form.items && <input type="number" placeholder="amount / 0" value={form.items[i.id]} onChange={e => setForm(f => ({ ...f, items: { ...f.items, [i.id]: e.target.value } }))} style={{ width: 90, height: 28, border: '1px solid #d1d5db', borderRadius: 6, padding: '0 6px' }} />}
                </div>
              ))}
            </div>
          )}
          {error && <span style={{ fontSize: 12, color: '#dc2626' }}>{error}</span>}
        </Modal>
      )}

      {inc && (
        <Modal title={`Apply increment — ${inc.row.full_name}`} onClose={() => setInc(null)}
          footer={<><GhostBtn onClick={() => setInc(null)}>Cancel</GhostBtn><PrimaryBtn disabled={saving || (inc.mode !== 'grade' && !inc.value)} onClick={saveIncrement}>{saving ? 'Saving…' : 'Apply'}</PrimaryBtn></>}>
          <div style={{ fontSize: 13 }}>Current basic: <b>{money(inc.row.basic)}</b></div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Field label="Increment by" style={{ flex: 1 }}><SelectIn value={inc.mode} onChange={e => setInc(x => ({ ...x, mode: e.target.value }))}>
              {inc.row.grade_code && <option value="grade">Next grade (+1 grade × grade rate)</option>}<option value="percent">Percent (%)</option><option value="amount">Fixed amount</option></SelectIn></Field>
            {inc.mode !== 'grade' && <Field label={inc.mode === 'percent' ? 'Percent' : 'Amount'} required style={{ flex: 1 }}><TextIn type="number" value={inc.value} onChange={e => setInc(x => ({ ...x, value: e.target.value }))} /></Field>}
          </div>
          {preview != null && <div style={{ background: '#f0fdf4', color: '#065f46', borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>New basic: <b>{money(preview)}</b> · next increment <b>{inc.effectiveDate ? fd(new Date(new Date(inc.effectiveDate).setFullYear(new Date(inc.effectiveDate).getFullYear() + 1)).toISOString().slice(0, 10)) : '—'}</b></div>}
          <Field label="Effective from" required><DateInput value={inc.effectiveDate} onChange={v => setInc(x => ({ ...x, effectiveDate: v }))} /></Field>
          <Field label="Note"><TextIn value={inc.note} onChange={e => setInc(x => ({ ...x, note: e.target.value }))} placeholder="e.g. Annual grade increment" /></Field>
          {error && <span style={{ fontSize: 12, color: '#dc2626' }}>{error}</span>}
        </Modal>
      )}

      {hist && (
        <Modal wide title={`Salary history — ${hist.user.full_name}`} onClose={() => setHist(null)}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ background: '#efefef', textAlign: 'left' }}><th style={{ padding: 7 }}>Effective</th><th>Type</th><th style={{ textAlign: 'right' }}>Basic</th><th style={{ textAlign: 'right' }}>Grade</th><th>Fund</th><th>Next increment</th><th>Note</th></tr></thead>
            <tbody>{hist.history.map(h => (
              <tr key={h.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                <td style={{ padding: 7 }}>{fd(h.effective_from)}</td><td>{h.change_type}</td><td style={{ textAlign: 'right' }}>{money(h.basic)}</td><td style={{ textAlign: 'right' }}>{money(h.grade_amount)}</td>
                <td>{h.ssf_enrolled ? 'SSF' : h.pf_enrolled ? 'PF' : '—'}</td><td>{h.next_increment_date ? fd(h.next_increment_date) : '—'}</td><td>{h.change_note}</td>
              </tr>))}</tbody>
          </table>
        </Modal>
      )}

      {caseForm && (
        <Modal title="New case allowance" onClose={() => setCaseForm(null)}
          footer={<><GhostBtn onClick={() => setCaseForm(null)}>Cancel</GhostBtn><PrimaryBtn disabled={saving} onClick={saveCase}>{saving ? 'Saving…' : '💾 Save'}</PrimaryBtn></>}>
          <Field label="Employee" required><SelectIn value={caseForm.userId} onChange={e => setCaseForm(c => ({ ...c, userId: e.target.value }))}><option value="">Select…</option>{emps.map(e => <option key={e.user_id} value={e.user_id}>{e.full_name}{e.gender ? ` (${e.gender})` : ''}</option>)}</SelectIn></Field>
          <Field label="Allowance" required hint={caseItems.length ? '' : 'No “Case basis” items yet — create one under Payroll Items (e.g. Maternity Allowance, Applies to: Female).'}>
            <SelectIn value={caseForm.itemId} onChange={e => setCaseForm(c => ({ ...c, itemId: e.target.value }))}><option value="">Select…</option>{caseItems.map(i => <option key={i.id} value={i.id}>{i.name}{i.appliesGender !== 'all' ? ` (${i.appliesGender} only)` : ''}</option>)}</SelectIn>
          </Field>
          <div style={{ display: 'flex', gap: 10 }}>
            <Field label="From" required style={{ flex: 1 }}><DateInput value={caseForm.fromDate} onChange={v => setCaseForm(c => ({ ...c, fromDate: v }))} /></Field>
            <Field label="To" required style={{ flex: 1 }}><DateInput value={caseForm.toDate} onChange={v => setCaseForm(c => ({ ...c, toDate: v }))} /></Field>
          </div>
          <Field label="Amount per pay run" hint="Leave blank to use the item's own amount."><TextIn type="number" value={caseForm.amount} onChange={e => setCaseForm(c => ({ ...c, amount: e.target.value }))} /></Field>
          <Field label="Reason"><TextIn value={caseForm.reason} onChange={e => setCaseForm(c => ({ ...c, reason: e.target.value }))} /></Field>
          {error && <span style={{ fontSize: 12, color: '#dc2626' }}>{error}</span>}
        </Modal>
      )}
      {node}
    </div>
  );
}
