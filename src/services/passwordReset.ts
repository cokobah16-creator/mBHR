/**
 * Password recovery for Supabase-backed accounts (online staff sign-in and the
 * patient portal).
 *
 * Flow:
 *   1. /forgot-password or /patient/forgot-password calls requestPasswordReset().
 *      Supabase emails a one-time link that comes back to
 *      /reset-password?for=<audience>. Supabase only honours that URL when it
 *      is on the project's redirect allow list (or on the Site URL's host);
 *      otherwise it silently sends the user to the Site URL instead, without
 *      the query string, and lib/recoveryLanding moves the token on to
 *      /reset-password from there (see docs/PASSWORD_RECOVERY.md).
 *   2. The link lands on /reset-password. supabase-js (detectSessionInUrl) turns
 *      the token in the URL into a short-lived recovery session. The page reads
 *      the audience from ?for= or, when the link lost it in step 1's fallback,
 *      works it out from the recovery session.
 *   3. The user picks a new password; completePasswordReset() saves it and then
 *      signs out everywhere, so a session opened by whoever had the old password
 *      does not survive the reset.
 *
 * Staff invitations land on the same page (docs/PASSWORD_RECOVERY.md,
 * "Invitation links"). An invitation arrives in one of two forms:
 *   - the default email template: the implicit-flow token in the hash with
 *     `type=invite`, which supabase-js turns into a session like a recovery;
 *   - the documented template: `?token_hash=…&type=invite`, which is redeemed
 *     only when the person presses Continue (redeemInviteToken), so a mail
 *     scanner that opens the link cannot use it up.
 * The redirect carries `link=invite`, so an expired invitation (which comes
 * back without a `type`) is still worded as an invitation.
 *
 * Offline PINs are not covered here: staff PINs live only on the device and are
 * reset by an administrator from Users; offline patient PINs are reset at the
 * clinic.
 */
import { supabase, type Session } from "@/lib/supabaseClient";
import { appLinkOrigin } from "@/config/canonicalOrigin";

export type ResetAudience = "staff" | "patient";

export const MIN_PASSWORD_LENGTH = 8;

/** Seconds before the "send it again" button re-enables. */
export const RESEND_COOLDOWN_SECONDS = 60;

/** The URL this tab was opened with, captured before supabase-js strips the token from it. */
const landingUrl = typeof window !== "undefined" ? window.location.href : "";

/** Reads the `?for=` hint the reset link carries; anything unknown is a patient. */
export function parseAudience(value: string | null | undefined): ResetAudience {
  return value === "staff" ? "staff" : "patient";
}

export function loginPathFor(audience: ResetAudience): string {
  return audience === "staff" ? "/login" : "/patient/login";
}

/**
 * Where the email link comes back to. Supabase keeps the query string on both
 * the success and the error redirect, so ?for= reaches the reset page in every
 * case and the page can point at the right sign-in even for an expired link.
 * An allow-list entry for this path must therefore admit a query string: the
 * Site URL's host always does; for any other host use
 * `https://<host>/reset-password**` (see docs/PASSWORD_RECOVERY.md).
 */
export function resetRedirectUrl(origin: string, audience: ResetAudience): string {
  return `${origin}/reset-password?for=${audience}`;
}

/**
 * Fallback for a link that arrived without ?for= (Supabase drops the query
 * string when it falls back to the Site URL). Works out which sign-in page the
 * account behind a recovery session belongs to: staff accounts have an
 * app_users row (id = the online user id), which RLS lets the account itself
 * read; every other account is a patient-portal account. Anything that stops
 * the lookup (offline, RLS, network) is answered with "patient", which only
 * affects where the "sign in" links point.
 */
export async function resolveResetAudience(userId: string): Promise<ResetAudience> {
  if (!supabase || !userId) return "patient";
  try {
    const { data, error } = await supabase
      .from("app_users")
      .select("id")
      .eq("id", userId)
      .maybeSingle();
    if (error) {
      // The error code only: the message can echo the account being looked up.
      console.warn("[passwordReset] app_users lookup failed:", error.code || "unknown");
      return "patient";
    }
    return data ? "staff" : "patient";
  } catch {
    return "patient";
  }
}

/** What the email link was for: a password reset or a staff invitation. */
export type LandingKind = "recovery" | "invite";

export interface RecoveryLanding {
  /**
   * The URL carries a token this page accepts: an implicit-flow token in the
   * hash (`type=recovery` or `type=invite` plus an access token), or an
   * invitation `token_hash` in the query string.
   */
  hasToken: boolean;
  kind: LandingKind;
  /** How the token arrived; null when there is none. */
  flow: "fragment" | "token_hash" | null;
  /** The invitation token to redeem with Continue (token_hash flow only). */
  tokenHash: string | null;
  /**
   * The account the hash token was issued for (its `sub` claim), used to make
   * sure the session this page ends up with belongs to the same account.
   */
  tokenSubject: string | null;
  /** The error Supabase reported means the link expired or was already used. */
  expired: boolean;
  /** Error Supabase put in the URL, e.g. an expired or already-used link. */
  error: string | null;
}

const RESET_EXPIRED =
  "This reset link has expired or has already been used. Request a new one.";
const INVITE_EXPIRED =
  "This invitation link has expired or was already used. Ask your administrator to send a new one.";

/** The message for a link that expired or was already used. */
export function expiredLinkMessage(kind: LandingKind): string {
  return kind === "invite" ? INVITE_EXPIRED : RESET_EXPIRED;
}

/**
 * Reads the `sub` claim (the account id) from an access token without
 * verifying it. Only used to check that the session this page ends up with
 * belongs to the account the link was issued for; Supabase verifies the token
 * itself. Returns null for anything that is not a readable JWT.
 */
