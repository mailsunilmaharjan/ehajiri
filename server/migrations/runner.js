import bcrypt from 'bcryptjs';
import pool from '../db.js';
import { DB_VERSION } from '../version.js';

// ══════════════════════════════════════════════════════════
//  MIGRATION DEFINITIONS
//  Add a new { version, description, up } object per release.
//  Never edit an existing migration — only append new ones.
// ══════════════════════════════════════════════════════════
const MIGRATIONS = [
  {
    version    : 1,
    description: 'Initial schema',
    up: async (client) => {
      await client.query(`

        CREATE TABLE IF NOT EXISTS app_schema_version (
          id          SERIAL      PRIMARY KEY,
          version     INTEGER     NOT NULL,
          description TEXT,
          applied_at  TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS users (
          id          SERIAL      PRIMARY KEY,
          employee_id VARCHAR(20) UNIQUE NOT NULL,
          username    VARCHAR(50) UNIQUE NOT NULL,
          password    VARCHAR(255) NOT NULL,
          full_name   VARCHAR(100) NOT NULL,
          role        VARCHAR(20)  DEFAULT 'employee',
          department  VARCHAR(100),
          position    VARCHAR(100),
          shift       VARCHAR(50),
          email       VARCHAR(100),
          phone       VARCHAR(20),
          join_date   DATE,
          gender      VARCHAR(10),
          avatar      VARCHAR(5),
          active      BOOLEAN     DEFAULT TRUE,
          is_system   BOOLEAN     DEFAULT FALSE,
          created_at  TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS shifts (
          id                      SERIAL      PRIMARY KEY,
          name                    VARCHAR(100) NOT NULL,
          name_en                 VARCHAR(100),
          code                    VARCHAR(50)  UNIQUE NOT NULL,
          start_time              TIME        NOT NULL,
          end_time                TIME        NOT NULL,
          work_hours              DECIMAL(4,1),
          grace_period_start      INTEGER     DEFAULT 5,
          grace_period_end        INTEGER     DEFAULT 5,
          make_default            BOOLEAN     DEFAULT FALSE,
          active                  BOOLEAN     DEFAULT TRUE,
          color                   VARCHAR(20),
          exceptional_day_enabled BOOLEAN     DEFAULT FALSE,
          exceptional_days        JSONB       DEFAULT '[]',
          exceptional_start_time  TIME,
          exceptional_end_time    TIME,
          exceptional_work_hours  DECIMAL(4,1),
          winter_policy_enabled   BOOLEAN     DEFAULT FALSE,
          winter_policy           JSONB,
          created_at              TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS leave_types (
          id         SERIAL      PRIMARY KEY,
          name       VARCHAR(100) NOT NULL,
          code       VARCHAR(10)  UNIQUE NOT NULL,
          total_days INTEGER     DEFAULT 0,
          color      VARCHAR(20),
          name_en    VARCHAR(100),
          created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS leave_balances (
          id              SERIAL  PRIMARY KEY,
          employee_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
          leave_type_code VARCHAR(10),
          balance         DECIMAL(6,1) DEFAULT 0,
          UNIQUE(employee_id, leave_type_code)
        );

        CREATE TABLE IF NOT EXISTS leaves (
          id              SERIAL      PRIMARY KEY,
          employee_id     INTEGER     REFERENCES users(id) ON DELETE CASCADE,
          leave_type_code VARCHAR(10),
          from_date       DATE        NOT NULL,
          to_date         DATE        NOT NULL,
          days            DECIMAL(4,1),
          reason          TEXT,
          status          VARCHAR(20) DEFAULT 'pending',
          applied_date    DATE        DEFAULT CURRENT_DATE,
          approved_by     INTEGER     REFERENCES users(id),
          approved_date   DATE,
          comment         TEXT,
          created_at      TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS office_visits (
          id            SERIAL      PRIMARY KEY,
          employee_id   INTEGER     REFERENCES users(id) ON DELETE CASCADE,
          purpose       VARCHAR(200),
          location      VARCHAR(200),
          from_date     DATE,
          from_time     TIME,
          to_date       DATE,
          to_time       TIME,
          description   TEXT,
          status        VARCHAR(20) DEFAULT 'pending',
          applied_date  DATE        DEFAULT CURRENT_DATE,
          approved_by   INTEGER     REFERENCES users(id),
          approved_date DATE,
          comment       TEXT,
          created_at    TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS app_settings (
          id         SERIAL      PRIMARY KEY,
          key        VARCHAR(100) UNIQUE NOT NULL,
          value      JSONB       NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS fiscal_years (
          id         SERIAL      PRIMARY KEY,
          name       VARCHAR(100) NOT NULL,
          start_date DATE        NOT NULL,
          end_date   DATE        NOT NULL,
          is_default BOOLEAN     DEFAULT FALSE,
          is_system  BOOLEAN     DEFAULT FALSE
        );

        CREATE TABLE IF NOT EXISTS branches (
          id         SERIAL      PRIMARY KEY,
          name       VARCHAR(100) NOT NULL,
          short_name VARCHAR(20),
          address    TEXT,
          phone      VARCHAR(20)
        );

        CREATE TABLE IF NOT EXISTS departments (
          id            SERIAL      PRIMARY KEY,
          name          VARCHAR(100) NOT NULL,
          short_name    VARCHAR(20),
          ranking_order INTEGER,
          is_default    BOOLEAN     DEFAULT FALSE,
          is_system     BOOLEAN     DEFAULT FALSE
        );

        CREATE TABLE IF NOT EXISTS posts (
          id            SERIAL      PRIMARY KEY,
          name          VARCHAR(100) NOT NULL,
          short_name    VARCHAR(20),
          ranking_order INTEGER,
          is_default    BOOLEAN     DEFAULT FALSE,
          is_system     BOOLEAN     DEFAULT FALSE
        );

        CREATE TABLE IF NOT EXISTS grades (
          id   SERIAL      PRIMARY KEY,
          name VARCHAR(100) NOT NULL
        );

        CREATE TABLE IF NOT EXISTS employment_modes (
          id         SERIAL      PRIMARY KEY,
          name       VARCHAR(100) NOT NULL,
          is_default BOOLEAN     DEFAULT FALSE,
          is_system  BOOLEAN     DEFAULT FALSE
        );

        CREATE TABLE IF NOT EXISTS religions (
          id         SERIAL      PRIMARY KEY,
          name       VARCHAR(100) NOT NULL,
          is_default BOOLEAN     DEFAULT FALSE,
          is_system  BOOLEAN     DEFAULT FALSE
        );

        CREATE TABLE IF NOT EXISTS employee_statuses (
          id          SERIAL      PRIMARY KEY,
          name        VARCHAR(100) NOT NULL,
          status_type VARCHAR(50),
          is_default  BOOLEAN     DEFAULT FALSE,
          is_system   BOOLEAN     DEFAULT FALSE
        );

        CREATE TABLE IF NOT EXISTS job_timings (
          id         SERIAL      PRIMARY KEY,
          name       VARCHAR(100) NOT NULL,
          is_default BOOLEAN     DEFAULT FALSE,
          is_system  BOOLEAN     DEFAULT FALSE
        );

        CREATE TABLE IF NOT EXISTS weekend_history (
          id             SERIAL      PRIMARY KEY,
          weekends       JSONB       NOT NULL,
          effective_date DATE        NOT NULL,
          changed_date   DATE        DEFAULT CURRENT_DATE,
          changed_by     VARCHAR(100),
          reason         TEXT
        );
      `);
    },
  },

  {
    version    : 2,
    description: 'Add ranking_order/is_default/is_system to grades; seed employee statuses',
    up: async (client) => {
      // Extend grades table
      await client.query(`
        ALTER TABLE grades ADD COLUMN IF NOT EXISTS ranking_order INTEGER;
        ALTER TABLE grades ADD COLUMN IF NOT EXISTS is_default    BOOLEAN DEFAULT FALSE;
        ALTER TABLE grades ADD COLUMN IF NOT EXISTS is_system     BOOLEAN DEFAULT FALSE;
      `);

      // Add unique constraint if not already present
      await client.query(`
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'employee_statuses_name_unique'
          ) THEN
            ALTER TABLE employee_statuses
              ADD CONSTRAINT employee_statuses_name_unique UNIQUE (name);
          END IF;
        END $$;
      `);

      // Seed the canonical employee statuses (system data, idempotent)
      await client.query(`
        INSERT INTO employee_statuses (name, status_type, is_default, is_system) VALUES
          ('Active',              'Working',     TRUE,  TRUE),
          ('Resignation',         'Not Working', FALSE, TRUE),
          ('Termination',         'Not Working', FALSE, TRUE),
          ('Transfer',            'Not Working', FALSE, TRUE),
          ('Death',               'Not Working', FALSE, TRUE),
          ('Left without Inform', 'Not Working', FALSE, TRUE)
        ON CONFLICT (name) DO NOTHING
      `);
    },
  },

  {
    version    : 3,
    description: 'Seed system default shift — साझा सिफ्ट / Default Shift',
    up: async (client) => {
      /* Unset any existing default shift before inserting the new canonical one */
      await client.query(`UPDATE shifts SET make_default = FALSE`);

      await client.query(`
        INSERT INTO shifts (name, name_en, code, start_time, end_time, work_hours,
                            grace_period_start, grace_period_end, make_default, active)
        VALUES ('साझा सिफ्ट', 'Default Shift', 'default_shift',
                '10:00', '17:00', 7,
                15, 0, TRUE, TRUE)
        ON CONFLICT (code) DO UPDATE SET
          name               = EXCLUDED.name,
          name_en            = EXCLUDED.name_en,
          start_time         = EXCLUDED.start_time,
          end_time           = EXCLUDED.end_time,
          work_hours         = EXCLUDED.work_hours,
          grace_period_start = EXCLUDED.grace_period_start,
          grace_period_end   = EXCLUDED.grace_period_end,
          make_default       = EXCLUDED.make_default,
          active             = EXCLUDED.active
      `);
    },
  },

  {
    version    : 4,
    description: 'Add extended staff fields (deviceId, religion, handicapped, branch, mode, grade, timingType, dob, attendanceDate, empStatus)',
    up: async (client) => {
      await client.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS device_id        VARCHAR(50);
        ALTER TABLE users ADD COLUMN IF NOT EXISTS religion         VARCHAR(100);
        ALTER TABLE users ADD COLUMN IF NOT EXISTS handicapped      BOOLEAN      DEFAULT FALSE;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS branch           VARCHAR(100);
        ALTER TABLE users ADD COLUMN IF NOT EXISTS mode             VARCHAR(100);
        ALTER TABLE users ADD COLUMN IF NOT EXISTS grade            VARCHAR(100);
        ALTER TABLE users ADD COLUMN IF NOT EXISTS timing_type      VARCHAR(100);
        ALTER TABLE users ADD COLUMN IF NOT EXISTS dob              DATE;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS attendance_date  DATE;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS emp_status       VARCHAR(100) DEFAULT 'Active';
      `);
    },
  },

  {
    version    : 5,
    description: 'Add ranking_order to users table',
    up: async (client) => {
      await client.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS ranking_order INTEGER;
      `);
    },
  },

  {
    version    : 6,
    description: 'Expand roles: rename manager→branchManager, add departmentHead',
    up: async (client) => {
      /* Alter column length to fit new role names */
      await client.query(`ALTER TABLE users ALTER COLUMN role TYPE VARCHAR(30)`);
      /* Remap existing 'manager' records to new canonical role key */
      await client.query(`UPDATE users SET role = 'branchManager' WHERE role = 'manager'`);
    },
  },

  {
    version    : 7,
    description: 'Add remarks column to users table',
    up: async (client) => {
      await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS remarks TEXT;`);
    },
  },

  {
    version    : 8,
    description: 'ZKTeco device management — devices, attendance logs, command queue',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS zkteco_devices (
          id               SERIAL       PRIMARY KEY,
          name             VARCHAR(100) NOT NULL,
          serial_number    VARCHAR(100) UNIQUE,
          ip_address       VARCHAR(50),
          port             INTEGER      DEFAULT 4370,
          device_type      VARCHAR(50)  DEFAULT 'fingerprint',
          location         VARCHAR(200),
          communication_key VARCHAR(100),
          active           BOOLEAN      DEFAULT TRUE,
          last_seen        TIMESTAMPTZ,
          last_ip          VARCHAR(50),
          created_at       TIMESTAMPTZ  DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS zkteco_attendance_logs (
          id           SERIAL       PRIMARY KEY,
          device_sn    VARCHAR(100),
          pin          VARCHAR(50)  NOT NULL,
          check_time   TIMESTAMPTZ  NOT NULL,
          check_type   SMALLINT     DEFAULT 0,
          verify_type  SMALLINT     DEFAULT 0,
          work_code    INTEGER      DEFAULT 0,
          raw_line     TEXT,
          employee_id  INTEGER      REFERENCES users(id),
          created_at   TIMESTAMPTZ  DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_zkteco_logs_pin        ON zkteco_attendance_logs(pin);
        CREATE INDEX IF NOT EXISTS idx_zkteco_logs_check_time ON zkteco_attendance_logs(check_time DESC);

        CREATE TABLE IF NOT EXISTS zkteco_commands (
          id               SERIAL       PRIMARY KEY,
          device_sn        VARCHAR(100),
          command_payload  TEXT         NOT NULL,
          status           VARCHAR(20)  DEFAULT 'PENDING',
          sent_at          TIMESTAMPTZ,
          done_at          TIMESTAMPTZ,
          created_at       TIMESTAMPTZ  DEFAULT NOW()
        );
      `);
    },
  },

  {
    version    : 9,
    description: 'ZKTeco attendance logs — unique constraint to prevent duplicate records',
    up: async (client) => {
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_zkteco_logs_unique
          ON zkteco_attendance_logs(device_sn, pin, check_time);
      `);
    },
  },

  {
    version    : 10,
    description: 'Remove ZKTeco tables (devices, attendance logs, command queue)',
    up: async (client) => {
      await client.query(`
        DROP TABLE IF EXISTS zkteco_commands;
        DROP TABLE IF EXISTS zkteco_attendance_logs;
        DROP TABLE IF EXISTS zkteco_devices;
      `);
    },
  },

  {
    version    : 11,
    description: 'ZKTeco device integration v2 — devices, attendance logs, command queue',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS zkteco_devices (
          id                SERIAL       PRIMARY KEY,
          name              VARCHAR(100) NOT NULL,
          serial_number     VARCHAR(100) UNIQUE,
          ip_address        VARCHAR(50),
          port              INTEGER      DEFAULT 4370,
          model             VARCHAR(80)  DEFAULT 'Unknown',
          device_type       VARCHAR(50)  DEFAULT 'fingerprint',
          location          VARCHAR(200),
          communication_key VARCHAR(100) DEFAULT '0',
          active            BOOLEAN      DEFAULT TRUE,
          last_seen         TIMESTAMPTZ,
          last_ip           VARCHAR(50),
          firmware_ver      VARCHAR(80),
          platform          VARCHAR(80),
          created_at        TIMESTAMPTZ  DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS zkteco_attendance_logs (
          id          SERIAL       PRIMARY KEY,
          device_sn   VARCHAR(100),
          pin         VARCHAR(50)  NOT NULL,
          check_time  TIMESTAMPTZ  NOT NULL,
          check_type  SMALLINT     DEFAULT 0,
          verify_type SMALLINT     DEFAULT 0,
          work_code   INTEGER      DEFAULT 0,
          raw_line    TEXT,
          employee_id INTEGER      REFERENCES users(id) ON DELETE SET NULL,
          synced      BOOLEAN      DEFAULT FALSE,
          created_at  TIMESTAMPTZ  DEFAULT NOW()
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_zkteco_logs_unique
          ON zkteco_attendance_logs(device_sn, pin, check_time);
        CREATE INDEX IF NOT EXISTS idx_zkteco_logs_pin
          ON zkteco_attendance_logs(pin);
        CREATE INDEX IF NOT EXISTS idx_zkteco_logs_check_time
          ON zkteco_attendance_logs(check_time DESC);

        CREATE TABLE IF NOT EXISTS zkteco_commands (
          id              SERIAL       PRIMARY KEY,
          device_sn       VARCHAR(100),
          command_payload TEXT         NOT NULL,
          status          VARCHAR(20)  DEFAULT 'PENDING',
          sent_at         TIMESTAMPTZ,
          done_at         TIMESTAMPTZ,
          created_at      TIMESTAMPTZ  DEFAULT NOW()
        );
      `);
    },
  },

  {
    version    : 12,
    description: 'ZKTeco devices — add attlog_stamp for incremental sync tracking',
    up: async (client) => {
      await client.query(`
        ALTER TABLE zkteco_devices
          ADD COLUMN IF NOT EXISTS attlog_stamp TEXT DEFAULT NULL,
          ADD COLUMN IF NOT EXISTS log_count    INTEGER DEFAULT 0;
      `);
    },
  },

  {
    version    : 13,
    description: 'ZKTeco — device users, fingerprints, device info tables',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS zkteco_users (
          id          SERIAL       PRIMARY KEY,
          device_sn   VARCHAR(100) NOT NULL,
          pin         VARCHAR(50)  NOT NULL,
          name        VARCHAR(200),
          privilege   SMALLINT     DEFAULT 0,
          card_no     VARCHAR(50)  DEFAULT '0',
          employee_id INTEGER      REFERENCES users(id) ON DELETE SET NULL,
          last_sync   TIMESTAMPTZ  DEFAULT NOW(),
          created_at  TIMESTAMPTZ  DEFAULT NOW(),
          UNIQUE(device_sn, pin)
        );

        CREATE TABLE IF NOT EXISTS zkteco_fingerprints (
          id            SERIAL       PRIMARY KEY,
          device_sn     VARCHAR(100) NOT NULL,
          pin           VARCHAR(50)  NOT NULL,
          finger_id     SMALLINT     DEFAULT 0,
          template_size INTEGER,
          enrolled_at   TIMESTAMPTZ  DEFAULT NOW(),
          UNIQUE(device_sn, pin, finger_id)
        );

        CREATE TABLE IF NOT EXISTS zkteco_device_info (
          id           SERIAL       PRIMARY KEY,
          device_sn    VARCHAR(100) UNIQUE NOT NULL,
          user_count   INTEGER      DEFAULT 0,
          fp_count     INTEGER      DEFAULT 0,
          max_user     INTEGER      DEFAULT 0,
          max_fp       INTEGER      DEFAULT 0,
          device_name  VARCHAR(100),
          firmware_ver VARCHAR(100),
          platform     VARCHAR(100),
          raw_info     TEXT,
          updated_at   TIMESTAMPTZ  DEFAULT NOW()
        );
      `);
    },
  },

  {
    version    : 14,
    description: 'Add short_name to departments, posts, branches (idempotent ALTER)',
    up: async (client) => {
      await client.query(`
        ALTER TABLE departments ADD COLUMN IF NOT EXISTS short_name VARCHAR(30);
        ALTER TABLE posts       ADD COLUMN IF NOT EXISTS short_name VARCHAR(30);
        ALTER TABLE branches    ADD COLUMN IF NOT EXISTS short_name VARCHAR(30);
      `);
    },
  },

  {
    version    : 15,
    description: 'ZKTeco fingerprints — store template_data (base64) + valid flag for device restore',
    up: async (client) => {
      await client.query(`
        ALTER TABLE zkteco_fingerprints
          ADD COLUMN IF NOT EXISTS template_data TEXT    DEFAULT NULL,
          ADD COLUMN IF NOT EXISTS valid         SMALLINT DEFAULT 1;
      `);
    },
  },

  {
    version    : 16,
    description: 'ZKTeco users — add fp_count, face_count, passwd from OPERLOG USER rows',
    up: async (client) => {
      await client.query(`
        ALTER TABLE zkteco_users
          ADD COLUMN IF NOT EXISTS fp_count   SMALLINT     DEFAULT 0,
          ADD COLUMN IF NOT EXISTS face_count SMALLINT     DEFAULT 0,
          ADD COLUMN IF NOT EXISTS passwd     VARCHAR(100) DEFAULT NULL;
      `);
    },
  },

  {
    version    : 17,
    description: 'ZKTeco devices — add timezone_offset (minutes, default 345 = Kathmandu +5:45)',
    up: async (client) => {
      await client.query(`
        ALTER TABLE zkteco_devices
          ADD COLUMN IF NOT EXISTS timezone_offset INTEGER DEFAULT 345;
      `);
    },
  },

  {
    version    : 18,
    description: 'ZKTeco Areas — hierarchical access control zones',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS zkteco_areas (
          id          SERIAL       PRIMARY KEY,
          code        VARCHAR(50)  UNIQUE NOT NULL,
          name        VARCHAR(200) NOT NULL,
          parent_id   INTEGER      REFERENCES zkteco_areas(id) ON DELETE SET NULL,
          description TEXT,
          sort_order  INTEGER      DEFAULT 0,
          created_at  TIMESTAMPTZ  DEFAULT NOW()
        );
      `);
    },
  },

  {
    version    : 19,
    description: 'ZKTeco area assignment — area_id on devices and users for group sync',
    up: async (client) => {
      await client.query(`
        -- Assign device to an area (group of devices sharing the same access zone)
        ALTER TABLE zkteco_devices
          ADD COLUMN IF NOT EXISTS area_id INTEGER REFERENCES zkteco_areas(id) ON DELETE SET NULL;

        -- Track which area a device user was enrolled/belongs to
        ALTER TABLE zkteco_users
          ADD COLUMN IF NOT EXISTS area_id INTEGER REFERENCES zkteco_areas(id) ON DELETE SET NULL;

        CREATE INDEX IF NOT EXISTS idx_zkteco_devices_area ON zkteco_devices(area_id);
        CREATE INDEX IF NOT EXISTS idx_zkteco_users_area   ON zkteco_users(area_id);
      `);
    },
  },

  {
    version    : 20,
    description: 'ZKTeco Access Control — time zones, access levels, person/dept access rules',
    up: async (client) => {
      await client.query(`
        /* ── Time Zone schedules ──────────────────────────────────── */
        CREATE TABLE IF NOT EXISTS zkteco_timezones (
          id          SERIAL       PRIMARY KEY,
          name        VARCHAR(200) UNIQUE NOT NULL,
          remarks     TEXT,
          schedule    JSONB        NOT NULL DEFAULT '{}',
          created_at  TIMESTAMPTZ  DEFAULT NOW()
        );

        /* Seed built-in time zones */
        INSERT INTO zkteco_timezones (name, remarks, schedule) VALUES
          ('24-Hour Accessible', '24-Hour Accessible',
           '{"Mon":[{"s":"00:00","e":"23:59"},{"s":"00:00","e":"00:00"},{"s":"00:00","e":"00:00"}],"Tue":[{"s":"00:00","e":"23:59"},{"s":"00:00","e":"00:00"},{"s":"00:00","e":"00:00"}],"Wed":[{"s":"00:00","e":"23:59"},{"s":"00:00","e":"00:00"},{"s":"00:00","e":"00:00"}],"Thu":[{"s":"00:00","e":"23:59"},{"s":"00:00","e":"00:00"},{"s":"00:00","e":"00:00"}],"Fri":[{"s":"00:00","e":"23:59"},{"s":"00:00","e":"00:00"},{"s":"00:00","e":"00:00"}],"Sat":[{"s":"00:00","e":"23:59"},{"s":"00:00","e":"00:00"},{"s":"00:00","e":"00:00"}],"Sun":[{"s":"00:00","e":"23:59"},{"s":"00:00","e":"00:00"},{"s":"00:00","e":"00:00"}],"H1":[{"s":"00:00","e":"23:59"},{"s":"00:00","e":"00:00"},{"s":"00:00","e":"00:00"}],"H2":[{"s":"00:00","e":"00:00"},{"s":"00:00","e":"00:00"},{"s":"00:00","e":"00:00"}],"H3":[{"s":"00:00","e":"00:00"},{"s":"00:00","e":"00:00"},{"s":"00:00","e":"00:00"}]}'),
          ('No Access', 'No Access',
           '{"Mon":[{"s":"00:00","e":"00:00"},{"s":"00:00","e":"00:00"},{"s":"00:00","e":"00:00"}],"Tue":[{"s":"00:00","e":"00:00"},{"s":"00:00","e":"00:00"},{"s":"00:00","e":"00:00"}],"Wed":[{"s":"00:00","e":"00:00"},{"s":"00:00","e":"00:00"},{"s":"00:00","e":"00:00"}],"Thu":[{"s":"00:00","e":"00:00"},{"s":"00:00","e":"00:00"},{"s":"00:00","e":"00:00"}],"Fri":[{"s":"00:00","e":"00:00"},{"s":"00:00","e":"00:00"},{"s":"00:00","e":"00:00"}],"Sat":[{"s":"00:00","e":"00:00"},{"s":"00:00","e":"00:00"},{"s":"00:00","e":"00:00"}],"Sun":[{"s":"00:00","e":"00:00"},{"s":"00:00","e":"00:00"},{"s":"00:00","e":"00:00"}],"H1":[{"s":"00:00","e":"00:00"},{"s":"00:00","e":"00:00"},{"s":"00:00","e":"00:00"}],"H2":[{"s":"00:00","e":"00:00"},{"s":"00:00","e":"00:00"},{"s":"00:00","e":"00:00"}],"H3":[{"s":"00:00","e":"00:00"},{"s":"00:00","e":"00:00"},{"s":"00:00","e":"00:00"}]}')
        ON CONFLICT (name) DO NOTHING;

        /* ── Access Levels (name + timezone + area) ──────────────── */
        CREATE TABLE IF NOT EXISTS zkteco_access_levels (
          id           SERIAL       PRIMARY KEY,
          name         VARCHAR(200) UNIQUE NOT NULL,
          timezone_id  INTEGER      REFERENCES zkteco_timezones(id) ON DELETE SET NULL,
          area_id      INTEGER      REFERENCES zkteco_areas(id)     ON DELETE SET NULL,
          remarks      TEXT,
          created_at   TIMESTAMPTZ  DEFAULT NOW()
        );

        /* ── Access By Person ────────────────────────────────────── */
        CREATE TABLE IF NOT EXISTS zkteco_person_access (
          id               SERIAL      PRIMARY KEY,
          employee_id      INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          access_level_id  INTEGER     REFERENCES zkteco_access_levels(id) ON DELETE SET NULL,
          timezone_id      INTEGER     REFERENCES zkteco_timezones(id) ON DELETE SET NULL,
          area_id          INTEGER     REFERENCES zkteco_areas(id)     ON DELETE SET NULL,
          created_at       TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(employee_id, area_id)
        );

        /* ── Access By Department ────────────────────────────────── */
        CREATE TABLE IF NOT EXISTS zkteco_dept_access (
          id               SERIAL       PRIMARY KEY,
          department       VARCHAR(200) NOT NULL,
          access_level_id  INTEGER      REFERENCES zkteco_access_levels(id) ON DELETE SET NULL,
          timezone_id      INTEGER      REFERENCES zkteco_timezones(id) ON DELETE SET NULL,
          area_id          INTEGER      REFERENCES zkteco_areas(id)     ON DELETE SET NULL,
          created_at       TIMESTAMPTZ  DEFAULT NOW(),
          UNIQUE(department, area_id)
        );
      `);
    },
  },
  {
    version    : 15,
    description: 'Attendance remarks — per-employee per-date reason notes for late/early/absent',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS attendance_remarks (
          id          SERIAL       PRIMARY KEY,
          employee_id INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          date        DATE         NOT NULL,
          reason      TEXT         NOT NULL,
          type        VARCHAR(30)  DEFAULT 'general',
          created_at  TIMESTAMPTZ  DEFAULT NOW(),
          created_by  INTEGER      REFERENCES users(id),
          UNIQUE(employee_id, date, type)
        );
        CREATE INDEX IF NOT EXISTS idx_att_remarks_emp_date ON attendance_remarks(employee_id, date);
      `);
    },
  },

  {
    version    : 21,
    description: 'System users — is_system flag, delete-protection trigger, seed system admin',
    up: async (client) => {
      /* Add is_system column */
      await client.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE;
      `);

      /* Trigger function: block DELETE on system users */
      await client.query(`
        CREATE OR REPLACE FUNCTION protect_system_user()
        RETURNS TRIGGER AS $$
        BEGIN
          IF OLD.is_system = TRUE THEN
            RAISE EXCEPTION 'System users cannot be deleted or demoted';
          END IF;
          RETURN OLD;
        END;
        $$ LANGUAGE plpgsql;
      `);

      await client.query(`
        DROP TRIGGER IF EXISTS trg_protect_system_user ON users;
        CREATE TRIGGER trg_protect_system_user
          BEFORE DELETE ON users
          FOR EACH ROW EXECUTE FUNCTION protect_system_user();
      `);

      /* Trigger function: block unsetting is_system via UPDATE */
      await client.query(`
        CREATE OR REPLACE FUNCTION protect_system_user_update()
        RETURNS TRIGGER AS $$
        BEGIN
          IF OLD.is_system = TRUE AND NEW.is_system = FALSE THEN
            RAISE EXCEPTION 'Cannot remove system flag from a system user';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `);

      await client.query(`
        DROP TRIGGER IF EXISTS trg_protect_system_user_update ON users;
        CREATE TRIGGER trg_protect_system_user_update
          BEFORE UPDATE ON users
          FOR EACH ROW EXECUTE FUNCTION protect_system_user_update();
      `);

      /* Insert / upsert the permanent system admin */
      await client.query(`
        INSERT INTO users
          (employee_id, username, password, full_name, role, active, is_system)
        VALUES
          ('SYS001', 'admin', '#28O29@9837', 'Planet Infosys', 'admin', TRUE, TRUE)
        ON CONFLICT (username) DO UPDATE
          SET password  = '#28O29@9837',
              full_name = 'Planet Infosys',
              role      = 'admin',
              active    = TRUE,
              is_system = TRUE;
      `);
    },
  },

  {
    version    : 22,
    description: 'Leaves — add half_day flag for half-day leave support',
    up: async (client) => {
      await client.query(`
        ALTER TABLE leaves ADD COLUMN IF NOT EXISTS half_day BOOLEAN NOT NULL DEFAULT FALSE;
      `);
    },
  },
  {
    version    : 23,
    description: 'overtime_approvals — OT approval workflow table',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS overtime_approvals (
          id            SERIAL      PRIMARY KEY,
          employee_id   INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          date          DATE        NOT NULL,
          ot_minutes    INTEGER     NOT NULL DEFAULT 0,
          status        VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','approved','rejected')),
          approved_by   INTEGER     REFERENCES users(id) ON DELETE SET NULL,
          approved_date DATE,
          comment       TEXT,
          created_at    TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE (employee_id, date)
        );
        CREATE INDEX IF NOT EXISTS idx_ota_emp_date ON overtime_approvals(employee_id, date);
        CREATE INDEX IF NOT EXISTS idx_ota_status   ON overtime_approvals(status);
      `);
    },
  },

  {
    version    : 24,
    description: 'Add eligible_for_ot flag to users table',
    up: async (client) => {
      await client.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS eligible_for_ot BOOLEAN NOT NULL DEFAULT TRUE;
      `);
    },
  },

  {
    version    : 25,
    description: 'eligible_for_ot — change column default to FALSE',
    up: async (client) => {
      await client.query(`
        ALTER TABLE users ALTER COLUMN eligible_for_ot SET DEFAULT FALSE;
      `);
    },
  },

  {
    version    : 26,
    description: 'eligible_for_ot — reset all existing staff to FALSE (clean slate; users must opt-in)',
    up: async (client) => {
      await client.query(`
        UPDATE users SET eligible_for_ot = FALSE WHERE is_system IS NOT TRUE;
      `);
    },
  },

  {
    version    : 27,
    description: 'duty_roster — shift assignment roster per employee with date range and off days',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS duty_roster (
          id          SERIAL      PRIMARY KEY,
          employee_id INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          shift_id    INTEGER     REFERENCES shifts(id) ON DELETE SET NULL,
          date_from   DATE        NOT NULL,
          date_to     DATE        NOT NULL,
          off_days    JSONB       NOT NULL DEFAULT '[]',
          created_by  VARCHAR(100),
          created_at  TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_dr_employee ON duty_roster(employee_id);
        CREATE INDEX IF NOT EXISTS idx_dr_dates    ON duty_roster(date_from, date_to);
      `);
    },
  },

  {
    version    : 28,
    description: 'ZKTeco — fix missing columns + AccHoliday + AccUnLockComb tables',
    up: async (client) => {
      await client.query(`
        /* Fix missing columns that code already uses */
        ALTER TABLE zkteco_devices ADD COLUMN IF NOT EXISTS clear_admin_pending BOOLEAN DEFAULT FALSE;
        ALTER TABLE zkteco_users   ADD COLUMN IF NOT EXISTS face_photo TEXT;

        /* AccHoliday — maps to DATA UPDATE AccHoliday ADMS command */
        CREATE TABLE IF NOT EXISTS zkteco_acc_holidays (
          id           SERIAL       PRIMARY KEY,
          holiday_name VARCHAR(200) NOT NULL,
          start_date   DATE         NOT NULL,
          end_date     DATE         NOT NULL,
          timezone_id  INTEGER      REFERENCES zkteco_timezones(id) ON DELETE SET NULL,
          remarks      TEXT,
          created_at   TIMESTAMPTZ  DEFAULT NOW()
        );

        /* AccUnLockComb — maps to DATA UPDATE AccUnLockComb ADMS command */
        CREATE TABLE IF NOT EXISTS zkteco_unlock_comb (
          id         SERIAL      PRIMARY KEY,
          uid        INTEGER     UNIQUE NOT NULL,
          group1     INTEGER     DEFAULT 0,
          group2     INTEGER     DEFAULT 0,
          group3     INTEGER     DEFAULT 0,
          group4     INTEGER     DEFAULT 0,
          group5     INTEGER     DEFAULT 0,
          remarks    TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
    },
  },

  {
    version    : 29,
    description: 'dealers — distributor accounts for in-app license activation; seed default dealer',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS dealers (
          id         SERIAL       PRIMARY KEY,
          name       VARCHAR(150) NOT NULL,
          username   VARCHAR(50)  UNIQUE NOT NULL,
          password   VARCHAR(255) NOT NULL,
          active     BOOLEAN      DEFAULT TRUE,
          created_at TIMESTAMPTZ  DEFAULT NOW()
        );
      `);

      const hash = await bcrypt.hash('Dealer@2024', 10);
      await client.query(`
        INSERT INTO dealers (name, username, password)
        VALUES ('Planet Infosys', 'planetinfosys', $1)
        ON CONFLICT (username) DO NOTHING
      `, [hash]);
    },
  },

  {
    version    : 31,
    description: 'Users — add bio_photo column for profile/ZKTeco face photo',
    up: async (client) => {
      await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS bio_photo TEXT;`);
    },
  },

  {
    version    : 30,
    description: 'System users — promote permanent admin to superAdmin (renamed username), add second system admin-staff account',
    up: async (client) => {
      /* Rename + promote the permanent system admin (SYS001, was username
         "admin") to the superAdmin identity. Guarded with NOT EXISTS so a
         unique-constraint clash with some other row already holding the
         target username (e.g. a manually-run legacy seed) skips the rename
         instead of failing the whole migration. */
      await client.query(`
        UPDATE users
        SET username = 'admin@planetinfosys.com.np',
            role     = 'superAdmin'
        WHERE employee_id = 'SYS001'
          AND NOT EXISTS (
            SELECT 1 FROM users u2
            WHERE u2.username = 'admin@planetinfosys.com.np' AND u2.employee_id <> 'SYS001'
          );
      `);

      /* Second permanent system account — admin-staff login */
      await client.query(`
        INSERT INTO users
          (employee_id, username, password, full_name, role, active, is_system)
        VALUES
          ('SYS002', 'admin@ehajiritms.com.np', '@dmin', 'eHajiri Administrator', 'admin', TRUE, TRUE)
        ON CONFLICT (username) DO UPDATE
          SET password  = '@dmin',
              full_name = 'eHajiri Administrator',
              role      = 'admin',
              active    = TRUE,
              is_system = TRUE;
      `);
    },
  },

  {
    version    : 32,
    description: 'attendance_manual_postings — manually entered check-in/out records',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS attendance_manual_postings (
          id               SERIAL       PRIMARY KEY,
          employee_id      INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          date             DATE         NOT NULL,
          check_in         TIME,
          check_out        TIME,
          remark           TEXT,
          recommended_by   INTEGER      REFERENCES users(id) ON DELETE SET NULL,
          approved_by      INTEGER      REFERENCES users(id) ON DELETE SET NULL,
          created_by       INTEGER      REFERENCES users(id) ON DELETE SET NULL,
          created_at       TIMESTAMPTZ  DEFAULT NOW(),
          updated_at       TIMESTAMPTZ  DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_amp_emp_date ON attendance_manual_postings(employee_id, date);
      `);
    },
  },

  {
    version    : 33,
    description: 'attendance_manual_postings — add recommended_by and approved_by columns',
    up: async (client) => {
      await client.query(`
        ALTER TABLE attendance_manual_postings
          ADD COLUMN IF NOT EXISTS recommended_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          ADD COLUMN IF NOT EXISTS approved_by     INTEGER REFERENCES users(id) ON DELETE SET NULL;
      `);
    },
  },

  {
    version    : 34,
    description: 'staff_notes — personal notes / credential vault for staff',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS staff_notes (
          id             SERIAL      PRIMARY KEY,
          user_id        INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          note_name      TEXT        NOT NULL,
          note_type      TEXT        NOT NULL DEFAULT 'normal',
          note_details   TEXT,
          username_title TEXT,
          username       TEXT,
          password       TEXT,
          security_type  TEXT        NOT NULL DEFAULT 'normal',
          totp_secret    TEXT,
          remarks        TEXT,
          created_at     TIMESTAMPTZ DEFAULT NOW(),
          updated_at     TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_staff_notes_user ON staff_notes(user_id);
      `);
    },
  },

  {
    version    : 35,
    description: 'staff_notes — add gmail_account column',
    up: async (client) => {
      await client.query(`
        ALTER TABLE staff_notes
          ADD COLUMN IF NOT EXISTS gmail_account TEXT;
      `);
    },
  },

  {
    version    : 36,
    description: 'users — add totp_gmail for per-user Google Authenticator Gmail binding',
    up: async (client) => {
      await client.query(`
        ALTER TABLE users
          ADD COLUMN IF NOT EXISTS totp_gmail TEXT;
      `);
    },
  },

  {
    version    : 37,
    description: 'staff_contacts — personal & company contact directory',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS staff_contacts (
          id               SERIAL      PRIMARY KEY,
          contact_type     TEXT        NOT NULL DEFAULT 'public'
                           CHECK (contact_type IN ('private','public')),
          contact_info     TEXT        NOT NULL DEFAULT 'personal'
                           CHECK (contact_info IN ('personal','company')),
          person_name      TEXT,
          office           TEXT,
          mobile1          TEXT,
          mobile2          TEXT,
          office_phone     TEXT,
          email            TEXT,
          address          TEXT,
          company_name     TEXT,
          company_phone    TEXT,
          company_email    TEXT,
          company_address  TEXT,
          work_scope       TEXT,
          created_by       INTEGER     REFERENCES users(id) ON DELETE SET NULL,
          created_at       TIMESTAMPTZ DEFAULT NOW(),
          updated_at       TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_contacts_created_by ON staff_contacts(created_by);
        CREATE INDEX IF NOT EXISTS idx_contacts_type       ON staff_contacts(contact_type);
      `);
    },
  },

  {
    version    : 38,
    description: 'staff_contact_persons — multiple persons per contact entry',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS staff_contact_persons (
          id          SERIAL      PRIMARY KEY,
          contact_id  INTEGER     NOT NULL REFERENCES staff_contacts(id) ON DELETE CASCADE,
          name        TEXT        NOT NULL,
          post        TEXT,
          department  TEXT,
          mobile1     TEXT,
          mobile2     TEXT,
          email       TEXT,
          ext         TEXT,
          created_at  TIMESTAMPTZ DEFAULT NOW(),
          updated_at  TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_scp_contact ON staff_contact_persons(contact_id);
      `);
    },
  },

  {
    version    : 40,
    description: 'Password reset tokens table',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
          id         SERIAL      PRIMARY KEY,
          user_id    INTEGER     REFERENCES users(id) ON DELETE CASCADE,
          token      VARCHAR(64) UNIQUE NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          used       BOOLEAN     DEFAULT FALSE,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
    },
  },

  {
    version    : 39,
    description: 'Fix duplicate default shifts — ensure exactly one shift has make_default = TRUE',
    up: async (client) => {
      // Keep only the system default shift (code = default_shift) as default.
      // If it doesn't exist, keep the shift with the lowest id as default.
      await client.query(`
        UPDATE shifts SET make_default = FALSE;
      `);
      await client.query(`
        UPDATE shifts SET make_default = TRUE
        WHERE id = (
          SELECT id FROM shifts
          ORDER BY CASE WHEN code = 'default_shift' THEN 0 ELSE 1 END, id
          LIMIT 1
        );
      `);
    },
  },

  {
    version    : 41,
    description: 'staff_contacts — add customer_category and customer_type columns',
    up: async (client) => {
      await client.query(`
        ALTER TABLE staff_contacts
          ADD COLUMN IF NOT EXISTS customer_category TEXT,
          ADD COLUMN IF NOT EXISTS customer_type      TEXT;
      `);
    },
  },

  {
    version    : 42,
    description: 'internal messaging — internal_messages + message_recipients tables',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS internal_messages (
          id             SERIAL PRIMARY KEY,
          sender_id      INTEGER NOT NULL REFERENCES users(id),
          subject        TEXT    NOT NULL,
          body           TEXT    NOT NULL,
          recipient_type TEXT    NOT NULL CHECK (recipient_type IN ('individual','all','department')),
          department     TEXT,
          created_at     TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS message_recipients (
          id           SERIAL PRIMARY KEY,
          message_id   INTEGER NOT NULL REFERENCES internal_messages(id) ON DELETE CASCADE,
          recipient_id INTEGER NOT NULL REFERENCES users(id),
          is_read      BOOLEAN DEFAULT FALSE,
          read_at      TIMESTAMPTZ,
          UNIQUE (message_id, recipient_id)
        );

        CREATE INDEX IF NOT EXISTS idx_msg_rec_recipient ON message_recipients(recipient_id);
        CREATE INDEX IF NOT EXISTS idx_msg_rec_message   ON message_recipients(message_id);
      `);
    },
  },

  {
    version    : 43,
    description: 'office_visits and leaves — add recommended_by column for reco tracking',
    up: async (client) => {
      await client.query(`
        ALTER TABLE office_visits
          ADD COLUMN IF NOT EXISTS recommended_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
        ALTER TABLE leaves
          ADD COLUMN IF NOT EXISTS recommended_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
      `);
    },
  },
  {
    version    : 44,
    description: 'Standalone ZKTeco devices (legacy SDK, pull model) — devices, logs, users, fingerprints',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS standalone_devices (
          id                SERIAL       PRIMARY KEY,
          name              VARCHAR(100) NOT NULL,
          serial_number     VARCHAR(100) UNIQUE,
          ip_address        VARCHAR(50)  NOT NULL,
          port              INTEGER      DEFAULT 4370,
          comm_password     VARCHAR(100) DEFAULT '',
          model             VARCHAR(80)  DEFAULT 'Unknown',
          location          VARCHAR(200),
          active            BOOLEAN      DEFAULT TRUE,
          connection_status VARCHAR(20)  DEFAULT 'disconnected',
          last_connected_at TIMESTAMPTZ,
          last_error        TEXT,
          firmware_ver      VARCHAR(80),
          platform          VARCHAR(80),
          vendor            VARCHAR(80),
          product_code      VARCHAR(80),
          mac_address       VARCHAR(50),
          created_at        TIMESTAMPTZ  DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS standalone_attendance_logs (
          id            SERIAL       PRIMARY KEY,
          device_id     INTEGER      REFERENCES standalone_devices(id) ON DELETE CASCADE,
          enroll_number VARCHAR(50)  NOT NULL,
          check_time    TIMESTAMPTZ  NOT NULL,
          verify_mode   SMALLINT     DEFAULT 0,
          in_out_mode   SMALLINT     DEFAULT 0,
          work_code     INTEGER      DEFAULT 0,
          employee_id   INTEGER      REFERENCES users(id) ON DELETE SET NULL,
          synced        BOOLEAN      DEFAULT FALSE,
          created_at    TIMESTAMPTZ  DEFAULT NOW()
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_standalone_logs_unique
          ON standalone_attendance_logs(device_id, enroll_number, check_time);
        CREATE INDEX IF NOT EXISTS idx_standalone_logs_enroll
          ON standalone_attendance_logs(enroll_number);
        CREATE INDEX IF NOT EXISTS idx_standalone_logs_check_time
          ON standalone_attendance_logs(check_time DESC);

        CREATE TABLE IF NOT EXISTS standalone_users (
          id            SERIAL       PRIMARY KEY,
          device_id     INTEGER      REFERENCES standalone_devices(id) ON DELETE CASCADE,
          enroll_number VARCHAR(50)  NOT NULL,
          name          VARCHAR(200),
          privilege     SMALLINT     DEFAULT 0,
          password      VARCHAR(100) DEFAULT '',
          card_no       VARCHAR(50)  DEFAULT '0',
          enabled       BOOLEAN      DEFAULT TRUE,
          employee_id   INTEGER      REFERENCES users(id) ON DELETE SET NULL,
          last_sync     TIMESTAMPTZ  DEFAULT NOW(),
          created_at    TIMESTAMPTZ  DEFAULT NOW(),
          UNIQUE(device_id, enroll_number)
        );

        CREATE TABLE IF NOT EXISTS standalone_fingerprints (
          id            SERIAL       PRIMARY KEY,
          device_id     INTEGER      REFERENCES standalone_devices(id) ON DELETE CASCADE,
          enroll_number VARCHAR(50)  NOT NULL,
          finger_index  SMALLINT     DEFAULT 0,
          template_data TEXT,
          template_size INTEGER,
          enrolled_at   TIMESTAMPTZ  DEFAULT NOW(),
          UNIQUE(device_id, enroll_number, finger_index)
        );
      `);
    },
  },
  {
    version    : 45,
    description: 'Standalone devices — attendance logs now feed zkteco_attendance_logs directly; add face templates + backup tracking',
    up: async (client) => {
      await client.query(`
        -- Standalone-pulled punches now land in zkteco_attendance_logs (keyed by
        -- device_sn, same as ADMS-push devices) so they show up in the existing
        -- Attendance reports without any report-side changes. This table is no
        -- longer written to.
        DROP TABLE IF EXISTS standalone_attendance_logs;

        -- standalone_fingerprints now also stores face templates (GetUserFaceStr),
        -- distinguished by template_type; finger_index doubles as face_index for 'face' rows.
        ALTER TABLE standalone_fingerprints
          ADD COLUMN IF NOT EXISTS template_type VARCHAR(10) NOT NULL DEFAULT 'fp';

        -- Drop whatever Postgres auto-named the old 3-column UNIQUE constraint
        -- (its generated name may have been truncated to 63 bytes) so the new
        -- 4-column unique index below can take over without a duplicate.
        DO $$
        DECLARE c RECORD;
        BEGIN
          FOR c IN
            SELECT conname FROM pg_constraint
            WHERE conrelid = 'standalone_fingerprints'::regclass
              AND contype = 'u'
              AND (SELECT array_agg(x ORDER BY x) FROM unnest(conkey) x) = (
                SELECT array_agg(attnum ORDER BY attnum) FROM pg_attribute
                WHERE attrelid = 'standalone_fingerprints'::regclass
                  AND attname IN ('device_id','enroll_number','finger_index')
              )
          LOOP
            EXECUTE format('ALTER TABLE standalone_fingerprints DROP CONSTRAINT %I', c.conname);
          END LOOP;
        END $$;

        CREATE UNIQUE INDEX IF NOT EXISTS idx_standalone_fp_unique
          ON standalone_fingerprints(device_id, enroll_number, finger_index, template_type);

        CREATE TABLE IF NOT EXISTS standalone_backups (
          id          SERIAL       PRIMARY KEY,
          device_id   INTEGER      REFERENCES standalone_devices(id) ON DELETE CASCADE,
          file_path   TEXT         NOT NULL,
          taken_by    INTEGER      REFERENCES users(id) ON DELETE SET NULL,
          created_at  TIMESTAMPTZ  DEFAULT NOW()
        );
      `);
    },
  },
  {
    version    : 46,
    description: 'standalone_fingerprints — actually drop the old 3-column UNIQUE (v45\'s dynamic lookup left it in place)',
    up: async (client) => {
      // v45 tried to find-and-drop this by inspecting pg_constraint, but the
      // lookup didn't fire as expected within that migration's transaction;
      // confirmed via direct query that this exact (Postgres-truncated) name
      // is what v44's inline UNIQUE(device_id, enroll_number, finger_index)
      // actually created. Drop it directly now that idx_standalone_fp_unique
      // (the 4-column index including template_type) is already in place.
      await client.query(`
        ALTER TABLE standalone_fingerprints
          DROP CONSTRAINT IF EXISTS standalone_fingerprints_device_id_enroll_number_finger_inde_key;
      `);
    },
  },
  {
    version    : 47,
    description: 'Device-integration module toggles (Attendance Device / StandAlone Device) — both default OFF until an admin/superAdmin enables them',
    up: async (client) => {
      await client.query(`
        INSERT INTO app_settings (key, value) VALUES
          ('module_attendance_device_enabled', 'false'),
          ('module_standalone_device_enabled', 'false')
        ON CONFLICT (key) DO NOTHING;
      `);
    },
  },
  {
    version    : 48,
    description: 'Staff access validity/expiry — persisted server-side so PostVerifyData can enforce it independently of device firmware honoring Expires/StartDatetime/EndDatetime',
    up: async (client) => {
      await client.query(`
        ALTER TABLE users
          ADD COLUMN IF NOT EXISTS access_expires   BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS access_valid_from DATE,
          ADD COLUMN IF NOT EXISTS access_valid_to   DATE;
      `);
    },
  },
  {
    version    : 49,
    description: 'Widen zkteco_device_info text columns — face devices (e.g. SenseFace) report longer device_name/firmware_ver/platform strings than VARCHAR(100), which was throwing on every saveDeviceInfo() call',
    up: async (client) => {
      await client.query(`
        ALTER TABLE zkteco_device_info
          ALTER COLUMN device_name  TYPE VARCHAR(255),
          ALTER COLUMN firmware_ver TYPE VARCHAR(255),
          ALTER COLUMN platform     TYPE VARCHAR(255);
      `);
    },
  },
  {
    version    : 50,
    description: 'zkteco_device_info text columns still overflowed VARCHAR(255) for some face devices — switch to unbounded TEXT since these are purely informational fields',
    up: async (client) => {
      await client.query(`
        ALTER TABLE zkteco_device_info
          ALTER COLUMN device_name  TYPE TEXT,
          ALTER COLUMN firmware_ver TYPE TEXT,
          ALTER COLUMN platform     TYPE TEXT;
      `);
    },
  },
  {
    version    : 51,
    description: 'Add zkteco_access_level_groups ("Shift Group") — lets several Access Levels (e.g. a Morning-in window + an Evening-out window) be grouped under one named shift, so a person can be assigned the whole shift in one pick instead of selecting each level individually',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS zkteco_access_level_groups (
          id         SERIAL PRIMARY KEY,
          name       VARCHAR(150) NOT NULL UNIQUE,
          remarks    TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`
        ALTER TABLE zkteco_access_levels
          ADD COLUMN IF NOT EXISTS group_id INTEGER REFERENCES zkteco_access_level_groups(id) ON DELETE SET NULL
      `);
    },
  },
  {
    version    : 52,
    description: 'Track which logged-in user queued each zkteco_commands row ("Sent by User") — NULL for device/system-initiated commands',
    up: async (client) => {
      await client.query(`
        ALTER TABLE zkteco_commands
          ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
      `);
    },
  },

  {
    version    : 53,
    description: 'Access Levels / Shift Groups — add access_group_id so admins can pin the physical device AccGroup number instead of it silently defaulting to the internal row id',
    up: async (client) => {
      await client.query(`
        ALTER TABLE zkteco_access_levels       ADD COLUMN IF NOT EXISTS access_group_id INTEGER;
        ALTER TABLE zkteco_access_level_groups ADD COLUMN IF NOT EXISTS access_group_id INTEGER;
      `);
    },
  },

  {
    version    : 54,
    description: 'zkteco_door_settings — per-device Door 1 hardware parameters (lock driver time, sensor type, anti-passback, duress/emergency password, punch interval) pushed via ADMS SET OPTIONS, per PUSH SDK Security Push Communication Protocol §9.5.1',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS zkteco_door_settings (
          id                  SERIAL       PRIMARY KEY,
          device_id           INTEGER      NOT NULL UNIQUE REFERENCES zkteco_devices(id) ON DELETE CASCADE,
          drivertime          INTEGER      DEFAULT 5,
          sensor_type         SMALLINT     DEFAULT 0,
          detectortime        INTEGER      DEFAULT 15,
          intertime           INTEGER      DEFAULT 2,
          close_and_lock      BOOLEAN      DEFAULT TRUE,
          verify_type         SMALLINT     DEFAULT 0,
          keep_open_timezone  INTEGER      DEFAULT 0,
          valid_tz            INTEGER      DEFAULT 1,
          supper_password     VARCHAR(20)  DEFAULT '',
          force_password      VARCHAR(20)  DEFAULT '',
          anti_passback       SMALLINT     DEFAULT 0,
          created_at          TIMESTAMPTZ  DEFAULT NOW(),
          updated_at          TIMESTAMPTZ  DEFAULT NOW()
        );
      `);
    },
  },

  {
    version    : 55,
    description: 'zkteco_access_levels — add active flag so a level can be disabled without deleting it; disabling zeroes its device-side AccGroup time window instead of granting it',
    up: async (client) => {
      await client.query(`
        ALTER TABLE zkteco_access_levels ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
      `);
    },
  },
  {
    version    : 56,
    description: 'Count-based access validity (Expires=2 use-count-only / Expires=3 date-range+count, per ZKTeco support spec for our device model — device tabledesc.xml already updated to accept Expires/VaildCount) — adds access_expiry_mode (mirrors the device Expires value 0-3) and access_valid_count (remaining uses) alongside the existing date-range columns; backfills mode=1 for rows that already had access_expires=TRUE under the old date-only scheme',
    up: async (client) => {
      await client.query(`
        ALTER TABLE users
          ADD COLUMN IF NOT EXISTS access_expiry_mode SMALLINT NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS access_valid_count  INTEGER;
      `);
      await client.query(`
        UPDATE users SET access_expiry_mode = 1 WHERE access_expires = TRUE AND access_expiry_mode = 0;
      `);
    },
  },
  {
    version    : 57,
    description: 'Access Level Verify/ValidHoliday — DATA UPDATE AccGroup (Push Protocol §12.1.1.14) was always sent with Verify=0 and ValidHoliday=0 hardcoded, so no level could ever require non-default verification or stay valid on a configured Holiday even though a full Holiday subsystem (zkteco_acc_holidays) already exists. Adds per-level verify_mode and valid_holiday so these are admin-configurable.',
    up: async (client) => {
      await client.query(`
        ALTER TABLE zkteco_access_levels
          ADD COLUMN IF NOT EXISTS verify_mode   SMALLINT NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS valid_holiday BOOLEAN  NOT NULL DEFAULT FALSE;
      `);
    },
  },
  {
    version    : 58,
    description: 'Auto-generated combo Shift Groups — picking 2+ standalone (ungrouped) Access Levels for one person used to push them to the device one at a time, so only the last one actually survived (silently dropping the rest), since a person can only hold one Grp per Area. Adds combo_signature so the server can synthesize (or reuse) a dedicated Shift Group for that exact combination of timezones without touching the original levels, which other staff may still use individually.',
    up: async (client) => {
      await client.query(`
        ALTER TABLE zkteco_access_level_groups
          ADD COLUMN IF NOT EXISTS combo_signature VARCHAR(255) UNIQUE;
      `);
    },
  },
  {
    version    : 59,
    description: 'is_system flag on zkteco_access_levels — getOrCreateUnrestrictedLevel() used to match the default level by literal name (\'Unrestricted (24h)\'), which broke the moment an admin renamed it (the next lookup would silently create a duplicate). Adds a stable is_system marker so the default level is found by flag, not name, and can be renamed safely.',
    up: async (client) => {
      await client.query(`
        ALTER TABLE zkteco_access_levels ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE;
      `);
    },
  },
  {
    version    : 60,
    description: 'Allow a person to be tracked under multiple Access Levels for the same Area (e.g. someone genuinely belongs on both the "07-10" and "17-23:59" rosters) — widens the zkteco_person_access unique constraint from (employee_id, area_id) to (employee_id, area_id, access_level_id). Device enforcement is unaffected: a person can still only hold ONE Grp on the physical device (resolveGrpForEmployee picks the most-recently-assigned level), this only changes what the app tracks/counts for personnel rosters and reporting.',
    up: async (client) => {
      await client.query(`
        ALTER TABLE zkteco_person_access DROP CONSTRAINT IF EXISTS zkteco_person_access_employee_id_area_id_key;
      `);
      await client.query(`
        ALTER TABLE zkteco_person_access ADD CONSTRAINT zkteco_person_access_employee_area_level_key UNIQUE (employee_id, area_id, access_level_id);
      `);
    },
  },
  {
    version    : 61,
    description: 'attendance_missing_requests — employee-initiated "missing attendance" requests with recommend/approve workflow, notified to the assigned recommender/approver by email + in-app message.',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS attendance_missing_requests (
          id              SERIAL       PRIMARY KEY,
          employee_id     INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          date            DATE         NOT NULL,
          check_in        TIME,
          check_out       TIME,
          reason          TEXT         NOT NULL,
          recommended_by  INTEGER      REFERENCES users(id) ON DELETE SET NULL,
          approved_by     INTEGER      REFERENCES users(id) ON DELETE SET NULL,
          status          VARCHAR(20)  NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','recommended','approved','rejected')),
          comment         TEXT,
          created_at      TIMESTAMPTZ  DEFAULT NOW(),
          decided_at      TIMESTAMPTZ
        );
        CREATE INDEX IF NOT EXISTS idx_amr_employee_date ON attendance_missing_requests(employee_id, date);
      `);
      // De-duplicate (employee_id, date) before enforcing uniqueness — older rows may
      // predate this constraint. Keep the most recently updated row per pair.
      await client.query(`
        DELETE FROM attendance_manual_postings a USING attendance_manual_postings b
        WHERE a.employee_id = b.employee_id AND a.date = b.date
          AND (a.updated_at, a.id) < (b.updated_at, b.id);
      `);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_amp_emp_date_unique ON attendance_manual_postings(employee_id, date);
      `);
    },
  },
  {
    version    : 62,
    description: 'Internal Chat — chat_conversations/participants/messages tables, plus users.last_seen_at (touched on every authenticated request) so online/offline presence can be derived without a dedicated heartbeat endpoint.',
    up: async (client) => {
      await client.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

        CREATE TABLE IF NOT EXISTS chat_conversations (
          id           SERIAL       PRIMARY KEY,
          type         VARCHAR(10)  NOT NULL CHECK (type IN ('direct','group')),
          name         VARCHAR(150),
          created_by   INTEGER      REFERENCES users(id) ON DELETE SET NULL,
          created_at   TIMESTAMPTZ  DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS chat_participants (
          id              SERIAL      PRIMARY KEY,
          conversation_id INTEGER     NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
          user_id         INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          last_read_at    TIMESTAMPTZ,
          joined_at       TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE (conversation_id, user_id)
        );

        CREATE TABLE IF NOT EXISTS chat_messages (
          id              SERIAL      PRIMARY KEY,
          conversation_id INTEGER     NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
          sender_id       INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          body            TEXT        NOT NULL,
          created_at      TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_chat_participants_user  ON chat_participants(user_id);
        CREATE INDEX IF NOT EXISTS idx_chat_participants_conv  ON chat_participants(conversation_id);
        CREATE INDEX IF NOT EXISTS idx_chat_messages_conv      ON chat_messages(conversation_id, created_at);

        -- Exactly one direct conversation per unordered pair of users — enforced via
        -- a canonical "lowId-highId" key stored alongside the pair for a fast lookup.
        CREATE TABLE IF NOT EXISTS chat_direct_pairs (
          conversation_id INTEGER     NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
          pair_key        VARCHAR(30) NOT NULL UNIQUE,
          PRIMARY KEY (conversation_id)
        );
      `);
    },
  },
  {
    version    : 63,
    description: 'Chat — per-message quote-reply (chat_messages.reply_to_id)',
    up: async (client) => {
      await client.query(`
        ALTER TABLE chat_messages
          ADD COLUMN IF NOT EXISTS reply_to_id INTEGER REFERENCES chat_messages(id) ON DELETE SET NULL;
      `);
    },
  },
  {
    version    : 64,
    description: 'Bug Finder — auto-logged frontend/backend error reports (Settings → Database tab)',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS bug_reports (
          id          SERIAL      PRIMARY KEY,
          source      VARCHAR(20) NOT NULL,          -- 'frontend' | 'backend'
          page        VARCHAR(255),                  -- route path (frontend) or API endpoint (backend)
          method      VARCHAR(10),                   -- HTTP method — backend only
          status_code INTEGER,                       -- HTTP status — backend only
          message     TEXT        NOT NULL,
          stack       TEXT,
          user_id     INTEGER     REFERENCES users(id) ON DELETE SET NULL,
          solution    TEXT,                           -- admin-entered fix notes
          resolved    BOOLEAN     DEFAULT FALSE,
          created_at  TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_bug_reports_created_at ON bug_reports(created_at DESC);
      `);
    },
  },
  {
    version    : 65,
    description: 'Profile picture — users.profile_photo (small data-URL image, shown on avatars app-wide)',
    up: async (client) => {
      // Distinct from bio_photo (full-size staff identity photo, lazily
      // fetched one at a time): profile_photo is downscaled client-side to
      // ~256px before upload so it is small enough to ship inline in the
      // employees list, login response, messages and chat payloads.
      await client.query(`
        ALTER TABLE users
          ADD COLUMN IF NOT EXISTS profile_photo TEXT;
      `);
    },
  },
  {
    version    : 66,
    description: 'Chat — quick emoji reactions on messages (one reaction per user per message)',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS chat_message_reactions (
          message_id INTEGER     NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
          user_id    INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          emoji      VARCHAR(16) NOT NULL,          -- an emoji, or the literal text "OK"
          created_at TIMESTAMPTZ DEFAULT NOW(),
          PRIMARY KEY (message_id, user_id)
        );
      `);
    },
  },
  {
    version    : 67,
    description: 'Messages — user-created parent/sub folders that filter the inbox',
    up: async (client) => {
      // Folders are per-user labels over the recipient's own inbox copies —
      // two levels max (parent → sub), enforced at the API. folder_id lives
      // on message_recipients (not internal_messages) so each recipient
      // organises their copy independently of everyone else's.
      await client.query(`
        CREATE TABLE IF NOT EXISTS message_folders (
          id         SERIAL      PRIMARY KEY,
          user_id    INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name       VARCHAR(60) NOT NULL,
          parent_id  INTEGER     REFERENCES message_folders(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        ALTER TABLE message_recipients
          ADD COLUMN IF NOT EXISTS folder_id INTEGER REFERENCES message_folders(id) ON DELETE SET NULL;
      `);
    },
  },
  {
    version    : 68,
    description: 'Chat — editable sent messages (chat_messages.edited_at, shown as "edited")',
    up: async (client) => {
      await client.query(`
        ALTER TABLE chat_messages
          ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
      `);
    },
  },
  {
    version    : 69,
    description: 'Staff status change history (Officially Changes tab) — scheduled emp_status transitions',
    up: async (client) => {
      // Each row is one scheduled/effected status transition for a staff member.
      // Rows stay applied=FALSE until effective_date arrives; the employees API
      // sweeps due rows into users.emp_status/users.active on each list fetch.
      await client.query(`
        CREATE TABLE IF NOT EXISTS staff_status_changes (
          id             SERIAL       PRIMARY KEY,
          user_id        INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          from_status    VARCHAR(100),
          to_status      VARCHAR(100) NOT NULL,
          effective_date DATE         NOT NULL,
          remarks        TEXT,
          applied        BOOLEAN      DEFAULT FALSE,
          created_by     VARCHAR(100),
          created_at     TIMESTAMPTZ  DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_ssc_user    ON staff_status_changes(user_id);
        CREATE INDEX IF NOT EXISTS idx_ssc_pending ON staff_status_changes(applied, effective_date);
      `);
    },
  },
  {
    version    : 70,
    description: 'Officially Changes — track branch/post/department/mode/grade too, not just status',
    up: async (client) => {
      // Generalise v69's status-only table into one history table for every
      // officially-changeable field. `field` says which users column the row
      // transitions ('status' → emp_status+active, others map by name).
      await client.query(`
        ALTER TABLE staff_status_changes RENAME TO staff_official_changes;
        ALTER TABLE staff_official_changes RENAME COLUMN from_status TO from_value;
        ALTER TABLE staff_official_changes RENAME COLUMN to_status   TO to_value;
        ALTER TABLE staff_official_changes
          ADD COLUMN IF NOT EXISTS field VARCHAR(30) NOT NULL DEFAULT 'status';
        CREATE INDEX IF NOT EXISTS idx_soc_user_field ON staff_official_changes(user_id, field);
      `);
    },
  },
  {
    version    : 71,
    description: 'Fix staff delete — message/audit FKs had no ON DELETE rule, so DELETE FROM users silently 500ed',
    up: async (client) => {
      // Any staff who had ever received an internal message (or appeared as an
      // audit actor / leave approver / …) could not be deleted: the FK raised
      // 23503 and the UI still toasted "deleted successfully", so the rows
      // kept reappearing. Inbox copies + sent messages die with the user;
      // audit/approval references are kept with the user reference nulled.
      await client.query(`
        ALTER TABLE message_recipients
          DROP CONSTRAINT IF EXISTS message_recipients_recipient_id_fkey,
          ADD CONSTRAINT message_recipients_recipient_id_fkey
            FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE;

        ALTER TABLE internal_messages
          DROP CONSTRAINT IF EXISTS internal_messages_sender_id_fkey,
          ADD CONSTRAINT internal_messages_sender_id_fkey
            FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE;

        CREATE TABLE IF NOT EXISTS audit_log (
          id          SERIAL       PRIMARY KEY,
          actor_id    INTEGER      REFERENCES users(id),
          actor_role  VARCHAR(30),
          action      VARCHAR(50)  NOT NULL,
          entity      VARCHAR(50)  NOT NULL,
          entity_id   VARCHAR(50),
          before      JSONB,
          after       JSONB,
          created_at  TIMESTAMPTZ  DEFAULT NOW()
        );

        ALTER TABLE audit_log
          DROP CONSTRAINT IF EXISTS audit_log_actor_id_fkey,
          ADD CONSTRAINT audit_log_actor_id_fkey
            FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL;

        ALTER TABLE attendance_remarks
          DROP CONSTRAINT IF EXISTS attendance_remarks_created_by_fkey,
          ADD CONSTRAINT attendance_remarks_created_by_fkey
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

        ALTER TABLE leaves
          DROP CONSTRAINT IF EXISTS leaves_approved_by_fkey,
          ADD CONSTRAINT leaves_approved_by_fkey
            FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL;

        ALTER TABLE office_visits
          DROP CONSTRAINT IF EXISTS office_visits_approved_by_fkey,
          ADD CONSTRAINT office_visits_approved_by_fkey
            FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL;
      `);
    },
  },
  {
    version    : 72,
    description: 'Staff Identity tab — addresses, personal ID cards (with document image), emergency contacts',
    up: async (client) => {
      // Three per-staff collections behind Edit Staff → Staff Identity.
      // id_cards.doc_image is a data-URL (like users.profile_photo) so the
      // uploaded document ships inline with no separate file storage.
      await client.query(`
        CREATE TABLE IF NOT EXISTS staff_addresses (
          id           SERIAL       PRIMARY KEY,
          user_id      INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          country      VARCHAR(100),
          province     VARCHAR(100),
          district     VARCHAR(100),
          ward         VARCHAR(50),
          address_type VARCHAR(20)  NOT NULL DEFAULT 'Permanent',
          created_at   TIMESTAMPTZ  DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_staff_addresses_user ON staff_addresses(user_id);

        CREATE TABLE IF NOT EXISTS staff_id_cards (
          id          SERIAL       PRIMARY KEY,
          user_id     INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          id_name     VARCHAR(100) NOT NULL,
          id_number   VARCHAR(100) NOT NULL,
          expiry_date DATE,
          doc_image   TEXT,
          created_at  TIMESTAMPTZ  DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_staff_id_cards_user ON staff_id_cards(user_id);

        CREATE TABLE IF NOT EXISTS staff_emergency_contacts (
          id         SERIAL       PRIMARY KEY,
          user_id    INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name       VARCHAR(100) NOT NULL,
          contact1   VARCHAR(50),
          contact2   VARCHAR(50),
          relation   VARCHAR(50),
          address    TEXT,
          created_at TIMESTAMPTZ  DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_staff_emg_contacts_user ON staff_emergency_contacts(user_id);
      `);
    },
  },
  {
    version    : 73,
    description: 'users.email — normalize + enforce uniqueness within this tenant, needed for the shared-login directory to resolve one email to exactly one tenant. Warns instead of failing startup if this tenant still has real duplicates left to clean up by hand.',
    up: async (client) => {
      await client.query(`UPDATE users SET email = NULLIF(TRIM(LOWER(email)), '') WHERE email IS NOT NULL`);
      const { rows: dupes } = await client.query(`
        SELECT email, COUNT(*) AS n FROM users
        WHERE email IS NOT NULL GROUP BY email HAVING COUNT(*) > 1
      `);
      if (dupes.length) {
        console.warn(`[migration v73] Skipping users.email UNIQUE constraint — ${dupes.length} duplicate email(s) still exist in this tenant's data: ${dupes.map(d => `${d.email} (x${d.n})`).join(', ')}. Fix these staff records, then this constraint will apply on the next restart.`);
        return;
      }
      await client.query(`ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email)`);
    },
  },
  {
    version    : 74,
    description: 'attendance_notifications_sent — per-employee/date/check-type dedup for the attendance notification scheduler, now that Late In / Absent / Early Out each fire relative to that employee\'s own shift start/end instead of one global daily time. Guarantees each employee is only ever emailed once per check per day regardless of poll timing.',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS attendance_notifications_sent (
          id          SERIAL PRIMARY KEY,
          employee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          date        DATE NOT NULL,
          notif_type  VARCHAR(20) NOT NULL,
          sent_at     TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(employee_id, date, notif_type)
        );
      `);
    },
  },
  {
    version    : 75,
    description: 'Email Setup module toggle — same pattern as migration 47\'s Attendance Device/StandAlone Device flags, default OFF until the Super Admin enables it from User Rights.',
    up: async (client) => {
      await client.query(`
        INSERT INTO app_settings (key, value) VALUES
          ('module_email_setup_enabled', 'false')
        ON CONFLICT (key) DO NOTHING;
      `);
    },
  },
  {
    version    : 76,
    description: 'Duty Roster — Day Off / Night Off as real shift rows (shifts.is_off), so they\'re selectable in the roster shift picker exactly like a real shift and every report that already understands "this employee\'s roster shift today" only needs one extra check (is_off) to treat that day as a weekend/non-working day, instead of a separate parallel concept.',
    up: async (client) => {
      await client.query(`ALTER TABLE shifts ADD COLUMN IF NOT EXISTS is_off BOOLEAN NOT NULL DEFAULT false;`);
      await client.query(`
        INSERT INTO shifts (name, name_en, code, start_time, end_time, work_hours, is_off, color)
        SELECT 'Day Off', 'Day Off', 'DAY_OFF', '00:00:00', '00:00:00', 0, true, '#9ca3af'
        WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE code = 'DAY_OFF');
      `);
      await client.query(`
        INSERT INTO shifts (name, name_en, code, start_time, end_time, work_hours, is_off, color)
        SELECT 'Night Off', 'Night Off', 'NIGHT_OFF', '00:00:00', '00:00:00', 0, true, '#6b7280'
        WHERE NOT EXISTS (SELECT 1 FROM shifts WHERE code = 'NIGHT_OFF');
      `);
    },
  },
  {
    version    : 77,
    description: 'Duty Roster — shift_ids JSONB array column for multi-shift rotation (Create/Edit Roster can now check more than one shift for a date range; the roster resolves which shift applies on a given day by cycling through shift_ids in the order selected, starting at date_from). shift_id is kept in sync as shift_ids[0] so any older code path still reading the single column keeps working.',
    up: async (client) => {
      await client.query(`ALTER TABLE duty_roster ADD COLUMN IF NOT EXISTS shift_ids JSONB;`);
      await client.query(`
        UPDATE duty_roster SET shift_ids = jsonb_build_array(shift_id)
        WHERE shift_ids IS NULL AND shift_id IS NOT NULL;
      `);
    },
  },
  {
    version    : 78,
    description: 'Standalone devices — sync_token + last_sync_ping_at for the remote sync agent (site-side .exe that pushes attendance logs over the network instead of the loopback bridge Electron spawns).',
    up: async (client) => {
      await client.query(`
        ALTER TABLE standalone_devices
          ADD COLUMN IF NOT EXISTS sync_token        VARCHAR(64) UNIQUE,
          ADD COLUMN IF NOT EXISTS last_sync_ping_at  TIMESTAMPTZ;
      `);
    },
  },
  {
    version    : 79,
    description: 'leaves — recommended_date column (mirrors approved_date; the Edit Leave form has always had a Recommended Date field but there was nowhere to persist it, so it silently reverted to blank every time the record was reloaded).',
    up: async (client) => {
      await client.query(`ALTER TABLE leaves ADD COLUMN IF NOT EXISTS recommended_date DATE;`);
    },
  },
  {
    version    : 80,
    description: 'Backfill weekend_history from the legacy app_settings blob. Before weekend_history existed as its own table, Settings → Weekend Days only ever wrote to the generic app_settings "main" JSON blob via an optimistic-only save that silently succeeded locally even when nothing reached the server — every attendance report has always queried weekend_history directly (never the blob), so any tenant that configured a non-default weekend before the dedicated table + write-through save existed has had every report silently fall back to the hardcoded [\'Sat\'] default ever since, no matter what they actually set. This copies the blob\'s weekendHistory entries into the real table, once, whenever the table is still empty — a no-op if a tenant never customized weekends (their effective pattern was already [\'Sat\'] either way), a real fix if they did.',
    up: async (client) => {
      const { rows: existing } = await client.query('SELECT COUNT(*)::int AS n FROM weekend_history');
      if (existing[0].n > 0) return; // already has real data — nothing to backfill

      const { rows: mainRows } = await client.query(`SELECT value FROM app_settings WHERE key='main'`);
      const history = mainRows[0]?.value?.weekendHistory;
      if (!Array.isArray(history) || !history.length) return; // nothing in the blob either

      for (const h of history) {
        if (!Array.isArray(h.weekends) || !h.weekends.length || !h.effectiveDate) continue;
        await client.query(
          `INSERT INTO weekend_history (weekends, effective_date, changed_date, changed_by, reason)
           VALUES ($1::jsonb, $2, $3, $4, $5)`,
          [
            JSON.stringify(h.weekends),
            h.effectiveDate,
            h.changedDate || h.effectiveDate,
            h.changedBy || 'System',
            h.reason || 'Migrated from legacy settings',
          ],
        );
      }
    },
  },
  {
    version    : 81,
    description: 'branches — add ranking_order, mirroring departments/posts (v2). Lets an admin order branches (e.g. Head Office=1, a branch=2); combined with the existing per-staff ranking_order (v5, now interpreted as rank WITHIN a branch), staff lists across the app sort by branch order first, then staff order inside that branch. NULL (every pre-existing row) ties with every other NULL, so nothing re-sorts until an admin actually sets it.',
    up: async (client) => {
      await client.query(`ALTER TABLE branches ADD COLUMN IF NOT EXISTS ranking_order INTEGER;`);
    },
  },
  {
    version    : 82,
    description: 'overtime_approvals — leave_type_code + leave_days, for the "Provide Next Day Leave" OT-to-leave conversion (Overtime Approval page). A weekend/holiday "present" row under that rule can be granted N days (max 2, half-day steps) of a chosen leave type instead of paid OT minutes; these columns record what was granted, on which record, for audit.',
    up: async (client) => {
      await client.query(`
        ALTER TABLE overtime_approvals
          ADD COLUMN IF NOT EXISTS leave_type_code VARCHAR(10),
          ADD COLUMN IF NOT EXISTS leave_days      NUMERIC(4,1)
            CHECK (leave_days IS NULL OR (leave_days > 0 AND leave_days <= 2 AND leave_days * 2 = FLOOR(leave_days * 2)));
      `);
    },
  },
  {
    version    : 83,
    description: 'attendance_manual_postings — status/applied_date/comment, so a staff self-service "Inform Late In/Early Out" request sits pending (like Leave/Office Visit) until recommended+approved, instead of landing straight in real attendance data. Existing rows (all admin-entered, pre-dating this workflow) default to approved so today\'s reports keep reading exactly what they already did.',
    up: async (client) => {
      await client.query(`
        ALTER TABLE attendance_manual_postings
          ADD COLUMN IF NOT EXISTS status       VARCHAR(20) NOT NULL DEFAULT 'approved',
          ADD COLUMN IF NOT EXISTS applied_date DATE        NOT NULL DEFAULT CURRENT_DATE,
          ADD COLUMN IF NOT EXISTS approved_date DATE,
          ADD COLUMN IF NOT EXISTS comment      TEXT;
        UPDATE attendance_manual_postings SET status = 'approved' WHERE status IS NULL;
      `);
    },
  },
  {
    version    : 84,
    description: 'tasks — new Staff > Task feature: a customer-linked task/to-do tracker (Enquiry/Quotation/Support style follow-ups). task_categories and task_priorities are plain admin-configurable lookup lists (managed via the gear icon on the Task page, through the existing generic /api/settings/:list CRUD — see SETUP_TABLES in settings.js), seeded with sensible defaults; tasks itself references them plus staff_contacts (for "Customer Name") and users (assignee/creator).',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS task_categories (
          id            SERIAL       PRIMARY KEY,
          name          VARCHAR(100) NOT NULL,
          ranking_order INTEGER,
          created_at    TIMESTAMPTZ  DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS task_priorities (
          id            SERIAL       PRIMARY KEY,
          name          VARCHAR(50)  NOT NULL,
          color         VARCHAR(20),
          ranking_order INTEGER,
          created_at    TIMESTAMPTZ  DEFAULT NOW()
        );
        INSERT INTO task_categories (name, ranking_order)
          SELECT * FROM (VALUES ('Enquiry',1), ('Quotation',2), ('Support',3)) AS v(name, ranking_order)
          WHERE NOT EXISTS (SELECT 1 FROM task_categories);
        INSERT INTO task_priorities (name, color, ranking_order)
          SELECT * FROM (VALUES ('High','#dc2626',1), ('Medium','#f59e0b',2), ('Low','#22c55e',3)) AS v(name, color, ranking_order)
          WHERE NOT EXISTS (SELECT 1 FROM task_priorities);

        CREATE TABLE IF NOT EXISTS tasks (
          id           SERIAL       PRIMARY KEY,
          title        VARCHAR(255) NOT NULL,
          description  TEXT,
          contact_id   INTEGER      REFERENCES staff_contacts(id)  ON DELETE SET NULL,
          category_id  INTEGER      REFERENCES task_categories(id) ON DELETE SET NULL,
          priority_id  INTEGER      REFERENCES task_priorities(id) ON DELETE SET NULL,
          assigned_to  INTEGER      REFERENCES users(id) ON DELETE SET NULL,
          due_date     DATE,
          status       VARCHAR(20)  NOT NULL DEFAULT 'pending',
          created_by   INTEGER      REFERENCES users(id) ON DELETE SET NULL,
          created_at   TIMESTAMPTZ  DEFAULT NOW(),
          updated_at   TIMESTAMPTZ  DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to);
        CREATE INDEX IF NOT EXISTS idx_tasks_status   ON tasks(status);
      `);
    },
  },
  {
    version    : 85,
    description: 'tasks — contact_person_id, so a task against a company contact (which has no phone/mobile of its own) can point at one specific person from that company\'s Contact Persons sub-list (staff_contact_persons) instead of only the parent contact record.',
    up: async (client) => {
      await client.query(`
        ALTER TABLE tasks
          ADD COLUMN IF NOT EXISTS contact_person_id INTEGER REFERENCES staff_contact_persons(id) ON DELETE SET NULL;
      `);
    },
  },
  {
    version    : 86,
    description: 'task_assignees — Task page "Assign Task" now supports assigning a task to several staff at once (checkbox grid) instead of one. Replaces the single tasks.assigned_to column with a join table; any existing single assignment is carried over before the old column is dropped.',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS task_assignees (
          task_id  INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          PRIMARY KEY (task_id, user_id)
        );
        CREATE INDEX IF NOT EXISTS idx_task_assignees_user ON task_assignees(user_id);

        INSERT INTO task_assignees (task_id, user_id)
          SELECT id, assigned_to FROM tasks WHERE assigned_to IS NOT NULL
          ON CONFLICT DO NOTHING;

        DROP INDEX IF EXISTS idx_tasks_assigned;
        ALTER TABLE tasks DROP COLUMN IF EXISTS assigned_to;
      `);
    },
  },
  {
    version    : 87,
    description: 'task_followups — Task page right-side "Followup History" panel. Each row is one logged contact attempt (call/email/WhatsApp/SMS) against a task, who logged it (server-set from the session, not client-supplied), an optional next-followup date/time, and an optional hand-over to another staff member (which also adds that person to task_assignees, same as the checkbox grid would). Append-only log — no edit/delete route, matching how the UI only ever adds new entries.',
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS task_followups (
          id               SERIAL       PRIMARY KEY,
          task_id          INTEGER      NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          mode             VARCHAR(20)  NOT NULL CHECK (mode IN ('phone','email','whatsapp','sms')),
          followup_date    DATE         NOT NULL DEFAULT CURRENT_DATE,
          followed_by      INTEGER      REFERENCES users(id) ON DELETE SET NULL,
          description      TEXT,
          task_note        TEXT,
          next_followup_at TIMESTAMPTZ,
          handed_over_to   INTEGER      REFERENCES users(id) ON DELETE SET NULL,
          created_at       TIMESTAMPTZ  DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_task_followups_task ON task_followups(task_id);
      `);
    },
  },
  {
    version    : 88,
    description: 'task_followups.next_category_id — the followup form\'s "Task" free-text field became "Transfer for Next Task", a Task Category dropdown defaulting to the task\'s current category. Saving a followup with this set now also updates the parent task\'s own category_id (same non-destructive-side-effect pattern "Hand Over" already uses for task_assignees). The old task_note text column is left in place, unused going forward, rather than dropped — preserves any free-text values already entered on live tenants between v87 and this release instead of silently discarding them.',
    up: async (client) => {
      await client.query(`
        ALTER TABLE task_followups
          ADD COLUMN IF NOT EXISTS next_category_id INTEGER REFERENCES task_categories(id) ON DELETE SET NULL;
      `);
    },
  },
];

