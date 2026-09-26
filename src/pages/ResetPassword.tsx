import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  CheckCircleIcon,
  ExclamationCircleIcon,
} from "@heroicons/react/20/solid";
import { supabase, type Session } from "@/lib/supabaseClient";
import {
  MIN_PASSWORD_LENGTH,
  completePasswordReset,
  expiredLinkMessage,
  loginPathFor,
  parseAudience,
  parseRecoveryLanding,
  redeemInviteToken,
  resolveResetAudience,
  validateNewPassword,
  type ResetAudience,
} from "@/services/passwordReset";

/**
 * "confirm" is the invitation token_hash flow: the page waits for Continue
 * before redeeming the link, so a mail scanner that opens it cannot use it up.
 */
type Stage = "checking" | "confirm" | "ready" | "invalid" | "done";

/** How long to wait for supabase-js to turn the link's token into a session. */
const SESSION_WAIT_MS = 10_000;

const FORGOT_PATH: Record<ResetAudience, string> = {
  staff: "/forgot-password",
  patient: "/patient/forgot-password",
};

// By the time this page loads, Supabase has already used the token in the
// email, so opening that email link again would not help. supabase-js leaves
// the token it was handed in the address bar when the exchange fails, so
// reloading once connected can finish the check.
const OFFLINE_REASON =
  "This device is offline, so the reset link could not be checked. Connect to the internet and reload this page. If it still does not work, request a new link.";
const INVITE_OFFLINE_REASON =
  "This device is offline, so the invitation link could not be checked. Connect to the internet and reload this page. If it still does not work, ask your administrator to send a new one.";

// The session this page got belongs to another account than the link's token,
// e.g. someone else is signed in on this browser. Never set their password.
const WRONG_ACCOUNT_REASON =
  "This link is for a different account than the one signed in on this browser. Sign out, then open the link again.";

function deviceOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/**
 * Landing page for the password-reset email link (/reset-password).
 *
 * supabase-js exchanges the token in the URL for a recovery session on its own
 * (detectSessionInUrl); this page waits for that session, then lets the user
 * choose a new password. It is imported eagerly in App so that
 * services/passwordReset captures the landing URL before supabase-js strips
 * the token from it.
 *
 * The links point at the staff or the patient sign-in according to the ?for=
 * hint the email link carries. A link that Supabase redirected to the Site URL
 * (allow-list misconfiguration) arrives here without it, so the account type
 * is then looked up from the recovery session instead.
 *
 * A staff invitation uses the same page with invitation wording. A default
 * template invitation arrives as a hash token like a reset; the documented
 * template's token_hash is redeemed only when the person presses Continue.
 * When the hash token names an account, a session for any other account is
 * refused.
 */
