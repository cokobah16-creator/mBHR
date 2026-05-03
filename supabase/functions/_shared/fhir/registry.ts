// Resource registry: single source of truth for what FHIR resources this
// endpoint supports, what tables back them, what search parameters they
// accept, and which US Core profile they conform to.
//
// CapabilityStatement is generated from this registry (capability.ts), so
// adding a new resource means adding one entry here — no separate places to
// keep in sync.

import {
  mapAllergyIntoleranceToFHIR,
  mapCarePlanToFHIR,
  mapConditionToFHIR,
  mapDocumentReferenceToFHIR,
  mapEncounterToFHIR,
  mapGoalToFHIR,
  mapImmunizationToFHIR,
  mapMedicationDispenseToFHIR,
  mapMedicationRequestToFHIR,
  mapPatientToFHIR,
  mapProcedureToFHIR,
  mapServiceRequestToFHIR,
  type FhirRow,
} from "./mappers.ts";
import { US_CORE } from "./codes.ts";

export type SearchParamType = "token" | "reference" | "string" | "date";

export interface SearchParam {
  /** FHIR search parameter name as exposed to clients */
  name: string;
  type: SearchParamType;
  /**
   * Postgres column this search parameter filters on. Omit for params handled
   * by special logic (e.g. `patient`, `_id`).
   */
  column?: string;
}

export type Interaction =
  | "read"
  | "vread"
  | "search-type"
  | "history-instance"
  | "history-type";

export interface ResourceConfig {
  resourceType: string;
  /** US Core 7.0 profile URL */
  profile: string;
  /** Backing Postgres table */
  table: string;
  /** Default ORDER BY DESC column for search results */
  orderColumn: string;
  /** All FHIR search params advertised in CapabilityStatement */
  searchParams: SearchParam[];
  /** Mapper function for individual rows */
  mapper: (row: FhirRow, patientName?: string) => unknown | unknown[];
  /** Search interactions advertised in CapabilityStatement */
  interactions: Interaction[];
  /**
   * True for resources that have custom dispatch logic in index.ts (Patient,
   * Observation, DiagnosticReport). Generic registry-driven dispatch is not
   * used for these; their handlers live alongside the router.
   */
  customHandler?: boolean;
}

const baseInteractions: Interaction[] = ["read", "search-type"];

/** Resources that have snapshot triggers writing to resource_versions. */
const versionedInteractions: Interaction[] = [
  "read",
  "vread",
  "search-type",
  "history-instance",
];

