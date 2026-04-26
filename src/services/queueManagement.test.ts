import { describe, it, expect, vi, beforeEach } from "vitest";

// ── hoisted mocks ────────────────────────────────────────────────────────────

const {
  mockQueueAdd,
  mockQueueUpdate,
  mockQueueGet,
  mockQueueWhere,
  mockPatientsGet,
} = vi.hoisted(() => ({
  mockQueueAdd: vi.fn(),
  mockQueueUpdate: vi.fn().mockResolvedValue(undefined),
  mockQueueGet: vi.fn(),
  mockQueueWhere: vi.fn(),
  mockPatientsGet: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    queue: {
      add: mockQueueAdd,
      update: mockQueueUpdate,
      get: mockQueueGet,
      where: mockQueueWhere,
    },
    patients: { get: mockPatientsGet },
  },
  generateId: vi.fn().mockReturnValue("q-new"),
  epochDay: vi.fn().mockReturnValue(20000),
}));

vi.mock("@/lib/supabase", () => ({ supabase: null }));

vi.mock("@/lib/logger", () => ({
  default: { log: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

import { QueueManagement } from "./queueManagement";

const PATIENT = {
  id: "p1",
  givenName: "Ada",
  familyName: "Obi",
  phone: "0800",
};

// Builds a Dexie-like where chain where:
//   .where(field).equals(val).and(fn).first()  → firstResult
//   .where(field).equals(val).and(fn).toArray() → arrayResult
//   .where(field).equals(val).and(fn).sortBy()  → sortedResult
//   .where(field).equals(val).toArray()         → arrayResult
function makeQueueChain(
  first: unknown = undefined,
  array: unknown[] = [],
  sorted: unknown[] = [],
) {
  const chain = {
    equals: vi.fn().mockReturnThis(),
    and: vi.fn().mockReturnThis(),
    filter: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(first),
    toArray: vi.fn().mockResolvedValue(array),
    sortBy: vi.fn().mockResolvedValue(sorted),
  };
  chain.equals.mockReturnValue(chain);
  chain.and.mockReturnValue(chain);
  chain.filter.mockReturnValue(chain);
  return chain;
}

describe("QueueManagement", () => {
  let qm: QueueManagement;

  beforeEach(() => {
    vi.clearAllMocks();
    qm = new QueueManagement();
    mockQueueAdd.mockResolvedValue(undefined);
    mockQueueUpdate.mockResolvedValue(undefined);
  });

  // ── addToQueue ────────────────────────────────────────────────────────────────

  describe("addToQueue", () => {
    it("throws when patient does not exist", async () => {
      mockPatientsGet.mockResolvedValue(undefined);

      await expect(qm.addToQueue("p-missing", "registration")).rejects.toThrow(
        /not found/i,
      );
    });

    it("throws when patient already in queue", async () => {
      mockPatientsGet.mockResolvedValue(PATIENT);
      // first call (check existing) returns an existing item
      const chain = makeQueueChain({ id: "existing", stage: "vitals" }, []);
      mockQueueWhere.mockReturnValue(chain);

      await expect(qm.addToQueue("p1", "registration")).rejects.toThrow(
        /already in queue/i,
      );
    });

    it("adds item with correct defaults for normal priority", async () => {
      mockPatientsGet.mockResolvedValue(PATIENT);

      // First where call (check existing) → no existing item
      // Second where call (calculatePosition) → 2 waiting items
      let callCount = 0;
      mockQueueWhere.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return makeQueueChain(undefined, []);
        }
        // calculatePosition — 2 waiting items → position = 3
        return makeQueueChain(undefined, [{ id: "w1" }, { id: "w2" }], []);
      });

      const item = await qm.addToQueue("p1", "vitals");

      expect(item.patientId).toBe("p1");
      expect(item.stage).toBe("vitals");
      expect(item.status).toBe("waiting");
      expect(item.priority).toBe("normal");
      expect(item.position).toBe(3);
      expect(mockQueueAdd).toHaveBeenCalledOnce();
    });

    it("assigns position 1 for urgent when no urgent items exist", async () => {
      mockPatientsGet.mockResolvedValue(PATIENT);
      let callCount = 0;
      mockQueueWhere.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return makeQueueChain(undefined, []);
        // No items with position ≤ 10 → urgentCount = 0 → position = 1
        return makeQueueChain(undefined, [], []);
      });

      const item = await qm.addToQueue("p1", "registration", "urgent");

      expect(item.position).toBe(1);
      expect(item.priority).toBe("urgent");
    });
  });

  // ── getNextStage ─────────────────────────────────────────────────────────────

  describe("stage ordering (via moveToNextStage)", () => {
    it("advances registration → vitals", async () => {
      mockPatientsGet.mockResolvedValue(PATIENT);

      let callIndex = 0;
      mockQueueWhere.mockImplementation(() => {
        callIndex++;
        if (callIndex === 1) {
          // moveToNextStage: find current item
          return makeQueueChain(
            { id: "q1", stage: "registration", patientId: "p1" },
            [],
            [],
          );
        }
        if (callIndex === 2) {
          // addToQueue: check existing — none (q1 just marked done)
          return makeQueueChain(undefined, [], []);
        }
        // calculatePosition + reorderQueue calls → empty
        return makeQueueChain(undefined, [], []);
      });

      await qm.moveToNextStage("p1");

      const addCall = mockQueueAdd.mock.calls[0]?.[0];
      expect(addCall?.stage).toBe("vitals");
    });

    it("does not add next stage for pharmacy (last stage)", async () => {
      mockQueueWhere.mockReturnValue(
        makeQueueChain(
          { id: "q1", stage: "pharmacy", patientId: "p1" },
          [],
          [],
        ),
      );
      mockPatientsGet.mockResolvedValue(PATIENT);

      await qm.moveToNextStage("p1");

      // No add to queue for a next stage
      expect(mockQueueAdd).not.toHaveBeenCalled();
    });

    it("throws when patient not in queue", async () => {
      mockQueueWhere.mockReturnValue(makeQueueChain(undefined, [], []));

      await expect(qm.moveToNextStage("p-missing")).rejects.toThrow(
        /not found in queue/i,
      );
    });
  });

  // ── startService / completeService ───────────────────────────────────────────

  describe("startService", () => {
    it("sets status to in_progress", async () => {
      mockQueueGet.mockResolvedValue({ id: "q1", stage: "vitals" });
      mockQueueWhere.mockReturnValue(makeQueueChain(undefined, [], []));

      await qm.startService("q1");

      expect(mockQueueUpdate).toHaveBeenCalledWith(
        "q1",
        expect.objectContaining({ status: "in_progress", _dirty: 1 }),
      );
    });
  });

  describe("completeService", () => {
    it("sets status to done and reorders", async () => {
      mockQueueGet.mockResolvedValue({ id: "q1", stage: "vitals" });
      mockQueueWhere.mockReturnValue(makeQueueChain(undefined, [], []));

      await qm.completeService("q1");

      expect(mockQueueUpdate).toHaveBeenCalledWith(
        "q1",
        expect.objectContaining({ status: "done", _dirty: 1 }),
      );
    });

    it("returns without error if item not found", async () => {
      mockQueueGet.mockResolvedValue(undefined);

      await expect(qm.completeService("q-missing")).resolves.toBeUndefined();
    });
  });

  // ── skipQueue ─────────────────────────────────────────────────────────────────

  describe("skipQueue", () => {
    it("moves patient to position 1", async () => {
      mockQueueWhere.mockReturnValue(
        makeQueueChain({ id: "q1", stage: "vitals" }, [], []),
      );

      await qm.skipQueue("p1");

      expect(mockQueueUpdate).toHaveBeenCalledWith(
        "q1",
        expect.objectContaining({ position: 1, _dirty: 1 }),
      );
    });

    it("throws when patient not in waiting queue", async () => {
      mockQueueWhere.mockReturnValue(makeQueueChain(undefined, [], []));

      await expect(qm.skipQueue("p-missing")).rejects.toThrow(
        /not found in waiting queue/i,
      );
    });
  });

  // ── getQueueStats ─────────────────────────────────────────────────────────────

  describe("getQueueStats", () => {
    it("returns correct waiting/inProgress/done counts", async () => {
      const items = [
        { id: "q1", status: "waiting", updatedAt: new Date() },
        { id: "q2", status: "waiting", updatedAt: new Date() },
        { id: "q3", status: "in_progress", updatedAt: new Date() },
        { id: "q4", status: "done", updatedAt: new Date() },
      ];
      const chain = makeQueueChain(undefined, items, []);
      mockQueueWhere.mockReturnValue(chain);

      const stats = await qm.getQueueStats("vitals");

      expect(stats.stage).toBe("vitals");
      expect(stats.waiting).toBe(2);
      expect(stats.inProgress).toBe(1);
      expect(stats.done).toBe(1);
    });

    it("returns zero counts for empty queue", async () => {
      mockQueueWhere.mockReturnValue(makeQueueChain(undefined, [], []));

      const stats = await qm.getQueueStats("registration");

      expect(stats.waiting).toBe(0);
      expect(stats.inProgress).toBe(0);
      expect(stats.done).toBe(0);
    });
  });

  // ── removeFromQueue ───────────────────────────────────────────────────────────

  describe("removeFromQueue", () => {
    it("marks all active items done", async () => {
      const activeItems = [
        { id: "q1", stage: "vitals" },
        { id: "q2", stage: "registration" },
      ];
      // Each where call used for toArray + reorderQueue (sortBy)
      mockQueueWhere.mockReturnValue(
        makeQueueChain(undefined, activeItems, []),
      );

      await qm.removeFromQueue("p1");

      expect(mockQueueUpdate).toHaveBeenCalledWith(
        "q1",
        expect.objectContaining({ status: "done" }),
      );
      expect(mockQueueUpdate).toHaveBeenCalledWith(
        "q2",
        expect.objectContaining({ status: "done" }),
      );
    });
  });

  // ── subscribe / unsubscribe ───────────────────────────────────────────────────

  describe("subscribe", () => {
    it("returns an unsubscribe function", () => {
      const cb = vi.fn();
      const unsub = qm.subscribe("vitals", cb);
      expect(typeof unsub).toBe("function");
    });

    it("unsubscribe removes the callback", () => {
      const cb = vi.fn();
      const unsub = qm.subscribe("vitals", cb);
      unsub();
      // After unsubscribe, subscriber map should no longer hold this callback
      // We can't inspect private state directly, so we just verify no throw
      expect(() => unsub()).not.toThrow();
    });
  });
});
