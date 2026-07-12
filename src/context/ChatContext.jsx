import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from './AuthContext.jsx';
import { useNotifications } from '../components/Notifications/AttendanceToasts.jsx';
import { useBeepAlert } from '../hooks/useBeepAlert.js';
import api from '../api/client.js';

const ChatCtx = createContext(null);
export const useChat = () => useContext(ChatCtx);

const ONLINE_POLL_MS = 15000;

export function ChatProvider({ children }) {
  const { currentUser } = useAuth();
  const { add: addToast } = useNotifications();
  const [conversations, setConversations] = useState([]);
  const [onlineIds,     setOnlineIds]      = useState(new Set());
  // Facebook-style floating chat windows — { id, minimized } — persists across
  // page navigation since ChatProvider is mounted once, above the router's <main>.
  const [openWindows, setOpenWindows] = useState([]);
  const esRef = useRef(null);
  const listenersRef = useRef(new Set()); // ChatPage subscribes here for live message events

  const loadConversations = useCallback(async () => {
    try {
      const data = await api.get('/chat/conversations');
      setConversations(Array.isArray(data) ? data : []);
    } catch (_) {}
  }, []);

  const loadOnline = useCallback(async () => {
    try {
      const ids = await api.get('/chat/online');
      setOnlineIds(new Set(ids));
    } catch (_) {}
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    loadConversations();
    loadOnline();
    const t = setInterval(loadOnline, ONLINE_POLL_MS);
    return () => clearInterval(t);
  }, [currentUser?.id, loadConversations, loadOnline]);

  /** Opens a Messenger-style floating window for the conversation (max 3 visible at once). */
  const openChatWindow = useCallback((conversationId) => {
    setOpenWindows(prev => {
      const existing = prev.find(w => w.id === conversationId);
      if (existing) return prev.map(w => w.id === conversationId ? { ...w, minimized: false } : w);
      const next = [...prev, { id: conversationId, minimized: false }];
      return next.length > 3 ? next.slice(next.length - 3) : next;
    });
  }, []);

  const closeChatWindow = useCallback((conversationId) => {
    setOpenWindows(prev => prev.filter(w => w.id !== conversationId));
  }, []);

  const toggleMinimizeWindow = useCallback((conversationId) => {
    setOpenWindows(prev => prev.map(w => w.id === conversationId ? { ...w, minimized: !w.minimized } : w));
  }, []);

  // Real-time chat delivery — piggybacks on the same SSE stream the attendance/
  // broadcast-message toasts use (authGuard accepts the token as a query param
  // since EventSource can't set an Authorization header).
  useEffect(() => {
    if (!currentUser) return;
    let closed = false;
    const connect = () => {
      const token = localStorage.getItem('auth_token');
      if (!token) return;
      const es = new EventSource(`/api/attendance/live?token=${encodeURIComponent(token)}`);
      esRef.current = es;
      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          // chat_update = silent change to an existing message (e.g. a
          // checklist box toggled) — refresh threads, never pop a toast.
          if (data.type !== 'chat_message' && data.type !== 'chat_update') return;
          const uid = currentUser.id;
          const isMine = data.senderId === uid;
          const isRecipient = isMine || (Array.isArray(data.recipientIds) && data.recipientIds.includes(uid));
          if (!isRecipient) return;
          loadConversations();
          listenersRef.current.forEach(fn => fn(data));
          // Popup notification on the recipient's screen — not for your own
          // sent message being echoed back to you, and not for silent updates.
          if (!isMine && data.type === 'chat_message') {
            addToast({
              type: 'chat_message',
              conversationId  : data.conversationId,
              conversationName: data.conversationName,
              senderName      : data.senderName,
              preview         : data.preview,
              onView          : () => openChatWindow(data.conversationId),
            });
          }
        } catch (_) {}
      };
      es.onerror = () => { es.close(); if (!closed) setTimeout(connect, 5000); };
    };
    connect();
    return () => { closed = true; esRef.current?.close(); };
  }, [currentUser?.id, loadConversations, addToast, openChatWindow]);

  /** ChatPage calls this to get live-pushed messages for the conversation it has open. */
  const onMessage = useCallback((fn) => {
    listenersRef.current.add(fn);
    return () => listenersRef.current.delete(fn);
  }, []);

  const markRead = useCallback(async (conversationId) => {
    setConversations(prev => prev.map(c => c.id === conversationId ? { ...c, unreadCount: 0 } : c));
    try { await api.put(`/chat/conversations/${conversationId}/read`, {}); } catch (_) {}
  }, []);

  const startDirectChat = useCallback(async (userId) => {
    const res = await api.post('/chat/conversations', { type: 'direct', userId });
    await loadConversations();
    return res.id;
  }, [loadConversations]);

  const createGroup = useCallback(async (name, memberIds) => {
    const res = await api.post('/chat/conversations', { type: 'group', name, memberIds });
    await loadConversations();
    return res.id;
  }, [loadConversations]);

  const totalUnread = conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);

  // Keeps beeping every few seconds while any conversation has unseen messages —
  // stops the instant a conversation is opened/marked read.
  useBeepAlert(totalUnread > 0);

  return (
    <ChatCtx.Provider value={{
      conversations, onlineIds, totalUnread,
      loadConversations, markRead, onMessage,
      startDirectChat, createGroup,
      openWindows, openChatWindow, closeChatWindow, toggleMinimizeWindow,
    }}>
      {children}
    </ChatCtx.Provider>
  );
}
