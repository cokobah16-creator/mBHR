// Consent <- mBHR's consent register (interop.consent_records and
// interop.consent_provisions), read through public.fhir_consent_directives
// (see mappers/consent.ts for the mapping rules).
//
// The register is not reachable with PostgREST table reads (the interop
// schema has no API grants), so every read goes through that database
// function. It runs with its own checks: staff may name any patient; a
// portal patient only their own records (it refuses other patient ids, and
// with consent ids it returns only records of their own patients). It
// takes a patient-id or consent-id selector (at least one), returns records
// ordered by id and pages with p_after / p_limit.
//
// This module applies the caller's scope in the call itself, the same rule
// scopeFilter() and namedPatientFilter() apply in SQL elsewhere:
//
//   - a patient caller: p_patient_ids is always their own linked records
//     (restriction own_consents_only), narrowed further to the patient a
//     search names; no other patient's id is ever sent
//   - a search naming a patient: that patient's canonical record plus the
//     records merged into it (consent records are not moved by a merge,
//     so a directive still filed under a merged-away record is found under
//     the kept record, and shown with the kept record as its patient)
//
// Known gap for patients: a directive still filed under a record that was
// merged into the patient's own is not shown to the patient yet (staff see
// it under the kept record, and the portal lists it). A patient cannot see
// merged-away records under row-level security, so the gateway can neither
// name them in the call nor resolve them to the kept record; that needs a
// database helper (requested). Until then every patient searchset says so
// (CONSENT_COVERAGE_NOTE_PATIENT) instead of claiming to be complete.
//
// status and scope are filtered after mapping, on the published values,
// so a search always finds exactly what a read shows (a withdrawn record
// is inactive and never matches status=active).

import { FhirError, errors } from "../errors/operationOutcome";
import type { OperationOutcomeIssue } from "../types/fhir";
import { READ_PERMISSIONS } from "../authorization/permissions";
import {
  CONSENT_SCOPES,
  CONSENT_SCOPE_SYSTEM,
  LOCAL_CONSENT,
  mapConsentRecord,
  mapConsentScope,
  mapConsentStatus,
  mapProvision,
  validateConsent,
  type Consent,
  type ConsentMapResult,
  type ConsentWithheld,
} from "../mappers/consent";
import { validateResource } from "../validation/validate";
import type { Row } from "../mappers/common";
import { CONSENT_STATE_CODES, CONSENT_STATE_SYSTEM, type ConsentState } from "../terminology/status/consent";
import { referenceContext } from "../patients/canonical";
import { parseId, parseToken, type Cursor, type ParsedSearch } from "../search/params";
import type { Postgrest } from "../gateway/postgrest";
import { emptyResult, type QueryCtx, type QueryResult, type ResourceDefinition, type ResourceModule } from "./module";
import { MAX_KEYSET_ROUNDS, UUID, checkCursorKey, one, patientNotes } from "./shared";

/**
 * Whether the gateway's generic checker (validation/validate.ts) accepts a
 * rule's actor the way FHIR R4 has it. Consent.provision.actor.reference is
 * itself a Reference, which mBHR fills with a display only (the kind of
 * recipient; a specific recipient is never published). The shared checker
 * currently reads every element named "reference" as a Type/id string and
 * rejects it (a fix is requested as a shared change).
 *
 * While it does, a directive with a rule for a kind of recipient is not
 * handed to the gateway: a read answers with an error that says why, and a
 * searchset counts them in their own warning. Leaving the actor out
 * instead would change the rule (a permit for one kind of recipient would
 * read as a permit for every recipient), so that is never done.
 *
 * This is checked once, against the shared checker itself, with the rule
 * shape the mapper produces, so these directives are served as soon as the
 * checker accepts them, with no other change here.
 */
