import { Router } from 'express';
import pool from '../db.js';
import { logAudit } from '../services/auditLog.js';
import { computeSlip, r2 } from '../services/payrollEngine.js';
import { rateAt, slabsAt, fiscalRange, staffOnly, ah, bad, id, num, isDate, d10, loadSlip } from './payroll.js';

/* Payroll runs (draft -> approved -> locked), payslips, the register report and the SSF/PF/CIT/insurance
   fund ledger. A run reads everything it needs at build time from the database: effective-dated rates,
   limits, tax slabs, salary revisions, assigned items, case allowances, advances and attendance. */
const router = Router();
router.use(staffOnly);

const EMP_WHERE = `u.active = TRUE AND u.is_system IS NOT TRUE AND u.role <> 'superAdmin'`;
const FUNDS = ['SSF', 'PF', 'CIT', 'INS'];

/* ── attendance feed: reuse the existing monthly report (same absent/leave rules as every other report) ── */
async function attendanceFor(req, start, end) {
  const port = process.env.PORT || 5001;
  const r = await fetch(`http://127.0.0.1:${port}/api/attendance/monthly?startDate=${start}&endDate=${end}`, {
    headers: { Authorization: req.headers.authorization || '' }, signal: AbortSignal.timeout(90_000),
  });
  if (!r.ok) throw bad(`Could not read attendance for this period (HTTP ${r.status}).`, 502);
  const j = await r.json();
  return new Map((j.allStats || []).map(s => [s.id, s]));
}

async function unpaidLeaveDays(codes, start, end) {
  const map = new Map();
  if (!codes.length) return map;
  const { rows } = await pool.query(
    `SELECT employee_id, from_date, to_date, half_day FROM leaves WHERE status='approved' AND leave_type_code = ANY($1) AND from_date <= $3 AND to_date >= $2`, [codes, start, end]);
  for (const l of rows) {
    const a = Math.max(Date.parse(d10(l.from_date)), Date.parse(start)), b = Math.min(Date.parse(d10(l.to_date)), Date.parse(end));
    const days = Math.max(0, Math.round((b - a) / 86400000) + 1) * (l.half_day ? 0.5 : 1);
    map.set(l.employee_id, (map.get(l.employee_id) || 0) + days);
  }
  return map;
}

