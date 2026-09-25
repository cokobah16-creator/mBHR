// DiagnosticReport <- public.lab_orders + its current public.lab_results
// (see mappers/laboratory.ts for the mapping rules).
//
// One report per lab order, with the order's id. Its status comes from the
// review state of the order's current results (terminology/status/
// laboratory.ts), never from the order status alone: the app marks an order
// "completed" as soon as a result is typed in, before review. The report
// lists its result Observations and copies no value, unit, range or
// interpretation.
//
// Staff (consult or lab_review) read the tables as themselves. A patient
// (FHIR_PATIENT_ACCESS_ENABLED, restriction "released_results_only") never
// reads the tables: the report is built from public.fhir_patient_lab_results,
// so it lists only the results released to them, and an order with nothing
// released has no report. Because those rows cannot show whether the order
// has other current results (not yet reviewed, not yet released, or
// withheld), a patient's report is never final and never issued: "partial"
// at best, whatever the released results say.

import { READ_PERMISSIONS } from "../authorization/permissions";
import { LOWER_UUID, V2_DIAGNOSTIC_SERVICE_SECTION, LAB_ORDER_COLUMNS, mapDiagnosticReport, type DiagnosticReport } from "../mappers/laboratory";
import type { Row } from "../mappers/common";
import { referenceContext } from "../patients/canonical";
import { parseId, parseReferenceId, parseToken, type DateBound, type ParsedSearch } from "../search/params";
import { DIAGNOSTIC_REPORT_STATUS } from "../terminology/status/laboratory";
import { errors } from "../errors/operationOutcome";
import type { AddIssue } from "../validation/validate";
import { emptyResult, type QueryCtx, type QueryResult, type ResourceDefinition, type ResourceModule } from "./module";
import { keysetPage, namedPatientFilter, one, ownersOf, patientNotes, scopeFilter, statusCode, type Filters } from "./shared";
import {
  allPatientLabRows,
  currentResultsFor,
  dateBounds,
  labCodeEntry,
  namedIds,
  orderMatches,
  orderSqlFilters,
  patientRowAllowed,
  staffMayReadLabs,
  usesPatientPath,
  type PatientLabPair,
} from "./labObservation";

export const definition: ResourceDefinition = {
  type: "DiagnosticReport",
  source: "public.lab_orders with its current public.lab_results (one report per laboratory order)",
  idStrategy: "lab_orders.id (uuid); the same id as the order's ServiceRequest",
  fields: [
    "status (from the review of the order's current results: registered, partial, final, cancelled or unknown; never from the order status alone; never final for a patient)",
    "category (LAB, HL7 v2 table 0074)",
    "code (the test as named; a local mBHR lab-test code only for an unchanged quick pick)",
    "subject",
    "encounter (the visit the order was placed in)",
    "basedOn (the ServiceRequest)",
    "effectiveDateTime (specimen collection time, when recorded)",
    "issued (final reports only, so never for a patient: the latest clinician review)",
    "result (the laboratory Observations; no values are copied into the report)",
  ],
  profiles: [],
  interactions: ["read", "search-type"],
  searchParams: [
    { name: "_id", type: "token", documentation: "Logical id of the resource (the lab order id)." },
    { name: "patient", type: "reference", documentation: "Patient/[id]. Required unless _id, encounter or based-on is given." },
    { name: "subject", type: "reference", documentation: "Same as patient (Patient/[id] only)." },
    { name: "encounter", type: "reference", documentation: "Encounter/[id]: reports for orders placed in that visit." },
    { name: "based-on", type: "reference", documentation: "ServiceRequest/[id]: the report of that lab order." },
    {
      name: "status",
      type: "token",
      documentation:
        "A diagnostic-report-status code: registered, partial, final, cancelled or unknown (the published status). It is worked out from the results after they are read, so a page can hold fewer matches than _count and still link to a next page.",
      patientDocumentation: "A patient's reports are never final, so status=final finds none for a patient.",
    },
    { name: "category", type: "token", documentation: "LAB (http://terminology.hl7.org/CodeSystem/v2-0074): every report here is a laboratory report." },
    {
      name: "code",
      type: "token",
      documentation:
        "An mBHR lab-test code (https://mbhr.app/codes/lab-test), e.g. CBC. Matches only orders that carry the unchanged quick pick (code and test name). Free-text test names cannot be searched.",
    },
    {
      name: "date",
      type: "date",
      documentation:
        "When the specimen was collected. Reports without a recorded collection time never match. A date without a time is a clinic day in Africa/Lagos. Up to two bounds.",
      maxRepeats: 2,
    },
  ],
  requiredSearch: [["_id"], ["patient"], ["subject"], ["encounter"], ["based-on"]],
  writeSupport: false,
  consentClass: "laboratory",
  readPermissions: READ_PERMISSIONS.DiagnosticReport,
  patientAccess: true,
  sensitiveSearch: true,
  notes: [
    "Laboratory reports need consult or lab_review.",
    "A report is final only when a clinician has reviewed every current result; until then it is partial. The order being completed does not make it final.",
    "No conclusion is published: mBHR records none. Results carry the values, units, ranges and interpretations.",
    "This interface is not a critical-result alert channel: critical results are flagged on each Observation (AA) but no acknowledgement is recorded or published.",
  ],
  patientAccessNotes: [
    "Patients see a report only for results released to them, listing only those results. A patient's report is never final and has no issued time: it is partial at best, because the results released to a patient cannot show that the order has no other result still pending review or release.",
  ],
};

