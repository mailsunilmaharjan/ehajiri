import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useChat } from '../../context/ChatContext.jsx';
import EmojiPicker from './EmojiPicker.jsx';
import api from '../../api/client.js';

const fmtTime = (d) => d ? new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

/** Day-separator chip between messages of different days — DD-MMMM-YYYY. */
const fmtDateDivider = (d) => {
  const dt = new Date(d);
  return `${String(dt.getDate()).padStart(2, '0')}-${dt.toLocaleString('en-US', { month: 'long' })}-${dt.getFullYear()}`;
};

/** One-tap reactions offered on bubble hover; stored per user per message. */
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '✅', 'OK'];

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

export const Avatar = ({ label, photo, isGroup, online, size = 40 }) => (
  <div style={{ position: 'relative', flexShrink: 0 }}>
    {photo && !isGroup ? (
      <div style={{ width: size, height: size, borderRadius: '50%', overflow: 'hidden', background: '#e5e7eb' }}>
        <img src={photo} alt={label || ''} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      </div>
    ) : (
      <div style={{
        width: size, height: size, borderRadius: '50%',
        background: isGroup ? '#f5f3ff' : '#eff6ff',
        color:      isGroup ? '#6d28d9' : '#1a56db',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 700, fontSize: size * 0.4,
      }}>
        {isGroup ? '👥' : (label || '?')[0]?.toUpperCase() || '?'}
      </div>
    )}
    {online != null && (
      <span style={{
        position: 'absolute', right: -1, bottom: -1, width: size > 30 ? 11 : 9, height: size > 30 ? 11 : 9,
        borderRadius: '50%', background: online ? '#22c55e' : '#9ca3af', border: '2px solid #fff',
      }} />
    )}
  </div>
);

/* ── Inline formatting: *bold*, _italic_, __underline__ (WhatsApp-style
   markers stored in the plain-text body, rendered as real styling) ── */
const INLINE_PATTERNS = [
  { re: /__(.+?)__/, tag: 'u' },   // must run before _italic_
  { re: /\*(.+?)\*/, tag: 'b' },
  { re: /_(.+?)_/,   tag: 'i' },
];

/** Turns marker text into React nodes — recursive, so *__both__* nests fine. */
const renderInline = (text) => {
  if (!text) return [text];
  for (const { re, tag } of INLINE_PATTERNS) {
    const m = text.match(re);
    if (m && m[1]) {
      const Tag = tag;
      const before = text.slice(0, m.index);
      const after  = text.slice(m.index + m[0].length);
      return [
        ...(before ? renderInline(before) : []),
        <Tag key={`${tag}${m.index}${m[1].length}`}>{renderInline(m[1])}</Tag>,
        ...(after ? renderInline(after) : []),
      ];
    }
  }
  return [text];
};

/** Strips the formatting markers for plain-text spots (previews, quotes). */
export const stripMarkers = (text) => (text || '')
  .replace(/__(.+?)__/g, '$1')
  .replace(/\*(.+?)\*/g, '$1')
  .replace(/_(.+?)_/g, '$1');

/** Truncated one-line preview of any message, used for the quoted-reply banner/box. */
const snippet = (text, max = 70) => {
  const t = stripMarkers(text);
  if (!t) return '';
  return t.length > max ? t.slice(0, max) + '…' : t;
};

/* ── Composer list markers: "1. " numbered, "• " bullet, "[ ] "/"[x] " checklist ── */
const NUM_RE   = /^(\d+)\.\s?(.*)$/;
const BUL_RE   = /^•\s?(.*)$/;
const CHECK_RE = /^\[( |x)\]\s?(.*)$/i;

/** What marker (if any) should the next line get when Shift+Enter is pressed
    on `line`? `empty` = the line is a lone marker with no text, meaning the
    user is done with the list. */
const listContinuation = (line) => {
  let m = line.match(NUM_RE);
  if (m) return { marker: `${parseInt(m[1], 10) + 1}. `, empty: !m[2].trim() };
  m = line.match(BUL_RE);
  if (m) return { marker: '• ', empty: !m[1].trim() };
  m = line.match(CHECK_RE);
  if (m) return { marker: '[ ] ', empty: !m[2].trim() };
  return null;
};

