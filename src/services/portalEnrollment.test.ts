import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockSupabase,
  mockFrom,
  mockFunctionsInvoke,
  mockGetSession,
  supabaseHolder,
} = vi.hoisted(() => {
  const mockFrom = vi.fn();
  const mockFunctionsInvoke = vi.fn().mockResolvedValue({ error: null });
  // A staff member signed in online, unless a test says otherwise.
  const mockGetSession = vi
    .fn()
    .mockResolvedValue({ data: { session: { access_token: "token" } } });
  const mockSupabase = {
    from: mockFrom,
    functions: { invoke: mockFunctionsInvoke },
    auth: { getSession: mockGetSession },
  };
  // Set client to null to test a device with no server set up.
  const supabaseHolder: { client: typeof mockSupabase | null } = {
    client: mockSupabase,
  };
  return {
    mockSupabase,
    mockFrom,
    mockFunctionsInvoke,
    mockGetSession,
    supabaseHolder,
  };
});

const { mockPatientsGet, mockPatientsUpdate, mockPatientsWhere } = vi.hoisted(
  () => {
    const mockPatientsUpdate = vi.fn().mockResolvedValue(1);
    const mockPatientsGet = vi.fn();
    const mockEqualsFirst = vi.fn();
    const mockWhere = vi
      .fn()
      .mockReturnValue({
        equals: vi.fn().mockReturnValue({ first: mockEqualsFirst }),
      });
    return {
      mockPatientsGet,
      mockPatientsUpdate,
      mockPatientsWhere: mockWhere,
      mockEqualsFirst,
    };
  },
);

vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return supabaseHolder.client;
  },
}));
vi.mock("@/db", () => ({
  db: {
    patients: {
      get: mockPatientsGet,
      update: mockPatientsUpdate,
      where: mockPatientsWhere,
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
  bulkEnablePortalAccess,
  sendPortalInvitation,
  getPortalStatus,
  linkAuthUserToPatient,
  findEligiblePatients,
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
  beforeEach(() => vi.clearAllMocks());

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

  it("enables portal and updates local db on success", async () => {
    mockPatientsGet.mockResolvedValue(makePatient());
    mockFrom.mockReturnValue(makeChain(null, null));

    const result = await enablePortalAccess("p1", { termsAccepted: true });

    expect(result.success).toBe(true);
    expect(mockPatientsUpdate).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ portalEnabled: 1, _dirty: 1 }),
    );
  });

  it("returns false when db update throws", async () => {
    mockPatientsGet.mockResolvedValue(makePatient());
    mockPatientsUpdate.mockRejectedValueOnce(new Error("crash"));

    const result = await enablePortalAccess("p1", { termsAccepted: true });

    expect(result.success).toBe(false);
  });

  it("refuses a patient under 18 and changes nothing", async () => {
    mockPatientsGet.mockResolvedValue(makePatient({ dob: childDob() }));

    const result = await enablePortalAccess("p1", { termsAccepted: true });

    expect(result).toEqual({
      success: false,
      error: MINOR_PORTAL_ACCESS_MESSAGE,
    });
    expect(mockPatientsUpdate).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

/**
 * The server side of a portal access change: update(...).eq(...).select(...)
 * on patients resolves to each of `results` in turn.
 */
function patientsUpdateChain(
  ...results: Array<{ data: unknown; error: unknown }>
) {
  const select = vi.fn();
  for (const r of results) select.mockResolvedValueOnce(r);
  const chain = { update: vi.fn(), eq: vi.fn(), select };
  chain.update.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  return chain;
}

function routeTables(patients: ReturnType<typeof patientsUpdateChain>) {
  const portalUsers = makeChain(null, null);
  mockFrom.mockImplementation((table: string) =>
    table === "patients" ? patients : portalUsers,
  );
}

describe("portal access on the server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseHolder.client = mockSupabase;
    mockPatientsGet.mockResolvedValue(makePatient({ _serverVersion: 3 }));
  });

  it("turns portal_enabled on on the server and says so", async () => {
    const patients = patientsUpdateChain({
      data: [{ id: "p1", portal_enabled: true, row_version: 4 }],
      error: null,
    });
    routeTables(patients);

    const result = await enablePortalAccess("p1", { termsAccepted: true });

    expect(result).toMatchObject({ success: true, server: "updated" });
    expect(patients.update).toHaveBeenCalledWith({ portal_enabled: true });
    expect(patients.eq).toHaveBeenCalledWith("id", "p1");
    // The device's own copy is saved first.
    expect(mockPatientsUpdate).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ portalEnabled: 1 }),
    );
  });

  it("keeps the next server version so the next upload is not a conflict", async () => {
    routeTables(
      patientsUpdateChain({
        data: [{ id: "p1", portal_enabled: true, row_version: 4 }],
        error: null,
      }),
    );

    await enablePortalAccess("p1", { termsAccepted: true });

    expect(mockPatientsUpdate).toHaveBeenCalledWith("p1", {
      _serverVersion: 4,
    });
  });

  it("does not keep a server version that skipped someone else's edit", async () => {
    routeTables(
      patientsUpdateChain({
        data: [{ id: "p1", portal_enabled: true, row_version: 6 }],
        error: null,
      }),
    );

    await enablePortalAccess("p1", { termsAccepted: true });

    expect(mockPatientsUpdate).not.toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ _serverVersion: expect.anything() }),
    );
  });

  it("says only this device changed when no server row was updated", async () => {
    // The record has not been uploaded yet: the update matches no row.
    routeTables(patientsUpdateChain({ data: [], error: null }));

    const result = await enablePortalAccess("p1", { termsAccepted: true });

    expect(result).toMatchObject({ success: true, server: "not-updated" });
    expect(mockPatientsUpdate).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ portalEnabled: 1 }),
    );
  });

  it("says only this device changed when the server refuses", async () => {
    routeTables(
      patientsUpdateChain({ data: null, error: { code: "42501" } }),
    );

    const result = await enablePortalAccess("p1", { termsAccepted: true });

    expect(result).toMatchObject({ success: true, server: "not-updated" });
  });

  it("retries without row_version on a server that lacks it", async () => {
    const patients = patientsUpdateChain(
      { data: null, error: { code: "42703" } },
      { data: [{ id: "p1", portal_enabled: true }], error: null },
    );
    routeTables(patients);

    const result = await enablePortalAccess("p1", { termsAccepted: true });

    expect(result.server).toBe("updated");
    expect(patients.select).toHaveBeenNthCalledWith(
      1,
      "id, portal_enabled, row_version",
    );
    expect(patients.select).toHaveBeenNthCalledWith(2, "id, portal_enabled");
  });

  it("does not contact the server while offline", async () => {
    const onLine = vi
      .spyOn(window.navigator, "onLine", "get")
      .mockReturnValue(false);
    const patients = patientsUpdateChain();
    routeTables(patients);

    try {
      const result = await enablePortalAccess("p1", { termsAccepted: true });

      expect(result).toMatchObject({ success: true, server: "offline" });
      expect(patients.update).not.toHaveBeenCalled();
    } finally {
      onLine.mockRestore();
    }
  });

  it("does not contact the server when nobody is signed in online", async () => {
    // After a PIN unlock the device has no online sign-in, and RLS would
    // refuse the update. Say that, not "record not uploaded yet".
    mockGetSession.mockResolvedValueOnce({ data: { session: null } });
    const patients = patientsUpdateChain();
    routeTables(patients);

    const result = await enablePortalAccess("p1", { termsAccepted: true });

    expect(result).toMatchObject({ success: true, server: "not-signed-in" });
    expect(patients.update).not.toHaveBeenCalled();
    expect(mockPatientsUpdate).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ portalEnabled: 1 }),
    );
  });

  it("says no server is set up when there is none", async () => {
    supabaseHolder.client = null;

    try {
      const result = await enablePortalAccess("p1", { termsAccepted: true });

      expect(result).toMatchObject({ success: true, server: "no-server" });
      expect(mockFrom).not.toHaveBeenCalled();
    } finally {
      supabaseHolder.client = mockSupabase;
    }
  });

  it("turns portal_enabled off on the server too", async () => {
    const patients = patientsUpdateChain({
      data: [{ id: "p1", portal_enabled: false, row_version: 4 }],
      error: null,
    });
    routeTables(patients);

    const result = await disablePortalAccess("p1");

    expect(result).toMatchObject({ success: true, server: "updated" });
    expect(patients.update).toHaveBeenCalledWith({ portal_enabled: false });
  });

  it("lists a patient under 18 as failed with the reason", async () => {
    mockPatientsGet.mockImplementation(async (id: string) =>
      makePatient(id === "child" ? { id, dob: childDob() } : { id }),
    );
    routeTables(
      patientsUpdateChain({
        data: [{ id: "adult", portal_enabled: true }],
        error: null,
      }),
    );

    const result = await bulkEnablePortalAccess(["adult", "child"]);

    expect(result).toMatchObject({ success: 1, failed: 1, serverUpdated: 1 });
    expect(result.errors).toEqual([
      { patientId: "child", error: MINOR_PORTAL_ACCESS_MESSAGE },
    ]);
  });

  it("counts the bulk successes the server took", async () => {
    const patients = patientsUpdateChain(
      { data: [{ id: "p1", portal_enabled: true }], error: null },
      { data: [], error: null },
    );
    routeTables(patients);

    const result = await bulkEnablePortalAccess(["p1", "p2"]);

    expect(result).toMatchObject({ success: 2, failed: 0, serverUpdated: 1 });
  });
});

describe("disablePortalAccess", () => {
  beforeEach(() => vi.clearAllMocks());

  it("disables portal and returns success", async () => {
    const result = await disablePortalAccess("p1");

    expect(result.success).toBe(true);
    expect(mockPatientsUpdate).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ portalEnabled: 0, _dirty: 1 }),
    );
  });

  it("returns error when db throws", async () => {
    mockPatientsUpdate.mockRejectedValueOnce(new Error("crash"));

    const result = await disablePortalAccess("p1");

    expect(result.success).toBe(false);
  });

  it("still turns access off for a patient under 18", async () => {
    mockPatientsGet.mockResolvedValue(
      makePatient({ dob: childDob(), portalEnabled: 1 }),
    );

    const result = await disablePortalAccess("p1");

    expect(result.success).toBe(true);
    expect(mockPatientsUpdate).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ portalEnabled: 0 }),
    );
  });
});

