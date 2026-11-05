import { Router } from 'express';
import pool from '../db.js';
import { requireRole } from '../middleware/roleGuard.js';
import { logAudit } from '../services/auditLog.js';
import { computeSlip, advanceSchedule, checkAdvance, nextIncrement, gradeSalary, nextGrade, r2, addMonths } from '../services/payrollEngine.js';

/* Payroll API. Every rate, limit, tax slab and policy is read from the database at the moment of
   calculation (payroll_rates / payroll_tax_slabs), effective-dated, so changing a rate never needs a
   code change. Admin / Super Admin only, except /my-payslips (an employee's own locked payslips). */
const router = Router();
const staffOnly = requireRole('admin', 'superAdmin');
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const today = () => new Date().toISOString().slice(0, 10);
const id = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const ah = (fn) => (req, res) => fn(req, res).catch((e) => { console.error('[payroll]', e); res.status(e.status || 500).json({ error: e.status ? e.message : (e.message || 'Server error') }); });
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const d10 = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v || '').slice(0, 10));

/* ───────────────────────── dynamic settings loaders ───────────────────────── */
async function rateAt(code, date, db = pool) {
  const { rows } = await db.query(`SELECT params FROM payroll_rates WHERE code=$1 AND effective_from <= $2 ORDER BY effective_from DESC LIMIT 1`, [code, date]);
  return rows[0]?.params || {};
}
/** Latest slab set effective on `date`, per applies_to (single / couple / all). */
async function slabsAt(date, db = pool) {
  const { rows } = await db.query(
    `SELECT id, applies_to, COALESCE(effective_date, DATE '2000-01-01') AS eff, income_from, income_to, rate_percent, is_sst, yearly_income_slab
       FROM payroll_tax_slabs WHERE COALESCE(effective_date, DATE '2000-01-01') <= $1 ORDER BY eff DESC, income_from`, [date]);
  const latest = {};
  for (const r of rows) { if (!(r.applies_to in latest)) latest[r.applies_to] = d10(r.eff); }
  // Several named sets can share the winning date (e.g. the starter set plus one typed in later): use only the newest-entered set.
  const newest = {};
  for (const r of rows) {
    if (d10(r.eff) !== latest[r.applies_to]) continue;
    const k = r.applies_to;
    if (!newest[k] || r.id > newest[k].id) newest[k] = { id: r.id, label: r.yearly_income_slab };
  }
  const out = { single: [], couple: [], all: [] };
  for (const r of rows) {
    if (d10(r.eff) !== latest[r.applies_to]) continue;
    if (r.yearly_income_slab !== newest[r.applies_to].label) continue;
    out[r.applies_to].push({ from: num(r.income_from), to: r.income_to == null ? null : num(r.income_to), rate: num(r.rate_percent), isSst: !!r.is_sst });
  }
  // an employee type with no set of its own falls back to the "all" set
  if (!out.single.length) out.single = out.all;
  if (!out.couple.length) out.couple = out.all;
  return out;
}
async function fiscalRange(date) {
  const { rows } = await pool.query(`SELECT start_date, end_date FROM fiscal_years WHERE start_date <= $1 AND end_date >= $1 ORDER BY is_default DESC, start_date DESC LIMIT 1`, [date]);
  if (rows[0]) return { start: d10(rows[0].start_date), end: d10(rows[0].end_date) };
  const y = Number(String(date).slice(0, 4));
  return { start: `${y}-01-01`, end: `${y}-12-31` };
}

