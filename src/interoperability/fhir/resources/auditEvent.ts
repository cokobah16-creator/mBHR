// AuditEvent <- interop.access_audit, read through
// public.fhir_access_audit_events (see mappers/auditEvent.ts for the
// mapping rules).
//
// The audit trail lives in the interop schema, which no API role can read,
// so the gateway reads it only through that database function. It answers
// callers holding audit_access only (42501 otherwise, on top of the
// gateway's own permission check), returns FHIR gateway reads and searches
// only, and always needs a narrowing selector: an id, patients, or a date
// range of at most 31 days. It pages newest first on (occurred_at, id).
//
// The function's own filters are id, patients, decision and date. The
// outcome (8 depends on the stored HTTP status), action and subtype
// parameters are checked here on the rows it returns, page by page, like
// keysetPage(): a page can come back short with a next link, but a match is
// never skipped.
//
// An AuditEvent tells its reader whose records were accessed. So the
// caller's own access audit records every patient the served events name
// (each Patient entity, and the Patient a read asked for), not only the
// patient the search named. That audit holds at most 100 patients per
// request: a page ends early, with a next link, before it would name more.

import { errors } from "../errors/operationOutcome";
import type { Reference } from "../types/fhir";
import { READ_PERMISSIONS } from "../authorization/permissions";
import { str, type Row } from "../mappers/common";
import {
  AUDIT_EVENT_ACTION,
  AUDIT_EVENT_ACTION_SYSTEM,
  AUDIT_EVENT_OUTCOME,
  AUDIT_EVENT_OUTCOME_SYSTEM,
  RESTFUL_INTERACTION_SYSTEM,
  auditEntityPatients,
  auditOutcome,
  auditOwner,
  auditPatientIds,
  canonicalMicros,
  keepPatientEntities,
  mapAuditEvent,
  staffAccountId,
  type AuditEvent,
  type AuditEventAction,
  type AuditEventOutcome,
  type EntityPatient,
} from "../mappers/auditEvent";
import { referenceContext, resolvePatients } from "../patients/canonical";
import { intersectDates, parseDateSearch, parseId, parseToken, type Cursor, type ParsedSearch } from "../search/params";
import { applyStatusMap, sourceValuesFor } from "../terminology/statusMaps";
import { isObj, type AddIssue } from "../validation/validate";
import { practitionerReferences } from "./practitioner";
import { emptyResult, type QueryCtx, type QueryResult, type ResourceDefinition, type ResourceModule } from "./module";
import { MAX_KEYSET_ROUNDS, UUID, one, patientNotes } from "./shared";

export const definition: ResourceDefinition = {
  type: "AuditEvent",
  source: "interop.access_audit (the FHIR gateway's own append-only access trail), read through public.fhir_access_audit_events",
  idStrategy: "access_audit.id (a random uuid; rows never change)",
  fields: [
    "type (audit-event-type rest)",
    "subtype (restful-interaction read or search-type)",
    "action (R for a read, E for a search)",
    "recorded (server time the request was recorded)",
    "outcome (0 permitted, 4 refused, 8 server error)",
    "outcomeDesc (the refusal reason code only)",
    "purposeOfEvent (v3 ActReason, as stated)",
    "agent (the requester: Practitioner when the staff directory resolves the account, else a display-only reference; the staff role at the time)",
    "source (display-only observer: the mBHR FHIR gateway)",
    "entity (the patients whose records were returned or named, as the canonical Patient; the resource read, or the type searched)",
  ],
  profiles: [],
  interactions: ["read", "search-type"],
  searchParams: [
    { name: "_id", type: "token", documentation: "Logical id of the resource." },
    {
      name: "patient",
      type: "reference",
      documentation:
        "Patient/[id]: requests that returned or named this patient's records, including records since merged into it.",
    },
    {
      name: "date",
      type: "date",
      documentation:
        "When the request was recorded. A date without a time is a clinic day in Africa/Lagos. Up to two bounds. Without _id or patient it must be a closed range of at most 31 days.",
      maxRepeats: 2,
    },
    {
      name: "outcome",
      type: "token",
      documentation: "0 (permitted), 4 (refused) or 8 (server error).",
    },
    { name: "action", type: "token", documentation: "R (read) or E (search)." },
    { name: "subtype", type: "token", documentation: "read or search-type (http://hl7.org/fhir/restful-interaction)." },
  ],
  requiredSearch: [["_id"], ["patient"], ["date"]],
  writeSupport: false,
  consentClass: "audit",
  readPermissions: READ_PERMISSIONS.AuditEvent,
  patientAccess: false,
  sensitiveSearch: true,
  notes: [
    "FHIR gateway reads and searches only: activity in the mBHR app itself is not in this trail.",
    "Never published: account ids, IP address hashes, user agents, request ids, search values and search parameter names.",
    "A patient whose record was deleted, or whose merge chain does not end, is left out of entity rather than named by an internal id.",
    "A refusal record is kept even when the account made it itself through the database function; a permitted access is recorded only for staff, or for a portal account about its own records.",
    "Reading AuditEvents is itself recorded against every patient the served events name. One response names at most 100 patients: a page may come back short, with a next link. A single event naming more patients than that (possible only at the 100-patient limit of one request) lists the first ones.",
    "Staff with audit_access only; not available to patients.",
  ],
};

