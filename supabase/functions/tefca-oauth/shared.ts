// Shared types, constants, and small helpers for the SMART OAuth edge
// function (Phase C-1: discovery + Backend Services).

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
};

export const jsonHeaders = {
  ...corsHeaders,
  "Content-Type": "application/json",
};

export type GrantType =
  | "client_credentials"
  | "authorization_code"
  | "refresh_token";

export type Scope = string;

/** All system/* scopes the FHIR endpoint is willing to issue. Mirrors the
 * FHIR resources the tefca-ias edge function exposes (see registry.ts). */
export const SUPPORTED_SYSTEM_SCOPES = [
  "system/Patient.read",
  "system/Observation.read",
  "system/MedicationRequest.read",
  "system/MedicationDispense.read",
  "system/Encounter.read",
  "system/Immunization.read",
  "system/Condition.read",
  "system/AllergyIntolerance.read",
  "system/DiagnosticReport.read",
  "system/Procedure.read",
  "system/DocumentReference.read",
  "system/CarePlan.read",
  "system/Goal.read",
  "system/ServiceRequest.read",
  "system/*.read",
];

/** Phase H: write-side scopes for the validator-gated POST/PUT/DELETE
 * endpoints. Issued only to clients with token_endpoint_auth_method
 * 'private_key_jwt' (Backend Services) so casual confidential clients
 * can't be talked into pushing data. */
export const SUPPORTED_SYSTEM_WRITE_SCOPES = [
  "system/Patient.write",
  "system/Observation.write",
  "system/MedicationRequest.write",
  "system/MedicationDispense.write",
  "system/Encounter.write",
  "system/Immunization.write",
  "system/Condition.write",
  "system/AllergyIntolerance.write",
  "system/DiagnosticReport.write",
  "system/Procedure.write",
  "system/DocumentReference.write",
  "system/CarePlan.write",
  "system/Goal.write",
  "system/ServiceRequest.write",
  "system/*.write",
];

export const SUPPORTED_PATIENT_SCOPES = [
  "patient/*.read",
  "patient/Patient.read",
  "patient/Observation.read",
  "patient/MedicationRequest.read",
  "patient/Encounter.read",
];

export const SUPPORTED_PATIENT_WRITE_SCOPES = [
  "patient/*.write",
  "patient/Observation.write",
  "patient/Condition.write",
  "patient/AllergyIntolerance.write",
];

export interface OAuthError {
  error:
    | "invalid_request"
    | "invalid_client"
    | "invalid_grant"
    | "unauthorized_client"
    | "unsupported_grant_type"
    | "invalid_scope"
    | "server_error";
  error_description: string;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: jsonHeaders,
  });
}

export function oauthError(
  error: OAuthError["error"],
  description: string,
  status = 400,
): Response {
  return jsonResponse({ error, error_description: description }, status);
}

/**
 * Resolve the externally visible base URL for this OAuth issuer. SMART
 * discovery requires absolute URLs in the well-known docs.
 */
export function getOAuthBaseUrl(): string {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  return `${supabaseUrl.replace(/\/$/, "")}/functions/v1/tefca-oauth`;
}

/** Token endpoint URL — used as the JWT `aud` claim during private_key_jwt. */
export function getTokenEndpoint(): string {
  return `${getOAuthBaseUrl()}/oauth/token`;
}

/**
 * Resolve the base URL of the FHIR endpoint clients reach after OAuth. This
 * lets us advertise it in /.well-known/smart-configuration's `aud_uri`.
 */
export function getFhirBaseUrl(): string {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  return `${supabaseUrl.replace(/\/$/, "")}/functions/v1/tefca-ias`;
}

export function parseScopes(scope: string): string[] {
  return (scope || "")
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Check whether the requested scope set is fully covered by the client's
 * allowed_scopes column. system/*.read in allowed scopes implicitly grants
 * all system/<Type>.read requested scopes.
 */
export function scopesAllowed(requested: string[], allowed: string[]): boolean {
  if (requested.length === 0) return false;
  for (const r of requested) {
    if (allowed.includes(r)) continue;

    // Wildcard expansion: system/*.read covers any system/<Type>.read,
    // patient/*.read covers any patient/<Type>.read.
    const m = r.match(/^(system|patient)\/[^.]+\.([^.]+)$/);
    if (m && allowed.includes(`${m[1]}/*.${m[2]}`)) continue;

    return false;
  }
  return true;
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** sha-256 hex digest used as the at-rest hash for issued bearer tokens. */
export async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
