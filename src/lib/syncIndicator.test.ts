import { describe, it, expect } from "vitest";
import { deriveSyncIndicatorKind, type SyncIndicatorInput } from "./syncIndicator";

const base: SyncIndicatorInput = {
  online: true,
  syncEnabled: true,
  cloudSession: "signed_in",
  syncing: false,
  hasError: false,
  conflictCount: 0,
  pending: 0,
  lastSuccessAt: 0,
};

describe("deriveSyncIndicatorKind", () => {
  it("shows the no-session state whenever sync is set up but nobody is signed in online", () => {
    expect(deriveSyncIndicatorKind({ ...base, cloudSession: "signed_out" })).toBe("no_session");
    expect(
      deriveSyncIndicatorKind({ ...base, cloudSession: "signed_out", online: false }),
    ).toBe("no_session");
    expect(
      deriveSyncIndicatorKind({ ...base, cloudSession: "signed_out", syncing: true, pending: 3 }),
    ).toBe("no_session");
  });

  it("does not warn before the sign-in has been checked", () => {
    expect(deriveSyncIndicatorKind({ ...base, cloudSession: "unknown" })).toBe("idle");
    expect(deriveSyncIndicatorKind({ ...base, cloudSession: "unknown", online: false })).toBe(
      "offline",
    );
  });

  it("does not mention online sign-in when cloud sync is not set up", () => {
    expect(
      deriveSyncIndicatorKind({ ...base, syncEnabled: false, cloudSession: "signed_out" }),
    ).toBe("local");
    expect(
      deriveSyncIndicatorKind({
        ...base,
        syncEnabled: false,
        cloudSession: "signed_out",
        online: false,
      }),
    ).toBe("offline");
  });

  it("keeps the existing order for a signed-in device", () => {
    expect(deriveSyncIndicatorKind({ ...base, online: false })).toBe("offline");
    expect(deriveSyncIndicatorKind({ ...base, syncing: true, hasError: true })).toBe("syncing");
    expect(deriveSyncIndicatorKind({ ...base, hasError: true, conflictCount: 2 })).toBe("error");
    expect(deriveSyncIndicatorKind({ ...base, conflictCount: 2, pending: 4 })).toBe("conflict");
    expect(deriveSyncIndicatorKind({ ...base, pending: 4, lastSuccessAt: 1 })).toBe("pending");
    expect(deriveSyncIndicatorKind({ ...base, lastSuccessAt: 1 })).toBe("synced");
    expect(deriveSyncIndicatorKind(base)).toBe("idle");
  });
});
