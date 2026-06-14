import { Router } from 'express';
import pool from '../db.js';
import { broadcastNotification } from '../services/liveNotifications.js';

const router = Router();

/* GET /api/messages — inbox */
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT m.id, m.subject, m.body, m.recipient_type, m.department, m.created_at,
             s.full_name AS sender_name, s.employee_id AS sender_emp_id, s.id AS sender_id,
             mr.is_read, mr.read_at
      FROM   message_recipients mr
      JOIN   internal_messages m ON m.id = mr.message_id
      JOIN   users s             ON s.id = m.sender_id
      WHERE  mr.recipient_id = $1
      ORDER  BY m.created_at DESC
    `, [req.user.id]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* GET /api/messages/sent */
router.get('/sent', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT m.id, m.subject, m.body, m.recipient_type, m.department, m.created_at,
             COUNT(mr.id)::int                                    AS total_recipients,
             COUNT(CASE WHEN mr.is_read THEN 1 END)::int         AS read_count,
             ARRAY_AGG(u.full_name ORDER BY u.full_name)         AS recipient_names
      FROM   internal_messages m
      LEFT   JOIN message_recipients mr ON mr.message_id = m.id
      LEFT   JOIN users u               ON u.id = mr.recipient_id
      WHERE  m.sender_id = $1
      GROUP  BY m.id
      ORDER  BY m.created_at DESC
    `, [req.user.id]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* GET /api/messages/unread-count */
router.get('/unread-count', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT COUNT(*)::int AS count
      FROM   message_recipients mr
      WHERE  mr.recipient_id = $1 AND mr.is_read = FALSE
    `, [req.user.id]);
    res.json({ count: rows[0].count });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* PUT /api/messages/:id/read — mark one message as read */
router.put('/:id/read', async (req, res) => {
  const msgId = parseInt(req.params.id);
  if (isNaN(msgId)) return res.status(400).json({ error: 'Invalid id' });
  try {
    await pool.query(`
      UPDATE message_recipients
      SET    is_read = TRUE, read_at = NOW()
      WHERE  message_id = $1 AND recipient_id = $2
    `, [msgId, req.user.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* POST /api/messages — send new message */
router.post('/', async (req, res) => {
  const { recipientType, recipientIds, department, subject, body } = req.body;
  const senderId = req.user.id;

  if (!subject?.trim())    return res.status(400).json({ error: 'Subject is required' });
  if (!body?.trim())       return res.status(400).json({ error: 'Message body is required' });
  if (!recipientType)      return res.status(400).json({ error: 'Recipient type is required' });
  if (recipientType === 'department' && !department?.trim())
    return res.status(400).json({ error: 'Department is required' });
  if (recipientType === 'individual' && (!Array.isArray(recipientIds) || !recipientIds.length))
    return res.status(400).json({ error: 'Select at least one recipient' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [msg] } = await client.query(`
      INSERT INTO internal_messages (sender_id, subject, body, recipient_type, department)
      VALUES ($1, $2, $3, $4, $5) RETURNING id
    `, [senderId, subject.trim(), body.trim(), recipientType, department || null]);

    // Resolve recipient IDs
    let targetIds = [];
    if (recipientType === 'individual') {
      targetIds = recipientIds.map(Number).filter(n => !isNaN(n) && n !== senderId);
    } else if (recipientType === 'all') {
      const { rows } = await client.query(`
        SELECT id FROM users
        WHERE  active = TRUE AND (is_system IS NOT TRUE)
          AND  role NOT IN ('superAdmin') AND id != $1
      `, [senderId]);
      targetIds = rows.map(r => r.id);
    } else if (recipientType === 'department') {
      const { rows } = await client.query(`
        SELECT id FROM users
        WHERE  active = TRUE AND department = $1 AND id != $2
      `, [department.trim(), senderId]);
      targetIds = rows.map(r => r.id);
    }

    if (targetIds.length > 0) {
      const placeholders = targetIds.map((_, i) => `($1, $${i + 2})`).join(', ');
      await client.query(
        `INSERT INTO message_recipients (message_id, recipient_id) VALUES ${placeholders}`,
        [msg.id, ...targetIds]
      );
    }

    await client.query('COMMIT');

    // Broadcast SSE notification (all clients filter by recipientIds client-side)
    const { rows: [sender] } = await pool.query(
      'SELECT full_name FROM users WHERE id = $1', [senderId]
    );
    broadcastNotification({
      type        : 'new_message',
      messageId   : msg.id,
      subject     : subject.trim(),
      senderName  : sender.full_name,
      preview     : body.trim().substring(0, 120),
      recipientType,
      recipientIds: targetIds,
    });

    res.status(201).json({ id: msg.id, recipientCount: targetIds.length });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

/* DELETE /api/messages/:id — remove from inbox (recipient row only) */
router.delete('/:id', async (req, res) => {
  const msgId = parseInt(req.params.id);
  if (isNaN(msgId)) return res.status(400).json({ error: 'Invalid id' });
  try {
    await pool.query(
      'DELETE FROM message_recipients WHERE message_id = $1 AND recipient_id = $2',
      [msgId, req.user.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
