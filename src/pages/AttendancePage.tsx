import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarCheck, FileSpreadsheet, FileText, Download, CalendarIcon, Pencil, CalendarDays, Palmtree } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format, differenceInCalendarDays } from "date-fns";
import { formatAppDate } from "@/lib/formatAppDate";
import { formatEmployeeName } from "@/lib/employeeName";
import { cn } from "@/lib/utils";
import { formatDecimalHoursAsDuration } from "@/lib/formatWorkedDuration";
import { attendanceTimeToApiNullable } from "@/lib/attendanceTimeInput";
import { ALL_ATTENDANCE_STATUSES, deriveAttendanceFormState } from "@/lib/attendanceFormState";
import { resolveEmployeeExpectedSchedule } from "@/lib/employeeExpectedSchedule";
import {
  filterWeekdayAttendanceRecords,
  isWeekendIso,
  isWeekendYmd,
  recordDateToIsoDay,
} from "@/lib/weekendAttendance";
import { ApiHttpError } from "@/api/client";
import { downloadReportCsv, downloadReportPdf, downloadReportXlsx } from "@/api/reportExports";
import { ListPaginationBar } from "@/components/ListPaginationBar";
import { DEFAULT_LIST_PAGE_SIZE } from "@/constants/pagination";
import { fetchAllEmployees, fetchEmployeeVacationBalance, type VacationBalanceData } from "@/api/employees";
import {
  createVacationRequest,
  fetchVacationRequestsPage,
  patchVacationRequestStatus,
  type VacationRequest,
  type VacationStatus,
} from "@/api/vacationRequests";
import {
  createAttendanceRecord,
  downloadAttendanceJustificationBlob,
  fetchAllAttendanceInRange,
  patchAttendanceRecord,
  uploadAttendanceJustificationFile,
  type AttendanceRecord,
  type AttendanceStatus,
} from "@/api/attendance";
import { useAuth } from "@/contexts/AuthContext";

const statusColorMap: Record<string, string> = {
  asistido: "bg-success",
  recuperacion: "bg-info",
  tardanza_j: "bg-success-dark",
  tardanza_nj: "bg-warning",
  falta_j: "bg-primary",
  falta_nj: "bg-destructive",
  vacaciones: "bg-purple",
  __none__: "bg-muted",
};

const meses = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const years = Array.from({ length: 11 }, (_, i) => 2020 + i);

