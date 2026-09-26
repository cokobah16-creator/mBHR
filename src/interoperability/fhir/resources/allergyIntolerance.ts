// AllergyIntolerance <- public.patient_allergies (see mappers/allergy.ts for
// the mapping rules and terminology/status/allergy.ts for the value tables).
//
// Staff only: register, vitals, consult or dispense (the people who check
// allergies at each step in the app). Portal patients are refused by
// authorizeFhirRequest (the portal does not show allergies); should a
// patient scope ever reach this module, it reads nothing.
//
// Every searchset, empty or not, carries ALLERGY_NKA_CAVEAT: mBHR cannot
// record "no known allergies", so an empty result is never a statement that
// the patient has none.
//
// An allergy whose patient cannot be resolved to a current record (a merge
// chain that does not end, a merged record whose kept record is missing, a
// record the caller cannot see) is never published under a guessed
// patient, and it is never dropped silently either: a searchset says how
// many were left out (allergyLeftOutWarning), and a read fails closed with
// 500 instead of answering "not found" for an allergy that exists.
//
// Ids are handled as opaque strings. The repository defines
// patient_allergies.id as uuid, but tablets create ULIDs and the production
// column type is not confirmed; an id the column cannot hold (the database
// refuses it as a value of the wrong type) simply matches nothing.

import { FhirError, errors } from "../errors/operationOutcome";
import { READ_PERMISSIONS } from "../authorization/permissions";
import {
  ALLERGY_CATEGORY_SYSTEM,
  ALLERGY_CLINICAL_SYSTEM,
  ALLERGY_COLUMNS,
  ALLERGY_CRITICALITY_SYSTEM,
  ALLERGY_NKA_CAVEAT,
  mapAllergy,
  validateAllergyIntolerance,
  type AllergyIntolerance,
} from "../mappers/allergy";
import type { Row } from "../mappers/common";
import type { OperationOutcomeIssue } from "../types/fhir";
import { referenceContext } from "../patients/canonical";
import { pgrstQuote } from "../gateway/postgrest";
import { FHIR_ID, parseId, parseToken, type Cursor, type ParsedSearch, type TokenValue } from "../search/params";
import { sourceValuesFor, type StatusMap } from "../terminology/statusMaps";
import { ALLERGY_CATEGORY, ALLERGY_CLINICAL_STATUS, ALLERGY_CRITICALITY } from "../terminology/status/allergy";
import { emptyResult, type QueryCtx, type QueryResult, type ResourceDefinition, type ResourceModule } from "./module";
import {
  SOURCE_ID,
  checkCursorKey,
  keysetPage,
  likeLiteral,
  namedPatientFilter,
  one,
  ownersOf,
  patientNotes,
  scopeFilter,
  type Filters,
} from "./shared";

