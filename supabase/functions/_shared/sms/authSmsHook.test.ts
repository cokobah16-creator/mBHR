import { describe, it, expect } from "vitest";
import {
  WEBHOOK_TOLERANCE_SECONDS,
  hookError,
  hookSecretKey,
  parseSendSmsPayload,
  signInSmsText,
  signWebhook,
  verifyWebhook,
} from "./authSmsHook";

// A made-up test secret in the dashboard's format (not a real one).
const KEY_B64 = btoa("test-hook-secret-0123456789abcdef");
const SECRET = `v1,whsec_${KEY_B64}`;
const NOW = 1_790_000_000;
const BODY = JSON.stringify({
  user: { id: "user-1", phone: "2348031234567" },
  sms: { otp: "123456" },
});

function headersOf(values: Record<string, string>) {
  return new Headers(values);
}

async function signedHeaders(body = BODY, timestamp = String(NOW), id = "msg_1") {
  const sig = await signWebhook(hookSecretKey(SECRET)!, id, timestamp, body);
  return headersOf({
    "webhook-id": id,
    "webhook-timestamp": timestamp,
    "webhook-signature": `v1,${sig}`,
  });
}

describe("hookSecretKey", () => {
  it("reads the dashboard's v1,whsec_ secret", () => {
    expect(hookSecretKey(SECRET)).not.toBeNull();
    expect(hookSecretKey(KEY_B64)).toEqual(hookSecretKey(SECRET));
  });
  it("refuses an empty or unreadable secret", () => {
    expect(hookSecretKey("")).toBeNull();
    expect(hookSecretKey(undefined)).toBeNull();
    expect(hookSecretKey("v1,whsec_")).toBeNull();
    expect(hookSecretKey("v1,whsec_%%%")).toBeNull();
  });
});

describe("verifyWebhook", () => {
  it("accepts a call signed with the hook secret", async () => {
    const result = await verifyWebhook(SECRET, await signedHeaders(), BODY, NOW);
    expect(result).toEqual({ ok: true });
  });

  it("accepts when one of several signatures matches", async () => {
    const good = (await signedHeaders()).get("webhook-signature")!;
    const headers = await signedHeaders();
    headers.set("webhook-signature", `v1,bm90LWl0 ${good}`);
    expect(await verifyWebhook(SECRET, headers, BODY, NOW)).toEqual({ ok: true });
  });

  it("refuses everything when no secret is set", async () => {
    const result = await verifyWebhook(undefined, await signedHeaders(), BODY, NOW);
    expect(result).toEqual({ ok: false, reason: "no_secret" });
  });

  it("refuses an unsigned call", async () => {
    const result = await verifyWebhook(SECRET, headersOf({}), BODY, NOW);
    expect(result).toEqual({ ok: false, reason: "missing_headers" });
  });

  it("refuses a changed body", async () => {
    const headers = await signedHeaders();
    const tampered = BODY.replace("2348031234567", "2348099999999");
    expect(await verifyWebhook(SECRET, headers, tampered, NOW)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("refuses a call signed with another secret", async () => {
    const other = `v1,whsec_${btoa("some-other-secret-value-000000")}`;
    const sig = await signWebhook(hookSecretKey(other)!, "msg_1", String(NOW), BODY);
    const headers = headersOf({
      "webhook-id": "msg_1",
      "webhook-timestamp": String(NOW),
      "webhook-signature": `v1,${sig}`,
    });
    expect(await verifyWebhook(SECRET, headers, BODY, NOW)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("refuses a replayed old call", async () => {
    const old = String(NOW - WEBHOOK_TOLERANCE_SECONDS - 1);
    const result = await verifyWebhook(SECRET, await signedHeaders(BODY, old), BODY, NOW);
    expect(result).toEqual({ ok: false, reason: "stale" });
  });

  it("refuses a timestamp that is not a number", async () => {
    const result = await verifyWebhook(SECRET, await signedHeaders(BODY, "soon"), BODY, NOW);
    expect(result).toEqual({ ok: false, reason: "bad_timestamp" });
  });
});

describe("parseSendSmsPayload", () => {
  it("reads the user, phone and code", () => {
    expect(parseSendSmsPayload(JSON.parse(BODY))).toEqual({
      userId: "user-1",
      phone: "2348031234567",
      otp: "123456",
      locale: null,
    });
  });

  it("reads a locale from user metadata", () => {
    const payload = parseSendSmsPayload({
      user: { id: "u", phone: "2348031234567", user_metadata: { locale: "ha" } },
      sms: { otp: "123456" },
    });
    expect(payload?.locale).toBe("ha");
  });

  it.each([
    null,
    {},
    { user: { id: "u" }, sms: { otp: "123456" } },
    { user: { id: "u", phone: "2348031234567" }, sms: {} },
    { user: { id: "u", phone: "2348031234567" }, sms: { otp: "12ab56" } },
    { user: { phone: "2348031234567" }, sms: { otp: "123456" } },
  ])("refuses %j", (raw) => {
    expect(parseSendSmsPayload(raw)).toBeNull();
  });
});

describe("signInSmsText", () => {
  it("puts the code in a fixed sign-in message", () => {
    const text = signInSmsText("654321");
    expect(text).toContain("654321");
    expect(text).toMatch(/sign-in code/);
    expect(text).toMatch(/Do not share/);
  });

  it("falls back to English for a language without checked wording", () => {
    expect(signInSmsText("654321", "yo")).toBe(signInSmsText("654321", "en"));
  });
});

describe("hookError", () => {
  it("uses the shape Supabase Auth expects", () => {
    expect(JSON.parse(hookError(429, "Too many"))).toEqual({
      error: { http_code: 429, message: "Too many" },
    });
  });
});
