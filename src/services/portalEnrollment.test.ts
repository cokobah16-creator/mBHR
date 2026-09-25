import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSupabase, mockFrom, mockFunctionsInvoke } = vi.hoisted(() => {
  const mockFrom = vi.fn();
  const mockFunctionsInvoke = vi.fn().mockResolvedValue({ error: null });
  const mockSupabase = {
    from: mockFrom,
    functions: { invoke: mockFunctionsInvoke },
  };
  return { mockSupabase, mockFrom, mockFunctionsInvoke };
});

const { mockPatientsGet, mockPatientsUpdate, mockPatientsWhere, mockPatientsBulkGet } = vi.hoisted(
  () => {
    const mockPatientsUpdate = vi.fn().mockResolvedValue(1);
    const mockPatientsGet = vi.fn();
    const mockPatientsBulkGet = vi.fn().mockResolvedValue([]);
    const mockEqualsFirst = vi.fn();
    const mockWhere = vi
      .fn()
      .mockReturnValue({
        equals: vi.fn().mockReturnValue({ first: mockEqualsFirst }),
      });
    return {
      mockPatientsGet,
      mockPatientsBulkGet,
      mockPatientsUpdate,
      mockPatientsWhere: mockWhere,
      mockEqualsFirst,
    };
  },
);

const { mockRequestChange, mockDrain } = vi.hoisted(() => ({
  mockRequestChange: vi.fn(),
  mockDrain: vi.fn().mockResolvedValue(null),
}));

