// Retrieve -> map, per resource type. Authorisation has already been decided
// (policy.ts) before any function here runs; these functions only read, as
// the caller, and map. Each search requires a narrowing parameter
// (RESOURCE_DEFINITIONS[type].requiredSearch), so no search can walk a whole
// table, and results are paged with a keyset cursor (stable under inserts).

import { errors } from "../errors/operationOutcome";
import type { Condition, Encounter, Observation, Patient, Resource } from "../types/fhir";
import type { FhirResourceType } from "../authorization/permissions";
import { RESOURCE_DEFINITIONS } from "../mappers/registry";
import { PATIENT_COLUMNS, mapPatient } from "../mappers/patient";
import { VISIT_COLUMNS, mapEncounter } from "../mappers/encounter";
import { VITALS_COLUMNS, mapVitalSign, parseObservationId } from "../mappers/observation";
import { CONDITION_COLUMNS, mapCondition } from "../mappers/condition";
import type { MapContext, Row } from "../mappers/common";
import {
  LOCAL,
  LOINC,
  OBSERVATION_CATEGORY,
  VITAL_SIGNS,
  type VerifiedCoding,
} from "../terminology/codeSystems";
import {
  intersectDates,
  parseDateSearch,
  parseExactDate,
  parseId,
  parseNameSearch,
  parseReferenceId,
  parseToken,
  type Cursor,
  type ParsedSearch,
} from "../search/params";
import type { SearchPage } from "../search/bundle";
import { pgrstQuote, type Postgrest } from "./postgrest";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOURCE_ID = /^[A-Za-z0-9\-._]{1,128}$/;
const MAX_KEYSET_ROUNDS = 5;

export interface QueryResult<T extends Resource> {
  page: SearchPage<T>;
  /** Internal patients.id of every patient whose data is in the result. */
  patientIds: string[];
}

type Filters = [string, string][];

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function patientContext(db: Postgrest, internalIds: Iterable<string>): Promise<MapContext> {
  const ids = [...new Set([...internalIds].filter((id) => SOURCE_ID.test(id)))];
  const map = new Map<string, string>();
  if (ids.length) {
    const rows = await db.select("patients", ["id", "fhir_id"], [["id", `in.(${ids.map(pgrstQuote).join(",")})`]]);
    for (const r of rows) {
      if (typeof r.id === "string" && typeof r.fhir_id === "string") map.set(r.id, r.fhir_id);
    }
  }
  return { patientFhirIds: map };
}

/**
 * The internal id of the patient named by patient= / subject=, or null when
 * the caller cannot see such a patient (the search then matches nothing:
 * "does not exist" and "not yours" look the same).
 */
async function resolvePatientParam(db: Postgrest, search: ParsedSearch): Promise<string | null | undefined> {
  const refs = [...(search.values.get("patient") ?? []), ...(search.values.get("subject") ?? [])].map((v) =>
    parseReferenceId(v, "Patient", "patient"),
  );
  if (!refs.length) return undefined;
  if (new Set(refs).size > 1) return null;
  if (!UUID.test(refs[0])) return null;
  const rows = await db.select("patients", ["id"], [["fhir_id", `eq.${refs[0]}`]], { limit: 1 });
  return typeof rows[0]?.id === "string" ? (rows[0].id as string) : null;
}

export function assertNarrowed(type: FhirResourceType, search: ParsedSearch): void {
  const ok = RESOURCE_DEFINITIONS[type].requiredSearch.some((group) => group.every((p) => search.values.has(p)));
  if (!ok) {
    const options = RESOURCE_DEFINITIONS[type].requiredSearch.map((g) => g.join(" + ")).join(", or ");
    throw errors.forbidden(`A ${type} search must name a specific record: give ${options}.`);
  }
}

function one(search: ParsedSearch, name: string): string | undefined {
  return search.values.get(name)?.[0];
}

