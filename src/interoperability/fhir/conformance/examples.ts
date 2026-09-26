// Example output of every mapper and gateway response type, built from
// synthetic rows. Used by the unit tests and by the CI conformance job,
// which runs the HL7 FHIR Validator over them (scripts/fhir-r4-examples.ts,
// .github/workflows/interop-fhir.yml).

import type { Reference, Resource } from "../types/fhir";
import { mapPatient } from "../mappers/patient";
import { mapEncounter } from "../mappers/encounter";
import { mapVitalsRow } from "../mappers/observation";
import { mapCondition } from "../mappers/condition";
import { capabilityStatement } from "../capability/capabilityStatement";
import { searchsetBundle } from "../search/bundle";
import { operationOutcome } from "../errors/operationOutcome";
import { ALLERGY_NKA_CAVEAT, mapAllergy, type AllergyMapContext } from "../mappers/allergy";
import { allergyLeftOutWarning } from "../resources/allergyIntolerance";
import {
  itemDescription,
  lineItemId,
  mapMedication,
  mapMedicationDispense,
  mapMedicationRequest,
  prescriptionLines,
  type CatalogueEntry,
  type MedicationMapContext,
} from "../mappers/medication";
import { mapDiagnosticReport, mapLabObservation, mapServiceRequest } from "../mappers/laboratory";
import { mapBinary, mapDocumentReference } from "../mappers/document";
import { mapLocation, mapOrganization, mapPractitioner, mapPractitionerRole } from "../mappers/directory";
import { mapConsent } from "../mappers/consent";
import { mapDocumentUploadEvent, mapLabReleaseEvent, mapMergeEvent, type LabEventLinks } from "../mappers/provenance";
import { mapAuditEvent } from "../mappers/auditEvent";
import type { MapContext } from "../mappers/common";

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

// ---------------------------------------------------------------------------
// Phase 2 rows. Every id, name and value is synthetic. The staff account
// ids are never published; they appear only as keys of the lookups the
// resource modules resolve through fhir_staff_directory.
// ---------------------------------------------------------------------------

const DOCTOR_ACCOUNT = "e0000000-0000-4000-8000-0000000000d1";
const PHARMACIST_ACCOUNT = "e0000000-0000-4000-8000-0000000000d2";
/** A staff account made on a tablet: not in the staff directory, so never a reference. */
const DEVICE_ACCOUNT = "01HZZEXAMPLEDEVICESTAFF00";

/** Rows as public.fhir_staff_directory returns them. */
const STAFF_DOCTOR = {
  fhir_id: "7a1e0000-0000-4000-8000-000000000001",
  full_name: "Dr. Example Clinician",
  role: "doctor",
  active: true,
  created_at: "2026-01-05T09:00:00Z",
  updated_at: "2026-02-01T10:00:00Z",
};
/** No active flag recorded: Practitioner.active is left out. */
const STAFF_PHARMACIST = {
  fhir_id: "7a1e0000-0000-4000-8000-000000000002",
  full_name: "Example Pharmacist",
  role: "pharmacist",
  active: null,
  created_at: "2026-01-05T09:05:00Z",
  updated_at: "2026-01-05T09:05:00Z",
};
const PRACTITIONER_IDS = new Map([
  [DOCTOR_ACCOUNT, STAFF_DOCTOR.fhir_id],
  [PHARMACIST_ACCOUNT, STAFF_PHARMACIST.fhir_id],
]);

const ORGANIZATION = {
  id: "0a000000-0000-4000-8000-0000000000e1",
  name: "Example Health Outreach",
  is_active: true,
  created_at: "2025-10-28T12:00:00Z",
  updated_at: "2026-03-01T12:00:00Z",
};
const SITE = {
  id: "5a000000-0000-4000-8000-0000000000e1",
  org_id: ORGANIZATION.id,
  name: "Example Primary Health Centre",
  address: "1 Example Clinic Road",
  lga: "Oshimili South",
  state: "Delta",
  is_active: true,
  created_at: "2025-10-28T12:00:00Z",
  updated_at: "2026-03-01T12:00:00Z",
};
/** A site switched off, with no address recorded. */
const SITE_CLOSED = {
  ...SITE,
  id: "5a000000-0000-4000-8000-0000000000e2",
  name: "Example School Ground",
  address: null,
  lga: null,
  state: null,
  is_active: false,
  updated_at: "2026-06-15T08:00:00Z",
};

