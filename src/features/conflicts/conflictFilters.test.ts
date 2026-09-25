import { describe, it, expect } from "vitest";
import {
  EMPTY_FILTERS,
  hasActiveFilters,
  isConflictType,
  isConflictView,
  isPriority,
  isSensitivity,
  pageOf,
  pageRange,
  sortOpenConflicts,
  toServiceFilters,
} from "./conflictFilters";
import { localTableFor } from "./entityTables";

describe("sortOpenConflicts", () => {
  it("puts the most urgent first, then the oldest", () => {
    const sorted = sortOpenConflicts([
      { id: "a", priority: "low" as const, createdAt: "2026-09-01T00:00:00Z" },
      { id: "b", priority: "critical" as const, createdAt: "2026-09-20T00:00:00Z" },
      { id: "c", priority: "critical" as const, createdAt: "2026-09-10T00:00:00Z" },
      { id: "d", priority: "medium" as const, createdAt: "2026-09-05T00:00:00Z" },
    ]);
    expect(sorted.map((c) => c.id)).toEqual(["c", "b", "d", "a"]);
  });
});

describe("type guards", () => {
  it("accepts only known values", () => {
    expect(isConflictView("resolved")).toBe(true);
    expect(isConflictView("all")).toBe(false);
    expect(isConflictType("duplicate")).toBe(true);
    expect(isPriority("urgent")).toBe(false);
    expect(isSensitivity("none")).toBe(true);
  });
});

describe("filters", () => {
  it("treats empty values as 'any'", () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, phiSensitivity: "high" })).toBe(true);
    expect(toServiceFilters({ ...EMPTY_FILTERS, entityType: "vitals" })).toEqual({
      entityType: "vitals",
      conflictType: undefined,
      priority: undefined,
      phiSensitivity: undefined,
    });
  });
});

describe("paging", () => {
  it("slices pages and reports ranges", () => {
    expect(pageOf([1, 2, 3, 4, 5], 1, 2)).toEqual([3, 4]);
    expect(pageRange(2, 20, 57)).toEqual({ from: 41, to: 57 });
    expect(pageRange(0, 20, 0)).toEqual({ from: 0, to: 0 });
  });
});

describe("localTableFor", () => {
  const tables = ["patients", "vitals", "patientAllergies", "users"];
  it("maps server table names to this device's tables", () => {
    expect(localTableFor("patient_allergies", tables)).toBe("patientAllergies");
    expect(localTableFor("app_users", tables)).toBe("users");
    expect(localTableFor("vitals", tables)).toBe("vitals");
  });
  it("returns null when this device has no such table", () => {
    expect(localTableFor("inventory", tables)).toBeNull();
    expect(localTableFor("gameSessions", tables)).toBeNull();
  });
  it("accepts only server table names, not bare local table names", () => {
    expect(localTableFor("users", tables)).toBeNull();
    expect(localTableFor("patientAllergies", tables)).toBeNull();
    expect(localTableFor("constructor", tables)).toBeNull();
  });
});
