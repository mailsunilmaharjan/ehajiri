import { Router } from 'express';
import pool from '../db.js';
import { loadRosterMap, getEffectiveRoster } from './attendance.js';
import { logAudit } from '../services/auditLog.js';
import { notifyUsers } from '../services/internalMessages.js';

/* Duty Exchange — a staff member asks to swap duty for ONE day with a colleague.
   Chain: the requester's Department Head recommends, then an Admin approves. On final approval both people's duty
   for that day is swapped (single-day roster rows, exactly what the website's Calendar View "Exchange Duty" writes).
   Everyone involved is told through the inbox + phone push (path /m/roster?tab=exchange). */
const router = Router();
const DAY_KEYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const todayNepal = () => new Date(Date.now() + (5 * 60 + 45) * 60000).toISOString().slice(0, 10);
const isAdminRole = (r) => r === 'admin' || r === 'superAdmin';
const PATH = '/m/roster?tab=exchange';

/** What a person works on one date: { off:true } for a weekend, { ids:[…], label } for shift(s), null when nothing is rostered. */
function dutyOf(map, empId, date) {
  const eff = getEffectiveRoster(map, empId, date);
  if (!eff) return null;
  const dayKey = DAY_KEYS[new Date(date + 'T00:00:00Z').getUTCDay()];
  if (eff.hasExactEntry && (eff.offDays || []).includes(dayKey)) return { off: true, label: 'Weekend' };
  const ids = eff.duties ? eff.duties.map(d => d.id) : (eff.shiftId ? [eff.shiftId] : []);
  if (!ids.length) return null;
  return { ids, label: String(eff.shiftName || '').replace(/\n/g, ' + '), isOff: !!eff.isOff };
}

async function writeDay(client, empId, date, duty, by) {
  if (duty.off) {
    await client.query(`
      INSERT INTO duty_roster (employee_id, shift_id, shift_ids, date_from, date_to, off_days, created_by)
      VALUES ($1, NULL, '[]', $2, $2, $3, $4)
      ON CONFLICT (employee_id, date_from) WHERE date_from = date_to
      DO UPDATE SET shift_id = NULL, shift_ids = '[]', off_days = EXCLUDED.off_days`,
    [empId, date, JSON.stringify([DAY_KEYS[new Date(date + 'T00:00:00Z').getUTCDay()]]), by]);
  } else {
    await client.query(`
      INSERT INTO duty_roster (employee_id, shift_id, shift_ids, date_from, date_to, off_days, created_by)
      VALUES ($1, $2, $3, $4, $4, '[]', $5)
      ON CONFLICT (employee_id, date_from) WHERE date_from = date_to
      DO UPDATE SET shift_id = EXCLUDED.shift_id, shift_ids = EXCLUDED.shift_ids, off_days = '[]'`,
    [empId, duty.ids[0], JSON.stringify(duty.ids), date, by]);
  }
}

const SEL = `
  SELECT x.id, x.requester_id AS "requesterId", ru.full_name AS "requesterName", ru.department AS "requesterDepartment",
         x.partner_id AS "partnerId", pu.full_name AS "partnerName",
         x.duty_date::text AS "date", x.requester_duty AS "requesterDuty", x.partner_duty AS "partnerDuty",
         x.reason, x.status,
         x.recommended_by AS "recommendedBy", rcu.full_name AS "recommendedByName", x.recommended_at AS "recommendedAt", x.recommend_comment AS "recommendComment",
         x.approved_by AS "approvedBy", apu.full_name AS "approvedByName", x.approved_at AS "approvedAt", x.approve_comment AS "approveComment",
         x.rejected_by AS "rejectedBy", x.reject_comment AS "rejectComment", x.created_at AS "createdAt"
  FROM duty_exchange_requests x
  JOIN users ru ON ru.id = x.requester_id
  JOIN users pu ON pu.id = x.partner_id
  LEFT JOIN users rcu ON rcu.id = x.recommended_by
  LEFT JOIN users apu ON apu.id = x.approved_by`;

/** Active Department Head(s) of that person's department (same branch when both have one). */
async function headsOf(user) {
  if (!user.department) return [];
  const { rows } = await pool.query(
    `SELECT id FROM users WHERE role='departmentHead' AND active = TRUE AND department = $1
       AND ($2::text IS NULL OR $2 = '' OR branch IS NULL OR branch = '' OR branch = $2) AND id <> $3`,
    [user.department, user.branch || null, user.id]);
  return rows.map(r => r.id);
}
const adminIds = async (exceptId) => (await pool.query(
  `SELECT id FROM users WHERE role IN ('admin','superAdmin') AND active = TRUE AND id <> $1`, [exceptId || 0])).rows.map(r => r.id);

