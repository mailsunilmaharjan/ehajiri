import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useData } from '../context/DataContext.jsx';
import useDateFormat from '../hooks/useDateFormat.js';
import Avatar from '../components/Common/Avatar.jsx';
import { getNepalTodayISO, formatNepalTime } from '../utils/dateUtils.js';
import Journey from './MobileJourney.jsx';
import TripBar from './MobileTripBar.jsx';
import { useNotifications } from '../components/Notifications/AttendanceToasts.jsx';
import { Empty, Icon, Sheet, Spinner, useMT } from './kit.jsx';
import { DateField } from './fields.jsx';

/* Tasks and Field Visits on the phone: a card list (unseen ones blink), a detail sheet with remarks, a New/Edit form and an
   "Add remark" form. Uses the same server routes as the website's Task page, so rules and notifications are identical. */

const STATUS = {
  pending:     { label: 'Pending',     bg: '#fef3c7', fg: '#92400e' },
  in_progress: { label: 'In Progress', bg: '#dbeafe', fg: '#1e40af' },
  completed:   { label: 'Completed',   bg: '#dcfce7', fg: '#166534' },
  cancelled:   { label: 'Cancelled',   bg: '#f3f4f6', fg: '#4b5563' },
};
const MODES = [['phone', '📞', 'Phone'], ['whatsapp', '💬', 'WhatsApp'], ['sms', '✉️', 'SMS'], ['email', '📧', 'Email']];
const dOnly = (v) => (v ? String(v).slice(0, 10) : '');
const htmlText = (h = '') => String(h).replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

function StatusPill({ s }) {
  const mt = useMT(); const m = STATUS[s] || STATUS.pending;
  return <span className="m-pill" style={{ background: m.bg, color: m.fg }}>{mt(m.label)}</span>;
}

/** Searchable pick list in a bottom sheet (single or multiple). */
function ListPick({ title, items, selected, multi, onDone, onClose }) {
  const mt = useMT();
  const [q, setQ] = useState(''); const [sel, setSel] = useState(new Set((selected || []).map(String)));
  const shown = q.trim() ? items.filter(i => `${i.label} ${i.sub || ''}`.toLowerCase().includes(q.trim().toLowerCase())) : items;
  const toggle = (v) => { if (!multi) { onDone([v]); return; } setSel(s => { const n = new Set(s); n.has(v) ? n.delete(v) : n.add(v); return n; }); };
  return createPortal(
    <div className="m-pick-back" onClick={onClose}>
      <div className="m-pick" style={{ maxHeight: '88dvh' }} onClick={e => e.stopPropagation()}>
        <div className="m-sheet-grab" />
        <div className="m-pick-head m-row"><span className="m-grow">{title}</span>
          <button type="button" className="m-icon-btn" style={{ background: '#f3f4f6', color: '#374151' }} onClick={onClose}><Icon name="x" size={20} /></button></div>
        <input className="m-input m-pick-search" placeholder={mt('Search')} value={q} onChange={e => setQ(e.target.value)} />
        <div className="m-pick-list">
          {shown.slice(0, 300).map(i => {
            const on = sel.has(String(i.value)) || (!multi && String(selected?.[0]) === String(i.value));
            return (
              <button type="button" key={i.value} className={`m-pick-item${on ? ' on' : ''}`} onClick={() => toggle(String(i.value))}>
                {i.photo !== undefined && <Avatar photo={i.photo} name={i.label} size={32} preview={false} />}
                <span className="m-grow">{i.label}{i.sub && <small style={{ display: 'block', color: 'var(--m-sub)', fontWeight: 500 }}>{i.sub}</small>}</span>
                {on && <Icon name="check" size={20} />}
              </button>
            );
          })}
          {shown.length === 0 && <div className="m-muted" style={{ padding: 16, textAlign: 'center' }}>{mt('Nothing here yet')}</div>}
        </div>
        {multi && <div className="m-cal-foot" style={{ padding: '8px 16px' }}><button type="button" className="m-btn m-block" onClick={() => onDone([...sel])}>{mt('Done')} ({sel.size})</button></div>}
      </div>
    </div>, document.body);
}

