import express from 'express';
import cors    from 'cors';
import dotenv  from 'dotenv';
import fs      from 'fs';
import https   from 'https';
import { fileURLToPath } from 'url';
import { dirname, join }  from 'path';

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '.env') });

import pool from './db.js';
import { runMigrations }  from './migrations/runner.js';
import { APP_VERSION, DB_VERSION } from './version.js';
import { logError } from './utils/logError.js';
import { ensureAuditLogTable } from './services/auditLog.js';
import { ensureRemarksTable } from './routes/attendance.js';
import { ensureLicenseTable } from './routes/license.js';
import { startStandaloneBridge, stopStandaloneBridge } from './services/standaloneBridgeLauncher.js';
import { startStandaloneScheduler, stopStandaloneScheduler } from './services/standaloneScheduler.js';
import { startAttendanceNotificationScheduler, stopAttendanceNotificationScheduler } from './services/attendanceNotificationScheduler.js';
import { startBirthdayNotificationScheduler, stopBirthdayNotificationScheduler } from './services/birthdayNotificationScheduler.js';
import { requireModuleEnabled } from './middleware/moduleGuard.js';
import { getModuleFlags, FLAG_KEYS } from './utils/moduleFlags.js';

import authRouter      from './routes/auth.js';
import employeesRouter from './routes/employees.js';
import shiftsRouter    from './routes/shifts.js';
import leavesRouter    from './routes/leaves.js';
import visitsRouter    from './routes/visits.js';
import settingsRouter  from './routes/settings.js';
import backupRouter    from './routes/backup.js';
import zktecoRouter    from './routes/zkteco.js';
import zktecoApiRouter, { enforceAccessValidity } from './routes/zktecoApi.js';
import standaloneDevicesRouter from './routes/standaloneDevices.js';
import standaloneSyncRouter    from './routes/standaloneSync.js';
import attendanceRouter from './routes/attendance.js';
import licenseRouter    from './routes/license.js';
import updaterRouter    from './routes/updater.js';
import overtimeRouter   from './routes/overtime.js';
import dutyRosterRouter from './routes/dutyRoster.js';
import auditLogRouter   from './routes/auditLog.js';
import staffNotesRouter  from './routes/staffNotes.js';
import contactsRouter    from './routes/contacts.js';
import eventsRouter       from './routes/events.js';
import onlineAttendanceRouter from './routes/onlineAttendance.js';
import guestCheckinRouter from './routes/guestCheckin.js';
import tasksRouter        from './routes/tasks.js';
import mobileReleaseRouter from './routes/mobileRelease.js';
import fieldVisitRouter  from './routes/fieldVisit.js';
import messagesRouter    from './routes/messages.js';
import chatRouter        from './routes/chat.js';
import emailConfigRouter from './routes/emailConfig.js';
import smsConfigRouter   from './routes/smsConfig.js';
import smsRouter         from './routes/sms.js';
import aiAnalysisRouter  from './routes/aiAnalysis.js';
import supportLiveRouter from './routes/supportLive.js';
import payrollRouter from './routes/payroll.js';
import payrollRunsRouter from './routes/payrollRuns.js';
import payrollScalesRouter from './routes/payrollScales.js';
import pushRouter from './routes/push.js';
import recoApprovalRouter from './routes/recoApproval.js';
import coverageRouter    from './routes/coverage.js';
import staffAnalyticsRouter from './routes/staffAnalytics.js';
import bugReportsRouter  from './routes/bugReports.js';
import broadcastRouter   from './routes/broadcast.js';
import { logBugReport }  from './services/bugReportService.js';
import { licenseGuard } from './middleware/licenseGuard.js';
import { authGuard }    from './middleware/authGuard.js';
import { securityHeaders, corsOptions, pickJsonLimit, rateLimit } from './middleware/security.js';
import { bodySanity } from './middleware/validate.js';
import { requireRole }  from './middleware/roleGuard.js';
import { standaloneSyncTokenGuard } from './middleware/standaloneSyncTokenGuard.js';
import { mountTenantPathProxy } from './middleware/tenantPathProxy.js';
import * as routingCache from './services/routingCache.js';

const app  = express();
const PORT = parseInt(process.env.PORT || '5000');

// Shared-login hub only (attend.zkattendance.com/t/<subdomain>/...) — routes
// a browser to a DIFFERENT tenant's own process without any subdomain DNS,
// which was never actually set up. Mounted before cors()/express.json() so
// proxied request bodies (a staff-list import, a raw DB-dump upload) stream
// through untouched instead of being consumed/parsed here first.
if (process.env.ENABLE_TENANT_RESOLVE === 'true') {
  mountTenantPathProxy(app);
}

