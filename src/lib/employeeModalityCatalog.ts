export const EMPLOYEE_MODALITY_OPTIONS = [
  "Full Time L-V (09:00 - 18:00)",
  "Part Time L-V (09:00 - 13:00)",
  "Part Time L-V (14:00 - 18:00)",
] as const;

const LEGACY_TO_CANONICAL_MODALITY: Record<string, (typeof EMPLOYEE_MODALITY_OPTIONS)[number]> = {
  "Full Time (09:00 - 18:45)": "Full Time L-V (09:00 - 18:00)",
  "Part Time (09:00 - 14:00)": "Part Time L-V (09:00 - 13:00)",
  "Part Time (14:00 - 18:45)": "Part Time L-V (14:00 - 18:00)",
};

export function formatEmployeeModalityDisplay(stored: string | null | undefined): string {
  const trimmed = (stored ?? "").trim();
  if (!trimmed) return "";
  return LEGACY_TO_CANONICAL_MODALITY[trimmed] ?? trimmed;
}

export function resolveModalityForForm(stored: string | null | undefined): string {
  const trimmed = (stored ?? "").trim();
  if (!trimmed) return "";
  return LEGACY_TO_CANONICAL_MODALITY[trimmed] ?? trimmed;
}
