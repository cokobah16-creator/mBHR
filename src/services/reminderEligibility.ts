/**
 * Whether an SMS reminder may be queued for a patient.
 *
 * A patient who turned a reminder type off in their preferences
 * (medicationReminders / appointmentReminders set to 0) must not get that
 * reminder. A patient with no preference record has not opted out. A patient
 * with no phone number on record cannot get an SMS at all.
 */

export type ReminderKind = "medication" | "appointment";

export type ReminderSkipReason = "opted_out" | "no_phone";

export interface ReminderPreference {
  medicationReminders?: 0 | 1 | number | null;
  appointmentReminders?: 0 | 1 | number | null;
}

/** Staff-facing sentence for each reason (no patient details). */
export const REMINDER_SKIP_MESSAGE: Record<ReminderSkipReason, string> = {
  opted_out: "The patient has turned off this type of SMS reminder.",
  no_phone: "The patient has no phone number on record.",
};

/** Why the reminder must not be queued, or null when it may be. */
export function reminderSkipReason(
  kind: ReminderKind,
  patient: { phone?: string | null },
  preference?: ReminderPreference | null,
): ReminderSkipReason | null {
  const setting =
    kind === "medication"
      ? preference?.medicationReminders
      : preference?.appointmentReminders;
  if (setting === 0) return "opted_out";
  if (!patient.phone || !patient.phone.trim()) return "no_phone";
  return null;
}

/**
 * Thrown by the messaging service when a reminder is not queued on purpose.
 * Callers already treat a thrown error as "no reminder was set up"; they can
 * check `reason` to tell staff why.
 */
export class ReminderSkippedError extends Error {
  readonly reason: ReminderSkipReason;
  readonly kind: ReminderKind;

  constructor(kind: ReminderKind, reason: ReminderSkipReason) {
    super(`SMS reminder not queued: ${REMINDER_SKIP_MESSAGE[reason]}`);
    this.name = "ReminderSkippedError";
    this.kind = kind;
    this.reason = reason;
  }
}