/* ───────────────────────── employee-facing: own payslips ───────────────────────── */
router.get('/my-payslips', ah(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT p.id, r.label, r.period_start, r.period_end, p.gross, p.total_deductions, p.net
       FROM payslips p JOIN payroll_runs r ON r.id = p.run_id
      WHERE p.user_id = $1 AND r.status = 'locked' ORDER BY r.period_end DESC LIMIT 60`, [req.user.id]);
  res.json(rows);
}));
router.get('/my-payslips/:id', ah(async (req, res) => {
  const slip = await loadSlip(id(req.params.id));
  if (!slip || slip.userId !== req.user.id || slip.run.status !== 'locked') return res.status(404).json({ error: 'Not found' });
  res.json(slip);
}));

router.use(staffOnly);

/* ───────────────────────── rates / limits / policy ───────────────────────── */
const RATE_CODES = ['SSF', 'PF', 'LIMITS', 'POLICY'];
const FUND_BASES = ['basic', 'basic_grade', 'gross'];
router.get('/rates', ah(async (_req, res) => {
  const { rows } = await pool.query(`SELECT id, code, effective_from, params, note, created_at FROM payroll_rates ORDER BY code, effective_from DESC`);
  res.json(rows.map(r => ({ ...r, effective_from: d10(r.effective_from) })));
}));
router.post('/rates', ah(async (req, res) => {
  const { code, effectiveFrom, params, note } = req.body || {};
  if (!RATE_CODES.includes(code)) throw bad('Unknown rate code');
  if (!isDate(effectiveFrom)) throw bad('Effective-from date is required');
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw bad('params must be an object');
  const p = { ...params };
  if (code === 'SSF' || code === 'PF') {
    for (const k of ['employeePct', 'employerPct']) { p[k] = num(p[k]); if (p[k] < 0 || p[k] > 100) throw bad(`${k} must be between 0 and 100`); }
    if (!FUND_BASES.includes(p.base)) throw bad('base must be basic, basic_grade or gross');
  } else if (code === 'LIMITS') {
    for (const k of ['retirementMaxSharePct', 'retirementLimitAnnual', 'insuranceLimitAnnual']) { p[k] = num(p[k]); if (p[k] < 0) throw bad(`${k} cannot be negative`); }
  } else if (code === 'POLICY') {
    if (!['calendar', '30', '26'].includes(String(p.daysBasis))) throw bad('daysBasis must be calendar, 30 or 26');
    p.daysBasis = String(p.daysBasis); p.deductAbsent = p.deductAbsent !== false;
    p.unpaidLeaveCodes = (Array.isArray(p.unpaidLeaveCodes) ? p.unpaidLeaveCodes : []).map(String).slice(0, 50);
  }
  await pool.query(
    `INSERT INTO payroll_rates (code, effective_from, params, note, created_by) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (code, effective_from) DO UPDATE SET params=$3, note=$4, created_by=$5, created_at=NOW()`,
    [code, effectiveFrom, JSON.stringify(p), String(note || '').slice(0, 300), req.user.id]);
  logAudit({ actor: req.user, action: 'update', entity: 'payroll_rates', entityId: null, before: null, after: { code, effectiveFrom, params: p } });
  res.json({ ok: true });
}));
router.delete('/rates/:id', ah(async (req, res) => {
  const { rows: [r] } = await pool.query('SELECT code FROM payroll_rates WHERE id=$1', [id(req.params.id)]);
  if (!r) throw bad('Not found', 404);
  const { rows: [{ n }] } = await pool.query('SELECT COUNT(*)::int AS n FROM payroll_rates WHERE code=$1', [r.code]);
  if (n <= 1) throw bad('At least one rate row must remain for each code.', 409);
  await pool.query('DELETE FROM payroll_rates WHERE id=$1', [id(req.params.id)]);
  res.json({ ok: true });
}));

/* ───────────────────────── salary structure, increments ───────────────────────── */
const EMP_WHERE = `u.active = TRUE AND u.is_system IS NOT TRUE AND u.role <> 'superAdmin'`;
router.get('/salary', ah(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id AS user_id, u.employee_id, u.full_name, u.department, u.branch, u.position, u.gender, u.join_date,
            s.id AS salary_id, s.effective_from, s.basic, s.grade_amount, s.ssf_enrolled, s.pf_enrolled, s.marital_status, s.next_increment_date, s.scale_id, s.grade_code, s.grades_earned
       FROM users u
       LEFT JOIN LATERAL (SELECT * FROM employee_salary es WHERE es.user_id = u.id AND es.effective_from <= CURRENT_DATE ORDER BY es.effective_from DESC LIMIT 1) s ON TRUE
      WHERE ${EMP_WHERE} ORDER BY u.ranking_order NULLS LAST, u.full_name`);
  const limit = addMonths(today(), 1);
  res.json(rows.map(r => ({
    ...r, basic: num(r.basic), grade_amount: num(r.grade_amount), hasSalary: !!r.salary_id,
    effective_from: r.effective_from && d10(r.effective_from), next_increment_date: r.next_increment_date && d10(r.next_increment_date),
    incrementDue: !!r.next_increment_date && d10(r.next_increment_date) <= limit,
  })));
}));

