import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import Layout from './components/Layout/Layout.jsx';
import Login         from './components/Auth/Login.jsx';
import ResetPassword from './components/Auth/ResetPassword.jsx';
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
import ProfilePage                    from './components/Profile/ProfilePage.jsx';

/*
  Role access matrix
  ──────────────────────────────────────────────────────────────────
  requireAdmin   → admin only
  requireManager → admin + branchManager
  requireReports → admin + branchManager + departmentHead
  pageKey        → checked via canView(pageKey) (page-permission system)
  (no flag)      → any authenticated user
*/
const Protected = ({
  children,
  requireAdmin   = false,
  requireManager = false,
  requireReports = false,
  pageKey        = null,
}) => {
  const { currentUser, isAdmin, isManager, canViewReports, canView } = useAuth();
  if (!currentUser) return <Navigate to="/login" replace />;
  if (requireAdmin   && !isAdmin)        return <Navigate to="/dashboard" replace />;
  if (requireManager && !isManager)      return <Navigate to="/dashboard" replace />;
  if (requireReports && !canViewReports) return <Navigate to="/dashboard" replace />;
  if (pageKey && !canView(pageKey))      return <Navigate to="/dashboard" replace />;
  return <Layout>{children}</Layout>;
};

const App = () => {
  const { currentUser } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={
        currentUser ? <Navigate to="/dashboard" replace /> : <Login />
      } />
      <Route path="/reset-password" element={<ResetPassword />} />

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
        <Protected requireManager><LeaveApproval /></Protected>
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
        <Protected requireManager><OfficeVisitApproval /></Protected>
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
        <Protected pageKey="attendanceDaily"><OvertimePage /></Protected>
      } />

      <Route path="/attendance/roster-dashboard" element={
        <Protected pageKey="dutyRoster"><RosterDashboard /></Protected>
      } />
      <Route path="/attendance/roster-report" element={
        <Protected pageKey="dutyRoster"><RosterReport /></Protected>
      } />
      <Route path="/attendance/duty-roster" element={
        <Protected pageKey="dutyRoster"><DutyRoster /></Protected>
      } />
      <Route path="/attendance/duty-roster/dept" element={
        <Protected pageKey="dutyRoster"><DutyRosterDeptWise /></Protected>
      } />
      <Route path="/attendance/manual-postings" element={
        <Protected requireAdmin><ManualPostings /></Protected>
      } />
      <Route path="/attendance/missing-requests" element={
        <Protected><MissingAttendanceRequests /></Protected>
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
      <Route path="/staff/notes" element={
        <Protected pageKey="myNotes"><StaffNotes /></Protected>
      } />
      <Route path="/staff/contact" element={
        <Protected pageKey="staffContact"><StaffContact /></Protected>
      } />
      <Route path="/staff/message" element={
        <Protected><StaffMessage /></Protected>
      } />
      <Route path="/chat" element={
        <Protected><ChatPage /></Protected>
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
  );
};

export default App;
