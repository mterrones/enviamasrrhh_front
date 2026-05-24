import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Download } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { ApiHttpError } from "@/api/client";
import { downloadReportCsv, downloadReportPdf, downloadReportXlsx } from "@/api/reportExports";
import { useToast } from "@/hooks/use-toast";
import {
  fetchDashboardSummary,
  fetchPayrollPeriodAggregates,
  type DashboardSummaryData,
  type PayrollPeriodAggregatesData,
} from "@/api/dashboardSummary";
import { fetchAllAttendanceInRange, type AttendanceRecord } from "@/api/attendance";
import { fetchPayrollPeriods, fetchAllPayslipsForPeriod, type PayrollPeriod, type Payslip } from "@/api/payroll";
import { fetchAllEmployees } from "@/api/employees";
import { MonthlyHireExitFlowCard } from "@/components/reports/MonthlyHireExitFlowCard";
import { formatEmployeeName } from "@/lib/employeeName";
import { formatAppDate } from "@/lib/formatAppDate";

const ATTENDANCE_STATUS_LABEL: Record<string, string> = {
  asistido: "Asistido",
  recuperacion: "Recuperación",
  tardanza_j: "Tardanza justificada",
  tardanza_nj: "Tardanza no justificada",
  falta_j: "Falta justificada",
  falta_nj: "Falta no justificada",
  vacaciones: "Vacaciones",
};

function labelAttendanceStatus(s: string): string {
  return ATTENDANCE_STATUS_LABEL[s] ?? s;
}

