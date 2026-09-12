import { Router } from 'express';
import pool from '../db.js';
import { requireRole } from '../middleware/roleGuard.js';
import { broadcastNotification } from '../services/liveNotifications.js';
import { sendTaskAssigned, sendTaskCompleted } from '../services/emailService.js';
import { logError } from '../utils/logError.js';

const router = Router();

// reactionsSubquery(targetType, targetIdCol) — WhatsApp-style emoji reactions,
// shared by the task itself and every Followup/Reply (Description & Replies
// popup) so the shape is built once and reused everywhere. viewsSubquery is
// the same idea for "Seen by" read receipts (task_views) — who's actually
// opened this task/followup and when, shown as a hover-avatar stack next to
// the reactions. Both hoisted above SEL/FOLLOWUP_SEL/REPLY_SEL so every
// SELECT below (including the task list) can embed them directly.
const reactionsSubquery = (targetType, targetIdCol) => `
  COALESCE((
    SELECT json_agg(json_build_object('userId', tr.user_id, 'userName', ru.full_name,
      'userPhoto', ru.profile_photo, 'emoji', tr.emoji) ORDER BY tr.created_at)
    FROM task_reactions tr JOIN users ru ON ru.id = tr.user_id
    WHERE tr.target_type = '${targetType}' AND tr.target_id = ${targetIdCol}
  ), '[]') AS "reactions"
`;
const viewsSubquery = (targetType, targetIdCol) => `
  COALESCE((
    SELECT json_agg(json_build_object('userId', tv.user_id, 'userName', vu.full_name,
      'userPhoto', vu.profile_photo, 'seenAt', tv.seen_at) ORDER BY tv.seen_at DESC)
    FROM task_views tv JOIN users vu ON vu.id = tv.user_id
    WHERE tv.target_type = '${targetType}' AND tv.target_id = ${targetIdCol}
  ), '[]') AS "seenBy"
`;

// Task list (Staff > Task) — visible to whoever created it OR whoever it's
// assigned to (so a manager can hand a task to a staff member and both see
// it), same spirit as Leave/Office Visit's reco/approval model but simpler
// (no separate approval step here — assignment is direct). Only the creator
// may delete a task; both creator and any assignee may edit/complete it.
// A task can be assigned to several staff at once (task_assignees join
// table, checkbox grid on the Task form) — no separate "primary assignee".
// contact_person_id (optional) points at ONE specific person from the
// selected company contact's Contact Persons sub-list (staff_contact_persons
// — a company can have several; a personal-type contact never has any).
// When set, that person's own name/mobile take priority over the parent
// contact's — a company record itself has no personal phone number, so
// without this, "Person Name"/"Mobile no." would stay blank for every task
// against a company customer.
const SEL = `
  t.id, t.title, t.description, t.status,
  t.due_date    AS "dueDate",
  t.is_field_visit AS "isFieldVisit",
  t.contact_id  AS "contactId",
  t.contact_person_id AS "contactPersonId",
  t.category_id AS "categoryId",
  t.priority_id AS "priorityId",
  t.created_by  AS "createdBy",
  t.created_at  AS "createdAt",
  t.updated_at  AS "updatedAt",
  t.completed_at AS "completedAt",
  COALESCE(c.company_name, c.person_name) AS "customerName",
  COALESCE(cp.name, c.person_name) AS "personName",
  c.address AS "customerAddress",
  COALESCE(cp.mobile1, c.mobile1) AS "customerMobile",
  COALESCE(cp.mobile2, NULL) AS "customerMobile2",
  COALESCE(c.company_phone, c.office_phone) AS "customerPhone",
  COALESCE(cp.email, c.email, c.company_email) AS "customerEmail",
  c.company_address AS "customerCompanyAddress",
  c.latitude AS "customerLat", c.longitude AS "customerLng",
  tc.name       AS "categoryName",
  tp.name       AS "priorityName",
  tp.color      AS "priorityColor",
  cu.full_name  AS "createdByName",
  COALESCE((
    SELECT json_agg(json_build_object('id', u.id, 'name', u.full_name, 'post', u.position) ORDER BY u.full_name)
    FROM task_assignees ta JOIN users u ON u.id = ta.user_id
    WHERE ta.task_id = t.id
  ), '[]') AS "assignees",
  (SELECT COUNT(*)::int FROM task_followups tf WHERE tf.task_id = t.id) AS "followupCount",
  EXISTS (
    SELECT 1 FROM task_followups tf2
    WHERE tf2.task_id = t.id AND tf2.handed_over_to IS NOT NULL
  ) AS "hasTransfer",
  ${reactionsSubquery('task', 't.id')},
  ${viewsSubquery('task', 't.id')}
`;
const JOINS = `
  FROM tasks t
  LEFT JOIN staff_contacts        c  ON c.id  = t.contact_id
  LEFT JOIN staff_contact_persons cp ON cp.id = t.contact_person_id
  LEFT JOIN task_categories       tc ON tc.id = t.category_id
  LEFT JOIN task_priorities       tp ON tp.id = t.priority_id
  LEFT JOIN users                 cu ON cu.id = t.created_by
`;

// Membership check reused by every route that lets an assignee (not just
// the creator) act on a task.
const ASSIGNEE_OR_CREATOR = (taskIdParam, userIdParam) =>
  `(created_by = ${userIdParam} OR EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = ${taskIdParam} AND ta.user_id = ${userIdParam}))`;

