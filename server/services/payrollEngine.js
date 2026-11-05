// eHajiri Payroll — pure calculation engine (no DB, no Express). Every rate, slab,
// limit and policy comes in as data so nothing Nepal-specific is hard-coded here:
// tax slabs, SSF/PF percentages, deduction limits and advance rules are all editable
// settings that an accountant maintains. Amounts are rounded to 2 decimals per line.

export const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/* ─────────────── dates ─────────────── */
const ymd = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
const parse = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
export const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000) + 1;
export function addMonths(dateStr, n) {
  const d = parse(dateStr); const day = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return ymd(d);
}
export const addYears = (dateStr, n) => addMonths(dateStr, 12 * n);

/* ─────────────── income tax ─────────────── */
/** slabs: [{from,to|null,rate(%),isSst?}] ascending. Progressive on `annual` taxable income.
 *  When `waiveSst` (employee contributes to SSF) slabs flagged isSst are charged at 0%. */
export function computeAnnualTax(annual, slabs, { waiveSst = false } = {}) {
  let tax = 0; const parts = [];
  const sorted = [...(slabs || [])].sort((a, b) => num(a.from) - num(b.from));
  for (const s of sorted) {
    const from = num(s.from), to = s.to == null || s.to === '' ? Infinity : num(s.to);
    if (annual <= from) break;
    const portion = Math.min(annual, to) - from;
    if (portion <= 0) continue;
    const rate = waiveSst && s.isSst ? 0 : num(s.rate);
    const t = portion * rate / 100;
    tax += t; parts.push({ from, to: Number.isFinite(to) ? to : null, rate, portion: r2(portion), tax: r2(t) });
  }
  return { tax: r2(tax), parts };
}

/* ─────────────── advance policy ─────────────── */
/** Equal-installment schedule. Interest is a flat % of principal over the whole term. */
export function advanceSchedule({ amount, installments, interestPct = 0, startPeriod }) {
  const n = Math.max(1, Math.floor(num(installments)));
  const principal = num(amount);
  const interest = r2(principal * num(interestPct) / 100);
  const total = r2(principal + interest);
  const each = r2(total / n);
  const rows = [];
  let left = total;
  for (let i = 1; i <= n; i++) {
    const amt = i === n ? r2(left) : each;          // last installment absorbs rounding
    left = r2(left - amt);
    rows.push({ no: i, period: startPeriod ? addMonths(startPeriod, i - 1) : null, amount: amt });
  }
  return { principal, interest, total, installmentAmount: each, rows };
}

/** Returns { ok, errors[], maxAmount } for a requested advance under a policy. */
export function checkAdvance({ policy, basic, serviceMonths, requested, installments, outstandingBalance = 0, outstandingCount = 0 }) {
  const errors = [];
  const p = policy || {};
  const caps = [];
  if (num(p.max_amount) > 0) caps.push(num(p.max_amount));
  if (num(p.max_basic_multiple) > 0) caps.push(num(p.max_basic_multiple) * num(basic));
  const maxAmount = caps.length ? r2(Math.min(...caps)) : null;
  if (!(num(requested) > 0)) errors.push('Advance amount must be greater than zero.');
  if (maxAmount != null && num(requested) > maxAmount) errors.push(`Amount exceeds the policy limit of ${maxAmount}.`);
  if (num(p.max_installments) > 0 && num(installments) > num(p.max_installments)) errors.push(`At most ${p.max_installments} installments are allowed.`);
  if (num(installments) < 1) errors.push('At least one installment is required.');
  if (num(p.min_service_months) > 0 && num(serviceMonths) < num(p.min_service_months)) errors.push(`Needs at least ${p.min_service_months} months of service.`);
  if (p.allow_multiple === false && outstandingCount > 0) errors.push('An earlier advance is still being repaid.');
  if (num(p.max_outstanding) > 0 && num(outstandingBalance) + num(requested) > num(p.max_outstanding)) errors.push(`Total outstanding advances may not exceed ${p.max_outstanding}.`);
  return { ok: errors.length === 0, errors, maxAmount };
}

/* ─────────────── salary increment ─────────────── */
export function nextIncrement({ basic, mode = 'amount', value, effectiveDate }) {
  const b = num(basic);
  const newBasic = mode === 'percent' ? r2(b + b * num(value) / 100) : r2(b + num(value));
  return { newBasic, increase: r2(newBasic - b), nextIncrementDate: effectiveDate ? addYears(effectiveDate, 1) : null };
}

