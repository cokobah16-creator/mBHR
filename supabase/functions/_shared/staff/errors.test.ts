import { describe, it, expect } from "vitest";
import {
  REFUSAL_MESSAGES,
  REFUSAL_STATUS,
  authAdminRefusal,
  classifyAuthError,
  invitationError,
  isRefusalCode,
  ownAccountRefusal,
  rateLimitedRefusal,
  refusal,
  refusalBody,
  staffRowRefusal,
} from "./errors";

describe("refusal catalogue", () => {
  it("gives every code a status and a message", () => {
    const codes = Object.keys(REFUSAL_MESSAGES);
    expect(codes.length).toBeGreaterThan(40);
    expect(Object.keys(REFUSAL_STATUS).sort()).toEqual([...codes].sort());
    for (const code of codes) {
      const status = REFUSAL_STATUS[code as keyof typeof REFUSAL_STATUS];
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(600);
      expect(REFUSAL_MESSAGES[code as keyof typeof REFUSAL_MESSAGES].length).toBeGreaterThan(10);
    }
  });

  it("uses plain wording: no em-dashes and no hosting service name", () => {
    for (const message of Object.values(REFUSAL_MESSAGES)) {
      expect(message).not.toMatch(/—/);
      expect(message).not.toMatch(/supabase/i);
      expect(message).toMatch(/[.)]$/);
    }
  });

  it("has the codes the update action needs", () => {
    expect(refusal("nothing_to_update")).toMatchObject({ status: 422, error: "nothing_to_update" });
    expect(refusal("changed_elsewhere")).toEqual({
      status: 409,
      error: "changed_elsewhere",
      message: "Someone else changed this account. Reload and try again.",
    });
    expect(refusal("account_disabled").message).toBe("This account is disabled. Reactivate it first.");
    expect(refusal("permanent_admin").status).toBe(409);
    expect(refusal("last_admin").status).toBe(409);
    expect(refusal("needs_permanent_admin").status).toBe(403);
  });

  it("says plainly that administrators can't be added or restored yet", () => {
    expect(refusal("admin_accounts_unavailable")).toEqual({
      status: 409,
      error: "admin_accounts_unavailable",
      message: "Adding or restoring administrators isn't available on this server yet.",
    });
  });

  it("keeps the statuses the app relies on", () => {
    expect(REFUSAL_STATUS.pin_not_accepted).toBe(400);
    expect(REFUSAL_STATUS.unexpected_field).toBe(400);
    expect(REFUSAL_STATUS.too_large).toBe(413);
    expect(REFUSAL_STATUS.not_authenticated).toBe(401);
    expect(REFUSAL_STATUS.not_permitted).toBe(403);
    expect(REFUSAL_STATUS.not_staff_account).toBe(404);
    expect(REFUSAL_STATUS.rate_limited).toBe(429);
    expect(REFUSAL_STATUS.partial_create).toBe(500);
    expect(REFUSAL_STATUS.login_service_error).toBe(502);
    expect(REFUSAL_STATUS.partial_reactivate).toBe(502);
    expect(REFUSAL_STATUS.not_configured).toBe(503);
    expect(REFUSAL_MESSAGES.pin_not_accepted).toBe("PINs are set on each device, never on the server.");
  });

  it("gives the patient portal refusals one shared message", () => {
    expect(REFUSAL_MESSAGES.patient_login).toBe(REFUSAL_MESSAGES.patient_email);
    expect(REFUSAL_MESSAGES.patient_login).toBe(REFUSAL_MESSAGES.portal_signup);
    expect(REFUSAL_MESSAGES.anonymous_login).toBe(REFUSAL_MESSAGES.login_unconfirmed);
  });

  it("recognises its own codes only", () => {
    expect(isRefusalCode("last_admin")).toBe(true);
    expect(isRefusalCode("toString")).toBe(false);
    expect(isRefusalCode("made_up")).toBe(false);
    expect(isRefusalCode(42)).toBe(false);
  });
});

describe("refusal", () => {
  it("adds a field and replaces the message only when asked", () => {
    expect(refusal("unexpected_field", { field: "adminAccess" })).toEqual({
      status: 400,
      error: "unexpected_field",
      message: "The request had a field this action doesn't accept.",
      field: "adminAccess",
    });
    expect(refusal("own_account", { message: "Other words." }).message).toBe("Other words.");
    expect(Object.keys(refusal("invalid_id"))).toEqual(["status", "error", "message"]);
  });

  it("words own_account for each action", () => {
    expect(ownAccountRefusal("disable").message).toBe("You can't disable your own account.");
    expect(ownAccountRefusal("update")).toEqual({
      status: 409,
      error: "own_account",
      message: "You can't change your own role.",
    });
    expect(ownAccountRefusal("reactivate").message).toBe("You can't reactivate your own account.");
  });

  it("says how many minutes to wait when rate limited", () => {
    expect(rateLimitedRefusal(30)).toEqual({
      status: 429,
      error: "rate_limited",
      message: "Too many staff account changes. Try again in 1 minute.",
      retryAfterSeconds: 30,
    });
    expect(rateLimitedRefusal(61).message).toBe("Too many staff account changes. Try again in 2 minutes.");
    expect(rateLimitedRefusal(600).message).toBe("Too many staff account changes. Try again in 10 minutes.");
    expect(rateLimitedRefusal(Number.NaN).retryAfterSeconds).toBe(60);
    expect(rateLimitedRefusal(0).message).toContain("1 minute.");
  });

  it("builds the reply body with snake_case retry time", () => {
    expect(refusalBody(rateLimitedRefusal(90))).toEqual({
      success: false,
      error: "rate_limited",
      message: "Too many staff account changes. Try again in 2 minutes.",
      retry_after_seconds: 90,
    });
    expect(refusalBody(refusal("invalid_email", { field: "email" }))).toEqual({
      success: false,
      error: "invalid_email",
      message: "Enter a valid email address.",
      field: "email",
    });
  });
});

