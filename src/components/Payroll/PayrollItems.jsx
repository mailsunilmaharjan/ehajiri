import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import DataGrid from '../DataGrid/DataGrid.jsx';
import SaveButton from '../Common/SaveButton.jsx';
import useSaveShortcut from '../../hooks/useSaveShortcut.js';

/* Settings → Payroll Items (Payroll → Settings → Payroll Items) — the
   configurable salary components a future payroll run would be built from
   (Basic, HRA, Provident Fund, TDS, ...). Plain setup-list CRUD against the
   generic /api/settings/:list endpoint (payrollItems -> payroll_items, see
   SETUP_TABLES in server/routes/settings.js), same pattern as
   TaskLookupPage.jsx. No calculation engine yet — this only stores the
   definition of each item. */

const TYPE_OPTS = [
  { value: 'earning',   label: 'Earning' },
  { value: 'deduction', label: 'Deduction' },
];
const CALC_OPTS = [
  { value: 'fixed',            label: 'Fixed Amount' },
  { value: 'percent_of_basic', label: '% of Basic' },
  { value: 'months_of_basic',  label: 'Months of Basic (e.g. 1 = one month\'s basic)' },
  { value: 'formula',          label: 'Formula' },
];
const PAYMENT_MODE_OPTS = [
  { value: 'monthly',    label: 'Monthly (every pay run)' },
  { value: 'yearly',     label: 'Yearly (once a year, e.g. Festival Bonus)' },
  { value: 'need_basis', label: 'Case basis (assigned per employee, e.g. Maternity)' },
];
const PAYMENT_MODE_LABEL = Object.fromEntries(PAYMENT_MODE_OPTS.map(o => [o.value, o.label]));
const TYPE_STYLE = {
  earning:   { bg: '#f0fdf4', color: '#065f46', label: 'Earning' },
  deduction: { bg: '#fff5f5', color: '#991b1b', label: 'Deduction' },
};

const CATEGORY_OPTS = [{ value: 'allowance', label: 'Allowance' }, { value: 'bonus', label: 'Bonus' }];
const GENDER_OPTS = [{ value: 'all', label: 'All employees' }, { value: 'female', label: 'Female only' }, { value: 'male', label: 'Male only' }];
const PAYMENT_HINT = {
  monthly: 'Added to every payroll run for employees this item is assigned to (Payroll → Salary Setup).',
  yearly: 'Paid once per fiscal year, in the run where you tick it. The system blocks a second payment in the same year.',
  need_basis: 'Not paid automatically. Assign it to an employee with dates under Payroll → Salary Setup → Cases (e.g. maternity allowance).',
};
const emptyForm = { name: '', type: 'earning', calcMethod: 'fixed', calcValue: '', formula: '', taxable: true, paymentMode: 'monthly', category: 'allowance', appliesGender: 'all', prorate: true };

