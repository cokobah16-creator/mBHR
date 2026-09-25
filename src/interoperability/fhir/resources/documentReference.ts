// DocumentReference <- public.patient_documents (see mappers/document.ts for
// the mapping rules). The file itself is served by Binary/[id] (binary.ts).
//
// Every query reads documents that were not removed (deleted_at IS NULL):
// staff row-level security returns removed rows too, so the filter is the
// gateway's own, applied in the query, and the mapper withholds a removed
// row that slips through. A removed document answers 404 and never appears
// in a search, for staff and patients alike.
//
// Staff need consult. A portal patient (restriction own_documents_only)
// reads the documents of their own records only, through scopeFilter() in
// every query, as the portal lists them; the attachment url is given only
// for documents they uploaded, the ones Binary will serve them.

import { READ_PERMISSIONS } from "../authorization/permissions";
import type { Row } from "../mappers/common";
import {
  CONTENT_TYPE_EXTENSIONS,
  DOCUMENT_COLUMNS,
  DOCUMENT_REFERENCE_STATUS_SYSTEM,
  DOCUMENT_SOURCES,
  DOCUMENT_SOURCE_SYSTEM,
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_SYSTEM,
  OCTET_STREAM,
  mapDocumentReference,
  type DocumentReference,
} from "../mappers/document";
import { referenceContext } from "../patients/canonical";
import { parseId, parseToken, type ParsedSearch } from "../search/params";
import { DOCUMENT_REFERENCE_DOC_STATUS, DOCUMENT_REFERENCE_STATUS, DOCUMENT_ROW_LIVE } from "../terminology/status/document";
import { sourceValuesFor } from "../terminology/statusMaps";
import type { AddIssue } from "../validation/validate";
import { emptyResult, type QueryCtx, type QueryResult, type ResourceDefinition, type ResourceModule } from "./module";
import {
  UUID,
  dateFilters,
  keysetPage,
  namedPatientFilter,
  one,
  ownersOf,
  patientNotes,
  scopeFilter,
  type Filters,
} from "./shared";
import { patientMayDownload } from "./binary";

export const definition: ResourceDefinition = {
  type: "DocumentReference",
  source: "public.patient_documents (documents that were not removed)",
  idStrategy: "patient_documents.id (uuid); the same id names the file as Binary/[id]",
  fields: [
    "status (current: a removed document is never published)",
    "type (the document type the uploader chose: local code https://mbhr.app/codes/document-type, or text when it is not one the portal offers)",
    "category (who added it: local code https://mbhr.app/codes/document-source, patient or staff)",
    "subject",
    "date (when the document was added to mBHR)",
    "description (documents the patient uploaded only)",
    "content.attachment: contentType (as served), url (Binary/[id], relative to this server), size (as the uploader's browser reported it), title (the file name)",
  ],
  profiles: [],
  interactions: ["read", "search-type"],
  searchParams: [
    { name: "_id", type: "token", documentation: "Logical id of the resource." },
    { name: "patient", type: "reference", documentation: "Patient/[id]. Required unless _id is given." },
    { name: "subject", type: "reference", documentation: "Same as patient (Patient/[id] only)." },
    {
      name: "date",
      type: "date",
      documentation:
        "When the document was added to mBHR. A date without a time is a clinic day in Africa/Lagos. Up to two bounds.",
      maxRepeats: 2,
    },
    {
      name: "type",
      type: "token",
      documentation:
        "A document type code of https://mbhr.app/codes/document-type (medical_record, lab_result, imaging, prescription, insurance, other). Documents whose type is text only never match.",
    },
    {
      name: "category",
      type: "token",
      documentation: "Who added the document: patient or staff (https://mbhr.app/codes/document-source).",
    },
    {
      name: "status",
      type: "token",
      documentation: "current matches every published document; superseded and entered-in-error match nothing (mBHR records neither).",
    },
  ],
  requiredSearch: [["_id"], ["patient"], ["subject"]],
  writeSupport: false,
  consentClass: "document",
  readPermissions: READ_PERMISSIONS.DocumentReference,
  patientAccess: true,
  sensitiveSearch: true,
  notes: [
    "Staff need consult. Patients see their own documents that were not removed, as in the portal.",
    "The file is at content.attachment.url (Binary/[id]); a patient gets a url only for documents they uploaded.",
    "No storage URL, signed URL or storage path is ever published.",
    "author is not published: mBHR records who uploaded a file, not who wrote it (a portal upload may come from a caregiver).",
    "Type, file name, file type, size and description are what the uploader entered and are not verified; a 'Test result' document is not a laboratory result.",
    "Documents added before mBHR recorded who uploaded them are categorised staff, including earlier portal uploads.",
    "meta.lastUpdated is not published.",
  ],
};

export const documentReferenceDefinition = definition;

async function mapDocuments(ctx: QueryCtx, rows: Row[]): Promise<(DocumentReference | null)[]> {
  const refs = await referenceContext(ctx.db, ownersOf(rows).filter((v): v is string => v !== null));
  return rows.map((r) =>
    mapDocumentReference(r, refs, { contentAvailable: ctx.scope.kind === "staff" || patientMayDownload(r) }),
  );
}

