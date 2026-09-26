// Practitioner <- mBHR staff accounts, read through
// public.fhir_staff_directory (see mappers/directory.ts for the mapping
// rules).
//
// The gateway does not read public.app_users itself (its id is the sign-in
// id, and production may hold private columns there) nor
// interop.resource_links (service role only), so every staff read goes
// through that one database function. It answers staff callers only (42501
// otherwise), returns the 8 staff roles only, never returns contact or
// credential columns, and gives each account a stable random id the first
// time it is returned. It takes at most one selector per call (ids, name or
// role); a search that names two of them sends one to the database (the id
// when given) and applies the other here, on the rows it returns, with the
// same rules.
//
// This file also holds the directory helpers PractitionerRole and other
// resource types use (staffDirectoryPage, practitionerReferences).

import { errors } from "../errors/operationOutcome";
import type { Reference, Resource } from "../types/fhir";
import { READ_PERMISSIONS } from "../authorization/permissions";
import type { Row } from "../mappers/common";
import {
  mapPractitioner,
  nameMatches,
  normaliseNameSearch,
  type Practitioner,
} from "../mappers/directory";
import { FHIR_ID, parseId, parseToken, type Cursor, type ParsedSearch } from "../search/params";
import type { Postgrest } from "../gateway/postgrest";
import type { AddIssue } from "../validation/validate";
import { emptyResult, type QueryCtx, type QueryResult, type ResourceDefinition, type ResourceModule } from "./module";
import { MAX_KEYSET_ROUNDS, checkCursorKey, one } from "./shared";

export const definition: ResourceDefinition = {
  type: "Practitioner",
  source:
    "mBHR staff accounts (public.app_users) whose role is one of the 8 staff roles, read through public.fhir_staff_directory",
  idStrategy:
    "A random uuid minted once per staff account by public.fhir_staff_directory and kept in interop.resource_links; the account id is never published",
  fields: [
    "name (text only, as recorded; never split into given and family names)",
    "active (only when the account records it: true, or false when switched off; otherwise left out)",
  ],
  profiles: [],
  interactions: ["read", "search-type"],
  searchParams: [
    { name: "_id", type: "token", documentation: "Logical id of the resource." },
    {
      name: "name",
      type: "string",
      documentation:
        "Case-insensitive start of the name or of any word in it. 2-64 letters, digits, spaces and . ' - _ % & ( ) /; % and _ match themselves.",
    },
    {
      name: "active",
      type: "token",
      documentation:
        "true or false. Only accounts that record the flag match; an account with no flag matches neither. Only together with _id or name.",
    },
  ],
  requiredSearch: [["_id"], ["name"]],
  writeSupport: false,
  consentClass: "directory",
  readPermissions: READ_PERMISSIONS.Practitioner,
  patientAccess: false,
  sensitiveSearch: false,
  notes: [
    "Name only: no contact details, qualifications, licence or registration numbers, and no account ids are published (mBHR records no qualifications).",
    "active is left out when the account does not record whether it is switched on: unknown is never shown as active.",
    "The mBHR role (PractitionerRole.code) is an access role, not a qualification.",
    "Staff only; not available to patients.",
  ],
};

// ---------------------------------------------------------------------------
// public.fhir_staff_directory
// ---------------------------------------------------------------------------

/** The database function's page limit (p_limit is clamped to 1..101). */
const DIRECTORY_MAX_LIMIT = 101;
/** p_fhir_ids / p_source_ids take at most 200 entries; lookups are sent in chunks of 100. */
const DIRECTORY_CHUNK = 100;
/** Account ids the function accepts (anything else, e.g. a typed name, is never looked up). */
const STAFF_SOURCE_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** At most one selector: the database function refuses two. */
export type StaffSelector =
  | { fhirIds: string[] }
  | { name: string }
  | { role: string };

/** Staff callers only. The gateway refuses other callers first; this keeps a module from asking. */
export function assertStaff(ctx: QueryCtx): void {
  if (ctx.scope.kind !== "staff") throw errors.forbidden();
}

