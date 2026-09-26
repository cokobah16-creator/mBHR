import { describe, it, expect } from "vitest";
import { inviteLifetimeSeconds, launchedAt, preflightRefusal } from "./settings";

// Source text of this module, so the test can check it stays pure.
const SOURCE = import.meta.glob("./settings.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("preflightRefusal", () => {
  it("refuses with 503 not_configured while ALLOWED_ORIGINS is unset", () => {
    expect(preflightRefusal(null)).toMatchObject({ status: 503, error: "not_configured" });
  });

  it("lets the request through once origins are set", () => {
    expect(preflightRefusal(["https://staff.example.org"])).toBeNull();
    expect(preflightRefusal([])).toBeNull();
  });
});

describe("inviteLifetimeSeconds", () => {
  it("accepts whole seconds from 300 to 86400", () => {
    expect(inviteLifetimeSeconds("300")).toBe(300);
    expect(inviteLifetimeSeconds("86400")).toBe(86400);
    expect(inviteLifetimeSeconds(" 7200 ")).toBe(7200);
  });

  it("uses 3600 for anything else", () => {
    for (const raw of ["299", "86401", "3600.5", "abc", "", "   ", "-600", undefined, null]) {
      expect(inviteLifetimeSeconds(raw)).toBe(3600);
    }
  });
});

describe("launchedAt", () => {
  it("reads an ISO date", () => {
    expect(launchedAt("2026-09-01T00:00:00.000Z")?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(launchedAt(" 2026-09-01T00:00:00Z ")?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("is null when unset or not a date", () => {
    for (const raw of [undefined, null, "", "   ", "not a date"]) {
      expect(launchedAt(raw)).toBeNull();
    }
  });
});

describe("settings module", () => {
  it("uses no Deno APIs and never logs", () => {
    const text = SOURCE["./settings.ts"];
    expect(text).toBeTruthy();
    expect(text).not.toMatch(/Deno\./);
    expect(text).not.toMatch(/console\./);
    expect(text).not.toMatch(/from\s+["']npm:/);
  });
});
