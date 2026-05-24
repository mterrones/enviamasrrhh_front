export type EmployeeNameParts = {
  first_name?: string | null;
  middle_name?: string | null;
  last_name?: string | null;
  second_last_name?: string | null;
};

function joinNameParts(parts: (string | null | undefined)[]): string {
  return parts
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean)
    .join(" ")
    .trim();
}

export function formatEmployeeName(e: EmployeeNameParts): string {
  return joinNameParts([e.first_name, e.last_name]);
}

export function formatEmployeeFullName(e: EmployeeNameParts): string {
  return joinNameParts([e.first_name, e.middle_name, e.last_name, e.second_last_name]);
}
