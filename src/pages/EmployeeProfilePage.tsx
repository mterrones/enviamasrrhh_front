import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Mail, Phone, MapPin, Calendar, Briefcase } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { ApiHttpError } from "@/api/client";
import { fetchDepartments } from "@/api/departments";
import {
  fetchEmployee,
  fetchEmployeeTermination,
  type Employee,
  type EmployeeTermination,
} from "@/api/employees";
import { fetchEmployeePhotoBlob } from "@/api/employeePhotos";
import {
  fetchEmployeeDocumentBlob,
  fetchEmployeeDocuments,
  type EmployeeDocument,
  type EmployeeDocumentType,
} from "@/api/employeeDocuments";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { formatEmployeeModalityDisplay } from "@/lib/employeeModalityCatalog";
import { formatEmployeeName } from "@/lib/employeeName";
import { visibleEmployeeDocuments } from "@/lib/employeeDocumentUi";
import { formatAppDate, formatAppDateTime, formatAppMonthYear } from "@/lib/formatAppDate";
import { displayEmployeeDni } from "@/lib/employeeDniDisplay";
import { cn } from "@/lib/utils";
import { EmployeeDocumentActionBar } from "@/components/EmployeeDocumentActionBar";
import { isWeekendYmd } from "@/lib/weekendAttendance";
import { fetchAllAttendanceInRange, type AttendanceRecord } from "@/api/attendance";
import {
  fetchPayrollPeriods,
  fetchAllPayslipsForEmployee,
  type Payslip,
  type PayrollPeriod,
} from "@/api/payroll";
import { fetchAllAssetsForEmployee, type Asset } from "@/api/assets";

function monthBounds(d: Date): { from: string; to: string; year: number; monthIndex: number } {
  const year = d.getFullYear();
  const monthIndex = d.getMonth();
  const pad = (n: number) => String(n).padStart(2, "0");
  const from = `${year}-${pad(monthIndex + 1)}-01`;
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const to = `${year}-${pad(monthIndex + 1)}-${pad(lastDay)}`;
  return { from, to, year, monthIndex };
}

