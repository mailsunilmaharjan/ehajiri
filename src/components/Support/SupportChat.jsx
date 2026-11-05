import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../../api/client.js';
import { useLanguage } from '../../context/LanguageContext.jsx';
import { FAQ, POPULAR, searchFaq, hasDevanagari, kbToFaq, searchKb } from './helpFaq.js';

/* Floating Help assistant, bottom-left.
   1. Free instant answers: the built-in bilingual FAQ plus answers an admin saved
      from earlier live chats (/support-live/kb) — matched in the browser, no AI.
   2. If nothing matches (or the user asks), "Chat with a person" opens a live chat
      that is answered from the LicenseAdmin Super Admin inbox (order.zkattendance.com).
   Conversation state lives in component state only (never localStorage: storage is
   shared across tenants on this origin). A sessionStorage *flag* (no content) lets a
   page reload resume an open live chat; the chat itself is re-read from the server. */

const FLAG = 'ehajiri_live_chat';
const POLL_OPEN_MS = 4000, POLL_CLOSED_MS = 15000;

const L = {
  en: {
    title: 'Help', placeholder: 'Type your question…', send: 'Ask',
    livePlaceholder: 'Message to support…', liveSend: 'Send',
    hello: 'Hi! Ask me how to do something in eHajiri, or pick a topic below. You can write in English or नेपाली.',
    none: 'I could not find an answer for that. You can try different words, or chat with a person from our support team.',
    related: 'Related:', topics: 'Popular topics',
    person: '💬 Chat with a person', liveBadge: 'Live chat with support',
    liveStarted: 'You are now connected to support. Please wait, someone will reply here shortly.',
    ended: 'This chat has ended.', end: 'End chat', youEnded: 'You ended the chat.',
    unavailable: 'Live chat is not available right now.',
    agent: 'Support', help: 'I need help from a person.',
    report: 'Send to support', reported: 'Sent to your administrator ✓', clear: 'New chat', close: 'Close', open: 'Help',
  },
  np: {
    title: 'सहायता', placeholder: 'आफ्नो प्रश्न लेख्नुहोस्…', send: 'सोध्नुहोस्',
    livePlaceholder: 'सपोर्टलाई सन्देश…', liveSend: 'पठाउनुहोस्',
    hello: 'नमस्ते! eHajiri मा केही कसरी गर्ने भनी सोध्नुहोस्, वा तलको विषय छान्नुहोस्। नेपाली वा English मा लेख्न सक्नुहुन्छ।',
    none: 'यसको उत्तर फेला परेन। अर्के शब्द प्रयोग गरेर हेर्नुहोस्, वा हाम्रो सपोर्ट टोलीको व्यक्तिसँग च्याट गर्नुहोस्।',
    related: 'सम्बन्धित:', topics: 'लोकप्रिय विषय',
    person: '💬 व्यक्तिसँग च्याट गर्नुहोस्', liveBadge: 'सपोर्टसँग लाइभ च्याट',
    liveStarted: 'तपाईं सपोर्टसँग जोडिनुभयो। कृपया पर्खनुहोस्, छिट्टै यहीँ जवाफ आउँछ।',
    ended: 'यो च्याट समाप्त भयो।', end: 'च्याट अन्त्य', youEnded: 'तपाईंले च्याट अन्त्य गर्नुभयो।',
    unavailable: 'अहिले लाइभ च्याट उपलब्ध छैन।',
    agent: 'सपोर्ट', help: 'मलाई व्यक्तिको सहयोग चाहिन्छ।',
    report: 'सहायतामा पठाउनुहोस्', reported: 'प्रशासकलाई पठाइयो ✓', clear: 'नयाँ च्याट', close: 'बन्द', open: 'सहायता',
  },
};

const flag = {
  get: () => { try { return sessionStorage.getItem(FLAG) === '1'; } catch { return false; } },
  set: (on) => { try { on ? sessionStorage.setItem(FLAG, '1') : sessionStorage.removeItem(FLAG); } catch { /* ignore */ } },
};

