// Provenance <- server-attributed mBHR events (see mappers/provenance.ts for
// the mapping rules): laboratory result review, release and withhold
// (public.lab_result_release_log), patient merges written by
// merge_patients() (public.patient_merges), and document uploads
// (public.patient_documents).
//
// A search runs over the three sources in turn, each in its own keyset
// order (like Observation over vital signs and laboratory results): the
// cursor records which source the page stopped in (p = "l", "m" or "d").
// A search whose _id or target can only match one source reads only that
// one. Staff with lab_review but not audit_access (restriction
// "lab_events_only") read the laboratory events only, and only by _id,
// target or patient: a recorded range alone would list the laboratory
// reports of every patient.
//
// Every source is read as the caller, so row-level security applies on top
// (the release log needs lab_review or audit_access; merges need
// merge_patients or audit_access). The gateway lets only audit_access and
// lab_review holders reach this module, and refuses patients.

import { errors } from "../errors/operationOutcome";
import type { Reference } from "../types/fhir";
import { READ_PERMISSIONS } from "../authorization/permissions";
import { instant, str, type Row } from "../mappers/common";
import {
  LAB_EVENT_ACTIVITY,
  LAB_EVENT_COLUMNS,
  LAB_ORDER_LINK_COLUMNS,
  LAB_RESULT_LINK_COLUMNS,
  MERGE_ACTIVITY,
  MERGE_EVENT_COLUMNS,
  UPLOAD_EVENT_COLUMNS,
  mapDocumentUploadEvent,
  mapLabReleaseEvent,
  mapMergeEvent,
  parseProvenanceId,
  type LabEventLinks,
  type Provenance,
} from "../mappers/provenance";
import { referenceContext, resolvePatients } from "../patients/canonical";
import { inList, pgrstQuote, type ReadableTable } from "../gateway/postgrest";
import { intersectDates, parseDateSearch, parseId, type Cursor, type ParsedSearch } from "../search/params";
import { knownSourceValues, sourceValuesFor } from "../terminology/statusMaps";
import { isObj, type AddIssue } from "../validation/validate";
import { LAB_OBSERVATION_PREFIX } from "./labObservation";
import { practitionerReferences } from "./practitioner";
import { emptyResult, type QueryCtx, type QueryResult, type ResourceDefinition, type ResourceModule } from "./module";
import {
  MAX_KEYSET_ROUNDS,
  SOURCE_ID,
  UUID,
  dateFilters,
  likeLiteral,
  namedPatientFilter,
  one,
  patientNotes,
  scopeFilter,
  type Filters,
} from "./shared";

