// Patient portal sign-in with a one-time code sent by SMS or email.
//
// Supabase Auth sends and checks the code (signInWithOtp / verifyOtp), so a
// code is never stored or compared in the app. Codes go only to people who
// already have a portal account (shouldCreateUser: false): a code sign-in
// never creates an account, and never a patient record.
//
// Every provider answer is mapped to a small set of reasons the screen can
// explain. Provider text is never shown: it is technical and may repeat the
// phone number or email.

import type { SupabaseClient } from "@supabase/supabase-js";

export type CodeChannel = "sms" | "email";

export interface CodeDestination {
  channel: CodeChannel;
  /** E.164 phone ("+2348031234567") or a lower-case email. */
  value: string;
}

/** Channels switched on by VITE_PORTAL_CODE_CHANNELS ("sms,email"). */
export function parseCodeChannels(raw: string | undefined | null): CodeChannel[] {
  const out: CodeChannel[] = [];
  for (const part of (raw ?? "").split(",")) {
    const c = part.trim().toLowerCase();
    if ((c === "sms" || c === "email") && !out.includes(c)) out.push(c);
  }
  return out;
}

/**
 * A Nigerian mobile number in E.164 form, or null when it cannot be one.
 * Accepts "0803 123 4567", "803-123-4567", "2348031234567", "+234 803…".
 */
export function normalizeNigerianPhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  let national: string;
  if (digits.startsWith("234") && digits.length === 13) national = digits.slice(3);
  else if (digits.startsWith("0") && digits.length === 11) national = digits.slice(1);
  else if (digits.length === 10 && !digits.startsWith("0")) national = digits;
  else return null;
  // Nigerian mobile numbers start 7, 8 or 9 after the leading 0.
  if (!/^[789]\d{9}$/.test(national)) return null;
  return `+234${national}`;
}

export function normalizeEmail(input: string): string | null {
  const email = input.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/**
 * The destination as shown back to the patient: enough to recognise it,
 * not enough to read someone's full number over their shoulder.
 * "+234••••••4567", "ad•••@example.com".
 */
export function maskDestination(dest: CodeDestination): string {
  if (dest.channel === "sms") {
    const v = dest.value;
    if (v.length <= 8) return v;
    return `${v.slice(0, 4)}${"•".repeat(Math.max(3, v.length - 8))}${v.slice(-4)}`;
  }
  const [local, domain] = dest.value.split("@");
  if (!domain) return dest.value;
  const shown = local.slice(0, Math.min(2, local.length));
  return `${shown}•••@${domain}`;
}

export type SendCodeResult =
  | { ok: true }
  | {
      ok: false;
      reason: "offline" | "rate_limited" | "delivery_failed" | "unavailable";
    };

export type VerifyCodeResult =
  | { ok: true }
  | {
      ok: false;
      /** "invalid" covers wrong and expired: Supabase does not tell them apart. */
      reason: "offline" | "invalid" | "rate_limited" | "failed";
    };

interface AuthErrorLike {
  code?: string;
  status?: number;
  name?: string;
  message?: string;
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function isNetworkError(err: AuthErrorLike): boolean {
  return (
    err.name === "AuthRetryableFetchError" ||
    err.name === "TypeError" ||
    err.status === 0
  );
}

/** What a send failure means for the patient. Exported for tests. */
export function sendFailureReason(err: AuthErrorLike): Exclude<SendCodeResult, { ok: true }>["reason"] {
  if (isNetworkError(err)) return "offline";
  const code = err.code ?? "";
  if (err.status === 429 || code.startsWith("over_") || code.includes("rate_limit")) {
    return "rate_limited";
  }
  if (code === "sms_send_failed" || code === "email_send_failed" || code === "hook_timeout") {
    return "delivery_failed";
  }
  // Includes accounts that do not exist (shouldCreateUser: false) and
  // channels switched off in Supabase Auth. The screen says the same thing
  // for all of them, so it never reveals whether an account exists.
  return "unavailable";
}

/** What a verify failure means for the patient. Exported for tests. */
export function verifyFailureReason(err: AuthErrorLike): Exclude<VerifyCodeResult, { ok: true }>["reason"] {
  if (isNetworkError(err)) return "offline";
  const code = err.code ?? "";
  if (err.status === 429 || code.startsWith("over_") || code.includes("rate_limit")) {
    return "rate_limited";
  }
  if (code === "otp_expired" || code === "otp_invalid" || err.status === 400 || err.status === 403) {
    return "invalid";
  }
  return "failed";
}

export async function sendPortalCode(
  client: SupabaseClient,
  dest: CodeDestination,
): Promise<SendCodeResult> {
  if (isOffline()) return { ok: false, reason: "offline" };
  try {
    const { error } =
      dest.channel === "sms"
        ? await client.auth.signInWithOtp({
            phone: dest.value,
            options: { shouldCreateUser: false, channel: "sms" },
          })
        : await client.auth.signInWithOtp({
            email: dest.value,
            options: { shouldCreateUser: false },
          });
    if (error) return { ok: false, reason: sendFailureReason(error as AuthErrorLike) };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: sendFailureReason((err ?? {}) as AuthErrorLike) };
  }
}

export async function verifyPortalCode(
  client: SupabaseClient,
  dest: CodeDestination,
  token: string,
): Promise<VerifyCodeResult> {
  if (isOffline()) return { ok: false, reason: "offline" };
  try {
    const { data, error } =
      dest.channel === "sms"
        ? await client.auth.verifyOtp({ phone: dest.value, token, type: "sms" })
        : await client.auth.verifyOtp({ email: dest.value, token, type: "email" });
    if (error) return { ok: false, reason: verifyFailureReason(error as AuthErrorLike) };
    if (!data?.session) return { ok: false, reason: "failed" };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: verifyFailureReason((err ?? {}) as AuthErrorLike) };
  }
}
