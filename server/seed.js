/**
 * Seed script — populates the database with initial sample data.
 * Run once after first migration: node seed.js
 */
import pool from './db.js';
import { runMigrations } from './migrations/runner.js';

async function seed() {
  console.log('🌱 Running migrations...');
  await runMigrations();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    /* ── Users ── */
    await client.query(`
      INSERT INTO users (employee_id,username,password,full_name,role,department,position,shift,email,phone,join_date,gender,avatar,active,is_system)
      VALUES
        ('SUPERADMIN001','admin@planetinfosys.com.np','#28O29@9837','System Super Administrator','superAdmin','Administration','System Super Administrator','day','admin@planetinfosys.com.np','9841000000','2020-01-01','male','S',TRUE,TRUE),
        ('ADMIN001','admin@ehajiritms.com','@dmin','Administrator','admin','Administration','System Administrator','day','admin@ehajiritms.com','9841000001','2020-01-01','male','A',TRUE,FALSE)
      ON CONFLICT (username) DO NOTHING
    `);

    /* ── Shifts ── */
    await client.query(`
      INSERT INTO shifts (name,name_en,code,start_time,end_time,work_hours,grace_period_start,grace_period_end,make_default,active,color,exceptional_day_enabled,exceptional_days,winter_policy_enabled)
      VALUES
        ('बिहान सिफ्ट','Morning Shift','morning','06:00','14:00',8,5,5,FALSE,TRUE,'#e3a008',FALSE,'[]',FALSE),
        ('दिउँसो सिफ्ट','Day Shift',   'day',    '09:00','17:00',9,15,0,TRUE, TRUE,'#1a56db',FALSE,'[]',FALSE),
        ('बेलुकी सिफ्ट','Evening Shift','evening','14:00','22:00',8,5,5,FALSE,TRUE,'#7e3af2',FALSE,'[]',FALSE),
        ('राति सिफ्ट', 'Night Shift',  'night',  '22:00','06:00',8,10,10,FALSE,FALSE,'#111827',FALSE,'[]',FALSE)
      ON CONFLICT (code) DO NOTHING
    `);

    /* ── Leave Types ── */
    await client.query(`
      INSERT INTO leave_types (name,code,total_days,color,name_en) VALUES
        ('वार्षिक बिदा', 'AL',20,'#0e9f6e','Annual Leave'),
        ('बिरामी बिदा',  'SL',12,'#3f83f8','Sick Leave'),
        ('आकस्मिक बिदा','CL',6, '#ff5a1f','Casual Leave'),
        ('मातृत्व बिदा', 'ML',98,'#e74694','Maternity Leave'),
        ('पितृत्व बिदा', 'PL',15,'#7e3af2','Paternity Leave')
      ON CONFLICT (code) DO NOTHING
    `);

    /* ── Leave Balances ── */
    const emps = (await client.query('SELECT id FROM users ORDER BY id')).rows;
    if (emps.length >= 5) {
      const balances = [
        [emps[0].id,'AL',20],[emps[0].id,'SL',12],[emps[0].id,'CL',6],[emps[0].id,'PL',15],
        [emps[1].id,'AL',18],[emps[1].id,'SL',10],[emps[1].id,'CL',5],[emps[1].id,'ML',98],
        [emps[2].id,'AL',17],[emps[2].id,'SL',12],[emps[2].id,'CL',4],[emps[2].id,'PL',15],
        [emps[3].id,'AL',19],[emps[3].id,'SL',11],[emps[3].id,'CL',6],
        [emps[4].id,'AL',20],[emps[4].id,'SL',12],[emps[4].id,'CL',6],[emps[4].id,'PL',15],
      ];
      for (const [eid,code,bal] of balances) {
        await client.query(
          `INSERT INTO leave_balances (employee_id,leave_type_code,balance) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [eid,code,bal]
        );
      }
    }

    /* ── Departments ── */
    await client.query(`
      INSERT INTO departments (name,short_name,ranking_order,is_default,is_system) VALUES
        ('Administration','Admin',1,TRUE,TRUE)
      ON CONFLICT DO NOTHING
    `);

    /* ── Posts ── */
    await client.query(`
      INSERT INTO posts (name,short_name,ranking_order,is_default,is_system) VALUES
        ('General Manager','GM',1,TRUE,TRUE)
      ON CONFLICT DO NOTHING
    `);

    /* ── Employment Modes ── */
    await client.query(`
      INSERT INTO employment_modes (name,is_default,is_system) VALUES
        ('Permanent',TRUE,TRUE),('Temporary',FALSE,FALSE),('Contract',FALSE,FALSE)
      ON CONFLICT DO NOTHING
    `);

    /* ── Religions ── */
    await client.query(`
      INSERT INTO religions (name,is_default,is_system) VALUES
        ('Hindu',TRUE,TRUE),('Buddhist',FALSE,TRUE),('Christian',FALSE,TRUE),('Muslim',FALSE,TRUE)
      ON CONFLICT DO NOTHING
    `);

    /* ── Employee Statuses ── */
    await client.query(`
      INSERT INTO employee_statuses (name,status_type,is_default,is_system) VALUES
        ('Active','Working',TRUE,TRUE)
      ON CONFLICT DO NOTHING
    `);

    /* ── Job Timings ── */
    await client.query(`
      INSERT INTO job_timings (name,is_default,is_system) VALUES
        ('Full Time',TRUE,TRUE),('Part Time',FALSE,TRUE)
      ON CONFLICT DO NOTHING
    `);

    /* ── Fiscal Years ── */
    // Delete existing fiscal years if any and insert fresh defaults
    await client.query('DELETE FROM fiscal_years WHERE is_system = TRUE');
    await client.query(`
      INSERT INTO fiscal_years (name,start_date,end_date,is_default,is_system) VALUES
        ('FY 2081/082','2024-04-14','2025-04-13',FALSE,TRUE),
        ('FY 2082/083','2025-04-14','2026-04-13',TRUE,TRUE),
        ('FY 2083/084','2026-04-14','2027-04-13',FALSE,TRUE)
    `);

    /* ── Weekend History ── */
    await client.query(`
      INSERT INTO weekend_history (weekends,effective_date,changed_date,changed_by,reason)
      VALUES ('["Sat"]','2026-01-01','2025-12-15','System','Initial Setup')
      ON CONFLICT DO NOTHING
    `);

    /* ── App Settings ── */
    const defaultSettings = {
      companyNameNp    : 'eHajiri कम्पनी प्रा.लि.',
      companyNameEn    : 'eHajiri Company Pvt. Ltd.',
      companyAddressNp : 'काठमाडौं, नेपाल',
      companyAddressEn : 'Kathmandu, Nepal',
      companyPhone     : '01-4567890',
      companyEmail     : 'info@ehajiri.com.np',
      companyWebsite   : 'www.ehajiri.com.np',
      defaultCalendar  : 'np',
      defaultDateFormat: 'dd-MMMM-YYYY',
      nepaliDigits     : false,
      defaultWeekends  : ['Sat'],
      weekendStartDate : '2026-06-08',
    };
    await client.query(
      `INSERT INTO app_settings (key,value) VALUES ('main',$1)
       ON CONFLICT (key) DO UPDATE SET value=$1`,
      [JSON.stringify(defaultSettings)]
    );

    await client.query('COMMIT');
    console.log('✅ Database seeded successfully!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Seed failed:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
