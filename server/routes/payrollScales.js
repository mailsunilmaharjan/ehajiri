import { Router } from 'express';
import pool from '../db.js';
import { logAudit } from '../services/auditLog.js';
import { gradeSalary } from '../services/payrollEngine.js';
import { staffOnly, ah, bad, id, num, isDate, d10, SAL_COLS, saveSalaryRow } from './payroll.js';

/* Government-style pay scales. A scale is a dated set of grades; a grade has a starting salary, a grade rate (the yearly
   grade increment amount) and an optional maximum number of grades. An employee on a grade is paid
   basic = starting salary, grade amount = grades earned x grade rate. When the government revises the scale, enter it as a new
   scale (new effective date, same grade codes) and "Apply" it: employees move to the new figures and keep their grades earned. */
const router = Router();
router.use(staffOnly);

const gradeRows = (g, i) => {
  const code = String(g.code || '').trim().slice(0, 40);
  if (!code || !String(g.label || '').trim()) throw bad(`Grade ${i + 1}: code and name are required.`);
  if (num(g.startSalary) < 0 || num(g.gradeRate) < 0) throw bad(`Grade ${code}: amounts cannot be negative.`);
  const max = g.maxGrades === '' || g.maxGrades == null ? null : Math.floor(num(g.maxGrades));
  if (max != null && max < 0) throw bad(`Grade ${code}: maximum grades cannot be negative.`);
  return { code, label: String(g.label).trim().slice(0, 120), start: num(g.startSalary), rate: num(g.gradeRate), max, rank: i };
};
async function writeGrades(client, scaleId, grades) {
  const rows = (Array.isArray(grades) ? grades : []).map(gradeRows);
  if (!rows.length) throw bad('Add at least one grade.');
  if (new Set(rows.map(r => r.code.toLowerCase())).size !== rows.length) throw bad('Grade codes must be unique within a scale.');
  await client.query('DELETE FROM pay_grades WHERE scale_id=$1', [scaleId]);
  for (const r of rows) await client.query(`INSERT INTO pay_grades (scale_id, code, label, start_salary, grade_rate, max_grades, rank) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [scaleId, r.code, r.label, r.start, r.rate, r.max, r.rank]);
}

router.get('/scales', ah(async (_req, res) => {
  const { rows: scales } = await pool.query(`SELECT s.*, (SELECT COUNT(*)::int FROM employee_salary es WHERE es.scale_id = s.id) AS in_use FROM pay_scales s ORDER BY effective_from DESC, id DESC`);
  const { rows: grades } = await pool.query(`SELECT * FROM pay_grades ORDER BY scale_id, rank, id`);
  res.json(scales.map(s => ({
    ...s, effective_from: d10(s.effective_from),
    grades: grades.filter(g => g.scale_id === s.id).map(g => ({ id: g.id, code: g.code, label: g.label, startSalary: num(g.start_salary), gradeRate: num(g.grade_rate), maxGrades: g.max_grades })),
  })));
}));

router.post('/scales', ah(async (req, res) => {
  const { name, effectiveFrom, note, grades } = req.body || {};
  if (!String(name || '').trim() || !isDate(effectiveFrom)) throw bad('Scale name and effective date are required.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [s] } = await client.query(`INSERT INTO pay_scales (name, effective_from, note, created_by) VALUES ($1,$2,$3,$4) RETURNING id`, [String(name).trim().slice(0, 120), effectiveFrom, String(note || '').slice(0, 300), req.user.id]);
    await writeGrades(client, s.id, grades);
    await client.query('COMMIT');
    logAudit({ actor: req.user, action: 'create', entity: 'pay_scale', entityId: s.id, before: null, after: { name, effectiveFrom } });
    res.json({ ok: true, id: s.id });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
}));

router.put('/scales/:id', ah(async (req, res) => {
  const sid = id(req.params.id);
  const { name, effectiveFrom, note, grades } = req.body || {};
  if (!String(name || '').trim() || !isDate(effectiveFrom)) throw bad('Scale name and effective date are required.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rowCount } = await client.query(`UPDATE pay_scales SET name=$1, effective_from=$2, note=$3 WHERE id=$4`, [String(name).trim().slice(0, 120), effectiveFrom, String(note || '').slice(0, 300), sid]);
    if (!rowCount) throw bad('Scale not found', 404);
    await writeGrades(client, sid, grades);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
}));

router.delete('/scales/:id', ah(async (req, res) => {
  const { rows: [{ n }] } = await pool.query('SELECT COUNT(*)::int AS n FROM employee_salary WHERE scale_id=$1', [id(req.params.id)]);
  if (n > 0) throw bad(`${n} salary record(s) use this scale, so it cannot be deleted.`, 409);
  await pool.query('DELETE FROM pay_scales WHERE id=$1', [id(req.params.id)]);
  res.json({ ok: true });
}));

/* Move employees from an older scale to this one from `effectiveDate`. dryRun=true only reports what would happen. */
router.post('/scales/:id/apply', ah(async (req, res) => {
  const sid = id(req.params.id);
  const { effectiveDate, dryRun, note } = req.body || {};
  if (!isDate(effectiveDate)) throw bad('Effective date is required.');
  const { rows: grades } = await pool.query('SELECT * FROM pay_grades WHERE scale_id=$1', [sid]);
  if (!grades.length) throw bad('Scale not found or has no grades.', 404);
  const byCode = new Map(grades.map(g => [g.code.toLowerCase(), g]));
  const { rows: emps } = await pool.query(
    `SELECT u.id AS user_id, u.full_name, to_jsonb(s) AS sal FROM users u
       JOIN LATERAL (SELECT * FROM employee_salary es WHERE es.user_id = u.id AND es.effective_from <= $1 ORDER BY es.effective_from DESC LIMIT 1) s ON TRUE
      WHERE u.active = TRUE AND u.is_system IS NOT TRUE AND s.grade_code IS NOT NULL AND s.scale_id IS DISTINCT FROM $2`, [effectiveDate, sid]);
  const plan = [], skipped = [];
  for (const e of emps) {
    const g = byCode.get(String(e.sal.grade_code).toLowerCase());
    if (!g) { skipped.push({ name: e.full_name, reason: `grade ${e.sal.grade_code} is not in this scale` }); continue; }
    if (d10(e.sal.effective_from) === effectiveDate) { skipped.push({ name: e.full_name, reason: 'already has a salary revision on that date' }); continue; }
    const earned = g.max_grades != null ? Math.min(num(e.sal.grades_earned), g.max_grades) : num(e.sal.grades_earned);
    const r = gradeSalary({ startSalary: num(g.start_salary), gradeRate: num(g.grade_rate), gradesEarned: earned, maxGrades: g.max_grades });
    plan.push({ userId: e.user_id, name: e.full_name, sal: e.sal, from: num(e.sal.basic) + num(e.sal.grade_amount), to: r.total, calc: r, grade: g });
  }
  if (dryRun) return res.json({ dryRun: true, revise: plan.map(p => ({ name: p.name, from: p.from, to: p.to })), skipped });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const p of plan) {
      const f = {}; for (const c of SAL_COLS) f[c] = p.sal[c];
      Object.assign(f, { basic: p.calc.basic, grade_amount: p.calc.gradeAmount, scale_id: sid, grade_code: p.grade.code, grades_earned: p.calc.gradesEarned });
      const { rows: items } = await client.query('SELECT item_id AS "itemId", amount FROM employee_salary_items WHERE salary_id=$1', [p.sal.id]);
      await saveSalaryRow(client, p.userId, effectiveDate, f, { changeType: 'revision', changeNote: note || 'New pay scale applied', items, actor: req.user.id });
    }
    await client.query('COMMIT');
    logAudit({ actor: req.user, action: 'apply', entity: 'pay_scale', entityId: sid, before: null, after: { effectiveDate, revised: plan.length } });
    res.json({ ok: true, revised: plan.length, skipped });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
}));

export default router;
