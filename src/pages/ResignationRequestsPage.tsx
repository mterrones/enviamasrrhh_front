import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ListPaginationBar } from "@/components/ListPaginationBar";
import { useToast } from "@/hooks/use-toast";
import { ApiHttpError } from "@/api/client";
import {
  downloadHrResignationLetterBlob,
  fetchHrResignationRequestsPage,
  patchResignationRequestStatus,
  type HrResignationRequest,
  type HrResignationStatus,
} from "@/api/resignationRequests";
import { DEFAULT_LIST_PAGE_SIZE } from "@/constants/pagination";
import { formatEmployeeName } from "@/lib/employeeName";
import { formatAppDate, formatAppDateTime } from "@/lib/formatAppDate";
import { ChevronLeft, Download, Pencil } from "lucide-react";

function statusLabel(s: string): string {
  const m: Record<string, string> = {
    pendiente: "Pendiente",
    aprobada: "Aprobada",
    rechazada: "Rechazada",
  };
  return m[s] ?? s;
}

function statusVariant(s: string): "default" | "secondary" | "destructive" | "outline" {
  if (s === "aprobada") return "default";
  if (s === "rechazada") return "destructive";
  return "secondary";
}

function requestErrorMessage(e: unknown): string {
  if (e instanceof ApiHttpError) {
    const m = e.apiError?.message;
    if (typeof m === "string" && m.trim()) return m;
  }
  return "Ocurrió un error al cargar los datos.";
}

function formatSentAtCompact(iso: string | null | undefined): string {
  return formatAppDateTime(iso);
}

