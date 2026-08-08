import React, { useState, useMemo } from 'react';
import { useNavigate }  from 'react-router-dom';
import { useAuth }      from '../../context/AuthContext.jsx';
import { useLanguage }  from '../../context/LanguageContext.jsx';
import { useData }      from '../../context/DataContext.jsx';
import { useSettings }  from '../../context/SettingsContext.jsx';
import { makeDateFormatter } from '../../utils/dateUtils.js';
import DataGrid from '../DataGrid/DataGrid.jsx';

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

const OfficeVisitManagement = () => {
  const { currentUser, isManager } = useAuth();
  const { t } = useLanguage();
  const { settings } = useSettings();
  const fd = makeDateFormatter(settings);
  const { officeVisits, deleteVisit, recommendVisit, getEmployeeName } = useData();
  const navigate = useNavigate();
  const [filterStatus,   setFilterStatus]   = useState('all');
  const [viewVisit,      setViewVisit]      = useState(null);
  const [deleteConfirm,  setDeleteConfirm]  = useState(null);
  const [recoConfirm,    setRecoConfirm]    = useState(null); // { id, visit }
  const [recoComment,    setRecoComment]    = useState('');

  const recoConfig = useMemo(() => loadRecoConfig(), []);
  const isRecommenderFor = (empId) => {
    const r = recoConfig[String(empId)]?.reco;
    const ids = Array.isArray(r) ? r : (r ? [r] : []);
    return ids.map(String).includes(String(currentUser.id));
  };

  const displayVisits = officeVisits.filter(v => {
    if (!isManager && v.employeeId !== currentUser.id) return false;
    if (filterStatus !== 'all' && v.status !== filterStatus) return false;
    return true;
  });

  const columns = [
    { field: 'employeeId', header: t('Name'), width: 150, render: v => <span style={{ fontWeight: 500 }}>{getEmployeeName(v)}</span> },
    { field: 'purpose', header: t('Purpose'), width: 150 },
    { field: 'location', header: t('Location'), width: 120 },
    { field: 'fromDate',    header: t('From Date'),    width: 120, render: v => fd(v) },
    { field: 'fromTime',    header: t('From Time'),    width: 80,  align: 'center' },
    { field: 'toDate',      header: t('To Date'),      width: 120, render: v => fd(v) },
    { field: 'toTime',      header: t('To Time'),      width: 80,  align: 'center' },
    { field: 'appliedDate', header: t('Applied Date'), width: 120, render: v => fd(v) },
    { field: 'status', header: t('Status'), width: 120, render: v => <StatusBadge status={v} /> },
    { field: 'actions', header: t('Actions'), width: 150, filterable: false, sortable: false, render: (_, row) => {
      const amReco     = isRecommenderFor(row.employeeId);
      const alreadyReco = !!row.recommendedBy;
      return (
        <div className="dg-actions">
          <button className="dg-action-btn view" title={t('View')} onClick={e => { e.stopPropagation(); setViewVisit(row); }}>👁</button>
          {(isManager || row.status === 'pending') && (
            <button className="dg-action-btn delete" title={t('Delete')} onClick={e => { e.stopPropagation(); setDeleteConfirm(row.id); }}>🗑</button>
          )}
          {amReco && !alreadyReco && row.status === 'pending' && (
            <button
              title="Recommend"
              onClick={e => { e.stopPropagation(); setRecoConfirm({ id: row.id, visit: row }); setRecoComment(''); }}
              style={{ background: '#059669', color: '#fff', border: 'none', borderRadius: 4,
                padding: '3px 9px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              👍 Reco
            </button>
          )}
          {isManager && row.status === 'pending' && (
            <button className="dg-action-btn approve" title={t('Approve')} onClick={e => { e.stopPropagation(); navigate('/office-visit/approval'); }}>✓</button>
          )}
        </div>
      );
    }},
  ];

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">🏢 {t('Office Visit Management')}</h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {isManager && (
            <button className="btn btn-outline" onClick={() => navigate('/office-visit/approval')}>✅ {t('Visit Approval')}</button>
          )}
          <button className="btn btn-primary" onClick={() => navigate('/office-visit/apply')}>+ {t('Apply for Visit')}</button>
        </div>
      </div>

      {/* Status filter */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {['all', 'pending', 'approved', 'rejected'].map(s => (
          <button key={s} onClick={() => setFilterStatus(s)}
            className={`btn btn-sm ${filterStatus === s ? 'btn-primary' : 'btn-outline'}`}>
            {s === 'all' ? t('All') : s === 'pending' ? t('Pending') : s === 'approved' ? t('Approved') : t('Rejected')}
            <span style={{ marginLeft: 4, background: 'rgba(0,0,0,.1)', borderRadius: 10, padding: '1px 6px', fontSize: 11 }}>
              {s === 'all' ? officeVisits.length : officeVisits.filter(v => v.status === s).length}
            </span>
          </button>
        ))}
      </div>

      <DataGrid
        columns={columns}
        data={displayVisits}
        defaultPageSize={10}
        showSearch={true}
        searchPlaceholder={t('Search') + '...'}
        compact={true}
        onRowDoubleClick={row => setViewVisit(row)}
      />

      {/* View Modal */}
      {viewVisit && (
        <div className="modal-overlay">
          <div className="modal modal-md" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>🏢 {t('Office Visit Application')} #{viewVisit.id}</h2>
              <button className="modal-close" onClick={() => setViewVisit(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                {[
                  [t('Name'), getEmployeeName(viewVisit.employeeId)],
                  [t('Purpose'), viewVisit.purpose],
                  [t('Location'), viewVisit.location],
                  [t('From Date'), `${viewVisit.fromDate} ${viewVisit.fromTime}`],
                  [t('To Date'), `${viewVisit.toDate} ${viewVisit.toTime}`],
                  [t('Status'), <StatusBadge status={viewVisit.status} />],
                  [t('Applied Date'), viewVisit.appliedDate],
                  [t('Approved By'), getEmployeeName(viewVisit.approvedBy) || '—'],
                ].map(([label, val], i) => (
                  <div key={i}>
                    <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', marginBottom: 2 }}>{label}</div>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{val}</div>
                  </div>
                ))}
              </div>
              {viewVisit.description && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>{t('Description')}</div>
                  <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, padding: 10, fontSize: 13 }}>{viewVisit.description}</div>
                </div>
              )}
              {viewVisit.comment && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>{t('Comment')}</div>
                  <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, padding: 10, fontSize: 13 }}>{viewVisit.comment}</div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setViewVisit(null)}>{t('Close')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteConfirm && (
        <div className="modal-overlay">
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h2>⚠️ {t('Delete Confirmation')}</h2><button className="modal-close" onClick={() => setDeleteConfirm(null)}>✕</button></div>
            <div className="modal-body"><p>{t('Are you sure you want to delete this record?')}</p></div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setDeleteConfirm(null)}>{t('Cancel')}</button>
              <button className="btn btn-danger" onClick={() => { deleteVisit(deleteConfirm); setDeleteConfirm(null); }}>🗑 {t('Delete')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Recommend confirm */}
      {recoConfirm && (
        <div className="modal-overlay">
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 style={{ color: '#065f46' }}>👍 Recommend Office Visit</h2>
              <button className="modal-close" onClick={() => setRecoConfirm(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 13, color: '#374151', marginBottom: 12 }}>
                Recommend <strong>{getEmployeeName(recoConfirm.visit.employeeId)}</strong>'s office visit?
              </p>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Comment (optional)</div>
              <textarea
                value={recoComment}
                onChange={e => setRecoComment(e.target.value)}
                rows={3}
                placeholder="Add a recommendation comment..."
                style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 6,
                  padding: '8px 10px', fontSize: 13, resize: 'vertical', outline: 'none',
                  fontFamily: 'inherit', boxSizing: 'border-box' }}
              />
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setRecoConfirm(null)}>{t('Cancel')}</button>
              <button
                onClick={() => { recommendVisit(recoConfirm.id, currentUser.id, recoComment); setRecoConfirm(null); setRecoComment(''); }}
                style={{ background: '#059669', color: '#fff', border: 'none', borderRadius: 7,
                  padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                👍 Confirm Recommend
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OfficeVisitManagement;

