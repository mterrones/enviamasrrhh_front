import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useSearchParams } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MainLayout } from "@/components/layout/MainLayout";
import { AuthProvider } from "@/contexts/AuthContext";
import { InactivitySessionWatcher } from "@/components/auth/InactivitySessionWatcher";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { RequirePermission } from "@/components/auth/RequirePermission";
import { RequireAnyPermission } from "@/components/auth/RequireAnyPermission";
import { HomeEntry } from "@/components/auth/HomeEntry";
import { NotificationsProvider } from "@/contexts/NotificationsContext";
import EmployeesPage from "./pages/EmployeesPage";
import EmployeeProfileRoute from "./pages/EmployeeProfileRoute";
import NewEmployeePage from "./pages/NewEmployeePage";
import EditEmployeePage from "./pages/EditEmployeePage";
import AttendancePage from "./pages/AttendancePage";
import PayrollPage from "./pages/PayrollPage";
import EmployeePortalPage from "./pages/EmployeePortalPage";
import ResignationRequestsPage from "./pages/ResignationRequestsPage";
import AssetsPage from "./pages/AssetsPage";
import ReportsPage from "./pages/ReportsPage";
import SettingsPage from "./pages/SettingsPage";
import ProfilesPage from "./pages/ProfilesPage";
import LoginPage from "./pages/LoginPage";
import InviteAcceptPage from "./pages/InviteAcceptPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function DeductionsLegacyRedirect() {
  const [sp] = useSearchParams();
  const employee = sp.get("employee");
  const next = new URLSearchParams();
  next.set("tab", "descuentos");
  if (employee != null && /^\d+$/.test(employee.trim())) {
    next.set("employee", employee.trim());
  }
  return <Navigate to={`/boletas?${next.toString()}`} replace />;
}

function EmpleadosLegacyRedirect() {
  const location = useLocation();
  const target =
    location.pathname.replace(/^\/empleados(?=\/|$)/, "/colaboradores") +
    location.search +
    location.hash;
  return <Navigate to={target} replace />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
      <NotificationsProvider>
      <BrowserRouter>
        <InactivitySessionWatcher />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/invitar/:token" element={<InviteAcceptPage />} />
          <Route element={<RequireAuth />}>
            <Route element={<MainLayout />}>
              <Route path="/" element={<HomeEntry />} />
              <Route
                path="/colaboradores"
                element={
                  <RequirePermission permission="employees.view">
                    <EmployeesPage />
                  </RequirePermission>
                }
              />
              <Route
                path="/colaboradores/nuevo"
                element={
                  <RequirePermission permission="employees.create">
                    <NewEmployeePage />
                  </RequirePermission>
                }
              />
              <Route
                path="/colaboradores/renuncias"
                element={
                  <RequirePermission permission="employees.edit">
                    <ResignationRequestsPage />
                  </RequirePermission>
                }
              />
              <Route path="/renuncias" element={<Navigate to="/colaboradores/renuncias" replace />} />
              <Route
                path="/colaboradores/:id/edit"
                element={
                  <RequireAnyPermission permissions={["employees.edit", "employees.self_edit"]}>
                    <EditEmployeePage />
                  </RequireAnyPermission>
                }
              />
              <Route
                path="/colaboradores/:id"
                element={
                  <RequireAnyPermission permissions={["employees.view", "employees.self_edit"]}>
                    <EmployeeProfileRoute />
                  </RequireAnyPermission>
                }
              />
              <Route path="/empleados/*" element={<EmpleadosLegacyRedirect />} />
              <Route
                path="/asistencia"
                element={
                  <RequirePermission permission="attendance.view">
                    <AttendancePage />
                  </RequirePermission>
                }
              />
              <Route
                path="/boletas"
                element={
                  <RequirePermission permission="payroll.view">
                    <PayrollPage />
                  </RequirePermission>
                }
              />
              <Route
                path="/descuentos"
                element={
                  <RequirePermission permission="payroll.view">
                    <DeductionsLegacyRedirect />
                  </RequirePermission>
                }
              />
              <Route
                path="/portal"
                element={
                  <RequirePermission permission="portal.view">
                    <EmployeePortalPage />
                  </RequirePermission>
                }
              />
              <Route
                path="/activos"
                element={
                  <RequirePermission permission="assets.view">
                    <AssetsPage />
                  </RequirePermission>
                }
              />
              <Route
                path="/reportes"
                element={
                  <RequirePermission permission="reports.view">
                    <ReportsPage />
                  </RequirePermission>
                }
              />
              <Route
                path="/perfiles"
                element={
                  <RequirePermission permission="settings.profiles">
                    <ProfilesPage />
                  </RequirePermission>
                }
              />
              <Route
                path="/configuracion"
                element={
                  <RequirePermission permission="settings.view">
                    <SettingsPage />
                  </RequirePermission>
                }
              />
            </Route>
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
      </NotificationsProvider>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