export const definition: ResourceDefinition = {
  type: "AllergyIntolerance",
  source: "public.patient_allergies",
  idStrategy: "patient_allergies.id as stored (opaque: a uuid, or a device ULID where the column holds text)",
  fields: [
    "clinicalStatus (is_active: true -> active, false -> inactive; a record without a value is withheld, never shown as active)",
    "category (food or environment, only when staff chose that type; medication is the form's pre-selected type and is never published)",
    "criticality (high, only for allergies rated life-threatening)",
    "code.text (the allergen exactly as recorded; no substance coding)",
    "patient",
    "onsetDateTime (date only)",
    "recordedDate (when the allergy was recorded, by the tablet's clock)",
    "recorder (Practitioner, only when the recording account is in the staff directory)",
    "reaction.manifestation.text (the reaction as recorded) and reaction.severity (moderate, or severe for allergies rated severe or life-threatening; never mild)",
  ],
  profiles: [],
  interactions: ["read", "search-type"],
  searchParams: [
    { name: "_id", type: "token", documentation: "Logical id of the resource." },
    {
      name: "patient",
      type: "reference",
      documentation:
        "Patient/[id]. Required unless _id is given. Includes allergies still filed under a record that was merged into this patient.",
    },
    {
      name: "clinical-status",
      type: "token",
      documentation: "active or inactive (allergyintolerance-clinical). resolved matches nothing: mBHR does not record it.",
    },
    {
      name: "category",
      type: "token",
      documentation:
        "food or environment. medication and biologic match nothing: medication is the form's pre-selected type, so no category is published for it. Allergies recorded as 'other' have no category and never match.",
    },
    {
      name: "criticality",
      type: "token",
      documentation: "high (allergies rated life-threatening). low and unable-to-assess match nothing: mBHR does not record them.",
    },
  ],
  requiredSearch: [["_id"], ["patient"]],
  writeSupport: false,
  consentClass: "clinical",
  readPermissions: READ_PERMISSIONS.AllergyIntolerance,
  patientAccess: false,
  sensitiveSearch: false,
  notes: [
    "mBHR does not record 'no known allergies': an empty result means no allergy has been recorded, not that the patient has none. Every searchset says so.",
    "Allergies recorded on a tablet that has not synced yet are not included.",
    "No verificationStatus or type: mBHR does not record whether an allergy was confirmed, or whether it is an allergy or an intolerance.",
    "inactive means a staff member removed the allergy from the app's warnings; mBHR records no reason (resolved, recorded in error or a duplicate).",
    "The allergen and the reaction are free text as recorded: no substance code is published, and one record may name several substances.",
    "No category is sent for allergies saved with the form's pre-selected type (medication), because it may mean nobody chose one. A missing category does not mean the allergy is not to a medicine.",
    "After a merge, allergies from both records are listed under the kept patient as recorded, including duplicates.",
    "An allergy whose patient record cannot be resolved (for example a merged record whose kept record is missing) is not published: a searchset then carries a warning saying how many were left out, and a read returns an error rather than 'not found'.",
    "Staff notes and staff account ids are never published. Patients cannot read allergies through this interface.",
  ],
};

// ---------------------------------------------------------------------------
// Recorder: staff account id -> published Practitioner id
// ---------------------------------------------------------------------------

/** The account ids fhir_staff_directory accepts (it refuses the whole call otherwise). */
const STAFF_SOURCE_ID = /^[A-Za-z0-9._-]{1,128}$/;
/** fhir_staff_directory returns at most 101 rows per call. */
const DIRECTORY_BATCH = 101;

interface DirectoryRow {
  fhir_id?: unknown;
  source_id?: unknown;
}

/**
 * Resolve created_by account ids through public.fhir_staff_directory
 * (p_source_ids mode, staff callers only), which mints stable Practitioner
 * ids. An id it does not return (a device-made account, "patient-submitted",
 * a guest) gets no recorder. The recorder is optional, so if the directory
 * cannot be reached the allergies are still served, without it.
 */
async function practitionerIds(ctx: QueryCtx, rows: Row[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ctx.scope.kind !== "staff") return out;
  const ids = [
    ...new Set(rows.map((r) => r.created_by).filter((v): v is string => typeof v === "string" && STAFF_SOURCE_ID.test(v))),
  ];
  for (let i = 0; i < ids.length; i += DIRECTORY_BATCH) {
    const chunk = ids.slice(i, i + DIRECTORY_BATCH);
    let found: unknown;
    try {
      found = await ctx.db.rpc<unknown>("fhir_staff_directory", { p_source_ids: chunk, p_limit: DIRECTORY_BATCH });
    } catch {
      // Leave the recorder out rather than fail a safety-relevant read.
      break;
    }
    for (const r of Array.isArray(found) ? (found as DirectoryRow[]) : []) {
      if (
        r &&
        typeof r.source_id === "string" &&
        chunk.includes(r.source_id) &&
        typeof r.fhir_id === "string" &&
        FHIR_ID.test(r.fhir_id)
      ) {
        out.set(r.source_id, r.fhir_id);
      }
    }
  }
  return out;
}

/**
 * Map a batch of rows. null for a row that cannot be published: its patient
 * does not resolve to a visible canonical record (the id column is the
 * primary key, so that is the only way a fetched row maps to nothing).
 */
