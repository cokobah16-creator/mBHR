import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useOperationsQueue } from "@/stores/operationsQueue";

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: mockFrom }),
}));

// Sync refuses to start without an online sign-in; these tests run signed in.
vi.mock("@/lib/cloudSession", () => ({
  checkCloudSession: vi.fn(() => Promise.resolve(true)),
}));

// The adapter queues conflicts through the conflict service; not under test.
vi.mock("./queueConflicts", () => ({
  queueSyncConflicts: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    settings: {
      get: vi.fn(() => Promise.resolve(undefined)),
      put: vi.fn(() => Promise.resolve(undefined)),
    },
    // Runs the callback directly; the real Dexie transaction adds atomicity.
    transaction: vi.fn((...args: unknown[]) =>
      (args[args.length - 1] as () => Promise<unknown>)(),
    ),
    patients: {
      get: vi.fn(),
      update: vi.fn(),
      put: vi.fn(),
    },
    vitals: {
      get: vi.fn(),
      update: vi.fn(),
      put: vi.fn(),
    },
    consultations: {
      get: vi.fn(),
      update: vi.fn(),
      put: vi.fn(),
    },
  },
}));

describe("Sync Adapter - Operations Queue Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const store = useOperationsQueue.getState();
    store.clearAll();
    store.setProcessing(false);
  });

  describe("processOperationsQueue", () => {
    it("should process pending operations in priority order", async () => {
      const queueStore = useOperationsQueue.getState();

      queueStore.addOperation({
        type: "create",
        entity: "patient",
        entityId: "patient-1",
        data: { givenName: "John", familyName: "Doe" },
        priority: "high",
        maxAttempts: 3,
      });

      queueStore.addOperation({
        type: "update",
        entity: "patient",
        entityId: "patient-2",
        data: { givenName: "Jane", familyName: "Smith" },
        priority: "low",
        maxAttempts: 3,
      });

      expect(queueStore.getPendingCount()).toBe(2);

      const nextOp = queueStore.getNextOperation();
      expect(nextOp?.priority).toBe("high");
      expect(nextOp?.entityId).toBe("patient-1");
    });

    it("should retry failed operations with exponential backoff", async () => {
      const queueStore = useOperationsQueue.getState();

      queueStore.addOperation({
        type: "create",
        entity: "patient",
        entityId: "patient-fail",
        data: { givenName: "Test" },
        priority: "normal",
        maxAttempts: 3,
      });

      let state = useOperationsQueue.getState();
      const op = state.getNextOperation();
      expect(op).toBeDefined();

      if (op) {
        queueStore.markAsProcessing(op.id);
        queueStore.markAsFailed(op.id, "Network error");

        state = useOperationsQueue.getState();
        const failedOp = state.operations.find((o) => o.id === op.id);
        expect(failedOp?.status).toBe("pending");
        expect(failedOp?.attempts).toBe(1);
        expect(failedOp?.nextRetryAt).toBeGreaterThan(Date.now());
      }
    });

    it("should mark operation as failed after max attempts", async () => {
      const queueStore = useOperationsQueue.getState();

      queueStore.addOperation({
        type: "create",
        entity: "patient",
        entityId: "patient-max-fail",
        data: { givenName: "Test" },
        priority: "normal",
        maxAttempts: 2,
      });

      let state = useOperationsQueue.getState();
      const op = state.getNextOperation();
      if (op) {
        queueStore.markAsProcessing(op.id);
        queueStore.markAsFailed(op.id, "Error 1");

        queueStore.markAsProcessing(op.id);
        queueStore.markAsFailed(op.id, "Error 2");

        state = useOperationsQueue.getState();
        const failedOp = state.operations.find((o) => o.id === op.id);
        expect(failedOp?.status).toBe("failed");
        expect(failedOp?.attempts).toBe(2);
        expect(state.getFailedCount()).toBe(1);
      }
    });

    it("should track total processed and failed operations", async () => {
      const queueStore = useOperationsQueue.getState();

      queueStore.addOperation({
        type: "create",
        entity: "patient",
        entityId: "patient-1",
        data: {},
        priority: "normal",
        maxAttempts: 3,
      });

      queueStore.addOperation({
        type: "create",
        entity: "patient",
        entityId: "patient-2",
        data: {},
        priority: "normal",
        maxAttempts: 1,
      });

      let state = useOperationsQueue.getState();
      const op1 = state.getNextOperation();
      if (op1) {
        queueStore.markAsProcessing(op1.id);
        queueStore.markAsCompleted(op1.id);
      }

      state = useOperationsQueue.getState();
      const op2 = state.operations.find((o) => o.entityId === "patient-2");
      if (op2) {
        queueStore.markAsProcessing(op2.id);
        queueStore.markAsFailed(op2.id, "Error");
      }

      state = useOperationsQueue.getState();
      expect(state.totalProcessed).toBe(1);
      expect(state.totalFailed).toBe(1);
    });
  });

  describe("Conflict Detection", () => {
    it("should detect no conflict when local is newer", () => {
      const localData = {
        id: "123",
        givenName: "John",
        updatedAt: new Date("2024-01-02"),
        _syncedAt: new Date("2024-01-01").toISOString(),
      };

      expect(localData.updatedAt.getTime()).toBeGreaterThan(
        new Date(localData._syncedAt).getTime(),
      );
    });

    it("should detect conflict when remote is newer and data differs", () => {
      const localTimestamp = new Date("2024-01-01");
      const remoteTimestamp = new Date("2024-01-02");

      expect(remoteTimestamp.getTime()).toBeGreaterThan(
        localTimestamp.getTime(),
      );
    });

    it("should not conflict when only timestamps differ", () => {
      const localData = {
        givenName: "John",
        familyName: "Doe",
        updatedAt: new Date("2024-01-01"),
      };

      const remoteData = {
        given_name: "John",
        family_name: "Doe",
        updated_at: "2024-01-02",
      };

      expect(localData.givenName).toBe(remoteData.given_name);
      expect(localData.familyName).toBe(remoteData.family_name);
    });
  });

  describe("pullChanges", () => {
    type MockFn = ReturnType<typeof vi.fn>;

    /** select().order().limit() resolving to the given rows. */
    function selectChain(rows: unknown[]) {
      const limit = vi.fn().mockResolvedValue({ data: rows, error: null });
      const order = vi.fn().mockReturnValue({ limit });
      const gt = vi.fn().mockReturnValue({ order });
      return { select: vi.fn().mockReturnValue({ gt, order }) };
    }

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("keeps local rows with unsent changes and lays server rows over clean ones", async () => {
      vi.stubEnv("VITE_SUPABASE_URL", "https://test.supabase.co");
      vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
      const { db } = await import("@/db");
      const patients = db.patients as unknown as { get: MockFn; put: MockFn };
      patients.get.mockImplementation(async (id: string) =>
        id === "p1"
          ? { id: "p1", givenName: "Edited on this device", _dirty: 1 }
          : { id: "p2", givenName: "Ada", nameKey: "AT-OK", _dirty: 0 },
      );
      mockFrom.mockImplementation((table: string) =>
        selectChain(
          table === "patients"
            ? [
                { id: "p1", given_name: "Server", updated_at: "2024-01-02T00:00:00+00:00" },
                { id: "p2", given_name: "Adaeze", updated_at: "2024-01-01T00:00:00+00:00" },
              ]
            : [],
        ),
      );

      // Imported here so the client is created with the stubbed settings.
      const { pullChanges } = await import("./adapter");
      const summary = await pullChanges();

      // The row with an unsent edit is not overwritten...
      expect(patients.put).toHaveBeenCalledTimes(1);
      expect(summary.keptLocalEdits).toBe(1);
      expect(summary.applied).toBe(1);
      // ...the clean row gets the server values and keeps device-only fields...
      expect(patients.put).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "p2",
          givenName: "Adaeze",
          nameKey: "AT-OK",
          _dirty: 0,
        }),
      );
      // ...and the cursor still moves past both rows.
      expect(db.settings.put).toHaveBeenCalledWith({
        key: "sync_cursor:patients",
        value: "2024-01-02T00:00:00.000Z",
      });
    });
  });
});
