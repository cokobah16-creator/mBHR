/**
 * One patient-facing vocabulary for the status of anything a patient asks
 * for: appointment and video-visit requests today, refills and other
 * requests later. Stored values differ between tables; patients see the same
 * few words everywhere, and never a raw database value.
 *
 * "Submitted" and "Under review" are deliberately different from "Approved"
 * and "Scheduled", so a sent request never reads as a confirmed one.
 */
import type { Tone } from "@/components/ui/StatusBadge";

export type PatientRequestStatus =
  | "submitted"
  | "underReview"
  | "approved"
  | "scheduled"
  | "completed"
  | "declined"
  | "cancelled"
  | "unknown";

const FROM_STORED: Record<string, PatientRequestStatus> = {
  // patient_appointment_requests.status
  pending: "submitted",
  submitted: "submitted",
  in_review: "underReview",
  under_review: "underReview",
  reviewing: "underReview",
  approved: "approved",
  scheduled: "scheduled",
  booked: "scheduled",
  completed: "completed",
  ready: "completed",
  declined: "declined",
  rejected: "declined",
  denied: "declined",
  cancelled: "cancelled",
  canceled: "cancelled",
};

/** Map a stored status (any case, any of the known spellings) to the patient vocabulary. */
export function toPatientRequestStatus(
  stored: string | null | undefined,
): PatientRequestStatus {
  if (!stored) return "unknown";
  return FROM_STORED[stored.trim().toLowerCase()] ?? "unknown";
}

const TONE: Record<PatientRequestStatus, Tone> = {
  submitted: "info",
  underReview: "info",
  approved: "success",
  scheduled: "success",
  completed: "neutral",
  declined: "danger",
  cancelled: "neutral",
  unknown: "neutral",
};

export interface PatientRequestStatusInfo {
  status: PatientRequestStatus;
  /** i18n key for the badge label. */
  labelKey: string;
  /** i18n key for one line saying what happens next. */
  nextKey: string;
  tone: Tone;
}

export function patientRequestStatusInfo(
  stored: string | null | undefined,
): PatientRequestStatusInfo {
  const status = toPatientRequestStatus(stored);
  return {
    status,
    labelKey: `portal.request.status.${status}`,
    nextKey: `portal.request.next.${status}`,
    tone: TONE[status],
  };
}

/** Statuses a patient may still cancel themselves (the server has the final say). */
export function isPatientCancellable(stored: string | null | undefined): boolean {
  return toPatientRequestStatus(stored) === "submitted";
}
