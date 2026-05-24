import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ListPaginationBar } from "@/components/ListPaginationBar";
import { PendingPdfFileInput } from "@/components/PendingPdfFileInput";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { ApiHttpError } from "@/api/client";
import type { VacationRequest } from "@/api/vacationRequests";
import type { AttendanceRecord } from "@/api/attendance";
import { filterWeekdayAttendanceRecords, isWeekendYmd, recordDateToIsoDay } from "@/lib/weekendAttendance";
import { buildMonthCalendarDaysWithVacations } from "@/lib/attendanceCalendarVacations";
import {
  createPortalVacationRequest,
  createPortalResignationRequest,
  deletePortalResignationRequest,
  deletePortalVacationRequest,
  patchPortalResignationRequest,
  patchPortalVacationRequest,
  downloadPortalAssetLoanActBlob,
  downloadPortalAttendanceJustificationBlob,
  downloadPortalPayslipPdfBlob,
  downloadPortalResignationLetterBlob,
  fetchAllPortalAttendanceInRange,
  fetchAllApprovedPortalVacations,
  patchPortalAttendanceJustification,
  uploadPortalAttendanceJustificationFile,
  fetchPortalAssetsPage,
  downloadPortalEmployeeDocumentBlob,
  fetchPortalContact,
  fetchPortalDocuments,
  fetchPortalPayslipsPage,
  fetchPortalResignationRequestsPage,
  fetchPortalVacationRequestsPage,
  fetchPortalVacationBalance,
  fetchPortalNotificationsPage,
  fetchPortalEmployeePhotoBlob,
  fetchPortalEmployeeSignatureBlob,
  patchPortalNotificationRead,
  postPortalNotificationsReadAll,
  patchPortalContact,
  deletePortalEmployeeSignature,
  uploadPortalEmployeeSignature,
  type PortalContact,
  type PortalEmployeeDocumentRow,
  type PortalPersonalSnapshot,
  type PortalWorkSnapshot,
  type PortalPayslip,
  type PortalEmployeeNotification,
  type PortalAsset,
  type PortalResignationRequest,
  type VacationBalanceData,
} from "@/api/portal";
import { updateEmployee } from "@/api/employees";
import { deleteEmployeeDocument, uploadEmployeeDocument, type EmployeeDocumentType } from "@/api/employeeDocuments";
import { EmployeeDocumentActionBar } from "@/components/EmployeeDocumentActionBar";
import { DEFAULT_LIST_PAGE_SIZE } from "@/constants/pagination";
import {
  FileText,
  Calendar as CalendarIcon,
  Bell,
  User,
  NotebookPen,
  Laptop,
  Download,
  Pencil,
  Trash2,
  Upload,
  Info,
} from "lucide-react";
import { addDays, format, differenceInCalendarDays, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { formatDecimalHoursAsDuration } from "@/lib/formatWorkedDuration";
import { formatEmployeeModalityDisplay } from "@/lib/employeeModalityCatalog";
import { formatAppDate, formatAppDateTime, formatAppMonthYear } from "@/lib/formatAppDate";
import { displayEmployeeDni, editableEmployeeDni } from "@/lib/employeeDniDisplay";
import { confirmReplaceEmployeeDocument } from "@/lib/employeeDocumentUi";

function formatPen(amount: string): string {
  const n = Number(amount);
  if (Number.isNaN(n)) return amount;
  return new Intl.NumberFormat("es-PE", { style: "currency", currency: "PEN" }).format(n);
}

function portalFieldDisplay(v: string | null | undefined): string {
  const t = (v ?? "").trim();
  return t === "" ? "—" : t;
}

function portalEmployeeStatusLabel(s: string): string {
  const m: Record<string, string> = {
    activo: "Activo",
    suspendido: "Suspendido",
    cesado: "Cesado",
    vacaciones: "En vacaciones",
  };
  return m[s] ?? s;
}

const portalReadonlyFieldClass = "bg-muted pointer-events-none select-none";

function portalManagerLabel(name: string | null | undefined): string {
  const t = (name ?? "").trim();
  return t === "" ? "Sin jefe asignado" : t;
}

const portalPersonalPdfSlots = [
  { type: "dni_scan" as const, label: "Escaneo de DNI (PDF)" },
  { type: "cv" as const, label: "CV (PDF)" },
  { type: "antecedentes" as const, label: "Antecedentes policiales (PDF)" },
  { type: "medical_exam" as const, label: "Examen Médico Ocupacional (PDF)" },
];

function portalLatestDocByType(rows: PortalEmployeeDocumentRow[]): Map<string, PortalEmployeeDocumentRow> {
  const m = new Map<string, PortalEmployeeDocumentRow>();
  for (const d of rows) {
    if (!m.has(d.type)) m.set(d.type, d);
  }
  return m;
}

function payslipPeriodLabel(row: PortalPayslip): string {
  if (row.payroll_period) {
    return formatAppMonthYear(row.payroll_period.month, row.payroll_period.year);
  }
  return `Periodo #${row.payroll_period_id}`;
}

function vacationStatusBadgeVariant(
  s: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (s === "aprobado") return "default";
  if (s === "rechazado") return "destructive";
  return "secondary";
}

function vacationStatusLabel(s: string): string {
  const m: Record<string, string> = {
    pendiente: "Pendiente",
    aprobado: "Aprobado",
    rechazado: "Rechazado",
  };
  return m[s] ?? s;
}

function payslipStatusLabel(s: string): string {
  if (!s) return "—";
  const m: Record<string, string> = { aprobada: "Aprobada", pendiente: "Pendiente" };
  return m[s] ?? s.charAt(0).toUpperCase() + s.slice(1);
}

function resignationStatusBadgeVariant(
  s: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (s === "aprobada") return "default";
  if (s === "rechazada") return "destructive";
  return "secondary";
}

function resignationStatusLabel(s: string): string {
  const m: Record<string, string> = {
    pendiente: "Pendiente",
    aprobada: "Aprobada",
    rechazada: "Rechazada",
  };
  return m[s] ?? s;
}

const PORTAL_ATT_STATUS: Record<string, string> = {
  asistido: "Asistido",
  recuperacion: "Recuperación",
  tardanza_j: "Tardanza justif.",
  tardanza_nj: "Tardanza",
  falta_j: "Falta justif.",
  falta_nj: "Falta",
  vacaciones: "Vacaciones",
};

function portalAttendanceStatusLabel(s: string): string {
  return PORTAL_ATT_STATUS[s] ?? s;
}

function portalCanJustifyStatus(s: string): boolean {
  return s === "tardanza_nj" || s === "falta_nj" || s === "tardanza_j" || s === "falta_j";
}

const portalAssetEstadoVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  "En uso": "default",
  Asignado: "default",
  "En mantenimiento": "secondary",
  Devuelto: "outline",
  Disponible: "secondary",
};

function portalAssetDescription(a: PortalAsset): string {
  const d = a.description?.trim();
  if (d) return d;
  const parts = [a.brand, a.model].filter(Boolean);
  return parts.length ? parts.join(" ") : "—";
}

function formatPortalAssetAssignedDate(iso?: string | null): string {
  return formatAppDate(iso);
}

function requestErrorMessage(e: unknown): string {
  if (e instanceof ApiHttpError) {
    const m = e.apiError?.message;
    if (typeof m === "string" && m.trim()) return m;
  }
  return "Ocurrió un error al cargar los datos.";
}

function formatNotificationDate(iso: string | null): string {
  return formatAppDateTime(iso);
}

const portalBankCatalog = ["BCP", "BBVA", "Interbank", "Scotiabank", "BanBif", "Caja Arequipa"];
const portalPensionCatalog = ["AFP Integra", "AFP Prima", "AFP Profuturo", "AFP Habitat", "ONP"];
const portalEmployerContributionOptionCatalog = [
  { value: "__none__", label: "Ninguna" },
  { value: "essalud", label: "Essalud" },
  { value: "sis_microempresa", label: "SIS Microempresas" },
];
const portalEducationCatalog = ["Secundaria", "Técnico", "Universitario", "Postgrado"];
const portalDocumentTypes = [
  { value: "dni", label: "DNI" },
  { value: "ce", label: "Carné de extranjería" },
  { value: "passport", label: "Pasaporte" },
];

type PortalSelfPdfKey = Extract<EmployeeDocumentType, "dni_scan" | "antecedentes" | "cv" | "medical_exam">;

function emptyPortalSelfPdfFiles(): Record<PortalSelfPdfKey, File | null> {
  return { dni_scan: null, cv: null, antecedentes: null, medical_exam: null };
}

const PORTAL_TAB_VALUES = new Set(["boletas", "asistencia", "solicitudes", "equipos", "datos", "notificaciones"]);

type PortalAttendanceRow = AttendanceRecord & {
  check_in?: string | null;
  check_out?: string | null;
  hours_worked?: number | null;
  justification?: string | null;
  has_justification_file?: boolean;
};

const portalCalendarStatusColors: Record<string, string> = {
  asistido: "bg-success",
  recuperacion: "bg-info",
  tardanza_j: "bg-success-dark",
  tardanza_nj: "bg-warning",
  falta_j: "bg-primary",
  falta_nj: "bg-destructive",
  vacaciones: "bg-purple",
  __none__: "bg-muted",
};

const portalCalMeses = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

const portalCalYears = Array.from({ length: 11 }, (_, i) => 2020 + i);