// Optional TLS — server/certs/{cert,key}.pem, generated locally via
// server/scripts/generate-cert.js (self-signed, for a bare-IP VPS) or dropped
// in from a real CA/Let's Encrypt once a domain points here. Absent by
// default (dev, or the packaged desktop app, never needs this).
const CERT_DIR   = join(dirname(fileURLToPath(import.meta.url)), 'certs');
const CERT_PATH  = join(CERT_DIR, 'cert.pem');
const KEY_PATH   = join(CERT_DIR, 'key.pem');
const HTTPS_PORT = parseInt(process.env.HTTPS_PORT || '443');
const hasTls     = fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH);

/* ── Middleware ── */
app.disable('x-powered-by');
app.use(securityHeaders);
app.use(cors(corsOptions()));
// Small cap on unauthenticated surfaces (auth/license/guest/bug-report), the
// large cap only where authenticated uploads (photos, imports, restore) need it.
const jsonSmall = express.json({ limit: '1mb' });
const jsonLarge = express.json({ limit: '50mb' });
app.use((req, res, next) => (pickJsonLimit(req) === '50mb' ? jsonLarge : jsonSmall)(req, res, next));

app.use('/api', bodySanity);

/* ── Bug Finder — auto-capture every 5xx response, regardless of which route
   produced it. Every route handler in this codebase catches its own errors
   and replies with res.status(500).json({error}), so a res.json monkey-patch
   here sees them all without touching a single route file. ── */
app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 500) {
      logBugReport({
        source    : 'backend',
        page      : req.originalUrl,
        method    : req.method,
        statusCode: res.statusCode,
        message   : body?.error || body?.message || 'Unknown server error',
        userId    : req.user?.id || null,
      }).catch(() => {});
    }
    return originalJson(body);
  };
  next();
});

/* ── Routes ── */
// License & auth routes are exempt from licenseGuard
app.use('/api/license',   licenseRouter);
app.use('/api/auth',      authRouter);          // auth/login does its own license check
// Not gated by authGuard — POST must work even without a valid session
// (a crash can happen before login); GET/PUT/DELETE guard themselves inside.
app.use('/api/bug-reports', licenseGuard, bugReportsRouter);
// Public "scan the QR, check yourself in" flow — no eHajiri login on the
// guest's own phone at all. Every route requires a valid signed token
// (guestCheckin.js's own verifyToken) instead of authGuard; still behind
// licenseGuard so it stops working the moment a tenant's license lapses.
app.use('/api/guest-checkin', licenseGuard, guestCheckinRouter);

