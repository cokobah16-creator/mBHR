// ServiceRequest <- public.lab_orders (see mappers/laboratory.ts for the
// mapping rules).
//
// One laboratory order is one ServiceRequest with the order's id. Staff with
// consult or lab_review only; patients are not offered orders (the portal
// shows released results, not orders), so a patient never reaches this
// module (authorizeFhirRequest refuses them) and it would read nothing if
// one did.
//
// The ordering account (lab_orders.ordered_by, an auth account id) is never
// published. It becomes a requester only when public.fhir_staff_directory
// (staff callers only) resolves it to a published Practitioner id; if the
// directory cannot be read, the requester is left out.

import { READ_PERMISSIONS } from "../authorization/permissions";
import { LOWER_UUID, SERVICE_REQUEST_COLUMNS, mapServiceRequest, type ServiceRequest } from "../mappers/laboratory";
import type { Row } from "../mappers/common";
import { referenceContext } from "../patients/canonical";
import { pgrstQuote } from "../gateway/postgrest";
import { FHIR_ID, parseId, parseReferenceId, type ParsedSearch } from "../search/params";
import { SERVICE_REQUEST_STATUS } from "../terminology/status/laboratory";
import { knownSourceValues, sourceValuesFor } from "../terminology/statusMaps";
import type { AddIssue } from "../validation/validate";
import { emptyResult, type QueryCtx, type QueryResult, type ResourceDefinition, type ResourceModule } from "./module";
import {
  dateFilters,
  keysetPage,
  likeLiteral,
  namedPatientFilter,
  one,
  ownersOf,
  patientNotes,
  scopeFilter,
  statusCode,
  type Filters,
} from "./shared";
import { codeFilters, labCodeEntry, staffMayReadLabs } from "./labObservation";

export const definition: ResourceDefinition = {
  type: "ServiceRequest",
  source: "public.lab_orders (laboratory orders)",
  idStrategy: "lab_orders.id (uuid); the same id as the order's DiagnosticReport",
  fields: [
    "status (ordered, collected or processing -> active; completed -> completed, meaning a result was recorded, not reviewed; cancelled -> revoked; anything else -> unknown)",
    "intent (order)",
    "priority (routine, urgent or stat, as recorded; left out otherwise)",
    "code (the test as named; a local mBHR lab-test code only for an unchanged quick pick)",
    "subject",
    "encounter (the visit the order was placed in)",
    "authoredOn (when ordered, server time)",
    "requester (a Practitioner, only when the staff directory resolves the ordering account)",
  ],
  profiles: [],
  interactions: ["read", "search-type"],
  searchParams: [
    { name: "_id", type: "token", documentation: "Logical id of the resource (the lab order id)." },
    { name: "patient", type: "reference", documentation: "Patient/[id]. Required unless _id or encounter is given." },
    { name: "subject", type: "reference", documentation: "Same as patient (Patient/[id] only)." },
    { name: "encounter", type: "reference", documentation: "Encounter/[id]: orders placed in that visit." },
    { name: "status", type: "token", documentation: "A request-status code: active, completed, revoked or unknown (the published status, see the status map)." },
    {
      name: "authored",
      type: "date",
      documentation: "When the test was ordered. A date without a time is a clinic day in Africa/Lagos. Up to two bounds.",
      maxRepeats: 2,
    },
    {
      name: "code",
      type: "token",
      documentation:
        "An mBHR lab-test code (https://mbhr.app/codes/lab-test), e.g. CBC. Matches only orders that carry the unchanged quick pick (code and test name). Free-text test names cannot be searched.",
    },
  ],
  requiredSearch: [["_id"], ["patient"], ["subject"], ["encounter"]],
  writeSupport: false,
  consentClass: "laboratory",
  readPermissions: READ_PERMISSIONS.ServiceRequest,
  patientAccess: false,
  sensitiveSearch: true,
  notes: [
    "Laboratory orders need consult or lab_review.",
    "completed means a result was recorded for the order, not that it was reviewed: see DiagnosticReport.status.",
    "Clinical notes on the order, the specimen type and the ordering account id are never published.",
  ],
};

/** The R4 code system of ServiceRequest.status. */
const REQUEST_STATUS_SYSTEM = "http://hl7.org/fhir/request-status";

/** lab_orders.status values per published status (matched case-insensitively, as the mapper compares). */
function statusFilter(code: string): Filters | null {
  const quote = (v: string) => pgrstQuote(likeLiteral(v));
  if (code === "unknown") {
    const known = knownSourceValues(SERVICE_REQUEST_STATUS);
    return [["or", `(status.is.null,status.eq."",and(${known.map((v) => `status.not.ilike.${quote(v)}`).join(",")}))`]];
  }
  const values = sourceValuesFor(SERVICE_REQUEST_STATUS, code);
  return values.length ? [["or", `(${values.map((v) => `status.ilike.${quote(v)}`).join(",")})`]] : null;
}