export const definition: ResourceDefinition = {
  type: "Provenance",
  source:
    "Server-attributed events only: public.lab_result_release_log (a laboratory result reviewed, released to or withheld from the patient portal), public.patient_merges rows written by merge_patients() (a duplicate record merged), public.patient_documents (a document stored)",
  idStrategy:
    "Derived and stable: labrel-<lab_result_release_log.id>, merge-<patient_merges.id>, docup-<patient_documents.id>",
  fields: [
    "target (laboratory events: the result Observation lab-<id> and its DiagnosticReport; merges: the kept and the merged-away Patient; uploads: the DocumentReference)",
    "recorded (the server time the event was stored)",
    "activity (local provenance-activity code: lab-review, lab-release, lab-withhold, patient-merge; an upload is v3-DataOperation CREATE)",
    "agent (a Practitioner when the staff directory resolves the account the server stamped, else display-only; type verifier for a review only)",
    "entity (merges: the merged-away Patient, role source)",
  ],
  profiles: [],
  interactions: ["read", "search-type"],
  searchParams: [
    { name: "_id", type: "token", documentation: "Logical id of the resource." },
    {
      name: "target",
      type: "reference",
      documentation:
        "Observation/lab-[id], DiagnosticReport/[id], Patient/[id] or DocumentReference/[id]: events about exactly that record.",
    },
    {
      name: "patient",
      type: "reference",
      documentation:
        "Patient/[id]: events about this patient's records (merges into the record, and laboratory result and document events), including records since merged into it. Wider than the R4 definition, which matches Patient targets only.",
    },
    {
      name: "recorded",
      type: "date",
      documentation:
        "When the event was stored (server time). A date without a time is a clinic day in Africa/Lagos. Up to two bounds. Without _id, target or patient it needs audit_access and a closed range of at most 31 days.",
      maxRepeats: 2,
    },
  ],
  requiredSearch: [["_id"], ["target"], ["patient"], ["recorded"]],
  writeSupport: false,
  consentClass: "audit",
  readPermissions: READ_PERMISSIONS.Provenance,
  patientAccess: false,
  sensitiveSearch: true,
  notes: [
    "Only events the database records itself: laboratory result review, release and withhold; merges made by the server-side merge function; document uploads. Visits, vital signs, consultations, prescriptions, dispenses, allergies and conditions have no server-verified author and get no Provenance: an empty result does not mean nothing changed.",
    "Staff with lab_review but not audit_access see laboratory events only, and must give _id, target or patient (a recorded range alone is refused).",
    "A review or release is published only while it still stands: when a reviewed result's value, unit, range or interpretation changes, its review and release are cleared and the earlier events are left out (a withhold stays, as the result stays off the portal).",
    "Merges recorded before the server-side merge function (no server-stamped actor) are not published.",
    "Document uploads name no person: 'Patient portal account' for a portal upload, otherwise 'mBHR account' (documents stored before the ownership change are all marked clinic records, whoever uploaded them). Removed documents are left out.",
    "Events of a laboratory result that a newer result replaced are left out, like the result itself.",
    "Never published: withhold reasons, merge snapshots, who asked for a merge on the tablet, account ids, device ids, storage paths.",
    "Staff only; not available to patients.",
  ],
};

// ---------------------------------------------------------------------------
// Search plan
// ---------------------------------------------------------------------------

type Phase = "l" | "m" | "d";
const PHASES: readonly Phase[] = ["l", "m", "d"];
/** Cursor key for "start of this source" (a "|" never appears in a key). */
const START = "|start";
/** Rows of lab_orders / lab_results one patient search may cover. */
export const MAX_LAB_SCOPE = 1000;
/** Ids per in.(...) list: keeps request URLs short. */
const CHUNK = 100;
/** Without _id, target or patient, a recorded range must be closed and at most this long. */
export const MAX_RECORDED_RANGE_MS = 31 * 24 * 60 * 60 * 1000;

interface Plan {
  phases: Set<Phase>;
  logId?: string;
  mergeId?: string;
  docId?: string;
  resultId?: string;
  orderId?: string;
  /** target=Patient/[id]: that record's published id. */
  targetPatientFhirId?: string;
  recorded?: string[];
}

function only(plan: Plan, phase: Phase): void {
  plan.phases = new Set([...plan.phases].filter((p) => p === phase));
}

/** Set a source id the search names; two different values match nothing. */
function pin(plan: Plan, field: "logId" | "mergeId" | "docId" | "resultId" | "orderId" | "targetPatientFhirId", value: string): void {
  const current = plan[field];
  if (current !== undefined && current !== value) plan.phases = new Set();
  else plan[field] = value;
}

const TARGET = /^([A-Z][A-Za-z]{1,63})\/([A-Za-z0-9\-.]{1,64})$/;

function applyTarget(plan: Plan, raw: string): void {
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    throw errors.notSupported("target must reference a record as [type]/[id].");
  }
  const m = TARGET.exec(raw);
  if (!m) throw errors.badRequest("target must be a reference of the form [type]/[id].");
  const [, type, id] = m;
  if (type === "Observation" && id.startsWith(LAB_OBSERVATION_PREFIX) && UUID.test(id.slice(LAB_OBSERVATION_PREFIX.length))) {
    only(plan, "l");
    pin(plan, "resultId", id.slice(LAB_OBSERVATION_PREFIX.length).toLowerCase());
  } else if (type === "DiagnosticReport" && UUID.test(id)) {
    only(plan, "l");
    pin(plan, "orderId", id.toLowerCase());
  } else if (type === "Patient") {
    only(plan, "m");
    pin(plan, "targetPatientFhirId", id);
  } else if (type === "DocumentReference" && UUID.test(id)) {
    only(plan, "d");
    pin(plan, "docId", id.toLowerCase());
  } else {
    // No Provenance is recorded for any other record (vital signs, visits, ...).
    plan.phases = new Set();
  }
}

