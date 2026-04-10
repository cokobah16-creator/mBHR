import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockOutboundMessages: Map<string, any> = new Map();
const mockMedicationReminders: any[] = [];

vi.mock("@/db", () => ({
  db: {
    outboundMessages: {
      where: vi.fn((field: string) => ({
        equals: vi.fn((value: string) => ({
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
      add: vi.fn((msg: any) => {
        mockOutboundMessages.set(msg.id, msg);
        return Promise.resolve(msg.id);
      }),
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

vi.mock("@/lib/supabase", () => ({
  supabase: {
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
      update: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ error: null })),
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
    mockMedicationReminders.length = 0;
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
