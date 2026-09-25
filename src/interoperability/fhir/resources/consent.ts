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
// status and scope are filtered after mapping, on the published values,
// so a search always finds exactly what a read shows (a withdrawn record
// is inactive and never matches status=active).

import { errors } from "../errors/operationOutcome";
import type { OperationOutcomeIssue } from "../types/fhir";
import { READ_PERMISSIONS } from "../authorization/permissions";
import {
  CONSENT_SCOPES,
  CONSENT_SCOPE_SYSTEM,
  mapConsentRecord,
  mapConsentScope,
  mapConsentStatus,
  validateConsent,
  type Consent,
  type ConsentMapResult,
  type ConsentWithheld,
} from "../mappers/consent";
import type { Row } from "../mappers/common";
import { CONSENT_STATE_CODES, CONSENT_STATE_SYSTEM, type ConsentState } from "../terminology/status/consent";
import { referenceContext } from "../patients/canonical";
import { parseId, parseToken, type Cursor, type ParsedSearch } from "../search/params";
import type { Postgrest } from "../gateway/postgrest";
import { emptyResult, type QueryCtx, type QueryResult, type ResourceDefinition, type ResourceModule } from "./module";
import { MAX_KEYSET_ROUNDS, UUID, checkCursorKey, one, patientNotes } from "./shared";

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
        "Patient/[id]. Directives about this patient, including ones still filed under records merged into it. Required for staff unless _id is given.",
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
    "Staff with consult, portal_manage or audit_access may read consents; patients see only their own.",
    "A withdrawn consent is kept and published as inactive: it is never deleted and never shown as active.",
    "Who recorded, verified or withdrew a consent, the reason for a withdrawal, who signed it and its source document are never published; neither is a performer.",
    "A rule's actor names the kind of recipient recorded (for example External system), never a specific one.",
    "A consent that cites no policy (FHIR requires one) or whose rules cannot be shown without changing their meaning is not published; a searchset says how many were left out.",
    "An empty result means no directive is recorded in mBHR's consent register, not that the patient agreed to or refused any use of their data.",
  ],
};

/** Every Consent searchset says what an empty result does and does not mean. */
export const CONSENT_COVERAGE_NOTE: OperationOutcomeIssue = {
  severity: "information",
  code: "informational",
  diagnostics:
    "Consent directives come from mBHR's consent register only. An empty or short result means no other directive is recorded there, not that the patient agreed to, or refused, any use of their data.",
};

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
  const outcomes: OperationOutcomeIssue[] = [...(notes.outcomes ?? []), CONSENT_COVERAGE_NOTE];
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
  let after: string | null = search.cursor ? search.cursor.k.toLowerCase() : null;

  const finish = (next: Cursor | null): QueryResult => {
    // Count only the withheld records this page covers (before the next cursor).
    const left = next ? withheld.filter((id) => id <= next.k).length : withheld.length;
    const pageOutcomes = left ? [...outcomes, withheldNote(left)] : outcomes;
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
          if (out.length === count) return finish({ k: out[out.length - 1].id });
          out.push({ resource: m.resource, owner: String(row.patient_id), id });
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
