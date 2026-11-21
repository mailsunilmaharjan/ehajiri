/* Delete requests waiting for an admin. The admin approves with their own password. Port of routers/approvals.py. */
import { Router } from 'express';
import { q, one, tx } from '../../services/accounts/accDb.js';
import { ah, bad, audit, userOf } from '../../services/accounts/common.js';
import { adminApproval } from '../../services/accounts/authz.js';
import { getDoc, deleteDocNow, cleanupFiles } from './docs.js';
import { manualVoucher, deleteVoucherNow } from './vouchers.js';

const router = Router();

router.get('/approvals', ah(async (req, res) => {
  const me = req.accUser;
  let sql = 'SELECT * FROM acc_approvals WHERE status = %s';
  const params = [req.query.status || 'pending'];
  if (!me.isAdmin) { sql += ' AND requested_by = %s'; params.push(me.username); }
  res.json((await q(`${sql} ORDER BY id DESC LIMIT 200`, params)).rows);
}));

async function pending(aid, run = { one }) {
  const a = await run.one('SELECT * FROM acc_approvals WHERE id = %s', [aid]) || bad('Request not found.', 404);
  if (a.status !== 'pending') bad(`This request is already ${a.status}.`);
  return a;
}

router.post('/approvals/:aid/approve', ah(async (req, res) => {
  const aid = +req.params.aid, b = req.body || {};
  if (!req.accUser.isAdmin) bad('Only an admin can approve.', 403);
  const approver = await adminApproval(req, null, b.password);
  let files = [];
  await tx(async (t) => {
    await t.query('SELECT id FROM acc_approvals WHERE id = %s FOR UPDATE', [aid]);
    const a = await pending(aid, t);
    if (a.entity === 'doc') files = await deleteDocNow(t, await getDoc(a.entity_id, t), a.requested_by, approver, a.reason);
    else await deleteVoucherNow(t, await manualVoucher(a.entity_id, t), a.requested_by, approver, a.reason);
    await t.query("UPDATE acc_approvals SET status='approved', decided_by=%s, decided_at=NOW(), note=%s WHERE id=%s", [approver, b.note || null, aid]);
  });
  await cleanupFiles(files);
  res.json({ ok: true });
}));

router.post('/approvals/:aid/reject', ah(async (req, res) => {
  const aid = +req.params.aid, b = req.body || {};
  const me = req.accUser;
  const a = await pending(aid);
  if (!me.isAdmin && a.requested_by !== me.username) bad('Only an admin can reject.', 403);
  await tx(async (t) => {
    await t.query("UPDATE acc_approvals SET status='rejected', decided_by=%s, decided_at=NOW(), note=%s WHERE id=%s", [me.username, b.note || null, aid]);
    await audit(t, userOf(req), 'reject_delete', a.entity, a.entity_id, { no: a.entity_no, note: b.note });
  });
  res.json({ ok: true });
}));

export default router;
