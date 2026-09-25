// Condition <- public.conditions (see mappers/condition.ts for the mapping rules).

import { errors } from "../errors/operationOutcome";
import type { Condition, OperationOutcomeIssue } from "../types/fhir";
import { READ_PERMISSIONS } from "../authorization/permissions";
import { CONDITION_COLUMNS, mapCondition } from "../mappers/condition";
import type { Row } from "../mappers/common";
import { CONDITION_CLINICAL, LOCAL, type VerifiedCoding } from "../terminology/codeSystems";
import { referenceContext } from "../patients/canonical";
import { parseId, parseToken, type ParsedSearch } from "../search/params";
import type { Postgrest } from "../gateway/postgrest";
import { emptyResult, type QueryCtx, type QueryResult, type ResourceDefinition, type ResourceModule } from "./module";
import { UUID, keysetPage, namedPatientFilter, one, ownersOf, patientNotes, scopeFilter, statusCode, type Filters } from "./shared";

export const conditionDefinition: ResourceDefinition = {
  type: "Condition",
  source: "public.conditions",
  idStrategy: "conditions.id (uuid)",
  fields: [
    "clinicalStatus",
    "verificationStatus",
    "category",
    "severity",
    "code (local + verified mappings)",
    "subject",
    "onsetDateTime",
    "abatementDateTime (left out when it contradicts an active status)",
    "recordedDate",
  ],
  profiles: [],
  interactions: ["read", "search-type"],
  searchParams: [
    { name: "_id", type: "token", documentation: "Logical id of the resource." },
    { name: "patient", type: "reference", documentation: "Patient/[id]. Required unless _id is given." },
    { name: "subject", type: "reference", documentation: "Same as patient (Patient/[id] only)." },
    { name: "clinical-status", type: "token", documentation: "A condition-clinical code." },
    { name: "code", type: "token", documentation: "An mBHR local condition code (https://mbhr.app/codes/condition)." },
  ],
  requiredSearch: [["_id"], ["patient"], ["subject"]],
  writeSupport: false,
  consentClass: "clinical",
  readPermissions: READ_PERMISSIONS.Condition,
  patientAccess: false,
  sensitiveSearch: false,
  notes: [
    "Diagnoses written in consultation notes are not published yet: an empty result does not mean the patient has no conditions.",
  ],
};

/**
 * Every Condition searchset says what it does not cover (phase1-audit D1):
 * the mBHR app records diagnoses in consultation notes, which this
 * interface does not publish yet, so an empty result is not "no conditions".
 */
export const CONDITION_COVERAGE_NOTE: OperationOutcomeIssue = {
  severity: "information",
  code: "informational",
  diagnostics:
    "mBHR records most diagnoses in consultation notes, which this interface does not publish yet. An empty or short result does not mean the patient has no other conditions.",
};

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

async function mapConditions(ctx: QueryCtx, rows: Row[]): Promise<(Condition | null)[]> {
  const [refs, verified] = await Promise.all([
    referenceContext(ctx.db, ownersOf(rows).filter((v): v is string => v !== null)),
    verifiedCodings(ctx.db, rows),
  ]);
  return rows.map((r) => mapCondition(r, refs, verified));
}

async function read(ctx: QueryCtx, id: string): Promise<QueryResult> {
  if (!UUID.test(id)) return emptyResult();
  const rows = await ctx.db.select("conditions", CONDITION_COLUMNS, [["id", `eq.${id}`], ...scopeFilter(ctx)], { limit: 1 });
  const mapped = await mapConditions(ctx, rows);
  const resources: Condition[] = [];
  const owners: (string | null)[] = [];
  mapped.forEach((c, i) => {
    if (c) {
      resources.push(c);
      owners.push(ownersOf([rows[i]])[0]);
    }
  });
  return { page: { resources, next: null }, owners };
}

const CLINICAL_STATUSES = ["active", "recurrence", "relapse", "inactive", "remission", "resolved"];

async function search(ctx: QueryCtx, search: ParsedSearch): Promise<QueryResult> {
  const notes = patientNotes(ctx);
  const outcomes = [...(notes.outcomes ?? []), CONDITION_COVERAGE_NOTE];
  const named = namedPatientFilter(ctx);
  if (named === null) return emptyResult({ ...notes, outcomes });
  const filters: Filters = [...scopeFilter(ctx), ...named];
  const idParam = one(search, "_id");
  if (idParam) {
    const id = parseId(idParam);
    if (!UUID.test(id)) return emptyResult({ ...notes, outcomes });
    filters.push(["id", `eq.${id}`]);
  }
  const clinical = one(search, "clinical-status");
  if (clinical) {
    const code = statusCode(clinical, "clinical-status", CONDITION_CLINICAL);
    if (code === null || !CLINICAL_STATUSES.includes(code)) return emptyResult({ ...notes, outcomes });
    filters.push(["clinical_status", `eq.${code}`]);
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
  const { page, rows } = await keysetPage<Condition>({
    db: ctx.db,
    table: "conditions",
    columns: CONDITION_COLUMNS,
    key: "id",
    keyPattern: UUID,
    filters,
    count: search.count,
    cursor: search.cursor,
    map: (r) => mapConditions(ctx, r),
  });
  return { page, owners: ownersOf(rows), ...notes, outcomes };
}

export const conditionModule: ResourceModule = { definition: conditionDefinition, read, search };
