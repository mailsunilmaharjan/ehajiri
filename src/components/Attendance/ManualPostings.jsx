import React, { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../../api/client.js';
import { useAuth }     from '../../context/AuthContext.jsx';
import { useData }     from '../../context/DataContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import DataGrid        from '../DataGrid/DataGrid.jsx';
import NepaliDatePicker  from '../Common/NepaliDatePicker.jsx';
import SearchableSelect  from '../Common/SearchableSelect.jsx';

const empty = { employeeId: '', date: '', checkIn: '', checkOut: '', remark: '', recommendedBy: '', approvedBy: '' };

const loadRecoApproval = () => {
  try { return JSON.parse(localStorage.getItem('ehajiri_reco_approval') || '{}'); } catch { return {}; }
};

const getRecoIds = (empId) => {
  if (!empId) return [];
  const saved = loadRecoApproval();
  const r = saved[String(empId)]?.reco;
  return Array.isArray(r) ? r.map(String) : (r ? [String(r)] : []);
};

const getApprovalIds = (empId) => {
  if (!empId) return [];
  const saved = loadRecoApproval();
  const a = saved[String(empId)]?.approval;
  return Array.isArray(a) ? a.map(String) : (a ? [String(a)] : []);
};

const TimeInput = ({ value, onChange, placeholder }) => (
  <input
    type="time"
    value={value}
    onChange={e => onChange(e.target.value)}
    placeholder={placeholder}
    style={{
      height: 36, width: '100%', border: '1px solid #d1d5db', borderRadius: 7,
      padding: '0 10px', fontSize: 13, boxSizing: 'border-box', outline: 'none',
    }}
  />
);

const DateInput = ({ value, onChange }) => {
  const { settings } = useSettings();
  if (settings.defaultCalendar === 'np') {
    return <NepaliDatePicker value={value} onChange={onChange} />;
  }
  return (
    <input
      type="date"
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        height: 36, width: '100%', border: '1px solid #d1d5db', borderRadius: 7,
        padding: '0 10px', fontSize: 13, boxSizing: 'border-box', outline: 'none',
      }}
    />
  );
};

