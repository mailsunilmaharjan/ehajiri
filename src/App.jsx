import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { ModuleFlagsProvider, useModuleFlags } from './context/ModuleFlagsContext.jsx';
import useRecoApproval from './hooks/useRecoApproval.js';
import Layout from './components/Layout/Layout.jsx';
import Login         from './components/Auth/Login.jsx';
import SsoLogin      from './components/Auth/SsoLogin.jsx';
import GuestCheckin  from './components/Public/GuestCheckin.jsx';
import ResetPassword from './components/Auth/ResetPassword.jsx';
import LicenseWarningModal from './components/Auth/LicenseWarningModal.jsx';
import Dashboard from './components/Dashboard/Dashboard.jsx';
import LeaveVisitPage from './components/Leave/LeaveVisitPage.jsx';
import LeaveApplication from './components/Leave/LeaveApplication.jsx';
import LeaveApproval from './components/Leave/LeaveApproval.jsx';
import LeaveCalculation from './components/Leave/LeaveCalculation.jsx';
import LeaveReports from './components/Leave/LeaveReports.jsx';
import OfficeVisitApplication from './components/OfficeVisit/OfficeVisitApplication.jsx';
import OfficeVisitApproval from './components/OfficeVisit/OfficeVisitApproval.jsx';
import OfficeVisitReports from './components/OfficeVisit/OfficeVisitReports.jsx';
import ShiftManagement        from './components/Shift/ShiftManagement.jsx';
import UserManagement         from './components/Users/UserManagement.jsx';
import StaffNotes             from './components/Staff/StaffNotes.jsx';
import StaffContact           from './components/Staff/StaffContact.jsx';
import EventVisitorRegistration from './components/Staff/EventVisitorRegistration.jsx';
import StaffAnalyticsReport   from './components/Staff/StaffAnalyticsReport.jsx';
import TaskList               from './components/Staff/TaskList.jsx';
import TaskLookupPage         from './components/Staff/TaskLookupPage.jsx';
import TaskDashboard          from './components/Staff/TaskDashboard.jsx';
import TaskSettings           from './components/Staff/TaskSettings.jsx';
import StaffMessage           from './components/Staff/StaffMessage.jsx';
import ChatPage                from './components/Chat/ChatPage.jsx';
import Settings               from './components/Settings/Settings.jsx';
import LicensePage            from './components/Settings/LicensePage.jsx';
import RoleManagement         from './components/Settings/RoleManagement.jsx';
import DailyAttendanceReport    from './components/Attendance/DailyAttendanceReport.jsx';
import HalfMonthlyReport       from './components/Attendance/HalfMonthlyReport.jsx';
import MonthlyReport           from './components/Attendance/MonthlyReport.jsx';
import StaffLedger             from './components/Attendance/StaffLedger.jsx';
import PresentAbsentReport     from './components/Attendance/PresentAbsentReport.jsx';
import HalfSummaryReport       from './components/Attendance/HalfSummaryReport.jsx';
import HalfAbsentReport        from './components/Attendance/HalfAbsentReport.jsx';
import HalfLateEarlyReport          from './components/Attendance/HalfLateEarlyReport.jsx';
import MonthlyPresentAbsentReport   from './components/Attendance/MonthlyPresentAbsentReport.jsx';
import MonthlySummaryReport         from './components/Attendance/MonthlySummaryReport.jsx';
import MonthlyInOutReport           from './components/Attendance/MonthlyInOutReport.jsx';
import MonthlyAbsentReport          from './components/Attendance/MonthlyAbsentReport.jsx';
import MonthlyLateEarlyReport       from './components/Attendance/MonthlyLateEarlyReport.jsx';
import HalfInOutReport         from './components/Attendance/HalfInOutReport.jsx';
import YearlyReport                   from './components/Attendance/YearlyReport.jsx';
import OvertimePage                   from './components/Attendance/OvertimePage.jsx';
import YearlyPresentAbsentReport      from './components/Attendance/YearlyPresentAbsentReport.jsx';
import YearlyInOutReport              from './components/Attendance/YearlyInOutReport.jsx';
import YearlyAbsentReport             from './components/Attendance/YearlyAbsentReport.jsx';
import YearlyLateEarlyReport          from './components/Attendance/YearlyLateEarlyReport.jsx';
import DutyRoster                     from './components/Attendance/DutyRoster.jsx';
import DutyRosterDeptWise             from './components/Attendance/DutyRosterDeptWise.jsx';
import RosterDashboard                from './components/Attendance/RosterDashboard.jsx';
import RosterReport                   from './components/Attendance/RosterReport.jsx';
import ManualPostings                 from './components/Attendance/ManualPostings.jsx';
import MissingAttendanceRequests      from './components/Attendance/MissingAttendanceRequests.jsx';
import OnlineAttendanceApproval       from './components/Attendance/OnlineAttendanceApproval.jsx';
import ProfilePage                    from './components/Profile/ProfilePage.jsx';
import RecoApprovalPage               from './components/Users/RecoApprovalPage.jsx';

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
  if (!loaded) return <Layout><div style={{ padding: 60, textAlign: 'center', color: '#9ca3af' }}>Loading…</div></Layout>;
  const isConfiguredRecoOrApprover = Object.entries(assignments || {}).some(([key, cfg]) => {
    if (key === '_settings') return false;
    const reco     = Array.isArray(cfg?.reco)     ? cfg.reco     : (cfg?.reco     != null ? [cfg.reco]     : []);
    const approval = Array.isArray(cfg?.approval) ? cfg.approval : (cfg?.approval != null ? [cfg.approval] : []);
    return reco.map(String).includes(String(currentUser.id)) || approval.map(String).includes(String(currentUser.id));
  });
  return isConfiguredRecoOrApprover ? children : <Navigate to="/dashboard" replace />;
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
  const { currentUser, isAdmin, isManager, canViewReports, canView } = useAuth();
  const { flags: moduleFlags, loading: moduleFlagsLoading } = useModuleFlags();
  if (!currentUser) return <Navigate to="/login" replace />;
  if (requireAdmin   && !isAdmin)        return <Navigate to="/dashboard" replace />;
  if (requireManager && !isManager) {
    if (allowRecoApprover) return <RecoApproverGate>{children}</RecoApproverGate>;
    return <Navigate to="/dashboard" replace />;
  }
  if (requireReports && !canViewReports) return <Navigate to="/dashboard" replace />;
  if (pageKey && !canView(pageKey))      return <Navigate to="/dashboard" replace />;
  if (moduleKey) {
    if (moduleFlagsLoading) return <Layout><div style={{ padding: 60, textAlign: 'center', color: '#9ca3af' }}>Loading…</div></Layout>;
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
  return <Layout>{children}</Layout>;
};

