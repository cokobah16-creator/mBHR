import { describe, it, expect } from "vitest";
import {
  serverStampMarker,
  serverStampOf,
  serverUnchangedSince,
  stampAfterUpload,
} from "./serverStamp";

describe("serverUnchangedSince", () => {
  it("treats the same instant written another way as unchanged", () => {
    const seen = "2026-09-20T10:00:00.123456+00:00";
    expect(serverUnchangedSince(seen, seen)).toBe(true);
    expect(serverUnchangedSince("2026-09-20T10:00:00.123456Z", seen)).toBe(true);
    expect(serverUnchangedSince("2026-09-20 11:00:00.123456+01", seen)).toBe(true);
    expect(serverUnchangedSince("2026-09-20T10:00:00.123Z", "2026-09-20T10:00:00.123000+00:00")).toBe(true);
  });

  it("reports a different instant as a change, down to the microsecond", () => {
    const seen = "2026-09-20T10:00:00.123456+00:00";
    expect(serverUnchangedSince("2026-09-20T10:00:01.123456+00:00", seen)).toBe(false);
    expect(serverUnchangedSince("2026-09-20T09:59:59+00:00", seen)).toBe(false);
    expect(serverUnchangedSince("2026-09-20T10:00:00.123457+00:00", seen)).toBe(false);
  });

  it("is never unchanged when nothing was seen or the server sent no stamp", () => {
    const stamp = "2026-09-20T10:00:00Z";
    expect(serverUnchangedSince(stamp, undefined)).toBe(false);
    expect(serverUnchangedSince(stamp, null)).toBe(false);
    expect(serverUnchangedSince(stamp, "")).toBe(false);
    expect(serverUnchangedSince(null, stamp)).toBe(false);
    expect(serverUnchangedSince(undefined, stamp)).toBe(false);
  });

  it("compares values that are not dates as text", () => {
    expect(serverUnchangedSince("not a date", "not a date")).toBe(true);
    expect(serverUnchangedSince("not a date", "2026-09-20T10:00:00Z")).toBe(false);
  });
});

describe("serverStampOf and serverStampMarker", () => {
  it("keeps only non-empty text", () => {
    expect(serverStampOf("2026-09-20T10:00:00Z")).toBe("2026-09-20T10:00:00Z");
    expect(serverStampOf("  ")).toBeUndefined();
    expect(serverStampOf(new Date())).toBeUndefined();
    expect(serverStampOf(undefined)).toBeUndefined();
  });

  it("writes the row's updated_at, or nothing when it has none", () => {
    expect(serverStampMarker({ id: "v1", updated_at: "2026-09-20T10:00:00Z" })).toEqual({
      _serverUpdatedAt: "2026-09-20T10:00:00Z",
    });
    expect(serverStampMarker({ id: "v1" })).toEqual({});
    expect(serverStampMarker({ id: "v1", updated_at: null })).toEqual({});
  });
});

describe("stampAfterUpload", () => {
  const columnMap = {
    id: "id",
    status: "status",
    startedAt: "started_at",
    isActive: "is_active",
    updatedAt: "updated_at",
  };
  const uploaded = {
    id: "v1",
    status: "open",
    startedAt: new Date("2026-09-20T09:00:00Z"),
    isActive: 1,
    // This device's clock, behind the server's.
    updatedAt: new Date("2026-09-20T09:55:00Z"),
    _dirty: 1,
  };

  it("accepts the server's stamp when the row holds what was uploaded", () => {
    const serverRow = {
      id: "v1",
      status: "open",
      started_at: "2026-09-20T09:00:00+00:00",
      is_active: true,
      updated_at: "2026-09-20T10:00:00.123456+00:00",
    };
    expect(stampAfterUpload(uploaded, serverRow, columnMap)).toBe(
      "2026-09-20T10:00:00.123456+00:00",
    );
  });

  it("refuses it when another change reached the server in between", () => {
    const serverRow = {
      id: "v1",
      status: "closed",
      started_at: "2026-09-20T09:00:00+00:00",
      is_active: true,
      updated_at: "2026-09-20T10:00:01+00:00",
    };
    expect(stampAfterUpload(uploaded, serverRow, columnMap)).toBeUndefined();
    expect(
      stampAfterUpload(uploaded, { ...serverRow, status: "open", is_active: false }, columnMap),
    ).toBeUndefined();
  });

  it("refuses a row without a stamp", () => {
    const serverRow = { id: "v1", status: "open", started_at: "2026-09-20T09:00:00Z", is_active: true };
    expect(stampAfterUpload(uploaded, serverRow, columnMap)).toBeUndefined();
  });
});
