import { describe, it, expect } from "vitest";
import { errorName, parsePortalUser } from "./portalSession";

describe("parsePortalUser", () => {
  it("returns null for missing, invalid or non-object values", () => {
    expect(parsePortalUser(null)).toBeNull();
    expect(parsePortalUser("{bad")).toBeNull();
    expect(parsePortalUser("[]")).toBeNull();
    expect(parsePortalUser("42")).toBeNull();
  });

  it("parses a stored user", () => {
    expect(parsePortalUser('{"id":"u1","patientId":"p1"}')).toEqual({
      id: "u1",
      patientId: "p1",
    });
  });
});

describe("errorName", () => {
  it("never returns the error message", () => {
    const err = new TypeError("Ada Obi 08031234567");
    expect(errorName(err)).toBe("TypeError");
  });

  it("uses a code for Supabase-style error objects", () => {
    expect(errorName({ code: "42P01", message: "secret" })).toBe("code 42P01");
    expect(errorName({ message: "secret" })).toBe("object");
    expect(errorName("text")).toBe("string");
  });
});
