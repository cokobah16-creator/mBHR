import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db/outbox", () => ({
  MessageQueue: {
    queueMessage: vi.fn(),
    getPendingMessages: vi.fn().mockResolvedValue([]),
    markSent: vi.fn(),
    markFailed: vi.fn(),
    getStats: vi.fn(),
    renderTemplate: vi.fn(),
  },
  outboxDb: { messageTemplates: { where: vi.fn() } },
}));
vi.mock("@/db", () => ({ db: { patients: { get: vi.fn() } } }));
vi.mock("./preferences", () => ({ getPatientPreference: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

import {
  selectGateway,
  TermiiGateway,
  MockGateway,
  MessageService,
  ReminderSkippedError,
  SMS_PROVIDER_NOT_CONFIGURED_ERROR,
  type SMSGateway,
} from "./messaging";
import * as logger from "@/lib/logger";
import { MessageQueue, type OutboundMessage } from "@/db/outbox";
import { db } from "@/db";
import { getPatientPreference } from "./preferences";

type MockFn = ReturnType<typeof vi.fn>;
const asMock = (fn: unknown) => fn as MockFn;

function outboxMessage(overrides: Partial<OutboundMessage> = {}): OutboundMessage {
  return {
    id: "msg-1",
    patientId: "p1",
    channel: "sms",
    to: "+2348031234567",
    locale: "en",
    templateKey: "followup.medication",
    payload: { patientName: "Ada Obi", medicationName: "Amoxicillin" },
    status: "queued",
    createdAt: "2026-09-23T08:00:00.000Z",
    attempts: 0,
    ...overrides,
  };
}

describe("selectGateway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns MockGateway when no key provided", () => {
    const gateway = selectGateway();
    expect(gateway).toBeInstanceOf(MockGateway);
  });

  it("returns MockGateway when key is empty string", () => {
    const gateway = selectGateway("");
    expect(gateway).toBeInstanceOf(MockGateway);
  });

  it("returns TermiiGateway when a key is provided", () => {
    const gateway = selectGateway("termii-abc-123");
    expect(gateway).toBeInstanceOf(TermiiGateway);
  });

  it("passes sender id through to TermiiGateway", () => {
    const gateway = selectGateway("termii-key", "MBHR_CLINIC") as TermiiGateway;
    // Access private field via type cast to verify it was stored
    expect((gateway as unknown as Record<string, unknown>).senderId).toBe(
      "MBHR_CLINIC",
    );
  });

  it("uses default sender id when none supplied", () => {
    const gateway = selectGateway("termii-key") as TermiiGateway;
    expect((gateway as unknown as Record<string, unknown>).senderId).toBe(
      "MBHR",
    );
  });

  it("logs a warning when falling back to MockGateway", () => {
    selectGateway();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("VITE_TERMII_API_KEY not set"),
    );
  });

  it("does NOT log a warning when TermiiGateway is selected", () => {
    selectGateway("real-key");
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe("MockGateway (no SMS provider set up)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("never reports success, so nothing can be marked sent", async () => {
    const gateway = new MockGateway();
    for (let i = 0; i < 50; i++) {
      const result = await gateway.send(outboxMessage());
      expect(result.success).toBe(false);
      expect(result.error).toBe(SMS_PROVIDER_NOT_CONFIGURED_ERROR);
      expect(result.messageId).toBeUndefined();
    }
  });

  it("says it is not configured", () => {
    expect(new MockGateway().configured).toBe(false);
  });

  it("does not log the phone number or message payload", async () => {
    await new MockGateway().send(outboxMessage());
    const logged = JSON.stringify(asMock(logger.info).mock.calls);
    expect(logged).not.toContain("2348031234567");
    expect(logged).not.toContain("Ada Obi");
    expect(logged).not.toContain("Amoxicillin");
  });
});

describe("MessageService.processOutbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("leaves messages queued when no provider is set up", async () => {
    const service = new MessageService(new MockGateway());

    const result = await service.processOutbox();

    expect(result).toEqual({ sent: 0, failed: 0, skipped: "not_configured" });
    expect(MessageQueue.getPendingMessages).not.toHaveBeenCalled();
    expect(MessageQueue.markSent).not.toHaveBeenCalled();
    expect(MessageQueue.markFailed).not.toHaveBeenCalled();
  });

  it("marks a message sent only when the gateway accepted it", async () => {
    asMock(MessageQueue.getPendingMessages).mockResolvedValueOnce([
      outboxMessage({ id: "ok" }),
      outboxMessage({ id: "rejected" }),
    ]);
    const gateway: SMSGateway = {
      send: vi
        .fn()
        .mockResolvedValueOnce({ success: true, messageId: "provider-1" })
        .mockResolvedValueOnce({ success: false, error: "Insufficient balance" }),
    };

    const result = await new MessageService(gateway).processOutbox();

    expect(result).toEqual({ sent: 1, failed: 1 });
    expect(MessageQueue.markSent).toHaveBeenCalledTimes(1);
    expect(MessageQueue.markSent).toHaveBeenCalledWith("ok");
    expect(MessageQueue.markFailed).toHaveBeenCalledWith(
      "rejected",
      "Insufficient balance",
    );
  });
});

describe("MessageService.queueMedicationReminder", () => {
  const patient = {
    id: "p1",
    givenName: "Ada",
    familyName: "Obi",
    phone: "08031234567",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    asMock(db.patients.get).mockResolvedValue(patient);
    asMock(MessageQueue.queueMessage).mockResolvedValue("msg-1");
  });

  it("does not queue a reminder for a patient who opted out", async () => {
    asMock(getPatientPreference).mockResolvedValue({ medicationReminders: 0 });
    const service = new MessageService(new MockGateway());

    await expect(
      service.queueMedicationReminder("p1", "Amoxicillin", "500 mg", "8-hourly"),
    ).rejects.toBeInstanceOf(ReminderSkippedError);
    expect(MessageQueue.queueMessage).not.toHaveBeenCalled();
  });

  it("does not queue a reminder when there is no phone number", async () => {
    asMock(db.patients.get).mockResolvedValue({ ...patient, phone: "" });
    asMock(getPatientPreference).mockResolvedValue(undefined);
    const service = new MessageService(new MockGateway());

    await expect(
      service.queueMedicationReminder("p1", "Amoxicillin", "500 mg", "8-hourly"),
    ).rejects.toMatchObject({ reason: "no_phone" });
    expect(MessageQueue.queueMessage).not.toHaveBeenCalled();
  });

  it("queues a reminder when the patient has not opted out", async () => {
    asMock(getPatientPreference).mockResolvedValue({ medicationReminders: 1 });
    const service = new MessageService(new MockGateway());

    const id = await service.queueMedicationReminder(
      "p1",
      "Amoxicillin",
      "500 mg",
      "8-hourly",
    );

    expect(id).toBe("msg-1");
    expect(MessageQueue.queueMessage).toHaveBeenCalledWith(
      "p1",
      "08031234567",
      "followup.medication",
      expect.objectContaining({ medicationName: "Amoxicillin" }),
      expect.objectContaining({ channel: "sms" }),
    );
  });
});
