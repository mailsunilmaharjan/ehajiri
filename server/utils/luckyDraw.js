import pool from '../db.js';

// Marks a guest attended (if not already) and — the first time only — hands
// them the next sequential lucky-draw ticket number for that event.
// pg_advisory_xact_lock serializes concurrent check-ins for the SAME event
// (many phones scanning the QR within seconds of each other at the door),
// so two guests can never be handed the same number; unrelated events never
// block each other since the lock key is the event's own id.
export async function checkInGuest(guestId, eventId, extraWhereSql = '', extraParams = []) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [eventId]);
    const { rows } = await client.query(
      `UPDATE event_guests
       SET attended=TRUE, checked_in_at = COALESCE(checked_in_at, NOW()), updated_at=NOW(),
           lucky_draw_no = COALESCE(lucky_draw_no,
             (SELECT COALESCE(MAX(lucky_draw_no), 0) + 1 FROM event_guests WHERE event_id=$2))
       WHERE id=$1 AND event_id=$2 ${extraWhereSql}
       RETURNING id, name, attended, checked_in_at AS "checkedInAt", lucky_draw_no AS "luckyDrawNo"`,
      [guestId, eventId, ...extraParams]
    );
    await client.query('COMMIT');
    return rows[0] || null;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// Same locking/numbering, but for a brand new guest row created already
// checked-in (self-registration — nobody to UPDATE yet).
export async function insertCheckedInGuest(eventId, insertFn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [eventId]);
    const row = await insertFn(client);
    await client.query('COMMIT');
    return row;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
