import React, { useEffect, useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../api/client.js';
import { useModuleFlags } from '../context/ModuleFlagsContext.jsx';
import { useOnlineAttendanceApply } from '../context/OnlineAttendanceApplyContext.jsx';
import { biometricConfirm } from '../utils/native.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useSettings } from '../context/SettingsContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { Icon, useMT } from './kit.jsx';
import SelectPicker from './SelectPicker.jsx';
import { useMyApprovals, useUnreadCount, useExtraRequests } from './hooks.js';
import { useNotifications } from '../components/Notifications/AttendanceToasts.jsx';
import { useUnseenAlert, unlockAudioOnFirstTouch } from '../hooks/useBeepAlert.js';
import './mobile.css';

/* The phone app frame: coloured top bar, content area, bottom tab bar. Replaces the desktop top menu inside the Android app
   (and any browser opened with ?mobile=1). Pages that have no phone design yet are shown inside it with a back button. */

const TABS = [
  { key: 'home',       path: '/m/home',       icon: 'home',  label: 'Home' },
  { key: 'attendance', path: '/m/attendance', icon: 'cal',   label: 'Attendance' },
  { key: 'leave',      path: '/m/leave',      icon: 'leave', label: 'Leave' },
  { key: 'inbox',      path: '/m/inbox',      icon: 'inbox', label: 'Inbox' },
  { key: 'visit',      path: '/staff/field-visit', icon: 'pin', label: 'Field Visit' },
  { key: 'more',       path: '/m/more',       icon: 'more',  label: 'More' },
];
const TITLES = { '/m/inbox': 'Notices', '/m/roster': 'Duty Roster', '/m/devices': 'Device Management', '/m/approvals': 'Approvals', '/payroll/my': 'My Payslips', '/payroll/dashboard': 'Payroll', '/profile': 'Profile', '/staff/message': 'Messages', '/leave/apply': 'Apply Leave', '/office-visit/apply': 'Office Visit', '/staff/task': 'Tasks', '/staff/field-visit': 'Field Visit' };

export default function MobileFrame({ children }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { currentUser, canView } = useAuth();
  const { settings } = useSettings();
  const { language } = useLanguage();
  const mt = useMT();
  const [unread] = useUnreadCount(pathname);
  const approvals = useMyApprovals();
  const extra = useExtraRequests();
  const pendingApprovals = approvals.leaves.length + approvals.visits.length + extra.manualToApprove.length + extra.onlineToApprove.length + extra.missingToApprove.length;

  // Sound + blink until the user has looked: unread notices (leave / visit / OT / online / late-early / roster / task messages)
  // and approvals waiting for me. Opening the Approvals page counts as having seen what was waiting then.
  const [apprSeen, setApprSeen] = useState(0);
  useEffect(() => { unlockAudioOnFirstTouch(); }, []);
  useEffect(() => { if (pathname.startsWith('/m/approvals')) setApprSeen(pendingApprovals); }, [pathname, pendingApprovals]);
  const apprUnseen = Math.max(0, pendingApprovals - apprSeen);
  const noti = useNotifications();
  const taskUnseen = (noti?.taskCount || 0) + (noti?.fieldVisitTaskCount || 0);
  useEffect(() => { const t = setInterval(() => noti?.refreshTaskCounts?.(), 60000); return () => clearInterval(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useUnseenAlert(unread + apprUnseen + taskUnseen, 60000);

  // Middle button: biometric-confirmed online check-in / check-out, only when online attendance is switched on for this user
  const { flags } = useModuleFlags();
  const { open: openOnline, isOpen: onlineOpen } = useOnlineAttendanceApply();
  const onlineOn = !!flags.onlineAttendanceEnabled && !!currentUser?.onlineAttendanceEnabled;
  const [checkedIn, setCheckedIn] = useState(false);
  const [fabMsg, setFabMsg] = useState('');
  const loadToday = useCallback(() => {
    if (!onlineOn) return;
    api.get('/online-attendance/today').then(r => setCheckedIn(!!(r?.check_in_at || r?.checkInAt) && !(r?.check_out_at || r?.checkOutAt))).catch(() => {});
  }, [onlineOn]);
  useEffect(() => { loadToday(); }, [loadToday]);
  useEffect(() => { if (!onlineOpen) loadToday(); }, [onlineOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const punch = async () => {
    const r = await biometricConfirm(checkedIn ? 'Confirm to check out' : 'Confirm to check in');
    if (!r.ok) { setFabMsg(mt('Not confirmed — please try again')); setTimeout(() => setFabMsg(''), 3000); return; }
    openOnline();
  };
  const visitOn = !!flags.taskEnabled && canView('task');
  const lastTab = visitOn ? TABS[4] : TABS[3];     // Field Visit (or Inbox when the Task module is off)
  const tabs = onlineOn
    ? [TABS[0], TABS[2], { key: 'fab' }, lastTab, TABS[5]]
    : [TABS[0], TABS[1], TABS[2], lastTab, TABS[5]];
  const [visitUnseen, setVisitUnseen] = useState(0);
  useEffect(() => {
    if (!visitOn) return undefined;
    const load = () => api.get('/tasks/notifications/count').then(r => setVisitUnseen(Number(r?.fieldVisitCount) || 0)).catch(() => {});
    load(); const t = setInterval(load, 60000); return () => clearInterval(t);
  }, [visitOn, pathname]);

  // iPhone Home-Screen app only: an optional full-height layout, switched on from More → Screen info (a device setting).
  useEffect(() => {
    const el = document.documentElement;
    const apply = () => {
      let mode = ''; try { mode = localStorage.getItem('ehajiri_ios_h') || ''; } catch { /* ignore */ }
      if (/[?&]iosh=0/.test(window.location.search)) { try { localStorage.removeItem('ehajiri_ios_h'); } catch { /* ignore */ } mode = ''; }   // escape hatch: add ?iosh=0 to the address
      if (window.navigator.standalone !== true || !mode) { el.removeAttribute('data-ios-h'); el.style.removeProperty('--m-app-h'); return; }
      const h = { vh: '100vh', lvh: '100lvh', screen: Math.max(window.screen.height, window.screen.width) + 'px' }[mode];
      if (!h) return;
      el.setAttribute('data-ios-h', mode); el.style.setProperty('--m-app-h', window.innerHeight >= window.innerWidth ? h : '100vh');
    };
    apply(); window.addEventListener('ehajiri:ios-h', apply); window.addEventListener('orientationchange', apply);
    return () => { window.removeEventListener('ehajiri:ios-h', apply); window.removeEventListener('orientationchange', apply); };
  }, []);

  useEffect(() => { document.documentElement.classList.add('mobile-mode'); return () => document.documentElement.classList.remove('mobile-mode'); }, []);

  const tab = TABS.find(t => pathname.startsWith(t.path) && (t.key === 'visit' ? visitOn : t.key === 'inbox' ? !visitOn : true));
  const flush = !tab || tab.key === 'visit';           // the Field Visit page pads itself
  const padded = !!tab || pathname === '/m/inbox';
  const company = (language === 'np' ? settings.companyNameNp : settings.companyNameEn) || settings.companyNameEn || settings.companyNameNp || 'eHajiri';
  const logo = settings.companyLogo;
  const first = (currentUser?.fullName || '').split(' ')[0];
  const subTitle = tab ? null : (TITLES[pathname] || 'eHajiri');

  return (
    <div className="m-app">
      <div className="m-header">
        {tab ? (
          <>
            <div className="m-logo" role="link" style={{ cursor: 'pointer' }} onClick={() => navigate('/m/home')}>{logo ? <img src={logo} alt="" /> : 'EH'}</div>
            <div className="m-title" role="link" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => navigate('/m/home')} onKeyDown={(e) => { if (e.key === 'Enter') navigate('/m/home'); }}><div className="m-ell">{company}</div><div className="m-sub m-ell">{[first, currentUser?.position || currentUser?.department].filter(Boolean).join(' · ')}</div></div>
            <button className="m-icon-btn" aria-label="Inbox" onClick={() => navigate('/m/inbox')}>
              <span className={unread > 0 ? 'm-bell-on' : ''} style={{ display: 'inline-flex' }}><Icon name="bell" size={22} /></span>{unread > 0 && <span className="m-dot">{unread > 9 ? '9+' : unread}</span>}
            </button>
          </>
        ) : (
          <>
            <button className="m-icon-btn" aria-label="Back" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/m/home'))}><Icon name="back" size={22} /></button>
            <div className="m-title m-ell">{mt(subTitle)}</div>
          </>
        )}
      </div>

      <div className={padded && !(tab && flush) ? 'm-content' : 'm-content m-flush'}>
        {padded ? children : <div className="m-legacy">{children}</div>}
      </div>

      <SelectPicker />
      {fabMsg && <div className="m-toast" role="status">{fabMsg}</div>}
      <nav className="m-tabs" aria-label="Main">
        {tabs.map((t) => {
          if (t.key === 'fab') {
            return (
              <button key="fab" className="m-tab m-fab-slot" onClick={punch} aria-label={checkedIn ? 'Check out' : 'Check in'}>
                <span className={`m-fab${checkedIn ? ' out' : ''}`}><Icon name="finger" size={30} /></span>
                <span className="m-fab-label">{mt(checkedIn ? 'Check Out' : 'Check In')}</span>
              </button>
            );
          }
          const on = tab?.key === t.key;
          const badge = t.key === 'inbox' ? unread : t.key === 'leave' ? pendingApprovals : t.key === 'visit' ? visitUnseen : 0;
          return (
            <button key={t.key} className={`m-tab${on ? ' on' : ''}`} onClick={() => navigate(t.path)} aria-current={on ? 'page' : undefined}>
              <span className="m-tab-ico"><Icon name={t.icon} /></span>
              {mt(t.label)}
              {badge > 0 && <span className="m-badge">{badge > 9 ? '9+' : badge}</span>}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
