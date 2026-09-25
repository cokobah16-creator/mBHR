// Structural R4 checks run on every resource before the gateway sends it.
//
// This is a guard against mapper bugs, not a full FHIR validator: it checks
// the rules this module's resources can break (ids, required elements,
// status codes, reference and date formats, no empty elements). Each
// resource module adds its own type's rules (ResourceModule.validate). Full
// conformance is checked in CI with the HL7 FHIR Validator (see
// .github/workflows/interop-fhir.yml and docs/interoperability/testing.md).
// A resource that fails here is never sent: a read fails closed with a 500
// OperationOutcome, and a search leaves the record out and says so.

import { FHIR_ID } from "../search/params";

export interface ValidationIssue {
  path: string;
  message: string;
}

export type AddIssue = (path: string, message: string) => void;

export const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
export const DATE = /^\d{4}(-\d{2}(-\d{2})?)?$/;
export const DATETIME = /^(\d{4}(-\d{2}(-\d{2})?)?|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2}))$/;

/** Every type a published resource may reference. */
export const REFERENCE_TYPES = [
  "Patient",
  "Encounter",
  "Observation",
  "Condition",
  "AllergyIntolerance",
  "Medication",
  "MedicationRequest",
  "MedicationDispense",
  "ServiceRequest",
  "DiagnosticReport",
  "DocumentReference",
  "Binary",
  "Consent",
  "Practitioner",
  "PractitionerRole",
  "Organization",
  "Location",
  "Provenance",
  "AuditEvent",
];
const REFERENCE = new RegExp(`^(${REFERENCE_TYPES.join("|")})/[A-Za-z0-9\\-.]{1,64}$`);
const URI = /^[a-z][a-z0-9+.-]*:\S+$/i;

/** Elements typed dateTime (or date/instant, which dateTime also accepts) wherever they appear. */
const DATETIME_KEYS = [
  "effectiveDateTime",
  "onsetDateTime",
  "abatementDateTime",
  "recordedDate",
  "start",
  "end",
  "authoredOn",
  "whenPrepared",
  "whenHandedOver",
  "occurrenceDateTime",
  "occurredDateTime",
  "dateTime",
  "lastOccurrence",
  "date",
];
/** Elements typed instant. */
const INSTANT_KEYS = ["issued", "recorded", "lastUpdated", "timestamp", "creation"];

const STATUS: Record<string, string[]> = {
  Encounter: ["planned", "arrived", "triaged", "in-progress", "onleave", "finished", "cancelled", "entered-in-error", "unknown"],
  Observation: ["registered", "preliminary", "final", "amended", "corrected", "cancelled", "entered-in-error", "unknown"],
};

type Json = Record<string, unknown>;

export function isObj(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function validateResource(resource: unknown, extra?: (resource: Json, add: AddIssue) => void): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add: AddIssue = (path, message) => issues.push({ path, message });
  if (!isObj(resource)) return [{ path: "", message: "not a JSON object" }];
  const type = resource.resourceType;
  if (typeof type !== "string") return [{ path: "resourceType", message: "missing" }];

  if (typeof resource.id !== "string" || !FHIR_ID.test(resource.id)) add("id", "invalid FHIR id");
  if (isObj(resource.meta)) {
    const m = resource.meta;
    if (m.lastUpdated !== undefined && (typeof m.lastUpdated !== "string" || !INSTANT.test(m.lastUpdated))) {
      add("meta.lastUpdated", "not an instant");
    }
    if (m.versionId !== undefined && (typeof m.versionId !== "string" || !FHIR_ID.test(m.versionId))) {
      add("meta.versionId", "invalid");
    }
  } else {
    add("meta", "missing");
  }

  walk(resource, type, add);

  switch (type) {
    case "Patient":
      if (resource.gender !== undefined && !["male", "female", "other", "unknown"].includes(resource.gender as string)) {
        add("gender", "not an administrative-gender code");
      }
      if (resource.birthDate !== undefined && !DATE.test(String(resource.birthDate))) add("birthDate", "not a date");
      break;
    case "Encounter":
      if (!STATUS.Encounter.includes(resource.status as string)) add("status", "invalid");
      if (!isObj(resource.class) || typeof resource.class.code !== "string") add("class", "required");
      break;
    case "Observation":
      if (!STATUS.Observation.includes(resource.status as string)) add("status", "invalid");
      if (!isObj(resource.code)) add("code", "required");
      if (
        resource.valueQuantity === undefined &&
        resource.valueString === undefined &&
        resource.component === undefined &&
        resource.dataAbsentReason === undefined
      ) {
        add("value[x]", "an Observation needs a value, components or a dataAbsentReason");
      }
      break;
    case "Condition":
      if (!isObj(resource.subject)) add("subject", "required");
      if (isObj(resource.verificationStatus) && resource.clinicalStatus !== undefined) {
        const codes = (resource.verificationStatus.coding as Json[] | undefined)?.map((c) => c.code) ?? [];
        if (codes.includes("entered-in-error")) add("clinicalStatus", "con-5: not allowed when entered-in-error");
      }
      break;
    default:
      break;
  }
  if (extra) extra(resource, add);
  return issues;
}

/** Generic element rules: references, codings, dates, no empty values. */
function walk(value: unknown, path: string, add: AddIssue): void {
  if (Array.isArray(value)) {
    if (value.length === 0) add(path, "empty array (FHIR forbids empty elements)");
    value.forEach((v, i) => walk(v, `${path}[${i}]`, add));
    return;
  }
  if (!isObj(value)) {
    if (value === null || value === "") add(path, "empty value (FHIR forbids empty elements)");
    return;
  }
  const keys = Object.keys(value);
  if (keys.length === 0) add(path, "empty object");
  for (const k of keys) {
    const v = value[k];
    const p = `${path}.${k}`;
    if (v === undefined) continue;
    if (k === "reference" && (typeof v !== "string" || !REFERENCE.test(v))) add(p, "not a relative Type/id reference");
    // ContactPoint.system is a code (phone, email); elsewhere system is a URI.
    else if (k === "system" && !/telecom\[\d+\]$/.test(path) && (typeof v !== "string" || !URI.test(v))) {
      add(p, "system must be an absolute URI");
    } else if (DATETIME_KEYS.includes(k) && typeof v !== "object" && (typeof v !== "string" || !DATETIME.test(v))) {
      add(p, "not a FHIR dateTime");
    } else if (INSTANT_KEYS.includes(k) && (typeof v !== "string" || !INSTANT.test(v))) {
      add(p, "not a FHIR instant");
    } else if (k === "value" && path.endsWith("Quantity") && (typeof v !== "number" || !Number.isFinite(v))) {
      add(p, "quantity value must be a number");
    } else walk(v, p, add);
  }
}
