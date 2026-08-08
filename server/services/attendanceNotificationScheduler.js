/**
 * Attendance notification checks — each fires relative to an employee's own
 * shift, not one global daily time (different shifts start at different
 * hours, so a single company-wide trigger time never fit):
 *   - Late In:   `lateInGraceMinutes`   (default 30) after shift start.
 *   - Absent:    `absentGraceMinutes`   (default 60) after shift start.
 *   - Early Out: `earlyOutGraceMinutes` (default 15) after shift end.
 * Each check emails the staff member, their Dept. Head, and all Admins;
 * Late In and Early Out also email the Branch Manager (Absent doesn't, per
 * product decision). Every (employee, date, check type) combination is only
 * ever sent once — enforced by a UNIQUE constraint in
 * attendance_notifications_sent, claimed via INSERT ... ON CONFLICT DO
 * NOTHING before a candidate is included in any batch, so re-polling the
 * same employee on later ticks never re-sends.
 *
 * Follows the same setInterval-poll + start()/stop() shape as
 * standaloneScheduler.js — the only other scheduled job in this codebase.
 */

import pool from '../db.js';
import { computeDailyAttendance, shiftToUTC } from '../routes/attendance.js';
import { getEmailConfig, sendLateInDigest, sendEarlyOutDigest, sendAbsentDigest } from './emailService.js';
import { logError } from '../utils/logError.js';

const POLL_INTERVAL_MS = 5 * 60_000; // 5 minutes
let timer = null;
// A run can take a while (each email opens its own SMTP connection, no
// pooling) — without this, a still-running tick could overlap the next
// poll and attempt to claim/send the same batch twice.
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

// Claims (employee, date, notifType) for sending — returns true only if this
// call is the one that actually inserted the row (i.e. it hasn't already
// been sent today), false if another tick already claimed it.
async function claimNotification(employeeId, date, notifType) {
  const { rows } = await pool.query(
    `INSERT INTO attendance_notifications_sent (employee_id, date, notif_type)
     VALUES ($1, $2, $3) ON CONFLICT (employee_id, date, notif_type) DO NOTHING
     RETURNING id`,
    [employeeId, date, notifType]
  );
  return rows.length > 0;
}

/** Sends one personal email + grouped digests to Dept Head(s)/Branch Manager(s)/Admins. */
async function sendDigests({ date, occurrences, includeBranchManager, sendFn, kindLabel }) {
  if (!occurrences.length) return;

  // 1. Personal email — one per affected employee, their own occurrence only.
  for (const occ of occurrences) {
    if (!occ.email) continue;
    try {
      await sendFn({
        to: occ.email, fullName: occ.fullName, isSelf: true,
        scopeLabel: null, date, rows: [{ name: occ.fullName, detail: occ.detail }],
      });
    } catch (err) {
      logError(`[attendance-digest self:${kindLabel}]`, err);
    }
  }

  // 2. Department Head digest — grouped by department.
  const byDept = new Map();
  for (const occ of occurrences) {
    if (!occ.department) continue;
    if (!byDept.has(occ.department)) byDept.set(occ.department, []);
    byDept.get(occ.department).push(occ);
  }
  for (const [department, occs] of byDept) {
    const heads = await getDeptHeads(department);
    for (const head of heads) {
      try {
        await sendFn({
          to: head.email, fullName: head.fullName, isSelf: false, scopeLabel: department,
          date, rows: occs.map(o => ({ name: o.fullName, detail: o.detail })),
        });
      } catch (err) {
        logError(`[attendance-digest dept-head:${kindLabel}]`, err);
      }
    }
  }

  // 3. Branch Manager digest — grouped by branch (Late In / Early Out only).
  if (includeBranchManager) {
    const byBranch = new Map();
    for (const occ of occurrences) {
      if (!occ.branch) continue;
      if (!byBranch.has(occ.branch)) byBranch.set(occ.branch, []);
      byBranch.get(occ.branch).push(occ);
    }
    for (const [branch, occs] of byBranch) {
      const managers = await getBranchManagers(branch);
      for (const mgr of managers) {
        try {
          await sendFn({
            to: mgr.email, fullName: mgr.fullName, isSelf: false, scopeLabel: branch,
            date, rows: occs.map(o => ({ name: o.fullName, detail: o.detail })),
          });
        } catch (err) {
          logError(`[attendance-digest branch-mgr:${kindLabel}]`, err);
        }
      }
    }
  }

  // 4. Admin digest — company-wide, but scoped to this batch (whoever just
  // crossed the threshold on this tick), not the whole day at once.
  const admins = await getAdmins();
  for (const admin of admins) {
    try {
      await sendFn({
        to: admin.email, fullName: admin.fullName, isSelf: false, scopeLabel: 'the company',
        date, rows: occurrences.map(o => ({ name: o.fullName, detail: o.detail })),
      });
    } catch (err) {
      logError(`[attendance-digest admin:${kindLabel}]`, err);
    }
  }
}

