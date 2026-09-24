import { describe, it, expect, vi, beforeEach } from "vitest";

const resetPasswordForEmail = vi.fn();
const updateUser = vi.fn();
const signOut = vi.fn();
const maybeSingle = vi.fn();
const from = vi.fn((_table: string) => ({
  select: () => ({ eq: () => ({ maybeSingle: () => maybeSingle() }) }),
}));

vi.mock("@/lib/supabaseClient", () => ({
  supabase: {
    auth: {
      resetPasswordForEmail: (...a: unknown[]) => resetPasswordForEmail(...a),
      updateUser: (...a: unknown[]) => updateUser(...a),
      signOut: (...a: unknown[]) => signOut(...a),
    },
    from: (table: string) => from(table),
  },
  isSupabaseEnabled: true,
}));

import {
  completePasswordReset,
  loginPathFor,
  parseAudience,
  parseRecoveryLanding,
  requestPasswordReset,
  resetRedirectUrl,
  resolveResetAudience,
  validateNewPassword,
} from "./passwordReset";

describe("parseRecoveryLanding", () => {
  it("detects an implicit-flow recovery token in the hash", () => {
    expect(
      parseRecoveryLanding(
        "https://app.test/reset-password?for=staff#access_token=abc&type=recovery",
      ),
    ).toEqual({ hasToken: true, error: null });
  });

  it("does not accept a recovery claim without a token", () => {
    for (const href of [
      "https://app.test/reset-password?type=recovery",
      "https://app.test/reset-password#type=recovery",
      "https://app.test/reset-password?code=xyz",
      "https://app.test/reset-password?for=staff#type=recovery&expires_in=3600",
    ]) {
      expect(parseRecoveryLanding(href)).toEqual({ hasToken: false, error: null });
    }
  });

  it("reports an expired link", () => {
    const r = parseRecoveryLanding(
      "https://app.test/reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
    );
    expect(r.hasToken).toBe(false);
    expect(r.error).toMatch(/expired or has already been used/);
  });

  it("finds no token on a bare visit", () => {
    expect(parseRecoveryLanding("https://app.test/reset-password")).toEqual({
      hasToken: false,
      error: null,
    });
  });

  it("does not treat a signup confirmation as a recovery", () => {
    expect(
      parseRecoveryLanding("https://app.test/reset-password#access_token=abc&type=signup")
        .hasToken,
    ).toBe(false);
  });
});

describe("helpers", () => {
  it("defaults the audience to patient", () => {
    expect(parseAudience("staff")).toBe("staff");
    expect(parseAudience("patient")).toBe("patient");
    expect(parseAudience(null)).toBe("patient");
    expect(parseAudience("admin")).toBe("patient");
  });

  it("maps audiences to their login pages", () => {
    expect(loginPathFor("staff")).toBe("/login");
    expect(loginPathFor("patient")).toBe("/patient/login");
  });

  it("builds the audience-specific redirect URL", () => {
    expect(resetRedirectUrl("https://app.test", "staff")).toBe(
      "https://app.test/reset-password?for=staff",
    );
    expect(resetRedirectUrl("https://app.test", "patient")).toBe(
      "https://app.test/reset-password?for=patient",
    );
  });

  it("validates the new password", () => {
    expect(validateNewPassword("short", "short")).toMatch(/at least 8/);
    expect(validateNewPassword("longenough", "different1")).toMatch(/do not match/);
    expect(validateNewPassword("longenough", "longenough")).toBeNull();
  });
});

describe("requestPasswordReset", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a malformed address without calling Supabase", async () => {
    const r = await requestPasswordReset("not-an-email", "patient", "https://app.test");
    expect(r).toMatchObject({ ok: false, reason: "invalid_email" });
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("normalises the address and sends the audience-specific redirect", async () => {
    resetPasswordForEmail.mockResolvedValue({ error: null });
    const r = await requestPasswordReset("  Nurse@Clinic.NG ", "staff", "https://app.test");
    expect(r).toEqual({ ok: true });
    expect(resetPasswordForEmail).toHaveBeenCalledWith("nurse@clinic.ng", {
      redirectTo: "https://app.test/reset-password?for=staff",
    });

    await requestPasswordReset("patient@example.com", "patient", "https://app.test");
    expect(resetPasswordForEmail).toHaveBeenLastCalledWith("patient@example.com", {
      redirectTo: "https://app.test/reset-password?for=patient",
    });
  });

  it("reports success even when Supabase errors about the address", async () => {
    resetPasswordForEmail.mockResolvedValue({
      error: { status: 400, message: "User not found" },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await requestPasswordReset("nobody@x.org", "patient", "https://app.test")).toEqual({
      ok: true,
    });
    warn.mockRestore();
  });

  it("surfaces rate limiting", async () => {
    resetPasswordForEmail.mockResolvedValue({
      error: { status: 429, message: "email rate limit exceeded" },
    });
    expect(await requestPasswordReset("a@b.co", "patient", "https://app.test")).toMatchObject({
      ok: false,
      reason: "rate_limited",
    });
  });

  it("surfaces network failures", async () => {
    resetPasswordForEmail.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await requestPasswordReset("a@b.co", "patient", "https://app.test")).toMatchObject({
      ok: false,
      reason: "network",
    });
  });
});

describe("resolveResetAudience", () => {
  beforeEach(() => vi.clearAllMocks());

  it("treats an account with a staff_roles row as staff", async () => {
    maybeSingle.mockResolvedValue({ data: { role: "nurse" }, error: null });
    expect(await resolveResetAudience("user-1")).toBe("staff");
    expect(from).toHaveBeenCalledWith("staff_roles");
  });

  it("treats everyone else as a patient", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await resolveResetAudience("user-2")).toBe("patient");
  });

  it("falls back to patient when the lookup fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    maybeSingle.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    expect(await resolveResetAudience("user-3")).toBe("patient");
    maybeSingle.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await resolveResetAudience("user-3")).toBe("patient");
    expect(await resolveResetAudience("")).toBe("patient");
    warn.mockRestore();
  });
});

describe("completePasswordReset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signOut.mockResolvedValue({ error: null });
  });

  it("saves the password and signs out everywhere", async () => {
    updateUser.mockResolvedValue({ error: null });
    localStorage.setItem("patient_portal_user", "{}");
    expect(await completePasswordReset("newpassword1")).toEqual({ ok: true });
    expect(updateUser).toHaveBeenCalledWith({ password: "newpassword1" });
    expect(signOut).toHaveBeenCalledWith({ scope: "global" });
    expect(localStorage.getItem("patient_portal_user")).toBeNull();
  });

  it("explains a reused password", async () => {
    updateUser.mockResolvedValue({
      error: { status: 422, message: "New password should be different from the old password." },
    });
    const r = await completePasswordReset("samepassword");
    expect(r.ok).toBe(false);
    expect(signOut).not.toHaveBeenCalled();
  });

  it("explains an expired recovery session", async () => {
    updateUser.mockResolvedValue({
      error: { status: 401, message: "Auth session missing!" },
    });
    const r = await completePasswordReset("newpassword1");
    expect(r).toEqual({
      ok: false,
      message: "Your reset link has expired. Request a new one and try again.",
    });
  });
});
