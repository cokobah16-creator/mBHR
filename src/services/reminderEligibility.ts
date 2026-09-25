/**
 * Whether an SMS reminder may be queued, or sent, for a patient.
 *
 * A patient who turned a reminder type off in their preferences
 * (medicationReminders / appointmentReminders off) must not get that
 * reminder. A patient with no preference record has not opted out. A patient
 * with no phone number on record cannot get an SMS at all.
 *
 * Preference records made on this device store 0 (off) or 1 (on). Records
 * pulled from the server can hold false or true instead. Both forms mean the
 * same: 0 and false are off, 1 and true are on.
 */

export type ReminderKind = "medication" | "appointment";

export type ReminderSkipReason = "opted_out" | "no_phone";

export interface ReminderPreference {
  medicationReminders?: boolean | number | null;
  appointmentReminders?: boolean | number | null;
}

/** Staff-facing sentence for each reason (no patient details). */
export const REMINDER_SKIP_MESSAGE: Record<ReminderSkipReason, string> = {
  opted_out: "The patient has turned off this type of SMS reminder.",
  no_phone: "The patient has no phone number on record.",
};

/**
 * Whether the patient turned this type of reminder off. 0 and false mean
 * off. 1, true, an empty setting and no preference record at all mean the
 * patient has not opted out.
 */
export function isReminderOptedOut(
  kind: ReminderKind,
  preference?: ReminderPreference | null,
): boolean {
  const setting =
    kind === "medication"
      ? preference?.medicationReminders
      : preference?.appointmentReminders;
  return setting === 0 || setting === false;
}

/** Why the reminder must not be queued, or null when it may be. */
export function reminderSkipReason(
  kind: ReminderKind,
  patient: { phone?: string | null },
  preference?: ReminderPreference | null,
): ReminderSkipReason | null {
  if (isReminderOptedOut(kind, preference)) return "opted_out";
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
