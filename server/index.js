import express from 'express';
import cors    from 'cors';
import dotenv  from 'dotenv';
import fs      from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join }  from 'path';

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '.env') });

import { runMigrations }  from './migrations/runner.js';
import { APP_VERSION, DB_VERSION } from './version.js';
import { logError } from './utils/logError.js';
import { ensureAuditLogTable } from './services/auditLog.js';
import { ensureRemarksTable } from './routes/attendance.js';
import { ensureLicenseTable } from './routes/license.js';

import authRouter      from './routes/auth.js';
import employeesRouter from './routes/employees.js';
import shiftsRouter    from './routes/shifts.js';
import leavesRouter    from './routes/leaves.js';
import visitsRouter    from './routes/visits.js';
import settingsRouter  from './routes/settings.js';
import backupRouter    from './routes/backup.js';
import zktecoRouter    from './routes/zkteco.js';
import zktecoApiRouter from './routes/zktecoApi.js';
import attendanceRouter from './routes/attendance.js';
import licenseRouter    from './routes/license.js';
import updaterRouter    from './routes/updater.js';
import overtimeRouter   from './routes/overtime.js';
import dutyRosterRouter from './routes/dutyRoster.js';
import auditLogRouter   from './routes/auditLog.js';
import staffNotesRouter  from './routes/staffNotes.js';
import contactsRouter    from './routes/contacts.js';
import messagesRouter    from './routes/messages.js';
import emailConfigRouter from './routes/emailConfig.js';
import aiAnalysisRouter  from './routes/aiAnalysis.js';
import { licenseGuard } from './middleware/licenseGuard.js';
import { authGuard }    from './middleware/authGuard.js';
import { requireRole }  from './middleware/roleGuard.js';

const app  = express();
const PORT = parseInt(process.env.PORT || '5000');

/* ── Middleware ── */
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));

/* ── Routes ── */
// License & auth routes are exempt from licenseGuard
app.use('/api/license',   licenseRouter);
app.use('/api/auth',      authRouter);          // auth/login does its own license check

// All other routes require a valid active license AND an authenticated user
app.use('/api/employees', licenseGuard, authGuard, employeesRouter);
app.use('/api/shifts',    licenseGuard, authGuard, shiftsRouter);
app.use('/api/leaves',    licenseGuard, authGuard, leavesRouter);
app.use('/api/visits',    licenseGuard, authGuard, visitsRouter);
app.use('/api/settings',  licenseGuard, authGuard, requireRole('admin', 'superAdmin'), settingsRouter);
app.use('/api/backup',    licenseGuard, authGuard, requireRole('admin', 'superAdmin'), backupRouter);
app.use('/api/zkteco',    licenseGuard, authGuard, zktecoApiRouter);
app.use('/api/attendance',licenseGuard, authGuard, attendanceRouter);
app.use('/api/overtime',    licenseGuard, authGuard, overtimeRouter);
app.use('/api/duty-roster', licenseGuard, authGuard, dutyRosterRouter);
app.use('/api/audit-log',   licenseGuard, authGuard, requireRole('superAdmin'), auditLogRouter);
app.use('/api/staff-notes',  licenseGuard, authGuard, staffNotesRouter);
app.use('/api/contacts',     licenseGuard, authGuard, contactsRouter);
app.use('/api/messages',     licenseGuard, authGuard, messagesRouter);
app.use('/api/email-config', licenseGuard, authGuard, requireRole('admin', 'superAdmin'), emailConfigRouter);
app.use('/api/ai',          licenseGuard, authGuard, aiAnalysisRouter);
// ZKTeco ADMS push protocol — devices POST attendance to /iclock/*
app.use('/iclock',         zktecoRouter);

/* ── Health check ── */
app.get('/api/health', (_req, res) =>
  res.json({ status: 'ok', appVersion: APP_VERSION, dbVersion: DB_VERSION, time: new Date().toISOString() })
);

/* ── Mobile app downloads (Settings → License page) ── */
const DOWNLOADS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'downloads');
const ANDROID_APK   = join(DOWNLOADS_DIR, 'ehajiri-tms.apk');
fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

app.get('/api/downloads/android-apk', (_req, res) => {
  if (!fs.existsSync(ANDROID_APK))
    return res.status(404).json({ error: 'Android APK is not available yet. Build it with `eas build --platform android --profile preview` and place the file at server/downloads/ehajiri-tms.apk.' });
  res.download(ANDROID_APK, 'eHajiri-TMS.apk');
});

/* ── Auto-updater (admin only — no licenseGuard so it works during update) ── */
app.use('/api/update', updaterRouter);

/* ── Serve Vite production build (production mode only) ── */
const DIST = join(dirname(fileURLToPath(import.meta.url)), '../dist');
if (process.env.NODE_ENV === 'production' && fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api') && !req.path.startsWith('/iclock'))
      res.sendFile(join(DIST, 'index.html'));
  });
}

/* ── Boot ── */
(async () => {
  try {
    console.log('🚀 eHajiri TMS — API Server starting...');
    await runMigrations();

    // These create their own tables (audit_log, attendance_remarks, license) and
    // must run AFTER runMigrations() — it's what creates the base `users` table
    // they reference. Running them at module-import time (their old behavior)
    // raced migrations and could log a spurious one-time "relation \"users\"
    // does not exist" on a brand-new database's first boot.
    await ensureAuditLogTable();
    await ensureRemarksTable();
    await ensureLicenseTable();

    app.listen(PORT, () => {
      console.log(`✅ Server running  →  http://localhost:${PORT}/api`);
      console.log(`   App ${APP_VERSION}  |  DB schema v${DB_VERSION}`);
    });
  } catch (err) {
    logError('❌ Server failed to start:', err);
    process.exit(1);
  }
})();
