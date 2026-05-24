import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Search, Plus, Download, Pencil, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ApiHttpError } from "@/api/client";
import { ListPaginationBar } from "@/components/ListPaginationBar";
import { DEFAULT_LIST_PAGE_SIZE } from "@/constants/pagination";
import { fetchAllEmployees } from "@/api/employees";
import {
  createAsset,
  deleteAsset,
  downloadAssetLoanActBlob,
  fetchAssetsPage,
  updateAsset,
  uploadAssetLoanActPdf,
  type Asset,
  type AssetListParams,
} from "@/api/assets";
import { useAuth } from "@/contexts/AuthContext";
import { formatEmployeeName } from "@/lib/employeeName";
import { formatAppDate } from "@/lib/formatAppDate";

const estadoVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  "En uso": "default",
  Asignado: "default",
  "En mantenimiento": "secondary",
  Devuelto: "outline",
  Disponible: "secondary",
};

type StatusFilterKey = "todos" | "uso" | "mant" | "dev";

const TIPOS_ACTIVO = ["Laptop", "Monitor", "Headset", "Teclado", "Mouse", "Celular", "Otro"] as const;
const ESTADOS_ACTIVO = ["Disponible", "En uso", "Asignado", "En mantenimiento", "Devuelto"] as const;

function statusFilterToApi(key: StatusFilterKey): string | undefined {
  if (key === "todos") return undefined;
  if (key === "uso") return "En uso";
  if (key === "mant") return "En mantenimiento";
  return "Devuelto";
}

function displayDescription(a: Asset): string {
  const d = a.description?.trim();
  if (d) return d;
  const parts = [a.brand, a.model].filter(Boolean);
  return parts.length ? parts.join(" ") : "—";
}

function formatAssignedDate(iso?: string | null): string {
  return formatAppDate(iso);
}

