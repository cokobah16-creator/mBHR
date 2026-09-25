import React, { useEffect, useState, startTransition } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ExclamationCircleIcon } from "@heroicons/react/20/solid";
import {
  FIRST_ADMIN_EXISTS_MESSAGE,
  createFirstAdmin,
  needsFirstRunSetup,
} from "@/db/firstRun";
import { useAuthStore } from "@/stores/auth";
import * as logger from "@/lib/logger";
import { LegalLinks } from "@/pages/legal/LegalLinks";

/**
 * First-run setup: creates the administrator account on a device that has none.
 *
 * Production builds ship without demo staff, so this is the only way to get a
 * usable PIN onto a freshly installed device. It refuses to run once any user
 * exists, which keeps it from being a way to mint an admin on a provisioned
 * device.
 */
export default function FirstRunSetup() {
  const [checking, setChecking] = useState(true);
  const [fullName, setFullName] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const needed = await needsFirstRunSetup();
        if (cancelled) return;
        if (!needed) {
          navigate("/login", { replace: true });
          return;
        }
        setChecking(false);
      } catch (e) {
        if (cancelled) return;
        logger.error(
          "[setup] could not read the local user count",
          e instanceof Error ? e.name : e,
        );
        setErr("Could not read the local database. Reload and try again.");
        setChecking(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setSaving(true);

    try {
      await createFirstAdmin({ fullName, pin, confirmPin });
    } catch (ex) {
      logger.error(
        "[setup] first admin creation failed",
        ex instanceof Error ? ex.name : ex,
      );
      setErr(ex?.message || "Could not create the administrator account");
      setSaving(false);
      return;
    }

    // The account exists from here on, so never leave the user stranded on a
    // setup screen that will now refuse to run. Sign them in if we can, and
    // fall back to the login form with the PIN they just chose.
    let signedIn = false;
    try {
      signedIn = await login(pin);
    } catch (ex) {
      logger.error(
        "[setup] sign-in after setup failed",
        ex instanceof Error ? ex.name : ex,
      );
    }

    startTransition(() => {
      navigate(signedIn ? "/dashboard" : "/login", { replace: true });
    });
  };

  const onlyDigits = (value: string) => value.replace(/\D/g, "").slice(0, 6);

  if (checking) {
    return (
      <div
        className="min-h-screen flex items-center justify-center bg-canvas p-4"
        role="status"
      >
        <p className="text-body text-ink-muted">Checking this device…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas px-4 py-8 sm:p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <img
            src="/brand/mbhr-mark.svg"
            alt=""
            aria-hidden
            className="inline-block w-14 h-14 rounded-lg mb-4"
          />
          <h1 className="text-h1 text-ink">MedBridge Health Reach</h1>
          <p className="text-body text-ink-muted mt-1">
            Bridging Care, Reaching All.
          </p>
        </div>

        <div className="panel">
          <div className="panel-header flex-col items-start gap-0.5">
            <h2 className="panel-title">Set up this device</h2>
            <p className="text-caption text-ink-muted">
              No staff account exists on this device yet. Create the
              administrator who will add everyone else.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="panel-body space-y-4">
            <div>
              <label className="field-label" htmlFor="setup-full-name">
                Full name
              </label>
              <input
                id="setup-full-name"
                aria-label="Full name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="input-field h-12 text-base"
                placeholder="e.g. Amina Bello"
                autoComplete="name"
                required
              />
            </div>

            <div>
              <label className="field-label" htmlFor="setup-pin">
                Choose a 6-digit PIN
              </label>
              <input
                id="setup-pin"
                aria-label="PIN"
                inputMode="numeric"
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
              <label className="field-label" htmlFor="setup-confirm-pin">
                Confirm PIN
              </label>
              <input
                id="setup-confirm-pin"
                aria-label="Confirm PIN"
                aria-describedby="setup-pin-note"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                value={confirmPin}
                onChange={(e) => setConfirmPin(onlyDigits(e.target.value))}
                className="input-field h-12 text-base tabular-nums"
                placeholder="Re-enter the PIN"
                required
              />
              <p id="setup-pin-note" className="field-hint">
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
                <div>
                  <p>{err}</p>
                  {err === FIRST_ADMIN_EXISTS_MESSAGE && (
                    <Link
                      to="/login"
                      replace
                      className="mt-1 inline-flex min-h-touch-target items-center font-medium underline"
                    >
                      Go to sign in
                    </Link>
                  )}
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={saving}
              className="btn-primary w-full h-12"
            >
              {saving ? "Creating account…" : "Create administrator"}
            </button>

            <div className="border-t border-line pt-4 space-y-2">
              <p className="text-caption text-ink-muted">
                Already have a staff account? Sign in online with your email and
                password to add yourself to this device.
              </p>
              <Link
                to="/login"
                className="btn-secondary w-full h-12 inline-flex items-center justify-center"
              >
                Sign in instead
              </Link>
            </div>
          </form>
        </div>

        <LegalLinks className="mt-6" />
      </div>
    </div>
  );
}
