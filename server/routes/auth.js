import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import os     from 'os';
import pool from '../db.js';
import { signToken, authGuard } from '../middleware/authGuard.js';
import { sendForgotPassword } from '../services/emailService.js';

function getLocalIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

const router = Router();

const isBcryptHash = (s) => typeof s === 'string' && /^\$2[aby]\$/.test(s);

/** POST /api/auth/login */
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    // ── License check BEFORE authentication ─────────────────────────────────
    try {
      const licRes = await pool.query(
        `SELECT payload FROM license WHERE is_active = TRUE LIMIT 1`
      );
      if (!licRes.rows.length) {
        return res.status(403).json({
          licenseError: true,
          error: 'Subscription has been Expired, Contact to your Distributor',
        });
      }
      const payload = licRes.rows[0].payload;
      if (new Date(payload.expires) < new Date()) {
        return res.status(403).json({
          licenseError: true,
          error: 'Subscription has been Expired, Contact to your Distributor',
        });
      }
    } catch (licErr) {
      // If license table doesn't exist yet, block login
      return res.status(403).json({
        licenseError: true,
        error: 'Subscription has been Expired, Contact to your Distributor',
      });
    }
    // ── Normal authentication ────────────────────────────────────────────────
    // Match on email OR username — the login field is labeled "username" in the
    // UI but historically only checked against the email column.
    const { rows } = await pool.query(
      `SELECT * FROM users
       WHERE (email = $1 OR username = $1) AND active = TRUE`,
      [username]
    );
    const row = rows[0];
    if (!row) return res.status(401).json({ error: 'इमेल वा पासवर्ड गलत छ' });

    let passwordOk;
    if (isBcryptHash(row.password)) {
      passwordOk = await bcrypt.compare(password, row.password);
    } else {
      // Legacy plaintext row — match directly, then migrate to a hash on success.
      passwordOk = row.password === password;
      if (passwordOk) {
        const hash = await bcrypt.hash(password, 10);
        pool.query('UPDATE users SET password = $1 WHERE id = $2', [hash, row.id]).catch(() => {});
      }
    }
    if (!passwordOk) return res.status(401).json({ error: 'इमेल वा पासवर्ड गलत छ' });

    const { password: _, ...user } = row;
    const userOut = camelUser(user);
    res.json({ ...userOut, token: signToken(userOut) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/auth/forgot-password — sends a password reset link via email */
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email?.trim()) return res.status(400).json({ error: 'Email is required' });
  try {
    const { rows } = await pool.query(
      `SELECT id, full_name, email FROM users
       WHERE (email=$1 OR username=$1) AND active=TRUE AND is_system IS NOT TRUE`,
      [email.trim()]
    );
    if (!rows.length) return res.json({ ok: true });
    const user = rows[0];
    if (!user.email) return res.status(400).json({ error: 'No email address is linked to this account. Contact your administrator.' });

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await pool.query('DELETE FROM password_reset_tokens WHERE user_id=$1', [user.id]);
    await pool.query(
      'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, token, expiresAt]
    );

    const resetLink = `http://${getLocalIp()}:4000/reset-password?token=${token}`;
    const result = await sendForgotPassword({ to: user.email, fullName: user.full_name, resetLink });
    if (result?.skipped) return res.status(400).json({ error: 'Email notifications are not configured. Contact your administrator.' });
    res.json({ ok: true, sent: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/auth/reset-password-token — validate reset token and set new password */
router.post('/reset-password-token', async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token?.trim()) return res.status(400).json({ error: 'Reset token is required' });
  if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });
  try {
    const { rows } = await pool.query(
      `SELECT t.id, t.user_id, t.expires_at, t.used, u.full_name
       FROM password_reset_tokens t
       JOIN users u ON u.id = t.user_id
       WHERE t.token = $1`,
      [token.trim()]
    );
    if (!rows.length) return res.status(400).json({ error: 'Invalid or expired reset link. Please request a new one.' });
    const rec = rows[0];
    if (rec.used) return res.status(400).json({ error: 'This reset link has already been used. Please request a new one.' });
    if (new Date(rec.expires_at) < new Date()) return res.status(400).json({ error: 'This reset link has expired. Please request a new one.' });

    const hash = await bcrypt.hash(newPassword.trim(), 10);
    await pool.query('UPDATE users SET password=$1 WHERE id=$2', [hash, rec.user_id]);
    await pool.query('UPDATE password_reset_tokens SET used=TRUE WHERE id=$1', [rec.id]);
    res.json({ ok: true, fullName: rec.full_name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/auth/change-password — authenticated user changes their own password */
router.post('/change-password', authGuard, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) return res.status(400).json({ error: 'Old and new passwords are required' });
  if (newPassword.length < 4) return res.status(400).json({ error: 'New password must be at least 4 characters' });
  try {
    const { rows } = await pool.query('SELECT id, password FROM users WHERE id=$1 AND active=TRUE', [req.user.id]);
    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'User not found' });
    const ok = isBcryptHash(row.password)
      ? await bcrypt.compare(oldPassword, row.password)
      : row.password === oldPassword;
    if (!ok) return res.status(403).json({ error: 'Old password is incorrect' });
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password=$1 WHERE id=$2', [hash, row.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/auth/users  (admin only - returns list without passwords) */
router.get('/users', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, employee_id, username, full_name, role, department, branch, position, shift, email, phone, join_date, gender, avatar, active FROM users WHERE is_system IS NOT TRUE ORDER BY id'
    );
    res.json(rows.map(camelUser));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function camelUser(r) {
  return {
    id          : r.id,
    employeeId  : r.employee_id,
    username    : r.username,
    fullName    : r.full_name,
    role        : r.role,
    department  : r.department,
    branch      : r.branch,
    position    : r.position,
    shift       : r.shift,
    email       : r.email,
    phone       : r.phone,
    joinDate    : r.join_date,
    gender      : r.gender,
    avatar      : r.avatar,
    active      : r.active,
    eligibleForOt: r.eligible_for_ot,
  };
}

export default router;
