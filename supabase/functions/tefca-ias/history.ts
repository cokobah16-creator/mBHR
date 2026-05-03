// FHIR _history-instance / vread support backed by the resource_versions
// snapshot table (see migrations/20260503020000_add_resource_versions.sql).
//
// Only resources flagged with `interactions: ["history-instance", "vread"]`
// in the registry have snapshots; other resource types fall through to a
// not-supported response.

import { createClient } from "npm:@supabase/supabase-js@2";

import type { ResourceConfig } from "../_shared/fhir/registry.ts";
import type { FhirRow } from "../_shared/fhir/mappers.ts";

type SupabaseLike = ReturnType<typeof createClient>;

export function resourceSupportsHistory(config: ResourceConfig): boolean {
  return config.interactions.includes("history-instance");
}

export function resourceSupportsVread(config: ResourceConfig): boolean {
  return config.interactions.includes("vread");
}

/**
 * Build a FHIR `history` Bundle for one resource instance. Each entry is the
 * snapshot mapped through the resource's mapper, with `meta.versionId` and
 * `meta.lastUpdated` set from the resource_versions row.
 */
export async function loadResourceHistory(
  supabase: SupabaseLike,
  config: ResourceConfig,
  logicalId: string,
  baseUrl: string,
): Promise<{ bundle: unknown; entryCount: number } | null> {
  const { data, error } = await supabase
    .from("resource_versions")
    .select("version_id, valid_from, snapshot, operation")
    .eq("resource_type", config.resourceType)
    .eq("logical_id", logicalId)
    .order("version_id", { ascending: false });

  if (error) return null;
  const rows = (data || []) as Array<{
    version_id: number;
    valid_from: string;
    snapshot: FhirRow;
    operation: string;
  }>;

  if (rows.length === 0) return { bundle: null, entryCount: 0 };

  const entries = rows.map((r) => {
    const mapped = config.mapper(r.snapshot, undefined);
    const resource = (Array.isArray(mapped) ? mapped[0] : mapped) as Record<
      string,
      unknown
    > | null;
    if (!resource) return null;
    const meta = (resource.meta as Record<string, unknown>) || {};
    resource.meta = {
      ...meta,
      versionId: String(r.version_id),
      lastUpdated: r.valid_from,
    };
    return {
      fullUrl: `${baseUrl}/${config.resourceType}/${logicalId}/_history/${r.version_id}`,
      resource,
      request: {
        method: r.operation === "DELETE" ? "DELETE" : r.operation,
        url: `${config.resourceType}/${logicalId}`,
      },
    };
  });

  return {
    bundle: {
      resourceType: "Bundle",
      type: "history",
      total: rows.length,
      entry: entries.filter(Boolean),
    },
    entryCount: rows.length,
  };
}

/**
 * vread: load a single snapshot by version. Returns the mapped resource or
 * null if the version does not exist.
 */
export async function loadResourceVersion(
  supabase: SupabaseLike,
  config: ResourceConfig,
  logicalId: string,
  versionId: string,
): Promise<unknown | null> {
  const versionInt = Number.parseInt(versionId, 10);
  if (!Number.isFinite(versionInt)) return null;

  const { data, error } = await supabase
    .from("resource_versions")
    .select("version_id, valid_from, snapshot")
    .eq("resource_type", config.resourceType)
    .eq("logical_id", logicalId)
    .eq("version_id", versionInt)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as {
    version_id: number;
    valid_from: string;
    snapshot: FhirRow;
  };

  const mapped = config.mapper(row.snapshot, undefined);
  const resource = (Array.isArray(mapped) ? mapped[0] : mapped) as Record<
    string,
    unknown
  > | null;
  if (!resource) return null;

  const meta = (resource.meta as Record<string, unknown>) || {};
  resource.meta = {
    ...meta,
    versionId: String(row.version_id),
    lastUpdated: row.valid_from,
  };
  return resource;
}
