import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth }         from '../../context/AuthContext.jsx';
import { useModuleFlags }  from '../../context/ModuleFlagsContext.jsx';
import { useLanguage }     from '../../context/LanguageContext.jsx';
import { useData }         from '../../context/DataContext.jsx';
import { useNotifications } from '../Notifications/AttendanceToasts.jsx';
import { useChat } from '../../context/ChatContext.jsx';
import useRecoApproval from '../../hooks/useRecoApproval.js';
import api from '../../api/client.js';
import './TopMenu.css';

// Inline SVG flags — Windows doesn't render emoji flags (🇬🇧 shows as "GB"),
// so the language toggle draws them itself.
const FlagUK = () => (
  <svg viewBox="0 0 60 36" width="18" height="11" style={{ borderRadius: 2, flexShrink: 0 }}>
    <rect fill="#012169" width="60" height="36"/>
    <path d="M0,0 L60,36 M60,0 L0,36" stroke="#fff" strokeWidth="7"/>
    <path d="M0,0 L60,36 M60,0 L0,36" stroke="#C8102E" strokeWidth="3"/>
    <path d="M30,0 V36 M0,18 H60" stroke="#fff" strokeWidth="12"/>
    <path d="M30,0 V36 M0,18 H60" stroke="#C8102E" strokeWidth="7"/>
  </svg>
);
const FlagNepal = () => (
  <svg viewBox="0 0 34 44" width="12" height="15" style={{ flexShrink: 0 }}>
    <path d="M2,2 L28,13 L13,15 L28,40 L2,42 Z" fill="#DC143C" stroke="#003893" strokeWidth="3" strokeLinejoin="round"/>
    <path d="M8,9 a4.2,4.2 0 0 0 8,1.4 a4.2,4.2 0 0 1 -8,-1.4" fill="#fff"/>
    <circle cx="11" cy="28" r="3.4" fill="#fff"/>
  </svg>
);

// Crisp stroke-based menu icons — replaces plain emoji, which render
// inconsistently across OS/browser emoji fonts (blurry, mismatched weight
// and color, sometimes missing glyphs entirely) and look muddy at this
// size. Same approach as the Dashboard's stat-card icons: one consistent
// line weight reads as far more polished across every machine.
const MENU_ICON_PATHS = {
  users:        <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
  fileText:     <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></>,
  checkSquare:  <><polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>,
  truck:        <><rect x="1" y="3" width="15" height="13" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></>,
  grid:         <><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></>,
  phone:        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />,
  userPlus:     <><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" /></>,
  messageSquare:<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  messageCircle:<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />,
  calendar:     <><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></>,
  briefcase:    <><rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></>,
  calculator:   <><rect x="4" y="2" width="16" height="20" rx="2" /><line x1="8" y1="6" x2="16" y2="6" /><line x1="8" y1="10" x2="8.01" y2="10" /><line x1="12" y1="10" x2="12.01" y2="10" /><line x1="16" y1="10" x2="16.01" y2="10" /><line x1="8" y1="14" x2="8.01" y2="14" /><line x1="12" y1="14" x2="12.01" y2="14" /><line x1="16" y1="14" x2="16.01" y2="14" /><line x1="8" y1="18" x2="16" y2="18" /></>,
  barChart:     <><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></>,
  list:         <><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></>,
  activity:     <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />,
  trendingUp:   <><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></>,
  clock:        <><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>,
  mail:         <><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22 6 12 13 2 6" /></>,
  clipboard:    <><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><rect x="8" y="2" width="8" height="4" rx="1" ry="1" /></>,
  edit3:        <><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></>,
  globe:        <><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></>,
  bell:         <><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></>,
  user:         <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
  sliders:      <><line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" /></>,
  key:          <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />,
  shield:       <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
  database:     <><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /></>,
  logOut:       <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></>,
};
// Each icon gets its own fixed color rather than inheriting the (mostly
// uniform gray/blue) surrounding text color — a plain dropdown reads as
// flat and samey; a distinct color per icon makes each item instantly
// scannable at a glance, same idea as the colored icon circles on the
// Dashboard's stat cards.
const MENU_ICON_COLORS = {
  users: '#7c3aed', fileText: '#1a56db', checkSquare: '#059669', truck: '#f97316', grid: '#0891b2',
  phone: '#0e9f6e', userPlus: '#db2777', messageSquare: '#0ea5e9', messageCircle: '#06b6d4',
  calendar: '#1a56db', briefcase: '#d97706', calculator: '#7c3aed', barChart: '#4f46e5',
  list: '#475569', activity: '#e11d48', trendingUp: '#059669', clock: '#ea580c',
  mail: '#d97706', clipboard: '#0d9488', edit3: '#8b5cf6', globe: '#0284c7',
  bell: '#f97316', user: '#1a56db', sliders: '#64748b', key: '#d97706',
  shield: '#059669', database: '#4f46e5', logOut: '#dc2626',
};
const MIcon = ({ name, size = 15, style, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || MENU_ICON_COLORS[name] || 'currentColor'}
    strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
    style={{ flexShrink: 0, ...style }}>
    {MENU_ICON_PATHS[name]}
  </svg>
);

