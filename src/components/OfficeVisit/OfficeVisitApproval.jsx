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

const OfficeVisitApproval = () => {
  const { currentUser } = useAuth();
  const { t }           = useLanguage();
  const { settings }    = useSettings();
  const fd              = makeDateFormatter(settings);
  const {
    filteredVisits: officeVisits, approveVisit, rejectVisit, recommendVisit,
    getEmployeeName, getEmployeeById,
  } = useData();

  const [actionModal, setActionModal] = useState(null);
  const [comment,     setComment]     = useState('');
  const [toast,       setToast]       = useState(null);

  /* ── Load reco config ── */
  const recoConfig       = useMemo(() => loadRecoConfig(), []);
  const isRecoCompulsory = recoConfig._settings?.isRecoCompulsory || false;

  const showToast = (msg, type) => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

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

  const canApproveVisit = (visit) =>
    !isRecoCompulsory || !!visit.recommendedBy;

  /* ── Handle action ── */
  const handleAction = () => {
    if (!actionModal) return;
    const { id, type } = actionModal;
    if (type === 'recommend') {
      recommendVisit(id, currentUser.id, comment);
      showToast('Office visit recommended successfully', 'success');
    } else if (type === 'approve') {
      approveVisit(id, currentUser.id, comment);
      showToast(t('Application approved'), 'success');
    } else {
      rejectVisit(id, currentUser.id, comment);
      showToast(t('Application rejected'), 'danger');
    }
    setActionModal(null);
    setComment('');
  };

  const pending = officeVisits.filter(v => v.status === 'pending');
  const all     = [...officeVisits].sort((a, b) => new Date(b.appliedDate) - new Date(a.appliedDate));

  /* ── Grid columns ── */
  const columns = [
    { field:'employeeId',  header:t('Name'),          width:150, render:v=><span style={{ fontWeight:600, color:'#111827' }}>{getEmployeeName(v)}</span> },
    { field:'purpose',     header:'Official Visit',   width:140 },
    { field:'visitType',   header:'Visit Type',       width:110, render:v=>(
      <span style={{ fontSize:12, fontWeight:600, padding:'2px 8px', borderRadius:8,
        background: v==='International' ? '#f5f3ff' : '#f0fdf4',
        color: v==='International' ? '#7c3aed' : '#059669' }}>
        {v==='International' ? '🌍' : '🇳🇵'} {v || 'National'}
      </span>
    )},
    { field:'country',     header:'Country',          width:100, render:v=>v||'—' },
    { field:'address',     header:'Address',          width:140, render:v=>v||'—' },
    { field:'fromDate',    header:t('From Date'),     width:110, render:v=>fd(v) },
    { field:'toDate',      header:t('To Date'),       width:110, render:v=>fd(v) },
    { field:'appliedDate', header:t('Applied Date'),  width:110, render:v=>fd(v) },
    { field:'status',      header:t('Status'),       width:130, render:(v, row)=>(
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
        const amReco      = isRecommenderFor(row.employeeId);
        const amApprover  = isApproverFor(row.employeeId);
        const canApprove  = canApproveVisit(row);
        const alreadyReco = !!row.recommendedBy;

        if (row.status !== 'pending') {
          return <span style={{ fontSize:12, color:'#9ca3af' }}>{row.status==='approved'?'✅':'❌'}</span>;
        }
        return (
          <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
            {amReco && !alreadyReco && (
              <button className="dg-action-btn"
                style={{ background:'#059669', color:'white', border:'none', fontSize:12, padding:'3px 8px', borderRadius:4, cursor:'pointer' }}
                onClick={e => { e.stopPropagation(); setActionModal({ id:row.id, type:'recommend', visit:row }); setComment(''); }}>
                👍 Reco
              </button>
            )}
            {amApprover && (
              <button className="dg-action-btn approve"
                disabled={!canApprove}
                style={{ opacity: canApprove ? 1 : 0.4, cursor: canApprove ? 'pointer' : 'not-allowed' }}
                title={canApprove ? t('Approve') : 'Awaiting recommendation first'}
                onClick={e => { e.stopPropagation(); if (canApprove) { setActionModal({ id:row.id, type:'approve', visit:row }); setComment(''); } }}>✓</button>
            )}
            {amApprover && (
              <button className="dg-action-btn reject"
                onClick={e => { e.stopPropagation(); setActionModal({ id:row.id, type:'reject', visit:row }); setComment(''); }}>✗</button>
            )}
            {!amReco && !amApprover && <span style={{ fontSize:11, color:'#9ca3af' }}>—</span>}
          </div>
        );
      }
    },
  ];

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">✅ {t('Visit Approval')}</h1>
          <div style={{ display:'flex', alignItems:'center', gap:10, marginTop:4, flexWrap:'wrap' }}>
            <p className="page-subtitle" style={{ margin:0 }}>{pending.length} {t('Pending Approvals')}</p>
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
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14, marginBottom:20 }}>
        {[
          { label:t('Pending'),   count:officeVisits.filter(v=>v.status==='pending').length,  color:'#e3a008', bg:'#fdf3d0' },
          { label:'Recommended', count:officeVisits.filter(v=>!!v.recommendedBy).length,     color:'#059669', bg:'#d1fae5' },
          { label:t('Approved'), count:officeVisits.filter(v=>v.status==='approved').length, color:'#0e9f6e', bg:'#d1fae5' },
          { label:t('Rejected'), count:officeVisits.filter(v=>v.status==='rejected').length, color:'#f05252', bg:'#fde8e8' },
        ].map((s, i) => (
          <div key={i} style={{ background:s.bg, borderRadius:8, padding:'14px 18px',
            display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span style={{ fontSize:13, fontWeight:600, color:s.color }}>{s.label}</span>
            <span style={{ fontSize:26, fontWeight:700, color:s.color }}>{s.count}</span>
          </div>
        ))}
      </div>

      {/* Pending cards */}
      {pending.length > 0 && (
        <div className="card" style={{ marginBottom:20, borderLeft:'4px solid #e3a008' }}>
          <div className="card-header" style={{ background:'#fffbeb' }}>
            <h3>⏳ Pending Office Visit Applications ({pending.length})</h3>
          </div>
          {pending.map(v => {
            const amReco      = isRecommenderFor(v.employeeId);
            const amApprover  = isApproverFor(v.employeeId);
            const canApprove  = canApproveVisit(v);
            const alreadyReco = !!v.recommendedBy;

            return (
              <div key={v.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
                padding:'12px 18px', borderBottom:'1px solid #f9fafb', flexWrap:'wrap', gap:10 }}>
                <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                  {getEmployeeById(v.employeeId)?.profilePhoto ? (
                    <div style={{ width:38, height:38, borderRadius:'50%', overflow:'hidden', flexShrink:0, background:'#fdf3d0' }}>
                      <img src={getEmployeeById(v.employeeId).profilePhoto} alt=""
                        style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }} />
                    </div>
                  ) : (
                    <div style={{ width:38, height:38, borderRadius:'50%', background:'#fdf3d0',
                      color:'#e3a008', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, fontSize:15 }}>
                      {getEmployeeName(v.employeeId)[0]}
                    </div>
                  )}
                  <div>
                    <div style={{ fontSize:13, fontWeight:700, color:'#111827' }}>{getEmployeeName(v.employeeId)}</div>
                    <div style={{ fontSize:12, color:'#374151' }}>
                      {v.purpose || v.officialVisit}
                      {v.visitType && <span style={{ marginLeft:6, fontSize:11, fontWeight:600,
                        color: v.visitType==='International'?'#7c3aed':'#059669' }}>
                        {v.visitType==='International'?'🌍':'🇳🇵'} {v.visitType}
                      </span>}
                      {v.country && ` · ${v.country}`}
                    </div>
                    <div style={{ fontSize:11, color:'#6b7280' }}>{v.address||v.location} · {v.fromDate} – {v.toDate}</div>
                    {isRecoCompulsory && (
                      <div style={{ marginTop:3 }}>
                        {alreadyReco
                          ? <RecoTag name={getEmployeeName(v.recommendedBy)} />
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
                      onClick={() => { setActionModal({ id:v.id, type:'recommend', visit:v }); setComment(''); }}>
                      👍 Recommend
                    </button>
                  )}
                  {amApprover && (
                    <>
                      <button className="btn btn-sm btn-success"
                        disabled={!canApprove}
                        style={{ opacity: canApprove ? 1 : 0.4, cursor: canApprove ? 'pointer' : 'not-allowed' }}
                        title={canApprove ? '' : 'Recommendation required before approval'}
                        onClick={() => { if (canApprove) { setActionModal({ id:v.id, type:'approve', visit:v }); setComment(''); } }}>
                        ✓ {t('Approve')}
                      </button>
                      <button className="btn btn-sm btn-danger"
                        onClick={() => { setActionModal({ id:v.id, type:'reject', visit:v }); setComment(''); }}>
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
      <DataGrid columns={columns} data={all} defaultPageSize={10}
        showSearch={true} searchPlaceholder={t('Search')+'...'} title={t('Visit Applications')} compact={true} />

      {/* Action Modal */}
      {actionModal && (
        <div className="modal-overlay">
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>
                {actionModal.type === 'recommend' ? '👍 Recommend'
                  : actionModal.type === 'approve' ? `✅ ${t('Approve')}`
                  : `❌ ${t('Reject')}`} — Office Visit
              </h2>
              <button className="modal-close" onClick={() => setActionModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ background:'#f9fafb', borderRadius:8, padding:12, marginBottom:14, fontSize:13 }}>
                <div style={{ fontWeight:700, color:'#111827' }}>{getEmployeeName(actionModal.visit.employeeId)}</div>
                <div style={{ color:'#374151', marginTop:2 }}>
                  {actionModal.visit.purpose || actionModal.visit.officialVisit}
                  {actionModal.visit.visitType && (
                    <span style={{ marginLeft:8, fontSize:11, fontWeight:700, padding:'1px 8px', borderRadius:8,
                      background: actionModal.visit.visitType==='International'?'#f5f3ff':'#f0fdf4',
                      color: actionModal.visit.visitType==='International'?'#7c3aed':'#059669' }}>
                      {actionModal.visit.visitType==='International'?'🌍':'🇳🇵'} {actionModal.visit.visitType}
                    </span>
                  )}
                </div>
                {actionModal.visit.country && <div style={{ color:'#374151' }}>Country: <strong>{actionModal.visit.country}</strong></div>}
                <div style={{ color:'#374151' }}>{actionModal.visit.address||actionModal.visit.location}</div>
                <div style={{ color:'#374151' }}>{actionModal.visit.fromDate} – {actionModal.visit.toDate}</div>
                {actionModal.visit.description && <div style={{ color:'#6b7280', marginTop:4 }}>{actionModal.visit.description}</div>}
                {actionModal.visit.recommendedBy && (
                  <div style={{ marginTop:6 }}>
                    <RecoTag name={getEmployeeName(actionModal.visit.recommendedBy)} />
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
                className={`btn ${actionModal.type === 'reject' ? 'btn-danger' : 'btn-success'}`}
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

export default OfficeVisitApproval;
