import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const { mockSignUp, mockSignOut, mockRpc, mockFrom } = vi.hoisted(() => ({
  mockSignUp: vi.fn(),
  mockSignOut: vi.fn(),
  mockRpc: vi.fn(),
  mockFrom: vi.fn(),
}));

vi.mock("@/lib/supabaseClient", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
      signUp: (...args: unknown[]) => mockSignUp(...args),
      signOut: (...args: unknown[]) => mockSignOut(...args),
    },
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

vi.mock("@/lib/supabaseAuthStorage", () => ({
  clearStoredSupabaseAuth: vi.fn(),
}));

vi.mock("@/utils/phone", () => ({
  normalizePhone: (v: string) => v,
}));

import { useAuth, type SignUpData } from "./useAuth";
import {
  ACCEPTANCE_REQUIRED_MESSAGE,
  MINOR_RECORD_LINK_MESSAGE,
  UNDER_18_SIGN_UP_MESSAGE,
} from "@/pages/legal/policyMeta";

const ACCEPTED = {
  termsVersion: "2026-09-22",
  privacyVersion: "2026-09-25",
  acceptedAt: "2026-09-25T10:00:00.000Z",
};

const SIGN_UP: SignUpData = {
  email: "ada@test.com",
  password: "long-enough",
  givenName: "Ada",
  familyName: "Obi",
  phone: "08012345678",
  dob: "1990-01-01",
  acceptance: ACCEPTED,
};

/** 1 January, ten years ago: someone under 18 whatever today's date is. */
function childDob(): string {
  return `${new Date().getFullYear() - 10}-01-01`;
}

async function signup(data: SignUpData) {
  const { result } = renderHook(() => useAuth());
  let error: Awaited<ReturnType<typeof result.current.signup>> = null;
  await act(async () => {
    error = await result.current.signup(data);
  });
  return error as { message: string; code?: string } | null;
}

describe("useAuth signup: before any account is made", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Stop right after the auth call: these tests only check what it sends.
    mockSignUp.mockResolvedValue({ data: { user: null }, error: null });
  });

  it("saves the accepted versions and time with the registration details", async () => {
    await signup(SIGN_UP);

    expect(mockSignUp).toHaveBeenCalledTimes(1);
    expect(mockSignUp.mock.calls[0][0]).toEqual({
      email: "ada@test.com",
      password: "long-enough",
      options: {
        data: {
          full_name: "Ada Obi",
          given_name: "Ada",
          family_name: "Obi",
          dob: "1990-01-01",
          phone: "08012345678",
          terms_version: "2026-09-22",
          privacy_version: "2026-09-25",
          accepted_at: "2026-09-25T10:00:00.000Z",
        },
      },
    });
  });

  it("does not create an account without a complete acceptance", async () => {
    const error = await signup({
      ...SIGN_UP,
      acceptance: { ...ACCEPTED, termsVersion: "" },
    });

    expect(error?.message).toBe(ACCEPTANCE_REQUIRED_MESSAGE);
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it("does not create an account for someone under 18", async () => {
    const error = await signup({ ...SIGN_UP, dob: childDob() });

    expect(error?.message).toBe(UNDER_18_SIGN_UP_MESSAGE);
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it("does not create an account without a usable date of birth", async () => {
    for (const dob of ["", "not a date"]) {
      const error = await signup({ ...SIGN_UP, dob });
      expect(error?.message).toMatch(/real date of birth/i);
    }
    expect(mockSignUp).not.toHaveBeenCalled();
  });
});

describe("useAuth signup: linking the clinic record on the server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignUp.mockResolvedValue({
      data: { user: { id: "auth-1" }, session: { access_token: "t" } },
      error: null,
    });
    mockSignOut.mockResolvedValue({ error: null });
  });

  it("links through portal_link_patient_record, never by reading patients", async () => {
    mockRpc.mockResolvedValue({ data: { status: "linked", patient_id: "p1" }, error: null });

    const error = await signup(SIGN_UP);

    expect(error).toBeNull();
    expect(mockRpc).toHaveBeenCalledWith("portal_link_patient_record", {
      p_dob: "1990-01-01",
      p_given_name: "Ada",
      p_family_name: "Obi",
      p_phone: "08012345678",
    });
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it("sends a patient whose match is a child's record to clinic staff and signs out", async () => {
    // 20260926120100: a child's record comes back as needs_staff_verification.
    mockRpc.mockResolvedValue({ data: { status: "needs_staff_verification" }, error: null });

    const error = await signup(SIGN_UP);

    expect(error).toEqual({ code: "not_linked", message: MINOR_RECORD_LINK_MESSAGE });
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it("waits for the email confirmation when sign-up returns no session", async () => {
    mockSignUp.mockResolvedValue({ data: { user: { id: "auth-1" }, session: null }, error: null });

    const error = await signup(SIGN_UP);

    expect(error?.code).toBe("confirm_email");
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
