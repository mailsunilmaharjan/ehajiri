import { Router } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../db.js';
import { authGuard } from '../middleware/authGuard.js';
import { requireRole } from '../middleware/roleGuard.js';
import { logBugReport } from '../services/bugReportService.js';

const router = Router();
const canManage = requireRole('admin', 'superAdmin');
const JWT_SECRET = process.env.JWT_SECRET || 'ehajiri_jwt_secret_change_me';

const toRow = r => ({
  id        : r.id,
  source    : r.source,
  page      : r.page,
  method    : r.method,
  statusCode: r.status_code,
  message   : r.message,
  stack     : r.stack,
  userId    : r.user_id,
  userName  : r.user_name || null,
  solution  : r.solution,
  resolved  : r.resolved,
  createdAt : r.created_at,
});

/* POST /api/bug-reports — called by the frontend's global error boundary /
   window.onerror hook whenever a JS crash happens. Deliberately not gated by
   authGuard: a crash can happen before login (or after a session expires),
   and error-reporting itself must never fail just because there's no valid
   session. A user is attached best-effort if a valid token happens to be
   present in the request. */
router.post('/', async (req, res) => {
  const { source, page, message, stack } = req.body;
  if (!message) return res.status(400).json({ error: 'message is required' });

  let userId = null;
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    try { userId = jwt.verify(token, JWT_SECRET).id; } catch { /* not logged in / expired — fine */ }
  }

  await logBugReport({ source, page, message, stack, userId });
  res.status(201).json({ ok: true });
});

/* Everything below is admin-only management of the Bug Finder list. */
router.get('/', authGuard, canManage, async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT b.*, u.full_name AS user_name
      FROM   bug_reports b
      LEFT   JOIN users u ON u.id = b.user_id
      ORDER  BY b.created_at DESC
      LIMIT  500
    `);
    res.json(rows.map(toRow));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', authGuard, canManage, async (req, res) => {
  const { solution, resolved } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE bug_reports SET solution=COALESCE($1,solution), resolved=COALESCE($2,resolved)
       WHERE id=$3 RETURNING *`,
      [solution ?? null, resolved ?? null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(toRow(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', authGuard, canManage, async (req, res) => {
  try {
    await pool.query('DELETE FROM bug_reports WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
