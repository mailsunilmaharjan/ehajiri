import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useAuth, DEFAULT_PAGE_PERMISSIONS, savePagePermissions } from '../../context/AuthContext.jsx';
import { useData } from '../../context/DataContext.jsx';
import useSaveShortcut from '../../hooks/useSaveShortcut.js';
import api from '../../api/client.js';

/* ─────────────────────────────────────────────────────────────────────────
   Role metadata
───────────────────────────────────────────────────────────────────────── */
const ROLE_META = {
  admin:          { label: 'System Admin',   color: '#7e3af2', bg: '#ede9fe', icon: '👑' },
  branchManager:  { label: 'Branch Manager', color: '#1a56db', bg: '#dbeafe', icon: '🏢' },
  departmentHead: { label: 'Dept. Head',     color: '#0e9f6e', bg: '#d1fae5', icon: '🏛️' },
  employee:       { label: 'Employee',       color: '#6b7280', bg: '#f3f4f6', icon: '👤' },
};

/* ─────────────────────────────────────────────────────────────────────────
   Permission Matrix — pages × roles
───────────────────────────────────────────────────────────────────────── */
const MATRIX_GROUPS = [
  {
    group: 'Main',
    pages: [
      { key: 'dashboard',   label: 'Dashboard',   icon: '🏠' },
    ],
  },
  {
    group: 'Staff',
    pages: [
      { key: 'staffDetail',       label: 'Staff Details',                  icon: '👥' },
      { key: 'recoApprovalConfig', label: 'Set Recommendator & Approval',  icon: '🧑‍🤝‍🧑' },
      { key: 'myNotes',      label: 'My Notes',      icon: '📝' },
      { key: 'task',         label: 'Task',          icon: '✅' },
      { key: 'staffContact', label: 'Contact',        icon: '📞', alwaysOn: true },
      { key: 'eventVisitorRegistration', label: 'Guest Registration', icon: '🎪' },
      { key: 'staffAnalytics', label: 'Analysis Staff Report', icon: '📈', adminOnly: true },
    ],
  },
  {
    group: 'Leave & Office Visit',
    pages: [
      { key: 'leave',               label: 'Leave & Office Visit List', icon: '📅' },
      { key: 'leaveApply',          label: 'Apply for Leave',           icon: '📝' },
      { key: 'officeVisitApply',    label: 'Apply for Office Visit',    icon: '🚗' },
      { key: 'manualPostingApply',  label: 'Inform Late In/Early Out',  icon: '⏱️' },
      { key: 'missingAttendanceApply', label: 'Request for Missing Attendance', icon: '❓' },
      { key: 'leaveApproval',       label: 'Leave Approval',            icon: '✅' },
      { key: 'officeVisitApproval', label: 'Office Visit Approval',     icon: '✅' },
      { key: 'leaveCalculation',    label: 'Leave Calculation',         icon: '🧮', noDelete: true },
      { key: 'leaveReports',        label: 'Leave Reports',             icon: '📊' },
      { key: 'officeVisitReports',  label: 'Office Visit Reports',      icon: '📊' },
    ],
  },
  {
    group: 'Attendance',
    pages: [
      { key: 'attendanceDaily',       label: 'Daily Attendance',     icon: '📋' },
      { key: 'attendanceLedger',      label: 'Attendance Ledger',    icon: '📒' },
      { key: 'attendanceHalfMonthly', label: 'Half Monthly Reports', icon: '🤖' },
      { key: 'attendanceMonthly',     label: 'Monthly Reports',      icon: '📅' },
      { key: 'attendanceYearly',      label: 'Yearly Reports',       icon: '📋' },
      { key: 'dutyRoster',            label: 'Duty Roster',          icon: '🗓️' },
      { key: 'overtime',                   label: 'Overtime',                       icon: '⏱️' },
      { key: 'onlineAttendance',            label: 'Online Attendance',              icon: '📶' },
      { key: 'manualPostings',              label: 'Manual Attendance (Admin)',      icon: '⏱️' },
      { key: 'missingAttendanceRequests',   label: 'Missing Attendance Request',     icon: '❓' },
    ],
  },
  {
    group: 'System (Admin Only)',
    pages: [
      { key: 'shift',    label: 'Shift Management', icon: '⏰', adminOnly: true },
      { key: 'settings', label: 'Settings',          icon: '⚙️', adminOnly: true },
      { key: 'attendanceDevice', label: 'Attendance Device',  icon: '📡', adminOnly: true },
      { key: 'standaloneDevice', label: 'StandAlone Device',  icon: '🖥️', adminOnly: true },
    ],
  },
];

const ALL_MATRIX_PAGES = MATRIX_GROUPS.flatMap(g => g.pages);

