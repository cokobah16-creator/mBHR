// FHIR write paths (Phase H / D-2).
//
// POST   /{Resource}             create — server assigns Resource.id
// PUT    /{Resource}/{id}        update or upsert
// DELETE /{Resource}/{id}        soft-delete (status='entered-in-error')
//
// Each write is gated by the US Core 7.0 validator (see
// supabase/functions/_shared/fhir-validation/core.ts). On any errors[] entry
// the request is rejected with 422 Unprocessable Entity and an
// OperationOutcome listing every issue. Warnings do NOT block the write —
// they're attached to the response Bundle's meta and audited.
//
// Storage: a generic fhir_resources table (Phase H migration). Each
// successful write also fires the snapshot trigger that records a row in
// resource_versions, so the existing _history-instance / vread interactions
// in tefca-ias/history.ts return the freshly written payload at version 1
// (or the next monotonic version on update). Reads still come from the
// canonical clinical tables — a future read-merger will union both.

import { createClient } from "npm:@supabase/supabase-js@2";

import {
  summarizeValidationIssues,
  validateResource,
} from "../_shared/fhir-validation/core.ts";
import {
  type ResourceConfig,
  isResourceSupported,
} from "../_shared/fhir/registry.ts";
import { type TEFCAContext } from "../_shared/fhir/codes.ts";
import { logTEFCAAccess } from "../_shared/fhir/audit.ts";
import { errorResponse, fhirJsonHeaders, fhirJsonResponse } from "./shared.ts";

type SupabaseLike = ReturnType<typeof createClient>;

interface WriteCaller {
  clientId: string;
  qhinId: string;
  scopes: string[];
}

function unprocessable(issues: ReturnType<typeof summarizeValidationIssues>) {
  return new Response(
    JSON.stringify({
      resourceType: "OperationOutcome",
      issue: [
        {
          severity: "error",
          code: "invariant",
          diagnostics: issues ?? "FHIR resource failed US Core 7.0 validation",
        },
      ],
    }),
    { status: 422, headers: fhirJsonHeaders },
  );
}

function methodNotAllowed(method: string, path: string): Response {
  return errorResponse(
    "error",
    "not-supported",
    `${method} ${path} is not allowed`,
    405,
  );
}

function generateLogicalId(): string {
  // Server-assigned FHIR ids should be opaque; UUID v4 is the simplest
  // option that works in browser + Deno without extra deps.
  return crypto.randomUUID();
}

function pickPatientId(payload: Record<string, unknown>): string | null {
  // Patient resource: id IS the patient_id once we adopt patients.fhir_id;
  // for now the server-assigned uuid stays, and patient_id stays null on
  // the row (admins can backfill).
  if (payload.resourceType === "Patient") return null;

  // Most resources reference the patient via subject.reference="Patient/<id>".
  const subject = (payload.subject ?? payload.patient) as
    | { reference?: string }
    | undefined;
  const ref = subject?.reference;
  if (typeof ref === "string" && ref.startsWith("Patient/")) {
    return ref.slice("Patient/".length);
  }
  return null;
}

async function readFhirBody(req: Request): Promise<unknown | null> {
  const ct = req.headers.get("content-type") || "";
  if (!ct.includes("json")) return null;
  try {
    return await req.json();
  } catch {
    return null;
  }
}

/**
 * Validate the candidate payload against the declared resourceType. Returns
 * { ok: true } when no errors[] are present. Warnings are returned for the
 * caller to include in the response.
 */
function gateValidation(
  payload: unknown,
  expectedResourceType: string,
):
  | { ok: true; warnings: string | null }
  | { ok: false; errorMessage: string | null } {
  if (
    !payload ||
    typeof payload !== "object" ||
    !("resourceType" in (payload as Record<string, unknown>))
  ) {
    return { ok: false, errorMessage: "request body is not a FHIR resource" };
  }
  const claimed = (payload as { resourceType: string }).resourceType;
  if (claimed !== expectedResourceType) {
    return {
      ok: false,
      errorMessage: `body declares resourceType=${claimed} but URL targets ${expectedResourceType}`,
    };
  }

  const result = validateResource(
    payload as Parameters<typeof validateResource>[0],
  );
  const summary = summarizeValidationIssues(result);

  if (!result.valid) return { ok: false, errorMessage: summary };
  return { ok: true, warnings: summary };
}

