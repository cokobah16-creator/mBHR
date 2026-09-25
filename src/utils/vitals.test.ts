import { describe, it, expect } from "vitest";
import {
  adultVitalRangesApply,
  assessVitals,
  calculateBMI,
  enteredMeasurements,
  flagVitals,
  getFlagColor,
  getFlagLabel,
  getFlagTone,
  hasVitalsEntries,
  isAbnormalVitalFlag,
  PAEDIATRIC_CHECK_FLAG,
  parseMeasurement,
} from "./vitals";
import { vitalsSchema } from "../validation/schemas";

describe("vitals utilities", () => {
  describe("calculateBMI", () => {
    it("should calculate BMI correctly for normal values", () => {
      const bmi = calculateBMI(70, 175);
      expect(bmi).toBeCloseTo(22.9, 1);
    });

    it("should return 0 for zero height", () => {
      expect(calculateBMI(70, 0)).toBe(0);
    });

    it("should return 0 for negative height", () => {
      expect(calculateBMI(70, -175)).toBe(0);
    });

    it("should return 0 for zero weight", () => {
      expect(calculateBMI(0, 175)).toBe(0);
    });

    it("should return 0 for negative weight", () => {
      expect(calculateBMI(-70, 175)).toBe(0);
    });

    it("should round to one decimal place", () => {
      const bmi = calculateBMI(68, 170);
      const decimalPlaces = (bmi.toString().split(".")[1] || "").length;
      expect(decimalPlaces).toBeLessThanOrEqual(1);
    });

    it("should calculate underweight BMI correctly", () => {
      const bmi = calculateBMI(45, 175);
      expect(bmi).toBeLessThan(18.5);
    });

    it("should calculate obese BMI correctly", () => {
      const bmi = calculateBMI(110, 175);
      expect(bmi).toBeGreaterThanOrEqual(30);
    });
  });

  describe("flagVitals", () => {
    describe("blood pressure flags", () => {
      it("should flag high BP when systolic >= 140", () => {
        const flags = flagVitals({ systolic: 140, diastolic: 80 });
        expect(flags).toContain("high_bp");
      });

      it("should flag high BP when diastolic >= 90", () => {
        const flags = flagVitals({ systolic: 120, diastolic: 90 });
        expect(flags).toContain("high_bp");
      });

      it("should flag low BP when systolic < 90", () => {
        const flags = flagVitals({ systolic: 85, diastolic: 70 });
        expect(flags).toContain("low_bp");
      });

      it("should flag low BP when diastolic < 60", () => {
        const flags = flagVitals({ systolic: 110, diastolic: 55 });
        expect(flags).toContain("low_bp");
      });

      it("should not flag normal BP", () => {
        const flags = flagVitals({ systolic: 120, diastolic: 80 });
        expect(flags).not.toContain("high_bp");
        expect(flags).not.toContain("low_bp");
      });
    });

    describe("temperature flags", () => {
      it("should flag high temperature >= 38.0", () => {
        const flags = flagVitals({ temperature: 38.0 });
        expect(flags).toContain("high_temp");
      });

      it("should flag low temperature < 35.0", () => {
        const flags = flagVitals({ temperature: 34.5 });
        expect(flags).toContain("low_temp");
      });

      it("should not flag normal temperature", () => {
        const flags = flagVitals({ temperature: 36.5 });
        expect(flags).not.toContain("high_temp");
        expect(flags).not.toContain("low_temp");
      });
    });

    describe("pulse flags", () => {
      it("should flag high pulse >= 100", () => {
        const flags = flagVitals({ pulse: 100 });
        expect(flags).toContain("high_pulse");
      });

      it("should flag low pulse < 60", () => {
        const flags = flagVitals({ pulse: 55 });
        expect(flags).toContain("low_pulse");
      });

      it("should not flag normal pulse", () => {
        const flags = flagVitals({ pulse: 72 });
        expect(flags).not.toContain("high_pulse");
        expect(flags).not.toContain("low_pulse");
      });
    });

    describe("SpO2 flags", () => {
      it("should flag low SpO2 < 95", () => {
        const flags = flagVitals({ spo2: 92 });
        expect(flags).toContain("low_spo2");
      });

      it("should not flag normal SpO2", () => {
        const flags = flagVitals({ spo2: 98 });
        expect(flags).not.toContain("low_spo2");
      });

      it("should not flag borderline SpO2 of 95", () => {
        const flags = flagVitals({ spo2: 95 });
        expect(flags).not.toContain("low_spo2");
      });
    });

    describe("BMI flags", () => {
      it("should flag low BMI < 18.5 (underweight)", () => {
        const flags = flagVitals({ bmi: 17.5 });
        expect(flags).toContain("low_bmi");
      });

      it("should flag high BMI >= 30 (obese)", () => {
        const flags = flagVitals({ bmi: 32 });
        expect(flags).toContain("high_bmi");
      });

      it("should not flag normal BMI", () => {
        const flags = flagVitals({ bmi: 24 });
        expect(flags).not.toContain("low_bmi");
        expect(flags).not.toContain("high_bmi");
      });

      it("should not flag overweight but non-obese BMI", () => {
        const flags = flagVitals({ bmi: 28 });
        expect(flags).not.toContain("high_bmi");
      });
    });

    describe("multiple flags", () => {
      it("should return multiple flags for critical patient", () => {
        const flags = flagVitals({
          systolic: 180,
          diastolic: 110,
          temperature: 39.5,
          pulse: 120,
          spo2: 88,
          bmi: 35,
        });

        expect(flags).toContain("high_bp");
        expect(flags).toContain("high_temp");
        expect(flags).toContain("high_pulse");
        expect(flags).toContain("low_spo2");
        expect(flags).toContain("high_bmi");
        expect(flags.length).toBe(5);
      });

      it("should return empty array for healthy vitals", () => {
        const flags = flagVitals({
          systolic: 120,
          diastolic: 80,
          temperature: 36.6,
          pulse: 72,
          spo2: 98,
          bmi: 22,
        });

        expect(flags).toHaveLength(0);
      });
    });

    describe("undefined values", () => {
      it("should handle all undefined values", () => {
        const flags = flagVitals({});
        expect(flags).toHaveLength(0);
      });

      it("should only check defined values", () => {
        const flags = flagVitals({ systolic: 150 });
        expect(flags).toContain("high_bp");
        expect(flags).toHaveLength(1);
      });
    });
  });

  describe("getFlagColor", () => {
    it("should return red colors for critical flags", () => {
      const criticalFlags = [
        "high_bp",
        "low_bp",
        "high_temp",
        "low_temp",
        "high_pulse",
        "low_pulse",
        "low_spo2",
      ];

      criticalFlags.forEach((flag) => {
        const color = getFlagColor(flag);
        expect(color).toContain("red");
      });
    });

    it("should return yellow colors for BMI flags", () => {
      expect(getFlagColor("low_bmi")).toContain("yellow");
      expect(getFlagColor("high_bmi")).toContain("yellow");
    });

    it("should return gray for unknown flags", () => {
      expect(getFlagColor("unknown_flag")).toContain("gray");
    });
  });

  describe("getFlagLabel", () => {
    it("should return correct labels for all flags", () => {
      expect(getFlagLabel("high_bp")).toBe("High BP");
      expect(getFlagLabel("low_bp")).toBe("Low BP");
      expect(getFlagLabel("high_temp")).toBe("Fever");
      expect(getFlagLabel("low_temp")).toBe("Hypothermia");
      expect(getFlagLabel("high_pulse")).toBe("High HR");
      expect(getFlagLabel("low_pulse")).toBe("Low HR");
      expect(getFlagLabel("low_spo2")).toBe("Low O2");
      expect(getFlagLabel("low_bmi")).toBe("Underweight");
      expect(getFlagLabel("high_bmi")).toBe("Obese");
    });

    it("should return flag name for unknown flags", () => {
      expect(getFlagLabel("unknown_flag")).toBe("unknown_flag");
    });
  });
});

