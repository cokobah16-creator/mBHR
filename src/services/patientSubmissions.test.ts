import { describe, it, expect, vi, beforeEach } from "vitest";

// ── hoisted mocks ────────────────────────────────────────────────────────────

const { mockFrom, mockSupabase } = vi.hoisted(() => {
  const mockFrom = vi.fn();
  return { mockFrom, mockSupabase: { from: mockFrom } };
});

const { mockSubData, mockAllergies } = vi.hoisted(() => ({
  mockSubData: {
    add: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    get: vi.fn(),
    where: vi.fn(),
  },
  mockAllergies: { add: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock("@/lib/supabase", () => ({ supabase: mockSupabase }));
vi.mock("@/db", () => ({
  db: {
    patientSubmittedData: mockSubData,
    patientAllergies: mockAllergies,
  },
  generateId: vi.fn().mockReturnValue("sub-123"),
}));
vi.mock("@/lib/logger", () => ({
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

import {
  createPatientSubmission,
  getPatientSubmissions,
  getPendingSubmissionsForReview,
  reviewSubmission,
  mergeSubmissionToAllergies,
} from "./patientSubmissions";

// Thenable + chainable Supabase mock (same pattern as recordVisibility tests)
function makeSupabaseChain(
  data: unknown[] | null = [],
  error: null | object = null,
) {
  const eqResult: Record<string, unknown> = {
    then: (r: (v: unknown) => unknown) => Promise.resolve({ error }).then(r),
  };
  const chain: Record<string, unknown> = {
    insert: vi.fn().mockResolvedValue({ error: null }),
    upsert: vi.fn().mockResolvedValue({ error: null }),
    update: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data, error }),
  };
  Object.assign(eqResult, chain);
  (chain.eq as ReturnType<typeof vi.fn>).mockReturnValue(eqResult);
  return chain;
}

function makeDbChain(array: unknown[] = []) {
  const chain = {
    equals: vi.fn().mockReturnThis(),
    and: vi.fn().mockReturnThis(),
    reverse: vi.fn().mockReturnThis(),
    sortBy: vi.fn().mockResolvedValue(array),
    toArray: vi.fn().mockResolvedValue(array),
  };
  chain.equals.mockReturnValue(chain);
  chain.and.mockReturnValue(chain);
  chain.reverse.mockReturnValue(chain);
  return chain;
}

describe("patientSubmissions service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSubData.add.mockResolvedValue(undefined);
    mockSubData.update.mockResolvedValue(undefined);
    mockSubData.where.mockReturnValue(makeDbChain());
  });

  // ── createPatientSubmission ──────────────────────────────────────────────────

  describe("createPatientSubmission", () => {
    it("creates a submission in local DB and returns it", async () => {
      mockFrom.mockReturnValue(makeSupabaseChain());

      const result = await createPatientSubmission({
        patientId: "p1",
        submissionType: "symptoms",
        data: {
          symptoms: {
            description: "fever",
            severity: "mild",
            duration: "2 days",
          },
        },
      });

      expect(result).not.toBeNull();
      expect(result?.id).toBe("sub-123");
      expect(result?.patientId).toBe("p1");
      expect(result?.status).toBe("pending");
      expect(result?._dirty).toBe(1);
      expect(mockSubData.add).toHaveBeenCalledOnce();
    });

    it("still returns submission when Supabase insert fails", async () => {
      const chain = makeSupabaseChain([], { message: "network error" });
      // override insert to return error
      (chain.insert as ReturnType<typeof vi.fn>).mockResolvedValue({
        error: { message: "fail" },
      });
      mockFrom.mockReturnValue(chain);

      const result = await createPatientSubmission({
        patientId: "p1",
        submissionType: "symptoms",
        data: {},
      });

      expect(result).not.toBeNull();
      // _dirty stays 1 when supabase fails
      expect(result?._dirty).toBe(1);
    });

    it("returns null when DB add throws", async () => {
      mockSubData.add.mockRejectedValue(new Error("IndexedDB quota"));
      mockFrom.mockReturnValue(makeSupabaseChain());

      const result = await createPatientSubmission({
        patientId: "p1",
        submissionType: "symptoms",
        data: {},
      });

      expect(result).toBeNull();
    });

    it("clears _dirty flag on successful Supabase sync", async () => {
      mockFrom.mockReturnValue(makeSupabaseChain());

      await createPatientSubmission({
        patientId: "p1",
        submissionType: "medications",
        data: {},
      });

      // Second update call clears _dirty after successful supabase insert
      expect(mockSubData.update).toHaveBeenCalledWith(
        "sub-123",
        expect.objectContaining({ _dirty: 0 }),
      );
    });
  });

  // ── getPatientSubmissions ────────────────────────────────────────────────────

  describe("getPatientSubmissions", () => {
    it("returns all submissions for patient when no status filter", async () => {
      const submissions = [
        { id: "s1", status: "pending" },
        { id: "s2", status: "approved" },
      ];
      mockSubData.where.mockReturnValue(makeDbChain(submissions));

      const result = await getPatientSubmissions("p1");

      expect(result).toHaveLength(2);
    });

    it("returns empty array on error", async () => {
      mockSubData.where.mockImplementation(() => {
        throw new Error("DB error");
      });

      const result = await getPatientSubmissions("p1");

      expect(result).toEqual([]);
    });
  });

  // ── getPendingSubmissionsForReview ────────────────────────────────────────────

  describe("getPendingSubmissionsForReview", () => {
    it("maps Supabase rows to local shape", async () => {
      const rows = [
        {
          id: "s1",
          patient_id: "p1",
          portal_user_id: null,
          submission_type: "symptoms",
          data: {},
          notes: null,
          status: "pending",
          reviewed_by: null,
          reviewed_at: null,
          review_notes: null,
          merged_to_record_id: null,
          created_at: "2024-01-10T08:00:00Z",
          updated_at: "2024-01-10T08:00:00Z",
        },
      ];
      mockFrom.mockReturnValue(makeSupabaseChain(rows, null));

      const result = await getPendingSubmissionsForReview();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: "s1",
        patientId: "p1",
        submissionType: "symptoms",
        status: "pending",
      });
      expect(result[0].createdAt).toBeInstanceOf(Date);
    });

    it("falls back to local DB on Supabase error", async () => {
      const chain = makeSupabaseChain(null, { message: "timeout" });
      // override limit to return error
      (chain.limit as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: null,
        error: { message: "timeout" },
      });
      mockFrom.mockReturnValue(chain);

      const pending = [{ id: "s1", status: "pending" }];
      mockSubData.where.mockReturnValue(makeDbChain(pending));

      const result = await getPendingSubmissionsForReview();

      expect(result).toEqual(pending);
    });
  });

  // ── reviewSubmission ─────────────────────────────────────────────────────────

  describe("reviewSubmission", () => {
    it("updates local record with approved status and returns true", async () => {
      mockFrom.mockReturnValue(makeSupabaseChain());

      const result = await reviewSubmission({
        submissionId: "s1",
        status: "approved",
        reviewedBy: "dr1",
        reviewNotes: "Looks good",
      });

      expect(result).toBe(true);
      expect(mockSubData.update).toHaveBeenCalledWith(
        "s1",
        expect.objectContaining({
          status: "approved",
          reviewedBy: "dr1",
          _dirty: 1,
        }),
      );
    });

    it("returns false on DB error", async () => {
      mockSubData.update.mockRejectedValue(new Error("DB write failed"));

      const result = await reviewSubmission({
        submissionId: "s1",
        status: "rejected",
        reviewedBy: "dr1",
      });

      expect(result).toBe(false);
    });
  });

  // ── mergeSubmissionToAllergies ────────────────────────────────────────────────

  describe("mergeSubmissionToAllergies", () => {
    it("returns false for non-allergy submission type", async () => {
      mockSubData.get.mockResolvedValue({
        id: "s1",
        submissionType: "symptoms",
        data: {},
      });

      const result = await mergeSubmissionToAllergies("s1", "p1", "dr1");

      expect(result).toBe(false);
      expect(mockAllergies.add).not.toHaveBeenCalled();
    });

    it("returns false when submission not found", async () => {
      mockSubData.get.mockResolvedValue(undefined);

      const result = await mergeSubmissionToAllergies("s-missing", "p1", "dr1");

      expect(result).toBe(false);
    });

    it("creates allergy records and marks submission approved", async () => {
      const submission = {
        id: "s1",
        submissionType: "allergies",
        data: {
          allergies: [
            { allergen: "Penicillin", reaction: "rash", severity: "moderate" },
            {
              allergen: "Peanut",
              reaction: "anaphylaxis",
              severity: "life-threatening",
            },
          ],
        },
      };
      mockSubData.get.mockResolvedValue(submission);
      mockFrom.mockReturnValue(makeSupabaseChain());

      const result = await mergeSubmissionToAllergies("s1", "p1", "dr1");

      expect(result).toBe(true);
      expect(mockAllergies.add).toHaveBeenCalledTimes(2);
      const firstAllergy = mockAllergies.add.mock.calls[0][0];
      expect(firstAllergy).toMatchObject({
        patientId: "p1",
        allergen: "Penicillin",
        severity: "moderate",
        isActive: 1,
        _dirty: 1,
      });
    });

    it("returns false when allergies data is missing from submission", async () => {
      mockSubData.get.mockResolvedValue({
        id: "s1",
        submissionType: "allergies",
        data: {},
      });

      const result = await mergeSubmissionToAllergies("s1", "p1", "dr1");

      expect(result).toBe(false);
    });
  });
});
