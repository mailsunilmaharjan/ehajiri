import { Router } from 'express';
import pool from '../db.js';
import { resolveOrgScope, resolveOrgEmployeeIds } from './orgScope.js';

const router = Router();

/* Set Recommendator & Approval (Staff Detail → User Management). Readable by
   any authenticated role — employees applying for leave/office visit, and
   LeaveApproval/OfficeVisitApproval, need this to know who their configured
   recommender/approver is. */
router.get('/', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT employee_id, recommender_ids, approver_ids FROM reco_approval_assignments'
    );
    const assignments = {};
    rows.forEach(r => {
      assignments[r.employee_id] = {
        reco    : (r.recommender_ids || []).map(String),
        approval: (r.approver_ids    || []).map(String),
      };
    });
    res.json(assignments);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const toIds = (v) => (Array.isArray(v) ? v : (v ? [v] : []))
  .map(Number).filter(Number.isFinite);

/* Write access: admin/superAdmin can configure anyone (full-blob replace —
   matches the modal's "configure everyone, hit Save once" UX, same pattern
   as PUT /api/settings). branchManager/departmentHead can configure only
   employees within their own org scope (resolveOrgEmployeeIds, same rule
   AuthContext.jsx's filterByRole applies client-side) — any other employee
   id present in the payload (out of scope, or a compromised/bypassed client)
   is silently skipped rather than touched, and existing rows for employees
   outside the caller's scope are left completely alone. Plain employees have
   no write access at all. */
router.put('/', async (req, res) => {
  const scope = resolveOrgScope(req);
  if (scope.level === 'self') {
    return res.status(403).json({ error: 'You do not have permission to perform this action' });
  }

  const assignments = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (scope.level === 'all') {
      await client.query('DELETE FROM reco_approval_assignments');
      for (const [employeeId, cfg] of Object.entries(assignments)) {
        const empId = Number(employeeId);
        if (!Number.isFinite(empId)) continue;
        const reco     = toIds(cfg?.reco);
        const approval = toIds(cfg?.approval);
        if (reco.length === 0 && approval.length === 0) continue;
        await client.query(
          `INSERT INTO reco_approval_assignments (employee_id, recommender_ids, approver_ids)
           VALUES ($1, $2, $3)
           ON CONFLICT (employee_id) DO UPDATE
             SET recommender_ids = $2, approver_ids = $3, updated_at = NOW()`,
          [empId, reco, approval]
        );
      }
    } else {
      const allowedIds = new Set((await resolveOrgEmployeeIds(req)).map(String));
      for (const [employeeId, cfg] of Object.entries(assignments)) {
        if (!allowedIds.has(String(employeeId))) continue;
        const empId = Number(employeeId);
        if (!Number.isFinite(empId)) continue;
        const reco     = toIds(cfg?.reco);
        const approval = toIds(cfg?.approval);
        if (reco.length === 0 && approval.length === 0) {
          await client.query('DELETE FROM reco_approval_assignments WHERE employee_id = $1', [empId]);
        } else {
          await client.query(
            `INSERT INTO reco_approval_assignments (employee_id, recommender_ids, approver_ids)
             VALUES ($1, $2, $3)
             ON CONFLICT (employee_id) DO UPDATE
               SET recommender_ids = $2, approver_ids = $3, updated_at = NOW()`,
            [empId, reco, approval]
          );
        }
      }
    }

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

export default router;
