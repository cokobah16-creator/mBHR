import { describe, it, expect } from "vitest";
import { STAFF_IDLE_LOCK_MS, isIdleExpired } from "./idle";

describe("isIdleExpired", () => {
  const now = Date.UTC(2026, 8, 25, 10, 0, 0);

  it("locks after ten minutes without activity, not before", () => {
    expect(STAFF_IDLE_LOCK_MS).toBe(10 * 60 * 1000);
    expect(isIdleExpired(now - STAFF_IDLE_LOCK_MS + 1000, now)).toBe(false);
    expect(isIdleExpired(now - STAFF_IDLE_LOCK_MS, now)).toBe(true);
  });

  it("counts no recorded activity, or a time far in the future, as idle", () => {
    expect(isIdleExpired(null, now)).toBe(true);
    expect(isIdleExpired(undefined, now)).toBe(true);
    expect(isIdleExpired(Number.NaN, now)).toBe(true);
    expect(isIdleExpired(now + 2 * STAFF_IDLE_LOCK_MS, now)).toBe(true);
    // A small clock difference is not idle.
    expect(isIdleExpired(now + 1000, now)).toBe(false);
  });
});
