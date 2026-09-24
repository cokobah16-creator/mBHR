import { describe, it, expect } from "vitest";
import {
  canCancel,
  canMarkServerManually,
  canRetry,
  canSendServerNow,
  countByState,
  describeFailure,
  describeRun,
  estimateSmsParts,
  explainState,
  formatPhone,
  fromDeviceMessage,
  fromServerReminder,
  isStaffMarkedSent,
  isStuckSending,
  isWorkerSendable,
  localeFromPreference,
  maskPhone,
  normalizeMsisdn,
  normalizeReminderPhone,
  outboxTemplateFor,
  parseSendAt,
  PROVIDER_ACCEPTED_AT_KEY,
  sentAtLabel,
  sortOutbox,
  STAFF_FAILURE_PREFIX,
  STAFF_SENT_NOTE,
  stateFromDeviceStatus,
  stateFromServerStatus,
  stateLabel,
  stateTone,
  telHref,
  validateReminderDraft,
  type ReminderDraft,
  type SendingContext,
} from "./smsOutbox";

const NOW = new Date(2026, 8, 23, 12, 0, 0);

function deviceMsg(overrides: Record<string, unknown> = {}) {
  return {
    id: "m1",
    patientId: "p1",
    channel: "sms",
    to: "+2348031234567",
    locale: "en",
    templateKey: "followup.medication",
    payload: { patientName: "Ada Obi", medicationName: "Amoxicillin", dosage: "500 mg" },
    status: "queued",
    createdAt: new Date(2026, 8, 23, 8, 0).toISOString(),
    attempts: 0,
    ...overrides,
  };
}

const ctx = (over: Partial<SendingContext> = {}): SendingContext => ({
  now: NOW,
  blocker: null,
  autoSending: false,
  ...over,
});

describe("delivery state", () => {
  it("never reports delivered without a stored receipt", () => {
    expect(stateFromDeviceStatus("delivered")).toBe("sent");
    expect(stateFromDeviceStatus("delivered", "2026-09-23T10:00:00Z")).toBe("delivered");
  });

  it("maps device statuses and treats unknown values as not sent", () => {
    expect(stateFromDeviceStatus("queued")).toBe("queued");
    expect(stateFromDeviceStatus("sending")).toBe("sending");
    expect(stateFromDeviceStatus("sent")).toBe("sent");
    expect(stateFromDeviceStatus("failed")).toBe("failed");
    expect(stateFromDeviceStatus("cancelled")).toBe("cancelled");
    expect(stateFromDeviceStatus("something-else")).toBe("queued");
    expect(stateFromDeviceStatus(undefined)).toBe("queued");
  });

  it("maps server reminder statuses", () => {
    expect(stateFromServerStatus("pending")).toBe("queued");
    expect(stateFromServerStatus("sent")).toBe("sent");
    expect(stateFromServerStatus("failed")).toBe("failed");
    expect(stateFromServerStatus(undefined)).toBe("queued");
  });

  it("labels queued items by where they wait", () => {
    expect(stateLabel({ state: "queued", store: "outbox" })).toBe("Queued on this device");
    expect(stateLabel({ state: "queued", store: "server" })).toBe("Waiting on server");
    expect(stateLabel({ state: "sent", store: "queue" })).toBe("Sent to provider");
  });
});

