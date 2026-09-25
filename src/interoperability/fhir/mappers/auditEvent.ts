// interop.access_audit (through public.fhir_access_audit_events) -> AuditEvent
//
// One AuditEvent per FHIR gateway request the audit trail recorded: a read
// or a search, permitted or refused. The rows are append-only and written
// by public.fhir_record_access_v2(), which takes the account, its role and
// its kind (staff, patient, none) from the session itself, never from the
// arguments, and accepts a "permit" row only from staff or from the portal
// patient whose own records were read.
//
// What each element says:
//
//   type        audit-event-type "rest" (a RESTful operation)
//   subtype     restful-interaction "read" or "search-type"
//   action      R for a read; E for a search (FHIR records a search as an
//               execute)
//   recorded    when the database stored the row (server clock)
//   outcome     0 for a permitted request, 4 for a refused one, 8 when the
//               recorded HTTP status says the server failed (5xx). 12 is
//               never used: nothing records that the system went down.
//   outcomeDesc the refusal reason CODE as recorded (e.g.
//               missing_permission), nothing else
//   purposeOfEvent  the v3 ActReason purpose the request stated, when it is
//               one of the codes the gateway knows ("invalid" is left out)
//   agent       the requester: a Practitioner reference when the account is
//               a staff account the staff directory resolves; otherwise a
//               display-only reference ("mBHR staff member", "Patient portal
//               account" or "mBHR account"). The staff role at the time is a
//               local code. Never the account id, the IP hash or the user
//               agent (agent.network is left out: a keyed hash is not an
//               address).
//   source      a display-only observer, "mBHR FHIR gateway", of type
//               security-source-type 4 (application server)
//   entity      each patient whose records were returned or named, as the
//               canonical Patient (a record merged since shows as the kept
//               record); plus, for a read, the resource read (its type and
//               id), or, for a search, the resource type searched (never the
//               search values: only parameter names were ever stored, and
//               they are not published either)
//
// Rows that cannot be told apart from a forged record are not published: a
// "permit" row from an account that was neither staff nor a portal patient
// can only come from a direct call of the Phase 1 recording function
// (which did not check the caller); the Phase 1 gateway served staff only.
// Rows with an action other than read or search are not gateway requests.

import type { CodeableConcept, Coding, Meta, Reference, Resource } from "../types/fhir";
import { applyStatusMap, type StatusMap } from "../terminology/statusMaps";
import { PURPOSE_OF_USE_SYSTEM } from "../consent/policy";
import { REFERENCE_TYPES } from "../validation/validate";
import { FHIR_ID } from "../search/params";
import { STAFF_ROLE_SYSTEM, STAFF_ROLES, isStaffRole } from "./directory";
import { MBHR_SOURCE, instant, str, type MapContext, type Row } from "./common";

// ---------------------------------------------------------------------------
// Types (the slice of R4 AuditEvent this mapper fills)
// ---------------------------------------------------------------------------

export type AuditEventAction = "C" | "R" | "U" | "D" | "E";
export type AuditEventOutcome = "0" | "4" | "8" | "12";

export interface AuditEventAgent {
  role?: CodeableConcept[];
  who: Reference;
  requestor: boolean;
}

export interface AuditEventEntity {
  what?: Reference;
  type?: Coding;
  role?: Coding;
  detail?: { type: string; valueString: string }[];
}

export interface AuditEvent extends Resource {
  resourceType: "AuditEvent";
  type: Coding;
  subtype?: Coding[];
  action?: AuditEventAction;
  recorded: string;
  outcome?: AuditEventOutcome;
  outcomeDesc?: string;
  purposeOfEvent?: CodeableConcept[];
  agent: AuditEventAgent[];
  source: { observer: Reference; type?: Coding[] };
  entity?: AuditEventEntity[];
}

// ---------------------------------------------------------------------------
// Code systems
// ---------------------------------------------------------------------------

