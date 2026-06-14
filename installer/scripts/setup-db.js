/**
 * One-time database setup — run by installer after PostgreSQL is installed.
 * Creates the ehajiriPlanetInfosys_db database and dedicated user.
 * argv[2]: optional path to result file — written "OK" on success or "FAIL:<reason>" on error
 *          so the installer's GetPgSetupMode() can tell install-service.bat which credentials
 *          to inject into the Windows service.
 */
import pg from 'pg';
import fs from 'fs';
const { Client } = pg;

const DB_NAME     = 'ehajiriPlanetInfosys_db';
const DB_USER     = 'ehajiri';
const DB_PASSWORD = 'Eh@jiri2026!@Pl@nE!iNfOsYS';
const RESULT_FILE = process.argv[2] || null;

function writeResult(text) {
  if (RESULT_FILE) {
    try { fs.writeFileSync(RESULT_FILE, text); } catch {}
  }
}

async function setup() {
  const admin = new Client({
    host: 'localhost', port: 5432,
    user: 'postgres', password: 'ehajiri2024',
    database: 'postgres',
  });

  try {
    await admin.connect();

    // Create dedicated user if absent
    await admin.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${DB_USER}') THEN
          CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}';
        ELSE
          ALTER ROLE ${DB_USER} PASSWORD '${DB_PASSWORD}';
        END IF;
      END $$;
    `);

    // Create database if absent
    const { rows } = await admin.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`, [DB_NAME]
    );
    if (rows.length === 0) {
      await admin.query(`CREATE DATABASE "${DB_NAME}" OWNER ${DB_USER}`);
    }

    // Ensure privileges
    await admin.query(`GRANT ALL PRIVILEGES ON DATABASE "${DB_NAME}" TO ${DB_USER}`);

    console.log('Database setup complete.');
    writeResult('OK');
  } catch (e) {
    console.error('DB setup error:', e.message);
    writeResult(`FAIL:${e.message}`);
    process.exit(1);
  } finally {
    await admin.end();
  }
}

setup();
