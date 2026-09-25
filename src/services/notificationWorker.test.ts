import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { REMINDER_SKIP_MESSAGE } from "./reminderEligibility";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockOutboundMessages: Map<string, any> = new Map();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockOutboxMessages: Map<string, any> = new Map();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockMedicationReminders: any[] = [];
// Patient preference records on this device, by patient id.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockPreferences: Map<string, any> = new Map();
const mockPreferenceLookup = { fails: false };

/** `.and(pred).modify(changes)` over a Map store, as Dexie does it. */
function mockModify(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  store: Map<string, any>,
  field: string,
  value: unknown,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return vi.fn((pred: (msg: any) => boolean) => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    modify: vi.fn((changes: any) => {
      let count = 0;
      for (const [id, msg] of store) {
        if (msg[field] === value && pred(msg)) {
          store.set(id, { ...msg, ...changes });
          count++;
        }
      }
      return Promise.resolve(count);
    }),
  }));
}

vi.mock("@/db", () => ({
  db: {
    outboundMessages: {
      where: vi.fn((field: string) => ({
        equals: vi.fn((value: string) => ({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          filter: vi.fn((filterFn: (msg: any) => boolean) => ({
            limit: vi.fn(() => ({
              toArray: vi.fn(() => {
                const results = Array.from(mockOutboundMessages.values())
                  .filter((msg) => msg.status === value)
                  .filter(filterFn);
                return Promise.resolve(results);
              }),
            })),
            count: vi.fn(() => {
              const results = Array.from(mockOutboundMessages.values())
                .filter((msg) => msg.status === value)
                .filter(filterFn);
              return Promise.resolve(results.length);
            }),
          })),
          and: mockModify(mockOutboundMessages, field, value),
          count: vi.fn(() => {
            const count = Array.from(mockOutboundMessages.values()).filter(
              (msg) => msg[field] === value,
            ).length;
            return Promise.resolve(count);
          }),
        })),
      })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      add: vi.fn((msg: any) => {
        mockOutboundMessages.set(msg.id, msg);
        return Promise.resolve(msg.id);
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: vi.fn((id: string, updates: any) => {
        const msg = mockOutboundMessages.get(id);
        if (msg) {
          mockOutboundMessages.set(id, { ...msg, ...updates });
        }
        return Promise.resolve(1);
      }),
    },
    patientPreferences: {
      where: vi.fn(() => ({
        equals: vi.fn((patientId: string) => ({
          first: vi.fn(() =>
            mockPreferenceLookup.fails
              ? Promise.reject(new Error("DatabaseClosedError"))
              : Promise.resolve(mockPreferences.get(patientId)),
          ),
        })),
      })),
    },
  },
}));

vi.mock("@/db/outbox", () => ({
  outboxDb: {
    outboundMessages: {
      where: vi.fn((field: string) => ({
        equals: vi.fn((value: string) => ({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          filter: vi.fn((filterFn: (msg: any) => boolean) => ({
            limit: vi.fn(() => ({
              toArray: vi.fn(() =>
                Promise.resolve(
                  Array.from(mockOutboxMessages.values())
                    .filter((msg) => msg[field] === value)
                    .filter(filterFn),
                ),
              ),
            })),
          })),
          and: mockModify(mockOutboxMessages, field, value),
        })),
      })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: vi.fn((id: string, updates: any) => {
        const msg = mockOutboxMessages.get(id);
        if (msg) mockOutboxMessages.set(id, { ...msg, ...updates });
        return Promise.resolve(msg ? 1 : 0);
      }),
    },
  },
}));

// Online session on this device (null: nobody signed in online).
const mockSession: { current: { access_token: string; user?: { id: string } } | null } = {
  current: null,
};
// The staff member signed in online in this session (src/lib/cloudSession.ts).
const STAFF_CLOUD_ID = "staff-1";
vi.mock("@/lib/cloudSession", () => ({
  isSignedInStaffAccount: (id: string | null | undefined) => id === "staff-1",
}));
// Every update the worker tries on a server table.
const mockTableUpdates: { table: string; values: unknown }[] = [];

/** Chain the worker builds for due server reminders. */
interface MockReminderQuery {
  eq: () => MockReminderQuery;
  lte: () => MockReminderQuery;
  or: (expr: string) => MockReminderQuery;
  order: () => MockReminderQuery;
  limit: (n: number) => Promise<{ data: unknown[]; error: null }>;
}

/**
 * The worker's due-reminder query: pending rows, oldest first (scheduled_at,
 * then id), after the keyset cursor it passes to `.or()`, `limit` at a time.
 */
function mockReminderQuery(): MockReminderQuery {
  let after: { at: string; id: string } | null = null;
  const key = (r: { scheduled_at?: string; id?: string }): [string, string] => [
    String(r.scheduled_at ?? ""),
    String(r.id ?? ""),
  ];
  const compare = (a: [string, string], b: [string, string]) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0;
  const builder: MockReminderQuery = {
    eq: vi.fn(() => builder),
    lte: vi.fn(() => builder),
    or: vi.fn((expr: string) => {
      const m =
        /^scheduled_at\.gt\."([^"]*)",and\(scheduled_at\.eq\."([^"]*)",id\.gt\."([^"]*)"\)$/.exec(
          expr,
        );
      if (m && m[1] === m[2]) after = { at: m[1], id: m[3] };
      return builder;
    }),
    order: vi.fn(() => builder),
    limit: vi.fn((n: number) => {
      const rows = mockMedicationReminders
        .filter((r) => r.status === "pending")
        .filter((r) => !after || compare(key(r), [after.at, after.id]) > 0)
        .sort((a, b) => compare(key(a), key(b)))
        .slice(0, n);
      return Promise.resolve({ data: rows, error: null });
    }),
  };
  return builder;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(() =>
        Promise.resolve({ data: { session: mockSession.current }, error: null }),
      ),
    },
    from: vi.fn((table: string) => ({
      select: vi.fn(() => mockReminderQuery()),
      update: vi.fn((values: unknown) => {
        mockTableUpdates.push({ table, values });
        return { eq: vi.fn(() => Promise.resolve({ error: null })) };
      }),
    })),
  },
}));