describe("clinical classification", () => {
  it("labels BMI with WHO categories", async () => {
    const { classifyBMI } = await import("./vitals");
    expect(classifyBMI(27.4)).toEqual({ label: "Overweight", tone: "warning" });
    expect(classifyBMI(22)).toEqual({ label: "Normal", tone: "success" });
    expect(classifyBMI(17)?.label).toBe("Underweight");
    expect(classifyBMI(31)?.label).toBe("Obese");
    expect(classifyBMI(0)).toBeNull();
  });

  it("escalates severely elevated blood pressure", async () => {
    const { classifyBloodPressure } = await import("./vitals");
    expect(classifyBloodPressure(178, 112)?.tone).toBe("danger");
    expect(classifyBloodPressure(182, 100)).toEqual({
      label: "Severely elevated",
      tone: "critical",
    });
    expect(classifyBloodPressure(118, 76)?.label).toBe("Normal");
    expect(classifyBloodPressure(85, 55)?.label).toBe("Low");
    expect(classifyBloodPressure(undefined, undefined)).toBeNull();
  });

  it("keeps flag tones consistent with flagVitals codes", async () => {
    const { getFlagTone } = await import("./vitals");
    expect(getFlagTone("high_bp")).toBe("danger");
    expect(getFlagTone("high_bmi")).toBe("warning");
    expect(getFlagTone("something_else")).toBe("neutral");
  });
});

