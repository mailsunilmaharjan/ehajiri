import { Router } from 'express';
import pool from '../db.js';
import { userCanAccessTask, notifyOnCompletion, notifyStatusChanged } from './tasks.js';
import { estimateBikeTrip } from '../utils/geoUtils.js';
import { resolveEmployeeScope } from './attendanceScope.js';
import { reverseGeocode } from '../services/geocode.js';

const router = Router();

// A "trip" out of the office: one field_visit_sessions row (Office Out ->
// Office In) containing one or more field_visit_stops rows (Client In ->
// Client Out, one per field-visit task visited along the way) — see
// server/migrations/runner.js v126. Mirrors the existing GPS check-in/out
// pattern from server/routes/onlineAttendance.js (mandatory lat/lng, 400 if
// missing), but scoped to a Field Visit task instead of a daily attendance
// punch, and allowing several stops per trip via "Next Field Visit".
// Check-in only collects location + remarks (arrival is just "I'm here");
// the status question only makes sense once the visit is actually over, so
// check_in_work_progress is never populated by this route — only check-out
// asks for it, against this closing-status set. Checking out also syncs onto
// the task itself: Work Done completes it, Pending for Next Day reopens it
// to in_progress (mirrors the grid's own complete/reopen toggle so nobody
// has to separately go mark the task done after finishing its field visit);
// Cancelled deliberately leaves the task's status untouched — the visit
// itself didn't resolve anything either way.
const CHECKOUT_STATUS = ['work_done', 'pending_next_day', 'cancelled'];
const CHECKOUT_STATUS_TO_TASK_STATUS = { work_done: 'completed', pending_next_day: 'in_progress' };

// Readable place name for a GPS fix, filled in after the response (never blocks or fails a punch).
function savePlaceLater(table, column, id, lat, lng) {
  reverseGeocode(lat, lng).then(place => {
    if (place) return pool.query(`UPDATE ${table} SET ${column}=$1 WHERE id=$2`, [place, id]);
  }).catch(() => {});
}
// Keep the company's Office Location on record: the first real Office Out / Office In GPS fix fills it in when
// Settings > Company Information has none yet. Later fixes are kept on each trip (see office_out_* / office_in_*).
function rememberOfficeLocation(lat, lng) {
  pool.query(
    `UPDATE app_settings
        SET value = jsonb_set(jsonb_set(value::jsonb, '{officeLatitude}', to_jsonb($1::float8)), '{officeLongitude}', to_jsonb($2::float8))
      WHERE key='main' AND COALESCE(value::jsonb->>'officeLatitude', '') = ''`, [lat, lng]).catch(() => {});
}

const NEPAL_OFFSET_MS = (5 * 60 + 45) * 60 * 1000;
const NEPAL_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function nepalDateTimeLabel(d = new Date()) {
  const n = new Date(d.getTime() + NEPAL_OFFSET_MS);
  return `${n.getUTCDate()}-${NEPAL_MONTHS[n.getUTCMonth()]} ${String(n.getUTCHours()).padStart(2, '0')}:${String(n.getUTCMinutes()).padStart(2, '0')}`;
}

const SESSION_SEL = `
  fs.id, fs.employee_id AS "employeeId",
  fs.office_out_at AS "officeOutAt", fs.office_out_lat AS "officeOutLat", fs.office_out_lng AS "officeOutLng", fs.office_out_place AS "officeOutPlace",
  fs.office_in_at AS "officeInAt", fs.office_in_lat AS "officeInLat", fs.office_in_lng AS "officeInLng",
  fs.office_in_accuracy AS "officeInAccuracy", fs.office_in_place AS "officeInPlace",
  fs.travel_km AS "travelKm", fs.travel_minutes AS "travelMinutes", fs.estimated_minutes AS "estimatedMinutes",
  fs.status, fs.created_at AS "createdAt"
`;