// Same audience GET /tasks?staffId= already grants for VIEWING someone
// else's task (admin/superAdmin -> everyone; branchManager/departmentHead ->
// same branch/department) — but re-checked per-task here so that the
// followup/reply sub-routes below (view followups, view replies, post a
// reply) grant that identical wider audience instead of silently falling
// back to creator-or-assignee-only. Before this, an admin could list and
// open another staff member's task via "Filter by Staff" but every
// followup/reply action on it 404'd with "Task not found" — misleading,
// since the task plainly does exist and is visible to them.
// `queryable` defaults to the pool but accepts an in-transaction `client` so
// callers already inside BEGIN/COMMIT can reuse the same connection.
export async function userCanAccessTask(user, taskId, queryable = pool) {
  const role = user.role || 'employee';
  if (role === 'admin' || role === 'superAdmin') {
    const { rows } = await queryable.query('SELECT 1 FROM tasks WHERE id=$1', [taskId]);
    return rows.length > 0;
  }
  if (role === 'branchManager' || role === 'departmentHead') {
    const scopeCol = role === 'branchManager' ? 'branch' : 'department';
    const scopeVal = (role === 'branchManager' ? user.branch : user.department) || '';
    if (scopeVal.trim()) {
      const { rows } = await queryable.query(
        `SELECT 1 FROM tasks t WHERE t.id=$1 AND (
           ${ASSIGNEE_OR_CREATOR('t.id', '$3')}
           OR EXISTS (SELECT 1 FROM users ou WHERE ou.id = t.created_by AND LOWER(TRIM(ou.${scopeCol})) = LOWER(TRIM($2)))
           OR EXISTS (SELECT 1 FROM task_assignees ta JOIN users au ON au.id = ta.user_id WHERE ta.task_id = t.id AND LOWER(TRIM(au.${scopeCol})) = LOWER(TRIM($2)))
         )`,
        [taskId, scopeVal, user.id]
      );
      return rows.length > 0;
    }
  }
  const { rows } = await queryable.query(
    `SELECT 1 FROM tasks WHERE id=$1 AND ${ASSIGNEE_OR_CREATOR('$1', '$2')}`,
    [taskId, user.id]
  );
  return rows.length > 0;
}

const toAssigneeIds = (assignedTo) =>
  Array.isArray(assignedTo)
    ? [...new Set(assignedTo.map(Number).filter(n => Number.isInteger(n) && n > 0))]
    : [];

// Live browser notifications (Settings → Company Information → "Enable Task
// Notifications") — SSE broadcast for whoever's online right now, same
// transport the "new message" toast already uses (see AttendanceToasts.jsx).
// Backed by a task_notifications row per recipient so the unread badge count
// (Staff/Task menu) survives a login/refresh instead of resetting to 0 for
// anyone who wasn't connected at the exact moment the event fired — that gap
// was the actual bug: a recipient who logs in AFTER a task was assigned
// while offline used to never see it at all, not even the badge.
async function insertTaskNotifications(recipientIds, taskId, event, title, byUserId) {
  if (!recipientIds.length) return;
  await pool.query(
    `INSERT INTO task_notifications (task_id, event, title, by_user_id, user_id, is_read)
     SELECT $1, $2, $3, $4, u, FALSE FROM UNNEST($5::int[]) AS u`,
    [taskId, event, title, byUserId, recipientIds]
  );
}

// Full audience for a task-event popup/badge — deliberately wider than the
// task's own creator/assignee access check: everyone who should be kept in
// the loop when a task is assigned, completed, or its status/description
// changes — its creator, every current assignee, every admin/superAdmin,
// and the Department Head of any assignee's department. Always excludes the
// actor (nobody needs a popup about their own action).
async function resolveTaskAudience(creatorId, assigneeIds, actorId, queryable = pool) {
  const { rows: deptRows } = await queryable.query(
    `SELECT DISTINCT department FROM users WHERE id = ANY($1::int[]) AND department IS NOT NULL AND department != ''`,
    [assigneeIds]
  );
  const departments = deptRows.map(r => r.department);
  const { rows } = await queryable.query(
    `SELECT DISTINCT id FROM users
     WHERE id = ANY($1::int[])
        OR id = $2
        OR role IN ('admin','superAdmin')
        OR (role = 'departmentHead' AND department = ANY($3::text[]))`,
    [assigneeIds, creatorId || null, departments]
  );
  return rows.map(r => r.id).filter(uid => uid !== actorId);
}

// The live popup + unread-badge side of a task event (see AttendanceToasts.jsx's
// TaskToast/"Enable Task Notifications" — this is the exact same mechanism the
// live attendance pings use), shared by every event below. Email is handled
// separately per event (narrower audiences, and only for assigned/completed —
// see notifyAssignees/notifyOnCompletion) since "popup notifications" and
// "email notifications" are two different asks with two different blast radii.
// Never throws — a notification failure must not surface as a 500 on what was
// actually a successful save.
async function broadcastTaskEvent(taskId, title, event, creatorId, assigneeIds, actorId, extra = {}) {
  try {
    const recipientIds = await resolveTaskAudience(creatorId, assigneeIds, actorId);
    if (!recipientIds.length) return;
    const { rows } = await pool.query('SELECT full_name FROM users WHERE id=$1', [actorId]);
    const byName = rows[0]?.full_name || 'Someone';
    await insertTaskNotifications(recipientIds, taskId, event, title, actorId);
    broadcastNotification({ type: 'task', event, taskId, title, by: byName, recipientIds, ...extra });
  } catch (err) { logError(`[tasks broadcastTaskEvent:${event}]`, err); }
}

