import { Router } from 'express';
import pool from '../db.js';
import { requireRole } from '../middleware/roleGuard.js';

const router = Router();

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
  t.contact_id  AS "contactId",
  t.contact_person_id AS "contactPersonId",
  t.category_id AS "categoryId",
  t.priority_id AS "priorityId",
  t.created_by  AS "createdBy",
  t.created_at  AS "createdAt",
  t.updated_at  AS "updatedAt",
  COALESCE(c.company_name, c.person_name) AS "customerName",
  COALESCE(cp.name, c.person_name) AS "personName",
  c.address AS "customerAddress",
  COALESCE(cp.mobile1, c.mobile1) AS "customerMobile",
  COALESCE(cp.mobile2, NULL) AS "customerMobile2",
  COALESCE(c.company_phone, c.office_phone) AS "customerPhone",
  COALESCE(cp.email, c.email, c.company_email) AS "customerEmail",
  c.company_address AS "customerCompanyAddress",
  tc.name       AS "categoryName",
  tp.name       AS "priorityName",
  tp.color      AS "priorityColor",
  cu.full_name  AS "createdByName",
  COALESCE((
    SELECT json_agg(json_build_object('id', u.id, 'name', u.full_name) ORDER BY u.full_name)
    FROM task_assignees ta JOIN users u ON u.id = ta.user_id
    WHERE ta.task_id = t.id
  ), '[]') AS "assignees"
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

const toAssigneeIds = (assignedTo) =>
  Array.isArray(assignedTo)
    ? [...new Set(assignedTo.map(Number).filter(n => Number.isInteger(n) && n > 0))]
    : [];

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${SEL} ${JOINS}
       WHERE t.created_by = $1 OR EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = $1)
       ORDER BY t.status = 'completed', t.due_date NULLS LAST, t.id DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
  const { title, description, contactId, contactPersonId, categoryId, priorityId, dueDate, assignedTo } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Task title is required' });
  const assigneeIds = toAssigneeIds(assignedTo);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO tasks (title, description, contact_id, contact_person_id, category_id, priority_id, due_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [title.trim(), description || null, contactId || null, contactPersonId || null, categoryId || null,
       priorityId || null, dueDate || null, req.user.id]
    );
    const taskId = rows[0].id;
    for (const uid of assigneeIds) {
      await client.query(`INSERT INTO task_assignees (task_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [taskId, uid]);
    }
    await client.query('COMMIT');
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
  const { title, description, contactId, contactPersonId, categoryId, priorityId, dueDate, status, assignedTo } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Task title is required' });
  const assigneeIds = toAssigneeIds(assignedTo);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE tasks
       SET title=$1, description=$2, contact_id=$3, contact_person_id=$4, category_id=$5, priority_id=$6, due_date=$7,
           status=COALESCE($8, status), updated_at=NOW()
       WHERE id=$9 AND ${ASSIGNEE_OR_CREATOR('$9', '$10')}
       RETURNING id`,
      [title.trim(), description || null, contactId || null, contactPersonId || null, categoryId || null, priorityId || null,
       dueDate || null, status || null, id, req.user.id]
    );
    if (!rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Task not found' }); }
    await client.query(`DELETE FROM task_assignees WHERE task_id=$1`, [id]);
    for (const uid of assigneeIds) {
      await client.query(`INSERT INTO task_assignees (task_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, uid]);
    }
    await client.query('COMMIT');
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
  if (!['pending', 'in_progress', 'completed'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE tasks SET status=$1, updated_at=NOW()
       WHERE id=$2 AND ${ASSIGNEE_OR_CREATOR('$2', '$3')}
       RETURNING id`,
      [status, id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Task not found' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM tasks WHERE id=$1 AND created_by=$2`, [id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Task not found' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
  f.followed_by AS "followedById", fu.full_name AS "followedByName",
  f.handed_over_to AS "handedOverToId", hu.full_name AS "handedOverToName",
  f.next_category_id AS "nextCategoryId", ntc.name AS "nextCategoryName",
  f.created_at AS "createdAt"
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
    const { rows: access } = await pool.query(
      `SELECT 1 FROM tasks WHERE id=$1 AND ${ASSIGNEE_OR_CREATOR('$1', '$2')}`,
      [taskId, req.user.id]
    );
    if (!access.length) return res.status(404).json({ error: 'Task not found' });
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
    const { rows: access } = await client.query(
      `SELECT 1 FROM tasks WHERE id=$1 AND ${ASSIGNEE_OR_CREATOR('$1', '$2')}`,
      [taskId, req.user.id]
    );
    if (!access.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Task not found' }); }

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
    const { rows: access } = await client.query(
      `SELECT 1 FROM tasks WHERE id=$1 AND ${ASSIGNEE_OR_CREATOR('$1', '$2')}`,
      [taskId, req.user.id]
    );
    if (!access.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Task not found' }); }

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
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM task_followups WHERE id=$1 AND task_id=$2`, [id, taskId]
    );
    if (!rowCount) return res.status(404).json({ error: 'Followup not found' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