const STOP_SEL = `
  s.id, s.session_id AS "sessionId", s.task_id AS "taskId",
  s.check_in_at AS "checkInAt", s.check_in_lat AS "checkInLat", s.check_in_lng AS "checkInLng",
  s.check_in_accuracy AS "checkInAccuracy", s.check_in_work_progress AS "checkInWorkProgress",
  s.check_in_remarks AS "checkInRemarks",
  s.check_in_client_name AS "checkInClientName", s.check_in_location_name AS "checkInLocationName",
  s.travel_km AS "travelKm", s.travel_minutes AS "travelMinutes", s.estimated_minutes AS "estimatedMinutes",
  s.check_out_at AS "checkOutAt", s.check_out_lat AS "checkOutLat", s.check_out_lng AS "checkOutLng",
  s.check_out_accuracy AS "checkOutAccuracy", s.check_out_work_progress AS "checkOutWorkProgress",
  s.check_out_remarks AS "checkOutRemarks",
  s.check_in_place AS "checkInPlace", s.check_out_place AS "checkOutPlace",
  s.created_at AS "createdAt",
  t.title AS "taskTitle",
  COALESCE(c.company_name, c.person_name) AS "customerName",
  c.latitude AS "customerLat", c.longitude AS "customerLng",
  fs.employee_id AS "employeeId", eu.full_name AS "employeeName",
  fs.office_out_at AS "sessionOfficeOutAt",
  fs.office_in_at AS "sessionOfficeInAt",
  fs.office_in_lat AS "sessionOfficeInLat", fs.office_in_lng AS "sessionOfficeInLng",
  fs.travel_km AS "sessionReturnTravelKm", fs.travel_minutes AS "sessionReturnTravelMinutes",
  fs.estimated_minutes AS "sessionReturnEstimatedMinutes",
  (s.id = (SELECT MIN(s2.id) FROM field_visit_stops s2 WHERE s2.session_id = s.session_id)) AS "isFirstStopOfSession",
  (s.id = (SELECT MAX(s2.id) FROM field_visit_stops s2 WHERE s2.session_id = s.session_id)) AS "isLastStopOfSession"
`;
const STOP_JOINS = `
  FROM field_visit_stops s
  JOIN tasks t ON t.id = s.task_id
  LEFT JOIN staff_contacts c ON c.id = t.contact_id
  JOIN field_visit_sessions fs ON fs.id = s.session_id
  JOIN users eu ON eu.id = fs.employee_id
`;

// A field-visit task is only eligible to start/continue a trip against if
// it's actually flagged is_field_visit, not already completed, and the
// caller is one of its assignees — nobody else can plausibly be the one
// physically traveling to it.
async function assertEligibleFieldVisitTask(taskId, userId, queryable = pool) {
  const { rows } = await queryable.query(
    `SELECT 1 FROM tasks t JOIN task_assignees ta ON ta.task_id = t.id
     WHERE t.id=$1 AND t.is_field_visit = TRUE AND t.status != 'completed' AND ta.user_id=$2`,
    [taskId, userId]
  );
  return rows.length > 0;
}

async function getActiveSessionFull(employeeId, queryable = pool) {
  const { rows } = await queryable.query(
    `SELECT ${SESSION_SEL} FROM field_visit_sessions fs WHERE fs.employee_id=$1 AND fs.status='active'`,
    [employeeId]
  );
  if (!rows[0]) return null;
  const { rows: stops } = await queryable.query(
    `SELECT ${STOP_SEL} ${STOP_JOINS} WHERE s.session_id=$1 ORDER BY s.id ASC`,
    [rows[0].id]
  );
  return { ...rows[0], stops };
}

