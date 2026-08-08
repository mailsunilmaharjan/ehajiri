import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useNavigate }  from 'react-router-dom';
import { useAuth }      from '../../context/AuthContext.jsx';
import { useLanguage }  from '../../context/LanguageContext.jsx';
import { useData }      from '../../context/DataContext.jsx';
import useSaveShortcut  from '../../hooks/useSaveShortcut.js';
import { useSettings }  from '../../context/SettingsContext.jsx';
import { makeDateFormatter, getNepalTodayISO } from '../../utils/dateUtils.js';
import { staffRankCompare } from '../../utils/branchUtils.js';
import DataGrid from '../DataGrid/DataGrid.jsx';
import NepaliDatePicker from '../Common/NepaliDatePicker.jsx';
import SearchableSelect from '../Common/SearchableSelect.jsx';

/* load saved reco/approval from localStorage */
const loadRecoApproval = () => {
  try { return JSON.parse(localStorage.getItem('ehajiri_reco_approval') || '{}'); } catch { return {}; }
};

/* date picker that respects settings.defaultCalendar and settings.leaveBackdateEnabled —
   allowPast overrides the block regardless of that setting, for Admin Manual Posting
   (correcting/backfilling records is the whole point of that form; see its own callers). */
const LeaveDateInput = ({ value, onChange, error, settings, allowPast }) => {
  const blockPast = !allowPast && settings.leaveBackdateEnabled === false;
  if (settings.defaultCalendar === 'np') {
    return <NepaliDatePicker value={value} onChange={onChange} error={error} maxToday={false} minToday={blockPast} />;
  }
  return (
    <input type="date" className={`form-control ${error ? 'error' : ''}`}
      value={value} min={blockPast ? getNepalTodayISO() : undefined}
      onChange={e => onChange(e.target.value)}
      style={{ fontSize:13 }} />
  );
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
  const { filteredLeaves: leaves, deleteLeave, addLeave, updateLeave, approveLeave, rejectLeave, getEmployeeName, getLeaveTypeName, getLeaveTypeColor, leaveTypes, getLeaveBalance, refreshLeaveBalances, filteredEmployees: employees, employees: allEmployees } = useData();
  const navigate = useNavigate();

  const [filterStatus, setFilterStatus] = useState('all');
  const [filterTypes,  setFilterTypes]  = useState([]);
  const [filterAccum,  setFilterAccum]  = useState('all');
  const [viewLeave,    setViewLeave]    = useState(null);
  const [editLeave,    setEditLeave]    = useState(null); // leave being edited
  const [editForm,     setEditForm]     = useState({});
  const [editErrors,   setEditErrors]   = useState({});
  const editFormRef = useRef(null);
  /* Ctrl+S submits the Edit Leave form — same action as the Save Changes button */
  useSaveShortcut(!!editLeave, () => editFormRef.current?.requestSubmit());
  const manualFormRef = useRef(null);
  const [delConfirm,   setDelConfirm]   = useState(null);
  const [showApply,    setShowApply]    = useState(false);
  // Refetch settings right as Apply opens — this page stays mounted for the
  // whole session, so a long-open tab would otherwise keep enforcing
  // whatever leaveBackdateEnabled was when it first loaded.
  useEffect(() => { if (showApply) refreshSettings(); }, [showApply]);
  // Same reasoning — leaveBalances is normally fetched once at login, so a
  // credit granted elsewhere (e.g. an OT-to-leave grant on the Overtime
  // Approval page) wouldn't show up in "days remaining" here without this.
  useEffect(() => { if (showApply) refreshLeaveBalances(); }, [showApply]); // eslint-disable-line react-hooks/exhaustive-deps
  const [showManual,   setShowManual]   = useState(false);
  const [manualForm,   setManualForm]   = useState({ employeeId:'', leaveTypeCode:'', fromDate:'', toDate:'', halfDay:false, reason:'', status:'approved', recommendedBy:'', recommendedDate:'', approvedBy:'', approvedDate:'' });
  const [manualErrors, setManualErrors] = useState({});
  const [manualToast,  setManualToast]  = useState(null);
  /* Ctrl+S submits the Manual Entry form — same action as the Save button */
  useSaveShortcut(showManual, () => manualFormRef.current?.requestSubmit());
  /* ── Inline approve/reject modal ── */
  const [actionModal, setActionModal]   = useState(null); // { id, type:'approve'|'reject', leave }
  const [comment,     setComment]       = useState('');
  const [actionToast, setActionToast]   = useState(null);

  /* ── Reco/approval config for inline approval logic ── */
  const recoConfig = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('ehajiri_reco_approval') || '{}'); } catch { return {}; }
  }, []);
  const isRecoCompulsoryLeave = recoConfig._settings?.isRecoCompulsory || false;
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

  /* ── Balance from Leave Calculation (ls_leaveOpening) for current FY ── */
  const balance = useMemo(() => {
    try {
      const opening   = JSON.parse(localStorage.getItem('ls_leaveOpening') || '{}');
      const defaultFY = (settings.fiscalYears || []).find(f => f.isDefault) || (settings.fiscalYears || [])[0];
      if (!defaultFY) return getLeaveBalance(currentUser.id);

      const fyId    = String(defaultFY.id);
      const prevKey = 'prev_' + fyId;
      const empId   = String(currentUser.id);

      const result = {};
      ltConfigs.forEach(lt => {
        const prevYear = Number(opening[prevKey]?.[empId]?.[lt.shortName] ?? 0);
        const currYear = Number(opening[fyId]?.[empId]?.[lt.shortName]    ?? 0);
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
  }, [settings.fiscalYears, currentUser.id, ltConfigs, leaves, getLeaveBalance]);
  const selectedLtConfig = useMemo(() =>
    ltConfigs.find(lt => lt.shortName === applyForm.leaveTypeCode),
  [ltConfigs, applyForm.leaveTypeCode]);

  /* weekend set for the current effective period */
  const weekendDays = useMemo(() => {
    const ws = settings.defaultWeekends || ['Sat'];
    const map = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
    return ws.map(d => map[d]).filter(d => d !== undefined);
  }, [settings.defaultWeekends]);

  /* public holiday date strings */
  const holidaySet = useMemo(() => {
    const s = new Set();
    (settings.publicHolidays || []).forEach(h => { if (h.date) s.add(h.date.split('T')[0]); });
    return s;
  }, [settings.publicHolidays]);

  /* reco/approval — read fresh from localStorage each time modal opens */
  const getMyRecoApproval = useCallback(() => {
    const saved = loadRecoApproval();
    const r = saved[currentUser.id]?.reco;
    const a = saved[currentUser.id]?.approval;
    return {
      reco:     Array.isArray(r) ? r : (r ? [r] : []),
      approval: Array.isArray(a) ? a : (a ? [a] : []),
    };
  }, [currentUser.id]);

  /* use all employees so reco/approval from any branch/dept can be resolved */
  const getEmpName = useCallback((id) =>
    (allEmployees || []).find(e => String(e.id) === String(id))?.fullName || `#${id}`,
  [allEmployees]);

  /* smart day calculator */
  const calcDays = useCallback(() => {
    if (applyForm.halfDay) return 0.5;
    if (!applyForm.fromDate || !applyForm.toDate) return 0;
    const from = new Date(applyForm.fromDate + 'T00:00:00');
    const to   = new Date(applyForm.toDate   + 'T00:00:00');
    if (to < from) return 0;
    let count = 0;
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      if (selectedLtConfig?.reduceWeekend && weekendDays.includes(d.getDay())) continue;
      const ds = d.toISOString().split('T')[0];
      if (selectedLtConfig?.reducePublicHoliday && holidaySet.has(ds)) continue;
      count++;
    }
    return count;
  }, [applyForm.fromDate, applyForm.toDate, applyForm.halfDay, selectedLtConfig, weekendDays, holidaySet]);

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
      if (field === 'fromDate' && p.halfDay) { next.toDate = val; }
      return next;
    });
    setApplyErrors(p => ({ ...p, [field]: '', days: '' }));
  };

  const handleApplySubmit = async (e) => {
    e.preventDefault();
    const errs = validateApply();
    if (Object.keys(errs).length) { setApplyErrors(errs); return; }
    setSubmitting(true);
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
    });
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
  const displayLeaves = leaves.filter(l => {
    if (!isManager && String(l.employeeId) !== String(currentUser.id)) return false;
    if (filterStatus !== 'all' && l.status !== filterStatus) return false;
    if (filterTypes.length > 0 && !filterTypes.includes(l.leaveTypeCode)) return false;
    if (filterAccum !== 'all') {
      const ltc = ltConfigs.find(lt => lt.shortName === l.leaveTypeCode);
      if (filterAccum === 'accumulate'    && ltc && !ltc.carryForward)  return false;
      if (filterAccum === 'nonAccumulate' && ltc &&  ltc.carryForward)  return false;
    }
    return true;
  });

  const countByStatus = s => leaves.filter(l =>
    (!isManager ? String(l.employeeId) === String(currentUser.id) : true) && (s === 'all' || l.status === s)
  ).length;

  /* language-aware leave type name lookup */
  const getLeaveLabel = (code) => {
    const ltc = ltConfigs.find(lt => lt.shortName === code);
    if (ltc) return ltc.name; // use configured name
    const lt2 = leaveTypes.find(lt => lt.code === code);
    if (!lt2) return code;
    return language === 'np' ? (lt2.name || code) : (lt2.nameEn || lt2.name || code);
  };

  const columns = [
    { field: 'employeeId',    header: t('Name'),         width: 160, render: v => <span style={{ fontWeight:600, color:'#111827' }}>{getEmployeeName(v)}</span> },
    { field: 'leaveTypeCode', header: t('Type'),         width: 150, render: v => (
      <span style={{ display:'flex', alignItems:'center', gap:6 }}>
        <span style={{ width:8, height:8, borderRadius:'50%', background:getLeaveTypeColor(v), display:'inline-block', flexShrink:0 }}></span>
        {getLeaveLabel(v)}
      </span>
    )},
    { field: 'isManual', header: language==='np' ? 'प्रकार' : 'App. Type', width: 110,
      render: (v, row) => {
        /* isManual=true (explicit) OR heuristic: submitted for a different employee by a manager */
        const isMan = v === true || String(row.employeeId) !== String(currentUser.id);
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
    { field: 'days',          header: t('Days'),         width: 60,  align:'center', render: v => <strong style={{ color:'#1a56db' }}>{(isNaN(Number(v)) || v === null || v === undefined) ? '—' : v}</strong> },
    { field: 'reason',        header: t('Reason'),       width: 150, render: v => <span style={{ maxWidth:140, overflow:'hidden', textOverflow:'ellipsis', display:'block', fontSize:14 }}>{v}</span> },
    { field: 'appliedDate',   header: t('Applied Date'), width: 110, render: v => fd(v) },
    { field: 'status',        header: t('Status'),       width: 110, render: v => <StatusBadge status={v} /> },
    { field: 'actions', header: t('Actions'), width: 110, filterable:false, sortable:false, render: (_, row) => (
      <div className="dg-actions">
        <button className="dg-action-btn view"   title={t('View')}   onClick={e => { e.stopPropagation(); setViewLeave(row); }}>👁</button>
        {(isManager || row.status === 'pending') && (
          <button className="dg-action-btn delete" title={t('Delete')} onClick={e => { e.stopPropagation(); setDelConfirm(row.id); }}>🗑</button>
        )}
        {row.status === 'pending' && (() => {
          const amApprover    = isApproverForLeave(row.employeeId);
          const amRecommender = isRecommenderForLeave(row.employeeId);
          const canApprove    = amApprover && (!isRecoCompulsoryLeave || !!row.recommendedBy);
          const involved      = amApprover || amRecommender || isManager;
          if (!involved) return null;
          return (
            <>
              {/* Approve — visible to approvers/managers, disabled for reco-only */}
              <button className="dg-action-btn approve"
                title={!amApprover ? 'You are a recommendator only — approval not permitted'
                       : !canApprove ? 'Awaiting recommendation first' : t('Approve')}
                disabled={!amApprover || !canApprove}
                style={{ opacity: (!amApprover || !canApprove) ? 0.4 : 1, cursor: (!amApprover || !canApprove) ? 'not-allowed' : 'pointer' }}
                onClick={e => { e.stopPropagation(); if (amApprover && canApprove) { setActionModal({ id:row.id, type:'approve', leave:row }); setComment(''); } }}>
                ✓
              </button>
              {/* Reject — only for approvers/managers */}
              {(amApprover || isManager) && (
                <button className="dg-action-btn reject" title={t('Reject')}
                  onClick={e => { e.stopPropagation(); setActionModal({ id:row.id, type:'reject', leave:row }); setComment(''); }}>
                  ✗
                </button>
              )}
            </>
          );
        })()}
      </div>
    )},
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
              {isManager && (
                <button className="btn btn-outline btn-sm" onClick={() => navigate('/leave/approval')}>
                  ✅ {t('Leave Approval')}
                </button>
              )}
              {canManageStaff && (
                <button className="btn btn-sm" onClick={() => { setManualForm({ employeeId:'', leaveTypeCode:'', fromDate:today, toDate:today, halfDay:false, days:'1', reason:'', status:'approved', appliedDate:today }); setManualErrors({}); setShowManual(true); }}
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

      <DataGrid columns={columns} data={displayLeaves} defaultPageSize={10} showSearch searchPlaceholder={t('Search') + '...'}
        onRowDoubleClick={row => {
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
            approvedDate:    toDateStr(row.approvedDate),
          });
          setEditErrors({});
          setEditLeave(row);
        }}
      />

      {/* ── Inline Approve / Reject Modal ── */}
      {actionModal && (
        <div className="modal-overlay">
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>
                {actionModal.type === 'approve' ? `✅ ${t('Approve')}` : `❌ ${t('Reject')}`} — {t('Leave Application')}
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
                className={`btn ${actionModal.type === 'approve' ? 'btn-success' : 'btn-danger'}`}
                onClick={() => {
                  if (actionModal.type === 'approve') {
                    approveLeave(actionModal.id, currentUser.id, comment);
                  } else {
                    rejectLeave(actionModal.id, currentUser.id, comment);
                  }
                  setActionToast({ msg: actionModal.type === 'approve' ? t('Application approved') : t('Application rejected'), type: actionModal.type === 'approve' ? 'success' : 'danger' });
                  setTimeout(() => setActionToast(null), 3000);
                  setActionModal(null); setComment('');
                }}>
                {actionModal.type === 'approve' ? `✅ ${t('Approve')}` : `❌ ${t('Reject')}`}
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
        const setEF = (f, v) => setEditForm(p => ({ ...p, [f]: v }));
        const validateEdit = () => {
          const e = {};
          if (!editForm.leaveTypeCode) e.leaveTypeCode = t('Required field');
          if (!editForm.fromDate)      e.fromDate      = t('Required field');
          if (!editForm.toDate)        e.toDate        = t('Required field');
          if (editForm.fromDate && editForm.toDate && editForm.toDate < editForm.fromDate)
            e.toDate = 'To Date must be on or after From Date';
          return e;
        };
        const handleEditSubmit = (ev) => {
          ev.preventDefault();
          const errs = validateEdit();
          if (Object.keys(errs).length) { setEditErrors(errs); return; }
          const days = editForm.halfDay ? 0.5 : (() => {
            const fromStr = (editForm.fromDate || '').split('T')[0];
            const toStr   = (editForm.toDate   || '').split('T')[0];
            const from = new Date(fromStr + 'T00:00:00');
            const to   = new Date(toStr   + 'T00:00:00');
            const d = Math.floor((to - from) / 86400000) + 1;
            return isNaN(d) || d < 1 ? 1 : d;
          })();
          updateLeave(editLeave.id, {
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
          });
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
            return { value: id, label: e ? e.fullName : `#${id}` };
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
                        min={editForm.fromDate} settings={settings} onChange={v => setEF('toDate', v)} />
                      <Err msg={editErrors.toDate} />
                    </div>
                  </div>

                  {/* Reason */}
                  <div className="form-group">
                    <Lbl>Reason</Lbl>
                    <textarea className="form-control" rows={2} placeholder="Enter reason..."
                      value={editForm.reason} onChange={e => setEF('reason', e.target.value)} style={{ fontSize:13 }} />
                  </div>

                  {/* Status */}
                  <div className="form-group">
                    <Lbl required>Status</Lbl>
                    <select value={editForm.status} onChange={e => setEF('status', e.target.value)}
                      className="form-control" style={{ fontSize:13 }}>
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
                        disabled={editEmpRecoAppr.recoOpts.length === 0} />
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
                        disabled={editEmpRecoAppr.apprOpts.length === 0} />
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
        const setMF = (f, v) => setManualForm(p => ({ ...p, [f]: v }));

        const validateManual = () => {
          const e = {};
          if (!manualForm.employeeId)    e.employeeId    = t('Required field');
          if (!manualForm.leaveTypeCode) e.leaveTypeCode = t('Required field');
          if (!manualForm.fromDate)      e.fromDate      = t('Required field');
          if (!manualForm.toDate)        e.toDate        = t('Required field');
          if (manualForm.fromDate && manualForm.toDate && manualForm.toDate < manualForm.fromDate)
            e.toDate = 'To Date must be on or after From Date';
          if (!manualForm.reason.trim()) e.reason = t('Required field');
          return e;
        };

        const handleManualSubmit = async (ev) => {
          ev.preventDefault();
          const errs = validateManual();
          if (Object.keys(errs).length) { setManualErrors(errs); return; }
          const days = manualForm.halfDay ? 0.5
            : (() => {
              const fromStr = (manualForm.fromDate || '').split('T')[0];
              const toStr   = (manualForm.toDate   || '').split('T')[0];
              const from = new Date(fromStr + 'T00:00:00');
              const to   = new Date(toStr   + 'T00:00:00');
              const d = Math.floor((to - from) / 86400000) + 1;
              return isNaN(d) || d < 1 ? 1 : d;
            })();
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
          });
          setShowManual(false);
          setManualToast({ msg:'Leave entry posted manually', type:'success' });
          setTimeout(() => setManualToast(null), 2500);
        };

        const Lbl = ({ children, required }) => (
          <div style={{ fontSize:12, fontWeight:600, color:'#374151', marginBottom:4 }}>
            {children}{required && <span style={{ color:'#dc2626', marginLeft:2 }}>*</span>}
          </div>
        );
        const Err = ({ msg }) => msg ? <div style={{ fontSize:11, color:'#dc2626', marginTop:3 }}>{msg}</div> : null;

        const activeEmps = allEmployees.filter(e => e.active !== false)
          .sort((a, b) => staffRankCompare(a, b, settings));
        const empOpts = activeEmps.map(e => ({
          value: String(e.id),
          label: `${e.fullName}${e.employeeId ? ` [${e.employeeId}]` : ''}${e.department ? ` — ${e.department}` : ''}`,
        }));
        const ltOpts = ltConfigs.map(lt => ({ value: lt.shortName, label: lt.name }));

        /* only staff configured (Staff Detail → Set Recommendator & Approval) for this employee */
        const manualCfg    = recoConfig[String(manualForm.employeeId)] || {};
        const toIds         = (v) => (Array.isArray(v) ? v : (v ? [v] : [])).map(String);
        const manualRecoIds = toIds(manualCfg.reco);
        const manualApprIds = toIds(manualCfg.approval);
        const manualRecoOpts = activeEmps.filter(e => manualRecoIds.includes(String(e.id))).map(e => ({ value: String(e.id), label: e.fullName }));
        const manualApprOpts = activeEmps.filter(e => manualApprIds.includes(String(e.id))).map(e => ({ value: String(e.id), label: e.fullName }));

        return (
          <div className="modal-overlay">
            <div className="modal modal-lg" style={{ maxWidth:700, maxHeight:'90vh', overflowY:'auto' }}
              onClick={e => e.stopPropagation()}>
              <div className="modal-header" style={{ position:'sticky', top:0, zIndex:10 }}>
                <h2>✍️ Manual Leave Posting</h2>
                <button className="modal-close" onClick={() => setShowManual(false)}>✕</button>
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
                      <SearchableSelect value={manualForm.employeeId}
                        onChange={v => setManualForm(p => ({ ...p, employeeId: v, recommendedBy: '', approvedBy: '' }))}
                        options={empOpts} placeholder="— Search & Select Staff —" />
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
                        min={manualForm.fromDate} settings={settings} allowPast={isAdmin} onChange={v => setMF('toDate', v)} />
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
                        disabled={!manualForm.employeeId || manualRecoOpts.length === 0} />
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
                      <Lbl>Approved By</Lbl>
                      <SearchableSelect value={manualForm.approvedBy} onChange={v => setMF('approvedBy', v)}
                        options={manualApprOpts}
                        placeholder={!manualForm.employeeId ? '— Select staff first —' : manualApprOpts.length === 0 ? 'No approver configured' : '— Select Approver —'}
                        disabled={!manualForm.employeeId || manualApprOpts.length === 0} />
                    </div>
                    <div className="form-group">
                      <Lbl>Approved Date</Lbl>
                      <LeaveDateInput value={manualForm.approvedDate} settings={settings}
                        allowPast={isAdmin} onChange={v => setMF('approvedDate', v)} />
                    </div>
                  </div>

                  <div className="modal-footer" style={{ padding:'14px 0 0', borderTop:'1px solid #e5e7eb', marginTop:4, display:'flex', justifyContent:'flex-end', gap:8 }}>
                    <button type="button" className="btn btn-outline" onClick={() => setShowManual(false)}>Cancel</button>
                    <button type="submit" className="btn btn-primary" title="Ctrl+S" style={{ background:'linear-gradient(135deg,#7c3aed,#6d28d9)' }}>
                      💾 <u>S</u>ave
                    </button>
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
                          min={today} settings={settings}
                          onChange={v => handleApplyChange('fromDate', v)} />
                        <Err msg={applyErrors.fromDate} />
                      </div>
                      <div className="form-group">
                        <Lbl required>To Date</Lbl>
                        <LeaveDateInput value={applyForm.toDate} error={!!applyErrors.toDate}
                          min={applyForm.fromDate || today} settings={settings}
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
                          <select value={selectedReco} onChange={e => setSelectedReco(e.target.value)}
                            className={`form-control ${applyErrors.selectedReco ? 'error' : ''}`}
                            style={{ fontSize:13, minHeight:42 }}>
                            <option value="">— Select Recommendator —</option>
                            {applyForm.reco.map(id => (
                              <option key={id} value={String(id)}>{getEmpName(id)}</option>
                            ))}
                          </select>
                          {applyErrors.selectedReco && <div style={{ fontSize:11, color:'#dc2626', marginTop:3 }}>{applyErrors.selectedReco}</div>}
                        </>
                      )}
                    </div>
                    <div>
                      <Lbl required={applyForm.approval.length > 1}>Approval Authority</Lbl>
                      {applyForm.approval.length === 0 && (
                        <div style={{ background:'#f8fafc', border:'1px solid #e5e7eb', borderRadius:8, padding:'8px 12px', minHeight:36 }}>
                          <span style={{ fontSize:13, color:'#9ca3af' }}>— Not configured —</span>
                        </div>
                      )}
                      {applyForm.approval.length === 1 && (
                        <div style={{ background:'#f0fdf4', border:'1px solid #86efac', borderRadius:8, padding:'8px 12px', minHeight:36, display:'flex', alignItems:'center' }}>
                          <span style={{ background:'#d1fae5', color:'#065f46', borderRadius:10, padding:'2px 12px', fontSize:13, fontWeight:600 }}>
                            {getEmpName(applyForm.approval[0])}
                          </span>
                        </div>
                      )}
                      {applyForm.approval.length > 1 && (
                        <>
                          <select value={selectedApproval} onChange={e => setSelectedApproval(e.target.value)}
                            className={`form-control ${applyErrors.selectedApproval ? 'error' : ''}`}
                            style={{ fontSize:13, minHeight:42 }}>
                            <option value="">— Select Approval Authority —</option>
                            {applyForm.approval.map(id => (
                              <option key={id} value={String(id)}>{getEmpName(id)}</option>
                            ))}
                          </select>
                          {applyErrors.selectedApproval && <div style={{ fontSize:11, color:'#dc2626', marginTop:3 }}>{applyErrors.selectedApproval}</div>}
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

      {/* View Modal */}
      {viewLeave && (
        <div className="modal-overlay">
          <div className="modal modal-md" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>📅 {t('Leave Application')} #{viewLeave.id}</h2>
              <button className="modal-close" onClick={() => setViewLeave(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
                {[
                  [t('Name'),        getEmployeeName(viewLeave.employeeId)],
                  [t('Type'),        getLeaveTypeName(viewLeave.leaveTypeCode)],
                  [t('From Date'),   fd(viewLeave.fromDate)],
                  [t('To Date'),     fd(viewLeave.toDate)],
                  [t('Days'),        viewLeave.days],
                  [t('Applied Date'),fd(viewLeave.appliedDate)],
                  [t('Status'),      <StatusBadge status={viewLeave.status} />],
                  [t('Approved By'), getEmployeeName(viewLeave.approvedBy) || '—'],
                ].map(([label, val], i) => (
                  <div key={i}>
                    <div style={{ fontSize:11, color:'#6b7280', fontWeight:600, textTransform:'uppercase', marginBottom:2 }}>{label}</div>
                    <div style={{ fontSize:14, fontWeight:500 }}>{val}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop:14 }}>
                <div style={{ fontSize:11, color:'#6b7280', fontWeight:600, textTransform:'uppercase', marginBottom:4 }}>{t('Reason')}</div>
                <div style={{ background:'#f9fafb', border:'1px solid #e5e7eb', borderRadius:6, padding:10, fontSize:13 }}>{viewLeave.reason}</div>
              </div>
              {viewLeave.comment && (
                <div style={{ marginTop:10 }}>
                  <div style={{ fontSize:11, color:'#6b7280', fontWeight:600, textTransform:'uppercase', marginBottom:4 }}>{t('Comment')}</div>
                  <div style={{ background:'#f9fafb', border:'1px solid #e5e7eb', borderRadius:6, padding:10, fontSize:13 }}>{viewLeave.comment}</div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setViewLeave(null)}>{t('Close')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {delConfirm && (
        <div className="modal-overlay">
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h2>⚠️ {t('Delete Confirmation')}</h2><button className="modal-close" onClick={() => setDelConfirm(null)}>✕</button></div>
            <div className="modal-body"><p style={{ fontSize:14 }}>{t('Are you sure you want to delete this record?')}</p></div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setDelConfirm(null)}>{t('Cancel')}</button>
              <button className="btn btn-danger" onClick={() => { deleteLeave(delConfirm); setDelConfirm(null); }}>🗑 {t('Delete')}</button>
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
  const { t } = useLanguage();
  const { settings, refreshSettings } = useSettings();
  const fd = makeDateFormatter(settings);
  const { filteredVisits: officeVisits, deleteVisit, addVisit, approveVisit, rejectVisit, getEmployeeName, filteredEmployees: employees, employees: allEmployees } = useData();
  const navigate = useNavigate();

  const [filterStatus,   setFilterStatus]  = useState('all');
  const [viewVisit,      setViewVisit]     = useState(null);
  const [delConfirm,     setDelConfirm]    = useState(null);
  const [showApply,      setShowApply]     = useState(false);
  // Refetch settings right as Apply opens — see LeavePanel's identical effect above.
  useEffect(() => { if (showApply) refreshSettings(); }, [showApply]);
  const [showManualV,    setShowManualV]   = useState(false);
  const [manualVForm,    setManualVForm]   = useState({ employeeId:'', officialVisit:'', visitType:'National', country:'', address:'', description:'', fromDate:'', toDate:'', status:'approved', recommendedBy:'', recommendedDate:'', approvedBy:'', approvedDate:'' });
  const [manualVErrors,  setManualVErrors] = useState({});
  const [manualVToast,   setManualVToast]  = useState(null);
  const manualVFormRef = useRef(null);
  /* Ctrl+S submits the Manual Entry form — same action as the Save button */
  useSaveShortcut(showManualV, () => manualVFormRef.current?.requestSubmit());
  /* ── Inline approve/reject modal ── */
  const [visitActionModal, setVisitActionModal] = useState(null);
  const [visitComment,     setVisitComment]     = useState('');
  const [visitActionToast, setVisitActionToast] = useState(null);

  /* ── Reco/approval config ── */
  const visitRecoConfig = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('ehajiri_reco_approval') || '{}'); } catch { return {}; }
  }, []);
  const isRecoCompulsoryVisit = visitRecoConfig._settings?.isRecoCompulsory || false;
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

  /* ── Apply form state ── */
  const today = getNepalTodayISO();

  /* reco/approval from localStorage */
  const getMyRecoApproval = useCallback(() => {
    const saved = loadRecoApproval();
    const r = saved[currentUser.id]?.reco;
    const a = saved[currentUser.id]?.approval;
    return {
      reco:     Array.isArray(r) ? r : (r ? [r] : []),
      approval: Array.isArray(a) ? a : (a ? [a] : []),
    };
  }, [currentUser.id]);

  const emptyForm = {
    officialVisit: '', visitType: 'National', country: '',
    address: '', description: '', fromDate: today, toDate: today,
    reco: [], approval: [], document: null,
  };
  const [applyForm,    setApplyForm]    = useState(emptyForm);
  const [applyErrors,  setApplyErrors]  = useState({});
  const [applySuccess, setApplySuccess] = useState(false);
  const [submitting,   setSubmitting]   = useState(false);

  /* office visit types from settings */
  const visitTypeOptions = useMemo(() =>
    (settings.officeVisitTypes || []).map(v => v.name || v).filter(Boolean),
  [settings.officeVisitTypes]);

  /* use all employees (not scoped) so reco/approval from any branch/dept can be resolved */
  const getEmpNameForVisit = useCallback((id) =>
    (allEmployees || []).find(e => String(e.id) === String(id))?.fullName || `#${id}`,
  [allEmployees]);

  const handleApplyChange = (field, val) => {
    setApplyForm(p => ({ ...p, [field]: val }));
    setApplyErrors(p => ({ ...p, [field]: '' }));
  };

  const validateApply = () => {
    const e = {};
    if (!applyForm.officialVisit.trim()) e.officialVisit = t('Required field');
    if (!applyForm.address.trim())       e.address       = t('Required field');
    if (!applyForm.description.trim())   e.description   = t('Required field');
    if (!applyForm.fromDate)             e.fromDate      = t('Required field');
    if (!applyForm.toDate)               e.toDate        = t('Required field');
    if (applyForm.fromDate && applyForm.toDate && applyForm.toDate < applyForm.fromDate)
      e.toDate = 'To Date must be on or after From Date';
    if (applyForm.visitType === 'International' && !applyForm.country.trim())
      e.country = t('Required field');
    return e;
  };

  const handleApplySubmit = async (e) => {
    e.preventDefault();
    const errs = validateApply();
    if (Object.keys(errs).length) { setApplyErrors(errs); return; }
    setSubmitting(true);
    await addVisit({
      employeeId:    currentUser.id,
      purpose:       applyForm.officialVisit,
      officialVisit: applyForm.officialVisit,
      visitType:     applyForm.visitType,
      country:       applyForm.visitType === 'International' ? applyForm.country : '',
      address:       applyForm.address,
      location:      applyForm.address,
      description:   applyForm.description,
      reason:        applyForm.description,
      fromDate:      applyForm.fromDate,
      toDate:        applyForm.toDate,
      reco:          applyForm.reco,
      approval:      applyForm.approval,
    });
    setSubmitting(false);
    setApplySuccess(true);
    setTimeout(() => { setShowApply(false); setApplyForm(emptyForm); setApplyErrors({}); setApplySuccess(false); }, 1500);
  };

  const openApply = () => {
    const { reco, approval } = getMyRecoApproval();
    setApplyForm({ ...emptyForm, reco, approval });
    setApplyErrors({}); setApplySuccess(false); setShowApply(true);
  };

  /* ── Grid data ── */
  const displayVisits = officeVisits.filter(v => {
    if (!isManager && String(v.employeeId) !== String(currentUser.id)) return false;
    if (filterStatus !== 'all' && v.status !== filterStatus) return false;
    return true;
  });

  const countByStatus = s => officeVisits.filter(v =>
    (!isManager ? String(v.employeeId) === String(currentUser.id) : true) && (s === 'all' || v.status === s)
  ).length;

  const columns = [
    { field: 'employeeId',  header: t('Name'),          width: 150, render: v => <span style={{ fontWeight:600 }}>{getEmployeeName(v)}</span> },
    { field: 'purpose',     header: 'Official Visit',   width: 150 },
    { field: 'visitType',   header: 'Visit Type',       width: 110, render: v => (
      <span style={{ fontSize:12, fontWeight:600, padding:'2px 8px', borderRadius:8,
        background: v==='International'?'#f5f3ff':'#f0fdf4',
        color: v==='International'?'#7c3aed':'#059669' }}>
        {v==='International'?'🌍':'🇳🇵'} {v||'National'}
      </span>
    )},
    { field: 'country',     header: 'Country',          width: 100, render: v => v||'—' },
    { field: 'address',     header: 'Address',          width: 140, render: v => v||'—' },
    { field: 'fromDate',    header: t('From Date'),     width: 110, render: v => fd(v) },
    { field: 'toDate',      header: t('To Date'),       width: 110, render: v => fd(v) },
    { field: 'appliedDate', header: t('Applied Date'),  width: 110, render: v => fd(v) },
    { field: 'status',      header: t('Status'),        width: 110, render: v => <StatusBadge status={v} /> },
    { field: 'actions', header: t('Actions'), width: 110, filterable:false, sortable:false, render: (_, row) => (
      <div className="dg-actions">
        <button className="dg-action-btn view"   title={t('View')}   onClick={e => { e.stopPropagation(); setViewVisit(row); }}>👁</button>
        {(isManager || row.status === 'pending') && (
          <button className="dg-action-btn delete" title={t('Delete')} onClick={e => { e.stopPropagation(); setDelConfirm(row.id); }}>🗑</button>
        )}
        {row.status === 'pending' && (() => {
          const amApprover    = isApproverForVisit(row.employeeId);
          const amRecommender = isRecommenderForVisit(row.employeeId);
          const canApprove    = amApprover && (!isRecoCompulsoryVisit || !!row.recommendedBy);
          const involved      = amApprover || amRecommender || isManager;
          if (!involved) return null;
          return (
            <>
              <button className="dg-action-btn approve"
                title={!amApprover ? 'You are a recommendator only — approval not permitted'
                       : !canApprove ? 'Awaiting recommendation first' : t('Approve')}
                disabled={!amApprover || !canApprove}
                style={{ opacity: (!amApprover || !canApprove) ? 0.4 : 1, cursor: (!amApprover || !canApprove) ? 'not-allowed' : 'pointer' }}
                onClick={e => { e.stopPropagation(); if (amApprover && canApprove) { setVisitActionModal({ id:row.id, type:'approve', visit:row }); setVisitComment(''); } }}>
                ✓
              </button>
              {(amApprover || isManager) && (
                <button className="dg-action-btn reject" title={t('Reject')}
                  onClick={e => { e.stopPropagation(); setVisitActionModal({ id:row.id, type:'reject', visit:row }); setVisitComment(''); }}>
                  ✗
                </button>
              )}
            </>
          );
        })()}
      </div>
    )},
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
          {isManager && (
            <button className="btn btn-outline btn-sm" onClick={() => navigate('/office-visit/approval')}>
              ✅ {t('Visit Approval')}
            </button>
          )}
          {canManageStaff && (
            <button className="btn btn-sm" onClick={() => { setManualVForm({ employeeId:'', officialVisit:'', visitType:'National', country:'', address:'', description:'', fromDate:today, toDate:today, status:'approved', recommendedBy:'', recommendedDate:'', approvedBy:'', approvedDate:'' }); setManualVErrors({}); setShowManualV(true); }}
              style={{ background:'linear-gradient(135deg,#7c3aed,#6d28d9)', color:'white', border:'none', borderRadius:6, padding:'5px 12px', fontSize:12, fontWeight:700, cursor:'pointer' }}>
              ✍️ Manual Posting
            </button>
          )}
          <button className="btn btn-primary btn-sm" onClick={openApply}>
            + {t('Apply for Visit')}
          </button>
        </div>
      </div>

      <DataGrid columns={columns} data={displayVisits} defaultPageSize={10} showSearch searchPlaceholder={t('Search') + '...'} />

      {/* ── Inline Approve / Reject Modal (Office Visit) ── */}
      {visitActionModal && (
        <div className="modal-overlay">
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>
                {visitActionModal.type === 'approve' ? `✅ ${t('Approve')}` : `❌ ${t('Reject')}`} — {t('Office Visit Application')}
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
                className={`btn ${visitActionModal.type === 'approve' ? 'btn-success' : 'btn-danger'}`}
                onClick={() => {
                  if (visitActionModal.type === 'approve') {
                    approveVisit(visitActionModal.id, currentUser.id, visitComment);
                  } else {
                    rejectVisit(visitActionModal.id, currentUser.id, visitComment);
                  }
                  setVisitActionToast({ msg: visitActionModal.type === 'approve' ? t('Application approved') : t('Application rejected'), type: visitActionModal.type === 'approve' ? 'success' : 'danger' });
                  setTimeout(() => setVisitActionToast(null), 3000);
                  setVisitActionModal(null); setVisitComment('');
                }}>
                {visitActionModal.type === 'approve' ? `✅ ${t('Approve')}` : `❌ ${t('Reject')}`}
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
        const setMV = (f, v) => setManualVForm(p => ({ ...p, [f]: v }));

        const validateMV = () => {
          const e = {};
          if (!manualVForm.employeeId)     e.employeeId     = t('Required field');
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
          });
          setShowManualV(false);
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
        const manualVCfg    = loadRecoApproval()[String(manualVForm.employeeId)] || {};
        const toIdsV         = (v) => (Array.isArray(v) ? v : (v ? [v] : [])).map(String);
        const manualVRecoIds = toIdsV(manualVCfg.reco);
        const manualVApprIds = toIdsV(manualVCfg.approval);
        const manualVRecoOpts = activeEmps.filter(e => manualVRecoIds.includes(String(e.id))).map(e => ({ value: String(e.id), label: e.fullName }));
        const manualVApprOpts = activeEmps.filter(e => manualVApprIds.includes(String(e.id))).map(e => ({ value: String(e.id), label: e.fullName }));
        const visitTypeOpts = (settings.officeVisitTypes || []).map(v => v.name || v).filter(Boolean);
        const empOpts = activeEmps.map(e => ({ value: String(e.id), label: `${e.fullName}${e.employeeId ? ` [${e.employeeId}]` : ''}${e.department ? ` — ${e.department}` : ''}` }));

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
                      <SearchableSelect value={manualVForm.employeeId}
                        onChange={v => setManualVForm(p => ({ ...p, employeeId: v, recommendedBy: '', approvedBy: '' }))}
                        options={empOpts} placeholder="— Search & Select Staff —" />
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
                        min={manualVForm.fromDate} settings={settings} allowPast={isAdmin} onChange={v => setMV('toDate', v)} />
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
                        disabled={!manualVForm.employeeId || manualVRecoOpts.length === 0} />
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
                      <Lbl>Approved By</Lbl>
                      <SearchableSelect value={manualVForm.approvedBy} onChange={v => setMV('approvedBy', v)}
                        options={manualVApprOpts}
                        placeholder={!manualVForm.employeeId ? '— Select staff first —' : manualVApprOpts.length === 0 ? 'No approver configured' : '— Select Approver —'}
                        disabled={!manualVForm.employeeId || manualVApprOpts.length === 0} />
                    </div>
                    <div className="form-group">
                      <Lbl>Approved Date</Lbl>
                      <LeaveDateInput value={manualVForm.approvedDate} settings={settings}
                        allowPast={isAdmin} onChange={v => setMV('approvedDate', v)} />
                    </div>
                  </div>

                  <div className="modal-footer" style={{ padding:'14px 0 0', borderTop:'1px solid #e5e7eb', marginTop:4, display:'flex', justifyContent:'flex-end', gap:8 }}>
                    <button type="button" className="btn btn-outline" onClick={() => setShowManualV(false)}>Cancel</button>
                    <button type="submit" className="btn btn-primary" title="Ctrl+S" style={{ background:'linear-gradient(135deg,#7c3aed,#6d28d9)' }}>
                      💾 <u>S</u>ave
                    </button>
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
            <span>✅</span>{manualVToast.msg}
          </div>
        </div>
      )}

      {/* ── Apply Modal ── */}
      {showApply && (() => {
        const Lbl = ({ children, required }) => (
          <div style={{ fontSize:12, fontWeight:600, color:'#374151', marginBottom:4 }}>
            {children}{required && <span style={{ color:'#dc2626', marginLeft:2 }}>*</span>}
          </div>
        );
        const Err = ({ msg }) => msg ? <div style={{ fontSize:11, color:'#dc2626', marginTop:3 }}>{msg}</div> : null;

        /* ── Searchable single-select dropdown ── */
        const SearchSelect = ({ value, onChange, options, placeholder, error }) => {
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
          const filtered = srch ? options.filter(o => o.toLowerCase().includes(srch.toLowerCase())) : options;
          itemRefs.current = [];

          const select = (v) => { onChange(v); setOpen(false); setSrch(''); setActiveIndex(-1); };
          const openWithHighlight = () => {
            const idx = filtered.indexOf(value);
            setActiveIndex(idx >= 0 ? idx : (filtered.length ? 0 : -1));
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
              setActiveIndex(i => (filtered.length ? (i + 1) % filtered.length : -1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActiveIndex(i => (filtered.length ? (i - 1 + filtered.length) % filtered.length : -1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              if (activeIndex >= 0 && filtered[activeIndex] !== undefined) select(filtered[activeIndex]);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setOpen(false);
            }
          };
          React.useEffect(() => {
            if (open && activeIndex >= 0) itemRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
          }, [activeIndex, open]);
          React.useEffect(() => { if (open) setActiveIndex(filtered.length ? 0 : -1); }, [srch]);
          return (
            <div ref={ref} style={{ position:'relative' }}>
              <div tabIndex={0} onClick={() => { open ? setOpen(false) : openWithHighlight(); }}
                onKeyDown={handleTriggerKeyDown}
                style={{
                  display:'flex', alignItems:'center', justifyContent:'space-between',
                  padding:'9px 12px', border:`1.5px solid ${error?'#f87171':open?'#1a56db':'#d1d5db'}`,
                  borderRadius:7, background:'white', cursor:'pointer', fontSize:13, minHeight:42,
                  color: value ? '#1f2937' : '#9ca3af', fontWeight: value ? 600 : 400,
                  boxShadow: open ? '0 0 0 2px #bfdbfe' : 'none', outline:'none', userSelect:'none',
                }}>
                <span>{value || placeholder}</span>
                <span style={{ fontSize:9, color:'#9ca3af', flexShrink:0 }}>{open?'▲':'▼'}</span>
              </div>
              {open && (
                <div style={{ position:'absolute', top:'calc(100% + 3px)', left:0, right:0, zIndex:9999,
                  background:'white', border:'1.5px solid #1a56db', borderRadius:8,
                  boxShadow:'0 8px 24px rgba(0,0,0,.18)', maxHeight:240, display:'flex', flexDirection:'column' }}>
                  <div style={{ padding:'6px 8px', borderBottom:'1px solid #e5e7eb', flexShrink:0 }}>
                    <input autoFocus type="text" value={srch} onChange={e=>setSrch(e.target.value)}
                      placeholder="Search..." onClick={e=>e.stopPropagation()} onKeyDown={handleSearchKeyDown}
                      style={{ width:'100%', border:'1px solid #d1d5db', borderRadius:5, padding:'5px 9px',
                        fontSize:13, outline:'none', boxSizing:'border-box' }} />
                  </div>
                  <div style={{ overflowY:'auto', flex:1 }}>
                    {filtered.map((opt, i) => (
                      <div key={opt} ref={el => itemRefs.current[i] = el}
                        onMouseDown={e=>{e.preventDefault(); select(opt);}}
                        onMouseEnter={() => setActiveIndex(i)}
                        style={{ padding:'9px 12px', fontSize:13, cursor:'pointer', borderBottom:'1px solid #f3f4f6',
                          background: value===opt ? '#eff6ff' : (i===activeIndex ? '#f8fafc' : 'white'),
                          color: value===opt ? '#1e40af' : '#374151', fontWeight: value===opt ? 700 : 400 }}>
                        {opt}
                      </div>
                    ))}
                    {filtered.length === 0 && (
                      <div style={{ padding:'10px 12px', fontSize:12, color:'#9ca3af', textAlign:'center' }}>No results found</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        };

        return (
          <div className="modal-overlay">
            <div className="modal modal-lg" style={{ maxWidth:680, maxHeight:'92vh', overflowY:'auto' }} onClick={e => e.stopPropagation()}>
              <div className="modal-header" style={{ position:'sticky', top:0, zIndex:10 }}>
                <h2>🏢 {t('Apply for Visit')}</h2>
                <button className="modal-close" onClick={() => setShowApply(false)}>✕</button>
              </div>
              <div className="modal-body">
                {applySuccess && (
                  <div className="alert alert-success" style={{ marginBottom:14 }}>
                    <span>✅</span> {t('Application submitted successfully')}
                  </div>
                )}

                {/* Staff Info */}
                <div style={{ background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:10, padding:'12px 16px', marginBottom:18 }}>
                  <div style={{ fontSize:11, fontWeight:700, color:'#6b7280', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:10 }}>
                    👤 Staff Information
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10 }}>
                    {[['Name',currentUser.fullName],['Staff ID',currentUser.employeeId],['Post',currentUser.position||'—'],['Department',currentUser.department||'—'],['Branch',currentUser.branch||'—']].map(([l,v])=>(
                      <div key={l}><div style={{ fontSize:10, color:'#9ca3af', marginBottom:2 }}>{l}</div><div style={{ fontSize:13, fontWeight:600, color:'#1f2937' }}>{v}</div></div>
                    ))}
                  </div>
                </div>

                <form onSubmit={handleApplySubmit}>
                  {/* Official Visit */}
                  <div className="form-group">
                    <Lbl required>Official Visit</Lbl>
                    <SearchSelect
                      value={applyForm.officialVisit}
                      onChange={v => handleApplyChange('officialVisit', v)}
                      options={visitTypeOptions}
                      placeholder="— Select Official Visit Type —"
                      error={!!applyErrors.officialVisit}
                    />
                    <Err msg={applyErrors.officialVisit} />
                  </div>

                  {/* Visit Type */}
                  <div className="form-group">
                    <Lbl required>Visit Type</Lbl>
                    <div style={{ display:'flex', gap:10, marginTop:4 }}>
                      {['National','International'].map(vt => (
                        <label key={vt} style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', userSelect:'none',
                          padding:'8px 18px', border:`1.5px solid ${applyForm.visitType===vt?'#1a56db':'#d1d5db'}`,
                          borderRadius:8, background: applyForm.visitType===vt ? '#eff6ff' : 'white',
                          fontSize:13, fontWeight: applyForm.visitType===vt ? 700 : 400,
                          color: applyForm.visitType===vt ? '#1a56db' : '#374151', transition:'all .12s' }}>
                          <input type="radio" name="visitTypeModal" value={vt}
                            checked={applyForm.visitType===vt}
                            onChange={() => handleApplyChange('visitType', vt)}
                            style={{ accentColor:'#1a56db', width:14, height:14 }} />
                          {vt==='National' ? '🇳🇵 National' : '🌍 International'}
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Country — only if International */}
                  {applyForm.visitType === 'International' && (
                    <div className="form-group">
                      <Lbl required>Country</Lbl>
                      <input type="text" className={`form-control ${applyErrors.country?'error':''}`}
                        placeholder="Enter country name..." value={applyForm.country}
                        onChange={e => handleApplyChange('country', e.target.value)} style={{ fontSize:13 }} />
                      <Err msg={applyErrors.country} />
                    </div>
                  )}

                  {/* Address */}
                  <div className="form-group">
                    <Lbl required>Address</Lbl>
                    <input type="text" className={`form-control ${applyErrors.address?'error':''}`}
                      placeholder="Enter visit address / location..." value={applyForm.address}
                      onChange={e => handleApplyChange('address', e.target.value)} style={{ fontSize:13 }} />
                    <Err msg={applyErrors.address} />
                  </div>

                  {/* Description */}
                  <div className="form-group">
                    <Lbl required>Description</Lbl>
                    <textarea className={`form-control ${applyErrors.description?'error':''}`}
                      rows={3} placeholder="Enter description / purpose of the visit..."
                      value={applyForm.description}
                      onChange={e => handleApplyChange('description', e.target.value)}
                      style={{ fontSize:13 }} />
                    <Err msg={applyErrors.description} />
                  </div>

                  {/* From / To Date */}
                  <div className="form-row">
                    <div className="form-group">
                      <Lbl required>From Date</Lbl>
                      <LeaveDateInput value={applyForm.fromDate} min={today}
                        error={!!applyErrors.fromDate} settings={settings}
                        onChange={v => handleApplyChange('fromDate', v)} />
                      <Err msg={applyErrors.fromDate} />
                    </div>
                    <div className="form-group">
                      <Lbl required>To Date</Lbl>
                      <LeaveDateInput value={applyForm.toDate} min={applyForm.fromDate||today}
                        error={!!applyErrors.toDate} settings={settings}
                        onChange={v => handleApplyChange('toDate', v)} />
                      <Err msg={applyErrors.toDate} />
                    </div>
                  </div>

                  {/* Recommendator & Approval */}
                  <div className="form-row" style={{ marginBottom:14 }}>
                    <div>
                      <Lbl>Recommendator</Lbl>
                      <div style={{ background:'#f8fafc', border:'1px solid #e5e7eb', borderRadius:8, padding:'8px 12px', minHeight:36 }}>
                        {applyForm.reco.length > 0
                          ? <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
                              {applyForm.reco.map(id => (
                                <span key={id} style={{ background:'#eff6ff', color:'#1a56db', borderRadius:10, padding:'2px 10px', fontSize:12, fontWeight:600 }}>
                                  {getEmpNameForVisit(id)}
                                </span>
                              ))}
                            </div>
                          : <span style={{ fontSize:12, color:'#9ca3af' }}>— Not configured —</span>
                        }
                      </div>
                    </div>
                    <div>
                      <Lbl>Approval Authority</Lbl>
                      <div style={{ background:'#f8fafc', border:'1px solid #e5e7eb', borderRadius:8, padding:'8px 12px', minHeight:36 }}>
                        {applyForm.approval.length > 0
                          ? <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
                              {applyForm.approval.map(id => (
                                <span key={id} style={{ background:'#d1fae5', color:'#065f46', borderRadius:10, padding:'2px 10px', fontSize:12, fontWeight:600 }}>
                                  {getEmpNameForVisit(id)}
                                </span>
                              ))}
                            </div>
                          : <span style={{ fontSize:12, color:'#9ca3af' }}>— Not configured —</span>
                        }
                      </div>
                    </div>
                  </div>

                  {/* Document Upload */}
                  <div className="form-group">
                    <Lbl>Document / Attachment</Lbl>
                    <label style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px',
                      border:'1.5px dashed #d1d5db', borderRadius:8, cursor:'pointer',
                      background: applyForm.document ? '#f0fdf4' : '#fafafa', transition:'border .15s' }}
                      onMouseEnter={e => e.currentTarget.style.borderColor='#0d9488'}
                      onMouseLeave={e => e.currentTarget.style.borderColor='#d1d5db'}>
                      <input type="file" accept="image/*,.pdf,.doc,.docx" style={{ display:'none' }}
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
                        <button type="button"
                          onClick={e => { e.preventDefault(); handleApplyChange('document', null); }}
                          style={{ marginLeft:'auto', background:'none', border:'none', cursor:'pointer', color:'#9ca3af', fontSize:16 }}>✕</button>
                      )}
                    </label>
                  </div>

                  <div style={{ display:'flex', gap:10, justifyContent:'flex-end', marginTop:6 }}>
                    <button type="button" className="btn btn-outline" onClick={() => setShowApply(false)}>{t('Cancel')}</button>
                    <button type="submit" className="btn btn-primary" disabled={submitting||applySuccess}>
                      {submitting ? `⏳ ${t('Please wait...')}` : `📤 ${t('Submit')}`}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        );
      })()}

      {/* View Modal */}
      {viewVisit && (
        <div className="modal-overlay">
          <div className="modal modal-md" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>🏢 {t('Office Visit Application')} #{viewVisit.id}</h2>
              <button className="modal-close" onClick={() => setViewVisit(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
                {[
                  [t('Name'),          getEmployeeName(viewVisit.employeeId)],
                  ['Official Visit',   viewVisit.officialVisit || viewVisit.purpose || '—'],
                  ['Visit Type',       <span style={{ fontSize:12, fontWeight:700, padding:'2px 8px', borderRadius:8,
                    background: viewVisit.visitType==='International'?'#f5f3ff':'#f0fdf4',
                    color: viewVisit.visitType==='International'?'#7c3aed':'#059669' }}>
                    {viewVisit.visitType==='International'?'🌍':'🇳🇵'} {viewVisit.visitType||'National'}
                  </span>],
                  ['Country',          viewVisit.country || '—'],
                  ['Address',          viewVisit.address || viewVisit.location || '—'],
                  [t('From Date'),     fd(viewVisit.fromDate)],
                  [t('To Date'),       fd(viewVisit.toDate)],
                  [t('Applied Date'),  fd(viewVisit.appliedDate)],
                  [t('Status'),        <StatusBadge status={viewVisit.status} />],
                  [t('Approved By'),   getEmployeeName(viewVisit.approvedBy) || '—'],
                ].map(([label, val], i) => (
                  <div key={i}>
                    <div style={{ fontSize:11, color:'#6b7280', fontWeight:600, textTransform:'uppercase', marginBottom:2 }}>{label}</div>
                    <div style={{ fontSize:14, fontWeight:500 }}>{val}</div>
                  </div>
                ))}
              </div>
              {(viewVisit.description || viewVisit.reason) && (
                <div style={{ marginTop:14 }}>
                  <div style={{ fontSize:11, color:'#6b7280', fontWeight:600, textTransform:'uppercase', marginBottom:4 }}>Description</div>
                  <div style={{ background:'#f9fafb', border:'1px solid #e5e7eb', borderRadius:6, padding:10, fontSize:13 }}>{viewVisit.description||viewVisit.reason}</div>
                </div>
              )}
              {viewVisit.comment && (
                <div style={{ marginTop:10 }}>
                  <div style={{ fontSize:11, color:'#6b7280', fontWeight:600, textTransform:'uppercase', marginBottom:4 }}>{t('Comment')}</div>
                  <div style={{ background:'#f9fafb', border:'1px solid #e5e7eb', borderRadius:6, padding:10, fontSize:13 }}>{viewVisit.comment}</div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setViewVisit(null)}>{t('Close')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {delConfirm && (
        <div className="modal-overlay">
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h2>⚠️ {t('Delete Confirmation')}</h2><button className="modal-close" onClick={() => setDelConfirm(null)}>✕</button></div>
            <div className="modal-body"><p style={{ fontSize:14 }}>{t('Are you sure you want to delete this record?')}</p></div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setDelConfirm(null)}>{t('Cancel')}</button>
              <button className="btn btn-danger" onClick={() => { deleteVisit(delConfirm); setDelConfirm(null); }}>🗑 {t('Delete')}</button>
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
