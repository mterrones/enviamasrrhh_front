import type { components } from "@/api/contracts";
import { apiRequest, buildApiUrl, ApiHttpError } from "@/api/client";
import { getAuthToken } from "@/api/authToken";
import { parseApiErrorResponseText } from "@/api/parseApiErrorResponse";

export async function uploadEmployeeSignature(employeeId: number, file: File) {
  const body = new FormData();
  body.append("signature", file);
  return apiRequest<components["schemas"]["EmployeeEnvelope"]>(`/employees/${employeeId}/signature`, {
    method: "POST",
    body,
  });
}

export async function fetchEmployeeSignatureBlob(employeeId: number): Promise<Blob> {
  const headers = new Headers();
  headers.set("Accept", "application/json");
  const token = getAuthToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const res = await fetch(buildApiUrl(`/employees/${employeeId}/signature`), { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiHttpError(res.status, parseApiErrorResponseText(text, res.status, res.statusText));
  }
  return res.blob();
}

export async function deleteEmployeeSignature(employeeId: number) {
  return apiRequest<components["schemas"]["EmployeeEnvelope"]>(`/employees/${employeeId}/signature`, {
    method: "DELETE",
  });
}
