import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import DataGrid from '../DataGrid/DataGrid.jsx';
import SaveButton from '../Common/SaveButton.jsx';
import useSaveShortcut from '../../hooks/useSaveShortcut.js';
import useDateFormat from '../../hooks/useDateFormat.js';

/* Settings → Payroll Tax Slab (Payroll → Settings → Payroll Tax Slab) —
   Nepal-style annual income tax brackets (income range + rate %), one set
   per Yearly Income Slab, active from its own Effective Date. Plain
   setup-list CRUD against the generic /api/settings/:list endpoint
   (payrollTaxSlabs -> payroll_tax_slabs, see SETUP_TABLES in
   server/routes/settings.js), same pattern as TaskLookupPage.jsx /
   PayrollItems.jsx. No calculation engine yet — this only stores the
   bracket definitions a future payroll run would apply. */

const emptyForm = { yearlyIncomeSlab: '', effectiveDate: '', incomeFrom: '0', incomeTo: '', ratePercent: '' };

const fmtNum = (v) => v == null ? '—' : Number(v).toLocaleString();

const PayrollTaxSlab = () => {
  const navigate = useNavigate();
  const { canManageSystem } = useAuth();
  const fd = useDateFormat();

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
    api.get('/settings/payrollTaxSlabs').then(rows => setItems(Array.isArray(rows) ? rows : []))
      .catch(e => showToast(e.message || 'Failed to load', 'error'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const openAdd  = () => { setEditId(null); setForm(emptyForm); setError(''); setModal(true); };
  const openEdit = (row) => {
    setEditId(row.id);
    setForm({
      yearlyIncomeSlab: row.yearlyIncomeSlab || '',
      effectiveDate: row.effectiveDate ? String(row.effectiveDate).split('T')[0] : '',
      incomeFrom: row.incomeFrom != null ? String(row.incomeFrom) : '0',
      incomeTo:   row.incomeTo   != null ? String(row.incomeTo)   : '',
      ratePercent: row.ratePercent != null ? String(row.ratePercent) : '',
    });
    setError(''); setModal(true);
  };

  const save = async () => {
    if (!form.yearlyIncomeSlab.trim()) { setError('Yearly Income Slab is required'); return; }
    if (!form.effectiveDate) { setError('Effective Date is required'); return; }
    if (form.incomeFrom === '' || form.ratePercent === '') { setError('Income From and Rate % are required'); return; }
    setSaving(true);
    const payload = {
      yearlyIncomeSlab: form.yearlyIncomeSlab.trim(),
      effectiveDate: form.effectiveDate,
      incomeFrom: Number(form.incomeFrom),
      incomeTo:   form.incomeTo === '' ? null : Number(form.incomeTo),
      ratePercent: Number(form.ratePercent),
      rankingOrder: editId ? undefined : items.length + 1,
    };
    try {
      if (editId) await api.put(`/settings/payrollTaxSlabs/${editId}`, payload);
      else        await api.post('/settings/payrollTaxSlabs', payload);
      showToast(editId ? 'Updated' : 'Added');
      setModal(false);
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
      await api.delete(`/settings/payrollTaxSlabs/${id}`);
      showToast('Deleted');
      setDeleteConfirm(null);
      load();
    } catch (e) { showToast(e.message || 'Delete failed', 'error'); }
  };

  const columns = useMemo(() => {
    const cols = [
      { field: 'yearlyIncomeSlab', header: 'Yearly Income Slab', width: 160 },
      { field: 'effectiveDate', header: 'Effective Date', width: 130,
        render: v => v ? fd(String(v).split('T')[0]) : '—' },
      { field: 'incomeFrom', header: 'Income From', width: 130, render: v => fmtNum(v) },
      { field: 'incomeTo',   header: 'Income To',   width: 130, render: v => v == null ? 'and above' : fmtNum(v) },
      { field: 'ratePercent', header: 'Rate %', width: 100, render: v => `${v ?? 0}%` },
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
  }, [canManageSystem, fd]);

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => navigate('/payroll/dashboard')} title="Back to Payroll"
            style={{ border: '1px solid #d1d5db', background: '#fff', borderRadius: 8, width: 34, height: 34, cursor: 'pointer', fontSize: 15 }}>
            ←
          </button>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: 0 }}>⚙️ Payroll Tax Slab</h1>
        </div>
        {canManageSystem && (
          <button onClick={openAdd}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 18px', background: '#1a56db',
              color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(26,86,219,.25)' }}>
            + New Tax Slab
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
              <h2>{editId ? '✏️ Edit Tax Slab' : '+ New Tax Slab'}</h2>
              <button className="modal-close" onClick={() => setModal(false)}>✕</button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>
                  Yearly Income Slab<span style={{ color: '#dc2626' }}> *</span>
                </label>
                <input value={form.yearlyIncomeSlab} onChange={e => setForm(f => ({ ...f, yearlyIncomeSlab: e.target.value }))} autoFocus
                  placeholder="e.g. 2082/83 Slab"
                  onKeyDown={e => e.key === 'Enter' && save()}
                  style={{ height: 36, border: '1px solid #d1d5db', borderRadius: 7, padding: '0 10px', fontSize: 13 }} />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>
                  Effective Date<span style={{ color: '#dc2626' }}> *</span>
                </label>
                <input type="date" value={form.effectiveDate} onChange={e => setForm(f => ({ ...f, effectiveDate: e.target.value }))}
                  style={{ height: 36, border: '1px solid #d1d5db', borderRadius: 7, padding: '0 10px', fontSize: 13 }} />
                <span style={{ fontSize: 11, color: '#9ca3af' }}>The date this slab starts applying from.</span>
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>
                    Income From<span style={{ color: '#dc2626' }}> *</span>
                  </label>
                  <input type="number" value={form.incomeFrom} onChange={e => setForm(f => ({ ...f, incomeFrom: e.target.value }))}
                    style={{ height: 36, border: '1px solid #d1d5db', borderRadius: 7, padding: '0 10px', fontSize: 13 }} />
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Income To</label>
                  <input type="number" value={form.incomeTo} onChange={e => setForm(f => ({ ...f, incomeTo: e.target.value }))}
                    placeholder="blank = and above"
                    style={{ height: 36, border: '1px solid #d1d5db', borderRadius: 7, padding: '0 10px', fontSize: 13 }} />
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>
                  Rate %<span style={{ color: '#dc2626' }}> *</span>
                </label>
                <input type="number" value={form.ratePercent} onChange={e => setForm(f => ({ ...f, ratePercent: e.target.value }))}
                  style={{ height: 36, border: '1px solid #d1d5db', borderRadius: 7, padding: '0 10px', fontSize: 13 }} />
              </div>

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
              <h2>⚠️ Delete Tax Slab</h2>
              <button className="modal-close" onClick={() => setDeleteConfirm(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 14, color: '#374151' }}>Are you sure you want to delete this tax slab?</p>
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

export default PayrollTaxSlab;
