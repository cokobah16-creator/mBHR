import { describe, it, expect } from "vitest";
import {
  LEGACY_SHARED_WALLET_ID,
  QUEST_ROUTES,
  TRAINING_ACTIVITIES,
  activityAccessNote,
  buildLeaderboard,
  canOpenActivity,
  completedToday,
  questActivity,
  questProgressTracked,
  questStatus,
  toDate,
} from "./trainingActivities";

describe("questActivity", () => {
  it("finds the page each routed quest opens, with its access rules", () => {
    expect(questActivity("restock_blitz")?.id).toBe("restock");
    expect(questActivity("queue_maestro")?.liveData).toBeTruthy();
    expect(questActivity("knowledge_blitz")?.liveData).toBeUndefined();
    expect(questActivity("shelf_sleuth")).toBeUndefined();
    // A volunteer may see the Restock Blitz quest but cannot open the page.
    expect(canOpenActivity(questActivity("restock_blitz")!, "volunteer")).toBe(false);
    expect(canOpenActivity(questActivity("knowledge_blitz")!, "doctor")).toBe(false);
  });
});

const byId = (id: string) => TRAINING_ACTIVITIES.find((a) => a.id === id)!;

describe("training activity catalogue", () => {
  it("marks exactly the activities that change real data", () => {
    const live = TRAINING_ACTIVITIES.filter((a) => a.liveData).map((a) => a.id);
    expect(live.sort()).toEqual(["queue-maestro", "restock"]);
  });

  it("does not link to routes that do not exist", () => {
    for (const a of TRAINING_ACTIVITIES) {
      expect(a.href).not.toContain("shelf-sleuth");
    }
  });
});

describe("canOpenActivity", () => {
  it("follows the route's role list", () => {
    expect(canOpenActivity(byId("triage-sprint"), "doctor")).toBe(true);
    expect(canOpenActivity(byId("triage-sprint"), "volunteer")).toBe(false);
    expect(canOpenActivity(byId("knowledge-blitz"), "volunteer")).toBe(true);
    expect(canOpenActivity(byId("knowledge-blitz"), null)).toBe(false);
  });

  it("also needs the page permission (restock needs inventory)", () => {
    expect(canOpenActivity(byId("restock"), "admin")).toBe(true);
    expect(canOpenActivity(byId("restock"), "nurse")).toBe(false);
    expect(activityAccessNote(byId("restock"), "nurse")).toBe(
      "Needs inventory permission.",
    );
  });

  it("explains which roles can open an activity", () => {
    expect(activityAccessNote(byId("triage-sprint"), "volunteer")).toBe(
      "For nurse, doctor or admin.",
    );
    expect(activityAccessNote(byId("triage-sprint"), "nurse")).toBe("");
  });
});

describe("questStatus", () => {
  const task = { code: "knowledge_blitz", maxPerDay: 2, cooldownMinutes: 60 };
  const now = new Date("2026-03-01T12:00:00.000Z");

  it("is available with no attempts", () => {
    expect(questStatus(task, [], now)).toBe("available");
  });

  it("reports in-progress attempts first", () => {
    expect(
      questStatus(task, [{ taskCode: "knowledge_blitz", status: "in_progress" }], now),
    ).toBe("in_progress");
  });

  it("applies the cool-down after a finished attempt", () => {
    const recent = [
      {
        taskCode: "knowledge_blitz",
        status: "completed" as const,
        finishedAt: "2026-03-01T11:30:00.000Z",
      },
    ];
    expect(questStatus(task, recent, now)).toBe("cooldown");
    expect(questStatus(task, recent, new Date("2026-03-01T12:31:00.000Z"))).toBe(
      "available",
    );
  });

  it("stops at the daily limit", () => {
    const done = [
      { taskCode: "knowledge_blitz", status: "completed" as const, finishedAt: "2026-03-01T08:00:00.000Z" },
      { taskCode: "knowledge_blitz", status: "verified" as const, finishedAt: "2026-03-01T09:00:00.000Z" },
      { taskCode: "queue_maestro", status: "completed" as const, finishedAt: "2026-03-01T09:00:00.000Z" },
    ];
    expect(completedToday(task, done)).toBe(2);
    expect(questStatus(task, done, now)).toBe("daily_limit");
  });

  it("only claims progress for quests whose results it can read", () => {
    expect(questProgressTracked("queue_maestro")).toBe(true);
    expect(questProgressTracked("knowledge_blitz")).toBe(true);
    expect(questProgressTracked("restock_blitz")).toBe(false);
    expect(questProgressTracked("shelf_sleuth")).toBe(false);
    expect(QUEST_ROUTES.shelf_sleuth).toBeUndefined();
  });
});

describe("toDate", () => {
  it("accepts Dates and ISO strings and rejects junk", () => {
    const d = new Date("2026-03-01T10:00:00Z");
    expect(toDate(d)).toBe(d);
    expect(toDate("2026-03-01T10:00:00Z")?.getTime()).toBe(d.getTime());
    expect(toDate("nope")).toBeNull();
    expect(toDate(undefined)).toBeNull();
  });
});

describe("buildLeaderboard", () => {
  const users = [
    { id: "u1", fullName: "Ada" },
    { id: "u2", fullName: "Bola" },
  ];

  it("ranks by tokens, shares ranks on ties and marks the current user", () => {
    const { rows } = buildLeaderboard(
      [
        { volunteerId: "u1", tokens: 10 },
        { volunteerId: "u2", tokens: 30 },
        { volunteerId: "u3", tokens: 10 },
      ],
      users,
      "u1",
    );
    expect(rows.map((r) => [r.rank, r.name, r.tokens, r.isYou])).toEqual([
      [1, "Bola", 30, false],
      [2, "Ada", 10, true],
      [2, "Staff member not on this device", 10, false],
    ]);
  });

  it("leaves out the old shared placeholder wallet and says so", () => {
    const board = buildLeaderboard(
      [
        { volunteerId: LEGACY_SHARED_WALLET_ID, tokens: 999 },
        { volunteerId: "u1", tokens: 5 },
      ],
      users,
    );
    expect(board.rows).toHaveLength(1);
    expect(board.rows[0].volunteerId).toBe("u1");
    expect(board.hiddenLegacyWallet).toBe(true);
  });

  it("is empty when nobody has tokens stored", () => {
    const board = buildLeaderboard([], users);
    expect(board.rows).toEqual([]);
    expect(board.hiddenLegacyWallet).toBe(false);
  });
});