describe("normalising stored records", () => {
  it("builds an item from a device outbox message", () => {
    const item = fromDeviceMessage(deviceMsg(), "outbox");
    expect(item.key).toBe("outbox:m1");
    expect(item.title).toBe("Amoxicillin · 500 mg");
    expect(item.state).toBe("queued");
    expect(item.payloadPatientName).toBe("Ada Obi");
    expect(item.text).toBeUndefined();
    expect(item.createdAt).toBeInstanceOf(Date);
  });

  it("keeps stored text for queue messages", () => {
    const item = fromDeviceMessage(
      deviceMsg({ templateKey: "custom", payload: { message: "Take your medicine" } }),
      "queue",
    );
    expect(item.text).toBe("Take your medicine");
    expect(item.title).toBe("SMS message");
  });

  it("builds an item from a server reminder", () => {
    const item = fromServerReminder({
      id: "r1",
      patientId: "p1",
      medicationName: "Metformin",
      dosage: "500 mg",
      scheduledAt: NOW,
      phoneNumber: "08031234567",
      message: "Hello",
      status: "sent",
      sentAt: NOW,
    });
    expect(item.key).toBe("server:r1");
    expect(item.state).toBe("sent");
    expect(item.sentAt).toEqual(NOW);
    // No provider evidence stored: not shown as accepted by the provider.
    expect(item.sentConfirmation).toBe("unconfirmed");
  });

  it("shows a server reminder as sent to the provider only with the worker's marker", () => {
    const base = {
      id: "r2",
      patientId: "p1",
      medicationName: "Metformin",
      dosage: "500 mg",
      scheduledAt: NOW,
      phoneNumber: "08031234567",
      message: "Hello",
      status: "sent",
      sentAt: NOW,
    };
    expect(
      fromServerReminder({ ...base, errorMessage: "Accepted by SMS provider (abc123)" }).sentConfirmation,
    ).toBe("provider");
    expect(
      fromServerReminder({ ...base, errorMessage: "Marked sent by staff: phoned the patient" }).sentConfirmation,
    ).toBe("staff");
  });
});

describe("actions", () => {
  it("allows cancel only for queued device messages", () => {
    expect(canCancel(fromDeviceMessage(deviceMsg(), "outbox"))).toBe(true);
    expect(canCancel(fromDeviceMessage(deviceMsg({ status: "sent" }), "outbox"))).toBe(false);
    const server = fromServerReminder({
      id: "r1",
      patientId: "p1",
      medicationName: "X",
      dosage: "1",
      scheduledAt: NOW,
      phoneNumber: "0803",
      message: "m",
      status: "pending",
    });
    expect(canCancel(server)).toBe(false);
  });

  it("allows retry for failed or stuck device messages", () => {
    expect(canRetry(fromDeviceMessage(deviceMsg({ status: "failed" }), "queue"), NOW)).toBe(true);
    const recent = fromDeviceMessage(
      deviceMsg({ status: "sending", lastAttemptAt: new Date(NOW.getTime() - 60_000) }),
      "queue",
    );
    expect(isStuckSending(recent, NOW)).toBe(false);
    expect(canRetry(recent, NOW)).toBe(false);
    const stuck = fromDeviceMessage(
      deviceMsg({ status: "sending", lastAttemptAt: new Date(NOW.getTime() - 20 * 60_000) }),
      "queue",
    );
    expect(isStuckSending(stuck, NOW)).toBe(true);
    expect(canRetry(stuck, NOW)).toBe(true);
  });

  it("offers server send and manual marks only when due", () => {
    const base = {
      id: "r1",
      patientId: "p1",
      medicationName: "X",
      dosage: "1",
      phoneNumber: "08031234567",
      message: "m",
      status: "pending",
    };
    const due = fromServerReminder({ ...base, scheduledAt: new Date(NOW.getTime() - 1000) });
    const later = fromServerReminder({ ...base, scheduledAt: new Date(NOW.getTime() + 3600_000) });
    expect(canSendServerNow(due, NOW)).toBe(true);
    expect(canMarkServerManually(due, NOW)).toBe(true);
    expect(canSendServerNow(later, NOW)).toBe(false);
    expect(canMarkServerManually(later, NOW)).toBe(false);
    const failed = fromServerReminder({ ...base, scheduledAt: later.scheduledFor, status: "failed" });
    expect(canSendServerNow(failed, NOW)).toBe(true);
  });
});

describe("counting and sorting", () => {
  it("counts per state", () => {
    const counts = countByState([
      { state: "queued" },
      { state: "queued" },
      { state: "failed" },
      { state: "sent" },
    ]);
    expect(counts.all).toBe(4);
    expect(counts.queued).toBe(2);
    expect(counts.failed).toBe(1);
    expect(counts.delivered).toBe(0);
  });

  it("puts failures first and queued items soonest first", () => {
    const a = fromDeviceMessage(
      deviceMsg({ id: "a", scheduledFor: new Date(2026, 8, 25).toISOString() }),
      "outbox",
    );
    const b = fromDeviceMessage(
      deviceMsg({ id: "b", scheduledFor: new Date(2026, 8, 24).toISOString() }),
      "outbox",
    );
    const c = fromDeviceMessage(deviceMsg({ id: "c", status: "failed" }), "outbox");
    const d = fromDeviceMessage(deviceMsg({ id: "d", status: "sent" }), "outbox");
    expect(sortOutbox([d, a, b, c]).map((i) => i.id)).toEqual(["c", "b", "a", "d"]);
  });
});

