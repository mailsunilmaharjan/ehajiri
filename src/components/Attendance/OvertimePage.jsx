import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useAuth }     from '../../context/AuthContext.jsx';
import { useLanguage } from '../../context/LanguageContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import { useData }     from '../../context/DataContext.jsx';
import api             from '../../api/client.js';
import useDateFormat   from '../../hooks/useDateFormat.js';
import NepaliDatePicker from '../Common/NepaliDatePicker.jsx';
import SearchableSelect from '../Common/SearchableSelect.jsx';
import Avatar from '../Common/Avatar.jsx';
import DataGrid from '../DataGrid/DataGrid.jsx';
import useSaveShortcut from '../../hooks/useSaveShortcut.js';
import useRecoApproval from '../../hooks/useRecoApproval.js';
import { getNepalNow, getNepalTodayISO } from '../../utils/dateUtils.js';

const pad2   = (n) => String(Math.round(Math.abs(n))).padStart(2, '0');
const toHHMM = (m) => `${pad2(Math.floor(Math.abs(m) / 60))}:${pad2(Math.abs(m) % 60)}`;

/* Parse "HH:MM" → minutes */
const parseHHMM = (str) => {
  if (!str) return 0;
  const [h, m] = str.split(':').map(Number);
  return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
};

const STATUS_COLOR = {
  pending  : { bg:'#fef3c7', color:'#92400e', border:'#fde68a', label:'Pending'  },
  approved : { bg:'#d1fae5', color:'#065f46', border:'#6ee7b7', label:'Approved' },
  rejected : { bg:'#fee2e2', color:'#991b1b', border:'#fca5a5', label:'Rejected' },
};
const StatusBadge = ({ status }) => {
  const c = STATUS_COLOR[status] || STATUS_COLOR.pending;
  return (
    <span style={{ background:c.bg, color:c.color, border:`1px solid ${c.border}`,
      borderRadius:8, padding:'2px 10px', fontSize:11, fontWeight:700 }}>
      {c.label}
    </span>
  );
};

/* Signed OT cell: green for +, red for – */
const SignedOT = ({ value, formatted }) => {
  if (!formatted || formatted === '+00:00' || formatted === '-00:00') {
    return <span style={{ color:'#d1d5db' }}>—</span>;
  }
  const pos = value >= 0;
  return (
    <span style={{ color: pos ? '#059669' : '#dc2626' }}>
      {formatted}
    </span>
  );
};

/* Portal tooltip — appears above the hovered element, avoids overflow clipping */
const OTTooltip = ({ text, children }) => {
  const [rect, setRect] = React.useState(null);
  if (!text) return <>{children}</>;
  return (
    <span style={{ position:'relative', display:'inline-flex', cursor:'help' }}
      onMouseEnter={e => setRect(e.currentTarget.getBoundingClientRect())}
      onMouseLeave={() => setRect(null)}>
      {children}
      {rect && createPortal(
        <div style={{
          position:'fixed',
          left: rect.left + rect.width / 2,
          top:  rect.top - 10,
          transform: 'translateX(-50%) translateY(-100%)',
          background:'#1e293b', color:'#f1f5f9',
          borderRadius:8, padding:'8px 14px',
          fontSize:12, lineHeight:1.6, fontWeight:500,
          maxWidth:320, whiteSpace:'pre-wrap',
          boxShadow:'0 6px 20px rgba(0,0,0,.3)',
          zIndex:999999, pointerEvents:'none',
          textAlign:'center',
        }}>
          {text}
          <div style={{
            position:'absolute', top:'100%', left:'50%',
            transform:'translateX(-50%)',
            width:0, height:0,
            borderLeft:'6px solid transparent',
            borderRight:'6px solid transparent',
            borderTop:'6px solid #1e293b',
          }} />
        </div>,
        document.body
      )}
    </span>
  );
};

