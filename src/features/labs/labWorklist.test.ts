import { describe, it, expect } from "vitest";
import {
  compareWorklist,
  countByFilter,
  deriveLabStage,
  describeLabError,
  formatResultValue,
  isInterpretation,
  isLabFilter,
  matchesFilter,
  matchesSearch,
  worstInterpretation,
  worstUnreviewed,
  type LabStage,
  type WorklistSortable,
} from "./labWorklist";

const reviewed = { reviewedAt: new Date("2026-09-01T10:00:00Z") };
const unreviewed = { reviewedAt: undefined };

describe("deriveLabStage", () => {
  it("follows the stored status while there is no result", () => {
    expect(deriveLabStage({ status: "ordered" }, [])).toBe("ordered");
    expect(deriveLabStage({ status: "collected" }, [])).toBe("collected");
    expect(deriveLabStage({ status: "processing" }, [])).toBe("processing");
  });

  it("flags a completed order with no stored result instead of calling it resulted", () => {
    expect(deriveLabStage({ status: "completed" }, [])).toBe("no_result");
  });

  it("is awaiting review while any result has no reviewed marker", () => {
    expect(deriveLabStage({ status: "completed" }, [unreviewed])).toBe("awaiting_review");
    expect(deriveLabStage({ status: "completed" }, [reviewed, unreviewed])).toBe(
      "awaiting_review",
    );
  });

  it("is reviewed only when every result has a reviewed marker", () => {
    expect(deriveLabStage({ status: "completed" }, [reviewed, reviewed])).toBe("reviewed");
  });

  it("shows a stored result even if the status update after it failed", () => {
    expect(deriveLabStage({ status: "processing" }, [unreviewed])).toBe("awaiting_review");
  });

  it("keeps cancelled orders cancelled once nothing is left to review", () => {
    expect(deriveLabStage({ status: "cancelled" }, [])).toBe("cancelled");
    expect(deriveLabStage({ status: "cancelled" }, [reviewed])).toBe("cancelled");
  });

  it("keeps an unreviewed result in review even if its order was cancelled", () => {
    expect(deriveLabStage({ status: "cancelled" }, [unreviewed])).toBe("awaiting_review");
    expect(deriveLabStage({ status: "cancelled" }, [reviewed, unreviewed])).toBe(
      "awaiting_review",
    );
  });
});

describe("worstInterpretation / worstUnreviewed", () => {
  it("returns the most severe stored interpretation", () => {
    expect(worstInterpretation([])).toBeNull();
    expect(
      worstInterpretation([
        { interpretation: "normal" },
        { interpretation: "critical" },
        { interpretation: "abnormal" },
      ]),
    ).toBe("critical");
  });

  it("ignores results already reviewed", () => {
    expect(
      worstUnreviewed([
        { interpretation: "critical", ...reviewed },
        { interpretation: "abnormal", ...unreviewed },
      ]),
    ).toBe("abnormal");
  });
});

describe("filters", () => {
  const stages: LabStage[] = [
    "ordered",
    "collected",
    "processing",
    "awaiting_review",
    "awaiting_review",
    "reviewed",
    "no_result",
    "cancelled",
  ];

  it("counts each filter from the derived stages", () => {
    expect(countByFilter(stages)).toEqual({
      open: 6,
      review: 2,
      ordered: 1,
      collected: 1,
      processing: 1,
      reviewed: 1,
      cancelled: 1,
      all: 8,
    });
  });

  it("keeps finished work out of the open queue", () => {
    expect(matchesFilter("reviewed", "open")).toBe(false);
    expect(matchesFilter("cancelled", "open")).toBe(false);
    expect(matchesFilter("no_result", "open")).toBe(true);
  });

  it("recognises filter ids", () => {
    expect(isLabFilter("review")).toBe(true);
    expect(isLabFilter("resulted")).toBe(false);
  });
});

