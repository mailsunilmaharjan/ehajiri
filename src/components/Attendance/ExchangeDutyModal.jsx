import React, { useState } from 'react';
import DataGrid from '../DataGrid/DataGrid.jsx';
import Avatar from '../Common/Avatar.jsx';

/* Pick a staff member to swap duty with, for one specific employee + date.
   Single-select via row click; the selected row is called out on the Staff
   Name cell itself (checkmark + color) rather than a dedicated indicator
   column, and Department/Post/Duty are filterable via DataGrid's own
   built-in column filter row. */
const ExchangeDutyModal = ({ open, onClose, employee, dateStr, dateLabel, candidates = [], getDutyText, saving, onConfirm }) => {
  const [selectedId, setSelectedId] = useState(null);

  if (!open) return null;

  const empName = employee?.full_name || employee?.fullName || '';
  const selectedEmp = candidates.find(c => String(c.id) === String(selectedId));

  const columns = [
    { field: 'full_name', header: 'Staff Name', render: (v, row) => {
        const isSel = String(row.id) === String(selectedId);
        return (
          <span style={{ display:'flex', alignItems:'center', gap:6, fontWeight: isSel ? 700 : 400, color: isSel ? '#1a56db' : '#111827' }}>
            <Avatar photo={row.profile_photo || row.profilePhoto} name={v || row.fullName} size={20} />
            {isSel && '✓ '}{v || row.fullName || '—'}
          </span>
        );
      } },
    { field: 'department', header: 'Department', render: v => v || '—' },
    { field: 'position',   header: 'Post',       render: v => v || '—' },
    { field: '_duty',      header: 'Duty', filterable: false, render: (_, row) => getDutyText(row.id) },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: 'min(680px,95%)' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>🔄 Exchange Duty — {empName}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ fontSize: 12.5, color: '#6b7280', marginBottom: 12 }}>
            Swapping duty for <strong>{dateLabel || dateStr}</strong>. Current duty: <strong>{getDutyText(employee?.id)}</strong>.
            {' '}Select a staff member below to exchange with — both will swap their duty for this day only.
          </div>
          {candidates.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#9ca3af', fontSize: 12.5, border: '1px solid #e5e7eb', borderRadius: 8 }}>
              No other staff available to exchange with in this roster.
            </div>
          ) : (
            <DataGrid
              columns={columns}
              data={candidates}
              rowKey="id"
              defaultPageSize={8}
              compact={true}
              showCheckbox={false}
              onRowClick={row => setSelectedId(row.id)}
            />
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!selectedEmp || saving}
            onClick={() => onConfirm(selectedEmp)}>
            {saving ? '⏳ Exchanging…' : '🔄 Confirm Exchange'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ExchangeDutyModal;
