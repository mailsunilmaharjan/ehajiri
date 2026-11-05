// Payroll module schema (migration v157). Everything here is additive.
//
// Design rules:
//  * Nothing Nepal-specific is hard-coded in code: statutory rates, deduction limits, pay-day
//    policy (payroll_rates) and income-tax slabs (payroll_tax_slabs) are data, effective-dated,
//    so a budget change means "add a new row from <date>", never a code change. History is kept.
//  * Pay items (payroll_items) carry a payment_mode: monthly | yearly | need_basis.
//      monthly    -> every run, for employees the item is assigned to
//      yearly     -> paid once per fiscal year, in the run where the officer ticks it (Festival Bonus)
//      need_basis -> "case" allowances (e.g. Maternity) via payroll_cases with a date range
//  * Payslips are stored (not recomputed) once a run is locked.
export const PAYROLL_SCHEMA_SQL = `
  -- pay items: bonus vs allowance, who is eligible, whether to prorate for absence
  ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS category       VARCHAR(20) NOT NULL DEFAULT 'allowance';   -- allowance | bonus
  ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS applies_gender VARCHAR(10) NOT NULL DEFAULT 'all';         -- all | female | male
  ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS prorate        BOOLEAN     NOT NULL DEFAULT TRUE;

  -- tax slabs: separate sets for single / couple, and mark the social-security (1%) slab
  ALTER TABLE payroll_tax_slabs ADD COLUMN IF NOT EXISTS applies_to VARCHAR(10) NOT NULL DEFAULT 'all';        -- all | single | couple
  ALTER TABLE payroll_tax_slabs ADD COLUMN IF NOT EXISTS is_sst     BOOLEAN     NOT NULL DEFAULT FALSE;

  -- effective-dated rates / limits / policy.  code: SSF | PF | LIMITS | POLICY
  CREATE TABLE IF NOT EXISTS payroll_rates (
    id             SERIAL PRIMARY KEY,
    code           VARCHAR(20) NOT NULL,
    effective_from DATE        NOT NULL,
    params         JSONB       NOT NULL DEFAULT '{}',
    note           TEXT,
    created_by     INTEGER,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (code, effective_from)
  );

  -- salary history: one row per revision (initial, increment, revision); the latest row <= period end applies
  CREATE TABLE IF NOT EXISTS employee_salary (
    id                  SERIAL PRIMARY KEY,
    user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    effective_from      DATE    NOT NULL,
    basic               NUMERIC(14,2) NOT NULL DEFAULT 0,
    grade_amount        NUMERIC(14,2) NOT NULL DEFAULT 0,
    marital_status      VARCHAR(10)   NOT NULL DEFAULT 'single',
    ssf_enrolled        BOOLEAN       NOT NULL DEFAULT FALSE,
    pf_enrolled         BOOLEAN       NOT NULL DEFAULT FALSE,
    cit_monthly         NUMERIC(14,2) NOT NULL DEFAULT 0,
    insurance_monthly   NUMERIC(14,2) NOT NULL DEFAULT 0,
    pan_no TEXT, ssf_no TEXT, pf_no TEXT, cit_no TEXT, bank_name TEXT, bank_account TEXT,
    next_increment_date DATE,
    change_type         VARCHAR(20)   NOT NULL DEFAULT 'revision',
    change_note         TEXT,
    created_by          INTEGER,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, effective_from)
  );
  CREATE INDEX IF NOT EXISTS idx_employee_salary_user ON employee_salary (user_id, effective_from DESC);

  -- monthly allowances / deductions assigned to an employee's salary revision (amount NULL = use the item's own value)
  CREATE TABLE IF NOT EXISTS employee_salary_items (
    id        SERIAL PRIMARY KEY,
    salary_id INTEGER NOT NULL REFERENCES employee_salary(id) ON DELETE CASCADE,
    item_id   INTEGER NOT NULL REFERENCES payroll_items(id)   ON DELETE CASCADE,
    amount    NUMERIC(14,2),
    UNIQUE (salary_id, item_id)
  );

  -- case-basis allowances (e.g. Maternity): paid in every run whose period overlaps from..to
  CREATE TABLE IF NOT EXISTS payroll_cases (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
    item_id    INTEGER NOT NULL REFERENCES payroll_items(id) ON DELETE RESTRICT,
    from_date  DATE    NOT NULL,
    to_date    DATE    NOT NULL,
    amount     NUMERIC(14,2),
    reason     TEXT,
    status     VARCHAR(12) NOT NULL DEFAULT 'active',      -- active | cancelled
    created_by INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_payroll_cases_user ON payroll_cases (user_id, status);

  -- advance policy + advances + recoveries
  CREATE TABLE IF NOT EXISTS advance_policies (
    id                 SERIAL PRIMARY KEY,
    name               TEXT NOT NULL,
    max_amount         NUMERIC(14,2),
    max_basic_multiple NUMERIC(6,2),
    max_installments   INTEGER,
    interest_pct       NUMERIC(6,2) NOT NULL DEFAULT 0,
    min_service_months INTEGER      NOT NULL DEFAULT 0,
    allow_multiple     BOOLEAN      NOT NULL DEFAULT FALSE,
    max_outstanding    NUMERIC(14,2),
    active             BOOLEAN      NOT NULL DEFAULT TRUE,
    ranking_order      INTEGER,
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS employee_advances (
    id                 SERIAL PRIMARY KEY,
    user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    policy_id          INTEGER REFERENCES advance_policies(id) ON DELETE SET NULL,
    amount             NUMERIC(14,2) NOT NULL,
    interest_pct       NUMERIC(6,2)  NOT NULL DEFAULT 0,
    installments       INTEGER       NOT NULL DEFAULT 1,
    installment_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_payable      NUMERIC(14,2) NOT NULL DEFAULT 0,
    balance            NUMERIC(14,2) NOT NULL DEFAULT 0,
    start_date         DATE          NOT NULL,                -- first month the installment is recovered from
    reason             TEXT,
    status             VARCHAR(12)   NOT NULL DEFAULT 'pending',   -- pending | running | rejected | closed | cancelled
    requested_by       INTEGER,
    approved_by        INTEGER,
    approved_at        TIMESTAMPTZ,
    created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_employee_advances_user ON employee_advances (user_id, status);

  -- runs and payslips
  CREATE TABLE IF NOT EXISTS payroll_runs (
    id               SERIAL PRIMARY KEY,
    label            TEXT NOT NULL,
    period_start     DATE NOT NULL,
    period_end       DATE NOT NULL,
    status           VARCHAR(10) NOT NULL DEFAULT 'draft',    -- draft | approved | locked
    include_item_ids INTEGER[]   NOT NULL DEFAULT '{}',        -- yearly items to pay in this run
    notes            TEXT,
    created_by       INTEGER,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    approved_by      INTEGER,
    approved_at      TIMESTAMPTZ,
    locked_at        TIMESTAMPTZ
  );
  CREATE TABLE IF NOT EXISTS payslips (
    id                SERIAL PRIMARY KEY,
    run_id            INTEGER NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
    user_id           INTEGER NOT NULL REFERENCES users(id),
    salary_id         INTEGER,
    absent_days       NUMERIC(6,2) NOT NULL DEFAULT 0,
    unpaid_leave_days NUMERIC(6,2) NOT NULL DEFAULT 0,
    payable_days      NUMERIC(6,2),
    base_days         INTEGER,
    gross             NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_deductions  NUMERIC(14,2) NOT NULL DEFAULT 0,
    net               NUMERIC(14,2) NOT NULL DEFAULT 0,
    employer_cost     NUMERIC(14,2) NOT NULL DEFAULT 0,
    tax               NUMERIC(14,2) NOT NULL DEFAULT 0,
    adjustments       JSONB NOT NULL DEFAULT '{}',   -- officer overrides: absentDays, unpaidLeaveDays, extras[]
    detail            JSONB NOT NULL DEFAULT '{}',   -- tax working, recoveries, ledger postings
    warnings          TEXT[] NOT NULL DEFAULT '{}',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (run_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS payslip_lines (
    id         SERIAL PRIMARY KEY,
    payslip_id INTEGER NOT NULL REFERENCES payslips(id) ON DELETE CASCADE,
    kind       VARCHAR(10) NOT NULL,                 -- earning | deduction | employer
    code       VARCHAR(20),
    name       TEXT NOT NULL,
    amount     NUMERIC(14,2) NOT NULL DEFAULT 0,
    item_id    INTEGER,
    ref        INTEGER,
    sort       INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_payslip_lines_slip ON payslip_lines (payslip_id);
  CREATE INDEX IF NOT EXISTS idx_payslip_lines_item ON payslip_lines (item_id) WHERE item_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS advance_recoveries (
    id         SERIAL PRIMARY KEY,
    advance_id INTEGER NOT NULL REFERENCES employee_advances(id) ON DELETE CASCADE,
    run_id     INTEGER,
    payslip_id INTEGER,
    amount     NUMERIC(14,2) NOT NULL,
    period_end DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  -- SSF / PF / CIT / insurance ledger: posted when a run is locked, plus manual opening balances / adjustments
  CREATE TABLE IF NOT EXISTS fund_ledger (
    id           SERIAL PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    fund_code    VARCHAR(10) NOT NULL,                -- SSF | PF | CIT | INS
    period_end   DATE NOT NULL,
    run_id       INTEGER,
    employee_amt NUMERIC(14,2) NOT NULL DEFAULT 0,
    employer_amt NUMERIC(14,2) NOT NULL DEFAULT 0,
    entry_type   VARCHAR(14) NOT NULL DEFAULT 'contribution',   -- contribution | opening | adjustment | withdrawal
    note         TEXT,
    created_by   INTEGER,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_fund_ledger_user ON fund_ledger (user_id, fund_code, period_end);

  -- Starting values so the screens aren't empty. All editable; add a newer row to change a rate.
  INSERT INTO payroll_rates (code, effective_from, params, note) VALUES
    ('SSF',    '2000-01-01', '{"employeePct":11,"employerPct":20,"base":"basic_grade"}', 'Initial default - verify with your accountant'),
    ('PF',     '2000-01-01', '{"employeePct":10,"employerPct":10,"base":"basic"}',       'Initial default - verify with your accountant'),
    ('LIMITS', '2000-01-01', '{"retirementMaxSharePct":33.33,"retirementLimitAnnual":500000,"insuranceLimitAnnual":40000}', 'Initial default - verify with your accountant'),
    ('POLICY', '2000-01-01', '{"daysBasis":"calendar","deductAbsent":true,"unpaidLeaveCodes":[]}', 'Pay-day policy')
  ON CONFLICT (code, effective_from) DO NOTHING;
`;

