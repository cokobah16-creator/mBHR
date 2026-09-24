import { describe, it, expect } from "vitest";
import { maskPhoneForLog, safeErrorLabel } from "./logSafe";

describe("safeErrorLabel", () => {
  it("gives the error class, never the message", () => {
    const label = safeErrorLabel(new TypeError("Ada Obi 08031234567"));
    expect(label).toBe("TypeError");
    expect(label).not.toContain("Ada");
    expect(label).not.toContain("0803");
  });

  it("adds a short error code from server errors", () => {
    const pgError = {
      message: 'duplicate key value violates unique constraint "email"',
      details: "Key (email)=(ada@example.com) already exists.",
      hint: null,
      code: "23505",
    };
    const label = safeErrorLabel(pgError);
    expect(label).toBe("Error (code 23505)");
    expect(label).not.toContain("ada@example.com");
  });

  it("keeps a named error object's name", () => {
    expect(safeErrorLabel({ name: "PostgrestError", code: "PGRST116" })).toBe(
      "PostgrestError (code PGRST116)",
    );
  });

  it("uses an HTTP status when there is no code", () => {
    expect(safeErrorLabel({ name: "FunctionsHttpError", status: 503 })).toBe(
      "FunctionsHttpError (code 503)",
    );
  });

  it("drops codes and names that are not short identifiers", () => {
    expect(
      safeErrorLabel({ name: "Ada Obi", code: "phone 0803 123 4567 exists" }),
    ).toBe("Error");
  });

  it("never echoes thrown strings", () => {
    expect(safeErrorLabel("Patient Ada Obi not found")).toBe(
      "non-error value (string)",
    );
    expect(safeErrorLabel(undefined)).toBe("unknown error");
    expect(safeErrorLabel(null)).toBe("unknown error");
  });
});

describe("maskPhoneForLog", () => {
  it("masks an international Nigerian number", () => {
    expect(maskPhoneForLog("2348031234567")).toBe("234803***4567");
    expect(maskPhoneForLog("+234 803 123 4567")).toBe("234803***4567");
  });

  it("masks a local number and always hides at least three digits", () => {
    expect(maskPhoneForLog("08031234567")).toBe("0803***4567");
    expect(maskPhoneForLog("80312345")).toBe("8***2345");
  });

  it("handles short and empty input", () => {
    expect(maskPhoneForLog("12345")).toBe("***");
    expect(maskPhoneForLog("")).toBe("(none)");
    expect(maskPhoneForLog(undefined)).toBe("(none)");
    expect(maskPhoneForLog(null)).toBe("(none)");
  });
});
