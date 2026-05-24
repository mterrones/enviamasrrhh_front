import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Download, Upload, Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ApiHttpError } from "@/api/client";
import { formatHttpErrorMessage } from "@/api/httpErrorMessage";
import { fetchDepartments } from "@/api/departments";
import {
  createEmployee,
  fetchEmployee,
  fetchAllEmployees,
  updateEmployee,
  type Employee,
  type EmployeeWrite,
} from "@/api/employees";
import {
  deleteEmployeeDocument,
  fetchEmployeeDocumentBlob,
  fetchEmployeeDocuments,
  uploadEmployeeDocument,
  type EmployeeDocument,
  type EmployeeDocumentType,
} from "@/api/employeeDocuments";
import { fetchEmployeePhotoBlob, uploadEmployeePhoto } from "@/api/employeePhotos";
import type { components } from "@/api/contracts";
import { formatEmployeeName } from "@/lib/employeeName";
import { editableEmployeeDni } from "@/lib/employeeDniDisplay";
import { confirmReplaceEmployeeDocument, latestEmployeeDocumentByType } from "@/lib/employeeDocumentUi";
import { EMPLOYEE_MODALITY_OPTIONS, resolveModalityForForm } from "@/lib/employeeModalityCatalog";
import { normalizeMoneyDecimalInput } from "@/lib/moneyDecimalInput";
import { cn } from "@/lib/utils";
import { PendingPdfFileInput } from "@/components/PendingPdfFileInput";
import { EmployeeDocumentActionBar } from "@/components/EmployeeDocumentActionBar";
import { useAuth } from "@/contexts/AuthContext";

const formPersonalDocumentSlots = ["dni_scan", "cv", "antecedentes", "medical_exam"] as const;

type FormPersonalDocumentSlot = (typeof formPersonalDocumentSlots)[number];

type FormDocumentSlot = FormPersonalDocumentSlot | "contract";

const formDocumentSlots: FormDocumentSlot[] = [...formPersonalDocumentSlots, "contract"];

const formPersonalDocumentLabels: Record<FormPersonalDocumentSlot, string> = {
  dni_scan: "Escaneo de DNI (PDF)",
  cv: "CV (PDF)",
  antecedentes: "Antecedentes policiales (PDF)",
  medical_exam: "Examen Médico Ocupacional (PDF)",
};

const formDocumentLabels: Record<FormDocumentSlot, string> = {
  ...formPersonalDocumentLabels,
  contract: "Contrato",
};

function emptyPendingDocuments(): Record<FormDocumentSlot, File | null> {
  return {
    dni_scan: null,
    cv: null,
    antecedentes: null,
    medical_exam: null,
    contract: null,
  };
}

function documentStorageBasename(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i >= 0 ? path.slice(i + 1) : path;
}

async function uploadPendingEmployeeDocuments(
  employeeId: number,
  files: Record<FormDocumentSlot, File | null>,
): Promise<FormDocumentSlot[]> {
  const failed: FormDocumentSlot[] = [];
  for (const slot of formDocumentSlots) {
    const file = files[slot];
    if (!file) {
      continue;
    }
    try {
      await uploadEmployeeDocument(employeeId, slot, file);
    } catch {
      failed.push(slot);
    }
  }
  return failed;
}

const bancos = ["BCP", "BBVA", "Interbank", "Scotiabank", "BanBif", "Caja Arequipa"];
const previsiones = ["AFP Integra", "AFP Prima", "AFP Profuturo", "AFP Habitat", "ONP"];
const contratos = ["Plazo Fijo", "Indefinido", "Locación de Servicios"];
const estados = ["activo", "suspendido", "vacaciones", "cesado"];
const estudios = ["Secundaria", "Técnico", "Universitario", "Postgrado"];

function sanitizeCciInput(value: string): string {
  return value.replace(/\D/g, "").slice(0, 20);
}

function customCatalogOptionItem(value: string, known: string[]) {
  if (!value || known.includes(value)) return null;
  return (
    <SelectItem key={`__custom_${value}`} value={value}>
      {value}
    </SelectItem>
  );
}

export type EmployeeFormMode = "create" | "edit";

type DepartmentOption = {
  id: number;
  name: string;
  positions: { id: number; name: string }[];
};

type FormState = {
  nombre: string;
  segundoNombre: string;
  apellido: string;
  segundoApellido: string;
  dni: string;
  fechaNacimiento: string;
  nivelEstudios: string;
  carrera: string;
  telefono: string;
  correoElectronico: string;
  correoPersonal: string;
  direccion: string;
  contactoEmergenciaNombre: string;
  contactoEmergenciaTelefono: string;
  banco: string;
  numeroCuenta: string;
  numeroCuentaCci: string;
  prevision: string;
  puesto: string;
  departmentId: string;
  modalidad: string;
  sueldo: string;
  tipoContrato: string;
  fechaInicio: string;
  fechaFin: string;
  managerId: string;
  estado: string;
};

