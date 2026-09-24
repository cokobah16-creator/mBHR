import { describe, it, expect, beforeEach, vi } from "vitest";
import { supabase } from "@/lib/supabase";
import {
  getPatientDashboard,
  getPatientMedicalHistory,
  getVisitDetails,
  loadPatientDashboard,
  loadVisitDetails,
  getPatientNotifications,
  markNotificationAsRead,
  getPatientMessages,
  sendMessage,
  markMessageAsRead,
} from "./patientPortalData";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(() => Promise.resolve({ data: [], error: null })),
    auth: {
      getSession: vi.fn(() =>
        Promise.resolve({ data: { session: { user: { id: "auth-1" } } } }),
      ),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() =>
            Promise.resolve({ data: null, error: null }),
          ),
          single: vi.fn(() => Promise.resolve({ data: null, error: null })),
          eq: vi.fn(() => Promise.resolve({ data: null, error: null })),
        })),
        order: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
        })),
        range: vi.fn(() => Promise.resolve({ data: [], error: null })),
        limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
        in: vi.fn(() => ({
          gte: vi.fn(() => ({
            order: vi.fn(() => ({
              limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
            })),
          })),
        })),
        gte: vi.fn(() => ({
          order: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
          })),
        })),
      })),
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: null, error: null })),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => Promise.resolve({ error: null })),
        })),
      })),
    })),
  },
}));

vi.mock("@/lib/logger", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

describe("Patient Portal Data Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getPatientDashboard", () => {
    it("should return dashboard data for patient", async () => {
      const result = await getPatientDashboard("portal-user-id", "patient-id");

      expect(result).toBeNull();
    });
  });

  describe("getPatientMedicalHistory", () => {
    it("should return medical history with pagination", async () => {
      const result = await getPatientMedicalHistory(
        "portal-user-id",
        "patient-id",
        10,
        0,
      );

      expect(result).toBeDefined();
    });
  });

  describe("getVisitDetails", () => {
    it("should return visit details", async () => {
      const result = await getVisitDetails(
        "portal-user-id",
        "patient-id",
        "visit-id",
      );

      expect(result).toBeNull();
    });
  });

  describe("getPatientNotifications", () => {
    it("should return all notifications", async () => {
      const result = await getPatientNotifications(
        "portal-user-id",
        "patient-id",
        false,
      );

      expect(result).toEqual([]);
    });

    it("should return only unread notifications", async () => {
      const result = await getPatientNotifications(
        "portal-user-id",
        "patient-id",
        true,
      );

      expect(result).toEqual([]);
    });
  });

  describe("markNotificationAsRead", () => {
    it("should mark notification as read", async () => {
      const result = await markNotificationAsRead(
        "portal-user-id",
        "patient-id",
        "notification-id",
      );

      expect(result).toBe(true);
    });
  });

  describe("getPatientMessages", () => {
    it("should return all messages", async () => {
      const result = await getPatientMessages(
        "portal-user-id",
        "patient-id",
        false,
      );

      expect(result).toEqual([]);
    });

    it("should return only unread messages", async () => {
      const result = await getPatientMessages(
        "portal-user-id",
        "patient-id",
        true,
      );

      expect(result).toEqual([]);
    });
  });

  describe("sendMessage", () => {
    it("should send message successfully", async () => {
      const result = await sendMessage(
        "portal-user-id",
        "patient-id",
        "Test Subject",
        "Test message body",
        "normal",
      );

      expect(result).toBeNull();
    });

    it("should send message with parent for threading", async () => {
      const result = await sendMessage(
        "portal-user-id",
        "patient-id",
        "Re: Test Subject",
        "Reply message",
        "normal",
        "parent-message-id",
      );

      expect(result).toBeNull();
    });
  });

  describe("markMessageAsRead", () => {
    it("should mark message as read", async () => {
      const result = await markMessageAsRead(
        "portal-user-id",
        "patient-id",
        "message-id",
      );

      expect(result).toBe(true);
    });
  });
});

// A query builder that accepts any chain of filters and resolves to `result`.
function query(result: Record<string, unknown>): unknown {
  const builder: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (
            resolve: (value: unknown) => unknown,
            reject: (reason: unknown) => unknown,
          ) => Promise.resolve(result).then(resolve, reject);
        }
        return () => builder;
      },
    },
  );
  return builder;
}

type Mocked = {
  from: ReturnType<typeof vi.fn>;
  rpc: ReturnType<typeof vi.fn>;
};

function mockTables(results: Record<string, Record<string, unknown>>) {
  const sb = supabase as unknown as Mocked;
  sb.from.mockImplementation((table: string) =>
    query(results[table] ?? { data: [], error: null, count: 0 }),
  );
  return sb;
}

const PATIENT_ROW = {
  id: "patient-id",
  given_name: "Test",
  family_name: "Patient",
  dob: "1990-01-01",
  sex: "female",
  phone: "",
  email: null,
};

