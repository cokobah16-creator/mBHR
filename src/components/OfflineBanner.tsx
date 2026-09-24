import React, { useState, useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  SignalSlashIcon,
  ExclamationTriangleIcon,
  XMarkIcon,
} from "@heroicons/react/20/solid";
import { useSyncStore } from "@/stores/syncStore";
import { useOperationsQueue } from "@/stores/operationsQueue";
import { countUnsyncedRecords, isOnlineSyncEnabled } from "@/sync/adapter";
import { useCloudSession } from "@/lib/cloudSession";

function changes(n: number): string {
  return `${n} change${n === 1 ? "" : "s"}`;
}

/**
 * A thin strip above the page for the two states staff need to act on:
 * the device is offline, or the last sync failed. Routine syncing and the
 * pending count live in the header's sync status control, so this banner
 * does not flash on every background sync.
 *
 * The pending count is the same one the header shows (unsynced local rows
 * plus queued operations), read only while offline. useSyncStore's
 * pendingCount is not used: nothing updates it.
 */
export function OfflineBanner() {
  const isOnline = useSyncStore((s) => s.isOnline);
  const status = useSyncStore((s) => s.status);
  const syncEnabled = isOnlineSyncEnabled();
  // After logout or a PIN unlock there is no online sign-in, and nothing
  // uploads when the connection returns: do not promise that it will.
  const noSession = useCloudSession() === "signed_out";
  const [dismissedOffline, setDismissedOffline] = useState(false);
  const [dismissedError, setDismissedError] = useState(false);

  const unsynced =
    useLiveQuery(
      () => (!isOnline && syncEnabled ? countUnsyncedRecords() : 0),
      [isOnline, syncEnabled],
      0,
    ) ?? 0;
  const queued = useOperationsQueue(
    (s) =>
      s.operations.filter(
        (op) => op.status === "pending" || op.status === "processing",
      ).length,
  );
  const pending = unsynced + queued;

  // Each change of connection is news: show the banner again.
  useEffect(() => {
    setDismissedOffline(false);
  }, [isOnline]);

  // A dismissed sync failure stays hidden until a sync succeeds, so a
  // failing retry does not keep pushing it back onto the screen.
  useEffect(() => {
    if (status === "ok") setDismissedError(false);
  }, [status]);

  let banner: {
    tone: string;
    icon: typeof SignalSlashIcon;
    title: string;
    detail: string;
    onDismiss: () => void;
  } | null = null;

  if (!isOnline && !dismissedOffline) {
    banner = {
      tone: "border-line bg-surface-sunken text-ink-secondary",
      icon: SignalSlashIcon,
      title: "You're offline.",
      detail: !syncEnabled
        ? "Records are saved on this device."
        : noSession
          ? pending > 0
            ? `${changes(pending)} saved on this device. Sign in online to sync them.`
            : "New records are saved on this device. Sign in online to sync them."
          : pending > 0
            ? `${changes(pending)} saved on this device, waiting to sync. Sync starts again when the connection returns.`
            : "New records are saved on this device. Sync starts again when the connection returns.",
      onDismiss: () => setDismissedOffline(true),
    };
  } else if (
    isOnline &&
    syncEnabled &&
    // Without an online sign-in the header explains why sync cannot run;
    // "choose Sync now" would not help here.
    !noSession &&
    status === "error" &&
    !dismissedError
  ) {
    banner = {
      tone: "border-danger-line bg-danger-soft text-danger-fg",
      icon: ExclamationTriangleIcon,
      title: "Sync failed.",
      detail:
        "Records are still saved on this device. To try again, open the sync status at the top of the screen and choose Sync now.",
      onDismiss: () => setDismissedError(true),
    };
  }

  const Icon = banner?.icon;

  return (
    <div role="status" aria-live="polite">
      {banner && Icon && (
        <div className={`border-b px-4 py-2 text-body ${banner.tone}`}>
          <div className="mx-auto flex max-w-7xl items-center gap-3">
            <Icon className="h-5 w-5 shrink-0" aria-hidden />
            <p className="min-w-0 flex-1">
              <span className="font-medium">{banner.title}</span>{" "}
              {banner.detail}
            </p>
            <button
              type="button"
              onClick={banner.onDismiss}
              className="-my-1 -mr-2 inline-flex min-h-touch-target min-w-touch-target shrink-0 items-center justify-center rounded-md transition-colors hover:bg-ink/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-label="Dismiss notification"
            >
              <XMarkIcon className="h-5 w-5" aria-hidden />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
