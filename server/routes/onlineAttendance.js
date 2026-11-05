import { Router } from 'express';
import pool from '../db.js';
import { authorizeRecoAction, authorizeOwnEditDelete } from '../services/recoApprovalGuard.js';
import { logAudit } from '../services/auditLog.js';
import { reverseGeocode } from '../services/geocode.js';
import { notifyApproversOf, notifyApplicantOf } from '../services/approvalNotify.js';

const router = Router();

const SEL = `
  id, employee_id AS "employeeId", date,
  check_in_at AS "checkInAt", check_in_lat AS "checkInLat", check_in_lng AS "checkInLng",
  check_in_accuracy AS "checkInAccuracy", check_in_device AS "checkInDevice", check_in_place AS "checkInPlace",
  check_out_at AS "checkOutAt", check_out_lat AS "checkOutLat", check_out_lng AS "checkOutLng",
  check_out_accuracy AS "checkOutAccuracy", check_out_device AS "checkOutDevice", check_out_place AS "checkOutPlace",
  status, recommended_by AS "recommendedBy", recommended_date AS "recommendedDate",
  approved_by AS "approvedBy", approved_date AS "approvedDate", comment,
  created_at AS "createdAt"
`;

// req.user is only the JWT payload (id/role/branch/department — see
// authGuard.js), never fresh DB columns, and the token can be up to 30 days
// old — so whether Online Attendance is enabled for this account has to be
// re-checked against the DB on every write, not trusted from the token or
// from whatever the client claims.
async function isEnabledForUser(userId) {
  const { rows } = await pool.query('SELECT online_attendance_enabled FROM users WHERE id=$1', [userId]);
  return !!rows[0]?.online_attendance_enabled;
}