/* ── build (or rebuild) payslips for a run; officer overrides stored in payslips.adjustments survive a rebuild ── */
async function buildRun(req, run, onlyUserId = null) {
  const start = d10(run.period_start), end = d10(run.period_end);
  const [pol, limits, ssf, pf, slabs, fy] = await Promise.all([
    rateAt('POLICY', end), rateAt('LIMITS', end), rateAt('SSF', end), rateAt('PF', end), slabsAt(end), fiscalRange(end)]);
  const policy = { daysBasis: 'calendar', deductAbsent: true, unpaidLeaveCodes: [], ...pol };

  const only = onlyUserId ? 'AND u.id = $2' : '';
  const { rows: emps } = await pool.query(
    `SELECT u.id AS user_id, u.full_name, u.gender, s.id AS salary_id, s.basic, s.grade_amount, s.marital_status, s.ssf_enrolled, s.pf_enrolled, s.cit_monthly, s.insurance_monthly
       FROM users u JOIN LATERAL (SELECT * FROM employee_salary es WHERE es.user_id = u.id AND es.effective_from <= $1 ORDER BY es.effective_from DESC LIMIT 1) s ON TRUE
      WHERE ${EMP_WHERE} AND (u.join_date IS NULL OR u.join_date <= $1) ${only}`, onlyUserId ? [end, onlyUserId] : [end]);
  const ids = emps.map(e => e.user_id);
  const salaryIds = emps.map(e => e.salary_id);

  const [att, unpaid, assigned, yearly, cases, advs, prior, existing] = await Promise.all([
    attendanceFor(req, start, end),
    unpaidLeaveDays(policy.unpaidLeaveCodes || [], start, end),
    pool.query(`SELECT si.salary_id, si.amount AS override, i.* FROM employee_salary_items si JOIN payroll_items i ON i.id = si.item_id WHERE si.salary_id = ANY($1)`, [salaryIds]),
    pool.query(`SELECT * FROM payroll_items WHERE id = ANY($1) AND payment_mode = 'yearly'`, [run.include_item_ids || []]),
    pool.query(`SELECT c.*, i.name AS item_name, i.type, i.taxable, i.calc_method, i.calc_value FROM payroll_cases c JOIN payroll_items i ON i.id = c.item_id
                 WHERE c.status='active' AND c.from_date <= $2 AND c.to_date >= $1 AND c.user_id = ANY($3)`, [start, end, ids]),
    pool.query(`SELECT * FROM employee_advances WHERE status='running' AND balance > 0 AND start_date <= $1 AND user_id = ANY($2) ORDER BY id`, [end, ids]),
    pool.query(`SELECT DISTINCT p.user_id, l.item_id FROM payslip_lines l JOIN payslips p ON p.id = l.payslip_id JOIN payroll_runs r ON r.id = p.run_id
                 WHERE l.item_id = ANY($1) AND r.id <> $2 AND r.status IN ('approved','locked') AND r.period_end BETWEEN $3 AND $4`, [run.include_item_ids || [], run.id, fy.start, fy.end]),
    pool.query('SELECT user_id, adjustments FROM payslips WHERE run_id = $1', [run.id]),
  ]);
  const alreadyPaid = new Set(prior.rows.map(r => `${r.user_id}:${r.item_id}`));
  const adjMap = new Map(existing.rows.map(r => [r.user_id, r.adjustments || {}]));
  const bySalary = new Map();
  for (const r of assigned.rows) { if (!bySalary.has(r.salary_id)) bySalary.set(r.salary_id, []); bySalary.get(r.salary_id).push(r); }

  const fundCfg = (c) => (c && c.employeePct != null ? { employeePct: num(c.employeePct), employerPct: num(c.employerPct), base: c.base || 'basic' } : null);
  const client = await pool.connect();
  const out = [];
  try {
    await client.query('BEGIN');
    for (const e of emps) {
      const warnings = [];
      const adj = adjMap.get(e.user_id) || {};
      const a = att.get(e.user_id);
      if (!a) warnings.push('No attendance data for this period - absent days taken as 0.');
      const absent = adj.absentDays != null ? num(adj.absentDays) : num(a?.absentDays);
      const unpaidDays = adj.unpaidLeaveDays != null ? num(adj.unpaidLeaveDays) : num(unpaid.get(e.user_id));
      const genderOk = (i) => i.applies_gender === 'all' || String(e.gender || '').toLowerCase() === i.applies_gender;

      const items = [];
      const pushItem = (i, value, oneOff) => {
        if (i.calc_method === 'formula') { warnings.push(`"${i.name}" uses a formula, which is not supported yet - skipped.`); return; }
        if (!genderOk(i)) return;
        items.push({ itemId: i.id, name: i.name, type: i.type, calcMethod: i.calc_method, value: num(value), taxable: i.taxable, prorate: i.prorate !== false, oneOff });
      };
      const assignedForEmp = bySalary.get(e.salary_id) || [];
      for (const r of assignedForEmp) if (r.payment_mode === 'monthly') pushItem(r, r.override ?? r.calc_value, false);
      for (const y of yearly.rows) {
        const own = assignedForEmp.find(r => r.id === y.id);
        const value = own && own.override != null ? own.override : y.calc_value;
        if (num(value) === 0 && own && own.override != null) continue;                 // explicitly excluded (amount 0)
        if (alreadyPaid.has(`${e.user_id}:${y.id}`)) { warnings.push(`"${y.name}" was already paid this fiscal year - not paid again.`); continue; }
        pushItem(y, value, true);
      }
      const extras = [];
      for (const c of cases.rows.filter(c => c.user_id === e.user_id)) {
        const raw = c.amount != null ? num(c.amount)
          : c.calc_method === 'percent_of_basic' ? num(e.basic) * num(c.calc_value) / 100
          : c.calc_method === 'months_of_basic' ? num(e.basic) * num(c.calc_value) : num(c.calc_value);
        extras.push({ name: c.item_name, type: c.type, amount: raw, taxable: c.taxable, itemId: c.item_id });
      }
      for (const x of adj.extras || []) extras.push({ name: String(x.name || 'Adjustment').slice(0, 80), type: x.type === 'deduction' ? 'deduction' : 'earning', amount: num(x.amount), taxable: x.taxable !== false });

      const slip = computeSlip({
        period: { start, end },
        settings: { daysBasis: policy.daysBasis, deductAbsent: policy.deductAbsent !== false, retirementMaxSharePct: limits.retirementMaxSharePct, retirementLimitAnnual: limits.retirementLimitAnnual, insuranceLimitAnnual: limits.insuranceLimitAnnual },
        salary: { basic: num(e.basic), gradeAmount: num(e.grade_amount), maritalStatus: e.marital_status, ssfEnrolled: e.ssf_enrolled, pfEnrolled: e.pf_enrolled, citMonthly: num(e.cit_monthly), insuranceMonthly: num(e.insurance_monthly), items },
        attendance: { absentDays: absent, unpaidLeaveDays: unpaidDays },
        extras, funds: { ssf: fundCfg(ssf), pf: fundCfg(pf) }, tax: { slabs },
        advances: advs.rows.filter(x => x.user_id === e.user_id).map(x => ({ advanceId: x.id, balance: num(x.balance), installment: num(x.installment_amount) })),
      });
      if (e.ssf_enrolled && !fundCfg(ssf)) warnings.push('SSF rate is not configured (Payroll > Rates & Limits).');
      if (e.pf_enrolled && !fundCfg(pf)) warnings.push('PF rate is not configured (Payroll > Rates & Limits).');
      if (!slabs.single.length && !slabs.couple.length && slip.tax.annualTaxable > 0) warnings.push('No tax slabs are configured for this date - income tax is 0.');
      for (const rc of slip.recoveries) if (rc.shortfall > 0) warnings.push(`Advance #${rc.advanceId}: ${rc.shortfall} of the installment could not be recovered (not enough pay).`);

      const detail = { tax: slip.tax, recoveries: slip.recoveries, ledger: slip.ledger, days: slip.days };
      const { rows: [p] } = await client.query(
        `INSERT INTO payslips (run_id, user_id, salary_id, absent_days, unpaid_leave_days, payable_days, base_days, gross, total_deductions, net, employer_cost, tax, adjustments, detail, warnings)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (run_id, user_id) DO UPDATE SET salary_id=EXCLUDED.salary_id, absent_days=EXCLUDED.absent_days, unpaid_leave_days=EXCLUDED.unpaid_leave_days,
           payable_days=EXCLUDED.payable_days, base_days=EXCLUDED.base_days, gross=EXCLUDED.gross, total_deductions=EXCLUDED.total_deductions, net=EXCLUDED.net,
           employer_cost=EXCLUDED.employer_cost, tax=EXCLUDED.tax, adjustments=EXCLUDED.adjustments, detail=EXCLUDED.detail, warnings=EXCLUDED.warnings
         RETURNING id`,
        [run.id, e.user_id, e.salary_id, absent, unpaidDays, slip.days.payable, slip.days.base, slip.gross, slip.totalDeductions, slip.net, slip.employerCost, slip.tax.monthly, JSON.stringify(adj), JSON.stringify(detail), warnings]);
      await client.query('DELETE FROM payslip_lines WHERE payslip_id = $1', [p.id]);
      let sort = 0;
      for (const l of slip.lines) await client.query(`INSERT INTO payslip_lines (payslip_id, kind, code, name, amount, item_id, ref, sort) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [p.id, l.kind, l.code, l.name, l.amount, l.itemId || null, l.ref || null, sort++]);
      out.push(p.id);
    }
    if (!onlyUserId) await client.query('DELETE FROM payslips WHERE run_id = $1 AND NOT (user_id = ANY($2))', [run.id, ids]);
    await client.query('COMMIT');
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); throw err; } finally { client.release(); }
  return out.length;
}

const getRun = async (runId) => {
  const { rows: [r] } = await pool.query('SELECT * FROM payroll_runs WHERE id=$1', [runId]);
  if (!r) throw bad('Run not found', 404);
  return r;
};
const runDto = (r) => ({ ...r, period_start: d10(r.period_start), period_end: d10(r.period_end) });

/* ── runs ── */
router.get('/runs', ah(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT r.*, COUNT(p.id)::int AS slips, COALESCE(SUM(p.gross),0) AS gross, COALESCE(SUM(p.total_deductions),0) AS deductions, COALESCE(SUM(p.net),0) AS net,
            COALESCE(SUM(p.employer_cost),0) AS employer_cost, COALESCE(SUM(p.tax),0) AS tax
       FROM payroll_runs r LEFT JOIN payslips p ON p.run_id = r.id GROUP BY r.id ORDER BY r.period_end DESC, r.id DESC LIMIT 120`);
  res.json(rows.map(r => ({ ...runDto(r), gross: num(r.gross), deductions: num(r.deductions), net: num(r.net), employer_cost: num(r.employer_cost), tax: num(r.tax) })));
}));

