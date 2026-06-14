/**
 * Simple SQL Migration Runner
 * Files: server/migrations/V001__description.sql, V002__description.sql …
 * Tracks applied versions in schema_migrations table.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

export async function runMigrations() {
  console.log('🔄 Checking database migrations …');

  // Ensure tracking table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version   INTEGER      PRIMARY KEY,
      name      VARCHAR(255) NOT NULL,
      applied_at TIMESTAMP   DEFAULT NOW()
    );
  `);

  // Get applied versions
  const { rows } = await pool.query(
    'SELECT version FROM schema_migrations ORDER BY version ASC'
  );
  const applied = new Set(rows.map(r => r.version));

  // Discover migration files
  let files = [];
  try {
    files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => /^V\d+__.*\.sql$/.test(f))
      .sort((a, b) => {
        const va = parseInt(a.match(/^V(\d+)/)[1]);
        const vb = parseInt(b.match(/^V(\d+)/)[1]);
        return va - vb;
      });
  } catch (e) {
    console.warn('No migrations directory found, skipping.');
    return;
  }

  let count = 0;
  for (const file of files) {
    const [, vStr, name] = file.match(/^V(\d+)__(.+)\.sql$/);
    const version = parseInt(vStr);

    if (applied.has(version)) continue;

    console.log(`  ↳ Applying V${String(version).padStart(3,'0')} — ${name.replace(/_/g,' ')}`);
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
        [version, name]
      );
      await client.query('COMMIT');
      count++;
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`  ✗ Migration V${vStr} FAILED:`, err.message);
      throw err;
    } finally {
      client.release();
    }
  }

  if (count === 0) console.log('  ✓ All migrations up to date.');
  else             console.log(`  ✓ Applied ${count} migration(s).`);
}

export async function getSchemaVersion() {
  try {
    const { rows } = await pool.query(
      'SELECT MAX(version) AS ver FROM schema_migrations'
    );
    return rows[0]?.ver ?? 0;
  } catch { return 0; }
}
