import { describe, it, expect } from "vitest";
import {
  buildLocalPatch,
  coerceToLocalShape,
  deviceMatchesDecision,
  mergeFieldChoicesFor,
  planDeviceWrite,
  planHasWork,
  type DevicePlan,
} from "./devicePlan";
import type { ConflictField, ConflictResolution } from "@/services/conflictQueue";

const f = (
  name: string,
  localValue: unknown,
  remoteValue: unknown,
  type: ConflictField["type"] = "string",
): ConflictField => ({ field: name, label: name, localValue, remoteValue, type, phiSensitivity: "low" });

const syncConflict = (fields: ConflictField[]): Pick<
  ConflictResolution,
  "conflictType" | "entityType" | "entityId" | "candidateIds" | "conflictDetails"
> => ({
  conflictType: "sync_conflict",
  entityType: "vitals",
  entityId: "vit-1",
  candidateIds: [],
  conflictDetails: { fields },
});

const fields = [f("systolic", 140, 120, "number"), f("pulseBpm", 88, 90, "number")];
const reporter = { id: "vit-1", systolic: 140, pulseBpm: 88 };

function plan(overrides: Partial<Parameters<typeof planDeviceWrite>[0]> = {}): DevicePlan {
  return planDeviceWrite({
    conflict: syncConflict(fields),
    strategy: "keep_local",
    selections: {},
    awaitingApproval: false,
    snapshot: { table: "vitals", record: reporter, partner: null },
    ...overrides,
  });
}

describe("planDeviceWrite: sync conflicts", () => {
  it("keeping the device copy on the reporting device changes no values but still uploads", () => {
    const p = plan();
    expect(p.kind).toBe("update_record");
    if (p.kind !== "update_record") return;
    expect(p.changes.every((c) => !c.changesValue)).toBe(true);
    expect(buildLocalPatch(p.changes)).toEqual({});
    expect(planHasWork(p)).toBe(true);
    expect(deviceMatchesDecision(p)).toBe(true);
  });

  it("keeping the server copy writes the server values", () => {
    const p = plan({ strategy: "keep_remote" });
    if (p.kind !== "update_record") throw new Error("expected update");
    expect(buildLocalPatch(p.changes)).toEqual({ systolic: 120, pulseBpm: 90 });
    expect(deviceMatchesDecision(p)).toBe(false);
  });

  it("field-by-field needs a choice for every differing field", () => {
    expect(plan({ strategy: "manual", selections: { systolic: "remote" } })).toEqual({
      kind: "none",
      reason: "incomplete_selection",
    });
    const p = plan({ strategy: "manual", selections: { systolic: "remote", pulseBpm: "local" } });
    if (p.kind !== "update_record") throw new Error("expected update");
    expect(buildLocalPatch(p.changes)).toEqual({ systolic: 120 });
  });

  it("flags values that changed on this device after the conflict was reported", () => {
    const p = plan({
      strategy: "keep_remote",
      snapshot: { table: "vitals", record: { id: "vit-1", systolic: 150, pulseBpm: 88 }, partner: null },
    });
    if (p.kind !== "update_record") throw new Error("expected update");
    expect(p.changes.find((c) => c.field === "systolic")?.changedSinceReport).toBe(true);
    expect(p.changes.find((c) => c.field === "pulseBpm")?.changedSinceReport).toBe(false);
  });

  it("writes nothing when dismissed, awaiting approval, or the record is not here", () => {
    expect(plan({ strategy: "ignore" })).toEqual({ kind: "none", reason: "dismissed" });
    expect(plan({ awaitingApproval: true })).toEqual({ kind: "none", reason: "awaiting_approval" });
    expect(plan({ snapshot: { table: "vitals", record: null, partner: null } })).toEqual({
      kind: "none",
      reason: "not_on_device",
    });
    expect(plan({ snapshot: { table: null, record: null, partner: null } })).toEqual({
      kind: "none",
      reason: "unknown_table",
    });
  });

  it("never plans writes to id or sync bookkeeping fields", () => {
    const p = planDeviceWrite({
      conflict: syncConflict([f("_dirty", 1, 0, "number"), f("id", "a", "b"), f("tempC", 37, 38, "number")]),
      strategy: "keep_remote",
      selections: {},
      awaitingApproval: false,
      snapshot: { table: "vitals", record: { id: "a", tempC: 37 }, partner: null },
    });
    if (p.kind !== "update_record") throw new Error("expected update");
    expect(p.changes.map((c) => c.field)).toEqual(["tempC"]);
  });
});

describe("coerceToLocalShape", () => {
  it("keeps Dates as Dates and numbers as numbers", () => {
    const d = coerceToLocalShape("2026-09-01T10:00:00.000Z", new Date("2026-08-01"));
    expect(d instanceof Date).toBe(true);
    expect(coerceToLocalShape("120", 110)).toBe(120);
    expect(coerceToLocalShape("abc", 110)).toBe("abc");
    expect(coerceToLocalShape("1990-01-01", "1989-12-31")).toBe("1990-01-01");
  });
});

