import { gradeSalary, nextGrade, computeSlip, computeAnnualTax, advanceSchedule, checkAdvance, nextIncrement, addYears, r2 } from './payrollEngine.js';
let pass = 0, fail = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`)); };

// TEST-ONLY slabs (illustrative; real slabs are entered by the accountant)
const single = [{ from: 0, to: 500000, rate: 1, isSst: true }, { from: 500000, to: 700000, rate: 10 }, { from: 700000, to: 1000000, rate: 20 }, { from: 1000000, to: 2000000, rate: 30 }, { from: 2000000, to: null, rate: 36 }];
const funds = { ssf: { employeePct: 11, employerPct: 20, base: 'basic_grade' }, pf: { employeePct: 10, employerPct: 10, base: 'basic' } };
const base = { period: { start: '2026-09-17', end: '2026-10-16' }, settings: { daysBasis: 'calendar', deductAbsent: true, retirementLimitAnnual: 500000, insuranceLimitAnnual: 40000 },
  funds, tax: { slabs: { single, couple: single } }, attendance: { absentDays: 0, unpaidLeaveDays: 0 } };
const L = (s, code) => s.lines.find(l => l.code === code)?.amount;

// tax slabs
eq('tax: 587,400 with SST waived', computeAnnualTax(587400, single, { waiveSst: true }).tax, 8740);
eq('tax: 587,400 normal (1% on first 500k)', computeAnnualTax(587400, single).tax, 13740);
eq('tax: 1,200,000', computeAnnualTax(1200000, single).tax, 5000 + 20000 + 60000 + 60000);

// slip 1: SSF employee, full month (30-day period)
let s = computeSlip({ ...base, salary: { basic: 50000, gradeAmount: 5000, maritalStatus: 'single', ssfEnrolled: true, items: [] } });
eq('slip1 days', [s.days.base, s.days.payable], [30, 30]);
eq('slip1 SSF employee 11% of basic+grade', L(s, 'SSF'), 6050);
eq('slip1 SSF employer 20%', L(s, 'SSF_ER'), 11000);
eq('slip1 tax (SST waived) monthly', L(s, 'TAX'), r2(8740 / 12));
eq('slip1 net', s.net, r2(55000 - 6050 - 8740 / 12));
eq('slip1 employer cost', s.employerCost, 11000);
eq('slip1 ledger', s.ledger, [{ fund: 'SSF', employee: 6050, employer: 11000 }]);

// slip 2: 3 days absent -> 27/30
s = computeSlip({ ...base, attendance: { absentDays: 3, unpaidLeaveDays: 0 }, salary: { basic: 50000, gradeAmount: 5000, maritalStatus: 'single', ssfEnrolled: true, items: [] } });
eq('slip2 payable 27', s.days.payable, 27);
eq('slip2 basic prorated', L(s, 'BASIC'), 45000);
eq('slip2 grade prorated', L(s, 'GRADE'), 4500);

// slip 3: unpaid leave counts, absent ignored when deductAbsent=false
s = computeSlip({ ...base, settings: { ...base.settings, deductAbsent: false }, attendance: { absentDays: 4, unpaidLeaveDays: 2 }, salary: { basic: 30000, maritalStatus: 'single', items: [] } });
eq('slip3 only unpaid leave deducted', s.days.payable, 28);

// slip 4: PF employee (not SSF), percent-of-basic allowance, non-taxable allowance, CIT, insurance
s = computeSlip({ ...base, salary: { basic: 40000, gradeAmount: 0, maritalStatus: 'single', pfEnrolled: true, citMonthly: 2000, insuranceMonthly: 1000,
  items: [{ name: 'Dearness', type: 'earning', calcMethod: 'percent_of_basic', value: 10, taxable: true }, { name: 'Transport', type: 'earning', calcMethod: 'fixed', value: 3000, taxable: false }] } });
eq('slip4 PF 10% of basic', L(s, 'PF'), 4000);
eq('slip4 dearness 10%', s.lines.find(l => l.name === 'Dearness').amount, 4000);
eq('slip4 gross', s.gross, 40000 + 4000 + 3000);
eq('slip4 ledger funds', s.ledger.map(x => x.fund), ['PF', 'CIT', 'INS']);
eq('slip4 insurance deduction capped at 12,000/yr (1,000x12)', s.tax.insuranceDeduction, 12000);
eq('slip4 taxable annual', s.tax.annualTaxable, r2((44000 * 12) - Math.min((4000 + 2000) * 12, 44000 * 12 / 3, 500000) - 12000));

// slip 5: SSF and PF both flagged -> only SSF
s = computeSlip({ ...base, salary: { basic: 20000, maritalStatus: 'single', ssfEnrolled: true, pfEnrolled: true, items: [] } });
eq('slip5 PF skipped when SSF', [L(s, 'SSF') > 0, L(s, 'PF')], [true, undefined]);

// advances
s = computeSlip({ ...base, salary: { basic: 30000, maritalStatus: 'single', items: [] }, advances: [{ advanceId: 7, balance: 20000, installment: 5000 }] });
eq('adv recovered', [L(s, 'ADV'), s.recoveries], [5000, [{ advanceId: 7, amount: 5000, shortfall: 0 }]]);
s = computeSlip({ ...base, salary: { basic: 30000, maritalStatus: 'single', items: [] }, advances: [{ advanceId: 7, balance: 2000, installment: 5000 }] });
eq('adv limited to remaining balance', L(s, 'ADV'), 2000);
s = computeSlip({ ...base, attendance: { absentDays: 30, unpaidLeaveDays: 0 }, salary: { basic: 30000, maritalStatus: 'single', items: [] }, advances: [{ advanceId: 7, balance: 20000, installment: 5000 }] });
eq('adv shortfall when no pay, net never negative', [s.net, s.recoveries[0].amount, s.recoveries[0].shortfall], [0, 0, 5000]);
const sch = advanceSchedule({ amount: 10000, installments: 3, interestPct: 6, startPeriod: '2026-11-01' });
eq('schedule totals', [sch.total, sch.installmentAmount, sch.rows.map(r => r.amount)], [10600, 3533.33, [3533.33, 3533.33, 3533.34]]);
eq('schedule periods', sch.rows.map(r => r.period), ['2026-11-01', '2026-12-01', '2027-01-01']);
const pol = { max_amount: 100000, max_basic_multiple: 3, max_installments: 12, min_service_months: 6, allow_multiple: false };
eq('policy ok', checkAdvance({ policy: pol, basic: 30000, serviceMonths: 12, requested: 60000, installments: 6 }).ok, true);
eq('policy cap = min(100000, 3x30000)', checkAdvance({ policy: pol, basic: 30000, serviceMonths: 12, requested: 1, installments: 1 }).maxAmount, 90000);
eq('policy rejects over-cap/too many installments/short service/outstanding', checkAdvance({ policy: pol, basic: 30000, serviceMonths: 3, requested: 95000, installments: 24, outstandingCount: 1 }).errors.length, 4);

// increment
eq('increment 5%', nextIncrement({ basic: 50000, mode: 'percent', value: 5, effectiveDate: '2026-07-16' }), { newBasic: 52500, increase: 2500, nextIncrementDate: '2027-07-16' });
eq('increment amount', nextIncrement({ basic: 50000, mode: 'amount', value: 1500, effectiveDate: '2026-07-16' }).newBasic, 51500);
eq('leap-day +1y', addYears('2024-02-29', 1), '2025-02-28');
// ── yearly festival bonus (1 month of basic, not prorated, taxed in the month it is paid) ──
s = computeSlip({ ...base, attendance: { absentDays: 3, unpaidLeaveDays: 0 },
  salary: { basic: 50000, maritalStatus: 'single', items: [{ itemId: 9, name: 'Dashain Bonus', type: 'earning', calcMethod: 'months_of_basic', value: 1, taxable: true, prorate: false, oneOff: true }] } });
eq('bonus: full 1 month of basic even with 3 absent days', s.lines.find(l => l.name === 'Dashain Bonus').amount, 50000);
eq('bonus: basic still prorated 27/30', L(s, 'BASIC'), 45000);
eq('bonus: tax = base 9000/12 + extra 5000', L(s, 'TAX'), 5750);
eq('bonus: line carries itemId for the once-a-year guard', s.lines.find(l => l.name === 'Dashain Bonus').itemId, 9);
const noBonus = computeSlip({ ...base, attendance: { absentDays: 3, unpaidLeaveDays: 0 }, salary: { basic: 50000, maritalStatus: 'single', items: [] } });
eq('no bonus month: tax = 9000/12', L(noBonus, 'TAX'), 750);

// ── case-basis allowance (maternity) added as an extra: full amount, taxed once, not x12 ──
s = computeSlip({ ...base, salary: { basic: 30000, maritalStatus: 'single', items: [] }, extras: [{ name: 'Maternity allowance', type: 'earning', amount: 8000, taxable: false }] });
eq('case: non-taxable allowance adds to gross only', [s.gross, L(s, 'TAX')], [38000, 3600 / 12]);
s = computeSlip({ ...base, salary: { basic: 30000, maritalStatus: 'single', items: [] }, extras: [{ name: 'Maternity allowance', type: 'earning', amount: 8000, taxable: true }] });
eq('case: taxable allowance taxed once (368k @1% = 3680 vs 3600 base)', L(s, 'TAX'), r2(3600 / 12 + (3680 - 3600)));

// ── dynamic limits: retirement share + annual limit come from settings ──
s = computeSlip({ ...base, settings: { ...base.settings, retirementMaxSharePct: 10 }, salary: { basic: 100000, maritalStatus: 'single', pfEnrolled: true, items: [] } });
eq('limit: retirement deduction capped at 10% of annual income', s.tax.retirementDeduction, 120000);
s = computeSlip({ ...base, settings: { ...base.settings, retirementLimitAnnual: 50000 }, salary: { basic: 100000, maritalStatus: 'single', pfEnrolled: true, items: [] } });
eq('limit: retirement deduction capped at the annual limit', s.tax.retirementDeduction, 50000);

// ── government pay scale: starting salary + grades x grade rate ──
eq('grade salary: SO 48,056 + 4 x 1,602', gradeSalary({ startSalary: 48056, gradeRate: 1602, gradesEarned: 4 }), { ok: true, basic: 48056, gradeAmount: 6408, gradesEarned: 4, total: 54464 });
eq('grade salary: zero grades = starting salary only', gradeSalary({ startSalary: 48056, gradeRate: 1602 }).total, 48056);
eq('grade salary: over the maximum is refused', gradeSalary({ startSalary: 48056, gradeRate: 1602, gradesEarned: 11, maxGrades: 10 }).ok, false);
const ng = nextGrade({ startSalary: 48056, gradeRate: 1602, gradesEarned: 4, maxGrades: 10, effectiveDate: '2026-07-17' });
eq('next grade: +1 and next date a year on', [ng.gradesEarned, ng.gradeAmount, ng.nextIncrementDate], [5, 8010, '2027-07-17']);
eq('next grade: refused at the maximum', nextGrade({ startSalary: 48056, gradeRate: 1602, gradesEarned: 10, maxGrades: 10 }).ok, false);
const gs = computeSlip({ ...base, salary: { basic: 48056, gradeAmount: 6408, maritalStatus: 'single', pfEnrolled: true, items: [
  { itemId: 1, name: 'Incentive allowance 10%', type: 'earning', calcMethod: 'percent_of_basic', value: 10, taxable: true, prorate: true, oneOff: false },
  { itemId: 2, name: 'Dearness allowance', type: 'earning', calcMethod: 'fixed', value: 5000, taxable: true, prorate: true, oneOff: false }] } });
eq('govt employee: gross = basic + grade + 10% incentive + 5,000 DA', gs.gross, r2(48056 + 6408 + 4805.6 + 5000));
eq('govt employee: PF 10% of basic', L(gs, 'PF'), 4805.6);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
