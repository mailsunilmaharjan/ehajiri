-- ============================================================
-- V001 — Initial Schema  (eHajiri TMS)
-- ============================================================

-- App metadata / versioning
CREATE TABLE IF NOT EXISTS app_info (
  id           SERIAL PRIMARY KEY,
  key          VARCHAR(100) UNIQUE NOT NULL,
  value        TEXT,
  updated_at   TIMESTAMP DEFAULT NOW()
);

INSERT INTO app_info (key, value) VALUES
  ('app_version',  '1.0.0'),
  ('db_version',   '1'),
  ('app_name',     'eHajiri TMS'),
  ('developed_by', 'Planet Infosys Pvt.Ltd'),
  ('website',      'www.planetinfosys.com.np'),
  ('phone',        '015269837'),
  ('copyright',    '2026')
ON CONFLICT (key) DO NOTHING;

-- Departments
CREATE TABLE IF NOT EXISTS departments (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(150) NOT NULL,
  code        VARCHAR(30)  UNIQUE NOT NULL,
  is_default  BOOLEAN      DEFAULT FALSE,
  is_system   BOOLEAN      DEFAULT FALSE,
  created_at  TIMESTAMP    DEFAULT NOW()
);

-- Branches
CREATE TABLE IF NOT EXISTS branches (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(150) NOT NULL,
  code        VARCHAR(30)  UNIQUE NOT NULL,
  address     TEXT,
  is_default  BOOLEAN      DEFAULT FALSE,
  is_system   BOOLEAN      DEFAULT FALSE,
  created_at  TIMESTAMP    DEFAULT NOW()
);

-- Fiscal Years
CREATE TABLE IF NOT EXISTS fiscal_years (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  start_date  DATE         NOT NULL,
  end_date    DATE         NOT NULL,
  is_default  BOOLEAN      DEFAULT FALSE,
  is_system   BOOLEAN      DEFAULT FALSE,
  created_at  TIMESTAMP    DEFAULT NOW()
);

-- Designations
CREATE TABLE IF NOT EXISTS designations (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(150) NOT NULL,
  code        VARCHAR(30)  UNIQUE NOT NULL,
  is_default  BOOLEAN      DEFAULT FALSE,
  is_system   BOOLEAN      DEFAULT FALSE,
  created_at  TIMESTAMP    DEFAULT NOW()
);

-- Shifts
CREATE TABLE IF NOT EXISTS shifts (
  id                       SERIAL  PRIMARY KEY,
  name                     VARCHAR(150) NOT NULL,
  name_en                  VARCHAR(150),
  code                     VARCHAR(50)  UNIQUE NOT NULL,
  start_time               TIME         NOT NULL,
  end_time                 TIME         NOT NULL,
  work_hours               NUMERIC(4,2) DEFAULT 8,
  grace_period_start       INTEGER      DEFAULT 5,
  grace_period_end         INTEGER      DEFAULT 5,
  make_default             BOOLEAN      DEFAULT FALSE,
  color                    VARCHAR(20)  DEFAULT '#1a56db',
  active                   BOOLEAN      DEFAULT TRUE,
  exceptional_day_enabled  BOOLEAN      DEFAULT FALSE,
  exceptional_days         JSONB        DEFAULT '[]',
  exceptional_start_time   TIME,
  exceptional_end_time     TIME,
  exceptional_work_hours   NUMERIC(4,2),
  winter_policy_enabled    BOOLEAN      DEFAULT FALSE,
  winter_policy            JSONB,
  created_at               TIMESTAMP    DEFAULT NOW()
);

-- Employees
CREATE TABLE IF NOT EXISTS employees (
  id           SERIAL  PRIMARY KEY,
  employee_id  VARCHAR(30)  UNIQUE NOT NULL,
  full_name    VARCHAR(200) NOT NULL,
  role         VARCHAR(30)  NOT NULL DEFAULT 'employee' CHECK (role IN ('admin','manager','employee')),
  department   VARCHAR(100),
  position     VARCHAR(150),
  shift        VARCHAR(50)  REFERENCES shifts(code) ON UPDATE CASCADE ON DELETE SET NULL,
  email        VARCHAR(200) UNIQUE,
  phone        VARCHAR(30),
  join_date    DATE,
  gender       VARCHAR(20),
  avatar       VARCHAR(5),
  active       BOOLEAN      DEFAULT TRUE,
  password_hash VARCHAR(255),
  created_at   TIMESTAMP    DEFAULT NOW()
);

-- Leave Types
CREATE TABLE IF NOT EXISTS leave_types (
  id         SERIAL  PRIMARY KEY,
  name       VARCHAR(150) NOT NULL,
  code       VARCHAR(10)  UNIQUE NOT NULL,
  total_days INTEGER      NOT NULL DEFAULT 0,
  color      VARCHAR(20)  DEFAULT '#6b7280',
  name_en    VARCHAR(150),
  is_system  BOOLEAN      DEFAULT FALSE,
  created_at TIMESTAMP    DEFAULT NOW()
);

-- Leave Balances (per employee per leave type)
CREATE TABLE IF NOT EXISTS leave_balances (
  id              SERIAL  PRIMARY KEY,
  employee_id     INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_code VARCHAR(10) NOT NULL REFERENCES leave_types(code) ON UPDATE CASCADE ON DELETE CASCADE,
  balance_days    NUMERIC(6,1) DEFAULT 0,
  UNIQUE (employee_id, leave_type_code)
);

-- Leaves
CREATE TABLE IF NOT EXISTS leaves (
  id               SERIAL  PRIMARY KEY,
  employee_id      INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_code  VARCHAR(10) REFERENCES leave_types(code) ON UPDATE CASCADE,
  from_date        DATE    NOT NULL,
  to_date          DATE    NOT NULL,
  days             NUMERIC(5,1) NOT NULL,
  reason           TEXT,
  status           VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  applied_date     DATE    DEFAULT CURRENT_DATE,
  approved_by      INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  approved_date    DATE,
  comment          TEXT,
  created_at       TIMESTAMP DEFAULT NOW()
);

-- Office Visits
CREATE TABLE IF NOT EXISTS office_visits (
  id            SERIAL  PRIMARY KEY,
  employee_id   INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  purpose       VARCHAR(255),
  location      VARCHAR(255),
  from_date     DATE    NOT NULL,
  from_time     TIME,
  to_date       DATE    NOT NULL,
  to_time       TIME,
  description   TEXT,
  status        VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  applied_date  DATE    DEFAULT CURRENT_DATE,
  approved_by   INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  approved_date DATE,
  comment       TEXT,
  created_at    TIMESTAMP DEFAULT NOW()
);

-- App Settings (single-row JSON blob per key)
CREATE TABLE IF NOT EXISTS app_settings (
  id         SERIAL  PRIMARY KEY,
  key        VARCHAR(100) UNIQUE NOT NULL,
  value      JSONB,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_leaves_employee    ON leaves(employee_id);
CREATE INDEX IF NOT EXISTS idx_leaves_status      ON leaves(status);
CREATE INDEX IF NOT EXISTS idx_visits_employee    ON office_visits(employee_id);
CREATE INDEX IF NOT EXISTS idx_visits_status      ON office_visits(status);
CREATE INDEX IF NOT EXISTS idx_employees_active   ON employees(active);
