// Server-attributed mBHR events -> Provenance
//
// A Provenance says who did what to a published record, and when. mBHR can
// only say that honestly for events the DATABASE records itself (the actor
// comes from the signed-in session and the time from the server clock),
// never for values a tablet uploads. So one Provenance is derived, read
// only, from each of these event rows and nothing else:
//
//   labrel-<id>  public.lab_result_release_log: a clinician reviewed a
//                laboratory result, released it to the patient portal, or
//                withheld it from the portal. Written only by the review,
//                release and withhold database functions, with the caller's
//                own account and clock_timestamp().
//   merge-<id>   public.patient_merges rows written by merge_patients():
//                a duplicate patient record merged into the kept record.
//                Only rows with a server-stamped actor (actor_id): older
//                rows were uploaded by tablets and name a device-claimed
//                person and a device time, so they are not published.
//   docup-<id>   public.patient_documents: a document stored for a patient
//                (created_at: the server default, as the app never sends it;
//                the database does not yet stop a client setting it).
//
// What each element says, and what is deliberately left out:
//
//   - recorded is the time the event row was stored (server-stamped for
//     laboratory events and merges; for uploads, see docup above).
//     occurred[x] is left out: no source records a separate time the
//     activity was performed (patient_merges.requested_at is a tablet clock
//     and is not published).
//   - agent.who is a Practitioner reference only when the stamped account
//     resolves through the staff directory (public.fhir_staff_directory,
//     which gives each staff account a stable random id). Otherwise it is a
//     display-only reference ("mBHR staff member"). The account id itself,
//     device ids and staff contact details are never published.
//   - Document uploads never name a person: before the ownership migration
//     every document was marked as a clinic record whoever uploaded it, and
//     the stored uploader id was not stamped by the server, so the agent is
//     "Patient portal account" (a portal upload, possibly by a caregiver)
//     or "mBHR account" (anything else).
//   - agent.type only where an R4 code says exactly what the person did:
//     a review is the verification that makes a laboratory result final
//     (provenance-participant-type "verifier"). Release, withhold, merge and
//     upload carry no agent type.
//   - The target Observation is the result as it is NOW (it has no
//     versions). When a reviewed result's value, unit, range or
//     interpretation changes, the database clears its review and release
//     and stamps amended_at; the log keeps the old rows. So a review or
//     release is published only while it still stands: the result still
//     carries a review, and the event was recorded after the latest
//     amendment. Otherwise it described an earlier value and is left out
//     (like the events of a superseded result). A withhold is kept: an
//     amendment does not lift it, the result stays off the portal.
//   - activity is an explicit local code (https://mbhr.app/codes/provenance-activity)
//     except for an upload, which is exactly v3-DataOperation CREATE.
//   - Never published: the withhold reason and any other free text, the
//     merge snapshots and field choices (winner_before, loser_before,
//     field_choices), who asked for a merge on the tablet (merged_by,
//     requested_by), storage paths, and internal patient ids.
//
// Mappers are pure (see common.ts): the resource module fetches the rows and
// resolves patients and staff first.

import type { CodeableConcept, Coding, Meta, Reference, Resource } from "../types/fhir";
import { MBHR_CODES } from "../terminology/codeSystems";
import { applyStatusMap, type StatusMap } from "../terminology/statusMaps";
import { LAB_OBSERVATION_PREFIX } from "../resources/labObservation";
import { canonicalMicros } from "./auditEvent";
import { MBHR_SOURCE, instant, str, type MapContext, type Row } from "./common";

// ---------------------------------------------------------------------------
// Types (the slice of R4 Provenance this mapper fills)
// ---------------------------------------------------------------------------

export interface ProvenanceAgent {
  type?: CodeableConcept;
  /** R4 requires who: a Practitioner reference, or a display-only reference. */
  who: Reference;
}

export interface ProvenanceEntity {
  role: "derivation" | "revision" | "quotation" | "source" | "removal";
  what: Reference;
}

export interface Provenance extends Resource {
  resourceType: "Provenance";
  target: Reference[];
  recorded: string;
  activity?: CodeableConcept;
  agent: ProvenanceAgent[];
  entity?: ProvenanceEntity[];
}

// ---------------------------------------------------------------------------
// Code systems
// ---------------------------------------------------------------------------

