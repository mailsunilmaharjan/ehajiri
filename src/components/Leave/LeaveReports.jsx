import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useLanguage } from '../../context/LanguageContext.jsx';
import { useData } from '../../context/DataContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import { makeDateFormatter, getCurrentFiscalYear, getNepalTodayISO, adToBS, formatNepalDateTime, BS_MONTHS_NP, BS_MONTHS_EN } from '../../utils/dateUtils.js';
import useRecoApproval from '../../hooks/useRecoApproval.js';
import useLeaveOpening from '../../hooks/useLeaveOpening.js';
import DataGrid from '../DataGrid/DataGrid.jsx';
import Avatar from '../Common/Avatar.jsx';
import HoverCard from '../Common/HoverCard.jsx';
import { buildPrintDoc, openPrintWindow, getExcelHeaderRows, downloadCSV } from '../../utils/printHelper.js';
import { LeaveAdvancedFilter, DEFAULT_ADV_FILTERS, GridPager, shortOf, LeaveReportsTab } from './LeaveCalculation.jsx';
import { branchAbbr } from '../../utils/branchUtils.js';
import { SidePanelShell, DRow, DRowPair, DRowBox, SectionLabel, InfoLine, panelBtnStyle } from './LeaveVisitPage.jsx';

const MONTHS_EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTHS_NP = ['जन','फेब','मार्च','अप्रि','मे','जुन','जुल','अग','सेप्ट','अक्टो','नोभ','डिसे'];

const TABS = [
  { key: 'records', icon: '📋', labelNp: 'बिदा विवरण',              labelEn: 'Leave Records' },
  { key: 'balance', icon: '💰', labelNp: 'बिदा मौज्दात प्रतिवेदन',    labelEn: 'Leave Balance Report' },
  { key: 'summary', icon: '📊', labelNp: 'सारांश बिदा प्रतिवेदन',     labelEn: 'Summarized Leave Report' },
];

/* Report-page filters extend the shared shape with FY(multi)/date-range/working-status —
   other LeaveAdvancedFilter callers (Leave Management, Leave Calculation) never see these keys. */
const REPORT_DEFAULT_FILTERS = { ...DEFAULT_ADV_FILTERS, fyIds: [], fromDate: '', toDate: '', workingStatus: 'working' };

const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

