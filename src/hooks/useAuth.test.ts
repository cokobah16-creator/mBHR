import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const { mockSignUp, mockFrom } = vi.hoisted(() => ({
  mockSignUp: vi.fn(),
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
    },
    from: (...args: unknown[]) => mockFrom(...args),
  },
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
  privacyVersion: "2026-09-24",
  acceptedAt: "2026-09-24T10:00:00.000Z",
};

const SIGN_UP: SignUpData = {
  email: "ada@test.com",
  password: "long-enough",
  givenName: "Ada",
  familyName: "Obi",
  dob: "1990-01-01",
  acceptance: ACCEPTED,
};

/** 1 January, ten years ago: someone under 18 whatever today's date is. */
function childDob(): string {
  return `${new Date().getFullYear() - 10}-01-01`;
}

/**
 * A supabase-js style query on `patients`: every filter returns the query
 * itself, and awaiting it (or calling maybeSingle) gives `result`.
 */
function query(result: unknown) {
  const q: Record<string, unknown> = {};
  for (const method of ["select", "or", "not", "neq", "limit", "is", "eq", "update", "insert"]) {
    q[method] = vi.fn(() => q);
  }
  q.maybeSingle = vi.fn(() => Promise.resolve(result));
  q.then = (
    resolve: (value: unknown) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return q as Record<string, ReturnType<typeof vi.fn>>;
}

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

  it("does not create an account for someone under 18", async () => {
    const error = await signup({ ...SIGN_UP, dob: childDob() });

    expect(error?.message).toBe(UNDER_18_SIGN_UP_MESSAGE);
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it("does not create an account without a usable date of birth", async () => {
    const error = await signup({ ...SIGN_UP, dob: "" });

    expect(error?.message).toMatch(/real date of birth/i);
    expect(mockSignUp).not.toHaveBeenCalled();
  });
});

describe("useAuth signup: linking to a clinic record", () => {
  beforeEach(() => {
    mockSignUp.mockReset();
    mockFrom.mockReset();
    mockSignUp.mockResolvedValue({
      data: { user: { id: "auth-1" } },
      error: null,
    });
  });

  it("refuses to link a new account to a child's record matched by email", async () => {
    const alreadyLinked = query({ data: [], error: null });
    const lookup = query({
      data: {
        id: "child-1",
        auth_uid: null,
        dob: childDob(),
        email: "ada@test.com",
        phone: null,
      },
      error: null,
    });
    mockFrom.mockReturnValueOnce(alreadyLinked).mockReturnValueOnce(lookup);

    const error = await signup(SIGN_UP);

    expect(error?.message).toBe(MINOR_RECORD_LINK_MESSAGE);
    // Only the two lookups ran: no update to link, no new record.
    expect(mockFrom).toHaveBeenCalledTimes(2);
  });

  it("still links an adult's record matched by email", async () => {
    const alreadyLinked = query({ data: [], error: null });
    const lookup = query({
      data: {
        id: "adult-1",
        auth_uid: null,
        dob: "1980-05-05",
        email: "ada@test.com",
        phone: null,
      },
      error: null,
    });
    const link = query({ error: null });
    mockFrom
      .mockReturnValueOnce(alreadyLinked)
      .mockReturnValueOnce(lookup)
      .mockReturnValueOnce(link);

    const error = await signup(SIGN_UP);

    expect(error).toBeNull();
    expect(link.update).toHaveBeenCalledWith({ auth_uid: "auth-1" });
    expect(link.eq).toHaveBeenCalledWith("id", "adult-1");
  });
});
