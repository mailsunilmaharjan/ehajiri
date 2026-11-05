import React, { useState, useEffect, useCallback } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import useDateFormat from '../../hooks/useDateFormat.js';
import { PageHeader, PrimaryBtn, GhostBtn, Modal, Field, TextIn, SelectIn, DateInput, useToast, todayISO } from './payrollUi.jsx';

/* Payroll → Settings → Rates & Limits. Every statutory rate, deduction limit and pay-day rule is data here, not code.
   A change is "add a new row effective from <date>": earlier payroll runs keep using the rate that applied then. */

const BASES = [['basic', 'Basic salary'], ['basic_grade', 'Basic + grade allowance'], ['gross', 'Gross pay']];
const SECTIONS = [
  { code: 'SSF', title: 'Social Security Fund (SSF)', help: 'Contribution rates for employees enrolled in SSF. Employer share is not deducted from pay but is posted to the SSF ledger.' },
  { code: 'PF', title: 'Provident Fund (PF / EPF)', help: 'For employees on PF instead of SSF.' },
  { code: 'LIMITS', title: 'Tax-deduction limits', help: 'Caps on how much retirement-fund and insurance contributions may reduce taxable income.' },
  { code: 'POLICY', title: 'Pay-day policy', help: 'How a month\'s salary is reduced for absence and unpaid leave.' },
];
const summary = (code, p) => {
  if (code === 'SSF' || code === 'PF') return `Employee ${p.employeePct}% · Employer ${p.employerPct}% · on ${(BASES.find(b => b[0] === p.base) || [, p.base])[1]}`;
  if (code === 'LIMITS') return `Retirement: ${p.retirementMaxSharePct}% of income, max ${Number(p.retirementLimitAnnual).toLocaleString()}/yr · Insurance: max ${Number(p.insuranceLimitAnnual).toLocaleString()}/yr`;
  return `${p.daysBasis === 'calendar' ? 'Calendar days' : p.daysBasis + '-day month'} · ${p.deductAbsent === false ? 'absence not deducted' : 'absence deducted'}${(p.unpaidLeaveCodes || []).length ? ' · unpaid leave: ' + p.unpaidLeaveCodes.join(', ') : ''}`;
};

