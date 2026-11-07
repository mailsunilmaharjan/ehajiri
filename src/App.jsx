import React, { lazy, Suspense } from 'react';
import LoadingIndicator from './components/Common/LoadingIndicator.jsx';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { ModuleFlagsProvider, useModuleFlags } from './context/ModuleFlagsContext.jsx';
import useRecoApproval from './hooks/useRecoApproval.js';
import Layout from './components/Layout/Layout.jsx';
import { isMobileMode } from './utils/native.js';
import Login         from './components/Auth/Login.jsx';
import SsoLogin      from './components/Auth/SsoLogin.jsx';
import GuestCheckin  from './components/Public/GuestCheckin.jsx';
import PrivacyPolicy from './components/Public/PrivacyPolicy.jsx';
import ResetPassword from './components/Auth/ResetPassword.jsx';
import LicenseWarningModal from './components/Auth/LicenseWarningModal.jsx';
import BroadcastPopup from './components/Common/BroadcastPopup.jsx';
import Dashboard from './components/Dashboard/Dashboard.jsx';
// Every other page is code-split (React.lazy) — Login/Dashboard/Layout above
// stay eager since they're needed for first paint regardless; everything
// below is only fetched once its route is actually visited, instead of all
// ~58 pages shipping in one bundle every user downloads up front (see the
// "chunks are larger than 500 kB" build warning this was written to fix).
const LeaveVisitPage = lazy(() => import('./components/Leave/LeaveVisitPage.jsx'));
const LeaveApplication = lazy(() => import('./components/Leave/LeaveApplication.jsx'));
const LeaveApproval = lazy(() => import('./components/Leave/LeaveApproval.jsx'));
const LeaveCalculation = lazy(() => import('./components/Leave/LeaveCalculation.jsx'));
const LeaveReports = lazy(() => import('./components/Leave/LeaveReports.jsx'));
const OfficeVisitApplication = lazy(() => import('./components/OfficeVisit/OfficeVisitApplication.jsx'));
const OfficeVisitApproval = lazy(() => import('./components/OfficeVisit/OfficeVisitApproval.jsx'));
const OfficeVisitReports = lazy(() => import('./components/OfficeVisit/OfficeVisitReports.jsx'));
const ShiftManagement        = lazy(() => import('./components/Shift/ShiftManagement.jsx'));
const UserManagement         = lazy(() => import('./components/Users/UserManagement.jsx'));
const StaffNotes             = lazy(() => import('./components/Staff/StaffNotes.jsx'));
const StaffContact           = lazy(() => import('./components/Staff/StaffContact.jsx'));
const EventVisitorRegistration = lazy(() => import('./components/Staff/EventVisitorRegistration.jsx'));
const StaffAnalyticsReport   = lazy(() => import('./components/Staff/StaffAnalyticsReport.jsx'));
const TaskList               = lazy(() => import('./components/Staff/TaskList.jsx'));
const TaskLookupPage         = lazy(() => import('./components/Staff/TaskLookupPage.jsx'));
const TaskDashboard          = lazy(() => import('./components/Staff/TaskDashboard.jsx'));
const PayrollDashboard       = lazy(() => import('./components/Payroll/PayrollDashboard.jsx'));
const PayrollItems           = lazy(() => import('./components/Payroll/PayrollItems.jsx'));
const PayrollTaxSlab         = lazy(() => import('./components/Payroll/PayrollTaxSlab.jsx'));
const PayrollReports         = lazy(() => import('./components/Payroll/PayrollReports.jsx'));
const PayrollRates           = lazy(() => import('./components/Payroll/PayrollRates.jsx'));
const PayrollSalary          = lazy(() => import('./components/Payroll/PayrollSalary.jsx'));
const PayrollAdvances        = lazy(() => import('./components/Payroll/PayrollAdvances.jsx'));
const PayrollRun             = lazy(() => import('./components/Payroll/PayrollRun.jsx'));
const PayrollLedger          = lazy(() => import('./components/Payroll/PayrollLedger.jsx'));
const PayrollScales          = lazy(() => import('./components/Payroll/PayrollScales.jsx'));
const MobileLogin            = lazy(() => import('./mobile/MobileLogin.jsx'));
const MobileHome             = lazy(() => import('./mobile/MobileHome.jsx'));
const MobileAttendance       = lazy(() => import('./mobile/MobileAttendance.jsx'));
const MobileLeave            = lazy(() => import('./mobile/MobileLeave.jsx'));
const MobileInbox            = lazy(() => import('./mobile/MobileInbox.jsx'));
const MobileMore             = lazy(() => import('./mobile/MobileMore.jsx'));
const MobilePayslips         = lazy(() => import('./mobile/MobilePayslips.jsx'));
import AppUpdate from './components/Common/AppUpdate.jsx';
const MobileDevices = lazy(() => import('./mobile/MobileAdmin.jsx'));
const MobileRoster           = lazy(() => import('./mobile/MobileRoster.jsx'));
const MobileApprovals        = lazy(() => import('./mobile/MobileApprovals.jsx'));
const MobileTasks            = lazy(() => import('./mobile/MobileTasks.jsx'));
const MobileProfile          = lazy(() => import('./mobile/MobileProfile.jsx'));
const MyPayslips             = lazy(() => import('./components/Payroll/MyPayslips.jsx'));
const TaskSettings           = lazy(() => import('./components/Staff/TaskSettings.jsx'));
const StaffMessage           = lazy(() => import('./components/Staff/StaffMessage.jsx'));
const ChatPage                = lazy(() => import('./components/Chat/ChatPage.jsx'));
const Settings               = lazy(() => import('./components/Settings/Settings.jsx'));
const LicensePage            = lazy(() => import('./components/Settings/LicensePage.jsx'));
const RoleManagement         = lazy(() => import('./components/Settings/RoleManagement.jsx'));
const DailyAttendanceReport    = lazy(() => import('./components/Attendance/DailyAttendanceReport.jsx'));
const HalfMonthlyReport       = lazy(() => import('./components/Attendance/HalfMonthlyReport.jsx'));
const MonthlyReport           = lazy(() => import('./components/Attendance/MonthlyReport.jsx'));
const StaffLedger             = lazy(() => import('./components/Attendance/StaffLedger.jsx'));
const PresentAbsentReport     = lazy(() => import('./components/Attendance/PresentAbsentReport.jsx'));
const HalfSummaryReport       = lazy(() => import('./components/Attendance/HalfSummaryReport.jsx'));
const HalfAbsentReport        = lazy(() => import('./components/Attendance/HalfAbsentReport.jsx'));
const HalfLateEarlyReport          = lazy(() => import('./components/Attendance/HalfLateEarlyReport.jsx'));
const MonthlyPresentAbsentReport   = lazy(() => import('./components/Attendance/MonthlyPresentAbsentReport.jsx'));
const MonthlySummaryReport         = lazy(() => import('./components/Attendance/MonthlySummaryReport.jsx'));
const MonthlyInOutReport           = lazy(() => import('./components/Attendance/MonthlyInOutReport.jsx'));
const MonthlyAbsentReport          = lazy(() => import('./components/Attendance/MonthlyAbsentReport.jsx'));
const MonthlyLateEarlyReport       = lazy(() => import('./components/Attendance/MonthlyLateEarlyReport.jsx'));
const HalfInOutReport         = lazy(() => import('./components/Attendance/HalfInOutReport.jsx'));
const YearlyReport                   = lazy(() => import('./components/Attendance/YearlyReport.jsx'));
const OvertimePage                   = lazy(() => import('./components/Attendance/OvertimePage.jsx'));
const YearlyPresentAbsentReport      = lazy(() => import('./components/Attendance/YearlyPresentAbsentReport.jsx'));
const YearlyInOutReport              = lazy(() => import('./components/Attendance/YearlyInOutReport.jsx'));
const YearlyAbsentReport             = lazy(() => import('./components/Attendance/YearlyAbsentReport.jsx'));
const YearlyLateEarlyReport          = lazy(() => import('./components/Attendance/YearlyLateEarlyReport.jsx'));
const DutyRoster                     = lazy(() => import('./components/Attendance/DutyRoster.jsx'));
const DutyRosterDeptWise             = lazy(() => import('./components/Attendance/DutyRosterDeptWise.jsx'));
const RosterDashboard                = lazy(() => import('./components/Attendance/RosterDashboard.jsx'));
const RosterReport                   = lazy(() => import('./components/Attendance/RosterReport.jsx'));
const ManualPostings                 = lazy(() => import('./components/Attendance/ManualPostings.jsx'));
const MissingAttendanceRequests      = lazy(() => import('./components/Attendance/MissingAttendanceRequests.jsx'));
const OnlineAttendanceApproval       = lazy(() => import('./components/Attendance/OnlineAttendanceApproval.jsx'));
const ProfilePage                    = lazy(() => import('./components/Profile/ProfilePage.jsx'));
const RecoApprovalPage               = lazy(() => import('./components/Users/RecoApprovalPage.jsx'));