// All other routes require a valid active license AND an authenticated user
app.use('/api/broadcast', licenseGuard, authGuard, broadcastRouter);
app.use('/api/employees', licenseGuard, authGuard, employeesRouter);
app.use('/api/shifts',    licenseGuard, authGuard, shiftsRouter);
app.use('/api/leaves',    licenseGuard, authGuard, leavesRouter);
app.use('/api/visits',    licenseGuard, authGuard, visitsRouter);
// Read access (GET) is open to any authenticated role — employees need their
// org's calendar/date-format/company settings to render their own dashboard.
// Mutating routes are gated to admin/superAdmin inside settingsRouter itself.
app.use('/api/settings',  licenseGuard, authGuard, settingsRouter);
app.use('/api/backup',    licenseGuard, authGuard, requireRole('admin', 'superAdmin'), backupRouter);
// Both gated to admin/superAdmin only — matches the Role Management permission
// matrix (attendanceDevice/standaloneDevice pages are hardcoded adminOnly there)
// — plus the global on/off flag, which an admin/superAdmin controls in Settings.
app.use('/api/zkteco',    licenseGuard, authGuard, requireRole('admin', 'superAdmin'), requireModuleEnabled(FLAG_KEYS.attendanceDevice, 'Attendance Device'), zktecoApiRouter);
app.use('/api/standalone',licenseGuard, authGuard, requireRole('admin', 'superAdmin'), requireModuleEnabled(FLAG_KEYS.standaloneDevice, 'StandAlone Device'), standaloneDevicesRouter);
// Remote sync agent ingestion — an unattended process with no logged-in user,
// so it authenticates with a per-device token (standaloneSyncTokenGuard)
// instead of authGuard/requireRole. See routes/standaloneSync.js.
app.use('/api/standalone-sync', licenseGuard, rateLimit({ windowMs: 60_000, max: 120 }), requireModuleEnabled(FLAG_KEYS.standaloneDevice, 'StandAlone Device'), standaloneSyncTokenGuard, standaloneSyncRouter);
app.use('/api/attendance',licenseGuard, authGuard, attendanceRouter);
app.use('/api/overtime',    licenseGuard, authGuard, overtimeRouter);
app.use('/api/duty-roster', licenseGuard, authGuard, requireModuleEnabled(FLAG_KEYS.dutyRoster, 'Duty Roster'), dutyRosterRouter);
app.use('/api/audit-log',   licenseGuard, authGuard, requireRole('superAdmin'), auditLogRouter);
app.use('/api/staff-notes',  licenseGuard, authGuard, staffNotesRouter);
app.use('/api/contacts',     licenseGuard, authGuard, contactsRouter);
app.use('/api/events',       licenseGuard, authGuard, requireModuleEnabled(FLAG_KEYS.guestRegistration, 'Guest Registration'), eventsRouter);
app.use('/api/online-attendance', licenseGuard, authGuard, requireModuleEnabled(FLAG_KEYS.onlineAttendance, 'Online Attendance'), onlineAttendanceRouter);
app.use('/api/tasks',        licenseGuard, authGuard, requireModuleEnabled(FLAG_KEYS.task, 'Task'), tasksRouter);
app.use('/api/field-visit',  licenseGuard, authGuard, requireModuleEnabled(FLAG_KEYS.task, 'Task'), fieldVisitRouter);
app.use('/api/messages',     licenseGuard, authGuard, messagesRouter);
app.use('/api/chat',         licenseGuard, authGuard, requireModuleEnabled(FLAG_KEYS.chat, 'Chat'), chatRouter);
// requireRole allows admin+superAdmin (the API itself is fine with either),
// but the module flag is Super-Admin-only to flip (see RoleManagement.jsx) —
// so in practice this stays 503 for everyone until a Super Admin enables it.
app.use('/api/email-config', licenseGuard, authGuard, requireRole('admin', 'superAdmin'), requireModuleEnabled(FLAG_KEYS.emailSetup, 'Email Setup'), emailConfigRouter);
// Admin-only config CRUD/test vs. the plain-staff send endpoint below —
// same split as WhatsApp's click-to-chat buttons (anyone can trigger a
// send; only admin/superAdmin can set up the gateway itself).
app.use('/api/sms-config',  licenseGuard, authGuard, requireRole('admin', 'superAdmin'), requireModuleEnabled(FLAG_KEYS.smsGateway, 'SMS Gateway'), smsConfigRouter);
app.use('/api/sms',         licenseGuard, authGuard, requireModuleEnabled(FLAG_KEYS.smsGateway, 'SMS Gateway'), smsRouter);
app.use('/api/ai',          licenseGuard, authGuard, aiAnalysisRouter);
app.use('/api/support-live', licenseGuard, authGuard, supportLiveRouter);
app.use('/api/payroll', licenseGuard, authGuard, payrollRouter);
app.use('/api/payroll', licenseGuard, authGuard, payrollRunsRouter);
app.use('/api/payroll', licenseGuard, authGuard, payrollScalesRouter);
app.use('/api/push', licenseGuard, authGuard, pushRouter);
app.use('/api/reco-approval', licenseGuard, authGuard, recoApprovalRouter);
app.use('/api/coverage', licenseGuard, authGuard, coverageRouter);
app.use('/api/staff-analytics', licenseGuard, authGuard, staffAnalyticsRouter);
// ZKTeco ADMS push protocol — devices POST attendance to /iclock/*
app.use('/iclock',         requireModuleEnabled(FLAG_KEYS.attendanceDevice, 'Attendance Device'), zktecoRouter);

/* ── Health check — also carries live DB schema info (no auth: the Electron
   tray monitor polls this to show version + last-migrated date without a
   login session) ── */
app.use('/api/mobile', mobileReleaseRouter);   // public: the phone app's update check + APK download
app.get('/api/health', async (_req, res) => {
  let dbApplied = null, dbAppliedAt = null;
  try {
    const { rows } = await pool.query(
      'SELECT version, applied_at FROM app_schema_version ORDER BY version DESC LIMIT 1'
    );
    dbApplied   = rows[0]?.version ?? null;
    dbAppliedAt = rows[0]?.applied_at ?? null;
  } catch { /* DB not reachable yet — still report app version */ }

  res.json({
    status: 'ok',
    appVersion: APP_VERSION,
    dbVersion: DB_VERSION,
    dbApplied,
    dbAppliedAt,
    tenantId: process.env.TENANT_ID || null,
    time: new Date().toISOString(),
  });
});

/* ── Module flags — every logged-in role can read these (to show/hide tab
   content), but only admin/superAdmin can write them via PUT /api/settings ── */
