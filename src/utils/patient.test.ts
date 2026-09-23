import { describe, it, expect } from "vitest";
import { formatPatientId, patientAge } from "./patient";

describe("patient display helpers", () => {
  it("formats a short stable id", () => {
    expect(formatPatientId("0f8fad5b-d9cb-469f-a165-70867728950e")).toBe(
      "MBHR-28950E",
    );
  });

  it("computes age in whole years", () => {
    const now = new Date("2026-09-22T12:00:00");
    expect(patientAge("1979-09-23", now)).toBe(46);
    expect(patientAge("1979-09-22", now)).toBe(47);
    expect(patientAge("", now)).toBeNull();
    expect(patientAge("not-a-date", now)).toBeNull();
  });
});