/** One call of public.fhir_staff_directory. */
async function directoryCall(
  db: Postgrest,
  selector: StaffSelector | { sourceIds: string[] },
  after: string | null,
  limit: number,
): Promise<Row[]> {
  const rows = await db.rpc<unknown>("fhir_staff_directory", {
    p_fhir_ids: "fhirIds" in selector ? selector.fhirIds : null,
    p_source_ids: "sourceIds" in selector ? selector.sourceIds : null,
    p_name: "name" in selector ? selector.name : null,
    p_role: "role" in selector ? selector.role : null,
    p_after: after,
    p_limit: limit,
  });
  if (!Array.isArray(rows)) throw errors.unavailable();
  for (const r of rows as Row[]) {
    // The published id is the keyset key: a row without a valid one would
    // break paging (interop.resource_links enforces the format, so this
    // only happens on a database that broke its contract).
    if (!r || typeof r !== "object" || typeof r.fhir_id !== "string" || !FHIR_ID.test(r.fhir_id)) {
      throw errors.unavailable();
    }
  }
  return rows as Row[];
}

/**
 * Keyset paging over the staff directory (ordered by published id). `map`
 * returns null for a row the search's other conditions do not match; like
 * keysetPage(), fetching stops after MAX_KEYSET_ROUNDS batches and the page
 * is returned short with a next link, so a later match is never lost.
 */
export async function staffDirectoryPage<T extends Resource>(opts: {
  db: Postgrest;
  selector: StaffSelector;
  count: number;
  cursor: Cursor | null;
  map: (row: Row) => T | null;
}): Promise<{ resources: T[]; next: Cursor | null }> {
  checkCursorKey(opts.cursor, FHIR_ID);
  const batch = Math.min(Math.max(opts.count + 1, 25), DIRECTORY_MAX_LIMIT);
  const out: { res: T; key: string }[] = [];
  let after: string | null = opts.cursor?.k ?? null;
  for (let round = 0; round < MAX_KEYSET_ROUNDS; round++) {
    const rows = await directoryCall(opts.db, opts.selector, after, batch);
    for (const row of rows) {
      const key = row.fhir_id as string;
      const res = opts.map(row);
      if (res) {
        if (out.length === opts.count) {
          return { resources: out.map((o) => o.res), next: { k: out[out.length - 1].key } };
        }
        out.push({ res, key });
      }
      after = key;
    }
    if (rows.length < batch) return { resources: out.map((o) => o.res), next: null };
  }
  return { resources: out.map((o) => o.res), next: after !== null ? { k: after } : null };
}

/** One staff account by its published id (read interactions). */
export async function readStaff(ctx: QueryCtx, id: string): Promise<Row | null> {
  assertStaff(ctx);
  if (!FHIR_ID.test(id)) return null;
  const rows = await directoryCall(ctx.db, { fhirIds: [id] }, null, 1);
  return rows.find((r) => r.fhir_id === id) ?? null;
}

/**
 * Practitioner references for account ids recorded on clinical rows (for
 * example lab_results.reviewed_by), for other resource types' mappers.
 *
 *   - Staff callers only: a patient caller gets an empty map (the function
 *     refuses them), so the element is left out.
 *   - Only values shaped like an account id are looked up; a typed name or
 *     "" is never sent and never becomes a reference.
 *   - A value that matches no staff account (deleted, guest, a device id
 *     that never reached the server) is absent from the map: omit the
 *     element; never publish the raw value.
 *
 * The map is keyed by the account id as given; its values carry only the
 * published Practitioner id (plus the name as display when `withDisplay`).
 * Errors (403, 503) are thrown for the caller to handle.
 */
