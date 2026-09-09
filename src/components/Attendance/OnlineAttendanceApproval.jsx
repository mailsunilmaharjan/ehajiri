import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useData } from '../../context/DataContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import api from '../../api/client.js';
import DataGrid from '../DataGrid/DataGrid.jsx';
import HoverCard from '../Common/HoverCard.jsx';
import useRecoApproval from '../../hooks/useRecoApproval.js';
import useDateFormat from '../../hooks/useDateFormat.js';
import OnlineAttendanceSettings from './OnlineAttendanceSettings.jsx';

const fmtDateTime = (iso) => iso ? new Date(iso).toLocaleString('en-US', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
}) : '—';

// checkIn/checkOutDevice are raw `navigator.userAgent + platform` strings
// (best-effort, see server/routes/onlineAttendance.js) — long and not worth
// parsing into a "browser/OS" summary, so just show a short leading slice
// inline with the full string on hover via HoverCard.
const deviceShort = (s) => !s ? '—' : (s.length > 28 ? s.slice(0, 28) + '…' : s);

const STATUS_BADGE = {
  pending : ['badge-warning', 'Pending'],
  approved: ['badge-success', 'Approved'],
  rejected: ['badge-danger',  'Rejected'],
};
const StatusBadge = ({ status }) => {
  const [cls, label] = STATUS_BADGE[status] || ['badge-gray', status];
  return <span className={`badge ${cls}`}>{label}</span>;
};

const mapLink = (lat, lng) => (lat == null || lng == null) ? null :
  `https://www.google.com/maps?q=${lat},${lng}`;

