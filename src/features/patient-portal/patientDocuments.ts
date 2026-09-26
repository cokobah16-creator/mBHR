/**
 * Patient portal documents: the pure rules behind DocumentUpload.tsx.
 *
 * Server rules (supabase/migrations/20260925100700_patient_document_ownership.sql):
 *   - The server decides who uploaded a document (upload_source "patient"
 *     or "staff", and uploaded_by_user_id). The app never sends them.
 *   - A patient removes a document with the RPC portal_remove_document. It
 *     is a soft delete: the row and the file are kept, the patient no longer
 *     sees them, clinic staff still do.
 *   - Only the patient's own uploads can be removed. Clinic records
 *     (upload_source "staff", which includes every document added before
 *     that migration) cannot be removed from the portal.
 *
 * Older databases name some columns differently (file_name, storage_path,
 * file_type, upload_date), so rows are read by either name.
 */

export type DocumentSource = "patient" | "staff";

export interface PortalDocument {
  id: string;
  name: string;
  documentType: string;
  /** Bytes, or null when the server did not record it. */
  fileSize: number | null;
  /** ISO timestamp of the upload, or null. */
  createdAt: string | null;
  description: string | null;
  /**
   * Who added it. A row without a recognised upload_source (a database the
   * ownership migration has not reached) counts as a clinic record, so the
   * portal never offers to remove it.
   */
  source: DocumentSource;
  removed: boolean;
  /** Path inside the patient-documents bucket, or null when not recorded. */
  filePath: string | null;
}

const BUCKET_PREFIX = "patient-documents/";

/**
 * The stored file's path inside the bucket. Some rows keep the bucket name
 * in front ("patient-documents/<patient id>/..."); storage wants it without.
 */
export function documentFilePath(value: unknown): string | null {
  const path = textOrNull(value);
  if (!path) return null;
  return path.startsWith(BUCKET_PREFIX) ? path.slice(BUCKET_PREFIX.length) : path;
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** One patient_documents row from the API, or null if it has no id. */
export function toPortalDocument(row: unknown): PortalDocument | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const r = row as Record<string, unknown>;
  const id = textOrNull(r.id);
  if (!id) return null;
  return {
    id,
    name: textOrNull(r.document_name) ?? textOrNull(r.file_name) ?? "Document",
    documentType: textOrNull(r.document_type) ?? "other",
    fileSize: numberOrNull(r.file_size),
    createdAt: textOrNull(r.created_at) ?? textOrNull(r.upload_date),
    description: textOrNull(r.description),
    source: r.upload_source === "patient" ? "patient" : "staff",
    removed: r.deleted_at !== undefined && r.deleted_at !== null,
    filePath: documentFilePath(r.file_path) ?? documentFilePath(r.storage_path),
  };
}

function timeOf(doc: PortalDocument): number {
  const t = doc.createdAt ? Date.parse(doc.createdAt) : NaN;
  return Number.isNaN(t) ? 0 : t;
}

/**
 * The documents to list for the patient: readable rows that are not
 * removed, newest first. The server already hides removed rows from
 * patients; this also covers an older database that does not.
 */
export function visiblePortalDocuments(rows: unknown): PortalDocument[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map(toPortalDocument)
    .filter((doc): doc is PortalDocument => doc !== null && !doc.removed)
    .sort((a, b) => timeOf(b) - timeOf(a));
}

/** The patient may remove only their own uploads. */
export function canPatientRemove(doc: PortalDocument): boolean {
  return doc.source === "patient" && !doc.removed;
}

/** Short text label for who added a document (never colour alone). */
export function documentSourceLabel(source: DocumentSource): string {
  return source === "patient" ? "Uploaded by you" : "Clinic record";
}

/**
 * Storage path for a new upload: "<patient id>/<time>.<extension>". The
 * first folder must be the patient id (storage rules). An extension that is
 * not short letters and digits is left off.
 */
export function documentStoragePath(
  patientId: string,
  fileName: string,
  nowMs: number,
): string {
  const dot = fileName.lastIndexOf(".");
  const ext = dot > 0 ? fileName.slice(dot + 1).toLowerCase() : "";
  const safeExt = /^[a-z0-9]{1,10}$/.test(ext) ? `.${ext}` : "";
  return `${patientId}/${nowMs}${safeExt}`;
}

export interface NewDocumentInput {
  patientId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  documentType: string;
  description: string;
  storagePath: string;
}

/**
 * The row the portal inserts. Ownership (upload_source,
 * uploaded_by_user_id) and removal columns are set by the server and are
 * deliberately not sent.
 */
export function buildDocumentInsert(input: NewDocumentInput): Record<string, unknown> {
  const description = input.description.trim();
  return {
    patient_id: input.patientId,
    document_type: input.documentType,
    document_name: input.fileName,
    file_path: input.storagePath,
    file_size: input.fileSize,
    mime_type: input.fileType,
    description: description === "" ? null : description,
  };
}

export type RemoveOutcome =
  | "removed"
  | "already_removed"
  | "clinic_document"
  | "not_found"
  | "unexpected";

/** Reads the answer of portal_remove_document. */
export function readRemoveResult(data: unknown): RemoveOutcome {
  if (!data || typeof data !== "object" || Array.isArray(data)) return "unexpected";
  const d = data as Record<string, unknown>;
  if (d.outcome === "applied") {
    return d.already_removed === true ? "already_removed" : "removed";
  }
  if (d.outcome === "rejected") {
    if (d.reason === "clinic_document") return "clinic_document";
    if (d.reason === "not_found") return "not_found";
  }
  return "unexpected";
}

const CONNECTION_ERROR_NAMES = new Set([
  "TypeError",
  "FetchError",
  "AbortError",
  "StorageUnknownError",
  "AuthRetryableFetchError",
]);

// supabase-js reports a failed fetch as "<error name>: <message>" with an
// empty code.
const CONNECTION_MESSAGE =
  /^(TypeError|FetchError|AbortError)\b|failed to fetch|network ?error|network request failed|load failed|fetch failed|timed? ?out/i;

/**
 * True when a failed request may never have reached the server, or its
 * answer was lost: the device is offline, or the error is a fetch or network
 * failure rather than an answer from the server. The message is only
 * matched here, never logged.
 */
export function isConnectionFailure(err: unknown, online: boolean): boolean {
  if (!online) return true;
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: unknown; message?: unknown; code?: unknown };
  if (typeof e.name === "string" && CONNECTION_ERROR_NAMES.has(e.name)) return true;
  const hasCode = typeof e.code === "string" ? e.code.trim() !== "" : e.code !== undefined && e.code !== null;
  return !hasCode && typeof e.message === "string" && CONNECTION_MESSAGE.test(e.message);
}
