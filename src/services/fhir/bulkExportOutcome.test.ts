import { describe, it, expect } from "vitest";
import { bulkExportOutcome } from "./bulkExportOutcome";

describe("bulkExportOutcome", () => {
  it("succeeds when every patient was exported", () => {
    expect(
      bulkExportOutcome({ totalPatients: 3, exportedPatients: 3, failedPatients: 0 }),
    ).toEqual({ success: true });
  });

  it("succeeds with nothing to export", () => {
    expect(
      bulkExportOutcome({ totalPatients: 0, exportedPatients: 0, failedPatients: 0 }),
    ).toEqual({ success: true });
  });

  it("warns when some patients were left out", () => {
    const outcome = bulkExportOutcome({
      totalPatients: 10,
      exportedPatients: 8,
      failedPatients: 2,
    });
    expect(outcome.success).toBe(true);
    expect(outcome.error).toBeUndefined();
    expect(outcome.warning).toBe(
      "2 patients could not be exported and are not in the files. 8 patients exported.",
    );
  });

  it("uses singular wording for one patient", () => {
    const outcome = bulkExportOutcome({
      totalPatients: 2,
      exportedPatients: 1,
      failedPatients: 1,
    });
    expect(outcome.warning).toBe(
      "1 patient could not be exported and is not in the files. 1 patient exported.",
    );
  });

  it("fails when no patient could be exported", () => {
    const outcome = bulkExportOutcome({
      totalPatients: 4,
      exportedPatients: 0,
      failedPatients: 4,
    });
    expect(outcome.success).toBe(false);
    expect(outcome.error).toMatch(/No patient records could be exported/);
    expect(outcome.error).toContain("4 patients failed");
  });
});