// newAssigneeIds — only the people newly added this time (creation, or an
// edit that added someone) — gates whether this fires at all, and is who
// actually gets the "you've been assigned" email. allAssigneeIds is the
// task's full current assignee list, used only to size the popup audience
// (so Department Head/Admin/every other current assignee sees it too, not
// just whoever's new).
async function notifyAssignees(taskId, title, newAssigneeIds, creatorId, allAssigneeIds, actorId, isFieldVisit = false) {
  if (!newAssigneeIds.length) return;
  await broadcastTaskEvent(taskId, title, 'assigned', creatorId, allAssigneeIds, actorId, { isFieldVisit });
  try {
    const emailRecipientIds = newAssigneeIds.filter(uid => uid !== actorId);
    if (!emailRecipientIds.length) return;
    const cfg = (await pool.query("SELECT value FROM app_settings WHERE key='emailConfig'")).rows[0]?.value;
    const emailCfg = typeof cfg === 'string' ? JSON.parse(cfg) : cfg;
    if (!emailCfg?.notifications?.taskAssignedCompleted) return;
    const { rows: actorRows } = await pool.query('SELECT full_name FROM users WHERE id=$1', [actorId]);
    const byName = actorRows[0]?.full_name || 'Someone';
    const { rows: recipients } = await pool.query(
      `SELECT full_name, email FROM users WHERE id = ANY($1::int[]) AND email IS NOT NULL AND email != ''`,
      [emailRecipientIds]
    );
    for (const r of recipients) {
      await sendTaskAssigned({ to: r.email, fullName: r.full_name, taskTitle: title, by: byName });
    }
  } catch (err) { logError('[tasks notifyAssignees email]', err); }
}

// Completion popup goes to the full task audience (creator, every assignee,
// admin, Department Head); completion EMAIL stays narrower — creator, admin,
// and matching Department Heads only, not a resend to every assignee who was
// presumably already on the task and doesn't need an inbox ping about it.
export async function notifyOnCompletion(taskId, title, creatorId, assigneeIds, actorId, isFieldVisit = false) {
  await broadcastTaskEvent(taskId, title, 'completed', creatorId, assigneeIds, actorId, { isFieldVisit });
  try {
    const { rows: deptRows } = await pool.query(
      `SELECT DISTINCT department FROM users WHERE id = ANY($1::int[]) AND department IS NOT NULL AND department != ''`,
      [assigneeIds]
    );
    const departments = deptRows.map(r => r.department);
    const { rows: recipRows } = await pool.query(
      `SELECT DISTINCT id, full_name, email FROM users
       WHERE (id = $1)
          OR role IN ('admin','superAdmin')
          OR (role = 'departmentHead' AND department = ANY($2::text[]))`,
      [creatorId || null, departments]
    );
    const emailRecipientIds = recipRows.map(r => r.id).filter(uid => uid !== actorId);
    if (!emailRecipientIds.length) return;
    const cfg = (await pool.query("SELECT value FROM app_settings WHERE key='emailConfig'")).rows[0]?.value;
    const emailCfg = typeof cfg === 'string' ? JSON.parse(cfg) : cfg;
    if (!emailCfg?.notifications?.taskAssignedCompleted) return;
    const { rows: actorRows } = await pool.query('SELECT full_name FROM users WHERE id=$1', [actorId]);
    const byName = actorRows[0]?.full_name || 'Someone';
    for (const r of recipRows.filter(r => emailRecipientIds.includes(r.id) && r.email)) {
      await sendTaskCompleted({ to: r.email, fullName: r.full_name, taskTitle: title, by: byName });
    }
  } catch (err) { logError('[tasks notifyOnCompletion email]', err); }
}

// Status moving to anything OTHER than 'completed' (pending -> in_progress,
// or reopening back from completed) — popup/badge only, same wide audience
// as every other task event. No email template exists for this (or was
// asked for) — only the assigned/completed transitions email.
export async function notifyStatusChanged(taskId, title, newStatus, creatorId, assigneeIds, actorId, isFieldVisit = false) {
  await broadcastTaskEvent(taskId, title, 'status_changed', creatorId, assigneeIds, actorId, { status: newStatus, isFieldVisit });
}

// Task Title/Description edited via the Edit Task form ("remarks changed" in
// the everyday sense staff use around here) — popup/badge only, same
// audience, no email.
async function notifyDescriptionChanged(taskId, title, creatorId, assigneeIds, actorId, isFieldVisit = false) {
  await broadcastTaskEvent(taskId, title, 'description_changed', creatorId, assigneeIds, actorId, { isFieldVisit });
}

// A new Followup entry logged against the task (Task page's Followup History
// panel) — same popup/badge audience as every other task event, no email
// (matches status_changed/description_changed — no template exists/was asked
// for). Called after the followup insert commits, so a "Hand Over" followup's
// newly-added assignee (already in task_assignees by then) is included in the
// audience the same way any other current assignee is.
async function notifyFollowupAdded(taskId, title, creatorId, assigneeIds, actorId, isFieldVisit = false) {
  await broadcastTaskEvent(taskId, title, 'followup_added', creatorId, assigneeIds, actorId, { isFieldVisit });
}

// "Belongs to $1" for a SPECIFIC person's own task list (used for the
// default self-view and for "Filter by Staff" -> one specific person,
// below) — a task counts as theirs if they're a listed assignee, OR they
// created it and it has no assignees yet (so a just-drafted, not-yet-handed-
// off task doesn't vanish on its creator). Deliberately NOT "created_by OR
// assignee" — that older rule meant a Staff member who data-entered a batch
// of tasks and handed every one off to a colleague still saw all of them in
// their OWN "my tasks" list forever, since they stayed the creator even
// after reassigning. Confirmed as a real report (Planet tenant, Achyut
// Silwal seeing tasks he'd created but assigned to Santosh/Arishna — his
// "Filter by Staff" was locked to himself specifically, not "Show All",
// so this was the only way those rows could appear). The oversight/"Show
// All Task" branch/department and company-wide scopes below are untouched —
// those are deliberately full-transparency views for managers, where seeing
// everything a branch/department's people have created (regardless of who
// it ended up assigned to) is the point.
const OWN_TASKS_WHERE = `(
  EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = $1)
  OR (t.created_by = $1 AND NOT EXISTS (SELECT 1 FROM task_assignees ta2 WHERE ta2.task_id = t.id))
)`;