function actorRulesAccepted(): boolean {
  const rule = mapProvision({ provision_type: "deny", actor_type: "external_system", action: "disclose" });
  if (typeof rule === "symbol") return false;
  const sample = {
    resourceType: "Consent",
    id: "actor-check",
    meta: { lastUpdated: "2026-01-01T00:00:00Z" },
    status: "active",
    scope: { coding: [{ system: CONSENT_SCOPE_SYSTEM, code: "patient-privacy" }] },
    category: [{ coding: [{ system: LOCAL_CONSENT.category, code: "check" }] }],
    patient: { reference: "Patient/actor-check" },
    policy: [{ uri: "https://mbhr.app/policies/check" }],
    provision: { provision: [rule] },
  };
  return validateResource(sample, validateConsent).length === 0;
}

/** true when directives with a rule for a kind of recipient can be served (see actorRulesAccepted). */
export const ACTOR_RULES_SERVED: boolean = actorRulesAccepted();

/** Whether a published Consent has a rule naming a kind of recipient. */
export function hasActorRule(resource: Consent): boolean {
  return (resource.provision?.provision ?? []).some((rule) => (rule.actor?.length ?? 0) > 0);
}

export const definition: ResourceDefinition = {
  type: "Consent",
  source:
    "mBHR consent register: interop.consent_records with interop.consent_provisions, read through public.fhir_consent_directives",
  idStrategy: "consent_records.id (uuid)",
  fields: [
    "status (consent-state code as recorded; a withdrawn record is inactive, never active)",
    "scope (consentscope code as recorded)",
    "category (mBHR local code https://mbhr.app/codes/consent-category; no LOINC)",
    "patient (the canonical record)",
    "dateTime (when the record was entered in the register)",
    "policy.uri",
    "verification (verified true with its date, or verified false, only as recorded)",
    "provision.period (the record's effective period)",
    "provision.provision (one per stored rule: type, period, actor kind, action, purpose, class, securityLabel)",
  ],
  profiles: [],
  interactions: ["read", "search-type"],
  searchParams: [
    { name: "_id", type: "token", documentation: "Logical id of the consent record (a uuid)." },
    {
      name: "patient",
      type: "reference",
      documentation:
        "Patient/[id]. Directives about this patient, including ones still filed under records merged into it. Required unless _id is given.",
      patientDocumentation:
        "A patient gets only directives filed under their own current record, not ones filed under records merged into it, and need not give patient.",
    },
    {
      name: "status",
      type: "token",
      documentation:
        "draft, proposed, active, rejected, inactive or entered-in-error (http://hl7.org/fhir/consent-state-codes). Matches the published status: a withdrawn record is inactive.",
    },
    {
      name: "scope",
      type: "token",
      documentation: "adr, research, patient-privacy or treatment (http://terminology.hl7.org/CodeSystem/consentscope).",
    },
  ],
  requiredSearch: [["_id"], ["patient"]],
  writeSupport: false,
  consentClass: "consent",
  readPermissions: READ_PERMISSIONS.Consent,
  patientAccess: true,
  sensitiveSearch: false,
  notes: [
    "Staff with consult, portal_manage or audit_access may read consents.",
    "A withdrawn consent is kept and published as inactive: it is never deleted and never shown as active.",
    "Who recorded, verified or withdrew a consent, the reason for a withdrawal, who signed it and its source document are never published; neither is a performer.",
    "A rule's actor names the kind of recipient recorded (for example External system), never a specific one.",
    "A consent that cites no policy (FHIR requires one) or whose rules cannot be shown without changing their meaning is not published; a searchset says how many were left out.",
    ...(ACTOR_RULES_SERVED
      ? []
      : [
          "A consent with a rule for a kind of recipient (for example External system) is not served yet: a read answers 500 saying so, and a searchset says how many were left out. It is never served without that rule.",
        ]),
    "An empty result is not evidence that the patient agreed to or refused any use of their data.",
  ],
  patientAccessNotes: [
    "Patients see only their own consents.",
    "Patients do not yet see directives still filed under another record of theirs that was merged into their current one (staff see them under the kept record, and the patient portal lists them); a patient's searchset says so.",
  ],
};

