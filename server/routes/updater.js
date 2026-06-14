/**
 * eHajiri Auto-Updater
 * GET  /api/update/check   — compare local vs remote version
 * GET  /api/update/status  — polling endpoint during update
 * POST /api/update/apply   — download → backup → extract → migrate → restart
 */
import { Router }           from 'express';
import https                from 'https';
import http                 from 'http';
import fs                   from 'fs';
import path                 from 'path';
import { createHash }       from 'crypto';
import { fileURLToPath }    from 'url';
import { APP_VERSION }      from '../version.js';
import { runMigrations }    from '../migrations/runner.js';
import pool                 from '../db.js';
import { logError }         from '../utils/logError.js';

const router  = Router();
const __dir   = path.dirname(fileURLToPath(import.meta.url));
const ROOT    = path.resolve(__dir, '../../');          // project root (d:\ClaudeAi\ehajiri)
const TMP_ZIP = path.join(ROOT, '_update_download.zip');

/* ── Update server URL — set UPDATE_SERVER_URL in .env ── */
const UPDATE_BASE = (process.env.UPDATE_SERVER_URL || 'https://updates.ehajiri.com').replace(/\/$/, '');

/* ── In-memory status (polled by frontend) ── */
let status = { state: 'idle', progress: 0, message: 'Ready', error: null };

/* ── Helpers ── */
const semverGt = (remote, local) => {
  const r = remote.split('.').map(Number);
  const l = local.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((r[i] || 0) > (l[i] || 0)) return true;
    if ((r[i] || 0) < (l[i] || 0)) return false;
  }
  return false;
};

const fetchJson = (url) => new Promise((resolve, reject) => {
  const mod = url.startsWith('https') ? https : http;
  mod.get(url, { timeout: 8000 }, (res) => {
    if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
    let body = '';
    res.on('data', d => body += d);
    res.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid JSON')); } });
  }).on('error', reject).on('timeout', () => reject(new Error('Request timed out')));
});

const downloadFile = (url, dest) => new Promise((resolve, reject) => {
  const mod = url.startsWith('https') ? https : http;
  const out = fs.createWriteStream(dest);
  mod.get(url, (res) => {
    const total = parseInt(res.headers['content-length'] || '0');
    let received = 0;
    res.on('data', chunk => {
      received += chunk.length;
      if (total > 0) {
        status.progress = 30 + Math.floor((received / total) * 30); // 30–60%
        status.message  = `Downloading… ${Math.round(received/1024)}KB / ${Math.round(total/1024)}KB`;
      }
    });
    res.pipe(out);
    out.on('finish', () => out.close(resolve));
  }).on('error', err => { fs.unlink(dest, () => {}); reject(err); });
});

const sha256 = (filePath) => {
  const h = createHash('sha256');
  h.update(fs.readFileSync(filePath));
  return h.digest('hex');
};

/* ── Full JSON backup before update ── */
const backupDatabase = async () => {
  const tables = [
    'users','shifts','leave_types','leave_balances','leaves','office_visits',
    'fiscal_years','branches','departments','posts','grades',
    'employment_modes','religions','employee_statuses','job_timings',
    'weekend_history','app_settings',
  ];
  const data = {};
  for (const t of tables) {
    try { data[t] = (await pool.query(`SELECT * FROM ${t}`)).rows; } catch { data[t] = []; }
  }
  const file = path.join(ROOT, `backup_pre_update_${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify({ meta: { appVersion: APP_VERSION, exportedAt: new Date().toISOString() }, data }, null, 2));
  return file;
};

/* ── Extract ZIP (uses built-in unzip via PowerShell on Windows or unzip on Linux) ── */
const extractZip = async (zipPath, destDir) => {
  const { execSync } = await import('child_process');
  if (fs.existsSync(destDir)) fs.rmSync(destDir, { recursive: true });
  fs.mkdirSync(destDir, { recursive: true });
  if (process.platform === 'win32') {
    execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`, { stdio: 'inherit' });
  } else {
    execSync(`unzip -o "${zipPath}" -d "${destDir}"`, { stdio: 'inherit' });
  }
};