async function mapAllergies(ctx: QueryCtx, rows: Row[]): Promise<(AllergyIntolerance | null)[]> {
  const [refs, practitioners] = await Promise.all([
    referenceContext(ctx.db, ownersOf(rows).filter((v): v is string => v !== null)),
    practitionerIds(ctx, rows),
  ]);
  return rows.map((r) => mapAllergy(r, { ...refs, practitionerIds: practitioners }));
}

// ---------------------------------------------------------------------------
// Allergies left out because their patient does not resolve
// ---------------------------------------------------------------------------

/**
 * The searchset warning for matching allergies that were left out because
 * their patient record could not be resolved. Without it, the searchset's
 * only note would be ALLERGY_NKA_CAVEAT ("an empty result means no allergy
 * has been recorded"), which would be untrue: these allergies are recorded.
 */
export function allergyLeftOutWarning(count: number): OperationOutcomeIssue {
  return {
    severity: "warning",
    code: "processing",
    diagnostics: `${count} matching allergy record(s) were left out because the patient record they are filed under could not be resolved (for example a merged record whose kept record is missing). These allergies are recorded but not shown: this result is not the complete list. Quote the X-Request-Id header when reporting this.`,
  };
}

/** A row keysetPage fetched, and whether it mapped to nothing. */
export interface ExaminedRow {
  key: string;
  leftOut: boolean;
}

/**
 * How many of the rows this page covers were left out.
 *
 * keysetPage maps whole batches, but when the page fills it stops part-way
 * through a batch and the next link resumes after the page's last entry, so
 * the rows after that entry are fetched and looked at again for the next
 * page. Only rows up to the one the next link resumes after are counted
 * here, so each left-out row is reported on exactly one page. With no next
 * link, every fetched row belongs to this page. (Should the resume key not
 * be among the fetched rows, which keysetPage never does, every left-out
 * row is counted: a warning repeated on the next page is safer than none.)
 */
export function leftOutOnPage(examined: readonly ExaminedRow[], next: Cursor | null): number {
  let end = examined.length;
  if (next) {
    const i = examined.map((e) => e.key).lastIndexOf(next.k);
    if (i >= 0) end = i + 1;
  }
  return examined.slice(0, end).filter((e) => e.leftOut).length;
}

/**
 * The database refused a value for its column's type (PostgREST 22P02 and
 * friends, reported as 400): for an id, that id cannot exist.
 */