/** Active, rated life-threatening, with a reaction; recorded by a doctor in the staff directory. */
const ALLERGY_ACTIVE = {
  id: "a11e0000-0000-4000-8000-000000000001",
  patient_id: PATIENT.id,
  allergen: "Penicillin",
  allergy_type: "medication",
  reaction: "Rash and swelling of the lips",
  severity: "life-threatening",
  onset_date: "2026-04-01",
  is_active: true,
  created_by: DOCTOR_ACCOUNT,
  created_at: "2026-05-01T09:00:00Z",
  updated_at: "2026-05-01T09:00:00Z",
};
/** Marked inactive by staff; no reaction recorded; recorded on a tablet account. */
const ALLERGY_INACTIVE = {
  ...ALLERGY_ACTIVE,
  id: "a11e0000-0000-4000-8000-000000000002",
  allergen: "Groundnuts",
  allergy_type: "food",
  reaction: null,
  severity: "moderate",
  onset_date: null,
  is_active: false,
  created_by: DEVICE_ACCOUNT,
  updated_at: "2026-06-10T14:00:00Z",
};

/** pharmacy_items rows, and the random Medication ids the server keeps for them (fhir_link_ids). */
const ITEM_PARACETAMOL = {
  id: "item-paracetamol-500mg-tablet",
  med_name: "Paracetamol",
  strength: "500mg",
  form: "tablet",
  unit: "tablets",
  is_active: true,
  updated_at: "2026-04-01T10:00:00Z",
};
const ITEM_AMOXICILLIN = {
  id: "item-amoxicillin-125mg-5ml-suspension",
  med_name: "Amoxicillin",
  strength: "125mg/5ml",
  form: "powder for suspension",
  unit: "bottles",
  is_active: false,
  updated_at: "2026-04-15T10:00:00Z",
};
const MEDICATION_IDS = new Map([
  [ITEM_PARACETAMOL.id, "5e0d0000-0000-4000-8000-0000000000e1"],
  [ITEM_AMOXICILLIN.id, "5e0d0000-0000-4000-8000-0000000000e2"],
]);
/** A catalogue entry the caller could read but whose Medication id could not be obtained. */
const ITEM_ORS = {
  id: "item-oral-rehydration-salts-sachet",
  med_name: "Oral rehydration salts",
  strength: "20.5g",
  form: "powder for oral solution",
  unit: "sachets",
  is_active: true,
  updated_at: "2026-04-01T10:00:00Z",
};

/** Dispensed in full: one line, the paracetamol. */
const RX_DISPENSED = {
  id: "01HZZEXAMPLERXDONE0000000",
  patient_id: PATIENT.id,
  visit_id: VISIT.id,
  prescriber_id: DOCTOR_ACCOUNT,
  status: "dispensed",
  lines: [
    { itemId: ITEM_PARACETAMOL.id, dosage: "1 tablet", frequency: "three times daily", durationDays: 5, qty: 15, notes: "Take after food" },
  ],
  created_at: "2026-05-01T09:10:00Z",
  updated_at: "2026-05-01T10:00:05Z",
};
/** Still open; written on a tablet account; no visit; a medicine without a published Medication id. */
const RX_OPEN = {
  id: "01HZZEXAMPLERXOPEN0000000",
  patient_id: PATIENT.id,
  visit_id: "",
  prescriber_id: DEVICE_ACCOUNT,
  status: "open",
  lines: [{ itemId: ITEM_ORS.id, dosage: "1 sachet in 1 litre of clean water", frequency: "after each loose stool", qty: 6 }],
  created_at: "2026-05-20T11:00:00Z",
  updated_at: "2026-05-20T11:00:00Z",
};

/** Given against the dispensed prescription (no dispense status recorded: unknown). */
const DISPENSE_RX = {
  id: "01HZZEXAMPLEDISPENSE00000",
  patient_id: PATIENT.id,
  visit_id: VISIT.id,
  item_name: "Paracetamol 500mg",
  qty: 15,
  dosage: "1 tablet",
  directions: "three times daily · 5 days · Take after food",
  dispensed_by: PHARMACIST_ACCOUNT,
  updated_at: "2026-05-01T10:00:01Z",
  prescription_id: RX_DISPENSED.id,
  item_id: ITEM_PARACETAMOL.id,
  dispense_status: null,
};
/** Visit dispensing the patient declined; the dispenser's name was typed in (never published). */
const DISPENSE_DECLINED = {
  ...DISPENSE_RX,
  id: "01HZZEXAMPLEDISPDECLINED0",
  item_name: "Zinc 20mg",
  qty: 10,
  dosage: "1 tablet",
  directions: "once daily for 10 days",
  dispensed_by: "Example Nurse",
  prescription_id: null,
  item_id: null,
  dispense_status: "declined",
  updated_at: "2026-05-01T10:20:00Z",
};

