import { useMemo, useState, useEffect, useCallback } from 'react';
import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useData } from '../context/DataContext.jsx';
import { useSettings } from '../context/SettingsContext.jsx';
import useRecoApproval from '../hooks/useRecoApproval.js';
import useLeaveOpening from '../hooks/useLeaveOpening.js';
import { getNepalTodayISO, adToBS, bsToAD, getBSDays } from '../utils/dateUtils.js';

/* Logic shared by the phone screens. The leave-balance and approver rules are the SAME rules the website uses
   (copied from LeaveApplyModal / LeaveApproval), so the app and the website always agree. */

/** Leave balance per leave-type short name for the signed-in user (opening + carried + credited - used). */
export function useMyLeaveBalance() {
  const { currentUser } = useAuth();
  const { settings } = useSettings();
  const { leaves, getLeaveBalance } = useData();
  const { opening: leaveOpening } = useLeaveOpening();
  const ltConfigs = settings.leaveTypeConfigs || [];
  return useMemo(() => {
    if (!currentUser) return [];
    const fy = (settings.fiscalYears || []).find(f => f.isDefault) || (settings.fiscalYears || [])[0];
    const empId = String(currentUser.id);
    return ltConfigs.map(lt => {
      let balance;
      try {
        if (!fy) throw new Error('no fy');
        const fyId = String(fy.id);
        const prev = Number(leaveOpening['prev_' + fyId]?.[empId]?.[lt.shortName] ?? 0);
        const curr = Number(leaveOpening[fyId]?.[empId]?.[lt.shortName] ?? 0);
        const used = (leaves || []).filter(l => String(l.employeeId) === empId && l.leaveTypeCode === lt.shortName && l.status === 'approved')
          .reduce((s, l) => s + Number(l.days || 0), 0);
        const credited = Number(getLeaveBalance(empId)?.[lt.shortName] || 0);
        balance = Math.max(0, prev + curr + credited - used);
      } catch { balance = Number(getLeaveBalance(empId)?.[lt.shortName] || 0); }
      return { code: lt.shortName, name: lt.name || lt.shortName, color: lt.color, balance };
    });
  }, [currentUser, settings.fiscalYears, ltConfigs, leaves, getLeaveBalance, leaveOpening]);
}

/** Leave and office-visit applications this user is the assigned recommender / approver for. */
export function useMyApprovals() {
  const { currentUser } = useAuth();
  const { settings } = useSettings();
  const { leaves, officeVisits, employees } = useData();
  const { assignments } = useRecoApproval();
  const compulsory = settings.recoApprovalCompulsory || false;
  return useMemo(() => {
    const me = String(currentUser?.id);
    const ids = (v) => (Array.isArray(v) ? v : v ? [v] : []).map(String);
    const isReco = (e) => ids(assignments[String(e)]?.reco).includes(me);
    const isAppr = (e) => ids(assignments[String(e)]?.approval).includes(me);
    const hasReco = (e) => ids(assignments[String(e)]?.reco).length > 0;
    const isAdminRole = ['admin', 'superAdmin'].includes(currentUser?.role);
    const mine = (x) => (String(x.employeeId) === me && !isAdminRole ? false : (isReco(x.employeeId) || isAppr(x.employeeId)));
    const decorate = (x) => ({
      ...x,
      empName: employees.find(e => String(e.id) === String(x.employeeId))?.fullName || `#${x.employeeId}`,
      canRecommend: isReco(x.employeeId) && !x.recommendedBy,
      canApprove: isAppr(x.employeeId) && (!compulsory || !!x.recommendedBy || !hasReco(x.employeeId)) && !(compulsory && hasReco(x.employeeId) && isReco(x.employeeId)),
    });
    const pend = (arr) => (arr || []).filter(x => x.status === 'pending' && mine(x)).map(decorate).filter(x => x.canRecommend || x.canApprove);
    return { leaves: pend(leaves), visits: pend(officeVisits) };
  }, [currentUser, assignments, compulsory, leaves, officeVisits, employees]);
}

/** Unread message count, refreshed every minute and whenever `bump` changes. */
export function useUnreadCount(bump = 0) {
  const [n, setN] = useState(0);
  const load = useCallback(() => api.get('/messages/unread-count').then(r => setN(Number(r?.count ?? r?.unread ?? r ?? 0) || 0)).catch(() => {}), []);
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load, bump]);
  return [n, load];
}

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** First/last day (ISO, AD) of the month `offset` months from today, in the app's calendar (Nepali BS or English). */
export function monthRange(offset, calendar) {
  if (calendar === 'np') {
    const t = adToBS(getNepalTodayISO());
    let y = t.year, m = t.month + offset;
    while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; }
    return { start: iso(bsToAD(y, m, 1)), end: iso(bsToAD(y, m, getBSDays(y, m))), bs: { year: y, month: m } };
  }
  const t = new Date(getNepalTodayISO() + 'T00:00:00');
  const d = new Date(t.getFullYear(), t.getMonth() + offset, 1);
  return { start: iso(d), end: iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)), ad: { year: d.getFullYear(), month: d.getMonth() } };
}