// ══════════════════════════════════════════════════════════
//  Runner — applies any pending migrations in order
// ══════════════════════════════════════════════════════════
export async function runMigrations() {
  const client = await pool.connect();
  try {
    // Bootstrap: ensure the version table exists before anything else
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_schema_version (
        id          SERIAL      PRIMARY KEY,
        version     INTEGER     NOT NULL,
        description TEXT,
        applied_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    const { rows } = await client.query(
      'SELECT COALESCE(MAX(version), 0)::int AS v FROM app_schema_version'
    );
    const current = rows[0].v;
    const pending = MIGRATIONS.filter(m => m.version > current);

    if (!pending.length) {
      console.log(`✅  DB schema up-to-date  (v${current})`);
      return current;
    }

    for (const m of pending) {
      await client.query('BEGIN');
      try {
        console.log(`⏳  Applying migration v${m.version}: ${m.description}`);
        await m.up(client);
        await client.query(
          'INSERT INTO app_schema_version (version, description) VALUES ($1, $2)',
          [m.version, m.description]
        );
        await client.query('COMMIT');
        console.log(`✅  Migration v${m.version} done`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
    return DB_VERSION;
  } finally {
    client.release();
  }
}

// ══════════════════════════════════════════════════════════
//  Data-level migration for backup restore
//  Transforms restored JSON rows from an older dbVersion
//  to the shape expected by the current schema.
// ══════════════════════════════════════════════════════════
export function migrateBackupData(data, fromVersion, toVersion) {
  let d = JSON.parse(JSON.stringify(data)); // deep clone
  for (let v = fromVersion + 1; v <= toVersion; v++) {
    d = applyDataMigration(d, v);
  }
  return d;
}

function applyDataMigration(data, toVersion) {
  switch (toVersion) {
    // Example future migration:
    // case 2:
    //   return {
    //     ...data,
    //     departments: (data.departments || []).map(d => ({ active: true, ...d })),
    //   };
    default:
      return data;
  }
}
