import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useAuth }      from '../../context/AuthContext.jsx';
import { useLanguage }  from '../../context/LanguageContext.jsx';
import { useData }      from '../../context/DataContext.jsx';
import useSaveShortcut  from '../../hooks/useSaveShortcut.js';
import { useSettings }  from '../../context/SettingsContext.jsx';
import { useOfficeVisitApply } from '../../context/OfficeVisitApplyContext.jsx';
import { makeDateFormatter, getNepalTodayISO, formatNepalDateTime } from '../../utils/dateUtils.js';
import { staffRankCompare } from '../../utils/branchUtils.js';
import DataGrid from '../DataGrid/DataGrid.jsx';
import NepaliDatePicker from '../Common/NepaliDatePicker.jsx';
import EnglishDatePicker from '../Common/EnglishDatePicker.jsx';
import SearchableSelect from '../Common/SearchableSelect.jsx';
import Avatar from '../Common/Avatar.jsx';
import LastSavedBy from '../Common/LastSavedBy.jsx';
import { buildPrintDoc, openPrintWindow } from '../../utils/printHelper.js';
import { getDeviceInfo } from '../../utils/deviceInfo.js';
import useRecoApproval from '../../hooks/useRecoApproval.js';
import useLeaveOpening from '../../hooks/useLeaveOpening.js';
import LeaveApproval from './LeaveApproval.jsx';
import OfficeVisitApproval from '../OfficeVisit/OfficeVisitApproval.jsx';
import { LeaveAdvancedFilter, DEFAULT_ADV_FILTERS } from './LeaveCalculation.jsx';
import { countLeaveDays } from '../../utils/holidayScope.js';
import AlertPopup, { alertFromSaveError } from '../Common/AlertPopup.jsx';

/* date picker that respects settings.defaultCalendar and settings.leaveBackdateEnabled —
   allowPast overrides the block regardless of that setting, for Admin Manual Posting
   (correcting/backfilling records is the whole point of that form; see its own callers). */
const LeaveDateInput = ({ value, onChange, error, settings, allowPast, minDate }) => {
  const blockPast = !allowPast && settings.leaveBackdateEnabled === false;
  if (settings.defaultCalendar === 'np') {
    return <NepaliDatePicker value={value} onChange={onChange} error={error} maxToday={false} minToday={blockPast} minDate={minDate} />;
  }
  return <EnglishDatePicker value={value} onChange={onChange} error={error} maxToday={false} minToday={blockPast} minDate={minDate} />;
};

/* The one active staff configured as a Recommendator/Approver (a single id or
   an array, per recoConfig), or '' when there are none or several to choose from. */
const soleActiveId = (cfgIds, employees) => {
  const ids = [].concat(cfgIds || []).map(String)
    .filter(id => (employees || []).some(e => String(e.id) === id && e.active !== false));
  return ids.length === 1 ? ids[0] : '';
};

/* ─────────── shared badge — language-aware ─────────── */
const StatusBadge = ({ status }) => {
  const { language } = useLanguage();
  const np = language === 'np';
  const map = {
    pending:  { cls: 'badge-warning', np: 'विचाराधीन', en: 'Pending'  },
    approved: { cls: 'badge-success', np: 'स्वीकृत',   en: 'Approved' },
    rejected: { cls: 'badge-danger',  np: 'अस्वीकृत',  en: 'Rejected' },
  };
  const entry = map[status] || { cls: 'badge-gray', np: status, en: status };
  return <span className={`badge ${entry.cls}`}>{np ? entry.np : entry.en}</span>;
};

/* ─────────── shared right-side detail panel chrome (Leave + Office Visit) ───────────
   Same fixed-overlay-drawer convention as the Contact page's DetailPanel — the
   grid never shrinks or scrolls to make room for it. */
export const DRow = ({ icon, label, value }) => {
  if (!value) return null;
  return (
    <div style={{ display:'flex', gap:10, padding:'7px 0', borderBottom:'1px solid #f3f4f6' }}>
      <span style={{ fontSize:15, width:20, flexShrink:0, textAlign:'center' }}>{icon}</span>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:10, fontWeight:700, color:'#9ca3af', textTransform:'uppercase',
          letterSpacing:'.5px', marginBottom:1 }}>{label}</div>
        <div style={{ fontSize:13, color:'#1f2937', wordBreak:'break-word' }}>{value}</div>
      </div>
    </div>
  );
};

// From Date / To Date side by side, each in its own soft card.
export const DRowPair = ({ left, right }) => (
  <div style={{ display:'flex', gap:8, padding:'8px 0' }}>
    {[left, right].map((c, i) => c?.value && (
      <div key={i} style={{ flex:1, background:'#f8fafc', border:'1px solid #eef1f5', borderRadius:8, padding:'6px 10px' }}>
        <div style={{ fontSize:10, fontWeight:700, color:'#9ca3af', textTransform:'uppercase',
          letterSpacing:'.5px', marginBottom:2, display:'flex', alignItems:'center', gap:4 }}>
          {c.icon} {c.label}
        </div>
        <div style={{ fontSize:13, fontWeight:600, color:'#1f2937' }}>{c.value}</div>
      </div>
    ))}
  </div>
);

// Reason/Description/Comment — a fieldset-style card: the label sits directly
// on the border (like a <legend>) instead of floating above it as a separate
// heading, with a light background tint so the box still reads as a block.
export const DRowBox = ({ icon, label, value, bg = '#fefcf5', border = '#eee2b3', color = '#92400e' }) => {
  if (!value) return null;
  return (
    <fieldset style={{ margin:'12px 0 0', border:`1.5px solid ${border}`, borderRadius:10,
      background:bg, padding:'2px 12px 12px' }}>
      <legend style={{ padding:'0 6px', fontSize:11, fontWeight:700, color,
        textTransform:'uppercase', letterSpacing:'.5px' }}>
        {icon} {label}
      </legend>
      <div style={{ fontSize:13.5, color:'#1f2937', lineHeight:1.6, wordBreak:'break-word' }}>
        {value}
      </div>
    </fieldset>
  );
};

// Underlined section header — gives the panel visual structure (grouping
// dates/attendance info vs notes vs the approval trail) instead of one long
// undifferentiated list of rows. Short + light underline (not a full-width
// bar) so it reads as an accent, not a divider.
export const SectionLabel = ({ children, color = '#1a56db' }) => (
  <div style={{ fontSize:11, fontWeight:700, color, textTransform:'uppercase', letterSpacing:'.5px',
    marginBottom:6, paddingBottom:4, display:'inline-block', borderBottom:`1px solid ${color}66` }}>
    {children}
  </div>
);

// Staff ID / Post / Department / Branch under the name — a two-column block
// (Staff ID over Department on the left, Post over Branch on the right)
// split by a vertical divider, with a fixed label width in each column so
// "Staff ID:"/"Department:" and "Post:"/"Branch:" line up vertically instead
// of drifting with value length.
export const InfoLine = ({ items }) => {
  const left = [];
  const right = [];
  items.forEach((it, i) => { if (it.value) (i % 2 === 0 ? left : right).push(it); });
  if (!left.length && !right.length) return null;
  const col = (list, labelWidth) => (
    <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
      {list.map(it => (
        <div key={it.label} style={{ display:'flex', gap:6 }}>
          <strong style={{ color:'#4b5563', flex:`0 0 ${labelWidth}px` }}>{it.label}:</strong>
          <span>{it.value}</span>
        </div>
      ))}
    </div>
  );
  return (
    <div style={{ display:'flex', marginTop:6, fontSize:11.5, color:'#6b7280' }}>
      <div style={{ flex:1, paddingRight:14, borderRight: right.length ? '1px solid #d1d5db' : 'none' }}>
        {col(left, 76)}
      </div>
      {right.length > 0 && <div style={{ flex:1, paddingLeft:14 }}>{col(right, 50)}</div>}
    </div>
  );
};

export const SidePanelShell = ({ icon, title, avatarPhoto, avatarName, infoLine, subtitle, statusBadge, onClose, children, footer }) => (
  <div style={{
    position:'fixed', top:60, right:0, bottom:0, width:440, zIndex:51,
    background:'#fff', boxShadow:'-6px 0 24px rgba(0,0,0,.15)', borderLeft:'1px solid #dedede',
    display:'flex', flexDirection:'column', overflow:'hidden',
  }}>
    <div style={{ background:'linear-gradient(135deg,#eff6ff,#f5f3ff)', flexShrink:0, padding:'16px 16px 14px', borderBottom:'1px solid #e5e7eb', position:'relative' }}>
      <button onClick={onClose}
        style={{ position:'absolute', top:10, right:10, background:'rgba(0,0,0,.06)',
          border:'none', borderRadius:6, width:26, height:26, cursor:'pointer',
          fontSize:14, color:'#6b7280', display:'flex', alignItems:'center', justifyContent:'center' }}>
        ✕
      </button>
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        <Avatar photo={avatarPhoto} name={avatarName} size={44} />
        <div style={{ fontSize:15, fontWeight:700, color:'#111827', lineHeight:1.3 }}>
          {avatarName}
        </div>
      </div>
      {infoLine}
      {subtitle && <div style={{ fontSize:12, color:'#6b7280', marginTop:6 }}>{subtitle}</div>}
      <div style={{ display:'flex', gap:6, marginTop:8, flexWrap:'wrap' }}>{statusBadge}</div>
    </div>
    <div style={{ flex:1, overflowY:'auto', padding:'12px 16px' }}>{children}</div>
    <div style={{ padding:'10px 16px', borderTop:'1px solid #f3f4f6', display:'flex', gap:6, flexWrap:'wrap', flexShrink:0 }}>
      {footer}
    </div>
  </div>
);

export const panelBtnStyle = (variant) => ({
  padding:'7px 10px', borderRadius:8, fontSize:12, fontWeight:600, cursor:'pointer',
  display:'flex', alignItems:'center', justifyContent:'center', gap:5, flex:'1 1 auto',
  border: variant==='danger' ? '1px solid #fecaca' : variant==='success' ? '1px solid #059669' : '1px solid #d1d5db',
  background: variant==='danger' ? '#fff5f5' : variant==='success' ? '#059669' : '#fff',
  color: variant==='danger' ? '#dc2626' : variant==='success' ? '#fff' : '#374151',
});

const PURPOSES = [
  'ग्राहक बैठक', 'आधिकारिक बैठक', 'स्थल भ्रमण', 'तालिम',
  'सम्मेलन', 'कार्यशाला', 'क्षेत्र भ्रमण', 'बजार अनुसन्धान', 'अन्य',
];

