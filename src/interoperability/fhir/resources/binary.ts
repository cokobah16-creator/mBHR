// Binary <- the stored file of a public.patient_documents row (see
// mappers/document.ts). Binary/[id] uses the same id as the
// DocumentReference that describes the file.
//
// Each download is decided on its own, never on the strength of an earlier
// DocumentReference read:
//
//   1. The gateway has authorised the caller for Binary: a portal patient
//      only, for their own records (restriction patient_uploads_only).
//      Staff are refused at the permission step (owner decision: no
//      documents over FHIR until mBHR has a staff documents screen), and
//      assertPatient() refuses them here too.
//   2. The document row is read AS THE CALLER, under row-level security,
//      with the same limits as a DocumentReference read: not removed
//      (deleted_at IS NULL), the patient's own records, and only documents
//      they uploaded (clinic documents have no release step yet, so their
//      files are not handed to patients).
//   3. The row's patient must resolve to a kept record, as for the
//      DocumentReference (otherwise the document is not published at all).
//   4. The stored object path must be a plain relative path (no "..", no
//      leading "/", no URL, nothing outside a small character set) whose
//      first folder is that patient's record, or a record merged into it:
//      a row can never point the gateway at another patient's folder.
//   5. The file is downloaded from Storage with the caller's own session,
//      so the bucket's policies apply a second time. A missing object, a
//      Storage refusal or a bad path answers 404, never an empty file.
//
// The gateway audits the read before it streams the file, with
// Content-Disposition: attachment, X-Content-Type-Options: nosniff, a
// sandbox Content-Security-Policy and Cache-Control: private, no-store.
// No signed URL, public URL, bucket name or object path is ever returned.

import { errors } from "../errors/operationOutcome";
import { READ_PERMISSIONS } from "../authorization/permissions";
import { safeObjectPath } from "../gateway/storage";
import { resolvePatients } from "../patients/canonical";
import type { Row } from "../mappers/common";
import {
  BINARY_COLUMNS,
  CONTENT_TYPE_EXTENSIONS,
  DOCUMENT_BUCKET,
  OCTET_STREAM,
  downloadFilename,
  mapBinary,
} from "../mappers/document";
import type { AddIssue } from "../validation/validate";
import { emptyResult, type QueryCtx, type QueryResult, type ResourceDefinition, type ResourceModule } from "./module";
import { UUID, scopeFilter, type Filters } from "./shared";

export const definition: ResourceDefinition = {
  type: "Binary",
  source: "the stored file of a public.patient_documents row (Storage bucket read as the caller; never a URL)",
  idStrategy: "patient_documents.id (uuid): the same id as the DocumentReference that describes the file",
  fields: [
    "the file itself, streamed as an attachment download",
    "contentType (the declared type when it is PDF, JPEG, PNG, WebP, HEIC/HEIF or Word; otherwise application/octet-stream)",
    "securityContext (the DocumentReference)",
  ],
  profiles: [],
  interactions: ["read"],
  searchParams: [],
  requiredSearch: [["_id"]],
  writeSupport: false,
  consentClass: "document",
  readPermissions: READ_PERMISSIONS.Binary,
  patientAccess: true,
  sensitiveSearch: true,
  notes: [
    "Binary/[id] is read by id only and answers with the file itself (Content-Disposition: attachment), never as FHIR JSON.",
    "Each download is authorised on its own.",
    "Staff accounts cannot download files here (403), whatever their role: mBHR has no staff documents screen yet.",
    "A removed document, a file that is missing from storage, or a stored path outside the patient's folder answers 404.",
    "The file type is the uploader's declaration; files are not scanned for malware in this release.",
    "A download carries no ETag and no version, so a conditional read (If-None-Match) is not supported.",
  ],
  patientAccessNotes: ["A patient gets only files they uploaded to their own record; no other account gets files here."],
};

/** Same rule as the DocumentReference attachment url: may this patient download this document's file? */
export function patientMayDownload(row: Row): boolean {
  return row.upload_source === "patient";
}

