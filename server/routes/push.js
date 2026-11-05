import { Router } from 'express';
import pool from '../db.js';
import { pushEnabled } from '../services/pushService.js';

/* Mobile-app device registration. The app registers its Firebase token after login and removes it on logout.
   A token belongs to whoever registered it last (a shared phone changes hands), at most 10 devices per user. */
const router = Router();
const MAX_DEVICES = 10;

router.post('/register', async (req, res) => {
  const token = String(req.body?.token || '').trim();
  const platform = req.body?.platform === 'ios' ? 'ios' : 'android';
  if (token.length < 20 || token.length > 4096) return res.status(400).json({ error: 'A valid device token is required.' });
  try {
    await pool.query(
      `INSERT INTO push_devices (user_id, token, platform, device_name, app_version, active, last_seen) VALUES ($1,$2,$3,$4,$5,TRUE,NOW())
       ON CONFLICT (token) DO UPDATE SET user_id=EXCLUDED.user_id, platform=EXCLUDED.platform, device_name=EXCLUDED.device_name, app_version=EXCLUDED.app_version, active=TRUE, last_seen=NOW()`,
      [req.user.id, token, platform, String(req.body?.deviceName || '').slice(0, 80), String(req.body?.appVersion || '').slice(0, 20)]);
    await pool.query(
      `DELETE FROM push_devices WHERE user_id=$1 AND id NOT IN (SELECT id FROM push_devices WHERE user_id=$1 ORDER BY last_seen DESC LIMIT $2)`, [req.user.id, MAX_DEVICES]);
    res.json({ ok: true, pushEnabled: pushEnabled() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/unregister', async (req, res) => {
  try {
    await pool.query('DELETE FROM push_devices WHERE token=$1 AND user_id=$2', [String(req.body?.token || ''), req.user.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/status', async (req, res) => {
  try {
    const { rows: [r] } = await pool.query('SELECT COUNT(*)::int AS n FROM push_devices WHERE user_id=$1 AND active', [req.user.id]);
    res.json({ enabled: pushEnabled(), devices: r.n });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
