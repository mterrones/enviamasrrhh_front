import type { components } from "@/api/contracts";
import type { AttendanceRecord } from "@/api/attendance";
import { AGGREGATION_PAGE_SIZE } from "@/constants/pagination";
import { apiRequest, buildApiUrl, ApiHttpError } from "@/api/client";
import { getAuthToken } from "@/api/authToken";

export type PortalPayslip = components["schemas"]["Payslip"] & {
  payroll_period?: {
    id: number;
    year: number;
    month: number;
    created_at?: string | null;
    updated_at?: string | null;
  };
};

export type PortalPayslipsEnvelope = {
  data: PortalPayslip[];
  meta: {
    current_page: number;
    per_page: number;
    total: number;
    last_page: number;
  };
  links: {
    first: string | null;
    last: string | null;
    prev: string | null;
    next: string | null;
  };
};

export type PortalVacationEnvelope = {
  data: components["schemas"]["VacationRequest"][];
  meta: {
    current_page: number;
    per_page: number;
    total: number;
    last_page: number;
  };
  links: {
    first: string | null;
    last: string | null;
    prev: string | null;
    next: string | null;
  };
};

export type PortalResignationRequest = {
  id: number;
  employee_id: number;
  status: string;
  proposed_effective_date: string | null;
  notes: string | null;
  letter_original_name: string | null;
  reviewed_at: string | null;
  reviewed_by_user_id: number | null;
  rejection_reason: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type PortalResignationEnvelope = {
  data: PortalResignationRequest[];
  meta: {
    current_page: number;
    per_page: number;
    total: number;
    last_page: number;
  };
  links: {
    first: string | null;
    last: string | null;
    prev: string | null;
    next: string | null;
  };
};

export type PortalEmployeeNotification = {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  meta: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string | null;
};

export type PortalNotificationsEnvelope = {
  data: PortalEmployeeNotification[];
  meta: {
    current_page: number;
    per_page: number;
    total: number;
    last_page: number;
  };
  links: {
    first: string | null;
    last: string | null;
    prev: string | null;
    next: string | null;
  };
};

export type PortalAttendanceEnvelope = {
  data: components["schemas"]["AttendanceRecord"][];
  meta: {
    current_page: number;
    per_page: number;
    total: number;
    last_page: number;
  };
  links: {
    first: string | null;
    last: string | null;
    prev: string | null;
    next: string | null;
  };
};

export type PortalAsset = components["schemas"]["Asset"];

export type PortalAssetsEnvelope = {
  data: PortalAsset[];
  meta: {
    current_page: number;
    per_page: number;
    total: number;
    last_page: number;
  };
  links: {
    first: string | null;
    last: string | null;
    prev: string | null;
    next: string | null;
  };
};

export type PortalVacationCreateBody = {
  start_date: string;
  end_date: string;
  days: number;
};

function buildQuery(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v != null && v !== "") q.set(k, String(v));
  });
  const s = q.toString();
  return s ? `?${s}` : "";
}

export async function fetchPortalPayslipsPage(params: { page?: number; per_page?: number } = {}) {
  return apiRequest<PortalPayslipsEnvelope>(
    `/portal/payslips${buildQuery({ page: params.page, per_page: params.per_page })}`,
  );
}

export async function fetchPortalVacationRequestsPage(params: {
  page?: number;
  per_page?: number;
  status?: string;
} = {}) {
  return apiRequest<PortalVacationEnvelope>(
    `/portal/vacation-requests${buildQuery({
      page: params.page,
      per_page: params.per_page,
      status: params.status,
    })}`,
  );
}

export async function fetchAllApprovedPortalVacations(): Promise<components["schemas"]["VacationRequest"][]> {
  const perPage = AGGREGATION_PAGE_SIZE;
  let page = 1;
  let lastPage = 1;
  const rows: components["schemas"]["VacationRequest"][] = [];
  do {
    const res = await fetchPortalVacationRequestsPage({
      status: "aprobado",
      per_page: perPage,
      page,
    });
    rows.push(...res.data);
    lastPage = Math.max(1, res.meta.last_page ?? 1);
    page += 1;
  } while (page <= lastPage);

  return rows;
}

export async function fetchPortalResignationRequestsPage(params: {
  page?: number;
  per_page?: number;
  status?: string;
} = {}) {
  return apiRequest<PortalResignationEnvelope>(
    `/portal/resignation-requests${buildQuery({
      page: params.page,
      per_page: params.per_page,
      status: params.status,
    })}`,
  );
}

export async function createPortalResignationRequest(formData: FormData) {
  return apiRequest<{ data: PortalResignationRequest }>("/portal/resignation-requests", {
    method: "POST",
    body: formData,
  });
}