/* ── Copy extracted files over the current install ── */
const applyExtractedFiles = (srcDir) => {
  const { execSync } = require('child_process');
  // Copy server/ and dist/ from extracted package to current root
  const dirs = ['server', 'dist', 'package.json'];
  for (const d of dirs) {
    const src = path.join(srcDir, d);
    const dst = path.join(ROOT, d);
    if (!fs.existsSync(src)) continue;
    if (process.platform === 'win32') {
      if (fs.statSync(src).isDirectory()) {
        execSync(`xcopy /E /I /Y "${src}" "${dst}"`, { stdio: 'inherit' });
      } else {
        fs.copyFileSync(src, dst);
      }
    } else {
      execSync(`cp -r "${src}" "${dst}"`, { stdio: 'inherit' });
    }
  }
};

/* ════════════════════════════════════════════════════════
   GET /api/update/check
════════════════════════════════════════════════════════ */
router.get('/check', async (_req, res) => {
  try {
    const remote = await fetchJson(`${UPDATE_BASE}/version.json`);
    const updateAvailable = semverGt(remote.version, APP_VERSION);
    res.json({
      current         : APP_VERSION,
      latest          : remote.version,
      updateAvailable,
      releaseDate     : remote.releaseDate || '',
      changelog       : remote.changelog   || [],
      downloadUrl     : remote.downloadUrl || '',
      checksum        : remote.checksum    || '',
      minVersion      : remote.minVersion  || '1.0.0',
    });
  } catch (e) {
    res.json({ current: APP_VERSION, updateAvailable: false, error: e.message });
  }
});

/* ════════════════════════════════════════════════════════
   GET /api/update/status  (frontend polls this)
════════════════════════════════════════════════════════ */
router.get('/status', (_req, res) => {
  res.json({ ...status, current: APP_VERSION });
});

/* ════════════════════════════════════════════════════════
   POST /api/update/apply
   Body: { downloadUrl, checksum, version }
════════════════════════════════════════════════════════ */
router.post('/apply', async (req, res) => {
  if (status.state !== 'idle' && status.state !== 'error') {
    return res.status(409).json({ error: 'Update already in progress' });
  }
  const { downloadUrl, checksum, version } = req.body;
  if (!downloadUrl || !version) return res.status(400).json({ error: 'Missing downloadUrl or version' });

  // Respond immediately so the frontend gets the 200 before server restarts
  res.json({ success: true, message: 'Update started — poll /api/update/status' });

  const EXTRACT_DIR = path.join(ROOT, '_update_extracted');

  ;(async () => {
    try {
      /* 1 — Backup ─────────────────────────────────── */
      status = { state: 'backup', progress: 10, message: 'Creating database backup…', error: null };
      const backupFile = await backupDatabase();
      console.log('[updater] Backup saved:', backupFile);

      /* 2 — Download ───────────────────────────────── */
      status = { state: 'downloading', progress: 30, message: 'Downloading update package…', error: null };
      if (fs.existsSync(TMP_ZIP)) fs.unlinkSync(TMP_ZIP);
      await downloadFile(downloadUrl, TMP_ZIP);

      /* 3 — Verify checksum ────────────────────────── */
      if (checksum) {
        status = { state: 'verifying', progress: 62, message: 'Verifying package integrity…', error: null };
        const computed = sha256(TMP_ZIP);
        if (computed !== checksum) throw new Error(`Checksum mismatch. Expected ${checksum}, got ${computed}`);
      }

      /* 4 — Extract ────────────────────────────────── */
      status = { state: 'extracting', progress: 70, message: 'Extracting files…', error: null };
      await extractZip(TMP_ZIP, EXTRACT_DIR);

      /* 5 — Apply files ────────────────────────────── */
      status = { state: 'applying', progress: 80, message: 'Replacing application files…', error: null };
      applyExtractedFiles(EXTRACT_DIR);

      /* 6 — Run new migrations ─────────────────────── */
      status = { state: 'migrating', progress: 88, message: 'Applying database migrations…', error: null };
      await runMigrations();

      /* 7 — Cleanup & restart ──────────────────────── */
      status = { state: 'restarting', progress: 100, message: 'Restarting server… please wait 10 seconds.', error: null };
      if (fs.existsSync(TMP_ZIP))    fs.unlinkSync(TMP_ZIP);
      if (fs.existsSync(EXTRACT_DIR)) fs.rmSync(EXTRACT_DIR, { recursive: true });
      console.log('[updater] Update complete — restarting process');
      setTimeout(() => process.exit(0), 1500); // NSSM/service watchdog restarts it

    } catch (e) {
      logError('[updater] FAILED:', e);
      status = { state: 'error', progress: 0, message: e.message, error: e.message };
      if (fs.existsSync(TMP_ZIP)) fs.unlinkSync(TMP_ZIP);
    }
  })();
});

export default router;