// The caller's own open trip (if any), with every stop so far — drives the
// journey bar on page load/refresh without losing state.
router.get('/session/active', async (req, res) => {
  try {
    res.json(await getActiveSessionFull(req.user.id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/session/start', async (req, res) => {
  const taskId = parseInt(req.body.taskId);
  const { lat, lng, accuracy, deviceInfo } = req.body;
  const hasFix = lat != null && lng != null && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
  if (!Number.isInteger(taskId)) return res.status(400).json({ error: 'taskId is required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (!(await assertEligibleFieldVisitTask(taskId, req.user.id, client))) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Field visit task not found or not assigned to you' });
    }
    const { rows: activeRows } = await client.query(
      `SELECT id FROM field_visit_sessions WHERE employee_id=$1 AND status='active'`,
      [req.user.id]
    );
    if (activeRows[0]) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'You already have an active field visit trip — check out from your current client or move to office first.' });
    }
    const { rows: sessionRows } = await client.query(
      `INSERT INTO field_visit_sessions (employee_id, office_out_lat, office_out_lng, office_out_accuracy, office_out_device)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [req.user.id, hasFix ? Number(lat) : null, hasFix ? Number(lng) : null, hasFix ? (accuracy ?? null) : null, String(deviceInfo || '').slice(0, 500) || null]
    );
    if (hasFix) { savePlaceLater('field_visit_sessions', 'office_out_place', sessionRows[0].id, Number(lat), Number(lng)); rememberOfficeLocation(Number(lat), Number(lng)); }
    await client.query(`INSERT INTO field_visit_stops (session_id, task_id) VALUES ($1,$2)`, [sessionRows[0].id, taskId]);
    await client.query('COMMIT');
    res.status(201).json(await getActiveSessionFull(req.user.id));
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

router.post('/stops/:id/check-in', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const { lat, lng, accuracy, deviceInfo, remarks, clientName, locationName } = req.body;
  if (lat == null || lng == null) return res.status(400).json({ error: 'Location is required to check in.' });
  // One connection for the whole action instead of 5-7 separate pool
  // checkouts — this route used to grab-and-release a connection per query,
  // which under concurrent Field Visit activity could starve the pool
  // (max: 5 per tenant, see db.js) enough to fail unrelated requests
  // elsewhere in the app, including licenseGuard's own check.
  const client = await pool.connect();
  try {
    const { rows: existing } = await client.query(
      `SELECT s.id, s.check_in_at, s.session_id, t.contact_id AS "contactId", fs.office_out_at AS "officeOutAt"
       FROM field_visit_stops s
       JOIN field_visit_sessions fs ON fs.id = s.session_id
       JOIN tasks t ON t.id = s.task_id
       WHERE s.id=$1 AND fs.employee_id=$2 AND fs.status='active'`,
      [id, req.user.id]
    );
    if (!existing[0]) return res.status(404).json({ error: 'Field visit stop not found' });
    if (existing[0].check_in_at) return res.status(409).json({ error: 'Already checked in at this stop' });

    // The actual travel leg into this stop — from the PREVIOUS stop's own
    // check-out point/time if there is one, otherwise from the office
    // (Settings > Company Information's Office Location) and this trip's own
    // office-out time. Duration is always computable (departure time is
    // always on file); distance only if a departure GPS point is on file too
    // (always true for a later stop, only true for the first stop if Office
    // Location has been set) — travelKm stays null otherwise rather than
    // guessing.
    const { rows: prevRows } = await client.query(
      `SELECT check_out_at, check_out_lat, check_out_lng FROM field_visit_stops
       WHERE session_id=$1 AND id < $2 ORDER BY id DESC LIMIT 1`,
      [existing[0].session_id, id]
    );
    let fromAt, fromLat, fromLng;
    if (prevRows[0]) {
      fromAt = prevRows[0].check_out_at; fromLat = prevRows[0].check_out_lat; fromLng = prevRows[0].check_out_lng;
    } else {
      fromAt = existing[0].officeOutAt;
      const { rows: settingsRows } = await client.query(`SELECT value FROM app_settings WHERE key='main'`);
      const main = typeof settingsRows[0]?.value === 'string' ? JSON.parse(settingsRows[0].value) : settingsRows[0]?.value;
      fromLat = main?.officeLatitude ?? null;
      fromLng = main?.officeLongitude ?? null;
    }
    const checkInAt = new Date();
    const travelMinutes = fromAt != null ? Math.max(0, Math.round((checkInAt - new Date(fromAt)) / 60000)) : null;
    let travelKm = null, estimatedMinutes = null;
    if (fromLat != null && fromLng != null) {
      ({ km: travelKm, minutes: estimatedMinutes } = estimateBikeTrip(fromLat, fromLng, lat, lng));
    }

    await client.query('BEGIN');
    await client.query(
      `UPDATE field_visit_stops
       SET check_in_at=$1, check_in_lat=$2, check_in_lng=$3, check_in_accuracy=$4, check_in_device=$5,
           check_in_remarks=$6, check_in_client_name=$7, check_in_location_name=$8,
           travel_km=$9, travel_minutes=$10, estimated_minutes=$11
       WHERE id=$12`,
      [checkInAt, lat, lng, accuracy ?? null, String(deviceInfo || '').slice(0, 500), remarks || null,
       clientName || null, locationName || null, travelKm, travelMinutes, estimatedMinutes, id]
    );
    // Refresh the client's stored coordinates from this real GPS fix — future
    // reference for travel-time estimation, see the "Note" in the feature request.
    if (existing[0].contactId) {
      await client.query(`UPDATE staff_contacts SET latitude=$1, longitude=$2, updated_at=NOW() WHERE id=$3`, [lat, lng, existing[0].contactId]);
    }
    await client.query('COMMIT');
    savePlaceLater('field_visit_stops', 'check_in_place', id, lat, lng);
    res.json(await getActiveSessionFull(req.user.id, client));
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

router.post('/stops/:id/check-out', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const { lat, lng, accuracy, deviceInfo, workProgress, remarks } = req.body;
  if (lat == null || lng == null) return res.status(400).json({ error: 'Location is required to check out.' });
  if (!CHECKOUT_STATUS.includes(workProgress)) return res.status(400).json({ error: 'Invalid status' });
  // Single connection for the whole action — see the same note on /check-in.
  const client = await pool.connect();
  try {
    const { rows: existing } = await client.query(
      `SELECT s.id, s.check_in_at, s.check_out_at, s.task_id AS "taskId",
              t.status AS "taskStatus", t.title AS "taskTitle", t.created_by AS "taskCreatedBy", t.description AS "taskDescription"
       FROM field_visit_stops s
       JOIN field_visit_sessions fs ON fs.id = s.session_id
       JOIN tasks t ON t.id = s.task_id
       WHERE s.id=$1 AND fs.employee_id=$2 AND fs.status='active'`,
      [id, req.user.id]
    );
    if (!existing[0]) return res.status(404).json({ error: 'Field visit stop not found' });
    if (!existing[0].check_in_at) return res.status(409).json({ error: 'Check in at this client before checking out.' });
    if (existing[0].check_out_at) return res.status(409).json({ error: 'Already checked out from this stop' });

    // Sync onto the task itself — status (Cancelled leaves it untouched) and
    // remarks appended as a dated note, never overwriting whatever was
    // already in the Description.
    const taskId = existing[0].taskId;
    const newTaskDescription = remarks
      ? `${existing[0].taskDescription || ''}${existing[0].taskDescription ? '\n\n' : ''}🚗 Field Visit (${nepalDateTimeLabel()}): ${remarks}`
      : null;
    const newTaskStatus = CHECKOUT_STATUS_TO_TASK_STATUS[workProgress];
    const statusChanging = newTaskStatus && newTaskStatus !== existing[0].taskStatus;

    await client.query('BEGIN');
    await client.query(
      `UPDATE field_visit_stops
       SET check_out_at=NOW(), check_out_lat=$1, check_out_lng=$2, check_out_accuracy=$3, check_out_device=$4,
           check_out_work_progress=$5, check_out_remarks=$6
       WHERE id=$7`,
      [lat, lng, accuracy ?? null, String(deviceInfo || '').slice(0, 500), workProgress, remarks || null, id]
    );
    if (statusChanging || newTaskDescription != null) {
      await client.query(
        `UPDATE tasks SET
           status=COALESCE($1::varchar, status), updated_at=NOW(),
           completed_at = CASE WHEN $1 = 'completed' THEN NOW() WHEN $1 IS NOT NULL THEN NULL ELSE completed_at END,
           description = COALESCE($2, description)
         WHERE id=$3`,
        [statusChanging ? newTaskStatus : null, newTaskDescription, taskId]
      );
    }
    let assigneeIds = [];
    if (statusChanging) {
      const { rows: assigneeRows } = await client.query('SELECT user_id FROM task_assignees WHERE task_id=$1', [taskId]);
      assigneeIds = assigneeRows.map(r => r.user_id);
    }
    await client.query('COMMIT');
    savePlaceLater('field_visit_stops', 'check_out_place', id, lat, lng);

    // Notifications happen after COMMIT — no reason to hold the transaction
    // open (and a connection tied up) while sending email/pushes.
    if (statusChanging) {
      if (newTaskStatus === 'completed') {
        await notifyOnCompletion(taskId, existing[0].taskTitle, existing[0].taskCreatedBy, assigneeIds, req.user.id, true);
      } else {
        await notifyStatusChanged(taskId, existing[0].taskTitle, newTaskStatus, existing[0].taskCreatedBy, assigneeIds, req.user.id, true);
      }
    }

    res.json(await getActiveSessionFull(req.user.id, client));
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// "Next Field Visit" — same trip, another client, no need to return to the
// office in between. Only allowed once the current (latest) stop is closed.
router.post('/sessions/:id/next-stop', async (req, res) => {
  const id = parseInt(req.params.id);
  const taskId = parseInt(req.body.taskId);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  if (!Number.isInteger(taskId)) return res.status(400).json({ error: 'taskId is required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: sessionRows } = await client.query(
      `SELECT id FROM field_visit_sessions WHERE id=$1 AND employee_id=$2 AND status='active'`,
      [id, req.user.id]
    );
    if (!sessionRows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Active field visit trip not found' }); }
    const { rows: latestRows } = await client.query(
      `SELECT id, check_out_at FROM field_visit_stops WHERE session_id=$1 ORDER BY id DESC LIMIT 1`,
      [id]
    );
    if (latestRows[0] && !latestRows[0].check_out_at) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Check out from your current client before starting the next field visit.' });
    }
    if (!(await assertEligibleFieldVisitTask(taskId, req.user.id, client))) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Field visit task not found or not assigned to you' });
    }
    await client.query(`INSERT INTO field_visit_stops (session_id, task_id) VALUES ($1,$2)`, [id, taskId]);
    await client.query('COMMIT');
    res.status(201).json(await getActiveSessionFull(req.user.id));
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// "Move to Office" — closes the trip. Mirrors a client Check In: mandatory
// GPS (confirms they're actually back), and the same real-duration +
// estimated-distance/time computed for the return leg (from the last stop's
// own check-out point/time — always on file, since a stop must already be
// checked out before this route accepts the request).
router.post('/sessions/:id/office-in', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const { lat, lng, accuracy, deviceInfo } = req.body;
  if (lat == null || lng == null) return res.status(400).json({ error: 'Location is required to check in at office.' });
  // Single connection for the whole action — see the same note on /check-in.
  const client = await pool.connect();
  try {
    const { rows: sessionRows } = await client.query(
      `SELECT id FROM field_visit_sessions WHERE id=$1 AND employee_id=$2 AND status='active'`,
      [id, req.user.id]
    );
    if (!sessionRows[0]) return res.status(404).json({ error: 'Active field visit trip not found' });
    const { rows: latestRows } = await client.query(
      `SELECT id, check_out_at, check_out_lat, check_out_lng FROM field_visit_stops WHERE session_id=$1 ORDER BY id DESC LIMIT 1`,
      [id]
    );
    if (latestRows[0] && !latestRows[0].check_out_at) {
      return res.status(409).json({ error: 'Check out from your current client before moving to office.' });
    }
    const fromAt  = latestRows[0]?.check_out_at ?? null;
    const fromLat = latestRows[0]?.check_out_lat ?? null;
    const fromLng = latestRows[0]?.check_out_lng ?? null;

    const officeInAt = new Date();
    const travelMinutes = fromAt != null ? Math.max(0, Math.round((officeInAt - new Date(fromAt)) / 60000)) : null;
    let travelKm = null, estimatedMinutes = null;
    if (fromLat != null && fromLng != null) {
      ({ km: travelKm, minutes: estimatedMinutes } = estimateBikeTrip(fromLat, fromLng, lat, lng));
    }

    await client.query(
      `UPDATE field_visit_sessions
       SET office_in_at=$1, office_in_lat=$2, office_in_lng=$3, office_in_accuracy=$4, office_in_device=$5,
           travel_km=$6, travel_minutes=$7, estimated_minutes=$8, status='completed'
       WHERE id=$9`,
      [officeInAt, lat, lng, accuracy ?? null, String(deviceInfo || '').slice(0, 500), travelKm, travelMinutes, estimatedMinutes, id]
    );
    savePlaceLater('field_visit_sessions', 'office_in_place', id, lat, lng);
    rememberOfficeLocation(lat, lng);
    res.json({ success: true, officeInAt, travelKm, travelMinutes, estimatedMinutes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// Read-only visit history for one task — same wider audience as the task's
// own Followup History (userCanAccessTask, imported from tasks.js): the
// task's creator/any assignee, admin/superAdmin, and branchManager/
// departmentHead within their own scope.
router.get('/tasks/:taskId/stops', async (req, res) => {
  const taskId = parseInt(req.params.taskId);
  if (isNaN(taskId)) return res.status(400).json({ error: 'Invalid task id' });
  try {
    if (!(await userCanAccessTask(req.user, taskId))) return res.status(404).json({ error: 'Task not found' });
    const { rows } = await pool.query(
      `SELECT ${STOP_SEL} ${STOP_JOINS} WHERE s.task_id=$1 ORDER BY s.id DESC`,
      [taskId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Trip Log report — every trip (Office Out -> stops -> Office In) that STARTED
// within a Nepal-calendar date range, with each stop's check-in/out, status,
// remarks and the computed durations/distances. Scope: admin/superAdmin see
// everyone; branchManager/departmentHead see their own branch/department;
// anyone else sees only their own trips. Optional ?employeeId= narrows further
// (silently ignored if outside the caller's scope).
router.get('/report', async (req, res) => {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const { startDate, endDate } = req.query;
  if (!re.test(startDate || '') || !re.test(endDate || '')) return res.status(400).json({ error: 'startDate and endDate (YYYY-MM-DD) are required' });
  const dayMs = 24 * 60 * 60 * 1000;
  const fromUtc = new Date(`${startDate}T00:00:00.000Z`).getTime() - NEPAL_OFFSET_MS;
  const toUtc   = new Date(`${endDate}T00:00:00.000Z`).getTime() - NEPAL_OFFSET_MS + dayMs;
  if (!(toUtc > fromUtc)) return res.status(400).json({ error: 'endDate must be on or after startDate' });
  if ((toUtc - fromUtc) / dayMs > 93) return res.status(400).json({ error: 'Date range cannot exceed 92 days' });
  try {
    const me = req.user;
    const role = me.role || 'employee';
    const params = [new Date(fromUtc), new Date(toUtc)];
    let where = 'fs.office_out_at >= $1 AND fs.office_out_at < $2';
    if (role === 'admin' || role === 'superAdmin') {
      /* everyone */
    } else if (role === 'branchManager' || role === 'departmentHead') {
      const col = role === 'branchManager' ? 'branch' : 'department';
      const val = ((role === 'branchManager' ? me.branch : me.department) || '').trim();
      if (val) { params.push(val); where += ` AND (fs.employee_id = ${Number(me.id)} OR LOWER(TRIM(eu.${col})) = LOWER(${params.length}))`; }
      else where += ` AND fs.employee_id = ${Number(me.id)}`;
    } else {
      where += ` AND fs.employee_id = ${Number(me.id)}`;
    }
    const wanted = parseInt(req.query.employeeId);
    if (Number.isInteger(wanted)) { params.push(wanted); where += ` AND fs.employee_id = ${params.length}`; }

    const { rows: sessions } = await pool.query(
      `SELECT ${SESSION_SEL}, eu.full_name AS "employeeName"
       FROM field_visit_sessions fs JOIN users eu ON eu.id = fs.employee_id
       WHERE ${where} ORDER BY fs.office_out_at ASC, fs.id ASC`, params);
    let stops = [];
    if (sessions.length) {
      ({ rows: stops } = await pool.query(
        `SELECT ${STOP_SEL} ${STOP_JOINS} WHERE s.session_id = ANY($1::int[]) ORDER BY s.id ASC`,
        [sessions.map(x => x.id)]));
    }
    const bySession = new Map();
    stops.forEach(st => { if (!bySession.has(st.sessionId)) bySession.set(st.sessionId, []); bySession.get(st.sessionId).push(st); });
    res.json({ startDate, endDate, sessions: sessions.map(x => ({ ...x, stops: bySession.get(x.id) || [] })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Employee movement track for one Nepal-calendar day — every session (trip)
// and its stops, in chronological order, feeding the "Track Flow of Staff"
// map. Any management role (admin/superAdmin/branchManager/departmentHead)
// can look up any employee; a plain employee can only look up themselves —
// mirrors the same scoping already used for attendance (attendanceScope.js).
router.get('/employee/:employeeId/track', async (req, res) => {
  const employeeId = parseInt(req.params.employeeId);
  if (isNaN(employeeId)) return res.status(400).json({ error: 'Invalid employee id' });
  const { scopeEmployeeId, isScoped } = resolveEmployeeScope(req, employeeId);
  if (isScoped && scopeEmployeeId !== employeeId) {
    return res.status(403).json({ error: 'You can only view your own movement track.' });
  }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : null;
  if (!date) return res.status(400).json({ error: 'date (YYYY-MM-DD) is required' });
  try {
    const dayStartUtc = new Date(`${date}T00:00:00.000Z`).getTime() - NEPAL_OFFSET_MS;
    const dayEndUtc = dayStartUtc + 24 * 60 * 60 * 1000;

    const { rows: sessions } = await pool.query(
      `SELECT ${SESSION_SEL} FROM field_visit_sessions fs
       WHERE fs.employee_id=$1 AND fs.office_out_at >= $2 AND fs.office_out_at < $3
       ORDER BY fs.office_out_at ASC`,
      [employeeId, new Date(dayStartUtc), new Date(dayEndUtc)]
    );
    const sessionsWithStops = await Promise.all(sessions.map(async (sess) => {
      const { rows: stops } = await pool.query(
        `SELECT ${STOP_SEL} ${STOP_JOINS} WHERE s.session_id=$1 ORDER BY s.id ASC`,
        [sess.id]
      );
      return { ...sess, stops };
    }));
    const { rows: empRows } = await pool.query(`SELECT full_name AS "employeeName" FROM users WHERE id=$1`, [employeeId]);
    res.json({ employeeId, employeeName: empRows[0]?.employeeName || null, date, sessions: sessionsWithStops });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
