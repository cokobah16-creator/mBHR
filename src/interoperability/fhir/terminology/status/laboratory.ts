// Status maps for: ServiceRequest.status, ServiceRequest.priority,
// DiagnosticReport.status, laboratory Observation.status and laboratory
// Observation.interpretation (see terminology/statusMaps.ts for the rules
// every map keeps, and mappers/laboratory.ts for where each one is used).
//
// Two of these maps read a state the mapper derives from several columns,
// not one stored value, because mBHR keeps no status column for results:
//
//   result review state  (one public.lab_results row)
//     reviewed            reviewed_at is set, an interpretation the app
//                         writes (normal, abnormal, critical) is recorded,
//                         and a value is recorded
//     review_incomplete   reviewed_at is set, but the interpretation or the
//                         value is missing (older databases allowed a
//                         direct update that skipped the review checks)
//     unreviewed          reviewed_at is not set
//
//   report state  (one public.lab_orders row and its current results, i.e.
//   the results not replaced by a newer one through superseded_by)
//     awaiting_result             order open (ordered, collected or
//                                 processing) and no current result
//     cancelled                   order cancelled and no current result
//     unreviewed                  at least one current result is not
//                                 "reviewed" (above)
//     reviewed                    every current result is "reviewed"
//     results_on_cancelled_order  order cancelled but results exist
//     completed_without_result    order completed but no current result
//     (missing)                   the order has no status
//     (unrecognised)              an order status the app does not write
//
// The order's own status never makes a report or a result final: the app
// sets an order to "completed" the moment a result is typed in, before any
// clinician has looked at it (src/services/labs.ts, addLabResult).

import type { StatusMap } from "../statusMaps";

export type ServiceRequestStatus = "draft" | "active" | "on-hold" | "revoked" | "completed" | "entered-in-error" | "unknown";
export type ServiceRequestPriority = "routine" | "urgent" | "asap" | "stat";
export type DiagnosticReportStatus =
  | "registered"
  | "partial"
  | "preliminary"
  | "final"
  | "amended"
  | "corrected"
  | "appended"
  | "cancelled"
  | "entered-in-error"
  | "unknown";
export type LabObservationStatus =
  | "registered"
  | "preliminary"
  | "final"
  | "amended"
  | "corrected"
  | "cancelled"
  | "entered-in-error"
  | "unknown";
/** v3 ObservationInterpretation codes this module can publish. */
export type LabInterpretationCode = "N" | "A" | "AA";

// ---------------------------------------------------------------------------
// ServiceRequest.status <- public.lab_orders.status
// ---------------------------------------------------------------------------

export const SERVICE_REQUEST_STATUS: StatusMap<ServiceRequestStatus> = {
  element: "ServiceRequest.status",
  source: "public.lab_orders.status",
  valueSet: "http://hl7.org/fhir/ValueSet/request-status",
  allowed: ["draft", "active", "on-hold", "revoked", "completed", "entered-in-error", "unknown"],
  rules: [
    {
      source: ["ordered", "collected", "processing"],
      fhir: "active",
      reason: "The order is open: placed, specimen collected, or in processing. No result has been recorded yet.",
    },
    {
      source: ["completed"],
      fhir: "completed",
      reason:
        "A result was recorded for the order (the app sets this when a result is typed in). It says nothing about review: the DiagnosticReport and each result Observation carry that, and neither is final before a clinician reviews it.",
    },
    {
      source: ["cancelled"],
      fhir: "revoked",
      reason: "The order was cancelled before completion. It is never shown as completed or as entered-in-error.",
    },
  ],
  missing: { fhir: "unknown", reason: "No status was recorded." },
  unrecognised: { fhir: "unknown", reason: "An order status the app does not write; not guessed." },
};

// ---------------------------------------------------------------------------
// ServiceRequest.priority <- public.lab_orders.priority
// ---------------------------------------------------------------------------

export const SERVICE_REQUEST_PRIORITY: StatusMap<ServiceRequestPriority> = {
  element: "ServiceRequest.priority",
  source: "public.lab_orders.priority",
  valueSet: "http://hl7.org/fhir/ValueSet/request-priority",
  allowed: ["routine", "urgent", "asap", "stat"],
  rules: [
    { source: ["routine"], fhir: "routine", reason: "Chosen on the order form: routine (the form's default)." },
    { source: ["urgent"], fhir: "urgent", reason: "Chosen on the order form: urgent." },
    { source: ["stat"], fhir: "stat", reason: "Chosen on the order form: STAT (the lab queue shows it first)." },
  ],
  missing: { fhir: null, reason: "No priority recorded: left out (FHIR allows no priority), never assumed routine." },
  unrecognised: { fhir: null, reason: "A priority the app does not write: left out, not guessed." },
};

