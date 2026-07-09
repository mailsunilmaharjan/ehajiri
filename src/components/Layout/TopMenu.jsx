import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth }         from '../../context/AuthContext.jsx';
import { useLanguage }     from '../../context/LanguageContext.jsx';
import { useData }         from '../../context/DataContext.jsx';
import { useSettings }     from '../../context/SettingsContext.jsx';
import { useNotifications } from '../Notifications/AttendanceToasts.jsx';
import { useChat } from '../../context/ChatContext.jsx';
import './TopMenu.css';

const TopMenu = () => {
  const {
    currentUser, logout,
    isAdmin, isBranchManager, isDeptHead, isEmployee,
    isManager, canManageSystem, canViewReports,
    canView,
  } = useAuth();
  const { t, language, changeLanguage } = useLanguage();
  const { stats } = useData();
  const { settings, getCompanyName } = useSettings();
  const { msgCount } = useNotifications();
  const { totalUnread: chatUnread } = useChat();
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

  const pendingCount     = stats.pendingLeaves + stats.pendingVisits;
  const leaveActive      = isActive('/leave') || isActive('/office-visit');
  const attendanceActive = isActive('/attendance');

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

  /* scope chip shown next to brand for non-admin roles */
  const scopeChip = isBranchManager
    ? { label: `🏢 ${currentUser?.branch || 'Branch'}`, color: '#1a56db', bg: '#dbeafe' }
    : isDeptHead
    ? { label: `${currentUser?.department || 'Dept'}`, color: '#0e9f6e', bg: '#d1fae5' }
    : null;

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
          <span className="tm-brand-sub" style={{ color: '#111827', fontWeight: 600 }}>{getCompanyName(language)}</span>
        </div>
        {scopeChip && (
          <span style={{
            marginLeft: 10, fontSize: 11, fontWeight: 700, padding: '2px 10px',
            borderRadius: 10, background: scopeChip.bg, color: scopeChip.color,
            whiteSpace: 'nowrap', border: `1px solid ${scopeChip.color}44`,
          }}>
            {scopeChip.label}
          </span>
        )}
      </div>

      {/* ── Mobile toggle ── */}
      <button className="tm-mobile-toggle" onClick={() => setMobileOpen(p => !p)}>
        <span></span><span></span><span></span>
      </button>

      {/* ── Nav items ── */}
      <div className={`tm-nav ${mobileOpen ? 'open' : ''}`}>

        {/* 1. Staff dropdown — all authenticated users */}
        <div
          className={`tm-item ${isActive('/users') || isActive('/staff/') || isActive('/chat') ? 'active' : ''} ${openDropdown === 'staff' ? 'open' : ''}`}
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
                <span>👥</span> {t('Staff Details')}
              </div>
            )}
            <div className="tm-dropdown-item" onClick={() => navTo('/staff/notes')}>
              <span>📝</span> {t('My Notes')}
            </div>
            {canView('staffContact') && (
              <div className="tm-dropdown-item" onClick={() => navTo('/staff/contact')}>
                <span>📞</span> {t('Contact')}
              </div>
            )}
            <div className="tm-dropdown-item" onClick={() => navTo('/staff/message')}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span><span>💬</span> {t('Message')}</span>
              {msgCount > 0 && (
                <span style={{ background: '#dc2626', color: '#fff', borderRadius: 10,
                  fontSize: 10, fontWeight: 700, padding: '1px 6px', minWidth: 18, textAlign: 'center' }}>
                  {msgCount}
                </span>
              )}
            </div>
            <div className="tm-dropdown-item" onClick={() => navTo('/chat')}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span><span>🗨️</span> {t('Chat')}</span>
              {chatUnread > 0 && (
                <span style={{ background: '#22c55e', color: '#fff', borderRadius: 10,
                  fontSize: 10, fontWeight: 700, padding: '1px 6px', minWidth: 18, textAlign: 'center' }}>
                  {chatUnread}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* 2. Leave & Office Visit — all authenticated */}
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
            <div className="tm-dropdown-item" onClick={() => navTo('/leave')}>
              <span>📅</span> {t('Leave')} | 🏢 {t('Office Visit')}
            </div>

            {/* Leave Calculation — anyone with leaveCalculation view permission */}
            {canView('leaveCalculation') && (
              <div className="tm-dropdown-item" onClick={() => navTo('/leave/calculation')}>
                <span>🧮</span> {t('Leave Calculation')}
              </div>
            )}
          </div>
        </div>

        {/* 3. Attendance — all authenticated (employee sees own reports only) */}
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
                  <span style={{ fontSize: 15 }}>📊</span>
                  <span style={{ flex: 1 }}>{reportsLabel}</span>
                  <ReportChevron />
                </div>
                {attnReportsOpen && (
                  <div className="tm-sub-items">
                    {showAttnDaily && (
                      <div className="tm-sub-item" onClick={() => navTo('/attendance/reports/daily')}>
                        <span>📋</span> {t('Daily Attendance Report')}
                      </div>
                    )}
                    {showAttnHalf && (
                      <div className="tm-sub-item" onClick={() => navTo('/attendance/reports/half-monthly')}>
                        <span>🤖</span> {t('Half Monthly Reports')}
                      </div>
                    )}
                    {showAttnMonthly && (
                      <div className="tm-sub-item" onClick={() => navTo('/attendance/reports/monthly')}>
                        <span>📅</span> {t('Monthly Report')}
                      </div>
                    )}
                    {showAttnYearly && (
                      <div className="tm-sub-item" onClick={() => navTo('/attendance/reports/yearly')}>
                        <span>📋</span> {t('Yearly Report')}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* OT Approval — managers/admins (approve), Dept Heads (their dept), OT-eligible employees (own records, read-only) */}
            {(isManager || isDeptHead || (isEmployee && currentUser?.eligibleForOt)) && (
              <div className="tm-dropdown-item" onClick={() => navTo('/attendance/overtime')}
                style={{ color: location.pathname === '/attendance/overtime' ? '#1a56db' : undefined }}>
                <span>⏱️</span> {t('Overtime (OT) Approval')}
                {stats?.pendingOT > 0 && (
                  <span style={{ marginLeft:'auto', background:'#dc2626', color:'#fff',
                    borderRadius:99, fontSize:10, fontWeight:800, padding:'1px 6px', minWidth:18, textAlign:'center' }}>
                    {stats.pendingOT}
                  </span>
                )}
              </div>
            )}

            {/* Missing Attendance Requests — everyone (submit own / act on assigned) */}
            <div className="tm-dropdown-item" onClick={() => navTo('/attendance/missing-requests')}
              style={{ color: location.pathname === '/attendance/missing-requests' ? '#1a56db' : undefined }}>
              <span>📩</span> {t('Missing Attendance Requests')}
            </div>

            {/* Duty Roster — anyone with dutyRoster view permission */}
            {canView('dutyRoster') && (
              <div className="tm-dropdown-item" onClick={() => navTo('/attendance/roster-dashboard')}
                style={{ color: location.pathname.startsWith('/attendance/roster-dashboard') || location.pathname.startsWith('/attendance/duty-roster') ? '#1a56db' : undefined }}>
                <span>🗓️</span> {t('Duty Roster')}
              </div>
            )}

            {/* Manual Postings — admin only */}
            {canManageSystem && (
              <>
                <div className="tm-dropdown-item" onClick={() => navTo('/attendance/manual-postings')}>
                  <span>✍️</span> {t('Manual Postings')}
                </div>
              </>
            )}

            {/* Empty state for employee when all attendance perms are off */}
            {!hasAnyAttn && !canManageSystem && (
              <div style={{ padding: '12px 16px', fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>
                No attendance pages available
              </div>
            )}

          </div>
        </div>

      </div>

      {/* ── Right side ── */}
      <div className="tm-right">

        {/* Pending approvals bell */}
        {isManager && pendingCount > 0 && (
          <div className="tm-bell" title={`${pendingCount} ${t('Pending Approvals')}`}>
            🔔
            <span className="tm-bell-badge">{pendingCount}</span>
          </div>
        )}

        {/* Language toggle */}
        <button
          className="tm-lang-btn"
          onClick={() => changeLanguage(language === 'np' ? 'en' : 'np')}
          title={language === 'np' ? 'Switch to English' : 'नेपालीमा जानुस'}
        >
          {language === 'np' ? 'EN' : 'ने'}
        </button>

        {/* ── User dropdown ── */}
        <div
          className={`tm-user ${openDropdown === 'user' ? 'open' : ''}`}
          onClick={() => toggleDropdown('user')}
        >
          <div className="tm-avatar" style={{ background: avatarBg[currentUser?.role], color: roleColor[currentUser?.role] }}>
            {currentUser?.avatar}
          </div>
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
              <span>👤</span> {t('Profile')}
            </div>

            {/* Settings, License, Backup, Role Management — admin only */}
            {canManageSystem && (
              <>
                <div className="tm-dropdown-item" onClick={() => navigate('/settings')}>
                  <span>⚙️</span> {t('Settings')}
                </div>
                <div className="tm-dropdown-item" onClick={() => navigate('/settings/license')}>
                  <span>🔑</span> {t('License')}
                </div>
                <div className="tm-dropdown-item" onClick={() => navigate('/settings/roles')}>
                  <span>🔐</span> {t('Role & Permissions')}
                </div>
                <div className="tm-dd-divider"></div>
                <div className="tm-dropdown-item" onClick={() => navigate('/settings?tab=database')}>
                  <span>🗄️</span> {t('Backup & Restore')}
                </div>
                <div className="tm-dd-divider"></div>
              </>
            )}
            <div className="tm-dropdown-item danger" onClick={handleLogout}>
              <span>🚪</span> {t('Logout')}
            </div>
          </div>
        </div>

      </div>
    </nav>
  );
};

export default TopMenu;
