import { describe, it, expect, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  maskDestination,
  normalizeEmail,
  normalizeNigerianPhone,
  parseCodeChannels,
  sendFailureReason,
  sendPortalCode,
  verifyFailureReason,
  verifyPortalCode,
} from "./portalCodeSignIn";

function fakeClient(auth: Record<string, unknown>) {
  return { auth } as unknown as SupabaseClient;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseCodeChannels", () => {
  it("reads the switched-on channels and ignores anything else", () => {
    expect(parseCodeChannels("")).toEqual([]);
    expect(parseCodeChannels(undefined)).toEqual([]);
    expect(parseCodeChannels("sms")).toEqual(["sms"]);
    expect(parseCodeChannels(" SMS , email ,sms,whatsapp")).toEqual(["sms", "email"]);
  });
});

describe("normalizeNigerianPhone", () => {
  it.each([
    ["0803 123 4567", "+2348031234567"],
    ["803-123-4567", "+2348031234567"],
    ["2348031234567", "+2348031234567"],
    ["+234 803 123 4567", "+2348031234567"],
    ["07012345678", "+2347012345678"],
    ["09012345678", "+2349012345678"],
  ])("accepts %s", (input, expected) => {
    expect(normalizeNigerianPhone(input)).toBe(expected);
  });

  it.each(["", "12345", "0603 123 4567", "+44 7700 900123", "080312345678"])(
    "rejects %s",
    (input) => {
      expect(normalizeNigerianPhone(input)).toBeNull();
    },
  );
});

describe("normalizeEmail", () => {
  it("trims and lower-cases a valid address", () => {
    expect(normalizeEmail("  Ada@Example.COM ")).toBe("ada@example.com");
  });
  it("rejects an address without a domain", () => {
    expect(normalizeEmail("ada@")).toBeNull();
    expect(normalizeEmail("ada")).toBeNull();
  });
});

describe("maskDestination", () => {
  it("shows only the start and the last four digits of a phone", () => {
    const masked = maskDestination({ channel: "sms", value: "+2348031234567" });
    expect(masked.startsWith("+234")).toBe(true);
    expect(masked.endsWith("4567")).toBe(true);
    expect(masked).not.toContain("803123");
  });
  it("shows only the start of an email's name", () => {
    expect(maskDestination({ channel: "email", value: "adaeze@example.com" })).toBe(
      "ad•••@example.com",
    );
  });
});

describe("failure reasons", () => {
  it("maps send failures without revealing whether an account exists", () => {
    expect(sendFailureReason({ name: "AuthRetryableFetchError" })).toBe("offline");
    expect(sendFailureReason({ status: 429 })).toBe("rate_limited");
    expect(sendFailureReason({ code: "over_sms_send_rate_limit" })).toBe("rate_limited");
    expect(sendFailureReason({ code: "sms_send_failed" })).toBe("delivery_failed");
    expect(sendFailureReason({ code: "otp_disabled", status: 422 })).toBe("unavailable");
    expect(sendFailureReason({ code: "user_not_found", status: 400 })).toBe("unavailable");
  });

  it("treats wrong and expired codes the same", () => {
    expect(verifyFailureReason({ code: "otp_expired", status: 403 })).toBe("invalid");
    expect(verifyFailureReason({ status: 400 })).toBe("invalid");
    expect(verifyFailureReason({ status: 429 })).toBe("rate_limited");
    expect(verifyFailureReason({ name: "AuthRetryableFetchError" })).toBe("offline");
    expect(verifyFailureReason({ status: 500 })).toBe("failed");
  });
});

describe("sendPortalCode", () => {
  it("texts a code without ever creating an account", async () => {
    const signInWithOtp = vi.fn().mockResolvedValue({ error: null });
    const result = await sendPortalCode(fakeClient({ signInWithOtp }), {
      channel: "sms",
      value: "+2348031234567",
    });
    expect(result).toEqual({ ok: true });
    expect(signInWithOtp).toHaveBeenCalledWith({
      phone: "+2348031234567",
      options: { shouldCreateUser: false, channel: "sms" },
    });
  });

  it("emails a code without ever creating an account", async () => {
    const signInWithOtp = vi.fn().mockResolvedValue({ error: null });
    await sendPortalCode(fakeClient({ signInWithOtp }), {
      channel: "email",
      value: "ada@example.com",
    });
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "ada@example.com",
      options: { shouldCreateUser: false },
    });
  });

  it("reports a provider failure instead of claiming the code was sent", async () => {
    const signInWithOtp = vi
      .fn()
      .mockResolvedValue({ error: { code: "sms_send_failed", status: 500 } });
    const result = await sendPortalCode(fakeClient({ signInWithOtp }), {
      channel: "sms",
      value: "+2348031234567",
    });
    expect(result).toEqual({ ok: false, reason: "delivery_failed" });
  });

  it("does not try when the device is offline", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    const signInWithOtp = vi.fn();
    const result = await sendPortalCode(fakeClient({ signInWithOtp }), {
      channel: "sms",
      value: "+2348031234567",
    }).finally(() => {
      delete (navigator as unknown as Record<string, unknown>).onLine;
    });
    expect(result).toEqual({ ok: false, reason: "offline" });
    expect(signInWithOtp).not.toHaveBeenCalled();
  });
});

describe("verifyPortalCode", () => {
  it("checks an SMS code as type sms", async () => {
    const verifyOtp = vi
      .fn()
      .mockResolvedValue({ data: { session: { access_token: "x" } }, error: null });
    const result = await verifyPortalCode(
      fakeClient({ verifyOtp }),
      { channel: "sms", value: "+2348031234567" },
      "123456",
    );
    expect(result).toEqual({ ok: true });
    expect(verifyOtp).toHaveBeenCalledWith({
      phone: "+2348031234567",
      token: "123456",
      type: "sms",
    });
  });

  it("checks an email code as type email", async () => {
    const verifyOtp = vi
      .fn()
      .mockResolvedValue({ data: { session: { access_token: "x" } }, error: null });
    await verifyPortalCode(
      fakeClient({ verifyOtp }),
      { channel: "email", value: "ada@example.com" },
      "123456",
    );
    expect(verifyOtp).toHaveBeenCalledWith({
      email: "ada@example.com",
      token: "123456",
      type: "email",
    });
  });

  it("fails when no session comes back", async () => {
    const verifyOtp = vi.fn().mockResolvedValue({ data: { session: null }, error: null });
    const result = await verifyPortalCode(
      fakeClient({ verifyOtp }),
      { channel: "sms", value: "+2348031234567" },
      "123456",
    );
    expect(result).toEqual({ ok: false, reason: "failed" });
  });

  it("reports a wrong code", async () => {
    const verifyOtp = vi
      .fn()
      .mockResolvedValue({ data: {}, error: { code: "otp_expired", status: 403 } });
    const result = await verifyPortalCode(
      fakeClient({ verifyOtp }),
      { channel: "sms", value: "+2348031234567" },
      "000000",
    );
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });
});
