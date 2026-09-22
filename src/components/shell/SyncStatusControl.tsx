import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowPathIcon,
  CheckCircleIcon,
  CloudArrowUpIcon,
  ExclamationTriangleIcon,
  SignalSlashIcon,
  ServerIcon,
} from "@heroicons/react/20/solid";
import { syncNow, isOnlineSyncEnabled } from "@/sync/adapter";
import { useSyncStore } from "@/stores/syncStore";
import { useOperationsQueue } from "@/stores/operationsQueue";
import { resolveConflict } from "@/sync/conflictResolver";
import { conflictQueueService } from "@/services/conflictQueue";
import { ConflictResolutionModal, type ConflictData } from "../ConflictResolutionModal";
import { usePopover } from "./usePopover";

type Kind = "offline" | "local" | "syncing" | "error" | "conflict" | "pending" | "synced" | "idle";

function useOnline() {
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

function clock(ts: number) {
  return new Date(ts).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" });
}

/**
 * One compact indicator for connectivity + cloud sync. Opens a panel with
 * pending records, last successful sync, conflicts and a manual retry.
 * Never claims data reached the server unless the sync adapter says so.
 */
export function SyncStatusControl() {
  const navigate = useNavigate();
  const online = useOnline();
  const syncEnabled = isOnlineSyncEnabled();
  const syncStore = useSyncStore();
  const queueStore = useOperationsQueue();
  const { open, setOpen, ref } = usePopover();
  const [conflicts, setConflicts] = useState<ConflictData[]>([]);
  const [currentConflict, setCurrentConflict] = useState<ConflictData | null>(null);
  const [conflictCount, setConflictCount] = useState(0);

  const loadConflicts = useCallback(async () => {
    if (!isOnlineSyncEnabled()) return;
    try {
      const stats = await conflictQueueService.getConflictStats();
      setConflictCount(stats.pending + stats.needsApproval);
    } catch {
      // Conflict service may be unreachable offline; keep the last count.
    }
  }, []);

  useEffect(() => {
    loadConflicts();
    const interval = setInterval(loadConflicts, 60000);
    return () => clearInterval(interval);
  }, [loadConflicts]);

  const handleSync = async () => {
    syncStore.setStatus("syncing");
    try {
      const result = await syncNow();
      if (result.conflicts && result.conflicts.length > 0) {
        for (const conflict of result.conflicts) {
          await conflictQueueService.createConflict({
            conflictType: "sync_conflict",
            entityType: conflict.entityType,
            entityId: conflict.entityId,
            conflictDetails: {
              fields: conflict.conflicts.map((c) => ({
                ...c,
                phiSensitivity: "low" as const,
              })),
              localTimestamp: conflict.localTimestamp,
              remoteTimestamp: conflict.remoteTimestamp,
            },
          });
        }
        setConflicts(result.conflicts);
        setCurrentConflict(result.conflicts[0]);
        await loadConflicts();
      }
    } catch (error) {
      console.error("Manual sync failed:", error);
    }
  };

  const handleConflictResolve = async (
    strategy: "keep-local" | "keep-remote" | "manual",
    resolution?: Record<string, "local" | "remote">,
  ) => {
    if (!currentConflict) return;
    try {
      await resolveConflict(currentConflict, strategy, resolution);
      const remaining = conflicts.slice(1);
      setConflicts(remaining);
      setCurrentConflict(remaining[0] || null);
      if (remaining.length === 0) await handleSync();
      await loadConflicts();
    } catch (error) {
      console.error("Failed to resolve conflict:", error);
    }
  };

  const pending = queueStore.getPendingCount();
  const failed = queueStore.getFailedCount();
  const syncing = syncStore.status === "syncing";

  const kind: Kind = !online
    ? "offline"
    : !syncEnabled
      ? "local"
      : syncing
        ? "syncing"
        : syncStore.errorMessage || failed > 0
          ? "error"
          : conflictCount > 0
            ? "conflict"
            : pending > 0
              ? "pending"
              : syncStore.lastSuccessAt > 0
                ? "synced"
                : "idle";

  const view: Record<Kind, { label: string; Icon: typeof CheckCircleIcon; cls: string }> = {
    offline: { label: "Offline", Icon: SignalSlashIcon, cls: "text-ink-secondary" },
    local: { label: "This device only", Icon: ServerIcon, cls: "text-ink-secondary" },
    syncing: { label: "Syncing", Icon: ArrowPathIcon, cls: "text-info" },
    error: { label: failed > 0 ? `${failed} failed` : "Sync error", Icon: ExclamationTriangleIcon, cls: "text-danger" },
    conflict: {
      label: `${conflictCount} conflict${conflictCount === 1 ? "" : "s"}`,
      Icon: ExclamationTriangleIcon,
      cls: "text-warning",
    },
    pending: { label: `${pending} pending`, Icon: CloudArrowUpIcon, cls: "text-info" },
    synced: { label: `Synced ${clock(syncStore.lastSuccessAt)}`, Icon: CheckCircleIcon, cls: "text-success" },
    idle: { label: "Not synced yet", Icon: CloudArrowUpIcon, cls: "text-ink-secondary" },
  };
  const { label, Icon, cls } = view[kind];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Sync status: ${label}. Show details`}
        className="flex items-center gap-1.5 rounded-md px-2 py-1.5 min-h-touch-target text-label text-ink hover:bg-surface-hover"
      >
        <Icon className={`h-4 w-4 ${cls} ${kind === "syncing" ? "animate-spin" : ""}`} aria-hidden />
        <span className="hidden sm:inline whitespace-nowrap">{label}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Sync details"
          className="absolute right-0 top-full z-50 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-surface shadow-xl"
        >
          <dl className="divide-y divide-line text-body">
            <div className="flex justify-between gap-3 px-3 py-2.5">
              <dt className="text-ink-muted">Connection</dt>
              <dd className="font-medium text-ink">{online ? "Online" : "Offline"}</dd>
            </div>
            <div className="flex justify-between gap-3 px-3 py-2.5">
              <dt className="text-ink-muted">Cloud sync</dt>
              <dd className="font-medium text-ink">
                {syncEnabled ? "Configured" : "Not configured"}
              </dd>
            </div>
            {syncEnabled && (
              <>
                <div className="flex justify-between gap-3 px-3 py-2.5">
                  <dt className="text-ink-muted">Last successful sync</dt>
                  <dd className="font-medium text-ink">
                    {syncStore.lastSuccessAt > 0
                      ? new Date(syncStore.lastSuccessAt).toLocaleString("en-NG", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "Never"}
                  </dd>
                </div>
                <div className="flex justify-between gap-3 px-3 py-2.5">
                  <dt className="text-ink-muted">Waiting to upload</dt>
                  <dd className="font-medium text-ink">{pending}</dd>
                </div>
                {failed > 0 && (
                  <div className="flex justify-between gap-3 px-3 py-2.5">
                    <dt className="text-danger-fg">Failed operations</dt>
                    <dd className="font-medium text-danger-fg">{failed}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-3 px-3 py-2.5">
                  <dt className="text-ink-muted">Conflicts to review</dt>
                  <dd className="font-medium text-ink">{conflictCount}</dd>
                </div>
              </>
            )}
          </dl>
          {syncStore.errorMessage && (
            <p className="mx-3 mb-2 banner banner-danger text-caption">
              {syncStore.errorMessage}
            </p>
          )}
          {!syncEnabled && (
            <p className="px-3 pb-3 text-caption text-ink-muted">
              Records are saved on this device only.
            </p>
          )}
          {syncEnabled && (
            <div className="flex gap-2 border-t border-line p-3">
              <button
                type="button"
                onClick={handleSync}
                disabled={syncing || !online}
                className="btn-primary flex-1 min-h-10 py-2"
              >
                <ArrowPathIcon className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} aria-hidden />
                {syncing ? "Syncing…" : "Sync now"}
              </button>
              {conflictCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    navigate("/admin/conflicts");
                  }}
                  className="btn-secondary min-h-10 py-2"
                >
                  Review
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {currentConflict && (
        <ConflictResolutionModal
          conflict={currentConflict}
          onResolve={handleConflictResolve}
          onCancel={() => {
            setCurrentConflict(null);
            setConflicts([]);
          }}
        />
      )}
    </div>
  );
}