/* ─────────────── the payslip ─────────────── */
/**
 * @param {object} i
 *  period      {start,end}
 *  settings    {daysBasis:'calendar'|'30'|'26', deductAbsent:true, retirementLimitAnnual, insuranceLimitAnnual}
 *  salary      {basic, gradeAmount, maritalStatus:'single'|'couple', ssfEnrolled, pfEnrolled, citMonthly, insuranceMonthly,
 *               items:[{itemId,name,type:'earning'|'deduction',calcMethod:'fixed'|'percent_of_basic'|'months_of_basic',value,
 *                       taxable,prorate,oneOff}]}
 *               oneOff = true for yearly bonuses and case-basis allowances: taxed as a single addition to the year,
 *               not multiplied by 12.  prorate = false pays the full amount regardless of absence.
 *  attendance  {absentDays, unpaidLeaveDays}  (already adjusted by the payroll officer if needed)
 *  extras      [{name,type,amount,taxable}]   one-off lines for this run (bonus, arrears, penalty…)
 *  funds       {ssf:{employeePct,employerPct,base}, pf:{employeePct,employerPct,base}}   base: 'basic'|'basic_grade'|'gross'
 *  tax         {slabs:{single:[...],couple:[...]}}
 *  advances    [{advanceId,balance,installment}]   what is due to be recovered this month
 */
