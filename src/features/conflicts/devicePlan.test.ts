import { describe, it, expect } from "vitest";
import {
  buildLocalPatch,
  coerceToLocalShape,
  deviceMatchesDecision,
  isProtectedField,
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

  it("writes only name and contact details to a staff account", () => {
    const staffConflict = {
      ...syncConflict([
        f("role", "nurse", "admin"),
        f("adminAccess", false, true),
        f("adminPermanent", false, true),
        f("pinHash", "old", "new"),
        f("pinSalt", "s1", "s2"),
        f("isActive", 0, 1, "number"),
        f("lastOnlineVerifiedAt", "2026-01-01", "2026-09-01"),
        f("disabledLocallyAt", "2026-01-01", null),
        f("phone", "0801", "0802"),
      ]),
      entityType: "app_users",
      entityId: "u1",
    };
    const record = { id: "u1", role: "nurse", adminAccess: false, pinHash: "old", phone: "0801" };
    const p = planDeviceWrite({
      conflict: staffConflict,
      strategy: "keep_remote",
      selections: {},
      awaitingApproval: false,
      snapshot: { table: "users", record, partner: null },
    });
    if (p.kind !== "update_record") throw new Error("expected update");
    expect(p.changes.map((c) => c.field)).toEqual(["phone"]);
    expect(buildLocalPatch(p.changes, "users")).toEqual({ phone: "0802" });
  });

  it("plans nothing for a staff account when only protected fields differ", () => {
    const p = planDeviceWrite({
      conflict: { ...syncConflict([f("role", "nurse", "admin"), f("pinHash", "a", "b")]), entityType: "app_users" },
      strategy: "keep_remote",
      selections: {},
      awaitingApproval: false,
      snapshot: { table: "users", record: { id: "vit-1", role: "nurse", pinHash: "a" }, partner: null },
    });
    expect(p).toEqual({ kind: "none", reason: "no_fields" });
  });

  it("never builds a staff account patch with protected fields, whatever the plan holds", () => {
    const changes = [
      { field: "role", label: "role", side: "remote" as const, next: "admin", current: "nurse", changesValue: true, changedSinceReport: false },
      { field: "pinHash", label: "pinHash", side: "remote" as const, next: "x", current: "y", changesValue: true, changedSinceReport: false },
      { field: "fullName", label: "fullName", side: "remote" as const, next: "Ada O.", current: "Ada", changesValue: true, changedSinceReport: false },
    ];
    expect(buildLocalPatch(changes, "users")).toEqual({ fullName: "Ada O." });
    expect(isProtectedField("role", "users")).toBe(true);
    expect(isProtectedField("role", "vitals")).toBe(false);
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
