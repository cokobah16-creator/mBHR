// The mapping registry: one entry per published FHIR resource type, stating
// where it comes from, how its id is formed, what it fills, how it can be
// searched, and who may read it. The CapabilityStatement, the gateway's
// parameter allowlists and docs/interoperability/resource-mapping.md are all
// derived from (or checked against) this table, so they cannot drift apart.

import type { FhirResourceType } from "../authorization/permissions";
import { READ_PERMISSIONS } from "../authorization/permissions";
import type { SearchParamDef } from "../search/params";

export interface ResourceDefinition {
  type: FhirResourceType;
  source: string;
  idStrategy: string;
  fields: string[];
  profiles: string[];
  interactions: ("read" | "search-type")[];
  searchParams: SearchParamDef[];
  /** Search must name one of these groups (anti-enumeration). */
  requiredSearch: string[][];
  writeSupport: false;
  consentSensitivity: string;
  readPermissions: readonly string[];
}

const ID: SearchParamDef = { name: "_id", type: "token", documentation: "Logical id of the resource." };
const PATIENT: SearchParamDef = {
  name: "patient",
  type: "reference",
  documentation: "Patient/[id]. Required unless _id is given.",
};
const SUBJECT: SearchParamDef = {
  name: "subject",
  type: "reference",
  documentation: "Same as patient (Patient/[id] only).",
};

export const RESOURCE_DEFINITIONS: Record<FhirResourceType, ResourceDefinition> = {
  Patient: {
    type: "Patient",
    source: "public.patients",
    idStrategy: "patients.fhir_id (random uuid kept for FHIR); patients.id is never published",
    fields: ["identifier", "active (false only when merged)", "name", "telecom", "gender", "birthDate", "address", "link (replaced-by)"],
    profiles: [],
    interactions: ["read", "search-type"],
    searchParams: [
      ID,
      {
        name: "identifier",
        type: "token",
        documentation: "https://mbhr.app/identifiers/patient|[id]. The only identifier mBHR records.",
      },
      {
        name: "name",
        type: "string",
        documentation: "Starts-with match on given or family name. Only together with birthdate.",
      },
      { name: "birthdate", type: "date", documentation: "Exact date (YYYY-MM-DD). Only together with name." },
    ],
    requiredSearch: [["_id"], ["identifier"], ["name", "birthdate"]],
    writeSupport: false,
    consentSensitivity: "demographics",
    readPermissions: READ_PERMISSIONS.Patient,
  },
  Encounter: {
    type: "Encounter",
    source: "public.visits",
    idStrategy: "visits.id",
    fields: ["status", "class (AMB)", "subject", "period.start", "location (display only)"],
    profiles: [],
    interactions: ["read", "search-type"],
    searchParams: [
      ID,
      PATIENT,
      SUBJECT,
      { name: "date", type: "date", documentation: "Visit start (visits.started_at). Up to two bounds.", maxRepeats: 2 },
      {
        name: "status",
        type: "token",
        documentation: "in-progress, finished, cancelled or unknown.",
      },
    ],
    requiredSearch: [["_id"], ["patient"], ["subject"]],
    writeSupport: false,
    consentSensitivity: "clinical",
    readPermissions: READ_PERMISSIONS.Encounter,
  },
  Observation: {
    type: "Observation",
    source: "public.vitals (one row -> up to 7 vital-sign Observations)",
    idStrategy: "<vitals.id>-<kind> (bp, heart-rate, temperature, weight, height, bmi, spo2)",
    fields: ["status (final)", "category (vital-signs)", "code (LOINC + local)", "subject", "encounter", "effectiveDateTime", "valueQuantity (UCUM)", "component (blood pressure)"],
    profiles: ["http://hl7.org/fhir/StructureDefinition/vitalsigns"],
    interactions: ["read", "search-type"],
    searchParams: [
      ID,
      PATIENT,
      SUBJECT,
      { name: "encounter", type: "reference", documentation: "Encounter/[id]." },
      { name: "date", type: "date", documentation: "When measured (vitals.taken_at). Up to two bounds.", maxRepeats: 2 },
      { name: "category", type: "token", documentation: "vital-signs is the only category published." },
      { name: "code", type: "token", documentation: "A LOINC code from the vital signs profile, or an mBHR vitals column code." },
      { name: "status", type: "token", documentation: "final is the only status published." },
    ],
    requiredSearch: [["_id"], ["patient"], ["subject"], ["encounter"]],
    writeSupport: false,
    consentSensitivity: "clinical",
    readPermissions: READ_PERMISSIONS.Observation,
  },
  Condition: {
    type: "Condition",
    source: "public.conditions",
    idStrategy: "conditions.id (uuid)",
    fields: ["clinicalStatus", "verificationStatus", "category", "severity", "code (local + verified mappings)", "subject", "onsetDateTime", "abatementDateTime", "recordedDate"],
    profiles: [],
    interactions: ["read", "search-type"],
    searchParams: [
      ID,
      PATIENT,
      SUBJECT,
      { name: "clinical-status", type: "token", documentation: "A condition-clinical code." },
      { name: "code", type: "token", documentation: "An mBHR local condition code (https://mbhr.app/codes/condition)." },
    ],
    requiredSearch: [["_id"], ["patient"], ["subject"]],
    writeSupport: false,
    consentSensitivity: "clinical (diagnoses)",
    readPermissions: READ_PERMISSIONS.Condition,
  },
};

export const PUBLISHED_TYPES = Object.keys(RESOURCE_DEFINITIONS) as FhirResourceType[];

export function isPublishedType(t: string): t is FhirResourceType {
  return Object.prototype.hasOwnProperty.call(RESOURCE_DEFINITIONS, t);
}
