// FHIR Bulk Data Access ($export) — async kickoff + status + file streaming.
//
// Endpoints (Phase E-1):
//   POST   /$export                       system-level export kickoff
//   POST   /Patient/$export               patient-level (all patients)
//   POST   /Group/{groupId}/$export       group-scoped (Phase E-2 will gate
//                                          on actual Group membership)
//   GET    /bulk-status/{jobId}           async polling
//   GET    /bulk-files/{jobId}/{file}     stream NDJSON (302 -> signed URL)
//   DELETE /bulk-status/{jobId}           cancel + drop output
//
// Auth: requires a bearer token (validated against oauth_access_tokens via
// the same introspection logic as tefca-ias). In Phase E-1 the legacy
// X-QHIN-ID header is NOT accepted here — only Bearer tokens with
// `system/*.read` (or per-resource `system/<Type>.read`) scope. Bulk Data
// is new in this codebase, so the deprecation window doesn't apply.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import {
  extractBearerToken,
  introspectBearer,
  scopeAllowsResource,
} from "../_shared/fhir/bearer-auth.ts";
import { logTEFCAAccess } from "../_shared/fhir/audit.ts";
import { processJob } from "./processor.ts";
import {
  type BulkExportJob,
  type ExportType,
  clientIp,
  corsHeaders,
  errorResponse,
  fhirJsonHeaders,
  getBulkBaseUrl,
} from "./shared.ts";
import { signOutputUrl, streamObject, deleteJobObjects } from "./storage.ts";
import { enforceRateLimit } from "../_shared/security/rateLimit.ts";

type SupabaseLike = ReturnType<typeof createClient>;

interface AuthorizedCaller {
  clientId: string;
  scopes: string[];
  qhinId: string;
}

declare const EdgeRuntime: {
  waitUntil?: (p: Promise<unknown>) => void;
};

async function authorize(
  supabase: SupabaseLike,
  req: Request,
): Promise<AuthorizedCaller | Response> {
  const token = extractBearerToken(req);
  if (!token) {
    return errorResponse(
      "error",
      "login",
      "Authorization: Bearer <access_token> required for /$export",
      401,
    );
  }
  const introspection = await introspectBearer(supabase, token);
  if (!introspection.active) {
    return errorResponse(
      "error",
      "login",
      "bearer token is inactive, expired, or revoked",
      401,
    );
  }
  return {
    clientId: introspection.client_id ?? introspection.qhinId ?? "unknown",
    scopes: introspection.scopes,
    qhinId: introspection.qhinId ?? introspection.client_id ?? "unknown",
  };
}

function parseAcceptedTypes(req: Request, body: unknown): string[] | null {
  const url = new URL(req.url);
  const queryType = url.searchParams.get("_type");
  if (queryType)
    return queryType
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

  // FHIR Bulk Data also accepts a Parameters body with name=_type entries.
  const params = (body as { parameter?: unknown[] })?.parameter || [];
  const types: string[] = [];
  for (const p of params as Array<{ name?: string; valueString?: string }>) {
    if (p.name === "_type" && p.valueString) types.push(p.valueString);
  }
  return types.length > 0 ? types : null;
}

function parseSince(req: Request, body: unknown): string | null {
  const url = new URL(req.url);
  const querySince = url.searchParams.get("_since");
  if (querySince) return querySince;
  const params = (body as { parameter?: unknown[] })?.parameter || [];
  for (const p of params as Array<{ name?: string; valueInstant?: string }>) {
    if (p.name === "_since" && p.valueInstant) return p.valueInstant;
  }
  return null;
}

