import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const invoke = vi.fn();
const getSession = vi.fn();
const isSignedInStaffAccount = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    auth: { getSession: () => getSession() },
  },
}));

vi.mock("@/lib/cloudSession", () => ({
  isSignedInStaffAccount: (id: unknown) => isSignedInStaffAccount(id),
}));

import {
  STAFF_ADMIN_TIMEOUT_MS,
  classifyStaffAdminReply,
  createLoginForStaffRecord,
  createStaffAccount,
  createStaffRecordForLogin,
  disableStaffAccount,
  getLoginStatus,
  getStaffOverview,
  newStaffId,
  pingStaffAdmin,
  probeAuthHealth,
  reactivateStaffAccount,
  resendInvitation,
  sendPasswordReset,
  staffAdminFailureMessage,
  staffAdminRequestBody,
  updateStaffAccount,
} from "./staffAccounts";
import { STAFF_COPY } from "@/features/admin/staffAccountView";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const NURSE_ID = "22222222-2222-4222-8222-222222222222";
const FN = "staff-admin";

/** The shape supabase.functions.invoke returns for a non-2xx reply. */
function httpError(status: number, body?: unknown) {
  return {
    name: "FunctionsHttpError",
    message: "Edge Function returned a non-2xx status code",
    context: new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  };
}

function sessionFor(id: string) {
  return { data: { session: { access_token: "token-abc", user: { id } } } };
}

