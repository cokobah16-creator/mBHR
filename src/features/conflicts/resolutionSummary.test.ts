import { describe, it, expect } from "vitest";
import { bulkResultText, summariseBulk, summariseResolution, type BulkItem } from "./resolutionSummary";
import type { DevicePlan } from "./devicePlan";

const sync = { conflictType: "sync_conflict" as const, entityType: "vitals" };

const update: DevicePlan = {
  kind: "update_record",
  table: "vitals",
  recordId: "v1",
  changes: [
    { field: "systolic", label: "Systolic", side: "remote", next: 120, current: 140, changesValue: true, changedSinceReport: false },
    { field: "pulseBpm", label: "Pulse", side: "remote", next: 90, current: 95, changesValue: true, changedSinceReport: true },
  ],
};

describe("summariseResolution", () => {
  it("states both the server and the device writes for a final decision", () => {
    const s = summariseResolution({ mode: "resolve", conflict: sync, strategy: "keep_remote", plan: update, needsApproval: false });
    expect(s.heading).toBe("Keep server copy");
    expect(s.confirmLabel).toBe("Resolve conflict");
    expect(s.server[0]).toBe("Marks the conflict as resolved in the shared conflict log.");
    expect(s.device[0]).toBe("Updates 2 fields on this device's copy of the vital signs record.");
    expect(s.device[1]).toContain("Marks the record to upload at the next sync");
    expect(s.warnings).toHaveLength(1);
    expect(s.warnings[0]).toBe(
      'Pulse: this device now holds "95", not the value reported with the conflict (it may have been edited or downloaded since). It will be replaced with "90".',
    );
    expect(s.blocked).toBe(false);
  });

  it("promises nothing on the device while a decision awaits approval", () => {
    const s = summariseResolution({
      mode: "resolve",
      conflict: { conflictType: "sync_conflict", entityType: "patients" },
      strategy: "keep_local",
      plan: { kind: "none", reason: "awaiting_approval" },
      needsApproval: true,
      approverName: "Lead Clinician",
    });
    expect(s.confirmLabel).toBe("Send for approval");
    expect(s.server[0]).toContain("sends it to Lead Clinician for approval");
    expect(s.device).toEqual(["Nothing changes on this device until the decision is approved."]);
  });

  it("is honest when the record is not on this device", () => {
    const s = summariseResolution({ mode: "resolve", conflict: sync, strategy: "keep_local", plan: { kind: "none", reason: "not_on_device" }, needsApproval: false });
    expect(s.device[0]).toBe("This vital signs record is not stored on this device, so nothing changes here.");
    expect(s.device[1]).toContain("will report the conflict again");
  });

  it("blocks confirmation until every field is chosen", () => {
    const s = summariseResolution({ mode: "resolve", conflict: sync, strategy: "manual", plan: { kind: "none", reason: "incomplete_selection" }, needsApproval: false });
    expect(s.blocked).toBe(true);
  });

  it("describes a duplicate merge with record labels", () => {
    const s = summariseResolution({
      mode: "approve",
      conflict: { conflictType: "duplicate", entityType: "patients" },
      strategy: "keep_remote",
      plan: { kind: "merge_patients", winnerId: "B", loserId: "A", copied: [], alreadyMerged: false },
      needsApproval: false,
      recordALabel: "record A (MBHR-AAAAAA)",
      recordBLabel: "record B (MBHR-BBBBBB)",
    });
    expect(s.confirmLabel).toBe("Approve and apply");
    expect(s.device[0]).toContain("of record A (MBHR-AAAAAA) to record B (MBHR-BBBBBB)");
    expect(s.device[0]).toContain("Neither record is deleted.");
  });

  it("blocks a merge when either record is already merged elsewhere", () => {
    const s = summariseResolution({
      mode: "approve",
      conflict: { conflictType: "duplicate", entityType: "patients" },
      strategy: "keep_local",
      plan: { kind: "none", reason: "merged_elsewhere" },
      needsApproval: false,
    });
    expect(s.blocked).toBe(true);
    expect(s.device[0]).toContain("already merged into another patient record");
    expect(s.device[1]).toContain("Send the decision back");
  });

  it("labels a first-of-two approval", () => {
    const s = summariseResolution({
      mode: "approve",
      conflict: { conflictType: "duplicate", entityType: "patients" },
      strategy: "keep_local",
      plan: { kind: "none", reason: "awaiting_approval" },
      needsApproval: false,
      firstOfTwoApprovals: true,
    });
    expect(s.confirmLabel).toBe("Record first approval");
    expect(s.device).toEqual(["Nothing changes on this device yet."]);
  });
});

describe("summariseBulk", () => {
  const items: BulkItem[] = [
    { conflict: { id: "1", conflictType: "sync_conflict" }, allowed: true, needsApproval: false, plan: update },
    { conflict: { id: "2", conflictType: "sync_conflict" }, allowed: true, needsApproval: false, plan: { kind: "none", reason: "not_on_device" } },
    { conflict: { id: "3", conflictType: "sync_conflict" }, allowed: true, needsApproval: true, plan: { kind: "none", reason: "awaiting_approval" } },
    { conflict: { id: "4", conflictType: "sync_conflict" }, allowed: false, needsApproval: true, plan: { kind: "none", reason: "awaiting_approval" } },
    { conflict: { id: "5", conflictType: "duplicate" }, allowed: true, needsApproval: false, plan: { kind: "none", reason: "dismissed" } },
  ];

  it("counts what will happen and what is skipped", () => {
    const s = summariseBulk(items, "keep_local");
    expect(s.eligibleIds).toEqual(["1", "2", "3"]);
    expect(s.deviceUpdates).toBe(1);
    expect(s.notOnDevice).toBe(1);
    expect(s.sentForApproval).toBe(1);
    expect(s.skippedPermission).toBe(1);
    expect(s.skippedOtherTypes).toBe(1);
    expect(s.lines[0]).toBe("Marks 2 conflicts as resolved in the shared conflict log.");
  });

  it("lets every type be dismissed", () => {
    const s = summariseBulk(items, "ignore");
    expect(s.eligibleIds).toEqual(["1", "2", "3", "5"]);
    expect(s.lines[0]).toBe("Marks 4 conflicts as dismissed in the shared conflict log. No record values change.");
  });
});

describe("bulkResultText", () => {
  it("reports every outcome, including device failures", () => {
    expect(bulkResultText({ resolved: 3, sentForApproval: 0, notSaved: 0, deviceFailed: 0 }, "keep_local")).toBe(
      "3 resolved.",
    );
    expect(bulkResultText({ resolved: 2, sentForApproval: 1, notSaved: 1, deviceFailed: 1 }, "keep_remote")).toBe(
      "2 resolved, 1 sent for approval, 1 not saved. 1 record could not be updated on this device; apply it from Resolved.",
    );
    expect(bulkResultText({ resolved: 4, sentForApproval: 0, notSaved: 0, deviceFailed: 0 }, "ignore")).toBe(
      "4 dismissed.",
    );
  });
});