export default function ResignationRequestsPage() {
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>("pendiente");
  const [rows, setRows] = useState<HrResignationRequest[]>([]);
  const [meta, setMeta] = useState({
    current_page: 1,
    last_page: 1,
    total: 0,
    per_page: DEFAULT_LIST_PAGE_SIZE,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadId, setDownloadId] = useState<number | null>(null);
  const [decisionRow, setDecisionRow] = useState<HrResignationRequest | null>(null);
  const [decisionKind, setDecisionKind] = useState<"aprobada" | "rechazada" | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [savingDecision, setSavingDecision] = useState(false);
  const [correctionRow, setCorrectionRow] = useState<HrResignationRequest | null>(null);
  const [correctionStatus, setCorrectionStatus] = useState<HrResignationStatus | "">("");
  const [correctionRejectReason, setCorrectionRejectReason] = useState("");
  const [savingCorrection, setSavingCorrection] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetchHrResignationRequestsPage({
        page,
        per_page: DEFAULT_LIST_PAGE_SIZE,
        status: statusFilter === "all" ? undefined : statusFilter,
      });
      setRows(r.data);
      setMeta({
        current_page: r.meta.current_page,
        last_page: r.meta.last_page,
        total: r.meta.total,
        per_page: r.meta.per_page,
      });
    } catch (e) {
      setError(requestErrorMessage(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter]);

  const handleDownload = async (row: HrResignationRequest) => {
    setDownloadId(row.id);
    try {
      const blob = await downloadHrResignationLetterBlob(row.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = row.letter_original_name?.replace(/[^\w.-]/g, "_") || `renuncia-${row.id}.pdf`;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      const msg =
        err instanceof ApiHttpError ? err.apiError?.message ?? err.message : "No se pudo descargar el PDF";
      toast({
        title: "Error",
        description: typeof msg === "string" ? msg : "Intenta de nuevo",
        variant: "destructive",
      });
    } finally {
      setDownloadId(null);
    }
  };

  const openDecision = (row: HrResignationRequest, kind: "aprobada" | "rechazada") => {
    setDecisionRow(row);
    setDecisionKind(kind);
    setRejectReason("");
  };

  const openCorrection = (row: HrResignationRequest) => {
    setCorrectionRow(row);
    setCorrectionStatus("");
    setCorrectionRejectReason("");
  };

  const confirmCorrection = async () => {
    if (!correctionRow || correctionStatus === "") return;
    if (correctionStatus === correctionRow.status) {
      toast({ title: "Sin cambios", description: "Elige un estado distinto al actual.", variant: "destructive" });
      return;
    }
    if (correctionStatus === "rechazada" && !correctionRejectReason.trim()) {
      toast({ title: "Motivo requerido", description: "Indica el motivo del rechazo.", variant: "destructive" });
      return;
    }
    setSavingCorrection(true);
    try {
      await patchResignationRequestStatus(correctionRow.id, {
        status: correctionStatus,
        rejection_reason: correctionStatus === "rechazada" ? correctionRejectReason.trim() : undefined,
      });
      toast({
        title: "Estado actualizado",
        description: "Se aplicó la corrección y se notificó al colaborador en el portal.",
      });
      setCorrectionRow(null);
      setCorrectionStatus("");
      await load();
    } catch (err) {
      const msg =
        err instanceof ApiHttpError ? err.apiError?.message ?? err.message : "No se pudo guardar";
      toast({ title: "Error", description: typeof msg === "string" ? msg : "Intenta de nuevo", variant: "destructive" });
    } finally {
      setSavingCorrection(false);
    }
  };

  const confirmDecision = async () => {
    if (!decisionRow || !decisionKind) return;
    if (decisionKind === "rechazada" && !rejectReason.trim()) {
      toast({ title: "Motivo requerido", description: "Indica el motivo del rechazo.", variant: "destructive" });
      return;
    }
    setSavingDecision(true);
    try {
      await patchResignationRequestStatus(decisionRow.id, {
        status: decisionKind,
        rejection_reason: decisionKind === "rechazada" ? rejectReason.trim() : undefined,
      });
      toast({
        title: decisionKind === "aprobada" ? "Solicitud aprobada" : "Solicitud rechazada",
        description: "Se notificó al colaborador en el portal.",
      });
      setDecisionRow(null);
      setDecisionKind(null);
      await load();
    } catch (err) {
      const msg =
        err instanceof ApiHttpError ? err.apiError?.message ?? err.message : "No se pudo guardar";
      toast({ title: "Error", description: typeof msg === "string" ? msg : "Intenta de nuevo", variant: "destructive" });
    } finally {
      setSavingDecision(false);
    }
  };

  return (
    <div className="space-y-6 p-6 max-w-6xl mx-auto">
      <div>
        <Link
          to="/colaboradores"
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2"
        >
          <ChevronLeft className="w-4 h-4" />
          Colaboradores
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Renuncias y cese</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Cartas enviadas desde el portal del colaborador. La aprobación documental no confirma el cese laboral; completa el
          proceso en la ficha del colaborador.
        </p>
      </div>

      <Card className="shadow-card">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <CardTitle className="text-sm sm:text-base">Solicitudes</CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Estado</span>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[140px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pendiente">Pendiente</SelectItem>
                <SelectItem value="aprobada">Aprobada</SelectItem>
                <SelectItem value="rechazada">Rechazada</SelectItem>
                <SelectItem value="all">Todos</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <p className="text-sm text-muted-foreground px-5 py-8">Cargando…</p>
          ) : error ? (
            <div className="px-5 py-8 space-y-3">
              <p className="text-sm text-destructive">{error}</p>
              <Button size="sm" variant="outline" type="button" onClick={() => void load()}>
                Reintentar
              </Button>
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground px-5 py-8">No hay solicitudes con este filtro.</p>
          ) : (
            <div className="w-full min-w-0">
              <table className="w-full table-fixed border-collapse text-[11px] sm:text-xs">
                <colgroup>
                  <col className="w-[14%]" />
                  <col className="w-[12%]" />
                  <col className="w-[18%]" />
                  <col className="w-[20%]" />
                  <col className="w-[10%]" />
                  <col className="w-[26%]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="text-left font-semibold text-muted-foreground px-2 py-2">Colaborador</th>
                    <th className="text-left font-semibold text-muted-foreground px-2 py-2">F. prop.</th>
                    <th className="text-left font-semibold text-muted-foreground px-2 py-2">Enviada</th>
                    <th className="text-left font-semibold text-muted-foreground px-2 py-2">Detalle</th>
                    <th className="text-left font-semibold text-muted-foreground px-2 py-2">Estado</th>
                    <th className="text-right font-semibold text-muted-foreground px-2 py-2">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.id} className="border-b border-border last:border-0">
                      <td className="px-2 py-2 font-medium align-top min-w-0 break-words">
                        {row.employee
                          ? formatEmployeeName({
                              first_name: row.employee.first_name,
                              last_name: row.employee.last_name,
                            })
                          : `Colaborador #${row.employee_id}`}
                      </td>
                      <td className="px-2 py-2 tabular-nums text-muted-foreground align-top whitespace-nowrap">
                        {row.proposed_effective_date != null ? formatAppDate(row.proposed_effective_date) : "—"}
                      </td>
                      <td className="px-2 py-2 tabular-nums text-muted-foreground align-top whitespace-nowrap" title={row.created_at ?? undefined}>
                        {formatSentAtCompact(row.created_at)}
                      </td>
                      <td className="px-2 py-2 align-top min-w-0">
                        {row.notes != null && row.notes.trim() !== "" ? (
                          <div className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words text-foreground">
                            {row.notes}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                        {row.status === "rechazada" && row.rejection_reason != null && row.rejection_reason.trim() !== "" ? (
                          <p className="text-[10px] sm:text-[11px] text-muted-foreground mt-1 pt-1 border-t border-border leading-snug">
                            <span className="font-medium text-foreground/80">Rechazo: </span>
                            {row.rejection_reason}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-2 py-2 align-top">
                        <Badge variant={statusVariant(row.status)} className="text-[10px] px-1.5 py-0">
                          {statusLabel(row.status)}
                        </Badge>
                      </td>
                      <td className="px-2 py-2 text-right align-top">
                        <div className="flex flex-wrap justify-end gap-0.5">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-1.5 gap-0.5 text-[10px]"
                            title="Descargar carta (PDF)"
                            disabled={downloadId === row.id}
                            onClick={() => void handleDownload(row)}
                          >
                            <Download className="w-3 h-3 shrink-0" />
                            {downloadId === row.id ? "…" : "PDF"}
                          </Button>
                          {row.status === "pendiente" ? (
                            <>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 px-1.5 text-[10px] leading-none"
                                onClick={() => openDecision(row, "aprobada")}
                              >
                                Aprobar
                              </Button>
                              <Button
                                type="button"
                                variant="destructive"
                                size="sm"
                                className="h-7 px-1.5 text-[10px] leading-none"
                                onClick={() => openDecision(row, "rechazada")}
                              >
                                Rechazar
                              </Button>
                            </>
                          ) : (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 px-1.5 text-[10px] leading-none gap-0.5"
                              title="Corregir estado"
                              onClick={() => openCorrection(row)}
                            >
                              <Pencil className="w-3 h-3 shrink-0" />
                              Corregir
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!loading && !error && meta.total > 0 ? (
            <ListPaginationBar
              page={meta.current_page}
              lastPage={meta.last_page}
              total={meta.total}
              pageSize={meta.per_page}
              loading={loading}
              onPageChange={setPage}
            />
          ) : null}
        </CardContent>
      </Card>

      <Dialog
        open={decisionRow !== null && decisionKind !== null}
        onOpenChange={open => {
          if (!open && !savingDecision) {
            setDecisionRow(null);
            setDecisionKind(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {decisionKind === "aprobada" ? "Aprobar solicitud" : "Rechazar solicitud"}
            </DialogTitle>
          </DialogHeader>
          {decisionKind === "rechazada" ? (
            <div className="space-y-2">
              <Label htmlFor="reject-reason">Motivo del rechazo</Label>
              <Textarea
                id="reject-reason"
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                rows={4}
                placeholder="Visible para el colaborador en el portal."
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Se marcará la solicitud como aprobada a nivel documental y se notificará al colaborador. El cese formal se
              gestiona aparte en la ficha del colaborador.
            </p>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" disabled={savingDecision} onClick={() => (setDecisionRow(null), setDecisionKind(null))}>
              Cancelar
            </Button>
            <Button type="button" disabled={savingDecision} onClick={() => void confirmDecision()}>
              {savingDecision ? "Guardando…" : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={correctionRow !== null}
        onOpenChange={open => {
          if (!open && !savingCorrection) {
            setCorrectionRow(null);
            setCorrectionStatus("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Corregir estado</DialogTitle>
          </DialogHeader>
          {correctionRow ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Estado actual: <span className="font-medium text-foreground">{statusLabel(correctionRow.status)}</span>.
                Usa esto si hubo un error en la decisión; el colaborador recibirá una notificación en el portal.
              </p>
              <div className="space-y-1.5">
                <span className="text-sm font-medium">Nuevo estado</span>
                <Select
                  value={correctionStatus === "" ? undefined : correctionStatus}
                  onValueChange={v => {
                    setCorrectionStatus(v as HrResignationStatus);
                    if (v !== "rechazada") setCorrectionRejectReason("");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona…" />
                  </SelectTrigger>
                  <SelectContent>
                    {correctionRow.status !== "pendiente" ? (
                      <SelectItem value="pendiente">Pendiente (reabrir)</SelectItem>
                    ) : null}
                    {correctionRow.status !== "aprobada" ? (
                      <SelectItem value="aprobada">Aprobada</SelectItem>
                    ) : null}
                    {correctionRow.status !== "rechazada" ? (
                      <SelectItem value="rechazada">Rechazada</SelectItem>
                    ) : null}
                  </SelectContent>
                </Select>
              </div>
              {correctionStatus === "rechazada" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="correction-reject-reason">Motivo del rechazo</Label>
                  <Textarea
                    id="correction-reject-reason"
                    value={correctionRejectReason}
                    onChange={e => setCorrectionRejectReason(e.target.value)}
                    rows={3}
                    placeholder="Visible para el colaborador en el portal."
                  />
                </div>
              ) : null}
            </div>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              disabled={savingCorrection}
              onClick={() => {
                setCorrectionRow(null);
                setCorrectionStatus("");
              }}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={savingCorrection || correctionStatus === ""}
              onClick={() => void confirmCorrection()}
            >
              {savingCorrection ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