export async function downloadPortalResignationLetterBlob(resignationId: number): Promise<Blob> {
  const headers = new Headers();
  const token = getAuthToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const res = await fetch(buildApiUrl(`/portal/resignation-requests/${resignationId}/letter`), { headers });
  if (!res.ok) {
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { message: text || res.statusText };
    }
    throw new ApiHttpError(res.status, parsed);
  }
  return res.blob();
}

export async function fetchPortalAttendancePage(params: {
  page?: number;
  per_page?: number;
  from?: string;
  to?: string;
} = {}) {
  return apiRequest<PortalAttendanceEnvelope>(
    `/portal/attendance${buildQuery({
      page: params.page,
      per_page: params.per_page,
      from: params.from,
      to: params.to,
    })}`,
  );
}

export async function fetchPortalAssetsPage(params: { page?: number; per_page?: number } = {}) {
  return apiRequest<PortalAssetsEnvelope>(
    `/portal/assets${buildQuery({ page: params.page, per_page: params.per_page })}`,
  );
}

export async function downloadPortalAssetLoanActBlob(assetId: number): Promise<Blob> {
  const headers = new Headers();
  const token = getAuthToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const res = await fetch(buildApiUrl(`/portal/assets/${assetId}/loan-act`), { headers });
  if (!res.ok) {
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { message: text || res.statusText };
    }
    throw new ApiHttpError(res.status, parsed);
  }
  return res.blob();
}

export async function downloadPortalPayslipPdfBlob(payslipId: number): Promise<Blob> {
  const headers = new Headers();
  const token = getAuthToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const res = await fetch(buildApiUrl(`/portal/payslips/${payslipId}/pdf`), { headers });
  if (!res.ok) {
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { message: text || res.statusText };
    }
    throw new ApiHttpError(res.status, parsed);
  }
  return res.blob();
}

export async function fetchAllPortalAttendanceInRange(params: { from: string; to: string }): Promise<
  components["schemas"]["AttendanceRecord"][]
> {
  const per_page = AGGREGATION_PAGE_SIZE;
  const first = await fetchPortalAttendancePage({ ...params, page: 1, per_page });
  const out = [...first.data];
  const lastPage = first.meta.last_page ?? 1;
  for (let p = 2; p <= lastPage; p++) {
    const r = await fetchPortalAttendancePage({ ...params, page: p, per_page });
    out.push(...r.data);
  }
  return out;
}

export async function patchPortalAttendanceJustification(id: number, body: { justification: string }) {
  return apiRequest<{ data: AttendanceRecord }>(`/portal/attendance/${id}`, {
    method: "PATCH",
    body,
  });
}

export async function uploadPortalAttendanceJustificationFile(attendanceId: number, file: File) {
  const fd = new FormData();
  fd.append("file", file);
  return apiRequest<{ data: AttendanceRecord }>(`/portal/attendance/${attendanceId}/justification`, {
    method: "POST",
    body: fd,
  });
}

export async function downloadPortalAttendanceJustificationBlob(attendanceId: number): Promise<Blob> {
  const headers = new Headers();
  const token = getAuthToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const res = await fetch(buildApiUrl(`/portal/attendance/${attendanceId}/justification-file`), { headers });
  if (!res.ok) {
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { message: text || res.statusText };
    }
    throw new ApiHttpError(res.status, parsed);
  }
  return res.blob();
}

export async function createPortalVacationRequest(body: PortalVacationCreateBody) {
  return apiRequest<{ data: components["schemas"]["VacationRequest"] }>("/portal/vacation-requests", {
    method: "POST",
    body,
  });
}

export type PortalVacationUpdateBody = {
  start_date: string;
  end_date: string;
};

export async function patchPortalVacationRequest(id: number, body: PortalVacationUpdateBody) {
  return apiRequest<{ data: components["schemas"]["VacationRequest"] }>(`/portal/vacation-requests/${id}`, {
    method: "PATCH",
    body,
  });
}

export async function deletePortalVacationRequest(id: number) {
  return apiRequest<void>(`/portal/vacation-requests/${id}`, { method: "DELETE" });
}

export async function patchPortalResignationRequest(id: number, formData: FormData) {
  return apiRequest<{ data: PortalResignationRequest }>(`/portal/resignation-requests/${id}`, {
    method: "PATCH",
    body: formData,
  });
}

export async function deletePortalResignationRequest(id: number) {
  return apiRequest<void>(`/portal/resignation-requests/${id}`, { method: "DELETE" });
}

export type PortalPersonalSnapshot = {
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  second_last_name: string | null;
  document_type: string | null;
  dni: string | null;
  employee_code: string | null;
  birth_date: string | null;
  education_level: string | null;
  degree: string | null;
  emergency_contact_name: string | null;
};

