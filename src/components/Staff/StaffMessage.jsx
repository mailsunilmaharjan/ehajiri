import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useAuth }     from '../../context/AuthContext.jsx';
import { useData }     from '../../context/DataContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import { useNotifications } from '../Notifications/AttendanceToasts.jsx';
import SearchableSelect from '../Common/SearchableSelect.jsx';
import DataGrid from '../DataGrid/DataGrid.jsx';
import api from '../../api/client.js';

/* ─── helpers ─────────────────────────────────── */
const fmtFull = (d) => d ? new Date(d).toLocaleString() : '—';

/** Sent-tab rows/reading-pane don't have a sender — describe the audience instead. */
const recipientLabel = (msg) =>
  msg.recipient_type === 'all' ? 'All Staff'
  : msg.recipient_type === 'department' ? (msg.department || 'Department')
  : `${msg.total_recipients || 0} recipient(s)`;

const RecipientBadge = ({ type, department }) => {
  const map = {
    all        : { bg: '#eff6ff', color: '#1e40af', label: '📢 All Staff' },
    department : { bg: '#f5f3ff', color: '#6d28d9', label: `🏢 ${department || 'Dept.'}` },
    individual : { bg: '#f0fdf4', color: '#065f46', label: '👤 Personal' },
  };
  const s = map[type] || map.individual;
  return (
    <span style={{ background: s.bg, color: s.color, borderRadius: 10,
      padding: '1px 9px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
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
          <h2 style={{ color: '#1e40af' }}>✉ New Message</h2>
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

/* ─── Reading pane (right column) ──────────────── */
const ReadingPane = ({ msg, folder, onDelete }) => {
  const fromLabel = folder === 'inbox' ? (msg.sender_name || '—') : recipientLabel(msg);
  const initial = (fromLabel || '?')[0]?.toUpperCase() || '?';

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 20px', borderBottom: '1px solid #f3f4f6', flexShrink: 0 }}>
        <RecipientBadge type={msg.recipient_type} department={msg.department} />
        <button
          onClick={() => onDelete(msg)}
          title="Delete message"
          style={{ background: 'none', border: '1px solid #fca5a5', color: '#dc2626',
            borderRadius: 7, padding: '5px 13px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
          🗑 Delete
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 30px' }}>
        <h2 style={{ fontSize: 19, fontWeight: 700, color: '#111827', marginBottom: 18, wordBreak: 'break-word' }}>
          {msg.subject}
        </h2>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20,
          paddingBottom: 18, borderBottom: '1px solid #f3f4f6' }}>
          <div style={{ width: 42, height: 42, borderRadius: '50%', flexShrink: 0,
            background: '#eff6ff', color: '#1a56db', display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontWeight: 700, fontSize: 16 }}>
            {initial}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#111827' }}>{fromLabel}</div>
            <div style={{ fontSize: 12, color: '#9ca3af' }}>{fmtFull(msg.created_at)}</div>
          </div>
          {folder === 'sent' && msg.total_recipients > 0 && (
            <div style={{ fontSize: 12, color: '#6b7280', flexShrink: 0 }}>
              {msg.read_count}/{msg.total_recipients} read
            </div>
          )}
        </div>

        <div style={{ fontSize: 14, color: '#374151', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
          {msg.body}
        </div>
      </div>
    </>
  );
};

const EmptyReadingPane = () => (
  <div style={{ flex: 1, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', color: '#9ca3af' }}>
    <div style={{ fontSize: 44, marginBottom: 10 }}>📨</div>
    <div style={{ fontSize: 14, fontWeight: 600, color: '#6b7280' }}>Select a message to read</div>
  </div>
);

/* ─── Big message popup (opened on row double-click) ───── */
const BigMessageModal = ({ msg, onClose, onDelete, onReply }) => {
  const isSent = !!msg._sent;
  const fromLabel = isSent ? recipientLabel(msg) : (msg.sender_name || '—');
  const initial = (fromLabel || '?')[0]?.toUpperCase() || '?';

  const [replyText, setReplyText] = useState('');
  const [sending,   setSending]   = useState(false);

  const send = async () => {
    if (!replyText.trim()) return;
    setSending(true);
    const ok = await onReply(msg, replyText);
    setSending(false);
    if (ok) onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 760, width: '92%' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header" style={{ background: 'linear-gradient(135deg,#eff6ff,#dbeafe)' }}>
          <h2 style={{ color: '#1e40af', fontSize: 16, wordBreak: 'break-word' }}>✉ {msg.subject}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body" style={{ maxHeight: '65vh', overflowY: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18,
            paddingBottom: 16, borderBottom: '1px solid #f3f4f6' }}>
            <div style={{ width: 46, height: 46, borderRadius: '50%', flexShrink: 0,
              background: '#eff6ff', color: '#1a56db', display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontWeight: 700, fontSize: 18 }}>
              {initial}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: '#111827' }}>{fromLabel}</div>
              <div style={{ fontSize: 12, color: '#9ca3af' }}>{fmtFull(msg.created_at)}</div>
            </div>
            <RecipientBadge type={msg.recipient_type} department={msg.department} />
            {isSent && msg.total_recipients > 0 && (
              <div style={{ fontSize: 12, color: '#6b7280', flexShrink: 0 }}>
                {msg.read_count}/{msg.total_recipients} read
              </div>
            )}
          </div>

          <div style={{ fontSize: 14, color: '#374151', lineHeight: 1.8, whiteSpace: 'pre-wrap', marginBottom: 22 }}>
            {msg.body}
          </div>

          {!isSent && (
            <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 8 }}>
                ↩ Reply to {msg.sender_name}
              </div>
              <textarea
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
                rows={4}
                placeholder="Type your reply…"
                style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 7, padding: '8px 10px',
                  fontSize: 13, resize: 'vertical', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
              />
            </div>
          )}
        </div>

        <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
          <button
            onClick={() => onDelete(msg)}
            style={{ background: 'none', border: '1px solid #fca5a5', color: '#dc2626',
              borderRadius: 7, padding: '6px 14px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
            🗑 Delete
          </button>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-outline" onClick={onClose}>Close</button>
            {!isSent && (
              <button className="btn btn-primary" onClick={send} disabled={sending || !replyText.trim()}>
                {sending ? '⏳ Sending…' : '↩ Send Reply'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/* ─── Main Component ───────────────────────────── */
const StaffMessage = () => {
  const { currentUser } = useAuth();
  const { filteredEmployees, employees } = useData();
  const { settings } = useSettings();
  const { clearMsgCount } = useNotifications();

  const [folder,    setFolder]    = useState('inbox');
  const [inbox,     setInbox]     = useState([]);
  const [sent,      setSent]      = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [selected,  setSelected]  = useState(null);
  const [compose,   setCompose]   = useState(false);
  const [toast,     setToast]     = useState(null);
  const [delConfirm, setDelConfirm] = useState(null);   // holds the whole msg object being confirmed
  const [selectedIds, setSelectedIds] = useState([]);   // checkbox multi-select (inbox only)
  const [bigMsg,    setBigMsg]    = useState(null);      // message shown in the big popup (double-click)

  /* ── Resizable list / reading-pane splitter ── */
  const [midWidth, setMidWidth] = useState(640);
  const containerRef = useRef(null);
  const resizingRef  = useRef(false);

  useEffect(() => {
    const onMove = (e) => {
      if (!resizingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const railWidth = 190;
      let next = e.clientX - rect.left - railWidth;
      next = Math.max(380, Math.min(next, rect.width - railWidth - 320));
      setMidWidth(next);
    };
    const onUp = () => {
      if (!resizingRef.current) return;
      resizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const startResize = (e) => {
    e.preventDefault();
    resizingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

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

  const selectFolder = (key) => {
    setFolder(key);
    setSelected(null);
    setSelectedIds([]);
    setBigMsg(null);
  };

  /** Opens the given row in the big popup — also drives the reading pane and read status, same as a single click. */
  const openBig = (row) => {
    if (folder === 'inbox') {
      openMessage(row);
      setBigMsg({ ...row, is_read: true });
    } else {
      const withFlag = { ...row, _sent: true };
      setSelected(withFlag);
      setBigMsg(withFlag);
    }
  };

  const deleteMsg = async (msg) => {
    try {
      await api.delete(`/messages/${msg.id}`);
      if (!msg._sent) setInbox(prev => prev.filter(m => m.id !== msg.id));
      setSelected(prev => (prev && prev.id === msg.id) ? null : prev);
      setBigMsg(prev => (prev && prev.id === msg.id) ? null : prev);
      setDelConfirm(null);
      showToast('Message deleted');
    } catch (e) { showToast(e.message || 'Delete failed', 'error'); }
  };

  /** Bulk-delete via DataGrid checkboxes — inbox only (deleting removes the recipient's own copy). */
  const bulkDelete = async (ids) => {
    try {
      await Promise.all(ids.map(id => api.delete(`/messages/${id}`)));
      setInbox(prev => prev.filter(m => !ids.includes(m.id)));
      setSelected(prev => (prev && ids.includes(prev.id)) ? null : prev);
      setBigMsg(prev => (prev && ids.includes(prev.id)) ? null : prev);
      setSelectedIds([]);
      showToast(`${ids.length} message(s) deleted`);
    } catch (e) { showToast(e.message || 'Delete failed', 'error'); }
  };

  /** Reply from the big popup — always a direct individual message back to the original sender. */
  const sendReply = async (msg, text) => {
    try {
      await api.post('/messages', {
        recipientType: 'individual',
        recipientIds : [msg.sender_id],
        department   : null,
        subject      : msg.subject?.startsWith('Re: ') ? msg.subject : `Re: ${msg.subject}`,
        body         : text.trim(),
      });
      showToast('Reply sent');
      loadSent();
      return true;
    } catch (e) {
      showToast(e.message || 'Failed to send reply', 'error');
      return false;
    }
  };

  const unread = useMemo(() => inbox.filter(m => !m.is_read).length, [inbox]);

  const folders = [
    { key: 'inbox', label: 'Inbox', icon: '📥', count: unread },
    { key: 'sent',  label: 'Sent',  icon: '📤', count: 0 },
  ];

  const currentList = folder === 'inbox' ? inbox : sent;

  const columns = useMemo(() => {
    const typeCol = {
      field: 'recipient_type', header: 'Type', width: 130, align: 'center', sortable: false, filterable: false,
      render: (v, row) => <RecipientBadge type={v} department={row.department} />,
    };
    const dateCol = {
      field: 'created_at', header: 'Date', width: 160,
      render: v => fmtFull(v),
    };
    const subjectCol = {
      field: 'subject', header: 'Subject', width: 260,
      render: (v, row) => <span style={{ fontWeight: (folder === 'inbox' && !row.is_read) ? 700 : 400 }}>{v}</span>,
    };

    if (folder === 'inbox') {
      return [
        {
          field: 'sender_name', header: 'From', width: 170,
          render: (v, row) => <span style={{ fontWeight: row.is_read ? 500 : 700, color: row.is_read ? '#374151' : '#111827' }}>{v}</span>,
        },
        subjectCol,
        typeCol,
        {
          field: 'is_read', header: 'Status', width: 100, align: 'center', sortable: false,
          render: v => v
            ? <span style={{ background: '#f3f4f6', color: '#6b7280', borderRadius: 10, padding: '1px 9px', fontSize: 11, fontWeight: 700 }}>Read</span>
            : <span style={{ background: '#eff6ff', color: '#1a56db', borderRadius: 10, padding: '1px 9px', fontSize: 11, fontWeight: 700 }}>● Unread</span>,
        },
        dateCol,
      ];
    }

    return [
      {
        field: '_to', header: 'To', width: 170, sortable: false, filterable: false,
        render: (_, row) => recipientLabel(row),
      },
      subjectCol,
      typeCol,
      {
        field: 'read_count', header: 'Read', width: 100, align: 'center', sortable: false,
        render: (v, row) => row.total_recipients > 0 ? `${v}/${row.total_recipients}` : '—',
      },
      dateCol,
    ];
  }, [folder]);

  return (
    <div className="page-container" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 60px)', boxSizing: 'border-box' }}>
      {/* ── Header ── */}
      <div className="page-header" style={{ flexShrink: 0 }}>
        <div>
          <h1 className="page-title">💬 Messages</h1>
          <p className="page-subtitle">Internal communication — Individual, All Staff, Department</p>
        </div>
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

      {/* ── Outlook-style 3-pane layout ── */}
      <div ref={containerRef} style={{ flex: 1, minHeight: 0, display: 'flex',
        border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>

        {/* Left rail — folders */}
        <div style={{ width: 190, flexShrink: 0, borderRight: '1px solid #e5e7eb',
          background: '#f9fafb', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: 14 }}>
            <button
              onClick={() => setCompose(true)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                padding: '9px 0', background: '#1a56db', color: '#fff', border: 'none',
                borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(26,86,219,.25)' }}>
              ✉ New Message
            </button>
          </div>
          <div style={{ padding: '2px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {folders.map(f => (
              <div key={f.key}
                onClick={() => selectFolder(f.key)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px',
                  borderRadius: 7, cursor: 'pointer', fontSize: 13, fontWeight: 600,
                  color: folder === f.key ? '#1a56db' : '#374151',
                  background: folder === f.key ? '#e0e7f0' : 'transparent' }}
                onMouseEnter={e => { if (folder !== f.key) e.currentTarget.style.background = '#f0f0f0'; }}
                onMouseLeave={e => { if (folder !== f.key) e.currentTarget.style.background = 'transparent'; }}>
                <span>{f.icon}</span>
                <span style={{ flex: 1 }}>{f.label}</span>
                {f.count > 0 && (
                  <span style={{ background: '#dc2626', color: '#fff', borderRadius: 10,
                    fontSize: 10, fontWeight: 700, padding: '1px 6px', minWidth: 18,
                    textAlign: 'center' }}>
                    {f.count}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Middle — message list (classic DataGrid) */}
        <div style={{ width: midWidth, flexShrink: 0, borderRight: '1px solid #e5e7eb',
          display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
              Loading…
            </div>
          ) : (
            <div className="dg-fixed-height" style={{ height: '100%' }}>
              <DataGrid
                key={folder}
                columns={columns}
                data={currentList}
                rowKey="id"
                title={folder === 'inbox' ? 'Inbox' : 'Sent'}
                showCheckbox={folder === 'inbox'}
                searchPlaceholder={folder === 'inbox' ? 'Search inbox…' : 'Search sent…'}
                onRowClick={(row) => folder === 'inbox' ? openMessage(row) : setSelected({ ...row, _sent: true })}
                onRowDoubleClick={openBig}
                onSelectionChange={setSelectedIds}
                onDeleteSelected={folder === 'inbox' ? bulkDelete : undefined}
                selectionActions={
                  selectedIds.length === 1 && (
                    <button
                      onClick={() => openBig(currentList.find(m => m.id === selectedIds[0]))}
                      style={{ background: '#dbeafe', color: '#1e40af', border: 'none', borderRadius: 6,
                        padding: '4px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                      ✏️ Edit
                    </button>
                  )
                }
              />
            </div>
          )}
        </div>

        {/* Drag handle — resize the reading pane by dragging left/right */}
        <div
          onMouseDown={startResize}
          title="Drag to resize"
          style={{ width: 6, flexShrink: 0, cursor: 'col-resize', position: 'relative', background: '#fff' }}
          onMouseEnter={e => { e.currentTarget.firstChild.style.background = '#93c5fd'; }}
          onMouseLeave={e => { e.currentTarget.firstChild.style.background = '#e5e7eb'; }}>
          <div style={{ position: 'absolute', left: 2, top: 0, bottom: 0, width: 2, background: '#e5e7eb', transition: 'background .12s' }} />
        </div>

        {/* Right — reading pane */}
        <div style={{ flex: 1, minWidth: 280, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {selected
            ? <ReadingPane msg={selected} folder={folder} onDelete={(m) => setDelConfirm(m)} />
            : <EmptyReadingPane />}
        </div>
      </div>

      {/* ── Big popup (double-click a row) ── */}
      {bigMsg && (
        <BigMessageModal
          msg={bigMsg}
          onClose={() => setBigMsg(null)}
          onDelete={(m) => setDelConfirm(m)}
          onReply={sendReply}
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
                Remove <strong>{delConfirm.subject}</strong> from your inbox? This cannot be undone.
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
