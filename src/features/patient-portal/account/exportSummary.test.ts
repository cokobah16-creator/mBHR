import { describe, it, expect } from "vitest";
import {
  countBundleResources,
  describeValidation,
  EXPORT_SECTIONS,
  exportErrorMessage,
  exportFileBase,
  labelForResourceType,
  summariseCounts,
  totalCount,
} from "./exportSummary";

describe("labelForResourceType", () => {
  it("uses plain words for known FHIR types", () => {
    expect(labelForResourceType("Encounter")).toBe("Clinic visits");
    expect(labelForResourceType("AllergyIntolerance")).toBe("Allergies");
  });

  it("falls back to the type name", () => {
    expect(labelForResourceType("Procedure")).toBe("Procedure");
  });
});

describe("summariseCounts", () => {
  const counts = {
    AllergyIntolerance: 2,
    Patient: 1,
    Encounter: 0,
    Procedure: 3,
  };

  it("orders known types first and unknown types last", () => {
    expect(summariseCounts(counts).map((r) => r.type)).toEqual([
      "Patient",
      "Encounter",
      "AllergyIntolerance",
      "Procedure",
    ]);
  });

  it("can drop zero counts", () => {
    expect(
      summariseCounts(counts, { dropZero: true }).map((r) => r.type),
    ).toEqual(["Patient", "AllergyIntolerance", "Procedure"]);
  });

  it("handles a missing object", () => {
    expect(summariseCounts(undefined)).toEqual([]);
  });
});

describe("totalCount", () => {
  it("adds finite counts only", () => {
    expect(totalCount({ a: 2, b: 3, c: Number.NaN })).toBe(5);
    expect(totalCount(undefined)).toBe(0);
  });
});

describe("exportFileBase", () => {
  it("keeps the existing file-name pattern", () => {
    expect(exportFileBase("p1", new Date("2026-03-05T10:00:00Z"))).toBe(
      "health-data-p1-2026-03-05",
    );
  });
});

describe("describeValidation", () => {
  it("is a warning, not a success, when any item failed", () => {
    const r = describeValidation({
      totalResources: 10,
      validResources: 8,
      invalidResources: 2,
      summary: { warnings: 0 },
    });
    expect(r.tone).toBe("warning");
    expect(r.headline).toContain("8 of 10");
    expect(r.headline).toContain("2 did not");
  });

  it("is a success when every item passed", () => {
    const r = describeValidation({
      totalResources: 4,
      validResources: 4,
      invalidResources: 0,
      summary: { warnings: 1 },
    });
    expect(r.tone).toBe("success");
    expect(r.detail).toContain("1 minor");
  });
});

describe("countBundleResources", () => {
  it("counts entries by resource type", () => {
    const bundle = {
      entry: [
        { resource: { resourceType: "Patient" } },
        { resource: { resourceType: "Observation" } },
        { resource: { resourceType: "Observation" } },
        { resource: {} },
        null,
      ],
    };
    expect(countBundleResources(bundle)).toEqual({ Patient: 1, Observation: 2 });
  });

  it("returns {} for anything that is not a bundle", () => {
    expect(countBundleResources(null)).toEqual({});
    expect(countBundleResources({ entry: "x" })).toEqual({});
  });
});

describe("EXPORT_SECTIONS", () => {
  it("has one entry per exporter option", () => {
    expect(EXPORT_SECTIONS.map((s) => s.key).sort()).toEqual([
      "includeAllergies",
      "includeConsultations",
      "includeEncounters",
      "includeMedications",
      "includePatient",
      "includeVitals",
    ]);
  });
});

describe("exportErrorMessage", () => {
  it("explains a record missing from this device", () => {
    expect(
      exportErrorMessage("Patient not found in local database"),
    ).toContain("not saved on this device");
  });

  it("uses a generic message otherwise", () => {
    expect(exportErrorMessage("Dexie blew up")).toContain("Nothing was downloaded");
    expect(exportErrorMessage(undefined)).toContain("Nothing was downloaded");
  });

  it("does not tell someone to connect when the online service already failed", () => {
    const missing = exportErrorMessage("Patient not found in local database", {
      fellBack: true,
    });
    expect(missing).toContain("online service could not be reached");
    expect(missing).not.toContain("Connect to the internet");
    expect(exportErrorMessage(undefined, { fellBack: true })).toContain(
      "Nothing was downloaded",
    );
  });
});