/* ─────────────────────────────────────────────────────────────────────────
   Staff Page Overrides — grouped by scope category
───────────────────────────────────────────────────────────────────────── */
const OVERRIDE_GROUPS = [
  {
    group: 'Company',
    color: '#7e3af2', bg: '#f5f3ff',
    desc: 'Company-wide access & management',
    pages: [
      { key: 'dashboard',   label: 'Dashboard',    icon: '🏠' },
      { key: 'staffDetail', label: 'Staff Details', icon: '👥' },
      { key: 'recoApprovalConfig', label: 'Set Recommendator & Approval', icon: '🧑‍🤝‍🧑' },
      { key: 'settings',    label: 'Settings',      icon: '⚙️' },
      { key: 'shift',       label: 'Shifts',        icon: '⏰' },
    ],
  },
  {
    group: 'Staff',
    color: '#7c3aed', bg: '#faf5ff',
    desc: 'Staff section pages',
    pages: [
      { key: 'myNotes',      label: 'My Notes', icon: '📝' },
      { key: 'task',         label: 'Task',     icon: '✅' },
      { key: 'staffContact', label: 'Contact',  icon: '📞', alwaysOn: true },
      { key: 'eventVisitorRegistration', label: 'Guest Registration', icon: '🎪' },
    ],
  },
  {
    group: 'Branches',
    color: '#1a56db', bg: '#eff6ff',
    desc: 'Branch-level access & approvals',
    pages: [
      { key: 'leave',               label: 'Leave & Office Visit', icon: '📅' },
      { key: 'leaveApply',          label: 'Apply for Leave',      icon: '📝' },
      { key: 'officeVisitApply',    label: 'Apply Office Visit',   icon: '🚗' },
      { key: 'manualPostingApply',  label: 'Inform Late/Early',    icon: '⏱️' },
      { key: 'missingAttendanceApply', label: 'Request for Missing Attendance', icon: '❓' },
      { key: 'leaveApproval',       label: 'Leave Approval',       icon: '✅' },
      { key: 'officeVisitApproval', label: 'OV Approval',          icon: '✅' },
      { key: 'leaveCalculation',    label: 'Leave Calculation',    icon: '🧮', noDelete: true },
      { key: 'overtime',                 label: 'Overtime',                  icon: '⏱️' },
      { key: 'onlineAttendance',          label: 'Online Attendance',         icon: '📶' },
      { key: 'manualPostings',            label: 'Manual Attendance (Admin)', icon: '⏱️' },
      { key: 'missingAttendanceRequests', label: 'Missing Attendance Request', icon: '❓' },
    ],
  },
  {
    group: 'Department',
    color: '#0e9f6e', bg: '#f0fdf4',
    desc: 'Department-level report access',
    pages: [
      { key: 'leaveReports',       label: 'Leave Reports',         icon: '📊' },
      { key: 'officeVisitReports', label: 'Office Visit Reports',  icon: '📊' },
    ],
  },
  {
    group: 'Reports',
    color: '#e3a008', bg: '#fffbeb',
    desc: 'Attendance report access',
    pages: [
      { key: 'attendanceDaily',       label: 'Daily Attendance',     icon: '📋' },
      { key: 'attendanceLedger',      label: 'Attendance Ledger',    icon: '📒' },
      { key: 'attendanceHalfMonthly', label: 'Half Monthly Reports', icon: '🤖' },
      { key: 'attendanceMonthly',     label: 'Monthly Reports',      icon: '📅' },
      { key: 'attendanceYearly',      label: 'Yearly Reports',       icon: '📋' },
      { key: 'dutyRoster',            label: 'Duty Roster',          icon: '🗓️' },
    ],
  },
];

const ROLES_FOR_MATRIX = [
  { key: 'employee',       label: 'Employee',       color: '#6b7280', bg: '#f3f4f6' },
  { key: 'departmentHead', label: 'Dept. Head',     color: '#0e9f6e', bg: '#d1fae5' },
  { key: 'branchManager',  label: 'Branch Manager', color: '#1a56db', bg: '#dbeafe' },
];

/* ─────────────────────────────────────────────────────────────────────────
   localStorage helpers
───────────────────────────────────────────────────────────────────────── */
const PERM_KEY = 'ehajiri_page_permissions';
const loadSaved = () => {
  try { return JSON.parse(localStorage.getItem(PERM_KEY) || 'null'); } catch { return null; }
};

/* ─────────────────────────────────────────────────────────────────────────
   PermCell  —  View | Edit | Delete checkboxes
───────────────────────────────────────────────────────────────────────── */
const PermCell = ({ perm, onChange, disabled, noDelete, disabledLabel = 'Admin only' }) => {
  if (disabled) {
    return (
      <div style={{ textAlign: 'center' }}>
        <span style={{ fontSize: 12, color: '#9ca3af' }}>{disabledLabel}</span>
      </div>
    );
  }

  const p = perm || { view: false, edit: false, delete: false };

  const toggle = (field) => {
    const next = { ...p };
    if (field === 'view') {
      next.view = !next.view;
      if (!next.view) { next.edit = false; next.delete = false; }
    } else {
      next[field] = !next[field];
      if (next[field]) next.view = true;
    }
    onChange(next);
  };

  const fields = noDelete
    ? [
        { key: 'view', label: 'View', color: '#1a56db' },
        { key: 'edit', label: 'Edit', color: '#059669' },
      ]
    : [
        { key: 'view',   label: 'View',   color: '#1a56db' },
        { key: 'edit',   label: 'Edit',   color: '#059669' },
        { key: 'delete', label: 'Delete', color: '#dc2626' },
      ];

  return (
    <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', alignItems: 'center' }}>
      {fields.map(({ key, label, color }) => (
        <label key={key}
          style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer', userSelect: 'none',
            opacity: (key !== 'view' && !p.view) ? 0.35 : 1 }}>
          <input type="checkbox"
            checked={!!p[key]}
            disabled={key !== 'view' && !p.view}
            onChange={() => toggle(key)}
            style={{ accentColor: color, width: 13, height: 13 }} />
          <span style={{ fontSize: 12.5, color: '#374151', fontWeight: 500 }}>{label}</span>
        </label>
      ))}
      {noDelete && (
        <span style={{ fontSize: 11, color: '#9ca3af', fontStyle: 'italic' }}>no delete</span>
      )}
    </div>
  );
};

