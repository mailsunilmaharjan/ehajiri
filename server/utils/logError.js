/**
 * console.error wrapper that can never print a blank detail.
 *
 * node-postgres reports connection failures (ECONNREFUSED, the AggregateError
 * it throws when both ::1 and 127.0.0.1 refuse a "localhost" connection, DNS
 * lookup failures, etc.) with an empty `.message` — so `console.error(label,
 * err.message)` silently logs nothing useful right when it matters most (e.g.
 * "PostgreSQL service isn't running"). This falls back through `.code`,
 * aggregated sub-error messages, and finally `String(err)`, and appends the
 * stack trace so the failure is always actionable from the log alone.
 */
export function logError(label, err) {
  const detail =
    err?.message ||
    err?.code ||
    err?.errors?.map(e => e?.message || e?.code).filter(Boolean).join('; ') ||
    String(err);
  console.error(label, detail, err?.stack ? `\n${err.stack}` : '');
}
