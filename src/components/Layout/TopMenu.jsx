import React, { useState, useRef, useEffect, lazy, Suspense } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth }         from '../../context/AuthContext.jsx';
import { useModuleFlags }  from '../../context/ModuleFlagsContext.jsx';
import { useLanguage }     from '../../context/LanguageContext.jsx';
import { useData }         from '../../context/DataContext.jsx';
import { useNotifications } from '../Notifications/AttendanceToasts.jsx';
import { useChat } from '../../context/ChatContext.jsx';
import useRecoApproval from '../../hooks/useRecoApproval.js';
import api from '../../api/client.js';
import { ACCOUNTS_MENU, ACCOUNTS_HUBS } from '../Accounts/menu.js';
import { useCart } from '../Accounts/lib/cart.js';
import { NOTIF_CATEGORIES } from '../../utils/notifCategories.js';

// the cart pop-up is only loaded when someone opens it
const CartDrawer = lazy(() => import('../Accounts/CartDrawer.jsx'));
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

import { MIcon } from './menuIcons.jsx';
// Menu label with its Alt+letter shortcut underlined (first matching letter; none if the label has no such letter,
// e.g. the Nepali label — the shortcut still works).
const Hot = ({ text, k }) => {
  const s = String(text ?? '');
  const i = s.toLowerCase().indexOf(k);
  if (i < 0) return s;
  return <>{s.slice(0, i)}<u style={{ textDecorationThickness: 1.5, textUnderlineOffset: 3 }}>{s[i]}</u>{s.slice(i + 1)}</>;
};