async function salaryDetail(userId) {
  const { rows: [user] } = await pool.query(`SELECT id, employee_id, full_name, department, branch, position, gender, join_date FROM users u WHERE u.id=$1`, [userId]);
  if (!user) throw bad('Employee not found', 404);
  const { rows: history } = await pool.query(`SELECT * FROM employee_salary WHERE user_id=$1 ORDER BY effective_from DESC`, [userId]);
  const cur = history.find(h => d10(h.effective_from) <= today()) || history[0] || null;
  let items = [];
  if (cur) ({ rows: items } = await pool.query(`SELECT item_id, amount FROM employee_salary_items WHERE salary_id=$1`, [cur.id]));
  return { user, history: history.map(h => ({ ...h, effective_from: d10(h.effective_from), next_increment_date: h.next_increment_date && d10(h.next_increment_date) })), current: cur && { ...cur, effective_from: d10(cur.effective_from), next_increment_date: cur.next_increment_date && d10(cur.next_increment_date) }, items };
}
router.get('/salary/:userId', ah(async (req, res) => { res.json(await salaryDetail(id(req.params.userId))); }));

function salaryFields(b) {
  const f = {
    basic: num(b.basic), grade_amount: num(b.gradeAmount), marital_status: b.maritalStatus === 'couple' ? 'couple' : 'single',
    ssf_enrolled: !!b.ssfEnrolled, pf_enrolled: !!b.pfEnrolled, cit_monthly: num(b.citMonthly), insurance_monthly: num(b.insuranceMonthly),
    pan_no: String(b.panNo || '').slice(0, 40), ssf_no: String(b.ssfNo || '').slice(0, 40), pf_no: String(b.pfNo || '').slice(0, 40),
    cit_no: String(b.citNo || '').slice(0, 40), bank_name: String(b.bankName || '').slice(0, 120), bank_account: String(b.bankAccount || '').slice(0, 60),
    next_increment_date: isDate(b.nextIncrementDate) ? b.nextIncrementDate : null,
    scale_id: null, grade_code: null, grades_earned: 0,
  };
  for (const k of ['basic', 'grade_amount', 'cit_monthly', 'insurance_monthly']) if (f[k] < 0) throw bad(`${k} cannot be negative`);
  if (f.ssf_enrolled && f.pf_enrolled) throw bad('An employee is on SSF or PF, not both.');
  return f;
}
const SAL_COLS = ['basic', 'grade_amount', 'marital_status', 'ssf_enrolled', 'pf_enrolled', 'cit_monthly', 'insurance_monthly', 'pan_no', 'ssf_no', 'pf_no', 'cit_no', 'bank_name', 'bank_account', 'next_increment_date', 'scale_id', 'grade_code', 'grades_earned'];

/** When the salary is tied to a government pay-scale grade, the grade decides basic and grade amount (not the form). */
async function resolveScale(f, b) {
  if (!b.scaleId || !b.gradeCode) return f;
  const { rows: [g] } = await pool.query('SELECT * FROM pay_grades WHERE scale_id=$1 AND code=$2', [id(b.scaleId), String(b.gradeCode)]);
  if (!g) throw bad('That pay-scale grade was not found.', 404);
  const r = gradeSalary({ startSalary: num(g.start_salary), gradeRate: num(g.grade_rate), gradesEarned: num(b.gradesEarned), maxGrades: g.max_grades });
  if (!r.ok) throw bad(r.error, 422);
  Object.assign(f, { basic: r.basic, grade_amount: r.gradeAmount, scale_id: g.scale_id, grade_code: g.code, grades_earned: r.gradesEarned });
  return f;
}

