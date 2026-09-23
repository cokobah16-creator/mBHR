import { describe, it, expect, vi, beforeEach } from "vitest";

// --- mocks ---
const { mockFrom, mockCreateClient } = vi.hoisted(() => {
  const mockFrom = vi.fn();
  const mockClient = { from: mockFrom };
  return { mockFrom, mockCreateClient: vi.fn().mockReturnValue(mockClient) };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: mockCreateClient,
}));

// Sync refuses to start without an online sign-in; these tests run signed in.
vi.mock("@/lib/cloudSession", () => ({
  checkCloudSession: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("@/db", () => ({
  db: {
    // Runs the callback directly; the real Dexie transaction adds atomicity.
    transaction: (...args: unknown[]) =>
      (args[args.length - 1] as () => Promise<unknown>)(),
  },
}));

vi.mock("@/utils/queryCache", () => ({
  queryCache: { invalidatePattern: vi.fn() },
}));

vi.mock("@/lib/logger", () => ({
  default: { log: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

vi.mock("@/utils/errors", () => ({
  getErrorMessage: (e: unknown) =>
    e instanceof Error ? e.message : "Unknown error",
}));

import { EnhancedSync } from "./enhancedSync";
import { db } from "@/db";

const VALID_URL = "https://test.supabase.co";
const VALID_KEY = "anon-key-abc";
const PLACEHOLDER_URL = "your_supabase_project_url_here";

const tableConfig = {
  localTable: "patients",
  remoteTable: "patients",
  hasDirtyFlag: true,
  localToRemote: (p: { id: string }) => ({ id: p.id }),
  remoteToLocal: (r: { id: string }) => ({ id: r.id }),
};

function makeTable(dirty: unknown[] = [], remote: unknown[] = []) {
  return {
    where: vi.fn().mockReturnValue({
      equals: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue(dirty),
      }),
    }),
    get: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    put: vi.fn().mockResolvedValue(undefined),
    _remote: remote,
  };
}

/** Supabase query chain for a download: select().gt().order().limit(). */
function selectChain(result: { data: unknown[] | null; error: unknown }) {
  const limit = vi.fn().mockResolvedValue(result);
  const order = vi.fn().mockReturnValue({ limit });
  const gt = vi.fn().mockReturnValue({ order });
  const select = vi.fn().mockReturnValue({ gt });
  return { select, gt };
}

const ALL_LOCAL_TABLES = [
  "patients",
  "visits",
  "vitals",
  "consultations",
  "dispenses",
  "inventory",
  "queue",
  "gameSessions",
  "gamificationWallets",
  "stockBatches",
  "careTasks",
  "triageRecords",
  "patientAllergies",
  "patientPreferences",
  "vitalsRanges",
];

function setTable(name: string, table: unknown) {
  (db as unknown as Record<string, unknown>)[name] = table;
}

describe("EnhancedSync", () => {
  let sync: EnhancedSync;

  beforeEach(() => {
    vi.clearAllMocks();
    sync = new EnhancedSync();
  });

  // ── initialize ───────────────────────────────────────────────────────────────

  describe("initialize", () => {
    it("returns false for placeholder URL", () => {
      expect(sync.initialize(PLACEHOLDER_URL, VALID_KEY)).toBe(false);
      expect(mockCreateClient).not.toHaveBeenCalled();
    });

    it("returns false for empty URL", () => {
      expect(sync.initialize("", VALID_KEY)).toBe(false);
    });

    it("returns true and creates Supabase client for valid credentials", () => {
      expect(sync.initialize(VALID_URL, VALID_KEY)).toBe(true);
      expect(mockCreateClient).toHaveBeenCalledWith(
        VALID_URL,
        VALID_KEY,
        expect.objectContaining({ auth: { persistSession: true } }),
      );
    });

    it("isInitialized returns false before initialize", () => {
      expect(sync.isInitialized()).toBe(false);
    });

    it("isInitialized returns true after successful initialize", () => {
      sync.initialize(VALID_URL, VALID_KEY);
      expect(sync.isInitialized()).toBe(true);
    });

    it("isSyncing returns false when idle", () => {
      expect(sync.isSyncing()).toBe(false);
    });
  });

  // ── syncTable ─────────────────────────────────────────────────────────────────

  describe("syncTable", () => {
    it("returns not-initialized error when client is null", async () => {
      const result = await sync.syncTable(tableConfig);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not initialized/i);
    });

    it("pushes dirty records and clears _dirty flag on success", async () => {
      sync.initialize(VALID_URL, VALID_KEY);
      const mockTable = makeTable([{ id: "p1", _dirty: 1 }]);
      (db as unknown as Record<string, unknown>)["patients"] = mockTable;

      mockFrom.mockReturnValue({
        upsert: vi.fn().mockResolvedValue({ error: null }),
        select: vi.fn().mockReturnValue({
          gt: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        }),
      });

      const result = await sync.syncTable(tableConfig);
      expect(result.success).toBe(true);
      expect(result.pushed).toBe(1);
      expect(mockTable.update).toHaveBeenCalledWith(
        "p1",
        expect.objectContaining({ _dirty: 0 }),
      );
    });

    it("increments conflict count when upsert fails", async () => {
      sync.initialize(VALID_URL, VALID_KEY);
      const mockTable = makeTable([{ id: "p2", _dirty: 1 }]);
      (db as unknown as Record<string, unknown>)["patients"] = mockTable;

      mockFrom.mockReturnValue({
        upsert: vi.fn().mockResolvedValue({ error: { message: "RLS denied" } }),
        select: vi.fn().mockReturnValue({
          gt: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        }),
      });

      const result = await sync.syncTable(tableConfig);
      expect(result.conflicts).toBe(1);
      expect(result.failedUploads).toBe(1);
      expect(result.pushed).toBe(0);
    });

    it("marks records clean by the table's own primary key", async () => {
      sync.initialize(VALID_URL, VALID_KEY);
      const mockTable = makeTable([{ volunteerId: "v1", _dirty: 1 }]);
      setTable("gamificationWallets", mockTable);
      const { select } = selectChain({ data: [], error: null });
      mockFrom.mockReturnValue({
        upsert: vi.fn().mockResolvedValue({ error: null }),
        select,
      });

      await sync.syncTable({
        ...tableConfig,
        localTable: "gamificationWallets",
        primaryKey: "volunteerId",
      });

      expect(mockTable.update).toHaveBeenCalledWith(
        "v1",
        expect.objectContaining({ _dirty: 0 }),
      );
    });

    it("pulls remote records and writes them locally", async () => {
      sync.initialize(VALID_URL, VALID_KEY);
      const mockTable = makeTable([]);
      (db as unknown as Record<string, unknown>)["patients"] = mockTable;

      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          gt: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({
                data: [{ id: "r1" }],
                error: null,
              }),
            }),
          }),
        }),
      });

      const result = await sync.syncTable(tableConfig);
      expect(result.pulled).toBe(1);
      expect(mockTable.put).toHaveBeenCalledWith({ id: "r1" });
    });

    it("does not overwrite a local row that has changes not uploaded yet", async () => {
      sync.initialize(VALID_URL, VALID_KEY);
      const mockTable = makeTable([]);
      mockTable.get.mockResolvedValue({ id: "r1", givenName: "Edited here", _dirty: 1 });
      setTable("patients", mockTable);
      const { select } = selectChain({ data: [{ id: "r1" }], error: null });
      mockFrom.mockReturnValue({ select });

      const result = await sync.syncTable(tableConfig);

      expect(mockTable.put).not.toHaveBeenCalled();
      expect(result.pulled).toBe(0);
      expect(result.keptLocalEdits).toBe(1);
      expect(result.success).toBe(true);
    });

    it("lays a downloaded row over the local one so device-only fields stay", async () => {
      sync.initialize(VALID_URL, VALID_KEY);
      const mockTable = makeTable([]);
      mockTable.get.mockResolvedValue({ id: "r1", nameKey: "AT-OK", _dirty: 0 });
      setTable("patients", mockTable);
      const { select } = selectChain({ data: [{ id: "r1" }], error: null });
      mockFrom.mockReturnValue({ select });

      await sync.syncTable(tableConfig);

      expect(mockTable.put).toHaveBeenCalledWith({ id: "r1", nameKey: "AT-OK", _dirty: 0 });
    });

    it("continues the next download from the newest row received", async () => {
      sync.initialize(VALID_URL, VALID_KEY);
      setTable("patients", makeTable([]));
      const first = selectChain({
        data: [
          { id: "r1", updated_at: "2024-01-01T00:00:00+00:00" },
          { id: "r2", updated_at: "2024-01-02T00:00:00+00:00" },
        ],
        error: null,
      });
      mockFrom.mockReturnValue({ select: first.select });
      await sync.syncTable(tableConfig);
      expect(first.gt).toHaveBeenCalledWith("updated_at", "1970-01-01");

      const second = selectChain({ data: [], error: null });
      mockFrom.mockReturnValue({ select: second.select });
      await sync.syncTable(tableConfig);
      expect(second.gt).toHaveBeenCalledWith("updated_at", "2024-01-02T00:00:00+00:00");
    });

    it("reports a failed download as a failure, with a code and no row data", async () => {
      sync.initialize(VALID_URL, VALID_KEY);
      setTable("patients", makeTable([]));
      const { select } = selectChain({
        data: null,
        error: { code: "42501", message: "permission denied for table patients" },
      });
      mockFrom.mockReturnValue({ select });

      const result = await sync.syncTable(tableConfig);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Download failed (42501)");
    });

    it("keeps downloading while pages come back full", async () => {
      sync.initialize(VALID_URL, VALID_KEY);
      const mockTable = makeTable([]);
      setTable("patients", mockTable);
      const fullPage = Array.from({ length: 100 }, (_, i) => ({
        id: `r${i}`,
        updated_at: new Date(Date.UTC(2024, 0, 1) + i * 1000).toISOString(),
      }));
      const limit = vi
        .fn()
        .mockResolvedValueOnce({ data: fullPage, error: null })
        .mockResolvedValueOnce({
          data: [{ id: "r100", updated_at: "2024-01-02T00:00:00.000Z" }],
          error: null,
        });
      const gt = vi.fn().mockReturnValue({ order: vi.fn().mockReturnValue({ limit }) });
      mockFrom.mockReturnValue({ select: vi.fn().mockReturnValue({ gt }) });

      const result = await sync.syncTable(tableConfig);

      expect(result.pulled).toBe(101);
      expect(gt).toHaveBeenCalledTimes(2);
      expect(gt).toHaveBeenLastCalledWith("updated_at", fullPage[99].updated_at);
    });

    it("continues from the cursor saved on this device after a restart", async () => {
      sync.initialize(VALID_URL, VALID_KEY);
      setTable("patients", makeTable([]));
      const settings = {
        get: vi.fn().mockResolvedValue({
          key: "enhanced_sync_cursor:patients",
          value: "2024-02-01T00:00:00+00:00",
        }),
        put: vi.fn().mockResolvedValue(undefined),
      };
      setTable("settings", settings);
      try {
        const chain = selectChain({
          data: [{ id: "r1", updated_at: "2024-02-02T00:00:00+00:00" }],
          error: null,
        });
        mockFrom.mockReturnValue({ select: chain.select });

        await sync.syncTable(tableConfig);

        expect(chain.gt).toHaveBeenCalledWith("updated_at", "2024-02-01T00:00:00+00:00");
        expect(settings.put).toHaveBeenCalledWith({
          key: "enhanced_sync_cursor:patients",
          value: "2024-02-02T00:00:00+00:00",
        });
      } finally {
        delete (db as unknown as Record<string, unknown>)["settings"];
      }
    });

    it("keeps a record edited during the upload marked unsent", async () => {
      sync.initialize(VALID_URL, VALID_KEY);
      const mockTable = makeTable([{ id: "p1", givenName: "Ada", _dirty: 1 }]);
      // What this device holds once the upload returns: edited meanwhile.
      mockTable.get.mockResolvedValue({ id: "p1", givenName: "Ada Obi", _dirty: 1 });
      setTable("patients", mockTable);
      mockFrom.mockReturnValue({
        upsert: vi.fn().mockResolvedValue({ error: null }),
        select: selectChain({ data: [], error: null }).select,
      });

      const result = await sync.syncTable(tableConfig);

      expect(result.pushed).toBe(1);
      const changes = mockTable.update.mock.calls[0][1] as Record<string, unknown>;
      expect(changes).not.toHaveProperty("_dirty");
      expect(changes._syncedAt).toEqual(expect.any(String));
    });

    it("skips push when hasDirtyFlag is false", async () => {
      sync.initialize(VALID_URL, VALID_KEY);
      const mockTable = makeTable([{ id: "p3", _dirty: 1 }]);
      (db as unknown as Record<string, unknown>)["vitalsRanges"] = mockTable;

      const upsertFn = vi.fn();
      mockFrom.mockReturnValue({
        upsert: upsertFn,
        select: vi.fn().mockReturnValue({
          gt: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        }),
      });

      await sync.syncTable({
        ...tableConfig,
        localTable: "vitalsRanges",
        hasDirtyFlag: false,
      });

      expect(upsertFn).not.toHaveBeenCalled();
    });
  });

  // ── syncAll ───────────────────────────────────────────────────────────────────

  describe("syncAll", () => {
    it("returns error when not initialized", async () => {
      const result = await sync.syncAll();
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not initialized/i);
    });

    it("succeeds when every table syncs", async () => {
      sync.initialize(VALID_URL, VALID_KEY);
      ALL_LOCAL_TABLES.forEach((name) => setTable(name, makeTable([])));
      mockFrom.mockImplementation(() => ({
        select: selectChain({ data: [], error: null }).select,
      }));

      const result = await sync.syncAll();

      expect(result.success).toBe(true);
      expect(result.failedTables).toEqual([]);
      expect(result.error).toBeUndefined();
    });

    it("reports failure and names the table when one table fails", async () => {
      sync.initialize(VALID_URL, VALID_KEY);
      ALL_LOCAL_TABLES.forEach((name) => setTable(name, makeTable([])));
      delete (db as unknown as Record<string, unknown>)["careTasks"];
      mockFrom.mockImplementation(() => ({
        select: selectChain({ data: [], error: null }).select,
      }));

      const result = await sync.syncAll();

      expect(result.success).toBe(false);
      expect(result.failedTables?.map((f) => f.table)).toEqual(["careTasks"]);
      expect(result.error).toMatch(/careTasks/);
    });

    it("counts refused uploads without failing the run", async () => {
      sync.initialize(VALID_URL, VALID_KEY);
      ALL_LOCAL_TABLES.forEach((name) => setTable(name, makeTable([])));
      setTable("patients", makeTable([{ id: "p1", _dirty: 1 }]));
      mockFrom.mockImplementation(() => ({
        upsert: vi.fn().mockResolvedValue({ error: { code: "42501" } }),
        select: selectChain({ data: [], error: null }).select,
      }));

      const result = await sync.syncAll();

      expect(result.success).toBe(true);
      expect(result.failedUploads).toBe(1);
      expect(result.conflicts).toBe(1);
    });
  });
});
