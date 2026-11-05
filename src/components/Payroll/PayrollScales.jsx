import React, { useState, useEffect, useCallback } from 'react';
import api from '../../api/client.js';
import useDateFormat from '../../hooks/useDateFormat.js';
import { PageHeader, PrimaryBtn, GhostBtn, Modal, Field, TextIn, DateInput, useToast, todayISO, money } from './payrollUi.jsx';

/* Payroll → Pay Scales (government-style). A grade = starting salary + grades earned × grade rate (the yearly grade increment).
   When the government revises the scale, add the new scale (new effective date, same grade codes) and "Apply to employees". */

const emptyGrade = () => ({ code: '', label: '', startSalary: '', gradeRate: '', maxGrades: '' });

export default function PayrollScales() {
  const fd = useDateFormat();
  const [scales, setScales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);
  const [apply, setApply] = useState(null);
  const [paste, setPaste] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toast, node] = useToast();

  const load = useCallback(() => { api.get('/payroll/scales').then(setScales).catch(e => toast(e.message, 'error')).finally(() => setLoading(false)); }, [toast]);
  useEffect(() => { load(); }, [load]);

  const openNew = (from) => {
    setError(''); setPaste('');
    setForm(from
      ? { name: `${from.name} (revised)`, effectiveFrom: todayISO(), note: '', grades: from.grades.map(g => ({ ...g })) }
      : { name: '', effectiveFrom: todayISO(), note: '', grades: [emptyGrade()] });
  };
  const openEdit = (s) => { setError(''); setPaste(''); setForm({ id: s.id, name: s.name, effectiveFrom: s.effective_from, note: s.note || '', grades: s.grades.map(g => ({ ...g, maxGrades: g.maxGrades ?? '' })) }); };
  const setGrade = (i, k, v) => setForm(f => ({ ...f, grades: f.grades.map((g, j) => (j === i ? { ...g, [k]: v } : g)) }));

  const importPaste = () => {
    const rows = paste.split(/\r?\n/).map(l => l.split(/\t|,/).map(x => x.trim())).filter(r => r.length >= 4 && r[0]);
    if (!rows.length) { setError('Paste lines like: SO, Section Officer, 48056, 1602, 10'); return; }
    setForm(f => ({ ...f, grades: [...f.grades.filter(g => g.code || g.label), ...rows.map(r => ({ code: r[0], label: r[1], startSalary: r[2], gradeRate: r[3], maxGrades: r[4] || '' }))] }));
    setPaste(''); setError('');
  };

  const save = async () => {
    setSaving(true); setError('');
    try {
      const body = { ...form, grades: form.grades.filter(g => g.code || g.label) };
      if (form.id) await api.put(`/payroll/scales/${form.id}`, body); else await api.post('/payroll/scales', body);
      toast('Pay scale saved'); setForm(null); load();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };
  const del = async (s) => { if (window.confirm(`Delete "${s.name}"?`)) await api.delete(`/payroll/scales/${s.id}`).then(load).catch(e => toast(e.message, 'error')); };

  const openApply = async (s) => {
    setError('');
    const a = { scale: s, effectiveDate: s.effective_from, preview: null };
    setApply(a);
    const p = await api.post(`/payroll/scales/${s.id}/apply`, { effectiveDate: a.effectiveDate, dryRun: true }).catch(e => { setError(e.message); return null; });
    if (p) setApply({ ...a, preview: p });
  };
  const refreshPreview = async (date) => {
    setApply(a => ({ ...a, effectiveDate: date, preview: null }));
    const p = await api.post(`/payroll/scales/${apply.scale.id}/apply`, { effectiveDate: date, dryRun: true }).catch(e => { setError(e.message); return null; });
    if (p) setApply(a => ({ ...a, preview: p }));
  };
  const doApply = async () => {
    setSaving(true);
    try { const r = await api.post(`/payroll/scales/${apply.scale.id}/apply`, { effectiveDate: apply.effectiveDate }); toast(`${r.revised} employee(s) moved to the new scale`); setApply(null); load(); }
    catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  if (loading) return <div style={{ padding: 48, textAlign: 'center', color: '#9ca3af' }}>Loading…</div>;
  return (
    <div style={{ padding: '20px 24px' }}>
      <PageHeader title="🏛️ Pay Scales (government grades)"><PrimaryBtn onClick={() => openNew(null)}>+ New pay scale</PrimaryBtn></PageHeader>
      <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af', borderRadius: 10, padding: '10px 14px', fontSize: 12.5, marginBottom: 16, lineHeight: 1.5 }}>
        Enter the grades from your official salary sheet: <b>starting salary</b>, the <b>grade rate</b> added for each year of grade, and the maximum grades (if any).
        Employees linked to a grade get <b>basic = starting salary</b> and <b>grade amount = grades earned × grade rate</b>; the yearly “Next grade” increment adds one grade.
        Allowances such as the incentive allowance (a % of basic) and the dearness allowance (fixed) are set up as Payroll Items.
        <b> Nothing is pre-filled — figures must come from the official Ministry of Finance sheet.</b>
      </div>
      {scales.length === 0 && <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>No pay scales yet. Click “New pay scale”.</div>}
      {scales.map(s => (
        <div key={s.id} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #e2e8f0', flexWrap: 'wrap', gap: 8 }}>
            <div><div style={{ fontWeight: 800, color: '#111827' }}>{s.name}</div><div style={{ fontSize: 12, color: '#6b7280' }}>Effective {fd(s.effective_from)} · {s.grades.length} grades · {s.in_use} salary record(s) use it{s.note ? ` · ${s.note}` : ''}</div></div>
            <div style={{ display: 'flex', gap: 6 }}>
              <GhostBtn onClick={() => openApply(s)}>➡ Apply to employees</GhostBtn><GhostBtn onClick={() => openNew(s)}>⎘ Copy as new</GhostBtn>
              <GhostBtn onClick={() => openEdit(s)}>✏️ Edit</GhostBtn>{s.in_use === 0 && <GhostBtn onClick={() => del(s)}>🗑</GhostBtn>}
            </div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ background: '#efefef', color: '#374151', textAlign: 'left' }}><th style={{ padding: '7px 16px' }}>Code</th><th>Grade / post</th><th style={{ textAlign: 'right' }}>Starting salary</th><th style={{ textAlign: 'right' }}>Grade rate</th><th style={{ textAlign: 'right', paddingRight: 16 }}>Max grades</th></tr></thead>
            <tbody>{s.grades.map(g => (
              <tr key={g.id} style={{ borderTop: '1px solid #f1f5f9' }}><td style={{ padding: '7px 16px', fontWeight: 600 }}>{g.code}</td><td>{g.label}</td><td style={{ textAlign: 'right' }}>{money(g.startSalary)}</td><td style={{ textAlign: 'right' }}>{money(g.gradeRate)}</td><td style={{ textAlign: 'right', paddingRight: 16 }}>{g.maxGrades ?? '—'}</td></tr>))}</tbody>
          </table>
        </div>
      ))}

      {form && (
        <Modal wide title={form.id ? 'Edit pay scale' : 'New pay scale'} onClose={() => setForm(null)}
          footer={<><GhostBtn onClick={() => setForm(null)}>Cancel</GhostBtn><PrimaryBtn disabled={saving} onClick={save}>{saving ? 'Saving…' : '💾 Save'}</PrimaryBtn></>}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 2fr', gap: 10 }}>
            <Field label="Scale name" required><TextIn value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Civil Service 2083/84" /></Field>
            <Field label="Effective from" required><DateInput value={form.effectiveFrom} onChange={v => setForm(f => ({ ...f, effectiveFrom: v }))} /></Field>
            <Field label="Note"><TextIn value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} placeholder="e.g. Ministry of Finance salary sheet, Shrawan 2083" /></Field>
          </div>
          <div style={{ fontWeight: 700, fontSize: 13 }}>Grades</div>
          <div style={{ display: 'grid', gridTemplateColumns: '90px 2fr 1fr 1fr 90px 36px', gap: 6, fontSize: 11.5, fontWeight: 700, color: '#6b7280' }}><span>Code</span><span>Grade / post</span><span>Starting salary</span><span>Grade rate</span><span>Max grades</span><span /></div>
          {form.grades.map((g, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '90px 2fr 1fr 1fr 90px 36px', gap: 6 }}>
              <TextIn value={g.code} onChange={e => setGrade(i, 'code', e.target.value)} placeholder="SO" />
              <TextIn value={g.label} onChange={e => setGrade(i, 'label', e.target.value)} placeholder="Section Officer" />
              <TextIn type="number" value={g.startSalary} onChange={e => setGrade(i, 'startSalary', e.target.value)} />
              <TextIn type="number" value={g.gradeRate} onChange={e => setGrade(i, 'gradeRate', e.target.value)} />
              <TextIn type="number" value={g.maxGrades} onChange={e => setGrade(i, 'maxGrades', e.target.value)} />
              <button className="btn btn-outline btn-sm" onClick={() => setForm(f => ({ ...f, grades: f.grades.filter((_, j) => j !== i) }))}>✕</button>
            </div>
          ))}
          <div><GhostBtn onClick={() => setForm(f => ({ ...f, grades: [...f.grades, emptyGrade()] }))}>+ Add grade</GhostBtn></div>
          <Field label="Or paste many grades" hint="One per line: code, name, starting salary, grade rate, max grades (comma- or tab-separated — copies straight from Excel).">
            <textarea value={paste} onChange={e => setPaste(e.target.value)} rows={3} placeholder={'SO, Section Officer, 48056, 1602, 10\nDS, Deputy Secretary, 53611, 1787, 10'} style={{ border: '1px solid #d1d5db', borderRadius: 7, padding: 8, fontSize: 13, fontFamily: 'inherit' }} />
          </Field>
          <div><GhostBtn onClick={importPaste} disabled={!paste.trim()}>⬇ Add pasted grades</GhostBtn></div>
          {error && <span style={{ fontSize: 12, color: '#dc2626' }}>{error}</span>}
        </Modal>
      )}

      {apply && (
        <Modal title={`Apply “${apply.scale.name}” to employees`} onClose={() => setApply(null)}
          footer={<><GhostBtn onClick={() => setApply(null)}>Cancel</GhostBtn><PrimaryBtn disabled={saving || !apply.preview || apply.preview.revise.length === 0} onClick={doApply}>{saving ? 'Applying…' : `Apply to ${apply.preview?.revise.length ?? 0} employee(s)`}</PrimaryBtn></>}>
          <div style={{ fontSize: 13, color: '#374151' }}>Moves every employee who is on a grade of an <b>older</b> scale to this scale's figures, keeping the grades they have earned. Their previous salary stays in history.</div>
          <Field label="New figures effective from" required><DateInput value={apply.effectiveDate} onChange={refreshPreview} /></Field>
          {!apply.preview ? <div style={{ color: '#9ca3af', fontSize: 13 }}>Checking…</div> : (<>
            {apply.preview.revise.length === 0 && <div style={{ color: '#6b7280', fontSize: 13 }}>No employee needs to be moved.</div>}
            {apply.preview.revise.map((r, i) => <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, borderBottom: '1px solid #f1f5f9', padding: '4px 0' }}><span>{r.name}</span><span>{money(r.from)} → <b>{money(r.to)}</b></span></div>)}
            {apply.preview.skipped.length > 0 && <div style={{ background: '#fffbeb', color: '#92400e', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}><b>Skipped:</b> {apply.preview.skipped.map(s => `${s.name} (${s.reason})`).join('; ')}</div>}
          </>)}
          {error && <span style={{ fontSize: 12, color: '#dc2626' }}>{error}</span>}
        </Modal>
      )}
      {node}
    </div>
  );
}
