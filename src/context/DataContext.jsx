import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import api from '../api/client.js';
import { useAuth } from './AuthContext.jsx';

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
  { id:1, name:'साधारण सिफ्ट', nameEn:'Standard Shift', code:'standard', startTime:'10:00', endTime:'17:00', workHours:7, gracePeriodStart:5, gracePeriodEnd:5, makeDefault:true, active:true, color:'#1a56db', isSystem:true, days:['Sun','Mon','Tue','Wed','Thu','Fri'], exceptionalDayEnabled:false, exceptionalDays:[], winterPolicyEnabled:false, winterPolicy:null },
  { id:2, name:'बिहान सिफ्ट',  nameEn:'Morning Shift',  code:'morning',  startTime:'06:00', endTime:'14:00', workHours:8, gracePeriodStart:5, gracePeriodEnd:5, makeDefault:false,active:true, color:'#e3a008', isSystem:false,days:['Sun','Mon','Tue','Wed','Thu','Fri'], exceptionalDayEnabled:false, exceptionalDays:[], winterPolicyEnabled:false, winterPolicy:null },
  { id:3, name:'बेलुकी सिफ्ट', nameEn:'Evening Shift',  code:'evening',  startTime:'14:00', endTime:'22:00', workHours:8, gracePeriodStart:5, gracePeriodEnd:5, makeDefault:false,active:true, color:'#7e3af2', isSystem:false,days:['Sun','Mon','Tue','Wed','Thu','Fri'], exceptionalDayEnabled:false, exceptionalDays:[], winterPolicyEnabled:false, winterPolicy:null },
];
const FB_EMPLOYEES = [
  { id:1,employeeId:'EMP001',fullName:'राम प्रसाद श्रेष्ठ',role:'admin',   department:'IT',        position:'System Administrator',shift:'day',   email:'ram@company.com', phone:'9841234567',joinDate:'2020-01-01',gender:'male',  avatar:'R',active:true },
  { id:2,employeeId:'EMP002',fullName:'सीता देवी पाण्डे',  role:'manager', department:'HR',        position:'HR Manager',          shift:'day',   email:'sita@company.com',phone:'9841234568',joinDate:'2019-06-15',gender:'female',avatar:'S',active:true },
  { id:3,employeeId:'EMP003',fullName:'हरि बहादुर थापा',   role:'employee',department:'Finance',   position:'Accountant',          shift:'morning',email:'hari@company.com',phone:'9841234569',joinDate:'2021-03-01',gender:'male',  avatar:'H',active:true },
];

/* ── localStorage helpers ── */
const lsGet = (key, fallback) => {
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : fallback; } catch { return fallback; }
};
const lsSet = (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} };

