import { describe, it, expect } from "vitest";
import {
  choiceLabel,
  DEFAULT_SHARING_FLAGS,
  diffSharing,
  purposeLabel,
  SHARING_OPTIONS,
  type SharingFlags,
} from "./sharingChanges";

const base: SharingFlags = {
  allow_ias_access: true,
  allow_treatment_access: true,
  allow_payment_access: false,
  allow_operations_access: false,
  require_notification: true,
};

describe("diffSharing", () => {
  it("returns nothing when no choice changed", () => {
    expect(diffSharing(base, { ...base })).toEqual([]);
  });

  it("lists each changed choice with before and after", () => {
    const changes = diffSharing(base, {
      ...base,
      allow_treatment_access: false,
      require_notification: false,
    });
    expect(changes.map((c) => c.key)).toEqual([
      "allow_treatment_access",
      "require_notification",
    ]);
    expect(changes[0]).toMatchObject({ from: true, to: false });
  });
});

describe("choiceLabel", () => {
  it("says Allowed / Not allowed for sharing and On / Off for notices", () => {
    expect(choiceLabel("allow_payment_access", true)).toBe("Allowed");
    expect(choiceLabel("allow_payment_access", false)).toBe("Not allowed");
    expect(choiceLabel("require_notification", true)).toBe("On");
  });
});

describe("SHARING_OPTIONS", () => {
  it("covers the four stored sharing flags once each", () => {
    expect(SHARING_OPTIONS.map((o) => o.key).sort()).toEqual([
      "allow_ias_access",
      "allow_operations_access",
      "allow_payment_access",
      "allow_treatment_access",
    ]);
  });
});

describe("DEFAULT_SHARING_FLAGS", () => {
  it("starts with treatment, payment and quality-check sharing off", () => {
    // The privacy notice lists these values. Change it with them.
    expect(DEFAULT_SHARING_FLAGS).toEqual({
      allow_ias_access: true,
      allow_treatment_access: false,
      allow_payment_access: false,
      allow_operations_access: false,
      require_notification: true,
    });
  });
});

describe("purposeLabel", () => {
  it("maps known purposes and passes unknown ones through", () => {
    expect(purposeLabel("treatment")).toBe("Treatment");
    expect(purposeLabel("public-health")).toBe("public-health");
  });
});