/** Late In / Early Out requests and Online Attendance records: mine, and the ones waiting for me to recommend / approve.
 *  Same "who may act" rules as the website's approval pages (configured recommender/approver; admins also for staff with none). */
export function useExtraRequests() {
  const { currentUser } = useAuth();
  const { assignments } = useRecoApproval();
  const { settings } = useSettings();
  const { employees } = useData();
  const [manual, setManual] = useState([]);
  const [online, setOnline] = useState([]);
  const [missing, setMissing] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => {
    const [m, o, ms] = await Promise.all([
      api.get('/attendance/manual-postings').catch(() => []),
      api.get('/online-attendance').catch(() => []),
      api.get('/attendance/missing-requests').catch(() => []),
    ]);
    setManual(Array.isArray(m) ? m : []); setOnline(Array.isArray(o) ? o : []); setMissing(Array.isArray(ms) ? ms : []); setLoaded(true);
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);

  return useMemo(() => {
    const me = String(currentUser?.id);
    const compulsory = settings.recoApprovalCompulsory || false;
    const ids = (v) => (Array.isArray(v) ? v : v ? [v] : []).map(String);
    const isAdminRole = ['admin', 'superAdmin'].includes(currentUser?.role);
    const cfg = (e) => assignments[String(e)] || {};
    const isReco = (e) => ids(cfg(e).reco).includes(me);
    const isAppr = (e) => ids(cfg(e).approval).includes(me);
    const none = (e) => ids(cfg(e).reco).length === 0 && ids(cfg(e).approval).length === 0;
    const decorate = (x, recoBy) => {
      const e = x.employeeId;
      const override = isAdminRole && none(e);
      const hasReco = ids(cfg(e).reco).length > 0;
      return {
        ...x,
        empName: x.fullName || '',
        canRecommend: isReco(e) && !recoBy,
        canApprove: override || (isAppr(e) && (!compulsory || !!recoBy || !hasReco) && !(compulsory && hasReco && isReco(e))),
        visible: (String(e) !== me || isAdminRole) && (isReco(e) || isAppr(e) || override),
      };
    };
    const man = manual.map(x => decorate(x, x.recommendedById));
    const onl = online.map(x => decorate({ ...x, fullName: employees.find(e => String(e.id) === String(x.employeeId))?.fullName || '' }, x.recommendedBy));
    const pend = (a) => a.filter(x => x.status === 'pending' && x.visible && (x.canRecommend || x.canApprove));
    // missing-attendance requests move pending -> recommended -> approved; "recommended" still waits for the approver
    const mis = missing.map(x => {
      const d = decorate({ ...x, fullName: x.employeeName }, x.status === 'recommended');
      return { ...d, canRecommend: d.canRecommend && x.status === 'pending' };
    });
    const pendMis = mis.filter(x => ['pending', 'recommended'].includes(x.status) && x.visible && (x.canRecommend || x.canApprove));
    return {
      loaded, reload: load,
      manualMine: manual.filter(x => String(x.employeeId) === me), onlineMine: online.filter(x => String(x.employeeId) === me),
      manualToApprove: pend(man), onlineToApprove: pend(onl), missingToApprove: pendMis,
      missingMine: missing.filter(x => String(x.employeeId) === me),
    };
  }, [manual, online, missing, assignments, settings.recoApprovalCompulsory, currentUser, employees, load, loaded]);
}

/** "May I recommend / approve this person's request?" - one rule for every kind of request (same as the website's approval pages). */
export function useApprovalRules() {
  const { currentUser } = useAuth();
  const { assignments } = useRecoApproval();
  const { settings } = useSettings();
  return useCallback((employeeId, recoDone) => {
    const me = String(currentUser?.id);
    const ids = (v) => (Array.isArray(v) ? v : v ? [v] : []).map(String);
    const c = assignments[String(employeeId)] || {};
    const isAdminRole = ['admin', 'superAdmin'].includes(currentUser?.role);
    const isReco = ids(c.reco).includes(me), isAppr = ids(c.approval).includes(me);
    const hasReco = ids(c.reco).length > 0, none = !hasReco && ids(c.approval).length === 0;
    const compulsory = settings.recoApprovalCompulsory || false;
    const override = isAdminRole && none;
    return {
      visible: (String(employeeId) !== me || isAdminRole) && (isReco || isAppr || override),
      canRecommend: isReco && !recoDone,
      canApprove: override || (isAppr && (!compulsory || !!recoDone || !hasReco) && !(compulsory && hasReco && isReco)),
    };
  }, [assignments, currentUser, settings.recoApprovalCompulsory]);
}
