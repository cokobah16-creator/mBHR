// Helpers every resource module uses: typed PostgREST filters, the caller's
// patient scope as a filter, date ranges, and keyset paging.

import { errors } from "../errors/operationOutcome";
import { inList, type Postgrest, type ReadableTable } from "../gateway/postgrest";
import { intersectDates, parseDateSearch, type Cursor, type ParsedSearch } from "../search/params";
import type { SearchPage } from "../search/bundle";
import type { Resource } from "../types/fhir";
import type { Row } from "../mappers/common";
import type { QueryCtx, QueryResult, ResourceDefinition } from "./module";

export type Filters = [string, string][];

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** mBHR row ids: device ULIDs, uuids and a few prefixed text ids. */
export const SOURCE_ID = /^[A-Za-z0-9\-._:]{1,128}$/;

/** Rounds of keyset fetching per page before the page is cut short. */
export const MAX_KEYSET_ROUNDS = 5;

/** A value matched literally by (i)like: escapes the LIKE wildcards % and _ and the escape character. */
export function likeLiteral(value: string): string {
  return value.replace(/[\\%_*]/g, (c) => (c === "*" ? "" : `\\${c}`));
}

export function one(search: ParsedSearch, name: string): string | undefined {
  return search.values.get(name)?.[0];
}

/**
 * The caller's patient scope as a filter on `column`. Staff: nothing (row-
 * level security decides). Patients: their own linked records only, applied
 * in the database query itself, so another patient's row is never fetched.
 */
export function scopeFilter(ctx: QueryCtx, column = "patient_id"): Filters {
  if (ctx.scope.kind === "staff") return [];
  const ids = [...(ctx.scope.patientIds ?? [])];
  // No linked record: match nothing (an empty in.() is not valid PostgREST).
  if (!ids.length) return [[column, "is.null"], [column, "not.is.null"]];
  return [[column, inList(ids)]];
}

/** Restrict to the given internal patient ids (canonical record plus merged-away members). */
export function patientFilter(ids: string[], column = "patient_id"): Filters {
  return ids.length ? [[column, inList(ids)]] : [[column, "is.null"], [column, "not.is.null"]];
}

export function dateFilters(column: string, raw: string[] | undefined, name: string): Filters {
  if (!raw?.length) return [];
  const b = intersectDates(raw.map((r) => parseDateSearch(r, name)));
  const f: Filters = [];
  if (b.from) f.push([column, `gte.${b.from}`]);
  if (b.to) f.push([column, `lt.${b.to}`]);
  return f;
}

/** Staff searches must name a specific record (anti-enumeration). */
export function assertNarrowed(def: ResourceDefinition, search: ParsedSearch): void {
  const ok = def.requiredSearch.some((group) => group.every((p) => search.values.has(p)));
  if (!ok) {
    const options = def.requiredSearch.map((g) => g.join(" + ")).join(", or ");
    throw errors.forbidden(`A ${def.type} search must name a specific record: give ${options}.`);
  }
}

/** A cursor key must look like the key it was issued for (else 400, not a database error). */
export function checkCursorKey(cursor: Cursor | null, pattern: RegExp): void {
  if (cursor && !pattern.test(cursor.k)) {
    throw errors.badRequest("_cursor is not valid. Start the search again.");
  }
}

export interface KeysetOptions<T extends Resource> {
  db: Postgrest;
  table: ReadableTable;
  columns: readonly string[];
  /** Unique, sortable key column; also the cursor key. */
  key: string;
  keyPattern: RegExp;
  filters: Filters;
  count: number;
  cursor: Cursor | null;
  /** Map a batch of rows; null for a row that yields no resource. */
  map: (rows: Row[]) => Promise<(T | null)[]>;
}

/**
 * Keyset paging over rows that each map to at most one resource.
 *
 * The page holds up to `count` resources. When rows keep mapping to nothing
 * (e.g. rows the mapper withholds), fetching stops after MAX_KEYSET_ROUNDS
 * batches and the page is returned short, WITH a next link that resumes
 * after the last row examined, so a later match is never silently lost.
 */
export async function keysetPage<T extends Resource>(
  opts: KeysetOptions<T>,
): Promise<{ page: SearchPage<T>; rows: Row[] }> {
  checkCursorKey(opts.cursor, opts.keyPattern);
  const batch = Math.min(Math.max(opts.count + 1, 25), 101);
  const out: { res: T; row: Row }[] = [];
  let after: string | null = opts.cursor?.k ?? null;
  for (let round = 0; round < MAX_KEYSET_ROUNDS; round++) {
    const f: Filters = [...opts.filters];
    if (after !== null) f.push([opts.key, `gt.${after}`]);
    const rows = await opts.db.select(opts.table, opts.columns, f, { order: `${opts.key}.asc`, limit: batch });
    const mapped = await opts.map(rows);
    for (let i = 0; i < rows.length; i++) {
      const res = mapped[i];
      if (res) {
        if (out.length === opts.count) {
          // Another match exists: the page is full, resume after its last entry.
          return finish(out, { k: String(out[out.length - 1].row[opts.key]) });
        }
        out.push({ res, row: rows[i] });
      }
      after = String(rows[i][opts.key]);
    }
    if (rows.length < batch) return finish(out, null);
  }
  // Round limit reached with rows possibly left: resume after the last row examined.
  return finish(out, after !== null ? { k: after } : null);
}

function finish<T extends Resource>(
  out: { res: T; row: Row }[],
  next: Cursor | null,
): { page: SearchPage<T>; rows: Row[] } {
  return { page: { resources: out.map((o) => o.res), next }, rows: out.map((o) => o.row) };
}

export function ownersOf(rows: Row[], column = "patient_id"): (string | null)[] {
  return rows.map((r) => (typeof r[column] === "string" ? (r[column] as string) : null));
}

/**
 * Filter for the patient the search names (ctx.patients, resolved by the
 * gateway): null when the search can match nothing (unknown or merged-away
 * patient, or two different patients named), [] when it names none.
 */
export function namedPatientFilter(ctx: QueryCtx, column = "patient_id"): Filters | null {
  if (!ctx.patients) return [];
  if (ctx.patients.ids === null) return null;
  return patientFilter(ctx.patients.ids, column);
}

/** The named-patient bookkeeping every search result carries. */
export function patientNotes(ctx: QueryCtx): Pick<QueryResult, "outcomes" | "requestedPatientIds"> {
  const out: Pick<QueryResult, "outcomes" | "requestedPatientIds"> = {};
  if (ctx.patients?.outcome) out.outcomes = [ctx.patients.outcome];
  if (ctx.patients?.requested.length) out.requestedPatientIds = ctx.patients.requested;
  return out;
}
