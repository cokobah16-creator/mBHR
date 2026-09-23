import { describe, it, expect } from "vitest";
import { namedSyncError, syncErrorCode } from "./errorCode";

describe("syncErrorCode", () => {
  it("uses a Supabase error code and never the message or details", () => {
    const error = {
      code: "23505",
      message: "duplicate key value violates unique constraint",
      details: "Key (phone)=(08012345678) already exists.",
    };
    expect(syncErrorCode(error)).toBe("23505");
  });

  it("uses PostgREST codes", () => {
    expect(syncErrorCode({ code: "PGRST116", message: "x" })).toBe("PGRST116");
  });

  it("falls back to the error name", () => {
    const error = new TypeError("Cannot read properties of undefined (reading 'givenName')");
    expect(syncErrorCode(error)).toBe("TypeError");
  });

  it("does not pass through a code that looks like free text", () => {
    expect(syncErrorCode({ code: "Ada Obi 08012345678" })).toBe("unknown");
  });

  it("returns unknown for anything else", () => {
    expect(syncErrorCode("Ada Obi")).toBe("unknown");
    expect(syncErrorCode(null)).toBe("unknown");
    expect(syncErrorCode(undefined)).toBe("unknown");
  });
});

describe("namedSyncError", () => {
  it("builds an Error whose name and message are the given label", () => {
    const error = namedSyncError("RemoteRecordUnavailable");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("RemoteRecordUnavailable");
    expect(error.message).toBe("RemoteRecordUnavailable");
    expect(syncErrorCode(error)).toBe("RemoteRecordUnavailable");
  });
});