const ManualPostings = () => {
  const { canManageSystem } = useAuth();
  const { filteredEmployees } = useData();
  const location = useLocation();

  const [records,       setRecords]       = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [modal,         setModal]         = useState(false);
  const [editId,        setEditId]        = useState(null);
  const [form,          setForm]          = useState(empty);
  const [errors,        setErrors]        = useState({});
  const [saving,        setSaving]        = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [toast,         setToast]         = useState(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.get('/attendance/manual-postings');
      setRecords(Array.isArray(data) ? data : []);
    } catch (e) {
      showToast(e.message || 'Failed to load', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  /* Auto-open add form if navigated from daily attendance with pre-filled data */
  useEffect(() => {
    const state = location.state;
    if (state?.employeeId) {
      setEditId(null);
      setForm({
        ...empty,
        employeeId : String(state.employeeId),
        date       : state.date || '',
      });
      setErrors({});
      setModal(true);
      window.history.replaceState({}, '');  // clear state so refresh doesn't reopen
    }
  }, []);

  const openAdd = () => {
    setEditId(null);
    setForm(empty);
    setErrors({});
    setModal(true);
  };

  const openEdit = (row) => {
    setEditId(row.id);
    setForm({
      employeeId    : String(row.employeeId),
      date          : row.date ? String(row.date).split('T')[0] : '',
      checkIn       : row.check_in  ? String(row.check_in).slice(0, 5) : '',
      checkOut      : row.check_out ? String(row.check_out).slice(0, 5) : '',
      remark        : row.remark || '',
      recommendedBy : row.recommendedById ? String(row.recommendedById) : '',
      approvedBy    : row.approvedById    ? String(row.approvedById)    : '',
    });
    setErrors({});
    setModal(true);
  };

  const validate = () => {
    const e = {};
    if (!form.employeeId) e.employeeId = 'Staff is required';
    if (!form.date)       e.date       = 'Date is required';
    return e;
  };

  const save = async () => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    setSaving(true);
    try {
      const payload = {
        employeeId    : Number(form.employeeId),
        date          : form.date,
        checkIn       : form.checkIn       || null,
        checkOut      : form.checkOut      || null,
        remark        : form.remark        || null,
        recommendedBy : form.recommendedBy ? Number(form.recommendedBy) : null,
        approvedBy    : form.approvedBy    ? Number(form.approvedBy)    : null,
      };
      if (editId) {
        await api.put(`/attendance/manual-postings/${editId}`, payload);
        showToast('Record updated successfully');
      } else {
        await api.post('/attendance/manual-postings', payload);
        showToast('Record posted successfully');
      }
      setModal(false);
      load();
    } catch (err) {
      showToast(err.message || 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    try {
      await api.delete(`/attendance/manual-postings/${id}`);
      showToast('Record deleted');
      setDeleteConfirm(null);
      load();
    } catch (e) {
      showToast(e.message || 'Delete failed', 'error');
    }
  };

  const fmt = (t) => {
    if (!t) return '—';
    const s = String(t).slice(0, 5);
    const [h, m] = s.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
  };

  const columns = useMemo(() => [
    {
      field: 'staffId', header: 'Staff ID',
      width: 100, minWidth: 90,
      render: (v) => <span style={{ fontWeight: 600, color: '#374151', fontSize: 12 }}>{v || '—'}</span>,
    },
    {
      field: 'fullName', header: 'Full Name',
      minWidth: 150,
    },
    {
      field: 'date', header: 'Date',
      width: 110,
      render: (v) => v ? String(v).split('T')[0] : '—',
    },
    {
      field: 'check_in', header: 'Check In',
      width: 100, align: 'center',
      render: (v) => (
        <span style={{ color: v ? '#065f46' : '#9ca3af', fontWeight: v ? 600 : 400 }}>
          {fmt(v)}
        </span>
      ),
    },
    {
      field: 'check_out', header: 'Check Out',
      width: 105, align: 'center',
      render: (v) => (
        <span style={{ color: v ? '#1e40af' : '#9ca3af', fontWeight: v ? 600 : 400 }}>
          {fmt(v)}
        </span>
      ),
    },
    {
      field: 'remark', header: 'Remark',
      minWidth: 160,
      render: (v) => v
        ? <span style={{ fontSize: 12, color: '#4b5563' }}>{v}</span>
        : <span style={{ color: '#d1d5db' }}>—</span>,
    },
    {
      field: 'recommendedByName', header: 'Recommended By',
      width: 145,
      render: (v) => <span style={{ fontSize: 12, color: '#6b7280' }}>{v || '—'}</span>,
    },
    {
      field: 'approvedByName', header: 'Approved By',
      width: 130,
      render: (v) => <span style={{ fontSize: 12, color: '#6b7280' }}>{v || '—'}</span>,
    },
    {
      field: 'createdBy', header: 'Posted By',
      width: 130,
      render: (v) => <span style={{ fontSize: 12, color: '#6b7280' }}>{v || '—'}</span>,
    },
    {
      field: 'created_at', header: 'Posted On',
      width: 130,
      render: (v) => v
        ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
        : '—',
    },
    {
      field: 'actions', header: 'Actions',
      width: 90, align: 'center', sortable: false, filterable: false,
      render: (_, row) => (
        <div className="dg-actions">
          {canManageSystem && (
            <>
              <button className="dg-action-btn edit"   title="Edit"   onClick={e => { e.stopPropagation(); openEdit(row); }}>✏️</button>
              <button className="dg-action-btn delete" title="Delete" onClick={e => { e.stopPropagation(); setDeleteConfirm(row.id); }}>🗑</button>
            </>
          )}
        </div>
      ),
    },
  ], [canManageSystem]);

  const f = (k) => (v) => setForm(p => ({ ...p, [k]: v }));

  // Employees allowed as Recommended By / Approved By for the selected employee
  const recoIds     = useMemo(() => getRecoIds(form.employeeId),     [form.employeeId]);
  const approvalIds = useMemo(() => getApprovalIds(form.employeeId), [form.employeeId]);
  const recoOptions     = useMemo(() => filteredEmployees.filter(e => recoIds.includes(String(e.id))),     [filteredEmployees, recoIds]);
  const approvalOptions = useMemo(() => filteredEmployees.filter(e => approvalIds.includes(String(e.id))), [filteredEmployees, approvalIds]);

  const field = (label, required, err, children) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>
        {label}{required && <span style={{ color: '#dc2626' }}> *</span>}
      </label>
      {children}
      {err && <span style={{ fontSize: 11, color: '#dc2626' }}>{err}</span>}
    </div>
  );

  return (
    <div style={{ padding: '20px 24px' }}>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: 0 }}>✍️ Manual Postings</h1>
          <p style={{ fontSize: 13, color: '#6b7280', margin: '4px 0 0' }}>Manually enter attendance check-in / check-out records for staff</p>
        </div>
        {canManageSystem && (
          <button
            onClick={openAdd}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '8px 18px', background: '#1a56db', color: '#fff',
              border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600,
              cursor: 'pointer', boxShadow: '0 2px 8px rgba(26,86,219,.25)',
            }}
          >
            + Add Manual Entry
          </button>
        )}
      </div>

      {/* DataGrid */}
      {loading ? (
        <div style={{ padding: 48, textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>Loading...</div>
      ) : (
        <DataGrid
          columns={columns}
          data={records}
          defaultPageSize={20}
          compact={true}
          showFilterButton={true}
          onRowDoubleClick={canManageSystem ? openEdit : undefined}
          onDeleteKey={canManageSystem ? (row) => setDeleteConfirm(row.id) : null}
          contextMenu={canManageSystem ? [
            { label: 'Edit',   icon: '✏️', onClick: (row) => openEdit(row) },
            'divider',
            { label: 'Delete', icon: '🗑', className: 'danger', onClick: (row) => setDeleteConfirm(row.id) },
          ] : undefined}
        />
      )}

      {/* Add / Edit Modal */}
      {modal && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editId ? '✏️ Edit Manual Entry' : '+ Add Manual Entry'}</h2>
              <button className="modal-close" onClick={() => setModal(false)}>✕</button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

              {field('Staff', true, errors.employeeId,
                <div style={{ outline: errors.employeeId ? '1.5px solid #dc2626' : 'none', borderRadius: 7 }}>
                  <SearchableSelect
                    value={form.employeeId}
                    onChange={v => setForm(p => ({ ...p, employeeId: v, recommendedBy: '', approvedBy: '' }))}
                    options={filteredEmployees.map(e => ({ value: String(e.id), label: `${e.fullName} (${e.employeeId})` }))}
                    placeholder="— Select Staff —"
                  />
                </div>
              )}

              {field('Date', true, errors.date,
                <DateInput value={form.date} onChange={f('date')} />
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {field('Check In Time', false, null,
                  <TimeInput value={form.checkIn} onChange={f('checkIn')} />
                )}
                {field('Check Out Time', false, null,
                  <TimeInput value={form.checkOut} onChange={f('checkOut')} />
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {field('Recommended By', false, null,
                  <SearchableSelect
                    value={form.recommendedBy}
                    onChange={v => setForm(p => ({ ...p, recommendedBy: v }))}
                    options={recoOptions.map(e => ({ value: String(e.id), label: e.fullName }))}
                    placeholder={!form.employeeId ? '— Select staff first —' : recoOptions.length === 0 ? 'No recommendator configured' : '— Select —'}
                    disabled={!form.employeeId || recoOptions.length === 0}
                  />
                )}
                {field('Approved By', false, null,
                  <SearchableSelect
                    value={form.approvedBy}
                    onChange={v => setForm(p => ({ ...p, approvedBy: v }))}
                    options={approvalOptions.map(e => ({ value: String(e.id), label: e.fullName }))}
                    placeholder={!form.employeeId ? '— Select staff first —' : approvalOptions.length === 0 ? 'No approver configured' : '— Select —'}
                    disabled={!form.employeeId || approvalOptions.length === 0}
                  />
                )}
              </div>

              {field('Remark / Reason', false, null,
                <textarea
                  value={form.remark}
                  onChange={e => setForm(p => ({ ...p, remark: e.target.value }))}
                  rows={3}
                  placeholder="Optional note or reason for manual posting..."
                  style={{
                    border: '1px solid #d1d5db', borderRadius: 7, padding: '8px 10px',
                    fontSize: 13, resize: 'vertical', outline: 'none', fontFamily: 'inherit',
                  }}
                />
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : editId ? '💾 Update' : '✔ Post Entry'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {deleteConfirm && (
        <div className="modal-overlay">
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header" style={{ background: 'linear-gradient(135deg,#fff5f5,#fef2f2)' }}>
              <h2>⚠️ Delete Entry</h2>
              <button className="modal-close" onClick={() => setDeleteConfirm(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 14, color: '#374151' }}>Are you sure you want to delete this manual posting?</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => remove(deleteConfirm)}>🗑 Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          padding: '12px 20px', borderRadius: 10, fontSize: 13, fontWeight: 600,
          background: toast.type === 'error' ? '#fef2f2' : '#f0fdf4',
          color:      toast.type === 'error' ? '#dc2626'  : '#065f46',
          border:     `1px solid ${toast.type === 'error' ? '#fecaca' : '#bbf7d0'}`,
          boxShadow: '0 4px 16px rgba(0,0,0,.12)',
        }}>
          {toast.type === 'error' ? '❌' : '✅'} {toast.msg}
        </div>
      )}
    </div>
  );
};

export default ManualPostings;
