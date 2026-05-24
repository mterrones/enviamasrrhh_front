import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileText, Download, Send, Plus, Pencil, Trash2, CheckCircle2, ClipboardList, CircleDollarSign, Percent } from "lucide-react";
import { Separator } from "@/components/ui/separator";
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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ApiHttpError } from "@/api/client";
import { fetchDepartments, type Department } from "@/api/departments";
import { fetchAllEmployees, type Employee } from "@/api/employees";
import {
  createPayslip,
  deletePayslip,
  approvePayslip,
  updatePayslip,
  notifyPayslipsForPeriod,
  downloadPayslipPdf,
  downloadPayrollSummaryPdf,
  downloadPayrollPayslipsZip,
  downloadPayrollSummaryXlsx,
  fetchPayrollPeriods,
  fetchPayslipYearsWithPayslips,
  fetchAllPayslipsForPeriod,
  fetchIncomeTaxFifthPreview,
  fetchPrevisionalPreview,
  previewAttendanceDeductions,
  applyPrevisionalToPayslip,
  fetchDeductionInstallmentPlans,
  type Payslip,
  type PayrollPeriod,
  type IncomeTaxFifthPreviewData,
  type PrevisionalPreviewData,
  type DeductionInstallmentPlan,
} from "@/api/payroll";
import { fetchEmployeeSalaryEffective } from "@/api/salaryRevisions";
import { PayrollSalariesTab } from "@/components/payroll/PayrollSalariesTab";
import DeductionsPage from "./DeductionsPage";
import {
  type DeductionLineDraft,
  newDeductionLine,
  sumDeductionLineAmounts,
  deductionLinesFromPayslipMeta,
  buildPayslipBreakdownMeta,
  deductionPlanCategoryLabelEs,
  isPrevisionalDeductionCode,
} from "@/lib/payrollDeductionHelpers";
import { deductionDraftContentFingerprint, reconcilePayslipDeductionDraft } from "@/lib/payslipDraftAutoSync";
import {
  ATTENDANCE_DEDUCTION_LINE_CODE_ABSENCE,
  ATTENDANCE_DEDUCTION_LINE_CODE_LATENESS,
  type AttendancePreviewMergeInput,
} from "@/lib/attendanceDeductionPayslipHelpers";
import { ListPaginationBar } from "@/components/ListPaginationBar";
import { DEFAULT_LIST_PAGE_SIZE } from "@/constants/pagination";
import { formatEmployeeFullName } from "@/lib/employeeName";
import { formatAppDate, formatAppMonthYear } from "@/lib/formatAppDate";
import { normalizeMoneyDecimalInput } from "@/lib/moneyDecimalInput";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { formatRatioPercent, regimeResolvedLabel } from "@/lib/previsionalDisplay";

const meses = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function periodLabel(p: PayrollPeriod): string {
  return formatAppMonthYear(p.month, p.year);
}

function parsePayslipMoney(value: string): number {
  return Number.parseFloat(value.replace(",", ".")) || 0;
}

function computePayslipNetAmount(grossStr: string, dedStr: string, bonusStr: string): string {
  const net = parsePayslipMoney(grossStr) - parsePayslipMoney(dedStr) + parsePayslipMoney(bonusStr);
  return net.toFixed(2);
}

function defaultPayrollPeriodId(periodList: PayrollPeriod[]): string {
  if (periodList.length === 0) return "";
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const match = periodList.find((p) => p.year === y && p.month === m);
  return String((match ?? periodList[0]).id);
}

