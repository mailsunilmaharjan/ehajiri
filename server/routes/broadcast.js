import { Router } from 'express';

// Announcements broadcast from LicenseAdmin → Message Broadcasting (audience "eHajiri Web application").
// Fetched server-side (reuses the LICENSE_ADMIN_URL this process already has) and cached briefly, so the
// browser never talks to LicenseAdmin directly and a LicenseAdmin outage just means "no announcements".
const router = Router();
const TTL_MS = 60 * 1000;
let cache = { at: 0, rows: [] };

router.get('/', async (_req, res) => {
  const url = process.env.LICENSE_ADMIN_URL;
  if (!url) return res.json([]);
  if (Date.now() - cache.at < TTL_MS) return res.json(cache.rows);
  try {
    const resp = await fetch(`${url}/api/broadcasts/public?app=web`, { signal: AbortSignal.timeout(4000) });
    if (resp.ok) {
      const rows = await resp.json();
      cache = { at: Date.now(), rows: Array.isArray(rows) ? rows : [] };
    }
  } catch { /* keep the last good copy */ }
  res.json(cache.rows);
});

export default router;
