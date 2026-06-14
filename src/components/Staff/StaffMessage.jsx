import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth }     from '../../context/AuthContext.jsx';
import { useData }     from '../../context/DataContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import { useNotifications } from '../Notifications/AttendanceToasts.jsx';
import SearchableSelect from '../Common/SearchableSelect.jsx';
import api from '../../api/client.js';

/* ─── helpers ─────────────────────────────────── */
const fmtDate = (d) => {
  if (!d) return '—';
  const dt  = new Date(d);
  const now = new Date();
  const diffMs  = now - dt;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1)  return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24)   return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7)    return `${diffD}d ago`;
  return dt.toLocaleDateString();
};

const fmtFull = (d) => d ? new Date(d).toLocaleString() : '—';

const RecipientBadge = ({ type, department }) => {
  const map = {
    all        : { bg: '#eff6ff', color: '#1e40af', label: '📢 All Staff' },
    department : { bg: '#f5f3ff', color: '#6d28d9', label: `🏢 ${department || 'Dept.'}` },
    individual : { bg: '#f0fdf4', color: '#065f46', label: '👤 Personal' },
  };
  const s = map[type] || map.individual;
  return (
    <span style={{ background: s.bg, color: s.color, borderRadius: 10,
      padding: '1px 9px', fontSize: 11, fontWeight: 700 }}>
      {s.label}
    </span>
  );
};