// Wraps a requireManager page when the plain branchManager/admin role check
// already failed — admits a user who is nonetheless individually configured
// as SOMEONE's recommender/approver via "Set Recommendator & Approval" (a
// per-person assignment, independent of holding the manager role). Without
// this, a Staff-role user configured as e.g. a Workshop Incharge's approver
// for their team could act on those applications right from the Dashboard
// but got bounced straight back to it the moment they tried to open the
// actual approval page (via "View All" or direct link) — the role gate and
// the per-person assignment are two unrelated systems, and only the role
// gate was being checked here. Mirrors Dashboard.jsx's canSeePendingApprovals.
// A separate component (not inline in Protected) so the reco-approval fetch
// only happens for the requireManager routes that actually opt into this
// fallback, and only once the role check has already failed — every other
// protected route pays no extra cost.
const RecoApproverGate = ({ children }) => {
  const { currentUser } = useAuth();
  const { assignments, loaded } = useRecoApproval();
  if (!loaded) return <Layout><LoadingIndicator label="Loading…" /></Layout>;
  const isConfiguredRecoOrApprover = Object.entries(assignments || {}).some(([key, cfg]) => {
    if (key === '_settings') return false;
    const reco     = Array.isArray(cfg?.reco)     ? cfg.reco     : (cfg?.reco     != null ? [cfg.reco]     : []);
    const approval = Array.isArray(cfg?.approval) ? cfg.approval : (cfg?.approval != null ? [cfg.approval] : []);
    return reco.map(String).includes(String(currentUser.id)) || approval.map(String).includes(String(currentUser.id));
  });
  if (!isConfiguredRecoOrApprover) return <Navigate to="/dashboard" replace />;
  // children here can be a React.lazy() page (LeaveApproval/OfficeVisitApproval/
  // ManualPostings, the only allowRecoApprover routes) — needs its own Suspense
  // boundary since this return bypasses Protected's own one below.
  return <Suspense fallback={<LoadingIndicator label="Loading…" />}>{children}</Suspense>;
};