/** Every staff Consent searchset says what an empty result does and does not mean. */
export const CONSENT_COVERAGE_NOTE: OperationOutcomeIssue = {
  severity: "information",
  code: "informational",
  diagnostics:
    "Consent directives come from mBHR's consent register only. Apart from any that a warning in this searchset says were left out, an empty or short result means no other directive is recorded there, not that the patient agreed to, or refused, any use of their data.",
};

/**
 * The same note for a patient's own searchset. It does not claim to be
 * complete: directives filed under a record merged into the patient's are
 * not shown to the patient yet (see the header comment).
 */
export const CONSENT_COVERAGE_NOTE_PATIENT: OperationOutcomeIssue = {
  severity: "information",
  code: "informational",
  diagnostics:
    "Consent directives come from mBHR's consent register only. Directives recorded on another record of yours that was later merged into this one are not shown here yet; the privacy section of the mBHR patient portal lists them. An empty or short result does not mean that you agreed to, or refused, any use of your data.",
};

/** The searchset note for directives left out because a rule names a kind of recipient (see ACTOR_RULES_SERVED). */
export function actorRulesNote(count: number): OperationOutcomeIssue {
  return {
    severity: "warning",
    code: "incomplete",
    diagnostics: `${count} consent record(s) were left out because they have a rule for a kind of recipient (for example External system), which this server cannot show yet. They are recorded in mBHR and may allow or refuse sharing: do not read their absence as no directive.`,
  };
}

/** A read of such a directive: fails closed, and says why (no content). */
function actorRulesNotServed(): FhirError {
  return new FhirError(
    500,
    "not-supported",
    "This consent record has a rule for a kind of recipient (for example External system), which this server cannot show yet. It is recorded in mBHR and may allow or refuse sharing.",
  );
}

/** The searchset note for directives that exist but are not published. */
export function withheldNote(count: number): OperationOutcomeIssue {
  return {
    severity: "warning",
    code: "incomplete",
    diagnostics: `${count} consent record(s) were left out because they cannot be shown as FHIR R4 without inventing or changing what was recorded (for example a record that cites no policy, which FHIR requires).`,
  };
}

/** Patient ids fhir_consent_directives accepts (it refuses anything else with 22023). */
const DIRECTIVE_PATIENT_ID = /^[A-Za-z0-9._-]{1,128}$/;
/** The function's limit on patient ids per call. */
const MAX_PATIENT_IDS = 100;

interface Selection {
  /** Internal patient ids to cover; null: no patient restriction (staff reading by id). */
  patientIds: string[] | null;
  /** Consent record ids (lower-case uuids); null: any. */
  consentIds: string[] | null;
}

/**
 * The patients this request may cover: a patient caller's own records
 * (never anything else), narrowed to the patient a search names. null: no
 * restriction (staff, no patient named). An empty list matches nothing.
 *
 * A patient's own records are their current (not merged-away) records only:
 * records merged into them are invisible to the patient under row-level
 * security, so they cannot be named here or resolved to the kept record.
 * Directives filed under them are therefore not shown to patients yet (see
 * CONSENT_COVERAGE_NOTE_PATIENT and the header comment).
 */
function coveredPatients(ctx: QueryCtx): string[] | null {
  let ids: string[] | null = null;
  if (ctx.scope.kind === "patient" || ctx.restrictions.has("own_consents_only")) {
    ids = [...(ctx.scope.patientIds ?? [])];
  }
  if (ctx.patients) {
    const named = ctx.patients.ids ?? [];
    ids = ids === null ? [...named] : ids.filter((id) => named.includes(id));
  }
  return ids === null ? null : [...new Set(ids)].filter((id) => DIRECTIVE_PATIENT_ID.test(id));
}

