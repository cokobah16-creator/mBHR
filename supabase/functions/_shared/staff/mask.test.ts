import { describe, it, expect } from "vitest";
import { maskEmail, maskEmailOrNull } from "./mask";

const DOTS = "•••";

describe("maskEmail", () => {
  it("keeps the first letters and the last domain label only", () => {
    expect(maskEmail("amaka.obi@gmail.com")).toBe(`a${DOTS}@g${DOTS}.com`);
    expect(maskEmail("ada@mail.example.co.uk")).toBe(`a${DOTS}@m${DOTS}.uk`);
  });

  it("hides the length of the address", () => {
    expect(maskEmail("a@b.org")).toBe(`a${DOTS}@b${DOTS}.org`);
    expect(maskEmail("abcdefghijklmnop@bcdefghijklmnop.org")).toBe(`a${DOTS}@b${DOTS}.org`);
  });

  it("trims spaces and handles a domain with no dot", () => {
    expect(maskEmail("  ada@example.org ")).toBe(`a${DOTS}@e${DOTS}.org`);
    expect(maskEmail("ada@localhost")).toBe(`a${DOTS}@l${DOTS}`);
  });

  it("never shows anything of a value that is not an address", () => {
    for (const value of ["", "no-at-sign", "@example.org", "ada@"]) {
      expect(maskEmail(value)).toBe(DOTS);
    }
  });
});

describe("maskEmailOrNull", () => {
  it("masks an address and passes a missing one through as null", () => {
    expect(maskEmailOrNull("amaka.obi@gmail.com")).toBe(`a${DOTS}@g${DOTS}.com`);
    expect(maskEmailOrNull(null)).toBeNull();
    expect(maskEmailOrNull(undefined)).toBeNull();
    expect(maskEmailOrNull("")).toBeNull();
  });
});
