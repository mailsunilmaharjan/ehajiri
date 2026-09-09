import React, { useState } from 'react';
import { useNavigate }  from 'react-router-dom';
import { useAuth }      from '../../context/AuthContext.jsx';
import { useLanguage }  from '../../context/LanguageContext.jsx';
import { useData }      from '../../context/DataContext.jsx';
import { useSettings }  from '../../context/SettingsContext.jsx';
import { makeDateFormatter } from '../../utils/dateUtils.js';
import DataGrid from '../DataGrid/DataGrid.jsx';
import Avatar from '../Common/Avatar.jsx';
import RecordPreviewModal from '../Common/RecordPreviewModal.jsx';
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

const OfficeVisitManagement = () => {
  const { currentUser, isManager } = useAuth();
  const { t } = useLanguage();
  const { settings } = useSettings();
  const fd = makeDateFormatter(settings);
  const { officeVisits, deleteVisit, recommendVisit, getEmployeeName, getEmployeeById } = useData();
  const navigate = useNavigate();
  const [filterStatus,   setFilterStatus]   = useState('all');
  const [viewVisit,      setViewVisit]      = useState(null);
  const [deleteConfirm,  setDeleteConfirm]  = useState(null);
  const [recoConfirm,    setRecoConfirm]    = useState(null); // { id, visit }
  const [recoComment,    setRecoComment]    = useState('');

  const { assignments: recoConfig } = useRecoApproval();
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
    { field: 'employeeId', header: t('Staff ID'), width: 80, sortable: false, render: v => getEmployeeById(v)?.employeeId || '—' },
    { field: 'employeeId', header: t('Name'), width: 150, render: v => (
        <span style={{ display:'flex', alignItems:'center', gap:6, fontWeight: 500 }}>
          <Avatar photo={getEmployeeById(v)?.profilePhoto} name={getEmployeeName(v)} size={22} />
          {getEmployeeName(v)}
        </span>
      ) },
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
        <RecordPreviewModal
          icon="🏢" title={t('Office Visit Application')} id={viewVisit.id}
          onClose={() => setViewVisit(null)} closeLabel={t('Close')}
          avatarPhoto={getEmployeeById(viewVisit.employeeId)?.profilePhoto}
          avatarName={getEmployeeName(viewVisit.employeeId)}
          subtitle={viewVisit.purpose}
          statusBadge={<StatusBadge status={viewVisit.status} />}
          fields={[
            { icon:'📍', label:t('Location'),     value:viewVisit.location },
            { icon:'📆', label:t('From Date'),    value:`${viewVisit.fromDate} ${viewVisit.fromTime}` },
            { icon:'📆', label:t('To Date'),       value:`${viewVisit.toDate} ${viewVisit.toTime}` },
            { icon:'🗓️', label:t('Applied Date'),  value:viewVisit.appliedDate },
            { icon:'✅', label:t('Approved By'),   value:getEmployeeName(viewVisit.approvedBy) || '—' },
          ]}
          sections={[
            { label:t('Description'), value:viewVisit.description },
            { label:t('Comment'),     value:viewVisit.comment },
          ]}
        />
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

