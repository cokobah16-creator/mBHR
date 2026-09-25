import { describe, it, expect } from "vitest";
import { isAllergyActive, toAllergyActiveFlag } from "./allergyActive";

describe("isAllergyActive", () => {
  it("treats locally written 1 and synced true as active", () => {
    expect(isAllergyActive({ isActive: 1 })).toBe(true);
    expect(isAllergyActive({ isActive: true })).toBe(true);
  });

  it("treats 0 and false as inactive", () => {
    expect(isAllergyActive({ isActive: 0 })).toBe(false);
    expect(isAllergyActive({ isActive: false })).toBe(false);
  });
});

describe("toAllergyActiveFlag", () => {
  it("converts the server boolean to the local 0/1 flag", () => {
    expect(toAllergyActiveFlag(true)).toBe(1);
    expect(toAllergyActiveFlag(false)).toBe(0);
    expect(toAllergyActiveFlag(1)).toBe(1);
    expect(toAllergyActiveFlag(0)).toBe(0);
  });

  it("defaults a missing value to active, like the server column", () => {
    expect(toAllergyActiveFlag(undefined)).toBe(1);
    expect(toAllergyActiveFlag(null)).toBe(1);
  });
});
