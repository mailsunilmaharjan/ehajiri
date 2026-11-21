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
export async function notifyApproversNext(employeeId, actorId, { subject, body, path, pickedApproverId }) {
  try {
    const { approverIds } = await getRecoApprovalIds(employeeId);
    // If the applicant picked a specific approver, only that person is next in line.
    let ids = pickedApproverId ? [Number(pickedApproverId)] : approverIds.map(Number);
    if (!ids.length) {
      const { rows } = await pool.query(`SELECT id FROM users WHERE role IN ('admin','superAdmin') AND active = TRUE`);
      ids = rows.map(r => r.id);
    }
    ids = ids.filter(i => i !== Number(employeeId) && i !== Number(actorId));
    if (!ids.length) return;
    await notifyUsers({ senderId: Number(employeeId), recipientIds: ids, subject, body, path });
  } catch (e) { console.error('[approvalNotify next]', e.message); }
}

/** Everyone who must be told about a NEW application by employeeId: the recommender/approver the
 *  applicant picked in the form (all entries), PLUS every recommender/approver configured for them in
 *  Set Recommendator & Approval; admins when nobody is configured. The applicant is never included. */
export async function resolveApplicationRecipients(employeeId, picked = []) {
  const flat = (picked || []).flat().filter(Boolean).map(Number);
  let ids = [...flat];
  try {
    // Only the people the applicant picked are told; configured ones are the fallback when nothing was picked.
    if (!ids.length) {
      const { recommenderIds, approverIds } = await getRecoApprovalIds(employeeId);
      ids.push(...recommenderIds.map(Number), ...approverIds.map(Number));
    }
    if (!ids.length) {
      const { rows } = await pool.query(`SELECT id FROM users WHERE role IN ('admin','superAdmin') AND active = TRUE`);
      ids = rows.map(r => r.id);
    }
  } catch (e) { console.error('[approvalNotify recipients]', e.message); }
  return [...new Set(ids)].filter(i => Number.isFinite(i) && i !== Number(employeeId));
}
