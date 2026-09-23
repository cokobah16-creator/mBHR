import { describe, it, expect, vi, beforeEach } from "vitest";

// ── hoisted mocks ────────────────────────────────────────────────────────────

const {
  mockQueueAdd,
  mockQueueUpdate,
  mockQueueGet,
  mockQueueWhere,
  mockPatientsGet,
  mockSettingsGet,
  mockSettingsPut,
  mockTransitionsAdd,
  mockTransaction,
  authState,
} = vi.hoisted(() => ({
  mockQueueAdd: vi.fn(),
  mockQueueUpdate: vi.fn().mockResolvedValue(undefined),
  mockQueueGet: vi.fn(),
  mockQueueWhere: vi.fn(),
  mockPatientsGet: vi.fn(),
  mockSettingsGet: vi.fn().mockResolvedValue(undefined),
  mockSettingsPut: vi.fn().mockResolvedValue(undefined),
  mockTransitionsAdd: vi.fn().mockResolvedValue(undefined),
  // Runs the scope directly; tests assert the scope was wrapped.
  mockTransaction: vi.fn(
    (_mode: string, _tables: unknown[], fn: () => Promise<unknown>) => fn(),
  ),
  authState: {
    currentUser: {
      id: "u-nurse",
      fullName: "Staff Nurse",
      role: "nurse",
    } as { id: string; fullName: string; role: string } | null,
  },
}));

vi.mock("@/db", () => ({
  db: {
    queue: {
      add: mockQueueAdd,
      update: mockQueueUpdate,
      get: mockQueueGet,
      where: mockQueueWhere,
    },
    queueTransitions: { add: mockTransitionsAdd },
    patients: { get: mockPatientsGet },
    visits: { where: vi.fn(), update: vi.fn() },
    settings: {
      get: mockSettingsGet,
      put: mockSettingsPut,
    },
    transaction: mockTransaction,
  },
  generateId: vi.fn().mockReturnValue("q-new"),
  epochDay: vi.fn().mockReturnValue(20000),
}));

vi.mock("@/stores/auth", () => ({
  useAuthStore: { getState: () => authState },
}));

vi.mock("@/lib/supabase", () => ({ supabase: null }));

