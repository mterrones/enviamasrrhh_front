import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Search, Filter, UserMinus, Eye } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ApiHttpError } from "@/api/client";
import { ListPaginationBar } from "@/components/ListPaginationBar";
import { DEFAULT_LIST_PAGE_SIZE } from "@/constants/pagination";
import { fetchDepartments } from "@/api/departments";
import { fetchAllEmployees, fetchEmployeesPage, type Employee } from "@/api/employees";
import { fetchEmployeePhotoBlob } from "@/api/employeePhotos";
import type { Department } from "@/api/departments";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { formatEmployeeName } from "@/lib/employeeName";
import { displayEmployeeDni } from "@/lib/employeeDniDisplay";

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  activo: { label: "Activo", variant: "default" },
  suspendido: { label: "Suspendido", variant: "secondary" },
  cesado: { label: "Cesado", variant: "destructive" },
  vacaciones: { label: "Vacaciones", variant: "outline" },
};

function initialsFromName(name: string): string {
  return name
    .split(/\s+/)
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function EmployeeListAvatar({
  employeeId,
  photoPath,
  linkedUserAvatarPath,
  fullName,
}: {
  employeeId: number;
  photoPath?: string | null;
  linkedUserAvatarPath?: string | null;
  fullName: string;
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const clear = () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      setObjectUrl(null);
    };

    if (!photoPath?.trim()) {
      clear();
      return undefined;
    }

    (async () => {
      try {
        const blob = await fetchEmployeePhotoBlob(employeeId);
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        if (objectUrlRef.current) {
          URL.revokeObjectURL(objectUrlRef.current);
        }
        objectUrlRef.current = url;
        setObjectUrl(url);
      } catch {
        if (!cancelled) clear();
      }
    })();

    return () => {
      cancelled = true;
      clear();
    };
  }, [employeeId, photoPath]);

  const fallbackUrl = linkedUserAvatarPath?.trim() ? linkedUserAvatarPath.trim() : null;
  const showStoredPhoto = Boolean(objectUrl);
  const showLinkedAvatar = !showStoredPhoto && Boolean(fallbackUrl);

  return (
    <Avatar className="w-8 h-8">
      {showStoredPhoto ? (
        <AvatarImage src={objectUrl!} alt={fullName} className="object-cover" />
      ) : showLinkedAvatar ? (
        <AvatarImage src={fallbackUrl!} alt={fullName} className="object-cover" />
      ) : null}
      <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
        {initialsFromName(fullName)}
      </AvatarFallback>
    </Avatar>
  );
}

