import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type Patient, type QueueItem } from "@/db";
import { useAuthStore } from "@/stores/auth";
import {
  canManageQueue,
  ticketLabel,
  ticketStateBadge,
} from "@/features/tickets/queueBoardModel";
import type { QueueRow } from "@/services/queueTickets";
import { isSupabaseEnabled } from "@/lib/supabaseClient";
import { recordStageEvent } from "@/services/stageEvents";
import {
  queueManagement,
  QueuePermissionError,
  QueueValidationError,
} from "@/services/queueManagement";
import { compareWaiting, normalisePriority } from "@/services/queuePriority";
import { patientStatusFromQueue } from "@/services/patientStatus";
import { FLOW_STAGE_LABELS } from "@/services/patientFlow";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { QueueSkeleton } from "@/components/ui/Skeleton";
import { formatTime } from "@/utils/dateFormat";
import {
  PlayIcon,
  CheckIcon,
  UserGroupIcon,
  ArrowRightIcon,
} from "@heroicons/react/20/solid";

const STAGES = ["registration", "vitals", "consult", "pharmacy"] as const;
type Stage = (typeof STAGES)[number];


// Stage colour marks workflow position only; it never fills a card.
const STAGE_MARKER: Record<Stage, string> = {
  registration: "bg-stage-registration",
  vitals: "bg-stage-vitals",
  consult: "bg-stage-consult",
  pharmacy: "bg-stage-pharmacy",
};

/**
 * Fixed planning assumption for the rough wait estimate. It is not measured
 * from this clinic's service times, and the UI says so.
 */
const ASSUMED_MINUTES_PER_PATIENT = 4;

interface StageMetrics {
  stage: Stage;
  waiting: number;
  urgentWaiting: number;
  inProgress: number;
  etaMinutes: number;
}