describe("classifyAuthError", () => {
  it("maps the Auth error codes", () => {
    expect(classifyAuthError({ code: "user_not_found", status: 404 })).toBe("not_found");
    expect(classifyAuthError({ code: "email_exists", status: 422 })).toBe("email_exists");
    expect(classifyAuthError({ code: "user_already_exists", status: 422 })).toBe("id_taken");
    expect(classifyAuthError({ code: "over_email_send_rate_limit", status: 429 })).toBe("email_rate_limited");
    expect(classifyAuthError({ code: "over_request_rate_limit", status: 429 })).toBe("email_rate_limited");
    expect(classifyAuthError({ code: "email_address_not_authorized", status: 400 })).toBe(
      "email_not_authorized",
    );
    expect(classifyAuthError({ code: "otp_expired", status: 403 })).toBe("otp_expired");
    expect(classifyAuthError({ code: "invite_not_found", status: 404 })).toBe("otp_expired");
  });

  it("uses the status only when there is no code", () => {
    expect(classifyAuthError({ status: 404 })).toBe("not_found");
    expect(classifyAuthError({ code: null, status: 429 })).toBe("email_rate_limited");
    expect(classifyAuthError({ code: "unexpected_failure", status: 404 })).toBe("unknown");
  });

  it("never mistakes a transient failure for not found", () => {
    expect(classifyAuthError({ code: "unexpected_failure", status: 500 })).toBe("unknown");
    expect(classifyAuthError({ status: 500 })).toBe("unknown");
    expect(classifyAuthError({ status: 502 })).toBe("unknown");
    expect(classifyAuthError({ code: "constructor" })).toBe("unknown");
    expect(classifyAuthError({})).toBe("unknown");
    expect(classifyAuthError(null)).toBe("unknown");
    expect(classifyAuthError(undefined)).toBe("unknown");
  });
});

describe("authAdminRefusal", () => {
  it("turns each kind into a refusal", () => {
    expect(authAdminRefusal("not_found")).toMatchObject({ status: 404, error: "not_found" });
    expect(authAdminRefusal("email_exists")).toMatchObject({ status: 409, error: "email_in_use" });
    expect(authAdminRefusal("id_taken")).toMatchObject({ status: 409, error: "id_conflict" });
    expect(authAdminRefusal("email_rate_limited")).toMatchObject({ status: 429, error: "email_rate_limited" });
    expect(authAdminRefusal("email_not_authorized")).toMatchObject({
      status: 503,
      error: "email_not_configured",
    });
  });

  it("sends anything unknown to login_service_error", () => {
    expect(authAdminRefusal("unknown")).toEqual({
      status: 502,
      error: "login_service_error",
      message: "The login service didn't respond as expected. Try again.",
    });
    expect(authAdminRefusal("otp_expired").error).toBe("login_service_error");
  });
});

describe("invitationError", () => {
  it("says why an email was not sent", () => {
    expect(invitationError("email_not_authorized")).toBe("email_not_configured");
    expect(invitationError("email_rate_limited")).toBe("email_rate_limited");
    expect(invitationError("unknown")).toBe("send_failed");
    expect(invitationError("email_exists")).toBe("send_failed");
  });
});

describe("staffRowRefusal", () => {
  it("maps the Postgres error codes", () => {
    expect(staffRowRefusal("22P02")).toMatchObject({ status: 422, error: "role_not_available" });
    expect(staffRowRefusal("23514")).toMatchObject({ status: 422, error: "invalid_admin_flags" });
    expect(staffRowRefusal("23505")).toMatchObject({ status: 409, error: "staff_exists" });
    expect(staffRowRefusal("42501")).toMatchObject({ status: 403, error: "not_permitted" });
  });

  it("sends anything unknown to staff_record_error", () => {
    for (const code of ["PGRST116", "08006", "", null, undefined]) {
      expect(staffRowRefusal(code)).toEqual({
        status: 502,
        error: "staff_record_error",
        message: "The staff record couldn't be saved. Try again.",
      });
    }
  });
});
