// Laboratory Observations <- public.lab_results (+ lab_orders).
// PLACEHOLDER: implemented by the laboratory work package. The Observation
// module (resources/observation.ts) composes this source with vital signs.

import type { Observation } from "../types/fhir";
import type { ParsedSearch } from "../search/params";
import type { QueryCtx, QueryResult } from "./module";
import { emptyResult } from "./module";

/** Observation ids of laboratory results: "lab-<lab_results.id>". */
export const LAB_OBSERVATION_PREFIX = "lab-";

export interface LabSearchInput {
  ctx: QueryCtx;
  search: ParsedSearch;
  /**
   * Internal patient ids to restrict to (canonical record plus merged-away
   * members), from ctx.patients; undefined when the search names no patient.
   */
  patientIds?: string[];
  /** Resume after this key (a lab_results.id), or null to start. */
  after: string | null;
  /** Maximum number of Observations to return. */
  count: number;
}

export interface LabSearchOutput {
  resources: Observation[];
  owners: (string | null)[];
  /** Key to resume after, or null when no more rows can match. */
  next: string | null;
}

export interface LabObservationSource {
  /** Whether this search can select laboratory rows at all (category, code, status, _id, based-on). */
  selects(search: ParsedSearch): boolean;
  read(ctx: QueryCtx, id: string): Promise<QueryResult<Observation>>;
  search(input: LabSearchInput): Promise<LabSearchOutput>;
}

export const labObservationSource: LabObservationSource = {
  selects: () => false,
  read: async () => emptyResult() as QueryResult<Observation>,
  search: async () => ({ resources: [], owners: [], next: null }),
};