/** mBHR's own activity codes (no R4 code says "released to the patient portal"). */
export const PROVENANCE_ACTIVITY_SYSTEM = `${MBHR_CODES}/provenance-activity`;
export const V3_DATA_OPERATION = "http://terminology.hl7.org/CodeSystem/v3-DataOperation";
export const PROVENANCE_PARTICIPANT_TYPE = "http://terminology.hl7.org/CodeSystem/provenance-participant-type";

/** The local activity codes and their plain-language meaning. */
export const PROVENANCE_ACTIVITIES: Readonly<Record<ProvenanceActivityCode, string>> = {
  "lab-review": "Laboratory result reviewed by a clinician",
  "lab-release": "Laboratory result released to the patient portal",
  "lab-withhold": "Laboratory result withheld from the patient portal",
  "patient-merge": "Duplicate patient record merged into the kept record",
};

export type ProvenanceActivityCode = "lab-review" | "lab-release" | "lab-withhold" | "patient-merge";

/** An upload creates a new document record: exactly v3-DataOperation CREATE. */
export const UPLOAD_ACTIVITY: Coding = { system: V3_DATA_OPERATION, code: "CREATE", display: "create" };

/** A review is the verification that makes a result final (the only agent type published). */
export const VERIFIER: CodeableConcept = {
  coding: [{ system: PROVENANCE_PARTICIPANT_TYPE, code: "verifier", display: "Verifier" }],
};

/** Display-only agents: no id of any kind. */
export const STAFF_MEMBER_DISPLAY = "mBHR staff member";
export const PORTAL_ACCOUNT_DISPLAY = "Patient portal account";
export const ANY_ACCOUNT_DISPLAY = "mBHR account";

// ---------------------------------------------------------------------------
// Activity maps (listed for the status-map tests and the mapping docs)
// ---------------------------------------------------------------------------

const PROVENANCE_ACTIVITY_VALUE_SET = "http://hl7.org/fhir/ValueSet/provenance-activity-type";

/**
 * Provenance.activity <- lab_result_release_log.action. The table's CHECK
 * allows exactly these three values; anything else is not a release-log
 * event this mapper understands, so the row is withheld, never guessed.
 */
export const LAB_EVENT_ACTIVITY: StatusMap<ProvenanceActivityCode> = {
  element: "Provenance.activity",
  source: "public.lab_result_release_log.action",
  valueSet: PROVENANCE_ACTIVITY_VALUE_SET,
  allowed: ["lab-review", "lab-release", "lab-withhold"],
  rules: [
    {
      source: ["reviewed"],
      fhir: "lab-review",
      reason: "A clinician with lab_review marked the result reviewed (lab_review_result); the server stamped the account and the time.",
    },
    {
      source: ["released"],
      fhir: "lab-release",
      reason: "A clinician with lab_release made the reviewed result visible on the patient portal; a release is not a review.",
    },
    {
      source: ["withheld"],
      fhir: "lab-withhold",
      reason: "A clinician with lab_release kept the result off the patient portal; the result stays in the clinical record and the reason is not published.",
    },
  ],
  missing: { fhir: null, reason: "No action recorded: the event says nothing, so the record is withheld." },
  unrecognised: { fhir: null, reason: "Not an action the release log records: the record is withheld, not guessed." },
};

/**
 * Provenance.activity <- patient_merges.kind. "unmerge" is reserved in the
 * CHECK but nothing writes it, so it is not published.
 */
export const MERGE_ACTIVITY: StatusMap<ProvenanceActivityCode> = {
  element: "Provenance.activity",
  source: "public.patient_merges.kind",
  valueSet: PROVENANCE_ACTIVITY_VALUE_SET,
  allowed: ["patient-merge"],
  rules: [
    {
      source: ["merge"],
      fhir: "patient-merge",
      reason: "merge_patients() moved a duplicate record's history to the kept record and marked it merged.",
    },
  ],
  missing: { fhir: null, reason: "No kind recorded: the record is withheld." },
  unrecognised: { fhir: null, reason: "Not a merge (\"unmerge\" has no writer): the record is withheld, not guessed." },
};

/** Every activity map of this resource, for the status-map tests and docs. */
export const PROVENANCE_STATUS_MAPS: readonly StatusMap[] = [LAB_EVENT_ACTIVITY, MERGE_ACTIVITY];

/**
 * Provenance.agent.who.display <- patient_documents.upload_source. Only
 * "patient" is certain (set by the server for a portal upload). "staff" is
 * also the value every document stored before the ownership migration was
 * given, whoever uploaded it, so it names no one.
 */