function formatMoneyAmount(s: string): string {
  const n = Number(s);
  if (Number.isNaN(n)) return s;
  return n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function defaultRangeIso(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export default function ReportsPage() {
  const { toast } = useToast();
  const { hasPermission } = useAuth();
  const canAttendance = hasPermission("attendance.view");
  const canPayroll = hasPermission("payroll.view");
  const canEmployees = hasPermission("employees.view");
  const canExport = hasPermission("reports.export");
  const canExportContracts = canExport && hasPermission("reports.view");
  const canExportAttendance = canExport && canAttendance;
  const canExportPayroll = canExport && canPayroll;

  const [employeeNames, setEmployeeNames] = useState<Record<number, string>>({});

  const [contractsDays, setContractsDays] = useState(30);
  const [contractsLoading, setContractsLoading] = useState(true);
  const [contractsError, setContractsError] = useState<string | null>(null);
  const [contractsSummary, setContractsSummary] = useState<DashboardSummaryData | null>(null);

  const [attFrom, setAttFrom] = useState(() => defaultRangeIso().from);
  const [attTo, setAttTo] = useState(() => defaultRangeIso().to);
  const [attLoading, setAttLoading] = useState(false);
  const [attError, setAttError] = useState<string | null>(null);
  const [attRows, setAttRows] = useState<AttendanceRecord[]>([]);

  const [periods, setPeriods] = useState<PayrollPeriod[]>([]);
  const [periodId, setPeriodId] = useState<number | null>(null);
  const [payLoading, setPayLoading] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [payslips, setPayslips] = useState<Payslip[]>([]);

  const [exportingContracts, setExportingContracts] = useState(false);
  const [exportingAttendance, setExportingAttendance] = useState(false);
  const [exportingPayroll, setExportingPayroll] = useState(false);

  const [payrollAgg, setPayrollAgg] = useState<PayrollPeriodAggregatesData | null>(null);
  const [payrollAggLoading, setPayrollAggLoading] = useState(false);
  const [payrollAggError, setPayrollAggError] = useState<string | null>(null);

  useEffect(() => {
    if (!canEmployees) return;
    let cancelled = false;
    fetchAllEmployees()
      .then((list) => {
        if (cancelled) return;
        const m: Record<number, string> = {};
        for (const e of list) m[e.id] = formatEmployeeName(e);
        setEmployeeNames(m);
      })
      .catch(() => {
        if (!cancelled) setEmployeeNames({});
      });
    return () => {
      cancelled = true;
    };
  }, [canEmployees]);

  useEffect(() => {
    let cancelled = false;
    setContractsLoading(true);
    setContractsError(null);
    fetchDashboardSummary({ days: contractsDays, limit: 150 })
      .then((r) => {
        if (!cancelled) setContractsSummary(r.data);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          const msg =
            e instanceof ApiHttpError ? e.apiError?.message ?? e.message : "No se pudieron cargar los contratos";
          setContractsError(typeof msg === "string" ? msg : "Error");
          setContractsSummary(null);
        }
      })
      .finally(() => {
        if (!cancelled) setContractsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [contractsDays]);

  const loadAttendance = useCallback(async () => {
    if (!canAttendance) return;
    setAttLoading(true);
    setAttError(null);
    try {
      const rows = await fetchAllAttendanceInRange({ from: attFrom, to: attTo });
      rows.sort((a, b) => {
        const c = b.record_date.localeCompare(a.record_date);
        return c !== 0 ? c : b.id - a.id;
      });
      setAttRows(rows);
    } catch (e: unknown) {
      const msg =
        e instanceof ApiHttpError ? e.apiError?.message ?? e.message : "No se pudo cargar la asistencia";
      setAttError(typeof msg === "string" ? msg : "Error");
      setAttRows([]);
    } finally {
      setAttLoading(false);
    }
  }, [canAttendance, attFrom, attTo]);

  useEffect(() => {
    if (!canAttendance) return;
    void loadAttendance();
  }, [canAttendance, loadAttendance]);

  useEffect(() => {
    if (!canPayroll) return;
    let cancelled = false;
    setPayLoading(true);
    setPayError(null);
    fetchPayrollPeriods()
      .then((r) => {
        if (cancelled) return;
        setPeriods(r.data);
        if (r.data.length > 0) {
          setPeriodId((prev) => (prev != null && r.data.some((p) => p.id === prev) ? prev : r.data[0].id));
        } else {
          setPeriodId(null);
          setPayslips([]);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          const msg =
            e instanceof ApiHttpError ? e.apiError?.message ?? e.message : "No se pudieron cargar los periodos";
          setPayError(typeof msg === "string" ? msg : "Error");
          setPeriods([]);
        }
      })
      .finally(() => {
        if (!cancelled) setPayLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canPayroll]);

  useEffect(() => {
    if (!canPayroll) return;
    let cancelled = false;
    setPayrollAggLoading(true);
    setPayrollAggError(null);
    fetchPayrollPeriodAggregates({ limit: 24 })
      .then((r) => {
        if (!cancelled) setPayrollAgg(r.data);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          const msg =
            e instanceof ApiHttpError ? e.apiError?.message ?? e.message : "No se pudieron cargar los totales";
          setPayrollAggError(typeof msg === "string" ? msg : "Error");
          setPayrollAgg(null);
        }
      })
      .finally(() => {
        if (!cancelled) setPayrollAggLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canPayroll]);

  useEffect(() => {
    if (!canPayroll || periodId == null) return;
    let cancelled = false;
    setPayLoading(true);
    setPayError(null);
    fetchAllPayslipsForPeriod(periodId)
      .then((list) => {
        if (!cancelled) {
          const sorted = [...list].sort((a, b) => a.employee_id - b.employee_id);
          setPayslips(sorted);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          const msg =
            e instanceof ApiHttpError ? e.apiError?.message ?? e.message : "No se pudieron cargar las boletas";
          setPayError(typeof msg === "string" ? msg : "Error");
          setPayslips([]);
        }
      })
      .finally(() => {
        if (!cancelled) setPayLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canPayroll, periodId]);

  const contractsRows = contractsSummary?.contracts_expiring ?? [];

  const selectedPeriodAgg =
    periodId != null ? payrollAgg?.periods.find((p) => p.payroll_period_id === periodId) : undefined;

  const handleExportContractsCsv = async () => {
    if (!canExportContracts) return;
    setExportingContracts(true);
    try {
      const q = new URLSearchParams();
      q.set("days", String(contractsDays));
      q.set("limit", "150");
      await downloadReportCsv(`reports/exports/contracts-expiring.csv?${q.toString()}`);
      toast({ title: "Archivo CSV descargado" });
    } catch (e: unknown) {
      const msg =
        e instanceof ApiHttpError ? e.apiError?.message ?? e.message : "No se pudo exportar";
      toast({ title: "Error al exportar", description: typeof msg === "string" ? msg : "Error", variant: "destructive" });
    } finally {
      setExportingContracts(false);
    }
  };

  const handleExportContractsXlsx = async () => {
    if (!canExportContracts) return;
    setExportingContracts(true);
    try {
      const q = new URLSearchParams();
      q.set("days", String(contractsDays));
      q.set("limit", "150");
      await downloadReportXlsx(`reports/exports/contracts-expiring.xlsx?${q.toString()}`);
      toast({ title: "Excel descargado" });
    } catch (e: unknown) {
      const msg =
        e instanceof ApiHttpError ? e.apiError?.message ?? e.message : "No se pudo exportar";
      toast({ title: "Error al exportar", description: typeof msg === "string" ? msg : "Error", variant: "destructive" });
    } finally {
      setExportingContracts(false);
    }
  };

  const handleExportContractsPdf = async () => {
    if (!canExportContracts) return;
    setExportingContracts(true);
    try {
      const q = new URLSearchParams();
      q.set("days", String(contractsDays));
      q.set("limit", "150");
      await downloadReportPdf(`reports/exports/contracts-expiring.pdf?${q.toString()}`);
      toast({ title: "PDF descargado" });
    } catch (e: unknown) {
      const msg =
        e instanceof ApiHttpError ? e.apiError?.message ?? e.message : "No se pudo exportar";
      toast({ title: "Error al exportar", description: typeof msg === "string" ? msg : "Error", variant: "destructive" });
    } finally {
      setExportingContracts(false);
    }
  };

  const handleExportAttendanceCsv = async () => {
    if (!canExportAttendance || !attFrom || !attTo) return;
    setExportingAttendance(true);
    try {
      const q = new URLSearchParams();
      q.set("from", attFrom);
      q.set("to", attTo);
      await downloadReportCsv(`reports/exports/attendance.csv?${q.toString()}`);
      toast({ title: "Archivo CSV descargado" });
    } catch (e: unknown) {
      const msg =
        e instanceof ApiHttpError ? e.apiError?.message ?? e.message : "No se pudo exportar";
      toast({ title: "Error al exportar", description: typeof msg === "string" ? msg : "Error", variant: "destructive" });
    } finally {
      setExportingAttendance(false);
    }
  };

  const handleExportPayrollCsv = async () => {
    if (!canExportPayroll || periodId == null) return;
    setExportingPayroll(true);
    try {
      const q = new URLSearchParams();
      q.set("payroll_period_id", String(periodId));
      await downloadReportCsv(`reports/exports/payroll.csv?${q.toString()}`);
      toast({ title: "Archivo CSV descargado" });
    } catch (e: unknown) {
      const msg =
        e instanceof ApiHttpError ? e.apiError?.message ?? e.message : "No se pudo exportar";
      toast({ title: "Error al exportar", description: typeof msg === "string" ? msg : "Error", variant: "destructive" });
    } finally {
      setExportingPayroll(false);
    }
  };

  const handleExportPayrollXlsx = async () => {
    if (!canExportPayroll || periodId == null) return;
    setExportingPayroll(true);
    try {
      const q = new URLSearchParams();
      q.set("payroll_period_id", String(periodId));
      await downloadReportXlsx(`reports/exports/payroll.xlsx?${q.toString()}`);
      toast({ title: "Excel descargado" });
    } catch (e: unknown) {
      const msg =
        e instanceof ApiHttpError ? e.apiError?.message ?? e.message : "No se pudo exportar";
      toast({ title: "Error al exportar", description: typeof msg === "string" ? msg : "Error", variant: "destructive" });
    } finally {
      setExportingPayroll(false);
    }
  };

  const handleExportPayrollPdf = async () => {
    if (!canExportPayroll || periodId == null) return;
    setExportingPayroll(true);
    try {
      const q = new URLSearchParams();
      q.set("payroll_period_id", String(periodId));
      await downloadReportPdf(`reports/exports/payroll.pdf?${q.toString()}`);
      toast({ title: "PDF descargado" });
    } catch (e: unknown) {
      const msg =
        e instanceof ApiHttpError ? e.apiError?.message ?? e.message : "No se pudo exportar";
      toast({ title: "Error al exportar", description: typeof msg === "string" ? msg : "Error", variant: "destructive" });
    } finally {
      setExportingPayroll(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Reportes y Analítica</h1>
          <p className="text-muted-foreground text-sm mt-1">Indicadores clave y reportes exportables</p>
        </div>
        <div className="max-w-sm text-right">
          <p className="text-xs text-muted-foreground">
            {canExport
              ? "Contratos por vencer y Planilla: CSV, Excel y PDF. Asistencia: CSV (mismo listado que en pantalla)."
              : "La exportación requiere el permiso de exportar reportes."}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-base">Evolución de headcount</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Las series históricas de plantilla no están disponibles en esta versión.
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-base">Tasa de ausentismo</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              El porcentaje de ausentismo requiere reglas de negocio adicionales; no se muestra aún.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-5">
          <p className="text-sm text-muted-foreground text-center">
            Headcount histórico exacto y ausentismo % estarán en una próxima versión.
          </p>
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 flex-wrap">
          <CardTitle className="text-base">Contratos por vencer</CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            {canExportContracts ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={contractsLoading || !!contractsError || exportingContracts}
                  onClick={() => void handleExportContractsCsv()}
                >
                  <Download className="w-4 h-4" />
                  {exportingContracts ? "…" : "CSV"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={contractsLoading || !!contractsError || exportingContracts}
                  onClick={() => void handleExportContractsXlsx()}
                >
                  <Download className="w-4 h-4" />
                  {exportingContracts ? "…" : "Excel"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={contractsLoading || !!contractsError || exportingContracts}
                  onClick={() => void handleExportContractsPdf()}
                >
                  <Download className="w-4 h-4" />
                  {exportingContracts ? "…" : "PDF"}
                </Button>
              </>
            ) : null}
            <Select
              value={String(contractsDays)}
              onValueChange={(v) => setContractsDays(Number.parseInt(v, 10))}
              disabled={contractsLoading}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="15">Próximos 15 días</SelectItem>
                <SelectItem value="30">Próximos 30 días</SelectItem>
                <SelectItem value="60">Próximos 60 días</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {contractsError ? (
            <p className="text-sm text-destructive px-5 py-6">{contractsError}</p>
          ) : contractsLoading ? (
            <p className="text-sm text-muted-foreground px-5 py-6">Cargando…</p>
          ) : contractsRows.length === 0 ? (
            <p className="text-sm text-muted-foreground px-5 py-6">Ningún contrato en el rango seleccionado.</p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  {["Colaborador", "Área", "Tipo contrato", "Vencimiento"].map((h) => (
                    <th key={h} className="text-left text-xs font-semibold text-muted-foreground px-5 py-3">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {contractsRows.map((c) => (
                  <tr key={c.employee_id} className="border-b border-border last:border-0">
                    <td className="px-5 py-3 text-sm font-medium">{formatEmployeeName(c)}</td>
                    <td className="px-5 py-3 text-sm">{c.department_name}</td>
                    <td className="px-5 py-3 text-sm">{c.contract_type?.trim() ? c.contract_type : "—"}</td>
                    <td className="px-5 py-3 text-sm text-warning font-medium">{formatAppDate(c.contract_end)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {contractsSummary != null && !contractsLoading && !contractsError ? (
            <p className="text-xs text-muted-foreground px-5 py-2 border-t border-border">
              Mostrando hasta {contractsRows.length} de {contractsSummary.contracts_expiring_count} contrato(s) en
              ventana.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardHeader className="space-y-3">
          <CardTitle className="text-base">Asistencia</CardTitle>
          {!canAttendance ? (
            <p className="text-sm text-muted-foreground font-normal">No tienes permiso para ver asistencia.</p>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Desde</Label>
                <Input type="date" value={attFrom} onChange={(e) => setAttFrom(e.target.value)} disabled={attLoading} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Hasta</Label>
                <Input type="date" value={attTo} onChange={(e) => setAttTo(e.target.value)} disabled={attLoading} />
              </div>
              <Button type="button" size="sm" variant="outline" disabled={attLoading} onClick={() => void loadAttendance()}>
                Actualizar
              </Button>
              {canExportAttendance ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  disabled={attLoading || !attFrom || !attTo || exportingAttendance}
                  onClick={() => void handleExportAttendanceCsv()}
                >
                  <Download className="w-4 h-4" />
                  {exportingAttendance ? "…" : "CSV"}
                </Button>
              ) : null}
            </div>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {!canAttendance ? null : attError ? (
            <p className="text-sm text-destructive px-5 py-6">{attError}</p>
          ) : attLoading ? (
            <p className="text-sm text-muted-foreground px-5 py-6">Cargando…</p>
          ) : attRows.length === 0 ? (
            <p className="text-sm text-muted-foreground px-5 py-6">Sin registros en el rango.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px]">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    {["Fecha", "Colaborador", "Estado", "Entrada", "Salida"].map((h) => (
                      <th key={h} className="text-left text-xs font-semibold text-muted-foreground px-5 py-3">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {attRows.map((r) => (
                    <tr key={r.id} className="border-b border-border last:border-0">
                      <td className="px-5 py-3 text-sm tabular-nums">{formatAppDate(r.record_date)}</td>
                      <td className="px-5 py-3 text-sm">
                        {employeeNames[r.employee_id] ?? `ID ${r.employee_id}`}
                      </td>
                      <td className="px-5 py-3 text-sm">{labelAttendanceStatus(r.status)}</td>
                      <td className="px-5 py-3 text-sm tabular-nums">{r.check_in ?? "—"}</td>
                      <td className="px-5 py-3 text-sm tabular-nums">{r.check_out ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 flex-wrap">
          <CardTitle className="text-base">Planilla</CardTitle>
          {!canPayroll ? (
            <span className="text-sm text-muted-foreground">Sin permiso</span>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              {canExportPayroll && periods.length > 0 ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled={payLoading || periodId == null || exportingPayroll}
                    onClick={() => void handleExportPayrollCsv()}
                  >
                    <Download className="w-4 h-4" />
                    {exportingPayroll ? "…" : "CSV"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled={payLoading || periodId == null || exportingPayroll}
                    onClick={() => void handleExportPayrollXlsx()}
                  >
                    <Download className="w-4 h-4" />
                    {exportingPayroll ? "…" : "Excel"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled={payLoading || periodId == null || exportingPayroll}
                    onClick={() => void handleExportPayrollPdf()}
                  >
                    <Download className="w-4 h-4" />
                    {exportingPayroll ? "…" : "PDF"}
                  </Button>
                </>
              ) : null}
              {periods.length > 0 ? (
                <Select
                  value={periodId != null ? String(periodId) : ""}
                  onValueChange={(v) => setPeriodId(Number.parseInt(v, 10))}
                  disabled={payLoading}
                >
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="Periodo" />
                  </SelectTrigger>
                  <SelectContent>
                    {periods.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {String(p.month).padStart(2, "0")}/{p.year}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
            </div>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {canPayroll && payrollAggError ? (
            <p className="text-sm text-destructive px-5 py-3 border-b border-border">{payrollAggError}</p>
          ) : null}
          {canPayroll && periodId != null && selectedPeriodAgg != null && !payrollAggError ? (
            <div className="px-5 py-3 border-b border-border bg-muted/30">
              <p className="text-xs text-muted-foreground mb-2">
                Totales del período seleccionado (suma de boletas en tu alcance). Destacado: neto total.
              </p>
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <span className="tabular-nums">
                  Bruto: <span className="font-medium">S/ {formatMoneyAmount(selectedPeriodAgg.gross_total)}</span>
                </span>
                <span className="tabular-nums">
                  Descuentos:{" "}
                  <span className="font-medium">S/ {formatMoneyAmount(selectedPeriodAgg.deductions_total)}</span>
                </span>
                <span className="tabular-nums">
                  Neto: <span className="font-semibold">S/ {formatMoneyAmount(selectedPeriodAgg.net_total)}</span>
                </span>
              </div>
            </div>
          ) : null}
          {canPayroll && periodId != null && payrollAggLoading && !payrollAggError ? (
            <p className="text-xs text-muted-foreground px-5 py-2 border-b border-border">Cargando totales…</p>
          ) : null}
          {!canPayroll ? (
            <p className="text-sm text-muted-foreground px-5 py-6">No tienes permiso para ver planilla.</p>
          ) : payError && periods.length === 0 ? (
            <p className="text-sm text-destructive px-5 py-6">{payError}</p>
          ) : periods.length === 0 ? (
            <p className="text-sm text-muted-foreground px-5 py-6">No hay periodos de planilla.</p>
          ) : payError ? (
            <p className="text-sm text-destructive px-5 py-6">{payError}</p>
          ) : payLoading ? (
            <p className="text-sm text-muted-foreground px-5 py-6">Cargando…</p>
          ) : payslips.length === 0 ? (
            <p className="text-sm text-muted-foreground px-5 py-6">Sin boletas en este periodo.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px]">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    {["Colaborador", "Bruto", "Descuentos", "Neto", "Estado"].map((h) => (
                      <th key={h} className="text-left text-xs font-semibold text-muted-foreground px-5 py-3">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {payslips.map((p) => (
                    <tr key={p.id} className="border-b border-border last:border-0">
                      <td className="px-5 py-3 text-sm font-medium">
                        {employeeNames[p.employee_id] ?? `ID ${p.employee_id}`}
                      </td>
                      <td className="px-5 py-3 text-sm tabular-nums">S/ {formatMoneyAmount(p.gross_amount)}</td>
                      <td className="px-5 py-3 text-sm tabular-nums">S/ {formatMoneyAmount(p.deductions_amount)}</td>
                      <td className="px-5 py-3 text-sm tabular-nums font-medium">S/ {formatMoneyAmount(p.net_amount)}</td>
                      <td className="px-5 py-3 text-sm">{p.status}</td>
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
