import { describe, it, expect } from "vitest";
import { OTP_SENDER_ROLES, routeEmailRequest } from "./emailRequest";

describe("OTP_SENDER_ROLES", () => {
  it("lets only an administrator send a verification code email", () => {
    expect(OTP_SENDER_ROLES).toEqual(["admin"]);
  });
});

describe("routeEmailRequest", () => {
  it("routes a portal invitation to the server-built invitation", () => {
    expect(routeEmailRequest({ purpose: "portal_invitation", patientId: "p1" })).toEqual({
      kind: "invitation",
    });
  });

  it("routes a code request to the admin-only branch without checking the address or code", () => {
    // The administrator check runs first; the address and the code are
    // validated only afterwards, so even malformed ones route here.
    for (const body of [
      { email: "ada@example.org", otp: "123456" },
      { email: "not an address", otp: "12" },
      { otp: 123456 },
      {},
    ]) {
      expect(routeEmailRequest(body)).toEqual({ kind: "otp" });
    }
  });

  it("refuses the old free-text mode", () => {
    const route = routeEmailRequest({
      email: "ada@example.org",
      subject: "Hello",
      message: "Any text",
    });
    expect(route.kind).toBe("refused");
    expect(route.kind === "refused" && route.error).toBe("message_mode_removed");
  });

  it("refuses an unknown purpose and a body that is not an object", () => {
    const unknown = routeEmailRequest({ purpose: "newsletter" });
    expect(unknown.kind === "refused" && unknown.error).toBe("invalid_purpose");
    for (const body of [null, "text", 42, ["a"]]) {
      const route = routeEmailRequest(body);
      expect(route.kind === "refused" && route.error).toBe("invalid_request");
    }
  });
});
