import type { EmployeeDocument, EmployeeDocumentType } from "@/api/employeeDocuments";

const standardDocumentTypes: EmployeeDocumentType[] = [
  "dni_scan",
  "antecedentes",
  "cv",
  "medical_exam",
  "contract",
];

export function latestEmployeeDocumentByType(rows: EmployeeDocument[]): Map<string, EmployeeDocument> {
  const m = new Map<string, EmployeeDocument>();
  for (const d of rows) {
    if (!m.has(d.type)) {
      m.set(d.type, d);
    }
  }
  return m;
}

export function visibleEmployeeDocuments(rows: EmployeeDocument[]): EmployeeDocument[] {
  const latestByType = latestEmployeeDocumentByType(rows);
  const visible: EmployeeDocument[] = [];

  for (const type of standardDocumentTypes) {
    const doc = latestByType.get(type);
    if (doc) {
      visible.push(doc);
    }
  }

  for (const doc of rows) {
    if (doc.type === "termination_certificate") {
      visible.push(doc);
    }
  }

  return visible.sort((a, b) => b.id - a.id);
}

export function confirmReplaceEmployeeDocument(typeLabel: string): boolean {
  return window.confirm(
    `¿Reemplazar el documento "${typeLabel}"? El archivo anterior se eliminará permanentemente.`,
  );
}