const OvertimePage = () => {
  const { currentUser, isManager, canApprove, isAdmin } = useAuth();
  const { language, t } = useLanguage();
  const { settings, updateSettings } = useSettings();
  const { getEmployeeName, getEmployeeById, employees: allEmployees } = useData();
  const fd = useDateFormat();

  /* Recommender/Approver configured per staff member (Staff → Reco/Approval
     setup) — same source + same "0 configured / exactly 1 / pick from a
     dropdown when there's more than 1" pattern LeaveApplyModal/LeaveVisitPage
     already use for the normal Leave flow, reused here for consistency. */
  const { getRecoIds: getOtRecoIds, getApprovalIds: getOtApprovalIds, refresh: refreshOtRecoApproval } = useRecoApproval();
  const getRecoApprovalIds = (empId) => {
    return { reco: getOtRecoIds(empId), approval: getOtApprovalIds(empId) };
  };

  /* ── Recommend → Approve two-stage gating (same rules as Leave/Office
     Visit Approval): a row's Approve requires the same-row-configured
     approver, and — while Recommendation Compulsory is on — the record must
     already be recommended, and the configured recommender can never also
     be the one to approve (separation of duties), mirrored server-side in
     authorizeRecoAction. admin/superAdmin bypass the assignment checks
     (same PRIVILEGED_ROLES bypass authorizeRecoAction grants server-side). ── */
  const isRecoCompulsory = settings.recoApprovalCompulsory || false;
  const isRecommenderFor = (empId) => isAdmin || getOtRecoIds(empId).includes(String(currentUser.id));
  const isApproverFor    = (empId) => isAdmin || getOtApprovalIds(empId).includes(String(currentUser.id));
  // Whether this employee has ANY recommender configured — if not,
  // Recommendation Compulsory is unsatisfiable for them (nobody exists who
  // could ever recommend it), so it must not block their approver. Mirrors
  // authorizeRecoAction's server-side check.
  const hasRecommenderFor = (empId) => getOtRecoIds(empId).length > 0;
  const canApproveRow    = (row) => !isRecoCompulsory || !!row.recommendedBy || !hasRecommenderFor(row.employeeId);
  /* Full eligibility to approve a specific row — used both for the row's
     own Approve button and to keep bulk selection/"Approve All" from
     silently doing what the row-level button itself refuses to do. */
  const canActOnRowApprove = (row) => {
    if (!isApproverFor(row.employeeId)) return false;
    // dual-role block — only meaningful when a recommender is configured
    if (!isAdmin && isRecoCompulsory && hasRecommenderFor(row.employeeId) && isRecommenderFor(row.employeeId)) return false;
    return canApproveRow(row);
  };
  const L  = (np, en) => language === 'np' ? np : en;
  const useNP = settings.defaultCalendar === 'np';

  const now    = getNepalNow();
  const today  = getNepalTodayISO();
  const firstOfMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;

  const [startDate,  setStartDate]  = useState(firstOfMonth);
  const [endDate,    setEndDate]    = useState(today);
  const [records,    setRecords]    = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [selected,   setSelected]   = useState(new Set()); // set of "empId-date" keys
  const [actionModal, setActionModal] = useState(null);
  const [comment,    setComment]    = useState('');
  const [toast,      setToast]      = useState(null);

  /* Manager-edited Approved OT values: key → minutes */
  const [editedOT, setEditedOT] = useState({});
  /* Grant Leave modal — combines what used to be two separate dialogs
     ("Select the Leave" then a generic "Approve Overtime" confirmation)
     into one: pick the leave type + days right where all the OT context
     (time in/out, calculated OT, recommender/approver) is already shown,
     and submit directly — no separate staged/confirm step. */
  const [leaveModal,  setLeaveModal]  = useState(null); // { rec } while the Grant Leave modal is open
  // useRecoApproval only fetches once, when this hook first mounts — this page
  // stays mounted for the whole session, so without this, opening Grant Leave
  // any time after a staff member's Recommendator/Approval config was set (or
  // changed) elsewhere would show "Not configured" even though it genuinely is.
  useEffect(() => { if (leaveModal) refreshOtRecoApproval(); }, [leaveModal]); // eslint-disable-line react-hooks/exhaustive-deps
  const [leaveFormType, setLeaveFormType] = useState('');
  const [leaveFormDays, setLeaveFormDays] = useState('1');
  const [leaveComment,  setLeaveComment]  = useState('');
  const [leaveReco,     setLeaveReco]     = useState(''); // selected Recommendator employee id
  const [leaveApproval, setLeaveApproval] = useState(''); // selected Approval Authority employee id

  const [showAdvSearchModal, setShowAdvSearchModal] = useState(false);
  const [advFilters, setAdvFilters] = useState({ departments:[], branches:[], positions:[], grades:[], genders:[], modes:[], timingTypes:[] });

  const DEFAULT_OT_SETTINGS = {
    minOTBeforeIn  : '00:00',
    maxOTBeforeIn  : '00:00',
    minOTAfterOut  : '00:00',
    maxOTAfterOut  : '00:00',
    weekendPresent : 'ot',
    holidayPresent : 'ot',
  };
  const [showOTSettings,  setShowOTSettings]  = useState(false);
  /* Start with pure defaults — useEffect below syncs from API once loaded */
  const [otSettings,      setOtSettings]      = useState({ ...DEFAULT_OT_SETTINGS });
  const [otSettingsSaving,setOtSettingsSaving]= useState(false);

  /* Sync from API (overrides localStorage cache) — only trusted source is the DB */
  useEffect(() => {
    setOtSettings({ ...DEFAULT_OT_SETTINGS, ...(settings.ot_settings || {}) });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.ot_settings]);

  const saveOTSettings = async () => {
    setOtSettingsSaving(true);
    try {
      await api.put('/settings', { ot_settings: otSettings });
      updateSettings({ ot_settings: otSettings }); // keep context in sync
      showToast('OT Settings saved');
      setShowOTSettings(false);
    } catch (e) { showToast(e.message || 'Save failed', 'error'); }
    finally { setOtSettingsSaving(false); }
  };

  /* Ctrl+S saves the OT Settings modal — same action as the Save Settings button */
  useSaveShortcut(showOTSettings, saveOTSettings);

  const showToast = (msg, type='success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async () => {
    if (!startDate || !endDate) return;
    setLoading(true); setError(''); setSelected(new Set()); setEditedOT({});
    try {
      const res = await api.get(`/overtime?startDate=${startDate}&endDate=${endDate}`);
      setRecords(res.records || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [startDate, endDate]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    let rs = filterStatus === 'all' ? records : records.filter(r => r.status === filterStatus);
    if (advFilters.departments.length) rs = rs.filter(r => advFilters.departments.includes(r.department  || ''));
    if (advFilters.branches.length)    rs = rs.filter(r => advFilters.branches.includes(r.branchShort   || ''));
    if (advFilters.positions.length)   rs = rs.filter(r => advFilters.positions.includes(r.position     || ''));
    if (advFilters.grades.length)      rs = rs.filter(r => advFilters.grades.includes(r.grade           || ''));
    if (advFilters.genders.length)     rs = rs.filter(r => advFilters.genders.includes(r.gender         || ''));
    if (advFilters.modes.length)       rs = rs.filter(r => advFilters.modes.includes(r.mode             || ''));
    if (advFilters.timingTypes.length) rs = rs.filter(r => advFilters.timingTypes.includes(r.timingType || ''));
    return rs;
  }, [records, filterStatus, advFilters]);

  const totalApprovedOT = useMemo(() =>
    records.filter(r => r.status === 'approved')
           .reduce((s, r) => s + (r.approvedOTMins || 0), 0),
  [records]);

  const deptOpts       = useMemo(() => [...new Set(records.map(r=>r.department).filter(v=>v&&v!=='—'))].sort(), [records]);
  const branchOpts2    = useMemo(() => [...new Set(records.map(r=>r.branchShort).filter(v=>v&&v!=='—'))].sort(), [records]);
  const posOpts        = useMemo(() => [...new Set(records.map(r=>r.position).filter(v=>v&&v!=='—'))].sort(), [records]);
  const gradeOpts      = useMemo(() => [...new Set(records.map(r=>r.grade).filter(v=>v&&v!=='—'))].sort(), [records]);
  const modeOpts       = useMemo(() => [...new Set(records.map(r=>r.mode).filter(v=>v&&v!=='—'))].sort(), [records]);
  const timingTypeOpts = useMemo(() => [...new Set(records.map(r=>r.timingType).filter(v=>v&&v!=='—'))].sort(), [records]);
  const genderOpts     = ['male','female','other'];
  const activeFilterCount =
    advFilters.departments.length + advFilters.branches.length + advFilters.positions.length +
    advFilters.grades.length + advFilters.genders.length + advFilters.modes.length + advFilters.timingTypes.length;
  const clearAdvFilters = () => setAdvFilters({ departments:[], branches:[], positions:[], grades:[], genders:[], modes:[], timingTypes:[] });

  const [dayTypeFilter, setDayTypeFilter] = useState(''); // '' | 'weekend' | 'holiday'

  /* ── Apply OT settings (weekend/holiday leave-vs-ot rule, weekday min/max
     thresholds) to a list of raw records — shared by displayRecords (the
     grid, scoped to the current status/advFilters) and otAdjustedRecords
     above (tab-badge counts, scoped to nothing) so both agree on which
     records actually qualify. ── */
  const applyOtSettings = useCallback((list) => {
    const cfg      = otSettings;
    const wkDays   = settings.defaultWeekends || ['Sat'];
    /* Map of date → holiday name for tooltip */
    const holMap   = new Map(
      (settings.publicHolidays || []).map(h => [
        (h.date || h.startDate || '').split('T')[0],
        h.name || h.title || 'Public Holiday',
      ])
    );
    const parseHM = str => parseHHMM(str);
    const maxOut  = parseHM(cfg.maxOTAfterOut);
    const maxIn   = parseHM(cfg.maxOTBeforeIn);
    const minOut  = parseHM(cfg.minOTAfterOut);
    const minIn   = parseHM(cfg.minOTBeforeIn);

    const result = [];
    for (const r of list) {
      // A roster-assigned Day Off/Night Off (r.rosterOffType, from the Duty
      // Roster — a personal rest day, distinct from the company-wide weekend
      // pattern) counts as a weekend day too, same OT rules and all.
      const isWeekend    = wkDays.includes(r.day) || !!r.rosterOffType;
      const holidayName  = holMap.get(r.date);
      const isHoliday    = !!holidayName;
      const isSpecial    = isWeekend || isHoliday;

      // "Provide Next Day Leave" rows used to be dropped here entirely
      // (`continue`d out) — now they're kept and rendered with a
      // "Select the Leave" action instead of a time-based Approved OT box
      // (see the Approved OT column render + Grant Leave modal), so a
      // manager can actually act on them instead of the record just
      // vanishing from the grid.
      const isLeaveMode = isSpecial && (isHoliday ? cfg.holidayPresent : cfg.weekendPresent) === 'leave';
      // A weekend/holiday has no assigned shift at all, so "Don't calculate shift —
      // show only Working Hours as OT" means the FULL punch-in-to-punch-out
      // span counts as OT — not just the sliver outside the default shift's
      // window, which is what the shift-relative net below computes and is
      // often ~0 when someone simply works their usual hours on a day off.
      const totalWorkedMins = Math.max(0, parseHHMM(r.timeOut) - parseHHMM(r.timeIn));

      /* OT in IN and OT in OUT are independent credits — each reflects only
         what happened at that specific punch (early arrival / late
         departure), never reduced by the other side, so a big early
         arrival still shows in full even if the same person also left
         early that day. OT Duration / Approved OT (the payable total) is
         simply both of these added together — not netted against
         lateness/early-departure — so the total always matches what the
         two columns show. */
      const effOTOutIndep = Math.max(0, r.otInOUTMins);
      const effOTInIndep  = Math.max(0, r.otInINMins);
      const capOTOutIndep = effOTOutIndep >= minOut ? (maxOut > 0 ? Math.min(effOTOutIndep, maxOut) : effOTOutIndep) : 0;
      const capOTInIndep  = effOTInIndep  >= minIn  ? (maxIn  > 0 ? Math.min(effOTInIndep,  maxIn)  : effOTInIndep)  : 0;

      const net = isSpecial ? totalWorkedMins : (capOTInIndep + capOTOutIndep);

      /* Skip pending records with no qualifying OT on EITHER side — but only
         on a regular day, and checked against the independent figures, not
         the netted total: a 3h early arrival must stay visible for review
         even on a day the same person left early enough that the netted
         total comes out to 0 — the record itself (and its raw numbers) is
         what's being reviewed, not just whatever the total happens to be.
         A weekend/holiday Present record stays visible regardless, since
         presence itself is what's being reviewed there. */
      if (!isSpecial && capOTInIndep === 0 && capOTOutIndep === 0 && r.status === 'pending') continue;

      /* OT IN display: show independent capped OT IN if positive, show raw
         lateness if negative, show — if early arrival didn't qualify */
      let dispOTIn, dispOTInFmt;
      if (capOTInIndep > 0) {
        dispOTIn = capOTInIndep;
        dispOTInFmt = `+${toHHMM(capOTInIndep)}`;
      } else if (!isSpecial && r.otInINMins < 0) {
        dispOTIn = r.otInINMins;           // show late info in red (weekday only — no assigned shift to be "late" for on a day off)
        dispOTInFmt = r.otInINFormatted;
      } else {
        dispOTIn = 0;
        dispOTInFmt = '+00:00';            // → SignedOT renders as —
      }

      /* OT OUT display: same pattern, mirrored — show independent capped OT
         OUT if positive, show raw early-departure if negative, else 0. */
      let dispOTOut, dispOTOutFmt;
      if (capOTOutIndep > 0) {
        dispOTOut = capOTOutIndep;
        dispOTOutFmt = `+${toHHMM(capOTOutIndep)}`;
      } else if (!isSpecial && r.otInOUTMins < 0) {
        dispOTOut = r.otInOUTMins;         // show early-departure info in red (weekday only — same reasoning as OT IN above)
        dispOTOutFmt = r.otInOUTFormatted;
      } else {
        dispOTOut = 0;
        dispOTOutFmt = '+00:00';
      }

      result.push({
        ...r,
        otInINMins: dispOTIn, otInOUTMins: dispOTOut,
        otInINFormatted:  dispOTInFmt,
        otInOUTFormatted: dispOTOutFmt,
        otMinutes: net, otFormatted: toHHMM(net),
        approvedOTMins: r.approvalId ? r.approvedOTMins : net,
        _leaveMode:   isLeaveMode,
        _dayType:     isHoliday ? 'holiday' : (isWeekend ? 'weekend' : undefined),
        _holidayName: isHoliday ? holidayName : null,
        // Same 'weekend' bucket for settings/filtering/counting purposes —
        // just a more accurate label so a Tuesday tagged "Weekend" because
        // of a roster Day Off doesn't look like a mistake to the manager.
        _weekendLabel: r.rosterOffType === 'nightOff' ? 'Night Off'
          : r.rosterOffType === 'dayOff' ? 'Day Off'
          : 'Weekend',
        _tooltipOTIn: (maxIn > 0 && capOTInIndep > 0 && capOTInIndep < effOTInIndep)
          ? `You worked ${toHHMM(effOTInIndep)} before shift start\nMaximum OT IN is ${cfg.maxOTBeforeIn} as per setting`
          : null,
        _tooltipOTOut: (maxOut > 0 && capOTOutIndep > 0 && capOTOutIndep < effOTOutIndep)
          ? `You worked ${toHHMM(effOTOutIndep)} after shift end\nMaximum OT OUT is ${cfg.maxOTAfterOut} as per setting`
          : null,
      });
    }
    return result;
  }, [otSettings, settings.defaultWeekends, settings.publicHolidays]);

  const displayRecords = useMemo(() => applyOtSettings(filtered), [filtered, applyOtSettings]);

  /* Tab badges / "Select all N pending" must count only records
     applyOtSettings will actually keep — e.g. a weekend/holiday "Present"
     record is dropped entirely when Weekend/Public Holiday is configured as
     "leave" rather than "ot". Counting raw `records` here (as before) let a
     tenant with weekendPresent/holidayPresent set to "leave" show
     "Pending (1242)" with an actionable "Select all 1242 pending" bar while
     the grid itself rendered empty — the count and the grid must agree on
     what "pending" means. */
  const otAdjustedRecords = useMemo(() => applyOtSettings(records), [records, applyOtSettings]);

  const counts = useMemo(() => ({
    all     : otAdjustedRecords.length,
    pending : otAdjustedRecords.filter(r => r.status === 'pending').length,
    approved: otAdjustedRecords.filter(r => r.status === 'approved').length,
    rejected: otAdjustedRecords.filter(r => r.status === 'rejected').length,
  }), [otAdjustedRecords]);

  const weekendCount = useMemo(() => displayRecords.filter(r => r._dayType === 'weekend').length, [displayRecords]);
  const holidayCount = useMemo(() => displayRecords.filter(r => r._dayType === 'holiday').length, [displayRecords]);

  const visibleRecords = useMemo(() => {
    if (!dayTypeFilter) return displayRecords;
    return displayRecords.filter(r => r._dayType === dayTypeFilter);
  }, [displayRecords, dayTypeFilter]);

  /* Get approved OT minutes for a record (edited or default) */
  const getApprovedOT = (rec) => {
    const key = `${rec.employeeId}-${rec.date}`;
    return key in editedOT ? editedOT[key] : rec.approvedOTMins;
  };

  /* Opens the single Grant Leave form, seeded from whatever's already granted
     (re-opening lets the manager change a prior grant — approve-leave
     reverses the old one server-side before applying the new one) */
  const openLeaveModal = (row) => {
    setLeaveFormType(row.leaveTypeCode || '');
    setLeaveFormDays(row.leaveDays != null ? String(row.leaveDays) : '1');
    setLeaveComment('');
    const { reco, approval } = getRecoApprovalIds(row.employeeId);
    setLeaveReco(reco.length === 1 ? reco[0] : '');
    setLeaveApproval(approval.length === 1 ? approval[0] : '');
    setLeaveModal({ rec: row });
  };

  /* One click does everything the old two-modal flow needed two clicks for:
     validate, submit to /approve-leave (which sets status='approved' and
     credits the balance server-side), close, reload. */
  const submitLeaveGrant = async () => {
    const rec = leaveModal?.rec;
    if (!rec) return;
    const days = Math.round(parseFloat(leaveFormDays) * 10) / 10;
    if (!leaveFormType) { showToast('Select a leave type', 'error'); return; }
    if (!(days > 0) || days > 2 || !Number.isInteger(days * 2)) {
      showToast('Days must be greater than 0, at most 2, in half-day steps', 'error');
      return;
    }
    const { reco: recoIds, approval: approvalIds } = getRecoApprovalIds(rec.employeeId);
    if (recoIds.length > 1 && !leaveReco)         { showToast('Select a Recommendator', 'error'); return; }
    if (approvalIds.length > 1 && !leaveApproval) { showToast('Select an Approval Authority', 'error'); return; }

    // No dedicated recommended_by/approval_by columns on overtime_approvals —
    // fold the picked names into the comment so who-recommended/approved
    // this specific grant still ends up in the audit trail.
    const recoName     = leaveReco     ? getEmployeeName(leaveReco)     : (recoIds[0]     ? getEmployeeName(recoIds[0])     : null);
    const approvalName = leaveApproval ? getEmployeeName(leaveApproval) : (approvalIds[0] ? getEmployeeName(approvalIds[0]) : null);
    const recoNote = [recoName && `Recommended by ${recoName}`, approvalName && `Approval ${approvalName}`].filter(Boolean).join(' · ');
    const finalComment = [recoNote, leaveComment.trim()].filter(Boolean).join(' — ');

    try {
      const res = await api.post('/overtime/approve-leave', {
        employeeId: rec.employeeId, date: rec.date,
        leaveTypeCode: leaveFormType, leaveDays: days,
        approvedBy: currentUser.id, comment: finalComment,
      });
      showToast(`Leave granted — ${days} day(s)${res?.newBalance != null ? `, new balance ${res.newBalance}` : ''}`);
      setLeaveModal(null);
      load();
    } catch (e) { showToast(e.message, 'error'); }
  };

  /* Approve button click — a leave-mode row goes straight to the Grant Leave
     form (there's no time-based OT to confirm there); everything else opens
     the normal approve/reject confirmation modal as before. */
  const handleApproveClick = (row) => {
    if (row._leaveMode) { openLeaveModal(row); return; }
    setActionModal({ rec: row, type: 'approve' });
  };

  /* ── Recommend a single record — same insert-or-update-by-(employee,date)
     shape as approve-inline handles below, since a calculated record has no
     DB row (and no approvalId) until someone first acts on it. ── */
  const handleRecommendClick = async (row) => {
    try {
      if (row.approvalId) {
        await api.patch(`/overtime/${row.approvalId}/recommend`, {});
      } else {
        await api.post('/overtime/recommend-inline', {
          employeeId: row.employeeId, date: row.date, otMinutes: getApprovedOT(row),
        });
      }
      showToast('OT recommended');
      load();
    } catch (e) { showToast(e.message, 'error'); }
  };

  /* ── Approve / Reject single record (non-leave-mode rows only — a
     leave-mode row's Approve goes straight to openLeaveModal instead) ── */
  const handleAction = async (type) => {
    const rec = actionModal?.rec;
    if (!rec) return;
    try {
      const approvedMins = getApprovedOT(rec);
      if (rec.approvalId) {
        await api.patch(`/overtime/${rec.approvalId}/${type}`, {
          comment, approvedOTMins: approvedMins,
        });
      } else {
        await api.post('/overtime/approve-inline', {
          employeeId: rec.employeeId, date: rec.date,
          otMinutes: approvedMins, action: type, comment,
        });
      }
      showToast(`OT ${type === 'approve' ? 'Approved' : 'Rejected'} — ${toHHMM(approvedMins)} recorded`);
      setActionModal(null); setComment('');
      load();
    } catch (e) { showToast(e.message, 'error'); }
  };

  /* Reject doesn't need the recommend-first/dual-role checks approve does —
     just the same configured-approver requirement the row's own Reject
     button already uses. Used as the (safe, superset) eligibility for bulk
     selection below; approve narrows further via canActOnRowApprove. */
  const canActOnRowReject = (row) => isApproverFor(row.employeeId);

  /* ── Bulk approve / reject ── */
  const handleBulk = async (type) => {
    if (!selected.size) return;
    let recs = visibleRecords.filter(r => selected.has(`${r.employeeId}-${r.date}`));
    if (type === 'approve') recs = recs.filter(canActOnRowApprove);
    if (!recs.length) { showToast('No eligible OT records to ' + type, 'error'); return; }
    try {
      await api.post('/overtime/bulk-approve', {
        records   : recs.map(r => ({ employeeId: r.employeeId, date: r.date, otMinutes: getApprovedOT(r) })),
        action    : type,
        approvedBy: currentUser.id,
        comment   : '',
      });
      showToast(`${recs.length} OT record${recs.length!==1?'s':''} ${type==='approve'?'approved':'rejected'}`);
      setSelected(new Set());
      load();
    } catch (e) { showToast(e.message, 'error'); }
  };

  const toggleSelectAll = () => {
    const pendingKeys = visibleRecords.filter(r => r.status === 'pending' && canActOnRowReject(r)).map(r => `${r.employeeId}-${r.date}`);
    if (pendingKeys.every(k => selected.has(k))) {
      setSelected(prev => { const n = new Set(prev); pendingKeys.forEach(k => n.delete(k)); return n; });
    } else {
      setSelected(prev => { const n = new Set(prev); pendingKeys.forEach(k => n.add(k)); return n; });
    }
  };

  /* ── "Approve All" (all pending / Weekend / Public Holiday) — unlike the
     checkbox-based Approve Selected above, these act on every pending record
     matching the chosen scope in one go, and first ask who recommended and
     approved the batch (with dates) rather than silently stamping the
     current admin + today, since the person clicking this may just be
     recording a decision that recommender/approver already made elsewhere. */
  const [bulkApproveModal, setBulkApproveModal] = useState(null); // { scope, label, recs }
  const [bulkRecoBy,     setBulkRecoBy]     = useState('');
  const [bulkRecoDate,   setBulkRecoDate]   = useState(today);
  const [bulkApprovedBy, setBulkApprovedBy] = useState('');
  const [bulkApprovedDate, setBulkApprovedDate] = useState(today);

  const openBulkApprove = (scope, label) => {
    // Non-admin: only records they're actually eligible to approve — the
    // server now enforces this too (skips anything else), so this just
    // keeps the modal from showing rows that would silently do nothing.
    const recs = visibleRecords.filter(r =>
      r.status === 'pending' && (scope === 'all' || r._dayType === scope) && (isAdmin || canActOnRowApprove(r))
    );
    if (!recs.length) { showToast('No pending OT records to approve', 'error'); return; }
    setBulkRecoBy(''); setBulkRecoDate(today);
    setBulkApprovedBy(String(currentUser.id)); setBulkApprovedDate(today);
    setBulkApproveModal({ scope, label, recs });
  };

  const confirmBulkApprove = async () => {
    if (!bulkApproveModal) return;
    const { recs } = bulkApproveModal;
    try {
      const res = await api.post('/overtime/bulk-approve', {
        records        : recs.map(r => ({ employeeId: r.employeeId, date: r.date, otMinutes: getApprovedOT(r) })),
        action         : 'approve',
        // Recording someone else as approver/recommender only actually
        // applies for admin/superAdmin — the server records everyone else
        // as themselves regardless of what's picked here.
        approvedBy     : bulkApprovedBy ? Number(bulkApprovedBy) : currentUser.id,
        approvedDate   : bulkApprovedDate || null,
        recommendedBy  : bulkRecoBy ? Number(bulkRecoBy) : null,
        recommendedDate: bulkRecoBy ? (bulkRecoDate || null) : null,
        comment        : '',
      });
      const count = res?.count ?? recs.length;
      const skipped = res?.skipped || 0;
      showToast(`${count} OT record${count!==1?'s':''} approved` + (skipped ? ` — ${skipped} skipped (not your assigned approval)` : ''));
      setBulkApproveModal(null);
      load();
    } catch (e) { showToast(e.message, 'error'); }
  };

  const DateInput = ({ value, onChange }) => {
    if (useNP) return <NepaliDatePicker value={value} onChange={onChange} maxToday={false} />;
    return (
      <input type="date" className="form-control" value={value}
        onChange={e => onChange(e.target.value)}
        style={{ fontSize:13, height:36 }} />
    );
  };

  const canAct = isManager || canApprove;

  /* ── Column definitions ── */
  const columns = [
    /* Staff — name + Post, Dept, Branch below */
    {
      field: 'fullName', header: L('नाम','Staff'), width: 170,
      render: (v, row) => (
        <div>
          <div style={{ color:'#111827', display:'flex', alignItems:'center', gap:6 }}>
            <Avatar photo={getEmployeeById(row.employeeId)?.profilePhoto} name={v} size={20} />
            {v}
          </div>
          <div style={{ fontSize:10, color:'#9ca3af', marginTop:2,
            display:'flex', gap:4, flexWrap:'nowrap',
            overflow:'hidden', maxWidth:'100%' }}>
            {row.postShort   && row.postShort   !== '—' && (
              <span title={row.postShort}
                style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flexShrink:1 }}>
                {row.postShort}
              </span>
            )}
            {row.deptShort   && row.deptShort   !== '—' && (
              <span title={row.deptShort}
                style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flexShrink:2, flexGrow:0 }}>
                · {row.deptShort}
              </span>
            )}
          </div>
        </div>
      ),
    },

    /* Shift — short name only */
    {
      field: 'shiftName', header: L('सिफ्ट','Shift'), width: 100,
      render: (v, row) => (
        <div style={{ fontSize:12 }}>
          <div style={{ fontWeight:600, color:'#374151' }}>{v}</div>
          <div style={{ color:'#9ca3af', fontSize:10 }}>{row.shiftStart} – {row.shiftEnd}</div>
        </div>
      ),
    },

    /* Date */
    {
      field: 'date', header: L('मिति','Date'), width: 110,
      render: v => <span style={{ fontWeight:600 }}>{fd(v)}</span>,
    },

    /* Day */
    {
      field: 'day', header: L('बार','Day'), width: 90,
      render: (v, row) => (
        <div style={{ lineHeight:1.3 }}>
          <div style={{ color:'#6b7280', fontWeight:700 }}>{v}</div>
          {row._dayType === 'weekend' && (
            <span style={{ fontSize:10, fontWeight:700, color:'#92400e',
              background:'#fef3c7', border:'1px solid #fde68a',
              borderRadius:4, padding:'1px 6px', marginTop:3, display:'inline-block' }}>
              {row._weekendLabel || 'Weekend'}
            </span>
          )}
          {row._dayType === 'holiday' && (
            <OTTooltip text={row._holidayName || 'Public Holiday'}>
              <span style={{ fontSize:10, fontWeight:700, color:'#065f46',
                background:'#d1fae5', border:'1px solid #6ee7b7',
                borderRadius:4, padding:'1px 6px', marginTop:3,
                display:'inline-block', cursor:'help' }}>
                Public Holiday
              </span>
            </OTTooltip>
          )}
        </div>
      ),
    },

    /* Time In */
    {
      field: 'timeIn', header: L('आगमन','Time In'), width: 80,
      render: v => (
        <span style={{ background:'#f0fdf4', color:'#065f46', border:'1px solid #bbf7d0',
          borderRadius:6, padding:'2px 8px', fontSize:12, fontWeight:600 }}>
          {v}
        </span>
      ),
    },

    /* OT in IN: positive (early) = green, negative (late) = red */
    {
      field: 'otInINFormatted', header: L('OT IN','OT in IN'), width: 80, align:'center',
      render: (v, row) => (
        <OTTooltip text={row._tooltipOTIn || null}>
          <SignedOT value={row.otInINMins} formatted={v} />
        </OTTooltip>
      ),
    },

    /* Time Out */
    {
      field: 'timeOut', header: L('प्रस्थान','Time Out'), width: 80,
      render: v => (
        <span style={{ background:'#eff6ff', color:'#0369a1', border:'1px solid #bfdbfe',
          borderRadius:6, padding:'2px 8px', fontSize:12, fontWeight:600 }}>
          {v}
        </span>
      ),
    },

    /* OT in OUT: positive (late out) = green, negative (early) = red */
    {
      field: 'otInOUTFormatted', header: L('OT OUT','OT in OUT'), width: 85, align:'center',
      render: (v, row) => (
        <OTTooltip text={row._tooltipOTOut || null}>
          <SignedOT value={row.otInOUTMins} formatted={v} />
        </OTTooltip>
      ),
    },

    /* Calculated OT Duration */
    {
      field: 'otFormatted', header: L('OT अवधि','OT Duration'), width: 90, align:'center',
      render: (v, row) => (
        <span style={{
          color: row._dayType ? '#7c3aed' : '#0369a1',
          fontWeight: row._dayType ? 700 : 400 }}>
          {v}
        </span>
      ),
    },

    /* Approved OT — plain editable text box, or a "Select the Leave" action
       for a weekend/holiday row under the "Provide Next Day Leave" rule */
    {
      field: 'approvedOTMins', header: L('अनु. OT','Approved OT'), width: 130, align:'center',
      filterable:false, sortable:false,
      render: (_, row) => {
        if (row._leaveMode) {
          const granted = row.leaveTypeCode && row.leaveDays != null;
          const ltName = granted
            ? ((settings.leaveTypeConfigs || []).find(lt => lt.shortName === row.leaveTypeCode)?.name || row.leaveTypeCode)
            : null;
          return (
            <button onClick={() => openLeaveModal(row)}
              style={granted ? {
                background:'#f0fdf4', border:'1px solid #86efac', color:'#065f46',
                borderRadius:6, padding:'3px 10px', fontSize:11.5, fontWeight:700, cursor:'pointer',
              } : {
                background:'none', border:'1px dashed #93c5fd', color:'#1a56db',
                borderRadius:6, padding:'3px 10px', fontSize:11.5, fontWeight:600, cursor:'pointer',
              }}>
              {granted ? `🏖 ${ltName} · ${row.leaveDays} day${row.leaveDays !== 1 ? 's' : ''}` : 'Select the Leave →'}
            </button>
          );
        }
        const key = `${row.employeeId}-${row.date}`;
        const currentMins = key in editedOT ? editedOT[key] : row.approvedOTMins;
        const displayVal  = toHHMM(currentMins);
        return (
          <input
            type="text"
            defaultValue={displayVal}
            key={`${key}-${row.approvedOTMins}`}
            onBlur={e => {
              const entered = e.target.value.trim();
              const mins = entered.includes(':') ? parseHHMM(entered) : (parseInt(entered) || 0);
              setEditedOT(prev => ({ ...prev, [key]: Math.max(0, mins) }));
              e.target.value = toHHMM(Math.max(0, mins));
            }}
            className="form-control"
            style={{ width:75, textAlign:'center', fontSize:12.5, padding:'2px 6px' }}
          />
        );
      },
    },

    /* Status */
    {
      field: 'status', header: L('स्थिति','Status'), width: 100,
      render: (v, row) => (
        <OTTooltip text={row.comment ? `💬 ${row.comment}` : null}>
          <div>
            <StatusBadge status={v} />
            {isRecoCompulsory && v === 'pending' && hasRecommenderFor(row.employeeId) && (
              row.recommendedBy
                ? <div style={{ fontSize:10, color:'#059669', marginTop:2, fontWeight:600 }}>✓ {row.recommendedByName || getEmployeeName(row.recommendedBy)}</div>
                : <div style={{ fontSize:10, color:'#92400e', marginTop:2, fontWeight:600 }}>⏳ Awaiting Reco</div>
            )}
          </div>
        </OTTooltip>
      ),
    },

    /* Approved By — name plus the date the decision was made */
    {
      field: 'approvedByName', header: L('स्वीकृतकर्ता','Approved By'), width: 130,
      render: (v, row) => row.status === 'pending'
        ? <span style={{ color:'#d1d5db' }}>—</span>
        : (
          <div style={{ fontSize:12, lineHeight:1.4 }}>
            <div>{v || '—'}</div>
            {row.approvedDate && (
              <div style={{ fontSize:10, color:'#9ca3af' }}>{fd(row.approvedDate)}</div>
            )}
          </div>
        ),
    },

    /* Actions */
    canAct ? {
      field: 'actions', header: L('कार्य','Actions'), width: 130, filterable:false, sortable:false,
      render: (_, row) => {
        const amReco       = isRecommenderFor(row.employeeId);
        const canReject     = canActOnRowReject(row);
        const canApproveNow = canActOnRowApprove(row);

        if (row.status === 'approved') return canReject ? (
          <button onClick={() => setActionModal({ rec:row, type:'reject' })}
            style={{ background:'none', border:'1px solid #fca5a5', color:'#dc2626',
              borderRadius:6, padding:'3px 10px', fontSize:11, cursor:'pointer', fontWeight:600 }}>
            ✗ Reject
          </button>
        ) : <span style={{ fontSize:11, color:'#9ca3af' }}>—</span>;

        if (row.status === 'rejected') return canApproveNow ? (
          <button onClick={() => handleApproveClick(row)}
            style={{ background:'none', border:'1px solid #6ee7b7', color:'#059669',
              borderRadius:6, padding:'3px 10px', fontSize:11, cursor:'pointer', fontWeight:600 }}>
            ✓ Approve
          </button>
        ) : <span style={{ fontSize:11, color:'#9ca3af' }}>—</span>;

        if (!amReco && !canReject) return <span style={{ fontSize:11, color:'#9ca3af' }}>—</span>;
        return (
          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
            {amReco && !row.recommendedBy && (
              <button onClick={() => handleRecommendClick(row)} title="Recommend"
                style={{ background:'#059669', border:'none', color:'#fff',
                  borderRadius:6, padding:'3px 8px', fontSize:11, cursor:'pointer', fontWeight:700 }}>
                👍
              </button>
            )}
            {canApproveNow && (
              <button onClick={() => handleApproveClick(row)}
                style={{ background:'#d1fae5', border:'none', color:'#065f46',
                  borderRadius:6, padding:'3px 10px', fontSize:11, cursor:'pointer', fontWeight:700 }}>
                ✓
              </button>
            )}
            {canReject && (
              <button onClick={() => setActionModal({ rec:row, type:'reject' })}
                style={{ background:'#fee2e2', border:'none', color:'#dc2626',
                  borderRadius:6, padding:'3px 10px', fontSize:11, cursor:'pointer', fontWeight:700 }}>
                ✗
              </button>
            )}
          </div>
        );
      },
    } : null,
  ].filter(Boolean);

  return (
    <div className="page-container">
      {/* ── Header ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">⏱️ {L('ओभरटाइम स्वीकृति','Overtime (OT) Approval')}</h1>
        </div>
        <div style={{ display:'flex', gap:12, alignItems:'flex-end', flexWrap:'wrap' }}>
          <div>
            <div style={{ fontSize:12, fontWeight:600, color:'#374151', marginBottom:4 }}>
              {L('देखि','From Date')}
            </div>
            <DateInput value={startDate} onChange={setStartDate} />
          </div>
          <div>
            <div style={{ fontSize:12, fontWeight:600, color:'#374151', marginBottom:4 }}>
              {L('सम्म','To Date')}
            </div>
            <DateInput value={endDate} onChange={setEndDate} />
          </div>
          <button className="btn btn-primary" onClick={load} disabled={loading} style={{ height:36 }}>
            🔃 {loading ? 'Loading…' : L('पुनः लोड','Refresh')}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background:'#fef2f2', border:'1px solid #fca5a5', borderRadius:8,
          padding:'10px 14px', marginBottom:14, color:'#991b1b', fontWeight:600, fontSize:13 }}>
          ❌ {error}
        </div>
      )}

      {/* ── Summary filter chips ── */}
      <div style={{ display:'flex', gap:10, marginBottom:14, flexWrap:'wrap', alignItems:'center' }}>
        {[
          { key:'all',      label:L('सबै','All'),            color:'#374151', bg:'#f9fafb' },
          { key:'pending',  label:L('विचाराधीन','Pending'),  color:'#92400e', bg:'#fef3c7' },
          { key:'approved', label:L('स्वीकृत','Approved'),   color:'#065f46', bg:'#d1fae5' },
          { key:'rejected', label:L('अस्वीकृत','Rejected'),  color:'#991b1b', bg:'#fee2e2' },
        ].map(({ key, label, color, bg }) => (
          <button key={key} onClick={() => setFilterStatus(key)}
            style={{ background: filterStatus===key ? color : bg,
              color: filterStatus===key ? '#fff' : color,
              border:`1px solid ${color}44`, borderRadius:8,
              padding:'5px 14px', fontSize:12, fontWeight:700, cursor:'pointer' }}>
            {label} ({counts[key]})
          </button>
        ))}
        {/* divider */}
        <div style={{ width:1, height:22, background:'#e5e7eb', alignSelf:'center' }} />

        <button onClick={() => setDayTypeFilter(p => p === 'weekend' ? '' : 'weekend')}
          style={{ display:'flex', alignItems:'center', gap:5, padding:'5px 12px',
            background: dayTypeFilter==='weekend' ? '#fef3c7' : '#f9fafb',
            border: `1.5px solid ${dayTypeFilter==='weekend' ? '#f59e0b' : '#d1d5db'}`,
            borderRadius:8, fontSize:12, fontWeight:700,
            color: dayTypeFilter==='weekend' ? '#92400e' : '#6b7280', cursor:'pointer' }}>
          🏖 Weekend
          {weekendCount > 0 && (
            <span style={{ background: dayTypeFilter==='weekend' ? '#92400e' : '#9ca3af',
              color:'#fff', borderRadius:10, fontSize:10, fontWeight:700, padding:'1px 6px' }}>
              {weekendCount}
            </span>
          )}
        </button>

        <button onClick={() => setDayTypeFilter(p => p === 'holiday' ? '' : 'holiday')}
          style={{ display:'flex', alignItems:'center', gap:5, padding:'5px 12px',
            background: dayTypeFilter==='holiday' ? '#d1fae5' : '#f9fafb',
            border: `1.5px solid ${dayTypeFilter==='holiday' ? '#10b981' : '#d1d5db'}`,
            borderRadius:8, fontSize:12, fontWeight:700,
            color: dayTypeFilter==='holiday' ? '#065f46' : '#6b7280', cursor:'pointer' }}>
          🎉 Public Holiday
          {holidayCount > 0 && (
            <span style={{ background: dayTypeFilter==='holiday' ? '#065f46' : '#9ca3af',
              color:'#fff', borderRadius:10, fontSize:10, fontWeight:700, padding:'1px 6px' }}>
              {holidayCount}
            </span>
          )}
        </button>

        {activeFilterCount > 0 && (
          <button onClick={clearAdvFilters}
            style={{ padding:'5px 14px', background:'#fff5f5', border:'1px solid #fca5a5',
              borderRadius:8, fontSize:12, fontWeight:700, color:'#dc2626', cursor:'pointer' }}>
            ✕ Remove Filters
          </button>
        )}
        <div style={{ marginLeft:'auto', display:'flex', gap:10, alignItems:'center' }}>
          {totalApprovedOT > 0 && (
            <div style={{ background:'#e0f2fe', border:'1px solid #7dd3fc',
              borderRadius:8, padding:'5px 14px', fontSize:12, fontWeight:700, color:'#0369a1' }}>
              ✅ Total Approved OT: {toHHMM(totalApprovedOT)}
            </div>
          )}
          <button onClick={() => setShowOTSettings(true)}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 14px',
              background:'#f9fafb', border:'1.5px solid #d1d5db', borderRadius:8,
              fontSize:12, fontWeight:700, color:'#374151', cursor:'pointer' }}>
            ⚙ OT Setting
          </button>
        </div>
      </div>

      {/* ── Bulk action bar ── */}
      {canAct && selected.size > 0 && (
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12,
          background:'#eff6ff', border:'1px solid #93c5fd', borderRadius:8, padding:'8px 14px' }}>
          <span style={{ fontSize:13, fontWeight:600, color:'#1d4ed8' }}>
            {selected.size} selected
          </span>
          <button onClick={() => handleBulk('approve')}
            style={{ background:'#059669', color:'#fff', border:'none', borderRadius:6,
              padding:'5px 14px', fontSize:12, fontWeight:700, cursor:'pointer' }}>
            ✓ Approve Selected
          </button>
          <button onClick={() => handleBulk('reject')}
            style={{ background:'#dc2626', color:'#fff', border:'none', borderRadius:6,
              padding:'5px 14px', fontSize:12, fontWeight:700, cursor:'pointer' }}>
            ✗ Reject Selected
          </button>
          <button onClick={() => setSelected(new Set())}
            style={{ background:'none', border:'1px solid #93c5fd', color:'#1d4ed8',
              borderRadius:6, padding:'5px 10px', fontSize:12, cursor:'pointer' }}>
            Clear
          </button>
        </div>
      )}

      {/* Select all pending */}
      {canAct && counts.pending > 0 && (
        <div style={{ marginBottom:8 }}>
          <button onClick={toggleSelectAll}
            style={{ background:'none', border:'none', color:'#1a56db', fontSize:12,
              fontWeight:600, cursor:'pointer', padding:0 }}>
            {counts.pending === selected.size
              ? '☑ Deselect all pending'
              : `☐ Select all ${counts.pending} pending`}
          </button>
          <span style={{ fontSize:11, color:'#9ca3af', marginLeft:10 }}>
            💡 Edit "Approved OT" field before approving to set custom OT minutes
          </span>
        </div>
      )}

      {/* ── Grid ── */}
      {loading
        ? <div style={{ textAlign:'center', padding:'60px 0', color:'#9ca3af' }}>
            <div style={{ fontSize:36, marginBottom:10 }}>⏱️</div>
            <div style={{ fontWeight:600 }}>Loading overtime records…</div>
          </div>
        : visibleRecords.length === 0
          ? <div style={{ textAlign:'center', padding:'60px 0', color:'#9ca3af' }}>
              <div style={{ fontSize:36, marginBottom:10 }}>🎉</div>
              <div style={{ fontWeight:600, fontSize:14, color:'#374151' }}>
                {records.length === 0
                  ? 'No overtime found for this period'
                  : `No ${filterStatus} OT records`}
              </div>
              <div style={{ fontSize:12, marginTop:6 }}>
                OT is detected when staff checkout after shift end or check-in before shift start.
              </div>
            </div>
          : <DataGrid
              columns={columns}
              data={visibleRecords}
              defaultPageSize={20}
              showSearch
              searchPlaceholder={L('खोज्नुहोस्…','Search staff…')}
              toolbar={
                <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                  {canAct && counts.pending > 0 && (
                    <>
                      <button onClick={() => openBulkApprove('all', 'All Pending OT')}
                        style={{ display:'flex', alignItems:'center', gap:6, height:34,
                          padding:'0 14px', background:'#059669', border:'none',
                          borderRadius:7, fontSize:13, fontWeight:700, color:'#fff', cursor:'pointer' }}>
                        ✅ All Approve
                      </button>
                      {weekendCount > 0 && (
                        <button onClick={() => openBulkApprove('weekend', 'Weekend OT')}
                          style={{ display:'flex', alignItems:'center', gap:6, height:34,
                            padding:'0 14px', background:'#f59e0b', border:'none',
                            borderRadius:7, fontSize:13, fontWeight:700, color:'#fff', cursor:'pointer' }}>
                          🏖 All Approve (Weekend)
                        </button>
                      )}
                      {holidayCount > 0 && (
                        <button onClick={() => openBulkApprove('holiday', 'Public Holiday OT')}
                          style={{ display:'flex', alignItems:'center', gap:6, height:34,
                            padding:'0 14px', background:'#10b981', border:'none',
                            borderRadius:7, fontSize:13, fontWeight:700, color:'#fff', cursor:'pointer' }}>
                          🎉 All Approve (Public Holiday)
                        </button>
                      )}
                    </>
                  )}
                  <button onClick={() => setShowAdvSearchModal(true)}
                    style={{ display:'flex', alignItems:'center', gap:6, height:34,
                      padding:'0 14px', background: activeFilterCount>0 ? '#eff6ff' : '#f9fafb',
                      border:`1.5px solid ${activeFilterCount>0 ? '#1a56db' : '#d1d5db'}`,
                      borderRadius:7, fontSize:13, fontWeight:600,
                      color: activeFilterCount>0 ? '#1a56db' : '#374151', cursor:'pointer' }}>
                    <svg viewBox="0 0 20 20" fill="currentColor" width="13" height="13">
                      <path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L12 11.414V15a1 1 0 01-.553.894l-4 2A1 1 0 016 17v-5.586L3.293 6.707A1 1 0 013 6V3z" clipRule="evenodd"/>
                    </svg>
                    {t('Advanced Search')}
                    {activeFilterCount > 0 && (
                      <span style={{ background:'#1a56db', color:'#fff', borderRadius:10,
                        fontSize:10, fontWeight:700, padding:'1px 7px', marginLeft:2 }}>
                        {activeFilterCount}
                      </span>
                    )}
                  </button>
                </div>
              }
            />
      }

      {/* ── Single action modal ── */}
      {actionModal && (
        <div className="modal-overlay">
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>
                {actionModal.type==='approve' ? '✅ Approve' : '❌ Reject'} Overtime
              </h2>
              <button className="modal-close" onClick={() => setActionModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ background:'#f9fafb', borderRadius:8, padding:12, marginBottom:14 }}>
                <div style={{ fontWeight:700, fontSize:14, color:'#111827', marginBottom:6 }}>
                  {actionModal.rec.fullName}
                  <span style={{ fontSize:11, color:'#9ca3af', marginLeft:8 }}>
                    {actionModal.rec.postShort} · {actionModal.rec.deptShort}
                  </span>
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6, fontSize:13 }}>
                  <div><span style={{ color:'#9ca3af' }}>Date:</span> <strong>{fd(actionModal.rec.date)}</strong> ({actionModal.rec.day})</div>
                  <div><span style={{ color:'#9ca3af' }}>Shift:</span> {actionModal.rec.shiftName}</div>
                  <div><span style={{ color:'#9ca3af' }}>Time In:</span> <strong style={{ color:'#059669' }}>{actionModal.rec.timeIn}</strong></div>
                  <div><span style={{ color:'#9ca3af' }}>Time Out:</span> <strong style={{ color:'#0369a1' }}>{actionModal.rec.timeOut}</strong></div>
                  <div><span style={{ color:'#9ca3af' }}>OT in IN:</span>
                    <strong style={{ color: actionModal.rec.otInINMins>=0 ? '#059669':'#dc2626', marginLeft:4 }}>
                      {actionModal.rec.otInINFormatted}
                    </strong>
                  </div>
                  <div><span style={{ color:'#9ca3af' }}>OT in OUT:</span>
                    <strong style={{ color: actionModal.rec.otInOUTMins>=0 ? '#059669':'#dc2626', marginLeft:4 }}>
                      {actionModal.rec.otInOUTFormatted}
                    </strong>
                  </div>
                  <div style={{ gridColumn:'1/-1' }}>
                    <span style={{ color:'#9ca3af' }}>Calculated OT:</span>
                    <strong style={{ color:'#0369a1', fontSize:16, marginLeft:6 }}>{actionModal.rec.otFormatted}</strong>
                  </div>
                </div>

                {/* Editable Approved OT — this modal is never opened for a
                    leave-mode row's Approve (that goes straight to the Grant
                    Leave form instead), so this is always the time-based flow. */}
                {actionModal.type === 'approve' && (
                  <div style={{ marginTop:10, padding:'8px 10px', background:'#eff6ff',
                    border:'1px solid #bfdbfe', borderRadius:8 }}>
                    <div style={{ fontSize:11, fontWeight:600, color:'#1d4ed8', marginBottom:4 }}>
                      Approved OT (editable — in HH:MM)
                    </div>
                    <input
                      type="text"
                      defaultValue={toHHMM(getApprovedOT(actionModal.rec))}
                      onChange={e => {
                        const key  = `${actionModal.rec.employeeId}-${actionModal.rec.date}`;
                        const mins = e.target.value.includes(':')
                          ? parseHHMM(e.target.value)
                          : (parseInt(e.target.value) || 0);
                        setEditedOT(prev => ({ ...prev, [key]: Math.max(0, mins) }));
                      }}
                      style={{ width:'100%', fontFamily:'monospace', fontSize:15, fontWeight:800,
                        textAlign:'center', border:'1px solid #93c5fd', borderRadius:6,
                        padding:'4px 10px', color:'#1d4ed8', outline:'none' }}
                    />
                    <div style={{ fontSize:10, color:'#6b7280', marginTop:3 }}>
                      Enter HH:MM or minutes. This value will be recorded in reports.
                    </div>
                  </div>
                )}
              </div>

              <div className="form-group">
                <label style={{ fontSize:12, fontWeight:600, color:'#374151', display:'block', marginBottom:4 }}>
                  Comment (optional)
                </label>
                <textarea className="form-control" rows={2} value={comment}
                  onChange={e => setComment(e.target.value)}
                  placeholder="Enter reason or note…" style={{ fontSize:13 }} autoFocus />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => { setActionModal(null); setComment(''); }}>
                Cancel
              </button>
              <button
                className={`btn ${actionModal.type==='approve' ? 'btn-success' : 'btn-danger'}`}
                onClick={() => handleAction(actionModal.type)}>
                {actionModal.type==='approve'
                  ? `✅ Approve (${toHHMM(getApprovedOT(actionModal.rec))})`
                  : '❌ Confirm Reject'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Grant Leave modal — one form covering everything that used to take
           two (pick the leave, see the OT context, confirm) for a "Provide
           Next Day Leave" weekend/holiday record. Submitting calls
           /overtime/approve-leave directly, which sets status='approved'
           and credits the balance in the same step. ── */}
      {leaveModal && (() => {
        const rec = leaveModal.rec;
        const { reco: recoIds, approval: approvalIds } = getRecoApprovalIds(rec.employeeId);
        /* Aligned "label : value" line — same look for every Time/OT row so
           the two columns (IN-side, OUT-side) read as a clean little table. */
        const InfoLine = ({ label, value, color }) => (
          <div style={{ display:'flex', fontSize:13, marginBottom:4 }}>
            <span style={{ color:'#9ca3af', width:78, flexShrink:0 }}>{label}</span>
            <span style={{ color:'#9ca3af', marginRight:8 }}>:</span>
            <strong style={{ color: color || '#111827' }}>{value}</strong>
          </div>
        );
        /* Recommendator/Approval picker — identical 0/1/many pattern as the
           normal Leave Apply form: nothing configured shows a placeholder,
           exactly one shows a fixed badge, more than one is an actual
           dropdown to pick which one applies to this specific grant. */
        const RecoPicker = ({ label, ids, value, onChange, bg, border, chipBg, chipColor }) => (
          <div style={{ flex:1, minWidth:160 }}>
            <div style={{ fontSize:10, fontWeight:700, color:'#9ca3af', textTransform:'uppercase', marginBottom:4 }}>{label}</div>
            {ids.length === 0 && (
              <div style={{ background:'#f8fafc', border:'1px solid #e5e7eb', borderRadius:8, padding:'8px 10px' }}>
                <span style={{ fontSize:12.5, color:'#9ca3af' }}>— Not configured —</span>
              </div>
            )}
            {ids.length === 1 && (
              <div style={{ background:bg, border:`1px solid ${border}`, borderRadius:8, padding:'7px 10px' }}>
                <span style={{ background:chipBg, color:chipColor, borderRadius:10, padding:'2px 10px 2px 5px', fontSize:12.5, fontWeight:600, display:'flex', alignItems:'center', gap:6, width:'fit-content' }}>
                  <Avatar photo={getEmployeeById(ids[0])?.profilePhoto} name={getEmployeeName(ids[0])} size={18} />
                  {getEmployeeName(ids[0])}
                </span>
              </div>
            )}
            {ids.length > 1 && (
              <SearchableSelect className="form-control" value={value} onChange={onChange}
                options={ids.map(id => ({ value: String(id), label: getEmployeeName(id), photo: getEmployeeById(id)?.profilePhoto }))}
                placeholder={`— Select ${label} —`} showAvatar />
            )}
          </div>
        );
        return (
          <div className="modal-overlay" onClick={() => setLeaveModal(null)}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth:560, width:'94vw' }}>
              <div className="modal-header">
                <h2>🏖 Select the Leave</h2>
                <button className="modal-close" onClick={() => setLeaveModal(null)}>✕</button>
              </div>
              <div className="modal-body">
                <div style={{ background:'#f9fafb', borderRadius:8, padding:12, marginBottom:14 }}>
                  <div style={{ fontWeight:700, fontSize:14, color:'#111827', marginBottom:8 }}>
                    {rec.fullName}
                    <span style={{ fontSize:11, color:'#9ca3af', marginLeft:8 }}>
                      {rec.postShort} · {rec.deptShort}
                    </span>
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6, fontSize:13, marginBottom:10 }}>
                    <div><span style={{ color:'#9ca3af' }}>Date:</span> <strong>{fd(rec.date)}</strong> ({rec.day})</div>
                    <div><span style={{ color:'#9ca3af' }}>Shift:</span> {rec.shiftName}</div>
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 20px' }}>
                    <div>
                      <InfoLine label="Time IN"  value={rec.timeIn}  color="#059669" />
                      <InfoLine label="OT in IN" value={rec.otInINFormatted} color={rec.otInINMins>=0 ? '#059669':'#dc2626'} />
                    </div>
                    <div>
                      <InfoLine label="Time OUT"  value={rec.timeOut} color="#0369a1" />
                      <InfoLine label="OT in OUT" value={rec.otInOUTFormatted} color={rec.otInOUTMins>=0 ? '#059669':'#dc2626'} />
                    </div>
                  </div>
                  <div style={{ marginTop:6 }}>
                    <span style={{ color:'#9ca3af', fontSize:13 }}>Calculated (worked hours):</span>
                    <strong style={{ color:'#0369a1', fontSize:16, marginLeft:6 }}>{rec.otFormatted}</strong>
                  </div>
                </div>

                {/* Recommender/Approver on record for this staff member — pick
                    one when Staff → Reco/Approval setup has more than one */}
                <div style={{ display:'flex', gap:10, marginBottom:14, flexWrap:'wrap' }}>
                  <RecoPicker label="Recommended By" ids={recoIds} value={leaveReco} onChange={setLeaveReco}
                    bg="#f0f9ff" border="#bfdbfe" chipBg="#eff6ff" chipColor="#1a56db" />
                  <RecoPicker label="Approval" ids={approvalIds} value={leaveApproval} onChange={setLeaveApproval}
                    bg="#f0fdf4" border="#86efac" chipBg="#d1fae5" chipColor="#065f46" />
                </div>

                <div style={{ display:'flex', gap:12 }}>
                  <div className="form-group" style={{ flex:2 }}>
                    <label style={{ fontSize:12, fontWeight:600, color:'#374151', display:'block', marginBottom:4 }}>
                      Leave
                    </label>
                    <select className="form-control" value={leaveFormType}
                      onChange={e => setLeaveFormType(e.target.value)} style={{ fontSize:13 }}>
                      <option value="">— Select Leave Type —</option>
                      {(settings.leaveTypeConfigs || []).map(lt => (
                        <option key={lt.shortName} value={lt.shortName}>{lt.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group" style={{ flex:1 }}>
                    <label style={{ fontSize:12, fontWeight:600, color:'#374151', display:'block', marginBottom:4 }}>
                      No. Of Days (max 2)
                    </label>
                    <input type="number" className="form-control" value={leaveFormDays}
                      step={0.5} min={0.5} max={2}
                      onChange={e => setLeaveFormDays(e.target.value)}
                      style={{ fontSize:13 }} />
                  </div>
                </div>

                <div className="form-group" style={{ marginTop:12 }}>
                  <label style={{ fontSize:12, fontWeight:600, color:'#374151', display:'block', marginBottom:4 }}>
                    Comment (optional)
                  </label>
                  <textarea className="form-control" rows={2} value={leaveComment}
                    onChange={e => setLeaveComment(e.target.value)}
                    placeholder="Enter reason or note…" style={{ fontSize:13 }} />
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-outline" onClick={() => setLeaveModal(null)}>Cancel</button>
                <button className="btn btn-success" onClick={submitLeaveGrant}>
                  ✅ Approve & Grant {leaveFormDays || 0} day(s) Leave
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Approve All (all pending / Weekend / Public Holiday) — asks who
           recommended and approved this batch, with dates, before actually
           bulk-approving every matching pending record. ── */}
      {bulkApproveModal && (
        <div className="modal-overlay" onClick={() => setBulkApproveModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth:480, width:'94vw' }}>
            <div className="modal-header">
              <h2>✅ Approve All — {bulkApproveModal.label}</h2>
              <button className="modal-close" onClick={() => setBulkApproveModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ background:'#f0fdf4', border:'1px solid #86efac', borderRadius:8,
                padding:'8px 12px', marginBottom:14, fontSize:13, color:'#065f46', fontWeight:600 }}>
                {bulkApproveModal.recs.length} pending OT record{bulkApproveModal.recs.length!==1?'s':''} will be approved.
              </div>

              {isAdmin ? (
                <>
                  <div style={{ display:'flex', gap:12, marginBottom:12 }}>
                    <div className="form-group" style={{ flex:1 }}>
                      <label style={{ fontSize:12, fontWeight:600, color:'#374151', display:'block', marginBottom:4 }}>
                        Recommended By
                      </label>
                      <SearchableSelect value={bulkRecoBy} onChange={setBulkRecoBy}
                        options={(allEmployees||[]).map(e => ({ value:String(e.id), label:e.fullName, photo:e.profilePhoto }))}
                        placeholder="— None —" showAvatar />
                    </div>
                    <div className="form-group" style={{ flex:1 }}>
                      <label style={{ fontSize:12, fontWeight:600, color:'#374151', display:'block', marginBottom:4 }}>
                        Recommended Date
                      </label>
                      <DateInput value={bulkRecoDate} onChange={setBulkRecoDate} />
                    </div>
                  </div>

                  <div style={{ display:'flex', gap:12 }}>
                    <div className="form-group" style={{ flex:1 }}>
                      <label style={{ fontSize:12, fontWeight:600, color:'#374151', display:'block', marginBottom:4 }}>
                        Approved By
                      </label>
                      <SearchableSelect value={bulkApprovedBy} onChange={setBulkApprovedBy}
                        options={(allEmployees||[]).map(e => ({ value:String(e.id), label:e.fullName, photo:e.profilePhoto }))}
                        placeholder="— Select —" showAvatar />
                    </div>
                    <div className="form-group" style={{ flex:1 }}>
                      <label style={{ fontSize:12, fontWeight:600, color:'#374151', display:'block', marginBottom:4 }}>
                        Approved Date
                      </label>
                      <DateInput value={bulkApprovedDate} onChange={setBulkApprovedDate} />
                    </div>
                  </div>
                </>
              ) : (
                // Non-admin can't record someone else's decision (server
                // ignores it regardless) — every record here is one they're
                // personally the configured approver for, recorded as
                // themselves, today.
                <div style={{ fontSize:12.5, color:'#6b7280', background:'#f9fafb', border:'1px solid #e5e7eb',
                  borderRadius:8, padding:'8px 12px' }}>
                  You'll be recorded as the approver, dated today.
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setBulkApproveModal(null)}>Cancel</button>
              <button className="btn btn-success" onClick={confirmBulkApprove} disabled={!bulkApprovedBy}>
                ✅ Approve All ({bulkApproveModal.recs.length})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── OT Settings Modal ── */}
      {showOTSettings && (
        <div className="modal-overlay">
          <div className="modal" onClick={e => e.stopPropagation()}
            style={{ maxWidth:640, width:'96vw' }}>

            {/* Header */}
            <div className="modal-header">
              <h2 style={{ display:'flex', alignItems:'center', gap:8 }}>
                ⚙ OT Settings
              </h2>
              <button className="modal-close" onClick={() => setShowOTSettings(false)}>✕</button>
            </div>

            {/* Body */}
            <div className="modal-body" style={{ display:'flex', flexDirection:'column', gap:0 }}>

              {/* ── OT IN / OT OUT ── */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:0,
                border:'1px solid #e5e7eb', borderRadius:10, overflow:'hidden', marginBottom:18 }}>

                {/* Header row — green for IN, blue for OUT, matching the Time In/Time Out
                    pill colors elsewhere on this page so the two read as one color language */}
                <div style={{ gridColumn:'1/-1', display:'grid', gridTemplateColumns:'1fr 1fr',
                  borderBottom:'1px solid #e5e7eb' }}>
                  <div style={{ padding:'8px 16px', fontSize:11, fontWeight:700, color:'#065f46',
                    background:'#f0fdf4', textTransform:'uppercase', letterSpacing:.5 }}>OT Before Time IN</div>
                  <div style={{ padding:'8px 16px', fontSize:11, fontWeight:700, color:'#0369a1',
                    background:'#eff6ff', textTransform:'uppercase', letterSpacing:.5, borderLeft:'1px solid #e5e7eb' }}>OT After Time OUT</div>
                </div>

                {/* Must work toggle + Max */}
                <div style={{ padding:'16px', borderRight:'1px solid #e5e7eb', borderLeft:'3px solid #86efac',
                  background:'#f7fdf9', display:'flex', flexDirection:'column', gap:12 }}>
                  <div>
                    <div style={{ fontSize:13, fontWeight:700, color:'#374151', marginBottom:6 }}>Must Work to Get OT</div>
                    <input type="text" value={otSettings.minOTBeforeIn}
                      onChange={e => setOtSettings(p => ({ ...p, minOTBeforeIn: e.target.value }))}
                      placeholder="HH:MM"
                      style={{ width:'100%', boxSizing:'border-box', padding:'8px 10px', border:'1.5px solid #d1d5db',
                        borderRadius:7, fontSize:13, fontFamily:'monospace', outline:'none', background:'white', color:'#111827' }} />
                  </div>
                  <div>
                    <div style={{ fontSize:12, fontWeight:600, color:'#6b7280', marginBottom:5 }}>Maximum OT before Time IN</div>
                    <input type="text" value={otSettings.maxOTBeforeIn}
                      onChange={e => setOtSettings(p => ({ ...p, maxOTBeforeIn: e.target.value }))}
                      placeholder="Type here Maximum OT allowed in Time IN"
                      style={{ width:'100%', boxSizing:'border-box', padding:'8px 10px', border:'1.5px solid #d1d5db',
                        borderRadius:7, fontSize:13, fontFamily:'monospace', outline:'none', background:'white', color:'#111827' }} />
                  </div>
                </div>

                <div style={{ padding:'16px', borderLeft:'3px solid #93c5fd',
                  background:'#f8fbff', display:'flex', flexDirection:'column', gap:12 }}>
                  <div>
                    <div style={{ fontSize:13, fontWeight:700, color:'#374151', marginBottom:6 }}>Must Work to Get OT</div>
                    <input type="text" value={otSettings.minOTAfterOut}
                      onChange={e => setOtSettings(p => ({ ...p, minOTAfterOut: e.target.value }))}
                      placeholder="HH:MM"
                      style={{ width:'100%', boxSizing:'border-box', padding:'8px 10px', border:'1.5px solid #d1d5db',
                        borderRadius:7, fontSize:13, fontFamily:'monospace', outline:'none', background:'white', color:'#111827' }} />
                  </div>
                  <div>
                    <div style={{ fontSize:12, fontWeight:600, color:'#6b7280', marginBottom:5 }}>Maximum OT after Time OUT</div>
                    <input type="text" value={otSettings.maxOTAfterOut}
                      onChange={e => setOtSettings(p => ({ ...p, maxOTAfterOut: e.target.value }))}
                      placeholder="Type here Maximum OT allowed in Time OUT"
                      style={{ width:'100%', boxSizing:'border-box', padding:'8px 10px', border:'1.5px solid #d1d5db',
                        borderRadius:7, fontSize:13, fontFamily:'monospace', outline:'none', background:'white', color:'#111827' }} />
                  </div>
                </div>
              </div>

              {/* ── Weekend / Public Holiday ── */}
              <div style={{ border:'1px solid #e5e7eb', borderRadius:10, overflow:'hidden' }}>
                <div style={{ padding:'8px 16px', background:'#f1f5f9', borderBottom:'1px solid #e5e7eb',
                  fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:.5 }}>
                  What to do if Staff is Present
                </div>

                {[
                  { key:'weekendPresent',  label:'Weekend' },
                  { key:'holidayPresent',  label:'Public Holiday' },
                ].map(({ key, label }, i) => (
                  <div key={key} style={{ display:'grid', gridTemplateColumns:'160px 1fr',
                    borderTop: i > 0 ? '1px solid #e5e7eb' : 'none' }}>
                    <div style={{ padding:'14px 16px', background:'#fafafa',
                      borderRight:'1px solid #e5e7eb', display:'flex', alignItems:'center' }}>
                      <span style={{ fontSize:13, fontWeight:700, color:'#374151' }}>{label}</span>
                    </div>
                    <div style={{ padding:'14px 16px', display:'flex', gap:24, flexWrap:'wrap', alignItems:'center' }}>
                      <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer' }}>
                        <input type="radio" name={key} value="ot"
                          checked={otSettings[key] === 'ot'}
                          onChange={() => setOtSettings(p => ({ ...p, [key]: 'ot' }))}
                          style={{ accentColor:'#1a56db', width:15, height:15 }} />
                        <span style={{ fontSize:13, color:'#374151' }}>
                          Don't calculate shift — show only Working Hours as OT
                        </span>
                      </label>
                      <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer' }}>
                        <input type="radio" name={key} value="leave"
                          checked={otSettings[key] === 'leave'}
                          onChange={() => setOtSettings(p => ({ ...p, [key]: 'leave' }))}
                          style={{ accentColor:'#1a56db', width:15, height:15 }} />
                        <span style={{ fontSize:13, color:'#374151' }}>
                          Provide Next Day Leave
                        </span>
                      </label>
                    </div>
                  </div>
                ))}
              </div>

            </div>

            {/* Footer */}
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setShowOTSettings(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveOTSettings} disabled={otSettingsSaving} title="Ctrl+S">
                {otSettingsSaving ? 'Saving…' : <>💾 <u>S</u>ave Settings</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Advanced Search Modal ── */}
      {showAdvSearchModal && (() => {
        const MCS = ({ label, value, onChange, options }) => {
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
          const fo = srch ? options.filter(o => o.toLowerCase().includes(srch.toLowerCase())) : options;
          // "All" is always row 0 in the navigable list, followed by the filtered options
          const navItems = [null, ...fo];
          itemRefs.current = [];
          const toggle = v => onChange(value.includes(v) ? value.filter(x=>x!==v) : [...value, v]);
          const selectNav = v => v === null ? onChange([]) : toggle(v);
          const selLabel = value.length===0 ? 'All' : value.length===1 ? value[0] : `${value.length} selected`;
          const openWithHighlight = () => {
            const idx = value.length === 1 ? navItems.findIndex(v => v === value[0]) : 0;
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
              <div style={{ fontSize:12, fontWeight:700, color:'#1f2937', marginBottom:5 }}>{label}</div>
              <div tabIndex={0}
                onKeyDown={handleTriggerKeyDown}
                onClick={() => { open ? setOpen(false) : openWithHighlight(); }}
                style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
                  padding:'8px 10px', border:`1.5px solid ${open?'#1a56db':'#d1d5db'}`,
                  borderRadius:7, background:'white', cursor:'pointer', fontSize:13,
                  color: value.length>0 ? '#1e40af' : '#9ca3af',
                  minHeight:42, fontWeight: value.length>0 ? 600 : 400,
                  boxShadow: open ? '0 0 0 2px #bfdbfe' : 'none', outline:'none', userSelect:'none' }}>
                <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 }}>{selLabel}</span>
                <div style={{ display:'flex', alignItems:'center', gap:4, flexShrink:0, marginLeft:6 }}>
                  {value.length > 0 && <span style={{ background:'#1a56db', color:'white', borderRadius:10, fontSize:10, fontWeight:700, padding:'1px 6px' }}>{value.length}</span>}
                  {value.length > 0 && <span onMouseDown={e=>{e.preventDefault();e.stopPropagation();onChange([]);}} style={{ color:'#9ca3af', fontSize:16, lineHeight:1, cursor:'pointer' }} onMouseEnter={e=>e.currentTarget.style.color='#ef4444'} onMouseLeave={e=>e.currentTarget.style.color='#9ca3af'}>×</span>}
                  <span style={{ fontSize:9, color:'#9ca3af' }}>{open?'▲':'▼'}</span>
                </div>
              </div>
              {open && (
                <div style={{ position:'absolute', top:'calc(100% + 3px)', left:0, right:0, zIndex:9999,
                  background:'white', border:'1.5px solid #1a56db', borderRadius:8,
                  boxShadow:'0 8px 24px rgba(0,0,0,.18)', maxHeight:220, display:'flex', flexDirection:'column' }}>
                  <div style={{ padding:'6px 8px', borderBottom:'1px solid #e5e7eb', flexShrink:0 }}>
                    <input autoFocus type="text" value={srch} onChange={e=>setSrch(e.target.value)} placeholder="Search..."
                      onClick={e=>e.stopPropagation()} onKeyDown={handleSearchKeyDown}
                      style={{ width:'100%', border:'1px solid #d1d5db', borderRadius:5, padding:'5px 8px', fontSize:12, outline:'none', boxSizing:'border-box' }} />
                  </div>
                  <div style={{ overflowY:'auto', flex:1 }}>
                    {navItems.map((v, i) => {
                      const isAll = v === null;
                      const sel   = isAll ? value.length === 0 : value.includes(v);
                      const highlighted = i === activeIndex;
                      return (
                        <div key={v ?? '__all'} ref={el => itemRefs.current[i] = el}
                          onMouseDown={e=>{e.preventDefault();selectNav(v);}}
                          onMouseEnter={() => setActiveIndex(i)}
                          style={{ padding:'8px 11px', display:'flex', alignItems:'center', gap:8, cursor:'pointer',
                            background: sel ? '#eff6ff' : (highlighted ? '#f8fafc' : 'white'),
                            borderBottom: isAll ? '1px solid #f1f5f9' : '1px solid #f9fafb' }}>
                          <span style={{ width:14, height:14, borderRadius:3, flexShrink:0, border:`2px solid ${sel?'#1a56db':'#d1d5db'}`, background:sel?'#1a56db':'white', display:'flex', alignItems:'center', justifyContent:'center' }}>
                            {sel && <svg viewBox="0 0 12 12" fill="none" width="9" height="9"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round"/></svg>}
                          </span>
                          <span style={{ fontSize:13, color:sel?'#1e40af':'#374151', fontWeight:sel?600:400 }}>{isAll ? 'All' : v}</span>
                        </div>
                      );
                    })}
                    {fo.length===0 && <div style={{ padding:'10px 11px', fontSize:12, color:'#9ca3af', textAlign:'center' }}>No results</div>}
                  </div>
                </div>
              )}
            </div>
          );
        };

        const setAF = (field, val) => setAdvFilters(p => ({ ...p, [field]: val }));
        const handleEnterTab = (e) => {
          if (e.key !== 'Enter' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
          e.preventDefault();
          const els = Array.from(e.currentTarget.querySelectorAll('[tabindex="0"]:not([disabled])'))
            .filter(el => el.offsetParent !== null);
          const idx = els.indexOf(document.activeElement);
          if (idx >= 0 && idx < els.length - 1) els[idx + 1].focus();
        };

        return (
          <div className="modal-overlay">
            <div onClick={e => e.stopPropagation()} onKeyDown={handleEnterTab}
              style={{ background:'white', borderRadius:14, width:'96vw', maxWidth:900,
                maxHeight:'88vh', display:'flex', flexDirection:'column',
                boxShadow:'0 25px 60px rgba(0,0,0,.22)', overflow:'hidden' }}>

              {/* Header */}
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
                padding:'16px 24px', borderBottom:'2px solid #e5e7eb',
                background:'#ffffff', flexShrink:0 }}>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18" style={{ color:'#1a56db' }}>
                    <path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L12 11.414V15a1 1 0 01-.553.894l-4 2A1 1 0 016 17v-5.586L3.293 6.707A1 1 0 013 6V3z" clipRule="evenodd"/>
                  </svg>
                  <span style={{ fontSize:17, fontWeight:800, color:'#111827' }}>{t('Advanced Search')}</span>
                  {activeFilterCount > 0 && (
                    <span style={{ background:'#1a56db', color:'#fff', borderRadius:10, fontSize:12, fontWeight:700, padding:'2px 10px' }}>
                      {activeFilterCount} filter{activeFilterCount>1?'s':''} active
                    </span>
                  )}
                  <span style={{ fontSize:13, color:'#6b7280' }}>— {filtered.length} of {records.length} records shown</span>
                </div>
                <button onClick={() => setShowAdvSearchModal(false)}
                  style={{ background:'#f3f4f6', border:'none', borderRadius:'50%', width:36, height:36,
                    fontSize:18, cursor:'pointer', color:'#6b7280', display:'flex', alignItems:'center', justifyContent:'center' }}>×</button>
              </div>

              {/* Body */}
              <div style={{ overflowY:'auto', flex:1, padding:'20px 24px', display:'flex', flexDirection:'column', gap:18 }}>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:16 }}>
                  <MCS label="Branch"      value={advFilters.branches}    onChange={v=>setAF('branches',v)}    options={branchOpts2} />
                  <MCS label="Department"  value={advFilters.departments}  onChange={v=>setAF('departments',v)} options={deptOpts} />
                  <MCS label="Post"        value={advFilters.positions}    onChange={v=>setAF('positions',v)}   options={posOpts} />
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:16 }}>
                  <MCS label="Grade"       value={advFilters.grades}       onChange={v=>setAF('grades',v)}       options={gradeOpts} />
                  <MCS label="Gender"      value={advFilters.genders}      onChange={v=>setAF('genders',v)}      options={genderOpts} />
                  <MCS label="Mode"        value={advFilters.modes}        onChange={v=>setAF('modes',v)}        options={modeOpts} />
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:16 }}>
                  <MCS label="Timing Type" value={advFilters.timingTypes}  onChange={v=>setAF('timingTypes',v)}  options={timingTypeOpts} />
                  <div /><div />
                </div>
              </div>

              {/* Footer */}
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
                padding:'14px 24px', borderTop:'1px solid #e5e7eb', background:'#f9fafb', flexShrink:0 }}>
                <button onClick={() => { clearAdvFilters(); }}
                  style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 18px',
                    background:'#fff5f5', border:'1.5px solid #fca5a5', borderRadius:8,
                    fontSize:13, fontWeight:700, color:'#dc2626', cursor:'pointer' }}>
                  🗑 Clear All Filters
                </button>
                <div style={{ display:'flex', gap:10 }}>
                  <button onClick={() => setShowAdvSearchModal(false)}
                    style={{ padding:'8px 20px', background:'white', border:'1.5px solid #d1d5db',
                      borderRadius:8, fontSize:13, fontWeight:600, color:'#374151', cursor:'pointer' }}>
                    Close
                  </button>
                  <button onClick={() => setShowAdvSearchModal(false)}
                    style={{ padding:'8px 20px', background:'#1a56db', border:'none',
                      borderRadius:8, fontSize:13, fontWeight:700, color:'white', cursor:'pointer' }}>
                    ✔ Apply Filter
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Toast ── */}
      {toast && (
        <div style={{ position:'fixed', bottom:20, right:20, zIndex:99999,
          background: toast.type==='error' ? '#dc2626' : '#059669',
          color:'#fff', borderRadius:10, padding:'10px 18px',
          fontSize:13, fontWeight:700, boxShadow:'0 4px 16px rgba(0,0,0,.2)' }}>
          {toast.type==='error' ? '❌' : '✅'} {toast.msg}
        </div>
      )}
    </div>
  );
};

export default OvertimePage;
