import { describe, it, expect, vi, beforeEach } from "vitest";

const resetPasswordForEmail = vi.fn();
const updateUser = vi.fn();
const signOut = vi.fn();
const verifyOtp = vi.fn();
const maybeSingle = vi.fn();
const eq = vi.fn((_column: string, _value: string) => ({ maybeSingle: () => maybeSingle() }));
const select = vi.fn((_columns: string) => ({
  eq: (column: string, value: string) => eq(column, value),
}));
const from = vi.fn((_table: string) => ({ select: (columns: string) => select(columns) }));

vi.mock("@/lib/supabaseClient", () => ({
  supabase: {
    auth: {
      resetPasswordForEmail: (...a: unknown[]) => resetPasswordForEmail(...a),
      updateUser: (...a: unknown[]) => updateUser(...a),
      signOut: (...a: unknown[]) => signOut(...a),
      verifyOtp: (...a: unknown[]) => verifyOtp(...a),
    },
    from: (table: string) => from(table),
  },
  isSupabaseEnabled: true,
}));

import {
  accessTokenSubject,
  completePasswordReset,
  loginPathFor,
  parseAudience,
  parseRecoveryLanding,
  redeemInviteToken,
  requestPasswordReset,
  resetRedirectUrl,
  resolveResetAudience,
  validateNewPassword,
} from "./passwordReset";

/** An unsigned JWT-shaped token carrying `payload`, as Supabase puts in the link. */
function fakeJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}.signature`;
}

const NO_TOKEN = {
  hasToken: false,
  kind: "recovery",
  flow: null,
  tokenHash: null,
  tokenSubject: null,
  expired: false,
  error: null,
};

describe("parseRecoveryLanding", () => {
  it("detects an implicit-flow recovery token in the hash", () => {
    expect(
      parseRecoveryLanding(
        "https://app.test/reset-password?for=staff#access_token=abc&type=recovery",
      ),
    ).toEqual({
      hasToken: true,
      kind: "recovery",
      flow: "fragment",
      tokenHash: null,
      tokenSubject: null,
      expired: false,
      error: null,
    });
  });

  it("reads the account a recovery token was issued for", () => {
    const token = fakeJwt({ sub: "user-1" });
    expect(
      parseRecoveryLanding(`https://app.test/reset-password#access_token=${token}&type=recovery`)
        .tokenSubject,
    ).toBe("user-1");
  });

  it("does not accept a recovery claim without a token", () => {
    for (const href of [
      "https://app.test/reset-password?type=recovery",
      "https://app.test/reset-password#type=recovery",
      "https://app.test/reset-password?code=xyz",
      "https://app.test/reset-password?for=staff#type=recovery&expires_in=3600",
      "https://app.test/reset-password?token_hash=abc&type=recovery",
      "https://app.test/reset-password?token_hash=abc&type=signup",
      "https://app.test/reset-password?type=invite",
    ]) {
      expect(parseRecoveryLanding(href)).toEqual(NO_TOKEN);
    }
  });

  it("reports an expired link", () => {
    const r = parseRecoveryLanding(
      "https://app.test/reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
    );
    expect(r.hasToken).toBe(false);
    expect(r.kind).toBe("recovery");
    expect(r.expired).toBe(true);
    expect(r.error).toMatch(/expired or has already been used/);
  });

  it("finds no token on a bare visit", () => {
    expect(parseRecoveryLanding("https://app.test/reset-password")).toEqual(NO_TOKEN);
  });

  it("detects an invitation token in the hash", () => {
    const token = fakeJwt({ sub: "u1" });
    expect(
      parseRecoveryLanding(
        `https://app.test/reset-password?for=staff&link=invite#access_token=${token}&refresh_token=def&type=invite`,
      ),
    ).toEqual({
      hasToken: true,
      kind: "invite",
      flow: "fragment",
      tokenHash: null,
      tokenSubject: "u1",
      expired: false,
      error: null,
    });
  });

  it("detects an invitation from the hash alone when the link lost its query string", () => {
    const token = fakeJwt({ sub: "u1" });
    expect(
      parseRecoveryLanding(`https://app.test/reset-password#access_token=${token}&type=invite`),
    ).toEqual({
      hasToken: true,
      kind: "invite",
      flow: "fragment",
      tokenHash: null,
      tokenSubject: "u1",
      expired: false,
      error: null,
    });
  });

  it("detects an invitation token_hash in the query string", () => {
    expect(
      parseRecoveryLanding(
        "https://app.test/reset-password?for=staff&link=invite&token_hash=abc&type=invite",
      ),
    ).toEqual({
      hasToken: true,
      kind: "invite",
      flow: "token_hash",
      tokenHash: "abc",
      tokenSubject: null,
      expired: false,
      error: null,
    });
  });

  it("words an expired invitation as an invitation", () => {
    const r = parseRecoveryLanding(
      "https://app.test/reset-password?for=staff&link=invite#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
    );
    expect(r).toMatchObject({ hasToken: false, kind: "invite", flow: null, expired: true });
    expect(r.error).toBe(
      "This invitation link has expired or was already used. Ask your administrator to send a new one.",
    );
  });

  it("recognises an invitation visit without a token", () => {
    expect(parseRecoveryLanding("https://app.test/reset-password?for=staff&link=invite")).toEqual({
      ...NO_TOKEN,
      kind: "invite",
    });
  });

  it("does not treat a signup confirmation as a recovery", () => {
    expect(
      parseRecoveryLanding("https://app.test/reset-password#access_token=abc&type=signup")
        .hasToken,
    ).toBe(false);
  });
});

