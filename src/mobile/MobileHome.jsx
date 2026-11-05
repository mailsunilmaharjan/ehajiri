import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useModuleFlags } from '../context/ModuleFlagsContext.jsx';
import { useLeaveApply } from '../context/LeaveApplyContext.jsx';
import { useOfficeVisitApply } from '../context/OfficeVisitApplyContext.jsx';
import { useManualPostingApply } from '../context/ManualPostingApplyContext.jsx';
import { useMissingAttendanceApply } from '../context/MissingAttendanceApplyContext.jsx';
import { useOnlineAttendanceApply } from '../context/OnlineAttendanceApplyContext.jsx';
import useDateFormat from '../hooks/useDateFormat.js';
import { getNepalTodayISO, adToBS, BS_MONTHS_EN, BS_MONTHS_NP, toNepaliDigits } from '../utils/dateUtils.js';
import { useLanguage } from '../context/LanguageContext.jsx';
import { Icon, useMT } from './kit.jsx';
import { useMyLeaveBalance, useMyApprovals, useExtraRequests, monthRange } from './hooks.js';
import { useSettings } from '../context/SettingsContext.jsx';
import { useTaskAssignedBeepAlert } from '../hooks/useBeepAlert.js';

const hhmm = (v) => { if (!v) return ''; const d = new Date(v); return isNaN(d) ? String(v).slice(0, 5) : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }); };

