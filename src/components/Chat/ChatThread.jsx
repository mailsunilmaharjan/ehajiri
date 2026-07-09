import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useChat } from '../../context/ChatContext.jsx';
import EmojiPicker from './EmojiPicker.jsx';
import api from '../../api/client.js';

const fmtTime = (d) => d ? new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

/** Date+time shown beside the quoted sender's name — just the time for today, "Jul 5, 11:24 PM" otherwise,
 *  so quoting two different messages from the same person is still visually distinct. */
const fmtQuoteTime = (d) => {
  if (!d) return '';
  const dt = new Date(d), now = new Date();
  const time = fmtTime(d);
  return dt.toDateString() === now.toDateString() ? time : `${dt.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
};

/** Abbreviates a multi-word department to initials ("Human Resources" → "HR"); leaves a single word as-is. */
export const deptShortName = (dept) => {
  if (!dept) return '';
  const words = dept.trim().split(/\s+/);
  return words.length > 1 ? words.map(w => w[0]).join('').toUpperCase() : dept;
};

/** "Staff Name - Post - Department short name", skipping any part that's missing. */
export const staffLine = (e) =>
  [e.fullName, e.position, deptShortName(e.department)].filter(Boolean).join(' - ');

export const Avatar = ({ label, isGroup, online, size = 40 }) => (
  <div style={{ position: 'relative', flexShrink: 0 }}>
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: isGroup ? '#f5f3ff' : '#eff6ff',
      color:      isGroup ? '#6d28d9' : '#1a56db',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 700, fontSize: size * 0.4,
    }}>
      {isGroup ? '👥' : (label || '?')[0]?.toUpperCase() || '?'}
    </div>
    {online != null && (
      <span style={{
        position: 'absolute', right: -1, bottom: -1, width: size > 30 ? 11 : 9, height: size > 30 ? 11 : 9,
        borderRadius: '50%', background: online ? '#22c55e' : '#9ca3af', border: '2px solid #fff',
      }} />
    )}
  </div>
);

/** Truncated one-line preview of any message, used for the quoted-reply banner/box. */
const snippet = (text, max = 70) => {
  if (!text) return '';
  return text.length > max ? text.slice(0, max) + '…' : text;
};

const Bubble = ({ msg, mine, showSender, onReply, compact }) => (
  <div
    onDoubleClick={() => onReply(msg)}
    title="Double-click to reply"
    data-testid="chat-bubble"
    style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start', marginBottom: 8, cursor: 'pointer' }}>
    <div style={{
      maxWidth: compact ? '80%' : '65%', padding: '7px 11px',
      borderRadius: mine ? '12px 12px 3px 12px' : '12px 12px 12px 3px',
      background: mine ? '#d9fdd3' : '#fff',
      border: mine ? 'none' : '1px solid #e5e7eb',
      boxShadow: '0 1px 1px rgba(0,0,0,.05)',
    }}>
      {showSender && (
        <div style={{ fontSize: 11, fontWeight: 700, color: '#1a56db', marginBottom: 2 }}>{msg.sender_name}</div>
      )}
      {msg.reply_to_id && (
        <div style={{ borderLeft: '3px solid #1a56db', background: 'rgba(0,0,0,.04)', borderRadius: 4,
          padding: '3px 7px', marginBottom: 5, fontSize: 11.5 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontWeight: 700, color: '#1a56db', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {msg.reply_to_sender_name || 'Message'}
            </span>
            {msg.reply_to_created_at && (
              <span style={{ fontSize: 10, color: '#9ca3af', flexShrink: 0 }}>{fmtQuoteTime(msg.reply_to_created_at)}</span>
            )}
          </div>
          <div style={{ color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {snippet(msg.reply_to_body, 60) || <em>original message deleted</em>}
          </div>
        </div>
      )}
      <div style={{ fontSize: compact ? 13 : 14, color: '#111827', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {msg.body}
      </div>
      <div style={{ fontSize: 10, color: '#9ca3af', textAlign: 'right', marginTop: 3 }}>{fmtTime(msg.created_at)}</div>
    </div>
  </div>
);

/**
 * Shared conversation view — header + scrollable bubbles + input w/ emoji and
 * quote-reply — used both by the full /chat page and the Messenger-style
 * floating dock windows (`compact` shrinks paddings/fonts for the dock).
 */
const ChatThread = ({ conversationId, compact = false, onClose, onMinimize }) => {
  const { currentUser } = useAuth();
  const { conversations, markRead, onMessage } = useChat();
  const active = conversations.find(c => c.id === conversationId) || null;

  const [messages,  setMessages]  = useState([]);
  const [input,     setInput]     = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [replyTo,   setReplyTo]   = useState(null);
  const [sending,   setSending]   = useState(false);

  const scrollRef = useRef(null);
  const convIdRef = useRef(conversationId);
  useEffect(() => { convIdRef.current = conversationId; }, [conversationId]);

  const loadMessages = useCallback((id) => {
    api.get(`/chat/conversations/${id}/messages`)
      .then(data => setMessages(Array.isArray(data) ? data : []))
      .catch(() => setMessages([]));
  }, []);

  useEffect(() => {
    if (!conversationId) return;
    loadMessages(conversationId);
    markRead(conversationId);
    setReplyTo(null);
  }, [conversationId, loadMessages, markRead]);

  useEffect(() => onMessage((data) => {
    if (data.conversationId === convIdRef.current) {
      loadMessages(data.conversationId);
      markRead(data.conversationId);
    }
  }), [onMessage, loadMessages, markRead]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || !conversationId || sending) return;
    setSending(true);
    setInput('');
    const replyToId = replyTo?.id || null;
    setReplyTo(null);
    try {
      await api.post(`/chat/conversations/${conversationId}/messages`, { body: text, replyToId });
      loadMessages(conversationId);
    } catch (_) {
      setInput(text);
    } finally {
      setSending(false);
    }
  };

  if (!active) return null;

  return (
    <>
      <div onClick={onMinimize} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: compact ? '8px 10px' : '10px 16px',
        borderBottom: '1px solid #e5e7eb', background: '#fff', flexShrink: 0, cursor: onMinimize ? 'pointer' : 'default' }}>
        <Avatar label={active.name} isGroup={active.type === 'group'} online={active.type === 'direct' ? active.online : null} size={compact ? 30 : 36} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: compact ? 12.5 : 14, fontWeight: 700, color: '#111827',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{active.name}</div>
          {!compact && (
            <div style={{ fontSize: 11.5, color: active.type === 'direct' && active.online ? '#16a34a' : '#9ca3af' }}>
              {active.type === 'group' ? `${active.members?.length || 0} members` : (active.online ? 'Online' : 'Offline')}
            </div>
          )}
        </div>
        {onMinimize && (
          <button onClick={e => { e.stopPropagation(); onMinimize(); }} style={{ background: 'none', border: 'none',
            cursor: 'pointer', fontSize: 16, color: '#9ca3af', padding: '2px 6px' }} title="Minimize">–</button>
        )}
        {onClose && (
          <button onClick={e => { e.stopPropagation(); onClose(); }} style={{ background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 16, color: '#9ca3af', padding: '2px 6px' }} title="Close">✕</button>
        )}
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: compact ? '10px 12px' : '16px 20px', minHeight: 0 }}>
        {messages.map(m => (
          <Bubble key={m.id} msg={m} mine={m.sender_id === currentUser?.id}
            showSender={active.type === 'group' && m.sender_id !== currentUser?.id}
            onReply={setReplyTo} compact={compact} />
        ))}
      </div>

      {replyTo && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
          background: '#f3f4f6', borderTop: '1px solid #e5e7eb', flexShrink: 0 }}>
          <div style={{ flex: 1, minWidth: 0, borderLeft: '3px solid #1a56db', paddingLeft: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#1a56db', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                ↩ Replying to {replyTo.sender_id === currentUser?.id ? 'yourself' : replyTo.sender_name}
              </span>
              <span style={{ fontSize: 10, color: '#9ca3af', flexShrink: 0 }}>{fmtQuoteTime(replyTo.created_at)}</span>
            </div>
            <div style={{ fontSize: 11.5, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {snippet(replyTo.body)}
            </div>
          </div>
          <button onClick={() => setReplyTo(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#9ca3af' }}>✕</button>
        </div>
      )}

      <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end', gap: 8,
        padding: compact ? '8px 10px' : '10px 16px', borderTop: replyTo ? 'none' : '1px solid #e5e7eb',
        background: '#fff', flexShrink: 0 }}>
        {showEmoji && (
          <EmojiPicker onPick={(em) => setInput(prev => prev + em)} onClose={() => setShowEmoji(false)} />
        )}
        <button onClick={() => setShowEmoji(p => !p)}
          style={{ background: 'none', border: 'none', fontSize: compact ? 18 : 22, cursor: 'pointer', padding: '4px 2px' }}>
          😊
        </button>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
          onFocus={() => setShowEmoji(false)}
          placeholder="Type a message…"
          rows={1}
          style={{ flex: 1, resize: 'none', border: '1px solid #d1d5db', borderRadius: 20,
            padding: compact ? '7px 12px' : '9px 14px', fontSize: compact ? 12.5 : 13.5, outline: 'none',
            fontFamily: 'inherit', maxHeight: 90, lineHeight: 1.4 }}
        />
        <button onClick={sendMessage} disabled={!input.trim() || sending}
          style={{ background: input.trim() ? '#1a56db' : '#e5e7eb', color: input.trim() ? '#fff' : '#9ca3af',
            border: 'none', borderRadius: '50%', width: compact ? 32 : 38, height: compact ? 32 : 38,
            fontSize: compact ? 13 : 16, cursor: input.trim() ? 'pointer' : 'default', flexShrink: 0 }}>
          ➤
        </button>
      </div>
    </>
  );
};

export default ChatThread;
