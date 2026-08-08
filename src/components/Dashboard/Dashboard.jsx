import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useData } from '../../context/DataContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import api from '../../api/client.js';
import { getNepalTodayISO, getNepalNow, adToBS, bsToAD, getBSDays, BS_MONTHS_NP, toNepaliDigits } from '../../utils/dateUtils.js';
import { ChartLegend, HalfDonut, Av, AvatarStack, SeverityBars } from './charts.jsx';
import MyMonthlyCalendar from './MyMonthlyCalendar.jsx';

const STYLES = `
  .adb-p { padding:20px 22px; background:#f1f5f9; min-height:100vh; min-height:100dvh; }
  .adb-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(360px, 1fr)); gap:16px; align-items:start; margin-bottom:16px; }
  .adb-grid3 { display:grid; grid-template-columns:repeat(auto-fit, minmax(300px, 1fr)); gap:16px; align-items:stretch; margin-bottom:16px; }
  .adb-grid6 { display:grid; grid-template-columns:repeat(auto-fit, minmax(190px, 1fr)); gap:12px; margin-bottom:16px; }
  .adb-grid-cal { display:grid; grid-template-columns:2.2fr 1fr; gap:16px; align-items:stretch; margin-bottom:16px; }
  @media(max-width:900px){ .adb-p { padding:14px 16px; } }
  @media(max-width:400px){ .adb-grid{ grid-template-columns:1fr; } }
  @media(max-width:860px){ .adb-grid-cal{ grid-template-columns:1fr; } }
  .adb-card { background:#fff; border:1px solid #e2e8f0; border-radius:12px; box-shadow:0 1px 4px rgba(0,0,0,.05); overflow:hidden; }
  .adb-card-soft { background:#fff; }
  .adb-head { display:flex; justify-content:space-between; align-items:center; gap:10px;
    padding:16px 20px; border-left:3px solid #f97316; border-bottom:1px solid #eef1f5; }
  .adb-title { margin:0; font-size:15px; font-weight:800; color:#1e293b; }
  .adb-btn { display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:600; color:#475569;
    background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:7px 13px; cursor:pointer; white-space:nowrap; }
  .adb-btn:hover { background:#f8fafc; }
  .adb-btn-solid { background:#f97316; color:#fff; border-color:#f97316; }
  .adb-btn-solid:hover { background:#ea580c; }
  .adb-btn-outline { background:#fff; color:#f97316; border-color:#f97316; }
  .adb-btn-outline:hover { background:#fff7ed; }
  .adb-row:hover { filter:brightness(0.98); }
  .adb-link { color:#f97316; font-size:12px; font-weight:700; text-decoration:none; cursor:pointer; background:none; border:none; }
`;

const Empty = ({ msg }) => (
  <div style={{ padding: '24px 16px', textAlign: 'center' }}>
    <div style={{ fontSize: 24, marginBottom: 4, opacity: .35 }}>📭</div>
    <p style={{ margin: 0, color: '#94a3b8', fontSize: 12.5 }}>{msg}</p>
  </div>
);

const fmtShortDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
const fmtTime = (d) => d ? new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
const fmtRelative = (d) => {
  if (!d) return '';
  const mins = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return fmtShortDate(d);
};

// Compact icon-circle stat card — the Male/Female/Other breakdown sits right
// next to the big number (not a separate row) to keep the card's height down.
const StatCardV2 = ({ label, value, icon, iconBg, delta, deltaGood, deltaLabel, male, female, other }) => {
  const hasDelta  = delta !== undefined && delta !== null && !Number.isNaN(delta);
  const isUp      = delta > 0;
  const isGood    = hasDelta ? (delta === 0 ? null : (isUp === deltaGood)) : null;
  const hasGender = male !== undefined;
  return (
    <div className="adb-card adb-card-soft" style={{ padding: '12px 14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>{label}</span>
        <div style={{ width: 32, height: 32, borderRadius: '50%', background: iconBg,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#fff', flexShrink: 0 }}>
          {icon}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 23, fontWeight: 800, color: '#1e293b', lineHeight: 1 }}>{value ?? 0}</span>
        {hasGender && (
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 9.5, fontWeight: 700, color: '#2563eb', background: '#eff6ff',
              padding: '1px 6px', borderRadius: 20, border: '1px solid #dbeafe' }}>M {male}</span>
            <span style={{ fontSize: 9.5, fontWeight: 700, color: '#db2777', background: '#fdf2f8',
              padding: '1px 6px', borderRadius: 20, border: '1px solid #fce7f3' }}>F {female}</span>
            {other > 0 && (
              <span style={{ fontSize: 9.5, fontWeight: 700, color: '#7c3aed', background: '#f5f3ff',
                padding: '1px 6px', borderRadius: 20, border: '1px solid #ddd6fe' }}>O {other}</span>
            )}
          </div>
        )}
      </div>
      {hasDelta && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10.5, fontWeight: 700,
            padding: '2px 7px', borderRadius: 20,
            background: isGood === false ? '#fee2e2' : isGood === true ? '#dcfce7' : '#f1f5f9',
            color: isGood === false ? '#991b1b' : isGood === true ? '#166534' : '#64748b' }}>
            {delta === 0 ? '—' : isUp ? '↑' : '↓'} {Math.abs(delta)}%
          </span>
          {deltaLabel && <span style={{ fontSize: 10.5, color: '#94a3b8' }}>{deltaLabel}</span>}
        </div>
      )}
    </div>
  );
};