function attendanceCellClass(status: string | undefined): string {
  if (!status) return "bg-muted text-muted-foreground";
  switch (status) {
    case "asistido":
    case "recuperacion":
      return "bg-success text-primary-foreground";
    case "falta_j":
    case "falta_nj":
      return "bg-destructive text-primary-foreground";
    case "tardanza_j":
    case "tardanza_nj":
      return "bg-warning text-primary-foreground";
    case "vacaciones":
      return "bg-info text-primary-foreground";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function formatAssetDescription(a: Asset): string {
  const parts = [a.brand, a.model].filter(Boolean);
  if (parts.length > 0) return parts.join(" ");
  if (a.description?.trim()) return a.description.trim();
  if (a.serial_number?.trim()) return a.serial_number.trim();
  return a.type;
}

function payslipPeriodLabel(p: Payslip, periodMap: Map<number, PayrollPeriod>): string {
  const per = periodMap.get(p.payroll_period_id);
  if (!per) return `Periodo #${p.payroll_period_id}`;
  return formatAppMonthYear(per.month, per.year);
}

const statusBadgeVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  activo: "default",
  suspendido: "secondary",
  cesado: "destructive",
  vacaciones: "outline",
};

const statusLabel: Record<string, string> = {
  activo: "Activo",
  suspendido: "Suspendido",
  cesado: "Cesado",
  vacaciones: "Vacaciones",
};

function initialsFromName(name: string): string {
  return name
    .split(/\s+/)
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function formatSalary(s?: string | null): string {
  if (s == null || s === "") return "—";
  const n = Number(s);
  if (Number.isNaN(n)) return `S/ ${s}`;
  return `S/ ${n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const documentTypeLabels: Record<EmployeeDocumentType, string> = {
  dni_scan: "Escaneo de DNI",
  antecedentes: "Antecedentes",
  cv: "CV",
  medical_exam: "Examen médico",
  contract: "Contrato",
  termination_certificate: "Certificado de cese",
};

function storageBasename(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i >= 0 ? path.slice(i + 1) : path;
}

export default function EmployeeProfilePage() {
  const { id } = useParams();
  const { toast } = useToast();
  const { hasPermission, user } = useAuth();
  const profileEmployeeId = id != null ? Number(id) : NaN;
  const isOwnProfile = user?.employee?.id != null && !Number.isNaN(profileEmployeeId) && user.employee.id === profileEmployeeId;
  const canHrEditEmployee = hasPermission("employees.edit");
  const canSelfServiceProfile = hasPermission("employees.self_edit") && isOwnProfile;
  const canEditProfile = canHrEditEmployee || canSelfServiceProfile;
  const canViewEmployeeDirectory = hasPermission("employees.view");
  const profileListHref = canViewEmployeeDirectory ? "/colaboradores" : user?.employee?.id != null ? `/colaboradores/${user.employee.id}` : "/portal";
  const profileListLabel = canViewEmployeeDirectory ? "Volver a colaboradores" : "Volver";
  const canViewAttendance = hasPermission("attendance.view");
  const canViewPayroll = hasPermission("payroll.view");
  const canViewAssets = hasPermission("assets.view");
  const canManageAssets = hasPermission("assets.manage");
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [deptName, setDeptName] = useState("—");
  const [managerName, setManagerName] = useState("—");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [documents, setDocuments] = useState<EmployeeDocument[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documentsError, setDocumentsError] = useState<string | null>(null);
  const [documentActionId, setDocumentActionId] = useState<number | null>(null);
  const [photoObjectUrl, setPhotoObjectUrl] = useState<string | null>(null);
  const photoObjectUrlRef = useRef<string | null>(null);

  const [attendanceRefMonth] = useState(() => new Date());
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [attendanceError, setAttendanceError] = useState<string | null>(null);

  const [payslipsRows, setPayslipsRows] = useState<Payslip[]>([]);
  const [payrollPeriodsById, setPayrollPeriodsById] = useState<Map<number, PayrollPeriod>>(new Map());
  const [payslipsLoading, setPayslipsLoading] = useState(false);
  const [payslipsError, setPayslipsError] = useState<string | null>(null);

  const [assetRows, setAssetRows] = useState<Asset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [assetsError, setAssetsError] = useState<string | null>(null);

  const [terminationLoading, setTerminationLoading] = useState(false);
  const [terminationError, setTerminationError] = useState<string | null>(null);
  const [terminationRecord, setTerminationRecord] = useState<EmployeeTermination | null>(null);

  const attendanceMonthMeta = useMemo(() => monthBounds(attendanceRefMonth), [attendanceRefMonth]);

  const attendanceByDate = useMemo(() => {
    const m = new Map<string, AttendanceRecord>();
    for (const r of attendanceRecords) {
      const key = typeof r.record_date === "string" ? r.record_date.slice(0, 10) : "";
      if (!key) continue;
      const prev = m.get(key);
      if (!prev || r.id > prev.id) m.set(key, r);
    }
    return m;
  }, [attendanceRecords]);

  const attendanceStats = useMemo(() => {
    let asist = 0;
    let falta = 0;
    let tard = 0;
    let vac = 0;
    for (const r of attendanceByDate.values()) {
      const s = r.status;
      if (s === "asistido" || s === "recuperacion") asist += 1;
      else if (s === "falta_j" || s === "falta_nj") falta += 1;
      else if (s === "tardanza_j" || s === "tardanza_nj") tard += 1;
      else if (s === "vacaciones") vac += 1;
    }
    return { asist, falta, tard, vac };
  }, [attendanceByDate]);

  const loadEmployeeDocuments = useCallback(async () => {
    if (!employee?.id) return;
    setDocumentsLoading(true);
    setDocumentsError(null);
    try {
      const res = await fetchEmployeeDocuments(employee.id);
      setDocuments(res.data);
    } catch (err) {
      const msg =
        err instanceof ApiHttpError ? err.apiError?.message ?? err.message : "No se pudieron cargar los documentos";
      setDocumentsError(typeof msg === "string" ? msg : "Error");
      setDocuments([]);
    } finally {
      setDocumentsLoading(false);
    }
  }, [employee?.id]);

  const visibleDocuments = useMemo(() => visibleEmployeeDocuments(documents), [documents]);

  useEffect(() => {
    if (!employee?.id) return;
    loadEmployeeDocuments();
  }, [employee?.id, loadEmployeeDocuments]);

  useEffect(() => {
    if (!employee?.id) return undefined;

    let cancelled = false;

    const clearPhoto = () => {
      if (photoObjectUrlRef.current) {
        URL.revokeObjectURL(photoObjectUrlRef.current);
        photoObjectUrlRef.current = null;
      }
      setPhotoObjectUrl(null);
    };

    if (!employee.photo_path) {
      clearPhoto();
      return undefined;
    }

    (async () => {
      try {
        const blob = await fetchEmployeePhotoBlob(employee.id);
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        if (photoObjectUrlRef.current) {
          URL.revokeObjectURL(photoObjectUrlRef.current);
        }
        photoObjectUrlRef.current = url;
        setPhotoObjectUrl(url);
      } catch {
        if (!cancelled) {
          clearPhoto();
        }
      }
    })();

    return () => {
      cancelled = true;
      clearPhoto();
    };
  }, [employee?.id, employee?.photo_path]);

  const handleOpenDocument = async (d: EmployeeDocument) => {
    if (!employee) return;
    setDocumentActionId(d.id);
    try {
      const blob = await fetchEmployeeDocumentBlob(employee.id, d.id, { attachment: false });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      window.setTimeout(() => URL.revokeObjectURL(url), 3_600_000);
    } catch (err) {
      const msg =
        err instanceof ApiHttpError ? err.apiError?.message ?? err.message : "No se pudo abrir el archivo";
      toast({
        title: "Documento",
        description: typeof msg === "string" ? msg : "Intenta de nuevo",
        variant: "destructive",
      });
    } finally {
      setDocumentActionId(null);
    }
  };

  const handleDownloadDocument = async (d: EmployeeDocument) => {
    if (!employee) return;
    setDocumentActionId(d.id);
    try {
      const blob = await fetchEmployeeDocumentBlob(employee.id, d.id, { attachment: true });
      const url = URL.createObjectURL(blob);
      const a = window.document.createElement("a");
      a.href = url;
      a.download = storageBasename(d.file_path) || `${documentTypeLabels[d.type]}-${d.id}`;
      a.rel = "noopener";
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (err) {
      const msg =
        err instanceof ApiHttpError ? err.apiError?.message ?? err.message : "No se pudo descargar el archivo";
      toast({
        title: "Descarga",
        description: typeof msg === "string" ? msg : "Intenta de nuevo",
        variant: "destructive",
      });
    } finally {
      setDocumentActionId(null);
    }
  };

  useEffect(() => {
    if (!id) return undefined;

    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const empId = Number(id);
        if (Number.isNaN(empId)) {
          throw new Error("ID de colaborador no válido");
        }

        const [empRes, departments] = await Promise.all([
          fetchEmployee(empId),
          fetchDepartments(),
        ]);
        if (cancelled) return;

        const e = empRes.data;
        setEmployee(e);
        const dept = departments.find((d) => d.id === e.department_id);
        setDeptName(dept?.name ?? "—");

        if (e.manager_id != null) {
          try {
            const mgr = await fetchEmployee(e.manager_id);
            if (!cancelled) setManagerName(formatEmployeeName(mgr.data));
          } catch {
            if (!cancelled) setManagerName("—");
          }
        } else {
          setManagerName("—");
        }
      } catch (err) {
        if (!cancelled) {
          setEmployee(null);
          const msg =
            err instanceof ApiHttpError ? err.apiError?.message ?? err.message : "No se pudo cargar el colaborador";
          setError(typeof msg === "string" ? msg : "Error");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!employee?.id || !canViewAttendance) {
      setAttendanceRecords([]);
      setAttendanceError(null);
      return;
    }
    let cancelled = false;
    setAttendanceLoading(true);
    setAttendanceError(null);
    const { from, to } = monthBounds(attendanceRefMonth);
    fetchAllAttendanceInRange({ employee_id: employee.id, from, to })
      .then((rows) => {
        if (!cancelled) setAttendanceRecords(rows);
      })
      .catch((err) => {
        if (!cancelled) {
          const msg =
            err instanceof ApiHttpError ? err.apiError?.message ?? err.message : "No se pudo cargar la asistencia";
          setAttendanceError(typeof msg === "string" ? msg : "Error");
          setAttendanceRecords([]);
        }
      })
      .finally(() => {
        if (!cancelled) setAttendanceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [employee?.id, canViewAttendance, attendanceRefMonth]);

  useEffect(() => {
    if (!employee?.id || !canViewPayroll) {
      setPayslipsRows([]);
      setPayrollPeriodsById(new Map());
      setPayslipsError(null);
      return;
    }
    let cancelled = false;
    setPayslipsLoading(true);
    setPayslipsError(null);
    Promise.all([fetchPayrollPeriods(), fetchAllPayslipsForEmployee(employee.id)])
      .then(([periodsRes, slips]) => {
        if (cancelled) return;
        const periodMap = new Map(periodsRes.data.map((p) => [p.id, p]));
        setPayrollPeriodsById(periodMap);
        const sorted = [...slips].sort((a, b) => {
          const pa = periodMap.get(a.payroll_period_id);
          const pb = periodMap.get(b.payroll_period_id);
          if (!pa || !pb) return 0;
          if (pa.year !== pb.year) return pb.year - pa.year;
          return pb.month - pa.month;
        });
        setPayslipsRows(sorted);
      })
      .catch((err) => {
        if (!cancelled) {
          const msg =
            err instanceof ApiHttpError ? err.apiError?.message ?? err.message : "No se pudieron cargar las boletas";
          setPayslipsError(typeof msg === "string" ? msg : "Error");
          setPayslipsRows([]);
          setPayrollPeriodsById(new Map());
        }
      })
      .finally(() => {
        if (!cancelled) setPayslipsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [employee?.id, canViewPayroll]);

  useEffect(() => {
    if (!employee?.id || !canViewAssets) {
      setAssetRows([]);
      setAssetsError(null);
      return;
    }
    let cancelled = false;
    setAssetsLoading(true);
    setAssetsError(null);
    fetchAllAssetsForEmployee(employee.id)
      .then((rows) => {
        if (!cancelled) setAssetRows(rows);
      })
      .catch((err) => {
        if (!cancelled) {
          const msg =
            err instanceof ApiHttpError ? err.apiError?.message ?? err.message : "No se pudieron cargar los activos";
          setAssetsError(typeof msg === "string" ? msg : "Error");
          setAssetRows([]);
        }
      })
      .finally(() => {
        if (!cancelled) setAssetsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [employee?.id, canViewAssets]);

  useEffect(() => {
    if (!employee?.id || !canViewEmployeeDirectory) {
      setTerminationLoading(false);
      setTerminationError(null);
      setTerminationRecord(null);
      return undefined;
    }
    let cancelled = false;
    setTerminationLoading(true);
    setTerminationError(null);
    fetchEmployeeTermination(employee.id)
      .then((res) => {
        if (!cancelled) setTerminationRecord(res?.data ?? null);
      })
      .catch((err) => {
        if (!cancelled) {
          const msg =
            err instanceof ApiHttpError ? err.apiError?.message ?? err.message : "No se pudo cargar el registro de cese";
          setTerminationError(typeof msg === "string" ? msg : "Error");
          setTerminationRecord(null);
        }
      })
      .finally(() => {
        if (!cancelled) setTerminationLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [employee?.id, canViewEmployeeDirectory]);

  if (!id) {
    return (
      <p className="text-sm text-muted-foreground">
        <Link to={profileListHref} className="text-primary">
          {profileListLabel}
        </Link>
      </p>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Link to={profileListHref} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" /> {profileListLabel}
        </Link>
        <p className="text-sm text-muted-foreground">Cargando perfil…</p>
      </div>
    );
  }

  if (error || !employee) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Link to={profileListHref} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" /> {profileListLabel}
        </Link>
        <Card className="shadow-card border-destructive/50">
          <CardContent className="p-6 text-sm text-destructive">{error ?? "Colaborador no encontrado."}</CardContent>
        </Card>
      </div>
    );
  }

  const e = employee;
  const st = statusBadgeVariant[e.status] ?? "secondary";
  const stLabel = statusLabel[e.status] ?? e.status;
  const contractDaysLeft =
    e.contract_end ?
      Math.ceil((new Date(`${e.contract_end}T12:00:00`).getTime() - Date.now()) / 86400000)
    : null;

  const attendanceYm = attendanceMonthMeta;
  const attendanceLeadingBlanks = new Date(attendanceYm.year, attendanceYm.monthIndex, 1).getDay();
  const attendanceDaysInMonth = new Date(attendanceYm.year, attendanceYm.monthIndex + 1, 0).getDate();

  return (
    <div className="space-y-6 animate-fade-in">
      <Link to={profileListHref} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-4 h-4" /> {profileListLabel}
      </Link>

      <Card className="shadow-card">
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row items-start gap-5">
            <Avatar className="w-20 h-20">
              {photoObjectUrl ? (
                <AvatarImage src={photoObjectUrl} alt={formatEmployeeName(e)} className="object-cover" />
              ) : e.linked_user_avatar_path?.trim() ? (
                <AvatarImage src={e.linked_user_avatar_path.trim()} alt={formatEmployeeName(e)} className="object-cover" />
              ) : null}
              <AvatarFallback className="bg-primary text-primary-foreground text-2xl font-bold">
                {initialsFromName(formatEmployeeName(e))}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-bold">{formatEmployeeName(e)}</h1>
                <Badge variant={st} className="w-fit">
                  {stLabel}
                </Badge>
                {canEditProfile ? (
                  <Link to={`/colaboradores/${e.id}/edit`} className="sm:ml-auto">
                    <Button variant="outline" size="sm" type="button">
                      Editar datos
                    </Button>
                  </Link>
                ) : null}
              </div>
              <p className="text-muted-foreground mt-1">
                {e.position ?? "—"} — {deptName}
              </p>
              <div className="flex flex-wrap gap-4 mt-3 text-sm text-muted-foreground">
                {e.corporate_email ? (
                  <span className="flex items-center gap-1.5" title="Correo electrónico">
                    <Mail className="w-4 h-4 shrink-0" />
                    {e.corporate_email}
                  </span>
                ) : null}
                {e.personal_email ? (
                  <span className="flex items-center gap-1.5" title="Correo personal">
                    <Mail className="w-4 h-4 shrink-0" />
                    {e.personal_email}
                  </span>
                ) : null}
                {e.phone ? (
                  <span className="flex items-center gap-1.5">
                    <Phone className="w-4 h-4" />
                    {e.phone}
                  </span>
                ) : null}
                {e.address ? (
                  <span className="flex items-center gap-1.5">
                    <MapPin className="w-4 h-4" />
                    {e.address}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="personal" className="space-y-4">
        <TabsList className="bg-card border border-border">
          <TabsTrigger value="personal">Datos Personales</TabsTrigger>
          <TabsTrigger value="laboral">Datos Laborales</TabsTrigger>
          <TabsTrigger value="asistencia">Asistencia</TabsTrigger>
          <TabsTrigger value="boletas">Boletas</TabsTrigger>
          <TabsTrigger value="activos">Activos</TabsTrigger>
          <TabsTrigger value="desvinculacion">Desvinculación</TabsTrigger>
        </TabsList>

        <TabsContent value="personal">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="shadow-card">
              <CardHeader>
                <CardTitle className="text-base">Información Personal</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {[
                  ["DNI", displayEmployeeDni(e.dni)],
                  ["Fecha de Nacimiento", formatAppDate(e.birth_date)],
                  ["Nivel de Estudios", e.education_level ?? "—"],
                  ["Carrera", e.degree ?? "—"],
                ].map(([l, v]) => (
                  <div key={l} className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{l}</span>
                    <span className="font-medium">{v}</span>
                  </div>
                ))}
                <Separator />
                <div className="space-y-2">
                  <p className="text-sm font-medium">Documentos</p>
                  {documentsLoading ? (
                    <p className="text-xs text-muted-foreground">Cargando documentos…</p>
                  ) : documentsError ? (
                    <div className="space-y-2">
                      <p className="text-xs text-destructive">{documentsError}</p>
                      <Button variant="ghost" size="sm" type="button" className="h-auto py-1 px-2 text-xs" onClick={() => void loadEmployeeDocuments()}>
                        Reintentar
                      </Button>
                    </div>
                  ) : visibleDocuments.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No hay documentos registrados todavía.</p>
                  ) : (
                    <ul className="space-y-3 border border-border rounded-md p-3 bg-muted/30">
                      {visibleDocuments.map((d) => {
                        const busy = documentActionId === d.id;
                        return (
                          <li
                            key={d.id}
                            className="text-xs flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-border/50 pb-3 last:border-0 last:pb-0"
                          >
                            <div className="min-w-0 space-y-0.5">
                              <span className="font-medium block">{documentTypeLabels[d.type]}</span>
                              <span className="text-muted-foreground block truncate">
                                {formatAppDateTime(d.uploaded_at ?? d.created_at)} — {storageBasename(d.file_path)}
                              </span>
                            </div>
                            <EmployeeDocumentActionBar
                              filename={storageBasename(d.file_path)}
                              busy={busy}
                              canDelete={false}
                              onView={() => void handleOpenDocument(d)}
                              onDownload={() => void handleDownloadDocument(d)}
                            />
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {canEditProfile ? (
                    <p className="text-xs text-muted-foreground">
                      Para subir o reemplazar documentos, usa{" "}
                      <span className="font-medium text-foreground">Editar datos</span>. Aquí solo puedes ver y descargar
                      los archivos registrados.
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Solo lectura: puedes ver y descargar los documentos registrados.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
            <Card className="shadow-card">
              <CardHeader>
                <CardTitle className="text-base">Contacto y Datos Bancarios</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {[
                  ["Correo Electrónico", e.corporate_email ?? "—"],
                  ["Teléfono", e.phone ?? "—"],
                  ["Dirección", e.address ?? "—"],
                  ["Correo Personal", e.personal_email ?? "—"],
                  ["Teléfono de emergencia", e.emergency_contact_phone ?? "—"],
                ].map(([l, v]) => (
                  <div key={l} className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{l}</span>
                    <span className="font-medium">{v}</span>
                  </div>
                ))}
                <Separator />
                <p className="text-sm font-medium">Datos Bancarios</p>
                {[
                  ["Banco", e.bank ?? "—"],
                  ["Cuenta", e.bank_account ?? "—"],
                  ["Número de cuenta interbancaria (CCI)", e.bank_account_cci ?? "—"],
                  ["Sistema Previsional", e.pension_fund ?? "—"],
                ].map(([l, v]) => (
                  <div key={l} className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{l}</span>
                    <span className="font-medium">{v}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="laboral">
          <Card className="shadow-card">
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-base">Información Laboral</CardTitle>
              {canHrEditEmployee ? (
                <p className="text-xs text-muted-foreground text-right max-w-xs">
                  Para modificar sueldo u otros datos laborales, usa <span className="font-medium text-foreground">Editar datos</span>{" "}
                  en la cabecera del perfil.
                </p>
              ) : canSelfServiceProfile ? (
                <span className="text-xs text-muted-foreground text-right max-w-xs">
                  Los datos laborales los actualiza RRHH. Puedes editar datos personales y de contacto desde{" "}
                  <span className="font-medium text-foreground">Editar datos</span>.
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">Solo lectura.</span>
              )}
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-3">
                {[
                  ["Puesto", e.position ?? "—"],
                  ["Área", deptName],
                  ["Modalidad", formatEmployeeModalityDisplay(e.modality) || "—"],
                  ["Horario", e.schedule ?? "—"],
                  ["Sueldo Actual", formatSalary(e.salary)],
                  ["Tipo de Contrato", e.contract_type ?? "—"],
                  ["Inicio Contrato", formatAppDate(e.contract_start)],
                  ["Fin Contrato", formatAppDate(e.contract_end)],
                  ["Jefe Directo", managerName],
                ].map(([l, v]) => (
                  <div key={l} className="flex justify-between text-sm py-1">
                    <span className="text-muted-foreground">{l}</span>
                    <span className="font-medium">{v}</span>
                  </div>
                ))}
              </div>
              {contractDaysLeft != null && contractDaysLeft > 0 && contractDaysLeft <= 180 ? (
              <div className="mt-4 p-3 rounded-lg bg-warning/10 border border-warning/30 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-warning" />
                  <span className="text-sm text-warning font-medium">
                    Contrato vence en {contractDaysLeft} día(s)
                  </span>
              </div>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="asistencia">
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-base">
                Asistencia — {formatAppMonthYear(attendanceYm.monthIndex + 1, attendanceYm.year)}
              </CardTitle>
              <p className="text-xs text-muted-foreground font-normal">
                Registros del mes calendario actual. Sin color = día sin registro.
              </p>
            </CardHeader>
            <CardContent>
              {!canViewAttendance ? (
                <p className="text-sm text-muted-foreground py-4">No tienes permiso para ver asistencia.</p>
              ) : attendanceLoading ? (
                <p className="text-sm text-muted-foreground py-8">Cargando asistencia…</p>
              ) : attendanceError ? (
                <p className="text-sm text-destructive py-4">{attendanceError}</p>
              ) : (
                <>
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
                    {Array.from({ length: attendanceLeadingBlanks }).map((_, i) => (
                      <div key={`blank-${i}`} />
                    ))}
                    {Array.from({ length: attendanceDaysInMonth }, (_, i) => i + 1).map((day) => {
                      const pad = (n: number) => String(n).padStart(2, "0");
                      const dateKey = `${attendanceYm.year}-${pad(attendanceYm.monthIndex + 1)}-${pad(day)}`;
                      const rec = attendanceByDate.get(dateKey);
                      const status = rec?.status;
                      const isWeekendCell = isWeekendYmd(attendanceYm.year, attendanceYm.monthIndex, day);
                      const cls = isWeekendCell
                        ? "bg-zinc-600 text-zinc-100 dark:bg-zinc-800 dark:text-zinc-200"
                        : attendanceCellClass(status);
                      return (
                        <div
                          key={dateKey}
                          className={cn(
                            "aspect-square rounded-md flex items-center justify-center text-xs font-medium transition-colors min-w-0 w-full",
                            cls,
                          )}
                          title={
                            isWeekendCell
                              ? "Día no laborable (fin de semana)"
                              : status ?? "Sin registro"
                          }
                        >
                          {day}
                        </div>
                      );
                    })}
              </div>
              <div className="flex flex-wrap gap-4 text-xs">
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded bg-success" />
                      Asistido / recuperación
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded bg-destructive" />
                      Falta
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded bg-warning" />
                      Tardanza
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded bg-info" />
                      Vacaciones
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded bg-muted border border-border" />
                      Sin registro
                    </span>
              </div>
              <Separator className="my-4" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {[
                      ["Días asistido / recuperación", String(attendanceStats.asist)],
                      ["Faltas", String(attendanceStats.falta)],
                      ["Tardanzas", String(attendanceStats.tard)],
                      ["Vacaciones", String(attendanceStats.vac)],
                    ].map(([l, v]) => (
                  <div key={l} className="text-center p-3 bg-muted rounded-lg">
                    <p className="text-2xl font-bold">{v}</p>
                    <p className="text-xs text-muted-foreground mt-1">{l}</p>
                  </div>
                ))}
              </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="boletas">
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-base">Boletas de Pago</CardTitle>
              <p className="text-xs text-muted-foreground font-normal">
                Boletas visibles según tu permiso de planilla. La gestión detallada está en Boletas y Nómina.
              </p>
            </CardHeader>
            <CardContent className="p-0">
              {!canViewPayroll ? (
                <p className="text-sm text-muted-foreground px-5 py-6">No tienes permiso para ver boletas.</p>
              ) : payslipsLoading ? (
                <p className="text-sm text-muted-foreground px-5 py-6">Cargando boletas…</p>
              ) : payslipsError ? (
                <p className="text-sm text-destructive px-5 py-6">{payslipsError}</p>
              ) : payslipsRows.length === 0 ? (
                <p className="text-sm text-muted-foreground px-5 py-6">No hay boletas registradas para este colaborador.</p>
              ) : (
              <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                  <th className="text-left text-xs font-semibold text-muted-foreground px-5 py-3">Periodo</th>
                  <th className="text-left text-xs font-semibold text-muted-foreground px-5 py-3">Neto</th>
                  <th className="text-left text-xs font-semibold text-muted-foreground px-5 py-3">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payslipsRows.map((p) => (
                      <tr key={p.id} className="border-b border-border last:border-0">
                        <td className="px-5 py-3 text-sm font-medium">
                          {payslipPeriodLabel(p, payrollPeriodsById)}
                        </td>
                        <td className="px-5 py-3 text-sm tabular-nums">{formatSalary(p.net_amount)}</td>
                        <td className="px-5 py-3">
                          <Badge variant="secondary" className="text-xs">
                            {p.status}
                          </Badge>
                        </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activos">
          <Card className="shadow-card">
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-base">Activos Asignados</CardTitle>
              {canManageAssets ? (
                <Button size="sm" variant="outline" className="gap-1.5 shrink-0" type="button" asChild>
                  <Link to="/activos">
                    <Briefcase className="w-3.5 h-3.5" />
                    Ir a Activos
                  </Link>
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground text-right max-w-xs">
                  La asignación de equipos se gestiona en el módulo Activos y equipos.
                </span>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {!canViewAssets ? (
                <p className="text-sm text-muted-foreground px-5 py-6">No tienes permiso para ver activos.</p>
              ) : assetsLoading ? (
                <p className="text-sm text-muted-foreground px-5 py-6">Cargando activos…</p>
              ) : assetsError ? (
                <p className="text-sm text-destructive px-5 py-6">{assetsError}</p>
              ) : assetRows.length === 0 ? (
                <p className="text-sm text-muted-foreground px-5 py-6">No hay activos asignados a este colaborador.</p>
              ) : (
              <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                  <th className="text-left text-xs font-semibold text-muted-foreground px-5 py-3">Tipo</th>
                  <th className="text-left text-xs font-semibold text-muted-foreground px-5 py-3">Descripción</th>
                  <th className="text-left text-xs font-semibold text-muted-foreground px-5 py-3">Fecha Asignación</th>
                  <th className="text-left text-xs font-semibold text-muted-foreground px-5 py-3">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assetRows.map((a) => (
                      <tr key={a.id} className="border-b border-border last:border-0">
                        <td className="px-5 py-3 text-sm font-medium">{a.type}</td>
                        <td className="px-5 py-3 text-sm">{formatAssetDescription(a)}</td>
                        <td className="px-5 py-3 text-sm text-muted-foreground">
                          {a.assigned_at ? formatAppDate(a.assigned_at) : formatAppDateTime(a.created_at)}
                        </td>
                        <td className="px-5 py-3">
                          <Badge variant="secondary" className="text-xs">
                            {a.status}
                          </Badge>
                        </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="desvinculacion">
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-base">Cese y desvinculación</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!canViewEmployeeDirectory ? (
                <p className="text-sm text-muted-foreground">
                  El detalle administrativo de desvinculación solo está disponible para quienes gestionan el directorio de
                  colaboradores. Si tienes dudas sobre un posible cese, contacta a Recursos Humanos.
                </p>
              ) : terminationLoading ? (
                <p className="text-sm text-muted-foreground">Cargando información de cese…</p>
              ) : terminationError ? (
                <p className="text-sm text-destructive">{terminationError}</p>
              ) : terminationRecord ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-muted-foreground">Estado del registro</span>
                    <Badge
                      variant={terminationRecord.status === "confirmado" ? "destructive" : "secondary"}
                      className="text-xs"
                    >
                      {terminationRecord.status === "confirmado" ? "Confirmado" : "Borrador"}
                    </Badge>
                  </div>
                  <div className="grid gap-2 text-sm">
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Fecha efectiva de cese</span>
                      <span className="font-medium">{formatAppDate(terminationRecord.effective_date)}</span>
                    </div>
                    <div className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:gap-4">
                      <span className="text-muted-foreground shrink-0">Motivo</span>
                      <span className="font-medium text-right sm:text-left break-words">{terminationRecord.exit_reason}</span>
                    </div>
                    {terminationRecord.confirmed_at ? (
                      <div className="flex justify-between gap-4">
                        <span className="text-muted-foreground">Confirmado el</span>
                        <span className="font-medium">{formatAppDateTime(terminationRecord.confirmed_at)}</span>
                      </div>
                    ) : null}
                    {terminationRecord.notes?.trim() ? (
                      <div className="flex flex-col gap-1 pt-1 border-t border-border">
                        <span className="text-muted-foreground text-xs">Notas</span>
                        <p className="text-sm whitespace-pre-wrap">{terminationRecord.notes}</p>
                      </div>
                    ) : null}
                  </div>
              </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No hay registro de cese en el sistema para este colaborador. Si se registra un proceso de cese, aquí se mostrará el
                  estado y las fechas principales (solo consulta).
                </p>
              )}
              <p className="text-xs text-muted-foreground pt-1 border-t border-border">
                Vista informativa. Iniciar o completar liquidación, checklist u otros pasos administrativos del cese se gestiona con
                las herramientas habilitadas para ello; esta pantalla no permite crear ni editar el proceso desde el perfil.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}