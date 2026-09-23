/**
 * Password recovery for Supabase-backed accounts (online staff sign-in and the
 * patient portal).
 *
 * Flow:
 *   1. /forgot-password or /patient/forgot-password calls requestPasswordReset().
 *      Supabase emails a one-time link pointing at /reset-password?for=<audience>.
 *   2. The link lands on /reset-password. supabase-js (detectSessionInUrl) turns
 *      the token in the URL into a short-lived recovery session.
 *   3. The user picks a new password; completePasswordReset() saves it and then
 *      signs out everywhere, so a session opened by whoever had the old password
 *      does not survive the reset.
 *
 * Offline PINs are not covered here: staff PINs live only on the device and are
 * reset by an administrator from Users; offline patient PINs are reset at the
 * clinic.
 */
import { supabase } from "@/lib/supabaseClient";

export type ResetAudience = "staff" | "patient";

export const MIN_PASSWORD_LENGTH = 8;

/** Seconds before the "send it again" button re-enables. */
export const RESEND_COOLDOWN_SECONDS = 60;

/** The URL this tab was opened with, captured before supabase-js strips the token from it. */
const landingUrl = typeof window !== "undefined" ? window.location.href : "";

export function parseAudience(value: string | null | undefined): ResetAudience {
  return value === "staff" ? "staff" : "patient";
}

export function loginPathFor(audience: ResetAudience): string {
  return audience === "staff" ? "/login" : "/patient/login";
}

export function resetRedirectUrl(origin: string, audience: ResetAudience): string {
  return `${origin}/reset-password?for=${audience}`;
}

export interface RecoveryLanding {
  /** The URL carries a recovery token (implicit `type=recovery` or a PKCE `code`). */
  hasToken: boolean;
  /** Error Supabase put in the URL, e.g. an expired or already-used link. */
  error: string | null;
}

/**
 * Reads what the email link put in the URL. Supabase uses the hash for the
 * implicit flow and the query string for PKCE, and reports errors in either.
 */
export function parseRecoveryLanding(href: string = landingUrl): RecoveryLanding {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return { hasToken: false, error: null };
  }
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  const query = url.searchParams;
  const read = (key: string) => hash.get(key) ?? query.get(key);

  const errorCode = read("error_code");
  const errorDescription = read("error_description");
  if (errorCode || errorDescription || read("error")) {
    return {
      hasToken: false,
      error:
        errorCode === "otp_expired" || /expired|invalid/i.test(errorDescription ?? "")
          ? "This reset link has expired or has already been used. Request a new one."
          : errorDescription || "This reset link could not be used. Request a new one.",
    };
  }

  const hasToken =
    read("type") === "recovery" || (!!query.get("code") && !hash.get("access_token"));
  return { hasToken, error: null };
}

/** Returns an error message, or null if the new password is acceptable. */
export function validateNewPassword(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password !== confirm) {
    return "Passwords do not match.";
  }
  return null;
}

export type RequestResetResult =
  | { ok: true }
  | { ok: false; reason: "offline" | "rate_limited" | "network" | "invalid_email"; message: string };

/**
 * Asks Supabase to email a reset link.
 *
 * Success is reported whether or not an account exists for the address:
 * Supabase answers both the same way, and this function must not be more
 * forthcoming than the server about who has an account.
 */
export async function requestPasswordReset(
  email: string,
  audience: ResetAudience,
  origin: string = typeof window !== "undefined" ? window.location.origin : "",
): Promise<RequestResetResult> {
  const address = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    return { ok: false, reason: "invalid_email", message: "Please enter a valid email address." };
  }
  if (!supabase) {
    return {
      ok: false,
      reason: "offline",
      message:
        audience === "staff"
          ? "Online accounts are not available on this device. If you sign in with a PIN, ask an administrator to reset it."
          : "Password reset needs an internet connection. If you use a PIN on this device, ask the clinic to reset it.",
    };
  }

  try {
    const { error } = await supabase.auth.resetPasswordForEmail(address, {
      redirectTo: resetRedirectUrl(origin, audience),
    });
    if (error) {
      if (error.status === 429 || /rate limit|only request this after|too many/i.test(error.message)) {
        return {
          ok: false,
          reason: "rate_limited",
          message: "Too many reset requests. Please wait a minute and try again.",
        };
      }
      // Any other error is about the address or server config; answer as if
      // the email went out so this screen cannot be used to probe for accounts.
      console.warn("[passwordReset] resetPasswordForEmail:", error.message);
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      reason: "network",
      message: "Could not reach the server. Check your connection and try again.",
    };
  }
}

export type CompleteResetResult = { ok: true } | { ok: false; message: string };

/** Saves the new password for the current recovery session, then signs out everywhere. */
export async function completePasswordReset(password: string): Promise<CompleteResetResult> {
  if (!supabase) {
    return { ok: false, message: "Password reset needs an internet connection." };
  }
  try {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes("different from the old") || msg.includes("same_password")) {
        return { ok: false, message: "Choose a password you haven't used for this account before." };
      }
      if (msg.includes("session") || msg.includes("jwt") || error.status === 401) {
        return {
          ok: false,
          message: "Your reset link has expired. Request a new one and try again.",
        };
      }
      if (msg.includes("weak") || msg.includes("password should")) {
        return { ok: false, message: error.message };
      }
      return { ok: false, message: "Could not update your password. Please try again." };
    }
  } catch {
    return { ok: false, message: "Could not reach the server. Check your connection and try again." };
  }

  // End every session for this account, including any opened by whoever knew
  // the old password. The password is already saved, so a failure here is not
  // reported as a failed reset.
  try {
    await supabase.auth.signOut({ scope: "global" });
  } catch {
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  }
  sessionStorage.removeItem("patient_session_token");
  localStorage.removeItem("patient_portal_user");
  localStorage.removeItem("patient_active_profile");
  return { ok: true };
}
