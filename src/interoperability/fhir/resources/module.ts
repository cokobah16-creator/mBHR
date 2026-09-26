// The contract every published resource type implements.
//
// A resource module reads rows AS THE CALLER (PostgREST under row-level
// security, or a fhir_* database function that applies its own checks),
// maps them with a pure mapper, and returns the resources together with the
// internal patient each one is about. It never decides access: the gateway
// has already run authorizeFhirRequest() before a module is called, and it
// re-checks every returned resource's patient against the caller's scope
// before anything is released.

import type { OperationOutcomeIssue, Resource } from "../types/fhir";
import type { ParsedSearch, RefusedSearchParam, SearchParamDef } from "../search/params";
import type { SearchPage } from "../search/bundle";
import type { Postgrest } from "../gateway/postgrest";
import type { StorageClient } from "../gateway/storage";
import type { FhirResourceType } from "../authorization/permissions";
import type { PatientSearchContext } from "../patients/canonical";
import type { AddIssue } from "../validation/validate";

/**
 * Whose records the caller may see.
 *   staff    every patient row-level security shows them (mBHR has no
 *            organisation or site boundary on clinical rows yet)
 *   patient  only their own linked records (from the server, never from
 *            the request), and only the classes the portal shows
 */
export interface AccessScope {
  kind: "staff" | "patient";
  /** Internal patients.id values a patient caller may see; null for staff. */
  patientIds: ReadonlySet<string> | null;
}

export interface QueryCtx {
  db: Postgrest;
  scope: AccessScope;
  /** The caller's mBHR permissions (empty for patients). */
  permissions: ReadonlySet<string>;
  /**
   * Restrictions from authorizeFhirRequest() the module must apply, e.g.
   * "no_lab_rows" (staff without lab permissions: Observation serves vital
   * signs only), "lab_events_only" (Provenance), "closed_encounters_only".
   */
  restrictions: ReadonlySet<string>;
  baseUrl: string;
  /** Binds cursors to this search, caller and scope (see search/params.ts). */
  cursorBinding: string;
  storage?: StorageClient;
  /**
   * The patient a search names through patient= / subject= (and the other
   * patient reference parameters in PATIENT_PARAMS), already resolved by
   * the gateway with resolvePatientSearch(): ids to filter on (canonical
   * record plus merged-away members), or null to match nothing. undefined
   * when the search names no patient. Modules must use this instead of
   * resolving the parameter again.
   */
  patients?: PatientSearchContext;
}

/** Search parameters that name a patient, resolved by the gateway before authorization. */
export const PATIENT_PARAMS: readonly string[] = ["patient", "subject"];

/** A file to stream back for a Binary read. */
export interface BinaryPayload {
  body: ArrayBuffer;
  contentType: string;
  size: number;
  /** A safe download name (ASCII letters, digits, dot, dash, underscore). */
  filename: string;
}

export interface QueryResult<T extends Resource = Resource> {
  page: SearchPage<T>;
  /**
   * Internal patients.id of each resource in page.resources, in the same
   * order; null for resources that are not about a patient (Practitioner,
   * Organization, ...). The gateway checks these against the caller's scope
   * and records them in the access audit.
   */
  owners: (string | null)[];
  /** Informational issues added to a searchset (entry.search.mode "outcome"). */
  outcomes?: OperationOutcomeIssue[];
  /** Internal ids of patients the request named (audited even when nothing matched). */
  requestedPatientIds?: string[];
  /** Binary reads only. */
  binary?: BinaryPayload;
}

export interface ResourceDefinition {
  type: FhirResourceType;
  source: string;
  idStrategy: string;
  fields: string[];
  /** Profiles the mapper guarantees (none are claimed in this release). */
  profiles: string[];
  interactions: ("read" | "search-type")[];
  searchParams: SearchParamDef[];
  /**
   * Parameters this type refuses with its own explanation (400
   * not-supported, whatever the value, modifier or other parameters)
   * instead of the generic "not supported". Not offered in the
   * CapabilityStatement; say why in `notes`.
   */
  refusedSearchParams?: readonly RefusedSearchParam[];
  /** A staff search must name one of these groups (anti-enumeration). */
  requiredSearch: string[][];
  writeSupport: false;
  /** Consent data class, used by consent provisions (data_class). */
  consentClass: "demographics" | "clinical" | "medication" | "laboratory" | "document" | "consent" | "directory" | "audit";
  readPermissions: readonly string[];
  /** Whether a portal patient may read it about themselves (when enabled). */
  patientAccess: boolean;
  /** Searches on this type count against the stricter rate limit. */
  sensitiveSearch: boolean;
  /** Plain-language limits, published in the CapabilityStatement documentation. */
  notes?: string[];
  /**
   * What a patient reading their own records gets. Published only while
   * patient access is enabled (FHIR_PATIENT_ACCESS_ENABLED), so the
   * statement never describes an access path that is switched off.
   */
  patientAccessNotes?: string[];
}

export interface ResourceModule {
  definition: ResourceDefinition;
  read(ctx: QueryCtx, id: string): Promise<QueryResult>;
  search?(ctx: QueryCtx, search: ParsedSearch): Promise<QueryResult>;
  /**
   * This type's own structural rules (required elements, invariants,
   * status codes), run by the gateway after the generic checks in
   * validation/validate.ts on every resource before release.
   */
  validate?(resource: Record<string, unknown>, add: AddIssue): void;
}

export function emptyResult(extra: Partial<QueryResult> = {}): QueryResult {
  return { page: { resources: [], next: null }, owners: [], ...extra };
}
