import React, { useState, useMemo } from 'react';
import { useAuth }     from '../../context/AuthContext.jsx';
import { useLanguage } from '../../context/LanguageContext.jsx';
import { useData }     from '../../context/DataContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import { makeDateFormatter } from '../../utils/dateUtils.js';
import DataGrid from '../DataGrid/DataGrid.jsx';

/* ── load reco/approval settings ── */
const loadRecoConfig = () => {
  try { return JSON.parse(localStorage.getItem('ehajiri_reco_approval') || '{}'); } catch { return {}; }
};

const StatusBadge = ({ status }) => {
  const map = {
    pending:     ['badge-warning', 'Pending'],
    recommended: ['badge-info',    'Recommended'],
    approved:    ['badge-success', 'Approved'],
    rejected:    ['badge-danger',  'Rejected'],
  };
  const [cls, label] = map[status] || ['badge-gray', status];
  return <span className={`badge ${cls}`}>{label}</span>;
};

const RecoTag = ({ name }) => (
  <span style={{ display:'inline-flex', alignItems:'center', gap:4, background:'#d1fae5',
    color:'#065f46', borderRadius:10, padding:'1px 10px', fontSize:12, fontWeight:600 }}>
    ✓ {name}
  </span>
);

const LeaveApproval = () => {
  const { currentUser } = useAuth();
  const { t }           = useLanguage();
  const { settings }    = useSettings();
  const fd              = makeDateFormatter(settings);
  const {
    filteredLeaves: leaves, approveLeave, rejectLeave, recommendLeave,
    getEmployeeName, getEmployeeById, getLeaveTypeName, getLeaveTypeColor,
  } = useData();

  const [actionModal, setActionModal] = useState(null); // { id, type: 'approve'|'reject'|'recommend', leave }
  const [comment,     setComment]     = useState('');
  const [toast,       setToast]       = useState(null);

  /* ── Load reco config ── */
  const recoConfig = useMemo(() => loadRecoConfig(), []);
  const isRecoCompulsory = recoConfig._settings?.isRecoCompulsory || false;

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  /* ── Helpers ── */
  const isRecommenderFor = (empId) => {
    const r = recoConfig[String(empId)]?.reco;
    const ids = Array.isArray(r) ? r : (r ? [r] : []);
    return ids.map(String).includes(String(currentUser.id));
  };

  const isApproverFor = (empId) => {
    const a = recoConfig[String(empId)]?.approval;
    const ids = Array.isArray(a) ? a : (a ? [a] : []);
    return ids.map(String).includes(String(currentUser.id));
  };

  const canApproveLeave = (leave) =>
    !isRecoCompulsory || !!leave.recommendedBy;

  /* ── Handle action ── */
  const handleAction = () => {
    if (!actionModal) return;
    const { id, type, leave } = actionModal;
    if (type === 'recommend') {
      recommendLeave(id, currentUser.id, comment);
      showToast('Leave recommended successfully', 'success');
    } else if (type === 'approve') {
      approveLeave(id, currentUser.id, comment);
      showToast(t('Application approved'), 'success');
    } else {
      rejectLeave(id, currentUser.id, comment);
      showToast(t('Application rejected'), 'danger');
    }
    setActionModal(null);
    setComment('');
  };

  const pendingLeaves = leaves.filter(l => l.status === 'pending');
  const allLeaves     = [...leaves].sort((a, b) => new Date(b.appliedDate) - new Date(a.appliedDate));

  /* ── Grid columns ── */
  const columns = [
    { field:'employeeId',    header:t('Name'),         width:150, render:v=><span style={{ fontWeight:600, color:'#111827' }}>{getEmployeeName(v)}</span> },
    { field:'leaveTypeCode', header:t('Type'),         width:140, render:v=>(
      <span style={{ display:'flex', alignItems:'center', gap:6 }}>
        <span style={{ width:8, height:8, borderRadius:'50%', background:getLeaveTypeColor(v), flexShrink:0, display:'inline-block' }}></span>
        {getLeaveTypeName(v)}
      </span>
    )},
    { field:'fromDate',    header:t('From Date'),    width:110, render:v=>fd(v) },
    { field:'toDate',      header:t('To Date'),      width:110, render:v=>fd(v) },
    { field:'days',        header:t('Days'),         width:60,  align:'center', render:v=><strong style={{ color:'#52b02c' }}>{v}</strong> },
    { field:'reason',      header:t('Reason'),       width:140 },
    { field:'appliedDate', header:t('Applied Date'), width:110, render:v=>fd(v) },
    { field:'status',      header:t('Status'),       width:120, render:(v, row)=>(
      <div>
        <StatusBadge status={v} />
        {row.recommendedBy && (
          <div style={{ fontSize:11, color:'#059669', marginTop:2 }}>
            ✓ {getEmployeeName(row.recommendedBy)}
          </div>
        )}
      </div>
    )},
    { field:'actions', header:t('Actions'), width:180, filterable:false, sortable:false,
      render:(_, row) => {
        const amReco     = isRecommenderFor(row.employeeId);
        const amApprover = isApproverFor(row.employeeId);
        const canApprove = canApproveLeave(row);
        const alreadyReco = !!row.recommendedBy;

        if (row.status !== 'pending') {
          return <span style={{ fontSize:12, color:'#9ca3af' }}>{row.status==='approved'?'✅':'❌'} {getEmployeeName(row.approvedBy)}</span>;
        }
        return (
          <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
            {/* Recommend button */}
            {amReco && !alreadyReco && (
              <button className="dg-action-btn" title="Recommend"
                style={{ background:'#059669', color:'white', border:'none', fontSize:12, padding:'3px 8px', borderRadius:4, cursor:'pointer' }}
                onClick={e => { e.stopPropagation(); setActionModal({ id:row.id, type:'recommend', leave:row }); setComment(''); }}>
                👍 Reco
              </button>
            )}
            {/* Approve button */}
            {amApprover && (
              <button className="dg-action-btn approve" title={canApprove ? t('Approve') : 'Awaiting recommendation first'}
                disabled={!canApprove}
                style={{ opacity: canApprove ? 1 : 0.4, cursor: canApprove ? 'pointer' : 'not-allowed' }}
                onClick={e => { e.stopPropagation(); if (canApprove) { setActionModal({ id:row.id, type:'approve', leave:row }); setComment(''); } }}>
                ✓
              </button>
            )}
            {/* Reject button */}
            {amApprover && (
              <button className="dg-action-btn reject" title={t('Reject')}
                onClick={e => { e.stopPropagation(); setActionModal({ id:row.id, type:'reject', leave:row }); setComment(''); }}>
                ✗
              </button>
            )}
            {!amReco && !amApprover && (
              <span style={{ fontSize:11, color:'#9ca3af' }}>—</span>
            )}
          </div>
        );
      }
    },
  ];

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">✅ {t('Leave Approval')}</h1>
          <div style={{ display:'flex', alignItems:'center', gap:10, marginTop:4, flexWrap:'wrap' }}>
            <p className="page-subtitle" style={{ margin:0 }}>{pendingLeaves.length} {t('Pending Approvals')}</p>
            {isRecoCompulsory && (
              <span style={{ fontSize:12, fontWeight:700, padding:'2px 10px', borderRadius:10,
                background:'#fef3c7', color:'#92400e', border:'1px solid #fde68a' }}>
                ⚠️ Recommendation Compulsory
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:14, marginBottom:20 }}>
        {[
          { label:t('Pending'),     count:leaves.filter(l=>l.status==='pending').length,     color:'#e3a008', bg:'#fdf3d0' },
          { label:'Recommended',   count:leaves.filter(l=>!!l.recommendedBy).length,        color:'#059669', bg:'#d1fae5' },
          { label:t('Approved'),   count:leaves.filter(l=>l.status==='approved').length,    color:'#0e9f6e', bg:'#d1fae5' },
          { label:t('Rejected'),   count:leaves.filter(l=>l.status==='rejected').length,    color:'#f05252', bg:'#fde8e8' },
        ].map((s, i) => (
          <div key={i} style={{ background:s.bg, borderRadius:8, padding:'14px 18px',
            display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span style={{ fontSize:13, fontWeight:600, color:s.color }}>{s.label}</span>
            <span style={{ fontSize:26, fontWeight:700, color:s.color }}>{s.count}</span>
          </div>
        ))}
      </div>

      {/* Pending list */}
      {pendingLeaves.length > 0 && (
        <div className="card" style={{ marginBottom:20, borderLeft:'4px solid #e3a008' }}>
          <div className="card-header" style={{ background:'#fffbeb' }}>
            <h3>⏳ Pending Applications ({pendingLeaves.length})</h3>
          </div>
          {pendingLeaves.map(l => {
            const amReco     = isRecommenderFor(l.employeeId);
            const amApprover = isApproverFor(l.employeeId);
            const canApprove = canApproveLeave(l);
            const alreadyReco = !!l.recommendedBy;

            return (
              <div key={l.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
                padding:'12px 18px', borderBottom:'1px solid #f9fafb', flexWrap:'wrap', gap:10 }}>
                <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                  {getEmployeeById(l.employeeId)?.profilePhoto ? (
                    <div style={{ width:38, height:38, borderRadius:'50%', overflow:'hidden', flexShrink:0, background:'#fdf3d0' }}>
                      <img src={getEmployeeById(l.employeeId).profilePhoto} alt=""
                        style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }} />
                    </div>
                  ) : (
                    <div style={{ width:38, height:38, borderRadius:'50%', background:'#fdf3d0',
                      color:'#e3a008', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, fontSize:15 }}>
                      {getEmployeeName(l.employeeId)[0]}
                    </div>
                  )}
                  <div>
                    <div style={{ fontSize:13, fontWeight:700, color:'#111827' }}>{getEmployeeName(l.employeeId)}</div>
                    <div style={{ fontSize:12, color:'#374151' }}>{getLeaveTypeName(l.leaveTypeCode)} · {l.fromDate} – {l.toDate} ({l.days} days)</div>
                    {l.reason && <div style={{ fontSize:11, color:'#6b7280' }}>{l.reason}</div>}
                    {/* Recommendation status */}
                    {isRecoCompulsory && (
                      <div style={{ marginTop:3 }}>
                        {alreadyReco
                          ? <RecoTag name={getEmployeeName(l.recommendedBy)} />
                          : <span style={{ fontSize:11, color:'#92400e', background:'#fef3c7', padding:'1px 8px', borderRadius:6 }}>
                              ⏳ Awaiting Recommendation
                            </span>
                        }
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                  {amReco && !alreadyReco && (
                    <button className="btn btn-sm" style={{ background:'#059669', color:'white', border:'none', cursor:'pointer', fontSize:12, padding:'5px 12px', borderRadius:6 }}
                      onClick={() => { setActionModal({ id:l.id, type:'recommend', leave:l }); setComment(''); }}>
                      👍 Recommend
                    </button>
                  )}
                  {amApprover && (
                    <>
                      <button className="btn btn-sm btn-success"
                        disabled={!canApprove}
                        style={{ opacity: canApprove ? 1 : 0.4, cursor: canApprove ? 'pointer' : 'not-allowed' }}
                        title={canApprove ? '' : 'Recommendation required before approval'}
                        onClick={() => { if (canApprove) { setActionModal({ id:l.id, type:'approve', leave:l }); setComment(''); } }}>
                        ✓ {t('Approve')}
                      </button>
                      <button className="btn btn-sm btn-danger"
                        onClick={() => { setActionModal({ id:l.id, type:'reject', leave:l }); setComment(''); }}>
                        ✗ {t('Reject')}
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Full grid */}
      <DataGrid columns={columns} data={allLeaves} defaultPageSize={10}
        showSearch={true} searchPlaceholder={t('Search')+'...'} title={t('Leave Applications')} compact={true} />

      {/* Action Modal */}
      {actionModal && (
        <div className="modal-overlay">
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header" style={{
              background: actionModal.type === 'approve' ? '#f0fdf4'
                : actionModal.type === 'recommend' ? '#f0fdf4' : '#fef2f2'
            }}>
              <h2>
                {actionModal.type === 'recommend' ? `👍 Recommend`
                  : actionModal.type === 'approve' ? `✅ ${t('Approve')}`
                  : `❌ ${t('Reject')}`} — {t('Leave Application')}
              </h2>
              <button className="modal-close" onClick={() => setActionModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ background:'#f9fafb', borderRadius:8, padding:12, marginBottom:14, fontSize:13 }}>
                <div style={{ fontWeight:700, color:'#111827' }}>{getEmployeeName(actionModal.leave.employeeId)}</div>
                <div style={{ color:'#374151', marginTop:2 }}>{getLeaveTypeName(actionModal.leave.leaveTypeCode)} · {actionModal.leave.days} {t('Days')}</div>
                <div style={{ color:'#374151' }}>{actionModal.leave.fromDate} – {actionModal.leave.toDate}</div>
                {actionModal.leave.reason && <div style={{ color:'#6b7280', marginTop:4 }}>{actionModal.leave.reason}</div>}
                {actionModal.leave.recommendedBy && (
                  <div style={{ marginTop:6 }}>
                    <RecoTag name={getEmployeeName(actionModal.leave.recommendedBy)} />
                  </div>
                )}
              </div>
              <div className="form-group">
                <label className="form-label">{t('Comment')} ({t('Optional')})</label>
                <textarea className="form-control" rows={3} placeholder={t('Enter comment')}
                  value={comment} onChange={e => setComment(e.target.value)} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setActionModal(null)}>{t('Cancel')}</button>
              <button
                className={`btn ${actionModal.type === 'recommend' ? 'btn-success'
                  : actionModal.type === 'approve' ? 'btn-success' : 'btn-danger'}`}
                onClick={handleAction}>
                {actionModal.type === 'recommend' ? '👍 Confirm Recommendation'
                  : actionModal.type === 'approve' ? `✅ ${t('Approve')}` : `❌ ${t('Reject')}`}
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

export default LeaveApproval;