// Resolves a row's shift start/end into real UTC Date objects for `date`,
// mirroring attendance.js's own overnight-shift handling — returns nulls if
// no shift resolved (no roster/employee/default shift — nothing to be
// relative to, so this employee is skipped by all three checks).
function resolveShiftWindow(row, Y, M, D) {
  if (!row.shiftStart || !row.shiftEnd) return { sDt: null, eDt: null };
  const [sH, sM] = row.shiftStart.toString().split(':').map(Number);
  const [eH, eM] = row.shiftEnd.toString().split(':').map(Number);
  const sDt = shiftToUTC(Y, M, D, sH, sM);
  const eDt = shiftToUTC(Y, M, D, eH, eM);
  if (eDt <= sDt) eDt.setUTCDate(eDt.getUTCDate() + 1); // overnight shift
  return { sDt, eDt };
}

async function buildOccurrences(candidates) {
  if (!candidates.length) return [];
  const ids = candidates.map(c => c.id);
  const { rows } = await pool.query(`SELECT id, email FROM users WHERE id = ANY($1::int[])`, [ids]);
  const emailById = new Map(rows.map(r => [r.id, r.email]));
  return candidates.map(c => ({
    id: c.id, email: emailById.get(c.id), fullName: c.fullName,
    department: c.deptFull, branch: c.branchName, detail: c.detail,
  }));
}

async function runChecks(date) {
  const { rows } = await computeDailyAttendance(date);
  if (!rows.length) return;

  const cfg = await getEmailConfig();
  const lateInGrace   = Number(cfg?.lateInGraceMinutes)   || 30;
  const absentGrace   = Number(cfg?.absentGraceMinutes)   || 60;
  const earlyOutGrace = Number(cfg?.earlyOutGraceMinutes) || 15;

  const [Y, M, D] = date.split('-').map(Number);
  const now = new Date();

  const lateInDue = [], absentDue = [], earlyOutDue = [];
  for (const r of rows) {
    const { sDt, eDt } = resolveShiftWindow(r, Y, M, D);
    if (!sDt || !eDt) continue; // no shift resolved — nothing to check against

    if (r.lateIn?.startsWith('Late By') && now >= new Date(sDt.getTime() + lateInGrace * 60000)) {
      lateInDue.push({ ...r, detail: r.lateIn });
    }
    if (r.status === 'Absent' && now >= new Date(sDt.getTime() + absentGrace * 60000)) {
      absentDue.push({ ...r, detail: 'Absent' });
    }
    if (r.earlyOut?.startsWith('Early Out') && now >= new Date(eDt.getTime() + earlyOutGrace * 60000)) {
      earlyOutDue.push({ ...r, detail: r.earlyOut });
    }
  }

  // Claim each candidate — only genuinely-new ones (not already sent today) survive.
  const claim = async (list, notifType) => {
    const claimed = [];
    for (const c of list) {
      if (await claimNotification(c.id, date, notifType)) claimed.push(c);
    }
    return claimed;
  };

  const [lateInNew, absentNew, earlyOutNew] = await Promise.all([
    claim(lateInDue,   'late_in'),
    claim(absentDue,   'absent'),
    claim(earlyOutDue, 'early_out'),
  ]);

  await sendDigests({
    date, occurrences: await buildOccurrences(lateInNew), includeBranchManager: true,
    sendFn: sendLateInDigest, kindLabel: 'late-in',
  });
  await sendDigests({
    date, occurrences: await buildOccurrences(absentNew), includeBranchManager: false,
    sendFn: sendAbsentDigest, kindLabel: 'absent',
  });
  await sendDigests({
    date, occurrences: await buildOccurrences(earlyOutNew), includeBranchManager: true,
    sendFn: sendEarlyOutDigest, kindLabel: 'early-out',
  });
}

async function tick() {
  if (isRunning) return;
  isRunning = true;
  try {
    const todayStr = new Date().toISOString().split('T')[0];
    await runChecks(todayStr);
  } catch (err) {
    logError('[attendance-notification-scheduler]', err);
  } finally {
    isRunning = false;
  }
}

export function startAttendanceNotificationScheduler() {
  if (timer) return;
  timer = setInterval(tick, POLL_INTERVAL_MS);
  tick(); // check immediately on startup too
  console.log(`[attendance-notification-scheduler] shift-relative checker started (every ${POLL_INTERVAL_MS / 1000}s)`);
}

export function stopAttendanceNotificationScheduler() {
  if (timer) { clearInterval(timer); timer = null; }
}