// Default: a registration lead (portal_manage and portal_invite).
const authState = vi.hoisted(() => ({
  currentUser: { id: "lead-1", role: "registration_lead" } as { id: string; role: string } | null,
}));
vi.mock("@/stores/auth", () => ({
  useAuthStore: { getState: () => authState },
}));
vi.mock("@/lib/supabase", () => ({ supabase: mockSupabase }));
vi.mock("./portalAccess", () => ({ requestPortalAccessChange: mockRequestChange }));
vi.mock("@/sync/adapter", () => ({ drainServerCommands: mockDrain }));
vi.mock("@/db", () => ({
  db: {
    patients: {
      get: mockPatientsGet,
      update: mockPatientsUpdate,
      where: mockPatientsWhere,
      bulkGet: mockPatientsBulkGet,
    },
  },
}));
vi.mock("@/utils/phone", () => ({ normalizePhone: (p: string) => p }));
vi.mock("@/utils/errors", () => ({
  getErrorMessage: (e: unknown) =>
    e instanceof Error ? e.message : "Unknown error",
}));
vi.mock("@/lib/logger", () => ({
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

import {
  enablePortalAccess,
  disablePortalAccess,
  sendPortalInvitation,
  getPortalStatus,
  linkAuthUserToPatient,
  findEligiblePatients,
  bulkEnablePortalAccess,
  INVITE_NOT_SENT_REASONS,
} from "./portalEnrollment";
import type { Patient } from "@/db";
import { MINOR_PORTAL_ACCESS_MESSAGE } from "@/pages/legal/policyMeta";

/** 1 January, ten years ago: someone under 18 whatever today's date is. */
function childDob(): string {
  return `${new Date().getFullYear() - 10}-01-01`;
}

function makePatient(overrides: Partial<Patient> = {}): Patient {
  return {
    id: "p1",
    givenName: "Ada",
    familyName: "Obi",
    phone: "08012345678",
    email: "ada@example.com",
    portalEnabled: 0,
    _dirty: 0,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date(),
    ...overrides,
  } as Patient;
}

function makeChain(
  data: unknown = null,
  error: null | object = null,
  singleRow: unknown = null,
) {
  const chain: Record<string, unknown> = {
    then: (r: (v: unknown) => unknown) =>
      Promise.resolve({ data, error }).then(r),
    select: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    insert: vi.fn().mockResolvedValue({ error: null }),
    upsert: vi.fn().mockResolvedValue({ error: null }),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: singleRow, error: null }),
  };
  (chain.eq as ReturnType<typeof vi.fn>).mockReturnValue(chain);
  return chain;
}

describe("enablePortalAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.currentUser = { id: "lead-1", role: "registration_lead" };
  });

  it("returns error when patient not found", async () => {
    mockPatientsGet.mockResolvedValue(undefined);

    const result = await enablePortalAccess("p1", { termsAccepted: true });

    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("returns error when terms not accepted", async () => {
    mockPatientsGet.mockResolvedValue(makePatient());

    const result = await enablePortalAccess("p1", { termsAccepted: false });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Terms");
  });

  it("returns error when patient has no contact info", async () => {
    mockPatientsGet.mockResolvedValue(makePatient({ phone: "", email: "" }));

    const result = await enablePortalAccess("p1", { termsAccepted: true });

    expect(result.success).toBe(false);
    expect(result.error).toContain("email or phone");
  });

  it("queues the change for the server and reports it as waiting", async () => {
    mockPatientsGet.mockResolvedValue(makePatient());
    mockRequestChange.mockResolvedValue({ ok: true, state: "waiting_for_server" });

    const result = await enablePortalAccess("p1", { termsAccepted: true });

    expect(result).toMatchObject({ success: true, pending: true, deviceOnly: false });
    expect(mockRequestChange).toHaveBeenCalledWith("p1", true, { reason: "staff_choice" });
    // No direct write of portal access and no server table insert here.
    expect(mockPatientsUpdate).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("says when the change stays on this device (no server)", async () => {
    mockPatientsGet.mockResolvedValue(makePatient());
    mockRequestChange.mockResolvedValue({ ok: true, state: "device_only" });

    const result = await enablePortalAccess("p1", { termsAccepted: true });

    expect(result).toMatchObject({ success: true, pending: false, deviceOnly: true });
  });

  it("passes on a refusal (for example the role cannot manage portal access)", async () => {
    mockPatientsGet.mockResolvedValue(makePatient());
    mockRequestChange.mockResolvedValue({
      ok: false,
      error: "Your role cannot change portal access.",
    });

    const result = await enablePortalAccess("p1", { termsAccepted: true });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/role cannot/);
  });

  it("returns false when the request throws", async () => {
    mockPatientsGet.mockResolvedValue(makePatient());
    mockRequestChange.mockRejectedValueOnce(new Error("crash"));

    const result = await enablePortalAccess("p1", { termsAccepted: true });

    expect(result.success).toBe(false);
  });

  it("turns access on for a volunteer but does not invite (no portal_invite)", async () => {
    authState.currentUser = { id: "vol-1", role: "volunteer" };
    mockPatientsGet.mockResolvedValue(makePatient());
    mockRequestChange.mockResolvedValue({ ok: true, state: "waiting_for_server" });

    const result = await enablePortalAccess("p1", {
      termsAccepted: true,
      sendInviteNow: true,
    });

    expect(result).toMatchObject({ success: true, pending: true, inviteDeferred: true });
    expect(result.inviteError).toMatch(/cannot send portal invitations/);
    expect(mockRequestChange).toHaveBeenCalledWith("p1", true, { reason: "staff_choice" });
    expect(mockDrain).not.toHaveBeenCalled();
    expect(mockFunctionsInvoke).not.toHaveBeenCalled();
  });

  it("does not invite while the server has not confirmed access", async () => {
    mockPatientsGet.mockResolvedValue(makePatient({ portalEnabled: 1, portalPending: 1 }));
    mockRequestChange.mockResolvedValue({ ok: true, state: "waiting_for_server" });

    const result = await enablePortalAccess("p1", {
      termsAccepted: true,
      sendInviteNow: true,
    });

    expect(mockDrain).toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.inviteDeferred).toBe(true);
    expect(result.inviteError).toMatch(/waiting for the server/);
    expect(mockFunctionsInvoke).not.toHaveBeenCalled();
  });

  it("refuses a patient under 18 and queues nothing", async () => {
    mockPatientsGet.mockResolvedValue(makePatient({ dob: childDob() }));

    const result = await enablePortalAccess("p1", {
      termsAccepted: true,
      sendInviteNow: true,
    });

    expect(result).toEqual({ success: false, error: MINOR_PORTAL_ACCESS_MESSAGE });
    expect(mockRequestChange).not.toHaveBeenCalled();
    expect(mockPatientsUpdate).not.toHaveBeenCalled();
    expect(mockFunctionsInvoke).not.toHaveBeenCalled();
  });

  it("does not refuse a record whose date of birth is missing or unreadable", async () => {
    mockRequestChange.mockResolvedValue({ ok: true, state: "waiting_for_server" });

    for (const dob of [undefined, "", "not a date"]) {
      mockPatientsGet.mockResolvedValue(makePatient({ dob }));
      const result = await enablePortalAccess("p1", { termsAccepted: true });
      expect(result.success).toBe(true);
    }
    expect(mockRequestChange).toHaveBeenCalledTimes(3);
  });
});

