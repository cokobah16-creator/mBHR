import { describe, it, expect, vi } from "vitest";
import { isSeededDemoUser } from "./0003-retire-demo-users";

// The module reaches for the real Dexie instance at import time; nothing in
// these cases touches it, but jsdom has no indexedDB to construct it against.
vi.mock("../index", () => ({ db: { users: {} } }));
vi.mock("@/lib/logger", () => ({ log: vi.fn(), warn: vi.fn() }));

describe("isSeededDemoUser", () => {
  it.each([
    ["Admin User", "admin@local"],
    ["Dr. Sarah Johnson", "doctor@local"],
    ["Nurse Mary", "nurse@local"],
    ["Pharmacist John", "pharmacist@local"],
    ["Volunteer Mike", "volunteer@local"],
    ["Kristopher Okobah", "admin@local"],
  ])("matches the seeded account %s <%s>", (fullName, email) => {
    expect(isSeededDemoUser({ fullName, email })).toBe(true);
  });

  it("does not match a real member of staff who shares a demo name", () => {
    // The name alone is not enough: seed.ts always paired it with the
    // "<role>@local" address, and a genuine account will not have one.
    expect(
      isSeededDemoUser({ fullName: "Nurse Mary", email: "mary@clinic.ng" }),
    ).toBe(false);
    expect(isSeededDemoUser({ fullName: "Nurse Mary" })).toBe(false);
  });

  it("does not match on the shared demo address alone", () => {
    expect(
      isSeededDemoUser({ fullName: "Amina Bello", email: "admin@local" }),
    ).toBe(false);
  });

  it("does not match an account created through first-run setup", () => {
    // createFirstAdmin() leaves email undefined.
    expect(isSeededDemoUser({ fullName: "Amina Bello" })).toBe(false);
  });
});