/** The function's page limit (p_limit is clamped to 1..101). */
const MAX_LIMIT = 101;
/** p_patient_ids takes at most 100 entries. */
const MAX_PATIENT_IDS = 100;
/** The access audit records at most this many patients per request (audit/audit.ts). */
export const MAX_AUDITED_PATIENTS = 100;
/** Without an id or patient, a date range must be closed and at most this long. */
export const MAX_DATE_RANGE_MS = 31 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Keyset: (occurred_at, id), newest first
// ---------------------------------------------------------------------------

// The keyset compares exactly what the database stores (canonicalMicros): a
// millisecond value would skip rows within the same millisecond.
export { canonicalMicros };
const CANONICAL_MICROS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

interface AuditKey {
  occurred: string;
  id: string;
}

function rowKey(row: Row): AuditKey | null {
  const occurred = canonicalMicros(row.occurred_at);
  const id = typeof row.id === "string" && UUID.test(row.id) ? row.id.toLowerCase() : null;
  return occurred && id ? { occurred, id } : null;
}

function encodeKey(k: AuditKey): string {
  return `${k.occurred}|${k.id}`;
}

function decodeKey(cursor: Cursor | null): AuditKey | null {
  if (!cursor) return null;
  const [occurred, id, ...rest] = cursor.k.split("|");
  if (rest.length || !occurred || !id || !CANONICAL_MICROS.test(occurred) || !UUID.test(id) || cursor.p !== undefined || cursor.s !== undefined) {
    throw errors.badRequest("_cursor is not valid. Start the search again.");
  }
  return { occurred, id };
}

