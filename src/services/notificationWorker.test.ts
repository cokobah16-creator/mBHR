import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockOutboundMessages: Map<string, any> = new Map();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockMedicationReminders: any[] = [];

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

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(() =>
        Promise.resolve({ data: { session: mockSession.current }, error: null }),
      ),
    },
    from: vi.fn((table: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          lte: vi.fn(() => ({
            limit: vi.fn(() =>
              Promise.resolve({ data: mockMedicationReminders, error: null }),
            ),
          })),
        })),
      })),
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
    mockMedicationReminders.length = 0;
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