/** Renders a message body line by line: numbered/bullet rows get styled
    markers, checklist rows get a live checkbox (clicking it flips the task
    for everyone in the conversation), everything else stays plain text. */
const MessageBody = ({ body, compact, onToggle }) => {
  const lines = (body || '').split('\n');
  return (
    <div style={{ fontSize: compact ? 13 : 14, color: '#111827', wordBreak: 'break-word' }}>
      {lines.map((line, i) => {
        const c = line.match(CHECK_RE);
        if (c) {
          const done = c[1].toLowerCase() === 'x';
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 7, margin: '2.5px 0' }}>
              <span
                onClick={(e) => { e.stopPropagation(); onToggle?.(i); }}
                onDoubleClick={(e) => e.stopPropagation()}
                title={done ? 'Mark as not done' : 'Mark as done'}
                style={{ width: 16, height: 16, borderRadius: 4, marginTop: 2, flexShrink: 0,
                  border: done ? '1px solid #16a34a' : '2px solid #9ca3af',
                  background: done ? '#16a34a' : '#fff', color: '#fff',
                  fontSize: 11, fontWeight: 800, lineHeight: 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: onToggle ? 'pointer' : 'default', userSelect: 'none' }}>
                {done ? '✓' : ''}
              </span>
              <span style={{ whiteSpace: 'pre-wrap',
                textDecoration: done ? 'line-through' : 'none',
                color: done ? '#9ca3af' : '#111827' }}>
                {renderInline(c[2])}
              </span>
            </div>
          );
        }
        const n = line.match(NUM_RE);
        if (n) {
          return (
            <div key={i} style={{ display: 'flex', gap: 6, margin: '2.5px 0', alignItems: 'flex-start' }}>
              <span style={{ fontWeight: 700, color: '#1a56db', flexShrink: 0 }}>{n[1]}.</span>
              <span style={{ whiteSpace: 'pre-wrap' }}>{renderInline(n[2])}</span>
            </div>
          );
        }
        const b = line.match(BUL_RE);
        if (b) {
          return (
            <div key={i} style={{ display: 'flex', gap: 8, margin: '2.5px 0', alignItems: 'flex-start' }}>
              <span style={{ color: '#1a56db', fontWeight: 800, flexShrink: 0 }}>•</span>
              <span style={{ whiteSpace: 'pre-wrap' }}>{renderInline(b[1])}</span>
            </div>
          );
        }
        return <div key={i} style={{ whiteSpace: 'pre-wrap' }}>{line ? renderInline(line) : ' '}</div>;
      })}
    </div>
  );
};