/* ─── Compose Modal ────────────────────────────── */
const ComposeModal = ({ onClose, onSent, employees, settings }) => {
  const [form, setForm] = useState({
    recipientType: 'individual',
    recipientIds : [],
    department   : '',
    subject      : '',
    body         : '',
  });
  const [errors,  setErrors]  = useState({});
  const [sending, setSending] = useState(false);

  const deptOptions = useMemo(() =>
    (settings.departments || []).map(d => ({ value: d.name, label: d.name })),
  [settings.departments]);

  const empOptions = useMemo(() =>
    employees.map(e => ({ value: String(e.id), label: `${e.fullName} (${e.employeeId})` })),
  [employees]);

  const validate = () => {
    const e = {};
    if (!form.subject.trim()) e.subject = 'Subject is required';
    if (!form.body.trim())    e.body    = 'Message body is required';
    if (form.recipientType === 'individual' && !form.recipientIds.length)
      e.recipientIds = 'Select at least one recipient';
    if (form.recipientType === 'department' && !form.department)
      e.department = 'Select a department';
    return e;
  };

  const send = async () => {
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setSending(true);
    try {
      const res = await api.post('/messages', {
        recipientType: form.recipientType,
        recipientIds : form.recipientIds.map(Number),
        department   : form.department || null,
        subject      : form.subject,
        body         : form.body,
      });
      onSent(res.recipientCount);
      onClose();
    } catch (err) {
      setErrors({ body: err.message || 'Failed to send' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header" style={{ background: 'linear-gradient(135deg,#eff6ff,#dbeafe)' }}>
          <h2 style={{ color: '#1e40af' }}>✉ Compose Message</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Recipient type */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8 }}>
              Send To <span style={{ color: '#dc2626' }}>*</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {[
                { v: 'individual', label: '👤 Individual',   desc: 'Specific staff' },
                { v: 'all',        label: '📢 All Staff',    desc: 'Everyone' },
                { v: 'department', label: '🏢 Department',   desc: 'By dept.' },
              ].map(opt => (
                <label key={opt.v} style={{
                  flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                  gap: 2, padding: '8px 6px', border: `2px solid ${form.recipientType === opt.v ? '#1a56db' : '#e5e7eb'}`,
                  borderRadius: 8, cursor: 'pointer', userSelect: 'none',
                  background: form.recipientType === opt.v ? '#eff6ff' : 'white',
                  transition: 'all .12s',
                }}>
                  <input type="radio" name="rtype" value={opt.v}
                    checked={form.recipientType === opt.v}
                    onChange={() => setForm(p => ({ ...p, recipientType: opt.v, recipientIds: [], department: '' }))}
                    style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: form.recipientType === opt.v ? '#1a56db' : '#374151' }}>{opt.label}</span>
                  <span style={{ fontSize: 10, color: '#9ca3af' }}>{opt.desc}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Individual: multi-select employees */}
          {form.recipientType === 'individual' && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
                Recipients <span style={{ color: '#dc2626' }}>*</span>
              </div>
              <SearchableSelect
                value={form.recipientIds}
                onChange={v => { setForm(p => ({ ...p, recipientIds: v })); setErrors(p => ({ ...p, recipientIds: '' })); }}
                options={empOptions}
                multiple={true}
                placeholder="— Search and select staff —"
              />
              {errors.recipientIds && <div style={{ fontSize: 11, color: '#dc2626', marginTop: 3 }}>{errors.recipientIds}</div>}
            </div>
          )}

          {/* Department select */}
          {form.recipientType === 'department' && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
                Department <span style={{ color: '#dc2626' }}>*</span>
              </div>
              <SearchableSelect
                value={form.department}
                onChange={v => { setForm(p => ({ ...p, department: v })); setErrors(p => ({ ...p, department: '' })); }}
                options={deptOptions}
                placeholder="— Select department —"
              />
              {errors.department && <div style={{ fontSize: 11, color: '#dc2626', marginTop: 3 }}>{errors.department}</div>}
            </div>
          )}

          {/* All staff notice */}
          {form.recipientType === 'all' && (
            <div style={{ background: '#fefce8', border: '1px solid #fde047', borderRadius: 7,
              padding: '8px 12px', fontSize: 12, color: '#854d0e' }}>
              📢 This message will be sent to all active staff members.
            </div>
          )}

          {/* Subject */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
              Subject <span style={{ color: '#dc2626' }}>*</span>
            </div>
            <input
              type="text"
              value={form.subject}
              onChange={e => { setForm(p => ({ ...p, subject: e.target.value })); setErrors(p => ({ ...p, subject: '' })); }}
              placeholder="Message subject..."
              style={{ width: '100%', height: 36, border: `1px solid ${errors.subject ? '#dc2626' : '#d1d5db'}`,
                borderRadius: 7, padding: '0 10px', fontSize: 13, boxSizing: 'border-box', outline: 'none' }}
            />
            {errors.subject && <div style={{ fontSize: 11, color: '#dc2626', marginTop: 3 }}>{errors.subject}</div>}
          </div>

          {/* Body */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
              Message <span style={{ color: '#dc2626' }}>*</span>
            </div>
            <textarea
              value={form.body}
              onChange={e => { setForm(p => ({ ...p, body: e.target.value })); setErrors(p => ({ ...p, body: '' })); }}
              rows={5}
              placeholder="Type your message here..."
              style={{ width: '100%', border: `1px solid ${errors.body ? '#dc2626' : '#d1d5db'}`,
                borderRadius: 7, padding: '8px 10px', fontSize: 13, resize: 'vertical',
                outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
            />
            {errors.body && <div style={{ fontSize: 11, color: '#dc2626', marginTop: 3 }}>{errors.body}</div>}
          </div>

        </div>
        <div className="modal-footer">
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={send} disabled={sending}>
            {sending ? '⏳ Sending…' : '📤 Send Message'}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ─── Message Detail Modal ─────────────────────── */
const DetailModal = ({ msg, onClose, onDelete }) => (
  <div className="modal-overlay">
    <div className="modal" style={{ maxWidth: 580 }} onClick={e => e.stopPropagation()}>
      <div className="modal-header" style={{ background: 'linear-gradient(135deg,#eff6ff,#dbeafe)' }}>
        <h2 style={{ color: '#1e40af', fontSize: 15 }}>✉ {msg.subject}</h2>
        <button className="modal-close" onClick={onClose}>✕</button>
      </div>
      <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* Meta strip */}
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8,
          padding: '10px 14px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {[
            ['From',    msg.sender_name || '—'],
            ['Date',    fmtFull(msg.created_at)],
            ['Type',    <RecipientBadge key="b" type={msg.recipient_type} department={msg.department} />],
            msg.department ? ['Department', msg.department] : null,
          ].filter(Boolean).map(([lbl, val], i) => (
            <div key={i}>
              <div style={{ fontSize: 10, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', marginBottom: 2 }}>{lbl}</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1f2937' }}>{val}</div>
            </div>
          ))}
        </div>

        {/* Body */}
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8,
          padding: '14px 16px', fontSize: 14, color: '#374151', lineHeight: 1.6,
          whiteSpace: 'pre-wrap', minHeight: 80 }}>
          {msg.body}
        </div>

      </div>
      <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
        <button
          onClick={() => onDelete(msg.id)}
          style={{ background: 'none', border: '1px solid #fca5a5', color: '#dc2626',
            borderRadius: 7, padding: '6px 14px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
          🗑 Delete
        </button>
        <button className="btn btn-outline" onClick={onClose}>Close</button>
      </div>
    </div>
  </div>
);

/* ─── Main Component ───────────────────────────── */
const StaffMessage = () => {
  const { currentUser } = useAuth();
  const { filteredEmployees, employees } = useData();
  const { settings } = useSettings();
  const { clearMsgCount } = useNotifications();

  const [tab,       setTab]       = useState('inbox');
  const [inbox,     setInbox]     = useState([]);
  const [sent,      setSent]      = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [selected,  setSelected]  = useState(null);
  const [compose,   setCompose]   = useState(false);
  const [toast,     setToast]     = useState(null);
  const [delConfirm, setDelConfirm] = useState(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const loadInbox = useCallback(async () => {
    try {
      const data = await api.get('/messages');
      setInbox(Array.isArray(data) ? data : []);
    } catch (e) { showToast(e.message || 'Failed to load inbox', 'error'); }
  }, []);

  const loadSent = useCallback(async () => {
    try {
      const data = await api.get('/messages/sent');
      setSent(Array.isArray(data) ? data : []);
    } catch (e) { showToast(e.message || 'Failed to load sent', 'error'); }
  }, []);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await Promise.all([loadInbox(), loadSent()]);
      setLoading(false);
    };
    load();
    if (clearMsgCount) clearMsgCount();
  }, [loadInbox, loadSent, clearMsgCount]);

  const markRead = async (msgId) => {
    try {
      await api.put(`/messages/${msgId}/read`, {});
      setInbox(prev => prev.map(m => m.id === msgId ? { ...m, is_read: true } : m));
    } catch (_) {}
  };

  const openMessage = (msg) => {
    setSelected(msg);
    if (!msg.is_read) markRead(msg.id);
  };

  const deleteMsg = async (msgId) => {
    try {
      await api.delete(`/messages/${msgId}`);
      setInbox(prev => prev.filter(m => m.id !== msgId));
      setSelected(null);
      setDelConfirm(null);
      showToast('Message deleted');
    } catch (e) { showToast(e.message || 'Delete failed', 'error'); }
  };

  const unread = useMemo(() => inbox.filter(m => !m.is_read).length, [inbox]);

  const currentList = tab === 'inbox' ? inbox : sent;

  return (
    <div className="page-container">
      {/* ── Header ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">💬 Messages</h1>
          <p className="page-subtitle">Internal communication — Individual, All Staff, Department</p>
        </div>
        <button
          onClick={() => setCompose(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '8px 18px', background: '#1a56db', color: '#fff',
            border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600,
            cursor: 'pointer', boxShadow: '0 2px 8px rgba(26,86,219,.25)' }}>
          ✉ Compose
        </button>
      </div>

      {/* ── Toast ── */}
      {toast && (
        <div style={{ position: 'fixed', top: 70, right: 20, zIndex: 9999,
          background: toast.type === 'error' ? '#fef2f2' : '#f0fdf4',
          border: `1px solid ${toast.type === 'error' ? '#fca5a5' : '#86efac'}`,
          color: toast.type === 'error' ? '#dc2626' : '#065f46',
          borderRadius: 8, padding: '10px 18px', fontSize: 13, fontWeight: 600,
          boxShadow: '0 4px 12px rgba(0,0,0,.15)' }}>
          {toast.type === 'error' ? '❌' : '✅'} {toast.msg}
        </div>
      )}

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {[
          { key: 'inbox', label: 'Inbox', count: unread },
          { key: 'sent',  label: 'Sent',  count: 0 },
        ].map(t => (
          <button key={t.key}
            onClick={() => setTab(t.key)}
            style={{ padding: '6px 18px', borderRadius: 20, fontSize: 13, fontWeight: 600,
              cursor: 'pointer', border: 'none', transition: 'all .12s',
              background: tab === t.key ? '#1a56db' : '#f3f4f6',
              color:      tab === t.key ? '#fff'    : '#374151' }}>
            {t.label}
            {t.count > 0 && (
              <span style={{ marginLeft: 6, background: tab === t.key ? 'rgba(255,255,255,.3)' : '#dc2626',
                color: '#fff', borderRadius: 10, fontSize: 10, fontWeight: 700,
                padding: '1px 6px', minWidth: 18, display: 'inline-block', textAlign: 'center' }}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Message List ── */}
      {loading ? (
        <div style={{ padding: 48, textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>
          Loading messages…
        </div>
      ) : currentList.length === 0 ? (
        <div style={{ padding: 60, textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#374151' }}>
            {tab === 'inbox' ? 'Your inbox is empty' : 'No sent messages'}
          </div>
          <div style={{ fontSize: 13, color: '#9ca3af', marginTop: 4 }}>
            {tab === 'inbox' ? 'Messages sent to you will appear here.' : 'Messages you send will appear here.'}
          </div>
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
          {currentList.map((msg, idx) => {
            const isUnread = tab === 'inbox' && !msg.is_read;
            return (
              <div key={msg.id}
                onClick={() => tab === 'inbox' ? openMessage(msg) : setSelected({ ...msg, _sent: true })}
                style={{
                  display: 'flex', alignItems: 'center', gap: 14, padding: '13px 18px',
                  borderBottom: idx < currentList.length - 1 ? '1px solid #f3f4f6' : 'none',
                  cursor: 'pointer', transition: 'background .1s',
                  background: isUnread ? '#f0f9ff' : 'white',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = isUnread ? '#e0f2fe' : '#f9fafb'; }}
                onMouseLeave={e => { e.currentTarget.style.background = isUnread ? '#f0f9ff' : 'white'; }}>

                {/* Unread dot */}
                <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                  background: isUnread ? '#1a56db' : 'transparent' }} />

                {/* Avatar */}
                <div style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                  background: '#eff6ff', color: '#1a56db', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14 }}>
                  {(tab === 'inbox' ? msg.sender_name : 'Me')?.[0]?.toUpperCase() || '?'}
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: isUnread ? 700 : 600, color: '#111827',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {tab === 'inbox' ? msg.sender_name : (msg.recipient_type === 'all' ? 'All Staff' : msg.recipient_type === 'department' ? msg.department : `${msg.total_recipients || 0} recipient(s)`)}
                    </span>
                    <RecipientBadge type={msg.recipient_type} department={msg.department} />
                  </div>
                  <div style={{ fontSize: 13, fontWeight: isUnread ? 700 : 400, color: '#1f2937',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {msg.subject}
                  </div>
                  <div style={{ fontSize: 12, color: '#9ca3af',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                    {String(msg.body).substring(0, 80)}
                  </div>
                </div>

                {/* Right: time + sent stats */}
                <div style={{ flexShrink: 0, textAlign: 'right', minWidth: 80 }}>
                  <div style={{ fontSize: 11, color: '#9ca3af' }}>{fmtDate(msg.created_at)}</div>
                  {tab === 'sent' && msg.total_recipients > 0 && (
                    <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>
                      {msg.read_count}/{msg.total_recipients} read
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Detail Modal ── */}
      {selected && (
        <DetailModal
          msg={selected}
          onClose={() => setSelected(null)}
          onDelete={(id) => { setDelConfirm(id); }}
        />
      )}

      {/* ── Delete Confirm ── */}
      {delConfirm && (
        <div className="modal-overlay">
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header" style={{ background: 'linear-gradient(135deg,#fff5f5,#fef2f2)' }}>
              <h2>⚠️ Delete Message</h2>
              <button className="modal-close" onClick={() => setDelConfirm(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 13, color: '#374151' }}>
                Remove this message from your inbox? This cannot be undone.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setDelConfirm(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => deleteMsg(delConfirm)}>🗑 Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Compose Modal ── */}
      {compose && (
        <ComposeModal
          onClose={() => setCompose(false)}
          onSent={(count) => {
            showToast(`Message sent to ${count} recipient(s)`);
            loadSent();
          }}
          employees={filteredEmployees.filter(e => e.id !== currentUser?.id)}
          settings={settings}
        />
      )}
    </div>
  );
};

export default StaffMessage;
