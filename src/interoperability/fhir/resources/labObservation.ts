// Laboratory Observations <- public.lab_results (+ its public.lab_orders row).
// The Observation module (resources/observation.ts) composes this source
// with vital signs; see mappers/laboratory.ts for the mapping rules.
//
// Who reads what, and how:
//   staff     holders of consult or lab_review (owner decision 3; nurses
//             excluded). observation.ts already skips this source under the
//             restriction "no_lab_rows"; it is checked here again. Rows are
//             read from the tables as the caller (row-level security), and
//             only CURRENT results (superseded_by is null).
//   patients  never from the tables: only through the database function
//             public.fhir_patient_lab_results, which returns the caller's
//             own results that were reviewed, released to them, not
//             withheld and not superseded, with their order's columns.
//
// Search order (staff): orders in id order, and each order's current
// results in id order; the key of an emitted Observation is
// "<order id>.<result id>" (a bare "<order id>" resumes after that whole
// order). This keeps every query narrowed by the order columns the search
// names (patient, encounter, based-on), so a patient's results are found
// through an index, never by scanning all results. Patients: the database
// function's own order (result id), key = result id.

import type { Observation } from "../types/fhir";
import type { Row } from "../mappers/common";
import {
  LAB_OBSERVATION_PREFIX,
  LAB_ORDER_COLUMNS,
  LAB_RESULT_COLUMNS,
  LAB_TEST_CATALOGUE,
  LAB_TEST_SYSTEM,
  LOWER_UUID,
  UCUM_UNITS,
  V3_OBSERVATION_INTERPRETATION,
  mapLabObservation,
  splitPatientLabRow,
} from "../mappers/laboratory";
import { LAB_INTERPRETATION, LAB_OBSERVATION_STATUS } from "../terminology/status/laboratory";
import { knownSourceValues } from "../terminology/statusMaps";
import { OBSERVATION_CATEGORY, UCUM } from "../terminology/codeSystems";
import type { AddIssue } from "../validation/validate";
import { LAB_PERMISSIONS, hasAny } from "../authorization/permissions";
import { referenceContext } from "../patients/canonical";
import { errors, FhirError } from "../errors/operationOutcome";
import { inList, pgrstQuote } from "../gateway/postgrest";
import {
  intersectDates,
  parseDateSearch,
  parseId,
  parseReferenceId,
  parseToken,
  type DateBound,
  type ParsedSearch,
} from "../search/params";
import { emptyResult, type QueryCtx, type QueryResult } from "./module";
import {
  MAX_KEYSET_ROUNDS,
  dateFilters,
  likeLiteral,
  namedPatientFilter,
  one,
  patientFilter,
  scopeFilter,
  type Filters,
} from "./shared";

export { LAB_OBSERVATION_PREFIX } from "../mappers/laboratory";

export interface LabSearchInput {
  ctx: QueryCtx;
  search: ParsedSearch;
  /**
   * Internal patient ids to restrict to (canonical record plus merged-away
   * members), from ctx.patients; undefined when the search names no patient.
   */
  patientIds?: string[];
  /** Resume after this key (see the key format above), or null to start. */
  after: string | null;
  /** Maximum number of Observations to return. */
  count: number;
}

export interface LabSearchOutput {
  resources: Observation[];
  owners: (string | null)[];
  /** Key to resume after, or null when no more rows can match. */
  next: string | null;
}

export interface LabObservationSource {
  /** Whether this search can select laboratory rows at all (category, code, status, _id, based-on). */
  selects(search: ParsedSearch): boolean;
  read(ctx: QueryCtx, id: string): Promise<QueryResult<Observation>>;
  search(input: LabSearchInput): Promise<LabSearchOutput>;
}

// ---------------------------------------------------------------------------
// Helpers shared with resources/diagnosticReport.ts and serviceRequest.ts
// ---------------------------------------------------------------------------

/** Only results not replaced by a newer one are current. */
export const CURRENT_RESULTS: Filters = [["superseded_by", "is.null"]];

/** Order ids per results query (keeps the in.(...) list, and so the URL, short). */
const ORDER_IDS_PER_QUERY = 50;
/** Result pages per batch of orders before the search is refused as too costly. */
const MAX_RESULT_PAGES = 20;
const RESULT_PAGE = 101;
/** Pages of fhir_patient_lab_results read when a patient's results must all be seen at once. */
const MAX_PATIENT_PAGES = 20;
const PATIENT_PAGE = 101;

