import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowPathIcon, SignalSlashIcon } from "@heroicons/react/24/outline";
import { enhancedSync } from "@/services/enhancedSync";
import { countUnsyncedRecords } from "@/sync/adapter";
import { useSyncStore } from "@/stores/syncStore";
import { useOperationsQueue } from "@/stores/operationsQueue";
import { useAuthStore } from "@/stores/auth";
import { can } from "@/auth/roles";
import { conflictQueueService } from "@/services/conflictQueue";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { formatConflictAge, formatTimestamp, humanise } from "@/features/conflicts/conflictLabels";
import { deriveSyncHeadline } from "@/features/conflicts/syncStatus";
import { countDirtyIn, ENHANCED_ONLY_TABLES } from "@/features/conflicts/syncCounts";

/** Tables the dashboard's Sync now (enhanced sync) downloads. */
const SESSION_TABLES = [
  "patients",
  "visits",
  "vitals",
  "consultations",
  "dispenses",
  "inventory",
  "queue",
  "gameSessions",
  "gamificationWallets",
  "stockBatches",
  "careTasks",
  "triageRecords",
  "patientAllergies",
  "patientPreferences",
  "vitalsRanges",
];

type ConflictCount =
  | { state: "loading" }
  | { state: "ok"; count: number }
  | { state: "unavailable" }
  | { state: "no_session" }
  | { state: "offline"; count?: number }
  | { state: "error"; count?: number };

interface RunResult {
  at: Date;
  success: boolean;
  pushed: number;
  pulled: number;
  failedUploads: number;
  /** Downloaded updates not applied because this device has unsent changes. */
  keptLocalEdits: number;
  /** Tables that did not finish, by this device's table name. */
  failedTables: string[];
  error?: string;
}

function readSessionTimes(): Record<string, Date | null> {
  const times: Record<string, Date | null> = {};
  SESSION_TABLES.forEach((table) => {
    times[table] = enhancedSync.getLastSyncTime(table);
  });
  return times;
}

function lastCount(prev: ConflictCount): number | undefined {
  return "count" in prev ? prev.count : undefined;
}