async function saveSalaryRow(client, userId, effectiveFrom, f, { changeType, changeNote, items, actor }) {
  const { rows: [row] } = await client.query(
    `INSERT INTO employee_salary (user_id, effective_from, ${SAL_COLS.join(',')}, change_type, change_note, created_by)
     VALUES ($1,$2,${SAL_COLS.map((_, i) => `$${i + 3}`).join(',')},$${SAL_COLS.length + 3},$${SAL_COLS.length + 4},$${SAL_COLS.length + 5})
     ON CONFLICT (user_id, effective_from) DO UPDATE SET ${SAL_COLS.map(c => `${c}=EXCLUDED.${c}`).join(',')}, change_type=EXCLUDED.change_type, change_note=EXCLUDED.change_note, created_by=EXCLUDED.created_by
     RETURNING id`, [userId, effectiveFrom, ...SAL_COLS.map(c => f[c]), changeType, String(changeNote || '').slice(0, 300), actor]);
  await client.query('DELETE FROM employee_salary_items WHERE salary_id=$1', [row.id]);
  for (const it of items || []) {
    const itemId = id(it.itemId); if (!itemId) continue;
    await client.query(`INSERT INTO employee_salary_items (salary_id, item_id, amount) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [row.id, itemId, it.amount === '' || it.amount == null ? null : num(it.amount)]);
  }
  return row.id;
}

router.post('/salary/:userId', ah(async (req, res) => {
  const userId = id(req.params.userId);
  if (!isDate(req.body?.effectiveFrom)) throw bad('Effective-from date is required');
  const f = await resolveScale(salaryFields(req.body), req.body);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sid = await saveSalaryRow(client, userId, req.body.effectiveFrom, f, { changeType: req.body.changeType === 'initial' ? 'initial' : 'revision', changeNote: req.body.changeNote, items: req.body.items, actor: req.user.id });
    await client.query('COMMIT');
    logAudit({ actor: req.user, action: 'update', entity: 'employee_salary', entityId: userId, before: null, after: { effectiveFrom: req.body.effectiveFrom, basic: f.basic } });
    res.json({ ok: true, salaryId: sid });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
}));

router.post('/salary/:userId/increment', ah(async (req, res) => {
  const userId = id(req.params.userId);
  const { mode, value, effectiveDate, note } = req.body || {};
  if (!['amount', 'percent', 'grade'].includes(mode) || (mode !== 'grade' && !(num(value) > 0))) throw bad('Enter an increment amount or percentage.');
  if (!isDate(effectiveDate)) throw bad('Effective date is required');
  const d = await salaryDetail(userId);
  const cur = d.history.find(h => h.effective_from <= effectiveDate) || d.history[0];
  if (!cur) throw bad('Set up this employee\'s salary first.', 409);
  if (d.history.some(h => h.effective_from === effectiveDate)) throw bad('A salary revision already exists on that date.', 409);
  const f = {}; for (const c of SAL_COLS) f[c] = cur[c];
  let inc;
  if (mode === 'grade') {
    // government-style annual grade: one more grade x grade rate, starting salary unchanged
    if (!cur.scale_id || !cur.grade_code) throw bad('This employee is not on a pay-scale grade.', 409);
    const { rows: [g] } = await pool.query('SELECT * FROM pay_grades WHERE scale_id=$1 AND code=$2', [cur.scale_id, cur.grade_code]);
    if (!g) throw bad('The employee\'s pay-scale grade no longer exists.', 409);
    const ng = nextGrade({ startSalary: num(g.start_salary), gradeRate: num(g.grade_rate), gradesEarned: num(cur.grades_earned), maxGrades: g.max_grades, effectiveDate });
    if (!ng.ok) throw bad(ng.error, 409);
    f.basic = ng.basic; f.grade_amount = ng.gradeAmount; f.grades_earned = ng.gradesEarned; f.next_increment_date = ng.nextIncrementDate;
    inc = { newBasic: ng.basic, newGradeAmount: ng.gradeAmount, gradesEarned: ng.gradesEarned, increase: r2(ng.gradeAmount - num(cur.grade_amount)), nextIncrementDate: ng.nextIncrementDate };
  } else {
    inc = nextIncrement({ basic: num(cur.basic), mode, value: num(value), effectiveDate });
    f.basic = inc.newBasic; f.next_increment_date = inc.nextIncrementDate;
  }
  const { rows: items } = await pool.query('SELECT item_id AS "itemId", amount FROM employee_salary_items WHERE salary_id=$1', [cur.id]);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sid = await saveSalaryRow(client, userId, effectiveDate, f, { changeType: 'increment', changeNote: note || (mode === 'grade' ? 'Annual grade increment' : `${mode === 'percent' ? value + '%' : value} increment`), items, actor: req.user.id });
    await client.query('COMMIT');
    logAudit({ actor: req.user, action: 'update', entity: 'employee_salary', entityId: userId, before: { basic: num(cur.basic) }, after: { basic: inc.newBasic, effectiveDate } });
    res.json({ ok: true, salaryId: sid, ...inc });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
}));

/* ───────────────────────── case-basis allowances (e.g. maternity) ───────────────────────── */
router.get('/cases', ah(async (req, res) => {
  const params = []; let w = `WHERE 1=1`;
  if (id(req.query.userId)) { params.push(id(req.query.userId)); w += ` AND c.user_id = $${params.length}`; }
  if (['active', 'cancelled'].includes(req.query.status)) { params.push(req.query.status); w += ` AND c.status = $${params.length}`; }
  const { rows } = await pool.query(
    `SELECT c.*, u.full_name, u.employee_id, i.name AS item_name FROM payroll_cases c
       JOIN users u ON u.id=c.user_id JOIN payroll_items i ON i.id=c.item_id ${w} ORDER BY c.from_date DESC LIMIT 500`, params);
  res.json(rows.map(r => ({ ...r, from_date: d10(r.from_date), to_date: d10(r.to_date), amount: r.amount == null ? null : num(r.amount) })));
}));
router.post('/cases', ah(async (req, res) => {
  const { userId, itemId, fromDate, toDate, amount, reason } = req.body || {};
  if (!id(userId) || !id(itemId) || !isDate(fromDate) || !isDate(toDate)) throw bad('Employee, item and dates are required.');
  if (toDate < fromDate) throw bad('To-date cannot be before from-date.');
  const { rows: [item] } = await pool.query('SELECT * FROM payroll_items WHERE id=$1', [id(itemId)]);
  if (!item) throw bad('Item not found', 404);
  if (item.payment_mode !== 'need_basis') throw bad('Only “Need Basis” items can be assigned as a case.');
  const { rows: [u] } = await pool.query('SELECT gender FROM users WHERE id=$1', [id(userId)]);
  if (!u) throw bad('Employee not found', 404);
  if (item.applies_gender !== 'all') {
    if (!u.gender) throw bad('This allowance is gender-specific but the employee\'s gender is not set.');
    if (String(u.gender).toLowerCase() !== item.applies_gender) throw bad(`This allowance is only for ${item.applies_gender} employees.`);
  }
  if (amount != null && amount !== '' && num(amount) < 0) throw bad('Amount cannot be negative.');
  const { rows: [row] } = await pool.query(
    `INSERT INTO payroll_cases (user_id, item_id, from_date, to_date, amount, reason, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [id(userId), id(itemId), fromDate, toDate, amount === '' || amount == null ? null : num(amount), String(reason || '').slice(0, 300), req.user.id]);
  res.json({ ok: true, id: row.id });
}));
router.delete('/cases/:id', ah(async (req, res) => {
  await pool.query(`UPDATE payroll_cases SET status='cancelled' WHERE id=$1`, [id(req.params.id)]);
  res.json({ ok: true });
}));