function emptyForm(): FormState {
  return {
    nombre: "",
    segundoNombre: "",
    apellido: "",
    segundoApellido: "",
    dni: "",
    fechaNacimiento: "",
    nivelEstudios: "",
    carrera: "",
    telefono: "",
    correoElectronico: "",
    correoPersonal: "",
    direccion: "",
    contactoEmergenciaNombre: "",
    contactoEmergenciaTelefono: "",
    banco: "",
    numeroCuenta: "",
    numeroCuentaCci: "",
    prevision: "",
    puesto: "",
    departmentId: "__no_dept__",
    modalidad: "",
    sueldo: "",
    tipoContrato: "",
    fechaInicio: "",
    fechaFin: "",
    managerId: "__none__",
    estado: "activo",
  };
}

function toInputDate(val?: string | null): string {
  if (!val) return "";
  return val.length >= 10 ? val.slice(0, 10) : val;
}

function employeeToForm(e: Employee): FormState {
  return {
    nombre: e.first_name ?? "",
    segundoNombre: e.middle_name ?? "",
    apellido: e.last_name ?? "",
    segundoApellido: e.second_last_name ?? "",
    dni: editableEmployeeDni(e.dni),
    fechaNacimiento: toInputDate(e.birth_date),
    nivelEstudios: e.education_level ?? "",
    carrera: e.degree ?? "",
    telefono: e.phone ?? "",
    correoElectronico: e.corporate_email?.trim() ?? "",
    correoPersonal: e.personal_email ?? "",
    direccion: e.address ?? "",
    contactoEmergenciaNombre: e.emergency_contact_name ?? "",
    contactoEmergenciaTelefono: e.emergency_contact_phone ?? "",
    banco: e.bank ?? "",
    numeroCuenta: e.bank_account ?? "",
    numeroCuentaCci: e.bank_account_cci ?? "",
    prevision: e.pension_fund ?? "",
    puesto: e.position ?? "",
    departmentId: e.department_id != null ? String(e.department_id) : "__no_dept__",
    modalidad: resolveModalityForForm(e.modality),
    sueldo: e.salary != null && e.salary !== "" ? String(e.salary) : "",
    tipoContrato: e.contract_type ?? "",
    fechaInicio: toInputDate(e.contract_start),
    fechaFin: toInputDate(e.contract_end),
    managerId: e.manager_id != null ? String(e.manager_id) : "__none__",
    estado: e.status ?? "activo",
  };
}

function buildPayloadForCreate(form: FormState): EmployeeWrite {
  const salaryNum = form.sueldo.trim() === "" ? undefined : Number(form.sueldo);
  const payload: EmployeeWrite = {
    first_name: form.nombre.trim(),
    middle_name: form.segundoNombre.trim() || null,
    last_name: form.apellido.trim(),
    second_last_name: form.segundoApellido.trim() || null,
    dni: form.dni.trim() || null,
    status: form.estado as components["schemas"]["EmployeeStatus"],
  };
  if (form.departmentId && form.departmentId !== "__no_dept__") payload.department_id = Number(form.departmentId);
  if (form.managerId && form.managerId !== "__none__") payload.manager_id = Number(form.managerId);
  if (form.fechaNacimiento) payload.birth_date = form.fechaNacimiento;
  if (form.nivelEstudios) payload.education_level = form.nivelEstudios;
  if (form.carrera) payload.degree = form.carrera;
  if (form.telefono) payload.phone = form.telefono;
  if (form.correoPersonal.trim()) payload.personal_email = form.correoPersonal.trim();
  if (form.direccion) payload.address = form.direccion;
  if (form.contactoEmergenciaNombre) payload.emergency_contact_name = form.contactoEmergenciaNombre;
  if (form.contactoEmergenciaTelefono) payload.emergency_contact_phone = form.contactoEmergenciaTelefono;
  if (form.banco) payload.bank = form.banco;
  if (form.numeroCuenta) payload.bank_account = form.numeroCuenta;
  if (form.numeroCuentaCci) payload.bank_account_cci = form.numeroCuentaCci;
  if (form.prevision) payload.pension_fund = form.prevision;
  if (form.puesto) payload.position = form.puesto;
  if (form.modalidad) payload.modality = form.modalidad;
  if (salaryNum != null && !Number.isNaN(salaryNum)) payload.salary = salaryNum;
  if (form.tipoContrato) payload.contract_type = form.tipoContrato;
  if (form.fechaInicio) payload.contract_start = form.fechaInicio;
  if (form.fechaFin) payload.contract_end = form.fechaFin;
  return payload;
}

