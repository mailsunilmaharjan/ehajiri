/* Thin DB layer for the Accounts module — keeps the call shape of the NepalAccounts demo's db.py:
 *
 *     await q('SELECT ... WHERE id = %s', [1])   ->  { rows: [...], rowcount: n }
 *     await one('SELECT ...', [..])              ->  first row or null
 *     await tx(async (t) => { await t.query(...); const r = await t.one(...); })
 *
 * `%s` placeholders are rewritten to $1, $2 … so the ported SQL reads like the original.
 *
 * Result typing (applied per query, never globally, so the rest of eHajiri is unaffected):
 *   NUMERIC / FLOAT -> JS number     (money and quantities are used in arithmetic)
 *   BIGINT (COUNT)  -> JS number
 *   TIMESTAMP(TZ)   -> 'YYYY-MM-DD HH:MM:SS' in Nepal time (the pool's session timezone)
 *   DATE            -> 'YYYY-MM-DD'  (already global in server/db.js)
 *
 * IMPORTANT — inside tx() always use `t`, never q()/one(): those run on a different pooled
 * connection and would not see the transaction's uncommitted rows.
 */
import pg from 'pg';
import pool from '../../db.js';

const NUMERIC_OIDS = new Set([1700, 700, 701]);
const BIGINT_OID = 20;
const TS_OIDS = new Set([1114, 1184]);

const types = {
  getTypeParser(oid, format) {
    if (NUMERIC_OIDS.has(oid)) return (v) => (v === null ? null : parseFloat(v));
    if (oid === BIGINT_OID) return (v) => (v === null ? null : parseInt(v, 10));
    if (TS_OIDS.has(oid)) return (v) => (v === null ? null : String(v).slice(0, 19));
    return pg.types.getTypeParser(oid, format);
  },
};

function convert(sql) {
  let i = 0;
  return sql.replace(/%s/g, () => `$${++i}`);
}

function runner(target) {
  const query = async (sql, params = []) => {
    const res = await target.query({ text: convert(sql), values: params, types });
    return { rows: res.rows, rowcount: res.rowCount };
  };
  const one = async (sql, params = []) => (await query(sql, params)).rows[0] || null;
  return { query, one };
}

const base = runner(pool);
export const q = base.query;
export const one = base.one;

/** All-or-nothing block. `t` has the same query()/one() shape. */
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn({ ...runner(client), client });
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Serialises numbering (voucher / document sequences) across concurrent requests. */
export async function advisoryLock(t, key) {
  await t.client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`acc:${key}`]);
}

/** `(%s, %s, %s)` placeholder list for an IN (...) clause. */
export const marks = (arr) => arr.map(() => '%s').join(',');