export async function handleCreate(
  supabase: SupabaseLike,
  req: Request,
  baseUrl: string,
  resourceType: string,
  caller: WriteCaller,
  context: TEFCAContext,
  startTime: number,
): Promise<Response> {
  if (!isResourceSupported(resourceType)) {
    return errorResponse(
      "error",
      "not-supported",
      `Resource type ${resourceType} is not supported`,
      400,
    );
  }

  const payload = await readFhirBody(req);
  const validation = gateValidation(payload, resourceType);
  if (!validation.ok) {
    await logTEFCAAccess(
      supabase,
      context,
      [`${resourceType}/POST`],
      0,
      false,
      `validation_failed: ${validation.errorMessage ?? "invalid payload"}`,
      Date.now() - startTime,
    );
    return unprocessable(validation.errorMessage);
  }

  const body = payload as Record<string, unknown>;
  const logicalId = generateLogicalId();
  body.id = logicalId;
  body.meta = {
    ...((body.meta as Record<string, unknown>) ?? {}),
    versionId: "1",
    lastUpdated: new Date().toISOString(),
  };

  const patientId = pickPatientId(body);

  const { error } = await supabase.from("fhir_resources").insert({
    resource_type: resourceType,
    logical_id: logicalId,
    version_id: 1,
    payload: body,
    patient_id: patientId,
    source_client_id: caller.clientId,
    status: "active",
  });

  if (error) {
    await logTEFCAAccess(
      supabase,
      context,
      [`${resourceType}/POST`],
      0,
      false,
      `insert_failed: ${error.message}`,
      Date.now() - startTime,
      patientId ?? undefined,
    );
    return errorResponse(
      "error",
      "exception",
      `failed to persist ${resourceType}: ${error.message}`,
      500,
    );
  }

  await logTEFCAAccess(
    supabase,
    context,
    [`${resourceType}/POST`],
    1,
    true,
    validation.warnings
      ? `validation_warning: ${validation.warnings}`
      : undefined,
    Date.now() - startTime,
    patientId ?? undefined,
  );

  const resp = fhirJsonResponse(body, 201);
  resp.headers.set("Location", `${baseUrl}/${resourceType}/${logicalId}`);
  resp.headers.set("ETag", `W/"1"`);
  if (validation.warnings) {
    resp.headers.set(
      "X-mBHR-Validation",
      `passed-with-warnings; ${validation.warnings.length} chars`,
    );
  }
  return resp;
}

