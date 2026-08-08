import { Router } from 'express';
import bcrypt from 'bcryptjs';
import os from 'os';
import pool from '../db.js';
import { requireRole } from '../middleware/roleGuard.js';
import { logAudit } from '../services/auditLog.js';
import { sendStaffCreated, sendPasswordReset } from '../services/emailService.js';
import { syncEmailDirectory } from '../services/directorySync.js';

// Postgres unique-violation (23505) on users_username_key means the email/username
// is already taken by another account — including hidden system/superAdmin accounts
// that don't appear in the Staff grid — so give a clear message instead of the raw
// constraint name.
function friendlyDbError(e) {
  if (e.code === '23505' && e.constraint === 'users_username_key') {
    return 'Duplicate Email Address';
  }
  if (e.code === '23505' && e.constraint === 'users_email_key') {
    return 'This email address is already used by another staff member';
  }
  if (e.code === '23503') {
    return `Cannot delete — this staff still has linked records in "${e.table}". ` +
           'Mark them Not Working via Officially Changes instead, or remove the linked records first.';
  }
  return e.message;
}

// The one true count of "staff that count toward the license's Max Staff
// limit" — used both by the STAFF_LIMIT check below and by GET
// /license-usage (which the frontend polls to disable "Add New Staff"
// proactively). Keeping this in one place means the two can never drift —
// they previously didn't, which is exactly why an active superAdmin account
// could push the real count past the limit while the Staff page's own
// (differently-scoped) list still looked like there was room.
async function getActiveStaffCount() {
  const { rows } = await pool.query(
    `SELECT COUNT(*) FROM users WHERE is_system IS NOT TRUE AND active = TRUE`
  );
  return parseInt(rows[0].count);
}

function getLocalIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

const router = Router();
const canManageStaff = requireRole('admin', 'branchManager', 'superAdmin');
const canDeleteStaff = requireRole('admin', 'superAdmin');

const ADMIN_ROLES = ['admin', 'superAdmin'];

/* Permission rules for admin-level account mutations:
   - superAdmin → can manage any role including superAdmin and admin
   - admin       → can assign/edit admin role, but NOT superAdmin accounts
   - others      → cannot touch admin/superAdmin accounts */
async function guardAdminAccountMutation(req, res, next) {
  try {
    const actorRole    = req.user?.role;
    const incomingRole = req.body?.role;

    /* If assigning superAdmin role, only superAdmin may do that */
    if (incomingRole === 'superAdmin' && actorRole !== 'superAdmin') {
      return res.status(403).json({ error: 'Only a super admin can assign the Super Admin role' });
    }

    /* Check if the target account is currently superAdmin */
    if (req.params.id) {
      const { rows } = await pool.query('SELECT role FROM users WHERE id=$1', [req.params.id]);
      const targetRole = rows[0]?.role;
      if (targetRole === 'superAdmin' && actorRole !== 'superAdmin') {
        return res.status(403).json({ error: 'Only a super admin can manage Super Admin accounts' });
      }
    }

    next();
  } catch (e) { res.status(500).json({ error: e.message }); }
}

const SEL = `
  id,
  employee_id      AS "employeeId",
  full_name        AS "fullName",
  role, department, position, shift, email, phone,
  join_date        AS "joinDate",
  gender, avatar, active,
  profile_photo    AS "profilePhoto",
  device_id        AS "deviceId",
  religion, handicapped, branch, mode, grade,
  timing_type      AS "timingType",
  dob,
  attendance_date  AS "attendanceDate",
  emp_status       AS "status",
  ranking_order    AS "rankingOrder",
  remarks,
  eligible_for_ot  AS "eligibleForOt"
`;