function since(date: Date): string {
  const age = formatConflictAge(date);
  return age === "Just now" ? age : `${age} ago`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function SyncDashboard() {
  const online = useOnlineStatus();
  const configured = enhancedSync.isInitialized();
  const role = useAuthStore((s) => s.currentUser?.role);
  const lastSuccessAt = useSyncStore((s) => s.lastSuccessAt);
  const lastErrorAt = useSyncStore((s) => s.lastErrorAt);
  const errorMessage = useSyncStore((s) => s.errorMessage);
  const adapterSyncing = useSyncStore((s) => s.status === "syncing");
  const operations = useOperationsQueue((s) => s.operations);

  const coreWaiting = useLiveQuery(() => countUnsyncedRecords(), []);
  const extraWaiting = useLiveQuery(() => countDirtyIn(ENHANCED_ONLY_TABLES), []);
  const queuedOps = operations.filter(
    (op) => op.status === "pending" || op.status === "processing",
  ).length;
  const failed = operations.filter((op) => op.status === "failed").length;
  const waiting =
    coreWaiting === undefined || extraWaiting === undefined
      ? null
      : coreWaiting + extraWaiting + queuedOps;

  const [running, setRunning] = useState(false);
  const [run, setRun] = useState<RunResult | null>(null);
  const [sessionTimes, setSessionTimes] = useState<Record<string, Date | null>>(readSessionTimes);
  const [conflicts, setConflicts] = useState<ConflictCount>({ state: "loading" });

  const loadConflicts = useCallback(async () => {
    if (!conflictQueueService.isAvailable()) {
      setConflicts({ state: "unavailable" });
      return;
    }
    if (!online) {
      setConflicts((prev) => ({ state: "offline", count: lastCount(prev) }));
      return;
    }
    try {
      // Without an online sign-in the server returns no rows, not an error,
      // so a zero would be a guess.
      if (!(await conflictQueueService.hasCloudSession())) {
        setConflicts({ state: "no_session" });
        return;
      }
      const stats = await conflictQueueService.getConflictStats();
      setConflicts({ state: "ok", count: stats.pending + stats.needsApproval });
    } catch {
      setConflicts((prev) => ({ state: "error", count: lastCount(prev) }));
    }
  }, [online]);

  useEffect(() => {
    loadConflicts();
    const interval = setInterval(() => {
      loadConflicts();
      setSessionTimes(readSessionTimes());
    }, 30000);
    return () => clearInterval(interval);
  }, [loadConflicts]);

  const syncing = running || adapterSyncing || enhancedSync.isSyncing();

  const handleSync = async () => {
    if (syncing || !online) return;
    setRunning(true);
    try {
      const result = await enhancedSync.syncAll();
      setRun({
        at: new Date(),
        success: result.success,
        pushed: result.pushed,
        pulled: result.pulled,
        failedUploads: result.failedUploads,
        keptLocalEdits: result.keptLocalEdits,
        failedTables: (result.failedTables ?? []).map((f) => f.table),
        error: result.error,
      });
    } catch (error) {
      console.error("Sync run failed:", error instanceof Error ? error.name : "unknown");
      setRun({
        at: new Date(),
        success: false,
        pushed: 0,
        pulled: 0,
        failedUploads: 0,
        keptLocalEdits: 0,
        failedTables: [],
      });
    } finally {
      setRunning(false);
      setSessionTimes(readSessionTimes());
      loadConflicts();
    }
  };

  if (!configured) {
    return (
      <section className="panel" aria-labelledby="sync-dashboard-title">
        <div className="panel-header">
          <h2 id="sync-dashboard-title" className="panel-title">
            Data sync
          </h2>
          <StatusBadge tone="neutral">This device only</StatusBadge>
        </div>
        <p className="panel-body text-body text-ink-secondary">
          Cloud sync is not set up on this device. Records are saved on this
          device only and are not uploaded anywhere.
        </p>
      </section>
    );
  }

  const conflictCount = conflicts.state === "ok" ? conflicts.count : null;
  const headline = deriveSyncHeadline({
    configured,
    online,
    syncing,
    waiting,
    failed,
    errorMessage,
    conflicts: conflictCount,
    lastSuccessText: lastSuccessAt > 0 ? formatTimestamp(new Date(lastSuccessAt)) : null,
  });

  const conflictValue = (() => {
    switch (conflicts.state) {
      case "ok":
        return String(conflicts.count);
      case "loading":
        return "Checking…";
      case "unavailable":
        return "Not available";
      case "no_session":
        return "Unknown (not signed in online)";
      case "offline":
        return conflicts.count !== undefined ? `${conflicts.count} (before going offline)` : "Unknown offline";
      case "error":
      default:
        return conflicts.count !== undefined ? `${conflicts.count} (may be out of date)` : "Could not check";
    }
  })();

  const canReviewConflicts = !!role && can(role, "resolve_conflicts");

  const metrics: { label: string; value: string; note?: string }[] = [
    {
      label: "Waiting to upload",
      value: waiting === null ? "Counting…" : String(waiting),
      note:
        extraWaiting && extraWaiting > 0
          ? `${extraWaiting} of these (care tasks, stock batches, triage or training records) upload only with Sync now here.`
          : undefined,
    },
    {
      label: "Failed",
      value: String(failed),
      note: failed > 0 ? "Stopped retrying. They stay on this device." : undefined,
    },
    { label: "Conflicts to review", value: conflictValue },
    {
      label: "Last successful sync",
      value: lastSuccessAt > 0 ? formatTimestamp(new Date(lastSuccessAt)) : "None recorded",
      note:
        lastErrorAt > lastSuccessAt && lastErrorAt > 0
          ? `Last failed attempt ${formatTimestamp(new Date(lastErrorAt))}.`
          : "Recorded by the automatic sync and the sync menu at the top.",
    },
  ];

  return (
    <section className="panel" aria-labelledby="sync-dashboard-title">
      <div className="panel-header flex-wrap">
        <h2 id="sync-dashboard-title" className="panel-title">
          Data sync
        </h2>
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing || !online}
          className="btn-primary"
        >
          <ArrowPathIcon
            className={`h-5 w-5 ${syncing ? "animate-spin" : ""}`}
            aria-hidden
          />
          {syncing ? "Syncing…" : "Sync now"}
        </button>
      </div>

      <div className="panel-body space-y-4">
        <div className="flex flex-wrap items-start gap-3" role="status" aria-live="polite">
          <StatusBadge tone={headline.tone} icon>
            {headline.title}
          </StatusBadge>
          <p className="min-w-0 flex-1 text-body text-ink-secondary">{headline.detail}</p>
        </div>

        {!online && (
          <div className="banner banner-warning">
            <SignalSlashIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <p>You are offline. Sync now is available when the connection returns.</p>
          </div>
        )}

        {run && (
          <div
            className={`banner ${
              !run.success ? "banner-danger" : run.failedUploads > 0 ? "banner-warning" : "banner-info"
            }`}
            role={run.success ? "status" : "alert"}
          >
            <div>
              <p className="font-medium">
                {!run.success
                  ? `Sync did not finish (${formatTimestamp(run.at)})`
                  : `Sync run finished (${formatTimestamp(run.at)})`}
              </p>
              <p>
                {plural(run.pushed, "record")} uploaded, {plural(run.pulled, "record")} downloaded
                {run.failedUploads > 0
                  ? `, ${plural(run.failedUploads, "record")} refused by the server and still waiting to upload`
                  : ""}
                .
                {!run.success &&
                  (run.error === "Already syncing or not initialized"
                    ? " A sync was already running. Try again in a moment."
                    : run.failedTables.length > 0
                      ? ` Did not finish for: ${run.failedTables.join(", ")}. Check the connection and try again.`
                      : " Check the connection and try again.")}
              </p>
              {run.keptLocalEdits > 0 && (
                <p className="mt-1">
                  {plural(run.keptLocalEdits, "downloaded update")} {run.keptLocalEdits === 1 ? "was" : "were"} not
                  applied because this device has unsent changes to {run.keptLocalEdits === 1 ? "that record" : "those records"}.
                  They upload first; any disagreement appears under sync conflicts.
                </p>
              )}
            </div>
          </div>
        )}

        <dl className="grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {metrics.map((m) => (
            <div key={m.label} className="bg-surface px-4 py-3">
              <dt className="text-caption text-ink-muted">{m.label}</dt>
              <dd className="mt-1 text-h3 tabular-nums text-ink">{m.value}</dd>
              {m.note && <dd className="mt-1 text-caption text-ink-muted">{m.note}</dd>}
            </div>
          ))}
        </dl>

        {canReviewConflicts && conflicts.state !== "unavailable" && (
          <p className="text-body">
            <Link
              to="/admin/conflicts"
              className="inline-flex min-h-touch-target items-center text-primary-fg underline hover:no-underline"
            >
              Review sync conflicts
            </Link>
          </p>
        )}

        <details className="rounded-md border border-line">
          <summary className="flex min-h-touch-target cursor-pointer items-center px-3 text-label text-ink">
            Downloads by Sync now during this session
          </summary>
          <div className="border-t border-line px-3 py-2">
            <p className="mb-2 text-caption text-ink-muted">
              When Sync now on this screen last downloaded records for each table.
              These times reset when the app reloads.
            </p>
            <dl className="divide-y divide-line">
              {Object.entries(sessionTimes).map(([table, date]) => (
                <div key={table} className="flex items-center justify-between gap-3 py-1.5 text-body">
                  <dt className="text-ink-secondary">{humanise(table)}</dt>
                  <dd className={date ? "text-ink" : "text-ink-muted"}>
                    {date ? since(date) : "None this session"}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </details>
      </div>
    </section>
  );
}
