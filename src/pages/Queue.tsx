import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, generateId, Patient, QueueItem } from "@/db";
import {
  queueManagement,
  QueuePermissionError,
  QueueStage,
  QueueValidationError,
} from "@/services/queueManagement";
import {
  compareWaiting,
  downgradeOptions,
  MAX_REASON_LENGTH,
  mayDowngradePriority,
  normalisePriority,
  normaliseReason,
  PRIORITY_LABELS,
  type QueuePriority,
} from "@/services/queuePriority";
import { FLOW_STAGE_LABELS } from "@/services/patientFlow";
import { useAuthStore } from "@/stores/auth";
import { recordStageEvent } from "@/services/stageEvents";
import {
  canManageQueue,
  canMoveForward,
  moveForwardDescription,
  moveForwardLabel,
  ticketStateBadge,
} from "@/features/tickets/queueBoardModel";
import type { QueueRow } from "@/services/queueTickets";
import { isSupabaseEnabled } from "@/lib/supabaseClient";
import { useToast } from "@/stores/toast";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { QueueSkeleton } from "@/components/ui/Skeleton";
import {
  PlayIcon,
  CheckIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  ExclamationTriangleIcon,
  TicketIcon,
} from "@heroicons/react/20/solid";
import { QueueListIcon } from "@heroicons/react/24/outline";

const STAGES: QueueStage[] = ["registration", "vitals", "consult", "pharmacy"];

// Stage colour identifies workflow position; it is used as a small marker,
// never to fill whole rows.
const STAGE_MARKER: Record<QueueStage, string> = {
  registration: "bg-stage-registration",
  vitals: "bg-stage-vitals",
  consult: "bg-stage-consult",
  pharmacy: "bg-stage-pharmacy",
};

const DOWNGRADE_HINT_ID = "queue-downgrade-hint";
const DOWNGRADE_ERROR_ID = "queue-downgrade-error";

/** Waits longer than this are highlighted for the stage lead. */
const LONG_WAIT_MINUTES = 30;

interface QueueWithPatient extends QueueItem {
  patient?: Patient;
}

interface DowngradeDraft {
  item: QueueWithPatient;
  newPriority: QueuePriority;
  reason: string;
  error: string;
}

function isQueuePriority(value: string): value is QueuePriority {
  return value === "urgent" || value === "normal" || value === "low";
}

/**
 * What a priority change toast may honestly say. The change and its audit
 * record are saved on this device and wait for the next sync; other devices
 * show it after that sync (and after their own).
 */
function priorityNote(syncEnabled: boolean): string {
  return syncEnabled
    ? "Saved on this device. Waiting to sync; other devices show the change after it syncs."
    : "Saved on this device.";
}

/** Temporary, unconfirmed or changed ticket number (text and icon). */
function TicketState({ row }: { row: QueueRow }) {
  const badge = ticketStateBadge(row, isSupabaseEnabled);
  if (!badge) return null;
  return (
    <StatusBadge tone={badge.tone} icon>
      {badge.label}
    </StatusBadge>
  );
}

function ticketOf(item: Pick<QueueItem, "ticketNumber" | "position">) {
  return item.ticketNumber ?? `#${item.position}`;
}

function minutesSince(d: Date | string | undefined, now: number) {
  if (!d) return 0;
  return Math.max(0, Math.floor((now - new Date(d).getTime()) / 60000));
}