/* ───────────────────────── advance policies and advances ───────────────────────── */
const POLICY_COLS = ['name', 'max_amount', 'max_basic_multiple', 'max_installments', 'interest_pct', 'min_service_months', 'allow_multiple', 'max_outstanding', 'active', 'ranking_order'];
const policyVals = (b) => {
  const nz = (v) => (v === '' || v == null ? null : num(v));
  if (!String(b.name || '').trim()) throw bad('Policy name is required');
  if (num(b.interestPct) < 0 || num(b.interestPct) > 100) throw bad('Interest must be between 0 and 100.');
  return [String(b.name).trim().slice(0, 120), nz(b.maxAmount), nz(b.maxBasicMultiple), nz(b.maxInstallments), num(b.interestPct), num(b.minServiceMonths), !!b.allowMultiple, nz(b.maxOutstanding), b.active !== false, nz(b.rankingOrder)];
};
router.get('/advance-policies', ah(async (_req, res) => { res.json((await pool.query('SELECT * FROM advance_policies ORDER BY ranking_order NULLS LAST, id')).rows); }));
router.post('/advance-policies', ah(async (req, res) => {
  const v = policyVals(req.body);
  const { rows: [r] } = await pool.query(`INSERT INTO advance_policies (${POLICY_COLS.join(',')}) VALUES (${POLICY_COLS.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING id`, v);
  res.json({ ok: true, id: r.id });
}));
router.put('/advance-policies/:id', ah(async (req, res) => {
  const v = policyVals(req.body);
  await pool.query(`UPDATE advance_policies SET ${POLICY_COLS.map((c, i) => `${c}=$${i + 1}`).join(',')} WHERE id=$${POLICY_COLS.length + 1}`, [...v, id(req.params.id)]);
  res.json({ ok: true });
}));
router.delete('/advance-policies/:id', ah(async (req, res) => {
  await pool.query('DELETE FROM advance_policies WHERE id=$1', [id(req.params.id)]);   // advances keep working: policy_id -> NULL
  res.json({ ok: true });
}));

