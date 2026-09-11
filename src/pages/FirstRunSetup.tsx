import React, { useEffect, useState, startTransition } from "react";
import { useNavigate } from "react-router-dom";
import { createFirstAdmin, needsFirstRunSetup } from "@/db/firstRun";
import { useAuthStore } from "@/stores/auth";
import * as logger from "@/lib/logger";

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
        logger.error("[setup] could not read the local user count", e);
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
      logger.error("[setup] first admin creation failed", ex);
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
      logger.error("[setup] sign-in after setup failed", ex);
    }

    startTransition(() => {
      navigate(signedIn ? "/dashboard" : "/login", { replace: true });
    });
  };

  const onlyDigits = (value: string) => value.replace(/\D/g, "").slice(0, 6);

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 via-white to-blue-50">
        <p className="text-gray-600">Checking this device…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-green-50 via-white to-blue-50">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <img
            src="/brand/mbhr-mark.svg"
            alt=""
            aria-hidden
            className="inline-block w-16 h-16 rounded-2xl mb-4"
          />
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
            MedBridge Health Reach
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            Bridging Care, Reaching All.
          </p>
        </div>

        <div className="bg-white rounded-lg shadow-md border border-gray-100 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">
            Set up this device
          </h2>
          <p className="text-sm text-gray-500 mb-5">
            No staff account exists on this device yet. Create the administrator
            who will add everyone else.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex flex-col gap-1.5">
              <label
                className="text-sm font-medium text-gray-900"
                htmlFor="setup-full-name"
              >
                Full name
              </label>
              <input
                id="setup-full-name"
                aria-label="Full name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="h-12 px-4 text-base bg-white rounded-lg border border-gray-300 outline-none transition focus:ring-2 focus:ring-primary focus:border-transparent"
                placeholder="e.g. Amina Bello"
                autoComplete="name"
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label
                className="text-sm font-medium text-gray-900"
                htmlFor="setup-pin"
              >
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
                className="h-12 px-4 text-base bg-white rounded-lg border border-gray-300 outline-none transition focus:ring-2 focus:ring-primary focus:border-transparent"
                placeholder="Enter a 6-digit PIN"
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label
                className="text-sm font-medium text-gray-900"
                htmlFor="setup-confirm-pin"
              >
                Confirm PIN
              </label>
              <input
                id="setup-confirm-pin"
                aria-label="Confirm PIN"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                value={confirmPin}
                onChange={(e) => setConfirmPin(onlyDigits(e.target.value))}
                className="h-12 px-4 text-base bg-white rounded-lg border border-gray-300 outline-none transition focus:ring-2 focus:ring-primary focus:border-transparent"
                placeholder="Re-enter the PIN"
                required
              />
            </div>

            <p className="text-xs text-gray-500">
              This PIN is stored only on this device and cannot be recovered.
              Write it down somewhere safe.
            </p>

            {err && <div className="text-sm text-red-600">{err}</div>}

            <button
              type="submit"
              disabled={saving}
              className="w-full h-12 bg-primary text-white font-medium rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-primary"
            >
              {saving ? "Creating account…" : "Create administrator"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
