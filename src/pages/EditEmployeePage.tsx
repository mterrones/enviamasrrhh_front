import { Navigate, useParams } from "react-router-dom";
import { EmployeeFormPage } from "./EmployeeFormPage";
import { useAuth } from "@/contexts/AuthContext";

export default function EditEmployeePage() {
  const { id } = useParams();
  const { user, hasPermission } = useAuth();
  const employeeId = Number(id);
  if (!id || Number.isNaN(employeeId)) {
    return <Navigate to="/colaboradores" replace />;
  }
  const hasFullEdit = hasPermission("employees.edit");
  const hasSelfEdit = hasPermission("employees.self_edit");
  const ownEmployeeId = user?.employee?.id;
  if (!hasFullEdit && hasSelfEdit) {
    if (ownEmployeeId == null || ownEmployeeId !== employeeId) {
      return <Navigate to="/" replace />;
    }
  }
  return <EmployeeFormPage mode="edit" employeeId={employeeId} />;
}