export const RESOURCE_REGISTRY: ResourceConfig[] = [
  {
    resourceType: "Patient",
    profile: `${US_CORE}/us-core-patient`,
    table: "patients",
    orderColumn: "updated_at",
    interactions: versionedInteractions,
    customHandler: true,
    searchParams: [
      { name: "_id", type: "token" },
      { name: "identifier", type: "token" },
      { name: "name", type: "string" },
      { name: "birthdate", type: "date" },
    ],
    // Patient search/$everything are still handled by inline custom logic in
    // index.ts; the mapper is reused by history.ts for _history / vread.
    mapper: mapPatientToFHIR,
  },
  {
    resourceType: "Observation",
    profile: `${US_CORE}/us-core-vital-signs`,
    table: "vitals",
    orderColumn: "created_at",
    interactions: baseInteractions,
    customHandler: true,
    searchParams: [
      { name: "_id", type: "token" },
      { name: "patient", type: "reference" },
      { name: "category", type: "token" },
      { name: "date", type: "date" },
    ],
    mapper: () => {
      throw new Error("Observation uses customHandler dispatch");
    },
  },
  {
    resourceType: "MedicationRequest",
    profile: `${US_CORE}/us-core-medicationrequest`,
    table: "dispenses",
    orderColumn: "created_at",
    // History snapshots come from the prescriptions table trigger; reads here
    // still come from dispenses (the existing behavior). Future Phase B-3
    // could split MedicationRequest reads to also pull prescriptions.
    interactions: versionedInteractions,
    searchParams: [
      { name: "_id", type: "token" },
      { name: "patient", type: "reference" },
      { name: "authoredon", type: "date" },
    ],
    mapper: mapMedicationRequestToFHIR,
  },
  {
    resourceType: "MedicationDispense",
    profile: `${US_CORE}/us-core-medicationdispense`,
    table: "dispenses",
    orderColumn: "when_handed_over",
    // Phase B-3: dispenses has a snapshot trigger; the same row backs both
    // MedicationRequest and MedicationDispense and history.ts re-runs the
    // mapper at vread time per resource type.
    interactions: versionedInteractions,
    searchParams: [
      { name: "_id", type: "token" },
      { name: "patient", type: "reference" },
      { name: "status", type: "token", column: "dispense_status" },
      { name: "whenhandedover", type: "date" },
    ],
    mapper: mapMedicationDispenseToFHIR,
  },
  {
    resourceType: "Encounter",
    profile: `${US_CORE}/us-core-encounter`,
    table: "visits",
    orderColumn: "created_at",
    interactions: versionedInteractions,
    searchParams: [
      { name: "_id", type: "token" },
      { name: "patient", type: "reference" },
      { name: "date", type: "date" },
    ],
    mapper: mapEncounterToFHIR,
  },
  {
    resourceType: "Immunization",
    profile: `${US_CORE}/us-core-immunization`,
    table: "immunizations",
    orderColumn: "administered_at",
    interactions: versionedInteractions,
    searchParams: [
      { name: "_id", type: "token" },
      { name: "patient", type: "reference" },
      { name: "date", type: "date" },
      { name: "vaccine-code", type: "token" },
    ],
    mapper: mapImmunizationToFHIR,
  },
  {
    resourceType: "Condition",
    profile: `${US_CORE}/us-core-condition-problems-health-concerns`,
    table: "conditions",
    orderColumn: "created_at",
    interactions: versionedInteractions,
    searchParams: [
      { name: "_id", type: "token" },
      { name: "patient", type: "reference" },
      { name: "clinical-status", type: "token", column: "clinical_status" },
      { name: "category", type: "token", column: "category" },
    ],
    mapper: mapConditionToFHIR,
  },
  {
    resourceType: "AllergyIntolerance",
    profile: `${US_CORE}/us-core-allergyintolerance`,
    table: "patient_allergies",
    orderColumn: "created_at",
    interactions: versionedInteractions,
    searchParams: [
      { name: "_id", type: "token" },
      { name: "patient", type: "reference" },
      { name: "clinical-status", type: "token", column: "is_active" },
    ],
    mapper: mapAllergyIntoleranceToFHIR,
  },
  {
    resourceType: "DiagnosticReport",
    profile: `${US_CORE}/us-core-diagnosticreport-lab`,
    table: "lab_orders",
    orderColumn: "ordered_at",
    interactions: baseInteractions,
    customHandler: true,
    searchParams: [
      { name: "_id", type: "token" },
      { name: "patient", type: "reference" },
      { name: "category", type: "token" },
      { name: "status", type: "token" },
      { name: "date", type: "date" },
    ],
    mapper: () => {
      throw new Error("DiagnosticReport uses customHandler dispatch");
    },
  },
  {
    resourceType: "Procedure",
    profile: `${US_CORE}/us-core-procedure`,
    table: "procedures",
    orderColumn: "performed_at",
    interactions: versionedInteractions,
    searchParams: [
      { name: "_id", type: "token" },
      { name: "patient", type: "reference" },
      { name: "status", type: "token", column: "status" },
      { name: "date", type: "date" },
    ],
    mapper: mapProcedureToFHIR,
  },
  {
    resourceType: "DocumentReference",
    profile: `${US_CORE}/us-core-documentreference`,
    table: "document_references",
    orderColumn: "authored_at",
    interactions: versionedInteractions,
    searchParams: [
      { name: "_id", type: "token" },
      { name: "patient", type: "reference" },
      { name: "category", type: "token", column: "category" },
      { name: "status", type: "token", column: "status" },
      { name: "type", type: "token", column: "type_code" },
    ],
    mapper: mapDocumentReferenceToFHIR,
  },
  {
    resourceType: "CarePlan",
    profile: `${US_CORE}/us-core-careplan`,
    table: "care_plans",
    orderColumn: "created_at",
    interactions: versionedInteractions,
    searchParams: [
      { name: "_id", type: "token" },
      { name: "patient", type: "reference" },
      { name: "category", type: "token", column: "category" },
      { name: "status", type: "token", column: "status" },
    ],
    mapper: mapCarePlanToFHIR,
  },
  {
    resourceType: "Goal",
    profile: `${US_CORE}/us-core-goal`,
    table: "goals",
    orderColumn: "created_at",
    interactions: versionedInteractions,
    searchParams: [
      { name: "_id", type: "token" },
      { name: "patient", type: "reference" },
      {
        name: "lifecycle-status",
        type: "token",
        column: "lifecycle_status",
      },
    ],
    mapper: mapGoalToFHIR,
  },
  {
    resourceType: "ServiceRequest",
    profile: `${US_CORE}/us-core-servicerequest`,
    table: "service_requests",
    orderColumn: "occurrence_at",
    interactions: versionedInteractions,
    searchParams: [
      { name: "_id", type: "token" },
      { name: "patient", type: "reference" },
      { name: "status", type: "token", column: "status" },
      { name: "intent", type: "token", column: "intent" },
    ],
    mapper: mapServiceRequestToFHIR,
  },
];

export function getResourceConfig(
  resourceType: string,
): ResourceConfig | undefined {
  return RESOURCE_REGISTRY.find((r) => r.resourceType === resourceType);
}

export function isResourceSupported(resourceType: string): boolean {
  return RESOURCE_REGISTRY.some((r) => r.resourceType === resourceType);
}
