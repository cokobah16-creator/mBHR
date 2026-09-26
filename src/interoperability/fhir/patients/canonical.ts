// The canonical-patient resolver, used by every resource module.
//
// When two mBHR records turn out to be the same person, merge_patients()
// keeps one (the canonical record) and marks the other merged_into it; most
// clinical rows move to the kept record, a few history tables keep the old
// id. Chains are possible (A merged into B, later B into C). The rules:
//
//   - A reference to a patient always names the canonical record: a row
//     still carrying a merged-away id is shown as the kept record's data.
//   - Searching by the kept record also finds rows still on its merged-away
//     ids (member ids).
//   - Searching by a merged-away record matches nothing and says so, with
//     an informational OperationOutcome naming the kept record (owner
//     decision: no silent redirection to another record).
//   - A chain that does not end (more than 10 steps, a record the caller
//     cannot see, or a merged record whose kept record was deleted) fails
//     closed: no reference is produced and nothing is matched.
//
// Resolution runs in the database (public.fhir_resolve_patients, SECURITY
// INVOKER), so row-level security applies: a caller can only resolve
// records they could read anyway.

import type { OperationOutcomeIssue } from "../types/fhir";
import type { MapContext } from "../mappers/common";
import type { Postgrest } from "../gateway/postgrest";
import { errors } from "../errors/operationOutcome";
import { parseReferenceId, type ParsedSearch } from "../search/params";
import { SOURCE_ID } from "../resources/shared";

export interface PatientResolution {
  /** The fhir_id or internal id that was asked about. */
  input: string;
  id: string;
  fhirId: string;
  merged: boolean;
  /** null when the chain does not end (chainOk false). */
  canonicalId: string | null;
  canonicalFhirId: string | null;
  /** false: the merge chain does not end in a visible, kept record. */
  chainOk: boolean;
  /** The canonical record and every record merged into it (internal ids). */
  memberIds: string[];
}

interface ResolveRow {
  input: unknown;
  id: unknown;
  fhir_id: unknown;
  merged: unknown;
  canonical_id: unknown;
  canonical_fhir_id: unknown;
  chain_ok: unknown;
  member_ids: unknown;
}

const MAX_INPUTS = 200;
const FHIR_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolvePatients(
  db: Postgrest,
  input: { fhirIds?: Iterable<string>; ids?: Iterable<string> },
): Promise<PatientResolution[]> {
  const fhirIds = [...new Set(input.fhirIds ?? [])].filter((v) => FHIR_UUID.test(v));
  const ids = [...new Set(input.ids ?? [])].filter((v) => SOURCE_ID.test(v));
  if (!fhirIds.length && !ids.length) return [];
  if (fhirIds.length + ids.length > MAX_INPUTS) throw errors.internal();
  const rows = await db.rpc<ResolveRow[]>("fhir_resolve_patients", { p_fhir_ids: fhirIds, p_ids: ids });
  if (!Array.isArray(rows)) throw errors.unavailable();
  const out: PatientResolution[] = [];
  for (const r of rows) {
    if (typeof r.input !== "string" || typeof r.id !== "string" || typeof r.fhir_id !== "string") continue;
    const canonicalId = typeof r.canonical_id === "string" ? r.canonical_id : null;
    const canonicalFhirId = typeof r.canonical_fhir_id === "string" ? r.canonical_fhir_id : null;
    // A chain only counts as ending when the kept record is named.
    const chainOk = r.chain_ok === true && canonicalId !== null && canonicalFhirId !== null;
    const members = Array.isArray(r.member_ids) ? r.member_ids.filter((m): m is string => typeof m === "string") : [];
    out.push({
      input: r.input,
      id: r.id,
      fhirId: r.fhir_id,
      merged: r.merged === true,
      canonicalId: chainOk ? canonicalId : null,
      canonicalFhirId: chainOk ? canonicalFhirId : null,
      chainOk,
      memberIds: chainOk ? (members.length ? members : [canonicalId as string]) : [],
    });
  }
  return out;
}

/**
 * Reference context for mapping rows: every internal patient id -> the
 * canonical record's published id. Ids whose chain does not end are left
 * out, so their rows produce no reference (and mappers drop them).
 */
export async function referenceContext(db: Postgrest, internalIds: Iterable<string>): Promise<MapContext> {
  const map = new Map<string, string>();
  const ids = [...new Set(internalIds)].filter((v) => typeof v === "string" && SOURCE_ID.test(v));
  for (let i = 0; i < ids.length; i += MAX_INPUTS) {
    for (const r of await resolvePatients(db, { ids: ids.slice(i, i + MAX_INPUTS) })) {
      if (r.chainOk && r.canonicalFhirId) map.set(r.input, r.canonicalFhirId);
    }
  }
  return { patientFhirIds: map };
}

export interface PatientSearchContext {
  /** Internal ids to filter on (canonical + members), or null: match nothing. */
  ids: string[] | null;
  /** Internal ids of the patient(s) the request named, for the audit. */
  requested: string[];
  /** Informational issue for the searchset (merged-away record named). */
  outcome?: OperationOutcomeIssue;
}

/**
 * The patient named by patient= / subject= (or another reference parameter
 * given in `params`), resolved to the internal ids to search on. undefined
 * when the search names no patient.
 */
export async function resolvePatientSearch(
  db: Postgrest,
  search: ParsedSearch,
  params: readonly string[] = ["patient", "subject"],
): Promise<PatientSearchContext | undefined> {
  const refs = params.flatMap((p) => (search.values.get(p) ?? []).map((v) => parseReferenceId(v, "Patient", p)));
  if (!refs.length) return undefined;
  const distinct = [...new Set(refs)];
  if (distinct.length > 1) return { ids: null, requested: [] };
  const [res] = await resolvePatients(db, { fhirIds: distinct });
  if (!res) return { ids: null, requested: [] };
  if (res.merged) {
    return {
      ids: null,
      requested: [res.id],
      outcome: res.chainOk
        ? {
            severity: "information",
            code: "informational",
            diagnostics: `Patient/${res.fhirId} was merged into Patient/${res.canonicalFhirId}. Records are kept under that patient: search again with it.`,
          }
        : {
            severity: "information",
            code: "informational",
            diagnostics: `Patient/${res.fhirId} was merged into another record that is not available.`,
          },
    };
  }
  if (!res.chainOk) return { ids: null, requested: [res.id] };
  return { ids: res.memberIds, requested: [res.id] };
}
