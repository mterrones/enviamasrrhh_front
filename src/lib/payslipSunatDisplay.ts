import type { CompanyProfile } from "@/api/companyProfile";
import type { Employee } from "@/api/employees";
import type { Payslip, PayrollPeriod } from "@/api/payroll";
import { formatDecimalDisplay } from "@/lib/formatDecimalDisplay";

const MONTH_NAMES = [
  "ENERO",
  "FEBRERO",
  "MARZO",
  "ABRIL",
  "MAYO",
  "JUNIO",
  "JULIO",
  "AGOSTO",
  "SEPTIEMBRE",
  "OCTUBRE",
  "NOVIEMBRE",
  "DICIEMBRE",
] as const;

export type PayslipBreakdownLine = {
  code?: string;
  label: string;
  ratio: string;
  amount: string;
};

export type PayslipSunatDisplay = {
  periodTitle: string;
  issuedAt: string;
  companyName: string;
  companyRuc: string;
  companyRubro: string;
  companyAddress: string;
  employerSignerName: string;
  employeeSignerName: string;
  employerSignatureDataUri?: string | null;
  employeeSignatureDataUri?: string | null;
  employeeCode: string;
  employeeFirstNames: string;
  employeeLastNames: string;
  employeeDocumentType: string;
  employeeDni: string;
  employeeBirthDate: string;
  employeeDependents: string;
  employeeAddress: string;
  position: string;
  category: string;
  periodicity: string;
  onpMark: string;
  afpName: string;
  cuspp: string;
  contractStart: string;
  contractEnd: string;
  vacationStart: string;
  vacationEnd: string;
  vacationDays: string;
  daysWorked: string;
  totalHours: string;
  overtimeHours: string;
  daysNotWorked: string;
  otherEmployer: string;
  otherEmployerAmount: string;
  bankAccount: string;
  breakdownEarnings: PayslipBreakdownLine[];
  breakdownDeductions: PayslipBreakdownLine[];
  breakdownEmployerContributions: PayslipBreakdownLine[];
  totalEarnings: string;
  totalDeductions: string;
  totalEmployer: string;
  net: string;
  financialRowCount: number;
};

function display(value: string | null | undefined): string {
  if (value == null) return "—";
  const trimmed = value.trim();
  return trimmed !== "" ? trimmed : "—";
}

function joinNameParts(parts: (string | null | undefined)[]): string {
  const filtered = parts.map((p) => (p ?? "").trim()).filter((p) => p !== "");
  return filtered.length > 0 ? filtered.join(" ") : "—";
}

function formatMoney(amount: number): string {
  return amount.toFixed(2);
}