describe("compareWorklist", () => {
  const base = (over: Partial<WorklistSortable>): WorklistSortable => ({
    stage: "ordered",
    severity: null,
    priority: "routine",
    ...over,
  });

  it("puts critical then abnormal results first among results awaiting review", () => {
    const normal = base({ stage: "awaiting_review", severity: "normal" });
    const abnormal = base({ stage: "awaiting_review", severity: "abnormal" });
    const critical = base({ stage: "awaiting_review", severity: "critical" });
    const sorted = [normal, abnormal, critical].sort(compareWorklist);
    expect(sorted).toEqual([critical, abnormal, normal]);
  });

  it("lists results awaiting review before open orders, and finished work last", () => {
    const stat = base({ stage: "ordered", priority: "stat" });
    const review = base({ stage: "awaiting_review", severity: "normal" });
    const done = base({ stage: "reviewed", severity: "critical" });
    const cancelled = base({ stage: "cancelled" });
    const sorted = [cancelled, done, stat, review].sort(compareWorklist);
    expect(sorted).toEqual([review, stat, done, cancelled]);
  });

  it("orders open work by priority, then longest waiting", () => {
    const routineOld = base({ priority: "routine", orderedAt: new Date("2026-09-01T08:00:00Z") });
    const routineNew = base({ priority: "routine", orderedAt: new Date("2026-09-01T09:00:00Z") });
    const urgent = base({ stage: "collected", priority: "urgent", orderedAt: new Date("2026-09-01T10:00:00Z") });
    const stat = base({ stage: "processing", priority: "stat", orderedAt: new Date("2026-09-01T11:00:00Z") });
    const sorted = [routineNew, urgent, routineOld, stat].sort(compareWorklist);
    expect(sorted).toEqual([stat, urgent, routineOld, routineNew]);
  });

  it("sorts reviewed results by severity, then newest", () => {
    const older = base({ stage: "reviewed", severity: "normal", resultAt: new Date("2026-09-01T08:00:00Z") });
    const newer = base({ stage: "reviewed", severity: "normal", resultAt: new Date("2026-09-02T08:00:00Z") });
    const abnormal = base({ stage: "reviewed", severity: "abnormal", resultAt: new Date("2026-08-01T08:00:00Z") });
    expect([older, newer, abnormal].sort(compareWorklist)).toEqual([abnormal, newer, older]);
  });
});

describe("matchesSearch", () => {
  const fields = ["Ada Testpatient", "Complete Blood Count (CBC)", "CBC", null, undefined];

  it("matches every word against any field, ignoring case", () => {
    expect(matchesSearch(fields, "")).toBe(true);
    expect(matchesSearch(fields, "testpatient")).toBe(true);
    expect(matchesSearch(fields, "ada cbc")).toBe(true);
    expect(matchesSearch(fields, "ada malaria")).toBe(false);
  });
});

describe("formatResultValue", () => {
  it("adds the unit only when one is stored", () => {
    expect(formatResultValue({ resultValue: "12.5", resultUnit: "g/dL" })).toBe("12.5 g/dL");
    expect(formatResultValue({ resultValue: "Positive", resultUnit: undefined })).toBe("Positive");
    expect(formatResultValue({ resultValue: "7", resultUnit: "  " })).toBe("7");
  });
});

describe("describeLabError", () => {
  it("explains missing cloud sync", () => {
    const err = Object.assign(new Error("x"), { name: "LabsUnavailableError" });
    expect(describeLabError(err, "Nothing was saved.")).toContain("cloud sync");
  });

  it("explains a refused change without blaming the user", () => {
    const err = Object.assign(new Error("x"), { name: "LabServiceError", code: "42501" });
    expect(describeLabError(err, "Nothing was saved.")).toMatch(/^Nothing was saved\. The cloud did not accept/);
  });

  it("uses the action's hint for a missing linked record", () => {
    const err = Object.assign(new Error("x"), { name: "LabServiceError", code: "23503" });
    expect(describeLabError(err, "Not sent.", "Sync first.")).toBe("Not sent. Sync first.");
  });

  it("falls back to a connection hint", () => {
    expect(describeLabError(new Error("boom"), "Not sent.")).toBe(
      "Not sent. Check the connection and try again.",
    );
  });
});

describe("isInterpretation", () => {
  it("accepts only a deliberately chosen interpretation", () => {
    expect(isInterpretation("normal")).toBe(true);
    expect(isInterpretation("abnormal")).toBe(true);
    expect(isInterpretation("critical")).toBe(true);
  });

  it("rejects empty, missing or unknown values instead of treating them as normal", () => {
    expect(isInterpretation("")).toBe(false);
    expect(isInterpretation(undefined)).toBe(false);
    expect(isInterpretation(null)).toBe(false);
    expect(isInterpretation("Normal")).toBe(false);
    expect(isInterpretation("high")).toBe(false);
  });
});

describe("severity is never downgraded to normal", () => {
  it("keeps the worst interpretation when a normal result follows an abnormal or critical one", () => {
    expect(
      worstInterpretation([{ interpretation: "critical" }, { interpretation: "normal" }]),
    ).toBe("critical");
    expect(
      worstInterpretation([{ interpretation: "normal" }, { interpretation: "abnormal" }]),
    ).toBe("abnormal");
  });

  it("sorts an unreviewed critical result ahead of an unreviewed normal one", () => {
    const base = { stage: "awaiting_review" as LabStage, priority: "routine" as const };
    const critical: WorklistSortable = { ...base, severity: "critical" };
    const normal: WorklistSortable = { ...base, severity: "normal" };
    expect([normal, critical].sort(compareWorklist)[0]).toBe(critical);
  });
});
