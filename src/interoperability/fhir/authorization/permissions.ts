// mBHR permission -> FHIR interaction.
//
// The permission names are mBHR's own (src/auth/roles.ts and the server copy
// public.app_role_has_permission). They are read from the database for the
// signed-in account on every request, never from the client. A resource is
// readable when the account holds ANY of the listed permissions, and row-level
// security then decides which rows it sees; both must allow a read.

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

export type FhirResourceType = "Patient" | "Encounter" | "Observation" | "Condition";

/**
 * Who may read what (read and search alike):
 *   Patient      demographics: everyone who registers, measures, consults,
 *                dispenses or reviews labs for the patient.
 *   Encounter,   visits and vital signs: the people who take and use them.
 *   Observation
 *   Condition    diagnoses: clinicians who consult (doctor, lead clinician,
 *                admin). Pharmacists, volunteers and registration staff do
 *                not get diagnoses through FHIR.
 */
export const READ_PERMISSIONS: Record<FhirResourceType, readonly MbhrPermission[]> = {
  Patient: ["register", "vitals", "consult", "dispense", "lab_review"],
  Encounter: ["vitals", "consult", "lab_review"],
  Observation: ["vitals", "consult", "lab_review"],
  Condition: ["consult"],
};

export function canRead(permissions: ReadonlySet<string>, type: FhirResourceType): boolean {
  return READ_PERMISSIONS[type].some((p) => permissions.has(p));
}
