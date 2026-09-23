import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  CheckCircleIcon,
  ExclamationCircleIcon,
  InformationCircleIcon,
  SignalSlashIcon,
} from "@heroicons/react/20/solid";
import { isSupabaseEnabled } from "@/lib/supabaseClient";
import { useSyncStore } from "@/stores/syncStore";
import {
  RESEND_COOLDOWN_SECONDS,
  loginPathFor,
  requestPasswordReset,
  type ResetAudience,
} from "@/services/passwordReset";

/**
 * "Forgot password" request screen, shared by staff (/forgot-password) and the
 * patient portal (/patient/forgot-password).
 *
 * The confirmation is the same whether or not the address has an account, so
 * the page cannot be used to find out who is registered.
 */
export default function ForgotPassword({ audience }: { audience: ResetAudience }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const deviceOnline = useSyncStore((s) => s.isOnline);

  const wait = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));
  const loginPath = loginPathFor(audience);
  const isStaff = audience === "staff";

  useEffect(() => {
    if (!cooldownUntil) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [cooldownUntil]);

  const send = async () => {
    if (busy || wait > 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await requestPasswordReset(email, audience);
      if (result.ok) {
        setSent(true);
        setNow(Date.now());
        setCooldownUntil(Date.now() + RESEND_COOLDOWN_SECONDS * 1000);
      } else {
        setError(result.message);
        if (result.reason === "rate_limited") {
          setNow(Date.now());
          setCooldownUntil(Date.now() + RESEND_COOLDOWN_SECONDS * 1000);
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void send();
  };

  const backLink = (
    <Link
      to={loginPath}
      className="mx-auto flex min-h-touch-target w-fit items-center rounded-md px-2 text-label text-primary hover:text-primary-hover underline"
    >
      Back to sign in
    </Link>
  );

  const errorBanner = error && (
    <div className="banner banner-danger" role="alert">
      <ExclamationCircleIcon className="h-5 w-5 shrink-0 mt-0.5" aria-hidden />
      <p>{error}</p>
    </div>
  );

  const offlineBanner = !deviceOnline && (
    <div className="banner banner-warning" role="status">
      <SignalSlashIcon className="h-5 w-5 shrink-0 mt-0.5" aria-hidden />
      <p>
        This device is offline. A reset link can only be requested with an
        internet connection.
      </p>
    </div>
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas px-4 py-8 sm:p-6">
      <div className="w-full max-w-md">
        <div className="panel p-6">
          <h1 className="text-h2 text-ink mb-1">
            {isStaff ? "Reset staff password" : "Reset your password"}
          </h1>

          {!isSupabaseEnabled ? (
            <div className="space-y-4 mt-3">
              <div className="banner banner-info">
                <InformationCircleIcon
                  className="h-5 w-5 shrink-0 mt-0.5"
                  aria-hidden
                />
                <p>
                  {isStaff
                    ? "This device is running offline, so there is no online password to reset. If you have forgotten your PIN, ask an administrator to set a new one for you under Users."
                    : "This device is running offline. If you have forgotten your PIN, ask clinic staff to help you reset it."}
                </p>
              </div>
              {backLink}
            </div>
          ) : sent ? (
            <div className="space-y-4 mt-3" role="status">
              <div className="banner banner-success">
                <CheckCircleIcon
                  className="h-5 w-5 shrink-0 mt-0.5"
                  aria-hidden
                />
                <div>
                  <p className="font-medium mb-1">Check your email</p>
                  <p className="text-caption">
                    If an account exists for <strong>{email.trim()}</strong>,
                    we've sent a link to reset the password. The link works
                    once and expires after an hour. Check your spam folder if
                    it doesn't arrive.
                  </p>
                </div>
              </div>
              {errorBanner}
              {offlineBanner}
              <button
                type="button"
                onClick={() => void send()}
                disabled={busy || wait > 0}
                className="btn-secondary w-full"
              >
                {wait > 0
                  ? `Send again in ${wait}s`
                  : busy
                    ? "Sending…"
                    : "Send the link again"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setSent(false);
                  setError(null);
                }}
                className="btn-ghost w-full"
              >
                Use a different email
              </button>
              {backLink}
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4 mt-1">
              <p className="text-body text-ink-muted">
                Enter the email address you sign in with and we'll send you a
                link to choose a new password.
              </p>
              {offlineBanner}
              <div>
                <label htmlFor="reset-email" className="field-label">
                  Email
                </label>
                <input
                  id="reset-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input-field h-12 text-base"
                  placeholder={
                    isStaff ? "staff@example.com" : "your.email@example.com"
                  }
                  required
                  disabled={busy}
                />
              </div>
              {errorBanner}
              <button
                type="submit"
                disabled={busy || wait > 0}
                className="btn-primary w-full h-12"
              >
                {busy
                  ? "Sending…"
                  : wait > 0
                    ? `Try again in ${wait}s`
                    : "Email me a reset link"}
              </button>
              {isStaff && (
                <p className="text-caption text-ink-muted">
                  This resets the password for online sign-in. Offline PINs are
                  reset by an administrator under Users.
                </p>
              )}
              {backLink}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
