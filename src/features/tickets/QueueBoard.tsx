import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, generateId, type Patient, type QueueItem, type User } from "@/db";
import { readQueueForToday } from "./queueReads";
import {
  queueManagement,
  QueuePermissionError,
  QueueValidationError,
} from "@/services/queueManagement";
import { useAuthStore } from "@/stores/auth";
import { useToast, type ToastTone } from "@/stores/toast";
import { recordStageEvent } from "@/services/stageEvents";
import { patientStatusFromQueue } from "@/services/patientStatus";
import { normalisePriority } from "@/services/queuePriority";
import type { QueueRow } from "@/services/queueTickets";
import {
  FLOW_STAGES,
  FLOW_STAGE_LABELS,
  type FlowStage,
} from "@/services/patientFlow";
import { isSupabaseEnabled } from "@/lib/supabaseClient";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { QueueSkeleton } from "@/components/ui/Skeleton";
import { Tabs } from "@/components/ui/Tabs";
import { panelId, tabId } from "@/components/ui/tabIds";
import {
  ArrowTopRightOnSquareIcon,
  CheckIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  PlayIcon,
  TicketIcon,
} from "@heroicons/react/20/solid";
import { QueueListIcon } from "@heroicons/react/24/outline";
import {
  canManageQueue,
  countByStage,
  formatWait,
  isFlowStage,
  longestWaitMinutes,
  minutesSince,
  nextStageOf,
  savedNote,
  splitStage,
  ticketLabel,
  ticketStateBadge,
} from "./queueBoardModel";
import { STAGE_MARKER_CLASS } from "./stageStyles";
import { useNow } from "./useNow";

/** The board lists this many waiting tickets; the full list is on /queue. */
const WAITING_LIMIT = 10;
/** Waits longer than this are flagged for the stage lead. */
const LONG_WAIT_MINUTES = 30;
const TABS_ID = "queue-board";

