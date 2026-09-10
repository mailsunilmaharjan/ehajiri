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
    recoApprovalConfig:    { view: false, edit: false, delete: false },
    myNotes:               { view: true,  edit: true,  delete: true  },
    task:                  { view: true,  edit: true,  delete: true  },
    staffContact:          { view: true,  edit: true,  delete: false },
    leave:                 { view: true,  edit: false, delete: false },
    leaveApply:            { view: true,  edit: true,  delete: false },
    officeVisitApply:      { view: true,  edit: true,  delete: false },
    manualPostingApply:    { view: true,  edit: true,  delete: false },
    missingAttendanceApply: { view: true, edit: true,  delete: false },
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
    overtime:              { view: true,  edit: false, delete: false },
    onlineAttendance:      { view: false, edit: false, delete: false },
    manualPostings:        { view: false, edit: false, delete: false },
    missingAttendanceRequests: { view: false, edit: false, delete: false },
    shift:                 { view: false, edit: false, delete: false },
    settings:              { view: false, edit: false, delete: false },
    attendanceDevice:      { view: false, edit: false, delete: false },
    standaloneDevice:      { view: false, edit: false, delete: false },
    eventVisitorRegistration: { view: false, edit: true, delete: false },
    staffAnalytics:        { view: false, edit: false, delete: false },
  },
  departmentHead: {
    dashboard:             { view: true,  edit: false, delete: false },
    staffDetail:           { view: false, edit: false, delete: false },
    recoApprovalConfig:    { view: true,  edit: true,  delete: false },
    myNotes:               { view: true,  edit: true,  delete: true  },
    task:                  { view: true,  edit: true,  delete: true  },
    staffContact:          { view: true,  edit: true,  delete: false },
    leave:                 { view: true,  edit: false, delete: false },
    leaveApply:            { view: true,  edit: true,  delete: false },
    officeVisitApply:      { view: true,  edit: true,  delete: false },
    manualPostingApply:    { view: true,  edit: true,  delete: false },
    missingAttendanceApply: { view: true, edit: true,  delete: false },
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
    overtime:              { view: true,  edit: true,  delete: false },
    onlineAttendance:      { view: false, edit: false, delete: false },
    manualPostings:        { view: false, edit: false, delete: false },
    missingAttendanceRequests: { view: true, edit: true, delete: false },
    shift:                 { view: false, edit: false, delete: false },
    settings:              { view: false, edit: false, delete: false },
    attendanceDevice:      { view: false, edit: false, delete: false },
    standaloneDevice:      { view: false, edit: false, delete: false },
    eventVisitorRegistration: { view: false, edit: true, delete: false },
    staffAnalytics:        { view: false, edit: false, delete: false },
  },
  branchManager: {
    dashboard:             { view: true,  edit: false, delete: false },
    staffDetail:           { view: true,  edit: true,  delete: true  },
    recoApprovalConfig:    { view: true,  edit: true,  delete: false },
    myNotes:               { view: true,  edit: true,  delete: true  },
    task:                  { view: true,  edit: true,  delete: true  },
    staffContact:          { view: true,  edit: true,  delete: false },
    leave:                 { view: true,  edit: false, delete: false },
    leaveApply:            { view: true,  edit: true,  delete: false },
    officeVisitApply:      { view: true,  edit: true,  delete: false },
    manualPostingApply:    { view: true,  edit: true,  delete: false },
    missingAttendanceApply: { view: true, edit: true,  delete: false },
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
    overtime:              { view: true,  edit: true,  delete: false },
    onlineAttendance:      { view: true,  edit: true,  delete: false },
    manualPostings:        { view: true,  edit: true,  delete: false },
    missingAttendanceRequests: { view: true, edit: true, delete: false },
    shift:                 { view: false, edit: false, delete: false },
    settings:              { view: false, edit: false, delete: false },
    attendanceDevice:      { view: false, edit: false, delete: false },
    standaloneDevice:      { view: false, edit: false, delete: false },
    eventVisitorRegistration: { view: false, edit: true, delete: false },
    staffAnalytics:        { view: false, edit: false, delete: false },
  },
  admin: {
    dashboard:             { view: true,  edit: true,  delete: true  },
    staffDetail:           { view: true,  edit: true,  delete: true  },
    recoApprovalConfig:    { view: true,  edit: true,  delete: true  },
    myNotes:               { view: true,  edit: true,  delete: true  },
    task:                  { view: true,  edit: true,  delete: true  },
    staffContact:          { view: true,  edit: true,  delete: true  },
    leave:                 { view: true,  edit: true,  delete: true  },
    leaveApply:            { view: true,  edit: true,  delete: true  },
    officeVisitApply:      { view: true,  edit: true,  delete: true  },
    manualPostingApply:    { view: true,  edit: true,  delete: true  },
    missingAttendanceApply: { view: true, edit: true,  delete: true  },
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
    overtime:              { view: true,  edit: true,  delete: true  },
    onlineAttendance:      { view: true,  edit: true,  delete: true  },
    manualPostings:        { view: true,  edit: true,  delete: true  },
    missingAttendanceRequests: { view: true, edit: true, delete: true },
    shift:                 { view: true,  edit: true,  delete: true  },
    settings:              { view: true,  edit: true,  delete: true  },
    attendanceDevice:      { view: true,  edit: true,  delete: true  },
    standaloneDevice:      { view: true,  edit: true,  delete: true  },
    eventVisitorRegistration: { view: true,  edit: true,  delete: true  },
    staffAnalytics:        { view: true,  edit: true,  delete: true  },
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

// Branch Area Manager / Department Incharge — same page permissions as the
// role they extend (branchManager / departmentHead respectively); the only
// difference is how WIDE their org scope is (several branches/departments
// instead of one), which is resolved separately via manager_branch_coverage
// / manager_department_coverage — see orgScope.js and filterByRole below.
DEFAULT_PAGE_PERMISSIONS.branchAreaManager  = { ...DEFAULT_PAGE_PERMISSIONS.branchManager };
DEFAULT_PAGE_PERMISSIONS.departmentIncharge = { ...DEFAULT_PAGE_PERMISSIONS.departmentHead };

const loadPerms = () => {
  try { return JSON.parse(localStorage.getItem(PERM_KEY) || 'null'); } catch { return null; }
};

export const savePagePermissions = (perms) => {
  localStorage.setItem(PERM_KEY, JSON.stringify(perms));
};

// Shared tail of any successful authentication — plain login, or an
// already-authenticated result handed over by the SSO exchange (see
// AuthProvider's applySsoSession below). Takes its setters as params rather
// than closing over component state, so it can live outside the component
// instead of being redeclared on every render.
async function applySession(result, { setCurrentUser, setToken, setPagePerms, setUSERS }) {
  const { token, ...user } = result;
  setCurrentUser(user);
  localStorage.setItem('current_user', JSON.stringify(user));
  setToken(token);
  setPagePerms(loadPerms());
  try { const all = await api.get('/auth/users'); setUSERS(all); } catch {}
}

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(() => {
    try { const s = localStorage.getItem('current_user'); return s ? JSON.parse(s) : null; }
    catch { return null; }
  });
  const [error,          setError]          = useState('');
  const [licenseError,   setLicenseError]   = useState(false);
  const [licenseChecked, setLicenseChecked] = useState(false);
  // Who to contact to renew — shown on the Subscription Expired screen.
  // Populated from whichever response actually flagged the license problem
  // (initial status check, a blocked login attempt), since either one may
  // be the first thing that runs depending on whether a session existed.
  const [licenseDistributor, setLicenseDistributor] = useState(null);
  // Set from a SUCCESSFUL login's response when the active license expires
  // within the warning window — an informational one-time popup, not a block.
  const [licenseWarning, setLicenseWarning] = useState(null);
  const [USERS,          setUSERS]          = useState([]);
  const [pagePerms,      setPagePerms]      = useState(loadPerms);

  const distributorFrom = (d) => ({
    name       : d?.distributorName        || '',
    contactName: d?.distributorContactName || '',
    phone      : d?.distributorPhone       || '',
    email      : d?.distributorEmail       || '',
  });

  /* ── Check license on every app load ── */
  useEffect(() => {
    api.get('/license/status')
      .then(d => {
        if (!d.licensed || d.expired) {
          setLicenseError(true);
          setLicenseDistributor(distributorFrom(d));
          setCurrentUser(null);
          localStorage.removeItem('current_user');
        }
      })
      .catch((err) => {
        // /license/status answers 200 with { licensed } even when unlicensed,
        // so landing here means the request never got a verdict — server not
        // up yet, proxy hiccup, or the fetch was aborted by a navigation.
        // Only a response that explicitly flags a license problem may lock
        // the app; anything else must NOT destroy a valid session (this used
        // to wipe current_user on every reload that raced the check).
        if (err?.data?.licenseError) {
          setLicenseError(true);
          setLicenseDistributor(distributorFrom(err.data));
          setCurrentUser(null);
          localStorage.removeItem('current_user');
        }
      })
      .finally(() => setLicenseChecked(true));
  }, []);

  /* ── Login ── */
  const login = async (username, password) => {
    setError('');
    setLicenseError(false);
    try {
      const result = await api.post('/auth/login', { username, password });
      if (result.licenseWarning) setLicenseWarning(result.licenseWarning);
      // Shared-hub login only: this email belongs to a different company —
      // the server never touched a password for it, just told us where to
      // send the browser. Full navigation (not client-side routing) to that
      // tenant's own path prefix (/t/<subdomain>/...) on this SAME domain —
      // no subdomain DNS involved at all. The email itself travels as an
      // opaque, short-lived token (?et=...), not in the clear — the
      // destination page exchanges it server-side instead of it ever
      // sitting in the URL bar/history/access logs.
      if (result.redirect && result.subdomain) {
        // localStorage is origin-scoped, not tenant-scoped — without this,
        // the destination page's very first render would briefly show
        // THIS tenant's cached identity (AuthProvider reads it
        // synchronously on mount) until its first API call 401s.
        logout();
        const qs = result.redirectToken ? `?et=${encodeURIComponent(result.redirectToken)}` : '';
        window.location.href = `/t/${result.subdomain}/login${qs}`;
        return true;
      }
      await applySession(result, { setCurrentUser, setToken, setPagePerms, setUSERS });
      return true;
    } catch (err) {
      const data = err?.response?.data || err?.data || {};
      if (data.licenseError) {
        setLicenseError(true);
        setLicenseDistributor(distributorFrom(data));
        return false;
      }
      setError('इमेल वा पासवर्ड गलत छ');
      return false;
    }
  };

  const logout = useCallback(() => {
    setCurrentUser(null);
    localStorage.removeItem('current_user');
    setToken(null);
  }, []);

  // Used by the SsoLogin page only — it already has a full {token, ...user}
  // result from GET /auth/sso-exchange (LicenseAdmin's "Open Software"
  // action), so there's no /auth/login round-trip to make here, just the
  // same session bookkeeping a normal login ends with.
  const applySsoSession = useCallback((result) => {
    logout(); // same stale-identity guard as the cross-tenant redirect above
    if (result.licenseWarning) setLicenseWarning(result.licenseWarning);
    return applySession(result, { setCurrentUser, setToken, setPagePerms, setUSERS });
  }, [logout]);

  /* Merge a patch into the logged-in user (e.g. a new profile photo) and
     keep the localStorage copy in sync so it survives reloads. */
  const updateCurrentUser = useCallback((patch) => {
    setCurrentUser(prev => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      localStorage.setItem('current_user', JSON.stringify(next));
      return next;
    });
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
  const isSuperAdmin       = currentUser?.role === 'superAdmin';
  const isAdmin            = currentUser?.role === 'admin' || isSuperAdmin;
  const isBranchManager    = currentUser?.role === 'branchManager';
  const isDeptHead         = currentUser?.role === 'departmentHead';
  // Cover SEVERAL branches / (department, branch) pairs instead of one —
  // see manager_branch_coverage / manager_department_coverage (migration
  // v138) and orgScope.js. Same page permissions as branchManager/
  // departmentHead (DEFAULT_PAGE_PERMISSIONS above), just a wider org scope.
  const isBranchAreaManager = currentUser?.role === 'branchAreaManager';
  const isDeptIncharge      = currentUser?.role === 'departmentIncharge';
  const isEmployee      = !isAdmin && !isBranchManager && !isDeptHead && !isBranchAreaManager && !isDeptIncharge;

  // Legacy alias kept for existing usages
  const isManager       = isAdmin || isBranchManager || isBranchAreaManager;

  // Can add / edit / delete staff (within own scope)
  const canManageStaff  = isAdmin || isBranchManager || isBranchAreaManager;

  // Can approve leave / office visits
  const canApprove      = isAdmin || isBranchManager || isDeptHead || isBranchAreaManager || isDeptIncharge;

  // Can access settings, shifts, license, backup
  const canManageSystem = isAdmin;

  // Can view any reports (dept head and above)
  const canViewReports  = isAdmin || isBranchManager || isDeptHead || isBranchAreaManager || isDeptIncharge;

  // Any authenticated user can view their own data
  const canViewOwnReports = !!currentUser;

  /* ── Page permission helpers ─────────────────────────────────────────────
     Resolution order: staff override → role setting → default
  ── */
  const getPagePerm = useCallback((pageKey) => {
    if (!currentUser) return { view: false, edit: false, delete: false };
    if (isAdmin) return { view: true, edit: true, delete: true };
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
      const myDept   = (currentUser.department || '').toLowerCase().trim();
      const myBranch = (currentUser.branch || '').toLowerCase().trim();
      // A Dept Head is scoped to their own branch too, not the whole
      // department company-wide — mirrors orgScope.js's resolveOrgScope on
      // the server (see its comment for why: a multi-branch department
      // otherwise leaks every other branch's staff into their view).
      return empList.filter(e =>
        (e.department || '').toLowerCase().trim() === myDept &&
        (!myBranch || (e.branch || '').toLowerCase().trim() === myBranch)
      );
    }
    if (isBranchAreaManager) {
      // coverageBranches: plain branch-name strings, attached to currentUser
      // at login (see auth.js's attachCoverage) from manager_branch_coverage.
      const covered = new Set((currentUser.coverageBranches || []).map(b => b.toLowerCase().trim()));
      return empList.filter(e => covered.has((e.branch || '').toLowerCase().trim()));
    }
    if (isDeptIncharge) {
      // coverageDepartments: [{department, branch}] — branch:null means
      // "that department, every branch" (see attachCoverage/migration v138).
      const covered = (currentUser.coverageDepartments || []).map(c => ({
        department: (c.department || '').toLowerCase().trim(),
        branch: c.branch ? c.branch.toLowerCase().trim() : null,
      }));
      return empList.filter(e => {
        const eDept   = (e.department || '').toLowerCase().trim();
        const eBranch = (e.branch || '').toLowerCase().trim();
        return covered.some(c => c.department === eDept && (c.branch === null || c.branch === eBranch));
      });
    }
    // Employee: own record only
    return empList.filter(e => String(e.id) === String(currentUser.id));
  }, [currentUser, isAdmin, isBranchManager, isDeptHead, isBranchAreaManager, isDeptIncharge]);

  return (
    <AuthContext.Provider value={{
      currentUser, login, logout, applySsoSession, updateCurrentUser, error,
      licenseError, licenseChecked, licenseDistributor,
      licenseWarning, dismissLicenseWarning: () => setLicenseWarning(null),
      // Role flags
      isAdmin, isSuperAdmin, isBranchManager, isDeptHead, isEmployee,
      isBranchAreaManager, isDeptIncharge,
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