router.get('/advances', ah(async (req, res) => {
  const params = []; let w = 'WHERE 1=1';
  if (id(req.query.userId)) { params.push(id(req.query.userId)); w += ` AND a.user_id=$${params.length}`; }
  if (req.query.status) { params.push(String(req.query.status)); w += ` AND a.status=$${params.length}`; }
  const { rows } = await pool.query(
    `SELECT a.*, u.full_name, u.employee_id, p.name AS policy_name,
            COALESCE((SELECT SUM(amount) FROM advance_recoveries r WHERE r.advance_id=a.id),0) AS recovered
       FROM employee_advances a JOIN users u ON u.id=a.user_id LEFT JOIN advance_policies p ON p.id=a.policy_id ${w} ORDER BY a.id DESC LIMIT 500`, params);
  res.json(rows.map(r => ({ ...r, start_date: d10(r.start_date), amount: num(r.amount), balance: num(r.balance), total_payable: num(r.total_payable), installment_amount: num(r.installment_amount), recovered: num(r.recovered) })));
}));
router.post('/advances', ah(async (req, res) => {
  const b = req.body || {};
  const userId = id(b.userId);
  if (!userId || !isDate(b.startDate)) throw bad('Employee and first-deduction month are required.');
  const d = await salaryDetail(userId);
  const sal = d.history.find(h => h.effective_from <= b.startDate) || d.history[0];
  if (!sal) throw bad('Set up this employee\'s salary before giving an advance.', 409);
  const { rows: [policy] } = b.policyId ? await pool.query('SELECT * FROM advance_policies WHERE id=$1 AND active', [id(b.policyId)]) : { rows: [] };
  if (b.policyId && !policy) throw bad('Advance policy not found or inactive.', 404);
  const joined = d.user.join_date ? new Date(d.user.join_date) : null;
  const serviceMonths = joined ? Math.max(0, Math.floor((Date.now() - joined.getTime()) / (30.44 * 86400000))) : 9999;
  const { rows: [out] } = await pool.query(`SELECT COALESCE(SUM(balance),0) AS bal, COUNT(*)::int AS n FROM employee_advances WHERE user_id=$1 AND status IN ('pending','running') AND balance > 0`, [userId]);
  const chk = checkAdvance({ policy, basic: num(sal.basic), serviceMonths, requested: num(b.amount), installments: num(b.installments), outstandingBalance: num(out.bal), outstandingCount: out.n });
  if (!chk.ok) throw bad(chk.errors.join(' '), 422);
  const interestPct = policy ? num(policy.interest_pct) : num(b.interestPct);
  const sch = advanceSchedule({ amount: num(b.amount), installments: num(b.installments), interestPct, startPeriod: b.startDate });
  const { rows: [row] } = await pool.query(
    `INSERT INTO employee_advances (user_id, policy_id, amount, interest_pct, installments, installment_amount, total_payable, balance, start_date, reason, requested_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10) RETURNING id`,
    [userId, policy?.id || null, sch.principal, interestPct, sch.rows.length, sch.installmentAmount, sch.total, b.startDate, String(b.reason || '').slice(0, 300), req.user.id]);
  res.json({ ok: true, id: row.id, schedule: sch });
}));
router.get('/advances/:id', ah(async (req, res) => {
  const { rows: [a] } = await pool.query(`SELECT a.*, u.full_name FROM employee_advances a JOIN users u ON u.id=a.user_id WHERE a.id=$1`, [id(req.params.id)]);
  if (!a) throw bad('Not found', 404);
  const sch = advanceSchedule({ amount: num(a.amount), installments: a.installments, interestPct: num(a.interest_pct), startPeriod: d10(a.start_date) });
  const { rows: recoveries } = await pool.query(`SELECT * FROM advance_recoveries WHERE advance_id=$1 ORDER BY period_end`, [a.id]);
  res.json({ advance: { ...a, start_date: d10(a.start_date) }, schedule: sch.rows, recoveries: recoveries.map(r => ({ ...r, amount: num(r.amount), period_end: r.period_end && d10(r.period_end) })) });
}));
/* pending -> running (approve) | rejected ; pending/running with nothing recovered yet -> cancelled */
router.post('/advances/:id/approve', ah(async (req, res) => {
  const { rowCount } = await pool.query(`UPDATE employee_advances SET status='running', approved_by=$2, approved_at=NOW() WHERE id=$1 AND status='pending'`, [id(req.params.id), req.user.id]);
  if (!rowCount) throw bad('Only a pending advance can be approved.', 409);
  logAudit({ actor: req.user, action: 'approve', entity: 'employee_advances', entityId: id(req.params.id), before: null, after: { status: 'running' } });
  res.json({ ok: true });
}));
router.post('/advances/:id/reject', ah(async (req, res) => {
  const { rowCount } = await pool.query(`UPDATE employee_advances SET status='rejected', approved_by=$2, approved_at=NOW() WHERE id=$1 AND status='pending'`, [id(req.params.id), req.user.id]);
  if (!rowCount) throw bad('Only a pending advance can be rejected.', 409);
  res.json({ ok: true });
}));
router.post('/advances/:id/cancel', ah(async (req, res) => {
  const { rows: [{ n }] } = await pool.query('SELECT COUNT(*)::int AS n FROM advance_recoveries WHERE advance_id=$1', [id(req.params.id)]);
  if (n > 0) throw bad('Installments have already been recovered; it cannot be cancelled.', 409);
  const { rowCount } = await pool.query(`UPDATE employee_advances SET status='cancelled' WHERE id=$1 AND status IN ('pending','running')`, [id(req.params.id)]);
  if (!rowCount) throw bad('This advance cannot be cancelled.', 409);
  res.json({ ok: true });
}));