export function computeSlip(i) {
  const { period, settings = {}, salary, attendance = {}, extras = [], funds = {}, tax = {}, advances = [] } = i;
  const cal = daysBetween(period.start, period.end);
  const base = settings.daysBasis === '30' ? 30 : settings.daysBasis === '26' ? 26 : cal;
  const absent = num(attendance.absentDays), unpaid = num(attendance.unpaidLeaveDays);
  const lost = settings.deductAbsent === false ? unpaid : absent + unpaid;
  const payableDays = Math.max(0, Math.min(base, base - lost));
  const factor = base > 0 ? payableDays / base : 0;
  const lines = [];                                   // {kind:'earning'|'deduction'|'employer', code, name, amount, taxable?, note?}
  const add = (kind, code, name, amount, extra = {}) => { amount = r2(amount); if (amount !== 0 || extra.keepZero) lines.push({ kind, code, name, amount, ...extra }); return amount; };

  /* earnings (monthly items prorated by payable days) */
  const basicPaid = r2(num(salary.basic) * factor);
  const gradePaid = r2(num(salary.gradeAmount) * factor);
  add('earning', 'BASIC', 'Basic Salary', basicPaid, { taxable: true, keepZero: true });
  add('earning', 'GRADE', 'Grade Allowance', gradePaid, { taxable: true });
  let recurTaxable = 0, oneOffTaxable = 0, nonTaxable = 0, itemDeductions = 0;
  const earn = (code, name, amt, it) => {
    const a = add('earning', code, name, amt, { taxable: it.taxable !== false, itemId: it.itemId });
    if (it.taxable === false) nonTaxable += a; else if (it.oneOff) oneOffTaxable += a; else recurTaxable += a;
  };
  for (const it of salary.items || []) {
    const raw = it.calcMethod === 'percent_of_basic' ? num(salary.basic) * num(it.value) / 100
              : it.calcMethod === 'months_of_basic'  ? num(salary.basic) * num(it.value)
              : num(it.value);
    const amt = r2(raw * (it.prorate === false ? 1 : factor));
    if (it.type === 'deduction') itemDeductions += add('deduction', 'ITEM', it.name, amt, { itemId: it.itemId });
    else earn('ITEM', it.name, amt, it);
  }
  for (const x of extras) {
    const amt = r2(x.amount);
    if (x.type === 'deduction') itemDeductions += add('deduction', 'EXTRA', x.name, amt, { itemId: x.itemId });
    else earn('EXTRA', x.name, amt, { taxable: x.taxable, oneOff: true, itemId: x.itemId });
  }
  const gross = r2(basicPaid + gradePaid + recurTaxable + oneOffTaxable + nonTaxable);

  /* funds */
  const baseOf = (b) => (b === 'gross' ? gross : b === 'basic_grade' ? basicPaid + gradePaid : basicPaid);
  let empSsf = 0, empPf = 0, erSsf = 0, erPf = 0;
  const ledger = [];                                  // contributions to post to the fund ledger when the run is locked
  if (salary.ssfEnrolled && funds.ssf) {
    const b = baseOf(funds.ssf.base);
    empSsf = add('deduction', 'SSF', `SSF (employee ${funds.ssf.employeePct}%)`, b * num(funds.ssf.employeePct) / 100);
    erSsf  = add('employer',  'SSF_ER', `SSF (employer ${funds.ssf.employerPct}%)`, b * num(funds.ssf.employerPct) / 100);
    ledger.push({ fund: 'SSF', employee: empSsf, employer: erSsf });
  } else if (salary.pfEnrolled && funds.pf) {         // SSF and PF are mutually exclusive for one employee
    const b = baseOf(funds.pf.base);
    empPf = add('deduction', 'PF', `Provident Fund (employee ${funds.pf.employeePct}%)`, b * num(funds.pf.employeePct) / 100);
    erPf  = add('employer',  'PF_ER', `Provident Fund (employer ${funds.pf.employerPct}%)`, b * num(funds.pf.employerPct) / 100);
    ledger.push({ fund: 'PF', employee: empPf, employer: erPf });
  }
  const cit = add('deduction', 'CIT', 'Citizen Investment Trust', num(salary.citMonthly));
  if (cit) ledger.push({ fund: 'CIT', employee: cit, employer: 0 });
  const ins = add('deduction', 'INS', 'Insurance premium', num(salary.insuranceMonthly));
  if (ins) ledger.push({ fund: 'INS', employee: ins, employer: 0 });

  /* income tax. Recurring pay is projected x12; one-off pay (yearly bonus, case allowances) is added once.
     Tax for the month = base monthly share + the extra tax caused by the one-off amounts, so a festival bonus
     is taxed in the month it is paid instead of being spread over the year. Retirement-fund and insurance
     deductions are capped by the (dynamic) limits. */
  const recurringAnnual = r2(basicPaid + gradePaid + recurTaxable) * 12;
  const sharePct = num(settings.retirementMaxSharePct);
  const share = sharePct > 0 ? sharePct / 100 : 1 / 3;
  const slabs = (tax.slabs?.[salary.maritalStatus === 'couple' ? 'couple' : 'single']) || tax.slabs?.single || tax.slabs?.all || [];
  const taxFor = (annualIncome) => {
    const retLimit = Math.min(annualIncome * share, num(settings.retirementLimitAnnual) || Infinity);
    const retirement = Math.min((empSsf + empPf + cit) * 12, retLimit);
    const insurance = Math.min(ins * 12, num(settings.insuranceLimitAnnual) || Infinity);
    const taxable = Math.max(0, annualIncome - retirement - insurance);
    return { annualIncome, retirement, insurance, taxable, ...computeAnnualTax(taxable, slabs, { waiveSst: !!salary.ssfEnrolled }) };
  };
  const tBase = taxFor(recurringAnnual);
  const tWith = taxFor(recurringAnnual + oneOffTaxable);
  const monthlyTax = add('deduction', 'TAX', 'Income tax (TDS)', tBase.tax / 12 + (tWith.tax - tBase.tax));
  const at = tWith;

  /* advances: recover this month's installment, never taking the net below zero */
  const totalDeductionsBeforeAdv = r2(itemDeductions + empSsf + empPf + cit + ins + monthlyTax);
  let room = Math.max(0, r2(gross - totalDeductionsBeforeAdv));
  const recoveries = [];
  for (const a of advances) {
    const due = Math.min(num(a.installment), num(a.balance));
    const take = r2(Math.min(due, room));
    if (take > 0) { add('deduction', 'ADV', `Advance recovery #${a.advanceId}`, take, { ref: a.advanceId }); recoveries.push({ advanceId: a.advanceId, amount: take, shortfall: r2(due - take) }); room = r2(room - take); }
    else if (due > 0) recoveries.push({ advanceId: a.advanceId, amount: 0, shortfall: r2(due) });
  }
  const advTotal = r2(recoveries.reduce((s, x) => s + x.amount, 0));

  const totalDeductions = r2(totalDeductionsBeforeAdv + advTotal);
  const net = r2(gross - totalDeductions);
  const employerCost = r2(erSsf + erPf);
  return {
    days: { calendar: cal, base, absent, unpaidLeave: unpaid, payable: payableDays },
    lines, gross, totalDeductions, net, employerCost,
    tax: { annualIncome: r2(at.annualIncome), retirementDeduction: r2(at.retirement), insuranceDeduction: r2(at.insurance), annualTaxable: r2(at.taxable), annualTax: at.tax, oneOffTaxable: r2(oneOffTaxable), monthly: monthlyTax, parts: at.parts },
    ledger, recoveries,
  };
}

/* ─────────────── government pay scale ─────────────── */
/** Salary of a grade: starting salary stays the basic; grades earned x grade rate is the grade amount. */
export function gradeSalary({ startSalary, gradeRate, gradesEarned = 0, maxGrades = null }) {
  const g = Math.max(0, Math.floor(num(gradesEarned)));
  if (maxGrades != null && maxGrades !== '' && g > num(maxGrades)) return { ok: false, error: `This grade allows at most ${maxGrades} grade increments.` };
  return { ok: true, basic: r2(num(startSalary)), gradeAmount: r2(g * num(gradeRate)), gradesEarned: g, total: r2(num(startSalary) + g * num(gradeRate)) };
}
/** One more annual grade; refuses once the grade's maximum is reached. */
export function nextGrade({ startSalary, gradeRate, gradesEarned = 0, maxGrades = null, effectiveDate }) {
  const r = gradeSalary({ startSalary, gradeRate, gradesEarned: num(gradesEarned) + 1, maxGrades });
  if (!r.ok) return { ok: false, error: `Maximum grade reached (${maxGrades}) - no further grade increment is due.` };
  return { ...r, nextIncrementDate: effectiveDate ? addYears(effectiveDate, 1) : null };
}
