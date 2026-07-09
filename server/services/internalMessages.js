import pool from '../db.js';
import { broadcastNotification } from './liveNotifications.js';

/**
 * Sends an internal message to a fixed set of recipient user IDs and broadcasts
 * an SSE "new_message" notification (picked up as a toast for online recipients,
 * and as an unread inbox badge for whenever they next log in).
 * Shared by POST /api/messages and any server-triggered notification (e.g. missing
 * attendance requests) that needs to reach a specific recommender/approver.
 */
export async function notifyUsers({ senderId, recipientIds, subject, body }) {
  const targetIds = [...new Set((recipientIds || []).map(Number))]
    .filter(n => Number.isFinite(n) && n !== senderId);
  if (!targetIds.length) return { recipientCount: 0 };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [msg] } = await client.query(`
      INSERT INTO internal_messages (sender_id, subject, body, recipient_type)
      VALUES ($1, $2, $3, 'individual') RETURNING id
    `, [senderId, subject, body]);

    const placeholders = targetIds.map((_, i) => `($1, $${i + 2})`).join(', ');
    await client.query(
      `INSERT INTO message_recipients (message_id, recipient_id) VALUES ${placeholders}`,
      [msg.id, ...targetIds]
    );

    await client.query('COMMIT');

    const { rows: [sender] } = await pool.query('SELECT full_name FROM users WHERE id = $1', [senderId]);
    broadcastNotification({
      type        : 'new_message',
      messageId   : msg.id,
      subject,
      senderName  : sender?.full_name || '',
      preview     : body.substring(0, 120),
      recipientType: 'individual',
      recipientIds: targetIds,
    });

    return { id: msg.id, recipientCount: targetIds.length };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
