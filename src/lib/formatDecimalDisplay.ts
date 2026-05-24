const CANONICAL_DECIMALS = 8;
const DEFAULT_DISPLAY_DECIMALS = 2;

export function formatDecimalDisplay(value: string | number | null | undefined): string {
  if (value == null || value === "") return "";
  if (!Number.isFinite(Number(value))) {
    return String(value).trim();
  }

  const float = Number(value);
  const trimmed = float
    .toFixed(CANONICAL_DECIMALS)
    .replace(/0+$/, "")
    .replace(/\.$/, "");

  if (!trimmed.includes(".")) {
    return float.toFixed(DEFAULT_DISPLAY_DECIMALS);
  }

  const decimalPart = trimmed.split(".", 2)[1] ?? "";
  if (decimalPart.length <= DEFAULT_DISPLAY_DECIMALS) {
    return float.toFixed(DEFAULT_DISPLAY_DECIMALS);
  }

  return trimmed;
}
