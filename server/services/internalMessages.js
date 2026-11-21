import pool from '../db.js';
import { broadcastNotification } from './liveNotifications.js';
import { pushLater } from './pushService.js';

/**
 * Sends an internal message to a fixed set of recipient user IDs and broadcasts
 * an SSE "new_message" notification (picked up as a toast for online recipients,
 * and as an unread inbox badge for whenever they next log in).
 * Shared by POST /api/messages and any server-triggered notification (e.g. missing
 * attendance requests) that needs to reach a specific recommender/approver.
 */
/** Bucket a system notification for the bell (leave / office_visit / overtime / task / field_visit / accounts / quotation …).
 *  Callers may pass `category` explicitly; otherwise it is inferred from the subject and target path. */
export function inferCategory(subject = '', path = '') {
  const t = String(subject);
  if (/office visit/i.test(t))            return 'office_visit';
  if (/field visit/i.test(t))             return 'field_visit';
  if (/quotation/i.test(t))               return 'quotation';
  if (/overtime/i.test(t))                return 'overtime';
  if (/duty/i.test(t))                    return 'duty';
  if (/late in|early out|missing attendance|online attendance|attendance/i.test(t)) return 'attendance';
  if (/leave/i.test(t))                   return 'leave';
  if (/task/i.test(t))                    return 'task';
  if (/invoice|bill|payment|account|stock/i.test(t)) return 'accounts';
  if (String(path).includes('/m/roster')) return 'duty';
  return 'general';
}

export async function notifyUsers({ senderId, recipientIds, subject, body, path, category }) {
  const targetIds = [...new Set((recipientIds || []).map(Number))]
    .filter(n => Number.isFinite(n) && n !== senderId);
  if (!targetIds.length) return { recipientCount: 0 };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [msg] } = await client.query(`
      INSERT INTO internal_messages (sender_id, subject, body, recipient_type, category)
      VALUES ($1, $2, $3, 'individual', $4) RETURNING id
    `, [senderId, subject, body, category || inferCategory(subject, path)]);

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
      category    : category || inferCategory(subject, path),
      subject,
      senderName  : sender?.full_name || '',
      preview     : body.substring(0, 120),
      recipientType: 'individual',
      recipientIds: targetIds,
    });
    // phone notification (no-op unless the mobile app + Firebase are set up)
    pushLater(targetIds, { title: subject || 'New message', body: String(body || '').substring(0, 120), data: { path: path || '/staff/message' } });

    return { id: msg.id, recipientCount: targetIds.length };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