describe("planDeviceWrite: duplicates", () => {
  const dupFields = [f("phone", "0803", "0805"), f("address", "Ikeja", "Yaba")];
  const dup = {
    conflictType: "duplicate" as const,
    entityType: "patients",
    entityId: "A",
    candidateIds: ["B", "C"],
    conflictDetails: { fields: dupFields },
  };
  const snapshot = {
    table: "patients",
    record: { id: "A", phone: "0803", address: "Ikeja" },
    partner: { id: "B", phone: "0805", address: "Yaba" },
  };

  it("keeps A and merges B into it", () => {
    const p = planDeviceWrite({ conflict: dup, strategy: "keep_local", selections: {}, awaitingApproval: false, snapshot });
    expect(p).toEqual({ kind: "merge_patients", winnerId: "A", loserId: "B", copied: [], alreadyMerged: false });
  });

  it("keeps B and merges A into it", () => {
    const p = planDeviceWrite({ conflict: dup, strategy: "keep_remote", selections: {}, awaitingApproval: false, snapshot });
    if (p.kind !== "merge_patients") throw new Error("expected merge");
    expect([p.winnerId, p.loserId]).toEqual(["B", "A"]);
  });

  it("combines chosen B values into A", () => {
    const p = planDeviceWrite({
      conflict: dup,
      strategy: "manual",
      selections: { phone: "remote", address: "local" },
      awaitingApproval: false,
      snapshot,
    });
    if (p.kind !== "merge_patients") throw new Error("expected merge");
    expect(buildLocalPatch(p.copied)).toEqual({ phone: "0805" });
    expect(p.winnerId).toBe("A");
  });

  it("recognises a merge already done on this device", () => {
    const p = planDeviceWrite({
      conflict: dup,
      strategy: "keep_local",
      selections: {},
      awaitingApproval: false,
      snapshot: { ...snapshot, partner: { ...snapshot.partner, mergeInto: "A" } },
    });
    expect(deviceMatchesDecision(p)).toBe(true);
    expect(planHasWork(p)).toBe(false);
  });

  it("never merges into, or re-targets, a record already merged elsewhere", () => {
    // The scan reports A->B and B->A. After B was merged into A, keeping B in
    // the mirror conflict would create a merge loop.
    const mirrored = { ...dup, entityId: "B", candidateIds: ["A"] };
    const merged = {
      table: "patients",
      record: { id: "B", phone: "0805", address: "Yaba", mergeInto: "A" },
      partner: { id: "A", phone: "0803", address: "Ikeja" },
    };
    expect(
      planDeviceWrite({ conflict: mirrored, strategy: "keep_local", selections: {}, awaitingApproval: false, snapshot: merged }),
    ).toEqual({ kind: "none", reason: "merged_elsewhere" });
    // Loser already merged into a third record.
    expect(
      planDeviceWrite({
        conflict: dup,
        strategy: "keep_local",
        selections: {},
        awaitingApproval: false,
        snapshot: { ...snapshot, partner: { ...snapshot.partner, mergeInto: "C" } },
      }),
    ).toEqual({ kind: "none", reason: "merged_elsewhere" });
    // Keeping A in the mirrored conflict matches the merge already done.
    const same = planDeviceWrite({
      conflict: mirrored,
      strategy: "keep_remote",
      selections: {},
      awaitingApproval: false,
      snapshot: merged,
    });
    expect(same).toEqual({ kind: "merge_patients", winnerId: "A", loserId: "B", copied: [], alreadyMerged: true });
  });

  it("carries the chosen B values to the server as field choices for the merge", () => {
    const p = planDeviceWrite({
      conflict: dup,
      strategy: "manual",
      selections: { phone: "remote", address: "local" },
      awaitingApproval: false,
      snapshot,
    });
    if (p.kind !== "merge_patients") throw new Error("expected merge");
    expect(mergeFieldChoicesFor(p)).toEqual({
      choices: { phone: { source: "loser", value: "0805" } },
      skipped: [],
    });
  });

  it("sends no field choices when a whole record is kept", () => {
    const p = planDeviceWrite({ conflict: dup, strategy: "keep_remote", selections: {}, awaitingApproval: false, snapshot });
    if (p.kind !== "merge_patients") throw new Error("expected merge");
    expect(mergeFieldChoicesFor(p)).toEqual({ choices: {}, skipped: [] });
  });

  it("never sends an empty name as a field choice", () => {
    const names = { ...dup, conflictDetails: { fields: [f("givenName", "Ada", "")] } };
    const p = planDeviceWrite({
      conflict: names,
      strategy: "manual",
      selections: { givenName: "remote" },
      awaitingApproval: false,
      snapshot: { ...snapshot, record: { id: "A", givenName: "Ada" }, partner: { id: "B", givenName: "" } },
    });
    if (p.kind !== "merge_patients") throw new Error("expected merge");
    expect(mergeFieldChoicesFor(p)).toEqual({ choices: {}, skipped: ["givenName"] });
  });

  it("cannot merge when either record is missing here", () => {
    expect(
      planDeviceWrite({ conflict: dup, strategy: "keep_local", selections: {}, awaitingApproval: false, snapshot: { ...snapshot, partner: null } }),
    ).toEqual({ kind: "none", reason: "partner_not_on_device" });
  });
});
