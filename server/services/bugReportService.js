import pool from '../db.js';

/**
 * Insert one row into bug_reports. Never throws — a failure here must never
 * take down the request/process that triggered it, so callers can fire this
 * and forget.
 */
export async function logBugReport({ source, page, method = null, statusCode = null, message, stack = null, userId = null }) {
  try {
    await pool.query(
      `INSERT INTO bug_reports (source, page, method, status_code, message, stack, user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        source === 'backend' ? 'backend' : 'frontend',
        page ? String(page).slice(0, 255) : null,
        method,
        statusCode,
        String(message || 'Unknown error').slice(0, 5000),
        stack ? String(stack).slice(0, 10000) : null,
        userId,
      ]
    );
  } catch (e) {
    console.error('[BugReports] failed to log:', e.message);
  }
}