describe("sendPortalInvitation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(makeChain());
    mockFunctionsInvoke.mockResolvedValue({ error: null });
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

  it("refuses a patient under 18 even when access is already on", async () => {
    mockPatientsGet.mockResolvedValue(
      makePatient({ portalEnabled: 1, dob: childDob() }),
    );

    const result = await sendPortalInvitation("p1");

    expect(result).toEqual({
      success: false,
      error: MINOR_PORTAL_ACCESS_MESSAGE,
    });
    expect(mockFunctionsInvoke).not.toHaveBeenCalled();
    expect(mockPatientsUpdate).not.toHaveBeenCalled();
  });

  it("sends via edge function and marks status=sent", async () => {
    mockPatientsGet.mockResolvedValue(makePatient({ portalEnabled: 1 }));

    const result = await sendPortalInvitation("p1");

    expect(result.success).toBe(true);
    expect(mockFunctionsInvoke).toHaveBeenCalledWith(
      "send-otp-email",
      expect.objectContaining({
        body: expect.objectContaining({ email: "ada@example.com" }),
      }),
    );
  });

  it("falls back gracefully when edge function fails", async () => {
    mockPatientsGet.mockResolvedValue(makePatient({ portalEnabled: 1 }));
    mockFunctionsInvoke.mockResolvedValue({ error: { message: "fn error" } });

    const result = await sendPortalInvitation("p1");

    expect(result.success).toBe(true);
    expect(result.registrationUrl).toBeDefined();
    expect(result.demoOTP).toBeDefined();
    expect(result.notSentReason).toBeUndefined();
  });

  it("says why when the server refuses a caller who is not signed in online", async () => {
    mockPatientsGet.mockResolvedValue(makePatient({ portalEnabled: 1 }));
    // What invoke returns when the anon key gets 401 from send-otp-email.
    mockFunctionsInvoke.mockResolvedValue({
      data: null,
      error: {
        name: "FunctionsHttpError",
        message: "Edge Function returned a non-2xx status code",
        context: { status: 401 },
      },
    });

    const result = await sendPortalInvitation("p1");

    expect(result.success).toBe(true);
    expect(result.notSentReason).toBe("not_signed_in");
    expect(result.demoOTP).toBeDefined();
    expect(result.registrationUrl).toContain("/patient/register");
  });

  it("says why when the server does not accept the staff account", async () => {
    mockPatientsGet.mockResolvedValue(makePatient({ portalEnabled: 1 }));
    mockFunctionsInvoke.mockResolvedValue({
      data: null,
      error: { name: "FunctionsHttpError", context: { status: 403 } },
    });

    const result = await sendPortalInvitation("p1");

    expect(result.notSentReason).toBe("not_permitted");
    expect(result.demoOTP).toBeDefined();
  });

  it("does not count an email as sent when the email function is in demo mode", async () => {
    mockPatientsGet.mockResolvedValue(makePatient({ portalEnabled: 1 }));
    // send-otp-email without RESEND_API_KEY: HTTP 200, but nothing is sent.
    mockFunctionsInvoke.mockResolvedValue({
      data: { success: true, demo: true },
      error: null,
    });

    const result = await sendPortalInvitation("p1");

    expect(result.success).toBe(true);
    expect(result.notSentReason).toBe("email_not_configured");
    expect(result.demoOTP).toMatch(/no email was sent/i);
    expect(result.registrationUrl).toContain("/patient/register?email=");
  });

  it("sends no SMS to a patient with no email, and returns the link to share", async () => {
    mockPatientsGet.mockResolvedValue(
      makePatient({ portalEnabled: 1, email: "" }),
    );

    const result = await sendPortalInvitation("p1");

    // send-otp-sms sends one-time codes only: invitations are not sent by SMS.
    expect(mockFunctionsInvoke).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: true,
      notSentReason: "sms_not_available",
    });
    expect(result.registrationUrl).toContain("/patient/register?phone=");
    expect(result.demoOTP).toMatch(/SMS invitations are not available yet/);
  });

  it("sends the invitation text as subject and message, never as HTML", async () => {
    mockPatientsGet.mockResolvedValue(makePatient({ portalEnabled: 1 }));

    await sendPortalInvitation("p1");

    const [, options] = mockFunctionsInvoke.mock.calls[0];
    expect(options.body.subject).toBe("Your mBHR Patient Portal is Ready");
    expect(options.body.message).toContain("Hi Ada,");
    expect(options.body.message).not.toMatch(/<[a-z]/i);
    expect(options.body).not.toHaveProperty("otp");
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

  it("leaves out patients under 18", async () => {
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
