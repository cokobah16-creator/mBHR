import { describe, it, expect, vi, beforeEach } from "vitest";

// ── hoisted mocks ────────────────────────────────────────────────────────────

const { mockFrom, mockSupabase } = vi.hoisted(() => {
  const mockFrom = vi.fn();
  return {
    mockFrom,
    mockSupabase: { from: mockFrom },
  };
});

const {
  mockDbVitals,
  mockDbConsultations,
  mockDbDispenses,
  mockCreateAuditLog,
} = vi.hoisted(() => {
  function makeTable() {
    return {
      update: vi.fn().mockResolvedValue(1),
      where: vi.fn().mockReturnThis(),
      equals: vi.fn().mockReturnThis(),
      and: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    };
  }
  return {
    mockDbVitals: makeTable(),
    mockDbConsultations: makeTable(),
    mockDbDispenses: makeTable(),
    mockCreateAuditLog: vi.fn().mockResolvedValue(undefined),
  };
});

const { authState } = vi.hoisted(() => ({
  authState: { currentUser: { id: "dr1", role: "doctor" } as { id: string; role: string } | null },
}));

vi.mock("@/lib/supabase", () => ({ supabase: mockSupabase }));
vi.mock("@/stores/auth", () => ({
  useAuthStore: { getState: () => authState },
}));
vi.mock("@/db", () => ({
  db: {
    vitals: mockDbVitals,
    consultations: mockDbConsultations,
    dispenses: mockDbDispenses,
  },
  createAuditLog: mockCreateAuditLog,
}));
vi.mock("@/lib/logger", () => ({
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));

import {
  toggleRecordVisibility,
  bulkToggleVisibility,
  getHiddenRecords,
  getVisibilityLog,
  getPatientVisibilityStats,
} from "./recordVisibility";

// Build a Supabase-like fluent chain.
// update path: .from(t).update({}).eq("id", id)         — eq is terminal (awaited)
// insert path: .from(t).insert({})                      — insert is terminal
// select path: .from(t).select("*").eq(k,v).order().limit(n) — limit is terminal
//
// eq() returns an object that is both awaitable (has .then) AND has all chain methods
// so that chaining after eq() continues to work.
function makeFromChain(
  limitData: unknown[] = [],
  error: null | object = null,
  updatedRows: unknown[] = [{ id: "row" }],
) {
  // Create eqResult as a thenable first, then assign all chain methods to it.
  // Awaiting it (update ... .eq().select("id")) gives the rows the server changed.
  const eqResult: Record<string, unknown> = {
    then: (r: (v: unknown) => unknown) =>
      Promise.resolve({ data: error ? null : updatedRows, error }).then(r),
  };

  const chain: Record<string, unknown> = {
    update: vi.fn().mockReturnThis(),
    insert: vi.fn().mockResolvedValue({ error: null }),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: limitData, error }),
  };

  // Populate eqResult with all chain methods so chaining after .eq() works
  Object.assign(eqResult, chain);
  (chain.eq as ReturnType<typeof vi.fn>).mockReturnValue(eqResult);

  return chain;
}

