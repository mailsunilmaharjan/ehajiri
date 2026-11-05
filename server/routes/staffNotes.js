import { Router } from 'express';
import { validateBody } from '../middleware/validate.js';
import bcrypt from 'bcryptjs';
import pool from '../db.js';

const router = Router();
const PRIVILEGED_ROLES = ['admin', 'superAdmin'];

// visibility: 'private' (default — only the owner ever sees it, same as
// before this existed) or 'public' (every staff member sees it). Only the
// owner — or an admin/superAdmin — can edit/delete it, enforced by the
// WHERE user_id=$N guard on PUT/DELETE below (skipped for admin/superAdmin).
// ownerName/userId let the frontend show whose public note it is and hide
// Edit/Delete for notes the viewer doesn't own and isn't privileged for.
const SEL = `
  sn.id,
  sn.note_name      AS "noteName",
  sn.note_type      AS "noteType",
  sn.note_details   AS "noteDetails",
  sn.username_title AS "usernameTitle",
  sn.username,
  sn.password,
  sn.security_type  AS "securityType",
  sn.totp_secret    AS "totpSecret",
  sn.gmail_account  AS "gmailAccount",
  sn.remarks,
  sn.visibility,
  sn.user_id        AS "userId",
  u.full_name       AS "ownerName",
  sn.created_at     AS "createdAt"
`;
const JOINS = `FROM staff_notes sn LEFT JOIN users u ON u.id = sn.user_id`;

// ── IMPORTANT: /totp-config routes MUST come before /:id to avoid collision ──

/* GET /api/staff-notes/totp-config */
router.get('/totp-config', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT totp_gmail AS "gmailAccount" FROM users WHERE id=$1',
      [req.user.id]
    );
    const gmailAccount = rows[0]?.gmailAccount || null;
    res.json({ gmailAccount, isSet: !!gmailAccount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* POST /api/staff-notes/totp-config — first-time set (locks once saved) */
router.post('/totp-config', async (req, res) => {
  const { gmailAccount } = req.body;
  if (!gmailAccount) return res.status(400).json({ error: 'Gmail account is required' });
  try {
    const { rows } = await pool.query('SELECT totp_gmail FROM users WHERE id=$1', [req.user.id]);
    if (rows[0]?.totp_gmail) return res.status(409).json({ error: 'Gmail already set — SuperAdmin required to change', locked: true });
    await pool.query('UPDATE users SET totp_gmail=$1 WHERE id=$2', [gmailAccount, req.user.id]);
    res.json({ gmailAccount, isSet: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* PUT /api/staff-notes/totp-config — update Gmail (SuperAdmin credentials required) */
router.put('/totp-config', async (req, res) => {
  const { gmailAccount, adminUsername, adminPassword } = req.body;
  if (!gmailAccount)                    return res.status(400).json({ error: 'Gmail account is required' });
  if (!adminUsername || !adminPassword) return res.status(400).json({ error: 'SuperAdmin credentials required' });
  try {
    const { rows: [admin] } = await pool.query(
      "SELECT id, password FROM users WHERE username=$1 AND role IN ('superAdmin','admin') AND active=TRUE",
      [adminUsername]
    );
    if (!admin) return res.status(403).json({ error: 'Invalid credentials — user not found or inactive' });
    const ok = await bcrypt.compare(adminPassword, admin.password) || admin.password === adminPassword;
    if (!ok)    return res.status(403).json({ error: 'Invalid SuperAdmin password' });
    await pool.query('UPDATE users SET totp_gmail=$1 WHERE id=$2', [gmailAccount, req.user.id]);
    res.json({ gmailAccount, isSet: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Notes CRUD ────────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${SEL} ${JOINS} WHERE sn.user_id = $1 OR sn.visibility = 'public' ORDER BY sn.id DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', validateBody({ noteName: { max: 300 }, noteType: { type: 'scalar', max: 40 }, noteDetails: { max: 1000000 }, usernameTitle: { max: 300 }, username: { max: 500 }, password: { max: 2000 }, securityType: { type: 'scalar', max: 40 }, totpSecret: { max: 500 }, gmailAccount: { max: 300 }, remarks: { max: 100000 }, visibility: { type: 'scalar', max: 20 } }), async (req, res) => {
  const { noteName, noteType, noteDetails, usernameTitle, username, password, securityType, totpSecret, gmailAccount, remarks, visibility } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO staff_notes
         (user_id, note_name, note_type, note_details, username_title, username, password, security_type, totp_secret, gmail_account, remarks, visibility)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id`,
      [req.user.id, noteName, noteType || 'normal', noteDetails || null, usernameTitle || null,
       username || null, password || null, securityType || 'normal', totpSecret || null,
       gmailAccount || null, remarks || null, visibility === 'public' ? 'public' : 'private']
    );
    const { rows: full } = await pool.query(`SELECT ${SEL} ${JOINS} WHERE sn.id = $1`, [rows[0].id]);
    res.json(full[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', validateBody({ noteName: { max: 300 }, noteType: { type: 'scalar', max: 40 }, noteDetails: { max: 1000000 }, usernameTitle: { max: 300 }, username: { max: 500 }, password: { max: 2000 }, securityType: { type: 'scalar', max: 40 }, totpSecret: { max: 500 }, gmailAccount: { max: 300 }, remarks: { max: 100000 }, visibility: { type: 'scalar', max: 20 } }), async (req, res) => {
  const { noteName, noteType, noteDetails, usernameTitle, username, password, securityType, totpSecret, gmailAccount, remarks, visibility } = req.body;
  const isPrivileged = PRIVILEGED_ROLES.includes(req.user.role);
  try {
    const { rows } = await pool.query(
      `UPDATE staff_notes SET
         note_name=$1, note_type=$2, note_details=$3, username_title=$4, username=$5,
         password=$6, security_type=$7, totp_secret=$8, gmail_account=$9, remarks=$10, visibility=$11, updated_at=NOW()
       WHERE id=$12 AND ($13::int IS NULL OR user_id=$13)
       RETURNING id`,
      [noteName, noteType || 'normal', noteDetails || null, usernameTitle || null, username || null,
       password || null, securityType || 'normal', totpSecret || null, gmailAccount || null,
       remarks || null, visibility === 'public' ? 'public' : 'private', req.params.id,
       isPrivileged ? null : req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Note not found' });
    const { rows: full } = await pool.query(`SELECT ${SEL} ${JOINS} WHERE sn.id = $1`, [rows[0].id]);
    res.json(full[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  const isPrivileged = PRIVILEGED_ROLES.includes(req.user.role);
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM staff_notes WHERE id=$1 AND ($2::int IS NULL OR user_id=$2)',
      [req.params.id, isPrivileged ? null : req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Note not found' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