const clientIp = (req) => (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim() || null;

/* GET /geocode?lat=&lng= — the readable place name for a position (shown on the check-in screen before the person taps). */
router.get('/geocode', async (req, res) => {
  const place = await reverseGeocode(req.query.lat, req.query.lng);
  res.json({ place });
});

// Look the place name up AFTER the punch is saved (never delays or blocks a check-in) and store it on the row.
function savePlaceLater(id, which, lat, lng) {
  reverseGeocode(lat, lng).then(place => {
    if (place) return pool.query(`UPDATE online_attendance SET ${which === 'in' ? 'check_in_place' : 'check_out_place'}=$1 WHERE id=$2`, [place, id]);
  }).catch(() => {});
}

/* GET /today — the caller's own record for today (Nepal calendar date, via
   CURRENT_DATE — every pool connection is opened with timezone=Asia/Kathmandu,
   see db.js), or null. Drives the FAB modal's Check In / Check Out / Done state. */
router.get('/today', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${SEL} FROM online_attendance WHERE employee_id=$1 AND date=CURRENT_DATE`,
      [req.user.id]
    );
    res.json(rows[0] || null);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* Everyone's own history (self) plus everyone else's for managers/admins to
   review — no server-side role filtering, same as GET /api/leaves; the
   Approval screen and "My Online Attendance" history both read this and
   filter client-side by employeeId, matching leaves.js's own precedent. */
router.get('/', async (_req, res) => {
  try {
    const { rows } = await pool.query(`SELECT ${SEL} FROM online_attendance ORDER BY date DESC, id DESC`);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/check-in', async (req, res) => {
  const { lat, lng, accuracy, deviceInfo } = req.body;
  if (lat == null || lng == null) return res.status(400).json({ error: 'Location is required to check in.' });
  try {
    if (!(await isEnabledForUser(req.user.id))) {
      return res.status(403).json({ error: 'Online Attendance is not enabled for your account.' });
    }
    const { rows: existing } = await pool.query(
      `SELECT id FROM online_attendance WHERE employee_id=$1 AND date=CURRENT_DATE AND check_in_at IS NOT NULL`,
      [req.user.id]
    );
    if (existing[0]) return res.status(409).json({ error: 'You have already checked in today.' });

    const { rows } = await pool.query(
      `INSERT INTO online_attendance
         (employee_id, date, check_in_at, check_in_lat, check_in_lng, check_in_accuracy, check_in_device, check_in_ip)
       VALUES ($1, CURRENT_DATE, NOW(), $2, $3, $4, $5, $6)
       ON CONFLICT (employee_id, date) DO UPDATE
         SET check_in_at=NOW(), check_in_lat=$2, check_in_lng=$3, check_in_accuracy=$4, check_in_device=$5, check_in_ip=$6
       RETURNING ${SEL}`,
      [req.user.id, lat, lng, accuracy ?? null, String(deviceInfo || '').slice(0, 500), clientIp(req)]
    );
    savePlaceLater(rows[0].id, 'in', lat, lng);
    logAudit({ actor: req.user, action: 'check-in', entity: 'online_attendance', entityId: rows[0].id, before: null, after: rows[0] });
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/check-out', async (req, res) => {
  const { lat, lng, accuracy, deviceInfo } = req.body;
  if (lat == null || lng == null) return res.status(400).json({ error: 'Location is required to check out.' });
  try {
    if (!(await isEnabledForUser(req.user.id))) {
      return res.status(403).json({ error: 'Online Attendance is not enabled for your account.' });
    }
    const { rows: existing } = await pool.query(
      `SELECT id, check_in_at, check_out_at FROM online_attendance WHERE employee_id=$1 AND date=CURRENT_DATE`,
      [req.user.id]
    );
    if (!existing[0]?.check_in_at) return res.status(404).json({ error: 'Check in first before checking out.' });
    if (existing[0].check_out_at) return res.status(409).json({ error: 'You have already checked out today.' });

    const { rows } = await pool.query(
      `UPDATE online_attendance
       SET check_out_at=NOW(), check_out_lat=$1, check_out_lng=$2, check_out_accuracy=$3, check_out_device=$4, check_out_ip=$5, updated_at=NOW()
       WHERE id=$6 RETURNING ${SEL}`,
      [lat, lng, accuracy ?? null, String(deviceInfo || '').slice(0, 500), clientIp(req), existing[0].id]
    );
    savePlaceLater(rows[0].id, 'out', lat, lng);
    // the day is complete: tell whoever has to approve it (inbox + website toast + phone push)
    pool.query('SELECT full_name FROM users WHERE id=$1', [req.user.id]).then(({ rows: [u] }) => notifyApproversOf(req.user.id, {
      subject: `Online attendance for approval: ${u?.full_name || ''}`,
      body: `${u?.full_name || 'A staff member'} checked in and out online today and is waiting for your approval.`,
      path: '/m/approvals',
    })).catch(() => {});
    logAudit({ actor: req.user, action: 'check-out', entity: 'online_attendance', entityId: rows[0].id, before: null, after: rows[0] });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:id/recommend', async (req, res) => {
  try {
    const { rows: existing } = await pool.query('SELECT employee_id FROM online_attendance WHERE id=$1', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Record not found' });
    const authError = await authorizeRecoAction(req, existing[0].employee_id, 'recommend');
    if (authError) return res.status(authError.status).json({ error: authError.error });

    const { rows } = await pool.query(
      `UPDATE online_attendance SET recommended_by=$1, recommended_date=CURRENT_DATE, comment=COALESCE(NULLIF($3,''), comment), updated_at=NOW() WHERE id=$2 RETURNING ${SEL}`,
      [req.user.id, req.params.id, String(req.body?.comment || '').slice(0, 500)]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Approving is the one moment an online check-in/out becomes REAL
// attendance: it gets mirrored into zkteco_attendance_logs (as two rows —
// check-in and check-out) so it's picked up by every existing Daily/Monthly/
// Yearly present-absent-late report for free, without touching any of those
// report queries. check_type is never actually read anywhere in
// attendance.js's report logic (confirmed) — those reports infer IN vs OUT
// purely from chronological check_time ordering within the day, so we only
// need correct timestamps here. pin must be NOT NULL on that table — use the
// employee's own device PIN when they have one on file (so this behaves
// exactly like a real device punch for any report that joins on pin), else a
// synthetic 'ONLINE<id>' pin so the insert never fails for an employee who's
// never been assigned a physical device PIN.
router.patch('/:id/approve', async (req, res) => {
  const { comment } = req.body;
  const client = await pool.connect();
  try {
    const { rows: existing } = await client.query(
      'SELECT employee_id, recommended_by, check_in_at, check_out_at, synced_to_logs FROM online_attendance WHERE id=$1',
      [req.params.id]
    );
    if (!existing[0]) { client.release(); return res.status(404).json({ error: 'Record not found' }); }
    const authError = await authorizeRecoAction(req, existing[0].employee_id, 'approve',
      { alreadyRecommended: !!existing[0].recommended_by });
    if (authError) { client.release(); return res.status(authError.status).json({ error: authError.error }); }

    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE online_attendance SET status='approved', approved_by=$1, approved_date=CURRENT_DATE, comment=$2, updated_at=NOW()
       WHERE id=$3 RETURNING *`,
      [req.user.id, comment || '', req.params.id]
    );
    const row = rows[0];

    if (!row.synced_to_logs && row.check_in_at && row.check_out_at) {
      const { rows: empRows } = await client.query('SELECT device_id FROM users WHERE id=$1', [row.employee_id]);
      const pin = empRows[0]?.device_id || `ONLINE${row.employee_id}`;
      await client.query(
        `INSERT INTO zkteco_attendance_logs (device_sn, pin, check_time, employee_id, raw_line)
         VALUES ('ONLINE', $1, $2, $3, 'ONLINE_ATTENDANCE check-in'),
                ('ONLINE', $1, $4, $3, 'ONLINE_ATTENDANCE check-out')
         ON CONFLICT (device_sn, pin, check_time) DO NOTHING`,
        [pin, row.check_in_at, row.employee_id, row.check_out_at]
      );
      await client.query('UPDATE online_attendance SET synced_to_logs=true WHERE id=$1', [row.id]);
    }
    await client.query('COMMIT');

    const { rows: final } = await pool.query(`SELECT ${SEL} FROM online_attendance WHERE id=$1`, [req.params.id]);
    notifyApplicantOf(row.employee_id, req.user.id, { subject: 'Online attendance approved', body: `Your online attendance for ${String(final[0].date).slice(0, 10)} was approved.${comment ? ' ' + comment : ''}`, path: '/m/leave' });
    logAudit({ actor: req.user, action: 'approve', entity: 'online_attendance', entityId: req.params.id, before: null, after: final[0] });
    res.json(final[0]);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

router.patch('/:id/reject', async (req, res) => {
  const { comment } = req.body;
  try {
    const { rows: existing } = await pool.query('SELECT employee_id FROM online_attendance WHERE id=$1', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Record not found' });
    const authError = await authorizeRecoAction(req, existing[0].employee_id, 'reject');
    if (authError) return res.status(authError.status).json({ error: authError.error });

    const { rows } = await pool.query(
      `UPDATE online_attendance SET status='rejected', approved_by=$1, approved_date=CURRENT_DATE, comment=$2, updated_at=NOW()
       WHERE id=$3 RETURNING ${SEL}`,
      [req.user.id, comment || '', req.params.id]
    );
    notifyApplicantOf(existing[0].employee_id, req.user.id, { subject: 'Online attendance rejected', body: `Your online attendance for ${String(rows[0].date).slice(0, 10)} was rejected.${comment ? ' Reason: ' + comment : ''}`, path: '/m/leave' });
    logAudit({ actor: req.user, action: 'reject', entity: 'online_attendance', entityId: req.params.id, before: null, after: rows[0] });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const { rows: existing } = await pool.query('SELECT * FROM online_attendance WHERE id=$1', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Record not found' });
    const authError = authorizeOwnEditDelete(req, existing[0].employee_id, existing[0]);
    if (authError) return res.status(authError.status).json({ error: authError.error });

    await pool.query('DELETE FROM online_attendance WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
