import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Users, FileWarning, ClipboardList } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { fetchDashboardSummary, fetchDashboardRecentAudit, type DashboardSummaryData } from "@/api/dashboardSummary";
import { MonthlyHireExitFlowCard } from "@/components/reports/MonthlyHireExitFlowCard";
import { PayrollPeriodAggregatesCard } from "@/components/reports/PayrollPeriodAggregatesCard";
import { DashboardBirthdaysSection } from "@/components/dashboard/DashboardBirthdaysSection";
import { useAuth } from "@/contexts/AuthContext";
import type { AuditLogRow } from "@/api/auditLogs";
import { ApiHttpError } from "@/api/client";
import { formatEmployeeName } from "@/lib/employeeName";
import { formatAppDateTime } from "@/lib/formatAppDate";

const PIE_COLORS = ["#ec6d1f", "#f4ad08", "#3b82f6", "#10b981", "#8b5cf6", "#6366f1", "#94a3b8"];

function formatActivityDate(iso: string | null): string {
  return formatAppDateTime(iso);
}

export default function DashboardPage() {
  const { hasPermission } = useAuth();
  const canPayrollAggregates = hasPermission("reports.view") && hasPermission("payroll.view");
  const canOpenAttendanceVacations = hasPermission("attendance.view");

  const [summary, setSummary] = useState<DashboardSummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activity, setActivity] = useState<AuditLogRow[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchDashboardSummary()
      .then((r) => {
        if (!cancelled) setSummary(r.data);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          const msg =
            e instanceof ApiHttpError ? e.apiError?.message ?? e.message : "No se pudo cargar el resumen";
          setError(typeof msg === "string" ? msg : "Error al cargar");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setActivityLoading(true);
    setActivityError(null);
    fetchDashboardRecentAudit(12)
      .then((r) => {
        if (!cancelled) setActivity(r.data);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          const msg =
            e instanceof ApiHttpError ? e.apiError?.message ?? e.message : "No se pudo cargar la actividad";
          setActivityError(typeof msg === "string" ? msg : "Error al cargar");
          setActivity([]);
        }
      })
      .finally(() => {
        if (!cancelled) setActivityLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const areaChartData =
    summary?.employees_by_department.map((d, i) => ({
      name: d.department_name,
      value: d.count,
      color: PIE_COLORS[i % PIE_COLORS.length],
    })) ?? [];

  const metricCards = [
    {
      label: "Colaboradores activos",
      value: loading ? "…" : summary != null ? String(summary.active_employee_count) : "—",
      icon: Users,
      color: "bg-primary/10 text-primary",
    },
    {
      label: "Contratos por vencer",
      value:
        loading ? "…" : summary != null ? String(summary.contracts_expiring_count) : "—",
      icon: FileWarning,
      color: "bg-warning/10 text-warning",
      hint:
        summary != null
          ? `Ventana ${summary.contracts_expiring_window_days} días`
          : undefined,
    },
  ];

  const pendingVacationCount = summary?.pending_vacation_requests_count ?? 0;
  const showVacationManageLink =
    canOpenAttendanceVacations && !loading && summary != null && pendingVacationCount > 0;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Inicio</h1>
        <p className="text-muted-foreground text-sm mt-1">Resumen general de Recursos Humanos</p>
      </div>

      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {metricCards.map((m) => (
          <Card key={m.label} className="shadow-card hover:shadow-card-hover transition-shadow">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{m.label}</p>
                  <p className="text-3xl font-bold mt-1">{m.value}</p>
                  {m.hint ? <p className="text-xs text-muted-foreground mt-2">{m.hint}</p> : null}
                </div>
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${m.color}`}>
                  <m.icon className="w-5 h-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        <Card
          className={
            showVacationManageLink
              ? "shadow-card hover:shadow-card-hover transition-shadow border-info/30"
              : "shadow-card hover:shadow-card-hover transition-shadow"
          }
        >
          <CardContent className="p-5">
            <div className="flex items-start justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-muted-foreground">Solicitudes pendientes</p>
                <p className="text-3xl font-bold mt-1">
                  {loading ? "…" : summary != null ? String(summary.pending_vacation_requests_count) : "—"}
                </p>
                {showVacationManageLink ? (
                  <p className="text-xs text-muted-foreground mt-2">
                    <Link
                      to="/asistencia?tab=vacaciones"
                      className="text-primary font-medium underline-offset-4 hover:underline"
                    >
                      Gestionar en Asistencia → Vacaciones
                    </Link>
                  </p>
                ) : null}
              </div>
              <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-info/10 text-info shrink-0">
                <ClipboardList className="w-5 h-5" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:items-stretch">
        {canPayrollAggregates ? (
          <div className="lg:col-span-2 min-h-0">
            <PayrollPeriodAggregatesCard limit={12} />
          </div>
        ) : (
          <Card className="lg:col-span-2 shadow-card min-h-0">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Headcount — Últimos 6 meses</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground py-8">
                Los datos históricos de plantilla no están disponibles en esta versión.
              </p>
            </CardContent>
          </Card>
        )}

        <DashboardBirthdaysSection
          loading={loading}
          calendar={summary?.birthday_calendar}
          upcoming={summary?.upcoming_birthdays}
          className="min-h-0"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:items-stretch">
        <Card className="shadow-card min-h-0">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Distribución por área</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Cargando…</p>
            ) : areaChartData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Sin colaboradores activos para mostrar.</p>
            ) : (
              <>
                <div className="h-64 flex items-center justify-center">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={areaChartData}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={80}
                        dataKey="value"
                        paddingAngle={3}
                      >
                        {areaChartData.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex flex-wrap gap-3 mt-2">
                  {areaChartData.map((a) => (
                    <div key={a.name} className="flex items-center gap-1.5 text-xs">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: a.color }} />
                      {a.name}
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <div className="min-h-0">
          <MonthlyHireExitFlowCard title="Altas y bajas mensuales" months={6} />
        </div>

        <Card className="shadow-card min-h-0">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Contratos próximos a vencer</CardTitle>
            {summary != null && !loading ? (
              <p className="text-xs text-muted-foreground font-normal">
                Próximos {summary.contracts_expiring_window_days} días · {summary.contracts_expiring_count} en total
              </p>
            ) : null}
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <p className="text-sm text-muted-foreground px-5 py-8">Cargando…</p>
            ) : summary != null && summary.contracts_expiring.length === 0 ? (
              <p className="text-sm text-muted-foreground px-5 py-8">Ningún contrato en la ventana actual.</p>
            ) : (
              <div className="divide-y divide-border">
                {summary?.contracts_expiring.map((c) => (
                  <div key={c.employee_id} className="flex items-center justify-between px-5 py-3">
                    <div>
                      <p className="text-sm font-medium">{formatEmployeeName(c)}</p>
                      <p className="text-xs text-muted-foreground">{c.department_name}</p>
                    </div>
                    <Badge
                      variant={c.days_remaining <= 7 ? "destructive" : c.days_remaining <= 15 ? "default" : "secondary"}
                      className="text-xs"
                    >
                      {c.days_remaining} días
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Actividad reciente</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {activityLoading ? (
            <p className="text-sm text-muted-foreground px-5 py-6">Cargando…</p>
          ) : activityError ? (
            <p className="text-sm text-destructive px-5 py-6">{activityError}</p>
          ) : activity.length === 0 ? (
            <p className="text-sm text-muted-foreground px-5 py-6">No hay actividad registrada reciente.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    {["Fecha", "Usuario", "Acción", "Recurso"].map((h) => (
                      <th
                        key={h}
                        className="text-left text-xs font-semibold text-muted-foreground px-5 py-3 whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activity.map((row) => (
                    <tr key={row.id} className="border-b border-border last:border-0">
                      <td className="px-5 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {formatActivityDate(row.created_at)}
                      </td>
                      <td className="px-5 py-3 max-w-[140px] break-words">
                        {row.user?.name?.trim() || row.user?.email || "—"}
                      </td>
                      <td className="px-5 py-3 font-medium">{row.action}</td>
                      <td className="px-5 py-3 text-muted-foreground">
                        {row.resource_type}
                        {row.resource_id != null ? ` #${row.resource_id}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
