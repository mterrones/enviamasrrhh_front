import type { DeductionInstallmentPlan, IncomeTaxFifthPreviewData, PrevisionalPreviewData } from "@/api/payroll";
import {
  mergeAttendancePreviewIntoDeductionLines,
  isAttendanceSuggestionDeductionCode,
  type AttendancePreviewMergeInput,
} from "@/lib/attendanceDeductionPayslipHelpers";
import {
  installmentLineCodeForPlan,
  isPrevisionalDeductionCode,
  newDeductionLine,
  type DeductionLineDraft,
} from "@/lib/payrollDeductionHelpers";

export function isAutoSyncedDeductionCode(code: string): boolean {
  if (isAttendanceSuggestionDeductionCode(code)) return true;
  if (isPrevisionalDeductionCode(code)) return true;
  if (code.startsWith("installment:")) return true;
  if (code === "income_tax_5th") return true;
  return false;
}

function formatLineAmount(amount: number | string): string {
  if (typeof amount === "number" && Number.isFinite(amount)) return amount.toFixed(2);
  const n = Number.parseFloat(String(amount).replace(",", "."));
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

function activeInstallmentPlansForAuto(plans: DeductionInstallmentPlan[]): DeductionInstallmentPlan[] {
  return plans.filter(
    (p) =>
      p.status === "active" &&
      p.next_installment_number != null &&
      p.next_installment_amount != null,
  );
}

export function deductionDraftContentFingerprint(lines: DeductionLineDraft[]): string {
  return JSON.stringify(lines.map((l) => ({ c: l.code, t: l.label, a: l.amount })));
}

export function reconcilePayslipDeductionDraft(input: {
  currentLines: DeductionLineDraft[];
  attendancePreview: AttendancePreviewMergeInput | null;
  previsional: PrevisionalPreviewData | null;
  previsionalLoading: boolean;
  incomeTaxFifth: IncomeTaxFifthPreviewData | null;
  incomeTaxFifthLoading: boolean;
  installmentPlans: DeductionInstallmentPlan[];
}): DeductionLineDraft[] {
  const {
    currentLines,
    attendancePreview,
    previsional,
    previsionalLoading,
    incomeTaxFifth,
    incomeTaxFifthLoading,
    installmentPlans,
  } = input;

  const manualLines = currentLines.filter((l) => !isAutoSyncedDeductionCode(l.code));
  const carryAttendanceAutoLines =
    attendancePreview == null ? currentLines.filter((l) => isAttendanceSuggestionDeductionCode(l.code)) : [];

  const afterAttendance = attendancePreview
    ? mergeAttendancePreviewIntoDeductionLines([...manualLines, ...carryAttendanceAutoLines], attendancePreview).lines
    : [...manualLines, ...carryAttendanceAutoLines];

  let out = afterAttendance.filter((l) => !isPrevisionalDeductionCode(l.code));
  if (previsionalLoading) {
    out = [...out, ...currentLines.filter((l) => isPrevisionalDeductionCode(l.code))];
  } else if (previsional && previsional.status === "ok" && previsional.proposed_deduction_line) {
    const pl = previsional.proposed_deduction_line;
    out.push(
      newDeductionLine({
        code: pl.code,
        label: pl.label,
        amount: formatLineAmount(pl.amount),
      }),
    );
  }

  out = out.filter((l) => l.code !== "income_tax_5th");
  const hasManualIncomeTax = manualLines.some((l) => l.code === "income_tax");
  if (incomeTaxFifthLoading) {
    out = [...out, ...currentLines.filter((l) => l.code === "income_tax_5th")];
  } else if (!hasManualIncomeTax && incomeTaxFifth && incomeTaxFifth.status === "ok") {
    const pl = incomeTaxFifth.proposed_deduction_line;
    if (pl) {
      out.push(
        newDeductionLine({
          code: pl.code,
          label: pl.label,
          amount: formatLineAmount(pl.amount),
        }),
      );
    } else {
      out.push(
        newDeductionLine({
          code: "income_tax_5th",
          label: "Impuesto a la renta 5ta categoría",
          amount: formatLineAmount(incomeTaxFifth.monthly_suggested_retention ?? "0"),
        }),
      );
    }
  }

  out = out.filter((l) => !l.code.startsWith("installment:"));
  for (const plan of activeInstallmentPlansForAuto(installmentPlans)) {
    const code = installmentLineCodeForPlan(plan.id);
    const nextAmt = plan.next_installment_amount ?? plan.installment_amount;
    const nextNum = plan.next_installment_number ?? plan.installments_applied + 1;
    out.push(
      newDeductionLine({
        code,
        label: `${plan.label} (cuota ${nextNum}/${plan.installment_count})`,
        amount: String(nextAmt),
      }),
    );
  }

  return out;
}
