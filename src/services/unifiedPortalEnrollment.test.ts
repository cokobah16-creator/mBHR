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

import {
  bulkEnrollPatients,
  enrollPatientInPortal,
} from "./unifiedPortalEnrollment";
import { MINOR_PORTAL_ACCESS_MESSAGE } from "@/pages/legal/policyMeta";

/** 1 January, ten years ago: someone under 18 whatever today's date is. */
function childDob(): string {
  return `${new Date().getFullYear() - 10}-01-01`;
}

describe("enrollPatientInPortal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuses a patient under 18 without contacting the server", async () => {
    const result = await enrollPatientInPortal({
      patientId: "child-1",
      givenName: "Chidi",
      familyName: "Obi",
      dob: childDob(),
      email: "parent@t.com",
    });

    expect(result).toEqual({
      success: false,
      error: MINOR_PORTAL_ACCESS_MESSAGE,
    });
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

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
        in: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    });

    const result = await bulkEnrollPatients(["missing-id"]);
    expect(result.failed).toBe(1);
    expect(result.errors[0].patientId).toBe("missing-id");
  });

  /**
   * N+1 REGRESSION TEST
   *
   * bulkEnrollPatients(["id1","id2","id3"]) must issue exactly 1 Supabase
   * patients fetch using .in() rather than 3 individual .eq() calls.
   */
  it("issues a single batch query for multiple patients (N+1 fix)", async () => {
    const inSpy = vi.fn().mockResolvedValue({
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
    });

    const maybeSingleFn = vi
      .fn()
      .mockResolvedValue({ data: null, error: null });
    const singleFn = vi
      .fn()
      .mockResolvedValue({ data: { id: "portal-u" }, error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === "patients") {
        return {
          select: vi.fn().mockReturnValue({ in: inSpy }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }
      // patient_portal_users — used by enrollPatientInPortal internals
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ maybeSingle: maybeSingleFn }),
          ilike: vi.fn().mockReturnValue({ maybeSingle: maybeSingleFn }),
        }),
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({ single: singleFn }),
        }),
      };
    });

    await bulkEnrollPatients(["id1", "id2", "id3"]);

    // patients lookup should be a single batch .in() call, not 3 individual .eq() calls
    expect(inSpy).toHaveBeenCalledTimes(1);
    expect(inSpy).toHaveBeenCalledWith("id", ["id1", "id2", "id3"]);
  });

  it("lists a patient under 18 as failed with the reason", async () => {
    const rows = [
      {
        id: "adult",
        given_name: "Ada",
        family_name: "Obi",
        dob: "1990-01-01",
        phone: "",
        email: "a@t.com",
        sex: "female",
      },
      {
        id: "child",
        given_name: "Chidi",
        family_name: "Obi",
        dob: childDob(),
        phone: "",
        email: "c@t.com",
        sex: "male",
      },
    ];
    const insert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi
          .fn()
          .mockResolvedValue({ data: { id: "portal-u" }, error: null }),
      }),
    });
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    mockFrom.mockImplementation((table: string) =>
      table === "patients"
        ? {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({ data: rows, error: null }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          }
        : {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({ maybeSingle }),
              ilike: vi.fn().mockReturnValue({ maybeSingle }),
            }),
            insert,
          },
    );

    const result = await bulkEnrollPatients(["adult", "child"]);

    expect(result).toEqual({
      success: 1,
      failed: 1,
      errors: [{ patientId: "child", error: MINOR_PORTAL_ACCESS_MESSAGE }],
    });
    // Only the adult's portal account was made.
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ patient_id: "adult" }),
    );
  });
});
