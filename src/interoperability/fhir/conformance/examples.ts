// Example output of every mapper and gateway response type, built from
// synthetic rows. Used by the unit tests and by the CI conformance job,
// which runs the HL7 FHIR Validator over them (scripts/fhir-r4-examples.ts,
// .github/workflows/interop-fhir.yml).

import type { Resource } from "../types/fhir";
import { mapPatient } from "../mappers/patient";
import { mapEncounter } from "../mappers/encounter";
import { mapVitalsRow } from "../mappers/observation";
import { mapCondition } from "../mappers/condition";
import { capabilityStatement } from "../capability/capabilityStatement";
import { searchsetBundle } from "../search/bundle";
import { operationOutcome } from "../errors/operationOutcome";

const PATIENT = {
  id: "01HZZEXAMPLEPATIENT000000",
  fhir_id: "7c0f6a52-3d0e-4f7e-9a51-5b8d2c1e0a01",
  given_name: "Example",
  family_name: "Patient",
  sex: "female",
  dob: "1984-03-02",
  phone: "08000000000",
  email: "example@example.org",
  address: "1 Example Street",
  lga: "Oshimili South",
  state: "Delta",
  merged_into: null,
  created_at: "2026-01-02T09:00:00Z",
  updated_at: "2026-05-01T10:30:00Z",
};

const VISIT = {
  id: "01HZZEXAMPLEVISIT00000000",
  patient_id: PATIENT.id,
  started_at: "2026-05-01T08:15:00Z",
  site_name: "Example outreach site",
  status: "closed",
  updated_at: "2026-05-01T12:00:00Z",
};

const VITALS = {
  id: "01HZZEXAMPLEVITALS0000000",
  patient_id: PATIENT.id,
  visit_id: VISIT.id,
  height_cm: 162,
  weight_kg: 61.5,
  temp_c: 36.8,
  pulse_bpm: 72,
  systolic: 128,
  diastolic: 84,
  spo2: 97,
  bmi: 23.4,
  taken_at: "2026-05-01T08:40:00Z",
  updated_at: "2026-05-01T08:41:00Z",
};

const CONDITION = {
  id: "c0ffee00-0000-4000-8000-000000000001",
  patient_id: PATIENT.id,
  condition_code: "EXAMPLE",
  condition_name: "Example provisional diagnosis",
  clinical_status: "active",
  verification_status: "provisional",
  category: "encounter-diagnosis",
  severity: "moderate",
  onset_date: "2026-04-28",
  abatement_date: null,
  created_at: "2026-05-01T09:00:00Z",
  updated_at: "2026-05-01T09:00:00Z",
};

export const EXAMPLE_BASE_URL = "https://mbhr.app/fhir/R4";

export function conformanceExamples(): Record<string, Resource> {
  const ctx = { patientFhirIds: new Map([[PATIENT.id, PATIENT.fhir_id]]) };
  const patient = mapPatient(PATIENT);
  const merged = mapPatient(
    { ...PATIENT, id: "01HZZEXAMPLEMERGED0000000", fhir_id: "7c0f6a52-3d0e-4f7e-9a51-5b8d2c1e0a02", merged_into: PATIENT.id },
    PATIENT.fhir_id,
  );
  const encounter = mapEncounter(VISIT, ctx)!;
  const observations = mapVitalsRow(VITALS, ctx);
  const condition = mapCondition(CONDITION, ctx)!;
  const enteredInError = mapCondition(
    { ...CONDITION, id: "c0ffee00-0000-4000-8000-000000000002", verification_status: "entered-in-error" },
    ctx,
  )!;

  const out: Record<string, Resource> = {
    "Patient-example": patient,
    "Patient-merged": merged,
    "Encounter-example": encounter,
    "Condition-provisional": condition,
    "Condition-entered-in-error": enteredInError,
    "CapabilityStatement-mbhr": capabilityStatement(EXAMPLE_BASE_URL) as Resource,
    "OperationOutcome-forbidden": operationOutcome("forbidden", "The requested resource is not available to this client."),
    "Bundle-observation-search": searchsetBundle({
      baseUrl: EXAMPLE_BASE_URL,
      resourceType: "Observation",
      query: new URLSearchParams(`patient=Patient/${PATIENT.fhir_id}`),
      count: 20,
      page: { resources: observations, next: null },
      now: new Date("2026-09-25T12:00:00Z"),
    }),
  };
  for (const o of observations) out[`Observation-${o.id!.slice(VITALS.id.length + 1)}`] = o;
  return out;
}
