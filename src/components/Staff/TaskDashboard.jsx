import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import useDateFormat from '../../hooks/useDateFormat.js';
import { getNepalTodayISO, addDaysISO } from '../../utils/dateUtils.js';
import { useNotifications } from '../Notifications/AttendanceToasts.jsx';
import DataGrid from '../DataGrid/DataGrid.jsx';

/* Task module landing page — now the direct target of the top-nav "Task"
   item (Task is a plain link, no dropdown, same convention as Payroll — see
   TopMenu.jsx). Reuses the exact same GET /api/tasks(?staffId=all) scoping
   TaskList.jsx already uses for its "Filter by Staff" default (admin/
   superAdmin -> company-wide, branchManager/departmentHead -> their branch/
   department, plain employee -> own tasks only, server-scoped) — no new
   endpoint.

   Header (right side) carries the Task List / Field Visit quick links plus
   a Settings dropdown (Task Category / Task Priority) — the same small
   dropdown interaction as PayrollDashboard.jsx's Settings menu, replacing
   the standalone "Task Setting" nav entry the old Task dropdown used to
   have (TaskSettings.jsx's cards page still exists but nothing links to it
   from the nav anymore).

   Layout: four summary cards only — Today's, Yesterday's, This Week's (Sun-Sat)
   and Upcoming Week's tasks — each with Total / Processing / Pending / Completed /
   Cancels / Transfer. The old per-category task lists were removed: one grid per
   category made the page slow to open. */

const STYLES = `
  .tdb-grid6 { display:grid; grid-template-columns:repeat(6, 1fr); gap:8px; }
  .tdb-card { background:#fff; border:1px solid #e2e8f0; border-radius:10px; padding:8px 10px; box-shadow:0 1px 4px rgba(0,0,0,.04); min-width:0; }
  .tdb-summary-cols { display:grid; grid-template-columns:1fr 1fr; gap:18px; margin-bottom:22px; }
  .tdb-section { background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:16px 18px; }
  .tdb-section-title { font-size:14px; font-weight:800; color:#1e293b; margin:0 0 12px 0; display:flex; align-items:center; gap:8px; }
  .tdb-section-date { font-size:11.5px; font-weight:600; color:#94a3b8; }
  @media(max-width:720px){ .tdb-summary-cols{ grid-template-columns:1fr; } }
  @media(max-width:720px){ .tdb-grid6{ grid-template-columns:repeat(3,1fr); } }
  @media(max-width:480px){ .tdb-grid6{ grid-template-columns:repeat(2,1fr); } }
`;

// Each category has its own light tint (bg + border) and a status filter used when its tile is clicked.
const STAT_DEFS = [
  { key: 'total',      label: 'Total',      icon: '📋', bg: '#f1f5f9', border: '#cbd5e1', test: () => true },
  { key: 'processing', label: 'Processing', icon: '⚙️', bg: '#eff6ff', border: '#bfdbfe', test: t => t.status === 'in_progress' },
  { key: 'pending',    label: 'Pending',    icon: '⏳', bg: '#fffbeb', border: '#fde68a', test: t => t.status === 'pending' },
  { key: 'complete',   label: 'Completed',  icon: '✅', bg: '#f0fdf4', border: '#bbf7d0', test: t => t.status === 'completed' },
  { key: 'cancel',     label: 'Cancels',    icon: '✖️', bg: '#fef2f2', border: '#fecaca', test: t => t.status === 'cancelled' },
  { key: 'transfer',   label: 'Transfer',   icon: '🔁', bg: '#f5f3ff', border: '#ddd6fe', test: t => !!t.hasTransfer },
];

const STATUS_STYLE = {
  pending:     { color: '#b45309', label: 'Pending' },
  in_progress: { color: '#1d4ed8', label: 'Processing' },
  completed:   { color: '#15803d', label: 'Completed' },
  cancelled:   { color: '#dc2626', label: 'Cancelled' },
};

const StatTile = ({ label, value, icon, bg, border, onClick }) => {
  const clickable = value > 0;
  return (
    <div className="tdb-card" onClick={clickable ? onClick : undefined}
      title={clickable ? `Click to see these ${value} task${value === 1 ? '' : 's'}` : ''}
      style={{ background: bg, borderColor: border, cursor: clickable ? 'pointer' : 'default', transition: 'box-shadow .12s, transform .12s' }}
      onMouseEnter={e => { if (clickable) { e.currentTarget.style.boxShadow = '0 3px 10px rgba(15,23,42,.14)'; e.currentTarget.style.transform = 'translateY(-1px)'; } }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = ''; e.currentTarget.style.transform = ''; }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4, minWidth: 0 }}>
        <span style={{ fontSize: 12, flexShrink: 0 }}>{icon}</span>
        <span style={{ fontSize: 11, color: '#475569', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      </div>
      <span style={{ fontSize: 19, fontWeight: 800, color: '#1e293b', lineHeight: 1 }}>{value}</span>
    </div>
  );
};

