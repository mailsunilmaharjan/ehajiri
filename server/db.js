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
  max     : 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
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