export type PortalWorkSnapshot = {
  department_name: string | null;
  position: string | null;
  modality: string | null;
  schedule: string | null;
  salary: string | null;
  contract_type: string | null;
  contract_start: string | null;
  contract_end: string | null;
  status: string | null;
  manager_name: string | null;
  vacation_days_per_year: number | null;
};

export type PortalContact = {
  corporate_email: string | null;
  phone: string | null;
  personal_email: string | null;
  address: string | null;
  emergency_contact_phone: string | null;
  bank: string | null;
  bank_account: string | null;
  bank_account_cci: string | null;
  pension_fund: string | null;
  employer_contribution_option: "essalud" | "sis_microempresa" | null;
  cuspp: string | null;
  dependents_count: number | null;
  has_family_allowance: boolean | null;
  personal: PortalPersonalSnapshot;
  work: PortalWorkSnapshot;
  has_employee_photo_file: boolean;
  has_employee_signature_file: boolean;
};

export type PortalEmployeeDocumentRow = {
  id: number;
  type: string;
  filename: string;
};

export type PortalContactEnvelope = {
  data: PortalContact;
};

export type VacationBalanceData = {
  year: number;
  annual_days: number;
  days_used: number;
  days_pending: number;
  days_available: number;
};

export type VacationBalanceEnvelope = {
  data: VacationBalanceData;
};

export async function fetchPortalContact() {
  return apiRequest<PortalContactEnvelope>("/portal/contact");
}

export async function fetchPortalDocuments() {
  return apiRequest<{ data: PortalEmployeeDocumentRow[] }>("/portal/documents");
}

export async function downloadPortalEmployeeDocumentBlob(
  documentId: number,
  options?: { attachment?: boolean },
): Promise<Blob> {
  const attachment = options?.attachment !== false;
  const qs = attachment ? "?attachment=1" : "?attachment=0";
  const headers = new Headers();
  const token = getAuthToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const res = await fetch(buildApiUrl(`/portal/documents/${documentId}/file${qs}`), { headers });
  if (!res.ok) {
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { message: text || res.statusText };
    }
    throw new ApiHttpError(res.status, parsed);
  }
  return res.blob();
}

export async function fetchPortalEmployeePhotoBlob(): Promise<Blob> {
  const headers = new Headers();
  const token = getAuthToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const res = await fetch(buildApiUrl("/portal/employee-photo"), { headers });
  if (!res.ok) {
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { message: text || res.statusText };
    }
    throw new ApiHttpError(res.status, parsed);
  }
  return res.blob();
}

export async function fetchPortalEmployeeSignatureBlob(): Promise<Blob> {
  const headers = new Headers();
  const token = getAuthToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const res = await fetch(buildApiUrl("/portal/employee-signature"), { headers });
  if (!res.ok) {
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { message: text || res.statusText };
    }
    throw new ApiHttpError(res.status, parsed);
  }
  return res.blob();
}

export async function uploadPortalEmployeeSignature(file: File) {
  const formData = new FormData();
  formData.set("signature", file);
  return apiRequest<{ data: { signature_image_path: string } }>("/portal/employee-signature", {
    method: "POST",
    body: formData,
  });
}

export async function deletePortalEmployeeSignature() {
  return apiRequest<{ data: { signature_image_path: null } }>("/portal/employee-signature", {
    method: "DELETE",
  });
}

export async function patchPortalContact(body: {
  phone?: string | null;
  personal_email?: string | null;
  address?: string | null;
  emergency_contact_phone?: string | null;
  bank?: string | null;
  bank_account?: string | null;
  bank_account_cci?: string | null;
  pension_fund?: string | null;
  employer_contribution_option?: "essalud" | "sis_microempresa" | null;
}) {
  return apiRequest<PortalContactEnvelope>("/portal/contact", {
    method: "PATCH",
    body,
  });
}

export async function fetchPortalVacationBalance(year?: number) {
  const q = year != null ? `?year=${year}` : "";
  return apiRequest<VacationBalanceEnvelope>(`/portal/vacation-balance${q}`);
}

export async function fetchPortalNotificationsPage(params: { page?: number; per_page?: number } = {}) {
  return apiRequest<PortalNotificationsEnvelope>(
    `/portal/notifications${buildQuery({ page: params.page, per_page: params.per_page })}`,
  );
}

export type PortalNotificationEnvelope = {
  data: PortalEmployeeNotification;
};

export async function patchPortalNotificationRead(id: number) {
  return apiRequest<PortalNotificationEnvelope>(`/portal/notifications/${id}/read`, {
    method: "PATCH",
  });
}

export type PortalNotificationsReadAllEnvelope = {
  data: { marked_count: number };
};

export async function postPortalNotificationsReadAll() {
  return apiRequest<PortalNotificationsReadAllEnvelope>("/portal/notifications/read-all", {
    method: "POST",
  });
}
