import React, { useState, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useData } from '../../context/DataContext.jsx';
import { useChat } from '../../context/ChatContext.jsx';
import SearchableSelect from '../Common/SearchableSelect.jsx';
import ChatThread, { Avatar, staffLine } from './ChatThread.jsx';

const fmtDay = (d) => {
  if (!d) return '';
  const dt = new Date(d), now = new Date();
  if (dt.toDateString() === now.toDateString()) return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (dt.toDateString() === yest.toDateString()) return 'Yesterday';
  return dt.toLocaleDateString();
};

/* ─── New direct chat modal ──────────────────────── */
const NewChatModal = ({ onClose, onStart, employees }) => {
  const [userId, setUserId] = useState('');
  const options = useMemo(() =>
    employees.map(e => ({ value: String(e.id), label: `${e.fullName} (${e.employeeId})` })), [employees]);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header" style={{ background: 'linear-gradient(135deg,#eff6ff,#dbeafe)' }}>
          <h2 style={{ color: '#1e40af' }}>💬 New Chat</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Start a conversation with</div>
          <SearchableSelect value={userId} onChange={setUserId} options={options} placeholder="— Search staff —" />
        </div>
        <div className="modal-footer">
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!userId} onClick={() => onStart(Number(userId))}>Start Chat</button>
        </div>
      </div>
    </div>
  );
};

