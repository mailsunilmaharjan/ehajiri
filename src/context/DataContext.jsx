import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import api from '../api/client.js';
import { useAuth } from './AuthContext.jsx';
import { getNepalTodayISO } from '../utils/dateUtils.js';

const DataContext = createContext(null);

/* ── Fallback seed data (used when API is unavailable) ── */
const FB_LEAVE_TYPES = [
  { id:1, name:'वार्षिक बिदा', code:'AL', totalDays:20, color:'#0e9f6e', nameEn:'Annual Leave'   },
  { id:2, name:'बिरामी बिदा',  code:'SL', totalDays:12, color:'#3f83f8', nameEn:'Sick Leave'      },
  { id:3, name:'आकस्मिक बिदा',code:'CL', totalDays:6,  color:'#ff5a1f', nameEn:'Casual Leave'    },
  { id:4, name:'मातृत्व बिदा', code:'ML', totalDays:98, color:'#e74694', nameEn:'Maternity Leave' },
  { id:5, name:'पितृत्व बिदा', code:'PL', totalDays:15, color:'#7e3af2', nameEn:'Paternity Leave' },
];
const FB_SHIFTS = [
  // isSystem:true  → protected system record, cannot be deleted
  { id:1, name:'साझा सिफ्ट', nameEn:'Default Shift', code:'default_shift', startTime:'10:00', endTime:'17:00', workHours:7, gracePeriodStart:15, gracePeriodEnd:0, makeDefault:true, active:true, color:'#1a56db', isSystem:true, days:['Sun','Mon','Tue','Wed','Thu','Fri'], exceptionalDayEnabled:false, exceptionalDays:[], winterPolicyEnabled:false, winterPolicy:null },
  { id:2, name:'बिहान सिफ्ट',  nameEn:'Morning Shift',  code:'morning',  startTime:'06:00', endTime:'14:00', workHours:8, gracePeriodStart:5, gracePeriodEnd:5, makeDefault:false,active:true, color:'#e3a008', isSystem:false,days:['Sun','Mon','Tue','Wed','Thu','Fri'], exceptionalDayEnabled:false, exceptionalDays:[], winterPolicyEnabled:false, winterPolicy:null },
  { id:3, name:'बेलुकी सिफ्ट', nameEn:'Evening Shift',  code:'evening',  startTime:'14:00', endTime:'22:00', workHours:8, gracePeriodStart:5, gracePeriodEnd:5, makeDefault:false,active:true, color:'#7e3af2', isSystem:false,days:['Sun','Mon','Tue','Wed','Thu','Fri'], exceptionalDayEnabled:false, exceptionalDays:[], winterPolicyEnabled:false, winterPolicy:null },
];
// NOTE: this app is multi-tenant on a single shared origin — every tenant is
// served from the same host, differing only by a /t/<slug>/ path prefix, so
// browser storage (localStorage/sessionStorage/cookies) is NOT isolated per
// tenant the way it would be on separate subdomains. This context used to
// cache employees/shifts/leaveTypes/leaveBalances/leaves/officeVisits in
// localStorage (keys like ls_leaves) as an offline-resilience fallback and
// to "merge in local-only records submitted while offline" after a fresh
// API fetch. In a single-tenant desktop/offline context that's harmless,
// but here it meant: view Tenant A, then open Tenant B in the same browser
// — Tenant B's initial render (and the "local-only" merge, keyed by id, so
// stale records that don't match Tenant B's fresh ids all survived as
// "local-only") showed Tenant A's leaves/visits/employees. Removed
// entirely — no client-side persistence of tenant data across page loads;
// state is always exactly whatever the live API for the CURRENT tenant
// returns.