describe("wording", () => {
  it("explains a queued message when sending is not set up", () => {
    const item = fromDeviceMessage(deviceMsg(), "outbox");
    expect(explainState(item, ctx({ blocker: "not_configured" }))).toMatch(/will not be sent/);
  });

  it("explains a due message while offline", () => {
    const item = fromDeviceMessage(deviceMsg(), "outbox");
    expect(explainState(item, ctx({ blocker: "offline" }))).toMatch(/offline/);
  });

  it("says when a scheduled message will be tried", () => {
    const item = fromDeviceMessage(
      deviceMsg({ scheduledFor: new Date(2026, 8, 24, 9, 0).toISOString() }),
      "outbox",
    );
    expect(explainState(item, ctx())).toContain("24/09/2026 09:00");
  });

  it("never calls a sent message delivered", () => {
    const item = fromDeviceMessage(deviceMsg({ status: "sent" }), "queue");
    expect(explainState(item, ctx())).toMatch(/No delivery receipt/);
  });

  it("includes earlier failed attempts for retried messages", () => {
    const item = fromDeviceMessage(
      deviceMsg({ attempts: 1, errorMessage: "Failed to fetch" }),
      "queue",
    );
    expect(explainState(item, ctx({ autoSending: true }))).toMatch(/Attempt 1 of 3/);
  });

  it("turns stored errors into plain language", () => {
    expect(describeFailure("sms_not_configured")).toMatch(/No SMS provider/);
    expect(describeFailure("Invalid phone number: 123")).toMatch(/not valid/);
    expect(describeFailure("TypeError: Failed to fetch")).toMatch(/could not reach/);
    expect(describeFailure("sms_demo_mode")).toMatch(/demo mode/);
    expect(describeFailure("Mock delivery failure")).toMatch(/test gateway/);
    expect(describeFailure(undefined)).toBe("No reason was recorded.");
    expect(describeFailure("Invalid JWT")).toMatch(/Sign in online/);
    expect(describeFailure("weird provider thing")).toBe(
      "The SMS service did not accept the message.",
    );
  });
});

describe("phone numbers", () => {
  it("normalises like the server function", () => {
    expect(normalizeMsisdn("0803 123 4567")).toBe("2348031234567");
    expect(normalizeMsisdn("+234 803 123 4567")).toBe("2348031234567");
    expect(normalizeMsisdn("2348031234567")).toBe("2348031234567");
    expect(normalizeMsisdn("0803-123")).toBeNull();
    expect(normalizeMsisdn("call me")).toBeNull();
  });

  it("masks for lists and formats in full for detail", () => {
    expect(maskPhone("08031234567")).toBe("0803 *** 4567");
    expect(maskPhone("+2348031234567")).toBe("0803 *** 4567");
    expect(maskPhone("")).toBe("");
    expect(maskPhone("12345")).toBe("***");
    expect(formatPhone("+2348031234567")).toBe("0803 123 4567");
    expect(telHref("0803 123 4567")).toBe("tel:+2348031234567");
  });
});

