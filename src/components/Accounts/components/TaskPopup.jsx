import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../../api/client.js';
import Avatar from '../../Common/Avatar.jsx';
import { useApp } from '../context';
import { fmtBs } from '../lib/dates';
import { useShortcuts } from '../lib/keys';

/**
 * The Task module's own history, shown as a pop-up on the quotation: status, follow-up history, the selected
 * follow-up's description with its replies (chat), and a form to log a new follow-up or send a reply.
 * It reads and writes the same /api/tasks data as the Task page — nothing is copied.
 * A follow-up on a Pending task turns it to In Progress ("Processing") on the server.
 */
const STATUS = [['pending', 'Pending'], ['in_progress', 'In Progress'], ['completed', 'Completed'], ['cancelled', 'Cancelled']];
const MODES = [['phone', '📞 Phone'], ['whatsapp', '💬 WhatsApp'], ['sms', '✉️ SMS'], ['email', '📧 Email']];
const MODE_ICON = Object.fromEntries(MODES.map(([k, l]) => [k, l.split(' ')[0]]));
const d10 = (v) => String(v || '').split('T')[0];
const todayISO = () => new Date().toISOString().slice(0, 10);
const stamp = (v) => (v ? new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const plain = (h) => String(h || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();

const card = (bg, border) => ({ border: `1px solid ${border}`, borderRadius: 10, overflow: 'hidden', background: '#fff' });
const cardHead = (bg, border, color) => ({ background: bg, padding: '8px 12px', borderBottom: `1px solid ${border}`, display: 'flex', alignItems: 'center', gap: 7, fontSize: 10.5, fontWeight: 700, letterSpacing: '.4px', color });

export default function TaskPopup({ doc, tasks, onClose }) {
  const { notify } = useApp();
  const [idx, setIdx] = useState(Math.max(0, tasks.length - 1));
  const link = tasks[Math.min(idx, tasks.length - 1)];
  const taskId = link?.task_id;

  const [task, setTask] = useState(null);
  const [err, setErr] = useState('');
  const [followups, setFollowups] = useState([]);
  const [selId, setSelId] = useState(null);
  const [replies, setReplies] = useState([]);
  const [form, setForm] = useState(null);                // null = closed
  const [reply, setReply] = useState({ text: '', to: null });
  const [busy, setBusy] = useState(false);
  useShortcuts({ close: onClose });

  const loadTask = useCallback(() => api.get(`/tasks/${taskId}`).then(setTask), [taskId]);
  const loadFollowups = useCallback(async (keep) => {
    const rows = await api.get(`/tasks/${taskId}/followups`);
    const list = Array.isArray(rows) ? rows : [];
    setFollowups(list);
    setSelId((cur) => (keep && list.some((f) => f.id === cur) ? cur : list[0]?.id ?? null));
  }, [taskId]);

  useEffect(() => {
    setTask(null); setErr(''); setFollowups([]); setSelId(null); setReplies([]); setForm(null);
    Promise.all([loadTask(), loadFollowups(false)])
      .then(() => { api.put(`/tasks/${taskId}/seen`, {}).catch(() => {}); api.post(`/tasks/${taskId}/notifications/read`, {}).catch(() => {}); })
      .catch((e) => setErr(/not found/i.test(e.message || '') ? 'You do not have access to this task.' : (e.message || 'Could not load the task.')));
  }, [taskId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setReplies([]);
    if (!selId) return;
    api.get(`/tasks/${taskId}/followups/${selId}/replies`).then((r) => setReplies(Array.isArray(r) ? r : [])).catch(() => {});
  }, [selId, taskId]);

  const sel = followups.find((f) => f.id === selId) || null;

  const setStatus = async (status) => {
    try { await api.patch(`/tasks/${taskId}/status`, { status }); setTask((t) => ({ ...t, status })); } catch (e) { notify(e.message, 'err'); }
  };
  const saveFollowup = async (e) => {
    e?.preventDefault();
    if (busy) return;
    if (!form.description.trim()) { notify('Write what happened in this follow-up.', 'err'); return; }
    setBusy(true);
    try {
      await api.post(`/tasks/${taskId}/followups`, { mode: form.mode, followupDate: form.date, description: form.description.trim() });
      setForm(null);
      await Promise.all([loadFollowups(false), loadTask()]);      // the task turns to In Progress on the server
      notify('Follow-up added');
    } catch (err2) { notify(err2.message, 'err'); }
    setBusy(false);
  };
  const sendReply = async () => {
    if (!reply.text.trim() || !selId) return;
    try {
      const r = await api.post(`/tasks/${taskId}/followups/${selId}/replies`, { message: reply.text.trim(), parentReplyId: reply.to?.id || null });
      setReplies((x) => [...x, r]); setReply({ text: '', to: null });
    } catch (e) { notify(e.message, 'err'); }
  };

  const tree = useMemo(() => {
    const by = new Map();
    replies.forEach((r) => { const k = r.parentReplyId || 'root'; if (!by.has(k)) by.set(k, []); by.get(k).push(r); });
    return by;
  }, [replies]);
  const bubble = (r) => (
    <div key={r.id}>
      <div style={{ display: 'flex', gap: 8 }}>
        <Avatar photo={r.userPhoto} name={r.userName} size={24} style={{ marginTop: 1 }} />
        <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: '#374151', lineHeight: 1.5 }}>
          <span style={{ fontWeight: 700, color: '#1e293b' }}>{r.userName || '—'}</span>{r.userPost && <span style={{ color: '#9ca3af' }}> ({r.userPost})</span>}: <span style={{ whiteSpace: 'pre-wrap' }}>{r.message}</span>
          <div style={{ fontSize: 11, color: '#9ca3af' }}>
            <button type="button" className="link" style={{ padding: 0, fontSize: 11, fontWeight: 700, color: '#6b7280' }} onClick={() => setReply({ ...reply, to: { id: r.id, name: r.userName } })}>Reply</button>
            {' · '}{stamp(r.createdAt)}
          </div>
        </div>
      </div>
      {(tree.get(r.id) || []).length > 0 && <div style={{ marginLeft: 12, paddingLeft: 14, borderLeft: '2px solid #f1f5f9', marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>{tree.get(r.id).map(bubble)}</div>}
    </div>
  );

  const open = task && task.status !== 'completed' && task.status !== 'cancelled';
  return (
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card form task-pop" style={{ width: 'min(860px, 96vw)', maxHeight: '92vh', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0 }}>📌 {task?.title || `${doc.doc_no}`}</h2>
            <div className="muted small">{doc.doc_no} · {doc.party_name}{doc.qt_subject ? ` · ${doc.qt_subject}` : ''}</div>
          </div>
          <button type="button" className="ghost" onClick={onClose} title="Close (Esc)" style={{ padding: '2px 10px' }}>✕</button>
        </div>

        {tasks.length > 1 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {tasks.map((t, i) => <button type="button" key={t.id} className={i === idx ? '' : 'ghost'} onClick={() => setIdx(i)}>{t.assigned_name} · {fmtBs(d10(t.remind_on))}</button>)}
          </div>
        )}

        {err && <div className="muted" style={{ padding: 12 }}>{err}</div>}
        {!err && !task && <div className="muted" style={{ padding: 12 }}>Loading…</div>}

        {task && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <select value={task.status} onChange={(e) => setStatus(e.target.value)}
                style={{ height: 26, border: '1px solid #d1d5db', borderRadius: 6, padding: '0 8px', fontSize: 11.5, fontWeight: 700, width: 'auto' }}>
                {STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              {task.priorityName && <span className="tag" style={{ background: '#fef3c7', color: '#92400e' }}>{task.priorityName}</span>}
              {task.categoryName && <span style={{ color: '#1d4ed8', fontSize: 12.5 }}>{task.categoryName}</span>}
              <span style={{ fontSize: 12.5 }}><b>Assigned to:</b> {(task.assignees || []).map((a) => a.name).join(', ') || '—'}</span>
              {task.dueDate && <span style={{ fontSize: 12.5 }}><b>Task date:</b> {fmtBs(d10(task.dueDate))}</span>}
            </div>
            <div style={{ padding: '6px 10px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 7 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#166534' }}>{task.customerName || 'No client linked'}{task.personName ? ` — ${task.personName}` : ''}</div>
              {(task.customerMobile || task.customerPhone) && <div style={{ fontSize: 13, color: '#15803d' }}>{[task.customerMobile, task.customerPhone].filter(Boolean).join(' | ')}</div>}
            </div>

            <div style={card('#eff6ff', '#dbeafe')}>
              <div style={cardHead('#eff6ff', '#dbeafe', '#1d4ed8')}>
                <span>📋 FOLLOWUP HISTORY</span>
                {open && !form && <button type="button" style={{ marginLeft: 'auto', height: 26, padding: '0 10px', fontSize: 11 }} onClick={() => setForm({ mode: 'phone', date: todayISO(), description: '' })}>+ New</button>}
              </div>
              {form && (
                <form onSubmit={saveFollowup} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: 8, background: '#f8fbff', borderBottom: '1px solid #dbeafe', flexWrap: 'wrap' }}>
                  <select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })} style={{ width: 120 }}>{MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                  <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} style={{ width: 140 }} />
                  <textarea autoFocus rows={2} style={{ flex: 1, minWidth: 220 }} maxLength={5000} value={form.description} placeholder="What happened in this follow-up?"
                    onChange={(e) => setForm({ ...form, description: e.target.value })} />
                  <button data-save disabled={busy}>Save</button>
                  <button type="button" className="ghost" onClick={() => setForm(null)}>Cancel</button>
                </form>
              )}
              <div style={{ maxHeight: 190, overflow: 'auto' }}>
                <table className="grid dg-soft" style={{ margin: 0 }}>
                  <thead><tr><th className="sn">SN</th><th style={{ width: 110 }}>Date</th><th style={{ width: 50 }}>Via</th><th style={{ width: 150 }}>By</th><th>Followup</th></tr></thead>
                  <tbody>
                    {followups.length === 0 && <tr><td colSpan={5} className="muted">No follow-up yet.{open ? ' Click “+ New” — the task then turns to In Progress.' : ''}</td></tr>}
                    {followups.map((f, i) => (
                      <tr key={f.id} className={f.id === selId ? 'current' : ''} onClick={() => setSelId(f.id)} style={{ cursor: 'pointer' }}>
                        <td className="sn">{i + 1}</td><td className="nowrap">{fmtBs(d10(f.followupDate))}</td><td title={f.mode}>{MODE_ICON[f.mode] || f.mode}</td>
                        <td>{f.followedByName}</td><td style={{ whiteSpace: 'pre-wrap' }}>{plain(f.description) || <span className="muted">—</span>}{f.handedOverToName ? <span className="muted"> → {f.handedOverToName}</span> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={card('#fffbeb', '#fde68a')}>
              <div style={cardHead('#fffbeb', '#fde68a', '#b45309')}><span>📝 DESCRIPTION &amp; REPLIES</span><span className="muted" style={{ fontWeight: 400, letterSpacing: 0 }}>of the selected follow-up</span></div>
              <div style={{ display: 'flex', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 260px', padding: '10px 12px', minWidth: 0 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#b45309', textTransform: 'uppercase', marginBottom: 4 }}>Description</div>
                  <div style={{ fontSize: 12.5, color: '#374151', whiteSpace: 'pre-wrap' }}>{sel ? (plain(sel.description) || '—') : <span className="muted">Select a follow-up</span>}</div>
                  {sel && <div className="muted small" style={{ marginTop: 6 }}>Followed up by <b>{sel.followedByName}</b>{sel.followedByPost ? ` (${sel.followedByPost})` : ''} · {stamp(sel.createdAt)}</div>}
                </div>
                <div style={{ flex: '1 1 300px', borderLeft: '1px solid #fef3c7', background: '#fffdf7', padding: '10px 12px', minWidth: 0 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#92400e', textTransform: 'uppercase', marginBottom: 4 }}>Replies</div>
                  <div style={{ maxHeight: 130, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {!sel ? null : replies.length === 0 ? <div className="muted small">No replies yet</div> : (tree.get('root') || []).map(bubble)}
                  </div>
                  {sel && (
                    <div style={{ marginTop: 6 }}>
                      {reply.to && <div className="muted small">Replying to {reply.to.name} <button type="button" className="link" style={{ padding: 0 }} onClick={() => setReply({ ...reply, to: null })}>✕</button></div>}
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input style={{ flex: 1 }} value={reply.text} placeholder="Write a reply…" onChange={(e) => setReply({ ...reply, text: e.target.value })}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); sendReply(); } }} />
                        <button type="button" onClick={sendReply}>Send</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div style={{ borderTop: '1px solid #dedede', paddingTop: 8, fontSize: 12.5 }}>
              <b>Remarks:</b> {link?.note ? <span style={{ whiteSpace: 'pre-wrap' }}>{link.note}</span> : <span className="muted">no remarks on this task</span>}
            </div>
          </>
        )}
        <div className="actions"><span className="spacer" /><button type="button" className="ghost" onClick={onClose}>Close <kbd className="kbd">Esc</kbd></button></div>
      </div>
    </div>
  );
}
