import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Employee } from "@/api/employees";
import {
  createSalaryRevision,
  fetchEmployeeSalaryEffective,
  fetchSalaryRevisions,
  type SalaryRevision,
} from "@/api/salaryRevisions";
import { ApiHttpError } from "@/api/client";
import { formatEmployeeFullName } from "@/lib/employeeName";
import { formatAppDateTime } from "@/lib/formatAppDate";
import { normalizeMoneyDecimalInput } from "@/lib/moneyDecimalInput";
import { useToast } from "@/hooks/use-toast";

const meses = [
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

function formatPen(amount: string | number | null | undefined): string {
  if (amount == null || amount === "") return "—";
  const n = typeof amount === "string" ? Number.parseFloat(amount.replace(",", ".")) : amount;
  if (Number.isNaN(n)) return "—";
  return `S/ ${n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function effectiveMonthLabel(iso: string): string {
  const head = iso.slice(0, 10);
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(head);
  if (!m) return iso;
  const monthNum = Number.parseInt(m[2], 10);
  const year = Number.parseInt(m[1], 10);
  if (monthNum < 1 || monthNum > 12) return iso;
  return `${meses[monthNum - 1]} ${year}`;
}

export type PayrollSalariesTabProps = {
  employeesList: Employee[];
  canView: boolean;
  canEdit: boolean;
  onRevisionsChanged: () => void;
};

export function PayrollSalariesTab({ employeesList, canView, canEdit, onRevisionsChanged }: PayrollSalariesTabProps) {
  const { toast } = useToast();
  const [employeeId, setEmployeeId] = useState("");
  const [revisions, setRevisions] = useState<SalaryRevision[]>([]);
  const [revisionsLoading, setRevisionsLoading] = useState(false);
  const [revisionsError, setRevisionsError] = useState<string | null>(null);
  const [vigenteLabel, setVigenteLabel] = useState<string | null>(null);
  const [newAmountStr, setNewAmountStr] = useState("");
  const now = useMemo(() => new Date(), []);
  const [effYear, setEffYear] = useState(now.getFullYear());
  const [effMonth, setEffMonth] = useState(now.getMonth() + 1);
  const [submitting, setSubmitting] = useState(false);

  const yearOptions = useMemo(() => {
    const y = now.getFullYear();
    return [y - 2, y - 1, y, y + 1, y + 2];
  }, [now]);

  const loadRevisions = useCallback(async (id: number) => {
    setRevisionsLoading(true);
    setRevisionsError(null);
    try {
      const [revRes, vigRes] = await Promise.all([
        fetchSalaryRevisions(id),
        fetchEmployeeSalaryEffective(id, now.getFullYear(), now.getMonth() + 1),
      ]);
      setRevisions(revRes.data);
      const amt = vigRes.data.amount;
      setVigenteLabel(amt != null && String(amt).trim() !== "" ? formatPen(amt) : "Sin sueldo registrado");
    } catch (err) {
      const msg =
        err instanceof ApiHttpError ? err.apiError?.message ?? err.message : "No se pudo cargar el historial de sueldos";
      setRevisionsError(typeof msg === "string" ? msg : "Error");
      setRevisions([]);
      setVigenteLabel(null);
    } finally {
      setRevisionsLoading(false);
    }
  }, [now]);

  useEffect(() => {
    const id = Number.parseInt(employeeId, 10);
    if (Number.isNaN(id) || id < 1 || !canView) {
      setRevisions([]);
      setVigenteLabel(null);
      return;
    }
    void loadRevisions(id);
  }, [employeeId, canView, loadRevisions]);

  const handleSubmit = async () => {
    const id = Number.parseInt(employeeId, 10);
    if (Number.isNaN(id) || id < 1) {
      toast({ title: "Elige un colaborador", variant: "destructive" });
      return;
    }
    const normalized = normalizeMoneyDecimalInput(newAmountStr.trim());
    const newAmount = Number.parseFloat(normalized.replace(",", ".")) || 0;
    if (newAmount <= 0) {
      toast({ title: "Monto inválido", description: "Indica un sueldo mayor a cero.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      await createSalaryRevision(id, {
        new_amount: newAmount,
        effective_year: effYear,
        effective_month: effMonth,
      });
      toast({ title: "Sueldo registrado" });
      setNewAmountStr("");
      await loadRevisions(id);
      onRevisionsChanged();
    } catch (err) {
      const msg =
        err instanceof ApiHttpError
          ? err.apiError?.message ?? err.message
          : "No se pudo registrar el cambio de sueldo";
      toast({
        title: "Error",
        description: typeof msg === "string" ? msg : "Error",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (!canView) {
    return (
      <Card className="shadow-card">
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">No tienes permiso para ver la nómina.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="text-base">Colaborador y sueldo vigente</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5 max-w-md">
            <Label>Colaborador</Label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecciona un colaborador" />
              </SelectTrigger>
              <SelectContent>
                {employeesList.map((e) => (
                  <SelectItem key={e.id} value={String(e.id)}>
                    {formatEmployeeFullName(e)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {employeeId ? (
            <div className="rounded-md border bg-muted/30 px-4 py-3 text-sm">
              <span className="text-muted-foreground">Sueldo vigente (mes calendario actual): </span>
              <span className="font-medium tabular-nums">{revisionsLoading ? "…" : vigenteLabel ?? "—"}</span>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="text-base">Historial de cambios</CardTitle>
        </CardHeader>
        <CardContent>
          {!employeeId ? (
            <p className="text-sm text-muted-foreground">Selecciona un colaborador para ver el historial.</p>
          ) : revisionsError ? (
            <p className="text-sm text-destructive">{revisionsError}</p>
          ) : revisionsLoading ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : revisions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aún no hay cambios registrados en el historial salarial.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vigente desde</TableHead>
                    <TableHead className="text-right">Sueldo anterior</TableHead>
                    <TableHead className="text-right">Sueldo nuevo</TableHead>
                    <TableHead>Registrado</TableHead>
                    <TableHead>Usuario</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {revisions.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{effectiveMonthLabel(r.effective_from)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatPen(r.previous_amount)}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{formatPen(r.new_amount)}</TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {r.created_at ? formatAppDateTime(r.created_at) : "—"}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate" title={r.created_by?.email ?? ""}>
                        {r.created_by?.name ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {canEdit ? (
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-base">Registrar nuevo sueldo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 max-w-lg">
            <p className="text-xs text-muted-foreground">
              El cambio queda historizado. No puede haber dos registros con la misma fecha de inicio de vigencia (mismo
              mes). El perfil del colaborador se actualiza con el sueldo vigente al mes actual cuando corresponde.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="sal-new">Nuevo sueldo (mensual)</Label>
              <Input
                id="sal-new"
                inputMode="decimal"
                placeholder="0.00"
                value={newAmountStr}
                onChange={(e) => setNewAmountStr(e.target.value)}
                disabled={!employeeId || submitting}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Año vigencia</Label>
                <Select
                  value={String(effYear)}
                  onValueChange={(v) => setEffYear(Number.parseInt(v, 10))}
                  disabled={!employeeId || submitting}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {yearOptions.map((y) => (
                      <SelectItem key={y} value={String(y)}>
                        {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Mes vigencia</Label>
                <Select
                  value={String(effMonth)}
                  onValueChange={(v) => setEffMonth(Number.parseInt(v, 10))}
                  disabled={!employeeId || submitting}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {meses.map((name, i) => (
                      <SelectItem key={i + 1} value={String(i + 1)}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button type="button" disabled={!employeeId || submitting} onClick={() => void handleSubmit()}>
              {submitting ? "Guardando…" : "Guardar cambio salarial"}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <p className="text-xs text-muted-foreground">
          Solo usuarios con permiso de generación de nómina pueden registrar cambios de sueldo.
        </p>
      )}
    </div>
  );
}
