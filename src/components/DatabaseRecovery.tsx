import React, { useEffect, useState } from "react";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { ArrowPathIcon, ExclamationCircleIcon } from "@heroicons/react/20/solid";
import { useAuthStore } from "@/stores/auth";
import {
  countStoredUnsyncedRecords,
  eraseLocalDatabase,
  storedAdminPinMatches,
} from "@/db/safeOpen";

/**
 * Shown instead of the app when the local database will not open at start-up
 * (src/main.tsx). Nothing is deleted automatically: the stored records,
 * including any not yet synced, stay on the device. The person can try
 * again. After a failed upgrade only, an administrator can erase the device,
 * with their PIN, after being told how many unsynced records that loses.
 */
export function DatabaseRecovery({ upgradeFailed }: { upgradeFailed: boolean }) {
  const [showErase, setShowErase] = useState(false);

  return (
    <main className="min-h-screen flex items-center justify-center bg-canvas px-4 py-8">
      <div
        className="panel w-full max-w-lg p-6"
        role="alert"
        aria-labelledby="db-recovery-title"
      >
        <div className="flex items-start gap-3">
          <ExclamationTriangleIcon
            className="h-6 w-6 shrink-0 text-danger mt-1"
            aria-hidden
          />
          <div className="min-w-0">
            <h1 id="db-recovery-title" className="text-h1 text-ink">
              The records on this device could not be opened
            </h1>
            <p className="mt-2 text-body text-ink-secondary">
              {upgradeFailed
                ? "The app was updated, but the records stored on this device could not be moved to the new version."
                : "The app could not open the records stored on this device."}{" "}
              Nothing has been deleted: the records, including any not yet
              synced, are still on this device.
            </p>
          </div>
        </div>

        <div className="mt-5 rounded-md border border-line bg-surface-sunken p-4">
          <p className="section-label mb-2">What to do next</p>
          <ol className="list-decimal space-y-1 pl-5 text-body text-ink-secondary">
            <li>Close other mBHR tabs on this device, then try again.</li>
            <li>
              If it keeps happening, stop using this device for records and
              tell your site administrator or mBHR support. Do not clear the
              browser's data: that erases records that are not synced.
            </li>
          </ol>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="btn-primary"
          >
            <ArrowPathIcon className="h-5 w-5" aria-hidden />
            Try again
          </button>
        </div>

        {upgradeFailed && (
          <div className="mt-6 border-t border-line pt-4">
            <button
              type="button"
              className="btn-ghost -ml-3 text-label"
              aria-expanded={showErase}
              aria-controls="db-recovery-erase"
              onClick={() => setShowErase((v) => !v)}
            >
              {showErase ? "Hide device reset" : "Administrator: erase this device"}
            </button>
            {showErase && (
              <div id="db-recovery-erase" className="mt-3">
                <EraseStoredRecords />
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

/**
 * Last resort after a failed upgrade: erases the stored records so the app
 * can start again. Needs an administrator's PIN on this device (wrong PINs
 * count towards the sign-in lockout) and an explicit confirmation that names
 * the number of unsynced records lost.
 */
function EraseStoredRecords() {
  const { checkLockout, incrementFailedAttempts } = useAuthStore();
  // undefined while counting; null when the stored records cannot be read.
  const [unsynced, setUnsynced] = useState<number | null | undefined>(undefined);
  const [pin, setPin] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    countStoredUnsyncedRecords().then((n) => {
      if (live) setUnsynced(n);
    });
    return () => {
      live = false;
    };
  }, []);

  const lossWarning =
    unsynced === undefined
      ? "Checking for records that are not synced…"
      : unsynced === null
        ? "The records that are not synced could not be counted. Assume some are not synced: erasing loses them for good."
        : unsynced === 0
          ? "No unsynced records were found, but anything saved only on this device is lost."
          : `${unsynced} record${unsynced === 1 ? " has" : "s have"} not been synced. Erasing loses ${unsynced === 1 ? "it" : "them"} for good.`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (checkLockout()) {
      setErr("Too many incorrect PINs. Try again in 15 minutes.");
      return;
    }
    setBusy(true);
    try {
      const match = await storedAdminPinMatches(pin);
      if (match === null) {
        setErr(
          "The staff list on this device cannot be read, so an administrator PIN cannot be checked here. Contact mBHR support.",
        );
        return;
      }
      if (!match) {
        incrementFailedAttempts();
        setErr("That is not an administrator PIN on this device.");
        return;
      }
      await eraseLocalDatabase();
      window.location.replace("/login");
    } catch (error) {
      console.error(
        "[db] could not erase the local database:",
        error instanceof Error ? error.name : typeof error,
      );
      setErr("The records could not be erased. Close other mBHR tabs and try again.");
    } finally {
      setPin("");
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-danger-line bg-surface p-4 space-y-3"
      aria-labelledby="db-erase-title"
    >
      <div>
        <h2 id="db-erase-title" className="text-h3 text-danger-fg">
          Erase this device and start again
        </h2>
        <p className="text-caption text-ink-secondary mt-1">
          Deletes every patient, visit and staff account stored on this
          device. The device then has to be set up again.
        </p>
        <p className="text-body text-danger-fg mt-2" role="status">
          {lossWarning}
        </p>
      </div>

      <div>
        <label htmlFor="db-erase-pin" className="field-label">
          Administrator PIN
        </label>
        <input
          id="db-erase-pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          pattern="\d{6}"
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
          className="input-field text-base tabular-nums sm:max-w-xs"
          placeholder="6-digit admin PIN"
          aria-invalid={err ? true : undefined}
          aria-describedby={err ? "db-erase-error" : undefined}
          required
        />
      </div>

      <label className="flex items-start gap-2 text-body text-ink">
        <input
          type="checkbox"
          className="mt-1"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        <span>
          I understand that records not yet synced are lost for good.
        </span>
      </label>

      {err && (
        <p
          id="db-erase-error"
          className="flex items-start gap-1.5 text-body text-danger-fg"
          role="alert"
        >
          <ExclamationCircleIcon className="h-5 w-5 shrink-0 mt-0.5" aria-hidden />
          {err}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || pin.length !== 6 || !confirmed || unsynced === undefined}
        className="btn-danger w-full sm:w-auto"
      >
        {busy ? "Checking…" : "Erase device data"}
      </button>
    </form>
  );
}
