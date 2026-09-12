import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import useDateFormat from '../../hooks/useDateFormat.js';
import { getNepalTodayISO, addDaysISO } from '../../utils/dateUtils.js';

/* Task module landing page (Task > Dashboard). Reuses the exact same
   GET /api/tasks(?staffId=all) scoping TaskList.jsx already uses for its
   "Filter by Staff" default (admin/superAdmin -> company-wide,
   branchManager/departmentHead -> their branch/department, plain employee ->
   own tasks only, server-scoped) — no new endpoint.

   Layout: Today's / Yesterday's summary tiles first, then a Task-Category-
   wise breakdown of ONLY today's tasks (one table per category, DataGrid's
   standard header/border tokens — see CLAUDE.md's DataGrid Standards table —
   so this reads as the same grid style as every other list page, not a
   one-off). Category tables reuse the openTaskId/openEvent deep link
   TaskList.jsx already opens the Followup History panel from (see its
   openTaskIdParam effect) so a row click jumps straight to that task. */

const STYLES = `
  .tdb-grid6 { display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:10px; }
  .tdb-card { background:#fff; border:1px solid #e2e8f0; border-radius:10px; padding:12px 14px; box-shadow:0 1px 4px rgba(0,0,0,.04); }
  .tdb-summary-cols { display:grid; grid-template-columns:1fr 1fr; gap:18px; margin-bottom:22px; }
  .tdb-section { background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:16px 18px; }
  .tdb-section-title { font-size:14px; font-weight:800; color:#1e293b; margin:0 0 12px 0; display:flex; align-items:center; gap:8px; }
  .tdb-section-date { font-size:11.5px; font-weight:600; color:#94a3b8; }
  .tdb-page-heading { font-size:15px; font-weight:800; color:#1e293b; margin:0 0 12px 0; display:flex; align-items:center; gap:8px; }
  .tdb-cat-card { background:#fff; border:1px solid #dedede; border-radius:10px; margin-bottom:16px; overflow:hidden; }
  .tdb-cat-head { background:#efefef; border-bottom:2px solid #dedede; padding:9px 14px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; }
  .tdb-cat-name { font-size:13px; font-weight:700; color:#374151; }
  .tdb-cat-chip { font-size:11px; font-weight:700; padding:2px 9px; border-radius:20px; margin-left:6px; }
  .tdb-table { width:100%; border-collapse:collapse; }
  .tdb-table th { background:#efefef; color:#374151; font-size:12px; font-weight:700; text-align:left; padding:8px 12px; border-bottom:2px solid #dedede; border-right:1px solid #dedede; white-space:nowrap; }
  .tdb-table th:last-child, .tdb-table td:last-child { border-right:none; }
  .tdb-table td { font-size:13px; color:#374151; padding:8px 12px; border-bottom:1px solid #dedede; border-right:1px solid #dedede; }
  .tdb-table tbody tr { cursor:pointer; }
  .tdb-table tbody tr:nth-child(even) { background:#fafafa; }
  .tdb-table tbody tr:hover { background:#e0e7f0; }
  .tdb-status-badge { display:inline-block; font-size:11px; font-weight:700; padding:2px 9px; border-radius:20px; white-space:nowrap; }
  @media(max-width:720px){ .tdb-summary-cols{ grid-template-columns:1fr; } }
  @media(max-width:480px){ .tdb-grid6{ grid-template-columns:repeat(2,1fr); } }
`;

const STAT_DEFS = [
  { key: 'total',      label: 'Total',      icon: '📋', iconBg: '#475569' },
  { key: 'processing', label: 'Processing', icon: '⚙️', iconBg: '#2563eb' },
  { key: 'pending',    label: 'Pending',    icon: '⏳', iconBg: '#d97706' },
  { key: 'complete',   label: 'Completed',  icon: '✅', iconBg: '#059669' },
  { key: 'cancel',     label: 'Cancels',    icon: '✖️', iconBg: '#dc2626' },
  { key: 'transfer',   label: 'Transfer',   icon: '🔁', iconBg: '#7c3aed' },
];

const STATUS_STYLE = {
  pending:     { bg: '#fffbeb', color: '#b45309', label: 'Pending' },
  in_progress: { bg: '#eff6ff', color: '#1d4ed8', label: 'Processing' },
  completed:   { bg: '#f0fdf4', color: '#065f46', label: 'Completed' },
  cancelled:   { bg: '#fff5f5', color: '#991b1b', label: 'Cancelled' },
};

const StatTile = ({ label, value, icon, iconBg }) => (
  <div className="tdb-card">
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
      <span style={{ fontSize: 11.5, color: '#64748b', fontWeight: 600 }}>{label}</span>
      <div style={{ width: 28, height: 28, borderRadius: '50%', background: iconBg, display: 'flex',
        alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0 }}>{icon}</div>
    </div>
    <span style={{ fontSize: 22, fontWeight: 800, color: '#1e293b', lineHeight: 1 }}>{value}</span>
  </div>
);

const StatusBadge = ({ status }) => {
  const s = STATUS_STYLE[status] || { bg: '#f1f5f9', color: '#64748b', label: status || '—' };
  return <span className="tdb-status-badge" style={{ background: s.bg, color: s.color }}>{s.label}</span>;
};

const emptyStats = () => ({ total: 0, pending: 0, processing: 0, complete: 0, cancel: 0, transfer: 0 });