/* year+month pairs spanning [startISO, endISO], BS calendar */
function bsMonthRange(startISO, endISO) {
  const s = adToBS(startISO), e = adToBS(endISO);
  if (!s || !e) return [];
  const out = [];
  let y = s.year, m = s.month;
  let guard = 0;
  while ((y < e.year || (y === e.year && m <= e.month)) && guard++ < 240) {
    out.push({ year: y, month: m });
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}
/* year+month pairs spanning [startISO, endISO], Gregorian calendar */
function adMonthRange(startISO, endISO) {
  const s = new Date(startISO), e = new Date(endISO);
  const out = [];
  let y = s.getFullYear(), m = s.getMonth() + 1;
  const eY = e.getFullYear(), eM = e.getMonth() + 1;
  let guard = 0;
  while ((y < eY || (y === eY && m <= eM)) && guard++ < 240) {
    out.push({ year: y, month: m });
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

const LeaveReports = () => {
  const { language } = useLanguage();
  const L = (np, en) => language === 'np' ? np : en;
  const MONTHS = language === 'np' ? MONTHS_NP : MONTHS_EN;
  const MONTHS_BS = language === 'np' ? BS_MONTHS_NP : BS_MONTHS_EN;
  const { currentUser, isAdmin, isBranchManager, isDeptHead } = useAuth();
  const { filteredEmployees, filteredLeaves, leaveBalances, getEmployeeById, getEmployeeName, getLeaveBalance } = useData();
  const { settings } = useSettings();
  const { getRecoIds, getApprovalIds } = useRecoApproval();
  const { opening: leaveOpening } = useLeaveOpening();
  const fd = makeDateFormatter(settings);

  const canBroadenScope = isAdmin || isBranchManager || isDeptHead;

  const [activeTab,    setActiveTab]    = useState('records');
  const [viewScope,    setViewScope]    = useState('own'); // 'own' | 'all' — default own for everyone
  const [advFilters,   setAdvFilters]   = useState({ ...REPORT_DEFAULT_FILTERS });
  const [advTempF,     setAdvTempF]     = useState({ ...REPORT_DEFAULT_FILTERS });
  const [advFilterOpen, setAdvFilterOpen] = useState(false);
  const [viewLeave,    setViewLeave]    = useState(null);
  const [monthFilter,  setMonthFilter]  = useState(null); // { key: 'year-month', label } — set by clicking a Summary row

  const setAdvTF = (key, val) => setAdvTempF(p => ({ ...p, [key]: val }));
  const openAdvFilter  = () => { setAdvTempF({ ...advFilters }); setAdvFilterOpen(true); };
  const applyAdvFilter = () => { setAdvFilters({ ...advTempF }); setAdvFilterOpen(false); };
  const resetAdvFilter = () => setAdvTempF({ ...REPORT_DEFAULT_FILTERS });
  const advFilterCount = [advFilters.branches, advFilters.departments, advFilters.posts,
    advFilters.grades, advFilters.modes, advFilters.staffIds, advFilters.leaveTypes, advFilters.fyIds]
    .filter(a => a.length > 0).length + (advFilters.workingStatus !== 'working' ? 1 : 0);

  /* Default Fiscal Year selection = current FY (also seeds From/To Date to its range), applied once */
  const currentFY = useMemo(() => getCurrentFiscalYear(settings.fiscalYears || []), [settings.fiscalYears]);
  const didInitFY = useRef(false);
  useEffect(() => {
    if (!didInitFY.current && currentFY) {
      const init = { fyIds: [String(currentFY.id)], fromDate: currentFY.startDate, toDate: currentFY.endDate };
      setAdvFilters(p => ({ ...p, ...init }));
      setAdvTempF(p => ({ ...p, ...init }));
      didInitFY.current = true;
    }
  }, [currentFY]);
  const fyOpts = useMemo(() => (settings.fiscalYears || []).map(fy => ({ value: String(fy.id), label: fy.name, startDate: fy.startDate, endDate: fy.endDate })), [settings.fiscalYears]);
  const selectedFYs = useMemo(() => (settings.fiscalYears || []).filter(fy => advFilters.fyIds.includes(String(fy.id))), [settings.fiscalYears, advFilters.fyIds]);

  const ltConfigs = useMemo(() => settings.leaveTypeConfigs || [], [settings.leaveTypeConfigs]);

  const advBranchOpts = useMemo(() => (settings.branches || []).map(b => ({ value: b.name, label: b.name })), [settings.branches]);
  const advDeptOpts   = useMemo(() => (settings.departments || []).map(d => ({ value: d.name, label: d.name })), [settings.departments]);
  const advPostOpts   = useMemo(() => (settings.posts || []).map(p => ({ value: p.name, label: p.name })), [settings.posts]);
  const advGradeOpts  = useMemo(() => (settings.grades || []).map(g => ({ value: g.name, label: g.name })), [settings.grades]);
  const advModeOpts   = useMemo(() => (settings.modes || []).map(m => ({ value: m.name, label: m.name })), [settings.modes]);
  const advLeaveTypeOpts = useMemo(() => ltConfigs.map(lt => ({ value: lt.shortName, label: lt.name })), [ltConfigs]);
  const advStaffOpts = useMemo(() => filteredEmployees.filter(e => e.active).map(e => ({
    value: String(e.id), label: e.fullName,
    sub: [e.employeeId, e.position].filter(Boolean).join(' - '),
    photo: e.profilePhoto,
  })), [filteredEmployees]);

  /* Employees in scope: Own vs All (Admin/Dept Head/Branch Manager only) */
  const scopedEmployees = useMemo(() => {
    if (viewScope === 'own' || !canBroadenScope) {
      return filteredEmployees.filter(e => String(e.id) === String(currentUser.id));
    }
    let list = filteredEmployees;
    if (advFilters.workingStatus === 'working') list = list.filter(e => e.active !== false);
    else if (advFilters.workingStatus === 'notworking') list = list.filter(e => e.active === false);
    if (advFilterCount > 0) {
      list = list.filter(e => {
        if (advFilters.branches.length     && !advFilters.branches.includes(e.branch))        return false;
        if (advFilters.departments.length  && !advFilters.departments.includes(e.department)) return false;
        if (advFilters.posts.length        && !advFilters.posts.includes(e.position))         return false;
        if (advFilters.grades.length       && !advFilters.grades.includes(e.grade))           return false;
        if (advFilters.modes.length        && !advFilters.modes.includes(e.mode))             return false;
        if (advFilters.staffIds.length     && !advFilters.staffIds.includes(String(e.id)))    return false;
        return true;
      });
    }
    return list;
  }, [filteredEmployees, viewScope, canBroadenScope, currentUser, advFilters, advFilterCount]);
  const scopedEmpIdSet = useMemo(() => new Set(scopedEmployees.map(e => String(e.id))), [scopedEmployees]);

  /* ── Tab 1: approved leave records only, in scope, FY + date-range filtered ── */
  const approvedLeaves = useMemo(() => filteredLeaves.filter(l => {
    if (l.status !== 'approved') return false;
    if (!scopedEmpIdSet.has(String(l.employeeId))) return false;
    if (viewScope === 'all' && advFilters.leaveTypes.length && !advFilters.leaveTypes.includes(l.leaveTypeCode)) return false;
    if (selectedFYs.length > 0 && !selectedFYs.some(fy => l.fromDate >= fy.startDate && l.fromDate <= fy.endDate)) return false;
    if (advFilters.fromDate && l.fromDate < advFilters.fromDate) return false;
    if (advFilters.toDate   && l.fromDate > advFilters.toDate)   return false;
    return true;
  }).sort((a, b) => new Date(b.fromDate) - new Date(a.fromDate)), [filteredLeaves, scopedEmpIdSet, viewScope, advFilters.leaveTypes, selectedFYs, advFilters.fromDate, advFilters.toDate]);

  const namesFor = (empId, kind) => {
    const ids = kind === 'reco' ? getRecoIds(empId) : getApprovalIds(empId);
    return ids.length ? ids.map(id => getEmployeeName(id)).join(', ') : '—';
  };
  // Print/export variant — includes each person's Post, matching how the
  // Leave Management page's own print shows "Name … Post:" on the
  // Recommendator/Approval signature lines.
  const namesWithPostFor = (empId, kind) => {
    const ids = kind === 'reco' ? getRecoIds(empId) : getApprovalIds(empId);
    if (!ids.length) return '—';
    return ids.map(id => {
      const post = getEmployeeById(id)?.position;
      return post ? `${getEmployeeName(id)} (${post})` : getEmployeeName(id);
    }).join(', ');
  };
  const getLeaveLabel = (code) => ltConfigs.find(lt => lt.shortName === code)?.name || code;

  // Avatar + hover (photo, name, post) for exactly one person — the
  // Recommendator/Approval columns below show only whoever this specific
  // application actually names (recommendedBy/approvedBy once someone has
  // acted, otherwise the recoId/approvalId the applicant picked at apply
  // time — see migration 142), NOT namesFor's full configured-candidate
  // list above (still used for the printable signature block, where every
  // possible signer is genuinely relevant). Same avatar+tooltip convention
  // as TaskList.jsx's Assigned To/Seen By avatars.
  const personHoverCell = (empId) => {
    if (!empId) return <span style={{ color: '#d1d5db' }}>—</span>;
    const emp = getEmployeeById(empId);
    const name = getEmployeeName(empId);
    return (
      <HoverCard
        trigger={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
            <Avatar photo={emp?.profilePhoto} name={name} size={24} preview={false} />
            <span>{name}</span>
          </span>}
        content={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Avatar photo={emp?.profilePhoto} name={name} size={40} preview={false} />
            <div>
              <div style={{ fontWeight: 700, color: '#1e293b', fontSize: 12.5 }}>{name}</div>
              <div style={{ color: '#6b7280', fontSize: 11, marginTop: 1 }}>{emp?.position || '—'}</div>
            </div>
          </div>
        }
        side="right" arrow minWidth={180} />
    );
  };

  const recordCols = [
    { field: 'staffId', header: 'Staff ID', width: 90, render: (_, row) => (
        <span style={{ color: '#6b7280' }}>{getEmployeeById(row.employeeId)?.employeeId || '—'}</span>
      ) },
    { field: 'employeeId', header: L('नाम', 'Name'), width: 160, render: v => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, color: '#111827' }}>
          <Avatar photo={getEmployeeById(v)?.profilePhoto} name={getEmployeeName(v)} size={22} />
          {getEmployeeName(v)}
        </span>
      ) },
    { field: 'leaveTypeCode', header: L('प्रकार', 'Type'), width: 150, render: v => getLeaveLabel(v) },
    { field: 'isManual', header: L('आवेदन प्रकार', 'App. Type'), width: 110, render: v => (
        <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 9px', borderRadius: 10, whiteSpace: 'nowrap',
          background: v === true ? '#fef3c7' : '#eff6ff', color: v === true ? '#92400e' : '#1e40af',
          border: `1px solid ${v === true ? '#fde68a' : '#bfdbfe'}` }}>
          {v === true ? L('✍️ म्यानुअल', '✍️ Manual') : L('📝 आवेदन', '📝 Application')}
        </span>
      ) },
    { field: 'fromDate', header: L('मिति देखि', 'From Date'), width: 110, render: v => fd(v) },
    { field: 'toDate',   header: L('मिति सम्म', 'To Date'),   width: 110, render: v => fd(v) },
    { field: 'days',     header: L('दिन', 'Days'), width: 60, align: 'center',
      render: v => <strong style={{ color: '#1a56db' }}>{(v === null || v === undefined || isNaN(Number(v))) ? '—' : v}</strong> },
    { field: 'appliedDate', header: L('आवेदन मिति', 'Applied Date'), width: 110, render: v => fd(v) },
    { field: 'status', header: L('स्थिति', 'Status'), width: 100, render: () => (
        <span className="badge badge-success">{L('स्वीकृत', 'Approved')}</span>
      ) },
    { field: 'recommendatorNames', header: L('सिफारिसकर्ता', 'Recommendator'), width: 200, sortable: false, filterable: false,
      render: (_, row) => personHoverCell(row.recommendedBy || row.recoId) },
    { field: 'approvalNames', header: L('स्वीकृतिकर्ता', 'Approval'), width: 200, sortable: false, filterable: false,
      render: (_, row) => personHoverCell(row.approvedBy || row.approvalId) },
  ];

  /* ── Tab 2: leave balance report — one row per (employee × leave type),
     merged Staff ID/Staff cells via rowSpan — mirrors LeaveCalculation.jsx's
     own Leave Balance tab (flatRows/balanceRowsSpanned) exactly, since
     DataGrid.jsx has no rowSpan support of its own; only reusable pieces
     (GridPager, shortOf) are imported from there rather than duplicated.
     Uses a single reference FY (the one Advance-Search FY when exactly one
     is selected, else the tenant's current FY) since "opening" is
     inherently tied to one fiscal year — the Records tab's own multi-FY
     date filtering doesn't apply here. */
  const balanceFY      = selectedFYs.length === 1 ? selectedFYs[0] : currentFY;
  const balanceCurKey  = balanceFY ? String(balanceFY.id) : null;
  const balancePrevKey = balanceFY ? 'prev_' + balanceFY.id : null;

  const [balSearch,   setBalSearch]   = useState('');
  const [balPage,     setBalPage]     = useState(1);
  const [balPageSize, setBalPageSize] = useState(25);
  const [viewBalanceEmpId, setViewBalanceEmpId] = useState(null);

  const balanceFlatRowsAll = useMemo(() => {
    const rows = [];
    let sn = 0;
    scopedEmployees.forEach(e => {
      ltConfigs.forEach(lt => {
        const opening  = balancePrevKey ? Number(leaveOpening[balancePrevKey]?.[e.id]?.[lt.shortName] ?? 0) : 0;
        const current  = balanceCurKey  ? Number(leaveOpening[balanceCurKey]?.[e.id]?.[lt.shortName]  ?? 0) : 0;
        const credited = Number(getLeaveBalance(e.id)?.[lt.shortName] || 0);
        const used = filteredLeaves
          .filter(l => String(l.employeeId) === String(e.id) && l.leaveTypeCode === lt.shortName && l.status === 'approved')
          .reduce((s, l) => s + Number(l.days || 0), 0);
        const total   = opening + current + credited;
        const balance = total - used;
        sn++;
        rows.push({
          sn, empId: e.id, employeeId: e.employeeId, fullName: e.fullName, profilePhoto: e.profilePhoto,
          postShort: shortOf(e.position, settings.posts), deptShort: shortOf(e.department, settings.departments),
          branchShort: branchAbbr(e.branch, settings),
          ltName: lt.name, ltShortName: lt.shortName,
          ltType: lt.carryForward ? L('संचित', 'Accumulated') : L('गैर-संचित', 'Non Accumulated'),
          opening, current, total, used, balance,
        });
      });
    });
    return rows;
  }, [scopedEmployees, ltConfigs, leaveOpening, balancePrevKey, balanceCurKey, getLeaveBalance, filteredLeaves, settings, L]);

  const balanceFlatRows = useMemo(() => {
    if (!balSearch) return balanceFlatRowsAll;
    const s = balSearch.toLowerCase();
    return balanceFlatRowsAll.filter(r =>
      r.fullName.toLowerCase().includes(s) || String(r.employeeId||'').toLowerCase().includes(s) || r.ltName.toLowerCase().includes(s));
  }, [balanceFlatRowsAll, balSearch]);

  useEffect(() => { setBalPage(1); }, [balSearch, scopedEmployees, balanceFY]);
  const balPagedRows = useMemo(() =>
    balanceFlatRows.slice((balPage - 1) * balPageSize, balPage * balPageSize),
  [balanceFlatRows, balPage, balPageSize]);

  /* rowSpan markers — merge consecutive rows of the same employee (Staff ID
     + Staff cell) and of the same employee+ltType (Leave Type badge cell).
     Computed from balPagedRows so a merge never spans a page boundary. */
  const balanceRowsSpanned = useMemo(() => balPagedRows.map((r, i) => {
    const prevEmp = balPagedRows[i - 1];
    let empSpan = 0;
    if (!prevEmp || prevEmp.empId !== r.empId) {
      empSpan = 1;
      for (let j = i + 1; j < balPagedRows.length; j++) {
        if (balPagedRows[j].empId === r.empId) empSpan++;
        else break;
      }
    }
    const prev = balPagedRows[i - 1];
    if (prev && prev.empId === r.empId && prev.ltType === r.ltType) return { ...r, _ltTypeSpan: 0, _empSpan: empSpan };
    let span = 1;
    for (let j = i + 1; j < balPagedRows.length; j++) {
      if (balPagedRows[j].empId === r.empId && balPagedRows[j].ltType === r.ltType) span++;
      else break;
    }
    return { ...r, _ltTypeSpan: span, _empSpan: empSpan };
  }), [balPagedRows]);

  /* ── Tab 3: summarized leave report — month list spans the selected FY(s)/date-range, zero-filled ── */
  const summaryMonths = useMemo(() => {
    let ranges = [];
    const useBS = settings.defaultCalendar === 'np';
    if (selectedFYs.length > 0) {
      ranges = selectedFYs.flatMap(fy => useBS ? bsMonthRange(fy.startDate, fy.endDate) : adMonthRange(fy.startDate, fy.endDate));
    } else if (advFilters.fromDate && advFilters.toDate) {
      ranges = useBS ? bsMonthRange(advFilters.fromDate, advFilters.toDate) : adMonthRange(advFilters.fromDate, advFilters.toDate);
    } else {
      const now = useBS ? adToBS(getNepalTodayISO()) : { year: new Date().getFullYear() };
      for (let m = 1; m <= 12; m++) ranges.push({ year: now.year, month: m });
    }
    const seen = new Set(); const uniq = [];
    ranges.forEach(r => { const k = `${r.year}-${r.month}`; if (!seen.has(k)) { seen.add(k); uniq.push(r); } });
    uniq.sort((a, b) => a.year - b.year || a.month - b.month);
    return uniq;
  }, [selectedFYs, advFilters.fromDate, advFilters.toDate, settings.defaultCalendar]);

  const summaryRows = useMemo(() => {
    const useBS = settings.defaultCalendar === 'np';
    const buckets = summaryMonths.map(({ year, month }) => ({
      id: `${year}-${month}`, year, month,
      label: `${useBS ? MONTHS_BS[month - 1] : MONTHS[month - 1]} ${year}`,
      count: 0, days: 0,
    }));
    const idx = new Map(buckets.map(b => [`${b.year}-${b.month}`, b]));
    approvedLeaves.forEach(l => {
      let year, month;
      if (useBS) { const bs = adToBS(l.fromDate); if (!bs) return; year = bs.year; month = bs.month; }
      else { const d = new Date(l.fromDate); year = d.getFullYear(); month = d.getMonth() + 1; }
      const b = idx.get(`${year}-${month}`);
      if (b) { b.count += 1; b.days += Number(l.days) || 0; }
    });
    return buckets;
  }, [summaryMonths, approvedLeaves, settings.defaultCalendar, MONTHS_BS, MONTHS]);

  /* Leave Details rows — narrowed to one month when a Summary row was clicked (same fromDate→month bucketing as summaryRows) */
  const recordRows = useMemo(() => {
    if (!monthFilter) return approvedLeaves;
    const useBS = settings.defaultCalendar === 'np';
    return approvedLeaves.filter(l => {
      let year, month;
      if (useBS) { const bs = adToBS(l.fromDate); if (!bs) return false; year = bs.year; month = bs.month; }
      else { const d = new Date(l.fromDate); year = d.getFullYear(); month = d.getMonth() + 1; }
      return `${year}-${month}` === monthFilter.key;
    });
  }, [approvedLeaves, monthFilter, settings.defaultCalendar]);

  const summaryCols = [
    { field: 'label', header: L('महिना', 'Month'), fill: true, render: v => <span style={{ fontWeight: 600 }}>{v}</span> },
    { field: 'count', header: L('जम्मा बिदा संख्या', 'No. of Leave Taken'), width: 170 },
    { field: 'days',  header: L('जम्मा दिन', 'Total Days'), width: 130 },
  ];

  /* ── Print / Excel export — operates on whichever tab is active ── */
  const currentExport = () => {
    if (activeTab === 'balance') {
      return {
        title: L('बिदा मौज्दात प्रतिवेदन', 'Leave Balance Report'),
        headers: ['SN', 'Staff ID', L('नाम', 'Name'), L('पद', 'Post'), L('विभाग', 'Dept'), L('शाखा', 'Branch'),
          L('बिदा प्रकार', 'Leave Type'), L('बिदा', 'Leave'), L('सुरु', 'Opening'), L('हाल', 'Current'),
          L('जम्मा', 'Total'), L('प्रयोग', 'Used'), L('बाँकी', 'Balance')],
        rows: balanceFlatRows.map(r => [r.sn, r.employeeId, r.fullName, r.postShort, r.deptShort, r.branchShort,
          r.ltType, r.ltName, r.opening, r.current, r.total, r.used, r.balance]),
      };
    }
    if (activeTab === 'summary') {
      return {
        title: L('सारांश बिदा प्रतिवेदन', 'Summarized Leave Report'),
        headers: ['SN', L('महिना', 'Month'), L('जम्मा बिदा संख्या', 'No. of Leave Taken'), L('जम्मा दिन', 'Total Days')],
        rows: summaryRows.map((r, i) => [i + 1, r.label, r.count, r.days]),
      };
    }
    return {
      title: L('बिदा विवरण', 'Leave Records'),
      headers: ['SN', 'Staff ID', L('नाम', 'Name'), L('प्रकार', 'Type'), L('आवेदन प्रकार', 'App. Type'),
        L('मिति देखि', 'From Date'), L('मिति सम्म', 'To Date'), L('दिन', 'Days'), L('आवेदन मिति', 'Applied Date'),
        L('स्थिति', 'Status'), L('सिफारिसकर्ता', 'Recommendator'), L('स्वीकृतिकर्ता', 'Approval')],
      rows: recordRows.map((l, i) => [
        i + 1, getEmployeeById(l.employeeId)?.employeeId || '', getEmployeeName(l.employeeId),
        getLeaveLabel(l.leaveTypeCode), l.isManual ? L('म्यानुअल', 'Manual') : L('आवेदन', 'Application'),
        fd(l.fromDate), fd(l.toDate), l.days, fd(l.appliedDate), L('स्वीकृत', 'Approved'),
        namesWithPostFor(l.employeeId, 'reco'), namesWithPostFor(l.employeeId, 'approval'),
      ]),
    };
  };
  const handleExcel = () => {
    const { title, headers, rows } = currentExport();
    const headerRows = getExcelHeaderRows(settings, language, title);
    const csv = headerRows + headers.map(esc).join(',') + '\n' + rows.map(r => r.map(esc).join(',')).join('\n');
    downloadCSV(csv, `${title.replace(/\s+/g, '_')}.csv`);
  };
  const handlePrint = () => {
    const { title, headers, rows } = currentExport();
    const theadHtml = `<tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>`;
    const tbodyHtml = rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
    const doc = buildPrintDoc({ settings, language, reportTitle: title,
      contentHtml: `<table><thead>${theadHtml}</thead><tbody>${tbodyHtml}</tbody></table>` });
    openPrintWindow(doc);
  };

  /* ── Row detail side panel ── */
  const leaveEmp = viewLeave ? getEmployeeById(viewLeave.employeeId) : null;
  const leaveBalanceVal = viewLeave ? getLeaveBalance(viewLeave.employeeId)?.[viewLeave.leaveTypeCode] : null;
  // Mirrors the Leave Management page's own print (LeaveVisitPage.jsx's
  // printRecord/sigLine/adminSection) almost verbatim — same letterhead
  // main table, staff signature line, and "For Administration Use Only"
  // block with the full leave-balance table + Recommendator/Approval
  // signature sections (Name, Level, Post, date). The one deliberate
  // divergence: every record here is already status==='approved' (this
  // report never shows pending ones), so the top Status field is always a
  // plain "APPROVED" line instead of blank Approve/Reject checkboxes.
  const printOneRecord = () => {
    if (!viewLeave) return;
    const box = (v) => `<div style="min-height:44px; white-space:pre-wrap;">${v || ''}</div>`;
    const checkbox = (label) => `<span style="display:inline-flex;align-items:center;gap:6px;margin-right:28px;">
      <span style="display:inline-block;width:13px;height:13px;border:1.5px solid #374151;"></span>${label}</span>`;

    const recoApprRow = (viewLeave.recommendedBy || viewLeave.approvedBy) ? ['Recommendator & Approval',
      `<div style="display:flex; gap:28px; flex-wrap:wrap;">
         <div><strong>Recommendator:</strong> ${viewLeave.recommendedBy ? getEmployeeName(viewLeave.recommendedBy) : '—'}</div>
         <div><strong>Approval:</strong> ${viewLeave.approvedBy ? getEmployeeName(viewLeave.approvedBy) : '—'}</div>
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
      ['Status', '<strong style="color:#059669">APPROVED</strong>'],
      ['Status Remarks', box(viewLeave.comment)],
      recoApprRow,
    ].filter(Boolean);
    const mainTable = `<table>${rows.map(([k, v]) => `<tr><th style="text-align:left;white-space:normal">${k}</th><td style="padding:5px 7px;border:1px solid #dedede">${v}</td></tr>`).join('')}</table>`;

    const staffSignature = `
      <div style="display:flex; justify-content:flex-end; margin-top:30px;">
        <div style="width:220px; text-align:center;">
          <div style="border-bottom:1.5px dotted #374151; height:28px; margin-bottom:6px;"></div>
          <div style="font-size:11px; font-weight:700; color:#374151;">Staff Signature</div>
          <div style="font-size:10px; color:#6b7280; margin-top:2px;">${leaveEmp?.position || ''}</div>
          <div style="font-size:10px; color:#6b7280; margin-top:2px;">Date: ${fd(getNepalTodayISO())}</div>
        </div>
      </div>`;

    // Same Transferred/Assigned/Total/Taken/Balance math (and "hide an
    // untouched leave type" rule) as LeaveVisitPage.jsx's own admin section,
    // so the numbers match exactly — every configured leave type, not just
    // this application's own, so the approver sees the full picture.
    const defaultFY = (settings.fiscalYears || []).find(f => f.isDefault) || (settings.fiscalYears || [])[0];
    const fyId      = defaultFY ? String(defaultFY.id) : null;
    const prevFYKey = fyId ? 'prev_' + fyId : null;
    const empIdStr  = String(viewLeave.employeeId);
    let sn = 0;
    const balanceRowsHtml = ltConfigs.map(lt => {
      const isThisType   = lt.shortName === viewLeave.leaveTypeCode;
      const prevYear     = fyId ? Number(leaveOpening[prevFYKey]?.[empIdStr]?.[lt.shortName] ?? 0) : 0;
      const currYear     = fyId ? Number(leaveOpening[fyId]?.[empIdStr]?.[lt.shortName] ?? 0) : 0;
      const credited     = Number(getLeaveBalance(viewLeave.employeeId)?.[lt.shortName] || 0);
      const usedApproved = filteredLeaves
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

    const recoEmp = viewLeave.recommendedBy ? getEmployeeById(viewLeave.recommendedBy) : null;
    const apprEmp = viewLeave.approvedBy    ? getEmployeeById(viewLeave.approvedBy)    : null;
    const assignedReco = namesFor(viewLeave.employeeId, 'reco');
    const assignedAppr = namesFor(viewLeave.employeeId, 'approval');
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
          ${balanceRowsHtml}
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

  /* Toolbar shown inside every tab's DataGrid, next to its own search box */
  const toolbarContent = (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      {canBroadenScope && (
        <div style={{ display: 'flex', gap: 0, border: '1px solid #d1d5db', borderRadius: 8, overflow: 'hidden' }}>
          {[['own', L('मेरो आफ्नै', 'My Own')], ['all', L('सबै स्टाफ', 'All Staff')]].map(([v, label]) => (
            <button key={v} onClick={() => setViewScope(v)}
              style={{ padding: '5px 12px', border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, transition: 'background .15s',
                background: viewScope === v ? '#7c3aed' : 'white', color: viewScope === v ? 'white' : '#374151' }}>
              {label}
            </button>
          ))}
        </div>
      )}
      <button className="dg-filter-btn" onClick={openAdvFilter}>
        <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
          <path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L12 11.414V15a1 1 0 01-.293.707l-2 2A1 1 0 018 17v-5.586L3.293 6.707A1 1 0 013 6V3z" clipRule="evenodd"/>
        </svg>
        {L('विस्तृत खोज', 'Advance Search')}{advFilterCount > 0 ? ` (${advFilterCount})` : ''}
      </button>
      <button onClick={handleExcel} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 12px', height: 32,
        background: '#f0fdf4', border: '1px solid #86efac', color: '#15803d', borderRadius: 6, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
        📥 {L('एक्सेल', 'Excel')}
      </button>
      <button onClick={handlePrint} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 12px', height: 32,
        background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af', borderRadius: 6, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
        🖨️ {L('प्रिन्ट', 'Print')}
      </button>
    </div>
  );

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">📋 {L('बिदा रिपोर्टहरू', 'Leave Reports')}</h1>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 'var(--radius-md) var(--radius-md) 0 0', borderBottom: 'none' }}>
        <div className="tabs" style={{ padding: '0 20px', marginBottom: 0, borderBottom: '2px solid var(--border)' }}>
          {TABS.map(tab => (
            <button key={tab.key} className={`tab-btn ${activeTab === tab.key ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.key)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>{tab.icon}</span>{L(tab.labelNp, tab.labelEn)}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div style={{ background: 'white', border: '1px solid var(--border)', borderTop: 'none', borderRadius: '0 0 var(--radius-md) var(--radius-md)', padding: 20 }}>
        {activeTab === 'records' && (
          <>
          {monthFilter && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 13 }}>
              <span style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af', borderRadius: 16, padding: '3px 6px 3px 12px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                📅 {L('महिना', 'Month')}: {monthFilter.label}
                <button onClick={() => setMonthFilter(null)} title={L('हटाउनुहोस्', 'Clear')}
                  style={{ border: 'none', background: '#dbeafe', color: '#1e40af', borderRadius: '50%', width: 20, height: 20, cursor: 'pointer', fontWeight: 800, lineHeight: 1 }}>×</button>
              </span>
            </div>
          )}
          <DataGrid columns={recordCols} data={recordRows} rowKey="id" defaultPageSize={20}
            showCheckbox={false} showFilterButton={false} searchPlaceholder={L('खोज्नुस...', 'Search...')}
            onRowClick={row => setViewLeave(v => v?.id === row.id ? null : row)}
            toolbar={toolbarContent} />
          </>
        )}
        {activeTab === 'balance' && (() => {
          const thS = { padding: '4px 8px', textAlign: 'center', fontWeight: 700, fontSize: 12, color: '#374151',
            background: '#efefef', borderBottom: '2px solid #dedede', borderRight: '1px solid #dedede', whiteSpace: 'nowrap' };
          const tdS = { padding: '3px 8px', textAlign: 'center', fontSize: 12.5, verticalAlign: 'middle',
            borderBottom: '1px solid #dedede', borderRight: '1px solid #dedede' };
          return (
            <div>
              {/* Toolbar — own search box (this tab isn't DataGrid-backed) + the shared My Own/Advance Search/Excel/Print */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
                <div className="dg-searchbox" style={{ minWidth: 240 }}>
                  <svg className="dg-search-icon" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd"/></svg>
                  <input className="dg-search-input" placeholder={L('खोज्नुस...', 'Search...')} value={balSearch} onChange={e => setBalSearch(e.target.value)} />
                  {balSearch && <button className="dg-search-clear" onClick={() => setBalSearch('')}>✕</button>}
                </div>
                <span style={{ fontSize: 12, color: '#6b7280' }}>
                  {new Set(balanceFlatRows.map(r => r.empId)).size} {L('कर्मचारी', 'staff')} · {balanceFlatRows.length} {L('पङ्क्ति', 'rows')}
                </span>
                <div style={{ marginLeft: 'auto' }}>{toolbarContent}</div>
              </div>

              {/* Table — standard DataGrid colors, hand-rolled for rowSpan merging (DataGrid.jsx has no rowSpan support) */}
              <div style={{ overflowX: 'auto', border: '1px solid #dedede', borderRadius: '8px 8px 0 0', borderBottom: 'none' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <thead>
                    <tr>
                      <th style={{ ...thS, width: 40 }}>SN</th>
                      <th style={{ ...thS, width: 85 }}>{L('स्टाफ आईडी', 'Staff ID')}</th>
                      <th style={{ ...thS, textAlign: 'left', minWidth: 200, paddingLeft: 12 }}>{L('कर्मचारी', 'Staff')}</th>
                      <th style={{ ...thS, width: 110 }}>{L('बिदा प्रकार', 'Leave Type')}</th>
                      <th style={{ ...thS, minWidth: 130 }}>{L('बिदा', 'Leave')}</th>
                      <th style={{ ...thS, width: 90 }}>{L('सुरु', 'Opening')}</th>
                      <th style={{ ...thS, width: 90 }}>{L('हाल', 'Current')}</th>
                      <th style={{ ...thS, width: 70 }}>{L('जम्मा', 'Total')}</th>
                      <th style={{ ...thS, width: 70 }}>{L('प्रयोग', 'Used')}</th>
                      <th style={{ ...thS, width: 70, borderRight: 'none' }}>{L('बाँकी', 'Balance')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {balanceRowsSpanned.map((r, ri) => (
                      <tr key={`${r.empId}-${r.ltShortName}-${ri}`} style={{ background: ri % 2 === 0 ? 'white' : '#f9fafb' }}>
                        <td style={{ ...tdS, color: '#374151', fontWeight: 600 }}>{(balPage - 1) * balPageSize + ri + 1}</td>
                        {r._empSpan > 0 && (
                          <td rowSpan={r._empSpan} style={{ ...tdS, verticalAlign: 'top', cursor: 'pointer' }}
                            onClick={() => setViewBalanceEmpId(r.empId)} title={L('विवरण हेर्न क्लिक गर्नुहोस्', 'Click to view details')}>
                            {r.employeeId || '—'}
                          </td>
                        )}
                        {r._empSpan > 0 && (
                          <td rowSpan={r._empSpan} style={{ ...tdS, textAlign: 'left', paddingLeft: 12, verticalAlign: 'top', cursor: 'pointer' }}
                            onClick={() => setViewBalanceEmpId(r.empId)} title={L('विवरण हेर्न क्लिक गर्नुहोस्', 'Click to view details')}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                              <Avatar photo={r.profilePhoto} name={r.fullName} size={26} />
                              <div>
                                <div style={{ fontWeight: 700, color: '#1a56db' }}>{r.fullName}</div>
                                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                                  {[r.postShort, r.deptShort ? `Dept: ${r.deptShort}` : ''].filter(Boolean).join('  |  ')}
                                </div>
                                {r.branchShort && <div style={{ fontSize: 11, color: '#6b7280' }}>Branch: {r.branchShort}</div>}
                              </div>
                            </div>
                          </td>
                        )}
                        {r._ltTypeSpan > 0 && (
                          <td rowSpan={r._ltTypeSpan} style={{ ...tdS }}>
                            <span style={{ fontSize: 12.5, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                              background: r.ltType.includes('Non') || r.ltType.includes('गैर') ? '#f3f4f6' : '#f0fdf4',
                              color:      r.ltType.includes('Non') || r.ltType.includes('गैर') ? '#6b7280'  : '#065f46',
                              border: `1px solid ${r.ltType.includes('Non') || r.ltType.includes('गैर') ? '#e5e7eb' : '#86efac'}`,
                              whiteSpace: 'nowrap' }}>
                              {r.ltType}
                            </span>
                          </td>
                        )}
                        <td style={{ ...tdS, textAlign: 'left', paddingLeft: 10, fontWeight: 600, color: '#1f2937' }}>{r.ltName}</td>
                        <td style={{ ...tdS, background: '#fffbeb', color: '#92400e', fontWeight: 600 }}>{r.opening}</td>
                        <td style={{ ...tdS, background: '#f0fdf4', color: '#065f46', fontWeight: 600 }}>{r.current}</td>
                        <td style={{ ...tdS, fontWeight: 700 }}>{r.total}</td>
                        <td style={{ ...tdS, color: r.used > 0 ? '#be123c' : '#9ca3af', fontWeight: r.used > 0 ? 700 : 400 }}>{r.used || '—'}</td>
                        <td style={{ ...tdS, borderRight: 'none' }}>
                          <span style={{ fontWeight: 700, color: r.balance > 0 ? '#065f46' : r.balance < 0 ? '#be123c' : '#9ca3af' }}>{r.balance}</span>
                        </td>
                      </tr>
                    ))}
                    {balanceFlatRows.length === 0 && (
                      <tr><td colSpan={10} style={{ padding: 32, textAlign: 'center', color: '#9ca3af' }}>
                        {L('कुनै रेकर्ड फेला परेन', 'No records found')}
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div style={{ border: '1px solid #dedede', borderTop: 'none', borderRadius: '0 0 8px 8px' }}>
                <GridPager page={balPage} setPage={setBalPage} pageSize={balPageSize} setPageSize={setBalPageSize}
                  total={balanceFlatRows.length} L={L} itemLabel={L('पङ्क्ति', 'rows')} />
              </div>
            </div>
          );
        })()}
        {activeTab === 'summary' && (
          <DataGrid columns={summaryCols} data={summaryRows} rowKey="id"
            defaultPageSize={summaryRows.length || 12} pageSizeOptions={[summaryRows.length || 12]}
            showCheckbox={false} showFilterButton={false} showSearch={false} showFooter={false}
            onRowClick={row => { setMonthFilter({ key: row.id, label: row.label }); setActiveTab('records'); }}
            toolbar={toolbarContent} />
        )}
      </div>

      <LeaveAdvancedFilter
        isOpen={advFilterOpen} onClose={() => setAdvFilterOpen(false)}
        onApply={applyAdvFilter} onReset={resetAdvFilter}
        tempF={advTempF} setTF={setAdvTF}
        branchOpts={advBranchOpts} deptOpts={advDeptOpts} postOpts={advPostOpts}
        gradeOpts={advGradeOpts}   modeOpts={advModeOpts}
        staffOpts={advStaffOpts}   leaveTypeOpts={advLeaveTypeOpts}
        showFY={false} showAccum={false} L={L}
        showWorkingStatus showFYMulti fyMultiOpts={fyOpts} showDateRange settings={settings}
      />

      {viewLeave && (
        <SidePanelShell
          avatarPhoto={leaveEmp?.profilePhoto}
          avatarName={getEmployeeName(viewLeave.employeeId)}
          infoLine={<InfoLine items={[
            { label: 'Staff ID',   value: leaveEmp?.employeeId },
            { label: 'Post',       value: leaveEmp?.position },
            { label: 'Department', value: leaveEmp?.department },
            { label: 'Branch',     value: leaveEmp?.branch },
          ]} />}
          subtitle={
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 14px',
              background: '#eff6ff', border: '1.5px solid #bfdbfe', borderRadius: 8, padding: '8px 12px', marginTop: 4 }}>
              <span style={{ fontSize: 12, color: '#1e40af' }}>
                {L('आवेदन गरिएको', 'Applied For')}: <strong style={{ fontSize: 13.5 }}>{getLeaveLabel(viewLeave.leaveTypeCode)}</strong>
              </span>
              {leaveBalanceVal != null && (
                <span style={{ fontSize: 12, color: '#1e40af' }}>
                  {L('बिदा मौज्दात', 'Leave Balance')}: <strong style={{ fontSize: 13.5 }}>{leaveBalanceVal}</strong>
                </span>
              )}
            </div>
          }
          statusBadge={<span className="badge badge-success">{L('स्वीकृत', 'Approved')}</span>}
          onClose={() => setViewLeave(null)}
          footer={<button style={panelBtnStyle()} onClick={printOneRecord}>🖨️ {L('प्रिन्ट', 'Print')}</button>}
        >
          <SectionLabel>🗓️ {L('आवेदन विवरण', 'Application Details')}</SectionLabel>
          <DRowPair
            left={{ icon: '📆', label: L('मिति देखि', 'From Date'), value: fd(viewLeave.fromDate) }}
            right={{ icon: '📆', label: L('मिति सम्म', 'To Date'),   value: fd(viewLeave.toDate) }}
          />
          <DRow icon="🗓️" label={L('आवेदन मिति', 'Applied Date')} value={fd(viewLeave.appliedDate)} />
          <DRow icon="🔢" label={L('दिन', 'Days')} value={viewLeave.days} />
          <DRowBox icon="💬" label={L('कारण', 'Reason')} value={viewLeave.reason} />
          {viewLeave.comment && (
            <DRowBox icon="🗨️" label={L('टिप्पणी', 'Comment')} value={viewLeave.comment} bg="#f9fafb" border="#e5e7eb" color="#374151" />
          )}
          <div style={{ marginTop: 16 }}>
            <SectionLabel color="#059669">✅ {L('सिफारिस र स्वीकृति विवरण', 'Recommendation & Approval Details')}</SectionLabel>
            {viewLeave.recommendedBy && (
              <DRow icon="👍" label={L('सिफारिसकर्ता', 'Recommended By')}
                value={`${getEmployeeName(viewLeave.recommendedBy)} · ${viewLeave.recommendedAt ? formatNepalDateTime(viewLeave.recommendedAt, fd) : fd(viewLeave.recommendedDate)}`} />
            )}
            {viewLeave.approvedBy && (
              <DRow icon="✅" label={L('स्वीकृतिकर्ता', 'Approved By')}
                value={`${getEmployeeName(viewLeave.approvedBy)} · ${fd(viewLeave.approvedDate)}`} />
            )}
          </div>
        </SidePanelShell>
      )}

      {/* Balance tab row click → full Summary+Detail drill-down for that
          employee, reusing LeaveCalculation.jsx's own Leave Reports
          (personal ledger) tab wholesale rather than duplicating its
          Transferred/Assigned/Total/Taken/Balance math and Detail listing. */}
      {viewBalanceEmpId != null && (
        <div className="modal-overlay" onClick={() => setViewBalanceEmpId(null)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: 'white', borderRadius: 14, width: '96vw', maxWidth: 1320,
            maxHeight: '90vh', display: 'flex', flexDirection: 'column',
            boxShadow: '0 25px 60px rgba(0,0,0,.18)', overflow: 'hidden',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '16px 24px', borderBottom: '2px solid #e5e7eb', background: 'white', flexShrink: 0 }}>
              <div style={{ fontSize: 17, fontWeight: 800, color: '#111827', display: 'flex', alignItems: 'center', gap: 8 }}>
                📊 {L('बिदा विवरण', 'Leave Balance & History')}
              </div>
              <button onClick={() => setViewBalanceEmpId(null)}
                style={{ background: '#f3f4f6', border: 'none', borderRadius: '50%', width: 36, height: 36,
                  fontSize: 18, cursor: 'pointer', color: '#6b7280', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                ×
              </button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1, padding: '20px 24px' }}>
              <LeaveReportsTab
                employees={filteredEmployees} leaves={filteredLeaves} L={L} fd={fd} settings={settings}
                opening={leaveOpening} leaveBalances={leaveBalances}
                forcedEmpId={viewBalanceEmpId} hideStaffPicker
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LeaveReports;