export function tooCostly(): FhirError {
  return new FhirError(
    400,
    "too-costly",
    "This search matches more laboratory results than one page can gather. Narrow it, for example with based-on or _id.",
  );
}

function badCursor(): FhirError {
  return errors.badRequest("_cursor is not valid. Start the search again.");
}

/** Patients (and anything restricted to released results) read only through fhir_patient_lab_results. */
export function usesPatientPath(ctx: QueryCtx): boolean {
  return ctx.scope.kind === "patient" || ctx.restrictions.has("released_results_only");
}

/** Staff may read laboratory rows: consult or lab_review, and not restricted to vital signs. */
export function staffMayReadLabs(ctx: QueryCtx): boolean {
  return ctx.scope.kind === "staff" && !ctx.restrictions.has("no_lab_rows") && hasAny(ctx.permissions, LAB_PERMISSIONS);
}

/** The current results of these orders, grouped by order id, each list in result id order. */
export async function currentResultsFor(ctx: QueryCtx, orderIds: string[], filters: Filters = []): Promise<Map<string, Row[]>> {
  const out = new Map<string, Row[]>();
  const ids = [...new Set(orderIds)].filter((id) => LOWER_UUID.test(id));
  for (let i = 0; i < ids.length; i += ORDER_IDS_PER_QUERY) {
    const chunk = ids.slice(i, i + ORDER_IDS_PER_QUERY);
    let after: string | null = null;
    let page = 0;
    for (;;) {
      if (page++ === MAX_RESULT_PAGES) throw tooCostly();
      const f: Filters = [["order_id", inList(chunk)], ...CURRENT_RESULTS, ...filters];
      if (after !== null) f.push(["id", `gt.${after}`]);
      const rows = await ctx.db.select("lab_results", LAB_RESULT_COLUMNS, f, { order: "id.asc", limit: RESULT_PAGE });
      for (const r of rows) {
        const key = String(r.order_id);
        const list = out.get(key) ?? [];
        list.push(r);
        out.set(key, list);
        after = String(r.id);
      }
      if (rows.length < RESULT_PAGE) break;
    }
  }
  return out;
}

export interface PatientLabPair {
  order: Row;
  result: Row;
}

/** One page of public.fhir_patient_lab_results, split into order and result rows. */
export async function patientLabPage(
  ctx: QueryCtx,
  opts: { resultIds?: string[] | null; orderIds?: string[] | null; after?: string | null; limit: number },
): Promise<{ pairs: PatientLabPair[]; full: boolean; last: string | null }> {
  const rows = await ctx.db.rpc<unknown>("fhir_patient_lab_results", {
    p_result_ids: opts.resultIds ?? null,
    p_order_ids: opts.orderIds ?? null,
    p_after: opts.after ?? null,
    p_limit: opts.limit,
  });
  if (!Array.isArray(rows)) throw errors.unavailable();
  const objects = rows.filter((r): r is Row => typeof r === "object" && r !== null && !Array.isArray(r));
  if (objects.length !== rows.length) throw errors.unavailable();
  const pairs = objects.map(splitPatientLabRow).filter((p) => typeof p.result.id === "string" && LOWER_UUID.test(p.result.id));
  // The key to continue after is the last row the function returned, even
  // one this module cannot use, so the next page never repeats a row.
  const lastId = objects.length ? objects[objects.length - 1].id : null;
  const last = typeof lastId === "string" && LOWER_UUID.test(lastId) ? lastId : null;
  if (objects.length && last === null) throw errors.unavailable();
  return { pairs, full: rows.length >= opts.limit, last };
}

/** Every row of fhir_patient_lab_results for these orders (or all of them), up to a fixed number of pages. */
export async function allPatientLabRows(ctx: QueryCtx, orderIds: string[] | null): Promise<PatientLabPair[]> {
  const out: PatientLabPair[] = [];
  let after: string | null = null;
  for (let page = 0; ; page++) {
    if (page === MAX_PATIENT_PAGES) throw tooCostly();
    const r = await patientLabPage(ctx, { orderIds, after, limit: PATIENT_PAGE });
    out.push(...r.pairs);
    if (!r.full || r.last === null) return out;
    after = r.last;
  }
}