describe("accessTokenSubject", () => {
  it("reads the subject of a JWT", () => {
    expect(accessTokenSubject(fakeJwt({ sub: "user-1", role: "authenticated" }))).toBe("user-1");
  });

  it("returns null for anything that is not a readable JWT", () => {
    for (const token of ["abc", "", "a.b", "a.!!!.c", `x.${btoa("not json")}.y`]) {
      expect(accessTokenSubject(token)).toBeNull();
    }
  });

  it("returns null when the token has no subject", () => {
    expect(accessTokenSubject(fakeJwt({ role: "authenticated" }))).toBeNull();
    expect(accessTokenSubject(fakeJwt({ sub: 42 }))).toBeNull();
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

  it("treats an account with an app_users row as staff", async () => {
    maybeSingle.mockResolvedValue({ data: { id: "user-1" }, error: null });
    expect(await resolveResetAudience("user-1")).toBe("staff");
    expect(from).toHaveBeenCalledWith("app_users");
    expect(select).toHaveBeenCalledWith("id");
    expect(eq).toHaveBeenCalledWith("id", "user-1");
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
    expect(await completePasswordReset("newpassword1", { markPasswordSet: false })).toEqual({
      ok: true,
    });
    expect(updateUser).toHaveBeenCalledWith(expect.objectContaining({ password: "newpassword1" }));
    expect(signOut).toHaveBeenCalledWith({ scope: "global" });
    expect(localStorage.getItem("patient_portal_user")).toBeNull();
  });

  it("records when the password was set for staff and invitations", async () => {
    updateUser.mockResolvedValue({ error: null });
    expect(await completePasswordReset("newpassword1", { markPasswordSet: true })).toEqual({
      ok: true,
    });
    expect(updateUser).toHaveBeenCalledWith({
      password: "newpassword1",
      data: { mbhr_password_set_at: expect.any(String) },
    });
    const { data } = updateUser.mock.calls[0][0] as { data: { mbhr_password_set_at: string } };
    expect(Number.isNaN(Date.parse(data.mbhr_password_set_at))).toBe(false);
  });

  it("saves only the password when no marker is wanted", async () => {
    updateUser.mockResolvedValue({ error: null });
    await completePasswordReset("newpassword1", { markPasswordSet: false });
    expect(updateUser).toHaveBeenCalledWith({ password: "newpassword1" });
  });

  it("explains a reused password", async () => {
    updateUser.mockResolvedValue({
      error: { status: 422, message: "New password should be different from the old password." },
    });
    const r = await completePasswordReset("samepassword", { markPasswordSet: false });
    expect(r.ok).toBe(false);
    expect(signOut).not.toHaveBeenCalled();
  });

  it("explains an expired recovery session", async () => {
    updateUser.mockResolvedValue({
      error: { status: 401, message: "Auth session missing!" },
    });
    const r = await completePasswordReset("newpassword1", { markPasswordSet: false });
    expect(r).toEqual({
      ok: false,
      message: "Your reset link has expired. Request a new one and try again.",
    });
  });

  it("explains an expired invitation session", async () => {
    updateUser.mockResolvedValue({
      error: { status: 401, message: "Auth session missing!" },
    });
    const r = await completePasswordReset("newpassword1", {
      markPasswordSet: true,
      kind: "invite",
    });
    expect(r).toEqual({
      ok: false,
      message: "Your invitation link has expired. Ask your administrator to send a new one.",
    });
    expect(signOut).not.toHaveBeenCalled();
  });
});

describe("redeemInviteToken", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redeems the token_hash as an invitation", async () => {
    const session = { user: { id: "u1" } };
    verifyOtp.mockResolvedValue({ data: { user: session.user, session }, error: null });
    expect(await redeemInviteToken("abc")).toEqual({ ok: true, session });
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "abc", type: "invite" });
  });

  it("maps an expired or used link to expired", async () => {
    verifyOtp.mockResolvedValue({
      data: { user: null, session: null },
      error: { status: 403, code: "otp_expired", message: "Email link is invalid or has expired" },
    });
    expect(await redeemInviteToken("abc")).toEqual({ ok: false, reason: "expired" });

    verifyOtp.mockResolvedValue({
      data: { user: null, session: null },
      error: { status: 404, code: "invite_not_found", message: "Invite not found" },
    });
    expect(await redeemInviteToken("abc")).toEqual({ ok: false, reason: "expired" });
  });

  it("reports other failures as errors that can be retried", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    verifyOtp.mockResolvedValue({
      data: { user: null, session: null },
      error: { status: 500, code: "unexpected_failure", message: "Internal server error" },
    });
    expect(await redeemInviteToken("abc")).toEqual({ ok: false, reason: "error" });

    verifyOtp.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await redeemInviteToken("abc")).toEqual({ ok: false, reason: "error" });

    verifyOtp.mockClear();
    expect(await redeemInviteToken("")).toEqual({ ok: false, reason: "error" });
    expect(verifyOtp).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
