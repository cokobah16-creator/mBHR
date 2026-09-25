import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Visit } from "@/db";

const rows: Visit[] = [];
// Write transactions on one table run one after another, as in IndexedDB.
let queue: Promise<unknown> = Promise.resolve();
let nextId = 0;

vi.mock("@/db", () => ({
  db: {
    visits: {
      where: vi.fn(() => ({
        equals: vi.fn((patientId: string) => ({
          toArray: vi.fn(() =>
            Promise.resolve(rows.filter((v) => v.patientId === patientId)),
          ),
        })),
      })),
      add: vi.fn((visit: Visit) => {
        rows.push(visit);
        return Promise.resolve(visit.id);
      }),
    },
    transaction: vi.fn(
      (_mode: string, _table: unknown, scope: () => Promise<unknown>) => {
        const run = queue.then(scope);
        queue = run.catch(() => undefined);
        return run;
      },
    ),
  },
  generateId: () => `visit-${++nextId}`,
}));

vi.mock("@/services/activeSite", () => ({
  getActiveSiteName: vi.fn(() => Promise.resolve("Test site")),
}));

import { ensureTodaysVisit, findTodaysOpenVisit } from "./visits";

const visit = (over: Partial<Visit>): Visit => ({
  id: "v-old",
  patientId: "p1",
  startedAt: new Date(),
  siteName: "Test site",
  status: "open",
  ...over,
});

describe("today's visit", () => {
  beforeEach(() => {
    rows.length = 0;
    queue = Promise.resolve();
  });

  it("continues today's open visit instead of starting another", async () => {
    rows.push(visit({ id: "v-today" }));
    const result = await ensureTodaysVisit("p1");
    expect(result.id).toBe("v-today");
    expect(rows).toHaveLength(1);
  });

  it("starts a visit when the only open one is from an earlier day", async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    rows.push(visit({ id: "v-yesterday", startedAt: yesterday }));
    rows.push(visit({ id: "v-closed", status: "closed" }));

    const result = await ensureTodaysVisit("p1");
    expect(result.id).not.toBe("v-yesterday");
    expect(result.id).not.toBe("v-closed");
    expect(result.status).toBe("open");
    expect(result._dirty).toBe(1);
    expect(result.siteName).toBe("Test site");
    expect(rows).toHaveLength(3);
  });

  it("opens one visit when started twice at once", async () => {
    const [a, b] = await Promise.all([
      ensureTodaysVisit("p1"),
      ensureTodaysVisit("p1"),
    ]);
    expect(a.id).toBe(b.id);
    expect(rows).toHaveLength(1);
    expect((await findTodaysOpenVisit("p1"))?.id).toBe(a.id);
  });

  it("does not continue a visit the caller says is finished", async () => {
    rows.push(visit({ id: "v-finished" }));
    const result = await ensureTodaysVisit("p1", ["v-finished"]);
    expect(result.id).not.toBe("v-finished");
    expect(rows).toHaveLength(2);
    // Started again at once (a double tap): the new visit is continued.
    const again = await ensureTodaysVisit("p1", ["v-finished"]);
    expect(again.id).toBe(result.id);
    expect(rows).toHaveLength(2);
  });

  it("keeps each patient's visit separate", async () => {
    const [a, b] = await Promise.all([
      ensureTodaysVisit("p1"),
      ensureTodaysVisit("p2"),
    ]);
    expect(a.patientId).toBe("p1");
    expect(b.patientId).toBe("p2");
    expect(rows).toHaveLength(2);
  });
});