describe("message text", () => {
  it("maps free-text language preferences", () => {
    expect(localeFromPreference("Hausa")).toBe("ha");
    expect(localeFromPreference("yo")).toBe("yo");
    expect(localeFromPreference("Pidgin English")).toBe("pcm");
    expect(localeFromPreference("French")).toBe("en");
    expect(localeFromPreference(undefined)).toBe("en");
  });

  it("uses stored text as-is and composes dispense reminders from templates", () => {
    expect(
      outboxTemplateFor({ templateKey: "custom", payload: { message: "Hi" } }),
    ).toEqual({ kind: "text", text: "Hi" });
    const t = outboxTemplateFor({
      templateKey: "followup.medication",
      locale: "Hausa",
      payload: { patientName: "Ada", medicationName: "Amoxicillin", dosage: "500 mg" },
    });
    expect(t).toEqual({
      kind: "template",
      key: "medication_reminder",
      locale: "ha",
      vars: { patient_name: "Ada", medication: "Amoxicillin", dosage: "500 mg" },
    });
    expect(outboxTemplateFor({ templateKey: "unknown", payload: {} })).toBeNull();
  });

  it("estimates SMS parts", () => {
    expect(estimateSmsParts("")).toEqual({ chars: 0, parts: 0, unicode: false });
    expect(estimateSmsParts("a".repeat(160)).parts).toBe(1);
    expect(estimateSmsParts("a".repeat(161)).parts).toBe(2);
    expect(estimateSmsParts("Ẹ káàrọ̀").unicode).toBe(true);
  });
});

describe("scheduling form", () => {
  const valid: ReminderDraft = {
    patientId: "p1",
    phone: "0803 123 4567",
    medicationName: "Amoxicillin",
    dosage: "500 mg",
    message: "Take your medicine",
    sendDate: "2026-09-24",
    sendTime: "09:00",
  };

  it("accepts a complete draft", () => {
    expect(validateReminderDraft(valid, NOW)).toEqual({});
  });

  it("reports each missing or invalid field", () => {
    const errors = validateReminderDraft(
      { ...valid, patientId: "", phone: "12", medicationName: " ", dosage: "", message: "" },
      NOW,
    );
    expect(Object.keys(errors).sort()).toEqual(
      ["dosage", "medicationName", "message", "patientId", "phone"].sort(),
    );
  });

  it("rejects past, far-future and impossible dates", () => {
    expect(validateReminderDraft({ ...valid, sendDate: "2026-09-22" }, NOW).sendDate).toMatch(
      /passed/,
    );
    expect(validateReminderDraft({ ...valid, sendDate: "2027-09-22" }, NOW).sendDate).toMatch(
      /90 days/,
    );
    expect(parseSendAt("2026-02-31", "09:00")).toBeNull();
    expect(parseSendAt("", "09:00")).toBeNull();
  });

  it("rejects over-long messages", () => {
    expect(validateReminderDraft({ ...valid, message: "a".repeat(500) }, NOW).message).toMatch(
      /459/,
    );
  });
});

describe("tone and run summaries", () => {
  it("raises due-but-blocked and retried messages to warning", () => {
    const queued = fromDeviceMessage(deviceMsg(), "outbox");
    expect(stateTone(queued, NOW, null)).toBe("info");
    expect(stateTone(queued, NOW, "offline")).toBe("warning");
    const retried = fromDeviceMessage(deviceMsg({ attempts: 1, errorMessage: "x" }), "queue");
    expect(stateTone(retried, NOW, null)).toBe("warning");
    const later = fromDeviceMessage(
      deviceMsg({ scheduledFor: new Date(2026, 8, 30).toISOString() }),
      "outbox",
    );
    expect(stateTone(later, NOW, "offline")).toBe("info");
    expect(stateTone(fromDeviceMessage(deviceMsg({ status: "failed" }), "queue"), NOW, null)).toBe(
      "danger",
    );
  });

  it("records the sent time of device messages from the accepted attempt", () => {
    const at = new Date(2026, 8, 23, 9, 0);
    const sent = fromDeviceMessage(deviceMsg({ status: "sent", lastAttemptAt: at }), "queue");
    expect(sent.sentAt).toEqual(at);
    const failed = fromDeviceMessage(deviceMsg({ status: "failed", lastAttemptAt: at }), "queue");
    expect(failed.sentAt).toBeUndefined();
  });

  it("summarises send runs without claiming delivery", () => {
    expect(describeRun({ reminders: 0, messages: 0, skipped: "offline" })).toMatch(/offline/);
    expect(describeRun({ reminders: 0, messages: 0, skipped: "not_configured" })).toMatch(
      /not set up/,
    );
    expect(describeRun({ reminders: 0, messages: 0, failed: 0 })).toBe("Nothing was due.");
    // A blocker added later must never read as "Nothing was due".
    const unknown = { reminders: 0, messages: 0, skipped: "future_blocker" } as unknown as Parameters<
      typeof describeRun
    >[0];
    expect(describeRun(unknown)).toMatch(/Nothing was sent/);
    expect(describeRun({ reminders: 1, messages: 2, failed: 1 })).toBe(
      "3 messages accepted by the SMS provider, 1 not sent.",
    );
    expect(describeRun({ reminders: 0, messages: 1 })).toBe(
      "1 message accepted by the SMS provider.",
    );
  });

  it("shows staff reasons as written", () => {
    expect(describeFailure(`${STAFF_FAILURE_PREFIX} Patient stopped the medicine`)).toBe(
      "Marked as failed by staff: Patient stopped the medicine",
    );
  });
});

