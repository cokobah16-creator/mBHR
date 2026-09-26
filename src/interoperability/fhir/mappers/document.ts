// public.patient_documents -> DocumentReference, and the Binary that carries
// the document's file.
//
// A patient_documents row is one file in a patient's record: either a file
// the patient (or a caregiver) uploaded through the portal, or a clinic
// record added by staff (upload_source). The file itself lives in the
// private Storage bucket "patient-documents"; the row holds its object path
// (file_path). What is published:
//
//   DocumentReference  the metadata: status (current; a removed document is
//                      never published), type (the document type the
//                      uploader chose, as a local code), category (who added
//                      it), subject, date (upload time), description (patient
//                      uploads only) and one attachment whose url is this
//                      server's Binary/[id]
//   Binary             the file itself, which the gateway fetches from
//                      Storage as the caller and streams back
//
// Never published: file_path, the bucket, or any Storage URL or signed URL
// (a client only ever sees Binary/[id]); uploaded_by_user_id and deleted_by
// (account ids); the legacy uploaded_by_patient flag (never set reliably);
// metadata (unspecified); the description of a clinic record (a staff
// member's free-text note); the internal patient id.
//
// Left out because mBHR does not record them:
//   author          who wrote the document. mBHR records only who uploaded
//                   it: a portal upload may come from a caregiver's account,
//                   and a clinic upload may be a letter someone else wrote.
//                   An upload is an event (Provenance), not authorship.
//   docStatus       preliminary or final (see terminology/status/document.ts)
//   attachment.creation  when the document itself was written; created_at
//                   is the upload time, published as DocumentReference.date
//   attachment.hash not stored
//   context         no visit is recorded for a document
//   custodian, securityLabel  nothing recorded
//
// Every value the uploader controls (the file name, the declared file type,
// the size, the description) is published as recorded, never interpreted:
// a "Test result" document is a label on a file, not a laboratory result.

import type { CodeableConcept, Meta, Reference, Resource } from "../types/fhir";
import { MBHR_CODES } from "../terminology/codeSystems";
import { applyStatusMap } from "../terminology/statusMaps";
import {
  DOCUMENT_REFERENCE_STATUS,
  DOCUMENT_ROW_LIVE,
  DOCUMENT_ROW_REMOVED,
  type DocumentCompositionStatus,
  type DocumentReferenceStatus,
} from "../terminology/status/document";
import { MBHR_SOURCE, instant, num, patientReference, str, type MapContext, type Row } from "./common";

/** Local code system: the document type the uploader chose (patient_documents.document_type). */
export const DOCUMENT_TYPE_SYSTEM = `${MBHR_CODES}/document-type`;
/** Local code system: who added the document (patient_documents.upload_source). */
export const DOCUMENT_SOURCE_SYSTEM = `${MBHR_CODES}/document-source`;
/** The R4 code system of DocumentReference.status. */
export const DOCUMENT_REFERENCE_STATUS_SYSTEM = "http://hl7.org/fhir/document-reference-status";

/** The private Storage bucket that holds document files (never published). */
export const DOCUMENT_BUCKET = "patient-documents";

/**
 * Columns a DocumentReference is built from. Deliberately absent:
 *   file_path            the object path: only the Binary read needs it
 *   uploaded_by_user_id, deleted_by   account ids
 *   updated_at           missing on databases created with the older
 *                        20251030000000 table layout (selecting a missing
 *                        column fails every request), so meta.lastUpdated
 *                        is not published; see the report
 */
export const DOCUMENT_COLUMNS = [
  "id",
  "patient_id",
  "document_type",
  "document_name",
  "file_size",
  "mime_type",
  "description",
  "upload_source",
  "created_at",
  "deleted_at",
] as const;

/** Columns the Binary read needs: the row's owner, its state, and where its file is. */
export const BINARY_COLUMNS = ["id", "patient_id", "document_name", "file_path", "mime_type", "upload_source", "deleted_at"] as const;

/**
 * The six document types the portal offers (DocumentUpload.tsx), with the
 * label the portal shows. The code is the stored value, matched exactly
 * (the search filter matches the same way). Any other stored value is
 * published as text only, never as a code and never as "other".
 */