export default function Dashboard() {
  const { currentUser, isAdmin, isBranchManager, isDeptHead, isEmployee, canApprove } = useAuth();
  const {
    leaves, officeVisits, getEmployeeById, getEmployeeName, filteredEmployees: employees,
    approveLeave, rejectLeave, approveVisit, rejectVisit,
  } = useData();
  const { settings, getCompanyName } = useSettings();
  const navigate = useNavigate();

  // Same UI/design for every role for now (SuperAdmin/Admin/Branch Manager/Department
  // Head/Employee) — per-role differences to be refined later. Branch Manager/Dept
  // Head get their team's data via the same orgScope=1 pattern already used elsewhere
  // this session; a plain Employee is already self-scoped automatically server-side
  // (resolveEmployeeScope), no extra param needed.
  const isTeamScoped = isBranchManager || isDeptHead;

  const today = getNepalTodayISO();
  const yesterday = useMemo(() => {
    const d = new Date(today + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, [today]);

  // "This month" for every monthly stat on this dashboard (My Monthly
  // Attendance Overview, My Leave/Office Visit/Late-Early lists, Top
  // Performers) — the current BS month when the company's default calendar
  // is Nepali, else the current AD month. A BS month doesn't line up with a
  // single AD year/month (it spans parts of two), so this always resolves
  // to an explicit AD startDate/endDate rather than a year/month pair.
  const currentMonthRange = useMemo(() => {
    const now = getNepalNow();
    const pad = (n) => String(n).padStart(2, '0');
    if (settings?.defaultCalendar === 'np') {
      const bs = adToBS(now);
      if (bs) {
        const lastDay = getBSDays(bs.year, bs.month) || 30;
        const firstAd = bsToAD(bs.year, bs.month, 1);
        const lastAd  = bsToAD(bs.year, bs.month, lastDay);
        if (firstAd && lastAd) {
          const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
          return { startDate: toISO(firstAd), endDate: toISO(lastAd) };
        }
      }
    }
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return {
      startDate: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`,
      endDate:   `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(lastDay)}`,
    };
  }, [settings?.defaultCalendar]);

  const [todayAttn, setTodayAttn] = useState([]);
  const [yesterdayAttn, setYesterdayAttn] = useState([]);
  const [monthly, setMonthly] = useState(null);
  const [missingRequests, setMissingRequests] = useState([]);
  const [manualPostings, setManualPostings] = useState([]);
  const [messages, setMessages] = useState([]);
  const [approvalTab, setApprovalTab] = useState('leave'); // 'leave' | 'visit' | 'lateEarly'
  const [licenseInfo, setLicenseInfo] = useState(null);
  const [myLedger, setMyLedger] = useState(null);

  // Employee-role dashboard is personal (My Monthly Calendar / Leave / Office
  // Visit / Late-Early Alerts / My Monthly Attendance Overview) rather than
  // company-wide — one staff-ledger call covers all of it. Admin/Branch
  // Manager/Dept Head never fire this request.
  useEffect(() => {
    if (!isEmployee || !currentUser?.id) return;
    // Full month, not just up to today — the calendar shows future duty
    // roster assignments too, not just past attendance.
    const { startDate, endDate } = currentMonthRange;
    api.get(`/attendance/staff-ledger?employeeId=${currentUser.id}&startDate=${startDate}&endDate=${endDate}`)
      .then(setMyLedger).catch(() => setMyLedger(null));
  }, [isEmployee, currentUser?.id, currentMonthRange]);

  useEffect(() => {
    if (!currentUser) return;
    api.get(`/attendance/daily?date=${today}${isTeamScoped ? '&orgScope=1' : ''}`).then(d => setTodayAttn(d.rows || [])).catch(() => setTodayAttn([]));
  }, [currentUser, isTeamScoped, today]);

  useEffect(() => {
    if (!currentUser) return;
    api.get(`/attendance/daily?date=${yesterday}${isTeamScoped ? '&orgScope=1' : ''}`).then(d => setYesterdayAttn(d.rows || [])).catch(() => setYesterdayAttn([]));
  }, [currentUser, isTeamScoped, yesterday]);

  useEffect(() => {
    if (!currentUser) return;
    const { startDate, endDate } = currentMonthRange;
    api.get(`/attendance/monthly?startDate=${startDate}&endDate=${endDate}${isTeamScoped ? '&orgScope=1' : ''}`).then(setMonthly).catch(() => setMonthly(null));
  }, [currentUser, isTeamScoped, currentMonthRange]);

  useEffect(() => {
    if (!currentUser) return;
    api.get(`/attendance/missing-requests${isTeamScoped ? '?orgScope=1' : ''}`).then(rows => setMissingRequests(Array.isArray(rows) ? rows : [])).catch(() => setMissingRequests([]));
  }, [currentUser, isTeamScoped]);

  // Staff self-service "Inform Late In/Early Out" requests — same pending →
  // approved/rejected workflow as Leave/Office Visit, surfaced in the same
  // Pending Approvals card below.
  useEffect(() => {
    if (!currentUser) return;
    api.get('/attendance/manual-postings').then(rows => setManualPostings(Array.isArray(rows) ? rows : [])).catch(() => setManualPostings([]));
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    api.get('/messages').then(rows => setMessages(Array.isArray(rows) ? rows : [])).catch(() => setMessages([]));
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    api.get('/license/status').then(setLicenseInfo).catch(() => setLicenseInfo(null));
  }, [currentUser]);

  const presentR = todayAttn.filter(r => r.status === 'Present');
  const absentR  = todayAttn.filter(r => r.status === 'Absent');
  const lateR    = todayAttn.filter(r => r.lateIn && r.lateIn.startsWith('Late By'));
  const total    = employees.filter(e => e.active).length || 1;
  const pct      = Math.round((presentR.length / total) * 100);

  // Male/Female/Other breakdown for Total Employees / Present / Absent / Late Arrivals.
  const gMap = {};
  employees.forEach(e => { gMap[e.id] = e.gender; });
  const mf = (rows) => ({
    male:   rows.filter(r => gMap[r.id] === 'male').length,
    female: rows.filter(r => gMap[r.id] === 'female').length,
    other:  rows.filter(r => gMap[r.id] && gMap[r.id] !== 'male' && gMap[r.id] !== 'female').length,
  });
  const totalG   = mf(employees.filter(e => e.active));
  const presentG = mf(presentR);
  const absentG  = mf(absentR);
  const lateG    = mf(lateR);

  // Company name + today's date (English and Nepali/BS), shown atop Overview Statistics.
  const companyName = getCompanyName ? getCompanyName('en') : (settings.companyNameEn || 'eHajiri TMS');
  const nowForHeader = getNepalNow();
  const dateLabelEn = nowForHeader.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const bsForHeader = adToBS(nowForHeader);
  const dateLabelNp = bsForHeader ? `${bsForHeader.day} ${BS_MONTHS_NP[bsForHeader.month - 1]} ${bsForHeader.year}` : '';

  // "My Late Arrivals & Early Out Alerts" dates — BS with Nepali digits when
  // the company's default calendar is set to Nepali, else plain AD ISO.
  const useNPCalendar = settings?.defaultCalendar === 'np';
  const fmtAlertDate = (dateStr) => {
    if (!useNPCalendar) return dateStr;
    const bs = adToBS(dateStr);
    if (!bs) return dateStr;
    const dig = n => settings?.nepaliDigits ? toNepaliDigits(n) : String(n);
    return `${dig(bs.day)} ${BS_MONTHS_NP[bs.month - 1]} ${dig(bs.year)}`;
  };

  // Subscription summary shown top-right of the Overview Statistics card.
  const fmtLicDate = (iso) => iso
    ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—';
  const licDaysLeft = licenseInfo?.expires
    ? Math.max(0, Math.ceil((new Date(licenseInfo.expires) - new Date()) / 86400000))
    : null;

  const yPresent = yesterdayAttn.filter(r => r.status === 'Present').length;
  const yAbsent  = yesterdayAttn.filter(r => r.status === 'Absent').length;
  const yLate    = yesterdayAttn.filter(r => r.lateIn && r.lateIn.startsWith('Late By')).length;
  const yTotal   = yesterdayAttn.length || 1;
  const yPct     = Math.round((yPresent / yTotal) * 100);
  const pctChange = (t, y) => (y === 0 ? (t === 0 ? 0 : 100) : Math.round(((t - y) / y) * 100));

  const pendingMissingTotal = missingRequests.filter(r => r.status === 'pending').length;

  // On Leave / On Office Visit today — todayAttn already carries these as
  // per-employee flags (joined server-side against leaves/office_visits for
  // the requested date), so no extra fetch is needed here.
  const onLeaveToday = todayAttn.filter(r => r.hasLeave);
  const onVisitToday = todayAttn.filter(r => r.hasVisit);

  const monthlyAllStats = monthly?.allStats || [];

  // Late Arrivals & Alerts — parsed "Late By HH:MM" (2-digit hours) into a 1-5 severity level.
  // Top 5 shown, "View More" links to the full daily report for everyone else.
  const lateArrivalsAll = todayAttn
    .filter(r => r.lateIn && r.lateIn.startsWith('Late By'))
    .map(r => {
      const m = /^Late By (\d+):(\d+)$/.exec(r.lateIn);
      const minsLate = m ? (parseInt(m[1], 10) * 60 + parseInt(m[2], 10)) : 0;
      const level = minsLate <= 0 ? 0 : minsLate < 15 ? 1 : minsLate < 30 ? 2 : minsLate < 45 ? 3 : minsLate < 60 ? 4 : 5;
      return { ...r, minsLate, level };
    })
    .sort((a, b) => b.minsLate - a.minsLate);
  const lateArrivalsList = lateArrivalsAll.slice(0, 5);

  // Early departures — parsed "Early Out HH:MM" the same way as lateIn, for the
  // "Late In & Early Out" tab. No approval workflow exists for lateness/early-out
  // in this app (unlike Leave/Office Visit, which are real request types) — this
  // tab is informational only.
  const earlyOutAll = todayAttn
    .filter(r => r.earlyOut && r.earlyOut.startsWith('Early Out'))
    .map(r => {
      const m = /^Early Out (\d+):(\d+)$/.exec(r.earlyOut);
      const minsEarly = m ? (parseInt(m[1], 10) * 60 + parseInt(m[2], 10)) : 0;
      return { ...r, minsEarly };
    })
    .sort((a, b) => b.minsEarly - a.minsEarly);

  // Attendance Overview — 4 mutually-exclusive buckets matching the reference exactly
  // (Present/Late/Permission/Absent — Office Visit and Leave both fold into "Permission").
  const attendanceOverview = useMemo(() => {
    const buckets = { Present: 0, Late: 0, Permission: 0, Absent: 0 };
    todayAttn.forEach(r => {
      if (r.hasLeave || r.hasVisit) buckets.Permission++;
      else if (r.status === 'Present' && r.lateIn && r.lateIn.startsWith('Late By')) buckets.Late++;
      else if (r.status === 'Present') buckets.Present++;
      else if (r.status === 'Absent') buckets.Absent++;
    });
    return [
      { label: 'Present',    value: buckets.Present,    color: '#22c55e' },
      { label: 'Late',       value: buckets.Late,       color: '#0f3d57' },
      { label: 'Permission', value: buckets.Permission, color: '#f59e0b' },
      { label: 'Absent',     value: buckets.Absent,     color: '#ef4444' },
    ];
  }, [todayAttn]);

  // Employee Status — grouped by the company's own configured employment `mode`
  // (Permanent/Temporary/Contract etc., whatever actually exists — not hardcoded
  // to demo-only categories like "Probation"/"WFH" which this app doesn't track).
  const MODE_COLORS = ['#f97316', '#0f3d57', '#ef4444', '#ec4899', '#8b5cf6', '#0ea5e9'];
  const activeEmployees = employees.filter(e => e.active);
  const modeBreakdown = useMemo(() => {
    const groups = {};
    activeEmployees.forEach(e => {
      const key = e.mode || 'Unspecified';
      groups[key] = (groups[key] || 0) + 1;
    });
    return Object.entries(groups).map(([label, value], i) => ({
      label, value, pct: Math.round((value / (activeEmployees.length || 1)) * 100), color: MODE_COLORS[i % MODE_COLORS.length],
    }));
  }, [activeEmployees]);

  // Top Performers — highest attendance rate this month (real ranking, from /attendance/monthly).
  const topPerformers = [...monthlyAllStats].filter(s => s.presentDays > 0)
    .sort((a, b) => (b.attendanceRate || 0) - (a.attendanceRate || 0)).slice(0, 2);

  // Employee dashboard's "Top 3 Performers This Month" — a composite score
  // (not just attendanceRate like topPerformers above), rewarding actual
  // effort/discipline: attendance rate as the base, penalized for Late In,
  // Early Out, Absent, and Missing Attendance (checked in but never checked
  // out), with a capped bonus for approved OT and for hours genuinely
  // worked beyond the day's own scheduled shift. Capped at 10 bonus hours
  // each so OT/extra hours alone can't outrank someone who's simply present
  // and on time every day.
  const performanceScore = (s) => {
    const otHrs    = (s.otMinutes || 0) / 60;
    const extraHrs = (s.extraShiftMinutes || 0) / 60;
    return (s.attendanceRate || 0)
      - (s.lateCount || 0) * 2
      - (s.earlyCount || 0) * 2
      - (s.absentDays || 0) * 5
      - (s.missingAttendanceDays || 0) * 3
      + Math.min(otHrs, 10)
      + Math.min(extraHrs, 10);
  };
  // Scoped to the logged-in employee's own branch (their real peer group) —
  // falls back to the company-wide pool only when they have no branch set.
  const myBranchStats = (currentUser?.branch && currentUser.branch !== '—')
    ? monthlyAllStats.filter(s => s.branch === currentUser.branch)
    : monthlyAllStats;
  const employeeTopPerformers = [...myBranchStats].filter(s => s.presentDays > 0)
    .sort((a, b) => performanceScore(b) - performanceScore(a)).slice(0, 3);

  // Employee dashboard's "My Monthly Attendance Overview" — same bucket/color
  // convention as the company attendanceOverview donut, fed from this
  // employee's own staff-ledger days instead of today's company-wide rows.
  // The ledger fetch now spans the whole month (so the calendar can show
  // future duty roster too), so this tallies only dates up to today itself
  // rather than trusting the server's summary — otherwise every future day
  // with no attendance yet would inflate the Absent count.
  // `arc` is the mutually-exclusive breakdown (sums to total past days) that
  // drives the donut geometry itself. `extra` — Late In / Early Out / Miss
  // Punch — are attributes OF a Present day, not separate days, so they can't
  // be arc slices without double-counting; shown as a supplementary list
  // instead. Weekend and Public Holiday days are excluded from Absent (the
  // old version miscounted both, plus Office Visit, as Absent).
  const myAttendanceOverview = useMemo(() => {
    const pastDays = (myLedger?.days || []).filter(d => d.dateStr <= today);
    if (!pastDays.length) return { arc: [], extra: [] };
    let present = 0, absent = 0, leave = 0, visit = 0;
    let lateIn = 0, earlyOut = 0, missPunch = 0;
    pastDays.forEach(d => {
      if (d.leave) { leave++; return; }
      if (d.status === 'Weekend' || d.isPublicHoliday) return;
      if (d.status === 'Present') {
        present++;
        if (d.lateMins > 0) lateIn++;
        if (d.earlyMins > 0) earlyOut++;
        if (d.timeIn && !d.timeOut) missPunch++;
        return;
      }
      if (d.hasVisit) { visit++; return; }
      absent++;
    });
    return {
      arc: [
        { label: 'Present',      value: present, color: '#22c55e' },
        { label: 'Leave',        value: leave,   color: '#f59e0b' },
        { label: 'Office Visit', value: visit,   color: '#1d4ed8' },
        { label: 'Absent',       value: absent,  color: '#ef4444' },
      ],
      extra: [
        { label: 'Late In',    value: lateIn,    color: '#b45309' },
        { label: 'Early Out',  value: earlyOut,  color: '#0f3d57' },
        { label: 'Miss Punch', value: missPunch, color: '#c2410c' },
      ],
    };
  }, [myLedger, today]);

  // Clock-In/Out — everyone who punched in today, most recent first.
  const clockedIn = presentR
    .slice()
    .sort((a, b) => new Date(b.timeIn) - new Date(a.timeIn))
    .slice(0, 6);

  // Pending Approvals — company-wide pending leave + office visit + late-in/early-out requests.
  const pendingApprovals = useMemo(() => {
    const days = (v) => Math.max(1, Math.round((new Date(v.toDate) - new Date(v.fromDate)) / 86400000) + 1);
    const l = leaves.filter(x => x.status === 'pending')
      .map(x => ({ kind: 'leave', id: x.id, employeeId: x.employeeId, fromDate: x.fromDate, toDate: x.toDate,
        days: x.days, reason: x.reason, appliedDate: x.appliedDate }));
    const v = officeVisits.filter(x => x.status === 'pending')
      .map(x => ({ kind: 'visit', id: x.id, employeeId: x.employeeId, fromDate: x.fromDate, toDate: x.toDate,
        days: days(x), reason: x.purpose, appliedDate: x.appliedDate }));
    const m = manualPostings.filter(x => x.status === 'pending')
      .map(x => ({ kind: 'lateEarly', id: x.id, employeeId: x.employeeId, fromDate: x.date, toDate: x.date, days: 1,
        reason: [x.check_in && `In: ${x.check_in.slice(0,5)}`, x.check_out && `Out: ${x.check_out.slice(0,5)}`, x.remark]
          .filter(Boolean).join(' | '),
        appliedDate: x.appliedDate || x.created_at }));
    return [...l, ...v, ...m].sort((a, b) => new Date(b.appliedDate) - new Date(a.appliedDate));
  }, [leaves, officeVisits, manualPostings]);

  const refreshManualPostings = () =>
    api.get('/attendance/manual-postings').then(rows => setManualPostings(Array.isArray(rows) ? rows : [])).catch(() => {});

  const handleApprove = (item) => {
    if (item.kind === 'lateEarly') {
      return api.patch(`/attendance/manual-postings/${item.id}/approve`, { approvedBy: currentUser?.id }).then(refreshManualPostings);
    }
    return (item.kind === 'leave' ? approveLeave : approveVisit)(item.id, currentUser?.id);
  };
  const handleDecline = (item) => {
    if (item.kind === 'lateEarly') {
      return api.patch(`/attendance/manual-postings/${item.id}/reject`, { approvedBy: currentUser?.id, comment: 'Declined from dashboard' }).then(refreshManualPostings);
    }
    return (item.kind === 'leave' ? rejectLeave : rejectVisit)(item.id, currentUser?.id, 'Declined from dashboard');
  };

  // Pending Approvals card visibility — Super Admin/Admin always see it; everyone
  // else only if they've actually been assigned as someone's Recommended By /
  // Approved By (per-employee assignments saved by RecoApprovalModal), not just
  // by having a role that generically permits approving.
  const canSeePendingApprovals = useMemo(() => {
    if (isAdmin) return true;
    const uid = Number(currentUser?.id);
    if (!uid) return false;
    try {
      const all = JSON.parse(localStorage.getItem('ehajiri_reco_approval') || '{}');
      return Object.entries(all).some(([key, cfg]) => {
        if (key === '_settings') return false;
        const reco     = Array.isArray(cfg?.reco)     ? cfg.reco     : (cfg?.reco     != null ? [cfg.reco]     : []);
        const approval = Array.isArray(cfg?.approval) ? cfg.approval : (cfg?.approval != null ? [cfg.approval] : []);
        return reco.map(Number).includes(uid) || approval.map(Number).includes(uid);
      });
    } catch { return false; }
  }, [isAdmin, currentUser]);

  // Upcoming Public Holidays — next 5, from company settings.
  const upHolidays = (settings.publicHolidays || [])
    .filter(h => h.startDate && h.startDate >= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .slice(0, 5);

  // Shared card content — rendered in a different spot depending on role:
  // its own row alongside Employee Status/Attendance Overview/Clock-In-Out
  // for admin/manager, or beside "Notice / Message to Me" for an employee
  // (whose version of that row otherwise only has one other card in it).
  const renderUpcomingHolidayCard = (extraStyle) => (
    <div className="adb-card" style={extraStyle}>
      <div className="adb-head">
        <p className="adb-title">Upcoming Public Holiday</p>
        <button className="adb-btn" onClick={() => navigate('/settings')}>View All</button>
      </div>
      <div style={{ padding: '14px 16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {upHolidays.length === 0 ? <Empty msg="No upcoming holidays" /> : upHolidays.map((h, i) => {
          const d = new Date(h.startDate);
          const bs = adToBS(h.startDate);
          const bsLabel = bs ? `${bs.day} ${BS_MONTHS_NP[bs.month - 1]} ${bs.year} B.S.` : '';
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 12px', borderRadius: 10, border: '1px solid #e2e8f0' }}>
              <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8,
                padding: '5px 10px', textAlign: 'center', minWidth: 50, flexShrink: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#92400e', lineHeight: 1.1 }}>{d.getDate()}</div>
                <div style={{ fontSize: 9.5, fontWeight: 700, color: '#b45309', textTransform: 'uppercase' }}>
                  {d.toLocaleDateString('en-US', { month: 'short' })}
                </div>
              </div>
              <div style={{ minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#1e293b' }}>{h.name}</p>
                {bsLabel && <p style={{ margin: '1px 0 0', fontSize: 11, color: '#94a3b8' }}>{bsLabel}</p>}
                {h.endDate && h.endDate !== h.startDate && (
                  <p style={{ margin: '1px 0 0', fontSize: 11, color: '#94a3b8' }}>Until {fmtShortDate(h.endDate)}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  // Birthdays — grouped Today / Tomorrow / dated, next 30 days.
  const now = getNepalNow();
  const upBirthdays = employees.filter(e => e.active && e.dob).map(e => {
    const dob  = new Date(e.dob);
    const next = new Date(now.getFullYear(), dob.getMonth(), dob.getDate());
    if (next < now) next.setFullYear(now.getFullYear() + 1);
    return { ...e, daysUntil: Math.round((next - now) / 86400000) };
  }).filter(e => e.daysUntil <= 30).sort((a, b) => a.daysUntil - b.daysUntil).slice(0, 8);
  const birthdayGroups = useMemo(() => {
    const groups = {};
    upBirthdays.forEach(e => {
      const key = e.daysUntil === 0 ? 'Today' : e.daysUntil === 1 ? 'Tomorrow'
        : new Date(now.getFullYear(), now.getMonth(), now.getDate() + e.daysUntil)
            .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      (groups[key] = groups[key] || []).push(e);
    });
    return Object.entries(groups);
  }, [upBirthdays]);

  if (!currentUser) return null;

  return (
    <div className="adb-p">
      <style>{STYLES}</style>

      {/* Overview Statistics */}
      <div className="adb-card" style={{ padding: '16px 18px 4px', marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          paddingBottom: 12, marginBottom: 14, borderBottom: '1px solid #eef1f5', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <p style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 800, color: '#000000' }}>
              🏢 {companyName}
            </p>
            <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
              <p className="adb-title">
                {isBranchManager && currentUser?.branch ? `🏢 ${currentUser.branch}` : 'Overview Statistics'}
              </p>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#000000' }}>
                📅 {dateLabelEn}{dateLabelNp && <> &nbsp;|&nbsp; {dateLabelNp}</>}
              </span>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#000000' }}>Dashboard</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {licenseInfo?.expires && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8,
                padding: '6px 14px', fontSize: 11.5 }}>
                <span style={{ color: '#374151' }}>
                  Activated : <strong style={{ color: '#111827' }}>{fmtLicDate(licenseInfo.issuedAt)}</strong>
                </span>
                <span style={{ color: '#bfdbfe' }}>|</span>
                <span style={{ color: '#374151' }}>
                  Expired : <strong style={{ color: '#111827' }}>{fmtLicDate(licenseInfo.expires)}</strong>
                </span>
                <span style={{ color: '#bfdbfe' }}>|</span>
                <span style={{ color: '#374151' }}>
                  Remaining Days :{' '}
                  <strong style={{ color: licDaysLeft > 30 ? '#059669' : licDaysLeft > 7 ? '#d97706' : '#dc2626' }}>
                    {licDaysLeft}
                  </strong>
                </span>
              </div>
            )}
            <button className="adb-btn">📅 Today</button>
          </div>
        </div>
        {!isEmployee && (
          <div className="adb-grid6" style={{ marginBottom: 4 }}>
            <StatCardV2 label="Total Employees" value={total} icon="👥" iconBg="#f97316"
              male={totalG.male} female={totalG.female} other={totalG.other} />
            <StatCardV2 label="Present Today" value={presentR.length} icon="✅" iconBg="#0f3d57"
              delta={pctChange(presentR.length, yPresent)} deltaGood={true} deltaLabel="vs yesterday"
              male={presentG.male} female={presentG.female} other={presentG.other} />
            <StatCardV2 label="Absent Today" value={absentR.length} icon="❌" iconBg="#f59e0b"
              delta={pctChange(absentR.length, yAbsent)} deltaGood={false} deltaLabel="vs yesterday"
              male={absentG.male} female={absentG.female} other={absentG.other} />
            <StatCardV2 label="On Leave" value={onLeaveToday.length} icon="🌴" iconBg="#8b5cf6" />
            <StatCardV2 label="On Office Visit" value={onVisitToday.length} icon="🚗" iconBg="#0d9488" />
            <StatCardV2 label="Late Arrivals" value={lateR.length} icon="⏰" iconBg="#3b82f6"
              delta={pctChange(lateR.length, yLate)} deltaGood={false} deltaLabel="vs yesterday"
              male={lateG.male} female={lateG.female} other={lateG.other} />
            {!isAdmin && (
              <>
                <StatCardV2 label="Attendance Rate" value={`${pct}%`} icon="📊" iconBg="#8b5cf6"
                  delta={pctChange(pct, yPct)} deltaGood={true} deltaLabel="vs yesterday" />
                <StatCardV2 label="Pending Regularizations" value={pendingMissingTotal} icon="📝" iconBg="#ef4444" />
              </>
            )}
          </div>
        )}
      </div>

      {/* Late Arrivals & Alerts / On Leave / On Office Visit — company-wide, not for Employee role */}
      {!isEmployee && (
      <div style={{ display: 'flex', gap: 16, alignItems: 'stretch', flexWrap: 'wrap', marginBottom: 16 }}>
        <div className="adb-card" style={{ padding: '16px 18px', flex: '1.4 1 360px', minWidth: 360 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            paddingBottom: 10, marginBottom: 12, borderBottom: '1px solid #eef1f5' }}>
            <p className="adb-title">Late Arrivals & Alerts</p>
            <button className="adb-btn">📅 Today</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {lateArrivalsList.length === 0 ? <Empty msg="No late arrivals today" /> : lateArrivalsList.map(r => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 12, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 16px',
                boxShadow: '0 1px 2px rgba(0,0,0,.04)', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  <Av name={r.fullName} photo={getEmployeeById(r.id)?.profilePhoto} size={36} />
                  <div style={{ minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#1e293b' }}>{r.fullName}</p>
                    <p style={{ margin: '1px 0 0', fontSize: 11, color: '#94a3b8' }}>{r.postFull || r.postShort || '—'}</p>
                  </div>
                </div>
                <span style={{ fontSize: 12, color: '#64748b' }}>Check-in: <strong style={{ color: '#1e293b' }}>{fmtTime(r.timeIn)}</strong></span>
                <SeverityBars level={r.level} color="#f97316" />
              </div>
            ))}
          </div>
          {lateArrivalsAll.length > 5 && (
            <div style={{ marginTop: 12 }}>
              <button className="adb-btn" style={{ width: '100%', justifyContent: 'center' }}
                onClick={() => navigate('/attendance/reports/daily')}>
                View More ({lateArrivalsAll.length - 5} more)
              </button>
            </div>
          )}
        </div>

        <div className="adb-card" style={{ padding: '16px 18px', flex: '1 1 280px', minWidth: 280 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            paddingBottom: 10, marginBottom: 12, borderBottom: '1px solid #eef1f5' }}>
            <p className="adb-title">On Leave</p>
            <button className="adb-btn" onClick={() => navigate('/leave/approval')}>📅 Today</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 320, overflowY: 'auto', paddingRight: 4 }}>
            {onLeaveToday.length === 0 ? <Empty msg="No one on leave today" /> : onLeaveToday.map(r => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 10, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px',
                boxShadow: '0 1px 2px rgba(0,0,0,.04)', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <Av name={r.fullName} photo={getEmployeeById(r.id)?.profilePhoto} size={30} />
                  <div style={{ minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: '#1e293b' }}>{r.fullName}</p>
                    <p style={{ margin: '1px 0 0', fontSize: 10.5, color: '#94a3b8' }}>{r.postFull || r.postShort || '—'}</p>
                  </div>
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, color: '#5b21b6', background: '#f5f3ff',
                  border: '1px solid #ddd6fe', borderRadius: 20, padding: '2px 8px', flexShrink: 0 }}>
                  {r.leaveTypeName || 'On Leave'}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="adb-card" style={{ padding: '16px 18px', flex: '1 1 280px', minWidth: 280 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            paddingBottom: 10, marginBottom: 12, borderBottom: '1px solid #eef1f5' }}>
            <p className="adb-title">On Office Visit</p>
            <button className="adb-btn" onClick={() => navigate('/office-visit/approval')}>📅 Today</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 320, overflowY: 'auto', paddingRight: 4 }}>
            {onVisitToday.length === 0 ? <Empty msg="No one on office visit today" /> : onVisitToday.map(r => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 10, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px',
                boxShadow: '0 1px 2px rgba(0,0,0,.04)', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <Av name={r.fullName} photo={getEmployeeById(r.id)?.profilePhoto} size={30} />
                  <div style={{ minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: '#1e293b' }}>{r.fullName}</p>
                    <p style={{ margin: '1px 0 0', fontSize: 10.5, color: '#94a3b8' }}>{r.postFull || r.postShort || '—'}</p>
                  </div>
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, color: '#0369a1', background: '#e0f2fe',
                  border: '1px solid #bae6fd', borderRadius: 20, padding: '2px 8px', flexShrink: 0 }}>On Office Visit</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      )}

      {/* My Monthly Calendar / My Leave / My Office Visit / My Late-Early Alerts — Employee role only */}
      {isEmployee && (
        <>
          <div className="adb-grid-cal">
            <MyMonthlyCalendar employeeId={currentUser.id}
              onViewFull={() => navigate('/attendance/roster-report')} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="adb-card" style={{ flex: 1, padding: '16px 18px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  paddingBottom: 10, marginBottom: 4, borderBottom: '1px solid #eef1f5' }}>
                  <p className="adb-title">My Monthly Attendance Overview</p>
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '8px 4px', minHeight: 0 }}>
                  <HalfDonut segments={myAttendanceOverview.arc} size={160} thickness={20}
                    centerLabel={myAttendanceOverview.arc.find(s => s.label === 'Present')?.value || 0}
                    centerSub="Present This Month" />
                  <div style={{ width: '100%', marginTop: 10 }}>
                    <ChartLegend segments={myAttendanceOverview.arc} />
                  </div>
                  {myAttendanceOverview.extra.some(s => s.value > 0) && (
                    <div style={{ width: '100%', marginTop: 10, paddingTop: 10, borderTop: '1px solid #f1f5f9' }}>
                      <ChartLegend segments={myAttendanceOverview.extra} />
                    </div>
                  )}
                </div>
              </div>

              <div className="adb-card" style={{ flex: 1, padding: '16px 18px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  paddingBottom: 10, marginBottom: 8, borderBottom: '1px solid #eef1f5' }}>
                  <p className="adb-title">Top 3 Performers This Month</p>
                  <button className="adb-link" onClick={() => navigate('/attendance/reports/monthly')}>View More</button>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                  {employeeTopPerformers.length === 0 ? <Empty msg="No attendance data yet this month" /> : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {employeeTopPerformers.map(tp => (
                        <div key={tp.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                          background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, padding: '9px 12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 15 }}>🏅</span>
                            <Av name={tp.fullName} photo={getEmployeeById(tp.id)?.profilePhoto} size={30} />
                            <div>
                              <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: '#1e293b' }}>{tp.fullName}</p>
                              <p style={{ margin: 0, fontSize: 10.5, color: '#94a3b8' }}>{tp.position || '—'}</p>
                            </div>
                          </div>
                          <span style={{ fontSize: 13, fontWeight: 800, color: '#ea580c' }}>{tp.attendanceRate}%</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div className="adb-grid3">
            <div className="adb-card" style={{ padding: '16px 18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                paddingBottom: 10, marginBottom: 12, borderBottom: '1px solid #eef1f5' }}>
                <p className="adb-title">My Leave this Month</p>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(myLedger?.days || []).filter(d => d.leave).length === 0
                  ? <Empty msg="No leave taken this month" />
                  : (myLedger.days.filter(d => d.leave)).map(d => (
                    <div key={d.dateStr} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      gap: 10, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '9px 12px' }}>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: '#1e293b' }}>{d.dateStr}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#b45309' }}>{d.leave}</span>
                    </div>
                  ))}
              </div>
            </div>

            <div className="adb-card" style={{ padding: '16px 18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                paddingBottom: 10, marginBottom: 12, borderBottom: '1px solid #eef1f5' }}>
                <p className="adb-title">My Office Visit this Month</p>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(myLedger?.days || []).filter(d => d.hasVisit).length === 0
                  ? <Empty msg="No office visits this month" />
                  : (myLedger.days.filter(d => d.hasVisit)).map(d => (
                    <div key={d.dateStr} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      gap: 10, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '9px 12px' }}>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: '#1e293b' }}>{d.dateStr}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#1d4ed8', textAlign: 'right' }}>{d.remarks || 'Office Visit'}</span>
                    </div>
                  ))}
              </div>
            </div>

            <div className="adb-card" style={{ padding: '16px 18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                paddingBottom: 10, marginBottom: 12, borderBottom: '1px solid #eef1f5' }}>
                <p className="adb-title">My Late Arrivals & Early Out Alerts</p>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(myLedger?.days || []).filter(d => d.lateMins || d.earlyMins).length === 0
                  ? <Empty msg="No late arrivals or early outs this month" />
                  : (myLedger.days.filter(d => d.lateMins || d.earlyMins)).map(d => (
                    <div key={d.dateStr} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      gap: 10, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '9px 12px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: '#1e293b' }}>{fmtAlertDate(d.dateStr)}</span>
                      <span style={{ display: 'flex', gap: 6 }}>
                        {d.lateMins > 0 && (
                          <span style={{ fontSize: 10, fontWeight: 700, color: '#b45309', background: '#fffbeb',
                            border: '1px solid #fde68a', borderRadius: 20, padding: '2px 8px' }}>{d.lateFormatted}</span>
                        )}
                        {d.earlyMins > 0 && (
                          <span style={{ fontSize: 10, fontWeight: 700, color: '#1d4ed8', background: '#eff6ff',
                            border: '1px solid #bfdbfe', borderRadius: 20, padding: '2px 8px' }}>{d.earlyFormatted}</span>
                        )}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Employee Status / Attendance Overview / Clock-In-Out — empty and
          hidden entirely for isEmployee, whose three cards here all moved
          elsewhere (Attendance Overview + Top 3 Performers next to the
          calendar, Upcoming Public Holiday down into the Notice row). */}
      {!isEmployee && (
      <div className="adb-grid3">
        {!isEmployee && (
        <div className="adb-card" style={{ padding: '16px 18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            paddingBottom: 12, marginBottom: 12, borderBottom: '1px solid #eef1f5' }}>
            <p className="adb-title">Employee Status</p>
            <button className="adb-btn">📅 This Week</button>
          </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: '#64748b' }}>Total Employee</span>
                <span style={{ fontSize: 18, fontWeight: 800, color: '#1e293b' }}>{activeEmployees.length}</span>
              </div>
              {modeBreakdown.length > 0 && (
                <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 14 }}>
                  {modeBreakdown.map(m => <div key={m.label} style={{ width: `${m.pct}%`, background: m.color }} />)}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                {modeBreakdown.slice(0, 4).map(m => (
                  <div key={m.label}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: '#64748b' }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: m.color, flexShrink: 0 }} />
                      {m.label} ({m.pct}%)
                    </span>
                    <p style={{ margin: '3px 0 0', fontSize: 18, fontWeight: 800, color: '#1e293b' }}>{m.value}</p>
                  </div>
                ))}
              </div>
              {topPerformers.length > 0 && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: '#1e293b' }}>Top Performer</p>
                    <button className="adb-link" onClick={() => navigate('/attendance/reports/monthly')}>View More</button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                    {topPerformers.map(tp => (
                      <div key={tp.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                        background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, padding: '9px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 15 }}>🏅</span>
                          <Av name={tp.fullName} photo={getEmployeeById(tp.id)?.profilePhoto} size={30} />
                          <div>
                            <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: '#1e293b' }}>{tp.fullName}</p>
                            <p style={{ margin: 0, fontSize: 10.5, color: '#94a3b8' }}>{tp.position || '—'}</p>
                          </div>
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 800, color: '#ea580c' }}>{tp.attendanceRate}%</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
              <button className="adb-btn" style={{ width: '100%', justifyContent: 'center' }} onClick={() => navigate('/users')}>
                View All Employees
              </button>
        </div>
        )}

        {!isEmployee && (
        <div className="adb-card" style={{ padding: '16px 18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            paddingBottom: 10, marginBottom: 4, borderBottom: '1px solid #eef1f5' }}>
            <p className="adb-title">Attendance Overview</p>
            <button className="adb-btn">📅 Today</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '8px 4px' }}>
            <HalfDonut segments={attendanceOverview} size={200} thickness={26}
              centerLabel={todayAttn.length} centerSub="Total Attendance" />
            <div style={{ width: '100%', marginTop: 14 }}>
              <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 800, color: '#1e293b' }}>Status</p>
              <ChartLegend segments={attendanceOverview} />
            </div>
            {absentR.length > 0 && (
              <div style={{ width: '100%', marginTop: 12, paddingTop: 12, borderTop: '1px solid #f1f5f9',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11.5, color: '#64748b' }}>Total Absenties</span>
                  <AvatarStack size={22} max={4} people={absentR.map(r => ({ id: r.id, name: r.fullName, photo: getEmployeeById(r.id)?.profilePhoto }))} />
                </div>
                <button className="adb-link" onClick={() => navigate('/attendance/reports/daily')}>View Details</button>
              </div>
            )}
          </div>
        </div>
        )}

        {renderUpcomingHolidayCard()}

        {!isAdmin && (
          <div className="adb-card">
            <div className="adb-head" style={{ borderLeft: 'none' }}>
              <p className="adb-title">Clock-In/Out</p>
              <button className="adb-btn">📅 Today</button>
            </div>
            <div style={{ padding: '10px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {clockedIn.length === 0 ? <Empty msg="No punches yet today" /> : clockedIn.map(r => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <Av name={r.fullName} photo={getEmployeeById(r.id)?.profilePhoto} size={32} />
                    <div style={{ minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: '#1e293b', overflow: 'hidden',
                        textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.fullName}</p>
                      <p style={{ margin: 0, fontSize: 10.5, color: '#94a3b8' }}>{r.postFull || r.postShort || '—'}</p>
                    </div>
                  </div>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: '#fff', background: '#22c55e',
                    borderRadius: 20, padding: '3px 10px', flexShrink: 0 }}>● {fmtTime(r.timeIn)}</span>
                </div>
              ))}
            </div>
            <button className="adb-btn" style={{ width: 'calc(100% - 32px)', justifyContent: 'center', margin: '4px 16px 16px' }}
              onClick={() => navigate('/attendance/reports/daily')}>
              View All Attendance
            </button>
          </div>
        )}
      </div>
      )}

      {/* Notice/Message + Pending Approvals + Birthday Alerts — same row, Birthdays kept narrow (~30%) at the end */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'stretch', flexWrap: 'wrap', marginBottom: 16 }}>
        <div className="adb-card" style={{ flex: '1 1 0%', minWidth: 320 }}>
          <div className="adb-head">
            <p className="adb-title">{isEmployee ? 'Notice / Message to Me' : 'Notice / Message'}</p>
          </div>
          <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {messages.length === 0 ? <Empty msg="No notices yet" /> : messages.slice(0, 5).map(m => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12,
                background: m.is_read ? '#fff' : '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 14px' }}>
                <Av name={m.sender_name} photo={m.sender_photo} size={34} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#1e293b' }}>{m.subject || m.sender_name}</p>
                    <span style={{ fontSize: 10.5, color: '#94a3b8', flexShrink: 0 }}>{fmtRelative(m.created_at)}</span>
                  </div>
                  <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis',
                    display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical' }}>
                    {m.body}
                  </p>
                </div>
                {!m.is_read && <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f97316', flexShrink: 0, marginTop: 4 }} />}
              </div>
            ))}
          </div>
          {messages.length > 5 && (
            <div style={{ padding: '0 16px 16px' }}>
              <button className="adb-btn" style={{ width: '100%', justifyContent: 'center' }}
                onClick={() => navigate('/staff/message')}>
                View More ({messages.length - 5} more)
              </button>
            </div>
          )}
        </div>

        {isEmployee && renderUpcomingHolidayCard({ flex: '1 1 0%', minWidth: 320 })}

        {canSeePendingApprovals && (
        <div className="adb-card" style={{ flex: '1 1 0%', minWidth: 320 }}>
          <div className="adb-head">
            <p className="adb-title">Pending Approvals</p>
            <button className="adb-btn" onClick={() => navigate('/leave/approval')}>View All</button>
          </div>
          <div style={{ padding: '14px 16px 0' }}>
            <div style={{ display: 'flex', gap: 4, padding: 4, background: '#f1f5f9', borderRadius: 9 }}>
              {[
                { key: 'leave', label: 'Leave' },
                { key: 'visit', label: 'Office Visit' },
                { key: 'lateEarly', label: 'Late In & Early Out' },
              ].map(t => (
                <button key={t.key} onClick={() => setApprovalTab(t.key)}
                  style={{ flex: 1, padding: '8px 6px', borderRadius: 6, border: 'none', cursor: 'pointer',
                    fontSize: 11.5, fontWeight: 700, fontFamily: 'inherit', whiteSpace: 'nowrap',
                    background: approvalTab === t.key ? '#f97316' : 'transparent',
                    color: approvalTab === t.key ? '#fff' : '#475569' }}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ padding: '12px 16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {(() => {
              const items = pendingApprovals.filter(i => i.kind === approvalTab);
              return items.length === 0 ? <Empty msg="Nothing pending" /> : items.slice(0, 5).map(item => (
                <div key={`${item.kind}-${item.id}`} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 14px',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                      <Av name={getEmployeeName(item.employeeId)} photo={getEmployeeById(item.employeeId)?.profilePhoto} size={26} />
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>{getEmployeeName(item.employeeId)}</span>
                    </div>
                    <p style={{ margin: 0, fontSize: 11.5, color: '#64748b' }}>
                      📅 {fmtShortDate(item.fromDate)}
                      {item.kind !== 'lateEarly' && (
                        <>
                          {' - '}{fmtShortDate(item.toDate)}
                          <span style={{ margin: '0 6px', color: '#cbd5e1' }}>|</span>
                          🕐 {item.days} {item.days === 1 ? 'day' : 'days'}
                        </>
                      )}
                    </p>
                    {item.reason && <p style={{ margin: '3px 0 0', fontSize: 11.5, color: '#94a3b8' }}>{item.kind === 'lateEarly' ? item.reason : `Reason: ${item.reason}`}</p>}
                  </div>
                  {canApprove ? (
                    <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                      <button className="adb-btn adb-btn-solid" onClick={() => handleApprove(item)}>Approve</button>
                      <button className="adb-btn adb-btn-outline" onClick={() => handleDecline(item)}>Decline</button>
                    </div>
                  ) : (
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: '#b45309', background: '#fffbeb',
                      border: '1px solid #fde68a', borderRadius: 20, padding: '3px 10px', flexShrink: 0 }}>Pending</span>
                  )}
                </div>
              ));
            })()}
          </div>
        </div>
        )}

        {!isEmployee && (
        <div className="adb-card" style={{ flex: '0 1 30%', minWidth: 300 }}>
          <div className="adb-head">
            <p className="adb-title">Birthdays</p>
            <button className="adb-btn">View All</button>
          </div>
          <div style={{ padding: '12px 18px 18px' }}>
            {birthdayGroups.length === 0 ? <Empty msg="No birthdays in the next 30 days" /> : birthdayGroups.map(([groupLabel, people]) => (
              <div key={groupLabel}>
                <p style={{ margin: '12px 0 8px', fontSize: 14, fontWeight: 800, color: '#1e293b' }}>{groupLabel}</p>
                {people.map(e => (
                  <div key={e.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                    padding: '12px 14px', borderRadius: 10, marginBottom: 10,
                    background: groupLabel === 'Today' ? '#0f3d57' : '#f1f5f9',
                    border: groupLabel === 'Today' ? '2px dashed rgba(255,255,255,.55)' : 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Av name={e.fullName} photo={e.profilePhoto} size={34} />
                      <div>
                        <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: groupLabel === 'Today' ? '#fff' : '#1e293b' }}>{e.fullName}</p>
                        <p style={{ margin: '1px 0 0', fontSize: 11.5, color: groupLabel === 'Today' ? '#cbd5e1' : '#64748b' }}>{e.position || '—'}</p>
                      </div>
                    </div>
                    <button className="adb-btn" style={groupLabel === 'Today' ? { background: '#fff', color: '#0f3d57', border: '1px solid #fff' } : {}}
                      onClick={() => navigate('/chat')}>🎁 Send</button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
