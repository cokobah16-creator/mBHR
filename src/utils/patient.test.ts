import { describe, it, expect } from "vitest";
import { formatPatientId, isMinor, patientAge } from "./patient";

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

  it("reads a date of birth as a calendar day, not midnight UTC", () => {
    // Same answer in every time zone: the birthday is the 24th.
    expect(patientAge("2008-09-24", new Date(2026, 8, 23, 23, 59))).toBe(17);
    expect(patientAge("2008-09-24", new Date(2026, 8, 24, 0, 0))).toBe(18);
  });

  it("refuses a date that does not exist", () => {
    const now = new Date("2026-09-22T12:00:00");
    expect(patientAge("2010-02-30", now)).toBeNull();
    expect(patientAge("2010-13-01", now)).toBeNull();
  });
});

describe("isMinor", () => {
  const now = new Date(2026, 8, 24, 12, 0); // 24 September 2026, local time

  it("counts someone who is 17 years and 364 days old as a minor", () => {
    expect(isMinor("2008-09-25", now)).toBe(true);
  });

  it("counts someone as an adult from their 18th birthday", () => {
    expect(isMinor("2008-09-24", now)).toBe(false);
    expect(isMinor("1990-01-01", now)).toBe(false);
  });

  it("counts a young child as a minor", () => {
    expect(isMinor("2026-09-24", now)).toBe(true);
    expect(isMinor("2016-03-01", now)).toBe(true);
  });

  it("returns null when the date of birth is missing or unusable", () => {
    expect(isMinor(undefined, now)).toBeNull();
    expect(isMinor(null, now)).toBeNull();
    expect(isMinor("", now)).toBeNull();
    expect(isMinor("not-a-date", now)).toBeNull();
    expect(isMinor("2010-02-30", now)).toBeNull();
  });

  it("returns null for a date of birth in the future", () => {
    expect(isMinor("2026-09-25", now)).toBeNull();
    expect(isMinor("2030-01-01", now)).toBeNull();
  });

  it("takes another threshold when given one", () => {
    expect(isMinor("2010-09-24", now, 16)).toBe(false);
    expect(isMinor("2010-09-25", now, 16)).toBe(true);
  });
});
