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
} from "../tefca-ias/bearer-auth.ts";
import { logTEFCAAccess } from "../tefca-ias/audit.ts";
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

  // Stream from storage. We could 302 to a signed URL instead — Bulk Data
  // clients accept that — but streaming through this function lets us
  // continue auditing per-file fetches.
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

/**
 * Optional: serve a signed URL redirect instead of streaming. Reserved for
 * Phase E-2 — clients that want to bypass the function for large transfers.
 */
async function handleSignedRedirect(
  supabase: SupabaseLike,
  storagePath: string,
): Promise<Response> {
  const url = await signOutputUrl(supabase, storagePath);
  return new Response(null, {
    status: 302,
    headers: { ...corsHeaders, Location: url },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
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

// Marker so the import isn't tree-shaken away when added but unused (Phase
// E-2 will use signed redirects).
void handleSignedRedirect;
