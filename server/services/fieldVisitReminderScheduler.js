/**
 * Field Visit start reminder — on the day a field visit is due, if the assigned
 * staff member still hasn't started it (task still Pending, no stop recorded,
 * and no trip open), send a push: "tap to check out from office".
 *
 *   1st reminder  at/after REMIND_FROM  (09:30 Nepal time)
 *   2nd reminder  at/after REMIND_AGAIN (10:30 Nepal time) if STILL not started
 *
 * Each (employee, date, task, stage) is sent once — deduped through
 * attendance_notifications_sent (notif_type 'fv1_<taskId>' / 'fv2_<taskId>',
 * fits VARCHAR(20)), the same table the other schedulers use, so a restart
 * mid-morning can't double-send. One push per person per run (lists the count
 * when they have several). Needs FCM configured (pushEnabled); otherwise a no-op.
 */
import pool from '../db.js';
import { pushEnabled, sendPushToUsers } from './pushService.js';
import { logError } from '../utils/logError.js';

const POLL_INTERVAL_MS = 5 * 60_000;
const REMIND_FROM  = 9 * 60 + 30;    // minutes after Nepal midnight
const REMIND_AGAIN = 10 * 60 + 30;
const NEPAL_OFFSET_MS = (5 * 60 + 45) * 60 * 1000;

let timer = null;
let isRunning = false;

function nepalNow() {
  const n = new Date(Date.now() + NEPAL_OFFSET_MS);
  const pad = (x) => String(x).padStart(2, '0');
  return { date: `${n.getUTCFullYear()}-${pad(n.getUTCMonth() + 1)}-${pad(n.getUTCDate())}`, minutes: n.getUTCHours() * 60 + n.getUTCMinutes() };
}

async function claim(employeeId, date, type) {
  const { rows } = await pool.query(
    `INSERT INTO attendance_notifications_sent (employee_id, date, notif_type)
     VALUES ($1, $2, $3) ON CONFLICT (employee_id, date, notif_type) DO NOTHING RETURNING id`,
    [employeeId, date, type]);
  return rows.length > 0;
}

async function runCheck() {
  if (!pushEnabled()) return;
  const { date, minutes } = nepalNow();
  if (minutes < REMIND_FROM) return;

  // Due today, still Pending, assigned to an active user who has no open trip
  // and no stop on this task yet.
  const { rows } = await pool.query(
    `SELECT t.id AS "taskId", t.title, ta.user_id AS "userId"
     FROM tasks t
     JOIN task_assignees ta ON ta.task_id = t.id
     JOIN users u ON u.id = ta.user_id AND u.active = TRUE
     WHERE t.is_field_visit = TRUE AND t.status = 'pending' AND t.due_date = $1::date
       AND NOT EXISTS (SELECT 1 FROM field_visit_stops s WHERE s.task_id = t.id)
       AND NOT EXISTS (SELECT 1 FROM field_visit_sessions fs WHERE fs.employee_id = ta.user_id AND fs.status = 'active')`,
    [date]);
  if (!rows.length) return;

  const byUser = new Map();
  for (const r of rows) {
    let stage = null;
    if (await claim(r.userId, date, `fv1_${r.taskId}`)) stage = 1;
    else if (minutes >= REMIND_AGAIN && await claim(r.userId, date, `fv2_${r.taskId}`)) stage = 2;
    if (!stage) continue;
    if (!byUser.has(r.userId)) byUser.set(r.userId, { stage, titles: [] });
    const u = byUser.get(r.userId);
    u.stage = Math.max(u.stage, stage);
    u.titles.push(r.title);
  }

  for (const [userId, { stage, titles }] of byUser) {
    const body = titles.length === 1
      ? `${titles[0]} — tap to check out from office`
      : `${titles.length} field visits today — tap to start (check out from office)`;
    await sendPushToUsers([userId], {
      title: stage === 2 ? '🚗 Reminder: Field visit not started' : '🚗 Field visit today',
      body, data: { path: '/staff/field-visit' },
    });
  }
}

async function tick() {
  if (isRunning) return;
  isRunning = true;
  try { await runCheck(); } catch (err) { logError('[field-visit-reminder-scheduler]', err); } finally { isRunning = false; }
}

export function startFieldVisitReminderScheduler() {
  if (timer) return;
  timer = setInterval(tick, POLL_INTERVAL_MS);
  setTimeout(tick, 30_000);   // first check shortly after boot, not on the boot path itself
  console.log(`[field-visit-reminder-scheduler] started (every ${POLL_INTERVAL_MS / 1000}s)`);
}

export function stopFieldVisitReminderScheduler() {
  if (timer) { clearInterval(timer); timer = null; }
}
