-- ============================================================
-- V002 — Seed / Default Data  (eHajiri TMS)
-- ============================================================

-- Departments
INSERT INTO departments (name, code, is_default, is_system) VALUES
  ('IT विभाग',      'IT',        FALSE, TRUE),
  ('HR विभाग',      'HR',        TRUE,  TRUE),
  ('Finance',       'FINANCE',   FALSE, TRUE),
  ('Marketing',     'MARKETING', FALSE, TRUE),
  ('Operations',    'OPS',       FALSE, TRUE)
ON CONFLICT (code) DO NOTHING;

-- Branches
INSERT INTO branches (name, code, address, is_default, is_system) VALUES
  ('Head Office', 'HO', 'Kathmandu, Nepal', TRUE, TRUE)
ON CONFLICT (code) DO NOTHING;

-- Fiscal Years
INSERT INTO fiscal_years (name, start_date, end_date, is_default) VALUES
  ('FY 2081/082', '2024-07-17', '2025-07-15', FALSE),
  ('FY 2082/083', '2025-07-16', '2026-07-15', TRUE)
ON CONFLICT DO NOTHING;

-- Designations
INSERT INTO designations (name, code, is_default, is_system) VALUES
  ('System Administrator', 'SYS_ADMIN', FALSE, TRUE),
  ('HR Manager',           'HR_MGR',    FALSE, TRUE),
  ('Accountant',           'ACCT',      FALSE, TRUE),
  ('Marketing Executive',  'MKT_EXEC',  FALSE, TRUE),
  ('Operations Officer',   'OPS_OFF',   FALSE, TRUE)
ON CONFLICT (code) DO NOTHING;

-- Shifts
INSERT INTO shifts (name, name_en, code, start_time, end_time, work_hours, grace_period_start, grace_period_end, make_default, color, active)
VALUES
  ('बिहान सिफ्ट', 'Morning Shift', 'morning', '06:00', '14:00', 8, 5, 5,  FALSE, '#e3a008', TRUE),
  ('दिउँसो सिफ्ट','Day Shift',     'day',     '10:00', '18:00', 8, 15, 15, TRUE,  '#1a56db', TRUE),
  ('बेलुकी सिफ्ट','Evening Shift', 'evening', '14:00', '22:00', 8, 5, 5,  FALSE, '#7e3af2', TRUE),
  ('राति सिफ्ट',  'Night Shift',  'night',   '22:00', '06:00', 8, 10,10, FALSE, '#111827', FALSE)
ON CONFLICT (code) DO NOTHING;

-- Leave Types
INSERT INTO leave_types (name, code, total_days, color, name_en, is_system) VALUES
  ('वार्षिक बिदा',   'AL', 20,  '#0e9f6e', 'Annual Leave',    TRUE),
  ('बिरामी बिदा',    'SL', 12,  '#3f83f8', 'Sick Leave',      TRUE),
  ('आकस्मिक बिदा',  'CL', 6,   '#ff5a1f', 'Casual Leave',    TRUE),
  ('मातृत्व बिदा',   'ML', 98,  '#e74694', 'Maternity Leave', TRUE),
  ('पितृत्व बिदा',   'PL', 15,  '#7e3af2', 'Paternity Leave', TRUE)
ON CONFLICT (code) DO NOTHING;

-- Employees (password_hash stores plain text for seed — should be hashed in production)
INSERT INTO employees (employee_id, full_name, role, department, position, shift, email, phone, join_date, gender, avatar, active)
VALUES
  ('EMP001', 'राम प्रसाद श्रेष्ठ', 'admin',    'IT',        'System Administrator', 'day',     'ram@company.com',   '9841234567', '2020-01-01', 'male',   'R', TRUE),
  ('EMP002', 'सीता देवी पाण्डे',  'manager',  'HR',        'HR Manager',           'day',     'sita@company.com',  '9841234568', '2019-06-15', 'female', 'S', TRUE),
  ('EMP003', 'हरि बहादुर थापा',   'employee', 'Finance',   'Accountant',           'morning', 'hari@company.com',  '9841234569', '2021-03-01', 'male',   'H', TRUE),
  ('EMP004', 'गीता कुमारी शाह',   'employee', 'Marketing', 'Marketing Executive',  'day',     'gita@company.com',  '9841234570', '2021-07-01', 'female', 'G', TRUE),
  ('EMP005', 'बिमल कुमार राई',    'employee', 'Operations','Operations Officer',   'evening', 'bimal@company.com', '9841234571', '2022-01-15', 'male',   'B', TRUE)
ON CONFLICT (employee_id) DO NOTHING;

-- Leave Balances
INSERT INTO leave_balances (employee_id, leave_type_code, balance_days)
SELECT e.id, lt.code,
  CASE
    WHEN e.employee_id = 'EMP001' AND lt.code = 'AL' THEN 20
    WHEN e.employee_id = 'EMP001' AND lt.code = 'SL' THEN 12
    WHEN e.employee_id = 'EMP001' AND lt.code = 'CL' THEN 6
    WHEN e.employee_id = 'EMP001' AND lt.code = 'PL' THEN 15
    WHEN e.employee_id = 'EMP002' AND lt.code = 'AL' THEN 18
    WHEN e.employee_id = 'EMP002' AND lt.code = 'SL' THEN 10
    WHEN e.employee_id = 'EMP002' AND lt.code = 'CL' THEN 5
    WHEN e.employee_id = 'EMP002' AND lt.code = 'ML' THEN 98
    WHEN e.employee_id = 'EMP003' AND lt.code = 'AL' THEN 17
    WHEN e.employee_id = 'EMP003' AND lt.code = 'SL' THEN 12
    WHEN e.employee_id = 'EMP003' AND lt.code = 'CL' THEN 4
    WHEN e.employee_id = 'EMP003' AND lt.code = 'PL' THEN 15
    WHEN e.employee_id = 'EMP004' AND lt.code = 'AL' THEN 19
    WHEN e.employee_id = 'EMP004' AND lt.code = 'SL' THEN 11
    WHEN e.employee_id = 'EMP004' AND lt.code = 'CL' THEN 6
    WHEN e.employee_id = 'EMP005' AND lt.code = 'AL' THEN 20
    WHEN e.employee_id = 'EMP005' AND lt.code = 'SL' THEN 12
    WHEN e.employee_id = 'EMP005' AND lt.code = 'CL' THEN 6
    WHEN e.employee_id = 'EMP005' AND lt.code = 'PL' THEN 15
    ELSE 0
  END
FROM employees e CROSS JOIN leave_types lt
ON CONFLICT (employee_id, leave_type_code) DO NOTHING;

-- App Settings defaults
INSERT INTO app_settings (key, value) VALUES
  ('general', '{"companyName":"My Company","companyNameNp":"मेरो कम्पनी","dateFormat":"BS","language":"np","defaultCalendar":"np","defaultDateFormat":"dd-MMM-yyyy","nepaliDigits":false}'),
  ('fiscal_years', '[]'),
  ('branches', '[]'),
  ('departments', '[]'),
  ('designations', '[]')
ON CONFLICT (key) DO NOTHING;