const TopMenu = () => {
  const {
    currentUser, logout,
    isAdmin, isBranchManager, isDeptHead, isEmployee,
    isManager, canManageSystem, canViewReports,
    canView,
  } = useAuth();
  const { flags: moduleFlags } = useModuleFlags();
  const { t, language, changeLanguage } = useLanguage();
  const { stats, filteredLeaves, filteredVisits, filteredEmployees } = useData();
  const { msgCount, taskCount, fieldVisitTaskCount } = useNotifications();
  const { totalUnread: chatUnread } = useChat();
  const { assignments: recoConfig } = useRecoApproval();
  const navigate  = useNavigate();
  const location  = useLocation();

  const [openDropdown,       setOpenDropdown]       = useState(null);
  const [attnReportsOpen,    setAttnReportsOpen]    = useState(false);
  const [halfMonthlyOpen,    setHalfMonthlyOpen]    = useState(false);
  const [mobileOpen,         setMobileOpen]         = useState(false);
  const menuRef    = useRef();
  const ribbonRef  = useRef();

  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpenDropdown(null);
        setAttnReportsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    setOpenDropdown(null);
    setAttnReportsOpen(false);
    setHalfMonthlyOpen(false);
    setMobileOpen(false);
  }, [location.pathname]);

  /* ── Inject Christmas ribbons into the logo-side stage only ── */
  useEffect(() => {
    const nav = ribbonRef.current;
    if (!nav) return;
    const colors = [
      '#ff4d6d','#ff6b35','#ffd166','#06d6a0','#118ab2',
      '#a855f7','#ec4899','#22d3ee','#f97316','#84cc16',
      '#e11d48','#0ea5e9','#facc15','#10b981','#8b5cf6',
    ];
    const count = 12;
    const ribbons = [];
    for (let i = 0; i < count; i++) {
      const r = document.createElement('span');
      r.className = 'tm-ribbon';
      r.style.left             = `${(Math.random() * 100).toFixed(1)}%`;
      r.style.animationDelay   = `${(Math.random() * 7).toFixed(2)}s`;
      r.style.animationDuration= `${(2.5 + Math.random() * 3.5).toFixed(2)}s`;
      r.style.background       = colors[Math.floor(Math.random() * colors.length)];
      const isFlat = Math.random() > 0.5;
      r.style.width  = isFlat ? `${5 + Math.random() * 5}px` : `${2 + Math.random() * 3}px`;
      r.style.height = isFlat ? `${2 + Math.random() * 3}px` : `${7 + Math.random() * 6}px`;
      r.style.opacity = (0.25 + Math.random() * 0.2).toFixed(2);
      const sign = Math.random() > 0.5 ? 1 : -1;
      r.style.setProperty('--dx1', `${sign * (5 + Math.random() * 12).toFixed(1)}px`);
      r.style.setProperty('--dx2', `${-sign * (3 + Math.random() * 8).toFixed(1)}px`);
      r.style.setProperty('--r1',  `${120 + Math.random() * 120}deg`);
      r.style.setProperty('--r2',  `${280 + Math.random() * 160}deg`);
      nav.appendChild(r);
      ribbons.push(r);
    }
    return () => ribbons.forEach(r => r.remove());
  }, []);

  const toggleDropdown = (name) => {
    if (openDropdown !== name) {
      setAttnReportsOpen(false);
      setHalfMonthlyOpen(false);
    }
    setOpenDropdown(prev => prev === name ? null : name);
  };

  const isActive = (path) => location.pathname.startsWith(path);
  const handleLogout = () => { logout(); navigate('/login'); };
  const navTo = (path) => {
    setOpenDropdown(null);
    setAttnReportsOpen(false);
    navigate(path);
  };

  const roleLabel = { admin: t('Admin'), branchManager: 'Branch Manager', departmentHead: 'Dept. Head', employee: t('Staff') };
  const roleColor = { admin: '#7e3af2', branchManager: '#1a56db', departmentHead: '#0e9f6e', employee: '#6b7280' };
  const avatarBg  = { admin: '#ede9fe', branchManager: '#dbeafe', departmentHead: '#d1fae5', employee: '#f3f4f6' };

  // Your own pending application is never something you can act on (the
  // server refuses self-approval for everyone below admin), so it must not
  // count as "awaiting your approval" in the menu badge or the bell.
  const isOthers = (empId) => isAdmin || String(empId) !== String(currentUser?.id);
  const pendingCount     = filteredLeaves.filter(l => l.status === 'pending' && isOthers(l.employeeId)).length
                         + filteredVisits.filter(v => v.status === 'pending' && isOthers(v.employeeId)).length;
  const leaveActive      = isActive('/leave') || isActive('/office-visit');
  const attendanceActive = isActive('/attendance');

  // Leave/Office Visit Approval pages only show applications the current
  // user is actually the assigned recommender/approver for (via Set
  // Recommendator & Approval) — the bell's per-category counts need to match
  // that same scope, or clicking through to "12 pending" would land on a
  // page showing far fewer (or different) rows than the badge promised.
  const isMyRecoOrApproval = (empId) => {
    if (!isOthers(empId)) return false;
    const a = recoConfig[String(empId)] || {};
    const recoIds = Array.isArray(a.reco) ? a.reco : (a.reco ? [a.reco] : []);
    const apprIds = Array.isArray(a.approval) ? a.approval : (a.approval ? [a.approval] : []);
    return [...recoIds, ...apprIds].map(String).includes(String(currentUser?.id));
  };
  const myPendingLeaves = filteredLeaves.filter(l => l.status === 'pending' && isMyRecoOrApproval(l.employeeId)).length;
  const myPendingVisits = filteredVisits.filter(v => v.status === 'pending' && isMyRecoOrApproval(v.employeeId)).length;

  // Missing Attendance requests assigned to the current user (as recommender/
  // approver, or any pending/recommended one if a manager) — same "Assigned
  // to Me" logic as MissingAttendanceRequests.jsx. Not tracked in `stats`
  // (that only covers Leave/Visit), so it's fetched separately here just for
  // the notification bell's summary.
  const [missingAssignedCount, setMissingAssignedCount] = useState(0);
  const fetchMissingAssigned = () => {
    if (!isManager) return;
    api.get('/attendance/missing-requests').then(rows => {
      const list = Array.isArray(rows) ? rows : [];
      // "Any pending request" only counts for staff in this manager's own
      // scope (filteredEmployees = own branch for a Branch Manager, everyone
      // for Admin) — previously a Branch Manager's bell counted every
      // branch's requests. Ones explicitly assigned to me still count
      // wherever they're from.
      const inScope = new Set((filteredEmployees || []).map(e => String(e.id)));
      const assignedToMe = list.filter(r => isOthers(r.employeeId) && (
        (String(r.recommendedBy) === String(currentUser?.id) && r.status === 'pending') ||
        (String(r.approvedBy) === String(currentUser?.id) && ['pending', 'recommended'].includes(r.status)) ||
        (isManager && ['pending', 'recommended'].includes(r.status) && inScope.has(String(r.employeeId))))
      );
      setMissingAssignedCount(assignedToMe.length);
    }).catch(() => {});
  };
  useEffect(() => { fetchMissingAssigned(); }, [isManager, currentUser?.id, filteredEmployees]); // eslint-disable-line react-hooks/exhaustive-deps
  const notifTotal = myPendingLeaves + myPendingVisits + missingAssignedCount;

  const Chevron = ({ cls = '' }) => (
    <svg className={`tm-chevron ${cls}`} viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
    </svg>
  );

  const ReportChevron = () => (
    <svg className="tm-reports-chevron" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
    </svg>
  );

  /* ── permission shortcuts ── */
  const showAttnDaily        = canView('attendanceDaily');
  const showAttnHalf         = canView('attendanceHalfMonthly');
  const showAttnMonthly      = canView('attendanceMonthly');
  const showAttnYearly       = canView('attendanceYearly');
  const hasAnyAttn = showAttnDaily || showAttnHalf || showAttnMonthly || showAttnYearly;

  /* scope-aware label for the Reports accordion */
  const reportsLabel = isAdmin         ? t('Reports')
                     : isBranchManager ? `${t('Branch')} ${t('Reports')}`
                     : isDeptHead      ? `${t('Dept')} ${t('Reports')}`
                     : t('My Reports');

  return (
    <nav className="topmenu" ref={menuRef}>

      {/* Ribbon stage — covers logo area only, overflow:hidden so ribbons don't escape */}
      <div ref={ribbonRef} className="tm-ribbon-stage" />

      {/* ── Brand ── */}
      <div className="tm-brand" onClick={() => navigate('/dashboard')}>
        <div className="tm-logo">EH</div>
        <div className="tm-brand-text">
          <span className="tm-brand-name">
            <span style={{ color: '#111827' }}>eHajiri</span>{' '}
            <span style={{ color: '#1a56db' }}>TMS</span>
          </span>
        </div>
      </div>

      {/* ── Mobile toggle ── */}
      <button className="tm-mobile-toggle" onClick={() => setMobileOpen(p => !p)}>
        <span></span><span></span><span></span>
      </button>

      {/* ── Nav items ── */}
      <div className={`tm-nav ${mobileOpen ? 'open' : ''}`}>

        {/* 1. Staff dropdown — all authenticated users */}
        <div
          className={`tm-item ${isActive('/users') || isActive('/chat') || (isActive('/staff/') && !isActive('/staff/task') && !isActive('/staff/field-visit')) ? 'active' : ''} ${openDropdown === 'staff' ? 'open' : ''}`}
          onClick={() => toggleDropdown('staff')}
        >
          <span>{t('Staff')}</span>
          <Chevron />

          <div
            className={`tm-dropdown ${openDropdown === 'staff' ? 'show' : ''}`}
            onClick={e => e.stopPropagation()}
          >
            {canView('staffDetail') && (
              <div className="tm-dropdown-item" onClick={() => navTo('/users')}>
                <MIcon name="users" /> {t('Staff Details')}
              </div>
            )}
            {/* Dedicated link for a role (e.g. departmentHead) granted just this one
                capability, not the full Staff Details page — hidden when staffDetail
                is already visible above to avoid showing the same feature twice. */}
            {!canView('staffDetail') && canView('recoApprovalConfig') && (
              <div className="tm-dropdown-item" onClick={() => navTo('/staff/reco-approval')}>
                <MIcon name="users" /> {t('Set Recommendator & Approval')}
              </div>
            )}
            <div className="tm-dropdown-item" onClick={() => navTo('/staff/notes')}>
              <MIcon name="fileText" /> {t('My Notes')}
            </div>
            {canView('staffContact') && (
              <div className="tm-dropdown-item" onClick={() => navTo('/staff/contact')}>
                <MIcon name="phone" /> {t('Contact')}
              </div>
            )}
            {canView('eventVisitorRegistration') && moduleFlags.guestRegistrationEnabled && (
              <div className="tm-dropdown-item" onClick={() => navTo('/staff/events')}>
                <MIcon name="userPlus" /> {t('Visitor Registration')}
              </div>
            )}
            {canView('staffAnalytics') && (
              <div className="tm-dropdown-item" onClick={() => navTo('/staff/analysis')}>
                <MIcon name="trendingUp" /> {t('Analysis Staff Report')}
              </div>
            )}
            <div className="tm-dropdown-item" onClick={() => navTo('/staff/message')}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><MIcon name="messageSquare" /> {t('Message')}</span>
              {msgCount > 0 && (
                <span style={{ background: '#dc2626', color: '#fff', borderRadius: 10,
                  fontSize: 10, fontWeight: 700, padding: '1px 6px', minWidth: 18, textAlign: 'center' }}>
                  {msgCount}
                </span>
              )}
            </div>
            {moduleFlags.chatEnabled && (
              <div className="tm-dropdown-item" onClick={() => navTo('/chat')}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><MIcon name="messageCircle" /> {t('Chat')}</span>
                {chatUnread > 0 && (
                  <span style={{ background: '#22c55e', color: '#fff', borderRadius: 10,
                    fontSize: 10, fontWeight: 700, padding: '1px 6px', minWidth: 18, textAlign: 'center' }}>
                    {chatUnread}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 2. Task — plain link (no dropdown): clicking it goes straight to
            the Task Dashboard, which has its own Settings (Task Category /
            Task Priority) and Task List / Field Visit quick links in its
            header — see TaskDashboard.jsx. Same convention as Payroll
            (PayrollDashboard.jsx) below. */}
        {canView('task') && moduleFlags.taskEnabled && (
          <div
            className={`tm-item ${(isActive('/staff/task') || isActive('/staff/field-visit')) ? 'active' : ''}`}
            onClick={() => navTo('/staff/task/dashboard')}
          >
            <span>{t('Task')}</span>
            {(taskCount + fieldVisitTaskCount) > 0 && (
              <span className="tm-badge" style={{ marginLeft: 4 }}>{taskCount + fieldVisitTaskCount}</span>
            )}
          </div>
        )}

        {/* 3. Leave & Office Visit — all authenticated */}
        <div
          className={`tm-item ${leaveActive ? 'active' : ''} ${openDropdown === 'leave' ? 'open' : ''}`}
          onClick={() => toggleDropdown('leave')}
        >
          <span>{t('Leave & Office Visit')}</span>
          {isManager && pendingCount > 0 && (
            <span className="tm-badge" style={{ marginLeft: 4 }}>{pendingCount}</span>
          )}
          <Chevron />

          <div
            className={`tm-dropdown leave-dd ${openDropdown === 'leave' ? 'show' : ''}`}
            onClick={e => e.stopPropagation()}
          >
            {/* Leave & Office Visit list */}
            <div className="tm-dropdown-item" onClick={() => navTo('/leave')}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <MIcon name="calendar" /> {t('Leave')} <span style={{ color: '#d1d5db' }}>|</span> <MIcon name="briefcase" /> {t('Office Visit')}
              </span>
              {isManager && pendingCount > 0 && (
                <span style={{ background: '#dc2626', color: '#fff', borderRadius: 10,
                  fontSize: 10, fontWeight: 700, padding: '1px 6px', minWidth: 18, textAlign: 'center' }}>
                  {pendingCount}
                </span>
              )}
            </div>

            {/* Leave Calculation — anyone with leaveCalculation view permission */}
            {canView('leaveCalculation') && (
              <div className="tm-dropdown-item" onClick={() => navTo('/leave/calculation')}>
                <MIcon name="calculator" /> {t('Leave Calculation')}
              </div>
            )}
            {canView('leaveReports') && (
              <div className="tm-dropdown-item" onClick={() => navTo('/leave/reports/leave')}>
                <MIcon name="barChart" /> {t('Leave Reports')}
              </div>
            )}
            {canView('officeVisitReports') && (
              <div className="tm-dropdown-item" onClick={() => navTo('/leave/reports/office-visit')}>
                <MIcon name="barChart" /> {t('Office Visit Reports')}
              </div>
            )}
          </div>
        </div>

        {/* 4. Attendance — all authenticated (employee sees own reports only) */}
        <div
          className={`tm-item ${attendanceActive ? 'active' : ''} ${openDropdown === 'attendance' ? 'open' : ''}`}
          onClick={() => toggleDropdown('attendance')}
        >
          <span>{t('Attendance')}</span>
          <Chevron />

          <div
            className={`tm-dropdown attn-dd ${openDropdown === 'attendance' ? 'show' : ''}`}
            onClick={e => e.stopPropagation()}
          >

            {/* Reports — visible to anyone with at least one attendance page permission */}
            {hasAnyAttn && (
              <>
                <div
                  className={`tm-reports-header ${attnReportsOpen ? 'open' : ''}`}
                  onClick={() => setAttnReportsOpen(p => !p)}
                >
                  <MIcon name="barChart" size={15} />
                  <span style={{ flex: 1 }}>{reportsLabel}</span>
                  <ReportChevron />
                </div>
                {attnReportsOpen && (
                  <div className="tm-sub-items">
                    {showAttnDaily && (
                      <div className="tm-sub-item" onClick={() => navTo('/attendance/reports/daily')}>
                        <MIcon name="list" /> {t('Daily Attendance Report')}
                      </div>
                    )}
                    {showAttnHalf && (
                      <div className="tm-sub-item" onClick={() => navTo('/attendance/reports/half-monthly')}>
                        <MIcon name="activity" /> {t('Half Monthly Reports')}
                      </div>
                    )}
                    {showAttnMonthly && (
                      <div className="tm-sub-item" onClick={() => navTo('/attendance/reports/monthly')}>
                        <MIcon name="calendar" /> {t('Monthly Report')}
                      </div>
                    )}
                    {showAttnYearly && (
                      <div className="tm-sub-item" onClick={() => navTo('/attendance/reports/yearly')}>
                        <MIcon name="trendingUp" /> {t('Yearly Report')}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* OT Approval — managers/admins (approve), Dept Heads (their dept), OT-eligible employees (own records, read-only) */}
            {(isManager || isDeptHead || (isEmployee && currentUser?.eligibleForOt)) && canView('overtime') && (
              <div className="tm-dropdown-item" onClick={() => navTo('/attendance/overtime')}
                style={{ color: location.pathname === '/attendance/overtime' ? '#1a56db' : undefined }}>
                <MIcon name="clock" /> {t('Overtime (OT) Approval')}
                {stats?.pendingOT > 0 && (
                  <span style={{ marginLeft:'auto', background:'#dc2626', color:'#fff',
                    borderRadius:99, fontSize:10, fontWeight:800, padding:'1px 6px', minWidth:18, textAlign:'center' }}>
                    {stats.pendingOT}
                  </span>
                )}
              </div>
            )}

            {/* Missing Attendance Requests — shown if the viewer can either
                manage/approve the list or submit their own; hiding it
                requires an admin to turn off BOTH permissions for that role,
                so a plain employee's own self-service access survives even
                though this same nav item also serves the manager/approver
                side of the page. */}
            {(canView('missingAttendanceRequests') || canView('missingAttendanceApply')) && (
              <div className="tm-dropdown-item" onClick={() => navTo('/attendance/missing-requests')}
                style={{ color: location.pathname === '/attendance/missing-requests' ? '#1a56db' : undefined }}>
                <MIcon name="mail" /> {t('Missing Attendance Requests')}
              </div>
            )}

            {/* Duty Roster — anyone with dutyRoster view permission. A plain
                Employee has no use for the Create/Manage hub (roster-dashboard)
                — they go straight to their own read-only roster report. */}
            {canView('dutyRoster') && moduleFlags.dutyRosterEnabled && (
              <div className="tm-dropdown-item"
                onClick={() => navTo(isEmployee ? '/attendance/roster-report' : '/attendance/roster-dashboard')}
                style={{ color: location.pathname.startsWith('/attendance/roster-dashboard') || location.pathname.startsWith('/attendance/duty-roster') || (isEmployee && location.pathname.startsWith('/attendance/roster-report')) ? '#1a56db' : undefined }}>
                <MIcon name="clipboard" /> {t('Duty Roster')}
              </div>
            )}

            {/* Manual Postings — admin only */}
            {canManageSystem && canView('manualPostings') && (
              <>
                <div className="tm-dropdown-item" onClick={() => navTo('/attendance/manual-postings')}>
                  <MIcon name="edit3" /> {t('Manual Postings')}
                </div>
              </>
            )}

            {/* Online Attendance — one destination now (Setting merged into
                a tab on the Approval page), mirrors Leave Approval's own
                gate (admin + branchManager); Setting tab within the page is
                further narrowed to isAdmin. */}
            {isManager && canView('onlineAttendance') && (
              <div className="tm-dropdown-item" onClick={() => navTo('/attendance/online/approval')}
                style={{ color: location.pathname === '/attendance/online/approval' ? '#1a56db' : undefined }}>
                <MIcon name="globe" /> {t('Online Attendance')}
              </div>
            )}

            {/* Empty state for employee when all attendance perms are off */}
            {!hasAnyAttn && !canManageSystem && (
              <div style={{ padding: '12px 16px', fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>
                No attendance pages available
              </div>
            )}

          </div>
        </div>

        {/* 5. Payroll — plain link (no dropdown): clicking it goes straight
            to the Payroll Dashboard, which has its own Settings (Payroll
            Items / Payroll Tax Slab) and Reports in its header — see
            PayrollDashboard.jsx. Gated by the payroll pageKey only (no
            moduleFlags entry — unlike Task/Duty Roster/Chat this isn't an
            optional bigger feature area with its own on/off toggle, same
            convention as myNotes/staffContact/leaveApply etc.). */}
        {canView('payroll') && (
          <div className={`tm-item ${isActive('/payroll') ? 'active' : ''}`} onClick={() => navTo('/payroll/dashboard')}>
            <span>{t('Payroll')}</span>
          </div>
        )}

      </div>

      {/* ── Right side ── */}
      <div className="tm-right">

        {/* Pending approvals bell */}
        {isManager && notifTotal > 0 && (
          <div
            className={`tm-bell ${openDropdown === 'bell' ? 'open' : ''}`}
            title={`${notifTotal} ${t('Pending Approvals')}`}
            onClick={() => { toggleDropdown('bell'); fetchMissingAssigned(); }}
          >
            <MIcon name="bell" size={18} color="currentColor" style={{ verticalAlign: 'middle' }} />
            <span className="tm-bell-badge">{notifTotal}</span>

            <div
              className={`tm-dropdown notif-dd ${openDropdown === 'bell' ? 'show' : ''}`}
              onClick={e => e.stopPropagation()}
            >
              <div className="tm-dropdown-header">{t('Pending Approvals')}</div>

              {myPendingLeaves > 0 && (
                <div className="tm-dropdown-item" onClick={() => navTo('/leave/approval')}>
                  <MIcon name="calendar" /> {t('Leave Application')}
                  <span className="tm-badge" style={{ marginLeft: 'auto' }}>{myPendingLeaves}</span>
                </div>
              )}
              {myPendingVisits > 0 && (
                <div className="tm-dropdown-item" onClick={() => navTo('/office-visit/approval')}>
                  <MIcon name="briefcase" /> {t('Office Visit Application')}
                  <span className="tm-badge" style={{ marginLeft: 'auto' }}>{myPendingVisits}</span>
                </div>
              )}
              {missingAssignedCount > 0 && (
                <div className="tm-dropdown-item" onClick={() => navTo('/attendance/missing-requests')}>
                  <MIcon name="mail" /> {t('Missing Attendance Requests')}
                  <span className="tm-badge" style={{ marginLeft: 'auto' }}>{missingAssignedCount}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Language toggle */}
        <button
          className="tm-lang-btn"
          onClick={() => changeLanguage(language === 'np' ? 'en' : 'np')}
          title={language === 'np' ? 'Switch to English' : 'नेपालीमा जानुस'}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
        >
          {language === 'np' ? <><FlagUK /> EN</> : <><FlagNepal /> ने</>}
        </button>

        {/* ── User dropdown ── */}
        <div
          className={`tm-user ${openDropdown === 'user' ? 'open' : ''}`}
          onClick={() => toggleDropdown('user')}
        >
          {currentUser?.profilePhoto ? (
            <div className="tm-avatar" style={{ overflow: 'hidden', padding: 0 }}>
              <img src={currentUser.profilePhoto} alt={currentUser?.fullName || ''}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            </div>
          ) : (
            <div className="tm-avatar" style={{ background: avatarBg[currentUser?.role], color: roleColor[currentUser?.role] }}>
              {currentUser?.avatar}
            </div>
          )}
          <div className="tm-user-info">
            <span className="tm-user-name">{currentUser?.fullName}</span>
            <span className="tm-user-role" style={{ color: roleColor[currentUser?.role] }}>
              {roleLabel[currentUser?.role]}
            </span>
          </div>
          <Chevron />

          <div
            className={`tm-dropdown user-dd ${openDropdown === 'user' ? 'show' : ''}`}
            onClick={e => e.stopPropagation()}
          >
            {/* Role badge */}
            <div style={{ padding:'8px 14px', borderBottom:'1px solid #f1f5f9',
              fontSize:11, color:'#6b7280', fontWeight:600, letterSpacing:'.3px', textTransform:'uppercase' }}>
              {roleLabel[currentUser?.role] || currentUser?.role}
              {(isBranchManager && currentUser?.branch) && (
                <span style={{ display:'block', color:'#1a56db', fontSize:10, fontWeight:700, marginTop:2 }}>
                  {currentUser.branch}
                </span>
              )}
              {(isDeptHead && currentUser?.department) && (
                <span style={{ display:'block', color:'#0e9f6e', fontSize:10, fontWeight:700, marginTop:2 }}>
                  {currentUser.department}
                </span>
              )}
            </div>

            <div className="tm-dropdown-item" onClick={() => navigate('/profile')}>
              <MIcon name="user" /> {t('Profile')}
            </div>

            {/* Settings, License, Backup, Role Management — admin only */}
            {canManageSystem && (
              <>
                <div className="tm-dropdown-item" onClick={() => navigate('/settings')}>
                  <MIcon name="sliders" /> {t('Settings')}
                </div>
                <div className="tm-dropdown-item" onClick={() => navigate('/settings/license')}>
                  <MIcon name="key" /> {t('License')}
                </div>
                <div className="tm-dropdown-item" onClick={() => navigate('/settings/roles')}>
                  <MIcon name="shield" /> {t('Role & Permissions')}
                </div>
                <div className="tm-dd-divider"></div>
                <div className="tm-dropdown-item" onClick={() => navigate('/settings?tab=database')}>
                  <MIcon name="database" /> {t('Backup & Restore')}
                </div>
                <div className="tm-dd-divider"></div>
              </>
            )}
            <div className="tm-dropdown-item danger" onClick={handleLogout}>
              <MIcon name="logOut" /> {t('Logout')}
            </div>
          </div>
        </div>

      </div>
    </nav>
  );
};

export default TopMenu;
