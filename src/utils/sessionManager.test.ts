import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SESSION_CONFIGS, formatTimeRemaining } from "./sessionManager";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(),
          })),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(),
      })),
    })),
  },
}));

vi.mock("@/lib/logger", () => ({
  info: vi.fn(),
  error: vi.fn(),
}));

describe("sessionManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("SESSION_CONFIGS", () => {
    describe("staff config", () => {
      it("should have 12 hour duration", () => {
        expect(SESSION_CONFIGS.staff.duration).toBe(12);
      });

      it("should have 30 minute idle timeout", () => {
        expect(SESSION_CONFIGS.staff.idleTimeout).toBe(30);
      });

      it("should have 5 minute warning threshold", () => {
        expect(SESSION_CONFIGS.staff.warningBeforeExpiry).toBe(5);
      });

      it("should have 24 hour maximum duration", () => {
        expect(SESSION_CONFIGS.staff.maxDuration).toBe(24);
      });
    });

    describe("patient config", () => {
      it("should have 4 hour duration", () => {
        expect(SESSION_CONFIGS.patient.duration).toBe(4);
      });

      it("should have 30 minute idle timeout", () => {
        expect(SESSION_CONFIGS.patient.idleTimeout).toBe(30);
      });

      it("should have 5 minute warning threshold", () => {
        expect(SESSION_CONFIGS.patient.warningBeforeExpiry).toBe(5);
      });

      it("should have 8 hour maximum duration", () => {
        expect(SESSION_CONFIGS.patient.maxDuration).toBe(8);
      });
    });
  });

  describe("formatTimeRemaining", () => {
    describe("seconds formatting", () => {
      it("should format 1 second correctly", () => {
        expect(formatTimeRemaining(1)).toBe("1 second");
      });

      it("should format multiple seconds correctly", () => {
        expect(formatTimeRemaining(45)).toBe("45 seconds");
      });

      it("should format 59 seconds", () => {
        expect(formatTimeRemaining(59)).toBe("59 seconds");
      });
    });

    describe("minutes formatting", () => {
      it("should format 1 minute correctly", () => {
        expect(formatTimeRemaining(60)).toBe("1 minute");
      });

      it("should format multiple minutes correctly", () => {
        expect(formatTimeRemaining(300)).toBe("5 minutes");
      });

      it("should format 59 minutes", () => {
        expect(formatTimeRemaining(59 * 60)).toBe("59 minutes");
      });
    });

    describe("hours formatting", () => {
      it("should format 1 hour correctly", () => {
        expect(formatTimeRemaining(3600)).toBe("1 hour");
      });

      it("should format multiple hours correctly", () => {
        expect(formatTimeRemaining(7200)).toBe("2 hours");
      });

      it("should format hours with minutes", () => {
        expect(formatTimeRemaining(3660)).toBe("1 hour 1 minute");
      });

      it("should format hours with multiple minutes", () => {
        expect(formatTimeRemaining(3900)).toBe("1 hour 5 minutes");
      });

      it("should format multiple hours with minutes", () => {
        expect(formatTimeRemaining(9000)).toBe("2 hours 30 minutes");
      });
    });

    describe("edge cases", () => {
      it("should handle 0 seconds", () => {
        expect(formatTimeRemaining(0)).toBe("0 seconds");
      });

      it("should handle exactly 60 seconds as 1 minute", () => {
        expect(formatTimeRemaining(60)).toBe("1 minute");
      });

      it("should handle exactly 3600 seconds as 1 hour", () => {
        expect(formatTimeRemaining(3600)).toBe("1 hour");
      });
    });
  });
});
