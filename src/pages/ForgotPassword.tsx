import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { isSupabaseEnabled } from "@/lib/supabaseClient";
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

  const accent = isStaff
    ? "bg-primary hover:bg-primary/90 focus:ring-primary"
    : "bg-blue-600 hover:bg-blue-700 focus:ring-blue-500";

  return (
    <div
      className={`min-h-screen flex items-center justify-center p-6 bg-gradient-to-br ${
        isStaff ? "from-green-50 via-white to-blue-50" : "from-blue-50 to-blue-100"
      }`}
    >
      <div className="w-full max-w-md">
        <div className="bg-white rounded-lg shadow-md border border-gray-100 p-6">
          <h1 className="text-lg font-semibold text-gray-900 mb-1">
            {isStaff ? "Reset staff password" : "Reset your password"}
          </h1>

          {!isSupabaseEnabled ? (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                {isStaff
                  ? "This device is running offline, so there is no online password to reset. If you have forgotten your PIN, ask an administrator to set a new one for you under Users."
                  : "This device is running offline. If you have forgotten your PIN, ask clinic staff to help you reset it."}
              </p>
              <Link to={loginPath} className="block text-center text-sm text-blue-600 underline">
                Back to sign in
              </Link>
            </div>
          ) : sent ? (
            <div className="space-y-4" role="status">
              <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-sm text-green-800 font-medium mb-1">Check your email</p>
                <p className="text-sm text-green-700">
                  If an account exists for <strong>{email.trim()}</strong>, we've sent a
                  link to reset the password. The link works once and expires after an
                  hour. Check your spam folder if it doesn't arrive.
                </p>
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button
                type="button"
                onClick={() => void send()}
                disabled={busy || wait > 0}
                className="w-full h-11 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {wait > 0 ? `Send again in ${wait}s` : busy ? "Sending…" : "Send the link again"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setSent(false);
                  setError(null);
                }}
                className="block w-full text-center text-sm text-gray-600 underline"
              >
                Use a different email
              </button>
              <Link to={loginPath} className="block text-center text-sm text-blue-600 underline">
                Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="text-sm text-gray-500">
                Enter the email address you sign in with and we'll send you a link to
                choose a new password.
              </p>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="reset-email" className="text-sm font-medium text-gray-900">
                  Email
                </label>
                <input
                  id="reset-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-12 px-4 text-base bg-white rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder={isStaff ? "staff@example.com" : "your.email@example.com"}
                  required
                  disabled={busy}
                />
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button
                type="submit"
                disabled={busy || wait > 0}
                className={`w-full h-12 text-white font-medium rounded-lg transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-offset-1 ${accent}`}
              >
                {busy ? "Sending…" : wait > 0 ? `Try again in ${wait}s` : "Email me a reset link"}
              </button>
              {isStaff && (
                <p className="text-xs text-gray-500">
                  This resets the password for online sign-in. Offline PINs are reset by
                  an administrator under Users.
                </p>
              )}
              <Link to={loginPath} className="block text-center text-sm text-blue-600 underline">
                Back to sign in
              </Link>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
