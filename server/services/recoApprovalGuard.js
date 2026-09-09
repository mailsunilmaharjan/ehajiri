import pool from '../db.js';
import { isRecoApprovalCompulsory } from '../utils/appSettings.js';

// admin/superAdmin retain a system-level override (they configure this
// feature and need to be able to fix a broken/missing assignment) — every
// other role must be the actual employee's configured recommender/approver.
const PRIVILEGED_ROLES = ['admin', 'superAdmin'];

/** Configured recommender/approver ids for one employee (Staff Detail →
 *  "Set Recommendator & Approval"), as strings for easy comparison. */
export async function getRecoApprovalIds(employeeId) {
  const { rows } = await pool.query(
    'SELECT recommender_ids, approver_ids FROM reco_approval_assignments WHERE employee_id=$1',
    [employeeId]
  );
  const row = rows[0];
  return {
    recommenderIds: (row?.recommender_ids || []).map(String),
    approverIds   : (row?.approver_ids    || []).map(String),
  };
}

/**
 * Authorizes a recommend/approve/reject action on employeeId's application.
 * Returns null if authorized, or { status, error } to send back otherwise.
 *
 * Deliberately re-checks against the live reco_approval_assignments table
 * rather than trusting a row's own recommended_by/approved_by column —
 * those columns are populated from client-supplied values at apply time
 * (recommendedBy/approvedBy in the POST body), so an application could be
 * submitted with those pre-set to the applicant's own id, which would make
 * a same-row-based "isAssigned" check trivially self-satisfiable. The
 * caller must likewise always write req.user.id (never a client-supplied
 * id) as the actor when persisting the decision.
 *
 * For 'approve', pass { alreadyRecommended } (the row's own recommended_by,
 * as a boolean) so this can also enforce "Recommendation Compulsory" — when
 * that setting is on, approval is refused until someone has actually
 * recommended it, independent of whatever the frontend's Approve button
 * shows as enabled/disabled. Reject is deliberately exempt (matches the
 * existing frontend: the Reject button was never gated by canApprove — an
 * approver can decline something outright without waiting on a
 * recommendation). Privileged roles bypass this too, same reasoning as the
 * assignment check above: they need to be able to push through a record
 * with no recommender configured.
 *
 * Also while Recommendation Compulsory is on: whoever is configured as the
 * employee's recommender is refused 'approve' outright, even if the same
 * person is *also* configured as the approver — separation of duties, so a
 * recommendation always needs a genuinely different second person to sign
 * off. This only kicks in when the setting is on; with it off a dual-role
 * user keeps approving normally.
 *
 * Self-action: a normal user can never recommend/approve/reject their own
 * application, full stop — even if (through a misconfiguration in "Set
 * Recommendator & Approval") they somehow ended up listed as their own
 * recommender/approver, this check still blocks them. admin/superAdmin are
 * the one exception and may act on their own application, which is why the
 * privileged bypass is checked FIRST — ordering this after the self-check
 * would block admin too, which isn't the intent.
 *
 * Recommendation Compulsory only applies when this specific employee
 * actually HAS at least one recommender configured — with none configured
 * at all, "must be recommended first" is unsatisfiable (nobody exists who
 * could ever recommend it), so it would permanently deadlock the approver
 * instead of doing what the setting is for. Same reasoning for the
 * dual-role separation-of-duties check just above: it's only meaningful
 * when a recommender is actually configured.
 */
export async function authorizeRecoAction(req, employeeId, action, opts = {}) {
  const userId = String(req.user.id);
  if (PRIVILEGED_ROLES.includes(req.user.role)) return null;
  if (userId === String(employeeId)) {
    return { status: 403, error: 'You cannot act on your own application.' };
  }
  const { recommenderIds, approverIds } = await getRecoApprovalIds(employeeId);
  const hasRecommenderConfigured = recommenderIds.length > 0;
  if (action === 'approve' && hasRecommenderConfigured && recommenderIds.includes(userId) && await isRecoApprovalCompulsory()) {
    return { status: 403, error: 'As the configured recommender for this employee, you cannot also approve — a different approver must act.' };
  }
  const allowed = action === 'recommend' ? recommenderIds : approverIds;
  if (!allowed.includes(userId)) {
    return { status: 403, error: 'You are not the configured recommender/approver for this employee.' };
  }
  if (action === 'approve' && !opts.alreadyRecommended && hasRecommenderConfigured && await isRecoApprovalCompulsory()) {
    return { status: 400, error: 'This application must be recommended before it can be approved.' };
  }
  return null;
}

/**
 * Authorizes a staff member editing/deleting their OWN application: only
 * the owner, and only while it's still untouched (status 'pending' and no
 * recommendation recorded yet) — once anyone has acted on it, it's locked
 * for the owner. admin/superAdmin bypass both checks, as elsewhere in the app.
 *
 * Takes the raw DB row (snake_case, as every caller already has it straight
 * from a `SELECT ... FROM leaves/office_visits/attendance_manual_postings`)
 * rather than a camelCase-mapped object — every existing call site already
 * has the row in that shape, and mapping it to camelCase first is exactly
 * the kind of easy-to-miss step that silently no-ops this check instead of
 * throwing (recommendedBy would just read as undefined).
 */
export function authorizeOwnEditDelete(req, employeeId, row) {
  if (PRIVILEGED_ROLES.includes(req.user.role)) return null;
  if (String(req.user.id) !== String(employeeId)) {
    return { status: 403, error: 'You can only manage your own application.' };
  }
  if (row.status !== 'pending' || row.recommended_by) {
    return { status: 400, error: 'This application has already been actioned and can no longer be edited or deleted.' };
  }
  return null;
}
