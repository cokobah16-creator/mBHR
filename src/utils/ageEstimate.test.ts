import { describe, it, expect } from "vitest";
import { estimateDobFromAge } from "./ageEstimate";
import { patientAge } from "./patient";

const today = new Date(2026, 8, 25, 10, 0); // 25 Sep 2026, local time

describe("estimateDobFromAge", () => {
  it("keeps 1 January of the birth year for an age in years", () => {
    expect(estimateDobFromAge(25, "years", today)).toBe("2001-01-01");
    expect(estimateDobFromAge(1, "years", today)).toBe("2025-01-01");
    expect(patientAge("2001-01-01", today)).toBe(25);
  });

  it("registers babies under one by months", () => {
    expect(estimateDobFromAge(0, "months", today)).toBe("2026-09-01");
    expect(estimateDobFromAge(3, "months", today)).toBe("2026-06-01");
    expect(estimateDobFromAge(11, "months", today)).toBe("2025-10-01");
    expect(estimateDobFromAge(23, "months", today)).toBe("2024-10-01");
  });

  it("counts months back across the new year", () => {
    const january = new Date(2026, 0, 31, 10, 0);
    expect(estimateDobFromAge(1, "months", january)).toBe("2025-12-01");
    expect(estimateDobFromAge(13, "months", january)).toBe("2024-12-01");
  });

  it("never gives a date after today", () => {
    for (let m = 0; m <= 23; m++) {
      const dob = estimateDobFromAge(m, "months", today) as string;
      const [y, mo, d] = dob.split("-").map(Number);
      expect(new Date(y, mo - 1, d).getTime()).toBeLessThanOrEqual(today.getTime());
    }
  });

  it("refuses ages it cannot use", () => {
    expect(estimateDobFromAge(0, "years", today)).toBeNull();
    expect(estimateDobFromAge(121, "years", today)).toBeNull();
    expect(estimateDobFromAge(2.5, "years", today)).toBeNull();
    expect(estimateDobFromAge(-1, "months", today)).toBeNull();
    expect(estimateDobFromAge(24, "months", today)).toBeNull();
    expect(estimateDobFromAge(Number.NaN, "months", today)).toBeNull();
  });
});
