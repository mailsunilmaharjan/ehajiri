import React, { useCallback, useEffect, useState } from 'react';
import api from '../api/client.js';
import { Empty, Sheet, Spinner, useMT } from './kit.jsx';

/* Messages sent to me inside eHajiri (approval requests, notices, system messages). */
const htmlToText = (h = '') => String(h)
  .replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\n{3,}/g, '\n\n').trim();
const ago = (v) => {
  const d = new Date(v); if (isNaN(d)) return '';
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return 'now'; if (s < 3600) return `${Math.floor(s / 60)}m`; if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

export default function MobileInbox() {
  const mt = useMT();
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(null);

  const load = useCallback(() => api.get('/messages').then(r => { setRows(Array.isArray(r) ? r : []); setErr(''); }).catch(e => { setErr(e.message || 'Could not load'); setRows([]); }), []);
  useEffect(() => { load(); }, [load]);

  const show = (m) => {
    setOpen(m);
    if (!m.is_read) {
      api.put(`/messages/${m.id}/read`, {}).catch(() => {});
      setRows(rs => rs.map(x => (x.id === m.id ? { ...x, is_read: true } : x)));
    }
  };
  const unread = (rows || []).filter(r => !r.is_read).length;

  return (
    <>
      <div className="m-row" style={{ margin: '2px 4px 10px' }}>
        <div className="m-grow m-muted">{unread > 0 ? `${unread} ${mt('Unread')}` : mt('Messages')}</div>
        <button className="m-btn m-sm m-ghost" onClick={() => { setRows(null); load(); }}>↻</button>
      </div>
      {rows === null && <div className="m-empty"><Spinner dark /></div>}
      {err && <div className="m-err">{err}</div>}
      {rows && rows.length === 0 && !err && <div className="m-card"><Empty icon="📭" text={mt('Nothing here yet')} /></div>}
      {rows && rows.length > 0 && (
        <div className="m-card m-flat">
          {rows.map(m => (
            <button key={m.id} className="m-list-item" data-st={m.is_read ? "info" : "unread"} onClick={() => show(m)}>
              <span className="m-list-ico" style={{ background: m.is_read ? '#f3f4f6' : '#dbeafe' }}>{m.is_read ? '✉️' : '📩'}</span>
              <span className="m-grow" style={{ minWidth: 0 }}>
                <b className="m-ell" style={{ display: 'block', fontWeight: m.is_read ? 600 : 800 }}>{m.subject || '(no subject)'}</b>
                <span className="m-muted m-ell" style={{ display: 'block' }}>{m.sender_name}{m.body ? ' · ' + htmlToText(m.body).replace(/\s+/g, ' ').slice(0, 70) : ''}</span>
              </span>
              <span className="m-muted" style={{ fontSize: 12, alignSelf: 'flex-start' }}>{ago(m.created_at)}</span>
            </button>
          ))}
        </div>
      )}
      {open && (
        <Sheet title={open.subject || '(no subject)'} onClose={() => setOpen(null)}>
          <div className="m-muted" style={{ marginBottom: 10 }}>{open.sender_name} · {new Date(open.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
          <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', userSelect: 'text' }}>{htmlToText(open.body) || '—'}</div>
        </Sheet>
      )}
    </>
  );
}