export default function AssetsPage() {
  const { hasPermission } = useAuth();
  const canManageAssets = hasPermission("assets.manage");
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilterKey>("todos");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [employeeMap, setEmployeeMap] = useState<Record<number, string>>({});
  const [employees, setEmployees] = useState<{ id: number; displayName: string }[]>([]);
  const [page, setPage] = useState(1);
  const [assetsMeta, setAssetsMeta] = useState({
    current_page: 1,
    last_page: 1,
    total: 0,
    per_page: DEFAULT_LIST_PAGE_SIZE,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assetDialogOpen, setAssetDialogOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [assetToDelete, setAssetToDelete] = useState<Asset | null>(null);
  const [assetDeleteSaving, setAssetDeleteSaving] = useState(false);
  const { toast } = useToast();

  const [tipo, setTipo] = useState("");
  const [marca, setMarca] = useState("");
  const [modelo, setModelo] = useState("");
  const [serie, setSerie] = useState("");
  const [empleado, setEmpleado] = useState("__none__");
  const [estado, setEstado] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [loanActFile, setLoanActFile] = useState<File | null>(null);
  const loanActInputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [loanActDownloadingId, setLoanActDownloadingId] = useState<number | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput.trim()), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, debouncedSearch]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const st = statusFilterToApi(statusFilter);
      const params: AssetListParams = { per_page: DEFAULT_LIST_PAGE_SIZE, page };
      if (st) params.status = st;
      if (debouncedSearch) params.search = debouncedSearch;
      const [aRes, allEmps] = await Promise.all([fetchAssetsPage(params), fetchAllEmployees()]);
      setAssets(aRes.data);
      setAssetsMeta({
        current_page: aRes.meta.current_page ?? page,
        last_page: aRes.meta.last_page ?? 1,
        total: aRes.meta.total ?? 0,
        per_page: aRes.meta.per_page ?? DEFAULT_LIST_PAGE_SIZE,
      });
      setEmployees(allEmps.map((e) => ({ id: e.id, displayName: formatEmployeeName(e) })));
      const m: Record<number, string> = {};
      allEmps.forEach((e) => {
        m[e.id] = formatEmployeeName(e);
      });
      setEmployeeMap(m);
    } catch (err) {
      const msg = err instanceof ApiHttpError ? err.apiError?.message ?? err.message : "No se pudieron cargar los activos";
      setError(typeof msg === "string" ? msg : "Error");
      setAssets([]);
      setAssetsMeta((m) => ({ ...m, total: 0, last_page: 1, current_page: 1 }));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, debouncedSearch, page]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const resetForm = () => {
    setTipo("");
    setMarca("");
    setModelo("");
    setSerie("");
    setEmpleado("__none__");
    setEstado("");
    setObservaciones("");
    setLoanActFile(null);
    setEditingAsset(null);
    if (loanActInputRef.current) {
      loanActInputRef.current.value = "";
    }
  };

  const openCreateDialog = () => {
    setEditingAsset(null);
    resetForm();
    setAssetDialogOpen(true);
  };

  const openEditDialog = (a: Asset) => {
    setEditingAsset(a);
    setTipo(a.type);
    setMarca(a.brand?.trim() ?? "");
    setModelo((a.model?.trim() || a.description?.trim() || "") ?? "");
    setSerie(a.serial_number?.trim() ?? "");
    setEmpleado(a.employee_id != null ? String(a.employee_id) : "__none__");
    setEstado(a.status);
    setObservaciones(a.observations?.trim() ?? "");
    setLoanActFile(null);
    if (loanActInputRef.current) {
      loanActInputRef.current.value = "";
    }
    setAssetDialogOpen(true);
  };

  const handleGuardar = async () => {
    if (!tipo || !modelo.trim()) {
      toast({ title: "Campos requeridos", description: "Tipo y Modelo/Descripción son obligatorios.", variant: "destructive" });
      return;
    }
    const descCombined = [marca, modelo].filter(Boolean).join(" ").trim() || null;
    const empId = empleado !== "__none__" ? Number(empleado) : null;
    if (empleado !== "__none__" && Number.isNaN(empId)) {
      toast({ title: "Error", description: "Colaborador no válido.", variant: "destructive" });
      return;
    }
    const st = estado || "Disponible";
    let assignedAt: string | null = null;
    if (empId != null) {
      if (editingAsset && editingAsset.employee_id === empId && editingAsset.assigned_at) {
        assignedAt = editingAsset.assigned_at.slice(0, 10);
      } else {
        assignedAt = format(new Date(), "yyyy-MM-dd");
      }
    }
    setSaving(true);
    try {
      if (editingAsset) {
        await updateAsset(editingAsset.id, {
          type: tipo,
          brand: marca.trim() || null,
          model: modelo.trim() || null,
          serial_number: serie.trim() || null,
          description: descCombined,
          employee_id: empId,
          status: st,
          observations: observaciones.trim() || null,
          assigned_at: assignedAt,
        });
        if (loanActFile) {
          await uploadAssetLoanActPdf(editingAsset.id, loanActFile);
        }
        toast({
          title: "Activo actualizado",
          description: "Los cambios se guardaron correctamente.",
        });
      } else {
        await createAsset(
          {
            type: tipo,
            brand: marca.trim() || null,
            model: modelo.trim() || null,
            serial_number: serie.trim() || null,
            description: descCombined,
            employee_id: empId,
            status: st,
            observations: observaciones.trim() || null,
            assigned_at: empId != null ? format(new Date(), "yyyy-MM-dd") : null,
          },
          loanActFile ?? undefined,
        );
        toast({
          title: "Activo registrado",
          description: `${descCombined ?? modelo.trim()} se registró correctamente.`,
        });
      }
      setAssetDialogOpen(false);
      resetForm();
      await loadData();
    } catch (err) {
      const msg =
        err instanceof ApiHttpError ? err.apiError?.message ?? err.message : "No se pudo guardar el activo";
      toast({ title: "Error", description: typeof msg === "string" ? msg : "Intenta de nuevo", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDeleteAsset = async () => {
    if (!assetToDelete) return;
    setAssetDeleteSaving(true);
    try {
      await deleteAsset(assetToDelete.id);
      toast({ title: "Activo eliminado", description: "El registro se eliminó correctamente." });
      setAssetToDelete(null);
      await loadData();
    } catch (err) {
      const msg = err instanceof ApiHttpError ? err.apiError?.message ?? err.message : "No se pudo eliminar";
      toast({ title: "Error", description: typeof msg === "string" ? msg : "Intenta de nuevo", variant: "destructive" });
    } finally {
      setAssetDeleteSaving(false);
    }
  };

  const handleDownloadLoanAct = async (asset: Asset) => {
    setLoanActDownloadingId(asset.id);
    try {
      const blob = await downloadAssetLoanActBlob(asset.id);
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
      setLoanActDownloadingId(null);
    }
  };

  const closeAssetDialog = (open: boolean) => {
    setAssetDialogOpen(open);
    if (!open) resetForm();
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Activos y Equipos</h1>
          <p className="text-muted-foreground text-sm mt-1">Control de equipos asignados al personal</p>
        </div>
        {canManageAssets ? (
          <Button className="gap-2" type="button" onClick={() => openCreateDialog()}>
            <Plus className="w-4 h-4" />
            Registrar Activo
          </Button>
        ) : null}
      </div>

      <Card className="shadow-card">
        <CardContent className="p-4 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar equipo o colaborador..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilterKey)}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los estados</SelectItem>
              <SelectItem value="uso">En uso</SelectItem>
              <SelectItem value="mant">En mantenimiento</SelectItem>
              <SelectItem value="dev">Devuelto</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card className="shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                {["Tipo", "Descripción", "Colaborador", "Fecha Asignación", "Estado", "Acciones"].map((h) => (
                  <th key={h} className="text-left text-xs font-semibold text-muted-foreground px-5 py-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-sm text-muted-foreground text-center">
                    Cargando activos…
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center">
                    <p className="text-sm text-destructive mb-2">{error}</p>
                    <Button variant="outline" size="sm" type="button" onClick={() => void loadData()}>
                      Reintentar
                    </Button>
                  </td>
                </tr>
              ) : assets.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-sm text-muted-foreground text-center">
                    No hay activos que coincidan con los filtros.
                  </td>
                </tr>
              ) : (
                assets.map((a) => {
                  const empName = a.employee_id != null ? (employeeMap[a.employee_id] ?? `#${a.employee_id}`) : "—";
                  return (
                    <tr key={a.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                      <td className="px-5 py-3 text-sm font-medium">{a.type}</td>
                      <td className="px-5 py-3 text-sm">{displayDescription(a)}</td>
                      <td className="px-5 py-3 text-sm">{empName}</td>
                      <td className="px-5 py-3 text-sm text-muted-foreground">{formatAssignedDate(a.assigned_at)}</td>
                      <td className="px-5 py-3">
                        <Badge variant={estadoVariant[a.status] ?? "secondary"} className="text-xs">
                          {a.status}
                        </Badge>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap items-center gap-1 justify-start">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs text-primary gap-1 h-8 px-2"
                            type="button"
                            disabled={!a.has_loan_act || loanActDownloadingId === a.id}
                            title={
                              a.has_loan_act ? "Descargar acta de préstamo (PDF)" : "No hay acta de préstamo cargada"
                            }
                            onClick={() => void handleDownloadLoanAct(a)}
                          >
                            <Download className="w-3.5 h-3.5" />
                            {loanActDownloadingId === a.id ? "Descargando…" : "Acta PDF"}
                          </Button>
                          {canManageAssets ? (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-xs gap-1 h-8 px-2"
                                type="button"
                                title="Editar activo"
                                onClick={() => openEditDialog(a)}
                              >
                                <Pencil className="w-3.5 h-3.5" />
                                Editar
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-xs gap-1 h-8 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                                type="button"
                                title="Eliminar activo"
                                onClick={() => setAssetToDelete(a)}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                Eliminar
                              </Button>
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {!loading && !error ? (
          <ListPaginationBar
            page={assetsMeta.current_page}
            lastPage={assetsMeta.last_page}
            total={assetsMeta.total}
            pageSize={assetsMeta.per_page}
            onPageChange={setPage}
          />
        ) : null}
      </Card>

      <Dialog open={assetDialogOpen} onOpenChange={closeAssetDialog}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingAsset ? "Editar activo" : "Registrar Nuevo Activo"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Tipo de activo *</Label>
                <Select value={tipo} onValueChange={setTipo}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar..." />
                  </SelectTrigger>
                  <SelectContent>
                    {[...new Set([...TIPOS_ACTIVO, tipo].filter(Boolean))].map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Marca</Label>
                <Input placeholder="Ej: Lenovo, Dell..." value={marca} onChange={(e) => setMarca(e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Modelo / Descripción *</Label>
                <Input placeholder="Ej: ThinkPad T14" value={modelo} onChange={(e) => setModelo(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Número de serie</Label>
                <Input placeholder="Ej: SN-123456" value={serie} onChange={(e) => setSerie(e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Colaborador asignado</Label>
                <Select value={empleado} onValueChange={setEmpleado}>
                  <SelectTrigger>
                    <SelectValue placeholder="Sin asignar" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Sin asignar</SelectItem>
                    {employees.map((e) => (
                      <SelectItem key={e.id} value={String(e.id)}>
                        {e.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Estado</Label>
                <Select value={estado} onValueChange={setEstado}>
                  <SelectTrigger>
                    <SelectValue placeholder="Disponible" />
                  </SelectTrigger>
                  <SelectContent>
                    {ESTADOS_ACTIVO.map((e) => (
                      <SelectItem key={e} value={e}>
                        {e}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Acta de préstamo (PDF)</Label>
              <Input
                ref={loanActInputRef}
                type="file"
                accept="application/pdf,.pdf"
                className="cursor-pointer"
                onChange={(e) => setLoanActFile(e.target.files?.[0] ?? null)}
              />
              <p className="text-xs text-muted-foreground">
                {editingAsset
                  ? "Opcional. Sube un PDF solo si deseas reemplazar el acta actual."
                  : "Opcional. PDF del acta de préstamo del activo."}
                {editingAsset?.has_loan_act ? (
                  <span className="block mt-1 text-foreground/80">Hay un acta cargada en el sistema.</span>
                ) : null}
              </p>
            </div>

            <div className="space-y-2">
              <Label>Observaciones</Label>
              <Textarea
                placeholder="Notas adicionales sobre el activo..."
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" type="button" disabled={saving} onClick={() => closeAssetDialog(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void handleGuardar()} disabled={saving}>
              {saving ? "Guardando…" : editingAsset ? "Guardar cambios" : "Registrar Activo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={assetToDelete !== null} onOpenChange={(open) => !open && !assetDeleteSaving && setAssetToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este activo?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará el registro del equipo. Si había un PDF de acta de préstamo, también se borrará del almacenamiento.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={assetDeleteSaving}>Cancelar</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={assetDeleteSaving}
              onClick={() => void handleConfirmDeleteAsset()}
            >
              {assetDeleteSaving ? "Eliminando…" : "Eliminar"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