/** The R4 code system of DiagnosticReport.status. */
const DIAGNOSTIC_REPORT_STATUS_SYSTEM = "http://hl7.org/fhir/diagnostic-report-status";

/** The status= values a report can have. Other valid codes match nothing. */
const REPORT_STATUSES: ReadonlySet<string> = new Set<string>([...DIAGNOSTIC_REPORT_STATUS.rules.map((r) => r.fhir), "unknown"]);

interface ReportQuery {
  orderId: string | null;
  visitId: string | null;
  code: { code: string; name: string } | null;
  status: string | null;
  dates: DateBound | null;
  dateRaw: string[] | undefined;
}

/** The search as order filters, or null when no report can match. */
function parseReportQuery(search: ParsedSearch): ReportQuery | null {
  // Every value is parsed (malformed ones are refused) before deciding
  // whether a report can match.
  const dateRaw = search.values.get("date");
  const dates = dateBounds(dateRaw, "date");
  const encounter = one(search, "encounter");
  const visitId = encounter ? parseReferenceId(encounter, "Encounter", "encounter") : null;
  const idParam = one(search, "_id");
  const id = idParam ? parseId(idParam) : null;
  const basedOn = one(search, "based-on");
  const basedOnId = basedOn ? parseReferenceId(basedOn, "ServiceRequest", "based-on") : null;
  const categoryParam = one(search, "category");
  const category = categoryParam ? parseToken(categoryParam, "category") : null;
  const statusParam = one(search, "status");
  // null for a status in another code system: then no report can match.
  const status = statusParam ? statusCode(statusParam, "status", DIAGNOSTIC_REPORT_STATUS_SYSTEM) : null;
  const codeParam = one(search, "code");
  const code = codeParam ? labCodeEntry(codeParam) : null;

  if (id !== null && !LOWER_UUID.test(id)) return null;
  if (basedOnId !== null && (!LOWER_UUID.test(basedOnId) || (id !== null && id !== basedOnId))) return null;
  if (category && (category.code !== "LAB" || (category.system !== null && category.system !== V2_DIAGNOSTIC_SERVICE_SECTION))) {
    return null;
  }
  if (statusParam && (status === null || !REPORT_STATUSES.has(status))) return null;
  if (codeParam && !code) return null;
  return { orderId: id ?? basedOnId, visitId, code, status, dates, dateRaw };
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

async function mapStaffOrders(ctx: QueryCtx, orders: Row[], status: string | null): Promise<(DiagnosticReport | null)[]> {
  const [results, refs] = await Promise.all([
    currentResultsFor(
      ctx,
      orders.map((o) => String(o.id)),
    ),
    referenceContext(
      ctx.db,
      orders.map((o) => o.patient_id).filter((v): v is string => typeof v === "string"),
    ),
  ]);
  return orders.map((o) => {
    // Staff row-level security shows every current result of the order.
    const report = mapDiagnosticReport(o, results.get(String(o.id)) ?? [], refs, "all_current_results");
    return report && (status === null || report.status === status) ? report : null;
  });
}

async function staffRead(ctx: QueryCtx, id: string): Promise<QueryResult> {
  const orders = await ctx.db.select("lab_orders", LAB_ORDER_COLUMNS, [["id", `eq.${id}`], ...scopeFilter(ctx)], { limit: 1 });
  const [report] = await mapStaffOrders(ctx, orders, null);
  return report ? { page: { resources: [report], next: null }, owners: ownersOf(orders) } : emptyResult();
}

async function staffSearch(ctx: QueryCtx, search: ParsedSearch, q: ReportQuery): Promise<QueryResult> {
  const named = namedPatientFilter(ctx);
  if (named === null) return emptyResult(patientNotes(ctx));
  const filters: Filters = [...scopeFilter(ctx), ...named, ...orderSqlFilters(q)];
  const { page, rows } = await keysetPage<DiagnosticReport>({
    db: ctx.db,
    table: "lab_orders",
    columns: LAB_ORDER_COLUMNS,
    key: "id",
    keyPattern: LOWER_UUID,
    filters,
    count: search.count,
    cursor: search.cursor,
    map: (r) => mapStaffOrders(ctx, r, q.status),
  });
  return { page, owners: ownersOf(rows), ...patientNotes(ctx) };
}

// ---------------------------------------------------------------------------
// Patients (fhir_patient_lab_results only)
// ---------------------------------------------------------------------------

/** Released results grouped into their orders, in order id order. */
function groupByOrder(pairs: PatientLabPair[]): { order: Row; results: Row[] }[] {
  const byOrder = new Map<string, { order: Row; results: Row[] }>();
  for (const p of pairs) {
    const oid = p.order.id;
    if (typeof oid !== "string" || !LOWER_UUID.test(oid)) continue;
    const entry = byOrder.get(oid) ?? { order: p.order, results: [] };
    entry.results.push(p.result);
    byOrder.set(oid, entry);
  }
  return [...byOrder.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, v]) => v);
}