export const DataProvider = ({ children }) => {
  const { filterByRole, isAdmin, currentUser } = useAuth();

  const [employees,    setEmployees]    = useState(() => lsGet('ls_employees', []));
  const [shifts,       setShifts]       = useState(() => lsGet('ls_shifts', []));
  const [leaveTypes,   setLeaveTypes]   = useState(() => lsGet('ls_leaveTypes', FB_LEAVE_TYPES));
  const [leaveBalances,setLeaveBalances]= useState(() => lsGet('ls_leaveBalances', []));
  const [leaves,       setLeaves]       = useState(() => lsGet('ls_leaves', []));
  const [officeVisits, setOfficeVisits] = useState(() => lsGet('ls_officeVisits', []));
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

  /* ── Persist state changes to localStorage ── */
  useEffect(() => { lsSet('ls_employees',    employees);    }, [employees]);
  useEffect(() => { lsSet('ls_shifts',       shifts);       }, [shifts]);
  useEffect(() => { lsSet('ls_leaveTypes',   leaveTypes);   }, [leaveTypes]);
  useEffect(() => { lsSet('ls_leaveBalances',leaveBalances);}, [leaveBalances]);
  useEffect(() => { lsSet('ls_leaves',       leaves);       }, [leaves]);
  useEffect(() => { lsSet('ls_officeVisits', officeVisits); }, [officeVisits]);

  /* ── Load all data from API on mount ── */
  useEffect(() => {
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
        /* Merge API data with local-only records (submitted while offline) */
        setLeaves(prev => {
          const apiIds = new Set(lvs.map(l => String(l.id)));
          const localOnly = prev.filter(l => !apiIds.has(String(l.id)));
          return [...lvs, ...localOnly];
        });
        setOfficeVisits(prev => {
          const apiIds = new Set(visits.map(v => String(v.id)));
          const localOnly = prev.filter(v => !apiIds.has(String(v.id)));
          return [...visits, ...localOnly];
        });
        setApiOk(true);
      } catch {
        // API unavailable — use localStorage data, seed fallbacks if empty
        if (!lsGet('ls_employees', null)) setEmployees(FB_EMPLOYEES);
        if (!lsGet('ls_shifts',    null)) setShifts(FB_SHIFTS);
        setApiOk(false);
      }
    })();
  }, []);

  /* ── Employees ── */
  const addEmployee = async (emp) => {
    if (apiOk) { const e = await api.post('/employees', emp); setEmployees(p => [...p, e]); return e; }
    const e = { ...emp, id: Date.now() }; setEmployees(p => [...p, e]); return e;
  };
  const updateEmployee = async (id, data) => {
    if (apiOk) { const e = await api.put(`/employees/${id}`, data); setEmployees(p => p.map(x => x.id===id ? e : x)); return e; }
    setEmployees(p => p.map(x => x.id===id ? { ...x, ...data } : x));
  };
  const deleteEmployee = async (id) => {
    if (apiOk) await api.delete(`/employees/${id}`);
    setEmployees(p => p.filter(x => x.id !== id));
  };
  const getEmployeeById   = (id) => employees.find(e => String(e.id) === String(id));
  const getEmployeeName   = (id) => employees.find(e => String(e.id) === String(id))?.fullName || '-';
  const refreshEmployees  = async () => {
    try { const emps = await api.get('/employees'); setEmployees(emps); lsSet('ls_employees', emps); }
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
  const setDefaultShift  = (shiftCode) => setEmployees(p => p.map(e => ({ ...e, shift: shiftCode })));
  const refreshShifts    = async () => { try { setShifts(await api.get('/shifts')); } catch {} };
  const getShiftByCode   = (code) => shifts.find(s => s.code === code);
  const getShiftById     = (id)   => shifts.find(s => s.id   === id);

  /* ── Leaves ── */
  const addLeave = async (leave) => {
    /* Always save locally first so the record is never lost */
    const localId = Date.now();
    const today   = new Date().toISOString().split('T')[0];
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
  const recommendLeave = async (id, recommendedBy, recoComment='') => {
    const today = new Date().toISOString().split('T')[0];
    setLeaves(p => p.map(x => String(x.id) === String(id)
      ? { ...x, recommendedBy, recommendedDate: today, recoComment }
      : x
    ));
    if (apiOk) {
      try {
        const l = await api.patch(`/leaves/${id}/recommend`, { recommendedBy });
        setLeaves(p => p.map(x => String(x.id) === String(id) ? { ...x, ...l } : x));
      } catch {}
    }
  };
  const updateLeave = async (id, data) => {
    setLeaves(p => p.map(l => String(l.id) === String(id) ? { ...l, ...data } : l));
  };
  const deleteLeave = async (id) => {
    if (apiOk) try { await api.delete(`/leaves/${id}`); } catch {}
    setLeaves(p => p.filter(l => String(l.id) !== String(id)));
  };
  const approveLeave = async (id, approvedBy, comment='') => {
    const today = new Date().toISOString().split('T')[0];
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
    const today = new Date().toISOString().split('T')[0];
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
    const today   = new Date().toISOString().split('T')[0];
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
  const recommendVisit = async (id, recommendedBy, recoComment='') => {
    const today = new Date().toISOString().split('T')[0];
    setOfficeVisits(p => p.map(x => String(x.id) === String(id)
      ? { ...x, recommendedBy, recommendedDate: today, recoComment }
      : x
    ));
    if (apiOk) {
      try {
        const v = await api.patch(`/visits/${id}/recommend`, { recommendedBy, recoComment });
        setOfficeVisits(p => p.map(x => String(x.id) === String(id) ? { ...x, ...v } : x));
      } catch {}
    }
  };
  const updateVisit = async (id, data) => {
    setOfficeVisits(p => p.map(v => String(v.id)===String(id) ? { ...v, ...data } : v));
  };
  const deleteVisit = async (id) => {
    if (apiOk) await api.delete(`/visits/${id}`);
    setOfficeVisits(p => p.filter(v => String(v.id) !== String(id)));
  };
  const approveVisit = async (id, approvedBy, comment='') => {
    const today = new Date().toISOString().split('T')[0];
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
    const today = new Date().toISOString().split('T')[0];
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
      shifts, addShift, updateShift, deleteShift, setDefaultShift, refreshShifts, getShiftByCode, getShiftById,
      leaveTypes, leaveBalances, getLeaveBalance,
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