function formatDate(value: string | null | undefined): string {
  if (value == null || value.trim() === "") return "—";
  const d = new Date(value.includes("T") ? value : `${value}T12:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatSnapshotDate(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") return "—";
  return formatDate(value);
}

function formatSnapshotInt(value: unknown): string {
  if (typeof value !== "number" && typeof value !== "string") return "—";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "—";
  return String(Math.trunc(parsed));
}

function formatSnapshotDecimal(value: unknown): string {
  if (typeof value !== "number" && typeof value !== "string") return "—";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "—";
  return parsed.toFixed(2);
}

function displayContractType(contractType: string | null | undefined): string {
  if (contractType == null || contractType.trim() === "") return "—";
  const normalized = contractType.trim().toLowerCase();
  if (normalized === "indefinido" || normalized === "plazo_indefinido" || normalized === "plazo_fijo" || normalized === "temporal") {
    return "EMPLEADO";
  }
  return contractType.trim().toUpperCase();
}

function resolvePensionRegime(pensionFund: string | null | undefined): { isOnp: boolean; isAfp: boolean; afpName: string } {
  if (pensionFund == null || pensionFund.trim() === "") {
    return { isOnp: false, isAfp: false, afpName: "" };
  }
  const n = pensionFund.trim().toLowerCase().replace(/\s+/g, " ");
  if (n === "onp") {
    return { isOnp: true, isAfp: false, afpName: "" };
  }
  if (n.includes("profuturo") || n.includes("habitat") || n.includes("integra") || n.includes("prima") || n.includes("afp")) {
    return { isOnp: false, isAfp: true, afpName: pensionFund.trim() };
  }
  return { isOnp: false, isAfp: false, afpName: "" };
}

function formatBankAccount(employee: Employee | null): string {
  if (employee == null) return "—";
  const bank = (employee.bank ?? "").trim();
  const account = (employee.bank_account ?? "").trim();
  if (bank && account) return `${bank} — ${account}`;
  if (account) return account;
  if (bank) return bank;
  return "—";
}

function mapBreakdownLines(lines: unknown): PayslipBreakdownLine[] {
  if (!Array.isArray(lines)) return [];
  const out: PayslipBreakdownLine[] = [];
  for (const line of lines) {
    if (!line || typeof line !== "object") continue;
    const o = line as Record<string, unknown>;
    let label = typeof o.label === "string" ? o.label.trim() : "";
    if (!label && typeof o.code === "string") label = o.code;
    const amt = o.amount;
    const amountRaw = typeof amt === "number" ? amt : Number.parseFloat(String(amt ?? ""));
    const ratio =
      typeof o.ratio === "string" || typeof o.ratio === "number"
        ? formatDecimalDisplay(String(o.ratio).trim())
        : "";
    out.push({
      code: typeof o.code === "string" ? o.code : undefined,
      label: label || "—",
      ratio,
      amount: Number.isFinite(amountRaw) ? formatMoney(amountRaw) : "—",
    });
  }
  return out;
}

function sumBreakdownAmounts(lines: PayslipBreakdownLine[], isDeductions = false): number {
  let sum = 0;
  for (const line of lines) {
    if (isDeductions && line.code === "previsional_afp_total") continue;
    const n = Number.parseFloat(line.amount.replace(/,/g, ""));
    if (!Number.isNaN(n)) sum += n;
  }
  return Math.round(sum * 100) / 100;
}

export function formatPayslipPeriodTitle(period: PayrollPeriod | null | undefined): string {
  if (period == null) return "—";
  const monthName = MONTH_NAMES[period.month - 1] ?? String(period.month).padStart(2, "0");
  return `MES DE ${monthName} ${period.year}`;
}

export function buildPayslipSunatDisplay(
  payslip: Payslip,
  employee: Employee | null,
  companyProfile: CompanyProfile | null,
  period: PayrollPeriod | null | undefined,
): PayslipSunatDisplay {
  const meta = payslip.meta as Record<string, unknown> | null | undefined;
  const pb = meta?.payslip_breakdown as Record<string, unknown> | undefined;
  const snapshot = meta?.payslip_period_snapshot as Record<string, unknown> | undefined;

  const breakdownEarnings = mapBreakdownLines(pb?.earnings);
  const breakdownDeductions = mapBreakdownLines(pb?.deductions);
  const breakdownEmployerContributions = mapBreakdownLines(pb?.employer_contributions);

  const grossAmount = Number.parseFloat(String(payslip.gross_amount)) || 0;
  const extraordinaryBonus = Number.parseFloat(String(payslip.extraordinary_bonus_amount ?? "0")) || 0;

  if (breakdownEarnings.length === 0) {
    breakdownEarnings.push({
      label: "Remuneración bruta",
      ratio: "",
      amount: formatMoney(grossAmount),
    });
  }

  if (extraordinaryBonus > 0) {
    breakdownEarnings.push({
      label: "Bonificación extraordinaria",
      ratio: "",
      amount: formatMoney(extraordinaryBonus),
    });
  }

  const pension = resolvePensionRegime(employee?.pension_fund);
  const companyAddress = (companyProfile?.labor_center ?? companyProfile?.fiscal_address ?? "").trim();
  const payFrequency = (employee?.pay_frequency ?? "").trim().toLowerCase();
  const periodicityFromMaster = payFrequency === "quincenal" ? "QUINC." : payFrequency === "semanal" ? "SEM." : "MENS.";
  const periodicity =
    typeof snapshot?.periodicity === "string" && snapshot.periodicity.trim() !== ""
      ? snapshot.periodicity.trim()
      : periodicityFromMaster;
  const otherEmployerAmountFromSnapshot = Number(snapshot?.other_employer_amount);
  const otherEmployerAmountFromMaster = Number(employee?.other_employer_remuneration);

  const totalEarnings = sumBreakdownAmounts(breakdownEarnings);
  const totalDeductions = sumBreakdownAmounts(breakdownDeductions, true);
  const totalEmployer = sumBreakdownAmounts(breakdownEmployerContributions);
  const net = Number.parseFloat(String(payslip.net_amount)) || 0;

  const financialRowCount = Math.max(
    breakdownEarnings.length,
    breakdownDeductions.length,
    breakdownEmployerContributions.length,
    1,
  );

  return {
    periodTitle: formatPayslipPeriodTitle(period),
    issuedAt: formatDate(payslip.issued_at ?? payslip.approved_at),
    companyName: companyProfile?.legal_name?.trim() || "EnviaMas S.A.C.",
    companyRuc: companyProfile?.ruc?.trim() || "20123456789",
    companyRubro: (typeof snapshot?.company_rubro === "string" ? snapshot.company_rubro : companyProfile?.industry ?? "").trim() || "—",
    companyAddress: companyAddress || "—",
    employerSignerName: companyProfile?.legal_name?.trim() || "—",
    employeeSignerName: joinNameParts([employee?.first_name, employee?.middle_name, employee?.last_name, employee?.second_last_name]),
    employerSignatureDataUri: null,
    employeeSignatureDataUri: null,
    employeeCode: display(employee?.employee_code),
    employeeFirstNames: joinNameParts([employee?.first_name, employee?.middle_name]),
    employeeLastNames: joinNameParts([employee?.last_name, employee?.second_last_name]),
    employeeDocumentType: (employee?.document_type ?? "dni").toUpperCase(),
    employeeDni: display(employee?.dni),
    employeeBirthDate: formatDate(employee?.birth_date),
    employeeDependents:
      employee?.dependents_count != null ? String(employee.dependents_count) : "—",
    employeeAddress: display(employee?.address),
    position: display(employee?.position),
    category: displayContractType(employee?.contract_type),
    periodicity,
    onpMark: pension.isOnp ? "X" : "",
    afpName: pension.isAfp ? pension.afpName : "—",
    cuspp: display(employee?.cuspp),
    contractStart: formatDate(employee?.contract_start),
    contractEnd: formatDate(employee?.contract_end),
    vacationStart: formatSnapshotDate(snapshot?.vacation_start),
    vacationEnd: formatSnapshotDate(snapshot?.vacation_end),
    vacationDays: formatSnapshotInt(snapshot?.vacation_days),
    daysWorked: formatSnapshotInt(snapshot?.days_worked),
    totalHours: formatSnapshotDecimal(snapshot?.total_hours),
    overtimeHours: formatSnapshotDecimal(snapshot?.overtime_hours),
    daysNotWorked: formatSnapshotInt(snapshot?.days_not_worked),
    otherEmployer:
      (typeof snapshot?.other_employer === "string" ? snapshot.other_employer : employee?.other_employer_name ?? "").trim() || "—",
    otherEmployerAmount:
      Number.isFinite(otherEmployerAmountFromSnapshot)
        ? formatMoney(otherEmployerAmountFromSnapshot)
        : Number.isFinite(otherEmployerAmountFromMaster)
          ? formatMoney(otherEmployerAmountFromMaster)
          : "—",
    bankAccount: formatBankAccount(employee),
    breakdownEarnings,
    breakdownDeductions,
    breakdownEmployerContributions,
    totalEarnings: formatMoney(totalEarnings),
    totalDeductions: formatMoney(totalDeductions),
    totalEmployer: formatMoney(totalEmployer),
    net: formatMoney(net),
    financialRowCount,
  };
}