describe("explicit error flags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("medical history reports a failed load instead of 'no visits'", async () => {
    mockTables({ visits: { data: null, error: { code: "57014" }, count: null } });
    const result = await getPatientMedicalHistory("u", "patient-id", 10, 0);
    expect(result.records).toEqual([]);
    expect(result.error).toBe("failed");
  });

  it("medical history has no error flag when there are simply no visits", async () => {
    mockTables({ visits: { data: [], error: null, count: 0 } });
    const result = await getPatientMedicalHistory("u", "patient-id", 10, 0);
    expect(result).toEqual({ records: [], total: 0 });
  });

  it("medical history reports a failure when visit details do not load", async () => {
    mockTables({
      visits: { data: [{ id: "v1", started_at: "2026-09-01T08:00:00Z" }], error: null, count: 1 },
      consultations: { data: null, error: { code: "57014" } },
    });
    const result = await getPatientMedicalHistory("u", "patient-id", 10, 0);
    expect(result.error).toBe("failed");
    expect(result.records).toEqual([]);
  });

  it("tells a missing visit apart from a failed load", async () => {
    mockTables({ visits: { data: null, error: null } });
    expect(await loadVisitDetails("u", "patient-id", "v1")).toEqual({
      visit: null,
      error: "not_found",
    });

    mockTables({ visits: { data: null, error: { code: "57014" } } });
    expect(await loadVisitDetails("u", "patient-id", "v1")).toEqual({
      visit: null,
      error: "failed",
    });
    expect(await getVisitDetails("u", "patient-id", "v1")).toBeNull();
  });

  it("dashboard lists only released lab results, through the portal RPC", async () => {
    const sb = mockTables({
      patients: { data: PATIENT_ROW, error: null },
      vitals: { data: null, error: null },
    });
    sb.rpc.mockResolvedValueOnce({
      data: [
        {
          result_id: "r1",
          order_id: "o1",
          patient_id: "patient-id",
          test_name: "Haemoglobin",
          test_code: null,
          specimen_type: null,
          ordered_at: null,
          result_value: "12.5",
          result_unit: "g/dL",
          reference_range: null,
          interpretation: "abnormal",
          result_date: "2026-09-01T10:00:00Z",
          released_at: "2026-09-02T10:00:00Z",
          patient_note: null,
        },
      ],
      error: null,
    });

    const { data, error } = await loadPatientDashboard("auth-1", "patient-id");
    expect(error).toBeUndefined();
    expect(sb.rpc).toHaveBeenCalledWith("portal_my_lab_results", {
      p_limit: 5,
      p_patient_id: "patient-id",
    });
    // Never a direct read of lab_results / lab_orders (that would include
    // results nobody has reviewed or released).
    const tables = sb.from.mock.calls.map((c: unknown[]) => c[0]);
    expect(tables).not.toContain("lab_results");
    expect(tables).not.toContain("lab_orders");
    expect(data?.recentLabResultsStatus).toBe("ok");
    expect(data?.recentLabResults).toEqual([
      {
        testName: "Haemoglobin",
        resultDate: new Date("2026-09-01T10:00:00Z"),
        interpretation: "abnormal",
      },
    ]);
    expect(data?.failedSections).toBeUndefined();
  });

  it("dashboard flags lab results and sections that failed to load", async () => {
    const sb = mockTables({
      patients: { data: PATIENT_ROW, error: null },
      vitals: { data: null, error: null },
      appointments: { data: null, error: { code: "57014" } },
    });
    sb.rpc.mockResolvedValueOnce({ data: null, error: { code: "57014" } });
    const { data } = await loadPatientDashboard("auth-1", "patient-id");
    expect(data?.recentLabResults).toEqual([]);
    expect(data?.recentLabResultsStatus).toBe("failed");
    expect(data?.failedSections).toEqual(["appointments", "labResults"]);
  });

  it("dashboard does not read lab results for a different online account", async () => {
    const sb = mockTables({
      patients: { data: PATIENT_ROW, error: null },
      vitals: { data: null, error: null },
    });
    // This device is signed in online as "auth-1"; the portal user is not.
    const { data } = await loadPatientDashboard("portal-user-2", "patient-id");
    expect(sb.rpc).not.toHaveBeenCalled();
    expect(data?.recentLabResults).toEqual([]);
    expect(data?.recentLabResultsStatus).toBe("not_signed_in");
    expect(data?.failedSections).toBeUndefined();
  });

  it("dashboard treats a Supabase error instance with PGRST116 as not found", async () => {
    class PostgrestError extends Error {
      code = "PGRST116";
      constructor() {
        super("row data that must not be logged");
        this.name = "PostgrestError";
      }
    }
    mockTables({ patients: { data: null, error: new PostgrestError() } });
    expect(await loadPatientDashboard("auth-1", "patient-id")).toEqual({
      data: null,
      error: "not_found",
    });
  });

  it("dashboard says not found rather than failed for a missing patient", async () => {
    mockTables({ patients: { data: null, error: { code: "PGRST116" } } });
    expect(await loadPatientDashboard("u", "patient-id")).toEqual({
      data: null,
      error: "not_found",
    });
  });
});