function isRow(v: unknown): v is Row {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Up to `limit` register records after `after` (by id), as the function
 * returns them. More than 100 patient ids are asked for in groups and
 * merged in id order, so the result is the same as one call would give.
 * Records outside the selection are dropped (defence in depth: the
 * function already applies it).
 */
async function fetchDirectives(db: Postgrest, sel: Selection, after: string | null, limit: number): Promise<Row[]> {
  const groups: (string[] | null)[] = [];
  if (sel.patientIds === null) groups.push(null);
  else for (let i = 0; i < sel.patientIds.length; i += MAX_PATIENT_IDS) groups.push(sel.patientIds.slice(i, i + MAX_PATIENT_IDS));
  const byId = new Map<string, Row>();
  for (const ids of groups) {
    const raw = await db.rpc<unknown>("fhir_consent_directives", {
      p_patient_ids: ids,
      p_consent_ids: sel.consentIds,
      p_after: after,
      p_limit: limit,
    });
    if (!Array.isArray(raw)) throw errors.unavailable();
    for (const r of raw) {
      if (!isRow(r) || typeof r.id !== "string" || !UUID.test(r.id)) continue;
      const id = r.id.toLowerCase();
      if (after !== null && id <= after) continue;
      if (sel.consentIds !== null && !sel.consentIds.includes(id)) continue;
      if (sel.patientIds !== null && !(typeof r.patient_id === "string" && sel.patientIds.includes(r.patient_id))) continue;
      byId.set(id, { ...r, id });
    }
  }
  // Lower-case uuid text sorts in the database's uuid order.
  return [...byId.values()].sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1)).slice(0, limit);
}

async function mapRecords(ctx: QueryCtx, rows: Row[]): Promise<ConsentMapResult[]> {
  const refs = await referenceContext(
    ctx.db,
    rows.map((r) => r.patient_id).filter((v): v is string => typeof v === "string"),
  );
  return rows.map((r) => mapConsentRecord(r, refs));
}

async function read(ctx: QueryCtx, id: string): Promise<QueryResult> {
  if (!UUID.test(id)) return emptyResult();
  const patientIds = coveredPatients(ctx);
  if (patientIds !== null && !patientIds.length) return emptyResult();
  const rows = await fetchDirectives(ctx.db, { patientIds, consentIds: [id.toLowerCase()] }, null, 1);
  const [mapped] = await mapRecords(ctx, rows);
  if (!mapped?.resource) return emptyResult();
  // The caller may read this record (the selection above); it is only the
  // shared checker that cannot take its actor yet. Say so, with no content.
  if (!ACTOR_RULES_SERVED && hasActorRule(mapped.resource)) throw actorRulesNotServed();
  return { page: { resources: [mapped.resource], next: null }, owners: [String(rows[0].patient_id)] };
}

interface Filters {
  status: ConsentState | null;
  scope: string | null;
}

/** Whether a record matches the status / scope filters (on the published values). */
function matches(resource: Consent, f: Filters): boolean {
  if (f.status !== null && resource.status !== f.status) return false;
  if (f.scope !== null && resource.scope.coding?.[0]?.code !== f.scope) return false;
  return true;
}

/** Whether a withheld record would have matched (so the note counts only what the search asked for). */
function withheldMatches(row: Row, reason: ConsentWithheld, f: Filters): boolean {
  // A record whose patient cannot be resolved is not about the searched patient in any way we can show.
  if (reason === "no_patient" || reason === "no_id") return false;
  // The same status and scope the mapper would have published.
  if (f.status !== null && mapConsentStatus(row) !== f.status) return false;
  if (f.scope !== null && mapConsentScope(row) !== f.scope) return false;
  return true;
}