// ---------------------------------------------------------------------------
// DiagnosticReport.status <- report state (lab_orders.status + its current lab_results)
// ---------------------------------------------------------------------------

export const DIAGNOSTIC_REPORT_STATUS: StatusMap<DiagnosticReportStatus> = {
  element: "DiagnosticReport.status",
  source: "report state derived from public.lab_orders.status and the review state of its current public.lab_results rows",
  valueSet: "http://hl7.org/fhir/ValueSet/diagnostic-report-status",
  allowed: ["registered", "partial", "preliminary", "final", "amended", "corrected", "appended", "cancelled", "entered-in-error", "unknown"],
  rules: [
    {
      source: ["awaiting_result"],
      fhir: "registered",
      reason: "The order is open (ordered, collected or processing) and no result has been recorded yet: the report exists but holds nothing.",
    },
    {
      source: ["cancelled"],
      fhir: "cancelled",
      reason: "The order was cancelled and no result was recorded. Never shown as final.",
    },
    {
      source: ["unreviewed"],
      fhir: "partial",
      reason:
        "At least one current result has not been reviewed by a clinician (or its review is incomplete), so the report may be incomplete or unverified. R4 'preliminary' would claim verified early results, which these are not.",
    },
    {
      source: ["reviewed"],
      fhir: "final",
      reason: "Every current result was reviewed by a clinician holding lab_review, with an interpretation and a value recorded.",
    },
    {
      source: ["results_on_cancelled_order", "completed_without_result"],
      fhir: "unknown",
      reason:
        "The order status and its results disagree (results on a cancelled order, or a completed order whose results were all replaced or are missing); neither final nor cancelled is claimed.",
    },
  ],
  missing: { fhir: "unknown", reason: "The order has no status; not guessed." },
  unrecognised: { fhir: "unknown", reason: "An order status the app does not write; not guessed." },
};

// ---------------------------------------------------------------------------
// Observation.status (laboratory) <- result review state
// ---------------------------------------------------------------------------

export const LAB_OBSERVATION_STATUS: StatusMap<LabObservationStatus> = {
  element: "Observation.status (laboratory)",
  source: "result review state derived from public.lab_results.reviewed_at, interpretation and result_value",
  valueSet: "http://hl7.org/fhir/ValueSet/observation-status",
  allowed: ["registered", "preliminary", "final", "amended", "corrected", "cancelled", "entered-in-error", "unknown"],
  rules: [
    {
      source: ["reviewed"],
      fhir: "final",
      reason: "A clinician holding lab_review reviewed the result (reviewed_at is set) and an interpretation and a value are recorded.",
    },
    {
      source: ["unreviewed"],
      fhir: "preliminary",
      reason: "Entered but not yet reviewed by a clinician. Never shown as final, whatever the order status says.",
    },
    {
      source: ["review_incomplete"],
      fhir: "preliminary",
      reason:
        "reviewed_at is set but the interpretation or the value is missing (older databases allowed a review without the checks), so the review is not treated as complete.",
    },
  ],
  missing: { fhir: "unknown", reason: "No review state could be derived; not guessed." },
  unrecognised: { fhir: "unknown", reason: "A review state this map does not know; not guessed." },
};

// ---------------------------------------------------------------------------
// Observation.interpretation (laboratory) <- public.lab_results.interpretation
// ---------------------------------------------------------------------------

export const LAB_INTERPRETATION: StatusMap<LabInterpretationCode> = {
  element: "Observation.interpretation (laboratory)",
  source: "public.lab_results.interpretation",
  valueSet: "http://hl7.org/fhir/ValueSet/observation-interpretation",
  allowed: ["N", "A", "AA"],
  rules: [
    {
      source: ["normal"],
      fhir: "N",
      reason:
        "Recorded as normal. Published only once a clinician has reviewed the result: rows entered before September 2026 may carry the form's old default of 'normal' rather than a choice, so an unreviewed 'normal' is left out.",
    },
    {
      source: ["abnormal"],
      fhir: "A",
      reason: "Recorded as abnormal. mBHR stores no direction, so it is never published as high (H) or low (L).",
    },
    {
      source: ["critical"],
      fhir: "AA",
      reason:
        "Recorded as critical. mBHR stores no direction, so it is published as critical abnormal (AA): never as just abnormal, high or low, and never as critical high or critical low.",
    },
  ],
  missing: { fhir: null, reason: "No interpretation recorded: left out, never assumed normal." },
  unrecognised: { fhir: null, reason: "A value the app does not write: left out, never guessed." },
};

export const LABORATORY_STATUS_MAPS: readonly StatusMap[] = [
  SERVICE_REQUEST_STATUS,
  SERVICE_REQUEST_PRIORITY,
  DIAGNOSTIC_REPORT_STATUS,
  LAB_OBSERVATION_STATUS,
  LAB_INTERPRETATION,
];
