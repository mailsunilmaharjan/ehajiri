/**
 * Upcoming-birthday alerts — checks once a day for any active staff member
 * whose birthday falls `birthdayAlertDays` (default 2) from today, and
 * emails a heads-up to their Department Head, Branch Manager, and all
 * Admins (not the birthday person themselves — this is a heads-up to the
 * org, same three recipient groups the attendance notifications already use).
 *
 * Every (employee, target-date) pair is only ever sent once — reuses
 * attendance_notifications_sent (notif_type='birthday') the same way the
 * attendance scheduler dedupes Late In/Absent/Early Out, so a year's
 * birthday can't double-send even if this scheduler restarts mid-day.
 *
 * Dates are compared as plain calendar month/day (dob's AD month/day vs.
 * today+N's AD month/day) — no BS calendar conversion here, since the
 * server has no BS_DATA table (that lives in the frontend's dateUtils.js).
 * A birthday stored on Feb 29 simply won't match in a non-leap year — an
 * accepted, uncommon edge case rather than special-cased.
 */

import pool from '../db.js';
import { getEmailConfig, sendBirthdayAlert } from './emailService.js';
import { logError } from '../utils/logError.js';

const POLL_INTERVAL_MS = 60 * 60_000; // hourly — a calendar-date check needs nowhere near 5-min granularity
let timer = null;
let isRunning = false;

async function getAdmins() {
  const { rows } = await pool.query(
    `SELECT id, email, full_name AS "fullName" FROM users
     WHERE active=TRUE AND role IN ('admin','superAdmin') AND email IS NOT NULL AND email != ''`
  );
  return rows;
}

async function getDeptHeads(department) {
  if (!department) return [];
  const { rows } = await pool.query(
    `SELECT id, email, full_name AS "fullName" FROM users
     WHERE active=TRUE AND role='departmentHead' AND department=$1 AND email IS NOT NULL AND email != ''`,
    [department]
  );
  return rows;
}

async function getBranchManagers(branch) {
  if (!branch) return [];
  const { rows } = await pool.query(
    `SELECT id, email, full_name AS "fullName" FROM users
     WHERE active=TRUE AND role='branchManager' AND branch=$1 AND email IS NOT NULL AND email != ''`,
    [branch]
  );
  return rows;
}

// Claims (employee, target-date) for the 'birthday' notif type — returns
// true only if this call is the one that actually inserted the row.
async function claimNotification(employeeId, dateStr) {
  const { rows } = await pool.query(
    `INSERT INTO attendance_notifications_sent (employee_id, date, notif_type)
     VALUES ($1, $2, 'birthday') ON CONFLICT (employee_id, date, notif_type) DO NOTHING
     RETURNING id`,
    [employeeId, dateStr]
  );
  return rows.length > 0;
}

async function runCheck() {
  const cfg = await getEmailConfig();
  if (!cfg?.notifications?.birthdayNotification) return;
  const advanceDays = Number(cfg?.birthdayAlertDays) || 2;

  const today  = new Date();
  const target = new Date(today.getFullYear(), today.getMonth(), today.getDate() + advanceDays);
  const targetMonth = target.getMonth() + 1;
  const targetDay   = target.getDate();
  const targetDateStr = `${target.getFullYear()}-${String(targetMonth).padStart(2,'0')}-${String(targetDay).padStart(2,'0')}`;
  const targetLabel = target.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  const { rows: candidates } = await pool.query(
    `SELECT id, full_name AS "fullName", email, department, branch
     FROM users
     WHERE active=TRUE AND dob IS NOT NULL
       AND EXTRACT(MONTH FROM dob) = $1 AND EXTRACT(DAY FROM dob) = $2`,
    [targetMonth, targetDay]
  );
  if (!candidates.length) return;

  const claimed = [];
  for (const c of candidates) {
    // Dedup key is (employee, target calendar date) — the same person's
    // birthday next year lands on a different targetDateStr and sends fine.
    if (await claimNotification(c.id, targetDateStr)) claimed.push(c);
  }
  if (!claimed.length) return;

  const send = async (to, fullName, scopeLabel, occs) => {
    try {
      await sendBirthdayAlert({ to, fullName, scopeLabel, rows: occs.map(o => ({ name: o.fullName, detail: targetLabel })) });
    } catch (err) {
      logError('[birthday-notification-scheduler send]', err);
    }
  };

  const byDept = new Map();
  const byBranch = new Map();
  for (const occ of claimed) {
    if (occ.department) {
      if (!byDept.has(occ.department)) byDept.set(occ.department, []);
      byDept.get(occ.department).push(occ);
    }
    if (occ.branch) {
      if (!byBranch.has(occ.branch)) byBranch.set(occ.branch, []);
      byBranch.get(occ.branch).push(occ);
    }
  }

  for (const [department, occs] of byDept) {
    for (const head of await getDeptHeads(department)) await send(head.email, head.fullName, department, occs);
  }
  for (const [branch, occs] of byBranch) {
    for (const mgr of await getBranchManagers(branch)) await send(mgr.email, mgr.fullName, branch, occs);
  }
  for (const admin of await getAdmins()) await send(admin.email, admin.fullName, 'the company', claimed);
}

async function tick() {
  if (isRunning) return;
  isRunning = true;
  try {
    await runCheck();
  } catch (err) {
    logError('[birthday-notification-scheduler]', err);
  } finally {
    isRunning = false;
  }
}

export function startBirthdayNotificationScheduler() {
  if (timer) return;
  timer = setInterval(tick, POLL_INTERVAL_MS);
  tick(); // check immediately on startup too
  console.log(`[birthday-notification-scheduler] started (every ${POLL_INTERVAL_MS / 1000}s)`);
}

export function stopBirthdayNotificationScheduler() {
  if (timer) { clearInterval(timer); timer = null; }
}