/** A reviewed HbA1c: every result reviewed, so the report is final. */
const LAB_ORDER_HBA1C = {
  id: "1ab00000-0000-4000-8000-000000000001",
  patient_id: PATIENT.id,
  visit_id: VISIT.id,
  test_name: "Hemoglobin A1C",
  test_code: "HBA1C",
  priority: "routine",
  status: "completed",
  ordered_at: "2026-05-01T09:05:00Z",
  collected_at: "2026-05-01T09:20:00Z",
  ordered_by: DOCTOR_ACCOUNT,
  created_at: "2026-05-01T09:05:00Z",
  updated_at: "2026-05-01T11:00:00Z",
};
const LAB_RESULT_HBA1C = {
  id: "1ab0e500-0000-4000-8000-000000000001",
  order_id: LAB_ORDER_HBA1C.id,
  result_value: "6.1",
  result_unit: "%",
  reference_range: "4.0-5.6 %",
  interpretation: "abnormal",
  result_date: "2026-05-01T11:00:00Z",
  reviewed_at: "2026-05-01T12:30:00Z",
  created_at: "2026-05-01T11:00:00Z",
  updated_at: "2026-05-01T12:30:00Z",
};
/**
 * An urgent malaria test still being processed: a reviewed text result
 * and a repeat test whose value is not recorded yet, so the report is
 * partial. Its order was placed from a tablet account (no requester).
 */
const LAB_ORDER_MALARIA = {
  ...LAB_ORDER_HBA1C,
  id: "1ab00000-0000-4000-8000-000000000002",
  test_name: "Malaria Rapid Test",
  test_code: "MRDTrunc",
  priority: "urgent",
  status: "processing",
  ordered_at: "2026-05-01T08:50:00Z",
  collected_at: "2026-05-01T09:00:00Z",
  ordered_by: DEVICE_ACCOUNT,
  created_at: "2026-05-01T08:50:00Z",
  updated_at: "2026-05-01T10:15:00Z",
};
const LAB_RESULT_MALARIA = {
  id: "1ab0e500-0000-4000-8000-000000000002",
  order_id: LAB_ORDER_MALARIA.id,
  result_value: "Positive",
  result_unit: null,
  reference_range: "Negative",
  interpretation: "critical",
  result_date: "2026-05-01T09:30:00Z",
  reviewed_at: "2026-05-01T09:45:00Z",
  created_at: "2026-05-01T09:30:00Z",
  updated_at: "2026-05-01T09:45:00Z",
};
const LAB_RESULT_MALARIA_REPEAT = {
  ...LAB_RESULT_MALARIA,
  id: "1ab0e500-0000-4000-8000-000000000003",
  result_value: null,
  reference_range: null,
  interpretation: null,
  result_date: "2026-05-01T10:15:00Z",
  reviewed_at: null,
  created_at: "2026-05-01T10:15:00Z",
  updated_at: "2026-05-01T10:15:00Z",
};

/** A file the patient uploaded through the portal. */
const DOCUMENT_UPLOAD = {
  id: "d0c00000-0000-4000-8000-0000000000e1",
  patient_id: PATIENT.id,
  document_type: "lab_result",
  document_name: "blood test results.pdf",
  file_size: 20480,
  mime_type: "application/pdf",
  description: "Results from an example laboratory",
  upload_source: "patient",
  created_at: "2026-09-01T09:30:00Z",
  deleted_at: null,
  file_path: `${PATIENT.id}/1756719000000.pdf`,
};
/** A clinic record added by staff; its description is a staff note (never published). */
const DOCUMENT_CLINIC = {
  ...DOCUMENT_UPLOAD,
  id: "d0c00000-0000-4000-8000-0000000000e2",
  document_type: "imaging",
  document_name: "chest x-ray.png",
  file_size: 1000,
  mime_type: "image/png",
  description: "Staff note: example text",
  upload_source: "staff",
  created_at: "2026-09-02T10:00:00Z",
  file_path: `${PATIENT.id}/1756719100000.png`,
};