/** The body of the only invoke() call. */
function sentBody(): Record<string, unknown> {
  expect(invoke).toHaveBeenCalledTimes(1);
  return invoke.mock.calls[0][1].body;
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue(sessionFor(ADMIN_ID));
  isSignedInStaffAccount.mockReturnValue(true);
  invoke.mockResolvedValue({ data: { fn: FN, success: true }, error: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("classifyStaffAdminReply", () => {
  const ours = (extra: Record<string, unknown> = {}) => ({ fn: FN, success: false, ...extra });

  const cases: [string, number | null, Record<string, unknown> | null, boolean, string][] = [
    ["no reply at all", null, null, false, "unreachable"],
    ["404 without fn", 404, { code: "NOT_FOUND" }, false, "not_deployed"],
    ["404 with no body", 404, null, false, "not_deployed"],
    ["404 from the function", 404, ours({ error: "not_found" }), false, "refused"],
    ["2xx without fn", 200, { success: true }, true, "not_deployed"],
    ["2xx with no body", 200, null, true, "not_deployed"],
    ["401", 401, ours({ error: "not_authenticated" }), false, "not_signed_in"],
    ["401 from the gateway", 401, { msg: "Invalid JWT" }, false, "not_signed_in"],
    ["403", 403, ours({ error: "not_permitted" }), false, "not_permitted"],
    ["429", 429, ours({ error: "rate_limited" }), false, "rate_limited"],
    ["503 not_configured", 503, ours({ error: "not_configured" }), false, "not_configured"],
    ["503 other", 503, ours({ error: "rate_limit_unavailable" }), false, "server_error"],
    ["409 refusal", 409, ours({ error: "own_account" }), false, "refused"],
    ["422 refusal", 422, ours({ error: "invalid_email" }), false, "refused"],
    ["500 from the function", 500, ours({ error: "server_error" }), false, "server_error"],
    ["400 not from the function", 400, null, false, "server_error"],
    ["502 from the gateway", 502, null, false, "server_error"],
  ];
  it.each(cases)("%s", (_label, status, body, success, expected) => {
    expect(classifyStaffAdminReply(status, body, success)).toBe(expected);
  });

  it("is a success only for a 2xx reply from the function", () => {
    expect(classifyStaffAdminReply(200, { fn: FN, success: true }, true)).toBeNull();
    expect(classifyStaffAdminReply(201, { fn: FN, success: true }, true)).toBeNull();
  });
});

describe("staffAdminFailureMessage", () => {
  it("uses the function's own message for a refusal", () => {
    expect(
      staffAdminFailureMessage("refused", {
        fn: FN,
        error: "own_account",
        message: "You can't disable your own account.",
      }),
    ).toBe("You can't disable your own account.");
  });

  it("never shows a message that did not come from the function", () => {
    expect(
      staffAdminFailureMessage("refused", { message: "relay error: something internal" }),
    ).toBe(STAFF_COPY.failure.refused);
    expect(staffAdminFailureMessage("not_deployed", null)).toBe(STAFF_COPY.state.not_deployed);
    expect(staffAdminFailureMessage("offline")).toBe(STAFF_COPY.state.offline);
  });
});

describe("before calling the server", () => {
  it("does not call the function while offline", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    const result = await getStaffOverview();
    expect(result).toMatchObject({ ok: false, failure: "offline" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("does not call the function without an online sign-in", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    expect(await getStaffOverview()).toMatchObject({ ok: false, failure: "not_signed_in" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("does not call the function with another account's sign-in", async () => {
    getSession.mockResolvedValue(sessionFor(NURSE_ID));
    isSignedInStaffAccount.mockReturnValue(false);
    expect(await disableStaffAccount(NURSE_ID)).toMatchObject({
      ok: false,
      failure: "not_signed_in",
    });
    expect(isSignedInStaffAccount).toHaveBeenCalledWith(NURSE_ID);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("does not call the function when the sign-in can't be read", async () => {
    getSession.mockRejectedValue(new Error("storage"));
    expect(await getStaffOverview()).toMatchObject({ ok: false, failure: "not_signed_in" });
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("calling staff-admin", () => {
  it("sends the administrator's own token in an explicit Authorization header", async () => {
    const overview = { fn: FN, success: true, accounts: [], roles: ["nurse"] };
    invoke.mockResolvedValue({ data: overview, error: null });

    const result = await getStaffOverview();

    expect(result).toEqual({ ok: true, data: overview });
    expect(invoke).toHaveBeenCalledWith("staff-admin", {
      body: { action: "overview" },
      headers: { Authorization: "Bearer token-abc" },
    });
  });

  it("pings without needing a sign-in", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    invoke.mockResolvedValue({ data: { fn: FN, success: true, version: "1" }, error: null });

    const result = await pingStaffAdmin();

    expect(result).toMatchObject({ ok: true, data: { version: "1" } });
    expect(getSession).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith("staff-admin", { body: { action: "ping" }, headers: {} });
  });

  it("Add Staff sends no PIN to the server: exactly action, userId, fullName, email and role", async () => {
    const input = {
      userId: NURSE_ID,
      fullName: "Amina Bello",
      email: "amina@example.org",
      role: "nurse",
      pin: "482913",
      confirmPin: "482913",
      phone: "0803 123 4567",
    };
    await createStaffAccount(input);
    const body = sentBody();
    expect(Object.keys(body).sort()).toEqual(["action", "email", "fullName", "role", "userId"]);
    expect(body).toEqual({
      action: "create",
      userId: NURSE_ID,
      fullName: "Amina Bello",
      email: "amina@example.org",
      role: "nurse",
    });
  });

  it("sends only the fields that change on update", async () => {
    await updateStaffAccount(NURSE_ID, { fullName: "Amina B. Bello" });
    expect(sentBody()).toEqual({ action: "update", userId: NURSE_ID, fullName: "Amina B. Bello" });
  });

  it("sends a role on reactivate only when one was chosen", async () => {
    await reactivateStaffAccount(NURSE_ID);
    expect(sentBody()).toEqual({ action: "reactivate", userId: NURSE_ID });
    invoke.mockClear();
    await reactivateStaffAccount(NURSE_ID, "doctor");
    expect(sentBody()).toEqual({ action: "reactivate", userId: NURSE_ID, role: "doctor" });
  });

  it("sends one id for the single-account actions", async () => {
    await getLoginStatus(NURSE_ID);
    await resendInvitation(NURSE_ID);
    await sendPasswordReset(NURSE_ID);
    await disableStaffAccount(NURSE_ID);
    expect(invoke.mock.calls.map((c) => c[1].body)).toEqual([
      { action: "login_status", userId: NURSE_ID },
      { action: "resend_invitation", userId: NURSE_ID },
      { action: "reset_password", userId: NURSE_ID },
      { action: "disable", userId: NURSE_ID },
    ]);
  });

  it("sends the repair actions' confirmation fields", async () => {
    await createLoginForStaffRecord({
      userId: NURSE_ID,
      email: "amina@example.org",
      confirmFullName: "Amina Bello",
    });
    await createStaffRecordForLogin({
      userId: NURSE_ID,
      fullName: "Amina Bello",
      role: "nurse",
      confirmEmail: "amina@example.org",
      acknowledged: true,
    });
    expect(invoke.mock.calls.map((c) => c[1].body)).toEqual([
      {
        action: "create_login",
        userId: NURSE_ID,
        email: "amina@example.org",
        confirmFullName: "Amina Bello",
      },
      {
        action: "create_staff_record",
        userId: NURSE_ID,
        fullName: "Amina Bello",
        role: "nurse",
        confirmEmail: "amina@example.org",
        acknowledged: true,
      },
    ]);
  });

  it("builds bodies from each action's own keys only", () => {
    expect(
      staffAdminRequestBody("disable", { userId: NURSE_ID, pin: "123456", role: "admin" }),
    ).toEqual({ action: "disable", userId: NURSE_ID });
    expect(staffAdminRequestBody("overview", { userId: NURSE_ID })).toEqual({
      action: "overview",
    });
  });
});

describe("reading replies", () => {
  it("returns the function's refusal code and message", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError(409, {
        fn: FN,
        success: false,
        error: "own_account",
        message: "You can't disable your own account.",
      }),
    });
    expect(await disableStaffAccount(ADMIN_ID)).toMatchObject({
      ok: false,
      failure: "refused",
      code: "own_account",
      message: "You can't disable your own account.",
    });
  });

  it("keeps the wait from a rate limit", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError(429, {
        fn: FN,
        success: false,
        error: "rate_limited",
        message: "Too many staff account changes. Try again in 2 minutes.",
        retry_after_seconds: 120,
      }),
    });
    expect(await resendInvitation(NURSE_ID)).toMatchObject({
      ok: false,
      failure: "rate_limited",
      retryAfterSeconds: 120,
      message: "Too many staff account changes. Try again in 2 minutes.",
    });
  });

  it("says the function is not deployed for a 404 without fn", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError(404, { code: "NOT_FOUND", message: "Requested function was not found" }),
    });
    expect(await pingStaffAdmin()).toMatchObject({
      ok: false,
      failure: "not_deployed",
      message: STAFF_COPY.state.not_deployed,
    });
  });

  it("says the function is not deployed for a 2xx reply without fn", async () => {
    invoke.mockResolvedValue({ data: "<html>app</html>", error: null });
    expect(await pingStaffAdmin()).toMatchObject({ ok: false, failure: "not_deployed" });
  });

  it("says unreachable when the request never got an answer", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: { name: "FunctionsFetchError", context: new TypeError("Failed to fetch") },
    });
    expect(await getStaffOverview()).toMatchObject({ ok: false, failure: "unreachable" });

    invoke.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await getStaffOverview()).toMatchObject({ ok: false, failure: "unreachable" });
  });

  it("says unreachable when no reply comes in time", async () => {
    vi.useFakeTimers();
    invoke.mockReturnValue(new Promise(() => {}));
    const pending = getStaffOverview();
    for (let i = 0; i < 20 && invoke.mock.calls.length === 0; i++) await Promise.resolve();
    expect(invoke).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(STAFF_ADMIN_TIMEOUT_MS);
    expect(await pending).toMatchObject({ ok: false, failure: "unreachable" });
  });
});

describe("newStaffId", () => {
  it("returns a new uuid v4 each time", () => {
    const a = newStaffId();
    const b = newStaffId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(a).not.toBe(b);
  });
});

describe("probeAuthHealth", () => {
  it("is true when the sign-in service answers at all", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://server.example/");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await probeAuthHealth()).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe("https://server.example/auth/v1/health");
  });

  it("is false when nothing answers or no server is set", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://server.example");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    expect(await probeAuthHealth()).toBe(false);

    vi.stubEnv("VITE_SUPABASE_URL", "");
    expect(await probeAuthHealth()).toBe(false);
  });
});

// Keep last: it reloads the module with no server client.
describe("without a server", () => {
  it("never calls the function", async () => {
    vi.resetModules();
    vi.doMock("@/lib/supabase", () => ({ supabase: null }));
    const mod = await import("./staffAccounts");
    expect(await mod.getStaffOverview()).toMatchObject({ ok: false, failure: "no_server" });
    expect(await mod.pingStaffAdmin()).toMatchObject({ ok: false, failure: "no_server" });
    expect(invoke).not.toHaveBeenCalled();
    vi.doUnmock("@/lib/supabase");
  });
});
