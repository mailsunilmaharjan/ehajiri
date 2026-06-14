/**
 * One-time database setup — run by the installer right after the [Files] copy
 * step. Connects as the PostgreSQL superuser with the bundled installer's
 * known credentials (the --superpassword passed to pg-setup.exe in setup.iss)
 * and provisions eHajiri's own dedicated database + login.
 *
 * Usage: node setup-db.js <result-file>
 *   result-file — written with "OK" or "FAIL: <reason>" so setup.iss
 *                 (GetPgSetupMode) knows whether the ehajiri/<DB_PASS>
 *                 credentials below are safe to hand to the service.
 *
 * Retries: the bundled PostgreSQL's Windows service can still be finishing
 * its first-boot startup (or briefly restart itself to apply the unattended
 * config) for a short while after pg-setup.exe's process has already exited —
 * which is what setup.iss's "waituntilterminated" waits on. Connecting (or a
 * mid-script disconnect) can therefore fail on the first attempts even though
 * the install itself succeeded. Every step below is idempotent (IF NOT EXISTS
 * / SELECT-before-CREATE), so simply retrying the whole provisioning routine
 * recovers cleanly from any of these transient states.
 */
import pg from 'pg';
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import path from 'path';
const { Client } = pg;
const execAsync = promisify(exec);

const DB_NAME     = 'ehajiriPlanetInfosys_db';
const DB_USER     = 'ehajiri';
const DB_PASSWORD = 'Eh@jiri2026!@Pl@nE!iNfOsYS';

const MAX_ATTEMPTS   = 24;   // ~2 minutes of retrying — generous headroom for a slow first boot
const RETRY_DELAY_MS = 5000;

const SERVICE_MAX_ATTEMPTS   = 24;  // ~2 minutes — same headroom as the connection retry loop
const SERVICE_RETRY_DELAY_MS = 5000;

const [, , resultPath] = process.argv;

// Persistent log at {app}\logs\setup-db.log — survives after the installer's {tmp} is cleaned up.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR  = path.join(__dirname, '..', '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'setup-db.log');
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch { /* already exists */ }

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  try { fs.appendFileSync(LOG_FILE, line); } catch { /* best effort */ }
}

function writeResult(line) {
  if (resultPath) {
    try { fs.writeFileSync(resultPath, line); } catch { /* best effort */ }
  }
  log(`Result: ${line}`);
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// node-postgres reports connection failures (ECONNREFUSED, the AggregateError
// thrown when both ::1 and 127.0.0.1 refuse "localhost", DNS errors, etc.)
// with an empty `.message` — logging just `e.message` would print nothing
// useful. Fall back through `.code`, aggregated sub-errors, and `String(e)`.
function errorDetail(e) {
  return (
    e?.message ||
    e?.code ||
    e?.errors?.map(x => x?.message || x?.code).filter(Boolean).join('; ') ||
    String(e)
  );
}

// Looks up the bundled (or pre-existing) PostgreSQL Windows service by its
// "postgresql-x64-*" name pattern — same convention setup.iss's
// IsPostgresInstalled checks in the registry — and returns its current
// Status ('Running', 'Stopped', 'StartPending', ...), or '' if not found yet.
async function getPostgresServiceStatus() {
  const { stdout } = await execAsync(
    'powershell -NoProfile -NonInteractive -Command ' +
    '"(Get-Service -ErrorAction SilentlyContinue | ' +
    "Where-Object { $_.Name -like 'postgresql-x64-*' } | " +
    'Select-Object -First 1).Status"',
    { windowsHide: true }
  );
  return stdout.trim();
}

// Confirms the PostgreSQL service has actually reached "Running" before we
// even attempt to connect — pg-setup.exe can exit (and setup.iss's
// "waituntilterminated" can return) while the service is still finishing its
// first boot or restarting to apply the unattended config. Waiting for
// "Running" here gives a much clearer diagnostic than letting `provision()`'s
// connection retries exhaust on bare ECONNREFUSED.
async function waitForPostgresService() {
  for (let attempt = 1; attempt <= SERVICE_MAX_ATTEMPTS; attempt++) {
    let status = '';
    try { status = await getPostgresServiceStatus(); } catch { /* PowerShell hiccup — just retry */ }

    if (status === 'Running') {
      log(`PostgreSQL service is Running (attempt ${attempt}/${SERVICE_MAX_ATTEMPTS}).`);
      return true;
    }
    log(`waiting for PostgreSQL service — status: ${status || '(not found yet)'} (attempt ${attempt}/${SERVICE_MAX_ATTEMPTS})`);
    if (attempt < SERVICE_MAX_ATTEMPTS) await sleep(SERVICE_RETRY_DELAY_MS);
  }
  log('PostgreSQL service did not reach "Running" in ~2 minutes — proceeding anyway.');
  return false;
}

async function provision() {
  const admin = new Client({
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: 'ehajiri2024',
    database: 'postgres',
    connectionTimeoutMillis: 8000,
  });

  try {
    await admin.connect();

    // Create dedicated user — ALTER on an existing role keeps the password in
    // sync with DB_PASSWORD even on machines that already have an `ehajiri`
    // role from a previous install (e.g. with older credentials).
    await admin.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${DB_USER}') THEN
          CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}';
        ELSE
          ALTER ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASSWORD}';
        END IF;
      END $$;
    `);

    // Create database — quoted identifier preserves mixed-case name so the
    // connection string (which is case-sensitive) matches what's in pg_database.
    const { rows } = await admin.query(
      `SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'`
    );
    if (rows.length === 0) {
      await admin.query(`CREATE DATABASE "${DB_NAME}" OWNER ${DB_USER}`);
    }

    // Grant privileges
    await admin.query(`GRANT ALL PRIVILEGES ON DATABASE "${DB_NAME}" TO ${DB_USER}`);
  } finally {
    await admin.end().catch(() => {});
  }

  // PostgreSQL 15+ stopped granting CREATE on the `public` schema to PUBLIC,
  // and a freshly created database's `public` schema is copied from the
  // template — it stays owned by `postgres`, NOT by the new database's owner.
  // `ehajiri` can connect to its own database but can't CREATE TABLE in it,
  // failing first boot with "permission denied for schema public". Making
  // ehajiri the schema's owner (not just granting piecemeal privileges) gives
  // it full, version-proof control. Schemas are per-database, so this needs
  // its own connection — directly to the database that was just created.
  const dbAdmin = new Client({
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: 'ehajiri2024',
    database: DB_NAME,
    connectionTimeoutMillis: 8000,
  });
  try {
    await dbAdmin.connect();
    await dbAdmin.query(`ALTER SCHEMA public OWNER TO ${DB_USER}`);
  } finally {
    await dbAdmin.end().catch(() => {});
  }
}

async function setup() {
  log(`setup-db starting — node ${process.version}, resultPath: ${resultPath || '(none)'}`);
  await waitForPostgresService();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await provision();
      log('Database setup complete.');
      writeResult('OK');
      return;
    } catch (e) {
      const detail = errorDetail(e);
      if (attempt === MAX_ATTEMPTS) {
        log(`DB setup error: ${detail}${e?.stack ? `\n${e.stack}` : ''}`);
        writeResult(`FAIL: ${detail}`);
        process.exit(1);
      }
      log(`attempt ${attempt}/${MAX_ATTEMPTS} failed (${detail}) — retrying in ${RETRY_DELAY_MS / 1000}s...`);
      await sleep(RETRY_DELAY_MS);
    }
  }
}

setup();