export const DataProvider = ({ children }) => {
  const { filterByRole, isAdmin, currentUser } = useAuth();

  const [employees,    setEmployees]    = useState([]);
  const [shifts,       setShifts]       = useState([]);
  const [leaveTypes,   setLeaveTypes]   = useState(FB_LEAVE_TYPES);
  const [leaveBalances,setLeaveBalances]= useState([]);
  const [leaves,       setLeaves]       = useState([]);
  const [officeVisits, setOfficeVisits] = useState([]);
  const [apiOk,        setApiOk]        = useState(false);

  /* Bumped whenever duty roster is mutated — attendance components watch this to auto-refetch */
  const [rosterVersion, setRosterVersion] = useState(0);
  const bumpRosterVersion = useCallback(() => setRosterVersion(v => v + 1), []);

  /* ── Role-scoped views ─────────────────────────────────────────────────────
     filteredEmployees  → employees visible to the current user's scope
     filteredLeaves     → leaves belonging to those employees
     filteredVisits     → office visits belonging to those employees
  ── */
  const filteredEmployees = useMemo(
    () => filterByRole(employees).filter(e => e.role !== 'superAdmin'),
    [employees, filterByRole],
  );

  const _scopeIds = useMemo(
    () => new Set(filteredEmployees.map(e => String(e.id))),
    [filteredEmployees],
  );

  const filteredLeaves = useMemo(
    () => leaves.filter(l =>
      _scopeIds.has(String(l.employeeId)) ||
      (currentUser && String(l.employeeId) === String(currentUser.id))
    ),
    [leaves, _scopeIds, currentUser],
  );

  const filteredVisits = useMemo(
    () => officeVisits.filter(v =>
      _scopeIds.has(String(v.employeeId)) ||
      (currentUser && String(v.employeeId) === String(currentUser.id))
    ),
    [officeVisits, _scopeIds, currentUser],
  );

  /* ── Load all data from API on login (and on startup for an already
     logged-in session). Every endpoint below is behind authGuard, so
     fetching while logged out can only ever 401 — worse, the form login
     is an SPA navigation (no page reload), so a mount-only fetch that
     ran on the login screen would leave employees/leaves/visits empty
     for the whole session until a manual refresh. ── */
  useEffect(() => {
    if (!currentUser) return;
    // Reset to empty immediately on every (re)fetch — e.g. switching tenants
    // without a full page reload — so the previous tenant's data can never
    // stay on screen even for the moment before this fetch resolves.
    setEmployees([]); setShifts([]); setLeaveBalances([]); setLeaves([]); setOfficeVisits([]);
    (async () => {
      try {
        const [emps, shfts, lvTypes, lvBals, lvs, visits] = await Promise.all([
          api.get('/employees'),
          api.get('/shifts'),
          api.get('/leaves/types'),
          api.get('/leaves/balances'),
          api.get('/leaves'),
          api.get('/visits'),
        ]);
        setEmployees(emps);
        setShifts(shfts);
        setLeaveTypes(lvTypes);
        setLeaveBalances(lvBals);
        setLeaves(lvs);
        setOfficeVisits(visits);
        setApiOk(true);
      } catch {
        // API unavailable — fall back to the hardcoded shift defaults only;
        // no cached-from-disk data (see note above), so this is genuinely
        // just "the app couldn't reach the server," not real org data.
        setShifts(FB_SHIFTS);
        setApiOk(false);
      }
    })();
  }, [currentUser?.id]);

  /* ── Employees ──
     Always write through to the API — staff records must persist to the
     database. A local-only fallback here would silently "succeed" (and
     bump counts/toasts) without ever reaching the server whenever apiOk
     was stuck false from an unrelated startup hiccup, then vanish the
     next time the list is refetched from the server. */
  const addEmployee = async (emp) => {
    const e = await api.post('/employees', emp);
    setEmployees(p => [...p, e]);
    return e;
  };
  const updateEmployee = async (id, data) => {
    const e = await api.put(`/employees/${id}`, data);
    setEmployees(p => p.map(x => x.id===id ? e : x));
    return e;
  };
  const deleteEmployee = async (id) => {
    await api.delete(`/employees/${id}`);
    setEmployees(p => p.filter(x => x.id !== id));
  };
  const getEmployeeById   = (id) => employees.find(e => String(e.id) === String(id));
  const getEmployeeName   = (id) => employees.find(e => String(e.id) === String(id))?.fullName || '-';
  const refreshEmployees  = async () => {
    try { const emps = await api.get('/employees'); setEmployees(emps); }
    catch { /* keep existing */ }
  };

  /* ── Shifts ── */
  const addShift = async (shift) => {
    if (apiOk) { const s = await api.post('/shifts', shift); setShifts(p => [...p, s]); return s; }
    const s = { ...shift, id: Date.now() }; setShifts(p => [...p, s]); return s;
  };
  const updateShift = async (id, data) => {
    if (apiOk) { const s = await api.put(`/shifts/${id}`, data); setShifts(p => p.map(x => x.id===id ? s : x)); return s; }
    setShifts(p => p.map(x => x.id===id ? { ...x, ...data } : x));
  };
  const deleteShift = async (id) => {
    // Guard: system shifts cannot be deleted
    const target = shifts.find(x => x.id === id);
    if (target?.isSystem) return;
    if (apiOk) await api.delete(`/shifts/${id}`);
    setShifts(p => p.filter(x => x.id !== id));
  };
  const refreshShifts    = async () => { try { setShifts(await api.get('/shifts')); } catch {} };
  const getShiftByCode   = (code) => shifts.find(s => s.code === code);
  const getShiftById     = (id)   => shifts.find(s => s.id   === id);

  /* ── Leaves ── */
  const addLeave = async (leave) => {
    /* Always save locally first so the record is never lost */
    const localId = Date.now();
    const today   = getNepalTodayISO();
    const l = {
      ...leave,
      id:             localId,
      status:         leave.status         || 'pending',
      appliedDate:    leave.appliedDate    || today,
      approvedBy:     leave.approvedBy     ?? null,
      approvedDate:   leave.approvedDate   ?? null,
      comment:        leave.comment        ?? '',
      recommendedBy:  leave.recommendedBy  ?? null,
      recommendedDate:leave.recommendedDate?? null,
      recoComment:    leave.recoComment    ?? '',
    };
    setLeaves(p => [...p, l]);
    /* Then try to sync with API; if it fails the local copy remains */
    if (apiOk) {
      try {
        const saved = await api.post('/leaves', leave);
        if (saved?.id && saved.id !== localId) {
          // Merge: API fields take priority EXCEPT status/approvedBy/approvedDate —
          // the local values win if they were explicitly set (e.g. manual posting as 'approved')
          setLeaves(p => p.map(x => x.id === localId
            ? { ...x, ...saved, status: saved.status || x.status }
            : x
          ));
          return saved.id;
        }
      } catch { /* API unavailable — local copy already saved */ }
    }
    return localId;
  };
  const recommendLeave = async (id, recommendedBy, recommendComment='') => {
    const today = getNepalTodayISO();
    setLeaves(p => p.map(x => String(x.id) === String(id)
      ? { ...x, recommendedBy, recommendedDate: today, recommendComment }
      : x
    ));
    if (apiOk) {
      try {
        const l = await api.patch(`/leaves/${id}/recommend`, { recommendedBy, comment: recommendComment });
        setLeaves(p => p.map(x => String(x.id) === String(id) ? { ...x, ...l } : x));
      } catch {}
    }
  };
  const updateLeave = async (id, data) => {
    // Optimistic update immediately so the UI reflects the change even if the API call is slow
    setLeaves(p => p.map(l => String(l.id) === String(id) ? { ...l, ...data } : l));
    if (apiOk) {
      try {
        const l = await api.put(`/leaves/${id}`, data);
        setLeaves(p => p.map(x => String(x.id) === String(id) ? { ...x, ...l } : x));
      } catch {
        // API failed (e.g. local-only ID not in DB) — optimistic update already applied, keep it
      }
    }
  };
  const deleteLeave = async (id) => {
    if (apiOk) try { await api.delete(`/leaves/${id}`); } catch {}
    setLeaves(p => p.filter(l => String(l.id) !== String(id)));
  };
  const approveLeave = async (id, approvedBy, comment='') => {
    const today = getNepalTodayISO();
    // Optimistic update immediately so UI reflects the change even if API call is slow
    setLeaves(p => p.map(x => String(x.id) === String(id)
      ? { ...x, status:'approved', approvedBy, approvedDate:today, comment }
      : x
    ));
    if (apiOk) {
      try {
        const l = await api.patch(`/leaves/${id}/approve`, { approvedBy, comment });
        // Merge API response (preserves local-only fields like isManual, recommendedBy)
        setLeaves(p => p.map(x => String(x.id) === String(id) ? { ...x, ...l } : x));
      } catch {
        // API failed (e.g. local-only ID not in DB) — optimistic update already applied, keep it
      }
    }
  };
  const rejectLeave = async (id, approvedBy, comment='') => {
    const today = getNepalTodayISO();
    // Optimistic update immediately
    setLeaves(p => p.map(x => String(x.id) === String(id)
      ? { ...x, status:'rejected', approvedBy, approvedDate:today, comment }
      : x
    ));
    if (apiOk) {
      try {
        const l = await api.patch(`/leaves/${id}/reject`, { approvedBy, comment });
        setLeaves(p => p.map(x => String(x.id) === String(id) ? { ...x, ...l } : x));
      } catch {
        // API failed — optimistic update already applied, keep it
      }
    }
  };
  const getLeaveTypeName  = (code) => leaveTypes.find(lt => lt.code===code)?.name  || code;
  const getLeaveTypeColor = (code) => leaveTypes.find(lt => lt.code===code)?.color || '#6b7280';
  const getLeaveBalance   = (empId) => leaveBalances.find(b => b.employeeId===empId) || { AL:0,SL:0,CL:0,ML:0,PL:0 };
  /* leaveBalances is only fetched once, at login — a credit written straight to
     leave_balances by another page (e.g. the Overtime Approval "Provide Next Day
     Leave" grant) never reaches it otherwise, so any screen that reads a balance
     right after such a grant needs to call this to see the current value. */
  const refreshLeaveBalances = async () => {
    try { setLeaveBalances(await api.get('/leaves/balances')); } catch { /* keep existing */ }
  };

  /* Returns the approved leave record for a given employee on a given date (ISO string),
     or null if no approved leave covers that date. */
  const getApprovedLeaveForDate = useCallback((empId, dateStr) => {
    if (!empId || !dateStr) return null;
    return leaves.find(l =>
      l.status === 'approved' &&
      String(l.employeeId) === String(empId) &&
      l.fromDate <= dateStr && l.toDate >= dateStr
    ) || null;
  }, [leaves]);

  /* ── Office Visits ── */
  const addVisit = async (visit) => {
    /* Always save locally first so the record is never lost */
    const localId = Date.now();
    const today   = getNepalTodayISO();
    const v = {
      ...visit,
      id:             localId,
      status:         visit.status         || 'pending',
      appliedDate:    visit.appliedDate    || today,
      approvedBy:     visit.approvedBy     ?? null,
      approvedDate:   visit.approvedDate   ?? null,
      comment:        visit.comment        ?? '',
      recommendedBy:  visit.recommendedBy  ?? null,
      recommendedDate:visit.recommendedDate?? null,
      recoComment:    visit.recoComment    ?? '',
    };
    setOfficeVisits(p => [...p, v]);
    /* Then try to sync with API; if it fails the local copy remains */
    if (apiOk) {
      try {
        const saved = await api.post('/visits', visit);
        if (saved?.id && saved.id !== localId) {
          setOfficeVisits(p => p.map(x => x.id === localId ? { ...x, ...saved } : x));
          return saved.id;
        }
      } catch { /* API unavailable — local copy already saved */ }
    }
    return localId;
  };
  const recommendVisit = async (id, recommendedBy, recommendComment='') => {
    const today = getNepalTodayISO();
    setOfficeVisits(p => p.map(x => String(x.id) === String(id)
      ? { ...x, recommendedBy, recommendedDate: today, recommendComment }
      : x
    ));
    if (apiOk) {
      try {
        const v = await api.patch(`/visits/${id}/recommend`, { recommendedBy, comment: recommendComment });
        setOfficeVisits(p => p.map(x => String(x.id) === String(id) ? { ...x, ...v } : x));
      } catch {}
    }
  };
  const updateVisit = async (id, data) => {
    // Optimistic update immediately so the UI reflects the change even if the API call is slow
    setOfficeVisits(p => p.map(v => String(v.id)===String(id) ? { ...v, ...data } : v));
    if (apiOk) {
      try {
        const v = await api.put(`/visits/${id}`, data);
        setOfficeVisits(p => p.map(x => String(x.id) === String(id) ? { ...x, ...v } : x));
      } catch {
        // API failed (e.g. local-only ID not in DB) — optimistic update already applied, keep it
      }
    }
  };
  const deleteVisit = async (id) => {
    if (apiOk) await api.delete(`/visits/${id}`);
    setOfficeVisits(p => p.filter(v => String(v.id) !== String(id)));
  };
  const approveVisit = async (id, approvedBy, comment='') => {
    const today = getNepalTodayISO();
    setOfficeVisits(p => p.map(x => String(x.id) === String(id)
      ? { ...x, status:'approved', approvedBy, approvedDate:today, comment }
      : x
    ));
    if (apiOk) {
      try {
        const v = await api.patch(`/visits/${id}/approve`, { approvedBy, comment });
        setOfficeVisits(p => p.map(x => String(x.id) === String(id) ? { ...x, ...v } : x));
      } catch {}
    }
  };
  const rejectVisit = async (id, approvedBy, comment='') => {
    const today = getNepalTodayISO();
    setOfficeVisits(p => p.map(x => String(x.id) === String(id)
      ? { ...x, status:'rejected', approvedBy, approvedDate:today, comment }
      : x
    ));
    if (apiOk) {
      try {
        const v = await api.patch(`/visits/${id}/reject`, { approvedBy, comment });
        setOfficeVisits(p => p.map(x => String(x.id) === String(id) ? { ...x, ...v } : x));
      } catch {}
    }
  };

  /* stats are scoped to the user's visible employees/leaves/visits */
  const stats = {
    totalEmployees : filteredEmployees.filter(e => e.active).length,
    pendingLeaves  : filteredLeaves.filter(l => l.status==='pending').length,
    pendingVisits  : filteredVisits.filter(v => v.status==='pending').length,
    totalShifts    : shifts.filter(s => s.active).length,
    approvedLeaves : filteredLeaves.filter(l => l.status==='approved').length,
    rejectedLeaves : filteredLeaves.filter(l => l.status==='rejected').length,
  };

  return (
    <DataContext.Provider value={{
      employees, addEmployee, updateEmployee, deleteEmployee, getEmployeeById, getEmployeeName, refreshEmployees,
      filteredEmployees,
      shifts, addShift, updateShift, deleteShift, refreshShifts, getShiftByCode, getShiftById,
      leaveTypes, leaveBalances, getLeaveBalance, refreshLeaveBalances,
      leaves, addLeave, updateLeave, deleteLeave, approveLeave, rejectLeave, recommendLeave, getLeaveTypeName, getLeaveTypeColor, getApprovedLeaveForDate,
      filteredLeaves,
      officeVisits, addVisit, updateVisit, deleteVisit, approveVisit, rejectVisit, recommendVisit,
      filteredVisits,
      stats, apiOk,
      rosterVersion, bumpRosterVersion,
    }}>
      {children}
    </DataContext.Provider>
  );
};

export const useData = () => {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
};

export default DataContext;