/** Rows as public.fhir_consent_directives returns them (a register record with its provisions). */
const CONSENT_PRIVACY = {
  id: "c0a5e000-0000-4000-8000-0000000000e1",
  patient_id: PATIENT.id,
  status: "active",
  scope: "patient-privacy",
  category: "data-sharing",
  policy_uri: "https://mbhr.app/policies/data-sharing/v1",
  verified: true,
  verified_at: "2026-06-02T10:00:00Z",
  effective_from: "2026-06-01T00:00:00Z",
  effective_until: "2027-06-01T00:00:00Z",
  recorded_at: "2026-06-01T09:30:00Z",
  withdrawn: false,
  withdrawn_at: null,
  created_at: "2026-06-01T09:30:00Z",
  updated_at: "2026-06-02T10:00:00Z",
  provisions: [
    {
      id: "d0000000-0000-4000-8000-0000000000e1",
      provision_type: "permit",
      actor_type: "any",
      names_recipient: false,
      action: "access",
      purpose: "TREAT",
      data_class: null,
      resource_type: "Observation",
      security_label: null,
      effective_from: null,
      effective_until: null,
    },
    {
      id: "d0000000-0000-4000-8000-0000000000e2",
      provision_type: "deny",
      actor_type: null,
      names_recipient: false,
      action: "disclose",
      purpose: "HRESCH",
      data_class: "laboratory",
      resource_type: null,
      security_label: "R",
      effective_from: "2026-07-01T00:00:00Z",
      effective_until: null,
    },
  ],
};
/** A refusal to have the record disclosed to external systems: a rule with an actor (a kind of recipient). */
const CONSENT_EXTERNAL_DENY = {
  ...CONSENT_PRIVACY,
  id: "c0a5e000-0000-4000-8000-0000000000e2",
  verified: false,
  verified_at: null,
  effective_from: null,
  effective_until: null,
  recorded_at: "2026-06-05T08:00:00Z",
  created_at: "2026-06-05T08:00:00Z",
  updated_at: "2026-06-05T08:00:00Z",
  provisions: [
    {
      id: "d0000000-0000-4000-8000-0000000000e3",
      provision_type: "deny",
      actor_type: "external_system",
      names_recipient: false,
      action: "disclose",
      purpose: null,
      data_class: null,
      resource_type: null,
      security_label: null,
      effective_from: null,
      effective_until: null,
    },
  ],
};
/** Research consent the patient withdrew: kept, inactive. */
const CONSENT_RESEARCH_WITHDRAWN = {
  ...CONSENT_PRIVACY,
  id: "c0a5e000-0000-4000-8000-0000000000e3",
  status: "inactive",
  scope: "research",
  category: "research-participation",
  policy_uri: "https://mbhr.app/policies/research/v1",
  verified: null,
  verified_at: null,
  withdrawn: true,
  withdrawn_at: "2026-08-01T12:00:00Z",
  updated_at: "2026-08-01T12:00:00Z",
  provisions: [
    {
      id: "d0000000-0000-4000-8000-0000000000e4",
      provision_type: "permit",
      actor_type: null,
      names_recipient: false,
      action: "use",
      purpose: "HRESCH",
      data_class: null,
      resource_type: null,
      security_label: null,
      effective_from: null,
      effective_until: null,
    },
  ],
};

/** Merged into PATIENT (the Patient-merged example). */
const MERGED_PATIENT = { id: "01HZZEXAMPLEMERGED0000000", fhir_id: "7c0f6a52-3d0e-4f7e-9a51-5b8d2c1e0a02" };