/**
 * Whether a patient-path row may be used: its patient is the caller's own
 * (the database function already guarantees it; checked again here) and,
 * when the search names a patient, one of the named ids.
 */
export function patientRowAllowed(ctx: QueryCtx, named: string[] | undefined, order: Row): boolean {
  const pid = order.patient_id;
  if (typeof pid !== "string") return false;
  if (!ctx.scope.patientIds || !ctx.scope.patientIds.has(pid)) return false;
  return named === undefined || named.includes(pid);
}

/** The named patient's ids for in-memory filtering: undefined (none named), or null (match nothing). */
export function namedIds(ctx: QueryCtx): string[] | null | undefined {
  return ctx.patients ? ctx.patients.ids : undefined;
}

/** A code= token as a lab-test catalogue entry, or null when no lab order can carry it. */
export function labCodeEntry(raw: string): { code: string; name: string } | null {
  const t = parseToken(raw, "code");
  if (t.system !== null && t.system !== LAB_TEST_SYSTEM) return null;
  return LAB_TEST_CATALOGUE.find((e) => e.code === t.code) ?? null;
}

/** The SQL filters on lab_orders for an unchanged quick pick (the mapper's own rule). */
export function codeFilters(entry: { code: string; name: string }): Filters {
  return [
    ["test_code", `eq.${entry.code}`],
    ["test_name", `eq.${entry.name}`],
  ];
}

/** Collection-time bounds from date= (null when not given). */
export function dateBounds(raw: string[] | undefined, name: string): DateBound | null {
  return raw?.length ? intersectDates(raw.map((r) => parseDateSearch(r, name))) : null;
}

/** In-memory form of the order filters, for rows of the patient path (same rules as the SQL). */
export function orderMatches(
  order: Row,
  q: { orderId: string | null; visitId: string | null; code: { code: string; name: string } | null; dates: DateBound | null },
): boolean {
  if (q.orderId !== null && order.id !== q.orderId) return false;
  if (q.visitId !== null && order.visit_id !== q.visitId) return false;
  if (q.code !== null && (order.test_code !== q.code.code || order.test_name !== q.code.name)) return false;
  if (q.dates) {
    const v = typeof order.collected_at === "string" ? Date.parse(order.collected_at) : NaN;
    if (Number.isNaN(v)) return false;
    if (q.dates.from && v < Date.parse(q.dates.from)) return false;
    if (q.dates.to && v >= Date.parse(q.dates.to)) return false;
  }
  return true;
}

/** SQL filters on lab_orders for the same rules as orderMatches(). */
export function orderSqlFilters(q: {
  orderId: string | null;
  visitId: string | null;
  code: { code: string; name: string } | null;
  dateRaw: string[] | undefined;
}): Filters {
  const f: Filters = [];
  if (q.orderId !== null) f.push(["id", `eq.${q.orderId}`]);
  if (q.visitId !== null) f.push(["visit_id", `eq.${q.visitId}`]);
  if (q.code !== null) f.push(...codeFilters(q.code));
  f.push(...dateFilters("collected_at", q.dateRaw, "date"));
  return f;
}

// ---------------------------------------------------------------------------
// The search, parsed once
// ---------------------------------------------------------------------------

interface LabQuery {
  /** lab_results.id from _id=lab-<uuid>. */
  resultId: string | null;
  /** lab_orders.id from based-on=ServiceRequest/<uuid>. */
  orderId: string | null;
  visitId: string | null;
  code: { code: string; name: string } | null;
  status: "final" | "preliminary" | null;
  dates: DateBound | null;
  dateRaw: string[] | undefined;
}

/**
 * The search as laboratory filters, or null when no laboratory Observation
 * can match it (another category, a vital-signs code or id, a status no
 * result has). Malformed values are refused (400) as for any search.
 */
