// Status maps for: Medication.status, MedicationRequest.status and
// MedicationDispense.status (see terminology/statusMaps.ts for the rules
// every map keeps).
//
// What the source columns mean (evidence in the Phase 2 medicines research):
//
//   pharmacy_items.is_active   true: offered for prescribing; false: switched
//                              off by the pharmacy and kept for history.
//   prescriptions.status       open, dispensed, partial or void (CHECK). Only
//                              the pharmacy RPCs change it: rx_dispense sets
//                              dispensed after giving EVERY line in full (it
//                              refuses anything less), rx_void_prescription
//                              sets void while the prescription is still
//                              open, rx_import_history records a tablet's own
//                              history. No app code writes partial.
//   dispenses.dispense_status  one of the nine FHIR codes or NULL (CHECK).
//                              The app never writes it: every row created
//                              since May 2026 has NULL. Rows that existed
//                              when the column was added were set to
//                              "completed" by that migration in one step.
//
// A dispenses row is NOT taken as proof of a handover: a NULL status stays
// "unknown", whatever else the row says (owner rule: a dispense record never
// implies completed unless the data says handed over).

import type { StatusMap } from "../statusMaps";

// ---------------------------------------------------------------------------
// Medication.status <- public.pharmacy_items.is_active (boolean, compared
// as the text "true" / "false")
// ---------------------------------------------------------------------------

export type MedicationStatus = "active" | "inactive" | "entered-in-error";

export const MEDICATION_STATUS: StatusMap<MedicationStatus> = {
  element: "Medication.status",
  source: "public.pharmacy_items.is_active",
  valueSet: "http://hl7.org/fhir/ValueSet/medication-status",
  allowed: ["active", "inactive", "entered-in-error"],
  rules: [
    {
      source: ["true"],
      fhir: "active",
      reason: "The medicine is offered for prescribing in the catalogue.",
    },
    {
      source: ["false"],
      fhir: "inactive",
      reason: "The pharmacy switched the medicine off; it is kept for history and not offered for prescribing.",
    },
  ],
  missing: { fhir: null, reason: "Not recorded: the status is left out, never assumed active." },
  unrecognised: { fhir: null, reason: "Not a recorded flag value: left out, not guessed." },
};

// ---------------------------------------------------------------------------
// MedicationRequest.status <- public.prescriptions.status
// ---------------------------------------------------------------------------

export type MedicationRequestStatus =
  | "active"
  | "on-hold"
  | "cancelled"
  | "completed"
  | "entered-in-error"
  | "stopped"
  | "draft"
  | "unknown";

export const MEDICATION_REQUEST_STATUS: StatusMap<MedicationRequestStatus> = {
  element: "MedicationRequest.status",
  source: "public.prescriptions.status",
  valueSet: "http://hl7.org/fhir/ValueSet/medicationrequest-status",
  allowed: ["active", "on-hold", "cancelled", "completed", "entered-in-error", "stopped", "draft", "unknown"],
  rules: [
    {
      source: ["open"],
      fhir: "active",
      reason:
        "Uploaded and waiting for the pharmacy: only an open prescription can still be dispensed or cancelled. It is never shown as completed, and it has no expiry in mBHR.",
    },
    {
      source: ["dispensed"],
      fhir: "completed",
      reason:
        "The pharmacy recorded the whole prescription as dispensed: rx_dispense gives every line in full or refuses, and mBHR has no refills. Imported tablet history is the tablet's own record. Completed means dispensing is complete, not that the course of treatment has ended.",
    },
    {
      source: ["partial"],
      fhir: "unknown",
      reason:
        "Allowed by the column but written by no app code; it can no longer be dispensed, so it is not active, and not every line was given, so it is not completed.",
    },
    {
      source: ["void"],
      fhir: "cancelled",
      reason: "Cancelled while still open, before anything was dispensed on the server; never shown as completed or active.",
    },
  ],
  missing: { fhir: "unknown", reason: "No status was recorded." },
  unrecognised: { fhir: "unknown", reason: "A status the app does not write; not guessed." },
};

// ---------------------------------------------------------------------------
// MedicationDispense.status <- public.dispenses.dispense_status
// ---------------------------------------------------------------------------

export type MedicationDispenseStatus =
  | "preparation"
  | "in-progress"
  | "cancelled"
  | "on-hold"
  | "completed"
  | "entered-in-error"
  | "stopped"
  | "declined"
  | "unknown";

const RECORDED_AS_FHIR = "Stored as this FHIR code (the column accepts only medicationdispense-status codes).";

export const MEDICATION_DISPENSE_STATUS: StatusMap<MedicationDispenseStatus> = {
  element: "MedicationDispense.status",
  source: "public.dispenses.dispense_status",
  valueSet: "http://hl7.org/fhir/ValueSet/medicationdispense-status",
  allowed: ["preparation", "in-progress", "cancelled", "on-hold", "completed", "entered-in-error", "stopped", "declined", "unknown"],
  rules: [
    {
      source: ["completed"],
      fhir: "completed",
      reason:
        "Recorded as handed over. Only rows that existed in May 2026 carry it, set by the migration that added the column (clinical sign-off pending on trusting that backfill).",
    },
    { source: ["preparation"], fhir: "preparation", reason: RECORDED_AS_FHIR },
    { source: ["in-progress"], fhir: "in-progress", reason: `${RECORDED_AS_FHIR} Never shown as completed.` },
    { source: ["on-hold"], fhir: "on-hold", reason: RECORDED_AS_FHIR },
    { source: ["cancelled"], fhir: "cancelled", reason: `${RECORDED_AS_FHIR} Never shown as completed.` },
    { source: ["declined"], fhir: "declined", reason: `${RECORDED_AS_FHIR} Not handed over; never shown as completed.` },
    { source: ["stopped"], fhir: "stopped", reason: `${RECORDED_AS_FHIR} Never shown as completed.` },
    { source: ["entered-in-error"], fhir: "entered-in-error", reason: RECORDED_AS_FHIR },
    { source: ["unknown"], fhir: "unknown", reason: RECORDED_AS_FHIR },
  ],
  missing: {
    fhir: "unknown",
    reason:
      "The app does not record a dispense status (every row since May 2026). The row says mBHR recorded the medicine, not that a handover was confirmed, so it is never assumed completed.",
  },
  unrecognised: { fhir: "unknown", reason: "Not a medicationdispense-status code; not guessed." },
};

export const MEDICATION_STATUS_MAPS: readonly StatusMap[] = [
  MEDICATION_STATUS,
  MEDICATION_REQUEST_STATUS,
  MEDICATION_DISPENSE_STATUS,
];
