import { describe, it, expect } from "vitest";
import {
  compareWorklist,
  countByFilter,
  deriveLabStage,
  describeLabError,
  formatResultValue,
  interpretationMeta,
  isInterpretation,
  isLabFilter,
  matchesFilter,
  matchesSearch,
  orderOutcomeMeta,
  releaseStateOf,
  resultsAwaitingRelease,
  resultsToRelease,
  resultsWithholdable,
  severityOf,
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
      release: 1,
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

describe("release state", () => {
  const releasedAt = new Date("2026-09-02T10:00:00Z");
  const withheldAt = new Date("2026-09-02T11:00:00Z");

  it("reads each result's review and release markers", () => {
    expect(releaseStateOf(unreviewed)).toBe("not_reviewed");
    expect(releaseStateOf(reviewed)).toBe("not_released");
    expect(releaseStateOf({ ...reviewed, releasedToPatientAt: releasedAt })).toBe("released");
    expect(releaseStateOf({ ...reviewed, withheldAt })).toBe("withheld");
  });

  it("never calls an unreviewed result released, whatever the other fields say", () => {
    expect(releaseStateOf({ ...unreviewed, releasedToPatientAt: releasedAt })).toBe(
      "not_reviewed",
    );
  });

  it("puts reviewed results without a release decision in their own stage", () => {
    expect(deriveLabStage({ status: "completed" }, [reviewed])).toBe("reviewed");
    expect(
      deriveLabStage({ status: "completed" }, [
        { ...reviewed, releasedToPatientAt: releasedAt },
        reviewed,
      ]),
    ).toBe("reviewed");
  });

  it("is released only when every current result is released", () => {
    expect(
      deriveLabStage({ status: "completed" }, [
        { ...reviewed, releasedToPatientAt: releasedAt },
      ]),
    ).toBe("released");
  });

  it("shows withheld when any decided result is withheld", () => {
    expect(
      deriveLabStage({ status: "completed" }, [
        { ...reviewed, releasedToPatientAt: releasedAt },
        { ...reviewed, withheldAt },
      ]),
    ).toBe("withheld");
  });

  it("ignores a superseded result when deciding the release stage", () => {
    expect(
      deriveLabStage({ status: "completed" }, [
        { ...reviewed, supersededBy: "r2" },
        { ...reviewed, releasedToPatientAt: releasedAt },
      ]),
    ).toBe("released");
  });

  it("an unreviewed result still wins over any release state", () => {
    expect(
      deriveLabStage({ status: "completed" }, [
        { ...reviewed, releasedToPatientAt: releasedAt },
        unreviewed,
      ]),
    ).toBe("awaiting_review");
  });

  it("lists the results a release or withhold would act on", () => {
    const a = { id: "a", ...reviewed };
    const b = { id: "b", ...reviewed, releasedToPatientAt: releasedAt };
    const c = { id: "c", ...reviewed, withheldAt };
    const d = { id: "d", ...unreviewed };
    expect(resultsAwaitingRelease([a, b, c, d]).map((r) => r.id)).toEqual(["a"]);
    expect(resultsWithholdable([a, b, c, d]).map((r) => r.id)).toEqual(["a", "b", "d"]);
  });

  it("never releases a withheld result together with new ones", () => {
    const fresh = { id: "fresh", ...reviewed };
    const kept = { id: "kept", ...reviewed, withheldAt };
    const shown = { id: "shown", ...reviewed, releasedToPatientAt: releasedAt };
    const old = { id: "old", ...reviewed, supersededBy: "fresh" };
    const pending = { id: "pending", ...unreviewed };
    expect(resultsToRelease([fresh, kept, shown, old, pending]).map((r) => r.id)).toEqual([
      "fresh",
    ]);
    // Only when nothing else is waiting is the withheld result offered.
    expect(resultsToRelease([kept, shown, old]).map((r) => r.id)).toEqual(["kept"]);
    expect(resultsToRelease([shown, old, pending])).toEqual([]);
  });

  it("filters the reviewed-not-released bucket separately from finished work", () => {
    expect(matchesFilter("reviewed", "release")).toBe(true);
    expect(matchesFilter("released", "release")).toBe(false);
    expect(matchesFilter("withheld", "release")).toBe(false);
    expect(matchesFilter("released", "reviewed")).toBe(true);
    expect(matchesFilter("withheld", "reviewed")).toBe(true);
    expect(matchesFilter("released", "open")).toBe(false);
    expect(matchesFilter("withheld", "open")).toBe(false);
  });

  it("sorts reviewed-not-released before released or withheld work", () => {
    const base = { priority: "routine" as const, severity: "normal" as const };
    const released: WorklistSortable = { ...base, stage: "released" };
    const notReleased: WorklistSortable = { ...base, stage: "reviewed" };
    const cancelled: WorklistSortable = { ...base, stage: "cancelled", severity: null };
    expect([cancelled, released, notReleased].sort(compareWorklist)).toEqual([
      notReleased,
      released,
      cancelled,
    ]);
  });
});

describe("unknown interpretations need attention", () => {
  it("maps anything but the three values to unknown", () => {
    expect(severityOf("critical")).toBe("critical");
    expect(severityOf(null)).toBe("unknown");
    expect(severityOf(undefined)).toBe("unknown");
    expect(severityOf("High")).toBe("unknown");
  });

  it("never lets an unknown interpretation hide behind normal", () => {
    expect(
      worstInterpretation([{ interpretation: "normal" }, { interpretation: null }]),
    ).toBe("unknown");
    expect(worstInterpretation([{ interpretation: undefined }])).toBe("unknown");
  });

  it("keeps critical above unknown", () => {
    expect(
      worstInterpretation([{ interpretation: "bogus" }, { interpretation: "critical" }]),
    ).toBe("critical");
  });

  it("sorts an unknown interpretation above normal and below critical", () => {
    const base = { stage: "awaiting_review" as LabStage, priority: "routine" as const };
    const normal: WorklistSortable = { ...base, severity: "normal" };
    const unknown: WorklistSortable = { ...base, severity: "unknown" };
    const critical: WorklistSortable = { ...base, severity: "critical" };
    expect([normal, unknown, critical].sort(compareWorklist)).toEqual([
      critical,
      unknown,
      normal,
    ]);
  });

  it("labels an unknown value as needing a check, not as normal", () => {
    expect(interpretationMeta("normal").label).toBe("Normal");
    expect(interpretationMeta(null).label).toMatch(/check/i);
    expect(interpretationMeta(null).tone).not.toBe("success");
  });
});

describe("describeLabError for review and release", () => {
  it("explains a server refusal by its reason", () => {
    const err = Object.assign(new Error("x"), {
      name: "LabServiceError",
      code: "REJECTED",
      reason: "not_reviewed",
    });
    expect(describeLabError(err, "Not released.")).toBe(
      "Not released. The result has not been reviewed yet. Review it first.",
    );
  });

  it("says when the server has not been updated for release yet", () => {
    const err = Object.assign(new Error("x"), { name: "LabServiceError", code: "PGRST202" });
    expect(describeLabError(err, "Not released.")).toMatch(/database update/);
  });

  it("falls back for an unknown refusal reason", () => {
    const err = Object.assign(new Error("x"), {
      name: "LabServiceError",
      code: "REJECTED",
      reason: "something_new",
    });
    expect(describeLabError(err, "Not saved.")).toMatch(/^Not saved\. The cloud refused/);
  });
});

describe("orderOutcomeMeta", () => {
  interface Outcome {
    resultValue: string;
    resultUnit?: string;
    interpretation?: unknown;
    reviewedAt?: Date;
    supersededBy?: string;
  }
  const result = (over: Partial<Outcome> = {}): Outcome => ({
    resultValue: "4.8",
    resultUnit: "g/dL",
    interpretation: "critical",
    ...over,
  });

  it("shows a critical result, not a plain Completed", () => {
    const meta = orderOutcomeMeta({ status: "completed" }, [result()]);
    expect(meta.tone).toBe("critical");
    expect(meta.label).toBe("Critical: 4.8 g/dL · not reviewed");
  });

  it("shows the most severe current result", () => {
    const meta = orderOutcomeMeta({ status: "completed" }, [
      result({ interpretation: "normal", resultValue: "12" }),
      result({ reviewedAt: new Date() }),
    ]);
    expect(meta.label).toBe("Critical: 4.8 g/dL · not reviewed");
    const reviewed = orderOutcomeMeta({ status: "completed" }, [
      result({ reviewedAt: new Date() }),
    ]);
    expect(reviewed.label).toBe("Critical: 4.8 g/dL");
  });

  it("ignores a superseded result when a newer one exists", () => {
    const meta = orderOutcomeMeta({ status: "completed" }, [
      result({ supersededBy: "r2" }),
      result({ interpretation: "normal", resultValue: "11.9", reviewedAt: new Date() }),
    ]);
    expect(meta).toEqual({ label: "Normal: 11.9 g/dL", tone: "success" });
  });

  it("never shows a missing interpretation as normal", () => {
    const meta = orderOutcomeMeta({ status: "completed" }, [
      result({ interpretation: undefined }),
    ]);
    expect(meta.tone).toBe("warning");
  });

  it("falls back to the order status without results", () => {
    expect(orderOutcomeMeta({ status: "processing" }, [])).toEqual({
      label: "Processing",
      tone: "info",
    });
  });
});