describe("assessVitals", () => {
  it("computes BMI from height and weight in the right order", async () => {
    const { assessVitals } = await import("./vitals");
    const { bmi } = assessVitals({ heightCm: 170, weightKg: 70 });
    expect(bmi).toBeCloseTo(24.2, 1);
  });

  it("flags fever, tachycardia and low SpO2 from record field names", async () => {
    const { assessVitals } = await import("./vitals");
    const { flags } = assessVitals({ tempC: 38.6, pulseBpm: 112, spo2: 91 });
    expect(flags).toContain("high_temp");
    expect(flags).toContain("high_pulse");
    expect(flags).toContain("low_spo2");
  });

  it("returns no BMI without both measurements", async () => {
    const { assessVitals } = await import("./vitals");
    expect(assessVitals({ heightCm: 170 }).bmi).toBeNull();
  });
});

describe("resolveBmi", () => {
  it("corrects a BMI stored with height and weight swapped", async () => {
    const { resolveBmi } = await import("./vitals");
    // 170 cm / 70 kg was previously stored as ~346.9
    expect(resolveBmi({ heightCm: 170, weightKg: 70, bmi: 346.9 })).toBeCloseTo(24.2, 1);
  });

  it("drops an implausible stored BMI when it cannot be recomputed", async () => {
    const { resolveBmi } = await import("./vitals");
    expect(resolveBmi({ bmi: 346.9 })).toBeUndefined();
    expect(resolveBmi({ bmi: 23.1 })).toBe(23.1);
  });
});

describe("adult thresholds and the patient's age", () => {
  const now = new Date("2026-09-25T10:00:00");

  it("applies adult thresholds from 18", () => {
    expect(adultVitalRangesApply("2008-09-20", now)).toBe(true);
    expect(adultVitalRangesApply("2008-09-30", now)).toBe(false);
    expect(adultVitalRangesApply("2021-03-01", now)).toBe(false);
  });

  it("uses the age when the reading was taken", () => {
    expect(adultVitalRangesApply("2006-01-01", "2022-06-01T09:00:00Z")).toBe(false);
    expect(adultVitalRangesApply("2006-01-01", new Date("2026-06-01T09:00:00Z"))).toBe(true);
  });

  it("never treats an unknown age as adult", () => {
    expect(adultVitalRangesApply("", now)).toBe(false);
    expect(adultVitalRangesApply(undefined, now)).toBe(false);
    expect(adultVitalRangesApply(null, now)).toBe(false);
    expect(adultVitalRangesApply("not-a-date", now)).toBe(false);
  });

  it("marks a child's reading for a paediatric chart check instead of adult flags", () => {
    const { bmi, flags } = assessVitals(
      { pulseBpm: 130, tempC: 36.8, systolic: 95, diastolic: 55, heightCm: 110, weightKg: 19 },
      { adultRanges: false },
    );
    expect(flags).toEqual([PAEDIATRIC_CHECK_FLAG]);
    expect(flags).not.toContain("high_pulse");
    expect(flags).not.toContain("low_bp");
    expect(bmi).toBeCloseTo(15.7, 1);
  });

  it("marks a child's reading even when adult thresholds would call it normal", () => {
    expect(assessVitals({ pulseBpm: 72 }, { adultRanges: false }).flags).toEqual([
      PAEDIATRIC_CHECK_FLAG,
    ]);
  });

  it("still flags a child's low oxygen with the unchanged threshold", () => {
    const { flags } = assessVitals({ spo2: 82 }, { adultRanges: false });
    expect(flags).toContain("low_spo2");
    expect(flags).toContain(PAEDIATRIC_CHECK_FLAG);
    expect(flags.filter(isAbnormalVitalFlag)).toEqual(["low_spo2"]);
    expect(assessVitals({ spo2: 95 }, { adultRanges: false }).flags).toEqual([
      PAEDIATRIC_CHECK_FLAG,
    ]);
  });

  it("still flags a child's fever and low temperature with the unchanged thresholds", () => {
    expect(assessVitals({ spo2: 82, tempC: 40 }, { adultRanges: false }).flags).toEqual([
      "high_temp",
      "low_spo2",
      PAEDIATRIC_CHECK_FLAG,
    ]);
    expect(assessVitals({ tempC: 34.5 }, { adultRanges: false }).flags).toEqual([
      "low_temp",
      PAEDIATRIC_CHECK_FLAG,
    ]);
    expect(assessVitals({ tempC: 37.9 }, { adultRanges: false }).flags).toEqual([
      PAEDIATRIC_CHECK_FLAG,
    ]);
  });

  it("drops only the adult heart-rate, blood-pressure and BMI flags for a child", () => {
    const reading = {
      pulseBpm: 150,
      systolic: 150,
      diastolic: 95,
      heightCm: 100,
      weightKg: 40,
      spo2: 90,
      tempC: 38.5,
    };
    expect(assessVitals(reading).flags).toEqual([
      "high_bp",
      "high_temp",
      "high_pulse",
      "low_spo2",
      "high_bmi",
    ]);
    expect(assessVitals(reading, { adultRanges: false }).flags).toEqual([
      "high_temp",
      "low_spo2",
      PAEDIATRIC_CHECK_FLAG,
    ]);
  });

  it("does not count the paediatric check on its own as abnormal", () => {
    expect(isAbnormalVitalFlag(PAEDIATRIC_CHECK_FLAG)).toBe(false);
    expect([PAEDIATRIC_CHECK_FLAG].some(isAbnormalVitalFlag)).toBe(false);
    for (const flag of ["high_bp", "low_bp", "high_temp", "low_temp", "high_pulse", "low_pulse", "low_spo2", "low_bmi", "high_bmi"]) {
      expect(isAbnormalVitalFlag(flag)).toBe(true);
    }
  });

  it("adds no flag to a child's record without a reading to check", () => {
    expect(assessVitals({ heightCm: 110 }, { adultRanges: false }).flags).toEqual([]);
    expect(assessVitals({}, { adultRanges: false }).flags).toEqual([]);
  });

  it("keeps adult flags when adult thresholds apply", () => {
    expect(assessVitals({ pulseBpm: 130 }).flags).toEqual(["high_pulse"]);
    expect(assessVitals({ pulseBpm: 130 }, { adultRanges: true }).flags).toEqual(["high_pulse"]);
  });

  it("labels the paediatric check as a warning, never as normal", () => {
    expect(getFlagLabel(PAEDIATRIC_CHECK_FLAG)).toBe("Check paediatric chart");
    expect(getFlagTone(PAEDIATRIC_CHECK_FLAG)).toBe("warning");
    expect(getFlagColor(PAEDIATRIC_CHECK_FLAG)).toContain("yellow");
  });
});

