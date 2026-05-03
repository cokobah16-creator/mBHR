// Bulk export job processor. Runs after the kickoff response (via
// EdgeRuntime.waitUntil) so the client can poll /bulk-status while we
// stream resources out of Postgres.
//
// Reuses the FHIR registry + mappers from tefca-ias via relative imports —
// Supabase bundles each function independently, but the CLI does follow
// transitive imports outside the function root. If deploy proves otherwise
// we'll move mappers + registry into supabase/functions/_shared/fhir/ and
// update imports here and in tefca-ias.

import { createClient } from "npm:@supabase/supabase-js@2";

import {
  mapDiagnosticReportToFHIR,
  mapPatientToFHIR,
  mapSDOHToFHIR,
  mapVitalsToFHIR,
} from "../_shared/fhir/mappers.ts";
import { RESOURCE_REGISTRY } from "../_shared/fhir/registry.ts";

import {
  type BulkExportJob,
  type BulkManifest,
  type BulkManifestOutput,
  getBulkBaseUrl,
} from "./shared.ts";
import { deleteJobObjects, uploadNdjson } from "./storage.ts";

type SupabaseLike = ReturnType<typeof createClient>;

const PAGE_SIZE = 500;

function ndjson(resources: unknown[]): string {
  return resources.map((r) => JSON.stringify(r)).join("\n");
}