function parseLabQuery(search: ParsedSearch): LabQuery | null {
  // Every value is parsed (malformed ones are refused) before deciding
  // whether a laboratory result can match.
  const dateRaw = search.values.get("date");
  const dates = dateBounds(dateRaw, "date");
  const encounter = one(search, "encounter");
  const visitId = encounter ? parseReferenceId(encounter, "Encounter", "encounter") : null;
  const categoryParam = one(search, "category");
  const category = categoryParam ? parseToken(categoryParam, "category") : null;
  const statusParam = one(search, "status");
  const statusCode = statusParam ? parseToken(statusParam, "status").code : null;
  const codeParam = one(search, "code");
  const code = codeParam ? labCodeEntry(codeParam) : null;
  const idParam = one(search, "_id");
  const id = idParam ? parseId(idParam) : null;
  const basedOn = one(search, "based-on");
  const orderId = basedOn ? parseReferenceId(basedOn, "ServiceRequest", "based-on") : null;

  if (category && (category.code !== "laboratory" || (category.system !== null && category.system !== OBSERVATION_CATEGORY))) {
    return null;
  }
  if (statusCode !== null && statusCode !== "final" && statusCode !== "preliminary") return null;
  if (codeParam && !code) return null;
  let resultId: string | null = null;
  if (id !== null) {
    if (!id.startsWith(LAB_OBSERVATION_PREFIX)) return null;
    resultId = id.slice(LAB_OBSERVATION_PREFIX.length);
    if (!LOWER_UUID.test(resultId)) return null;
  }
  if (orderId !== null && !LOWER_UUID.test(orderId)) return null;
  const status = statusCode as LabQuery["status"];
  return { resultId, orderId, visitId, code, status, dates, dateRaw };
}

/** Result-level SQL filters: a superset of the rows that map to the searched status (checked again after mapping). */
function resultSqlFilters(q: LabQuery): Filters {
  const f: Filters = [];
  if (q.resultId !== null) f.push(["id", `eq.${q.resultId}`]);
  if (q.status === "final") {
    const known = knownSourceValues(LAB_INTERPRETATION);
    f.push(["reviewed_at", "not.is.null"], ["result_value", "not.is.null"]);
    f.push(["or", `(${known.map((v) => `interpretation.ilike.${pgrstQuote(likeLiteral(v))}`).join(",")})`]);
  }
  return f;
}

const EMPTY: LabSearchOutput = { resources: [], owners: [], next: null };

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

const STAFF_KEY = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))?$/;

async function staffRead(ctx: QueryCtx, resultId: string): Promise<QueryResult<Observation>> {
  const results = await ctx.db.select("lab_results", LAB_RESULT_COLUMNS, [["id", `eq.${resultId}`], ...CURRENT_RESULTS], { limit: 1 });
  const orderId = results[0]?.order_id;
  if (typeof orderId !== "string" || !LOWER_UUID.test(orderId)) return emptyResult() as QueryResult<Observation>;
  const orders = await ctx.db.select("lab_orders", LAB_ORDER_COLUMNS, [["id", `eq.${orderId}`], ...scopeFilter(ctx)], { limit: 1 });
  const patientId = orders[0]?.patient_id;
  if (typeof patientId !== "string") return emptyResult() as QueryResult<Observation>;
  const refs = await referenceContext(ctx.db, [patientId]);
  const obs = mapLabObservation(results[0], orders[0], refs);
  return { page: { resources: obs ? [obs] : [], next: null }, owners: obs ? [patientId] : [] };
}

