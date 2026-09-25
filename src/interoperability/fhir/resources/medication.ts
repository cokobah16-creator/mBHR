// Medication <- public.pharmacy_items (see mappers/medication.ts for the
// mapping rules). Also the lookups the MedicationRequest and
// MedicationDispense modules share: catalogue entries, published Medication
// ids, visits, staff and statuses as search filters.
//
// A Medication's id is a random uuid the server keeps for each catalogue
// row (interop.resource_links, through public.fhir_link_ids /
// fhir_link_sources, which only staff holding consult, dispense or
// inventory may call for Medication). The row id itself is never
// published: seeded ids run past the 64 characters a FHIR id allows, and a
// medicine registered twice is merged under one of them.

import type { Medication, CatalogueEntry } from "../mappers/medication";
import { CATALOGUE_LOOKUP_COLUMNS, MEDICATION_COLUMNS, itemDescription, mapMedication } from "../mappers/medication";
import type { Row } from "../mappers/common";
import { READ_PERMISSIONS } from "../authorization/permissions";
import { inList, pgrstQuote } from "../gateway/postgrest";
import { parseId, type ParsedSearch } from "../search/params";
import { knownSourceValues, sourceValuesFor, type StatusMap } from "../terminology/statusMaps";
import { emptyResult, type QueryCtx, type QueryResult, type ResourceDefinition, type ResourceModule } from "./module";
import { UUID, likeLiteral, one, scopeFilter, type Filters } from "./shared";

export const definition: ResourceDefinition = {
  type: "Medication",
  source: "public.pharmacy_items (the pharmacy catalogue; one entry per medicine, form and strength at a site)",
  idStrategy:
    "A random uuid the server keeps for each catalogue entry (interop.resource_links via fhir_link_ids); pharmacy_items.id is never published",
  fields: [
    "code.text (medicine name and strength as typed; no coding: the catalogue has no verified code)",
    "form.text (dose form as recorded)",
    "status (active or inactive, from is_active)",
  ],
  profiles: [],
  interactions: ["read", "search-type"],
  searchParams: [
    {
      name: "_id",
      type: "token",
      documentation: "Logical id of the Medication (as referenced by MedicationRequest.medicationReference).",
    },
  ],
  requiredSearch: [["_id"]],
  writeSupport: false,
  consentClass: "medication",
  readPermissions: READ_PERMISSIONS.Medication,
  patientAccess: false,
  sensitiveSearch: false,
  notes: [
    "No RxNorm, SNOMED CT or ATC code is published: mBHR's catalogue records a name, strength and form as typed, which are published as text only.",
    "Strength is text inside code.text; it is never turned into an ingredient strength or an amount.",
    "Stock levels, reorder levels, the controlled-drug flag, lots and the site are not published.",
    "The same medicine stocked at two sites is two Medication resources.",
  ],
};

// ---------------------------------------------------------------------------
// Lookups shared with MedicationRequest and MedicationDispense
// ---------------------------------------------------------------------------

/** Ids fhir_link_ids accepts (anything else would fail the whole call). */
const LINK_SOURCE_ID = /^[A-Za-z0-9._:-]{1,128}$/;
/** Account ids fhir_staff_directory accepts in p_source_ids. */
const DIRECTORY_SOURCE_ID = /^[A-Za-z0-9._-]{1,128}$/;
/** Ids per lookup call (the functions accept 200; the directory returns at most 101 rows). */
const CHUNK = 100;

function chunks<T>(values: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += CHUNK) out.push(values.slice(i, i + CHUNK));
  return out;
}

export function distinctStrings(values: Iterable<unknown>, pattern: RegExp): string[] {
  const out = new Set<string>();
  for (const v of values) if (typeof v === "string" && pattern.test(v)) out.add(v);
  return [...out];
}

/**
 * Published Medication ids for catalogue rows (fhir_link_ids mints one for
 * a row that has none). Staff only. A failed lookup returns what it has:
 * the caller then names the medicine as text instead of by reference.
 */