describe("who recorded a message as sent", () => {
  it("says sent to provider only when the worker stored an acceptance", () => {
    const acceptedAt = new Date(2026, 8, 23, 9, 30);
    const accepted = fromDeviceMessage(
      deviceMsg({
        status: "sent",
        lastAttemptAt: new Date(2026, 8, 23, 9, 31).toISOString(),
        payload: {
          medicationName: "Amoxicillin",
          [PROVIDER_ACCEPTED_AT_KEY]: acceptedAt.toISOString(),
        },
      }),
      "outbox",
    );
    expect(accepted.sentConfirmation).toBe("provider");
    expect(accepted.sentAt).toEqual(acceptedAt);
    expect(stateLabel(accepted)).toBe("Sent to provider");
    expect(stateTone(accepted, NOW, null)).toBe("success");
    expect(sentAtLabel(accepted.sentConfirmation)).toBe("Accepted by provider");
  });

  it("flags device messages marked sent with no provider acceptance", () => {
    const legacy = fromDeviceMessage(deviceMsg({ status: "sent" }), "outbox");
    expect(legacy.state).toBe("sent");
    expect(legacy.sentConfirmation).toBe("unconfirmed");
    expect(stateLabel(legacy)).toBe("Marked sent, not confirmed");
    expect(stateTone(legacy, NOW, null)).toBe("warning");
    expect(explainState(legacy, ctx())).toMatch(/may not have reached the patient/);
    expect(explainState(legacy, ctx())).not.toMatch(/Accepted by the SMS provider/);
    expect(sentAtLabel(legacy.sentConfirmation)).toBe("Marked sent");
  });

  it("treats the old worker's delivered-without-receipt as provider accepted, not delivered", () => {
    const old = fromDeviceMessage(deviceMsg({ status: "delivered" }), "queue");
    expect(old.state).toBe("sent");
    expect(old.sentConfirmation).toBe("provider");
  });

  it("shows server reminders staff marked sent as such", () => {
    const base = {
      id: "r1",
      patientId: "p1",
      medicationName: "Metformin",
      dosage: "500 mg",
      scheduledAt: NOW,
      phoneNumber: "08031234567",
      message: "Hello",
      status: "sent",
      sentAt: NOW,
    };
    const staff = fromServerReminder({ ...base, errorMessage: STAFF_SENT_NOTE });
    expect(isStaffMarkedSent(STAFF_SENT_NOTE)).toBe(true);
    expect(staff.sentConfirmation).toBe("staff");
    expect(stateLabel(staff)).toBe("Marked sent by staff");
    expect(stateTone(staff, NOW, null)).toBe("neutral");
    expect(explainState(staff, ctx())).toMatch(/mBHR did not send it/);

    const provider = fromServerReminder({ ...base, errorMessage: "Accepted by SMS provider" });
    expect(provider.sentConfirmation).toBe("provider");
    expect(explainState(provider, ctx())).toMatch(/No delivery receipt/);

    const failed = fromServerReminder({ ...base, status: "failed", errorMessage: "x" });
    expect(failed.sentConfirmation).toBeUndefined();
  });
});

describe("what the worker sends from the device outbox", () => {
  it("sends SMS with stored text or a known template, and leaves the rest queued", () => {
    expect(isWorkerSendable(deviceMsg())).toBe(true);
    expect(
      isWorkerSendable({ channel: "sms", templateKey: "portal.invitation", payload: {} }),
    ).toBe(false);
    expect(
      isWorkerSendable({
        channel: "sms",
        templateKey: "portal.invitation",
        payload: { message: "Your portal code" },
      }),
    ).toBe(true);
    expect(isWorkerSendable(deviceMsg({ channel: "whatsapp" }))).toBe(false);
  });
});

