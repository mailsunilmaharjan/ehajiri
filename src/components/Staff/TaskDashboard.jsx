import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { getNepalTodayISO, addDaysISO } from '../../utils/dateUtils.js';

/* Task module landing page (Task > Dashboard). Reuses the exact same
   GET /api/tasks(?staffId=all) scoping TaskList.jsx already uses for its
   "Filter by Staff" default (admin/superAdmin -> company-wide,
   branchManager/departmentHead -> their branch/department, plain employee ->
   own tasks only, server-scoped) — no new endpoint. Buckets the result into
   Today/Yesterday/Tomorrow by literal due-date match and shows Total/
   Pending/Processing/Complete/Cancel/Transfer per bucket. Transfer comes
   from hasTransfer (server/routes/tasks.js), true when a task has at least
   one Followup with handed_over_to set. */

const STYLES = `
  .tdb-grid6 { display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:10px; }
  .tdb-card { background:#fff; border:1px solid #e2e8f0; border-radius:10px; padding:12px 14px; box-shadow:0 1px 4px rgba(0,0,0,.04); }
  .tdb-section { background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:16px 18px; margin-bottom:18px; }
  .tdb-section-title { font-size:14px; font-weight:800; color:#1e293b; margin:0 0 12px 0; display:flex; align-items:center; gap:8px; }
  .tdb-section-date { font-size:11.5px; font-weight:600; color:#94a3b8; }
  @media(max-width:480px){ .tdb-grid6{ grid-template-columns:repeat(2,1fr); } }
`;

const STAT_DEFS = [
  { key: 'total',      label: 'Total Task', icon: '📋', iconBg: '#475569' },
  { key: 'pending',    label: 'Pending',     icon: '⏳', iconBg: '#d97706' },
  { key: 'processing', label: 'Processing',  icon: '⚙️', iconBg: '#2563eb' },
  { key: 'complete',   label: 'Complete',    icon: '✅', iconBg: '#059669' },
  { key: 'cancel',     label: 'Cancel',      icon: '✖️', iconBg: '#dc2626' },
  { key: 'transfer',   label: 'Transfer',    icon: '🔁', iconBg: '#7c3aed' },
];

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

export default function TaskDashboard() {
  const navigate = useNavigate();
  const { isAdmin, isSuperAdmin, isBranchManager, isDeptHead } = useAuth();
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
  const tomorrow  = useMemo(() => addDaysISO(today, 1), [today]);

  const buckets = useMemo(() => ([
    { key: 'today',     title: "Today's My Task", dateISO: today },
    { key: 'yesterday', title: 'Yesterday My Task', dateISO: yesterday },
    { key: 'tomorrow',  title: 'Tomorrow My Task', dateISO: tomorrow },
  ].map(b => ({ ...b, stats: bucketStats(tasks, b.dateISO) }))), [tasks, today, yesterday, tomorrow]);

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
        buckets.map(b => (
          <div key={b.key} className="tdb-section">
            <h2 className="tdb-section-title">
              {b.title} <span className="tdb-section-date">({b.dateISO})</span>
            </h2>
            <div className="tdb-grid6">
              {STAT_DEFS.map(def => (
                <StatTile key={def.key} label={def.label} value={b.stats[def.key]} icon={def.icon} iconBg={def.iconBg} />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