function buildPayloadForUpdate(form: FormState, lockIdentityFields: boolean): Partial<EmployeeWrite> {
  const salaryNum = form.sueldo.trim() === "" ? undefined : Number(form.sueldo);
  const payload: Partial<EmployeeWrite> = {
    dni: form.dni.trim() || null,
    status: form.estado as components["schemas"]["EmployeeStatus"],
  };
  if (!lockIdentityFields) {
    payload.first_name = form.nombre.trim();
    payload.last_name = form.apellido.trim();
  }
  payload.middle_name = form.segundoNombre.trim() || null;
  payload.second_last_name = form.segundoApellido.trim() || null;
  payload.personal_email = form.correoPersonal.trim() || null;
  payload.department_id =
    form.departmentId && form.departmentId !== "__no_dept__" ? Number(form.departmentId) : null;
  payload.manager_id =
    form.managerId && form.managerId !== "__none__" ? Number(form.managerId) : null;
  payload.birth_date = form.fechaNacimiento || null;
  payload.education_level = form.nivelEstudios || null;
  payload.degree = form.carrera || null;
  payload.phone = form.telefono || null;
  payload.address = form.direccion || null;
  payload.emergency_contact_name = form.contactoEmergenciaNombre || null;
  payload.emergency_contact_phone = form.contactoEmergenciaTelefono || null;
  payload.bank = form.banco || null;
  payload.bank_account = form.numeroCuenta || null;
  payload.bank_account_cci = form.numeroCuentaCci || null;
  payload.pension_fund = form.prevision || null;
  payload.position = form.puesto || null;
  payload.modality = form.modalidad || null;
  payload.schedule = null;
  payload.salary = salaryNum != null && !Number.isNaN(salaryNum) ? salaryNum : null;
  payload.contract_type = form.tipoContrato || null;
  payload.contract_start = form.fechaInicio || null;
  payload.contract_end = form.fechaFin || null;
  return payload;
}

function buildPayloadForSelfServiceUpdate(form: FormState): Partial<EmployeeWrite> {
  return {
    middle_name: form.segundoNombre.trim() || null,
    second_last_name: form.segundoApellido.trim() || null,
    dni: form.dni.trim() || null,
    birth_date: form.fechaNacimiento || null,
    education_level: form.nivelEstudios || null,
    degree: form.carrera || null,
    phone: form.telefono || null,
    personal_email: form.correoPersonal.trim() || null,
    address: form.direccion || null,
    emergency_contact_name: form.contactoEmergenciaNombre || null,
    emergency_contact_phone: form.contactoEmergenciaTelefono || null,
    bank: form.banco || null,
    bank_account: form.numeroCuenta || null,
    bank_account_cci: form.numeroCuentaCci || null,
    pension_fund: form.prevision || null,
  };
}

type EmployeeFormPageProps = {
  mode: EmployeeFormMode;
  employeeId?: number;
};