async function paginatePatientScoped(
  supabase: SupabaseLike,
  table: string,
  orderColumn: string,
  patientId: string | null,
  since: string | null,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let from = 0;
  for (;;) {
    let query = supabase
      .from(table)
      .select("*")
      .order(orderColumn, { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (patientId) query = query.eq("patient_id", patientId);
    if (since) query = query.gte("updated_at", since);
    const { data, error } = await query;
    if (error) throw new Error(`paginating ${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...(data as Record<string, unknown>[]));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return out;
}

async function exportRegistryResource(
  supabase: SupabaseLike,
  jobId: string,
  resourceType: string,
  patientId: string | null,
  since: string | null,
): Promise<{ count: number; storagePath: string; sizeBytes: number } | null> {
  const cfg = RESOURCE_REGISTRY.find((r) => r.resourceType === resourceType);
  if (!cfg) return null;
  if (cfg.customHandler) {
    // Patient + Observation + DiagnosticReport handled separately.
    return null;
  }

  const rows = await paginatePatientScoped(
    supabase,
    cfg.table,
    cfg.orderColumn,
    patientId,
    since,
  );
  if (rows.length === 0) return null;

  const mapped: unknown[] = [];
  for (const row of rows) {
    const out = cfg.mapper(row, undefined);
    if (Array.isArray(out)) mapped.push(...out);
    else mapped.push(out);
  }

  const upload = await uploadNdjson(supabase, {
    jobId,
    resourceType,
    ndjson: ndjson(mapped),
    count: mapped.length,
  });
  return upload;
}

async function exportPatient(
  supabase: SupabaseLike,
  jobId: string,
  patientId: string | null,
): Promise<{ count: number; storagePath: string; sizeBytes: number } | null> {
  let query = supabase.from("patients").select("*");
  if (patientId) query = query.eq("id", patientId);
  const { data, error } = await query.range(0, 9999);
  if (error) throw new Error(`patients query: ${error.message}`);
  const rows = (data || []) as Record<string, unknown>[];
  if (rows.length === 0) return null;
  const mapped = rows.map((p) => mapPatientToFHIR(p));
  return await uploadNdjson(supabase, {
    jobId,
    resourceType: "Patient",
    ndjson: ndjson(mapped),
    count: mapped.length,
  });
}

async function exportObservation(
  supabase: SupabaseLike,
  jobId: string,
  patientId: string | null,
  since: string | null,
): Promise<{ count: number; storagePath: string; sizeBytes: number } | null> {
  const vitalsRows = await paginatePatientScoped(
    supabase,
    "vitals",
    "created_at",
    patientId,
    since,
  );
  const sdohRows = await paginatePatientScoped(
    supabase,
    "sdoh_observations",
    "effective_date",
    patientId,
    since,
  );

  const mapped: unknown[] = [];
  for (const v of vitalsRows) mapped.push(...mapVitalsToFHIR(v, undefined));
  for (const s of sdohRows) mapped.push(mapSDOHToFHIR(s, undefined));

  if (mapped.length === 0) return null;
  return await uploadNdjson(supabase, {
    jobId,
    resourceType: "Observation",
    ndjson: ndjson(mapped),
    count: mapped.length,
  });
}

async function exportDiagnosticReport(
  supabase: SupabaseLike,
  jobId: string,
  patientId: string | null,
  since: string | null,
): Promise<{ count: number; storagePath: string; sizeBytes: number } | null> {
  const orders = await paginatePatientScoped(
    supabase,
    "lab_orders",
    "ordered_at",
    patientId,
    since,
  );
  if (orders.length === 0) return null;

  const orderIds = orders.map((o) => o.id as string);
  const { data: results } = await supabase
    .from("lab_results")
    .select("*")
    .in("order_id", orderIds);

  const resultsByOrder: Record<string, Record<string, unknown>[]> = {};
  for (const r of results || []) {
    const oid = r.order_id as string;
    (resultsByOrder[oid] ||= []).push(r as Record<string, unknown>);
  }

  const mapped = orders.map((o) =>
    mapDiagnosticReportToFHIR(
      o,
      resultsByOrder[(o as { id: string }).id] || [],
      undefined,
    ),
  );

  return await uploadNdjson(supabase, {
    jobId,
    resourceType: "DiagnosticReport",
    ndjson: ndjson(mapped),
    count: mapped.length,
  });
}

/**
 * Resolve which resource types this job will emit. Honors the job's
 * resource_types filter when set, otherwise emits everything in the
 * registry plus the custom-handled trio (Patient/Observation/DiagnosticReport).
 */
function resolveTargetResources(job: BulkExportJob): string[] {
  if (job.resource_types && job.resource_types.length > 0) {
    return job.resource_types;
  }
  return RESOURCE_REGISTRY.map((r) => r.resourceType);
}

/**
 * Drive a single bulk export job to completion. Updates status -> in-progress
 * before emitting any files; stamps -> completed (or failed) on exit. Idempotent
 * against re-entry: on rerun, existing storage objects are overwritten thanks
 * to upsert: true in storage.uploadNdjson.
 */
export async function processJob(
  supabase: SupabaseLike,
  jobId: string,
): Promise<void> {
  const { data: jobRow, error: jobErr } = await supabase
    .from("bulk_export_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();
  if (jobErr || !jobRow) {
    console.error("processJob: job not found", jobId, jobErr?.message);
    return;
  }
  const job = jobRow as BulkExportJob;

  if (job.status === "cancelled" || job.status === "completed") return;

  await supabase
    .from("bulk_export_jobs")
    .update({
      status: "in-progress",
      started_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  const patientId = job.type === "patient" ? job.scope_id : null;
  const since = job.since;
  const targets = resolveTargetResources(job);
  const outputs: BulkManifestOutput[] = [];
  const errors: BulkManifestOutput[] = [];
  let total = 0;

  try {
    for (const resourceType of targets) {
      // Honor cancellation between resource emits.
      const { data: stillRow } = await supabase
        .from("bulk_export_jobs")
        .select("status")
        .eq("id", jobId)
        .maybeSingle();
      if ((stillRow as { status?: string } | null)?.status === "cancelled") {
        await deleteJobObjects(supabase, jobId);
        return;
      }

      try {
        let result: Awaited<ReturnType<typeof exportRegistryResource>> = null;
        if (resourceType === "Patient") {
          result = await exportPatient(supabase, jobId, patientId);
        } else if (resourceType === "Observation") {
          result = await exportObservation(supabase, jobId, patientId, since);
        } else if (resourceType === "DiagnosticReport") {
          result = await exportDiagnosticReport(
            supabase,
            jobId,
            patientId,
            since,
          );
        } else {
          result = await exportRegistryResource(
            supabase,
            jobId,
            resourceType,
            patientId,
            since,
          );
        }

        if (result) {
          await supabase.from("bulk_export_files").insert({
            job_id: jobId,
            resource_type: resourceType,
            storage_path: result.storagePath,
            size_bytes: result.sizeBytes,
            count: result.count,
          });
          outputs.push({
            type: resourceType,
            url: `${getBulkBaseUrl()}/bulk-files/${jobId}/${encodeURIComponent(
              `${resourceType}.ndjson`,
            )}`,
            count: result.count,
          });
          total += result.count;
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "unknown export error";
        console.error(
          `processJob: failed resource ${resourceType} for ${jobId}: ${message}`,
        );
        errors.push({
          type: "OperationOutcome",
          url: "about:blank",
          count: 0,
        });
        // Continue to next resource — partial exports are valid.
      }
    }

    const manifest: BulkManifest = {
      transactionTime: job.created_at,
      request: `${getBulkBaseUrl()}/${
        job.type === "system"
          ? "$export"
          : job.type === "patient"
            ? "Patient/$export"
            : `Group/${job.scope_id}/$export`
      }`,
      requiresAccessToken: true,
      output: outputs,
      error: errors,
    };

    await supabase
      .from("bulk_export_jobs")
      .update({
        status: "completed",
        manifest,
        total_resources: total,
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "unknown processor error";
    console.error(`processJob: terminal failure ${jobId}: ${message}`);
    await supabase
      .from("bulk_export_jobs")
      .update({
        status: "failed",
        error_message: message,
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId);
  }
}
