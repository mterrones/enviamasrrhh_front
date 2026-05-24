import { Navigate, useParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import EmployeeProfilePage from "./EmployeeProfilePage";

export default function EmployeeProfileRoute() {
  const { id } = useParams();
  const { user, hasPermission, initializing } = useAuth();

  if (initializing) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center text-muted-foreground text-sm">Cargando sesión…</div>
    );
  }

  const n = id != null ? Number(id) : NaN;
  if (id == null || Number.isNaN(n)) {
    return <Navigate to="/colaboradores" replace />;
  }

  if (hasPermission("employees.view")) {
    return <EmployeeProfilePage />;
  }

  if (hasPermission("employees.self_edit") && user?.employee?.id === n) {
    return <EmployeeProfilePage />;
  }

  return <Navigate to="/" replace />;
}
