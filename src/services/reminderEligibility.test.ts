import { describe, it, expect } from "vitest";
import {
  REMINDER_SKIP_MESSAGE,
  ReminderSkippedError,
  isReminderOptedOut,
  reminderSkipReason,
} from "./reminderEligibility";

const withPhone = { phone: "08031234567" };

describe("reminderSkipReason", () => {
  it("allows a reminder when there is no preference record", () => {
    expect(reminderSkipReason("medication", withPhone, undefined)).toBeNull();
    expect(reminderSkipReason("appointment", withPhone, null)).toBeNull();
  });

  it("allows a reminder when the patient kept it on", () => {
    expect(
      reminderSkipReason("medication", withPhone, { medicationReminders: 1 }),
    ).toBeNull();
  });

  it("skips medication reminders the patient opted out of", () => {
    expect(
      reminderSkipReason("medication", withPhone, {
        medicationReminders: 0,
        appointmentReminders: 1,
      }),
    ).toBe("opted_out");
  });

  it("checks the setting for the reminder type only", () => {
    const pref = { medicationReminders: 0 as const, appointmentReminders: 1 as const };
    expect(reminderSkipReason("appointment", withPhone, pref)).toBeNull();
    expect(
      reminderSkipReason("appointment", withPhone, { appointmentReminders: 0 }),
    ).toBe("opted_out");
  });

  it("skips patients with no phone number", () => {
    expect(reminderSkipReason("medication", { phone: "" })).toBe("no_phone");
    expect(reminderSkipReason("medication", { phone: "   " })).toBe("no_phone");
    expect(reminderSkipReason("medication", {})).toBe("no_phone");
    expect(reminderSkipReason("medication", { phone: null })).toBe("no_phone");
  });

  it("treats a setting pulled from the server as false like 0", () => {
    expect(
      reminderSkipReason("medication", withPhone, { medicationReminders: false }),
    ).toBe("opted_out");
    expect(
      reminderSkipReason("appointment", withPhone, { appointmentReminders: false }),
    ).toBe("opted_out");
  });

  it("treats a setting pulled from the server as true like 1", () => {
    expect(
      reminderSkipReason("medication", withPhone, { medicationReminders: true }),
    ).toBeNull();
    expect(
      reminderSkipReason("appointment", withPhone, {
        medicationReminders: false,
        appointmentReminders: true,
      }),
    ).toBeNull();
  });

  it("does not read an empty setting as an opt-out", () => {
    expect(
      reminderSkipReason("medication", withPhone, { medicationReminders: null }),
    ).toBeNull();
    expect(reminderSkipReason("appointment", withPhone, {})).toBeNull();
  });

  it("reports an opt-out before a missing phone", () => {
    expect(
      reminderSkipReason("medication", { phone: "" }, { medicationReminders: 0 }),
    ).toBe("opted_out");
  });
});

describe("isReminderOptedOut", () => {
  it("reads 0 and false as off, and 1, true or nothing as on", () => {
    expect(isReminderOptedOut("medication", { medicationReminders: 0 })).toBe(true);
    expect(isReminderOptedOut("medication", { medicationReminders: false })).toBe(true);
    expect(isReminderOptedOut("medication", { medicationReminders: 1 })).toBe(false);
    expect(isReminderOptedOut("medication", { medicationReminders: true })).toBe(false);
    expect(isReminderOptedOut("medication", { medicationReminders: null })).toBe(false);
    expect(isReminderOptedOut("medication", undefined)).toBe(false);
    expect(isReminderOptedOut("appointment", null)).toBe(false);
  });

  it("does not need a phone number", () => {
    expect(isReminderOptedOut("appointment", { appointmentReminders: false })).toBe(true);
  });
});

describe("ReminderSkippedError", () => {
  it("carries the reason and a message without patient details", () => {
    const error = new ReminderSkippedError("medication", "opted_out");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ReminderSkippedError");
    expect(error.reason).toBe("opted_out");
    expect(error.kind).toBe("medication");
    expect(error.message).toContain(REMINDER_SKIP_MESSAGE.opted_out);
  });
});
