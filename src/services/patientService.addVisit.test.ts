import { beforeEach, describe, expect, it, vi } from "vitest";

const { fromMock, loggerErrorMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock("@/lib/supabaseClient", () => ({
  supabase: {
    from: fromMock,
  },
}));

vi.mock("@/lib/logger", () => ({
  error: loggerErrorMock,
}));

import { addVisit } from "./patientService";

describe("patientService.addVisit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an error and rolls back the visit when consultation insert fails", async () => {
    const visitsInsertMock = vi.fn().mockResolvedValue({ error: null });
    const consultInsertMock = vi.fn().mockResolvedValue({
      error: { message: "consultation insert denied" },
    });
    const rollbackEqMock = vi.fn().mockResolvedValue({ error: null });
    const visitsDeleteMock = vi.fn(() => ({ eq: rollbackEqMock }));

    fromMock.mockImplementation((table: string) => {
      if (table === "visits") {
        return {
          insert: visitsInsertMock,
          delete: visitsDeleteMock,
        };
      }

      if (table === "consultations") {
        return {
          insert: consultInsertMock,
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("11111111-1111-1111-1111-111111111111")
      .mockReturnValueOnce("22222222-2222-2222-2222-222222222222");

    const result = await addVisit("patient-1", {
      notes: "headache",
      diagnosis: "viral illness",
    });

    expect(result.data).toBeNull();
    expect(result.error).toContain(
      "Consultation save failed; visit was rolled back",
    );
    expect(visitsInsertMock).toHaveBeenCalledOnce();
    expect(consultInsertMock).toHaveBeenCalledOnce();
    expect(visitsDeleteMock).toHaveBeenCalledOnce();
    expect(rollbackEqMock).toHaveBeenCalledWith(
      "id",
      "11111111-1111-1111-1111-111111111111",
    );
    expect(loggerErrorMock).toHaveBeenCalledWith(
      "[patientService] addVisit (consultation):",
      "consultation insert denied",
    );
  });

  it("returns a combined error when consultation insert fails and rollback also fails", async () => {
    const visitsInsertMock = vi.fn().mockResolvedValue({ error: null });
    const consultInsertMock = vi.fn().mockResolvedValue({
      error: { message: "consultation insert denied" },
    });
    const rollbackEqMock = vi.fn().mockResolvedValue({
      error: { message: "rollback denied" },
    });
    const visitsDeleteMock = vi.fn(() => ({ eq: rollbackEqMock }));

    fromMock.mockImplementation((table: string) => {
      if (table === "visits") {
        return {
          insert: visitsInsertMock,
          delete: visitsDeleteMock,
        };
      }

      if (table === "consultations") {
        return {
          insert: consultInsertMock,
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("11111111-1111-1111-1111-111111111111")
      .mockReturnValueOnce("22222222-2222-2222-2222-222222222222");

    const result = await addVisit("patient-1", {
      notes: "headache",
      diagnosis: "viral illness",
    });

    expect(result.data).toBeNull();
    expect(result.error).toContain(
      "Consultation save failed and visit cleanup failed",
    );
    expect(result.error).toContain("rollback denied");
    expect(visitsDeleteMock).toHaveBeenCalledOnce();
    expect(rollbackEqMock).toHaveBeenCalledWith(
      "id",
      "11111111-1111-1111-1111-111111111111",
    );
    expect(loggerErrorMock).toHaveBeenCalledWith(
      "[patientService] addVisit (rollback visit):",
      "rollback denied",
    );
  });
});
