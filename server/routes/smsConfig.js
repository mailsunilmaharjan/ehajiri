import { Router } from 'express';
import pool from '../db.js';
import { sendTestSms } from '../services/smsService.js';

const router = Router();

const KEY = 'smsConfig';

/* GET /api/sms-config */
router.get('/', async (_req, res) => {
  try {
    const { rows } = await pool.query("SELECT value FROM app_settings WHERE key=$1", [KEY]);
    if (!rows.length) return res.json(null);
    const cfg = typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value;
    // Mask password in response
    if (cfg?.password) cfg.password = '••••••••';
    res.json(cfg);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* PUT /api/sms-config */
router.put('/', async (req, res) => {
  const incoming = req.body;
  try {
    // If password is the mask, keep the existing one
    if (incoming.password === '••••••••') {
      const { rows } = await pool.query("SELECT value FROM app_settings WHERE key=$1", [KEY]);
      const existing = rows.length ? (typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value) : {};
      incoming.password = existing?.password || '';
    }
    await pool.query(
      `INSERT INTO app_settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()`,
      [KEY, JSON.stringify(incoming)]
    );
    const out = { ...incoming };
    if (out.password) out.password = '••••••••';
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* POST /api/sms-config/test */
router.post('/test', async (req, res) => {
  const { config, testTo } = req.body;
  if (!testTo) return res.status(400).json({ error: 'Test recipient phone number is required' });
  try {
    // If password is masked, load real one from DB
    let cfg = { ...config };
    if (cfg.password === '••••••••') {
      const { rows } = await pool.query("SELECT value FROM app_settings WHERE key=$1", [KEY]);
      const existing = rows.length ? (typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value) : {};
      cfg.password = existing?.password || '';
    }
    const result = await sendTestSms(cfg, testTo);
    res.json({ ok: true, result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
