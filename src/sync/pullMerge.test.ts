import { describe, it, expect } from "vitest";
import { hasUnsentChanges, mergePulledRow } from "./pullMerge";

describe("hasUnsentChanges", () => {
  it("is true only for rows marked _dirty = 1", () => {
    expect(hasUnsentChanges({ id: "a", _dirty: 1 })).toBe(true);
    expect(hasUnsentChanges({ id: "a", _dirty: 0 })).toBe(false);
    expect(hasUnsentChanges({ id: "a" })).toBe(false);
    expect(hasUnsentChanges(undefined)).toBe(false);
    expect(hasUnsentChanges(null)).toBe(false);
  });
});

describe("mergePulledRow", () => {
  const markers = { _dirty: 0, _syncedAt: "2024-03-05T10:00:00.000Z" };

  it("keeps a local row that has changes not uploaded yet", () => {
    const local = { id: "p1", givenName: "Ada (edited here)", _dirty: 1 };
    const remote = { id: "p1", givenName: "Ada" };
    expect(mergePulledRow(local, remote, markers)).toEqual({ kind: "kept-local" });
  });

  it("writes the server row when this device has no copy", () => {
    const remote = { id: "p1", givenName: "Ada" };
    expect(mergePulledRow(undefined, remote, markers)).toEqual({
      kind: "apply",
      row: { id: "p1", givenName: "Ada", ...markers },
    });
  });

  it("lays the server row over a clean local row and keeps device-only fields", () => {
    const local = {
      id: "q1",
      stage: "vitals",
      ticketNumber: "Q-014",
      assignedTo: "u1",
      _dirty: 0,
      _syncedAt: "2024-03-01T00:00:00.000Z",
    };
    const remote = { id: "q1", stage: "consult" };
    expect(mergePulledRow(local, remote, markers)).toEqual({
      kind: "apply",
      row: {
        id: "q1",
        stage: "consult",
        ticketNumber: "Q-014",
        assignedTo: "u1",
        ...markers,
      },
    });
  });

  it("lets the server clear a synced field with null", () => {
    const local = { id: "p1", phone: "08012345678", _dirty: 0 };
    const decision = mergePulledRow(local, { id: "p1", phone: null }, markers);
    expect(decision).toEqual({
      kind: "apply",
      row: { id: "p1", phone: null, ...markers },
    });
  });

  it("works without markers when the row mapper already sets them", () => {
    const decision = mergePulledRow(
      { id: "p1", nameKey: "AT-OK" },
      { id: "p1", givenName: "Ada", _dirty: 0 },
    );
    expect(decision).toEqual({
      kind: "apply",
      row: { id: "p1", nameKey: "AT-OK", givenName: "Ada", _dirty: 0 },
    });
  });

  describe("server-owned fields", () => {
    const serverOwned = ["portalEnabled", "portalEnabledChangedAt", "mergeInto", "mergedAt"];

    it("applies a merge link to a record that has unsent edits, and keeps the edits", () => {
      const local = {
        id: "p2",
        givenName: "Ada (edited here)",
        _dirty: 1,
        _syncedAt: "2024-03-01T00:00:00.000Z",
        _serverVersion: 3,
      };
      const remote = { id: "p2", givenName: "Ada", mergeInto: "p1", mergedAt: "2024-03-05T09:00:00Z", _serverVersion: 4 };
      expect(mergePulledRow(local, remote, markers, { serverOwned })).toEqual({
        kind: "server-owned",
        row: { ...local, mergeInto: "p1", mergedAt: "2024-03-05T09:00:00Z" },
      });
    });

    it("keeps the unsent row untouched when the server-owned values did not change", () => {
      const local = { id: "p2", givenName: "Edited", portalEnabled: 1, _dirty: 1 };
      const remote = { id: "p2", givenName: "Server", portalEnabled: 1 };
      expect(mergePulledRow(local, remote, markers, { serverOwned })).toEqual({ kind: "kept-local" });
    });

    it("treats null and missing as the same server-owned value", () => {
      const local = { id: "p2", _dirty: 1 };
      const remote = { id: "p2", mergedAt: null };
      expect(mergePulledRow(local, remote, markers, { serverOwned })).toEqual({ kind: "kept-local" });
    });

    it("does not overwrite a held field on an unsent row", () => {
      const local = { id: "p2", portalEnabled: 1, portalPending: 1, _dirty: 1 };
      const remote = { id: "p2", portalEnabled: 0, mergeInto: "p1" };
      expect(
        mergePulledRow(local, remote, markers, {
          serverOwned,
          held: ["portalEnabled", "portalEnabledChangedAt"],
        }),
      ).toEqual({ kind: "server-owned", row: { ...local, mergeInto: "p1" } });
    });

    it("keeps a held field's local value on a clean row", () => {
      const local = { id: "p2", givenName: "Ada", portalEnabled: 1, portalPending: 1, _dirty: 0 };
      const remote = { id: "p2", givenName: "Adaeze", portalEnabled: 0 };
      expect(
        mergePulledRow(local, remote, markers, { serverOwned, held: ["portalEnabled"] }),
      ).toEqual({
        kind: "apply",
        row: { id: "p2", givenName: "Adaeze", portalEnabled: 1, portalPending: 1, ...markers },
      });
    });

    it("does not add a held field the local row never had", () => {
      const remote = { id: "p9", portalEnabled: 1 };
      expect(mergePulledRow({ id: "p9" }, remote, markers, { held: ["portalEnabled"] })).toEqual({
        kind: "apply",
        row: { id: "p9", ...markers },
      });
    });
  });
});
