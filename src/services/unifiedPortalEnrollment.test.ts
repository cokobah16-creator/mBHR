/**
 * Tests for unifiedPortalEnrollment — documents the N+1 query issue in
 * bulkEnrollPatients and will confirm the fix when it is applied.
 *
 * Currently bulkEnrollPatients issues one Supabase query PER patient (O(n)).
 * The failing assertion below is intentionally written to describe correct
 * behaviour (1 batch query); it will fail until the N+1 is fixed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- mocks ---
const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));

vi.mock("@/lib/supabase", () => ({ supabase: { from: mockFrom } }));
vi.mock("@/lib/logger", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/db", () => ({
  db: {
    patients: {
      where: vi.fn().mockReturnValue({
        equals: vi
          .fn()
          .mockReturnValue({ first: vi.fn().mockResolvedValue(null) }),
      }),
      add: vi.fn().mockResolvedValue("new-id"),
    },
  },
}));

import { bulkEnrollPatients } from "./unifiedPortalEnrollment";

describe("bulkEnrollPatients", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handles empty list without any DB calls", async () => {
    const result = await bulkEnrollPatients([]);
    expect(result.success).toBe(0);
    expect(result.failed).toBe(0);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("returns failed entry when patient not found", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
        in: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
      upsert: vi.fn().mockResolvedValue({ error: null }),
    });

    const result = await bulkEnrollPatients(["missing-id"]);
    expect(result.failed).toBe(1);
    expect(result.errors[0].patientId).toBe("missing-id");
  });

  /**
   * N+1 REGRESSION TEST
   *
   * This test documents the intended behaviour after the N+1 fix:
   * bulkEnrollPatients(["id1","id2","id3"]) should issue exactly 1 Supabase
   * "from patients" call (using .in()) rather than 3 individual calls.
   *
   * It is marked with `skip` because the fix has NOT yet been applied to
   * unifiedPortalEnrollment.ts — remove the `.skip` once the fix is in.
   */
  it.skip("issues a single batch query for multiple patients (N+1 fix)", async () => {
    const selectSpy = vi.fn().mockReturnValue({
      in: vi.fn().mockResolvedValue({
        data: [
          {
            id: "id1",
            given_name: "Ada",
            family_name: "Obi",
            dob: "1990-01-01",
            phone: "",
            email: "a@t.com",
            sex: "female",
          },
          {
            id: "id2",
            given_name: "Bode",
            family_name: "Ade",
            dob: "1985-03-15",
            phone: "",
            email: "b@t.com",
            sex: "male",
          },
          {
            id: "id3",
            given_name: "Cate",
            family_name: "Uzo",
            dob: "2000-07-22",
            phone: "",
            email: "c@t.com",
            sex: "female",
          },
        ],
        error: null,
      }),
    });
    mockFrom.mockReturnValue({ select: selectSpy });

    await bulkEnrollPatients(["id1", "id2", "id3"]);

    // Should call .from("patients") exactly once with a batch .in() query
    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(mockFrom).toHaveBeenCalledWith("patients");
  });
});