function applyId(plan: Plan, raw: string): void {
  const parsed = parseProvenanceId(parseId(raw));
  if (!parsed) {
    plan.phases = new Set();
    return;
  }
  if (parsed.kind === "lab") {
    only(plan, "l");
    pin(plan, "logId", parsed.sourceId.toLowerCase());
  } else if (parsed.kind === "merge") {
    only(plan, "m");
    pin(plan, "mergeId", parsed.sourceId);
  } else {
    only(plan, "d");
    pin(plan, "docId", parsed.sourceId.toLowerCase());
  }
}

function buildPlan(ctx: QueryCtx, search: ParsedSearch): Plan {
  const plan: Plan = { phases: new Set(PHASES), recorded: search.values.get("recorded") };
  const idParam = one(search, "_id");
  const target = one(search, "target");
  if (idParam) applyId(plan, idParam);
  if (target) applyTarget(plan, target);
  if (ctx.restrictions.has("lab_events_only")) only(plan, "l");

  const range = plan.recorded?.length ? intersectDates(plan.recorded.map((r) => parseDateSearch(r, "recorded"))) : null;
  if (!idParam && !target && !ctx.patients) {
    // Anti-enumeration. A recorded range alone lists events of every
    // patient, and each laboratory event names a DiagnosticReport: that is
    // an audit tool, for audit_access holders only. A lab_review holder
    // names a patient or a record, as for DiagnosticReport itself.
    if (ctx.restrictions.has("lab_events_only")) {
      throw errors.forbidden(
        "A Provenance search by recorded alone needs audit_access. Give _id, target or patient.",
      );
    }
    // And it must be closed and short.
    const closed = range !== null && range.from !== null && range.to !== null;
    if (!closed || Date.parse(range.to as string) - Date.parse(range.from as string) > MAX_RECORDED_RANGE_MS) {
      throw errors.forbidden(
        "A Provenance search by recorded alone needs a closed range of at most 31 days (for example recorded=ge2026-09-01&recorded=lt2026-10-01), or give _id, target or patient.",
      );
    }
  }
  if (range && range.from !== null && range.to !== null && range.from >= range.to) plan.phases = new Set();
  return plan;
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

interface Item {
  res: Provenance;
  /** Internal patients.id the event is about (never published). */
  owner: string;
}

interface Source {
  phase: Phase;
  /** Keys a cursor may carry for this source. */
  keyPattern: RegExp;
  /** Rows after `after` (exclusive), in key order. */
  fetch(after: string | null, limit: number): Promise<Row[]>;
  /** One entry per row: the Provenance and its patient, or null (withheld). */
  map(rows: Row[]): Promise<(Item | null)[]>;
}

function uniqueStrings(values: unknown[], pattern: RegExp): string[] {
  return [...new Set(values.filter((v): v is string => typeof v === "string" && pattern.test(v)))];
}

function byKey(a: Row, b: Row): number {
  const x = String(a.id);
  const y = String(b.id);
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * Practitioner references for server-stamped account ids. A lookup failure
 * leaves the agent display-only ("mBHR staff member"): the record is still
 * true, only less specific.
 */
async function staffReferences(ctx: QueryCtx, accountIds: unknown[]): Promise<Map<string, Reference>> {
  const ids = uniqueStrings(accountIds, SOURCE_ID);
  if (!ids.length) return new Map();
  try {
    return await practitionerReferences(ctx, ids);
  } catch {
    return new Map();
  }
}

/** Every id of `table` matching `filters`, in id order; refuses more than `max`. */
async function collectIds(ctx: QueryCtx, table: ReadableTable, filters: Filters, max: number): Promise<string[]> {
  const out: string[] = [];
  const batch = 1000;
  let after: string | null = null;
  for (;;) {
    const f: Filters = after !== null ? [...filters, ["id", `gt.${after}`]] : [...filters];
    const rows = await ctx.db.select(table, ["id"], f, { order: "id.asc", limit: batch });
    for (const r of rows) {
      if (typeof r.id === "string" && UUID.test(r.id)) out.push(r.id.toLowerCase());
      after = String(r.id);
    }
    if (out.length > max) {
      throw errors.notSupported(
        "This patient has more laboratory results than one Provenance search can cover: search by target (a DiagnosticReport or laboratory Observation) instead.",
      );
    }
    if (rows.length < batch) return out;
  }
}

/**
 * The laboratory results a search is limited to: null for no limit, or the
 * current results of the named order and/or the named patient's orders
 * (canonical record plus merged-away members), in the database query.
 */
async function labScope(ctx: QueryCtx, plan: Plan): Promise<string[] | null> {
  const named = namedPatientFilter(ctx);
  if (named === null) return [];
  if (!plan.orderId && !ctx.patients) return plan.resultId ? [plan.resultId] : null;
  const orderFilters: Filters = [...scopeFilter(ctx), ...named];
  if (plan.orderId) orderFilters.push(["id", `eq.${plan.orderId}`]);
  const orders = await collectIds(ctx, "lab_orders", orderFilters, MAX_LAB_SCOPE);
  const results: string[] = [];
  for (let i = 0; i < orders.length; i += CHUNK) {
    const f: Filters = [["order_id", inList(orders.slice(i, i + CHUNK))], ["superseded_by", "is.null"]];
    if (plan.resultId) f.push(["id", `eq.${plan.resultId}`]);
    results.push(...(await collectIds(ctx, "lab_results", f, MAX_LAB_SCOPE - results.length)));
  }
  return results;
}

function labSource(ctx: QueryCtx, plan: Plan, scope: string[] | null): Source {
  const actions = knownSourceValues(LAB_EVENT_ACTIVITY);
  const base: Filters = [
    // Only actions the map knows (the CHECK allows no others): search and mapping agree.
    ["or", `(${actions.map((v) => `action.ilike.${pgrstQuote(likeLiteral(v))}`).join(",")})`],
    ...dateFilters("created_at", plan.recorded, "recorded"),
  ];
  if (plan.logId) base.push(["id", `eq.${plan.logId}`]);
  const select = (filters: Filters, after: string | null, limit: number) =>
    ctx.db.select("lab_result_release_log", LAB_EVENT_COLUMNS, after !== null ? [...filters, ["id", `gt.${after}`]] : filters, {
      order: "id.asc",
      limit,
    });
  return {
    phase: "l",
    keyPattern: UUID,
    async fetch(after, limit) {
      if (scope === null) return select(base, after, limit);
      // Each chunk's first rows, merged: the union holds the first `limit` overall.
      const rows: Row[] = [];
      for (let i = 0; i < scope.length; i += CHUNK) {
        rows.push(...(await select([...base, ["result_id", inList(scope.slice(i, i + CHUNK))]], after, limit)));
      }
      return rows.sort(byKey).slice(0, limit);
    },
    map: (rows) => mapLabRows(ctx, rows),
  };
}

async function mapLabRows(ctx: QueryCtx, rows: Row[]): Promise<(Item | null)[]> {
  const named = namedPatientFilter(ctx);
  if (named === null || !rows.length) return rows.map(() => null);
  const resultIds = uniqueStrings(rows.map((r) => r.result_id), UUID);
  const results = resultIds.length
    ? await ctx.db.select("lab_results", LAB_RESULT_LINK_COLUMNS, [["id", inList(resultIds)]], { limit: resultIds.length })
    : [];
  const orderIds = uniqueStrings(results.map((r) => r.order_id), UUID);
  // The order's patient, within the caller's scope and the named patient.
  const orders = orderIds.length
    ? await ctx.db.select(
        "lab_orders",
        LAB_ORDER_LINK_COLUMNS,
        [["id", inList(orderIds)], ...scopeFilter(ctx), ...named],
        { limit: orderIds.length },
      )
    : [];
  const orderPatient = new Map<string, string>();
  for (const o of orders) {
    const id = str(o, "id");
    if (id && typeof o.patient_id === "string") orderPatient.set(id, o.patient_id);
  }
  const links = new Map<string, LabEventLinks>();
  for (const r of results) {
    const id = str(r, "id");
    const orderId = str(r, "order_id");
    const patientId = orderId ? orderPatient.get(orderId) : undefined;
    if (id && orderId && patientId) {
      const amended = r.amended_at;
      links.set(id, {
        orderId,
        current: r.superseded_by === null || r.superseded_by === undefined,
        patientId,
        reviewed: instant(r, "reviewed_at") !== undefined,
        // Anything stored that is not a time still counts as an amendment (at an unknown time).
        amendedAt: amended === null || amended === undefined ? null : String(amended),
      });
    }
  }
  const [refs, staff] = await Promise.all([
    referenceContext(ctx.db, [...orderPatient.values()]),
    staffReferences(ctx, rows.map((r) => r.actor_id)),
  ]);
  return rows.map((row) => {
    const link = typeof row.result_id === "string" ? links.get(row.result_id) : undefined;
    const res = mapLabReleaseEvent(row, link, refs, staff);
    return res && link ? { res, owner: link.patientId } : null;
  });
}

function mergeSource(ctx: QueryCtx, plan: Plan, named: Filters, targetPatient: string | null): Source {
  const kinds = sourceValuesFor(MERGE_ACTIVITY, "patient-merge");
  const base: Filters = [
    // Written by merge_patients(): the actor is stamped by the server.
    ["actor_id", "not.is.null"],
    ["or", `(${kinds.map((v) => `kind.ilike.${pgrstQuote(likeLiteral(v))}`).join(",")})`],
    ...dateFilters("created_at", plan.recorded, "recorded"),
    ...scopeFilter(ctx, "winner_id"),
    ...named,
  ];
  if (plan.mergeId) base.push(["id", `eq.${plan.mergeId}`]);
  if (targetPatient !== null) {
    base.push(["or", `(winner_id.eq.${pgrstQuote(targetPatient)},loser_id.eq.${pgrstQuote(targetPatient)})`]);
  }
  return {
    phase: "m",
    keyPattern: SOURCE_ID,
    fetch: (after, limit) =>
      ctx.db.select("patient_merges", MERGE_EVENT_COLUMNS, after !== null ? [...base, ["id", `gt.${after}`]] : base, {
        order: "id.asc",
        limit,
      }),
    map: (rows) => mapMergeRows(ctx, rows),
  };
}

async function mapMergeRows(ctx: QueryCtx, rows: Row[]): Promise<(Item | null)[]> {
  if (!rows.length) return [];
  const ids = uniqueStrings(rows.flatMap((r) => [r.winner_id, r.loser_id]), SOURCE_ID);
  // Each record's own published id, for records whose merge chain ends.
  const own = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    for (const r of await resolvePatients(ctx.db, { ids: ids.slice(i, i + 200) })) {
      if (r.chainOk) own.set(r.input, r.fhirId);
    }
  }
  const staff = await staffReferences(ctx, rows.map((r) => r.actor_id));
  return rows.map((row) => {
    const res = mapMergeEvent(row, own, staff);
    return res && typeof row.winner_id === "string" ? { res, owner: row.winner_id } : null;
  });
}

function uploadSource(ctx: QueryCtx, plan: Plan, named: Filters): Source {
  const base: Filters = [
    // Removed documents are not published as DocumentReference either.
    ["deleted_at", "is.null"],
    ...dateFilters("created_at", plan.recorded, "recorded"),
    ...scopeFilter(ctx),
    ...named,
  ];
  if (plan.docId) base.push(["id", `eq.${plan.docId}`]);
  return {
    phase: "d",
    keyPattern: UUID,
    fetch: (after, limit) =>
      ctx.db.select("patient_documents", UPLOAD_EVENT_COLUMNS, after !== null ? [...base, ["id", `gt.${after}`]] : base, {
        order: "id.asc",
        limit,
      }),
    async map(rows) {
      const refs = await referenceContext(
        ctx.db,
        rows.map((r) => r.patient_id).filter((v): v is string => typeof v === "string"),
      );
      return rows.map((row) => {
        const res = mapDocumentUploadEvent(row, refs);
        return res && typeof row.patient_id === "string" ? { res, owner: row.patient_id } : null;
      });
    },
  };
}

/**
 * The source for a phase, or null when it can match nothing (the named
 * patient or the target record does not resolve).
 */
async function makeSource(ctx: QueryCtx, plan: Plan, phase: Phase, targetPatient: string | null): Promise<Source | null> {
  if (phase === "l") return labSource(ctx, plan, await labScope(ctx, plan));
  const named = namedPatientFilter(ctx, phase === "m" ? "winner_id" : "patient_id");
  if (named === null) return null;
  if (phase === "m") {
    if (plan.targetPatientFhirId !== undefined && targetPatient === null) return null;
    return mergeSource(ctx, plan, named, targetPatient);
  }
  return uploadSource(ctx, plan, named);
}

/**
 * Keyset paging within one source, as keysetPage() does: when rows keep
 * being withheld, fetching stops after MAX_KEYSET_ROUNDS batches and the
 * page is returned short WITH a key that resumes after the last row
 * examined, so a later match is never lost.
 */
async function phasePage(source: Source, start: string | null, count: number): Promise<{ items: Item[]; next: string | null }> {
  const batch = Math.min(Math.max(count + 1, 25), 101);
  const out: { item: Item; key: string }[] = [];
  const items = () => out.map((o) => o.item);
  let after = start;
  // The last key a cursor can carry (a row id outside keyPattern cannot).
  let resumable = start;
  for (let round = 0; round < MAX_KEYSET_ROUNDS; round++) {
    const rows = await source.fetch(after, batch);
    const mapped = await source.map(rows);
    for (let i = 0; i < rows.length; i++) {
      const key = String(rows[i].id);
      const item = mapped[i];
      if (item) {
        // Another match exists: the page is full, resume after its last entry.
        if (out.length === count) return { items: items(), next: out[out.length - 1].key };
        out.push({ item, key });
      }
      after = key;
      if (source.keyPattern.test(key)) resumable = key;
    }
    if (rows.length < batch) return { items: items(), next: null };
  }
  // A resume key that does not move forward would repeat this page forever.
  if (resumable === null || resumable === start) throw errors.unavailable();
  return { items: items(), next: resumable };
}

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------

function assertStaff(ctx: QueryCtx): void {
  if (ctx.scope.kind !== "staff") throw errors.forbidden();
}

async function read(ctx: QueryCtx, id: string): Promise<QueryResult> {
  assertStaff(ctx);
  const plan: Plan = { phases: new Set(PHASES) };
  applyId(plan, id);
  if (ctx.restrictions.has("lab_events_only")) only(plan, "l");
  const [phase] = [...plan.phases];
  if (!phase) return emptyResult();
  const source = await makeSource(ctx, plan, phase, null);
  if (!source) return emptyResult();
  const rows = await source.fetch(null, 2);
  const hit = (await source.map(rows)).find((m) => m !== null && m.res.id === id);
  return hit ? { page: { resources: [hit.res], next: null }, owners: [hit.owner] } : emptyResult();
}

async function search(ctx: QueryCtx, search: ParsedSearch): Promise<QueryResult> {
  assertStaff(ctx);
  const notes = patientNotes(ctx);
  const extra: Pick<QueryResult, "outcomes" | "requestedPatientIds"> = { ...notes };
  if (ctx.patients && ctx.patients.ids === null) return emptyResult(extra);
  const plan = buildPlan(ctx, search);

  // target=Patient/[id]: exactly that record (merged-away or not), which the
  // access audit records as named.
  let targetPatient: string | null = null;
  if (plan.targetPatientFhirId !== undefined && plan.phases.has("m")) {
    const [res] = await resolvePatients(ctx.db, { fhirIds: [plan.targetPatientFhirId] });
    if (res) {
      targetPatient = res.id;
      extra.requestedPatientIds = [...new Set([...(extra.requestedPatientIds ?? []), res.id])];
    } else {
      plan.phases.delete("m");
    }
  }

  const phases = PHASES.filter((p) => plan.phases.has(p));
  if (!phases.length) return emptyResult(extra);

  const cursor: Cursor | null = search.cursor;
  const bad = () => errors.badRequest("_cursor is not valid. Start the search again.");
  let index = cursor ? phases.indexOf(cursor.p as Phase) : 0;
  if (index < 0 || (cursor && cursor.s !== undefined)) throw bad();
  let after: string | null = null;
  if (cursor && cursor.k !== START) {
    if (!(cursor.p === "m" ? SOURCE_ID : UUID).test(cursor.k)) throw bad();
    after = cursor.k;
  }

  const resources: Provenance[] = [];
  const owners: (string | null)[] = [];
  let next: Cursor | null = null;
  let remaining = search.count;
  for (; index < phases.length; index++) {
    const phase = phases[index];
    const source = await makeSource(ctx, plan, phase, targetPatient);
    if (source) {
      const r = await phasePage(source, after, remaining);
      for (const item of r.items) {
        resources.push(item.res);
        owners.push(item.owner);
      }
      remaining -= r.items.length;
      if (r.next !== null) {
        next = { k: r.next, p: phase };
        break;
      }
    }
    after = null;
    if (index + 1 < phases.length && remaining === 0) {
      next = { k: START, p: phases[index + 1] };
      break;
    }
  }
  return { page: { resources, next }, owners, ...extra };
}

/** Structural rules on top of validation/validate.ts. */
function validate(resource: Record<string, unknown>, add: AddIssue): void {
  if (typeof resource.id !== "string" || !parseProvenanceId(resource.id)) add("id", "not an id this server derives");
  const target = resource.target;
  if (!Array.isArray(target) || target.length === 0) add("target", "at least one target is required");
  else {
    target.forEach((t, i) => {
      if (!isObj(t) || typeof t.reference !== "string") add(`target[${i}]`, "a reference is required");
    });
  }
  if (typeof resource.recorded !== "string") add("recorded", "required");
  const agents = resource.agent;
  if (!Array.isArray(agents) || agents.length === 0) add("agent", "at least one agent is required");
  else {
    agents.forEach((a, i) => {
      const who = isObj(a) ? a.who : undefined;
      if (!isObj(who) || (typeof who.reference !== "string" && typeof who.display !== "string")) {
        add(`agent[${i}].who`, "required (a reference or a display)");
      } else {
        if (typeof who.reference === "string" && !who.reference.startsWith("Practitioner/")) {
          add(`agent[${i}].who`, "only a Practitioner reference is published");
        }
        if (who.identifier !== undefined) add(`agent[${i}].who.identifier`, "account ids are never published");
      }
      if (isObj(a) && a.onBehalfOf !== undefined) add(`agent[${i}].onBehalfOf`, "not published");
    });
  }
  const entities = resource.entity;
  if (entities !== undefined) {
    if (!Array.isArray(entities)) add("entity", "must be a list");
    else {
      entities.forEach((e, i) => {
        if (!isObj(e) || !["derivation", "revision", "quotation", "source", "removal"].includes(e.role as string)) {
          add(`entity[${i}].role`, "invalid");
        }
        if (!isObj(e) || !isObj(e.what) || typeof e.what.reference !== "string") add(`entity[${i}].what`, "a reference is required");
      });
    }
  }
  // Never published: free text (reasons), device times as occurred, signatures, places.
  for (const k of ["reason", "signature", "location", "policy", "occurredDateTime", "occurredPeriod"]) {
    if (resource[k] !== undefined) add(k, "not published");
  }
}

export const provenanceModule: ResourceModule = { definition, read, search, validate };
