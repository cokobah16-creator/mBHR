import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSupabase, mockFrom } = vi.hoisted(() => {
  const mockFrom = vi.fn();
  const mockSupabase = {
    from: mockFrom,
  };
  return { mockSupabase, mockFrom };
});

const {
  mockPatientsGet,
  mockPatientsUpdate,
  mockPatientsWhere,
  mockPatientsFilter,
} = vi.hoisted(() => {
  const mockPatientsUpdate = vi.fn().mockResolvedValue(1);
  const mockPatientsGet = vi.fn();
  const mockPatientsWhere = vi.fn();
  const mockFilter = vi.fn();
  return {
    mockPatientsGet,
    mockPatientsUpdate,
    mockPatientsWhere,
    mockPatientsFilter: mockFilter,
  };
});

const { mockRequestChange, mockDrain, authState } = vi.hoisted(() => ({
  mockRequestChange: vi.fn(),
  mockDrain: vi.fn().mockResolvedValue(null),
  authState: { currentUser: { id: "u1", role: "nurse" } as { id: string; role: string } | null },
}));

vi.mock("@/lib/supabase", () => ({ supabase: mockSupabase }));
vi.mock("./portalAccess", () => ({ requestPortalAccessChange: mockRequestChange }));
vi.mock("@/sync/adapter", () => ({ drainServerCommands: mockDrain }));
vi.mock("@/stores/auth", () => ({
  useAuthStore: { getState: () => authState },
}));
vi.mock("@/db", () => ({
  db: {
    patients: {
      get: mockPatientsGet,
      update: mockPatientsUpdate,
      where: mockPatientsWhere,
      filter: mockPatientsFilter,
    },
  },
}));
vi.mock("@/lib/logger", () => ({
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

import {
  isEligibleForAutoEnrollment,
  getEnrollmentSettings,
  updateEnrollmentSetting,
  checkAndEnrollPatient,
  bulkAutoEnroll,
  optOutPatient,
} from "./autoEnrollment";
import type { Patient } from "@/db";

function makePatient(overrides: Partial<Patient> = {}): Patient {
  return {
    id: "p1",
    givenName: "Ada",
    familyName: "Obi",
    phone: "08012345678",
    email: "",
    portalEnabled: 0,
    _dirty: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Patient;
}

function makeSupabaseChain(
  data: unknown[] | null = [],
  error: null | object = null,
) {
  const chain: Record<string, unknown> = {
    then: (r: (v: unknown) => unknown) =>
      Promise.resolve({ data, error }).then(r),
    select: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    eq: vi.fn(),
  };
  (chain.eq as ReturnType<typeof vi.fn>).mockReturnValue(chain);
  return chain;
}

describe("isEligibleForAutoEnrollment", () => {
  const baseSettings = {
    autoEnrollmentEnabled: true,
    requireEmail: false,
    sendWelcomeNotification: true,
  };

  it("returns false while a change is waiting for the server or the record was merged", () => {
    expect(isEligibleForAutoEnrollment(makePatient({ portalPending: 1 }), baseSettings)).toBe(false);
    expect(isEligibleForAutoEnrollment(makePatient({ mergeInto: "p9" }), baseSettings)).toBe(false);
  });

  it("returns false when auto enrollment is disabled", () => {
    const p = makePatient({ phone: "08012345678" });
    expect(
      isEligibleForAutoEnrollment(p, {
        ...baseSettings,
        autoEnrollmentEnabled: false,
      }),
    ).toBe(false);
  });

  it("returns false when patient already has portal enabled", () => {
    const p = makePatient({ portalEnabled: 1 });
    expect(isEligibleForAutoEnrollment(p, baseSettings)).toBe(false);
  });

  it("returns false when requireEmail=true and patient has no email", () => {
    const p = makePatient({ phone: "080", email: "" });
    expect(
      isEligibleForAutoEnrollment(p, { ...baseSettings, requireEmail: true }),
    ).toBe(false);
  });

  it("returns true when requireEmail=true and patient has email", () => {
    const p = makePatient({ email: "ada@example.com" });
    expect(
      isEligibleForAutoEnrollment(p, { ...baseSettings, requireEmail: true }),
    ).toBe(true);
  });

  it("returns true when patient has phone and no email (default settings)", () => {
    const p = makePatient({ phone: "08012345678", email: "" });
    expect(isEligibleForAutoEnrollment(p, baseSettings)).toBe(true);
  });

  it("returns false when patient has no contact info", () => {
    const p = makePatient({ phone: "", email: "" });
    expect(isEligibleForAutoEnrollment(p, baseSettings)).toBe(false);
  });

  it("returns true when patient has only email", () => {
    const p = makePatient({ phone: "", email: "ada@example.com" });
    expect(isEligibleForAutoEnrollment(p, baseSettings)).toBe(true);
  });
});

describe("getEnrollmentSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns defaults when supabase returns error", async () => {
    mockFrom.mockReturnValue(makeSupabaseChain(null, { message: "RLS" }));

    const settings = await getEnrollmentSettings();

    expect(settings.autoEnrollmentEnabled).toBe(true);
    expect(settings.requireEmail).toBe(false);
    expect(settings.sendWelcomeNotification).toBe(true);
  });

  it("applies settings from supabase rows", async () => {
    mockFrom.mockReturnValue(
      makeSupabaseChain([
        { setting_key: "auto_enrollment_enabled", setting_value: false },
        { setting_key: "require_email", setting_value: true },
        { setting_key: "send_welcome_notification", setting_value: false },
      ]),
    );

    const settings = await getEnrollmentSettings();

    expect(settings.autoEnrollmentEnabled).toBe(false);
    expect(settings.requireEmail).toBe(true);
    expect(settings.sendWelcomeNotification).toBe(false);
  });
});

describe("updateEnrollmentSetting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.currentUser = { id: "admin-1", role: "admin" };
  });

  it("returns true when the server changed the setting", async () => {
    mockFrom.mockReturnValue(makeSupabaseChain([{ setting_key: "auto_enrollment_enabled" }]));

    const result = await updateEnrollmentSetting(
      "auto_enrollment_enabled",
      false,
      "admin",
    );

    expect(result).toBe(true);
  });

  it("returns false when supabase returns error", async () => {
    mockFrom.mockReturnValue(makeSupabaseChain(null, { message: "error" }));

    const result = await updateEnrollmentSetting(
      "require_email",
      true,
      "admin",
    );

    expect(result).toBe(false);
  });

  it("treats zero changed rows as failure", async () => {
    mockFrom.mockReturnValue(makeSupabaseChain([]));

    const result = await updateEnrollmentSetting("unknown_key", true, "admin");

    expect(result).toBe(false);
  });

  it("refuses a role that cannot manage users, without calling the server", async () => {
    authState.currentUser = { id: "u1", role: "nurse" };

    const result = await updateEnrollmentSetting("require_email", true, "u1");

    expect(result).toBe(false);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe("checkAndEnrollPatient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.currentUser = { id: "u1", role: "nurse" };
    mockFrom.mockReturnValue(makeSupabaseChain());
    mockRequestChange.mockResolvedValue({ ok: true, state: "waiting_for_server" });
    mockPatientsGet.mockResolvedValue(makePatient({ portalEnabled: 1, portalPending: 1 }));
  });

  it("skips patient that is already portal-enabled", async () => {
    mockFrom.mockReturnValue(makeSupabaseChain([]));
    const p = makePatient({ portalEnabled: 1 });

    const result = await checkAndEnrollPatient(p);

    expect(result.enrolled).toBe(false);
    expect(result.reason).toBe("not_eligible");
    expect(mockPatientsUpdate).not.toHaveBeenCalled();
  });

  it("asks the server through the command outbox (source auto_enrollment)", async () => {
    mockFrom.mockReturnValue(makeSupabaseChain([]));
    const p = makePatient({ phone: "08012345678" });

    const result = await checkAndEnrollPatient(p);

    expect(result).toEqual({ enrolled: true, pending: true });
    expect(mockRequestChange).toHaveBeenCalledWith("p1", true, {
      source: "auto_enrollment",
      reason: "auto_enrollment",
    });
    // No direct write of portal_enabled to the server or this device.
    expect(mockPatientsUpdate).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalledWith("patients");
    // Not confirmed yet: no welcome notification.
    expect(mockFrom).not.toHaveBeenCalledWith("patient_notifications");
  });

  it("sends the welcome notification only after the server confirmed access", async () => {
    mockFrom.mockReturnValue(makeSupabaseChain([{ id: "row" }]));
    mockPatientsGet.mockResolvedValue(makePatient({ portalEnabled: 1, portalPending: 0 }));

    const result = await checkAndEnrollPatient(makePatient({ phone: "08012345678" }));

    expect(result).toEqual({ enrolled: true, pending: false });
    expect(mockFrom).toHaveBeenCalledWith("patient_portal_users");
    expect(mockFrom).toHaveBeenCalledWith("patient_notifications");
  });

  it("refuses a role without portal_manage", async () => {
    authState.currentUser = { id: "ph", role: "pharmacist" };

    const result = await checkAndEnrollPatient(makePatient({ phone: "08012345678" }));

    expect(result).toEqual({ enrolled: false, reason: "not_allowed" });
    expect(mockRequestChange).not.toHaveBeenCalled();
  });

  it("returns enrolled=false with reason=error when the change is not saved", async () => {
    mockFrom.mockReturnValue(makeSupabaseChain([]));
    mockRequestChange.mockResolvedValueOnce({ ok: false, error: "Portal access was not saved. Try again." });

    const result = await checkAndEnrollPatient(makePatient({ phone: "08012345678" }));

    expect(result.enrolled).toBe(false);
    expect(result.reason).toBe("error");
  });

  it("returns enrolled=false with reason=error when the request throws", async () => {
    mockFrom.mockReturnValue(makeSupabaseChain([]));
    mockRequestChange.mockRejectedValueOnce(new Error("DB crash"));
    const p = makePatient({ phone: "08012345678" });

    const result = await checkAndEnrollPatient(p);

    expect(result.enrolled).toBe(false);
    expect(result.reason).toBe("error");
  });
});