export function EmployeeFormPage({ mode, employeeId }: EmployeeFormPageProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, hasPermission } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  const [fotoPreview, setFotoPreview] = useState<string | null>(null);
  const [fotoFile, setFotoFile] = useState<File | null>(null);

  const setPreviewUrl = useCallback((url: string | null) => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    if (url?.startsWith("blob:")) {
      previewUrlRef.current = url;
    }
    setFotoPreview(url);
  }, []);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [managers, setManagers] = useState<{ id: number; first_name: string; last_name: string }[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [recordLoading, setRecordLoading] = useState(mode === "edit");
  const [recordError, setRecordError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [pendingDocuments, setPendingDocuments] = useState(emptyPendingDocuments);
  const [existingDocuments, setExistingDocuments] = useState<EmployeeDocument[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documentActionId, setDocumentActionId] = useState<number | null>(null);
  const [hasLinkedUserAccount, setHasLinkedUserAccount] = useState(false);

  const isSelfServiceLaborOnly = useMemo(() => {
    if (mode !== "edit" || employeeId == null || user?.employee?.id == null) return false;
    if (user.employee.id !== employeeId) return false;
    return hasPermission("employees.self_edit") && !hasPermission("employees.edit");
  }, [mode, employeeId, user?.employee?.id, hasPermission]);

  const identityLocked = mode === "edit" && hasLinkedUserAccount;
  const laborFieldsLocked = isSelfServiceLaborOnly;
  const canHrEditEmployee = hasPermission("employees.edit");

  const canDeleteExistingDocument = useCallback(
    (doc: EmployeeDocument) => {
      if (canHrEditEmployee) return true;
      if (isSelfServiceLaborOnly && doc.type !== "contract") return true;
      return false;
    },
    [canHrEditEmployee, isSelfServiceLaborOnly],
  );

  const reloadExistingDocuments = useCallback(async () => {
    if (employeeId == null) return;
    setDocumentsLoading(true);
    try {
      const docsRes = await fetchEmployeeDocuments(employeeId);
      setExistingDocuments(docsRes.data);
    } catch {
      setExistingDocuments([]);
    } finally {
      setDocumentsLoading(false);
    }
  }, [employeeId]);

  const handlePendingDocChange = (slot: FormDocumentSlot) => (file: File | null) => {
    if (file && mode === "edit" && existingDocByType.has(slot)) {
      const label = formDocumentLabels[slot];
      if (!confirmReplaceEmployeeDocument(label)) {
        return;
      }
    }
    setPendingDocuments((prev) => ({ ...prev, [slot]: file }));
  };

  const existingDocByType = useMemo(() => latestEmployeeDocumentByType(existingDocuments), [existingDocuments]);

  const handleViewExistingDocument = async (doc: EmployeeDocument) => {
    if (employeeId == null) return;
    setDocumentActionId(doc.id);
    try {
      const blob = await fetchEmployeeDocumentBlob(employeeId, doc.id, { attachment: false });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      window.setTimeout(() => URL.revokeObjectURL(url), 3_600_000);
    } catch (e) {
      toast({
        title: "No se pudo abrir",
        description: formatHttpErrorMessage(e),
        variant: "destructive",
      });
    } finally {
      setDocumentActionId(null);
    }
  };

  const handleDownloadExistingDocument = async (doc: EmployeeDocument) => {
    if (employeeId == null) return;
    setDocumentActionId(doc.id);
    try {
      const blob = await fetchEmployeeDocumentBlob(employeeId, doc.id, { attachment: true });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = documentStorageBasename(doc.file_path) || `${doc.type}-${doc.id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast({
        title: "No se pudo descargar",
        description: formatHttpErrorMessage(e),
        variant: "destructive",
      });
    } finally {
      setDocumentActionId(null);
    }
  };

  const handleDeleteExistingDocument = async (doc: EmployeeDocument) => {
    if (employeeId == null || !canDeleteExistingDocument(doc)) return;
    const label = formDocumentLabels[doc.type as FormDocumentSlot] ?? doc.type;
    if (!window.confirm(`¿Eliminar el documento "${label}"? Esta acción no se puede deshacer.`)) return;
    setDocumentActionId(doc.id);
    try {
      await deleteEmployeeDocument(employeeId, doc.id);
      toast({ title: "Documento eliminado", description: `${label} se eliminó correctamente.` });
      await reloadExistingDocuments();
    } catch (e) {
      toast({
        title: "No se pudo eliminar",
        description: formatHttpErrorMessage(e),
        variant: "destructive",
      });
    } finally {
      setDocumentActionId(null);
    }
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) {
      setFotoFile(file);
      setPreviewUrl(URL.createObjectURL(file));
    }
  };

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    };
  }, []);

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    try {
      const depts = await fetchDepartments();
      setDepartments(
        depts.map((d) => ({
          id: d.id,
          name: d.name,
          positions: d.positions ?? [],
        })),
      );
      if (mode === "create") {
        const emps = await fetchAllEmployees();
        setManagers(emps.map((e) => ({ id: e.id, first_name: e.first_name, last_name: e.last_name })));
      }
    } catch {
      toast({
        title: "Catálogos",
        description: "No se pudieron cargar áreas o lista de jefes. Revisa la conexión.",
        variant: "destructive",
      });
    } finally {
      setCatalogLoading(false);
    }
  }, [toast, mode]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    if (mode === "create") {
      setHasLinkedUserAccount(false);
      setExistingDocuments([]);
    }
  }, [mode]);

  useEffect(() => {
    if (mode !== "edit" || employeeId == null) return undefined;

    let cancelled = false;
    setRecordLoading(true);
    setRecordError(null);
    (async () => {
      try {
        const [empRes, depts] = await Promise.all([fetchEmployee(employeeId), fetchDepartments()]);
        if (cancelled) return;
        const e = empRes.data;
        setHasLinkedUserAccount(e.user_id != null && e.user_id > 0);
        setFotoFile(null);
        setForm(employeeToForm(e));
        setDepartments(
          depts.map((d) => ({
            id: d.id,
            name: d.name,
            positions: d.positions ?? [],
          })),
        );

        let employeePhotoBlobUrl: string | null = null;
        if (e.photo_path) {
          try {
            const blob = await fetchEmployeePhotoBlob(employeeId);
            if (!cancelled) {
              employeePhotoBlobUrl = URL.createObjectURL(blob);
            }
          } catch {
            employeePhotoBlobUrl = null;
          }
        }
        if (!cancelled) {
          if (employeePhotoBlobUrl) {
            setPreviewUrl(employeePhotoBlobUrl);
          } else {
            const linkedAvatar = e.linked_user_avatar_path?.trim();
            setPreviewUrl(linkedAvatar || null);
          }
        }

        if (isSelfServiceLaborOnly) {
          if (!cancelled) setManagers([]);
        } else {
          const emps = await fetchAllEmployees();
          if (cancelled) return;
          let list = emps
            .filter((x) => x.id !== employeeId)
            .map((x) => ({ id: x.id, first_name: x.first_name, last_name: x.last_name }));

          if (e.manager_id != null && !list.some((m) => m.id === e.manager_id)) {
            try {
              const mgr = await fetchEmployee(e.manager_id);
              if (!cancelled)
                list = [
                  ...list,
                  { id: mgr.data.id, first_name: mgr.data.first_name, last_name: mgr.data.last_name },
                ];
            } catch {
              /* omit */
            }
          }
          if (!cancelled) setManagers(list);
        }

        setDocumentsLoading(true);
        try {
          const docsRes = await fetchEmployeeDocuments(employeeId);
          if (!cancelled) setExistingDocuments(docsRes.data);
        } catch {
          if (!cancelled) setExistingDocuments([]);
        } finally {
          if (!cancelled) setDocumentsLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof ApiHttpError ? err.apiError?.message ?? err.message : "No se pudo cargar el colaborador";
          setRecordError(typeof msg === "string" ? msg : "Error al cargar");
        }
      } finally {
        if (!cancelled) setRecordLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mode, employeeId, reloadKey, setPreviewUrl, isSelfServiceLaborOnly]);

  const update = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  const updateDepartmentId = useCallback(
    (v: string) => {
      setForm((prev) => {
        let nextPuesto = prev.puesto;
        if (v === "__no_dept__") {
          nextPuesto = "";
        } else {
          const dept = departments.find((d) => String(d.id) === v);
          const names = (dept?.positions ?? []).map((p) => p.name);
          if (names.length > 0 && nextPuesto && !names.includes(nextPuesto)) {
            nextPuesto = "";
          }
        }
        return { ...prev, departmentId: v, puesto: nextPuesto };
      });
    },
    [departments],
  );

  const positionOptionsForDepartment = useMemo(() => {
    if (form.departmentId === "__no_dept__") return [];
    const dept = departments.find((d) => String(d.id) === form.departmentId);
    return (dept?.positions ?? []).map((p) => p.name);
  }, [form.departmentId, departments]);

  const handleSave = async () => {
    if (!form.nombre.trim() || !form.apellido.trim()) {
      toast({ title: "Campos obligatorios", description: "Nombre y apellido son obligatorios.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      if (mode === "create") {
        const res = await createEmployee(buildPayloadForCreate(form));
        const newId = res.data.id;
        const failed = await uploadPendingEmployeeDocuments(newId, pendingDocuments);
        setPendingDocuments(emptyPendingDocuments());
        let photoUploadFailed = false;
        let photoErrorDetail: string | null = null;
        if (fotoFile) {
          try {
            await uploadEmployeePhoto(newId, fotoFile);
          } catch (e) {
            photoUploadFailed = true;
            photoErrorDetail = formatHttpErrorMessage(e);
          }
        }
        if (failed.length > 0) {
          toast({
            title: "Colaborador creado",
            description: `No se pudieron subir: ${failed.map((s) => formDocumentLabels[s]).join(", ")}.${photoUploadFailed ? ` La foto tampoco: ${photoErrorDetail ?? "error"}.` : ""} Puedes subirlos desde el perfil del colaborador.`,
            variant: "destructive",
          });
        } else if (photoUploadFailed) {
          toast({
            title: "Colaborador creado",
            description: `${formatEmployeeName({ first_name: form.nombre, last_name: form.apellido })} fue registrado, pero la foto no se pudo subir: ${photoErrorDetail ?? "error"}. Puedes intentarlo desde la edición.`,
            variant: "destructive",
          });
        } else {
          toast({
            title: "Colaborador creado",
            description: `${formatEmployeeName({ first_name: form.nombre, last_name: form.apellido })} fue registrado correctamente.`,
          });
        }
        navigate(`/colaboradores/${newId}`);
      } else if (employeeId != null) {
        const payload = laborFieldsLocked ? buildPayloadForSelfServiceUpdate(form) : buildPayloadForUpdate(form, identityLocked);
        await updateEmployee(employeeId, payload);
        const docPayload = laborFieldsLocked ? { ...pendingDocuments, contract: null } : pendingDocuments;
        const failed = await uploadPendingEmployeeDocuments(employeeId, docPayload);
        setPendingDocuments(emptyPendingDocuments());
        let photoUploadFailed = false;
        let photoErrorDetail: string | null = null;
        if (fotoFile && !identityLocked && !laborFieldsLocked) {
          try {
            await uploadEmployeePhoto(employeeId, fotoFile);
          } catch (e) {
            photoUploadFailed = true;
            photoErrorDetail = formatHttpErrorMessage(e);
          }
        }
        if (failed.length > 0) {
          toast({
            title: "Cambios guardados",
            description: `No se pudieron subir: ${failed.map((s) => formDocumentLabels[s]).join(", ")}.${photoUploadFailed ? ` La foto tampoco: ${photoErrorDetail ?? "error"}.` : ""} Reintenta desde el perfil.`,
            variant: "destructive",
          });
        } else if (photoUploadFailed) {
          toast({
            title: "Cambios guardados",
            description: `Los datos se actualizaron, pero la foto no se pudo subir: ${photoErrorDetail ?? "error"}. Puedes intentarlo de nuevo.`,
            variant: "destructive",
          });
        } else {
          toast({ title: "Cambios guardados", description: "Los datos del colaborador se actualizaron correctamente." });
        }
        navigate(`/colaboradores/${employeeId}`);
      }
    } catch (e) {
      toast({
        title: "Error",
        description: formatHttpErrorMessage(e),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const isBusyInitial = mode === "edit" && (recordLoading || catalogLoading);
  const listBackHref = hasPermission("employees.view") ? "/colaboradores" : user?.employee?.id != null ? `/colaboradores/${user.employee.id}` : "/portal";
  const formBackHref = mode === "edit" && employeeId != null ? `/colaboradores/${employeeId}` : listBackHref;
  const listBackLabel = hasPermission("employees.view") ? "Volver a colaboradores" : "Volver";
  const estadoLabel = mode === "create" ? "Estado inicial" : "Estado";
  const primaryCta = mode === "create" ? "Guardar Colaborador" : "Guardar cambios";
  const title = mode === "create" ? "Nuevo Colaborador" : "Editar Colaborador";
  const subtitle =
    mode === "create" ? "Complete la información del nuevo colaborador" : "Actualice la información del colaborador";

  if (mode === "edit" && recordError) {
    return (
      <div className="space-y-6 animate-fade-in">
        <Link to={listBackHref}>
          <Button variant="ghost" size="sm" className="gap-2">
            <ArrowLeft className="w-4 h-4" /> {listBackLabel}
          </Button>
        </Link>
        <Card className="shadow-card">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            <p className="text-destructive mb-4">{recordError}</p>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setRecordError(null);
                setReloadKey((k) => k + 1);
              }}
            >
              Reintentar
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-4">
        <Link to={formBackHref}>
          <Button variant="ghost" size="sm" className="gap-2">
            <ArrowLeft className="w-4 h-4" /> {mode === "edit" ? "Volver al perfil" : listBackLabel}
          </Button>
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="text-muted-foreground text-sm mt-1">{subtitle}</p>
      </div>

      {isBusyInitial ? (
        <p className="text-sm text-muted-foreground py-8">Cargando datos…</p>
      ) : (
        <>
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-lg">Datos Personales</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4 mb-2">
                <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center border-2 border-dashed border-border overflow-hidden">
                  {fotoPreview ? (
                    <img
                      src={fotoPreview}
                      alt="Foto del colaborador"
                      className="w-full h-full object-cover"
                      referrerPolicy={fotoPreview.startsWith("http") ? "no-referrer" : undefined}
                    />
                  ) : (
                    <Upload className="w-6 h-6 text-muted-foreground" />
                  )}
                </div>
                {!identityLocked && !laborFieldsLocked ? (
                  <>
                    <input
                      type="file"
                      accept="image/*"
                      ref={fileInputRef}
                      onChange={handlePhotoChange}
                      className="hidden"
                    />
                    <Button variant="outline" size="sm" type="button" onClick={() => fileInputRef.current?.click()}>
                      {fotoPreview ? "Cambiar foto" : "Subir foto"}
                    </Button>
                    {fotoPreview ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        type="button"
                        onClick={() => {
                          setFotoFile(null);
                          setPreviewUrl(null);
                        }}
                      >
                        Quitar
                      </Button>
                    ) : null}
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground max-w-[220px]">
                    La foto proviene de la cuenta corporativa vinculada y no se puede cambiar aquí.
                  </p>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label>Nombre</Label>
                  <Input
                    placeholder="Ej: Juan"
                    value={form.nombre}
                    onChange={(e) => update("nombre", e.target.value)}
                    readOnly={identityLocked}
                    className={cn(identityLocked && "bg-muted")}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Segundo Nombre</Label>
                  <Input
                    placeholder="Ej: Carlos"
                    value={form.segundoNombre}
                    onChange={(e) => update("segundoNombre", e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">Ingrese todos los demás nombres si aplica</p>
                </div>
                <div className="space-y-2">
                  <Label>Apellido</Label>
                  <Input
                    placeholder="Ej: Pérez"
                    value={form.apellido}
                    onChange={(e) => update("apellido", e.target.value)}
                    readOnly={identityLocked}
                    className={cn(identityLocked && "bg-muted")}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Segundo Apellido</Label>
                  <Input
                    placeholder="Ej: García"
                    value={form.segundoApellido}
                    onChange={(e) => update("segundoApellido", e.target.value)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label>DNI</Label>
                  <Input placeholder="Ej: 72345678" maxLength={16} value={form.dni} readOnly={laborFieldsLocked} className={cn(laborFieldsLocked && "bg-muted")} onChange={(e) => update("dni", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Fecha de nacimiento</Label>
                  <Input type="date" value={form.fechaNacimiento} onChange={(e) => update("fechaNacimiento", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Nivel de estudios</Label>
                  <Select value={form.nivelEstudios || undefined} onValueChange={(v) => update("nivelEstudios", v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar" />
                    </SelectTrigger>
                    <SelectContent>
                      {customCatalogOptionItem(form.nivelEstudios, estudios)}
                      {estudios.map((x) => (
                        <SelectItem key={x} value={x}>
                          {x}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Carrera / Especialidad</Label>
                  <Input placeholder="Ej: Ing. Sistemas" value={form.carrera} onChange={(e) => update("carrera", e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                {formPersonalDocumentSlots.map((slot) => {
                  const existing = mode === "edit" ? existingDocByType.get(slot) : undefined;
                  const pendingFile = pendingDocuments[slot];
                  return (
                    <div key={slot} className="space-y-2">
                      <Label>{formPersonalDocumentLabels[slot]}</Label>
                      {mode === "edit" ? (
                        documentsLoading ? (
                          <p className="text-sm text-muted-foreground">Cargando documento…</p>
                        ) : existing ? (
                          <EmployeeDocumentActionBar
                            filename={documentStorageBasename(existing.file_path)}
                            busy={documentActionId === existing.id}
                            canDelete={canDeleteExistingDocument(existing)}
                            onView={() => void handleViewExistingDocument(existing)}
                            onDownload={() => void handleDownloadExistingDocument(existing)}
                            onDelete={() => void handleDeleteExistingDocument(existing)}
                          />
                        ) : (
                          <p className="text-sm text-muted-foreground">Sin archivo registrado.</p>
                        )
                      ) : null}
                      <PendingPdfFileInput
                        pendingFile={pendingFile}
                        onFileSelect={handlePendingDocChange(slot)}
                        pendingMessagePrefix={mode === "edit" ? "Se subirá al guardar:" : ""}
                      />
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-lg">Datos de Contacto</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Correo corporativo</Label>
                  <Input
                    type="email"
                    readOnly
                    tabIndex={identityLocked ? -1 : undefined}
                    value={form.correoElectronico}
                    placeholder="Se muestra cuando el colaborador tiene cuenta de acceso"
                    className={cn("bg-muted", identityLocked && "pointer-events-none select-none")}
                  />
                  <p className="text-xs text-muted-foreground">
                    {identityLocked
                      ? "Definido por la cuenta de acceso vinculada; no se puede editar aquí."
                      : "Proviene de la cuenta de usuario del colaborador. La ficha se crea o enlaza al iniciar sesión por primera vez."}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Teléfono</Label>
                  <Input placeholder="Ej: 987654321" value={form.telefono} onChange={(e) => update("telefono", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Dirección</Label>
                  <Input placeholder="Ej: Av. Principal 123, Lima" value={form.direccion} onChange={(e) => update("direccion", e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Correo Personal</Label>
                  <Input
                    type="email"
                    placeholder="Ej: correo.personal@gmail.com"
                    value={form.correoPersonal}
                    onChange={(e) => update("correoPersonal", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Teléfono de emergencia</Label>
                  <Input placeholder="Ej: 912345678" value={form.contactoEmergenciaTelefono} onChange={(e) => update("contactoEmergenciaTelefono", e.target.value)} />
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
                  <Select value={form.banco} onValueChange={(v) => update("banco", v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar banco" />
                    </SelectTrigger>
                    <SelectContent>
                      {customCatalogOptionItem(form.banco, bancos)}
                      {bancos.map((b) => (
                        <SelectItem key={b} value={b}>
                          {b}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Número de cuenta</Label>
                  <Input placeholder="Ej: 19112345678901" value={form.numeroCuenta} onChange={(e) => update("numeroCuenta", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Número de cuenta interbancaria (CCI)</Label>
                  <Input
                    placeholder="Ej: 00219112345678901234"
                    inputMode="numeric"
                    maxLength={20}
                    value={form.numeroCuentaCci}
                    onChange={(e) => update("numeroCuentaCci", sanitizeCciInput(e.target.value))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Sistema previsional</Label>
                  <Select value={form.prevision} onValueChange={(v) => update("prevision", v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar" />
                    </SelectTrigger>
                    <SelectContent>
                      {customCatalogOptionItem(form.prevision, previsiones)}
                      {previsiones.map((p) => (
                        <SelectItem key={p} value={p}>
                          {p}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-lg">Datos Laborales</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Área</Label>
                  <Select value={form.departmentId} onValueChange={updateDepartmentId} disabled={catalogLoading || laborFieldsLocked}>
                    <SelectTrigger>
                      <SelectValue placeholder={catalogLoading ? "Cargando áreas…" : "Seleccionar área"} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__no_dept__">Sin área asignada</SelectItem>
                      {departments.map((d) => (
                        <SelectItem key={d.id} value={String(d.id)}>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Puesto</Label>
                  <Select
                    value={form.puesto}
                    onValueChange={(v) => update("puesto", v)}
                    disabled={catalogLoading || form.departmentId === "__no_dept__" || laborFieldsLocked}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={
                          form.departmentId === "__no_dept__"
                            ? "Selecciona un área primero"
                            : "Seleccionar puesto"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {customCatalogOptionItem(form.puesto, positionOptionsForDepartment)}
                      {positionOptionsForDepartment.map((p) => (
                        <SelectItem key={p} value={p}>
                          {p}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Modalidad</Label>
                  <Select value={form.modalidad} onValueChange={(v) => update("modalidad", v)} disabled={laborFieldsLocked}>
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar" />
                    </SelectTrigger>
                    <SelectContent>
                      {customCatalogOptionItem(form.modalidad, [...EMPLOYEE_MODALITY_OPTIONS])}
                      {EMPLOYEE_MODALITY_OPTIONS.map((m) => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Sueldo (S/)</Label>
                  <Input
                    type="text"
                    inputMode="decimal"
                    placeholder="Ej: 2500"
                    value={form.sueldo}
                    onChange={(e) => update("sueldo", normalizeMoneyDecimalInput(e.target.value))}
                    readOnly={laborFieldsLocked}
                    className={cn(laborFieldsLocked && "bg-muted")}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Tipo de contrato</Label>
                  <Select value={form.tipoContrato} onValueChange={(v) => update("tipoContrato", v)} disabled={laborFieldsLocked}>
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar" />
                    </SelectTrigger>
                    <SelectContent>
                      {customCatalogOptionItem(form.tipoContrato, contratos)}
                      {contratos.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Fecha de inicio</Label>
                  <Input type="date" value={form.fechaInicio} readOnly={laborFieldsLocked} className={cn(laborFieldsLocked && "bg-muted")} onChange={(e) => update("fechaInicio", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Fecha fin de contrato</Label>
                  <Input type="date" value={form.fechaFin} readOnly={laborFieldsLocked} className={cn(laborFieldsLocked && "bg-muted")} onChange={(e) => update("fechaFin", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Jefe directo</Label>
                  <Select value={form.managerId} onValueChange={(v) => update("managerId", v)} disabled={catalogLoading || laborFieldsLocked}>
                    <SelectTrigger>
                      <SelectValue placeholder={catalogLoading ? "Cargando…" : "Seleccionar jefe"} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Sin jefe asignado</SelectItem>
                      {managers.map((m) => (
                        <SelectItem key={m.id} value={String(m.id)}>
                          {formatEmployeeName(m)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{estadoLabel}</Label>
                  <Select value={form.estado} onValueChange={(v) => update("estado", v)} disabled={laborFieldsLocked}>
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar" />
                    </SelectTrigger>
                    <SelectContent>
                      {estados.map((x) => (
                        <SelectItem key={x} value={x}>
                          {x.charAt(0).toUpperCase() + x.slice(1)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Contrato (PDF)</Label>
                  {mode === "edit" ? (
                    documentsLoading ? (
                      <p className="text-sm text-muted-foreground">Cargando documento…</p>
                    ) : existingDocByType.get("contract") ? (
                      <EmployeeDocumentActionBar
                        filename={documentStorageBasename(existingDocByType.get("contract")!.file_path)}
                        busy={documentActionId === existingDocByType.get("contract")!.id}
                        canDelete={canDeleteExistingDocument(existingDocByType.get("contract")!)}
                        onView={() => void handleViewExistingDocument(existingDocByType.get("contract")!)}
                        onDownload={() => void handleDownloadExistingDocument(existingDocByType.get("contract")!)}
                        onDelete={() => void handleDeleteExistingDocument(existingDocByType.get("contract")!)}
                      />
                    ) : (
                      <p className="text-sm text-muted-foreground">Sin archivo registrado.</p>
                    )
                  ) : null}
                  <PendingPdfFileInput
                    pendingFile={pendingDocuments.contract}
                    onFileSelect={handlePendingDocChange("contract")}
                    pendingMessagePrefix={mode === "edit" ? "Se subirá al guardar:" : ""}
                    disabled={laborFieldsLocked}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end gap-3 pb-6">
            <Link to={formBackHref}>
              <Button variant="outline">Cancelar</Button>
            </Link>
            <Button className="gap-2" onClick={handleSave} disabled={saving}>
              <Save className="w-4 h-4" /> {saving ? "Guardando…" : primaryCta}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

