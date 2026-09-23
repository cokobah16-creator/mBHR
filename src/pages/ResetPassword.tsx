import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  CheckCircleIcon,
  ExclamationCircleIcon,
} from "@heroicons/react/20/solid";
import { supabase } from "@/lib/supabaseClient";
import {
  MIN_PASSWORD_LENGTH,
  completePasswordReset,
  loginPathFor,
  parseAudience,
  parseRecoveryLanding,
  validateNewPassword,
  type ResetAudience,
} from "@/services/passwordReset";

type Stage = "checking" | "ready" | "invalid" | "done";

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

function deviceOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/**
 * Landing page for the password-reset email link (/reset-password?for=staff|patient).
 *
 * supabase-js exchanges the token in the URL for a recovery session on its own
 * (detectSessionInUrl); this page waits for that session, then lets the user
 * choose a new password. It is imported eagerly in App so that
 * services/passwordReset captures the landing URL before supabase-js strips
 * the token from it.
 */
export default function ResetPassword() {
  const [params] = useSearchParams();
  const audience = parseAudience(params.get("for"));
  const loginPath = loginPathFor(audience);
  const forgotPath = FORGOT_PATH[audience];

  const [stage, setStage] = useState<Stage>("checking");
  const [invalidReason, setInvalidReason] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const landing = parseRecoveryLanding();
    const fail = (reason: string) => {
      setInvalidReason(reason);
      setStage((s) => (s === "checking" ? "invalid" : s));
    };

    if (!supabase) {
      fail(
        "Password reset is not available here because online accounts are not set up for this app.",
      );
      return;
    }
    if (landing.error) {
      fail(landing.error);
      return;
    }

    let settled = false;
    const ready = () => {
      if (settled) return;
      settled = true;
      setStage((s) => (s === "checking" ? "ready" : s));
    };

    // Only a session that came from the email link counts. An ordinary
    // signed-in session must not be able to set a password here without it.
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && (event === "PASSWORD_RECOVERY" || landing.hasToken)) ready();
    });

    if (!landing.hasToken) {
      // PASSWORD_RECOVERY may still arrive if supabase-js has not finished
      // reading the URL; give it a moment before giving up.
      const early = setTimeout(() => {
        if (!settled) {
          settled = true;
          fail("Open this page from the link in your password reset email.");
        }
      }, 1500);
      return () => {
        listener.subscription.unsubscribe();
        clearTimeout(early);
      };
    }

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (data.session) ready();
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
            ? OFFLINE_REASON
            : "This reset link has expired or has already been used. Request a new one.",
        );
      }
    }, SESSION_WAIT_MS);

    return () => {
      listener.subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = validateNewPassword(password, confirm);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    const result = await completePasswordReset(password);
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
          <h1 className="text-h2 text-ink mb-4">Choose a new password</h1>

          {stage === "checking" && (
            <div
              className="flex items-center gap-3 text-body text-ink-muted"
              role="status"
            >
              <span
                className="h-5 w-5 shrink-0 rounded-full border-2 border-primary border-t-transparent animate-spin"
                aria-hidden
              />
              Checking your reset link…
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
              {invalidReason === OFFLINE_REASON && (
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="btn-primary w-full"
                >
                  Reload page
                </button>
              )}
              <Link
                to={forgotPath}
                className={`${
                  invalidReason === OFFLINE_REASON ? "btn-secondary" : "btn-primary"
                } w-full`}
              >
                Request a new link
              </Link>
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
                {saving ? "Saving…" : "Save new password"}
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
                <div>
                  <p className="font-medium mb-1">Password updated</p>
                  <p className="text-caption">
                    You've been signed out on all devices. Sign in again with
                    your new password.
                  </p>
                </div>
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
