import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useData } from '../../context/DataContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import DataGrid from '../DataGrid/DataGrid.jsx';
import NepaliDatePicker from '../Common/NepaliDatePicker.jsx';
import SearchableSelect from '../Common/SearchableSelect.jsx';
import SaveButton from '../Common/SaveButton.jsx';
import RichTextEditor from '../Common/RichTextEditor.jsx';
import Avatar from '../Common/Avatar.jsx';
import ContactFormModal, { CONTACT_EMPTY } from './ContactFormModal.jsx';
import useSaveShortcut from '../../hooks/useSaveShortcut.js';
import useDateFormat from '../../hooks/useDateFormat.js';
import { getNepalTodayISO } from '../../utils/dateUtils.js';

/* Task tracker (Staff > Task) — standard DataGrid layout, matching every
   other list page in the app (Staff Detail, Manual Postings, etc.). Visible
   to whoever created a task or whoever it's assigned to (see
   server/routes/tasks.js). Customer Name comes from the existing Contact
   list — "+ Add New" opens the exact same Contact form used on the Contact
   page itself (ContactFormModal.jsx, extracted from StaffContact.jsx) so a
   contact created here is the same real record, saved to the same
   staff_contacts table. Task Category/Priority are small admin-configurable
   lookup lists managed on their own pages, reached via the gear-icon menu. */

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const emptyTask = { title: '', description: '', contactId: '', contactPersonId: '', categoryId: '', priorityId: '', dueDate: todayISO(), assignedTo: [], status: 'pending' };

// Task grid date-bucket sections ("Today", "Tomorrow", ...).
const addDaysISO = (isoDate, n) => {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};
const daysBetweenISO = (fromISO, toISO) => {
  const [y1, m1, d1] = fromISO.split('-').map(Number);
  const [y2, m2, d2] = toISO.split('-').map(Number);
  return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000);
};
const TASK_GROUP_ORDER = ['today', 'tomorrow', 'dayAfterTomorrow', 'after4th', 'after5th', 'pending'];

// "Assigned To" cell — shows only the first 2 names inline (the column isn't
// wide enough for a whole checkbox-grid's worth of assignees) with a larger,
// custom-styled hover card for the rest — a native `title` tooltip renders in
// tiny OS chrome, not big enough to read a long staff list comfortably.
const AssigneeCell = ({ assignees }) => {
  const [show, setShow] = useState(false);
  if (!Array.isArray(assignees) || !assignees.length) return <span style={{ color: '#d1d5db' }}>—</span>;
  const shown = assignees.slice(0, 2).map(a => a.name).join(', ');
  const extra = assignees.length - 2;
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => extra > 0 && setShow(true)} onMouseLeave={() => setShow(false)}>
      <span style={{ fontSize: 12.5, color: '#374151' }}>
        {shown}{extra > 0 && <span style={{ color: '#1a56db', fontWeight: 700, cursor: 'default' }}> +{extra}</span>}
      </span>
      {show && (
        <div style={{ position: 'absolute', zIndex: 200, top: '130%', left: 0, minWidth: 200, maxWidth: 320,
          background: '#111827', color: '#f9fafb', fontSize: 14, lineHeight: 1.8, padding: '10px 14px',
          borderRadius: 8, boxShadow: '0 10px 28px rgba(0,0,0,.3)', whiteSpace: 'normal' }}>
          {assignees.map(a => a.name).join(', ')}
        </div>
      )}
    </span>
  );
};

// "General Manager" -> "GM", "Administration" -> "Admin" — same short-name
// fallback convention used by the attendance reports (abbrev() there),
// applied client-side since the plain /api/employees list doesn't carry
// posts/departments/branches' own short_name columns.
const abbrev = (name) => {
  if (!name) return '—';
  const words = name.trim().split(/\s+/);
  return words.length > 1 ? words.map(w => w[0]).join('').toUpperCase() : name.slice(0, 5);
};

// Capitalizes the first letter of every word as the title is typed.
const toTitleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

