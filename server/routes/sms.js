import { Router } from 'express';
import { sendSms } from '../services/smsService.js';

const router = Router();

// Any authenticated staff member can send an SMS via the configured gateway
// (same permission level as WhatsApp's click-to-chat buttons elsewhere in
// the app) — the admin-only config CRUD/test lives in routes/smsConfig.js.
router.post('/send', async (req, res) => {
  const { to, text } = req.body;
  if (!to || !text) return res.status(400).json({ error: 'Recipient phone number and message text are required' });
  try {
    const result = await sendSms({ to, text });
    if (result.skipped) return res.status(503).json({ error: 'SMS Gateway is not configured or is disabled — ask an admin to set it up in Settings → SMS Gateway.', skipped: true });
    res.json({ ok: true, result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