/** Account id -> published Practitioner id, from the staff directory (staff callers only). */
async function practitionerIds(ctx: QueryCtx, rows: Row[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ctx.scope.kind !== "staff") return out;
  const ids = [...new Set(rows.map((r) => r.ordered_by).filter((v): v is string => typeof v === "string"))].filter((v) =>
    /^[A-Za-z0-9._-]{1,128}$/.test(v),
  );
  try {
    for (let i = 0; i < ids.length; i += 100) {
      const found = await ctx.db.rpc<unknown>("fhir_staff_directory", { p_source_ids: ids.slice(i, i + 100), p_limit: 101 });
      if (!Array.isArray(found)) continue;
      for (const r of found as { source_id?: unknown; fhir_id?: unknown }[]) {
        if (typeof r?.source_id === "string" && typeof r.fhir_id === "string" && FHIR_ID.test(r.fhir_id)) out.set(r.source_id, r.fhir_id);
      }
    }
  } catch {
    // The requester is optional: without the directory it is left out,
    // never filled with the account id.
  }
  return out;
}

async function mapOrders(ctx: QueryCtx, rows: Row[]): Promise<(ServiceRequest | null)[]> {
  const [refs, practitioners] = await Promise.all([
    referenceContext(
      ctx.db,
      rows.map((r) => r.patient_id).filter((v): v is string => typeof v === "string"),
    ),
    practitionerIds(ctx, rows),
  ]);
  return rows.map((r) => mapServiceRequest(r, refs, practitioners));
}

async function read(ctx: QueryCtx, id: string): Promise<QueryResult> {
  if (!LOWER_UUID.test(id) || !staffMayReadLabs(ctx)) return emptyResult();
  const rows = await ctx.db.select("lab_orders", SERVICE_REQUEST_COLUMNS, [["id", `eq.${id}`], ...scopeFilter(ctx)], { limit: 1 });
  const [sr] = await mapOrders(ctx, rows);
  return sr ? { page: { resources: [sr], next: null }, owners: ownersOf(rows) } : emptyResult();
}

async function search(ctx: QueryCtx, search: ParsedSearch): Promise<QueryResult> {
  const notes = patientNotes(ctx);
  // Every parameter is parsed first, so a malformed value is refused (400)
  // whatever else the search says.
  const filters: Filters = [];
  let matchesNothing = false;
  const idParam = one(search, "_id");
  if (idParam) {
    const id = parseId(idParam);
    if (LOWER_UUID.test(id)) filters.push(["id", `eq.${id}`]);
    else matchesNothing = true;
  }
  const encounter = one(search, "encounter");
  if (encounter) filters.push(["visit_id", `eq.${parseReferenceId(encounter, "Encounter", "encounter")}`]);
  filters.push(...dateFilters("ordered_at", search.values.get("authored"), "authored"));
  const status = one(search, "status");
  if (status) {
    const code = statusCode(status, "status", REQUEST_STATUS_SYSTEM);
    const f = code === null ? null : statusFilter(code);
    if (f) filters.push(...f);
    else matchesNothing = true;
  }
  const code = one(search, "code");
  if (code) {
    const entry = labCodeEntry(code);
    if (entry) filters.push(...codeFilters(entry));
    else matchesNothing = true;
  }
  if (matchesNothing || !staffMayReadLabs(ctx)) return emptyResult(notes);
  const named = namedPatientFilter(ctx);
  if (named === null) return emptyResult(notes);
  filters.unshift(...scopeFilter(ctx), ...named);
  const { page, rows } = await keysetPage<ServiceRequest>({
    db: ctx.db,
    table: "lab_orders",
    columns: SERVICE_REQUEST_COLUMNS,
    key: "id",
    keyPattern: LOWER_UUID,
    filters,
    count: search.count,
    cursor: search.cursor,
    map: (r) => mapOrders(ctx, r),
  });
  return { page, owners: ownersOf(rows), ...notes };
}

const PUBLISHED_STATUSES: ReadonlySet<string> = new Set<string>([...SERVICE_REQUEST_STATUS.rules.map((r) => r.fhir), "unknown"]);

/** R4 ServiceRequest: status, intent and subject are required; nothing else about the order may leak. */
function validate(resource: Record<string, unknown>, add: AddIssue): void {
  if (!PUBLISHED_STATUSES.has(resource.status as string)) add("ServiceRequest.status", "not a status this module publishes");
  if (resource.intent !== "order") add("ServiceRequest.intent", "must be order");
  const subject = resource.subject as Record<string, unknown> | undefined;
  if (!subject || typeof subject.reference !== "string" || !subject.reference.startsWith("Patient/")) {
    add("ServiceRequest.subject", "a Patient reference is required");
  }
  if (resource.priority !== undefined && !["routine", "urgent", "stat"].includes(resource.priority as string)) {
    add("ServiceRequest.priority", "not a recorded priority");
  }
  const requester = resource.requester as Record<string, unknown> | undefined;
  if (requester !== undefined && (typeof requester.reference !== "string" || !requester.reference.startsWith("Practitioner/"))) {
    add("ServiceRequest.requester", "only a Practitioner reference");
  }
  for (const k of ["note", "specimen", "reasonCode", "performer", "occurrenceDateTime"]) {
    if (k in resource) add(`ServiceRequest.${k}`, "not published");
  }
}

export const serviceRequestModule: ResourceModule = { definition, read, search, validate };