function parseFilters(search: ParsedSearch): Filters | null {
  const f: Filters = { status: null, scope: null };
  const status = one(search, "status");
  if (status) {
    const t = parseToken(status, "status");
    if (t.system !== null && t.system !== CONSENT_STATE_SYSTEM) return null;
    if (!CONSENT_STATE_CODES.includes(t.code as ConsentState)) return null;
    f.status = t.code as ConsentState;
  }
  const scope = one(search, "scope");
  if (scope) {
    const t = parseToken(scope, "scope");
    if (t.system !== null && t.system !== CONSENT_SCOPE_SYSTEM) return null;
    if (!Object.prototype.hasOwnProperty.call(CONSENT_SCOPES, t.code)) return null;
    f.scope = t.code;
  }
  return f;
}

async function search(ctx: QueryCtx, search: ParsedSearch): Promise<QueryResult> {
  const notes = patientNotes(ctx);
  const coverage = ctx.scope.kind === "patient" ? CONSENT_COVERAGE_NOTE_PATIENT : CONSENT_COVERAGE_NOTE;
  const outcomes: OperationOutcomeIssue[] = [...(notes.outcomes ?? []), coverage];
  const none = () => emptyResult({ ...notes, outcomes });
  // A named patient that cannot match (unknown, merged away, two named): nothing.
  if (ctx.patients && ctx.patients.ids === null) return none();

  const patientIds = coveredPatients(ctx);
  if (patientIds !== null && !patientIds.length) return none();
  let consentIds: string[] | null = null;
  const idParam = one(search, "_id");
  if (idParam) {
    const id = parseId(idParam);
    if (!UUID.test(id)) return none();
    consentIds = [id.toLowerCase()];
  }
  if (patientIds === null && consentIds === null) {
    // The gateway refuses a staff search that names neither (requiredSearch),
    // and a patient always has patientIds; this is the last line.
    throw errors.forbidden("A Consent search must name a specific record: give _id, or patient.");
  }
  const filters = parseFilters(search);
  if (!filters) return none();

  checkCursorKey(search.cursor, UUID);
  const count = search.count;
  const batch = Math.min(Math.max(count + 1, 25), 101);
  const out: { resource: Consent; owner: string; id: string }[] = [];
  const withheld: string[] = [];
  const actorRules: string[] = [];
  let after: string | null = search.cursor ? search.cursor.k.toLowerCase() : null;

  const finish = (next: Cursor | null): QueryResult => {
    // Count only the left-out records this page covers (before the next cursor).
    const onPage = (list: string[]) => (next ? list.filter((id) => id <= next.k).length : list.length);
    const left = onPage(withheld);
    const actorLeft = onPage(actorRules);
    const pageOutcomes = [...outcomes];
    if (left) pageOutcomes.push(withheldNote(left));
    if (actorLeft) pageOutcomes.push(actorRulesNote(actorLeft));
    return {
      page: { resources: out.map((o) => o.resource), next },
      owners: out.map((o) => o.owner),
      ...notes,
      outcomes: pageOutcomes,
    };
  };

  for (let round = 0; round < MAX_KEYSET_ROUNDS; round++) {
    const rows = await fetchDirectives(ctx.db, { patientIds, consentIds }, after, batch);
    const mapped = await mapRecords(ctx, rows);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const id = String(row.id);
      const m = mapped[i];
      if (m.resource) {
        if (matches(m.resource, filters)) {
          if (!ACTOR_RULES_SERVED && hasActorRule(m.resource)) {
            // Counted in its own note (see ACTOR_RULES_SERVED); never served without its actor.
            actorRules.push(id);
          } else {
            if (out.length === count) return finish({ k: out[out.length - 1].id });
            out.push({ resource: m.resource, owner: String(row.patient_id), id });
          }
        }
      } else if (withheldMatches(row, m.withheld, filters)) {
        withheld.push(id);
      }
      after = id;
    }
    if (rows.length < batch) return finish(null);
  }
  // Round limit reached with records possibly left: resume after the last one examined.
  return finish(after !== null ? { k: after } : null);
}

export const consentModule: ResourceModule = {
  definition,
  read,
  search,
  validate: validateConsent,
};