function portalCalMonthDayCount(year: number, monthIndex0: number): number {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

const portalCalFirstDayOffset = (year: number, monthIndex0: number) => new Date(year, monthIndex0, 1).getDay();

const portalCalLegend: { status: string; label: string }[] = [
  { status: "asistido", label: "Asistido" },
  { status: "recuperacion", label: "Recuperación" },
  { status: "tardanza_j", label: "Tard./Salida just." },
  { status: "tardanza_nj", label: "Tardanza" },
  { status: "falta_j", label: "Falta justificada" },
  { status: "falta_nj", label: "Falta" },
  { status: "vacaciones", label: "Vacaciones" },
];

const RESIGNATION_MIN_NOTICE_DAYS = 30;

function resignationProposedMinIso(): string {
  return format(addDays(new Date(), RESIGNATION_MIN_NOTICE_DAYS), "yyyy-MM-dd");
}

function isResignationProposedDateAllowed(isoYmd: string): boolean {
  const t = isoYmd.trim();
  if (!t) return true;
  return t >= resignationProposedMinIso();
}

function portalCatalogExtra(value: string, known: string[]) {
  if (!value || known.includes(value)) return null;
  return (
    <SelectItem key={`__custom_${value}`} value={value}>
      {value}
    </SelectItem>
  );
}

export default function EmployeePortalPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  const { user, hasPermission } = useAuth();
  const hasEmployee = Boolean(user?.employee);
  const selfEmployeeId = user?.employee?.id ?? null;
  const canSelfEditPersonalInPortal = Boolean(
    hasEmployee &&
      selfEmployeeId != null &&
      (hasPermission("employees.self_edit") ||
        (user?.impersonation?.active === true && hasPermission("employees.edit"))),
  );
  const canEditPortalDatos = hasEmployee;
  const isAdminRrhhRole = user?.rol === "superadmin_rrhh" || user?.rol === "admin_rrhh";
  const emptyStateNoEmployeeMessage =
    isAdminRrhhRole && !hasEmployee
      ? "Sin datos: este portal muestra información de la ficha de colaborador vinculada a tu usuario. Las cuentas administrativas no suelen tener ficha propia aquí."
      : "Sin datos hasta vincular tu ficha de colaborador.";
  const welcomeName = user?.nombre ?? "…";
  const hidePortalTabBar = user?.rol === "empleado";
  const isImpersonating = user?.impersonation?.active === true;

  const [activeTab, setActiveTab] = useState("datos");

  const tabFromUrl = searchParams.get("tab");
  useEffect(() => {
    if (tabFromUrl && PORTAL_TAB_VALUES.has(tabFromUrl)) {
      setActiveTab(tabFromUrl);
    } else {
      setActiveTab("datos");
    }
  }, [tabFromUrl]);

  const handlePortalTabChange = useCallback(
    (value: string) => {
      setActiveTab(value);
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (value === "datos") {
            p.delete("tab");
          } else {
            p.set("tab", value);
          }
          return p;
        },
        { replace: false },
      );
    },
    [setSearchParams],
  );

  const [payslipPage, setPayslipPage] = useState(1);
  const [payslips, setPayslips] = useState<PortalPayslip[]>([]);
  const [payslipMeta, setPayslipMeta] = useState({
    current_page: 1,
    last_page: 1,
    total: 0,
    per_page: DEFAULT_LIST_PAGE_SIZE,
  });
  const [payslipLoading, setPayslipLoading] = useState(false);
  const [payslipError, setPayslipError] = useState<string | null>(null);

  const [vacationPage, setVacationPage] = useState(1);
  const [vacations, setVacations] = useState<VacationRequest[]>([]);
  const [vacationMeta, setVacationMeta] = useState({
    current_page: 1,
    last_page: 1,
    total: 0,
    per_page: DEFAULT_LIST_PAGE_SIZE,
  });
  const [vacationLoading, setVacationLoading] = useState(false);
  const [vacationError, setVacationError] = useState<string | null>(null);

  const [resignationPage, setResignationPage] = useState(1);
  const [resignations, setResignations] = useState<PortalResignationRequest[]>([]);
  const [resignationMeta, setResignationMeta] = useState({
    current_page: 1,
    last_page: 1,
    total: 0,
    per_page: DEFAULT_LIST_PAGE_SIZE,
  });
  const [resignationLoading, setResignationLoading] = useState(false);
  const [resignationError, setResignationError] = useState<string | null>(null);
  const [proposedResignationDate, setProposedResignationDate] = useState("");
  const [resignationNotesText, setResignationNotesText] = useState("");
  const [submittingResignation, setSubmittingResignation] = useState(false);
  const resignationFileInputRef = useRef<HTMLInputElement>(null);
  const [resignationLetterDownloadingId, setResignationLetterDownloadingId] = useState<number | null>(null);

  const [vacationBalance, setVacationBalance] = useState<VacationBalanceData | null>(null);
  const [vacationBalanceLoading, setVacationBalanceLoading] = useState(false);
  const [vacationBalanceError, setVacationBalanceError] = useState<string | null>(null);

  const [attendanceRecords, setAttendanceRecords] = useState<PortalAttendanceRow[]>([]);
  const [portalApprovedVacations, setPortalApprovedVacations] = useState<VacationRequest[]>([]);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [attendanceError, setAttendanceError] = useState<string | null>(null);
  const [portalAttYear, setPortalAttYear] = useState(() => new Date().getFullYear());
  const [portalAttMonthIndex, setPortalAttMonthIndex] = useState(() => new Date().getMonth());
  const [portalAttDayOpen, setPortalAttDayOpen] = useState(false);
  const [portalAttDayRecord, setPortalAttDayRecord] = useState<PortalAttendanceRow | null>(null);
  const [portalAttDayStatus, setPortalAttDayStatus] = useState<string | null>(null);
  const [portalAttDayIso, setPortalAttDayIso] = useState<string | null>(null);
  const [portalJustificationDraft, setPortalJustificationDraft] = useState("");
  const [portalJustificationFile, setPortalJustificationFile] = useState<File | null>(null);
  const [portalJustificationSaving, setPortalJustificationSaving] = useState(false);
  const portalJustificationFileInputRef = useRef<HTMLInputElement>(null);

  const [showNuevaSolicitud, setShowNuevaSolicitud] = useState(false);
  const [editingVacationId, setEditingVacationId] = useState<number | null>(null);
  const [fechaInicio, setFechaInicio] = useState<Date | undefined>();
  const [fechaFin, setFechaFin] = useState<Date | undefined>();
  const [savingVacation, setSavingVacation] = useState(false);
  const [vacationToDeleteId, setVacationToDeleteId] = useState<number | null>(null);
  const [vacationDeleteLoading, setVacationDeleteLoading] = useState(false);

  const [resignationEditRow, setResignationEditRow] = useState<PortalResignationRequest | null>(null);
  const resignationEditFileRef = useRef<HTMLInputElement>(null);
  const [resignationEditDate, setResignationEditDate] = useState("");
  const [resignationEditNotes, setResignationEditNotes] = useState("");
  const [resignationEditSaving, setResignationEditSaving] = useState(false);
  const [resignationToDeleteId, setResignationToDeleteId] = useState<number | null>(null);
  const [resignationDeleteLoading, setResignationDeleteLoading] = useState(false);

  const [corporateEmail, setCorporateEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactPersonalEmail, setContactPersonalEmail] = useState("");
  const [contactAddress, setContactAddress] = useState("");
  const [contactEmergencyPhone, setContactEmergencyPhone] = useState("");
  const [bank, setBank] = useState("");
  const [bankAccount, setBankAccount] = useState("");
  const [bankAccountCci, setBankAccountCci] = useState("");
  const [pensionFund, setPensionFund] = useState("");
  const [employerContributionOption, setEmployerContributionOption] = useState("__none__");
  const [contactLoading, setContactLoading] = useState(false);
  const [contactSaving, setContactSaving] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);
  const [portalPersonal, setPortalPersonal] = useState<PortalPersonalSnapshot | null>(null);
  const [portalWork, setPortalWork] = useState<PortalWorkSnapshot | null>(null);
  const [hasEmployeePhotoFile, setHasEmployeePhotoFile] = useState(false);
  const [profilePhotoObjectUrl, setProfilePhotoObjectUrl] = useState<string | null>(null);
  const [hasEmployeeSignatureFile, setHasEmployeeSignatureFile] = useState(false);
  const [signatureObjectUrl, setSignatureObjectUrl] = useState<string | null>(null);
  const [pendingPortalSignatureFile, setPendingPortalSignatureFile] = useState<File | null>(null);
  const [pendingPortalSignatureRemoval, setPendingPortalSignatureRemoval] = useState(false);
  const portalSignatureInputRef = useRef<HTMLInputElement>(null);
  const [portalDocuments, setPortalDocuments] = useState<PortalEmployeeDocumentRow[]>([]);
  const [portalEmployeeDocActionId, setPortalEmployeeDocActionId] = useState<number | null>(null);
  const [portalSelfDni, setPortalSelfDni] = useState("");
  const [portalSelfDocumentType, setPortalSelfDocumentType] = useState("dni");
  const [portalSelfEmployeeCode, setPortalSelfEmployeeCode] = useState("");
  const [portalSelfMiddleName, setPortalSelfMiddleName] = useState("");
  const [portalSelfSecondLastName, setPortalSelfSecondLastName] = useState("");
  const [portalSelfBirthDate, setPortalSelfBirthDate] = useState("");
  const [portalSelfEducation, setPortalSelfEducation] = useState("");
  const [portalSelfDegree, setPortalSelfDegree] = useState("");
  const [portalSelfCuspp, setPortalSelfCuspp] = useState("");
  const [portalSelfDependentsCount, setPortalSelfDependentsCount] = useState("");
  const [portalSelfHasFamilyAllowance, setPortalSelfHasFamilyAllowance] = useState(false);
  const [portalSelfPdfFiles, setPortalSelfPdfFiles] = useState<Record<PortalSelfPdfKey, File | null>>(emptyPortalSelfPdfFiles);
  const [isDatosEditing, setIsDatosEditing] = useState(false);
  const lastPortalContactRef = useRef<PortalContact | null>(null);

  const isPersonalFieldEditable = isDatosEditing && canSelfEditPersonalInPortal;
  const isDatosFieldEditable = isDatosEditing && canEditPortalDatos;

  const [notificationPage, setNotificationPage] = useState(1);
  const [notifications, setNotifications] = useState<PortalEmployeeNotification[]>([]);
  const [notificationMeta, setNotificationMeta] = useState({
    current_page: 1,
    last_page: 1,
    total: 0,
    per_page: DEFAULT_LIST_PAGE_SIZE,
  });
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const [notificationMarkingId, setNotificationMarkingId] = useState<number | null>(null);
  const [notificationMarkingAll, setNotificationMarkingAll] = useState(false);

  const [assetsPage, setAssetsPage] = useState(1);
  const [portalAssets, setPortalAssets] = useState<PortalAsset[]>([]);
  const [portalAssetsMeta, setPortalAssetsMeta] = useState({
    current_page: 1,
    last_page: 1,
    total: 0,
    per_page: DEFAULT_LIST_PAGE_SIZE,
  });
  const [portalAssetsLoading, setPortalAssetsLoading] = useState(false);
  const [portalAssetsError, setPortalAssetsError] = useState<string | null>(null);
  const [portalLoanActDownloadingId, setPortalLoanActDownloadingId] = useState<number | null>(null);
  const [payslipPdfDownloadingId, setPayslipPdfDownloadingId] = useState<number | null>(null);

  const balanceYear = useMemo(() => new Date().getFullYear(), []);

  const portalDocByType = useMemo(() => portalLatestDocByType(portalDocuments), [portalDocuments]);
  const portalContractDoc = portalDocByType.get("contract");

  const handlePortalSelfPdfFileSelect = (pdfKey: PortalSelfPdfKey, label: string) => (file: File | null) => {
    if (file && portalDocByType.has(pdfKey)) {
      if (!confirmReplaceEmployeeDocument(label)) {
        return;
      }
    }
    setPortalSelfPdfFiles((prev) => ({ ...prev, [pdfKey]: file }));
  };

  const attendancePeriod = useMemo(() => {
    const from = format(new Date(portalAttYear, portalAttMonthIndex, 1), "yyyy-MM-dd");
    const to = format(new Date(portalAttYear, portalAttMonthIndex + 1, 0), "yyyy-MM-dd");
    const title = formatAppMonthYear(portalAttMonthIndex + 1, portalAttYear);
    return { from, to, title };
  }, [portalAttYear, portalAttMonthIndex]);

  const diasCalculados =
    fechaInicio && fechaFin ? Math.max(differenceInCalendarDays(fechaFin, fechaInicio) + 1, 0) : 0;

  const hasPendingResignation = useMemo(
    () => resignations.some(r => r.status === "pendiente"),
    [resignations],
  );

  const portalCalDays = useMemo(
    () =>
      buildMonthCalendarDaysWithVacations(
        portalAttYear,
        portalAttMonthIndex,
        attendanceRecords,
        portalApprovedVacations,
        recordDateToIsoDay,
      ),
    [attendanceRecords, portalApprovedVacations, portalAttYear, portalAttMonthIndex],
  );

  const attendanceStats = useMemo(() => {
    let asistidos = 0;
    let faltas = 0;
    let tardanzas = 0;
    let vacaciones = 0;
    let otros = 0;
    for (const { day, status } of portalCalDays) {
      if (isWeekendYmd(portalAttYear, portalAttMonthIndex, day)) continue;
      switch (status) {
        case "asistido":
        case "recuperacion":
          asistidos++;
          break;
        case "falta_j":
        case "falta_nj":
          faltas++;
          break;
        case "tardanza_j":
        case "tardanza_nj":
          tardanzas++;
          break;
        case "vacaciones":
          vacaciones++;
          break;
        case "__none__":
          break;
        default:
          otros++;
      }
    }
    return { asistidos, faltas, tardanzas, vacaciones, otros };
  }, [portalCalDays, portalAttYear, portalAttMonthIndex]);

  const portalCalFirstBlank = useMemo(
    () => portalCalFirstDayOffset(portalAttYear, portalAttMonthIndex),
    [portalAttYear, portalAttMonthIndex],
  );

  const loadPayslips = useCallback(async () => {
    if (!hasEmployee) {
      setPayslips([]);
      setPayslipError(null);
      return;
    }
    setPayslipLoading(true);
    setPayslipError(null);
    try {
      const r = await fetchPortalPayslipsPage({ page: payslipPage, per_page: DEFAULT_LIST_PAGE_SIZE });
      setPayslips(r.data);
      setPayslipMeta({
        current_page: r.meta.current_page,
        last_page: r.meta.last_page,
        total: r.meta.total,
        per_page: r.meta.per_page,
      });
    } catch (e) {
      setPayslipError(requestErrorMessage(e));
      setPayslips([]);
    } finally {
      setPayslipLoading(false);
    }
  }, [hasEmployee, payslipPage]);

  const loadVacations = useCallback(async () => {
    if (!hasEmployee) {
      setVacations([]);
      setVacationError(null);
      return;
    }
    setVacationLoading(true);
    setVacationError(null);
    try {
      const r = await fetchPortalVacationRequestsPage({
        page: vacationPage,
        per_page: DEFAULT_LIST_PAGE_SIZE,
      });
      setVacations(r.data);
      setVacationMeta({
        current_page: r.meta.current_page,
        last_page: r.meta.last_page,
        total: r.meta.total,
        per_page: r.meta.per_page,
      });
    } catch (e) {
      setVacationError(requestErrorMessage(e));
      setVacations([]);
    } finally {
      setVacationLoading(false);
    }
  }, [hasEmployee, vacationPage]);

  const loadResignations = useCallback(async () => {
    if (!hasEmployee) {
      setResignations([]);
      setResignationError(null);
      return;
    }
    setResignationLoading(true);
    setResignationError(null);
    try {
      const r = await fetchPortalResignationRequestsPage({
        page: resignationPage,
        per_page: DEFAULT_LIST_PAGE_SIZE,
      });
      setResignations(r.data);
      setResignationMeta({
        current_page: r.meta.current_page,
        last_page: r.meta.last_page,
        total: r.meta.total,
        per_page: r.meta.per_page,
      });
    } catch (e) {
      setResignationError(requestErrorMessage(e));
      setResignations([]);
    } finally {
      setResignationLoading(false);
    }
  }, [hasEmployee, resignationPage]);

  const loadVacationBalance = useCallback(async () => {
    if (!hasEmployee) {
      setVacationBalance(null);
      setVacationBalanceError(null);
      return;
    }
    setVacationBalanceLoading(true);
    setVacationBalanceError(null);
    try {
      const r = await fetchPortalVacationBalance(balanceYear);
      setVacationBalance(r.data);
    } catch (e) {
      setVacationBalanceError(requestErrorMessage(e));
      setVacationBalance(null);
    } finally {
      setVacationBalanceLoading(false);
    }
  }, [hasEmployee, balanceYear]);

  const loadAttendance = useCallback(async () => {
    if (!hasEmployee) {
      setAttendanceRecords([]);
      setPortalApprovedVacations([]);
      setAttendanceError(null);
      return;
    }
    setAttendanceLoading(true);
    setAttendanceError(null);
    try {
      const [rows, approvedVacations] = await Promise.all([
        fetchAllPortalAttendanceInRange({
          from: attendancePeriod.from,
          to: attendancePeriod.to,
        }),
        fetchAllApprovedPortalVacations(),
      ]);
      setAttendanceRecords(filterWeekdayAttendanceRecords(rows) as PortalAttendanceRow[]);
      setPortalApprovedVacations(approvedVacations);
    } catch (e) {
      setAttendanceError(requestErrorMessage(e));
      setAttendanceRecords([]);
      setPortalApprovedVacations([]);
    } finally {
      setAttendanceLoading(false);
    }
  }, [hasEmployee, attendancePeriod.from, attendancePeriod.to]);

  const openPortalAttendanceDay = useCallback(
    (iso: string, record: PortalAttendanceRow | null, dayStatus: string) => {
      setPortalAttDayIso(iso);
      setPortalAttDayRecord(record);
      setPortalAttDayStatus(dayStatus);
      setPortalJustificationDraft(
        record?.justification && String(record.justification).trim() ? String(record.justification) : "",
      );
      setPortalJustificationFile(null);
      setPortalAttDayOpen(true);
      requestAnimationFrame(() => {
        if (portalJustificationFileInputRef.current) {
          portalJustificationFileInputRef.current.value = "";
        }
      });
    },
    [],
  );

  const handlePortalCalendarDayClick = useCallback(
    (day: number) => {
      if (attendanceLoading) return;
      const y = portalAttYear;
      const mo = portalAttMonthIndex;
      if (isWeekendYmd(y, mo, day)) {
        toast({
          title: "Día no laborable",
          description: "Sábado y domingo no tienen registro de asistencia laborable.",
        });
        return;
      }
      const iso = format(new Date(y, mo, day), "yyyy-MM-dd");
      const rec =
        (attendanceRecords.find((r) => recordDateToIsoDay(r) === iso) as PortalAttendanceRow | undefined) ?? null;
      const dayStatus = portalCalDays.find((d) => d.day === day)?.status ?? "__none__";
      openPortalAttendanceDay(iso, rec, dayStatus);
    },
    [
      attendanceLoading,
      portalAttYear,
      portalAttMonthIndex,
      attendanceRecords,
      portalCalDays,
      openPortalAttendanceDay,
      toast,
    ],
  );

  const submitPortalJustification = useCallback(async () => {
    if (!portalAttDayRecord) return;
    const id = portalAttDayRecord.id;
    const text = portalJustificationDraft.trim();
    const file = portalJustificationFile;
    if (!text && !file) {
      toast({
        title: "Datos incompletos",
        description: "Escribe el motivo de la justificación o adjunta un archivo (PDF o imagen, máx. 5 MB).",
        variant: "destructive",
      });
      return;
    }
    setPortalJustificationSaving(true);
    try {
      if (text) {
        await patchPortalAttendanceJustification(id, { justification: text });
      }
      if (file) {
        await uploadPortalAttendanceJustificationFile(id, file);
      }
      toast({ title: "Justificación registrada", description: "Se actualizó tu registro de asistencia." });
      setPortalAttDayOpen(false);
      await loadAttendance();
    } catch (e) {
      const msg = e instanceof ApiHttpError ? e.apiError?.message ?? e.message : "No se pudo guardar";
      toast({ title: "Error", description: typeof msg === "string" ? msg : "Intenta de nuevo", variant: "destructive" });
    } finally {
      setPortalJustificationSaving(false);
    }
  }, [portalAttDayRecord, portalJustificationDraft, portalJustificationFile, toast, loadAttendance]);

  const handlePortalDownloadJustification = useCallback(async () => {
    if (!portalAttDayRecord?.has_justification_file) return;
    try {
      const blob = await downloadPortalAttendanceJustificationBlob(portalAttDayRecord.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `justificacion-asistencia-${portalAttDayRecord.id}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Error", description: "No se pudo descargar el archivo.", variant: "destructive" });
    }
  }, [portalAttDayRecord, toast]);

  useEffect(() => {
    if (activeTab === "boletas") void loadPayslips();
  }, [activeTab, loadPayslips]);

  useEffect(() => {
    if (activeTab === "solicitudes") void loadVacations();
  }, [activeTab, loadVacations]);

  useEffect(() => {
    if (activeTab === "solicitudes") void loadVacationBalance();
  }, [activeTab, loadVacationBalance]);

  useEffect(() => {
    if (activeTab === "solicitudes") void loadResignations();
  }, [activeTab, loadResignations]);

  useEffect(() => {
    if (activeTab === "asistencia") void loadAttendance();
  }, [activeTab, loadAttendance]);

  const resetVacationForm = () => {
    setFechaInicio(undefined);
    setFechaFin(undefined);
    setEditingVacationId(null);
  };

  const applyPortalContactResponse = useCallback((d: PortalContact) => {
    lastPortalContactRef.current = d;
    setCorporateEmail(d.corporate_email ?? "");
    setContactPhone(d.phone ?? "");
    setContactPersonalEmail(d.personal_email ?? "");
    setContactAddress(d.address ?? "");
    setContactEmergencyPhone(d.emergency_contact_phone ?? "");
    setBank(d.bank ?? "");
    setBankAccount(d.bank_account ?? "");
    setBankAccountCci(d.bank_account_cci ?? "");
    setPensionFund(d.pension_fund ?? "");
    setEmployerContributionOption(d.employer_contribution_option ?? "__none__");
    setPortalSelfCuspp(d.cuspp ?? "");
    setPortalSelfDependentsCount(
      d.dependents_count != null && !Number.isNaN(d.dependents_count) ? String(d.dependents_count) : "",
    );
    setPortalSelfHasFamilyAllowance(Boolean(d.has_family_allowance));
    setPortalPersonal(d.personal);
    setPortalWork(d.work);
    setHasEmployeePhotoFile(Boolean(d.has_employee_photo_file));
    setHasEmployeeSignatureFile(Boolean(d.has_employee_signature_file));
    setPendingPortalSignatureRemoval(false);
  }, []);

  const loadContact = useCallback(async () => {
    if (!hasEmployee) {
      setCorporateEmail("");
      setContactPhone("");
      setContactPersonalEmail("");
      setContactAddress("");
      setContactEmergencyPhone("");
      setBank("");
      setBankAccount("");
      setBankAccountCci("");
      setPensionFund("");
      setEmployerContributionOption("__none__");
      setPortalSelfCuspp("");
      setPortalSelfDependentsCount("");
      setPortalSelfHasFamilyAllowance(false);
      setPortalSelfDocumentType("dni");
      setPortalSelfEmployeeCode("");
      setPortalPersonal(null);
      setPortalWork(null);
      setHasEmployeePhotoFile(false);
      setHasEmployeeSignatureFile(false);
      setPendingPortalSignatureFile(null);
      setPendingPortalSignatureRemoval(false);
      setPortalDocuments([]);
      setProfilePhotoObjectUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setSignatureObjectUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setContactError(null);
      return;
    }
    setContactLoading(true);
    setContactError(null);
    try {
      const [r, docRes] = await Promise.all([fetchPortalContact(), fetchPortalDocuments()]);
      applyPortalContactResponse(r.data);
      setPortalDocuments(docRes.data);
    } catch (e) {
      setContactError(requestErrorMessage(e));
      setPortalDocuments([]);
    } finally {
      setContactLoading(false);
    }
  }, [hasEmployee, applyPortalContactResponse]);

  useEffect(() => {
    if (!canSelfEditPersonalInPortal || !portalPersonal) return;
    setPortalSelfDocumentType(portalPersonal.document_type ?? "dni");
    setPortalSelfDni(editableEmployeeDni(portalPersonal.dni));
    setPortalSelfEmployeeCode(portalPersonal.employee_code ?? "");
    setPortalSelfMiddleName(portalPersonal.middle_name ?? "");
    setPortalSelfSecondLastName(portalPersonal.second_last_name ?? "");
    setPortalSelfBirthDate(portalPersonal.birth_date ? portalPersonal.birth_date.slice(0, 10) : "");
    setPortalSelfEducation(portalPersonal.education_level ?? "");
    setPortalSelfDegree(portalPersonal.degree ?? "");
  }, [canSelfEditPersonalInPortal, portalPersonal]);

  const handleViewPortalEmployeeDocument = useCallback(
    async (doc: PortalEmployeeDocumentRow) => {
      setPortalEmployeeDocActionId(doc.id);
      try {
        const blob = await downloadPortalEmployeeDocumentBlob(doc.id, { attachment: false });
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank", "noopener");
        window.setTimeout(() => URL.revokeObjectURL(url), 3_600_000);
      } catch (e) {
        const msg = e instanceof ApiHttpError ? e.apiError?.message ?? e.message : "No se pudo abrir";
        toast({
          title: "Error",
          description: typeof msg === "string" ? msg : "Intenta de nuevo",
          variant: "destructive",
        });
      } finally {
        setPortalEmployeeDocActionId(null);
      }
    },
    [toast],
  );

  const handleDownloadPortalEmployeeDocument = useCallback(
    async (doc: PortalEmployeeDocumentRow) => {
      setPortalEmployeeDocActionId(doc.id);
      try {
        const blob = await downloadPortalEmployeeDocumentBlob(doc.id, { attachment: true });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const base = doc.filename.replace(/[^\w.\-]+/g, "_") || "documento";
        const safe = base.toLowerCase().endsWith(".pdf") ? base : `${base}.pdf`;
        a.download = safe;
        a.click();
        URL.revokeObjectURL(url);
      } catch (e) {
        const msg = e instanceof ApiHttpError ? e.apiError?.message ?? e.message : "No se pudo descargar";
        toast({
          title: "Error",
          description: typeof msg === "string" ? msg : "Intenta de nuevo",
          variant: "destructive",
        });
      } finally {
        setPortalEmployeeDocActionId(null);
      }
    },
    [toast],
  );

  const handleDeletePortalEmployeeDocument = useCallback(
    async (doc: PortalEmployeeDocumentRow, label: string) => {
      if (selfEmployeeId == null) return;
      if (!window.confirm(`¿Eliminar el documento "${label}"? Esta acción no se puede deshacer.`)) return;
      setPortalEmployeeDocActionId(doc.id);
      try {
        await deleteEmployeeDocument(selfEmployeeId, doc.id);
        toast({ title: "Documento eliminado", description: `${label} se eliminó correctamente.` });
        const docRes = await fetchPortalDocuments();
        setPortalDocuments(docRes.data);
      } catch (e) {
        const msg = e instanceof ApiHttpError ? e.apiError?.message ?? e.message : "No se pudo eliminar";
        toast({
          title: "Error",
          description: typeof msg === "string" ? msg : "Intenta de nuevo",
          variant: "destructive",
        });
      } finally {
        setPortalEmployeeDocActionId(null);
      }
    },
    [selfEmployeeId, toast],
  );

  useEffect(() => {
    if (activeTab === "datos") void loadContact();
  }, [activeTab, loadContact]);

  useEffect(() => {
    if (activeTab !== "datos") {
      setIsDatosEditing(false);
    }
  }, [activeTab]);

  const resetPortalPersonalFieldsFromSnapshot = useCallback((personal: PortalPersonalSnapshot | null) => {
    if (!personal) return;
    setPortalSelfDocumentType(personal.document_type ?? "dni");
    setPortalSelfDni(editableEmployeeDni(personal.dni));
    setPortalSelfEmployeeCode(personal.employee_code ?? "");
    setPortalSelfMiddleName(personal.middle_name ?? "");
    setPortalSelfSecondLastName(personal.second_last_name ?? "");
    setPortalSelfBirthDate(personal.birth_date ? personal.birth_date.slice(0, 10) : "");
    setPortalSelfEducation(personal.education_level ?? "");
    setPortalSelfDegree(personal.degree ?? "");
  }, []);

  const enterDatosEditMode = useCallback(() => {
    setIsDatosEditing(true);
  }, []);

  const handleCancelDatosEdit = useCallback(() => {
    const snap = lastPortalContactRef.current;
    if (snap) {
      applyPortalContactResponse(snap);
      resetPortalPersonalFieldsFromSnapshot(snap.personal);
    }
    setPortalSelfPdfFiles(emptyPortalSelfPdfFiles());
    setPendingPortalSignatureFile(null);
    setPendingPortalSignatureRemoval(false);
    setIsDatosEditing(false);
    void loadContact();
  }, [applyPortalContactResponse, resetPortalPersonalFieldsFromSnapshot, loadContact]);

  useEffect(() => {
    if (activeTab !== "datos" || !hasEmployee || contactLoading || !hasEmployeePhotoFile) {
      setProfilePhotoObjectUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const blob = await fetchPortalEmployeePhotoBlob();
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        setProfilePhotoObjectUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
      } catch {
        if (!cancelled) {
          setProfilePhotoObjectUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return null;
          });
        }
      }
    })();
    return () => {
      cancelled = true;
      setProfilePhotoObjectUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, [activeTab, hasEmployee, contactLoading, hasEmployeePhotoFile]);

  useEffect(() => {
    if (activeTab !== "datos" || !hasEmployee || contactLoading || !hasEmployeeSignatureFile) {
      setSignatureObjectUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const blob = await fetchPortalEmployeeSignatureBlob();
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        setSignatureObjectUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
      } catch {
        if (!cancelled) {
          setSignatureObjectUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return null;
          });
        }
      }
    })();
    return () => {
      cancelled = true;
      setSignatureObjectUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, [activeTab, hasEmployee, contactLoading, hasEmployeeSignatureFile]);

  const loadNotifications = useCallback(async () => {
    if (!hasEmployee) {
      setNotifications([]);
      setNotificationError(null);
      return;
    }
    setNotificationLoading(true);
    setNotificationError(null);
    try {
      const r = await fetchPortalNotificationsPage({
        page: notificationPage,
        per_page: DEFAULT_LIST_PAGE_SIZE,
      });
      setNotifications(r.data);
      setNotificationMeta({
        current_page: r.meta.current_page,
        last_page: r.meta.last_page,
        total: r.meta.total,
        per_page: r.meta.per_page,
      });
    } catch (e) {
      setNotificationError(requestErrorMessage(e));
      setNotifications([]);
    } finally {
      setNotificationLoading(false);
    }
  }, [hasEmployee, notificationPage]);

  useEffect(() => {
    if (activeTab === "notificaciones") void loadNotifications();
  }, [activeTab, loadNotifications]);

  const loadPortalAssets = useCallback(async () => {
    if (!hasEmployee) {
      setPortalAssets([]);
      setPortalAssetsError(null);
      return;
    }
    setPortalAssetsLoading(true);
    setPortalAssetsError(null);
    try {
      const r = await fetchPortalAssetsPage({ page: assetsPage, per_page: DEFAULT_LIST_PAGE_SIZE });
      setPortalAssets(r.data);
      setPortalAssetsMeta({
        current_page: r.meta.current_page,
        last_page: r.meta.last_page,
        total: r.meta.total,
        per_page: r.meta.per_page,
      });
    } catch (e) {
      setPortalAssetsError(requestErrorMessage(e));
      setPortalAssets([]);
    } finally {
      setPortalAssetsLoading(false);
    }
  }, [hasEmployee, assetsPage]);

  useEffect(() => {
    if (activeTab === "equipos") void loadPortalAssets();
  }, [activeTab, loadPortalAssets]);

  const handleDownloadPayslipPdf = async (row: PortalPayslip) => {
    setPayslipPdfDownloadingId(row.id);
    try {
      const blob = await downloadPortalPayslipPdfBlob(row.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      const periodSlug = payslipPeriodLabel(row)
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9.-]/g, "");
      anchor.download = periodSlug ? `boleta-${periodSlug}.pdf` : `boleta-pago-${row.id}.pdf`;
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      const msg = err instanceof ApiHttpError ? err.apiError?.message ?? err.message : "No se pudo descargar el PDF";
      toast({ title: "Error", description: typeof msg === "string" ? msg : "Intenta de nuevo", variant: "destructive" });
    } finally {
      setPayslipPdfDownloadingId(null);
    }
  };

  const handleSubmitResignation = async () => {
    const file = resignationFileInputRef.current?.files?.[0];
    if (!file) {
      toast({ title: "Adjunta la carta", description: "Se requiere un archivo PDF.", variant: "destructive" });
      return;
    }
    const proposed = proposedResignationDate.trim();
    if (proposed && !isResignationProposedDateAllowed(proposed)) {
      toast({
        title: "Preaviso insuficiente",
        description: `El último día laborable debe ser al menos ${RESIGNATION_MIN_NOTICE_DAYS} días después de hoy.`,
        variant: "destructive",
      });
      return;
    }
    setSubmittingResignation(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      if (proposed) {
        fd.set("proposed_effective_date", proposed);
      }
      if (resignationNotesText.trim()) {
        fd.set("notes", resignationNotesText.trim());
      }
      await createPortalResignationRequest(fd);
      toast({
        title: "Solicitud enviada",
        description: "RRHH revisará tu carta. Recibirás una notificación cuando haya una respuesta.",
      });
      setProposedResignationDate("");
      setResignationNotesText("");
      if (resignationFileInputRef.current) {
        resignationFileInputRef.current.value = "";
      }
      await loadResignations();
    } catch (err) {
      const msg =
        err instanceof ApiHttpError ? err.apiError?.message ?? err.message : "No se pudo enviar la solicitud";
      toast({
        title: "Error",
        description: typeof msg === "string" ? msg : "Intenta de nuevo",
        variant: "destructive",
      });
    } finally {
      setSubmittingResignation(false);
    }
  };

  const handleDownloadPortalResignationLetter = async (row: PortalResignationRequest) => {
    setResignationLetterDownloadingId(row.id);
    try {
      const blob = await downloadPortalResignationLetterBlob(row.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      const name = row.letter_original_name?.replace(/[^\w.-]+/g, "_") || `carta-renuncia-${row.id}.pdf`;
      anchor.download = name;
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      const msg = err instanceof ApiHttpError ? err.apiError?.message ?? err.message : "No se pudo descargar el PDF";
      toast({ title: "Error", description: typeof msg === "string" ? msg : "Intenta de nuevo", variant: "destructive" });
    } finally {
      setResignationLetterDownloadingId(null);
    }
  };

  const handleDownloadPortalLoanAct = async (asset: PortalAsset) => {
    setPortalLoanActDownloadingId(asset.id);
    try {
      const blob = await downloadPortalAssetLoanActBlob(asset.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `acta-prestamo-activo-${asset.id}.pdf`;
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      const msg = err instanceof ApiHttpError ? err.apiError?.message ?? err.message : "No se pudo descargar el PDF";
      toast({ title: "Error", description: typeof msg === "string" ? msg : "Intenta de nuevo", variant: "destructive" });
    } finally {
      setPortalLoanActDownloadingId(null);
    }
  };

  const handleMarkNotificationRead = async (id: number) => {
    setNotificationMarkingId(id);
    try {
      const r = await patchPortalNotificationRead(id);
      setNotifications(prev => prev.map(n => (n.id === id ? r.data : n)));
    } catch (e) {
      toast({
        title: "No se pudo marcar como leída",
        description: requestErrorMessage(e),
        variant: "destructive",
      });
    } finally {
      setNotificationMarkingId(null);
    }
  };

  const handleMarkAllNotificationsRead = async () => {
    setNotificationMarkingAll(true);
    try {
      await postPortalNotificationsReadAll();
      const nowIso = new Date().toISOString();
      setNotifications(prev =>
        prev.map(n => (n.read_at == null ? { ...n, read_at: nowIso } : n)),
      );
    } catch (e) {
      toast({
        title: "No se pudo completar",
        description: requestErrorMessage(e),
        variant: "destructive",
      });
    } finally {
      setNotificationMarkingAll(false);
    }
  };

  const handlePortalSignatureFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    setPendingPortalSignatureFile(file);
    if (file) {
      setPendingPortalSignatureRemoval(false);
      setHasEmployeeSignatureFile(true);
    }
    if (!file) {
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    setSignatureObjectUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return previewUrl;
    });
  }, []);

  const handleSaveContact = async () => {
    const emailTrim = contactPersonalEmail.trim();
    if (emailTrim && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) {
      toast({
        title: "Correo no válido",
        description: "Revisa el formato del correo personal.",
        variant: "destructive",
      });
      return;
    }
    const dniTrim = portalSelfDni.trim();
    const hasPdfUploads = (["dni_scan", "cv", "antecedentes", "medical_exam"] as PortalSelfPdfKey[]).some(
      (key) => portalSelfPdfFiles[key] != null,
    );
    const hasPersonalFieldChanges =
      portalSelfDocumentType !== (portalPersonal?.document_type ?? "dni") ||
      dniTrim !== editableEmployeeDni(portalPersonal?.dni) ||
      portalSelfEmployeeCode.trim() !== (portalPersonal?.employee_code ?? "").trim() ||
      portalSelfMiddleName.trim() !== (portalPersonal?.middle_name ?? "").trim() ||
      portalSelfSecondLastName.trim() !== (portalPersonal?.second_last_name ?? "").trim() ||
      portalSelfBirthDate !== (portalPersonal?.birth_date ? portalPersonal.birth_date.slice(0, 10) : "") ||
      portalSelfEducation !== (portalPersonal?.education_level ?? "") ||
      portalSelfDegree !== (portalPersonal?.degree ?? "") ||
      employerContributionOption !== (lastPortalContactRef.current?.employer_contribution_option ?? "__none__") ||
      portalSelfCuspp.trim().toUpperCase() !== (lastPortalContactRef.current?.cuspp ?? "").trim().toUpperCase() ||
      portalSelfDependentsCount.trim() !==
        (lastPortalContactRef.current?.dependents_count != null
          ? String(lastPortalContactRef.current.dependents_count)
          : "") ||
      portalSelfHasFamilyAllowance !== Boolean(lastPortalContactRef.current?.has_family_allowance);
    const shouldUpdatePersonal = hasPdfUploads || hasPersonalFieldChanges;

    setContactSaving(true);
    try {
      let pdfUploadError = false;
      if (canSelfEditPersonalInPortal && selfEmployeeId != null) {
        if (shouldUpdatePersonal) {
          const personalPayload: {
            document_type: string | null;
            middle_name: string | null;
            second_last_name: string | null;
            birth_date: string | null;
            education_level: string | null;
            degree: string | null;
            employee_code: string | null;
            cuspp: string | null;
            dependents_count: number | null;
            has_family_allowance: boolean;
            dni?: string | null;
          } = {
            document_type: portalSelfDocumentType.trim() || null,
            middle_name: portalSelfMiddleName.trim() || null,
            second_last_name: portalSelfSecondLastName.trim() || null,
            birth_date: portalSelfBirthDate.trim() || null,
            education_level: portalSelfEducation.trim() || null,
            degree: portalSelfDegree.trim() || null,
            employee_code: portalSelfEmployeeCode.trim() || null,
            cuspp: portalSelfCuspp.trim() ? portalSelfCuspp.trim().toUpperCase() : null,
            dependents_count:
              portalSelfDependentsCount.trim() === ""
                ? null
                : Number.isNaN(Number.parseInt(portalSelfDependentsCount, 10))
                  ? null
                  : Number.parseInt(portalSelfDependentsCount, 10),
            has_family_allowance: portalSelfHasFamilyAllowance,
          };
          if (dniTrim !== editableEmployeeDni(portalPersonal?.dni)) {
            personalPayload.dni = dniTrim || null;
          }
          await updateEmployee(selfEmployeeId, personalPayload);
        }
        const pdfOrder: PortalSelfPdfKey[] = ["dni_scan", "cv", "antecedentes", "medical_exam"];
        for (const key of pdfOrder) {
          const file = portalSelfPdfFiles[key];
          if (!file) continue;
          try {
            await uploadEmployeeDocument(selfEmployeeId, key, file);
          } catch {
            pdfUploadError = true;
          }
        }
      }
      if (pendingPortalSignatureFile) {
        await uploadPortalEmployeeSignature(pendingPortalSignatureFile);
      } else if (pendingPortalSignatureRemoval) {
        await deletePortalEmployeeSignature();
      }

      const r = await patchPortalContact({
        phone: contactPhone.trim() || null,
        personal_email: emailTrim || null,
        address: contactAddress.trim() || null,
        emergency_contact_phone: contactEmergencyPhone.trim() || null,
        bank: bank.trim() || null,
        bank_account: bankAccount.trim() || null,
        bank_account_cci: bankAccountCci.trim() || null,
        pension_fund: pensionFund.trim() || null,
        employer_contribution_option:
          employerContributionOption === "__none__"
            ? null
            : (employerContributionOption as "essalud" | "sis_microempresa"),
      });
      applyPortalContactResponse(r.data);
      const docRes = await fetchPortalDocuments();
      setPortalDocuments(docRes.data);
      if (canSelfEditPersonalInPortal) {
        setPortalSelfPdfFiles(emptyPortalSelfPdfFiles());
      }
      setPendingPortalSignatureFile(null);
      setPendingPortalSignatureRemoval(false);
      if (pdfUploadError) {
        toast({
          title: "Cambios guardados con avisos",
          description:
            "Los datos se guardaron, pero uno o más PDF personales no se pudieron subir. Vuelve a elegir el archivo y pulsa Guardar cambios.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Datos actualizados", description: "Tu información se guardó correctamente." });
      }
      setIsDatosEditing(false);
    } catch (e) {
      const msg = requestErrorMessage(e);
      toast({ title: "No se pudo guardar", description: msg, variant: "destructive" });
    } finally {
      setContactSaving(false);
    }
  };

  const handleGuardarVacacion = async () => {
    if (!fechaInicio || !fechaFin || diasCalculados < 1) return;
    setSavingVacation(true);
    try {
      const start = format(fechaInicio, "yyyy-MM-dd");
      const end = format(fechaFin, "yyyy-MM-dd");
      if (editingVacationId != null) {
        await patchPortalVacationRequest(editingVacationId, { start_date: start, end_date: end });
        toast({
          title: "Solicitud actualizada",
          description: "Los cambios en tu solicitud de vacaciones se guardaron.",
        });
      } else {
        await createPortalVacationRequest({
          start_date: start,
          end_date: end,
          days: diasCalculados,
        });
        toast({
          title: "Solicitud enviada",
          description: "Tu solicitud de vacaciones fue registrada correctamente.",
        });
      }
      setShowNuevaSolicitud(false);
      resetVacationForm();
      await loadVacations();
      await loadVacationBalance();
    } catch (e) {
      const msg = requestErrorMessage(e);
      toast({
        title: editingVacationId != null ? "No se pudo guardar" : "No se pudo enviar",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setSavingVacation(false);
    }
  };

  const openEditVacation = (v: VacationRequest) => {
    setEditingVacationId(v.id);
    const s = v.start_date.slice(0, 10);
    const e = v.end_date.slice(0, 10);
    setFechaInicio(parseISO(`${s}T12:00:00`));
    setFechaFin(parseISO(`${e}T12:00:00`));
    setShowNuevaSolicitud(true);
  };

  const handleConfirmDeleteVacation = async () => {
    if (vacationToDeleteId == null) return;
    setVacationDeleteLoading(true);
    try {
      await deletePortalVacationRequest(vacationToDeleteId);
      toast({ title: "Solicitud eliminada", description: "La solicitud de vacaciones fue anulada." });
      setVacationToDeleteId(null);
      await loadVacations();
      await loadVacationBalance();
    } catch (e) {
      toast({ title: "Error", description: requestErrorMessage(e), variant: "destructive" });
    } finally {
      setVacationDeleteLoading(false);
    }
  };

  const openResignationEdit = (r: PortalResignationRequest) => {
    setResignationEditRow(r);
    const raw = r.proposed_effective_date?.slice(0, 10) ?? "";
    const minIso = resignationProposedMinIso();
    setResignationEditDate(raw && raw >= minIso ? raw : "");
    setResignationEditNotes(r.notes ?? "");
  };

  const handleSaveResignationEdit = async () => {
    if (!resignationEditRow) return;
    const d = resignationEditDate.trim();
    if (d && !isResignationProposedDateAllowed(d)) {
      toast({
        title: "Preaviso insuficiente",
        description: `El último día laborable debe ser al menos ${RESIGNATION_MIN_NOTICE_DAYS} días después de hoy.`,
        variant: "destructive",
      });
      return;
    }
    setResignationEditSaving(true);
    try {
      const fd = new FormData();
      fd.set("notes", resignationEditNotes);
      if (d) fd.set("proposed_effective_date", d);
      const file = resignationEditFileRef.current?.files?.[0];
      if (file) fd.set("file", file);
      await patchPortalResignationRequest(resignationEditRow.id, fd);
      toast({ title: "Solicitud actualizada", description: "Los cambios se guardaron correctamente." });
      setResignationEditRow(null);
      if (resignationEditFileRef.current) resignationEditFileRef.current.value = "";
      await loadResignations();
    } catch (e) {
      toast({ title: "Error", description: requestErrorMessage(e), variant: "destructive" });
    } finally {
      setResignationEditSaving(false);
    }
  };

  const handleConfirmDeleteResignation = async () => {
    if (resignationToDeleteId == null) return;
    setResignationDeleteLoading(true);
    try {
      await deletePortalResignationRequest(resignationToDeleteId);
      toast({ title: "Solicitud eliminada", description: "Tu solicitud de renuncia fue anulada." });
      setResignationToDeleteId(null);
      await loadResignations();
    } catch (e) {
      toast({ title: "Error", description: requestErrorMessage(e), variant: "destructive" });
    } finally {
      setResignationDeleteLoading(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Portal del Colaborador</h1>
        <p className="text-muted-foreground text-sm mt-1">Bienvenido, {welcomeName}</p>
      </div>

      {isImpersonating ? (
        <Alert className="border-amber-500/40 bg-amber-500/10 dark:bg-amber-500/15">
          <Info className="h-4 w-4 text-amber-700 dark:text-amber-400" />
          <AlertTitle>Modo impersonación activo</AlertTitle>
          <AlertDescription className="space-y-1.5">
            <p>
              Estás viendo la plataforma como <span className="font-medium text-foreground">{welcomeName}</span>. Los cambios que guardes
              se aplicarán sobre ese perfil.
            </p>
            {user?.impersonation?.actor_name ? (
              <p className="text-xs text-muted-foreground">
                Sesión del administrador: {user.impersonation.actor_name}
                {user.impersonation.actor_email ? ` · ${user.impersonation.actor_email}` : ""}
              </p>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {!hasEmployee ? (
        isAdminRrhhRole ? (
          <p className="text-sm text-muted-foreground border border-border bg-muted/40 rounded-md px-4 py-3">
            Este apartado es el <span className="font-medium text-foreground">portal del colaborador</span>: solo muestra boletas,
            asistencia y demás datos cuando tu usuario tiene una{" "}
            <span className="font-medium text-foreground">ficha de colaborador vinculada</span>. Las cuentas de administración RRHH
            no suelen usar esta vista; si además trabajas como colaborador, RRHH puede vincular tu usuario a tu ficha en el sistema.
          </p>
        ) : (
          <p className="text-sm text-destructive border border-destructive/30 bg-destructive/5 rounded-md px-4 py-3">
            Tu cuenta no está vinculada a una ficha de colaborador. Solicita a RRHH que asocien tu usuario para ver boletas,
            asistencia, solicitudes, equipos en préstamo y datos personales.
          </p>
        )
      ) : null}

      <Tabs value={activeTab} onValueChange={handlePortalTabChange}>
        {!hidePortalTabBar ? (
          <TabsList className="bg-card border border-border">
            <TabsTrigger value="datos" className="gap-1.5">
              <NotebookPen className="w-4 h-4" />
              Datos
            </TabsTrigger>
            <TabsTrigger value="asistencia" className="gap-1.5">
              <CalendarIcon className="w-4 h-4" />
              Mis Asistencias
            </TabsTrigger>
            <TabsTrigger value="boletas" className="gap-1.5">
              <FileText className="w-4 h-4" />
              Mis Boletas
            </TabsTrigger>
            <TabsTrigger value="equipos" className="gap-1.5">
              <Laptop className="w-4 h-4" />
              Mis Equipos
            </TabsTrigger>
            <TabsTrigger value="solicitudes" className="gap-1.5">
              <User className="w-4 h-4" />
              Mis Solicitudes
            </TabsTrigger>
            <TabsTrigger value="notificaciones" className="gap-1.5">
              <Bell className="w-4 h-4" />
              Notificaciones
            </TabsTrigger>
          </TabsList>
        ) : null}

        <TabsContent value="datos" className="mt-4 space-y-6 max-w-3xl">
          {contactLoading ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : contactError ? (
            <Card className="shadow-card">
              <CardContent className="pt-6 space-y-3">
                <p className="text-sm text-destructive">{contactError}</p>
                <Button size="sm" variant="outline" type="button" onClick={() => void loadContact()}>
                  Reintentar
                </Button>
              </CardContent>
            </Card>
          ) : !hasEmployee ? (
            <p className="text-sm text-muted-foreground">{emptyStateNoEmployeeMessage}</p>
          ) : (
            <>
              {portalPersonal && portalWork ? (
                <Card className="shadow-card">
                  <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-4">
                    <CardTitle className="text-lg">Datos Personales</CardTitle>
                    {canEditPortalDatos ? (
                      !isDatosEditing ? (
                        <Button variant="outline" size="sm" type="button" className="shrink-0" onClick={enterDatosEditMode}>
                          <Pencil className="w-3.5 h-3.5 mr-1" />
                          Editar
                        </Button>
                      ) : (
                        <Button variant="ghost" size="sm" type="button" className="shrink-0" onClick={handleCancelDatosEdit}>
                          Cancelar
                        </Button>
                      )
                    ) : null}
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center gap-4 mb-2">
                      <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center border-2 border-dashed border-border overflow-hidden">
                        {profilePhotoObjectUrl || user?.avatar ? (
                          <img
                            src={profilePhotoObjectUrl ?? user?.avatar ?? ""}
                            alt=""
                            className="w-full h-full object-cover"
                            referrerPolicy={profilePhotoObjectUrl ? undefined : "no-referrer"}
                          />
                        ) : (
                          <Upload className="w-6 h-6 text-muted-foreground" />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground max-w-[min(100%,280px)]">
                        La foto proviene de la cuenta corporativa vinculada y no se puede cambiar aquí.
                      </p>
                    </div>
                    <div className="flex items-center gap-4 mb-2">
                      <div className="w-36 h-16 rounded-md bg-muted flex items-center justify-center border border-dashed border-border overflow-hidden">
                        {signatureObjectUrl ? (
                          <img src={signatureObjectUrl} alt="Firma del colaborador" className="w-full h-full object-contain p-1" />
                        ) : (
                          <Upload className="w-6 h-6 text-muted-foreground" />
                        )}
                      </div>
                      {isDatosFieldEditable ? (
                        <div className="flex items-center gap-2">
                          <input
                            ref={portalSignatureInputRef}
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            className="hidden"
                            onChange={handlePortalSignatureFileChange}
                          />
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => portalSignatureInputRef.current?.click()}
                          >
                            {signatureObjectUrl ? "Cambiar firma" : "Subir firma"}
                          </Button>
                          {signatureObjectUrl ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                const hadStoredSignature = Boolean(lastPortalContactRef.current?.has_employee_signature_file);
                                setPendingPortalSignatureFile(null);
                                setPendingPortalSignatureRemoval(hadStoredSignature);
                                setHasEmployeeSignatureFile(false);
                                setSignatureObjectUrl((prev) => {
                                  if (prev) URL.revokeObjectURL(prev);
                                  return null;
                                });
                              }}
                            >
                              Quitar
                            </Button>
                          ) : null}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground max-w-[min(100%,280px)]">
                          Tu firma se usa en la boleta aprobada y se actualiza desde aquí cuando tienes permiso de edición.
                        </p>
                      )}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                      <div className="space-y-2">
                        <Label>Nombre</Label>
                        <Input readOnly className={cn(portalReadonlyFieldClass)} value={portalFieldDisplay(portalPersonal.first_name)} />
                      </div>
                      <div className="space-y-2">
                        <Label>Segundo Nombre</Label>
                        {isPersonalFieldEditable ? (
                          <>
                            <Input
                              value={portalSelfMiddleName}
                              onChange={(e) => setPortalSelfMiddleName(e.target.value)}
                              placeholder="Ej: Carlos"
                            />
                            <p className="text-xs text-muted-foreground">Ingrese todos los demás nombres si aplica</p>
                          </>
                        ) : (
                          <Input readOnly className={cn(portalReadonlyFieldClass)} value={portalFieldDisplay(portalPersonal.middle_name)} />
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label>Apellido</Label>
                        <Input readOnly className={cn(portalReadonlyFieldClass)} value={portalFieldDisplay(portalPersonal.last_name)} />
                      </div>
                      <div className="space-y-2">
                        <Label>Segundo Apellido</Label>
                        {isPersonalFieldEditable ? (
                          <Input
                            value={portalSelfSecondLastName}
                            onChange={(e) => setPortalSelfSecondLastName(e.target.value)}
                            placeholder="Ej: García"
                          />
                        ) : (
                          <Input readOnly className={cn(portalReadonlyFieldClass)} value={portalFieldDisplay(portalPersonal.second_last_name)} />
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                      <div className="space-y-2">
                        <Label>Tipo de documento</Label>
                        {isPersonalFieldEditable ? (
                          <Select value={portalSelfDocumentType} onValueChange={setPortalSelfDocumentType}>
                            <SelectTrigger>
                              <SelectValue placeholder="Seleccionar" />
                            </SelectTrigger>
                            <SelectContent>
                              {portalDocumentTypes.map((docType) => (
                                <SelectItem key={docType.value} value={docType.value}>
                                  {docType.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input
                            readOnly
                            className={cn(portalReadonlyFieldClass)}
                            value={
                              portalDocumentTypes.find((docType) => docType.value === portalPersonal.document_type)?.label ??
                              portalFieldDisplay(portalPersonal.document_type)
                            }
                          />
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label>DNI</Label>
                        {isPersonalFieldEditable ? (
                          <Input
                            maxLength={16}
                            value={portalSelfDni}
                            onChange={(e) => setPortalSelfDni(e.target.value)}
                            placeholder="Ej: 72345678"
                            autoComplete="off"
                          />
                        ) : (
                          <Input readOnly className={cn(portalReadonlyFieldClass)} value={displayEmployeeDni(portalPersonal.dni)} />
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label>Código interno</Label>
                        {isPersonalFieldEditable ? (
                          <Input
                            value={portalSelfEmployeeCode}
                            onChange={(e) => setPortalSelfEmployeeCode(e.target.value)}
                            placeholder="Ej: EMP-001"
                          />
                        ) : (
                          <Input
                            readOnly
                            className={cn(portalReadonlyFieldClass)}
                            value={portalFieldDisplay(portalPersonal.employee_code)}
                          />
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label>Fecha de nacimiento</Label>
                        {isPersonalFieldEditable ? (
                          <Input type="date" value={portalSelfBirthDate} onChange={(e) => setPortalSelfBirthDate(e.target.value)} />
                        ) : (
                          <Input
                            readOnly
                            className={cn(portalReadonlyFieldClass)}
                            value={portalPersonal.birth_date ? formatAppDate(portalPersonal.birth_date) : ""}
                            placeholder="—"
                          />
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label>Nivel de estudios</Label>
                        {isPersonalFieldEditable ? (
                          <Select value={portalSelfEducation || undefined} onValueChange={(v) => setPortalSelfEducation(v)}>
                            <SelectTrigger>
                              <SelectValue placeholder="Seleccionar" />
                            </SelectTrigger>
                            <SelectContent>
                              {portalCatalogExtra(portalSelfEducation, portalEducationCatalog)}
                              {portalEducationCatalog.map((x) => (
                                <SelectItem key={x} value={x}>
                                  {x}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input readOnly className={cn(portalReadonlyFieldClass)} value={portalFieldDisplay(portalPersonal.education_level)} />
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label>Carrera / Especialidad</Label>
                        {isPersonalFieldEditable ? (
                          <Input
                            value={portalSelfDegree}
                            onChange={(e) => setPortalSelfDegree(e.target.value)}
                            placeholder="Ej: Ing. Sistemas"
                          />
                        ) : (
                          <Input readOnly className={cn(portalReadonlyFieldClass)} value={portalFieldDisplay(portalPersonal.degree)} />
                        )}
                      </div>
                    </div>
                    {isPersonalFieldEditable ? (
                      <p className="text-xs text-muted-foreground">
                        Los cambios de esta sección se guardan con el botón <span className="font-medium text-foreground">Guardar cambios</span>{" "}
                        al final de la página.
                      </p>
                    ) : null}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                      {portalPersonalPdfSlots.map((slot) => {
                        const doc = portalDocByType.get(slot.type);
                        const pdfKey = slot.type as PortalSelfPdfKey;
                        const pendingFile = isPersonalFieldEditable ? portalSelfPdfFiles[pdfKey] : null;
                        return (
                          <div key={slot.type} className="space-y-2">
                            <Label>{slot.label}</Label>
                            {doc ? (
                              <EmployeeDocumentActionBar
                                filename={doc.filename}
                                busy={portalEmployeeDocActionId === doc.id}
                                canDelete={isPersonalFieldEditable}
                                onView={() => void handleViewPortalEmployeeDocument(doc)}
                                onDownload={() => void handleDownloadPortalEmployeeDocument(doc)}
                                onDelete={() => void handleDeletePortalEmployeeDocument(doc, slot.label)}
                              />
                            ) : (
                              <p className="text-sm text-muted-foreground">Sin archivo registrado.</p>
                            )}
                            {isPersonalFieldEditable ? (
                              <PendingPdfFileInput
                                pendingFile={pendingFile}
                                onFileSelect={handlePortalSelfPdfFileSelect(pdfKey, slot.label)}
                                inputClassName="text-xs h-auto py-2"
                              />
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              ) : null}

              <Card className="shadow-card">
                <CardHeader>
                  <CardTitle className="text-lg">Datos de Contacto</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="portal-corporate-email">Correo corporativo</Label>
                      <Input
                        id="portal-corporate-email"
                        type="email"
                        readOnly
                        tabIndex={-1}
                        value={corporateEmail}
                        placeholder="—"
                        className={cn("bg-muted", "pointer-events-none select-none")}
                      />
                      <p className="text-xs text-muted-foreground">
                        Proviene de la cuenta de usuario del colaborador. La ficha se crea o enlaza al iniciar sesión por primera vez.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="portal-phone">Teléfono</Label>
                      {isDatosFieldEditable ? (
                        <Input
                          id="portal-phone"
                          type="tel"
                          autoComplete="tel"
                          placeholder="Ej: 987654321"
                          value={contactPhone}
                          onChange={e => setContactPhone(e.target.value)}
                          maxLength={50}
                        />
                      ) : (
                        <Input
                          id="portal-phone"
                          readOnly
                          className={cn(portalReadonlyFieldClass)}
                          value={portalFieldDisplay(contactPhone)}
                          placeholder="—"
                        />
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="portal-address">Dirección</Label>
                      {isDatosFieldEditable ? (
                        <Input
                          id="portal-address"
                          autoComplete="street-address"
                          placeholder="Ej: Av. Principal 123, Lima"
                          value={contactAddress}
                          onChange={e => setContactAddress(e.target.value)}
                        />
                      ) : (
                        <Input
                          id="portal-address"
                          readOnly
                          className={cn(portalReadonlyFieldClass)}
                          value={portalFieldDisplay(contactAddress)}
                          placeholder="—"
                        />
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="portal-personal-email">Correo Personal</Label>
                      {isDatosFieldEditable ? (
                        <Input
                          id="portal-personal-email"
                          type="email"
                          autoComplete="email"
                          placeholder="Ej: correo.personal@gmail.com"
                          value={contactPersonalEmail}
                          onChange={e => setContactPersonalEmail(e.target.value)}
                        />
                      ) : (
                        <Input
                          id="portal-personal-email"
                          readOnly
                          className={cn(portalReadonlyFieldClass)}
                          value={portalFieldDisplay(contactPersonalEmail)}
                          placeholder="—"
                        />
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="portal-emergency-phone">Teléfono de emergencia</Label>
                      {isDatosFieldEditable ? (
                        <Input
                          id="portal-emergency-phone"
                          type="tel"
                          placeholder="Ej: 912345678"
                          value={contactEmergencyPhone}
                          onChange={e => setContactEmergencyPhone(e.target.value)}
                          maxLength={50}
                        />
                      ) : (
                        <Input
                          id="portal-emergency-phone"
                          readOnly
                          className={cn(portalReadonlyFieldClass)}
                          value={portalFieldDisplay(contactEmergencyPhone)}
                          placeholder="—"
                        />
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="shadow-card">
                <CardHeader>
                  <CardTitle className="text-lg">Datos Bancarios y Previsionales</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="space-y-2">
                      <Label>Banco</Label>
                      {isDatosFieldEditable ? (
                        <Select value={bank} onValueChange={setBank}>
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccionar banco" />
                          </SelectTrigger>
                          <SelectContent>
                            {portalCatalogExtra(bank, portalBankCatalog)}
                            {portalBankCatalog.map(b => (
                              <SelectItem key={b} value={b}>
                                {b}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input readOnly className={cn(portalReadonlyFieldClass)} value={portalFieldDisplay(bank)} placeholder="—" />
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="portal-bank-account">Número de cuenta</Label>
                      {isDatosFieldEditable ? (
                        <Input
                          id="portal-bank-account"
                          placeholder="Ej: 19112345678901"
                          value={bankAccount}
                          onChange={e => setBankAccount(e.target.value)}
                        />
                      ) : (
                        <Input
                          id="portal-bank-account"
                          readOnly
                          className={cn(portalReadonlyFieldClass)}
                          value={portalFieldDisplay(bankAccount)}
                          placeholder="—"
                        />
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="portal-bank-account-cci">Número de cuenta interbancaria (CCI)</Label>
                      {isDatosFieldEditable ? (
                        <Input
                          id="portal-bank-account-cci"
                          placeholder="Ej: 00219112345678901234"
                          inputMode="numeric"
                          maxLength={20}
                          value={bankAccountCci}
                          onChange={e => setBankAccountCci(e.target.value.replace(/\D/g, "").slice(0, 20))}
                        />
                      ) : (
                        <Input
                          id="portal-bank-account-cci"
                          readOnly
                          className={cn(portalReadonlyFieldClass)}
                          value={portalFieldDisplay(bankAccountCci)}
                          placeholder="—"
                        />
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label>Sistema previsional</Label>
                      {isDatosFieldEditable ? (
                        <Select value={pensionFund} onValueChange={setPensionFund}>
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccionar" />
                          </SelectTrigger>
                          <SelectContent>
                            {portalCatalogExtra(pensionFund, portalPensionCatalog)}
                            {portalPensionCatalog.map(p => (
                              <SelectItem key={p} value={p}>
                                {p}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input readOnly className={cn(portalReadonlyFieldClass)} value={portalFieldDisplay(pensionFund)} placeholder="—" />
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label>Aporte aplicable en boleta</Label>
                      {isDatosFieldEditable ? (
                        <Select value={employerContributionOption} onValueChange={setEmployerContributionOption}>
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccionar" />
                          </SelectTrigger>
                          <SelectContent>
                            {portalEmployerContributionOptionCatalog.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          readOnly
                          className={cn(portalReadonlyFieldClass)}
                          value={
                            portalEmployerContributionOptionCatalog.find((option) => option.value === employerContributionOption)
                              ?.label ?? "Ninguna"
                          }
                          placeholder="—"
                        />
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label>CUSPP</Label>
                      {isPersonalFieldEditable ? (
                        <Input
                          placeholder="Ej: 123456ABCDEF"
                          value={portalSelfCuspp}
                          onChange={(e) => setPortalSelfCuspp(e.target.value.toUpperCase())}
                        />
                      ) : (
                        <Input readOnly className={cn(portalReadonlyFieldClass)} value={portalFieldDisplay(portalSelfCuspp)} placeholder="—" />
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label>Número de dependientes</Label>
                      {isPersonalFieldEditable ? (
                        <Input
                          type="number"
                          min={0}
                          max={20}
                          value={portalSelfDependentsCount}
                          onChange={(e) => {
                            const cleaned = e.target.value.replace(/\D/g, "").slice(0, 2);
                            if (cleaned === "") {
                              setPortalSelfDependentsCount("");
                              return;
                            }
                            const numeric = Number.parseInt(cleaned, 10);
                            if (Number.isNaN(numeric)) {
                              setPortalSelfDependentsCount("");
                              return;
                            }
                            setPortalSelfDependentsCount(String(Math.min(20, numeric)));
                          }}
                        />
                      ) : (
                        <Input
                          readOnly
                          className={cn(portalReadonlyFieldClass)}
                          value={portalFieldDisplay(
                            portalSelfDependentsCount.trim() !== "" ? portalSelfDependentsCount : null,
                          )}
                          placeholder="—"
                        />
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label>Asignación familiar</Label>
                      {isPersonalFieldEditable ? (
                        <Select
                          value={portalSelfHasFamilyAllowance ? "yes" : "no"}
                          onValueChange={(value) => setPortalSelfHasFamilyAllowance(value === "yes")}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Seleccionar" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="yes">Sí</SelectItem>
                            <SelectItem value="no">No</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          readOnly
                          className={cn(portalReadonlyFieldClass)}
                          value={portalSelfHasFamilyAllowance ? "Sí" : "No"}
                        />
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {portalWork ? (
                <Card className="shadow-card">
                  <CardHeader>
                    <CardTitle className="text-lg">Datos Laborales</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label>Área</Label>
                        <Input readOnly className={cn(portalReadonlyFieldClass)} value={portalFieldDisplay(portalWork.department_name)} />
                      </div>
                      <div className="space-y-2">
                        <Label>Puesto</Label>
                        <Input readOnly className={cn(portalReadonlyFieldClass)} value={portalFieldDisplay(portalWork.position)} />
                      </div>
                      <div className="space-y-2">
                        <Label>Modalidad</Label>
                        <Input
                          readOnly
                          className={cn(portalReadonlyFieldClass)}
                          value={portalFieldDisplay(formatEmployeeModalityDisplay(portalWork.modality))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Tipo de contrato</Label>
                        <Input readOnly className={cn(portalReadonlyFieldClass)} value={portalFieldDisplay(portalWork.contract_type)} />
                      </div>
                      <div className="space-y-2">
                        <Label>Fecha de inicio</Label>
                        <Input
                          readOnly
                          className={cn(portalReadonlyFieldClass)}
                          value={portalWork.contract_start ? formatAppDate(portalWork.contract_start) : ""}
                          placeholder="—"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Fecha fin de contrato</Label>
                        <Input
                          readOnly
                          className={cn(portalReadonlyFieldClass)}
                          value={portalWork.contract_end ? formatAppDate(portalWork.contract_end) : ""}
                          placeholder="—"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Jefe directo</Label>
                        <Input readOnly className={cn(portalReadonlyFieldClass)} value={portalManagerLabel(portalWork.manager_name)} />
                      </div>
                      <div className="space-y-2">
                        <Label>Estado</Label>
                        <Input
                          readOnly
                          className={cn(portalReadonlyFieldClass)}
                          value={portalWork.status ? portalEmployeeStatusLabel(portalWork.status) : ""}
                          placeholder="—"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Contrato (PDF)</Label>
                        {portalContractDoc ? (
                          <EmployeeDocumentActionBar
                            filename={portalContractDoc.filename}
                            busy={portalEmployeeDocActionId === portalContractDoc.id}
                            canDelete={false}
                            onView={() => void handleViewPortalEmployeeDocument(portalContractDoc)}
                            onDownload={() => void handleDownloadPortalEmployeeDocument(portalContractDoc)}
                          />
                        ) : (
                          <p className="text-sm text-muted-foreground">Sin archivo registrado.</p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ) : null}

              {isDatosEditing ? (
                <Button type="button" onClick={() => void handleSaveContact()} disabled={contactSaving}>
                  {contactSaving ? "Guardando…" : "Guardar cambios"}
                </Button>
              ) : null}
            </>
          )}
        </TabsContent>

        <TabsContent value="asistencia" className="mt-4">
          <Card className="shadow-card">
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle className="text-base">Mi Asistencia — {attendancePeriod.title}</CardTitle>
                <div className="flex flex-wrap gap-2 items-center">
                  <Select
                    value={String(portalAttYear)}
                    onValueChange={(v) => setPortalAttYear(Number(v))}
                    disabled={!hasEmployee || attendanceLoading}
                  >
                    <SelectTrigger className="w-[7.5rem]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {portalCalYears.map((y) => (
                        <SelectItem key={y} value={String(y)}>
                          {y}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={String(portalAttMonthIndex)}
                    onValueChange={(v) => setPortalAttMonthIndex(Number(v))}
                    disabled={!hasEmployee || attendanceLoading}
                  >
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {portalCalMeses.map((m, i) => (
                        <SelectItem key={m} value={String(i)}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {attendanceLoading ? (
                <p className="text-sm text-muted-foreground">Cargando…</p>
              ) : attendanceError ? (
                <div className="space-y-3">
                  <p className="text-sm text-destructive">{attendanceError}</p>
                  <Button size="sm" variant="outline" type="button" onClick={() => loadAttendance()}>
                    Reintentar
                  </Button>
                </div>
              ) : !hasEmployee ? (
                <p className="text-sm text-muted-foreground">{emptyStateNoEmployeeMessage}</p>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    Resumen según registros del sistema para el mes seleccionado (no incluye horas extra ni conceptos no
                    modelados en asistencia).
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-4">
                    {(
                      [
                        ["Días asistidos", String(attendanceStats.asistidos)],
                        ["Faltas", String(attendanceStats.faltas)],
                        ["Tardanzas", String(attendanceStats.tardanzas)],
                        ["Vacaciones", String(attendanceStats.vacaciones)],
                        ["Otros registros", String(attendanceStats.otros)],
                      ] as const
                    ).map(([l, v]) => (
                      <div key={l} className="text-center p-3 bg-muted rounded-lg">
                        <p className="text-2xl font-bold">{v}</p>
                        <p className="text-xs text-muted-foreground mt-1">{l}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-6 space-y-3 border-t border-border pt-4">
                    <p className="text-sm font-medium">Calendario del mes</p>
                    <div className="grid grid-cols-7 gap-1.5">
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
                      {Array.from({ length: portalCalFirstBlank }).map((_, i) => (
                        <div key={`blank-${i}`} />
                      ))}
                      {portalCalDays.map(({ day, status }) => {
                        const isWeekendCell = isWeekendYmd(portalAttYear, portalAttMonthIndex, day);
                        const empty = status === "__none__";
                        const cls = portalCalendarStatusColors[status] ?? "bg-muted";
                        const cellClass = cn(
                          "aspect-square rounded-md flex items-center justify-center text-xs font-medium min-w-0 w-full",
                          isWeekendCell
                            ? "bg-zinc-600 text-zinc-100 dark:bg-zinc-800 dark:text-zinc-200 pointer-events-none select-none"
                            : cls,
                          !isWeekendCell && (empty ? "text-muted-foreground" : "text-primary-foreground"),
                        );
                        if (isWeekendCell) {
                          return (
                            <div key={day} className={cellClass} title="Día no laborable (fin de semana)">
                              {day}
                            </div>
                          );
                        }
                        return (
                          <button
                            key={day}
                            type="button"
                            disabled={attendanceLoading}
                            title={empty ? "Sin registro — ver detalle" : "Ver detalle del día"}
                            className={cn(
                              cellClass,
                              !attendanceLoading &&
                                "cursor-pointer hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                              attendanceLoading && "cursor-wait opacity-70",
                            )}
                            onClick={() => handlePortalCalendarDayClick(day)}
                          >
                            {day}
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex flex-wrap gap-3 text-xs">
                      {portalCalLegend.map((item) => (
                        <span key={item.status} className="flex items-center gap-1.5">
                          <span
                            className={cn(
                              "w-3 h-3 rounded shrink-0",
                              portalCalendarStatusColors[item.status] ?? "bg-muted",
                            )}
                          />
                          {item.label}
                        </span>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Clic en un día laborable para ver entrada, salida y horas. Puedes justificar tardanzas y faltas con
                      comentario o archivo adjunto.
                    </p>
                  </div>
                  {attendanceRecords.length > 0 ? (
                    <div className="mt-6 border-t border-border pt-4 overflow-x-auto">
                      <p className="text-sm font-medium mb-2">Registros del mes</p>
                      <table className="w-full text-xs min-w-[480px]">
                        <thead>
                          <tr className="border-b border-border bg-muted/50">
                            <th className="text-left font-semibold text-muted-foreground px-2 py-2">Fecha</th>
                            <th className="text-left font-semibold text-muted-foreground px-2 py-2">Estado</th>
                            <th className="text-left font-semibold text-muted-foreground px-2 py-2">Entrada</th>
                            <th className="text-left font-semibold text-muted-foreground px-2 py-2">Salida</th>
                            <th className="text-left font-semibold text-muted-foreground px-2 py-2">Horas</th>
                          </tr>
                        </thead>
                        <tbody>
                          {attendanceRecords
                            .slice()
                            .sort((a, b) => a.record_date.localeCompare(b.record_date))
                            .map((r) => (
                              <tr key={r.id} className="border-b border-border last:border-0">
                                <td className="px-2 py-2 tabular-nums">{formatAppDate(r.record_date)}</td>
                                <td className="px-2 py-2">{portalAttendanceStatusLabel(r.status)}</td>
                                <td className="px-2 py-2 tabular-nums">{r.check_in ?? "—"}</td>
                                <td className="px-2 py-2 tabular-nums">{r.check_out ?? "—"}</td>
                                <td className="px-2 py-2 tabular-nums">
                                  {formatDecimalHoursAsDuration(r.hours_worked)}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground mt-6 border-t border-border pt-4">
                      No hay registros de asistencia en el mes.
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="boletas" className="mt-4">
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-base">Mis Boletas de Pago</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {payslipLoading ? (
                <p className="text-sm text-muted-foreground px-5 py-8">Cargando…</p>
              ) : payslipError ? (
                <div className="px-5 py-8 space-y-3">
                  <p className="text-sm text-destructive">{payslipError}</p>
                  <Button size="sm" variant="outline" type="button" onClick={() => loadPayslips()}>
                    Reintentar
                  </Button>
                </div>
              ) : !hasEmployee ? (
                <p className="text-sm text-muted-foreground px-5 py-8">{emptyStateNoEmployeeMessage}</p>
              ) : payslips.length === 0 ? (
                <p className="text-sm text-muted-foreground px-5 py-8">No hay boletas registradas para tu ficha.</p>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="text-left text-xs font-semibold text-muted-foreground px-5 py-3">Periodo</th>
                      <th className="text-left text-xs font-semibold text-muted-foreground px-5 py-3">Neto</th>
                      <th className="text-left text-xs font-semibold text-muted-foreground px-5 py-3">Estado</th>
                      <th className="text-right text-xs font-semibold text-muted-foreground px-5 py-3 w-[1%]">PDF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payslips.map(b => (
                      <tr key={b.id} className="border-b border-border last:border-0">
                        <td className="px-5 py-3 text-sm font-medium">{payslipPeriodLabel(b)}</td>
                        <td className="px-5 py-3 text-sm">{formatPen(b.net_amount)}</td>
                        <td className="px-5 py-3">
                          <Badge
                            variant={b.status === "aprobada" ? "default" : "secondary"}
                            className={
                              b.status === "aprobada"
                                ? "text-xs bg-emerald-600 hover:bg-emerald-600 text-white border-transparent"
                                : "text-xs"
                            }
                          >
                            {payslipStatusLabel(b.status)}
                          </Badge>
                        </td>
                        <td className="px-5 py-3 text-right whitespace-nowrap">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs text-primary gap-1 h-8 px-2"
                            type="button"
                            disabled={b.status !== "aprobada" || payslipPdfDownloadingId === b.id}
                            title="Descargar boleta en PDF"
                            onClick={() => void handleDownloadPayslipPdf(b)}
                          >
                            <Download className="w-3.5 h-3.5" />
                            {payslipPdfDownloadingId === b.id ? "Descargando…" : "Descargar"}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {!payslipLoading && !payslipError && hasEmployee && payslipMeta.total > 0 ? (
                <ListPaginationBar
                  page={payslipMeta.current_page}
                  lastPage={payslipMeta.last_page}
                  total={payslipMeta.total}
                  pageSize={payslipMeta.per_page}
                  loading={payslipLoading}
                  onPageChange={setPayslipPage}
                />
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="equipos" className="mt-4">
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-base">Equipos y activos en préstamo</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {portalAssetsLoading ? (
                <p className="text-sm text-muted-foreground px-5 py-8">Cargando…</p>
              ) : portalAssetsError ? (
                <div className="px-5 py-8 space-y-3">
                  <p className="text-sm text-destructive">{portalAssetsError}</p>
                  <Button size="sm" variant="outline" type="button" onClick={() => void loadPortalAssets()}>
                    Reintentar
                  </Button>
                </div>
              ) : !hasEmployee ? (
                <p className="text-sm text-muted-foreground px-5 py-8">{emptyStateNoEmployeeMessage}</p>
              ) : portalAssets.length === 0 ? (
                <p className="text-sm text-muted-foreground px-5 py-8">
                  No tienes equipos o activos asignados en préstamo en este momento.
                </p>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="text-left text-xs font-semibold text-muted-foreground px-5 py-3">Tipo</th>
                      <th className="text-left text-xs font-semibold text-muted-foreground px-5 py-3">Descripción</th>
                      <th className="text-left text-xs font-semibold text-muted-foreground px-5 py-3">Asignación</th>
                      <th className="text-left text-xs font-semibold text-muted-foreground px-5 py-3">Estado</th>
                      <th className="text-right text-xs font-semibold text-muted-foreground px-5 py-3 w-[1%]">Acta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portalAssets.map(a => (
                      <tr key={a.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                        <td className="px-5 py-3 text-sm font-medium">{a.type}</td>
                        <td className="px-5 py-3 text-sm">{portalAssetDescription(a)}</td>
                        <td className="px-5 py-3 text-sm text-muted-foreground">
                          {formatPortalAssetAssignedDate(a.assigned_at)}
                        </td>
                        <td className="px-5 py-3">
                          <Badge variant={portalAssetEstadoVariant[a.status] ?? "secondary"} className="text-xs">
                            {a.status}
                          </Badge>
                        </td>
                        <td className="px-5 py-3 text-right whitespace-nowrap">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs text-primary gap-1 h-8 px-2"
                            type="button"
                            disabled={!a.has_loan_act || portalLoanActDownloadingId === a.id}
                            title={
                              a.has_loan_act ? "Descargar acta de préstamo (PDF)" : "No hay acta de préstamo cargada"
                            }
                            onClick={() => void handleDownloadPortalLoanAct(a)}
                          >
                            <Download className="w-3.5 h-3.5" />
                            {portalLoanActDownloadingId === a.id ? "Descargando…" : "PDF"}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {!portalAssetsLoading && !portalAssetsError && hasEmployee && portalAssetsMeta.total > 0 ? (
                <ListPaginationBar
                  page={portalAssetsMeta.current_page}
                  lastPage={portalAssetsMeta.last_page}
                  total={portalAssetsMeta.total}
                  pageSize={portalAssetsMeta.per_page}
                  loading={portalAssetsLoading}
                  onPageChange={setAssetsPage}
                />
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="solicitudes" className="mt-4">
          <Card className="shadow-card">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Vacaciones</CardTitle>
              <Button
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  resetVacationForm();
                  setShowNuevaSolicitud(true);
                }}
                disabled={!hasEmployee}
              >
                Nueva solicitud
              </Button>
            </CardHeader>
            {hasEmployee ? (
              <div className="px-5 py-3 border-b border-border bg-muted/20 text-sm space-y-1">
                {vacationBalanceLoading ? (
                  <p className="text-muted-foreground">Cargando saldo de vacaciones…</p>
                ) : vacationBalanceError ? (
                  <div className="space-y-2">
                    <p className="text-destructive text-xs">{vacationBalanceError}</p>
                    <Button size="sm" variant="outline" type="button" onClick={() => loadVacationBalance()}>
                      Reintentar
                    </Button>
                  </div>
                ) : vacationBalance ? (
                  <>
                    <p className="font-medium">Saldo de vacaciones ({vacationBalance.year})</p>
                    <p className="text-xs text-muted-foreground">
                      Tope anual: {vacationBalance.annual_days} · Usados (aprobados): {vacationBalance.days_used} ·
                      Pendientes: {vacationBalance.days_pending} · Disponibles: {vacationBalance.days_available}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Cálculo por año calendario; sin arrastre de saldos entre años en esta versión.
                    </p>
                  </>
                ) : null}
              </div>
            ) : null}
            <CardContent className="p-0">
              {vacationLoading ? (
                <p className="text-sm text-muted-foreground px-5 py-8">Cargando…</p>
              ) : vacationError ? (
                <div className="px-5 py-8 space-y-3">
                  <p className="text-sm text-destructive">{vacationError}</p>
                  <Button size="sm" variant="outline" type="button" onClick={() => loadVacations()}>
                    Reintentar
                  </Button>
                </div>
              ) : !hasEmployee ? (
                <p className="text-sm text-muted-foreground px-5 py-8">{emptyStateNoEmployeeMessage}</p>
              ) : vacations.length === 0 ? (
                <p className="text-sm text-muted-foreground px-5 py-8">No hay solicitudes de vacaciones registradas.</p>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="text-left text-xs font-semibold text-muted-foreground px-5 py-3">Tipo</th>
                      <th className="text-left text-xs font-semibold text-muted-foreground px-5 py-3">Fechas</th>
                      <th className="text-left text-xs font-semibold text-muted-foreground px-5 py-3">Estado</th>
                      <th className="text-right text-xs font-semibold text-muted-foreground px-5 py-3 w-[1%]">
                        Acciones
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {vacations.map(v => (
                      <tr key={v.id} className="border-b border-border last:border-0">
                        <td className="px-5 py-3 text-sm font-medium">Vacaciones</td>
                        <td className="px-5 py-3 text-sm">
                          {formatAppDate(v.start_date)} — {formatAppDate(v.end_date)} ({v.days} días)
                        </td>
                        <td className="px-5 py-3">
                          <Badge variant={vacationStatusBadgeVariant(v.status)} className="text-xs">
                            {vacationStatusLabel(v.status)}
                          </Badge>
                        </td>
                        <td className="px-5 py-3 text-right whitespace-nowrap">
                          {v.status === "pendiente" ? (
                            <div className="inline-flex gap-1 justify-end">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                title="Editar"
                                onClick={() => openEditVacation(v)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                title="Eliminar"
                                onClick={() => setVacationToDeleteId(v.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {!vacationLoading && !vacationError && hasEmployee && vacationMeta.total > 0 ? (
                <ListPaginationBar
                  page={vacationMeta.current_page}
                  lastPage={vacationMeta.last_page}
                  total={vacationMeta.total}
                  pageSize={vacationMeta.per_page}
                  loading={vacationLoading}
                  onPageChange={setVacationPage}
                />
              ) : null}
            </CardContent>
          </Card>

          <Card className="shadow-card mt-4">
            <CardHeader>
              <CardTitle className="text-base">Renuncia</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Puedes adjuntar tu carta de renuncia en PDF. Si indicas fecha de último día laborable, aplica un preaviso
                mínimo de {RESIGNATION_MIN_NOTICE_DAYS} días. Recursos Humanos revisará la solicitud; la desvinculación
                formal (cese en planilla, liquidación, etc.) se gestiona aparte cuando RRHH lo confirme en el sistema.
              </p>
              {!hasEmployee ? (
                <p className="text-sm text-muted-foreground">{emptyStateNoEmployeeMessage}</p>
              ) : (
                <>
                  {hasPendingResignation ? (
                    <p className="text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800 rounded-md px-3 py-2">
                      Tienes una solicitud de renuncia pendiente de revisión por RRHH. Puedes editarla o anularla desde
                      el historial si necesitas corregir algo; no puedes enviar otra nueva hasta que sea resuelta.
                    </p>
                  ) : (
                    <div className="space-y-3 max-w-lg">
                      <div className="space-y-1.5">
                        <Label htmlFor="resignation-pdf">Carta de renuncia (PDF, máx. 5 MB)</Label>
                        <Input
                          id="resignation-pdf"
                          ref={resignationFileInputRef}
                          type="file"
                          accept=".pdf,application/pdf"
                          className="cursor-pointer"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="resignation-date">Fecha propuesta de último día laborable (opcional)</Label>
                        <Input
                          id="resignation-date"
                          type="date"
                          min={resignationProposedMinIso()}
                          value={proposedResignationDate}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (!v || v >= resignationProposedMinIso()) {
                              setProposedResignationDate(v);
                            }
                          }}
                        />
                        <p className="text-xs text-muted-foreground">
                          Solo fechas a partir de {format(addDays(new Date(), RESIGNATION_MIN_NOTICE_DAYS), "dd/MM/yyyy")}{" "}
                          (hoy + {RESIGNATION_MIN_NOTICE_DAYS} días). Puedes dejar el campo vacío.
                        </p>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="resignation-notes">Comentario para RRHH (opcional)</Label>
                        <Textarea
                          id="resignation-notes"
                          value={resignationNotesText}
                          onChange={e => setResignationNotesText(e.target.value)}
                          rows={3}
                          placeholder="Ej. motivo breve, periodo de preaviso…"
                        />
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        disabled={submittingResignation}
                        onClick={() => void handleSubmitResignation()}
                      >
                        {submittingResignation ? "Enviando…" : "Enviar carta"}
                      </Button>
                    </div>
                  )}

                  {resignationLoading ? (
                    <p className="text-sm text-muted-foreground">Cargando historial de renuncias…</p>
                  ) : resignationError ? (
                    <div className="space-y-2">
                      <p className="text-sm text-destructive">{resignationError}</p>
                      <Button size="sm" variant="outline" type="button" onClick={() => void loadResignations()}>
                        Reintentar
                      </Button>
                    </div>
                  ) : resignations.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Aún no registras solicitudes de renuncia enviadas.</p>
                  ) : (
                    <div className="border border-border rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border bg-muted/50">
                            <th className="text-left text-xs font-semibold text-muted-foreground px-3 py-2">
                              Fecha propuesta
                            </th>
                            <th className="text-left text-xs font-semibold text-muted-foreground px-3 py-2">Estado</th>
                            <th className="text-left text-xs font-semibold text-muted-foreground px-3 py-2">Detalle</th>
                            <th className="text-right text-xs font-semibold text-muted-foreground px-3 py-2 w-[1%]">
                              Acciones
                            </th>
                            <th className="text-right text-xs font-semibold text-muted-foreground px-3 py-2 w-[1%]">
                              Carta
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {resignations.map(r => (
                            <tr key={r.id} className="border-b border-border last:border-0">
                              <td className="px-3 py-2 tabular-nums">
                                {r.proposed_effective_date != null ? formatAppDate(r.proposed_effective_date) : "—"}
                              </td>
                              <td className="px-3 py-2">
                                <Badge
                                  variant={resignationStatusBadgeVariant(r.status)}
                                  className={
                                    r.status === "aprobada"
                                      ? "text-xs bg-emerald-600 hover:bg-emerald-600 text-white border-transparent"
                                      : "text-xs"
                                  }
                                >
                                  {resignationStatusLabel(r.status)}
                                </Badge>
                              </td>
                              <td className="px-3 py-2 text-xs text-muted-foreground max-w-[200px]">
                                {r.status === "rechazada" && r.rejection_reason ? (
                                  <span className="line-clamp-2">{r.rejection_reason}</span>
                                ) : r.notes ? (
                                  <span className="line-clamp-2">{r.notes}</span>
                                ) : (
                                  "—"
                                )}
                              </td>
                              <td className="px-3 py-2 text-right whitespace-nowrap">
                                {r.status === "pendiente" ? (
                                  <div className="inline-flex gap-1 justify-end">
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8"
                                      title="Editar"
                                      onClick={() => openResignationEdit(r)}
                                    >
                                      <Pencil className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8 text-destructive hover:text-destructive"
                                      title="Eliminar"
                                      onClick={() => setResignationToDeleteId(r.id)}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </div>
                                ) : (
                                  <span className="text-xs text-muted-foreground">—</span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-right whitespace-nowrap">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="text-xs text-primary gap-1 h-8 px-2"
                                  disabled={resignationLetterDownloadingId === r.id}
                                  onClick={() => void handleDownloadPortalResignationLetter(r)}
                                >
                                  <Download className="w-3.5 h-3.5" />
                                  {resignationLetterDownloadingId === r.id ? "…" : "PDF"}
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {!resignationLoading && !resignationError && hasEmployee && resignationMeta.total > 0 ? (
                    <ListPaginationBar
                      page={resignationMeta.current_page}
                      lastPage={resignationMeta.last_page}
                      total={resignationMeta.total}
                      pageSize={resignationMeta.per_page}
                      loading={resignationLoading}
                      onPageChange={setResignationPage}
                    />
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notificaciones" className="mt-4">
          <Card className="shadow-card">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-base">Notificaciones</CardTitle>
              {!notificationLoading &&
              !notificationError &&
              hasEmployee &&
              notifications.some(n => n.read_at == null) ? (
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  disabled={notificationMarkingAll}
                  onClick={() => void handleMarkAllNotificationsRead()}
                >
                  {notificationMarkingAll ? "Marcando…" : "Marcar todas como leídas"}
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="p-0">
              {notificationLoading ? (
                <p className="text-sm text-muted-foreground px-5 py-8">Cargando…</p>
              ) : notificationError ? (
                <div className="px-5 py-8 space-y-3">
                  <p className="text-sm text-destructive">{notificationError}</p>
                  <Button size="sm" variant="outline" type="button" onClick={() => void loadNotifications()}>
                    Reintentar
                  </Button>
                </div>
              ) : !hasEmployee ? (
                <p className="text-sm text-muted-foreground px-5 py-8">{emptyStateNoEmployeeMessage}</p>
              ) : notifications.length === 0 ? (
                <p className="text-sm text-muted-foreground px-5 py-8">No hay notificaciones para mostrar.</p>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="text-left text-xs font-semibold text-muted-foreground px-5 py-3">Fecha</th>
                      <th className="text-left text-xs font-semibold text-muted-foreground px-5 py-3">Título</th>
                      <th className="text-left text-xs font-semibold text-muted-foreground px-5 py-3">Mensaje</th>
                      <th className="text-right text-xs font-semibold text-muted-foreground px-5 py-3 w-[1%]">
                        Acción
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {notifications.map(n => {
                      const unread = n.read_at == null;
                      return (
                        <tr
                          key={n.id}
                          className={cn(
                            "border-b border-border last:border-0 align-top",
                            unread && "bg-muted/25",
                          )}
                        >
                          <td className="px-5 py-3 text-xs text-muted-foreground whitespace-nowrap">
                            {formatNotificationDate(n.created_at)}
                          </td>
                          <td
                            className={cn(
                              "px-5 py-3 text-sm max-w-[220px] break-words",
                              unread ? "font-semibold text-foreground" : "font-medium text-muted-foreground",
                            )}
                          >
                            {n.title}
                          </td>
                          <td
                            className={cn(
                              "px-5 py-3 text-sm",
                              unread ? "text-foreground/90" : "text-muted-foreground",
                            )}
                          >
                            {n.body?.trim() || "—"}
                          </td>
                          <td className="px-5 py-3 text-right whitespace-nowrap">
                            {unread ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                type="button"
                                className="text-xs h-8"
                                disabled={notificationMarkingId === n.id || notificationMarkingAll}
                                onClick={() => void handleMarkNotificationRead(n.id)}
                              >
                                {notificationMarkingId === n.id ? "…" : "Marcar leída"}
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">Leída</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              {!notificationLoading && !notificationError && hasEmployee && notificationMeta.total > 0 ? (
                <ListPaginationBar
                  page={notificationMeta.current_page}
                  lastPage={notificationMeta.last_page}
                  total={notificationMeta.total}
                  pageSize={notificationMeta.per_page}
                  loading={notificationLoading}
                  onPageChange={setNotificationPage}
                />
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog
        open={portalAttDayOpen}
        onOpenChange={(open) => {
          setPortalAttDayOpen(open);
          if (!open) {
            setPortalAttDayRecord(null);
            setPortalAttDayStatus(null);
            setPortalAttDayIso(null);
            setPortalJustificationDraft("");
            setPortalJustificationFile(null);
            if (portalJustificationFileInputRef.current) {
              portalJustificationFileInputRef.current.value = "";
            }
          }
        }}
      >
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{portalAttDayIso ? formatAppDate(portalAttDayIso) : "Asistencia"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            {!portalAttDayRecord ? (
              portalAttDayStatus === "vacaciones" ? (
                <p className="text-muted-foreground leading-relaxed">
                  Día de vacaciones aprobado. No requiere registro de asistencia adicional.
                </p>
              ) : (
                <p className="text-muted-foreground leading-relaxed">
                  No hay registro de asistencia para este día laborable.
                </p>
              )
            ) : (
              <>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs">
                  <dt className="text-muted-foreground">Estado</dt>
                  <dd className="font-medium">{portalAttendanceStatusLabel(portalAttDayRecord.status)}</dd>
                  <dt className="text-muted-foreground">Entrada</dt>
                  <dd className="tabular-nums">{portalAttDayRecord.check_in ?? "—"}</dd>
                  <dt className="text-muted-foreground">Salida</dt>
                  <dd className="tabular-nums">{portalAttDayRecord.check_out ?? "—"}</dd>
                  <dt className="text-muted-foreground">Horas</dt>
                  <dd className="tabular-nums">{formatDecimalHoursAsDuration(portalAttDayRecord.hours_worked)}</dd>
                </dl>
                {portalAttDayRecord.justification ? (
                  <div className="rounded-md bg-muted/50 p-3 text-xs">
                    <p className="text-muted-foreground mb-1">Comentario registrado</p>
                    <p className="whitespace-pre-wrap break-words">{portalAttDayRecord.justification}</p>
                  </div>
                ) : null}
                {portalAttDayRecord.has_justification_file ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => void handlePortalDownloadJustification()}
                  >
                    <Download className="w-3.5 h-3.5 mr-2" />
                    Descargar archivo adjunto
                  </Button>
                ) : null}
                {portalCanJustifyStatus(portalAttDayRecord.status) ? (
                  <div className="space-y-3 border-t border-border pt-3">
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {portalAttDayRecord.status === "tardanza_nj" || portalAttDayRecord.status === "falta_nj"
                        ? "Esta tardanza o falta aún no está justificada. Indica el motivo o adjunta un documento."
                        : "Puedes actualizar el comentario o reemplazar el archivo de justificación."}
                    </p>
                    <div className="space-y-2">
                      <Label htmlFor="portal-att-justify-text">Motivo / comentario</Label>
                      <Textarea
                        id="portal-att-justify-text"
                        rows={4}
                        value={portalJustificationDraft}
                        onChange={(e) => setPortalJustificationDraft(e.target.value)}
                        placeholder="Describe el motivo de la justificación…"
                        disabled={portalJustificationSaving}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="portal-att-justify-file">Archivo adjunto (opcional)</Label>
                      <Input
                        id="portal-att-justify-file"
                        ref={portalJustificationFileInputRef}
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
                        disabled={portalJustificationSaving}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          setPortalJustificationFile(f ?? null);
                        }}
                      />
                    </div>
                    <Button
                      type="button"
                      className="w-full"
                      disabled={portalJustificationSaving}
                      onClick={() => void submitPortalJustification()}
                    >
                      {portalJustificationSaving ? "Guardando…" : "Guardar justificación"}
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </div>
          <DialogFooter className="sm:justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setPortalAttDayOpen(false)}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showNuevaSolicitud}
        onOpenChange={open => {
          setShowNuevaSolicitud(open);
          if (!open) resetVacationForm();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingVacationId != null ? "Editar solicitud de vacaciones" : "Nueva solicitud de vacaciones"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <span className="text-sm font-medium">Fecha de inicio</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !fechaInicio && "text-muted-foreground",
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {fechaInicio ? formatAppDate(fechaInicio) : "Seleccionar fecha"}
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
              <span className="text-sm font-medium">Fecha de fin</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !fechaFin && "text-muted-foreground",
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {fechaFin ? formatAppDate(fechaFin) : "Seleccionar fecha"}
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
                  <Calendar
                    mode="single"
                    selected={fechaFin}
                    onSelect={setFechaFin}
                    initialFocus
                    className="pointer-events-auto"
                    disabled={date => (fechaInicio ? date < fechaInicio : false)}
                  />
                </PopoverContent>
              </Popover>
              {diasCalculados > 0 ? (
                <p className="text-sm text-muted-foreground">
                  Total: {diasCalculados} día{diasCalculados !== 1 ? "s" : ""}
                </p>
              ) : null}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNuevaSolicitud(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => void handleGuardarVacacion()}
              disabled={!fechaInicio || !fechaFin || diasCalculados < 1 || savingVacation}
            >
              {savingVacation
                ? editingVacationId != null
                  ? "Guardando…"
                  : "Enviando…"
                : editingVacationId != null
                  ? "Guardar cambios"
                  : "Enviar solicitud"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={resignationEditRow !== null}
        onOpenChange={open => {
          if (!open) {
            setResignationEditRow(null);
            if (resignationEditFileRef.current) resignationEditFileRef.current.value = "";
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Editar solicitud de renuncia</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="resignation-edit-date">Fecha propuesta de último día laborable (opcional)</Label>
              <Input
                id="resignation-edit-date"
                type="date"
                min={resignationProposedMinIso()}
                value={resignationEditDate}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v || v >= resignationProposedMinIso()) {
                    setResignationEditDate(v);
                  }
                }}
              />
              <p className="text-xs text-muted-foreground">
                Mínimo {RESIGNATION_MIN_NOTICE_DAYS} días de anticipación respecto a hoy. Deja vacío si no quieres fecha
                propuesta.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="resignation-edit-notes">Comentario para RRHH (opcional)</Label>
              <Textarea
                id="resignation-edit-notes"
                value={resignationEditNotes}
                onChange={e => setResignationEditNotes(e.target.value)}
                rows={3}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="resignation-edit-pdf">Reemplazar carta (PDF, máx. 5 MB, opcional)</Label>
              <Input
                id="resignation-edit-pdf"
                ref={resignationEditFileRef}
                type="file"
                accept=".pdf,application/pdf"
                className="cursor-pointer"
              />
              <p className="text-xs text-muted-foreground">Si no eliges archivo, se conserva el PDF ya enviado.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setResignationEditRow(null)}>
              Cancelar
            </Button>
            <Button type="button" disabled={resignationEditSaving} onClick={() => void handleSaveResignationEdit()}>
              {resignationEditSaving ? "Guardando…" : "Guardar cambios"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={vacationToDeleteId !== null} onOpenChange={open => !open && setVacationToDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Anular esta solicitud de vacaciones?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. Solo las solicitudes pendientes pueden eliminarse desde aquí.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={vacationDeleteLoading}>Cancelar</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={vacationDeleteLoading}
              onClick={() => void handleConfirmDeleteVacation()}
            >
              {vacationDeleteLoading ? "…" : "Eliminar"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={resignationToDeleteId !== null} onOpenChange={open => !open && setResignationToDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Anular esta solicitud de renuncia?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará la solicitud y el PDF adjunto. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resignationDeleteLoading}>Cancelar</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={resignationDeleteLoading}
              onClick={() => void handleConfirmDeleteResignation()}
            >
              {resignationDeleteLoading ? "…" : "Eliminar"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
