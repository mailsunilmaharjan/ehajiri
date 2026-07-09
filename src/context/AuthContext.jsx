import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api, { setToken, setUnauthorizedHandler } from '../api/client.js';

const AuthContext = createContext(null);

/* ── Page-permission storage ─────────────────────────────────────────────────
   Format: {
     roles: { employee: { pageKey: { view, edit } }, ... },
     staff:  { empId:   { pageKey: { view, edit } } }
   }
── */
const PERM_KEY = 'ehajiri_page_permissions';

export const DEFAULT_PAGE_PERMISSIONS = {
  employee: {
    dashboard:             { view: true,  edit: false, delete: false },
    staffDetail:           { view: false, edit: false, delete: false },
    myNotes:               { view: true,  edit: true,  delete: true  },
    staffContact:          { view: true,  edit: true,  delete: false },
    leave:                 { view: true,  edit: false, delete: false },
    leaveApply:            { view: true,  edit: true,  delete: false },
    officeVisitApply:      { view: true,  edit: true,  delete: false },
    leaveApproval:         { view: false, edit: false, delete: false },
    officeVisitApproval:   { view: false, edit: false, delete: false },
    leaveCalculation:      { view: true,  edit: false, delete: false },
    leaveReports:          { view: true,  edit: false, delete: false },
    officeVisitReports:    { view: true,  edit: false, delete: false },
    attendanceDaily:       { view: true,  edit: false, delete: false },
    attendanceLedger:      { view: true,  edit: false, delete: false },
    attendanceHalfMonthly: { view: true,  edit: false, delete: false },
    attendanceMonthly:     { view: true,  edit: false, delete: false },
    attendanceYearly:      { view: true,  edit: false, delete: false },
    dutyRoster:            { view: true,  edit: false, delete: false },
    shift:                 { view: false, edit: false, delete: false },
    settings:              { view: false, edit: false, delete: false },
    attendanceDevice:      { view: false, edit: false, delete: false },
    standaloneDevice:      { view: false, edit: false, delete: false },
  },
  departmentHead: {
    dashboard:             { view: true,  edit: false, delete: false },
    staffDetail:           { view: false, edit: false, delete: false },
    myNotes:               { view: true,  edit: true,  delete: true  },
    staffContact:          { view: true,  edit: true,  delete: false },
    leave:                 { view: true,  edit: false, delete: false },
    leaveApply:            { view: true,  edit: true,  delete: false },
    officeVisitApply:      { view: true,  edit: true,  delete: false },
    leaveApproval:         { view: true,  edit: true,  delete: false },
    officeVisitApproval:   { view: true,  edit: true,  delete: false },
    leaveCalculation:      { view: true,  edit: false, delete: false },
    leaveReports:          { view: true,  edit: false, delete: false },
    officeVisitReports:    { view: true,  edit: false, delete: false },
    attendanceDaily:       { view: true,  edit: false, delete: false },
    attendanceLedger:      { view: true,  edit: false, delete: false },
    attendanceHalfMonthly: { view: true,  edit: false, delete: false },
    attendanceMonthly:     { view: true,  edit: false, delete: false },
    attendanceYearly:      { view: true,  edit: false, delete: false },
    dutyRoster:            { view: true,  edit: true,  delete: true  },
    shift:                 { view: false, edit: false, delete: false },
    settings:              { view: false, edit: false, delete: false },
    attendanceDevice:      { view: false, edit: false, delete: false },
    standaloneDevice:      { view: false, edit: false, delete: false },
  },
  branchManager: {
    dashboard:             { view: true,  edit: false, delete: false },
    staffDetail:           { view: true,  edit: true,  delete: true  },
    myNotes:               { view: true,  edit: true,  delete: true  },
    staffContact:          { view: true,  edit: true,  delete: false },
    leave:                 { view: true,  edit: false, delete: false },
    leaveApply:            { view: true,  edit: true,  delete: false },
    officeVisitApply:      { view: true,  edit: true,  delete: false },
    leaveApproval:         { view: true,  edit: true,  delete: false },
    officeVisitApproval:   { view: true,  edit: true,  delete: false },
    leaveCalculation:      { view: true,  edit: true,  delete: false },
    leaveReports:          { view: true,  edit: false, delete: false },
    officeVisitReports:    { view: true,  edit: false, delete: false },
    attendanceDaily:       { view: true,  edit: false, delete: false },
    attendanceLedger:      { view: true,  edit: false, delete: false },
    attendanceHalfMonthly: { view: true,  edit: false, delete: false },
    attendanceMonthly:     { view: true,  edit: false, delete: false },
    attendanceYearly:      { view: true,  edit: false, delete: false },
    dutyRoster:            { view: true,  edit: true,  delete: true  },
    shift:                 { view: false, edit: false, delete: false },
    settings:              { view: false, edit: false, delete: false },
    attendanceDevice:      { view: false, edit: false, delete: false },
    standaloneDevice:      { view: false, edit: false, delete: false },
  },
  admin: {
    dashboard:             { view: true,  edit: true,  delete: true  },
    staffDetail:           { view: true,  edit: true,  delete: true  },
    myNotes:               { view: true,  edit: true,  delete: true  },
    staffContact:          { view: true,  edit: true,  delete: true  },
    leave:                 { view: true,  edit: true,  delete: true  },
    leaveApply:            { view: true,  edit: true,  delete: true  },
    officeVisitApply:      { view: true,  edit: true,  delete: true  },
    leaveApproval:         { view: true,  edit: true,  delete: true  },
    officeVisitApproval:   { view: true,  edit: true,  delete: true  },
    leaveCalculation:      { view: true,  edit: false, delete: false },
    leaveReports:          { view: true,  edit: true,  delete: true  },
    officeVisitReports:    { view: true,  edit: true,  delete: true  },
    attendanceDaily:       { view: true,  edit: true,  delete: true  },
    attendanceLedger:      { view: true,  edit: true,  delete: true  },
    attendanceHalfMonthly: { view: true,  edit: true,  delete: true  },
    attendanceMonthly:     { view: true,  edit: true,  delete: true  },
    attendanceYearly:      { view: true,  edit: true,  delete: true  },
    dutyRoster:            { view: true,  edit: true,  delete: true  },
    shift:                 { view: true,  edit: true,  delete: true  },
    settings:              { view: true,  edit: true,  delete: true  },
    attendanceDevice:      { view: true,  edit: true,  delete: true  },
    standaloneDevice:      { view: true,  edit: true,  delete: true  },
  },
};

