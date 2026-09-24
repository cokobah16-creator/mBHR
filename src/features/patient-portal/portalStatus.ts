/**
 * Plain-language labels and badge tones for the patient portal.
 *
 * Display only: these map values already stored in the record to words a
 * patient can read. They never decide whether a result is normal; that comes
 * from the record itself (for example `abnormal` on a lab result).
 */
import type { Tone } from "@/components/ui/StatusBadge";

export interface StatusInfo {
  label: string;
  tone: Tone;
}

// ─── Dates ────────────────────────────────────────────────────────────────────

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === "string") {
    // A bare calendar date ("2026-03-12") is a day, not an instant: build it
    // in local time so it never shows as the day before.
    const m = DATE_ONLY.exec(value);
    if (m) {
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      return isNaN(d.getTime()) ? null : d;
    }
  }
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/** "12 Mar 2026". Empty string when the value is missing or invalid. */
export function formatPortalDate(
  value: Date | string | number | null | undefined,
): string {
  const d = toDate(value);
  if (!d) return "";
  return d.toLocaleDateString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** "Thursday, 12 March 2026". Empty string when missing or invalid. */
export function formatPortalLongDate(
  value: Date | string | number | null | undefined,
): string {
  const d = toDate(value);
  if (!d) return "";
  return d.toLocaleDateString("en-NG", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** "14:30". Empty string when missing or invalid. */
export function formatPortalTime(
  value: Date | string | number | null | undefined,
): string {
  const d = toDate(value);
  if (!d) return "";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

// ─── Vitals ───────────────────────────────────────────────────────────────────

/** Badge tone for the dashboard's existing vital flags (flags decided elsewhere). */
export function vitalStatusTone(
  status: "normal" | "monitor" | "attention",
): Tone {
  switch (status) {
    case "normal":
      return "success";
    case "monitor":
      return "warning";
    case "attention":
      return "danger";
  }
}

// ─── Lab results ──────────────────────────────────────────────────────────────
//
// The portal shows only results the clinic has reviewed and released
// (portal_my_lab_results). Every row it gets is therefore "released".

/**
 * Status of a lab result row. "released" is the only status the portal
 * receives today; the other values are kept for older callers.
 */
export function labStatusInfo(status: string | null | undefined): StatusInfo {
  switch (status) {
    case "released":
    case "reviewed":
      // Not green: a reviewed result can still be outside the usual range.
      return { label: "Reviewed by the clinic", tone: "info" };
    case "completed":
      return { label: "Result ready", tone: "info" };
    case "pending":
      return { label: "Waiting for result", tone: "neutral" };
    default:
      return { label: "Status not recorded", tone: "neutral" };
  }
}

/** A result value exists once the test is completed (and after review). */
export function labHasResult(status: string | null | undefined): boolean {
  return status === "completed" || status === "reviewed" || status === "released";
}

/**
 * Plain words for the interpretation the clinic recorded. Display only: the
 * interpretation itself is chosen by clinic staff, never worked out here.
 * A missing or unexpected value is never shown as normal.
 */
export function portalLabInterpretationInfo(
  interpretation: string | null | undefined,
): StatusInfo {
  switch (interpretation) {
    case "normal":
      return { label: "In the usual range", tone: "success" };
    case "abnormal":
      return { label: "Outside the usual range", tone: "warning" };
    case "critical":
      return { label: "Needs prompt attention", tone: "danger" };
    default:
      return { label: "Ask the clinic about this result", tone: "neutral" };
  }
}

/** What the patient should do next, by the recorded interpretation. */
export function portalLabAdvice(
  interpretation: string | null | undefined,
): { text: string; tone: "info" | "warning" | "danger" } {
  switch (interpretation) {
    case "normal":
      return {
        text: "Talk to your clinician about this result if you have questions.",
        tone: "info",
      };
    case "abnormal":
      return {
        text: "This result is outside the usual range. Talk to your clinician about this result.",
        tone: "warning",
      };
    case "critical":
      return {
        text: "This result needs prompt attention. Contact the clinic or the outreach team as soon as you can. If you feel very unwell, go to the nearest hospital.",
        tone: "danger",
      };
    default:
      return {
        text: "The clinic has not recorded how this result reads. Ask your clinician what it means for you.",
        tone: "info",
      };
  }
}

/**
 * Why the lab results list is empty when it did not load. Null for "ok"
 * (an empty list then really means nothing has been released yet).
 */
export function portalLabLoadNotice(
  status: string,
): { title: string; body: string; tone: "info" | "warning" | "danger"; retry: boolean } | null {
  switch (status) {
    case "ok":
      return null;
    case "unavailable":
      return {
        title: "Lab results are not available here",
        body: "This portal is not connected to the clinic's online records, so lab results cannot be shown. Ask the outreach team about your results at your next visit.",
        tone: "info",
        retry: false,
      };
    case "offline":
      return {
        title: "You are offline",
        body: "Lab results are not saved on this phone. Connect to the internet to see them.",
        tone: "warning",
        retry: false,
      };
    case "not_signed_in":
      return {
        title: "Sign in online to see lab results",
        body: "Lab results are only shown when you are signed in to the portal online. Sign out, then sign in again while connected to the internet.",
        tone: "info",
        retry: false,
      };
    case "not_updated":
      return {
        title: "Lab results are not available yet",
        body: "The clinic's online system has not been set up to share lab results yet. Ask the outreach team about your results.",
        tone: "info",
        retry: false,
      };
    default:
      return {
        title: "We could not load your lab results",
        body: "This page could not reach the clinic's records. Please try again.",
        tone: "danger",
        retry: true,
      };
  }
}

// ─── Conditions (patient_medical_conditions.status) ───────────────────────────

export function conditionStatusInfo(
  status: string | null | undefined,
): StatusInfo {
  switch (status) {
    case "active":
      return { label: "Current", tone: "info" };
    case "managed":
      return { label: "Being managed", tone: "neutral" };
    case "resolved":
      return { label: "Resolved", tone: "success" };
    default:
      return { label: "Status not recorded", tone: "neutral" };
  }
}

// ─── Appointments and requests ────────────────────────────────────────────────

/** patient_appointment_requests.status (also used for video visit requests). */
export function appointmentRequestStatusInfo(
  status: string | null | undefined,
): StatusInfo {
  switch (status) {
    case "pending":
      return { label: "Waiting for the clinic to review", tone: "info" };
    case "approved":
      return { label: "Approved", tone: "success" };
    case "scheduled":
      return { label: "Booked", tone: "success" };
    case "declined":
      return { label: "Declined", tone: "danger" };
    case "cancelled":
      return { label: "Cancelled", tone: "neutral" };
    default:
      return { label: "Status not recorded", tone: "neutral" };
  }
}

/** appointments.status (in-person and video visits). */
export function appointmentStatusInfo(
  status: string | null | undefined,
): StatusInfo {
  switch (status) {
    case "scheduled":
      return { label: "Scheduled", tone: "info" };
    case "confirmed":
      return { label: "Confirmed", tone: "success" };
    case "arrived":
      return { label: "Checked in", tone: "info" };
    case "in-progress":
      return { label: "In progress", tone: "info" };
    case "completed":
      return { label: "Completed", tone: "neutral" };
    case "no-show":
      return { label: "Missed", tone: "warning" };
    case "cancelled":
      return { label: "Cancelled", tone: "neutral" };
    default:
      return { label: "Status not recorded", tone: "neutral" };
  }
}

const UPCOMING_STATUSES = new Set(["scheduled", "confirmed"]);

/** Scheduled or confirmed appointments that have not started yet, soonest first. */
export function upcomingAppointments<
  T extends { scheduledAt: Date | string; status: string },
>(items: readonly T[], now: number = Date.now()): T[] {
  return items
    .filter(
      (a) =>
        UPCOMING_STATUSES.has(a.status) &&
        new Date(a.scheduledAt).getTime() >= now,
    )
    .sort(
      (a, b) =>
        new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
    );
}

/** The soonest scheduled or confirmed appointment that has not started yet. */
export function pickNextAppointment<
  T extends { scheduledAt: Date | string; status: string },
>(items: readonly T[], now: number = Date.now()): T | undefined {
  return upcomingAppointments(items, now)[0];
}

// ─── Secure messages ──────────────────────────────────────────────────────────

/**
 * Delivery state of a message, from what the record actually says.
 * `local` is a message saved on this phone that has not reached the server.
 */
export function messageDeliveryInfo(msg: {
  fromPatient: boolean;
  read: boolean;
  local?: boolean;
}): StatusInfo {
  if (msg.local) return { label: "Not sent", tone: "warning" };
  if (!msg.fromPatient) {
    return msg.read
      ? { label: "Read", tone: "neutral" }
      : { label: "New", tone: "info" };
  }
  return msg.read
    ? { label: "Seen by the clinic team", tone: "success" }
    : { label: "Sent, not opened yet", tone: "neutral" };
}

// ─── Lists ────────────────────────────────────────────────────────────────────

/** Append a page of results, skipping any item already in the list. */
export function appendUnique<T>(
  existing: readonly T[],
  incoming: readonly T[],
  key: (item: T) => string,
): T[] {
  const seen = new Set(existing.map(key));
  const out = [...existing];
  for (const item of incoming) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}
