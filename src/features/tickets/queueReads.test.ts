import { describe, expect, it, vi } from "vitest";

type Row = {
  id: string;
  status: "waiting" | "in_progress" | "done";
  updatedAt: Date | string;
};

const { rows, reads } = vi.hoisted(() => ({
  rows: [] as Row[],
  /** Every index read, to check no full-table read happens. */
  reads: [] as string[],
}));

// Minimal stand-in for the indexed reads the helpers use. Values of
// different types (Date vs text) never fall in the same range, as in
// IndexedDB.
vi.mock("@/db", () => {
  const inRange = (v: unknown, lo: unknown, hi: unknown) => {
    if (lo instanceof Date && hi instanceof Date) {
      return v instanceof Date && v >= lo && v < hi;
    }
    return typeof v === "string" && v >= (lo as string) && v < (hi as string);
  };
  return {
    db: {
      queue: {
        toArray: () => {
          reads.push("all");
          return Promise.resolve([...rows]);
        },
        where: (index: string) => ({
          anyOf: (values: unknown[]) => {
            reads.push(`${index}:anyOf`);
            return {
              toArray: () =>
                Promise.resolve(
                  rows.filter((r) => values.includes((r as Record<string, unknown>)[index])),
                ),
            };
          },
          between: (lo: unknown, hi: unknown) => {
            reads.push(`${index}:between`);
            return {
              toArray: () =>
                Promise.resolve(
                  rows.filter((r) => inRange((r as Record<string, unknown>)[index], lo, hi)),
                ),
            };
          },
        }),
      },
    },
  };
});

import { readActiveQueue, readQueueForToday } from "./queueReads";

const NOW = new Date(2026, 8, 25, 14, 0, 0).getTime();
const today = (h: number) => new Date(2026, 8, 25, h, 0, 0);
const lastWeek = new Date(2026, 8, 18, 10, 0, 0);

function seed() {
  rows.length = 0;
  reads.length = 0;
  for (let i = 0; i < 50; i++) {
    rows.push({ id: `old-${i}`, status: "done", updatedAt: lastWeek });
  }
  rows.push(
    { id: "w1", status: "waiting", updatedAt: lastWeek },
    { id: "s1", status: "in_progress", updatedAt: today(9) },
    { id: "d1", status: "done", updatedAt: today(10) },
    // Downloaded by sync: the time is ISO text.
    { id: "d2", status: "done", updatedAt: today(11).toISOString() },
  );
}

describe("queue board reads", () => {
  it("reads only rows still waiting or being served", async () => {
    seed();
    const active = await readActiveQueue();
    expect(active.map((r) => r.id).sort()).toEqual(["s1", "w1"]);
    expect(reads).not.toContain("all");
  });

  it("adds today's finished rows, each row once, without last week's history", async () => {
    seed();
    const result = await readQueueForToday(NOW);
    expect(result.map((r) => r.id).sort()).toEqual(["d1", "d2", "s1", "w1"]);
    expect(reads).not.toContain("all");
  });
});
