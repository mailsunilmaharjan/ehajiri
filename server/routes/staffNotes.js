import { Router } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../db.js';

const router = Router();

const SEL = `
  id,
  note_name      AS "noteName",
  note_type      AS "noteType",
  note_details   AS "noteDetails",
  username_title AS "usernameTitle",
  username,
  password,
  security_type  AS "securityType",
  totp_secret    AS "totpSecret",
  gmail_account  AS "gmailAccount",
  remarks,
  created_at     AS "createdAt"
`;

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
      `SELECT ${SEL} FROM staff_notes WHERE user_id = $1 ORDER BY id DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
  const { noteName, noteType, noteDetails, usernameTitle, username, password, securityType, totpSecret, gmailAccount, remarks } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO staff_notes
         (user_id, note_name, note_type, note_details, username_title, username, password, security_type, totp_secret, gmail_account, remarks)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING ${SEL}`,
      [req.user.id, noteName, noteType || 'normal', noteDetails || null, usernameTitle || null,
       username || null, password || null, securityType || 'normal', totpSecret || null,
       gmailAccount || null, remarks || null]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', async (req, res) => {
  const { noteName, noteType, noteDetails, usernameTitle, username, password, securityType, totpSecret, gmailAccount, remarks } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE staff_notes SET
         note_name=$1, note_type=$2, note_details=$3, username_title=$4, username=$5,
         password=$6, security_type=$7, totp_secret=$8, gmail_account=$9, remarks=$10, updated_at=NOW()
       WHERE id=$11 AND user_id=$12
       RETURNING ${SEL}`,
      [noteName, noteType || 'normal', noteDetails || null, usernameTitle || null, username || null,
       password || null, securityType || 'normal', totpSecret || null, gmailAccount || null,
       remarks || null, req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Note not found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM staff_notes WHERE id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Note not found' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