const STATUS_OPTIONS = [
  { value: 'pending',     label: 'Pending' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed',   label: 'Completed' },
];

const FOLLOWUP_MODES = [
  { value: 'phone',    label: 'Phone',    icon: '📞' },
  { value: 'email',    label: 'Email',    icon: '✉️' },
  { value: 'whatsapp', label: 'WhatsApp', icon: '💬' },
  { value: 'sms',      label: 'SMS',      icon: '📱' },
];

const emptyFollowup = { mode: 'phone', followupDate: todayISO(), description: '', nextCategoryId: '', nextFollowupAt: '', handedOverTo: '' };

// Converts a stored UTC timestamp into the "YYYY-MM-DDTHH:mm" shape a
// <input type="datetime-local"> needs, in Nepal wall-clock time (UTC+5:45,
// no DST) — not the viewer's own OS timezone. Same fixed-offset technique as
// getNepalNow() in src/utils/dateUtils.js: shift the epoch, then read it
// back with UTC getters so the browser's own offset never enters into it.
const NEPAL_OFFSET_MS = (5 * 60 + 45) * 60 * 1000;
const isoToNepalLocalInput = (isoUtc) => {
  if (!isoUtc) return '';
  const d = new Date(new Date(isoUtc).getTime() + NEPAL_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};

// Date part goes through fd() (the company's AD/BS calendar setting), the
// time part is just read straight off the same Nepal-shifted string so it
// never needs a second timezone conversion.
const formatNepalDateTime = (isoUtc, fd) => {
  if (!isoUtc) return '—';
  const [datePart, timePart] = isoToNepalLocalInput(isoUtc).split('T');
  const [hh, mm] = timePart.split(':').map(Number);
  const ampm = hh >= 12 ? 'PM' : 'AM';
  const hh12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${fd(datePart)} ${hh12}:${String(mm).padStart(2, '0')} ${ampm}`;
};

// Compact relative timestamp for the reply thread ("4d", "2h", "just now") —
// full date/time is still one click away via the title attribute.
const timeAgo = (isoUtc) => {
  if (!isoUtc) return '';
  const diffMs = Date.now() - new Date(isoUtc).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w`;
  const months = Math.floor(days / 30);
  return months < 12 ? `${months}mo` : `${Math.floor(days / 365)}y`;
};

const DateInput = ({ value, onChange }) => {
  const { settings } = useSettings();
  if (settings.defaultCalendar === 'np') return <NepaliDatePicker value={value} onChange={onChange} />;
  return (
    <input type="date" value={value} onChange={e => onChange(e.target.value)}
      style={{ height: 36, width: '100%', border: '1px solid #d1d5db', borderRadius: 7, padding: '0 10px', fontSize: 13, boxSizing: 'border-box', outline: 'none' }} />
  );
};

const field = (label, required, err, children) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
    <label style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>
      {label}{required && <span style={{ color: '#dc2626' }}> *</span>}
    </label>
    {children}
    {err && <span style={{ fontSize: 11, color: '#dc2626' }}>{err}</span>}
  </div>
);

const contactLabel = (c) => (c.contactInfo === 'company' ? c.companyName : c.personName) || `#${c.id}`;

// Strips tags for the compact list-page preview — the rich HTML itself only
// ever renders inside the editor (see RichTextEditor's own sanitizeHtml).
// Parsed via DOMParser (not a live element's innerHTML) so a description
// that's plain old pre-editor text — which may itself contain literal
// "<...>" characters never meant as markup — can't have anything execute.
const stripHtml = (html) => {
  if (!html) return '';
  return new DOMParser().parseFromString(html, 'text/html').body.textContent || '';
};

const TaskList = () => {
  const navigate = useNavigate();
  const { canManageSystem, currentUser } = useAuth();
  const { employees, filteredEmployees } = useData();
  const fd = useDateFormat();

  const [tasks,      setTasks]      = useState([]);
  const [categories, setCategories] = useState([]);
  const [priorities, setPriorities] = useState([]);
  const [contacts,   setContacts]   = useState([]);
  const [loading,    setLoading]    = useState(true);

  const [modal,   setModal]   = useState(false);
  const [editId,  setEditId]  = useState(null);
  const [form,    setForm]    = useState(emptyTask);
  const [errors,  setErrors]  = useState({});
  const [saving,  setSaving]  = useState(false);

  // Filter by Staff — every role defaults to seeing only their own tasks
  // (creator or assignee); the dropdown also offers "Show All Task", scoped
  // by role server-side (admin/superAdmin -> everyone, Branch Manager/Dept
  // Head -> their own branch/department, employee -> stays own-only). See
  // GET /api/tasks's ?staffId= handling in server/routes/tasks.js.
  const [staffFilter, setStaffFilter] = useState(() => currentUser ? String(currentUser.id) : '');

  // Quick filters, next to Filter by Staff — "My Yesterday Task" is always
  // scoped to the logged-in user specifically (creator or assignee),
  // independent of whatever Filter by Staff is currently set to.
  const [yesterdayOnly, setYesterdayOnly] = useState(false);
  const [quickPriorityId, setQuickPriorityId] = useState('');

  // Advance Search — a fuller filter form (branch/department/post/assignee/
  // category/title/priority/customer/date range), applied on top of
  // whatever Filter by Staff + quick filters already narrowed down.
  const emptyAdvSearch = { branch: '', department: '', post: '', staffId: '', categoryId: '', title: '', priorityId: '', customerName: '', dateFrom: '', dateTo: '' };
  const [advSearchOpen, setAdvSearchOpen] = useState(false);
  const [advSearchDraft, setAdvSearchDraft] = useState(emptyAdvSearch);
  const [advSearch, setAdvSearch] = useState(emptyAdvSearch);
  const advSearchActive = Object.values(advSearch).some(Boolean);

  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [gearOpen, setGearOpen] = useState(false);
  const gearRef = useRef(null);
  const [toast, setToast] = useState(null);
  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

  // "+ Add New" next to Customer Name — the real Contact form, in a popup
  const [contactModal, setContactModal] = useState(false);

  // Assign Task — filters the staff checkbox grid by name/post/department/branch
  const [assigneeSearch, setAssigneeSearch] = useState('');

  // Right-side Followup History panel — clicking a row opens it for that task
  const [followupTask,    setFollowupTask]    = useState(null);
  const [followups,       setFollowups]       = useState([]);
  const [followupsLoading, setFollowupsLoading] = useState(false);
  const [followupModal,   setFollowupModal]   = useState(false);
  const [followupForm,    setFollowupForm]    = useState(emptyFollowup);
  const [followupSaving,  setFollowupSaving]  = useState(false);
  const [followupErrors,  setFollowupErrors]  = useState({});
  const [editingFollowupId, setEditingFollowupId] = useState(null); // null = "+ New Followup"; set = editing that row
  const [selectedFollowup,  setSelectedFollowup]  = useState(null); // single-click row -> panel footer preview
  const [deleteFollowupConfirm, setDeleteFollowupConfirm] = useState(null);
  const [followupSearch, setFollowupSearch] = useState(''); // search box lives in the FOLLOWUP HISTORY card header, not the grid's own toolbar

  // Footer preview defaults to the most recent followup whenever the list (re)loads
  useEffect(() => { setSelectedFollowup(followups[0] || null); }, [followups]);

  // Replies thread on the Description card's selected followup
  const [followupReplies,        setFollowupReplies]        = useState([]);
  const [followupRepliesLoading, setFollowupRepliesLoading] = useState(false);
  const [newReplyText,           setNewReplyText]           = useState('');
  const [replySaving,            setReplySaving]             = useState(false);
  const [descriptionModalOpen,   setDescriptionModalOpen]    = useState(false); // click the compact card -> full Description + Replies popup
  const [replyingTo,             setReplyingTo]              = useState(null); // { id, userName } — reply-to-a-specific-reply target, null = top-level

  useEffect(() => {
    if (!followupTask || !selectedFollowup) { setFollowupReplies([]); return; }
    setFollowupRepliesLoading(true);
    api.get(`/tasks/${followupTask.id}/followups/${selectedFollowup.id}/replies`)
      .then(rows => setFollowupReplies(Array.isArray(rows) ? rows : []))
      .catch(() => setFollowupReplies([]))
      .finally(() => setFollowupRepliesLoading(false));
    setNewReplyText('');
    setReplyingTo(null);
  }, [followupTask?.id, selectedFollowup?.id]);

  const sendReply = async () => {
    const message = newReplyText.trim();
    if (!message || !followupTask || !selectedFollowup) return;
    setReplySaving(true);
    try {
      const reply = await api.post(`/tasks/${followupTask.id}/followups/${selectedFollowup.id}/replies`,
        { message, parentReplyId: replyingTo?.id || null });
      setFollowupReplies(prev => [...prev, reply]);
      setNewReplyText('');
      setReplyingTo(null);
    } catch (e) {
      showToast(e.message || 'Reply failed', 'error');
    } finally {
      setReplySaving(false);
    }
  };

  // Shared between the compact Description card and the full-size popup it opens on click.
  // Threaded: replies can reply to a specific reply (unlimited depth), grouped
  // client-side from the flat list by parentReplyId and rendered recursively,
  // each level indented with a connector line off the parent's avatar.
  const renderReplyBubbles = () => {
    if (followupRepliesLoading) return <div style={{ color: '#9ca3af', fontSize: 12 }}>Loading…</div>;
    if (!followupReplies.length) return <div style={{ color: '#d1d5db', fontSize: 12 }}>No replies yet</div>;

    const byParent = new Map();
    followupReplies.forEach(r => {
      const key = r.parentReplyId || 'root';
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(r);
    });

    // One flowing line per reply: avatar, then "Name (Post): message" as a single
    // wrapping paragraph — no separate header row above the message.
    const renderNode = (r, depth) => (
      <div key={r.id}>
        <div style={{ display: 'flex', gap: 8 }}>
          <Avatar photo={r.userPhoto} name={r.userName} size={24} style={{ marginTop: 1, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.5 }}>
              <span style={{ fontWeight: 700, color: '#1e293b' }}>{r.userName || '—'}</span>
              {r.userPost && <span style={{ color: '#9ca3af' }}> ({r.userPost})</span>}
              {': '}{r.message}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 1 }}>
              <button onClick={() => setReplyingTo({ id: r.id, userName: r.userName })}
                style={{ background: 'none', border: 'none', padding: 0, fontSize: 11, fontWeight: 700, color: '#6b7280', cursor: 'pointer' }}>
                Reply
              </button>
              <span title={formatNepalDateTime(r.createdAt, fd)} style={{ fontSize: 11, color: '#9ca3af' }}>
                {timeAgo(r.createdAt)}
              </span>
            </div>
          </div>
        </div>
        {(byParent.get(r.id) || []).length > 0 && (
          <div style={{ marginLeft: 12, paddingLeft: 18, borderLeft: '2px solid #f1f5f9', marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {byParent.get(r.id).map(child => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );

    return (byParent.get('root') || []).map(r => renderNode(r, 0));
  };

  const renderReplyInput = () => selectedFollowup && (
    <div style={{ marginTop: 8, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
      {replyingTo && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#92400e', marginBottom: 4, paddingLeft: 34 }}>
          Replying to <strong>{replyingTo.userName}</strong>
          <button onClick={() => setReplyingTo(null)} title="Cancel"
            style={{ background: 'none', border: 'none', padding: 0, color: '#b45309', fontSize: 12, cursor: 'pointer' }}>✕</button>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Avatar photo={currentUser?.profilePhoto} name={currentUser?.fullName} size={26} />
        <div style={{ position: 'relative', flex: 1 }}>
          <input type="text" value={newReplyText} onChange={e => setNewReplyText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !replySaving) sendReply(); }}
            placeholder={replyingTo ? `Reply to ${replyingTo.userName}…` : 'Write a reply…'}
            style={{ height: 32, width: '100%', border: '1px solid #fde68a', borderRadius: 16, padding: '0 34px 0 12px',
              fontSize: 12.5, outline: 'none', boxSizing: 'border-box' }} />
          <button onClick={sendReply} disabled={replySaving || !newReplyText.trim()} title="Send"
            style={{ position: 'absolute', top: 3, right: 3, width: 26, height: 26, display: 'flex',
              alignItems: 'center', justifyContent: 'center', background: '#1a56db', color: '#fff',
              border: 'none', borderRadius: '50%', fontSize: 13, cursor: replySaving ? 'default' : 'pointer',
              opacity: replySaving || !newReplyText.trim() ? 0.5 : 1 }}>
            {replySaving ? '…' : '➤'}
          </button>
        </div>
      </div>
    </div>
  );

  const filteredFollowups = useMemo(() => {
    const q = followupSearch.trim().toLowerCase();
    if (!q) return followups;
    return followups.filter(f =>
      [f.mode, f.description, f.nextCategoryName, f.followedByName, f.handedOverToName].some(v => v && v.toLowerCase().includes(q)));
  }, [followups, followupSearch]);

  const loadTasks = () => {
    setLoading(true);
    const qs = staffFilter ? `?staffId=${encodeURIComponent(staffFilter)}` : '';
    api.get(`/tasks${qs}`).then(rows => setTasks(Array.isArray(rows) ? rows : []))
      .catch(e => showToast(e.message || 'Failed to load tasks', 'error'))
      .finally(() => setLoading(false));
  };
  const loadCategories = () => api.get('/settings/taskCategories').then(rows => setCategories(Array.isArray(rows) ? rows : [])).catch(() => setCategories([]));
  const loadPriorities = () => api.get('/settings/taskPriorities').then(rows => setPriorities(Array.isArray(rows) ? rows : [])).catch(() => setPriorities([]));
  const loadContacts   = () => api.get('/contacts').then(rows => setContacts(Array.isArray(rows) ? rows : [])).catch(() => setContacts([]));

  useEffect(() => { loadCategories(); loadPriorities(); loadContacts(); }, []);
  useEffect(() => { loadTasks(); }, [staffFilter]);

  const staffFilterOptions = useMemo(() => [
    { value: 'all', label: '🗂 Show All Task' },
    ...filteredEmployees.map(e => ({
      value: String(e.id),
      label: currentUser && String(e.id) === String(currentUser.id) ? `${e.fullName} (Me)` : e.fullName,
    })),
  ], [filteredEmployees, currentUser]);

  // employees (not filteredEmployees) — Advance Search needs to resolve branch/
  // department/post for ANY assignee on an already-authorized task, even one
  // outside the current viewer's own role scope (e.g. a Branch Manager viewing
  // "Show All Task" sees a task whose other assignee is from a different branch).
  const employeeById = useMemo(() => new Map(employees.map(e => [String(e.id), e])), [employees]);
  const branchOptions     = useMemo(() => [...new Set(employees.map(e => e.branch).filter(Boolean))].sort(), [employees]);
  const departmentOptions = useMemo(() => [...new Set(employees.map(e => e.department).filter(Boolean))].sort(), [employees]);
  const postOptions       = useMemo(() => [...new Set(employees.map(e => e.position).filter(Boolean))].sort(), [employees]);

  // Quick filters + Advance Search apply client-side, on top of whatever
  // Filter by Staff already scoped server-side.
  const visibleTasks = useMemo(() => {
    let result = tasks;

    if (yesterdayOnly) {
      const yesterdayNepal = addDaysISO(getNepalTodayISO(), -1);
      result = result.filter(t => {
        const due = t.dueDate ? String(t.dueDate).split('T')[0] : null;
        if (due !== yesterdayNepal) return false;
        return String(t.createdBy) === String(currentUser?.id)
          || (Array.isArray(t.assignees) && t.assignees.some(a => String(a.id) === String(currentUser?.id)));
      });
    }

    if (quickPriorityId) result = result.filter(t => String(t.priorityId) === quickPriorityId);

    if (advSearchActive) {
      result = result.filter(t => {
        const assigneeEmps = (t.assignees || []).map(a => employeeById.get(String(a.id))).filter(Boolean);
        if (advSearch.branch && !assigneeEmps.some(e => e.branch === advSearch.branch)) return false;
        if (advSearch.department && !assigneeEmps.some(e => e.department === advSearch.department)) return false;
        if (advSearch.post && !assigneeEmps.some(e => e.position === advSearch.post)) return false;
        if (advSearch.staffId && !(t.assignees || []).some(a => String(a.id) === advSearch.staffId)) return false;
        if (advSearch.categoryId && String(t.categoryId) !== advSearch.categoryId) return false;
        if (advSearch.title && !(t.title || '').toLowerCase().includes(advSearch.title.toLowerCase())) return false;
        if (advSearch.priorityId && String(t.priorityId) !== advSearch.priorityId) return false;
        if (advSearch.customerName && !(t.customerName || '').toLowerCase().includes(advSearch.customerName.toLowerCase())) return false;
        const due = t.dueDate ? String(t.dueDate).split('T')[0] : null;
        if (advSearch.dateFrom && (!due || due < advSearch.dateFrom)) return false;
        if (advSearch.dateTo && (!due || due > advSearch.dateTo)) return false;
        return true;
      });
    }

    return result;
  }, [tasks, yesterdayOnly, quickPriorityId, advSearch, advSearchActive, employeeById, currentUser]);

  // Close the gear dropdown on outside click
  useEffect(() => {
    const handler = (e) => { if (gearRef.current && !gearRef.current.contains(e.target)) setGearOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const contactOptions = useMemo(() => contacts.map(c => ({ value: String(c.id), label: contactLabel(c) })), [contacts]);
  const selectedContact = useMemo(() => contacts.find(c => String(c.id) === String(form.contactId)) || null, [contacts, form.contactId]);

  // Assign Task — staff checkbox grid, filtered by the search box above it
  const assigneeOptions = useMemo(() => {
    const q = assigneeSearch.trim().toLowerCase();
    if (!q) return filteredEmployees;
    return filteredEmployees.filter(e =>
      [e.fullName, e.position, e.department, e.branch].some(v => v && v.toLowerCase().includes(q)));
  }, [filteredEmployees, assigneeSearch]);
  const toggleAssignee = (id) => {
    const key = String(id);
    setForm(p => ({ ...p, assignedTo: p.assignedTo.includes(key) ? p.assignedTo.filter(x => x !== key) : [...p.assignedTo, key] }));
  };

  // Company contacts can have multiple named people (staff_contact_persons)
  // with their own phone numbers — fetched fresh whenever the selected
  // contact changes, so the task can point at exactly one of them.
  const [contactPersons, setContactPersons] = useState([]);
  useEffect(() => {
    if (!form.contactId || selectedContact?.contactInfo !== 'company') { setContactPersons([]); return; }
    api.get(`/contacts/${form.contactId}/persons`).then(rows => setContactPersons(Array.isArray(rows) ? rows : [])).catch(() => setContactPersons([]));
  }, [form.contactId, selectedContact?.contactInfo]);

  const openAdd = () => { setEditId(null); setForm({ ...emptyTask, dueDate: todayISO() }); setErrors({}); setAssigneeSearch(''); setModal(true); };
  const openEdit = (row) => {
    setEditId(row.id);
    setAssigneeSearch('');
    setForm({
      title: row.title || '', description: row.description || '',
      contactId: row.contactId ? String(row.contactId) : '',
      contactPersonId: row.contactPersonId ? String(row.contactPersonId) : '',
      categoryId: row.categoryId ? String(row.categoryId) : '',
      priorityId: row.priorityId ? String(row.priorityId) : '',
      dueDate: row.dueDate ? String(row.dueDate).split('T')[0] : todayISO(),
      assignedTo: Array.isArray(row.assignees) ? row.assignees.map(a => String(a.id)) : [],
      status: row.status || 'pending',
    });
    setErrors({});
    setModal(true);
  };

  const validate = () => {
    const e = {};
    if (!form.title.trim()) e.title = 'Task title is required';
    return e;
  };

  const save = async () => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    setSaving(true);
    const payload = {
      title: form.title.trim(),
      description: form.description || null,
      contactId: form.contactId ? Number(form.contactId) : null,
      contactPersonId: form.contactPersonId ? Number(form.contactPersonId) : null,
      categoryId: form.categoryId ? Number(form.categoryId) : null,
      priorityId: form.priorityId ? Number(form.priorityId) : null,
      dueDate: form.dueDate || null,
      assignedTo: form.assignedTo.map(Number),
      status: form.status,
    };
    try {
      if (editId) await api.put(`/tasks/${editId}`, payload);
      else        await api.post('/tasks', payload);
      showToast(editId ? 'Task updated' : 'Task added');
      setModal(false);
      loadTasks();
    } catch (err) {
      setErrors({ _submit: err.message || 'Save failed' });
    } finally {
      setSaving(false);
    }
  };
  useSaveShortcut(modal, save);

  const remove = async (id) => {
    try {
      await api.delete(`/tasks/${id}`);
      showToast('Task deleted');
      setDeleteConfirm(null);
      if (followupTask?.id === id) setFollowupTask(null);
      loadTasks();
    } catch (e) { showToast(e.message || 'Delete failed', 'error'); }
  };

  // Checkbox multi-select -> DataGrid's own "N selected / Clear / Delete
  // Selected" bar (see onDeleteSelected below) instead of a custom click-row
  // overlay.
  const removeSelected = async (ids) => {
    try {
      await Promise.all(ids.map(id => api.delete(`/tasks/${id}`)));
      showToast(`${ids.length} task${ids.length === 1 ? '' : 's'} deleted`);
      loadTasks();
    } catch (e) { showToast(e.message || 'Delete failed', 'error'); }
  };

  const toggleComplete = async (row) => {
    const nextStatus = row.status === 'completed' ? 'pending' : 'completed';
    try {
      await api.patch(`/tasks/${row.id}/status`, { status: nextStatus });
      setTasks(prev => prev.map(t => t.id === row.id ? { ...t, status: nextStatus } : t));
    } catch (e) { showToast(e.message || 'Update failed', 'error'); }
  };

  const handleContactSaved = (saved) => {
    loadContacts();
    setForm(p => ({ ...p, contactId: String(saved.id) }));
    setContactModal(false);
    showToast('Contact added');
  };

  const staffOptions = useMemo(() => filteredEmployees.map(e => ({ value: String(e.id), label: e.fullName })), [filteredEmployees]);

  const loadFollowups = (taskId) => {
    setFollowupsLoading(true);
    api.get(`/tasks/${taskId}/followups`).then(rows => setFollowups(Array.isArray(rows) ? rows : []))
      .catch(e => showToast(e.message || 'Failed to load followups', 'error'))
      .finally(() => setFollowupsLoading(false));
  };
  const openFollowupPanel = (row) => { setFollowupTask(row); setFollowupSearch(''); loadFollowups(row.id); };
  const closeFollowupPanel = () => { setFollowupTask(null); setFollowups([]); setSelectedFollowup(null); setFollowupSearch(''); setDescriptionModalOpen(false); };

  // Esc closes the followup drawer — but only when nothing else is already
  // claiming it. Layout.jsx's own global Esc handler closes the topmost
  // .modal-overlay (New/Edit Followup, Delete confirm, the Description &
  // Replies popup); if one of those is open its element is still in the DOM
  // at the moment both listeners run, so this one steps aside instead of
  // also closing the drawer underneath it in the same keypress.
  useEffect(() => {
    if (!followupTask) return;
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('.modal-overlay')) return;
      closeFollowupPanel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [followupTask]);
  const openNewFollowup = () => {
    setEditingFollowupId(null);
    // "Transfer for Next Task" defaults to the task's own current category — the form
    // proposes changing FROM that, it doesn't start blank.
    setFollowupForm({ ...emptyFollowup, nextCategoryId: followupTask?.categoryId ? String(followupTask.categoryId) : '' });
    setFollowupErrors({});
    setFollowupModal(true);
  };
  const openEditFollowup = (row) => {
    setEditingFollowupId(row.id);
    setFollowupForm({
      mode: row.mode,
      followupDate: row.followupDate ? String(row.followupDate).split('T')[0] : todayISO(),
      description: row.description || '',
      nextCategoryId: row.nextCategoryId ? String(row.nextCategoryId) : (followupTask?.categoryId ? String(followupTask.categoryId) : ''),
      nextFollowupAt: isoToNepalLocalInput(row.nextFollowupAt),
      handedOverTo: row.handedOverToId ? String(row.handedOverToId) : '',
    });
    setFollowupErrors({});
    setFollowupModal(true);
  };

  // "Email"/"WhatsApp" pills on the followup form don't just pick a mode —
  // they jump straight to composing, using the linked customer's own
  // email/mobile (from the selected Contact, not typed by hand each time).
  const openGmailCompose = (email) => {
    if (!email) { showToast('No email on file for this customer', 'error'); return; }
    window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(email)}`, '_blank', 'noopener');
  };
  const openWhatsAppChat = (mobile) => {
    const digits = (mobile || '').replace(/\D/g, '');
    if (!digits) { showToast('No mobile number on file for this customer', 'error'); return; }
    // Nepal mobiles are stored as bare 10-digit local numbers — wa.me needs the country code.
    window.open(`https://wa.me/${digits.length === 10 ? `977${digits}` : digits}`, '_blank', 'noopener');
  };

  const saveFollowup = async () => {
    setFollowupSaving(true);
    const payload = {
      mode: followupForm.mode,
      followupDate: followupForm.followupDate || null,
      description: followupForm.description || null,
      nextCategoryId: followupForm.nextCategoryId ? Number(followupForm.nextCategoryId) : null,
      nextFollowupAt: followupForm.nextFollowupAt || null,
      handedOverTo: followupForm.handedOverTo ? Number(followupForm.handedOverTo) : null,
    };
    try {
      if (editingFollowupId) await api.put(`/tasks/${followupTask.id}/followups/${editingFollowupId}`, payload);
      else                   await api.post(`/tasks/${followupTask.id}/followups`, payload);
      showToast(editingFollowupId ? 'Followup updated' : 'Followup added');
      setFollowupModal(false);
      loadFollowups(followupTask.id);
      loadTasks(); // a hand-over may have added a new assignee, and a category transfer changed the task itself
      // Keep the open panel's own header/category in sync too — loadTasks() only refreshes the grid's copy.
      if (payload.nextCategoryId) {
        setFollowupTask(prev => prev ? { ...prev, categoryId: payload.nextCategoryId } : prev);
      }
    } catch (err) {
      setFollowupErrors({ _submit: err.message || 'Save failed' });
    } finally {
      setFollowupSaving(false);
    }
  };

  const removeFollowup = async () => {
    try {
      await api.delete(`/tasks/${followupTask.id}/followups/${deleteFollowupConfirm.id}`);
      showToast('Followup deleted');
      setDeleteFollowupConfirm(null);
      setFollowupModal(false);
      loadFollowups(followupTask.id);
    } catch (e) { showToast(e.message || 'Delete failed', 'error'); }
  };

  const followupColumns = useMemo(() => [
    {
      field: 'followupDate', header: 'Date', width: 110,
      render: (v) => v ? fd(String(v).split('T')[0]) : '—',
    },
    {
      field: 'mode', header: 'Via', width: 60, align: 'center',
      render: (v) => {
        const m = FOLLOWUP_MODES.find(x => x.value === v);
        return <span title={m?.label || v}>{m?.icon || v}</span>;
      },
    },
    {
      field: 'nextCategoryName', header: 'Task', width: 130,
      render: (v) => v ? <span style={{ fontSize: 12, color: '#374151' }}>{v}</span> : <span style={{ color: '#d1d5db' }}>—</span>,
    },
    {
      field: 'nextFollowupAt', header: 'Next Followup', width: 165,
      render: (v) => v ? formatNepalDateTime(v, fd) : <span style={{ color: '#d1d5db' }}>—</span>,
    },
    {
      field: 'handedOverToName', header: 'Handed Over', width: 120,
      render: (v) => v || <span style={{ color: '#d1d5db' }}>—</span>,
    },
  ], [fd]);

  const columns = useMemo(() => [
    {
      field: '_complete', header: '', width: 20, minWidth: 20, align: 'center', sortable: false, filterable: false,
      render: (_, row) => (
        <input type="checkbox" checked={row.status === 'completed'} onChange={e => { e.stopPropagation(); toggleComplete(row); }}
          onClick={e => e.stopPropagation()}
          style={{ width: 11, height: 11, accentColor: '#22c55e', cursor: 'pointer' }} />
      ),
    },
    {
      field: 'title', header: 'Task', minWidth: 170,
      render: (v, row) => (
        <span style={{ fontWeight: 600, color: row.status === 'completed' ? '#9ca3af' : '#1e293b',
          textDecoration: row.status === 'completed' ? 'line-through' : 'none' }}>{v}</span>
      ),
    },
    {
      field: 'customerName', header: 'Customer', width: 150,
      render: (v) => v ? <span style={{ fontSize: 12.5, color: '#374151' }}>{v}</span> : <span style={{ color: '#d1d5db' }}>—</span>,
    },
    {
      field: 'personName', header: 'Person Name', width: 130,
      render: (v) => v ? <span style={{ fontSize: 12.5, color: '#374151' }}>{v}</span> : <span style={{ color: '#d1d5db' }}>—</span>,
    },
    {
      field: 'customerMobile', header: 'Mobile no. | Phone', width: 170, sortable: false, filterable: false,
      render: (_, row) => {
        const parts = [row.customerMobile, row.customerMobile2, row.customerPhone].filter(Boolean);
        return parts.length ? <span style={{ fontSize: 12.5, color: '#374151' }}>{parts.join(' | ')}</span> : <span style={{ color: '#d1d5db' }}>—</span>;
      },
    },
    {
      field: 'categoryName', header: 'Category', width: 110, align: 'center',
      render: (v) => v ? (
        <span style={{ fontSize: 10.5, fontWeight: 700, background: '#eff6ff', color: '#1d4ed8', borderRadius: 20, padding: '3px 10px' }}>{v}</span>
      ) : <span style={{ color: '#d1d5db' }}>—</span>,
    },
    {
      field: 'priorityName', header: 'Priority', width: 100, align: 'center',
      render: (v, row) => v ? (
        <span style={{ fontSize: 10.5, fontWeight: 700, borderRadius: 20, padding: '3px 10px',
          background: `${row.priorityColor || '#94a3b8'}22`, color: row.priorityColor || '#475569' }}>{v}</span>
      ) : <span style={{ color: '#d1d5db' }}>—</span>,
    },
    {
      field: 'assignees', header: 'Assigned To', width: 150, sortable: false, filterable: false,
      render: (v) => <AssigneeCell assignees={v} />,
    },
    {
      field: 'dueDate', header: 'Task Date', width: 110,
      render: (v) => v ? fd(String(v).split('T')[0]) : '—',
    },
    {
      field: 'createdAt', header: 'Days', width: 80, align: 'center',
      render: (v) => {
        if (!v) return <span style={{ color: '#d1d5db' }}>—</span>;
        // Computed live off getNepalTodayISO() each render (not a captured outer
        // const) so the count keeps advancing day to day without needing the
        // whole memoized columns array to recompute.
        const startedNepal = isoToNepalLocalInput(v).split('T')[0];
        const n = daysBetweenISO(startedNepal, getNepalTodayISO());
        return <span style={{ fontSize: 11.5, color: '#6b7280' }}>{n <= 0 ? 'Today' : `${n}d`}</span>;
      },
    },
    {
      field: 'status', header: 'Status', width: 100, align: 'center',
      render: (v) => {
        const s = v === 'completed' ? { bg: '#f0fdf4', color: '#15803d' } : v === 'in_progress' ? { bg: '#eff6ff', color: '#1d4ed8' } : { bg: '#fffbeb', color: '#b45309' };
        return <span style={{ fontSize: 10.5, fontWeight: 700, background: s.bg, color: s.color, borderRadius: 20, padding: '3px 10px', textTransform: 'capitalize' }}>{v.replace('_', ' ')}</span>;
      },
    },
    {
      field: 'description', header: 'Description', minWidth: 160,
      render: (v) => {
        const text = stripHtml(v);
        return text ? <span style={{ fontSize: 12, color: '#6b7280' }}>{text}</span> : <span style={{ color: '#d1d5db' }}>—</span>;
      },
    },
    {
      field: 'actions', header: 'Actions', width: 90, align: 'center', sortable: false, filterable: false,
      render: (_, row) => (
        <div className="dg-actions">
          <button className="dg-action-btn edit"   title="Edit"   onClick={e => { e.stopPropagation(); openEdit(row); }}>✏️</button>
          <button className="dg-action-btn delete" title="Delete" onClick={e => { e.stopPropagation(); setDeleteConfirm(row.id); }}>🗑</button>
        </div>
      ),
    },
  ], [fd]);

  // Date-bucket sections for the grid — a task due today that's still not
  // completed once today is over auto-transfers into "Tomorrow" (and keeps
  // landing there, however many days overdue, until it's completed) rather
  // than piling up under "Today" forever. A completed task keeps showing
  // under "Today" as a record rather than rolling forward. Undated tasks (or
  // ones past the 5-day window) land in the trailing "Pending" catch-all.
  const todayNepal            = getNepalTodayISO();
  const tomorrowNepal         = addDaysISO(todayNepal, 1);
  const dayAfterTomorrowNepal = addDaysISO(todayNepal, 2);
  const after4thNepal         = addDaysISO(todayNepal, 3);
  const after5thNepal         = addDaysISO(todayNepal, 4);

  const taskGroupKey = (row) => {
    const due = row.dueDate ? String(row.dueDate).split('T')[0] : null;
    if (!due) return 'pending';
    if (due < todayNepal) return row.status === 'completed' ? 'today' : 'tomorrow';
    if (due === todayNepal) return 'today';
    if (due === tomorrowNepal) return 'tomorrow';
    if (due === dayAfterTomorrowNepal) return 'dayAfterTomorrow';
    if (due === after4thNepal) return 'after4th';
    if (due === after5thNepal) return 'after5th';
    return 'pending';
  };
  // Short labels — Today/Tomorrow/Day After Tomorrow are self-explanatory on
  // their own, so no date is spelled out; the two sections beyond that show
  // just the plain date since "after 4th/5th day" alone isn't as meaningful.
  const taskGroupLabel = (key) => {
    switch (key) {
      case 'today':            return 'Today';
      case 'tomorrow':         return 'Tomorrow';
      case 'dayAfterTomorrow': return 'Day After Tomorrow';
      case 'after4th':         return fd(after4thNepal);
      case 'after5th':         return fd(after5thNepal);
      case 'pending':          return 'Task Pending Plan in coming Days';
      default:                 return key;
    }
  };

  // Filter by Staff, quick filters, Advance Search — rendered inside the grid's
  // own toolbar (left of its Search box) via DataGrid's toolbarLeft prop.
  const taskFilterToolbar = (
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', whiteSpace: 'nowrap' }}>Filter by Staff</label>
        <div style={{ width: 190 }}>
          <SearchableSelect
            value={staffFilter}
            onChange={v => setStaffFilter(v || (currentUser ? String(currentUser.id) : ''))}
            options={staffFilterOptions}
            placeholder="— Select staff —"
          />
        </div>
      </div>

      <button onClick={() => setYesterdayOnly(p => !p)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 12px',
          border: `1px solid ${yesterdayOnly ? '#1a56db' : '#d1d5db'}`, borderRadius: 7, cursor: 'pointer',
          background: yesterdayOnly ? '#eff6ff' : '#fff', color: yesterdayOnly ? '#1a56db' : '#374151',
          fontSize: 12.5, fontWeight: 600 }}>
        📅 My Yesterday Task
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', whiteSpace: 'nowrap' }}>Priority</label>
        <select value={quickPriorityId} onChange={e => setQuickPriorityId(e.target.value)}
          style={{ height: 32, border: '1px solid #d1d5db', borderRadius: 7, padding: '0 8px', fontSize: 12.5, background: '#fff' }}>
          <option value="">All</option>
          {priorities.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      <button onClick={() => { setAdvSearchDraft(advSearch); setAdvSearchOpen(true); }}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 12px',
          border: `1px solid ${advSearchActive ? '#1a56db' : '#d1d5db'}`, borderRadius: 7, cursor: 'pointer',
          background: advSearchActive ? '#eff6ff' : '#fff', color: advSearchActive ? '#1a56db' : '#374151',
          fontSize: 12.5, fontWeight: 600 }}>
        🔍 Advance Search{advSearchActive ? ' (active)' : ''}
      </button>
      {advSearchActive && (
        <button onClick={() => { setAdvSearch(emptyAdvSearch); setAdvSearchDraft(emptyAdvSearch); }}
          style={{ background: 'none', border: 'none', color: '#dc2626', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
          ✕ Clear
        </button>
      )}
    </div>
  );

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 60px)', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, flexShrink: 0 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: 0 }}>✅ Task</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {canManageSystem && (
            <div ref={gearRef} style={{ position: 'relative' }}>
              <button onClick={() => setGearOpen(p => !p)} title="Task settings"
                style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: '1px solid #d1d5db', borderRadius: 8, background: '#fff', cursor: 'pointer', fontSize: 16 }}>
                ⚙️
              </button>
              {gearOpen && (
                <div style={{ position: 'absolute', right: 0, top: 42, background: '#fff', border: '1px solid #e5e7eb',
                  borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.12)', minWidth: 190, zIndex: 20, overflow: 'hidden' }}>
                  <div onClick={() => { setGearOpen(false); navigate('/staff/task/categories'); }}
                    style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600, color: '#374151', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f3f4f6'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    1. Task Category
                  </div>
                  <div onClick={() => { setGearOpen(false); navigate('/staff/task/priorities'); }}
                    style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600, color: '#374151', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, borderTop: '1px solid #f1f5f9' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f3f4f6'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    2. Task Priority
                  </div>
                </div>
              )}
            </div>
          )}
          <button onClick={openAdd}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 18px', background: '#1a56db',
              color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(26,86,219,.25)' }}>
            + Add Task
          </button>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {loading ? (
            <div style={{ padding: 48, textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>Loading...</div>
          ) : (
            <div className="dg-fixed-height" style={{ height: '100%' }}>
              <DataGrid
                columns={columns}
                data={visibleTasks}
                rowKey="id"
                defaultPageSize={20}
                compact={true}
                className="task-list-grid"
                showFilterButton={false}
                toolbarLeft={taskFilterToolbar}
                extraSearchFields={['customerPhone']}
                groupBy={taskGroupKey}
                groupOrder={TASK_GROUP_ORDER}
                groupLabel={taskGroupLabel}
                onRowClick={openFollowupPanel}
                onFocusChange={openFollowupPanel}
                onRowDoubleClick={openEdit}
                onDeleteKey={(row) => setDeleteConfirm(row.id)}
                onDeleteSelected={removeSelected}
                contextMenu={[
                  { label: 'Edit',   icon: '✏️', onClick: (row) => openEdit(row) },
                  'divider',
                  { label: 'Delete', icon: '🗑', className: 'danger', onClick: (row) => setDeleteConfirm(row.id) },
                ]}
              />
            </div>
          )}
        </div>

        {/* Right — Followup History panel (click a task row to open). Full-viewport-height
            drawer (fixed, not a flex sibling), no dimming backdrop — the left-side task
            grid stays fully clickable and arrow-key navigable while it's open, switching
            the drawer to whichever row you land on (see onRowClick/onFocusChange above). */}
        {followupTask && (
          <div style={{ position: 'fixed', top: 60, right: 0, bottom: 0, width: 560, zIndex: 51,
              background: '#fff', boxShadow: '-6px 0 24px rgba(0,0,0,.15)', borderLeft: '1px solid #dedede',
              display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid #e5e7eb', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#111827', display: 'flex', alignItems: 'center', gap: 6 }}>
                    📄 {followupTask.title}
                  </div>
                  <div style={{ marginTop: 6, padding: '6px 10px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 7 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#166534' }}>
                      {followupTask.customerName || 'No client linked'}
                      {followupTask.personName ? ` — ${followupTask.personName}` : ''}
                    </div>
                    {(followupTask.customerMobile || followupTask.customerPhone) && (
                      <div style={{ fontSize: 13, color: '#15803d', marginTop: 1 }}>
                        {[followupTask.customerMobile, followupTask.customerPhone].filter(Boolean).join(' | ')}
                      </div>
                    )}
                  </div>
                </div>
                <button onClick={closeFollowupPanel} title="Close"
                  style={{ border: 'none', background: 'transparent', fontSize: 16, cursor: 'pointer', color: '#9ca3af', flexShrink: 0 }}>✕</button>
              </div>
            </div>

            <div style={{ flex: 1, minHeight: 0, padding: 12, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
              {/* Followup History — blue card, matches the section-header convention on the Company detail panel */}
              <div style={{ flex: 1, minHeight: 160, display: 'flex', flexDirection: 'column',
                border: '1px solid #dbeafe', borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ background: '#eff6ff', padding: '9px 14px', display: 'flex', alignItems: 'center', gap: 7,
                  borderBottom: '1px solid #dbeafe', flexShrink: 0 }}>
                  <span style={{ fontSize: 12 }}>📋</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#1d4ed8', letterSpacing: '.4px', whiteSpace: 'nowrap' }}>FOLLOWUP HISTORY</span>
                  <button onClick={openNewFollowup}
                    style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, height: 26, padding: '0 10px',
                      background: '#1a56db', color: '#fff', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>
                    + New
                  </button>
                  <input type="text" value={followupSearch} onChange={e => setFollowupSearch(e.target.value)}
                    placeholder="Search followups…"
                    style={{ height: 26, width: 150, border: '1px solid #bfdbfe', borderRadius: 6,
                      padding: '0 9px', fontSize: 11.5, color: '#1e3a8a', background: '#fff', outline: 'none', boxSizing: 'border-box', flexShrink: 0 }} />
                </div>
                <div style={{ flex: 1, minHeight: 0, padding: 8, background: '#fff' }}>
                  {followupsLoading ? (
                    <div style={{ padding: 24, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>Loading…</div>
                  ) : (
                    <div className="dg-fixed-height" style={{ height: '100%' }}>
                      <DataGrid
                        columns={followupColumns}
                        data={filteredFollowups}
                        rowKey="id"
                        className="followup-history-grid"
                        showCheckbox={false}
                        showFilterButton={false}
                        showSearch={false}
                        compact
                        onRowClick={setSelectedFollowup}
                        onRowDoubleClick={openEditFollowup}
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Description — amber card, two columns (Description | Replies) with an
                  arrow connecting them, same layout as the popup this opens into. Click
                  either side (except the reply input) to open the full popup — this
                  compact version only shows ~2 replies before it needs scrolling. */}
              <div style={{ flexShrink: 0, border: '1px solid #fde68a', borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ background: '#fffbeb', padding: '9px 14px', display: 'flex', alignItems: 'center', gap: 7, borderBottom: '1px solid #fde68a' }}>
                  <span style={{ fontSize: 12 }}>📝</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#b45309', letterSpacing: '.4px' }}>DESCRIPTION</span>
                </div>
                <div style={{ display: 'flex', background: '#fff' }}>
                  <div onClick={() => selectedFollowup && setDescriptionModalOpen(true)}
                    style={{ flex: 1, minWidth: 0, padding: '10px 12px', cursor: selectedFollowup ? 'pointer' : 'default' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#b45309', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 4 }}>
                      Description
                    </div>
                    <div style={{ fontSize: 12, color: '#374151', maxHeight: 110, overflow: 'hidden' }}>
                      {selectedFollowup?.description || <span style={{ color: '#d1d5db' }}>—</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', color: '#fbbf24', fontSize: 16, flexShrink: 0 }}>➜</div>
                  <div style={{ flex: 1, minWidth: 0, borderLeft: '1px solid #fef3c7', background: '#fffdf7', padding: '10px 12px' }}>
                    <div onClick={() => selectedFollowup && setDescriptionModalOpen(true)}
                      style={{ cursor: selectedFollowup ? 'pointer' : 'default' }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 4 }}>
                        Replies
                      </div>
                      {/* Anyone with access to the task (creator or any assignee: HOD,
                          admin, branch manager, whoever) can weigh in on this entry. */}
                      <div style={{ maxHeight: 100, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {renderReplyBubbles()}
                      </div>
                    </div>
                    <div style={{ marginTop: 6 }}>
                      {renderReplyInput()}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Description & Replies popup — opened by clicking the compact card above */}
      {descriptionModalOpen && selectedFollowup && (
        <div className="modal-overlay" onClick={() => setDescriptionModalOpen(false)}>
          <div className="modal" style={{ maxWidth: 900 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>📝 Description &amp; Replies</h2>
              <button className="modal-close" onClick={() => setDescriptionModalOpen(false)}>✕</button>
            </div>
            <div className="modal-body" style={{ display: 'flex', gap: 20, minHeight: 360 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#b45309', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 8 }}>
                  Description
                </div>
                <div style={{ fontSize: 13.5, color: '#374151', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                  {selectedFollowup?.description || <span style={{ color: '#d1d5db' }}>—</span>}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', color: '#fbbf24', fontSize: 20, flexShrink: 0 }}>➜</div>
              <div style={{ width: 340, flexShrink: 0, borderLeft: '1px solid #f1f5f9', paddingLeft: 20,
                display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 8 }}>
                  Replies
                </div>
                <div style={{ flex: 1, minHeight: 0, maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {renderReplyBubbles()}
                </div>
                {renderReplyInput()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Advance Search */}
      {advSearchOpen && (
        <div className="modal-overlay" onClick={() => setAdvSearchOpen(false)}>
          <div className="modal" style={{ maxWidth: 620 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>🔍 Advance Search</h2>
              <button className="modal-close" onClick={() => setAdvSearchOpen(false)}>✕</button>
            </div>
            <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              {field('Branch', false, null,
                <select value={advSearchDraft.branch} onChange={e => setAdvSearchDraft(p => ({ ...p, branch: e.target.value }))}
                  style={{ height: 36, width: '100%', border: '1px solid #d1d5db', borderRadius: 7, padding: '0 8px', fontSize: 13 }}>
                  <option value="">— Any —</option>
                  {branchOptions.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              )}
              {field('Department', false, null,
                <select value={advSearchDraft.department} onChange={e => setAdvSearchDraft(p => ({ ...p, department: e.target.value }))}
                  style={{ height: 36, width: '100%', border: '1px solid #d1d5db', borderRadius: 7, padding: '0 8px', fontSize: 13 }}>
                  <option value="">— Any —</option>
                  {departmentOptions.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              )}
              {field('Post', false, null,
                <select value={advSearchDraft.post} onChange={e => setAdvSearchDraft(p => ({ ...p, post: e.target.value }))}
                  style={{ height: 36, width: '100%', border: '1px solid #d1d5db', borderRadius: 7, padding: '0 8px', fontSize: 13 }}>
                  <option value="">— Any —</option>
                  {postOptions.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              )}
              {field('Assign to Staff Name', false, null,
                <SearchableSelect
                  value={advSearchDraft.staffId}
                  onChange={v => setAdvSearchDraft(p => ({ ...p, staffId: v }))}
                  options={staffOptions}
                  placeholder="— Any —"
                />
              )}
              {field('Task Category', false, null,
                <select value={advSearchDraft.categoryId} onChange={e => setAdvSearchDraft(p => ({ ...p, categoryId: e.target.value }))}
                  style={{ height: 36, width: '100%', border: '1px solid #d1d5db', borderRadius: 7, padding: '0 8px', fontSize: 13 }}>
                  <option value="">— Any —</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              )}
              {field('Task Priority', false, null,
                <select value={advSearchDraft.priorityId} onChange={e => setAdvSearchDraft(p => ({ ...p, priorityId: e.target.value }))}
                  style={{ height: 36, width: '100%', border: '1px solid #d1d5db', borderRadius: 7, padding: '0 8px', fontSize: 13 }}>
                  <option value="">— Any —</option>
                  {priorities.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
              {field('Task Name', false, null,
                <input value={advSearchDraft.title} onChange={e => setAdvSearchDraft(p => ({ ...p, title: e.target.value }))}
                  placeholder="Search title…"
                  style={{ height: 36, width: '100%', border: '1px solid #d1d5db', borderRadius: 7, padding: '0 10px', fontSize: 13, boxSizing: 'border-box', outline: 'none' }} />
              )}
              {field('Customer Name', false, null,
                <input value={advSearchDraft.customerName} onChange={e => setAdvSearchDraft(p => ({ ...p, customerName: e.target.value }))}
                  placeholder="Search customer…"
                  style={{ height: 36, width: '100%', border: '1px solid #d1d5db', borderRadius: 7, padding: '0 10px', fontSize: 13, boxSizing: 'border-box', outline: 'none' }} />
              )}
              {field('Task Date From', false, null,
                <DateInput value={advSearchDraft.dateFrom} onChange={v => setAdvSearchDraft(p => ({ ...p, dateFrom: v }))} />
              )}
              {field('Task Date To', false, null,
                <DateInput value={advSearchDraft.dateTo} onChange={v => setAdvSearchDraft(p => ({ ...p, dateTo: v }))} />
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => { setAdvSearchDraft(emptyAdvSearch); setAdvSearch(emptyAdvSearch); }}>Clear</button>
              <button className="btn btn-outline" onClick={() => setAdvSearchOpen(false)}>Cancel</button>
              <SaveButton onClick={() => { setAdvSearch(advSearchDraft); setAdvSearchOpen(false); }} icon="🔍" label="Search" />
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Task */}
      {modal && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 680 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editId ? '✏️ Edit Task' : '+ Add Task'}</h2>
              <button className="modal-close" onClick={() => setModal(false)}>✕</button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {errors._submit && (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#991b1b' }}>
                  {errors._submit}
                </div>
              )}

              {field('Task Title', true, errors.title,
                <input value={form.title} onChange={e => setForm(p => ({ ...p, title: toTitleCase(e.target.value) }))}
                  placeholder="e.g. Follow up on quotation"
                  style={{ height: 36, width: '100%', border: `1px solid ${errors.title ? '#dc2626' : '#d1d5db'}`, borderRadius: 7, padding: '0 10px', fontSize: 13, boxSizing: 'border-box', outline: 'none' }} />
              )}

              {field('Customer Name', false, null,
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <SearchableSelect
                      value={form.contactId}
                      onChange={v => setForm(p => ({ ...p, contactId: v, contactPersonId: '' }))}
                      options={contactOptions}
                      placeholder="— Select from Contact list —"
                    />
                  </div>
                  <button type="button" onClick={() => setContactModal(true)}
                    style={{ border: '1px solid #d1d5db', borderRadius: 7, padding: '0 12px', background: '#fff', fontSize: 12.5, fontWeight: 700, color: '#1a56db', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    + Add New
                  </button>
                </div>
              )}

              {selectedContact && (
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 12 }}>
                    <div><span style={{ color: '#9ca3af' }}>Address: </span>{(selectedContact.contactInfo === 'company' ? selectedContact.companyAddress : selectedContact.address) || '—'}</div>
                    <div><span style={{ color: '#9ca3af' }}>Mobile: </span>{selectedContact.mobile1 || '—'}</div>
                    <div><span style={{ color: '#9ca3af' }}>Phone: </span>{(selectedContact.contactInfo === 'company' ? selectedContact.companyPhone : selectedContact.officePhone) || '—'}</div>
                    <div><span style={{ color: '#9ca3af' }}>Email: </span>{(selectedContact.contactInfo === 'company' ? selectedContact.companyEmail : selectedContact.email) || '—'}</div>
                  </div>

                  {/* Company contacts can have several named people, each with their own
                      number — pick which one this task is actually for. DataGrid-style
                      header, scrolling after 3 rows so a long persons list doesn't push
                      the rest of the form down. */}
                  {contactPersons.length > 0 && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #e2e8f0' }}>
                      <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.4px' }}>
                        👥 Select Contact Person
                      </p>
                      <div style={{ maxHeight: 128, overflowY: 'auto', border: '1px solid #dedede', borderRadius: 6 }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                          <thead>
                            <tr>
                              {['', 'Name', 'Post', 'Mobile No.'].map(h => (
                                <th key={h} style={{ position: 'sticky', top: 0, zIndex: 1, background: '#efefef', color: '#374151',
                                  fontSize: 10, fontWeight: 700, textAlign: 'left', padding: '4px 8px',
                                  borderBottom: '2px solid #dedede', borderRight: '1px solid #dedede' }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {contactPersons.map(p => {
                              const sel = String(form.contactPersonId) === String(p.id);
                              return (
                                <tr key={p.id} onClick={() => setForm(fp => ({ ...fp, contactPersonId: sel ? '' : String(p.id) }))}
                                  style={{ cursor: 'pointer', background: sel ? '#eff6ff' : '#fff' }}>
                                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #f1f5f9', borderRight: '1px solid #f1f5f9' }}>
                                    <input type="checkbox" checked={sel} onChange={() => {}} style={{ width: 12, height: 12, accentColor: '#1a56db', cursor: 'pointer' }} />
                                  </td>
                                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #f1f5f9', borderRight: '1px solid #f1f5f9', fontWeight: 600, color: '#1e293b' }}>{p.name}</td>
                                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #f1f5f9', borderRight: '1px solid #f1f5f9', color: '#6b7280' }}>{p.post || '—'}</td>
                                  <td style={{ padding: '4px 8px', borderBottom: '1px solid #f1f5f9', color: '#374151' }}>
                                    {[p.mobile1, p.mobile2].filter(Boolean).join(' | ') || '—'}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {field('Task Category', false, null,
                  <select value={form.categoryId} onChange={e => setForm(p => ({ ...p, categoryId: e.target.value }))}
                    style={{ height: 36, width: '100%', border: '1px solid #d1d5db', borderRadius: 7, padding: '0 8px', fontSize: 13 }}>
                    <option value="">— Select —</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                )}
                {field('Task Priority', false, null,
                  <select value={form.priorityId} onChange={e => setForm(p => ({ ...p, priorityId: e.target.value }))}
                    style={{ height: 36, width: '100%', border: '1px solid #d1d5db', borderRadius: 7, padding: '0 8px', fontSize: 13 }}>
                    <option value="">— Select —</option>
                    {priorities.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                )}
              </div>

              {field('Assign Task', false, null,
                <div>
                  <input type="text" value={assigneeSearch} onChange={e => setAssigneeSearch(e.target.value)}
                    placeholder="Search by name, post, department, branch..."
                    style={{ height: 32, width: '100%', border: '1px solid #d1d5db', borderRadius: 7, padding: '0 10px',
                      fontSize: 12.5, boxSizing: 'border-box', outline: 'none', marginBottom: 6 }} />
                  <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid #dedede', borderRadius: 6 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                      <thead>
                        <tr>
                          {['', 'Name', 'Post', 'Department', 'Branch'].map(h => (
                            <th key={h} style={{ position: 'sticky', top: 0, zIndex: 1, background: '#efefef', color: '#374151',
                              fontSize: 10, fontWeight: 700, textAlign: 'left', padding: '4px 8px',
                              borderBottom: '2px solid #dedede', borderRight: '1px solid #dedede' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {assigneeOptions.length === 0 ? (
                          <tr><td colSpan={5} style={{ padding: '10px 8px', textAlign: 'center', color: '#9ca3af', fontSize: 11.5 }}>No staff found</td></tr>
                        ) : assigneeOptions.map(e => {
                          const key = String(e.id);
                          const sel = form.assignedTo.includes(key);
                          return (
                            <tr key={e.id} onClick={() => toggleAssignee(e.id)}
                              style={{ cursor: 'pointer', background: sel ? '#eff6ff' : '#fff' }}>
                              <td style={{ padding: '4px 8px', borderBottom: '1px solid #f1f5f9', borderRight: '1px solid #f1f5f9' }}>
                                <input type="checkbox" checked={sel} onChange={() => {}}
                                  style={{ width: 12, height: 12, accentColor: '#1a56db', cursor: 'pointer' }} />
                              </td>
                              <td style={{ padding: '4px 8px', borderBottom: '1px solid #f1f5f9', borderRight: '1px solid #f1f5f9', fontWeight: 600, color: '#1e293b' }}>{e.fullName}</td>
                              <td style={{ padding: '4px 8px', borderBottom: '1px solid #f1f5f9', borderRight: '1px solid #f1f5f9', color: '#6b7280' }}>{abbrev(e.position)}</td>
                              <td style={{ padding: '4px 8px', borderBottom: '1px solid #f1f5f9', borderRight: '1px solid #f1f5f9', color: '#6b7280' }}>{abbrev(e.department)}</td>
                              <td style={{ padding: '4px 8px', borderBottom: '1px solid #f1f5f9', color: '#6b7280' }}>{abbrev(e.branch)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {form.assignedTo.length > 0 && (
                    <div style={{ marginTop: 4, fontSize: 11, color: '#6b7280' }}>{form.assignedTo.length} staff selected</div>
                  )}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {field('Task Date', false, null,
                  <DateInput value={form.dueDate} onChange={v => setForm(p => ({ ...p, dueDate: v }))} />
                )}
                {field('Status', false, null,
                  <select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}
                    style={{ height: 36, width: '100%', border: '1px solid #d1d5db', borderRadius: 7, padding: '0 8px', fontSize: 13 }}>
                    {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                )}
              </div>

              {field('Description', false, null,
                <RichTextEditor value={form.description} onChange={v => setForm(p => ({ ...p, description: v }))} />
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setModal(false)}>Cancel</button>
              <SaveButton onClick={save} disabled={saving} icon={saving ? '⏳' : '💾'} label={saving ? 'Saving…' : 'Save'} />
            </div>
          </div>
        </div>
      )}

      {/* + New Followup */}
      {followupModal && followupTask && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingFollowupId ? '✏️ Edit Followup' : '+ New Followup'}</h2>
              <button className="modal-close" onClick={() => setFollowupModal(false)}>✕</button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {followupErrors._submit && (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#991b1b' }}>
                  {followupErrors._submit}
                </div>
              )}

              <div style={{ fontSize: 12.5, color: '#6b7280', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 7, padding: '6px 10px' }}>
                📋 <strong style={{ color: '#374151' }}>{followupTask.title}</strong>
                {followupTask.customerName ? ` · ${followupTask.customerName}` : ''}
              </div>

              {field('Followup By', true, null,
                <div style={{ display: 'flex', gap: 8 }}>
                  {FOLLOWUP_MODES.map(m => (
                    <button key={m.value} type="button" onClick={() => {
                        setFollowupForm(p => ({ ...p, mode: m.value }));
                        if (m.value === 'email')    openGmailCompose(followupTask.customerEmail);
                        if (m.value === 'whatsapp') openWhatsAppChat(followupTask.customerMobile || followupTask.customerMobile2);
                      }}
                      style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '8px 6px',
                        border: `2px solid ${followupForm.mode === m.value ? '#1a56db' : '#e5e7eb'}`, borderRadius: 8, cursor: 'pointer',
                        background: followupForm.mode === m.value ? '#eff6ff' : '#fff' }}>
                      <span style={{ fontSize: 16 }}>{m.icon}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: followupForm.mode === m.value ? '#1a56db' : '#374151' }}>{m.label}</span>
                    </button>
                  ))}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {field('Followup Date', false, null,
                  <DateInput value={followupForm.followupDate} onChange={v => setFollowupForm(p => ({ ...p, followupDate: v }))} />
                )}
                {field('Followed By', false, null,
                  <div style={{ height: 36, display: 'flex', alignItems: 'center', padding: '0 10px',
                    border: '1px solid #e5e7eb', borderRadius: 7, background: '#f8fafc', fontSize: 13, color: '#374151', boxSizing: 'border-box' }}>
                    {currentUser?.fullName || '—'}
                  </div>
                )}
              </div>

              {field('Description', false, null,
                <textarea value={followupForm.description} onChange={e => setFollowupForm(p => ({ ...p, description: e.target.value }))}
                  rows={6} placeholder="What was discussed..."
                  style={{ border: '1px solid #d1d5db', borderRadius: 7, padding: '8px 10px', fontSize: 13, resize: 'vertical', outline: 'none', fontFamily: 'inherit' }} />
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {field('Next Followup & Time', false, null,
                  <input type="datetime-local" value={followupForm.nextFollowupAt}
                    onChange={e => setFollowupForm(p => ({ ...p, nextFollowupAt: e.target.value }))}
                    style={{ height: 36, width: '100%', border: '1px solid #d1d5db', borderRadius: 7, padding: '0 10px', fontSize: 13, boxSizing: 'border-box', outline: 'none' }} />
                )}
                {field('Hand Over', false, null,
                  <SearchableSelect
                    value={followupForm.handedOverTo}
                    onChange={v => setFollowupForm(p => ({ ...p, handedOverTo: v }))}
                    options={staffOptions}
                    placeholder="— None —"
                  />
                )}
              </div>

              {field('Transfer for Next Task', false, null,
                <select value={followupForm.nextCategoryId} onChange={e => setFollowupForm(p => ({ ...p, nextCategoryId: e.target.value }))}
                  style={{ height: 36, width: '100%', border: '1px solid #d1d5db', borderRadius: 7, padding: '0 8px', fontSize: 13 }}>
                  <option value="">— Select —</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              )}
            </div>
            <div className="modal-footer">
              {canManageSystem && editingFollowupId && (
                <button className="btn btn-danger" style={{ marginRight: 'auto' }}
                  onClick={() => setDeleteFollowupConfirm({ id: editingFollowupId })}>
                  🗑 Delete
                </button>
              )}
              <button className="btn btn-outline" onClick={() => setFollowupModal(false)}>Cancel</button>
              <SaveButton onClick={saveFollowup} disabled={followupSaving} icon={followupSaving ? '⏳' : '💾'}
                label={followupSaving ? 'Saving…' : editingFollowupId ? 'Update' : 'Save'} />
            </div>
          </div>
        </div>
      )}

      {/* Delete Followup Confirm — admin/superAdmin only, see canManageSystem gate above */}
      {deleteFollowupConfirm && (
        <div className="modal-overlay">
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>⚠️ Delete Followup</h2>
              <button className="modal-close" onClick={() => setDeleteFollowupConfirm(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 14, color: '#374151' }}>Are you sure you want to delete this followup entry?</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setDeleteFollowupConfirm(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={removeFollowup}>🗑 Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* + Add New — the real Contact form, as a popup */}
      {contactModal && (
        <ContactFormModal
          initial={CONTACT_EMPTY}
          onClose={() => setContactModal(false)}
          onSaved={handleContactSaved}
        />
      )}

      {/* Delete Confirm */}
      {deleteConfirm && (
        <div className="modal-overlay">
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>⚠️ Delete Task</h2>
              <button className="modal-close" onClick={() => setDeleteConfirm(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 14, color: '#374151' }}>Are you sure you want to delete this task?</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => remove(deleteConfirm)}>🗑 Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, padding: '12px 20px', borderRadius: 10,
          fontSize: 13, fontWeight: 600,
          background: toast.type === 'error' ? '#fef2f2' : '#f0fdf4',
          color:      toast.type === 'error' ? '#dc2626'  : '#065f46',
          border:     `1px solid ${toast.type === 'error' ? '#fecaca' : '#bbf7d0'}`,
          boxShadow: '0 4px 16px rgba(0,0,0,.12)' }}>
          {toast.type === 'error' ? '❌' : '✅'} {toast.msg}
        </div>
      )}
    </div>
  );
};

export default TaskList;
