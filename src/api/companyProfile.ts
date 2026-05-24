import { apiRequest, ApiHttpError, buildApiUrl } from "@/api/client";
import { getAuthToken } from "@/api/authToken";
import { parseApiErrorResponseText } from "@/api/parseApiErrorResponse";

export type CompanyProfile = {
  id: number;
  legal_name?: string | null;
  ruc?: string | null;
  industry?: string | null;
  fiscal_address?: string | null;
  labor_center?: string | null;
  logo_path?: string | null;
  employer_signer_name?: string | null;
  employer_signature_path?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type CompanyProfileEnvelope = {
  data: CompanyProfile;
};

export type CompanyProfileWrite = {
  legal_name?: string | null;
  ruc?: string | null;
  industry?: string | null;
  fiscal_address?: string | null;
  labor_center?: string | null;
  logo_path?: string | null;
  employer_signer_name?: string | null;
  employer_signature_path?: string | null;
};

export async function fetchCompanyProfile() {
  return apiRequest<CompanyProfileEnvelope>("/company-profile");
}

export async function patchCompanyProfile(body: CompanyProfileWrite) {
  return apiRequest<CompanyProfileEnvelope>("/company-profile", {
    method: "PATCH",
    body,
  });
}

export async function uploadCompanyEmployerSignature(file: File) {
  const body = new FormData();
  body.append("signature", file);
  return apiRequest<CompanyProfileEnvelope>("/company-profile/employer-signature", {
    method: "POST",
    body,
  });
}

export async function deleteCompanyEmployerSignature() {
  return apiRequest<CompanyProfileEnvelope>("/company-profile/employer-signature", {
    method: "DELETE",
  });
}

export async function fetchCompanyEmployerSignatureBlob(): Promise<Blob> {
  const headers = new Headers();
  headers.set("Accept", "application/json");
  const token = getAuthToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const res = await fetch(buildApiUrl("/company-profile/employer-signature"), { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiHttpError(res.status, parseApiErrorResponseText(text, res.status, res.statusText));
  }
  return res.blob();
}
