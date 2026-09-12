import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useData } from '../../context/DataContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import { useModuleFlags } from '../../context/ModuleFlagsContext.jsx';
import DataGrid from '../DataGrid/DataGrid.jsx';
import NepaliDatePicker from '../Common/NepaliDatePicker.jsx';
import DateTimePicker from '../Common/DateTimePicker.jsx';
import NepaliDateTimePicker from '../Common/NepaliDateTimePicker.jsx';
import SearchableSelect from '../Common/SearchableSelect.jsx';
import SaveButton from '../Common/SaveButton.jsx';
import RichTextEditor from '../Common/RichTextEditor.jsx';
import Avatar from '../Common/Avatar.jsx';
import HoverCard from '../Common/HoverCard.jsx';
import EmpMultiSelect from '../Common/EmpMultiSelect.jsx';
import ContactFormModal, { CONTACT_EMPTY } from './ContactFormModal.jsx';
import { useNotifications } from '../Notifications/AttendanceToasts.jsx';
import useSaveShortcut from '../../hooks/useSaveShortcut.js';
import useDateFormat from '../../hooks/useDateFormat.js';
import { getNepalTodayISO, toNepalISO, isoToNepalLocalInput, formatNepalDateTime, formatNepalTime, addDaysISO } from '../../utils/dateUtils.js';
import FieldVisitJourneyPanel, { CHECKOUT_STATUS_LABEL } from './FieldVisitJourneyPanel.jsx';
import { haversineKm } from '../../utils/geoUtils.js';
// Temporarily disabled — the Leaflet import chain breaks the production
// bundle app-wide (see StaffTrackFlowModal.jsx's top for details). Re-enable
// once that's fixed with a lazy-loaded/code-split import instead.
// import StaffTrackFlowModal from './StaffTrackFlowModal.jsx';

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

const emptyTask = { title: '', description: '', contactId: '', contactPersonId: '', categoryId: '', priorityId: '', dueDate: todayISO(), assignedTo: [], status: 'pending', isFieldVisit: false };

// Task grid date-bucket sections ("Today", "Tomorrow", ...). addDaysISO now
// lives in dateUtils.js (imported above) since TaskDashboard.jsx needs the
// same day-offset math.
const daysBetweenISO = (fromISO, toISO) => {
  const [y1, m1, d1] = fromISO.split('-').map(Number);
  const [y2, m2, d2] = toISO.split('-').map(Number);
  return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000);
};

// Same "today/tomorrow/day-after-tomorrow" bucketing the Task Date column
// renders, pulled out so the WhatsApp "Send Today's Task" digest can select
// exactly the rows that column is showing as "Today" (including a still-open
// overdue task carried forward) without re-deriving the rule twice.
const TASK_DATE_BADGES = {
  today:    { label: 'Today',      bg: '#fef2f2', color: '#dc2626' },
  tomorrow: { label: 'Tomorrow',   bg: '#fffbeb', color: '#b45309' },
  dayAfter: { label: 'Day Af.To',  bg: '#eff6ff', color: '#1d4ed8' },
};
const taskDateBucket = (row) => {
  const due = row.dueDate ? String(row.dueDate).split('T')[0] : null;
  if (!due) return null;
  const today = getNepalTodayISO();
  if ((due < today && row.status !== 'completed') || due === today) return 'today';
  if (due === addDaysISO(today, 1)) return 'tomorrow';
  if (due === addDaysISO(today, 2)) return 'dayAfter';
  return null;
};

// "Assigned To" cell — avatar-only overlapping stack (same visual convention
// as SeenByAvatars below), name text is too wide for the column once a task
// has several assignees. Hovering an avatar shows the full name + post; a
// native `title` tooltip renders in tiny OS chrome, not big enough to read
// comfortably, hence the shared HoverCard used for both this and Seen By.
const MAX_ASSIGNEE_AVATARS = 4;
const AssigneeCell = ({ assignees }) => {
  if (!Array.isArray(assignees) || !assignees.length) return <span style={{ color: '#d1d5db' }}>—</span>;
  const shown = assignees.slice(0, MAX_ASSIGNEE_AVATARS);
  const extra = assignees.length - shown.length;
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {shown.map((a, i) => (
        <HoverCard key={a.id}
          trigger={
            <div style={{ marginLeft: i === 0 ? 0 : -8, borderRadius: '50%', border: '2px solid #fff',
              boxShadow: '0 0 0 1px #e5e7eb', position: 'relative', zIndex: shown.length - i }}>
              <Avatar photo={a.photo} name={a.name} size={22} />
            </div>
          }
          content={
            <div>
              <div style={{ fontWeight: 700, color: '#1e293b', fontSize: 12.5 }}>{a.name}</div>
              <div style={{ color: '#6b7280', fontSize: 11, marginTop: 1 }}>{a.post || '—'}</div>
            </div>
          }
          minWidth={150} />
      ))}
      {extra > 0 && (
        <div title={`+${extra} more`} style={{ marginLeft: -8, width: 22, height: 22, borderRadius: '50%',
          border: '2px solid #fff', boxShadow: '0 0 0 1px #e5e7eb', background: '#e5e7eb', color: '#6b7280',
          fontSize: 9.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          +{extra}
        </div>
      )}
    </div>
  );
};

// WhatsApp-style emoji reactions — used on both a Followup's own description
// and each individual reply in its thread. One reaction per person per
// target: clicking a pill you're already part of removes your reaction
// (via onReact re-sending the same emoji, which the server toggles off);
// clicking any other pill or the "+" picker sets/switches yours to it.
// Hovering a pill shows who reacted, photo + name, same as WhatsApp's
// tap-a-reaction-to-see-who popup.
const REACTION_EMOJI = ['✅', '👍', '👎', '❤️', '😂'];
const ReactionBar = ({ reactions, currentUserId, onReact }) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!pickerOpen) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setPickerOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [pickerOpen]);

  const groups = [];
  (reactions || []).forEach(r => {
    let g = groups.find(g => g.emoji === r.emoji);
    if (!g) { g = { emoji: r.emoji, users: [] }; groups.push(g); }
    g.users.push(r);
  });

  const pick = (emoji) => { onReact(emoji); setPickerOpen(false); };

  return (
    <div ref={ref} style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', marginTop: 5, position: 'relative' }}
      onClick={e => e.stopPropagation()}>
      {groups.map(g => {
        const mine = g.users.some(u => String(u.userId) === String(currentUserId));
        return (
          <HoverCard key={g.emoji}
            trigger={
              <button onClick={() => pick(g.emoji)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 3, height: 20, padding: '0 6px',
                  borderRadius: 10, border: `1px solid ${mine ? '#93c5fd' : '#e5e7eb'}`,
                  background: mine ? '#eff6ff' : '#f9fafb', cursor: 'pointer', fontSize: 11, lineHeight: 1 }}>
                <span>{g.emoji}</span>
                <span style={{ color: mine ? '#1d4ed8' : '#6b7280', fontWeight: 700 }}>{g.users.length}</span>
              </button>
            }
            content={
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {g.users.map(u => (
                  <div key={u.userId} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Avatar photo={u.userPhoto} name={u.userName} size={20} />
                    <span style={{ fontSize: 12.5 }}>{u.userName}</span>
                  </div>
                ))}
              </div>
            }
            minWidth={150} />
        );
      })}
      <div style={{ position: 'relative' }}>
        <button onClick={() => setPickerOpen(p => !p)} title="React"
          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20,
            borderRadius: '50%', border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', fontSize: 12, color: '#9ca3af', lineHeight: 1 }}>
          +
        </button>
        {pickerOpen && (
          <div style={{ position: 'absolute', bottom: 24, left: 0, zIndex: 20, display: 'flex', gap: 2,
            background: '#fff', border: '1px solid #e5e7eb', borderRadius: 20, padding: '4px 6px',
            boxShadow: '0 6px 18px rgba(0,0,0,.15)' }}>
            {REACTION_EMOJI.map(e => (
              <button key={e} onClick={() => pick(e)} title={e}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, padding: '2px 4px', borderRadius: 6 }}
                onMouseEnter={ev => ev.currentTarget.style.background = '#f3f4f6'}
                onMouseLeave={ev => ev.currentTarget.style.background = 'none'}>
                {e}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// "Seen by" — WhatsApp-style overlapping avatar stack, used on the Task
// itself (New/Edit Task form + Followup History panel header) and on each
// individual Followup entry. Hovering one avatar shows who they are and the
// exact date/time they last opened it (task_views.seen_at); once the list
// grows past MAX_SEEN_AVATARS the rest collapse into a plain "+N" chip.
const MAX_SEEN_AVATARS = 6;
const SeenByAvatars = ({ seenBy, fd }) => {
  if (!Array.isArray(seenBy) || !seenBy.length) return null;
  const shown = seenBy.slice(0, MAX_SEEN_AVATARS);
  const extra = seenBy.length - shown.length;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.3px' }}>
        👀 Seen by
      </span>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {shown.map((v, i) => (
          <HoverCard key={v.userId}
            trigger={
              <div style={{ marginLeft: i === 0 ? 0 : -8, borderRadius: '50%', border: '2px solid #fff',
                boxShadow: '0 0 0 1px #e5e7eb', position: 'relative', zIndex: shown.length - i }}>
                <Avatar photo={v.userPhoto} name={v.userName} size={22} />
              </div>
            }
            content={
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Avatar photo={v.userPhoto} name={v.userName} size={26} />
                <div>
                  <div style={{ fontWeight: 700, color: '#1e293b', fontSize: 12.5 }}>{v.userName || '—'}</div>
                  <div style={{ color: '#6b7280', fontSize: 11, marginTop: 1 }}>Seen {formatNepalDateTime(v.seenAt, fd)}</div>
                </div>
              </div>
            }
            minWidth={170} />
        ))}
        {extra > 0 && (
          <div title={`+${extra} more`} style={{ marginLeft: -8, width: 22, height: 22, borderRadius: '50%',
            border: '2px solid #fff', boxShadow: '0 0 0 1px #e5e7eb', background: '#e5e7eb', color: '#6b7280',
            fontSize: 9.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            +{extra}
          </div>
        )}
      </div>
    </div>
  );
};

// "Followed up by {Name} ({Post})" byline under a Followup entry's own
// description — who actually logged this entry, same idea as the "Name
// (Post): message" line each reply already carries.
const FollowedByLine = ({ f }) => !f ? null : (
  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 11, color: '#9ca3af' }}>
    <Avatar photo={f.followedByPhoto} name={f.followedByName} size={18} />
    <span>
      Followed up by <strong style={{ color: '#6b7280' }}>{f.followedByName || '—'}</strong>
      {f.followedByPost && <span> ({f.followedByPost})</span>}
    </span>
  </div>
);

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
  { value: 'cancelled',   label: 'Cancelled' },
];

const FOLLOWUP_MODES = [
  { value: 'phone',    label: 'Phone',    icon: '📞' },
  { value: 'email',    label: 'Email',    icon: '✉️' },
  { value: 'whatsapp', label: 'WhatsApp', icon: '💬' },
  { value: 'sms',      label: 'SMS',      icon: '📱' },
];

const emptyFollowup = { mode: 'phone', followupDate: todayISO(), description: '', nextCategoryId: '', nextFollowupAt: '', handedOverTo: '' };

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

// Duration between two ISO timestamps ("2h 15m") — used by the Field Visit
// Log card for a stop's "Total Hour Stayed".
const fmtDuration = (fromIso, toIso) => {
  if (!fromIso || !toIso) return '—';
  const mins = Math.max(0, Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60000));
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

// Same duration, "HH:MM" instead — used by the Field Visit Log's per-stop
// summary line specifically (fmtDuration's "2h 15m" is for the individual
// checkpoint card above it).
const fmtHHMM = (fromIso, toIso) => {
  if (!fromIso || !toIso) return '—';
  const mins = Math.max(0, Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60000));
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
};