export const UPLOAD_AGENT_DISPLAY: Readonly<Record<string, string>> = {
  patient: PORTAL_ACCOUNT_DISPLAY,
  staff: ANY_ACCOUNT_DISPLAY,
};

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** patient_merges.id values that fit in a FHIR id after "merge-" (64 characters, [A-Za-z0-9-.]). */
export const MERGE_SOURCE_ID = /^[A-Za-z0-9.-]{1,58}$/;

export type ProvenanceKind = "lab" | "merge" | "upload";

/** Id prefix per event kind. Never change one: published ids would change. */
export const PROVENANCE_PREFIX: Readonly<Record<ProvenanceKind, string>> = {
  lab: "labrel-",
  merge: "merge-",
  upload: "docup-",
};

/** The event kind and source row id of a Provenance id, or null when it is not one this server makes. */
export function parseProvenanceId(id: string): { kind: ProvenanceKind; sourceId: string } | null {
  for (const kind of ["lab", "merge", "upload"] as const) {
    const prefix = PROVENANCE_PREFIX[kind];
    if (!id.startsWith(prefix)) continue;
    const sourceId = id.slice(prefix.length);
    const ok = kind === "merge" ? MERGE_SOURCE_ID.test(sourceId) : UUID.test(sourceId);
    return ok ? { kind, sourceId } : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Columns read (and nothing else: reason, merged_by, requested_by,
// field_choices, winner_before, loser_before, file_path are never selected)
// ---------------------------------------------------------------------------

export const LAB_EVENT_COLUMNS = ["id", "result_id", "action", "actor_id", "created_at"] as const;
/**
 * lab_results: the order of the result, whether a newer result replaced it,
 * whether it carries a review now, and when its value last changed.
 */
export const LAB_RESULT_LINK_COLUMNS = ["id", "order_id", "superseded_by", "reviewed_at", "amended_at"] as const;
/** lab_orders: the patient of the order. */
export const LAB_ORDER_LINK_COLUMNS = ["id", "patient_id"] as const;
export const MERGE_EVENT_COLUMNS = ["id", "winner_id", "loser_id", "kind", "actor_id", "created_at"] as const;
export const UPLOAD_EVENT_COLUMNS = ["id", "patient_id", "created_at", "upload_source", "deleted_at"] as const;

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

/** Event rows never change: the stored time is the version time. */
function eventMeta(recorded: string): Meta {
  return { versionId: String(Date.parse(recorded)), lastUpdated: recorded, source: MBHR_SOURCE };
}

function activityConcept(code: ProvenanceActivityCode): CodeableConcept {
  return { coding: [{ system: PROVENANCE_ACTIVITY_SYSTEM, code, display: PROVENANCE_ACTIVITIES[code] }] };
}

/**
 * The staff member a server-stamped account id names: the Practitioner the
 * staff directory resolved, or a display-only reference. Never the id.
 */
export function staffAgent(staff: ReadonlyMap<string, Reference>, accountId: unknown): Reference {
  const ref = typeof accountId === "string" ? staff.get(accountId) : undefined;
  return ref?.reference ? { reference: ref.reference } : { display: STAFF_MEMBER_DISPLAY };
}

/** What a laboratory event row is linked to (looked up by the resource module). */
export interface LabEventLinks {
  /** lab_results.order_id (the DiagnosticReport id). */
  orderId: string;
  /** false when a newer result replaced this one (superseded_by set): not published. */
  current: boolean;
  /** lab_orders.patient_id: internal, never published; must resolve to a Patient. */
  patientId: string;
  /** lab_results.reviewed_at is set: the result carries a review now. */
  reviewed: boolean;
  /**
   * lab_results.amended_at as stored (the latest change of value, unit,
   * range or interpretation), or null when the result was never amended.
   */
  amendedAt: string | null;
}

/**
 * Whether a review or release event still stands: the result still carries
 * a review, and the event was recorded after the result's latest amendment
 * (compared to the microsecond). An amendment time that cannot be read, or
 * an event time that cannot be compared with it, counts as not standing:
 * unknown is never published as verified.
 */
export function reviewStillStands(recordedAt: unknown, links: LabEventLinks): boolean {
  if (!links.reviewed) return false;
  if (links.amendedAt === null) return true;
  const amended = canonicalMicros(links.amendedAt);
  const recorded = canonicalMicros(recordedAt);
  return amended !== null && recorded !== null && recorded > amended;
}

/**
 * lab_result_release_log row -> Provenance, or null (withheld) when the
 * action is not one of the three, the time is missing, the result is not
 * visible or was replaced, its patient does not resolve, or it is a review
 * or release that no longer stands (see reviewStillStands).
 */
export function mapLabReleaseEvent(
  row: Row,
  links: LabEventLinks | undefined,
  refs: MapContext,
  staff: ReadonlyMap<string, Reference>,
): Provenance | null {
  const id = str(row, "id");
  const resultId = str(row, "result_id");
  const activity = applyStatusMap(LAB_EVENT_ACTIVITY, row.action);
  const recorded = instant(row, "created_at");
  if (!id || !UUID.test(id) || !resultId || !UUID.test(resultId) || !activity || !recorded) return null;
  if (!links || !links.current || !UUID.test(links.orderId) || !refs.patientFhirIds.has(links.patientId)) return null;
  // A cleared review (and the release that went with it) described an earlier value.
  if ((activity === "lab-review" || activity === "lab-release") && !reviewStillStands(row.created_at, links)) return null;

  const agent: ProvenanceAgent = { who: staffAgent(staff, row.actor_id) };
  if (activity === "lab-review") agent.type = VERIFIER;
  return {
    resourceType: "Provenance",
    id: `${PROVENANCE_PREFIX.lab}${id}`,
    meta: eventMeta(recorded),
    target: [
      { reference: `Observation/${LAB_OBSERVATION_PREFIX}${resultId}` },
      { reference: `DiagnosticReport/${links.orderId}` },
    ],
    recorded,
    activity: activityConcept(activity),
    agent: [agent],
  };
}

/**
 * patient_merges row -> Provenance, or null (withheld) when the row has no
 * server-stamped actor, is not a merge, has no time, or the kept record does
 * not resolve.
 *
 * `patients` maps an internal patient id to that record's OWN published id
 * (for records whose merge chain ends): a merge is about two specific
 * records, so the target names the kept record and the merged-away record
 * themselves (the merged-away one is a published tombstone that links to
 * the kept record), not the canonical record they now both resolve to.
 */
export function mapMergeEvent(
  row: Row,
  patients: ReadonlyMap<string, string>,
  staff: ReadonlyMap<string, Reference>,
): Provenance | null {
  const id = str(row, "id");
  const activity = applyStatusMap(MERGE_ACTIVITY, row.kind);
  const recorded = instant(row, "created_at");
  const actor = str(row, "actor_id");
  if (!id || !MERGE_SOURCE_ID.test(id) || !activity || !recorded || !actor) return null;
  const winnerId = str(row, "winner_id");
  const loserId = str(row, "loser_id");
  const kept = winnerId ? patients.get(winnerId) : undefined;
  if (!kept) return null;
  const merged = loserId && loserId !== winnerId ? patients.get(loserId) : undefined;

  const resource: Provenance = {
    resourceType: "Provenance",
    id: `${PROVENANCE_PREFIX.merge}${id}`,
    meta: eventMeta(recorded),
    target: [{ reference: `Patient/${kept}` }],
    recorded,
    activity: activityConcept(activity),
    agent: [{ who: staffAgent(staff, actor) }],
  };
  if (merged && merged !== kept) {
    // The merged-away record was changed too (marked merged), and its data
    // was the source of what moved to the kept record.
    resource.target.push({ reference: `Patient/${merged}` });
    resource.entity = [{ role: "source", what: { reference: `Patient/${merged}` } }];
  }
  return resource;
}

/**
 * patient_documents row -> Provenance of the upload, or null (withheld) for
 * a removed document (not published as a DocumentReference), a missing time
 * or a patient that does not resolve.
 */
export function mapDocumentUploadEvent(row: Row, refs: MapContext): Provenance | null {
  const id = str(row, "id");
  const recorded = instant(row, "created_at");
  const patientId = row.patient_id;
  if (!id || !UUID.test(id) || !recorded) return null;
  if (row.deleted_at !== null && row.deleted_at !== undefined) return null;
  if (typeof patientId !== "string" || !refs.patientFhirIds.has(patientId)) return null;
  const source = str(row, "upload_source")?.toLowerCase();
  const display = (source && UPLOAD_AGENT_DISPLAY[source]) || ANY_ACCOUNT_DISPLAY;
  return {
    resourceType: "Provenance",
    id: `${PROVENANCE_PREFIX.upload}${id}`,
    meta: eventMeta(recorded),
    target: [{ reference: `DocumentReference/${id}` }],
    recorded,
    activity: { coding: [UPLOAD_ACTIVITY] },
    agent: [{ who: { display } }],
  };
}