const Bubble = ({ msg, mine, myId, showSender, onReply, onToggleCheck, onReact, onEdit, seenText, compact }) => {
  const [hover,   setHover]   = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState('');
  const reactions = Array.isArray(msg.reactions) ? msg.reactions : [];
  const myReaction = reactions.find(r => r.userId === myId)?.emoji || null;

  const startEdit = () => { setDraft(msg.body || ''); setEditing(true); };
  const saveEdit = async () => {
    const text = draft.trim();
    if (!text || text === msg.body) { setEditing(false); return; }
    const ok = await onEdit(msg, text);
    if (ok) setEditing(false);
  };

  // Group identical reactions into badges: 👍 2, OK 1, …
  const grouped = [];
  for (const r of reactions) {
    const g = grouped.find(x => x.emoji === r.emoji);
    if (g) { g.count++; g.names.push(r.name); }
    else grouped.push({ emoji: r.emoji, count: 1, names: [r.name] });
  }

  return (
    <div
      onDoubleClick={() => { if (!editing) onReply(msg); }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={editing ? undefined : 'Double-click to reply'}
      data-testid="chat-bubble"
      style={{ display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start',
        marginBottom: seenText ? 4 : 8, cursor: 'pointer' }}>
      <div style={{ position: 'relative', maxWidth: compact ? '80%' : '65%',
        minWidth: editing ? (compact ? 200 : 280) : undefined }}>

        {/* Hover bar — one-tap reactions + edit (own messages only) */}
        {hover && !editing && onReact && (
          <div style={{ position: 'absolute', top: -30, [mine ? 'right' : 'left']: 0, zIndex: 5,
            display: 'flex', gap: 2, alignItems: 'center', background: '#fff', border: '1px solid #e5e7eb',
            borderRadius: 16, padding: '3px 6px', boxShadow: '0 3px 10px rgba(0,0,0,.14)', whiteSpace: 'nowrap' }}>
            {QUICK_REACTIONS.map(em => (
              <span key={em}
                onClick={(e) => { e.stopPropagation(); onReact(msg, em); }}
                onDoubleClick={(e) => e.stopPropagation()}
                title={myReaction === em ? 'Remove reaction' : `React ${em}`}
                style={{ fontSize: em === 'OK' ? 10.5 : (compact ? 14 : 16), fontWeight: em === 'OK' ? 800 : 400,
                  color: em === 'OK' ? '#1a56db' : undefined,
                  padding: em === 'OK' ? '3px 5px' : '1px 3px', borderRadius: 10, lineHeight: '18px',
                  background: myReaction === em ? '#dbeafe' : 'transparent',
                  cursor: 'pointer', userSelect: 'none', transition: 'transform .08s' }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.25)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}>
                {em}
              </span>
            ))}
            {mine && onEdit && (
              <>
                <span style={{ width: 1, height: 16, background: '#e5e7eb', margin: '0 3px' }} />
                <span
                  onClick={(e) => { e.stopPropagation(); startEdit(); }}
                  onDoubleClick={(e) => e.stopPropagation()}
                  title="Edit message"
                  style={{ fontSize: compact ? 12 : 13.5, padding: '1px 4px', borderRadius: 10,
                    cursor: 'pointer', userSelect: 'none', lineHeight: '18px' }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.2)'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}>
                  ✏️
                </span>
              </>
            )}
          </div>
        )}

        <div style={{
          padding: '7px 11px',
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
          <MessageBody body={msg.body} compact={compact}
            onToggle={onToggleCheck ? (lineIndex) => onToggleCheck(msg, lineIndex) : null} />
          <div style={{ fontSize: 10, color: '#9ca3af', textAlign: 'right', marginTop: 3 }}>{fmtTime(msg.created_at)}</div>
        </div>

        {/* Reaction badges — click one to join/leave that reaction */}
        {grouped.length > 0 && (
          <div style={{ display: 'flex', gap: 4, marginTop: -6, position: 'relative', zIndex: 2,
            justifyContent: mine ? 'flex-end' : 'flex-start', padding: '0 6px' }}>
            {grouped.map(g => (
              <span key={g.emoji}
                onClick={(e) => { e.stopPropagation(); onReact?.(msg, g.emoji); }}
                onDoubleClick={(e) => e.stopPropagation()}
                title={g.names.join(', ')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 3,
                  background: '#fff', border: `1px solid ${myReaction === g.emoji ? '#93c5fd' : '#e5e7eb'}`,
                  borderRadius: 12, padding: '1px 7px', fontSize: g.emoji === 'OK' ? 9.5 : 12,
                  fontWeight: g.emoji === 'OK' ? 800 : 400, color: g.emoji === 'OK' ? '#1a56db' : undefined,
                  boxShadow: '0 1px 3px rgba(0,0,0,.12)', cursor: 'pointer', userSelect: 'none' }}>
                {g.emoji}{g.count > 1 && <span style={{ fontSize: 10, fontWeight: 700, color: '#6b7280' }}>{g.count}</span>}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Group chat: who has seen up to here (shown under the newest message) */}
      {seenText && (
        <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 3, padding: '0 4px' }}>
          👁 {seenText}
        </div>
      )}
    </div>
  );
};

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
  const [receipts,  setReceipts]  = useState([]);   // participants' last-read times → "Seen by …"

  const scrollRef = useRef(null);
  const inputRef  = useRef(null);
  const convIdRef = useRef(conversationId);
  useEffect(() => { convIdRef.current = conversationId; }, [conversationId]);

  const loadMessages = useCallback((id) => {
    api.get(`/chat/conversations/${id}/messages`)
      .then(data => setMessages(Array.isArray(data) ? data : []))
      .catch(() => setMessages([]));
  }, []);

  const loadReceipts = useCallback((id) => {
    api.get(`/chat/conversations/${id}/receipts`)
      .then(data => setReceipts(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!conversationId) return;
    loadMessages(conversationId);
    loadReceipts(conversationId);
    markRead(conversationId);
    setReplyTo(null);
    // Reads by other participants don't broadcast (that would ping-pong
    // between open threads) — refresh receipts on a slow poll instead.
    const iv = setInterval(() => loadReceipts(conversationId), 20000);
    return () => clearInterval(iv);
  }, [conversationId, loadMessages, loadReceipts, markRead]);

  useEffect(() => onMessage((data) => {
    if (data.conversationId === convIdRef.current) {
      loadMessages(data.conversationId);
      loadReceipts(data.conversationId);
      markRead(data.conversationId);
    }
  }), [onMessage, loadMessages, loadReceipts, markRead]);

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

  /** One-tap emoji/OK reaction — optimistic replace-or-toggle of my own
      reaction, then persisted; server broadcasts a silent chat_update. */
  const react = async (msg, emoji) => {
    const uid = currentUser?.id;
    const prev = Array.isArray(msg.reactions) ? msg.reactions : [];
    const mine = prev.find(r => r.userId === uid)?.emoji || null;
    const next = prev.filter(r => r.userId !== uid);
    if (mine !== emoji) next.push({ emoji, userId: uid, name: currentUser?.fullName || 'Me' });
    setMessages(ms => ms.map(x => x.id === msg.id ? { ...x, reactions: next } : x));
    try { await api.put(`/chat/messages/${msg.id}/reaction`, { emoji }); }
    catch (_) { loadMessages(conversationId); }
  };

  /** Flip one "[ ]"/"[x]" line of a sent message — optimistic, then persisted;
      the server broadcasts a silent chat_update so everyone's thread refreshes. */
  const toggleCheck = async (msg, lineIndex) => {
    const lines = (msg.body || '').split('\n');
    const line = lines[lineIndex] ?? '';
    const m = line.match(/^\[( |x)\]/i);
    if (!m) return;
    lines[lineIndex] = (m[1].toLowerCase() === 'x' ? '[ ]' : '[x]') + line.slice(3);
    const optimistic = lines.join('\n');
    setMessages(prev => prev.map(x => x.id === msg.id ? { ...x, body: optimistic } : x));
    try { await api.patch(`/chat/messages/${msg.id}/check`, { lineIndex }); }
    catch (_) { loadMessages(conversationId); }
  };

  /** Write a composer edit to the DOM first (value + caret), THEN sync React
      state. Setting state alone re-renders the controlled textarea and Chrome
      throws the caret to the end — with the DOM already holding `next`,
      React's commit is a no-op and the selection survives. */
  const applyComposerEdit = (next, selStart, selEnd) => {
    const el = inputRef.current;
    if (el) {
      el.value = next;
      el.setSelectionRange(selStart, selEnd);
      el.focus();
    }
    setInput(next);
  };

  /** Bold/Italic/Underline: wrap the selection in its marker (*, _, __) —
      or unwrap if already wrapped (toggle). No selection: insert a marker
      pair and leave the cursor between them. */
  const wrapSelection = (marker) => {
    const el = inputRef.current; if (!el) return;
    const val = el.value;
    const s = el.selectionStart, e = el.selectionEnd;
    const sel = val.slice(s, e);
    const before = val.slice(0, s), after = val.slice(e);
    if (sel.startsWith(marker) && sel.endsWith(marker) && sel.length >= marker.length * 2) {
      const inner = sel.slice(marker.length, sel.length - marker.length);
      applyComposerEdit(before + inner + after, s, s + inner.length);            // markers inside selection — strip
    } else if (before.endsWith(marker) && after.startsWith(marker)) {
      applyComposerEdit(before.slice(0, before.length - marker.length) + sel + after.slice(marker.length),
        s - marker.length, s - marker.length + sel.length);                      // markers just outside — strip
    } else {
      applyComposerEdit(before + marker + sel + marker + after,
        s + marker.length, s + marker.length + sel.length);
    }
  };

  /** Toolbar: turn the line under the cursor into a numbered / bullet /
      checklist item (numbering continues from the line above). */
  const applyList = (type) => {
    const el = inputRef.current; if (!el) return;
    const val = el.value;
    const pos = el.selectionStart;
    const lineStart = val.lastIndexOf('\n', pos - 1) + 1;
    let lineEnd = val.indexOf('\n', pos); if (lineEnd === -1) lineEnd = val.length;
    const stripped = val.slice(lineStart, lineEnd).replace(/^(\d+\.\s?|•\s?|\[( |x)\]\s?)/i, '');
    let prefix;
    if (type === 'bullet')     prefix = '• ';
    else if (type === 'check') prefix = '[ ] ';
    else {
      const prev = val.slice(0, Math.max(lineStart - 1, 0));
      const prevLine = prev.slice(prev.lastIndexOf('\n') + 1);
      const pm = prevLine.match(NUM_RE);
      prefix = pm ? `${parseInt(pm[1], 10) + 1}. ` : '1. ';
    }
    const newLine = prefix + stripped;
    const npos = lineStart + newLine.length;
    applyComposerEdit(val.slice(0, lineStart) + newLine + val.slice(lineEnd), npos, npos);
  };

  /** Enter sends; Shift+Enter continues the current list ("1." → "2.",
      "•" → "•", "[ ]" → "[ ]"), and on an empty list item ends the list.
      Ctrl+B / Ctrl+I / Ctrl+U toggle bold / italic / underline. */
  const onComposerKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); wrapSelection('*');  return; }
      if (k === 'i') { e.preventDefault(); wrapSelection('_');  return; }
      if (k === 'u') { e.preventDefault(); wrapSelection('__'); return; }
    }
    if (e.key !== 'Enter') return;
    if (!e.shiftKey) { e.preventDefault(); sendMessage(); return; }
    const el = e.target;
    const val = el.value;
    const pos = el.selectionStart;
    const lineStart = val.lastIndexOf('\n', pos - 1) + 1;
    const cont = listContinuation(val.slice(lineStart, pos));
    if (!cont) return;                       // plain newline — let the browser do it
    e.preventDefault();
    if (cont.empty) {
      // lone marker with no text — user is done with the list: remove it
      applyComposerEdit(val.slice(0, lineStart) + val.slice(pos), lineStart, lineStart);
    } else {
      const insert = '\n' + cont.marker;
      const npos = pos + insert.length;
      applyComposerEdit(val.slice(0, pos) + insert + val.slice(el.selectionEnd), npos, npos);
    }
  };

  if (!active) return null;

  return (
    <>
      <div onClick={onMinimize} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: compact ? '8px 10px' : '10px 16px',
        borderBottom: '1px solid #e5e7eb', background: '#fff', flexShrink: 0, cursor: onMinimize ? 'pointer' : 'default' }}>
        <Avatar label={active.name} photo={active.photo} isGroup={active.type === 'group'} online={active.type === 'direct' ? active.online : null} size={compact ? 30 : 36} />
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
        {messages.map((m, i) => {
          const prevM = messages[i - 1];
          const newDay = !prevM || new Date(prevM.created_at).toDateString() !== new Date(m.created_at).toDateString();
          // Group chats: list who has read up to the newest message
          let seenText = null;
          if (active.type === 'group' && i === messages.length - 1) {
            const names = receipts
              .filter(r => r.userId !== currentUser?.id && r.userId !== m.sender_id
                && r.lastReadAt && new Date(r.lastReadAt) >= new Date(m.created_at))
              .map(r => r.name);
            if (names.length) seenText = `Seen by ${names.join(', ')}`;
          }
          return (
            <React.Fragment key={m.id}>
              {newDay && (
                <div style={{ display: 'flex', justifyContent: 'center', margin: '10px 0 12px' }}>
                  <span style={{ background: '#e8ebf0', color: '#556070', fontSize: compact ? 10 : 11,
                    fontWeight: 700, borderRadius: 12, padding: '3px 12px', letterSpacing: .3 }}>
                    {fmtDateDivider(m.created_at)}
                  </span>
                </div>
              )}
              <Bubble msg={m} mine={m.sender_id === currentUser?.id} myId={currentUser?.id}
                showSender={active.type === 'group' && m.sender_id !== currentUser?.id}
                onReply={setReplyTo} onToggleCheck={toggleCheck} onReact={react}
                seenText={seenText} compact={compact} />
            </React.Fragment>
          );
        })}
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

      <div style={{ position: 'relative', padding: compact ? '6px 10px 8px' : '8px 16px 10px',
        borderTop: replyTo ? 'none' : '1px solid #e5e7eb', background: '#fff', flexShrink: 0 }}>
        {showEmoji && (
          <EmojiPicker onPick={(em) => setInput(prev => prev + em)} onClose={() => setShowEmoji(false)} />
        )}
        {/* Row 1: emoji + formatting toolbar — its own row so the textarea below gets full width */}
        <div style={{ display: 'flex', gap: 3, alignItems: 'center', marginBottom: 6 }}>
          <button onClick={() => setShowEmoji(p => !p)}
            style={{ background: 'none', border: 'none', fontSize: compact ? 17 : 20, cursor: 'pointer', padding: '0 4px 0 0', lineHeight: 1 }}>
            😊
          </button>
          {/* Formatting — bold/italic/underline + numbered/bullet/checklist */}
          {[
            { onClick: () => wrapSelection('*'),  tip: 'Bold (Ctrl+B)',      label: 'B', style: { fontWeight: 800 } },
            { onClick: () => wrapSelection('_'),  tip: 'Italic (Ctrl+I)',    label: 'I', style: { fontStyle: 'italic', fontFamily: 'Georgia, serif' } },
            { onClick: () => wrapSelection('__'), tip: 'Underline (Ctrl+U)', label: 'U', style: { textDecoration: 'underline' } },
            { onClick: () => applyList('num'),    tip: 'Numbered list — Shift+Enter continues 2., 3., …', label: '1.' },
            { onClick: () => applyList('bullet'), tip: 'Bullet list — Shift+Enter adds the next •',       label: '•' },
            { onClick: () => applyList('check'),  tip: 'Checklist — tick the boxes in the sent message to mark tasks done', label: '☑' },
          ].map(b => (
            <button key={b.label} onClick={b.onClick} title={b.tip}
              style={{ width: compact ? 24 : 28, height: compact ? 24 : 28,
                background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 7,
                color: '#374151', fontSize: compact ? 11 : 13, fontWeight: 700,
                cursor: 'pointer', padding: 0, lineHeight: 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center', ...(b.style || {}) }}
              onMouseEnter={e => { e.currentTarget.style.background = '#e0e7f0'; e.currentTarget.style.color = '#1a56db'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#f3f4f6'; e.currentTarget.style.color = '#374151'; }}>
              {b.label}
            </button>
          ))}
        </div>
        {/* Row 2: full-width message box + send */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onComposerKeyDown}
            onFocus={() => setShowEmoji(false)}
            placeholder="Type a message…  (Shift+Enter = new line)"
            rows={1}
            style={{ flex: 1, resize: 'none', border: '1px solid #d1d5db', borderRadius: 14,
              padding: compact ? '10px 14px' : '12px 16px', fontSize: compact ? 12.5 : 13.5, outline: 'none',
              fontFamily: 'inherit', maxHeight: 140, lineHeight: 1.4,
              minHeight: compact ? 44 : 56 }}
          />
          <button onClick={sendMessage} disabled={!input.trim() || sending}
            style={{ background: input.trim() ? '#1a56db' : '#e5e7eb', color: input.trim() ? '#fff' : '#9ca3af',
              border: 'none', borderRadius: '50%', width: compact ? 32 : 38, height: compact ? 32 : 38,
              fontSize: compact ? 13 : 16, cursor: input.trim() ? 'pointer' : 'default', flexShrink: 0 }}>
            ➤
          </button>
        </div>
      </div>
    </>
  );
};

export default ChatThread;