// A GPS fix is never pixel-exact — staff_contacts.latitude/longitude is
// itself just refreshed from the most recent check-in (see fieldVisit.js's
// migration comment), not a surveyed address, so "same location" has to mean
// "close enough", not "identical". 500m covers ordinary GPS drift and being
// somewhere else in a large complex/building without being so loose it'd
// pass a check-in from genuinely the wrong place.
const LOCATION_VERIFY_RADIUS_KM = 0.5;
const isLocationVerified = (lat, lng, clientLat, clientLng) => {
  if (lat == null || lng == null || clientLat == null || clientLng == null) return null; // nothing on file to verify against
  return haversineKm(lat, lng, clientLat, clientLng) <= LOCATION_VERIFY_RADIUS_KM;
};

// Yes / No / — (verified === null means there's no client location on file yet
// to compare against — e.g. this is the very first visit ever logged for this
// client, before staff_contacts.latitude/longitude has anything to go on).
const VerifyBadge = ({ verified }) => (
  <span style={{
    fontSize: 10.5, fontWeight: 700, padding: '1px 7px', borderRadius: 8,
    background: verified == null ? '#f3f4f6' : verified ? '#d1fae5' : '#fee2e2',
    color:      verified == null ? '#9ca3af' : verified ? '#065f46' : '#991b1b',
  }}>
    Location Verified: {verified == null ? '—' : verified ? 'Yes' : 'No'}
  </span>
);

// The address/location-name label for one Field Visit checkpoint, clickable
// straight to that exact GPS pin on Google Maps when the coordinates are on
// file — no API key needed, just a plain maps.google.com link.
const LocationPin = ({ lat, lng, label }) => {
  if (lat == null || lng == null) return label ? <span>{label}</span> : null;
  return (
    <a href={`https://www.google.com/maps?q=${lat},${lng}`} target="_blank" rel="noopener noreferrer"
      style={{ color: '#1a56db', fontWeight: 600, textDecoration: 'none' }}>
      📍 {label || 'View Location'}
    </a>
  );
};

const DateInput = ({ value, onChange }) => {
  const { settings } = useSettings();
  if (settings.defaultCalendar === 'np') return <NepaliDatePicker value={value} onChange={onChange} />;
  return (
    <input type="date" value={value} onChange={e => onChange(e.target.value)}
      style={{ height: 36, width: '100%', border: '1px solid #d1d5db', borderRadius: 7, padding: '0 10px', fontSize: 13, boxSizing: 'border-box', outline: 'none' }} />
  );
};