describe("vitals form values", () => {
  it("reads an empty field as no measurement, not NaN or 0", () => {
    expect(parseMeasurement("")).toBeUndefined();
    expect(parseMeasurement("   ")).toBeUndefined();
    expect(parseMeasurement(undefined)).toBeUndefined();
    expect(parseMeasurement(null)).toBeUndefined();
    expect(parseMeasurement("36.6")).toBe(36.6);
    expect(parseMeasurement(72)).toBe(72);
  });

  it("keeps unreadable text as NaN so validation rejects it", () => {
    expect(parseMeasurement("abc")).toBeNaN();
    expect(vitalsSchema.safeParse({ tempC: parseMeasurement("abc") }).success).toBe(false);
  });

  it("accepts a reading with only some measurements entered", () => {
    const values = {
      heightCm: parseMeasurement(""),
      weightKg: parseMeasurement(""),
      tempC: parseMeasurement("37.2"),
      pulseBpm: parseMeasurement(""),
      systolic: parseMeasurement(""),
      diastolic: parseMeasurement(""),
      spo2: parseMeasurement("97"),
    };
    const parsed = vitalsSchema.safeParse(values);
    expect(parsed.success).toBe(true);
    expect(parsed.success && enteredMeasurements(parsed.data)).toEqual({ tempC: 37.2, spo2: 97 });
  });

  it("still rejects systolic at or below diastolic", () => {
    expect(vitalsSchema.safeParse({ systolic: 80, diastolic: 90 }).success).toBe(false);
  });

  it("leaves empty and unreadable fields out of the saved record", () => {
    const record = enteredMeasurements({
      tempC: 37.2,
      pulseBpm: undefined,
      spo2: Number.NaN,
      systolic: null,
    });
    expect(record).toEqual({ tempC: 37.2 });
    expect("pulseBpm" in record).toBe(false);
  });

  it("knows when something has been typed, so cancelling asks first", () => {
    expect(hasVitalsEntries({})).toBe(false);
    expect(hasVitalsEntries({ heightCm: undefined, weightKg: undefined })).toBe(false);
    expect(hasVitalsEntries({ spo2: 97 })).toBe(true);
    expect(hasVitalsEntries({ tempC: Number.NaN })).toBe(true);
  });
});