const PayrollItems = () => {
  const navigate = useNavigate();
  const { canManageSystem } = useAuth();

  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal,   setModal]   = useState(false);
  const [editId,  setEditId]  = useState(null);
  const [form,    setForm]    = useState(emptyForm);
  const [error,   setError]   = useState('');
  const [saving,  setSaving]  = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [toast, setToast] = useState(null);
  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

  const load = () => {
    setLoading(true);
    api.get('/settings/payrollItems').then(rows => setItems(Array.isArray(rows) ? rows : []))
      .catch(e => showToast(e.message || 'Failed to load', 'error'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const openAdd  = () => { setEditId(null); setForm(emptyForm); setError(''); setModal(true); };
  const openEdit = (row) => {
    setEditId(row.id);
    setForm({
      name: row.name || '', type: row.type || 'earning', calcMethod: row.calcMethod || 'fixed',
      calcValue: row.calcValue != null ? String(row.calcValue) : '', formula: row.formula || '',
      taxable: row.taxable !== false, paymentMode: row.paymentMode || 'monthly',
      category: row.category || 'allowance', appliesGender: row.appliesGender || 'all', prorate: row.prorate !== false,
    });
    setError(''); setModal(true);
  };

  const save = async () => {
    if (!form.name.trim()) { setError('Name is required'); return; }
    if (form.calcMethod === 'formula' && !form.formula.trim()) { setError('Formula is required'); return; }
    if (form.calcMethod !== 'formula' && form.calcValue === '') { setError('Value is required'); return; }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      type: form.type,
      calcMethod: form.calcMethod,
      calcValue: form.calcMethod === 'formula' ? null : Number(form.calcValue),
      formula: form.calcMethod === 'formula' ? form.formula.trim() : null,
      taxable: form.taxable,
      paymentMode: form.paymentMode,
      category: form.category, appliesGender: form.appliesGender, prorate: form.prorate,
      rankingOrder: editId ? undefined : items.length + 1,
    };
    try {
      if (editId) await api.put(`/settings/payrollItems/${editId}`, payload);
      else        await api.post('/settings/payrollItems', payload);
      showToast(editId ? 'Updated' : 'Added');
      if (editId) {
        // Editing an existing item — done, close as before.
        setModal(false);
      } else {
        // Adding — stay on the form, cleared, ready for the next item
        // instead of closing (matches the Setup section's behavior), so
        // entering a whole payroll structure in one sitting never needs
        // reopening the modal between each item.
        setForm(emptyForm);
        setEditId(null);
      }
      load();
    } catch (e) {
      setError(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };
  useSaveShortcut(modal, save);

  const remove = async (id) => {
    try {
      await api.delete(`/settings/payrollItems/${id}`);
      showToast('Deleted');
      setDeleteConfirm(null);
      load();
    } catch (e) { showToast(e.message || 'Delete failed', 'error'); }
  };

  const fmtCalc = (row) => {
    if (row.calcMethod === 'formula') return row.formula || '—';
    if (row.calcMethod === 'percent_of_basic') return `${row.calcValue ?? 0}% of Basic`;
    if (row.calcMethod === 'months_of_basic') return `${row.calcValue ?? 0} month(s) of Basic`;
    return `Fixed: ${row.calcValue ?? 0}`;
  };

  const columns = useMemo(() => {
    const cols = [
      { field: 'name', header: 'Name', minWidth: 160 },
      { field: 'type', header: 'Type', width: 110,
        render: v => {
          const s = TYPE_STYLE[v] || TYPE_STYLE.earning;
          return <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 20, background: s.bg, color: s.color }}>{s.label}</span>;
        } },
      { field: 'calcMethod', header: 'Calculation', minWidth: 160, render: (_, row) => fmtCalc(row) },
      { field: 'category', header: 'Category', width: 100, render: v => (v === 'bonus' ? 'Bonus' : 'Allowance') },
      { field: 'paymentMode', header: 'Payment Mode', width: 130, render: v => ({ monthly: 'Monthly', yearly: 'Yearly (once)', need_basis: 'Case basis' }[v] || 'Monthly') },
      { field: 'appliesGender', header: 'For', width: 90, render: v => ({ female: 'Female', male: 'Male' }[v] || 'All') },
      { field: 'prorate', header: 'Prorated', width: 90, align: 'center', render: v => (v === false ? 'No' : 'Yes') },
      { field: 'taxable', header: 'Taxable', width: 90, align: 'center',
        render: v => v === false
          ? <span style={{ color: '#991b1b', fontWeight: 700, fontSize: 12 }}>No</span>
          : <span style={{ color: '#065f46', fontWeight: 700, fontSize: 12 }}>Yes</span> },
    ];
    if (canManageSystem) {
      cols.push({
        field: 'actions', header: 'Actions', width: 90, align: 'center', sortable: false, filterable: false,
        render: (_, row) => (
          <div className="dg-actions">
            <button className="dg-action-btn edit"   title="Edit"   onClick={e => { e.stopPropagation(); openEdit(row); }}>✏️</button>
            <button className="dg-action-btn delete" title="Delete" onClick={e => { e.stopPropagation(); setDeleteConfirm(row.id); }}>🗑</button>
          </div>
        ),
      });
    }
    return cols;
  }, [canManageSystem]);

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => navigate('/payroll/dashboard')} title="Back to Payroll"
            style={{ border: '1px solid #d1d5db', background: '#fff', borderRadius: 8, width: 34, height: 34, cursor: 'pointer', fontSize: 15 }}>
            ←
          </button>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: 0 }}>⚙️ Payroll Items</h1>
        </div>
        {canManageSystem && (
          <button onClick={openAdd}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 18px', background: '#1a56db',
              color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(26,86,219,.25)' }}>
            + New Payroll Item
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ padding: 48, textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>Loading...</div>
      ) : (
        <DataGrid columns={columns} data={items} defaultPageSize={20} compact={true} showFilterButton={false}
          onRowDoubleClick={canManageSystem ? openEdit : undefined}
          onDeleteKey={canManageSystem ? (row) => setDeleteConfirm(row.id) : null}
          contextMenu={canManageSystem ? [
            { label: 'Edit',   icon: '✏️', onClick: (row) => openEdit(row) },
            'divider',
            { label: 'Delete', icon: '🗑', className: 'danger', onClick: (row) => setDeleteConfirm(row.id) },
          ] : undefined}
        />
      )}

      {modal && (
        <div className="modal-overlay">
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editId ? '✏️ Edit Payroll Item' : '+ New Payroll Item'}</h2>
              <button className="modal-close" onClick={() => setModal(false)}>✕</button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>
                  Name<span style={{ color: '#dc2626' }}> *</span>
                </label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} autoFocus
                  onKeyDown={e => e.key === 'Enter' && save()}
                  style={{ height: 36, border: `1px solid ${error && !form.name.trim() ? '#dc2626' : '#d1d5db'}`, borderRadius: 7, padding: '0 10px', fontSize: 13 }} />
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Type</label>
                  <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                    style={{ height: 36, border: '1px solid #d1d5db', borderRadius: 7, padding: '0 8px', fontSize: 13 }}>
                    {TYPE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Calculation</label>
                  <select value={form.calcMethod} onChange={e => setForm(f => ({ ...f, calcMethod: e.target.value }))}
                    style={{ height: 36, border: '1px solid #d1d5db', borderRadius: 7, padding: '0 8px', fontSize: 13 }}>
                    {CALC_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Category</label>
                  <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                    style={{ height: 36, border: '1px solid #d1d5db', borderRadius: 7, padding: '0 8px', fontSize: 13 }}>
                    {CATEGORY_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Applies to</label>
                  <select value={form.appliesGender} onChange={e => setForm(f => ({ ...f, appliesGender: e.target.value }))}
                    style={{ height: 36, border: '1px solid #d1d5db', borderRadius: 7, padding: '0 8px', fontSize: 13 }}>
                    {GENDER_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Payment Mode</label>
                <select value={form.paymentMode}
                  onChange={e => { const v = e.target.value; setForm(f => ({ ...f, paymentMode: v, prorate: v === 'monthly' ? true : false })); }}
                  style={{ height: 36, border: '1px solid #d1d5db', borderRadius: 7, padding: '0 8px', fontSize: 13 }}>
                  {PAYMENT_MODE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <span style={{ fontSize: 11, color: '#6b7280' }}>{PAYMENT_HINT[form.paymentMode]}</span>
              </div>

              {form.calcMethod === 'formula' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>
                    Formula<span style={{ color: '#dc2626' }}> *</span>
                  </label>
                  <input value={form.formula} onChange={e => setForm(f => ({ ...f, formula: e.target.value }))}
                    placeholder="e.g. Basic * 0.1 + Allowance"
                    style={{ height: 36, border: '1px solid #d1d5db', borderRadius: 7, padding: '0 10px', fontSize: 13 }} />
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>
                    {form.calcMethod === 'percent_of_basic' ? 'Percentage (%)' : form.calcMethod === 'months_of_basic' ? 'Number of months of Basic' : 'Amount'}<span style={{ color: '#dc2626' }}> *</span>
                  </label>
                  <input type="number" value={form.calcValue} onChange={e => setForm(f => ({ ...f, calcValue: e.target.value }))}
                    style={{ height: 36, border: '1px solid #d1d5db', borderRadius: 7, padding: '0 10px', fontSize: 13 }} />
                </div>
              )}

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#374151', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.taxable} onChange={e => setForm(f => ({ ...f, taxable: e.target.checked }))} />
                Taxable
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#374151', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.prorate} onChange={e => setForm(f => ({ ...f, prorate: e.target.checked }))} />
                Reduce for absent / unpaid-leave days
                <span style={{ fontSize: 11, color: '#6b7280' }}>(untick for bonuses and fixed case allowances)</span>
              </label>

              {error && <span style={{ fontSize: 11, color: '#dc2626' }}>{error}</span>}
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setModal(false)}>Cancel</button>
              <SaveButton onClick={save} disabled={saving} icon={saving ? '⏳' : '💾'} label={saving ? 'Saving…' : 'Save'} />
            </div>
          </div>
        </div>
      )}

      {deleteConfirm && (
        <div className="modal-overlay">
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>⚠️ Delete Payroll Item</h2>
              <button className="modal-close" onClick={() => setDeleteConfirm(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 14, color: '#374151' }}>Are you sure you want to delete this payroll item?</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => remove(deleteConfirm)}>🗑 Delete</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, padding: '12px 20px', borderRadius: 10,
          fontSize: 13, fontWeight: 600,
          background: toast.type === 'error' ? '#fef2f2' : '#f0fdf4',
          color:      toast.type === 'error' ? '#dc2626'  : '#065f46',
          border:     `1px solid ${toast.type === 'error' ? '#fecaca' : '#bbf7d0'}`,
          boxShadow: '0 4px 16px rgba(0,0,0,.12)' }}>
          {toast.type === 'error' ? '❌' : '✅'} {toast.msg}
        </div>
      )}
    </div>
  );
};

export default PayrollItems;
