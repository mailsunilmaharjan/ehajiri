import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import DataGrid from '../DataGrid/DataGrid.jsx';
import SaveButton from '../Common/SaveButton.jsx';
import useSaveShortcut from '../../hooks/useSaveShortcut.js';

/* Dedicated admin page for managing Task Category / Task Priority — reached
   from the gear-icon menu on the Task page (Staff > Task). Both lists are
   plain rows in the generic /api/settings/:list CRUD (task_categories /
   task_priorities — see SETUP_TABLES in server/routes/settings.js), so one
   component serves both, parametrized by `endpoint`/`title`/`withColor`. */
const TaskLookupPage = ({ title, endpoint, withColor = false }) => {
  const navigate = useNavigate();
  const { canManageSystem } = useAuth();

  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal,   setModal]   = useState(false);
  const [editId,  setEditId]  = useState(null);
  const [name,    setName]    = useState('');
  const [color,   setColor]   = useState('#1a56db');
  const [error,   setError]   = useState('');
  const [saving,  setSaving]  = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [toast, setToast] = useState(null);
  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

  const load = () => {
    setLoading(true);
    api.get(`/settings/${endpoint}`).then(rows => setItems(Array.isArray(rows) ? rows : []))
      .catch(e => showToast(e.message || 'Failed to load', 'error'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [endpoint]);

  const openAdd  = () => { setEditId(null); setName(''); setColor('#1a56db'); setError(''); setModal(true); };
  const openEdit = (row) => { setEditId(row.id); setName(row.name); setColor(row.color || '#1a56db'); setError(''); setModal(true); };

  const save = async () => {
    if (!name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    const payload = { name: name.trim(), ...(withColor ? { color } : {}), rankingOrder: editId ? undefined : items.length + 1 };
    try {
      if (editId) await api.put(`/settings/${endpoint}/${editId}`, payload);
      else        await api.post(`/settings/${endpoint}`, payload);
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
      await api.delete(`/settings/${endpoint}/${id}`);
      showToast('Deleted');
      setDeleteConfirm(null);
      load();
    } catch (e) { showToast(e.message || 'Delete failed', 'error'); }
  };

  const columns = useMemo(() => {
    const cols = [];
    if (withColor) {
      cols.push({
        field: 'color', header: '', width: 40, align: 'center', sortable: false, filterable: false,
        render: (v) => <span style={{ display: 'inline-block', width: 14, height: 14, borderRadius: '50%', background: v || '#94a3b8' }} />,
      });
    }
    cols.push({ field: 'name', header: 'Name', minWidth: 180 });
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
  }, [canManageSystem, withColor]);

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => navigate('/staff/task')} title="Back to Task"
            style={{ border: '1px solid #d1d5db', background: '#fff', borderRadius: 8, width: 34, height: 34, cursor: 'pointer', fontSize: 15 }}>
            ←
          </button>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: 0 }}>⚙️ {title}</h1>
        </div>
        {canManageSystem && (
          <button onClick={openAdd}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 18px', background: '#1a56db',
              color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(26,86,219,.25)' }}>
            + New {title}
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
              <h2>{editId ? `✏️ Edit ${title}` : `+ New ${title}`}</h2>
              <button className="modal-close" onClick={() => setModal(false)}>✕</button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>
                  {title} Name<span style={{ color: '#dc2626' }}> *</span>
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {withColor && <input type="color" value={color} onChange={e => setColor(e.target.value)} style={{ width: 36, height: 36, border: 'none', padding: 0, background: 'none' }} />}
                  <input value={name} onChange={e => setName(e.target.value)} autoFocus
                    onKeyDown={e => e.key === 'Enter' && save()}
                    style={{ flex: 1, height: 36, border: `1px solid ${error ? '#dc2626' : '#d1d5db'}`, borderRadius: 7, padding: '0 10px', fontSize: 13 }} />
                </div>
                {error && <span style={{ fontSize: 11, color: '#dc2626' }}>{error}</span>}
              </div>
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
              <h2>⚠️ Delete {title}</h2>
              <button className="modal-close" onClick={() => setDeleteConfirm(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 14, color: '#374151' }}>Are you sure you want to delete this {title.toLowerCase()}?</p>
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

export default TaskLookupPage;