const App = () => {
  const { currentUser } = useAuth();

  return (
    <ModuleFlagsProvider>
    <LicenseWarningModal />
    <Routes>
      <Route path="/login" element={
        currentUser ? <Navigate to="/dashboard" replace /> : <Login />
      } />
      {/* Not gated on currentUser like /login — "Open Software (Admin)" vs
          "(Super Admin)" is an explicit choice of WHICH identity to become,
          so it always runs (and overrides any existing session) rather than
          bouncing straight to whoever's already logged in. */}
      <Route path="/sso-login" element={<SsoLogin />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      {/* Public — scanned from a "Scan to Check In" QR, no eHajiri login */}
      <Route path="/checkin/:token" element={<GuestCheckin />} />

      <Route path="/dashboard" element={
        <Protected><Dashboard /></Protected>
      } />

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
        <Protected><MissingAttendanceRequests /></Protected>
      } />
      <Route path="/attendance/online/approval" element={
        <Protected requireManager pageKey="onlineAttendance"><OnlineAttendanceApproval /></Protected>
      } />
      <Route path="/profile" element={
        <Protected><ProfilePage /></Protected>
      } />

      <Route path="/shift" element={
        <Protected requireAdmin><ShiftManagement /></Protected>
      } />
      <Route path="/users" element={
        <Protected requireManager><UserManagement /></Protected>
      } />
      {/* Dedicated entry point for departmentHead/branchManager (or anyone
          granted the recoApprovalConfig permission) who shouldn't get the
          full requireManager-gated /users page just for this one feature. */}
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
        <Protected pageKey="task" moduleKey="task"><TaskList /></Protected>
      } />
      <Route path="/staff/field-visit" element={
        <Protected pageKey="task" moduleKey="task"><TaskList fieldVisitOnly /></Protected>
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
