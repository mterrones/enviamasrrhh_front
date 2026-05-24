import { Link, useLocation } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Users,
  CalendarCheck,
  FileText,
  UserCircle,
  Monitor,
  BarChart3,
  Settings,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  NotebookPen,
  Calendar as CalendarIcon,
  Laptop,
  User,
  Bell,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";

type NavLinkItem = {
  label: string;
  icon: LucideIcon;
  path: string;
  permission: string;
};

const navItemsBeforePortal: NavLinkItem[] = [
  { label: "Inicio", icon: LayoutDashboard, path: "/", permission: "dashboard.view" },
  { label: "Colaboradores", icon: Users, path: "/colaboradores", permission: "employees.view" },
  { label: "Asistencia", icon: CalendarCheck, path: "/asistencia", permission: "attendance.view" },
  { label: "Boletas y Nómina", icon: FileText, path: "/boletas", permission: "payroll.view" },
];

const portalSingleItem: NavLinkItem = {
  label: "Portal del Colaborador",
  icon: UserCircle,
  path: "/portal",
  permission: "portal.view",
};

const portalEmployeeModules: { label: string; icon: LucideIcon; to: string; tab: string }[] = [
  { label: "Datos", icon: NotebookPen, to: "/portal", tab: "datos" },
  { label: "Mis Asistencias", icon: CalendarIcon, to: "/portal?tab=asistencia", tab: "asistencia" },
  { label: "Mis Boletas", icon: FileText, to: "/portal?tab=boletas", tab: "boletas" },
  { label: "Mis Equipos", icon: Laptop, to: "/portal?tab=equipos", tab: "equipos" },
  { label: "Mis Solicitudes", icon: User, to: "/portal?tab=solicitudes", tab: "solicitudes" },
  { label: "Notificaciones", icon: Bell, to: "/portal?tab=notificaciones", tab: "notificaciones" },
];

const navItemsAfterPortal: NavLinkItem[] = [
  { label: "Activos y Equipos", icon: Monitor, path: "/activos", permission: "assets.view" },
  { label: "Reportes", icon: BarChart3, path: "/reportes", permission: "reports.view" },
  { label: "Perfiles y Permisos", icon: ShieldCheck, path: "/perfiles", permission: "settings.profiles" },
  { label: "Configuración", icon: Settings, path: "/configuracion", permission: "settings.view" },
];

function portalSidebarTabActive(pathname: string, search: string, tab: string): boolean {
  if (pathname !== "/portal") return false;
  const current = new URLSearchParams(search).get("tab") ?? "datos";
  return current === tab;
}

interface Props {
  collapsed: boolean;
  onToggle: () => void;
}

export function AppSidebar({ collapsed, onToggle }: Props) {
  const location = useLocation();
  const { hasTargetPermission, user } = useAuth();

  const beforePortal = navItemsBeforePortal.filter((item) => hasTargetPermission(item.permission));
  const afterPortal = navItemsAfterPortal.filter((item) => hasTargetPermission(item.permission));
  const showPortal = hasTargetPermission("portal.view");
  const portalAsEmployeeModules = user?.rol === "empleado";

  return (
    <aside
      className={cn(
        "gradient-sidebar flex flex-col transition-all duration-300 ease-in-out relative shrink-0",
        collapsed ? "w-[68px]" : "w-[260px]"
      )}
    >
      {/* Logo */}
      <div className="h-16 flex items-center px-4 border-b border-sidebar-border">
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="w-9 h-9 rounded-lg gradient-primary flex items-center justify-center shrink-0">
            <span className="text-primary-foreground font-bold text-sm">EM</span>
          </div>
          {!collapsed && (
            <div className="whitespace-nowrap">
              <p className="text-sidebar-accent-foreground font-semibold text-sm leading-tight">EnviaMas</p>
              <p className="text-sidebar-foreground text-xs">RRHH</p>
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
        {beforePortal.map((item) => {
          const isActive =
            location.pathname === item.path || (item.path !== "/" && location.pathname.startsWith(item.path));
          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group",
                isActive
                  ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-md"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
              title={collapsed ? item.label : undefined}
            >
              <item.icon className="w-5 h-5 shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}
        {showPortal && portalAsEmployeeModules
          ? portalEmployeeModules.map((item) => {
              const isActive = portalSidebarTabActive(location.pathname, location.search, item.tab);
              return (
                <Link
                  key={`portal-${item.tab}`}
                  to={item.to}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group",
                    isActive
                      ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-md"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  )}
                  title={collapsed ? item.label : undefined}
                >
                  <item.icon className="w-5 h-5 shrink-0" />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </Link>
              );
            })
          : null}
        {showPortal && !portalAsEmployeeModules ? (
          <Link
            to={portalSingleItem.path}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group",
              location.pathname === "/portal" ||
                (portalSingleItem.path !== "/" && location.pathname.startsWith(portalSingleItem.path))
                ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-md"
                : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            )}
            title={collapsed ? portalSingleItem.label : undefined}
          >
            <portalSingleItem.icon className="w-5 h-5 shrink-0" />
            {!collapsed && <span className="truncate">{portalSingleItem.label}</span>}
          </Link>
        ) : null}
        {afterPortal.map((item) => {
          const isActive =
            location.pathname === item.path || (item.path !== "/" && location.pathname.startsWith(item.path));
          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group",
                isActive
                  ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-md"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
              title={collapsed ? item.label : undefined}
            >
              <item.icon className="w-5 h-5 shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Collapse button */}
      <button
        onClick={onToggle}
        className="absolute -right-3 top-20 w-6 h-6 rounded-full bg-card border border-border shadow-sm flex items-center justify-center hover:bg-muted transition-colors"
      >
        {collapsed ? <ChevronRight className="w-3.5 h-3.5 text-foreground" /> : <ChevronLeft className="w-3.5 h-3.5 text-foreground" />}
      </button>
    </aside>
  );
}