export default function SupportChat() {
  const { language } = useLanguage();
  const s = L[language] || L.en;
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([]);   // {role:'user'|'bot'|'agent'|'note', text, related?, none?}
  const [text, setText] = useState('');
  const [reported, setReported] = useState(false);
  const [kb, setKb] = useState([]);
  const [live, setLive] = useState(null);       // { id } while a live chat is open
  const [unread, setUnread] = useState(0);
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);
  const lastId = useRef(0);
  const checked = useRef(false);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [msgs, open]);
  useEffect(() => { const h = () => setOpen(true); window.addEventListener('ehajiri:open-help', h); return () => window.removeEventListener('ehajiri:open-help', h); }, []);

  const note = (t) => setMsgs(m => [...m, { role: 'note', text: t }]);

  const loadHistory = useCallback((chat, messages) => {
    lastId.current = messages.reduce((mx, m) => Math.max(mx, m.id), 0);
    setLive({ id: chat.id });
    flag.set(true);
    setMsgs(messages.map(x => ({ role: x.sender === 'agent' ? 'agent' : 'user', text: x.body })));
  }, []);

  /* Resume an open live chat: on load when we know one was open in this tab, otherwise
     once the first time the widget is opened (covers a chat started in another tab). */
  const resume = useCallback(async () => {
    if (checked.current) return;
    checked.current = true;
    try {
      const r = await api.get('/support-live/chat');
      if (r.chat?.status === 'open') loadHistory(r.chat, r.messages);
      else flag.set(false);
    } catch { /* live chat unavailable — Help still works */ }
  }, [loadHistory]);

  useEffect(() => { if (flag.get()) resume(); }, [resume]);
  useEffect(() => {
    if (!open) return;
    resume();
    api.get('/support-live/kb').then(r => setKb(kbToFaq(r))).catch(() => {});
  }, [open, resume]);

  /* Poll for the agent's replies while a live chat is open. */
  useEffect(() => {
    if (!live) return undefined;
    let stop = false;
    const tick = async () => {
      try {
        const r = await api.get(`/support-live/chat?chatId=${live.id}&after=${lastId.current}`);
        if (stop) return;
        const fresh = (r.messages || []).filter(m => m.id > lastId.current);
        if (fresh.length) lastId.current = Math.max(...fresh.map(m => m.id));
        const fromAgent = fresh.filter(m => m.sender === 'agent');
        if (fromAgent.length) {
          setMsgs(m => [...m, ...fromAgent.map(x => ({ role: 'agent', text: x.body }))]);
          if (!open) setUnread(u => u + fromAgent.length);
        }
        if (r.chat && r.chat.status !== 'open') {
          note(s.ended); setLive(null); flag.set(false);
        }
      } catch { /* transient — keep polling */ }
    };
    const t = setInterval(tick, open ? POLL_OPEN_MS : POLL_CLOSED_MS);
    return () => { stop = true; clearInterval(t); };
  }, [live, open, s.ended]);

  useEffect(() => { if (open) setUnread(0); }, [open]);

  const answerLang = (q) => (hasDevanagari(q) ? 'np' : language === 'np' ? 'np' : 'en');

  const startLive = async (firstText) => {
    if (busy) return;
    setBusy(true);
    try {
      const lastQ = firstText || [...msgs].reverse().find(m => m.role === 'user')?.text || s.help;
      const r = await api.post('/support-live/start', { message: lastQ, page: location.pathname, language });
      loadHistory(r.chat, r.messages);
      setMsgs(m => [...m, { role: 'note', text: s.liveStarted, keep: true }]);
    } catch (e) {
      setMsgs(m => [...m, { role: 'bot', text: e.message || s.unavailable }]);
    } finally { setBusy(false); }
  };

  const sendLive = async (q) => {
    setMsgs(m => [...m, { role: 'user', text: q }]);
    setText('');
    try { await api.post('/support-live/message', { chatId: live.id, body: q }); }
    catch (e) {
      if (e.status === 409) { note(s.ended); setLive(null); flag.set(false); }
      else note(e.message || s.unavailable);
    }
  };

  const endChat = async () => {
    const id = live?.id;
    setLive(null); flag.set(false);
    note(s.youEnded);
    try { await api.post('/support-live/close', { chatId: id }); } catch { /* ignore */ }
  };

  const ask = (q, entry) => {
    q = (q || '').trim();
    if (!q) return;
    if (live && !entry) return sendLive(q);
    const lang = answerLang(entry ? entry.q[language] || q : q);
    const hits = entry ? [entry] : [...searchKb(q, kb), ...searchFaq(q)].filter((e, i, a) => a.findIndex(x => x.id === e.id) === i).slice(0, 3);
    setReported(false);
    setText('');
    if (!hits.length) {
      setMsgs(m => [...m, { role: 'user', text: q }, { role: 'bot', text: s.none, none: true, q }]);
      return;
    }
    const [best, ...rest] = hits;
    setMsgs(m => [...m,
      { role: 'user', text: q },
      { role: 'bot', text: best.a[lang], related: entry ? [] : rest },
    ]);
  };

  const report = async () => {
    const transcript = msgs.filter(m => m.role !== 'note').map(m => `${m.role === 'user' ? 'User' : 'Help'}: ${m.text}`).join('\n');
    try {
      await api.post('/bug-reports', { source: 'support-chat', page: location.pathname, message: transcript.slice(-1900) });
      setReported(true);
    } catch { /* ignore */ }
  };

  const btn = { border: 'none', cursor: 'pointer', borderRadius: 6, fontSize: 13 };
  const chip = { ...btn, background: '#fff', color: '#1a56db', border: '1px solid #c7d7f8', padding: '5px 9px', textAlign: 'left', fontSize: 12, borderRadius: 14 };
  const byId = (id) => FAQ.find(f => f.id === id);
  const show = (f) => f.q[language] || f.q.en;

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} title={s.title} aria-label={s.title}
        className="help-fab"
        style={{ ...btn, position: 'fixed', left: 20, bottom: 20, zIndex: 1000, background: '#1a56db', color: '#fff',
          padding: '10px 16px', borderRadius: 24, fontWeight: 600, boxShadow: '0 4px 14px rgba(0,0,0,.25)' }}>
        💬<span className="help-fab-label"> {s.open}</span>
        {unread > 0 && <span style={{ marginLeft: 8, background: '#dc2626', borderRadius: 10, padding: '1px 7px', fontSize: 11 }}>{unread}</span>}
      </button>
    );
  }

  return (
    <div className="help-panel" style={{ position: 'fixed', left: 20, bottom: 20, zIndex: 1000, width: 360, maxWidth: 'calc(100vw - 24px)',
      height: 500, maxHeight: 'calc(100vh - 80px)', background: '#fff', border: '1px solid #dedede', borderRadius: 10,
      boxShadow: '0 8px 28px rgba(0,0,0,.25)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ background: live ? '#047857' : '#1a56db', color: '#fff', padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <strong style={{ flex: 1, fontSize: 14 }}>💬 {live ? s.liveBadge : s.title}</strong>
        {live
          ? <button onClick={endChat} style={{ ...btn, background: 'rgba(255,255,255,.2)', color: '#fff', padding: '3px 8px', fontSize: 12 }}>{s.end}</button>
          : msgs.length > 0 && <button onClick={() => { setMsgs([]); setReported(false); }} style={{ ...btn, background: 'rgba(255,255,255,.2)', color: '#fff', padding: '3px 8px', fontSize: 12 }}>{s.clear}</button>}
        <button onClick={() => setOpen(false)} aria-label={s.close} style={{ ...btn, background: 'transparent', color: '#fff', fontSize: 18, lineHeight: 1 }}>×</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 12, background: '#f9fafb', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Bubble role="bot">{s.hello}</Bubble>
        {msgs.length === 0 && !live && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 700 }}>{s.topics}</div>
            {POPULAR.map(id => { const f = byId(id); return f && (
              <button key={id} style={chip} onClick={() => ask(show(f), f)}>{show(f)}</button>
            ); })}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: m.role === 'user' ? 'flex-end' : m.role === 'note' ? 'center' : 'flex-start' }}>
            <Bubble role={m.role} label={m.role === 'agent' ? s.agent : null}>{m.text}</Bubble>
            {m.related?.length > 0 && (
              <>
                <div style={{ fontSize: 11, color: '#6b7280' }}>{s.related}</div>
                {m.related.map(f => <button key={f.id} style={chip} onClick={() => ask(show(f), f)}>{show(f)}</button>)}
              </>
            )}
            {m.none && !live && (
              <>
                <button disabled={busy} style={{ ...chip, background: '#047857', color: '#fff', border: 'none', padding: '7px 12px', fontSize: 13 }} onClick={() => startLive(m.q)}>{s.person}</button>
                {POPULAR.slice(0, 3).map(id => { const f = byId(id); return f && (
                  <button key={id} style={chip} onClick={() => ask(show(f), f)}>{show(f)}</button>
                ); })}
              </>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {!live && (
        <div style={{ padding: '4px 12px', background: '#f9fafb', fontSize: 12, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <button disabled={busy} onClick={() => startLive()} style={{ ...btn, background: 'none', color: '#047857', fontWeight: 600, fontSize: 12 }}>{s.person}</button>
          {msgs.length > 0 && (reported
            ? <span style={{ color: '#065f46' }}>{s.reported}</span>
            : <button onClick={report} style={{ ...btn, background: 'none', color: '#6b7280', textDecoration: 'underline', fontSize: 12 }}>{s.report}</button>)}
        </div>
      )}

      <form onSubmit={e => { e.preventDefault(); ask(text); }} style={{ display: 'flex', gap: 6, padding: 10, borderTop: '1px solid #dedede' }}>
        <input value={text} onChange={e => setText(e.target.value)} placeholder={live ? s.livePlaceholder : s.placeholder} maxLength={live ? 1000 : 300}
          style={{ flex: 1, padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }} />
        <button type="submit" disabled={!text.trim()}
          style={{ ...btn, background: live ? '#047857' : '#1a56db', color: '#fff', padding: '0 14px', opacity: text.trim() ? 1 : .5 }}>{live ? s.liveSend : s.send}</button>
      </form>
    </div>
  );
}

function Bubble({ role, label, children }) {
  const mine = role === 'user', agent = role === 'agent', isNote = role === 'note';
  if (isNote) return <div style={{ fontSize: 11.5, color: '#6b7280', textAlign: 'center', padding: '2px 8px' }}>{children}</div>;
  return (
    <div style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '90%', padding: '8px 11px', borderRadius: 10,
      fontSize: 13, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      background: mine ? '#1a56db' : agent ? '#ecfdf5' : '#fff', color: mine ? '#fff' : '#1f2937',
      border: mine ? 'none' : agent ? '1px solid #a7f3d0' : '1px solid #e5e7eb' }}>
      {label && <div style={{ fontSize: 10.5, fontWeight: 700, color: '#047857', marginBottom: 2 }}>{label}</div>}
      {children}
    </div>
  );
}