/* ───────────── New / Edit task ───────────── */
function TaskForm({ task, fieldVisit, onClose, onSaved }) {
  const mt = useMT();
  const { currentUser } = useAuth();
  const { filteredEmployees, employees } = useData();
  const staff = (filteredEmployees && filteredEmployees.length ? filteredEmployees : employees) || [];
  const [cats, setCats] = useState([]); const [pris, setPris] = useState([]); const [contacts, setContacts] = useState([]); const [persons, setPersons] = useState([]);
  const [f, setF] = useState(() => ({
    title: task?.title || '', description: htmlText(task?.description || ''), contactId: task?.contactId ? String(task.contactId) : '', contactPersonId: task?.contactPersonId ? String(task.contactPersonId) : '',
    categoryId: task?.categoryId ? String(task.categoryId) : '', priorityId: task?.priorityId ? String(task.priorityId) : '', dueDate: dOnly(task?.dueDate),
    assignedTo: task ? (task.assignees || []).map(a => String(a.id)) : [String(currentUser.id)], status: task?.status || 'pending', isFieldVisit: task ? !!task.isFieldVisit : !!fieldVisit,
  }));
  const [pick, setPick] = useState(null); const [err, setErr] = useState({}); const [busy, setBusy] = useState(false); const [top, setTop] = useState('');
  const set = (k, v) => { setF(p => ({ ...p, [k]: v })); setErr(e => ({ ...e, [k]: '' })); };

  useEffect(() => {
    api.get('/settings/taskCategories').then(r => setCats(Array.isArray(r) ? r : [])).catch(() => {});
    api.get('/settings/taskPriorities').then(r => setPris(Array.isArray(r) ? r : [])).catch(() => {});
    api.get('/contacts').then(r => setContacts(Array.isArray(r) ? r : [])).catch(() => {});
  }, []);
  useEffect(() => { if (f.contactId) api.get(`/contacts/${f.contactId}/persons`).then(r => setPersons(Array.isArray(r) ? r : [])).catch(() => setPersons([])); else setPersons([]); }, [f.contactId]);

  const label = (c) => (c.contactInfo === 'company' ? c.companyName : c.personName) || `#${c.id}`;
  const contact = contacts.find(c => String(c.id) === f.contactId);
  const person = persons.find(p => String(p.id) === f.contactPersonId);
  const nameOfStaff = (id) => staff.find(e => String(e.id) === String(id))?.fullName || (task?.assignees || []).find(a => String(a.id) === String(id))?.name || `#${id}`;

  const save = async () => {
    if (!f.title.trim()) { setErr({ title: mt('Task title is required') }); return; }
    setBusy(true); setTop('');
    const payload = { title: f.title.trim(), description: f.description || null, contactId: f.contactId ? Number(f.contactId) : null, contactPersonId: f.contactPersonId ? Number(f.contactPersonId) : null,
      categoryId: f.categoryId ? Number(f.categoryId) : null, priorityId: f.priorityId ? Number(f.priorityId) : null, dueDate: f.dueDate || null,
      assignedTo: f.assignedTo.map(Number), status: f.status, isFieldVisit: !!f.isFieldVisit };
    try { const saved = task ? await api.put(`/tasks/${task.id}`, payload) : await api.post('/tasks', payload); onSaved(saved); }
    catch (x) { setTop(x?.message || mt('Could not save')); } finally { setBusy(false); }
  };

  return (<>
    <Sheet title={task ? mt('Edit Task') : (f.isFieldVisit ? mt('New Field Visit') : mt('New Task'))} onClose={onClose}
      footer={<><button className="m-btn m-ghost" onClick={onClose}>{mt('Cancel')}</button><button className="m-btn" disabled={busy} onClick={save}>{busy ? '…' : mt('Save')}</button></>}>
      {top && <div className="m-err">{top}</div>}
      <div className="m-field"><label>{mt('Task Title')} *</label><input className={`m-input${err.title ? ' err' : ''}`} value={f.title} onChange={e => set('title', e.target.value)} placeholder={mt('What needs to be done?')} />{err.title && <div className="m-ferr">{err.title}</div>}</div>
      <label className="m-check"><input type="checkbox" checked={f.isFieldVisit} onChange={e => set('isFieldVisit', e.target.checked)} /><span>{mt('Field Visit')}</span></label>
      <div className="m-field"><label>{mt('Customer')}</label>
        <button type="button" className="m-input m-datebtn" onClick={() => setPick('contact')}><span style={{ color: contact ? undefined : '#9ca3af' }}>{contact ? label(contact) : `— ${mt('Select')} —`}</span><Icon name="chev" size={18} /></button></div>
      {f.contactId && persons.length > 0 && <div className="m-field"><label>{mt('Contact Person')}</label>
        <button type="button" className="m-input m-datebtn" onClick={() => setPick('person')}><span style={{ color: person ? undefined : '#9ca3af' }}>{person ? person.name : `— ${mt('Select')} —`}</span><Icon name="chev" size={18} /></button></div>}
      <div className="m-two">
        <div className="m-field"><label>{mt('Category')}</label><select className="m-input" value={f.categoryId} onChange={e => set('categoryId', e.target.value)}><option value="">—</option>{cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="m-field"><label>{mt('Priority')}</label><select className="m-input" value={f.priorityId} onChange={e => set('priorityId', e.target.value)}><option value="">—</option>{pris.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      </div>
      <DateField label={mt('Due Date')} value={f.dueDate} onChange={v => set('dueDate', v)} />
      <div className="m-field"><label>{mt('Assign To')}</label>
        <div className="m-chips">{f.assignedTo.map(id => <span key={id} className="m-chip2">{nameOfStaff(id)}<button type="button" onClick={() => set('assignedTo', f.assignedTo.filter(x => x !== id))}>×</button></span>)}
          <button type="button" className="m-chip2 add" onClick={() => setPick('staff')}>＋ {mt('Add')}</button></div></div>
      {task && <div className="m-field"><label>{mt('Status')}</label><select className="m-input" value={f.status} onChange={e => set('status', e.target.value)}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{mt(v.label)}</option>)}</select></div>}
      <div className="m-field"><label>{mt('Description')}</label><textarea className="m-input" rows={4} value={f.description} onChange={e => set('description', e.target.value)} /></div>
    </Sheet>
    {pick === 'contact' && <ListPick title={mt('Customer')} items={[{ value: '', label: `— ${mt('None')} —` }, ...contacts.map(c => ({ value: String(c.id), label: label(c), sub: [c.mobile1, c.district].filter(Boolean).join(' · ') }))]}
      selected={[f.contactId]} onClose={() => setPick(null)} onDone={([v]) => { setF(p => ({ ...p, contactId: v || '', contactPersonId: '' })); setPick(null); }} />}
    {pick === 'person' && <ListPick title={mt('Contact Person')} items={[{ value: '', label: `— ${mt('None')} —` }, ...persons.map(p => ({ value: String(p.id), label: p.name, sub: p.mobile1 }))]}
      selected={[f.contactPersonId]} onClose={() => setPick(null)} onDone={([v]) => { set('contactPersonId', v || ''); setPick(null); }} />}
    {pick === 'staff' && <ListPick title={mt('Assign To')} multi items={staff.map(e => ({ value: String(e.id), label: e.fullName, sub: [e.position, e.department].filter(Boolean).join(' · '), photo: e.profilePhoto }))}
      selected={f.assignedTo} onClose={() => setPick(null)} onDone={(ids) => { set('assignedTo', ids); setPick(null); }} />}
  </>);
}