export function accessTokenSubject(token: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || !parts[1]) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
    // Undo the byte-per-character decoding of atob so UTF-8 claims survive.
    const json = decodeURIComponent(
      Array.from(binary, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`).join(""),
    );
    const payload: unknown = JSON.parse(json);
    if (!payload || typeof payload !== "object") return null;
    const sub = (payload as { sub?: unknown }).sub;
    return typeof sub === "string" && sub ? sub : null;
  } catch {
    return null;
  }
}

/**
 * Reads what the email link put in the URL. Supabase puts the implicit-flow
 * token in the hash and reports errors in either the hash or the query string.
 */
export function parseRecoveryLanding(href: string = landingUrl): RecoveryLanding {
  const none = (kind: LandingKind): RecoveryLanding => ({
    hasToken: false,
    kind,
    flow: null,
    tokenHash: null,
    tokenSubject: null,
    expired: false,
    error: null,
  });
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return none("recovery");
  }
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  const query = url.searchParams;
  const read = (key: string) => hash.get(key) ?? query.get(key);
  const hashType = hash.get("type");
  // The invitation redirect carries ?link=invite, which survives on the error
  // redirect too; the hash `type` does not.
  const linkKind: LandingKind = query.get("link") === "invite" ? "invite" : "recovery";

  const errorCode = read("error_code");
  const errorDescription = read("error_description");
  if (errorCode || errorDescription || read("error")) {
    const kind: LandingKind = hashType === "invite" ? "invite" : linkKind;
    const expired = errorCode === "otp_expired" || /expired|invalid/i.test(errorDescription ?? "");
    return {
      ...none(kind),
      expired,
      error: expired
        ? expiredLinkMessage(kind)
        : errorDescription ||
          (kind === "invite"
            ? "This invitation link could not be used. Ask your administrator to send a new one."
            : "This reset link could not be used. Request a new one."),
    };
  }

  // Only a real token counts. `type=recovery` on its own (or a PKCE-style
  // ?code=, which this app's client never issues) must not let a browser that
  // is merely signed in reach the password form. With a token present,
  // supabase-js drops any stored session if the token does not verify.
  const accessToken = hash.get("access_token");
  if ((hashType === "recovery" || hashType === "invite") && accessToken) {
    return {
      ...none(hashType as LandingKind),
      hasToken: true,
      flow: "fragment",
      tokenSubject: accessTokenSubject(accessToken),
    };
  }

  // The documented invitation template: supabase-js does not act on a
  // token_hash, so the page redeems it when the person presses Continue.
  const tokenHash = query.get("token_hash");
  if (tokenHash && query.get("type") === "invite") {
    return { ...none("invite"), hasToken: true, flow: "token_hash", tokenHash };
  }

  return none(linkKind);
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

// Flat rather than a discriminated union: tsconfig has strict off, and without
// strictNullChecks TypeScript does not narrow on a boolean `ok`.
export interface RequestResetResult {
  ok: boolean;
  reason?: "offline" | "rate_limited" | "network" | "invalid_email";
  message?: string;
}

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
  // Reset links always return to the canonical address (mbhr.app), where
  // this browser's staff data lives, not a preview or deployment URL.
  origin: string = appLinkOrigin(),
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

export interface CompleteResetResult {
  ok: boolean;
  message?: string;
}

export interface CompleteResetOptions {
  /**
   * Also record when the password was set (user_metadata.mbhr_password_set_at).
   * Only for staff accounts and invitations; the Users screen shows it as a
   * status label and nothing relies on it for access.
   */
  markPasswordSet: boolean;
  /** Words the expired-session message for an invitation. Defaults to a reset. */
  kind?: LandingKind;
}

/** Saves the new password for the current recovery session, then signs out everywhere. */
export async function completePasswordReset(
  password: string,
  opts: CompleteResetOptions,
): Promise<CompleteResetResult> {
  if (!supabase) {
    return { ok: false, message: "Password reset needs an internet connection." };
  }
  try {
    const { error } = await supabase.auth.updateUser(
      opts.markPasswordSet
        ? { password, data: { mbhr_password_set_at: new Date().toISOString() } }
        : { password },
    );
    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes("different from the old") || msg.includes("same_password")) {
        return { ok: false, message: "Choose a password you haven't used for this account before." };
      }
      if (msg.includes("session") || msg.includes("jwt") || error.status === 401) {
        return {
          ok: false,
          message:
            opts.kind === "invite"
              ? "Your invitation link has expired. Ask your administrator to send a new one."
              : "Your reset link has expired. Request a new one and try again.",
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

// Flat for the same reason as RequestResetResult.
export interface RedeemInviteResult {
  ok: boolean;
  session?: Session;
  reason?: "expired" | "error";
}

/**
 * Redeems an invitation token_hash for a session. Called only when the person
 * presses Continue, never on page load, so a mail scanner that opens the link
 * does not use it up. "expired" covers a link that expired, was already used
 * or no longer matches an invitation; "error" is anything else (offline,
 * server), after which pressing Continue again may work.
 */
export async function redeemInviteToken(tokenHash: string): Promise<RedeemInviteResult> {
  if (!supabase || !tokenHash) return { ok: false, reason: "error" };
  try {
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: "invite",
    });
    if (error) {
      const code = (error as { code?: string }).code;
      if (
        code === "otp_expired" ||
        code === "invite_not_found" ||
        /expired|invalid/i.test(error.message ?? "")
      ) {
        return { ok: false, reason: "expired" };
      }
      console.warn("[passwordReset] invitation check failed:", code || error.status || "unknown");
      return { ok: false, reason: "error" };
    }
    if (!data?.session) return { ok: false, reason: "error" };
    return { ok: true, session: data.session };
  } catch {
    return { ok: false, reason: "error" };
  }
}