function formatPen(amount: string | number): string {
  const n = typeof amount === "string" ? Number.parseFloat(amount) : amount;
  if (Number.isNaN(n)) return `S/ ${amount}`;
  return `S/ ${n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

type PayslipDeductionDetalleCtx = {
  attendancePreview: AttendancePreviewMergeInput | null;
  previsional: PrevisionalPreviewData | null;
  previsionalLoading: boolean;
  incomeTaxFifth: IncomeTaxFifthPreviewData | null;
  incomeTaxFifthLoading: boolean;
  installmentPlans: DeductionInstallmentPlan[];
  grossStr: string;
};

function payslipDeductionTipo(code: string): string {
  if (code === ATTENDANCE_DEDUCTION_LINE_CODE_ABSENCE || code === ATTENDANCE_DEDUCTION_LINE_CODE_LATENESS) {
    return "Asistencia";
  }
  if (isPrevisionalDeductionCode(code)) return "Previsional";
  if (code.startsWith("installment:")) return "Plan cuotas";
  if (code === "income_tax_5th" || code === "income_tax") return "Renta";
  return "Otros";
}

function payslipDeductionDetalle(line: DeductionLineDraft, ctx: PayslipDeductionDetalleCtx): string {
  const { code } = line;
  if (code === ATTENDANCE_DEDUCTION_LINE_CODE_ABSENCE) {
    return ctx.attendancePreview ? `${ctx.attendancePreview.absence_days_unjustified} días NJ` : "—";
  }
  if (code === ATTENDANCE_DEDUCTION_LINE_CODE_LATENESS) {
    return ctx.attendancePreview ? `${ctx.attendancePreview.tardiness_events_unjustified} eventos NJ` : "—";
  }
  if (isPrevisionalDeductionCode(code)) {
    if (ctx.previsionalLoading) return "…";
    const g = Number.parseFloat(ctx.grossStr.replace(",", ".")) || 0;
    if (g <= 0) return "Sin bruto";
    const pv = ctx.previsional;
    if (!pv) return "—";
    if (pv.status === "unsupported_regime") return "Régimen no soportado";
    if (pv.status === "missing_legal_rate") return `Sin tasa · ${formatAppDate(pv.reference_date)}`;
    if (pv.status === "ok") return `${regimeResolvedLabel(pv.regime_resolved)} · ${formatRatioPercent(pv.ratio)}`;
    return "—";
  }
  if (code.startsWith("installment:")) {
    const raw = code.slice("installment:".length);
    const id = Number.parseInt(raw, 10);
    if (Number.isNaN(id)) return code;
    const pl = ctx.installmentPlans.find((p) => p.id === id);
    if (!pl) return code;
    const cat = deductionPlanCategoryLabelEs(pl.category);
    const nextNum = pl.next_installment_number ?? pl.installments_applied + 1;
    return `${cat} · Cuota ${nextNum}/${pl.installment_count} · Pend. ${formatPen(pl.remaining_total_amount)}`;
  }
  if (code === "income_tax_5th" || code === "income_tax") {
    if (ctx.incomeTaxFifthLoading) return "…";
    const g = Number.parseFloat(ctx.grossStr.replace(",", ".")) || 0;
    if (g <= 0) return "Sin bruto";
    const t = ctx.incomeTaxFifth;
    if (!t) return "—";
    if (t.status === "missing_uit") return "Sin UIT legal";
    if (t.status === "ok") return `Proy. anual ${formatPen(t.annual_projected_gross)}`;
    return "—";
  }
  if (code === "other") return "Extra";
  if (code === "legacy_total") return "Sin desglose previo";
  return code;
}

function payslipDeductionSortKey(code: string): number {
  if (code === "legacy_total") return 5;
  if (code === ATTENDANCE_DEDUCTION_LINE_CODE_ABSENCE) return 10;
  if (code === ATTENDANCE_DEDUCTION_LINE_CODE_LATENESS) return 20;
  if (isPrevisionalDeductionCode(code)) return 30;
  if (code.startsWith("installment:")) return 40;
  if (code === "income_tax_5th" || code === "income_tax") return 50;
  if (code === "other") return 90;
  return 60;
}

function comparePayslipDeductionLines(a: DeductionLineDraft, b: DeductionLineDraft): number {
  const ka = payslipDeductionSortKey(a.code);
  const kb = payslipDeductionSortKey(b.code);
  if (ka !== kb) return ka - kb;
  if (a.code.startsWith("installment:") && b.code.startsWith("installment:")) {
    const ia = Number.parseInt(a.code.slice("installment:".length), 10) || 0;
    const ib = Number.parseInt(b.code.slice("installment:".length), 10) || 0;
    return ia - ib;
  }
  return a.localId.localeCompare(b.localId);
}

function payrollMutationErrorMessage(err: unknown): string {
  if (err instanceof ApiHttpError) {
    const code = err.apiError?.code;
    if (code === "DUPLICATE_PAYROLL_PERIOD") {
      return "Ya existe un periodo de nómina para ese año y mes.";
    }
    if (code === "DUPLICATE_PAYSLIP") {
      return "Ya existe una boleta para este colaborador en el periodo seleccionado.";
    }
    if (code === "PREVISIONAL_ASSIST_NOT_APPLICABLE") {
      return (
        err.apiError?.message ??
        "No se puede aplicar la asistencia previsional con el régimen o parámetros legales actuales."
      );
    }
    return err.apiError?.message ?? err.message;
  }
  return "No se pudo completar la operación.";
}

export default function PayrollPage() {
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const canGeneratePayroll = hasPermission("payroll.generate");
  const canExportPayrollSummary = hasPermission("reports.export") && hasPermission("payroll.view");
  const canSendPayslipNotification = hasPermission("payroll.send") && hasPermission("payroll.view");
  const [searchParams, setSearchParams] = useSearchParams();
  const payrollModuleTab = useMemo((): "boletas" | "sueldos" | "descuentos" => {
    const t = searchParams.get("tab");
    if (t === "sueldos" || t === "descuentos") return t;
    return "boletas";
  }, [searchParams]);

  const onPayrollModuleTabChange = useCallback(
    (v: string) => {
      if (v === "boletas" || v === "sueldos" || v === "descuentos") {
        const next = new URLSearchParams(searchParams);
        if (v === "boletas") next.delete("tab");
        else next.set("tab", v);
        setSearchParams(next, { replace: true });
      }
    },
    [setSearchParams, searchParams],
  );

  const payslipTableColSpan = canGeneratePayroll ? 6 : 5;
  const [periods, setPeriods] = useState<PayrollPeriod[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState("");
  const [periodFilterYear, setPeriodFilterYear] = useState(() => new Date().getFullYear());
  const [periodFilterMonth, setPeriodFilterMonth] = useState(() => new Date().getMonth() + 1);
  const [payslipMaxYear, setPayslipMaxYear] = useState<number | null>(null);
  const [departmentsList, setDepartmentsList] = useState<Department[]>([]);
  const [employeesList, setEmployeesList] = useState<Employee[]>([]);
  const [areaFilter, setAreaFilter] = useState("all");
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [payslipsLoading, setPayslipsLoading] = useState(false);
  const [payslipsError, setPayslipsError] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [payslipReloadKey, setPayslipReloadKey] = useState(0);
  const [payslipTablePage, setPayslipTablePage] = useState(1);
  const PAYROLL_TABLE_SIZE = DEFAULT_LIST_PAGE_SIZE;
  const [previsionalLoading, setPrevisionalLoading] = useState(false);
  const [previsionalError, setPrevisionalError] = useState<string | null>(null);
  const [previsionalData, setPrevisionalData] = useState<PrevisionalPreviewData | null>(null);

  const [payslipDialogOpen, setPayslipDialogOpen] = useState(false);
  const [payslipEmployeeId, setPayslipEmployeeId] = useState("");
  const [payslipGross, setPayslipGross] = useState("");
  const [payslipDeductions, setPayslipDeductions] = useState("");
  const [payslipExtraordinaryBonus, setPayslipExtraordinaryBonus] = useState("");
  const [payslipNet, setPayslipNet] = useState("");
  const [payslipSaving, setPayslipSaving] = useState(false);
  const [payslipToDelete, setPayslipToDelete] = useState<Payslip | null>(null);
  const [payslipDeleteSaving, setPayslipDeleteSaving] = useState(false);

  const [payslipEditDialogOpen, setPayslipEditDialogOpen] = useState(false);
  const [editPayslipTarget, setEditPayslipTarget] = useState<Payslip | null>(null);
  const [editPayslipGross, setEditPayslipGross] = useState("");
  const [editPayslipDeductions, setEditPayslipDeductions] = useState("");
  const [editPayslipExtraordinaryBonus, setEditPayslipExtraordinaryBonus] = useState("");
  const [editPayslipNet, setEditPayslipNet] = useState("");
  const [editPayslipSaving, setEditPayslipSaving] = useState(false);
  const [payrollExportBusy, setPayrollExportBusy] = useState<null | "xlsx" | "pdf">(null);
  const [payslipApproveBusy, setPayslipApproveBusy] = useState(false);
  const [payslipPdfBusy, setPayslipPdfBusy] = useState(false);
  const [payrollBulkNotifyBusy, setPayrollBulkNotifyBusy] = useState(false);
  const [payrollBulkZipBusy, setPayrollBulkZipBusy] = useState(false);

  const [createDeductionLines, setCreateDeductionLines] = useState<DeductionLineDraft[]>([]);
  const [editDeductionLines, setEditDeductionLines] = useState<DeductionLineDraft[]>([]);
  const [createInstallmentPlans, setCreateInstallmentPlans] = useState<DeductionInstallmentPlan[]>([]);
  const [editInstallmentPlans, setEditInstallmentPlans] = useState<DeductionInstallmentPlan[]>([]);
  const [attendancePreviewBusy, setAttendancePreviewBusy] = useState(false);
  const [editApplyPrevisionalBusy, setEditApplyPrevisionalBusy] = useState(false);
  const [createPayslipPrevisional, setCreatePayslipPrevisional] = useState<PrevisionalPreviewData | null>(null);
  const [createPayslipPrevisionalLoading, setCreatePayslipPrevisionalLoading] = useState(false);
  const [editPayslipPrevisional, setEditPayslipPrevisional] = useState<PrevisionalPreviewData | null>(null);
  const [editPayslipPrevisionalLoading, setEditPayslipPrevisionalLoading] = useState(false);
  const [createAttendancePreview, setCreateAttendancePreview] = useState<AttendancePreviewMergeInput | null>(null);
  const [editAttendancePreview, setEditAttendancePreview] = useState<AttendancePreviewMergeInput | null>(null);
  const [createIncomeTaxFifthPreview, setCreateIncomeTaxFifthPreview] = useState<IncomeTaxFifthPreviewData | null>(null);
  const [createIncomeTaxFifthLoading, setCreateIncomeTaxFifthLoading] = useState(false);
  const [editIncomeTaxFifthPreview, setEditIncomeTaxFifthPreview] = useState<IncomeTaxFifthPreviewData | null>(null);
  const [editIncomeTaxFifthLoading, setEditIncomeTaxFifthLoading] = useState(false);

  const employeeById = useMemo(() => {
    const m: Record<number, Employee> = {};
    employeesList.forEach((e) => {
      m[e.id] = e;
    });
    return m;
  }, [employeesList]);

  const deptById = useMemo(() => {
    const m: Record<number, string> = {};
    departmentsList.forEach((d) => {
      m[d.id] = d.name;
    });
    return m;
  }, [departmentsList]);

  const selectedPeriod = useMemo(
    () => periods.find((p) => String(p.id) === selectedPeriodId),
    [periods, selectedPeriodId],
  );

  const periodYearOptions = useMemo(() => {
    const cy = new Date().getFullYear();
    const maxCreated =
      payslipMaxYear != null && !Number.isNaN(payslipMaxYear) ? payslipMaxYear : cy - 1;
    const upperYear = Math.max(maxCreated, cy) + 1;
    const years: number[] = [];
    for (let y = cy; y <= upperYear; y += 1) {
      years.push(y);
    }
    return years;
  }, [payslipMaxYear]);

  useEffect(() => {
    if (periods.length === 0 || !selectedPeriodId) return;
    const cy = new Date().getFullYear();
    const maxCreated =
      payslipMaxYear != null && !Number.isNaN(payslipMaxYear) ? payslipMaxYear : cy - 1;
    const upperYear = Math.max(maxCreated, cy) + 1;
    const p = periods.find((x) => String(x.id) === selectedPeriodId);
    if (!p || (p.year >= cy && p.year <= upperYear)) return;
    const allowed = periods.filter((x) => x.year >= cy && x.year <= upperYear);
    const nextId = allowed.length > 0 ? defaultPayrollPeriodId(allowed) : "";
    if (nextId !== selectedPeriodId) setSelectedPeriodId(nextId);
  }, [periods, selectedPeriodId, payslipMaxYear]);

  useEffect(() => {
    const p = periods.find((x) => String(x.id) === selectedPeriodId);
    if (p) {
      setPeriodFilterYear(p.year);
      setPeriodFilterMonth(p.month);
    }
  }, [selectedPeriodId, periods]);

  const filteredPayslips = useMemo(() => {
    if (areaFilter === "all") return payslips;
    const deptId = Number(areaFilter);
    if (Number.isNaN(deptId)) return payslips;
    return payslips.filter((p) => {
      const emp = employeeById[p.employee_id];
      return emp?.department_id === deptId;
    });
  }, [payslips, areaFilter, employeeById]);

  useEffect(() => {
    setPayslipTablePage(1);
  }, [selectedPeriodId, areaFilter, payslipReloadKey]);

  const payslipTableLastPage = Math.max(1, Math.ceil(filteredPayslips.length / PAYROLL_TABLE_SIZE));

  const payslipTableRows = useMemo(() => {
    const start = (payslipTablePage - 1) * PAYROLL_TABLE_SIZE;
    return filteredPayslips.slice(start, start + PAYROLL_TABLE_SIZE);
  }, [filteredPayslips, payslipTablePage]);

  useEffect(() => {
    if (payslipTablePage > payslipTableLastPage) {
      setPayslipTablePage(Math.max(1, payslipTableLastPage));
    }
  }, [payslipTablePage, payslipTableLastPage]);

  const previewSlip =
    filteredPayslips.find((p) => p.id === previewId) ?? filteredPayslips[0] ?? null;

  const previewEmployee = previewSlip ? employeeById[previewSlip.employee_id] : null;

  const editPayslipPeriod = useMemo(() => {
    if (!editPayslipTarget) return null;
    return periods.find((x) => x.id === editPayslipTarget.payroll_period_id) ?? null;
  }, [editPayslipTarget, periods]);

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const [perRes, depts, emps, yearsRes] = await Promise.all([
        fetchPayrollPeriods(),
        fetchDepartments(),
        fetchAllEmployees(),
        fetchPayslipYearsWithPayslips().catch(() => ({ data: { max_year_with_payslip: null as number | null } })),
      ]);
      setPeriods(perRes.data);
      setDepartmentsList(depts);
      setEmployeesList(emps);
      setPayslipMaxYear(yearsRes.data.max_year_with_payslip ?? null);
      setSelectedPeriodId((prev) => {
        if (prev && perRes.data.some((p) => String(p.id) === prev)) return prev;
        return defaultPayrollPeriodId(perRes.data);
      });
    } catch (err) {
      const msg =
        err instanceof ApiHttpError ? err.apiError?.message ?? err.message : "No se pudo cargar catálogos de nómina";
      setCatalogError(typeof msg === "string" ? msg : "Error");
      setPeriods([]);
      setPayslipMaxYear(null);
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    if (payslipReloadKey === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetchPayslipYearsWithPayslips();
        if (!cancelled) setPayslipMaxYear(r.data.max_year_with_payslip ?? null);
      } catch {
        if (!cancelled) setPayslipMaxYear(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [payslipReloadKey]);

  const handleOpenPayslipDialog = () => {
    if (!selectedPeriodId) {
      toast({
        title: "Elige un periodo",
        description: "Selecciona un periodo de nómina antes de agregar una boleta.",
        variant: "destructive",
      });
      return;
    }
    setPayslipEmployeeId("");
    setPayslipGross("");
    setPayslipDeductions("");
    setPayslipExtraordinaryBonus("");
    setPayslipNet("");
    setCreateDeductionLines([]);
    setCreateInstallmentPlans([]);
    setCreateAttendancePreview(null);
    setPayslipDialogOpen(true);
  };

  const applyNetFromGrossDeductions = (grossStr: string, dedStr: string, bonusStr: string) => {
    setPayslipNet(computePayslipNetAmount(grossStr, dedStr, bonusStr));
  };

  const handlePayslipEmployeeChange = (value: string) => {
    setPayslipEmployeeId(value);
    setCreateDeductionLines([]);
    setCreateAttendancePreview(null);
    const id = Number.parseInt(value, 10);
    if (Number.isNaN(id)) {
      setCreateInstallmentPlans([]);
      setPayslipGross("");
      return;
    }
    const emp = employeeById[id];
    let grossStr = "";
    const raw = emp?.salary;
    if (raw != null && String(raw).trim() !== "") {
      const n = Number.parseFloat(String(raw).replace(",", "."));
      grossStr = Number.isNaN(n) ? "0.00" : n.toFixed(2);
    } else {
      grossStr = "0.00";
    }
    void fetchDeductionInstallmentPlans(id, { status: "active" })
      .then((r) => setCreateInstallmentPlans(r.data))
      .catch(() => setCreateInstallmentPlans([]));

    const period = periods.find((p) => String(p.id) === selectedPeriodId);
    if (!period) {
      setPayslipGross(grossStr);
      return;
    }
    void fetchEmployeeSalaryEffective(id, period.year, period.month)
      .then((eff) => {
        const amt = eff.data.amount;
        if (amt != null && String(amt).trim() !== "") {
          const n = Number.parseFloat(String(amt).replace(",", "."));
          if (!Number.isNaN(n) && n > 0) {
            setPayslipGross(n.toFixed(2));
            return;
          }
        }
        setPayslipGross(grossStr);
      })
      .catch(() => {
        setPayslipGross(grossStr);
      });
  };

  useEffect(() => {
    const sum = sumDeductionLineAmounts(createDeductionLines);
    setPayslipDeductions(sum.toFixed(2));
    applyNetFromGrossDeductions(payslipGross, sum.toFixed(2), payslipExtraordinaryBonus);
  }, [createDeductionLines, payslipGross, payslipExtraordinaryBonus]);

  useEffect(() => {
    if (!payslipDialogOpen || !payslipEmployeeId || !selectedPeriodId) {
      setCreatePayslipPrevisional(null);
      return;
    }
    const gross = Number.parseFloat(payslipGross.replace(",", ".")) || 0;
    if (gross <= 0) {
      setCreatePayslipPrevisional(null);
      return;
    }
    const empId = Number.parseInt(payslipEmployeeId, 10);
    if (Number.isNaN(empId)) {
      setCreatePayslipPrevisional(null);
      return;
    }
    let cancelled = false;
    setCreatePayslipPrevisionalLoading(true);
    fetchPrevisionalPreview({
      employee_id: empId,
      payroll_period_id: Number.parseInt(selectedPeriodId, 10),
      gross_amount: gross,
    })
      .then((r) => {
        if (!cancelled) setCreatePayslipPrevisional(r.data);
      })
      .catch(() => {
        if (!cancelled) setCreatePayslipPrevisional(null);
      })
      .finally(() => {
        if (!cancelled) setCreatePayslipPrevisionalLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [payslipDialogOpen, payslipEmployeeId, selectedPeriodId, payslipGross]);

  useEffect(() => {
    if (!payslipEditDialogOpen || !editPayslipTarget || !selectedPeriodId) {
      setEditPayslipPrevisional(null);
      return;
    }
    const gross = Number.parseFloat(editPayslipGross.replace(",", ".")) || 0;
    if (gross <= 0) {
      setEditPayslipPrevisional(null);
      return;
    }
    let cancelled = false;
    setEditPayslipPrevisionalLoading(true);
    fetchPrevisionalPreview({
      employee_id: editPayslipTarget.employee_id,
      payroll_period_id: Number.parseInt(selectedPeriodId, 10),
      gross_amount: gross,
    })
      .then((r) => {
        if (!cancelled) setEditPayslipPrevisional(r.data);
      })
      .catch(() => {
        if (!cancelled) setEditPayslipPrevisional(null);
      })
      .finally(() => {
        if (!cancelled) setEditPayslipPrevisionalLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [payslipEditDialogOpen, editPayslipTarget, selectedPeriodId, editPayslipGross]);

  useEffect(() => {
    if (!payslipDialogOpen || !selectedPeriodId) {
      setCreateIncomeTaxFifthPreview(null);
      return;
    }
    const gross = Number.parseFloat(payslipGross.replace(",", ".")) || 0;
    if (gross <= 0) {
      setCreateIncomeTaxFifthPreview(null);
      return;
    }
    const periodId = Number.parseInt(selectedPeriodId, 10);
    if (Number.isNaN(periodId)) {
      setCreateIncomeTaxFifthPreview(null);
      return;
    }
    let cancelled = false;
    setCreateIncomeTaxFifthLoading(true);
    fetchIncomeTaxFifthPreview({
      payroll_period_id: periodId,
      gross_amount: gross,
    })
      .then((r) => {
        if (!cancelled) setCreateIncomeTaxFifthPreview(r.data);
      })
      .catch(() => {
        if (!cancelled) setCreateIncomeTaxFifthPreview(null);
      })
      .finally(() => {
        if (!cancelled) setCreateIncomeTaxFifthLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [payslipDialogOpen, selectedPeriodId, payslipGross]);

  useEffect(() => {
    if (!payslipEditDialogOpen || !editPayslipTarget || !selectedPeriodId) {
      setEditIncomeTaxFifthPreview(null);
      return;
    }
    const gross = Number.parseFloat(editPayslipGross.replace(",", ".")) || 0;
    if (gross <= 0) {
      setEditIncomeTaxFifthPreview(null);
      return;
    }
    const periodId = Number.parseInt(selectedPeriodId, 10);
    if (Number.isNaN(periodId)) {
      setEditIncomeTaxFifthPreview(null);
      return;
    }
    let cancelled = false;
    setEditIncomeTaxFifthLoading(true);
    fetchIncomeTaxFifthPreview({
      payroll_period_id: periodId,
      gross_amount: gross,
    })
      .then((r) => {
        if (!cancelled) setEditIncomeTaxFifthPreview(r.data);
      })
      .catch(() => {
        if (!cancelled) setEditIncomeTaxFifthPreview(null);
      })
      .finally(() => {
        if (!cancelled) setEditIncomeTaxFifthLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [payslipEditDialogOpen, editPayslipTarget, selectedPeriodId, editPayslipGross]);

  useEffect(() => {
    if (!payslipDialogOpen || !payslipEmployeeId || !selectedPeriodId) return;
    let cancelled = false;
    setAttendancePreviewBusy(true);
    (async () => {
      try {
        const gross = Number.parseFloat(payslipGross.replace(",", ".")) || 0;
        const res = await previewAttendanceDeductions({
          employee_id: Number.parseInt(payslipEmployeeId, 10),
          payroll_period_id: Number.parseInt(selectedPeriodId, 10),
          gross_amount: gross,
        });
        if (!cancelled) setCreateAttendancePreview(res.data);
      } catch {
        if (!cancelled) setCreateAttendancePreview(null);
      } finally {
        if (!cancelled) setAttendancePreviewBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [payslipDialogOpen, payslipEmployeeId, selectedPeriodId, payslipGross]);

  useEffect(() => {
    if (!payslipEditDialogOpen || !editPayslipTarget || !selectedPeriodId) return;
    let cancelled = false;
    setAttendancePreviewBusy(true);
    (async () => {
      try {
        const gross = Number.parseFloat(editPayslipGross.replace(",", ".")) || 0;
        const res = await previewAttendanceDeductions({
          employee_id: editPayslipTarget.employee_id,
          payroll_period_id: Number.parseInt(selectedPeriodId, 10),
          gross_amount: gross,
        });
        if (!cancelled) setEditAttendancePreview(res.data);
      } catch {
        if (!cancelled) setEditAttendancePreview(null);
      } finally {
        if (!cancelled) setAttendancePreviewBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [payslipEditDialogOpen, editPayslipTarget, selectedPeriodId, editPayslipGross]);

  useEffect(() => {
    if (!payslipDialogOpen || !payslipEmployeeId || !selectedPeriodId) return;
    setCreateDeductionLines((prev) => {
      const next = reconcilePayslipDeductionDraft({
        currentLines: prev,
        attendancePreview: createAttendancePreview,
        previsional: createPayslipPrevisional,
        previsionalLoading: createPayslipPrevisionalLoading,
        incomeTaxFifth: createIncomeTaxFifthPreview,
        incomeTaxFifthLoading: createIncomeTaxFifthLoading,
        installmentPlans: createInstallmentPlans,
      });
      if (deductionDraftContentFingerprint(prev) === deductionDraftContentFingerprint(next)) return prev;
      return next;
    });
  }, [
    payslipDialogOpen,
    payslipEmployeeId,
    selectedPeriodId,
    createAttendancePreview,
    createPayslipPrevisional,
    createPayslipPrevisionalLoading,
    createIncomeTaxFifthPreview,
    createIncomeTaxFifthLoading,
    createInstallmentPlans,
  ]);

  useEffect(() => {
    if (!payslipEditDialogOpen || !editPayslipTarget || !selectedPeriodId) return;
    setEditDeductionLines((prev) => {
      const next = reconcilePayslipDeductionDraft({
        currentLines: prev,
        attendancePreview: editAttendancePreview,
        previsional: editPayslipPrevisional,
        previsionalLoading: editPayslipPrevisionalLoading,
        incomeTaxFifth: editIncomeTaxFifthPreview,
        incomeTaxFifthLoading: editIncomeTaxFifthLoading,
        installmentPlans: editInstallmentPlans,
      });
      if (deductionDraftContentFingerprint(prev) === deductionDraftContentFingerprint(next)) return prev;
      return next;
    });
  }, [
    payslipEditDialogOpen,
    editPayslipTarget,
    selectedPeriodId,
    editAttendancePreview,
    editPayslipPrevisional,
    editPayslipPrevisionalLoading,
    editIncomeTaxFifthPreview,
    editIncomeTaxFifthLoading,
    editInstallmentPlans,
  ]);

  const handleCreatePayslip = async () => {
    if (!selectedPeriodId) {
      toast({ title: "Sin periodo", description: "Selecciona un periodo.", variant: "destructive" });
      return;
    }
    const empId = Number.parseInt(payslipEmployeeId, 10);
    if (Number.isNaN(empId)) {
      toast({ title: "Colaborador requerido", description: "Selecciona un colaborador.", variant: "destructive" });
      return;
    }
    const gross = parsePayslipMoney(payslipGross);
    const ded = parsePayslipMoney(payslipDeductions);
    const bonus = parsePayslipMoney(payslipExtraordinaryBonus);
    const net = parsePayslipMoney(payslipNet);
    if (gross < 0 || ded < 0 || bonus < 0 || net < 0) {
      toast({ title: "Importes inválidos", description: "Los montos deben ser mayores o iguales a cero.", variant: "destructive" });
      return;
    }
    setPayslipSaving(true);
    try {
      const meta = buildPayslipBreakdownMeta(createDeductionLines);
      const res = await createPayslip({
        payroll_period_id: Number(selectedPeriodId),
        employee_id: empId,
        gross_amount: gross,
        deductions_amount: ded,
        extraordinary_bonus_amount: bonus,
        net_amount: net,
        status: "pendiente",
        apply_previsional_assist: false,
        ...(meta ? { meta } : {}),
      });
      toast({ title: "Boleta creada", description: "El registro se guardó correctamente." });
      setPayslipDialogOpen(false);
      setPayslipReloadKey((k) => k + 1);
      setPreviewId(res.data.id);
    } catch (err) {
      toast({
        title: "No se pudo crear la boleta",
        description: payrollMutationErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setPayslipSaving(false);
    }
  };

  const applyEditNetFromGrossDeductions = (grossStr: string, dedStr: string, bonusStr: string) => {
    setEditPayslipNet(computePayslipNetAmount(grossStr, dedStr, bonusStr));
  };

  const handleOpenEditPayslip = async (p: Payslip, e: MouseEvent) => {
    e.stopPropagation();
    if (!selectedPeriodId) {
      toast({ title: "Sin periodo", description: "Selecciona un período de nómina.", variant: "destructive" });
      return;
    }
    let plansData: DeductionInstallmentPlan[] = [];
    try {
      const plansRes = await fetchDeductionInstallmentPlans(p.employee_id, { status: "active" });
      plansData = plansRes.data;
    } catch {
      plansData = [];
    }
    setEditPayslipTarget(p);
    setEditPayslipGross(normalizeMoneyDecimalInput(String(p.gross_amount)));
    setEditPayslipDeductions(String(p.deductions_amount));
    const bonusRaw = p.extraordinary_bonus_amount;
    setEditPayslipExtraordinaryBonus(
      bonusRaw != null && String(bonusRaw).trim() !== "" && parsePayslipMoney(String(bonusRaw)) !== 0
        ? normalizeMoneyDecimalInput(String(bonusRaw))
        : "",
    );
    setEditPayslipNet(String(p.net_amount));
    const fromMeta = deductionLinesFromPayslipMeta(p.meta);
    const dedNum = Number.parseFloat(String(p.deductions_amount).replace(",", ".")) || 0;
    if (fromMeta.length === 0 && dedNum > 0) {
      setEditDeductionLines([
        newDeductionLine({
          code: "legacy_total",
          label: "Descuentos (sin desglose previo)",
          amount: dedNum.toFixed(2),
        }),
      ]);
    } else {
      setEditDeductionLines(fromMeta);
    }
    setEditInstallmentPlans(plansData);
    setEditAttendancePreview(null);
    setPayslipEditDialogOpen(true);
  };

  const handleEditPayslipGrossChange = (value: string) => {
    const v = normalizeMoneyDecimalInput(value);
    setEditPayslipGross(v);
    const sum = sumDeductionLineAmounts(editDeductionLines);
    applyEditNetFromGrossDeductions(v, sum.toFixed(2), editPayslipExtraordinaryBonus);
  };

  useEffect(() => {
    if (!payslipEditDialogOpen || !editPayslipTarget) return;
    const sum = sumDeductionLineAmounts(editDeductionLines);
    setEditPayslipDeductions(sum.toFixed(2));
    setEditPayslipNet(computePayslipNetAmount(editPayslipGross, sum.toFixed(2), editPayslipExtraordinaryBonus));
  }, [editDeductionLines, editPayslipGross, editPayslipExtraordinaryBonus, payslipEditDialogOpen, editPayslipTarget]);

  const handleUpdatePayslip = async () => {
    if (!editPayslipTarget) return;
    const gross = parsePayslipMoney(editPayslipGross);
    const ded = parsePayslipMoney(editPayslipDeductions);
    const bonus = parsePayslipMoney(editPayslipExtraordinaryBonus);
    const net = parsePayslipMoney(editPayslipNet);
    if (gross < 0 || ded < 0 || bonus < 0 || net < 0) {
      toast({ title: "Importes inválidos", description: "Los montos deben ser mayores o iguales a cero.", variant: "destructive" });
      return;
    }
    const payslipId = editPayslipTarget.id;
    setEditPayslipSaving(true);
    try {
      const prevMeta =
        editPayslipTarget.meta && typeof editPayslipTarget.meta === "object"
          ? { ...(editPayslipTarget.meta as Record<string, unknown>) }
          : {};
      const breakdown = buildPayslipBreakdownMeta(editDeductionLines);
      if (breakdown) {
        Object.assign(prevMeta, breakdown);
      } else {
        delete prevMeta.payslip_breakdown;
      }
      await updatePayslip(payslipId, {
        gross_amount: gross,
        deductions_amount: ded,
        extraordinary_bonus_amount: bonus,
        net_amount: net,
        meta: prevMeta as Record<string, unknown>,
      });
      toast({ title: "Boleta actualizada", description: "Los importes se guardaron correctamente." });
      setPayslipEditDialogOpen(false);
      setEditPayslipTarget(null);
      setPayslipReloadKey((k) => k + 1);
      setPreviewId(payslipId);
    } catch (err) {
      toast({
        title: "No se pudo actualizar la boleta",
        description: payrollMutationErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setEditPayslipSaving(false);
    }
  };

  const handleApplyPrevisionalEdit = async () => {
    if (!editPayslipTarget) return;
    setEditApplyPrevisionalBusy(true);
    try {
      const r = await applyPrevisionalToPayslip(editPayslipTarget.id);
      setEditPayslipTarget(r.data);
      setEditDeductionLines(deductionLinesFromPayslipMeta(r.data.meta));
      setEditPayslipGross(normalizeMoneyDecimalInput(String(r.data.gross_amount)));
      setEditPayslipDeductions(String(r.data.deductions_amount));
      const bonusAfter = r.data.extraordinary_bonus_amount;
      setEditPayslipExtraordinaryBonus(
        bonusAfter != null && String(bonusAfter).trim() !== "" && parsePayslipMoney(String(bonusAfter)) !== 0
          ? normalizeMoneyDecimalInput(String(bonusAfter))
          : "",
      );
      setEditPayslipNet(String(r.data.net_amount));
      toast({ title: "Previsional aplicado", description: "Se actualizó la línea AFP/ONP en el desglose." });
    } catch (err) {
      toast({
        title: "No se pudo aplicar",
        description: payrollMutationErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setEditApplyPrevisionalBusy(false);
    }
  };

  const handleConfirmDeletePayslip = async () => {
    if (!payslipToDelete) return;
    const deletedId = payslipToDelete.id;
    setPayslipDeleteSaving(true);
    try {
      await deletePayslip(deletedId);
      toast({ title: "Boleta eliminada", description: "El registro se eliminó correctamente." });
      setPayslipToDelete(null);
      setPayslipReloadKey((k) => k + 1);
      if (previewId === deletedId) setPreviewId(null);
    } catch (err) {
      toast({
        title: "No se pudo eliminar",
        description: payrollMutationErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setPayslipDeleteSaving(false);
    }
  };

  const handlePayrollExportXlsx = async () => {
    if (!selectedPeriodId) {
      toast({ title: "Sin periodo", description: "Selecciona un periodo de nómina.", variant: "destructive" });
      return;
    }
    setPayrollExportBusy("xlsx");
    try {
      await downloadPayrollSummaryXlsx(Number(selectedPeriodId), areaFilter);
      toast({ title: "Exportación lista", description: "Se descargó el resumen en Excel." });
    } catch (err) {
      toast({
        title: "No se pudo exportar",
        description: payrollMutationErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setPayrollExportBusy(null);
    }
  };

  const handleDownloadPayslipPdf = async () => {
    if (!previewSlip) return;
    setPayslipPdfBusy(true);
    try {
      await downloadPayslipPdf(previewSlip.id);
      toast({ title: "PDF generado", description: "La descarga de la boleta se inició." });
    } catch (err) {
      toast({
        title: "No se pudo generar el PDF",
        description: payrollMutationErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setPayslipPdfBusy(false);
    }
  };

  const handleNotifyPayslipsForPeriod = async () => {
    if (!selectedPeriodId) {
      toast({ title: "Sin periodo", description: "Selecciona un periodo de nómina.", variant: "destructive" });
      return;
    }
    setPayrollBulkNotifyBusy(true);
    try {
      const res = await notifyPayslipsForPeriod(Number(selectedPeriodId), areaFilter);
      const n = res.data.notified_count;
      toast({
        title: "Notificaciones registradas",
        description:
          n === 0
            ? "No hay boletas en el alcance seleccionado (período y filtro de área)."
            : `Se registraron ${n} notificación${n === 1 ? "" : "es"} en el portal.`,
      });
    } catch (err) {
      toast({
        title: "No se pudieron enviar las notificaciones",
        description: payrollMutationErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setPayrollBulkNotifyBusy(false);
    }
  };

  const handlePayrollBulkZipDownload = async () => {
    if (!selectedPeriodId) {
      toast({ title: "Sin periodo", description: "Selecciona un periodo de nómina.", variant: "destructive" });
      return;
    }
    setPayrollBulkZipBusy(true);
    try {
      await downloadPayrollPayslipsZip(Number(selectedPeriodId), areaFilter);
      toast({
        title: "Descarga lista",
        description: "Se generó el ZIP con los PDF de boleta del alcance seleccionado.",
      });
    } catch (err) {
      toast({
        title: "No se pudo generar el ZIP",
        description: payrollMutationErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setPayrollBulkZipBusy(false);
    }
  };

  const handleApprovePayslip = async () => {
    if (!previewSlip) return;
    setPayslipApproveBusy(true);
    try {
      const res = await approvePayslip(previewSlip.id);
      toast({
        title: "Boleta aprobada",
        description: "El colaborador podrá verla en su portal y se registró la notificación correspondiente.",
      });
      setPayslipReloadKey((k) => k + 1);
      setPreviewId(res.data.id);
    } catch (err) {
      toast({
        title: "No se pudo aprobar la boleta",
        description: payrollMutationErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setPayslipApproveBusy(false);
    }
  };

  const handlePayrollExportPdf = async () => {
    if (!selectedPeriodId) {
      toast({ title: "Sin periodo", description: "Selecciona un periodo de nómina.", variant: "destructive" });
      return;
    }
    setPayrollExportBusy("pdf");
    try {
      await downloadPayrollSummaryPdf(Number(selectedPeriodId), areaFilter);
      toast({ title: "Exportación lista", description: "Se descargó el resumen en PDF." });
    } catch (err) {
      toast({
        title: "No se pudo exportar",
        description: payrollMutationErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setPayrollExportBusy(null);
    }
  };

  const payrollExportDisabledReason = !canExportPayrollSummary
    ? "Requiere permisos de exportación de reportes y ver nómina"
    : !selectedPeriodId
      ? "Selecciona un periodo"
      : undefined;

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    setPreviewId(null);
  }, [selectedPeriodId]);

  useEffect(() => {
    if (!selectedPeriodId) {
      setPayslips([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setPayslipsLoading(true);
      setPayslipsError(null);
      try {
        const allSlips = await fetchAllPayslipsForPeriod(Number(selectedPeriodId));
        if (!cancelled) setPayslips(allSlips);
      } catch (err) {
        if (!cancelled) {
          const msg =
            err instanceof ApiHttpError ? err.apiError?.message ?? err.message : "No se pudieron cargar las boletas";
          setPayslipsError(typeof msg === "string" ? msg : "Error");
          setPayslips([]);
        }
      } finally {
        if (!cancelled) setPayslipsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedPeriodId, payslipReloadKey]);

  useEffect(() => {
    if (previewId != null && !filteredPayslips.some((p) => p.id === previewId)) {
      setPreviewId(null);
    }
  }, [filteredPayslips, previewId]);

  useEffect(() => {
    if (!previewSlip?.id || !selectedPeriodId) {
      setPrevisionalData(null);
      setPrevisionalError(null);
      return;
    }
    const slip = previewSlip;
    let cancelled = false;
    (async () => {
      setPrevisionalLoading(true);
      setPrevisionalError(null);
      try {
        const gross = Number.parseFloat(String(slip.gross_amount));
        const r = await fetchPrevisionalPreview({
          employee_id: slip.employee_id,
          payroll_period_id: Number(selectedPeriodId),
          gross_amount: Number.isNaN(gross) ? 0 : gross,
        });
        if (!cancelled) setPrevisionalData(r.data);
      } catch (err) {
        if (!cancelled) {
          const msg =
            err instanceof ApiHttpError ? err.apiError?.message ?? err.message : "No se pudo cargar la sugerencia previsional";
          setPrevisionalError(typeof msg === "string" ? msg : "Error");
          setPrevisionalData(null);
        }
      } finally {
        if (!cancelled) setPrevisionalLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    previewSlip?.id,
    previewSlip?.employee_id,
    previewSlip?.gross_amount,
    selectedPeriodId,
  ]);

  const periodTitle = selectedPeriod ? periodLabel(selectedPeriod) : "—";

  if (catalogLoading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-2xl font-bold">Boletas y Nómina</h1>
          <p className="text-sm text-muted-foreground mt-2">Cargando…</p>
        </div>
      </div>
    );
  }

  if (catalogError) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-2xl font-bold">Boletas y Nómina</h1>
          <p className="text-sm text-destructive mt-2">{catalogError}</p>
          <Button variant="outline" size="sm" className="mt-3" type="button" onClick={() => void loadCatalog()}>
            Reintentar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Boletas y Nómina</h1>
          <p className="text-muted-foreground text-sm mt-1">Gestión de boletas de pago y planilla mensual</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            type="button"
            disabled={
              !selectedPeriodId || !canExportPayrollSummary || payrollBulkZipBusy || payrollExportBusy !== null
            }
            title={
              payrollBulkZipBusy || canExportPayrollSummary
                ? payrollExportBusy !== null
                  ? "Espera a que termine la exportación en curso"
                  : undefined
                : "Requiere permisos de exportación de reportes y ver nómina"
            }
            onClick={() => void handlePayrollBulkZipDownload()}
          >
            <Download className="w-4 h-4" />
            {payrollBulkZipBusy ? "Generando ZIP…" : "Descarga Masiva"}
          </Button>
          <Button
            size="sm"
            className="gap-1.5"
            type="button"
            disabled={
              !selectedPeriodId || !canSendPayslipNotification || payrollBulkNotifyBusy
            }
            title={
              payrollBulkNotifyBusy || canSendPayslipNotification
                ? undefined
                : "Requiere permisos de envío de nómina y ver nómina"
            }
            onClick={() => void handleNotifyPayslipsForPeriod()}
          >
            <Send className="w-4 h-4" />
            {payrollBulkNotifyBusy ? "Enviando…" : "Enviar Notificaciones"}
          </Button>
        </div>
      </div>

      <Tabs value={payrollModuleTab} onValueChange={onPayrollModuleTabChange}>
        <TabsList className="w-full sm:w-auto flex-wrap h-auto gap-1 py-1">
          <TabsTrigger value="boletas" className="gap-2">
            <FileText className="w-4 h-4 shrink-0" />
            Boletas
          </TabsTrigger>
          <TabsTrigger value="sueldos" className="gap-2">
            <CircleDollarSign className="w-4 h-4 shrink-0" />
            Sueldos
          </TabsTrigger>
          <TabsTrigger value="descuentos" className="gap-2">
            <Percent className="w-4 h-4 shrink-0" />
            Descuentos
          </TabsTrigger>
        </TabsList>
        <TabsContent value="boletas" className="space-y-6 mt-4 outline-none">
      <div className="flex gap-3 flex-wrap items-end">
        <div className="flex gap-2 flex-wrap items-end">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Año</Label>
            <Select
              value={String(periodFilterYear)}
              onValueChange={(v) => {
                const year = Number.parseInt(v, 10);
                if (Number.isNaN(year)) return;
                setPeriodFilterYear(year);
                const match = periods.find((p) => p.year === year && p.month === periodFilterMonth);
                setSelectedPeriodId(match ? String(match.id) : "");
              }}
              disabled={periods.length === 0}
            >
              <SelectTrigger className="w-[5.5rem]">
                <SelectValue placeholder="Año" />
              </SelectTrigger>
              <SelectContent>
                {periodYearOptions.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Mes</Label>
            <Select
              value={String(periodFilterMonth)}
              onValueChange={(v) => {
                const month = Number.parseInt(v, 10);
                if (Number.isNaN(month)) return;
                setPeriodFilterMonth(month);
                const match = periods.find((p) => p.year === periodFilterYear && p.month === month);
                setSelectedPeriodId(match ? String(match.id) : "");
              }}
              disabled={periods.length === 0}
            >
              <SelectTrigger className="w-[10.5rem]">
                <SelectValue placeholder="Mes" />
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
        <Select value={areaFilter} onValueChange={setAreaFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Área" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las áreas</SelectItem>
            {departmentsList.map((d) => (
              <SelectItem key={d.id} value={String(d.id)}>
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canGeneratePayroll ? (
          <Button
            type="button"
            size="sm"
            variant="default"
            className="gap-1.5 shrink-0"
            disabled={!selectedPeriodId}
            onClick={handleOpenPayslipDialog}
          >
            <Plus className="w-4 h-4" />
            Nueva boleta
          </Button>
        ) : null}
      </div>

      {periods.length === 0 && !catalogLoading && !catalogError ? (
        <p className="text-sm text-muted-foreground">No hay periodos de nómina disponibles.</p>
      ) : null}

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="text-base">
            {previewSlip && previewEmployee
              ? `Vista Previa de Boleta — ${formatEmployeeFullName(previewEmployee)}`
              : "Vista Previa de Boleta"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {payslipsLoading ? (
            <p className="text-sm text-muted-foreground">Cargando boletas…</p>
          ) : payslipsError ? (
            <div className="space-y-2">
              <p className="text-sm text-destructive">{payslipsError}</p>
              <Button variant="outline" size="sm" type="button" onClick={() => setPayslipReloadKey((k) => k + 1)}>
                Reintentar
              </Button>
            </div>
          ) : !previewSlip ? (
            <p className="text-sm text-muted-foreground">
              No hay boletas para este periodo{areaFilter !== "all" ? " y filtro de área" : ""}. Selecciona una fila en el
              resumen cuando existan registros.
            </p>
          ) : (
            <>
              <div className="border border-border rounded-lg p-5 space-y-4">
                <div className="flex justify-between">
                  <div>
                    <p className="font-bold">EnviaMas S.A.C.</p>
                    <p className="text-xs text-muted-foreground">RUC: 20123456789</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium">Boleta de Pago</p>
                    <p className="text-xs text-muted-foreground">Periodo: {periodTitle}</p>
                  </div>
                </div>
                <Separator />
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  {[
                    ["Colaborador", previewEmployee ? formatEmployeeFullName(previewEmployee) : `#${previewSlip.employee_id}`],
                    ["DNI", previewEmployee?.dni ?? "—"],
                    ["Área", previewEmployee?.department_id != null ? (deptById[previewEmployee.department_id] ?? "—") : "—"],
                    ["Puesto", previewEmployee?.position ?? "—"],
                  ].map(([l, v]) => (
                    <div key={l}>
                      <p className="text-muted-foreground text-xs">{l}</p>
                      <p className="font-medium">{v}</p>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2 items-center">
                  <span className="text-xs text-muted-foreground">Estado boleta</span>
                  <Badge
                    variant={previewSlip.status === "aprobada" ? "default" : "secondary"}
                    className={cn(
                      "text-xs font-medium border",
                      previewSlip.status === "aprobada" &&
                        "bg-emerald-600 hover:bg-emerald-600 text-white border-emerald-600",
                      previewSlip.status === "pendiente" &&
                        "bg-amber-100 text-amber-950 border-amber-200 dark:bg-amber-950 dark:text-amber-50 dark:border-amber-800",
                    )}
                  >
                    {previewSlip.status === "aprobada"
                      ? "Aprobada"
                      : previewSlip.status === "pendiente"
                        ? "Pendiente"
                        : previewSlip.status}
                  </Badge>
                </div>
                <Separator />
                <div className="rounded-md border border-border bg-muted/30 px-3 py-2.5 space-y-2">
                  <p className="text-xs font-semibold text-foreground">Sugerencia previsional (referencia)</p>
                  <p className="text-xs text-muted-foreground">
                    Cálculo asistido según parámetros legales vigentes; no modifica los importes guardados de la boleta.
                  </p>
                  {previsionalLoading ? (
                    <p className="text-xs text-muted-foreground">Cargando sugerencia…</p>
                  ) : previsionalError ? (
                    <div className="space-y-1.5">
                      <p className="text-xs text-destructive">{previsionalError}</p>
                    </div>
                  ) : previsionalData == null ? (
                    <p className="text-xs text-muted-foreground">—</p>
                  ) : previsionalData.status === "unsupported_regime" ? (
                    <p className="text-xs text-amber-800 dark:text-amber-200/90">
                      Régimen no soportado para cálculo automático
                      {previsionalData.pension_fund_original != null && previsionalData.pension_fund_original !== ""
                        ? ` (${previsionalData.pension_fund_original})`
                        : ""}
                      . Revise la ficha del colaborador o cargue la boleta manualmente.
                    </p>
                  ) : previsionalData.status === "missing_legal_rate" ? (
                    <p className="text-xs text-amber-800 dark:text-amber-200/90">
                      No hay tasa legal configurada para la fecha de referencia{" "}
                      {formatAppDate(previsionalData.reference_date)}.
                      {previsionalData.legal_parameter_key != null ? ` (${previsionalData.legal_parameter_key})` : ""}
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                      <div>
                        <span className="text-muted-foreground">Régimen detectado</span>
                        <p className="font-medium">{regimeResolvedLabel(previsionalData.regime_resolved)}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Tasa aplicada</span>
                        <p className="font-medium">{formatRatioPercent(previsionalData.ratio)}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Base (bruto boleta)</span>
                        <p className="font-medium">{formatPen(previsionalData.base_amount)}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Monto sugerido</span>
                        <p className="font-medium text-destructive">
                          {previsionalData.amount != null ? formatPen(previsionalData.amount) : "—"}
                        </p>
                      </div>
                      <div className="sm:col-span-2">
                        <span className="text-muted-foreground">Fecha referencia legal</span>
                        <p className="font-medium">{formatAppDate(previsionalData.reference_date)}</p>
                      </div>
                    </div>
                  )}
                </div>
                <Separator />
                <p className="text-xs text-muted-foreground">
                  Los importes de la boleta son los registrados en el sistema; el desglose detallado depende de
                  meta.payslip_breakdown cuando exista.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <p className="text-sm font-semibold mb-2">Ingresos</p>
                    <div className="flex justify-between text-sm py-1">
                      <span className="text-muted-foreground">Importe bruto</span>
                      <span>{formatPen(previewSlip.gross_amount)}</span>
                    </div>
                    <div className="flex justify-between text-sm py-1 font-semibold border-t border-border mt-1 pt-1">
                      <span>Total</span>
                      <span>{formatPen(previewSlip.gross_amount)}</span>
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-semibold mb-2">Descuentos</p>
                    {(() => {
                      const m = previewSlip.meta as Record<string, unknown> | null | undefined;
                      const pb = m?.payslip_breakdown as { deductions?: { label: string; amount: number }[] } | undefined;
                      const rows = pb?.deductions;
                      return Array.isArray(rows) && rows.length > 0 ? (
                        <ul className="text-xs space-y-1 mb-2 border-b border-border pb-2">
                          {rows.map((r, i) => (
                            <li key={i} className="flex justify-between gap-2">
                              <span className="text-muted-foreground truncate">{r.label}</span>
                              <span className="text-destructive shrink-0">{formatPen(String(r.amount))}</span>
                            </li>
                          ))}
                        </ul>
                      ) : null;
                    })()}
                    <div className="flex justify-between text-sm py-1">
                      <span className="text-muted-foreground">Total descuentos</span>
                      <span className="text-destructive">{formatPen(previewSlip.deductions_amount)}</span>
                    </div>
                    <div className="flex justify-between text-sm py-1 font-semibold border-t border-border mt-1 pt-1">
                      <span>Total</span>
                      <span className="text-destructive">{formatPen(previewSlip.deductions_amount)}</span>
                    </div>
                  </div>
                </div>
                {parsePayslipMoney(String(previewSlip.extraordinary_bonus_amount ?? "0")) > 0 ? (
                  <div className="flex justify-between text-sm py-1">
                    <span className="text-muted-foreground">Bonificación extraordinaria</span>
                    <span className="font-medium text-emerald-600">
                      {formatPen(previewSlip.extraordinary_bonus_amount ?? "0")}
                    </span>
                  </div>
                ) : null}
                <Separator />
                <div className="flex justify-between text-lg font-bold">
                  <span>Neto a Pagar</span>
                  <span className="text-primary">{formatPen(previewSlip.net_amount)}</span>
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <Button
                  size="sm"
                  className="gap-1.5"
                  type="button"
                  disabled={!previewSlip || !canExportPayrollSummary || payslipPdfBusy}
                  title={
                    payslipPdfBusy || canExportPayrollSummary
                      ? undefined
                      : "Requiere permisos de exportación de reportes y ver nómina"
                  }
                  onClick={() => void handleDownloadPayslipPdf()}
                >
                  <FileText className="w-4 h-4" />
                  {payslipPdfBusy ? "Generando…" : "Generar PDF"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 border-emerald-600/40 text-emerald-800 hover:bg-emerald-50 dark:text-emerald-100 dark:hover:bg-emerald-950/40"
                  type="button"
                  disabled={
                    !previewSlip ||
                    !canGeneratePayroll ||
                    payslipApproveBusy ||
                    previewSlip.status === "aprobada"
                  }
                  title={
                    previewSlip?.status === "aprobada"
                      ? "Esta boleta ya está aprobada"
                      : !canGeneratePayroll
                        ? "Requiere permiso para generar nómina"
                        : undefined
                  }
                  onClick={() => void handleApprovePayslip()}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {payslipApproveBusy ? "Aprobando…" : "Aprobar boleta"}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Resumen de Nómina — {periodTitle}</CardTitle>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              type="button"
              disabled={Boolean(payrollExportDisabledReason) || payrollExportBusy !== null}
              title={payrollExportBusy !== null ? undefined : payrollExportDisabledReason}
              onClick={() => void handlePayrollExportXlsx()}
            >
              <Download className="w-3.5 h-3.5" />
              {payrollExportBusy === "xlsx" ? "Generando…" : "Excel"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              type="button"
              disabled={Boolean(payrollExportDisabledReason) || payrollExportBusy !== null}
              title={payrollExportBusy !== null ? undefined : payrollExportDisabledReason}
              onClick={() => void handlePayrollExportPdf()}
            >
              <FileText className="w-3.5 h-3.5" />
              {payrollExportBusy === "pdf" ? "Generando…" : "PDF"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left text-xs font-semibold text-muted-foreground px-5 py-3">Colaborador</th>
                <th className="text-left text-xs font-semibold text-muted-foreground px-5 py-3">Área</th>
                <th className="text-right text-xs font-semibold text-muted-foreground px-5 py-3">Bruto</th>
                <th className="text-right text-xs font-semibold text-muted-foreground px-5 py-3">Descuentos</th>
                <th className="text-right text-xs font-semibold text-muted-foreground px-5 py-3">Neto</th>
                {canGeneratePayroll ? (
                  <th className="text-right text-xs font-semibold text-muted-foreground px-5 py-3 w-[1%] whitespace-nowrap">
                    Acciones
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {payslipsLoading ? (
                <tr>
                  <td colSpan={payslipTableColSpan} className="px-5 py-8 text-center text-sm text-muted-foreground">
                    Cargando boletas…
                  </td>
                </tr>
              ) : payslipsError ? (
                <tr>
                  <td colSpan={payslipTableColSpan} className="px-5 py-8 text-center">
                    <p className="text-sm text-destructive mb-2">{payslipsError}</p>
                    <Button variant="outline" size="sm" type="button" onClick={() => setPayslipReloadKey((k) => k + 1)}>
                      Reintentar
                    </Button>
                  </td>
                </tr>
              ) : filteredPayslips.length === 0 ? (
                <tr>
                  <td colSpan={payslipTableColSpan} className="px-5 py-8 text-center text-sm text-muted-foreground">
                    No hay boletas para mostrar.
                  </td>
                </tr>
              ) : (
                payslipTableRows.map((p) => {
                  const emp = employeeById[p.employee_id];
                  const area =
                    emp?.department_id != null ? (deptById[emp.department_id] ?? "—") : "—";
                  const name = emp ? formatEmployeeFullName(emp) : `#${p.employee_id}`;
                  const sel = previewSlip?.id === p.id;
                  return (
                    <tr
                      key={p.id}
                      className={cn("border-b border-border last:border-0 cursor-pointer hover:bg-muted/30", sel && "bg-muted/40")}
                      onClick={() => setPreviewId(p.id)}
                    >
                      <td className="px-5 py-3 text-sm font-medium">{name}</td>
                      <td className="px-5 py-3 text-sm">{area}</td>
                      <td className="px-5 py-3 text-sm text-right">{formatPen(p.gross_amount)}</td>
                      <td className="px-5 py-3 text-sm text-right text-destructive">{formatPen(p.deductions_amount)}</td>
                      <td className="px-5 py-3 text-sm text-right font-semibold">{formatPen(p.net_amount)}</td>
                      {canGeneratePayroll ? (
                        <td
                          className="px-5 py-3 text-sm text-right align-middle"
                          onClick={(e) => {
                            e.stopPropagation();
                          }}
                        >
                          <div className="inline-flex flex-wrap gap-2 justify-end">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="gap-1.5"
                              onClick={(e) => void handleOpenEditPayslip(p, e)}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              Editar
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="gap-1.5 text-destructive border-destructive/40 hover:bg-destructive/10"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPayslipToDelete(p);
                              }}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Eliminar
                            </Button>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          {!payslipsLoading && !payslipsError ? (
            <ListPaginationBar
              page={Math.min(payslipTablePage, payslipTableLastPage)}
              lastPage={payslipTableLastPage}
              total={filteredPayslips.length}
              pageSize={PAYROLL_TABLE_SIZE}
              onPageChange={setPayslipTablePage}
            />
          ) : null}
        </CardContent>
      </Card>
        </TabsContent>
        <TabsContent value="sueldos" className="space-y-6 mt-4 outline-none">
          <PayrollSalariesTab
            employeesList={employeesList}
            canView={hasPermission("payroll.view")}
            canEdit={canGeneratePayroll}
            onRevisionsChanged={() => void loadCatalog()}
          />
        </TabsContent>
        <TabsContent value="descuentos" className="space-y-6 mt-4 outline-none">
          <DeductionsPage embedded />
        </TabsContent>
      </Tabs>

      <Dialog open={payslipDialogOpen} onOpenChange={setPayslipDialogOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nueva boleta</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {selectedPeriod ? (
              <p className="text-sm text-muted-foreground">
                Periodo: <span className="font-medium text-foreground">{periodLabel(selectedPeriod)}</span>
              </p>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="ps-emp">Colaborador</Label>
              <Select value={payslipEmployeeId} onValueChange={handlePayslipEmployeeChange}>
                <SelectTrigger id="ps-emp">
                  <SelectValue placeholder="Seleccionar colaborador" />
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
            <div className="grid grid-cols-1 gap-3">
              <div className="space-y-2">
                <Label htmlFor="ps-gross">Bruto</Label>
                <Input
                  id="ps-gross"
                  type="text"
                  inputMode="decimal"
                  placeholder={payslipEmployeeId ? "0.00" : "—"}
                  value={payslipGross}
                  disabled
                  readOnly
                  className="bg-muted cursor-not-allowed"
                  title="Sueldo vigente para el periodo de nómina (historial salarial o perfil)"
                />
                <p className="text-xs text-muted-foreground">
                  {payslipEmployeeId
                    ? "Importe bruto según sueldo vigente del periodo (historial en Sueldos o valor del perfil); no se puede editar aquí."
                    : "Selecciona un colaborador para cargar el bruto según el periodo seleccionado."}
                </p>
              </div>
              <div className="rounded-md border border-border bg-muted/20 p-3 space-y-2.5">
                <div className="flex items-center gap-2">
                  <ClipboardList className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Descuentos</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Asistencia, previsional, cuotas activas y renta 5ta se aplican solos según datos del colaborador y el
                  bruto. Solo agregá un descuento extra si hace falta.
                </p>

                {!payslipEmployeeId ? (
                  <p className="text-sm text-muted-foreground">Selecciona un colaborador para ver el detalle de descuentos.</p>
                ) : (
                  (() => {
                    const createDetalleCtx: PayslipDeductionDetalleCtx = {
                      attendancePreview: createAttendancePreview,
                      previsional: createPayslipPrevisional,
                      previsionalLoading: createPayslipPrevisionalLoading,
                      incomeTaxFifth: createIncomeTaxFifthPreview,
                      incomeTaxFifthLoading: createIncomeTaxFifthLoading,
                      installmentPlans: createInstallmentPlans,
                      grossStr: payslipGross,
                    };
                    return (
                      <>
                        {attendancePreviewBusy ? (
                          <p className="text-xs text-muted-foreground">Actualizando asistencia…</p>
                        ) : null}

                        <div className="space-y-1.5">
                          <span className="text-sm font-medium text-foreground">Detalle de Descuentos</span>
                          {createDeductionLines.length === 0 ? (
                            <p className="text-sm text-muted-foreground">Sin líneas en este borrador.</p>
                          ) : (
                            <div className="overflow-x-auto rounded border border-border/60">
                              <table className="w-full text-sm min-w-[360px]">
                                <thead>
                                  <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                                    <th className="px-2 py-1.5 font-medium w-[18%]">Tipo</th>
                                    <th className="px-2 py-1.5 font-medium w-[26%]">Concepto</th>
                                    <th className="px-2 py-1.5 font-medium">Detalle</th>
                                    <th className="px-2 py-1.5 font-medium text-right whitespace-nowrap w-[22%]">Monto</th>
                                  </tr>
                                </thead>
                                <tbody className="text-foreground">
                                  {[...createDeductionLines].sort(comparePayslipDeductionLines).map((line) => {
                                    const detalle = payslipDeductionDetalle(line, createDetalleCtx);
                                    const isOther = line.code === "other";
                                    const amt = Number.parseFloat(String(line.amount).replace(",", "."));
                                    const montoOk = Number.isFinite(amt);
                                    return (
                                      <tr key={line.localId} className="border-b border-border/50 align-top last:border-0">
                                        <td className="px-2 py-1.5 text-muted-foreground">{payslipDeductionTipo(line.code)}</td>
                                        <td className="px-2 py-1.5">
                                          {isOther ? (
                                            <div className="space-y-1">
                                              <Input
                                                className="h-8 text-sm"
                                                value={line.label}
                                                onChange={(e) =>
                                                  setCreateDeductionLines((prev) =>
                                                    prev.map((l) =>
                                                      l.localId === line.localId ? { ...l, label: e.target.value } : l,
                                                    ),
                                                  )
                                                }
                                              />
                                              <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                                                onClick={() =>
                                                  setCreateDeductionLines((prev) =>
                                                    prev.filter((l) => l.localId !== line.localId),
                                                  )
                                                }
                                              >
                                                Quitar
                                              </Button>
                                            </div>
                                          ) : (
                                            <span className="leading-snug">{line.label}</span>
                                          )}
                                        </td>
                                        <td className="px-2 py-1.5 text-muted-foreground text-sm leading-snug break-words max-w-[240px]">
                                          {detalle}
                                        </td>
                                        <td className="px-2 py-1.5 text-right tabular-nums align-top">
                                          {isOther ? (
                                            <Input
                                              type="text"
                                              inputMode="decimal"
                                              className="h-8 text-sm text-right"
                                              value={line.amount}
                                              onChange={(e) =>
                                                setCreateDeductionLines((prev) =>
                                                  prev.map((l) =>
                                                    l.localId === line.localId
                                                      ? { ...l, amount: normalizeMoneyDecimalInput(e.target.value) }
                                                      : l,
                                                  ),
                                                )
                                              }
                                            />
                                          ) : (
                                            <span
                                              className={cn(
                                                !montoOk && "text-muted-foreground",
                                                montoOk && amt === 0 && "text-muted-foreground/90",
                                                montoOk &&
                                                  amt > 0 &&
                                                  isPrevisionalDeductionCode(line.code) &&
                                                  "text-destructive font-medium",
                                              )}
                                            >
                                              {montoOk ? formatPen(amt) : "—"}
                                            </span>
                                          )}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>

                        <div>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 text-sm"
                            onClick={() =>
                              setCreateDeductionLines((prev) => [
                                ...prev,
                                newDeductionLine({ code: "other", label: "Otro descuento", amount: "0" }),
                              ])
                            }
                          >
                            Añadir otro descuento
                          </Button>
                        </div>

                        <div className="space-y-2 pt-1">
                          <Label htmlFor="ps-ded-total">Total descuentos</Label>
                          <Input id="ps-ded-total" readOnly value={payslipDeductions} className="bg-muted h-9 text-sm" />
                        </div>
                      </>
                    );
                  })()
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="ps-extra-bonus">Bonificación extraordinaria</Label>
                <Input
                  id="ps-extra-bonus"
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={payslipExtraordinaryBonus}
                  onChange={(e) => setPayslipExtraordinaryBonus(normalizeMoneyDecimalInput(e.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ps-net">Neto</Label>
                <Input
                  id="ps-net"
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={payslipNet}
                  readOnly
                  disabled
                  className="bg-muted cursor-not-allowed"
                  title="Bruto menos descuentos más bonificación extraordinaria"
                />
                <p className="text-xs text-muted-foreground">
                  Calculado como bruto − descuentos + bonificación extraordinaria (no editable).
                </p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPayslipDialogOpen(false)} disabled={payslipSaving}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void handleCreatePayslip()} disabled={payslipSaving}>
              {payslipSaving ? "Guardando…" : "Crear boleta"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={payslipEditDialogOpen}
        onOpenChange={(open) => {
          setPayslipEditDialogOpen(open);
          if (!open) {
            setEditPayslipTarget(null);
            setEditAttendancePreview(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar boleta</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {editPayslipTarget && editPayslipPeriod ? (
              <p className="text-sm text-muted-foreground">
                Periodo: <span className="font-medium text-foreground">{periodLabel(editPayslipPeriod)}</span>
                {" · "}
                Colaborador:{" "}
                <span className="font-medium text-foreground">
                  {employeeById[editPayslipTarget.employee_id]
                    ? formatEmployeeFullName(employeeById[editPayslipTarget.employee_id]!)
                    : `#${editPayslipTarget.employee_id}`}
                </span>
              </p>
            ) : null}
            <div className="grid grid-cols-1 gap-3">
              <div className="space-y-2">
                <Label htmlFor="ps-edit-gross">Bruto</Label>
                <Input
                  id="ps-edit-gross"
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={editPayslipGross}
                  onChange={(e) => handleEditPayslipGrossChange(e.target.value)}
                />
              </div>
              <div className="rounded-md border border-border bg-muted/20 p-3 space-y-2.5">
                <div className="flex items-center gap-2">
                  <ClipboardList className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Descuentos</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Asistencia, previsional, cuotas activas y renta 5ta se aplican solos según datos del colaborador y el
                  bruto. Podés forzar AFP/ONP desde el servidor o agregar un descuento extra si hace falta.
                </p>

                {!editPayslipTarget ? (
                  <p className="text-sm text-muted-foreground">Sin datos de boleta.</p>
                ) : (
                  (() => {
                    const editDetalleCtx: PayslipDeductionDetalleCtx = {
                      attendancePreview: editAttendancePreview,
                      previsional: editPayslipPrevisional,
                      previsionalLoading: editPayslipPrevisionalLoading,
                      incomeTaxFifth: editIncomeTaxFifthPreview,
                      incomeTaxFifthLoading: editIncomeTaxFifthLoading,
                      installmentPlans: editInstallmentPlans,
                      grossStr: editPayslipGross,
                    };
                    return (
                      <>
                        {attendancePreviewBusy ? (
                          <p className="text-xs text-muted-foreground">Actualizando asistencia…</p>
                        ) : null}

                        <div className="space-y-1.5">
                          <span className="text-sm font-medium text-foreground">Detalle de Descuentos</span>
                          {editDeductionLines.length === 0 ? (
                            <p className="text-sm text-muted-foreground">Sin líneas en esta boleta.</p>
                          ) : (
                            <div className="overflow-x-auto rounded border border-border/60">
                              <table className="w-full text-sm min-w-[360px]">
                                <thead>
                                  <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                                    <th className="px-2 py-1.5 font-medium w-[18%]">Tipo</th>
                                    <th className="px-2 py-1.5 font-medium w-[26%]">Concepto</th>
                                    <th className="px-2 py-1.5 font-medium">Detalle</th>
                                    <th className="px-2 py-1.5 font-medium text-right whitespace-nowrap w-[22%]">Monto</th>
                                  </tr>
                                </thead>
                                <tbody className="text-foreground">
                                  {[...editDeductionLines].sort(comparePayslipDeductionLines).map((line) => {
                                    const detalle = payslipDeductionDetalle(line, editDetalleCtx);
                                    const isOther = line.code === "other";
                                    const amt = Number.parseFloat(String(line.amount).replace(",", "."));
                                    const montoOk = Number.isFinite(amt);
                                    return (
                                      <tr key={line.localId} className="border-b border-border/50 align-top last:border-0">
                                        <td className="px-2 py-1.5 text-muted-foreground">{payslipDeductionTipo(line.code)}</td>
                                        <td className="px-2 py-1.5">
                                          {isOther ? (
                                            <div className="space-y-1">
                                              <Input
                                                className="h-8 text-sm"
                                                value={line.label}
                                                onChange={(e) =>
                                                  setEditDeductionLines((prev) =>
                                                    prev.map((l) =>
                                                      l.localId === line.localId ? { ...l, label: e.target.value } : l,
                                                    ),
                                                  )
                                                }
                                              />
                                              <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                                                onClick={() =>
                                                  setEditDeductionLines((prev) =>
                                                    prev.filter((l) => l.localId !== line.localId),
                                                  )
                                                }
                                              >
                                                Quitar
                                              </Button>
                                            </div>
                                          ) : (
                                            <span className="leading-snug">{line.label}</span>
                                          )}
                                        </td>
                                        <td className="px-2 py-1.5 text-muted-foreground text-sm leading-snug break-words max-w-[240px]">
                                          {detalle}
                                        </td>
                                        <td className="px-2 py-1.5 text-right tabular-nums align-top">
                                          {isOther ? (
                                            <Input
                                              type="text"
                                              inputMode="decimal"
                                              className="h-8 text-sm text-right"
                                              value={line.amount}
                                              onChange={(e) =>
                                                setEditDeductionLines((prev) =>
                                                  prev.map((l) =>
                                                    l.localId === line.localId
                                                      ? { ...l, amount: normalizeMoneyDecimalInput(e.target.value) }
                                                      : l,
                                                  ),
                                                )
                                              }
                                            />
                                          ) : (
                                            <span
                                              className={cn(
                                                !montoOk && "text-muted-foreground",
                                                montoOk && amt === 0 && "text-muted-foreground/90",
                                                montoOk &&
                                                  amt > 0 &&
                                                  isPrevisionalDeductionCode(line.code) &&
                                                  "text-destructive font-medium",
                                              )}
                                            >
                                              {montoOk ? formatPen(amt) : "—"}
                                            </span>
                                          )}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="h-8 text-sm"
                            disabled={!editPayslipTarget || editApplyPrevisionalBusy}
                            title="Recalcula AFP/ONP en el servidor y actualiza el desglose de la boleta."
                            onClick={() => void handleApplyPrevisionalEdit()}
                          >
                            {editApplyPrevisionalBusy ? "…" : "Aplicar AFP/ONP (servidor)"}
                          </Button>
                        </div>

                        <div>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 text-sm"
                            onClick={() =>
                              setEditDeductionLines((prev) => [
                                ...prev,
                                newDeductionLine({ code: "other", label: "Otro descuento", amount: "0" }),
                              ])
                            }
                          >
                            Añadir otro descuento
                          </Button>
                        </div>

                        <div className="space-y-2 pt-1">
                          <Label htmlFor="ps-edit-ded">Total descuentos</Label>
                          <Input id="ps-edit-ded" readOnly value={editPayslipDeductions} className="bg-muted h-9 text-sm" />
                        </div>
                      </>
                    );
                  })()
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="ps-edit-extra-bonus">Bonificación extraordinaria</Label>
                <Input
                  id="ps-edit-extra-bonus"
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={editPayslipExtraordinaryBonus}
                  onChange={(e) => setEditPayslipExtraordinaryBonus(normalizeMoneyDecimalInput(e.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ps-edit-net">Neto</Label>
                <Input
                  id="ps-edit-net"
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={editPayslipNet}
                  readOnly
                  disabled
                  className="bg-muted cursor-not-allowed"
                  title="Bruto menos descuentos más bonificación extraordinaria"
                />
                <p className="text-xs text-muted-foreground">
                  Calculado como bruto − descuentos + bonificación extraordinaria (no editable).
                </p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPayslipEditDialogOpen(false)}
              disabled={editPayslipSaving}
            >
              Cancelar
            </Button>
            <Button type="button" onClick={() => void handleUpdatePayslip()} disabled={editPayslipSaving}>
              {editPayslipSaving ? "Guardando…" : "Guardar cambios"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={payslipToDelete !== null} onOpenChange={(open) => !open && !payslipDeleteSaving && setPayslipToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar esta boleta?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borrará el registro de nómina de forma permanente. El colaborador dejará de ver esta boleta en su portal y se
              eliminarán las notificaciones asociadas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={payslipDeleteSaving}>Cancelar</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={payslipDeleteSaving}
              onClick={() => void handleConfirmDeletePayslip()}
            >
              {payslipDeleteSaving ? "Eliminando…" : "Eliminar"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