async function assertNoOverlap(run, selfId) {
  const { rows } = await pool.query(
    `SELECT id, label FROM payroll_runs WHERE status IN ('approved','locked') AND id <> $3 AND NOT (period_end < $1 OR period_start > $2) LIMIT 1`, [run.start, run.end, selfId || 0]);
  if (rows[0]) throw bad(`This period overlaps the ${rows[0].label} run, which is already approved/locked.`, 409);
}

router.post('/runs', ah(async (req, res) => {
  const { label, periodStart, periodEnd, includeItemIds, notes } = req.body || {};
  if (!isDate(periodStart) || !isDate(periodEnd) || periodEnd < periodStart) throw bad('Enter a valid period.');
  if ((Date.parse(periodEnd) - Date.parse(periodStart)) / 86400000 > 62) throw bad('A payroll period cannot be longer than about two months.');
  await assertNoOverlap({ start: periodStart, end: periodEnd });
  const inc = (Array.isArray(includeItemIds) ? includeItemIds : []).map(id).filter(Boolean);
  if (inc.length) {
    const { rows } = await pool.query(`SELECT id FROM payroll_items WHERE id = ANY($1) AND payment_mode='yearly'`, [inc]);
    if (rows.length !== inc.length) throw bad('Only Yearly items can be added to a run.');
  }
  const { rows: [run] } = await pool.query(
    `INSERT INTO payroll_runs (label, period_start, period_end, include_item_ids, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [String(label || `${periodStart} to ${periodEnd}`).slice(0, 120), periodStart, periodEnd, inc, String(notes || '').slice(0, 300), req.user.id]);
  let n;
  try { n = await buildRun(req, run); } catch (e) { await pool.query('DELETE FROM payroll_runs WHERE id=$1', [run.id]); throw e; }
  logAudit({ actor: req.user, action: 'create', entity: 'payroll_run', entityId: run.id, before: null, after: { periodStart, periodEnd, slips: n } });
  res.json({ ok: true, id: run.id, slips: n });
}));

router.get('/runs/:id', ah(async (req, res) => {
  const run = await getRun(id(req.params.id));
  const { rows } = await pool.query(
    `SELECT p.id, p.user_id, u.full_name, u.employee_id, u.department, u.branch, p.base_days, p.payable_days, p.absent_days, p.unpaid_leave_days,
            p.gross, p.total_deductions, p.net, p.employer_cost, p.tax, p.warnings
       FROM payslips p JOIN users u ON u.id = p.user_id WHERE p.run_id = $1 ORDER BY u.ranking_order NULLS LAST, u.full_name`, [run.id]);
  const slips = rows.map(r => ({ ...r, payable_days: num(r.payable_days), absent_days: num(r.absent_days), unpaid_leave_days: num(r.unpaid_leave_days), gross: num(r.gross), total_deductions: num(r.total_deductions), net: num(r.net), employer_cost: num(r.employer_cost), tax: num(r.tax) }));
  const sum = (k) => r2(slips.reduce((s, x) => s + x[k], 0));
  const { rows: yearly } = await pool.query(`SELECT id, name FROM payroll_items WHERE id = ANY($1)`, [run.include_item_ids || []]);
  res.json({ run: runDto(run), yearlyItems: yearly, slips, totals: { gross: sum('gross'), deductions: sum('total_deductions'), net: sum('net'), employerCost: sum('employer_cost'), tax: sum('tax') } });
}));

router.get('/runs/:id/slips/:slipId', ah(async (req, res) => {
  const s = await loadSlip(id(req.params.slipId));
  if (!s || s.runId !== id(req.params.id)) throw bad('Payslip not found', 404);
  res.json(s);
}));

router.put('/runs/:id/slips/:slipId', ah(async (req, res) => {
  const run = await getRun(id(req.params.id));
  if (run.status !== 'draft') throw bad('Only a draft run can be edited.', 409);
  const { rows: [p] } = await pool.query('SELECT user_id, adjustments FROM payslips WHERE id=$1 AND run_id=$2', [id(req.params.slipId), run.id]);
  if (!p) throw bad('Payslip not found', 404);
  const b = req.body || {};
  const adj = { ...(p.adjustments || {}) };
  if ('absentDays' in b) { if (b.absentDays === '' || b.absentDays == null) delete adj.absentDays; else { if (num(b.absentDays) < 0) throw bad('Days cannot be negative.'); adj.absentDays = num(b.absentDays); } }
  if ('unpaidLeaveDays' in b) { if (b.unpaidLeaveDays === '' || b.unpaidLeaveDays == null) delete adj.unpaidLeaveDays; else { if (num(b.unpaidLeaveDays) < 0) throw bad('Days cannot be negative.'); adj.unpaidLeaveDays = num(b.unpaidLeaveDays); } }
  if ('extras' in b) adj.extras = (Array.isArray(b.extras) ? b.extras : []).slice(0, 20).filter(x => x && x.name && num(x.amount) > 0).map(x => ({ name: String(x.name).slice(0, 80), type: x.type === 'deduction' ? 'deduction' : 'earning', amount: num(x.amount), taxable: x.taxable !== false }));
  await pool.query('UPDATE payslips SET adjustments=$1 WHERE id=$2', [JSON.stringify(adj), id(req.params.slipId)]);
  await buildRun(req, run, p.user_id);
  res.json(await loadSlip(id(req.params.slipId)));
}));

router.post('/runs/:id/rebuild', ah(async (req, res) => {
  const run = await getRun(id(req.params.id));
  if (run.status !== 'draft') throw bad('Only a draft run can be rebuilt.', 409);
  res.json({ ok: true, slips: await buildRun(req, run) });
}));

router.post('/runs/:id/approve', ah(async (req, res) => {
  const run = await getRun(id(req.params.id));
  if (run.status !== 'draft') throw bad('Only a draft run can be approved.', 409);
  await assertNoOverlap({ start: d10(run.period_start), end: d10(run.period_end) }, run.id);
  const { rows: [{ n }] } = await pool.query('SELECT COUNT(*)::int AS n FROM payslips WHERE run_id=$1', [run.id]);
  if (!n) throw bad('This run has no payslips.', 409);
  await pool.query(`UPDATE payroll_runs SET status='approved', approved_by=$2, approved_at=NOW() WHERE id=$1`, [run.id, req.user.id]);
  logAudit({ actor: req.user, action: 'approve', entity: 'payroll_run', entityId: run.id, before: null, after: { slips: n } });
  res.json({ ok: true });
}));
router.post('/runs/:id/reopen', ah(async (req, res) => {
  const { rowCount } = await pool.query(`UPDATE payroll_runs SET status='draft', approved_by=NULL, approved_at=NULL WHERE id=$1 AND status='approved'`, [id(req.params.id)]);
  if (!rowCount) throw bad('Only an approved (not yet locked) run can be reopened.', 409);
  res.json({ ok: true });
}));

/* Lock = final. Posts advance recoveries and the fund-ledger contributions; a locked run can't change. */
router.post('/runs/:id/lock', ah(async (req, res) => {
  const run = await getRun(id(req.params.id));
  if (run.status !== 'approved') throw bad('Approve the run before locking it.', 409);
  const end = d10(run.period_end), fy = await fiscalRange(end);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // once-a-year guard, re-checked now that other runs may have been locked since this one was built
    if ((run.include_item_ids || []).length) {
      const { rows: dup } = await client.query(
        `SELECT u.full_name, i.name FROM payslip_lines l JOIN payslips p ON p.id=l.payslip_id JOIN users u ON u.id=p.user_id JOIN payroll_items i ON i.id=l.item_id
          WHERE p.run_id = $1 AND l.item_id = ANY($2) AND EXISTS (
            SELECT 1 FROM payslip_lines l2 JOIN payslips p2 ON p2.id=l2.payslip_id JOIN payroll_runs r2 ON r2.id=p2.run_id
             WHERE p2.user_id = p.user_id AND l2.item_id = l.item_id AND r2.id <> $1 AND r2.status IN ('approved','locked') AND r2.period_end BETWEEN $3 AND $4) LIMIT 5`,
        [run.id, run.include_item_ids, fy.start, fy.end]);
      if (dup.length) throw bad(`Already paid this fiscal year: ${dup.map(d => `${d.full_name} (${d.name})`).join(', ')}. Rebuild the run.`, 409);
    }
    const { rows: slips } = await client.query('SELECT id, user_id, detail FROM payslips WHERE run_id=$1', [run.id]);
    await client.query('DELETE FROM advance_recoveries WHERE run_id=$1', [run.id]);
    await client.query('DELETE FROM fund_ledger WHERE run_id=$1', [run.id]);
    for (const s of slips) {
      for (const rc of s.detail?.recoveries || []) {
        if (!(num(rc.amount) > 0)) continue;
        const { rows: [adv] } = await client.query('SELECT balance FROM employee_advances WHERE id=$1 FOR UPDATE', [rc.advanceId]);
        if (!adv || num(adv.balance) + 0.005 < num(rc.amount)) throw bad(`Advance #${rc.advanceId} balance changed since this run was built. Reopen and rebuild the run.`, 409);
        await client.query('INSERT INTO advance_recoveries (advance_id, run_id, payslip_id, amount, period_end) VALUES ($1,$2,$3,$4,$5)', [rc.advanceId, run.id, s.id, rc.amount, end]);
        await client.query(`UPDATE employee_advances SET balance = GREATEST(balance - $2, 0), status = CASE WHEN balance - $2 <= 0.005 THEN 'closed' ELSE status END WHERE id=$1`, [rc.advanceId, rc.amount]);
      }
      for (const l of s.detail?.ledger || []) {
        if (!FUNDS.includes(l.fund) || (!(num(l.employee) > 0) && !(num(l.employer) > 0))) continue;
        await client.query(`INSERT INTO fund_ledger (user_id, fund_code, period_end, run_id, employee_amt, employer_amt, entry_type, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,'contribution',$7,$8)`,
          [s.user_id, l.fund, end, run.id, num(l.employee), num(l.employer), run.label, req.user.id]);
      }
    }
    await client.query(`UPDATE payroll_runs SET status='locked', locked_at=NOW() WHERE id=$1`, [run.id]);
    await client.query('COMMIT');
    logAudit({ actor: req.user, action: 'lock', entity: 'payroll_run', entityId: run.id, before: null, after: { slips: slips.length } });
    res.json({ ok: true, slips: slips.length });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
}));

