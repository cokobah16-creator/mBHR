import React, { useState, useEffect, startTransition } from "react";
import { useNavigate, Link } from "react-router-dom";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import {
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  SignalSlashIcon,
} from "@heroicons/react/20/solid";
import { useAuthStore } from "@/stores/auth";
import { useSyncStore } from "@/stores/syncStore";
import { isOnlineSyncEnabled } from "@/sync/adapter";
import { needsFirstRunSetup } from "@/db/firstRun";
import { setDevicePin } from "@/db/devicePin";
import type { User } from "@/db";
import { LegalLinks } from "@/pages/legal/LegalLinks";

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

const onlyDigits = (value: string) => value.replace(/\D/g, "").slice(0, 6);

export default function Login() {
  const [mode, setMode] = useState<"offline" | "online">("offline");
  const [pin, setPin] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<LoginError | null>(null);
  const [loading, setLoading] = useState(false);
  // null while the local user count is being read.
  const [deviceHasAccount, setDeviceHasAccount] = useState<boolean | null>(
    null,
  );
  // Set once an online sign-in put a person on this device without a PIN:
  // the page then offers to choose one before going to the dashboard.
  const [pinSetupFor, setPinSetupFor] = useState<User | null>(null);

  const onlineAvailable = isOnlineSyncEnabled();
  const deviceOnline = useSyncStore((s) => s.isOnline);
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const loginOnline = useAuthStore((s) => s.loginOnline);
  const setCurrentUser = useAuthStore((s) => s.setCurrentUser);
  const failedAttempts = useAuthStore((s) => s.failedAttempts);

  // A freshly installed device holds no staff account, so no PIN could ever
  // work here. It still gets this page rather than being sent straight to
  // first-run setup: someone who already has an account signs in online (the
  // sign-in adds them to this device), and only a brand-new outreach needs
  // to set the device up with its first administrator. main.tsx finishes
  // seeding before React mounts, so the count is final rather than racing
  // the seed.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let hasAccount = true;
      try {
        hasAccount = !(await needsFirstRunSetup());
      } catch (error) {
        // Fall through to the PIN form: a PIN that works is better than a
        // dead end if the count could not be read.
        console.error(
          "[login] could not check for a staff account:",
          error instanceof Error ? error.name : error,
        );
      }
      if (cancelled) return;
      if (!hasAccount && onlineAvailable) setMode("online");
      setDeviceHasAccount(hasAccount);
    })();
    return () => {
      cancelled = true;
    };
  }, [onlineAvailable]);

  const switchMode = (next: "offline" | "online") => {
    setMode(next);
    setErr(null);
  };

  const finishSignIn = () => {
    startTransition(() => {
      navigate("/dashboard");
    });
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
          finishSignIn();
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
          const user = useAuthStore.getState().currentUser;
          // Signed in on a device that has no PIN for this person yet:
          // offer one so the next sign-in here works without internet.
          if (user && !user.pinHash) {
            setPinSetupFor(user);
          } else {
            finishSignIn();
          }
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

  // Held until the user count is known so the page never flashes a PIN form
  // on a device where no PIN can work.
  if (deviceHasAccount === null) {
    return (
      <div
        className="min-h-screen flex items-center justify-center bg-canvas p-4"
        role="status"
      >
        <p className="text-body text-ink-muted">Checking this device…</p>
      </div>
    );
  }

  if (pinSetupFor) {
    return (
      <LoginShell subtitle="Staff sign-in">
        <DevicePinSetup
          user={pinSetupFor}
          onDone={(updated) => {
            if (updated) setCurrentUser(updated);
            finishSignIn();
          }}
        />
      </LoginShell>
    );
  }

  const freshDevice = !deviceHasAccount;
  // With no account on the device and no online sign-in in this build, the
  // only way in is first-run setup, so the form would be a dead end.
  const showForm = !freshDevice || onlineAvailable;

  const modeButton = (active: boolean) =>
    `min-h-touch-target rounded-md px-3 text-label transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:text-ink-disabled ${
      active
        ? "bg-surface text-ink border border-line-strong shadow-sm"
        : "text-ink-secondary hover:bg-surface-hover hover:text-ink"
    }`;

  return (
    <LoginShell subtitle="Staff sign-in">
      <div className="panel">
        <div className="panel-header flex-col items-start gap-0.5">
          <h2 className="panel-title">Staff Sign In</h2>
          <p className="text-caption text-ink-muted">
            Healthcare personnel only.
          </p>
        </div>

        <div className="panel-body space-y-4">
          {freshDevice && (
            <div className="banner banner-info" role="status">
              <InformationCircleIcon
                className="h-5 w-5 shrink-0 mt-0.5"
                aria-hidden
              />
              <div>
                <p className="font-medium">
                  No staff account is stored on this device yet.
                </p>
                <p className="text-caption mt-0.5">
                  {onlineAvailable
                    ? "Already have a staff account? Sign in online with your email and password to add yourself to this device. New outreach? Set up this device with its first administrator instead."
                    : "Online sign-in is not set up in this build, so set up this device with its first administrator. They can then add everyone else under Users."}
                </p>
              </div>
            </div>
          )}

          {showForm && (
            <>
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
                    disabled={freshDevice}
                    aria-describedby={
                      freshDevice ? "login-pin-unavailable" : undefined
                    }
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
                {freshDevice && (
                  <p id="login-pin-unavailable" className="field-hint">
                    No PIN exists on this device yet. You can choose one after
                    signing in online.
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
                    connection.{" "}
                    {freshDevice
                      ? "Try again when you are connected, or set up this device below."
                      : "Use your offline PIN, or try again when you are connected."}
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
                      onChange={(e) => setPin(onlyDigits(e.target.value))}
                      className="input-field h-12 text-base tabular-nums"
                      placeholder="Enter your 6-digit PIN"
                      required
                    />
                    <p id="login-pin-hint" className="field-hint">
                      Forgot your PIN? Ask an administrator to set a new one
                      under Users.
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
            </>
          )}

          {freshDevice && (
            <div
              className={
                showForm ? "border-t border-line pt-4 space-y-2" : "space-y-2"
              }
            >
              {showForm && (
                <p className="text-caption text-ink-muted">
                  Setting up a new outreach on this device?
                </p>
              )}
              <Link
                to="/setup"
                className={`${
                  showForm ? "btn-secondary" : "btn-primary"
                } w-full h-12 inline-flex items-center justify-center`}
              >
                Set up this device
              </Link>
              <p className="text-caption text-ink-muted">
                Creates the first administrator, who then adds the rest of the
                staff under Users.
              </p>
            </div>
          )}
        </div>
      </div>
    </LoginShell>
  );
}

function LoginShell({
  subtitle,
  children,
}: {
  subtitle: string;
  children: React.ReactNode;
}) {
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
          <p className="text-body text-ink-muted mt-1">{subtitle}</p>
        </div>

        {children}

        <LegalLinks className="mt-6" />
      </div>
    </div>
  );
}

/**
 * Offered once an online sign-in has added someone to this device: a PIN
 * makes the next sign-in here work without internet. Skipping keeps the
 * online sign-in; an administrator can set a PIN later under Users.
 */
function DevicePinSetup({
  user,
  onDone,
}: {
  user: User;
  onDone: (updated: User | null) => void;
}) {
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    try {
      const updated = await setDevicePin({ userId: user.id, pin, confirmPin });
      onDone(updated);
    } catch (ex) {
      console.error(
        "[login] could not save the device PIN:",
        ex instanceof Error ? ex.name : ex,
      );
      setErr(
        ex instanceof Error && ex.message
          ? ex.message
          : "The PIN was not saved. Try again.",
      );
      setSaving(false);
    }
  };

  return (
    <div className="panel">
      <div className="panel-header flex-col items-start gap-0.5">
        <h2 className="panel-title">Choose a PIN for this device</h2>
        <p className="text-caption text-ink-muted">
          You are signed in as {user.fullName}. A PIN lets you sign in on this
          device without internet next time.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="panel-body space-y-4">
        <div>
          <label className="field-label" htmlFor="device-pin">
            Choose a 6-digit PIN
          </label>
          <input
            id="device-pin"
            aria-label="New PIN"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            pattern="\d{6}"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(onlyDigits(e.target.value))}
            className="input-field h-12 text-base tabular-nums"
            placeholder="Enter a 6-digit PIN"
            required
          />
        </div>

        <div>
          <label className="field-label" htmlFor="device-confirm-pin">
            Confirm PIN
          </label>
          <input
            id="device-confirm-pin"
            aria-label="Confirm PIN"
            aria-describedby="device-pin-note"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            pattern="\d{6}"
            maxLength={6}
            value={confirmPin}
            onChange={(e) => setConfirmPin(onlyDigits(e.target.value))}
            className="input-field h-12 text-base tabular-nums"
            placeholder="Re-enter the PIN"
            required
          />
          <p id="device-pin-note" className="field-hint">
            This PIN is stored only on this device and cannot be recovered.
            Write it down somewhere safe.
          </p>
        </div>

        {err && (
          <div className="banner banner-danger" role="alert">
            <ExclamationCircleIcon
              className="h-5 w-5 shrink-0 mt-0.5"
              aria-hidden
            />
            <p>{err}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={saving}
          className="btn-primary w-full h-12"
        >
          {saving ? "Saving PIN…" : "Save PIN and continue"}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => onDone(null)}
          className="btn-ghost w-full h-12"
        >
          Skip for now
        </button>
      </form>
    </div>
  );
}