vi.mock("@/services/sms", () => ({
  markReminderSent: vi.fn(() => Promise.resolve()),
  markReminderFailed: vi.fn(() => Promise.resolve()),
}));

global.fetch = vi.fn();

describe("notificationWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOutboundMessages.clear();
    mockOutboxMessages.clear();
    mockMedicationReminders.length = 0;
    mockPreferences.clear();
    mockPreferenceLookup.fails = false;
    mockTableUpdates.length = 0;
    mockSession.current = null;
    vi.stubEnv("VITE_SUPABASE_URL", "https://test.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("queueSMS", () => {
    it("should add a message to the queue", async () => {
      const { queueSMS } = await import("./notificationWorker");

      const msgId = await queueSMS(
        "patient-123",
        "+2348012345678",
        "Test reminder message",
      );

      expect(msgId).toBeDefined();
      expect(mockOutboundMessages.size).toBe(1);

      const msg = mockOutboundMessages.get(msgId);
      expect(msg.patientId).toBe("patient-123");
      expect(msg.to).toBe("+2348012345678");
      expect(msg.payload.message).toBe("Test reminder message");
      expect(msg.status).toBe("queued");
    });

    it("should support scheduled messages", async () => {
      const { queueSMS } = await import("./notificationWorker");
      const futureDate = new Date(Date.now() + 3600000);

      const msgId = await queueSMS(
        "patient-123",
        "+2348012345678",
        "Scheduled reminder",
        futureDate,
      );

      const msg = mockOutboundMessages.get(msgId);
      expect(msg.scheduledFor).toEqual(futureDate);
    });
  });

  describe("getQueueStats", () => {
    it("should return queue statistics structure", async () => {
      const { getQueueStats } = await import("./notificationWorker");
      const stats = await getQueueStats();

      expect(stats).toHaveProperty("pending");
      expect(stats).toHaveProperty("sending");
      expect(stats).toHaveProperty("sent");
      expect(stats).toHaveProperty("failed");
      expect(stats).toHaveProperty("scheduled");
      expect(typeof stats.pending).toBe("number");
      expect(typeof stats.sent).toBe("number");
      expect(typeof stats.failed).toBe("number");
    });
  });

  describe("processNow", () => {
    it("should process pending reminders and messages", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, provider: "demo" }),
      });

      const { processNow } = await import("./notificationWorker");
      const result = await processNow();

      expect(result).toHaveProperty("reminders");
      expect(result).toHaveProperty("messages");
      expect(typeof result.reminders).toBe("number");
      expect(typeof result.messages).toBe("number");
    });
  });

  describe("server reminders", () => {
    const fetchMock = () => globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const reminder = {
      id: "rem-1",
      patient_id: "patient-123",
      phone_number: "+2348012345678",
      message: "Take your medicine",
      status: "pending",
    };

    it("does not try to send when nobody is signed in online", async () => {
      mockMedicationReminders.push(reminder);
      const { processNow } = await import("./notificationWorker");

      const result = await processNow();

      expect(result.skipped).toBe("signed_out");
      expect(fetchMock()).not.toHaveBeenCalled();
      expect(mockTableUpdates).toEqual([]);
    });

    it("does not send under another account's online sign-in left in this browser", async () => {
      mockSession.current = { access_token: "portal-token", user: { id: "portal-patient-1" } };
      mockMedicationReminders.push(reminder);
      const { processNow } = await import("./notificationWorker");

      const result = await processNow();

      expect(result.skipped).toBe("signed_out");
      expect(fetchMock()).not.toHaveBeenCalled();
    });

    it("sends with the staff token and leaves the status to the server", async () => {
      mockSession.current = { access_token: "staff-token", user: { id: STAFF_CLOUD_ID } };
      mockMedicationReminders.push(reminder);
      fetchMock().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ success: true, messageId: "m-1", reminderRecorded: true }),
      });
      const { processNow } = await import("./notificationWorker");

      const result = await processNow();

      expect(result.reminders).toBe(1);
      const [url, init] = fetchMock().mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://test.supabase.co/functions/v1/send-sms-reminder");
      expect(init.headers).toMatchObject({
        Authorization: "Bearer staff-token",
        apikey: "test-key",
      });
      const body = JSON.parse(String(init.body));
      expect(body.reminderId).toBe("rem-1");
      expect(body).not.toHaveProperty("to");
      // medication_reminders is written by the server function, not here.
      expect(mockTableUpdates.filter((u) => u.table === "medication_reminders")).toEqual([]);
    });

    it("does not count a reminder the server already records as sent", async () => {
      mockSession.current = { access_token: "staff-token", user: { id: STAFF_CLOUD_ID } };
      mockMedicationReminders.push(reminder);
      fetchMock().mockResolvedValue({
        ok: false,
        status: 409,
        headers: { get: () => null },
        text: () =>
          Promise.resolve(JSON.stringify({ success: false, error: "already_sent" })),
      });
      const { processNow } = await import("./notificationWorker");

      const result = await processNow();

      expect(result.reminders).toBe(0);
      expect(result.failed).toBe(0);
      expect(mockTableUpdates).toEqual([]);
    });

    it("reports a role the server refuses instead of a failure", async () => {
      mockSession.current = { access_token: "staff-token", user: { id: STAFF_CLOUD_ID } };
      mockMedicationReminders.push(reminder);
      fetchMock().mockResolvedValue({
        ok: false,
        status: 403,
        headers: { get: () => null },
        text: () =>
          Promise.resolve(
            JSON.stringify({
              success: false,
              error: "not_permitted",
              message: "Your role cannot send SMS to patients.",
            }),
          ),
      });
      const { processNow } = await import("./notificationWorker");

      const result = await processNow();

      expect(result.skipped).toBe("not_permitted");
      expect(mockTableUpdates).toEqual([]);
    });

    it("Send now reports whether the server recorded the outcome", async () => {
      mockSession.current = { access_token: "staff-token", user: { id: STAFF_CLOUD_ID } };
      fetchMock().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, reminderRecorded: false }),
      });
      const { sendReminderNow } = await import("./notificationWorker");

      const result = await sendReminderNow({
        id: "rem-1",
        patientId: "patient-123",
        phoneNumber: "+2348012345678",
        message: "Take your medicine",
      });

      expect(result).toMatchObject({ ok: true, recordUpdated: false });
      expect(mockTableUpdates).toEqual([]);
    });

    it("Send now keeps the server's record flag when it refuses the send", async () => {
      mockSession.current = { access_token: "staff-token", user: { id: STAFF_CLOUD_ID } };
      fetchMock().mockResolvedValue({
        ok: false,
        status: 422,
        headers: { get: () => null },
        text: () =>
          Promise.resolve(
            JSON.stringify({
              success: false,
              error: "no_phone",
              message: "The patient has no phone number on the server.",
              reminderRecorded: true,
            }),
          ),
      });
      const { sendReminderNow } = await import("./notificationWorker");

      const result = await sendReminderNow({
        id: "rem-422",
        patientId: "patient-123",
        phoneNumber: "",
        message: "Take your medicine",
      });

      expect(result).toMatchObject({ ok: false, recordUpdated: true });
      expect(result.error).toMatch(/^no_phone/);
    });

    it("does not send again a reminder accepted but not recorded by the server", async () => {
      mockSession.current = { access_token: "staff-token", user: { id: STAFF_CLOUD_ID } };
      fetchMock().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, reminderRecorded: false }),
      });
      const { sendReminderNow, SMS_ACCEPTED_NOT_RECORDED_ERROR } = await import(
        "./notificationWorker"
      );
      const reminderToSend = {
        id: "rem-unrecorded",
        patientId: "patient-123",
        phoneNumber: "",
        message: "Take your medicine",
      };

      await sendReminderNow(reminderToSend);
      const again = await sendReminderNow(reminderToSend);

      expect(again).toMatchObject({ ok: false, error: SMS_ACCEPTED_NOT_RECORDED_ERROR });
      // The patient is not texted a second time.
      expect(fetchMock()).toHaveBeenCalledTimes(1);
      // Its own code: it must not read as "the server records it as sent".
      expect(SMS_ACCEPTED_NOT_RECORDED_ERROR).not.toMatch(/already_sent/);
    });
  });

  describe("reminder opt-out at send time", () => {
    const PAST = new Date(Date.now() - 60_000);
    const fetchMock = () => globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockSession.current = { access_token: "staff-token", user: { id: STAFF_CLOUD_ID } };
      fetchMock().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, messageId: "sms-1", reminderRecorded: true }),
      });
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function queueMessage(overrides: Record<string, any> = {}) {
      const msg = {
        id: "queue-1",
        patientId: "patient-out",
        channel: "sms",
        to: "+2348012345678",
        locale: "en",
        templateKey: "medication_reminder",
        payload: { medicationName: "Amoxicillin", message: "Take Amoxicillin 500 mg now." },
        status: "queued",
        createdAt: PAST,
        scheduledFor: PAST,
        attempts: 0,
        ...overrides,
      };
      mockOutboundMessages.set(msg.id, msg);
      return msg.id;
    }

    it("cancels a queued reminder for a patient who opted out and never calls the sender", async () => {
      // Queued before the patient turned medication reminders off.
      const id = queueMessage();
      mockPreferences.set("patient-out", {
        patientId: "patient-out",
        medicationReminders: 0,
        appointmentReminders: 1,
      });

      const { processNow } = await import("./notificationWorker");
      const result = await processNow();

      expect(fetchMock()).not.toHaveBeenCalled();
      const msg = mockOutboundMessages.get(id);
      expect(msg.status).toBe("cancelled");
      expect(msg.errorMessage).toBe(REMINDER_SKIP_MESSAGE.opted_out);
      expect(msg.attempts).toBe(0);
      expect(result.messages).toBe(0);
      expect(result.failed).toBe(1);
    });

    it("treats an opt-out pulled from the server as false the same way (device outbox)", async () => {
      mockOutboxMessages.set("outbox-1", {
        id: "outbox-1",
        patientId: "patient-out",
        channel: "sms",
        to: "+2348012345678",
        locale: "en",
        templateKey: "followup.medication",
        payload: { patientName: "Ada Obi", medicationName: "Amoxicillin", dosage: "500 mg" },
        status: "queued",
        createdAt: PAST.toISOString(),
        attempts: 0,
      });
      mockPreferences.set("patient-out", { patientId: "patient-out", medicationReminders: false });

      const { processNow } = await import("./notificationWorker");
      await processNow();

      expect(fetchMock()).not.toHaveBeenCalled();
      const msg = mockOutboxMessages.get("outbox-1");
      expect(msg.status).toBe("cancelled");
      expect(msg.errorMessage).toBe(REMINDER_SKIP_MESSAGE.opted_out);
    });

    it("skips a due server reminder without sending it or writing its status", async () => {
      mockMedicationReminders.push({
        id: "rem-opt",
        patient_id: "patient-out",
        message: "Take Amoxicillin 500 mg now.",
        status: "pending",
      });
      mockPreferences.set("patient-out", { patientId: "patient-out", medicationReminders: 0 });

      const { processNow } = await import("./notificationWorker");
      const result = await processNow();

      expect(fetchMock()).not.toHaveBeenCalled();
      // RLS does not let this device write medication_reminders: it stays
      // pending on the server and is checked again next run.
      expect(mockTableUpdates).toEqual([]);
      expect(result.reminders).toBe(0);
      // Counted as not sent, so the run summary does not say "Nothing was due".
      expect(result.failed).toBe(1);
    });

    it("pages past opted-out server reminders to send another patient's due reminder", async () => {
      // More opted-out rows than one request returns, all due before the
      // other patient's reminder. None is ever written, so they stay first.
      const base = Date.now() - 24 * 60 * 60_000;
      for (let i = 0; i < 60; i++) {
        mockMedicationReminders.push({
          id: `rem-out-${String(i).padStart(2, "0")}`,
          patient_id: "patient-out",
          message: "Take Amoxicillin 500 mg now.",
          status: "pending",
          scheduled_at: new Date(base + i * 60_000).toISOString(),
        });
      }
      mockMedicationReminders.push({
        id: "rem-in",
        patient_id: "patient-in",
        message: "Take Metformin 500 mg now.",
        status: "pending",
        scheduled_at: new Date(base + 120 * 60_000).toISOString(),
      });
      mockPreferences.set("patient-out", { patientId: "patient-out", medicationReminders: 0 });
      mockPreferences.set("patient-in", { patientId: "patient-in", medicationReminders: 1 });

      const { processNow } = await import("./notificationWorker");
      const result = await processNow();

      expect(fetchMock()).toHaveBeenCalledTimes(1);
      const [, init] = fetchMock().mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(String(init.body)).reminderId).toBe("rem-in");
      expect(result.reminders).toBe(1);
      expect(result.failed).toBe(60);
      expect(mockTableUpdates.filter((u) => u.table === "medication_reminders")).toEqual([]);
    });

    it("does not send now for a patient who opted out, and writes nothing", async () => {
      mockPreferences.set("patient-out", { patientId: "patient-out", medicationReminders: false });

      const { sendReminderNow } = await import("./notificationWorker");
      const result = await sendReminderNow({
        id: "rem-2",
        patientId: "patient-out",
        phoneNumber: "+2348012345678",
        message: "Take Amoxicillin 500 mg now.",
      });

      expect(fetchMock()).not.toHaveBeenCalled();
      expect(result.ok).toBe(false);
      expect(result.error).toBe(REMINDER_SKIP_MESSAGE.opted_out);
      expect(mockTableUpdates).toEqual([]);
    });

    it("still sends a reminder the patient kept on, including true pulled from the server", async () => {
      const id = queueMessage({ patientId: "patient-in" });
      mockPreferences.set("patient-in", { patientId: "patient-in", medicationReminders: true });

      const { processNow } = await import("./notificationWorker");
      const result = await processNow();

      expect(fetchMock()).toHaveBeenCalledTimes(1);
      expect(mockOutboundMessages.get(id).status).toBe("sent");
      expect(result.messages).toBe(1);
    });

    it("never holds back a one-time code, even for a patient who opted out", async () => {
      const id = queueMessage({
        templateKey: "otp",
        payload: { message: "Your mBHR verification code is 123456." },
      });
      mockPreferences.set("patient-out", {
        patientId: "patient-out",
        medicationReminders: 0,
        appointmentReminders: 0,
      });

      const { processNow } = await import("./notificationWorker");
      await processNow();

      expect(fetchMock()).toHaveBeenCalledTimes(1);
      expect(mockOutboundMessages.get(id).status).toBe("sent");
    });

    it("holds reminders, unsent, when the setting cannot be read", async () => {
      const id = queueMessage();
      mockMedicationReminders.push({
        id: "rem-held",
        patient_id: "patient-out",
        message: "Take Amoxicillin 500 mg now.",
        status: "pending",
      });
      mockPreferenceLookup.fails = true;

      const { processNow, sendReminderNow, PREFERENCE_CHECK_ERROR } = await import(
        "./notificationWorker"
      );
      await processNow();

      expect(fetchMock()).not.toHaveBeenCalled();
      const msg = mockOutboundMessages.get(id);
      expect(msg.status).toBe("queued");
      expect(msg.attempts).toBe(0);
      expect(msg.errorMessage).toBe(PREFERENCE_CHECK_ERROR);
      expect(mockTableUpdates).toEqual([]);

      const now = await sendReminderNow({
        id: "rem-held",
        patientId: "patient-out",
        phoneNumber: "",
        message: "Take Amoxicillin 500 mg now.",
      });
      expect(now).toMatchObject({ ok: false, error: PREFERENCE_CHECK_ERROR });
      expect(fetchMock()).not.toHaveBeenCalled();
    });
  });

  describe("startNotificationWorker/stopNotificationWorker", () => {
    it("should start and stop the worker", async () => {
      const { startNotificationWorker, stopNotificationWorker } =
        await import("./notificationWorker");

      startNotificationWorker(60000);
      stopNotificationWorker();
    });

    it("should not start multiple workers", async () => {
      const { startNotificationWorker, stopNotificationWorker } =
        await import("./notificationWorker");

      startNotificationWorker(60000);
      startNotificationWorker(60000);
      stopNotificationWorker();
    });
  });
});

describe("SMS delivery logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("VITE_SUPABASE_URL", "https://test.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("should handle successful SMS delivery", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          messageId: "sms-123",
          provider: "twilio",
        }),
    });

    const response = await fetch(
      "https://test.supabase.co/functions/v1/send-sms-reminder",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: "+2348012345678", message: "Test" }),
      },
    );

    const result = await response.json();
    expect(result.success).toBe(true);
    expect(result.provider).toBe("twilio");
  });

  it("should handle failed SMS delivery", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      json: () =>
        Promise.resolve({
          success: false,
          error: "Invalid phone number",
        }),
    });

    const response = await fetch(
      "https://test.supabase.co/functions/v1/send-sms-reminder",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: "invalid", message: "Test" }),
      },
    );

    expect(response.ok).toBe(false);
  });

  it("should handle demo mode when no provider configured", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          demo: true,
          provider: "demo",
        }),
    });

    const response = await fetch(
      "https://test.supabase.co/functions/v1/send-sms-reminder",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: "+2348012345678", message: "Test" }),
      },
    );

    const result = await response.json();
    expect(result.success).toBe(true);
    expect(result.demo).toBe(true);
  });
});
