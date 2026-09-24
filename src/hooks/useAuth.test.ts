import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const { mockSignUp } = vi.hoisted(() => ({ mockSignUp: vi.fn() }));

vi.mock("@/lib/supabaseClient", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
      signUp: (...args: unknown[]) => mockSignUp(...args),
    },
  },
}));

vi.mock("@/utils/phone", () => ({
  normalizePhone: (v: string) => v,
}));

import { useAuth, type SignUpData } from "./useAuth";
import { ACCEPTANCE_REQUIRED_MESSAGE } from "@/pages/legal/policyMeta";

const ACCEPTED = {
  termsVersion: "2026-09-22",
  privacyVersion: "2026-09-24",
  acceptedAt: "2026-09-24T10:00:00.000Z",
};

const SIGN_UP: SignUpData = {
  email: "ada@test.com",
  password: "long-enough",
  givenName: "Ada",
  familyName: "Obi",
  acceptance: ACCEPTED,
};

async function signup(data: SignUpData) {
  const { result } = renderHook(() => useAuth());
  let error: Awaited<ReturnType<typeof result.current.signup>> = null;
  await act(async () => {
    error = await result.current.signup(data);
  });
  return error as { message: string } | null;
}

describe("useAuth signup", () => {
  beforeEach(() => {
    mockSignUp.mockReset();
    // Stop right after the auth call: these tests only check what it sends.
    mockSignUp.mockResolvedValue({ data: { user: null }, error: null });
  });

  it("saves the accepted versions and time with the new account", async () => {
    await signup(SIGN_UP);

    expect(mockSignUp).toHaveBeenCalledTimes(1);
    expect(mockSignUp.mock.calls[0][0]).toMatchObject({
      email: "ada@test.com",
      options: {
        data: {
          full_name: "Ada Obi",
          terms_version: "2026-09-22",
          privacy_version: "2026-09-24",
          accepted_at: "2026-09-24T10:00:00.000Z",
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
});
