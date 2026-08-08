import React, { useState, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useData } from '../../context/DataContext.jsx';
import { useChat } from '../../context/ChatContext.jsx';
import ChatThread, { Avatar, staffLine } from './ChatThread.jsx';

/* ─── Contacts popup — Facebook-style "start a chat" list from anywhere ── */
const ContactsPopup = ({ onClose, employees, onlineIds, onPick }) => {
  const [search, setSearch] = useState('');
  const roster = useMemo(() => [...employees]
    .filter(e => !search.trim() || e.fullName?.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => {
      const aOn = onlineIds.has(a.id) ? 0 : 1, bOn = onlineIds.has(b.id) ? 0 : 1;
      if (aOn !== bOn) return aOn - bOn;
      return (a.fullName || '').localeCompare(b.fullName || '');
    }), [employees, onlineIds, search]);

  return (
    <div className="chat-contacts-popup" style={{ position: 'absolute', bottom: '100%', right: 0, marginBottom: 8, width: 340, height: 400,
      background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, boxShadow: '0 12px 32px rgba(0,0,0,.18)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#ffffff', borderBottom: '1px solid #e5e7eb', flexShrink: 0 }}>
        <span style={{ color: '#111827', fontWeight: 700, fontSize: 13 }}>💬 Chat</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 15 }}>✕</button>
      </div>
      <div style={{ padding: 8, borderBottom: '1px solid #f3f4f6', flexShrink: 0 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Search staff…"
          style={{ width: '100%', height: 30, border: '1px solid #dedede', borderRadius: 7, padding: '0 9px',
            fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 6px' }}>
        {roster.length === 0 ? (
          <div style={{ padding: '30px 14px', textAlign: 'center', color: '#9ca3af', fontSize: 12.5 }}>
            {employees.length === 0 ? 'No staff found.' : 'No staff match your search.'}
          </div>
        ) : roster.map(e => {
          const online = onlineIds.has(e.id);
          return (
            <div key={e.id} onClick={() => onPick(e.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderRadius: 7, cursor: 'pointer' }}
              onMouseEnter={ev => { ev.currentTarget.style.background = '#f3f4f6'; }}
              onMouseLeave={ev => { ev.currentTarget.style.background = 'transparent'; }}>
              <Avatar label={e.fullName} photo={e.profilePhoto} online={online} size={30} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: '#111827',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{staffLine(e)}</div>
                <div style={{ fontSize: 10.5, color: online ? '#16a34a' : '#9ca3af' }}>
                  {online ? '🟢 Online' : '⚪ Offline'}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* ─── Facebook-Messenger-style bottom-right dock ─────────────────────────
 * Mounted once in Layout.jsx so it persists across every page. Minimized
 * windows collapse to a small chip on the bottom bar; up to 3 can be open
 * (expanded) side by side at once, matching ChatContext's openWindows cap. */
const ChatDock = () => {
  const { currentUser } = useAuth();
  // Chat is peer-to-peer — use the full staff list, not `filteredEmployees`
  // (that's scoped to the manager/dept-head reporting hierarchy and would
  // leave a plain "employee" role seeing no one to chat with at all).
  const { employees: allEmployees } = useData();
  const {
    conversations, onlineIds,
    openWindows, openChatWindow, closeChatWindow, toggleMinimizeWindow,
    startDirectChat,
  } = useChat();

  const [showContacts, setShowContacts] = useState(false);

  const employees = useMemo(() =>
    (allEmployees || []).filter(e => e.active !== false && e.id !== currentUser?.id), [allEmployees, currentUser?.id]);

  const pickContact = async (userId) => {
    const id = await startDirectChat(userId);
    openChatWindow(id);
    setShowContacts(false);
  };

  if (!currentUser) return null;

  return (
    <div className="chat-dock-root" style={{ position: 'fixed', right: 20, bottom: 0, zIndex: 1000,
      display: 'flex', alignItems: 'flex-end', gap: 10 }}>

      {openWindows.map(w => {
        const conv = conversations.find(c => c.id === w.id);
        if (!conv) return null;
        if (w.minimized) {
          return (
            <div key={w.id} onClick={() => toggleMinimizeWindow(w.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#fff',
                border: '1px solid #e5e7eb', borderBottom: 'none', borderRadius: '10px 10px 0 0',
                padding: '7px 10px', cursor: 'pointer', boxShadow: '0 -2px 10px rgba(0,0,0,.08)' }}>
              <Avatar label={conv.name} photo={conv.photo} isGroup={conv.type === 'group'} online={conv.type === 'direct' ? conv.online : null} size={22} />
              <span style={{ fontSize: 12, fontWeight: 600, color: '#111827', maxWidth: 90,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{conv.name}</span>
              {conv.unreadCount > 0 && (
                <span style={{ background: '#22c55e', color: '#fff', borderRadius: 10, fontSize: 9.5,
                  fontWeight: 700, padding: '1px 5px' }}>{conv.unreadCount}</span>
              )}
              <button onClick={e => { e.stopPropagation(); closeChatWindow(w.id); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#9ca3af' }}>✕</button>
            </div>
          );
        }
        return (
          <div key={w.id} className="chat-window" style={{ width: 360, height: 420, background: '#fff',
            border: '1px solid #e5e7eb', borderRadius: '10px 10px 0 0', boxShadow: '0 -4px 20px rgba(0,0,0,.15)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <ChatThread
              conversationId={w.id}
              compact
              onMinimize={() => toggleMinimizeWindow(w.id)}
              onClose={() => closeChatWindow(w.id)}
            />
          </div>
        );
      })}

      <div style={{ position: 'relative' }}>
        {showContacts && (
          <ContactsPopup
            onClose={() => setShowContacts(false)}
            employees={employees}
            onlineIds={onlineIds}
            onPick={pickContact}
          />
        )}
        <button onClick={() => setShowContacts(p => !p)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#1a56db', color: '#fff',
            border: 'none', borderRadius: '10px 10px 0 0', padding: '9px 16px', cursor: 'pointer',
            fontSize: 13, fontWeight: 700, boxShadow: '0 -2px 10px rgba(0,0,0,.12)' }}>
          💬 Chat
          {onlineIds.size > 0 && (
            <span style={{ background: '#22c55e', color: '#fff', borderRadius: 10, fontSize: 10,
              fontWeight: 700, padding: '1px 6px' }}>{onlineIds.size} online</span>
          )}
        </button>
      </div>

      <style>{`
        @media (max-width: 480px) {
          .chat-window, .chat-contacts-popup { width: calc(100vw - 24px) !important; }
          .chat-dock-root { right: 12px !important; }
        }
      `}</style>
    </div>
  );
};

export default ChatDock;