const sql = {
  list: `SELECT ${SEL} FROM users WHERE is_system IS NOT TRUE AND role NOT IN ('superAdmin')
    ORDER BY (SELECT b.ranking_order FROM branches b WHERE b.name = branch) ASC NULLS LAST,
             ranking_order ASC NULLS LAST, id ASC`,

  insert: `
    INSERT INTO users
      (employee_id, username, password, full_name, role, department, position, shift,
       email, phone, join_date, gender, avatar,
       device_id, religion, handicapped, branch, mode, grade, timing_type,
       dob, attendance_date, emp_status, ranking_order, remarks, eligible_for_ot)
    VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
    RETURNING ${SEL}`,

  update: `
    UPDATE users SET
      full_name=$1, role=$2, department=$3, position=$4, shift=$5,
      email=$6, phone=$7, join_date=$8, gender=$9, active=$10,
      device_id=$11, religion=$12, handicapped=$13, branch=$14, mode=$15,
      grade=$16, timing_type=$17, dob=$18, attendance_date=$19, emp_status=$20,
      ranking_order=$21, remarks=$22, eligible_for_ot=$23
    WHERE id=$24
    RETURNING ${SEL}`,
};

/* ══════════ Officially Changes — status/branch/post/department/mode/grade history ══════════ */

/* Which users column each officially-changeable field transitions.
   'status' is special-cased in the sweep (also derives users.active). */
const OFFICIAL_FIELDS = {
  status:     'emp_status',
  branch:     'branch',
  position:   'position',
  department: 'department',
  mode:       'mode',
  grade:      'grade',
};

/* Sweep due official changes into the users table. Per user+field, the row
   with the latest effective_date that has arrived wins; every due row is
   then marked applied. For status, active follows the status's status_type
   in employee_statuses ('Working'). */
async function applyDueOfficialChanges() {
  for (const [field, col] of Object.entries(OFFICIAL_FIELDS)) {
    const setClause = field === 'status'
      ? `emp_status = d.to_value,
         active = COALESCE(
           (SELECT s.status_type = 'Working' FROM employee_statuses s WHERE s.name = d.to_value LIMIT 1),
           d.to_value = 'Active')`
      : `${col} = d.to_value`;
    await pool.query(`
      WITH due AS (
        SELECT DISTINCT ON (user_id) user_id, to_value
        FROM staff_official_changes
        WHERE field = $1 AND applied = FALSE AND effective_date <= CURRENT_DATE
        ORDER BY user_id, effective_date DESC, id DESC
      )
      UPDATE users u SET ${setClause}
      FROM due d WHERE u.id = d.user_id
    `, [field]);
  }
  await pool.query(`
    UPDATE staff_official_changes SET applied = TRUE
    WHERE applied = FALSE AND effective_date <= CURRENT_DATE
  `);
}