function PriorityBadge({ priority }: { priority?: QueueItem["priority"] }) {
  const p = normalisePriority(priority);
  if (p === "urgent") return <StatusBadge tone="danger">Urgent</StatusBadge>;
  if (p === "low") return <StatusBadge tone="neutral">Low priority</StatusBadge>;
  return null;
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

export default function QueueBoard() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const canManage = canManageQueue(currentUser?.role);
  const { push } = useToast();
  const [selectedStage, setSelectedStage] = useState<FlowStage>("vitals");
  const [busyId, setBusyId] = useState<string | null>(null);
  // Guards against a double click firing two writes before the button
  // re-renders as disabled.
  const busyRef = useRef(false);
  const [actionError, setActionError] = useState("");
  const now = useNow(30_000);

  // One live query drives every number on the board so counts never drift
  // from the lists.
  // Active rows and today's changes only, not the finished history.
  const allQueue = useLiveQuery(() => readQueueForToday(), []);
  const counts = useMemo(() => countByStage(allQueue ?? [], now), [allQueue, now]);
  // Urgent tickets still waiting, per stage. Priority is carried from stage
  // to stage, so urgent status stays visible after vitals and consultation.
  const urgentWaitingByStage = useMemo(() => {
    const map: Record<FlowStage, number> = {
      registration: 0,
      vitals: 0,
      consult: 0,
      pharmacy: 0,
    };
    for (const q of allQueue ?? []) {
      if (
        q.status === "waiting" &&
        isFlowStage(q.stage) &&
        normalisePriority(q.priority) === "urgent"
      ) {
        map[q.stage] += 1;
      }
    }
    return map;
  }, [allQueue]);
  const { waiting, inService } = useMemo(
    () => splitStage<QueueItem>(allQueue ?? [], selectedStage),
    [allQueue, selectedStage],
  );

  const patientIds = useMemo(
    () => [...new Set([...inService, ...waiting].map((q) => q.patientId))],
    [inService, waiting],
  );
  const patients = useLiveQuery(
    () => db.patients.bulkGet(patientIds),
    [patientIds.join(",")],
  );
  const patientById = useMemo(() => {
    const map = new Map<string, Patient>();
    (patients ?? []).forEach((p: Patient | undefined) => p && map.set(p.id, p));
    return map;
  }, [patients]);

  if (allQueue === undefined) {
    return (
      <div>
        <PageHeader title="Queue management" />
        <QueueSkeleton />
      </div>
    );
  }

  const stageLabel = FLOW_STAGE_LABELS[selectedStage];
  const nextStage = nextStageOf(selectedStage);
  const summary = counts[selectedStage];
  const longest = longestWaitMinutes(waiting, now);
  const nextUp = waiting[0];

  const patientName = (item: QueueItem) => {
    const p = patientById.get(item.patientId);
    if (p) return `${p.givenName} ${p.familyName}`;
    return patients === undefined ? "Loading name…" : "Unknown patient";
  };

  const notify = (tone: ToastTone, title: string, body?: string) =>
    push({ id: generateId(), tone, title, body });

  // Every write checks the session and the role here, not only by hiding
  // the buttons.
  const run = async (id: string, fn: (user: User) => Promise<void>) => {
    if (busyRef.current) return;
    if (!currentUser) {
      setActionError("Your session has ended. Sign in again to change the queue.");
      return;
    }
    if (!canManageQueue(currentUser.role)) {
      setActionError("Your role can view the queue but cannot call or finish tickets.");
      return;
    }
    busyRef.current = true;
    setBusyId(id);
    setActionError("");
    try {
      await fn(currentUser);
    } catch (err) {
      console.error(
        "Queue board action failed:",
        err instanceof Error ? err.name : err,
      );
      setActionError(
        err instanceof QueuePermissionError || err instanceof QueueValidationError
          ? `${err.message} Nothing was changed.`
          : "That change may not have been saved. Check the queue below before trying again.",
      );
    } finally {
      busyRef.current = false;
      setBusyId(null);
    }
  };

  const callNext = () => {
    if (!nextUp || inService.length > 0) return;
    const item = nextUp;
    const label = ticketLabel(item);
    return run(item.id, async (user) => {
      await queueManagement.startService(item.id, {
        id: user.id,
        name: user.fullName,
      });
      await recordStageEvent({
        stage: item.stage,
        kind: "start",
        patientId: item.patientId,
        actorId: user.id,
      });
      notify("success", `${label} called to ${stageLabel}`, savedNote(isSupabaseEnabled));
    });
  };

  const sendOn = (item: QueueItem) => {
    const label = ticketLabel(item);
    return run(item.id, async (user) => {
      await queueManagement.moveToNextStage(item.patientId);
      await recordStageEvent({
        stage: item.stage,
        kind: "finish",
        patientId: item.patientId,
        actorId: user.id,
      });
      notify(
        "success",
        nextStage
          ? `${label} sent to ${FLOW_STAGE_LABELS[nextStage]}`
          : `${label}: visit finished`,
        savedNote(isSupabaseEnabled),
      );
    });
  };

  const endHere = (item: QueueItem) => {
    const label = ticketLabel(item);
    return run(item.id, async (user) => {
      await queueManagement.completeService(item.id);
      await recordStageEvent({
        stage: item.stage,
        kind: "finish",
        patientId: item.patientId,
        actorId: user.id,
      });
      notify(
        "success",
        `${label} ended at ${stageLabel}`,
        `Not added to another queue. ${savedNote(isSupabaseEnabled)}`,
      );
    });
  };

  const callBlockedReason = !canManage
    ? ""
    : inService.length > 0
      ? `Finish ${ticketLabel(inService[0])} before calling the next ticket.`
      : "";

  return (
    <div>
      <PageHeader
        title="Queue management"
        description="Call the next ticket, then send it on when this stage is finished."
        actions={
          <>
            {canManage && (
              <Link to="/tickets/issue" className="btn-secondary">
                <TicketIcon className="h-4 w-4" aria-hidden />
                Issue ticket
              </Link>
            )}
            <Link
              to="/display"
              target="_blank"
              rel="noopener"
              className="btn-secondary"
            >
              <ArrowTopRightOnSquareIcon className="h-4 w-4" aria-hidden />
              Waiting-room display
              <span className="sr-only"> (opens in a new tab)</span>
            </Link>
          </>
        }
      />

      <Tabs
        tabs={FLOW_STAGES.map((s) => ({
          id: s,
          label: (
            <span className="inline-flex items-center gap-2">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${STAGE_MARKER_CLASS[s]}`}
                aria-hidden
              />
              {FLOW_STAGE_LABELS[s]}
              {urgentWaitingByStage[s] > 0 && (
                <span className="inline-flex items-center gap-0.5 text-caption font-semibold text-danger-fg">
                  <ExclamationTriangleIcon className="h-3.5 w-3.5" aria-hidden />
                  {urgentWaitingByStage[s]} urgent
                </span>
              )}
            </span>
          ),
          badge: counts[s].waiting + counts[s].inService,
        }))}
        active={selectedStage}
        onChange={(id) => {
          if (isFlowStage(id)) setSelectedStage(id);
        }}
        idPrefix={TABS_ID}
        label="Care stage"
      />

      <section
        role="tabpanel"
        id={panelId(TABS_ID, selectedStage)}
        aria-labelledby={tabId(TABS_ID, selectedStage)}
        className="mt-4 space-y-4"
      >
        {/* Real counts only: no estimated service times. */}
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line lg:grid-cols-4">
          <div className="bg-surface px-4 py-3">
            <dt className="text-caption text-ink-muted">Waiting</dt>
            <dd className="text-stat text-ink">{summary.waiting}</dd>
          </div>
          <div className="bg-surface px-4 py-3">
            <dt className="text-caption text-ink-muted">Being served</dt>
            <dd className="text-stat text-ink">{summary.inService}</dd>
          </div>
          <div className="bg-surface px-4 py-3">
            <dt className="text-caption text-ink-muted">Longest wait</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <span className="text-stat text-ink">
                {waiting.length > 0 ? formatWait(longest) : "None"}
              </span>
              {longest >= LONG_WAIT_MINUTES && (
                <StatusBadge tone="warning">Over {LONG_WAIT_MINUTES} min</StatusBadge>
              )}
            </dd>
          </div>
          <div className="bg-surface px-4 py-3">
            <dt className="text-caption text-ink-muted">Finished here today</dt>
            <dd className="text-stat text-ink">{summary.doneToday}</dd>
          </div>
        </dl>

        {!canManage && (
          <div className="banner banner-info" role="status">
            <InformationCircleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <span>
              You can view the queue. Calling and finishing tickets needs
              registration access; ask a nurse, doctor or administrator.
            </span>
          </div>
        )}

        {actionError && (
          <div className="banner banner-danger" role="alert">
            <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <span>{actionError}</span>
          </div>
        )}

        {/* Now serving */}
        <div className="panel">
          <div className="panel-header flex-wrap">
            <h2 className="panel-title">Now serving · {stageLabel}</h2>
            {canManage && nextUp && (
              <button
                type="button"
                onClick={callNext}
                disabled={busyId !== null || inService.length > 0}
                aria-describedby={callBlockedReason ? "queue-board-call-hint" : undefined}
                className="btn-primary"
              >
                <PlayIcon className="h-4 w-4" aria-hidden />
                Call {ticketLabel(nextUp)}
              </button>
            )}
          </div>
          {callBlockedReason && nextUp && (
            <p id="queue-board-call-hint" className="px-4 pt-3 field-hint">
              {callBlockedReason}
            </p>
          )}

          {inService.length === 0 ? (
            <p className="panel-body text-body text-ink-muted">
              Nobody is being served at {stageLabel.toLowerCase()}.
              {nextUp && canManage ? ` Call ${ticketLabel(nextUp)} when you are ready.` : ""}
            </p>
          ) : (
            <>
              <ul className="divide-y divide-line">
                {inService.map((item) => {
                  const label = ticketLabel(item);
                  const status = patientStatusFromQueue(item);
                  return (
                    <li
                      key={item.id}
                      className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center"
                    >
                      <span className="w-24 shrink-0 font-mono text-h2 text-ink">
                        {label}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <Link
                            to={`/patients/${item.patientId}`}
                            className="truncate text-h3 text-ink hover:underline"
                          >
                            {patientName(item)}
                          </Link>
                          <span className={`badge ${status.classes}`}>{status.label}</span>
                          <PriorityBadge priority={item.priority} />
                          <TicketState row={item} />
                        </span>
                        <span className="block text-caption text-ink-muted">
                          Being served for {formatWait(minutesSince(item.updatedAt, now))}
                          {item.assignedName ? ` · called by ${item.assignedName}` : ""}
                        </span>
                      </span>
                      {canManage && (
                        <span className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => sendOn(item)}
                            disabled={busyId !== null}
                            className="btn-primary"
                          >
                            <CheckIcon className="h-4 w-4" aria-hidden />
                            {busyId === item.id
                              ? "Saving…"
                              : nextStage
                                ? `Send to ${FLOW_STAGE_LABELS[nextStage]}`
                                : "Finish visit"}
                          </button>
                          <button
                            type="button"
                            onClick={() => endHere(item)}
                            disabled={busyId !== null}
                            aria-label={`End here: ${label} at ${stageLabel}, not sent on`}
                            className="btn-secondary"
                          >
                            End here
                          </button>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
              {canManage && (
                <p className="border-t border-line px-4 py-2 field-hint">
                  {nextStage
                    ? `Send to ${FLOW_STAGE_LABELS[nextStage]} adds the ticket to that queue. `
                    : "Finish visit closes the patient's visit. "}
                  End here marks the ticket done at {stageLabel.toLowerCase()}{" "}
                  without adding it to another queue.
                </p>
              )}
            </>
          )}
        </div>

        {/* Waiting */}
        <div className="panel">
          <div className="panel-header">
            <h2 className="panel-title">Waiting ({waiting.length})</h2>
            <span className="flex flex-wrap items-center gap-2">
              {urgentWaitingByStage[selectedStage] > 0 && (
                <StatusBadge tone="danger">
                  {urgentWaitingByStage[selectedStage]} urgent
                </StatusBadge>
              )}
              {waiting.length > 0 && (
                <span className="text-caption text-ink-muted">
                  Longest wait {formatWait(longest)}
                </span>
              )}
            </span>
          </div>

          {waiting.length === 0 ? (
            <EmptyState
              icon={QueueListIcon}
              title={`No one waiting for ${stageLabel.toLowerCase()}`}
              description={
                summary.doneToday > 0
                  ? `${summary.doneToday} ticket${summary.doneToday === 1 ? "" : "s"} finished this stage today.`
                  : "Tickets appear here when they are issued or sent on from the previous stage."
              }
            />
          ) : (
            <>
              {/* Tablet / desktop table */}
              <table className="data-table hidden md:table">
                <thead>
                  <tr>
                    <th scope="col" className="w-12">
                      <span aria-hidden>#</span>
                      <span className="sr-only">Place in line</span>
                    </th>
                    <th scope="col">Ticket</th>
                    <th scope="col">Patient</th>
                    <th scope="col">Status</th>
                    <th scope="col">Priority</th>
                    <th scope="col">Waiting</th>
                  </tr>
                </thead>
                <tbody>
                  {waiting.slice(0, WAITING_LIMIT).map((item, index) => {
                    const mins = minutesSince(item.queuedAt ?? item.updatedAt, now);
                    const status = patientStatusFromQueue(item);
                    return (
                      <tr key={item.id}>
                        <td className="tabular-nums text-ink-muted">{index + 1}</td>
                        <td>
                          <span className="font-mono">{ticketLabel(item)}</span>
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
                          <span className={`badge ${status.classes}`}>{status.label}</span>
                        </td>
                        <td>
                          {normalisePriority(item.priority) !== "normal" ? (
                            <PriorityBadge priority={item.priority} />
                          ) : (
                            <span className="text-ink-muted">Normal</span>
                          )}
                        </td>
                        <td>
                          {mins >= LONG_WAIT_MINUTES ? (
                            <StatusBadge tone="warning">{formatWait(mins)}</StatusBadge>
                          ) : (
                            <span className="text-ink-secondary">{formatWait(mins)}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Phone list */}
              <ol className="divide-y divide-line md:hidden">
                {waiting.slice(0, WAITING_LIMIT).map((item) => {
                  const mins = minutesSince(item.queuedAt ?? item.updatedAt, now);
                  return (
                    <li key={item.id} className="flex items-start gap-3 px-4 py-3">
                      <span className="w-16 shrink-0 font-mono text-label text-ink">
                        {ticketLabel(item)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <Link
                          to={`/patients/${item.patientId}`}
                          className="flex min-h-touch-target items-center font-medium text-ink hover:underline"
                        >
                          <span className="truncate">{patientName(item)}</span>
                        </Link>
                        <span className="mt-1 flex flex-wrap items-center gap-2 text-caption text-ink-muted">
                          {mins >= LONG_WAIT_MINUTES ? (
                            <StatusBadge tone="warning">Waiting {formatWait(mins)}</StatusBadge>
                          ) : (
                            <span>Waiting {formatWait(mins)}</span>
                          )}
                          <PriorityBadge priority={item.priority} />
                          <TicketState row={item} />
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ol>

              {waiting.length > WAITING_LIMIT && (
                <p className="border-t border-line px-4 py-3 text-caption text-ink-muted">
                  Showing the first {WAITING_LIMIT} of {waiting.length}.{" "}
                  <Link to="/queue" className="font-medium text-primary-fg hover:underline">
                    See the full queue
                  </Link>
                </p>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