export const AUDIT_EVENT_TYPE_SYSTEM = "http://terminology.hl7.org/CodeSystem/audit-event-type";
export const RESTFUL_INTERACTION_SYSTEM = "http://hl7.org/fhir/restful-interaction";
/** Code systems of the AuditEvent.action and .outcome code elements (for token searches). */
export const AUDIT_EVENT_ACTION_SYSTEM = "http://hl7.org/fhir/audit-event-action";
export const AUDIT_EVENT_OUTCOME_SYSTEM = "http://hl7.org/fhir/audit-event-outcome";
export const SECURITY_SOURCE_TYPE_SYSTEM = "http://terminology.hl7.org/CodeSystem/security-source-type";
export const RESOURCE_TYPES_SYSTEM = "http://hl7.org/fhir/resource-types";
export const OBJECT_ROLE_SYSTEM = "http://terminology.hl7.org/CodeSystem/object-role";

export const REST_TYPE: Coding = { system: AUDIT_EVENT_TYPE_SYSTEM, code: "rest", display: "RESTful Operation" };
export const GATEWAY_OBSERVER_DISPLAY = "mBHR FHIR gateway";
export const APPLICATION_SERVER: Coding = { system: SECURITY_SOURCE_TYPE_SYSTEM, code: "4", display: "Application Server" };
const ROLE_PATIENT: Coding = { system: OBJECT_ROLE_SYSTEM, code: "1", display: "Patient" };
const ROLE_DOMAIN_RESOURCE: Coding = { system: OBJECT_ROLE_SYSTEM, code: "4", display: "Domain Resource" };
const ROLE_QUERY: Coding = { system: OBJECT_ROLE_SYSTEM, code: "24", display: "Query" };

/** Display-only requesters: no id of any kind. */
export const STAFF_ACCOUNT_DISPLAY = "mBHR staff member";
export const PORTAL_ACCOUNT_DISPLAY = "Patient portal account";
export const OTHER_ACCOUNT_DISPLAY = "mBHR account";

/** The purposes of use the gateway parses (consent/policy.ts), all v3 ActReason codes. */
export const AUDIT_PURPOSES: readonly string[] = ["TREAT", "HOPERAT", "PATRQT", "HRESCH", "ETREAT", "PUBHLTH"];

// ---------------------------------------------------------------------------
// Status maps (listed for the status-map tests and the mapping docs)
// ---------------------------------------------------------------------------

/** AuditEvent.action <- access_audit.action. */
export const AUDIT_EVENT_ACTION: StatusMap<AuditEventAction> = {
  element: "AuditEvent.action",
  source: "interop.access_audit.action",
  valueSet: "http://hl7.org/fhir/ValueSet/audit-event-action",
  allowed: ["C", "R", "U", "D", "E"],
  rules: [
    { source: ["read"], fhir: "R", reason: "A read of one resource by its id." },
    { source: ["search"], fhir: "E", reason: "A type search; FHIR records a search as an execute (E), not a read." },
  ],
  missing: { fhir: null, reason: "No action recorded: not a gateway request, so the record is withheld." },
  unrecognised: {
    fhir: null,
    reason: "The gateway records reads and searches only; any other action is withheld, not guessed.",
  },
};

/** AuditEvent.subtype <- access_audit.action. */
export const AUDIT_EVENT_SUBTYPE: StatusMap<"read" | "search-type"> = {
  element: "AuditEvent.subtype",
  source: "interop.access_audit.action",
  valueSet: "http://hl7.org/fhir/ValueSet/audit-event-sub-type",
  allowed: ["read", "search-type"],
  rules: [
    { source: ["read"], fhir: "read", reason: "The RESTful read interaction (GET [type]/[id])." },
    { source: ["search"], fhir: "search-type", reason: "The RESTful type search interaction (GET [type]?...)." },
  ],
  missing: { fhir: null, reason: "No action recorded: the record is withheld." },
  unrecognised: { fhir: null, reason: "Not a read or a search: the record is withheld, not guessed." },
};

/**
 * AuditEvent.outcome <- access_audit.decision. A refusal is a minor failure
 * (4) of the request, not a system failure: 8 is used only when the stored
 * HTTP status is a server error (see auditOutcome()).
 */