async function staffSearch(input: LabSearchInput, q: LabQuery): Promise<LabSearchOutput> {
  const { ctx, count } = input;
  const named = input.patientIds !== undefined ? patientFilter(input.patientIds) : namedPatientFilter(ctx);
  if (named === null) return EMPTY;
  const cursor = input.after === null ? null : STAFF_KEY.exec(input.after);
  if (input.after !== null && !cursor) throw badCursor();

  const orderFilters: Filters = [...scopeFilter(ctx), ...named, ...orderSqlFilters(q)];
  const resultFilters = resultSqlFilters(q);
  if (q.resultId !== null) {
    // Find the result's order first, so the order query below reads one row.
    const hit = await ctx.db.select("lab_results", ["id", "order_id"], [["id", `eq.${q.resultId}`], ...CURRENT_RESULTS], { limit: 1 });
    const orderId = hit[0]?.order_id;
    if (typeof orderId !== "string" || !LOWER_UUID.test(orderId)) return EMPTY;
    orderFilters.push(["id", `eq.${orderId}`]);
  }

  let afterOrder: string | null = cursor ? cursor[1] : null;
  let afterResult: string | null = cursor && cursor[2] ? cursor[2] : null;
  const batch = Math.min(Math.max(count + 1, 25), ORDER_IDS_PER_QUERY);
  const resources: Observation[] = [];
  const owners: (string | null)[] = [];
  let lastKey = "";
  for (let round = 0; round < MAX_KEYSET_ROUNDS; round++) {
    const f: Filters = [...orderFilters];
    // A partly emitted order is read again (gte) and resumes after its last result.
    if (afterOrder !== null) f.push(["id", `${afterResult !== null ? "gte" : "gt"}.${afterOrder}`]);
    const orders = await ctx.db.select("lab_orders", LAB_ORDER_COLUMNS, f, { order: "id.asc", limit: batch });
    const orderIds = orders.map((o) => String(o.id));
    const [results, refs] = await Promise.all([
      currentResultsFor(ctx, orderIds, resultFilters),
      referenceContext(
        ctx.db,
        orders.map((o) => o.patient_id).filter((v): v is string => typeof v === "string"),
      ),
    ]);
    for (const order of orders) {
      const oid = String(order.id);
      for (const result of results.get(oid) ?? []) {
        const rid = String(result.id);
        if (afterResult !== null && oid === afterOrder && rid <= afterResult) continue;
        const obs = mapLabObservation(result, order, refs);
        if (!obs || (q.status !== null && obs.status !== q.status)) continue;
        if (resources.length === count) return { resources, owners, next: lastKey };
        resources.push(obs);
        owners.push(typeof order.patient_id === "string" ? order.patient_id : null);
        lastKey = `${oid}.${rid}`;
      }
      afterOrder = oid;
      afterResult = null;
    }
    if (orders.length < batch) return { resources, owners, next: null };
  }
  // Round limit reached: resume after the last whole order examined.
  return { resources, owners, next: afterOrder };
}

// ---------------------------------------------------------------------------
// Patients (fhir_patient_lab_results only)
// ---------------------------------------------------------------------------

async function patientRead(ctx: QueryCtx, resultId: string): Promise<QueryResult<Observation>> {
  const { pairs } = await patientLabPage(ctx, { resultIds: [resultId], limit: 1 });
  const pair = pairs.find((p) => p.result.id === resultId && patientRowAllowed(ctx, undefined, p.order));
  if (!pair) return emptyResult() as QueryResult<Observation>;
  const refs = await referenceContext(ctx.db, [String(pair.order.patient_id)]);
  const obs = mapLabObservation(pair.result, pair.order, refs);
  return { page: { resources: obs ? [obs] : [], next: null }, owners: obs ? [String(pair.order.patient_id)] : [] };
}

async function patientSearch(input: LabSearchInput, q: LabQuery): Promise<LabSearchOutput> {
  const { ctx, count } = input;
  const named = input.patientIds !== undefined ? input.patientIds : namedIds(ctx);
  if (named === null) return EMPTY;
  let after = input.after;
  if (after !== null && !LOWER_UUID.test(after)) throw badCursor();
  const batch = Math.min(Math.max(count + 1, 25), PATIENT_PAGE);
  const resources: Observation[] = [];
  const owners: (string | null)[] = [];
  let lastKey = "";
  for (let round = 0; round < MAX_KEYSET_ROUNDS; round++) {
    const page = await patientLabPage(ctx, {
      resultIds: q.resultId !== null ? [q.resultId] : null,
      orderIds: q.orderId !== null ? [q.orderId] : null,
      after,
      limit: batch,
    });
    const refs = await referenceContext(
      ctx.db,
      page.pairs.map((p) => p.order.patient_id).filter((v): v is string => typeof v === "string"),
    );
    for (const { order, result } of page.pairs) {
      if (!patientRowAllowed(ctx, named, order) || !orderMatches(order, q)) continue;
      if (q.resultId !== null && result.id !== q.resultId) continue;
      const obs = mapLabObservation(result, order, refs);
      if (!obs || (q.status !== null && obs.status !== q.status)) continue;
      if (resources.length === count) return { resources, owners, next: lastKey };
      resources.push(obs);
      owners.push(String(order.patient_id));
      lastKey = String(result.id);
    }
    if (!page.full || page.last === null) return { resources, owners, next: null };
    after = page.last;
  }
  // Round limit reached: resume after the last row examined.
  return { resources, owners, next: after };
}

// ---------------------------------------------------------------------------
// The source
// ---------------------------------------------------------------------------