/* ══════════════════════════════════════════════════
   LEAVE PANEL
══════════════════════════════════════════════════ */
const LeavePanel = () => {
  const { currentUser, isManager, canManageStaff, isAdmin } = useAuth();
  const { t, language } = useLanguage();
  const { settings, refreshSettings } = useSettings();
  const fd = makeDateFormatter(settings);
  // Server-refused Apply/Edit save (e.g. "Already Posted leave on that day.") → popup.
  const [saveAlert, setSaveAlert] = useState(null);
  const {
    filteredLeaves: leaves,
    // Raw, company-wide leaves — needed only for the "Pending for Approvals"
    // toggle below: filteredLeaves is scoped by org hierarchy (branch/
    // department/self), which has nothing to do with "Set Recommendator &
    // Approval" — a recommender/approver can legitimately be assigned to
    // someone outside their own branch/department, so that toggle must
    // search the unscoped list, not filteredLeaves.
    leaves: allLeaves,
    deleteLeave, addLeave, updateLeave, approveLeave, rejectLeave, recommendLeave, getEmployeeName, getEmployeeById, getLeaveTypeName, getLeaveTypeColor, leaveTypes, getLeaveBalance, refreshLeaveBalances, filteredEmployees: employees, employees: allEmployees,
  } = useData();

  const [filterStatus, setFilterStatus] = useState('all');
  const [showForApprovalLeave, setShowForApprovalLeave] = useState(false);
  const [selectedLeaveIds, setSelectedLeaveIds] = useState([]);
  const [filterTypes,  setFilterTypes]  = useState([]);
  const [filterAccum,  setFilterAccum]  = useState('all');
  const [advFilters,   setAdvFilters]   = useState({ ...DEFAULT_ADV_FILTERS });
  const [advTempF,     setAdvTempF]     = useState({ ...DEFAULT_ADV_FILTERS });
  const [advFilterOpen, setAdvFilterOpen] = useState(false);
  const setAdvTF = (key, val) => setAdvTempF(p => ({ ...p, [key]: val }));
  const openAdvFilter  = () => { setAdvTempF({ ...advFilters }); setAdvFilterOpen(true); };
  const applyAdvFilter = () => { setAdvFilters({ ...advTempF }); setAdvFilterOpen(false); };
  const resetAdvFilter = () => setAdvTempF({ ...DEFAULT_ADV_FILTERS });
  const advFilterCount = [advFilters.branches, advFilters.departments, advFilters.posts,
    advFilters.grades, advFilters.modes, advFilters.statuses, advFilters.staffIds, advFilters.leaveTypes]
    .filter(a => a.length > 0).length;
  // Ctrl+A opens Advance Search — same shortcut across every report/page
  // that has one, skipped while typing in a text field so it doesn't hijack
  // native "select all text" there.
  useEffect(() => {
    const onKey = (e) => {
      if (!e.ctrlKey || e.key.toLowerCase() !== 'a') return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
      e.preventDefault();
      setAdvTempF({ ...advFilters });
      setAdvFilterOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [advFilters]);
  const [viewLeave,    setViewLeave]    = useState(null);
  useEffect(() => {
    if (!viewLeave) return;
    const onKeyDown = (e) => { if (e.key === 'Escape') setViewLeave(null); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [viewLeave]);
  const [editLeave,    setEditLeave]    = useState(null); // leave being edited
  const [editForm,     setEditForm]     = useState({});
  const [editErrors,   setEditErrors]   = useState({});
  const editFormRef = useRef(null);
  /* Ctrl+S submits the Edit Leave form — same action as the Save Changes button */
  useSaveShortcut(!!editLeave, () => editFormRef.current?.requestSubmit());
  const manualFormRef = useRef(null);

  // Raw-field editing — reachable via the "✏️ Edit" action inside the
  // right-side detail panel (canManageStaff only) or a still-untouched
  // owner editing their own pending application. Clicking a grid row opens
  // that panel (see SidePanelShell usage below), with Edit as one of its
  // actions.
  const openEditFormLeave = (row) => {
    const isOwnPending = String(row.employeeId) === String(currentUser.id)
      && row.status === 'pending' && !row.recommendedBy;
    if (!canManageStaff && !isOwnPending) return;
    const toDateStr = (v) => v ? String(v).split('T')[0] : '';
    setEditForm({
      employeeId:      String(row.employeeId),
      leaveTypeCode:   row.leaveTypeCode || '',
      fromDate:        toDateStr(row.fromDate),
      toDate:          toDateStr(row.toDate),
      halfDay:         !!row.halfDay,
      reason:          row.reason        || '',
      status:          row.status        || 'pending',
      recommendedBy:   String(row.recommendedBy  || ''),
      recommendedDate: toDateStr(row.recommendedDate),
      approvedBy:      String(row.approvedBy     || ''),
      approvedDate:    toDateStr(row.approvedDate) || getNepalTodayISO(), // default: today
    });
    setEditErrors({});
    setEditLeave(row);
  };
  const [delConfirm,   setDelConfirm]   = useState(null);
  const [showApply,    setShowApply]    = useState(false);
  // Full-width popup for the Leave Approval page — opened instead of
  // navigating away, for managers with no personal reco/approval assignment
  // (a configured recommender/approver gets the inline toggle below instead).
  const [showLeaveApprovalModal, setShowLeaveApprovalModal] = useState(false);
  const { getRecoIds: getLeaveRecoIds, getApprovalIds: getLeaveApprovalIds, assignments: leaveRecoAssignments, refresh: refreshRecoApproval } = useRecoApproval();
  const { opening: leaveOpening, refresh: refreshLeaveOpening } = useLeaveOpening();
  // Refetch settings right as Apply opens — this page stays mounted for the
  // whole session, so a long-open tab would otherwise keep enforcing
  // whatever leaveBackdateEnabled was when it first loaded. Same reasoning
  // for the reco/approval assignments (useRecoApproval fetches once on this
  // page's initial mount, and this page never unmounts afterward) and the
  // leave opening figures (an admin could save new ones in Leave Calculation
  // while this tab is still open).
  useEffect(() => { if (showApply) { refreshSettings(); refreshRecoApproval(); refreshLeaveOpening(); } }, [showApply]); // eslint-disable-line react-hooks/exhaustive-deps
  // Same reasoning, for the Edit Leave modal (double-click a row) — without
  // this, editing an existing application could show "No recommendator/
  // approver configured" for a staff member whose config was actually set
  // (or changed) any time after this page was first loaded.
  useEffect(() => { if (editLeave) refreshRecoApproval(); }, [editLeave]); // eslint-disable-line react-hooks/exhaustive-deps
  // Same reasoning — leaveBalances is normally fetched once at login, so a
  // credit granted elsewhere (e.g. an OT-to-leave grant on the Overtime
  // Approval page) wouldn't show up in "days remaining" here without this.
  useEffect(() => { if (showApply) refreshLeaveBalances(); }, [showApply]); // eslint-disable-line react-hooks/exhaustive-deps
  const [showManual,   setShowManual]   = useState(false);
  const [manualForm,   setManualForm]   = useState({ employeeId:'', leaveTypeCode:'', fromDate:'', toDate:'', halfDay:false, reason:'', status:'approved', recommendedBy:'', recommendedDate:'', approvedBy:'', approvedDate:'' });
  const [manualErrors, setManualErrors] = useState({});
  const [manualToast,  setManualToast]  = useState(null);
  // Bumped after each Ctrl+S save to force the Staff picker to remount (and
  // re-run its autoOpen) so back-to-back manual postings can be typed
  // straight in without touching the mouse — see handleManualSubmit below.
  const [manualResetKey, setManualResetKey] = useState(0);
  // Confirmation of the most recent save — the form itself clears right
  // after saving (see handleManualSubmit), so this is tracked separately
  // rather than read off manualForm, and persists until the next save.
  const [manualLastSaved, setManualLastSaved] = useState(null);
  // Duplicate / already-posted popup for Manual Leave Posting — { title, msg, detail }
  const [manualAlert, setManualAlert] = useState(null);
  /* Ctrl+S submits the Manual Entry form — same action as the Save button */
  useSaveShortcut(showManual, () => manualFormRef.current?.requestSubmit());
  useEffect(() => { if (showManual) refreshRecoApproval(); }, [showManual]); // eslint-disable-line react-hooks/exhaustive-deps
  /* ── Inline approve/reject modal ── */
  const [actionModal, setActionModal]   = useState(null); // { id, type:'approve'|'reject', leave }
  const [comment,     setComment]       = useState('');
  const [actionToast, setActionToast]   = useState(null);

  /* ── Reco/approval config for inline approval logic ── */
  const recoConfig = leaveRecoAssignments;
  // Manual Posting: when the chosen staff has exactly one Recommendator /
  // Approver configured, pre-select it (re-runs once recoConfig refreshes).
  useEffect(() => {
    if (!showManual || !manualForm.employeeId) return;
    const cfg = recoConfig[String(manualForm.employeeId)] || {};
    setManualForm(p => ({
      ...p,
      recommendedBy: p.recommendedBy || soleActiveId(cfg.reco, allEmployees),
      approvedBy:    p.approvedBy    || soleActiveId(cfg.approval, allEmployees),
    }));
  }, [showManual, manualForm.employeeId, recoConfig]); // eslint-disable-line react-hooks/exhaustive-deps
  const isRecoCompulsoryLeave = settings.recoApprovalCompulsory || false;
  const isApproverForLeave    = (empId) => {
    const a = recoConfig[String(empId)]?.approval;
    const ids = Array.isArray(a) ? a : (a ? [a] : []);
    return ids.map(String).includes(String(currentUser.id));
  };
  const isRecommenderForLeave = (empId) => {
    const r = recoConfig[String(empId)]?.reco;
    const ids = Array.isArray(r) ? r : (r ? [r] : []);
    return ids.map(String).includes(String(currentUser.id));
  };
  // Whether this employee has ANY recommender configured — if not,
  // Recommendation Compulsory is unsatisfiable for them and must not block
  // their approver. Mirrors authorizeRecoAction's server-side check.
  const hasRecommenderForLeave = (empId) => {
    const r = recoConfig[String(empId)]?.reco;
    const ids = Array.isArray(r) ? r : (r ? [r] : []);
    return ids.length > 0;
  };
  // Shared permission computation for one row — used by both the row-level
  // action buttons and the view/action popup, so the two never disagree.
  const getLeaveRowPerms = (row) => {
    const amApprover     = isApproverForLeave(row.employeeId);
    const amRecommender  = isRecommenderForLeave(row.employeeId);
    const recoConfigured = hasRecommenderForLeave(row.employeeId);
    // Separation of duties: while Recommendation Compulsory is on AND a
    // recommender is actually configured, the configured recommender can
    // never also approve — even if they're also configured as the approver.
    // Mirrored server-side in authorizeRecoAction. With no recommender
    // configured at all, compulsory can't apply — nobody exists who could
    // ever satisfy it.
    const dualRoleBlocked = isRecoCompulsoryLeave && recoConfigured && amRecommender;
    // Server (authorizeRecoAction) never lets a non-admin act on their own application.
    const isOwnRow = !isAdmin && String(row.employeeId) === String(currentUser.id);
    const canApprove = amApprover && !isOwnRow && !dualRoleBlocked && (!isRecoCompulsoryLeave || !!row.recommendedBy || !recoConfigured);
    return { amApprover, amRecommender, canApprove, dualRoleBlocked, alreadyReco: !!row.recommendedBy };
  };
  // Shared with the grid's actions column, right-click menu, and the
  // toolbar Edit button — same rule openEditFormLeave itself enforces
  // (canManageStaff, or the applicant editing their own still-untouched
  // pending application), and the same Delete rule the view popup uses.
  const canEditLeaveRow = (row) => {
    const isOwnPending = String(row.employeeId) === String(currentUser.id)
      && row.status === 'pending' && !row.recommendedBy;
    return canManageStaff || isOwnPending;
  };
  const canDeleteLeaveRow = (row) => {
    const isOwnPendingUntouched = String(row.employeeId) === String(currentUser.id)
      && row.status === 'pending' && !row.recommendedBy;
    return isManager || isOwnPendingUntouched;
  };
  // Names of the employee's CONFIGURED recommender(s)/approver(s) (Staff
  // Detail → "Set Recommendator & Approval") for the grid's own columns —
  // distinct from recommendedBy/approvedBy, which is who actually acted on
  // this specific application (blank until someone has).
  const recoApprovalNamesForLeave = (empId, type) => {
    const v = recoConfig[String(empId)]?.[type];
    const ids = Array.isArray(v) ? v : (v ? [v] : []);
    return ids.length ? ids.map(id => getEmployeeName(id)).join(', ') : '—';
  };

  // Avatar + name for exactly one person — the grid's Recommendator/Approval
  // columns show only whoever this one application actually names, not
  // every configured candidate (see the column definitions' own comment).
  const personCellForLeave = (id) => id ? (
    <span style={{ display:'flex', alignItems:'center', gap:6 }}>
      <Avatar photo={getEmployeeById(id)?.profilePhoto} name={getEmployeeName(id)} size={20} />
      <span style={{ fontSize:12, color:'#374151' }}>{getEmployeeName(id)}</span>
    </span>
  ) : <span style={{ color:'#d1d5db', fontSize:12 }}>—</span>;

  // Whether the current user is configured as recommender/approver for
  // ANYONE at all — gates the "Pending for Approvals" link to Leave
  // Approval below, alongside isManager. Without this, someone individually
  // set up as a colleague's approver (but not holding the branchManager/
  // admin role) never got any way to reach their pending approvals from
  // this page — Leave Management only ever showed their own applications.
  const hasAnyRecoAssignmentLeave = Object.entries(recoConfig).some(([key, cfg]) => {
    if (key === '_settings') return false;
    const reco     = Array.isArray(cfg?.reco)     ? cfg.reco     : (cfg?.reco     != null ? [cfg.reco]     : []);
    const approval = Array.isArray(cfg?.approval) ? cfg.approval : (cfg?.approval != null ? [cfg.approval] : []);
    return reco.map(String).includes(String(currentUser.id)) || approval.map(String).includes(String(currentUser.id));
  });
  const pendingForApprovalCountLeave = leaves.filter(l =>
    l.status === 'pending' && String(l.employeeId) !== String(currentUser.id) &&
    (isRecommenderForLeave(l.employeeId) || isApproverForLeave(l.employeeId))
  ).length;

  /* ── Apply form state ── */
  const today = getNepalTodayISO();
  const emptyForm = {
    leaveTypeCode: '', fromDate: today, toDate: today,
    halfDay: false, reason: '', reco: [], approval: [], document: null,
  };
  const [applyForm,         setApplyForm]        = useState(emptyForm);
  const [applyErrors,       setApplyErrors]      = useState({});
  const [applySuccess,      setApplySuccess]     = useState(false);
  const [submitting,        setSubmitting]       = useState(false);
  const [selectedReco,      setSelectedReco]     = useState('');
  const [selectedApproval,  setSelectedApproval] = useState('');

  /* leave type config from settings */
  const ltConfigs = useMemo(() => settings.leaveTypeConfigs || [], [settings.leaveTypeConfigs]);

  /* Advance Search dropdown option lists — same shape/source as the
     Advanced Filter in Leave Calculation, so results agree across pages. */
  const advBranchOpts = useMemo(() => (settings.branches||[]).map(b => ({ value:b.name, label:b.name })), [settings.branches]);
  const advDeptOpts   = useMemo(() => (settings.departments||[]).map(d => ({ value:d.name, label:d.name })), [settings.departments]);
  const advPostOpts   = useMemo(() => (settings.posts||[]).map(p => ({ value:p.name, label:p.name })), [settings.posts]);
  const advGradeOpts  = useMemo(() => (settings.grades||[]).map(g => ({ value:g.name, label:g.name })), [settings.grades]);
  const advModeOpts   = useMemo(() => (settings.modes||[]).map(m => ({ value:m.name, label:m.name })), [settings.modes]);
  const advStatusOpts = useMemo(() => (settings.employeeStatuses||[]).map(s => ({ value:s.name, label:s.name })), [settings.employeeStatuses]);
  const advStaffOpts  = useMemo(() => (allEmployees||[]).filter(e=>e.active).map(e => ({
    value: String(e.id),
    label: e.fullName,
    sub: [e.employeeId, e.position].filter(Boolean).join(' - '),
    photo: e.profilePhoto,
  })), [allEmployees]);
  const advLeaveTypeOpts = useMemo(() => ltConfigs.map(lt => ({ value:lt.shortName, label:`${lt.name} (${lt.shortName})` })), [ltConfigs]);

  /* ── Balance from Leave Calculation's saved opening figures, for current FY ── */
  const balance = useMemo(() => {
    try {
      const defaultFY = (settings.fiscalYears || []).find(f => f.isDefault) || (settings.fiscalYears || [])[0];
      if (!defaultFY) return getLeaveBalance(currentUser.id);

      const fyId    = String(defaultFY.id);
      const prevKey = 'prev_' + fyId;
      const empId   = String(currentUser.id);

      const result = {};
      ltConfigs.forEach(lt => {
        const prevYear = Number(leaveOpening[prevKey]?.[empId]?.[lt.shortName] ?? 0);
        const currYear = Number(leaveOpening[fyId]?.[empId]?.[lt.shortName]    ?? 0);
        const used     = (leaves || [])
          .filter(l => String(l.employeeId) === empId
                    && l.leaveTypeCode === lt.shortName
                    && l.status === 'approved')
          .reduce((s, l) => s + Number(l.days || 0), 0);
        // Server-side credits (e.g. OT-to-leave grants from the Overtime
        // Approval page) live in leave_balances, not the opening/used math
        // above — add them in so a granted day actually shows up here.
        const credited = Number(getLeaveBalance(empId)?.[lt.shortName] || 0);
        result[lt.shortName] = Math.max(0, prevYear + currYear + credited - used);
      });
      return result;
    } catch {
      return getLeaveBalance(currentUser.id);
    }
  }, [settings.fiscalYears, currentUser.id, ltConfigs, leaves, getLeaveBalance, leaveOpening]);
  const selectedLtConfig = useMemo(() =>
    ltConfigs.find(lt => lt.shortName === applyForm.leaveTypeCode),
  [ltConfigs, applyForm.leaveTypeCode]);

  /* reco/approval — live from the API (useRecoApproval above) */
  const getMyRecoApproval = useCallback(() => ({
    reco:     getLeaveRecoIds(currentUser.id),
    approval: getLeaveApprovalIds(currentUser.id),
  }), [currentUser.id, getLeaveRecoIds, getLeaveApprovalIds]);

  /* use all employees so reco/approval from any branch/dept can be resolved */
  const getEmpName = useCallback((id) =>
    (allEmployees || []).find(e => String(e.id) === String(id))?.fullName || `#${id}`,
  [allEmployees]);

  /* smart day calculator */
  const calcDays = useCallback(() => {
    if (applyForm.halfDay) return 0.5;
    // Self-service: employeeId is always currentUser.id (see addLeave below).
    return countLeaveDays(settings, selectedLtConfig, applyForm.fromDate, applyForm.toDate, currentUser);
  }, [applyForm.fromDate, applyForm.toDate, applyForm.halfDay, selectedLtConfig, settings, currentUser]);

  /* service period check — how many times this leave has been taken */
  const timesAlreadyTaken = useMemo(() => {
    if (!applyForm.leaveTypeCode || !selectedLtConfig?.isServicePeriod) return 0;
    return (leaves || []).filter(l =>
      String(l.employeeId) === String(currentUser.id) &&
      l.leaveTypeCode === applyForm.leaveTypeCode &&
      l.status === 'approved'
    ).length;
  }, [leaves, currentUser.id, applyForm.leaveTypeCode, selectedLtConfig]);

  const validateApply = () => {
    const e = {};
    const days = calcDays();
    if (!applyForm.leaveTypeCode) e.leaveTypeCode = t('Required field');
    if (!applyForm.halfDay) {
      if (!applyForm.fromDate) e.fromDate = t('Required field');
      if (!applyForm.toDate)   e.toDate   = t('Required field');
      if (applyForm.fromDate && applyForm.toDate && applyForm.toDate < applyForm.fromDate)
        e.toDate = 'To Date must be after From Date';
    }
    if (!applyForm.reason.trim()) e.reason = t('Required field');
    if (applyForm.reason.trim().length < 5) e.reason = 'Minimum 5 characters required';
    // More than one configured Recommendator/Approver means the applicant
    // must actually pick one — previously this was only visually marked
    // required (the red asterisk) but never enforced, so submitting with
    // nothing picked silently sent every configured id and the server just
    // took the first one (see visits.js/leaves.js POST's reco[0]/approval[0]
    // fallback), which is never what the applicant actually chose.
    if (applyForm.reco.length > 1 && !selectedReco) e.selectedReco = t('Required field');
    if (applyForm.approval.length > 1 && !selectedApproval) e.selectedApproval = t('Required field');
    // Approval Authority is compulsory — an application with nobody to approve
    // it just sits Pending forever (and shows a blank Approval column).
    if (applyForm.approval.length === 0) e.selectedApproval = 'No Approval Authority is set for you — ask Admin to set it (Staff Detail → Set Recommendator & Approval).';
    if (applyForm.leaveTypeCode && days > 0) {
      /* Provide only on balance */
      if (selectedLtConfig?.provideOnlyOnBalance) {
        const avail = balance[applyForm.leaveTypeCode] || 0;
        if (days > avail) e.days = `Insufficient balance (available: ${avail} days)`;
      }
      /* Service period limit */
      if (selectedLtConfig?.isServicePeriod && selectedLtConfig?.timesPerService) {
        if (timesAlreadyTaken >= selectedLtConfig.timesPerService)
          e.days = `This leave can only be taken ${selectedLtConfig.timesPerService} time(s). Already used: ${timesAlreadyTaken}`;
      }
    }
    return e;
  };

  const handleApplyChange = (field, val) => {
    setApplyForm(p => {
      const next = { ...p, [field]: val };
      if (field === 'halfDay' && val) { next.fromDate = today; next.toDate = today; }
      if (field === 'fromDate') next.toDate = val; // To Date follows From Date
      return next;
    });
    setApplyErrors(p => ({ ...p, [field]: '', days: '' }));
  };

  const handleApplySubmit = async (e) => {
    e.preventDefault();
    const errs = validateApply();
    if (Object.keys(errs).length) { setApplyErrors(errs); return; }
    setSubmitting(true);
    try {
    await addLeave({
      employeeId: currentUser.id,
      leaveTypeCode: applyForm.leaveTypeCode,
      fromDate: applyForm.fromDate,
      toDate:   applyForm.toDate,
      halfDay:  applyForm.halfDay,
      days:     calcDays(),
      reason:   applyForm.reason,
      reco:     selectedReco     ? [selectedReco]     : applyForm.reco,
      approval: selectedApproval ? [selectedApproval] : applyForm.approval,
    }, { throwOnReject: true });
    } catch (err) {
      setSubmitting(false);
      setSaveAlert(alertFromSaveError(err, fd));
      return;
    }
    setSubmitting(false);
    setApplySuccess(true);
    setTimeout(() => { setShowApply(false); setApplyForm(emptyForm); setApplyErrors({}); setApplySuccess(false); }, 1500);
  };

  const openApply = () => {
    const { reco, approval } = getMyRecoApproval();
    setApplyForm({ ...emptyForm, reco, approval });
    setSelectedReco(reco.length === 1 ? String(reco[0]) : '');
    setSelectedApproval(approval.length === 1 ? String(approval[0]) : '');
    setApplyErrors({}); setApplySuccess(false); setShowApply(true);
  };

  /* ── Grid data ── */
  // Newest first (by Applied Date, falling back to From Date for ties/
  // missing values) — previously this was left in whatever order the API
  // returned rows (insertion order), not date order.
  const byAppliedDateDesc = (a, b) =>
    new Date(b.appliedDate || b.fromDate) - new Date(a.appliedDate || a.fromDate);
  // "Pending for Approvals" is a separate scope, not an org-hierarchy view —
  // it needs the unscoped allLeaves so a cross-branch/department assignment
  // (someone this user is configured as recommender/approver for, but who
  // isn't in their own org-scope) still shows up. The normal "my/my team's
  // applications" view keeps using the org-scoped `leaves` (filteredLeaves)
  // exactly as before.
  const displayLeaves = (showForApprovalLeave ? allLeaves : leaves).filter(l => {
    if (showForApprovalLeave) {
      if (String(l.employeeId) === String(currentUser.id)) return false;
      if (!isRecommenderForLeave(l.employeeId) && !isApproverForLeave(l.employeeId)) return false;
    } else if (!isManager && String(l.employeeId) !== String(currentUser.id)) {
      return false;
    }
    if (filterStatus !== 'all' && l.status !== filterStatus) return false;
    if (filterTypes.length > 0 && !filterTypes.includes(l.leaveTypeCode)) return false;
    if (filterAccum !== 'all') {
      const ltc = ltConfigs.find(lt => lt.shortName === l.leaveTypeCode);
      if (filterAccum === 'accumulate'    && ltc && !ltc.carryForward)  return false;
      if (filterAccum === 'nonAccumulate' && ltc &&  ltc.carryForward)  return false;
    }
    if (advFilterCount > 0) {
      const emp = getEmployeeById(l.employeeId);
      if (advFilters.branches.length     && !advFilters.branches.includes(emp?.branch))          return false;
      if (advFilters.departments.length  && !advFilters.departments.includes(emp?.department))   return false;
      if (advFilters.posts.length        && !advFilters.posts.includes(emp?.position))           return false;
      if (advFilters.grades.length       && !advFilters.grades.includes(emp?.grade))             return false;
      if (advFilters.modes.length        && !advFilters.modes.includes(emp?.mode))               return false;
      if (advFilters.statuses.length     && !advFilters.statuses.includes(emp?.status))          return false;
      if (advFilters.staffIds.length     && !advFilters.staffIds.includes(String(l.employeeId))) return false;
      if (advFilters.leaveTypes.length   && !advFilters.leaveTypes.includes(l.leaveTypeCode))    return false;
    }
    return true;
  }).sort(byAppliedDateDesc).map(l => {
    // Global search is name-only (see DataGrid searchOnlyExtraFields) — the Name
    // column's raw value is the employee id, so expose the displayed name.
    return { ...l, searchText: getEmployeeName(l.employeeId) || '' };
  });

  const countByStatus = s => (showForApprovalLeave ? allLeaves : leaves).filter(l => {
    if (showForApprovalLeave) {
      return String(l.employeeId) !== String(currentUser.id)
        && (isRecommenderForLeave(l.employeeId) || isApproverForLeave(l.employeeId))
        && (s === 'all' || l.status === s);
    }
    return (!isManager ? String(l.employeeId) === String(currentUser.id) : true) && (s === 'all' || l.status === s);
  }).length;

  /* language-aware leave type name lookup */
  const getLeaveLabel = (code) => {
    const ltc = ltConfigs.find(lt => lt.shortName === code);
    if (ltc) return ltc.name; // use configured name
    const lt2 = leaveTypes.find(lt => lt.code === code);
    if (!lt2) return code;
    return language === 'np' ? (lt2.name || code) : (lt2.nameEn || lt2.name || code);
  };

  /* ── Bulk actions (checkbox toolbar, near Search) — each just re-runs the
     same single-item action per selected id; per-employee authorization is
     still fully enforced server-side on every call, so a selection mixing
     eligible and ineligible rows simply skips the ineligible ones instead of
     failing the whole batch. ── */
  // Skipped (server-refused) rows are rolled back by DataContext — tell the
  // user how many and why, rather than letting them look done.
  const reportBulkLeaves = (results) => {
    const failed = results.filter(r => r.status === 'rejected');
    if (!failed.length) return;
    setActionToast({ msg: `${failed.length} of ${results.length} not done: ${failed[0].reason?.message || 'refused'}`, type: 'danger' });
    setTimeout(() => setActionToast(null), 5000);
  };
  const bulkApproveLeaves = async () => {
    reportBulkLeaves(await Promise.allSettled(selectedLeaveIds.map(id => approveLeave(id, currentUser.id))));
    setSelectedLeaveIds([]);
  };
  const bulkRejectLeaves = async () => {
    reportBulkLeaves(await Promise.allSettled(selectedLeaveIds.map(id => rejectLeave(id, currentUser.id, 'Declined'))));
    setSelectedLeaveIds([]);
  };
  const bulkDeleteLeaves = async () => {
    if (!confirm(t('Are you sure you want to delete this record?'))) return;
    reportBulkLeaves(await Promise.allSettled(selectedLeaveIds.map(id => deleteLeave(id))));
    setSelectedLeaveIds([]);
  };

  const columns = [
    { field: 'staffId',       header: 'Staff ID',        width: 90, render: (_, row) => (
        <span style={{ color:'#6b7280' }}>{getEmployeeById(row.employeeId)?.employeeId || '—'}</span>
      ) },
    { field: 'employeeId',    header: t('Name'),         width: 160, render: v => (
        <span style={{ display:'flex', alignItems:'center', gap:6, fontWeight:600, color:'#111827' }}>
          <Avatar photo={getEmployeeById(v)?.profilePhoto} name={getEmployeeName(v)} size={22} />
          {getEmployeeName(v)}
        </span>
      ) },
    { field: 'leaveTypeCode', header: t('Type'),         width: 150, render: v => (
      <span style={{ display:'flex', alignItems:'center', gap:6 }}>
        <span style={{ width:8, height:8, borderRadius:'50%', background:getLeaveTypeColor(v), display:'inline-block', flexShrink:0 }}></span>
        {getLeaveLabel(v)}
      </span>
    )},
    { field: 'isManual', header: language==='np' ? 'प्रकार' : 'App. Type', width: 110,
      render: (v) => {
        // Real, persisted flag — true only when actually submitted through
        // the Manual Posting form; false for the normal self-service Apply
        // flow, regardless of who's viewing this grid (previously this
        // guessed "Manual" for every row that didn't belong to the current
        // viewer, which marked nearly every application Manual for anyone
        // but the applicant themselves).
        const isMan = v === true;
        return (
          <span style={{ fontSize:12, fontWeight:600, padding:'2px 9px', borderRadius:10, whiteSpace:'nowrap',
            background: isMan ? '#fef3c7' : '#eff6ff',
            color:      isMan ? '#92400e' : '#1e40af',
            border:     `1px solid ${isMan ? '#fde68a' : '#bfdbfe'}` }}>
            {isMan
              ? (language==='np' ? '✍️ म्यानुअल' : '✍️ Manual')
              : (language==='np' ? '📝 आवेदन'  : '📝 Application')}
          </span>
        );
      }
    },
    { field: 'fromDate',      header: t('From Date'),    width: 110, render: v => fd(v) },
    { field: 'toDate',        header: t('To Date'),      width: 110, render: v => fd(v) },
    { field: 'days',          header: t('Days'),         width: 45, minWidth: 45, align:'center', render: v => <strong style={{ color:'#1a56db' }}>{(isNaN(Number(v)) || v === null || v === undefined) ? '—' : v}</strong> },
    { field: 'appliedDate',   header: t('Applied Date'), width: 110, render: v => fd(v) },
    { field: 'status',        header: t('Status'),       width: 110, render: v => <StatusBadge status={v} /> },
    // Shows only the one recommender/approver this specific application
    // actually names — recommendedBy/approvedBy once someone has acted,
    // otherwise the recoId/approvalId the applicant picked at apply time
    // (see migration 142) — NOT recoApprovalNamesForLeave's full configured
    // candidate list (used elsewhere, e.g. the printable pending-approval
    // slip, where every possible signer is genuinely relevant).
    { field: 'recommendatorNames', header: 'Recommendator', width: 150, sortable:false, filterable:false,
      // Pending with nobody named (older entries) → show the staff member's
      // configured recommender/approver, i.e. who will actually act on it.
      render: (_, row) => personCellForLeave(row.recommendedBy || row.recoId || (row.status === 'pending' ? [].concat(recoConfig[String(row.employeeId)]?.reco || [])[0] : null)) },
    { field: 'approvalNames', header: 'Approval', width: 150, sortable:false, filterable:false,
      render: (_, row) => personCellForLeave(row.approvedBy || row.approvalId || (row.status === 'pending' ? [].concat(recoConfig[String(row.employeeId)]?.approval || [])[0] : null)) },
  ];

  /* ── Rejection notifications ── */
  const ACK_KEY = 'ehajiri_ack_rejections';
  const ackedIds = useMemo(() => {
    try { return new Set(JSON.parse(localStorage.getItem(ACK_KEY) || '[]')); } catch { return new Set(); }
  }, []);
  const rejectedNotifications = useMemo(() =>
    leaves.filter(l =>
      String(l.employeeId) === String(currentUser.id) &&
      l.status === 'rejected' &&
      !ackedIds.has(String(l.id))
    ),
  [leaves, currentUser.id, ackedIds]);

  const dismissNotification = (id) => {
    const next = [...ackedIds, String(id)];
    localStorage.setItem(ACK_KEY, JSON.stringify(next));
    ackedIds.add(String(id));
  };

  return (
    <div>
      <AlertPopup alert={saveAlert} onClose={() => setSaveAlert(null)} />
      {/* ── Rejection Notifications ── */}
      {rejectedNotifications.map(l => (
        <div key={l.id} style={{ display:'flex', alignItems:'flex-start', gap:12, background:'#fef2f2',
          border:'1px solid #fca5a5', borderRadius:10, padding:'12px 16px', marginBottom:12 }}>
          <span style={{ fontSize:22, flexShrink:0 }}>❌</span>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:14, fontWeight:700, color:'#991b1b', marginBottom:4 }}>
              Your leave application was rejected
            </div>
            <div style={{ fontSize:13, color:'#374151' }}>
              <strong>{getLeaveTypeName(l.leaveTypeCode)}</strong> — {l.fromDate} to {l.toDate} ({l.days} days)
            </div>
            {l.comment && (
              <div style={{ fontSize:13, color:'#7f1d1d', marginTop:4, background:'#fff5f5',
                borderRadius:6, padding:'6px 10px', border:'1px solid #fecaca' }}>
                💬 <strong>Reason:</strong> {l.comment}
              </div>
            )}
            {l.approvedBy && (
              <div style={{ fontSize:11, color:'#9ca3af', marginTop:4 }}>
                Rejected by: {getEmployeeName(l.approvedBy)} {l.approvedDate ? `on ${l.approvedDate}` : ''}
              </div>
            )}
          </div>
          <button onClick={() => dismissNotification(l.id)}
            style={{ background:'none', border:'none', cursor:'pointer', color:'#9ca3af', fontSize:18, flexShrink:0 }}
            title="Dismiss notification">×</button>
        </div>
      ))}

      {/* Sub-header */}
      {(() => {
        /* ── Multi-checkbox leave type dropdown ── */
        const LeaveMCS = () => {
          const [open, setOpen] = React.useState(false);
          const [srch, setSrch] = React.useState('');
          const [activeIndex, setActiveIndex] = React.useState(-1);
          const ref = React.useRef(null);
          const itemRefs = React.useRef([]);
          React.useEffect(() => {
            const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
            document.addEventListener('mousedown', h);
            return () => document.removeEventListener('mousedown', h);
          }, []);

          /* options filtered by accum selection then search */
          const visOpts = ltConfigs.filter(lt => {
            if (filterAccum === 'accumulate'    && !lt.carryForward) return false;
            if (filterAccum === 'nonAccumulate' &&  lt.carryForward) return false;
            if (srch && !lt.name.toLowerCase().includes(srch.toLowerCase())) return false;
            return true;
          });
          // "All Types" is always row 0 in the navigable list
          const navItems = [null, ...visOpts];
          itemRefs.current = [];

          const toggle = (code) => setFilterTypes(p =>
            p.includes(code) ? p.filter(x => x !== code) : [...p, code]
          );
          const selectNav = (lt) => lt === null ? setFilterTypes([]) : toggle(lt.shortName);
          const selLabel = filterTypes.length === 0 ? 'All Types'
            : filterTypes.length === 1 ? (ltConfigs.find(lt => lt.shortName === filterTypes[0])?.name || filterTypes[0])
            : `${filterTypes.length} selected`;
          const openWithHighlight = () => {
            const idx = filterTypes.length === 1 ? navItems.findIndex(lt => lt?.shortName === filterTypes[0]) : 0;
            setActiveIndex(idx >= 0 ? idx : 0);
            setOpen(true);
          };
          const handleTriggerKeyDown = e => {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              open ? setOpen(false) : openWithHighlight();
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          };
          const handleSearchKeyDown = e => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActiveIndex(i => (navItems.length ? (i + 1) % navItems.length : -1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActiveIndex(i => (navItems.length ? (i - 1 + navItems.length) % navItems.length : -1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              if (activeIndex >= 0 && activeIndex < navItems.length) selectNav(navItems[activeIndex]);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setOpen(false);
            }
          };
          React.useEffect(() => {
            if (open && activeIndex >= 0) itemRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
          }, [activeIndex, open]);
          React.useEffect(() => { if (open) setActiveIndex(navItems.length ? 0 : -1); }, [srch]);

          return (
            <div ref={ref} style={{ position:'relative' }}>
              <div tabIndex={0} onClick={() => { open ? setOpen(false) : openWithHighlight(); }}
                onKeyDown={handleTriggerKeyDown}
                style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
                  padding:'5px 12px', border:`1.5px solid ${open?'#1a56db':'#d1d5db'}`,
                  borderRadius:7, background:'white', cursor:'pointer', fontSize:13, minWidth:200, minHeight:34,
                  color: filterTypes.length > 0 ? '#1e40af' : '#374151',
                  fontWeight: filterTypes.length > 0 ? 600 : 400,
                  boxShadow: open ? '0 0 0 2px #bfdbfe' : 'none', outline:'none', userSelect:'none' }}>
                <span style={{ flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{selLabel}</span>
                <div style={{ display:'flex', alignItems:'center', gap:4, flexShrink:0, marginLeft:6 }}>
                  {filterTypes.length > 0 && (
                    <span style={{ background:'#1a56db', color:'#fff', borderRadius:10, fontSize:10, fontWeight:700, padding:'1px 6px' }}>
                      {filterTypes.length}
                    </span>
                  )}
                  {filterTypes.length > 0 && (
                    <span onMouseDown={e=>{e.preventDefault();e.stopPropagation();setFilterTypes([]);}}
                      style={{ color:'#9ca3af', fontSize:15, lineHeight:1, cursor:'pointer' }}
                      onMouseEnter={e=>e.currentTarget.style.color='#ef4444'}
                      onMouseLeave={e=>e.currentTarget.style.color='#9ca3af'}>×</span>
                  )}
                  <span style={{ fontSize:9, color:'#9ca3af' }}>{open?'▲':'▼'}</span>
                </div>
              </div>
              {open && (
                <div style={{ position:'absolute', top:'calc(100% + 3px)', left:0, zIndex:9999,
                  background:'white', border:'1.5px solid #1a56db', borderRadius:8,
                  boxShadow:'0 8px 24px rgba(0,0,0,.18)', minWidth:280, maxHeight:280,
                  display:'flex', flexDirection:'column' }}>
                  {/* Search */}
                  <div style={{ padding:'6px 8px', borderBottom:'1px solid #e5e7eb', flexShrink:0 }}>
                    <input autoFocus type="text" value={srch} onChange={e=>setSrch(e.target.value)}
                      placeholder="Search leave type..." onClick={e=>e.stopPropagation()} onKeyDown={handleSearchKeyDown}
                      style={{ width:'100%', border:'1px solid #d1d5db', borderRadius:5, padding:'5px 9px',
                        fontSize:13, outline:'none', boxSizing:'border-box' }} />
                  </div>
                  {/* All row */}
                  <div style={{ overflowY:'auto', flex:1 }}>
                    {navItems.map((lt, i) => {
                      const isAll = lt === null;
                      const sel   = isAll ? filterTypes.length === 0 : filterTypes.includes(lt.shortName);
                      const highlighted = i === activeIndex;
                      return (
                        <div key={isAll ? '__all' : lt.shortName} ref={el => itemRefs.current[i] = el}
                          onMouseDown={e=>{e.preventDefault(); selectNav(lt);}}
                          onMouseEnter={() => setActiveIndex(i)}
                          style={{ padding:'8px 12px', display:'flex', alignItems:'center', gap:8, cursor:'pointer',
                            background: sel ? '#eff6ff' : (highlighted ? '#f8fafc' : 'white'),
                            borderBottom: isAll ? '1px solid #f1f5f9' : '1px solid #f9fafb' }}>
                          <span style={{ width:14, height:14, borderRadius:3, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center',
                            border:`2px solid ${sel?'#1a56db':'#d1d5db'}`, background:sel?'#1a56db':'white' }}>
                            {sel && <svg viewBox="0 0 12 12" fill="none" width="9"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round"/></svg>}
                          </span>
                          <span style={{ fontSize:13, color:sel?'#1e40af':'#374151', fontWeight:sel?600:400 }}>
                            {isAll ? 'All Types' : lt.name}
                            {!isAll && lt.carryForward !== undefined && (
                              <span style={{ marginLeft:6, fontSize:10, padding:'1px 6px', borderRadius:6,
                                background: lt.carryForward ? '#d1fae5' : '#f3f4f6',
                                color: lt.carryForward ? '#065f46' : '#6b7280' }}>
                                {lt.carryForward ? 'Accum.' : 'Non-Accum.'}
                              </span>
                            )}
                          </span>
                        </div>
                      );
                    })}
                    {visOpts.length === 0 && (
                      <div style={{ padding:'10px 12px', fontSize:12, color:'#9ca3af', textAlign:'center' }}>No types found</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        };

        return (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
            flexWrap:'wrap', gap:8, marginBottom:14 }}>

            {/* Left: status + leave type filter — all on one line */}
            <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
              {/* Status buttons */}
              {['all','pending','approved','rejected'].map(s => (
                <button key={s} onClick={() => setFilterStatus(s)}
                  className={`btn btn-sm ${filterStatus===s ? 'btn-primary' : 'btn-outline'}`}>
                  {s==='all' ? t('All') : s==='pending' ? t('Pending') : s==='approved' ? t('Approved') : t('Rejected')}
                  <span style={{ marginLeft:4, background:'rgba(0,0,0,.1)', borderRadius:10, padding:'1px 6px', fontSize:11 }}>
                    {countByStatus(s)}
                  </span>
                </button>
              ))}

              {/* Separator */}
              <span style={{ color:'#d1d5db', fontSize:18, lineHeight:1 }}>|</span>

              {/* Leave Type label + accum chips + MCS */}
              <span style={{ fontSize:13, fontWeight:600, color:'#374151', whiteSpace:'nowrap' }}>Leave Type:</span>
              {[
                { key:'all',           label:'All' },
                { key:'accumulate',    label:'Accumulate' },
                { key:'nonAccumulate', label:'Non-Accumulate' },
              ].map(opt => (
                <button key={opt.key} type="button"
                  onClick={() => { setFilterAccum(opt.key); setFilterTypes([]); }}
                  style={{ padding:'4px 12px', fontSize:12, borderRadius:20, cursor:'pointer',
                    border:`1.5px solid ${filterAccum===opt.key?'#1a56db':'#d1d5db'}`,
                    background: filterAccum===opt.key ? '#eff6ff' : 'white',
                    color: filterAccum===opt.key ? '#1a56db' : '#374151',
                    fontWeight: filterAccum===opt.key ? 700 : 400, transition:'all .12s' }}>
                  {opt.label}
                </button>
              ))}
              <LeaveMCS />
            </div>

            {/* Right: action buttons */}
            <div style={{ display:'flex', gap:8, flexShrink:0, flexWrap:'wrap' }}>
              {(isManager || hasAnyRecoAssignmentLeave) && (
                <button className={`btn btn-sm ${showForApprovalLeave ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => {
                    // A configured recommender/approver gets an inline toggle
                    // right on this tab (below) instead of the separate
                    // Leave Approval view — a manager with no personal
                    // assignment gets that fuller oversight view (stats,
                    // org-wide list, etc.) as a full-width popup here instead
                    // of navigating away to its own page.
                    if (hasAnyRecoAssignmentLeave) setShowForApprovalLeave(v => !v);
                    else setShowLeaveApprovalModal(true);
                  }}>
                  ✅ {hasAnyRecoAssignmentLeave
                    ? `Pending for Approvals${pendingForApprovalCountLeave ? ` (${pendingForApprovalCountLeave})` : ''}`
                    : t('Leave Approval')}
                </button>
              )}
              {canManageStaff && (
                <button className="btn btn-sm" onClick={() => { setManualForm({ employeeId:'', leaveTypeCode:'', fromDate:today, toDate:today, halfDay:false, days:'1', reason:'', status:'approved', appliedDate:today, approvedDate:today }); setManualErrors({}); setManualLastSaved(null); setShowManual(true); }}
                  style={{ background:'linear-gradient(135deg,#7c3aed,#6d28d9)', color:'white', border:'none', borderRadius:6, padding:'5px 12px', fontSize:12, fontWeight:700, cursor:'pointer' }}>
                  ✍️ Manual Posting
                </button>
              )}
              <button className="btn btn-primary btn-sm" onClick={openApply}>
                + {t('Apply for Leave')}
              </button>
            </div>
          </div>
        );
      })()}

      <DataGrid columns={columns} data={displayLeaves} extraSearchFields={['searchText']} searchOnlyExtraFields defaultPageSize={20} pageSizeOptions={[5, 10, 20, 50, 100]} showSearch searchPlaceholder={t('Search') + '...'}
        showFilterButton={false}
        toolbarRightInset={viewLeave ? 456 : 0}
        onRowClick={row => setViewLeave(v => v?.id === row.id ? null : row)}
        onFocusChange={row => setViewLeave(row)}
        onSelectionChange={setSelectedLeaveIds}
        contextMenu={[
          { label: t('Add New'), icon:'➕', onClick: () => openApply() },
          'divider',
          { label: t('Edit'), icon:'✏️', onClick: (row) => { if (canEditLeaveRow(row)) openEditFormLeave(row); } },
          'divider',
          { label: t('Delete'), icon:'🗑', className:'danger', onClick: (row) => { if (canDeleteLeaveRow(row)) setDelConfirm(row.id); } },
        ]}
        toolbar={
          <div style={{ display:'flex', gap:8 }}>
            <button className="dg-filter-btn" onClick={openAdvFilter}>
              <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
                <path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L12 11.414V15a1 1 0 01-.293.707l-2 2A1 1 0 018 17v-5.586L3.293 6.707A1 1 0 013 6V3z" clipRule="evenodd"/>
              </svg>
              {t('Advance Search')}{advFilterCount > 0 ? ` (${advFilterCount})` : ''}
            </button>
            {showForApprovalLeave && (
              <>
                <button className="btn btn-sm btn-success" disabled={!selectedLeaveIds.length} onClick={bulkApproveLeaves}
                  style={{ opacity: selectedLeaveIds.length ? 1 : 0.45, cursor: selectedLeaveIds.length ? 'pointer' : 'not-allowed' }}>
                  ✓ {t('Approve')} {selectedLeaveIds.length ? `(${selectedLeaveIds.length})` : ''}
                </button>
                <button className="btn btn-sm btn-danger" disabled={!selectedLeaveIds.length} onClick={bulkRejectLeaves}
                  style={{ opacity: selectedLeaveIds.length ? 1 : 0.45, cursor: selectedLeaveIds.length ? 'pointer' : 'not-allowed' }}>
                  ✗ {t('Reject')} {selectedLeaveIds.length ? `(${selectedLeaveIds.length})` : ''}
                </button>
              </>
            )}
            <button className="btn btn-sm btn-outline" disabled={selectedLeaveIds.length !== 1}
              onClick={() => { const row = displayLeaves.find(l => l.id === selectedLeaveIds[0]); if (row) openEditFormLeave(row); }}
              style={{ opacity: selectedLeaveIds.length === 1 ? 1 : 0.45, cursor: selectedLeaveIds.length === 1 ? 'pointer' : 'not-allowed' }}>
              ✏️ {t('Edit')}
            </button>
            <button className="btn btn-sm btn-outline" disabled={!selectedLeaveIds.length} onClick={bulkDeleteLeaves}
              style={{ opacity: selectedLeaveIds.length ? 1 : 0.45, cursor: selectedLeaveIds.length ? 'pointer' : 'not-allowed' }}>
              🗑 {t('Delete')} {selectedLeaveIds.length ? `(${selectedLeaveIds.length})` : ''}
            </button>
          </div>
        }
      />

      <LeaveAdvancedFilter
        isOpen={advFilterOpen} onClose={() => setAdvFilterOpen(false)}
        onApply={applyAdvFilter} onReset={resetAdvFilter}
        tempF={advTempF} setTF={setAdvTF}
        branchOpts={advBranchOpts} deptOpts={advDeptOpts} postOpts={advPostOpts}
        gradeOpts={advGradeOpts}   modeOpts={advModeOpts}  statusOpts={advStatusOpts}
        staffOpts={advStaffOpts}   leaveTypeOpts={advLeaveTypeOpts}
        showFY={false} showAccum={false} L={(np, en) => language === 'np' ? np : en}
      />

      {/* ── Inline Recommend / Approve / Reject Modal ── */}
      {actionModal && (
        <div className="modal-overlay">
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>
                {actionModal.type === 'recommend' ? `👍 ${t('Recommend')}` : actionModal.type === 'approve' ? `✅ ${t('Approve')}` : `❌ ${t('Reject')}`} — {t('Leave Application')}
              </h2>
              <button className="modal-close" onClick={() => setActionModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              {/* Leave summary */}
              <div style={{ background:'#f9fafb', borderRadius:8, padding:12, marginBottom:14, fontSize:13 }}>
                <div style={{ fontWeight:700, color:'#111827' }}>{getEmployeeName(actionModal.leave.employeeId)}</div>
                <div style={{ color:'#374151', marginTop:2 }}>{getLeaveTypeName(actionModal.leave.leaveTypeCode)} · {actionModal.leave.days} {t('Days')}</div>
                <div style={{ color:'#6b7280' }}>{actionModal.leave.fromDate} – {actionModal.leave.toDate}</div>
                {actionModal.leave.reason && <div style={{ color:'#374151', marginTop:4 }}>{actionModal.leave.reason}</div>}
                {actionModal.leave.recommendedBy && (
                  <div style={{ marginTop:5 }}>
                    <span style={{ fontSize:11, background:'#d1fae5', color:'#065f46', borderRadius:8, padding:'2px 8px', fontWeight:700 }}>
                      ✓ Recommended by {getEmployeeName(actionModal.leave.recommendedBy)}
                    </span>
                  </div>
                )}
              </div>
              <div className="form-group">
                <label className="form-label">{t('Comment')} ({t('Optional')})</label>
                <textarea className="form-control" rows={3} placeholder={t('Enter comment')}
                  value={comment} onChange={e => setComment(e.target.value)}
                  style={{ fontSize:13 }} autoFocus />
              </div>
              {actionModal.type === 'approve' && (
                <div style={{ background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:8, padding:'8px 12px', fontSize:12, color:'#1e40af' }}>
                  📊 Approving this leave will automatically reduce the employee's leave balance by <strong>{actionModal.leave.days} day{actionModal.leave.days !== 1 ? 's' : ''}</strong>.
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setActionModal(null)}>{t('Cancel')}</button>
              <button
                className={`btn ${actionModal.type === 'reject' ? 'btn-danger' : 'btn-success'}`}
                onClick={async () => {
                  const { id, type } = actionModal;
                  setActionModal(null); setComment('');
                  // Wait for the server — a refusal (not the configured
                  // approver, etc.) is rolled back by DataContext and shown
                  // here instead of a false "approved" toast.
                  try {
                    if (type === 'recommend')     await recommendLeave(id, currentUser.id, comment);
                    else if (type === 'approve')  await approveLeave(id, currentUser.id, comment);
                    else                          await rejectLeave(id, currentUser.id, comment);
                    setActionToast({
                      msg: type === 'recommend' ? t('Application recommended') : type === 'approve' ? t('Application approved') : t('Application rejected'),
                      type: type === 'reject' ? 'danger' : 'success',
                    });
                  } catch (err) {
                    setActionToast({ msg: err?.message || 'Action failed', type: 'danger' });
                  }
                  setTimeout(() => setActionToast(null), 4000);
                }}>
                {actionModal.type === 'recommend' ? `👍 ${t('Recommend')}` : actionModal.type === 'approve' ? `✅ ${t('Approve')}` : `❌ ${t('Reject')}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {actionToast && (
        <div className="toast-container">
          <div className={`toast toast-${actionToast.type}`}>
            <span>{actionToast.type === 'success' ? '✅' : '❌'}</span>{actionToast.msg}
          </div>
        </div>
      )}

      {/* ── Edit Leave Modal (double-click) ── */}
      {editLeave && (() => {
        // keep an existing multi-day range; only pull To Date forward if From passes it
        const setEF = (f, v) => setEditForm(p => ({ ...p, [f]: v, ...(f === 'fromDate' && (!p.toDate || p.toDate < v) ? { toDate: v } : {}) }));
        const validateEdit = () => {
          const e = {};
          if (!editForm.leaveTypeCode) e.leaveTypeCode = t('Required field');
          if (!editForm.fromDate)      e.fromDate      = t('Required field');
          if (!editForm.toDate)        e.toDate        = t('Required field');
          if (editForm.fromDate && editForm.toDate && editForm.toDate < editForm.fromDate)
            e.toDate = 'To Date must be on or after From Date';
          return e;
        };
        const handleEditSubmit = async (ev) => {
          ev.preventDefault();
          const errs = validateEdit();
          if (Object.keys(errs).length) { setEditErrors(errs); return; }
          // Same weekend/holiday deduction as the apply form — this used to be
          // a plain calendar-day diff, ignoring the leave type's settings.
          const days = editForm.halfDay ? 0.5 : (countLeaveDays(
            settings,
            ltConfigs.find(lt => lt.shortName === editForm.leaveTypeCode),
            editForm.fromDate, editForm.toDate,
            allEmployees.find(e => String(e.id) === String(editForm.employeeId)),
          ));
          try {
          await updateLeave(editLeave.id, {
            employeeId:      editForm.employeeId,
            leaveTypeCode:   editForm.leaveTypeCode,
            fromDate:        editForm.fromDate,
            toDate:          editForm.toDate,
            halfDay:         editForm.halfDay,
            days,
            reason:          editForm.reason,
            status:          editForm.status,
            recommendedBy:   editForm.recommendedBy   || null,
            recommendedDate: editForm.recommendedDate || null,
            approvedBy:      editForm.approvedBy      || null,
            approvedDate:    editForm.approvedDate    || null,
          }, { throwOnReject: true });
          } catch (err) {
            // Refused (e.g. clashes with another entry that day) — keep the form open.
            setSaveAlert(alertFromSaveError(err, fd));
            return;
          }
          setEditLeave(null);
        };

        const Lbl = ({ children, required }) => (
          <div style={{ fontSize:12, fontWeight:600, color:'#374151', marginBottom:4 }}>
            {children}{required && <span style={{ color:'#dc2626', marginLeft:2 }}>*</span>}
          </div>
        );
        const Err = ({ msg }) => msg ? <div style={{ fontSize:11, color:'#dc2626', marginTop:3 }}>{msg}</div> : null;
        const activeEmps = allEmployees.filter(e => e.active !== false);

        /* get configured reco/approval for the selected employee */
        const editEmpRecoAppr = (() => {
          const cfg = recoConfig[String(editForm.employeeId)] || {};
          const toIds = (v) => Array.isArray(v) ? v : (v ? [v] : []);
          const recoIds = toIds(cfg.reco).map(String);
          const apprIds = toIds(cfg.approval).map(String);
          const toOpts = (ids) => ids.map(id => {
            const e = activeEmps.find(x => String(x.id) === id);
            return {
              value: id,
              label: e ? e.fullName : `#${id}`,
              sub: e ? [e.employeeId, e.position].filter(Boolean).join(' - ') : '',
              photo: e?.profilePhoto,
            };
          });
          return { recoOpts: toOpts(recoIds), apprOpts: toOpts(apprIds) };
        })();

        return (
          <div className="modal-overlay">
            <div className="modal modal-lg" style={{ maxWidth:680, maxHeight:'90vh', overflowY:'auto' }}
              onClick={e => e.stopPropagation()}>
              <div className="modal-header" style={{ position:'sticky', top:0, zIndex:10 }}>
                <h2>✏️ Edit Leave Application #{editLeave.id}</h2>
                <button className="modal-close" onClick={() => setEditLeave(null)}>✕</button>
              </div>
              <div className="modal-body">
                <form ref={editFormRef} onSubmit={handleEditSubmit}>
                  {/* Staff */}
                  <div className="form-group">
                    <Lbl required>Staff</Lbl>
                    <select value={editForm.employeeId}
                      onChange={e => setEditForm(p => ({ ...p, employeeId: e.target.value, recommendedBy: '', approvedBy: '' }))}
                      className="form-control" style={{ fontSize:13 }}>
                      {activeEmps.map(e => (
                        <option key={e.id} value={String(e.id)}>
                          {e.fullName} {e.employeeId ? `[${e.employeeId}]` : ''} — {e.department || '—'}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Leave Type */}
                  <div className="form-group">
                    <Lbl required>Leave Type</Lbl>
                    <select value={editForm.leaveTypeCode} onChange={e => setEF('leaveTypeCode', e.target.value)}
                      className={`form-control ${editErrors.leaveTypeCode ? 'error' : ''}`} style={{ fontSize:13 }}>
                      <option value="">— Select Leave Type —</option>
                      {ltConfigs.map(lt => <option key={lt.shortName} value={lt.shortName}>{lt.name}</option>)}
                    </select>
                    <Err msg={editErrors.leaveTypeCode} />
                  </div>

                  {/* Half Day */}
                  <div style={{ marginBottom:14 }}>
                    <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', userSelect:'none' }}>
                      <input type="checkbox" checked={editForm.halfDay} onChange={e => setEF('halfDay', e.target.checked)}
                        style={{ width:15, height:15, accentColor:'#1a56db' }} />
                      <span style={{ fontSize:13, fontWeight:600 }}>Half Day</span>
                    </label>
                  </div>

                  {/* Dates */}
                  <div className="form-row">
                    <div className="form-group">
                      <Lbl required>From Date</Lbl>
                      <LeaveDateInput value={editForm.fromDate} error={!!editErrors.fromDate}
                        settings={settings} onChange={v => setEF('fromDate', v)} />
                      <Err msg={editErrors.fromDate} />
                    </div>
                    <div className="form-group">
                      <Lbl required>To Date</Lbl>
                      <LeaveDateInput value={editForm.toDate} error={!!editErrors.toDate}
                        minDate={editForm.fromDate} settings={settings} onChange={v => setEF('toDate', v)} />
                      <Err msg={editErrors.toDate} />
                    </div>
                  </div>

                  {/* Reason */}
                  <div className="form-group">
                    <Lbl>Reason</Lbl>
                    <textarea className="form-control" rows={2} placeholder="Enter reason..."
                      value={editForm.reason} onChange={e => setEF('reason', e.target.value)} style={{ fontSize:13 }} />
                  </div>

                  {/* Status — only admin/manager can change this here; a
                      staff member editing their own still-pending leave
                      can't set their own outcome (that's what Approve/
                      Reject on the grid, done by the assigned approver, is
                      for). */}
                  <div className="form-group">
                    <Lbl required>Status</Lbl>
                    <select value={editForm.status} onChange={e => setEF('status', e.target.value)}
                      disabled={!canManageStaff}
                      title={!canManageStaff ? 'Only an approver can change the status of your application' : undefined}
                      className="form-control" style={{ fontSize:13, opacity: canManageStaff ? 1 : .65 }}>
                      <option value="pending">Pending</option>
                      <option value="approved">Approved</option>
                      <option value="rejected">Rejected</option>
                    </select>
                  </div>

                  {/* Recommended By + Date — only configured recommenders */}
                  <div className="form-row">
                    <div className="form-group">
                      <Lbl>Recommended By</Lbl>
                      <SearchableSelect value={editForm.recommendedBy}
                        onChange={v => setEF('recommendedBy', v)}
                        options={editEmpRecoAppr.recoOpts}
                        placeholder={editEmpRecoAppr.recoOpts.length === 0 ? 'No recommendator configured' : '— Select Recommendator —'}
                        disabled={editEmpRecoAppr.recoOpts.length === 0} showAvatar />
                    </div>
                    <div className="form-group">
                      <Lbl>Recommended Date</Lbl>
                      <LeaveDateInput value={editForm.recommendedDate} settings={settings}
                        onChange={v => setEF('recommendedDate', v)} />
                    </div>
                  </div>

                  {/* Approved By + Date — only configured approvers */}
                  <div className="form-row">
                    <div className="form-group">
                      <Lbl>Approved By</Lbl>
                      <SearchableSelect value={editForm.approvedBy}
                        onChange={v => setEF('approvedBy', v)}
                        options={editEmpRecoAppr.apprOpts}
                        placeholder={editEmpRecoAppr.apprOpts.length === 0 ? 'No approver configured' : '— Select Approver —'}
                        disabled={editEmpRecoAppr.apprOpts.length === 0} showAvatar />
                    </div>
                    <div className="form-group">
                      <Lbl>Approved Date</Lbl>
                      <LeaveDateInput value={editForm.approvedDate} settings={settings}
                        onChange={v => setEF('approvedDate', v)} />
                    </div>
                  </div>

                  <div className="modal-footer" style={{ padding:'14px 0 0', borderTop:'1px solid #e5e7eb', marginTop:6, display:'flex', justifyContent:'space-between' }}>
                    <button type="button" className="btn btn-outline" style={{ color:'#dc2626', borderColor:'#fca5a5' }}
                      onClick={() => { setDelConfirm(editLeave.id); setEditLeave(null); }}>
                      🗑️ Delete
                    </button>
                    <div style={{ display:'flex', gap:8 }}>
                      <button type="button" className="btn btn-outline" onClick={() => setEditLeave(null)}>Cancel</button>
                      <button type="submit" className="btn btn-primary" title="Ctrl+S">💾 <u>S</u>ave Changes</button>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Manual Posting Modal (Leave) ── */}
      {showManual && (() => {
        // picking From Date copies it into To Date
        const setMF = (f, v) => setManualForm(p => ({ ...p, [f]: v, ...(f === 'fromDate' ? { toDate: v } : {}) }));

        const validateManual = () => {
          const e = {};
          if (!manualForm.employeeId)    e.employeeId    = t('Required field');
          if (!manualForm.leaveTypeCode) e.leaveTypeCode = t('Required field');
          if (!manualForm.fromDate)      e.fromDate      = t('Required field');
          if (!manualForm.toDate)        e.toDate        = t('Required field');
          if (manualForm.fromDate && manualForm.toDate && manualForm.toDate < manualForm.fromDate)
            e.toDate = 'To Date must be on or after From Date';
          if (!manualForm.reason.trim()) e.reason = t('Required field');
          // Approved By is compulsory for every Manual Posting.
          if (manualForm.employeeId && !manualForm.approvedBy)
            e.approvedBy = manualApprOpts.length === 0 ? 'No approver configured for this staff — set it in Staff Detail → Set Recommendator & Approval' : t('Required field');
          return e;
        };

        const handleManualSubmit = async (ev) => {
          ev.preventDefault();
          const errs = validateManual();
          if (Object.keys(errs).length) { setManualErrors(errs); return; }

          // Block duplicates / overlaps against this employee's existing
          // (non-rejected) leaves: an identical entry (same staff + leave type
          // + dates) is a duplicate; any other leave touching one of these
          // dates means that day already has a leave posted.
          const d10 = (v) => String(v || '').slice(0, 10);
          const newFrom = d10(manualForm.fromDate);
          const newTo   = d10(manualForm.toDate);
          const existing = (allLeaves || []).filter(l =>
            String(l.employeeId) === String(manualForm.employeeId) && l.status !== 'rejected');
          const fmtLeave = (l) => `${getLeaveTypeName(l.leaveTypeCode) || l.leaveTypeCode}: ${fd(l.fromDate)}${d10(l.toDate) !== d10(l.fromDate) ? ' → ' + fd(l.toDate) : ''}`;
          const dup = existing.find(l =>
            l.leaveTypeCode === manualForm.leaveTypeCode && d10(l.fromDate) === newFrom && d10(l.toDate) === newTo);
          if (dup) {
            setManualAlert({ title: language === 'np' ? 'दोहोरो प्रविष्टि' : 'Duplicate Leave', msg: language === 'np' ? 'यही कर्मचारीको यही मितिमा उही बिदा पहिले नै दर्ता भइसकेको छ। पुनः सुरक्षित गर्न मिल्दैन।' : 'Duplicate entry — an identical leave has already been recorded for this staff member on the selected date. It cannot be saved again.', detail: fmtLeave(dup) });
            return;
          }
          const overlap = existing.find(l => d10(l.fromDate) <= newTo && d10(l.toDate) >= newFrom);
          if (overlap) {
            setManualAlert({ title: language === 'np' ? 'बिदा पहिले नै पोस्ट भएको' : 'Leave Already Exists', msg: language === 'np' ? 'यो कर्मचारीको चयन गरिएको मितिमा अर्को बिदा पहिले नै दर्ता भइसकेको छ। एक दिनमा एउटा मात्र बिदा राख्न सकिन्छ — कृपया फरक मिति छान्नुहोस्।' : 'This staff member already has another leave on the selected day. Only one leave can be recorded per day — please choose a different date or review the existing entry.', detail: fmtLeave(overlap) });
            return;
          }

          // Same weekend/holiday deduction as the apply form — this used to be
          // a plain calendar-day diff, ignoring the leave type's settings.
          const days = manualForm.halfDay ? 0.5 : (countLeaveDays(
            settings,
            ltConfigs.find(lt => lt.shortName === manualForm.leaveTypeCode),
            manualForm.fromDate, manualForm.toDate,
            allEmployees.find(e => String(e.id) === String(manualForm.employeeId)),
          ));
          const savedDevice = getDeviceInfo();
          try {
          await addLeave({
            employeeId:       manualForm.employeeId,
            leaveTypeCode:    manualForm.leaveTypeCode,
            fromDate:         manualForm.fromDate,
            toDate:           manualForm.toDate,
            halfDay:          manualForm.halfDay,
            days,
            reason:           manualForm.reason,
            status:           manualForm.status,
            appliedDate:      today,
            isManual:         true,
            recommendedBy:    manualForm.recommendedBy    || null,
            recommendedDate:  manualForm.recommendedDate  || null,
            approvedBy:       manualForm.approvedBy       || null,
            approvedDate:     manualForm.approvedDate      || null,
            deviceInfo:       savedDevice,
          }, { throwOnReject: true });
          } catch (err) {
            // Server refused it (e.g. staff outside your branch) — nothing was saved.
            setManualAlert(alertFromSaveError(err, fd));
            return;
          }
          // Stay on the form for back-to-back manual postings instead of
          // closing — clear the fields and reopen the Staff picker ready for
          // the next entry.
          setManualForm({ employeeId:'', leaveTypeCode:'', fromDate:today, toDate:today, halfDay:false, days:'1', reason:'', status:'approved', appliedDate:today, approvedDate:today });
          setManualErrors({});
          setManualResetKey(k => k + 1);
          // addLeave only returns the new id, not the saved row — build the
          // confirmation from what we already know client-side rather than a
          // second round-trip.
          setManualLastSaved({ updatedByName: currentUser.fullName, updatedAt: new Date().toISOString(), updatedDevice: savedDevice });
          setManualToast({ msg:'Leave entry posted manually', type:'success' });
          setTimeout(() => setManualToast(null), 2500);
        };

        const Lbl = ({ children, required }) => (
          <div style={{ fontSize:12, fontWeight:600, color:'#374151', marginBottom:4 }}>
            {children}{required && <span style={{ color:'#dc2626', marginLeft:2 }}>*</span>}
          </div>
        );
        const Err = ({ msg }) => msg ? <div style={{ fontSize:11, color:'#dc2626', marginTop:3 }}>{msg}</div> : null;

        // Staff field is scoped to who this user is allowed to post on behalf
        // of (Branch Manager → own branch, Dept Head → own dept, Branch Area
        // Manager/Dept Incharge → their covered branches/depts — see
        // AuthContext's filterByRole). Recommender/approver options just
        // below intentionally keep searching the full company list
        // (activeEmps/allEmployees) since a recommender/approver can be
        // configured outside the poster's own branch/department (Staff
        // Detail → Set Recommendator & Approval).
        const scopedEmps = employees.filter(e => e.active !== false)
          .sort((a, b) => staffRankCompare(a, b, settings));
        const empOpts = scopedEmps.map(e => ({
          value: String(e.id),
          label: e.fullName,
          sub: [e.employeeId, e.position || e.department].filter(Boolean).join(' - '),
          photo: e.profilePhoto,
        }));
        const activeEmps = allEmployees.filter(e => e.active !== false)
          .sort((a, b) => staffRankCompare(a, b, settings));
        const ltOpts = ltConfigs.map(lt => ({ value: lt.shortName, label: lt.name }));

        /* only staff configured (Staff Detail → Set Recommendator & Approval) for this employee */
        const manualCfg    = recoConfig[String(manualForm.employeeId)] || {};
        const toIds         = (v) => (Array.isArray(v) ? v : (v ? [v] : [])).map(String);
        const manualRecoIds = toIds(manualCfg.reco);
        const manualApprIds = toIds(manualCfg.approval);
        const manualRecoOpts = activeEmps.filter(e => manualRecoIds.includes(String(e.id))).map(e => ({ value: String(e.id), label: e.fullName, sub: [e.employeeId, e.position].filter(Boolean).join(' - '), photo: e.profilePhoto }));
        const manualApprOpts = activeEmps.filter(e => manualApprIds.includes(String(e.id))).map(e => ({ value: String(e.id), label: e.fullName, sub: [e.employeeId, e.position].filter(Boolean).join(' - '), photo: e.profilePhoto }));

        // Tab order: Staff → Leave Type → Half Day → From/To Date → Reason →
        // Status → Recommended By/Date → Approved By/Date → Cancel → Save,
        // wrapping at either end so focus never escapes to the page behind.
        const cycleManualTab = (e) => {
          if (e.key !== 'Tab' || manualAlert) return;
          const list = Array.from(e.currentTarget.querySelectorAll(
            'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])'
          )).filter(n => n.tabIndex >= 0 && n.offsetParent !== null);
          if (!list.length) return;
          const first = list[0], last = list[list.length - 1];
          if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
          else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        };

        return (
          <div className="modal-overlay">
            {manualAlert && (
              <div className="modal-overlay" style={{ zIndex:2000 }}>
                <div className="modal modal-sm" style={{ maxWidth:400 }} onClick={e => e.stopPropagation()}>
                  <div className="modal-header">
                    <h2 style={{ color:'#991b1b' }}>⚠️ {manualAlert.title}</h2>
                    <button className="modal-close" onClick={() => setManualAlert(null)}>✕</button>
                  </div>
                  <div className="modal-body">
                    <div style={{ background:'#fff5f5', border:'1px solid #fecaca', borderRadius:8, padding:'12px 16px', fontSize:14, fontWeight:600, color:'#991b1b', lineHeight:1.7 }}>
                      {manualAlert.msg}
                    </div>
                    {manualAlert.detail && (
                      <div style={{ marginTop:10, fontSize:12, color:'#6b7280' }}>{manualAlert.detail}</div>
                    )}
                  </div>
                  <div className="modal-footer">
                    <button type="button" className="btn btn-primary" autoFocus onClick={() => setManualAlert(null)}>OK</button>
                  </div>
                </div>
              </div>
            )}
            <div className="modal modal-lg" style={{ maxWidth:700, maxHeight:'90vh', overflowY:'auto' }}
              onClick={e => e.stopPropagation()} onKeyDown={cycleManualTab}>
              <div className="modal-header" style={{ position:'sticky', top:0, zIndex:10 }}>
                <h2>✍️ Manual Leave Posting</h2>
                {/* out of the Tab cycle — Esc / Cancel still close */}
                <button className="modal-close" tabIndex={-1} onClick={() => setShowManual(false)}>✕</button>
              </div>
              <div className="modal-body">
                <div style={{ background:'#fef3c7', border:'1px solid #fde68a', borderRadius:8, padding:'8px 12px', marginBottom:14, fontSize:12, color:'#92400e' }}>
                  ⚠️ Manual posting bypasses the normal workflow. Use for correcting records or back-dated entries.
                </div>
                <form ref={manualFormRef} onSubmit={handleManualSubmit}>

                  {/* Staff */}
                  <div className="form-group">
                    <Lbl required>Staff</Lbl>
                    <div style={{ outline: manualErrors.employeeId ? '1.5px solid #f87171' : 'none', borderRadius: 7 }}>
                      <SearchableSelect key={manualResetKey} autoOpen value={manualForm.employeeId}
                        onChange={v => setManualForm(p => ({ ...p, employeeId: v, recommendedBy: '', approvedBy: '' }))}
                        options={empOpts} placeholder="— Search & Select Staff —" showAvatar />
                    </div>
                    <Err msg={manualErrors.employeeId} />
                  </div>

                  {/* Leave Type */}
                  <div className="form-group">
                    <Lbl required>Leave Type</Lbl>
                    <div style={{ outline: manualErrors.leaveTypeCode ? '1.5px solid #f87171' : 'none', borderRadius: 7 }}>
                      <SearchableSelect value={manualForm.leaveTypeCode} onChange={v => setMF('leaveTypeCode', v)}
                        options={ltOpts} placeholder="— Search & Select Leave Type —" />
                    </div>
                    <Err msg={manualErrors.leaveTypeCode} />
                  </div>

                  {/* Half Day */}
                  <div style={{ marginBottom:14 }}>
                    <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', userSelect:'none' }}>
                      <input type="checkbox" checked={manualForm.halfDay} onChange={e => setMF('halfDay', e.target.checked)}
                        style={{ width:15, height:15, accentColor:'#7c3aed' }} />
                      <span style={{ fontSize:13, fontWeight:600, color:'#374151' }}>Half Day (0.5)</span>
                    </label>
                  </div>

                  {/* From / To Date */}
                  <div className="form-row">
                    <div className="form-group">
                      <Lbl required>From Date</Lbl>
                      <LeaveDateInput value={manualForm.fromDate} error={!!manualErrors.fromDate}
                        settings={settings} allowPast={isAdmin} onChange={v => setMF('fromDate', v)} />
                      <Err msg={manualErrors.fromDate} />
                    </div>
                    <div className="form-group">
                      <Lbl required>To Date</Lbl>
                      <LeaveDateInput value={manualForm.toDate} error={!!manualErrors.toDate}
                        minDate={manualForm.fromDate} settings={settings} allowPast={isAdmin} onChange={v => setMF('toDate', v)} />
                      <Err msg={manualErrors.toDate} />
                    </div>
                  </div>

                  {/* Reason */}
                  <div className="form-group">
                    <Lbl required>Reason</Lbl>
                    <textarea className={`form-control ${manualErrors.reason ? 'error' : ''}`}
                      rows={2} placeholder="Enter reason..." value={manualForm.reason}
                      onChange={e => setMF('reason', e.target.value)} style={{ fontSize:13 }} />
                    <Err msg={manualErrors.reason} />
                  </div>

                  {/* Status */}
                  <div className="form-group">
                    <Lbl required>Status</Lbl>
                    <select value={manualForm.status} onChange={e => setMF('status', e.target.value)}
                      className="form-control" style={{ fontSize:13 }}>
                      <option value="approved">Approved</option>
                      <option value="pending">Pending</option>
                      <option value="rejected">Rejected</option>
                    </select>
                  </div>

                  {/* Recommended By + Date */}
                  <div className="form-row">
                    <div className="form-group">
                      <Lbl>Recommended By</Lbl>
                      <SearchableSelect value={manualForm.recommendedBy} onChange={v => setMF('recommendedBy', v)}
                        options={manualRecoOpts}
                        placeholder={!manualForm.employeeId ? '— Select staff first —' : manualRecoOpts.length === 0 ? 'No recommendator configured' : '— Select Recommendator —'}
                        disabled={!manualForm.employeeId || manualRecoOpts.length === 0} showAvatar />
                    </div>
                    <div className="form-group">
                      <Lbl>Recommended Date</Lbl>
                      <LeaveDateInput value={manualForm.recommendedDate} settings={settings}
                        allowPast={isAdmin} onChange={v => setMF('recommendedDate', v)} />
                    </div>
                  </div>

                  {/* Approved By + Date */}
                  <div className="form-row">
                    <div className="form-group">
                      <Lbl required>Approved By</Lbl>
                      <div style={{ outline: manualErrors.approvedBy ? '1.5px solid #f87171' : 'none', borderRadius: 7 }}>
                      <SearchableSelect value={manualForm.approvedBy} onChange={v => { setMF('approvedBy', v); setManualErrors(p => ({ ...p, approvedBy: '' })); }}
                        options={manualApprOpts}
                        placeholder={!manualForm.employeeId ? '— Select staff first —' : manualApprOpts.length === 0 ? 'No approver configured' : '— Select Approver —'}
                        disabled={!manualForm.employeeId || manualApprOpts.length === 0} showAvatar />
                      </div>
                      <Err msg={manualErrors.approvedBy} />
                    </div>
                    <div className="form-group">
                      <Lbl>Approved Date</Lbl>
                      <LeaveDateInput value={manualForm.approvedDate} settings={settings}
                        allowPast={isAdmin} onChange={v => setMF('approvedDate', v)} />
                    </div>
                  </div>

                  <div className="modal-footer" style={{ padding:'14px 0 0', borderTop:'1px solid #e5e7eb', marginTop:4, display:'flex', justifyContent:'flex-end', alignItems:'center', gap:8 }}>
                    <LastSavedBy updatedByName={manualLastSaved?.updatedByName} updatedAt={manualLastSaved?.updatedAt} updatedDevice={manualLastSaved?.updatedDevice} fd={fd} />
                    <div style={{ display:'flex', gap:8, marginLeft:'auto' }}>
                      <button type="button" className="btn btn-outline" onClick={() => setShowManual(false)}>Cancel</button>
                      <button type="submit" className="btn btn-primary" title="Ctrl+S" style={{ background:'linear-gradient(135deg,#7c3aed,#6d28d9)' }}>
                        💾 <u>S</u>ave
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          </div>
        );
      })()}

      {manualToast && (
        <div className="toast-container">
          <div className={`toast toast-${manualToast.type}`}>
            <span>✅</span>{manualToast.msg}
          </div>
        </div>
      )}

      {/* ── Apply Modal ── */}
      {showApply && (() => {
        const days = calcDays();
        const avail = balance[applyForm.leaveTypeCode] || 0;
        const remaining = avail - days;
        const ltc = selectedLtConfig;

        const Lbl = ({ children, required }) => (
          <div style={{ fontSize:12, fontWeight:600, color:'#374151', marginBottom:4 }}>
            {children}{required && <span style={{ color:'#dc2626', marginLeft:2 }}>*</span>}
          </div>
        );
        const Err = ({ msg }) => msg ? <div style={{ fontSize:11, color:'#dc2626', marginTop:3 }}>{msg}</div> : null;

        return (
          <div className="modal-overlay">
            <div className="modal modal-lg" style={{ maxWidth:680, maxHeight:'92vh', overflowY:'auto' }}
              onClick={e => e.stopPropagation()}>

              {/* Header */}
              <div className="modal-header" style={{ position:'sticky', top:0, zIndex:10 }}>
                <h2>📝 {t('Apply for Leave')}</h2>
                <button className="modal-close" onClick={() => setShowApply(false)}>✕</button>
              </div>

              <div className="modal-body">
                {applySuccess && (
                  <div className="alert alert-success" style={{ marginBottom:14 }}>
                    <span>✅</span> {t('Application submitted successfully')}
                  </div>
                )}

                {/* ── Staff Information ── */}
                <div style={{ background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:10, padding:'12px 16px', marginBottom:18 }}>
                  <div style={{ fontSize:11, fontWeight:700, color:'#6b7280', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:10 }}>
                    👤 Staff Information
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10 }}>
                    {[
                      ['Name',       currentUser.fullName],
                      ['Staff ID',   currentUser.employeeId],
                      ['Post',       currentUser.position || '—'],
                      ['Department', currentUser.department || '—'],
                      ['Branch',     currentUser.branch || '—'],
                    ].map(([l,v]) => (
                      <div key={l}>
                        <div style={{ fontSize:10, color:'#9ca3af', marginBottom:2 }}>{l}</div>
                        <div style={{ fontSize:13, fontWeight:600, color:'#1f2937' }}>{v}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <form onSubmit={handleApplySubmit}>

                  {/* ── Leave ── */}
                  <div className="form-group">
                    <Lbl required>Leave</Lbl>
                    <select className={`form-control ${applyErrors.leaveTypeCode ? 'error' : ''}`}
                      value={applyForm.leaveTypeCode}
                      onChange={e => handleApplyChange('leaveTypeCode', e.target.value)}
                      style={{ fontSize:13 }}>
                      <option value="">— Select Leave Type —</option>
                      {ltConfigs.map(lt => {
                        const avl = balance[lt.shortName] || 0;
                        return (
                          <option key={lt.shortName} value={lt.shortName}>
                            {lt.name}  —  {avl} days remaining
                          </option>
                        );
                      })}
                    </select>
                    <Err msg={applyErrors.leaveTypeCode} />

                    {/* Leave type detail chips */}
                    {ltc && (
                      <div style={{ display:'flex', flexWrap:'wrap', gap:5, marginTop:6 }}>
                        <span style={{ fontSize:10, fontWeight:600, padding:'2px 8px', borderRadius:10,
                          background: ltc.carryForward ? '#d1fae5' : '#f3f4f6',
                          color: ltc.carryForward ? '#065f46' : '#6b7280' }}>
                          {ltc.carryForward ? '✓ Accumulated' : 'Non Accumulated'}
                        </span>
                        {ltc.reduceWeekend && <span style={{ fontSize:10, fontWeight:600, padding:'2px 8px', borderRadius:10, background:'#fef3c7', color:'#92400e' }}>Weekends deducted</span>}
                        {ltc.reducePublicHoliday && <span style={{ fontSize:10, fontWeight:600, padding:'2px 8px', borderRadius:10, background:'#fef3c7', color:'#92400e' }}>Holidays deducted</span>}
                        {ltc.provideOnlyOnBalance && <span style={{ fontSize:10, fontWeight:600, padding:'2px 8px', borderRadius:10, background:'#eff6ff', color:'#1a56db' }}>Balance required</span>}
                        {ltc.isServicePeriod && ltc.timesPerService && (
                          <span style={{ fontSize:10, fontWeight:600, padding:'2px 8px', borderRadius:10,
                            background: timesAlreadyTaken >= ltc.timesPerService ? '#fff1f2' : '#f5f3ff',
                            color: timesAlreadyTaken >= ltc.timesPerService ? '#be123c' : '#6d28d9' }}>
                            Service: {timesAlreadyTaken}/{ltc.timesPerService} uses
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* ── Half Day toggle ── */}
                  <div style={{ marginBottom:14 }}>
                    <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', userSelect:'none' }}>
                      <input type="checkbox" checked={applyForm.halfDay}
                        onChange={e => handleApplyChange('halfDay', e.target.checked)}
                        style={{ width:15, height:15, accentColor:'#1a56db' }} />
                      <span style={{ fontSize:13, fontWeight:600, color:'#374151' }}>Half Day</span>
                      {applyForm.halfDay && <span style={{ fontSize:11, color:'#6b7280' }}>(0.5 days will be deducted)</span>}
                    </label>
                  </div>

                  {/* ── Dates ── */}
                  {applyForm.halfDay ? (
                    <div className="form-group">
                      <Lbl required>Date</Lbl>
                      <LeaveDateInput value={applyForm.fromDate} error={!!applyErrors.fromDate}
                        settings={settings}
                        onChange={v => handleApplyChange('fromDate', v)} />
                      <Err msg={applyErrors.fromDate} />
                    </div>
                  ) : (
                    <div className="form-row">
                      <div className="form-group">
                        <Lbl required>From Date</Lbl>
                        <LeaveDateInput value={applyForm.fromDate} error={!!applyErrors.fromDate}
                          settings={settings}
                          onChange={v => handleApplyChange('fromDate', v)} />
                        <Err msg={applyErrors.fromDate} />
                      </div>
                      <div className="form-group">
                        <Lbl required>To Date</Lbl>
                        <LeaveDateInput value={applyForm.toDate} error={!!applyErrors.toDate}
                          minDate={applyForm.fromDate} settings={settings}
                          onChange={v => handleApplyChange('toDate', v)} />
                        <Err msg={applyErrors.toDate} />
                      </div>
                    </div>
                  )}

                  {/* ── No. of Days (auto, disabled) ── */}
                  {(applyForm.halfDay || (applyForm.fromDate && applyForm.toDate)) && (
                    <div style={{ display:'flex', gap:10, marginBottom:14, flexWrap:'wrap' }}>
                      {/* Days box */}
                      <div style={{ flex:1, minWidth:120, background:'#eff6ff', border:'1px solid #bfdbfe',
                        borderRadius:8, padding:'10px 14px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                        <span style={{ fontSize:12, color:'#1e40af', fontWeight:600 }}>📅 No. of Days</span>
                        <input readOnly value={days} style={{ width:50, textAlign:'center', fontSize:18, fontWeight:800,
                          color:'#1a56db', background:'transparent', border:'none', outline:'none' }} />
                      </div>
                      {/* Balance box */}
                      {applyForm.leaveTypeCode && (
                        <div style={{ flex:1, minWidth:120,
                          background: remaining >= 0 ? '#f0fdf4' : '#fff5f5',
                          border:`1px solid ${remaining >= 0 ? '#86efac' : '#fca5a5'}`,
                          borderRadius:8, padding:'10px 14px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                          <span style={{ fontSize:12, fontWeight:600, color:'#374151' }}>Balance After</span>
                          <span style={{ fontSize:18, fontWeight:800, color: remaining >= 0 ? '#065f46' : '#dc2626' }}>
                            {remaining}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                  {applyErrors.days && (
                    <div className="alert alert-danger" style={{ marginBottom:12, fontSize:13 }}>
                      ⚠️ {applyErrors.days}
                    </div>
                  )}

                  {/* ── Recommendator & Approval ── */}
                  <div className="form-row" style={{ marginBottom:14 }}>
                    <div>
                      <Lbl required={applyForm.reco.length > 1}>Recommendator</Lbl>
                      {applyForm.reco.length === 0 && (
                        <div style={{ background:'#f8fafc', border:'1px solid #e5e7eb', borderRadius:8, padding:'8px 12px', minHeight:36 }}>
                          <span style={{ fontSize:13, color:'#9ca3af' }}>— Not configured —</span>
                        </div>
                      )}
                      {applyForm.reco.length === 1 && (
                        <div style={{ background:'#f0f9ff', border:'1px solid #bfdbfe', borderRadius:8, padding:'8px 12px', minHeight:36, display:'flex', alignItems:'center' }}>
                          <span style={{ background:'#eff6ff', color:'#1a56db', borderRadius:10, padding:'2px 12px', fontSize:13, fontWeight:600 }}>
                            {getEmpName(applyForm.reco[0])}
                          </span>
                        </div>
                      )}
                      {applyForm.reco.length > 1 && (
                        <>
                          <SearchableSelect value={selectedReco}
                            onChange={v => { setSelectedReco(v); setApplyErrors(p => ({ ...p, selectedReco: '' })); }}
                            options={applyForm.reco.map(id => {
                              const e = allEmployees.find(x => String(x.id) === String(id));
                              return { value: String(id), label: e ? e.fullName : getEmpName(id), sub: e ? [e.employeeId, e.position].filter(Boolean).join(' - ') : '', photo: e?.profilePhoto };
                            })}
                            placeholder="— Select Recommendator —" showAvatar />
                          <Err msg={applyErrors.selectedReco} />
                        </>
                      )}
                    </div>
                    <div>
                      <Lbl required>Approval Authority</Lbl>
                      {applyForm.approval.length === 0 && (
                        <div style={{ background:'#f8fafc', border:'1px solid #e5e7eb', borderRadius:8, padding:'8px 12px', minHeight:36 }}>
                          <span style={{ fontSize:13, color:'#9ca3af' }}>— Not configured —</span>
                        </div>
                      )}
                      {applyForm.approval.length === 0 && <Err msg={applyErrors.selectedApproval} />}
                      {applyForm.approval.length === 1 && (
                        <div style={{ background:'#f0fdf4', border:'1px solid #86efac', borderRadius:8, padding:'8px 12px', minHeight:36, display:'flex', alignItems:'center' }}>
                          <span style={{ background:'#d1fae5', color:'#065f46', borderRadius:10, padding:'2px 12px', fontSize:13, fontWeight:600 }}>
                            {getEmpName(applyForm.approval[0])}
                          </span>
                        </div>
                      )}
                      {applyForm.approval.length > 1 && (
                        <>
                          <SearchableSelect value={selectedApproval}
                            onChange={v => { setSelectedApproval(v); setApplyErrors(p => ({ ...p, selectedApproval: '' })); }}
                            options={applyForm.approval.map(id => {
                              const e = allEmployees.find(x => String(x.id) === String(id));
                              return { value: String(id), label: e ? e.fullName : getEmpName(id), sub: e ? [e.employeeId, e.position].filter(Boolean).join(' - ') : '', photo: e?.profilePhoto };
                            })}
                            placeholder="— Select Approval Authority —" showAvatar />
                          <Err msg={applyErrors.selectedApproval} />
                        </>
                      )}
                    </div>
                  </div>

                  {/* ── Remarks ── */}
                  <div className="form-group">
                    <Lbl required>Remarks</Lbl>
                    <textarea className={`form-control ${applyErrors.reason ? 'error' : ''}`}
                      rows={3} placeholder="Enter reason for leave..."
                      value={applyForm.reason}
                      onChange={e => handleApplyChange('reason', e.target.value)}
                      style={{ fontSize:13 }} />
                    <Err msg={applyErrors.reason} />
                  </div>

                  {/* ── Document Upload ── */}
                  <div className="form-group">
                    <Lbl>Document / Attachment</Lbl>
                    <label style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px',
                      border:'1.5px dashed #d1d5db', borderRadius:8, cursor:'pointer',
                      background: applyForm.document ? '#f0fdf4' : '#fafafa',
                      transition:'border .15s' }}
                      onMouseEnter={e => e.currentTarget.style.borderColor='#1a56db'}
                      onMouseLeave={e => e.currentTarget.style.borderColor='#d1d5db'}>
                      <input type="file" accept="image/*,.pdf,.doc,.docx"
                        style={{ display:'none' }}
                        onChange={e => handleApplyChange('document', e.target.files[0] || null)} />
                      <span style={{ fontSize:20 }}>{applyForm.document ? '📎' : '📄'}</span>
                      <div>
                        {applyForm.document
                          ? <><div style={{ fontSize:13, fontWeight:600, color:'#065f46' }}>{applyForm.document.name}</div>
                              <div style={{ fontSize:11, color:'#6b7280' }}>{(applyForm.document.size/1024).toFixed(1)} KB</div></>
                          : <><div style={{ fontSize:13, color:'#374151' }}>Click to upload document</div>
                              <div style={{ fontSize:11, color:'#9ca3af' }}>PDF, Word, Image — optional</div></>
                        }
                      </div>
                      {applyForm.document && (
                        <button type="button" onClick={e => { e.preventDefault(); handleApplyChange('document', null); }}
                          style={{ marginLeft:'auto', background:'none', border:'none', cursor:'pointer',
                            color:'#9ca3af', fontSize:16 }}>✕</button>
                      )}
                    </label>
                  </div>

                  <div style={{ display:'flex', gap:10, justifyContent:'flex-end', marginTop:6 }}>
                    <button type="button" className="btn btn-outline" onClick={() => setShowApply(false)}>Cancel</button>
                    <button type="submit" className="btn btn-primary" disabled={submitting || applySuccess}>
                      {submitting ? '⏳ Please wait...' : '📤 Submit Application'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Right-side detail panel — also the click destination now, with
          Add/Print always available, plus Recommend/Approve/Reject/Edit/
          Delete actions when pending, and just Delete (if authorized) once
          a decision's already been made. Same fixed-overlay convention as
          the Contact page, so the grid never shrinks/scrolls for it. */}
      {viewLeave && (() => {
        const perms = getLeaveRowPerms(viewLeave);
        const amReco = isRecommenderForLeave(viewLeave.employeeId);
        const alreadyReco = !!viewLeave.recommendedBy;
        const isOwnPendingUntouched = String(viewLeave.employeeId) === String(currentUser.id)
          && viewLeave.status === 'pending' && !viewLeave.recommendedBy;
        const canDelete = isManager || isOwnPendingUntouched;
        const decided = viewLeave.status !== 'pending';

        const printRecord = () => {
          const box = (v) => `<div style="min-height:44px; white-space:pre-wrap;">${v || ''}</div>`;
          const checkbox = (label) => `<span style="display:inline-flex;align-items:center;gap:6px;margin-right:28px;">
            <span style="display:inline-block;width:13px;height:13px;border:1.5px solid #374151;"></span>${label}</span>`;
          const statusCell = viewLeave.status === 'pending'
            ? `${checkbox('Approve')}${checkbox('Reject')}`
            : `<strong>${(viewLeave.status || '').toUpperCase()}</strong>`;

          const recoApprRow = (viewLeave.recommendedBy || viewLeave.approvedBy) ? ['Recommendator & Approval',
            `<div style="display:flex; gap:28px; flex-wrap:wrap;">
               <div><strong>Recommendator:</strong> ${viewLeave.recommendedBy ? getEmployeeName(viewLeave.recommendedBy) : '—'}</div>
               <div><strong>${viewLeave.status === 'rejected' ? 'Rejected' : 'Approval'}:</strong> ${viewLeave.approvedBy ? getEmployeeName(viewLeave.approvedBy) : '—'}</div>
             </div>`
          ] : null;

          const rows = [
            ['Staff', getEmployeeName(viewLeave.employeeId)],
            ['Leave Type', getLeaveLabel(viewLeave.leaveTypeCode)],
            ['Days', viewLeave.days],
            ['From Date', fd(viewLeave.fromDate)],
            ['To Date', fd(viewLeave.toDate)],
            ['Applied Date', fd(viewLeave.appliedDate)],
            ['Reason', box(viewLeave.reason)],
            ['Status', statusCell],
            ['Status Remarks', box(viewLeave.comment)],
            recoApprRow,
          ].filter(Boolean);
          const mainTable = `<table>${rows.map(([k, v]) => `<tr><th style="text-align:left;white-space:normal">${k}</th><td style="padding:5px 7px;border:1px solid #dedede">${v}</td></tr>`).join('')}</table>`;

          // Staff signature block, right-aligned — replaces the generic
          // Prepared/Recommend/Approved footer for this print (skipFooter
          // below) since the admin section further down already carries
          // its own, more specific signature lines.
          const staffSignature = `
            <div style="display:flex; justify-content:flex-end; margin-top:30px;">
              <div style="width:220px; text-align:center;">
                <div style="border-bottom:1.5px dotted #374151; height:28px; margin-bottom:6px;"></div>
                <div style="font-size:11px; font-weight:700; color:#374151;">Staff Signature</div>
                <div style="font-size:10px; color:#6b7280; margin-top:2px;">${leaveEmp?.position || ''}</div>
                <div style="font-size:10px; color:#6b7280; margin-top:2px;">Date: ${fd(today)}</div>
              </div>
            </div>`;

          // "For Administration Use Only" — English version of the standard
          // paper leave-form's admin section, with every configured leave
          // type's balance (not just this application's) so the approver can
          // see the full picture at a glance. Same Transferred/Assigned/
          // Taken/Balance math as LeaveCalculation.jsx's Leave Reports tab
          // (summaryRowsAll) — iterated over `ltConfigs` (the tenant's real
          // configured leave types; `leaveTypes` from the leave_types table
          // is a separate, sometimes-empty list some tenants never populate)
          // so the numbers here match what that report already shows.
          const defaultFY  = (settings.fiscalYears || []).find(f => f.isDefault) || (settings.fiscalYears || [])[0];
          const fyId       = defaultFY ? String(defaultFY.id) : null;
          const prevFYKey  = fyId ? 'prev_' + fyId : null;
          const empIdStr   = String(viewLeave.employeeId);
          let sn = 0;
          // Same Transferred/Assigned/Total/Taken/Balance math (and the same
          // "hide an untouched leave type" rule) as LeaveCalculation.jsx's
          // Leave Reports summary, so these numbers match that report
          // exactly — plus an "Applied" column (this application's own days,
          // shown only on its own leave-type row) that report doesn't need.
          const balanceRows = ltConfigs.map(lt => {
            const isThisType    = lt.shortName === viewLeave.leaveTypeCode;
            const prevYear      = fyId ? Number(leaveOpening[prevFYKey]?.[empIdStr]?.[lt.shortName] ?? 0) : 0;
            const currYear      = fyId ? Number(leaveOpening[fyId]?.[empIdStr]?.[lt.shortName] ?? 0) : 0;
            const credited      = Number(getLeaveBalance(viewLeave.employeeId)?.[lt.shortName] || 0);
            const usedApproved  = leaves
              .filter(l => String(l.employeeId) === empIdStr && l.leaveTypeCode === lt.shortName && l.status === 'approved')
              .reduce((s, l) => s + Number(l.days || 0), 0);
            const total   = prevYear + currYear + credited;
            const balance = total - usedApproved;
            if (!isThisType && prevYear === 0 && currYear === 0 && usedApproved === 0 && balance === 0) return '';
            sn++;
            const cell = 'padding:6px 8px;border:1px solid #e2e8f0;';
            const rowBg = isThisType ? '#eff6ff' : (sn % 2 === 0 ? '#f8fafc' : '#fff');
            return `<tr style="background:${rowBg};">
              <td style="${cell}">${sn}</td>
              <td style="${cell}text-align:left;">${lt.name}</td>
              <td style="${cell}">${prevYear}</td>
              <td style="${cell}">${currYear}</td>
              <td style="${cell}"><strong>${total}</strong></td>
              <td style="${cell}">${usedApproved}</td>
              <td style="${cell}"><strong>${balance}</strong></td>
              <td style="${cell}${isThisType ? 'color:#1e40af;font-weight:700;' : ''}">${isThisType ? viewLeave.days : ''}</td>
            </tr>`;
          }).join('');

          const sigLine = (label, person) => `
            ${person ? `<div style="font-size:11px; color:#374151; margin-top:14px;">
              <strong>Name:</strong> ${person.name}${person.level ? ` &nbsp;&nbsp;&nbsp; <strong>Level:</strong> ${person.level}` : ''}${person.post ? ` &nbsp;&nbsp;&nbsp; <strong>Post:</strong> ${person.post}` : ''}
            </div>` : ''}
            <div style="margin-top:${person ? 6 : 16}px; display:flex; align-items:flex-end; gap:10px;">
              <div style="flex:1; border-bottom:1.5px dotted #9ca3af;">&nbsp;</div>
              <div style="font-size:10px; color:#6b7280; white-space:nowrap;">Date: ${person?.date || '______________'}</div>
            </div>
            <div style="font-size:11px; font-weight:700; color:#1e3a8a; margin-top:2px;">${label}</div>`;

          // Once a decision's made, show the actual person + when they acted.
          // Before that, fall back to whoever's configured (Settings → Set
          // Recommendator & Approval) so a printed-and-carried pending form
          // still tells the holder who it needs to reach, even unsigned.
          const recoEmp = viewLeave.recommendedBy ? getEmployeeById(viewLeave.recommendedBy) : null;
          const apprEmp = viewLeave.approvedBy    ? getEmployeeById(viewLeave.approvedBy)    : null;
          const assignedReco = recoApprovalNamesForLeave(viewLeave.employeeId, 'reco');
          const assignedAppr = recoApprovalNamesForLeave(viewLeave.employeeId, 'approval');
          const recoPerson = recoEmp ? {
            name: getEmployeeName(viewLeave.recommendedBy), level: recoEmp.grade, post: recoEmp.position,
            date: viewLeave.recommendedAt ? formatNepalDateTime(viewLeave.recommendedAt, fd) : fd(viewLeave.recommendedDate),
          } : (assignedReco !== '—' ? { name: assignedReco, level: '', post: '', date: null } : null);
          const apprPerson = apprEmp ? {
            name: getEmployeeName(viewLeave.approvedBy), level: apprEmp.grade, post: apprEmp.position,
            date: viewLeave.approvedAt ? formatNepalDateTime(viewLeave.approvedAt, fd) : fd(viewLeave.approvedDate),
          } : (assignedAppr !== '—' ? { name: assignedAppr, level: '', post: '', date: null } : null);

          const leaveEndingDate = fd(viewLeave.toDate);

          const adminSection = `
            <div style="margin-top:26px; border:1.5px solid #cbd5e1; border-radius:10px; padding:16px 18px; background:#fcfdff;">
              <div style="font-size:12.5px; font-weight:800; color:#1e40af; text-transform:uppercase;
                letter-spacing:.5px; margin-bottom:12px; border-bottom:2px solid #1e40af; padding-bottom:7px;">
                For Administration Use Only
              </div>
              <table style="border-collapse:collapse;">
                <tr>
                  <th>SN</th>
                  <th style="text-align:left;">Leave</th>
                  <th style="text-align:left;">Transferred</th>
                  <th style="text-align:left;">Assigned</th>
                  <th style="text-align:left;">Total</th>
                  <th style="text-align:left;">Taken</th>
                  <th style="text-align:left;">Balance</th>
                  <th style="text-align:left;">Applied</th>
                </tr>
                ${balanceRows}
              </table>

              ${sigLine("Employee's Signature (Employee Administration Branch)")}

              <div style="margin-top:20px; padding-top:14px; border-top:1px dashed #cbd5e1;">
                <div style="display:flex; align-items:center; flex-wrap:wrap; gap:10px;">
                  ${checkbox('Recommended')}${checkbox('Not Recommended')}
                  <span style="font-size:10px; color:#6b7280;">Leave Ending Date: <strong style="color:#374151;">${leaveEndingDate}</strong></span>
                </div>
                <div style="margin-top:10px; font-size:10px; color:#374151;">Remarks, if any: ______________________________________________</div>
                ${sigLine('Signature of Recommendator Officer', recoPerson)}
              </div>

              <div style="margin-top:20px; padding-top:14px; border-top:1px dashed #cbd5e1;">
                <div style="display:flex; align-items:center; flex-wrap:wrap; gap:10px;">
                  ${checkbox('Approved')}${checkbox('Not Approved')}
                  <span style="font-size:10px; color:#6b7280;">Leave Ending Date: <strong style="color:#374151;">${leaveEndingDate}</strong></span>
                </div>
                ${sigLine('Signature of Approving Officer', apprPerson)}
                ${(apprPerson?.post || apprPerson?.level) ? '' : '<div style="margin-top:10px; font-size:10px; color:#374151;">Level / Post: ______________________________</div>'}
              </div>
            </div>`;

          const contentHtml = mainTable + staffSignature + adminSection;
          openPrintWindow(buildPrintDoc({ settings, language, reportTitle: 'Leave Application', contentHtml, skipFooter: true, bordered: true }));
        };

        const leaveEmp = getEmployeeById(viewLeave.employeeId);
        const leaveBalanceVal = getLeaveBalance(viewLeave.employeeId)?.[viewLeave.leaveTypeCode];
        return (
          <SidePanelShell
            icon="📅" avatarPhoto={leaveEmp?.profilePhoto}
            avatarName={getEmployeeName(viewLeave.employeeId)}
            infoLine={<InfoLine items={[
              { label:'Staff ID',   value:leaveEmp?.employeeId },
              { label:'Post',       value:leaveEmp?.position },
              { label:'Department', value:leaveEmp?.department },
              { label:'Branch',     value:leaveEmp?.branch },
            ]} />}
            subtitle={
              <div style={{
                display:'flex', alignItems:'center', flexWrap:'wrap', gap:'4px 14px',
                background:'#eff6ff', border:'1.5px solid #bfdbfe', borderRadius:8,
                padding:'8px 12px', marginTop:4,
              }}>
                <span style={{ fontSize:12, color:'#1e40af' }}>
                  {t('Applied For')}: <strong style={{ fontSize:13.5 }}>{getLeaveLabel(viewLeave.leaveTypeCode)}</strong>
                </span>
                {leaveBalanceVal != null && (
                  <span style={{ fontSize:12, color:'#1e40af' }}>
                    {t('Leave Balance')}: <strong style={{ fontSize:13.5 }}>{leaveBalanceVal}</strong>
                  </span>
                )}
              </div>
            }
            statusBadge={<StatusBadge status={viewLeave.status} />}
            onClose={() => setViewLeave(null)}
            footer={<>
              <button style={panelBtnStyle()} onClick={() => { setViewLeave(null); openApply(); }}>➕ {t('Add New')}</button>
              <button style={panelBtnStyle()} onClick={printRecord}>🖨️ Print</button>
              {!decided && canManageStaff && (
                <button style={panelBtnStyle()} onClick={() => { openEditFormLeave(viewLeave); setViewLeave(null); }}>✏️ {t('Edit')}</button>
              )}
              {canDelete && (
                <button style={panelBtnStyle('danger')} onClick={() => { setDelConfirm(viewLeave.id); setViewLeave(null); }}>🗑 {t('Delete')}</button>
              )}
              {!decided && amReco && !alreadyReco && (
                <button style={panelBtnStyle('success')} onClick={() => { setActionModal({ id:viewLeave.id, type:'recommend', leave:viewLeave }); setComment(''); setViewLeave(null); }}>👍 {t('Recommend')}</button>
              )}
              {!decided && perms.amApprover && (
                <button style={panelBtnStyle('success')} disabled={!perms.canApprove}
                  title={perms.canApprove ? '' : (perms.dualRoleBlocked
                    ? 'You are the configured recommender — a different approver must approve'
                    : 'Awaiting recommendation first')}
                  onClick={() => { if (perms.canApprove) { setActionModal({ id:viewLeave.id, type:'approve', leave:viewLeave }); setComment(''); setViewLeave(null); } }}>
                  ✓ {t('Approve')}
                </button>
              )}
              {!decided && perms.amApprover && (
                <button style={panelBtnStyle('danger')}
                  onClick={() => { setActionModal({ id:viewLeave.id, type:'reject', leave:viewLeave }); setComment(''); setViewLeave(null); }}>
                  ✗ {t('Reject')}
                </button>
              )}
            </>}
          >
            <SectionLabel>🗓️ {t('Application Details')}</SectionLabel>
            <DRowPair
              left={{ icon:'📆', label:t('From Date'), value:fd(viewLeave.fromDate) }}
              right={{ icon:'📆', label:t('To Date'),   value:fd(viewLeave.toDate) }}
            />
            <DRow icon="🗓️" label={t('Applied Date')} value={fd(viewLeave.appliedDate)} />

            <DRowBox icon="💬" label={t('Reason')} value={viewLeave.reason} />
            {viewLeave.comment && (
              <DRowBox icon="🗨️" label={t('Comment')} value={viewLeave.comment} bg="#f9fafb" border="#e5e7eb" color="#374151" />
            )}

            {(viewLeave.recommendedBy || viewLeave.approvedBy) && (
              <div style={{ marginTop:16 }}>
                <SectionLabel color="#059669">✅ {t('Recommendation & Approval Details')}</SectionLabel>
                {viewLeave.recommendedBy && (
                  <DRow icon="👍" label={t('Recommended By')}
                    value={`${getEmployeeName(viewLeave.recommendedBy)} · ${viewLeave.recommendedAt ? formatNepalDateTime(viewLeave.recommendedAt, fd) : fd(viewLeave.recommendedDate)}`} />
                )}
                {viewLeave.recommendComment && (
                  <DRowBox icon="💭" label={t('Recommend Comment')} value={viewLeave.recommendComment} bg="#f0fdf4" border="#bbf7d0" color="#059669" />
                )}
                {viewLeave.approvedBy && (
                  <DRow icon="✅" label={viewLeave.status === 'rejected' ? t('Rejected By') : t('Approved By')}
                    value={`${getEmployeeName(viewLeave.approvedBy)} · ${viewLeave.approvedAt ? formatNepalDateTime(viewLeave.approvedAt, fd) : fd(viewLeave.approvedDate)}`} />
                )}
              </div>
            )}
          </SidePanelShell>
        );
      })()}

      {/* Delete Confirm */}
      {delConfirm && (
        <div className="modal-overlay">
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h2>⚠️ {t('Delete Confirmation')}</h2><button className="modal-close" onClick={() => setDelConfirm(null)}>✕</button></div>
            <div className="modal-body"><p style={{ fontSize:14 }}>{t('Are you sure you want to delete this record?')}</p></div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setDelConfirm(null)}>{t('Cancel')}</button>
              <button className="btn btn-danger" onClick={() => {
                const id = delConfirm; setDelConfirm(null);
                deleteLeave(id).catch(err => {
                  setActionToast({ msg: err?.message || 'Delete failed', type: 'danger' });
                  setTimeout(() => setActionToast(null), 4000);
                });
              }}>🗑 {t('Delete')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Leave Approval — full-width popup instead of navigating to its own page */}
      {showLeaveApprovalModal && (
        <div className="modal-overlay" onClick={() => setShowLeaveApprovalModal(false)}>
          <div className="modal" style={{ width:'95vw', maxWidth:1400, maxHeight:'92vh' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>✅ {t('Leave Approval')}</h2>
              <button className="modal-close" onClick={() => setShowLeaveApprovalModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <LeaveApproval embedded />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/* ══════════════════════════════════════════════════
   OFFICE VISIT PANEL
══════════════════════════════════════════════════ */
const VisitPanel = () => {
  const { currentUser, isManager, canManageStaff, isAdmin } = useAuth();
  // Apply for Office Visit now opens the single, globally-shared modal (also
  // used by the floating "+" quick-action button) instead of this page's own
  // separate copy of the form — two copies had drifted out of sync before
  // (one had a real Recommendator/Approval picker, the other just showed
  // every configured person as static, unselectable chips).
  const { open: openOfficeVisitApply } = useOfficeVisitApply();
  const { t, language } = useLanguage();
  const { settings, refreshSettings } = useSettings();
  const fd = makeDateFormatter(settings);
  // Server-refused Apply/Edit save (e.g. "Already Posted leave on that day.") → popup.
  const [saveAlert, setSaveAlert] = useState(null);
  const {
    filteredVisits: officeVisits,
    // Raw, company-wide visits — needed only for the "Pending for Approvals"
    // toggle below. See LeavePanel's identical comment on allLeaves.
    officeVisits: allVisits,
    deleteVisit, addVisit, updateVisit, approveVisit, rejectVisit, recommendVisit, getEmployeeName, getEmployeeById, filteredEmployees: employees, employees: allEmployees,
  } = useData();

  const [filterStatus,   setFilterStatus]  = useState('all');
  const [showForApprovalVisit, setShowForApprovalVisit] = useState(false);
  const [selectedVisitIds, setSelectedVisitIds] = useState([]);
  const [advFilters,   setAdvFilters]   = useState({ ...DEFAULT_ADV_FILTERS });
  const [advTempF,     setAdvTempF]     = useState({ ...DEFAULT_ADV_FILTERS });
  const [advFilterOpen, setAdvFilterOpen] = useState(false);
  const setAdvTF = (key, val) => setAdvTempF(p => ({ ...p, [key]: val }));
  const openAdvFilter  = () => { setAdvTempF({ ...advFilters }); setAdvFilterOpen(true); };
  const applyAdvFilter = () => { setAdvFilters({ ...advTempF }); setAdvFilterOpen(false); };
  const resetAdvFilter = () => setAdvTempF({ ...DEFAULT_ADV_FILTERS });
  const advFilterCount = [advFilters.branches, advFilters.departments, advFilters.posts,
    advFilters.grades, advFilters.modes, advFilters.statuses, advFilters.staffIds]
    .filter(a => a.length > 0).length;
  // Ctrl+A opens Advance Search — same shortcut across every report/page
  // that has one, skipped while typing in a text field so it doesn't hijack
  // native "select all text" there.
  useEffect(() => {
    const onKey = (e) => {
      if (!e.ctrlKey || e.key.toLowerCase() !== 'a') return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
      e.preventDefault();
      setAdvTempF({ ...advFilters });
      setAdvFilterOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [advFilters]);
  const advBranchOpts = useMemo(() => (settings.branches||[]).map(b => ({ value:b.name, label:b.name })), [settings.branches]);
  const advDeptOpts   = useMemo(() => (settings.departments||[]).map(d => ({ value:d.name, label:d.name })), [settings.departments]);
  const advPostOpts   = useMemo(() => (settings.posts||[]).map(p => ({ value:p.name, label:p.name })), [settings.posts]);
  const advGradeOpts  = useMemo(() => (settings.grades||[]).map(g => ({ value:g.name, label:g.name })), [settings.grades]);
  const advModeOpts   = useMemo(() => (settings.modes||[]).map(m => ({ value:m.name, label:m.name })), [settings.modes]);
  const advStatusOpts = useMemo(() => (settings.employeeStatuses||[]).map(s => ({ value:s.name, label:s.name })), [settings.employeeStatuses]);
  const advStaffOpts  = useMemo(() => (allEmployees||[]).filter(e=>e.active).map(e => ({
    value: String(e.id),
    label: e.fullName,
    sub: [e.employeeId, e.position].filter(Boolean).join(' - '),
    photo: e.profilePhoto,
  })), [allEmployees]);
  const [viewVisit,      setViewVisit]     = useState(null);
  useEffect(() => {
    if (!viewVisit) return;
    const onKeyDown = (e) => { if (e.key === 'Escape') setViewVisit(null); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [viewVisit]);
  const [editVisit,      setEditVisit]     = useState(null); // visit being edited
  const [editVisitForm,  setEditVisitForm] = useState({});
  const [editVisitErrors,setEditVisitErrors] = useState({});
  const editVisitFormRef = useRef(null);
  /* Ctrl+S submits the Edit Visit form — same action as the Save Changes button */
  useSaveShortcut(!!editVisit, () => editVisitFormRef.current?.requestSubmit());
  // Raw-field editing — see LeavePanel's openEditFormLeave identical comment:
  // canManageStaff, or the applicant editing their own still-untouched
  // pending application.
  const openEditFormVisit = (row) => {
    const isOwnPending = String(row.employeeId) === String(currentUser.id)
      && row.status === 'pending' && !row.recommendedBy;
    if (!canManageStaff && !isOwnPending) return;
    const toDateStr = (v) => v ? String(v).split('T')[0] : '';
    setEditVisitForm({
      employeeId:      String(row.employeeId),
      officialVisit:   row.purpose || row.officialVisit || '',
      address:         row.address || row.location || '',
      description:     row.description || row.reason || '',
      fromDate:        toDateStr(row.fromDate),
      toDate:          toDateStr(row.toDate),
      status:          row.status || 'pending',
      recommendedBy:   String(row.recommendedBy || ''),
      recommendedDate: toDateStr(row.recommendedDate),
      approvedBy:      String(row.approvedBy || ''),
      approvedDate:    toDateStr(row.approvedDate) || getNepalTodayISO(), // default: today
    });
    setEditVisitErrors({});
    setEditVisit(row);
  };
  // Shared with the grid's actions column, right-click menu, and the
  // toolbar Edit button — see LeavePanel's identical canEditLeaveRow/
  // canDeleteLeaveRow comment above.
  const canEditVisitRow = (row) => {
    const isOwnPending = String(row.employeeId) === String(currentUser.id)
      && row.status === 'pending' && !row.recommendedBy;
    return canManageStaff || isOwnPending;
  };
  const canDeleteVisitRow = (row) => {
    const isOwnPendingUntouched = String(row.employeeId) === String(currentUser.id)
      && row.status === 'pending' && !row.recommendedBy;
    return isManager || isOwnPendingUntouched;
  };
  const [delConfirm,     setDelConfirm]    = useState(null);
  const { getRecoIds: getVisitRecoIds, getApprovalIds: getVisitApprovalIds, assignments: visitRecoAssignments, refresh: refreshVisitRecoApproval } = useRecoApproval();
  // Full-width popup for the Office Visit Approval page — same reasoning as
  // LeavePanel's showLeaveApprovalModal above.
  const [showVisitApprovalModal, setShowVisitApprovalModal] = useState(false);
  // Same reasoning, for the Edit Visit modal — see LeavePanel's identical effect above.
  useEffect(() => { if (editVisit) refreshVisitRecoApproval(); }, [editVisit]); // eslint-disable-line react-hooks/exhaustive-deps
  const [showManualV,    setShowManualV]   = useState(false);
  const [manualVForm,    setManualVForm]   = useState({ employeeId:'', officialVisit:'', visitType:'National', country:'', address:'', description:'', fromDate:'', toDate:'', status:'approved', recommendedBy:'', recommendedDate:'', approvedBy:'', approvedDate:'' });
  const [manualVErrors,  setManualVErrors] = useState({});
  const [manualVToast,   setManualVToast]  = useState(null);
  const manualVFormRef = useRef(null);
  // Bumped after each Ctrl+S save to force the Staff picker to remount (and
  // re-run its autoOpen) so back-to-back manual postings can be typed
  // straight in without touching the mouse — see handleMVSubmit below.
  const [manualVResetKey, setManualVResetKey] = useState(0);
  // Confirmation of the most recent save — see LeavePanel's identical
  // manualLastSaved for why this is tracked separately from manualVForm.
  const [manualVLastSaved, setManualVLastSaved] = useState(null);
  /* Ctrl+S submits the Manual Entry form — same action as the Save button */
  useSaveShortcut(showManualV, () => manualVFormRef.current?.requestSubmit());
  useEffect(() => { if (showManualV) refreshVisitRecoApproval(); }, [showManualV]); // eslint-disable-line react-hooks/exhaustive-deps
  /* ── Inline approve/reject modal ── */
  const [visitActionModal, setVisitActionModal] = useState(null);
  const [visitComment,     setVisitComment]     = useState('');
  const [visitActionToast, setVisitActionToast] = useState(null);

  /* ── Reco/approval config ── */
  const visitRecoConfig = visitRecoAssignments;
  // Manual Posting: when the chosen staff has exactly one Recommendator /
  // Approver configured, pre-select it (re-runs once visitRecoConfig refreshes).
  useEffect(() => {
    if (!showManualV || !manualVForm.employeeId) return;
    const cfg = visitRecoConfig[String(manualVForm.employeeId)] || {};
    setManualVForm(p => ({
      ...p,
      recommendedBy: p.recommendedBy || soleActiveId(cfg.reco, allEmployees),
      approvedBy:    p.approvedBy    || soleActiveId(cfg.approval, allEmployees),
    }));
  }, [showManualV, manualVForm.employeeId, visitRecoConfig]); // eslint-disable-line react-hooks/exhaustive-deps
  const isRecoCompulsoryVisit = settings.recoApprovalCompulsory || false;
  const isApproverForVisit    = (empId) => {
    const a = visitRecoConfig[String(empId)]?.approval;
    const ids = Array.isArray(a) ? a : (a ? [a] : []);
    return ids.map(String).includes(String(currentUser.id));
  };
  const isRecommenderForVisit = (empId) => {
    const r = visitRecoConfig[String(empId)]?.reco;
    const ids = Array.isArray(r) ? r : (r ? [r] : []);
    return ids.map(String).includes(String(currentUser.id));
  };
  // Whether this employee has ANY recommender configured — if not,
  // Recommendation Compulsory is unsatisfiable for them and must not block
  // their approver. Mirrors authorizeRecoAction's server-side check.
  const hasRecommenderForVisit = (empId) => {
    const r = visitRecoConfig[String(empId)]?.reco;
    const ids = Array.isArray(r) ? r : (r ? [r] : []);
    return ids.length > 0;
  };
  // Shared permission computation for one row — see getLeaveRowPerms's
  // identical comment above.
  const getVisitRowPerms = (row) => {
    const amApprover     = isApproverForVisit(row.employeeId);
    const amRecommender  = isRecommenderForVisit(row.employeeId);
    const recoConfigured = hasRecommenderForVisit(row.employeeId);
    const dualRoleBlocked = isRecoCompulsoryVisit && recoConfigured && amRecommender;
    // Server (authorizeRecoAction) never lets a non-admin act on their own application.
    const isOwnRow = !isAdmin && String(row.employeeId) === String(currentUser.id);
    const canApprove = amApprover && !isOwnRow && !dualRoleBlocked && (!isRecoCompulsoryVisit || !!row.recommendedBy || !recoConfigured);
    return { amApprover, amRecommender, canApprove, dualRoleBlocked, alreadyReco: !!row.recommendedBy };
  };
  // Names of the employee's CONFIGURED recommender(s)/approver(s) — see
  // recoApprovalNamesForLeave's identical comment above.
  const recoApprovalNamesForVisit = (empId, type) => {
    const v = visitRecoConfig[String(empId)]?.[type];
    const ids = Array.isArray(v) ? v : (v ? [v] : []);
    return ids.length ? ids.map(id => getEmployeeName(id)).join(', ') : '—';
  };

  // Avatar + name for exactly one person — see personCellForLeave's
  // identical comment above.
  const personCellForVisit = (id) => id ? (
    <span style={{ display:'flex', alignItems:'center', gap:6 }}>
      <Avatar photo={getEmployeeById(id)?.profilePhoto} name={getEmployeeName(id)} size={20} />
      <span style={{ fontSize:12, color:'#374151' }}>{getEmployeeName(id)}</span>
    </span>
  ) : <span style={{ color:'#d1d5db', fontSize:12 }}>—</span>;

  // Same "Pending for Approvals" visibility fix as the Leave section above —
  // see hasAnyRecoAssignmentLeave's comment.
  const hasAnyRecoAssignmentVisit = Object.entries(visitRecoConfig).some(([key, cfg]) => {
    if (key === '_settings') return false;
    const reco     = Array.isArray(cfg?.reco)     ? cfg.reco     : (cfg?.reco     != null ? [cfg.reco]     : []);
    const approval = Array.isArray(cfg?.approval) ? cfg.approval : (cfg?.approval != null ? [cfg.approval] : []);
    return reco.map(String).includes(String(currentUser.id)) || approval.map(String).includes(String(currentUser.id));
  });
  const pendingForApprovalCountVisit = officeVisits.filter(v =>
    v.status === 'pending' && String(v.employeeId) !== String(currentUser.id) &&
    (isRecommenderForVisit(v.employeeId) || isApproverForVisit(v.employeeId))
  ).length;

  const today = getNepalTodayISO();

  /* office visit types from settings — used by the Edit Visit modal below */
  const visitTypeOptions = useMemo(() =>
    (settings.officeVisitTypes || []).map(v => v.name || v).filter(Boolean),
  [settings.officeVisitTypes]);

  /* ── Grid data ── */
  // Newest first (by Applied Date, falling back to From Date) — same as the
  // Leave grid above.
  // "Pending for Approvals" is a separate scope, not an org-hierarchy view —
  // see LeavePanel's identical comment on allLeaves above.
  const displayVisits = (showForApprovalVisit ? allVisits : officeVisits).filter(v => {
    if (showForApprovalVisit) {
      if (String(v.employeeId) === String(currentUser.id)) return false;
      if (!isRecommenderForVisit(v.employeeId) && !isApproverForVisit(v.employeeId)) return false;
    } else if (!isManager && String(v.employeeId) !== String(currentUser.id)) {
      return false;
    }
    if (filterStatus !== 'all' && v.status !== filterStatus) return false;
    if (advFilterCount > 0) {
      const emp = getEmployeeById(v.employeeId);
      if (advFilters.branches.length     && !advFilters.branches.includes(emp?.branch))          return false;
      if (advFilters.departments.length  && !advFilters.departments.includes(emp?.department))   return false;
      if (advFilters.posts.length        && !advFilters.posts.includes(emp?.position))           return false;
      if (advFilters.grades.length       && !advFilters.grades.includes(emp?.grade))             return false;
      if (advFilters.modes.length        && !advFilters.modes.includes(emp?.mode))               return false;
      if (advFilters.statuses.length     && !advFilters.statuses.includes(emp?.status))          return false;
      if (advFilters.staffIds.length     && !advFilters.staffIds.includes(String(v.employeeId))) return false;
    }
    return true;
  }).sort((a, b) => new Date(b.appliedDate || b.fromDate) - new Date(a.appliedDate || a.fromDate)).map(v => {
    // Name-only global search — see the Leave grid.
    return { ...v, searchText: getEmployeeName(v.employeeId) || '' };
  });

  const countByStatus = s => (showForApprovalVisit ? allVisits : officeVisits).filter(v => {
    if (showForApprovalVisit) {
      return String(v.employeeId) !== String(currentUser.id)
        && (isRecommenderForVisit(v.employeeId) || isApproverForVisit(v.employeeId))
        && (s === 'all' || v.status === s);
    }
    return (!isManager ? String(v.employeeId) === String(currentUser.id) : true) && (s === 'all' || v.status === s);
  }).length;

  /* ── Bulk actions (checkbox toolbar, near Search) — see LeavePanel's
     identical comment above. ── */
  const reportBulkVisits = (results) => {
    const failed = results.filter(r => r.status === 'rejected');
    if (!failed.length) return;
    setVisitActionToast({ msg: `${failed.length} of ${results.length} not done: ${failed[0].reason?.message || 'refused'}`, type: 'danger' });
    setTimeout(() => setVisitActionToast(null), 5000);
  };
  const bulkApproveVisits = async () => {
    reportBulkVisits(await Promise.allSettled(selectedVisitIds.map(id => approveVisit(id, currentUser.id))));
    setSelectedVisitIds([]);
  };
  const bulkRejectVisits = async () => {
    reportBulkVisits(await Promise.allSettled(selectedVisitIds.map(id => rejectVisit(id, currentUser.id, 'Declined'))));
    setSelectedVisitIds([]);
  };
  const bulkDeleteVisits = async () => {
    if (!confirm(t('Are you sure you want to delete this record?'))) return;
    reportBulkVisits(await Promise.allSettled(selectedVisitIds.map(id => deleteVisit(id))));
    setSelectedVisitIds([]);
  };

  const columns = [
    { field: 'staffId',     header: 'Staff ID',         width: 90, render: (_, row) => (
        <span style={{ color:'#6b7280' }}>{getEmployeeById(row.employeeId)?.employeeId || '—'}</span>
      ) },
    { field: 'employeeId',  header: t('Name'),          width: 150, render: v => (
        <span style={{ display:'flex', alignItems:'center', gap:6, fontWeight:600 }}>
          <Avatar photo={getEmployeeById(v)?.profilePhoto} name={getEmployeeName(v)} size={22} />
          {getEmployeeName(v)}
        </span>
      ) },
    { field: 'purpose',     header: 'Official Visit',   width: 150 },
    { field: 'fromDate',    header: t('From Date'),     width: 110, render: v => fd(v) },
    { field: 'toDate',      header: t('To Date'),       width: 110, render: v => fd(v) },
    { field: 'appliedDate', header: t('Applied Date'),  width: 110, render: v => fd(v) },
    { field: 'status',      header: t('Status'),        width: 110, render: v => <StatusBadge status={v} /> },
    // Only the one recommender/approver this application actually names —
    // see the identical Leave columns' comment above.
    { field: 'recommendatorNames', header: 'Recommendator', width: 150, sortable:false, filterable:false,
      // Pending with nobody named → configured recommender/approver (see Leave grid).
      render: (_, row) => personCellForVisit(row.recommendedBy || row.recoId || (row.status === 'pending' ? [].concat(visitRecoConfig[String(row.employeeId)]?.reco || [])[0] : null)) },
    { field: 'approvalNames', header: 'Approval', width: 150, sortable:false, filterable:false,
      render: (_, row) => personCellForVisit(row.approvedBy || row.approvalId || (row.status === 'pending' ? [].concat(visitRecoConfig[String(row.employeeId)]?.approval || [])[0] : null)) },
  ];

  /* ── OV rejection notifications ── */
  const OV_ACK_KEY = 'ehajiri_ack_ov_rejections';
  const ovAckedIds = useMemo(() => {
    try { return new Set(JSON.parse(localStorage.getItem(OV_ACK_KEY) || '[]')); } catch { return new Set(); }
  }, []);
  const ovRejectedNotifications = useMemo(() =>
    officeVisits.filter(v =>
      String(v.employeeId) === String(currentUser.id) &&
      v.status === 'rejected' &&
      !ovAckedIds.has(String(v.id))
    ),
  [officeVisits, currentUser.id, ovAckedIds]);
  const dismissOVNotification = (id) => {
    const next = [...ovAckedIds, String(id)];
    localStorage.setItem(OV_ACK_KEY, JSON.stringify(next));
    ovAckedIds.add(String(id));
  };

  return (
    <div>
      <AlertPopup alert={saveAlert} onClose={() => setSaveAlert(null)} />
      {/* ── OV Rejection Notifications ── */}
      {ovRejectedNotifications.map(v => (
        <div key={v.id} style={{ display:'flex', alignItems:'flex-start', gap:12, background:'#fef2f2',
          border:'1px solid #fca5a5', borderRadius:10, padding:'12px 16px', marginBottom:12 }}>
          <span style={{ fontSize:22, flexShrink:0 }}>❌</span>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:14, fontWeight:700, color:'#991b1b', marginBottom:4 }}>
              Your office visit application was rejected
            </div>
            <div style={{ fontSize:13, color:'#374151' }}>
              <strong>{v.purpose || v.officialVisit}</strong> — {v.fromDate} to {v.toDate}
            </div>
            {v.comment && (
              <div style={{ fontSize:13, color:'#7f1d1d', marginTop:4, background:'#fff5f5',
                borderRadius:6, padding:'6px 10px', border:'1px solid #fecaca' }}>
                💬 <strong>Reason:</strong> {v.comment}
              </div>
            )}
            {v.approvedBy && (
              <div style={{ fontSize:11, color:'#9ca3af', marginTop:4 }}>
                Rejected by: {getEmployeeName(v.approvedBy)} {v.approvedDate ? `on ${v.approvedDate}` : ''}
              </div>
            )}
          </div>
          <button onClick={() => dismissOVNotification(v.id)}
            style={{ background:'none', border:'none', cursor:'pointer', color:'#9ca3af', fontSize:18, flexShrink:0 }}
            title="Dismiss">×</button>
        </div>
      ))}

      {/* Sub-header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14, flexWrap:'wrap', gap:8 }}>
        <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
          {['all','pending','approved','rejected'].map(s => (
            <button key={s} onClick={() => setFilterStatus(s)}
              className={`btn btn-sm ${filterStatus===s ? 'btn-primary' : 'btn-outline'}`}>
              {s==='all' ? t('All') : s==='pending' ? t('Pending') : s==='approved' ? t('Approved') : t('Rejected')}
              <span style={{ marginLeft:4, background:'rgba(0,0,0,.1)', borderRadius:10, padding:'1px 6px', fontSize:11 }}>
                {countByStatus(s)}
              </span>
            </button>
          ))}
        </div>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          {(isManager || hasAnyRecoAssignmentVisit) && (
            <button className={`btn btn-sm ${showForApprovalVisit ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => {
                // Same as LeavePanel's identical button — a configured
                // recommender/approver gets the inline toggle, everyone else
                // gets the fuller oversight view as a full-width popup
                // instead of navigating to its own page.
                if (hasAnyRecoAssignmentVisit) setShowForApprovalVisit(v => !v);
                else setShowVisitApprovalModal(true);
              }}>
              ✅ {hasAnyRecoAssignmentVisit
                ? `Pending for Approvals${pendingForApprovalCountVisit ? ` (${pendingForApprovalCountVisit})` : ''}`
                : t('Visit Approval')}
            </button>
          )}
          {canManageStaff && (
            <button className="btn btn-sm" onClick={() => { setManualVForm({ employeeId:'', officialVisit:'', visitType:'National', country:'', address:'', description:'', fromDate:today, toDate:today, status:'approved', recommendedBy:'', recommendedDate:'', approvedBy:'', approvedDate:today }); setManualVErrors({}); setManualVLastSaved(null); setShowManualV(true); }}
              style={{ background:'linear-gradient(135deg,#7c3aed,#6d28d9)', color:'white', border:'none', borderRadius:6, padding:'5px 12px', fontSize:12, fontWeight:700, cursor:'pointer' }}>
              ✍️ Manual Posting
            </button>
          )}
          <button className="btn btn-primary btn-sm" onClick={() => openOfficeVisitApply()}>
            + {t('Apply for Office Visit')}
          </button>
        </div>
      </div>

      <DataGrid columns={columns} data={displayVisits} extraSearchFields={['searchText']} searchOnlyExtraFields defaultPageSize={20} pageSizeOptions={[5, 10, 20, 50, 100]} showSearch searchPlaceholder={t('Search') + '...'}
        showFilterButton={false}
        toolbarRightInset={viewVisit ? 456 : 0}
        onRowClick={row => setViewVisit(v => v?.id === row.id ? null : row)}
        onFocusChange={row => setViewVisit(row)}
        onSelectionChange={setSelectedVisitIds}
        contextMenu={[
          { label: t('Add New'), icon:'➕', onClick: () => openOfficeVisitApply() },
          'divider',
          { label: t('Edit'), icon:'✏️', onClick: (row) => { if (canEditVisitRow(row)) openEditFormVisit(row); } },
          'divider',
          { label: t('Delete'), icon:'🗑', className:'danger', onClick: (row) => { if (canDeleteVisitRow(row)) setDelConfirm(row.id); } },
        ]}
        toolbar={
          <div style={{ display:'flex', gap:8 }}>
            <button className="dg-filter-btn" onClick={openAdvFilter}>
              <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
                <path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L12 11.414V15a1 1 0 01-.293.707l-2 2A1 1 0 018 17v-5.586L3.293 6.707A1 1 0 013 6V3z" clipRule="evenodd"/>
              </svg>
              {t('Advance Search')}{advFilterCount > 0 ? ` (${advFilterCount})` : ''}
            </button>
            {showForApprovalVisit && (
              <>
                <button className="btn btn-sm btn-success" disabled={!selectedVisitIds.length} onClick={bulkApproveVisits}
                  style={{ opacity: selectedVisitIds.length ? 1 : 0.45, cursor: selectedVisitIds.length ? 'pointer' : 'not-allowed' }}>
                  ✓ {t('Approve')} {selectedVisitIds.length ? `(${selectedVisitIds.length})` : ''}
                </button>
                <button className="btn btn-sm btn-danger" disabled={!selectedVisitIds.length} onClick={bulkRejectVisits}
                  style={{ opacity: selectedVisitIds.length ? 1 : 0.45, cursor: selectedVisitIds.length ? 'pointer' : 'not-allowed' }}>
                  ✗ {t('Reject')} {selectedVisitIds.length ? `(${selectedVisitIds.length})` : ''}
                </button>
              </>
            )}
            <button className="btn btn-sm btn-outline" disabled={selectedVisitIds.length !== 1}
              onClick={() => { const row = displayVisits.find(v => v.id === selectedVisitIds[0]); if (row) openEditFormVisit(row); }}
              style={{ opacity: selectedVisitIds.length === 1 ? 1 : 0.45, cursor: selectedVisitIds.length === 1 ? 'pointer' : 'not-allowed' }}>
              ✏️ {t('Edit')}
            </button>
            <button className="btn btn-sm btn-outline" disabled={!selectedVisitIds.length} onClick={bulkDeleteVisits}
              style={{ opacity: selectedVisitIds.length ? 1 : 0.45, cursor: selectedVisitIds.length ? 'pointer' : 'not-allowed' }}>
              🗑 {t('Delete')} {selectedVisitIds.length ? `(${selectedVisitIds.length})` : ''}
            </button>
          </div>
        }
      />

      <LeaveAdvancedFilter
        isOpen={advFilterOpen} onClose={() => setAdvFilterOpen(false)}
        onApply={applyAdvFilter} onReset={resetAdvFilter}
        tempF={advTempF} setTF={setAdvTF}
        branchOpts={advBranchOpts} deptOpts={advDeptOpts} postOpts={advPostOpts}
        gradeOpts={advGradeOpts}   modeOpts={advModeOpts}  statusOpts={advStatusOpts}
        staffOpts={advStaffOpts}
        showFY={false} showAccum={false} showLeave={false} L={(np, en) => language === 'np' ? np : en}
      />

      {/* ── Inline Approve / Reject Modal (Office Visit) ── */}
      {visitActionModal && (
        <div className="modal-overlay">
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>
                {visitActionModal.type === 'recommend' ? `👍 ${t('Recommend')}` : visitActionModal.type === 'approve' ? `✅ ${t('Approve')}` : `❌ ${t('Reject')}`} — {t('Office Visit Application')}
              </h2>
              <button className="modal-close" onClick={() => setVisitActionModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ background:'#f9fafb', borderRadius:8, padding:12, marginBottom:14, fontSize:13 }}>
                <div style={{ fontWeight:700, color:'#111827' }}>{getEmployeeName(visitActionModal.visit.employeeId)}</div>
                <div style={{ color:'#374151', marginTop:2 }}>{visitActionModal.visit.purpose || visitActionModal.visit.officialVisit}</div>
                <div style={{ color:'#6b7280' }}>{visitActionModal.visit.fromDate} – {visitActionModal.visit.toDate}</div>
                {visitActionModal.visit.recommendedBy && (
                  <div style={{ marginTop:5 }}>
                    <span style={{ fontSize:11, background:'#d1fae5', color:'#065f46', borderRadius:8, padding:'2px 8px', fontWeight:700 }}>
                      ✓ Recommended by {getEmployeeName(visitActionModal.visit.recommendedBy)}
                    </span>
                  </div>
                )}
              </div>
              <div className="form-group">
                <label className="form-label">{t('Comment')} ({t('Optional')})</label>
                <textarea className="form-control" rows={3} placeholder={t('Enter comment')}
                  value={visitComment} onChange={e => setVisitComment(e.target.value)}
                  style={{ fontSize:13 }} autoFocus />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setVisitActionModal(null)}>{t('Cancel')}</button>
              <button
                className={`btn ${visitActionModal.type === 'reject' ? 'btn-danger' : 'btn-success'}`}
                onClick={async () => {
                  const { id, type } = visitActionModal;
                  setVisitActionModal(null); setVisitComment('');
                  // See the leave action modal — show a server refusal, not a false success.
                  try {
                    if (type === 'recommend')     await recommendVisit(id, currentUser.id, visitComment);
                    else if (type === 'approve')  await approveVisit(id, currentUser.id, visitComment);
                    else                          await rejectVisit(id, currentUser.id, visitComment);
                    setVisitActionToast({
                      msg: type === 'recommend' ? t('Application recommended') : type === 'approve' ? t('Application approved') : t('Application rejected'),
                      type: type === 'reject' ? 'danger' : 'success',
                    });
                  } catch (err) {
                    setVisitActionToast({ msg: err?.message || 'Action failed', type: 'danger' });
                  }
                  setTimeout(() => setVisitActionToast(null), 4000);
                }}>
                {visitActionModal.type === 'recommend' ? `👍 ${t('Recommend')}` : visitActionModal.type === 'approve' ? `✅ ${t('Approve')}` : `❌ ${t('Reject')}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {visitActionToast && (
        <div className="toast-container">
          <div className={`toast toast-${visitActionToast.type}`}>
            <span>{visitActionToast.type === 'success' ? '✅' : '❌'}</span>{visitActionToast.msg}
          </div>
        </div>
      )}

      {/* ── Manual Posting Modal (Office Visit) ── */}
      {showManualV && (() => {
        // picking From Date copies it into To Date
        const setMV = (f, v) => setManualVForm(p => ({ ...p, [f]: v, ...(f === 'fromDate' ? { toDate: v } : {}) }));

        const validateMV = () => {
          const e = {};
          if (!manualVForm.employeeId)     e.employeeId     = t('Required field');
          // Approved By is compulsory for every Manual Posting.
          if (manualVForm.employeeId && !manualVForm.approvedBy)
            e.approvedBy = manualVApprOpts.length === 0 ? 'No approver configured for this staff — set it in Staff Detail → Set Recommendator & Approval' : t('Required field');
          if (!manualVForm.officialVisit.trim()) e.officialVisit = t('Required field');
          if (!manualVForm.address.trim()) e.address        = t('Required field');
          if (!manualVForm.fromDate)       e.fromDate       = t('Required field');
          if (!manualVForm.toDate)         e.toDate         = t('Required field');
          if (manualVForm.fromDate && manualVForm.toDate && manualVForm.toDate < manualVForm.fromDate)
            e.toDate = 'To Date must be on or after From Date';
          if (manualVForm.visitType === 'International' && !manualVForm.country.trim())
            e.country = t('Required field');
          return e;
        };
        const handleMVSubmit = async (ev) => {
          ev.preventDefault();
          const errs = validateMV();
          if (Object.keys(errs).length) { setManualVErrors(errs); return; }
          const savedDevice = getDeviceInfo();
          try {
          await addVisit({
            employeeId:      manualVForm.employeeId,
            purpose:         manualVForm.officialVisit,
            officialVisit:   manualVForm.officialVisit,
            visitType:       manualVForm.visitType,
            country:         manualVForm.visitType === 'International' ? manualVForm.country : '',
            address:         manualVForm.address,
            location:        manualVForm.address,
            description:     manualVForm.description,
            reason:          manualVForm.description,
            fromDate:        manualVForm.fromDate,
            toDate:          manualVForm.toDate,
            status:          manualVForm.status,
            appliedDate:     today,
            isManual:        true,
            recommendedBy:   manualVForm.recommendedBy   || null,
            recommendedDate: manualVForm.recommendedDate || null,
            approvedBy:      manualVForm.approvedBy      || null,
            approvedDate:    manualVForm.approvedDate     || null,
            deviceInfo:      savedDevice,
          }, { throwOnReject: true });
          } catch (err) {
            // Server refused it — nothing was saved; keep the form as entered.
            setSaveAlert(alertFromSaveError(err, fd));
            return;
          }
          // Stay on the form for back-to-back manual postings instead of
          // closing — clear the fields and reopen the Staff picker ready for
          // the next entry.
          setManualVForm({ employeeId:'', officialVisit:'', visitType:'National', country:'', address:'', description:'', fromDate:today, toDate:today, status:'approved', recommendedBy:'', recommendedDate:'', approvedBy:'', approvedDate:today });
          setManualVErrors({});
          setManualVResetKey(k => k + 1);
          setManualVLastSaved({ updatedByName: currentUser.fullName, updatedAt: new Date().toISOString(), updatedDevice: savedDevice });
          setManualVToast({ msg:'Office visit entry posted manually', type:'success' });
          setTimeout(() => setManualVToast(null), 2500);
        };

        const Lbl = ({ children, required }) => (
          <div style={{ fontSize:12, fontWeight:600, color:'#374151', marginBottom:4 }}>
            {children}{required && <span style={{ color:'#dc2626', marginLeft:2 }}>*</span>}
          </div>
        );
        const Err = ({ msg }) => msg ? <div style={{ fontSize:11, color:'#dc2626', marginTop:3 }}>{msg}</div> : null;
        const activeEmps = allEmployees.filter(e => e.active !== false)
          .sort((a, b) => staffRankCompare(a, b, settings));
        /* only staff configured (Staff Detail → Set Recommendator & Approval) for this employee */
        const manualVCfg    = visitRecoConfig[String(manualVForm.employeeId)] || {};
        const toIdsV         = (v) => (Array.isArray(v) ? v : (v ? [v] : [])).map(String);
        const manualVRecoIds = toIdsV(manualVCfg.reco);
        const manualVApprIds = toIdsV(manualVCfg.approval);
        const manualVRecoOpts = activeEmps.filter(e => manualVRecoIds.includes(String(e.id))).map(e => ({ value: String(e.id), label: e.fullName, sub: [e.employeeId, e.position].filter(Boolean).join(' - '), photo: e.profilePhoto }));
        const manualVApprOpts = activeEmps.filter(e => manualVApprIds.includes(String(e.id))).map(e => ({ value: String(e.id), label: e.fullName, sub: [e.employeeId, e.position].filter(Boolean).join(' - '), photo: e.profilePhoto }));
        const visitTypeOpts = (settings.officeVisitTypes || []).map(v => v.name || v).filter(Boolean);
        // Staff field scoped to who this user may post on behalf of (see the
        // matching comment in the Leave Manual Posting modal above) — the
        // recommender/approver options above intentionally stay unscoped.
        const scopedEmps = employees.filter(e => e.active !== false)
          .sort((a, b) => staffRankCompare(a, b, settings));
        const empOpts = scopedEmps.map(e => ({
          value: String(e.id),
          label: e.fullName,
          sub: [e.employeeId, e.position || e.department].filter(Boolean).join(' - '),
          photo: e.profilePhoto,
        }));

        return (
          <div className="modal-overlay">
            <div className="modal modal-lg" style={{ maxWidth:660, maxHeight:'90vh', overflowY:'auto' }}
              onClick={e => e.stopPropagation()}>
              <div className="modal-header" style={{ position:'sticky', top:0, zIndex:10 }}>
                <h2>✍️ Manual Office Visit Posting</h2>
                <button className="modal-close" onClick={() => setShowManualV(false)}>✕</button>
              </div>
              <div className="modal-body">
                <div style={{ background:'#fef3c7', border:'1px solid #fde68a', borderRadius:8, padding:'8px 12px', marginBottom:14, fontSize:12, color:'#92400e' }}>
                  ⚠️ Manual posting bypasses the normal workflow. Use for correcting records or back-dated entries.
                </div>
                <form ref={manualVFormRef} onSubmit={handleMVSubmit}>
                  {/* Staff */}
                  <div className="form-group">
                    <Lbl required>Staff</Lbl>
                    <div style={{ outline: manualVErrors.employeeId ? '1.5px solid #f87171' : 'none', borderRadius: 7 }}>
                      <SearchableSelect key={manualVResetKey} autoOpen={manualVResetKey > 0} value={manualVForm.employeeId}
                        onChange={v => setManualVForm(p => ({ ...p, employeeId: v, recommendedBy: '', approvedBy: '' }))}
                        options={empOpts} placeholder="— Search & Select Staff —" showAvatar />
                    </div>
                    <Err msg={manualVErrors.employeeId} />
                  </div>

                  {/* Official Visit */}
                  <div className="form-group">
                    <Lbl required>Official Visit</Lbl>
                    {visitTypeOpts.length > 0
                      ? <div style={{ outline: manualVErrors.officialVisit ? '1.5px solid #f87171' : 'none', borderRadius: 7 }}>
                          <SearchableSelect value={manualVForm.officialVisit} onChange={v => setMV('officialVisit', v)}
                            options={visitTypeOpts.map(vt => ({ value: vt, label: vt }))}
                            placeholder="— Select Visit Type —" />
                        </div>
                      : <input type="text" className={`form-control ${manualVErrors.officialVisit ? 'error' : ''}`}
                          placeholder="Enter visit name..." value={manualVForm.officialVisit}
                          onChange={e => setMV('officialVisit', e.target.value)} style={{ fontSize:13 }} />
                    }
                    <Err msg={manualVErrors.officialVisit} />
                  </div>

                  {/* Visit Type */}
                  <div className="form-group">
                    <Lbl required>Visit Type</Lbl>
                    <div style={{ display:'flex', gap:10 }}>
                      {['National','International'].map(vt => (
                        <label key={vt} style={{ display:'flex', alignItems:'center', gap:7, cursor:'pointer', userSelect:'none',
                          padding:'7px 16px', border:`1.5px solid ${manualVForm.visitType===vt?'#1a56db':'#d1d5db'}`,
                          borderRadius:8, background: manualVForm.visitType===vt?'#eff6ff':'white',
                          fontSize:13, fontWeight: manualVForm.visitType===vt?700:400,
                          color: manualVForm.visitType===vt?'#1a56db':'#374151' }}>
                          <input type="radio" name="mvVisitType" value={vt}
                            checked={manualVForm.visitType===vt} onChange={() => setMV('visitType', vt)}
                            style={{ accentColor:'#1a56db' }} />
                          {vt==='National'?'🇳🇵 National':'🌍 International'}
                        </label>
                      ))}
                    </div>
                  </div>

                  {manualVForm.visitType === 'International' && (
                    <div className="form-group">
                      <Lbl required>Country</Lbl>
                      <input type="text" className={`form-control ${manualVErrors.country ? 'error' : ''}`}
                        placeholder="Enter country name..." value={manualVForm.country}
                        onChange={e => setMV('country', e.target.value)} style={{ fontSize:13 }} />
                      <Err msg={manualVErrors.country} />
                    </div>
                  )}

                  {/* Address */}
                  <div className="form-group">
                    <Lbl required>Address</Lbl>
                    <input type="text" className={`form-control ${manualVErrors.address ? 'error' : ''}`}
                      placeholder="Enter visit address..." value={manualVForm.address}
                      onChange={e => setMV('address', e.target.value)} style={{ fontSize:13 }} />
                    <Err msg={manualVErrors.address} />
                  </div>

                  {/* Description */}
                  <div className="form-group">
                    <Lbl>Description</Lbl>
                    <textarea className="form-control" rows={2}
                      placeholder="Enter description..." value={manualVForm.description}
                      onChange={e => setMV('description', e.target.value)} style={{ fontSize:13 }} />
                  </div>

                  {/* Dates */}
                  <div className="form-row">
                    <div className="form-group">
                      <Lbl required>From Date</Lbl>
                      <LeaveDateInput value={manualVForm.fromDate} error={!!manualVErrors.fromDate}
                        settings={settings} allowPast={isAdmin} onChange={v => setMV('fromDate', v)} />
                      <Err msg={manualVErrors.fromDate} />
                    </div>
                    <div className="form-group">
                      <Lbl required>To Date</Lbl>
                      <LeaveDateInput value={manualVForm.toDate} error={!!manualVErrors.toDate}
                        minDate={manualVForm.fromDate} settings={settings} allowPast={isAdmin} onChange={v => setMV('toDate', v)} />
                      <Err msg={manualVErrors.toDate} />
                    </div>
                  </div>

                  {/* Status */}
                  <div className="form-group">
                    <Lbl required>Status</Lbl>
                    <select value={manualVForm.status} onChange={e => setMV('status', e.target.value)}
                      className="form-control" style={{ fontSize:13 }}>
                      <option value="approved">Approved</option>
                      <option value="pending">Pending</option>
                      <option value="rejected">Rejected</option>
                    </select>
                  </div>

                  {/* Recommended By + Date */}
                  <div className="form-row">
                    <div className="form-group">
                      <Lbl>Recommended By</Lbl>
                      <SearchableSelect value={manualVForm.recommendedBy} onChange={v => setMV('recommendedBy', v)}
                        options={manualVRecoOpts}
                        placeholder={!manualVForm.employeeId ? '— Select staff first —' : manualVRecoOpts.length === 0 ? 'No recommendator configured' : '— Select Recommendator —'}
                        disabled={!manualVForm.employeeId || manualVRecoOpts.length === 0} showAvatar />
                    </div>
                    <div className="form-group">
                      <Lbl>Recommended Date</Lbl>
                      <LeaveDateInput value={manualVForm.recommendedDate} settings={settings}
                        allowPast={isAdmin} onChange={v => setMV('recommendedDate', v)} />
                    </div>
                  </div>

                  {/* Approved By + Date */}
                  <div className="form-row">
                    <div className="form-group">
                      <Lbl required>Approved By</Lbl>
                      <div style={{ outline: manualVErrors.approvedBy ? '1.5px solid #f87171' : 'none', borderRadius: 7 }}>
                      <SearchableSelect value={manualVForm.approvedBy} onChange={v => { setMV('approvedBy', v); setManualVErrors(p => ({ ...p, approvedBy: '' })); }}
                        options={manualVApprOpts}
                        placeholder={!manualVForm.employeeId ? '— Select staff first —' : manualVApprOpts.length === 0 ? 'No approver configured' : '— Select Approver —'}
                        disabled={!manualVForm.employeeId || manualVApprOpts.length === 0} showAvatar openUp />
                      </div>
                      <Err msg={manualVErrors.approvedBy} />
                    </div>
                    <div className="form-group">
                      <Lbl>Approved Date</Lbl>
                      <LeaveDateInput value={manualVForm.approvedDate} settings={settings}
                        allowPast={isAdmin} onChange={v => setMV('approvedDate', v)} />
                    </div>
                  </div>

                  <div className="modal-footer" style={{ padding:'14px 0 0', borderTop:'1px solid #e5e7eb', marginTop:4, display:'flex', justifyContent:'flex-end', alignItems:'center', gap:8 }}>
                    <LastSavedBy updatedByName={manualVLastSaved?.updatedByName} updatedAt={manualVLastSaved?.updatedAt} updatedDevice={manualVLastSaved?.updatedDevice} fd={fd} />
                    <div style={{ display:'flex', gap:8, marginLeft:'auto' }}>
                      <button type="button" className="btn btn-outline" onClick={() => setShowManualV(false)}>Cancel</button>
                      <button type="submit" className="btn btn-primary" title="Ctrl+S" style={{ background:'linear-gradient(135deg,#7c3aed,#6d28d9)' }}>
                        💾 <u>S</u>ave
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          </div>
        );
      })()}

      {manualVToast && (
        <div className="toast-container">
          <div className={`toast toast-${manualVToast.type}`}>
            <span>{manualVToast.type === 'error' ? '⚠️' : '✅'}</span>{manualVToast.msg}
          </div>
        </div>
      )}

      {/* Right-side detail panel — also the click destination now, with
          Add/Print always available, plus Recommend/Approve/Reject/Edit/
          Delete actions when pending, and just Delete (if authorized) once
          a decision's already been made. Same fixed-overlay convention as
          the Contact page, so the grid never shrinks/scrolls for it. */}
      {viewVisit && (() => {
        const perms = getVisitRowPerms(viewVisit);
        const amReco = isRecommenderForVisit(viewVisit.employeeId);
        const alreadyReco = !!viewVisit.recommendedBy;
        const isOwnPendingUntouched = String(viewVisit.employeeId) === String(currentUser.id)
          && viewVisit.status === 'pending' && !viewVisit.recommendedBy;
        const canDelete = isManager || isOwnPendingUntouched;
        const decided = viewVisit.status !== 'pending';

        const printRecord = () => {
          const rows = [
            ['Staff', getEmployeeName(viewVisit.employeeId)],
            ['Staff ID', getEmployeeById(viewVisit.employeeId)?.employeeId || '—'],
            ['Official Visit', viewVisit.officialVisit || viewVisit.purpose || '—'],
            ['Visit Type', viewVisit.visitType || 'National'],
            ['Country', viewVisit.visitType === 'International' ? (viewVisit.country || '—') : 'Nepal'],
            ['Address', viewVisit.address || viewVisit.location || '—'],
            ['From Date', fd(viewVisit.fromDate)],
            ['To Date', fd(viewVisit.toDate)],
            ['Applied Date', fd(viewVisit.appliedDate)],
            ['Status', viewVisit.status],
            ['Description', viewVisit.description || viewVisit.reason || '—'],
            viewVisit.comment && ['Comment', viewVisit.comment],
            viewVisit.recommendedBy && ['Recommended By', getEmployeeName(viewVisit.recommendedBy)],
            viewVisit.approvedBy && [viewVisit.status === 'rejected' ? 'Rejected By' : 'Approved By', getEmployeeName(viewVisit.approvedBy)],
          ].filter(Boolean);
          const contentHtml = `<table>${rows.map(([k, v]) => `<tr><th style="text-align:left;white-space:normal">${k}</th><td style="padding:5px 7px;border:1px solid #dedede">${v}</td></tr>`).join('')}</table>`;
          openPrintWindow(buildPrintDoc({ settings, language, reportTitle: 'Office Visit Application', contentHtml }));
        };

        const visitEmp = getEmployeeById(viewVisit.employeeId);
        return (
          <SidePanelShell
            icon="🏢" avatarPhoto={visitEmp?.profilePhoto}
            avatarName={getEmployeeName(viewVisit.employeeId)}
            infoLine={<InfoLine items={[
              { label:'Staff ID',   value:visitEmp?.employeeId },
              { label:'Post',       value:visitEmp?.position },
              { label:'Department', value:visitEmp?.department },
              { label:'Branch',     value:visitEmp?.branch },
            ]} />}
            subtitle={
              <div style={{
                display:'flex', alignItems:'center', flexWrap:'wrap', gap:'4px 14px',
                background:'#eff6ff', border:'1.5px solid #bfdbfe', borderRadius:8,
                padding:'8px 12px', marginTop:4,
              }}>
                <span style={{ fontSize:12, color:'#1e40af' }}>
                  {t('Official Visit')}: <strong style={{ fontSize:13.5 }}>{viewVisit.officialVisit || viewVisit.purpose || '—'}</strong>
                </span>
              </div>
            }
            statusBadge={<StatusBadge status={viewVisit.status} />}
            onClose={() => setViewVisit(null)}
            footer={<>
              <button style={panelBtnStyle()} onClick={() => { setViewVisit(null); openOfficeVisitApply(); }}>➕ {t('Add New')}</button>
              <button style={panelBtnStyle()} onClick={printRecord}>🖨️ Print</button>
              {!decided && canManageStaff && (
                <button style={panelBtnStyle()} onClick={() => { openEditFormVisit(viewVisit); setViewVisit(null); }}>✏️ {t('Edit')}</button>
              )}
              {canDelete && (
                <button style={panelBtnStyle('danger')} onClick={() => { setDelConfirm(viewVisit.id); setViewVisit(null); }}>🗑 {t('Delete')}</button>
              )}
              {!decided && amReco && !alreadyReco && (
                <button style={panelBtnStyle('success')} onClick={() => { setVisitActionModal({ id:viewVisit.id, type:'recommend', visit:viewVisit }); setVisitComment(''); setViewVisit(null); }}>👍 {t('Recommend')}</button>
              )}
              {!decided && perms.amApprover && (
                <button style={panelBtnStyle('success')} disabled={!perms.canApprove}
                  title={perms.canApprove ? '' : (perms.dualRoleBlocked
                    ? 'You are the configured recommender — a different approver must approve'
                    : 'Awaiting recommendation first')}
                  onClick={() => { if (perms.canApprove) { setVisitActionModal({ id:viewVisit.id, type:'approve', visit:viewVisit }); setVisitComment(''); setViewVisit(null); } }}>
                  ✓ {t('Approve')}
                </button>
              )}
              {!decided && perms.amApprover && (
                <button style={panelBtnStyle('danger')}
                  onClick={() => { setVisitActionModal({ id:viewVisit.id, type:'reject', visit:viewVisit }); setVisitComment(''); setViewVisit(null); }}>
                  ✗ {t('Reject')}
                </button>
              )}
            </>}
          >
            <SectionLabel>🗓️ {t('Application Details')}</SectionLabel>
            <DRowPair
              left={{ icon: viewVisit.visitType==='International'?'🌍':'🇳🇵', label:'Visit Type', value: viewVisit.visitType || 'National' }}
              right={{ icon:'🌐', label:'Country', value: viewVisit.visitType === 'International' ? (viewVisit.country || '—') : 'Nepal' }}
            />
            <DRow icon="📍" label="Address" value={viewVisit.address || viewVisit.location} />
            <DRowPair
              left={{ icon:'📆', label:t('From Date'), value:fd(viewVisit.fromDate) }}
              right={{ icon:'📆', label:t('To Date'),   value:fd(viewVisit.toDate) }}
            />
            <DRow icon="🗓️" label={t('Applied Date')} value={fd(viewVisit.appliedDate)} />

            <DRowBox icon="📝" label="Description" value={viewVisit.description || viewVisit.reason} />
            {viewVisit.comment && (
              <DRowBox icon="🗨️" label={t('Comment')} value={viewVisit.comment} bg="#f9fafb" border="#e5e7eb" color="#374151" />
            )}

            {(viewVisit.recommendedBy || viewVisit.approvedBy) && (
              <div style={{ marginTop:16 }}>
                <SectionLabel color="#059669">✅ {t('Recommendation & Approval Details')}</SectionLabel>
                {viewVisit.recommendedBy && (
                  <DRow icon="👍" label={t('Recommended By')}
                    value={`${getEmployeeName(viewVisit.recommendedBy)} · ${viewVisit.recommendedAt ? formatNepalDateTime(viewVisit.recommendedAt, fd) : fd(viewVisit.recommendedDate)}`} />
                )}
                {viewVisit.recommendComment && (
                  <DRowBox icon="💭" label={t('Recommend Comment')} value={viewVisit.recommendComment} bg="#f0fdf4" border="#bbf7d0" color="#059669" />
                )}
                {viewVisit.approvedBy && (
                  <DRow icon="✅" label={viewVisit.status === 'rejected' ? t('Rejected By') : t('Approved By')}
                    value={`${getEmployeeName(viewVisit.approvedBy)} · ${viewVisit.approvedAt ? formatNepalDateTime(viewVisit.approvedAt, fd) : fd(viewVisit.approvedDate)}`} />
                )}
              </div>
            )}
          </SidePanelShell>
        );
      })()}

      {/* ── Edit Office Visit Modal ── */}
      {editVisit && (() => {
        // keep an existing multi-day range; only pull To Date forward if From passes it
        const setEVF = (f, v) => setEditVisitForm(p => ({ ...p, [f]: v, ...(f === 'fromDate' && (!p.toDate || p.toDate < v) ? { toDate: v } : {}) }));
        const validateEditVisit = () => {
          const e = {};
          if (!editVisitForm.officialVisit?.trim()) e.officialVisit = t('Required field');
          if (!editVisitForm.address?.trim())       e.address       = t('Required field');
          if (!editVisitForm.description?.trim())   e.description   = t('Required field');
          if (!editVisitForm.fromDate)              e.fromDate      = t('Required field');
          if (!editVisitForm.toDate)                e.toDate        = t('Required field');
          if (editVisitForm.fromDate && editVisitForm.toDate && editVisitForm.toDate < editVisitForm.fromDate)
            e.toDate = 'To Date must be on or after From Date';
          return e;
        };
        const handleEditVisitSubmit = async (ev) => {
          ev.preventDefault();
          const errs = validateEditVisit();
          if (Object.keys(errs).length) { setEditVisitErrors(errs); return; }
          try {
          await updateVisit(editVisit.id, {
            employeeId:      editVisitForm.employeeId,
            purpose:         editVisitForm.officialVisit,
            location:        editVisitForm.address,
            description:     editVisitForm.description,
            fromDate:        editVisitForm.fromDate,
            toDate:          editVisitForm.toDate,
            status:          editVisitForm.status,
            recommendedBy:   editVisitForm.recommendedBy   || null,
            recommendedDate: editVisitForm.recommendedDate || null,
            approvedBy:      editVisitForm.approvedBy      || null,
            approvedDate:    editVisitForm.approvedDate    || null,
          }, { throwOnReject: true });
          } catch (err) {
            setSaveAlert(alertFromSaveError(err, fd));
            return;
          }
          setEditVisit(null);
        };

        const Lbl = ({ children, required }) => (
          <div style={{ fontSize:12, fontWeight:600, color:'#374151', marginBottom:4 }}>
            {children}{required && <span style={{ color:'#dc2626', marginLeft:2 }}>*</span>}
          </div>
        );
        const Err = ({ msg }) => msg ? <div style={{ fontSize:11, color:'#dc2626', marginTop:3 }}>{msg}</div> : null;
        const activeEmps = allEmployees.filter(e => e.active !== false);

        /* get configured reco/approval for the selected employee */
        const editEmpRecoAppr = (() => {
          const cfg = visitRecoConfig[String(editVisitForm.employeeId)] || {};
          const toIds = (v) => Array.isArray(v) ? v : (v ? [v] : []);
          const recoIds = toIds(cfg.reco).map(String);
          const apprIds = toIds(cfg.approval).map(String);
          const toOpts = (ids) => ids.map(id => {
            const e = activeEmps.find(x => String(x.id) === id);
            return {
              value: id,
              label: e ? e.fullName : `#${id}`,
              sub: e ? [e.employeeId, e.position].filter(Boolean).join(' - ') : '',
              photo: e?.profilePhoto,
            };
          });
          return { recoOpts: toOpts(recoIds), apprOpts: toOpts(apprIds) };
        })();

        return (
          <div className="modal-overlay">
            <div className="modal modal-lg" style={{ maxWidth:680, maxHeight:'90vh', overflowY:'auto' }}
              onClick={e => e.stopPropagation()}>
              <div className="modal-header" style={{ position:'sticky', top:0, zIndex:10 }}>
                <h2>✏️ Edit Office Visit Application #{editVisit.id}</h2>
                <button className="modal-close" onClick={() => setEditVisit(null)}>✕</button>
              </div>
              <div className="modal-body">
                <form ref={editVisitFormRef} onSubmit={handleEditVisitSubmit}>
                  {/* Staff */}
                  <div className="form-group">
                    <Lbl required>Staff</Lbl>
                    <select value={editVisitForm.employeeId}
                      onChange={e => setEditVisitForm(p => ({ ...p, employeeId: e.target.value, recommendedBy: '', approvedBy: '' }))}
                      className="form-control" style={{ fontSize:13 }}>
                      {activeEmps.map(e => (
                        <option key={e.id} value={String(e.id)}>
                          {e.fullName} {e.employeeId ? `[${e.employeeId}]` : ''} — {e.department || '—'}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Official Visit */}
                  <div className="form-group">
                    <Lbl required>Official Visit</Lbl>
                    <select value={editVisitForm.officialVisit} onChange={e => setEVF('officialVisit', e.target.value)}
                      className={`form-control ${editVisitErrors.officialVisit ? 'error' : ''}`} style={{ fontSize:13 }}>
                      <option value="">— Select Official Visit Type —</option>
                      {visitTypeOptions.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                    <Err msg={editVisitErrors.officialVisit} />
                  </div>

                  {/* Address */}
                  <div className="form-group">
                    <Lbl required>Address</Lbl>
                    <input type="text" className={`form-control ${editVisitErrors.address ? 'error' : ''}`}
                      placeholder="Enter visit address / location..." value={editVisitForm.address}
                      onChange={e => setEVF('address', e.target.value)} style={{ fontSize:13 }} />
                    <Err msg={editVisitErrors.address} />
                  </div>

                  {/* Description */}
                  <div className="form-group">
                    <Lbl required>Description</Lbl>
                    <textarea className={`form-control ${editVisitErrors.description ? 'error' : ''}`}
                      rows={2} placeholder="Enter description / purpose of the visit..."
                      value={editVisitForm.description} onChange={e => setEVF('description', e.target.value)} style={{ fontSize:13 }} />
                    <Err msg={editVisitErrors.description} />
                  </div>

                  {/* Dates */}
                  <div className="form-row">
                    <div className="form-group">
                      <Lbl required>From Date</Lbl>
                      <LeaveDateInput value={editVisitForm.fromDate} error={!!editVisitErrors.fromDate}
                        settings={settings} onChange={v => setEVF('fromDate', v)} />
                      <Err msg={editVisitErrors.fromDate} />
                    </div>
                    <div className="form-group">
                      <Lbl required>To Date</Lbl>
                      <LeaveDateInput value={editVisitForm.toDate} error={!!editVisitErrors.toDate}
                        minDate={editVisitForm.fromDate} settings={settings} onChange={v => setEVF('toDate', v)} />
                      <Err msg={editVisitErrors.toDate} />
                    </div>
                  </div>

                  {/* Status — only admin/manager can change this here; see
                      LeavePanel's identical comment on its own Status field. */}
                  <div className="form-group">
                    <Lbl required>Status</Lbl>
                    <select value={editVisitForm.status} onChange={e => setEVF('status', e.target.value)}
                      disabled={!canManageStaff}
                      title={!canManageStaff ? 'Only an approver can change the status of your application' : undefined}
                      className="form-control" style={{ fontSize:13, opacity: canManageStaff ? 1 : .65 }}>
                      <option value="pending">Pending</option>
                      <option value="approved">Approved</option>
                      <option value="rejected">Rejected</option>
                    </select>
                  </div>

                  {/* Recommended By + Date — only configured recommenders */}
                  <div className="form-row">
                    <div className="form-group">
                      <Lbl>Recommended By</Lbl>
                      <SearchableSelect value={editVisitForm.recommendedBy}
                        onChange={v => setEVF('recommendedBy', v)}
                        options={editEmpRecoAppr.recoOpts}
                        placeholder={editEmpRecoAppr.recoOpts.length === 0 ? 'No recommendator configured' : '— Select Recommendator —'}
                        disabled={editEmpRecoAppr.recoOpts.length === 0} showAvatar />
                    </div>
                    <div className="form-group">
                      <Lbl>Recommended Date</Lbl>
                      <LeaveDateInput value={editVisitForm.recommendedDate} settings={settings}
                        onChange={v => setEVF('recommendedDate', v)} />
                    </div>
                  </div>

                  {/* Approved By + Date — only configured approvers */}
                  <div className="form-row">
                    <div className="form-group">
                      <Lbl>Approved By</Lbl>
                      <SearchableSelect value={editVisitForm.approvedBy}
                        onChange={v => setEVF('approvedBy', v)}
                        options={editEmpRecoAppr.apprOpts}
                        placeholder={editEmpRecoAppr.apprOpts.length === 0 ? 'No approver configured' : '— Select Approver —'}
                        disabled={editEmpRecoAppr.apprOpts.length === 0} showAvatar />
                    </div>
                    <div className="form-group">
                      <Lbl>Approved Date</Lbl>
                      <LeaveDateInput value={editVisitForm.approvedDate} settings={settings}
                        onChange={v => setEVF('approvedDate', v)} />
                    </div>
                  </div>

                  <div className="modal-footer" style={{ padding:'14px 0 0', borderTop:'1px solid #e5e7eb', marginTop:6, display:'flex', justifyContent:'space-between' }}>
                    <button type="button" className="btn btn-outline" style={{ color:'#dc2626', borderColor:'#fca5a5' }}
                      onClick={() => { setDelConfirm(editVisit.id); setEditVisit(null); }}>
                      🗑️ Delete
                    </button>
                    <div style={{ display:'flex', gap:8 }}>
                      <button type="button" className="btn btn-outline" onClick={() => setEditVisit(null)}>Cancel</button>
                      <button type="submit" className="btn btn-primary" title="Ctrl+S">💾 <u>S</u>ave Changes</button>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Delete Confirm */}
      {delConfirm && (
        <div className="modal-overlay">
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h2>⚠️ {t('Delete Confirmation')}</h2><button className="modal-close" onClick={() => setDelConfirm(null)}>✕</button></div>
            <div className="modal-body"><p style={{ fontSize:14 }}>{t('Are you sure you want to delete this record?')}</p></div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setDelConfirm(null)}>{t('Cancel')}</button>
              <button className="btn btn-danger" onClick={() => {
                const id = delConfirm; setDelConfirm(null);
                deleteVisit(id).catch(err => {
                  setVisitActionToast({ msg: err?.message || 'Delete failed', type: 'danger' });
                  setTimeout(() => setVisitActionToast(null), 4000);
                });
              }}>🗑 {t('Delete')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Office Visit Approval — full-width popup instead of navigating to its own page */}
      {showVisitApprovalModal && (
        <div className="modal-overlay" onClick={() => setShowVisitApprovalModal(false)}>
          <div className="modal" style={{ width:'95vw', maxWidth:1400, maxHeight:'92vh' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>✅ {t('Visit Approval')}</h2>
              <button className="modal-close" onClick={() => setShowVisitApprovalModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <OfficeVisitApproval embedded />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/* ══════════════════════════════════════════════════
   COMBINED PAGE
══════════════════════════════════════════════════ */
const LeaveVisitPage = ({ defaultTab = 'leave' }) => {
  const { t } = useLanguage();
  const { stats } = useData();
  const { isManager } = useAuth();
  const [activeTab, setActiveTab] = useState(defaultTab);

  const tabs = [
    { key:'leave', icon:'📅', label:t('Leave Management'), badge: isManager ? stats.pendingLeaves : 0, color:'#1a56db', bg:'#eff6ff', border:'#1a56db' },
    { key:'visit', icon:'🏢', label:t('Office Visit'),     badge: isManager ? stats.pendingVisits : 0, color:'#059669', bg:'#ecfdf5', border:'#059669' },
  ];

  return (
    <div className="page-container fade-in">

      {/* ── Page Title ── */}
      <div style={{ marginBottom:12 }}>
        <h1 style={{ fontSize:15, fontWeight:600, color:'var(--text-primary)', margin:0, display:'flex', alignItems:'center', gap:6 }}>
          <span style={{ fontSize:13 }}>📅</span> Leave
          <span style={{ color:'#d1d5db', fontWeight:300, fontSize:14 }}>|</span>
          <span style={{ fontSize:13 }}>🏢</span> Office Visit
        </h1>
      </div>

      {/* ── Tab Bar ── */}
      <div className="tabs" style={{ marginBottom: 0 }}>
        {tabs.map(tab => {
          const isActive = activeTab === tab.key;
          return (
            <button key={tab.key}
              className={`tab-btn${isActive ? ' active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
              style={isActive ? { color: tab.color, borderBottomColor: tab.color } : {}}>
              <span style={{ marginRight: 5 }}>{tab.icon}</span>
              {tab.label}
              {tab.badge > 0 && (
                <span style={{
                  marginLeft: 6, background:'#ef4444', color:'white',
                  borderRadius:10, fontSize:10, fontWeight:700,
                  padding:'1px 6px', minWidth:18, display:'inline-block', textAlign:'center',
                }}>
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Tab Content ── */}
      <div className="card" style={{ padding:'16px 20px', borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
        {activeTab === 'leave' && <LeavePanel />}
        {activeTab === 'visit' && <VisitPanel />}
      </div>
    </div>
  );
};

export default LeaveVisitPage;