const emptyStats = () => ({ total: 0, pending: 0, processing: 0, complete: 0, cancel: 0, transfer: 0 });

// Same "Today" rule TaskList.jsx's own taskDateBucket already applies to its
// Task Date column and category pill badges: a task due today counts, AND so
// does a still-open task whose due date has already passed — it doesn't
// silently disappear from "today's work" just because its original date
// slipped by, it stays "today's" until someone completes it. Without this,
// the dashboard's Today tally/category lists went empty the moment a tenant
// had nothing due on the literal calendar date, while the Task List page's
// own category pills (built on the same taskDateBucket rule) kept showing
// real counts for the exact same tasks — a confusing mismatch between the
// two pages for what's supposed to be the same "today" concept.
const isDueTodayOrOverdue = (t, todayISO) => {
  const due = t.dueDate ? String(t.dueDate).split('T')[0] : null;
  if (!due) return false;
  return due === todayISO || (due < todayISO && t.status !== 'completed');
};

const bucketStats = (tasks, matches) => {
  const s = emptyStats();
  tasks.forEach(t => {
    if (!matches(t)) return;
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
  const { taskCount, fieldVisitTaskCount } = useNotifications();
  const fd = useDateFormat();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (settingsRef.current && !settingsRef.current.contains(e.target)) setSettingsOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

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

  // Nepal's week runs Sunday -> Saturday. "This week" is the one containing today; "Upcoming week" is the next one.
  const weekStart = useMemo(() => addDaysISO(today, -new Date(`${today}T00:00:00`).getDay()), [today]);
  const weekEnd = useMemo(() => addDaysISO(weekStart, 6), [weekStart]);
  const nextStart = useMemo(() => addDaysISO(weekStart, 7), [weekStart]);
  const nextEnd = useMemo(() => addDaysISO(weekStart, 13), [weekStart]);

  // Summary only — no per-category lists (rendering one grid per category made this page slow to open).
  const buckets = useMemo(() => {
    const dueOf = (t) => (t.dueDate ? String(t.dueDate).split('T')[0] : null);
    const inRange = (t, a, b) => { const d = dueOf(t); return !!d && d >= a && d <= b; };
    // `match` picks the bucket's tasks — used for the counts AND for the list shown when a tile is clicked.
    const defs = [
      { key: 'today',     title: "Today's Task",         range: fd(today),
        match: t => isDueTodayOrOverdue(t, today) },
      { key: 'yesterday', title: "Yesterday's Task",     range: fd(yesterday),
        match: t => dueOf(t) === yesterday },
      { key: 'week',      title: "This Week's Task",     range: `${fd(weekStart)} → ${fd(weekEnd)}`,
        match: t => inRange(t, weekStart, weekEnd) },
      { key: 'next',      title: "Upcoming Week's Task", range: `${fd(nextStart)} → ${fd(nextEnd)}`,
        match: t => inRange(t, nextStart, nextEnd) },
      // Field Visit = tasks flagged "Field Visit" (the same ones the Field Visit page lists).
      // Today uses the same rule as Today's Task (due today, or still open and overdue);
      // Upcoming is everything due after today.
      { key: 'fvToday',   title: "🚗 Today's Field Visit",  range: fd(today),
        match: t => !!t.isFieldVisit && isDueTodayOrOverdue(t, today) },
      { key: 'fvNext',    title: '🚗 Upcoming Field Visit', range: `after ${fd(today)}`,
        match: t => { const d = dueOf(t); return !!t.isFieldVisit && !!d && d > today; } },
    ];
    return defs.map(b => ({ ...b, stats: bucketStats(tasks, b.match) }));
  }, [tasks, today, yesterday, weekStart, weekEnd, nextStart, nextEnd, fd]);

  // Clicking a tile opens that bucket's tasks (filtered by the tile's status) in a popup grid.
  const [drill, setDrill] = useState(null);   // { bucket, def }
  const drillRows = useMemo(
    () => drill ? tasks.filter(t => drill.bucket.match(t) && drill.def.test(t)) : [],
    [drill, tasks]);
  const openTask = (row) => navigate(`/staff/task?openTaskId=${row.id}&openEvent=view`);
  const drillColumns = useMemo(() => [
    { field: 'title', header: 'Task Name', minWidth: 200,
      render: (v, row) => (
        <span style={{ textDecoration: (row.status === 'completed' || row.status === 'cancelled') ? 'line-through' : 'none',
          color: row.status === 'completed' ? '#9ca3af' : row.status === 'cancelled' ? '#c2706f' : '#1f2937' }}>{v}</span>) },
    { field: 'customerName', header: 'Company Name', width: 170,
      render: v => v || <span style={{ color: '#d1d5db' }}>—</span> },
    { field: 'customerMobile', header: 'Mobile', width: 120,
      render: (v, row) => v || row.customerPhone || <span style={{ color: '#d1d5db' }}>—</span> },
    { field: 'dueDate', header: 'Due Date', width: 120,
      render: v => v ? fd(String(v).split('T')[0]) : <span style={{ color: '#d1d5db' }}>—</span> },
    { field: 'assignees', header: 'Assigned To', width: 170, sortable: false, filterable: false,
      render: v => Array.isArray(v) && v.length ? v.map(a => a.name).join(', ') : <span style={{ color: '#d1d5db' }}>—</span> },
    { field: 'status', header: 'Status', width: 100, align: 'center',
      render: v => { const s = STATUS_STYLE[v] || { color: '#6b7280', label: v || '—' }; return <span style={{ fontSize: 12.5, fontWeight: 600, color: s.color }}>{s.label}</span>; } },
  ], [fd]);

  return (
    <div style={{ padding: '8px 14px 12px' }}>
      <style>{STYLES}</style>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
        <h1 className="page-title">📊 Task Dashboard</h1>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => navigate('/staff/field-visit')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', height: 36,
              background: '#fff', border: '1px solid #d1d5db', color: '#374151', borderRadius: 8,
              fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            🚗 Field Visit
            {fieldVisitTaskCount > 0 && (
              <span style={{ background: '#dc2626', color: '#fff', borderRadius: 10, fontSize: 10, fontWeight: 700,
                padding: '1px 6px', minWidth: 18, textAlign: 'center' }}>
                {fieldVisitTaskCount}
              </span>
            )}
          </button>

          <button className="btn btn-primary" onClick={() => navigate('/staff/task')}>
            👁️ View Task
            {taskCount > 0 && (
              <span style={{ background: '#dc2626', color: '#fff', borderRadius: 10, fontSize: 10, fontWeight: 700,
                padding: '1px 6px', minWidth: 18, textAlign: 'center', marginLeft: 6 }}>
                {taskCount}
              </span>
            )}
          </button>

          <div ref={settingsRef} style={{ position: 'relative' }}>
            <button onClick={() => setSettingsOpen(p => !p)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', height: 36,
                background: '#fff', border: '1px solid #d1d5db', color: '#374151', borderRadius: 8,
                fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              ⚙️ Settings
            </button>
            {settingsOpen && (
              <div style={{ position: 'absolute', right: 0, top: 42, background: '#fff', border: '1px solid #e5e7eb',
                borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.12)', minWidth: 190, zIndex: 20, overflow: 'hidden' }}>
                <div onClick={() => { setSettingsOpen(false); navigate('/staff/task/categories'); }}
                  style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600, color: '#374151', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f3f4f6'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  Task Category
                </div>
                <div onClick={() => { setSettingsOpen(false); navigate('/staff/task/priorities'); }}
                  style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600, color: '#374151', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, borderTop: '1px solid #f1f5f9' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f3f4f6'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  Task Priority
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 48, textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>Loading...</div>
      ) : (
        <>
          <div className="tdb-summary-cols">
            {buckets.map(b => (
              <div key={b.key} className="tdb-section">
                <h2 className="tdb-section-title">
                  {b.title} <span className="tdb-section-date">({b.range})</span>
                </h2>
                <div className="tdb-grid6">
                  {STAT_DEFS.map(def => (
                    <StatTile key={def.key} label={def.label} value={b.stats[def.key]} icon={def.icon}
                      bg={def.bg} border={def.border} onClick={() => setDrill({ bucket: b, def })} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {drill && (
        <div onClick={() => setDrill(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 14, width: 'min(1080px, 100%)', maxHeight: '88vh', display: 'flex', flexDirection: 'column',
              boxShadow: '0 20px 60px rgba(0,0,0,.3)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', background: drill.def.bg, borderBottom: `1px solid ${drill.def.border}` }}>
              <span style={{ fontSize: 16 }}>{drill.def.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#1e293b' }}>{drill.bucket.title} — {drill.def.label}
                  <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 700, color: '#475569' }}>({drillRows.length})</span></div>
                <div style={{ fontSize: 11.5, color: '#64748b' }}>{drill.bucket.range} · click a row to open the task</div>
              </div>
              <button onClick={() => setDrill(null)} aria-label="Close"
                style={{ border: 'none', background: 'transparent', fontSize: 22, lineHeight: 1, cursor: 'pointer', color: '#64748b', padding: '0 6px' }}>×</button>
            </div>
            <div style={{ padding: 14, overflow: 'auto' }}>
              <DataGrid
                columns={drillColumns}
                data={drillRows}
                rowKey="id"
                defaultPageSize={15}
                pageSizeOptions={[15, 25, 50]}
                compact
                showCheckbox={false}
                showFilterButton={false}
                searchPlaceholder="Search..."
                onRowClick={openTask}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
