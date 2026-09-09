import React, { useState, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useLanguage } from '../../context/LanguageContext.jsx';
import { useData } from '../../context/DataContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import { makeDateFormatter, adToBS, getNepalTodayISO, formatNepalDateTime, BS_MONTHS_NP, BS_MONTHS_EN } from '../../utils/dateUtils.js';
import useRecoApproval from '../../hooks/useRecoApproval.js';
import DataGrid from '../DataGrid/DataGrid.jsx';
import Avatar from '../Common/Avatar.jsx';
import { buildPrintDoc, openPrintWindow, getExcelHeaderRows, downloadCSV } from '../../utils/printHelper.js';
import { LeaveAdvancedFilter, DEFAULT_ADV_FILTERS } from '../Leave/LeaveCalculation.jsx';
import { SidePanelShell, DRow, DRowPair, DRowBox, SectionLabel, InfoLine, panelBtnStyle } from '../Leave/LeaveVisitPage.jsx';

const MONTHS_EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTHS_NP = ['जन','फेब','मार्च','अप्रि','मे','जुन','जुल','अग','सेप्ट','अक्टो','नोभ','डिसे'];

const TABS = [
  { key: 'records', icon: '🏢', labelNp: 'भ्रमण विवरण',           labelEn: 'Visit Records' },
  { key: 'summary', icon: '📊', labelNp: 'सारांश भ्रमण प्रतिवेदन', labelEn: 'Summarized Office Visit Report' },
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
    { field: 'recommendatorNames', header: L('सिफारिसकर्ता', 'Recommendator'), width: 150, sortable: false, filterable: false,
      render: (_, row) => <span style={{ fontSize: 12, color: '#6b7280' }}>{namesFor(row.employeeId, 'reco')}</span> },
    { field: 'approvalNames', header: L('स्वीकृतिकर्ता', 'Approval'), width: 150, sortable: false, filterable: false,
      render: (_, row) => <span style={{ fontSize: 12, color: '#6b7280' }}>{namesFor(row.employeeId, 'approval')}</span> },
  ];

  /* ── Tab 2: summarized office visit report — month list, zero-filled ── */
  const summaryMonths = useMemo(() => {
    const useBS = settings.defaultCalendar === 'np';
    let ranges = [];
    if (advFilters.fromDate && advFilters.toDate) {
      ranges = useBS ? bsMonthRange(advFilters.fromDate, advFilters.toDate) : adMonthRange(advFilters.fromDate, advFilters.toDate);
    } else {
      const now = useBS ? adToBS(getNepalTodayISO()) : { year: new Date().getFullYear() };
      for (let m = 1; m <= 12; m++) ranges.push({ year: now.year, month: m });
    }
    const seen = new Set(); const uniq = [];
    ranges.forEach(r => { const k = `${r.year}-${r.month}`; if (!seen.has(k)) { seen.add(k); uniq.push(r); } });
    uniq.sort((a, b) => a.year - b.year || a.month - b.month);
    return uniq;
  }, [advFilters.fromDate, advFilters.toDate, settings.defaultCalendar]);

  const summaryRows = useMemo(() => {
    const useBS = settings.defaultCalendar === 'np';
    const buckets = summaryMonths.map(({ year, month }) => ({
      id: `${year}-${month}`, year, month,
      label: `${useBS ? MONTHS_BS[month - 1] : MONTHS[month - 1]} ${year}`,
      count: 0,
    }));
    const idx = new Map(buckets.map(b => [`${b.year}-${b.month}`, b]));
    approvedVisits.forEach(v => {
      let year, month;
      if (useBS) { const bs = adToBS(v.fromDate); if (!bs) return; year = bs.year; month = bs.month; }
      else { const d = new Date(v.fromDate); year = d.getFullYear(); month = d.getMonth() + 1; }
      const b = idx.get(`${year}-${month}`);
      if (b) b.count += 1;
    });
    return buckets;
  }, [summaryMonths, approvedVisits, settings.defaultCalendar, MONTHS_BS, MONTHS]);

  const summaryCols = [
    { field: 'label', header: L('महिना', 'Month'), width: 150, render: v => <span style={{ fontWeight: 600 }}>{v}</span> },
    { field: 'count', header: L('जम्मा भ्रमण संख्या', 'No. of Visits Taken'), width: 180 },
  ];

  /* ── Print / Excel export — operates on whichever tab is active ── */
  const currentExport = () => {
    if (activeTab === 'summary') {
      return {
        title: L('सारांश भ्रमण प्रतिवेदन', 'Summarized Office Visit Report'),
        headers: ['SN', L('महिना', 'Month'), L('जम्मा भ्रमण संख्या', 'No. of Visits Taken')],
        rows: summaryRows.map((r, i) => [i + 1, r.label, r.count]),
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
              onClick={() => setActiveTab(tab.key)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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
        {activeTab === 'summary' && (
          <DataGrid columns={summaryCols} data={summaryRows} rowKey="id"
            defaultPageSize={summaryRows.length || 12} pageSizeOptions={[summaryRows.length || 12]}
            showCheckbox={false} showFilterButton={false} showSearch={false} showFooter={false}
            toolbar={toolbarContent} />
        )}
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
