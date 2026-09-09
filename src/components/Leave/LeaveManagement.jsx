import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth }     from '../../context/AuthContext.jsx';
import { useLanguage } from '../../context/LanguageContext.jsx';
import { useData }     from '../../context/DataContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import { makeDateFormatter } from '../../utils/dateUtils.js';
import DataGrid from '../DataGrid/DataGrid.jsx';
import Avatar from '../Common/Avatar.jsx';
import RecordPreviewModal from '../Common/RecordPreviewModal.jsx';

const StatusBadge = ({ status }) => {
  const map = {
    pending: { cls: 'badge-warning', label: 'विचाराधीन' },
    approved: { cls: 'badge-success', label: 'स्वीकृत' },
    rejected: { cls: 'badge-danger', label: 'अस्वीकृत' },
  };
  const { cls, label } = map[status] || { cls: 'badge-gray', label: status };
  return <span className={`badge ${cls}`}>{label}</span>;
};

const LeaveManagement = () => {
  const { currentUser, isManager } = useAuth();
  const { t } = useLanguage();
  const { settings } = useSettings();
  const fd = makeDateFormatter(settings);
  const { filteredLeaves: leaves, deleteLeave, getEmployeeName, getEmployeeById, getLeaveTypeName, getLeaveTypeColor, leaveTypes, filteredEmployees: employees } = useData();
  const navigate = useNavigate();
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [showDeleteModal, setShowDeleteModal] = useState(null);
  const [viewLeave, setViewLeave] = useState(null);

  // Filter data
  const displayLeaves = leaves.filter(l => {
    if (!isManager && String(l.employeeId) !== String(currentUser.id)) return false;
    if (filterStatus !== 'all' && l.status !== filterStatus) return false;
    if (filterType !== 'all' && l.leaveTypeCode !== filterType) return false;
    return true;
  });

  const handleDelete = (id) => {
    deleteLeave(id);
    setShowDeleteModal(null);
  };

  const columns = [
    { field: 'employeeId', header: t('Staff ID'), width: 80, sortable: false, render: (v) => getEmployeeById(v)?.employeeId || '—' },
    { field: 'employeeId', header: t('Name'), width: 160, render: (v) => (
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
        <Avatar photo={getEmployeeById(v)?.profilePhoto} name={getEmployeeName(v)} size={22} />
        {getEmployeeName(v)}
      </span>
    ) },
    { field: 'leaveTypeCode', header: t('Type'), width: 140, render: (v) => (
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: getLeaveTypeColor(v), display: 'inline-block', flexShrink: 0 }}></span>
        {getLeaveTypeName(v)}
      </span>
    )},
    { field: 'fromDate', header: t('From Date'), width: 120, render: v => fd(v) },
    { field: 'toDate',   header: t('To Date'),   width: 120, render: v => fd(v) },
    { field: 'days', header: t('Days'), width: 70, align: 'center', render: v => <span style={{ fontWeight: 600, color: '#1a56db' }}>{(isNaN(Number(v)) || v === null || v === undefined) ? '—' : v}</span> },
    { field: 'reason', header: t('Reason'), width: 160, render: v => <span style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>{v}</span> },
    { field: 'appliedDate', header: t('Applied Date'), width: 120, render: v => fd(v) },
    { field: 'status', header: t('Status'), width: 120, render: v => <StatusBadge status={v} /> },
    { field: 'actions', header: t('Actions'), width: 110, filterable: false, sortable: false, render: (_, row) => (
      <div className="dg-actions">
        <button className="dg-action-btn view" title={t('View')} onClick={e => { e.stopPropagation(); setViewLeave(row); }}>👁</button>
        {(isManager || row.status === 'pending') && (
          <button className="dg-action-btn delete" title={t('Delete')} onClick={e => { e.stopPropagation(); setShowDeleteModal(row.id); }}>🗑</button>
        )}
        {isManager && row.status === 'pending' && (
          <button className="dg-action-btn approve" title={t('Approve')} onClick={e => { e.stopPropagation(); navigate('/leave/approval'); }}>✓</button>
        )}
      </div>
    )},
  ];

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">📅 {t('Leave Management')}</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {isManager && (
            <button className="btn btn-outline" onClick={() => navigate('/leave/approval')}>
              ✅ {t('Leave Approval')}
            </button>
          )}
          <button className="btn btn-primary" onClick={() => navigate('/leave/apply')}>
            + {t('Apply for Leave')}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label style={{ fontSize: 13, color: '#6b7280', fontWeight: 500 }}>{t('Status')}:</label>
          <select className="form-control" style={{ width: 'auto', height: 32, padding: '4px 10px', fontSize: 13 }}
            value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="all">{t('All')}</option>
            <option value="pending">{t('Pending')}</option>
            <option value="approved">{t('Approved')}</option>
            <option value="rejected">{t('Rejected')}</option>
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label style={{ fontSize: 13, color: '#6b7280', fontWeight: 500 }}>{t('Type')}:</label>
          <select className="form-control" style={{ width: 'auto', height: 32, padding: '4px 10px', fontSize: 13 }}
            value={filterType} onChange={e => setFilterType(e.target.value)}>
            <option value="all">{t('All')}</option>
            {leaveTypes.map(lt => <option key={lt.code} value={lt.code}>{lt.name}</option>)}
          </select>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {['all', 'pending', 'approved', 'rejected'].map(s => (
            <button key={s} onClick={() => setFilterStatus(s)}
              className={`btn btn-sm ${filterStatus === s ? 'btn-primary' : 'btn-outline'}`}>
              {s === 'all' ? t('All') : s === 'pending' ? t('Pending') : s === 'approved' ? t('Approved') : t('Rejected')}
            </button>
          ))}
        </div>
      </div>

      <DataGrid
        columns={columns}
        data={displayLeaves}
        defaultPageSize={10}
        showSearch={true}
        searchPlaceholder={t('Search') + '...'}
        compact={true}
        onRowDoubleClick={row => setViewLeave(row)}
      />

      {/* View Modal */}
      {viewLeave && (
        <RecordPreviewModal
          icon="📅" title={t('Leave Application')} id={viewLeave.id}
          onClose={() => setViewLeave(null)} closeLabel={t('Close')}
          avatarPhoto={getEmployeeById(viewLeave.employeeId)?.profilePhoto}
          avatarName={getEmployeeName(viewLeave.employeeId)}
          subtitle={`${getLeaveTypeName(viewLeave.leaveTypeCode)} · ${viewLeave.days} ${t('Days')}`}
          statusBadge={<StatusBadge status={viewLeave.status} />}
          fields={[
            { icon:'📆', label:t('From Date'),    value:fd(viewLeave.fromDate) },
            { icon:'📆', label:t('To Date'),       value:fd(viewLeave.toDate) },
            { icon:'🗓️', label:t('Applied Date'),  value:fd(viewLeave.appliedDate) },
            { icon:'✅', label:t('Approved By'),   value:getEmployeeName(viewLeave.approvedBy) || '—' },
          ]}
          sections={[
            { label:t('Reason'),  value:viewLeave.reason },
            { label:t('Comment'), value:viewLeave.comment },
          ]}
        />
      )}

      {/* Delete Confirm */}
      {showDeleteModal && (
        <div className="modal-overlay">
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h2>⚠️ {t('Delete Confirmation')}</h2><button className="modal-close" onClick={() => setShowDeleteModal(null)}>✕</button></div>
            <div className="modal-body">
              <p style={{ color: '#374151', fontSize: 14 }}>{t('Are you sure you want to delete this record?')}</p>
              <p style={{ color: '#6b7280', fontSize: 12, marginTop: 6 }}>{t('This will permanently delete the selected record.')}</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setShowDeleteModal(null)}>{t('Cancel')}</button>
              <button className="btn btn-danger" onClick={() => handleDelete(showDeleteModal)}>🗑 {t('Delete')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LeaveManagement;