function dateFilters(column: string, raw: string[] | undefined, name: string): Filters {
  if (!raw?.length) return [];
  const b = intersectDates(raw.map((r) => parseDateSearch(r, name)));
  const f: Filters = [];
  if (b.from) f.push([column, `gte.${b.from}`]);
  if (b.to) f.push([column, `lt.${b.to}`]);
  return f;
}

/** Keyset paging over rows that each map to exactly one resource. */
async function pageOneToOne<T extends Resource>(
  db: Postgrest,
  table: "patients" | "visits" | "conditions",
  columns: readonly string[],
  key: string,
  filters: Filters,
  count: number,
  cursor: Cursor | null,
  map: (rows: Row[]) => Promise<(T | null)[]>,
): Promise<{ page: SearchPage<T>; rows: Row[] }> {
  const out: { res: T; row: Row }[] = [];
  let after = cursor?.k ?? null;
  for (let round = 0; round < MAX_KEYSET_ROUNDS && out.length <= count; round++) {
    const f: Filters = [...filters];
    if (after) f.push([key, `gt.${after}`]);
    const rows = await db.select(table, columns, f, { order: `${key}.asc`, limit: count + 1 });
    const mapped = await map(rows);
    rows.forEach((row, i) => {
      const res = mapped[i];
      if (res && out.length <= count) out.push({ res, row });
    });
    if (rows.length < count + 1) break;
    after = String(rows[rows.length - 1][key]);
  }
  const hasMore = out.length > count;
  const kept = out.slice(0, count);
  return {
    page: {
      resources: kept.map((o) => o.res),
      next: hasMore ? { k: String(kept[kept.length - 1].row[key]) } : null,
    },
    rows: kept.map((o) => o.row),
  };
}

function patientIdsOf(rows: Row[]): string[] {
  return [...new Set(rows.map((r) => r.patient_id).filter((v): v is string => typeof v === "string"))];
}

// ---------------------------------------------------------------------------
// Patient
// ---------------------------------------------------------------------------

async function mapPatients(db: Postgrest, rows: Row[]): Promise<Patient[]> {
  const survivors = rows.map((r) => r.merged_into).filter((v): v is string => typeof v === "string");
  const ctx = await patientContext(db, survivors);
  return rows.map((r) => mapPatient(r, typeof r.merged_into === "string" ? ctx.patientFhirIds.get(r.merged_into) : null));
}

export async function readPatient(db: Postgrest, id: string): Promise<QueryResult<Patient>> {
  if (!UUID.test(id)) return { page: { resources: [], next: null }, patientIds: [] };
  const rows = await db.select("patients", PATIENT_COLUMNS, [["fhir_id", `eq.${id}`]], { limit: 1 });
  return { page: { resources: await mapPatients(db, rows), next: null }, patientIds: patientIdsFromPatients(rows) };
}

function patientIdsFromPatients(rows: Row[]): string[] {
  return rows.map((r) => r.id).filter((v): v is string => typeof v === "string");
}

export async function searchPatient(db: Postgrest, search: ParsedSearch): Promise<QueryResult<Patient>> {
  assertNarrowed("Patient", search);
  const filters: Filters = [];
  const idParam = one(search, "_id");
  const identifier = one(search, "identifier");
  const empty = { page: { resources: [], next: null }, patientIds: [] };

  if (idParam) {
    const id = parseId(idParam);
    if (!UUID.test(id)) return empty;
    filters.push(["fhir_id", `eq.${id}`]);
  }
  if (identifier) {
    const t = parseToken(identifier, "identifier");
    if (t.system !== null && t.system !== LOCAL.patientIdentifier) return empty;
    if (!UUID.test(t.code)) return empty;
    filters.push(["fhir_id", `eq.${t.code}`]);
  }
  const name = one(search, "name");
  const birthdate = one(search, "birthdate");
  if (name || birthdate) {
    if (!name || !birthdate) throw errors.forbidden("Patient search by name needs birthdate too, and the other way round.");
    const n = parseNameSearch(name, "name");
    filters.push(["dob", `eq.${parseExactDate(birthdate, "birthdate")}`]);
    filters.push(["or", `(given_name.ilike.${pgrstQuote(`${n}*`)},family_name.ilike.${pgrstQuote(`${n}*`)})`]);
    // Discovery by demographics never returns records merged into another.
    filters.push(["merged_into", "is.null"]);
  }

  const { page, rows } = await pageOneToOne<Patient>(
    db, "patients", PATIENT_COLUMNS, "fhir_id", filters, search.count, search.cursor,
    async (r) => mapPatients(db, r),
  );
  return { page, patientIds: patientIdsFromPatients(rows) };
}