export const DOCUMENT_TYPES: ReadonlyMap<string, string> = new Map([
  ["medical_record", "Medical record"],
  ["lab_result", "Test result"],
  ["imaging", "Scan or X-ray"],
  ["prescription", "Prescription"],
  ["insurance", "Insurance document"],
  ["other", "Other"],
]);

/**
 * upload_source values. "staff" also covers every document that existed
 * before mBHR recorded who uploaded documents (migration 20260925100700
 * marked them all as clinic records, including earlier portal uploads), so
 * its display does not claim that staff provided the file.
 */
export const DOCUMENT_SOURCES: ReadonlyMap<string, string> = new Map([
  ["patient", "Uploaded through the patient portal"],
  ["staff", "Clinic record (or added before mBHR recorded who uploaded documents)"],
]);

/** Used when the declared file type is missing or not on the allowlist. */
export const OCTET_STREAM = "application/octet-stream";

/**
 * File types the gateway will label a download with, and the file
 * extension the download is given. Anything else (text/html, image/svg+xml,
 * scripts, archives, a blank or malformed type) is served as
 * application/octet-stream with a .bin name, so a browser never renders or
 * runs it. The declared type is the uploader's browser's claim and is not
 * checked against the file.
 */
export const CONTENT_TYPE_EXTENSIONS: ReadonlyMap<string, string> = new Map([
  ["application/pdf", "pdf"],
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/heic", "heic"],
  ["image/heif", "heif"],
  ["application/msword", "doc"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
]);

export interface Attachment {
  contentType?: string;
  url?: string;
  size?: number;
  title?: string;
}

export interface DocumentReference extends Resource {
  resourceType: "DocumentReference";
  status: DocumentReferenceStatus;
  docStatus?: DocumentCompositionStatus;
  type?: CodeableConcept;
  category?: CodeableConcept[];
  subject?: Reference;
  date?: string;
  description?: string;
  content: { attachment: Attachment }[];
}

export interface Binary extends Resource {
  resourceType: "Binary";
  contentType: string;
  /** The DocumentReference whose access rules apply to this file. */
  securityContext?: Reference;
}

export interface DocumentMapOptions {
  /**
   * Whether this caller may download the file (Binary/[id]). When false the
   * attachment carries no url: a patient sees the metadata of a clinic
   * record but gets its file only once clinic documents have a release step.
   */
  contentAvailable: boolean;
}

/**
 * The row's state from deleted_at: "live" (not removed), "removed", or null
 * when it cannot be told (the column was not read).
 */
export function documentRowState(row: Row): string | null {
  const v = row.deleted_at;
  if (v === null) return DOCUMENT_ROW_LIVE;
  if (typeof v === "string" && v !== "") return DOCUMENT_ROW_REMOVED;
  return null;
}

/** The declared file type if it is on the allowlist (parameters dropped), else application/octet-stream. */
export function documentContentType(raw: unknown): string {
  if (typeof raw !== "string") return OCTET_STREAM;
  const base = raw.split(";")[0].trim().toLowerCase();
  return CONTENT_TYPE_EXTENSIONS.has(base) ? base : OCTET_STREAM;
}

// Control characters, zero-width characters and bidirectional overrides
// (which can make "report\u202Efdp.exe" display as "reportexe.pdf").
// Matching control characters is the point here.
// eslint-disable-next-line no-control-regex
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;
const MAX_TITLE = 255;

/**
 * The file name as recorded, made safe to show: only the last part of
 * anything that looks like a path (a browser can report "C:\fakepath\x.pdf";
 * a row inserted by hand could hold a folder), without invisible
 * characters. A URL is not a file name (its last part could carry a signed
 * URL's token), and a value that is empty afterwards or longer than any
 * real file name is left out rather than cut.
 */
export function documentTitle(raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw.includes("://")) return undefined;
  const base = raw.split(/[\\/]/).pop() ?? "";
  // Tabs and line breaks become spaces; other invisible characters go.
  const clean = base.replace(/\s+/g, " ").replace(INVISIBLE, "").replace(/ {2,}/g, " ").trim();
  if (!clean || clean === "." || clean === ".." || [...clean].length > MAX_TITLE) return undefined;
  return clean;
}

/**
 * The name a download is saved under: plain ASCII letters, digits, dot,
 * dash and underscore, from the recorded file name, with the extension of
 * the type it is served as (so a file served as octet-stream is saved as
 * .bin, never as .html or .exe). "document" when nothing usable is left.
 */
