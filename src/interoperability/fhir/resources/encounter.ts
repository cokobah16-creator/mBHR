// Encounter <- public.visits (see mappers/encounter.ts for the mapping rules).

import type { Encounter } from "../types/fhir";
import { READ_PERMISSIONS } from "../authorization/permissions";
import { VISIT_COLUMNS, mapEncounter } from "../mappers/encounter";
import type { Row } from "../mappers/common";
import { referenceContext } from "../patients/canonical";
import { parseId, type ParsedSearch } from "../search/params";
import { pgrstQuote } from "../gateway/postgrest";
import { ENCOUNTER_STATUS, knownSourceValues, sourceValuesFor } from "../terminology/statusMaps";
import { emptyResult, type QueryCtx, type QueryResult, type ResourceDefinition, type ResourceModule } from "./module";
import {
  SOURCE_ID,
  dateFilters,
  likeLiteral,
  keysetPage,
  namedPatientFilter,
  one,
  ownersOf,
  patientNotes,
  scopeFilter,
  statusCode,
  type Filters,
} from "./shared";

export const encounterDefinition: ResourceDefinition = {
  type: "Encounter",
  source: "public.visits",
  idStrategy: "visits.id",
  fields: ["status", "class (AMB)", "subject", "period.start", "location (display only; not for 'Mobile Clinic' or 'Portal entry')"],
  profiles: [],
  interactions: ["read", "search-type"],
  searchParams: [
    { name: "_id", type: "token", documentation: "Logical id of the resource." },
    { name: "patient", type: "reference", documentation: "Patient/[id]. Required unless _id is given." },
    { name: "subject", type: "reference", documentation: "Same as patient (Patient/[id] only)." },
    {
      name: "date",
      type: "date",
      documentation:
        "When the visit started (Encounter.period.start). A date without a time is a clinic day in Africa/Lagos. Up to two bounds. A visit published without a period (site 'Portal entry') never matches.",
      maxRepeats: 2,
    },
    { name: "status", type: "token", documentation: "An encounter-status code: in-progress, finished, cancelled or unknown." },
  ],
  requiredSearch: [["_id"], ["patient"], ["subject"]],
  writeSupport: false,
  consentClass: "clinical",
  readPermissions: READ_PERMISSIONS.Encounter,
  patientAccess: true,
  sensitiveSearch: false,
  notes: ["A visit that was never closed on the tablet stays in-progress: mBHR records no end time."],
  patientAccessNotes: ["Patients see their closed visits only, as in the portal."],
};

/** The R4 code system of Encounter.status. */
const ENCOUNTER_STATUS_SYSTEM = "http://hl7.org/fhir/encounter-status";

/** visits.status values per FHIR status, from ENCOUNTER_STATUS (matched case-insensitively). */
export const VISIT_STATUS_VALUES: Record<string, string[]> = Object.fromEntries(
  [...new Set(ENCOUNTER_STATUS.rules.map((r) => r.fhir))].map((code) => [code, sourceValuesFor(ENCOUNTER_STATUS, code)]),
);

function statusFilter(code: string): Filters | null {
  const or = (values: string[]) => values.map((v) => `status.ilike.${pgrstQuote(likeLiteral(v))}`).join(",");
  if (code === "unknown") {
    const known = knownSourceValues(ENCOUNTER_STATUS);
    return [["or", `(status.is.null,status.eq."",and(${known.map((v) => `status.not.ilike.${pgrstQuote(likeLiteral(v))}`).join(",")}))`]];
  }
  const values = VISIT_STATUS_VALUES[code];
  return values ? [["or", `(${or(values)})`]] : null;
}

/** The portal shows a patient their closed visits only. */
function patientView(ctx: QueryCtx): Filters {
  return ctx.scope.kind === "patient" ? [["status", "eq.closed"]] : [];
}

async function mapVisits(ctx: QueryCtx, rows: Row[]): Promise<(Encounter | null)[]> {
  const refs = await referenceContext(ctx.db, ownersOf(rows).filter((v): v is string => v !== null));
  return rows.map((r) => mapEncounter(r, refs));
}

async function read(ctx: QueryCtx, id: string): Promise<QueryResult> {
  if (!SOURCE_ID.test(id)) return emptyResult();
  const rows = await ctx.db.select(
    "visits",
    VISIT_COLUMNS,
    [["id", `eq.${id}`], ...scopeFilter(ctx), ...patientView(ctx)],
    { limit: 1 },
  );
  const mapped = await mapVisits(ctx, rows);
  const resources: Encounter[] = [];
  const owners: (string | null)[] = [];
  mapped.forEach((e, i) => {
    if (e) {
      resources.push(e);
      owners.push(ownersOf([rows[i]])[0]);
    }
  });
  return { page: { resources, next: null }, owners };
}

async function search(ctx: QueryCtx, search: ParsedSearch): Promise<QueryResult> {
  const named = namedPatientFilter(ctx);
  if (named === null) return emptyResult(patientNotes(ctx));
  const filters: Filters = [...scopeFilter(ctx), ...patientView(ctx), ...named];
  const idParam = one(search, "_id");
  if (idParam) filters.push(["id", `eq.${parseId(idParam)}`]);
  const dated = search.values.has("date");
  filters.push(...dateFilters("started_at", search.values.get("date"), "date"));
  const status = one(search, "status");
  if (status) {
    const code = statusCode(status, "status", ENCOUNTER_STATUS_SYSTEM);
    const f = code === null ? null : statusFilter(code);
    if (!f) return emptyResult(patientNotes(ctx));
    filters.push(...f);
  }
  const { page, rows } = await keysetPage<Encounter>({
    db: ctx.db,
    table: "visits",
    columns: VISIT_COLUMNS,
    key: "id",
    keyPattern: SOURCE_ID,
    filters,
    count: search.count,
    cursor: search.cursor,
    // date= matches Encounter.period: a visit the mapper publishes without
    // one (a "Portal entry", whose start is when it was typed in) never
    // matches, by the mapper's own rule. keysetPage pages past it.
    map: async (r) => (await mapVisits(ctx, r)).map((e) => (dated && e && !e.period ? null : e)),
  });
  return { page, owners: ownersOf(rows), ...patientNotes(ctx) };
}

export const encounterModule: ResourceModule = { definition: encounterDefinition, read, search };