// ---------------------------------------------------------------------------
// Encounter
// ---------------------------------------------------------------------------

const VISIT_STATUS_VALUES: Record<string, string[]> = {
  "in-progress": ["open", "in_progress", "in-progress", "active"],
  finished: ["closed", "completed", "finished"],
  cancelled: ["cancelled"],
};

async function mapVisits(db: Postgrest, rows: Row[]): Promise<(Encounter | null)[]> {
  const ctx = await patientContext(db, patientIdsOf(rows));
  return rows.map((r) => mapEncounter(r, ctx));
}

export async function readEncounter(db: Postgrest, id: string): Promise<QueryResult<Encounter>> {
  const rows = await db.select("visits", VISIT_COLUMNS, [["id", `eq.${id}`]], { limit: 1 });
  const resources = (await mapVisits(db, rows)).filter((e): e is Encounter => e !== null);
  return { page: { resources, next: null }, patientIds: patientIdsOf(rows) };
}

export async function searchEncounter(db: Postgrest, search: ParsedSearch): Promise<QueryResult<Encounter>> {
  assertNarrowed("Encounter", search);
  const empty = { page: { resources: [], next: null }, patientIds: [] };
  const filters: Filters = [];
  const idParam = one(search, "_id");
  if (idParam) filters.push(["id", `eq.${parseId(idParam)}`]);
  const patient = await resolvePatientParam(db, search);
  if (patient === null) return empty;
  if (patient) filters.push(["patient_id", `eq.${patient}`]);
  filters.push(...dateFilters("started_at", search.values.get("date"), "date"));
  const status = one(search, "status");
  if (status) {
    const t = parseToken(status, "status");
    const known = Object.values(VISIT_STATUS_VALUES).flat().map(pgrstQuote).join(",");
    if (t.code === "unknown") filters.push(["or", `(status.is.null,status.not.in.(${known}))`]);
    else if (VISIT_STATUS_VALUES[t.code]) filters.push(["status", `in.(${VISIT_STATUS_VALUES[t.code].map(pgrstQuote).join(",")})`]);
    else return empty;
  }
  const { page, rows } = await pageOneToOne<Encounter>(
    db, "visits", VISIT_COLUMNS, "id", filters, search.count, search.cursor, (r) => mapVisits(db, r),
  );
  return { page, patientIds: patientIdsOf(rows) };
}

// ---------------------------------------------------------------------------
// Observation (vital signs)
// ---------------------------------------------------------------------------

export async function readObservation(db: Postgrest, id: string): Promise<QueryResult<Observation>> {
  const parsed = parseObservationId(id);
  const def = parsed && VITAL_SIGNS.find((d) => d.kind === parsed.kind);
  if (!parsed || !def) return { page: { resources: [], next: null }, patientIds: [] };
  const rows = await db.select("vitals", VITALS_COLUMNS, [["id", `eq.${parsed.vitalsId}`]], { limit: 1 });
  const ctx = await patientContext(db, patientIdsOf(rows));
  const obs = rows.length ? mapVitalSign(rows[0], def, ctx) : null;
  return { page: { resources: obs ? [obs] : [], next: null }, patientIds: obs ? patientIdsOf(rows) : [] };
}

