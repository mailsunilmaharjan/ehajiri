import pool from '../db.js';
import { getRecoApprovalIds } from './recoApprovalGuard.js';
import { notifyUsers } from './internalMessages.js';

/* One place for "tell the right people" on approval-type requests (online attendance, Late In / Early Out):
   - the employee's configured recommenders + approvers get an inbox message, a live toast on the website and a phone push;
     if nobody is configured, admins are told instead (they can act on anything — see recoApprovalGuard);
   - when someone decides, the applicant gets the same three. Best effort: never throws. */

export async function notifyApproversOf(employeeId, { subject, body, path }) {
  try {
    const { recommenderIds, approverIds } = await getRecoApprovalIds(employeeId);
    let ids = [...new Set([...recommenderIds, ...approverIds])].map(Number);
    if (!ids.length) {
      const { rows } = await pool.query(`SELECT id FROM users WHERE role IN ('admin','superAdmin') AND active = TRUE`);
      ids = rows.map(r => r.id);
    }
    ids = ids.filter(i => i !== Number(employeeId));
    if (!ids.length) return;
    await notifyUsers({ senderId: Number(employeeId), recipientIds: ids, subject, body, path });
  } catch (e) { console.error('[approvalNotify approvers]', e.message); }
}

export async function notifyApplicantOf(employeeId, deciderId, { subject, body, path }) {
  try {
    if (!employeeId || String(employeeId) === String(deciderId)) return;
    await notifyUsers({ senderId: Number(deciderId), recipientIds: [Number(employeeId)], subject, body, path });
  } catch (e) { console.error('[approvalNotify applicant]', e.message); }
}

/** Tell exactly these people (inbox + live toast + sound on the phone) that a request needs them. Skips the requester. Never throws. */
export async function notifyPeople(employeeId, ids, { subject, body, path }) {
  try {
    const list = [...new Set((ids || []).filter(Boolean).map(Number))].filter(i => i !== Number(employeeId));
    if (!list.length) return;
    await notifyUsers({ senderId: Number(employeeId), recipientIds: list, subject, body, path });
  } catch (e) { console.error('[approvalNotify people]', e.message); }
}

/** After a recommendation: the configured approvers (or admins when none are set) are next in line. */
export async function notifyApproversNext(employeeId, actorId, { subject, body, path }) {
  try {
    const { approverIds } = await getRecoApprovalIds(employeeId);
    let ids = approverIds.map(Number);
    if (!ids.length) {
      const { rows } = await pool.query(`SELECT id FROM users WHERE role IN ('admin','superAdmin') AND active = TRUE`);
      ids = rows.map(r => r.id);
    }
    ids = ids.filter(i => i !== Number(employeeId) && i !== Number(actorId));
    if (!ids.length) return;
    await notifyUsers({ senderId: Number(employeeId), recipientIds: ids, subject, body, path });
  } catch (e) { console.error('[approvalNotify next]', e.message); }
}