/** public.lab_result_release_log rows (server-stamped account and time). */
const LAB_EVENT_REVIEW = {
  id: "1ab0e7e0-0000-4000-8000-000000000001",
  result_id: LAB_RESULT_HBA1C.id,
  action: "reviewed",
  actor_id: DOCTOR_ACCOUNT,
  created_at: "2026-05-01T12:30:00.412871+00:00",
};
/** Withheld from the portal by an account the staff directory does not resolve: display-only agent. */
const LAB_EVENT_WITHHOLD = {
  id: "1ab0e7e0-0000-4000-8000-000000000002",
  result_id: LAB_RESULT_MALARIA.id,
  action: "withheld",
  actor_id: "e0000000-0000-4000-8000-0000000000d9",
  created_at: "2026-05-01T09:50:00.000215+00:00",
};
/** What the Provenance module looks up for each result (lab_results, lab_orders). */
const LAB_EVENT_LINKS: ReadonlyMap<string, LabEventLinks> = new Map([
  [
    LAB_RESULT_HBA1C.id,
    { orderId: LAB_ORDER_HBA1C.id, current: true, patientId: PATIENT.id, reviewed: true, amendedAt: null },
  ],
  [
    LAB_RESULT_MALARIA.id,
    { orderId: LAB_ORDER_MALARIA.id, current: true, patientId: PATIENT.id, reviewed: true, amendedAt: null },
  ],
]);
/** A patient_merges row written by merge_patients() (actor stamped by the server). */
const MERGE_EVENT = {
  id: "01HZZEXAMPLEMERGEEVENT000",
  winner_id: PATIENT.id,
  loser_id: MERGED_PATIENT.id,
  kind: "merge",
  actor_id: DOCTOR_ACCOUNT,
  created_at: "2026-06-01T10:00:00.5+00:00",
};

/** Rows as public.fhir_access_audit_events returns them. A doctor's read of the HbA1c report. */
const AUDIT_READ_PERMIT = {
  id: "a0d17000-0000-4000-8000-000000000001",
  occurred_at: "2026-09-20T10:15:00.123456+00:00",
  action: "read",
  resource_type: "DiagnosticReport",
  resource_id: LAB_ORDER_HBA1C.id,
  patient_ids: [PATIENT.id],
  actor_user_id: DOCTOR_ACCOUNT,
  actor_role: "doctor",
  actor_kind: "staff",
  purpose: "TREAT",
  decision: "permit",
  denial_reason: null,
  http_status: 200,
  result_count: 1,
};
/** A portal patient's allergy search, refused (patients cannot read allergies). */
const AUDIT_SEARCH_DENIED = {
  id: "a0d17000-0000-4000-8000-000000000002",
  occurred_at: "2026-09-20T11:00:00.000001+00:00",
  action: "search",
  resource_type: "AllergyIntolerance",
  resource_id: null,
  patient_ids: [PATIENT.id],
  actor_user_id: "e0000000-0000-4000-8000-0000000000f1",
  actor_role: null,
  actor_kind: "patient",
  purpose: "PATRQT",
  decision: "deny",
  denial_reason: "missing_permission",
  http_status: 403,
  result_count: null,
};

export const EXAMPLE_BASE_URL = "https://mbhr.app/fhir/R4";

export function conformanceExamples(): Record<string, Resource> {
  const ctx = { patientFhirIds: new Map([[PATIENT.id, PATIENT.fhir_id]]) };
  const patient = mapPatient(PATIENT);
  const merged = mapPatient(
    { ...PATIENT, id: MERGED_PATIENT.id, fhir_id: MERGED_PATIENT.fhir_id, merged_into: PATIENT.id },
    PATIENT.fhir_id,
  );
  const encounter = mapEncounter(VISIT, ctx)!;
  const observations = mapVitalsRow(VITALS, ctx);
  const condition = mapCondition(CONDITION, ctx)!;
  const enteredInError = mapCondition(
    { ...CONDITION, id: "c0ffee00-0000-4000-8000-000000000002", verification_status: "entered-in-error" },
    ctx,
  )!;
  // Every severity code, so the validator checks each display.
  const resolvedMild = mapCondition(
    {
      ...CONDITION,
      id: "c0ffee00-0000-4000-8000-000000000003",
      clinical_status: "resolved",
      verification_status: "confirmed",
      category: "problem-list-item",
      severity: "mild",
      abatement_date: "2026-05-20",
    },
    ctx,
  )!;
  const activeSevere = mapCondition(
    { ...CONDITION, id: "c0ffee00-0000-4000-8000-000000000004", verification_status: "confirmed", severity: "severe" },
    ctx,
  )!;
  // A diagnosis nobody marked: no clinical status, verification status or category is filled in.
  const unmarked = mapCondition(
    { ...CONDITION, id: "c0ffee00-0000-4000-8000-000000000005", clinical_status: null, verification_status: null, category: null },
    ctx,
  )!;

  const out: Record<string, Resource> = {
    "Patient-example": patient,
    "Patient-merged": merged,
    "Encounter-example": encounter,
    "Condition-provisional": condition,
    "Condition-entered-in-error": enteredInError,
    "Condition-resolved-mild": resolvedMild,
    "Condition-active-severe": activeSevere,
    "Condition-unmarked": unmarked,
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
    // A search with no match and no note: no "entry" at all (FHIR JSON forbids empty arrays).
    "Bundle-empty-search": searchsetBundle({
      baseUrl: EXAMPLE_BASE_URL,
      resourceType: "Encounter",
      query: new URLSearchParams(`patient=Patient/${PATIENT.fhir_id}&status=cancelled`),
      count: 20,
      page: { resources: [], next: null },
      now: new Date("2026-09-25T12:00:00Z"),
    }),
  };
  for (const o of observations) out[`Observation-${o.id!.slice(VITALS.id.length + 1)}`] = o;
  Object.assign(out, phase2Examples(ctx));
  return out;
}