function formatMinutes(m: number) {
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function isToday(d: Date | string) {
  const x = new Date(d);
  const n = new Date();
  return (
    x.getFullYear() === n.getFullYear() &&
    x.getMonth() === n.getMonth() &&
    x.getDate() === n.getDate()
  );
}

function useNow(intervalMs = 30000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function Queue() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const role = currentUser?.role;
  const [filter, setFilter] = useState<"all" | "urgent" | "long" | "mine">("all");
  const [selectedStage, setSelectedStage] = useState<QueueStage>("vitals");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [downgrade, setDowngrade] = useState<DowngradeDraft | null>(null);
  const [savingDowngrade, setSavingDowngrade] = useState(false);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  // Where focus returns when the downgrade form closes.
  const downgradeTriggerRef = useRef<HTMLElement | null>(null);
  const { push } = useToast();
  const now = useNow();
  const downgradeOpenFor = downgrade?.item.id;

  useEffect(() => {
    if (downgradeOpenFor) reasonRef.current?.focus();
  }, [downgradeOpenFor]);

  // One live query drives every number on the page, so counts never drift
  // from the list.
  const allQueueItems = useLiveQuery(() => db.queue.toArray(), []);
  const patientIds = useMemo(
    () => [...new Set((allQueueItems ?? []).map((q) => q.patientId))],
    [allQueueItems],
  );
  const patients = useLiveQuery(
    () => db.patients.bulkGet(patientIds),
    [patientIds.join(",")],
  );

  const patientById = useMemo(() => {
    const map = new Map<string, Patient>();
    (patients ?? []).forEach((p) => p && map.set(p.id, p));
    return map;
  }, [patients]);

  const stageSummary = useMemo(
    () =>
      STAGES.map((stage) => {
        const items = (allQueueItems ?? []).filter((i) => i.stage === stage);
        return {
          stage,
          waiting: items.filter((i) => i.status === "waiting").length,
          inProgress: items.filter((i) => i.status === "in_progress").length,
          urgentWaiting: items.filter(
            (i) => i.status === "waiting" && normalisePriority(i.priority) === "urgent",
          ).length,
          doneToday: items.filter(
            (i) => i.status === "done" && isToday(i.updatedAt),
          ).length,
        };
      }),
    [allQueueItems],
  );

  const stageItems: QueueWithPatient[] = useMemo(
    () =>
      (allQueueItems ?? [])
        .filter((i) => i.stage === selectedStage && i.status !== "done")
        .sort(compareWaiting)
        .map((i) => ({ ...i, patient: patientById.get(i.patientId) })),
    [allQueueItems, selectedStage, patientById],
  );

  if (allQueueItems === undefined) {
    return (
      <>
        <PageHeader title="Patient queue" />
        <QueueSkeleton />
      </>
    );
  }

  const allWaiting = stageItems.filter((i) => i.status === "waiting");
  const waiting = allWaiting.filter((i) => {
    if (filter === "urgent") return i.priority === "urgent";
    if (filter === "long")
      return minutesSince(i.queuedAt ?? i.updatedAt, now) >= LONG_WAIT_MINUTES;
    return true;
  });
  const inService = stageItems.filter(
    (i) =>
      i.status === "in_progress" &&
      (filter !== "mine" || i.assignedTo === currentUser?.id),
  );
  const summary = stageSummary.find((s) => s.stage === selectedStage)!;
  const longestWait = allWaiting.reduce(
    (max, i) => Math.max(max, minutesSince(i.queuedAt ?? i.updatedAt, now)),
    0,
  );
  const canIssueTickets = canManageQueue(role);
  const canDowngrade = mayDowngradePriority(role);
  const urgentWaiting = allWaiting.filter(
    (i) => normalisePriority(i.priority) === "urgent",
  ).length;

  /** Staff-facing text for a failed queue write. Never includes patient data. */
  const failureMessage = (err: unknown) =>
    err instanceof QueuePermissionError || err instanceof QueueValidationError
      ? `${err.message} Nothing was changed.`
      : "That change was not saved. Try again.";

  const run = async (
    id: string,
    fn: () => Promise<unknown>,
    done?: { title: string },
  ) => {
    // Checked here, not only by hiding buttons: these write the queue.
    if (!canManageQueue(role)) {
      setActionError("Your role can view the queue but cannot call or move patients.");
      return;
    }
    setBusyId(id);
    setActionError("");
    try {
      await fn();
      if (done) {
        push({
          id: generateId(),
          tone: "success",
          title: done.title,
          body: priorityNote(isSupabaseEnabled),
        });
      }
    } catch (err) {
      console.error("Queue action failed:", err instanceof Error ? err.name : "unknown");
      setActionError(failureMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const start = (item: QueueItem) =>
    run(item.id, async () => {
      await queueManagement.startService(
        item.id,
        currentUser ? { id: currentUser.id, name: currentUser.fullName } : undefined,
      );
      await recordStageEvent({
        stage: item.stage,
        kind: "start",
        patientId: item.patientId,
        actorId: currentUser?.id,
      });
    });
  const complete = (item: QueueItem) =>
    run(item.id, () => queueManagement.moveToNextStage(item.patientId));
  const prioritise = (item: QueueItem) =>
    run(item.id, () =>
      queueManagement.skipQueue(item.patientId, "Manual priority"),
    );
  const escalate = (item: QueueItem) =>
    run(
      item.id,
      () =>
        queueManagement.escalatePriority(item.patientId, {
          user: currentUser
            ? { id: currentUser.id, role: currentUser.role, name: currentUser.fullName }
            : undefined,
        }),
      { title: `${ticketOf(item)} marked urgent` },
    );

  const patientName = (item: QueueWithPatient) =>
    item.patient
      ? `${item.patient.givenName} ${item.patient.familyName}`
      : "Unknown patient";

  const openDowngrade = (item: QueueWithPatient, trigger: HTMLElement) => {
    const options = downgradeOptions(normalisePriority(item.priority));
    if (!canDowngrade || options.length === 0) return;
    downgradeTriggerRef.current = trigger;
    setActionError("");
    setDowngrade({ item, newPriority: options[0], reason: "", error: "" });
  };

  const closeDowngrade = () => {
    setDowngrade(null);
    const trigger = downgradeTriggerRef.current;
    downgradeTriggerRef.current = null;
    // The trigger may have gone (the row re-rendered); focus is best effort.
    if (trigger && document.contains(trigger)) trigger.focus();
  };

  const submitDowngrade = async () => {
    if (!downgrade || savingDowngrade) return;
    // Checked here as well as by hiding the button.
    if (!currentUser || !mayDowngradePriority(currentUser.role)) {
      setDowngrade({
        ...downgrade,
        error: "Only a clinician with consultation access can lower triage priority.",
      });
      return;
    }
    const reason = normaliseReason(downgrade.reason);
    if (!reason) {
      setDowngrade({ ...downgrade, error: "Give a reason for lowering the priority." });
      reasonRef.current?.focus();
      return;
    }
    setSavingDowngrade(true);
    try {
      await queueManagement.downgradePriority(downgrade.item.patientId, {
        newPriority: downgrade.newPriority,
        reason,
        user: { id: currentUser.id, role: currentUser.role, name: currentUser.fullName },
      });
      push({
        id: generateId(),
        tone: "success",
        title: `${ticketOf(downgrade.item)}: priority lowered to ${PRIORITY_LABELS[downgrade.newPriority].toLowerCase()}`,
        body: `Your name, the time and the reason were recorded. ${priorityNote(isSupabaseEnabled)}`,
      });
      closeDowngrade();
    } catch (err) {
      console.error(
        "Priority downgrade failed:",
        err instanceof Error ? err.name : "unknown",
      );
      setDowngrade({ ...downgrade, error: failureMessage(err) });
    } finally {
      setSavingDowngrade(false);
    }
  };

  const downgradeDescribedBy = [
    DOWNGRADE_HINT_ID,
    downgrade?.error ? DOWNGRADE_ERROR_ID : null,
  ]
    .filter(Boolean)
    .join(" ");

  /** Priority actions this role may take on a ticket. */
  const priorityControls = (item: QueueWithPatient, compact = false) => {
    const priority = normalisePriority(item.priority);
    const name = patientName(item);
    return (
      <>
        {priority !== "urgent" && canIssueTickets && (
          <button
            type="button"
            onClick={() => escalate(item)}
            disabled={busyId !== null}
            className={`btn-ghost ${compact ? "px-2 min-w-touch-target" : ""}`}
            aria-label={`Mark urgent: ${name}`}
          >
            <ExclamationTriangleIcon className="h-4 w-4" aria-hidden />
            {!compact && "Mark urgent"}
          </button>
        )}
        {priority === "urgent" && canDowngrade && (
          <button
            type="button"
            onClick={(e) => openDowngrade(item, e.currentTarget)}
            disabled={busyId !== null || savingDowngrade}
            aria-expanded={downgrade?.item.id === item.id}
            aria-controls={
              downgrade?.item.id === item.id ? "queue-downgrade-form" : undefined
            }
            className={`btn-ghost ${compact ? "px-2 min-w-touch-target" : ""}`}
            aria-label={`Lower priority: ${name}`}
          >
            <ArrowDownIcon className="h-4 w-4" aria-hidden />
            {!compact && "Lower priority"}
          </button>
        )}
      </>
    );
  };

  return (
    <div>
      <PageHeader
        title="Patient queue"
        description="Who is waiting at each stage and who is being seen now."
        actions={
          canIssueTickets && (
            <Link to="/tickets/issue" className="btn-secondary">
              <TicketIcon className="h-4 w-4" aria-hidden />
              Issue ticket
            </Link>
          )
        }
      />

      {/* Stage tabs double as the queue overview */}
      <div
        role="tablist"
        aria-label="Care stage"
        className="grid grid-cols-2 gap-2 lg:grid-cols-4"
      >
        {stageSummary.map((s) => {
          const selected = s.stage === selectedStage;
          return (
            <button
              key={s.stage}
              role="tab"
              id={`tab-${s.stage}`}
              aria-selected={selected}
              aria-controls="queue-panel"
              onClick={() => setSelectedStage(s.stage)}
              className={`relative overflow-hidden rounded-lg border bg-surface px-4 py-3 text-left transition-colors ${
                selected
                  ? "border-primary ring-1 ring-primary"
                  : "border-line hover:border-line-strong"
              }`}
            >
              <span
                className={`absolute inset-y-0 left-0 w-1 ${STAGE_MARKER[s.stage]}`}
                aria-hidden
              />
              <span className="block text-label text-ink">
                {FLOW_STAGE_LABELS[s.stage]}
              </span>
              <span className="mt-1 flex items-baseline gap-1.5">
                <span className="text-stat text-ink">{s.waiting}</span>
                <span className="text-caption text-ink-muted">waiting</span>
              </span>
              <span className="block text-caption text-ink-muted">
                {s.inProgress} in service · {s.doneToday} done today
              </span>
              {s.urgentWaiting > 0 && (
                <StatusBadge tone="danger" className="mt-1">
                  {s.urgentWaiting} urgent waiting
                </StatusBadge>
              )}
            </button>
          );
        })}
      </div>

      <section
        id="queue-panel"
        role="tabpanel"
        aria-labelledby={`tab-${selectedStage}`}
        className="mt-4 space-y-4"
      >
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter queue">
          {(
            [
              ["all", "All"],
              ["urgent", "Urgent"],
              ["long", `Waiting ${LONG_WAIT_MINUTES}+ min`],
              ["mine", "Called by me"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              aria-pressed={filter === key}
              className={`rounded-md border px-3 py-1.5 text-label transition-colors ${
                filter === key
                  ? "border-primary bg-primary-soft text-primary-fg"
                  : "border-line bg-surface text-ink-secondary hover:bg-surface-hover"
              }`}
            >
              {label}
            </button>
          ))}
          {filter !== "all" && (
            <button type="button" onClick={() => setFilter("all")} className="btn-ghost text-caption">
              Clear filter
            </button>
          )}
        </div>

        {actionError && (
          <div className="banner banner-danger" role="alert">
            {actionError}
          </div>
        )}

        {downgrade && (
          <form
            id="queue-downgrade-form"
            aria-labelledby="queue-downgrade-title"
            className="panel border-warning-line"
            onSubmit={(e) => {
              e.preventDefault();
              void submitDowngrade();
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape" && !savingDowngrade) {
                e.stopPropagation();
                closeDowngrade();
              }
            }}
          >
            <div className="panel-header">
              <h2 id="queue-downgrade-title" className="panel-title">
                Lower triage priority · {ticketOf(downgrade.item)}
              </h2>
              <StatusBadge tone="danger">Urgent now</StatusBadge>
            </div>
            <div className="panel-body space-y-4">
              <p className="text-body text-ink-secondary">
                {patientName(downgrade.item)} is marked urgent. Lower this only
                after you have reassessed the patient. Your name, the time and
                the reason are recorded, and the patient keeps their place in line.
              </p>
              <div>
                <label htmlFor="queue-downgrade-priority" className="field-label">
                  New priority
                </label>
                <select
                  id="queue-downgrade-priority"
                  className="input-field"
                  value={downgrade.newPriority}
                  disabled={savingDowngrade}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (isQueuePriority(value)) {
                      setDowngrade({ ...downgrade, newPriority: value, error: "" });
                    }
                  }}
                >
                  {downgradeOptions(normalisePriority(downgrade.item.priority)).map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_LABELS[p]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="queue-downgrade-reason" className="field-label">
                  Reason (required)
                </label>
                <textarea
                  id="queue-downgrade-reason"
                  ref={reasonRef}
                  className="input-field"
                  rows={3}
                  maxLength={MAX_REASON_LENGTH}
                  value={downgrade.reason}
                  disabled={savingDowngrade}
                  aria-invalid={downgrade.error ? true : undefined}
                  aria-describedby={downgradeDescribedBy}
                  onChange={(e) =>
                    setDowngrade({ ...downgrade, reason: e.target.value, error: "" })
                  }
                />
                <p id={DOWNGRADE_HINT_ID} className="field-hint">
                  For example, what you reassessed and found. Up to{" "}
                  {MAX_REASON_LENGTH} characters.
                </p>
                {downgrade.error && (
                  <p id={DOWNGRADE_ERROR_ID} className="field-error" role="alert">
                    {downgrade.error}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="submit" className="btn-primary" disabled={savingDowngrade}>
                  <ArrowDownIcon className="h-4 w-4" aria-hidden />
                  {savingDowngrade
                    ? "Saving…"
                    : `Lower to ${PRIORITY_LABELS[downgrade.newPriority].toLowerCase()}`}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={closeDowngrade}
                  disabled={savingDowngrade}
                >
                  Keep urgent
                </button>
              </div>
            </div>
          </form>
        )}

        {/* In service */}
        <div className="panel">
          <div className="panel-header">
            <h2 className="panel-title">
              In service · {FLOW_STAGE_LABELS[selectedStage]}
            </h2>
          </div>
          {inService.length === 0 ? (
            <div className="flex flex-col items-start gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-body text-ink-muted">
                Nobody is being seen at this stage.
              </p>
              {allWaiting.length > 0 && (
                <button
                  onClick={() => start(allWaiting[0])}
                  disabled={busyId !== null}
                  className="btn-primary"
                >
                  <PlayIcon className="h-4 w-4" aria-hidden />
                  Call {allWaiting[0].ticketNumber ?? "next patient"}
                </button>
              )}
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {inService.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center"
                >
                  <span className="w-20 shrink-0 font-mono text-h3 text-ink">
                    {item.ticketNumber ?? `#${item.position}`}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <Link
                        to={`/patients/${item.patientId}`}
                        className="block truncate text-h3 text-ink hover:underline"
                      >
                        {patientName(item)}
                      </Link>
                      {normalisePriority(item.priority) === "urgent" && (
                        <StatusBadge tone="danger">Urgent</StatusBadge>
                      )}
                      <TicketState row={item} />
                    </span>
                    <span className="text-caption text-ink-muted">
                      In service for{" "}
                      {formatMinutes(minutesSince(item.updatedAt, now))}
                      {item.assignedName ? ` · with ${item.assignedName}` : ""}
                    </span>
                  </span>
                  {priorityControls(item)}
                  <button
                    onClick={() => complete(item)}
                    disabled={busyId === item.id}
                    className="btn-primary"
                  >
                    <CheckIcon className="h-4 w-4" aria-hidden />
                    {selectedStage === "pharmacy"
                      ? "Finish visit"
                      : `Send to ${FLOW_STAGE_LABELS[STAGES[STAGES.indexOf(selectedStage) + 1]]}`}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Waiting */}
        <div className="panel">
          <div className="panel-header">
            <h2 className="panel-title">
              Waiting ({waiting.length}
              {filter !== "all" && filter !== "mine" ? ` of ${allWaiting.length}` : ""})
            </h2>
            {urgentWaiting > 0 && (
              <StatusBadge tone="danger">{urgentWaiting} urgent</StatusBadge>
            )}
            {waiting.length > 0 && (
              <span
                className={`text-caption ${
                  longestWait >= LONG_WAIT_MINUTES
                    ? "font-semibold text-warning-fg"
                    : "text-ink-muted"
                }`}
              >
                Longest wait {formatMinutes(longestWait)}
              </span>
            )}
          </div>

          {waiting.length === 0 && allWaiting.length > 0 ? (
            <p className="panel-body text-body text-ink-muted">
              No waiting patients match this filter.
            </p>
          ) : waiting.length === 0 ? (
            <EmptyState
              icon={QueueListIcon}
              title={`No one waiting for ${FLOW_STAGE_LABELS[selectedStage].toLowerCase()}`}
              description={
                summary.doneToday > 0
                  ? `${summary.doneToday} patient${summary.doneToday === 1 ? "" : "s"} completed this stage today.`
                  : "Patients appear here when they are sent from the previous stage."
              }
            />
          ) : (
            <>
              {/* Desktop / tablet table */}
              <table className="data-table hidden md:table">
                <thead>
                  <tr>
                    <th scope="col">Ticket</th>
                    <th scope="col">Patient</th>
                    <th scope="col">Waiting</th>
                    <th scope="col">Priority</th>
                    <th scope="col" className="text-right">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {waiting.map((item) => {
                    const mins = minutesSince(item.queuedAt ?? item.updatedAt, now);
                    return (
                      <tr key={item.id}>
                        <td>
                          <span className="font-mono">
                            {item.ticketNumber ?? `#${item.position}`}
                          </span>
                          <span className="mt-1 block empty:hidden">
                            <TicketState row={item} />
                          </span>
                        </td>
                        <td>
                          <Link
                            to={`/patients/${item.patientId}`}
                            className="font-medium text-ink hover:underline"
                          >
                            {patientName(item)}
                          </Link>
                        </td>
                        <td>
                          <span
                            className={
                              mins >= LONG_WAIT_MINUTES
                                ? "font-semibold text-warning-fg"
                                : "text-ink-secondary"
                            }
                          >
                            {formatMinutes(mins)}
                          </span>
                        </td>
                        <td>
                          {normalisePriority(item.priority) === "urgent" ? (
                            <StatusBadge tone="danger">Urgent</StatusBadge>
                          ) : (
                            <span className="text-ink-muted">
                              {PRIORITY_LABELS[normalisePriority(item.priority)]}
                            </span>
                          )}
                        </td>
                        <td className="text-right">
                          <div className="flex justify-end gap-2">
                            {item.id === allWaiting[0]?.id && inService.length === 0 ? (
                              <button
                                onClick={() => start(item)}
                                disabled={busyId !== null}
                                className="btn-primary min-h-10 py-1.5"
                              >
                                <PlayIcon className="h-4 w-4" aria-hidden />
                                Call
                              </button>
                            ) : canMoveForward(allWaiting, item.id) ? (
                              <button
                                onClick={() => prioritise(item)}
                                disabled={busyId !== null}
                                className="btn-ghost"
                                aria-label={moveForwardDescription(patientName(item), item.priority)}
                                title={moveForwardDescription(patientName(item), item.priority)}
                              >
                                <ArrowUpIcon className="h-4 w-4" aria-hidden />
                                {moveForwardLabel(item.priority)}
                              </button>
                            ) : null}
                            {priorityControls(item)}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Phone list */}
              <ul className="divide-y divide-line md:hidden">
                {waiting.map((item) => {
                  const mins = minutesSince(item.queuedAt ?? item.updatedAt, now);
                  return (
                    <li key={item.id} className="flex items-center gap-3 px-4 py-3">
                      <span className="w-14 shrink-0 font-mono text-label text-ink">
                        {item.ticketNumber ?? `#${item.position}`}
                      </span>
                      <span className="min-w-0 flex-1">
                        <Link
                          to={`/patients/${item.patientId}`}
                          className="block truncate font-medium text-ink"
                        >
                          {patientName(item)}
                        </Link>
                        <span className="flex items-center gap-2 text-caption text-ink-muted">
                          <span
                            className={
                              mins >= LONG_WAIT_MINUTES ? "font-semibold text-warning-fg" : ""
                            }
                          >
                            Waiting {formatMinutes(mins)}
                          </span>
                          {normalisePriority(item.priority) === "urgent" && (
                            <StatusBadge tone="danger">Urgent</StatusBadge>
                          )}
                          <TicketState row={item} />
                        </span>
                      </span>
                      {item.id === allWaiting[0]?.id && inService.length === 0 ? (
                        <button
                          onClick={() => start(item)}
                          disabled={busyId !== null}
                          className="btn-primary px-3"
                        >
                          Call
                        </button>
                      ) : canMoveForward(allWaiting, item.id) ? (
                        <button
                          onClick={() => prioritise(item)}
                          disabled={busyId !== null}
                          className="btn-ghost px-2"
                          aria-label={moveForwardDescription(patientName(item), item.priority)}
                        >
                          <ArrowUpIcon className="h-5 w-5" aria-hidden />
                        </button>
                      ) : null}
                      {priorityControls(item, true)}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
