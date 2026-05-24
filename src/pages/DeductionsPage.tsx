import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { ApiHttpError } from "@/api/client";
import { fetchAllEmployees, type Employee } from "@/api/employees";
import { fetchAllAssetsForEmployee, type Asset } from "@/api/assets";
import {
  createDeductionInstallmentPlan,
  deleteDeductionInstallmentPlan,
  deleteDeductionPlanEvidence,
  downloadDeductionPlanEvidenceBlob,
  fetchDeductionInstallmentPlans,
  patchDeductionInstallmentPlan,
  uploadDeductionPlanEvidence,
  type DeductionInstallmentPlan,
  type DeductionInstallmentPlanWriteBody,
} from "@/api/payroll";
import { formatEmployeeFullName } from "@/lib/employeeName";
import { deductionPlanCategoryLabelEs } from "@/lib/payrollDeductionHelpers";
import { normalizeMoneyDecimalInput } from "@/lib/moneyDecimalInput";
import { useAuth } from "@/contexts/AuthContext";
import { Download, FileUp, Loader2, Pencil, Trash2, XCircle } from "lucide-react";

const CATEGORY_OPTIONS: { value: NonNullable<DeductionInstallmentPlanWriteBody["category"]>; label: string }[] = [
  { value: "damage_equipment", label: "Daño a equipo" },
  { value: "salary_advance", label: "Adelanto de sueldo" },
  { value: "loan", label: "Préstamo" },
  { value: "other", label: "Otro" },
];

function categoryLabel(slug: string | null | undefined): string {
  if (!slug) return "—";
  return deductionPlanCategoryLabelEs(slug);
}

function planStatusLabel(s: string): string {
  const m: Record<string, string> = {
    active: "Activo",
    completed: "Completado",
    cancelled: "Cancelado",
  };
  return m[s] ?? s;
}

function planStatusVariant(s: string): "default" | "secondary" | "destructive" | "outline" {
  if (s === "completed") return "secondary";
  if (s === "cancelled") return "destructive";
  return "default";
}

function mutationErrorMessage(e: unknown): string {
  if (e instanceof ApiHttpError) {
    const m = e.apiError?.message;
    if (typeof m === "string" && m.trim()) return m;
  }
  return "No se pudo completar la operación.";
}

function formatPen(amount: string): string {
  const n = Number.parseFloat(amount);
  if (Number.isNaN(n)) return amount;
  return `S/ ${n.toFixed(2)}`;
}

export type DeductionsPageProps = {
  embedded?: boolean;
};