/** The exclusive upper bound as the inclusive one the function takes (one microsecond earlier). */
export function inclusiveUpper(exclusiveIso: string): string {
  return new Date(Date.parse(exclusiveIso) - 1).toISOString().replace(/Z$/, "999Z");
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

interface FunctionArgs {
  p_id: string | null;
  p_patient_ids: string[] | null;
  p_from: string | null;
  p_to: string | null;
  p_decision: string | null;
}

async function fetchRows(ctx: QueryCtx, args: FunctionArgs, after: AuditKey | null, limit: number): Promise<Row[]> {
  const rows = await ctx.db.rpc<unknown>("fhir_access_audit_events", {
    ...args,
    p_actor_source_ids: null,
    p_resource_type: null,
    p_after_occurred: after?.occurred ?? null,
    p_after_id: after?.id ?? null,
    p_limit: limit,
  });
  if (!Array.isArray(rows)) throw errors.unavailable();
  return rows.filter((r): r is Row => isObj(r));
}

/**
 * Practitioner references for the staff accounts on these rows. A lookup
 * failure leaves the requester display-only ("mBHR staff member"): the
 * record is still true, only less specific.
 */
async function staffReferences(ctx: QueryCtx, rows: Row[]): Promise<Map<string, Reference>> {
  const ids = rows.map(staffAccountId).filter((v): v is string => v !== null);
  if (!ids.length) return new Map();
  try {
    return await practitionerReferences(ctx, ids);
  } catch {
    return new Map();
  }
}

/** One served event and the patients behind it (internal ids, never published). */
export interface Mapped {
  res: AuditEvent;
  owner: string | null;
  /** The Patient entities the event names (their internal ids are never published). */
  patients: EntityPatient[];
  /** Internal id of the Patient a read asked for (the resource entity), when that record exists. */
  readPatient: string | null;
}

/**
 * Adds an event's patients to `audited`, the patients the caller's own
 * access audit will record for this request. Returns the event to serve:
 * as mapped when all its patients fit in the audit; null when they do not
 * and the page already has an event (the page ends before this one, and
 * the next page starts with it); when this is the page's first event, the
 * event naming only the patients that fit (so every page makes progress).
 */
export function fitToAudit(audited: Set<string>, m: Mapped, first: boolean): Mapped | null {
  const always = [m.owner, m.readPatient].filter((v): v is string => v !== null);
  const needed = new Set([...always, ...m.patients.flatMap((p) => p.internalIds)].filter((id) => !audited.has(id)));
  if (audited.size + needed.size <= MAX_AUDITED_PATIENTS) {
    for (const id of needed) audited.add(id);
    return m;
  }
  if (!first) return null;
  // The owner and the Patient read are always recorded (the gateway records
  // owners itself); then as many Patient entities as the audit still holds.
  for (const id of always) audited.add(id);
  const kept: EntityPatient[] = [];
  for (const p of m.patients) {
    const extra = p.internalIds.filter((id) => !audited.has(id));
    if (audited.size + extra.length > MAX_AUDITED_PATIENTS) continue;
    for (const id of extra) audited.add(id);
    kept.push(p);
  }
  return { ...m, res: keepPatientEntities(m.res, new Set(kept.map((p) => p.fhirId))), patients: kept };
}

/** The Patient id a read row asked for (lower case), or null for any other row. */
function readPatientFhirId(row: Row): string | null {
  if (applyStatusMap(AUDIT_EVENT_ACTION, row.action) !== "R" || str(row, "resource_type") !== "Patient") return null;
  const id = str(row, "resource_id");
  return id && UUID.test(id) ? id.toLowerCase() : null;
}

/** Internal ids of the Patient records that reads on these rows asked for (Patient/[id]). */
async function readPatients(ctx: QueryCtx, rows: Row[]): Promise<Map<string, string>> {
  const fhirIds = [...new Set(rows.map(readPatientFhirId).filter((id): id is string => id !== null))];
  const out = new Map<string, string>();
  if (!fhirIds.length) return out;
  for (const r of await resolvePatients(ctx.db, { fhirIds })) out.set(r.input.toLowerCase(), r.id);
  return out;
}

/** Rows the search conditions checked here (not by the function) must also meet. */
interface RowChecks {
  named: string[] | null;
  outcome: AuditEventOutcome | null;
  action: AuditEventAction | null;
  id: string | null;
  from: string | null;
  to: string | null;
}

function passes(row: Row, checks: RowChecks): boolean {
  if (checks.id !== null && String(row.id).toLowerCase() !== checks.id) return false;
  if (checks.outcome !== null && auditOutcome(row) !== checks.outcome) return false;
  if (checks.action !== null && applyStatusMap(AUDIT_EVENT_ACTION, row.action) !== checks.action) return false;
  const t = typeof row.occurred_at === "string" ? Date.parse(row.occurred_at) : NaN;
  if (checks.from !== null && !(t >= Date.parse(checks.from))) return false;
  if (checks.to !== null && !(t < Date.parse(checks.to))) return false;
  return true;
}

async function mapRows(ctx: QueryCtx, rows: Row[], checks: RowChecks): Promise<(Mapped | null)[]> {
  const [refs, staff, reads] = await Promise.all([
    referenceContext(ctx.db, rows.flatMap(auditPatientIds)),
    staffReferences(ctx, rows),
    readPatients(ctx, rows),
  ]);
  return rows.map((row) => {
    // A row the function should not have returned for this search (a
    // defence against a database that broke its contract) is not shown.
    if (!passes(row, checks)) return null;
    const owner = auditOwner(row, checks.named);
    if (checks.named && owner === null) return null;
    const res = mapAuditEvent(row, refs, staff);
    if (!res) return null;
    const readId = readPatientFhirId(row);
    return {
      res,
      owner,
      patients: auditEntityPatients(row, refs),
      readPatient: readId !== null ? (reads.get(readId) ?? null) : null,
    };
  });
}

const NO_CHECKS: RowChecks = { named: null, outcome: null, action: null, id: null, from: null, to: null };

async function read(ctx: QueryCtx, id: string): Promise<QueryResult> {
  if (ctx.scope.kind !== "staff") throw errors.forbidden();
  if (!UUID.test(id)) return emptyResult();
  const args: FunctionArgs = { p_id: id.toLowerCase(), p_patient_ids: null, p_from: null, p_to: null, p_decision: null };
  const rows = await fetchRows(ctx, args, null, 1);
  const [found] = (await mapRows(ctx, rows, { ...NO_CHECKS, id: id.toLowerCase() })).filter((m): m is Mapped => m !== null);
  if (!found) return emptyResult();
  const audited = new Set<string>();
  const m = fitToAudit(audited, found, true) as Mapped;
  return { page: { resources: [m.res], next: null }, owners: [m.owner], requestedPatientIds: [...audited] };
}

/** outcome=: a code of the value set, or 400. */
function parseOutcome(raw: string): AuditEventOutcome {
  const t = parseToken(raw, "outcome");
  if ((t.system !== null && t.system !== AUDIT_EVENT_OUTCOME_SYSTEM) || !["0", "4", "8", "12"].includes(t.code)) {
    throw errors.badRequest("outcome must be 0, 4, 8 or 12.");
  }
  return t.code as AuditEventOutcome;
}

/** action= (R, E) or subtype= (read, search-type): the recorded action, or 400. */
function parseAction(search: ParsedSearch): { action: AuditEventAction | null; empty: boolean } {
  let action: AuditEventAction | null = null;
  let empty = false;
  const a = one(search, "action");
  if (a) {
    const t = parseToken(a, "action");
    if ((t.system !== null && t.system !== AUDIT_EVENT_ACTION_SYSTEM) || !["C", "R", "U", "D", "E"].includes(t.code)) {
      throw errors.badRequest("action must be C, R, U, D or E.");
    }
    if (t.code === "R" || t.code === "E") action = t.code;
    else empty = true; // never recorded by the gateway
  }
  const s = one(search, "subtype");
  if (s) {
    const t = parseToken(s, "subtype");
    if (t.system !== null && t.system !== RESTFUL_INTERACTION_SYSTEM) {
      throw errors.badRequest("subtype must be a restful-interaction code.");
    }
    const fromSubtype: AuditEventAction | null = t.code === "read" ? "R" : t.code === "search-type" ? "E" : null;
    if (fromSubtype === null) empty = true;
    else if (action !== null && action !== fromSubtype) empty = true;
    else action = fromSubtype;
  }
  return { action, empty };
}

async function search(ctx: QueryCtx, search: ParsedSearch): Promise<QueryResult> {
  if (ctx.scope.kind !== "staff") throw errors.forbidden();
  const notes = patientNotes(ctx);
  if (ctx.patients && ctx.patients.ids === null) return emptyResult(notes);
  const named = ctx.patients?.ids ?? null;
  if (named && named.length > MAX_PATIENT_IDS) {
    throw errors.notSupported("This patient has too many merged records to search in one request.");
  }

  const idParam = one(search, "_id");
  const id = idParam !== undefined ? parseId(idParam).toLowerCase() : null;
  if (id !== null && !UUID.test(id)) return emptyResult(notes);

  const rawDates = search.values.get("date");
  const range = rawDates?.length ? intersectDates(rawDates.map((r) => parseDateSearch(r, "date"))) : { from: null, to: null };
  if (id === null && named === null) {
    // Anti-enumeration: a date range alone must be closed and short.
    const closed = range.from !== null && range.to !== null;
    if (!closed || Date.parse(range.to as string) - Date.parse(range.from as string) > MAX_DATE_RANGE_MS) {
      throw errors.forbidden(
        "An AuditEvent search by date alone needs a closed range of at most 31 days (for example date=ge2026-09-01&date=lt2026-10-01), or give _id or patient.",
      );
    }
  }
  if (range.from !== null && range.to !== null && range.from >= range.to) return emptyResult(notes);

  const outcomeParam = one(search, "outcome");
  const outcome = outcomeParam !== undefined ? parseOutcome(outcomeParam) : null;
  const { action, empty } = parseAction(search);
  // 12 (major failure) is never recorded; nor are actions other than R and E.
  if (outcome === "12" || empty) return emptyResult(notes);
  // 0 and 4 each come from one decision; 8 from either (a server error).
  const decisions = outcome === "0" || outcome === "4" ? sourceValuesFor(AUDIT_EVENT_OUTCOME, outcome) : [];

  const args: FunctionArgs = {
    p_id: id,
    p_patient_ids: named,
    p_from: range.from,
    p_to: range.to !== null ? inclusiveUpper(range.to) : null,
    p_decision: decisions.length === 1 ? decisions[0] : null,
  };
  const checks: RowChecks = { named, outcome, action, id, from: range.from, to: range.to };

  // The patients the gateway records anyway (the one the search named).
  const audited = new Set(notes.requestedPatientIds ?? []);
  const { items, next } = await auditPage(ctx, args, checks, search.count, decodeKey(search.cursor), audited);
  return {
    page: { resources: items.map((m) => m.res), next },
    owners: items.map((m) => m.owner),
    ...notes,
    requestedPatientIds: [...audited],
  };
}

/**
 * Keyset paging over the function (newest first), as keysetPage() does for
 * tables: when rows keep failing the checks, fetching stops after
 * MAX_KEYSET_ROUNDS batches and the page is returned short WITH a next link
 * that resumes after the last row examined, so a later match is never lost.
 * A page also ends early when the next event would name more patients than
 * the access audit can record (`audited`, which gains every patient served).
 */
async function auditPage(
  ctx: QueryCtx,
  args: FunctionArgs,
  checks: RowChecks,
  count: number,
  start: AuditKey | null,
  audited: Set<string>,
): Promise<{ items: Mapped[]; next: Cursor | null }> {
  const batch = Math.min(Math.max(count + 1, 25), MAX_LIMIT);
  const out: { m: Mapped; key: AuditKey }[] = [];
  const finish = (next: AuditKey | null) => ({ items: out.map((o) => o.m), next: next ? { k: encodeKey(next) } : null });
  let after = start;
  for (let round = 0; round < MAX_KEYSET_ROUNDS; round++) {
    const rows = await fetchRows(ctx, args, after, batch);
    const mapped = await mapRows(ctx, rows, checks);
    for (let i = 0; i < rows.length; i++) {
      const key = rowKey(rows[i]);
      // Without a usable key the search cannot be resumed after this row.
      if (!key) throw errors.unavailable();
      const m = mapped[i];
      if (m) {
        // Another match exists: the page is full, resume after its last entry.
        if (out.length === count) return finish(out[out.length - 1].key);
        const served = fitToAudit(audited, m, out.length === 0);
        // Its patients would not all be recorded: the next page starts with it.
        if (!served) return finish(out[out.length - 1].key);
        out.push({ m: served, key });
      }
      after = key;
    }
    if (rows.length < batch) return finish(null);
  }
  return finish(after);
}

/** Structural rules on top of validation/validate.ts. */
function validate(resource: Record<string, unknown>, add: AddIssue): void {
  const type = resource.type;
  if (!isObj(type) || typeof type.system !== "string" || typeof type.code !== "string") add("type", "required");
  if (typeof resource.recorded !== "string") add("recorded", "required");
  if (resource.action !== undefined && !["C", "R", "U", "D", "E"].includes(resource.action as string)) add("action", "invalid");
  if (resource.outcome !== undefined && !["0", "4", "8", "12"].includes(resource.outcome as string)) add("outcome", "invalid");
  if (resource.outcomeDesc !== undefined && resource.outcome === "0") add("outcomeDesc", "only for a failure");
  if (resource.outcomeDesc !== undefined && !/^[a-z][a-z0-9_]{0,63}$/.test(String(resource.outcomeDesc))) {
    add("outcomeDesc", "a reason code only, never free text");
  }
  const agents = resource.agent;
  if (!Array.isArray(agents) || agents.length === 0) add("agent", "at least one agent is required");
  else {
    agents.forEach((a, i) => {
      if (!isObj(a) || typeof a.requestor !== "boolean") add(`agent[${i}].requestor`, "required");
      else {
        const who = a.who;
        if (!isObj(who) || (typeof who.reference !== "string" && typeof who.display !== "string")) {
          add(`agent[${i}].who`, "a reference or a display is required");
        } else if (typeof who.reference === "string" && !who.reference.startsWith("Practitioner/")) {
          add(`agent[${i}].who`, "only a Practitioner reference is published");
        }
        // Never published: account ids, addresses, device or network data.
        for (const k of ["altId", "network", "name", "location", "media", "policy"]) {
          if (a[k] !== undefined) add(`agent[${i}].${k}`, "not published");
        }
        if (isObj(who) && who.identifier !== undefined) add(`agent[${i}].who.identifier`, "not published");
      }
    });
  }
  const source = resource.source;
  if (!isObj(source) || !isObj(source.observer)) add("source.observer", "required");
  const entities = resource.entity;
  if (Array.isArray(entities)) {
    entities.forEach((e, i) => {
      // Search values are never published.
      if (isObj(e) && (e.query !== undefined || e.name !== undefined || e.description !== undefined)) {
        add(`entity[${i}]`, "query, name and description are not published");
      }
    });
  }
}

export const auditEventModule: ResourceModule = { definition, read, search, validate };