/* ─── New group chat modal ───────────────────────── */
const NewGroupModal = ({ onClose, onCreate, employees }) => {
  const [name,    setName]    = useState('');
  const [members, setMembers] = useState([]);
  const [error,   setError]   = useState('');
  const options = useMemo(() =>
    employees.map(e => ({ value: String(e.id), label: `${e.fullName} (${e.employeeId})` })), [employees]);

  const submit = () => {
    if (!name.trim())      { setError('Group name is required'); return; }
    if (!members.length)   { setError('Select at least one member'); return; }
    onCreate(name.trim(), members.map(Number));
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header" style={{ background: 'linear-gradient(135deg,#f5f3ff,#ede9fe)' }}>
          <h2 style={{ color: '#6d28d9' }}>👥 New Group</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
              Group Name <span style={{ color: '#dc2626' }}>*</span>
            </div>
            <input
              type="text" value={name}
              onChange={e => { setName(e.target.value); setError(''); }}
              placeholder="e.g. Front Desk Team"
              style={{ width: '100%', height: 36, border: '1px solid #d1d5db', borderRadius: 7,
                padding: '0 10px', fontSize: 13, boxSizing: 'border-box', outline: 'none' }}
            />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
              Members <span style={{ color: '#dc2626' }}>*</span>
            </div>
            <SearchableSelect
              value={members}
              onChange={v => { setMembers(v); setError(''); }}
              options={options}
              multiple={true}
              placeholder="— Search and select staff —"
            />
          </div>
          {error && <div style={{ fontSize: 12, color: '#dc2626' }}>{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit}>Create Group</button>
        </div>
      </div>
    </div>
  );
};

/* ─── Main Chat page ─────────────────────────────── */
const ChatPage = () => {
  const { currentUser } = useAuth();
  // Chat is peer-to-peer — use the full staff list, not `filteredEmployees`
  // (that's scoped to the manager/dept-head reporting hierarchy and would
  // leave a plain "employee" role seeing no one to chat with at all).
  const { employees: allEmployees } = useData();
  const { conversations, onlineIds, startDirectChat, createGroup } = useChat();

  const employees = useMemo(() =>
    (allEmployees || []).filter(e => e.active !== false && e.id !== currentUser?.id), [allEmployees, currentUser?.id]);

  const [activeId,     setActiveId]     = useState(null);
  const [search,        setSearch]        = useState('');
  const [filter,        setFilter]        = useState('all'); // all | unread | read
  const [showNewChat,   setShowNewChat]   = useState(false);
  const [showNewGroup,  setShowNewGroup]  = useState(false);

  const roster = useMemo(() =>
    [...employees].sort((a, b) => {
      const aOn = onlineIds.has(a.id) ? 0 : 1, bOn = onlineIds.has(b.id) ? 0 : 1;
      if (aOn !== bOn) return aOn - bOn;
      return (a.fullName || '').localeCompare(b.fullName || '');
    }), [employees, onlineIds]);

  const startChatWith = async (userId) => {
    const id = await startDirectChat(userId);
    setActiveId(id);
    setShowNewChat(false);
  };

  const createGroupChat = async (name, memberIds) => {
    const id = await createGroup(name, memberIds);
    setActiveId(id);
    setShowNewGroup(false);
  };

  const filteredConvos = conversations
    .filter(c => !search.trim() || c.name?.toLowerCase().includes(search.trim().toLowerCase()))
    .filter(c => filter === 'all' ? true : filter === 'unread' ? c.unreadCount > 0 : c.unreadCount === 0);

  const unreadTotal = conversations.filter(c => c.unreadCount > 0).length;

  return (
    <div className="page-container" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 60px)', boxSizing: 'border-box' }}>
      <div className="page-header" style={{ flexShrink: 0 }}>
        <div>
          <h1 className="page-title">💬 Internal Chat</h1>
          <p className="page-subtitle">Individual & group chat with your team — online status shown live</p>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex',
        border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>

        {/* ── Left: staff roster + conversation list ── */}
        <div style={{ width: 320, flexShrink: 0, borderRight: '1px solid #e5e7eb',
          display: 'flex', flexDirection: 'column', minHeight: 0, background: '#f9fafb' }}>

          <div style={{ padding: '12px 14px 8px', display: 'flex', gap: 8, flexShrink: 0 }}>
            <button onClick={() => setShowNewChat(true)}
              style={{ flex: 1, padding: '8px 0', background: '#1a56db', color: '#fff', border: 'none',
                borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              💬 New Chat
            </button>
            <button onClick={() => setShowNewGroup(true)}
              style={{ flex: 1, padding: '8px 0', background: '#6d28d9', color: '#fff', border: 'none',
                borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              👥 New Group
            </button>
          </div>

          {/* Staff directory — everyone, with live online/offline status */}
          <div style={{ borderBottom: '1px solid #eef0f2', flexShrink: 0 }}>
            <div style={{ padding: '6px 14px 4px', fontSize: 10, fontWeight: 700, color: '#6b7280',
              textTransform: 'uppercase', letterSpacing: .5, display: 'flex', justifyContent: 'space-between' }}>
              <span>Staff</span>
              <span>{onlineIds.size} online / {roster.length}</span>
            </div>
            <div style={{ maxHeight: 190, overflowY: 'auto', padding: '2px 8px 8px' }}>
              {roster.map(e => {
                const online = onlineIds.has(e.id);
                return (
                  <div key={e.id} onClick={() => startChatWith(e.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 6px',
                      borderRadius: 7, cursor: 'pointer' }}
                    onMouseEnter={ev => { ev.currentTarget.style.background = '#f0f0f0'; }}
                    onMouseLeave={ev => { ev.currentTarget.style.background = 'transparent'; }}>
                    <Avatar label={e.fullName} online={online} size={30} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: '#111827',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {staffLine(e)}
                      </div>
                      <div style={{ fontSize: 10.5, color: online ? '#16a34a' : '#9ca3af' }}>
                        {online ? '🟢 Online' : '⚪ Offline'}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ padding: '8px 14px 6px', flexShrink: 0 }}>
            <input
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="🔍 Search chats…"
              style={{ width: '100%', height: 32, border: '1px solid #dedede', borderRadius: 7,
                padding: '0 10px', fontSize: 12.5, boxSizing: 'border-box', outline: 'none', background: '#fff' }}
            />
          </div>

          {/* All / Unread / Read filter */}
          <div style={{ display: 'flex', gap: 4, padding: '0 14px 8px', flexShrink: 0 }}>
            {[
              { key: 'all',    label: 'All' },
              { key: 'unread', label: `Unread${unreadTotal ? ` (${unreadTotal})` : ''}` },
              { key: 'read',   label: 'Read' },
            ].map(f => (
              <button key={f.key} onClick={() => setFilter(f.key)}
                style={{ padding: '4px 10px', borderRadius: 14, fontSize: 11.5, fontWeight: 600,
                  border: 'none', cursor: 'pointer',
                  background: filter === f.key ? '#1a56db' : '#eef0f2',
                  color:      filter === f.key ? '#fff'    : '#374151' }}>
                {f.label}
              </button>
            ))}
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {filteredConvos.length === 0 ? (
              <div style={{ padding: '30px 20px', textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
                {filter === 'all' ? 'No chats yet — start one above.' : `No ${filter} chats.`}
              </div>
            ) : filteredConvos.map(c => (
              <div key={c.id} onClick={() => setActiveId(c.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                  cursor: 'pointer', background: activeId === c.id ? '#e0e7f0' : 'transparent',
                  borderBottom: '1px solid #f3f4f6' }}
                onMouseEnter={e => { if (activeId !== c.id) e.currentTarget.style.background = '#f0f0f0'; }}
                onMouseLeave={e => { if (activeId !== c.id) e.currentTarget.style.background = 'transparent'; }}>
                <Avatar label={c.name} isGroup={c.type === 'group'} online={c.type === 'direct' ? c.online : null} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                    <span style={{ fontSize: 13.5, fontWeight: c.unreadCount ? 700 : 600, color: '#111827',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.name}
                    </span>
                    <span style={{ fontSize: 10.5, color: '#9ca3af', flexShrink: 0 }}>{fmtDay(c.lastAt)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, marginTop: 1 }}>
                    <span style={{ fontSize: 12, color: c.unreadCount ? '#111827' : '#9ca3af',
                      fontWeight: c.unreadCount ? 600 : 400,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.lastMessage ? `${c.lastIsMine ? 'You: ' : ''}${c.lastMessage}` : 'No messages yet'}
                    </span>
                    {c.unreadCount > 0 && (
                      <span style={{ background: '#22c55e', color: '#fff', borderRadius: 10, fontSize: 10,
                        fontWeight: 700, padding: '1px 6px', minWidth: 17, textAlign: 'center', flexShrink: 0 }}>
                        {c.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Right: active conversation ── */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0, background: '#f5f6f8' }}>
          {!activeId ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', color: '#9ca3af' }}>
              <div style={{ fontSize: 46, marginBottom: 10 }}>💬</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#6b7280' }}>Select a chat to start messaging</div>
              <div style={{ fontSize: 12, color: '#b0b7c1', marginTop: 4 }}>Double-click any message to reply to it</div>
            </div>
          ) : (
            <ChatThread conversationId={activeId} />
          )}
        </div>
      </div>

      {showNewChat && (
        <NewChatModal onClose={() => setShowNewChat(false)} onStart={startChatWith} employees={employees} />
      )}
      {showNewGroup && (
        <NewGroupModal onClose={() => setShowNewGroup(false)} onCreate={createGroupChat} employees={employees} />
      )}
    </div>
  );
};

export default ChatPage;
