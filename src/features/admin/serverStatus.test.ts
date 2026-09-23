import { describe, it, expect } from "vitest";
import { describeServerStatus } from "./serverStatus";

describe("describeServerStatus", () => {
  it("is unavailable when no server is configured, even online", () => {
    const s = describeServerStatus(false, true);
    expect(s.state).toBe("not-configured");
    expect(s.available).toBe(false);
  });

  it("reports not-configured before offline", () => {
    expect(describeServerStatus(false, false).state).toBe("not-configured");
  });

  it("is unavailable when offline", () => {
    const s = describeServerStatus(true, false);
    expect(s.state).toBe("offline");
    expect(s.available).toBe(false);
    expect(s.label).toBe("Offline");
  });

  it("is available only when configured and online", () => {
    const s = describeServerStatus(true, true);
    expect(s.state).toBe("available");
    expect(s.available).toBe(true);
    // navigator.onLine cannot prove the server answers: never claim it does
    expect(s.label).toBe("Online");
    expect(s.label.toLowerCase()).not.toContain("reachable");
  });

  it("always explains the state in words", () => {
    for (const [c, o] of [
      [false, false],
      [false, true],
      [true, false],
      [true, true],
    ] as const) {
      const s = describeServerStatus(c, o);
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.detail.length).toBeGreaterThan(0);
    }
  });
});