describe("recordVisibility service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.currentUser = { id: "dr1", role: "doctor" };
    mockDbVitals.update.mockResolvedValue(1);
    mockDbConsultations.update.mockResolvedValue(1);
    mockDbDispenses.update.mockResolvedValue(1);
    mockDbVitals.where.mockReturnThis();
    mockDbVitals.equals.mockReturnThis();
    mockDbVitals.and.mockReturnThis();
    mockDbVitals.toArray.mockResolvedValue([]);
    mockDbConsultations.where.mockReturnThis();
    mockDbConsultations.equals.mockReturnThis();
    mockDbConsultations.and.mockReturnThis();
    mockDbConsultations.toArray.mockResolvedValue([]);
    mockDbDispenses.where.mockReturnThis();
    mockDbDispenses.equals.mockReturnThis();
    mockDbDispenses.and.mockReturnThis();
    mockDbDispenses.toArray.mockResolvedValue([]);
  });

  // ── toggleRecordVisibility ───────────────────────────────────────────────────

  describe("toggleRecordVisibility", () => {
    it("updates local vitals table and returns true on success", async () => {
      const chain = makeFromChain();
      mockFrom.mockReturnValue(chain);

      const result = await toggleRecordVisibility({
        recordType: "vitals",
        recordId: "v1",
        patientId: "p1",
        visible: false,
        reason: "sensitive",
        performedBy: "dr1",
      });

      expect(result).toBe(true);
      expect(mockDbVitals.update).toHaveBeenCalledWith(
        "v1",
        expect.objectContaining({
          portalVisible: false,
          visibilityReason: "sensitive",
          _dirty: 1,
        }),
      );
    });

    it("sets hiddenBy and hiddenAt when hiding, clears them when showing", async () => {
      const chain = makeFromChain();
      mockFrom.mockReturnValue(chain);

      await toggleRecordVisibility({
        recordType: "vitals",
        recordId: "v1",
        patientId: "p1",
        visible: true,
        performedBy: "dr1",
      });

      const arg = mockDbVitals.update.mock.calls[0][1];
      expect(arg.hiddenBy).toBeUndefined();
      expect(arg.hiddenAt).toBeUndefined();
      expect(arg.visibilityReason).toBeUndefined();
    });

    it("returns false on unexpected error", async () => {
      mockDbVitals.update.mockRejectedValue(new Error("DB crash"));
      mockFrom.mockReturnValue(makeFromChain());

      const result = await toggleRecordVisibility({
        recordType: "vitals",
        recordId: "v1",
        patientId: "p1",
        visible: false,
        performedBy: "dr1",
      });

      expect(result).toBe(false);
    });

    it("updates consultations table for consultation recordType", async () => {
      mockFrom.mockReturnValue(makeFromChain());

      await toggleRecordVisibility({
        recordType: "consultations",
        recordId: "c1",
        patientId: "p1",
        visible: false,
        performedBy: "dr1",
      });

      expect(mockDbConsultations.update).toHaveBeenCalledWith(
        "c1",
        expect.objectContaining({ portalVisible: false, _dirty: 1 }),
      );
    });

    it("does not update local table for lab_results (no local table)", async () => {
      mockFrom.mockReturnValue(makeFromChain());

      const result = await toggleRecordVisibility({
        recordType: "lab_results",
        recordId: "l1",
        patientId: "p1",
        visible: false,
        performedBy: "dr1",
      });

      expect(result).toBe(true);
      expect(mockDbVitals.update).not.toHaveBeenCalled();
      expect(mockDbConsultations.update).not.toHaveBeenCalled();
    });
  });

  // ── permission and zero-row checks ───────────────────────────────────────────

  describe("permission and changed-row checks", () => {
    it("refuses a role that cannot change this record type, without writing", async () => {
      authState.currentUser = { id: "vol1", role: "volunteer" };
      mockFrom.mockReturnValue(makeFromChain());

      const result = await toggleRecordVisibility({
        recordType: "consultations",
        recordId: "c1",
        patientId: "p1",
        visible: false,
        performedBy: "vol1",
      });

      expect(result).toBe(false);
      expect(mockDbConsultations.update).not.toHaveBeenCalled();
      expect(mockFrom).not.toHaveBeenCalled();
      expect(mockCreateAuditLog).not.toHaveBeenCalled();
    });

    it("refuses when nobody is signed in", async () => {
      authState.currentUser = null;

      const result = await toggleRecordVisibility({
        recordType: "vitals",
        recordId: "v1",
        patientId: "p1",
        visible: false,
        performedBy: "x",
      });

      expect(result).toBe(false);
      expect(mockDbVitals.update).not.toHaveBeenCalled();
    });

    it("treats a record missing from this device (0 rows) as failure", async () => {
      mockDbVitals.update.mockResolvedValue(0);
      mockFrom.mockReturnValue(makeFromChain());

      const result = await toggleRecordVisibility({
        recordType: "vitals",
        recordId: "missing",
        patientId: "p1",
        visible: false,
        performedBy: "dr1",
      });

      expect(result).toBe(false);
      expect(mockFrom).not.toHaveBeenCalled();
      expect(mockCreateAuditLog).not.toHaveBeenCalled();
    });

    it("treats a server update that changed no row as failure", async () => {
      mockFrom.mockReturnValue(makeFromChain([], null, []));

      const result = await toggleRecordVisibility({
        recordType: "vitals",
        recordId: "v1",
        patientId: "p1",
        visible: false,
        performedBy: "dr1",
      });

      expect(result).toBe(false);
      expect(mockCreateAuditLog).not.toHaveBeenCalled();
    });

    it("treats a server error as failure", async () => {
      mockFrom.mockReturnValue(makeFromChain([], { code: "42501" }));

      const result = await toggleRecordVisibility({
        recordType: "vitals",
        recordId: "v1",
        patientId: "p1",
        visible: false,
        performedBy: "dr1",
      });

      expect(result).toBe(false);
    });
  });

  // ── audit log ────────────────────────────────────────────────────────────────

  describe("audit logging", () => {
    it("writes a 'hide' audit entry when visible=false", async () => {
      mockFrom.mockReturnValue(makeFromChain());

      await toggleRecordVisibility({
        recordType: "vitals",
        recordId: "v1",
        patientId: "p1",
        visible: false,
        reason: "sensitive",
        performedBy: "dr-audit",
      });

      expect(mockCreateAuditLog).toHaveBeenCalledOnce();
      expect(mockCreateAuditLog).toHaveBeenCalledWith(
        "dr-audit",
        "hide",
        "vitals",
        "v1",
      );
    });

    it("writes a 'show' audit entry when visible=true", async () => {
      mockFrom.mockReturnValue(makeFromChain());

      await toggleRecordVisibility({
        recordType: "consultations",
        recordId: "c1",
        patientId: "p1",
        visible: true,
        performedBy: "nurse-1",
      });

      expect(mockCreateAuditLog).toHaveBeenCalledOnce();
      expect(mockCreateAuditLog).toHaveBeenCalledWith(
        "nurse-1",
        "show",
        "consultations",
        "c1",
      );
    });

    it("does NOT write audit log when the toggle throws", async () => {
      mockDbVitals.update.mockRejectedValue(new Error("DB crash"));
      mockFrom.mockReturnValue(makeFromChain());

      await toggleRecordVisibility({
        recordType: "vitals",
        recordId: "v-fail",
        patientId: "p1",
        visible: false,
        performedBy: "dr1",
      });

      expect(mockCreateAuditLog).not.toHaveBeenCalled();
    });
  });

  // ── bulkToggleVisibility ─────────────────────────────────────────────────────

  describe("bulkToggleVisibility", () => {
    it("processes all records and returns success/failed counts", async () => {
      mockFrom.mockReturnValue(makeFromChain());

      const result = await bulkToggleVisibility({
        recordType: "vitals",
        recordIds: ["v1", "v2", "v3"],
        patientId: "p1",
        visible: false,
        reason: "staff_review",
        performedBy: "admin",
      });

      expect(result.success).toBe(3);
      expect(result.failed).toBe(0);
    });

    it("counts records the server did not change as failed", async () => {
      mockFrom.mockReturnValue(makeFromChain([], null, []));

      const result = await bulkToggleVisibility({
        recordType: "vitals",
        recordIds: ["v1", "v2"],
        patientId: "p1",
        visible: false,
        performedBy: "admin",
      });

      expect(result).toEqual({ success: 0, failed: 2 });
    });

    it("counts failed records when update throws", async () => {
      mockDbVitals.update.mockRejectedValue(new Error("fail"));
      mockFrom.mockReturnValue(makeFromChain());

      const result = await bulkToggleVisibility({
        recordType: "vitals",
        recordIds: ["v1", "v2"],
        patientId: "p1",
        visible: false,
        performedBy: "admin",
      });

      expect(result.success).toBe(0);
      expect(result.failed).toBe(2);
    });

    it("returns zeroes for empty recordIds", async () => {
      const result = await bulkToggleVisibility({
        recordType: "vitals",
        recordIds: [],
        patientId: "p1",
        visible: false,
        performedBy: "admin",
      });

      expect(result.success).toBe(0);
      expect(result.failed).toBe(0);
    });
  });

  // ── getHiddenRecords ─────────────────────────────────────────────────────────

  describe("getHiddenRecords", () => {
    it("returns empty array when no hidden records", async () => {
      mockDbVitals.toArray.mockResolvedValue([]);
      mockDbConsultations.toArray.mockResolvedValue([]);
      mockDbDispenses.toArray.mockResolvedValue([]);

      const result = await getHiddenRecords("p1");

      expect(result).toEqual([]);
    });

    it("returns hidden records with type and reason", async () => {
      mockDbVitals.toArray.mockResolvedValue([
        {
          id: "v1",
          visibilityReason: "sensitive",
          hiddenAt: new Date("2024-01-01"),
        },
      ]);
      mockDbConsultations.toArray.mockResolvedValue([]);
      mockDbDispenses.toArray.mockResolvedValue([]);

      const result = await getHiddenRecords("p1", "vitals");

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        type: "vitals",
        id: "v1",
        reason: "sensitive",
      });
    });

    it("filters to a single recordType when specified", async () => {
      mockDbVitals.toArray.mockResolvedValue([{ id: "v1" }]);

      await getHiddenRecords("p1", "vitals");

      expect(mockDbVitals.where).toHaveBeenCalled();
      expect(mockDbConsultations.where).not.toHaveBeenCalled();
    });
  });

  // ── getVisibilityLog ─────────────────────────────────────────────────────────

  describe("getVisibilityLog", () => {
    it("returns empty array when supabase returns no data", async () => {
      mockFrom.mockReturnValue(makeFromChain([], null));

      const result = await getVisibilityLog("p1");

      expect(result).toEqual([]);
    });

    it("maps supabase rows to VisibilityLogEntry shape", async () => {
      const rows = [
        {
          id: "log1",
          record_type: "vitals",
          record_id: "v1",
          patient_id: "p1",
          action: "hidden",
          reason: "sensitive",
          performed_by: "dr1",
          performed_at: "2024-01-15T10:00:00Z",
        },
      ];
      mockFrom.mockReturnValue(makeFromChain(rows, null));

      const result = await getVisibilityLog("p1");

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: "log1",
        recordType: "vitals",
        recordId: "v1",
        action: "hidden",
        reason: "sensitive",
        performedBy: "dr1",
      });
      expect(result[0].performedAt).toBeInstanceOf(Date);
    });

    it("returns empty array on supabase error", async () => {
      mockFrom.mockReturnValue(makeFromChain([], { message: "RLS" }));

      const result = await getVisibilityLog("p1");

      expect(result).toEqual([]);
    });
  });

  // ── getPatientVisibilityStats ────────────────────────────────────────────────

  describe("getPatientVisibilityStats", () => {
    it("returns zero stats when no records exist", async () => {
      mockDbVitals.toArray.mockResolvedValue([]);
      mockDbConsultations.toArray.mockResolvedValue([]);
      mockDbDispenses.toArray.mockResolvedValue([]);

      const stats = await getPatientVisibilityStats("p1");

      expect(stats.total).toBe(0);
      expect(stats.hidden).toBe(0);
      expect(stats.byType.vitals).toEqual({ total: 0, hidden: 0 });
    });

    it("counts total and hidden records across types", async () => {
      mockDbVitals.toArray.mockResolvedValue([
        { id: "v1", portalVisible: true },
        { id: "v2", portalVisible: false },
      ]);
      mockDbConsultations.toArray.mockResolvedValue([
        { id: "c1", portalVisible: false },
      ]);
      mockDbDispenses.toArray.mockResolvedValue([]);

      const stats = await getPatientVisibilityStats("p1");

      expect(stats.byType.vitals).toEqual({ total: 2, hidden: 1 });
      expect(stats.byType.consultations).toEqual({ total: 1, hidden: 1 });
      expect(stats.total).toBe(3);
      expect(stats.hidden).toBe(2);
    });
  });
});
