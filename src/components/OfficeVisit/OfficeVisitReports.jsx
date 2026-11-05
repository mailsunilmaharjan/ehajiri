import React, { useState, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useLanguage } from '../../context/LanguageContext.jsx';
import { useData } from '../../context/DataContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import { makeDateFormatter, adToBS, getNepalTodayISO, formatNepalDateTime, getCurrentFiscalYear, BS_MONTHS_NP, BS_MONTHS_EN } from '../../utils/dateUtils.js';
import useRecoApproval from '../../hooks/useRecoApproval.js';
import DataGrid from '../DataGrid/DataGrid.jsx';
import Avatar from '../Common/Avatar.jsx';
import HoverCard from '../Common/HoverCard.jsx';
import { buildPrintDoc, openPrintWindow, getExcelHeaderRows, downloadCSV } from '../../utils/printHelper.js';
import { LeaveAdvancedFilter, DEFAULT_ADV_FILTERS } from '../Leave/LeaveCalculation.jsx';
import { SidePanelShell, DRow, DRowPair, DRowBox, SectionLabel, InfoLine, panelBtnStyle } from '../Leave/LeaveVisitPage.jsx';

const MONTHS_EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTHS_NP = ['जन','फेब','मार्च','अप्रि','मे','जुन','जुल','अग','सेप्ट','अक्टो','नोभ','डिसे'];

const TABS = [
  { key: 'records', icon: '🏢', labelNp: 'भ्रमण विवरण',       labelEn: 'Visit Records' },
  { key: 'yearly',  icon: '📊', labelNp: 'वार्षिक कार्यालय भ्रमण', labelEn: 'Yearly Office Visit' },
  { key: 'ledger',  icon: '📒', labelNp: 'मासिक भ्रमण लेजर',   labelEn: 'Office Visit Monthly Ledger' },
];

const REPORT_DEFAULT_FILTERS = { ...DEFAULT_ADV_FILTERS, fromDate: '', toDate: '', workingStatus: 'working' };

const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

function adMonthRange(startISO, endISO) {
  const s = new Date(startISO), e = new Date(endISO);
  const out = []; let y = s.getFullYear(), m = s.getMonth() + 1;
  const eY = e.getFullYear(), eM = e.getMonth() + 1;
  let guard = 0;
  while ((y < eY || (y === eY && m <= eM)) && guard++ < 240) { out.push({ year: y, month: m }); m++; if (m > 12) { m = 1; y++; } }
  return out;
}
function bsMonthRange(startISO, endISO) {
  const s = adToBS(startISO), e = adToBS(endISO);
  if (!s || !e) return [];
  const out = []; let y = s.year, m = s.month;
  let guard = 0;
  while ((y < e.year || (y === e.year && m <= e.month)) && guard++ < 240) { out.push({ year: y, month: m }); m++; if (m > 12) { m = 1; y++; } }
  return out;
}

