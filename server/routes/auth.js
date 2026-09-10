import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import os     from 'os';
import pool from '../db.js';
import { signToken, authGuard, signRedirectEmailToken, verifyRedirectEmailToken, verifySsoToken } from '../middleware/authGuard.js';
import { sendForgotPassword } from '../services/emailService.js';
import { syncEmailDirectory } from '../services/directorySync.js';
import { getDistributorContact, getLicenseWarning } from '../middleware/licenseGuard.js';

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

// Cross-tenant lookup for the shared login hub (attend.zkattendance.com) —
// asks LicenseAdmin's directory which tenant a given email actually belongs
// to, used both by the normal login's redirect fallback and by the SSO
// exchange below. Gated by ENABLE_TENANT_RESOLVE so every OTHER tenant's own
// subdomain keeps today's exact behavior (never calls out) unless
// deliberately opted in — this is meant for the one shared hub, not every
// company's login page becoming a directory oracle. Fails closed (null) on
// any error/timeout/missing-subdomain — callers decide what "not resolvable"
// means for their own flow.
async function resolveTenantSubdomain(email) {
  if (process.env.ENABLE_TENANT_RESOLVE !== 'true') return null;
  if (!email || !email.includes('@')) return null; // directory is keyed by email, not username
  const url = process.env.LICENSE_ADMIN_URL;
  const key = process.env.DIRECTORY_API_KEY;
  if (!url || !key) return null;
  try {
    const resp = await fetch(`${url}/api/tenant-companies/resolve-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-directory-key': key },
      body: JSON.stringify({ email: email.trim().toLowerCase() }),
      signal: AbortSignal.timeout(3000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.subdomain) {
      // Matched a tenant, but it predates subdomain assignment (or somehow
      // lost one) — there's no /t/<subdomain> path to build. Worth someone
      // noticing server-side even though callers treat this as "not found".
      console.warn(`[auth] resolve-email matched tenant_id=${data.tenant_id} with no subdomain — cannot build a redirect`);
      return null;
    }
    // Directory says it's here, but the local lookup above already missed —
    // a data-consistency mismatch, not a real redirect. Never claim a match
    // against this same process.
    if (process.env.TENANT_ID && String(data.tenant_id) === String(process.env.TENANT_ID)) return null;
    return data.subdomain;
  } catch {
    return null;
  }
}

// Wraps resolveTenantSubdomain for the normal login flow specifically —
// bundles the subdomain with a short-lived token carrying the email, so the
// destination tenant's own Login page can prefill it without the email ever
// appearing in the URL itself (see signRedirectEmailToken's own comment).
async function tryResolveOtherTenant(email) {
  const subdomain = await resolveTenantSubdomain(email);
  if (!subdomain) return null;
  return { redirect: true, subdomain, redirectToken: signRedirectEmailToken(email) };
}

// Public (no auth) — the Login page needs to show this tenant's own real
// company name/logo instead of always falling back to whatever the app's
// hardcoded pre-login default happens to be, which matters most on the
// shared hub (attend.zkattendance.com) where every company's staff land on
// the same login page before it's known which one they belong to. Deliberately
// minimal — only what a logged-out screen should ever see, nothing else from
// app_settings.
router.get('/branding', async (_req, res) => {
  try {
    const { rows } = await pool.query(`SELECT value FROM app_settings WHERE key='main'`);
    const s = rows[0]?.value || {};
    res.json({
      companyNameNp: s.companyNameNp || '',
      companyNameEn: s.companyNameEn || '',
      companyLogo: s.companyLogo || null,
    });
  } catch {
    res.json({ companyNameNp: '', companyNameEn: '', companyLogo: null });
  }
});

// Public (no auth) — proxies LicenseAdmin's Login Page Advertisement Panel
// content for the Login page's left slideshow. The Login page used to fetch
// this directly from the browser via import.meta.env.VITE_LICENSE_ADMIN_URL,
// a Vite build-time env var that was never actually set anywhere in this
// project — it silently fell back to a hardcoded http://localhost:3000,
// which only ever meant anything on a machine where the visiting BROWSER
// itself had LicenseAdmin running locally. Every real visitor's browser was
// trying (and failing) to reach their own localhost. Routing this through
// the backend instead reuses the LICENSE_ADMIN_URL this process already has
// configured correctly (server/.env) — same fix shape as /branding above.
router.get('/advertisement', async (_req, res) => {
  const url = process.env.LICENSE_ADMIN_URL;
  if (!url) return res.json({ adImages: [] });
  try {
    const resp = await fetch(`${url}/api/settings/advertisement`, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return res.json({ adImages: [] });
    res.json(await resp.json());
  } catch {
    res.json({ adImages: [] });
  }
});

// Public (no auth) — exchanges the short-lived opaque token from a
// cross-tenant login redirect (?et=...) for the actual email, so the Login
// page can prefill it without the email ever having appeared in the URL
// itself (browser history, address-bar autocomplete, IIS/Node access logs).
// Deliberately vague on failure (expired/tampered/wrong-tenant token) —
// the Login page just shows a blank email field, same as landing here fresh.
router.get('/resolve-redirect-token', (req, res) => {
  try {
    const email = verifyRedirectEmailToken(req.query.t || '');
    res.json({ email });
  } catch {
    res.status(400).json({ error: 'Invalid or expired token' });
  }
});

// Public (no auth) — backs LicenseAdmin's "Open Software (Admin/Super
// Admin)" action on the Tenant Companies grid. That link always points at
// the shared hub's own /sso-login page regardless of which tenant was
// clicked (there's no per-tenant subdomain to embed anymore), carrying only
// a short-lived signed email token — never a password. This exchanges it:
// found locally → a real session, same shape as a normal login response.
// Not found here → resolved via the SAME cross-tenant directory lookup the
// normal login redirect uses, and the ORIGINAL token is handed straight
// back rather than minted fresh — it's independently verifiable by any
// tenant process (same SSO_SECRET), so there's no need to reissue it, and
// its short TTL means there's no meaningful replay window to worry about.
router.get('/sso-exchange', async (req, res) => {
  try {
    const email = verifySsoToken(req.query.token || '');
    if (!email) return res.status(400).json({ error: 'This link is invalid or has expired' });

    const { rows } = await pool.query(
      `SELECT * FROM users WHERE (email = $1 OR username = $1) AND active = TRUE`,
      [email]
    );
    if (rows[0]) {
      // Once expired, this link is the ONE bypass — and only for superAdmin
      // (LicenseAdmin's "SuperAdmin Login" right-click action), so an
      // operator can still get in to fix things. Any other role hitting an
      // expired tenant via this same link is blocked exactly like a normal
      // login would be.
      if (rows[0].role !== 'superAdmin') {
        try {
          const licRes = await pool.query(
            `SELECT payload FROM license WHERE is_active = TRUE LIMIT 1`
          );
          const payload = licRes.rows[0]?.payload;
          const expired = !payload || (payload.expires && new Date(payload.expires) < new Date());
          if (expired) {
            return res.status(403).json({
              licenseError: true,
              error: 'Subscription has been Expired, Contact to your Distributor',
              ...await getDistributorContact(),
            });
          }
        } catch {
          return res.status(403).json({
            licenseError: true,
            error: 'Subscription has been Expired, Contact to your Distributor',
          });
        }
      }
      const { password: _, ...user } = rows[0];
      const userOut = await attachCoverage(camelUser(user));
      const licenseWarning = await getLicenseWarning().catch(() => null);
      return res.json({ ...userOut, token: signToken(userOut), licenseWarning });
    }

    const subdomain = await resolveTenantSubdomain(email);
    if (subdomain) return res.json({ redirect: true, subdomain, token: req.query.token });

    res.status(404).json({ error: 'No account found for this link' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/auth/login */
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    // ── License check BEFORE authentication ─────────────────────────────────
    // Blocks every role here, including superAdmin — the normal login form
    // is never the expired-license bypass path; that's /sso-exchange below,
    // and only for superAdmin.
    let licenseWarning = null;
    try {
      const licRes = await pool.query(
        `SELECT payload, distributor_name, distributor_contact_name, distributor_phone, distributor_email
         FROM license WHERE is_active = TRUE LIMIT 1`
      );
      if (!licRes.rows.length) {
        return res.status(403).json({
          licenseError: true,
          error: 'Subscription has been Expired, Contact to your Distributor',
          ...await getDistributorContact(),
        });
      }
      const licRow  = licRes.rows[0];
      const payload = licRow.payload;
      const expires = payload.expires ? new Date(payload.expires) : null;
      if (expires && expires < new Date()) {
        return res.status(403).json({
          licenseError: true,
          error: 'Subscription has been Expired, Contact to your Distributor',
          distributorName       : licRow.distributor_name         || '',
          distributorContactName: licRow.distributor_contact_name || '',
          distributorPhone      : licRow.distributor_phone        || '',
          distributorEmail      : licRow.distributor_email        || '',
        });
      }
      licenseWarning = await getLicenseWarning();
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
    if (!row) {
      const redirect = await tryResolveOtherTenant(username);
      if (redirect) return res.json(redirect);
      return res.status(401).json({ error: 'इमेल वा पासवर्ड गलत छ' });
    }

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
    const userOut = await attachCoverage(camelUser(user));
    res.json({ ...userOut, token: signToken(userOut), licenseWarning });
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
  if (!newPassword) return res.status(400).json({ error: 'Password is required' });
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
      'SELECT id, employee_id, username, full_name, role, department, branch, position, shift, email, phone, join_date, gender, avatar, active, profile_photo FROM users WHERE is_system IS NOT TRUE ORDER BY id'
    );
    res.json(rows.map(camelUser));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** PUT /api/auth/profile-photo — set/remove the logged-in user's own picture */
router.put('/profile-photo', authGuard, async (req, res) => {
  const { photo } = req.body || {};
  if (photo !== null && photo !== undefined) {
    if (typeof photo !== 'string' || !photo.startsWith('data:image/'))
      return res.status(400).json({ error: 'Photo must be a data-URL image' });
    // Client downscales to ~256px JPEG before upload; anything bigger than
    // this means that step was bypassed — refuse rather than bloat every
    // employees/chat/messages payload it gets embedded into.
    if (photo.length > 400_000)
      return res.status(400).json({ error: 'Photo too large — must be under ~300 KB' });
  }
  try {
    const { rows } = await pool.query(
      'UPDATE users SET profile_photo=$1 WHERE id=$2 RETURNING profile_photo',
      [photo || null, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json({ profilePhoto: rows[0].profile_photo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** PUT /api/auth/profile-email — logged-in user changes their own email.
 * Self-service, scoped to req.user.id only — not the admin-only Staff form
 * (server/routes/employees.js), which any role reaching /profile isn't
 * necessarily permitted to use. */
router.put('/profile-email', authGuard, async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'Email is required' });
  if (!email.includes('@')) return res.status(400).json({ error: 'Enter a valid email address' });
  try {
    const { rows: beforeRows } = await pool.query('SELECT email FROM users WHERE id=$1', [req.user.id]);
    if (!beforeRows.length) return res.status(404).json({ error: 'User not found' });
    const oldEmail = beforeRows[0].email;

    const { rows } = await pool.query(
      'UPDATE users SET email=$1 WHERE id=$2 RETURNING email',
      [email, req.user.id]
    );
    // Keeps the shared-login directory resolvable for the new address (and
    // stops pointing at the old one) — same obligation employees.js already
    // has whenever users.email changes, just triggered from a different form.
    syncEmailDirectory({ action: 'upsert', oldEmail, newEmail: email });
    res.json({ email: rows[0].email });
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'users_email_key') {
      return res.status(409).json({ error: 'Duplicate Email address, put another' });
    }
    res.status(500).json({ error: err.message });
  }
});

// Branch Area Manager / Department Incharge only — resolves their covered
// branches/departments (manager_branch_coverage / manager_department_coverage,
// migration v138) into plain name strings and attaches them to the login
// response, the same shape filterByRole already expects branch/department in.
// Deliberately NOT embedded in the JWT (signToken) — the token is long-lived
// (30d) and coverage is meant to change immediately when an admin edits it in
// Roles & Permission → Coverage; orgScope.js re-reads these tables live on
// every scoped request instead of trusting a stale token claim. This means
// the client-side copy here (used for display filtering only) can lag behind
// a coverage edit until next login — the same staleness branch/department
// already have today, not a new one, and never the actual authorization gate.
async function attachCoverage(userOut) {
  if (userOut.role === 'branchAreaManager') {
    const { rows } = await pool.query(
      `SELECT b.name FROM manager_branch_coverage mbc
       JOIN branches b ON b.id = mbc.branch_id
       WHERE mbc.user_id = $1 ORDER BY b.name`,
      [userOut.id]
    );
    userOut.coverageBranches = rows.map(r => r.name);
  } else if (userOut.role === 'departmentIncharge') {
    const { rows } = await pool.query(
      `SELECT d.name AS department, b.name AS branch
       FROM manager_department_coverage mdc
       JOIN departments d ON d.id = mdc.department_id
       LEFT JOIN branches b ON b.id = mdc.branch_id
       WHERE mdc.user_id = $1 ORDER BY d.name, b.name`,
      [userOut.id]
    );
    userOut.coverageDepartments = rows.map(r => ({ department: r.department, branch: r.branch || null }));
  }
  return userOut;
}

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
    profilePhoto: r.profile_photo,
    eligibleForOt: r.eligible_for_ot,
    onlineAttendanceEnabled: r.online_attendance_enabled,
  };
}

export default router;