export default function MobileHome() {
  const navigate = useNavigate();
  const mt = useMT();
  const fd = useDateFormat();
  const { language } = useLanguage();
  const { currentUser, canView } = useAuth();
  const { flags } = useModuleFlags();
  const { open: openLeave } = useLeaveApply();
  const { open: openVisit } = useOfficeVisitApply();
  const { open: openManual } = useManualPostingApply();
  const { open: openOnline, isOpen: onlineOpen } = useOnlineAttendanceApply();
  const missing = useMissingAttendanceApply();
  const balances = useMyLeaveBalance();
  const approvals = useMyApprovals();
  const extra = useExtraRequests();

  const [day, setDay] = useState(null);         // today's row from the staff ledger (office device / manual punches)
  const [online, setOnline] = useState(null);   // today's online attendance record
  const onlineOn = !!flags.onlineAttendanceEnabled && !!currentUser?.onlineAttendanceEnabled;

  const today = getNepalTodayISO();
  const load = useCallback(() => {
    if (!currentUser?.id) return;
    api.get(`/attendance/staff-ledger?employeeId=${currentUser.id}&startDate=${today}&endDate=${today}`).then(r => setDay(r?.days?.[0] || null)).catch(() => {});
    if (onlineOn) api.get('/online-attendance/today').then(setOnline).catch(() => {});
  }, [currentUser?.id, today, onlineOn]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!onlineOpen) load(); }, [onlineOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // yesterday's punch, late-in / early-out this month, notices and tasks
  const { settings } = useSettings();
  const [ledger, setLedger] = useState([]);
  const [notices, setNotices] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [taskUnread, setTaskUnread] = useState(0);
  const yesterday = (() => { const d = new Date(today + 'T00:00:00'); d.setDate(d.getDate() - 1); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; })();
  const cal = settings.defaultCalendar === 'np' ? 'np' : 'en';
  const monthStart = monthRange(0, cal).start;
  useEffect(() => {
    if (!currentUser?.id) return;
    const start = [monthStart, yesterday].sort()[0];
    api.get(`/attendance/staff-ledger?employeeId=${currentUser.id}&startDate=${start}&endDate=${today}`).then(r => setLedger(r?.days || [])).catch(() => {});
    api.get('/messages').then(r => setNotices(Array.isArray(r) ? r : [])).catch(() => {});
    if (canView('task')) {
      api.get('/tasks').then(r => setTasks(Array.isArray(r) ? r : [])).catch(() => {});
      api.get('/tasks/notifications/count').then(r => setTaskUnread((r?.count || 0) + (r?.fieldVisitCount || 0))).catch(() => {});
    }
  }, [currentUser?.id, today, yesterday, monthStart]); // eslint-disable-line react-hooks/exhaustive-deps
  const yDay = ledger.find(d => d.dateStr === yesterday);
  const lateDays = ledger.filter(d => d.dateStr >= monthStart && d.lateMins > 0);
  const earlyDays = ledger.filter(d => d.dateStr >= monthStart && d.earlyMins > 0);
  const [taskSeg, setTaskSeg] = useState('task');
  const openTasksAll = tasks.filter(t => !['completed', 'cancelled'].includes(t.status));
  const openTasks = openTasksAll.filter(t => !!t.isFieldVisit === (taskSeg === 'visit')).slice(0, 3);
  const segUnseen = (v) => tasks.filter(t => !!t.isFieldVisit === (v === 'visit') && t.hasUnreadNotification).length;
  const unreadNotices = notices.filter(n => !n.is_read && !/^duty roster/i.test(n.subject || '')).length;
  const rosterNew = notices.filter(n => !n.is_read && /^duty roster/i.test(n.subject || '')).length;
  useTaskAssignedBeepAlert(rosterNew > 0);   // 5 beeps when a new roster arrives, then a soft reminder until it is opened
  const shortDate = (iso) => fd(iso);   // in the company's calendar (Nepali BS or English AD)
  const hm = (s) => String(s || '').replace(/^(Late By|Early Out)\s*/i, '');
  const noticeText = (h = '') => String(h).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

  const hour = Number(new Date().toLocaleString('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kathmandu' }));
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const bs = adToBS(today);
  const npLang = language === 'np';
  const dg = (n) => (npLang ? toNepaliDigits(n) : String(n));
  const bsText = bs ? `${dg(bs.day)} ${(npLang ? BS_MONTHS_NP : BS_MONTHS_EN)[bs.month - 1]} ${dg(bs.year)}` : '';
  const todayD = new Date(today + 'T00:00:00');
  const WD_NP_FULL = ['आइतबार', 'सोमबार', 'मंगलबार', 'बुधबार', 'बिहीबार', 'शुक्रबार', 'शनिबार'];
  const adText = npLang
    ? `${toNepaliDigits(todayD.getDate())} ${todayD.toLocaleDateString('en-GB', { month: 'long' })} ${toNepaliDigits(todayD.getFullYear())}`
    : todayD.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  // the company's own calendar comes first: Nepali (BS) when that is the default, else English (AD)
  const dateLine = settings.defaultCalendar === 'np'
    ? `${npLang ? WD_NP_FULL[todayD.getDay()] + ', ' : ''}${bsText} · ${adText}`
    : `${adText} · ${bsText}`;

  // today's attendance line
  const punched = day && day.timeIn;
  const status = day?.status;
  let todayLine = mt('Not punched yet'), dot = 'off';
  if (punched) { todayLine = `${mt('Present')} · ${hhmm(day.timeIn)}${day.timeOut ? ' – ' + hhmm(day.timeOut) : ''}`; dot = ''; }
  else if (online?.check_in_at || online?.checkInAt) { todayLine = `${mt('Checked in')} · ${hhmm(online.check_in_at || online.checkInAt)}`; dot = ''; }
  else if (status && !['Absent'].includes(status)) { todayLine = status; dot = 'off'; }
  else if (status === 'Absent' && hour >= 14) { todayLine = mt('Absent'); dot = 'bad'; }

  const checkedIn = !!(online?.check_in_at || online?.checkInAt);
  const checkedOut = !!(online?.check_out_at || online?.checkOutAt);
  const pending = approvals.leaves.length + approvals.visits.length + extra.manualToApprove.length + extra.onlineToApprove.length + extra.missingToApprove.length;

  const actions = [
    flags.dutyRosterEnabled && canView('dutyRoster') && { label: 'Duty Roster', icon: '🗓️', bg: '#e0e7ff', fn: () => navigate('/m/roster'), badge: rosterNew },
    canView('leaveApply') && { label: 'Apply Leave', icon: '📝', bg: '#ede9fe', fn: openLeave },
    canView('officeVisitApply') && { label: 'Office Visit', icon: '🏢', bg: '#ccfbf1', fn: openVisit },
    canView('manualPostingApply') && { label: 'Late / Early', icon: '⏱️', bg: '#fef3c7', fn: openManual },
    missing && canView('missingAttendanceApply') && { label: 'Missing punch', icon: '🧾', bg: '#fee2e2', fn: missing.open },
  ].filter(Boolean);

  return (
    <>
      <div className="m-hero">
        <div className="m-hello">{mt(greet)}, {(currentUser?.fullName || '').split(' ')[0]} 👋</div>
        <div className="m-date">{dateLine}</div>
        <div className="m-today">
          <span className={`m-pulse ${dot}`} />
          <div className="m-grow"><div className="m-muted" style={{ color: 'rgba(255,255,255,.8)', fontSize: 12 }}>{mt('Today')}</div><b>{todayLine}</b></div>
          {day?.lateFormatted && /late/i.test(day.lateFormatted) && <span className="m-chip warn">{day.lateFormatted}</span>}
        </div>
      </div>

      {onlineOn && checkedOut && (
        <div className="m-donepill"><span>✅</span>{mt('Done for today')}</div>
      )}
      {onlineOn && !checkedOut && (
        <button className={`m-checkin ${checkedOut ? 'done' : checkedIn ? 'out' : 'in'}`} onClick={() => openOnline()} disabled={checkedOut}>
          <span className="m-ci-ico">{checkedOut ? '✅' : checkedIn ? '🚪' : '📍'}</span>
          <span className="m-grow">
            <b>{checkedOut ? mt('Done for today') : checkedIn ? mt('Check Out') : mt('Check In')}</b>
            <span>{checkedOut ? '' : checkedIn ? `${mt('Checked in')} ${hhmm(online.check_in_at || online.checkInAt)}` : 'Records your location'}</span>
          </span>
          {!checkedOut && <Icon name="chev" />}
        </button>
      )}

      {pending > 0 && (
        <button className="m-alert" onClick={() => navigate('/m/approvals')}>
          <span style={{ fontSize: 22 }}>⏳</span><span className="m-grow">{pending} {mt('Pending approvals')}</span><Icon name="chev" />
        </button>
      )}

      <div className="m-dcard">
        <div className="m-dcard-h"><b>{mt('Yesterday')} · {shortDate(yesterday)}</b><button onClick={() => navigate('/m/attendance')}>{mt('View Reports')}</button></div>
        {yDay && (yDay.timeIn || yDay.timeOut) ? (
          <div className="m-ypunch">
            <div><span>{mt('In')}</span><b>{hhmm(yDay.timeIn) || '–'}</b></div>
            <div><span>{mt('Out')}</span><b>{hhmm(yDay.timeOut) || '–'}</b></div>
            {yDay.lateMins > 0 && <div className="late"><span>{mt('Late in')}</span><b>{hm(yDay.lateFormatted) || yDay.lateMins + 'm'}</b></div>}
            {yDay.earlyMins > 0 && <div className="early"><span>{mt('Early out')}</span><b>{hm(yDay.earlyFormatted) || yDay.earlyMins + 'm'}</b></div>}
          </div>
        ) : <div className="m-muted">{yDay?.status ? yDay.status : mt('No punch recorded')}</div>}
      </div>

      <div className="m-dcard">
        <div className="m-dcard-h"><b>{mt('Late in & Early out')} · {mt('this month')}</b></div>
        <div className="m-ypunch">
          <div className="late"><span>{mt('Late in')}</span><b>{lateDays.length}</b></div>
          <div className="early"><span>{mt('Early out')}</span><b>{earlyDays.length}</b></div>
        </div>
        {[...lateDays.map(d => ({ d, k: 'late' })), ...earlyDays.map(d => ({ d, k: 'early' }))].sort((a, b) => b.d.dateStr.localeCompare(a.d.dateStr)).slice(0, 4).map(({ d, k }) => (
          <div key={d.dateStr + k} className="m-mini" style={{ cursor: 'default' }}>
            <span className="m-grow">{shortDate(d.dateStr)}</span>
            <span className={`m-pill ${k === 'late' ? 'warn' : 'bad'}`}>{k === 'late' ? mt('Late in') + ' ' + (hm(d.lateFormatted) || d.lateMins + 'm') : mt('Early out') + ' ' + (hm(d.earlyFormatted) || d.earlyMins + 'm')}</span>
          </div>
        ))}
      </div>

      {canView('task') && (
        <div className="m-dcard">
          <div className="m-dcard-h"><b>{mt('Tasks')}{taskUnread > 0 && <span className="m-badge" style={{ position: 'static', display: 'inline-flex', marginLeft: 8 }}>{taskUnread}</span>}</b><button onClick={() => navigate(taskSeg === 'visit' ? '/staff/field-visit' : '/staff/task')}>{mt('View all')}</button></div>
          <div className="m-seg m-seg4" style={{ marginBottom: 8 }}>
            {[['task', 'Task'], ['visit', 'Field Visit']].map(([k, l]) => <button key={k} className={taskSeg === k ? 'on' : ''} onClick={() => setTaskSeg(k)}>{mt(l)}{segUnseen(k) > 0 && <i className="m-seg-n">{segUnseen(k)}</i>}</button>)}
          </div>
          {openTasks.length === 0 && <div className="m-muted">{taskSeg === 'visit' ? mt('No open field visits') : mt('No open tasks')}</div>}
          {openTasks.map(t => {
            const overdue = t.dueDate && String(t.dueDate).slice(0, 10) < today;
            return (
              <button key={t.id} className={`m-mini${t.hasUnreadNotification ? ' m-blink' : ''}`} onClick={() => navigate(t.isFieldVisit ? '/staff/field-visit' : '/staff/task')}>
                <span className="m-grow"><b className="m-ell" style={{ display: 'block' }}>{t.title}</b><span className="m-muted m-ell" style={{ display: 'block', fontSize: 12 }}>{t.customerName || t.status}</span></span>
                {t.dueDate && <span className={`m-pill ${overdue ? 'bad' : ''}`}>{shortDate(String(t.dueDate).slice(0, 10))}</span>}
              </button>
            );
          })}
        </div>
      )}

      <div className="m-dcard">
        <div className="m-dcard-h"><b>{mt('Notices')}{unreadNotices > 0 && <span className="m-badge" style={{ position: 'static', display: 'inline-flex', marginLeft: 8 }}>{unreadNotices}</span>}</b><button onClick={() => navigate('/m/inbox')}>{mt('View all')}</button></div>
        {notices.length === 0 && <div className="m-muted">{mt('No notices yet')}</div>}
        {notices.slice(0, 3).map(n => (
          <button key={n.id} className={`m-mini${!n.is_read ? ' m-blink' : ''}`} onClick={() => navigate('/m/inbox')}>
            {!n.is_read && <span className="m-unread-dot" />}
            <span className="m-grow"><b className="m-ell" style={{ display: 'block' }}>{n.subject || n.sender_name}</b><span className="m-muted m-ell" style={{ display: 'block', fontSize: 12 }}>{noticeText(n.body).slice(0, 80)}</span></span>
            {n.created_at && <span className="m-pill">{shortDate(String(n.created_at).slice(0, 10))}</span>}
          </button>
        ))}
      </div>

      {actions.length > 0 && (<>
        <div className="m-h2">{mt('Quick actions')}</div>
        <div className="m-grid">
          {actions.map(a => (
            <button key={a.label} className="m-tile" onClick={() => a.fn()}>
              <span className="m-t-ico" style={{ background: a.bg }}>{a.icon}</span>{mt(a.label)}{a.badge > 0 && <i className="m-redot">{a.badge}</i>}
            </button>
          ))}
        </div>
      </>)}

      {balances.length > 0 && (<>
        <div className="m-h2">{mt('Leave balance')}</div>
        <div className="m-balances">
          {balances.map(b => (
            <div key={b.code} className="m-bal" style={{ borderTop: `4px solid ${b.color || '#1a56db'}` }}>
              <b>{Number.isInteger(b.balance) ? b.balance : b.balance.toFixed(1)}</b><span className="m-ell" style={{ display: 'block' }}>{b.name}</span>
            </div>
          ))}
        </div>
      </>)}
    </>
  );
}