/*
  Role access matrix
  ──────────────────────────────────────────────────────────────────
  requireAdmin      → admin only
  requireManager    → admin + branchManager
  allowRecoApprover → (with requireManager) also admits a non-manager who is
                       individually configured as some employee's
                       recommender/approver — see RecoApproverGate above.
                       Only use on pages that are themselves scoped to that
                       assignment (Leave/Office Visit/Manual Postings
                       approval) — never on pages like User Management that
                       must stay manager-role-only regardless.
  requireReports    → admin + branchManager + departmentHead
  pageKey           → checked via canView(pageKey) (page-permission system)
  moduleKey         → checked via useModuleFlags() (tenant-wide on/off switch,
                       Settings → Role & Permission → Module Controls) — an
                       ADDITIONAL gate layered in front of pageKey/role checks,
                       not a replacement for them (e.g. Duty Roster: the module
                       must be on AND the viewer's role/pageKey checks must pass)
  (no flag)         → any authenticated user
*/
const Protected = ({
  children,
  requireAdmin      = false,
  requireManager    = false,
  allowRecoApprover = false,
  requireReports    = false,
  pageKey           = null,
  moduleKey         = null,
}) => {
  const { currentUser, isAdmin, isManager, canViewReports, canView, permsLoaded } = useAuth();
  const { flags: moduleFlags, loading: moduleFlagsLoading } = useModuleFlags();
  if (!currentUser) return <Navigate to="/login" replace />;
  // Don't decide page access from built-in defaults while the saved
  // role/staff permissions are still being fetched from the server.
  if (pageKey && !isAdmin && !permsLoaded) return null;
  if (requireAdmin   && !isAdmin)        return <Navigate to="/dashboard" replace />;
  // pageKey may be a single key, or an array of keys where ANY granting view
  // access is enough (e.g. a combined page reachable via either of two
  // permissions — mirrors the equivalent OR check already used to decide
  // whether to show its nav link).
  const pageKeys = Array.isArray(pageKey) ? pageKey : (pageKey ? [pageKey] : []);
  const hasPageAccess = !pageKeys.length || pageKeys.some(k => canView(k));
  if (requireManager && !isManager) {
    if (allowRecoApprover && hasPageAccess) return <RecoApproverGate>{children}</RecoApproverGate>;
    return <Navigate to="/dashboard" replace />;
  }
  if (requireReports && !canViewReports) return <Navigate to="/dashboard" replace />;
  if (!hasPageAccess) return <Navigate to="/dashboard" replace />;
  if (moduleKey) {
    if (moduleFlagsLoading) return <Layout><LoadingIndicator label="Loading…" /></Layout>;
    if (!moduleFlags[`${moduleKey}Enabled`]) {
      return (
        <Layout>
          <div className="page-container">
            <div style={{ maxWidth: 480, margin: '60px auto', textAlign: 'center', background: '#fff7ed',
              border: '1px solid #fed7aa', borderRadius: 12, padding: '32px 28px' }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>🗓️</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#111827' }}>This module is disabled</div>
              <div style={{ fontSize: 13, color: '#9a3412', marginTop: 8, lineHeight: 1.5 }}>
                Ask a Super Admin to enable it in Settings → Role & Permission Management.
              </div>
            </div>
          </div>
        </Layout>
      );
    }
  }
  return (
    <Layout>
      <Suspense fallback={<LoadingIndicator label="Loading…" />}>
        {children}
      </Suspense>
    </Layout>
  );
};

/* The /m/* phone screens exist only in the Android app (or a browser opened with ?mobile=1). Desktop users are sent to the normal dashboard. */
const MobileOnly = ({ children }) => (isMobileMode() ? children : <Navigate to="/dashboard" replace />);

const App = () => {
  const { currentUser } = useAuth();

  return (
    <ModuleFlagsProvider>
    <LicenseWarningModal />
    <AppUpdate />
    <BroadcastPopup />
    <Routes>
      <Route path="/login" element={
        isMobileMode() ? <Suspense fallback={null}><MobileLogin /></Suspense> /* it redirects a signed-in user itself, so it can first ask about fingerprint sign-in */
          : currentUser ? <Navigate to="/dashboard" replace /> : <Login />
      } />
      {/* Not gated on currentUser like /login — "Open Software (Admin)" vs
          "(Super Admin)" is an explicit choice of WHICH identity to become,
          so it always runs (and overrides any existing session) rather than
          bouncing straight to whoever's already logged in. */}
      <Route path="/sso-login" element={<SsoLogin />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      {/* Public — scanned from a "Scan to Check In" QR, no eHajiri login */}
      <Route path="/checkin/:token" element={<GuestCheckin />} />
      <Route path="/privacy" element={<PrivacyPolicy />} />

      <Route path="/dashboard" element={
        isMobileMode() ? <Navigate to="/m/home" replace /> : <Protected><Dashboard /></Protected>
      } />
      <Route path="/m/home" element={<MobileOnly><Protected><MobileHome /></Protected></MobileOnly>} />
      <Route path="/m/attendance" element={<MobileOnly><Protected><MobileAttendance /></Protected></MobileOnly>} />
      <Route path="/m/leave" element={<MobileOnly><Protected><MobileLeave /></Protected></MobileOnly>} />
      <Route path="/m/devices" element={<MobileOnly><Protected><MobileDevices /></Protected></MobileOnly>} />
      <Route path="/m/roster" element={<MobileOnly><Protected><MobileRoster /></Protected></MobileOnly>} />
      <Route path="/m/approvals" element={<MobileOnly><Protected><MobileApprovals /></Protected></MobileOnly>} />
      <Route path="/m/inbox" element={<MobileOnly><Protected><MobileInbox /></Protected></MobileOnly>} />
      <Route path="/m/more" element={<MobileOnly><Protected><MobileMore /></Protected></MobileOnly>} />

      {/* Combined Leave + Office Visit page */}
      <Route path="/leave" element={
        <Protected><LeaveVisitPage defaultTab="leave" /></Protected>
      } />
      <Route path="/office-visit" element={
        <Protected><LeaveVisitPage defaultTab="visit" /></Protected>
      } />

      {/* Sub-routes (Apply / Approval) keep their own standalone pages */}
      <Route path="/leave/apply" element={
        <Protected><LeaveApplication /></Protected>
      } />
      <Route path="/leave/approval" element={
        <Protected requireManager allowRecoApprover><LeaveApproval /></Protected>
      } />

      <Route path="/leave/calculation" element={
        <Protected pageKey="leaveCalculation"><LeaveCalculation /></Protected>
      } />
      <Route path="/leave/reports/leave" element={
        <Protected pageKey="leaveReports"><LeaveReports /></Protected>
      } />
      <Route path="/leave/reports/office-visit" element={
        <Protected pageKey="officeVisitReports"><OfficeVisitReports /></Protected>
      } />
      <Route path="/office-visit/apply" element={
        <Protected pageKey="officeVisitApply"><OfficeVisitApplication /></Protected>
      } />
      <Route path="/office-visit/approval" element={
        <Protected requireManager allowRecoApprover><OfficeVisitApproval /></Protected>
      } />


      <Route path="/attendance/reports/daily" element={
        <Protected pageKey="attendanceDaily"><DailyAttendanceReport /></Protected>
      } />
      <Route path="/attendance/reports/half-monthly" element={
        <Protected pageKey="attendanceHalfMonthly"><HalfMonthlyReport /></Protected>
      } />

      {/* Half Monthly sub-reports */}
      <Route path="/attendance/reports/half-monthly/ledger" element={
        <Protected pageKey="attendanceLedger"><StaffLedger /></Protected>
      } />
      <Route path="/attendance/reports/half-monthly/present-absent" element={
        <Protected pageKey="attendanceHalfMonthly"><PresentAbsentReport /></Protected>
      } />
      <Route path="/attendance/reports/half-monthly/summary" element={
        <Protected pageKey="attendanceHalfMonthly"><HalfSummaryReport /></Protected>
      } />
      <Route path="/attendance/reports/half-monthly/in-out" element={
        <Protected pageKey="attendanceHalfMonthly"><HalfInOutReport /></Protected>
      } />
      <Route path="/attendance/reports/half-monthly/absent" element={
        <Protected pageKey="attendanceHalfMonthly"><HalfAbsentReport /></Protected>
      } />
      <Route path="/attendance/reports/half-monthly/late-early" element={
        <Protected pageKey="attendanceHalfMonthly"><HalfLateEarlyReport /></Protected>
      } />
      <Route path="/attendance/reports/half-monthly/overtime" element={
        <Protected pageKey="attendanceLedger"><StaffLedger /></Protected>
      } />

      {/* Monthly Report dashboard */}
      <Route path="/attendance/reports/monthly" element={
        <Protected pageKey="attendanceMonthly"><MonthlyReport /></Protected>
      } />
      <Route path="/attendance/reports/monthly/ledger" element={
        <Protected pageKey="attendanceLedger"><StaffLedger /></Protected>
      } />
      <Route path="/attendance/reports/monthly/present-absent" element={
        <Protected pageKey="attendanceMonthly"><MonthlyPresentAbsentReport /></Protected>
      } />
      <Route path="/attendance/reports/monthly/summary" element={
        <Protected pageKey="attendanceMonthly"><MonthlySummaryReport /></Protected>
      } />
      <Route path="/attendance/reports/monthly/in-out" element={
        <Protected pageKey="attendanceMonthly"><MonthlyInOutReport /></Protected>
      } />
      <Route path="/attendance/reports/monthly/absent" element={
        <Protected pageKey="attendanceMonthly"><MonthlyAbsentReport /></Protected>
      } />
      <Route path="/attendance/reports/monthly/late-early" element={
        <Protected pageKey="attendanceMonthly"><MonthlyLateEarlyReport /></Protected>
      } />
      <Route path="/attendance/reports/monthly/overtime" element={
        <Protected pageKey="attendanceLedger"><StaffLedger /></Protected>
      } />

      {/* Yearly Report dashboard */}
      <Route path="/attendance/reports/yearly" element={
        <Protected pageKey="attendanceYearly"><YearlyReport /></Protected>
      } />
      <Route path="/attendance/reports/yearly/present-absent" element={
        <Protected pageKey="attendanceYearly"><YearlyPresentAbsentReport /></Protected>
      } />
      <Route path="/attendance/reports/yearly/in-out" element={
        <Protected pageKey="attendanceYearly"><YearlyInOutReport /></Protected>
      } />
      <Route path="/attendance/reports/yearly/absent" element={
        <Protected pageKey="attendanceYearly"><YearlyAbsentReport /></Protected>
      } />
      <Route path="/attendance/reports/yearly/late-early" element={
        <Protected pageKey="attendanceYearly"><YearlyLateEarlyReport /></Protected>
      } />

      <Route path="/attendance/overtime" element={
        <Protected pageKey="overtime"><OvertimePage /></Protected>
      } />

      <Route path="/attendance/roster-dashboard" element={
        <Protected pageKey="dutyRoster" moduleKey="dutyRoster"><RosterDashboard /></Protected>
      } />
      <Route path="/attendance/roster-report" element={
        <Protected pageKey="dutyRoster" moduleKey="dutyRoster"><RosterReport /></Protected>
      } />
      <Route path="/attendance/duty-roster" element={
        <Protected pageKey="dutyRoster" moduleKey="dutyRoster"><DutyRoster /></Protected>
      } />
      <Route path="/attendance/duty-roster/dept" element={
        <Protected pageKey="dutyRoster" moduleKey="dutyRoster"><DutyRosterDeptWise /></Protected>
      } />
      <Route path="/attendance/manual-postings" element={
        <Protected requireManager allowRecoApprover pageKey="manualPostings"><ManualPostings /></Protected>
      } />
      <Route path="/attendance/missing-requests" element={
        <Protected pageKey={['missingAttendanceRequests', 'missingAttendanceApply']}><MissingAttendanceRequests /></Protected>
      } />
      <Route path="/attendance/online/approval" element={
        <Protected requireManager pageKey="onlineAttendance"><OnlineAttendanceApproval /></Protected>
      } />
      <Route path="/profile" element={
        <Protected>{isMobileMode() ? <MobileProfile /> : <ProfilePage />}</Protected>
      } />

      <Route path="/shift" element={
        <Protected requireAdmin><ShiftManagement /></Protected>
      } />
      <Route path="/users" element={
        <Protected pageKey="staffDetail"><UserManagement /></Protected>
      } />
      {/* Dedicated entry point for departmentHead/branchManager (or anyone
          granted the recoApprovalConfig permission) who shouldn't get the
          full staffDetail-gated /users page just for this one feature. */}
      <Route path="/staff/reco-approval" element={
        <Protected pageKey="recoApprovalConfig"><RecoApprovalPage /></Protected>
      } />
      <Route path="/staff/notes" element={
        <Protected pageKey="myNotes"><StaffNotes /></Protected>
      } />
      <Route path="/staff/task/dashboard" element={
        <Protected pageKey="task" moduleKey="task"><TaskDashboard /></Protected>
      } />
      <Route path="/staff/task" element={
        <Protected pageKey="task" moduleKey="task">{isMobileMode() ? <MobileTasks /> : <TaskList />}</Protected>
      } />
      <Route path="/staff/field-visit" element={
        <Protected pageKey="task" moduleKey="task">{isMobileMode() ? <MobileTasks fieldVisitOnly /> : <TaskList fieldVisitOnly />}</Protected>
      } />
      <Route path="/staff/task/settings" element={
        <Protected pageKey="task" moduleKey="task"><TaskSettings /></Protected>
      } />
      <Route path="/staff/task/categories" element={
        <Protected pageKey="task" moduleKey="task"><TaskLookupPage title="Task Category" endpoint="taskCategories" /></Protected>
      } />
      <Route path="/staff/task/priorities" element={
        <Protected pageKey="task" moduleKey="task"><TaskLookupPage title="Task Priority" endpoint="taskPriorities" withColor /></Protected>
      } />
      <Route path="/payroll/dashboard" element={
        <Protected pageKey="payroll"><PayrollDashboard /></Protected>
      } />
      <Route path="/payroll/items" element={
        <Protected pageKey="payroll"><PayrollItems /></Protected>
      } />
      <Route path="/payroll/tax-slab" element={
        <Protected pageKey="payroll"><PayrollTaxSlab /></Protected>
      } />
      <Route path="/payroll/reports" element={
        <Protected pageKey="payroll" requireAdmin><PayrollReports /></Protected>
      } />
      <Route path="/payroll/rates" element={
        <Protected pageKey="payroll" requireAdmin><PayrollRates /></Protected>
      } />
      <Route path="/payroll/salary" element={
        <Protected pageKey="payroll" requireAdmin><PayrollSalary /></Protected>
      } />
      <Route path="/payroll/advances" element={
        <Protected pageKey="payroll" requireAdmin><PayrollAdvances /></Protected>
      } />
      <Route path="/payroll/run" element={
        <Protected pageKey="payroll" requireAdmin><PayrollRun /></Protected>
      } />
      <Route path="/payroll/run/:id" element={
        <Protected pageKey="payroll" requireAdmin><PayrollRun /></Protected>
      } />
      <Route path="/payroll/scales" element={
        <Protected pageKey="payroll" requireAdmin><PayrollScales /></Protected>
      } />
      <Route path="/payroll/ledger" element={
        <Protected pageKey="payroll" requireAdmin><PayrollLedger /></Protected>
      } />
      <Route path="/payroll/my" element={
        <Protected>{isMobileMode() ? <MobilePayslips /> : <MyPayslips />}</Protected>
      } />
      <Route path="/staff/contact" element={
        <Protected pageKey="staffContact"><StaffContact /></Protected>
      } />
      <Route path="/staff/events" element={
        <Protected pageKey="eventVisitorRegistration" moduleKey="guestRegistration"><EventVisitorRegistration /></Protected>
      } />
      <Route path="/staff/analysis" element={
        <Protected pageKey="staffAnalytics"><StaffAnalyticsReport /></Protected>
      } />
      <Route path="/staff/message" element={
        <Protected><StaffMessage /></Protected>
      } />
      <Route path="/chat" element={
        <Protected moduleKey="chat"><ChatPage /></Protected>
      } />
      <Route path="/settings" element={
        <Protected requireAdmin><Settings /></Protected>
      } />
      <Route path="/settings/license" element={
        <Protected requireAdmin><LicensePage /></Protected>
      } />
      <Route path="/settings/roles" element={
        <Protected requireAdmin><RoleManagement /></Protected>
      } />

      <Route path="/" element={<Navigate to={currentUser ? "/dashboard" : "/login"} replace />} />
      <Route path="*" element={<Navigate to={currentUser ? "/dashboard" : "/login"} replace />} />
    </Routes>
    </ModuleFlagsProvider>
  );
};

export default App;
