import { useEffect, useState } from 'react';
import { useApp } from '../context';
import { api } from '../lib/api';
import { addDays } from '../lib/dates';
import { useShortcuts } from '../lib/keys';
import { BsDateInput, Kbd } from './inputs';

export const PRIORITIES = [['low', 'Low'], ['normal', 'Normal'], ['high', 'High'], ['urgent', 'Urgent']];

/**
 * Assign a follow-up task for a document (asked right after a quotation is saved): staff, priority,
 * follow-up date and remarks. It shows under Alerts for that staff member on the date.
 */
export default function TaskDialog({ doc, onDone, onSkip, title = '📌 Assign Follow-up Task' }) {
  const { notify, today, user } = useApp();
  const [users, setUsers] = useState([]);
  const [f, setF] = useState({ assigned_to: user?.username || '', priority: 'normal', remind_on: addDays(today, 2), note: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/users/list').then(setUsers).catch(() => setUsers([])); }, []);

  const save = async (e) => {
    e?.preventDefault();
    if (busy) return;
    if (!f.assigned_to) { notify('Choose the staff member.', 'err'); return; }
    setBusy(true);
    try {
      const nd = await api.post(`/docs/${doc.id}/task`, f);
      notify(`Task assigned to ${users.find((u) => u.username === f.assigned_to)?.full_name || f.assigned_to}`);
      onDone(nd);
    } catch (err) { notify(err.message, 'err'); }
    setBusy(false);
  };
  useShortcuts({ save, close: onSkip });

  return (
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && onSkip()}>
      <form className="card form task-dlg" onSubmit={save} autoComplete="off">
        <h2>{title}</h2>
        <p className="muted small full">{doc.doc_no} · {doc.party_name}{doc.qt_subject ? ` · ${doc.qt_subject}` : ''}</p>
        <label>Staff *
          <select autoFocus value={f.assigned_to} onChange={(e) => setF({ ...f, assigned_to: e.target.value })}>
            <option value="">— choose —</option>
            {users.map((u) => <option key={u.username} value={u.username}>{u.full_name ? `${u.full_name} (${u.username})` : u.username}</option>)}
          </select>
        </label>
        <label>Task Priority
          <select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
            {PRIORITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="full">Follow-up Date
          <BsDateInput value={f.remind_on} onChange={(v) => setF({ ...f, remind_on: v })} />
        </label>
        <label className="full">Remarks
          <textarea rows={3} maxLength={500} value={f.note} placeholder="e.g. Call the purchase manager to confirm the order"
            onChange={(e) => setF({ ...f, note: e.target.value })} />
        </label>
        <div className="actions full">
          <button type="button" className="ghost" onClick={onSkip}>Skip <Kbd>Esc</Kbd></button>
          <span className="spacer" />
          <button data-save disabled={busy}>📌 Assign Task <Kbd>Ctrl+S</Kbd></button>
        </div>
      </form>
    </div>
  );
}