export const labObservationSource: LabObservationSource = {
  selects: (search) => parseLabQuery(search) !== null,

  async read(ctx, id) {
    if (!id.startsWith(LAB_OBSERVATION_PREFIX)) return emptyResult() as QueryResult<Observation>;
    const resultId = id.slice(LAB_OBSERVATION_PREFIX.length);
    if (!LOWER_UUID.test(resultId)) return emptyResult() as QueryResult<Observation>;
    if (usesPatientPath(ctx)) return patientRead(ctx, resultId);
    if (!staffMayReadLabs(ctx)) return emptyResult() as QueryResult<Observation>;
    return staffRead(ctx, resultId);
  },

  async search(input) {
    const q = parseLabQuery(input.search);
    if (!q || input.count < 1) return EMPTY;
    if (usesPatientPath(input.ctx)) return patientSearch(input, q);
    if (!staffMayReadLabs(input.ctx)) return EMPTY;
    return staffSearch(input, q);
  },
};

// ---------------------------------------------------------------------------
// Checks on a mapped laboratory Observation (for the Observation module's
// validate step; the gateway refuses to serve a resource that fails them)
// ---------------------------------------------------------------------------

const LAB_STATUSES: ReadonlySet<string> = new Set<string>([...LAB_OBSERVATION_STATUS.rules.map((r) => r.fhir), "unknown"]);
const LAB_V3_INTERPRETATIONS: ReadonlySet<string> = new Set<string>(LAB_INTERPRETATION.rules.map((r) => r.fhir));

/**
 * The laboratory rules that must hold whatever the data: a result without a
 * value is never final, an interpretation is only one mBHR records (never a
 * direction such as H or L), "normal" is only published once reviewed, a
 * unit gets a UCUM code only from the verified list, and the result points
 * at its order.
 */
export function validateLabObservation(resource: Record<string, unknown>, add: AddIssue): void {
  if (typeof resource.id !== "string" || !resource.id.startsWith(LAB_OBSERVATION_PREFIX)) return;
  const status = resource.status as string;
  if (!LAB_STATUSES.has(status)) add("Observation.status", "not a status a laboratory result has");
  const categories = (resource.category as { coding?: { system?: string; code?: string }[] }[] | undefined) ?? [];
  if (!categories.some((c) => c.coding?.some((k) => k.system === OBSERVATION_CATEGORY && k.code === "laboratory"))) {
    add("Observation.category", "a laboratory result has the laboratory category");
  }
  const basedOn = resource.basedOn as { reference?: string }[] | undefined;
  if (basedOn?.length !== 1 || !/^ServiceRequest\/[0-9a-f-]{36}$/.test(basedOn[0].reference ?? "")) {
    add("Observation.basedOn", "a laboratory result names its order");
  }
  const values = ["valueQuantity", "valueString", "dataAbsentReason"].filter((k) => k in resource);
  if (values.length !== 1) add("Observation.value[x]", "exactly one of a value or a reason it is absent");
  if ("dataAbsentReason" in resource && status === "final") add("Observation.status", "a result without a value is never final");
  const quantity = resource.valueQuantity as { system?: string; code?: string; unit?: string } | undefined;
  if (quantity?.system !== undefined || quantity?.code !== undefined) {
    if (quantity.system !== UCUM || quantity.code === undefined || !UCUM_UNITS.has(quantity.unit ?? "") || UCUM_UNITS.get(quantity.unit ?? "") !== quantity.code) {
      add("Observation.valueQuantity", "a unit is coded only from the verified UCUM list");
    }
  }
  for (const concept of (resource.interpretation as { coding?: { system?: string; code?: string }[] }[] | undefined) ?? []) {
    for (const c of concept.coding ?? []) {
      if (c.system !== V3_OBSERVATION_INTERPRETATION) continue;
      if (!LAB_V3_INTERPRETATIONS.has(c.code ?? "")) add("Observation.interpretation", "only an interpretation mBHR records");
      if (c.code === "N" && status !== "final") add("Observation.interpretation", "normal is published only for a reviewed result");
    }
  }
  for (const k of ["note", "performer", "specimen", "hasMember", "derivedFrom", "method", "bodySite", "device"]) {
    if (k in resource) add(`Observation.${k}`, "not published for laboratory results");
  }
}