/* ───────────── Add / edit a remark (follow-up) ───────────── */
function RemarkForm({ task, remark, onClose, onSaved }) {
  const mt = useMT();
  const { filteredEmployees, employees } = useData();
  const staff = (filteredEmployees && filteredEmployees.length ? filteredEmployees : employees) || [];
  const [f, setF] = useState({ mode: remark?.mode || 'phone', description: htmlText(remark?.description || ''), date: dOnly(remark?.followupDate) || getNepalTodayISO(), handedOverTo: remark?.handedOverToId ? String(remark.handedOverToId) : '' });
  const [pick, setPick] = useState(false); const [busy, setBusy] = useState(false); const [top, setTop] = useState(''); const [err, setErr] = useState('');
  const save = async () => {
    if (!f.description.trim()) { setErr(mt('Write the remark')); return; }
    setBusy(true); setTop('');
    const payload = { mode: f.mode, followupDate: f.date || null, description: f.description.trim(), handedOverTo: f.handedOverTo ? Number(f.handedOverTo) : null, nextCategoryId: null, nextFollowupAt: null };
    try { remark ? await api.put(`/tasks/${task.id}/followups/${remark.id}`, payload) : await api.post(`/tasks/${task.id}/followups`, payload); onSaved(); }
    catch (x) { setTop(x?.message || mt('Could not save')); } finally { setBusy(false); }
  };
  return (<>
    <Sheet title={remark ? mt('Edit remark') : mt('Add remark')} onClose={onClose}
      footer={<><button className="m-btn m-ghost" onClick={onClose}>{mt('Cancel')}</button><button className="m-btn" disabled={busy} onClick={save}>{busy ? '…' : mt('Save')}</button></>}>
      {top && <div className="m-err">{top}</div>}
      <div className="m-field"><label>{mt('How did you follow up?')}</label>
        <div className="m-modes">{MODES.map(([k, ic, l]) => <button type="button" key={k} className={f.mode === k ? 'on' : ''} onClick={() => setF(p => ({ ...p, mode: k }))}><span>{ic}</span>{mt(l)}</button>)}</div></div>
      <DateField label={mt('Date')} value={f.date} onChange={v => setF(p => ({ ...p, date: v }))} />
      <div className="m-field"><label>{mt('Remark')} *</label><textarea className={`m-input${err ? ' err' : ''}`} rows={5} value={f.description} onChange={e => { setF(p => ({ ...p, description: e.target.value })); setErr(''); }} placeholder={mt('What happened?')} />{err && <div className="m-ferr">{err}</div>}</div>
      <div className="m-field"><label>{mt('Hand over to')}</label>
        <button type="button" className="m-input m-datebtn" onClick={() => setPick(true)}><span style={{ color: f.handedOverTo ? undefined : '#9ca3af' }}>{f.handedOverTo ? (staff.find(e => String(e.id) === f.handedOverTo)?.fullName || `#${f.handedOverTo}`) : `— ${mt('Nobody')} —`}</span><Icon name="chev" size={18} /></button></div>
    </Sheet>
    {pick && <ListPick title={mt('Hand over to')} items={[{ value: '', label: `— ${mt('Nobody')} —` }, ...staff.map(e => ({ value: String(e.id), label: e.fullName, sub: [e.position, e.department].filter(Boolean).join(' · '), photo: e.profilePhoto }))]}
      selected={[f.handedOverTo]} onClose={() => setPick(false)} onDone={([v]) => { setF(p => ({ ...p, handedOverTo: v || '' })); setPick(false); }} />}
  </>);
}

