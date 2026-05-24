import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import type { components } from "@/api/contracts";
import { apiRequest } from "@/api/client";
import { postImpersonate, postLeaveImpersonation } from "@/api/authImpersonation";
import { formatEmployeeName } from "@/lib/employeeName";
import { clearAuthToken, getAuthToken, setAuthToken } from "@/api/authToken";

export type AppRole = "superadmin_rrhh" | "admin_rrhh" | "jefe_area" | "empleado";

export type ImpersonationBanner = {
  active: true;
  actor_id: number;
  actor_name: string;
  actor_email: string;
  actor_role?: AppRole;
};

export interface User {
  id: string;
  nombre: string;
  email: string;
  avatar?: string;
  rol: AppRole;
  permissions?: string[];
  targetPermissions?: string[];
  area?: string;
  employee?: {
    id: number;
    fullName: string;
  };
  impersonation?: ImpersonationBanner | null;
}

export const ROLE_LABELS: Record<AppRole, string> = {
  superadmin_rrhh: "Superadmin RRHH",
  admin_rrhh: "Admin RRHH",
  jefe_area: "Jefe de Área",
  empleado: "Colaborador",
};

const APP_ROLES: AppRole[] = ["superadmin_rrhh", "admin_rrhh", "jefe_area", "empleado"];

export function normalizeAppRole(raw: string | null | undefined): AppRole {
  if (!raw) return "empleado";
  let slug = raw.trim().toLowerCase().replace(/[\s-]+/g, "_").replace(/_+/g, "_");
  if (slug === "jefe_de_area") slug = "jefe_area";
  if (slug === "colaborador") slug = "empleado";
  return APP_ROLES.includes(slug as AppRole) ? (slug as AppRole) : "empleado";
}

export function resolveDisplayRole(user: User | null): AppRole | null {
  if (!user) return null;
  if (user.impersonation?.active && user.impersonation.actor_role) {
    return user.impersonation.actor_role;
  }
  return user.rol;
}

function toAppUser(me: components["schemas"]["UserMe"]): User {
  const rol = normalizeAppRole(me.role ?? undefined);

  const imp = me.impersonation as
    | {
        active?: boolean;
        actor_id?: number;
        actor_name?: string;
        actor_email?: string;
        actor_role?: string | null;
      }
    | null
    | undefined;
  const impersonation: ImpersonationBanner | undefined =
    imp?.active === true && typeof imp.actor_id === "number"
      ? {
          active: true,
          actor_id: imp.actor_id,
          actor_name: imp.actor_name ?? "",
          actor_email: imp.actor_email ?? "",
          actor_role: imp.actor_role ? normalizeAppRole(imp.actor_role) : undefined,
        }
      : undefined;

  const targetPerms = (me as { target_permissions?: string[] }).target_permissions;

  return {
    id: String(me.id),
    nombre: me.name,
    email: me.email,
    avatar: me.avatar_path ?? undefined,
    rol,
    permissions: Array.isArray(me.permissions) ? me.permissions : undefined,
    targetPermissions: Array.isArray(targetPerms) ? targetPerms : undefined,
    area: me.department?.name,
    employee: me.employee
      ? { id: me.employee.id, fullName: formatEmployeeName(me.employee) }
      : undefined,
    impersonation,
  };
}

const ROLE_PERMISSIONS: Record<AppRole, string[]> = {
  superadmin_rrhh: [
    "dashboard.view",
    "portal.view",
    "employees.view", "employees.create", "employees.edit", "employees.delete", "employees.offboard",
    "attendance.view", "attendance.manage", "attendance.approve",
    "payroll.view", "payroll.generate", "payroll.send",
    "portal.view",
    "assets.view", "assets.manage",
    "reports.view", "reports.export",
    "settings.view", "settings.users", "settings.departments", "settings.params", "settings.audit", "settings.backup", "settings.profiles",
  ],
  admin_rrhh: [
    "dashboard.view",
    "employees.view", "employees.create", "employees.edit",
    "attendance.view", "attendance.manage", "attendance.approve",
    "payroll.view", "payroll.generate", "payroll.send",
    "portal.view",
    "assets.view", "assets.manage",
    "reports.view", "reports.export",
    "settings.view", "settings.users", "settings.departments", "settings.params",
  ],
  jefe_area: [
    "dashboard.view",
    "employees.view",
    "employees.self_edit",
    "attendance.view", "attendance.approve",
    "payroll.view",
    "portal.view",
    "assets.view",
    "reports.view",
  ],
  empleado: [
    "portal.view",
    "employees.self_edit",
  ],
};