/** Vital-sign kinds a code= token selects (LOINC from the profile, or a local column code). */
function kindsForCode(raw: string): Set<string> {
  const t = parseToken(raw, "code");
  const kinds = new Set<string>();
  for (const def of VITAL_SIGNS) {
    const loinc = def.loinc.some((c) => c.code === t.code) && (t.system === null || t.system === LOINC);
    const local = def.columns.includes(t.code) && (t.system === null || t.system === LOCAL.vitals);
    if (loinc || local) kinds.add(def.kind);
  }
  return kinds;
}

export async function searchObservation(db: Postgrest, search: ParsedSearch): Promise<QueryResult<Observation>> {
  assertNarrowed("Observation", search);
  const empty = { page: { resources: [], next: null }, patientIds: [] };

  let kinds = new Set(VITAL_SIGNS.map((d) => d.kind));
  const filters: Filters = [];

  const category = one(search, "category");
  if (category) {
    const t = parseToken(category, "category");
    if (t.code !== "vital-signs" || (t.system !== null && t.system !== OBSERVATION_CATEGORY)) return empty;
  }
  const status = one(search, "status");
  if (status && parseToken(status, "status").code !== "final") return empty;
  const code = one(search, "code");
  if (code) {
    const selected = kindsForCode(code);
    kinds = new Set([...kinds].filter((k) => selected.has(k)));
  }
  const idParam = one(search, "_id");
  if (idParam) {
    const parsed = parseObservationId(parseId(idParam));
    if (!parsed) return empty;
    kinds = new Set([...kinds].filter((k) => k === parsed.kind));
    filters.push(["id", `eq.${parsed.vitalsId}`]);
  }
  if (!kinds.size) return empty;

  const patient = await resolvePatientParam(db, search);
  if (patient === null) return empty;
  if (patient) filters.push(["patient_id", `eq.${patient}`]);
  const encounter = one(search, "encounter");
  if (encounter) filters.push(["visit_id", `eq.${parseReferenceId(encounter, "Encounter", "encounter")}`]);
  filters.push(...dateFilters("taken_at", search.values.get("date"), "date"));

  const defs = VITAL_SIGNS.map((def, index) => ({ def, index })).filter((d) => kinds.has(d.def.kind));
  const count = search.count;
  const out: { obs: Observation; rowId: string; index: number; patientId: string }[] = [];
  let cursor = search.cursor;
  let exhausted = false;

  for (let round = 0; round < MAX_KEYSET_ROUNDS && out.length <= count && !exhausted; round++) {
    const f: Filters = [...filters];
    // A partly-emitted row is fetched again (gte) and resumes after its index.
    if (cursor) f.push(["id", `${cursor.s !== undefined ? "gte" : "gt"}.${cursor.k}`]);
    const rows = await db.select("vitals", VITALS_COLUMNS, f, { order: "id.asc", limit: count + 1 });
    const ctx = await patientContext(db, patientIdsOf(rows));
    for (const row of rows) {
      const rowId = String(row.id);
      for (const { def, index } of defs) {
        if (cursor && rowId === cursor.k && cursor.s !== undefined && index <= cursor.s) continue;
        if (out.length > count) break;
        const obs = mapVitalSign(row, def, ctx);
        if (obs) out.push({ obs, rowId, index, patientId: String(row.patient_id) });
      }
    }
    if (rows.length < count + 1) exhausted = true;
    else cursor = { k: String(rows[rows.length - 1].id), s: VITAL_SIGNS.length };
  }

  const kept = out.slice(0, count);
  const last = kept[kept.length - 1];
  return {
    page: {
      resources: kept.map((o) => o.obs),
      next: out.length > count && last ? { k: last.rowId, s: last.index } : null,
    },
    patientIds: [...new Set(kept.map((o) => o.patientId))],
  };
}

// ---------------------------------------------------------------------------
// Condition
// ---------------------------------------------------------------------------

