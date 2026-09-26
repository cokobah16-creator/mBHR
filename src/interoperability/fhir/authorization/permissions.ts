// mBHR permission -> FHIR interaction.
//
// The permission names are mBHR's own (src/auth/roles.ts and the server copy
// public.app_role_has_permission). They are read from the database for the
// signed-in account on every request, never from the client. A resource is
// readable when the account holds ANY of the listed permissions, and row-level
// security then decides which rows it sees; both must allow a read.
//
// The lists follow what the staff app already shows each role. FHIR never
// widens that: where the app shows less than row-level security would allow
// (labs, documents, messages), the narrower app rule is used here, and where
// the app shows staff nothing of a type (documents; consents, of which staff
// see only the External sharing badge), no staff permission reads it.

export type MbhrPermission =
  | "register"
  | "vitals"
  | "consult"
  | "dispense"
  | "inventory"
  | "export"
  | "users"
  | "approve_phi_conflicts"
  | "audit_access"
  | "resolve_conflicts"
  | "lab_review"
  | "queue"
  | "portal_manage"
  | "merge_patients"
  | "lab_release"
  | "portal_invite";

export const ALL_PERMISSIONS: readonly MbhrPermission[] = [
  "register",
  "vitals",
  "consult",
  "dispense",
  "inventory",
  "export",
  "users",
  "approve_phi_conflicts",
  "audit_access",
  "resolve_conflicts",
  "lab_review",
  "queue",
  "portal_manage",
  "merge_patients",
  "lab_release",
  "portal_invite",
];

export type FhirResourceType =
  | "Patient"
  | "Encounter"
  | "Observation"
  | "Condition"
  | "AllergyIntolerance"
  | "Medication"
  | "MedicationRequest"
  | "MedicationDispense"
  | "ServiceRequest"
  | "DiagnosticReport"
  | "DocumentReference"
  | "Binary"
  | "Consent"
  | "Practitioner"
  | "PractitionerRole"
  | "Organization"
  | "Location"
  | "Provenance"
  | "AuditEvent";

/**
 * Who may read what (read and search alike):
 *   Patient            demographics: everyone who registers, measures,
 *                      consults, dispenses or reviews labs for the patient.
 *   Encounter,         visits and vital signs: the people who take and use
 *   Observation        them. Laboratory Observations additionally need
 *                      consult or lab_review (checked per row class by the
 *                      Observation module, see LAB_PERMISSIONS).
 *   Condition          diagnoses: clinicians who consult.
 *   AllergyIntolerance everyone who registers, measures, consults or
 *                      dispenses (allergy checks happen at each step).
 *   Medication         catalogue: prescribers, dispensers, stock keepers.
 *   MedicationRequest, prescribing and dispensing staff.
 *   MedicationDispense
 *   ServiceRequest,    lab orders and reports: consult or lab_review (the lab
 *   DiagnosticReport   screens are not shown to other roles).
 *   DocumentReference, patient documents: no staff permission. Owner decision
 *   Binary             (docs/clinical/CLINICAL_LOGIC_CHANGES.md 2.7, "Patients
 *                      only"): staff get no documents over FHIR until mBHR
 *                      has a staff documents screen; portal patients read
 *                      their own (PATIENT_SELF_ACCESS).
 *   Consent            consents: no staff permission. Owner decision (2.7,
 *                      "Only what the app shows"): staff see only the
 *                      External sharing badge until mBHR has a staff consent
 *                      screen; portal patients read their own. The consent
 *                      step loads directives with its own list
 *                      (CONSENT_READERS in authorize.ts).
 *   Practitioner,      staff directory and places: every staff member.
 *   PractitionerRole,
 *   Organization,
 *   Location
 *   Provenance,        who did what: audit_access (lab events also
 *   AuditEvent         lab_review for Provenance, checked in the module).
 */
export const READ_PERMISSIONS: Record<FhirResourceType, readonly MbhrPermission[]> = {
  Patient: ["register", "vitals", "consult", "dispense", "lab_review"],
  Encounter: ["vitals", "consult", "lab_review"],
  Observation: ["vitals", "consult", "lab_review"],
  Condition: ["consult"],
  AllergyIntolerance: ["register", "vitals", "consult", "dispense"],
  Medication: ["consult", "dispense", "inventory"],
  MedicationRequest: ["consult", "dispense"],
  MedicationDispense: ["consult", "dispense"],
  ServiceRequest: ["consult", "lab_review"],
  DiagnosticReport: ["consult", "lab_review"],
  // Empty: no staff account may read these (403 missing_permission at step 5).
  DocumentReference: [],
  Binary: [],
  Consent: [],
  Practitioner: ALL_PERMISSIONS,
  PractitionerRole: ALL_PERMISSIONS,
  Organization: ALL_PERMISSIONS,
  Location: ALL_PERMISSIONS,
  Provenance: ["audit_access", "lab_review"],
  AuditEvent: ["audit_access"],
};

/** Laboratory rows (lab Observations) need one of these on top of READ_PERMISSIONS. */
export const LAB_PERMISSIONS: readonly MbhrPermission[] = ["consult", "lab_review"];

/**
 * What a portal patient may read about themselves when
 * FHIR_PATIENT_ACCESS_ENABLED is on: only what the patient portal already
 * shows them (see docs/interoperability/security.md#patient-self-access).
 */
export const PATIENT_SELF_ACCESS: ReadonlySet<FhirResourceType> = new Set<FhirResourceType>([
  "Patient",
  "Encounter",
  "Observation",
  "DiagnosticReport",
  "MedicationDispense",
  "DocumentReference",
  "Binary",
  "Consent",
]);

export function canRead(permissions: ReadonlySet<string>, type: FhirResourceType): boolean {
  return READ_PERMISSIONS[type].some((p) => permissions.has(p));
}

export function hasAny(permissions: ReadonlySet<string>, wanted: readonly string[]): boolean {
  return wanted.some((p) => permissions.has(p));
}
