// electron/main.cjs  —  Electron main process for eHajiri desktop app
'use strict';

const { app, BrowserWindow, dialog, ipcMain, Menu, Tray, nativeImage,
        utilityProcess, screen, shell, Notification } = require('electron');
const { VelopackApp, UpdateManager } = require('velopack');
const path = require('path');
const fs   = require('fs');
const http = require('http');
const net  = require('net');
const os   = require('os');

// Needed before the VelopackApp hooks below, which call ensureFirewallRule().
const SERVER_PORT = 5001;

// ─────────────────────────────────────────────────────────────────────────────
// Windows Firewall — open an inbound rule for SERVER_PORT so other computers
// on the LAN can reach the dashboard/API by IP (http://<this-pc-ip>:SERVER_PORT).
// Adding a rule requires admin rights, which a normal per-user Squirrel
// install/update doesn't have — so this triggers one UAC prompt (only the
// first time, when the rule doesn't already exist) via an elevated
// PowerShell child process. Best-effort throughout: if the user declines the
// UAC prompt, the app still runs fine locally, it just isn't reachable from
// other computers yet.
// ─────────────────────────────────────────────────────────────────────────────
function ensureFirewallRule() {
  const { exec } = require('child_process');
  const ruleName = 'eHajiri Attendance Server';

  exec(
    `powershell -NoProfile -NonInteractive -Command "if (Get-NetFirewallRule -DisplayName '${ruleName}' -ErrorAction SilentlyContinue) { Write-Output 'EXISTS' }"`,
    { windowsHide: true },
    (err, stdout) => {
      if (err || String(stdout).includes('EXISTS')) return;

      const scriptPath = path.join(os.tmpdir(), 'ehajiri-add-firewall-rule.ps1');
      try {
        fs.writeFileSync(
          scriptPath,
          `New-NetFirewallRule -DisplayName '${ruleName}' -Direction Inbound -Protocol TCP -LocalPort ${SERVER_PORT} -Action Allow -Profile Any\n`
        );
      } catch {
        return;
      }

      exec(
        `powershell -NoProfile -NonInteractive -Command "Start-Process powershell -Verb RunAs -WindowStyle Hidden -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \\"${scriptPath}\\"'"`,
        { windowsHide: true },
        () => {}
      );
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Elevation detection — postgres.exe hard-refuses to run in a process holding
// administrator privileges ("Execution of PostgreSQL by a user with
// administrative permissions is not permitted"), and the embedded DB inherits
// eHajiri's token. Elevated launches are common in the field: right-click →
// Run as administrator, the app auto-started at the end of an elevated
// Setup.exe run, or PCs that run everything elevated (built-in Administrator
// account, UAC disabled). startDatabase() checks this and, when elevated,
// starts the cluster through pg_ctl.exe — which strips its own token — so
// the app works in that mode instead of dying with the cryptic log line.
// relaunchDeElevated() remains as a last resort in the failure dialog.
// ─────────────────────────────────────────────────────────────────────────────
let processElevated = null;
function isProcessElevated() {
  if (processElevated !== null) return processElevated;
  if (process.platform !== 'win32') return (processElevated = false);
  const { spawnSync } = require('child_process');
  // fltmc.exe (filter manager) exits 0 only from an elevated process and
  // "Access is denied" otherwise; unlike `net session` it doesn't depend on
  // the LanmanServer service being up. If it can't be spawned at all, assume
  // not elevated — worst case is the old startDatabase() error path.
  const r = spawnSync('fltmc.exe', [], { windowsHide: true, stdio: 'ignore' });
  processElevated = r.status === 0;
  return processElevated;
}

function relaunchDeElevated() {
  // Launching via explorer.exe hands the spawn to the user's (unelevated)
  // shell, shedding the admin token — the standard de-elevation trick.
  const { spawn } = require('child_process');
  spawn('explorer.exe', [process.execPath], { detached: true, stdio: 'ignore' }).unref();
}

// ─────────────────────────────────────────────────────────────────────────────
// VELOPACK HOOK — must be the absolute first thing that runs.
// ─────────────────────────────────────────────────────────────────────────────
VelopackApp.build()
  .onAfterInstallFastCallback(() => { ensureFirewallRule(); })
  .onAfterUpdateFastCallback(() => { ensureFirewallRule(); })
  .run();

// ─────────────────────────────────────────────────────────────────────────────
// Single-instance lock — eHajiri auto-starts at login and stays resident in
// the tray (window-all-closed is prevented below), so a second launch (e.g.
// double-clicking the shortcut again) is easy to trigger by accident. Without
// this guard, the second process's killStaleEmbeddedPostgres() finds the
// first instance's postgres.exe listening on PG_PORT, cannot tell it apart
// from a genuine orphan left by a crashed previous session, and force-kills
// it — the first instance's database and server die a few seconds into every
// run with "unexpected postmaster exit" even though everything started fine.
// ─────────────────────────────────────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
  // Calling app.quit() here does NOT stop the rest of this file from
  // running — Electron still fires 'ready' once its own init completes, so
  // the app.whenReady().then(...) block below would still execute (and
  // reach startDatabase()/killStaleEmbeddedPostgres(), which would then
  // force-kill the FIRST instance's live postgres.exe). `return` is what
  // actually stops that: it skips every line after this block, including
  // the whenReady() registration, for this losing second process.
  app.quit();
  return;
}
app.on('second-instance', () => {
  // Relaunching from the desktop/Start-menu logo means the user wants the
  // application, so open the dashboard. Only while the server isn't up yet
  // does the Monitor popup appear instead, so they can watch startup progress
  // rather than land on a browser error page.
  if (srvStatus === 'running') {
    openDashboardInBrowser();
  } else if (monitorPopup && !monitorPopup.isDestroyed()) {
    monitorPopup.show();
    monitorPopup.focus();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────
const UPDATE_URL      = 'https://github.com/mailsunilmaharjan/ehajiri-releases';
const isDev           = !app.isPackaged;
const POLL_MS         = 8000;
const UPDATE_CHECK_MS = 4 * 60 * 60 * 1000; // re-check for updates every 4h while running

// Embedded PostgreSQL — non-standard port avoids conflicts with any system PG
const PG_PORT = 5442;
const PG_USER = 'zkattend_postgres';
const PG_PASS = 'Pg7$mK9vXq2!wRtN4uZb';
const PG_DB   = 'ehajiri_db';

// ─────────────────────────────────────────────────────────────────────────────
// embedded-postgres resolves its Windows binaries (initdb.exe, postgres.exe,
// pg_ctl.exe) from `import.meta.url`, which always points inside app.asar —
// even though forge.config.js's asarUnpack copies those exact files out to
// the sibling app.asar.unpacked directory. A path inside app.asar isn't a
// real file the OS can spawn or chmod, so without this redirect every
// packaged install fails on first launch: initdb.exe/postgres.exe ENOENT via
// spawn(), and ensureBinIsExecutable() ENOENT via fs.stat/fs.chmod.
// https://www.electronjs.org/docs/latest/tutorial/asar-archives#executing-binaries-inside-asar-archive
if (app.isPackaged) {
  const ASAR_DIR = `app.asar${path.sep}`;
  const UNPACKED_DIR = `app.asar.unpacked${path.sep}`;
  const unasarify = (p) =>
    typeof p === 'string' && p.includes(ASAR_DIR) ? p.split(ASAR_DIR).join(UNPACKED_DIR) : p;

  const cp = require('child_process');
  const originalSpawn = cp.spawn;
  cp.spawn = function patchedSpawn(command, ...rest) {
    return originalSpawn.call(cp, unasarify(command), ...rest);
  };

  const fsp = require('fs/promises');
  const originalStat = fsp.stat;
  const originalChmod = fsp.chmod;
  fsp.stat = function patchedStat(p, ...rest) { return originalStat.call(fsp, unasarify(p), ...rest); };
  fsp.chmod = function patchedChmod(p, ...rest) { return originalChmod.call(fsp, unasarify(p), ...rest); };
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistent logging — mirrors console output (and anything that would
// otherwise only ever be shown in a transient error dialog) to
// userData/logs/main.log, so a failure on a remote machine leaves a trail
// that can be pulled after the fact instead of requiring a screenshot of
// whatever dialog happened to be on screen.
// ─────────────────────────────────────────────────────────────────────────────
function getLogFile() {
  return path.join(app.getPath('userData'), 'logs', 'main.log');
}

function initLogging() {
  const logFile = getLogFile();
  try { fs.mkdirSync(path.dirname(logFile), { recursive: true }); } catch { return; }

  const stream = fs.createWriteStream(logFile, { flags: 'a' });
  const format = (args) => args
    .map((a) => (a instanceof Error ? (a.stack || a.message) : typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ');
  const write = (level, args) => {
    try { stream.write(`[${new Date().toISOString()}] [${level}] ${format(args)}\n`); } catch { /* best-effort */ }
  };

  const origLog = console.log;
  const origError = console.error;
  console.log = (...args) => { origLog(...args); write('info', args); };
  console.error = (...args) => { origError(...args); write('error', args); };

  process.on('uncaughtException', (err) => write('uncaughtException', [err]));
  process.on('unhandledRejection', (err) => write('unhandledRejection', [err]));

  console.log(`[log] eHajiri ${app.getVersion()} starting — logging to ${logFile}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────
let monitorPopup  = null;
let serverProcess = null;
let bridgeProcess = null;
let embeddedPg    = null;
let tray          = null;
let srvStatus     = 'starting';
let zkDevices     = [];
let versionInfo   = { appVersion: null, dbApplied: null, dbAppliedAt: null };
let srvStartedAt  = null;
let pollTimer     = null;
let updateTimer   = null;
let cleaningUp    = false;
let pgViaPgCtl    = false;  // cluster was started via pg_ctl (elevated mode) — stop it the same way
let pendingUpdate = null;   // Velopack release object once a silent check finds one — awaits user click
let updating      = false;  // true once download/apply has actually started (prevents double-trigger)

// ─────────────────────────────────────────────────────────────────────────────
// Tray icons — draw anti-aliased circle into raw RGBA buffer (no image file)
// ─────────────────────────────────────────────────────────────────────────────
function makeIcon(r, g, b) {
  const size = 22;
  const buf  = Buffer.alloc(size * size * 4, 0);
  const cx = (size - 1) / 2, cy = (size - 1) / 2, radius = size / 2 - 1.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      const a = d <= radius ? 255
              : d <= radius + 1.2 ? Math.round(255 * (1 - (d - radius) / 1.2))
              : 0;
      const i = (y * size + x) * 4;
      buf[i] = r; buf[i+1] = g; buf[i+2] = b; buf[i+3] = a;
    }
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

// ─────────────────────────────────────────────────────────────────────────────
// Find whatever is listening on the embedded-postgres port and, only if it's
// genuinely a postgres.exe process (never anything else), kill it. This is
// the recovery path for the orphaned-postgres scenario described below.
// ─────────────────────────────────────────────────────────────────────────────
async function killStaleEmbeddedPostgres() {
  const { execSync } = require('child_process');
  try {
    const pids = execSync(
      `powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort ${PG_PORT} -State Listen -ErrorAction SilentlyContinue).OwningProcess"`,
      { encoding: 'utf8' }
    ).split(/\s+/).map((s) => parseInt(s, 10)).filter(Boolean);

    for (const pid of pids) {
      const name = execSync(
        `powershell -NoProfile -Command "(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).ProcessName"`,
        { encoding: 'utf8' }
      ).trim();
      if (name.toLowerCase() === 'postgres') {
        console.log(`[db] Found orphaned postgres.exe (pid ${pid}) on port ${PG_PORT} from a previous non-graceful shutdown — terminating it.`);
        execSync(`taskkill /PID ${pid} /F`);
      }
    }
  } catch {
    // Best-effort cleanup — if this fails, embeddedPg.start() will surface its own error.
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Microsoft Visual C++ Redistributable — the bundled Postgres binaries link
// against it, and a freshly-imaged or locked-down Windows machine may not
// have it, which makes postgres.exe/initdb.exe fail to even launch. Only
// present in resourcesPath if installer/deps/VC_redist.x64.exe was placed
// before packaging (see forge.config.js) — this is a no-op otherwise. The
// installer is silent and idempotent; a marker file in userData avoids
// re-running it on every single launch once it has already succeeded once.
// ─────────────────────────────────────────────────────────────────────────────
function ensureVCRedist() {
  return new Promise((resolve) => {
    if (!app.isPackaged) return resolve();

    const vcRedistPath = path.join(process.resourcesPath, 'VC_redist.x64.exe');
    if (!fs.existsSync(vcRedistPath)) return resolve();

    const marker = path.join(app.getPath('userData'), '.vcredist-installed');
    if (fs.existsSync(marker)) return resolve();

    setTrayTooltip('eHajiri — Checking prerequisites…');
    const { execFile } = require('child_process');
    execFile(vcRedistPath, ['/install', '/quiet', '/norestart'], { timeout: 120000 }, (err) => {
      // 3010 = success, reboot required; 1638 = an equal/newer version is
      // already installed — both are successful outcomes for our purposes.
      if (!err || [3010, 1638].includes(err.code)) {
        try { fs.writeFileSync(marker, new Date().toISOString()); } catch { /* best-effort */ }
        console.log('[vcredist] installed/verified');
      } else {
        console.error('[vcredist] silent install failed:', err);
      }
      resolve();
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Detect a system-wide PostgreSQL Windows service, purely informational. The
// embedded instance runs on its own port/data-dir and never touches this, so
// this is never acted on automatically — surfaced in the Monitor popup only
// so the user knows it's there (it may belong to a different, unrelated app).
// ─────────────────────────────────────────────────────────────────────────────
let externalPgServices = [];
function detectExternalPostgres() {
  const { execSync } = require('child_process');
  try {
    const out = execSync(
      `powershell -NoProfile -Command "(Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name) -join ','"`,
      { encoding: 'utf8', windowsHide: true }
    ).trim();
    externalPgServices = out ? out.split(',').filter(Boolean) : [];
    if (externalPgServices.length) {
      console.log(`[db] Detected existing system PostgreSQL service(s): ${externalPgServices.join(', ')} — informational only; eHajiri's embedded instance runs on its own port (${PG_PORT}) and data directory and does not interact with it.`);
    }
  } catch {
    externalPgServices = [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Embedded PostgreSQL — starts a self-contained PG instance in userData/pgdata
// Only used in production (packaged app). Dev uses the local PG from .env.
// ─────────────────────────────────────────────────────────────────────────────
async function startDatabase() {
  // embedded-postgres is ESM-only — dynamic import works from CJS
  const { default: EmbeddedPostgres } = await import('embedded-postgres');

  const pgDataDir  = path.join(app.getPath('userData'), 'pgdata');
  const isFirstRun = !fs.existsSync(path.join(pgDataDir, 'PG_VERSION'));

  setTrayTooltip('eHajiri — Initializing database…');

  embeddedPg = new EmbeddedPostgres({
    databaseDir: pgDataDir,
    user       : 'postgres',        // cluster superuser (internal only)
    password   : 'ehajiri_cluster', // internal cluster password
    port       : PG_PORT,
    persistent : true,
    // Without this, initdb derives encoding from the Windows OS locale
    // (often WIN1252, e.g. on "English (United States)" installs), which
    // cannot store the Devanagari/Nepali text this app seeds and displays
    // throughout — the server crashes on the very first migration that
    // writes Nepali text. --locale=C has no real collation rules, so it's
    // compatible with any encoding, including forced UTF8.
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  });

  // If eHajiri was previously terminated non-gracefully (crash, Task Manager
  // "End Task", forced Windows shutdown/update, power loss) instead of via
  // the tray's Quit action, the postgres.exe child can survive as an orphan
  // holding the cluster's shared memory segment. Without this, every
  // subsequent launch fails permanently with "pre-existing shared memory
  // block is still in use" and the app can never recover on its own.
  await killStaleEmbeddedPostgres();

  // initialise() runs `initdb`, which REFUSES to run against a non-empty
  // data directory (it errors out rather than being a no-op) — so it must
  // only be called once, on the very first launch.
  if (isFirstRun) {
    // Safe even when elevated: initdb.exe strips its own admin token via
    // CreateRestrictedToken before doing any work (only postgres.exe refuses).
    await embeddedPg.initialise();
  }

  if (isProcessElevated()) {
    // embedded-postgres's start() spawns postgres.exe directly, which refuses
    // the elevated token it would inherit — go through pg_ctl instead (see
    // comment above runPgCtl()).
    console.log(`[db] Process is elevated — starting embedded PostgreSQL via pg_ctl with a restricted token`);
    await startPostgresViaPgCtl(pgDataDir);
    pgViaPgCtl = true;
  } else {
    await embeddedPg.start();
  }

  if (isFirstRun) {
    setTrayTooltip('eHajiri — Creating database…');
    const client = embeddedPg.getPgClient();
    await client.connect();
    try {
      // Create app role
      await client.query(`
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT FROM pg_catalog.pg_roles WHERE rolname = '${PG_USER}'
          ) THEN
            CREATE ROLE "${PG_USER}" LOGIN PASSWORD '${PG_PASS}' SUPERUSER;
          END IF;
        END $$
      `);
      // Create app database
      const { rows } = await client.query(
        `SELECT 1 FROM pg_database WHERE datname = $1`, [PG_DB]
      );
      if (!rows.length) {
        await client.query(`CREATE DATABASE "${PG_DB}" OWNER "${PG_USER}"`);
      }
    } finally {
      await client.end();
    }
  }

  console.log(`[db] Embedded PostgreSQL running on port ${PG_PORT}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// pg_dump.exe — used by the native SQL backup export (server/routes/backup.js's
// /sql route). @embedded-postgres/windows-x64 only ships server binaries
// (postgres.exe/pg_ctl.exe/initdb.exe), so pg_dump.exe is bundled separately
// (see PG_DUMP_SRC in forge.config.js) and copied to sit directly alongside
// postgres.exe, so it resolves its DLL dependencies (libpq.dll etc.) from the
// binaries already unpacked there instead of needing its own copies. Returns
// null when not bundled — the /sql route surfaces a clear error to the UI
// rather than crashing; JSON backup is unaffected either way.
// ─────────────────────────────────────────────────────────────────────────────
function resolvePgClientTool(exeName) {
  let pkgDir;
  try {
    pkgDir = path.dirname(require.resolve('@embedded-postgres/windows-x64/package.json'));
  } catch {
    return null;
  }
  let toolPath = path.join(pkgDir, 'native', 'bin', exeName);
  if (app.isPackaged) {
    toolPath = toolPath.split(`app.asar${path.sep}`).join(`app.asar.unpacked${path.sep}`);
  }
  return fs.existsSync(toolPath) ? toolPath : null;
}
const resolvePgDumpPath    = () => resolvePgClientTool('pg_dump.exe');
const resolvePgRestorePath = () => resolvePgClientTool('pg_restore.exe');

// ─────────────────────────────────────────────────────────────────────────────
// pg_ctl-based cluster start/stop — used only when eHajiri itself is running
// elevated. postgres.exe refuses an administrator token outright and
// embedded-postgres spawns it directly, so its start() can never work in an
// elevated process. pg_ctl.exe (like initdb.exe) instead re-executes itself
// under a CreateRestrictedToken()-stripped token and launches postgres from
// there, so routing start/stop through it makes the embedded DB work no
// matter how the app was launched. The non-elevated path keeps using
// embedded-postgres's own start() — battle-tested across the install base —
// so this code only ever runs on machines that previously could not start
// the database at all.
// ─────────────────────────────────────────────────────────────────────────────
function runPgCtl(args) {
  return new Promise((resolve, reject) => {
    const pgCtl = resolvePgClientTool('pg_ctl.exe');
    if (!pgCtl) return reject(new Error('pg_ctl.exe not found in bundled PostgreSQL binaries'));
    const { execFile } = require('child_process');
    execFile(pgCtl, args, { windowsHide: true, timeout: 90000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`pg_ctl ${args[0]} failed: ${(stderr || stdout || err.message).trim()}`));
      else resolve();
    });
  });
}

function startPostgresViaPgCtl(pgDataDir) {
  // -w waits until the server actually accepts connections (the equivalent of
  // embedded-postgres watching stderr for "ready to accept connections").
  // postgres's own output goes to a log file because pg_ctl detaches it.
  const pgLog = path.join(app.getPath('userData'), 'logs', 'postgres.log');
  try { fs.mkdirSync(path.dirname(pgLog), { recursive: true }); } catch { /* best-effort */ }
  return runPgCtl(['start', '-w', '-t', '60', '-D', pgDataDir, '-o', `-p ${PG_PORT}`, '-l', pgLog]);
}

function stopPostgresViaPgCtl() {
  const pgDataDir = path.join(app.getPath('userData'), 'pgdata');
  return runPgCtl(['stop', '-w', '-t', '30', '-D', pgDataDir, '-m', 'fast']);
}

// ─────────────────────────────────────────────────────────────────────────────
// Server lifecycle
// ─────────────────────────────────────────────────────────────────────────────
function startServer() {
  const serverScript = isDev
    ? path.join(__dirname, '..', 'server', 'index.js')
    : path.join(process.resourcesPath, 'server', 'index.js');

  // In production, override DB settings to use embedded PostgreSQL.
  // process.env values take precedence over .env file (dotenv doesn't overwrite).
  const dbEnv = app.isPackaged ? {
    DB_HOST: '127.0.0.1',
    DB_PORT: String(PG_PORT),
    DB_USER: PG_USER,
    DB_PASS: PG_PASS,
    DB_NAME: PG_DB,
  } : {};

  const pgDumpPath    = resolvePgDumpPath();
  const pgRestorePath = resolvePgRestorePath();

  serverProcess = utilityProcess.fork(serverScript, [], {
    env: {
      ...process.env,
      ...dbEnv,
      ...(pgDumpPath    ? { PG_DUMP_PATH: pgDumpPath }       : {}),
      ...(pgRestorePath ? { PG_RESTORE_PATH: pgRestorePath } : {}),
      PORT    : String(SERVER_PORT),
      NODE_ENV: isDev ? 'development' : 'production',
      ELECTRON: 'true',
    },
    stdio: 'pipe',
  });

  serverProcess.stdout?.on('data', (d) => {
    const msg = d.toString().trim();
    console.log('[server]', msg);
    if (monitorPopup && !monitorPopup.isDestroyed())
      monitorPopup.webContents.send('server-log', msg);
  });
  serverProcess.stderr?.on('data', (d) => {
    const msg = d.toString().trim();
    console.error('[server]', msg);
    if (monitorPopup && !monitorPopup.isDestroyed())
      monitorPopup.webContents.send('server-log', '⚠ ' + msg);
  });

  serverProcess.on('exit', (code) => {
    console.log('[server] exited with code', code);
    srvStatus = 'stopped';
    srvStartedAt = null;
    serverProcess = null;
    updateTray();
  });
}

function restartServer() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  srvStatus = 'starting';
  updateTray();
  setTimeout(() => startServer(), 1500);
}

// ─────────────────────────────────────────────────────────────────────────────
// Wait until Express is ready before showing the main window
// ─────────────────────────────────────────────────────────────────────────────
function waitForServer(url, retries = 40) {
  return new Promise((resolve, reject) => {
    const check = (n) => {
      http.get(url, (res) => {
        if (res.statusCode < 500) resolve();
        else setTimeout(() => check(n - 1), 500);
      }).on('error', () => {
        if (n <= 0) return reject(new Error('Server never started'));
        setTimeout(() => check(n - 1), 500);
      });
    };
    check(retries);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard — opened in the OS default browser instead of an Electron window,
// so the same URL works from this PC or any other computer on the LAN
// (http://<this-pc-ip>:SERVER_PORT).
// ─────────────────────────────────────────────────────────────────────────────
function openDashboardInBrowser() {
  shell.openExternal(`http://localhost:${SERVER_PORT}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Monitor popup — floating status panel shown on tray click
// ─────────────────────────────────────────────────────────────────────────────
function createMonitorPopup() {
  const monitorHtml = isDev
    ? path.join(__dirname, 'monitor.html')
    : path.join(app.getAppPath(), 'electron', 'monitor.html');

  monitorPopup = new BrowserWindow({
    width: 420, height: 570,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  monitorPopup.loadFile(monitorHtml);
  monitorPopup.on('blur', () => monitorPopup?.hide());
}

function showMonitorPopup() {
  if (!monitorPopup || monitorPopup.isDestroyed()) createMonitorPopup();
  if (monitorPopup.isVisible()) { monitorPopup.hide(); return; }

  const tb = tray.getBounds();
  const { workArea } = screen.getPrimaryDisplay();
  const pw = 420, ph = 570;

  let wx = Math.round(tb.x + tb.width / 2 - pw / 2);
  const spaceBelow = workArea.y + workArea.height - (tb.y + tb.height);
  const wy = spaceBelow > ph + 10 ? tb.y + tb.height + 4 : tb.y - ph - 4;
  wx = Math.max(workArea.x, Math.min(wx, workArea.x + workArea.width - pw));

  monitorPopup.setPosition(wx, wy);
  monitorPopup.show();
  monitorPopup.webContents.send('status-update', buildMonitorPayload());
}

function buildMonitorPayload() {
  const localIp = getLocalIp();
  return {
    status     : srvStatus,
    localIp,
    serverPort : SERVER_PORT,
    admsUrl    : `http://${localIp}:${SERVER_PORT}/iclock/`,
    dashUrl    : `http://localhost:${SERVER_PORT}`,
    pid        : serverProcess?.pid ?? null,
    uptimeMs   : srvStartedAt ? Date.now() - srvStartedAt : null,
    devices    : zkDevices,
    autoStart  : app.getLoginItemSettings().openAtLogin,
    dbPort     : app.isPackaged ? PG_PORT : 5432,
    dbStatus   : embeddedPg ? 'embedded' : (isDev ? 'external' : 'stopped'),
    appVersion : versionInfo.appVersion,
    dbApplied  : versionInfo.dbApplied,
    dbAppliedAt: versionInfo.dbAppliedAt,
    externalPostgres: externalPgServices,
    updateAvailable: pendingUpdate
      ? { version: pendingUpdate.TargetFullRelease.Version, updating }
      : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Poll ZKTeco devices every POLL_MS to keep monitor + tray icon current
// ─────────────────────────────────────────────────────────────────────────────
async function pollStatus() {
  try {
    const alive = await checkPort(SERVER_PORT);
    if (alive) {
      if (srvStatus !== 'running') srvStartedAt = Date.now();
      srvStatus = 'running';
      const data = await fetchJson(
        `http://127.0.0.1:${SERVER_PORT}/api/zkteco/devices`
      ).catch(() => null);
      zkDevices = Array.isArray(data) ? data : [];

      // /api/health needs no auth, so this works even before anyone logs in
      const health = await fetchJson(
        `http://127.0.0.1:${SERVER_PORT}/api/health`
      ).catch(() => null);
      if (health) {
        versionInfo = {
          appVersion : health.appVersion ?? versionInfo.appVersion,
          dbApplied  : health.dbApplied  ?? versionInfo.dbApplied,
          dbAppliedAt: health.dbAppliedAt ?? versionInfo.dbAppliedAt,
        };
      }
    } else {
      srvStatus    = serverProcess ? 'starting' : 'stopped';
      zkDevices    = [];
      srvStartedAt = null;
    }
  } catch {
    srvStatus = 'error';
  }

  updateTray();
  if (monitorPopup && !monitorPopup.isDestroyed() && monitorPopup.isVisible()) {
    monitorPopup.webContents.send('status-update', buildMonitorPayload());
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// System-tray — dynamic color, left-click = monitor popup
// ─────────────────────────────────────────────────────────────────────────────
function createTray() {
  const ICONS = {
    running : makeIcon(34,  197, 94),
    starting: makeIcon(234, 179,  8),
    stopped : makeIcon(239,  68, 68),
    error   : makeIcon(239,  68, 68),
  };

  tray = new Tray(ICONS.starting);
  tray._icons = ICONS;
  setTrayTooltip('eHajiri — starting…');

  tray.on('click',        showMonitorPopup);
  tray.on('double-click', openDashboardInBrowser);
  tray.on('right-click',  () => {
    const loginOn = app.getLoginItemSettings().openAtLogin;
    tray.popUpContextMenu(Menu.buildFromTemplate([
      { label: 'eHajiri Attendance', enabled: false },
      { type: 'separator' },
      { label: '🖥  Open eHajiri',       click: openDashboardInBrowser },
      { label: '📡  Monitor Status',      click: showMonitorPopup },
      { type: 'separator' },
      { label: '↺  Restart Server',       click: restartServer },
      { label: '🔄  Check for Updates',   click: () => checkForUpdates(false) },
      { type: 'separator' },
      { label: `🚀  Auto-start on Login: ${loginOn ? '✔ ON' : 'OFF'}`,
        click: () => app.setLoginItemSettings({ openAtLogin: !loginOn, path: app.getPath('exe') }) },
      { type: 'separator' },
      { label: 'Quit eHajiri', click: () => { app.isQuiting = true; app.quit(); } },
    ]));
  });
}

function updateTray() {
  if (!tray) return;
  tray.setImage(tray._icons[srvStatus] || tray._icons.stopped);
  const online = zkDevices.filter(d =>
    d.last_seen && Date.now() - new Date(d.last_seen).getTime() < 15 * 60 * 1000
  ).length;
  setTrayTooltip(
    `eHajiri — ${srvStatus.toUpperCase()}\n` +
    `IP: ${getLocalIp()}  API Port: ${SERVER_PORT}\n` +
    (zkDevices.length ? `ZKTeco: ${online}/${zkDevices.length} online` : 'No ZKTeco devices')
  );
}

function setTrayTooltip(msg) {
  if (tray) tray.setToolTip(msg);
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-update (Velopack)
//
// Silent (background) checks no longer install unattended — they surface a
// notification + a banner in the tray Monitor popup and WAIT for the user to
// click before downloading/installing/restarting. This avoids yanking the
// app out from under someone mid-punch or mid-report at a random moment.
// The manual "Check for Updates" tray action still prompts with its own
// Update Now / Remind Me Later dialog, unchanged.
// ─────────────────────────────────────────────────────────────────────────────
async function checkForUpdates(silent = false) {
  try {
    const mgr = new UpdateManager(UPDATE_URL);
    const newRelease = await mgr.checkForUpdatesAsync();

    if (!newRelease) {
      if (!silent) dialog.showMessageBoxSync({
        type: 'info', title: 'No Updates',
        message: 'eHajiri is up to date.', buttons: ['OK'],
      });
      return;
    }

    const newVersion = newRelease.TargetFullRelease.Version;

    if (!silent) {
      const { response } = await dialog.showMessageBox({
        type: 'info', title: 'Update Available',
        message: `eHajiri ${newVersion} is available`,
        detail: 'A new version is ready. The app will restart automatically.',
        buttons: ['Update Now', 'Remind Me Later'], defaultId: 0, cancelId: 1,
      });
      if (response !== 0) return;
      await applyUpdate(mgr, newRelease);
      return;
    }

    // Silent path: surface it, then wait for a click (notification or Monitor banner).
    pendingUpdate = newRelease;
    setTrayTooltip(`eHajiri — Update ${newVersion} available (click Monitor to install)`);
    if (monitorPopup && !monitorPopup.isDestroyed()) {
      monitorPopup.webContents.send('status-update', buildMonitorPayload());
    }
    if (Notification.isSupported()) {
      const noti = new Notification({
        title: 'eHajiri update available',
        body: `Version ${newVersion} is ready. Click here to install and restart.`,
      });
      noti.on('click', () => applyUpdate(mgr, newRelease));
      noti.show();
    }
  } catch (err) {
    console.error('[updater]', err);
    if (!silent) dialog.showErrorBox('Update Error', `Could not check for updates:\n${err.message}`);
  }
}

/** Actually downloads, applies (migrating the DB happens naturally — the relaunched
 *  server runs runMigrations() on every startup, update or not), and restarts. */
async function applyUpdate(mgr, newRelease) {
  if (updating) return;
  updating = true;
  const newVersion = newRelease.TargetFullRelease.Version;

  setTrayTooltip(`eHajiri — Installing update ${newVersion}…`);
  if (monitorPopup && !monitorPopup.isDestroyed()) {
    monitorPopup.webContents.send('status-update', buildMonitorPayload());
  }

  try {
    await mgr.downloadUpdatesAsync(newRelease);
    await new Promise(r => setTimeout(r, 800));
    mgr.applyUpdatesAndRestart(newRelease);
  } catch (err) {
    console.error('[updater] apply failed', err);
    updating = false;
    dialog.showErrorBox('Update Error', `Could not install update ${newVersion}:\n${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// IPC handlers
// ─────────────────────────────────────────────────────────────────────────────
ipcMain.handle('check-for-updates', () => checkForUpdates(false));
ipcMain.on('apply-update', () => {
  if (pendingUpdate) applyUpdate(new UpdateManager(UPDATE_URL), pendingUpdate);
});

ipcMain.on('get-monitor-status', (e) => e.reply('status-update', buildMonitorPayload()));
ipcMain.on('restart-server',     () => restartServer());
ipcMain.on('open-main-window',   () => openDashboardInBrowser());
ipcMain.on('hide-monitor',       () => monitorPopup?.hide());
ipcMain.on('open-url',           (_, url) => shell.openExternal(url));
ipcMain.on('open-log-file',      () => shell.openPath(getLogFile()));
ipcMain.on('toggle-autostart',   () => {
  const cur = app.getLoginItemSettings().openAtLogin;
  app.setLoginItemSettings({ openAtLogin: !cur, path: app.getPath('exe') });
  if (monitorPopup && !monitorPopup.isDestroyed())
    monitorPopup.webContents.send('status-update', buildMonitorPayload());
});

// ─────────────────────────────────────────────────────────────────────────────
// App lifecycle
// ─────────────────────────────────────────────────────────────────────────────
app.on('ready', async () => {
  initLogging();

  // Elevated launches (Run as administrator, built-in Administrator account,
  // UAC disabled) can't use embedded-postgres's direct postgres.exe spawn —
  // startDatabase() routes through pg_ctl instead (see runPgCtl()). Logged
  // here so a pulled main.log makes the mode obvious at a glance.
  if (app.isPackaged && isProcessElevated()) {
    console.log('[startup] Running with administrator privileges — embedded PostgreSQL will be started via pg_ctl with a restricted token.');
  }

  // Register for auto-startup on first launch (packaged only)
  if (app.isPackaged && !app.getLoginItemSettings().openAtLogin) {
    app.setLoginItemSettings({ openAtLogin: true, path: app.getPath('exe') });
  }

  // Best-effort safety net: covers upgrades from an older installed version
  // that predates this feature (onAfterInstall/onAfterUpdate hooks above
  // only fire for actual install/update events, not every launch).
  if (app.isPackaged) ensureFirewallRule();

  // Show tray immediately so the user sees something
  createTray();
  createMonitorPopup();

  // Start status polling
  pollTimer = setInterval(pollStatus, POLL_MS);

  // Informational only — never acted on automatically (see comment above
  // detectExternalPostgres()). Fire-and-forget so it doesn't delay startup.
  detectExternalPostgres();

  // ── Step 1: Start embedded PostgreSQL (production only) ──────────────────
  if (app.isPackaged) {
    try {
      await ensureVCRedist();
      await startDatabase();
    } catch (err) {
      // embedded-postgres can reject with `undefined` (no Error object) when
      // the postgres process exits before printing its ready message — e.g.
      // on the "shared memory block still in use" failure — so err.message
      // isn't always safe to read directly.
      const message = err?.message || String(err) || 'Unknown error';
      console.error('[db] startDatabase() failed:', err);
      // Exit code 3221225781 = 0xC0000135 STATUS_DLL_NOT_FOUND: initdb.exe/
      // postgres.exe failed at the Windows loader stage, which in practice
      // means the machine is missing the Microsoft Visual C++ Redistributable
      // (ensureVCRedist() above is a no-op when VC_redist.x64.exe wasn't
      // bundled at package time, or its silent install was denied elevation).
      // "Reinstall the application" can't fix that, so point at the real cure.
      const missingVCRuntime = message.includes('3221225781');
      // Last resort for elevated launches: the pg_ctl path in startDatabase()
      // failed too, so offer a de-elevated relaunch (which may fix it when
      // the elevation came from Run-as-administrator, though not on UAC-off /
      // built-in-Administrator machines — hence last resort, not first).
      const elevatedFallback = !missingVCRuntime && isProcessElevated();
      const VC_REDIST_URL = 'https://aka.ms/vs/17/release/vc_redist.x64.exe';
      const choice = dialog.showMessageBoxSync({
        type: 'error',
        title: 'Database Error',
        message: missingVCRuntime
          ? 'eHajiri needs the Microsoft Visual C++ Redistributable, which is not installed on this computer.'
          : 'eHajiri could not start the database.',
        detail: missingVCRuntime
          ? `Download and install it from:\n${VC_REDIST_URL}\n\nthen start eHajiri again.\n\n(Original error: ${message})`
          : elevatedFallback
            ? `eHajiri is running as Administrator and the database could not be started even with reduced privileges.\n\nClick "Restart Normally" to relaunch eHajiri without administrator rights.\n\n(Original error: ${message})`
            : `Error: ${message}\n\nPlease try reinstalling the application.`,
        buttons: missingVCRuntime
          ? ['Download VC++ Redistributable', 'Open Log File', 'OK']
          : elevatedFallback
            ? ['Restart Normally', 'Open Log File', 'Exit']
            : ['Open Log File', 'OK'],
        defaultId: missingVCRuntime ? 2 : elevatedFallback ? 0 : 1,
        cancelId: missingVCRuntime || elevatedFallback ? 2 : 1,
      });
      if (missingVCRuntime) {
        if (choice === 0) shell.openExternal(VC_REDIST_URL);
        else if (choice === 1) shell.openPath(getLogFile());
      } else if (elevatedFallback) {
        if (choice === 0) relaunchDeElevated();
        else if (choice === 1) shell.openPath(getLogFile());
      } else if (choice === 0) {
        shell.openPath(getLogFile());
      }
      app.quit();
      return;
    }
  }

  // ── Step 2: Start Express API server ────────────────────────────────────
  setTrayTooltip('eHajiri — Starting server…');
  startServer();

  // ── Step 3: Wait for server to be ready ─────────────────────────────────
  try {
    await waitForServer(`http://localhost:${SERVER_PORT}/api/health`);
  } catch (err) {
    console.error('[server] waitForServer() timed out:', err);
    const choice = dialog.showMessageBoxSync({
      type: 'error',
      title: 'Startup Error',
      message: 'The eHajiri server failed to start.',
      detail: 'Please try reinstalling the application.',
      buttons: ['Open Log File', 'OK'],
      defaultId: 1,
      cancelId: 1,
    });
    if (choice === 0) shell.openPath(getLogFile());
    app.quit();
    return;
  }

  // ── Step 4: Open dashboard in the default browser ───────────────────────
  openDashboardInBrowser();

  // Silent update check 5s after startup, then every few hours while running
  // (the app stays resident in the tray, so a launch-time-only check would
  // miss updates published during a long-lived session).
  setTimeout(() => checkForUpdates(true), 5000);
  updateTimer = setInterval(() => checkForUpdates(true), UPDATE_CHECK_MS);
});

app.on('window-all-closed', (e) => e.preventDefault());  // stay alive in tray

app.on('before-quit', async (e) => {
  if (cleaningUp) return;
  cleaningUp = true;
  e.preventDefault();

  clearInterval(pollTimer);
  clearInterval(updateTimer);
  if (serverProcess) { serverProcess.kill(); serverProcess = null; }
  if (bridgeProcess) { bridgeProcess.kill(); bridgeProcess = null; }

  // Stop embedded PostgreSQL gracefully before exit. When it was started via
  // pg_ctl (elevated mode), embeddedPg.stop() is a no-op — it never had a
  // child process handle — so the cluster must be stopped through pg_ctl too,
  // or postgres.exe survives as the exact orphan killStaleEmbeddedPostgres()
  // exists to clean up.
  if (pgViaPgCtl) {
    try {
      await stopPostgresViaPgCtl();
    } catch (err) {
      console.error('[db] pg_ctl stop error:', err.message);
    }
  } else if (embeddedPg) {
    try {
      await embeddedPg.stop();
    } catch (err) {
      console.error('[db] stop error:', err.message);
    }
  }

  app.quit();
});

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────
function checkPort(port) {
  return new Promise(resolve => {
    const s = net.createConnection({ port, host: '127.0.0.1' }, () => { s.end(); resolve(true); });
    s.setTimeout(1500);
    s.on('error',   () => resolve(false));
    s.on('timeout', () => { s.destroy(); resolve(false); });
  });
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 3000 }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(); } });
    });
    req.on('error',   reject);
    req.on('timeout', () => { req.destroy(); reject(); });
  });
}

function getLocalIp() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const iface of list) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}