describe("disablePortalAccess", () => {
  beforeEach(() => vi.clearAllMocks());

  it("queues the disable for the server", async () => {
    mockRequestChange.mockResolvedValue({ ok: true, state: "waiting_for_server" });

    const result = await disablePortalAccess("p1");

    expect(result).toMatchObject({ success: true, pending: true });
    expect(mockRequestChange).toHaveBeenCalledWith("p1", false, { reason: "staff_choice" });
    expect(mockPatientsUpdate).not.toHaveBeenCalled();
  });

  it("returns the refusal when the change is not allowed", async () => {
    mockRequestChange.mockResolvedValue({ ok: false, error: "Sign in to change portal access." });

    const result = await disablePortalAccess("p1");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Sign in/);
  });

  it("returns error when the request throws", async () => {
    mockRequestChange.mockRejectedValueOnce(new Error("crash"));

    const result = await disablePortalAccess("p1");

    expect(result.success).toBe(false);
  });

  it("still turns access off for a patient under 18", async () => {
    mockPatientsGet.mockResolvedValue(makePatient({ dob: childDob(), portalEnabled: 1 }));
    mockRequestChange.mockResolvedValue({ ok: true, state: "waiting_for_server" });

    const result = await disablePortalAccess("p1");

    expect(result).toMatchObject({ success: true, pending: true });
    expect(mockRequestChange).toHaveBeenCalledWith("p1", false, { reason: "staff_choice" });
  });
});