async function verifiedCodings(db: Postgrest, rows: Row[]): Promise<Map<string, VerifiedCoding[]>> {
  const codes = [...new Set(rows.map((r) => r.condition_code).filter((c): c is string => typeof c === "string" && c.trim() !== ""))];
  const out = new Map<string, VerifiedCoding[]>();
  if (!codes.length) return out;
  try {
    const found = await db.rpc<{ local_code: string; fhir_system: string; fhir_code: string; fhir_display: string | null }[]>(
      "fhir_terminology_lookup",
      { p_domain: "condition", p_codes: codes },
    );
    for (const m of Array.isArray(found) ? found : []) {
      const list = out.get(m.local_code) ?? [];
      list.push({ localCode: m.local_code, system: m.fhir_system, code: m.fhir_code, display: m.fhir_display });
      out.set(m.local_code, list);
    }
  } catch {
    // Verified mappings are additions to the local coding, which is always
    // published. Without them the resource is still correct, only less
    // interoperable, so a lookup failure does not fail the read.
  }
  return out;
}

async function mapConditions(db: Postgrest, rows: Row[]): Promise<(Condition | null)[]> {
  const [ctx, verified] = await Promise.all([patientContext(db, patientIdsOf(rows)), verifiedCodings(db, rows)]);
  return rows.map((r) => mapCondition(r, ctx, verified));
}

export async function readCondition(db: Postgrest, id: string): Promise<QueryResult<Condition>> {
  if (!UUID.test(id)) return { page: { resources: [], next: null }, patientIds: [] };
  const rows = await db.select("conditions", CONDITION_COLUMNS, [["id", `eq.${id}`]], { limit: 1 });
  const resources = (await mapConditions(db, rows)).filter((c): c is Condition => c !== null);
  return { page: { resources, next: null }, patientIds: resources.length ? patientIdsOf(rows) : [] };
}

const CLINICAL_STATUSES = ["active", "recurrence", "relapse", "inactive", "remission", "resolved"];

export async function searchCondition(db: Postgrest, search: ParsedSearch): Promise<QueryResult<Condition>> {
  assertNarrowed("Condition", search);
  const empty = { page: { resources: [], next: null }, patientIds: [] };
  const filters: Filters = [];
  const idParam = one(search, "_id");
  if (idParam) {
    const id = parseId(idParam);
    if (!UUID.test(id)) return empty;
    filters.push(["id", `eq.${id}`]);
  }
  const patient = await resolvePatientParam(db, search);
  if (patient === null) return empty;
  if (patient) filters.push(["patient_id", `eq.${patient}`]);
  const clinical = one(search, "clinical-status");
  if (clinical) {
    const t = parseToken(clinical, "clinical-status");
    if (!CLINICAL_STATUSES.includes(t.code)) return empty;
    filters.push(["clinical_status", `eq.${t.code}`]);
    // con-5: entered-in-error records publish no clinical status, so they
    // never match a clinical-status search.
    filters.push(["or", "(verification_status.is.null,verification_status.neq.entered-in-error)"]);
  }
  const code = one(search, "code");
  if (code) {
    const t = parseToken(code, "code");
    if (t.system !== null && t.system !== LOCAL.condition) {
      throw errors.notSupported("Condition code search supports the mBHR local condition code system only.");
    }
    filters.push(["condition_code", `eq.${t.code}`]);
  }
  const { page, rows } = await pageOneToOne<Condition>(
    db, "conditions", CONDITION_COLUMNS, "id", filters, search.count, search.cursor, (r) => mapConditions(db, r),
  );
  return { page, patientIds: patientIdsOf(rows) };
}

export const READERS = {
  Patient: readPatient,
  Encounter: readEncounter,
  Observation: readObservation,
  Condition: readCondition,
} as const;

export const SEARCHERS = {
  Patient: searchPatient,
  Encounter: searchEncounter,
  Observation: searchObservation,
  Condition: searchCondition,
} as const;