// SuperAdmin = Admin permission table, plus superAdmin-only screens
// (adminAccounts, systemHealth, auditLog) handled via dedicated role flags below —
// it's a strict superset, so it inherits every `admin` page permission verbatim.
DEFAULT_PAGE_PERMISSIONS.superAdmin = {
  ...DEFAULT_PAGE_PERMISSIONS.admin,
  myNotes:       { view: true, edit: true, delete: true },
  staffContact:  { view: true, edit: true, delete: true },
  dutyRoster:    { view: true, edit: true, delete: true },
  adminAccounts: { view: true, edit: true, delete: true },
  systemHealth:  { view: true, edit: false, delete: false },
  auditLog:      { view: true, edit: false, delete: false },
};

const loadPerms = () => {
  try { return JSON.parse(localStorage.getItem(PERM_KEY) || 'null'); } catch { return null; }
};

export const savePagePermissions = (perms) => {
  localStorage.setItem(PERM_KEY, JSON.stringify(perms));
};

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(() => {
    try { const s = localStorage.getItem('current_user'); return s ? JSON.parse(s) : null; }
    catch { return null; }
  });
  const [error,          setError]          = useState('');
  const [licenseError,   setLicenseError]   = useState(false);
  const [licenseChecked, setLicenseChecked] = useState(false);
  const [USERS,          setUSERS]          = useState([]);
  const [pagePerms,      setPagePerms]      = useState(loadPerms);

  /* ── Check license on every app load ── */
  useEffect(() => {
    api.get('/license/status')
      .then(d => {
        if (!d.licensed || d.expired) {
          setLicenseError(true);
          setCurrentUser(null);
          localStorage.removeItem('current_user');
        }
      })
      .catch(() => {
        setLicenseError(true);
        setCurrentUser(null);
        localStorage.removeItem('current_user');
      })
      .finally(() => setLicenseChecked(true));
  }, []);

  /* ── Login ── */
  const login = async (username, password) => {
    setError('');
    setLicenseError(false);
    try {
      const { token, ...user } = await api.post('/auth/login', { username, password });
      setCurrentUser(user);
      localStorage.setItem('current_user', JSON.stringify(user));
      setToken(token);
      setPagePerms(loadPerms());
      try { const all = await api.get('/auth/users'); setUSERS(all); } catch {}
      return true;
    } catch (err) {
      const data = err?.response?.data || err?.data || {};
      if (data.licenseError) { setLicenseError(true); return false; }
      setError('इमेल वा पासवर्ड गलत छ');
      return false;
    }
  };

  const logout = useCallback(() => {
    setCurrentUser(null);
    localStorage.removeItem('current_user');
    setToken(null);
  }, []);

  // Wire up: a 401 with authError (expired/invalid token) triggers a clean logout.
  useEffect(() => {
    setUnauthorizedHandler(() => logout());
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  const refreshPagePerms = useCallback(() => {
    setPagePerms(loadPerms());
  }, []);

  /* ── Role flags ── */
  const isSuperAdmin    = currentUser?.role === 'superAdmin';
  const isAdmin         = currentUser?.role === 'admin' || isSuperAdmin;
  const isBranchManager = currentUser?.role === 'branchManager';
  const isDeptHead      = currentUser?.role === 'departmentHead';
  const isEmployee      = !isAdmin && !isBranchManager && !isDeptHead;

  // Legacy alias kept for existing usages
  const isManager       = isAdmin || isBranchManager;

  // Can add / edit / delete staff (within own scope)
  const canManageStaff  = isAdmin || isBranchManager;

  // Can approve leave / office visits
  const canApprove      = isAdmin || isBranchManager || isDeptHead;

  // Can access settings, shifts, license, backup
  const canManageSystem = isAdmin;

  // Can view any reports (dept head and above)
  const canViewReports  = isAdmin || isBranchManager || isDeptHead;

  // Any authenticated user can view their own data
  const canViewOwnReports = !!currentUser;

  /* ── Page permission helpers ─────────────────────────────────────────────
     Resolution order: staff override → role setting → default
  ── */
  const getPagePerm = useCallback((pageKey) => {
    if (!currentUser) return { view: false, edit: false };
    if (isAdmin) return { view: true, edit: true };
    // Contact directory is shared, low-risk info (names/phone numbers) — always
    // fully open for every role regardless of any Role Management override.
    if (pageKey === 'staffContact') return { view: true, edit: true, delete: false };

    const role = currentUser.role || 'employee';
    const uid  = String(currentUser.id);

    // 1. Staff-specific override
    const staffPerm = pagePerms?.staff?.[uid]?.[pageKey];
    if (staffPerm !== undefined) return staffPerm;

    // 2. Role-level setting (from saved perms)
    const rolePerm = pagePerms?.roles?.[role]?.[pageKey];
    if (rolePerm !== undefined) return rolePerm;

    // 3. Built-in default
    return DEFAULT_PAGE_PERMISSIONS[role]?.[pageKey] || { view: false, edit: false };
  }, [currentUser, isAdmin, pagePerms]);

  const canView   = useCallback((pageKey) => getPagePerm(pageKey).view,   [getPagePerm]);
  const canEdit   = useCallback((pageKey) => getPagePerm(pageKey).edit,   [getPagePerm]);
  const canDelete = useCallback((pageKey) => getPagePerm(pageKey).delete, [getPagePerm]);

  /* ── Scope filter ──────────────────────────────────────────────────────────
     Returns the subset of employees this user is allowed to see/manage.
     Admin → all  |  BranchManager → own branch  |  DeptHead → own dept  |
     Employee → own record only.
  ── */
  const filterByRole = useCallback((empList = []) => {
    if (!currentUser) return [];
    if (isAdmin) return empList;
    if (isBranchManager) {
      const myBranch = (currentUser.branch || '').toLowerCase().trim();
      return empList.filter(e => (e.branch || '').toLowerCase().trim() === myBranch);
    }
    if (isDeptHead) {
      const myDept = (currentUser.department || '').toLowerCase().trim();
      return empList.filter(e => (e.department || '').toLowerCase().trim() === myDept);
    }
    // Employee: own record only
    return empList.filter(e => String(e.id) === String(currentUser.id));
  }, [currentUser, isAdmin, isBranchManager, isDeptHead]);

  return (
    <AuthContext.Provider value={{
      currentUser, login, logout, error,
      licenseError, licenseChecked,
      // Role flags
      isAdmin, isSuperAdmin, isBranchManager, isDeptHead, isEmployee,
      // Legacy
      isManager,
      // Permission helpers
      canManageStaff, canApprove, canManageSystem, canViewReports, canViewOwnReports,
      // Page-level permission helpers
      canView, canEdit, canDelete, getPagePerm, refreshPagePerms,
      // Scope helper
      filterByRole,
      USERS,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};

export default AuthContext;