router.delete('/runs/:id', ah(async (req, res) => {
  const { rowCount } = await pool.query(`DELETE FROM payroll_runs WHERE id=$1 AND status='draft'`, [id(req.params.id)]);
  if (!rowCount) throw bad('Only a draft run can be deleted.', 409);
  res.json({ ok: true });
}));

/* ── register: one row per employee, deductions split by type — drives the Excel / bank sheet / tax statement ── */
router.get('/runs/:id/register', ah(async (req, res) => {
  const run = await getRun(id(req.params.id));
  const { rows } = await pool.query(
    `SELECT p.id, p.user_id, u.full_name, u.employee_id, u.department, u.branch, u.position, p.base_days, p.payable_days, p.gross, p.total_deductions, p.net, p.employer_cost, p.tax,
            s.bank_name, s.bank_account, s.pan_no, s.ssf_no, s.pf_no, s.cit_no
       FROM payslips p JOIN users u ON u.id = p.user_id LEFT JOIN employee_salary s ON s.id = p.salary_id WHERE p.run_id = $1 ORDER BY u.ranking_order NULLS LAST, u.full_name`, [run.id]);
  const { rows: lines } = await pool.query(`SELECT payslip_id, kind, code, name, amount FROM payslip_lines WHERE payslip_id = ANY($1)`, [rows.map(r => r.id)]);
  const by = new Map();
  for (const l of lines) { if (!by.has(l.payslip_id)) by.set(l.payslip_id, []); by.get(l.payslip_id).push(l); }
  const code = (ls, c) => r2(ls.filter(l => l.code === c).reduce((s, l) => s + num(l.amount), 0));
  res.json({
    run: runDto(run),
    rows: rows.map(r => {
      const ls = by.get(r.id) || [];
      return {
        userId: r.user_id, name: r.full_name, code: r.employee_id, department: r.department, branch: r.branch, position: r.position,
        bankName: r.bank_name, bankAccount: r.bank_account, pan: r.pan_no, ssfNo: r.ssf_no, pfNo: r.pf_no, citNo: r.cit_no,
        baseDays: r.base_days, payableDays: num(r.payable_days), basic: code(ls, 'BASIC'), grade: code(ls, 'GRADE'),
        allowances: r2(ls.filter(l => l.kind === 'earning' && ['ITEM', 'EXTRA'].includes(l.code)).reduce((s, l) => s + num(l.amount), 0)),
        gross: num(r.gross), ssfEmployee: code(ls, 'SSF'), ssfEmployer: code(ls, 'SSF_ER'), pfEmployee: code(ls, 'PF'), pfEmployer: code(ls, 'PF_ER'),
        cit: code(ls, 'CIT'), insurance: code(ls, 'INS'), tax: code(ls, 'TAX'), advance: code(ls, 'ADV'),
        otherDeductions: r2(ls.filter(l => l.kind === 'deduction' && ['ITEM', 'EXTRA'].includes(l.code)).reduce((s, l) => s + num(l.amount), 0)),
        totalDeductions: num(r.total_deductions), net: num(r.net), employerCost: num(r.employer_cost),
      };
    }),
  });
}));

