// Status maps for: DocumentReference.status and docStatus
// <- public.patient_documents.
//
// mBHR records no status for a document. The only record-state column is
// deleted_at, a soft delete: a patient (or a doctor, for a patient's own
// upload) removed the document from the portal. The mapper turns that
// column into one of two states before the map is applied:
//
//   "live"     deleted_at is empty: the document is in the patient's record
//   "removed"  deleted_at is set: the document was removed
//
// A removed document is never published (the queries filter deleted_at IS
// NULL and the mapper withholds one that slips through). A removal is not
// an assertion that the document was wrong, so it is never shown as
// entered-in-error; nor does anything replace it, so it is never
// superseded. mBHR records no error marker and no replacement link, so
// neither code is produced at all.
//
// docStatus (preliminary, final, amended) describes the document's own
// editorial state. Nothing in mBHR records it, so the element is always
// left out; in particular an uploaded file is never assumed final.

import type { StatusMap } from "../statusMaps";

export type DocumentReferenceStatus = "current" | "superseded" | "entered-in-error";
export type DocumentCompositionStatus = "preliminary" | "final" | "amended" | "entered-in-error";

/** The state of a patient_documents row: deleted_at is empty. */
export const DOCUMENT_ROW_LIVE = "live";
/** The state of a patient_documents row: deleted_at is set (removed). */
export const DOCUMENT_ROW_REMOVED = "removed";

export const DOCUMENT_REFERENCE_STATUS: StatusMap<DocumentReferenceStatus> = {
  element: "DocumentReference.status",
  source: "public.patient_documents.deleted_at (derived: 'live' when empty, 'removed' when set)",
  valueSet: "http://hl7.org/fhir/ValueSet/document-reference-status",
  allowed: ["current", "superseded", "entered-in-error"],
  rules: [
    {
      source: [DOCUMENT_ROW_LIVE],
      fhir: "current",
      reason:
        "A document that has not been removed is the current reference to its file: mBHR keeps no versions of a document and nothing replaces one.",
    },
  ],
  missing: {
    fhir: null,
    reason: "Whether the document was removed is not known: the record is withheld (FHIR requires a status).",
  },
  unrecognised: {
    fhir: null,
    reason:
      "A removed document ('removed') is not published: a removal is neither an error nor a replacement, and mBHR records no error or supersede marker. Any other state is withheld too.",
  },
};

export const DOCUMENT_REFERENCE_DOC_STATUS: StatusMap<DocumentCompositionStatus> = {
  element: "DocumentReference.docStatus",
  source: "(none: mBHR records no editorial status for a document)",
  valueSet: "http://hl7.org/fhir/ValueSet/composition-status",
  allowed: ["preliminary", "final", "amended", "entered-in-error"],
  rules: [],
  missing: {
    fhir: null,
    reason: "Nothing records whether a document is preliminary or final: left out, never assumed final.",
  },
  unrecognised: {
    fhir: null,
    reason: "Nothing records an editorial status for a document: left out, not guessed.",
  },
};

export const DOCUMENT_STATUS_MAPS: readonly StatusMap[] = [DOCUMENT_REFERENCE_STATUS, DOCUMENT_REFERENCE_DOC_STATUS];
