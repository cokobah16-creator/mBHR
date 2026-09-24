import { describe, it, expect } from "vitest";
import {
  displayStatus,
  formatConflictAge,
  formatTimestamp,
  humanise,
  recordTypeLabel,
  sideLabels,
  staffLabel,
  strategyActionLabel,
  strategyLabel,
} from "./conflictLabels";

describe("record type labels", () => {
  it("uses plain names for known tables and humanises the rest", () => {
    expect(recordTypeLabel("patients")).toBe("Patient");
    expect(recordTypeLabel("patient_allergies")).toBe("Allergy");
    expect(recordTypeLabel("careTasks")).toBe("Care tasks");
    expect(humanise("triage_records")).toBe("Triage records");
  });
});

describe("displayStatus", () => {
  it("shows a dismissed decision as dismissed, not resolved", () => {
    expect(displayStatus({ status: "resolved", resolutionStrategy: "ignore" }).label).toBe("Dismissed");
    expect(displayStatus({ status: "resolved", resolutionStrategy: "keep_local" }).label).toBe("Resolved");
  });

  it("separates 'needs a decision' from a proposal awaiting approval", () => {
    expect(displayStatus({ status: "needs_approval" }).label).toBe("Needs a decision");
    expect(displayStatus({ status: "needs_approval", resolutionStrategy: "keep_remote" }).label).toBe(
      "Awaiting approval",
    );
  });
});

describe("side and strategy wording", () => {
  it("names sides by conflict type", () => {
    expect(sideLabels("sync_conflict").local).toBe("Device copy");
    expect(sideLabels("sync_conflict").remote).toBe("Server copy");
    expect(sideLabels("duplicate").remote).toBe("Record B");
  });

  it("words decisions for buttons and history", () => {
    expect(strategyActionLabel("keep_remote", "sync_conflict")).toBe("Keep server copy");
    expect(strategyActionLabel("ignore", "duplicate")).toBe("Not a duplicate");
    expect(strategyLabel("keep_local", "sync_conflict")).toBe("Kept device copy");
    expect(strategyLabel(undefined, "sync_conflict")).toBe("No decision recorded");
    expect(strategyLabel("keep_newer", "sync_conflict")).toBe("Kept the newer copy (automatic rule)");
  });
});

describe("formatConflictAge", () => {
  const now = new Date("2026-09-23T12:00:00Z");
  it("gives short relative ages", () => {
    expect(formatConflictAge("2026-09-23T11:59:40Z", now)).toBe("Just now");
    expect(formatConflictAge("2026-09-23T11:48:00Z", now)).toBe("12 min");
    expect(formatConflictAge("2026-09-23T09:00:00Z", now)).toBe("3 h");
    expect(formatConflictAge("2026-09-22T11:00:00Z", now)).toBe("1 day");
    expect(formatConflictAge("2026-09-20T11:00:00Z", now)).toBe("3 days");
  });

  it("says unknown instead of guessing", () => {
    expect(formatConflictAge(undefined, now)).toBe("Unknown");
    expect(formatConflictAge("not a date", now)).toBe("Unknown");
  });
});

describe("formatTimestamp", () => {
  it("returns empty for missing or invalid values", () => {
    expect(formatTimestamp(undefined)).toBe("");
    expect(formatTimestamp("garbage")).toBe("");
    expect(formatTimestamp("2026-03-03T14:05:00Z")).toContain("2026");
  });
});

describe("staffLabel", () => {
  it("prefers 'You', then a known name, then a short ID", () => {
    expect(staffLabel("u-1", {}, "u-1")).toBe("You");
    expect(staffLabel("u-2", { "u-2": "Ngozi Eze" }, "u-1")).toBe("Ngozi Eze");
    expect(staffLabel("3f2a9c1e-0000-4000-8000-00000000ab12", {})).toBe("Staff ID …AB12");
    expect(staffLabel(undefined, {})).toBe("Not recorded");
  });
});
