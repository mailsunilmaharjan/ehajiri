import React, { useState } from 'react';
import { useData } from '../../context/DataContext.jsx';
import api from '../../api/client.js';
import DataGrid from '../DataGrid/DataGrid.jsx';

// Embedded as the "⚙️ Setting" tab inside OnlineAttendanceApproval.jsx (not
// a standalone page/route — merged in per request). Per-staff toggle — only
// staff enabled here can use the Online Attendance check-in/out from the
// floating "+" button. Both the per-row switch and the multi-select bulk
// action call the SAME targeted PUT /employees/online-attendance-bulk
// endpoint (never the full-object PUT /employees/:id, which expects every
// field in the payload and would silently null out anything omitted) —
// this always sends just {employeeIds, enabled}, so nothing else on the
// staff record can ever be touched by this page.
const OnlineAttendanceSettings = () => {
  const { employees, refreshEmployees } = useData();
  const [selectedRows, setSelectedRows] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (msg, color = '#059669') => {
    setToast({ msg, color });
    setTimeout(() => setToast(null), 3000);
  };

  const setEnabled = async (employeeIds, enabled) => {
    try {
      await api.put('/employees/online-attendance-bulk', { employeeIds, enabled });
      await refreshEmployees?.();
      showToast(enabled ? 'Online Attendance enabled' : 'Online Attendance disabled');
    } catch (e) { showToast(e.message || 'Update failed', '#dc2626'); }
  };

  const toggleOne = async (row) => {
    setBusyId(row.id);
    await setEnabled([row.id], !row.onlineAttendanceEnabled);
    setBusyId(null);
  };

  const bulkSet = async (enabled) => {
    if (!selectedRows.length) return;
    setBulkBusy(true);
    await setEnabled(selectedRows.map(Number), enabled);
    setBulkBusy(false);
    setSelectedRows([]);
  };

  const columns = [
    { field: 'employeeId', header: 'Employee ID', width: 110 },
    { field: 'fullName', header: 'Name', width: 180, render: (_, r) => <span style={{ fontWeight: 600 }}>{r.fullName}</span> },
    { field: 'department', header: 'Department', width: 150, render: v => v || '—' },
    { field: 'branch', header: 'Branch', width: 140, render: v => v || '—' },
    {
      field: 'onlineAttendanceEnabled', header: 'Online Attendance', width: 160, align: 'center',
      render: (_, r) => (
        <button onClick={() => toggleOne(r)} disabled={busyId === r.id}
          style={{ padding: '4px 12px', borderRadius: 14, border: 'none', cursor: busyId === r.id ? 'default' : 'pointer',
            fontSize: 11.5, fontWeight: 700,
            background: r.onlineAttendanceEnabled ? '#00A651' : '#e5e7eb',
            color: r.onlineAttendanceEnabled ? '#fff' : '#6b7280',
            opacity: busyId === r.id ? .6 : 1 }}>
          {r.onlineAttendanceEnabled ? '✓ Enabled' : 'Disabled'}
        </button>
      ),
    },
  ];

  return (
    <div>
      <div style={{ fontSize: 12.5, color: '#6b7280', marginBottom: 14 }}>
        Only staff enabled here can use Online Attendance check-in/check-out from the "+" button.
      </div>
      <DataGrid
        columns={columns} data={employees} rowKey="id" title="Staff" striped defaultPageSize={20}
        onSelectionChange={setSelectedRows}
        selectionActions={
          <>
            <button onClick={() => bulkSet(true)} disabled={bulkBusy || !selectedRows.length}
              style={{ padding: '6px 14px', borderRadius: 7, border: 'none', background: '#00A651', color: '#fff',
                fontSize: 12, fontWeight: 700, cursor: bulkBusy ? 'default' : 'pointer', opacity: !selectedRows.length ? .5 : 1 }}>
              Enable Selected
            </button>
            <button onClick={() => bulkSet(false)} disabled={bulkBusy || !selectedRows.length}
              style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid #d1d5db', background: '#fff', color: '#374151',
                fontSize: 12, fontWeight: 700, cursor: bulkBusy ? 'default' : 'pointer', opacity: !selectedRows.length ? .5 : 1 }}>
              Disable Selected
            </button>
          </>
        }
      />
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          background: toast.color, color: '#fff', padding: '10px 20px', borderRadius: 10,
          fontSize: 13, fontWeight: 600, boxShadow: '0 4px 16px rgba(0,0,0,.2)' }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
};

export default OnlineAttendanceSettings;
