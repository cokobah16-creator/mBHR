import { describe, it, expect, vi, beforeEach } from "vitest";

// --- mocks ---
const { mockFrom, mockRequestChange, mockGetCommands, mockDrain } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockRequestChange: vi.fn(),
  mockGetCommands: vi.fn(),
  mockDrain: vi.fn().mockResolvedValue(null),
}));

vi.mock("./portalAccess", () => ({
  requestPortalAccessChange: mockRequestChange,
  getPortalAccessCommands: mockGetCommands,
}));
vi.mock("@/sync/adapter", () => ({ drainServerCommands: mockDrain }));
const authState = vi.hoisted(() => ({
  currentUser: { id: "admin-1", role: "admin" } as { id: string; role: string } | null,
}));
vi.mock("@/stores/auth", () => ({
  useAuthStore: { getState: () => authState },
}));

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
  sendPortalInvitation,
} from "./unifiedPortalEnrollment";

describe("bulkEnrollPatients", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequestChange.mockImplementation(async (id: string) => ({
      ok: true,
      state: "waiting_for_server",
      commandId: `cmd-${id}`,
    }));
    mockGetCommands.mockImplementation(async (ids: string[]) =>
      ids.map((id) => ({ id, status: "pending" })),
    );
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

  it("asks for portal access through the outbox and reports the server's answers", async () => {
    const patientsUpdate = vi.fn();
    mockFrom.mockImplementation((table: string) => {
      if (table === "patients") {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: [
                { id: "id1", given_name: "A", family_name: "B", dob: "1990-01-01", email: "a@t.com" },
                { id: "id2", given_name: "C", family_name: "D", dob: "1990-01-01", email: "c@t.com" },
              ],
              error: null,
            }),
          }),
          update: patientsUpdate,
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: null }) }),
          ilike: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: null }) }),
        }),
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: "portal-u" }, error: null }),
          }),
        }),
      };
    });
    mockGetCommands.mockResolvedValue([
      { id: "cmd-id1", status: "applied" },
      { id: "cmd-id2", status: "rejected", rejectReason: "newer_decision_on_server" },
    ]);

    const result = await bulkEnrollPatients(["id1", "id2"]);

    // Never writes patients.portal_enabled directly.
    expect(patientsUpdate).not.toHaveBeenCalled();
    expect(mockRequestChange).toHaveBeenCalledWith("id1", true, {
      reason: "registration",
      serverRecord: true,
    });
    expect(mockDrain).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(2);
    expect(result.access?.applied).toBe(1);
    expect(result.access?.pending).toBe(0);
    expect(result.access?.rejected).toEqual([
      { patientId: "id2", error: expect.stringMatching(/server's setting was kept/) },
    ]);
  });
});

describe("enrollPatientInPortal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.currentUser = { id: "admin-1", role: "admin" };
  });

  it("refuses a role without portal_manage before any server call", async () => {
    authState.currentUser = { id: "ph", role: "pharmacist" };

    const result = await enrollPatientInPortal({
      patientId: "p1",
      givenName: "Ada",
      familyName: "Obi",
      dob: "1990-01-01",
      email: "ada@test.com",
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/role cannot/);
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockRequestChange).not.toHaveBeenCalled();
  });

  it("queues portal access when the device is offline instead of failing", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    mockRequestChange.mockResolvedValue({ ok: true, state: "waiting_for_server", commandId: "c1" });

    const result = await enrollPatientInPortal({
      patientId: "p1",
      givenName: "Ada",
      familyName: "Obi",
      dob: "1990-01-01",
      phone: "08012345678",
    });

    expect(result).toMatchObject({ success: true, pending: true, commandId: "c1" });
    expect(result.message).toMatch(/waits for the server/);
    expect(mockFrom).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("passes on a refusal to change portal access", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    mockRequestChange.mockResolvedValue({ ok: false, error: "Your role cannot change portal access." });

    const result = await enrollPatientInPortal({
      patientId: "p1",
      givenName: "Ada",
      familyName: "Obi",
      dob: "1990-01-01",
      email: "ada@test.com",
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/role cannot/);
    vi.unstubAllGlobals();
  });
});

describe("sendPortalInvitation (portal_invite)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuses a volunteer, who may still enable portal access", async () => {
    authState.currentUser = { id: "vol-1", role: "volunteer" };

    const result = await sendPortalInvitation("p1");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/cannot send portal invitations/);
    expect(result.error).toMatch(/Registration lead/);
    expect(mockFrom).not.toHaveBeenCalled();

    vi.stubGlobal("navigator", { onLine: false });
    mockRequestChange.mockResolvedValue({ ok: true, state: "waiting_for_server", commandId: "c1" });
    const enrolled = await enrollPatientInPortal({
      patientId: "p1",
      givenName: "Ada",
      familyName: "Obi",
      dob: "1990-01-01",
      phone: "08012345678",
    });
    expect(enrolled.success).toBe(true);
    vi.unstubAllGlobals();
  });

  it("refuses a nurse and a pharmacist", async () => {
    for (const role of ["nurse", "pharmacist", "doctor"]) {
      authState.currentUser = { id: `${role}-1`, role };
      const result = await sendPortalInvitation("p1");
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/cannot send portal invitations/);
    }
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("lets a registration lead through to the server", async () => {
    authState.currentUser = { id: "rl-1", role: "registration_lead" };
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: { code: "PGRST116" } }),
        }),
      }),
    });

    const result = await sendPortalInvitation("p1");

    expect(mockFrom).toHaveBeenCalledWith("patients");
    expect(result).toMatchObject({ success: false, error: "Patient not found" });
  });
});