export async function medicationIds(ctx: QueryCtx, itemIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ctx.scope.kind !== "staff") return out;
  for (const part of chunks(distinctStrings(itemIds, LINK_SOURCE_ID))) {
    try {
      const rows = await ctx.db.rpc<{ source_id: unknown; fhir_id: unknown }[]>("fhir_link_ids", {
        p_resource_type: "Medication",
        p_source_ids: part,
      });
      for (const r of Array.isArray(rows) ? rows : []) {
        if (typeof r.source_id === "string" && typeof r.fhir_id === "string" && UUID.test(r.fhir_id)) {
          out.set(r.source_id, r.fhir_id);
        }
      }
    } catch {
      // Left out: the medicine is still named (as text) from the row the
      // caller read; only the reference is missing.
    }
  }
  return out;
}

/**
 * Catalogue entries the caller can read (row-level security: consult,
 * dispense or inventory), with their published Medication ids when
 * `withLinks` (staff). An id the caller cannot read is simply absent.
 */
export async function catalogueEntries(
  ctx: QueryCtx,
  itemIds: Iterable<unknown>,
  withLinks: boolean,
): Promise<Map<string, CatalogueEntry>> {
  const out = new Map<string, CatalogueEntry>();
  const ids = distinctStrings(itemIds, LINK_SOURCE_ID);
  if (!ids.length) return out;
  const rows: Row[] = [];
  for (const part of chunks(ids)) {
    rows.push(...(await ctx.db.select("pharmacy_items", CATALOGUE_LOOKUP_COLUMNS, [["id", inList(part)]], { limit: part.length })));
  }
  const links = withLinks ? await medicationIds(ctx, rows.map((r) => String(r.id))) : new Map<string, string>();
  for (const r of rows) {
    const description = itemDescription(r);
    if (typeof r.id !== "string" || !description) continue;
    const unit = typeof r.unit === "string" && r.unit.trim() !== "" ? r.unit.trim() : undefined;
    out.set(r.id, { fhirId: links.get(r.id) ?? null, description, unit });
  }
  return out;
}

/**
 * Practitioner ids for staff account ids, through fhir_staff_directory
 * (staff callers only; the account id never leaves this function). Values
 * that are not account ids (a typed staff name, 'staff', '') are never
 * sent. A failed lookup leaves the staff reference out.
 */
export async function practitionerIds(ctx: QueryCtx, accountIds: Iterable<unknown>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ctx.scope.kind !== "staff") return out;
  for (const part of chunks(distinctStrings(accountIds, DIRECTORY_SOURCE_ID))) {
    try {
      const rows = await ctx.db.rpc<{ source_id: unknown; fhir_id: unknown }[]>("fhir_staff_directory", {
        p_source_ids: part,
        p_limit: 101,
      });
      for (const r of Array.isArray(rows) ? rows : []) {
        if (typeof r.source_id === "string" && typeof r.fhir_id === "string" && /^[A-Za-z0-9.-]{1,64}$/.test(r.fhir_id)) {
          out.set(r.source_id, r.fhir_id);
        }
      }
    } catch {
      // Left out: a staff reference is optional and is never replaced by the raw id.
    }
  }
  return out;
}

/**
 * Visits the caller can read (a patient: their own closed visits, as the
 * portal shows): visit id -> internal patient id. A patient's lookup is
 * confined to their own records in the query itself (scopeFilter), not only
 * by row-level security, so another patient's visit row is never read.
 */
export async function readableVisits(ctx: QueryCtx, visitIds: Iterable<unknown>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = distinctStrings(visitIds, /^[A-Za-z0-9.-]{1,64}$/);
  for (const part of chunks(ids)) {
    const filters: Filters = [["id", inList(part)], ...scopeFilter(ctx)];
    if (ctx.scope.kind === "patient") filters.push(["status", "eq.closed"]);
    for (const r of await ctx.db.select("visits", ["id", "patient_id"], filters, { limit: part.length })) {
      if (typeof r.id === "string" && typeof r.patient_id === "string") out.set(r.id, r.patient_id);
    }
  }
  return out;
}

/** visit id -> canonical Patient id, from readableVisits() and a resolved reference context. */
export function visitPatientIds(visits: Map<string, string>, patientFhirIds: ReadonlyMap<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [visit, patient] of visits) {
    const fhirId = patientFhirIds.get(patient);
    if (fhirId) out.set(visit, fhirId);
  }
  return out;
}