// "Filter by Staff" on the Task page — defaults to the caller's own tasks
// (see OWN_TASKS_WHERE above) but every role can also request a
// wider view via ?staffId=:
//   staffId=all        -> admin/superAdmin: every task company-wide.
//                          branchManager/departmentHead: every task whose
//                          creator or any assignee shares that person's own
//                          branch/department (mirrors AuthContext.filterByRole's
//                          scoping, just re-derived server-side since the JWT
//                          already carries role/branch/department — see
//                          authGuard.js's signToken).
//                          employee: no wider scope to grant, silently no-ops.
//   staffId=<other id> -> that person's tasks specifically, gated by the same
//                          scope check (branch/department match, or admin).
// A denied/unrecognized value never errors — it just falls back to "my own
// tasks", the same safe default as if staffId were omitted entirely.
router.get('/', async (req, res) => {
  try {
    const me = req.user;
    const role = me.role || 'employee';
    const isAdmin = role === 'admin' || role === 'superAdmin';
    const isBM    = role === 'branchManager';
    const isDH    = role === 'departmentHead';

    const requested = req.query.staffId ? String(req.query.staffId) : '';
    let where  = OWN_TASKS_WHERE;
    let params = [me.id];

    if (requested === 'all' && (isAdmin || isBM || isDH)) {
      if (isAdmin) {
        where = '1=1';
        params = [];
      } else {
        const scopeCol = isBM ? 'branch' : 'department';
        const scopeVal = (isBM ? me.branch : me.department) || '';
        if (scopeVal.trim()) {
          where = `(
            EXISTS (SELECT 1 FROM users ou WHERE ou.id = t.created_by AND LOWER(TRIM(ou.${scopeCol})) = LOWER(TRIM($1)))
            OR EXISTS (SELECT 1 FROM task_assignees ta JOIN users au ON au.id = ta.user_id WHERE ta.task_id = t.id AND LOWER(TRIM(au.${scopeCol})) = LOWER(TRIM($1)))
          )`;
          params = [scopeVal];
        }
      }
    } else if (requested && requested !== 'all' && requested !== String(me.id)) {
      const staffId = parseInt(requested, 10);
      if (Number.isInteger(staffId)) {
        let allowed = isAdmin;
        if (!allowed && (isBM || isDH)) {
          const scopeCol = isBM ? 'branch' : 'department';
          const scopeVal = (isBM ? me.branch : me.department) || '';
          if (scopeVal.trim()) {
            const { rows: chk } = await pool.query(
              `SELECT 1 FROM users WHERE id=$1 AND LOWER(TRIM(${scopeCol})) = LOWER(TRIM($2))`,
              [staffId, scopeVal]
            );
            allowed = chk.length > 0;
          }
        }
        if (allowed) {
          where  = OWN_TASKS_WHERE;
          params = [staffId];
        }
      }
    }

    const { rows } = await pool.query(
      `SELECT ${SEL} ${JOINS}
       WHERE ${where}
       ORDER BY t.status = 'completed', t.due_date NULLS LAST, t.id DESC`,
      params
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Unread task-notification count for the Staff/Task menu badge — DB-backed
// (see task_notifications above) so it reflects the true unread count right
// after login, not just whatever accumulated during this one live session.
// Split into two mutually-exclusive counts by joining back to the task's
// CURRENT is_field_visit flag: "count" is the regular Task page's badge
// (non-Field-Visit tasks only), "fieldVisitCount" is the separate Field
// Visit page's own badge — see the Staff dropdown's two nav items.
router.get('/notifications/count', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE t.is_field_visit IS NOT TRUE)::int AS count,
         COUNT(*) FILTER (WHERE t.is_field_visit IS TRUE)::int AS "fieldVisitCount"
       FROM task_notifications tn JOIN tasks t ON t.id = tn.task_id
       WHERE tn.user_id=$1 AND tn.is_read=FALSE`,
      [req.user.id]
    );
    res.json({ count: rows[0].count, fieldVisitCount: rows[0].fieldVisitCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Marks unread task notifications as read for the caller — fired when they
// open the Task page (regular scope) or the Field Visit page (?scope=fieldVisit),
// same "seen it" moment each page's badge already cleared on client-side only
// before this. Scoped by the underlying task's is_field_visit flag so opening
// one page doesn't also clear the other page's badge.
router.post('/notifications/read', async (req, res) => {
  try {
    const fieldVisit = req.query.scope === 'fieldVisit';
    await pool.query(
      `UPDATE task_notifications tn SET is_read=TRUE
       FROM tasks t WHERE t.id = tn.task_id AND tn.user_id=$1 AND tn.is_read=FALSE AND t.is_field_visit = $2`,
      [req.user.id, fieldVisit]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Marks unread notifications as read for ONE specific task — the nav
// badge's count is meant to stay blinking per-task until that task is
// actually acted on (double-clicked open, or a followup logged against it),
// not just cleared in bulk the moment the Task/Field Visit list page is
// opened (see openEdit/saveFollowup in TaskList.jsx). A no-op (0 rows
// touched) if this task has no unread notification for the caller.
router.post('/:id/notifications/read', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    await pool.query(
      `UPDATE task_notifications SET is_read=TRUE WHERE task_id=$1 AND user_id=$2 AND is_read=FALSE`,
      [id, req.user.id]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
  const { title, description, contactId, contactPersonId, categoryId, priorityId, dueDate, assignedTo, isFieldVisit } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Task title is required' });
  const assigneeIds = toAssigneeIds(assignedTo);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO tasks (title, description, contact_id, contact_person_id, category_id, priority_id, due_date, created_by, is_field_visit)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [title.trim(), description || null, contactId || null, contactPersonId || null, categoryId || null,
       priorityId || null, dueDate || null, req.user.id, !!isFieldVisit]
    );
    const taskId = rows[0].id;
    for (const uid of assigneeIds) {
      await client.query(`INSERT INTO task_assignees (task_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [taskId, uid]);
    }
    await client.query('COMMIT');
    // Everyone assigned at creation is "new" — creator and actor are the same person here.
    await notifyAssignees(taskId, title.trim(), assigneeIds, req.user.id, assigneeIds, req.user.id, !!isFieldVisit);
    const { rows: full } = await pool.query(`SELECT ${SEL} ${JOINS} WHERE t.id = $1`, [taskId]);
    res.status(201).json(full[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const { title, description, contactId, contactPersonId, categoryId, priorityId, dueDate, status, assignedTo, isFieldVisit } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Task title is required' });
  const assigneeIds = toAssigneeIds(assignedTo);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Same wider audience as viewing (userCanAccessTask) — this used to be
    // ASSIGNEE_OR_CREATOR only, which meant an admin/branch manager/dept
    // head could see a task via "Show All Task" but got "Task not found"
    // the moment they tried to actually edit it, since they were neither
    // its creator nor an assignee.
    if (!(await userCanAccessTask(req.user, id, client))) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Task not found' }); }
    // Snapshot before the UPDATE — status/description-change notifications
    // below need to know whether those fields actually changed, not just
    // what they were saved as.
    const { rows: beforeRows } = await client.query(
      `SELECT title, description, status, created_by AS "createdBy" FROM tasks WHERE id=$1`,
      [id]
    );
    if (!beforeRows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Task not found' }); }
    const before = beforeRows[0];

    await client.query(
      `UPDATE tasks
       SET title=$1, description=$2, contact_id=$3, contact_person_id=$4, category_id=$5, priority_id=$6, due_date=$7,
           status=COALESCE($8, status), is_field_visit=$9, updated_at=NOW(),
           completed_at = CASE
             WHEN $8 IS NULL OR $8 = status THEN completed_at
             WHEN $8 = 'completed' THEN NOW()
             ELSE NULL
           END
       WHERE id=$10`,
      [title.trim(), description || null, contactId || null, contactPersonId || null, categoryId || null, priorityId || null,
       dueDate || null, status || null, !!isFieldVisit, id]
    );
    const { rows: prevRows } = await client.query(`SELECT user_id FROM task_assignees WHERE task_id=$1`, [id]);
    const prevAssigneeIds = new Set(prevRows.map(r => r.user_id));
    await client.query(`DELETE FROM task_assignees WHERE task_id=$1`, [id]);
    for (const uid of assigneeIds) {
      await client.query(`INSERT INTO task_assignees (task_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, uid]);
    }
    await client.query('COMMIT');

    const newTitle = title.trim();
    const fieldVisit = !!isFieldVisit;
    // Only the newly-added assignees notify as "assigned" — re-saving a task's
    // existing assignee list on every edit shouldn't re-notify people already on it.
    await notifyAssignees(id, newTitle, assigneeIds.filter(uid => !prevAssigneeIds.has(uid)), before.createdBy, assigneeIds, req.user.id, fieldVisit);

    if (status && status !== before.status) {
      if (status === 'completed') await notifyOnCompletion(id, newTitle, before.createdBy, assigneeIds, req.user.id, fieldVisit);
      else await notifyStatusChanged(id, newTitle, status, before.createdBy, assigneeIds, req.user.id, fieldVisit);
    }
    if ((description || null) !== (before.description || null)) {
      await notifyDescriptionChanged(id, newTitle, before.createdBy, assigneeIds, req.user.id, fieldVisit);
    }

    const { rows: full } = await pool.query(`SELECT ${SEL} ${JOINS} WHERE t.id = $1`, [id]);
    res.json(full[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// Quick complete/reopen toggle from the list checkbox — doesn't require
// resending the whole form.
router.patch('/:id/status', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const { status } = req.body;
  if (!['pending', 'in_progress', 'completed', 'cancelled'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  try {
    // Same wider audience as viewing/editing — see the matching comment on
    // PUT /:id above.
    if (!(await userCanAccessTask(req.user, id))) return res.status(404).json({ error: 'Task not found' });
    const { rows } = await pool.query(
      // $1::varchar is required here — Postgres 18 can't reconcile $1 used
      // both as a direct column assignment and inside the CASE comparison
      // otherwise ("inconsistent types deduced for parameter $1"), even
      // though both contexts plainly resolve to the same varchar(20) type.
      `UPDATE tasks SET status=$1::varchar, updated_at=NOW(),
         completed_at = CASE WHEN $1 = 'completed' THEN NOW() ELSE NULL END
       WHERE id=$2
       RETURNING id, title, created_by AS "createdBy", is_field_visit AS "isFieldVisit"`,
      [status, id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Task not found' });
    const { rows: assigneeRows } = await pool.query('SELECT user_id FROM task_assignees WHERE task_id=$1', [id]);
    const assigneeIds = assigneeRows.map(r => r.user_id);
    if (status === 'completed') {
      await notifyOnCompletion(id, rows[0].title, rows[0].createdBy, assigneeIds, req.user.id, rows[0].isFieldVisit);
    } else {
      await notifyStatusChanged(id, rows[0].title, status, rows[0].createdBy, assigneeIds, req.user.id, rows[0].isFieldVisit);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Right-click "Mark/Unmark as Field Visit" on the Task grid — a small
// dedicated toggle so the DataGrid context menu doesn't need to resend the
// whole task form (title, description, assignees...) just to flip one flag.
router.patch('/:id/field-visit', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const { isFieldVisit } = req.body;
  try {
    if (!(await userCanAccessTask(req.user, id))) return res.status(404).json({ error: 'Task not found' });
    const { rows } = await pool.query(
      `UPDATE tasks SET is_field_visit=$1, updated_at=NOW() WHERE id=$2 RETURNING id, is_field_visit AS "isFieldVisit"`,
      [!!isFieldVisit, id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Task not found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: owned } = await client.query(`SELECT 1 FROM tasks WHERE id=$1 AND created_by=$2`, [id, req.user.id]);
    if (!owned.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Task not found' }); }
    // task_reactions/task_views are polymorphic tables (target_type/target_id,
    // no FK to tasks/task_followups/task_followup_replies), so they won't
    // cascade on their own — clean them up before the delete below cascades
    // away the followups/replies those rows point at, or they're orphaned
    // forever.
    await client.query(
      `DELETE FROM task_reactions
       WHERE (target_type='task' AND target_id=$1)
          OR (target_type='followup' AND target_id IN (SELECT id FROM task_followups WHERE task_id=$1))
          OR (target_type='reply' AND target_id IN (
                SELECT r.id FROM task_followup_replies r JOIN task_followups f ON f.id = r.followup_id WHERE f.task_id=$1))`,
      [id]
    );
    await client.query(
      `DELETE FROM task_views
       WHERE (target_type='task' AND target_id=$1)
          OR (target_type='followup' AND target_id IN (SELECT id FROM task_followups WHERE task_id=$1))`,
      [id]
    );
    await client.query(`DELETE FROM tasks WHERE id=$1`, [id]);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// ── Followup History (right-side panel on the Task page) ──────────────────
// Log of contact attempts against a task — who logged it (followed_by) is
// always the session user at creation time (never trusted from the client)
// and never changes on edit. Editing is open to the same creator-or-assignee
// audience as the task itself; deleting a followup is admin/superAdmin only
// (requireRole below), same bar as other destructive admin actions. "Hand
// over" also adds that person to task_assignees so the task actually shows
// up in their own list, not just in the log.
const FOLLOWUP_SEL = `
  f.id, f.task_id AS "taskId", f.mode,
  f.followup_date AS "followupDate",
  f.description,
  f.next_followup_at AS "nextFollowupAt",
  f.followed_by AS "followedById", fu.full_name AS "followedByName", fu.position AS "followedByPost", fu.profile_photo AS "followedByPhoto",
  f.handed_over_to AS "handedOverToId", hu.full_name AS "handedOverToName",
  f.next_category_id AS "nextCategoryId", ntc.name AS "nextCategoryName",
  f.created_at AS "createdAt",
  ${reactionsSubquery('followup', 'f.id')},
  ${viewsSubquery('followup', 'f.id')}
`;
const FOLLOWUP_JOINS = `
  FROM task_followups f
  LEFT JOIN users fu ON fu.id = f.followed_by
  LEFT JOIN users hu ON hu.id = f.handed_over_to
  LEFT JOIN task_categories ntc ON ntc.id = f.next_category_id
`;
const FOLLOWUP_MODES = ['phone', 'email', 'whatsapp', 'sms'];

router.get('/:taskId/followups', async (req, res) => {
  const taskId = parseInt(req.params.taskId);
  if (isNaN(taskId)) return res.status(400).json({ error: 'Invalid task id' });
  try {
    if (!(await userCanAccessTask(req.user, taskId))) return res.status(404).json({ error: 'Task not found' });
    const { rows } = await pool.query(
      `SELECT ${FOLLOWUP_SEL} ${FOLLOWUP_JOINS} WHERE f.task_id = $1 ORDER BY f.followup_date DESC, f.id DESC`,
      [taskId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:taskId/followups', async (req, res) => {
  const taskId = parseInt(req.params.taskId);
  if (isNaN(taskId)) return res.status(400).json({ error: 'Invalid task id' });
  const { mode, followupDate, description, nextCategoryId, nextFollowupAt, handedOverTo } = req.body;
  if (!FOLLOWUP_MODES.includes(mode)) return res.status(400).json({ error: 'Invalid followup mode' });
  const handedOverId = handedOverTo ? Number(handedOverTo) : null;
  const nextCategory = nextCategoryId ? Number(nextCategoryId) : null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (!(await userCanAccessTask(req.user, taskId, client))) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Task not found' }); }

    const { rows } = await client.query(
      `INSERT INTO task_followups (task_id, mode, followup_date, followed_by, description, next_category_id, next_followup_at, handed_over_to)
       VALUES ($1,$2,COALESCE($3, CURRENT_DATE),$4,$5,$6,$7,$8) RETURNING id`,
      [taskId, mode, followupDate || null, req.user.id, description || null,
       nextCategory, nextFollowupAt || null, handedOverId]
    );
    if (handedOverId) {
      await client.query(`INSERT INTO task_assignees (task_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [taskId, handedOverId]);
    }
    // "Transfer for Next Task" actually reclassifies the task, same non-destructive-side-effect pattern as Hand Over -> task_assignees.
    if (nextCategory) {
      await client.query(`UPDATE tasks SET category_id=$1, updated_at=NOW() WHERE id=$2`, [nextCategory, taskId]);
    }
    await client.query('COMMIT');
    const { rows: full } = await pool.query(`SELECT ${FOLLOWUP_SEL} ${FOLLOWUP_JOINS} WHERE f.id = $1`, [rows[0].id]);
    res.status(201).json(full[0]);
    try {
      const { rows: taskRows } = await pool.query(
        `SELECT title, created_by AS "createdBy", is_field_visit AS "isFieldVisit" FROM tasks WHERE id=$1`, [taskId]
      );
      const taskInfo = taskRows[0];
      if (taskInfo) {
        const { rows: assigneeRows } = await pool.query('SELECT user_id FROM task_assignees WHERE task_id=$1', [taskId]);
        await notifyFollowupAdded(taskId, taskInfo.title, taskInfo.createdBy, assigneeRows.map(r => r.user_id), req.user.id, taskInfo.isFieldVisit);
      }
    } catch (err) { logError('[tasks followup notify]', err); }
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

router.put('/:taskId/followups/:id', async (req, res) => {
  const taskId = parseInt(req.params.taskId);
  const id = parseInt(req.params.id);
  if (isNaN(taskId) || isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const { mode, followupDate, description, nextCategoryId, nextFollowupAt, handedOverTo } = req.body;
  if (!FOLLOWUP_MODES.includes(mode)) return res.status(400).json({ error: 'Invalid followup mode' });
  const handedOverId = handedOverTo ? Number(handedOverTo) : null;
  const nextCategory = nextCategoryId ? Number(nextCategoryId) : null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (!(await userCanAccessTask(req.user, taskId, client))) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Task not found' }); }

    const { rows } = await client.query(
      `UPDATE task_followups
       SET mode=$1, followup_date=COALESCE($2, followup_date), description=$3, next_category_id=$4,
           next_followup_at=$5, handed_over_to=$6
       WHERE id=$7 AND task_id=$8
       RETURNING id`,
      [mode, followupDate || null, description || null, nextCategory, nextFollowupAt || null, handedOverId, id, taskId]
    );
    if (!rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Followup not found' }); }
    if (handedOverId) {
      await client.query(`INSERT INTO task_assignees (task_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [taskId, handedOverId]);
    }
    if (nextCategory) {
      await client.query(`UPDATE tasks SET category_id=$1, updated_at=NOW() WHERE id=$2`, [nextCategory, taskId]);
    }
    await client.query('COMMIT');
    const { rows: full } = await pool.query(`SELECT ${FOLLOWUP_SEL} ${FOLLOWUP_JOINS} WHERE f.id = $1`, [id]);
    res.json(full[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

router.delete('/:taskId/followups/:id', requireRole('admin', 'superAdmin'), async (req, res) => {
  const taskId = parseInt(req.params.taskId);
  const id = parseInt(req.params.id);
  if (isNaN(taskId) || isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Same task_reactions/task_views cleanup as the task delete route above
    // — no FK to cascade this on its own.
    await client.query(
      `DELETE FROM task_reactions
       WHERE (target_type='followup' AND target_id=$1)
          OR (target_type='reply' AND target_id IN (SELECT id FROM task_followup_replies WHERE followup_id=$1))`,
      [id]
    );
    await client.query(`DELETE FROM task_views WHERE target_type='followup' AND target_id=$1`, [id]);
    const { rowCount } = await client.query(`DELETE FROM task_followups WHERE id=$1 AND task_id=$2`, [id, taskId]);
    if (!rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Followup not found' }); }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// ── Replies on a single followup entry — same audience as the followup log
// itself (see userCanAccessTask): the task's creator/any assignee, plus
// admin/superAdmin (any task) and branchManager/departmentHead (any task in
// their own branch/department) — the same wider visibility GET /tasks?staffId=
// already grants for browsing someone else's tasks in the first place.
const REPLY_SEL = `
  r.id, r.followup_id AS "followupId", r.parent_reply_id AS "parentReplyId", r.message, r.created_at AS "createdAt",
  r.user_id AS "userId", u.full_name AS "userName", u.role AS "userRole", u.position AS "userPost", u.profile_photo AS "userPhoto",
  ${reactionsSubquery('reply', 'r.id')}
`;
const REPLY_JOINS = `FROM task_followup_replies r LEFT JOIN users u ON u.id = r.user_id`;

router.get('/:taskId/followups/:followupId/replies', async (req, res) => {
  const taskId = parseInt(req.params.taskId);
  const followupId = parseInt(req.params.followupId);
  if (isNaN(taskId) || isNaN(followupId)) return res.status(400).json({ error: 'Invalid id' });
  try {
    if (!(await userCanAccessTask(req.user, taskId))) return res.status(404).json({ error: 'Task not found' });
    const { rows } = await pool.query(
      `SELECT ${REPLY_SEL} ${REPLY_JOINS} WHERE r.followup_id = $1 ORDER BY r.created_at ASC`,
      [followupId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:taskId/followups/:followupId/replies', async (req, res) => {
  const taskId = parseInt(req.params.taskId);
  const followupId = parseInt(req.params.followupId);
  if (isNaN(taskId) || isNaN(followupId)) return res.status(400).json({ error: 'Invalid id' });
  const { message, parentReplyId } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Reply message is required' });
  try {
    if (!(await userCanAccessTask(req.user, taskId))) return res.status(404).json({ error: 'Task not found' });

    let parentId = null;
    if (parentReplyId) {
      // Must belong to the same followup — otherwise a tampered id could graft a
      // reply onto an unrelated (possibly inaccessible) followup's thread.
      const { rows: parentRows } = await pool.query(
        `SELECT 1 FROM task_followup_replies WHERE id=$1 AND followup_id=$2`,
        [parentReplyId, followupId]
      );
      if (!parentRows.length) return res.status(400).json({ error: 'Invalid parent reply' });
      parentId = Number(parentReplyId);
    }

    const { rows } = await pool.query(
      `INSERT INTO task_followup_replies (followup_id, user_id, message, parent_reply_id) VALUES ($1,$2,$3,$4) RETURNING id`,
      [followupId, req.user.id, message.trim(), parentId]
    );
    const { rows: full } = await pool.query(`SELECT ${REPLY_SEL} ${REPLY_JOINS} WHERE r.id = $1`, [rows[0].id]);
    res.status(201).json(full[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Emoji reactions — WhatsApp-style: one reaction per person per target
// (a followup's own description, or one specific reply). Reacting again with
// the same emoji removes it; a different emoji replaces it. Same access
// audience as the followup/reply itself (userCanAccessTask).
const REACTION_EMOJI = ['✅', '👍', '👎', '❤️', '😂'];

async function setReaction(targetType, targetId, userId, emoji) {
  const { rows: existing } = await pool.query(
    `SELECT emoji FROM task_reactions WHERE target_type=$1 AND target_id=$2 AND user_id=$3`,
    [targetType, targetId, userId]
  );
  if (existing[0]?.emoji === emoji) {
    await pool.query(`DELETE FROM task_reactions WHERE target_type=$1 AND target_id=$2 AND user_id=$3`, [targetType, targetId, userId]);
  } else {
    await pool.query(
      `INSERT INTO task_reactions (target_type, target_id, user_id, emoji) VALUES ($1,$2,$3,$4)
       ON CONFLICT (target_type, target_id, user_id) DO UPDATE SET emoji=EXCLUDED.emoji, created_at=NOW()`,
      [targetType, targetId, userId, emoji]
    );
  }
  const { rows } = await pool.query(
    `SELECT tr.user_id AS "userId", u.full_name AS "userName", u.profile_photo AS "userPhoto", tr.emoji
     FROM task_reactions tr JOIN users u ON u.id = tr.user_id
     WHERE tr.target_type=$1 AND tr.target_id=$2 ORDER BY tr.created_at`,
    [targetType, targetId]
  );
  return rows;
}

router.put('/:taskId/followups/:followupId/reactions', async (req, res) => {
  const taskId = parseInt(req.params.taskId);
  const followupId = parseInt(req.params.followupId);
  if (isNaN(taskId) || isNaN(followupId)) return res.status(400).json({ error: 'Invalid id' });
  const { emoji } = req.body;
  if (!REACTION_EMOJI.includes(emoji)) return res.status(400).json({ error: 'Invalid emoji' });
  try {
    if (!(await userCanAccessTask(req.user, taskId))) return res.status(404).json({ error: 'Task not found' });
    res.json(await setReaction('followup', followupId, req.user.id, emoji));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:taskId/followups/:followupId/replies/:replyId/reactions', async (req, res) => {
  const taskId = parseInt(req.params.taskId);
  const replyId = parseInt(req.params.replyId);
  if (isNaN(taskId) || isNaN(replyId)) return res.status(400).json({ error: 'Invalid id' });
  const { emoji } = req.body;
  if (!REACTION_EMOJI.includes(emoji)) return res.status(400).json({ error: 'Invalid emoji' });
  try {
    if (!(await userCanAccessTask(req.user, taskId))) return res.status(404).json({ error: 'Task not found' });
    res.json(await setReaction('reply', replyId, req.user.id, emoji));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Emoji reactions on the task itself — same one-per-person mechanism as a
// followup's description, just target_type='task' (New/Edit Task form).
router.put('/:id/reactions', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const { emoji } = req.body;
  if (!REACTION_EMOJI.includes(emoji)) return res.status(400).json({ error: 'Invalid emoji' });
  try {
    if (!(await userCanAccessTask(req.user, id))) return res.status(404).json({ error: 'Task not found' });
    res.json(await setReaction('task', id, req.user.id, emoji));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── "Seen by" read receipts — task_views. Upserts the caller into the
// target's viewer list (seen_at bumped to now on every call) and returns the
// full list, same request/response shape as setReaction above. Fired by the
// client the moment it actually opens the Edit Task form or the Followup
// History panel/a specific followup entry — not on every list-page render.
async function recordView(targetType, targetId, userId) {
  await pool.query(
    `INSERT INTO task_views (target_type, target_id, user_id, seen_at) VALUES ($1,$2,$3,NOW())
     ON CONFLICT (target_type, target_id, user_id) DO UPDATE SET seen_at=NOW()`,
    [targetType, targetId, userId]
  );
  const { rows } = await pool.query(
    `SELECT tv.user_id AS "userId", u.full_name AS "userName", u.profile_photo AS "userPhoto", tv.seen_at AS "seenAt"
     FROM task_views tv JOIN users u ON u.id = tv.user_id
     WHERE tv.target_type=$1 AND tv.target_id=$2 ORDER BY tv.seen_at DESC`,
    [targetType, targetId]
  );
  return rows;
}

router.put('/:id/seen', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    if (!(await userCanAccessTask(req.user, id))) return res.status(404).json({ error: 'Task not found' });
    res.json(await recordView('task', id, req.user.id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:taskId/followups/:id/seen', async (req, res) => {
  const taskId = parseInt(req.params.taskId);
  const id = parseInt(req.params.id);
  if (isNaN(taskId) || isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    if (!(await userCanAccessTask(req.user, taskId))) return res.status(404).json({ error: 'Task not found' });
    res.json(await recordView('followup', id, req.user.id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