export default function PayrollRates() {
  const { canManageSystem } = useAuth();
  const fd = useDateFormat();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState(null);       // { code, effectiveFrom, note, p: {...} }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toast, node] = useToast();

  const load = useCallback(() => {
    api.get('/payroll/rates').then(setRows).catch(e => toast(e.message, 'error')).finally(() => setLoading(false));
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const current = (code) => rows.filter(r => r.code === code && r.effective_from <= todayISO())[0] || rows.filter(r => r.code === code).slice(-1)[0];
  const openNew = (code) => {
    const cur = current(code)?.params || {};
    setError('');
    setEdit({ code, effectiveFrom: todayISO(), note: '', p: { ...cur, unpaidLeaveCodes: (cur.unpaidLeaveCodes || []).join(', ') } });
  };
  const save = async () => {
    setSaving(true); setError('');
    const p = { ...edit.p };
    if (edit.code === 'POLICY') p.unpaidLeaveCodes = String(p.unpaidLeaveCodes || '').split(',').map(s => s.trim()).filter(Boolean);
    try {
      await api.post('/payroll/rates', { code: edit.code, effectiveFrom: edit.effectiveFrom, params: p, note: edit.note });
      toast('Saved'); setEdit(null); load();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };
  const del = async (r) => {
    if (!window.confirm('Delete this rate row?')) return;
    try { await api.delete(`/payroll/rates/${r.id}`); load(); } catch (e) { toast(e.message, 'error'); }
  };
  const set = (k, v) => setEdit(e => ({ ...e, p: { ...e.p, [k]: v } }));

  if (loading) return <div style={{ padding: 48, textAlign: 'center', color: '#9ca3af' }}>Loading…</div>;
  return (
    <div style={{ padding: '20px 24px' }}>
      <PageHeader title="⚙️ Rates & Limits" />
      <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af', borderRadius: 10, padding: '10px 14px', fontSize: 12.5, marginBottom: 16, lineHeight: 1.5 }}>
        Nothing here is fixed in the program. When the government or your policy changes a rate, add a new row <b>effective from the new date</b> — payroll runs always use the row in force for their period, and older rows are kept as history.
        Rows marked “Initial default” were pre-filled as a starting point: <b>please verify them with your accountant.</b> Income-tax slabs are under <b>Payroll Tax Slab</b>.
      </div>

      {SECTIONS.map(s => {
        const list = rows.filter(r => r.code === s.code);
        const cur = current(s.code);
        return (
          <div key={s.code} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #e2e8f0', gap: 10, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 14, color: '#111827' }}>{s.title}</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>{s.help}</div>
              </div>
              {canManageSystem && <PrimaryBtn onClick={() => openNew(s.code)}>+ Change from a date</PrimaryBtn>}
            </div>
            {cur && <div style={{ padding: '10px 16px', background: '#f0fdf4', color: '#065f46', fontSize: 13, fontWeight: 600 }}>In force now: {summary(s.code, cur.params)}</div>}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ background: '#efefef', color: '#374151', textAlign: 'left' }}>
                <th style={{ padding: '7px 16px', width: 140 }}>Effective from</th><th style={{ padding: '7px 10px' }}>Values</th><th style={{ padding: '7px 10px' }}>Note</th><th style={{ width: 50 }} />
              </tr></thead>
              <tbody>
                {list.map(r => (
                  <tr key={r.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '7px 16px' }}>{fd(r.effective_from)}</td>
                    <td style={{ padding: '7px 10px' }}>{summary(s.code, r.params)}</td>
                    <td style={{ padding: '7px 10px', color: /verify/i.test(r.note || '') ? '#b45309' : '#6b7280' }}>{r.note}</td>
                    <td>{canManageSystem && list.length > 1 && <button className="dg-action-btn delete" title="Delete" onClick={() => del(r)}>🗑</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      {edit && (
        <Modal title={`Change ${SECTIONS.find(s => s.code === edit.code).title}`} onClose={() => setEdit(null)}
          footer={<><GhostBtn onClick={() => setEdit(null)}>Cancel</GhostBtn><PrimaryBtn disabled={saving} onClick={save}>{saving ? 'Saving…' : '💾 Save'}</PrimaryBtn></>}>
          <Field label="Effective from" required hint="Payroll for periods ending on or after this date will use these values.">
            <DateInput value={edit.effectiveFrom} onChange={v => setEdit(e => ({ ...e, effectiveFrom: v }))} />
          </Field>
          {(edit.code === 'SSF' || edit.code === 'PF') && (<>
            <div style={{ display: 'flex', gap: 10 }}>
              <Field label="Employee %" required style={{ flex: 1 }}><TextIn type="number" step="0.01" value={edit.p.employeePct ?? ''} onChange={e => set('employeePct', e.target.value)} /></Field>
              <Field label="Employer %" required style={{ flex: 1 }}><TextIn type="number" step="0.01" value={edit.p.employerPct ?? ''} onChange={e => set('employerPct', e.target.value)} /></Field>
            </div>
            <Field label="Calculated on"><SelectIn value={edit.p.base || 'basic'} onChange={e => set('base', e.target.value)}>{BASES.map(b => <option key={b[0]} value={b[0]}>{b[1]}</option>)}</SelectIn></Field>
          </>)}
          {edit.code === 'LIMITS' && (<>
            <Field label="Retirement deduction — max % of income" hint="SSF/PF/CIT contributions reduce taxable income up to this share of income…">
              <TextIn type="number" step="0.01" value={edit.p.retirementMaxSharePct ?? ''} onChange={e => set('retirementMaxSharePct', e.target.value)} />
            </Field>
            <Field label="Retirement deduction — max amount per year" hint="…or this yearly amount, whichever is lower.">
              <TextIn type="number" value={edit.p.retirementLimitAnnual ?? ''} onChange={e => set('retirementLimitAnnual', e.target.value)} />
            </Field>
            <Field label="Insurance premium — max amount per year">
              <TextIn type="number" value={edit.p.insuranceLimitAnnual ?? ''} onChange={e => set('insuranceLimitAnnual', e.target.value)} />
            </Field>
          </>)}
          {edit.code === 'POLICY' && (<>
            <Field label="Days in a month for salary" hint="Daily rate = monthly pay ÷ this number of days."><SelectIn value={edit.p.daysBasis || 'calendar'} onChange={e => set('daysBasis', e.target.value)}>
              <option value="calendar">Actual calendar days of the period</option><option value="30">Fixed 30 days</option><option value="26">Fixed 26 days</option></SelectIn></Field>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
              <input type="checkbox" checked={edit.p.deductAbsent !== false} onChange={e => set('deductAbsent', e.target.checked)} /> Deduct pay for absent days
            </label>
            <Field label="Unpaid leave types (leave codes, comma separated)" hint="Approved leave with these codes reduces pay, e.g. LWP, UL. Leave blank if every leave is paid.">
              <TextIn value={edit.p.unpaidLeaveCodes ?? ''} onChange={e => set('unpaidLeaveCodes', e.target.value)} placeholder="e.g. LWP" />
            </Field>
          </>)}
          <Field label="Note"><TextIn value={edit.note} onChange={e => setEdit(x => ({ ...x, note: e.target.value }))} placeholder="e.g. Budget FY 2083/84" /></Field>
          {error && <span style={{ fontSize: 12, color: '#dc2626' }}>{error}</span>}
        </Modal>
      )}
      {node}
    </div>
  );
}