function monthDayCount(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function buildNeutralMonthDays(year: number, month: number): { day: number; status: string }[] {
  const n = monthDayCount(year, month);
  return Array.from({ length: n }, (_, i) => ({ day: i + 1, status: "__none__" }));
}

const getFirstDayOffset = (year: number, month: number) => new Date(year, month, 1).getDay();

const vacationStatusLabel: Record<VacationStatus, string> = {
  pendiente: "Pendiente",
  aprobado: "Aprobado",
  rechazado: "Rechazado",
};

const ATTENDANCE_STATUS_OPTIONS: { value: AttendanceStatus; label: string }[] = [
  { value: "asistido", label: "Asistido" },
  { value: "recuperacion", label: "Recuperación" },
  { value: "tardanza_j", label: "Tard./Salida just." },
  { value: "tardanza_nj", label: "Tardanza" },
  { value: "falta_j", label: "Falta justificada" },
  { value: "falta_nj", label: "Falta" },
  { value: "vacaciones", label: "Vacaciones" },
];

function labelAttendanceStatus(s: string): string {
  return ATTENDANCE_STATUS_OPTIONS.find((o) => o.value === s)?.label ?? s;
}

function toTimeInputValue(v: string | null | undefined): string {
  if (!v) return "";
  return v.length >= 5 ? v.slice(0, 5) : v;
}

function displayVacationRange(start: string, end: string): string {
  const a = formatAppDate(start);
  const b = formatAppDate(end);
  if (a === "—" && b === "—") return `${start} — ${end}`;
  return `${a} — ${b}`;
}

function formatAttendanceDateLabel(iso: string): string {
  return formatAppDate(iso);
}

type AttendanceMainTab = "calendario" | "vacaciones";

export default function AttendancePage() {
  const { toast } = useToast();
  const { hasPermission } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const mainTabParam = searchParams.get("tab");
  const mainTab: AttendanceMainTab = mainTabParam === "vacaciones" ? "vacaciones" : "calendario";
  const employeeIdFromUrl = searchParams.get("employee_id");

  const setMainTab = useCallback(
    (value: string) => {
      const next: AttendanceMainTab = value === "vacaciones" ? "vacaciones" : "calendario";
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next === "vacaciones") {
            p.set("tab", "vacaciones");
          } else {
            p.delete("tab");
          }
          return p;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  const canManageVacationRequests = hasPermission("attendance.manage");
  const canApproveVacationRequests = hasPermission("attendance.approve");
  const canManageAttendance = hasPermission("attendance.manage");
  const canExportAttendance =
    hasPermission("reports.export") && hasPermission("attendance.view");
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(String(now.getFullYear()));
  const [selectedMonth, setSelectedMonth] = useState(String(now.getMonth()));
  const [selectedEmpleado, setSelectedEmpleado] = useState("all");
  const [daysInMonth, setDaysInMonth] = useState(() => buildNeutralMonthDays(now.getFullYear(), now.getMonth()));
  const [firstDayOffset, setFirstDayOffset] = useState(() => getFirstDayOffset(now.getFullYear(), now.getMonth()));
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [attendanceError, setAttendanceError] = useState<string | null>(null);
  const [monthAttendanceRecords, setMonthAttendanceRecords] = useState<AttendanceRecord[]>([]);

  const [attendanceDialogOpen, setAttendanceDialogOpen] = useState(false);
  const [attendanceMode, setAttendanceMode] = useState<"create" | "edit">("create");
  const [attendanceEditingId, setAttendanceEditingId] = useState<number | null>(null);
  const [attendanceDate, setAttendanceDate] = useState("");
  const [attendanceStatus, setAttendanceStatus] = useState<AttendanceStatus>("asistido");
  const [attendanceCheckIn, setAttendanceCheckIn] = useState("");
  const [attendanceCheckOut, setAttendanceCheckOut] = useState("");
  const [attendanceJustification, setAttendanceJustification] = useState("");
  const [attendanceFile, setAttendanceFile] = useState<File | null>(null);
  const [attendanceSaving, setAttendanceSaving] = useState(false);
  const [attendanceDateSource, setAttendanceDateSource] = useState<"calendar" | "button" | "edit">("button");
  const [exportingAttendanceCsv, setExportingAttendanceCsv] = useState(false);
  const [exportingAttendanceXlsx, setExportingAttendanceXlsx] = useState(false);
  const [exportingAttendancePdf, setExportingAttendancePdf] = useState(false);

  const [showNuevaSolicitud, setShowNuevaSolicitud] = useState(false);
  const [vacationRequests, setVacationRequests] = useState<VacationRequest[]>([]);
  const [vacationLoading, setVacationLoading] = useState(true);
  const [vacationError, setVacationError] = useState<string | null>(null);
  const [vacationEmployees, setVacationEmployees] = useState<
    { id: number; displayName: string; modality: string | null }[]
  >([]);
  const [vacationPage, setVacationPage] = useState(1);
  const [vacationMeta, setVacationMeta] = useState({
    current_page: 1,
    last_page: 1,
    total: 0,
    per_page: DEFAULT_LIST_PAGE_SIZE,
  });
  const [statusUpdatingId, setStatusUpdatingId] = useState<number | null>(null);
  const [vacationCorrectionRow, setVacationCorrectionRow] = useState<VacationRequest | null>(null);
  const [vacationCorrectionStatus, setVacationCorrectionStatus] = useState<VacationStatus | "">("");
  const [vacationCorrectionSaving, setVacationCorrectionSaving] = useState(false);
  const [creatingVacation, setCreatingVacation] = useState(false);
  const [selEmpleado, setSelEmpleado] = useState("");
  const [fechaInicio, setFechaInicio] = useState<Date>();
  const [fechaFin, setFechaFin] = useState<Date>();
  const [motivo, setMotivo] = useState("");

  useEffect(() => {
    if (mainTab !== "vacaciones") return;
    if (employeeIdFromUrl == null || employeeIdFromUrl === "") return;
    const id = Number(employeeIdFromUrl);
    if (Number.isNaN(id) || id <= 0) return;
    setSelEmpleado(String(id));
  }, [mainTab, employeeIdFromUrl]);

  useEffect(() => {
    if (mainTab === "vacaciones") return;
    if (employeeIdFromUrl == null || employeeIdFromUrl === "") return;
    const id = Number(employeeIdFromUrl);
    if (Number.isNaN(id) || id <= 0) return;
    setSelectedEmpleado(String(id));
  }, [mainTab, employeeIdFromUrl]);
  const [hrVacBalance, setHrVacBalance] = useState<VacationBalanceData | null>(null);
  const [hrVacBalanceLoading, setHrVacBalanceLoading] = useState(false);
  const [hrVacBalanceError, setHrVacBalanceError] = useState<string | null>(null);

  const diasCalculados = fechaInicio && fechaFin ? Math.max(differenceInCalendarDays(fechaFin, fechaInicio) + 1, 0) : 0;

  useEffect(() => {
    if (!selEmpleado) {
      setHrVacBalance(null);
      setHrVacBalanceError(null);
      setHrVacBalanceLoading(false);
      return;
    }
    const empId = Number(selEmpleado);
    if (Number.isNaN(empId)) {
      return;
    }
    let cancelled = false;
    setHrVacBalanceLoading(true);
    setHrVacBalanceError(null);
    (async () => {
      try {
        const year = new Date().getFullYear();
        const r = await fetchEmployeeVacationBalance(empId, year);
        if (!cancelled) setHrVacBalance(r.data);
      } catch (err) {
        if (!cancelled) {
          setHrVacBalance(null);
          const msg =
            err instanceof ApiHttpError ? err.apiError?.message ?? err.message : "No se pudo cargar el saldo";
          setHrVacBalanceError(typeof msg === "string" ? msg : "Error");
        }
      } finally {
        if (!cancelled) setHrVacBalanceLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selEmpleado]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const all = await fetchAllEmployees();
        if (cancelled) return;
        setVacationEmployees(
          all.map((e) => ({
            id: e.id,
            displayName: formatEmployeeName(e),
            modality: e.modality ?? null,
          })),
        );
      } catch {
        if (!cancelled) setVacationEmployees([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadVacationData = useCallback(async () => {
    setVacationLoading(true);
    setVacationError(null);
    try {
      const vacRes = await fetchVacationRequestsPage({
        per_page: DEFAULT_LIST_PAGE_SIZE,
        page: vacationPage,
      });
      setVacationRequests(vacRes.data);
      setVacationMeta({
        current_page: vacRes.meta.current_page ?? vacationPage,
        last_page: vacRes.meta.last_page ?? 1,
        total: vacRes.meta.total ?? 0,
        per_page: vacRes.meta.per_page ?? DEFAULT_LIST_PAGE_SIZE,
      });
    } catch (err) {
      const msg =
        err instanceof ApiHttpError ? err.apiError?.message ?? err.message : "No se pudieron cargar las solicitudes";
      setVacationError(typeof msg === "string" ? msg : "Error");
      setVacationRequests([]);
      setVacationMeta((m) => ({ ...m, total: 0, last_page: 1, current_page: 1 }));
    } finally {
      setVacationLoading(false);
    }
  }, [vacationPage]);

  useEffect(() => {
    loadVacationData();
  }, [loadVacationData]);

  const loadCalendarMonth = useCallback(async () => {
    const y = parseInt(selectedYear, 10);
    const m = parseInt(selectedMonth, 10);
    if (Number.isNaN(y) || Number.isNaN(m)) return;

    setFirstDayOffset(getFirstDayOffset(y, m));

    if (selectedEmpleado === "all") {
      setMonthAttendanceRecords([]);
      setDaysInMonth(buildNeutralMonthDays(y, m));
      setAttendanceLoading(false);
      setAttendanceError(null);
      return;
    }

    setAttendanceLoading(true);
    setAttendanceError(null);
    const first = format(new Date(y, m, 1), "yyyy-MM-dd");
    const last = format(new Date(y, m + 1, 0), "yyyy-MM-dd");
    const empId = Number(selectedEmpleado);
    if (Number.isNaN(empId)) {
      setMonthAttendanceRecords([]);
      setDaysInMonth(buildNeutralMonthDays(y, m));
      setAttendanceLoading(false);
      return;
    }

    try {
      const records = await fetchAllAttendanceInRange({
        employee_id: empId,
        from: first,
        to: last,
      });
      const weekdayRecords = filterWeekdayAttendanceRecords(records);
      setMonthAttendanceRecords(weekdayRecords.slice().sort((a, b) => a.record_date.localeCompare(b.record_date)));
      const statusByIso = new Map<string, string>();
      weekdayRecords.forEach((r) => {
        const d = recordDateToIsoDay(r);
        statusByIso.set(d, r.status);
      });
      const total = monthDayCount(y, m);
      const days = Array.from({ length: total }, (_, i) => {
        const day = i + 1;
        const iso = format(new Date(y, m, day), "yyyy-MM-dd");
        const statusSt = statusByIso.get(iso) ?? "__none__";
        return { day, status: statusSt };
      });
      setDaysInMonth(days);
    } catch (err) {
      const msg =
        err instanceof ApiHttpError ? err.apiError?.message ?? err.message : "No se pudo cargar la asistencia";
      setAttendanceError(typeof msg === "string" ? msg : "Error");
      setMonthAttendanceRecords([]);
      setDaysInMonth(buildNeutralMonthDays(y, m));
    } finally {
      setAttendanceLoading(false);
    }
  }, [selectedYear, selectedMonth, selectedEmpleado]);

  useEffect(() => {
    void loadCalendarMonth();
  }, [loadCalendarMonth]);

  const handleYearChange = (year: string) => {
    setSelectedYear(year);
  };

  const handleMonthChange = (month: string) => {
    setSelectedMonth(month);
  };

  const resetAttendanceForm = () => {
    setAttendanceEditingId(null);
    setAttendanceDate("");
    setAttendanceStatus("asistido");
    setAttendanceCheckIn("");
    setAttendanceCheckOut("");
    setAttendanceJustification("");
    setAttendanceFile(null);
    setAttendanceDateSource("button");
  };

  const attendanceExpectedSchedule = useMemo(() => {
    if (selectedEmpleado === "all") {
      return resolveEmployeeExpectedSchedule(null);
    }
    const empId = Number(selectedEmpleado);
    const emp = vacationEmployees.find((e) => e.id === empId);
    return resolveEmployeeExpectedSchedule(emp?.modality);
  }, [selectedEmpleado, vacationEmployees]);

  const openAttendanceCreate = (initialDateIso?: string) => {
    const y = parseInt(selectedYear, 10);
    const m = parseInt(selectedMonth, 10);
    if (Number.isNaN(y) || Number.isNaN(m)) return;
    let iso: string;
    if (initialDateIso && initialDateIso.length >= 10) {
      iso = initialDateIso.slice(0, 10);
      setAttendanceDateSource("calendar");
    } else {
      const today = new Date();
      let d = today.getDate();
      if (today.getFullYear() !== y || today.getMonth() !== m) {
        d = 1;
      }
      iso = format(new Date(y, m, d), "yyyy-MM-dd");
      setAttendanceDateSource("button");
    }
    setAttendanceMode("create");
    setAttendanceEditingId(null);
    setAttendanceDate(iso);
    const { checkIn, checkOut } = attendanceExpectedSchedule;
    setAttendanceCheckIn(checkIn);
    setAttendanceCheckOut(checkOut);
    setAttendanceStatus(
      deriveAttendanceFormState(checkIn, checkOut, "asistido", attendanceExpectedSchedule).suggestedStatus,
    );
    setAttendanceJustification("");
    setAttendanceFile(null);
    setAttendanceDialogOpen(true);
  };

  const handleCalendarDayClick = (day: number) => {
    if (!canManageAttendance) return;
    if (selectedEmpleado !== "all" && attendanceLoading) return;
    if (selectedEmpleado === "all") {
      toast({
        title: "Elige un colaborador",
        description: "Selecciona un colaborador en el filtro para registrar o editar asistencia manualmente.",
      });
      return;
    }
    const y = parseInt(selectedYear, 10);
    const mo = parseInt(selectedMonth, 10);
    if (Number.isNaN(y) || Number.isNaN(mo)) return;
    if (isWeekendYmd(y, mo, day)) {
      toast({
        title: "Día no laborable",
        description: "Sábado y domingo no son días laborables. No se registra asistencia en fines de semana.",
      });
      return;
    }
    const iso = format(new Date(y, mo, day), "yyyy-MM-dd");
    const rec = monthAttendanceRecords.find((r) => {
      const d = r.record_date.length >= 10 ? r.record_date.slice(0, 10) : r.record_date;
      return d === iso;
    });
    if (rec) {
      openAttendanceEdit(rec);
    } else {
      openAttendanceCreate(iso);
    }
  };

  const openAttendanceEdit = (r: AttendanceRecord) => {
    setAttendanceMode("edit");
    setAttendanceDateSource("edit");
    setAttendanceEditingId(r.id);
    setAttendanceDate(r.record_date.length >= 10 ? r.record_date.slice(0, 10) : r.record_date);
    setAttendanceStatus(r.status);
    setAttendanceCheckIn(toTimeInputValue(r.check_in));
    setAttendanceCheckOut(toTimeInputValue(r.check_out));
    setAttendanceJustification(r.justification ?? "");
    setAttendanceFile(null);
    setAttendanceDialogOpen(true);
  };

  const attendanceFormUi = useMemo(
    () =>
      deriveAttendanceFormState(
        attendanceCheckIn,
        attendanceCheckOut,
        attendanceStatus,
        attendanceExpectedSchedule,
      ),
    [attendanceCheckIn, attendanceCheckOut, attendanceStatus, attendanceExpectedSchedule],
  );

  const attendanceDateIsWeekend = useMemo(() => isWeekendIso(attendanceDate), [attendanceDate]);

  const isAttendanceDateEditable = attendanceMode === "create" && attendanceDateSource === "button";

  useEffect(() => {
    if (!attendanceDialogOpen) return;
    setAttendanceStatus((prev) => {
      const ui = deriveAttendanceFormState(
        attendanceCheckIn,
        attendanceCheckOut,
        prev,
        attendanceExpectedSchedule,
      );
      if (ui.statusDisabled) return ui.suggestedStatus;
      if (!ui.allowedStatuses.includes(prev)) return ui.suggestedStatus;
      return prev;
    });
  }, [attendanceCheckIn, attendanceCheckOut, attendanceDialogOpen, attendanceExpectedSchedule]);

  useEffect(() => {
    if (!attendanceDialogOpen) return;
    setAttendanceJustification((prev) => {
      const ui = deriveAttendanceFormState(
        attendanceCheckIn,
        attendanceCheckOut,
        attendanceStatus,
        attendanceExpectedSchedule,
      );
      if (ui.justificationDisabled && prev) return "";
      return prev;
    });
    setAttendanceFile((prev) => {
      const ui = deriveAttendanceFormState(
        attendanceCheckIn,
        attendanceCheckOut,
        attendanceStatus,
        attendanceExpectedSchedule,
      );
      if (ui.fileDisabled && prev) return null;
      return prev;
    });
  }, [attendanceCheckIn, attendanceCheckOut, attendanceStatus, attendanceDialogOpen, attendanceExpectedSchedule]);

  const handleAttendanceCheckInChange = (value: string) => {
    setAttendanceCheckIn(value);
  };

  const handleAttendanceCheckOutChange = (value: string) => {
    setAttendanceCheckOut(value);
  };

  const handleSaveAttendance = async () => {
    if (!canManageAttendance) return;
    if (isWeekendIso(attendanceDate)) {
      toast({
        title: "Día no laborable",
        description: "No se puede guardar asistencia en sábado ni domingo.",
        variant: "destructive",
      });
      return;
    }
    if (
      deriveAttendanceFormState(
        attendanceCheckIn,
        attendanceCheckOut,
        attendanceStatus,
        attendanceExpectedSchedule,
      ).partialTimeInvalid
    ) {
      toast({
        title: "Horas incompletas",
        description:
          "Indica hora completa (HH:MM) en Entrada y Salida, o deja ambos sin hora: vacío o marcador completo (--:--). No uses valores parciales (p. ej. 09:--, --:45, --:00).",
        variant: "destructive",
      });
      return;
    }
    const empId = Number(selectedEmpleado);
    if (attendanceMode === "create" && (Number.isNaN(empId) || !attendanceDate.trim())) {
      toast({ title: "Campos incompletos", variant: "destructive" });
      return;
    }
    if (attendanceMode === "edit" && attendanceEditingId === null) return;
    setAttendanceSaving(true);
    try {
      const patchBody = {
        status: attendanceStatus,
        check_in: attendanceTimeToApiNullable(attendanceCheckIn),
        check_out: attendanceTimeToApiNullable(attendanceCheckOut),
        justification: attendanceJustification.trim() || null,
      };
      let recordId: number;
      if (attendanceMode === "create") {
        const created = await createAttendanceRecord({
          employee_id: empId,
          record_date: attendanceDate,
          status: attendanceStatus,
          check_in: patchBody.check_in ?? undefined,
          check_out: patchBody.check_out ?? undefined,
          justification: patchBody.justification ?? undefined,
        });
        recordId = created.data.id;
      } else {
        await patchAttendanceRecord(attendanceEditingId!, patchBody);
        recordId = attendanceEditingId!;
      }
      if (attendanceFile) {
        await uploadAttendanceJustificationFile(recordId, attendanceFile);
      }
      toast({ title: "Registro guardado", description: "Los datos de asistencia se actualizaron." });
      setAttendanceDialogOpen(false);
      resetAttendanceForm();
      await loadCalendarMonth();
    } catch (err) {
      const msg = err instanceof ApiHttpError ? err.apiError?.message ?? err.message : "No se pudo guardar";
      toast({ title: "Error", description: typeof msg === "string" ? msg : "Intenta de nuevo", variant: "destructive" });
    } finally {
      setAttendanceSaving(false);
    }
  };

  const handleDownloadJustification = async (id: number) => {
    try {
      const blob = await downloadAttendanceJustificationBlob(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `justificacion-asistencia-${id}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Error", description: "No se pudo descargar el archivo.", variant: "destructive" });
    }
  };

  const handleGuardar = async () => {
    if (!selEmpleado || !fechaInicio || !fechaFin || diasCalculados <= 0) {
      toast({ title: "Error", description: "Completa todos los campos correctamente.", variant: "destructive" });
      return;
    }
    const empId = Number(selEmpleado);
    if (Number.isNaN(empId)) {
      toast({ title: "Error", description: "Colaborador no válido.", variant: "destructive" });
      return;
    }
    setCreatingVacation(true);
    try {
      await createVacationRequest({
        employee_id: empId,
        start_date: format(fechaInicio, "yyyy-MM-dd"),
        end_date: format(fechaFin, "yyyy-MM-dd"),
        days: diasCalculados,
      });
      const empNombre = vacationEmployees.find((e) => e.id === empId)?.displayName ?? `Colaborador ${empId}`;
      toast({ title: "Solicitud enviada", description: `Vacaciones de ${empNombre} registradas como pendiente.` });
      setShowNuevaSolicitud(false);
      setSelEmpleado("");
      setFechaInicio(undefined);
      setFechaFin(undefined);
      setMotivo("");
      await loadVacationData();
    } catch (err) {
      const msg = err instanceof ApiHttpError ? err.apiError?.message ?? err.message : "No se pudo crear la solicitud";
      toast({ title: "Error", description: typeof msg === "string" ? msg : "Intenta de nuevo", variant: "destructive" });
    } finally {
      setCreatingVacation(false);
    }
  };

  const handleVacationStatusChange = async (id: number, status: VacationStatus) => {
    setStatusUpdatingId(id);
    try {
      await patchVacationRequestStatus(id, { status });
      toast({
        title: "Estado actualizado",
        description: `Solicitud marcada como ${vacationStatusLabel[status].toLowerCase()}.`,
      });
      await loadVacationData();
      const v = vacationRequests.find((x) => x.id === id);
      if (v && selEmpleado === String(v.employee_id)) {
        try {
          const y = new Date().getFullYear();
          const rb = await fetchEmployeeVacationBalance(v.employee_id, y);
          setHrVacBalance(rb.data);
          setHrVacBalanceError(null);
        } catch {
          /* opcional */
        }
      }
    } catch (err) {
      const msg = err instanceof ApiHttpError ? err.apiError?.message ?? err.message : "No se pudo actualizar el estado";
      toast({ title: "Error", description: typeof msg === "string" ? msg : "Intenta de nuevo", variant: "destructive" });
    } finally {
      setStatusUpdatingId(null);
    }
  };

  const openVacationCorrection = (v: VacationRequest) => {
    setVacationCorrectionRow(v);
    setVacationCorrectionStatus("");
  };

  const confirmVacationCorrection = async () => {
    if (!vacationCorrectionRow || vacationCorrectionStatus === "") return;
    if (vacationCorrectionStatus === vacationCorrectionRow.status) {
      toast({ title: "Sin cambios", description: "Elige un estado distinto al actual.", variant: "destructive" });
      return;
    }
    const row = vacationCorrectionRow;
    setVacationCorrectionSaving(true);
    setStatusUpdatingId(row.id);
    try {
      await patchVacationRequestStatus(row.id, { status: vacationCorrectionStatus });
      toast({
        title: "Estado actualizado",
        description: "Se aplicó la corrección; el colaborador recibirá notificación en el portal (y correo si aplica).",
      });
      setVacationCorrectionRow(null);
      setVacationCorrectionStatus("");
      await loadVacationData();
      if (selEmpleado === String(row.employee_id)) {
        try {
          const y = new Date().getFullYear();
          const rb = await fetchEmployeeVacationBalance(row.employee_id, y);
          setHrVacBalance(rb.data);
          setHrVacBalanceError(null);
        } catch {
          /* opcional */
        }
      }
    } catch (err) {
      const msg = err instanceof ApiHttpError ? err.apiError?.message ?? err.message : "No se pudo actualizar el estado";
      toast({ title: "Error", description: typeof msg === "string" ? msg : "Intenta de nuevo", variant: "destructive" });
    } finally {
      setVacationCorrectionSaving(false);
      setStatusUpdatingId(null);
    }
  };

  const buildAttendanceExportQuery = (): URLSearchParams | null => {
    const y = parseInt(selectedYear, 10);
    const m = parseInt(selectedMonth, 10);
    if (Number.isNaN(y) || Number.isNaN(m)) return null;
    const from = format(new Date(y, m, 1), "yyyy-MM-dd");
    const to = format(new Date(y, m + 1, 0), "yyyy-MM-dd");
    const q = new URLSearchParams();
    q.set("from", from);
    q.set("to", to);
    if (selectedEmpleado !== "all") {
      const empId = Number(selectedEmpleado);
      if (!Number.isNaN(empId)) {
        q.set("employee_id", String(empId));
      }
    }
    return q;
  };

  const handleExportAttendanceCsv = async () => {
    if (!canExportAttendance || exportingAttendanceCsv) return;
    const q = buildAttendanceExportQuery();
    if (!q) {
      toast({ title: "Error", description: "Año o mes no válidos.", variant: "destructive" });
      return;
    }
    setExportingAttendanceCsv(true);
    try {
      await downloadReportCsv(`reports/exports/attendance.csv?${q.toString()}`);
      const from = q.get("from") ?? "";
      const to = q.get("to") ?? "";
      toast({
        title: "Archivo CSV descargado",
        description: `Rango: ${formatAppDate(from)} — ${formatAppDate(to)}`,
      });
    } catch (err) {
      const msg =
        err instanceof ApiHttpError ? err.apiError?.message ?? err.message : "No se pudo exportar";
      toast({ title: "Error al exportar", description: typeof msg === "string" ? msg : "Intenta de nuevo", variant: "destructive" });
    } finally {
      setExportingAttendanceCsv(false);
    }
  };

  const handleExportAttendanceXlsx = async () => {
    if (!canExportAttendance || exportingAttendanceXlsx) return;
    const q = buildAttendanceExportQuery();
    if (!q) {
      toast({ title: "Error", description: "Año o mes no válidos.", variant: "destructive" });
      return;
    }
    setExportingAttendanceXlsx(true);
    try {
      await downloadReportXlsx(`reports/exports/attendance.xlsx?${q.toString()}`);
      const from = q.get("from") ?? "";
      const to = q.get("to") ?? "";
      toast({
        title: "Excel descargado",
        description: `Rango: ${formatAppDate(from)} — ${formatAppDate(to)}`,
      });
    } catch (err) {
      const msg =
        err instanceof ApiHttpError ? err.apiError?.message ?? err.message : "No se pudo exportar";
      toast({ title: "Error al exportar", description: typeof msg === "string" ? msg : "Intenta de nuevo", variant: "destructive" });
    } finally {
      setExportingAttendanceXlsx(false);
    }
  };

  const handleExportAttendancePdf = async () => {
    if (!canExportAttendance || exportingAttendancePdf) return;
    const q = buildAttendanceExportQuery();
    if (!q) {
      toast({ title: "Error", description: "Año o mes no válidos.", variant: "destructive" });
      return;
    }
    setExportingAttendancePdf(true);
    try {
      await downloadReportPdf(`reports/exports/attendance.pdf?${q.toString()}`);
      const from = q.get("from") ?? "";
      const to = q.get("to") ?? "";
      toast({
        title: "PDF descargado",
        description: `Rango: ${formatAppDate(from)} — ${formatAppDate(to)}`,
      });
    } catch (err) {
      const msg =
        err instanceof ApiHttpError ? err.apiError?.message ?? err.message : "No se pudo exportar";
      toast({ title: "Error al exportar", description: typeof msg === "string" ? msg : "Intenta de nuevo", variant: "destructive" });
    } finally {
      setExportingAttendancePdf(false);
    }
  };

  const attendanceExportBusy =
    exportingAttendanceCsv || exportingAttendanceXlsx || exportingAttendancePdf;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Control de Asistencia</h1>
          <p className="text-muted-foreground text-sm mt-1">Registro y gestión de asistencia del personal</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            type="button"
            disabled={!canExportAttendance || attendanceExportBusy}
            title={
              canExportAttendance
                ? "Descargar CSV del mes (datos en bruto). Respeta el colaborador del filtro; con Todos exporta todo el alcance permitido."
                : "Requiere permisos: exportar reportes y ver asistencia."
            }
            onClick={() => void handleExportAttendanceCsv()}
          >
            <Download className="w-4 h-4" />
            {exportingAttendanceCsv ? "Exportando…" : "CSV"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            type="button"
            disabled={!canExportAttendance || attendanceExportBusy}
            title={
              canExportAttendance
                ? "Descargar Excel del mes con formato RRHH. Mismo filtro de colaborador y rango que el CSV."
                : "Requiere permisos: exportar reportes y ver asistencia."
            }
            onClick={() => void handleExportAttendanceXlsx()}
          >
            <FileSpreadsheet className="w-4 h-4" />
            {exportingAttendanceXlsx ? "Exportando…" : "Excel"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            type="button"
            disabled={!canExportAttendance || attendanceExportBusy}
            title={
              canExportAttendance
                ? "Descargar PDF del mes (misma tabla que Excel). Respeta el filtro de colaborador y el rango del mes."
                : "Requiere permisos: exportar reportes y ver asistencia."
            }
            onClick={() => void handleExportAttendancePdf()}
          >
            <FileText className="w-4 h-4" />
            {exportingAttendancePdf ? "Exportando…" : "PDF"}
          </Button>
        </div>
      </div>

      <Tabs value={mainTab} onValueChange={setMainTab}>
        <TabsList className="bg-card border border-border flex-wrap h-auto gap-1 py-1">
          <TabsTrigger value="calendario" className="gap-2">
            <CalendarDays className="w-4 h-4 shrink-0" />
            Calendario
          </TabsTrigger>
          <TabsTrigger value="vacaciones" className="gap-2">
            <Palmtree className="w-4 h-4 shrink-0" />
            Vacaciones
          </TabsTrigger>
        </TabsList>

        <TabsContent value="calendario" className="space-y-4 mt-4">
          <Card className="shadow-card">
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <CardTitle className="text-base">Asistencia Mensual</CardTitle>
                <div className="flex flex-wrap gap-2 items-center">
                  {canManageAttendance && selectedEmpleado !== "all" ? (
                    <Button
                      size="sm"
                      variant="default"
                      type="button"
                      className="shrink-0 font-semibold shadow-sm"
                      title="Registro manual de asistencia para el colaborador seleccionado"
                      onClick={() => openAttendanceCreate()}
                    >
                      Registrar asistencia
                    </Button>
                  ) : null}
                  <Select value={selectedEmpleado} onValueChange={setSelectedEmpleado}>
                    <SelectTrigger className="w-44"><SelectValue placeholder="Colaborador" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      {vacationEmployees.map((e) => (
                        <SelectItem key={e.id} value={String(e.id)}>
                          {e.displayName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={selectedYear} onValueChange={handleYearChange}>
                    <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {years.map(y => (
                        <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={selectedMonth} onValueChange={handleMonthChange}>
                    <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {meses.map((m, i) => (
                        <SelectItem key={i} value={String(i)}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {selectedEmpleado === "all" ? (
                <p className="text-sm text-muted-foreground mb-3">
                  {canManageAttendance ? (
                    <>
                      Elige un colaborador en el filtro para ver el calendario con datos y usar el{" "}
                      <span className="font-medium text-foreground">registro manual</span> (botón{" "}
                      <span className="font-medium text-foreground">Registrar asistencia</span>, tabla o clic en un día).
                      Con <span className="font-medium text-foreground">Todos</span> no se puede registrar ni editar.
                    </>
                  ) : (
                    "Selecciona un colaborador para ver los registros de asistencia del mes."
                  )}
                </p>
              ) : null}
              {attendanceError ? (
                <div className="mb-3 space-y-2">
                  <p className="text-sm text-destructive">{attendanceError}</p>
                  <Button variant="outline" size="sm" type="button" onClick={() => void loadCalendarMonth()}>
                    Reintentar
                  </Button>
                </div>
              ) : null}
              {attendanceLoading && selectedEmpleado !== "all" ? (
                <p className="text-sm text-muted-foreground mb-3">Cargando asistencia…</p>
              ) : null}
              <div className="grid grid-cols-7 gap-1.5 mb-4">
                {["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"].map((d, i) => (
                  <div
                    key={d}
                    className={cn(
                      "text-xs font-semibold text-center py-1",
                      i === 0 || i === 6 ? "text-zinc-500 dark:text-zinc-400" : "text-muted-foreground",
                    )}
                  >
                    {d}
                  </div>
                ))}
                {Array.from({ length: firstDayOffset }).map((_, i) => (
                  <div key={`b-${i}`} />
                ))}
                {daysInMonth.map((d) => {
                  const y = parseInt(selectedYear, 10);
                  const mo = parseInt(selectedMonth, 10);
                  const isWeekendCell = !Number.isNaN(y) && !Number.isNaN(mo) && isWeekendYmd(y, mo, d.day);
                  const empty = d.status === "__none__";
                  const cls = statusColorMap[d.status] ?? "bg-muted";
                  const cellClass = cn(
                    "aspect-square rounded-md flex items-center justify-center text-xs font-medium min-w-0 w-full",
                    isWeekendCell
                      ? "bg-zinc-600 text-zinc-100 dark:bg-zinc-800 dark:text-zinc-200"
                      : cls,
                    !isWeekendCell && (empty ? "text-muted-foreground" : "text-primary-foreground"),
                  );
                  const interactive =
                    canManageAttendance &&
                    !(selectedEmpleado !== "all" && attendanceLoading) &&
                    !isWeekendCell;
                  if (!canManageAttendance || isWeekendCell) {
                    return (
                      <div
                        key={d.day}
                        className={cn(cellClass, isWeekendCell && "pointer-events-none select-none")}
                        title={isWeekendCell ? "Día no laborable (fin de semana)" : undefined}
                      >
                        {d.day}
                      </div>
                    );
                  }
                  return (
                    <button
                      key={d.day}
                      type="button"
                      disabled={!interactive}
                      title={
                        selectedEmpleado === "all"
                          ? "Elige un colaborador para registrar o editar este día"
                          : empty
                            ? "Registrar asistencia para este día"
                            : "Editar asistencia de este día"
                      }
                      className={cn(
                        cellClass,
                        interactive &&
                          "cursor-pointer hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                        !interactive && "cursor-wait",
                      )}
                      onClick={() => handleCalendarDayClick(d.day)}
                    >
                      {d.day}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-3 text-xs">
                {ATTENDANCE_STATUS_OPTIONS.map((o) => (
                  <span key={o.value} className="flex items-center gap-1.5">
                    <span className={cn("w-3 h-3 rounded shrink-0", statusColorMap[o.value] ?? "bg-muted")} />
                    {o.label}
                  </span>
                ))}
              </div>
              {canManageAttendance && selectedEmpleado !== "all" && !attendanceLoading && !attendanceError ? (
                <p className="text-xs text-muted-foreground mt-2">
                  Clic en un día laborable: crear si está vacío o editar si ya hay registro. Sábado y domingo son días no
                  laborables (sin registro de asistencia).
                </p>
              ) : null}
              {selectedEmpleado !== "all" && !attendanceLoading && !attendanceError ? (
                <div className="mt-6 border-t border-border pt-4 space-y-3">
                  <p className="text-sm font-medium">Registros del mes</p>
                  {monthAttendanceRecords.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No hay registros de asistencia en este mes.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm min-w-[640px]">
                        <thead>
                          <tr className="border-b border-border bg-muted/50">
                            <th className="text-left text-xs font-semibold text-muted-foreground px-3 py-2">Fecha</th>
                            <th className="text-left text-xs font-semibold text-muted-foreground px-3 py-2">Estado</th>
                            <th className="text-left text-xs font-semibold text-muted-foreground px-3 py-2">Entrada</th>
                            <th className="text-left text-xs font-semibold text-muted-foreground px-3 py-2">Salida</th>
                            <th className="text-left text-xs font-semibold text-muted-foreground px-3 py-2">Horas</th>
                            <th className="text-left text-xs font-semibold text-muted-foreground px-3 py-2">Justificación</th>
                            <th className="text-left text-xs font-semibold text-muted-foreground px-3 py-2">Adj.</th>
                            <th className="text-left text-xs font-semibold text-muted-foreground px-3 py-2"> </th>
                          </tr>
                        </thead>
                        <tbody>
                          {monthAttendanceRecords.map((r) => (
                            <tr key={r.id} className="border-b border-border last:border-0">
                              <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                                {formatAppDate(r.record_date)}
                              </td>
                              <td className="px-3 py-2">{labelAttendanceStatus(r.status)}</td>
                              <td className="px-3 py-2 tabular-nums">{r.check_in ?? "—"}</td>
                              <td className="px-3 py-2 tabular-nums">{r.check_out ?? "—"}</td>
                              <td className="px-3 py-2 tabular-nums">
                                {formatDecimalHoursAsDuration(r.hours_worked)}
                              </td>
                              <td className="px-3 py-2 max-w-[180px] truncate" title={r.justification ?? ""}>
                                {r.justification ? r.justification : "—"}
                              </td>
                              <td className="px-3 py-2">
                                {r.has_justification_file ? (
                                  <Button
                                    type="button"
                                    variant="link"
                                    size="sm"
                                    className="h-auto p-0 text-xs"
                                    onClick={() => void handleDownloadJustification(r.id)}
                                  >
                                    Descargar
                                  </Button>
                                ) : (
                                  "—"
                                )}
                              </td>
                              <td className="px-3 py-2">
                                {canManageAttendance ? (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="text-xs h-7 text-primary"
                                    onClick={() => openAttendanceEdit(r)}
                                  >
                                    Editar
                                  </Button>
                                ) : null}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="vacaciones" className="space-y-4 mt-4">
          <Card className="shadow-card">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Solicitudes de Vacaciones</CardTitle>
              {canManageVacationRequests ? (
                <Button size="sm" className="gap-1.5" type="button" onClick={() => setShowNuevaSolicitud(true)}>
                  <CalendarCheck className="w-4 h-4" />
                  Nueva Solicitud
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full">
                <thead><tr className="border-b border-border bg-muted/50">
                  <th className="text-left text-xs font-semibold text-muted-foreground px-5 py-3">Colaborador</th>
                  <th className="text-left text-xs font-semibold text-muted-foreground px-5 py-3">Fechas</th>
                  <th className="text-left text-xs font-semibold text-muted-foreground px-5 py-3">Días</th>
                  <th className="text-left text-xs font-semibold text-muted-foreground px-5 py-3">Estado</th>
                  <th className="text-left text-xs font-semibold text-muted-foreground px-5 py-3">Acciones</th>
                </tr></thead>
                <tbody>
                  {vacationLoading ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-12 text-sm text-muted-foreground text-center">
                        Cargando solicitudes…
                      </td>
                    </tr>
                  ) : vacationError ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-12 text-center">
                        <p className="text-sm text-destructive mb-2">{vacationError}</p>
                        <Button variant="outline" size="sm" type="button" onClick={() => void loadVacationData()}>
                          Reintentar
                        </Button>
                      </td>
                    </tr>
                  ) : vacationRequests.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-12 text-sm text-muted-foreground text-center">
                        No hay solicitudes de vacaciones registradas.
                      </td>
                    </tr>
                  ) : (
                    vacationRequests.map((v) => {
                      const nombre =
                        vacationEmployees.find((e) => e.id === v.employee_id)?.displayName ?? `#${v.employee_id}`;
                      const st = v.status;
                      const badgeVariant =
                        st === "aprobado" ? "default" : st === "rechazado" ? "destructive" : "secondary";
                      const pending = st === "pendiente";
                      const busy = statusUpdatingId === v.id;
                      const showApprove = pending && canApproveVacationRequests;
                      const showVacationCorrect = !pending && canApproveVacationRequests;
                      return (
                        <tr key={v.id} className="border-b border-border last:border-0">
                          <td className="px-5 py-3 text-sm font-medium">{nombre}</td>
                          <td className="px-5 py-3 text-sm">{displayVacationRange(v.start_date, v.end_date)}</td>
                          <td className="px-5 py-3 text-sm">{v.days}</td>
                          <td className="px-5 py-3">
                            <Badge variant={badgeVariant} className="text-xs">
                              {vacationStatusLabel[st]}
                            </Badge>
                          </td>
                          <td className="px-5 py-3">
                            {showApprove ? (
                              <div className="flex gap-1 flex-wrap">
                                <Button
                                  size="sm"
                                  variant="default"
                                  className="text-xs h-7"
                                  type="button"
                                  disabled={statusUpdatingId !== null}
                                  onClick={() => void handleVacationStatusChange(v.id, "aprobado")}
                                >
                                  {busy ? "…" : "Aprobar"}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-xs h-7"
                                  type="button"
                                  disabled={statusUpdatingId !== null}
                                  onClick={() => void handleVacationStatusChange(v.id, "rechazado")}
                                >
                                  {busy ? "…" : "Rechazar"}
                                </Button>
                              </div>
                            ) : showVacationCorrect ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-xs h-7 gap-1"
                                type="button"
                                title="Corregir estado"
                                disabled={statusUpdatingId !== null}
                                onClick={() => openVacationCorrection(v)}
                              >
                                <Pencil className="w-3 h-3 shrink-0" />
                                {busy ? "…" : "Corregir"}
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </CardContent>
            {!vacationLoading && !vacationError ? (
              <ListPaginationBar
                page={vacationMeta.current_page}
                lastPage={vacationMeta.last_page}
                total={vacationMeta.total}
                pageSize={vacationMeta.per_page}
                onPageChange={setVacationPage}
              />
            ) : null}
          </Card>
        </TabsContent>
      </Tabs>

      {/* Dialog Nueva Solicitud de Vacaciones */}
      <Dialog
        open={showNuevaSolicitud}
        onOpenChange={(open) => {
          setShowNuevaSolicitud(open);
          if (!open) {
            setSelEmpleado("");
            setFechaInicio(undefined);
            setFechaFin(undefined);
            setMotivo("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nueva Solicitud de Vacaciones</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Colaborador</Label>
              <Select value={selEmpleado} onValueChange={setSelEmpleado}>
                <SelectTrigger><SelectValue placeholder="Seleccionar colaborador" /></SelectTrigger>
                <SelectContent>
                  {vacationEmployees.map((e) => (
                    <SelectItem key={e.id} value={String(e.id)}>
                      {e.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selEmpleado ? (
              <div className="rounded-md border border-border bg-muted/30 p-3 text-xs space-y-1">
                {hrVacBalanceLoading ? (
                  <p className="text-muted-foreground">Cargando saldo…</p>
                ) : hrVacBalanceError ? (
                  <p className="text-destructive">{hrVacBalanceError}</p>
                ) : hrVacBalance ? (
                  <>
                    <p className="font-medium text-foreground">Saldo {hrVacBalance.year} (colaborador seleccionado)</p>
                    <p className="text-muted-foreground">
                      Tope anual: {hrVacBalance.annual_days} · Usados: {hrVacBalance.days_used} · Pendientes:{" "}
                      {hrVacBalance.days_pending} · Disponibles: {hrVacBalance.days_available}
                    </p>
                  </>
                ) : null}
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Fecha de inicio</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !fechaInicio && "text-muted-foreground")}>
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {fechaInicio ? formatAppDate(fechaInicio) : "Seleccionar"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="z-[100] w-auto p-0"
                    align="start"
                    side="bottom"
                    sideOffset={6}
                    collisionPadding={16}
                    onOpenAutoFocus={(e) => e.preventDefault()}
                  >
                    <Calendar mode="single" selected={fechaInicio} onSelect={setFechaInicio} initialFocus className="pointer-events-auto" />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-2">
                <Label>Fecha de fin</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !fechaFin && "text-muted-foreground")}>
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {fechaFin ? formatAppDate(fechaFin) : "Seleccionar"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="z-[100] w-auto p-0"
                    align="start"
                    side="bottom"
                    sideOffset={6}
                    collisionPadding={16}
                    onOpenAutoFocus={(e) => e.preventDefault()}
                  >
                    <Calendar mode="single" selected={fechaFin} onSelect={setFechaFin} disabled={(date) => fechaInicio ? date < fechaInicio : false} initialFocus className="pointer-events-auto" />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
            {diasCalculados > 0 && (
              <p className="text-sm text-muted-foreground">Días solicitados: <span className="font-semibold text-foreground">{diasCalculados}</span></p>
            )}
            <div className="space-y-2">
              <Label>Motivo / Observaciones</Label>
              <Textarea placeholder="Escribe el motivo de la solicitud..." value={motivo} onChange={(e) => setMotivo(e.target.value)} />
              <p className="text-xs text-muted-foreground">
                El backend aún no guarda este texto; solo se registran fechas, días y colaborador.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setShowNuevaSolicitud(false)} disabled={creatingVacation}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void handleGuardar()} disabled={creatingVacation}>
              {creatingVacation ? "Enviando…" : "Enviar Solicitud"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={vacationCorrectionRow !== null}
        onOpenChange={(open) => {
          if (!open && !vacationCorrectionSaving) {
            setVacationCorrectionRow(null);
            setVacationCorrectionStatus("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Corregir estado de vacaciones</DialogTitle>
          </DialogHeader>
          {vacationCorrectionRow ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Estado actual:{" "}
                <span className="font-medium text-foreground">{vacationStatusLabel[vacationCorrectionRow.status]}</span>.
                El colaborador será notificado al guardar.
              </p>
              <div className="space-y-1.5">
                <span className="text-sm font-medium">Nuevo estado</span>
                <Select
                  value={vacationCorrectionStatus === "" ? undefined : vacationCorrectionStatus}
                  onValueChange={(val) => setVacationCorrectionStatus(val as VacationStatus)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona…" />
                  </SelectTrigger>
                  <SelectContent>
                    {vacationCorrectionRow.status !== "pendiente" ? (
                      <SelectItem value="pendiente">Pendiente (reabrir)</SelectItem>
                    ) : null}
                    {vacationCorrectionRow.status !== "aprobado" ? (
                      <SelectItem value="aprobado">Aprobado</SelectItem>
                    ) : null}
                    {vacationCorrectionRow.status !== "rechazado" ? (
                      <SelectItem value="rechazado">Rechazado</SelectItem>
                    ) : null}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              disabled={vacationCorrectionSaving}
              onClick={() => {
                setVacationCorrectionRow(null);
                setVacationCorrectionStatus("");
              }}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={vacationCorrectionSaving || vacationCorrectionStatus === ""}
              onClick={() => void confirmVacationCorrection()}
            >
              {vacationCorrectionSaving ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={attendanceDialogOpen}
        onOpenChange={(open) => {
          setAttendanceDialogOpen(open);
          if (!open) resetAttendanceForm();
        }}
      >
        <DialogContent className="flex max-h-[min(90vh,40rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
          <div className="shrink-0 px-6 pb-2 pt-6 pr-12">
            <DialogHeader>
              <DialogTitle>{attendanceMode === "create" ? "Registrar asistencia" : "Editar asistencia"}</DialogTitle>
            </DialogHeader>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-2">
            <div className="space-y-4">
              <div className="space-y-1">
                <Label className="text-muted-foreground" htmlFor={isAttendanceDateEditable ? "att-date" : undefined}>
                  Fecha del registro
                </Label>
                {isAttendanceDateEditable ? (
                  <>
                    <Input
                      id="att-date"
                      type="date"
                      value={attendanceDate}
                      onChange={(e) => setAttendanceDate(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">Elige la fecha del registro que vas a cargar.</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium tabular-nums">{formatAttendanceDateLabel(attendanceDate)}</p>
                    <p className="text-xs text-muted-foreground">
                      {attendanceMode === "edit"
                        ? "La fecha del registro no se puede cambiar aquí."
                        : "La fecha corresponde al día elegido en el calendario; no se puede cambiar aquí."}
                    </p>
                  </>
                )}
              </div>
              {attendanceDateIsWeekend ? (
                <Alert className="border-amber-500/40 bg-amber-50 dark:bg-amber-950/25">
                  <AlertTitle className="text-amber-900 dark:text-amber-100">Día no laborable</AlertTitle>
                  <AlertDescription className="text-amber-900/90 dark:text-amber-100/90">
                    Sábado y domingo no son días laborables. No se puede registrar ni guardar asistencia normal en fines
                    de semana. Si la fecha es correcta, elige un día entre lunes y viernes.
                  </AlertDescription>
                </Alert>
              ) : null}
              <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="att-in">Entrada</Label>
                <Input
                  id="att-in"
                  type="time"
                  value={attendanceCheckIn}
                  disabled={attendanceDateIsWeekend}
                  onChange={(e) => handleAttendanceCheckInChange(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="att-out">Salida</Label>
                <Input
                  id="att-out"
                  type="time"
                  value={attendanceCheckOut}
                  disabled={attendanceDateIsWeekend}
                  onChange={(e) => handleAttendanceCheckOutChange(e.target.value)}
                />
              </div>
            </div>
            {!attendanceDateIsWeekend && attendanceFormUi.partialTimeInvalid ? (
              <Alert className="border-amber-500/40 bg-amber-50 dark:bg-amber-950/25">
                <AlertTitle className="text-amber-900 dark:text-amber-100">Horario incompleto</AlertTitle>
                <AlertDescription className="text-amber-900/90 dark:text-amber-100/90">
                  Usa <span className="font-medium">hora completa (HH:MM)</span> en ambos campos, o{" "}
                  <span className="font-medium">sin hora en ambos</span> (vacío o <span className="font-medium">--:--</span>
                  ). Cualquier mezcla con guiones a medias (p. ej. 09:--, --:00) o solo una hora informada no es válida.
                </AlertDescription>
              </Alert>
            ) : null}
            <div className="space-y-1.5">
              <Label>Estado</Label>
              <Select
                value={attendanceStatus}
                disabled={attendanceFormUi.statusDisabled || attendanceDateIsWeekend}
                onValueChange={(v) => setAttendanceStatus(v as AttendanceStatus)}
              >
                <SelectTrigger className={attendanceFormUi.statusDisabled || attendanceDateIsWeekend ? "opacity-80" : undefined}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ATTENDANCE_STATUS_OPTIONS.filter((o) => attendanceFormUi.allowedStatuses.includes(o.value)).map(
                    (o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {attendanceDateIsWeekend
                  ? "Los fines de semana no admiten registro de asistencia."
                  : attendanceFormUi.partialTimeInvalid
                    ? "Completa ambas horas (HH:MM) o deja ambos sin hora (vacío o --:--); no mezcles hora completa con vacío ni uses horas parciales."
                    : attendanceFormUi.statusDisabled
                      ? "Estado fijado automáticamente según las horas; justificación y adjunto no aplican en este caso."
                      : attendanceFormUi.allowedStatuses.length < ALL_ATTENDANCE_STATUSES.length
                        ? "Solo se muestran estados permitidos para esta combinación de horas."
                        : "Horas incompletas: puedes ajustar estado y justificación manualmente."}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="att-just" className={attendanceFormUi.justificationDisabled || attendanceDateIsWeekend ? "text-muted-foreground" : undefined}>
                Justificación (texto)
              </Label>
              <Textarea
                id="att-just"
                rows={3}
                disabled={attendanceFormUi.justificationDisabled || attendanceDateIsWeekend}
                value={attendanceJustification}
                onChange={(e) => setAttendanceJustification(e.target.value)}
                placeholder="Opcional; si aplica justificación, puedes elegir Tard./Salida just. o Falta justificada."
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="att-file" className={attendanceFormUi.fileDisabled || attendanceDateIsWeekend ? "text-muted-foreground" : undefined}>
                Adjunto (PDF o imagen)
              </Label>
              <Input
                id="att-file"
                type="file"
                disabled={attendanceFormUi.fileDisabled || attendanceDateIsWeekend}
                accept=".pdf,image/jpeg,image/png,image/webp"
                onChange={(e) => setAttendanceFile(e.target.files?.[0] ?? null)}
              />
              <p className="text-xs text-muted-foreground">Máx. 5 MB. Se sube al guardar.</p>
            </div>
            </div>
          </div>
          <div className="shrink-0 border-t border-border bg-background px-6 py-4">
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" type="button" onClick={() => setAttendanceDialogOpen(false)} disabled={attendanceSaving}>
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={() => void handleSaveAttendance()}
                disabled={
                  attendanceSaving || attendanceDateIsWeekend || attendanceFormUi.partialTimeInvalid
                }
              >
                {attendanceSaving ? "Guardando…" : "Guardar"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
