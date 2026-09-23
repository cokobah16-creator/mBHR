import React, { useState, useEffect, startTransition } from "react";
import { useNavigate, Link } from "react-router-dom";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import {
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
  SignalSlashIcon,
} from "@heroicons/react/20/solid";
import { useAuthStore } from "@/stores/auth";
import { useSyncStore } from "@/stores/syncStore";
import { isOnlineSyncEnabled } from "@/sync/adapter";
import { needsFirstRunSetup } from "@/db/firstRun";

/** Mirrors MAX_FAILED_ATTEMPTS in stores/auth.ts; used for display only. */
const MAX_ATTEMPTS = 5;

interface LoginError {
  title: string;
  detail?: string;
}

function lockoutError(until: number): LoginError {
  const minutes = Math.max(1, Math.ceil((until - Date.now()) / 60_000));
  return {
    title: "Too many incorrect attempts",
    detail: `Sign-in is paused on this device for ${minutes} minute${
      minutes === 1 ? "" : "s"
    }. Try again after that, or ask an administrator for help.`,
  };
}

/** The store records a lockout when a failed attempt reaches the limit. */
function activeLockout(): number | null {
  const until = useAuthStore.getState().lockoutUntil;
  return until && until > Date.now() ? until : null;
}

export default function Login() {
  const [mode, setMode] = useState<"offline" | "online">("offline");
  const [pin, setPin] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<LoginError | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkingSetup, setCheckingSetup] = useState(true);

  const onlineAvailable = isOnlineSyncEnabled();
  const deviceOnline = useSyncStore((s) => s.isOnline);
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const loginOnline = useAuthStore((s) => s.loginOnline);
  const failedAttempts = useAuthStore((s) => s.failedAttempts);

  // Production builds ship no demo staff, so a freshly installed device has no
  // PIN that could ever work here — first-run setup is the only way in.
  // main.tsx finishes seeding before React mounts, so this count is final
  // rather than racing the seed.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const needed = await needsFirstRunSetup();
        if (cancelled) return;
        if (needed) {
          navigate("/setup", { replace: true });
          return;
        }
      } catch (error) {
        // Fall through to the form: a PIN that works is better than a dead
        // end if the count could not be read.
        console.error(
          "[login] could not check for first-run setup:",
          error instanceof Error ? error.name : error,
        );
      }
      if (!cancelled) setCheckingSetup(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const switchMode = (next: "offline" | "online") => {
    setMode(next);
    setErr(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    setErr(null);

    if (mode === "online") {
      if (!onlineAvailable) {
        setErr({
          title: "Online sign-in is not set up on this device",
          detail: "Use your offline PIN instead.",
        });
        return;
      }
      if (!deviceOnline) {
        setErr({
          title: "This device is offline",
          detail:
            "Online sign-in needs an internet connection. Use your offline PIN, or try again when you are connected.",
        });
        return;
      }
    }

    setLoading(true);

    try {
      if (mode === "offline") {
        const success = await login(pin);

        if (success) {
          startTransition(() => {
            navigate("/dashboard");
          });
        } else {
          const until = activeLockout();
          setErr(
            until
              ? lockoutError(until)
              : {
                  title: "Invalid PIN",
                  detail: "Check the 6 digits and try again.",
                },
          );
        }
      } else {
        const success = await loginOnline(email, password);
        if (success) {
          startTransition(() => navigate("/dashboard"));
        } else {
          const until = activeLockout();
          setErr(
            until
              ? lockoutError(until)
              : {
                  title: "Invalid email or password",
                  detail:
                    "Check both and try again. If you have forgotten your password, reset it below.",
                },
          );
        }
      }
    } catch (ex) {
      console.error("[login] error:", ex instanceof Error ? ex.name : ex);
      setErr({
        title: "Sign-in could not be completed",
        detail: "Try again. If it keeps happening, reload the page.",
      });
    } finally {
      setLoading(false);
    }
  };

  // Held until the user count is known so a device that needs first-run setup
  // never flashes a PIN form no PIN can satisfy.
  if (checkingSetup) {
    return (
      <div
        className="min-h-screen flex items-center justify-center bg-canvas p-4"
        role="status"
      >
        <p className="text-body text-ink-muted">Checking this device…</p>
      </div>
    );
  }

  const modeButton = (active: boolean) =>
    `min-h-touch-target rounded-md px-3 text-label transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:text-ink-disabled ${
      active
        ? "bg-surface text-ink border border-line-strong shadow-sm"
        : "text-ink-secondary hover:bg-surface-hover hover:text-ink"
    }`;

  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas px-4 py-8 sm:p-6">
      <div className="w-full max-w-md">
        <Link
          to="/"
          className="mx-auto mb-4 flex min-h-touch-target w-fit items-center gap-1.5 rounded-md px-2 text-label text-ink-muted hover:text-ink hover:underline"
        >
          <ArrowLeftIcon className="h-4 w-4" aria-hidden />
          Back to home
        </Link>

        <div className="text-center mb-6">
          <img
            src="/brand/mbhr-mark.svg"
            alt=""
            aria-hidden
            className="inline-block w-14 h-14 rounded-lg mb-4"
          />
          <h1 className="text-h1 text-ink">MedBridge Health Reach</h1>
          <p className="text-body text-ink-muted mt-1">Staff sign-in</p>
        </div>

        <div className="panel">
          <div className="panel-header flex-col items-start gap-0.5">
            <h2 className="panel-title">Staff Sign In</h2>
            <p className="text-caption text-ink-muted">
              Healthcare personnel only.
            </p>
          </div>

          <div className="panel-body space-y-4">
            <div>
              <div
                role="group"
                aria-label="Sign-in method"
                className="grid grid-cols-2 gap-1 rounded-md border border-line bg-surface-sunken p-1"
              >
                <button
                  type="button"
                  aria-pressed={mode === "offline"}
                  className={modeButton(mode === "offline")}
                  onClick={() => switchMode("offline")}
                >
                  Offline PIN
                </button>
                <button
                  type="button"
                  aria-pressed={mode === "online"}
                  className={modeButton(mode === "online")}
                  onClick={() => switchMode("online")}
                  disabled={!onlineAvailable}
                  aria-describedby={
                    onlineAvailable ? undefined : "login-online-unavailable"
                  }
                >
                  Online
                </button>
              </div>
              {!onlineAvailable && (
                <p id="login-online-unavailable" className="field-hint">
                  Online sign-in is not set up on this device.
                </p>
              )}
            </div>

            {mode === "online" && !deviceOnline && (
              <div className="banner banner-warning" role="status">
                <SignalSlashIcon
                  className="h-5 w-5 shrink-0 mt-0.5"
                  aria-hidden
                />
                <p>
                  This device is offline. Online sign-in needs an internet
                  connection. Use your offline PIN, or try again when you are
                  connected.
                </p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === "offline" && (
                <div>
                  <label htmlFor="login-pin" className="field-label">
                    PIN
                  </label>
                  <input
                    id="login-pin"
                    aria-label="PIN"
                    aria-describedby="login-pin-hint"
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    pattern="\d{6}"
                    maxLength={6}
                    value={pin}
                    onChange={(e) => {
                      const newPin = e.target.value
                        .replace(/\D/g, "")
                        .slice(0, 6);
                      setPin(newPin);
                    }}
                    className="input-field h-12 text-base tabular-nums"
                    placeholder="Enter your 6-digit PIN"
                    required
                  />
                  <p id="login-pin-hint" className="field-hint">
                    Forgot your PIN? Ask an administrator to set a new one under
                    Users.
                  </p>
                </div>
              )}

              {mode === "online" && (
                <>
                  <div>
                    <label htmlFor="login-email" className="field-label">
                      Email
                    </label>
                    <input
                      id="login-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="input-field h-12 text-base"
                      placeholder="staff@example.com"
                      required
                      autoComplete="email"
                    />
                  </div>
                  <div>
                    <label htmlFor="login-password" className="field-label">
                      Password
                    </label>
                    <input
                      id="login-password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="input-field h-12 text-base"
                      placeholder="Your password"
                      required
                      autoComplete="current-password"
                    />
                    <div className="mt-1 flex justify-end">
                      <Link
                        to="/forgot-password"
                        className="inline-flex min-h-touch-target items-center rounded-md px-1 text-label text-primary hover:text-primary-hover underline"
                      >
                        Forgot password?
                      </Link>
                    </div>
                  </div>
                </>
              )}

              <div className="space-y-2">
                {err && (
                  <div className="banner banner-danger" role="alert">
                    <ExclamationCircleIcon
                      className="h-5 w-5 shrink-0 mt-0.5"
                      aria-hidden
                    />
                    <div>
                      <p className="font-medium">{err.title}</p>
                      {err.detail && (
                        <p className="text-caption mt-0.5">{err.detail}</p>
                      )}
                    </div>
                  </div>
                )}

                {failedAttempts > 0 && (
                  <p className="flex items-center gap-1.5 text-caption text-warning-fg">
                    <ExclamationTriangleIcon
                      className="h-4 w-4 shrink-0"
                      aria-hidden
                    />
                    Failed attempts: {failedAttempts}/{MAX_ATTEMPTS}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full h-12"
              >
                {loading ? "Signing in…" : "Sign In"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