describe("failure wording edge cases", () => {
  it("does not mistake other words for rate limits or staff cancels", () => {
    expect(describeFailure("rate limited (429): slow down")).toMatch(/Too many/);
    expect(describeFailure("Could not generate token")).toBe(
      "The SMS service did not accept the message.",
    );
    expect(describeFailure("AbortError: request cancelled")).not.toMatch(/staff/);
  });

  it("attributes the device portal worker's error to this device", () => {
    expect(describeFailure("SMS/Email provider not configured")).toMatch(/on this device/);
  });
});

describe("phone numbers typed into the scheduling form", () => {
  it("reads bare digits only as Nigerian numbers", () => {
    expect(normalizeReminderPhone("0803 123 4567")).toBe("2348031234567");
    expect(normalizeReminderPhone("803 123 4567")).toBe("2348031234567");
    expect(normalizeReminderPhone("2348031234567")).toBe("2348031234567");
    expect(normalizeReminderPhone("+44 7911 123456")).toBe("447911123456");
    // The server rule would send this to another country.
    expect(normalizeMsisdn("447911123456")).toBe("447911123456");
    expect(normalizeReminderPhone("447911123456")).toBeNull();
    expect(normalizeReminderPhone("12345")).toBeNull();
  });
});

describe("sign-in and role blockers", () => {
  it("explains a queued message when nobody is signed in online", () => {
    const item = fromDeviceMessage(deviceMsg(), "outbox");
    const text = explainState(item, ctx({ blocker: "signed_out" }));
    expect(text).toMatch(/signed in online/);
    expect(text).toMatch(/Saved on this device only/);
  });

  it("explains a queued message when the role cannot send SMS", () => {
    const item = fromDeviceMessage(deviceMsg(), "queue");
    expect(explainState(item, ctx({ blocker: "not_permitted" }))).toMatch(/role cannot send SMS/);
  });

  it("summarises runs that were skipped for sign-in or role", () => {
    expect(describeRun({ reminders: 0, messages: 0, skipped: "signed_out" })).toMatch(
      /Nothing was sent: nobody is signed in online/,
    );
    expect(describeRun({ reminders: 0, messages: 0, skipped: "not_permitted" })).toMatch(
      /Nothing was sent: .*role cannot send SMS/,
    );
  });
});

describe("server function error codes", () => {
  it.each([
    ["not_authenticated: Sign in online with a staff account to send SMS.", /signed in online/],
    ["not_permitted: Your role cannot send SMS to patients.", /role cannot send SMS/],
    ["patient_not_found: This patient is not on the server yet.", /not on the server yet/],
    ["no_phone: The patient has no phone number on the server.", /has no phone number/],
    ["invalid_recipient", /not a valid Nigerian mobile number/],
    ["rate_limit_unavailable: paused", /could not check the send limit/],
    ["staff_lookup_failed", /could not check your staff account/],
    ["lookup_failed", /could not look up the patient or reminder/],
    ["already_sent: This reminder was already sent.", /already records this reminder as sent/],
  ])("describes %s", (code, expected) => {
    expect(describeFailure(code)).toMatch(expected);
  });

  it("does not treat an unavailable rate limit as 'too many messages'", () => {
    expect(describeFailure("rate_limit_unavailable")).not.toMatch(/Too many/);
  });

  it("keeps the staff lookup failure separate from the record lookup failure", () => {
    expect(describeFailure("staff_lookup_failed")).not.toMatch(/patient or reminder/);
  });

  it("does not claim the server recorded a send it could not record", () => {
    const text = describeFailure(
      "accepted_not_recorded: the SMS provider accepted this reminder from this device, but the server record could not be updated",
    );
    expect(text).toMatch(/server could not record it/);
    expect(text).not.toMatch(/already records/);
  });

  it("describes a message the server refused as empty or too long", () => {
    expect(describeFailure("invalid_message: The message is empty or too long.")).toMatch(
      /empty or too long/,
    );
  });
});