// Same shape as Leave Approval (Recommend → Approve/Reject, gated by
// reco_approval_assignments via useRecoApproval — the SAME assignment table
// Leave/Office Visit/Manual Posting already use, per employee, not a
// separate per-feature list). Built as a self-contained component (own
// fetch/state) rather than folding into the large shared DataContext.jsx,
// matching how Guest Registration/EventVisitorRegistration.jsx already does
// this for a standalone feature.
const OnlineAttendanceApproval = () => {
  const { currentUser, isAdmin } = useAuth();
  const { employees, getEmployeeName, getEmployeeById } = useData();
  const { settings } = useSettings();
  const { assignments: recoConfig } = useRecoApproval();
  const isRecoCompulsory = settings.recoApprovalCompulsory || false;
  const fd = useDateFormat();

  // "Setting" (per-staff enable/disable) used to be its own submenu item and
  // route — merged in here as a second tab instead, same admin-only
  // visibility it had standalone. Approval stays open to branchManager too
  // (the page's own route gate), Setting narrows further to isAdmin.
  const [tab, setTab] = useState('approval');

  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionModal, setActionModal] = useState(null); // { id, type, record }
  const [comment, setComment] = useState('');
  const [acting, setActing] = useState(false);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRecords(await api.get('/online-attendance')); }
    catch (e) { showToast(e.message || 'Failed to load', 'danger'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const isRecommenderFor = (empId) => {
    const r = recoConfig[String(empId)]?.reco;
    return (Array.isArray(r) ? r : (r ? [r] : [])).map(String).includes(String(currentUser.id));
  };
  const isApproverFor = (empId) => {
    const a = recoConfig[String(empId)]?.approval;
    return (Array.isArray(a) ? a : (a ? [a] : [])).map(String).includes(String(currentUser.id));
  };
  const canApproveRecord = (r) => !isRecoCompulsory || !!r.recommendedBy;

  const isMine = (r) => isRecommenderFor(r.employeeId) || isApproverFor(r.employeeId);
  const myRecords = records.filter(isMine);
  const pendingRecords = myRecords.filter(r => r.status === 'pending');

  const handleAction = async () => {
    if (!actionModal) return;
    setActing(true);
    try {
      const { id, type } = actionModal;
      const saved = await api.patch(`/online-attendance/${id}/${type}`, { comment });
      setRecords(p => p.map(r => r.id === id ? saved : r));
      showToast(
        type === 'recommend' ? 'Recommended successfully'
          : type === 'approve' ? 'Approved — now counted in attendance reports'
          : 'Rejected', type === 'reject' ? 'danger' : 'success'
      );
      setActionModal(null);
      setComment('');
    } catch (e) { showToast(e.message || 'Action failed', 'danger'); }
    finally { setActing(false); }
  };

  const columns = [
    { field: 'employeeId', header: 'Name', width: 150, render: v => <span style={{ fontWeight: 600, color: '#111827' }}>{getEmployeeName(v)}</span> },
    { field: 'post', header: 'Post', width: 120, render: (_, r) => getEmployeeById(r.employeeId)?.position || '—' },
    { field: 'department', header: 'Department', width: 130, render: (_, r) => getEmployeeById(r.employeeId)?.department || '—' },
    { field: 'branch', header: 'Branch', width: 120, render: (_, r) => getEmployeeById(r.employeeId)?.branch || '—' },
    { field: 'date', header: 'Date', width: 120, render: v => fd(v) },
    { field: 'checkInAt', header: 'Check In', width: 140, render: v => v ? new Date(v).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—' },
    { field: 'checkOutAt', header: 'Check Out', width: 140, render: v => v ? new Date(v).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—' },
    {
      field: 'location', header: 'Location', width: 130, sortable: false,
      render: (_, r) => {
        const inLink = mapLink(r.checkInLat, r.checkInLng);
        const outLink = mapLink(r.checkOutLat, r.checkOutLng);
        return (
          <div style={{ display: 'flex', gap: 6, fontSize: 11.5 }}>
            {inLink && <a href={inLink} target="_blank" rel="noreferrer" style={{ color: '#1a56db' }}>📍 In</a>}
            {outLink && <a href={outLink} target="_blank" rel="noreferrer" style={{ color: '#1a56db' }}>📍 Out</a>}
          </div>
        );
      },
    },
    {
      field: 'device', header: 'Device / Hardware', width: 190, sortable: false,
      render: (_, r) => {
        const dev = r.checkInDevice || r.checkOutDevice;
        if (!dev) return <span style={{ color: '#9ca3af' }}>—</span>;
        return (
          <HoverCard
            trigger={<span style={{ fontSize: 11.5, color: '#374151' }}>🖥️ {deviceShort(dev)}</span>}
            content={<div style={{ fontSize: 12, lineHeight: 1.5 }}>
              {r.checkInDevice && <div><strong>Check In:</strong> {r.checkInDevice}</div>}
              {r.checkOutDevice && r.checkOutDevice !== r.checkInDevice && <div style={{ marginTop: 4 }}><strong>Check Out:</strong> {r.checkOutDevice}</div>}
            </div>}
            maxWidth={340}
          />
        );
      },
    },
    {
      field: 'status', header: 'Status', width: 130,
      render: (v, row) => (
        <div>
          <StatusBadge status={v} />
          {row.recommendedBy && (
            <div style={{ fontSize: 11, color: '#059669', marginTop: 2 }}>✓ {getEmployeeName(row.recommendedBy)}</div>
          )}
        </div>
      ),
    },
    {
      field: 'actions', header: 'Actions', width: 180, filterable: false, sortable: false,
      render: (_, row) => {
        const amReco = isRecommenderFor(row.employeeId);
        const amApprover = isApproverFor(row.employeeId);
        const canApprove = canApproveRecord(row);
        const alreadyReco = !!row.recommendedBy;

        if (row.status !== 'pending') {
          return <span style={{ fontSize: 12, color: '#9ca3af' }}>{row.status === 'approved' ? '✅' : '❌'} {getEmployeeName(row.approvedBy)}</span>;
        }
        return (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {amReco && !alreadyReco && (
              <button className="dg-action-btn" title="Recommend"
                style={{ background: '#059669', color: 'white', border: 'none', fontSize: 12, padding: '3px 8px', borderRadius: 4, cursor: 'pointer' }}
                onClick={() => { setActionModal({ id: row.id, type: 'recommend', record: row }); setComment(''); }}>
                👍 Reco
              </button>
            )}
            {amApprover && (
              <button className="dg-action-btn approve" title={canApprove ? 'Approve' : 'Awaiting recommendation first'}
                disabled={!canApprove}
                style={{ opacity: canApprove ? 1 : .4, cursor: canApprove ? 'pointer' : 'not-allowed' }}
                onClick={() => { if (canApprove) { setActionModal({ id: row.id, type: 'approve', record: row }); setComment(''); } }}>
                ✓
              </button>
            )}
            {amApprover && (
              <button className="dg-action-btn reject" title="Reject"
                onClick={() => { setActionModal({ id: row.id, type: 'reject', record: row }); setComment(''); }}>
                ✗
              </button>
            )}
            {!amReco && !amApprover && <span style={{ fontSize: 11, color: '#9ca3af' }}>—</span>}
          </div>
        );
      },
    },
  ];

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">🌐 Online Attendance</h1>
          {tab === 'approval' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
              <p className="page-subtitle" style={{ margin: 0 }}>{pendingRecords.length} Pending Approvals</p>
              {isRecoCompulsory && (
                <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 10px', borderRadius: 10,
                  background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }}>
                  ⚠️ Recommendation Compulsory
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Tabs — Setting used to be a separate submenu/route, now a tab here */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '2px solid #eef1f5', marginBottom: 16, flexWrap: 'wrap' }}>
        <button onClick={() => setTab('approval')}
          style={{ padding: '9px 16px', border: 'none', background: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: 700, color: tab === 'approval' ? '#1a56db' : '#6b7280',
            borderBottom: tab === 'approval' ? '2px solid #1a56db' : '2px solid transparent', marginBottom: -2 }}>
          ✅ Approval
        </button>
        {isAdmin && (
          <button onClick={() => setTab('setting')}
            style={{ padding: '9px 16px', border: 'none', background: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: 700, color: tab === 'setting' ? '#1a56db' : '#6b7280',
              borderBottom: tab === 'setting' ? '2px solid #1a56db' : '2px solid transparent', marginBottom: -2 }}>
            ⚙️ Setting
          </button>
        )}
      </div>

      {tab === 'setting' ? (
        <OnlineAttendanceSettings />
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>
            {[
              { label: 'Pending', count: myRecords.filter(r => r.status === 'pending').length, color: '#e3a008', bg: '#fdf3d0' },
              { label: 'Recommended', count: myRecords.filter(r => !!r.recommendedBy).length, color: '#059669', bg: '#d1fae5' },
              { label: 'Approved', count: myRecords.filter(r => r.status === 'approved').length, color: '#0e9f6e', bg: '#d1fae5' },
              { label: 'Rejected', count: myRecords.filter(r => r.status === 'rejected').length, color: '#f05252', bg: '#fde8e8' },
            ].map((s, i) => (
              <div key={i} style={{ background: s.bg, borderRadius: 8, padding: '14px 18px',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: s.color }}>{s.label}</span>
                <span style={{ fontSize: 26, fontWeight: 700, color: s.color }}>{s.count}</span>
              </div>
            ))}
          </div>

          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>Loading…</div>
          ) : (
            <DataGrid columns={columns} data={myRecords.sort((a, b) => new Date(b.date) - new Date(a.date))}
              rowKey="id" defaultPageSize={10} showSearch title="Online Attendance" compact />
          )}
        </>
      )}

      {actionModal && (
        <div className="modal-overlay">
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>
                {actionModal.type === 'recommend' ? '👍 Recommend'
                  : actionModal.type === 'approve' ? '✅ Approve' : '❌ Reject'} — Online Attendance
              </h2>
              <button className="modal-close" onClick={() => setActionModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              {(() => {
                const r = actionModal.record;
                const emp = getEmployeeById(r.employeeId);
                const inLink = mapLink(r.checkInLat, r.checkInLng);
                const outLink = mapLink(r.checkOutLat, r.checkOutLng);
                const device = r.checkInDevice || r.checkOutDevice;
                return (
                  <div style={{ background: '#f9fafb', borderRadius: 8, padding: 12, marginBottom: 14, fontSize: 13 }}>
                    <div style={{ fontWeight: 700, color: '#111827' }}>{getEmployeeName(r.employeeId)}</div>
                    <div style={{ color: '#6b7280', fontSize: 12, marginTop: 2 }}>
                      {[emp?.position, emp?.department, emp?.branch].filter(Boolean).join(' · ') || '—'}
                    </div>
                    <div style={{ color: '#374151', marginTop: 6 }}>{fd(r.date)}</div>
                    <div style={{ color: '#374151' }}>
                      In: {fmtDateTime(r.checkInAt)} · Out: {fmtDateTime(r.checkOutAt)}
                    </div>
                    {(inLink || outLink) && (
                      <div style={{ marginTop: 6, display: 'flex', gap: 10 }}>
                        {inLink && <a href={inLink} target="_blank" rel="noreferrer" style={{ color: '#1a56db', fontSize: 12 }}>📍 Check-In Location</a>}
                        {outLink && <a href={outLink} target="_blank" rel="noreferrer" style={{ color: '#1a56db', fontSize: 12 }}>📍 Check-Out Location</a>}
                      </div>
                    )}
                    {device && (
                      <div style={{ marginTop: 6, fontSize: 11.5, color: '#6b7280', wordBreak: 'break-word' }}>
                        🖥️ {device}
                        {r.checkOutDevice && r.checkOutDevice !== r.checkInDevice && <div style={{ marginTop: 2 }}>🖥️ {r.checkOutDevice}</div>}
                      </div>
                    )}
                  </div>
                );
              })()}
              <div className="form-group">
                <label className="form-label">Comment (Optional)</label>
                <textarea className="form-control" rows={3} placeholder="Enter comment"
                  value={comment} onChange={e => setComment(e.target.value)} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setActionModal(null)}>Cancel</button>
              <button disabled={acting}
                className={`btn ${actionModal.type === 'reject' ? 'btn-danger' : 'btn-success'}`}
                onClick={handleAction}>
                {actionModal.type === 'recommend' ? '👍 Confirm Recommendation'
                  : actionModal.type === 'approve' ? '✅ Approve' : '❌ Reject'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast-container">
          <div className={`toast toast-${toast.type}`}>
            <span>{toast.type === 'success' ? '✅' : '❌'}</span>
            <span>{toast.msg}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default OnlineAttendanceApproval;