export default function EmployeesPage() {
  const { hasPermission, user, startImpersonation } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("todos");
  const [rows, setRows] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [listMeta, setListMeta] = useState({
    current_page: 1,
    last_page: 1,
    total: 0,
    per_page: DEFAULT_LIST_PAGE_SIZE,
  });
  const [page, setPage] = useState(1);
  const [employeeNameById, setEmployeeNameById] = useState<Map<number, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [impersonateLoadingUserId, setImpersonateLoadingUserId] = useState<number | null>(null);

  const canOfferImpersonation =
    (user?.rol === "superadmin_rrhh" || user?.rol === "admin_rrhh") && !user?.impersonation?.active;

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search), 350);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, statusFilter]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const all = await fetchAllEmployees();
        if (cancelled) return;
        setEmployeeNameById(new Map(all.map((e) => [e.id, formatEmployeeName(e)])));
      } catch {
        if (!cancelled) setEmployeeNameById(new Map());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [deptRes, empRes] = await Promise.all([
        fetchDepartments(),
        fetchEmployeesPage({
          per_page: DEFAULT_LIST_PAGE_SIZE,
          page,
          search: debouncedSearch || undefined,
          status: statusFilter,
        }),
      ]);
      setDepartments(deptRes);
      setRows(empRes.data);
      setListMeta({
        current_page: empRes.meta.current_page ?? page,
        last_page: empRes.meta.last_page ?? 1,
        total: empRes.meta.total ?? 0,
        per_page: empRes.meta.per_page ?? DEFAULT_LIST_PAGE_SIZE,
      });
    } catch (e) {
      const msg =
        e instanceof ApiHttpError ? e.apiError?.message ?? e.message : "No se pudieron cargar los colaboradores";
      setError(typeof msg === "string" ? msg : "Error");
      setRows([]);
      setListMeta((m) => ({ ...m, total: 0, last_page: 1, current_page: 1 }));
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, statusFilter, page]);

  useEffect(() => {
    load();
  }, [load]);

  const deptNameById = new Map(departments.map((d) => [d.id, d.name]));

  const handleImpersonate = async (userId: number) => {
    setImpersonateLoadingUserId(userId);
    try {
      await startImpersonation(userId);
      toast({
        title: "Sesión de impersonación",
        description: "Estás viendo la plataforma como el usuario vinculado a este colaborador.",
      });
    } catch (e) {
      const msg =
        e instanceof ApiHttpError ? e.apiError?.message ?? e.message : "No se pudo iniciar la sesión como otro usuario";
      toast({
        title: "Impersonación no disponible",
        description: typeof msg === "string" ? msg : "Error",
        variant: "destructive",
      });
    } finally {
      setImpersonateLoadingUserId(null);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Colaboradores</h1>
          <p className="text-muted-foreground text-sm mt-1">Gestión del personal de EnviaMas</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasPermission("employees.edit") ? (
            <Link to="/colaboradores/renuncias">
              <Button variant="outline" className="gap-2" type="button">
                <UserMinus className="w-4 h-4" /> Renuncias
              </Button>
            </Link>
          ) : null}
        </div>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nombre o DNI..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-44">
                <Filter className="w-4 h-4 mr-2" />
                <SelectValue placeholder="Estado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="activo">Activo</SelectItem>
                <SelectItem value="suspendido">Suspendido</SelectItem>
                <SelectItem value="cesado">Cesado</SelectItem>
                <SelectItem value="vacaciones">Vacaciones</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <Card className="shadow-card border-destructive/50">
          <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <p className="text-sm text-destructive flex-1">{error}</p>
            <Button size="sm" variant="outline" type="button" onClick={() => load()}>
              Reintentar
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card className="shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          {loading ? (
            <p className="text-sm text-muted-foreground px-5 py-12">Cargando…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground px-5 py-12">No hay colaboradores que coincidan con los filtros.</p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left text-xs font-semibold text-muted-foreground px-5 py-3">Colaborador</th>
                  <th className="text-left text-xs font-semibold text-muted-foreground px-5 py-3">DNI</th>
                  <th className="text-left text-xs font-semibold text-muted-foreground px-5 py-3">Área</th>
                  <th className="text-left text-xs font-semibold text-muted-foreground px-5 py-3">Puesto</th>
                  <th className="text-left text-xs font-semibold text-muted-foreground px-5 py-3">Estado</th>
                  <th className="text-left text-xs font-semibold text-muted-foreground px-5 py-3">Jefe Directo</th>
                  <th className="text-left text-xs font-semibold text-muted-foreground px-5 py-3 w-[1%] whitespace-nowrap">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((emp) => {
                  const st = statusConfig[emp.status] ?? statusConfig.activo;
                  const displayName = formatEmployeeName(emp);
                  const area =
                    emp.department_id != null ? deptNameById.get(emp.department_id) ?? "—" : "—";
                  const jefe =
                    emp.manager_id != null ? employeeNameById.get(emp.manager_id) ?? "—" : "—";

                  return (
                    <tr key={emp.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <EmployeeListAvatar
                            employeeId={emp.id}
                            photoPath={emp.photo_path}
                            linkedUserAvatarPath={emp.linked_user_avatar_path}
                            fullName={displayName}
                          />
                          <span className="text-sm font-medium">{displayName}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-sm text-muted-foreground">{displayEmployeeDni(emp.dni)}</td>
                      <td className="px-5 py-3 text-sm">{area}</td>
                      <td className="px-5 py-3 text-sm">{emp.position ?? "—"}</td>
                      <td className="px-5 py-3">
                        <Badge variant={st.variant} className="text-xs">
                          {st.label}
                        </Badge>
                      </td>
                      <td className="px-5 py-3 text-sm text-muted-foreground">{jefe}</td>
                      <td className="px-5 py-3 align-middle whitespace-nowrap">
                        <div className="inline-flex flex-nowrap items-center gap-1">
                          <Link to={`/colaboradores/${emp.id}`} className="inline-flex shrink-0">
                            <Button variant="ghost" size="sm" className="h-8 px-2 text-primary text-xs">
                              Ver perfil
                            </Button>
                          </Link>
                          {hasPermission("employees.edit") ? (
                            <Link to={`/colaboradores/${emp.id}/edit`} className="inline-flex shrink-0">
                              <Button variant="ghost" size="sm" className="h-8 px-2 text-primary text-xs" type="button">
                                Editar
                              </Button>
                            </Link>
                          ) : null}
                          {canOfferImpersonation && emp.user_id != null && emp.user_id > 0 ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 shrink-0 px-2 text-primary text-xs gap-1"
                              type="button"
                              disabled={impersonateLoadingUserId === emp.user_id}
                              title="Ver la aplicación con los permisos de la cuenta vinculada"
                              onClick={() => void handleImpersonate(emp.user_id!)}
                            >
                              <Eye className="w-3.5 h-3.5 shrink-0" />
                              Ver como
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {!loading ? (
          <ListPaginationBar
            page={listMeta.current_page}
            lastPage={listMeta.last_page}
            total={listMeta.total}
            pageSize={listMeta.per_page}
            onPageChange={setPage}
          />
        ) : null}
      </Card>
    </div>
  );
}
