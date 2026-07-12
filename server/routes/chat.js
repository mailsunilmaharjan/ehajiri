import { Router } from 'express';
import pool from '../db.js';
import { broadcastNotification } from '../services/liveNotifications.js';

const router = Router();

const ONLINE_WINDOW = "60 seconds";

/* GET /api/chat/conversations — list the current user's conversations, newest activity first */
router.get('/conversations', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.id, c.type, c.name, c.created_at,
             cp.last_read_at,
             lm.body        AS last_body,
             lm.created_at  AS last_at,
             lm.sender_id   AS last_sender_id,
             (SELECT COUNT(*)::int FROM chat_messages m
                WHERE m.conversation_id = c.id
                  AND m.sender_id != $1
                  AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)
             ) AS unread_count
      FROM   chat_participants cp
      JOIN   chat_conversations c ON c.id = cp.conversation_id
      LEFT JOIN LATERAL (
        SELECT body, created_at, sender_id FROM chat_messages
        WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1
      ) lm ON TRUE
      WHERE  cp.user_id = $1
      ORDER  BY COALESCE(lm.created_at, c.created_at) DESC
    `, [req.user.id]);

    // Attach participant info (needed for direct-chat display name/avatar/online status,
    // and group member lists) in one extra query rather than N+1.
    const ids = rows.map(r => r.id);
    let membersByConv = {};
    if (ids.length) {
      const { rows: members } = await pool.query(`
        SELECT cp.conversation_id, u.id, u.full_name, u.avatar, u.department,
               u.profile_photo,
               (u.last_seen_at > NOW() - INTERVAL '${ONLINE_WINDOW}') AS online
        FROM   chat_participants cp
        JOIN   users u ON u.id = cp.user_id
        WHERE  cp.conversation_id = ANY($1)
      `, [ids]);
      membersByConv = members.reduce((acc, m) => {
        (acc[m.conversation_id] ||= []).push(m);
        return acc;
      }, {});
    }

    const result = rows.map(r => {
      const members = (membersByConv[r.id] || []);
      const others = members.filter(m => m.id !== req.user.id);
      return {
        id            : r.id,
        type          : r.type,
        name          : r.type === 'group' ? r.name : (others[0]?.full_name || 'Unknown'),
        avatar        : r.type === 'group' ? null : (others[0]?.avatar || null),
        photo         : r.type === 'group' ? null : (others[0]?.profile_photo || null),
        online        : r.type === 'direct' ? !!others[0]?.online : null,
        members       : r.type === 'group' ? members : undefined,
        lastMessage   : r.last_body,
        lastAt        : r.last_at,
        lastIsMine    : r.last_sender_id === req.user.id,
        unreadCount   : r.unread_count,
        createdAt     : r.created_at,
      };
    });

    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* GET /api/chat/conversations/:id/messages */
router.get('/conversations/:id/messages', async (req, res) => {
  const convId = parseInt(req.params.id);
  if (isNaN(convId)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const member = await pool.query(
      'SELECT 1 FROM chat_participants WHERE conversation_id = $1 AND user_id = $2',
      [convId, req.user.id]
    );
    if (!member.rows.length) return res.status(403).json({ error: 'Not a participant' });

    const { rows } = await pool.query(`
      SELECT m.id, m.body, m.created_at, m.edited_at, m.sender_id, u.full_name AS sender_name, u.avatar AS sender_avatar,
             u.profile_photo AS sender_photo,
             m.reply_to_id,
             r.body       AS reply_to_body,
             r.created_at AS reply_to_created_at,
             ru.full_name AS reply_to_sender_name,
             COALESCE(rx.reactions, '[]'::json) AS reactions
      FROM   chat_messages m
      JOIN   users u          ON u.id = m.sender_id
      LEFT JOIN chat_messages r ON r.id = m.reply_to_id
      LEFT JOIN users ru       ON ru.id = r.sender_id
      LEFT JOIN LATERAL (
        SELECT json_agg(json_build_object('emoji', cr.emoji, 'userId', cr.user_id, 'name', u2.full_name)
                        ORDER BY cr.created_at) AS reactions
        FROM   chat_message_reactions cr
        JOIN   users u2 ON u2.id = cr.user_id
        WHERE  cr.message_id = m.id
      ) rx ON TRUE
      WHERE  m.conversation_id = $1
      ORDER  BY m.created_at ASC
      LIMIT  500
    `, [convId]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* POST /api/chat/conversations — find-or-create a direct chat, or create a group */
router.post('/conversations', async (req, res) => {
  const { type, userId, name, memberIds } = req.body;
  const client = await pool.connect();
  try {
    if (type === 'direct') {
      const otherId = Number(userId);
      if (!otherId || otherId === req.user.id) return res.status(400).json({ error: 'Invalid recipient' });
      const pairKey = [req.user.id, otherId].sort((a, b) => a - b).join('-');

      const existing = await client.query(
        'SELECT conversation_id FROM chat_direct_pairs WHERE pair_key = $1', [pairKey]
      );
      if (existing.rows.length) {
        return res.json({ id: existing.rows[0].conversation_id, existed: true });
      }

      await client.query('BEGIN');
      try {
        const { rows: [conv] } = await client.query(
          `INSERT INTO chat_conversations (type, created_by) VALUES ('direct', $1) RETURNING id`,
          [req.user.id]
        );
        await client.query(
          `INSERT INTO chat_participants (conversation_id, user_id) VALUES ($1,$2),($1,$3)`,
          [conv.id, req.user.id, otherId]
        );
        await client.query(
          `INSERT INTO chat_direct_pairs (conversation_id, pair_key) VALUES ($1,$2)`,
          [conv.id, pairKey]
        );
        await client.query('COMMIT');
        return res.status(201).json({ id: conv.id, existed: false });
      } catch (e) {
        await client.query('ROLLBACK');
        // Two concurrent requests can both pass the existing-pair check above
        // before either commits — the loser hits this unique violation. Rather
        // than error out, hand it the winner's conversation, same as if the
        // existing-pair check had caught it in the first place.
        if (e.code === '23505' && e.constraint === 'chat_direct_pairs_pair_key_key') {
          const { rows } = await client.query(
            'SELECT conversation_id FROM chat_direct_pairs WHERE pair_key = $1', [pairKey]
          );
          if (rows.length) return res.json({ id: rows[0].conversation_id, existed: true });
        }
        throw e;
      }
    }

    if (type === 'group') {
      if (!name?.trim()) return res.status(400).json({ error: 'Group name is required' });
      const ids = Array.isArray(memberIds) ? memberIds.map(Number).filter(n => !isNaN(n) && n !== req.user.id) : [];
      if (!ids.length) return res.status(400).json({ error: 'Select at least one member' });

      await client.query('BEGIN');
      const { rows: [conv] } = await client.query(
        `INSERT INTO chat_conversations (type, name, created_by) VALUES ('group', $1, $2) RETURNING id`,
        [name.trim(), req.user.id]
      );
      const allIds = [req.user.id, ...ids];
      const placeholders = allIds.map((_, i) => `($1, $${i + 2})`).join(', ');
      await client.query(
        `INSERT INTO chat_participants (conversation_id, user_id) VALUES ${placeholders}`,
        [conv.id, ...allIds]
      );
      await client.query('COMMIT');
      return res.status(201).json({ id: conv.id, existed: false });
    }

    res.status(400).json({ error: 'Invalid conversation type' });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

/* POST /api/chat/conversations/:id/messages — send a chat message */
router.post('/conversations/:id/messages', async (req, res) => {
  const convId = parseInt(req.params.id);
  const body = (req.body.body || '').trim();
  const replyToId = req.body.replyToId ? parseInt(req.body.replyToId) : null;
  if (isNaN(convId)) return res.status(400).json({ error: 'Invalid id' });
  if (!body) return res.status(400).json({ error: 'Message body is required' });

  try {
    const { rows: participants } = await pool.query(
      'SELECT user_id FROM chat_participants WHERE conversation_id = $1', [convId]
    );
    if (!participants.some(p => p.user_id === req.user.id)) {
      return res.status(403).json({ error: 'Not a participant' });
    }

    // A reply must point at a message that's actually in this conversation.
    let validReplyToId = null;
    if (replyToId && !isNaN(replyToId)) {
      const ref = await pool.query(
        'SELECT id FROM chat_messages WHERE id = $1 AND conversation_id = $2', [replyToId, convId]
      );
      if (ref.rows.length) validReplyToId = replyToId;
    }

    const { rows: [msg] } = await pool.query(`
      INSERT INTO chat_messages (conversation_id, sender_id, body, reply_to_id)
      VALUES ($1, $2, $3, $4) RETURNING id, created_at
    `, [convId, req.user.id, body, validReplyToId]);

    const { rows: [sender] } = await pool.query('SELECT full_name FROM users WHERE id = $1', [req.user.id]);
    const conv = await pool.query('SELECT type, name FROM chat_conversations WHERE id = $1', [convId]);

    broadcastNotification({
      type          : 'chat_message',
      conversationId: convId,
      conversationName: conv.rows[0]?.type === 'group' ? conv.rows[0]?.name : sender.full_name,
      messageId     : msg.id,
      senderId      : req.user.id,
      senderName    : sender.full_name,
      preview       : body.substring(0, 120),
      recipientIds  : participants.map(p => p.user_id).filter(id => id !== req.user.id),
      createdAt     : msg.created_at,
    });

    res.status(201).json({ id: msg.id, createdAt: msg.created_at });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* PATCH /api/chat/messages/:id — edit your own sent message (fix a typo,
   add text …). Sender-only; flags the message as edited. */
router.patch('/messages/:id', async (req, res) => {
  const msgId = parseInt(req.params.id);
  const body = (req.body?.body || '').trim();
  if (isNaN(msgId)) return res.status(400).json({ error: 'Invalid message id' });
  if (!body) return res.status(400).json({ error: 'Message body is required' });
  try {
    const { rows } = await pool.query(
      'SELECT sender_id, conversation_id FROM chat_messages WHERE id = $1', [msgId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Message not found' });
    if (rows[0].sender_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the sender can edit a message' });
    }
    await pool.query(
      'UPDATE chat_messages SET body = $1, edited_at = NOW() WHERE id = $2', [body, msgId]
    );

    const { rows: participants } = await pool.query(
      'SELECT user_id FROM chat_participants WHERE conversation_id = $1', [rows[0].conversation_id]
    );
    broadcastNotification({
      type          : 'chat_update',
      conversationId: rows[0].conversation_id,
      messageId     : msgId,
      senderId      : req.user.id,
      recipientIds  : participants.map(p => p.user_id),
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* PATCH /api/chat/messages/:id/check — toggle one "[ ]"/"[x]" checklist line.
   Any participant of the conversation may toggle (checklists are shared
   tasks), but only checkbox lines can be flipped — the rest of the message
   body is untouchable. */
router.patch('/messages/:id/check', async (req, res) => {
  const msgId = parseInt(req.params.id);
  const { lineIndex } = req.body || {};
  if (isNaN(msgId) || !Number.isInteger(lineIndex) || lineIndex < 0) {
    return res.status(400).json({ error: 'Invalid message id or line index' });
  }
  try {
    const { rows } = await pool.query(`
      SELECT m.id, m.body, m.conversation_id
      FROM   chat_messages m
      JOIN   chat_participants cp ON cp.conversation_id = m.conversation_id AND cp.user_id = $2
      WHERE  m.id = $1
    `, [msgId, req.user.id]);
    if (!rows.length) return res.status(403).json({ error: 'Not a participant' });

    const lines = (rows[0].body || '').split('\n');
    const line = lines[lineIndex];
    const m = line === undefined ? null : line.match(/^\[( |x)\]/i);
    if (!m) return res.status(400).json({ error: 'Not a checklist line' });
    lines[lineIndex] = (m[1].toLowerCase() === 'x' ? '[ ]' : '[x]') + line.slice(3);
    const newBody = lines.join('\n');
    await pool.query('UPDATE chat_messages SET body = $1 WHERE id = $2', [newBody, msgId]);

    // Nudge every open thread to reload — chat_update is silent (no popup).
    const { rows: participants } = await pool.query(
      'SELECT user_id FROM chat_participants WHERE conversation_id = $1', [rows[0].conversation_id]
    );
    broadcastNotification({
      type          : 'chat_update',
      conversationId: rows[0].conversation_id,
      messageId     : msgId,
      senderId      : req.user.id,
      recipientIds  : participants.map(p => p.user_id),
    });

    res.json({ id: msgId, body: newBody });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* PUT /api/chat/messages/:id/reaction — set/replace/remove your quick reaction.
   Same emoji again (or emoji:null) removes it; a different one replaces it. */
router.put('/messages/:id/reaction', async (req, res) => {
  const msgId = parseInt(req.params.id);
  const emoji = req.body?.emoji == null ? null : String(req.body.emoji).slice(0, 16);
  if (isNaN(msgId)) return res.status(400).json({ error: 'Invalid message id' });
  try {
    const { rows } = await pool.query(`
      SELECT m.conversation_id
      FROM   chat_messages m
      JOIN   chat_participants cp ON cp.conversation_id = m.conversation_id AND cp.user_id = $2
      WHERE  m.id = $1
    `, [msgId, req.user.id]);
    if (!rows.length) return res.status(403).json({ error: 'Not a participant' });

    const { rows: existing } = await pool.query(
      'SELECT emoji FROM chat_message_reactions WHERE message_id = $1 AND user_id = $2', [msgId, req.user.id]
    );
    if (!emoji || existing[0]?.emoji === emoji) {
      await pool.query('DELETE FROM chat_message_reactions WHERE message_id = $1 AND user_id = $2', [msgId, req.user.id]);
    } else {
      await pool.query(`
        INSERT INTO chat_message_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)
        ON CONFLICT (message_id, user_id) DO UPDATE SET emoji = $3, created_at = NOW()
      `, [msgId, req.user.id, emoji]);
    }

    const { rows: participants } = await pool.query(
      'SELECT user_id FROM chat_participants WHERE conversation_id = $1', [rows[0].conversation_id]
    );
    broadcastNotification({
      type          : 'chat_update',
      conversationId: rows[0].conversation_id,
      messageId     : msgId,
      senderId      : req.user.id,
      recipientIds  : participants.map(p => p.user_id),
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* GET /api/chat/conversations/:id/receipts — every participant's last-read
   time, for the group-chat "Seen by …" line under the newest message. */
router.get('/conversations/:id/receipts', async (req, res) => {
  const convId = parseInt(req.params.id);
  if (isNaN(convId)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const { rows } = await pool.query(`
      SELECT cp.user_id AS "userId", u.full_name AS name, cp.last_read_at AS "lastReadAt"
      FROM   chat_participants cp
      JOIN   users u ON u.id = cp.user_id
      WHERE  cp.conversation_id = $1
    `, [convId]);
    if (!rows.some(r => r.userId === req.user.id)) return res.status(403).json({ error: 'Not a participant' });
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* PUT /api/chat/conversations/:id/read — mark a conversation read up to now */
router.put('/conversations/:id/read', async (req, res) => {
  const convId = parseInt(req.params.id);
  if (isNaN(convId)) return res.status(400).json({ error: 'Invalid id' });
  try {
    await pool.query(
      'UPDATE chat_participants SET last_read_at = NOW() WHERE conversation_id = $1 AND user_id = $2',
      [convId, req.user.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* GET /api/chat/online — user ids considered online right now */
router.get('/online', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id FROM users WHERE last_seen_at > NOW() - INTERVAL '${ONLINE_WINDOW}'`
    );
    res.json(rows.map(r => r.id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