/**
 * A status token as a filter on `column`, from the same map the mapper uses,
 * so a search finds exactly what the resources show: the source values of
 * the rules that give `code`, plus missing values when the map's fallback
 * for a missing value is `code`, plus values no rule knows when its
 * fallback for those is `code`. null: nothing can match.
 */
export function statusSearchFilter(map: StatusMap, column: string, code: string): Filters | null {
  const q = (v: string) => pgrstQuote(likeLiteral(v));
  const parts = sourceValuesFor(map, code).map((v) => `${column}.ilike.${q(v)}`);
  if (map.missing.fhir === code) parts.push(`${column}.is.null`, `${column}.eq.""`);
  if (map.unrecognised.fhir === code) {
    const known = knownSourceValues(map);
    parts.push(`and(${[`${column}.neq.""`, ...known.map((v) => `${column}.not.ilike.${q(v)}`)].join(",")})`);
  }
  return parts.length ? [["or", `(${parts.join(",")})`]] : null;
}

// ---------------------------------------------------------------------------
// Medication read and search
// ---------------------------------------------------------------------------

async function byFhirIds(ctx: QueryCtx, fhirIds: string[]): Promise<QueryResult> {
  // The catalogue is staff data; the link functions refuse anyone else.
  if (ctx.scope.kind !== "staff") return emptyResult();
  const ids = fhirIds.filter((id) => UUID.test(id));
  if (!ids.length) return emptyResult();
  const links = await ctx.db.rpc<{ fhir_id: unknown; source_id: unknown }[]>("fhir_link_sources", {
    p_resource_type: "Medication",
    p_fhir_ids: ids,
  });
  const bySource = new Map<string, string>();
  for (const l of Array.isArray(links) ? links : []) {
    if (typeof l.fhir_id === "string" && typeof l.source_id === "string" && ids.includes(l.fhir_id)) {
      bySource.set(l.source_id, l.fhir_id);
    }
  }
  const sources = distinctStrings(bySource.keys(), LINK_SOURCE_ID);
  if (!sources.length) return emptyResult();
  // Read as the caller: row-level security decides whether they may see it.
  const rows = await ctx.db.select("pharmacy_items", MEDICATION_COLUMNS, [["id", inList(sources)]], { limit: sources.length });
  const resources: Medication[] = [];
  for (const r of rows) {
    const m = mapMedication(r, typeof r.id === "string" ? bySource.get(r.id) : null);
    if (m) resources.push(m);
  }
  resources.sort((a, b) => ((a.id as string) < (b.id as string) ? -1 : 1));
  return { page: { resources, next: null }, owners: resources.map(() => null) };
}

async function read(ctx: QueryCtx, id: string): Promise<QueryResult> {
  return byFhirIds(ctx, [id]);
}

async function search(ctx: QueryCtx, search: ParsedSearch): Promise<QueryResult> {
  const idParam = one(search, "_id");
  // requiredSearch makes _id mandatory for staff; nobody else reaches here.
  if (!idParam) return emptyResult();
  return byFhirIds(ctx, [parseId(idParam)]);
}

const MEDICATION_STATUS_CODES = ["active", "inactive", "entered-in-error"];

function validate(resource: Record<string, unknown>, add: (path: string, message: string) => void): void {
  if (resource.status !== undefined && !MEDICATION_STATUS_CODES.includes(resource.status as string)) {
    add("status", "not a medication-status code");
  }
  const code = resource.code as Record<string, unknown> | undefined;
  if (!code || typeof code.text !== "string") add("code", "the medicine must be named (code.text)");
  // mBHR holds no verified medicine code: a coding here would be invented.
  if (code && code.coding !== undefined) add("code.coding", "no verified medicine code exists; text only");
  // Strength is free text: never an amount or ingredient strength.
  for (const k of ["amount", "ingredient", "batch", "manufacturer"]) {
    if (resource[k] !== undefined) add(k, "not recorded by mBHR");
  }
}

export const medicationModule: ResourceModule = { definition, read, search, validate };