/**
 * Portal patients only. The gateway refuses staff first (READ_PERMISSIONS
 * for DocumentReference and Binary is empty); this keeps the modules from
 * answering them, with the same audit reason as that refusal.
 */
export function assertPatient(ctx: QueryCtx): void {
  if (ctx.scope.kind !== "patient") throw errors.forbidden(undefined, { auditReason: "missing_permission" });
}

/** A patient downloads only what they uploaded (restriction patient_uploads_only). */
const PATIENT_UPLOADS: Filters = [["upload_source", "eq.patient"]];

const BUCKET_PREFIX = `${DOCUMENT_BUCKET}/`;

/**
 * The Storage object name of a document's file, or null when the stored
 * path cannot be served: not a plain relative path (see safeObjectPath),
 * not inside a folder, or in a folder that is not one of `patientFolders`
 * (the row's patient record and the records merged into it). Rows written
 * outside the portal may carry the bucket name as a prefix; it is dropped.
 */
export function documentObjectPath(raw: unknown, patientFolders: readonly string[]): string | null {
  if (typeof raw !== "string" || raw === "") return null;
  const name = raw.startsWith(BUCKET_PREFIX) ? raw.slice(BUCKET_PREFIX.length) : raw;
  const clean = safeObjectPath(name);
  if (!clean) return null;
  const segments = clean.split("/");
  if (segments.length < 2) return null;
  return patientFolders.includes(segments[0]) ? clean : null;
}

async function read(ctx: QueryCtx, id: string): Promise<QueryResult> {
  assertPatient(ctx);
  if (!UUID.test(id)) return emptyResult();
  const rows = await ctx.db.select(
    "patient_documents",
    BINARY_COLUMNS,
    [["id", `eq.${id}`], ["deleted_at", "is.null"], ...scopeFilter(ctx), ...PATIENT_UPLOADS],
    { limit: 1 },
  );
  const row = rows[0];
  if (!row) return emptyResult();
  if (!patientMayDownload(row)) return emptyResult();
  const owner = typeof row.patient_id === "string" ? row.patient_id : null;
  if (!owner) return emptyResult();

  // The patient's kept record (for the reference check) and the records
  // merged into it (a merge moves the row, not the file, so the file may
  // still be in a merged-away record's folder).
  const [resolved] = await resolvePatients(ctx.db, { ids: [owner] });
  if (!resolved || !resolved.chainOk || !resolved.canonicalFhirId) return emptyResult();
  const binary = mapBinary(row, { patientFhirIds: new Map([[owner, resolved.canonicalFhirId]]) });
  if (!binary) return emptyResult();
  const path = documentObjectPath(row.file_path, [...new Set([owner, ...resolved.memberIds])]);
  if (!path) return emptyResult();

  if (!ctx.storage) throw errors.unavailable();
  const file = await ctx.storage.download(DOCUMENT_BUCKET, path);
  // Missing, refused by Storage, or empty: not found (never an empty 200).
  if (!file || file.size === 0) return emptyResult();
  return {
    page: { resources: [binary], next: null },
    owners: [owner],
    binary: {
      body: file.body,
      contentType: binary.contentType,
      size: file.size,
      filename: downloadFilename(row.document_name, binary.contentType),
    },
  };
}

/** Binary rules: a served type, no embedded data, and the DocumentReference it belongs to. */
function validate(resource: Record<string, unknown>, add: AddIssue): void {
  const type = resource.contentType;
  if (typeof type !== "string" || (type !== OCTET_STREAM && !CONTENT_TYPE_EXTENSIONS.has(type))) {
    add("contentType", "required, and must be an allowlisted type or application/octet-stream");
  }
  // The file is streamed by the gateway; it is never embedded in JSON.
  if (resource.data !== undefined) add("data", "must not be present");
  const ctx = resource.securityContext;
  if (ctx !== undefined) {
    const ref = typeof ctx === "object" && ctx !== null ? (ctx as { reference?: unknown }).reference : undefined;
    if (ref !== `DocumentReference/${String(resource.id)}`) add("securityContext", "must be the document's own DocumentReference");
  }
}

export const binaryModule: ResourceModule = { definition, read, validate };
