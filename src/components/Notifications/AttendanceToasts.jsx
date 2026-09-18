import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import { useBeepAlert, useTaskAssignedBeepAlert } from '../../hooks/useBeepAlert.js';
import api, { apiUrl } from '../../api/client.js';

/* ── Notification Context ──────────────────────────────────── */
const NotiCtx = createContext({ add: () => {}, remove: () => {}, msgCount: 0, clearMsgCount: () => {}, taskCount: 0, clearTaskCount: () => {}, fieldVisitTaskCount: 0, clearFieldVisitTaskCount: () => {}, refreshTaskCounts: () => {}, clearTaskAlert: () => {} });
export const useNotifications = () => useContext(NotiCtx);

/* ── Attendance Toast Card ─────────────────────────────────── */
const AttendanceToast = ({ noti, onClose }) => {
  const isLate  = noti.remarks?.startsWith('Late');
  const isEarly = noti.remarks?.startsWith('Early In');

  return (
    <div style={{
      width: 320, background: 'white',
      borderRadius: 12, overflow: 'hidden',
      boxShadow: '0 8px 32px rgba(0,0,0,.20)',
      border: '1px solid #e5e7eb',
      borderLeft: `4px solid ${isLate ? '#dc2626' : isEarly ? '#059669' : '#1a56db'}`,
      animation: 'slideIn .25s ease-out',
    }}>
      <div style={{ display:'flex', alignItems:'center', gap:8,
        padding:'8px 10px 6px', background:'#f9fafb', borderBottom:'1px solid #f3f4f6' }}>
        <svg viewBox="0 0 20 20" fill="#1a56db" width="14" height="14">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd"/>
        </svg>
        <span style={{ fontSize:11, fontWeight:700, color:'#6b7280', flex:1 }}>eHajiri · Live Attendance</span>
        <button onClick={() => onClose(noti.id)}
          style={{ background:'none', border:'none', cursor:'pointer', padding:'2px 4px',
            color:'#9ca3af', fontSize:16, lineHeight:1, borderRadius:4 }}>✕</button>
      </div>
      <div style={{ padding:'12px 14px 14px' }}>
        <div style={{ fontSize:17, fontWeight:800, color:'#111827', marginBottom:4 }}>{noti.staffName}</div>
        <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:8 }}>
          {noti.postShort   && <span style={{ fontSize:12, fontWeight:600, color:'#0369a1', background:'#eff6ff', borderRadius:5, padding:'1px 7px' }}>{noti.postShort}</span>}
          {noti.branchShort && <span style={{ fontSize:12, fontWeight:600, color:'#7c3aed', background:'#f5f3ff', borderRadius:5, padding:'1px 7px' }}>{noti.branchShort}</span>}
        </div>
        <div style={{ fontSize:13, color:'#374151', marginBottom: noti.remarks ? 6 : 0 }}>
          <span style={{ color:'#6b7280', fontWeight:500 }}>Time IN: </span>
          <strong style={{ fontFamily:'monospace', fontSize:14, color:'#1a56db' }}>{noti.timeIn}</strong>
        </div>
        {noti.remarks && (
          <div style={{ fontSize:12, fontWeight:700, color: isLate ? '#dc2626' : '#059669',
            background: isLate ? '#fff5f5' : '#f0fdf4',
            border: `1px solid ${isLate ? '#fca5a5' : '#86efac'}`,
            borderRadius:6, padding:'3px 9px', display:'inline-block', marginTop:2 }}>
            {isLate ? '⚠ ' : '✓ '}{noti.remarks}
          </div>
        )}
      </div>
      <div style={{ padding:'0 14px 12px' }}>
        <button onClick={() => onClose(noti.id)}
          style={{ width:'100%', padding:'6px 0', border:'1px solid #e5e7eb',
            borderRadius:7, background:'white', color:'#374151', fontSize:12, fontWeight:600, cursor:'pointer' }}>
          Close
        </button>
      </div>
    </div>
  );
};