/* ───────────────────────── fund ledger (SSF / PF / CIT / insurance) ───────────────────────── */
router.get('/ledger', ah(async (req, res) => {
  const fund = FUNDS.includes(req.query.fund) ? req.query.fund : null;
  const userId = id(req.query.userId);
  const from = isDate(req.query.from) ? req.query.from : null, to = isDate(req.query.to) ? req.query.to : null;
  if (!userId) throw bad('Choose an employee.');
  const { rows } = await pool.query(
    `SELECT l.id, l.fund_code, l.period_end, l.employee_amt, l.employer_amt, l.entry_type, l.note, l.run_id FROM fund_ledger l
      WHERE l.user_id = $1 AND ($2::text IS NULL OR l.fund_code = $2) ORDER BY l.fund_code, l.period_end, l.id`, [userId, fund]);
  const bal = {}; const out = []; const opening = {};
  for (const r of rows) {
    const e = num(r.employee_amt), er = num(r.employer_amt);
    bal[r.fund_code] = r2((bal[r.fund_code] || 0) + e + er);
    const pe = d10(r.period_end);
    if (from && pe < from) { opening[r.fund_code] = bal[r.fund_code]; continue; }
    if (to && pe > to) continue;
    out.push({ id: r.id, fund: r.fund_code, periodEnd: pe, employee: e, employer: er, total: r2(e + er), type: r.entry_type, note: r.note, runId: r.run_id, balance: bal[r.fund_code] });
  }
  const sum = (k) => r2(out.reduce((s, x) => s + x[k], 0));
  res.json({ opening, rows: out, totals: { employee: sum('employee'), employer: sum('employer'), total: sum('total') } });
}));

