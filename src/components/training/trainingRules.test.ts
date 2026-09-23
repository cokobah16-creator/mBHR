import { describe, it, expect } from "vitest";
import {
  EMPTY_ROUND_STATS,
  accuracyOf,
  badgeLabel,
  calledPatientOutcome,
  formatClock,
  knowledgeBlitzMultipliers,
  minutesBetween,
  multiplierText,
  percent,
  queueMaestroScore,
  recordAnswer,
  restockTapTokens,
  shuffled,
  triageSprintMultipliers,
  vitalsPrecisionMultipliers,
} from "./trainingRules";

describe("recordAnswer", () => {
  it("counts correct answers and tracks the running and longest streak", () => {
    let s = EMPTY_ROUND_STATS;
    s = recordAnswer(s, true);
    s = recordAnswer(s, true);
    s = recordAnswer(s, false);
    s = recordAnswer(s, true);
    expect(s).toEqual({ correct: 3, total: 4, streak: 1, maxStreak: 2 });
  });

  it("does not mutate the input", () => {
    const before = { ...EMPTY_ROUND_STATS };
    recordAnswer(EMPTY_ROUND_STATS, true);
    expect(EMPTY_ROUND_STATS).toEqual(before);
  });
});

describe("accuracy and percent", () => {
  it("is 0 rather than NaN when nothing was answered", () => {
    expect(accuracyOf({ correct: 0, total: 0 })).toBe(0);
    expect(percent(0, 0)).toBe(0);
  });

  it("rounds percentages", () => {
    expect(percent(2, 3)).toBe(67);
  });
});

describe("formatClock", () => {
  it("formats minutes and seconds", () => {
    expect(formatClock(125)).toBe("2:05");
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(-3)).toBe("0:00");
  });
});

describe("shuffled", () => {
  it("returns a permutation without changing the input", () => {
    const input = [1, 2, 3, 4, 5];
    const out = shuffled(input);
    expect(input).toEqual([1, 2, 3, 4, 5]);
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("game multipliers (unchanged rules)", () => {
  it("Knowledge Blitz: speed bonus at 10 or more seconds, streak bonus at 5", () => {
    expect(
      knowledgeBlitzMultipliers({ correct: 5, questionCount: 5, secondsLeft: 10, maxStreak: 5 }),
    ).toEqual({ accuracy: 1, speedBonus: 1.1, qualityBonus: 1.2 });
    expect(
      knowledgeBlitzMultipliers({ correct: 2, questionCount: 5, secondsLeft: 9, maxStreak: 4 }),
    ).toEqual({ accuracy: 0.4, speedBonus: 1, qualityBonus: 1 });
  });

  it("Triage Sprint: speed bonus only above 30 seconds, streak bonus at 3", () => {
    const allRight = { correct: 3, total: 3, streak: 3, maxStreak: 3 };
    expect(triageSprintMultipliers(allRight, 31)).toEqual({
      accuracy: 1,
      speedBonus: 1.1,
      qualityBonus: 1.2,
    });
    expect(triageSprintMultipliers(allRight, 30).speedBonus).toBe(1);
  });

  it("Vitals Precision: speed bonus only above 60 seconds, streak bonus at 8", () => {
    const stats = { correct: 8, total: 10, streak: 0, maxStreak: 8 };
    expect(vitalsPrecisionMultipliers(stats, 61)).toEqual({
      accuracy: 0.8,
      speedBonus: 1.1,
      qualityBonus: 1.2,
    });
    expect(vitalsPrecisionMultipliers(stats, 60).speedBonus).toBe(1);
    expect(
      vitalsPrecisionMultipliers({ ...stats, maxStreak: 7 }, 0).qualityBonus,
    ).toBe(1);
  });
});

describe("queueMaestroScore", () => {
  it("gives 15 base tokens per patient", () => {
    expect(queueMaestroScore(3, 9).baseTokens).toBe(45);
  });

  it("applies the speed bands: <=4 min fast, <=6 neutral, slower penalised", () => {
    expect(queueMaestroScore(2, 8).speedBonus).toBe(1.2);
    expect(queueMaestroScore(2, 12).speedBonus).toBe(1);
    expect(queueMaestroScore(2, 12.2).speedBonus).toBe(0.8);
  });

  it("adds the volume bonus from 5 patients", () => {
    expect(queueMaestroScore(4, 4).volumeBonus).toBe(1);
    expect(queueMaestroScore(5, 5).volumeBonus).toBe(1.1);
  });

  it("does not divide by zero", () => {
    expect(queueMaestroScore(0, 0).averageMinutes).toBe(0);
  });
});

describe("minutesBetween", () => {
  it("measures real elapsed minutes to one decimal", () => {
    expect(
      minutesBetween("2026-01-01T10:00:00.000Z", new Date("2026-01-01T10:04:30.000Z")),
    ).toBe(4.5);
  });

  it("never goes negative and tolerates bad input", () => {
    expect(minutesBetween("2026-01-01T10:05:00Z", "2026-01-01T10:00:00Z")).toBe(0);
    expect(minutesBetween("not a date", "2026-01-01T10:00:00Z")).toBe(0);
  });
});

describe("calledPatientOutcome", () => {
  it("maps the live queue row to what happened to the called patient", () => {
    expect(calledPatientOutcome(undefined)).toBe("missing");
    expect(calledPatientOutcome({ status: "in_progress" })).toBe("serving");
    expect(calledPatientOutcome({ status: "done" })).toBe("finished");
    expect(calledPatientOutcome({ status: "waiting" })).toBe("returned");
  });

  it("ignores a stale waiting snapshot from before the patient was called", () => {
    const calledAt = "2026-09-23T10:00:00.000Z";
    expect(
      calledPatientOutcome(
        { status: "waiting", updatedAt: new Date("2026-09-23T09:55:00.000Z") },
        calledAt,
      ),
    ).toBe("serving");
    expect(
      calledPatientOutcome(
        { status: "waiting", updatedAt: new Date("2026-09-23T10:03:00.000Z") },
        calledAt,
      ),
    ).toBe("returned");
    expect(
      calledPatientOutcome(
        { status: "done", updatedAt: new Date("2026-09-23T09:55:00.000Z") },
        calledAt,
      ),
    ).toBe("finished");
  });
});

describe("restockTapTokens", () => {
  it("keeps the existing tap rewards", () => {
    expect(restockTapTokens(1)).toBe(1);
    expect(restockTapTokens(5)).toBe(2);
    expect(restockTapTokens(10)).toBe(5);
  });
});

describe("display helpers", () => {
  it("labels badges", () => {
    expect(badgeLabel("first_quest")).toBe("First quest");
    expect(badgeLabel("swift_stocker")).toBe("Swift stocker");
  });

  it("describes multipliers as percentages", () => {
    expect(multiplierText(1.2)).toBe("+20%");
    expect(multiplierText(1.1)).toBe("+10%");
    expect(multiplierText(0.8)).toBe("−20%");
    expect(multiplierText(1)).toBe("no change");
  });
});
