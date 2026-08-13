// HTTP shape for tefca-ias responses + re-exports of the FHIR-domain helpers
// from _shared/fhir/codes.ts. corsHeaders here advertises the headers
// tefca-ias clients send (bearer Authorization, X-Exchange-Purpose) —
// tefca-bulk has its own corsHeaders with a different surface.

export {
  SYSTEM_IDENTIFIERS,
  US_CORE,
  VITAL_LOINC_CODES,
  SDOH_LOINC_CODES,
  VALID_EXCHANGE_PURPOSES,
  createBundle,
  createOperationOutcome,
  type ExchangePurpose,
  type TEFCAContext,
} from "../_shared/fhir/codes.ts";

import { createOperationOutcome } from "../_shared/fhir/codes.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey, X-Exchange-Purpose",
};

export const fhirJsonHeaders = {
  ...corsHeaders,
  "Content-Type": "application/fhir+json",
};

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
