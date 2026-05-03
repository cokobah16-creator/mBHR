// Shared types, constants, and HTTP helpers for the FHIR Bulk Data ($export)
// edge function (tefca-bulk).

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Prefer, Accept",
};

export const fhirJsonHeaders = {
  ...corsHeaders,
  "Content-Type": "application/fhir+json",
};

export const fhirNdjsonHeaders = {
  ...corsHeaders,
  "Content-Type": "application/fhir+ndjson",
};

export const FHIR_BULK_BUCKET = "fhir-bulk";

/** Per-job lifetime for signed URLs. Matches expires_at default (7 days). */
export const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7;

export type ExportType = "system" | "patient" | "group";

export interface BulkExportJob {
  id: string;
  client_id: string;
  type: ExportType;
  scope_id: string | null;
  since: string | null;
  resource_types: string[] | null;
  status: "accepted" | "in-progress" | "completed" | "failed" | "cancelled";
  manifest: BulkManifest | null;
  error_message: string | null;
  total_resources: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  expires_at: string;
}

export interface BulkManifestOutput {
  type: string;
  url: string;
  count?: number;
}

export interface BulkManifest {
  /** ISO 8601 transactionTime (per FHIR Bulk Data spec). */
  transactionTime: string;
  /** Original kickoff URL for replay diagnostics. */
  request: string;
  /** Whether the export contains an explicit deleted entry (always false here). */
  requiresAccessToken: true;
  output: BulkManifestOutput[];
  error: BulkManifestOutput[];
}

export function createOperationOutcome(
  severity: "fatal" | "error" | "warning" | "information",
  code: string,
  diagnostics: string,
) {
  return {
    resourceType: "OperationOutcome",
    issue: [{ severity, code, diagnostics }],
  };
}

export function fhirJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: fhirJsonHeaders,
  });
}

export function errorResponse(
  severity: "fatal" | "error" | "warning" | "information",
  code: string,
  diagnostics: string,
  status: number,
): Response {
  return fhirJsonResponse(
    createOperationOutcome(severity, code, diagnostics),
    status,
  );
}

/**
 * Resolve the externally visible base URL for this function. Used to mint
 * Content-Location headers and manifest output.url values.
 */
export function getBulkBaseUrl(): string {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  return `${supabaseUrl.replace(/\/$/, "")}/functions/v1/tefca-bulk`;
}

/** Same kickoff/manifest base used for tefca-ias references in output URLs. */
export function getFhirBaseUrl(): string {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  return `${supabaseUrl.replace(/\/$/, "")}/functions/v1/tefca-ias`;
}

export function clientIp(req: Request): string | null {
  return (
    req.headers.get("x-forwarded-for") ||
    req.headers.get("cf-connecting-ip") ||
    null
  );
}
