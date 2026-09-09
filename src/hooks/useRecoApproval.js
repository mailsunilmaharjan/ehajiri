import { useState, useEffect, useCallback } from 'react';
import api from '../api/client.js';

// Live source of truth for "Set Recommendator & Approval" (Staff Detail →
// User Management) — fetches directly from the DB-backed API on mount
// instead of relying on the localStorage read-through cache (ehajiri_reco_
// approval), which only ever refreshed at login or right when someone saved
// the config in that exact browser tab. Any OTHER tab/session — or one left
// open a while — kept showing stale/empty data even after the config was
// saved and confirmed in the database, which is exactly the bug this fixes.
//
// Some consumers (LeaveApplyModal, OfficeVisitApplyModal, ManualPosting
// ApplyModal, MissingAttendanceApplyModal) are globally-rendered popups that
// mount once at app start and stay mounted for the whole session — for
// those, a mount-only fetch would go stale forever the moment someone edits
// the config after login. Call the returned `refresh()` from a
// `useEffect(() => { if (isOpen) refresh(); }, [isOpen])` (same pattern
// those components already use for refreshSettings()) so it re-fetches every
// time the popup actually opens, not just once.
export default function useRecoApproval() {
  const [assignments, setAssignments] = useState({});
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(() => {
    return api.get('/reco-approval').then(data => {
      setAssignments(data || {});
    }).catch(() => {}).finally(() => setLoaded(true));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const getRecoIds = (empId) => {
    if (!empId) return [];
    const r = assignments[String(empId)]?.reco;
    return Array.isArray(r) ? r.map(String) : (r ? [String(r)] : []);
  };
  const getApprovalIds = (empId) => {
    if (!empId) return [];
    const a = assignments[String(empId)]?.approval;
    return Array.isArray(a) ? a.map(String) : (a ? [String(a)] : []);
  };

  return { assignments, loaded, refresh, getRecoIds, getApprovalIds };
}