async function read(ctx: QueryCtx, id: string): Promise<QueryResult> {
  if (!UUID.test(id)) return emptyResult();
  const rows = await ctx.db.select(
    "patient_documents",
    DOCUMENT_COLUMNS,
    [["id", `eq.${id}`], ["deleted_at", "is.null"], ...scopeFilter(ctx)],
    { limit: 1 },
  );
  const mapped = await mapDocuments(ctx, rows);
  const resources: DocumentReference[] = [];
  const owners: (string | null)[] = [];
  mapped.forEach((d, i) => {
    if (d) {
      resources.push(d);
      owners.push(ownersOf([rows[i]])[0]);
    }
  });
  return { page: { resources, next: null }, owners };
}

/** A token in the given code system (or with no system), and its code if it is one of `codes`. */
function localCode(raw: string, name: string, system: string, codes: ReadonlyMap<string, string>): string | null {
  const t = parseToken(raw, name);
  if (t.system !== null && t.system !== system) return null;
  return codes.has(t.code) ? t.code : null;
}

async function search(ctx: QueryCtx, search: ParsedSearch): Promise<QueryResult> {
  const notes = patientNotes(ctx);
  const named = namedPatientFilter(ctx);
  if (named === null) return emptyResult(notes);
  const filters: Filters = [["deleted_at", "is.null"], ...scopeFilter(ctx), ...named];

  const idParam = one(search, "_id");
  if (idParam) {
    const id = parseId(idParam);
    if (!UUID.test(id)) return emptyResult(notes);
    filters.push(["id", `eq.${id}`]);
  }
  filters.push(...dateFilters("created_at", search.values.get("date"), "date"));

  const type = one(search, "type");
  if (type) {
    const code = localCode(type, "type", DOCUMENT_TYPE_SYSTEM, DOCUMENT_TYPES);
    if (code === null) return emptyResult(notes);
    // Exactly the stored value the mapper publishes as this code.
    filters.push(["document_type", `eq.${code}`]);
  }
  const category = one(search, "category");
  if (category) {
    const code = localCode(category, "category", DOCUMENT_SOURCE_SYSTEM, DOCUMENT_SOURCES);
    if (code === null) return emptyResult(notes);
    filters.push(["upload_source", `eq.${code}`]);
  }
  const status = one(search, "status");
  if (status) {
    const t = parseToken(status, "status");
    if (t.system !== null && t.system !== DOCUMENT_REFERENCE_STATUS_SYSTEM) return emptyResult(notes);
    // The status comes from the row's state (DOCUMENT_REFERENCE_STATUS): only
    // "live" rows are published, and every query already reads only those.
    if (!sourceValuesFor(DOCUMENT_REFERENCE_STATUS, t.code).includes(DOCUMENT_ROW_LIVE)) return emptyResult(notes);
  }

  const { page, rows } = await keysetPage<DocumentReference>({
    db: ctx.db,
    table: "patient_documents",
    columns: DOCUMENT_COLUMNS,
    key: "id",
    keyPattern: UUID,
    filters,
    count: search.count,
    cursor: search.cursor,
    map: (r) => mapDocuments(ctx, r),
  });
  return { page, owners: ownersOf(rows), ...notes };
}

const STATUS_CODES: readonly string[] = DOCUMENT_REFERENCE_STATUS.allowed;
const DOC_STATUS_CODES: readonly string[] = DOCUMENT_REFERENCE_DOC_STATUS.allowed;
const BINARY_URL = /^Binary\/[A-Za-z0-9\-.]{1,64}$/;

/**
 * DocumentReference rules: status and content are required (R4 1..1 and
 * 1..*), a subject is always published, and each attachment points at this
 * server's Binary for the same document, never at a storage location, and
 * never embeds the file.
 */
function validate(resource: Record<string, unknown>, add: AddIssue): void {
  if (!STATUS_CODES.includes(resource.status as string)) add("status", "required, a document-reference-status code");
  if (resource.docStatus !== undefined && !DOC_STATUS_CODES.includes(resource.docStatus as string)) {
    add("docStatus", "not a composition-status code");
  }
  const subject = resource.subject as { reference?: unknown } | undefined;
  if (typeof subject?.reference !== "string" || !subject.reference.startsWith("Patient/")) add("subject", "required (a Patient)");
  const content = resource.content;
  if (!Array.isArray(content) || content.length === 0) {
    add("content", "required");
    return;
  }
  content.forEach((c: unknown, i: number) => {
    const attachment = (c as { attachment?: unknown } | null)?.attachment;
    if (typeof attachment !== "object" || attachment === null) {
      add(`content[${i}].attachment`, "required");
      return;
    }
    const a = attachment as Record<string, unknown>;
    if (a.data !== undefined) add(`content[${i}].attachment.data`, "the file is never embedded");
    if (a.url !== undefined) {
      if (typeof a.url !== "string" || !BINARY_URL.test(a.url) || a.url !== `Binary/${String(resource.id)}`) {
        add(`content[${i}].attachment.url`, "must be this document's Binary/[id]");
      }
    }
    const type = a.contentType;
    if (type !== undefined && (typeof type !== "string" || (type !== OCTET_STREAM && !CONTENT_TYPE_EXTENSIONS.has(type)))) {
      add(`content[${i}].attachment.contentType`, "not a type the gateway serves");
    }
    if (a.size !== undefined && (typeof a.size !== "number" || !Number.isInteger(a.size) || a.size < 0)) {
      add(`content[${i}].attachment.size`, "not an unsignedInt");
    }
  });
  // Defence in depth: nothing that looks like a Storage URL anywhere.
  if (JSON.stringify(resource).includes("/storage/v1/")) add("", "contains a storage URL");
}

export const documentReferenceModule: ResourceModule = { definition, read, search, validate };
