// Pure helpers for the Supabase Auth "Send SMS" hook (auth-send-sms).
//
// No Deno APIs, so vitest can test them. Uses only Web Crypto, atob/btoa and
// TextEncoder, which Deno and Node both provide.
//
// Supabase Auth signs every hook call the Standard Webhooks way
// (https://www.standardwebhooks.com):
//   headers  webhook-id, webhook-timestamp (unix seconds), webhook-signature
//   signed   `${id}.${timestamp}.${rawBody}`, HMAC-SHA256, base64
//   key      the hook secret shown in the dashboard, "v1,whsec_<base64>",
//            base64-decoded after the "v1,whsec_" prefix
//   header   one or more space-separated "v1,<base64 signature>"

/** Calls older or newer than this are refused (replay protection). */
export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export type WebhookCheck =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "no_secret"
        | "missing_headers"
        | "bad_timestamp"
        | "stale"
        | "bad_signature";
    };

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The HMAC key from the dashboard's "v1,whsec_…" secret, or null. */
export function hookSecretKey(secret: string | null | undefined): Uint8Array | null {
  const raw = (secret ?? "").trim().replace(/^v1,/, "").replace(/^whsec_/, "");
  if (!raw) return null;
  try {
    const key = base64ToBytes(raw);
    return key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

export async function signWebhook(
  key: Uint8Array,
  id: string,
  timestamp: string,
  body: string,
): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    // A copy as a plain ArrayBuffer satisfies BufferSource in every TS version.
    key.slice().buffer as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(`${id}.${timestamp}.${body}`),
  );
  return bytesToBase64(new Uint8Array(sig));
}

/**
 * Checks a hook call came from Supabase Auth: signed with this project's
 * hook secret, and recent. Anything else is refused before the body is read
 * for its contents.
 */
export async function verifyWebhook(
  secret: string | null | undefined,
  headers: { get(name: string): string | null },
  body: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<WebhookCheck> {
  const key = hookSecretKey(secret);
  if (!key) return { ok: false, reason: "no_secret" };

  const id = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const signatures = headers.get("webhook-signature");
  if (!id || !timestamp || !signatures) return { ok: false, reason: "missing_headers" };

  if (!/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: "bad_timestamp" };
  if (Math.abs(nowSeconds - Number(timestamp)) > WEBHOOK_TOLERANCE_SECONDS) {
    return { ok: false, reason: "stale" };
  }

  const expected = await signWebhook(key, id, timestamp, body);
  const matched = signatures
    .split(" ")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("v1,"))
    .some((s) => constantTimeEqual(s.slice(3), expected));
  return matched ? { ok: true } : { ok: false, reason: "bad_signature" };
}

export interface SendSmsHookPayload {
  userId: string;
  phone: string;
  otp: string;
  locale: string | null;
}

/**
 * The fields this hook uses from Supabase Auth's payload
 * ({ user: { id, phone, user_metadata }, sms: { otp } }), or null when it is
 * not that shape. The code must be 4 to 10 digits.
 */
export function parseSendSmsPayload(raw: unknown): SendSmsHookPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const { user, sms } = raw as { user?: unknown; sms?: unknown };
  if (!user || typeof user !== "object" || !sms || typeof sms !== "object") return null;
  const u = user as { id?: unknown; phone?: unknown; user_metadata?: unknown };
  const otp = (sms as { otp?: unknown }).otp;
  if (typeof u.id !== "string" || !u.id) return null;
  if (typeof u.phone !== "string" || !u.phone) return null;
  if (typeof otp !== "string" || !/^\d{4,10}$/.test(otp)) return null;
  const meta = u.user_metadata;
  const locale =
    meta && typeof meta === "object" && typeof (meta as { locale?: unknown }).locale === "string"
      ? ((meta as { locale: string }).locale)
      : null;
  return { userId: u.id, phone: u.phone, otp, locale };
}

// Sign-in wording. Says what the code is for so a patient who did not ask
// for it knows to ignore it; never names the clinic record or any health
// detail. English only for now: the other languages are added once their
// wording has been checked, and a missing language falls back to English.
const SIGN_IN_BODIES: Record<string, string> = {
  en: "Your mBHR sign-in code is {{otp}}. Do not share it with anyone. If you did not ask for it, ignore this message.",
};

export function signInSmsText(otp: string, locale?: string | null): string {
  const key = (locale ?? "en").split("-")[0].toLowerCase();
  return (SIGN_IN_BODIES[key] ?? SIGN_IN_BODIES.en).replace("{{otp}}", otp);
}

/** The error body Supabase Auth expects from a failed hook. */
export function hookError(httpCode: number, message: string): string {
  return JSON.stringify({ error: { http_code: httpCode, message } });
}
