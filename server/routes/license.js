/**
 * License Management Routes
 * POST /api/license/activate   — activate a license key
 * GET  /api/license/status     — get current license status
 * POST /api/license/deactivate — remove license
 */
import express   from 'express';
import crypto    from 'crypto';
import bcrypt    from 'bcryptjs';
import pool      from '../db.js';
import { logError } from '../utils/logError.js';

const router = express.Router();

const SECRET = 'EHAJIRI_LICENSE_SECRET_2024_v2';  // MUST match LicenseAdmin

// ── Ensure license table exists (called from index.js post-migration) ────────
export async function ensureLicenseTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS license (
        id         SERIAL PRIMARY KEY,
        license_id VARCHAR(100) UNIQUE,
        key_raw    TEXT NOT NULL,
        payload    JSONB NOT NULL,
        activated_at TIMESTAMPTZ DEFAULT NOW(),
        is_active  BOOLEAN DEFAULT TRUE
      );
    `);
    // Distributor contact info shown on the "Subscription Expired" screen.
    // Deliberately NOT part of the signed `payload` — it's just-for-display
    // (who to call to renew), not something that needs cryptographic
    // integrity, so LicenseAdmin can update it independently of activation
    // (e.g. a dealer's phone number changes) without re-signing/re-activating
    // the license itself. ADD COLUMN IF NOT EXISTS so this backfills onto
    // every already-provisioned tenant's table on its next restart, not just
    // freshly-created ones.
    // distributor_name = dealer's company/business name; distributor_contact_name
    // = the actual person there (dealer_accounts has both `company` and
    // `owner_name` for exactly this reason — they're often different).
    await pool.query(`
      ALTER TABLE license
        ADD COLUMN IF NOT EXISTS distributor_name         VARCHAR(255),
        ADD COLUMN IF NOT EXISTS distributor_contact_name VARCHAR(255),
        ADD COLUMN IF NOT EXISTS distributor_phone        VARCHAR(100),
        ADD COLUMN IF NOT EXISTS distributor_email        VARCHAR(255);
    `);
  } catch (e) { logError('[license] table init error:', e); }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function hmacSign(data) {
  return crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
}

function decodeB64url(str) {
  const pad = str.replace(/-/g,'+').replace(/_/g,'/');
  return JSON.parse(Buffer.from(pad, 'base64').toString('utf8'));
}

function parseLicenseKey(rawKey) {
  if (!rawKey || !rawKey.startsWith('EHAJ-')) return null;
  const body   = rawKey.slice(5);
  const dotIdx = body.lastIndexOf('.');
  if (dotIdx < 0) return null;
  const encoded  = body.slice(0, dotIdx);
  const sig      = body.slice(dotIdx + 1);
  const expected = hmacSign(encoded);
  if (expected !== sig) return null;          // tampered
  const payload = decodeB64url(encoded);
  if (!payload) return null;
  return { encoded, sig, payload };
}

// Inverse of parseLicenseKey — builds a self-signed key string from a payload.
// Used by dealer-activate, which generates licenses locally rather than
// fetching one from the LicenseAdmin portal.
function signLicenseKey(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `EHAJ-${encoded}.${hmacSign(encoded)}`;
}

// ── Helpers: compute effective expiry from payload ────────────────────────────
function computeExpiry(payload, activatedAt) {
  // New format: duration_days field (v3+)
  if (payload.duration_days != null) {
    if (payload.duration_days === 0) return '2099-12-31';
    const base = activatedAt ? new Date(activatedAt) : new Date();
    base.setDate(base.getDate() + payload.duration_days);
    return base.toISOString().slice(0, 10);
  }
  // Legacy format: expires absolute date
  return payload.expires || null;
}

// ── GET /status ───────────────────────────────────────────────────────────────
router.get('/status', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM license WHERE is_active = TRUE ORDER BY activated_at DESC LIMIT 1`
    );
    if (!rows.length) return res.json({ licensed: false });

    const row     = rows[0];
    const payload = row.payload;
    const expires = payload.expires || computeExpiry(payload, row.activated_at);
    const expired = expires ? new Date(expires) < new Date() : false;

    res.json({
      licensed    : !expired,
      expired,
      licenseId   : payload.id,
      client      : payload.client,
      email       : payload.email,
      type        : payload.type,
      expires,
      durationDays: payload.duration_days ?? null,
      maxUsers    : payload.maxUsers    ?? 25,
      maxStaff    : payload.maxStaff    ?? 25,
      maxDevices  : payload.maxDevices  ?? 1,
      features    : payload.features || [],
      issuedAt    : payload.issuedAt,
      activatedAt : row.activated_at,
      distributorName       : row.distributor_name         || payload.distributorName || '',
      distributorContactName: row.distributor_contact_name || '',
      distributorPhone      : row.distributor_phone        || '',
      distributorEmail      : row.distributor_email        || '',
    });
  } catch (e) {
    logError('[license/status]', e);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /distributor ─────────────────────────────────────────────────────────
// Sets/updates the distributor contact info shown on the "Subscription
// Expired" screen. Called by LicenseAdmin (pushLicenseToTenant) whenever a
// license is pushed/activated, and independently whenever a dealer's own
// phone/email changes — deliberately separate from /activate so updating
// contact info never requires re-signing or re-activating the license
// itself. No-ops (200, does nothing) if there's no active license row yet.
router.post('/distributor', async (req, res) => {
  const { name = '', contactName = '', phone = '', email = '' } = req.body;
  try {
    await pool.query(
      `UPDATE license SET distributor_name=$1, distributor_contact_name=$2, distributor_phone=$3, distributor_email=$4
       WHERE is_active = TRUE`,
      [name, contactName, phone, email]
    );
    res.json({ success: true });
  } catch (e) {
    logError('[license/distributor]', e);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /activate ────────────────────────────────────────────────────────────
router.post('/activate', async (req, res) => {
  const { key } = req.body;
  if (!key) return res.status(400).json({ error: 'License key is required' });

  const parsed = parseLicenseKey(key.trim());
  if (!parsed) return res.status(400).json({ error: 'Invalid or tampered license key' });

  const { payload } = parsed;
  const now         = new Date();
  const activatedAt = now;

  // Compute effective expiry based on format
  const expires = computeExpiry(payload, activatedAt);

  // Check expiry only for non-lifetime licenses
  if (expires && expires !== '2099-12-31' && new Date(expires) < now) {
    return res.status(400).json({ error: `License expired on ${expires}` });
  }

  // Store resolved expiry back into payload so /status always reads it
  const storedPayload = { ...payload, expires };

  try {
    await pool.query(`UPDATE license SET is_active = FALSE WHERE is_active = TRUE`);
    await pool.query(`
      INSERT INTO license (license_id, key_raw, payload, is_active)
      VALUES ($1, $2, $3, TRUE)
      ON CONFLICT (license_id) DO UPDATE
        SET key_raw = EXCLUDED.key_raw, payload = EXCLUDED.payload,
            activated_at = NOW(), is_active = TRUE
    `, [payload.id, key.trim(), JSON.stringify(storedPayload)]);

    res.json({
      success     : true,
      message     : 'License activated successfully',
      client      : payload.client,
      expires,
      type        : payload.type,
      durationDays: payload.duration_days ?? null,
      maxUsers    : payload.maxUsers   ?? 25,
      maxStaff    : payload.maxStaff   ?? 25,
      features    : payload.features || [],
    });
  } catch (e) {
    logError('[license/activate]', e);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /dealer-activate ─────────────────────────────────────────────────────
// Lets an authorized dealer activate this installation directly — no manual
// key-pasting. Credentials are checked against the local `dealers` table
// (seeded by migration v29); on success a fresh annual license is generated
// and self-signed with the same SECRET used to verify pasted keys, then
// activated immediately.
router.post('/dealer-activate', async (req, res) => {
  const { dealerName, username, password } = req.body;
  if (!dealerName?.trim() || !username?.trim() || !password) {
    return res.status(400).json({ error: 'Dealer name, username and password are all required' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT * FROM dealers WHERE username = $1 AND active = TRUE`,
      [username.trim()]
    );
    const dealer = rows[0];
    if (!dealer || dealer.name.trim().toLowerCase() !== dealerName.trim().toLowerCase()) {
      return res.status(401).json({ error: 'Invalid dealer name, username or password' });
    }
    const passwordOk = await bcrypt.compare(password, dealer.password);
    if (!passwordOk) {
      return res.status(401).json({ error: 'Invalid dealer name, username or password' });
    }

    // License is issued to this installation's own company name (Settings → General)
    const { rows: settingsRows } = await pool.query(
      `SELECT value FROM app_settings WHERE key = 'main'`
    );
    const main = settingsRows[0]?.value || {};
    const clientName = (main.companyNameEn || main.companyNameNp || '').trim() || 'Licensed Customer';

    const issuedAt = new Date();
    const expires  = new Date(issuedAt);
    expires.setFullYear(expires.getFullYear() + 1);
    const toISODate = (d) => d.toISOString().slice(0, 10);

    const payload = {
      id      : crypto.randomUUID(),
      client  : clientName,
      contact : dealer.name,
      email   : '',
      phone   : '',
      type    : 'annual',
      expires : toISODate(expires),
      maxUsers: 50,
      maxStaff: 100,
      features: ['Attendance', 'Leave Management', 'Office Visit', 'Reports', 'Half Monthly',
                 'Monthly', 'Yearly', 'ZKTeco Integration', 'Advance Search', 'Export'],
      issuedAt: toISODate(issuedAt),
      version : 2,
    };
    const key = signLicenseKey(payload);

    await pool.query(`UPDATE license SET is_active = FALSE WHERE is_active = TRUE`);
    await pool.query(`
      INSERT INTO license (license_id, key_raw, payload, is_active, distributor_name)
      VALUES ($1, $2, $3, TRUE, $4)
      ON CONFLICT (license_id) DO UPDATE
        SET key_raw = EXCLUDED.key_raw, payload = EXCLUDED.payload,
            activated_at = NOW(), is_active = TRUE, distributor_name = EXCLUDED.distributor_name
    `, [payload.id, key, JSON.stringify(payload), dealer.name]);

    res.json({
      success : true,
      message : 'License activated via dealer authorization',
      client  : payload.client,
      expires : payload.expires,
      type    : payload.type,
      maxUsers: payload.maxUsers,
      features: payload.features,
    });
  } catch (e) {
    logError('[license/dealer-activate]', e);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /deactivate ──────────────────────────────────────────────────────────
router.post('/deactivate', async (_req, res) => {
  try {
    await pool.query(`UPDATE license SET is_active = FALSE WHERE is_active = TRUE`);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
