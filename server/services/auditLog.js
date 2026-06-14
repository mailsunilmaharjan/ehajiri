import pool from '../db.js';
import { logError } from '../utils/logError.js';

let ensured = false;
export async function ensureAuditLogTable() {
  if (ensured) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id          SERIAL       PRIMARY KEY,
        actor_id    INTEGER      REFERENCES users(id),
        actor_role  VARCHAR(30),
        action      VARCHAR(50)  NOT NULL,
        entity      VARCHAR(50)  NOT NULL,
        entity_id   VARCHAR(50),
        before      JSONB,
        after       JSONB,
        created_at  TIMESTAMPTZ  DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity, entity_id);
    `);
    ensured = true;
  } catch (e) { logError('[ensureAuditLogTable]', e); }
}

/**
 * Records a who-changed-what entry. Failures are logged but never thrown —
 * audit logging must not block the mutation it observes.
 */
export async function logAudit({ actor, action, entity, entityId, before, after }) {
  try {
    await ensureAuditLogTable();
    await pool.query(
      `INSERT INTO audit_log (actor_id, actor_role, action, entity, entity_id, before, after)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        actor?.id ?? null,
        actor?.role ?? null,
        action,
        entity,
        entityId != null ? String(entityId) : null,
        before != null ? JSON.stringify(before) : null,
        after != null ? JSON.stringify(after) : null,
      ]
    );
  } catch (e) { logError('[logAudit]', e); }
}