/* ───────────── One remark: coloured card, reactions (WhatsApp style) and "Seen by" ───────────── */
const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '🎉', '✅', '👎'];
const TONES = [['#eef4ff', '#3b82f6'], ['#effaf3', '#22a05a'], ['#fff6e8', '#e8870e'], ['#f5efff', '#8b5cf6'], ['#ffeff2', '#e5456b'], ['#ecfafa', '#0d9ba5']];
function RemarkCard({ r, taskId, myId, onEdit }) {
  const mt = useMT(); const fd = useDateFormat();
  const [reacts, setReacts] = useState(r.reactions || []);
  const [seen, setSeen] = useState(r.seenBy || []);
  const [tray, setTray] = useState(false); const [who, setWho] = useState(false);
  const tone = TONES[Math.abs(Number(r.followedById) || 0) % TONES.length];
  const base = `/tasks/${taskId}/followups/${r.id}`;

  // opening the task = seeing its remarks: record it once per remark
  useEffect(() => { if (!(r.seenBy || []).some(v => String(v.userId) === String(myId))) api.put(`${base}/seen`).then(v => Array.isArray(v) && setSeen(v)).catch(() => {}); }, [r.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const react = async (emoji) => { setTray(false); try { setReacts(await api.put(`${base}/reactions`, { emoji })); } catch { /* keep as is */ } };

  const groups = []; reacts.forEach(x => { const g = groups.find(y => y.emoji === x.emoji); g ? g.n++ : groups.push({ emoji: x.emoji, n: 1 }); });
  const mine = reacts.find(x => String(x.userId) === String(myId))?.emoji;
  const when = r.createdAt ? `${fd(dOnly(r.createdAt))} · ${formatNepalTime(r.createdAt)}` : (r.followupDate ? fd(dOnly(r.followupDate)) : '');
  return (
    <div className="m-rmk" style={{ background: tone[0], borderLeftColor: tone[1] }}>
      <div className="m-row" style={{ gap: 9, marginBottom: 6 }}>
        <Avatar photo={r.followedByPhoto} name={r.followedByName || '?'} size={34} preview={false} />
        <div className="m-grow" style={{ minWidth: 0 }}>
          <b className="m-ell" style={{ display: 'block', color: tone[1] }}>{r.followedByName || '—'}</b>
          <span className="m-muted" style={{ fontSize: 11.5 }}>{[r.followedByPost, when].filter(Boolean).join(' · ')}</span>
        </div>
        <span className="m-rmk-mode">{MODES.find(m => m[0] === r.mode)?.[1]}</span>
      </div>
      <div className="m-rmk-text">{htmlText(r.description)}</div>
      {r.handedOverToName && <div className="m-muted" style={{ fontSize: 12, marginTop: 5 }}>➜ {mt('Handed over to')} <b>{r.handedOverToName}</b></div>}
      <div className="m-rmk-foot">
        <div className="m-rmk-reacts">
          {groups.map(g => <button key={g.emoji} type="button" className={g.emoji === mine ? 'mine' : ''} onClick={() => react(g.emoji)}>{g.emoji}{g.n > 1 && <i>{g.n}</i>}</button>)}
          <button type="button" className="add" aria-label={mt('React')} onClick={() => setTray(v => !v)}>☺＋</button>
        </div>
        <button type="button" className="m-rmk-seen" onClick={() => setWho(true)}>👁 {mt('Seen by')} {seen.length}</button>
        {String(r.followedById) === String(myId) && <button type="button" className="m-link" style={{ padding: 0 }} onClick={onEdit}>{mt('Edit')}</button>}
      </div>
      {tray && <div className="m-rmk-tray">{REACTIONS.map(e => <button key={e} type="button" className={e === mine ? 'mine' : ''} onClick={() => react(e)}>{e}</button>)}</div>}
      {who && (
        <Sheet title={mt('Seen by')} onClose={() => setWho(false)}>
          {seen.length === 0 && <div className="m-muted">{mt('Nobody yet')}</div>}
          {seen.map(v => (
            <div key={v.userId} className="m-row m-whorow">
              <Avatar photo={v.userPhoto} name={v.userName || '?'} size={34} preview={false} />
              <b className="m-grow m-ell">{v.userName}</b>
              <span className="m-muted" style={{ fontSize: 12 }}>{v.seenAt ? `${fd(dOnly(v.seenAt))} · ${formatNepalTime(v.seenAt)}` : ''}</span>
              {reacts.find(x => String(x.userId) === String(v.userId)) && <span style={{ fontSize: 18 }}>{reacts.find(x => String(x.userId) === String(v.userId)).emoji}</span>}
            </div>
          ))}
          {reacts.filter(x => !seen.some(v => String(v.userId) === String(x.userId))).map(x => (
            <div key={'r' + x.userId} className="m-row m-whorow"><Avatar photo={x.userPhoto} name={x.userName || '?'} size={34} preview={false} /><b className="m-grow m-ell">{x.userName}</b><span style={{ fontSize: 18 }}>{x.emoji}</span></div>
          ))}
        </Sheet>
      )}
    </div>
  );
}

/* contact number → wa.me form (Nepal numbers get 977 when typed without a country code) */
const waNumber = (v = '') => { let d = String(v).replace(/[^\d]/g, ''); if (d.startsWith('00')) d = d.slice(2); else if (d.startsWith('0')) d = d.slice(1); if (d.length === 10 && d.startsWith('9')) d = '977' + d; return d; };

/* ───────────── Task detail ───────────── */
function TaskDetail({ task, tasks, onClose, onChanged, onEdit, onOpenTask, onAddVisit }) {
  const mt = useMT(); const fd = useDateFormat();
  const { currentUser } = useAuth();
  const noti = useNotifications();
  const [rems, setRems] = useState(null); const [form, setForm] = useState(null); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('');
  const loadRems = useCallback(() => api.get(`/tasks/${task.id}/followups`).then(r => setRems(Array.isArray(r) ? r : [])).catch(() => setRems([])), [task.id]);
  useEffect(() => {
    loadRems();
    if (task.hasUnreadNotification) { noti?.clearTaskAlert?.(task.id); api.post(`/tasks/${task.id}/notifications/read`).then(() => { noti?.refreshTaskCounts?.(); onChanged?.(); }).catch(() => {}); }
    api.put(`/tasks/${task.id}/seen`).catch(() => {});
  }, [task.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const setStatus = async (status) => {
    setBusy(true); setMsg('');
    try { await api.patch(`/tasks/${task.id}/status`, { status }); onChanged(status === 'in_progress' ? undefined : true); } catch (x) { setMsg(x?.message || mt('Failed')); } finally { setBusy(false); }
  };
  const od = task.dueDate && dOnly(task.dueDate) < getNepalTodayISO() && task.status !== 'completed';
  const tel = task.customerMobile || task.customerPhone;
  const info = [[mt('Customer'), task.customerName], [mt('Contact Person'), task.personName], [mt('Address'), task.customerAddress], [mt('Category'), task.categoryName], [mt('Priority'), task.priorityName],
    [mt('Due Date'), task.dueDate && fd(dOnly(task.dueDate))], [mt('Created by'), task.createdByName]].filter(r => r[1]);

  return (<>
    <Sheet title={task.isFieldVisit ? mt('Field Visit') : mt('Task')} onClose={onClose}>
      <h3 style={{ margin: '0 0 8px', fontSize: 19 }}>{task.title}</h3>
      <div className="m-row" style={{ gap: 8, marginBottom: 10, flexWrap: 'wrap' }}><StatusPill s={task.status} />{od && <span className="m-pill bad">{mt('Overdue')}</span>}
        {task.priorityName && <span className="m-pill" style={{ background: (task.priorityColor || '#6b7280') + '22', color: task.priorityColor || '#374151' }}>{task.priorityName}</span>}</div>
      {htmlText(task.description) && <p style={{ margin: '0 0 12px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{htmlText(task.description)}</p>}
      <div className="m-card m-flat" style={{ padding: '2px 14px', marginBottom: 12 }}>{info.map(([k, v]) => <div key={k} className="m-kv"><span>{k}</span><b style={{ textAlign: 'right', wordBreak: 'break-word' }}>{v}</b></div>)}
        {(task.assignees || []).length > 0 && <div className="m-kv" style={{ alignItems: 'flex-start' }}><span>{mt('Assigned')}</span><b style={{ textAlign: 'right' }}>{task.assignees.map(a => a.name).join(', ')}</b></div>}</div>
      {tel && <a className="m-btn m-block m-ghost" style={{ marginBottom: 8, textDecoration: 'none', textAlign: 'center' }} href={`tel:${tel}`}>📞 {tel}</a>}
      {(task.customerMobile || task.customerEmail) && (
        <div className="m-contact3">
          {task.customerMobile && <a className="m-btn m-sm m-ok" href={`https://wa.me/${waNumber(task.customerMobile)}`} target="_blank" rel="noreferrer">💬 WhatsApp</a>}
          {task.customerMobile && <a className="m-btn m-sm" href={`sms:${task.customerMobile}`}>✉️ SMS</a>}
          {task.customerEmail && <a className="m-btn m-sm m-warn" href={`mailto:${task.customerEmail}`}>📧 Email</a>}
        </div>
      )}

      {msg && <div className="m-err">{msg}</div>}
      <div className="m-row" style={{ gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {task.status === 'pending' && <button className="m-btn m-sm" style={{ flex: 1 }} disabled={busy} onClick={() => setStatus('in_progress')}>▶ {mt('Start')}</button>}
        {task.status !== 'completed' && task.status !== 'cancelled' && <button className="m-btn m-sm m-ok" style={{ flex: 1 }} disabled={busy} onClick={() => setStatus('completed')}>✔ {mt('Complete')}</button>}
        {(task.status === 'completed' || task.status === 'cancelled') && <button className="m-btn m-sm m-warn" style={{ flex: 1 }} disabled={busy} onClick={() => setStatus('pending')}>↺ {mt('Reopen')}</button>}
        <button className="m-btn m-sm m-ghost" style={{ flex: 1 }} onClick={onEdit}>✎ {mt('Edit')}</button>
      </div>

      <Journey task={task} tasks={tasks} onOpenTask={onOpenTask} onChanged={() => onChanged()} onAddVisit={onAddVisit} />

      <div className="m-row" style={{ margin: '4px 0 8px' }}><b className="m-grow" style={{ fontSize: 16 }}>{mt('Remarks')} {rems ? `(${rems.length})` : ''}</b>
        <button className="m-btn m-sm" onClick={() => setForm({})}>＋ {mt('Add remark')}</button></div>
      {rems === null && <div className="m-empty"><Spinner dark /></div>}
      {rems && rems.length === 0 && <div className="m-muted" style={{ padding: '8px 2px' }}>{mt('No remarks yet')}</div>}
      {(rems || []).map(r => <RemarkCard key={r.id} r={r} taskId={task.id} myId={currentUser.id} onEdit={() => setForm(r)} />)}
    </Sheet>
    {form && <RemarkForm task={task} remark={form.id ? form : null} onClose={() => setForm(null)} onSaved={() => { setForm(null); loadRems(); onChanged(); }} />}
  </>);
}

/* ───────────── The page ───────────── */
export default function MobileTasks({ fieldVisitOnly = false }) {
  const mt = useMT(); const fd = useDateFormat();
  const [seg, setSeg] = useState(fieldVisitOnly ? 'visit' : 'task');
  const [flt, setFlt] = useState('open');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null); const [err, setErr] = useState('');
  const [open, setOpen] = useState(null);        // task id shown in the detail sheet
  const [edit, setEdit] = useState(null);        // null | {} (new) | task
  const load = useCallback(() => api.get('/tasks').then(r => { setRows(Array.isArray(r) ? r : []); setErr(''); }).catch(x => { setErr(x?.message || mt('Could not load')); setRows([]); }), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); const t = setInterval(load, 45000); return () => clearInterval(t); }, [load]);

  const today = getNepalTodayISO();
  const mine = useMemo(() => (rows || []).filter(t => !!t.isFieldVisit === (seg === 'visit')), [rows, seg]);
  const unseen = (v) => (rows || []).filter(t => !!t.isFieldVisit === (v === 'visit') && t.hasUnreadNotification).length;
  const [fvSession, setFvSession] = useState(null);
  const onTrip = (t) => (fvSession?.stops || []).some(x => String(x.taskId) === String(t.id));   // visits already done on today's open trip stay visible
  const list = mine.filter(t => (flt === 'open' ? (!['completed', 'cancelled'].includes(t.status) || (seg === 'visit' && onTrip(t))) : flt === 'done' ? ['completed', 'cancelled'].includes(t.status) : true))
    .filter(t => !q.trim() || `${t.title} ${t.customerName || ''} ${t.personName || ''}`.toLowerCase().includes(q.trim().toLowerCase()));
  const current = rows?.find(t => t.id === open) || null;

  /* My own order (drag the ⠿ handle). Saved per person on the server (PUT /tasks/order). */
  const [dragIds, setDragIds] = useState(null); const [dragging, setDragging] = useState(null);
  const listRef = useRef(null);
  const shown = (() => {
    const base = [...list].sort((a, b) => (a.myOrder == null ? 1e9 : a.myOrder) - (b.myOrder == null ? 1e9 : b.myOrder));
    if (!dragIds) return base;
    const m = new Map(base.map(t => [t.id, t])); return dragIds.map(id => m.get(id)).filter(Boolean);
  })();
  const startDrag = (e, id) => {
    e.preventDefault(); e.stopPropagation();
    const sc = e.currentTarget.closest('.m-content');
    let cur = shown.map(t => t.id); setDragIds(cur); setDragging(id);
    const move = (ev) => {
      const y = ev.clientY;
      if (sc) { const r = sc.getBoundingClientRect(); if (y < r.top + 70) sc.scrollTop -= 14; else if (y > r.bottom - 70) sc.scrollTop += 14; }
      const els = [...(listRef.current?.querySelectorAll('[data-tid]') || [])];
      let before = null;
      for (const el of els) { const r = el.getBoundingClientRect(); if (y < r.top + r.height / 2) { before = el.dataset.tid; break; } }
      if (before === String(id)) return;
      const without = cur.filter(x => String(x) !== String(id));
      const at = before == null ? without.length : without.findIndex(x => String(x) === before);
      const next = [...without.slice(0, at), id, ...without.slice(at)];
      if (next.join() !== cur.join()) { cur = next; setDragIds(next); }
    };
    const end = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end);
      const ids = cur; setDragIds(null); setDragging(null);
      setRows(rs => (rs || []).map(t => { const p = ids.indexOf(t.id); return p >= 0 ? { ...t, myOrder: p } : t; }));
      api.put('/tasks/order', { ids }).catch(() => load());
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
  };
  const markOf = (t) => {
    const v = (fvSession?.stops || []).find(x => String(x.taskId) === String(t.id));
    if (!v) return null;
    if (v.checkOutAt) return '✅ ' + mt('Checked out') + ' · ' + mt(({ work_done: 'Complete', pending_next_day: 'Pending', cancelled: 'Cancelled' })[v.checkOutWorkProgress] || '');
    return v.checkInAt ? '📍 ' + mt('Checked in') : '➡️ ' + mt('Moving here');
  };

  const listJsx = <div ref={listRef}>{shown.map(t => {
        const od = t.dueDate && dOnly(t.dueDate) < today && !['completed', 'cancelled'].includes(t.status);
        return (
          <button key={t.id} data-tid={t.id} className={`m-task${t.hasUnreadNotification ? ' m-blink' : ''}${dragging === t.id ? ' m-dragging' : ''}`} onClick={() => setOpen(t.id)}>
            <span className="m-task-bar" style={{ background: t.priorityColor || (STATUS[t.status]?.fg || '#9ca3af') }} />
            <span className="m-grow" style={{ minWidth: 0 }}>
              <b className="m-ell" style={{ display: 'block', fontSize: 14, fontWeight: 700 }}>{t.title}</b>
              <span className="m-muted m-ell" style={{ display: 'block', fontSize: 12.5 }}>{[t.customerName, t.personName].filter(Boolean).join(' · ') || t.categoryName || '—'}</span>
              <span className="m-row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                <StatusPill s={t.status} />
                {t.dueDate && <span className={`m-pill ${od ? 'bad' : ''}`}>{fd(dOnly(t.dueDate))}</span>}
                {t.followupCount > 0 && <span className="m-pill">💬 {t.followupCount}</span>}
                {(t.assignees || []).length > 1 && <span className="m-pill">👥 {t.assignees.length}</span>}
                {seg === 'visit' && markOf(t) && <span className="m-pill ok">{markOf(t)}</span>}
              </span>
            </span>
            {t.hasUnreadNotification && <span className="m-unread-dot" />}
            <span className="m-drag" role="button" aria-label="Drag to re-order" onPointerDown={(e) => startDrag(e, t.id)} onClick={(e) => e.stopPropagation()}>⠿</span>
          </button>
        );
      })}</div>;

  return (
    <div style={{ padding: 14, paddingBottom: 90 }}>
      <div className="m-seg m-seg4" style={{ marginBottom: 10 }}>
        {[['task', 'Tasks'], ['visit', 'Field Visit']].map(([k, l]) => <button key={k} className={seg === k ? 'on' : ''} onClick={() => setSeg(k)}>{mt(l)}{unseen(k) > 0 && <i className="m-seg-n">{unseen(k)}</i>}</button>)}
      </div>
      <input className="m-input" placeholder={`🔍 ${mt('Search')}`} value={q} onChange={e => setQ(e.target.value)} style={{ marginBottom: 10 }} />
      <div className="m-chipbar">{[['open', 'Open'], ['done', 'Done'], ['all', 'All']].map(([k, l]) => <button key={k} className={flt === k ? 'on' : ''} onClick={() => setFlt(k)}>{mt(l)}</button>)}
        <button onClick={() => { setRows(null); load(); }} aria-label="Refresh">↻</button></div>

      {err && <div className="m-err">{err}</div>}
      {rows === null && <div className="m-empty"><Spinner dark /></div>}
      {rows && list.length === 0 && !err && <div className="m-card"><Empty icon={seg === 'visit' ? '🚗' : '✅'} text={mt('Nothing here yet')} /></div>}
      {seg === 'visit' ? <TripBar tasks={rows} onOpenTask={(id) => { load(); setOpen(id); }} onChanged={load} onSession={setFvSession}>{listJsx}</TripBar> : listJsx}

      <button className="m-addfab" onClick={() => setEdit({})} aria-label={mt('New Task')}>＋</button>

      {current && !edit && <TaskDetail key={current.id} task={current} tasks={rows} onOpenTask={(id) => { load(); setOpen(id); }} onClose={() => setOpen(null)} onChanged={(closeToo) => { load(); if (closeToo === true) setOpen(null); }} onEdit={() => setEdit(current)} onAddVisit={() => setEdit({ newVisit: true })} />}
      {edit && <TaskForm task={edit.id ? edit : null} fieldVisit={seg === 'visit' || !!edit.newVisit} onClose={() => setEdit(null)} onSaved={(saved) => { setEdit(null); load(); if (saved?.id) setOpen(saved.id); }} />}
    </div>
  );
}
