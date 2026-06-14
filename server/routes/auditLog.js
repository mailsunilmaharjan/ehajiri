import { Router } from 'express';
import pool from '../db.js';

const router = Router();

const toEntry = r => ({
  id        : r.id,
  actorId   : r.actor_id,
  actorRole : r.actor_role,
  actorName : r.actor_name || null,
  action    : r.action,
  entity    : r.entity,
  entityId  : r.entity_id,
  before    : r.before,
  after     : r.after,
  createdAt : r.created_at,
});

router.get('/', async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;
  const { entity, action, actorId } = req.query;

  const conditions = [];
  const params = [];
  if (entity)  { params.push(entity);  conditions.push(`a.entity = $${params.length}`); }
  if (action)  { params.push(action);  conditions.push(`a.action = $${params.length}`); }
  if (actorId) { params.push(actorId); conditions.push(`a.actor_id = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const { rows } = await pool.query(`
      SELECT a.*, u.full_name AS actor_name
      FROM   audit_log a
      LEFT   JOIN users u ON u.id = a.actor_id
      ${where}
      ORDER  BY a.created_at DESC
      LIMIT  $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, limit, offset]);
    res.json(rows.map(toEntry));
  } catch (e) {
    if (e.code === '42P01') return res.json([]); // table not yet created — nothing logged so far
    res.status(500).json({ error: e.message });
  }
});

export default router;