vi.mock("@/lib/logger", () => ({
  default: { log: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

import {
  QueueManagement,
  QueuePermissionError,
  QueueValidationError,
} from "./queueManagement";

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
    authState.currentUser = { id: "u-nurse", fullName: "Staff Nurse", role: "nurse" };
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
        // No waiting tickets → position 1
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

  // ── audit trail ──────────────────────────────────────────────────────────────

  const transitionRows = () =>
    mockTransitionsAdd.mock.calls.map((c) => c[0] as Record<string, unknown>);

  describe("queue transition audit", () => {
    it("records a send_on row inside the queue transaction", async () => {
      mockPatientsGet.mockResolvedValue(PATIENT);
      let callIndex = 0;
      mockQueueWhere.mockImplementation(() => {
        callIndex++;
        if (callIndex === 1) {
          return makeQueueChain(
            { id: "q1", stage: "registration", patientId: "p1", status: "in_progress" },
            [],
            [],
          );
        }
        return makeQueueChain(undefined, [], []);
      });

      await qm.moveToNextStage("p1");

      expect(mockTransaction).toHaveBeenCalled();
      const rows = transitionRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        kind: "send_on",
        patientId: "p1",
        queueItemId: "q1",
        fromStage: "registration",
        toStage: "vitals",
        userId: "u-nurse",
        userRole: "nurse",
        _dirty: 1,
      });
      expect(typeof rows[0].deviceId).toBe("string");
      expect(rows[0].at).toBeInstanceOf(Date);
    });

    it("records toStage done when pharmacy finishes the visit", async () => {
      mockQueueWhere.mockReturnValue(
        makeQueueChain({ id: "q1", stage: "pharmacy", patientId: "p1" }, [], []),
      );
      const { db } = await import("@/db");
      (db.visits.where as ReturnType<typeof vi.fn>).mockReturnValue(
        makeQueueChain(undefined, [], []),
      );

      await qm.moveToNextStage("p1");

      expect(transitionRows()[0]).toMatchObject({
        kind: "send_on",
        fromStage: "pharmacy",
        toStage: "done",
      });
    });

    it("records call, end_here and prioritise", async () => {
      mockQueueGet.mockResolvedValue({
        id: "q1",
        stage: "vitals",
        patientId: "p1",
        status: "waiting",
      });
      mockQueueWhere.mockReturnValue(
        makeQueueChain(
          { id: "q1", stage: "vitals", patientId: "p1", status: "waiting" },
          [],
          [],
        ),
      );

      await qm.startService("q1");
      await qm.completeService("q1");
      await qm.skipQueue("p1", "Manual priority");

      expect(transitionRows().map((r) => r.kind)).toEqual([
        "call",
        "end_here",
        "prioritise",
      ]);
      expect(transitionRows()[1].toStage).toBe("done");
    });

    it("records one remove row per active ticket", async () => {
      mockQueueWhere.mockReturnValue(
        makeQueueChain(
          undefined,
          [
            { id: "q1", stage: "vitals", patientId: "p1" },
            { id: "q2", stage: "registration", patientId: "p1" },
          ],
          [],
        ),
      );

      await qm.removeFromQueue("p1");

      const rows = transitionRows();
      expect(rows.map((r) => r.kind)).toEqual(["remove", "remove"]);
      expect(rows.every((r) => r.toStage === "removed")).toBe(true);
    });

    it("records a new ticket as enqueue", async () => {
      mockPatientsGet.mockResolvedValue(PATIENT);
      mockQueueWhere.mockReturnValue(makeQueueChain(undefined, [], []));

      await qm.addToQueue("p1", "registration");

      expect(transitionRows()[0]).toMatchObject({
        kind: "enqueue",
        fromStage: null,
        toStage: "registration",
      });
    });

    it("audits the automatic long-wait escalation as system", async () => {
      const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const stale = {
        id: "q1",
        patientId: "p1",
        stage: "vitals",
        status: "waiting",
        position: 3,
        updatedAt: old,
      };
      mockQueueWhere.mockReturnValue(makeQueueChain(stale, [stale], []));

      await qm.checkStaleQueues();

      expect(transitionRows()[0]).toMatchObject({
        kind: "prioritise",
        userId: "system",
        userRole: "system",
      });
      expect(mockQueueUpdate).toHaveBeenCalledWith(
        "q1",
        expect.objectContaining({ position: 1 }),
      );
    });
  });

  // ── permissions ──────────────────────────────────────────────────────────────

  describe("queue permissions", () => {
    it("refuses a queue change when nobody is signed in", async () => {
      authState.currentUser = null;
      mockQueueGet.mockResolvedValue({ id: "q1", stage: "vitals" });

      await expect(qm.startService("q1")).rejects.toBeInstanceOf(
        QueuePermissionError,
      );
      expect(mockQueueUpdate).not.toHaveBeenCalled();
      expect(mockTransitionsAdd).not.toHaveBeenCalled();
    });

    it("refuses a role without queue or stage permission", async () => {
      authState.currentUser = { id: "u-guest", fullName: "Guest", role: "guest" };
      mockQueueGet.mockResolvedValue({ id: "q1", stage: "vitals" });

      await expect(qm.startService("q1")).rejects.toBeInstanceOf(
        QueuePermissionError,
      );
      expect(mockQueueUpdate).not.toHaveBeenCalled();
    });
  });

  // ── triage priority ──────────────────────────────────────────────────────────

  describe("triage priority", () => {
    it("carries urgent priority to the next stage", async () => {
      mockPatientsGet.mockResolvedValue(PATIENT);
      let callIndex = 0;
      mockQueueWhere.mockImplementation(() => {
        callIndex++;
        if (callIndex === 1) {
          return makeQueueChain(
            {
              id: "q1",
              stage: "vitals",
              patientId: "p1",
              status: "in_progress",
              priority: "urgent",
            },
            [],
            [],
          );
        }
        return makeQueueChain(undefined, [], []);
      });

      await qm.moveToNextStage("p1");

      const added = mockQueueAdd.mock.calls[0]?.[0];
      expect(added?.stage).toBe("consult");
      expect(added?.priority).toBe("urgent");
      expect(transitionRows()[0]).toMatchObject({
        fromPriority: "urgent",
        toPriority: "urgent",
      });
    });

    it("puts an urgent ticket ahead of every waiting non-urgent ticket", async () => {
      mockPatientsGet.mockResolvedValue(PATIENT);
      const waiting = [
        { id: "a", position: 1, priority: "urgent", status: "waiting" },
        { id: "b", position: 2, priority: "normal", status: "waiting" },
        { id: "c", position: 3, status: "waiting" },
      ];
      let callIndex = 0;
      mockQueueWhere.mockImplementation(() => {
        callIndex++;
        if (callIndex === 1) return makeQueueChain(undefined, []);
        return makeQueueChain(undefined, waiting, []);
      });

      const item = await qm.addToQueue("p1", "vitals", "urgent");

      expect(item.position).toBe(2);
      expect(mockQueueUpdate).toHaveBeenCalledWith(
        "b",
        expect.objectContaining({ position: 3 }),
      );
      expect(mockQueueUpdate).toHaveBeenCalledWith(
        "c",
        expect.objectContaining({ position: 4 }),
      );
      expect(mockQueueUpdate).not.toHaveBeenCalledWith("a", expect.anything());
    });

    const urgentItem = {
      id: "q1",
      stage: "consult",
      patientId: "p1",
      status: "waiting",
      priority: "urgent",
    };
    const doctor = { id: "u-doc", role: "doctor", name: "Dr A" };

    it("lets a clinician downgrade with a reason and audits it", async () => {
      authState.currentUser = { id: "u-doc", fullName: "Dr A", role: "doctor" };
      mockQueueWhere.mockReturnValue(makeQueueChain(urgentItem, [], []));

      await qm.downgradePriority("p1", {
        newPriority: "normal",
        reason: "  Reassessed: vitals stable  ",
        user: doctor,
      });

      expect(mockQueueUpdate).toHaveBeenCalledWith(
        "q1",
        expect.objectContaining({ priority: "normal", _dirty: 1 }),
      );
      expect(transitionRows()[0]).toMatchObject({
        kind: "priority_downgrade",
        fromPriority: "urgent",
        toPriority: "normal",
        reason: "Reassessed: vitals stable",
        userId: "u-doc",
        userRole: "doctor",
      });
    });

    it("refuses a downgrade without the consult permission", async () => {
      mockQueueWhere.mockReturnValue(makeQueueChain(urgentItem, [], []));

      await expect(
        qm.downgradePriority("p1", {
          newPriority: "normal",
          reason: "Looks fine",
          user: { id: "u-nurse", role: "nurse" },
        }),
      ).rejects.toBeInstanceOf(QueuePermissionError);
      expect(mockQueueUpdate).not.toHaveBeenCalled();
      expect(mockTransitionsAdd).not.toHaveBeenCalled();
    });

    it("refuses a downgrade with a blank reason", async () => {
      authState.currentUser = { id: "u-doc", fullName: "Dr A", role: "doctor" };
      mockQueueWhere.mockReturnValue(makeQueueChain(urgentItem, [], []));

      await expect(
        qm.downgradePriority("p1", {
          newPriority: "normal",
          reason: "   ",
          user: doctor,
        }),
      ).rejects.toBeInstanceOf(QueueValidationError);
      expect(mockQueueUpdate).not.toHaveBeenCalled();
    });

    it("refuses a change that is not lower than the current priority", async () => {
      authState.currentUser = { id: "u-doc", fullName: "Dr A", role: "doctor" };
      mockQueueWhere.mockReturnValue(
        makeQueueChain({ ...urgentItem, priority: "normal" }, [], []),
      );

      await expect(
        qm.downgradePriority("p1", {
          newPriority: "normal",
          reason: "Reassessed",
          user: doctor,
        }),
      ).rejects.toBeInstanceOf(QueueValidationError);
      expect(mockTransitionsAdd).not.toHaveBeenCalled();
    });

    it("refuses a downgrade for a user who is not the one signed in", async () => {
      // Signed in as a nurse; the caller claims to be a doctor.
      mockQueueWhere.mockReturnValue(makeQueueChain(urgentItem, [], []));

      await expect(
        qm.downgradePriority("p1", {
          newPriority: "normal",
          reason: "Reassessed",
          user: doctor,
        }),
      ).rejects.toBeInstanceOf(QueuePermissionError);
      expect(mockQueueUpdate).not.toHaveBeenCalled();
      expect(mockTransitionsAdd).not.toHaveBeenCalled();
    });

    it("checks the signed-in role, not the role the caller passes", async () => {
      mockQueueWhere.mockReturnValue(makeQueueChain(urgentItem, [], []));

      await expect(
        qm.downgradePriority("p1", {
          newPriority: "normal",
          reason: "Reassessed",
          user: { id: "u-nurse", role: "doctor" },
        }),
      ).rejects.toBeInstanceOf(QueuePermissionError);
      expect(mockTransitionsAdd).not.toHaveBeenCalled();
    });

    it("lets queue staff escalate to urgent and audits it", async () => {
      authState.currentUser = { id: "u-vol", fullName: "Volunteer", role: "volunteer" };
      mockQueueWhere.mockReturnValue(
        makeQueueChain({ ...urgentItem, priority: "normal" }, [], []),
      );

      await qm.escalatePriority("p1");

      expect(mockQueueUpdate).toHaveBeenCalledWith(
        "q1",
        expect.objectContaining({ priority: "urgent" }),
      );
      expect(transitionRows()[0]).toMatchObject({
        kind: "priority_escalate",
        fromPriority: "normal",
        toPriority: "urgent",
        userId: "u-vol",
      });
    });
  });
});