router.get('/ledger/summary', ah(async (req, res) => {
  const fund = FUNDS.includes(req.query.fund) ? req.query.fund : 'SSF';
  const asOf = isDate(req.query.asOf) ? req.query.asOf : new Date().toISOString().slice(0, 10);
  const { rows } = await pool.query(
    `SELECT u.id AS user_id, u.full_name, u.employee_id, u.department, s.ssf_no, s.pf_no, s.cit_no,
            COALESCE(SUM(l.employee_amt),0) AS employee, COALESCE(SUM(l.employer_amt),0) AS employer
       FROM fund_ledger l JOIN users u ON u.id = l.user_id
       LEFT JOIN LATERAL (SELECT * FROM employee_salary es WHERE es.user_id = u.id ORDER BY es.effective_from DESC LIMIT 1) s ON TRUE
      WHERE l.fund_code = $1 AND l.period_end <= $2 GROUP BY u.id, u.full_name, u.employee_id, u.department, s.ssf_no, s.pf_no, s.cit_no ORDER BY u.full_name`, [fund, asOf]);
  res.json({ fund, asOf, rows: rows.map(r => ({ ...r, employee: num(r.employee), employer: num(r.employer), total: r2(num(r.employee) + num(r.employer)) })) });
}));

router.post('/ledger/entry', ah(async (req, res) => {
  const b = req.body || {};
  if (!id(b.userId) || !FUNDS.includes(b.fundCode) || !isDate(b.periodEnd)) throw bad('Employee, fund and date are required.');
  if (!['opening', 'adjustment', 'withdrawal'].includes(b.entryType)) throw bad('Entry type must be opening, adjustment or withdrawal.');
  let e = num(b.employeeAmt), er = num(b.employerAmt);
  if (b.entryType === 'withdrawal') { e = -Math.abs(e); er = -Math.abs(er); }
  if (b.entryType === 'opening' && (e < 0 || er < 0)) throw bad('Opening balances cannot be negative.');
  if (e === 0 && er === 0) throw bad('Enter an amount.');
  await pool.query(`INSERT INTO fund_ledger (user_id, fund_code, period_end, employee_amt, employer_amt, entry_type, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id(b.userId), b.fundCode, b.periodEnd, e, er, b.entryType, String(b.note || '').slice(0, 300), req.user.id]);
  logAudit({ actor: req.user, action: 'create', entity: 'fund_ledger', entityId: id(b.userId), before: null, after: { fund: b.fundCode, type: b.entryType, e, er } });
  res.json({ ok: true });
}));
router.delete('/ledger/entry/:id', ah(async (req, res) => {
  const { rowCount } = await pool.query(`DELETE FROM fund_ledger WHERE id=$1 AND run_id IS NULL`, [id(req.params.id)]);
  if (!rowCount) throw bad('Only manual entries can be deleted; run contributions are removed by reopening the run.', 409);
  res.json({ ok: true });
}));

export default router;
