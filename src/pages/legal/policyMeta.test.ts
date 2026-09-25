import { describe, it, expect } from "vitest";
import {
  MINOR_RECORD_LINK_MESSAGE,
  PRIVACY_VERSION,
  TERMS_VERSION,
  UNDER_18_SIGN_UP_MESSAGE,
  currentPolicyAcceptance,
  formatPolicyDate,
  isCompleteAcceptance,
} from "./policyMeta";

describe("policyMeta", () => {
  it("keeps both versions as ISO dates", () => {
    expect(TERMS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(PRIVACY_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("formats a version the way the pages show it", () => {
    expect(formatPolicyDate("2026-09-22")).toBe("22 September 2026");
    expect(formatPolicyDate("2027-01-05")).toBe("5 January 2027");
  });

  it("returns anything that is not a valid date unchanged", () => {
    expect(formatPolicyDate("22 September 2026")).toBe("22 September 2026");
    expect(formatPolicyDate("2026-13-01")).toBe("2026-13-01");
    expect(formatPolicyDate("2026-09-00")).toBe("2026-09-00");
  });

  it("records the current versions and the time of acceptance", () => {
    const acceptance = currentPolicyAcceptance(
      new Date("2026-09-24T10:00:00.000Z"),
    );
    expect(acceptance).toEqual({
      termsVersion: TERMS_VERSION,
      privacyVersion: PRIVACY_VERSION,
      acceptedAt: "2026-09-24T10:00:00.000Z",
    });
    expect(isCompleteAcceptance(acceptance)).toBe(true);
  });

  it("sends parents of a child to clinic staff, not to People you care for", () => {
    // People you care for makes a blank profile; it cannot reach a child's
    // clinic record.
    for (const message of [UNDER_18_SIGN_UP_MESSAGE, MINOR_RECORD_LINK_MESSAGE]) {
      expect(message).toMatch(/clinic staff/i);
      expect(message).not.toMatch(/people you care for/i);
    }
  });

  it("treats a missing or partly empty acceptance as not given", () => {
    const acceptance = currentPolicyAcceptance();
    expect(isCompleteAcceptance(undefined)).toBe(false);
    expect(isCompleteAcceptance(null)).toBe(false);
    expect(isCompleteAcceptance({ ...acceptance, termsVersion: "" })).toBe(false);
    expect(isCompleteAcceptance({ ...acceptance, privacyVersion: "" })).toBe(false);
    expect(isCompleteAcceptance({ ...acceptance, acceptedAt: "" })).toBe(false);
  });
});