const OfficeVisitReports = () => {
  const { language } = useLanguage();
  const L = (np, en) => language === 'np' ? np : en;
  const MONTHS = language === 'np' ? MONTHS_NP : MONTHS_EN;
  const MONTHS_BS = language === 'np' ? BS_MONTHS_NP : BS_MONTHS_EN;
  const { currentUser, isAdmin, isBranchManager, isDeptHead } = useAuth();
  const { filteredEmployees, filteredVisits, getEmployeeById, getEmployeeName } = useData();
  const { settings } = useSettings();
  const { getRecoIds, getApprovalIds } = useRecoApproval();
  const fd = makeDateFormatter(settings);

  const canBroadenScope = isAdmin || isBranchManager || isDeptHead;

  const [activeTab,    setActiveTab]    = useState('records');
  const [viewScope,    setViewScope]    = useState('own'); // 'own' | 'all'
  const [advFilters,   setAdvFilters]   = useState({ ...REPORT_DEFAULT_FILTERS });
  const [advTempF,     setAdvTempF]     = useState({ ...REPORT_DEFAULT_FILTERS });
  const [advFilterOpen, setAdvFilterOpen] = useState(false);
  const [viewVisit,    setViewVisit]    = useState(null);
  // Which month row (if any) the Monthly Ledger tab is drilled into — null
  // shows the month list, set shows that month's individual visit records.
  const [ledgerMonth,  setLedgerMonth]  = useState(null);
  // Anchor Fiscal Year for the Yearly Office Visit tab's 3-year comparison —
  // null means "use the current FY" (see anchorFY below).
  const [yearlyFyId,   setYearlyFyId]   = useState(null);

  const setAdvTF = (key, val) => setAdvTempF(p => ({ ...p, [key]: val }));
  const openAdvFilter  = () => { setAdvTempF({ ...advFilters }); setAdvFilterOpen(true); };
  const applyAdvFilter = () => { setAdvFilters({ ...advTempF }); setAdvFilterOpen(false); };
  const resetAdvFilter = () => setAdvTempF({ ...REPORT_DEFAULT_FILTERS });
  const advFilterCount = [advFilters.branches, advFilters.departments, advFilters.posts,
    advFilters.grades, advFilters.modes, advFilters.staffIds]
    .filter(a => a.length > 0).length + (advFilters.workingStatus !== 'working' ? 1 : 0);

  const advBranchOpts = useMemo(() => (settings.branches || []).map(b => ({ value: b.name, label: b.name })), [settings.branches]);
  const advDeptOpts   = useMemo(() => (settings.departments || []).map(d => ({ value: d.name, label: d.name })), [settings.departments]);
  const advPostOpts   = useMemo(() => (settings.posts || []).map(p => ({ value: p.name, label: p.name })), [settings.posts]);
  const advGradeOpts  = useMemo(() => (settings.grades || []).map(g => ({ value: g.name, label: g.name })), [settings.grades]);
  const advModeOpts   = useMemo(() => (settings.modes || []).map(m => ({ value: m.name, label: m.name })), [settings.modes]);
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

  /* ── Tab 1: approved office visits only, in scope, date-range filtered ── */
  const approvedVisits = useMemo(() => filteredVisits.filter(v => {
    if (v.status !== 'approved') return false;
    if (!scopedEmpIdSet.has(String(v.employeeId))) return false;
    if (advFilters.fromDate && v.fromDate < advFilters.fromDate) return false;
    if (advFilters.toDate   && v.fromDate > advFilters.toDate)   return false;
    return true;
  }).sort((a, b) => new Date(b.fromDate) - new Date(a.fromDate)), [filteredVisits, scopedEmpIdSet, advFilters.fromDate, advFilters.toDate]);

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

  // Avatar + hover (photo, name, post) for exactly one person — see the
  // identical helper in LeaveReports.jsx's own comment for why this
  // resolves to a single recommendedBy/approvedBy (or recoId/approvalId)
  // id instead of namesFor's full configured-candidate list.
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
    { field: 'purpose', header: L('कार्यालय भ्रमण', 'Official Visit'), width: 150, render: (v, row) => row.officialVisit || v || '—' },
    { field: 'fromDate', header: L('मिति देखि', 'From Date'), width: 110, render: v => fd(v) },
    { field: 'toDate',   header: L('मिति सम्म', 'To Date'),   width: 110, render: v => fd(v) },
    { field: 'appliedDate', header: L('आवेदन मिति', 'Applied Date'), width: 110, render: v => fd(v) },
    { field: 'status', header: L('स्थिति', 'Status'), width: 100, render: () => (
        <span className="badge badge-success">{L('स्वीकृत', 'Approved')}</span>
      ) },
    { field: 'recommendatorNames', header: L('सिफारिसकर्ता', 'Recommendator'), width: 200, sortable: false, filterable: false,
      render: (_, row) => personHoverCell(row.recommendedBy || row.recoId) },
    { field: 'approvalNames', header: L('स्वीकृतिकर्ता', 'Approval'), width: 200, sortable: false, filterable: false,
      render: (_, row) => personHoverCell(row.approvedBy || row.approvalId) },
  ];

  // Inclusive day-span of one visit (fromDate..toDate, same day = 1).
  const visitDays = (v) => {
    const days = Math.round((new Date(v.toDate) - new Date(v.fromDate)) / 86400000) + 1;
    return isNaN(days) ? 0 : days;
  };

  // Shared by the Monthly Ledger tab — zero-filled month buckets (so a
  // month with no visits still shows a 0 row) counted against whichever
  // fromDate calendar (BS/AD) Settings > Default Calendar picks. `days` is
  // the sum of every visit's own day-span within that month, not a count
  // of distinct dates — a single 5-day visit adds 5, not 1.
  const monthBucketsFor = (months, visits) => {
    const useBS = settings.defaultCalendar === 'np';
    const buckets = months.map(({ year, month }) => ({
      id: `${year}-${month}`, year, month,
      label: `${useBS ? MONTHS_BS[month - 1] : MONTHS[month - 1]} ${year}`,
      count: 0, days: 0,
    }));
    const idx = new Map(buckets.map(b => [`${b.year}-${b.month}`, b]));
    visits.forEach(v => {
      let year, month;
      if (useBS) { const bs = adToBS(v.fromDate); if (!bs) return; year = bs.year; month = bs.month; }
      else { const d = new Date(v.fromDate); year = d.getFullYear(); month = d.getMonth() + 1; }
      const b = idx.get(`${year}-${month}`);
      if (b) { b.count += 1; b.days += visitDays(v); }
    });
    return buckets;
  };

  // ── Tab 2: Yearly Office Visit — one row per configured Office Visit Type
  // (Settings > Office Visit Types), one column per fiscal year, spanning
  // the 3 fiscal years ending at whichever one is selected in the tab's own
  // Fiscal Year picker (defaults to the current FY) — "check the Fiscal
  // Year" from the feature request. Year LABELS respect Settings > Default
  // Calendar (BS/AD), same as every other date-driven report on this page.
  const sortedFYs = useMemo(() =>
    [...(settings.fiscalYears || [])].sort((a, b) => new Date(b.startDate) - new Date(a.startDate)),
    [settings.fiscalYears]);
  const currentFY = useMemo(() => getCurrentFiscalYear(settings.fiscalYears || []), [settings.fiscalYears]);
  const anchorFY = useMemo(() => {
    const byId = yearlyFyId != null ? sortedFYs.find(fy => fy.id === yearlyFyId) : null;
    return byId || currentFY || sortedFYs[0] || null;
  }, [yearlyFyId, sortedFYs, currentFY]);
  // The anchor FY plus the two immediately before it, newest first.
  const yearlyFYs = useMemo(() => {
    if (!anchorFY) return [];
    const idx = sortedFYs.findIndex(fy => fy.id === anchorFY.id);
    return idx === -1 ? [anchorFY] : sortedFYs.slice(idx, idx + 3);
  }, [anchorFY, sortedFYs]);
  // byFY[fy.id] = { count, days } — days is the sum of every matching
  // visit's own day-span within that fiscal year (see visitDays above).
  const yearlyRows = useMemo(() => {
    const types = settings.officeVisitTypes || [];
    const rows = types.map(t => ({ id: `type-${t.id}`, name: t.name, byFY: {} }));
    const byName = new Map(rows.map(r => [r.name, r]));
    let otherRow = null;
    approvedVisits.forEach(v => {
      const fy = yearlyFYs.find(f => v.fromDate >= f.startDate && v.fromDate <= f.endDate);
      if (!fy) return;
      const purpose = v.officialVisit || v.purpose;
      let row = byName.get(purpose);
      if (!row) {
        // A visit whose purpose no longer matches any currently-configured
        // Office Visit Type (e.g. renamed/removed since) — bucketed here
        // instead of silently dropped from the yearly totals.
        if (!otherRow) otherRow = { id: 'type-other', name: L('अन्य', 'Other'), byFY: {} };
        row = otherRow;
      }
      const cell = row.byFY[fy.id] || (row.byFY[fy.id] = { count: 0, days: 0 });
      cell.count += 1;
      cell.days += visitDays(v);
    });
    return otherRow ? [...rows, otherRow] : rows;
  }, [settings.officeVisitTypes, approvedVisits, yearlyFYs, L]);
  // "1 (3 days)" — visit count plus its total day-span in the same cell,
  // per the feature request ("eg 1 - 5 days" alongside each year's count).
  const yearlyCell = (row, fyId) => {
    const cell = row.byFY[fyId];
    if (!cell || !cell.count) return 0;
    return `${cell.count} (${cell.days} ${L('दिन', cell.days === 1 ? 'day' : 'days')})`;
  };
  const yearlyCols = [
    { field: 'name', header: L('कार्यालय भ्रमणको नाम', 'Office Visit Name'), width: 220, fill: true,
      render: v => <span style={{ fontWeight: 600 }}>{v}</span> },
    ...yearlyFYs.map(fy => ({
      field: `y${fy.id}`, header: fy.name, width: 150, align: 'center', sortable: false,
      render: (_, row) => yearlyCell(row, fy.id),
    })),
  ];
  const yearlyFySelect = (
    <select value={anchorFY?.id ?? ''} onChange={e => setYearlyFyId(Number(e.target.value))}
      style={{ height: 32, padding: '0 10px', border: '1px solid #d1d5db', borderRadius: 6,
        fontSize: 12.5, fontWeight: 600, color: '#374151', background: '#fff', cursor: 'pointer' }}>
      {sortedFYs.map(fy => <option key={fy.id} value={fy.id}>{fy.name}</option>)}
    </select>
  );

  // ── Tab 3: Monthly Ledger — same month-count idea, but always spans the
  // current Fiscal Year (Settings > Fiscal Year) start-to-end month rather
  // than a manually picked date range, and each row drills into that
  // month's individual visit records (see ledgerMonth state).
  const ledgerMonths = useMemo(() => {
    const useBS = settings.defaultCalendar === 'np';
    if (currentFY) {
      return useBS ? bsMonthRange(currentFY.startDate, currentFY.endDate) : adMonthRange(currentFY.startDate, currentFY.endDate);
    }
    // No fiscal year configured yet — same calendar-year-of-12-months
    // fallback the Summary tab uses without a date range picked.
    const now = useBS ? adToBS(getNepalTodayISO()) : { year: new Date().getFullYear() };
    const out = [];
    for (let m = 1; m <= 12; m++) out.push({ year: now.year, month: m });
    return out;
  }, [currentFY, settings.defaultCalendar]);
  const ledgerRows = useMemo(() => monthBucketsFor(ledgerMonths, approvedVisits),
    [ledgerMonths, approvedVisits, settings.defaultCalendar, MONTHS_BS, MONTHS]);

  const ledgerCols = [
    { field: 'label', header: L('महिना', 'Month'), width: 200, fill: true, render: v => <span style={{ fontWeight: 600 }}>{v}</span> },
    { field: 'count', header: L('जम्मा भ्रमण संख्या', 'No. of Visit'), width: 150 },
    { field: 'days', header: L('जम्मा दिन संख्या', 'No. of Days'), width: 150 },
  ];

  // This month's individual records, oldest first — feeds the ledger's
  // drill-down grid once a month row is clicked.
  const ledgerMonthVisits = useMemo(() => {
    if (!ledgerMonth) return [];
    const useBS = settings.defaultCalendar === 'np';
    return approvedVisits.filter(v => {
      if (useBS) { const bs = adToBS(v.fromDate); return !!bs && bs.year === ledgerMonth.year && bs.month === ledgerMonth.month; }
      const d = new Date(v.fromDate);
      return d.getFullYear() === ledgerMonth.year && (d.getMonth() + 1) === ledgerMonth.month;
    }).sort((a, b) => new Date(a.fromDate) - new Date(b.fromDate));
  }, [ledgerMonth, approvedVisits, settings.defaultCalendar]);

  // Avatar + Name + the actual recommend/approve date, always visible (no
  // hover needed) — per the Monthly Ledger's own spec, distinct from
  // personHoverCell above (Visit Records' compact avatar-only + hover-for-
  // post convention).
  const personWithDateCell = (empId, dateStr) => {
    if (!empId) return <span style={{ color: '#d1d5db' }}>—</span>;
    const emp = getEmployeeById(empId);
    const name = getEmployeeName(empId);
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Avatar photo={emp?.profilePhoto} name={name} size={22} preview={false} />
        <span>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: '#111827' }}>{name}</div>
          <div style={{ fontSize: 10.5, color: '#6b7280' }}>{dateStr || '—'}</div>
        </span>
      </span>
    );
  };

  const ledgerDetailCols = [
    { field: 'fromDate', header: L('मिति देखि', 'From Date'), width: 110, render: v => fd(v) },
    { field: 'toDate',   header: L('मिति सम्म', 'To Date'),   width: 110, render: v => fd(v) },
    { field: 'days', header: L('दिन', 'Days'), width: 60, align: 'center', sortable: false,
      render: (_, row) => <strong style={{ color: '#1a56db' }}>{visitDays(row)}</strong> },
    { field: 'country', header: L('देश', 'Country'), width: 100, sortable: false,
      render: (_, row) => row.visitType === 'International' ? (row.country || '—') : 'Nepal' },
    { field: 'location', header: L('ठेगाना', 'Address'), width: 160,
      render: (_, row) => row.address || row.location || '—' },
    { field: 'purposeOfVisit', header: L('भ्रमणको उद्देश्य', 'Purpose of Visit'), width: 220, sortable: false, filterable: false,
      render: (_, row) => row.description || row.reason || row.purpose || '—' },
    { field: 'recommendatorNames', header: L('सिफारिसकर्ता', 'Recommendator'), width: 170, sortable: false, filterable: false,
      render: (_, row) => personWithDateCell(row.recommendedBy || row.recoId,
        row.recommendedAt ? formatNepalDateTime(row.recommendedAt, fd) : fd(row.recommendedDate)) },
    { field: 'approvalNames', header: L('स्वीकृतिकर्ता', 'Approval'), width: 170, sortable: false, filterable: false,
      render: (_, row) => personWithDateCell(row.approvedBy || row.approvalId, fd(row.approvedDate)) },
  ];

  /* ── Print / Excel export — operates on whichever tab (and, for the
     Ledger tab, whichever drill-down state) is active ── */
  const currentExport = () => {
    if (activeTab === 'yearly') {
      return {
        title: L('वार्षिक कार्यालय भ्रमण', 'Yearly Office Visit'),
        headers: ['SN', L('कार्यालय भ्रमणको नाम', 'Office Visit Name'), ...yearlyFYs.map(fy => fy.name)],
        rows: yearlyRows.map((r, i) => [i + 1, r.name, ...yearlyFYs.map(fy => yearlyCell(r, fy.id))]),
      };
    }
    if (activeTab === 'ledger') {
      if (ledgerMonth) {
        return {
          title: `${L('मासिक भ्रमण लेजर', 'Office Visit Monthly Ledger')} — ${ledgerMonth.label}`,
          headers: ['SN', L('मिति देखि', 'From Date'), L('मिति सम्म', 'To Date'), L('दिन', 'Days'),
            L('देश', 'Country'), L('ठेगाना', 'Address'), L('भ्रमणको उद्देश्य', 'Purpose of Visit'),
            L('सिफारिसकर्ता', 'Recommendator'), L('स्वीकृतिकर्ता', 'Approval')],
          rows: ledgerMonthVisits.map((v, i) => {
            const recoId = v.recommendedBy || v.recoId, apprId = v.approvedBy || v.approvalId;
            const recoDate = v.recommendedAt ? formatNepalDateTime(v.recommendedAt, fd) : fd(v.recommendedDate);
            return [
              i + 1, fd(v.fromDate), fd(v.toDate), visitDays(v),
              v.visitType === 'International' ? (v.country || '—') : 'Nepal',
              v.address || v.location || '—', v.description || v.reason || v.purpose || '—',
              recoId ? `${getEmployeeName(recoId)} (${recoDate || '—'})` : '—',
              apprId ? `${getEmployeeName(apprId)} (${fd(v.approvedDate) || '—'})` : '—',
            ];
          }),
        };
      }
      return {
        title: L('मासिक भ्रमण लेजर', 'Office Visit Monthly Ledger'),
        headers: ['SN', L('महिना', 'Month'), L('जम्मा भ्रमण संख्या', 'No. of Visit'), L('जम्मा दिन संख्या', 'No. of Days')],
        rows: ledgerRows.map((r, i) => [i + 1, r.label, r.count, r.days]),
      };
    }
    return {
      title: L('भ्रमण विवरण', 'Visit Records'),
      headers: ['SN', 'Staff ID', L('नाम', 'Name'), L('कार्यालय भ्रमण', 'Official Visit'),
        L('मिति देखि', 'From Date'), L('मिति सम्म', 'To Date'), L('आवेदन मिति', 'Applied Date'),
        L('स्थिति', 'Status'), L('सिफारिसकर्ता', 'Recommendator'), L('स्वीकृतिकर्ता', 'Approval')],
      rows: approvedVisits.map((v, i) => [
        i + 1, getEmployeeById(v.employeeId)?.employeeId || '', getEmployeeName(v.employeeId),
        v.officialVisit || v.purpose || '—', fd(v.fromDate), fd(v.toDate), fd(v.appliedDate),
        L('स्वीकृत', 'Approved'), namesWithPostFor(v.employeeId, 'reco'), namesWithPostFor(v.employeeId, 'approval'),
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
  const visitEmp = viewVisit ? getEmployeeById(viewVisit.employeeId) : null;
  // Mirrors the Leave Management page's own print (LeaveVisitPage.jsx's
  // printRecord/sigLine) — a Name + Post signature line per person — but
  // simplified for a report of already-decided records: no Approve/Reject
  // checkboxes (nothing here is pending), status is shown as a plain
  // "APPROVED" line, and each signature line is already filled in with the
  // real decision date instead of a blank line to sign on.
  const sigBlock = (label, empId, dateStr) => {
    const emp = empId ? getEmployeeById(empId) : null;
    if (!emp) return '';
    return `
      <div style="margin-top:16px; padding-top:12px; border-top:1px dashed #cbd5e1;">
        <div style="font-size:11px; color:#374151;">
          <strong>Name:</strong> ${getEmployeeName(empId)}${emp.position ? ` &nbsp;&nbsp;&nbsp; <strong>Post:</strong> ${emp.position}` : ''}
        </div>
        <div style="font-size:10px; color:#6b7280; margin-top:2px;">Date: ${dateStr || '—'}</div>
        <div style="font-size:11px; font-weight:700; color:#1e3a8a; margin-top:6px;">${label}</div>
      </div>`;
  };
  const printOneRecord = () => {
    if (!viewVisit) return;
    const rows = [
      ['Staff', `${getEmployeeName(viewVisit.employeeId)}${visitEmp?.position ? ` — ${visitEmp.position}` : ''}`],
      ['Official Visit', viewVisit.officialVisit || viewVisit.purpose || '—'],
      ['From Date', fd(viewVisit.fromDate)],
      ['To Date', fd(viewVisit.toDate)],
      ['Applied Date', fd(viewVisit.appliedDate)],
      ['Address', viewVisit.address || viewVisit.location || '—'],
      ['Description', viewVisit.description || viewVisit.reason || '—'],
      ['Status', '<strong style="color:#059669">APPROVED</strong>'],
    ];
    const mainTable = `<table>${rows.map(([k, v]) => `<tr><th style="text-align:left;white-space:normal">${k}</th><td style="padding:5px 7px;border:1px solid #dedede">${v}</td></tr>`).join('')}</table>`;
    const recoDate = viewVisit.recommendedAt ? formatNepalDateTime(viewVisit.recommendedAt, fd) : fd(viewVisit.recommendedDate);
    const apprDate = fd(viewVisit.approvedDate);
    const contentHtml = mainTable
      + sigBlock('Recommendator', viewVisit.recommendedBy, recoDate)
      + sigBlock('Approval', viewVisit.approvedBy, apprDate);
    const doc = buildPrintDoc({ settings, language, reportTitle: 'Office Visit Record', contentHtml });
    openPrintWindow(doc);
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
          <h1 className="page-title">🏢 {L('कार्यालय भ्रमण रिपोर्टहरू', 'Office Visit Reports')}</h1>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 'var(--radius-md) var(--radius-md) 0 0', borderBottom: 'none' }}>
        <div className="tabs" style={{ padding: '0 20px', marginBottom: 0, borderBottom: '2px solid var(--border)' }}>
          {TABS.map(tab => (
            <button key={tab.key} className={`tab-btn ${activeTab === tab.key ? 'active' : ''}`}
              onClick={() => { setActiveTab(tab.key); if (tab.key !== activeTab) setLedgerMonth(null); }}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>{tab.icon}</span>{L(tab.labelNp, tab.labelEn)}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div style={{ background: 'white', border: '1px solid var(--border)', borderTop: 'none', borderRadius: '0 0 var(--radius-md) var(--radius-md)', padding: 20 }}>
        {activeTab === 'records' && (
          <DataGrid columns={recordCols} data={approvedVisits} rowKey="id" defaultPageSize={20}
            showCheckbox={false} showFilterButton={false} searchPlaceholder={L('खोज्नुस...', 'Search...')}
            onRowClick={row => setViewVisit(v => v?.id === row.id ? null : row)}
            toolbar={toolbarContent} />
        )}
        {activeTab === 'yearly' && (
          <DataGrid columns={yearlyCols} data={yearlyRows} rowKey="id"
            defaultPageSize={yearlyRows.length || 12} pageSizeOptions={[yearlyRows.length || 12]}
            showCheckbox={false} showFilterButton={false} showSearch={false} showFooter={false} autoWidth
            toolbar={<div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>{yearlyFySelect}{toolbarContent}</div>} />
        )}
        {activeTab === 'ledger' && (ledgerMonth ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
              <button onClick={() => setLedgerMonth(null)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px',
                  background: '#f1f5f9', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 12.5,
                  fontWeight: 600, color: '#374151', cursor: 'pointer' }}>
                ← {L('महिनाहरूमा फर्कनुस्', 'Back to Months')}
              </button>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#1e293b' }}>{ledgerMonth.label}</span>
              <span style={{ fontSize: 12.5, color: '#6b7280' }}>
                {ledgerMonth.count} {L('भ्रमण', ledgerMonth.count === 1 ? 'visit' : 'visits')}
              </span>
            </div>
            <DataGrid columns={ledgerDetailCols} data={ledgerMonthVisits} rowKey="id" defaultPageSize={20}
              showCheckbox={false} showFilterButton={false} searchPlaceholder={L('खोज्नुस...', 'Search...')}
              toolbar={toolbarContent} />
          </>
        ) : (
          <DataGrid columns={ledgerCols} data={ledgerRows} rowKey="id"
            defaultPageSize={ledgerRows.length || 12} pageSizeOptions={[ledgerRows.length || 12]}
            showCheckbox={false} showFilterButton={false} showSearch={false} showFooter={false} autoWidth
            onRowClick={row => setLedgerMonth(row)}
            toolbar={toolbarContent} />
        ))}
      </div>

      <LeaveAdvancedFilter
        isOpen={advFilterOpen} onClose={() => setAdvFilterOpen(false)}
        onApply={applyAdvFilter} onReset={resetAdvFilter}
        tempF={advTempF} setTF={setAdvTF}
        branchOpts={advBranchOpts} deptOpts={advDeptOpts} postOpts={advPostOpts}
        gradeOpts={advGradeOpts}   modeOpts={advModeOpts}
        staffOpts={advStaffOpts}
        showFY={false} showAccum={false} showLeave={false} L={L}
        showWorkingStatus showDateRange settings={settings}
      />

      {viewVisit && (
        <SidePanelShell
          avatarPhoto={visitEmp?.profilePhoto}
          avatarName={getEmployeeName(viewVisit.employeeId)}
          infoLine={<InfoLine items={[
            { label: 'Staff ID',   value: visitEmp?.employeeId },
            { label: 'Post',       value: visitEmp?.position },
            { label: 'Department', value: visitEmp?.department },
            { label: 'Branch',     value: visitEmp?.branch },
          ]} />}
          subtitle={
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 14px',
              background: '#eff6ff', border: '1.5px solid #bfdbfe', borderRadius: 8, padding: '8px 12px', marginTop: 4 }}>
              <span style={{ fontSize: 12, color: '#1e40af' }}>
                {L('कार्यालय भ्रमण', 'Official Visit')}: <strong style={{ fontSize: 13.5 }}>{viewVisit.officialVisit || viewVisit.purpose || '—'}</strong>
              </span>
            </div>
          }
          statusBadge={<span className="badge badge-success">{L('स्वीकृत', 'Approved')}</span>}
          onClose={() => setViewVisit(null)}
          footer={<button style={panelBtnStyle()} onClick={printOneRecord}>🖨️ {L('प्रिन्ट', 'Print')}</button>}
        >
          <SectionLabel>🗓️ {L('आवेदन विवरण', 'Application Details')}</SectionLabel>
          {(viewVisit.visitType || viewVisit.country) && (
            <DRowPair
              left={{ icon: viewVisit.visitType === 'International' ? '🌍' : '🇳🇵', label: 'Visit Type', value: viewVisit.visitType || 'National' }}
              right={{ icon: '🌐', label: 'Country', value: viewVisit.visitType === 'International' ? (viewVisit.country || '—') : 'Nepal' }}
            />
          )}
          <DRow icon="📍" label={L('ठेगाना', 'Address')} value={viewVisit.address || viewVisit.location} />
          <DRowPair
            left={{ icon: '📆', label: L('मिति देखि', 'From Date'), value: fd(viewVisit.fromDate) }}
            right={{ icon: '📆', label: L('मिति सम्म', 'To Date'),   value: fd(viewVisit.toDate) }}
          />
          <DRow icon="🗓️" label={L('आवेदन मिति', 'Applied Date')} value={fd(viewVisit.appliedDate)} />
          <DRowBox icon="📝" label={L('विवरण', 'Description')} value={viewVisit.description || viewVisit.reason} />
          {viewVisit.comment && (
            <DRowBox icon="🗨️" label={L('टिप्पणी', 'Comment')} value={viewVisit.comment} bg="#f9fafb" border="#e5e7eb" color="#374151" />
          )}
          <div style={{ marginTop: 16 }}>
            <SectionLabel color="#059669">✅ {L('सिफारिस र स्वीकृति विवरण', 'Recommendation & Approval Details')}</SectionLabel>
            {viewVisit.recommendedBy && (
              <DRow icon="👍" label={L('सिफारिसकर्ता', 'Recommended By')}
                value={`${getEmployeeName(viewVisit.recommendedBy)} · ${viewVisit.recommendedAt ? formatNepalDateTime(viewVisit.recommendedAt, fd) : fd(viewVisit.recommendedDate)}`} />
            )}
            {viewVisit.approvedBy && (
              <DRow icon="✅" label={L('स्वीकृतिकर्ता', 'Approved By')}
                value={`${getEmployeeName(viewVisit.approvedBy)} · ${fd(viewVisit.approvedDate)}`} />
            )}
          </div>
        </SidePanelShell>
      )}
    </div>
  );
};

export default OfficeVisitReports;