describe("sendPortalInvitation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.currentUser = { id: "lead-1", role: "registration_lead" };
    mockFrom.mockReturnValue(makeChain());
    mockFunctionsInvoke.mockResolvedValue({ error: null });
  });

  it("refuses every role without portal_invite before any write or message", async () => {
    mockPatientsGet.mockResolvedValue(makePatient({ portalEnabled: 1 }));

    for (const role of ["volunteer", "nurse", "doctor", "pharmacist", "auditor", "guest"]) {
      authState.currentUser = { id: `${role}-1`, role };
      const result = await sendPortalInvitation("p1");
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/cannot send portal invitations/);
      expect(result.error).toMatch(/Registration lead/);
    }
    expect(mockPatientsUpdate).not.toHaveBeenCalled();
    expect(mockFunctionsInvoke).not.toHaveBeenCalled();
  });

  it("lets lead clinicians and admins send invitations", async () => {
    mockPatientsGet.mockResolvedValue(makePatient({ portalEnabled: 1 }));
    mockFunctionsInvoke.mockResolvedValue({ data: { success: true }, error: null });

    for (const role of ["lead_clinician", "admin"]) {
      authState.currentUser = { id: `${role}-1`, role };
      const result = await sendPortalInvitation("p1");
      expect(result.success).toBe(true);
    }
    expect(mockFunctionsInvoke).toHaveBeenCalledTimes(2);
  });

  it("refuses a patient under 18 even when access is already on", async () => {
    mockPatientsGet.mockResolvedValue(makePatient({ portalEnabled: 1, dob: childDob() }));

    const result = await sendPortalInvitation("p1");

    expect(result).toEqual({ success: false, error: MINOR_PORTAL_ACCESS_MESSAGE });
    expect(mockFunctionsInvoke).not.toHaveBeenCalled();
    expect(mockPatientsUpdate).not.toHaveBeenCalled();
  });

  it("refuses when nobody is signed in", async () => {
    authState.currentUser = null;

    const result = await sendPortalInvitation("p1");

    expect(result.success).toBe(false);
    expect(mockPatientsUpdate).not.toHaveBeenCalled();
  });

  it("returns error when patient not found", async () => {
    mockPatientsGet.mockResolvedValue(undefined);

    const result = await sendPortalInvitation("p1");

    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("returns error when portal not enabled", async () => {
    mockPatientsGet.mockResolvedValue(makePatient({ portalEnabled: 0 }));

    const result = await sendPortalInvitation("p1");

    expect(result.success).toBe(false);
    expect(result.error).toContain("not enabled");
  });

  it("refuses while portal access is waiting for the server", async () => {
    mockPatientsGet.mockResolvedValue(makePatient({ portalEnabled: 1, portalPending: 1 }));

    const result = await sendPortalInvitation("p1");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/waiting for the server/);
    expect(mockFunctionsInvoke).not.toHaveBeenCalled();
  });

  it("sends via edge function and marks status=sent only when the server confirms", async () => {
    mockPatientsGet.mockResolvedValue(makePatient({ portalEnabled: 1 }));
    mockFunctionsInvoke.mockResolvedValue({ data: { success: true }, error: null });

    const result = await sendPortalInvitation("p1");

    expect(result.success).toBe(true);
    expect(result.demoOTP).toBeUndefined();
    // Purpose and patient id only: the server looks up the address and
    // builds the text.
    expect(mockFunctionsInvoke).toHaveBeenCalledWith("send-otp-email", {
      body: { purpose: "portal_invitation", patientId: "p1", appOrigin: expect.any(String) },
    });
    expect(JSON.stringify(mockFunctionsInvoke.mock.calls)).not.toContain("ada@example.com");
    expect(mockPatientsUpdate).toHaveBeenLastCalledWith(
      "p1",
      expect.objectContaining({
        portalInvitation: expect.objectContaining({ lastStatus: "sent" }),
      }),
    );
  });

  it("does not record a demo-mode email as sent", async () => {
    mockPatientsGet.mockResolvedValue(makePatient({ portalEnabled: 1 }));
    mockFunctionsInvoke.mockResolvedValue({ data: { success: true, demo: true }, error: null });

    const result = await sendPortalInvitation("p1");

    expect(result.success).toBe(true);
    expect(result.demoOTP).toMatch(/No email or SMS was sent/);
    expect(mockPatientsUpdate).toHaveBeenLastCalledWith(
      "p1",
      expect.objectContaining({
        portalInvitation: expect.objectContaining({
          lastStatus: "failed",
          failureReason: INVITE_NOT_SENT_REASONS.demoMode,
        }),
      }),
    );
  });

  it("sends SMS through send-sms-reminder as a portal invitation, never the number or text", async () => {
    mockPatientsGet.mockResolvedValue(makePatient({ portalEnabled: 1, email: "" }));
    mockFunctionsInvoke.mockResolvedValue({ data: { success: true, provider: "termii" }, error: null });

    const result = await sendPortalInvitation("p1");

    expect(result.success).toBe(true);
    expect(result.demoOTP).toBeUndefined();
    expect(mockFunctionsInvoke).toHaveBeenCalledWith("send-sms-reminder", {
      body: { purpose: "portal_invitation", patientId: "p1", appOrigin: expect.any(String) },
    });
    expect(JSON.stringify(mockFunctionsInvoke.mock.calls)).not.toContain("08012345678");
    expect(mockFunctionsInvoke).not.toHaveBeenCalledWith("send-otp-sms", expect.anything());
    expect(mockPatientsUpdate).toHaveBeenLastCalledWith(
      "p1",
      expect.objectContaining({
        portalInvitation: expect.objectContaining({ lastStatus: "sent" }),
      }),
    );
  });

  it("does not record an SMS as sent without success, or in demo mode", async () => {
    mockPatientsGet.mockResolvedValue(makePatient({ portalEnabled: 1, email: "" }));
    mockFunctionsInvoke.mockResolvedValue({ data: { success: true, demo: true }, error: null });

    const demo = await sendPortalInvitation("p1");
    expect(demo.demoOTP).toMatch(/No email or SMS was sent/);

    mockFunctionsInvoke.mockResolvedValue({ data: null, error: { name: "FunctionsHttpError" } });
    const failed = await sendPortalInvitation("p1");
    expect(failed.success).toBe(true);
    expect(failed.demoOTP).toMatch(/No email or SMS was sent/);
    expect(mockPatientsUpdate).toHaveBeenLastCalledWith(
      "p1",
      expect.objectContaining({
        portalInvitation: expect.objectContaining({
          lastStatus: "failed",
          failureReason: INVITE_NOT_SENT_REASONS.serviceFailed,
        }),
      }),
    );
  });

  it("falls back to a link (recorded as not sent) when edge function fails", async () => {
    mockPatientsGet.mockResolvedValue(makePatient({ portalEnabled: 1 }));
    mockFunctionsInvoke.mockResolvedValue({ error: { message: "fn error" } });

    const result = await sendPortalInvitation("p1");

    expect(result.success).toBe(true);
    expect(result.registrationUrl).toBeDefined();
    expect(mockPatientsUpdate).toHaveBeenLastCalledWith(
      "p1",
      expect.objectContaining({
        portalInvitation: expect.objectContaining({ lastStatus: "failed" }),
      }),
    );
  });

  it("enforces rate limit when invite was sent recently", async () => {
    const patient = makePatient({
      portalEnabled: 1,
      portalInvitation: {
        lastSentAt: new Date(Date.now() - 1000).toISOString(),
        lastStatus: "sent",
        count: 1,
        failureReason: null,
      },
    });
    mockPatientsGet.mockResolvedValue(patient);

    const result = await sendPortalInvitation("p1");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/wait/i);
  });
});