export const AUDIT_EVENT_OUTCOME: StatusMap<AuditEventOutcome> = {
  element: "AuditEvent.outcome",
  source: "interop.access_audit.decision",
  valueSet: "http://hl7.org/fhir/ValueSet/audit-event-outcome",
  allowed: ["0", "4", "8", "12"],
  rules: [
    {
      source: ["permit"],
      fhir: "0",
      reason: "The access decision allowed the request (a permitted read may still have found nothing).",
    },
    {
      source: ["deny"],
      fhir: "4",
      reason: "The request was refused (authorisation, an invalid request, rate limit); a refusal is not a system failure.",
    },
  ],
  missing: { fhir: null, reason: "No decision recorded: the record is withheld." },
  unrecognised: { fhir: null, reason: "Neither permit nor deny: the record is withheld, not guessed." },
};

export const AUDIT_EVENT_STATUS_MAPS: readonly StatusMap[] = [AUDIT_EVENT_ACTION, AUDIT_EVENT_SUBTYPE, AUDIT_EVENT_OUTCOME];

// ---------------------------------------------------------------------------
// Row helpers
// ---------------------------------------------------------------------------

/** Columns public.fhir_access_audit_events returns that this mapper reads. */
export const AUDIT_EVENT_COLUMNS = [
  "id",
  "occurred_at",
  "action",
  "resource_type",
  "resource_id",
  "patient_ids",
  "actor_user_id",
  "actor_role",
  "actor_kind",
  "purpose",
  "decision",
  "denial_reason",
  "http_status",
  "result_count",
] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PATIENT_ID = /^[A-Za-z0-9._-]{1,128}$/;
const REASON_CODE = /^[a-z][a-z0-9_]{0,63}$/;

/** The internal patient ids a row records (never published). */
export function auditPatientIds(row: Row): string[] {
  const v = row.patient_ids;
  return Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && PATIENT_ID.test(x)))] : [];
}

/**
 * The kind of account that made the request. Rows written before the
 * Phase 2 recording function carry no kind: a recorded staff role means a
 * staff account (the role came from the session too).
 */
export function auditActorKind(row: Row): "staff" | "patient" | "none" | null {
  const kind = row.actor_kind;
  if (kind === "staff" || kind === "patient" || kind === "none") return kind;
  if (kind === null || kind === undefined) return isStaffRole(row.actor_role) ? "staff" : null;
  return null;
}

/** Account ids to look up in the staff directory (staff requesters only). */
export function staffAccountId(row: Row): string | null {
  const kind = auditActorKind(row);
  const id = row.actor_user_id;
  return kind === "staff" && typeof id === "string" && UUID.test(id) ? id : null;
}

function httpStatus(row: Row): number | null {
  const v = row.http_status;
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d{3}$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 100 && n <= 599 ? n : null;
}

/** AuditEvent.outcome: AUDIT_EVENT_OUTCOME, then 8 when the stored HTTP status is a server error. */
export function auditOutcome(row: Row): AuditEventOutcome | null {
  const base = applyStatusMap(AUDIT_EVENT_OUTCOME, row.decision);
  if (base === null) return null;
  const status = httpStatus(row);
  return status !== null && status >= 500 ? "8" : base;
}

/**
 * The patient a row belongs to, for the gateway's scope check and the
 * caller's own access audit (internal id, never published): the first
 * recorded patient that the search named, or the first recorded patient.
 * null when the search named patients and the row records none of them
 * (the row is then not shown).
 */
