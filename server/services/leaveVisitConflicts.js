import pool from '../db.js';

/**
 * One staff member can't have two leave / office-visit entries on the same
 * day. Checked on every save path — Leave/Office Visit Application, Manual
 * Posting, and Edit — so none of them can create an overlap (the client-side
 * check in Manual Leave Posting alone let duplicates in through every other
 * form). Rejected entries don't count.
 *
 *   kind        'leave' | 'visit' — what is being saved
 *   employeeId  the staff member it is for
 *   fromDate / toDate   YYYY-MM-DD, inclusive
 *   leaveTypeCode       (leave only) for the "identical entry" duplicate test
 *   excludeId   the row being edited, so it doesn't clash with itself
 *
 * Returns null when there's no clash, else { error, conflict } for a 409.
 */
export async function findLeaveVisitConflict({ kind, employeeId, fromDate, toDate, leaveTypeCode, excludeId = null }) {
  if (!employeeId || !fromDate || !toDate) return null;
  const from = String(fromDate).slice(0, 10);
  const to   = String(toDate).slice(0, 10);

  const overlapSql = (table) => `
    SELECT id, from_date::text AS "fromDate", to_date::text AS "toDate"
           ${table === 'leaves' ? ', leave_type_code AS "leaveTypeCode"' : ''}
    FROM ${table}
    WHERE employee_id = $1 AND status IS DISTINCT FROM 'rejected'
      AND from_date <= $3 AND to_date >= $2
      ${kind === (table === 'leaves' ? 'leave' : 'visit') ? 'AND ($4::int IS NULL OR id <> $4::int)' : ''}
    ORDER BY from_date LIMIT 20`;
  const sameKindParams = [employeeId, from, to, excludeId];
  const otherKindParams = [employeeId, from, to];

  const [{ rows: leaves }, { rows: visits }] = await Promise.all([
    pool.query(overlapSql('leaves'),        kind === 'leave' ? sameKindParams : otherKindParams),
    pool.query(overlapSql('office_visits'), kind === 'visit' ? sameKindParams : otherKindParams),
  ]);

  const same  = kind === 'leave' ? leaves : visits;
  const other = kind === 'leave' ? visits : leaves;
  const conflict = (type, row) => ({ type, id: row.id, fromDate: row.fromDate, toDate: row.toDate, leaveTypeCode: row.leaveTypeCode || null });

  const dup = same.find(r => r.fromDate === from && r.toDate === to
    && (kind === 'visit' || r.leaveTypeCode === leaveTypeCode));
  if (dup) return { error: kind === 'leave'
    ? 'Duplicate entry — an identical leave has already been recorded for this staff member on the selected date. It cannot be saved again.'
    : 'Duplicate entry — an identical office visit has already been recorded for this staff member on the selected date. It cannot be saved again.', conflict: conflict(kind, dup) };
  if (same.length) {
    return { error: kind === 'leave'
      ? 'This staff member already has another leave on the selected day. Only one leave can be recorded per day — please choose a different date or review the existing entry.'
      : 'This staff member already has another office visit on the selected day. Only one entry can be recorded per day — please choose a different date or review the existing entry.',
             conflict: conflict(kind, same[0]) };
  }
  if (other.length) {
    return { error: kind === 'leave'
      ? 'This staff member already has an office visit on the selected day, so a leave cannot be saved for the same day. Please choose a different date or review the existing entry.'
      : 'This staff member already has a leave on the selected day, so an office visit cannot be saved for the same day. Please choose a different date or review the existing entry.',
             conflict: conflict(kind === 'leave' ? 'visit' : 'leave', other[0]) };
  }
  return null;
}
