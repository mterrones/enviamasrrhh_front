import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ListPaginationBar } from "@/components/ListPaginationBar";
import { Users, Shield, FileText, Database, Building2, Pencil, Trash2, Copy, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { components } from "@/api/contracts";
import { ApiHttpError } from "@/api/client";
import { fetchAuditLogsPage, type AuditLogRow } from "@/api/auditLogs";
import {
  createDepartment,
  deleteDepartment,
  fetchDepartments,
  updateDepartment,
  type Department,
} from "@/api/departments";
import { fetchRolesList } from "@/api/roles";
import {
  fetchLegalParameters,
  patchLegalParameter,
  type LegalParameterListItem,
} from "@/api/legalParameters";
import {
  deleteCompanyEmployerSignature,
  fetchCompanyEmployerSignatureBlob,
  fetchCompanyProfile,
  patchCompanyProfile,
  uploadCompanyEmployerSignature,
} from "@/api/companyProfile";
import { createUserInvitation, fetchUsersPage, setUserActive, updateUser, type UserAdminUpdate } from "@/api/users";
import { ROLE_LABELS, type AppRole, useAuth } from "@/contexts/AuthContext";
import { DEFAULT_LIST_PAGE_SIZE } from "@/constants/pagination";
import { formatAppDateTime } from "@/lib/formatAppDate";
import { normalizeMoneyDecimalInput, normalizeRatioDecimalInput } from "@/lib/moneyDecimalInput";
import { formatDecimalDisplay } from "@/lib/formatDecimalDisplay";
import { cn } from "@/lib/utils";

function formatAuditDate(iso: string | null): string {
  return formatAppDateTime(iso);
}

function formatAuditMeta(meta: Record<string, unknown> | null, ip: string | null): string {
  const bits: string[] = [];
  if (meta && Object.keys(meta).length > 0) {
    try {
      const s = JSON.stringify(meta);
      bits.push(s.length > 180 ? `${s.slice(0, 180)}…` : s);
    } catch {
      bits.push("(meta)");
    }
  }
  if (ip) bits.push(`IP: ${ip}`);
  return bits.length > 0 ? bits.join(" · ") : "—";
}

function roleLabel(slug: string | null | undefined, displayNameFromApi?: string | null): string {
  if (displayNameFromApi && displayNameFromApi.trim() !== "") return displayNameFromApi.trim();
  if (!slug) return "—";
  return ROLE_LABELS[slug as AppRole] ?? slug;
}

function formatUserCreatedAt(iso: string | null | undefined): string {
  return formatAppDateTime(iso);
}

function buildInviteAbsoluteUrl(invitePath: string): string {
  const path = invitePath.startsWith("/") ? invitePath : `/${invitePath}`;
  if (globalThis.window === undefined) return path;
  return `${globalThis.window.location.origin}${path}`;
}

function normalizeDeptPositionsForApi(rows: string[]): string[] {
  return rows.map(s => s.trim()).filter(s => s.length > 0);
}

function hasDuplicateDeptPositionsInsensitive(rows: string[]): boolean {
  const seen = new Set<string>();
  for (const r of rows) {
    const t = r.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) return true;
    seen.add(k);
  }
  return false;
}

type DeptPositionDraftRow = { key: string; value: string };

function newDeptPositionRow(): DeptPositionDraftRow {
  return { key: globalThis.crypto.randomUUID(), value: "" };
}

function formatApiValidationMessage(err: ApiHttpError): string {
  const ae = err.apiError;
  if (!ae) return err.message;
  if (ae.errors) {
    const first = Object.values(ae.errors).flat()[0];
    if (typeof first === "string" && first.length > 0) return first;
  }
  return ae.message;
}

function formatLegalValueForInput(_unit: string, value: string | null | undefined): string {
  if (value == null || value === "") return "";
  const n = Number(value);
  if (Number.isNaN(n)) return "";
  return formatDecimalDisplay(value);
}

function parseLegalDraftForApi(unit: string, draft: string): number | null {
  const t = draft.trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  if (Number.isNaN(n)) return null;
  if (unit === "pen") {
    if (n <= 0) return null;
    return n;
  }
  if (unit === "percent") {
    if (n <= 0 || n > 1) return null;
    return n;
  }
  return null;
}

function legalDraftsEqual(unit: string, draft: string, baselineFormatted: string): boolean {
  const d = draft.trim();
  const b = baselineFormatted.trim();
  if (d === b) return true;
  const nd = parseLegalDraftForApi(unit, d);
  const nb = parseLegalDraftForApi(unit, b);
  if (nd !== null && nb !== null) return nd === nb;
  return false;
}

function toIsoDateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function minNextEffectiveFromIso(latestEffective: string | null | undefined): string {
  if (latestEffective == null || latestEffective === "") {
    return toIsoDateLocal(new Date());
  }
  const d = new Date(`${latestEffective}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return toIsoDateLocal(d);
}

function compareIsoDateStrings(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

type CompanyFormSnapshot = {
  legalName: string;
  ruc: string;
  industry: string;
  fiscalAddress: string;
  laborCenter: string;
  employerSignerName: string;
  employerSignaturePreview: string | null;
  hasEmployerSignatureFile: boolean;
};

function buildLegalDraftsFromParams(params: LegalParameterListItem[]): Record<string, string> {
  const drafts: Record<string, string> = {};
  for (const p of params) {
    drafts[p.key] = formatLegalValueForInput(p.unit, p.value ?? undefined);
  }
  return drafts;
}

const readOnlyFieldClass = "bg-muted cursor-default";

export default function SettingsPage() {
  const { toast } = useToast();
  const { user: authUser, hasPermission } = useAuth();
  const canManageUsers = hasPermission("settings.users");
  const canBackupTab = hasPermission("settings.backup");
  const canAuditTab = hasPermission("settings.audit");
  const canManageDepartments = hasPermission("settings.departments");
  const canAssignSuperadmin = authUser?.rol === "superadmin_rrhh";
  const [activeTab, setActiveTab] = useState("usuarios");
  const [usuarios, setUsuarios] = useState<components["schemas"]["UserAdmin"][]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [usersPage, setUsersPage] = useState(1);
  const [usersMeta, setUsersMeta] = useState({
    current_page: 1,
    last_page: 1,
    total: 0,
    per_page: DEFAULT_LIST_PAGE_SIZE,
  });
  const [systemRoles, setSystemRoles] = useState<components["schemas"]["RoleListItem"][]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [userFormOpen, setUserFormOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<components["schemas"]["UserAdmin"] | null>(null);
  const [userFormSubmitting, setUserFormSubmitting] = useState(false);
  const [inviteCreated, setInviteCreated] = useState<{ inviteUrl: string; expiresAt: string } | null>(null);
  const [activeToggleUserId, setActiveToggleUserId] = useState<number | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentsLoading, setDepartmentsLoading] = useState(false);
  const [departmentsLoaded, setDepartmentsLoaded] = useState(false);
  const [departmentsError, setDepartmentsError] = useState<string | null>(null);
  const [deptFormOpen, setDeptFormOpen] = useState(false);
  const [deptFormSaving, setDeptFormSaving] = useState(false);
  const [deptEditing, setDeptEditing] = useState<Department | null>(null);
  const [deptNameDraft, setDeptNameDraft] = useState("");
  const [deptPositionsDraft, setDeptPositionsDraft] = useState<DeptPositionDraftRow[]>([]);
  const [deptDeleteOpen, setDeptDeleteOpen] = useState(false);
  const [deptDeleteSaving, setDeptDeleteSaving] = useState(false);
  const [deptPendingDelete, setDeptPendingDelete] = useState<Department | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditPage, setAuditPage] = useState(1);
  const [auditMeta, setAuditMeta] = useState({
    current_page: 1,
    last_page: 1,
    total: 0,
    per_page: DEFAULT_LIST_PAGE_SIZE,
  });
  const [legalParams, setLegalParams] = useState<LegalParameterListItem[]>([]);
  const [legalAt, setLegalAt] = useState<string>("");
  const [legalDrafts, setLegalDrafts] = useState<Record<string, string>>({});
  const [legalLoading, setLegalLoading] = useState(false);
  const [legalError, setLegalError] = useState<string | null>(null);
  const [legalForbidden, setLegalForbidden] = useState(false);
  const [legalSaving, setLegalSaving] = useState(false);
  const [legalValidationErrorKey, setLegalValidationErrorKey] = useState<string | null>(null);
  const [legalVigenciaOpen, setLegalVigenciaOpen] = useState(false);
  const [legalVigenciaParam, setLegalVigenciaParam] = useState<LegalParameterListItem | null>(null);
  const [legalVigenciaNewValue, setLegalVigenciaNewValue] = useState("");
  const [legalVigenciaEffectiveFrom, setLegalVigenciaEffectiveFrom] = useState("");
  const [legalVigenciaSource, setLegalVigenciaSource] = useState("");
  const [legalVigenciaStep, setLegalVigenciaStep] = useState<0 | 1>(0);
  const [legalVigenciaSaving, setLegalVigenciaSaving] = useState(false);
  const [companyLegalName, setCompanyLegalName] = useState("");
  const [companyRuc, setCompanyRuc] = useState("");
  const [companyIndustry, setCompanyIndustry] = useState("");
  const [companyFiscalAddress, setCompanyFiscalAddress] = useState("");
  const [companyLaborCenter, setCompanyLaborCenter] = useState("");
  const [companyEmployerSignerName, setCompanyEmployerSignerName] = useState("");
  const [companyEmployerSignaturePreview, setCompanyEmployerSignaturePreview] = useState<string | null>(null);
  const [companyEmployerSignatureFile, setCompanyEmployerSignatureFile] = useState<File | null>(null);
  const [companyEmployerSignatureMarkedForRemoval, setCompanyEmployerSignatureMarkedForRemoval] = useState(false);
  const [companyHasEmployerSignatureFile, setCompanyHasEmployerSignatureFile] = useState(false);
  const [companyLoading, setCompanyLoading] = useState(false);
  const [companySaving, setCompanySaving] = useState(false);
  const [companyEditing, setCompanyEditing] = useState(false);
  const [legalEditing, setLegalEditing] = useState(false);
  const companySnapshotRef = useRef<CompanyFormSnapshot | null>(null);
  const companySignatureInputRef = useRef<HTMLInputElement | null>(null);
  const companySignatureObjectUrlRef = useRef<string | null>(null);
  const legalDraftsSnapshotRef = useRef<Record<string, string> | null>(null);
  const canEditParams = hasPermission("settings.params");

  const loadDepartments = useCallback(async () => {
    setDepartmentsLoading(true);
    setDepartmentsError(null);
    try {
      const list = await fetchDepartments();
      setDepartments(list);
      setDepartmentsLoaded(true);
    } catch (e) {
      const msg =
        e instanceof ApiHttpError
          ? e.apiError?.message ?? e.message
          : "No se pudieron cargar las áreas";
      setDepartmentsError(typeof msg === "string" ? msg : "No se pudieron cargar las áreas");
      setDepartments([]);
      setDepartmentsLoaded(false);
      toast({ title: "Áreas", description: typeof msg === "string" ? msg : "Error al cargar", variant: "destructive" });
    } finally {
      setDepartmentsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    const needsDepartments = activeTab === "areas" || (userFormOpen && !inviteCreated);
    if (!needsDepartments || departmentsLoaded || departmentsLoading) return;
    void loadDepartments();
  }, [activeTab, userFormOpen, inviteCreated, departmentsLoaded, departmentsLoading, loadDepartments]);

  const loadAuditLogs = useCallback(async () => {
    setAuditLoading(true);
    setAuditError(null);
    try {
      const r = await fetchAuditLogsPage({ page: auditPage, per_page: DEFAULT_LIST_PAGE_SIZE });
      setAuditLogs(r.data);
      setAuditMeta({
        current_page: r.meta.current_page,
        last_page: r.meta.last_page,
        total: r.meta.total,
        per_page: r.meta.per_page,
      });
    } catch (e) {
      const msg =
        e instanceof ApiHttpError ? e.apiError?.message ?? e.message : "No se pudo cargar la auditoría";
      setAuditError(typeof msg === "string" ? msg : "No se pudo cargar la auditoría");
      setAuditLogs([]);
    } finally {
      setAuditLoading(false);
    }
  }, [auditPage]);

  useEffect(() => {
    if (activeTab === "auditoria") {
      loadAuditLogs();
    }
  }, [activeTab, loadAuditLogs]);

  const loadLegalParams = useCallback(async (): Promise<Record<string, string> | null> => {
    if (!hasPermission("settings.params")) return null;
    setLegalLoading(true);
    setLegalError(null);
    setLegalForbidden(false);
    try {
      const r = await fetchLegalParameters();
      setLegalParams(r.data);
      setLegalAt(r.at);
      const drafts = buildLegalDraftsFromParams(r.data);
      setLegalDrafts(drafts);
      setLegalValidationErrorKey(null);
      return drafts;
    } catch (e) {
      if (e instanceof ApiHttpError && e.status === 403) {
        setLegalForbidden(true);
        setLegalParams([]);
        setLegalDrafts({});
      } else {
        const msg =
          e instanceof ApiHttpError ? e.apiError?.message ?? e.message : "No se pudieron cargar los parámetros";
        setLegalError(typeof msg === "string" ? msg : "No se pudieron cargar los parámetros");
        setLegalParams([]);
        setLegalDrafts({});
      }
      return null;
    } finally {
      setLegalLoading(false);
    }
  }, [hasPermission]);

  const setCompanySignaturePreview = useCallback((nextUrl: string | null) => {
    if (companySignatureObjectUrlRef.current) {
      URL.revokeObjectURL(companySignatureObjectUrlRef.current);
      companySignatureObjectUrlRef.current = null;
    }
    if (nextUrl?.startsWith("blob:")) {
      companySignatureObjectUrlRef.current = nextUrl;
    }
    setCompanyEmployerSignaturePreview(nextUrl);
  }, []);

  const loadCompanyProfile = useCallback(async () => {
    if (!hasPermission("settings.params")) return;
    setCompanyLoading(true);
    try {
      const r = await fetchCompanyProfile();
      setCompanyLegalName(r.data.legal_name ?? "");
      setCompanyRuc(r.data.ruc ?? "");
      setCompanyIndustry(r.data.industry ?? "");
      setCompanyFiscalAddress(r.data.fiscal_address ?? "");
      setCompanyLaborCenter(r.data.labor_center ?? "");
      setCompanyEmployerSignerName(r.data.employer_signer_name ?? "");
      setCompanyEmployerSignatureFile(null);
      setCompanyEmployerSignatureMarkedForRemoval(false);
      const hasStoredSignature = Boolean((r.data.employer_signature_path ?? "").trim());
      setCompanyHasEmployerSignatureFile(hasStoredSignature);
      if (hasStoredSignature) {
        try {
          const blob = await fetchCompanyEmployerSignatureBlob();
          setCompanySignaturePreview(URL.createObjectURL(blob));
        } catch {
          setCompanySignaturePreview(null);
        }
      } else {
        setCompanySignaturePreview(null);
      }
    } catch (e) {
      const msg =
        e instanceof ApiHttpError ? e.apiError?.message ?? e.message : "No se pudo cargar el perfil de empresa";
      toast({ title: "Empresa", description: typeof msg === "string" ? msg : "Error al cargar", variant: "destructive" });
    } finally {
      setCompanyLoading(false);
    }
  }, [hasPermission, toast, setCompanySignaturePreview]);

  useEffect(() => {
    if (activeTab !== "parametros") return;
    if (!hasPermission("settings.params")) return;
    void loadLegalParams();
    void loadCompanyProfile();
  }, [activeTab, hasPermission, loadLegalParams, loadCompanyProfile]);

  useEffect(() => {
    if (activeTab === "parametros") return;
    setCompanyEditing(false);
    setCompanyEmployerSignatureFile(null);
    setCompanyEmployerSignatureMarkedForRemoval(false);
    setLegalEditing(false);
    companySnapshotRef.current = null;
    legalDraftsSnapshotRef.current = null;
    setLegalValidationErrorKey(null);
  }, [activeTab]);

  useEffect(() => {
    return () => {
      if (companySignatureObjectUrlRef.current) {
        URL.revokeObjectURL(companySignatureObjectUrlRef.current);
      }
    };
  }, []);

  const legalHasPendingEdits = useMemo(() => {
    return legalParams.some((p) => {
      const baseline = formatLegalValueForInput(p.unit, p.value ?? undefined);
      return !legalDraftsEqual(p.unit, legalDrafts[p.key] ?? "", baseline);
    });
  }, [legalParams, legalDrafts]);

  const assignableRoles = useMemo(() => {
    if (canAssignSuperadmin) return systemRoles;
    return systemRoles.filter((r) => r.slug !== "superadmin_rrhh");
  }, [canAssignSuperadmin, systemRoles]);

  useEffect(() => {
    if (activeTab === "backup" && !canBackupTab) {
      setActiveTab("usuarios");
    }
  }, [activeTab, canBackupTab]);

  useEffect(() => {
    if (canManageUsers) return;
    if (activeTab !== "usuarios") return;
    if (canManageDepartments) {
      setActiveTab("areas");
      return;
    }
    if (hasPermission("settings.params")) {
      setActiveTab("parametros");
    }
  }, [activeTab, canManageUsers, canManageDepartments, hasPermission]);

  const loadUsersTab = useCallback(async () => {
    if (!canManageUsers) return;
    setUsersLoading(true);
    setRolesLoading(true);
    setUsersError(null);
    try {
      const [usersRes, rolesRes] = await Promise.all([
        fetchUsersPage({ page: usersPage, per_page: DEFAULT_LIST_PAGE_SIZE }),
        fetchRolesList(),
      ]);
      setUsuarios(usersRes.data);
      setUsersMeta({
        current_page: usersRes.meta.current_page ?? 1,
        last_page: usersRes.meta.last_page ?? 1,
        total: usersRes.meta.total ?? 0,
        per_page: usersRes.meta.per_page ?? DEFAULT_LIST_PAGE_SIZE,
      });
      setSystemRoles(rolesRes.data);
    } catch (e) {
      const msg =
        e instanceof ApiHttpError ? e.apiError?.message ?? e.message : "No se pudieron cargar los usuarios";
      setUsersError(typeof msg === "string" ? msg : "No se pudieron cargar los usuarios");
      setUsuarios([]);
      setSystemRoles([]);
      toast({
        title: "Usuarios",
        description: typeof msg === "string" ? msg : "Error al cargar",
        variant: "destructive",
      });
    } finally {
      setUsersLoading(false);
      setRolesLoading(false);
    }
  }, [canManageUsers, usersPage, toast]);

  useEffect(() => {
    if (activeTab === "usuarios" && canManageUsers) {
      void loadUsersTab();
    }
  }, [activeTab, canManageUsers, loadUsersTab]);

  // Form fields
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [rol, setRol] = useState("");
  const [departmentId, setDepartmentId] = useState("");

  const resetForm = () => {
    setNombre("");
    setEmail("");
    setRol("");
    setDepartmentId("");
  };

  useEffect(() => {
    if (!userFormOpen) return;
    if (editingUser) {
      setNombre(editingUser.name);
      setEmail(editingUser.email);
      setRol(editingUser.role ?? "");
      setDepartmentId(editingUser.department_id != null ? String(editingUser.department_id) : "");
    } else {
      resetForm();
    }
  }, [userFormOpen, editingUser]);

  const handleGuardar = async () => {
    const isEdit = editingUser != null;
    if (isEdit) {
      if (!rol) {
        toast({ title: "Campos obligatorios", description: "Selecciona un rol.", variant: "destructive" });
        return;
      }
    } else {
      if (!email.trim() || !rol) {
        toast({ title: "Campos obligatorios", description: "Completa email y rol.", variant: "destructive" });
        return;
      }
    }
    if (rol === "jefe_area" && !departmentId) {
      toast({ title: "Campo obligatorio", description: "Selecciona el área para el Jefe de Área.", variant: "destructive" });
      return;
    }
    const roleRow = assignableRoles.find((r) => r.slug === rol);
    if (!roleRow) {
      toast({ title: "Rol", description: "Selecciona un rol válido.", variant: "destructive" });
      return;
    }

    setUserFormSubmitting(true);
    try {
      if (isEdit && editingUser) {
        const body: UserAdminUpdate = {
          role_id: roleRow.id,
          department_id: rol === "jefe_area" ? Number.parseInt(departmentId, 10) : null,
        };
        await updateUser(editingUser.id, body);
        toast({ title: "Usuario actualizado", description: "Los cambios se guardaron correctamente." });
      } else {
        const inv = await createUserInvitation({
          email: email.trim(),
          role_id: roleRow.id,
          department_id: rol === "jefe_area" ? Number.parseInt(departmentId, 10) : null,
        });
        const inviteUrl = buildInviteAbsoluteUrl(inv.data.invite_path);
        setInviteCreated({ inviteUrl, expiresAt: inv.data.expires_at });
        toast({
          title: "Invitación creada",
          description: "Comparte el enlace con el usuario para que complete el registro con Google.",
        });
        resetForm();
        if (usersPage !== 1) {
          setUsersPage(1);
        } else {
          await loadUsersTab();
        }
        return;
      }
      setUserFormOpen(false);
      setEditingUser(null);
      resetForm();
      await loadUsersTab();
    } catch (e) {
      const msg =
        e instanceof ApiHttpError
          ? formatApiValidationMessage(e)
          : isEdit
            ? "No se pudo actualizar el usuario"
            : "No se pudo crear la invitación";
      toast({
        title: isEdit ? "Error al actualizar usuario" : "Error al crear invitación",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setUserFormSubmitting(false);
    }
  };

  const handleSaveLegalParams = useCallback(async () => {
    if (!hasPermission("settings.params")) return;
    setLegalValidationErrorKey(null);

    const rows: { key: string; num: number; effective_from: string }[] = [];
    for (const p of legalParams) {
      const baseline = formatLegalValueForInput(p.unit, p.value ?? undefined);
      const draft = legalDrafts[p.key] ?? "";
      if (legalDraftsEqual(p.unit, draft, baseline)) continue;
      const num = parseLegalDraftForApi(p.unit, draft);
      if (num === null) {
        setLegalValidationErrorKey(p.key);
        toast({
          title: "Valor no válido",
          description:
            p.unit === "pen"
              ? "El monto en soles debe ser mayor que cero."
              : "La tasa debe ser un ratio entre 0 y 1 (ej. 0.10).",
          variant: "destructive",
        });
        return;
      }
      const effective_from = p.effective_from ?? legalAt;
      if (!effective_from) {
        toast({
          title: "Parámetro incompleto",
          description: `No se pudo determinar la vigencia para ${p.label_es}.`,
          variant: "destructive",
        });
        return;
      }
      rows.push({ key: p.key, num, effective_from });
    }

    if (rows.length === 0) return;

    setLegalSaving(true);
    try {
      for (const row of rows) {
        await patchLegalParameter(row.key, { value: row.num, effective_from: row.effective_from });
      }
      toast({
        title: "Parámetros guardados",
        description:
          rows.length === 1 ? "Se aplicó el cambio en el campo editado." : `Se aplicaron ${rows.length} cambios.`,
      });
      legalDraftsSnapshotRef.current = null;
      setLegalEditing(false);
      await loadLegalParams();
    } catch (e) {
      if (e instanceof ApiHttpError && e.status === 403) {
        setLegalForbidden(true);
      }
      const msg = e instanceof ApiHttpError ? formatApiValidationMessage(e) : "No se pudieron guardar los parámetros";
      toast({ title: "Error al guardar", description: msg, variant: "destructive" });
      await loadLegalParams();
    } finally {
      setLegalSaving(false);
    }
  }, [hasPermission, legalParams, legalDrafts, legalAt, toast, loadLegalParams]);

  const handleSaveCompanyProfile = useCallback(async () => {
    if (!hasPermission("settings.params")) return;
    const normalizedRuc = companyRuc.trim();
    if (normalizedRuc !== "" && !/^\d{11}$/.test(normalizedRuc)) {
      toast({
        title: "RUC inválido",
        description: "El RUC debe tener exactamente 11 dígitos.",
        variant: "destructive",
      });
      return;
    }
    setCompanySaving(true);
    try {
      await patchCompanyProfile({
        legal_name: companyLegalName.trim() || null,
        ruc: normalizedRuc || null,
        industry: companyIndustry.trim() || null,
        fiscal_address: companyFiscalAddress.trim() || null,
        labor_center: companyLaborCenter.trim() || null,
        employer_signer_name: companyEmployerSignerName.trim() || null,
      });
      if (companyEmployerSignatureFile) {
        await uploadCompanyEmployerSignature(companyEmployerSignatureFile);
      } else if (companyEmployerSignatureMarkedForRemoval) {
        await deleteCompanyEmployerSignature();
      }
      toast({
        title: "Empresa actualizada",
        description: "Los datos que alimentan la boleta fueron guardados.",
      });
      companySnapshotRef.current = null;
      setCompanyEditing(false);
      await loadCompanyProfile();
    } catch (e) {
      const msg = e instanceof ApiHttpError ? formatApiValidationMessage(e) : "No se pudo guardar el perfil de empresa";
      toast({ title: "Error al guardar", description: msg, variant: "destructive" });
    } finally {
      setCompanySaving(false);
    }
  }, [
    hasPermission,
    companyRuc,
    companyLegalName,
    companyIndustry,
    companyFiscalAddress,
    companyLaborCenter,
    companyEmployerSignerName,
    companyEmployerSignatureFile,
    companyEmployerSignatureMarkedForRemoval,
    toast,
    loadCompanyProfile,
  ]);

  const startCompanyEdit = useCallback(() => {
    companySnapshotRef.current = {
      legalName: companyLegalName,
      ruc: companyRuc,
      industry: companyIndustry,
      fiscalAddress: companyFiscalAddress,
      laborCenter: companyLaborCenter,
      employerSignerName: companyEmployerSignerName,
      employerSignaturePreview: companyEmployerSignaturePreview,
      hasEmployerSignatureFile: companyHasEmployerSignatureFile,
    };
    setCompanyEmployerSignatureMarkedForRemoval(false);
    setCompanyEditing(true);
  }, [
    companyLegalName,
    companyRuc,
    companyIndustry,
    companyFiscalAddress,
    companyLaborCenter,
    companyEmployerSignerName,
    companyEmployerSignaturePreview,
    companyHasEmployerSignatureFile,
  ]);

  const cancelCompanyEdit = useCallback(() => {
    const snapshot = companySnapshotRef.current;
    if (snapshot) {
      setCompanyLegalName(snapshot.legalName);
      setCompanyRuc(snapshot.ruc);
      setCompanyIndustry(snapshot.industry);
      setCompanyFiscalAddress(snapshot.fiscalAddress);
      setCompanyLaborCenter(snapshot.laborCenter);
      setCompanyEmployerSignerName(snapshot.employerSignerName);
      setCompanySignaturePreview(snapshot.employerSignaturePreview);
      setCompanyHasEmployerSignatureFile(snapshot.hasEmployerSignatureFile);
      setCompanyEmployerSignatureFile(null);
      setCompanyEmployerSignatureMarkedForRemoval(false);
    }
    companySnapshotRef.current = null;
    setCompanyEditing(false);
  }, [setCompanySignaturePreview]);

  const startLegalEdit = useCallback(() => {
    legalDraftsSnapshotRef.current = { ...legalDrafts };
    setLegalEditing(true);
  }, [legalDrafts]);

  const cancelLegalEdit = useCallback(() => {
    const snapshot = legalDraftsSnapshotRef.current;
    if (snapshot) {
      setLegalDrafts({ ...snapshot });
    }
    legalDraftsSnapshotRef.current = null;
    setLegalValidationErrorKey(null);
    setLegalEditing(false);
  }, []);

  const handleCompanySignatureChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0] ?? null;
      event.target.value = "";
      if (!file) {
        return;
      }
      setCompanyEmployerSignatureFile(file);
      setCompanyEmployerSignatureMarkedForRemoval(false);
      setCompanyHasEmployerSignatureFile(true);
      setCompanySignaturePreview(URL.createObjectURL(file));
    },
    [setCompanySignaturePreview],
  );

  const clearCompanySignatureSelection = useCallback(() => {
    const hadStoredSignature = Boolean(companySnapshotRef.current?.hasEmployerSignatureFile);
    setCompanyEmployerSignatureFile(null);
    setCompanyEmployerSignatureMarkedForRemoval(hadStoredSignature);
    setCompanySignaturePreview(null);
    setCompanyHasEmployerSignatureFile(false);
  }, [setCompanySignaturePreview]);

  const handleLegalDraftChange = useCallback((key: string, value: string, unit: string) => {
    const next =
      unit === "pen"
        ? normalizeMoneyDecimalInput(value)
        : unit === "percent"
          ? normalizeRatioDecimalInput(value)
          : value;
    setLegalDrafts((prev) => ({ ...prev, [key]: next }));
    setLegalValidationErrorKey((cur) => (cur === key ? null : cur));
  }, []);

  const openLegalVigenciaDialog = useCallback((p: LegalParameterListItem) => {
    setLegalVigenciaParam(p);
    setLegalVigenciaNewValue(formatLegalValueForInput(p.unit, p.value ?? undefined));
    const latest = p.latest_effective_from ?? p.effective_from ?? undefined;
    setLegalVigenciaEffectiveFrom(minNextEffectiveFromIso(latest));
    setLegalVigenciaSource("");
    setLegalVigenciaStep(0);
    setLegalVigenciaOpen(true);
  }, []);

  const handleLegalVigenciaContinue = useCallback(() => {
    if (!legalVigenciaParam) return;
    const p = legalVigenciaParam;
    const num = parseLegalDraftForApi(p.unit, legalVigenciaNewValue);
    if (num === null) {
      toast({
        title: "Valor no válido",
        description:
          p.unit === "pen"
            ? "El monto en soles debe ser mayor que cero."
            : "La tasa debe ser un ratio entre 0 y 1 (ej. 0.10).",
        variant: "destructive",
      });
      return;
    }
    const eff = legalVigenciaEffectiveFrom.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eff)) {
      toast({ title: "Fecha inválida", description: "Usá el formato AAAA-MM-DD.", variant: "destructive" });
      return;
    }
    const latest = p.latest_effective_from;
    if (latest && compareIsoDateStrings(eff, latest) < 0) {
      toast({
        title: "Fecha inválida",
        description: `La vigencia no puede ser anterior a la última registrada (${latest}).`,
        variant: "destructive",
      });
      return;
    }
    setLegalVigenciaStep(1);
  }, [legalVigenciaParam, legalVigenciaNewValue, legalVigenciaEffectiveFrom, toast]);

  const handleLegalVigenciaConfirm = useCallback(async () => {
    if (!legalVigenciaParam) return;
    const p = legalVigenciaParam;
    const num = parseLegalDraftForApi(p.unit, legalVigenciaNewValue);
    if (num === null) return;
    setLegalVigenciaSaving(true);
    try {
      await patchLegalParameter(p.key, {
        value: num,
        effective_from: legalVigenciaEffectiveFrom.trim(),
        source_note: legalVigenciaSource.trim(),
      });
      toast({
        title: "Vigencia registrada",
        description: "El parámetro quedó actualizado según la fecha y la trazabilidad indicadas.",
      });
      setLegalVigenciaOpen(false);
      setLegalVigenciaParam(null);
      setLegalVigenciaStep(0);
      const drafts = await loadLegalParams();
      if (legalEditing && drafts) {
        legalDraftsSnapshotRef.current = { ...drafts };
      }
    } catch (e) {
      const msg = e instanceof ApiHttpError ? formatApiValidationMessage(e) : "No se pudo registrar la vigencia";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setLegalVigenciaSaving(false);
    }
  }, [
    legalVigenciaParam,
    legalVigenciaNewValue,
    legalVigenciaEffectiveFrom,
    legalVigenciaSource,
    toast,
    loadLegalParams,
    legalEditing,
  ]);

  const openDeptCreate = () => {
    setDeptEditing(null);
    setDeptNameDraft("");
    setDeptPositionsDraft([]);
    setDeptFormOpen(true);
  };

  const openDeptEdit = (d: Department) => {
    setDeptEditing(d);
    setDeptNameDraft(d.name);
    setDeptPositionsDraft(
      d.positions?.length
        ? d.positions.map(p => ({ key: `db-${p.id}`, value: p.name }))
        : [],
    );
    setDeptFormOpen(true);
  };

  const openDeptDelete = (d: Department) => {
    setDeptPendingDelete(d);
    setDeptDeleteOpen(true);
  };

  const handleDeptFormSave = async () => {
    const name = deptNameDraft.trim();
    if (!name) {
      toast({ title: "Área", description: "Indica un nombre para el área.", variant: "destructive" });
      return;
    }
    const positionValues = deptPositionsDraft.map(r => r.value);
    if (hasDuplicateDeptPositionsInsensitive(positionValues)) {
      toast({
        title: "Puestos",
        description: "No puedes repetir el mismo nombre de puesto en el listado.",
        variant: "destructive",
      });
      return;
    }
    const positions = normalizeDeptPositionsForApi(positionValues);
    setDeptFormSaving(true);
    try {
      if (deptEditing) {
        await updateDepartment(deptEditing.id, { name, positions });
        toast({ title: "Área actualizada", description: "Los cambios se guardaron correctamente." });
      } else {
        await createDepartment({ name, positions });
        toast({ title: "Área creada", description: "El departamento se registró correctamente." });
      }
      setDeptFormOpen(false);
      setDeptEditing(null);
      setDeptNameDraft("");
      setDeptPositionsDraft([]);
      await loadDepartments();
    } catch (e) {
      const msg = e instanceof ApiHttpError ? formatApiValidationMessage(e) : "No se pudo guardar el área";
      toast({ title: "Área", description: msg, variant: "destructive" });
    } finally {
      setDeptFormSaving(false);
    }
  };

  const handleDeptDeleteConfirm = async () => {
    if (!deptPendingDelete) return;
    setDeptDeleteSaving(true);
    try {
      await deleteDepartment(deptPendingDelete.id);
      toast({ title: "Área eliminada", description: `Se eliminó «${deptPendingDelete.name}».` });
      setDeptDeleteOpen(false);
      setDeptPendingDelete(null);
      await loadDepartments();
    } catch (e) {
      const msg =
        e instanceof ApiHttpError ? formatApiValidationMessage(e) : "No se pudo eliminar el área";
      toast({ title: "No se puede eliminar", description: msg, variant: "destructive" });
    } finally {
      setDeptDeleteSaving(false);
    }
  };

  const handleToggleActive = async (row: components["schemas"]["UserAdmin"], nextActive: boolean) => {
    setActiveToggleUserId(row.id);
    try {
      await setUserActive(row.id, nextActive);
      toast({
        title: nextActive ? "Usuario reactivado" : "Usuario desactivado",
        description: nextActive
          ? "El usuario puede volver a iniciar sesión."
          : "El usuario quedó inactivo y sus sesiones se cerraron.",
      });
      await loadUsersTab();
    } catch (e) {
      const msg = e instanceof ApiHttpError ? formatApiValidationMessage(e) : "No se pudo actualizar el estado";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setActiveToggleUserId(null);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Configuración</h1>
        <p className="text-muted-foreground text-sm mt-1">Administración del sistema</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-card border border-border">
          {canManageUsers ? (
            <TabsTrigger value="usuarios" className="gap-1.5"><Users className="w-4 h-4" />Usuarios</TabsTrigger>
          ) : null}
          <TabsTrigger value="areas" className="gap-1.5"><Building2 className="w-4 h-4" />Áreas</TabsTrigger>
          <TabsTrigger value="parametros" className="gap-1.5"><Shield className="w-4 h-4" />Parámetros</TabsTrigger>
          {canAuditTab ? (
            <TabsTrigger value="auditoria" className="gap-1.5"><FileText className="w-4 h-4" />Auditoría</TabsTrigger>
          ) : null}
          {canBackupTab ? (
            <TabsTrigger value="backup" className="gap-1.5"><Database className="w-4 h-4" />Backup</TabsTrigger>
          ) : null}
        </TabsList>

        <TabsContent value="usuarios" className="mt-4">
          <Card className="shadow-card">
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-base">Gestión de Usuarios</CardTitle>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={() => void loadUsersTab()}
                  disabled={usersLoading || !canManageUsers}
                >
                  Actualizar
                </Button>
                <Button
                  size="sm"
                  type="button"
                  disabled={!canManageUsers}
                  onClick={() => {
                    setEditingUser(null);
                    setInviteCreated(null);
                    setUserFormOpen(true);
                  }}
                >
                  Nuevo Usuario
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {!canManageUsers ? (
                <p className="text-sm text-muted-foreground px-5 py-8">
                  No tienes permiso para gestionar usuarios.
                </p>
              ) : usersLoading ? (
                <p className="text-sm text-muted-foreground px-5 py-8">Cargando…</p>
              ) : usersError ? (
                <div className="px-5 py-8 space-y-3">
                  <p className="text-sm text-destructive">{usersError}</p>
                  <Button size="sm" variant="outline" type="button" onClick={() => void loadUsersTab()}>
                    Reintentar
                  </Button>
                </div>
              ) : usuarios.length === 0 ? (
                <p className="text-sm text-muted-foreground px-5 py-8">No hay usuarios para mostrar.</p>
              ) : (
                <>
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border bg-muted/50">
                        {["Nombre", "Email", "Rol", "Estado", "Registro", "Acciones"].map((h) => (
                          <th key={h} className="text-left text-xs font-semibold text-muted-foreground px-5 py-3">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {usuarios.map((u) => (
                        <tr key={u.id} className="border-b border-border last:border-0">
                          <td className="px-5 py-3 text-sm font-medium">{u.name}</td>
                          <td className="px-5 py-3 text-sm text-muted-foreground">{u.email}</td>
                          <td className="px-5 py-3">
                            <Badge variant="secondary" className="text-xs">
                              {roleLabel(u.role ?? undefined)}
                            </Badge>
                          </td>
                          <td className="px-5 py-3">
                            <Badge variant={u.is_active ? "default" : "secondary"} className="text-xs">
                              {u.is_active ? "Activo" : "Inactivo"}
                            </Badge>
                          </td>
                          <td className="px-5 py-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                            {formatUserCreatedAt(u.created_at ?? undefined)}
                          </td>
                          <td className="px-5 py-3">
                            <div className="flex flex-wrap items-center gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-xs text-primary"
                                type="button"
                                onClick={() => {
                                  if (!canAssignSuperadmin && (u.role ?? "") === "superadmin_rrhh") {
                                    toast({
                                      title: "Sin permiso",
                                      description: "No puedes editar usuarios con rol Superadmin RRHH.",
                                      variant: "destructive",
                                    });
                                    return;
                                  }
                                  setInviteCreated(null);
                                  setEditingUser(u);
                                  setUserFormOpen(true);
                                }}
                              >
                                Editar
                              </Button>
                              {u.is_active ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="text-xs"
                                  type="button"
                                  disabled={
                                    activeToggleUserId === u.id ||
                                    (authUser != null && Number(authUser.id) === u.id)
                                  }
                                  title={
                                    authUser != null && Number(authUser.id) === u.id
                                      ? "No puedes desactivar tu propia cuenta"
                                      : undefined
                                  }
                                  onClick={() => void handleToggleActive(u, false)}
                                >
                                  {activeToggleUserId === u.id ? "…" : "Desactivar"}
                                </Button>
                              ) : (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="text-xs"
                                  type="button"
                                  disabled={activeToggleUserId === u.id}
                                  onClick={() => void handleToggleActive(u, true)}
                                >
                                  {activeToggleUserId === u.id ? "…" : "Reactivar"}
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {usersMeta.total > 0 ? (
                    <ListPaginationBar
                      page={usersMeta.current_page}
                      lastPage={usersMeta.last_page}
                      total={usersMeta.total}
                      pageSize={usersMeta.per_page}
                      loading={usersLoading}
                      onPageChange={setUsersPage}
                    />
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="areas" className="mt-4">
          <Card className="shadow-card">
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-base">Áreas (departamentos)</CardTitle>
              <div className="flex flex-wrap gap-2 justify-end">
                {canManageDepartments ? (
                  <Button size="sm" type="button" onClick={() => openDeptCreate()}>
                    Nueva área
                  </Button>
                ) : null}
                <Button size="sm" variant="outline" type="button" onClick={() => loadDepartments()} disabled={departmentsLoading}>
                  Actualizar
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {departmentsLoading ? (
                <p className="text-sm text-muted-foreground px-5 py-8">Cargando…</p>
              ) : departmentsError ? (
                <div className="px-5 py-8 space-y-3">
                  <p className="text-sm text-destructive">{departmentsError}</p>
                  <Button size="sm" variant="outline" type="button" onClick={() => loadDepartments()}>
                    Reintentar
                  </Button>
                </div>
              ) : departments.length === 0 ? (
                <p className="text-sm text-muted-foreground px-5 py-8">No hay áreas registradas en el sistema.</p>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="text-left text-xs font-semibold text-muted-foreground px-5 py-3">ID</th>
                      <th className="text-left text-xs font-semibold text-muted-foreground px-5 py-3">Área</th>
                      <th className="text-left text-xs font-semibold text-muted-foreground px-5 py-3">Puestos</th>
                      {canManageDepartments ? (
                        <th className="text-right text-xs font-semibold text-muted-foreground px-5 py-3">Acciones</th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {departments.map((d) => (
                      <tr key={d.id} className="border-b border-border last:border-0">
                        <td className="px-5 py-3 text-sm text-muted-foreground tabular-nums">{d.id}</td>
                        <td className="px-5 py-3 text-sm font-medium">{d.name}</td>
                        <td className="px-5 py-3 text-sm text-muted-foreground tabular-nums">
                          {d.positions?.length ?? 0}
                        </td>
                        {canManageDepartments ? (
                          <td className="px-5 py-3 text-right">
                            <div className="inline-flex gap-1.5 justify-end">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8 px-2"
                                onClick={() => openDeptEdit(d)}
                              >
                                <Pencil className="w-3.5 h-3.5 mr-1" />
                                Editar
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8 px-2 text-destructive border-destructive/40 hover:bg-destructive/10"
                                onClick={() => openDeptDelete(d)}
                              >
                                <Trash2 className="w-3.5 h-3.5 mr-1" />
                                Eliminar
                              </Button>
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="parametros" className="mt-4">
          <Card className="shadow-card mb-4">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="space-y-1">
                <CardTitle className="text-base">Datos de Empresa para Boleta</CardTitle>
                <p className="text-xs text-muted-foreground font-normal">
                  Estos datos se usan en la boleta PDF y en la vista previa de nómina. Presioná «Editar» para
                  modificarlos y «Guardar» para confirmar los cambios.
                </p>
              </div>
              {canEditParams ? (
                <div className="flex items-center gap-2 shrink-0">
                  {companyEditing ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        type="button"
                        disabled={companySaving}
                        onClick={cancelCompanyEdit}
                      >
                        Cancelar
                      </Button>
                      <Button
                        size="sm"
                        type="button"
                        disabled={companyLoading || companySaving}
                        onClick={() => void handleSaveCompanyProfile()}
                      >
                        {companySaving ? "Guardando…" : "Guardar"}
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      type="button"
                      disabled={companyLoading}
                      onClick={startCompanyEdit}
                    >
                      <Pencil className="w-3.5 h-3.5 mr-1" />
                      Editar
                    </Button>
                  )}
                </div>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-4 max-w-5xl">
              {!canEditParams ? (
                <p className="text-sm text-muted-foreground">No tienes permiso para editar los datos de empresa.</p>
              ) : companyLoading ? (
                <p className="text-sm text-muted-foreground">Cargando…</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Razón social</Label>
                    <Input
                      value={companyLegalName}
                      readOnly={!companyEditing}
                      className={cn(!companyEditing && readOnlyFieldClass)}
                      onChange={(e) => setCompanyLegalName(e.target.value)}
                      placeholder="Ej: EnviaMas S.A.C."
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Rubro</Label>
                    <Input
                      value={companyIndustry}
                      readOnly={!companyEditing}
                      className={cn(!companyEditing && readOnlyFieldClass)}
                      onChange={(e) => setCompanyIndustry(e.target.value)}
                      placeholder="Ej: Logística y transporte"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>RUC</Label>
                    <Input
                      value={companyRuc}
                      maxLength={11}
                      inputMode="numeric"
                      readOnly={!companyEditing}
                      className={cn(!companyEditing && readOnlyFieldClass)}
                      onChange={(e) => setCompanyRuc(e.target.value.replace(/\D/g, "").slice(0, 11))}
                      placeholder="11 dígitos"
                    />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Label>Domicilio fiscal</Label>
                    <Input
                      value={companyFiscalAddress}
                      readOnly={!companyEditing}
                      className={cn(!companyEditing && readOnlyFieldClass)}
                      onChange={(e) => setCompanyFiscalAddress(e.target.value)}
                      placeholder="Ej: Av. Principal 123, Lima"
                    />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Label>Centro de labores por defecto</Label>
                    <Input
                      value={companyLaborCenter}
                      readOnly={!companyEditing}
                      className={cn(!companyEditing && readOnlyFieldClass)}
                      onChange={(e) => setCompanyLaborCenter(e.target.value)}
                      placeholder="Ej: Sede Lima"
                    />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Label>Nombre firmante del empleador</Label>
                    <Input
                      value={companyEmployerSignerName}
                      readOnly={!companyEditing}
                      className={cn(!companyEditing && readOnlyFieldClass)}
                      onChange={(e) => setCompanyEmployerSignerName(e.target.value)}
                      placeholder="Ej: Carlos Medina"
                    />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Label>Firma del empleador (imagen)</Label>
                    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
                      <div className="h-14 flex items-end justify-center rounded-md bg-muted/40 overflow-hidden">
                        {companyEmployerSignaturePreview ? (
                          <img
                            src={companyEmployerSignaturePreview}
                            alt="Firma del empleador"
                            className="max-h-12 max-w-full object-contain"
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {companyHasEmployerSignatureFile ? "Firma cargada" : "Sin firma cargada"}
                          </span>
                        )}
                      </div>
                      {companyEditing ? (
                        <div className="flex items-center gap-2">
                          <input
                            ref={companySignatureInputRef}
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            className="hidden"
                            onChange={handleCompanySignatureChange}
                          />
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => companySignatureInputRef.current?.click()}
                          >
                            {companyEmployerSignaturePreview ? "Cambiar firma" : "Subir firma"}
                          </Button>
                          {companyEmployerSignaturePreview ? (
                            <Button type="button" size="sm" variant="ghost" onClick={clearCompanySignatureSelection}>
                              Quitar
                            </Button>
                          ) : null}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">Habilita edición para cambiar la firma.</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
          <Card className="shadow-card">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="space-y-1">
                <CardTitle className="text-base">Parámetros Legales</CardTitle>
                <p className="text-xs text-muted-foreground font-normal leading-relaxed max-w-md">
                  Presioná «Editar» para modificar los valores vigentes. Confirmá con «Guardar» o descartá con
                  «Cancelar». Para registrar una nueva vigencia con fecha y fuente normativa usá «Nueva vigencia» en
                  cada parámetro mientras estés editando.
                </p>
              </div>
              {canEditParams && !legalForbidden ? (
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {legalEditing ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        type="button"
                        disabled={legalSaving}
                        onClick={cancelLegalEdit}
                      >
                        Cancelar
                      </Button>
                      <Button
                        size="sm"
                        type="button"
                        onClick={() => void handleSaveLegalParams()}
                        disabled={!legalHasPendingEdits || legalSaving || legalLoading}
                      >
                        {legalSaving ? "Guardando…" : "Guardar"}
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      type="button"
                      disabled={legalLoading}
                      onClick={startLegalEdit}
                    >
                      <Pencil className="w-3.5 h-3.5 mr-1" />
                      Editar
                    </Button>
                  )}
                </div>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-4 max-w-5xl">
              {!canEditParams ? (
                <p className="text-sm text-muted-foreground">
                  No tienes permiso para ver ni editar los parámetros legales.
                </p>
              ) : legalForbidden ? (
                <p className="text-sm text-destructive">No tienes permiso para acceder a estos parámetros.</p>
              ) : legalLoading ? (
                <p className="text-sm text-muted-foreground">Cargando…</p>
              ) : legalError ? (
                <div className="space-y-3">
                  <p className="text-sm text-destructive">{legalError}</p>
                  <Button size="sm" variant="outline" type="button" onClick={() => void loadLegalParams()}>
                    Reintentar
                  </Button>
                </div>
              ) : legalParams.length === 0 ? (
                <p className="text-sm text-muted-foreground">No hay parámetros legales en el catálogo.</p>
              ) : (
                <>
                  {legalAt ? (
                    <p className="text-xs text-muted-foreground">Valores vigentes al {legalAt}.</p>
                  ) : null}
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-x-6 md:gap-y-4">
                  {legalParams.map((p: LegalParameterListItem) => {
                    const baselineFormatted = formatLegalValueForInput(p.unit, p.value ?? undefined);
                    const draftVal = legalDrafts[p.key] ?? "";
                    const rowDirty = !legalDraftsEqual(p.unit, draftVal, baselineFormatted);
                    return (
                    <div
                      key={p.key}
                      className="space-y-1.5 rounded-lg border border-border bg-card p-3"
                    >
                      <Label className="text-sm">{p.label_es}</Label>
                      {p.description ? (
                        <p className="text-xs text-muted-foreground">{p.description}</p>
                      ) : null}
                      {p.effective_from ? (
                        <p className="text-xs text-muted-foreground">Vigencia desde {p.effective_from}</p>
                      ) : null}
                      <Input
                        value={draftVal}
                        readOnly={!legalEditing}
                        className={cn(!legalEditing && readOnlyFieldClass)}
                        onChange={(e) => handleLegalDraftChange(p.key, e.target.value, p.unit)}
                        placeholder={p.unit === "pen" ? "0.00" : "0.00–1"}
                        inputMode="decimal"
                        disabled={legalSaving}
                      />
                      {p.unit === "percent" ? (
                        <p className="text-xs text-muted-foreground">
                          Ratio entre 0 y 1 (ej. 0.10 = 10%). Hasta 8 decimales si necesitas más precisión.
                        </p>
                      ) : null}
                      {legalEditing ? (
                        legalValidationErrorKey === p.key ? (
                          <p className="text-xs text-destructive">
                            Valor no válido. Tasas: ratio 0–1; montos en soles &gt; 0.
                          </p>
                        ) : rowDirty ? (
                          <p className="text-xs text-muted-foreground">Cambios pendientes</p>
                        ) : (
                          <p className="text-xs text-muted-foreground">Sin cambios</p>
                        )
                      ) : null}
                      <div className="flex justify-end pt-0.5">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="text-xs h-8"
                          onClick={() => openLegalVigenciaDialog(p)}
                          disabled={!legalEditing || legalSaving}
                        >
                          Nueva vigencia
                        </Button>
                      </div>
                    </div>
                    );
                  })}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="auditoria" className="mt-4">
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-base">Registro de Auditoría</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {auditLoading ? (
                <p className="text-sm text-muted-foreground px-5 py-8">Cargando…</p>
              ) : auditError ? (
                <div className="px-5 py-8 space-y-3">
                  <p className="text-sm text-destructive">{auditError}</p>
                  <Button size="sm" variant="outline" type="button" onClick={() => loadAuditLogs()}>
                    Reintentar
                  </Button>
                </div>
              ) : auditLogs.length === 0 ? (
                <p className="text-sm text-muted-foreground px-5 py-8">No hay eventos de auditoría registrados.</p>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      {["Fecha", "Usuario", "Acción", "Recurso", "ID", "Metadatos"].map(h => (
                        <th key={h} className="text-left text-xs font-semibold text-muted-foreground px-5 py-3">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.map(l => (
                      <tr key={l.id} className="border-b border-border last:border-0">
                        <td className="px-5 py-3 text-xs text-muted-foreground whitespace-nowrap">
                          {formatAuditDate(l.created_at)}
                        </td>
                        <td className="px-5 py-3 text-sm max-w-[140px] break-words">
                          {l.user?.name?.trim() || l.user?.email || "—"}
                        </td>
                        <td className="px-5 py-3 text-sm font-medium">{l.action}</td>
                        <td className="px-5 py-3 text-sm">{l.resource_type}</td>
                        <td className="px-5 py-3 text-sm text-muted-foreground tabular-nums">
                          {l.resource_id != null ? l.resource_id : "—"}
                        </td>
                        <td className="px-5 py-3 text-xs text-muted-foreground max-w-md break-words">
                          {formatAuditMeta(l.meta, l.ip_address)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {!auditLoading && !auditError && auditMeta.total > 0 ? (
                <ListPaginationBar
                  page={auditMeta.current_page}
                  lastPage={auditMeta.last_page}
                  total={auditMeta.total}
                  pageSize={auditMeta.per_page}
                  loading={auditLoading}
                  onPageChange={setAuditPage}
                />
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        {canBackupTab ? (
          <TabsContent value="backup" className="mt-4">
            <Card className="shadow-card">
              <CardHeader><CardTitle className="text-base">Backup y Restauración</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  El respaldo y la restauración de la base de datos no están disponibles desde esta aplicación. Deben
                  configurarse y ejecutarse en el entorno de servidor o con las herramientas del proveedor de
                  infraestructura (copias programadas, almacenamiento externo, procedimientos de restauración).
                </p>
                <Separator />
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">Estado actual</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>La auditoría funcional de acciones de usuario sigue disponible en la pestaña Auditoría.</li>
                    <li>
                      Tareas automáticas del sistema (por ejemplo recordatorios de contratos) registran eventos técnicos
                      en el log operativo del servidor (<span className="font-mono text-xs">storage/logs/operations-*.log</span>).
                    </li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        ) : null}
      </Tabs>

      {/* Dialog Nuevo / Editar usuario */}
      <Dialog
        open={userFormOpen}
        onOpenChange={(open) => {
          if (!open && userFormSubmitting) return;
          if (!open) {
            resetForm();
            setEditingUser(null);
            setInviteCreated(null);
          }
          setUserFormOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {inviteCreated
                ? "Invitación lista"
                : editingUser
                  ? "Editar usuario"
                  : "Invitar usuario"}
            </DialogTitle>
          </DialogHeader>
          {inviteCreated ? (
            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">
                Comparte este enlace. El usuario debe registrarse con Google usando el mismo correo invitado. Caduca:{" "}
                {formatUserCreatedAt(inviteCreated.expiresAt)}
              </p>
              <div className="flex gap-2">
                <Input readOnly value={inviteCreated.inviteUrl} className="font-mono text-xs" />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="shrink-0"
                  title="Copiar enlace"
                  onClick={() => {
                    void navigator.clipboard.writeText(inviteCreated.inviteUrl).then(() => {
                      toast({ title: "Copiado", description: "El enlace está en el portapapeles." });
                    });
                  }}
                >
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ) : null}
          {!inviteCreated ? (
          <div className="space-y-4 py-2">
            {editingUser ? (
              <div className="space-y-1.5">
                <Label className="text-sm">Nombre completo</Label>
                <Input
                  value={nombre}
                  readOnly
                  tabIndex={-1}
                  placeholder="Ej: María García"
                  className="bg-muted cursor-not-allowed"
                  disabled={userFormSubmitting}
                />
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label className="text-sm">{editingUser ? "Email" : "Email *"}</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => {
                  if (!editingUser) setEmail(e.target.value);
                }}
                readOnly={!!editingUser}
                tabIndex={editingUser ? -1 : undefined}
                placeholder="usuario@enviamas.pe"
                className={editingUser ? "bg-muted cursor-not-allowed" : undefined}
                disabled={userFormSubmitting}
              />
              {!editingUser ? (
                <p className="text-xs text-muted-foreground">Debe coincidir con la cuenta Google del invitado.</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Rol *</Label>
              <Select
                value={rol}
                onValueChange={(v) => {
                  setRol(v);
                  if (v !== "jefe_area") setDepartmentId("");
                }}
                disabled={rolesLoading || assignableRoles.length === 0 || userFormSubmitting}
              >
                <SelectTrigger>
                  <SelectValue placeholder={rolesLoading ? "Cargando roles…" : "Seleccionar rol"} />
                </SelectTrigger>
                <SelectContent>
                  {assignableRoles.map((r) => (
                    <SelectItem key={r.id} value={r.slug}>
                      {roleLabel(r.slug, r.name)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!rolesLoading && assignableRoles.length === 0 ? (
                <p className="text-xs text-muted-foreground">No hay roles en el servidor. Ejecuta el seed RBAC o revisa permisos.</p>
              ) : null}
            </div>
            {rol === "jefe_area" && (
              <div className="space-y-1.5">
                <Label className="text-sm">Área *</Label>
                <Select
                  value={departmentId}
                  onValueChange={setDepartmentId}
                  disabled={departmentsLoading || !!departmentsError || userFormSubmitting}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={departmentsLoading ? "Cargando áreas…" : "Seleccionar área"} />
                  </SelectTrigger>
                  <SelectContent>
                    {departments.map((d) => (
                      <SelectItem key={d.id} value={String(d.id)}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!departmentsLoading && !departmentsError && departments.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No hay áreas en el servidor. Registra departamentos en la base de datos.</p>
                ) : null}
              </div>
            )}
          </div>
          ) : null}
          <DialogFooter>
            {inviteCreated ? (
              <Button
                onClick={() => {
                  setInviteCreated(null);
                  resetForm();
                  setUserFormOpen(false);
                }}
              >
                Cerrar
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  disabled={userFormSubmitting}
                  onClick={() => {
                    resetForm();
                    setEditingUser(null);
                    setUserFormOpen(false);
                  }}
                >
                  Cancelar
                </Button>
                <Button disabled={userFormSubmitting} onClick={() => void handleGuardar()}>
                  {userFormSubmitting ? "Guardando…" : editingUser ? "Guardar cambios" : "Crear invitación"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={legalVigenciaOpen}
        onOpenChange={(open) => {
          if (!open && legalVigenciaSaving) return;
          if (!open) {
            setLegalVigenciaParam(null);
            setLegalVigenciaStep(0);
          }
          setLegalVigenciaOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {legalVigenciaParam ? `Nueva vigencia — ${legalVigenciaParam.label_es}` : "Nueva vigencia"}
            </DialogTitle>
          </DialogHeader>
          {legalVigenciaParam ? (
            <div className="space-y-4 py-2">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Valor vigente al listar ({legalAt ? `corte ${legalAt}` : "hoy"}):{" "}
                <span className="text-foreground font-medium tabular-nums">
                  {legalVigenciaParam.value != null && legalVigenciaParam.value !== ""
                    ? legalVigenciaParam.unit === "pen"
                      ? `S/ ${Number.parseFloat(formatDecimalDisplay(legalVigenciaParam.value)).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                      : formatDecimalDisplay(legalVigenciaParam.value)
                    : "—"}
                </span>
                {legalVigenciaParam.latest_effective_from ? (
                  <span className="block mt-1">
                    Última vigencia registrada en historial: {legalVigenciaParam.latest_effective_from}
                  </span>
                ) : null}
              </p>
              {legalVigenciaStep === 0 ? (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-sm">Nuevo valor</Label>
                    <Input
                      value={legalVigenciaNewValue}
                      onChange={(e) =>
                        setLegalVigenciaNewValue(
                          legalVigenciaParam.unit === "pen"
                            ? normalizeMoneyDecimalInput(e.target.value)
                            : legalVigenciaParam.unit === "percent"
                              ? normalizeRatioDecimalInput(e.target.value)
                              : e.target.value,
                        )
                      }
                      placeholder={legalVigenciaParam.unit === "pen" ? "0.00" : "0.00–1"}
                      inputMode="decimal"
                      disabled={legalVigenciaSaving}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm">Vigencia desde (AAAA-MM-DD)</Label>
                    <Input
                      type="date"
                      value={legalVigenciaEffectiveFrom}
                      onChange={(e) => setLegalVigenciaEffectiveFrom(e.target.value)}
                      disabled={legalVigenciaSaving}
                    />
                    <p className="text-xs text-muted-foreground">
                      Debe ser igual o posterior a la última vigencia del historial para crear o ajustar el tramo
                      correspondiente.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm">Fuente / norma / enlace (trazabilidad)</Label>
                    <Textarea
                      value={legalVigenciaSource}
                      onChange={(e) => setLegalVigenciaSource(e.target.value)}
                      placeholder="Ej. DS N.º … · Resolución … · URL institucional"
                      rows={3}
                      disabled={legalVigenciaSaving}
                      className="resize-y min-h-[72px]"
                    />
                  </div>
                </>
              ) : (
                <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2 text-sm">
                  <p className="font-medium text-foreground">Confirmá antes de aplicar</p>
                  <dl className="grid gap-1.5 text-xs sm:text-sm">
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">Valor actual (vigente al listar)</dt>
                      <dd className="font-medium tabular-nums text-right">
                        {legalVigenciaParam.value != null && legalVigenciaParam.value !== ""
                          ? legalVigenciaParam.unit === "pen"
                            ? `S/ ${Number.parseFloat(formatDecimalDisplay(legalVigenciaParam.value)).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                            : formatDecimalDisplay(legalVigenciaParam.value)
                          : "—"}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">Nuevo valor</dt>
                      <dd className="font-medium tabular-nums text-right">{legalVigenciaNewValue.trim() || "—"}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">Aplicará desde</dt>
                      <dd className="font-medium text-right">{legalVigenciaEffectiveFrom.trim()}</dd>
                    </div>
                    <div className="pt-1 border-t border-border/60">
                      <dt className="text-muted-foreground mb-0.5">Fuente</dt>
                      <dd className="text-foreground whitespace-pre-wrap break-words">
                        {legalVigenciaSource.trim() !== "" ? legalVigenciaSource.trim() : "(sin texto: se guardará nota genérica)"}
                      </dd>
                    </div>
                  </dl>
                  <p className="text-xs text-muted-foreground pt-1">
                    No se modifican boletas ya guardadas; los nuevos cálculos usarán la vigencia según la fecha de
                    referencia del periodo.
                  </p>
                </div>
              )}
            </div>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-0">
            {legalVigenciaStep === 0 ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={legalVigenciaSaving}
                  onClick={() => setLegalVigenciaOpen(false)}
                >
                  Cancelar
                </Button>
                <Button type="button" disabled={legalVigenciaSaving} onClick={() => handleLegalVigenciaContinue()}>
                  Revisar y confirmar
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={legalVigenciaSaving}
                  onClick={() => setLegalVigenciaStep(0)}
                >
                  Atrás
                </Button>
                <Button type="button" disabled={legalVigenciaSaving} onClick={() => void handleLegalVigenciaConfirm()}>
                  {legalVigenciaSaving ? "Aplicando…" : "Confirmar vigencia"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deptFormOpen}
        onOpenChange={(open) => {
          if (!open && deptFormSaving) return;
          if (!open) {
            setDeptEditing(null);
            setDeptNameDraft("");
            setDeptPositionsDraft([]);
          }
          setDeptFormOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{deptEditing ? "Editar área" : "Nueva área"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-sm">Nombre del área *</Label>
              <Input
                value={deptNameDraft}
                onChange={(e) => setDeptNameDraft(e.target.value)}
                placeholder="Ej: Operaciones"
                disabled={deptFormSaving}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm">Puestos del área</Label>
              <p className="text-xs text-muted-foreground">
                Opcional. Cargos habituales de esta área; puedes añadir varios (máx. 50). No podrás quitar un puesto si
                algún colaborador del área tiene ese cargo en su ficha (campo Puesto).
              </p>
              <div className="space-y-2">
                {deptPositionsDraft.map(row => (
                  <div key={row.key} className="flex gap-2 items-center">
                    <Input
                      value={row.value}
                      onChange={e => {
                        const v = e.target.value;
                        setDeptPositionsDraft(prev =>
                          prev.map(x => (x.key === row.key ? { ...x, value: v } : x)),
                        );
                      }}
                      placeholder="Ej: Supervisor"
                      disabled={deptFormSaving}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="shrink-0"
                      disabled={deptFormSaving}
                      onClick={() => setDeptPositionsDraft(prev => prev.filter(x => x.key !== row.key))}
                      aria-label="Quitar puesto"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="w-full"
                disabled={deptFormSaving || deptPositionsDraft.length >= 50}
                onClick={() => setDeptPositionsDraft(prev => [...prev, newDeptPositionRow()])}
              >
                <Plus className="w-4 h-4 mr-2" />
                Añadir puesto
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              disabled={deptFormSaving}
              onClick={() => {
                setDeptFormOpen(false);
                setDeptEditing(null);
                setDeptNameDraft("");
                setDeptPositionsDraft([]);
              }}
            >
              Cancelar
            </Button>
            <Button type="button" disabled={deptFormSaving} onClick={() => void handleDeptFormSave()}>
              {deptFormSaving ? "Guardando…" : deptEditing ? "Guardar" : "Crear"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deptDeleteOpen}
        onOpenChange={(open) => {
          if (!open && deptDeleteSaving) return;
          if (!open) setDeptPendingDelete(null);
          setDeptDeleteOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Eliminar área</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            {deptPendingDelete
              ? `¿Eliminar el área «${deptPendingDelete.name}»? Esta acción no se puede deshacer. Si hay colaboradores o usuarios vinculados, el sistema no permitirá el borrado.`
              : null}
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              disabled={deptDeleteSaving}
              onClick={() => {
                setDeptDeleteOpen(false);
                setDeptPendingDelete(null);
              }}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deptDeleteSaving || !deptPendingDelete}
              onClick={() => void handleDeptDeleteConfirm()}
            >
              {deptDeleteSaving ? "Eliminando…" : "Eliminar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
