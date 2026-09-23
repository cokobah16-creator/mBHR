import { describe, it, expect } from "vitest";
import {
  REMINDER_SKIP_MESSAGE,
  ReminderSkippedError,
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

  it("reports an opt-out before a missing phone", () => {
    expect(
      reminderSkipReason("medication", { phone: "" }, { medicationReminders: 0 }),
    ).toBe("opted_out");
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
