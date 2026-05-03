// Read-merger: pulls FHIR resources from the Phase H fhir_resources
// passthrough store and merges them into the Bundles produced by the
// canonical-table read handlers.
//
// Background. Phase H landed validator-gated POST/PUT/DELETE that writes
// to a single `fhir_resources` table (resource_type, logical_id,
// version_id, payload jsonb, patient_id, status, …). Without a merger the
// existing read endpoints (handleGenericPatientScoped, handlePatientRead,
// handleObservationSearch, handleDiagnosticReportSearch, etc.) only see
// data in the canonical clinical tables — writes were invisible.
//
// What this module does
//
//   loadFhirResourcesByPatient — given (resource_type, patient_id) returns
//     every active payload as parsed FHIR resources. Used by all
//     patient-scoped search handlers.
//
//   loadFhirResourceById — given (resource_type, logical_id) returns a
//     single payload or null. Used by Patient read (when the fhir_id is
//     a passthrough id rather than a patients.id).
//
// Behavior is conservative: we only return rows with status='active'
// (soft-deletes are excluded), and we never re-validate at read time —
// the validator gate ran at write time, so the payloads in the store are
// already known-good per the US Core 7.0 rules.

import { createClient } from "npm:@supabase/supabase-js@2";

type SupabaseLike = ReturnType<typeof createClient>;

export interface FhirResourceRow {
  resource_type: string;
  logical_id: string;
  version_id: number;
  payload: Record<string, unknown>;
  patient_id: string | null;
  status: string;
  updated_at: string;
}

/**
 * Load every active fhir_resources row for a given (resource_type,
 * patient_id) pair, ordered by updated_at desc. Returns the parsed FHIR
 * payloads (strip the row metadata). Designed to be unioned with whatever
 * the canonical-table query produced.
 */
export async function loadFhirResourcesByPatient(
  supabase: SupabaseLike,
  resourceType: string,
  patientId: string,
): Promise<unknown[]> {
  const { data, error } = await supabase
    .from("fhir_resources")
    .select("payload, version_id, updated_at")
    .eq("resource_type", resourceType)
    .eq("patient_id", patientId)
    .eq("status", "active")
    .order("updated_at", { ascending: false });

  if (error) return [];
  const rows = (data || []) as Array<{
    payload: Record<string, unknown>;
    version_id: number;
    updated_at: string;
  }>;
  return rows.map((r) =>
    decoratePayload(r.payload, r.version_id, r.updated_at),
  );
}

/**
 * Load a single fhir_resources row by logical id. Returns the parsed
 * payload or null. Falls back across status values so soft-deleted rows
 * still answer 410-style logic in the future; today the dispatcher only
 * calls this when the canonical-table lookup misses.
 */
export async function loadFhirResourceById(
  supabase: SupabaseLike,
  resourceType: string,
  logicalId: string,
): Promise<unknown | null> {
  const { data, error } = await supabase
    .from("fhir_resources")
    .select("payload, version_id, updated_at, status")
    .eq("resource_type", resourceType)
    .eq("logical_id", logicalId)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as {
    payload: Record<string, unknown>;
    version_id: number;
    updated_at: string;
    status: string;
  };
  if (row.status !== "active") return null;
  return decoratePayload(row.payload, row.version_id, row.updated_at);
}

/**
 * Patient/$everything aggregation across the fhir_resources store. Returns
 * every active payload for the given patient_id regardless of resource type.
 * The caller appends the result to the canonical-table fan-out.
 */
export async function loadFhirResourcesEverything(
  supabase: SupabaseLike,
  patientId: string,
): Promise<unknown[]> {
  const { data, error } = await supabase
    .from("fhir_resources")
    .select("payload, version_id, updated_at")
    .eq("patient_id", patientId)
    .eq("status", "active")
    .order("updated_at", { ascending: false });

  if (error) return [];
  const rows = (data || []) as Array<{
    payload: Record<string, unknown>;
    version_id: number;
    updated_at: string;
  }>;
  return rows.map((r) =>
    decoratePayload(r.payload, r.version_id, r.updated_at),
  );
}

/** Re-stamp meta.versionId / meta.lastUpdated from the row so the served
 * payload always reflects the latest persisted state, even if the writer
 * forgot to bump those fields. */
function decoratePayload(
  payload: Record<string, unknown>,
  versionId: number,
  lastUpdated: string,
): Record<string, unknown> {
  const meta = (payload.meta as Record<string, unknown> | undefined) ?? {};
  return {
    ...payload,
    meta: {
      ...meta,
      versionId: String(versionId),
      lastUpdated,
    },
  };
}
