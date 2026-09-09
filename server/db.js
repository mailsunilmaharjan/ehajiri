import pg      from 'pg';
import dotenv  from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join }  from 'path';
import { logError } from './utils/logError.js';

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '.env') });

const { Pool, types } = pg;
// Return DATE columns as plain YYYY-MM-DD strings instead of JS Date objects.
// Without this, pg converts DATE → Date object → JSON.stringify → full ISO timestamp
// (e.g. "2026-06-02T18:15:00.000Z"), which breaks string-based date range comparisons.
types.setTypeParser(1082, v => v);

const pool = new Pool({
  host    : process.env.DB_HOST || 'localhost',
  port    : parseInt(process.env.DB_PORT || '5432'),
  user    : process.env.DB_USER || 'postgres',
  password: process.env.DB_PASS || 'postgres',
  database: process.env.DB_NAME || 'ehajiri_db',
  // Every tenant is its own Node process, each with its own pool against the
  // SAME shared Postgres server (max_connections) — at max:10, N tenants can
  // demand up to 10*N connections in the worst case, which outgrows the
  // server's ceiling long before any single tenant is actually using 10 at
  // once (26 tenants × 10 = 260 vs. a 100-connection server). Lowered to 5,
  // alongside raising the server's own max_connections, after this exact
  // scenario locked a tenant out with "remaining connection slots are
  // reserved for roles with the SUPERUSER attribute" while every other
  // tenant's pool sat mostly idle.
  max     : 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  // Every report/dashboard query buckets attendance by calendar day via
  // `check_time::date` / CURRENT_DATE, which resolve using the session's
  // timezone — without this, that defaults to the OS/server's own timezone
  // (confirmed America/Los_Angeles on this box), silently shifting Nepal
  // daytime punches onto the wrong calendar day (~13h offset from UTC+5:45)
  // and making "today" disappear from every report until well past midnight.
  options : '-c timezone=Asia/Kathmandu',
});

pool.on('error', (err) => logError('[pg pool error]', err));

export const testConnection = async () => {
  try {
    const client = await pool.connect();
    client.release();
    return true;
  } catch (err) {
    logError('[pg testConnection]', err);
    return false;
  }
};

export default pool;