/** Urgent status in text and icon (never colour alone); nothing for other priorities. */
function UrgentBadge({ priority }: { priority?: QueueItem["priority"] }) {
  return normalisePriority(priority) === "urgent" ? (
    <StatusBadge tone="danger">Urgent</StatusBadge>
  ) : null;
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

function nextStageOf(stage: Stage): Stage | null {
  const i = STAGES.indexOf(stage);
  return i < STAGES.length - 1 ? STAGES[i + 1] : null;
}

export function EnhancedQueueBoard() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const [selectedStage, setSelectedStage] = useState<Stage>("registration");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [announcement, setAnnouncement] = useState("");

  const queueItems = useLiveQuery(() => db.queue.orderBy("position").toArray(), []);

  const activeItems = useMemo(
    () => (queueItems ?? []).filter((item) => item.status !== "done"),
    [queueItems],
  );
  const patientIds = useMemo(
    () => [...new Set(activeItems.map((item) => item.patientId))],
    [activeItems],
  );
  const patients = useLiveQuery(
    () => db.patients.bulkGet(patientIds),
    [patientIds.join(",")],
  );
  const patientMap = useMemo(() => {
    const map = new Map<string, Patient>();
    (patients ?? []).forEach((p) => p && map.set(p.id, p));
    return map;
  }, [patients]);

  const stageMetrics: StageMetrics[] = useMemo(
    () =>
      STAGES.map((stage) => {
        const stageItems = activeItems.filter((item) => item.stage === stage);
        const waiting = stageItems.filter((i) => i.status === "waiting").length;
        const urgentWaiting = stageItems.filter(
          (i) => i.status === "waiting" && normalisePriority(i.priority) === "urgent",
        ).length;
        const inProgress = stageItems.filter((i) => i.status === "in_progress").length;
        return {
          stage,
          waiting,
          urgentWaiting,
          inProgress,
          etaMinutes: waiting * ASSUMED_MINUTES_PER_PATIENT,
        };
      }),
    [activeItems],
  );

  // Moving patients through the queue is front-desk logistics: the same
  // rule as the Queue page and the ticket board (canManageQueue). Clinical
  // work at each stage is permission-checked on its own screen.
  const canActOn = (_stage: Stage) => canManageQueue(currentUser?.role);

  const patientName = (item: QueueItem) => {
    const p = patientMap.get(item.patientId);
    return p ? `${p.givenName} ${p.familyName}` : "Unknown patient";
  };

  const run = async (done: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    setActionError("");
    setAnnouncement("");
    try {
      await fn();
      setAnnouncement(done);
    } catch (error) {
      console.error(
        "Queue action failed:",
        error instanceof Error ? error.name : error,
      );
      setActionError(
        error instanceof QueuePermissionError || error instanceof QueueValidationError
          ? `${error.message} Nothing was changed.`
          : "That change was not saved. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const callNext = (stage: Stage) => {
    if (!canActOn(stage)) {
      setActionError("Your role can view the queue but cannot call or move patients.");
      return;
    }
    const nextItem = activeItems
      .filter((item) => item.stage === stage && item.status === "waiting")
      .sort(compareWaiting)[0];
    if (!nextItem) return;
    void run(`${patientName(nextItem)} called to ${FLOW_STAGE_LABELS[stage].toLowerCase()}.`, async () => {
      await queueManagement.startService(
        nextItem.id,
        currentUser ? { id: currentUser.id, name: currentUser.fullName } : undefined,
      );
      await recordStageEvent({
        stage,
        kind: "start",
        patientId: nextItem.patientId,
        actorId: currentUser?.id,
      });
    });
  };

  /**
   * sendOn: move the patient to the next stage (or, at pharmacy, finish the
   * visit). Otherwise the patient leaves the queue at this stage.
   */
  const finish = (stage: Stage, item: QueueItem, sendOn: boolean) => {
    if (!canActOn(stage)) {
      setActionError("Your role can view the queue but cannot call or move patients.");
      return;
    }
    const next = nextStageOf(stage);
    const name = patientName(item);
    const message = sendOn
      ? next
        ? `${name} sent to ${FLOW_STAGE_LABELS[next].toLowerCase()}.`
        : `${name}'s visit finished.`
      : `${name} marked done at ${FLOW_STAGE_LABELS[stage].toLowerCase()}.`;
    void run(message, async () => {
      if (sendOn) {
        await queueManagement.moveToNextStage(item.patientId);
      } else {
        await queueManagement.completeService(item.id);
      }
      await recordStageEvent({
        stage,
        kind: "finish",
        patientId: item.patientId,
        actorId: currentUser?.id,
      });
    });
  };

  if (queueItems === undefined) {
    return (
      <section aria-labelledby="queue-board-title" className="space-y-3">
        <h2 id="queue-board-title" className="text-h2 text-ink">
          Queue by stage
        </h2>
        <QueueSkeleton rows={3} />
      </section>
    );
  }

  const selectedMetrics = stageMetrics.find((m) => m.stage === selectedStage);
  const nextStage = nextStageOf(selectedStage);
  const currentPatient = activeItems.find(
    (item) => item.stage === selectedStage && item.status === "in_progress",
  );
  const waitingPatients = activeItems
    .filter((item) => item.stage === selectedStage && item.status === "waiting")
    .sort(compareWaiting);
  const allowed = canActOn(selectedStage);
  const stageName = FLOW_STAGE_LABELS[selectedStage];

  return (
    <section aria-labelledby="queue-board-title" className="space-y-3">
      <div>
        <h2 id="queue-board-title" className="text-h2 text-ink">
          Queue by stage
        </h2>
        <p className="text-body text-ink-muted">
          Who is waiting and who is being seen, from the queue on this device.
        </p>
      </div>

      {/* Stage overview doubles as the stage picker */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4" role="group" aria-label="Choose a stage">
        {stageMetrics.map((metrics) => {
          const isSelected = selectedStage === metrics.stage;
          return (
            <button
              key={metrics.stage}
              type="button"
              onClick={() => setSelectedStage(metrics.stage)}
              aria-pressed={isSelected}
              className={`relative min-h-touch-target overflow-hidden rounded-lg border bg-surface px-4 py-3 text-left transition-colors ${
                isSelected
                  ? "border-primary ring-1 ring-primary"
                  : "border-line hover:border-line-strong"
              }`}
            >
              <span className={`absolute inset-y-0 left-0 w-1 ${STAGE_MARKER[metrics.stage]}`} aria-hidden />
              <span className="block text-label text-ink">{FLOW_STAGE_LABELS[metrics.stage]}</span>
              <span className="mt-1 flex items-baseline gap-1.5">
                <span className="text-stat tabular-nums text-ink">{metrics.waiting}</span>
                <span className="text-caption text-ink-muted">waiting</span>
              </span>
              <span className="block text-caption text-ink-muted">
                {metrics.inProgress} being seen
                {metrics.etaMinutes > 0 ? ` · about ${metrics.etaMinutes} min` : ""}
              </span>
              {metrics.urgentWaiting > 0 && (
                <StatusBadge tone="danger" className="mt-1">
                  {metrics.urgentWaiting} urgent waiting
                </StatusBadge>
              )}
            </button>
          );
        })}
      </div>
      <p className="text-caption text-ink-muted">
        Wait estimates assume about {ASSUMED_MINUTES_PER_PATIENT} minutes per
        patient. They are not measured, so treat them as a rough guide.
      </p>

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      {actionError && (
        <div className="banner banner-danger" role="alert">
          {actionError}
        </div>
      )}

      <div className="panel">
        <div className="panel-header flex-wrap">
          <h3 className="panel-title">{stageName}</h3>
          <p className="text-caption tabular-nums text-ink-muted">
            {selectedMetrics?.waiting ?? 0} waiting · {selectedMetrics?.inProgress ?? 0} being seen
          </p>
        </div>

        {/* Now serving */}
        <div className="border-b border-line px-4 py-3">
          <p className="section-label mb-2">Now serving</p>
          {currentPatient ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <span className="w-16 shrink-0 font-mono text-h3 text-ink">
                {ticketLabel(currentPatient)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to={`/patients/${currentPatient.patientId}`}
                    className="truncate text-h3 text-ink hover:underline"
                  >
                    {patientName(currentPatient)}
                  </Link>
                  {(() => {
                    const s = patientStatusFromQueue(currentPatient);
                    return <span className={`badge ${s.classes}`}>{s.label}</span>;
                  })()}
                  <UrgentBadge priority={currentPatient.priority} />
                  <TicketState row={currentPatient} />
                </div>
                <p className="text-caption text-ink-muted">
                  Called at {formatTime(currentPatient.updatedAt)}
                  {currentPatient.assignedName ? ` · with ${currentPatient.assignedName}` : ""}
                </p>
              </div>
              {allowed && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => finish(selectedStage, currentPatient, true)}
                    disabled={busy}
                    className="btn-primary"
                  >
                    {nextStage ? (
                      <>
                        <ArrowRightIcon className="h-4 w-4" aria-hidden />
                        Send to {FLOW_STAGE_LABELS[nextStage]}
                      </>
                    ) : (
                      <>
                        <CheckIcon className="h-4 w-4" aria-hidden />
                        Finish visit
                      </>
                    )}
                  </button>
                  {nextStage && (
                    <button
                      type="button"
                      onClick={() => finish(selectedStage, currentPatient, false)}
                      disabled={busy}
                      className="btn-secondary"
                      aria-describedby="mark-done-hint"
                    >
                      <CheckIcon className="h-4 w-4" aria-hidden />
                      Mark done here
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-body text-ink-muted">Nobody is being seen at this stage.</p>
              {waitingPatients.length > 0 && allowed && (
                <button
                  type="button"
                  onClick={() => callNext(selectedStage)}
                  disabled={busy}
                  className="btn-primary"
                >
                  <PlayIcon className="h-4 w-4" aria-hidden />
                  Call {waitingPatients[0].ticketNumber ?? "next patient"}
                </button>
              )}
            </div>
          )}
          {currentPatient && allowed && nextStage && (
            <p id="mark-done-hint" className="field-hint">
              Mark done here removes the patient from the queue without sending
              them to {FLOW_STAGE_LABELS[nextStage].toLowerCase()}.
            </p>
          )}
          {!allowed && (
            <p className="field-hint">
              Your role can view this stage but not call or move patients here.
            </p>
          )}
        </div>

        {/* Waiting */}
        <div>
          <p className="section-label px-4 pt-3">Waiting ({waitingPatients.length})</p>
          {waitingPatients.length === 0 ? (
            <EmptyState
              icon={UserGroupIcon}
              title={`No one waiting for ${stageName.toLowerCase()}`}
              description="Patients appear here when they are sent from the previous stage."
            />
          ) : (
            <ol className="divide-y divide-line">
              {waitingPatients.slice(0, 10).map((item, index) => {
                const s = patientStatusFromQueue(item);
                return (
                  <li key={item.id} className="flex items-center gap-3 px-4 py-3">
                    <span className="w-16 shrink-0 font-mono text-body text-ink">
                      {ticketLabel(item)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          to={`/patients/${item.patientId}`}
                          className="truncate font-medium text-ink hover:underline"
                        >
                          {patientName(item)}
                        </Link>
                        <span className={`badge ${s.classes}`}>{s.label}</span>
                        <UrgentBadge priority={item.priority} />
                        <TicketState row={item} />
                      </div>
                      <p className="text-caption text-ink-muted">
                        Position {item.position} · queued at{" "}
                        {formatTime(item.queuedAt ?? item.updatedAt)}
                      </p>
                    </div>
                    <span className="shrink-0 text-caption text-ink-muted">
                      {index === 0
                        ? "Next"
                        : `about ${index * ASSUMED_MINUTES_PER_PATIENT} min`}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
          {waitingPatients.length > 10 && (
            <p className="border-t border-line px-4 py-2 text-caption text-ink-muted">
              And {waitingPatients.length - 10} more.{" "}
              <Link to="/queue" className="text-primary-fg hover:underline">
                Open the full queue
              </Link>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