export function auditOwner(row: Row, named: readonly string[] | null): string | null {
  const ids = auditPatientIds(row);
  if (named) return ids.find((i) => named.includes(i)) ?? null;
  return ids[0] ?? null;
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function requester(row: Row, staff: ReadonlyMap<string, Reference>): AuditEventAgent {
  const kind = auditActorKind(row);
  let who: Reference;
  if (kind === "staff") {
    const id = staffAccountId(row);
    const ref = id ? staff.get(id) : undefined;
    who = ref?.reference ? { reference: ref.reference } : { display: STAFF_ACCOUNT_DISPLAY };
  } else if (kind === "patient") {
    who = { display: PORTAL_ACCOUNT_DISPLAY };
  } else {
    who = { display: OTHER_ACCOUNT_DISPLAY };
  }
  const agent: AuditEventAgent = { who, requestor: true };
  const role = row.actor_role;
  if (isStaffRole(role)) {
    agent.role = [{ coding: [{ system: STAFF_ROLE_SYSTEM, code: role, display: STAFF_ROLES[role] }] }];
  }
  return agent;
}

function resourceEntity(row: Row, action: AuditEventAction, permitted: boolean): AuditEventEntity | null {
  const type = str(row, "resource_type");
  if (!type || !REFERENCE_TYPES.includes(type)) return null;
  const entity: AuditEventEntity = { type: { system: RESOURCE_TYPES_SYSTEM, code: type } };
  if (action === "R") {
    const id = str(row, "resource_id");
    if (id && FHIR_ID.test(id)) entity.what = { reference: `${type}/${id}` };
    entity.role = ROLE_DOMAIN_RESOURCE;
  } else {
    // A search: the type searched only. The query itself is never published.
    entity.role = ROLE_QUERY;
  }
  const count = row.result_count;
  if (permitted && typeof count === "number" && Number.isInteger(count) && count >= 0) {
    entity.detail = [{ type: "result-count", valueString: String(count) }];
  }
  return entity;
}

/**
 * One audit row -> AuditEvent, or null (withheld) when the row is not a
 * gateway read or search, has no id or time, has no decision, or is a
 * "permit" from an account that was neither staff nor a portal patient.
 */
export function mapAuditEvent(row: Row, refs: MapContext, staff: ReadonlyMap<string, Reference>): AuditEvent | null {
  const id = str(row, "id");
  const recorded = instant(row, "occurred_at");
  const action = applyStatusMap(AUDIT_EVENT_ACTION, row.action);
  const subtype = applyStatusMap(AUDIT_EVENT_SUBTYPE, row.action);
  const outcome = auditOutcome(row);
  if (!id || !UUID.test(id) || !recorded || !action || !subtype || !outcome) return null;
  const permitted = row.decision === "permit";
  const kind = auditActorKind(row);
  if (permitted && kind !== "staff" && kind !== "patient") return null;

  const meta: Meta = { versionId: String(Date.parse(recorded)), lastUpdated: recorded, source: MBHR_SOURCE };
  const event: AuditEvent = {
    resourceType: "AuditEvent",
    id,
    meta,
    type: REST_TYPE,
    subtype: [{ system: RESTFUL_INTERACTION_SYSTEM, code: subtype, display: subtype }],
    action,
    recorded,
    outcome,
    agent: [requester(row, staff)],
    source: { observer: { display: GATEWAY_OBSERVER_DISPLAY }, type: [APPLICATION_SERVER] },
  };
  const reason = str(row, "denial_reason");
  if (outcome !== "0" && reason && REASON_CODE.test(reason)) event.outcomeDesc = reason;
  const purpose = str(row, "purpose");
  if (purpose && AUDIT_PURPOSES.includes(purpose)) {
    event.purposeOfEvent = [{ coding: [{ system: PURPOSE_OF_USE_SYSTEM, code: purpose }] }];
  }

  const entities: AuditEventEntity[] = [];
  const seen = new Set<string>();
  for (const pid of auditPatientIds(row)) {
    // Canonical record; a patient that no longer resolves (deleted, broken
    // merge chain) is left out rather than named by its internal id.
    const fhirId = refs.patientFhirIds.get(pid);
    if (!fhirId || seen.has(fhirId)) continue;
    seen.add(fhirId);
    entities.push({
      what: { reference: `Patient/${fhirId}` },
      type: { system: RESOURCE_TYPES_SYSTEM, code: "Patient" },
      role: ROLE_PATIENT,
    });
  }
  const resource = resourceEntity(row, action, permitted);
  if (resource) entities.push(resource);
  if (entities.length) event.entity = entities;
  return event;
}