export default function ResetPassword() {
  const [params] = useSearchParams();
  const audienceHint = params.get("for");
  const [audience, setAudience] = useState<ResetAudience>(() => parseAudience(audienceHint));
  const loginPath = loginPathFor(audience);
  const forgotPath = FORGOT_PATH[audience];

  const [landing] = useState(() => parseRecoveryLanding());
  const isInvite = landing.kind === "invite";

  const [stage, setStage] = useState<Stage>(() =>
    landing.flow === "token_hash" ? "confirm" : "checking",
  );
  const [invalidReason, setInvalidReason] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [redeeming, setRedeeming] = useState(false);

  useEffect(() => {
    const invite = landing.kind === "invite";
    const fail = (reason: string) => {
      setInvalidReason(reason);
      setStage((s) => (s === "checking" || s === "confirm" ? "invalid" : s));
    };

    if (!supabase) {
      fail(
        invite
          ? "Setting a password is not available here because online accounts are not set up for this app."
          : "Password reset is not available here because online accounts are not set up for this app.",
      );
      return;
    }
    if (landing.error) {
      fail(landing.error);
      return;
    }
    // The invitation token_hash is redeemed by handleContinue, never here.
    // No stored session is accepted meanwhile: it is not the invitee's.
    if (landing.flow === "token_hash") return;

    let settled = false;
    let disposed = false;
    const ready = (session: Session) => {
      if (settled) return;
      settled = true;
      if (landing.tokenSubject && session.user?.id !== landing.tokenSubject) {
        fail(WRONG_ACCOUNT_REASON);
        return;
      }
      setStage((s) => (s === "checking" ? "ready" : s));
      if (!audienceHint) {
        void resolveResetAudience(session.user?.id).then((resolved) => {
          if (!disposed) setAudience(resolved);
        });
      }
    };

    // Only a session that came from the email link counts. An ordinary
    // signed-in session must not be able to set a password here without it.
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && (event === "PASSWORD_RECOVERY" || landing.hasToken)) ready(session);
    });

    if (!landing.hasToken) {
      // PASSWORD_RECOVERY may still arrive if supabase-js has not finished
      // reading the URL; give it a moment before giving up.
      const early = setTimeout(() => {
        if (!settled) {
          settled = true;
          fail(
            invite
              ? "Open this page from the link in your invitation email."
              : "Open this page from the link in your password reset email.",
          );
        }
      }, 1500);
      return () => {
        disposed = true;
        listener.subscription.unsubscribe();
        clearTimeout(early);
      };
    }

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (data.session) ready(data.session);
      })
      .catch(() => {
        // The timeout below reports the failure.
      });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        // Without a connection the token cannot be exchanged at all; saying
        // the link expired would send the user off to request another one.
        fail(
          deviceOffline()
            ? invite
              ? INVITE_OFFLINE_REASON
              : OFFLINE_REASON
            : expiredLinkMessage(landing.kind),
        );
      }
    }, SESSION_WAIT_MS);

    return () => {
      disposed = true;
      listener.subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, [audienceHint, landing]);

  const handleContinue = async () => {
    setRedeeming(true);
    setError(null);
    const result = await redeemInviteToken(landing.tokenHash);
    setRedeeming(false);
    if (result.ok) {
      setStage("ready");
      if (!audienceHint) {
        void resolveResetAudience(result.session?.user?.id).then(setAudience);
      }
    } else if (result.reason === "expired") {
      setInvalidReason(expiredLinkMessage("invite"));
      setStage("invalid");
    } else {
      // Nothing was used up, so Continue can simply be pressed again.
      setError(
        deviceOffline()
          ? "This device is offline. Connect to the internet, then press Continue again."
          : "Could not check your invitation link. Press Continue to try again.",
      );
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = validateNewPassword(password, confirm);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    const result = await completePasswordReset(password, {
      // The "password set" marker is for staff accounts only.
      markPasswordSet: audience === "staff" || isInvite,
      kind: landing.kind,
    });
    setSaving(false);
    if (result.ok) {
      setPassword("");
      setConfirm("");
      setStage("done");
    } else {
      setError(result.message);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas px-4 py-8 sm:p-6">
      <div className="w-full max-w-md">
        <div className="panel p-6">
          <h1 className="text-h2 text-ink mb-4">
            {isInvite ? "Set your password" : "Choose a new password"}
          </h1>

          {stage === "checking" && (
            <div
              className="flex items-center gap-3 text-body text-ink-muted"
              role="status"
            >
              <span
                className="h-5 w-5 shrink-0 rounded-full border-2 border-primary border-t-transparent animate-spin"
                aria-hidden
              />
              {isInvite ? "Checking your invitation link…" : "Checking your reset link…"}
            </div>
          )}

          {stage === "confirm" && (
            <div className="space-y-4">
              <p className="text-body text-ink">
                Welcome to mBHR. Press Continue to set your password.
              </p>
              {error && (
                <div className="banner banner-danger" role="alert">
                  <ExclamationCircleIcon
                    className="h-5 w-5 shrink-0 mt-0.5"
                    aria-hidden
                  />
                  <p>{error}</p>
                </div>
              )}
              <button
                type="button"
                onClick={() => void handleContinue()}
                disabled={redeeming}
                className="btn-primary w-full h-12"
              >
                {redeeming ? "Checking…" : "Continue"}
              </button>
            </div>
          )}

          {stage === "invalid" && (
            <div className="space-y-4">
              <div className="banner banner-danger" role="alert">
                <ExclamationCircleIcon
                  className="h-5 w-5 shrink-0 mt-0.5"
                  aria-hidden
                />
                <p>{invalidReason}</p>
              </div>
              {(invalidReason === OFFLINE_REASON ||
                invalidReason === INVITE_OFFLINE_REASON) && (
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="btn-primary w-full"
                >
                  Reload page
                </button>
              )}
              {/* Only an administrator can send a new invitation. */}
              {!isInvite && (
                <Link
                  to={forgotPath}
                  className={`${
                    invalidReason === OFFLINE_REASON ? "btn-secondary" : "btn-primary"
                  } w-full`}
                >
                  Request a new link
                </Link>
              )}
              <Link
                to={loginPath}
                className="mx-auto flex min-h-touch-target w-fit items-center rounded-md px-2 text-label text-primary hover:text-primary-hover underline"
              >
                Back to sign in
              </Link>
            </div>
          )}

          {stage === "ready" && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="new-password" className="field-label">
                  New password
                </label>
                <input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={MIN_PASSWORD_LENGTH}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input-field h-12 text-base"
                  aria-describedby="new-password-hint"
                  required
                  disabled={saving}
                />
                <p id="new-password-hint" className="field-hint">
                  At least {MIN_PASSWORD_LENGTH} characters.
                </p>
              </div>
              <div>
                <label htmlFor="confirm-password" className="field-label">
                  Confirm new password
                </label>
                <input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="input-field h-12 text-base"
                  required
                  disabled={saving}
                />
              </div>
              {error && (
                <div className="banner banner-danger" role="alert">
                  <ExclamationCircleIcon
                    className="h-5 w-5 shrink-0 mt-0.5"
                    aria-hidden
                  />
                  <p>{error}</p>
                </div>
              )}
              <button
                type="submit"
                disabled={saving}
                className="btn-primary w-full h-12"
              >
                {saving ? "Saving…" : isInvite ? "Save password" : "Save new password"}
              </button>
            </form>
          )}

          {stage === "done" && (
            <div className="space-y-4" role="status">
              <div className="banner banner-success">
                <CheckCircleIcon
                  className="h-5 w-5 shrink-0 mt-0.5"
                  aria-hidden
                />
                {isInvite ? (
                  <div>
                    <p className="font-medium mb-1">Your password is set.</p>
                    <p className="text-caption">
                      Sign in with your email and this password. The first time
                      you sign in on a device, you'll also choose a PIN for
                      offline use.
                    </p>
                  </div>
                ) : (
                  <div>
                    <p className="font-medium mb-1">Password updated</p>
                    <p className="text-caption">
                      You've been signed out on all devices. Sign in again with
                      your new password.
                    </p>
                  </div>
                )}
              </div>
              <Link to={loginPath} className="btn-primary w-full">
                Go to sign in
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