async function readBody(req: Request): Promise<unknown> {
  const ct = req.headers.get("content-type") || "";
  if (req.method !== "POST") return null;
  if (ct.includes("application/json") || ct.includes("application/fhir+json")) {
    try {
      return await req.json();
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Verify the caller has scope for every resource type the job will emit.
 * Resources without registry entries are quietly dropped from the target
 * set (the processor already skips them).
 */
function unauthorizedResources(
  scopes: string[],
  resourceTypes: string[],
): string[] {
  if (scopes.includes("system/*.read")) return [];
  return resourceTypes.filter((t) => !scopeAllowsResource(scopes, t));
}

/**
 * Group/{id}/$export enforcement.
 *
 * mBHR doesn't currently have a FHIR Group resource (no `groups` table, no
 * group_membership join). When a partner system kicks off a Group export, we
 * have nothing to check membership against, so we refuse with 501 + a
 * pointer to the registry of supported flows. When the Group resource
 * lands (Phase E-3), this function should:
 *
 *   1. Look up `groups` by id, return 404 if missing.
 *   2. Verify the caller's qhin_partner_id (or admin user) has read access
 *      via either RLS policies on `groups` or a tefca_qhin_partners.allowed_groups
 *      array.
 *   3. Resolve the group's patient roster and pass it down to the processor
 *      as `member_ids` so paginatePatientScoped can `.in("patient_id", …)`.
 */
async function ensureGroupAccessible(
  supabase: SupabaseLike,
  groupId: string,
): Promise<Response | null> {
  const { error } = await supabase
    .from("groups")
    .select("id")
    .eq("id", groupId)
    .maybeSingle();

  // If the table doesn't exist (PGRST204 / 42P01) we're in pre-Group-schema
  // territory; reject the kickoff cleanly rather than 500ing.
  if (error) {
    return errorResponse(
      "error",
      "not-supported",
      "Group/$export is not yet supported — the FHIR Group resource has not been provisioned",
      501,
    );
  }
  return null;
}

async function handleKickoff(
  supabase: SupabaseLike,
  req: Request,
  type: ExportType,
  scopeId: string | null,
): Promise<Response> {
  const startTime = Date.now();
  const caller = await authorize(supabase, req);
  if (caller instanceof Response) return caller;

  if (req.method !== "POST") {
    return errorResponse(
      "error",
      "not-supported",
      "$export requires POST",
      405,
    );
  }

  if (type === "group") {
    if (!scopeId) {
      return errorResponse(
        "error",
        "invalid",
        "Group/$export requires a Group id in the URL",
        400,
      );
    }
    const groupCheck = await ensureGroupAccessible(supabase, scopeId);
    if (groupCheck) return groupCheck;
  }

  const prefer = req.headers.get("Prefer") || "";
  if (!prefer.includes("respond-async")) {
    return errorResponse(
      "error",
      "invalid",
      "Prefer: respond-async header is required for FHIR Bulk Data $export",
      400,
    );
  }

  const body = await readBody(req);
  const requestedTypes = parseAcceptedTypes(req, body);
  const since = parseSince(req, body);

  if (requestedTypes && requestedTypes.length > 0) {
    const denied = unauthorizedResources(caller.scopes, requestedTypes);
    if (denied.length > 0) {
      return new Response(
        JSON.stringify({
          resourceType: "OperationOutcome",
          issue: [
            {
              severity: "error",
              code: "forbidden",
              diagnostics: `Access token scope does not authorize: ${denied.join(", ")}`,
            },
          ],
        }),
        {
          status: 403,
          headers: {
            ...fhirJsonHeaders,
            "WWW-Authenticate": `Bearer realm="tefca-bulk", error="insufficient_scope", scope="${denied
              .map((t) => `system/${t}.read`)
              .join(" ")}"`,
          },
        },
      );
    }
  } else if (!caller.scopes.includes("system/*.read")) {
    // No _type filter requested: caller must have system/*.read.
    return errorResponse(
      "error",
      "forbidden",
      "system/*.read is required for unfiltered $export",
      403,
    );
  }

  const { data: insert, error } = await supabase
    .from("bulk_export_jobs")
    .insert({
      client_id: caller.clientId,
      type,
      scope_id: scopeId,
      since,
      resource_types: requestedTypes,
      status: "accepted",
    })
    .select("id, type")
    .maybeSingle();

  if (error || !insert) {
    return errorResponse(
      "error",
      "exception",
      `failed to create export job: ${error?.message ?? "unknown"}`,
      500,
    );
  }

  const jobId = (insert as { id: string }).id;

  // Audit the kickoff against tefca_access_logs so the operation appears in
  // the same retention store as IAS reads.
  await logTEFCAAccess(
    supabase,
    {
      qhinId: caller.qhinId,
      exchangePurpose: "treatment",
      requestingOrganization: caller.clientId,
      ipAddress: clientIp(req) ?? "unknown",
    },
    [`$export:${type}`],
    0,
    true,
    undefined,
    Date.now() - startTime,
    scopeId ?? undefined,
  );

  // Run the export after returning. EdgeRuntime.waitUntil is the Supabase-
  // provided primitive for "keep running after response sent". If the runtime
  // doesn't expose it we fall back to fire-and-forget which is best-effort.
  const work = processJob(supabase, jobId).catch((err) => {
    console.error(`processJob failed for ${jobId}:`, err);
  });
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
    EdgeRuntime.waitUntil(work);
  }

  return new Response(null, {
    status: 202,
    headers: {
      ...corsHeaders,
      "Content-Location": `${getBulkBaseUrl()}/bulk-status/${jobId}`,
    },
  });
}

async function handleStatus(
  supabase: SupabaseLike,
  jobId: string,
): Promise<Response> {
  const { data, error } = await supabase
    .from("bulk_export_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();
  if (error || !data) {
    return errorResponse("error", "not-found", `job ${jobId} not found`, 404);
  }
  const job = data as BulkExportJob;

  if (job.status === "accepted" || job.status === "in-progress") {
    return new Response(null, {
      status: 202,
      headers: {
        ...corsHeaders,
        "X-Progress":
          job.status === "in-progress"
            ? `running; ${job.total_resources} resources written`
            : "queued",
        "Retry-After": "5",
      },
    });
  }

  if (job.status === "cancelled") {
    return errorResponse("error", "deleted", "job cancelled", 410);
  }
  if (job.status === "failed") {
    return errorResponse(
      "error",
      "exception",
      job.error_message ?? "export failed",
      500,
    );
  }

  // Completed — sign every output URL fresh so consumers can fetch.
  const manifest = job.manifest;
  if (!manifest) {
    return errorResponse(
      "error",
      "exception",
      "completed job has no manifest",
      500,
    );
  }

  // Persist the original manifest URLs (which point at /bulk-files/) and
  // return as-is. /bulk-files redirects to the signed Storage URL on demand,
  // so signed URLs aren't baked into the manifest.
  return new Response(JSON.stringify(manifest), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function handleCancel(
  supabase: SupabaseLike,
  jobId: string,
): Promise<Response> {
  const { data: existing } = await supabase
    .from("bulk_export_jobs")
    .select("status")
    .eq("id", jobId)
    .maybeSingle();
  if (!existing) {
    return errorResponse("error", "not-found", `job ${jobId} not found`, 404);
  }

  await supabase
    .from("bulk_export_jobs")
    .update({
      status: "cancelled",
      completed_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  await deleteJobObjects(supabase, jobId);
  return new Response(null, { status: 202, headers: corsHeaders });
}

async function handleFile(
  supabase: SupabaseLike,
  req: Request,
  jobId: string,
  fileName: string,
): Promise<Response> {
  const caller = await authorize(supabase, req);
  if (caller instanceof Response) return caller;

  // Ensure the file actually belongs to a completed job for this caller.
  const { data: fileRow } = await supabase
    .from("bulk_export_files")
    .select("storage_path, resource_type, job_id")
    .eq("job_id", jobId)
    .ilike("storage_path", `${jobId}/${fileName}`)
    .maybeSingle();

  if (!fileRow) {
    return errorResponse(
      "error",
      "not-found",
      `${fileName} not found for job ${jobId}`,
      404,
    );
  }
  const row = fileRow as {
    storage_path: string;
    resource_type: string;
    job_id: string;
  };

  if (!scopeAllowsResource(caller.scopes, row.resource_type)) {
    return errorResponse(
      "error",
      "forbidden",
      `Access token scope does not authorize ${row.resource_type}`,
      403,
    );
  }

  // Two delivery modes:
  //   - default: stream the NDJSON through this function so per-file
  //     fetches stay auditable.
  //   - ?redirect=signed: 302 to a Supabase Storage signed URL so the
  //     client can pull bytes directly from Storage. Useful for very large
  //     transfers where keeping the edge function alive for the full
  //     download is wasteful or risks the 25s timeout.
  const url = new URL(req.url);
  const wantsRedirect = url.searchParams.get("redirect") === "signed";

  if (wantsRedirect) {
    let signed: string;
    try {
      signed = await signOutputUrl(supabase, row.storage_path);
    } catch (err) {
      return errorResponse(
        "error",
        "exception",
        err instanceof Error ? err.message : "failed to sign URL",
        500,
      );
    }
    return new Response(null, {
      status: 302,
      headers: { ...corsHeaders, Location: signed },
    });
  }

  const stream = await streamObject(supabase, row.storage_path);
  if (!stream) {
    return errorResponse(
      "error",
      "not-found",
      `${row.storage_path} no longer present in storage`,
      404,
    );
  }

  return new Response(stream.body, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": stream.contentType,
    },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const rl = await enforceRateLimit(req, {
    bucket: "edge_tefca_bulk",
    keyStrategy: "ip",
    max: 30,
    windowSeconds: 60,
  });
  if (!rl.allowed && rl.response) {
    return new Response(rl.response.body, {
      status: rl.response.status,
      headers: { ...corsHeaders, "Retry-After": String(rl.retryAfter ?? 60) },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const idx = pathParts.indexOf("tefca-bulk");
  const path = "/" + pathParts.slice(idx + 1).join("/");

  try {
    if (path === "/$export") {
      return await handleKickoff(supabase, req, "system", null);
    }
    if (path === "/Patient/$export") {
      return await handleKickoff(supabase, req, "patient", null);
    }
    const groupMatch = path.match(/^\/Group\/([^/]+)\/\$export$/);
    if (groupMatch) {
      return await handleKickoff(supabase, req, "group", groupMatch[1]);
    }

    const statusMatch = path.match(/^\/bulk-status\/([0-9a-f-]{36})$/i);
    if (statusMatch) {
      const jobId = statusMatch[1];
      if (req.method === "DELETE") {
        return await handleCancel(supabase, jobId);
      }
      return await handleStatus(supabase, jobId);
    }

    const fileMatch = path.match(/^\/bulk-files\/([0-9a-f-]{36})\/(.+)$/i);
    if (fileMatch) {
      return await handleFile(
        supabase,
        req,
        fileMatch[1],
        decodeURIComponent(fileMatch[2]),
      );
    }

    return errorResponse(
      "error",
      "not-found",
      `unknown bulk path ${path}`,
      404,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return errorResponse("fatal", "exception", message, 500);
  }
});
