import React, { useState, useEffect, useCallback } from 'react';
import { useAuth }     from '../../context/AuthContext.jsx';
import { useLanguage } from '../../context/LanguageContext.jsx';
import { useData }     from '../../context/DataContext.jsx';
import useDateFormat   from '../../hooks/useDateFormat.js';
import DataGrid         from '../DataGrid/DataGrid.jsx';
import Avatar           from '../Common/Avatar.jsx';
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
  const [activeTab,   setActiveTab]   = useState('assigned'); // 'assigned' | 'mine'
  // Reason is truncated in the grid itself (see reasonCell below) so the
  // table fits the screen without a horizontal scrollbar — the full text
  // shows in the panel below instead. selectedReason is "sticky" (set by
  // clicking a row, defaults to the first row) so there's always something
  // there; hoverReason is a temporary override while the pointer is over a
  // row's Reason cell, falling back to the selection once it leaves.
  const [selectedReason, setSelectedReason] = useState(null);
  const [hoverReason,    setHoverReason]    = useState(null);

  const getEmp = (id) => employees.find(e => String(e.id) === String(id));
  const getEmpName = (id) => getEmp(id)?.fullName || `#${id}`;
  const getEmpPhoto = (id) => getEmp(id)?.profilePhoto;

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
  const activeData = activeTab === 'assigned' ? assignedToMe : myRequests;

  // Default selection is the first row of whichever tab is showing, so the
  // Description panel is never empty on load — re-applied whenever the tab
  // or its underlying data changes (e.g. after an approve/reject reloads).
  useEffect(() => {
    setSelectedReason(activeData.length ? activeData[0].reason : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, activeData[0]?.id, activeData.length]);

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

  // Truncated inline, full text shown in the panel below the grid on hover.
  // The column itself is `fill: true` below so it stretches to soak up
  // whatever width the other (fixed-width) columns don't need instead of
  // leaving blank space to the right of the grid — the truncation point
  // here scales with the viewport (clamp'd between a floor and ceiling)
  // to roughly track that, same convention as Daily Attendance Report's
  // Remarks column.
  const reasonCell = (v) => v ? (
    <span
      onMouseEnter={() => setHoverReason(v)}
      onMouseLeave={() => setHoverReason(null)}
      style={{ display: 'block', maxWidth: 'clamp(140px, 18vw, 320px)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'default' }}>
      {v}
    </span>
  ) : <span style={{ color: '#d1d5db' }}>—</span>;

  const assignedColumns = [
    { field: 'employeeId', header: 'Staff ID', width: 80, sortable: false, render: (_, r) =>
        employees.find(e => String(e.id) === String(r.employeeId))?.employeeId || '—' },
    { field: 'employeeName', header: 'Staff',      width: 160, render: (v, r) => (
        <span style={{ display:'flex', alignItems:'center', gap:6 }}>
          <Avatar photo={getEmpPhoto(r.employeeId)} name={v || getEmpName(r.employeeId)} size={20} />
          {v || getEmpName(r.employeeId)}
        </span>
      ) },
    { field: 'position',     header: 'Post',       width: 120, sortable: false, render: (_, r) => getEmp(r.employeeId)?.position || '—' },
    { field: 'department',   header: 'Department', width: 130, sortable: false, render: (_, r) => getEmp(r.employeeId)?.department || '—' },
    { field: 'branch',       header: 'Branch',     width: 130, sortable: false, render: (_, r) => getEmp(r.employeeId)?.branch || '—' },
    { field: 'date',         header: 'Date',       width: 110, render: v => fd(v) },
    { field: 'checkIn',      header: 'Check In',   width: 90 },
    { field: 'checkOut',     header: 'Check Out',  width: 90 },
    { field: 'reason',       header: 'Reason',     width: 140, fill: true, render: v => reasonCell(v) },
    { field: 'recommendedByName', header: 'Recommendator', width: 140, render: (v, r) => v || (r.recommendedBy ? getEmpName(r.recommendedBy) : '—') },
    { field: 'approvedByName',    header: 'Approver',      width: 140, render: (v, r) => v || (r.approvedBy ? getEmpName(r.approvedBy) : '—') },
    { field: 'status',       header: 'Status',     width: 110, render: v => <StatusBadge status={v} /> },
    { field: 'actions', header: 'Actions', width: 190, filterable: false, sortable: false, render: (_, row) => {
      const amRecommender = String(row.recommendedBy) === String(myId);
      const amApprover    = String(row.approvedBy) === String(myId);
      const canRecommend  = row.status === 'pending' && (amRecommender || isManager);
      const canApprove    = ['pending', 'recommended'].includes(row.status) && (amApprover || isManager);
      const canReject     = ['pending', 'recommended'].includes(row.status) && (amRecommender || amApprover || isManager);
      const smallBtn = { padding: '3px 7px', fontSize: 11 };
      return (
        <div style={{ display: 'flex', gap: 5 }}>
          {canRecommend && (
            <button className="btn btn-sm btn-outline" style={smallBtn} onClick={() => setActionModal({ id: row.id, type: 'recommend', row })}>
              🔖 Recommend
            </button>
          )}
          {canApprove && (
            <button className="btn btn-sm btn-primary" style={smallBtn} onClick={() => setActionModal({ id: row.id, type: 'approve', row })}>
              ✅ Approve
            </button>
          )}
          {canReject && (
            <button className="btn btn-sm btn-danger" style={smallBtn} onClick={() => setActionModal({ id: row.id, type: 'reject', row })}>
              ✕ Reject
            </button>
          )}
        </div>
      );
    }},
  ];

  const myColumns = [
    { field: 'position',   header: 'Post',       width: 120, sortable: false, render: () => getEmp(myId)?.position || '—' },
    { field: 'department', header: 'Department', width: 130, sortable: false, render: () => getEmp(myId)?.department || '—' },
    { field: 'branch',     header: 'Branch',     width: 130, sortable: false, render: () => getEmp(myId)?.branch || '—' },
    { field: 'date',     header: 'Date',      width: 110, render: v => fd(v) },
    { field: 'checkIn',  header: 'Check In',  width: 90 },
    { field: 'checkOut', header: 'Check Out', width: 90 },
    { field: 'reason',   header: 'Reason',    width: 140, fill: true, render: v => reasonCell(v) },
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

      <div className="tabs" style={{ marginBottom: 16 }}>
        <button className={`tab-btn ${activeTab === 'assigned' ? 'active' : ''}`}
          onClick={() => setActiveTab('assigned')}>
          Assigned to Me ({assignedToMe.length})
        </button>
        <button className={`tab-btn ${activeTab === 'mine' ? 'active' : ''}`}
          onClick={() => setActiveTab('mine')}>
          My Requests ({myRequests.length})
        </button>
      </div>

      {activeTab === 'assigned' ? (
        <DataGrid columns={assignedColumns} data={assignedToMe} loading={loading}
          defaultPageSize={10} showCheckbox={false} autoWidth={true}
          onRowClick={row => setSelectedReason(row.reason)} />
      ) : (
        <DataGrid columns={myColumns} data={myRequests} loading={loading}
          defaultPageSize={10} showCheckbox={false} autoWidth={true}
          onRowClick={row => setSelectedReason(row.reason)} />
      )}

      {/* Full Reason text — the grid's own Reason column is truncated to keep
          the table from needing a horizontal scrollbar. Clicking a row
          "selects" it (defaults to the first row so this is never empty);
          hovering any row's Reason cell temporarily previews that row's
          text here instead, reverting to the selection once the pointer
          leaves. */}
      {(() => {
        const shown = hoverReason ?? selectedReason;
        return (
          <div style={{ marginTop: 12, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8,
            padding: '10px 14px', minHeight: 40, fontSize: 13, color: shown ? '#374151' : '#9ca3af' }}>
            <strong style={{ color: '#374151', marginRight: 6 }}>Description:</strong>
            {shown || 'No requests to show.'}
          </div>
        );
      })()}

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
