import { Router } from 'express';
import pool from '../db.js';
import { getSchemaVersion } from '../migrator.js';

const router = Router();

// GET /api/app-info  — returns version, db_version, developer info
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT key, value FROM app_info');
    const info = {};
    rows.forEach(r => { info[r.key] = r.value; });
    info.db_version = String(await getSchemaVersion());
    res.json(info);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