describe("getPortalStatus", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null when patient not found", async () => {
    mockPatientsGet.mockResolvedValue(undefined);

    const result = await getPortalStatus("p1");

    expect(result).toBeNull();
  });

  it("returns correct status for enabled patient", async () => {
    mockPatientsGet.mockResolvedValue(
      makePatient({
        portalEnabled: 1,
        contactVerified: 1,
        email: "ada@example.com",
      }),
    );

    const status = await getPortalStatus("p1");

    expect(status).not.toBeNull();
    expect(status!.enabled).toBe(true);
    expect(status!.verified).toBe(true);
    expect(status!.contactMethod).toBe("email");
    expect(status!.canResend).toBe(true);
  });

  it("canResend is false when portal is disabled", async () => {
    mockPatientsGet.mockResolvedValue(makePatient({ portalEnabled: 0 }));

    const status = await getPortalStatus("p1");

    expect(status!.canResend).toBe(false);
  });

  it("reports a change waiting for the server and blocks invitations", async () => {
    mockPatientsGet.mockResolvedValue(makePatient({ portalEnabled: 1, portalPending: 1 }));

    const status = await getPortalStatus("p1");

    expect(status!.enabled).toBe(true);
    expect(status!.pending).toBe(true);
    expect(status!.canResend).toBe(false);
  });

  it("marks a patient under 18, even with access already on", async () => {
    mockPatientsGet.mockResolvedValue(makePatient({ portalEnabled: 1, dob: childDob() }));

    const status = await getPortalStatus("p1");

    expect(status!.enabled).toBe(true);
    expect(status!.minor).toBe(true);
  });

  it("does not mark an adult or a record with no date of birth", async () => {
    mockPatientsGet.mockResolvedValue(makePatient({ dob: "1990-01-01" }));
    expect((await getPortalStatus("p1"))!.minor).toBe(false);

    mockPatientsGet.mockResolvedValue(makePatient({ dob: undefined }));
    expect((await getPortalStatus("p1"))!.minor).toBe(false);
  });
});

describe("linkAuthUserToPatient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(makeChain());
  });

  it("returns error when patient not found", async () => {
    mockPatientsGet.mockResolvedValue(undefined);

    const result = await linkAuthUserToPatient("uid1", "p1");

    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("returns error when uid already linked to another patient", async () => {
    mockPatientsGet.mockResolvedValue(makePatient());
    mockPatientsWhere.mockReturnValue({
      equals: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue(makePatient({ id: "p99" })),
      }),
    });

    const result = await linkAuthUserToPatient("uid1", "p1");

    expect(result.success).toBe(false);
    expect(result.error).toContain("already linked");
  });

  it("links uid to patient and marks contact verified", async () => {
    mockPatientsGet.mockResolvedValue(makePatient());
    mockPatientsWhere.mockReturnValue({
      equals: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue(undefined),
      }),
    });

    const result = await linkAuthUserToPatient("uid1", "p1");

    expect(result.success).toBe(true);
    expect(mockPatientsUpdate).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({
        authUid: "uid1",
        contactVerified: 1,
        _dirty: 1,
      }),
    );
  });
});

describe("findEligiblePatients", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns patients with contact info", async () => {
    const patients = [
      makePatient({ id: "p1", phone: "080", email: "" }),
      makePatient({ id: "p2", phone: "", email: "b@x.com" }),
      makePatient({ id: "p3", phone: "", email: "" }), // excluded — no contact
    ];
    mockPatientsWhere.mockReturnValue({
      equals: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue(patients),
      }),
    });

    const result = await findEligiblePatients();

    expect(result).toHaveLength(2);
    expect(result.map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("leaves out patients with a change waiting and merged-away records", async () => {
    const patients = [
      makePatient({ id: "p1", phone: "080" }),
      makePatient({ id: "p2", phone: "080", portalPending: 1 }),
      makePatient({ id: "p3", phone: "080", mergeInto: "p1" }),
    ];
    mockPatientsWhere.mockReturnValue({
      equals: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue(patients),
      }),
    });

    const result = await findEligiblePatients();

    expect(result.map((p) => p.id)).toEqual(["p1"]);
  });

  it("leaves out patients under 18 but keeps a record with no date of birth", async () => {
    const patients = [
      makePatient({ id: "p1", dob: "1990-01-01" }),
      makePatient({ id: "p2", dob: childDob() }),
      makePatient({ id: "p3" }), // no date of birth: still listed
    ];
    mockPatientsWhere.mockReturnValue({
      equals: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue(patients),
      }),
    });

    const result = await findEligiblePatients();

    expect(result.map((p) => p.id)).toEqual(["p1", "p3"]);
  });

  it("filters by contactMethod=email", async () => {
    const patients = [
      makePatient({ id: "p1", phone: "080", email: "" }),
      makePatient({ id: "p2", phone: "", email: "b@x.com" }),
    ];
    mockPatientsWhere.mockReturnValue({
      equals: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue(patients),
      }),
    });

    const result = await findEligiblePatients({ contactMethod: "email" });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("p2");
  });

  it("returns empty array on db error", async () => {
    mockPatientsWhere.mockReturnValue({
      equals: vi.fn().mockReturnValue({
        toArray: vi.fn().mockRejectedValue(new Error("crash")),
      }),
    });

    const result = await findEligiblePatients();

    expect(result).toEqual([]);
  });
});

