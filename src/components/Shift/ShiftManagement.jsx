import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useLanguage } from '../../context/LanguageContext.jsx';
import { useData } from '../../context/DataContext.jsx';
import DataGrid from '../DataGrid/DataGrid.jsx';
import SaveButton from '../Common/SaveButton.jsx';
import useSaveShortcut from '../../hooks/useSaveShortcut.js';
import useNewShortcut from '../../hooks/useNewShortcut.js';

const DAYS = [
  { key: 'Sun', label: 'आ' }, { key: 'Mon', label: 'सो' }, { key: 'Tue', label: 'मं' },
  { key: 'Wed', label: 'बु' }, { key: 'Thu', label: 'बि' }, { key: 'Fri', label: 'शु' }, { key: 'Sat', label: 'श' }
];
const COLORS = ['#1a56db', '#0e9f6e', '#e3a008', '#f05252', '#7e3af2', '#e74694', '#111827'];

const defaultForm = {
  name: '', nameEn: '', code: '',
  startTime: '09:00', endTime: '17:00', workHours: 8,
  days: ['Sun','Mon','Tue','Wed','Thu','Fri'],
  color: '#1a56db', active: true,
};

const ShiftManagement = () => {
  const { isAdmin, isManager } = useAuth();
  const { t } = useLanguage();
  const { shifts, addShift, updateShift, deleteShift, employees } = useData();
  const [modal, setModal]               = useState(null);
  const [form, setForm]                 = useState(defaultForm);
  const [editId, setEditId]             = useState(null);
  const [errors, setErrors]             = useState({});
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [assignModal, setAssignModal]   = useState(null);
  const [assignEmpId, setAssignEmpId]   = useState('');
  const [toast, setToast]               = useState(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  };

  const calcHours = (start, end) => {
    if (!start || !end) return 0;
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    let diff = (eh * 60 + em) - (sh * 60 + sm);
    if (diff < 0) diff += 24 * 60;
    return Math.round(diff / 60 * 10) / 10;
  };

  const handleChange = (field, val) => {
    const updated = { ...form, [field]: val };
    if (field === 'startTime' || field === 'endTime')
      updated.workHours = calcHours(updated.startTime, updated.endTime);
    setForm(updated);
    setErrors(p => ({ ...p, [field]: '' }));
  };

  const toggleDay = (day) => {
    setForm(p => ({
      ...p,
      days: p.days.includes(day) ? p.days.filter(d => d !== day) : [...p.days, day],
    }));
  };

  const validate = () => {
    const e = {};
    if (!form.name.trim())  e.name      = t('Required field');
    if (!form.code.trim())  e.code      = t('Required field');
    if (!form.startTime)    e.startTime = t('Required field');
    if (!form.endTime)      e.endTime   = t('Required field');
    if (form.days.length === 0) e.days  = 'कम्तीमा एक दिन छान्नुस';
    return e;
  };

  const openAdd  = () => { setForm(defaultForm); setErrors({}); setEditId(null); setModal('edit'); };
  const openEdit = (s) => { setForm({ ...s }); setErrors({}); setEditId(s.id); setModal('edit'); };

  const handleSave = () => {
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    if (editId) { updateShift(editId, form); showToast(t('Record updated successfully')); }
    else        { addShift(form);            showToast(t('Record saved successfully')); }
    setModal(null);
  };

  /* Ctrl+S saves the Shift modal — same action as the Save button */
  useSaveShortcut(modal === 'edit', handleSave);
  /* Ctrl+N opens the Add Shift modal when not currently editing/adding */
  useNewShortcut(!modal, openAdd);

  const handleDelete = async (id) => {
    try {
      await deleteShift(id);
      setDeleteConfirm(null);
      showToast(t('Record deleted successfully'));
    } catch (e) {
      setDeleteConfirm(null);
      showToast(e.message || 'Cannot delete this shift', 'error');
    }
  };

  const handleAssign = () => {
    if (assignEmpId && assignModal) {
      showToast('सिफ्ट तोकिएको छ');
      setAssignModal(null);
      setAssignEmpId('');
    }
  };

  const columns = [
    { field: 'name', header: t('Shift Management'), width: 150, render: (v, row) => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 12, height: 12, borderRadius: 3, background: row.color, flexShrink: 0 }}></div>
        <span style={{ fontWeight: 600 }}>{v}</span>
      </div>
    )},
    { field: 'code',      header: t('Code'),         width: 80,  align: 'center' },
    { field: 'startTime', header: t('Start Time'),   width: 100, align: 'center' },
    { field: 'endTime',   header: t('End Time'),     width: 100, align: 'center' },
    { field: 'workHours', header: t('Work Hours'),   width: 100, align: 'center', render: v => `${v} घण्टा` },
    { field: 'days',      header: t('Working Days'), width: 180, render: v => (
      <div style={{ display: 'flex', gap: 3 }}>
        {DAYS.map(d => (
          <span key={d.key} style={{
            width: 22, height: 22, borderRadius: 4,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, fontWeight: 700,
            background: v?.includes(d.key) ? '#dbeafe' : '#f3f4f6',
            color:      v?.includes(d.key) ? '#1a56db' : '#9ca3af',
          }}>{d.label}</span>
        ))}
      </div>
    )},
    { field: 'active', header: t('Status'), width: 90, align: 'center', render: v => (
      <span className={`badge ${v ? 'badge-success' : 'badge-gray'}`}>{v ? t('Active') : t('Inactive')}</span>
    )},
    { field: 'isSystem', header: '', width: 32, filterable: false, sortable: false, render: v =>
      v ? <span title="System shift — cannot be deleted" style={{ fontSize: 13 }}>🔒</span> : null
    },
    ...(isAdmin || isManager ? [{
      field: 'actions', header: t('Actions'), width: 110, filterable: false, sortable: false,
      render: (_, row) => (
        <div className="dg-actions">
          <button className="dg-action-btn edit"   title={t('Edit')}         onClick={e => { e.stopPropagation(); openEdit(row); }}>✏</button>
          <button className="dg-action-btn view"   title={t('Assign Shift')} onClick={e => { e.stopPropagation(); setAssignModal(row); }}>👤</button>
          {isAdmin && (
            <button
              className="dg-action-btn delete"
              title={row.isSystem ? 'System shift — cannot be deleted' : t('Delete')}
              style={row.isSystem ? { opacity: 0.35, cursor: 'not-allowed' } : {}}
              onClick={e => { e.stopPropagation(); if (!row.isSystem) setDeleteConfirm(row.id); }}
            >🗑</button>
          )}
        </div>
      ),
    }] : []),
  ];

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">⏰ {t('Shift Management')}</h1>
          <p className="page-subtitle">{shifts.filter(s => s.active).length} {t('Active')} {t('Shift')}</p>
        </div>
        {(isAdmin || isManager) && (
          <button className="btn btn-primary" onClick={openAdd}>+ {t('Add New Shift')}</button>
        )}
      </div>

      {/* Shift overview cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14, marginBottom: 20 }}>
        {shifts.map(s => (
          <div key={s.id} style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 10, padding: '16px 18px', borderLeft: `4px solid ${s.color}`, boxShadow: '0 1px 3px rgba(0,0,0,.06)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>{s.name}</div>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{s.nameEn}</div>
              </div>
              <span className={`badge ${s.active ? 'badge-success' : 'badge-gray'}`} style={{ fontSize: 10 }}>
                {s.active ? t('Active') : t('Inactive')}
              </span>
            </div>
            <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
              <div><span style={{ color: '#9ca3af' }}>सुरु:</span> <strong>{s.startTime}</strong></div>
              <div><span style={{ color: '#9ca3af' }}>अन्त्य:</span> <strong>{s.endTime}</strong></div>
              <div><span style={{ color: '#9ca3af' }}>घण्टा:</span> <strong>{s.workHours}</strong></div>
              <div><span style={{ color: '#9ca3af' }}>कर्मचारी:</span> <strong>{employees.filter(e => e.shift === s.code).length}</strong></div>
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 3 }}>
              {DAYS.map(d => (
                <div key={d.key} style={{
                  width: 22, height: 22, borderRadius: 4,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 700,
                  background: s.days.includes(d.key) ? `${s.color}22` : '#f3f4f6',
                  color:      s.days.includes(d.key) ? s.color : '#9ca3af',
                }}>{d.label}</div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <DataGrid
        columns={columns}
        data={shifts}
        defaultPageSize={10}
        showSearch={true}
        searchPlaceholder={t('Search') + '...'}
        title={t('Shift Management')}
        compact={true}
        onRowDoubleClick={isAdmin || isManager ? openEdit : null}
      />

      {/* Add / Edit Modal */}
      {modal === 'edit' && (
        <div className="modal-overlay">
          <div className="modal modal-md" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editId ? `✏️ ${t('Edit Shift')}` : `+ ${t('Add New Shift')}`}</h2>
              <button className="modal-close" onClick={() => setModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label required">नेपाली नाम</label>
                  <input type="text" className={`form-control ${errors.name ? 'error' : ''}`}
                    placeholder="बिहान सिफ्ट" value={form.name}
                    onChange={e => handleChange('name', e.target.value)} />
                  {errors.name && <div className="form-error">{errors.name}</div>}
                </div>
                <div className="form-group">
                  <label className="form-label">English Name</label>
                  <input type="text" className="form-control" placeholder="Morning Shift"
                    value={form.nameEn} onChange={e => handleChange('nameEn', e.target.value)} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label required">{t('Code')}</label>
                  <input type="text" className={`form-control ${errors.code ? 'error' : ''}`}
                    placeholder="morning" value={form.code}
                    onChange={e => handleChange('code', e.target.value.toLowerCase())} />
                  {errors.code && <div className="form-error">{errors.code}</div>}
                </div>
                <div className="form-group">
                  <label className="form-label">{t('Work Hours')}</label>
                  <input type="number" className="form-control" value={form.workHours} readOnly
                    style={{ background: '#f9fafb' }} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label required">{t('Start Time')}</label>
                  <input type="time" className={`form-control ${errors.startTime ? 'error' : ''}`}
                    value={form.startTime} onChange={e => handleChange('startTime', e.target.value)} />
                  {errors.startTime && <div className="form-error">{errors.startTime}</div>}
                </div>
                <div className="form-group">
                  <label className="form-label required">{t('End Time')}</label>
                  <input type="time" className={`form-control ${errors.endTime ? 'error' : ''}`}
                    value={form.endTime} onChange={e => handleChange('endTime', e.target.value)} />
                  {errors.endTime && <div className="form-error">{errors.endTime}</div>}
                </div>
              </div>

              {/* Working Days */}
              <div className="form-group">
                <label className="form-label required">{t('Working Days')}</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {DAYS.map(d => (
                    <button key={d.key} type="button" onClick={() => toggleDay(d.key)}
                      style={{
                        width: 40, height: 40, borderRadius: 8,
                        border: `2px solid ${form.days.includes(d.key) ? form.color : '#e5e7eb'}`,
                        background: form.days.includes(d.key) ? form.color : '#f9fafb',
                        color: form.days.includes(d.key) ? 'white' : '#6b7280',
                        fontWeight: 700, cursor: 'pointer', fontSize: 13,
                      }}>
                      {d.label}
                    </button>
                  ))}
                </div>
                {errors.days && <div className="form-error">{errors.days}</div>}
              </div>

              {/* Color */}
              <div className="form-group">
                <label className="form-label">रंग</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {COLORS.map(c => (
                    <button key={c} type="button" onClick={() => handleChange('color', c)}
                      style={{
                        width: 28, height: 28, borderRadius: 6, background: c,
                        border: form.color === c ? '3px solid #1f2937' : '2px solid transparent',
                        cursor: 'pointer',
                      }}></button>
                  ))}
                </div>
              </div>

              {/* Active toggle */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <label style={{ fontSize: 13, fontWeight: 500 }}>{t('Active')}</label>
                <label style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.active}
                    onChange={e => handleChange('active', e.target.checked)}
                    style={{ opacity: 0, width: 0, height: 0 }} />
                  <div style={{ width: 44, height: 24, background: form.active ? '#1a56db' : '#d1d5db', borderRadius: 12, transition: 'background .2s', position: 'relative' }}>
                    <div style={{ position: 'absolute', top: 2, left: form.active ? 22 : 2, width: 20, height: 20, background: 'white', borderRadius: '50%', transition: 'left .2s' }}></div>
                  </div>
                </label>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setModal(null)}>{t('Cancel')}</button>
              <SaveButton onClick={handleSave} label={t('Save')} />
            </div>
          </div>
        </div>
      )}

      {/* Assign Shift Modal */}
      {assignModal && (
        <div className="modal-overlay">
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>👤 {t('Assign Shift')} — {assignModal.name}</h2>
              <button className="modal-close" onClick={() => setAssignModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">{t('Employee')}</label>
                <select className="form-control" value={assignEmpId} onChange={e => setAssignEmpId(e.target.value)}>
                  <option value="">— {t('Select')} —</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.fullName} ({e.employeeId})</option>)}
                </select>
              </div>
              <div style={{ fontSize: 13, color: '#6b7280', background: '#f9fafb', borderRadius: 6, padding: 10 }}>
                <strong>{t('Current')} {t('Shift')}: </strong>
                {assignEmpId ? (employees.find(e => e.id === +assignEmpId)?.shift || '—') : '—'}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setAssignModal(null)}>{t('Cancel')}</button>
              <button className="btn btn-primary" onClick={handleAssign}>💾 {t('Assign')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {deleteConfirm && (
        <div className="modal-overlay">
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>⚠️ {t('Delete Confirmation')}</h2>
              <button className="modal-close" onClick={() => setDeleteConfirm(null)}>✕</button>
            </div>
            <div className="modal-body"><p>{t('Are you sure you want to delete this record?')}</p></div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setDeleteConfirm(null)}>{t('Cancel')}</button>
              <button className="btn btn-danger" onClick={() => handleDelete(deleteConfirm)}>🗑 {t('Delete')}</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast-container">
          <div className={`toast toast-${toast.type}`}>
            <span>{toast.type === 'success' ? '✅' : '❌'}</span> {toast.msg}
          </div>
        </div>
      )}
    </div>
  );
};

export default ShiftManagement;
