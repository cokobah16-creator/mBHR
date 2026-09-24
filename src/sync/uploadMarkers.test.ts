import { describe, it, expect } from "vitest";
import { markersAfterUpload, unchangedSinceRead } from "./uploadMarkers";

const SYNCED_AT = "2024-03-05T10:00:00.000Z";

describe("unchangedSinceRead", () => {
  it("ignores sync markers and key order", () => {
    expect(
      unchangedSinceRead(
        { id: "q1", status: "waiting", _dirty: 1 },
        { status: "waiting", id: "q1", _dirty: 0, _syncedAt: SYNCED_AT },
      ),
    ).toBe(true);
  });

  it("compares dates by instant", () => {
    expect(
      unchangedSinceRead(
        { id: "v1", takenAt: new Date("2024-03-05T09:00:00Z") },
        { id: "v1", takenAt: new Date("2024-03-05T09:00:00Z") },
      ),
    ).toBe(true);
  });

  it("sees a field edited after the read", () => {
    expect(
      unchangedSinceRead(
        { id: "q1", status: "waiting", _dirty: 1 },
        { id: "q1", status: "in_progress", _dirty: 1 },
      ),
    ).toBe(false);
  });

  it("sees a field added after the read", () => {
    expect(
      unchangedSinceRead(
        { id: "p1", givenName: "Ada" },
        { id: "p1", givenName: "Ada", phone: "08012345678" },
      ),
    ).toBe(false);
  });
});

describe("markersAfterUpload", () => {
  it("marks an unchanged record clean", () => {
    const row = { id: "q1", status: "waiting", _dirty: 1 };
    expect(markersAfterUpload(row, { ...row }, SYNCED_AT)).toEqual({
      _dirty: 0,
      _syncedAt: SYNCED_AT,
    });
  });

  it("keeps a record edited during the upload marked unsent", () => {
    expect(
      markersAfterUpload(
        { id: "q1", status: "waiting", _dirty: 1 },
        { id: "q1", status: "in_progress", _dirty: 1 },
        SYNCED_AT,
      ),
    ).toEqual({ _syncedAt: SYNCED_AT });
  });

  it("marks clean when the record is no longer on this device", () => {
    expect(markersAfterUpload({ id: "q1", _dirty: 1 }, undefined, SYNCED_AT)).toEqual({
      _dirty: 0,
      _syncedAt: SYNCED_AT,
    });
  });
});