/** Every Phase 2 type, from the rows above, mapped the way its resource module maps it. */
function phase2Examples(ctx: MapContext): Record<string, Resource> {
  const out: Record<string, Resource> = {};
  const add = (name: string, resource: Resource | null) => {
    if (!resource) throw new Error(`conformance example ${name}: the mapper withheld it`);
    out[name] = resource;
  };

  // Staff directory, organisations and sites.
  add("Practitioner-doctor", mapPractitioner(STAFF_DOCTOR));
  add("Practitioner-no-active-flag", mapPractitioner(STAFF_PHARMACIST));
  add("PractitionerRole-doctor", mapPractitionerRole(STAFF_DOCTOR));
  add("PractitionerRole-pharmacist", mapPractitionerRole(STAFF_PHARMACIST));
  add("Organization-example", mapOrganization(ORGANIZATION));
  add("Location-active", mapLocation(SITE));
  add("Location-inactive", mapLocation(SITE_CLOSED));

  // AllergyIntolerance (resources/allergyIntolerance.ts: patient refs + staff directory).
  const allergyCtx: AllergyMapContext = { ...ctx, practitionerIds: PRACTITIONER_IDS };
  const allergyActive = mapAllergy(ALLERGY_ACTIVE, allergyCtx);
  const allergyInactive = mapAllergy(ALLERGY_INACTIVE, allergyCtx);
  add("AllergyIntolerance-active", allergyActive);
  add("AllergyIntolerance-inactive", allergyInactive);
  // A patient search where one matching allergy was left out (its patient
  // record did not resolve): the searchset's outcome entry carries the
  // "no known allergies" caveat every allergy searchset has, and the warning.
  add(
    "Bundle-allergy-search-with-warning",
    searchsetBundle({
      baseUrl: EXAMPLE_BASE_URL,
      resourceType: "AllergyIntolerance",
      query: new URLSearchParams(`patient=Patient/${PATIENT.fhir_id}`),
      count: 20,
      page: { resources: [allergyActive!, allergyInactive!], next: null },
      now: new Date("2026-09-25T12:00:00Z"),
      outcomes: [ALLERGY_NKA_CAVEAT, allergyLeftOutWarning(1)],
      newId: () => "0e0e0e0e-0000-4000-8000-000000000001",
    }),
  );

  // Medicines (resources/medication*.ts).
  for (const [name, item] of [
    ["Medication-active", ITEM_PARACETAMOL],
    ["Medication-inactive", ITEM_AMOXICILLIN],
  ] as const) {
    add(name, mapMedication(item, MEDICATION_IDS.get(item.id)));
  }
  // As catalogueEntries (resources/medication.ts) builds them; ITEM_ORS has no Medication id.
  const catalogue = (item: typeof ITEM_PARACETAMOL): CatalogueEntry => ({
    fhirId: MEDICATION_IDS.get(item.id) ?? null,
    description: itemDescription(item)!,
    unit: item.unit.trim() || undefined,
  });
  const staffMedicationCtx: MedicationMapContext = {
    ...ctx,
    items: new Map([
      [ITEM_PARACETAMOL.id, catalogue(ITEM_PARACETAMOL)],
      [ITEM_AMOXICILLIN.id, catalogue(ITEM_AMOXICILLIN)],
      [ITEM_ORS.id, catalogue(ITEM_ORS)],
    ]),
    visitPatients: new Map([[VISIT.id, PATIENT.fhir_id]]),
    practitioners: PRACTITIONER_IDS,
    prescriptions: new Map(),
    patientView: false,
  };
  add("MedicationRequest-completed", mapMedicationRequest(RX_DISPENSED, 0, staffMedicationCtx));
  add("MedicationRequest-active-text-medicine", mapMedicationRequest(RX_OPEN, 0, staffMedicationCtx));
  // MedicationDispense also resolves the prescriptions behind the rows.
  const dispenseCtx: MedicationMapContext = {
    ...staffMedicationCtx,
    prescriptions: new Map([
      [RX_DISPENSED.id, { patientFhirId: PATIENT.fhir_id, itemIds: prescriptionLines(RX_DISPENSED).map(lineItemId) }],
    ]),
  };
  add("MedicationDispense-prescription", mapMedicationDispense(DISPENSE_RX, dispenseCtx));
  add("MedicationDispense-declined", mapMedicationDispense(DISPENSE_DECLINED, dispenseCtx));

  // Laboratory (resources/serviceRequest.ts, diagnosticReport.ts, labObservation.ts).
  add("ServiceRequest-completed", mapServiceRequest(LAB_ORDER_HBA1C, ctx, PRACTITIONER_IDS));
  add("ServiceRequest-active-urgent", mapServiceRequest(LAB_ORDER_MALARIA, ctx, PRACTITIONER_IDS));
  add("DiagnosticReport-final", mapDiagnosticReport(LAB_ORDER_HBA1C, [LAB_RESULT_HBA1C], ctx, "all_current_results"));
  add(
    "DiagnosticReport-partial",
    mapDiagnosticReport(LAB_ORDER_MALARIA, [LAB_RESULT_MALARIA, LAB_RESULT_MALARIA_REPEAT], ctx, "all_current_results"),
  );
  add("Observation-lab-quantity", mapLabObservation(LAB_RESULT_HBA1C, LAB_ORDER_HBA1C, ctx));
  add("Observation-lab-string", mapLabObservation(LAB_RESULT_MALARIA, LAB_ORDER_MALARIA, ctx));
  add("Observation-lab-data-absent", mapLabObservation(LAB_RESULT_MALARIA_REPEAT, LAB_ORDER_MALARIA, ctx));

  // Documents (resources/documentReference.ts, binary.ts): staff see every
  // file; a patient sees a clinic record's metadata without its file.
  add("DocumentReference-patient-upload", mapDocumentReference(DOCUMENT_UPLOAD, ctx, { contentAvailable: true }));
  add("DocumentReference-clinic-record-patient-view", mapDocumentReference(DOCUMENT_CLINIC, ctx, { contentAvailable: false }));
  add("Binary-patient-upload", mapBinary(DOCUMENT_UPLOAD, ctx));

  // Consent (resources/consent.ts).
  add("Consent-privacy-rules", mapConsent(CONSENT_PRIVACY, ctx));
  add("Consent-deny-external-actor", mapConsent(CONSENT_EXTERNAL_DENY, ctx));
  add("Consent-research-withdrawn", mapConsent(CONSENT_RESEARCH_WITHDRAWN, ctx));

  // Provenance (resources/provenance.ts) and AuditEvent (resources/auditEvent.ts):
  // staff resolve to Practitioner references through the staff directory.
  const staffRefs = new Map<string, Reference>(
    [...PRACTITIONER_IDS].map(([account, id]) => [account, { reference: `Practitioner/${id}` }]),
  );
  for (const [name, row] of [
    ["Provenance-lab-review", LAB_EVENT_REVIEW],
    ["Provenance-lab-withhold", LAB_EVENT_WITHHOLD],
  ] as const) {
    add(name, mapLabReleaseEvent(row, LAB_EVENT_LINKS.get(row.result_id), ctx, staffRefs));
  }
  // Each record's own published id (the kept record and the merged-away one).
  const ownIds = new Map([
    [PATIENT.id, PATIENT.fhir_id],
    [MERGED_PATIENT.id, MERGED_PATIENT.fhir_id],
  ]);
  add("Provenance-patient-merge", mapMergeEvent(MERGE_EVENT, ownIds, staffRefs));
  add("Provenance-document-upload", mapDocumentUploadEvent(DOCUMENT_UPLOAD, ctx));
  add("AuditEvent-read-permitted", mapAuditEvent(AUDIT_READ_PERMIT, ctx, staffRefs));
  add("AuditEvent-search-refused", mapAuditEvent(AUDIT_SEARCH_DENIED, ctx, staffRefs));

  return out;
}