export default function DeductionsPage({ embedded = false }: DeductionsPageProps) {
  const { toast } = useToast();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("payroll.generate");
  const [searchParams] = useSearchParams();

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeesLoading, setEmployeesLoading] = useState(true);
  const [employeeId, setEmployeeId] = useState<string>("");

  const [plans, setPlans] = useState<DeductionInstallmentPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<DeductionInstallmentPlan | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeductionInstallmentPlan | null>(null);
  const [cancelTarget, setCancelTarget] = useState<DeductionInstallmentPlan | null>(null);

  const [createLabel, setCreateLabel] = useState("");
  const [createCategory, setCreateCategory] = useState<string>("other");
  const [createDescription, setCreateDescription] = useState("");
  const [createTotal, setCreateTotal] = useState("");
  const [createMonths, setCreateMonths] = useState("");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [createSaving, setCreateSaving] = useState(false);

  const [editLabel, setEditLabel] = useState("");
  const [editCategory, setEditCategory] = useState<string>("other");
  const [editDescription, setEditDescription] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editAssetId, setEditAssetId] = useState<string>("");
  const [editSaving, setEditSaving] = useState(false);

  const [evidencePlanId, setEvidencePlanId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const q = searchParams.get("employee");
    if (q != null && /^\d+$/.test(q.trim())) {
      setEmployeeId(q.trim());
    }
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setEmployeesLoading(true);
      try {
        const list = await fetchAllEmployees({ status: "activo" });
        if (!cancelled) setEmployees(list);
      } catch {
        if (!cancelled) setEmployees([]);
      } finally {
        if (!cancelled) setEmployeesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedEmpId = Number.parseInt(employeeId, 10);

  useEffect(() => {
    let cancelled = false;
    if (Number.isNaN(selectedEmpId)) {
      setAssets([]);
      return undefined;
    }
    (async () => {
      try {
        const list = await fetchAllAssetsForEmployee(selectedEmpId);
        if (!cancelled) {
          setAssets(list);
        }
      } catch {
        if (!cancelled) setAssets([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedEmpId]);

  const loadPlans = useCallback(async () => {
    if (Number.isNaN(selectedEmpId)) {
      setPlans([]);
      return;
    }
    setPlansLoading(true);
    try {
      const r = await fetchDeductionInstallmentPlans(selectedEmpId);
      setPlans(r.data);
    } catch (e) {
      toast({
        title: "Descuentos",
        description: mutationErrorMessage(e),
        variant: "destructive",
      });
      setPlans([]);
    } finally {
      setPlansLoading(false);
    }
  }, [selectedEmpId, toast]);

  useEffect(() => {
    void loadPlans();
  }, [loadPlans]);

  const openCreate = () => {
    if (Number.isNaN(selectedEmpId)) {
      toast({ title: "Colaborador requerido", description: "Selecciona un colaborador.", variant: "destructive" });
      return;
    }
    setCreateLabel("");
    setCreateCategory("other");
    setCreateDescription("");
    setCreateTotal("");
    setCreateMonths("");
    setCreateOpen(true);
  };

  const handleCreate = async () => {
    if (Number.isNaN(selectedEmpId)) return;
    const total = Number.parseFloat(createTotal.replace(",", ".")) || 0;
    const months = Number.parseInt(createMonths, 10);
    if (!createLabel.trim() || total < 0.01 || months < 1) {
      toast({
        title: "Datos incompletos",
        description: "Indica título, monto total y número de cuotas.",
        variant: "destructive",
      });
      return;
    }
    const body: DeductionInstallmentPlanWriteBody = {
      label: createLabel.trim(),
      total_amount: total,
      installment_count: months,
      category: createCategory as DeductionInstallmentPlanWriteBody["category"],
      description: createDescription.trim() || undefined,
    };
    setCreateSaving(true);
    try {
      await createDeductionInstallmentPlan(selectedEmpId, body);
      toast({ title: "Plan registrado", description: "Puedes aplicar cuotas desde Boletas y Nómina al generar la boleta." });
      setCreateOpen(false);
      await loadPlans();
    } catch (e) {
      toast({ title: "No se pudo crear", description: mutationErrorMessage(e), variant: "destructive" });
    } finally {
      setCreateSaving(false);
    }
  };

  const openEdit = (p: DeductionInstallmentPlan) => {
    setEditTarget(p);
    setEditLabel(p.label);
    setEditCategory(p.category ?? "other");
    setEditDescription(p.description ?? "");
    setEditNotes(p.notes ?? "");
    setEditAssetId(p.asset_id != null ? String(p.asset_id) : "");
  };

  const handleEditSave = async () => {
    if (!editTarget || Number.isNaN(selectedEmpId)) return;
    setEditSaving(true);
    try {
      await patchDeductionInstallmentPlan(selectedEmpId, editTarget.id, {
        label: editLabel.trim(),
        category: editCategory as DeductionInstallmentPlanWriteBody["category"],
        description: editDescription.trim() || null,
        notes: editNotes.trim() || null,
        asset_id: editAssetId ? Number.parseInt(editAssetId, 10) : null,
      });
      toast({ title: "Actualizado", description: "Los datos del plan se guardaron." });
      setEditTarget(null);
      await loadPlans();
    } catch (e) {
      toast({ title: "Error", description: mutationErrorMessage(e), variant: "destructive" });
    } finally {
      setEditSaving(false);
    }
  };

  const handleCancelPlan = async () => {
    if (!cancelTarget || Number.isNaN(selectedEmpId)) return;
    try {
      await patchDeductionInstallmentPlan(selectedEmpId, cancelTarget.id, { status: "cancelled" });
      toast({ title: "Plan cancelado", description: "No se aplicarán más cuotas desde este plan." });
      setCancelTarget(null);
      await loadPlans();
    } catch (e) {
      toast({ title: "Error", description: mutationErrorMessage(e), variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget || Number.isNaN(selectedEmpId)) return;
    try {
      await deleteDeductionInstallmentPlan(selectedEmpId, deleteTarget.id);
      toast({ title: "Eliminado", description: "El plan fue eliminado." });
      setDeleteTarget(null);
      await loadPlans();
    } catch (e) {
      toast({ title: "Error", description: mutationErrorMessage(e), variant: "destructive" });
    }
  };

  const triggerEvidencePick = (planId: number) => {
    setEvidencePlanId(planId);
    window.setTimeout(() => fileInputRef.current?.click(), 0);
  };

  const onEvidenceFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || evidencePlanId == null || Number.isNaN(selectedEmpId)) return;
    try {
      await uploadDeductionPlanEvidence(selectedEmpId, evidencePlanId, file);
      toast({ title: "Evidencia guardada", description: "El archivo se adjuntó al plan." });
      await loadPlans();
    } catch (err) {
      toast({ title: "No se pudo subir", description: mutationErrorMessage(err), variant: "destructive" });
    } finally {
      setEvidencePlanId(null);
    }
  };

  const handleDownloadEvidence = async (plan: DeductionInstallmentPlan) => {
    if (Number.isNaN(selectedEmpId)) return;
    try {
      const blob = await downloadDeductionPlanEvidenceBlob(selectedEmpId, plan.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `evidencia-plan-${plan.id}`;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({ title: "Descarga", description: mutationErrorMessage(err), variant: "destructive" });
    }
  };

  const handleRemoveEvidence = async (plan: DeductionInstallmentPlan) => {
    if (Number.isNaN(selectedEmpId)) return;
    try {
      await deleteDeductionPlanEvidence(selectedEmpId, plan.id);
      toast({ title: "Evidencia eliminada" });
      await loadPlans();
    } catch (err) {
      toast({ title: "Error", description: mutationErrorMessage(err), variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
        className="hidden"
        onChange={onEvidenceFile}
      />

      {!embedded ? (
        <div>
          <h1 className="text-2xl font-bold">Descuentos</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Planes de descuento en cuotas por colaborador. Las cuotas se aplican al aprobar boletas con código{" "}
            <span className="font-mono text-xs">installment:ID</span>.
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Planes de descuento en cuotas por colaborador. Las cuotas se aplican al aprobar boletas con código{" "}
          <span className="font-mono text-xs">installment:ID</span>.
        </p>
      )}

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="text-base">Seleccionar colaborador</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row gap-3 sm:items-end">
          <div className="flex-1 space-y-2">
            <Label>Colaborador</Label>
            <Select
              value={employeeId}
              onValueChange={setEmployeeId}
              disabled={employeesLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder={employeesLoading ? "Cargando…" : "Elegir colaborador"} />
              </SelectTrigger>
              <SelectContent>
                {employees.map((emp) => (
                  <SelectItem key={emp.id} value={String(emp.id)}>
                    {formatEmployeeFullName(emp)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="button" variant="outline" onClick={() => void loadPlans()} disabled={!employeeId || plansLoading}>
            Actualizar
          </Button>
          {canManage ? (
            <Button type="button" onClick={openCreate} disabled={!employeeId}>
              Nuevo plan de cuotas
            </Button>
          ) : null}
        </CardContent>
      </Card>

      {employeeId ? (
        <>
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-base">Planes de descuento</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {plansLoading ? (
              <p className="p-6 text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Cargando…
              </p>
            ) : plans.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">No hay planes para este colaborador.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-left">
                      <th className="p-3 font-medium">Título</th>
                      <th className="p-3 font-medium">Categoría</th>
                      <th className="p-3 font-medium">Estado</th>
                      <th className="p-3 font-medium">Progreso</th>
                      <th className="p-3 font-medium">Pendiente</th>
                      <th className="p-3 font-medium">Equipo</th>
                      <th className="p-3 font-medium">Evidencia</th>
                      <th className="p-3 font-medium text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plans.map((p) => (
                      <tr key={p.id} className="border-b last:border-0">
                        <td className="p-3 align-top">
                          <div className="font-medium">{p.label}</div>
                          {p.description ? (
                            <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{p.description}</div>
                          ) : null}
                        </td>
                        <td className="p-3 align-top">{categoryLabel(p.category)}</td>
                        <td className="p-3 align-top">
                          <Badge variant={planStatusVariant(p.status)}>{planStatusLabel(p.status)}</Badge>
                        </td>
                        <td className="p-3 align-top whitespace-nowrap">
                          {p.installments_applied} / {p.installment_count}
                        </td>
                        <td className="p-3 align-top">{formatPen(p.remaining_total_amount)}</td>
                        <td className="p-3 align-top text-xs">
                          {p.asset ? (
                            <span>
                              {p.asset.type}
                              {p.asset.model ? ` · ${p.asset.model}` : ""}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="p-3 align-top">
                          {p.has_evidence ? (
                            <div className="flex flex-wrap gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2"
                                onClick={() => void handleDownloadEvidence(p)}
                              >
                                <Download className="w-3.5 h-3.5 mr-1" /> Ver
                              </Button>
                              {canManage ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-destructive"
                                  onClick={() => void handleRemoveEvidence(p)}
                                >
                                  Quitar
                                </Button>
                              ) : null}
                            </div>
                          ) : canManage ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7"
                              onClick={() => triggerEvidencePick(p.id)}
                            >
                              <FileUp className="w-3.5 h-3.5 mr-1" /> Subir
                            </Button>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="p-3 align-top text-right">
                          <div className="flex flex-wrap justify-end gap-1">
                            {canManage ? (
                              <>
                                <Button type="button" variant="ghost" size="sm" className="h-8" onClick={() => openEdit(p)}>
                                  <Pencil className="w-3.5 h-3.5 mr-1" /> Editar
                                </Button>
                                {p.status === "active" ? (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-8"
                                    onClick={() => setCancelTarget(p)}
                                  >
                                    <XCircle className="w-3.5 h-3.5 mr-1" /> Cancelar
                                  </Button>
                                ) : null}
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 text-destructive"
                                  onClick={() => setDeleteTarget(p)}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </>
                            ) : (
                              <span className="text-xs text-muted-foreground">Solo lectura</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Elige un colaborador para ver y gestionar sus descuentos.</p>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nuevo plan de cuotas</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Título *</Label>
              <Input value={createLabel} onChange={(e) => setCreateLabel(e.target.value)} placeholder="Ej: Daño laptop" />
            </div>
            <div className="space-y-1.5">
              <Label>Categoría</Label>
              <Select value={createCategory} onValueChange={setCreateCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Descripción</Label>
              <Textarea value={createDescription} onChange={(e) => setCreateDescription(e.target.value)} rows={3} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>Monto total (PEN) *</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={createTotal}
                  onChange={(e) => setCreateTotal(normalizeMoneyDecimalInput(e.target.value))}
                  placeholder="600.00"
                />
              </div>
              <div className="space-y-1.5">
                <Label>N.° cuotas *</Label>
                <Input value={createMonths} onChange={(e) => setCreateMonths(e.target.value)} placeholder="3" inputMode="numeric" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
              Cerrar
            </Button>
            <Button type="button" onClick={() => void handleCreate()} disabled={createSaving}>
              {createSaving ? "Guardando…" : "Crear plan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editTarget != null} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar plan</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Título</Label>
              <Input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Categoría</Label>
              <Select value={editCategory} onValueChange={setEditCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Descripción</Label>
              <Textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={3} />
            </div>
            <div className="space-y-1.5">
              <Label>Activo / equipo</Label>
              <Select value={editAssetId || "__none__"} onValueChange={(v) => setEditAssetId(v === "__none__" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Ninguno</SelectItem>
                  {assets.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.type} {a.model ? `· ${a.model}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Notas</Label>
              <Textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} rows={2} />
            </div>
            {editTarget ? (
              <p className="text-xs text-muted-foreground">
                Monto total y cuotas no se editan aquí; usa Boletas para aplicar cada cuota al aprobar.
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditTarget(null)}>
              Cerrar
            </Button>
            <Button type="button" onClick={() => void handleEditSave()} disabled={editSaving}>
              {editSaving ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={cancelTarget != null} onOpenChange={(o) => !o && setCancelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cancelar este plan?</AlertDialogTitle>
            <AlertDialogDescription>
              No se descontarán más cuotas desde este plan. Las cuotas ya aplicadas en boletas aprobadas no se revierten.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <Button type="button" variant="destructive" onClick={() => void handleCancelPlan()}>
              Cancelar plan
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteTarget != null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar plan?</AlertDialogTitle>
            <AlertDialogDescription>
              Solo elimina el registro del plan. Si hubo cuotas en boletas, el historial de nómina no cambia.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <Button type="button" variant="destructive" onClick={() => void handleDelete()}>
              Eliminar
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