const TopMenu = () => {
  const {
    currentUser, logout,
    isAdmin, isBranchManager, isDeptHead, isEmployee,
    isManager, canManageSystem, canViewReports,
    canView,
  } = useAuth();
  const { flags: moduleFlags } = useModuleFlags();
  const { t, language, changeLanguage } = useLanguage();
  const { stats, filteredLeaves, filteredVisits, filteredEmployees, leaves: allLeavesRaw, officeVisits: allVisitsRaw } = useData();
  const { msgCount, taskCount, fieldVisitTaskCount } = useNotifications();
  const { totalUnread: chatUnread } = useChat();
  const { assignments: recoConfig } = useRecoApproval();
  const navigate  = useNavigate();
  const location  = useLocation();

  const [openDropdown,       setOpenDropdown]       = useState(null);
  const [attnReportsOpen,    setAttnReportsOpen]    = useState(false);
  const [accSection,         setAccSection]         = useState(null);   // open section of the Accounts menu
  const [accAlerts,          setAccAlerts]          = useState(0);      // Accounts alerts (bills due, services expiring, low stock …)
  const [cartOpen,           setCartOpen]           = useState(false);
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

  // Accounts module: alert count for the bell (refreshed every 5 min and whenever the Alerts page changes something)
  const accountsOn = !!(canView('accounts') && moduleFlags.accountingEnabled);
  const accCart = useCart();
  useEffect(() => {
    if (!accountsOn) { setAccAlerts(0); return undefined; }
    const load = () => api.get('/accounts/alerts').then(a => setAccAlerts(a?.count || 0)).catch(() => {});
    load();
    const timer = setInterval(load, 5 * 60 * 1000);
    window.addEventListener('ehl:acc-alerts', load);
    return () => { clearInterval(timer); window.removeEventListener('ehl:acc-alerts', load); };
  }, [accountsOn]);

  const toggleAccountsMenu = () => {
    if (openDropdown !== 'accounts') {
      setAccSection(ACCOUNTS_MENU.find(sec => sec.items?.some(([to]) => location.pathname.startsWith('/accounts' + to)))?.title || null);
    }
    toggleDropdown('accounts');
  };

  // Keyboard: Alt+S Staff · Alt+T Task · Alt+L Leave · Alt+E Attendance · Alt+P Payroll · Alt+A Accounts.
  // Dropdown menus open (press again to close); Task / Payroll are plain links and go straight to their dashboard.
  // Always reads the latest state through a ref, so the listener is registered once.
  const menuKeysRef = useRef({});
  menuKeysRef.current = {
    s: () => toggleDropdown('staff'),
    l: () => toggleDropdown('leave'),
    e: () => toggleDropdown('attendance'),
    t: (canView('task') && moduleFlags.taskEnabled) ? () => navTo('/staff/task/dashboard') : null,
    p: canView('payroll') ? () => navTo('/payroll/dashboard') : null,
    a: accountsOn ? toggleAccountsMenu : null,
  };
  useEffect(() => {
    const onKey = (e) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.repeat) return;
      if (window.__ehFieldAlt > 0) return;               // a form (e.g. Staff Detail) is using Alt+letter to jump between fields
      const act = menuKeysRef.current[(e.key || '').toLowerCase()];
      if (!act) return;
      e.preventDefault();
      act();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Keyboard inside an open menu (after Alt+S / Alt+L / Alt+E / Alt+A …): ↓ / ↑ move the highlight through the visible items, Enter opens the
  // highlighted one (a group header such as "Reports" expands, and the arrows then continue through its sub-items), Esc closes the menu.
  // Works on whatever is rendered inside the open dropdown, so every menu — including the nested Attendance and Accounts ones — behaves the same.
  const kbIdxRef = useRef(-1);
  useEffect(() => {
    kbIdxRef.current = -1;
    const clear = () => document.querySelectorAll('.tm-kb').forEach(el => el.classList.remove('tm-kb'));
    clear();
    if (!openDropdown) return undefined;
    const items = () => {
      const dd = document.querySelector('.tm-dropdown.show');
      if (!dd) return [];
      return [...dd.querySelectorAll('.tm-dropdown-item, .tm-sub-item, .tm-reports-header')].filter(el => el.getClientRects().length > 0);
    };
    const onKey = (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;   // typing in a field — not ours
      if (e.key === 'Escape') { setOpenDropdown(null); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return;
      const list = items();
      if (!list.length) return;
      if (e.key === 'Enter') {
        const cur = list[kbIdxRef.current];
        if (!cur) return;                        // nothing highlighted yet — leave Enter alone
        e.preventDefault();
        cur.click();
        // a group header only expands: keep the highlight on it (its new sub-items are reachable with ↓)
        return;
      }
      e.preventDefault();
      const n = list.length;
      let i = kbIdxRef.current;
      i = e.key === 'ArrowDown' ? (i < 0 ? 0 : (i + 1) % n) : (i < 0 ? n - 1 : (i - 1 + n) % n);
      kbIdxRef.current = i;
      clear();
      list[i].classList.add('tm-kb');
      list[i].scrollIntoView({ block: 'nearest' });
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); clear(); };
  }, [openDropdown]);

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
  const leaveActive      = isActive('/leave') || isActive('/office-visit');
  const attendanceActive = isActive('/attendance');

  // Leave/Office Visit Approval pages only show applications the current
  // user is actually the assigned recommender/approver for (via Set
  // Recommendator & Approval) — the bell's per-category counts need to match
  // that same scope, or clicking through to "12 pending" would land on a
  // page showing far fewer (or different) rows than the badge promised.
  // `rec` (the application itself) narrows it to the one recommender/approver the applicant picked.
  const isMyRecoOrApproval = (empId, rec) => {
    if (!isOthers(empId)) return false;
    const me = String(currentUser?.id);
    const a = recoConfig[String(empId)] || {};
    const recoIds = (Array.isArray(a.reco) ? a.reco : (a.reco ? [a.reco] : [])).map(String);
    const apprIds = (Array.isArray(a.approval) ? a.approval : (a.approval ? [a.approval] : [])).map(String);
    const asReco = recoIds.includes(me) && (!rec?.recoId || String(rec.recoId) === me);
    const asAppr = apprIds.includes(me) && (!rec?.approvalId || String(rec.approvalId) === me);
    return asReco || asAppr;
  };
  // Counted from the company-wide lists (not the org-scoped filteredLeaves/filteredVisits): someone can be
  // the configured recommender/approver for staff outside their own branch/department.
  const myPendingLeaves = (allLeavesRaw || []).filter(l => l.status === 'pending' && isMyRecoOrApproval(l.employeeId, l)).length;
  const myPendingVisits = (allVisitsRaw || []).filter(v => v.status === 'pending' && isMyRecoOrApproval(v.employeeId, v)).length;
  // menu badge = only what THIS login has to recommend/approve (not every pending application in the company)
  const pendingCount = myPendingLeaves + myPendingVisits;

  // Missing Attendance requests assigned to the current user (as recommender/
  // approver, or any pending/recommended one if a manager) — same "Assigned
  // to Me" logic as MissingAttendanceRequests.jsx. Not tracked in `stats`
  // (that only covers Leave/Visit), so it's fetched separately here just for
  // the notification bell's summary.
  const [missingAssignedCount, setMissingAssignedCount] = useState(0);
  // Late In / Early Out requests assigned to me (configured recommender/approver, or picked on the row)
  const [lateEarlyAssignedCount, setLateEarlyAssignedCount] = useState(0);
  const fetchMissingAssigned = () => {
    if (!currentUser?.id) return;
    api.get('/attendance/manual-postings').then(rows => {
      const list = Array.isArray(rows) ? rows : [];
      setLateEarlyAssignedCount(list.filter(r => r.status === 'pending' && (isMyRecoOrApproval(r.employeeId)
        || (isOthers(r.employeeId) && (String(r.recommendedById) === String(currentUser.id) || String(r.approvedById) === String(currentUser.id))))).length);
    }).catch(() => {});
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
  useEffect(() => { fetchMissingAssigned(); }, [isManager, currentUser?.id, filteredEmployees, recoConfig]); // eslint-disable-line react-hooks/exhaustive-deps
  // Unread inbox notifications by category (leave / office visit / overtime / task / field visit / accounts / quotation …).
  // These are the same messages that land in Staff → Message, so a decision on your leave / OT / visit shows up here too.
  const [unreadByCat, setUnreadByCat] = useState({});
  const loadUnreadByCat = () => {
    if (!currentUser?.id) return;
    api.get('/messages/unread-summary').then(rows => {
      const m = {};
      (Array.isArray(rows) ? rows : []).forEach(r => { m[r.category] = r.count; });
      setUnreadByCat(m);
    }).catch(() => {});
  };
  useEffect(() => {
    loadUnreadByCat();
    const timer = setInterval(loadUnreadByCat, 2 * 60 * 1000);
    window.addEventListener('ehajiri:messages-changed', loadUnreadByCat);
    return () => { clearInterval(timer); window.removeEventListener('ehajiri:messages-changed', loadUnreadByCat); };
  }, [currentUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const unreadTotal = Object.values(unreadByCat).reduce((a, b) => a + b, 0);
  const pendingTotal = myPendingLeaves + myPendingVisits + missingAssignedCount + lateEarlyAssignedCount;
  const notifTotal = pendingTotal + unreadTotal;

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
        <img className="tm-brand-logo" src="/icons/ehajiri-logo.png?v=2" alt="eHajiri" draggable={false} />
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
          title="Alt+S"
          onClick={() => toggleDropdown('staff')}
        >
          <span><Hot text={t('Staff')} k="s" /></span>
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
            title="Alt+T"
            onClick={() => navTo('/staff/task/dashboard')}
          >
            <span><Hot text={t('Task')} k="t" /></span>
            {(taskCount + fieldVisitTaskCount) > 0 && (
              <span className="tm-badge" style={{ marginLeft: 4 }}>{taskCount + fieldVisitTaskCount}</span>
            )}
          </div>
        )}

        {/* 3. Leave & Office Visit — all authenticated */}
        <div
          className={`tm-item ${leaveActive ? 'active' : ''} ${openDropdown === 'leave' ? 'open' : ''}`}
          title="Alt+L"
          onClick={() => toggleDropdown('leave')}
        >
          <span><Hot text={t('Leave & Office Visit')} k="l" /></span>
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
          title="Alt+E"
          onClick={() => toggleDropdown('attendance')}
        >
          <span><Hot text={t('Attendance')} k="e" /></span>
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
          <div className={`tm-item ${isActive('/payroll') ? 'active' : ''}`} title="Alt+P" onClick={() => navTo('/payroll/dashboard')}>
            <span><Hot text={t('Payroll')} k="p" /></span>
          </div>
        )}

        {/* 6. Accounts (accounting + inventory) — plain link, shown only when a Super Admin has enabled the
            module for this company AND the user has the `accounts` page permission. */}
        {accountsOn && (
          <div
            title="Alt+A"
            className={`tm-item ${isActive('/accounts') ? 'active' : ''} ${openDropdown === 'accounts' ? 'open' : ''}`}
            onClick={toggleAccountsMenu}
          >
            <span><Hot text={t('Accounts')} k="a" /></span>
            <Chevron />

            <div
              className={`tm-dropdown attn-dd ${openDropdown === 'accounts' ? 'show' : ''}`}
              onClick={e => e.stopPropagation()}
            >
              {Object.entries(ACCOUNTS_HUBS).map(([k, h]) => (
                <div key={k}
                  className={`tm-reports-header ${location.pathname === '/accounts/' + k ? 'open' : ''}`}
                  onClick={() => navTo('/accounts/' + k)}>
                  <MIcon name={h.icon} size={15} />
                  <span style={{ flex: 1 }}>{h.title}</span>
                </div>
              ))}
              <div className="tm-dropdown-item" onClick={() => navTo('/accounts')}>
                <MIcon name="activity" /> Dashboard
              </div>
            </div>
          </div>
        )}

      </div>

      {/* ── Right side ── */}
      <div className="tm-right">

        {/* Pending approvals bell */}
        {accountsOn && (
          <div className="tm-bell" title={`Cart${accCart.length ? ` (${accCart.length})` : ''}`} onClick={() => { setOpenDropdown(null); setCartOpen(true); }}>
            <span style={{ fontSize: 16, lineHeight: 1 }}>🛒</span>
            {accCart.length > 0 && <span className="tm-bell-badge">{accCart.length}</span>}
          </div>
        )}

        {(notifTotal > 0 || accAlerts > 0) && (
          <div
            className={`tm-bell ${openDropdown === 'bell' ? 'open' : ''}`}
            title={`${notifTotal + accAlerts} ${t('Notifications')}`}
            onClick={() => { toggleDropdown('bell'); fetchMissingAssigned(); }}
          >
            <MIcon name="bell" size={18} color="currentColor" style={{ verticalAlign: 'middle' }} />
            <span className="tm-bell-badge">{notifTotal + accAlerts}</span>

            <div
              className={`tm-dropdown notif-dd ${openDropdown === 'bell' ? 'show' : ''}`}
              onClick={e => e.stopPropagation()}
            >
              <div className="tm-dropdown-header">{t('Notifications')}</div>

              {/* Unread notifications, grouped by category — same messages as Staff → Message */}
              {NOTIF_CATEGORIES.filter(c => unreadByCat[c.key] > 0).map(c => (
                <div key={c.key} className="tm-dropdown-item" onClick={() => navTo(`/staff/message?cat=${c.key}`)}>
                  <span style={{ width: 18, textAlign: 'center' }}>{c.icon}</span> {c.label}
                  <span className="tm-badge" style={{ marginLeft: 'auto' }}>{unreadByCat[c.key]}</span>
                </div>
              ))}
              {accAlerts > 0 && (
                <div className="tm-dropdown-item" title="Bills due, services expiring, low stock" onClick={() => navTo('/accounts/alerts')}>
                  <span style={{ width: 18, textAlign: 'center' }}>📒</span> Accounts alerts
                  <span className="tm-badge" style={{ marginLeft: 'auto' }}>{accAlerts}</span>
                </div>
              )}
              {pendingTotal > 0 && <div className="tm-dropdown-header">{t('Pending Approvals')}</div>}
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
              {lateEarlyAssignedCount > 0 && (
                <div className="tm-dropdown-item" onClick={() => navTo('/attendance/manual-postings')}>
                  <MIcon name="clock" /> {t('Late In / Early Out Requests')}
                  <span className="tm-badge" style={{ marginLeft: 'auto' }}>{lateEarlyAssignedCount}</span>
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

        {cartOpen && (
          <Suspense fallback={null}>
            <CartDrawer onClose={() => setCartOpen(false)} go={(to) => { setCartOpen(false); navigate('/accounts' + to); }} />
          </Suspense>
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
