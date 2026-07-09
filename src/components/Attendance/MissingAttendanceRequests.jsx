import React, { useState, useEffect, useCallback } from 'react';
import { useAuth }     from '../../context/AuthContext.jsx';
import { useLanguage } from '../../context/LanguageContext.jsx';
import { useData }     from '../../context/DataContext.jsx';
import useDateFormat   from '../../hooks/useDateFormat.js';
import DataGrid         from '../DataGrid/DataGrid.jsx';
import api from '../../api/client.js';

const StatusBadge = ({ status }) => {
  const map = {
    pending:     { cls: 'badge-warning', label: 'Pending' },
    recommended: { cls: 'badge-info',    label: 'Recommended' },
    approved:    { cls: 'badge-success', label: 'Approved' },
    rejected:    { cls: 'badge-danger',  label: 'Rejected' },
  };
  const entry = map[status] || { cls: 'badge-gray', label: status };
  return <span className={`badge ${entry.cls}`}>{entry.label}</span>;
};

const MissingAttendanceRequests = () => {
  const { currentUser, isManager } = useAuth();
  const { employees } = useData();
  const { t } = useLanguage();
  const fd = useDateFormat();

  const [requests, setRequests] = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const [actionModal, setActionModal] = useState(null); // { id, type:'recommend'|'approve'|'reject', row }
  const [comment,     setComment]     = useState('');
  const [busy,        setBusy]        = useState(false);

  const getEmpName = (id) => employees.find(e => String(e.id) === String(id))?.fullName || `#${id}`;

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRequests(await api.get('/attendance/missing-requests')); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const myId = currentUser?.id;
  const assignedToMe = requests.filter(r =>
    (String(r.recommendedBy) === String(myId) && r.status === 'pending') ||
    (String(r.approvedBy) === String(myId) && ['pending', 'recommended'].includes(r.status)) ||
    (isManager && ['pending', 'recommended'].includes(r.status))
  );
  const myRequests = requests.filter(r => String(r.employeeId) === String(myId));

  const doAction = async () => {
    if (!actionModal) return;
    setBusy(true);
    try {
      await api.patch(`/attendance/missing-requests/${actionModal.id}/${actionModal.type}`, { comment });
      setActionModal(null); setComment('');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const cancelRequest = async (id) => {
    setBusy(true);
    try { await api.delete(`/attendance/missing-requests/${id}`); await load(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const assignedColumns = [
    { field: 'employeeName', header: 'Staff',      width: 160, render: (v, r) => v || getEmpName(r.employeeId) },
    { field: 'date',         header: 'Date',       width: 110, render: v => fd(v) },
    { field: 'checkIn',      header: 'Check In',   width: 90 },
    { field: 'checkOut',     header: 'Check Out',  width: 90 },
    { field: 'reason',       header: 'Reason',     width: 220 },
    { field: 'recommendedByName', header: 'Recommendator', width: 140, render: (v, r) => v || (r.recommendedBy ? getEmpName(r.recommendedBy) : '—') },
    { field: 'approvedByName',    header: 'Approver',      width: 140, render: (v, r) => v || (r.approvedBy ? getEmpName(r.approvedBy) : '—') },
    { field: 'status',       header: 'Status',     width: 110, render: v => <StatusBadge status={v} /> },
    { field: 'actions', header: 'Actions', width: 200, filterable: false, sortable: false, render: (_, row) => {
      const amRecommender = String(row.recommendedBy) === String(myId);
      const amApprover    = String(row.approvedBy) === String(myId);
      const canRecommend  = row.status === 'pending' && (amRecommender || isManager);
      const canApprove    = ['pending', 'recommended'].includes(row.status) && (amApprover || isManager);
      const canReject     = ['pending', 'recommended'].includes(row.status) && (amRecommender || amApprover || isManager);
      return (
        <div style={{ display: 'flex', gap: 6 }}>
          {canRecommend && (
            <button className="btn btn-sm btn-outline" onClick={() => setActionModal({ id: row.id, type: 'recommend', row })}>
              🔖 Recommend
            </button>
          )}
          {canApprove && (
            <button className="btn btn-sm btn-primary" onClick={() => setActionModal({ id: row.id, type: 'approve', row })}>
              ✅ Approve
            </button>
          )}
          {canReject && (
            <button className="btn btn-sm btn-danger" onClick={() => setActionModal({ id: row.id, type: 'reject', row })}>
              ✕ Reject
            </button>
          )}
        </div>
      );
    }},
  ];

  const myColumns = [
    { field: 'date',     header: 'Date',      width: 110, render: v => fd(v) },
    { field: 'checkIn',  header: 'Check In',  width: 90 },
    { field: 'checkOut', header: 'Check Out', width: 90 },
    { field: 'reason',   header: 'Reason',    width: 220 },
    { field: 'recommendedByName', header: 'Recommendator', width: 140, render: (v, r) => v || (r.recommendedBy ? getEmpName(r.recommendedBy) : '—') },
    { field: 'approvedByName',    header: 'Approver',      width: 140, render: (v, r) => v || (r.approvedBy ? getEmpName(r.approvedBy) : '—') },
    { field: 'status',   header: 'Status',    width: 110, render: v => <StatusBadge status={v} /> },
    { field: 'comment',  header: 'Comment',   width: 160 },
    { field: 'actions', header: 'Actions', width: 100, filterable: false, sortable: false, render: (_, row) => (
      row.status === 'pending'
        ? <button className="btn btn-sm btn-outline" onClick={() => cancelRequest(row.id)}>🗑 Cancel</button>
        : null
    )},
  ];

  return (
    <div style={{ padding: 20 }}>
      <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>📩 Missing Attendance Requests</h1>
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
        Requests you need to recommend/approve, and requests you've submitted yourself.
      </div>

      {error && (
        <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 8,
          padding: '10px 16px', marginBottom: 12, color: '#991b1b', fontWeight: 600 }}>
          ❌ {error}
        </div>
      )}

      <div style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Assigned to Me</h2>
        <DataGrid columns={assignedColumns} data={assignedToMe} loading={loading}
          defaultPageSize={10} showCheckbox={false} autoWidth={true} />
      </div>

      <div>
        <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>My Requests</h2>
        <DataGrid columns={myColumns} data={myRequests} loading={loading}
          defaultPageSize={10} showCheckbox={false} autoWidth={true} />
      </div>

      {actionModal && (
        <div className="modal-overlay" onClick={() => !busy && setActionModal(null)}>
          <div className="modal" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>
                {actionModal.type === 'recommend' && '🔖 Recommend Request'}
                {actionModal.type === 'approve'   && '✅ Approve Request'}
                {actionModal.type === 'reject'    && '✕ Reject Request'}
              </h2>
              <button className="modal-close" onClick={() => setActionModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 13, color: '#374151', marginBottom: 10 }}>
                {getEmpName(actionModal.row.employeeId)} — {fd(actionModal.row.date)}
              </p>
              <div className="form-group">
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Comment (optional)</label>
                <textarea className="form-control" rows={3} value={comment}
                  onChange={e => setComment(e.target.value)} style={{ fontSize: 13 }} />
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 10 }}>
                <button className="btn btn-outline" onClick={() => setActionModal(null)} disabled={busy}>Cancel</button>
                <button className="btn btn-primary" onClick={doAction} disabled={busy}>
                  {busy ? '⏳ Please wait...' : 'Confirm'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MissingAttendanceRequests;
