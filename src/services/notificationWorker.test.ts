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
// Updates written to medication_reminders on the server.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockReminderUpdates: { changes: any; id: unknown }[] = [];

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

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      // A staff member signed in online, so the worker would really send.
      getSession: vi.fn(() =>
        Promise.resolve({ data: { session: { access_token: "staff-token" } } }),
      ),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          lte: vi.fn(() => ({
            limit: vi.fn(() =>
              Promise.resolve({ data: mockMedicationReminders, error: null }),
            ),
          })),
        })),
      })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: vi.fn((changes: any) => ({
        eq: vi.fn((_column: string, id: unknown) => {
          mockReminderUpdates.push({ changes, id });
          return Promise.resolve({ error: null });
        }),
      })),
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
    mockReminderUpdates.length = 0;
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

  describe("reminder opt-out at send time", () => {
    const PAST = new Date(Date.now() - 60_000);

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

    function providerAccepts() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, messageId: "sms-1", provider: "termii" }),
      });
    }

    it("cancels a queued reminder for a patient who opted out and never calls the sender", async () => {
      providerAccepts();
      // Queued before the patient turned medication reminders off.
      const id = queueMessage();
      mockPreferences.set("patient-out", { patientId: "patient-out", medicationReminders: 0, appointmentReminders: 1 });

      const { processNow } = await import("./notificationWorker");
      const result = await processNow();

      expect(global.fetch).not.toHaveBeenCalled();
      const msg = mockOutboundMessages.get(id);
      expect(msg.status).toBe("cancelled");
      expect(msg.errorMessage).toBe(REMINDER_SKIP_MESSAGE.opted_out);
      expect(msg.attempts).toBe(0);
      expect(result.messages).toBe(0);
      expect(result.failed).toBe(1);
    });

    it("treats an opt-out pulled from the server as false the same way", async () => {
      providerAccepts();
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

      expect(global.fetch).not.toHaveBeenCalled();
      const msg = mockOutboxMessages.get("outbox-1");
      expect(msg.status).toBe("cancelled");
      expect(msg.errorMessage).toBe(REMINDER_SKIP_MESSAGE.opted_out);
    });

    it("marks a due server reminder failed with the opt-out reason instead of sending it", async () => {
      providerAccepts();
      mockMedicationReminders.push({
        id: "rem-1",
        patient_id: "patient-out",
        message: "Take Amoxicillin 500 mg now.",
        status: "pending",
      });
      mockPreferences.set("patient-out", { patientId: "patient-out", medicationReminders: 0 });

      const { processNow } = await import("./notificationWorker");
      const result = await processNow();

      expect(global.fetch).not.toHaveBeenCalled();
      expect(mockReminderUpdates).toEqual([
        {
          changes: { status: "failed", error_message: REMINDER_SKIP_MESSAGE.opted_out },
          id: "rem-1",
        },
      ]);
      expect(result.reminders).toBe(0);
    });

    it("does not send now for a patient who opted out", async () => {
      providerAccepts();
      mockPreferences.set("patient-out", { patientId: "patient-out", medicationReminders: false });
      const { markReminderFailed } = await import("@/services/sms");

      const { sendReminderNow } = await import("./notificationWorker");
      const result = await sendReminderNow({
        id: "rem-2",
        patientId: "patient-out",
        phoneNumber: "+2348012345678",
        message: "Take Amoxicillin 500 mg now.",
      });

      expect(global.fetch).not.toHaveBeenCalled();
      expect(result.ok).toBe(false);
      expect(result.error).toBe(REMINDER_SKIP_MESSAGE.opted_out);
      expect(markReminderFailed).toHaveBeenCalledWith("rem-2", REMINDER_SKIP_MESSAGE.opted_out);
    });

    it("still sends a reminder the patient kept on, including true pulled from the server", async () => {
      providerAccepts();
      const id = queueMessage({ patientId: "patient-in" });
      mockPreferences.set("patient-in", { patientId: "patient-in", medicationReminders: true });

      const { processNow } = await import("./notificationWorker");
      const result = await processNow();

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(mockOutboundMessages.get(id).status).toBe("sent");
      expect(result.messages).toBe(1);
    });

    it("never holds back a one-time code, even for a patient who opted out", async () => {
      providerAccepts();
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

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(mockOutboundMessages.get(id).status).toBe("sent");
    });

    it("keeps a reminder queued, unsent, when the setting cannot be read", async () => {
      providerAccepts();
      const id = queueMessage();
      mockPreferenceLookup.fails = true;

      const { processNow, PREFERENCE_CHECK_ERROR } = await import("./notificationWorker");
      await processNow();

      expect(global.fetch).not.toHaveBeenCalled();
      const msg = mockOutboundMessages.get(id);
      expect(msg.status).toBe("queued");
      expect(msg.attempts).toBe(0);
      expect(msg.errorMessage).toBe(PREFERENCE_CHECK_ERROR);
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