async function patientReports(
  ctx: QueryCtx,
  groups: { order: Row; results: Row[] }[],
): Promise<{ report: DiagnosticReport | null; owner: string }[]> {
  const refs = await referenceContext(
    ctx.db,
    groups.map((g) => g.order.patient_id).filter((v): v is string => typeof v === "string"),
  );
  // Only the released results: the report is never final (see the top of this file).
  return groups.map((g) => ({
    report: mapDiagnosticReport(g.order, g.results, refs, "released_to_patient"),
    owner: String(g.order.patient_id),
  }));
}

async function patientRead(ctx: QueryCtx, id: string): Promise<QueryResult> {
  const groups = groupByOrder(await allPatientLabRows(ctx, [id])).filter(
    (g) => g.order.id === id && patientRowAllowed(ctx, undefined, g.order),
  );
  const [first] = await patientReports(ctx, groups);
  return first?.report ? { page: { resources: [first.report], next: null }, owners: [first.owner] } : emptyResult();
}

async function patientSearch(ctx: QueryCtx, search: ParsedSearch, q: ReportQuery): Promise<QueryResult> {
  const notes = patientNotes(ctx);
  const named = namedIds(ctx);
  if (named === null) return emptyResult(notes);
  const after = search.cursor?.k ?? null;
  if (after !== null && !LOWER_UUID.test(after)) throw errors.badRequest("_cursor is not valid. Start the search again.");
  // The database function pages by result, not by order, so the patient's
  // released results are read in full (a bounded number of pages) and
  // grouped here; a patient has few.
  const groups = groupByOrder(await allPatientLabRows(ctx, q.orderId !== null ? [q.orderId] : null)).filter(
    (g) =>
      (after === null || String(g.order.id) > after) &&
      patientRowAllowed(ctx, named, g.order) &&
      orderMatches(g.order, q),
  );
  const resources: DiagnosticReport[] = [];
  const owners: (string | null)[] = [];
  let next: string | null = null;
  for (const { report, owner } of await patientReports(ctx, groups)) {
    if (!report || (q.status !== null && report.status !== q.status)) continue;
    if (resources.length === search.count) {
      next = String(resources[resources.length - 1].id);
      break;
    }
    resources.push(report);
    owners.push(owner);
  }
  return { page: { resources, next: next ? { k: next } : null }, owners, ...notes };
}

// ---------------------------------------------------------------------------
// The module
// ---------------------------------------------------------------------------

async function read(ctx: QueryCtx, id: string): Promise<QueryResult> {
  if (!LOWER_UUID.test(id)) return emptyResult();
  if (usesPatientPath(ctx)) return patientRead(ctx, id);
  if (!staffMayReadLabs(ctx)) return emptyResult();
  return staffRead(ctx, id);
}

async function search(ctx: QueryCtx, search: ParsedSearch): Promise<QueryResult> {
  const q = parseReportQuery(search);
  if (!q) return emptyResult(patientNotes(ctx));
  if (usesPatientPath(ctx)) return patientSearch(ctx, search, q);
  if (!staffMayReadLabs(ctx)) return emptyResult(patientNotes(ctx));
  return staffSearch(ctx, search, q);
}

/** R4 DiagnosticReport: status, code and subject are required here; a final report names when it was issued. */
function validate(resource: Record<string, unknown>, add: AddIssue): void {
  if (!REPORT_STATUSES.has(resource.status as string)) add("DiagnosticReport.status", "not a status this module publishes");
  const code = resource.code as Record<string, unknown> | undefined;
  if (!code || (code.text === undefined && code.coding === undefined)) add("DiagnosticReport.code", "required");
  const subject = resource.subject as Record<string, unknown> | undefined;
  if (!subject || typeof subject.reference !== "string" || !subject.reference.startsWith("Patient/")) {
    add("DiagnosticReport.subject", "a Patient reference is required");
  }
  if (resource.status === "final" && resource.issued === undefined) add("DiagnosticReport.issued", "a final report names its review time");
  if (resource.status !== "final" && resource.issued !== undefined) add("DiagnosticReport.issued", "only a final report is issued");
  if ("conclusion" in resource || "conclusionCode" in resource || "presentedForm" in resource) {
    add("DiagnosticReport.conclusion", "mBHR records no report conclusion");
  }
  const results = resource.result as { reference?: string }[] | undefined;
  for (const r of results ?? []) {
    if (typeof r.reference !== "string" || !/^Observation\/lab-[0-9a-f-]{36}$/.test(r.reference)) {
      add("DiagnosticReport.result", "must reference a laboratory Observation");
    }
  }
  if ((resource.status === "registered" || resource.status === "cancelled") && results?.length) {
    add("DiagnosticReport.result", "a registered or cancelled report lists no result");
  }
}

export const diagnosticReportModule: ResourceModule = { definition, read, search, validate };
