import { describe, it, expect } from "vitest";
import {
  maskEmail,
  maskMsisdn,
  normalizeNigerianMsisdn,
  redactNumbers,
  toE164,
  validEmail,
  validId,
  validMessageText,
  validOtp,
  MAX_SMS_CHARS,
} from "./recipient";

describe("normalizeNigerianMsisdn", () => {
  it("accepts the usual ways a Nigerian mobile number is written", () => {
    for (const raw of [
      "08031234567",
      "0803 123 4567",
      "0803-123-4567",
      "+2348031234567",
      "+234 803 123 4567",
      "2348031234567",
      "002348031234567",
      "23408031234567",
      "8031234567",
    ]) {
      expect(normalizeNigerianMsisdn(raw)).toBe("2348031234567");
    }
  });

  it("accepts 070, 081, 090 and 091 ranges", () => {
    expect(normalizeNigerianMsisdn("07061234567")).toBe("2347061234567");
    expect(normalizeNigerianMsisdn("08121234567")).toBe("2348121234567");
    expect(normalizeNigerianMsisdn("09031234567")).toBe("2349031234567");
    expect(normalizeNigerianMsisdn("09121234567")).toBe("2349121234567");
  });

  it("rejects numbers that are not Nigerian mobiles", () => {
    for (const raw of [
      "",
      "   ",
      "+14155550123",
      "+447700900123",
      "012345678",
      "0123456789",
      "01234567890", // Lagos landline range
      "08231234567", // second digit not 0/1
      "0803123456", // too short
      "080312345678", // too long
      "0803abc4567",
      "12345",
      "+234",
    ]) {
      expect(normalizeNigerianMsisdn(raw)).toBeNull();
    }
  });

  it("rejects non-string input", () => {
    expect(normalizeNigerianMsisdn(undefined)).toBeNull();
    expect(normalizeNigerianMsisdn(null)).toBeNull();
    expect(normalizeNigerianMsisdn(2348031234567)).toBeNull();
  });
});

describe("masking", () => {
  it("formats E.164", () => {
    expect(toE164("2348031234567")).toBe("+2348031234567");
  });

  it("masks the middle of a number", () => {
    expect(maskMsisdn("2348031234567")).toBe("234803***4567");
    expect(maskMsisdn("")).toBe("(none)");
    expect(maskMsisdn("12345")).toBe("***");
  });

  it("redacts numbers quoted inside provider errors", () => {
    const out = redactNumbers("The 'To' number +2348031234567 is not valid");
    expect(out).not.toContain("2348031234567");
    expect(out).toContain("***4567");
  });
});

describe("input validation", () => {
  it("accepts ordinary message text and trims it", () => {
    expect(validMessageText("  Take your medicine  ")).toBe("Take your medicine");
  });

  it("rejects empty, non-text and over-long messages", () => {
    expect(validMessageText("")).toBeNull();
    expect(validMessageText("   ")).toBeNull();
    expect(validMessageText(42)).toBeNull();
    expect(validMessageText("x".repeat(MAX_SMS_CHARS + 1))).toBeNull();
  });

  it("accepts 4 to 8 digit codes only", () => {
    expect(validOtp("123456")).toBe("123456");
    expect(validOtp(1234)).toBe("1234");
    expect(validOtp("123")).toBeNull();
    expect(validOtp("123456789")).toBeNull();
    expect(validOtp("12ab56")).toBeNull();
    expect(validOtp(undefined)).toBeNull();
  });

  it("accepts uuid-like ids and rejects anything else", () => {
    expect(validId("3f1c2a4e-9b7d-4c1e-8f00-123456789abc")).toBe(
      "3f1c2a4e-9b7d-4c1e-8f00-123456789abc",
    );
    expect(validId("patient_123")).toBe("patient_123");
    expect(validId("")).toBeNull();
    expect(validId("a,b")).toBeNull();
    expect(validId("x".repeat(65))).toBeNull();
    expect(validId(12)).toBeNull();
  });
});

describe("validEmail", () => {
  it("accepts ordinary addresses, trimmed", () => {
    expect(validEmail(" ada.obi@example.org ")).toBe("ada.obi@example.org");
    expect(validEmail("ada+portal@mail.example.com.ng")).toBe("ada+portal@mail.example.com.ng");
  });

  it("rejects anything that could carry a second address or markup", () => {
    for (const raw of [
      "",
      "ada",
      "ada@example",
      "ada@@example.org",
      "ada@example.org, eve@example.org",
      "Ada <ada@example.org>",
      "ada @example.org",
      "ada@example.org;eve@example.org",
      '"Ada"@example.org',
      "ada@exa mple.org",
      "ada@example.org\nBcc: eve@example.org",
      undefined,
      null,
      42,
    ]) {
      expect(validEmail(raw)).toBeNull();
    }
    expect(validEmail(`${"a".repeat(250)}@example.org`)).toBeNull();
  });
});

describe("maskEmail", () => {
  it("keeps the first letter and the domain only", () => {
    expect(maskEmail("ada.obi@example.org")).toBe("a***@example.org");
    expect(maskEmail("")).toBe("(none)");
    expect(maskEmail(null)).toBe("(none)");
    expect(maskEmail("no-at-sign")).toBe("***");
  });
});