export function resolvePermission(
  permission: string,
  roleDefaults: string[],
  permissionsFromApi?: string[],
): boolean {
  if (permissionsFromApi !== undefined) {
    return permissionsFromApi.includes(permission);
  }
  return roleDefaults.includes(permission);
}

interface AuthContextType {
  user: User | null;
  initializing: boolean;
  loginWithToken: (token: string) => Promise<void>;
  startImpersonation: (userId: number) => Promise<void>;
  leaveImpersonation: () => Promise<void>;
  logout: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
  hasAnyPermission: (permissions: string[]) => boolean;
  hasTargetPermission: (permission: string) => boolean;
  hasAnyTargetPermission: (permissions: string[]) => boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    const token = getAuthToken();
    if (!token) {
      setInitializing(false);
      return;
    }

    (async () => {
      try {
        const res = await apiRequest<components["schemas"]["UserMeEnvelope"]>("/auth/me");
        setUser(toAppUser(res.data));
      } catch {
        clearAuthToken();
        setUser(null);
      } finally {
        setInitializing(false);
      }
    })();
  }, []);

  const loginWithToken = useCallback(async (token: string) => {
    setAuthToken(token);
    const res = await apiRequest<components["schemas"]["UserMeEnvelope"]>("/auth/me");
    setUser(toAppUser(res.data));
  }, []);

  const startImpersonation = useCallback(async (userId: number) => {
    const res = await postImpersonate(userId);
    await loginWithToken(res.data.token);
  }, [loginWithToken]);

  const leaveImpersonation = useCallback(async () => {
    const res = await postLeaveImpersonation();
    await loginWithToken(res.data.token);
  }, [loginWithToken]);

  const logout = useCallback(async () => {
    try {
      await apiRequest<void>("/auth/logout", { method: "POST" });
    } catch {
      clearAuthToken();
      setUser(null);
      return;
    }
    clearAuthToken();
    setUser(null);
  }, []);

  const hasPermission = useCallback(
    (permission: string) => {
      if (!user) return false;
      const fromApi = user.permissions;
      const impersonating = user.impersonation?.active === true;
      if (impersonating) {
        return Array.isArray(fromApi) && fromApi.includes(permission);
      }
      const roleDefaults = ROLE_PERMISSIONS[user.rol] ?? [];
      return resolvePermission(permission, roleDefaults, fromApi);
    },
    [user],
  );

  const hasTargetPermission = useCallback(
    (permission: string) => {
      if (!user) return false;
      const impersonating = user.impersonation?.active === true;
      if (!impersonating) {
        return hasPermission(permission);
      }
      const fromTarget = user.targetPermissions;
      const roleDefaults = ROLE_PERMISSIONS[user.rol] ?? [];
      return resolvePermission(permission, roleDefaults, fromTarget);
    },
    [user, hasPermission],
  );

  const hasAnyPermission = useCallback(
    (permissions: string[]) => permissions.some((p) => hasPermission(p)),
    [hasPermission],
  );

  const hasAnyTargetPermission = useCallback(
    (permissions: string[]) => permissions.some((p) => hasTargetPermission(p)),
    [hasTargetPermission],
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        initializing,
        loginWithToken,
        startImpersonation,
        leaveImpersonation,
        logout,
        hasPermission,
        hasAnyPermission,
        hasTargetPermission,
        hasAnyTargetPermission,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