/* ─────────────────────────────────────────────────────────────────────────
   Staff Override Section
───────────────────────────────────────────────────────────────────────── */
const StaffOverrideSection = ({ employees, saved, onSave }) => {
  const ROLE_COLORS = { admin: '#7e3af2', branchManager: '#1a56db', departmentHead: '#0e9f6e', employee: '#6b7280' };
  const ROLE_LABELS = { admin: 'Admin', branchManager: 'Branch Mgr', departmentHead: 'Dept. Head', employee: 'Employee' };

  const [selEmpId,  setSelEmpId]  = useState('');
  const [overrides, setOverrides] = useState({});
  const [search,    setSearch]    = useState('');
  const [toast,     setToast]     = useState('');

  const activeEmp = useMemo(() => (employees || []).filter(e => e.active !== false), [employees]);
  const filtered  = useMemo(() =>
    search ? activeEmp.filter(e => e.fullName?.toLowerCase().includes(search.toLowerCase())) : [],
  [activeEmp, search]);

  const selectEmp = (id) => {
    setSelEmpId(id);
    setOverrides(JSON.parse(JSON.stringify(saved?.staff?.[id] || {})));
  };

  const selEmp = activeEmp.find(e => String(e.id) === String(selEmpId));

  const setPerm   = (pageKey, perm) => setOverrides(p => ({ ...p, [pageKey]: perm }));
  const clearPerm = (pageKey) => setOverrides(p => { const n = { ...p }; delete n[pageKey]; return n; });

  const handleSave = () => {
    if (!selEmpId) return;
    const next = JSON.parse(JSON.stringify(saved || {}));
    if (!next.staff) next.staff = {};
    if (Object.keys(overrides).length === 0) delete next.staff[selEmpId];
    else next.staff[selEmpId] = overrides;
    savePagePermissions(next);
    onSave(next);
    setToast('Staff override saved!');
    setTimeout(() => setToast(''), 2500);
  };

  /* Ctrl+S saves — this section only exists while its tab is active */
  useSaveShortcut(true, handleSave);

  const handleClearAll = () => {
    setOverrides({});
    const next = JSON.parse(JSON.stringify(saved || {}));
    if (next.staff) delete next.staff[selEmpId];
    savePagePermissions(next);
    onSave(next);
    setToast('All overrides cleared — inherits role defaults');
    setTimeout(() => setToast(''), 2500);
  };

  return (
    <div>
      {toast && (
        <div style={{ marginBottom: 12, padding: '9px 16px', background: '#d1fae5',
          border: '1px solid #86efac', borderRadius: 8, fontSize: 13, color: '#065f46', fontWeight: 600 }}>
          ✅ {toast}
        </div>
      )}

      {/* Search & select staff */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 220, position: 'relative' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Select Staff Member</div>
          <input type="text" className="form-control" placeholder="Type name to search..."
            value={search}
            onChange={e => { setSearch(e.target.value); if (!filtered.find(f => f.fullName === e.target.value)) { setSelEmpId(''); setOverrides({}); } }}
            style={{ fontSize: 13 }} />
          {search && filtered.length > 0 && !selEmpId && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
              background: 'white', border: '1px solid #d1d5db', borderRadius: 6,
              boxShadow: '0 4px 12px rgba(0,0,0,.12)', maxHeight: 220, overflowY: 'auto', marginTop: 2 }}>
              {filtered.slice(0, 20).map(e => (
                <div key={e.id}
                  onClick={() => { selectEmp(String(e.id)); setSearch(e.fullName); }}
                  style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13,
                    borderBottom: '1px solid #f3f4f6', display: 'flex', alignItems: 'center', gap: 8 }}
                  onMouseEnter={el => el.currentTarget.style.background = '#eff6ff'}
                  onMouseLeave={el => el.currentTarget.style.background = 'white'}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                    background: (ROLE_COLORS[e.role] || '#6b7280') + '22',
                    color: ROLE_COLORS[e.role] || '#6b7280',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12 }}>
                    {e.avatar || e.fullName?.[0]}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600 }}>{e.fullName}</div>
                    <div style={{ fontSize: 11, color: '#9ca3af' }}>{ROLE_LABELS[e.role] || e.role} {e.department ? `· ${e.department}` : ''}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {selEmp && (
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 16px', fontSize: 13 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{selEmp.fullName}</div>
            <div style={{ color: '#6b7280', marginTop: 3, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <span>Role: <strong style={{ color: ROLE_COLORS[selEmp.role] || '#6b7280' }}>{ROLE_LABELS[selEmp.role] || selEmp.role}</strong></span>
              {selEmp.department && <span>Dept: {selEmp.department}</span>}
              {selEmp.branch     && <span>Branch: {selEmp.branch}</span>}
            </div>
          </div>
        )}
      </div>

      {selEmpId ? (
        <div>
          <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 14 }}>
            Overrides grant or restrict specific pages for <strong>{selEmp?.fullName}</strong> beyond their role defaults.
            Unset pages inherit from the <strong>{ROLE_LABELS[selEmp?.role] || selEmp?.role}</strong> role permissions.
          </p>

          {OVERRIDE_GROUPS.map(grp => (
            <div key={grp.group} style={{ marginBottom: 18 }}>
              {/* Group header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
                padding: '8px 14px', borderRadius: 8, background: grp.bg,
                border: `1px solid ${grp.color}33` }}>
                <span style={{ fontSize: 14, fontWeight: 800, color: grp.color }}>{grp.group}</span>
                <span style={{ fontSize: 12, color: '#6b7280' }}>— {grp.desc}</span>
              </div>
              <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ background: '#f8fafc' }}>
                      <th style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 700, fontSize: 12,
                        borderBottom: '1px solid #e2e8f0', width: 200 }}>Page</th>
                      <th style={{ padding: '8px 14px', textAlign: 'center', fontWeight: 700, fontSize: 12,
                        borderBottom: '1px solid #e2e8f0' }}>Permissions</th>
                      <th style={{ padding: '8px 14px', textAlign: 'center', fontWeight: 700, fontSize: 12,
                        borderBottom: '1px solid #e2e8f0', width: 90 }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grp.pages.map((page, pi) => {
                      const hasOverride = overrides[page.key] !== undefined;
                      const currPerm    = overrides[page.key] || { view: false, edit: false, delete: false };
                      return (
                        <tr key={page.key} style={{ background: hasOverride ? grp.bg : (pi % 2 === 0 ? 'white' : '#f3f4f6') }}>
                          <td style={{ padding: '9px 14px', fontWeight: hasOverride ? 700 : 400,
                            borderBottom: '1px solid #eef0f4' }}>
                            <span style={{ marginRight: 7 }}>{page.icon}</span>{page.label}
                            {hasOverride && (
                              <span style={{ marginLeft: 8, fontSize: 10, background: grp.color,
                                color: 'white', borderRadius: 8, padding: '1px 7px', fontWeight: 700 }}>
                                overridden
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '8px 14px', textAlign: 'center', borderBottom: '1px solid #eef0f4' }}>
                            {page.alwaysOn
                              ? <PermCell perm={{ view: true, edit: true, delete: false }} onChange={() => {}} disabled disabledLabel="Always on — every role" noDelete={!!page.noDelete} />
                              : hasOverride
                                ? <PermCell perm={currPerm} onChange={p => setPerm(page.key, p)} disabled={false} noDelete={!!page.noDelete} />
                                : <span style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic' }}>inherits role default</span>
                            }
                          </td>
                          <td style={{ padding: '8px 14px', textAlign: 'center', borderBottom: '1px solid #eef0f4' }}>
                            {page.alwaysOn ? null : hasOverride
                              ? <button onClick={() => clearPerm(page.key)}
                                  style={{ fontSize: 12, padding: '4px 10px', border: '1px solid #f87171',
                                    borderRadius: 6, background: 'white', color: '#dc2626', cursor: 'pointer' }}>
                                  Clear
                                </button>
                              : <button onClick={() => setPerm(page.key, { view: false, edit: false, delete: false })}
                                  style={{ fontSize: 12, padding: '4px 10px', border: '1px solid #d1d5db',
                                    borderRadius: 6, background: 'white', color: '#374151', cursor: 'pointer' }}>
                                  Override
                                </button>
                            }
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
            <button onClick={handleSave} title="Ctrl+S"
              style={{ padding: '9px 26px', border: 'none', borderRadius: 8, background: '#1a56db',
                color: 'white', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              💾 <u>S</u>ave Overrides
            </button>
            <button onClick={handleClearAll}
              style={{ padding: '9px 18px', border: '1.5px solid #f87171', borderRadius: 8,
                background: 'white', color: '#dc2626', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              🗑️ Clear All Overrides
            </button>
          </div>
        </div>
      ) : (
        <div style={{ padding: '36px 16px', textAlign: 'center', color: '#9ca3af', fontSize: 13,
          background: '#f9fafb', border: '1px dashed #d1d5db', borderRadius: 8 }}>
          Search and select a staff member above to configure their individual page permissions.
        </div>
      )}
    </div>
  );
};

/* ─────────────────────────────────────────────────────────────────────────
   Staff Role Assignment
───────────────────────────────────────────────────────────────────────── */
const StaffRoleAssignment = ({ employees, updateEmployee }) => {
  const [search,  setSearch]  = useState('');
  const [toast,   setToast]   = useState('');
  const [loading, setLoading] = useState(null);

  const active = useMemo(() =>
    (employees || [])
      .filter(e => e.active !== false)
      .filter(e => !search ||
        e.fullName?.toLowerCase().includes(search.toLowerCase()) ||
        e.department?.toLowerCase().includes(search.toLowerCase()) ||
        e.branch?.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => (a.fullName || '').localeCompare(b.fullName || '')),
  [employees, search]);

  const changeRole = async (emp, newRole) => {
    setLoading(emp.id);
    await updateEmployee(emp.id, { ...emp, role: newRole });
    setLoading(null);
    const m = ROLE_META[newRole];
    setToast(`${emp.fullName} → ${m?.label || newRole}`);
    setTimeout(() => setToast(''), 2500);
  };

  /* role count summary */
  const counts = useMemo(() => {
    const c = {};
    (employees || []).filter(e => e.active !== false).forEach(e => {
      c[e.role] = (c[e.role] || 0) + 1;
    });
    return c;
  }, [employees]);

  return (
    <div>
      {toast && (
        <div style={{ marginBottom: 12, padding: '9px 16px', background: '#d1fae5',
          border: '1px solid #86efac', borderRadius: 8, fontSize: 13, color: '#065f46', fontWeight: 600 }}>
          ✅ {toast}
        </div>
      )}

      {/* Role summary cards */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
        {Object.entries(ROLE_META).map(([key, m]) => (
          <div key={key} style={{ padding: '10px 20px', border: `2px solid ${m.color}33`,
            borderRadius: 10, background: m.bg, minWidth: 130, textAlign: 'center' }}>
            <div style={{ fontSize: 20 }}>{m.icon}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: m.color, marginTop: 4 }}>{m.label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: m.color }}>{counts[key] || 0}</div>
            <div style={{ fontSize: 11, color: '#9ca3af' }}>staff</div>
          </div>
        ))}
      </div>

      {/* Search */}
      <div style={{ marginBottom: 14 }}>
        <input type="text" className="form-control"
          placeholder="Search by name, department, branch..."
          value={search} onChange={e => setSearch(e.target.value)}
          style={{ maxWidth: 380, fontSize: 13 }} />
      </div>

      <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr style={{ background: '#f0f5fa' }}>
              {['Staff Name', 'Department', 'Branch', 'Current Role', 'Change Role'].map(h => (
                <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700,
                  borderBottom: '2px solid #dce6f0' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {active.map((emp, i) => {
              const meta = ROLE_META[emp.role] || ROLE_META.employee;
              return (
                <tr key={emp.id} style={{ background: i % 2 === 0 ? 'white' : '#f3f4f6' }}>
                  <td style={{ padding: '9px 14px', borderBottom: '1px solid #eef0f4', fontWeight: 600 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 30, height: 30, borderRadius: '50%', background: meta.bg,
                        color: meta.color, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                        {emp.avatar || emp.fullName?.[0] || '?'}
                      </div>
                      <div>
                        <div>{emp.fullName}</div>
                        {emp.employeeId && <div style={{ fontSize: 11, color: '#9ca3af' }}>{emp.employeeId}</div>}
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '9px 14px', borderBottom: '1px solid #eef0f4', color: '#374151' }}>
                    {emp.department || '—'}
                  </td>
                  <td style={{ padding: '9px 14px', borderBottom: '1px solid #eef0f4', color: '#374151' }}>
                    {emp.branch || '—'}
                  </td>
                  <td style={{ padding: '9px 14px', borderBottom: '1px solid #eef0f4' }}>
                    <span style={{ fontWeight: 700, padding: '3px 10px', borderRadius: 10,
                      background: meta.bg, color: meta.color, border: `1px solid ${meta.color}44` }}>
                      {meta.icon} {meta.label}
                    </span>
                  </td>
                  <td style={{ padding: '9px 14px', borderBottom: '1px solid #eef0f4' }}>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      {Object.entries(ROLE_META).filter(([k]) => k !== 'admin').map(([roleKey, rm]) => (
                        <button key={roleKey}
                          disabled={emp.role === roleKey || loading === emp.id}
                          onClick={() => changeRole(emp, roleKey)}
                          style={{
                            fontSize: 12, padding: '4px 10px', borderRadius: 6,
                            cursor: emp.role === roleKey ? 'default' : 'pointer',
                            border: `1.5px solid ${emp.role === roleKey ? rm.color : rm.color + '55'}`,
                            background: emp.role === roleKey ? rm.bg : 'white',
                            color: rm.color, fontWeight: emp.role === roleKey ? 700 : 500,
                            opacity: loading === emp.id ? 0.5 : 1,
                          }}>
                          {rm.icon} {rm.label}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
            {active.length === 0 && (
              <tr><td colSpan={5} style={{ padding: 28, textAlign: 'center', color: '#9ca3af' }}>
                No staff found
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 8 }}>
        {active.length} staff shown · Admin role assignment requires direct system access.
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN — RoleManagement
═══════════════════════════════════════════════════════════════════════════ */
const RoleManagement = () => {
  const { refreshPagePerms, isSuperAdmin } = useAuth();
  const { employees, updateEmployee } = useData();

  const [activeTab, setActiveTab] = useState('matrix');
  const [saved,     setSaved]     = useState(loadSaved);
  const [saveMsg,   setSaveMsg]   = useState('');

  /* ── Module Controls tab — global on/off flags (Email Setup / StandAlone
     Device), stored server-side in app_settings, NOT per-role like the
     matrix above. Email Setup is Super Admin only; StandAlone Device follows
     the same admin/superAdmin rule as its own in-page toggle (Settings →
     StandAlone Device), duplicated here so it can be turned on before that
     page is even reachable (its tab is hidden until this flag is enabled). */
  const [moduleFlags, setModuleFlags] = useState({ attendanceDeviceEnabled: false, standaloneDeviceEnabled: false, emailSetupEnabled: false, guestRegistrationEnabled: false, onlineAttendanceEnabled: false, dutyRosterEnabled: false, chatEnabled: false, taskEnabled: false, smsGatewayEnabled: false });
  const [moduleFlagsLoading, setModuleFlagsLoading] = useState(true);

  useEffect(() => {
    api.get('/module-flags')
      .then(f => setModuleFlags(f))
      .catch(() => {})
      .finally(() => setModuleFlagsLoading(false));
  }, []);

  const MODULE_FLAG_FIELD = {
    module_attendance_device_enabled:   'attendanceDeviceEnabled',
    module_standalone_device_enabled:   'standaloneDeviceEnabled',
    module_email_setup_enabled:         'emailSetupEnabled',
    module_guest_registration_enabled:  'guestRegistrationEnabled',
    module_online_attendance_enabled:   'onlineAttendanceEnabled',
    module_duty_roster_enabled:         'dutyRosterEnabled',
    module_chat_enabled:                'chatEnabled',
    module_task_enabled:                'taskEnabled',
    module_sms_gateway_enabled:         'smsGatewayEnabled',
  };

  const toggleModuleFlag = async (flagKey) => {
    const field = MODULE_FLAG_FIELD[flagKey];
    const next = !moduleFlags[field];
    try {
      await api.put('/settings', { [flagKey]: next });
      setModuleFlags(f => ({ ...f, [field]: next }));
    } catch (err) {
      alert(`Failed to update: ${err.message}`);
    }
  };

  /* Build editable role permissions: merge saved → defaults */
  const [rolePerms, setRolePerms] = useState(() => {
    const base = {};
    ROLES_FOR_MATRIX.forEach(r => {
      base[r.key] = {};
      ALL_MATRIX_PAGES.forEach(p => {
        const fromSaved = saved?.roles?.[r.key]?.[p.key];
        base[r.key][p.key] = fromSaved !== undefined
          ? fromSaved
          : (DEFAULT_PAGE_PERMISSIONS[r.key]?.[p.key] || { view: false, edit: false, delete: false });
      });
    });
    return base;
  });

  const setPerm = useCallback((role, pageKey, perm) => {
    setRolePerms(p => ({ ...p, [role]: { ...p[role], [pageKey]: perm } }));
  }, []);

  const resetRole = (roleKey) => {
    const defaults = {};
    ALL_MATRIX_PAGES.forEach(p => {
      defaults[p.key] = DEFAULT_PAGE_PERMISSIONS[roleKey]?.[p.key] || { view: false, edit: false, delete: false };
    });
    setRolePerms(prev => ({ ...prev, [roleKey]: defaults }));
  };

  const handleSaveMatrix = () => {
    const next = JSON.parse(JSON.stringify(saved || {}));
    next.roles = rolePerms;
    savePagePermissions(next);
    setSaved(next);
    refreshPagePerms();
    setSaveMsg('Role permissions saved!');
    setTimeout(() => setSaveMsg(''), 2500);
  };

  /* Ctrl+S saves the Permission Matrix — only while that tab is active */
  useSaveShortcut(activeTab === 'matrix', handleSaveMatrix);

  const handleStaffSave = (next) => {
    setSaved(next);
    refreshPagePerms();
    setSaveMsg('Staff override saved!');
    setTimeout(() => setSaveMsg(''), 2500);
  };

  const TABS = [
    { key: 'matrix',     label: '📋 Permission Matrix'     },
    { key: 'overrides',  label: '🔧 Staff Page Overrides'  },
    { key: 'assignment', label: '🔄 Staff Role Assignment' },
    // Module Controls is Super-Admin-only — a plain Admin shouldn't even see
    // the tab, not just find its toggles disabled once inside.
    isSuperAdmin && { key: 'modules', label: '🧩 Module Controls' },
  ].filter(Boolean);

  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ fontSize: 20 }}>🔐 Role & Permission Management</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8,
          background: '#ede9fe', border: '1px solid #c4b5fd', borderRadius: 8, padding: '6px 14px' }}>
          <span style={{ fontSize: 16 }}>👑</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#7e3af2' }}>System Admin Access Only</span>
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {[
          { dot: '#1a56db', label: 'View — can open & read the page' },
          { dot: '#059669', label: 'Edit — can add or modify records' },
          { dot: '#dc2626', label: 'Delete — can delete records' },
          { dot: '#7e3af2', label: 'Admin — always full access (fixed)' },
        ].map(({ dot, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#374151' }}>
            <div style={{ width: 10, height: 10, borderRadius: 3, background: dot, flexShrink: 0 }}></div>
            {label}
          </div>
        ))}
      </div>

      {/* Tab bar */}
      <div style={{ background: 'white', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md) var(--radius-md) 0 0', borderBottom: 'none' }}>
        <div className="tabs" style={{ padding: '0 20px', marginBottom: 0, borderBottom: '2px solid var(--border)' }}>
          {TABS.map(tab => (
            <button key={tab.key}
              className={`tab-btn ${activeTab === tab.key ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
              style={{ fontSize: 13 }}>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div style={{ background: 'white', border: '1px solid var(--border)', borderTop: 'none',
        borderRadius: '0 0 var(--radius-md) var(--radius-md)', padding: '20px', fontSize: 13 }}>

        {/* ── PERMISSION MATRIX TAB ── */}
        {activeTab === 'matrix' && (
          <div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ background: '#f0f5fa' }}>
                    <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700,
                      borderBottom: '2px solid #c8d6e5', minWidth: 200,
                      position: 'sticky', left: 0, background: '#f0f5fa', zIndex: 2 }}>
                      Page / Feature
                    </th>
                    {ROLES_FOR_MATRIX.map(r => (
                      <th key={r.key} style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 700,
                        borderBottom: '2px solid #c8d6e5', minWidth: 220,
                        background: r.bg, color: r.color, borderLeft: '1px solid #dce6f0' }}>
                        <div style={{ marginBottom: 6 }}>{r.label}</div>
                        <button onClick={() => resetRole(r.key)}
                          style={{ fontSize: 11, padding: '2px 10px', border: `1px solid ${r.color}55`,
                            borderRadius: 6, background: 'white', color: r.color, cursor: 'pointer', fontWeight: 600 }}>
                          Reset Defaults
                        </button>
                      </th>
                    ))}
                    {/* Admin column — always full */}
                    <th style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 700,
                      borderBottom: '2px solid #c8d6e5', minWidth: 160,
                      background: '#ede9fe', color: '#7e3af2', borderLeft: '1px solid #dce6f0' }}>
                      <div>👑 System Admin</div>
                      <div style={{ fontSize: 11, fontWeight: 400, marginTop: 4, color: '#9ca3af' }}>Full access (fixed)</div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {MATRIX_GROUPS.map(grp => (
                    <React.Fragment key={grp.group}>
                      <tr>
                        <td colSpan={ROLES_FOR_MATRIX.length + 2}
                          style={{ padding: '8px 14px', background: '#f8fafc', fontWeight: 700,
                            fontSize: 12, color: '#6b7280', textTransform: 'uppercase',
                            letterSpacing: '.5px', borderTop: '2px solid #e2e8f0',
                            borderBottom: '1px solid #e2e8f0' }}>
                          {grp.group}
                        </td>
                      </tr>
                      {grp.pages.map((page, pi) => (
                        <tr key={page.key} style={{ background: pi % 2 === 0 ? 'white' : '#f3f4f6' }}>
                          <td style={{ padding: '10px 14px', borderBottom: '1px solid #eef0f4',
                            fontWeight: 500,
                            position: 'sticky', left: 0, background: pi % 2 === 0 ? 'white' : '#f3f4f6', zIndex: 1 }}>
                            <span style={{ marginRight: 8 }}>{page.icon}</span>{page.label}
                          </td>
                          {ROLES_FOR_MATRIX.map(r => (
                            <td key={r.key} style={{ padding: '8px 12px', textAlign: 'center',
                              borderBottom: '1px solid #eef0f4', borderLeft: '1px solid #f3f4f6' }}>
                              <PermCell
                                perm={page.alwaysOn ? { view: true, edit: true, delete: false } : (rolePerms[r.key]?.[page.key] || { view: false, edit: false, delete: false })}
                                onChange={p => setPerm(r.key, page.key, p)}
                                disabled={!!page.adminOnly || !!page.alwaysOn}
                                disabledLabel={page.alwaysOn ? 'Always on — every role' : 'Admin only'}
                                noDelete={!!page.noDelete}
                              />
                            </td>
                          ))}
                          {/* Admin cell */}
                          <td style={{ padding: '8px 12px', textAlign: 'center',
                            borderBottom: '1px solid #eef0f4', borderLeft: '1px solid #f3f4f6',
                            background: '#faf5ff' }}>
                            <span style={{ color: '#7e3af2', fontWeight: 600 }}>
                              {page.noDelete ? '✓ View + Edit' : '✓ View + Edit + Delete'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 18 }}>
              <button onClick={handleSaveMatrix} title="Ctrl+S"
                style={{ padding: '10px 28px', border: 'none', borderRadius: 8, background: '#1a56db',
                  color: 'white', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  boxShadow: '0 2px 8px rgba(26,86,219,.3)' }}>
                💾 <u>S</u>ave Permission Matrix
              </button>
              {saveMsg && <span style={{ fontSize: 13, color: '#059669', fontWeight: 700 }}>✅ {saveMsg}</span>}
              <span style={{ fontSize: 12, color: '#9ca3af', marginLeft: 'auto' }}>
                Changes take effect immediately for all logged-in users.
              </span>
            </div>
          </div>
        )}

        {/* ── STAFF PAGE OVERRIDES TAB ── */}
        {activeTab === 'overrides' && (
          <div>
            {saveMsg && (
              <div style={{ marginBottom: 12, padding: '9px 14px', background: '#d1fae5',
                border: '1px solid #86efac', borderRadius: 8, fontSize: 13, color: '#065f46', fontWeight: 600 }}>
                ✅ {saveMsg}
              </div>
            )}
            <StaffOverrideSection employees={employees} saved={saved} onSave={handleStaffSave} />
          </div>
        )}

        {/* ── STAFF ROLE ASSIGNMENT TAB ── */}
        {activeTab === 'assignment' && (
          <StaffRoleAssignment employees={employees} updateEmployee={updateEmployee} />
        )}

        {/* ── MODULE CONTROLS TAB — global on/off flags, not per-role,
             Super-Admin-only (see TABS above) ── */}
        {activeTab === 'modules' && isSuperAdmin && (
          <div>
            <p style={{ fontSize: 13, color: '#6b7280', marginTop: 0, marginBottom: 18 }}>
              These are global switches, not per-role permissions — each one hides its
              feature from <strong>every</strong> role (including System Admin) until enabled here.
            </p>

            {moduleFlagsLoading ? (
              <div style={{ padding: 20, textAlign: 'center', color: '#9ca3af' }}>Loading…</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

                {/* Email Setup — Super Admin only */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                  background: moduleFlags.emailSetupEnabled ? '#f0fdf4' : '#fff7ed',
                  border: `1px solid ${moduleFlags.emailSetupEnabled ? '#bbf7d0' : '#fed7aa'}`,
                  borderRadius: 8, padding: '12px 16px',
                }}>
                  <div>
                    <div style={{ fontWeight: 700, color: '#111827', fontSize: 13 }}>📧 Email Setup</div>
                    <div style={{ fontSize: 12, color: moduleFlags.emailSetupEnabled ? '#065f46' : '#9a3412', marginTop: 2 }}>
                      {moduleFlags.emailSetupEnabled ? '✅ Enabled' : '⛔ Disabled — hidden from every role, including Super Admin'}
                    </div>
                  </div>
                  {isSuperAdmin ? (
                    <button className={`btn btn-sm ${moduleFlags.emailSetupEnabled ? 'btn-outline' : 'btn-primary'}`}
                      onClick={() => toggleModuleFlag('module_email_setup_enabled')}>
                      {moduleFlags.emailSetupEnabled ? 'Disable' : 'Enable'}
                    </button>
                  ) : (
                    <span style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic' }}>Super Admin only</span>
                  )}
                </div>

                {/* StandAlone Device — Super Admin only, same as every other
                    card here (Module Controls itself is Super-Admin-only). */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                  background: moduleFlags.standaloneDeviceEnabled ? '#f0fdf4' : '#fff7ed',
                  border: `1px solid ${moduleFlags.standaloneDeviceEnabled ? '#bbf7d0' : '#fed7aa'}`,
                  borderRadius: 8, padding: '12px 16px',
                }}>
                  <div>
                    <div style={{ fontWeight: 700, color: '#111827', fontSize: 13 }}>🖥️ StandAlone Device</div>
                    <div style={{ fontSize: 12, color: moduleFlags.standaloneDeviceEnabled ? '#065f46' : '#9a3412', marginTop: 2 }}>
                      {moduleFlags.standaloneDeviceEnabled ? '✅ Enabled' : '⛔ Disabled — hidden from every role, including Super Admin'}
                    </div>
                  </div>
                  {isSuperAdmin ? (
                    <button className={`btn btn-sm ${moduleFlags.standaloneDeviceEnabled ? 'btn-outline' : 'btn-primary'}`}
                      onClick={() => toggleModuleFlag('module_standalone_device_enabled')}>
                      {moduleFlags.standaloneDeviceEnabled ? 'Disable' : 'Enable'}
                    </button>
                  ) : (
                    <span style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic' }}>Super Admin only</span>
                  )}
                </div>

                {/* Guest Registration (Visitor Registration) — Super Admin only. */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                  background: moduleFlags.guestRegistrationEnabled ? '#f0fdf4' : '#fff7ed',
                  border: `1px solid ${moduleFlags.guestRegistrationEnabled ? '#bbf7d0' : '#fed7aa'}`,
                  borderRadius: 8, padding: '12px 16px',
                }}>
                  <div>
                    <div style={{ fontWeight: 700, color: '#111827', fontSize: 13 }}>🎪 Visitor Registration</div>
                    <div style={{ fontSize: 12, color: moduleFlags.guestRegistrationEnabled ? '#065f46' : '#9a3412', marginTop: 2 }}>
                      {moduleFlags.guestRegistrationEnabled ? '✅ Enabled' : '⛔ Disabled — hidden from every role, including Super Admin'}
                    </div>
                  </div>
                  {isSuperAdmin ? (
                    <button className={`btn btn-sm ${moduleFlags.guestRegistrationEnabled ? 'btn-outline' : 'btn-primary'}`}
                      onClick={() => toggleModuleFlag('module_guest_registration_enabled')}>
                      {moduleFlags.guestRegistrationEnabled ? 'Disable' : 'Enable'}
                    </button>
                  ) : (
                    <span style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic' }}>Super Admin only</span>
                  )}
                </div>

                {/* Online Attendance — Super Admin only. */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                  background: moduleFlags.onlineAttendanceEnabled ? '#f0fdf4' : '#fff7ed',
                  border: `1px solid ${moduleFlags.onlineAttendanceEnabled ? '#bbf7d0' : '#fed7aa'}`,
                  borderRadius: 8, padding: '12px 16px',
                }}>
                  <div>
                    <div style={{ fontWeight: 700, color: '#111827', fontSize: 13 }}>🌐 Online Attendance</div>
                    <div style={{ fontSize: 12, color: moduleFlags.onlineAttendanceEnabled ? '#065f46' : '#9a3412', marginTop: 2 }}>
                      {moduleFlags.onlineAttendanceEnabled ? '✅ Enabled' : '⛔ Disabled — hidden from every role, including Super Admin'}
                    </div>
                  </div>
                  {isSuperAdmin ? (
                    <button className={`btn btn-sm ${moduleFlags.onlineAttendanceEnabled ? 'btn-outline' : 'btn-primary'}`}
                      onClick={() => toggleModuleFlag('module_online_attendance_enabled')}>
                      {moduleFlags.onlineAttendanceEnabled ? 'Disable' : 'Enable'}
                    </button>
                  ) : (
                    <span style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic' }}>Super Admin only</span>
                  )}
                </div>

                {/* Duty Roster — Super Admin only, hidden by default; the
                    per-role permission matrix for dutyRoster still decides
                    who sees it once this is on. */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                  background: moduleFlags.dutyRosterEnabled ? '#f0fdf4' : '#fff7ed',
                  border: `1px solid ${moduleFlags.dutyRosterEnabled ? '#bbf7d0' : '#fed7aa'}`,
                  borderRadius: 8, padding: '12px 16px',
                }}>
                  <div>
                    <div style={{ fontWeight: 700, color: '#111827', fontSize: 13 }}>🗓️ Duty Roster</div>
                    <div style={{ fontSize: 12, color: moduleFlags.dutyRosterEnabled ? '#065f46' : '#9a3412', marginTop: 2 }}>
                      {moduleFlags.dutyRosterEnabled ? '✅ Enabled' : '⛔ Disabled — hidden from every role, including Super Admin'}
                    </div>
                  </div>
                  {isSuperAdmin ? (
                    <button className={`btn btn-sm ${moduleFlags.dutyRosterEnabled ? 'btn-outline' : 'btn-primary'}`}
                      onClick={() => toggleModuleFlag('module_duty_roster_enabled')}>
                      {moduleFlags.dutyRosterEnabled ? 'Disable' : 'Enable'}
                    </button>
                  ) : (
                    <span style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic' }}>Super Admin only</span>
                  )}
                </div>

                {/* Chat — Super Admin only. */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                  background: moduleFlags.chatEnabled ? '#f0fdf4' : '#fff7ed',
                  border: `1px solid ${moduleFlags.chatEnabled ? '#bbf7d0' : '#fed7aa'}`,
                  borderRadius: 8, padding: '12px 16px',
                }}>
                  <div>
                    <div style={{ fontWeight: 700, color: '#111827', fontSize: 13 }}>🗨️ Chat</div>
                    <div style={{ fontSize: 12, color: moduleFlags.chatEnabled ? '#065f46' : '#9a3412', marginTop: 2 }}>
                      {moduleFlags.chatEnabled ? '✅ Enabled' : '⛔ Disabled — hidden from every role, including Super Admin'}
                    </div>
                  </div>
                  {isSuperAdmin ? (
                    <button className={`btn btn-sm ${moduleFlags.chatEnabled ? 'btn-outline' : 'btn-primary'}`}
                      onClick={() => toggleModuleFlag('module_chat_enabled')}>
                      {moduleFlags.chatEnabled ? 'Disable' : 'Enable'}
                    </button>
                  ) : (
                    <span style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic' }}>Super Admin only</span>
                  )}
                </div>

                {/* Task — Super Admin only. */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                  background: moduleFlags.taskEnabled ? '#f0fdf4' : '#fff7ed',
                  border: `1px solid ${moduleFlags.taskEnabled ? '#bbf7d0' : '#fed7aa'}`,
                  borderRadius: 8, padding: '12px 16px',
                }}>
                  <div>
                    <div style={{ fontWeight: 700, color: '#111827', fontSize: 13 }}>✅ Task</div>
                    <div style={{ fontSize: 12, color: moduleFlags.taskEnabled ? '#065f46' : '#9a3412', marginTop: 2 }}>
                      {moduleFlags.taskEnabled ? '✅ Enabled' : '⛔ Disabled — hidden from every role, including Super Admin'}
                    </div>
                  </div>
                  {isSuperAdmin ? (
                    <button className={`btn btn-sm ${moduleFlags.taskEnabled ? 'btn-outline' : 'btn-primary'}`}
                      onClick={() => toggleModuleFlag('module_task_enabled')}>
                      {moduleFlags.taskEnabled ? 'Disable' : 'Enable'}
                    </button>
                  ) : (
                    <span style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic' }}>Super Admin only</span>
                  )}
                </div>

                {/* SMS Gateway — Super Admin only. */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                  background: moduleFlags.smsGatewayEnabled ? '#f0fdf4' : '#fff7ed',
                  border: `1px solid ${moduleFlags.smsGatewayEnabled ? '#bbf7d0' : '#fed7aa'}`,
                  borderRadius: 8, padding: '12px 16px',
                }}>
                  <div>
                    <div style={{ fontWeight: 700, color: '#111827', fontSize: 13 }}>📱 SMS Gateway</div>
                    <div style={{ fontSize: 12, color: moduleFlags.smsGatewayEnabled ? '#065f46' : '#9a3412', marginTop: 2 }}>
                      {moduleFlags.smsGatewayEnabled ? '✅ Enabled' : '⛔ Disabled — hidden from every role, including Super Admin'}
                    </div>
                  </div>
                  {isSuperAdmin ? (
                    <button className={`btn btn-sm ${moduleFlags.smsGatewayEnabled ? 'btn-outline' : 'btn-primary'}`}
                      onClick={() => toggleModuleFlag('module_sms_gateway_enabled')}>
                      {moduleFlags.smsGatewayEnabled ? 'Disable' : 'Enable'}
                    </button>
                  ) : (
                    <span style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic' }}>Super Admin only</span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default RoleManagement;