/* ── Message Toast Card ────────────────────────────────────── */
const MessageToast = ({ noti, onClose }) => (
  <div style={{
    width: 320, background: 'white',
    borderRadius: 12, overflow: 'hidden',
    boxShadow: '0 8px 32px rgba(0,0,0,.20)',
    border: '1px solid #e5e7eb',
    borderLeft: '4px solid #7c3aed',
    animation: 'slideIn .25s ease-out',
  }}>
    <div style={{ display:'flex', alignItems:'center', gap:8,
      padding:'8px 10px 6px', background:'#faf5ff', borderBottom:'1px solid #f3e8ff' }}>
      <span style={{ fontSize:14 }}>✉</span>
      <span style={{ fontSize:11, fontWeight:700, color:'#6d28d9', flex:1 }}>New Message</span>
      <button onClick={() => onClose(noti.id)}
        style={{ background:'none', border:'none', cursor:'pointer', padding:'2px 4px',
          color:'#9ca3af', fontSize:16, lineHeight:1 }}>✕</button>
    </div>
    <div style={{ padding:'12px 14px 14px' }}>
      <div style={{ fontSize:12, color:'#6b7280', marginBottom:4 }}>
        From: <strong style={{ color:'#374151' }}>{noti.senderName}</strong>
      </div>
      <div style={{ fontSize:14, fontWeight:700, color:'#1f2937', marginBottom:6 }}>
        {noti.subject}
      </div>
      {noti.preview && (
        <div style={{ fontSize:12, color:'#6b7280', lineHeight:1.4,
          overflow:'hidden', display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical' }}>
          {noti.preview}
        </div>
      )}
    </div>
    <div style={{ padding:'0 14px 12px', display:'flex', gap:8 }}>
      <button onClick={() => onClose(noti.id)}
        style={{ flex:1, padding:'6px 0', border:'1px solid #e5e7eb',
          borderRadius:7, background:'white', color:'#374151', fontSize:12, fontWeight:600, cursor:'pointer' }}>
        Dismiss
      </button>
      <button onClick={() => { onClose(noti.id); window.location.hash = '#/staff/message'; }}
        style={{ flex:1, padding:'6px 0', border:'none',
          borderRadius:7, background:'#7c3aed', color:'white', fontSize:12, fontWeight:600, cursor:'pointer' }}>
        View
      </button>
    </div>
  </div>
);

/* ── Task Toast Card — a task was assigned, completed, or its status/
   description changed. Goes to whoever's actually on the task (creator,
   every assignee), plus Admin/superAdmin and the Department Head of any
   assignee's department (see resolveTaskAudience in server/routes/tasks.js)
   — so the header text stays audience-neutral rather than "...to You". ── */
const TASK_EVENT_META = {
  assigned:            { icon: '📋', label: 'Task Assigned',       verb: 'Assigned',  color: '#1d4ed8', accent: '#1a56db', bg: '#eff6ff', border: '#dbeafe' },
  completed:           { icon: '✅', label: 'Task Completed',      verb: 'Completed', color: '#16a34a', accent: '#16a34a', bg: '#f0fdf4', border: '#dcfce7' },
  status_changed:      { icon: '🔄', label: 'Task Status Updated', verb: 'Updated',   color: '#b45309', accent: '#d97706', bg: '#fffbeb', border: '#fde68a' },
  description_changed: { icon: '📝', label: 'Task Updated',        verb: 'Updated',   color: '#6d28d9', accent: '#7c3aed', bg: '#faf5ff', border: '#e9d5ff' },
  followup_added:      { icon: '📞', label: 'New Followup',        verb: 'Logged',    color: '#0e7490', accent: '#0891b2', bg: '#ecfeff', border: '#cffafe' },
};

const TaskToast = ({ noti, onClose }) => {
  const navigate = useNavigate();
  const { refreshTaskCounts, clearTaskAlert } = useNotifications();
  const meta = TASK_EVENT_META[noti.event] || TASK_EVENT_META.assigned;
  const detail = noti.event === 'status_changed' && noti.status
    ? `Marked ${noti.status.replace('_', ' ')} by `
    : `${meta.verb} by `;
  // Closing this popup at all — ✕, Dismiss, or View — counts as "seen it",
  // same as opening the task itself in TaskList.jsx (see markTaskRead there).
  // Without this, dismissing the popup left the underlying notification
  // unread server-side, so the nav badge and the beep alert (driven by
  // newTaskAlertIds, see the provider below) kept going even after every
  // popup the user could see had already been closed.
  const dismiss = () => {
    onClose(noti.id);
    clearTaskAlert(noti.taskId);
    api.post(`/tasks/${noti.taskId}/notifications/read`).then(refreshTaskCounts).catch(() => {});
  };
  return (
    <div style={{
      width: 320, background: 'white',
      borderRadius: 12, overflow: 'hidden',
      boxShadow: '0 8px 32px rgba(0,0,0,.20)',
      border: '1px solid #e5e7eb',
      borderLeft: `4px solid ${meta.accent}`,
      animation: 'slideIn .25s ease-out',
    }}>
      <div style={{ display:'flex', alignItems:'center', gap:8,
        padding:'8px 10px 6px', background: meta.bg,
        borderBottom: `1px solid ${meta.border}` }}>
        <span style={{ fontSize:14 }}>{meta.icon}</span>
        <span style={{ fontSize:11, fontWeight:700, color: meta.color, flex:1 }}>
          {meta.label}
        </span>
        <button onClick={dismiss}
          style={{ background:'none', border:'none', cursor:'pointer', padding:'2px 4px',
            color:'#9ca3af', fontSize:16, lineHeight:1 }}>✕</button>
      </div>
      <div style={{ padding:'12px 14px 14px' }}>
        <div style={{ fontSize:14, fontWeight:700, color:'#1f2937', marginBottom:4 }}>{noti.title}</div>
        <div style={{ fontSize:12, color:'#6b7280' }}>
          {detail}<strong style={{ color:'#374151' }}>{noti.by}</strong>
        </div>
      </div>
      <div style={{ padding:'0 14px 12px', display:'flex', gap:8 }}>
        <button onClick={dismiss}
          style={{ flex:1, padding:'6px 0', border:'1px solid #e5e7eb',
            borderRadius:7, background:'white', color:'#374151', fontSize:12, fontWeight:600, cursor:'pointer' }}>
          Dismiss
        </button>
        <button onClick={() => {
            dismiss();
            // A brand-new assignment opens straight into the Task form itself
            // (nothing to follow up on yet); every other event — completed,
            // status/description changed, a new followup logged — opens the
            // Followup History panel instead, since that's what actually
            // changed. See TaskList.jsx's openTaskId/openEvent deep-link effect.
            navigate(`/staff/task?openTaskId=${noti.taskId}&openEvent=${encodeURIComponent(noti.event)}`);
          }}
          style={{ flex:1, padding:'6px 0', border:'none',
            borderRadius:7, background: meta.accent, color:'white', fontSize:12, fontWeight:600, cursor:'pointer' }}>
          View
        </button>
      </div>
    </div>
  );
};

/* ── Chat Toast Card — pops up on the recipient's screen for a new chat message ── */
const ChatToast = ({ noti, onClose }) => (
  <div style={{
    width: 320, background: 'white',
    borderRadius: 12, overflow: 'hidden',
    boxShadow: '0 8px 32px rgba(0,0,0,.20)',
    border: '1px solid #e5e7eb',
    borderLeft: '4px solid #22c55e',
    animation: 'slideIn .25s ease-out',
  }}>
    <div style={{ display:'flex', alignItems:'center', gap:8,
      padding:'8px 10px 6px', background:'#f0fdf4', borderBottom:'1px solid #dcfce7' }}>
      <span style={{ fontSize:14 }}>💬</span>
      <span style={{ fontSize:11, fontWeight:700, color:'#16a34a', flex:1 }}>
        {noti.conversationName && noti.conversationName !== noti.senderName ? noti.conversationName : 'New Chat Message'}
      </span>
      <button onClick={() => onClose(noti.id)}
        style={{ background:'none', border:'none', cursor:'pointer', padding:'2px 4px',
          color:'#9ca3af', fontSize:16, lineHeight:1 }}>✕</button>
    </div>
    <div style={{ padding:'12px 14px 14px' }}>
      <div style={{ fontSize:13, fontWeight:700, color:'#1f2937', marginBottom:4 }}>{noti.senderName}</div>
      {noti.preview && (
        <div style={{ fontSize:12.5, color:'#4b5563', lineHeight:1.4,
          overflow:'hidden', display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical' }}>
          {noti.preview}
        </div>
      )}
    </div>
    <div style={{ padding:'0 14px 12px', display:'flex', gap:8 }}>
      <button onClick={() => onClose(noti.id)}
        style={{ flex:1, padding:'6px 0', border:'1px solid #e5e7eb',
          borderRadius:7, background:'white', color:'#374151', fontSize:12, fontWeight:600, cursor:'pointer' }}>
        Dismiss
      </button>
      <button onClick={() => { noti.onView?.(); onClose(noti.id); }}
        style={{ flex:1, padding:'6px 0', border:'none',
          borderRadius:7, background:'#16a34a', color:'white', fontSize:12, fontWeight:600, cursor:'pointer' }}>
        Reply
      </button>
    </div>
  </div>
);

/* ── Toast Container ───────────────────────────────────────── */
const ToastContainer = ({ notifications, onClose }) => {
  if (!notifications.length) return null;
  return (
    <>
      <style>{`
        @keyframes slideIn {
          from { transform: translateX(110%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
      <div style={{ position:'fixed', top:16, right:16, zIndex:9999,
        display:'flex', flexDirection:'column', gap:10, pointerEvents:'none' }}>
        {notifications.map(n => (
          <div key={n.id} style={{ pointerEvents:'all' }}>
            {n.type === 'new_message' ? <MessageToast noti={n} onClose={onClose} />
              : n.type === 'chat_message' ? <ChatToast noti={n} onClose={onClose} />
              : n.type === 'task' ? <TaskToast noti={n} onClose={onClose} />
              : <AttendanceToast noti={n} onClose={onClose} />
            }
          </div>
        ))}
      </div>
    </>
  );
};

/* ── Provider ──────────────────────────────────────────────── */
export function AttendanceNotificationProvider({ children }) {
  const [notifications, setNotifications] = useState([]);
  const [msgCount,      setMsgCount]      = useState(0);
  const [taskCount,     setTaskCount]     = useState(0);
  // Field Visit tasks get their own badge on the Staff dropdown's separate
  // "Field Visit" nav item — mutually exclusive with taskCount (a
  // field-visit task's notification increments only this one, never both),
  // mirroring GET /tasks/notifications/count's own count/fieldVisitCount split.
  const [fieldVisitTaskCount, setFieldVisitTaskCount] = useState(0);
  // Task ids with a live, still-unseen "assigned" or "new followup" event —
  // the only two task events that beep (see useTaskAssignedBeepAlert below);
  // completed/status/description-change events still toast + badge, just
  // silently. Only ever populated by the SSE handler below (never seeded
  // from the notifications/count fetch on mount), so a reload doesn't
  // re-trigger sound for something that arrived in an earlier session.
  const [newTaskAlertIds, setNewTaskAlertIds] = useState(() => new Set());
  const clearTaskAlert = useCallback((taskId) => {
    setNewTaskAlertIds(prev => {
      if (!prev.has(String(taskId))) return prev;
      const next = new Set(prev);
      next.delete(String(taskId));
      return next;
    });
  }, []);
  const esRef = useRef(null);

  // useAuth is available here because AuthProvider wraps everything above Layout
  let currentUser = null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const auth = useAuth();
    currentUser = auth?.currentUser;
  } catch (_) {}

  // Settings → Company Information → "Enable Live Staff Attendance
  // Notifications". Read via a ref so toggling it doesn't have to tear down
  // and reopen the SSE connection — the onmessage handler below just checks
  // the latest value each time an attendance ping arrives.
  const { settings } = useSettings();
  const liveAttendanceEnabledRef = useRef(settings.liveAttendanceNotifications !== false);
  useEffect(() => {
    liveAttendanceEnabledRef.current = settings.liveAttendanceNotifications !== false;
  }, [settings.liveAttendanceNotifications]);

  // Settings → Company Information → "Enable Task Notifications" — defaults
  // on (see DEFAULT_SETTINGS), same as attendance/message notifications;
  // still toggle-able off per company. Task events also fire a native
  // OS-level Notification() when enabled (Task Assigned / Task Completed are
  // worth surfacing even if the tab is in the background), so permission is
  // only requested once the setting is actually on.
  const taskNotificationsEnabledRef = useRef(settings.taskNotifications === true);
  useEffect(() => {
    taskNotificationsEnabledRef.current = settings.taskNotifications === true;
  }, [settings.taskNotifications]);
  useEffect(() => {
    if (settings.taskNotifications === true && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, [settings.taskNotifications]);

  const remove = useCallback((id) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  // Attendance pings are purely informational (someone just punched in) and
  // fire constantly through the day — without an auto-dismiss they just pile
  // up on screen forever until someone manually closes each one. Message/chat
  // toasts stay put since those are actionable (View/Reply) and a user might
  // genuinely need a moment before dealing with them.
  const add = useCallback((data) => {
    const id = Date.now() + Math.random();
    setNotifications(prev => [...prev, { ...data, id }]);
    if (data.type === 'attendance') {
      setTimeout(() => remove(id), 5000);
    }
  }, [remove]);

  const clearMsgCount = useCallback(() => setMsgCount(0), []);
  // Also persists server-side (task_notifications.is_read) so the count
  // stays cleared after a refresh/re-login — previously this only reset
  // this tab's React state, so the badge came right back on the next load
  // even though the user had already seen everything on the Task page.
  const clearTaskCount = useCallback(() => {
    setTaskCount(0);
    api.post('/tasks/notifications/read').catch(() => {});
  }, []);
  // Same as clearTaskCount but scoped to Field Visit tasks only — opening the
  // Field Visit page shouldn't also mark the regular Task page's notifications
  // as read, and vice versa (see the ?scope=fieldVisit handling server-side).
  const clearFieldVisitTaskCount = useCallback(() => {
    setFieldVisitTaskCount(0);
    api.post('/tasks/notifications/read?scope=fieldVisit').catch(() => {});
  }, []);

  // Re-reads the true unread counts from task_notifications — used both to
  // seed them on login/app-startup (below) and to re-sync after TaskList.jsx
  // marks ONE specific task's notifications read (double-clicked open, or a
  // followup logged against it — see markTaskRead there). The badge is meant
  // to keep blinking per-task until that actually happens, not clear in bulk
  // just from opening the Task/Field Visit list page, so there's no local
  // decrement to do here — always re-fetch the real count.
  const refreshTaskCounts = useCallback(() => {
    if (!currentUser?.id) return;
    api.get('/tasks/notifications/count').then(d => {
      setTaskCount(d?.count || 0);
      setFieldVisitTaskCount(d?.fieldVisitCount || 0);
    }).catch(() => {});
  }, [currentUser?.id]);

  // Seed the true unread counts on login (and app startup for an
  // already-logged-in session) — without this, taskCount always started at 0
  // and only ever grew from live SSE events received while this tab stayed
  // open, so anything that happened while offline was invisible even after
  // logging back in.
  useEffect(() => { refreshTaskCounts(); }, [refreshTaskCounts]);

  // Keeps beeping every few seconds while there's at least one unseen broadcast
  // message — stops the instant msgCount is cleared (user opens the inbox).
  useBeepAlert(msgCount > 0);
  // Task notifications use the less-naggy assignment cadence instead (5
  // beeps, then 2 every 5 minutes) — see useTaskAssignedBeepAlert and
  // newTaskAlertIds above. Covers both the regular Task badge and the Field
  // Visit badge alike (isFieldVisit is just which counter/badge a task's
  // event goes to, not a different sound), stopping per-task the instant
  // clearTaskAlert(taskId) runs (task opened/dismissed — see TaskList.jsx
  // and TaskToast above).
  useTaskAssignedBeepAlert(newTaskAlertIds.size > 0);

  useEffect(() => {
    const connect = () => {
      // EventSource can't set an Authorization header, so the token rides along
      // as a query param — authGuard accepts either.
      const token = localStorage.getItem('auth_token');
      if (!token) return;
      const es = new EventSource(apiUrl(`/attendance/live?token=${encodeURIComponent(token)}`));
      esRef.current = es;
      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.type === 'attendance') {
            if (liveAttendanceEnabledRef.current) add(data);
          } else if (data.type === 'new_message') {
            // Show popup only if current user is a recipient
            const uid = currentUser?.id;
            if (uid) {
              const isRecipient =
                data.recipientType === 'all' ||
                (Array.isArray(data.recipientIds) && data.recipientIds.includes(uid));
              if (isRecipient) {
                add(data);
                setMsgCount(c => c + 1);
              }
            }
          } else if (data.type === 'task') {
            const uid = currentUser?.id;
            const isRecipient = uid && Array.isArray(data.recipientIds) && data.recipientIds.includes(uid);
            if (isRecipient && taskNotificationsEnabledRef.current) {
              add(data);
              // Mutually exclusive with taskCount, matching GET /tasks/notifications/count's split.
              if (data.isFieldVisit) setFieldVisitTaskCount(c => c + 1);
              else setTaskCount(c => c + 1);
              // Only these two events are worth an audible alert (see
              // useTaskAssignedBeepAlert) — a brand-new assignment or a new
              // followup on one of your tasks. Status/completion/description
              // changes still toast + badge above, just silently.
              if (data.event === 'assigned' || data.event === 'followup_added') {
                setNewTaskAlertIds(prev => new Set(prev).add(String(data.taskId)));
              }
              if ('Notification' in window && Notification.permission === 'granted') {
                const meta = TASK_EVENT_META[data.event] || TASK_EVENT_META.assigned;
                const verb = data.event === 'status_changed' && data.status
                  ? `Marked ${data.status.replace('_', ' ')}` : meta.verb;
                const n = new Notification(meta.label, {
                  body: data.title + (data.by ? `\n${verb} by ${data.by}` : ''),
                  icon: '/favicon.ico',
                  tag: `task-${data.taskId}-${data.event}`,
                });
                // Same "seen it" convention as the in-app toast's dismiss/View
                // (see TaskToast above) — otherwise clicking the OS-level
                // notification alone (tab not focused) leaves the beep going.
                n.onclick = () => {
                  window.focus(); n.close();
                  clearTaskAlert(data.taskId);
                  api.post(`/tasks/${data.taskId}/notifications/read`).then(refreshTaskCounts).catch(() => {});
                };
              }
            }
          }
        } catch (_) {}
      };
      es.onerror = () => { es.close(); setTimeout(connect, 5000); };
    };
    connect();
    return () => esRef.current?.close();
  }, [add, currentUser?.id]);

  return (
    <NotiCtx.Provider value={{ add, remove, msgCount, clearMsgCount, taskCount, clearTaskCount, fieldVisitTaskCount, clearFieldVisitTaskCount, refreshTaskCounts, clearTaskAlert }}>
      {children}
      <ToastContainer notifications={notifications} onClose={remove} />
    </NotiCtx.Provider>
  );
}
