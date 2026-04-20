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

vi.mock("@/db", () => ({ db: {} }));

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
    update: vi.fn().mockResolvedValue(undefined),
    put: vi.fn().mockResolvedValue(undefined),
    _remote: remote,
  };
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
      expect(result.pushed).toBe(0);
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
  });
});