export async function practitionerReferences(
  ctx: QueryCtx,
  sourceIds: Iterable<unknown>,
  opts: { withDisplay?: boolean } = {},
): Promise<Map<string, Reference>> {
  const out = new Map<string, Reference>();
  if (ctx.scope.kind !== "staff") return out;
  const ids = [...new Set([...sourceIds].filter((v): v is string => typeof v === "string" && STAFF_SOURCE_ID.test(v)))];
  for (let i = 0; i < ids.length; i += DIRECTORY_CHUNK) {
    const chunk = ids.slice(i, i + DIRECTORY_CHUNK);
    const rows = await directoryCall(ctx.db, { sourceIds: chunk }, null, DIRECTORY_MAX_LIMIT);
    for (const r of rows) {
      const practitioner = mapPractitioner(r);
      if (!practitioner || typeof r.source_id !== "string" || !chunk.includes(r.source_id)) continue;
      const ref: Reference = { reference: `Practitioner/${practitioner.id}` };
      if (opts.withDisplay && practitioner.name?.[0]?.text) ref.display = practitioner.name[0].text;
      out.set(r.source_id, ref);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Search parameters shared with PractitionerRole
// ---------------------------------------------------------------------------

/** name=: normalised, or 400. */
export function parseStaffName(raw: string): string {
  const v = normaliseNameSearch(raw);
  if (v === null) {
    throw errors.badRequest("name must be 2-64 letters, digits, spaces or . ' - _ % & ( ) / characters.");
  }
  return v;
}

/** active=true|false (no system), or 400. */
export function parseActive(raw: string): boolean {
  const t = parseToken(raw, "active");
  if (t.system !== null || (t.code !== "true" && t.code !== "false")) {
    throw errors.badRequest("active must be true or false.");
  }
  return t.code === "true";
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

async function read(ctx: QueryCtx, id: string): Promise<QueryResult> {
  const row = await readStaff(ctx, id);
  const practitioner = row ? mapPractitioner(row) : null;
  return practitioner ? { page: { resources: [practitioner], next: null }, owners: [null] } : emptyResult();
}

async function search(ctx: QueryCtx, search: ParsedSearch): Promise<QueryResult> {
  assertStaff(ctx);
  const idParam = one(search, "_id");
  const nameParam = one(search, "name");
  const activeParam = one(search, "active");
  const id = idParam !== undefined ? parseId(idParam) : undefined;
  const name = nameParam !== undefined ? parseStaffName(nameParam) : undefined;
  const active = activeParam !== undefined ? parseActive(activeParam) : undefined;

  // The database applies one selector (the id when given, else the name);
  // the rest is applied here with the same rules.
  let selector: StaffSelector;
  if (id !== undefined) selector = { fhirIds: [id] };
  else if (name !== undefined) selector = { name };
  else throw errors.forbidden("A Practitioner search must name a specific record: give _id, or name.");

  const { resources, next } = await staffDirectoryPage<Practitioner>({
    db: ctx.db,
    selector,
    count: search.count,
    cursor: search.cursor,
    map: (row) => {
      if (id !== undefined && name !== undefined && !nameMatches(row.full_name, name)) return null;
      if (active !== undefined && row.active !== active) return null;
      return mapPractitioner(row);
    },
  });
  return { page: { resources, next }, owners: resources.map(() => null) };
}

/** Structural rules on top of validation/validate.ts. */
function validate(resource: Record<string, unknown>, add: AddIssue): void {
  const name = resource.name;
  if (!Array.isArray(name) || name.length !== 1 || typeof (name[0] as { text?: unknown })?.text !== "string") {
    add("name", "one name with text is required (the directory publishes the recorded name)");
  } else if (Object.keys(name[0] as object).some((k) => k !== "text")) {
    add("name", "only text: the recorded name is never split");
  }
  if (resource.active !== undefined && typeof resource.active !== "boolean") add("active", "must be a boolean");
  // Never published: contact details, credentials, identifiers (account ids).
  for (const k of ["identifier", "telecom", "address", "qualification", "gender", "birthDate", "photo", "communication"]) {
    if (resource[k] !== undefined) add(k, "not published for staff");
  }
}

export const practitionerModule: ResourceModule = { definition, read, search, validate };
