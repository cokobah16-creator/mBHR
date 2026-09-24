import { describe, it, expect } from "vitest";
import { PRIVACY_VERSION, TERMS_VERSION, formatPolicyDate } from "./policyMeta";

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
});