router.get('/', async (_req, res) => {
  try {
    // Apply any official changes that became due since the last fetch —
    // this is what makes a future-dated change take effect on its date.
    await applyDueOfficialChanges().catch(() => {});
    res.json((await pool.query(sql.list)).rows);
  }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Current usage vs. license limits (Staff / Devices) — lets the Staff page
// gate "Add New Staff" proactively instead of only reacting to the server's
// STAFF_LIMIT error after a failed save. staffCount reuses getActiveStaffCount
// so it's always identical to what the POST / handler below actually
// enforces — the Staff grid (GET /, sql.list) excludes superAdmin accounts
// from what's displayed, so counting off that list instead would silently
// undercount whenever an active superAdmin account exists, and the button
// would stay enabled right up until the real save gets rejected. Exposed to
// canManageStaff (admin/branchManager/superAdmin), not just admin/superAdmin
// like the full /api/zkteco and /api/standalone routers — this returns only
// counts, never device credentials/IPs, so it's safe for the broader role
// set that's already allowed to add staff.
router.get('/license-usage', canManageStaff, async (_req, res) => {
  try {
    const [staffCount, zk, sa] = await Promise.all([
      getActiveStaffCount(),
      pool.query(`SELECT COUNT(*)::int AS n FROM zkteco_devices WHERE active = TRUE`),
      pool.query(`SELECT COUNT(*)::int AS n FROM standalone_devices WHERE active = TRUE`),
    ]);
    res.json({ staffCount, deviceCount: zk.rows[0].n + sa.rows[0].n });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const SOC_SEL = `
  id, field,
  user_id                              AS "userId",
  from_value                           AS "fromValue",
  to_value                             AS "toValue",
  to_char(effective_date,'YYYY-MM-DD') AS "effectiveDate",
  remarks, applied,
  created_by                           AS "createdBy",
  created_at                           AS "createdAt"
`;

router.get('/:id/official-changes', async (req, res) => {
  try {
    const { field } = req.query;
    const params = [req.params.id];
    let where = 'user_id=$1';
    if (field) { params.push(field); where += ' AND field=$2'; }
    const { rows } = await pool.query(
      `SELECT ${SOC_SEL} FROM staff_official_changes
       WHERE ${where} ORDER BY effective_date DESC, id DESC`,
      params
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/official-changes', canManageStaff, async (req, res) => {
  const { field, toValue, effectiveDate, remarks } = req.body;
  const col = OFFICIAL_FIELDS[field];
  if (!col)             return res.status(400).json({ error: `Unknown field "${field}"` });
  if (!toValue?.trim()) return res.status(400).json({ error: 'Changing value is required' });
  if (!effectiveDate)   return res.status(400).json({ error: 'Effective Date is required' });
  try {
    const cur = await pool.query(`SELECT ${col} AS val FROM users WHERE id=$1`, [req.params.id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'Staff not found' });

    const { rows } = await pool.query(
      `INSERT INTO staff_official_changes (user_id, field, from_value, to_value, effective_date, remarks, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING ${SOC_SEL}`,
      [req.params.id, field, cur.rows[0].val || null, toValue.trim(), effectiveDate,
       remarks?.trim() || null, req.user?.fullName || req.user?.username || null]
    );

    await applyDueOfficialChanges();

    const after = (await pool.query(`SELECT ${SEL} FROM users WHERE id=$1`, [req.params.id])).rows[0];
    logAudit({ actor: req.user, action: 'official-change', entity: 'employee', entityId: req.params.id,
               before: { [field]: cur.rows[0].val }, after: { [field]: toValue, effectiveDate, remarks } });
    res.status(201).json({
      change: { ...rows[0], applied: rows[0].effectiveDate <= new Date().toISOString().split('T')[0] },
      user: after,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* Edit an entry (grid double-click). The row is reset to pending and the
   sweep re-runs, so per user+field the latest due row still wins — editing
   an already-applied entry re-applies correctly. */
router.put('/:id/official-changes/:changeId', canManageStaff, async (req, res) => {
  const { toValue, effectiveDate, remarks } = req.body;
  if (!toValue?.trim()) return res.status(400).json({ error: 'Changing value is required' });
  if (!effectiveDate)   return res.status(400).json({ error: 'Effective Date is required' });
  try {
    const { rows } = await pool.query(
      `UPDATE staff_official_changes
       SET to_value=$1, effective_date=$2, remarks=$3, applied=FALSE
       WHERE id=$4 AND user_id=$5
       RETURNING ${SOC_SEL}`,
      [toValue.trim(), effectiveDate, remarks?.trim() || null, req.params.changeId, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Change not found' });

    await applyDueOfficialChanges();

    const after = (await pool.query(`SELECT ${SEL} FROM users WHERE id=$1`, [req.params.id])).rows[0];
    logAudit({ actor: req.user, action: 'official-change-edit', entity: 'employee', entityId: req.params.id,
               before: null, after: { field: rows[0].field, toValue, effectiveDate, remarks } });
    res.json({
      change: { ...rows[0], applied: rows[0].effectiveDate <= new Date().toISOString().split('T')[0] },
      user: after,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ══════════ Staff Identity — addresses / ID cards / emergency contacts ══════════
   One generic CRUD over the three per-staff collections behind the
   Edit Staff → Staff Identity tab. `kind` is the URL segment. */
const IDENTITY_KINDS = {
  addresses: {
    table: 'staff_addresses',
    sel: `id, user_id AS "userId", country, province, district, ward,
          address_type AS "addressType", created_at AS "createdAt"`,
    cols: { country:'country', province:'province', district:'district', ward:'ward', addressType:'address_type' },
    required: { addressType: 'Address Type' },
  },
  'id-cards': {
    table: 'staff_id_cards',
    sel: `id, user_id AS "userId", id_name AS "idName", id_number AS "idNumber",
          to_char(expiry_date,'YYYY-MM-DD') AS "expiryDate", doc_image AS "docImage",
          created_at AS "createdAt"`,
    cols: { idName:'id_name', idNumber:'id_number', expiryDate:'expiry_date', docImage:'doc_image' },
    required: { idName: 'ID Name', idNumber: 'ID Number' },
  },
  'emergency-contacts': {
    table: 'staff_emergency_contacts',
    sel: `id, user_id AS "userId", name, contact1, contact2, relation, address,
          created_at AS "createdAt"`,
    cols: { name:'name', contact1:'contact1', contact2:'contact2', relation:'relation', address:'address' },
    required: { name: 'Name', contact1: 'Contact No. 1' },
  },
};

function identityKind(req, res) {
  const kind = IDENTITY_KINDS[req.params.kind];
  if (!kind) res.status(400).json({ error: `Unknown identity section "${req.params.kind}"` });
  return kind;
}

/* Pull the body values in column order; '' → null. Returns an error string
   if a required field is missing. */
function identityValues(kind, body) {
  const values = [];
  for (const [key, label] of Object.entries(kind.required)) {
    if (!String(body[key] ?? '').trim()) return { error: `${label} is required` };
  }
  for (const key of Object.keys(kind.cols)) {
    const v = body[key];
    values.push(typeof v === 'string' ? (v.trim() || null) : (v ?? null));
  }
  return { values };
}

router.get('/:id/identity/:kind', async (req, res) => {
  const kind = identityKind(req, res);
  if (!kind) return;
  try {
    const { rows } = await pool.query(
      `SELECT ${kind.sel} FROM ${kind.table} WHERE user_id=$1 ORDER BY id DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/identity/:kind', canManageStaff, async (req, res) => {
  const kind = identityKind(req, res);
  if (!kind) return;
  const { values, error } = identityValues(kind, req.body);
  if (error) return res.status(400).json({ error });
  try {
    const cols = Object.values(kind.cols);
    const { rows } = await pool.query(
      `INSERT INTO ${kind.table} (user_id, ${cols.join(', ')})
       VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')})
       RETURNING ${kind.sel}`,
      [req.params.id, ...values]
    );
    logAudit({ actor: req.user, action: `identity-add-${req.params.kind}`, entity: 'employee',
               entityId: req.params.id, before: null, after: { id: rows[0].id } });
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id/identity/:kind/:rowId', canManageStaff, async (req, res) => {
  const kind = identityKind(req, res);
  if (!kind) return;
  const { values, error } = identityValues(kind, req.body);
  if (error) return res.status(400).json({ error });
  try {
    const cols = Object.values(kind.cols);
    const { rows } = await pool.query(
      `UPDATE ${kind.table} SET ${cols.map((c, i) => `${c}=$${i + 1}`).join(', ')}
       WHERE id=$${cols.length + 1} AND user_id=$${cols.length + 2}
       RETURNING ${kind.sel}`,
      [...values, req.params.rowId, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Record not found' });
    logAudit({ actor: req.user, action: `identity-edit-${req.params.kind}`, entity: 'employee',
               entityId: req.params.id, before: null, after: { id: rows[0].id } });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id/identity/:kind/:rowId', canManageStaff, async (req, res) => {
  const kind = identityKind(req, res);
  if (!kind) return;
  try {
    const { rows } = await pool.query(
      `DELETE FROM ${kind.table} WHERE id=$1 AND user_id=$2 RETURNING id`,
      [req.params.rowId, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Record not found' });
    logAudit({ actor: req.user, action: `identity-delete-${req.params.kind}`, entity: 'employee',
               entityId: req.params.id, before: { id: rows[0].id }, after: null });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* Only pending (not-yet-applied) entries can be removed — applied ones are history */
router.delete('/:id/official-changes/:changeId', canManageStaff, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM staff_official_changes
       WHERE id=$1 AND user_id=$2 AND applied=FALSE RETURNING id`,
      [req.params.changeId, req.params.id]
    );
    if (!rows.length) return res.status(400).json({ error: 'Only pending (future-dated) changes can be deleted' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', canManageStaff, guardAdminAccountMutation, async (req, res) => {
  const {
    employeeId, fullName, role, department, position, shift,
    email, phone, joinDate, gender, avatar,
    deviceId, religion, handicapped, branch, mode, grade,
    timingType, dob, attendanceDate, status, rankingOrder, remarks, eligibleForOt,
  } = req.body;
  try {
    // Check staff limit from active license
    const licRow = await pool.query(
      `SELECT payload FROM license WHERE is_active = TRUE ORDER BY activated_at DESC LIMIT 1`
    );
    if (licRow.rows.length) {
      const lic      = licRow.rows[0].payload;
      const maxStaff = lic.maxStaff ?? 25;
      if (maxStaff > 0 && (await getActiveStaffCount()) >= maxStaff) {
        return res.status(403).json({
          error: `License limit reached. Your license allows only ${maxStaff} staff members. To add more staff, please upgrade your license and contact your distributor.`,
          code: 'STAFF_LIMIT',
          maxStaff,
        });
      }
    }

    const plainPassword = deviceId || employeeId;
    const { rows } = await pool.query(sql.insert, [
      employeeId,
      email || employeeId,   // username = email
      plainPassword,         // default password = device ID or employee ID
      fullName,
      role        || 'employee',
      department  || null,
      position    || null,
      shift       || null,
      email,
      phone       || null,
      joinDate    || null,
      gender      || 'male',
      avatar      || (fullName?.[0]?.toUpperCase() || 'E'),
      deviceId    || null,
      religion    || null,
      handicapped || false,
      branch      || null,
      mode        || null,
      grade       || null,
      timingType  || null,
      dob         || null,
      attendanceDate || null,
      status      || 'Active',
      rankingOrder ? Number(rankingOrder) : null,
      remarks      || null,
      eligibleForOt ?? false,
    ]);
    res.status(201).json(rows[0]);
    if (email) {
      syncEmailDirectory({ action: 'upsert', newEmail: email });
      const loginUrl = `http://${getLocalIp()}:4000`;
      sendStaffCreated({
        to: email,
        fullName,
        username: email || employeeId,
        password: plainPassword,
        role: role || 'employee',
        loginUrl,
      }).catch(() => {});
    }
  } catch (e) { res.status(500).json({ error: friendlyDbError(e) }); }
});

/* POST /api/employees/import — bulk create (skip duplicates by employeeId) */
router.post('/import', async (req, res) => {
  const { employees } = req.body;
  if (!Array.isArray(employees) || employees.length === 0)
    return res.status(400).json({ error: 'No employees provided' });

  const created = [], skipped = [], errors = [];

  try {
    // Pre-filter obviously-invalid rows and collect IDs for ONE batched
    // duplicate check, instead of a separate SELECT per row — with a large
    // file (100+ rows) that per-row round trip was slow enough to occasionally
    // exceed the reverse-proxy's response timeout, which returns an HTML
    // error page instead of JSON (surfaces client-side as "Backend server
    // not running" / a JSON-parse error, not the actual cause).
    const candidates = [];
    for (const emp of employees) {
      if (!emp.employeeId || !emp.fullName) {
        errors.push({ employeeId: emp.employeeId || '?', error: 'Employee ID and Full Name are required' });
        continue;
      }
      candidates.push(emp);
    }

    const existingIds = new Set();
    if (candidates.length) {
      const { rows } = await pool.query(
        'SELECT employee_id FROM users WHERE employee_id = ANY($1::text[]) AND is_system IS NOT TRUE',
        [candidates.map(e => String(e.employeeId))]
      );
      rows.forEach(r => existingIds.add(r.employee_id));
    }

    // One connection reused for all inserts, instead of checking a
    // connection out of the pool per row — cuts per-row overhead way down.
    // Deliberately NOT wrapped in a single BEGIN/COMMIT transaction: partial
    // success (some rows created, some skipped, some errored) is the
    // intended behavior here, and Postgres aborts an entire transaction on
    // the first statement error — sharing one would turn one bad row into
    // "current transaction is aborted" for every row after it.
    const client = await pool.connect();
    try {
      for (const emp of candidates) {
        const {
          employeeId, fullName, email, phone, department, position, branch,
          role, gender, joinDate, mode, deviceId, grade, dob, status, eligibleForOt, remarks,
        } = emp;
        const idStr = String(employeeId);
        if (existingIds.has(idStr)) { skipped.push(idStr); continue; }

        try {
          const otVal = String(eligibleForOt || '').toLowerCase();
          const today = new Date().toISOString().split('T')[0];
          await client.query(sql.insert, [
            idStr,
            email || idStr,
            deviceId || idStr,
            fullName,
            role || 'employee',
            department || null, position || null, null,
            email || null, phone || null, joinDate || today,
            gender || 'male',
            fullName?.[0]?.toUpperCase() || 'E',
            deviceId || null, null, false,
            branch || null, mode || null, grade || null, null,
            dob || null, null,
            status || 'Active', null, remarks || null,
            otVal === 'yes' || otVal === 'true' || otVal === '1',
          ]);
          created.push(idStr);
          existingIds.add(idStr); // guards against duplicate rows within the same file
          if (email) syncEmailDirectory({ action: 'upsert', newEmail: email });
        } catch (e) {
          errors.push({ employeeId: idStr, error: friendlyDbError(e) });
        }
      }
    } finally {
      client.release();
    }

    res.json({ created: created.length, skipped: skipped.length, errors });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/:id', canManageStaff, guardAdminAccountMutation, async (req, res) => {
  const {
    fullName, role, department, position, shift,
    email, phone, joinDate, gender, active,
    deviceId, religion, handicapped, branch, mode, grade,
    timingType, dob, attendanceDate, status, rankingOrder, remarks, eligibleForOt,
  } = req.body;
  try {
    const before = (await pool.query(`SELECT ${SEL} FROM users WHERE id=$1`, [req.params.id])).rows[0];
    const { rows } = await pool.query(sql.update, [
      fullName,
      role        || 'employee',
      department  || null,
      position    || null,
      shift       || null,
      email,
      phone       || null,
      joinDate    || null,
      gender      || 'male',
      active      ?? true,
      deviceId    || null,
      religion    || null,
      handicapped ?? false,
      branch      || null,
      mode        || null,
      grade       || null,
      timingType  || null,
      dob         || null,
      attendanceDate || null,
      status      || 'Active',
      rankingOrder ? Number(rankingOrder) : null,
      remarks      || null,
      eligibleForOt ?? false,
      req.params.id,
    ]);
    logAudit({ actor: req.user, action: 'update', entity: 'employee', entityId: req.params.id, before, after: rows[0] });
    res.json(rows[0]);
    if (before?.email !== email) syncEmailDirectory({ action: 'upsert', oldEmail: before?.email, newEmail: email });
  } catch (e) { res.status(500).json({ error: friendlyDbError(e) }); }
});

/* GET /:id/bio-photo — returns only the bio_photo field (avoids bloating the list query) */
router.get('/:id/bio-photo', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT bio_photo AS "bioPhoto" FROM users WHERE id=$1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json({ bioPhoto: rows[0].bioPhoto || null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* PATCH /:id/bio-photo — save base64 profile photo */
router.patch('/:id/bio-photo', async (req, res) => {
  const { bioPhoto } = req.body;
  try {
    await pool.query('UPDATE users SET bio_photo=$1 WHERE id=$2', [bioPhoto || null, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', canDeleteStaff, guardAdminAccountMutation, async (req, res) => {
  try {
    const before = (await pool.query(`SELECT ${SEL} FROM users WHERE id=$1`, [req.params.id])).rows[0];
    await pool.query('DELETE FROM users WHERE id=$1', [req.params.id]);
    logAudit({ actor: req.user, action: 'delete', entity: 'employee', entityId: req.params.id, before, after: null });
    res.json({ success: true });
    if (before?.email) syncEmailDirectory({ action: 'delete', newEmail: before.email });
  } catch (e) { res.status(500).json({ error: friendlyDbError(e) }); }
});

router.put('/:id/reset-password', canManageStaff, async (req, res) => {
  const { password } = req.body;
  if (!password || !password.trim()) return res.status(400).json({ error: 'Password is required' });
  try {
    const plainPassword = password.trim();
    const hash = await bcrypt.hash(plainPassword, 10);
    const { rows } = await pool.query(
      'UPDATE users SET password=$1 WHERE id=$2 RETURNING full_name, email',
      [hash, req.params.id]
    );
    logAudit({ actor: req.user, action: 'reset-password', entity: 'employee', entityId: req.params.id, before: null, after: null });
    res.json({ success: true });
    const user = rows[0];
    if (user?.email) {
      sendPasswordReset({ to: user.email, fullName: user.full_name, newPassword: plainPassword }).catch(() => {});
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
