import { useState, useEffect, useCallback } from "react";
import { doctorService } from "@/services/doctorService";
import { useAuthStore } from "@/stores/auth";
import { can, type Role } from "@/auth/roles";
import { isSupabaseEnabled } from "@/lib/supabaseClient";
import { formatTime } from "@/utils/dateFormat";
import type { PatientFlag } from "@/types/multiTenant";
import { StatusBadge, type Tone } from "@/components/ui/StatusBadge";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  FlagIcon,
  CheckCircleIcon,
  XMarkIcon,
  ClockIcon,
  UserIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";

interface PatientFlagsPanelProps {
  org_id: string;
  site_id?: string;
  event_id?: string;
  station: "consult" | "pharmacy" | "vitals" | "lab" | "registration";
}

const PRIORITY_DISPLAY: Record<
  PatientFlag["priority"],
  { label: string; tone: Tone; card: string }
> = {
  urgent: {
    label: "Urgent",
    tone: "danger",
    card: "border-danger-line bg-danger-soft",
  },
  high: {
    label: "High",
    tone: "warning",
    card: "border-warning-line bg-warning-soft",
  },
  normal: { label: "Normal", tone: "info", card: "border-line bg-surface" },
  low: { label: "Low", tone: "neutral", card: "border-line bg-surface" },
};

/** Staff who work a station can clear the alerts sent to it. */
function canHandleStation(
  role: Role | undefined,
  station: PatientFlagsPanelProps["station"],
): boolean {
  if (!role) return false;
  switch (station) {
    case "registration":
      return can(role, "register");
    case "vitals":
      return can(role, "vitals");
    case "consult":
      return can(role, "consult");
    case "pharmacy":
      return can(role, "dispense");
    case "lab":
      return can(role, "consult") || can(role, "vitals");
    default:
      return false;
  }
}

