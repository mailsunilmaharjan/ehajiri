import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useBeepAlert } from '../../hooks/useBeepAlert.js';

/* ── Notification Context ──────────────────────────────────── */
const NotiCtx = createContext({ add: () => {}, remove: () => {}, msgCount: 0, clearMsgCount: () => {} });
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
  const esRef = useRef(null);

  // useAuth is available here because AuthProvider wraps everything above Layout
  let currentUser = null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const auth = useAuth();
    currentUser = auth?.currentUser;
  } catch (_) {}

  const add = useCallback((data) => {
    setNotifications(prev => [...prev, { ...data, id: Date.now() + Math.random() }]);
  }, []);

  const remove = useCallback((id) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const clearMsgCount = useCallback(() => setMsgCount(0), []);

  // Keeps beeping every few seconds while there's at least one unseen broadcast
  // message — stops the instant msgCount is cleared (user opens the inbox).
  useBeepAlert(msgCount > 0);

  useEffect(() => {
    const connect = () => {
      // EventSource can't set an Authorization header, so the token rides along
      // as a query param — authGuard accepts either.
      const token = localStorage.getItem('auth_token');
      if (!token) return;
      const es = new EventSource(`/api/attendance/live?token=${encodeURIComponent(token)}`);
      esRef.current = es;
      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.type === 'attendance') {
            add(data);
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
          }
        } catch (_) {}
      };
      es.onerror = () => { es.close(); setTimeout(connect, 5000); };
    };
    connect();
    return () => esRef.current?.close();
  }, [add, currentUser?.id]);

  return (
    <NotiCtx.Provider value={{ add, remove, msgCount, clearMsgCount }}>
      {children}
      <ToastContainer notifications={notifications} onClose={remove} />
    </NotiCtx.Provider>
  );
}