describe("bulkAutoEnroll", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.currentUser = { id: "u1", role: "nurse" };
    mockFrom.mockReturnValue(makeSupabaseChain([]));
    mockRequestChange.mockResolvedValue({ ok: true, state: "waiting_for_server" });
    mockPatientsGet.mockResolvedValue(makePatient({ portalEnabled: 1, portalPending: 1 }));
  });

  it("refuses a role without portal_manage", async () => {
    authState.currentUser = { id: "ph", role: "pharmacist" };

    const result = await bulkAutoEnroll();

    expect(result.enrolled).toBe(0);
    expect(result.error).toMatch(/role cannot/);
    expect(mockRequestChange).not.toHaveBeenCalled();
  });

  it("returns zeroes when auto enrollment is disabled in settings", async () => {
    mockFrom.mockReturnValue(
      makeSupabaseChain([
        { setting_key: "auto_enrollment_enabled", setting_value: false },
      ]),
    );

    const result = await bulkAutoEnroll();

    expect(result.enrolled).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
  });

  it("enrolls multiple eligible patients", async () => {
    mockFrom.mockReturnValue(makeSupabaseChain([]));
    const patients = [
      makePatient({ id: "p1", phone: "0801" }),
      makePatient({ id: "p2", phone: "0802" }),
    ];
    mockPatientsFilter.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(patients),
    });

    const result = await bulkAutoEnroll();

    expect(result.enrolled).toBe(2);
    expect(result.failed).toBe(0);
  });

  it("calls onProgress callback", async () => {
    mockFrom.mockReturnValue(makeSupabaseChain([]));
    const patients = Array.from({ length: 10 }, (_, i) =>
      makePatient({ id: `p${i}`, phone: `0801234567${i}` }),
    );
    mockPatientsFilter.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(patients),
    });

    const onProgress = vi.fn();
    await bulkAutoEnroll(onProgress);

    expect(onProgress).toHaveBeenCalled();
  });
});

describe("optOutPatient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(makeSupabaseChain());
    mockRequestChange.mockResolvedValue({ ok: true, state: "waiting_for_server" });
  });

  it("asks the server to turn access off and returns true", async () => {
    const result = await optOutPatient("p1");

    expect(result).toBe(true);
    expect(mockRequestChange).toHaveBeenCalledWith("p1", false, { reason: "opt_out" });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("returns false when the change is refused", async () => {
    mockRequestChange.mockResolvedValueOnce({ ok: false, error: "Your role cannot change portal access." });

    expect(await optOutPatient("p1")).toBe(false);
  });

  it("returns false when the request throws", async () => {
    mockRequestChange.mockRejectedValueOnce(new Error("crash"));

    const result = await optOutPatient("p1");

    expect(result).toBe(false);
  });
});
