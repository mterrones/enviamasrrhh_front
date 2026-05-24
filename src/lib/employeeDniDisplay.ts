const pendingAutoProvisionDniPattern = /^PEND-\d{11}$/;

export function isPendingAutoProvisionDni(dni: string | null | undefined): boolean {
  return pendingAutoProvisionDniPattern.test((dni ?? "").trim());
}

export function displayEmployeeDni(dni: string | null | undefined): string {
  const trimmed = (dni ?? "").trim();
  if (trimmed === "" || isPendingAutoProvisionDni(trimmed)) {
    return "—";
  }
  return trimmed;
}

export function editableEmployeeDni(dni: string | null | undefined): string {
  const trimmed = (dni ?? "").trim();
  if (isPendingAutoProvisionDni(trimmed)) {
    return "";
  }
  return trimmed;
}