export function downloadFilename(raw: unknown, contentType: string): string {
  const ext = CONTENT_TYPE_EXTENSIONS.get(contentType) ?? "bin";
  const title = documentTitle(raw) ?? "";
  const dot = title.lastIndexOf(".");
  const stem = (dot > 0 ? title.slice(0, dot) : title)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 80)
    .replace(/^[._-]+|[._-]+$/g, "");
  return `${stem || "document"}.${ext}`;
}

/** The recorded document type as a local code, or as text when it is not one the portal offers. */
export function documentTypeConcept(raw: unknown): CodeableConcept | undefined {
  if (typeof raw !== "string" || raw.trim() === "") return undefined;
  const label = DOCUMENT_TYPES.get(raw);
  if (label) return { coding: [{ system: DOCUMENT_TYPE_SYSTEM, code: raw, display: label }], text: label };
  // Free text that names a storage location is left out rather than
  // failing the whole document (the module refuses any storage URL).
  if (namesStorage(raw)) return undefined;
  return { text: raw.trim() };
}

/** Text that mentions a Supabase Storage path. */
function namesStorage(text: string): boolean {
  return text.includes("/storage/v1/");
}

/** Who added the document, as a local code; left out for any value the table does not allow. */
export function documentSourceConcept(raw: unknown): CodeableConcept | undefined {
  if (typeof raw !== "string") return undefined;
  const label = DOCUMENT_SOURCES.get(raw);
  return label ? { coding: [{ system: DOCUMENT_SOURCE_SYSTEM, code: raw, display: label }], text: label } : undefined;
}

/**
 * meta for both resources: the source only. meta.lastUpdated is not
 * published (updated_at is not read, see DOCUMENT_COLUMNS), and the gateway
 * sets meta.versionId to a digest of the resource as served.
 */
function documentMeta(): Meta {
  return { source: MBHR_SOURCE };
}

/** File size in bytes as the uploader's browser reported it: a whole number >= 0, else left out. */
function fileSize(row: Row): number | undefined {
  const n = num(row, "file_size");
  return n !== undefined && Number.isInteger(n) && n >= 0 && n <= 2147483647 ? n : undefined;
}

export function mapDocumentReference(row: Row, ctx: MapContext, opts: DocumentMapOptions): DocumentReference | null {
  const id = str(row, "id");
  const subject = patientReference(ctx, row.patient_id);
  const status = applyStatusMap(DOCUMENT_REFERENCE_STATUS, documentRowState(row));
  if (!id || !subject || !status) return null;

  const type = documentTypeConcept(row.document_type);
  const category = documentSourceConcept(row.upload_source);
  // When the document was added to mBHR (server clock), not when it was written.
  const date = instant(row, "created_at");
  // The patient's own words about their upload. A clinic record's
  // description is a staff member's free-text note: never published.
  const patientText = row.upload_source === "patient" ? str(row, "description") : undefined;
  const description = patientText !== undefined && !namesStorage(patientText) ? patientText : undefined;

  // Always the type the gateway will serve the file as, so the metadata
  // and the download agree.
  const attachment: Attachment = { contentType: documentContentType(row.mime_type) };
  if (opts.contentAvailable) attachment.url = `Binary/${id}`;
  const size = fileSize(row);
  if (size !== undefined) attachment.size = size;
  const title = documentTitle(row.document_name);
  if (title) attachment.title = title;

  // Elements in the order of the R4 specification.
  return {
    resourceType: "DocumentReference",
    id,
    meta: documentMeta(),
    status,
    ...(type ? { type } : {}),
    ...(category ? { category: [category] } : {}),
    subject,
    ...(date ? { date } : {}),
    ...(description ? { description } : {}),
    content: [{ attachment }],
  };
}

/** The Binary for a document's file (the body itself is streamed by the gateway). */
export function mapBinary(row: Row, ctx: MapContext): Binary | null {
  const id = str(row, "id");
  const subject = patientReference(ctx, row.patient_id);
  const live = applyStatusMap(DOCUMENT_REFERENCE_STATUS, documentRowState(row)) === "current";
  if (!id || !subject || !live) return null;
  return {
    resourceType: "Binary",
    id,
    meta: documentMeta(),
    contentType: documentContentType(row.mime_type),
    securityContext: { reference: `DocumentReference/${id}` },
  };
}