describe("bulkEnablePortalAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.currentUser = { id: "lead-1", role: "registration_lead" };
    mockPatientsBulkGet.mockResolvedValue([]);
  });

  it("refuses enable-and-invite for a role without portal_invite, changing nothing", async () => {
    authState.currentUser = { id: "nurse-1", role: "nurse" };

    const result = await bulkEnablePortalAccess(["p1", "p2"], { sendInvitations: true });

    expect(result.success).toBe(0);
    expect(result.failed).toBe(2);
    expect(result.errors.map((e) => e.patientId)).toEqual(["p1", "p2"]);
    expect(result.errors[0].error).toMatch(/cannot send portal invitations/);
    expect(mockRequestChange).not.toHaveBeenCalled();
    expect(mockFunctionsInvoke).not.toHaveBeenCalled();
  });

  it("queues every patient and counts refusals", async () => {
    mockPatientsGet.mockImplementation(async (id: string) => makePatient({ id }));
    mockRequestChange.mockImplementation(async (id: string) =>
      id === "p2" ? { ok: false, error: "Your role cannot change portal access." } : { ok: true, state: "waiting_for_server" },
    );
    mockPatientsBulkGet.mockResolvedValue([makePatient({ id: "p1", portalPending: 1 })]);
    const onProgress = vi.fn();

    const result = await bulkEnablePortalAccess(["p1", "p2"], { onProgress });

    expect(result.success).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.pending).toBe(1);
    expect(result.errors).toEqual([
      { patientId: "p2", error: "Your role cannot change portal access." },
    ]);
    expect(result.invitations).toBeUndefined();
    expect(onProgress).toHaveBeenLastCalledWith(2, 2);
    expect(mockRequestChange).toHaveBeenCalledWith("p1", true, { reason: "bulk_enable" });
  });

  it("lists a patient under 18 as failed with the reason and queues nothing for them", async () => {
    mockPatientsGet.mockImplementation(async (id: string) =>
      makePatient(id === "child" ? { id, dob: childDob() } : { id }),
    );
    mockRequestChange.mockResolvedValue({ ok: true, state: "waiting_for_server" });

    const result = await bulkEnablePortalAccess(["adult", "child"]);

    expect(result.success).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors).toEqual([{ patientId: "child", error: MINOR_PORTAL_ACCESS_MESSAGE }]);
    expect(mockRequestChange).toHaveBeenCalledTimes(1);
    expect(mockRequestChange).toHaveBeenCalledWith("adult", true, { reason: "bulk_enable" });
  });

  it("invites only patients the server has confirmed", async () => {
    mockRequestChange.mockResolvedValue({ ok: true, state: "waiting_for_server" });
    mockPatientsGet.mockImplementation(async (id: string) =>
      id === "p1"
        ? makePatient({ id, portalEnabled: 1, portalPending: 0 })
        : makePatient({ id, portalEnabled: 1, portalPending: 1 }),
    );
    mockFunctionsInvoke.mockResolvedValue({ data: { success: true }, error: null });

    const result = await bulkEnablePortalAccess(["p1", "p2"], { sendInvitations: true });

    expect(mockDrain).toHaveBeenCalledTimes(1);
    expect(result.invitations?.sent).toBe(1);
    expect(result.invitations?.notSent).toHaveLength(1);
    expect(result.invitations?.notSent[0].patientId).toBe("p2");
    expect(result.invitations?.notSent[0].error).toMatch(/waiting for the server/);
  });
});
