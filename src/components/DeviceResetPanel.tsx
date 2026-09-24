import React, { useState } from "react";
import {
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/20/solid";
import { useAuthStore } from "@/stores/auth";
import { findAdminByPin, wipeDevice } from "@/db/deviceReset";

/**
 * Erases this device's local data once an administrator enters their PIN.
 *
 * Only shown on the admin Settings page. The admin PIN is asked for afresh —
 * being signed in is not enough — and wrong PINs count towards the same
 * lockout as the sign-in form, so this cannot be used to guess PINs faster
 * than signing in.
 */
export function DeviceResetPanel() {
  const { checkLockout, incrementFailedAttempts } = useAuthStore();
  const [pin, setPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);

    if (checkLockout()) {
      setErr("Too many incorrect PINs. Try again in 15 minutes.");
      return;
    }

    setBusy(true);
    try {
      const admin = await findAdminByPin(pin);
      if (!admin) {
        incrementFailedAttempts();
        setErr("That is not an administrator PIN.");
        return;
      }

      const confirmed = window.confirm(
        "This deletes every patient, visit and staff account stored on this device. " +
          "Anything not yet synced is lost, and the device will need to be set up again. Continue?",
      );
      if (!confirmed) return;

      await wipeDevice();
      alert(
        "Local data cleared. The app will now reload and ask you to set up this device again.",
      );
      window.location.replace("/login");
    } catch (error) {
      console.error(
        "Failed to reset local data:",
        error instanceof Error ? error.name : error,
      );
      setErr(
        "Could not erase the data on this device. Reload the page and try again.",
      );
    } finally {
      setPin("");
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-danger-line bg-surface p-4 space-y-3"
      aria-labelledby="device-reset-title"
    >
      <div className="flex items-start gap-2">
        <ExclamationTriangleIcon
          className="h-5 w-5 shrink-0 text-danger mt-0.5"
          aria-hidden
        />
        <div>
          <h3 id="device-reset-title" className="text-h3 text-danger-fg">
            Reset this device
          </h3>
          <p className="text-caption text-ink-secondary mt-1">
            Deletes every patient, visit and staff account stored on this
            device, including anything not yet synced. An administrator must
            approve with their PIN.
          </p>
        </div>
      </div>

      <div>
        <label htmlFor="device-reset-pin" className="field-label">
          Administrator PIN
        </label>
        <input
          id="device-reset-pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          pattern="\d{6}"
          maxLength={6}
          value={pin}
          onChange={(e) =>
            setPin(e.target.value.replace(/\D/g, "").slice(0, 6))
          }
          className="input-field text-base tabular-nums sm:max-w-xs"
          placeholder="6-digit admin PIN"
          aria-invalid={err ? true : undefined}
          aria-describedby={err ? "device-reset-error" : undefined}
          required
        />
      </div>

      {err && (
        <p
          id="device-reset-error"
          className="flex items-start gap-1.5 text-body text-danger-fg"
          role="alert"
        >
          <ExclamationCircleIcon
            className="h-5 w-5 shrink-0 mt-0.5"
            aria-hidden
          />
          {err}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || pin.length !== 6}
        className="btn-danger w-full sm:w-auto"
      >
        {busy ? "Checking…" : "Erase device data"}
      </button>
    </form>
  );
}
