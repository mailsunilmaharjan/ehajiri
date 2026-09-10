import { Router } from 'express';
import pool from '../db.js';

const router = Router();

/* Branch/Department coverage for the two multi-scope roles — Branch Area
   Manager (manager_branch_coverage) and Department Incharge
   (manager_department_coverage), migration v138. Admin-only in both
   directions: unlike "Set Recommendator & Approval" (which branchManager/
   departmentHead can also configure within their own scope), coverage
   assignment decides how WIDE a manager's whole org scope is, so only an
   admin/superAdmin edits — or even reads — someone else's here. The
   covered manager themselves already gets their own resolved coverage
   embedded on login (see auth.js's attachCoverage), so they never need
   this route for their own view. */
const isPrivileged = (req) => req.user?.role === 'admin' || req.user?.role === 'superAdmin';

router.get('/:userId', async (req, res) => {
  if (!isPrivileged(req)) return res.status(403).json({ error: 'Admin access required' });
  const userId = Number(req.params.userId);
  if (!Number.isFinite(userId)) return res.status(400).json({ error: 'Invalid user id' });
  try {
    const [branchRows, deptRows] = await Promise.all([
      pool.query(
        `SELECT b.id, b.name FROM manager_branch_coverage mbc
         JOIN branches b ON b.id = mbc.branch_id
         WHERE mbc.user_id = $1 ORDER BY b.name`,
        [userId]
      ),
      pool.query(
        `SELECT mdc.department_id, d.name AS department_name,
                mdc.branch_id, b.name AS branch_name
         FROM manager_department_coverage mdc
         JOIN departments d ON d.id = mdc.department_id
         LEFT JOIN branches b ON b.id = mdc.branch_id
         WHERE mdc.user_id = $1 ORDER BY d.name, b.name`,
        [userId]
      ),
    ]);
    res.json({
      branches: branchRows.rows,
      departments: deptRows.rows.map(r => ({
        departmentId: r.department_id, departmentName: r.department_name,
        branchId: r.branch_id, branchName: r.branch_name,
      })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Full-blob replace, same UX as PUT /api/reco-approval — pick everything in
// the Coverage tab, hit Save once. Body: { branchIds: [1,2,...],
// departments: [{ departmentId, branchId: number|null }, ...] }.
router.put('/:userId', async (req, res) => {
  if (!isPrivileged(req)) return res.status(403).json({ error: 'Admin access required' });
  const userId = Number(req.params.userId);
  if (!Number.isFinite(userId)) return res.status(400).json({ error: 'Invalid user id' });

  const branchIds = Array.isArray(req.body?.branchIds)
    ? req.body.branchIds.map(Number).filter(Number.isFinite) : [];
  const departments = Array.isArray(req.body?.departments)
    ? req.body.departments
        .map(d => ({
          departmentId: Number(d?.departmentId),
          branchId: d?.branchId === null || d?.branchId === undefined ? null : Number(d.branchId),
        }))
        .filter(d => Number.isFinite(d.departmentId) && (d.branchId === null || Number.isFinite(d.branchId)))
    : [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query('DELETE FROM manager_branch_coverage WHERE user_id = $1', [userId]);
    for (const branchId of new Set(branchIds)) {
      await client.query(
        `INSERT INTO manager_branch_coverage (user_id, branch_id) VALUES ($1, $2)
         ON CONFLICT (user_id, branch_id) DO NOTHING`,
        [userId, branchId]
      );
    }

    await client.query('DELETE FROM manager_department_coverage WHERE user_id = $1', [userId]);
    const seen = new Set();
    for (const { departmentId, branchId } of departments) {
      const key = `${departmentId}:${branchId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await client.query(
        `INSERT INTO manager_department_coverage (user_id, department_id, branch_id) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [userId, departmentId, branchId]
      );
    }

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

export default router;
