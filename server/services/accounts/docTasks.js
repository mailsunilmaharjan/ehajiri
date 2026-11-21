/* Bridge between Accounts follow-ups and eHajiri's Task module.
 *
 * Every follow-up reminder on a document (a quotation's "Assign Follow-up Task", or the follow-up chosen on a
 * credit sales / purchase bill) is mirrored as a REAL task in the Task module for the assigned staff member, so
 * it shows in their Task list and raises the normal Task notifications (bell badge, live pop-up, phone push).
 * One reminder = one task (acc_reminders.task_id); saving the document again updates that task instead of
 * creating a second one. Runs AFTER the accounting transaction has committed. Never throws.
 */
import pool from '../../db.js';
import { getModuleFlags } from '../../utils/moduleFlags.js';
import { notifyAssignees, notifyStatusChanged } from '../../routes/tasks.js';
import { logError } from '../../utils/logError.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const PRIORITY_NAME = { urgent: 'high', high: 'high', normal: 'medium', low: 'low' };

export async function syncDocTasks(did, actorUsername) {
  try {
    if (!(await getModuleFlags()).taskEnabled) return;            // Task module off for this company: reminders/Alerts only
    const { rows: rem } = await pool.query(
      `SELECT r.id, r.title, r.note, r.priority, r.remind_on, r.assigned_to, r.task_id, d.id AS doc_id, d.doc_no, d.doc_type, d.party_name, d.total, d.qt_subject,
              NULLIF(COALESCE(NULLIF(d.qt_attn, ''), a.contact_person), '') AS person,
              NULLIF(concat_ws(' | ', NULLIF(a.contact_mobile, ''), NULLIF(COALESCE(NULLIF(a.phone, ''), a.office_phone), '')), '') AS phone
         FROM acc_reminders r JOIN acc_docs d ON d.id = r.doc_id LEFT JOIN acc_ledgers a ON a.id = d.party_id
        WHERE r.doc_id = $1 AND r.kind = 'followup' AND r.status = 'open' AND r.assigned_to IS NOT NULL ORDER BY r.id`, [did]);
    if (!rem.length) return;
    const actor = (await pool.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [actorUsername || ''])).rows[0];
    const prios = (await pool.query('SELECT id, name FROM task_priorities')).rows;
    const cats = (await pool.query('SELECT id, name FROM task_categories')).rows;
    for (const r of rem) {
      const u = (await pool.query('SELECT id FROM users WHERE username = $1 AND COALESCE(active, TRUE) = TRUE', [r.assigned_to])).rows[0];
      if (!u) continue;
      // short title: "Quotation Of Attendance Device — QT/2083-84/0004" (the doc no. is a link in the Task list)
      const lead = r.doc_type === 'QT' ? (String(r.qt_subject || '').trim() || 'Quotation')
        : ['SI', 'SO', 'SR'].includes(r.doc_type) ? 'Collect payment' : ['PB', 'PO', 'PR'].includes(r.doc_type) ? 'Pay supplier' : 'Follow up';
      const title = `${lead} — ${r.doc_no}`.slice(0, 250);
      const priorityId = prios.find((p) => p.name.toLowerCase() === (PRIORITY_NAME[r.priority] || 'medium'))?.id || null;
      const categoryId = (r.doc_type === 'QT' ? cats.find((c) => /quotation/i.test(c.name)) : cats.find((c) => /payment/i.test(c.name)))?.id || null;
      const description = `<p>${esc(r.title)}</p>${r.note ? `<p><b>Remarks:</b> ${esc(r.note)}</p>` : ''}`
        + `<p><b>Document:</b> ${esc(r.doc_no)} · ${esc(r.party_name)} · Rs ${Number(r.total || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })} (Accounts)</p>`;
      let taskId = r.task_id;
      const existing = taskId ? (await pool.query('SELECT id, status FROM tasks WHERE id = $1', [taskId])).rows[0] : null;
      if (existing) {
        if (existing.status === 'completed' || existing.status === 'cancelled') continue;
        await pool.query('UPDATE tasks SET title = $1, description = $2, priority_id = $3, category_id = COALESCE($4, category_id), due_date = $5, doc_id = $6, doc_no = $7, doc_type = $8, party_name = $9, party_person = $10, party_phone = $11, updated_at = NOW() WHERE id = $12',
          [title, description, priorityId, categoryId, r.remind_on, r.doc_id, r.doc_no, r.doc_type, r.party_name, r.person, r.phone, taskId]);
        const cur = (await pool.query('SELECT user_id FROM task_assignees WHERE task_id = $1', [taskId])).rows.map((x) => x.user_id);
        if (!(cur.length === 1 && cur[0] === u.id)) {                 // re-assigned to someone else
          await pool.query('DELETE FROM task_assignees WHERE task_id = $1', [taskId]);
          await pool.query('INSERT INTO task_assignees (task_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [taskId, u.id]);
          await notifyAssignees(taskId, title, [u.id], actor?.id ?? null, [u.id], actor?.id ?? null);
        }
        continue;
      }
      const { rows } = await pool.query(
        'INSERT INTO tasks (title, description, category_id, priority_id, due_date, created_by, doc_id, doc_no, doc_type, party_name, party_person, party_phone) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id',
        [title, description, categoryId, priorityId, r.remind_on, actor?.id ?? null, r.doc_id, r.doc_no, r.doc_type, r.party_name, r.person, r.phone]);
      taskId = rows[0].id;
      await pool.query('INSERT INTO task_assignees (task_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [taskId, u.id]);
      await pool.query('UPDATE acc_reminders SET task_id = $1 WHERE id = $2', [taskId, r.id]);
      await notifyAssignees(taskId, title, [u.id], actor?.id ?? null, [u.id], actor?.id ?? null);
      // a new follow-up on this document replaces the earlier open task(s) for it (e.g. one made from the Task page): close them
      const { rows: closed } = await pool.query(
        "UPDATE tasks SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE doc_id = $1 AND id <> $2 AND status IN ('pending','in_progress') RETURNING id, title, created_by",
        [r.doc_id, taskId]);
      if (closed.length) {
        await pool.query("UPDATE acc_reminders SET status = 'done', done_by = $2, done_at = NOW() WHERE task_id = ANY($1::int[]) AND status = 'open'", [closed.map((c) => c.id), actorUsername || 'system']);
        for (const c of closed) {
          const aids = (await pool.query('SELECT user_id FROM task_assignees WHERE task_id = $1', [c.id])).rows.map((x) => x.user_id);
          await notifyStatusChanged(c.id, c.title, 'completed', c.created_by, aids, actor?.id ?? null);
        }
      }
    }
  } catch (err) { logError('[accounts docTasks]', err); }
}

/** Reminder ticked off in Accounts → close its task too. */
export async function completeLinkedTask(taskId) {
  try {
    if (taskId) await pool.query("UPDATE tasks SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = $1 AND status NOT IN ('completed','cancelled')", [taskId]);
  } catch (err) { logError('[accounts docTasks complete]', err); }
}