export async function handleUpdate(
  supabase: SupabaseLike,
  req: Request,
  baseUrl: string,
  resourceType: string,
  logicalId: string,
  caller: WriteCaller,
  context: TEFCAContext,
  startTime: number,
): Promise<Response> {
  if (!isResourceSupported(resourceType)) {
    return errorResponse(
      "error",
      "not-supported",
      `Resource type ${resourceType} is not supported`,
      400,
    );
  }

  const payload = await readFhirBody(req);
  const validation = gateValidation(payload, resourceType);
  if (!validation.ok) {
    await logTEFCAAccess(
      supabase,
      context,
      [`${resourceType}/PUT`],
      0,
      false,
      `validation_failed: ${validation.errorMessage ?? "invalid payload"}`,
      Date.now() - startTime,
    );
    return unprocessable(validation.errorMessage);
  }

  const body = payload as Record<string, unknown>;
  if (body.id && body.id !== logicalId) {
    return errorResponse(
      "error",
      "invariant",
      `body Resource.id (${body.id}) does not match URL id (${logicalId})`,
      400,
    );
  }
  body.id = logicalId;

  // Look up the existing row to compute the next version_id and decide
  // 200 vs 201 (RFC 6749-style upsert semantics for FHIR PUT).
  const { data: existing } = await supabase
    .from("fhir_resources")
    .select("version_id, status")
    .eq("resource_type", resourceType)
    .eq("logical_id", logicalId)
    .maybeSingle();

  const existingRow = existing as { version_id: number; status: string } | null;
  const nextVersion = existingRow ? existingRow.version_id + 1 : 1;
  const created = existingRow === null;

  body.meta = {
    ...((body.meta as Record<string, unknown>) ?? {}),
    versionId: String(nextVersion),
    lastUpdated: new Date().toISOString(),
  };

  const patientId = pickPatientId(body);

  const { error } = await supabase.from("fhir_resources").upsert(
    {
      resource_type: resourceType,
      logical_id: logicalId,
      version_id: nextVersion,
      payload: body,
      patient_id: patientId,
      source_client_id: caller.clientId,
      status: "active",
    },
    { onConflict: "resource_type,logical_id" },
  );

  if (error) {
    await logTEFCAAccess(
      supabase,
      context,
      [`${resourceType}/PUT`],
      0,
      false,
      `upsert_failed: ${error.message}`,
      Date.now() - startTime,
      patientId ?? undefined,
    );
    return errorResponse(
      "error",
      "exception",
      `failed to persist ${resourceType}/${logicalId}: ${error.message}`,
      500,
    );
  }

  await logTEFCAAccess(
    supabase,
    context,
    [`${resourceType}/PUT`],
    1,
    true,
    validation.warnings
      ? `validation_warning: ${validation.warnings}`
      : undefined,
    Date.now() - startTime,
    patientId ?? undefined,
  );

  const resp = fhirJsonResponse(body, created ? 201 : 200);
  resp.headers.set("Location", `${baseUrl}/${resourceType}/${logicalId}`);
  resp.headers.set("ETag", `W/"${nextVersion}"`);
  if (validation.warnings) {
    resp.headers.set(
      "X-mBHR-Validation",
      `passed-with-warnings; ${validation.warnings.length} chars`,
    );
  }
  return resp;
}

export async function handleDelete(
  supabase: SupabaseLike,
  resourceType: string,
  logicalId: string,
  context: TEFCAContext,
  startTime: number,
): Promise<Response> {
  if (!isResourceSupported(resourceType)) {
    return errorResponse(
      "error",
      "not-supported",
      `Resource type ${resourceType} is not supported`,
      400,
    );
  }

  // Soft-delete: bump status, leave the row + history snapshot in place
  // for audit. The history endpoint will surface the DELETE operation
  // automatically because resource_versions records the trigger event.
  const { data: existing, error: existingErr } = await supabase
    .from("fhir_resources")
    .select("id, version_id, patient_id, payload")
    .eq("resource_type", resourceType)
    .eq("logical_id", logicalId)
    .maybeSingle();

  if (existingErr) {
    return errorResponse("error", "exception", existingErr.message, 500);
  }
  if (!existing) {
    return errorResponse(
      "error",
      "not-found",
      `${resourceType}/${logicalId} not found`,
      404,
    );
  }

  const row = existing as {
    id: string;
    version_id: number;
    patient_id: string | null;
    payload: Record<string, unknown>;
  };

  const nextVersion = row.version_id + 1;
  const updatedPayload = {
    ...row.payload,
    meta: {
      ...((row.payload.meta as Record<string, unknown>) ?? {}),
      versionId: String(nextVersion),
      lastUpdated: new Date().toISOString(),
    },
  };

  const { error } = await supabase
    .from("fhir_resources")
    .update({
      status: "entered-in-error",
      version_id: nextVersion,
      payload: updatedPayload,
    })
    .eq("id", row.id);

  if (error) {
    return errorResponse(
      "error",
      "exception",
      `failed to delete ${resourceType}/${logicalId}: ${error.message}`,
      500,
    );
  }

  await logTEFCAAccess(
    supabase,
    context,
    [`${resourceType}/DELETE`],
    1,
    true,
    undefined,
    Date.now() - startTime,
    row.patient_id ?? undefined,
  );

  return new Response(null, {
    status: 204,
    headers: fhirJsonHeaders,
  });
}

/** Re-export so the dispatcher can refer to it without an extra import. */
export type { ResourceConfig };
export { methodNotAllowed };
