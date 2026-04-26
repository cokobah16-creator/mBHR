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

vi.mock("@/lib/supabase", () => ({ supabase: mockSupabase }));
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
  sendPortalInvitation,
  getPortalStatus,
  linkAuthUserToPatient,
  findEligiblePatients,
} from "./portalEnrollment";
import type { Patient } from "@/db";

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