app.get('/api/module-flags', licenseGuard, authGuard, async (_req, res) => {
  try { res.json(await getModuleFlags()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

/* ── Mobile app downloads (Settings → License page) ──
 * Hosted on a separate public GitHub repo instead of bundled in the desktop
 * installer — the APK is ~100MB and shipping it inside every eHajiri.exe
 * would bloat every install and every auto-update delta. */
const ANDROID_APK_URL = 'https://github.com/mailsunilmaharjan/ehajiri-mobile-releases/releases/latest/download/eHajiri-TMS.apk';

app.get('/api/downloads/android-apk', (_req, res) => {
  res.redirect(ANDROID_APK_URL);
});

/* ── Auto-updater (admin only — no licenseGuard so it works during update) ── */
app.use('/api/update', updaterRouter);

/* ── Serve Vite production build (production mode only) ── */
const DIST = join(dirname(fileURLToPath(import.meta.url)), '../dist');
if (process.env.NODE_ENV === 'production' && fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api') && !req.path.startsWith('/iclock')) {
      return res.sendFile(join(DIST, 'index.html'));
    }
    // An /api or /iclock path that fell through every route above has no
    // handler — without an explicit reply here, Express never sends a
    // response at all and the client hangs forever (looks like an infinite
    // "Loading…" instead of a clean 404).
    res.status(404).json({ error: 'Not found' });
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

    const flags = await getModuleFlags();
    if (flags.standaloneDeviceEnabled) {
      await startStandaloneBridge();
      startStandaloneScheduler();
    } else {
      console.log('ℹ️  StandAlone Device module is disabled — bridge not started (enable it in Settings)');
    }

    startAttendanceNotificationScheduler();
    startBirthdayNotificationScheduler();

    // Validity / Expiry: take staff whose end date has passed off the attendance
    // devices (and put them back once extended) without anyone having to save
    // anything — see enforceAccessValidity in routes/zktecoApi.js.
    setInterval(() => enforceAccessValidity().catch(e => console.error('[ZK Validity] sweep failed:', e.message)), 5 * 60 * 1000).unref();
    setTimeout(() => enforceAccessValidity().catch(e => console.error('[ZK Validity] sweep failed:', e.message)), 30 * 1000).unref();

    if (process.env.ENABLE_TENANT_RESOLVE === 'true') {
      routingCache.start();
    }

    const server = app.listen(PORT, () => {
      console.log(`✅ Server running  →  http://localhost:${PORT}/api`);
      console.log(`   App ${APP_VERSION}  |  DB schema v${DB_VERSION}`);
    });
    // Port already taken (another dev server / the installed desktop app) is
    // an environment condition, not a code bug — exit with a clear message
    // instead of letting it reach uncaughtException and the Bug Finder list.
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        logError(`❌ Port ${PORT} is already in use — another eHajiri server (or the installed desktop app) is running. Stop it, or set a different PORT in server/.env.`, err);
        process.exit(1);
      }
      throw err;
    });

    // In the hosted multi-tenant fleet every leaf tenant process shares this
    // same cert dir and HTTPS_PORT with the central router (the instance with
    // ENABLE_TENANT_RESOLVE=true, which is the one actually reachable from
    // outside) — only the router needs the real listener. Without this check,
    // every other tenant process retries the same doomed bind on each restart
    // and spams its own stderr with EADDRINUSE.
    const isLeafTenant = !!process.env.TENANT_ID && process.env.ENABLE_TENANT_RESOLVE !== 'true';
    if (hasTls && !isLeafTenant) {
      const tlsOptions = { cert: fs.readFileSync(CERT_PATH), key: fs.readFileSync(KEY_PATH) };
      const httpsServer = https.createServer(tlsOptions, app);
      httpsServer.listen(HTTPS_PORT, () => {
        console.log(`✅ HTTPS listening →  https://localhost:${HTTPS_PORT}/api`);
      });
      httpsServer.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          logError(`❌ HTTPS port ${HTTPS_PORT} is already in use. Set a different HTTPS_PORT in server/.env.`, err);
          return;
        }
        logError('❌ HTTPS server error:', err);
      });
    }
  } catch (err) {
    logError('❌ Server failed to start:', err);
    process.exit(1);
  }
})();

process.on('exit', () => { stopStandaloneScheduler(); stopStandaloneBridge(); stopAttendanceNotificationScheduler(); stopBirthdayNotificationScheduler(); });
process.on('SIGINT', () => { stopStandaloneScheduler(); stopStandaloneBridge(); stopAttendanceNotificationScheduler(); stopBirthdayNotificationScheduler(); process.exit(0); });
process.on('SIGTERM', () => { stopStandaloneScheduler(); stopStandaloneBridge(); stopAttendanceNotificationScheduler(); stopBirthdayNotificationScheduler(); process.exit(0); });

/* ── Bug Finder — catch crashes that happen outside any request (e.g. a
   scheduler tick, a stray promise) so they still show up in the DB list
   instead of only ever appearing in a console no one is watching. ── */
process.on('uncaughtException', (err) => {
  logError('❌ Uncaught exception:', err);
  logBugReport({ source: 'backend', page: '(process)', message: err.message, stack: err.stack }).catch(() => {});
});
process.on('unhandledRejection', (err) => {
  logError('❌ Unhandled rejection:', err);
  logBugReport({ source: 'backend', page: '(process)', message: err?.message || String(err), stack: err?.stack }).catch(() => {});
});