const bucketStats = (tasks, dateISO) => {
  const s = emptyStats();
  tasks.forEach(t => {
    const due = t.dueDate ? String(t.dueDate).split('T')[0] : null;
    if (due !== dateISO) return;
    s.total++;
    if (t.status === 'pending') s.pending++;
    else if (t.status === 'in_progress') s.processing++;
    else if (t.status === 'completed') s.complete++;
    else if (t.status === 'cancelled') s.cancel++;
    if (t.hasTransfer) s.transfer++;
  });
  return s;
};

// Groups today's-due tasks by Task Category — only the categories that
// actually have a task due today show up, each with its own mini "Total /
// Completed / Uncompleted" tally alongside the row list (SN, Task Name,
// Company Name, Mobile, Address, Status), matching the per-category tables
// in the original Excel mockup.
const groupTodayByCategory = (tasks, todayISO) => {
  const map = new Map();
  tasks.forEach(t => {
    const due = t.dueDate ? String(t.dueDate).split('T')[0] : null;
    if (due !== todayISO) return;
    const key = t.categoryName || 'Uncategorized';
    if (!map.has(key)) map.set(key, { categoryName: key, rows: [], total: 0, completed: 0, uncompleted: 0 });
    const g = map.get(key);
    g.rows.push(t);
    g.total++;
    if (t.status === 'completed') g.completed++; else g.uncompleted++;
  });
  return [...map.values()].sort((a, b) => b.total - a.total);
};

export default function TaskDashboard() {
  const navigate = useNavigate();
  const { isAdmin, isSuperAdmin, isBranchManager, isDeptHead } = useAuth();
  const fd = useDateFormat();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  const isWideScope = isAdmin || isSuperAdmin || isBranchManager || isDeptHead;

  useEffect(() => {
    setLoading(true);
    const qs = isWideScope ? '?staffId=all' : '';
    api.get(`/tasks${qs}`).then(rows => setTasks(Array.isArray(rows) ? rows : []))
      .catch(() => setTasks([]))
      .finally(() => setLoading(false));
  }, [isWideScope]);

  const today = getNepalTodayISO();
  const yesterday = useMemo(() => addDaysISO(today, -1), [today]);

  const buckets = useMemo(() => ([
    { key: 'today',     title: "Today's Task",     dateISO: today },
    { key: 'yesterday', title: "Yesterday's Task",  dateISO: yesterday },
  ].map(b => ({ ...b, stats: bucketStats(tasks, b.dateISO) }))), [tasks, today, yesterday]);

  const categoryGroups = useMemo(() => groupTodayByCategory(tasks, today), [tasks, today]);

  const openTask = (row) => navigate(`/staff/task?openTaskId=${row.id}&openEvent=view`);

  return (
    <div style={{ padding: '20px 24px' }}>
      <style>{STYLES}</style>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
        <h1 className="page-title">📊 Task Dashboard</h1>
        <button className="btn btn-primary" onClick={() => navigate('/staff/task')}>
          👁️ View Task
        </button>
      </div>

      {loading ? (
        <div style={{ padding: 48, textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>Loading...</div>
      ) : (
        <>
          <div className="tdb-summary-cols">
            {buckets.map(b => (
              <div key={b.key} className="tdb-section">
                <h2 className="tdb-section-title">
                  {b.title} <span className="tdb-section-date">({fd(b.dateISO)})</span>
                </h2>
                <div className="tdb-grid6">
                  {STAT_DEFS.map(def => (
                    <StatTile key={def.key} label={def.label} value={b.stats[def.key]} icon={def.icon} iconBg={def.iconBg} />
                  ))}
                </div>
              </div>
            ))}
          </div>

          <h2 className="tdb-page-heading">
            🗂️ Task Categories — Today's Task <span className="tdb-section-date">({fd(today)})</span>
          </h2>

          {categoryGroups.length === 0 ? (
            <div className="tdb-section" style={{ textAlign: 'center', color: '#9ca3af', fontSize: 13.5, padding: 32 }}>
              No tasks due today.
            </div>
          ) : (
            categoryGroups.map(g => (
              <div key={g.categoryName} className="tdb-cat-card">
                <div className="tdb-cat-head">
                  <span className="tdb-cat-name">{g.categoryName}</span>
                  <div>
                    <span className="tdb-cat-chip" style={{ background: '#e2e8f0', color: '#374151' }}>Total: {g.total}</span>
                    <span className="tdb-cat-chip" style={{ background: '#f0fdf4', color: '#065f46' }}>Completed: {g.completed}</span>
                    <span className="tdb-cat-chip" style={{ background: '#fff5f5', color: '#991b1b' }}>Uncompleted: {g.uncompleted}</span>
                  </div>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table className="tdb-table">
                    <thead>
                      <tr>
                        <th style={{ width: 46 }}>SN</th>
                        <th>Task Name</th>
                        <th>Company Name</th>
                        <th>Mobile</th>
                        <th>Address</th>
                        <th style={{ width: 110 }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.rows.map((t, i) => (
                        <tr key={t.id} onClick={() => openTask(t)}>
                          <td>{i + 1}</td>
                          <td>{t.title || '—'}</td>
                          <td>{t.customerName || '—'}</td>
                          <td>{t.customerMobile || t.customerPhone || '—'}</td>
                          <td>{t.customerAddress || t.customerCompanyAddress || '—'}</td>
                          <td><StatusBadge status={t.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}
        </>
      )}
    </div>
  );
}
