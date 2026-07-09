/**
 * Daily attendance notification digest — once per day (configurable trigger
 * time, default 18:00), emails:
 *   - Late In / Early Out: the staff member, their Dept. Head, their Branch
 *     Manager, and all Admins.
 *   - Absent: the staff member, their Dept. Head, and all Admins (no Branch
 *     Manager — per product decision).
 * Follows the same setInterval-poll + start()/stop() shape as
 * standaloneScheduler.js — the only other scheduled job in this codebase.
 */

import pool from '../db.js';
import { computeDailyAttendance } from '../routes/attendance.js';
import { getEmailConfig, sendLateEarlyDigest, sendAbsentDigest } from './emailService.js';
import { logError } from '../utils/logError.js';

const POLL_INTERVAL_MS = 5 * 60_000; // 5 minutes
const LAST_RUN_KEY = 'lastAttendanceDigestRun';
let timer = null;

async function getLastRunDate() {
  try {
    const { rows } = await pool.query('SELECT value FROM app_settings WHERE key=$1', [LAST_RUN_KEY]);
    if (!rows.length) return null;
    const v = rows[0].value;
    return typeof v === 'string' ? JSON.parse(v) : v;
  } catch {
    return null;
  }
}

async function setLastRunDate(dateStr) {
  await pool.query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()`,
    [LAST_RUN_KEY, JSON.stringify(dateStr)]
  );
}

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

  // 3. Branch Manager digest — grouped by branch (Late/Early only).
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

  // 4. Admin digest — company-wide.
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

export async function runDailyDigest(date) {
  const { rows } = await computeDailyAttendance(date);
  if (!rows.length) return;

  const ids = rows.map(r => r.id);
  const { rows: userRows } = await pool.query(
    `SELECT id, email, department, branch FROM users WHERE id = ANY($1::int[])`, [ids]
  );
  const userMap = new Map(userRows.map(u => [String(u.id), u]));

  const withOrg = (r) => ({ ...r, ...(userMap.get(String(r.id)) || {}) });

  const lateEarly = rows
    .filter(r => (r.lateIn?.startsWith('Late By')) || (r.earlyOut?.startsWith('Early Out')))
    .map(r => withOrg(r))
    .map(r => ({
      ...r,
      detail: [r.lateIn?.startsWith('Late By') ? r.lateIn : null, r.earlyOut?.startsWith('Early Out') ? r.earlyOut : null]
        .filter(Boolean).join(' / '),
    }));

  const absent = rows
    .filter(r => r.status === 'Absent')
    .map(r => withOrg(r))
    .map(r => ({ ...r, detail: 'Absent' }));

  await sendDigests({ date, occurrences: lateEarly, includeBranchManager: true,  sendFn: sendLateEarlyDigest, kindLabel: 'late-early' });
  await sendDigests({ date, occurrences: absent,    includeBranchManager: false, sendFn: sendAbsentDigest,    kindLabel: 'absent' });
}

async function tick() {
  try {
    const cfg = await getEmailConfig();
    const triggerTime = cfg?.dailyDigestTime || '18:00';
    const [trigH, trigM] = triggerTime.split(':').map(Number);

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const pastTrigger = now.getHours() > trigH || (now.getHours() === trigH && now.getMinutes() >= trigM);
    if (!pastTrigger) return;

    const lastRun = await getLastRunDate();
    if (lastRun === todayStr) return; // already ran today

    await runDailyDigest(todayStr);
    await setLastRunDate(todayStr);
  } catch (err) {
    logError('[attendance-notification-scheduler]', err);
  }
}

export function startAttendanceNotificationScheduler() {
  if (timer) return;
  timer = setInterval(tick, POLL_INTERVAL_MS);
  tick(); // check immediately in case we start up past today's trigger time
  console.log(`[attendance-notification-scheduler] daily digest checker started (every ${POLL_INTERVAL_MS / 1000}s)`);
}

export function stopAttendanceNotificationScheduler() {
  if (timer) { clearInterval(timer); timer = null; }
}
