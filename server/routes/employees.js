import { Router } from 'express';
import bcrypt from 'bcryptjs';
import os from 'os';
import pool from '../db.js';
import { requireRole } from '../middleware/roleGuard.js';
import { logAudit } from '../services/auditLog.js';
import { sendStaffCreated, sendPasswordReset } from '../services/emailService.js';

// Postgres unique-violation (23505) on users_username_key means the email/username
// is already taken by another account — including hidden system/superAdmin accounts
// that don't appear in the Staff grid — so give a clear message instead of the raw
// constraint name.
function friendlyDbError(e) {
  if (e.code === '23505' && e.constraint === 'users_username_key') {
    return 'Duplicate Email Address';
  }
  return e.message;
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
  list: `SELECT ${SEL} FROM users WHERE is_system IS NOT TRUE AND role NOT IN ('superAdmin') ORDER BY ranking_order ASC NULLS LAST, id ASC`,

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

router.get('/', async (_req, res) => {
  try { res.json((await pool.query(sql.list)).rows); }
  catch (e) { res.status(500).json({ error: e.message }); }
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
      if (maxStaff > 0) {
        const cnt = await pool.query(
          `SELECT COUNT(*) FROM users WHERE is_system IS NOT TRUE AND active = TRUE`
        );
        if (parseInt(cnt.rows[0].count) >= maxStaff) {
          return res.status(403).json({
            error: `License limit reached. Your license allows only ${maxStaff} staff members. To add more staff, please upgrade your license and contact your distributor.`,
            code: 'STAFF_LIMIT',
            maxStaff,
          });
        }
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

  for (const emp of employees) {
    const {
      employeeId, fullName, email, phone, department, position, branch,
      role, gender, joinDate, mode, deviceId, grade, dob, status, eligibleForOt, remarks,
    } = emp;

    if (!employeeId || !fullName) {
      errors.push({ employeeId: employeeId || '?', error: 'Employee ID and Full Name are required' });
      continue;
    }
    try {
      const dup = await pool.query(
        'SELECT id FROM users WHERE employee_id=$1 AND is_system IS NOT TRUE', [String(employeeId)]
      );
      if (dup.rows.length > 0) { skipped.push(String(employeeId)); continue; }

      const otVal = String(eligibleForOt || '').toLowerCase();
      await pool.query(sql.insert, [
        String(employeeId),
        email || String(employeeId),
        deviceId || String(employeeId),
        fullName,
        role || 'employee',
        department || null, position || null, null,
        email || null, phone || null, joinDate || null,
        gender || 'male',
        fullName?.[0]?.toUpperCase() || 'E',
        deviceId || null, null, false,
        branch || null, mode || null, grade || null, null,
        dob || null, null,
        status || 'Active', null, remarks || null,
        otVal === 'yes' || otVal === 'true' || otVal === '1',
      ]);
      created.push(String(employeeId));
    } catch (e) {
      errors.push({ employeeId: String(employeeId), error: friendlyDbError(e) });
    }
  }
  res.json({ created: created.length, skipped: skipped.length, errors });
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
  } catch (e) { res.status(500).json({ error: e.message }); }
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