// v158: government-style pay scales (grade = starting salary + grades earned x grade rate) and the FY 2083/84 slab starter set.
export const PAYROLL_SCALE_SQL = `
  CREATE TABLE IF NOT EXISTS pay_scales (
    id             SERIAL PRIMARY KEY,
    name           TEXT NOT NULL,
    effective_from DATE NOT NULL,
    note           TEXT,
    created_by     INTEGER,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS pay_grades (
    id           SERIAL PRIMARY KEY,
    scale_id     INTEGER NOT NULL REFERENCES pay_scales(id) ON DELETE CASCADE,
    code         VARCHAR(40) NOT NULL,                 -- stable key, carried across scale revisions (e.g. SO, DS, JS)
    label        TEXT NOT NULL,
    start_salary NUMERIC(14,2) NOT NULL DEFAULT 0,
    grade_rate   NUMERIC(14,2) NOT NULL DEFAULT 0,
    max_grades   INTEGER,                              -- NULL = no limit
    rank         INTEGER NOT NULL DEFAULT 0,
    UNIQUE (scale_id, code)
  );
  ALTER TABLE employee_salary ADD COLUMN IF NOT EXISTS scale_id      INTEGER REFERENCES pay_scales(id) ON DELETE SET NULL;
  ALTER TABLE employee_salary ADD COLUMN IF NOT EXISTS grade_code    VARCHAR(40);
  ALTER TABLE employee_salary ADD COLUMN IF NOT EXISTS grades_earned INTEGER NOT NULL DEFAULT 0;
`;

/** Starter income-tax slabs for FY 2083/84 (from Shrawan 1, 2083 = 2026-07-17). Inserted ONLY when the tenant has no slabs at all,
 *  and labelled so nobody mistakes them for verified figures. Source: secondary guides agreeing on one merged scale;
 *  must be checked against the Finance Act 2083 / IRD notice. */
export async function seedFy2083Slabs(client) {
  const { rows: [{ n }] } = await client.query('SELECT COUNT(*)::int AS n FROM payroll_tax_slabs');
  if (n > 0) return;
  const label = 'FY 2083/84 (starter - VERIFY with Finance Act)';
  const slabs = [[0, 1000000, 1, true], [1000000, 1500000, 10, false], [1500000, 2500000, 20, false], [2500000, 4000000, 27, false], [4000000, null, 29, false]];
  let i = 0;
  for (const [from, to, rate, sst] of slabs) {
    await client.query(
      `INSERT INTO payroll_tax_slabs (yearly_income_slab, effective_date, income_from, income_to, rate_percent, applies_to, is_sst, ranking_order)
       VALUES ($1, '2026-07-17', $2, $3, $4, 'all', $5, $6)`, [label, from, to, rate, sst, ++i]);
  }
}
