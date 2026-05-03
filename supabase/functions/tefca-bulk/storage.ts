// Supabase Storage helpers for the fhir-bulk bucket.
//
// The bucket is private. Service-role uploads NDJSON; consumers receive
// signed URLs from the manifest in /bulk-status, valid for the job's
// remaining TTL.

import { createClient } from "npm:@supabase/supabase-js@2";

import { FHIR_BULK_BUCKET, SIGNED_URL_TTL_SECONDS } from "./shared.ts";

type SupabaseLike = ReturnType<typeof createClient>;

export interface UploadedNdjson {
  storagePath: string;
  sizeBytes: number;
  count: number;
}

/**
 * Upload an NDJSON blob (one resource per line) for a single (jobId, resourceType)
 * pair. Returns the storage path so it can be persisted in bulk_export_files
 * and referenced from the manifest.
 *
 * Path layout: <jobId>/<ResourceType>.ndjson
 */
export async function uploadNdjson(
  supabase: SupabaseLike,
  args: {
    jobId: string;
    resourceType: string;
    ndjson: string;
    count: number;
  },
): Promise<UploadedNdjson> {
  const storagePath = `${args.jobId}/${args.resourceType}.ndjson`;
  const sizeBytes = new TextEncoder().encode(args.ndjson).byteLength;

  const { error } = await supabase.storage
    .from(FHIR_BULK_BUCKET)
    .upload(storagePath, args.ndjson, {
      contentType: "application/fhir+ndjson",
      upsert: true,
    });

  if (error) {
    throw new Error(`failed to upload ${storagePath}: ${error.message}`);
  }

  return { storagePath, sizeBytes, count: args.count };
}

/**
 * Mint a signed URL for an output file. We sign per-request rather than
 * caching the signed URL on the manifest because Bulk Data clients fetch
 * each file at most once and the spec lets the server require access tokens.
 */
export async function signOutputUrl(
  supabase: SupabaseLike,
  storagePath: string,
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(FHIR_BULK_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);

  if (error || !data?.signedUrl) {
    throw new Error(
      `failed to sign URL for ${storagePath}: ${
        error?.message ?? "no signedUrl returned"
      }`,
    );
  }
  return data.signedUrl;
}

/**
 * Stream the bytes of a stored NDJSON object back to the client. Returns null
 * when the object does not exist.
 */
export async function streamObject(
  supabase: SupabaseLike,
  storagePath: string,
): Promise<{ body: ReadableStream<Uint8Array>; contentType: string } | null> {
  const { data, error } = await supabase.storage
    .from(FHIR_BULK_BUCKET)
    .download(storagePath);
  if (error || !data) return null;
  return {
    body: data.stream(),
    contentType: "application/fhir+ndjson",
  };
}

/**
 * Delete every object for a job — invoked when the client cancels or when the
 * cleanup job runs after expires_at.
 */
export async function deleteJobObjects(
  supabase: SupabaseLike,
  jobId: string,
): Promise<void> {
  const { data: list } = await supabase.storage
    .from(FHIR_BULK_BUCKET)
    .list(jobId);
  if (!list || list.length === 0) return;
  await supabase.storage
    .from(FHIR_BULK_BUCKET)
    .remove(list.map((f) => `${jobId}/${f.name}`));
}