// Same Default Calendar switch as DateInput above, for a date+time field
// ("Next Followup & Time") — Nepali when Settings → Default Calendar is set
// to "np", plain Gregorian otherwise.
const DateTimeInput = (props) => {
  const { settings } = useSettings();
  if (settings.defaultCalendar === 'np') return <NepaliDateTimePicker {...props} />;
  return <DateTimePicker {...props} />;
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

// fieldVisitOnly — reused by the separate "Field Visit" nav page (Staff >
// Field Visit) to show the exact same list/grid/Add-Task experience as the
// regular Task page, filtered down to Field-Visit-flagged tasks only (see
// the "Field Visit" checkbox on the Add/Edit form below and the "Mark/Remove
// Field Visit" context-menu action). Its own unread badge (fieldVisitTaskCount)
// is kept separate from the regular Task badge — see AttendanceToasts.jsx.
const TaskList = ({ fieldVisitOnly = false }) => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { canManageSystem, currentUser, isAdmin, isSuperAdmin, isBranchManager, isDeptHead } = useAuth();
  const { employees, filteredEmployees } = useData();
  const { refreshTaskCounts } = useNotifications();
  const { flags: moduleFlags } = useModuleFlags();
  const { settings } = useSettings();
  const fd = useDateFormat();

  // The Staff/Task nav badge is meant to keep blinking per-task until that
  // task is actually acted on — double-clicked open, or a followup logged
  // against it (see openEdit/saveFollowup below) — NOT cleared in bulk just
  // from opening this list page. (Previously this cleared every unread
  // notification the instant the page mounted, so the blink never had a
  // chance to mean anything.)
  const markTaskRead = (taskId) => {
    api.post(`/tasks/${taskId}/notifications/read`).then(refreshTaskCounts).catch(() => {});
  };

  const [tasks,      setTasks]      = useState([]);
  const [categories, setCategories] = useState([]);
  const [priorities, setPriorities] = useState([]);
  const [contacts,   setContacts]   = useState([]);
  const [loading,    setLoading]    = useState(true);

  const [modal,   setModal]   = useState(false);
  const [editId,  setEditId]  = useState(null);
  const [form,    setForm]    = useState(emptyTask);
  const [errors,  setErrors]  = useState({});
  // Emoji reactions + "Seen by" for whichever existing task is open in the
  // Add/Edit Task modal — meaningless for a brand-new task (nothing to react
  // to or have seen yet), so this only ever gets populated in openEdit.
  const [taskModalMeta, setTaskModalMeta] = useState({ reactions: [], seenBy: [] });
  const [trackFlowOpen, setTrackFlowOpen] = useState(false);
  const [saving,  setSaving]  = useState(false);

  // Filter by Staff — a plain employee defaults to seeing only their own
  // tasks (creator or assignee); anyone with company-wide or branch/
  // department oversight (admin/superAdmin/branch manager/dept head)
  // defaults straight to "Show All Task" instead, since limiting THEM to
  // just their own personally-created/assigned tasks on first open looked
  // like the page was silently dropping most of the company's tasks —
  // they'd have to already know to click "Show All Task" every single time
  // to see what they actually have oversight of. The dropdown still lets
  // anyone narrow to a specific person or (for an employee) there's simply
  // nothing wider to switch to. Scoped by role server-side either way — see
  // GET /api/tasks's ?staffId= handling in server/routes/tasks.js.
  const [staffFilter, setStaffFilter] = useState(() => {
    if (!currentUser) return '';
    return (isAdmin || isSuperAdmin || isBranchManager || isDeptHead) ? 'all' : String(currentUser.id);
  });

  // Quick filters, next to Filter by Staff — "My Yesterday Task"/"My
  // Tomorrow's Task" are always scoped to the logged-in user specifically
  // (creator or assignee), independent of whatever Filter by Staff is
  // currently set to. Mutually exclusive — picking one clears the other,
  // since both narrow the grid to a single specific day.
  const [yesterdayOnly, setYesterdayOnly] = useState(false);
  const [tomorrowOnly,  setTomorrowOnly]  = useState(false);
  const [quickPriorityId, setQuickPriorityId] = useState('');
  // Header-level Task Category quick filter (pill row) — separate from
  // Advance Search's own categoryId field, same relationship quickPriorityId
  // already has to advSearch.priorityId.
  const [quickCategoryId, setQuickCategoryId] = useState('');

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
  // action: optional { label, onClick } — rendered as a button inside the
  // toast (e.g. "Notify WhatsApp" right after saving a task). Stays up
  // longer than a plain toast so there's time to actually click it.
  const showToast = (msg, type = 'success', action = null) => {
    setToast({ msg, type, action });
    setTimeout(() => setToast(null), action ? 6000 : 3000);
  };

  // WhatsApp notify — click-to-chat only (no Business API on file for this
  // tenant), so "sending" means opening a pre-filled wa.me chat the user
  // still has to press Send in themselves. Numbers come from the assignee's
  // own Staff Detail mobile (employees[].phone), never a customer's.
  const [whatsappPicker, setWhatsappPicker] = useState(null); // { task, assignees } when a task has 2+ assignees to choose from
  const [smsPicker, setSmsPicker] = useState(null); // { task, assignees } when a task has 2+ assignees to choose from
  const [smsSending, setSmsSending] = useState(false);

  // "+ Add New" next to Customer Name — the real Contact form, in a popup
  const [contactModal, setContactModal] = useState(false);

  // Task grid's right-click "Edit Customer Contact" — the same ContactFormModal,
  // opened straight from a row's linked contact rather than the task form's
  // "+ Add New". Holds the full contact record (looked up from `contacts`,
  // not the task row's own flattened customerName/customerMobile/etc. fields,
  // which are display-only and don't match ContactFormModal's expected shape).
  const [editContactModal, setEditContactModal] = useState(null);
  const openContactEdit = (row) => {
    const contact = contacts.find(c => String(c.id) === String(row.contactId));
    if (!contact) { showToast('This task has no linked customer contact', 'error'); return; }
    setEditContactModal(contact);
  };

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

  // Field Visit Log — this task's own GPS check-in/check-out stops (across
  // every trip that's visited it), shown as a small card in the side panel
  // below Description. Only relevant for a field-visit-flagged task.
  const [fieldVisitStops, setFieldVisitStops] = useState([]);
  const [fieldVisitStopsLoading, setFieldVisitStopsLoading] = useState(false);
  useEffect(() => {
    if (!followupTask?.isFieldVisit) { setFieldVisitStops([]); return; }
    setFieldVisitStopsLoading(true);
    api.get(`/field-visit/tasks/${followupTask.id}/stops`)
      .then(rows => setFieldVisitStops(Array.isArray(rows) ? rows : []))
      .catch(() => setFieldVisitStops([]))
      .finally(() => setFieldVisitStopsLoading(false));
  }, [followupTask?.id, followupTask?.isFieldVisit]);

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
    // Selecting an entry counts as reading it — same "Seen by" read receipt
    // as the task itself, just target_type='followup' server-side.
    const taskId = followupTask.id, followupId = selectedFollowup.id;
    api.put(`/tasks/${taskId}/followups/${followupId}/seen`).then(seenBy => {
      if (!seenBy) return;
      setFollowups(prev => prev.map(f => f.id === followupId ? { ...f, seenBy } : f));
      setSelectedFollowup(prev => (prev && prev.id === followupId) ? { ...prev, seenBy } : prev);
    }).catch(() => {});
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

  const reactToFollowup = async (followupId, emoji) => {
    if (!followupTask) return;
    try {
      const reactions = await api.put(`/tasks/${followupTask.id}/followups/${followupId}/reactions`, { emoji });
      setFollowups(prev => prev.map(f => f.id === followupId ? { ...f, reactions } : f));
      setSelectedFollowup(prev => (prev && prev.id === followupId) ? { ...prev, reactions } : prev);
    } catch (e) { showToast(e.message || 'Reaction failed', 'error'); }
  };

  const reactToReply = async (replyId, emoji) => {
    if (!followupTask || !selectedFollowup) return;
    try {
      const reactions = await api.put(`/tasks/${followupTask.id}/followups/${selectedFollowup.id}/replies/${replyId}/reactions`, { emoji });
      setFollowupReplies(prev => prev.map(r => r.id === replyId ? { ...r, reactions } : r));
    } catch (e) { showToast(e.message || 'Reaction failed', 'error'); }
  };

  // Emoji reactions on the task itself — same one-per-person mechanism as a
  // followup's description (reactToFollowup above), just target_type='task'
  // server-side. Used by both the Add/Edit Task modal and the Followup
  // History panel header, so it returns the fresh list rather than writing
  // straight into one specific piece of state.
  const reactToTask = async (taskId, emoji) => {
    try {
      return await api.put(`/tasks/${taskId}/reactions`, { emoji });
    } catch (e) { showToast(e.message || 'Reaction failed', 'error'); return null; }
  };

  // "Seen by" read receipt — fired the moment the caller actually opens the
  // Edit Task form or the Followup History panel/a specific followup entry
  // (see openEdit, openFollowupPanel, and the selectedFollowup effect below).
  // Silently no-ops on failure — a missed read receipt shouldn't surface as
  // an error to whoever's just trying to look at a task.
  const markTaskSeen = (taskId) => api.put(`/tasks/${taskId}/seen`).catch(() => null);

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
            <ReactionBar reactions={r.reactions} currentUserId={currentUser?.id} onReact={emoji => reactToReply(r.id, emoji)} />
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

  // Sequence guard — Filter by Staff defaults to "Show All Task" for anyone
  // with oversight (admin/superAdmin/branch manager/dept head), so the very
  // first fetch on mount is already the big unscoped query. Picking a
  // specific staff member right after that fires a second, usually much
  // smaller/faster request — without this guard, if the initial "all" fetch
  // happens to resolve AFTER the newer filtered one (a real race, not just
  // theoretical: a full company-wide scan is the slower query of the two),
  // its stale response clobbers the correctly-filtered result and the grid
  // silently shows everyone's tasks again despite the picker showing one
  // specific person selected. Only the most-recently-fired request's
  // response is ever applied.
  const loadTasksSeqRef = useRef(0);
  const loadTasks = () => {
    setLoading(true);
    const seq = ++loadTasksSeqRef.current;
    const qs = staffFilter ? `?staffId=${encodeURIComponent(staffFilter)}` : '';
    api.get(`/tasks${qs}`).then(rows => {
      if (seq !== loadTasksSeqRef.current) return; // superseded by a newer request
      setTasks(Array.isArray(rows) ? rows : []);
    })
      .catch(e => { if (seq === loadTasksSeqRef.current) showToast(e.message || 'Failed to load tasks', 'error'); })
      .finally(() => { if (seq === loadTasksSeqRef.current) setLoading(false); });
  };
  const loadCategories = () => api.get('/settings/taskCategories').then(rows => setCategories(Array.isArray(rows) ? rows : [])).catch(() => setCategories([]));
  const loadPriorities = () => api.get('/settings/taskPriorities').then(rows => setPriorities(Array.isArray(rows) ? rows : [])).catch(() => setPriorities([]));
  const loadContacts   = () => api.get('/contacts').then(rows => setContacts(Array.isArray(rows) ? rows : [])).catch(() => setContacts([]));

  useEffect(() => { loadCategories(); loadPriorities(); loadContacts(); }, []);
  useEffect(() => { loadTasks(); }, [staffFilter]);

  // filteredEmployees (DataContext) deliberately excludes superAdmin accounts
  // company-wide (they're not a manageable "staff" row on most pages) — but
  // that means a superAdmin login would never see a "(Me)" option here and
  // could never filter Field Visit/Task down to just their own tasks. Patch
  // them back into this dropdown only (not the shared list) when missing.
  const staffFilterOptions = useMemo(() => {
    const selfMissing = currentUser && !filteredEmployees.some(e => String(e.id) === String(currentUser.id));
    const list = selfMissing ? [...filteredEmployees, currentUser] : filteredEmployees;
    return [
      { value: 'all', label: '🗂 Show All Task' },
      ...list.map(e => ({
        value: String(e.id),
        label: currentUser && String(e.id) === String(currentUser.id) ? `${e.fullName} (Me)` : e.fullName,
        photo: e.profilePhoto,
      })),
    ];
  }, [filteredEmployees, currentUser]);

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
    // A completed task stays visible on its completion day and the following
    // day, then drops off the list — otherwise every finished task pile up
    // here forever, struck-through, next to the ones still open.
    const todayNepal = getNepalTodayISO();
    let result = tasks.filter(t => {
      if (t.status !== 'completed' || !t.completedAt) return true;
      return daysBetweenISO(toNepalISO(t.completedAt), todayNepal) <= 1;
    });

    if (yesterdayOnly || tomorrowOnly) {
      const targetNepal = addDaysISO(getNepalTodayISO(), yesterdayOnly ? -1 : 1);
      result = result.filter(t => {
        const due = t.dueDate ? String(t.dueDate).split('T')[0] : null;
        if (due !== targetNepal) return false;
        return String(t.createdBy) === String(currentUser?.id)
          || (Array.isArray(t.assignees) && t.assignees.some(a => String(a.id) === String(currentUser?.id)));
      });
    }

    if (quickPriorityId) result = result.filter(t => String(t.priorityId) === quickPriorityId);
    if (quickCategoryId) result = result.filter(t => String(t.categoryId) === quickCategoryId);

    if (fieldVisitOnly) result = result.filter(t => t.isFieldVisit);

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
  }, [tasks, yesterdayOnly, tomorrowOnly, quickPriorityId, quickCategoryId, fieldVisitOnly, advSearch, advSearchActive, employeeById, currentUser]);

  // Per-category header chip stats — followup count + "has an unseen new
  // task" per category, both scoped to today's tasks (same taskDateBucket
  // the Task Date column renders). Deliberately sourced from `tasks` (the
  // server-scoped list) rather than `visibleTasks`, which is already
  // narrowed by quickCategoryId itself — every OTHER category's chip would
  // read as empty the moment one category got selected otherwise.
  const categoryStats = useMemo(() => {
    const map = new Map(); // categoryId string -> { followupCount, hasUnseenNew }
    const today = getNepalTodayISO();
    tasks.forEach(t => {
      if (taskDateBucket(t) !== 'today' || !t.categoryId) return;
      const key = String(t.categoryId);
      const entry = map.get(key) || { followupCount: 0, hasUnseenNew: false };
      entry.followupCount += (t.followupCount || 0);
      const createdNepal = t.createdAt ? isoToNepalLocalInput(t.createdAt).split('T')[0] : null;
      const isNew = createdNepal === today;
      const seenByMe = Array.isArray(t.seenBy) && t.seenBy.some(v => String(v.userId) === String(currentUser?.id));
      if (isNew && !seenByMe) entry.hasUnseenNew = true;
      map.set(key, entry);
    });
    return map;
  }, [tasks, currentUser]);

  // WhatsApp notify — click-to-chat only (no Business API on file for this
  // tenant), so "sending" opens a pre-filled wa.me chat the user still has
  // to press Send in themselves. Numbers always come from the assignee's own
  // Staff Detail mobile (employees[].phone), never a customer's.
  const sendWhatsAppTo = (phone, message, missingLabel) => {
    const digits = (phone || '').replace(/\D/g, '');
    if (!digits) { showToast(`No mobile number on file for ${missingLabel}`, 'error'); return; }
    const target = digits.length === 10 ? `977${digits}` : digits;
    window.open(`https://wa.me/${target}?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
  };

  const composeTaskMessage = (row) => {
    const desc = stripHtml(row.description);
    const lines = [
      `Task: ${row.title}`,
      row.customerName ? `Customer: ${row.customerName}` : null,
      row.categoryName ? `Category: ${row.categoryName}` : null,
      row.priorityName ? `Priority: ${row.priorityName}` : null,
      row.dueDate ? `Due: ${fd(String(row.dueDate).split('T')[0])}` : null,
      `Status: ${(row.status || '').replace('_', ' ')}`,
      desc ? `Note: ${desc}` : null,
    ].filter(Boolean);
    return lines.join('\n');
  };

  const notifyAssigneeWhatsApp = (row, assignee) => {
    const emp = employeeById.get(String(assignee.id));
    sendWhatsAppTo(emp?.phone, composeTaskMessage(row), assignee.name);
  };

  // Real send (not click-to-chat) via the phone-gateway SMS Gateway module —
  // POSTs to the server, which relays it to a phone on the local network.
  const sendSmsTo = async (phone, message, missingLabel) => {
    const digits = (phone || '').replace(/\D/g, '');
    if (!digits) { showToast(`No mobile number on file for ${missingLabel}`, 'error'); return; }
    const target = digits.length === 10 ? `+977${digits}` : (digits.startsWith('+') ? digits : `+${digits}`);
    setSmsSending(true);
    try {
      await api.post('/sms/send', { to: target, text: message });
      showToast(`SMS sent to ${missingLabel}`);
    } catch (e) { showToast(e.message || 'Failed to send SMS', 'error'); }
    finally { setSmsSending(false); }
  };

  const notifyAssigneeSms = (row, assignee) => {
    const emp = employeeById.get(String(assignee.id));
    sendSmsTo(emp?.phone, composeTaskMessage(row), assignee.name);
  };

  // Actions column's SMS button — sends straight to the one assignee, or
  // opens a small picker when there's more than one to choose from.
  const handleSmsClick = (row) => {
    const assignees = Array.isArray(row.assignees) ? row.assignees : [];
    if (!assignees.length) { showToast('This task has no assignee to notify', 'error'); return; }
    if (assignees.length === 1) { notifyAssigneeSms(row, assignees[0]); return; }
    setSmsPicker({ task: row, assignees });
  };

  // Actions column's WhatsApp button — sends straight to the one assignee, or
  // opens a small picker when there's more than one to choose from.
  const handleWhatsAppClick = (row) => {
    const assignees = Array.isArray(row.assignees) ? row.assignees : [];
    if (!assignees.length) { showToast('This task has no assignee to notify', 'error'); return; }
    if (assignees.length === 1) { notifyAssigneeWhatsApp(row, assignees[0]); return; }
    setWhatsappPicker({ task: row, assignees });
  };

  // Toolbar "Send Today's Task" — only meaningful once Filter by Staff is
  // narrowed to one specific person (not "Show All Task"), same rows the
  // Task Date column is already showing as "Today" for that person.
  const sendTodaysTaskDigest = () => {
    if (!staffFilter || staffFilter === 'all') {
      showToast('Select one specific staff member in "Filter by Staff" first', 'error');
      return;
    }
    const emp = employeeById.get(String(staffFilter));
    if (!emp) return;
    const todays = visibleTasks.filter(t => taskDateBucket(t) === 'today');
    if (!todays.length) { showToast(`No tasks due today for ${emp.fullName}`, 'error'); return; }
    const lines = todays.map((t, i) => `${i + 1}. ${t.title}${t.customerName ? ' - ' + t.customerName : ''}${t.priorityName ? ` [${t.priorityName}]` : ''}`);
    const message = [`Good morning ${emp.fullName}! Here are your tasks for today:`, '', ...lines].join('\n');
    sendWhatsAppTo(emp.phone, message, emp.fullName);
  };

  // Close the gear dropdown on outside click
  useEffect(() => {
    const handler = (e) => { if (gearRef.current && !gearRef.current.contains(e.target)) setGearOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const contactOptions = useMemo(() => contacts.map(c => ({ value: String(c.id), label: contactLabel(c) })), [contacts]);
  const selectedContact = useMemo(() => contacts.find(c => String(c.id) === String(form.contactId)) || null, [contacts, form.contactId]);


  // Company contacts can have multiple named people (staff_contact_persons)
  // with their own phone numbers — fetched fresh whenever the selected
  // contact changes, so the task can point at exactly one of them.
  const [contactPersons, setContactPersons] = useState([]);
  useEffect(() => {
    if (!form.contactId || selectedContact?.contactInfo !== 'company') { setContactPersons([]); return; }
    api.get(`/contacts/${form.contactId}/persons`).then(rows => setContactPersons(Array.isArray(rows) ? rows : [])).catch(() => setContactPersons([]));
  }, [form.contactId, selectedContact?.contactInfo]);

  const openAdd = () => { setEditId(null); setForm({ ...emptyTask, dueDate: todayISO(), isFieldVisit: fieldVisitOnly }); setErrors({}); setTaskModalMeta({ reactions: [], seenBy: [] }); setModal(true); };
  const openEdit = (row) => {
    setEditId(row.id);
    setForm({
      title: row.title || '', description: row.description || '',
      contactId: row.contactId ? String(row.contactId) : '',
      contactPersonId: row.contactPersonId ? String(row.contactPersonId) : '',
      categoryId: row.categoryId ? String(row.categoryId) : '',
      priorityId: row.priorityId ? String(row.priorityId) : '',
      dueDate: row.dueDate ? String(row.dueDate).split('T')[0] : todayISO(),
      assignedTo: Array.isArray(row.assignees) ? row.assignees.map(a => String(a.id)) : [],
      status: row.status || 'pending',
      isFieldVisit: !!row.isFieldVisit,
    });
    setErrors({});
    setTaskModalMeta({ reactions: row.reactions || [], seenBy: row.seenBy || [] });
    markTaskSeen(row.id).then(seenBy => { if (seenBy) setTaskModalMeta(p => ({ ...p, seenBy })); });
    markTaskRead(row.id); // opening a task for edit (double-click) is an explicit "seen it" — stops the nav badge blinking for it
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
      isFieldVisit: !!form.isFieldVisit,
    };
    try {
      const saved = editId ? await api.put(`/tasks/${editId}`, payload) : await api.post('/tasks', payload);
      showToast(
        editId ? 'Task updated' : 'Task added',
        'success',
        Array.isArray(saved?.assignees) && saved.assignees.length ? { label: '📱 Notify WhatsApp', onClick: () => handleWhatsAppClick(saved) } : null
      );
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

  // Right-click "Mark/Remove Field Visit" — flips the flag without reopening
  // the whole Edit Task form. In the Field Visit page (fieldVisitOnly) an
  // unmarked task simply drops out of visibleTasks on the next render.
  const toggleFieldVisit = async (row) => {
    const next = !row.isFieldVisit;
    try {
      await api.patch(`/tasks/${row.id}/field-visit`, { isFieldVisit: next });
      setTasks(prev => prev.map(t => t.id === row.id ? { ...t, isFieldVisit: next } : t));
      showToast(next ? 'Marked as Field Visit' : 'Removed from Field Visit');
    } catch (e) { showToast(e.message || 'Update failed', 'error'); }
  };

  const handleContactSaved = (saved) => {
    loadContacts();
    setForm(p => ({ ...p, contactId: String(saved.id) }));
    setContactModal(false);
    showToast('Contact added');
  };

  const staffOptions = useMemo(() => filteredEmployees.map(e => ({ value: String(e.id), label: e.fullName, photo: e.profilePhoto })), [filteredEmployees]);

  const loadFollowups = (taskId) => {
    setFollowupsLoading(true);
    // Clear the previous task's followups up front — otherwise a failed
    // fetch here leaves them in place, which used to make a real "no access
    // to this task" error look like a silently-loaded (but stale) list.
    setFollowups([]);
    api.get(`/tasks/${taskId}/followups`).then(rows => setFollowups(Array.isArray(rows) ? rows : []))
      .catch(e => showToast(e.message || 'Failed to load followups', 'error'))
      .finally(() => setFollowupsLoading(false));
  };
  // Followup History isn't shown on the Field Visit page (see FieldVisitJourneyPanel
  // in the side panel below) — skip fetching it there entirely.
  const openFollowupPanel = (row) => {
    setFollowupTask(row);
    setFollowupSearch('');
    if (!fieldVisitOnly) loadFollowups(row.id);
    markTaskSeen(row.id).then(seenBy => {
      if (seenBy) setFollowupTask(prev => (prev && prev.id === row.id) ? { ...prev, seenBy } : prev);
    });
  };
  const closeFollowupPanel = () => { setFollowupTask(null); setFollowups([]); setSelectedFollowup(null); setFollowupSearch(''); setDescriptionModalOpen(false); };

  // Status dropdown in the Followup History panel header — same PATCH the
  // grid's own complete/reopen checkbox uses, just offering the full
  // Pending/In Progress/Completed/Cancelled set instead of a binary toggle.
  const updateFollowupTaskStatus = async (status) => {
    if (!followupTask) return;
    try {
      await api.patch(`/tasks/${followupTask.id}/status`, { status });
      setTasks(prev => prev.map(t => t.id === followupTask.id ? { ...t, status } : t));
      setFollowupTask(prev => prev ? { ...prev, status } : prev);
    } catch (e) { showToast(e.message || 'Update failed', 'error'); }
  };

  // Deep link from a task notification's "View" button (see TaskToast in
  // AttendanceToasts.jsx) — ?openTaskId=<id> in the URL. Broadens to "Show
  // All Task" first: the notification may be about a task the viewer only
  // has oversight of (admin, matching Department Head) rather than one
  // they personally created/are assigned to, which the default "my own
  // tasks" filter wouldn't include. For a plain employee this is always a
  // safe no-op — the server silently keeps them scoped to their own tasks
  // either way, which already covers anything they'd be notified about.
  // openEvent (see TaskToast in AttendanceToasts.jsx) tells us which kind of
  // notification this was: a brand-new "assigned" popup opens the Task form
  // itself (the whole point is to see/accept the new task); every other
  // event — completed, status/description changed, a new followup logged —
  // means something happened on an EXISTING task, so it opens the Followup
  // History panel instead, where that change actually shows up.
  const openTaskIdParam = searchParams.get('openTaskId');
  const openEventParam = searchParams.get('openEvent');
  const openedFromNotiRef = useRef(false);
  useEffect(() => {
    if (openTaskIdParam && !openedFromNotiRef.current) setStaffFilter('all');
  }, [openTaskIdParam]);
  useEffect(() => {
    if (!openTaskIdParam || openedFromNotiRef.current || loading) return;
    const target = tasks.find(t => String(t.id) === String(openTaskIdParam));
    if (target) {
      openedFromNotiRef.current = true;
      if (openEventParam === 'assigned') openEdit(target);
      else openFollowupPanel(target);
      const next = new URLSearchParams(searchParams);
      next.delete('openTaskId');
      next.delete('openEvent');
      setSearchParams(next, { replace: true });
    }
  }, [tasks, loading, openTaskIdParam, openEventParam]);

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
      markTaskRead(followupTask.id); // logging a followup is an explicit "seen it" — stops the nav badge blinking for it
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
      field: 'dueDate', header: 'Task Date', width: 130,
      render: (v, row) => {
        if (!v) return <span style={{ color: '#d1d5db' }}>—</span>;
        // taskDateBucket computes fresh off getNepalTodayISO() on every call
        // (not a captured outer const), so "Today"/"Tomorrow" stay correct
        // day to day without the memoized columns array needing to recompute.
        const bucket = taskDateBucket(row);
        if (bucket) {
          const b = TASK_DATE_BADGES[bucket];
          return <span style={{ fontSize: 11.5, fontWeight: 700, padding: '2px 10px', borderRadius: 10,
            background: b.bg, color: b.color, border: `1px solid ${b.color}44`, whiteSpace: 'nowrap' }}>{b.label}</span>;
        }
        return <span style={{ fontSize: 11.5 }}>{fd(String(v).split('T')[0])}</span>;
      },
    },
    {
      field: 'title', header: 'Task', minWidth: 170,
      render: (v, row) => {
        const titleSpan = (
          <span style={{ color: row.status === 'completed' ? '#9ca3af' : '#1f2937',
            textDecoration: row.status === 'completed' ? 'line-through' : 'none' }}>
            {/* Only shown on the regular Task page — every row on the Field Visit
                page is already a field visit, so the icon would be redundant there. */}
            {row.isFieldVisit && !fieldVisitOnly && <span title="Field Visit" style={{ marginRight: 5 }}>🚗</span>}
            {v}
          </span>
        );
        // Description moved here as a hover tooltip (its own grid column was
        // removed — see below) since it's rarely needed at a glance and was
        // taking up a whole column's width for what's usually a short note.
        const descText = stripHtml(row.description);
        if (!descText) return titleSpan;
        return <HoverCard trigger={titleSpan} content={descText} maxWidth={320} side="right" arrow fontSize={12.5} />;
      },
    },
    {
      field: 'customerName', header: 'Customer', width: 150,
      render: (v, row) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          {v ? <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{v}</span> : <span style={{ color: '#d1d5db' }}>—</span>}
          {/* Small plain icon+number, no pill/border — the old badge-style
              chips (colored background, border, padding) added enough
              height to noticeably bloat every row; this keeps the cell to a
              single text line, matching the grid's other compact columns. */}
          {row.followupCount > 0 && (
            <span title={`${row.followupCount} followup${row.followupCount === 1 ? '' : 's'} logged`}
              style={{ fontSize: 10.5, color: '#dc2626', fontWeight: 700, flexShrink: 0, whiteSpace: 'nowrap' }}>
              💬{row.followupCount}
            </span>
          )}
          {row.createdAt && (() => {
            const startedNepal = isoToNepalLocalInput(row.createdAt).split('T')[0];
            const daysStarted = daysBetweenISO(startedNepal, getNepalTodayISO());
            return (
              <span title="Days since this task started"
                style={{ fontSize: 10.5, color: '#92400e', fontWeight: 700, flexShrink: 0, whiteSpace: 'nowrap' }}>
                {daysStarted <= 0 ? 'Today' : `${daysStarted}d`}
              </span>
            );
          })()}
        </span>
      ),
    },
    {
      field: 'personName', header: 'Person Name', width: 130,
      render: (v) => v || <span style={{ color: '#d1d5db' }}>—</span>,
    },
    {
      field: 'customerMobile', header: 'Mobile no. | Phone', width: 170, sortable: false, filterable: false,
      render: (_, row) => {
        const parts = [row.customerMobile, row.customerMobile2, row.customerPhone].filter(Boolean);
        return parts.length ? parts.join(' | ') : <span style={{ color: '#d1d5db' }}>—</span>;
      },
    },
    {
      field: 'categoryName', header: 'Category', width: 110, align: 'center',
      render: (v) => v ? (
        <span style={{ fontSize: 11.5, fontWeight: 700, padding: '2px 10px', borderRadius: 10,
          background: '#eff6ff', color: '#1d4ed8', border: '1px solid #1d4ed844', whiteSpace: 'nowrap' }}>{v}</span>
      ) : <span style={{ color: '#d1d5db' }}>—</span>,
    },
    {
      field: 'priorityName', header: 'Priority', width: 100, align: 'center',
      render: (v, row) => {
        if (!v) return <span style={{ color: '#d1d5db' }}>—</span>;
        const color = row.priorityColor || '#475569';
        return (
          <span style={{ fontSize: 11.5, fontWeight: 700, padding: '2px 10px', borderRadius: 10,
            background: `${color}22`, color, border: `1px solid ${color}44`, whiteSpace: 'nowrap' }}>{v}</span>
        );
      },
    },
    {
      field: 'createdByName', header: 'Assign By', width: 60, sortable: false, filterable: false, align: 'center',
      render: (v, row) => v ? (
        <HoverCard
          trigger={<div style={{ display: 'inline-flex' }}><Avatar photo={row.createdByPhoto} name={v} size={22} /></div>}
          content={<div style={{ fontWeight: 700, color: '#1e293b', fontSize: 12.5 }}>{v}</div>}
          minWidth={100} />
      ) : <span style={{ color: '#d1d5db' }}>—</span>,
    },
    {
      field: 'assignees', header: 'Assigned To', width: 150, sortable: false, filterable: false,
      render: (v) => <AssigneeCell assignees={v} />,
    },
    {
      field: 'status', header: 'Status', width: 100, align: 'center',
      render: (v) => {
        const s = v === 'completed' ? { bg: '#f0fdf4', color: '#15803d' }
          : v === 'cancelled' ? { bg: '#f3f4f6', color: '#6b7280' }
          : v === 'in_progress' ? { bg: '#eff6ff', color: '#1d4ed8' }
          : { bg: '#fffbeb', color: '#b45309' };
        return <span style={{ fontSize: 11.5, fontWeight: 700, padding: '2px 10px', borderRadius: 10,
          background: s.bg, color: s.color, border: `1px solid ${s.color}44`, textTransform: 'capitalize', whiteSpace: 'nowrap' }}>{v.replace('_', ' ')}</span>;
      },
    },
  ], [fd, fieldVisitOnly]);

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
            showAvatar
          />
        </div>
      </div>

      <button onClick={() => { setYesterdayOnly(p => !p); setTomorrowOnly(false); }}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 12px',
          border: `1px solid ${yesterdayOnly ? '#1a56db' : '#d1d5db'}`, borderRadius: 7, cursor: 'pointer',
          background: yesterdayOnly ? '#eff6ff' : '#fff', color: yesterdayOnly ? '#1a56db' : '#374151',
          fontSize: 12.5, fontWeight: 600 }}>
        📅 My Yesterday Task
      </button>

      <button onClick={() => { setTomorrowOnly(p => !p); setYesterdayOnly(false); }}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 12px',
          border: `1px solid ${tomorrowOnly ? '#1a56db' : '#d1d5db'}`, borderRadius: 7, cursor: 'pointer',
          background: tomorrowOnly ? '#eff6ff' : '#fff', color: tomorrowOnly ? '#1a56db' : '#374151',
          fontSize: 12.5, fontWeight: 600 }}>
        📅 My Tomorrow's Task
      </button>

      <button onClick={sendTodaysTaskDigest}
        disabled={!staffFilter || staffFilter === 'all'}
        title={!staffFilter || staffFilter === 'all' ? 'Select one specific staff member in Filter by Staff first' : "Send this staff member's today's tasks via WhatsApp"}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 12px',
          border: '1px solid #bbf7d0', borderRadius: 7,
          cursor: (!staffFilter || staffFilter === 'all') ? 'not-allowed' : 'pointer',
          opacity: (!staffFilter || staffFilter === 'all') ? 0.5 : 1,
          background: '#f0fdf4', color: '#16a34a', fontSize: 12.5, fontWeight: 600 }}>
        💬 Send Today's Task
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

  // Footer preview strip — Company Name / Task / Description of whichever
  // task row is currently selected/focused (same row the Followup History
  // drawer is open for). A long description shows truncated with a hover
  // card for the full text instead of stretching the footer.
  const taskFooterLeft = (() => {
    const descText = stripHtml(followupTask?.description);
    const descNode = !descText ? '—' : descText.length <= 50
      ? descText
      : <HoverCard trigger={<span style={{ cursor: 'default', borderBottom: '1px dotted #9ca3af' }}>{descText.slice(0, 50)}…</span>} content={descText} />;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, fontSize: 12.5, color: '#374151', flexWrap: 'wrap' }}>
        <span><span style={{ color: '#6b7280', fontWeight: 600 }}>Company Name :</span> {followupTask?.customerName || '—'}</span>
        <span><span style={{ color: '#6b7280', fontWeight: 600 }}>Task :</span> {followupTask?.title || '—'}</span>
        <span><span style={{ color: '#6b7280', fontWeight: 600 }}>Description :</span> {descNode}</span>
      </div>
    );
  })();

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 60px)', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 18, flexShrink: 0 }}>
        <h1 className="page-title" style={{ flexShrink: 0 }}>
          {fieldVisitOnly ? '🚗 Field Visit' : '✅ Task'}
        </h1>

        {/* Task Category quick filter — each chip shows today's followup
            count for that category (top-right corner) and a ringing 🔔 when
            it has a new task the viewer hasn't opened yet. Only on the
            regular Task page; Field Visit's own page stays uncluttered. */}
        {!fieldVisitOnly && (
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => setQuickCategoryId('')}
              style={{ height: 26, padding: '0 10px', borderRadius: 5, cursor: 'pointer', fontSize: 11, fontWeight: 400,
                border: 'none',
                background: !quickCategoryId ? '#dbeafe' : '#f1f5f9', color: !quickCategoryId ? '#1a56db' : '#64748b' }}>
              All
            </button>
            {categories.map(c => {
              const on = quickCategoryId === String(c.id);
              const stat = categoryStats.get(String(c.id));
              const count = stat?.followupCount || 0;
              const hasUnseenNew = !!stat?.hasUnseenNew;
              return (
                <button key={c.id} onClick={() => setQuickCategoryId(on ? '' : String(c.id))}
                  style={{ position: 'relative', height: 26, padding: '0 10px', borderRadius: 5, cursor: 'pointer',
                    fontSize: 11, fontWeight: 400, border: 'none',
                    background: on ? '#dbeafe' : '#f1f5f9', color: on ? '#1a56db' : '#64748b', whiteSpace: 'nowrap' }}>
                  {c.name}
                  {(count > 0 || hasUnseenNew) && (
                    <span style={{ position: 'absolute', top: -7, right: -5, display: 'flex', alignItems: 'center', gap: 2 }}>
                      {hasUnseenNew && (
                        <span className="task-bell-ring" title="New task in this category, not seen yet" style={{ fontSize: 12 }}>🔔</span>
                      )}
                      {count > 0 && (
                        <span title={`${count} followup${count === 1 ? '' : 's'} logged today in this category`}
                          style={{ background: '#dc2626', color: '#fff', borderRadius: 8, fontSize: 9, fontWeight: 700,
                            padding: '1px 5px', lineHeight: 1.4, minWidth: 14, textAlign: 'center' }}>
                          {count}
                        </span>
                      )}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginLeft: fieldVisitOnly ? 'auto' : 0 }}>
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
            + Add {fieldVisitOnly ? 'Field Visit' : 'Task'}
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
                defaultPageSize={30}
                compact={true}
                className="task-list-grid"
                showFilterButton={false}
                toolbarLeft={taskFilterToolbar}
                footerLeft={taskFooterLeft}
                extraSearchFields={['customerPhone']}
                onRowClick={openFollowupPanel}
                onFocusChange={openFollowupPanel}
                onRowDoubleClick={openEdit}
                onDeleteKey={(row) => setDeleteConfirm(row.id)}
                onDeleteSelected={removeSelected}
                contextMenu={[
                  { label: 'Edit', icon: '✏️', onClick: (row) => openEdit(row) },
                  { label: 'Edit Customer Contact', icon: '📇', onClick: (row) => openContactEdit(row) },
                  { label: (row) => row.isFieldVisit ? 'Remove Field Visit' : 'Mark as Field Visit', icon: '🚗', onClick: (row) => toggleFieldVisit(row) },
                  'divider',
                  { label: 'Notify via WhatsApp', icon: '💬', onClick: (row) => handleWhatsAppClick(row) },
                  ...(moduleFlags.smsGatewayEnabled
                    ? [{ label: 'Notify via SMS', icon: '📱', onClick: (row) => handleSmsClick(row) }]
                    : []),
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
                  <div onClick={() => openEdit(followupTask)} title="Open Edit Task"
                    style={{ fontSize: 15, fontWeight: 700, color: '#111827', display: 'flex', alignItems: 'center',
                      gap: 6, cursor: 'pointer' }}
                    onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
                    onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}>
                    📄 {followupTask.title}
                  </div>
                  <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                    <select value={followupTask.status} onChange={e => updateFollowupTaskStatus(e.target.value)}
                      style={{ height: 26, border: '1px solid #d1d5db', borderRadius: 6, padding: '0 8px',
                        fontSize: 11, fontWeight: 700, background: '#fff', color: '#374151', cursor: 'pointer' }}>
                      {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                    <ReactionBar reactions={followupTask.reactions} currentUserId={currentUser?.id}
                      onReact={async emoji => {
                        const r = await reactToTask(followupTask.id, emoji);
                        if (r) setFollowupTask(prev => prev ? { ...prev, reactions: r } : prev);
                      }} />
                    <div style={{ marginLeft: 'auto' }}>
                      <SeenByAvatars seenBy={followupTask.seenBy} fd={fd} />
                    </div>
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
              {/* On the dedicated Field Visit page, Followup History/Description
                  (a call-log/notes concept for regular Task work) don't apply —
                  the panel's one job here is the live journey status/actions for
                  this specific task (FieldVisitJourneyPanel, below) plus its
                  visit log. The regular Task page keeps these two cards
                  unchanged, even for a field-visit-flagged task. */}
              {!fieldVisitOnly && (
                <>
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
                      <div style={{ flex: 1, minWidth: 0, padding: '10px 12px' }}>
                        <div onClick={() => selectedFollowup && setDescriptionModalOpen(true)}
                          style={{ cursor: selectedFollowup ? 'pointer' : 'default' }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: '#b45309', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 4 }}>
                            Description
                          </div>
                          <div style={{ fontSize: 12, color: '#374151', maxHeight: 110, overflow: 'hidden' }}>
                            {selectedFollowup?.description || <span style={{ color: '#d1d5db' }}>—</span>}
                          </div>
                        </div>
                        <FollowedByLine f={selectedFollowup} />
                        {selectedFollowup && (
                          <>
                            <ReactionBar reactions={selectedFollowup.reactions} currentUserId={currentUser?.id}
                              onReact={emoji => reactToFollowup(selectedFollowup.id, emoji)} />
                            <div style={{ marginTop: 6 }}>
                              <SeenByAvatars seenBy={selectedFollowup.seenBy} fd={fd} />
                            </div>
                          </>
                        )}
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
                </>
              )}

              {/* Journey Status — the dedicated Field Visit page's replacement for
                  Followup History/Description: live Office Out/Check In/Check
                  Out/Next Field Visit/Move to Office controls for THIS task. */}
              {fieldVisitOnly && followupTask.isFieldVisit && (
                <FieldVisitJourneyPanel task={followupTask} tasks={tasks} currentUser={currentUser} showToast={showToast} />
              )}

              {/* Field Visit Log — this task's own GPS check-in/check-out
                  history (see FieldVisitJourneyPanel.jsx), shown on both
                  pages whenever the task is field-visit-flagged. */}
              {followupTask.isFieldVisit && (
                <div style={{ flexShrink: 0, border: '1px solid #bbf7d0', borderRadius: 10, overflow: 'hidden' }}>
                  <div style={{ background: '#f0fdf4', padding: '9px 14px', display: 'flex', alignItems: 'center', gap: 7, borderBottom: '1px solid #bbf7d0' }}>
                    <span style={{ fontSize: 12 }}>🚗</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#166534', letterSpacing: '.4px' }}>FIELD VISIT LOG</span>
                  </div>
                  <div style={{ padding: '10px 12px', background: '#fff', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {fieldVisitStopsLoading ? (
                      <div style={{ color: '#9ca3af', fontSize: 12 }}>Loading…</div>
                    ) : !fieldVisitStops.length ? (
                      <div style={{ color: '#d1d5db', fontSize: 12 }}>No visits logged yet</div>
                    ) : fieldVisitStops.map((s, idx) => (
                      <React.Fragment key={s.id}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderBottom: '1px solid #f1f5f9', paddingBottom: 10 }}>
                          <div style={{ fontWeight: 700, color: '#1e293b', fontSize: 12 }}>{s.employeeName}</div>

                          {/* One movement, three columns in the same line:
                              Check Out (where this leg started) | Check In (arrival at the
                              client) | Check Out (departure from the client). Only the trip's
                              first stop actually departed from the office — a chained "Head
                              Here Next" stop departed from the previous client instead, so its
                              own departure timestamp/location isn't tracked per-stop, only the
                              resulting travel distance/estimate. */}
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                            <div style={{ background: '#eff6ff', border: '1px solid #dbeafe', borderRadius: 7, padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                              <div style={{ fontSize: 9.5, fontWeight: 700, color: '#1d4ed8', textTransform: 'uppercase', letterSpacing: '.2px' }}>
                                Check Out — {s.isFirstStopOfSession ? 'From Office' : 'From Last Office'}
                              </div>
                              {s.isFirstStopOfSession ? (
                                <>
                                  <div style={{ fontSize: 11.5, color: '#374151' }}>{formatNepalTime(s.sessionOfficeOutAt)}</div>
                                  <LocationPin lat={settings.officeLatitude} lng={settings.officeLongitude} label={settings.officeLocationName} />
                                </>
                              ) : <div style={{ fontSize: 11.5, color: '#d1d5db' }}>—</div>}
                              {s.travelKm != null && <div style={{ fontSize: 11, color: '#6b7280' }}>Distance Avg: {s.travelKm.toFixed(1)} km</div>}
                              {s.estimatedMinutes != null && <div style={{ fontSize: 11, color: '#6b7280' }}>Time est. Bike: {s.estimatedMinutes}m</div>}
                            </div>

                            <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 7, padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                              <div style={{ fontSize: 9.5, fontWeight: 700, color: '#c2410c', textTransform: 'uppercase', letterSpacing: '.2px' }}>
                                Check In{s.checkInClientName ? ` — ${s.checkInClientName}` : ''}
                              </div>
                              <div style={{ fontSize: 11.5, color: '#374151' }}>{s.checkInAt ? formatNepalTime(s.checkInAt) : <span style={{ color: '#d1d5db' }}>—</span>}</div>
                              <LocationPin lat={s.checkInLat} lng={s.checkInLng} label={s.checkInLocationName} />
                              {s.checkInAt && (
                                <VerifyBadge verified={isLocationVerified(s.checkInLat, s.checkInLng, s.customerLat, s.customerLng)} />
                              )}
                              {s.travelKm != null && <div style={{ fontSize: 11, color: '#6b7280' }}>Distance: {s.travelKm.toFixed(1)} km</div>}
                              {s.travelMinutes != null && <div style={{ fontSize: 11, color: '#6b7280' }}>Time Take: {s.travelMinutes}m</div>}
                              <div style={{ fontSize: 11, color: '#6b7280' }}>In Remarks: {s.checkInRemarks || '—'}</div>
                            </div>

                            <div style={{ background: '#faf5ff', border: '1px solid #e9d5ff', borderRadius: 7, padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                              <div style={{ fontSize: 9.5, fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '.2px' }}>
                                Check Out{s.checkInClientName ? ` — ${s.checkInClientName}` : ''}
                              </div>
                              <div style={{ fontSize: 11.5, color: '#374151' }}>{s.checkOutAt ? formatNepalTime(s.checkOutAt) : <span style={{ color: '#d1d5db' }}>—</span>}</div>
                              <LocationPin lat={s.checkOutLat} lng={s.checkOutLng} label={s.checkInLocationName} />
                              {s.checkOutAt && (
                                <VerifyBadge verified={isLocationVerified(s.checkOutLat, s.checkOutLng, s.customerLat, s.customerLng)} />
                              )}
                              {s.checkInAt && s.checkOutAt && <div style={{ fontSize: 11, color: '#6b7280' }}>Stayed Duration: {fmtDuration(s.checkInAt, s.checkOutAt)}</div>}
                              <div style={{ fontSize: 11, color: '#6b7280' }}>
                                Status: {s.checkOutWorkProgress ? (CHECKOUT_STATUS_LABEL[s.checkOutWorkProgress] || s.checkOutWorkProgress) : '—'}
                              </div>
                              <div style={{ fontSize: 11, color: '#6b7280' }}>Out Remarks: {s.checkOutRemarks || '—'}</div>
                            </div>
                          </div>

                          {/* Back to Office — shown once, on whichever stop was the last
                              of a trip that's actually been closed out. */}
                          {s.isLastStopOfSession && s.sessionOfficeInAt && (
                            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 7, padding: '6px 10px' }}>
                              <div style={{ fontSize: 10, fontWeight: 700, color: '#166534', textTransform: 'uppercase', letterSpacing: '.3px' }}>
                                Check In — Back to Office
                              </div>
                              <div style={{ fontSize: 12, color: '#374151', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                <span>{formatNepalTime(s.sessionOfficeInAt)}</span>
                                <LocationPin lat={s.sessionOfficeInLat} lng={s.sessionOfficeInLng} label={settings.officeLocationName} />
                              </div>
                              {s.sessionReturnTravelKm != null && (
                                <div style={{ fontSize: 11.5, color: '#6b7280', marginTop: 2 }}>
                                  Time Taken: {s.sessionReturnTravelMinutes}m · Distance: {s.sessionReturnTravelKm.toFixed(1)} km · Est. by Bike: {s.sessionReturnEstimatedMinutes}m
                                </div>
                              )}
                            </div>
                          )}

                          {/* Summary — a plain-language recap of this one stop, and where
                              the trip went afterward. "Next" is found by id, not array
                              position — fieldVisitStops is newest-first, so a chained
                              "Head Here Next" stop within the same session actually sits
                              right before this one in the array, not after. */}
                          {(() => {
                            const stopLabel = s.checkInClientName || s.customerName || s.taskTitle || 'this client';
                            const nextStop = fieldVisitStops
                              .filter(s2 => s2.sessionId === s.sessionId && s2.id > s.id)
                              .sort((a, b) => a.id - b.id)[0];
                            const nextLabel = nextStop
                              ? `➡️ Next: ${nextStop.checkInClientName || nextStop.customerName || nextStop.taskTitle || 'next client'}`
                              : s.isLastStopOfSession && s.sessionOfficeInAt ? `🏢 Moved to ${settings.officeLocationName || 'Office'}`
                              : '⏳ Still in progress';
                            const statusRemarks = s.checkOutWorkProgress || s.checkOutRemarks
                              ? `${s.checkOutWorkProgress ? (CHECKOUT_STATUS_LABEL[s.checkOutWorkProgress] || s.checkOutWorkProgress) : 'Pending'}${s.checkOutRemarks ? ` — ${s.checkOutRemarks}` : ''}`
                              : null;
                            return (
                              <div style={{ background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 7, padding: '7px 10px',
                                display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11.5, color: '#374151' }}>
                                <div style={{ fontSize: 9.5, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.2px' }}>Summary</div>
                                {s.travelMinutes != null && <div>Took {s.travelMinutes}m to reach {stopLabel}</div>}
                                {s.checkInAt && s.checkOutAt && <div>Stayed {fmtHHMM(s.checkInAt, s.checkOutAt)} at {stopLabel}</div>}
                                {statusRemarks && <div>{statusRemarks}</div>}
                                <div style={{ fontWeight: 600 }}>{nextLabel}</div>
                              </div>
                            );
                          })()}
                        </div>
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              )}
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
                <FollowedByLine f={selectedFollowup} />
                {selectedFollowup && (
                  <ReactionBar reactions={selectedFollowup.reactions} currentUserId={currentUser?.id}
                    onReact={emoji => reactToFollowup(selectedFollowup.id, emoji)} />
                )}
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
                  showAvatar
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

              {editId && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap',
                  gap: 10, padding: '8px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8 }}>
                  <ReactionBar reactions={taskModalMeta.reactions} currentUserId={currentUser?.id}
                    onReact={async emoji => {
                      const r = await reactToTask(editId, emoji);
                      if (r) setTaskModalMeta(p => ({ ...p, reactions: r }));
                    }} />
                  <SeenByAvatars seenBy={taskModalMeta.seenBy} fd={fd} />
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
                <EmpMultiSelect
                  value={form.assignedTo}
                  onChange={v => setForm(p => ({ ...p, assignedTo: v }))}
                  employees={employees}
                  placeholder="Search by name, post, department, branch..."
                  formatLabel={e => `${e.fullName} — ${abbrev(e.position)} · ${abbrev(e.department)} · ${abbrev(e.branch)}`}
                  showNamesWhenMultiple
                  showAvatars
                />
              )}

              {field('Field Visit', false, null,
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.isFieldVisit}
                    onChange={e => setForm(p => ({ ...p, isFieldVisit: e.target.checked }))}
                    style={{ width: 16, height: 16, accentColor: '#1a56db', cursor: 'pointer' }} />
                  <span style={{ fontSize: 12.5, color: '#374151' }}>🚗 This is a Field Visit task</span>
                </label>
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
                        if (m.value === 'whatsapp') openWhatsAppChat(followupTask.customerMobile || followupTask.customerMobile2 || followupTask.customerPhone);
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
                  <DateTimeInput value={followupForm.nextFollowupAt}
                    onChange={v => setFollowupForm(p => ({ ...p, nextFollowupAt: v }))} />
                )}
                {field('Hand Over', false, null,
                  <SearchableSelect
                    value={followupForm.handedOverTo}
                    onChange={v => setFollowupForm(p => ({ ...p, handedOverTo: v }))}
                    options={staffOptions}
                    placeholder="— None —"
                    showAvatar
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

      {/* Task grid right-click > Edit Customer Contact */}
      {editContactModal && (
        <ContactFormModal
          initial={editContactModal}
          onClose={() => setEditContactModal(null)}
          onSaved={() => { loadContacts(); setEditContactModal(null); showToast('Contact updated'); }}
        />
      )}

      {/* WhatsApp assignee picker — shown when a task has 2+ assignees */}
      {whatsappPicker && (
        <div className="modal-overlay" onClick={() => setWhatsappPicker(null)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>💬 Notify via WhatsApp</h2>
              <button className="modal-close" onClick={() => setWhatsappPicker(null)}>✕</button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <p style={{ fontSize: 12.5, color: '#6b7280', margin: '0 0 4px' }}>Who should get this on WhatsApp?</p>
              {whatsappPicker.assignees.map(a => (
                <button key={a.id}
                  onClick={() => { notifyAssigneeWhatsApp(whatsappPicker.task, a); setWhatsappPicker(null); }}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px',
                    border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', cursor: 'pointer', fontSize: 13 }}>
                  <span>{a.name}{a.post ? ` | ${a.post}` : ''}</span>
                  <span>💬</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* SMS assignee picker — shown when a task has 2+ assignees */}
      {smsPicker && (
        <div className="modal-overlay" onClick={() => setSmsPicker(null)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>📱 Notify via SMS</h2>
              <button className="modal-close" onClick={() => setSmsPicker(null)}>✕</button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <p style={{ fontSize: 12.5, color: '#6b7280', margin: '0 0 4px' }}>Who should get this by SMS?</p>
              {smsPicker.assignees.map(a => (
                <button key={a.id}
                  onClick={() => { notifyAssigneeSms(smsPicker.task, a); setSmsPicker(null); }}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px',
                    border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', cursor: 'pointer', fontSize: 13 }}>
                  <span>{a.name}{a.post ? ` | ${a.post}` : ''}</span>
                  <span>📱</span>
                </button>
              ))}
            </div>
          </div>
        </div>
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
          fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 10,
          background: toast.type === 'error' ? '#fef2f2' : '#f0fdf4',
          color:      toast.type === 'error' ? '#dc2626'  : '#065f46',
          border:     `1px solid ${toast.type === 'error' ? '#fecaca' : '#bbf7d0'}`,
          boxShadow: '0 4px 16px rgba(0,0,0,.12)' }}>
          <span>{toast.type === 'error' ? '❌' : '✅'} {toast.msg}</span>
          {toast.action && (
            <button onClick={() => { toast.action.onClick(); setToast(null); }}
              style={{ background: '#fff', border: '1px solid currentColor', borderRadius: 6, padding: '4px 10px',
                fontSize: 12, fontWeight: 700, cursor: 'pointer', color: 'inherit', whiteSpace: 'nowrap' }}>
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default TaskList;
