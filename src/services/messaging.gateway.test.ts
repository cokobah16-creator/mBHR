import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/db/outbox", () => ({
  MessageQueue: {
    queueMessage: vi.fn(),
    getPendingMessages: vi.fn().mockResolvedValue([]),
    markSent: vi.fn(),
    markFailed: vi.fn(),
    getStats: vi.fn(),
    renderTemplate: vi.fn(),
  },
}));
vi.mock("@/db", () => ({ db: { patients: { get: vi.fn() } } }));
vi.mock("./preferences", () => ({ getPatientPreference: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

import * as messaging from "./messaging";
import {
  selectGateway,
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

describe("selectGateway (no SMS provider in the browser)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("always returns the non-sending MockGateway", () => {
    const gateway = selectGateway();
    expect(gateway).toBeInstanceOf(MockGateway);
    expect(gateway.configured).toBe(false);
  });

  it("no longer exports a browser Termii gateway", () => {
    expect("TermiiGateway" in messaging).toBe(false);
    expect(Object.keys(messaging).join(",")).not.toMatch(/termii/i);
  });

  it("never calls an SMS provider from the browser", async () => {
    const gateway = selectGateway();
    const result = await gateway.send(outboxMessage());

    expect(result.success).toBe(false);
    expect(result.error).toBe(SMS_PROVIDER_NOT_CONFIGURED_ERROR);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("says SMS goes through the server function", () => {
    selectGateway();
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("send-sms-reminder"),
    );
  });

  it("getMessageService leaves queued messages for the notification worker", async () => {
    const result = await messaging.getMessageService().processOutbox();
    expect(result).toEqual({ sent: 0, failed: 0, skipped: "not_configured" });
    expect(MessageQueue.markSent).not.toHaveBeenCalled();
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
