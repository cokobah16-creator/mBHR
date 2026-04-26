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

vi.mock("@/lib/supabase", () => ({ supabase: mockSupabase }));
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
    insert: vi.fn().mockResolvedValue({ error: null }),
    upsert: vi.fn().mockResolvedValue({ error: null }),
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
  beforeEach(() => vi.clearAllMocks());

  it("returns true on success", async () => {
    mockFrom.mockReturnValue(makeSupabaseChain());

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
});

describe("checkAndEnrollPatient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(makeSupabaseChain());
  });

  it("skips patient that is already portal-enabled", async () => {
    mockFrom.mockReturnValue(makeSupabaseChain([]));
    const p = makePatient({ portalEnabled: 1 });

    const result = await checkAndEnrollPatient(p);

    expect(result.enrolled).toBe(false);
    expect(result.reason).toBe("not_eligible");
    expect(mockPatientsUpdate).not.toHaveBeenCalled();
  });

  it("enrolls eligible patient and updates local db", async () => {
    mockFrom.mockReturnValue(makeSupabaseChain([]));
    const p = makePatient({ phone: "08012345678" });

    const result = await checkAndEnrollPatient(p);

    expect(result.enrolled).toBe(true);
    expect(mockPatientsUpdate).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ portalEnabled: 1, _dirty: 1 }),
    );
  });

  it("returns enrolled=false with reason=error when db throws", async () => {
    mockFrom.mockReturnValue(makeSupabaseChain([]));
    mockPatientsUpdate.mockRejectedValueOnce(new Error("DB crash"));
    const p = makePatient({ phone: "08012345678" });

    const result = await checkAndEnrollPatient(p);

    expect(result.enrolled).toBe(false);
    expect(result.reason).toBe("error");
  });
});

describe("bulkAutoEnroll", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(makeSupabaseChain([]));
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
  });

  it("updates local db to disable portal and returns true", async () => {
    const result = await optOutPatient("p1");

    expect(result).toBe(true);
    expect(mockPatientsUpdate).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ portalEnabled: 0, _dirty: 1 }),
    );
  });

  it("returns false when db throws", async () => {
    mockPatientsUpdate.mockRejectedValueOnce(new Error("crash"));

    const result = await optOutPatient("p1");

    expect(result).toBe(false);
  });
});