/* ───────────────────────── payslip loader (shared with payrollRuns.js) ───────────────────────── */
export async function loadSlip(slipId) {
  if (!slipId) return null;
  const { rows: [p] } = await pool.query(
    `SELECT p.*, u.full_name, u.employee_id, u.department, u.branch, u.position, r.label, r.period_start, r.period_end, r.status AS run_status,
            s.bank_name, s.bank_account, s.pan_no, s.ssf_no, s.pf_no, s.cit_no
       FROM payslips p JOIN users u ON u.id=p.user_id JOIN payroll_runs r ON r.id=p.run_id LEFT JOIN employee_salary s ON s.id=p.salary_id
      WHERE p.id=$1`, [slipId]);
  if (!p) return null;
  const { rows: lines } = await pool.query('SELECT kind, code, name, amount, item_id, ref FROM payslip_lines WHERE payslip_id=$1 ORDER BY sort, id', [slipId]);
  return {
    id: p.id, userId: p.user_id, runId: p.run_id,
    run: { label: p.label, periodStart: d10(p.period_start), periodEnd: d10(p.period_end), status: p.run_status },
    employee: { name: p.full_name, code: p.employee_id, department: p.department, branch: p.branch, position: p.position, bankName: p.bank_name, bankAccount: p.bank_account, pan: p.pan_no, ssfNo: p.ssf_no, pfNo: p.pf_no, citNo: p.cit_no },
    days: { base: p.base_days, payable: num(p.payable_days), absent: num(p.absent_days), unpaidLeave: num(p.unpaid_leave_days) },
    gross: num(p.gross), totalDeductions: num(p.total_deductions), net: num(p.net), employerCost: num(p.employer_cost), tax: num(p.tax),
    adjustments: p.adjustments, detail: p.detail, warnings: p.warnings,
    lines: lines.map(l => ({ ...l, amount: num(l.amount) })),
  };
}

export { rateAt, slabsAt, fiscalRange, staffOnly, ah, bad, id, num, isDate, d10, today, SAL_COLS, saveSalaryRow };
export default router;
