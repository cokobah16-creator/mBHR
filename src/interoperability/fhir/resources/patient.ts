// Patient <- public.patients (see mappers/patient.ts for the mapping rules).

import { errors } from "../errors/operationOutcome";
import type { Patient } from "../types/fhir";
import { READ_PERMISSIONS } from "../authorization/permissions";
import { PATIENT_COLUMNS, isMergedRecord, mapPatient } from "../mappers/patient";
import type { Row } from "../mappers/common";
import { LOCAL } from "../terminology/codeSystems";
import { parseExactDate, parseId, parseNameSearch, parseToken, type ParsedSearch } from "../search/params";
import { pgrstQuote } from "../gateway/postgrest";
import { resolvePatients } from "../patients/canonical";
import { emptyResult, type QueryCtx, type QueryResult, type ResourceDefinition, type ResourceModule } from "./module";
import { UUID, keysetPage, one, scopeFilter, type Filters } from "./shared";

export const patientDefinition: ResourceDefinition = {
  type: "Patient",
  source: "public.patients",
  idStrategy: "patients.fhir_id (random uuid kept for FHIR); patients.id is never published",
  fields: [
    "identifier",
    "active (false only when merged)",
    "name",
    "telecom",
    "gender (omitted for the placeholder 'other')",
    "birthDate",
    "address",
    "link (replaced-by, to the kept record)",
  ],
  profiles: [],
  interactions: ["read", "search-type"],
  searchParams: [
    { name: "_id", type: "token", documentation: "Logical id of the resource." },
    {
      name: "identifier",
      type: "token",
      documentation: "https://mbhr.app/identifiers/patient|[id]. The only identifier mBHR records.",
    },
    {
      name: "name",
      type: "string",
      documentation: "Starts-with match on any given or family name. Only together with birthdate.",
    },
    { name: "birthdate", type: "date", documentation: "Exact date (YYYY-MM-DD). Only together with name." },
  ],
  requiredSearch: [["_id"], ["identifier"], ["name", "birthdate"]],
  writeSupport: false,
  consentClass: "demographics",
  readPermissions: READ_PERMISSIONS.Patient,
  patientAccess: true,
  sensitiveSearch: true,
  notes: [
    "A merged-away record is a tombstone (active=false, name, replaced-by link); its details live on the kept record.",
    "Name and birth-date searches never return merged-away records.",
  ],
};

/** Map rows, linking merged-away records to the canonical record at the end of their chain. */
async function mapPatients(ctx: QueryCtx, rows: Row[]): Promise<Patient[]> {
  const merged = rows.filter(isMergedRecord).map((r) => String(r.id));
  const canonical = new Map<string, string>();
  if (merged.length) {
    for (const r of await resolvePatients(ctx.db, { ids: merged })) {
      if (r.chainOk && r.canonicalFhirId && r.canonicalId !== r.id) canonical.set(r.input, r.canonicalFhirId);
    }
  }
  return rows.map((r) => mapPatient(r, canonical.get(String(r.id)) ?? null));
}

async function read(ctx: QueryCtx, id: string): Promise<QueryResult> {
  if (!UUID.test(id)) return emptyResult();
  const rows = await ctx.db.select("patients", PATIENT_COLUMNS, [["fhir_id", `eq.${id}`], ...scopeFilter(ctx, "id")], {
    limit: 1,
  });
  const resources = await mapPatients(ctx, rows);
  return { page: { resources, next: null }, owners: rows.map((r) => String(r.id)) };
}

async function search(ctx: QueryCtx, search: ParsedSearch): Promise<QueryResult> {
  const filters: Filters = [...scopeFilter(ctx, "id")];
  const idParam = one(search, "_id");
  const identifier = one(search, "identifier");

  if (idParam) {
    const id = parseId(idParam);
    if (!UUID.test(id)) return emptyResult();
    filters.push(["fhir_id", `eq.${id}`]);
  }
  if (identifier) {
    const t = parseToken(identifier, "identifier");
    if (t.system !== null && t.system !== LOCAL.patientIdentifier) return emptyResult();
    if (!UUID.test(t.code)) return emptyResult();
    filters.push(["fhir_id", `eq.${t.code}`]);
  }
  const name = one(search, "name");
  const birthdate = one(search, "birthdate");
  if (name || birthdate) {
    if (!name || !birthdate) throw errors.forbidden("Patient search by name needs birthdate too, and the other way round.");
    const n = parseNameSearch(name, "name");
    filters.push(["dob", `eq.${parseExactDate(birthdate, "birthdate")}`]);
    // Any word of the given or family name (a second given name, a
    // double-barrelled family name).
    filters.push([
      "or",
      `(given_name.ilike.${pgrstQuote(`${n}*`)},family_name.ilike.${pgrstQuote(`${n}*`)},` +
        `given_name.ilike.${pgrstQuote(`* ${n}*`)},family_name.ilike.${pgrstQuote(`* ${n}*`)})`,
    ]);
    // Discovery by demographics never returns records merged into another.
    filters.push(["merged_into", "is.null"], ["merged_at", "is.null"]);
  }

  const { page, rows } = await keysetPage<Patient>({
    db: ctx.db,
    table: "patients",
    columns: PATIENT_COLUMNS,
    key: "fhir_id",
    keyPattern: UUID,
    filters,
    count: search.count,
    cursor: search.cursor,
    map: (r) => mapPatients(ctx, r),
  });
  return { page, owners: rows.map((r) => String(r.id)) };
}

export const patientModule: ResourceModule = { definition: patientDefinition, read, search };
