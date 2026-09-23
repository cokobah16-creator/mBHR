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
import { useLiveQuery } from "dexie-react-hooks";
import {
  syncNow,
  isOnlineSyncEnabled,
  countUnsyncedRecords,
  fetchRemoteRecord,
} from "@/sync/adapter";
import { useSyncStore } from "@/stores/syncStore";
import { useOperationsQueue } from "@/stores/operationsQueue";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/stores/toast";
import { can } from "@/auth/roles";
import { createAuditLog, generateId } from "@/db";
import { resolveConflict } from "@/sync/conflictResolver";
import { queueSyncConflicts } from "@/sync/queueConflicts";
import { namedSyncError, syncErrorCode } from "@/sync/errorCode";
import { loadLocalRecord } from "@/features/conflicts/localContext";
import { conflictQueueService } from "@/services/conflictQueue";
import { ConflictResolutionModal, type ConflictData } from "../ConflictResolutionModal";
import { usePopover } from "./usePopover";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

type Kind = "offline" | "local" | "syncing" | "error" | "conflict" | "pending" | "synced" | "idle";

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
  const online = useOnlineStatus();
  const syncEnabled = isOnlineSyncEnabled();
  const syncStore = useSyncStore();
  const queueStore = useOperationsQueue();
  const { open, setOpen, ref } = usePopover();
  const currentUser = useAuthStore((s) => s.currentUser);
  const canResolve = !!currentUser && can(currentUser.role, "resolve_conflicts");
  const { push } = useToast();
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
      if (result.conflicts.length > 0) {
        // Put them in the shared review queue (skips records already there).
        const queued = await queueSyncConflicts(
          result.conflicts,
          currentUser ? { id: currentUser.id, role: currentUser.role } : undefined,
        );
        if (canResolve) {
          setConflicts(result.conflicts);
          setCurrentConflict(result.conflicts[0]);
        } else {
          const n = result.conflicts.length;
          push({
            id: generateId(),
            tone: "warning",
            title: `${n} record${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} review`,
            body:
              queued.notQueued > 0
                ? "Changed on this device and on the server. Your changes stay on this device and are not uploaded. They are not on the review list yet: sign in online, or ask someone who can resolve sync conflicts to run Sync now on this device."
                : "Changed on this device and on the server. Your changes stay on this device and are not uploaded until someone who can resolve sync conflicts reviews them.",
          });
        }
        await loadConflicts();
      }
      if (result.downloadFailedTables && result.downloadFailedTables.length > 0) {
        push({
          id: generateId(),
          tone: "warning",
          title: "Some updates were not downloaded",
          body: "Some record types could not be downloaded from the server, so this device may not show the latest changes from other devices. Try Sync now again later.",
        });
      }
    } catch (error) {
      console.error("Manual sync failed:", syncErrorCode(error));
    }
  };

  const handleConflictResolve = async (
    strategy: "keep-local" | "keep-remote" | "manual",
    resolution?: Record<string, "local" | "remote">,
  ) => {
    if (!currentConflict) return;
    const conflict = currentConflict;
    // Checked here, not only by hiding the dialog: this writes patient data.
    if (!currentUser || !can(currentUser.role, "resolve_conflicts")) {
      console.error("Failed to resolve conflict:", "NotPermitted");
      throw namedSyncError("NotPermitted");
    }
    const actorRole = currentUser.role;
    try {
      // Keeping this device's copy needs nothing else. The other choices
      // need both copies: this device's record and the server's current
      // record (which needs a connection).
      let localData: Record<string, unknown> | undefined;
      let remoteData: Record<string, unknown> | undefined;
      if (strategy !== "keep-local") {
        const [local, remote] = await Promise.all([
          loadLocalRecord(conflict.entityType, conflict.entityId),
          fetchRemoteRecord(conflict.entityType, conflict.entityId),
        ]);
        localData = local ?? undefined;
        remoteData = remote ?? undefined;
      }
      await resolveConflict(conflict, strategy, resolution, localData, remoteData);
    } catch (error) {
      console.error("Failed to resolve conflict:", syncErrorCode(error));
      // The dialog shows a general failure message when this rejects; say
      // why when the reason is the connection, so staff do not keep retrying.
      const reason = error instanceof Error ? error.name : "";
      if (reason === "Offline" || reason === "RemoteReadFailed") {
        push({
          id: generateId(),
          tone: "warning",
          title: "Server copy not available",
          body:
            reason === "Offline"
              ? "You are offline. Keeping the server's values or choosing field by field needs the server copy. Try again when you are back online, or keep this device's values."
              : "The server copy could not be read. Try again when the connection is steadier, or keep this device's values.",
        });
      }
      throw error;
    }

    try {
      await createAuditLog(
        actorRole,
        `sync_conflict_resolved_${strategy.replace("-", "_")}`,
        conflict.entityType,
        conflict.entityId,
      );
    } catch (error) {
      // The record is already written; a missing audit entry is not a
      // failed resolution.
      console.error("Audit entry for a sync conflict was not saved:", syncErrorCode(error));
    }

    const remaining = conflicts.slice(1);
    setConflicts(remaining);
    setCurrentConflict(remaining[0] || null);
    if (remaining.length === 0) await handleSync();
    await loadConflicts();
  };

  const unsynced = useLiveQuery(() => countUnsyncedRecords(), [], 0) ?? 0;
  const pending = unsynced + queueStore.getPendingCount();
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
