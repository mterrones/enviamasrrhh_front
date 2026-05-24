import { newDeductionLine, type DeductionLineDraft } from "@/lib/payrollDeductionHelpers";

export const ATTENDANCE_DEDUCTION_LINE_CODE_ABSENCE = "absence_suggested" as const;
export const ATTENDANCE_DEDUCTION_LINE_CODE_LATENESS = "lateness_suggested" as const;

export const ATTENDANCE_DEDUCTION_LABEL_ABSENCE = "Inasistencias no justif.";
export const ATTENDANCE_DEDUCTION_LABEL_LATENESS = "Tardanzas no justif.";

export function isAttendanceSuggestionDeductionCode(code: string): boolean {
  return code === ATTENDANCE_DEDUCTION_LINE_CODE_ABSENCE || code === ATTENDANCE_DEDUCTION_LINE_CODE_LATENESS;
}

export function stripAttendanceSuggestionLines(lines: DeductionLineDraft[]): DeductionLineDraft[] {
  return lines.filter((l) => !isAttendanceSuggestionDeductionCode(l.code));
}

export type AttendancePreviewMergeInput = {
  suggested_amounts_computed: boolean;
  suggested_deduction_absence: number;
  suggested_deduction_lateness: number;
  absence_days_unjustified: number;
  tardiness_events_unjustified: number;
};

export type AttendanceMergeKind =
  | "applied_both"
  | "applied_absence_only"
  | "applied_lateness_only"
  | "applied_both_zero"
  | "cleared_needs_gross"
  | "cleared_no_incidents"
  | "cleared_no_monetary_lines";

export function mergeAttendancePreviewIntoDeductionLines(
  currentLines: DeductionLineDraft[],
  preview: AttendancePreviewMergeInput,
): { lines: DeductionLineDraft[]; kind: AttendanceMergeKind } {
  const base = stripAttendanceSuggestionLines(currentLines);

  if (!preview.suggested_amounts_computed) {
    return { lines: base, kind: "cleared_needs_gross" };
  }

  const absAmt = preview.suggested_deduction_absence;
  const latAmt = preview.suggested_deduction_lateness;
  const hasAbsMoney = absAmt > 0;
  const hasLatMoney = latAmt > 0;

  const out: DeductionLineDraft[] = [
    ...base,
    newDeductionLine({
      code: ATTENDANCE_DEDUCTION_LINE_CODE_ABSENCE,
      label: ATTENDANCE_DEDUCTION_LABEL_ABSENCE,
      amount: absAmt.toFixed(2),
    }),
    newDeductionLine({
      code: ATTENDANCE_DEDUCTION_LINE_CODE_LATENESS,
      label: ATTENDANCE_DEDUCTION_LABEL_LATENESS,
      amount: latAmt.toFixed(2),
    }),
  ];

  let kind: AttendanceMergeKind;
  if (hasAbsMoney && hasLatMoney) kind = "applied_both";
  else if (hasAbsMoney) kind = "applied_absence_only";
  else if (hasLatMoney) kind = "applied_lateness_only";
  else kind = "applied_both_zero";

  return { lines: out, kind };
}

export function appendAbsenceSuggestionFromPreview(
  currentLines: DeductionLineDraft[],
  preview: AttendancePreviewMergeInput,
): { lines: DeductionLineDraft[]; added: boolean } {
  if (!preview.suggested_amounts_computed || preview.suggested_deduction_absence <= 0) {
    return { lines: currentLines, added: false };
  }
  if (currentLines.some((l) => l.code === ATTENDANCE_DEDUCTION_LINE_CODE_ABSENCE)) {
    return { lines: currentLines, added: false };
  }
  const base = currentLines.filter((l) => l.code !== ATTENDANCE_DEDUCTION_LINE_CODE_ABSENCE);
  return {
    lines: [
      ...base,
      newDeductionLine({
        code: ATTENDANCE_DEDUCTION_LINE_CODE_ABSENCE,
        label: ATTENDANCE_DEDUCTION_LABEL_ABSENCE,
        amount: preview.suggested_deduction_absence.toFixed(2),
      }),
    ],
    added: true,
  };
}

export function appendLatenessSuggestionFromPreview(
  currentLines: DeductionLineDraft[],
  preview: AttendancePreviewMergeInput,
): { lines: DeductionLineDraft[]; added: boolean } {
  if (!preview.suggested_amounts_computed || preview.suggested_deduction_lateness <= 0) {
    return { lines: currentLines, added: false };
  }
  if (currentLines.some((l) => l.code === ATTENDANCE_DEDUCTION_LINE_CODE_LATENESS)) {
    return { lines: currentLines, added: false };
  }
  const base = currentLines.filter((l) => l.code !== ATTENDANCE_DEDUCTION_LINE_CODE_LATENESS);
  return {
    lines: [
      ...base,
      newDeductionLine({
        code: ATTENDANCE_DEDUCTION_LINE_CODE_LATENESS,
        label: ATTENDANCE_DEDUCTION_LABEL_LATENESS,
        amount: preview.suggested_deduction_lateness.toFixed(2),
      }),
    ],
    added: true,
  };
}

export function attendanceSuggestionMergeToast(
  kind: AttendanceMergeKind,
  preview: AttendancePreviewMergeInput,
): { title: string; description: string; variant?: "default" | "destructive" } {
  switch (kind) {
    case "cleared_needs_gross":
      return {
        title: "Sin montos automáticos",
        description:
          "Indicá un importe bruto mayor a cero en esta boleta para aplicar descuentos automáticos desde asistencia. Podés cargar líneas manualmente o ajustar el bruto y volver a intentar.",
      };
    case "cleared_no_incidents":
      return {
        title: "Sin incidencias NJ en el periodo",
        description:
          "No hay faltas ni tardanzas no justificadas que generen descuento en el preview. No se añadieron líneas de asistencia.",
      };
    case "cleared_no_monetary_lines":
      return {
        title: "Sin líneas de monto a añadir",
        description:
          "El preview no arrojó importes mayores a cero para asistencia (revisá bruto o datos del mes). Podés cargar descuentos manualmente si corresponde.",
      };
    case "applied_both":
    case "applied_absence_only":
    case "applied_lateness_only":
      return {
        title: "Descuentos automáticos aplicados",
        description: `Líneas aplicadas según asistencia (faltas NJ: ${preview.absence_days_unjustified}, tardanzas NJ: ${preview.tardiness_events_unjustified}). Podés editar importes aquí y se guardan en la boleta.`,
      };
    case "applied_both_zero":
      return {
        title: "Descuentos automáticos en cero",
        description: `Faltas NJ: ${preview.absence_days_unjustified}, tardanzas NJ: ${preview.tardiness_events_unjustified}. Los importes automáticos quedaron en cero; las líneas se muestran igual para trazabilidad.`,
      };
  }
}