/** What may the logged-in user do with this request right now? */
async function myRights(me, r) {
  const requester = (await pool.query('SELECT id, department, branch FROM users WHERE id=$1', [r.requesterId])).rows[0];
  const heads = await headsOf(requester);
  const iAmHead = me.role === 'departmentHead' && heads.includes(me.id);
  const admin = isAdminRole(me.role);
  const noHead = heads.length === 0;
  return {
    canRecommend: r.status === 'pending' && (iAmHead || (admin && noHead)) && me.id !== r.requesterId && me.id !== r.partnerId,
    canApprove: (r.status === 'recommended' || (r.status === 'pending' && noHead)) && admin && me.id !== r.requesterId && me.id !== r.partnerId,
    canReject: ['pending', 'recommended'].includes(r.status) && (iAmHead || admin) && me.id !== r.requesterId && me.id !== r.partnerId,
  };
}

/* Colleagues I can swap with on a date (same department), with what they work that day. */
router.get('/candidates', async (req, res) => {
  const date = String(req.query.date || '');
  if (!ISO.test(date)) return res.status(400).json({ error: 'date required' });
  try {
    const me = (await pool.query('SELECT id, department, branch FROM users WHERE id=$1', [req.user.id])).rows[0];
    if (!me?.department) return res.json([]);
    const { rows } = await pool.query(
      `SELECT id, full_name AS "fullName", position FROM users
        WHERE active = TRUE AND id <> $1 AND department = $2 AND ($3::text IS NULL OR $3 = '' OR branch = $3) ORDER BY full_name`,
      [me.id, me.department, me.branch || null]);
    const map = await loadRosterMap(date, date);
    res.json(rows.map(u => ({ ...u, duty: dutyOf(map, u.id, date) })).filter(u => u.duty));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* My own requests (as requester or as the colleague) — newest first. */
router.get('/mine', async (req, res) => {
  try {
    const { rows } = await pool.query(`${SEL} WHERE x.requester_id = $1 OR x.partner_id = $1 ORDER BY x.created_at DESC LIMIT 100`, [req.user.id]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* Requests waiting for me to recommend / approve (Department Head → their department; Admin → everything awaiting approval). */
router.get('/pending', async (req, res) => {
  try {
    if (req.user.role !== 'departmentHead' && !isAdminRole(req.user.role)) return res.json([]);
    const { rows } = await pool.query(`${SEL} WHERE x.status IN ('pending','recommended') ORDER BY x.created_at ASC LIMIT 200`);
    const out = [];
    for (const r of rows) { const rights = await myRights(req.user, r); if (rights.canRecommend || rights.canApprove || rights.canReject) out.push({ ...r, ...rights }); }
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
  const { partnerId, date, reason } = req.body || {};
  if (!ISO.test(String(date || '')) || !Number.isInteger(Number(partnerId))) return res.status(400).json({ error: 'Choose a colleague and a date.' });
  if (date < todayNepal()) return res.status(400).json({ error: 'Pick today or a future date.' });
  if (Number(partnerId) === req.user.id) return res.status(400).json({ error: 'Choose a different person.' });
  try {
    const me = (await pool.query('SELECT id, full_name, department, branch FROM users WHERE id=$1', [req.user.id])).rows[0];
    const partner = (await pool.query('SELECT id, full_name, department, branch FROM users WHERE id=$1 AND active = TRUE', [partnerId])).rows[0];
    if (!partner) return res.status(404).json({ error: 'Colleague not found.' });
    const dup = await pool.query(
      `SELECT 1 FROM duty_exchange_requests WHERE duty_date=$1 AND status IN ('pending','recommended')
         AND (requester_id = ANY($2::int[]) OR partner_id = ANY($2::int[])) LIMIT 1`, [date, [me.id, partner.id]]);
    if (dup.rows.length) return res.status(409).json({ error: 'One of you already has an exchange waiting for that day.' });
    const map = await loadRosterMap(date, date);
    const a = dutyOf(map, me.id, date), b = dutyOf(map, partner.id, date);
    if (!a || !b) return res.status(400).json({ error: 'Both of you need a duty roster on that day.' });
    const { rows: [row] } = await pool.query(
      `INSERT INTO duty_exchange_requests (requester_id, partner_id, duty_date, requester_duty, partner_duty, reason)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [me.id, partner.id, date, a.label, b.label, String(reason || '').slice(0, 500)]);
    const heads = await headsOf(me);
    const reviewers = heads.length ? heads : await adminIds(me.id);
    const text = `${me.full_name} wants to exchange duty with ${partner.full_name} on ${date} (${a.label} ⇄ ${b.label}).`;
    notifyUsers({ senderId: me.id, recipientIds: reviewers, subject: 'Duty exchange — needs your approval', body: text, path: PATH }).catch(() => {});
    notifyUsers({ senderId: me.id, recipientIds: [partner.id], subject: 'Duty exchange requested with you', body: text + ' It will be swapped only after approval.', path: PATH }).catch(() => {});
    res.status(201).json({ id: row.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const load = async (id) => (await pool.query(`${SEL} WHERE x.id = $1`, [id])).rows[0];

router.post('/:id/cancel', async (req, res) => {
  try {
    const r = await load(req.params.id);
    if (!r || r.requesterId !== req.user.id) return res.status(404).json({ error: 'Not found' });
    if (!['pending', 'recommended'].includes(r.status)) return res.status(409).json({ error: 'Already decided.' });
    await pool.query(`UPDATE duty_exchange_requests SET status='cancelled' WHERE id=$1`, [r.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/recommend', async (req, res) => {
  try {
    const r = await load(req.params.id); if (!r) return res.status(404).json({ error: 'Not found' });
    if (!(await myRights(req.user, r)).canRecommend) return res.status(403).json({ error: 'You cannot recommend this request.' });
    await pool.query(`UPDATE duty_exchange_requests SET status='recommended', recommended_by=$2, recommended_at=NOW(), recommend_comment=$3 WHERE id=$1`,
      [r.id, req.user.id, String(req.body?.comment || '').slice(0, 500) || null]);
    notifyUsers({ senderId: req.user.id, recipientIds: await adminIds(req.user.id), subject: 'Duty exchange — recommended, needs approval',
      body: `${r.requesterName} ⇄ ${r.partnerName} on ${r.date} was recommended.`, path: PATH }).catch(() => {});
    notifyUsers({ senderId: req.user.id, recipientIds: [r.requesterId, r.partnerId], subject: 'Duty exchange recommended',
      body: `Your duty exchange on ${r.date} was recommended and is waiting for approval.`, path: PATH }).catch(() => {});
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/reject', async (req, res) => {
  const comment = String(req.body?.comment || '').trim();
  if (!comment) return res.status(400).json({ error: 'Please write a reason.' });
  try {
    const r = await load(req.params.id); if (!r) return res.status(404).json({ error: 'Not found' });
    if (!(await myRights(req.user, r)).canReject) return res.status(403).json({ error: 'You cannot reject this request.' });
    await pool.query(`UPDATE duty_exchange_requests SET status='rejected', rejected_by=$2, reject_comment=$3 WHERE id=$1`, [r.id, req.user.id, comment.slice(0, 500)]);
    notifyUsers({ senderId: req.user.id, recipientIds: [r.requesterId, r.partnerId], subject: 'Duty exchange rejected',
      body: `The duty exchange on ${r.date} (${r.requesterName} ⇄ ${r.partnerName}) was rejected: ${comment}`, path: PATH }).catch(() => {});
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/approve', async (req, res) => {
  const client = await pool.connect();
  try {
    const r = await load(req.params.id); if (!r) { client.release(); return res.status(404).json({ error: 'Not found' }); }
    if (!(await myRights(req.user, r)).canApprove) { client.release(); return res.status(403).json({ error: 'You cannot approve this request.' }); }
    if (r.date < todayNepal()) { client.release(); return res.status(409).json({ error: 'That day has already passed.' }); }
    const map = await loadRosterMap(r.date, r.date);
    const a = dutyOf(map, r.requesterId, r.date), b = dutyOf(map, r.partnerId, r.date);
    if (!a || !b) { client.release(); return res.status(409).json({ error: 'One of them no longer has a duty on that day.' }); }
    const by = req.user.fullName || req.user.username || 'Admin';
    await client.query('BEGIN');
    await writeDay(client, r.requesterId, r.date, b, by);   // requester takes the colleague's duty …
    await writeDay(client, r.partnerId, r.date, a, by);     // … and the colleague takes the requester's
    await client.query(`UPDATE duty_exchange_requests SET status='approved', approved_by=$2, approved_at=NOW(), approve_comment=$3 WHERE id=$1`,
      [r.id, req.user.id, String(req.body?.comment || '').slice(0, 500) || null]);
    await client.query('COMMIT');
    logAudit({ actor: req.user, action: 'exchange-duty', entity: 'duty-roster', entityId: `${r.requesterId}<->${r.partnerId}:${r.date}`, before: { requester: a, partner: b }, after: { requester: b, partner: a } });
    notifyUsers({ senderId: req.user.id, recipientIds: [r.requesterId, r.partnerId], subject: 'Duty exchange approved',
      body: `Approved: ${r.date} — ${r.requesterName} now works ${b.label}, ${r.partnerName} now works ${a.label}.`, path: '/m/roster' }).catch(() => {});
    res.json({ ok: true });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); res.status(500).json({ error: e.message }); }
  finally { client.release(); }
});

export default router;