function isRefusedValue(e: unknown): boolean {
  return e instanceof FhirError && e.status === 400;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

async function read(ctx: QueryCtx, id: string): Promise<QueryResult> {
  // Patients are refused before this point; never read for one.
  if (ctx.scope.kind !== "staff") return emptyResult();
  if (!SOURCE_ID.test(id)) return emptyResult();
  let rows: Row[];
  try {
    rows = await ctx.db.select("patient_allergies", ALLERGY_COLUMNS, [["id", `eq.${id}`], ...scopeFilter(ctx)], { limit: 1 });
  } catch (e) {
    if (isRefusedValue(e)) return emptyResult();
    throw e;
  }
  const mapped = await mapAllergies(ctx, rows);
  const resources: AllergyIntolerance[] = [];
  const owners: (string | null)[] = [];
  mapped.forEach((a, i) => {
    if (a) {
      resources.push(a);
      owners.push(ownersOf([rows[i]])[0]);
    }
  });
  // The allergy exists but its patient does not resolve: fail closed (500,
  // audited by the gateway) rather than answer "not found" for a recorded
  // allergy, the same as the gateway does for a record that fails
  // validation on a read.
  if (rows.length && !resources.length) throw errors.internal();
  return { page: { resources, next: null }, owners };
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/** A token matches a code element when it names no system, or the element's own system. */
function systemMatches(t: TokenValue, system: string): boolean {
  return t.system === null || t.system === system;
}

/**
 * clinical-status: is_active is a boolean, so the recorded values the map
 * lists for the code ("true", "false") become is_active.is.<value> (an
 * ilike does not apply to a boolean column). null: matches nothing.
 */
function clinicalStatusFilter(t: TokenValue): Filters | null {
  if (!systemMatches(t, ALLERGY_CLINICAL_SYSTEM)) return null;
  const values = sourceValuesFor(ALLERGY_CLINICAL_STATUS, t.code).filter((v) => v === "true" || v === "false");
  if (!values.length) return null;
  return [["or", `(${values.map((v) => `is_active.is.${v}`).join(",")})`]];
}

/**
 * A text column matched against the recorded values a map lists for the
 * code, case-insensitively and literally (the same comparison the mapper
 * makes). null: matches nothing.
 */
function valueFilter(map: StatusMap, column: string, code: string): Filters | null {
  const values = sourceValuesFor(map, code);
  if (!values.length) return null;
  return [["or", `(${values.map((v) => `${column}.ilike.${pgrstQuote(likeLiteral(v))}`).join(",")})`]];
}

async function search(ctx: QueryCtx, search: ParsedSearch): Promise<QueryResult> {
  const notes = patientNotes(ctx);
  // Owner decision 9: every searchset says that no result is not "no allergies".
  const outcomes = [...(notes.outcomes ?? []), ALLERGY_NKA_CAVEAT];
  const nothing = () => emptyResult({ ...notes, outcomes });
  if (ctx.scope.kind !== "staff") return nothing();

  const named = namedPatientFilter(ctx);
  if (named === null) return nothing();
  const filters: Filters = [...scopeFilter(ctx), ...named];

  const idParam = one(search, "_id");
  if (idParam) filters.push(["id", `eq.${parseId(idParam)}`]);

  const clinical = one(search, "clinical-status");
  if (clinical) {
    const f = clinicalStatusFilter(parseToken(clinical, "clinical-status"));
    if (!f) return nothing();
    filters.push(...f);
  }
  const category = one(search, "category");
  if (category) {
    const t = parseToken(category, "category");
    const f = systemMatches(t, ALLERGY_CATEGORY_SYSTEM) ? valueFilter(ALLERGY_CATEGORY, "allergy_type", t.code) : null;
    if (!f) return nothing();
    filters.push(...f);
  }
  const criticality = one(search, "criticality");
  if (criticality) {
    const t = parseToken(criticality, "criticality");
    const f = systemMatches(t, ALLERGY_CRITICALITY_SYSTEM) ? valueFilter(ALLERGY_CRITICALITY, "severity", t.code) : null;
    if (!f) return nothing();
    filters.push(...f);
  }

  // A malformed cursor is the caller's error (400), checked before the
  // query so it is not mistaken for an id the column cannot hold.
  checkCursorKey(search.cursor, SOURCE_ID);
  try {
    // Every fetched row, in order, and whether it mapped to nothing, so the
    // page can say how many matching allergies it had to leave out.
    const examined: ExaminedRow[] = [];
    const { page, rows } = await keysetPage<AllergyIntolerance>({
      db: ctx.db,
      table: "patient_allergies",
      columns: ALLERGY_COLUMNS,
      key: "id",
      keyPattern: SOURCE_ID,
      filters,
      count: search.count,
      cursor: search.cursor,
      map: async (batch) => {
        const mapped = await mapAllergies(ctx, batch);
        batch.forEach((r, i) => examined.push({ key: String(r.id), leftOut: mapped[i] === null }));
        return mapped;
      },
    });
    const leftOut = leftOutOnPage(examined, page.next);
    return {
      page,
      owners: ownersOf(rows),
      ...notes,
      outcomes: leftOut ? [...outcomes, allergyLeftOutWarning(leftOut)] : outcomes,
    };
  } catch (e) {
    // Only an _id can carry a value the id column refuses.
    if (idParam && isRefusedValue(e)) return nothing();
    throw e;
  }
}

export const allergyIntoleranceModule: ResourceModule = {
  definition,
  read,
  search,
  validate: validateAllergyIntolerance,
};
