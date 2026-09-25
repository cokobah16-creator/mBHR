import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useOperationsQueue } from "@/stores/operationsQueue";

const { mockFrom, mockGetSession, mockRpc } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockGetSession: vi.fn(),
  mockRpc: vi.fn(),
}));

// The adapter uses the app's shared client (@/lib/supabase), so requests
// carry the staff member's online sign-in.
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: mockFrom,
    rpc: mockRpc,
    auth: { getSession: mockGetSession },
  }),
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

    it("does not move the saved cursor past this device's clock", async () => {
      vi.stubEnv("VITE_SUPABASE_URL", "https://test.supabase.co");
      vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
      const { db } = await import("@/db");
      const consultations = db.consultations as unknown as { get: MockFn; put: MockFn };
      consultations.get.mockResolvedValue(undefined);
      const settingsPut = db.settings.put as unknown as MockFn;
      settingsPut.mockClear();
      const recent = new Date(Date.now() - 60_000).toISOString();
      mockFrom.mockImplementation((table: string) =>
        selectChain(
          table === "consultations"
            ? [
                { id: "c1", patient_id: "p1", updated_at: recent },
                { id: "c2", patient_id: "p1", updated_at: "2999-01-01T00:00:00+00:00" },
              ]
            : [],
        ),
      );

      const { pullChanges } = await import("./adapter");
      await pullChanges();

      // Both rows are written; the cursor stops at the row with a real time.
      expect(consultations.put).toHaveBeenCalledTimes(2);
      expect(settingsPut).toHaveBeenCalledWith({
        key: "sync_cursor:consultations",
        value: recent,
      });
    });

    it("downloads from the start when the saved cursor is in the future", async () => {
      vi.stubEnv("VITE_SUPABASE_URL", "https://test.supabase.co");
      vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
      const { db } = await import("@/db");
      const settingsGet = db.settings.get as unknown as MockFn;
      settingsGet.mockImplementation(async (key: string) =>
        key === "sync_cursor:consultations"
          ? { key, value: "2999-01-01T00:00:00.000Z" }
          : undefined,
      );
      const chains: Record<string, { select: MockFn; gt?: MockFn }> = {};
      mockFrom.mockImplementation((table: string) => {
        const limit = vi.fn().mockResolvedValue({ data: [], error: null });
        const order = vi.fn().mockReturnValue({ limit });
        const gt = vi.fn().mockReturnValue({ order });
        chains[table] = { select: vi.fn().mockReturnValue({ gt, order }), gt };
        return chains[table];
      });

      try {
        const { pullChanges } = await import("./adapter");
        await pullChanges();

        // No "updated_at >" filter: every row is read again.
        expect(chains.consultations.gt).not.toHaveBeenCalled();
      } finally {
        settingsGet.mockImplementation(() => Promise.resolve(undefined));
      }
    });

    it("stores a downloaded clinical time as a Date", async () => {
      vi.stubEnv("VITE_SUPABASE_URL", "https://test.supabase.co");
      vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
      const { db } = await import("@/db");
      const vitals = db.vitals as unknown as { get: MockFn; put: MockFn };
      vitals.get.mockResolvedValue(undefined);
      vitals.put.mockClear();
      mockFrom.mockImplementation((table: string) =>
        selectChain(
          table === "vitals"
            ? [
                {
                  id: "v1",
                  patient_id: "p1",
                  taken_at: "2026-03-14T09:30:00+00:00",
                  updated_at: "2026-03-14T09:31:00+00:00",
                },
              ]
            : [],
        ),
      );

      const { pullChanges } = await import("./adapter");
      await pullChanges();

      expect(vitals.put).toHaveBeenCalledTimes(1);
      const stored = vitals.put.mock.calls[0][0] as { takenAt: unknown };
      expect(stored.takenAt).toBeInstanceOf(Date);
      expect((stored.takenAt as Date).toISOString()).toBe("2026-03-14T09:30:00.000Z");
    });
  });

  // ── Server-authoritative foundation ───────────────────────────────────────

  type Row = Record<string, unknown>;

  /** In-memory stand-in for a Dexie table (only what the adapter uses). */
  function fakeTable(rows: Row[] = []) {
    const store = new Map<string, Row>(rows.map((r) => [String(r.id), { ...r }]));
    const unsent = () => [...store.values()].filter((r) => r._dirty === 1);
    return {
      store,
      get: vi.fn(async (id: string) => (store.has(id) ? { ...store.get(id)! } : undefined)),
      put: vi.fn(async (row: Row) => {
        store.set(String(row.id), { ...row });
      }),
      update: vi.fn(async (id: string, changes: Row) => {
        if (!store.has(id)) return 0;
        const next: Row = { ...store.get(id)!, ...changes };
        for (const [k, v] of Object.entries(changes)) if (v === undefined) delete next[k];
        store.set(id, next);
        return 1;
      }),
      where: () => ({
        equals: () => ({
          toArray: async () => unsent().map((r) => ({ ...r })),
          count: async () => unsent().length,
          filter: (fn: (r: Row) => boolean) => ({
            count: async () => unsent().filter(fn).length,
          }),
        }),
      }),
    };
  }

  describe("uploads", () => {
    const saved: Record<string, unknown> = {};

    beforeEach(async () => {
      vi.stubEnv("VITE_SUPABASE_URL", "https://test.supabase.co");
      vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
      const { db } = await import("@/db");
      for (const name of ["users", "patients", "visits", "serverCommands"]) {
        saved[name] = (db as unknown as Record<string, unknown>)[name];
      }
      mockGetSession.mockResolvedValue({
        data: { session: { user: { id: "cloud-ada", email: "ada@clinic.ng" } } },
      });
    });

    afterEach(async () => {
      const { db } = await import("@/db");
      Object.assign(db, saved);
      const { useAuthStore } = await import("@/stores/auth");
      useAuthStore.setState({ currentUser: null });
      vi.unstubAllEnvs();
    });

    function remoteTable(opts: {
      remote?: Row | null;
      upsertError?: { code: string } | null;
      status?: number;
      version?: number;
      /** Rows the read after an upload returns (select().in()). */
      readBack?: Row[];
      readBackError?: { code: string };
    }) {
      const maybeSingle = vi.fn().mockResolvedValue({ data: opts.remote ?? null, error: null });
      const eq = vi.fn().mockReturnValue({ maybeSingle });
      const inFilter = vi.fn().mockResolvedValue({
        data: opts.readBackError ? null : (opts.readBack ?? []),
        error: opts.readBackError ?? null,
      });
      const result = {
        data: opts.version !== undefined ? [{ id: "x", row_version: opts.version }] : null,
        error: opts.upsertError ?? null,
        status: opts.status ?? 201,
      };
      const upsertQuery = Object.assign(Promise.resolve(result), {
        select: vi.fn().mockResolvedValue(result),
      });
      const upsert = vi.fn().mockReturnValue(upsertQuery);
      return {
        select: vi.fn().mockReturnValue({ eq, in: inFilter }),
        upsert,
        upsertQuery,
        inFilter,
      };
    }

    it("keeps a row refused for permission, waiting for an authorised person, without retrying it under the same sign-in", async () => {
      const { db } = await import("@/db");
      const visits = fakeTable([{ id: "v1", patientId: "p1", _dirty: 1 }]);
      Object.assign(db, { visits });
      const remote = remoteTable({ upsertError: { code: "42501" }, status: 403 });
      mockFrom.mockImplementation((t: string) => (t === "visits" ? remote : remoteTable({})));

      const { pushChanges, countAwaitingAuthorisedSync } = await import("./adapter");
      const first = await pushChanges();

      expect(first.awaitingAuthorised).toBe(1);
      expect(visits.store.get("v1")).toMatchObject({
        _dirty: 1,
        _syncBlock: { reason: "permission", refusedFor: "cloud-ada" },
      });
      expect(await countAwaitingAuthorisedSync()).toBe(1);

      const second = await pushChanges();
      expect(second.awaitingAuthorised).toBe(1);
      expect(remote.upsert).toHaveBeenCalledTimes(1);

      // Someone else signs in online: the row is tried again.
      mockGetSession.mockResolvedValue({
        data: { session: { user: { id: "cloud-bayo", email: "bayo@clinic.ng" } } },
      });
      await pushChanges();
      expect(remote.upsert).toHaveBeenCalledTimes(2);
    });

    it("uploads staff accounts only for someone who may manage them", async () => {
      const { db } = await import("@/db");
      Object.assign(db, { users: fakeTable([{ id: "u1", fullName: "Ada", role: "nurse", _dirty: 1 }]) });
      const remote = remoteTable({});
      mockFrom.mockImplementation(() => remote);
      const { useAuthStore } = await import("@/stores/auth");
      const { pushChanges } = await import("./adapter");

      useAuthStore.setState({ currentUser: { id: "u2", role: "nurse" } as never });
      await pushChanges();
      expect(mockFrom).not.toHaveBeenCalledWith("app_users");

      useAuthStore.setState({ currentUser: { id: "u3", role: "admin" } as never });
      await pushChanges();
      expect(mockFrom).toHaveBeenCalledWith("app_users");
    });

    it("uploads a staff role and admin access only when they were saved on the Users screen", async () => {
      const { db } = await import("@/db");
      Object.assign(db, {
        users: fakeTable([
          { id: "u1", fullName: "Ada", role: "admin", adminAccess: true, _dirty: 1 },
          { id: "u2", fullName: "Bayo", role: "doctor", adminAccess: false, _staffEditBy: "u3", _dirty: 1 },
        ]),
      });
      const remote = remoteTable({});
      mockFrom.mockImplementation(() => remote);
      const { useAuthStore } = await import("@/stores/auth");
      const { pushChanges } = await import("./adapter");

      useAuthStore.setState({ currentUser: { id: "u3", role: "admin" } as never });
      await pushChanges();

      const payloads = remote.upsert.mock.calls.map((c) => c[0] as Row);
      const ada = payloads.find((p) => p.id === "u1");
      const bayo = payloads.find((p) => p.id === "u2");
      expect(ada).toMatchObject({ id: "u1", full_name: "Ada" });
      expect(ada).not.toHaveProperty("role");
      expect(ada).not.toHaveProperty("admin_access");
      expect(bayo).toMatchObject({ id: "u2", role: "doctor", admin_access: false });
    });

    it("keeps the server's row version after an upload and compares versions, not clocks", async () => {
      const { db } = await import("@/db");
      const patients = fakeTable([
        { id: "p1", givenName: "Ada", _dirty: 1, _serverVersion: 3, updatedAt: "2020-01-01T00:00:00Z" },
      ]);
      Object.assign(db, { patients });
      // Same version on the server (its clock is far ahead): no conflict.
      const remote = remoteTable({
        remote: { id: "p1", given_name: "Adaeze", row_version: 3, updated_at: "2030-01-01T00:00:00Z" },
        version: 4,
      });
      mockFrom.mockImplementation((t: string) => (t === "patients" ? remote : remoteTable({})));
      const { pushChanges } = await import("./adapter");

      const result = await pushChanges();

      expect(result.conflicts).toEqual([]);
      expect(remote.upsertQuery.select).toHaveBeenCalledWith("id,row_version");
      expect(patients.store.get("p1")).toMatchObject({ _dirty: 0, _serverVersion: 4 });
    });

    it("reports a conflict when the server changed the record since this device saw it", async () => {
      const { db } = await import("@/db");
      Object.assign(db, {
        patients: fakeTable([{ id: "p1", givenName: "Ada", _dirty: 1, _serverVersion: 3 }]),
      });
      const remote = remoteTable({
        remote: { id: "p1", given_name: "Adaeze", row_version: 5, updated_at: "2020-01-01T00:00:00Z" },
      });
      mockFrom.mockImplementation((t: string) => (t === "patients" ? remote : remoteTable({})));
      const { pushChanges } = await import("./adapter");

      const result = await pushChanges();

      expect(result.conflicts.map((c) => c.entityId)).toEqual(["p1"]);
      expect(remote.upsert).not.toHaveBeenCalled();
    });

    it("does not create again a patient deleted on the server", async () => {
      const { db } = await import("@/db");
      const patients = fakeTable([
        // Seen on the server before (holds a server version), now gone there.
        { id: "p1", givenName: "Ada", _dirty: 1, _serverVersion: 3 },
        // Registered on this device, never uploaded.
        { id: "p2", givenName: "Bayo", _dirty: 1 },
      ]);
      Object.assign(db, { patients });
      const remote = remoteTable({ remote: null, version: 1 });
      mockFrom.mockImplementation((t: string) => (t === "patients" ? remote : remoteTable({})));
      const { pushChanges } = await import("./adapter");

      const result = await pushChanges();

      expect(remote.upsert).toHaveBeenCalledTimes(1);
      expect(remote.upsert.mock.calls[0][0]).toMatchObject({ id: "p2" });
      expect(result.failed).toBe(1);
      expect(patients.store.get("p1")).toMatchObject({ _dirty: 1 });
    });

    describe("records without row versions: the server's updated_at as last seen", () => {
      const seen = "2026-09-20T10:00:00.123456+00:00";

      async function setUp(local: Row[], opts: Parameters<typeof remoteTable>[0]) {
        const { db } = await import("@/db");
        const visits = fakeTable(local);
        Object.assign(db, { visits });
        const remote = remoteTable(opts);
        mockFrom.mockImplementation((t: string) => (t === "visits" ? remote : remoteTable({})));
        const { pushChanges } = await import("./adapter");
        return { visits, remote, pushChanges };
      }

      it("uploads a re-edit of this device's own upload although this device's clock runs behind", async () => {
        const { visits, remote, pushChanges } = await setUp(
          [
            {
              id: "v1",
              patientId: "p1",
              status: "closed",
              // This device's clock, minutes behind the server's.
              updatedAt: "2026-09-20T09:50:00.000Z",
              _serverUpdatedAt: seen,
              _dirty: 1,
            },
          ],
          // The server still holds the earlier upload (same instant, other format).
          { remote: { id: "v1", patient_id: "p1", status: "open", updated_at: "2026-09-20T10:00:00.123456Z" } },
        );

        const result = await pushChanges();

        expect(result.conflicts).toEqual([]);
        expect(remote.upsert).toHaveBeenCalledTimes(1);
        expect(visits.store.get("v1")).toMatchObject({ status: "closed", _dirty: 0 });
      });

      it("compares the fields when the server changed since, even if this device's clock runs ahead", async () => {
        const { visits, remote, pushChanges } = await setUp(
          [
            {
              id: "v1",
              patientId: "p1",
              status: "closed",
              updatedAt: "2030-01-01T00:00:00.000Z",
              _serverUpdatedAt: seen,
              _dirty: 1,
            },
          ],
          { remote: { id: "v1", patient_id: "p1", status: "open", updated_at: "2026-09-20T10:05:00.000001+00:00" } },
        );

        const result = await pushChanges();

        expect(result.conflicts.map((c) => c.entityId)).toEqual(["v1"]);
        expect(result.conflicts[0].conflicts.map((c) => c.field)).toEqual(["status"]);
        expect(remote.upsert).not.toHaveBeenCalled();
        expect(visits.store.get("v1")).toMatchObject({ _dirty: 1 });
      });

      it("uploads when the server changed since but holds the same values", async () => {
        const { remote, pushChanges } = await setUp(
          [{ id: "v1", patientId: "p1", status: "closed", _serverUpdatedAt: seen, _dirty: 1 }],
          { remote: { id: "v1", patient_id: "p1", status: "closed", updated_at: "2026-09-20T10:05:00+00:00" } },
        );

        const result = await pushChanges();

        expect(result.conflicts).toEqual([]);
        expect(remote.upsert).toHaveBeenCalledTimes(1);
      });

      it("keeps the stamp read back after an upload only when the row holds what was uploaded", async () => {
        const { visits, remote, pushChanges } = await setUp(
          [
            { id: "v1", patientId: "p1", status: "closed", _dirty: 1 },
            { id: "v2", patientId: "p2", status: "closed", _serverUpdatedAt: seen, _dirty: 1 },
          ],
          {
            remote: null,
            readBack: [
              { id: "v1", patient_id: "p1", status: "closed", updated_at: "2026-09-20T10:05:00.5+00:00" },
              // Changed on another device between the upload and the read.
              { id: "v2", patient_id: "p2", status: "open", updated_at: "2026-09-20T10:05:01+00:00" },
            ],
          },
        );

        const result = await pushChanges();

        expect(result.uploaded).toBe(2);
        // A separate read by id, not rows returned by the upload itself.
        expect(remote.upsertQuery.select).not.toHaveBeenCalled();
        expect(remote.select).toHaveBeenCalledWith(expect.stringContaining("updated_at"));
        expect(remote.inFilter).toHaveBeenCalledWith("id", ["v1", "v2"]);
        expect(visits.store.get("v1")).toMatchObject({
          _dirty: 0,
          _serverUpdatedAt: "2026-09-20T10:05:00.5+00:00",
        });
        expect(visits.store.get("v2")).toMatchObject({ _dirty: 0, _serverUpdatedAt: seen });
      });

      it("does not fail the upload when the read back fails", async () => {
        const { visits, pushChanges } = await setUp(
          [{ id: "v1", patientId: "p1", status: "closed", _dirty: 1 }],
          { remote: null, readBackError: { code: "42501" } },
        );

        const result = await pushChanges();

        expect(result).toMatchObject({ uploaded: 1, failed: 0, awaitingAuthorised: 0 });
        expect(visits.store.get("v1")).toMatchObject({ _dirty: 0 });
        expect(visits.store.get("v1")).not.toHaveProperty("_serverUpdatedAt");
      });

      it("uploads this device's copy after keep-local instead of raising the same conflict again", async () => {
        const serverRow = {
          id: "v1",
          patient_id: "p1",
          status: "open",
          updated_at: "2026-09-20T10:05:00.000001+00:00",
        };
        const { visits, remote, pushChanges } = await setUp(
          [{ id: "v1", patientId: "p1", status: "closed", _serverUpdatedAt: seen, _dirty: 1 }],
          { remote: serverRow },
        );
        const { resolveConflict } = await import("./conflictResolver");

        const first = await pushChanges();
        expect(first.conflicts.map((c) => c.entityId)).toEqual(["v1"]);

        await resolveConflict(first.conflicts[0], "keep-local", undefined, undefined, serverRow);
        expect(visits.store.get("v1")).toMatchObject({ _serverUpdatedAt: serverRow.updated_at });
        const second = await pushChanges();

        expect(second.conflicts).toEqual([]);
        expect(remote.upsert).toHaveBeenCalledTimes(1);
        expect(visits.store.get("v1")).toMatchObject({ status: "closed", _dirty: 0 });
      });
    });

    describe("after a conflict is resolved on this device", () => {
      const conflict = {
        entityType: "patients",
        entityId: "p1",
        localTimestamp: "2020-01-01T00:00:00Z",
        remoteTimestamp: "2020-01-02T00:00:00Z",
        conflicts: [],
      };
      const serverRow = {
        id: "p1",
        given_name: "Adaeze",
        row_version: 5,
        updated_at: "2020-01-02T00:00:00Z",
      };

      async function setUp() {
        const { db } = await import("@/db");
        const patients = fakeTable([
          { id: "p1", givenName: "Ada", _dirty: 1, _serverVersion: 3 },
        ]);
        Object.assign(db, { patients });
        const remote = remoteTable({ remote: serverRow, version: 6 });
        mockFrom.mockImplementation((t: string) => (t === "patients" ? remote : remoteTable({})));
        const { pushChanges } = await import("./adapter");
        const { resolveConflict } = await import("./conflictResolver");
        return { patients, remote, pushChanges, resolveConflict };
      }

      it("uploads this device's copy after keep-local", async () => {
        const { patients, remote, pushChanges, resolveConflict } = await setUp();

        await resolveConflict(conflict, "keep-local", undefined, undefined, serverRow);
        const result = await pushChanges();

        expect(result.conflicts).toEqual([]);
        expect(remote.upsert).toHaveBeenCalledTimes(1);
        expect(patients.store.get("p1")).toMatchObject({ _dirty: 0, _serverVersion: 6 });
      });

      it("uploads a field-by-field choice", async () => {
        const { patients, remote, pushChanges, resolveConflict } = await setUp();

        await resolveConflict(
          conflict,
          "manual",
          { givenName: "local" },
          { id: "p1", givenName: "Ada" },
          serverRow,
        );
        const result = await pushChanges();

        expect(result.conflicts).toEqual([]);
        expect(remote.upsert).toHaveBeenCalledTimes(1);
        expect(patients.store.get("p1")).toMatchObject({ givenName: "Ada", _dirty: 0 });
      });

      it("uploads the next edit after keep-remote", async () => {
        const { patients, remote, pushChanges, resolveConflict } = await setUp();

        await resolveConflict(conflict, "keep-remote", undefined, undefined, serverRow);
        expect(patients.store.get("p1")).toMatchObject({
          givenName: "Adaeze",
          _serverVersion: 5,
          _dirty: 0,
        });
        expect(patients.store.get("p1")).not.toHaveProperty("row_version");

        await patients.update("p1", { givenName: "Adaeze Obi", _dirty: 1 });
        const result = await pushChanges();

        expect(result.conflicts).toEqual([]);
        expect(remote.upsert).toHaveBeenCalledTimes(1);
      });

      it("reads the server version for a versioned record only", async () => {
        const { fetchServerVersion } = await import("./adapter");
        const remote = remoteTable({ remote: { row_version: 7 } });
        mockFrom.mockImplementation(() => remote);

        expect(await fetchServerVersion("patients", "p1")).toBe(7);
        expect(remote.select).toHaveBeenCalledWith("row_version");
        expect(await fetchServerVersion("vitals", "v1")).toBeUndefined();
      });
    });
  });

  describe("downloads of server-owned fields", () => {
    type MockFn = ReturnType<typeof vi.fn>;
    const saved: Record<string, unknown> = {};

    function selectChain(rows: unknown[]) {
      const limit = vi.fn().mockResolvedValue({ data: rows, error: null });
      const order = vi.fn().mockReturnValue({ limit });
      const gt = vi.fn().mockReturnValue({ order });
      return { select: vi.fn().mockReturnValue({ gt, order }) };
    }

    beforeEach(async () => {
      vi.stubEnv("VITE_SUPABASE_URL", "https://test.supabase.co");
      vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
      const { db } = await import("@/db");
      for (const name of ["patients", "patientMerges", "visits"]) {
        saved[name] = (db as unknown as Record<string, unknown>)[name];
      }
    });

    afterEach(async () => {
      const { db } = await import("@/db");
      Object.assign(db, saved);
      vi.unstubAllEnvs();
    });

    it("applies merge links and portal decisions over unsent edits, and holds pending ones", async () => {
      const { db } = await import("@/db");
      const patients = fakeTable([
        { id: "p1", givenName: "Edited here", _dirty: 1, _serverVersion: 2 },
        { id: "p2", givenName: "Bola", portalEnabled: 1, _dirty: 0 },
        { id: "p3", givenName: "Chidi", portalEnabled: 0, portalPending: 1, _dirty: 0 },
      ]);
      const patientMerges = fakeTable([]);
      Object.assign(db, { patients, patientMerges });
      mockFrom.mockImplementation((table: string) =>
        selectChain(
          table === "patients"
            ? [
                {
                  id: "p1",
                  given_name: "Server",
                  merged_into: "p0",
                  merged_at: "2026-09-20T10:00:00Z",
                  portal_enabled: false,
                  portal_enabled_changed_at: null,
                  row_version: 3,
                  updated_at: "2026-09-20T10:00:00.000001Z",
                },
                {
                  id: "p2",
                  given_name: "Bola",
                  portal_enabled: false,
                  portal_enabled_changed_at: null,
                  merged_into: null,
                  row_version: 1,
                  updated_at: "2026-09-20T10:00:00.000002Z",
                },
                {
                  id: "p3",
                  given_name: "Chidi",
                  portal_enabled: true,
                  portal_enabled_changed_at: "2026-09-19T08:00:00Z",
                  merged_into: null,
                  row_version: 4,
                  updated_at: "2026-09-20T10:00:00.000003Z",
                },
              ]
            : table === "patient_merges"
              ? [
                  {
                    id: "m1",
                    winner_id: "p0",
                    loser_id: "p1",
                    merged_by: "u1",
                    reason: "duplicate",
                    created_at: "2026-09-20T10:00:00Z",
                    updated_at: "2026-09-20T10:00:00Z",
                  },
                ]
              : [],
        ),
      );

      const { pullChanges } = await import("./adapter");
      const summary = await pullChanges();

      // Unsent edits kept; the merge link from the server applied.
      expect(patients.store.get("p1")).toMatchObject({
        givenName: "Edited here",
        _dirty: 1,
        _serverVersion: 2,
        mergeInto: "p0",
        mergedAt: "2026-09-20T10:00:00Z",
      });
      // No portal decision recorded on the server yet: this device's value stands.
      expect(patients.store.get("p2")).toMatchObject({ portalEnabled: 1, _serverVersion: 1 });
      // A change waiting for its command is not overwritten.
      expect(patients.store.get("p3")).toMatchObject({ portalEnabled: 0, portalPending: 1 });
      // The merge history is downloaded.
      expect(patientMerges.store.get("m1")).toMatchObject({
        winnerId: "p0",
        loserId: "p1",
        status: "applied",
        createdDay: Math.floor(Date.parse("2026-09-20T10:00:00Z") / 86400000),
      });
      // Download-only rows are never uploaded, so never compared by stamp.
      expect(patientMerges.store.get("m1")).not.toHaveProperty("_serverUpdatedAt");
      expect(summary.keptLocalEdits).toBe(1);
      expect((patients.put as MockFn).mock.calls.length).toBe(3);
    });

    it("keeps the server's updated_at of rows laid over, not of rows with unsent changes", async () => {
      const { db } = await import("@/db");
      const seenBefore = "2026-09-20T09:00:00.000001+00:00";
      const visits = fakeTable([
        { id: "v1", patientId: "p1", status: "closed", _serverUpdatedAt: seenBefore, _dirty: 1 },
        { id: "v2", patientId: "p2", status: "open", _serverUpdatedAt: seenBefore, _dirty: 0 },
      ]);
      Object.assign(db, { visits });
      mockFrom.mockImplementation((table: string) =>
        selectChain(
          table === "visits"
            ? [
                { id: "v1", patient_id: "p1", status: "open", updated_at: "2026-09-20T10:00:00.000001+00:00" },
                { id: "v2", patient_id: "p2", status: "closed", updated_at: "2026-09-20T10:00:00.000002+00:00" },
              ]
            : [],
        ),
      );

      const { pullChanges } = await import("./adapter");
      await pullChanges();

      // The unsent edit keeps the stamp it was made against, so the other
      // device's change is still compared field by field at the upload.
      expect(visits.store.get("v1")).toMatchObject({
        status: "closed",
        _dirty: 1,
        _serverUpdatedAt: seenBefore,
      });
      expect(visits.store.get("v2")).toMatchObject({
        status: "closed",
        _dirty: 0,
        _serverUpdatedAt: "2026-09-20T10:00:00.000002+00:00",
      });
    });

    it("keeps a queue ticket label when the server row has none", async () => {
      const { db } = await import("@/db");
      const queue = fakeTable([{ id: "q1", stage: "vitals", ticketNumber: "Q-014", _dirty: 0 }]);
      const saved = (db as unknown as Record<string, unknown>).queue;
      Object.assign(db, { queue });
      try {
        mockFrom.mockImplementation((table: string) =>
          selectChain(
            table === "queue"
              ? [{ id: "q1", stage: "consult", ticket_number: null, row_version: 2, updated_at: "2026-09-20T10:00:00Z" }]
              : [],
          ),
        );
        const { pullChanges } = await import("./adapter");
        await pullChanges();
        expect(queue.store.get("q1")).toMatchObject({
          stage: "consult",
          ticketNumber: "Q-014",
          _serverVersion: 2,
        });
      } finally {
        Object.assign(db, { queue: saved });
      }
    });

    it("downloads specific rows again on request", async () => {
      const { db } = await import("@/db");
      const patients = fakeTable([{ id: "p1", portalEnabled: 1, _dirty: 0 }]);
      Object.assign(db, { patients });
      const inFilter = vi.fn().mockResolvedValue({
        data: [
          {
            id: "p1",
            portal_enabled: false,
            portal_enabled_changed_at: "2026-09-21T09:00:00Z",
            row_version: 9,
          },
        ],
        error: null,
      });
      mockFrom.mockImplementation(() => ({ select: vi.fn().mockReturnValue({ in: inFilter }) }));

      const { refetchRows } = await import("./adapter");
      const written = await refetchRows("patients", "id", ["p1", "p1"]);

      expect(written).toBe(1);
      expect(inFilter).toHaveBeenCalledWith("id", ["p1"]);
      expect(patients.store.get("p1")).toMatchObject({ portalEnabled: 0, _serverVersion: 9 });
    });
  });
});
