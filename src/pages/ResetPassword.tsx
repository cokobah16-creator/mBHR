import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase, type Session } from "@/lib/supabaseClient";
import {
  MIN_PASSWORD_LENGTH,
  completePasswordReset,
  loginPathFor,
  parseAudience,
  parseRecoveryLanding,
  resolveResetAudience,
  validateNewPassword,
  type ResetAudience,
} from "@/services/passwordReset";

type Stage = "checking" | "ready" | "invalid" | "done";

/** How long to wait for supabase-js to turn the link's token into a session. */
const SESSION_WAIT_MS = 10_000;

/**
 * Landing page for the password-reset email link (/reset-password).
 *
 * supabase-js exchanges the token in the URL for a recovery session on its own
 * (detectSessionInUrl); this page waits for that session, then lets the user
 * choose a new password. It is imported eagerly in App so that
 * services/passwordReset captures the landing URL before supabase-js strips
 * the token from it.
 *
 * Which sign-in page the links point at is worked out from the recovery
 * session (staff or patient account). Older links carried ?for=staff|patient
 * instead; that hint is still honoured when present.
 */
export default function ResetPassword() {
  const [params] = useSearchParams();
  const audienceHint = params.get("for");
  const [audience, setAudience] = useState<ResetAudience>(() => parseAudience(audienceHint));
  const loginPath = loginPathFor(audience);
  const forgotPath = audience === "staff" ? "/forgot-password" : "/patient/forgot-password";

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
      fail("Password reset needs an internet connection.");
      return;
    }
    if (landing.error) {
      fail(landing.error);
      return;
    }

    let settled = false;
    let disposed = false;
    const ready = (session: Session) => {
      if (settled) return;
      settled = true;
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
          fail("Open this page from the link in your password reset email.");
        }
      }, 1500);
      return () => {
        disposed = true;
        listener.subscription.unsubscribe();
        clearTimeout(early);
      };
    }

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) ready(data.session);
    });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        fail("This reset link has expired or has already been used. Request a new one.");
      }
    }, SESSION_WAIT_MS);

    return () => {
      disposed = true;
      listener.subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, [audienceHint]);

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
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-blue-50 via-white to-green-50">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-lg shadow-md border border-gray-100 p-6">
          <h1 className="text-lg font-semibold text-gray-900 mb-4">Choose a new password</h1>

          {stage === "checking" && (
            <div className="flex items-center gap-3 text-sm text-gray-600" role="status">
              <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
              Checking your reset link…
            </div>
          )}

          {stage === "invalid" && (
            <div className="space-y-4">
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg" role="alert">
                <p className="text-sm text-red-800">{invalidReason}</p>
              </div>
              <Link
                to={forgotPath}
                className="block w-full h-11 leading-[2.75rem] text-center bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
              >
                Request a new link
              </Link>
              <Link to={loginPath} className="block text-center text-sm text-blue-600 underline">
                Back to sign in
              </Link>
            </div>
          )}

          {stage === "ready" && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="new-password" className="text-sm font-medium text-gray-900">
                  New password
                </label>
                <input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={MIN_PASSWORD_LENGTH}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-12 px-4 text-base bg-white rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                  disabled={saving}
                />
                <span className="text-xs text-gray-500">
                  At least {MIN_PASSWORD_LENGTH} characters.
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="confirm-password" className="text-sm font-medium text-gray-900">
                  Confirm new password
                </label>
                <input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="h-12 px-4 text-base bg-white rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                  disabled={saving}
                />
              </div>
              {error && (
                <p className="text-sm text-red-600" role="alert">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={saving}
                className="w-full h-12 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save new password"}
              </button>
            </form>
          )}

          {stage === "done" && (
            <div className="space-y-4" role="status">
              <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-sm text-green-800 font-medium mb-1">Password updated</p>
                <p className="text-sm text-green-700">
                  You've been signed out on all devices. Sign in again with your new
                  password.
                </p>
              </div>
              <Link
                to={loginPath}
                className="block w-full h-11 leading-[2.75rem] text-center bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
              >
                Go to sign in
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
