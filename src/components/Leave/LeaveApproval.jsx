import React, { useState, useEffect } from 'react';
import { useAuth }     from '../../context/AuthContext.jsx';
import { useLanguage } from '../../context/LanguageContext.jsx';
import { useData }     from '../../context/DataContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import { makeDateFormatter } from '../../utils/dateUtils.js';
import DataGrid from '../DataGrid/DataGrid.jsx';
import useRecoApproval from '../../hooks/useRecoApproval.js';

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

// `embedded` — rendered inside LeaveVisitPage's full-width "Leave Approval"
// popup instead of as its own routed page: skips the page-container/
// page-header chrome since the modal shell already provides a title + close.
const LeaveApproval = ({ embedded = false } = {}) => {
  const { currentUser } = useAuth();
  const { t }           = useLanguage();
  const { settings }    = useSettings();
  const fd              = makeDateFormatter(settings);
  const {
    // Deliberately the RAW company-wide leaves, not filteredLeaves — that's
    // scoped by org hierarchy (branch/department/self), which has nothing
    // to do with "Set Recommendator & Approval": a recommender/approver can
    // legitimately be assigned to someone outside their own branch/
    // department. isMine below (isRecommenderFor/isApproverFor) is already
    // this page's real authorization boundary; filteredLeaves was silently
    // excluding cross-branch assignments before isMine ever got a chance to
    // include them, so a configured approver saw an empty "0 Pending" page.
    leaves, approveLeave, rejectLeave, recommendLeave,
    getEmployeeName, getEmployeeById, getLeaveTypeName, getLeaveTypeColor,
  } = useData();

  const [actionModal, setActionModal] = useState(null); // { id, type: 'approve'|'reject'|'recommend', leave }
  const [comment,     setComment]     = useState('');
  const [toast,       setToast]       = useState(null);
  // Reason is truncated in the grid itself (see the reason column's render
  // below) so the table fits the screen without a horizontal scrollbar —
  // the full text shows in the panel below the grid instead. selectedReason
  // is "sticky" (set by clicking a row, defaults to the first row) so
  // there's always something there; hoverReason is a temporary override
  // while the pointer is over a row's Reason cell, falling back to the
  // selection once it leaves. Same convention as Missing Attendance
  // Requests' identical Reason column.
  const [selectedReason, setSelectedReason] = useState(null);
  const [hoverReason,    setHoverReason]    = useState(null);

  /* ── Load reco config ── */
  const { assignments: recoConfig } = useRecoApproval();
  const isRecoCompulsory = settings.recoApprovalCompulsory || false;

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

  // Whether this employee has ANY recommender configured at all — if not,
  // "Recommendation Compulsory" is unsatisfiable for them (nobody exists who
  // could ever recommend it), so it must not block their approver. Mirrors
  // authorizeRecoAction's hasRecommenderConfigured check server-side.
  const hasRecommenderFor = (empId) => {
    const r = recoConfig[String(empId)]?.reco;
    const ids = Array.isArray(r) ? r : (r ? [r] : []);
    return ids.length > 0;
  };

  const canApproveLeave = (leave) =>
    !isRecoCompulsory || !!leave.recommendedBy || !hasRecommenderFor(leave.employeeId);

  // Separation of duties: while Recommendation Compulsory is on AND a
  // recommender is actually configured, whoever is configured as this
  // employee's recommender never sees the Approve button, even if they're
  // also configured as the approver — a different person must sign off.
  // Mirrored server-side in authorizeRecoAction.
  const canShowApprove = (empId) => !(isRecoCompulsory && hasRecommenderFor(empId) && isRecommenderFor(empId));

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

  // Scope everything on this page to applications the current user is
  // actually the assigned recommender/approver for — the action buttons
  // already only appear for those (see amReco/amApprover below), so an
  // unfiltered org-wide list was mostly rows nobody here could act on.
  const isMine = (l) => isRecommenderFor(l.employeeId) || isApproverFor(l.employeeId);
  const myLeaves       = leaves.filter(isMine);
  const pendingLeaves  = myLeaves.filter(l => l.status === 'pending');
  const allLeaves      = [...myLeaves].sort((a, b) => new Date(b.appliedDate) - new Date(a.appliedDate));

  // Default selection is the first row, so the Reason panel below the grid
  // is never empty on load — re-applied whenever the underlying data
  // changes (e.g. after an approve/reject reloads it).
  useEffect(() => {
    setSelectedReason(allLeaves.length ? allLeaves[0].reason : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allLeaves[0]?.id, allLeaves.length]);

  // Truncated inline, full text shown in the panel below the grid — keeps
  // the Reason column narrow enough that the table fits the screen width
  // instead of needing a horizontal scrollbar.
  const reasonCell = (v) => v ? (
    <span
      onMouseEnter={() => setHoverReason(v)}
      onMouseLeave={() => setHoverReason(null)}
      style={{ display: 'block', maxWidth: 'clamp(140px, 18vw, 320px)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'default' }}>
      {v}
    </span>
  ) : <span style={{ color: '#d1d5db' }}>—</span>;

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
    { field:'days',        header:t('Days'),         width:60,  align:'center', render:v=><strong style={{ color:'#1a56db' }}>{v}</strong> },
    { field:'reason',      header:t('Reason'),       width:220, sortable:false, render:v=>reasonCell(v) },
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
        const amApprover = isApproverFor(row.employeeId) && canShowApprove(row.employeeId);
        const canApprove = canApproveLeave(row);
        const alreadyReco = !!row.recommendedBy;

        if (row.status !== 'pending') {
          return <span style={{ fontSize:12, color:'#9ca3af' }}>{row.status==='approved'?'✅':'❌'} {getEmployeeName(row.approvedBy)}</span>;
        }
        return (
          <div style={{ display:'flex', gap:4, flexWrap:'nowrap' }}>
            {/* Recommend button — width/height:auto overrides .dg-action-btn's
                fixed 22x20 square (sized for the icon-only ✓/✗ buttons below),
                which was clipping this button's actual text ("👍 Reco") down
                to a sliver. Previously invisible only because the Reason
                column's old unbounded width pushed this whole column off
                the visible area, forcing a horizontal scroll to even see it. */}
            {amReco && !alreadyReco && (
              <button className="dg-action-btn" title="Recommend"
                style={{ width:'auto', height:'auto', background:'#059669', color:'white', border:'none', fontSize:12, padding:'3px 8px', borderRadius:4, cursor:'pointer' }}
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
            {isApproverFor(row.employeeId) && (
              <button className="dg-action-btn reject" title={t('Reject')}
                onClick={e => { e.stopPropagation(); setActionModal({ id:row.id, type:'reject', leave:row }); setComment(''); }}>
                ✗
              </button>
            )}
            {!amReco && !isApproverFor(row.employeeId) && (
              <span style={{ fontSize:11, color:'#9ca3af' }}>—</span>
            )}
          </div>
        );
      }
    },
  ];

  return (
    <div className={embedded ? '' : 'page-container'}>
      {!embedded && (
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
      )}
      {embedded && isRecoCompulsory && (
        <div style={{ marginBottom:14 }}>
          <span style={{ fontSize:12, fontWeight:700, padding:'2px 10px', borderRadius:10,
            background:'#fef3c7', color:'#92400e', border:'1px solid #fde68a' }}>
            ⚠️ Recommendation Compulsory
          </span>
        </div>
      )}

      {/* Stats — compact pills, matching the Staff Detail summary chips */}
      <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:20 }}>
        {[
          { label:t('Pending'),   count:myLeaves.filter(l=>l.status==='pending').length,  bg:'#fdf3d0', color:'#92400e' },
          { label:'Recommended',  count:myLeaves.filter(l=>!!l.recommendedBy).length,     bg:'#d1fae5', color:'#059669' },
          { label:t('Approved'),  count:myLeaves.filter(l=>l.status==='approved').length, bg:'#d1fae5', color:'#0e9f6e' },
          { label:t('Rejected'),  count:myLeaves.filter(l=>l.status==='rejected').length, bg:'#fde8e8', color:'#f05252' },
        ].map((s, i) => (
          <span key={i} style={{ display:'inline-flex', alignItems:'center', gap:6, background:s.bg, color:s.color, borderRadius:6, padding:'3px 12px', fontSize:12, fontWeight:600 }}>
            {s.label}: <strong style={{ fontSize:14 }}>{s.count}</strong>
          </span>
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
            const amApprover = isApproverFor(l.employeeId) && canShowApprove(l.employeeId);
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
                    {/* Recommendation status — only meaningful when someone
                        is actually configured to give one; with none
                        configured there's nothing to wait for. */}
                    {isRecoCompulsory && hasRecommenderFor(l.employeeId) && (
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
                    <button className="btn btn-sm btn-success"
                      disabled={!canApprove}
                      style={{ opacity: canApprove ? 1 : 0.4, cursor: canApprove ? 'pointer' : 'not-allowed' }}
                      title={canApprove ? '' : 'Recommendation required before approval'}
                      onClick={() => { if (canApprove) { setActionModal({ id:l.id, type:'approve', leave:l }); setComment(''); } }}>
                      ✓ {t('Approve')}
                    </button>
                  )}
                  {isApproverFor(l.employeeId) && (
                    <button className="btn btn-sm btn-danger"
                      onClick={() => { setActionModal({ id:l.id, type:'reject', leave:l }); setComment(''); }}>
                      ✗ {t('Reject')}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Full grid */}
      <DataGrid columns={columns} data={allLeaves} defaultPageSize={10}
        showSearch={true} searchPlaceholder={t('Search')+'...'} title={t('Leave Applications')} compact={true}
        onRowClick={row => setSelectedReason(row.reason)} />

      {/* Full Reason text — the grid's own Reason column is truncated to keep
          the table from needing a horizontal scrollbar. Clicking a row
          "selects" it (defaults to the first row so this is never empty);
          hovering any row's Reason cell temporarily previews that row's
          text here instead, reverting to the selection once the pointer
          leaves. Same convention as Missing Attendance Requests. */}
      {(() => {
        const shown = hoverReason ?? selectedReason;
        return (
          <div style={{ marginTop: 12, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8,
            padding: '10px 14px', minHeight: 40, fontSize: 13, color: shown ? '#374151' : '#9ca3af' }}>
            <strong style={{ color: '#374151', marginRight: 6 }}>{t('Reason')}:</strong>
            {shown || t('No applications to show.')}
          </div>
        );
      })()}

      {/* Action Modal */}
      {actionModal && (
        <div className="modal-overlay">
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
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
