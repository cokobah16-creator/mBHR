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

import { selectGateway, TermiiGateway, MockGateway } from "./messaging";
import * as logger from "@/lib/logger";

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