export function PatientFlagsPanel({
  org_id,
  site_id,
  event_id,
  station,
}: PatientFlagsPanelProps) {
  const { currentUser } = useAuthStore();
  const [flags, setFlags] = useState<PatientFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [actionError, setActionError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedFlag, setSelectedFlag] = useState<PatientFlag | null>(null);
  const [resolutionNote, setResolutionNote] = useState("");

  const canAct = canHandleStation(currentUser?.role, station);

  const loadFlags = useCallback(async () => {
    if (!isSupabaseEnabled) {
      setLoading(false);
      return;
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setLoadFailed(true);
      setLoading(false);
      return;
    }
    try {
      const openFlags = await doctorService.getPatientFlags({
        org_id,
        site_id,
        event_id,
        to_station: station,
        status: "open",
      });

      openFlags.sort((a, b) => {
        const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      });

      setFlags(openFlags);
      setLoadFailed(false);
      setLastChecked(new Date());
    } catch (error) {
      console.error(
        "Error loading patient flags:",
        error instanceof Error ? error.name : error,
      );
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [org_id, site_id, event_id, station]);

  useEffect(() => {
    loadFlags();
    if (!isSupabaseEnabled) return;
    const interval = setInterval(loadFlags, 15000);
    return () => clearInterval(interval);
  }, [loadFlags]);

  const resolve = async (flag: PatientFlag, note: string | undefined) => {
    setActionError("");
    if (!currentUser || !canHandleStation(currentUser.role, station)) {
      setActionError("Your role cannot clear alerts for this station.");
      return false;
    }
    if (!navigator.onLine) {
      setActionError(
        "You are offline. The alert was not cleared — try again when connected.",
      );
      return false;
    }
    setBusyId(flag.id);
    try {
      const success = await doctorService.resolvePatientFlag(
        flag.id,
        currentUser.id,
        note,
      );
      if (!success) {
        setActionError("The alert was not cleared. Try again.");
      }
      return success;
    } catch (error) {
      console.error(
        "Error resolving patient flag:",
        error instanceof Error ? error.name : error,
      );
      setActionError("The alert was not cleared. Check the connection and try again.");
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const handleResolveFlag = async (flag: PatientFlag) => {
    const success = await resolve(flag, resolutionNote || undefined);
    if (success) {
      setFlags((prev) => prev.filter((f) => f.id !== flag.id));
      setSelectedFlag(null);
      setResolutionNote("");
    }
  };

  const handleAcknowledgeFlag = async (flag: PatientFlag) => {
    const success = await resolve(flag, "Acknowledged - will handle");
    if (success) {
      setFlags((prev) => prev.filter((f) => f.id !== flag.id));
    }
  };

  const closeDialog = () => {
    setSelectedFlag(null);
    setResolutionNote("");
    setActionError("");
  };

  const getTimeAgo = (timestamp: string) => {
    const now = new Date();
    const flagTime = new Date(timestamp);
    const diffMs = now.getTime() - flagTime.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    return `${Math.floor(diffMins / 60)}h ${diffMins % 60}m ago`;
  };

  const header = (
    <div className="panel-header">
      <h3 className="panel-title flex items-center gap-2">
        <FlagIcon className="h-5 w-5 text-ink-muted" aria-hidden />
        Station alerts
      </h3>
      {flags.length > 0 && (
        <StatusBadge tone="warning">{flags.length} open</StatusBadge>
      )}
    </div>
  );

  if (!isSupabaseEnabled) {
    return (
      <section className="panel">
        {header}
        <p className="panel-body text-body text-ink-muted">
          Station alerts are shared through the online record, which is not set
          up on this installation. Pass messages between stations in person.
        </p>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="panel" aria-busy="true">
        {header}
        <div className="panel-body space-y-3">
          <span role="status" className="sr-only">
            Checking for station alerts
          </span>
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-20" />
        </div>
      </section>
    );
  }

  return (
    <section className="panel">
      {header}

      <div className="panel-body space-y-3">
        {loadFailed && (
          <div className="banner banner-warning" role="status">
            <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
            <span>
              {navigator.onLine
                ? "Could not check for new alerts."
                : "You are offline, so new alerts cannot be checked."}{" "}
              {lastChecked
                ? `The list below is from ${formatTime(lastChecked)} and may be out of date.`
                : "No alerts have been loaded yet."}
            </span>
          </div>
        )}

        {actionError && !selectedFlag && (
          <div className="banner banner-danger" role="alert">
            <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
            <span>{actionError}</span>
          </div>
        )}

        {flags.length === 0 ? (
          !loadFailed && (
            <p className="text-body text-ink-muted">
              No open alerts for this station
              {lastChecked ? ` (last checked ${formatTime(lastChecked)})` : ""}.
            </p>
          )
        ) : (
          <ul className="space-y-3" aria-live="polite">
            {flags.map((flag) => {
              const priority = PRIORITY_DISPLAY[flag.priority];
              const flagLabel = flag.flag_type.replace(/_/g, " ");
              return (
                <li
                  key={flag.id}
                  className={`rounded-md border p-3 ${priority.card}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <span className="section-label text-ink-secondary">
                          {flagLabel}
                        </span>
                        <StatusBadge tone={priority.tone}>
                          {priority.label}
                        </StatusBadge>
                      </div>

                      <p className="mb-2 text-body font-medium text-ink">
                        {flag.message}
                      </p>

                      <div className="flex flex-wrap items-center gap-4 text-caption text-ink-muted">
                        <span className="flex items-center gap-1">
                          <UserIcon className="h-3.5 w-3.5" aria-hidden />
                          From {flag.from_station}
                        </span>
                        <span className="flex items-center gap-1">
                          <ClockIcon className="h-3.5 w-3.5" aria-hidden />
                          {getTimeAgo(flag.created_at)}
                        </span>
                      </div>

                      {flag.context && Object.keys(flag.context).length > 0 && (
                        <details className="mt-2 text-caption">
                          <summary className="cursor-pointer font-medium text-ink-secondary">
                            Additional context
                          </summary>
                          <pre className="mt-1 overflow-auto rounded border border-line bg-surface p-2 text-caption">
                            {JSON.stringify(flag.context, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>

                    {canAct && (
                      <div className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          onClick={() => handleAcknowledgeFlag(flag)}
                          disabled={busyId !== null}
                          className="btn-ghost px-2"
                          aria-label={`Acknowledge alert: ${flagLabel}`}
                          title="Acknowledge"
                        >
                          <CheckCircleIcon className="h-5 w-5" aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedFlag(flag)}
                          disabled={busyId !== null}
                          className="btn-ghost px-2"
                          aria-label={`Resolve alert with a note: ${flagLabel}`}
                          title="Resolve with note"
                        >
                          <XMarkIcon className="h-5 w-5" aria-hidden />
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {selectedFlag && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="resolve-flag-title"
            className="w-full max-w-md rounded-lg border border-line bg-surface p-6 shadow-xl"
            onKeyDown={(e) => {
              if (e.key === "Escape" && busyId === null) closeDialog();
            }}
          >
            <h3 id="resolve-flag-title" className="text-h2 text-ink">
              Resolve alert
            </h3>

            <dl className="mt-3 space-y-1 text-body text-ink-secondary">
              <div>
                <dt className="inline font-medium text-ink">Alert: </dt>
                <dd className="inline">
                  {selectedFlag.flag_type.replace(/_/g, " ")}
                </dd>
              </div>
              <div>
                <dt className="inline font-medium text-ink">Message: </dt>
                <dd className="inline">{selectedFlag.message}</dd>
              </div>
            </dl>

            <div className="mt-4">
              <label htmlFor="resolve-flag-note" className="field-label">
                Resolution note (optional)
              </label>
              <textarea
                id="resolve-flag-note"
                autoFocus
                value={resolutionNote}
                onChange={(e) => setResolutionNote(e.target.value)}
                className="input-field"
                rows={3}
                placeholder="How was this handled?"
              />
            </div>

            {actionError && (
              <p className="field-error mt-3" role="alert">
                {actionError}
              </p>
            )}

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeDialog}
                disabled={busyId !== null}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleResolveFlag(selectedFlag)}
                disabled={busyId !== null}
                className="btn-primary"
              >
                {busyId === selectedFlag.id ? "Resolving…" : "Resolve alert"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
