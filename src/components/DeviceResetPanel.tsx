import React, { useState } from "react";
import { useAuthStore } from "@/stores/auth";
import { findAdminByPin, wipeDevice } from "@/db/deviceReset";

interface DeviceResetPanelProps {
  /** Shown as a Cancel button when the panel can be dismissed. */
  onCancel?: () => void;
}

/**
 * Erases this device's local data once an administrator enters their PIN.
 *
 * Used from admin settings and from the login page's recovery link. Either
 * way the admin PIN is asked for afresh — being signed in is not enough —
 * and wrong PINs count towards the same lockout as the sign-in form, so this
 * cannot be used to guess PINs faster than signing in.
 */
export function DeviceResetPanel({ onCancel }: DeviceResetPanelProps) {
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
      console.error("Failed to reset local data:", error);
      setErr("Failed to reset local data. Check console for details.");
    } finally {
      setPin("");
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-3"
    >
      <div>
        <h3 className="text-sm font-semibold text-red-800">
          Reset this device
        </h3>
        <p className="text-xs text-red-700 mt-1">
          Deletes every patient, visit and staff account stored on this device,
          including anything not yet synced. An administrator must approve with
          their PIN.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="device-reset-pin"
          className="text-sm font-medium text-gray-900"
        >
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
          className="h-11 px-3 text-base bg-white rounded-lg border border-gray-300 outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
          placeholder="6-digit admin PIN"
          required
        />
      </div>

      {err && <div className="text-sm text-red-700">{err}</div>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy || pin.length !== 6}
          className="flex-1 h-10 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50"
        >
          {busy ? "Checking…" : "Erase device data"}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="h-10 px-4 rounded-lg border border-gray-300 bg-white text-sm text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
