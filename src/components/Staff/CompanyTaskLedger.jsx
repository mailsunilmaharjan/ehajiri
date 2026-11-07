import React, { useEffect, useMemo, useState } from 'react';
import api from '../../api/client.js';
import DataGrid from '../DataGrid/DataGrid.jsx';
import useDateFormat from '../../hooks/useDateFormat.js';

/**
 * Task Ledger for one company/contact — every task linked to it (all
 * statuses, including old completed/cancelled ones), newest due date first.
 *
 * Opened from the Task side panel (click the company name) and from Contact
 * Management. Loads through the normal GET /tasks (staffId=all) so each user
 * only ever sees the tasks their role already allows; no extra server route.
 */
const STATUS_META = {
  pending:     { label: 'Pending',     bg: '#fef3c7', color: '#92400e' },
  in_progress: { label: 'In Progress', bg: '#dbeafe', color: '#1e40af' },
  completed:   { label: 'Completed',   bg: '#d1fae5', color: '#065f46' },
  cancelled:   { label: 'Cancelled',   bg: '#fee2e2', color: '#991b1b' },
};

const dateOnly = (v) => (v ? String(v).split('T')[0] : '');

const CompanyTaskLedger = ({ contactId, name, subtitle, onClose }) => {
  const fd = useDateFormat();
  const [tasks, setTasks]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [status, setStatus]   = useState('all');

  useEffect(() => {
    let alive = true;
    setLoading(true); setError('');
    api.get('/tasks?staffId=all')
      .then(rows => { if (alive) setTasks(Array.isArray(rows) ? rows : []); })
      .catch(e => { if (alive) setError(e.message || 'Failed to load tasks'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [contactId]);

  const companyTasks = useMemo(() => tasks
    .filter(t => String(t.contactId) === String(contactId))
    .sort((a, b) => (dateOnly(b.dueDate) || '').localeCompare(dateOnly(a.dueDate) || '') || b.id - a.id),
  [tasks, contactId]);

  const counts = useMemo(() => {
    const c = { all: companyTasks.length, pending: 0, in_progress: 0, completed: 0, cancelled: 0 };
    companyTasks.forEach(t => { if (c[t.status] !== undefined) c[t.status] += 1; });
    return c;
  }, [companyTasks]);

  const rows = useMemo(
    () => (status === 'all' ? companyTasks : companyTasks.filter(t => t.status === status)),
    [companyTasks, status]
  );

  const columns = [
    { field: 'title', header: 'Task', width: 480,
      render: v => <span style={{ fontWeight: 600, color: '#1f2937' }}>{v}</span> },
    { field: 'dueDate', header: 'Due Date', width: 120,
      render: v => (v ? fd(dateOnly(v)) : <span style={{ color: '#d1d5db' }}>—</span>) },
    { field: 'status', header: 'Status', width: 110,
      render: v => {
        const m = STATUS_META[v] || { label: v, bg: '#f3f4f6', color: '#374151' };
        return <span style={{ background: m.bg, color: m.color, borderRadius: 10, padding: '1px 9px', fontSize: 11.5, fontWeight: 700 }}>{m.label}</span>;
      } },
    { field: 'priorityName', header: 'Priority', width: 90,
      render: v => v || <span style={{ color: '#d1d5db' }}>—</span> },
    { field: 'categoryName', header: 'Category', width: 150,
      render: v => v || <span style={{ color: '#d1d5db' }}>—</span> },
    { field: 'assignees', header: 'Assigned To', width: 240,
      render: v => (Array.isArray(v) && v.length ? v.map(a => a.name).join(', ') : <span style={{ color: '#d1d5db' }}>—</span>) },
    { field: 'followupCount', header: 'Followups', width: 80,
      render: v => v || 0 },
  ];

  const chip = (key, label) => (
    <button key={key} onClick={() => setStatus(key)}
      style={{ padding: '4px 12px', borderRadius: 14, cursor: 'pointer', fontSize: 12.5, fontWeight: 600,
        border: `1px solid ${status === key ? '#1a56db' : '#d1d5db'}`,
        background: status === key ? '#eff6ff' : '#fff', color: status === key ? '#1a56db' : '#374151' }}>
      {label} ({counts[key]})
    </button>
  );

  return (
    <div className="modal-overlay" style={{ zIndex: 2000 }} onClick={onClose}>
      <div className="modal" style={{ maxWidth: 1500, width: '96vw', height: '92vh', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>📒 Task Ledger — {name || 'Company'}</h2>
            {subtitle && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{subtitle}</div>}
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#9ca3af' }}>Loading tasks…</div>
          ) : error ? (
            <div style={{ padding: 20, color: '#b91c1c' }}>{error}</div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                {chip('all', 'All')}
                {chip('pending', 'Pending')}
                {chip('in_progress', 'In Progress')}
                {chip('completed', 'Completed')}
                {chip('cancelled', 'Cancelled')}
              </div>
              <DataGrid columns={columns} data={rows} rowKey="id" title="Tasks" defaultPageSize={20} striped />
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default CompanyTaskLedger;
