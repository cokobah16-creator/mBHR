import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/stores/toast";
import { can } from "@/auth/roles";
import { queueManagement } from "@/services/queueManagement";
import { recordStageEvent } from "@/services/stageEvents";
import { isSupabaseEnabled } from "@/lib/supabaseClient";
import {
  gamificationDb,
  type GameAttempt,
  generateGameId,
  calculateTokens,
  updateWallet,
  checkBadgeEligibility,
} from "@/db/gamification";
import { db, generateId, type QueueItem } from "@/db";
import { formatTime } from "@/utils/dateFormat";
import {
  CheckIcon,
  ClockIcon,
  ExclamationCircleIcon,
  InformationCircleIcon,
  MegaphoneIcon,
  PlayIcon,
  QueueListIcon,
} from "@heroicons/react/24/outline";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { TrainingModeFrame } from "@/components/training/TrainingModeFrame";
import { ScoringRules, TrainingStat } from "@/components/training/TrainingWidgets";
import {
  QUEUE_MAESTRO,
  QUEUE_STAGE_LABELS,
  QUEUE_STAGE_PERMISSION,
  badgeLabel,
  calledPatientOutcome,
  minutesBetween,
  multiplierText,
  queueMaestroScore,
  type QueueStageName,
} from "@/components/training/trainingRules";

const STAGES = ["registration", "vitals", "consult", "pharmacy"] as const;
type Stage = QueueStageName;

interface QueueMaestroProps {
  onComplete?: (tokens: number, badges: string[]) => void;
  onCancel?: () => void;
}

/** What the quest stores in its attempt's payloadJson. */
interface QuestPayload {
  stage: Stage;
  startedAt: string;
  patientsProcessed: number;
  /** Minutes, summed over counted patients. */
  totalServiceTime: number;
  /** The patient this player called and is seeing now, if any. */
  current?: { queueItemId: string; ticket: string; calledAt: string } | null;
}

interface QuestResult {
  patients: number;
  averageMinutes: number;
  tokens: number;
  badges: string[];
  stillServing?: string;
}

function parsePayload(attempt: GameAttempt | null): QuestPayload | null {
  if (!attempt) return null;
  try {
    return JSON.parse(attempt.payloadJson) as QuestPayload;
  } catch {
    return null;
  }
}

const labelForItem = (q: QueueItem) =>
  q.ticketNumber ?? `#${q.position.toString().padStart(3, "0")}`;

const savedNote = isSupabaseEnabled
  ? "Saved on this device. Waiting to sync."
  : "Saved on this device.";

export default function QueueMaestro({ onComplete, onCancel }: QueueMaestroProps) {
  const currentUser = useAuthStore((s) => s.currentUser);
  const { push } = useToast();
  const [selectedStage, setSelectedStage] = useState<Stage>("registration");
  const [currentAttempt, setCurrentAttempt] = useState<GameAttempt | null>(null);
  const [attemptLoaded, setAttemptLoaded] = useState(false);
  const [busy, setBusy] = useState<"start" | "call" | "complete" | "cancel" | "release" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [lastResult, setLastResult] = useState<QuestResult | null>(null);
  const recordingRef = useRef(false);

  // One live query over the whole queue drives the stage counts, the
  // waiting list and the called patient's status.
  const allQueue = useLiveQuery(() => db.queue.toArray(), []);

  const payload = useMemo(() => parsePayload(currentAttempt), [currentAttempt]);
  // While a quest runs, its stage is fixed.
  const stage: Stage = payload?.stage ?? selectedStage;
  const stageLabel = QUEUE_STAGE_LABELS[stage];

  const waiting = useMemo(
    () =>
      (allQueue ?? [])
        .filter((q) => q.stage === stage && q.status === "waiting")
        .sort((a, b) => a.position - b.position),
    [allQueue, stage],
  );
  const current = payload?.current ?? null;
  const trackedRow = current
    ? (allQueue ?? []).find((q) => q.id === current.queueItemId)
    : undefined;
  // Passing calledAt stops a live-query snapshot taken just before the call
  // (row still "waiting") from being read as "put back in the waiting list".
  const outcome =
    current && allQueue ? calledPatientOutcome(trackedRow, current.calledAt) : null;
  const othersServing = (allQueue ?? []).filter(
    (q) =>
      q.stage === stage &&
      q.status === "in_progress" &&
      q.id !== current?.queueItemId,
  ).length;

  const role = currentUser?.role;
  const canWorkStage = (s: Stage) =>
    !!role && can(role, QUEUE_STAGE_PERMISSION[s]);

  const loadCurrentAttempt = useCallback(async () => {
    if (!currentUser) return;
    try {
      const attempt = await gamificationDb.game_attempts
        .where("actorId")
        .equals(currentUser.id)
        .and(
          (a) => a.taskCode === "queue_maestro" && a.status === "in_progress",
        )
        .first();
      setCurrentAttempt(attempt || null);
    } catch (err) {
      console.error(
        "Error loading current attempt:",
        err instanceof Error ? err.name : err,
      );
      setError("Your quest could not be read from this device.");
    } finally {
      setAttemptLoaded(true);
    }
  }, [currentUser]);

  useEffect(() => {
    void loadCurrentAttempt();
  }, [loadCurrentAttempt]);

  const savePayload = useCallback(
    async (attempt: GameAttempt, next: QuestPayload) => {
      await gamificationDb.game_attempts.update(attempt.id, {
        payloadJson: JSON.stringify(next),
        _dirty: 1,
      });
      const updated = await gamificationDb.game_attempts.get(attempt.id);
      setCurrentAttempt(updated || null);
    },
    [],
  );

  // Count the called patient once their stage is finished anywhere in the
  // app (vitals form, consultation, queue board). Service time is real:
  // from when they were called here to when their queue row was finished.
  useEffect(() => {
    if (!currentAttempt || !payload || !current || !outcome) return;
    if (outcome === "serving" || recordingRef.current) return;
    recordingRef.current = true;
    const run = async () => {
      try {
        if (outcome === "finished") {
          const minutes = minutesBetween(
            current.calledAt,
            trackedRow?.updatedAt ?? new Date(),
          );
          await savePayload(currentAttempt, {
            ...payload,
            patientsProcessed: payload.patientsProcessed + 1,
            totalServiceTime: payload.totalServiceTime + minutes,
            current: null,
          });
          setNotice(
            `${current.ticket} finished at ${QUEUE_STAGE_LABELS[payload.stage]} after ${minutes} min. Counted.`,
          );
        } else {
          await savePayload(currentAttempt, { ...payload, current: null });
          setNotice(
            outcome === "returned"
              ? `${current.ticket} was put back in the waiting list, so it is not counted.`
              : `${current.ticket} is no longer in the queue on this device, so it is not counted.`,
          );
        }
      } catch (err) {
        console.error(
          "Error updating quest progress:",
          err instanceof Error ? err.name : err,
        );
        setError("Your quest progress could not be saved on this device.");
      } finally {
        recordingRef.current = false;
      }
    };
    void run();
  }, [currentAttempt, payload, current, outcome, trackedRow, savePayload]);

  const startQuest = async () => {
    if (!currentUser || currentAttempt || busy) return;
    if (!canWorkStage(selectedStage)) {
      setError(
        `You need ${QUEUE_STAGE_PERMISSION[selectedStage]} permission to call patients at ${QUEUE_STAGE_LABELS[selectedStage]}.`,
      );
      return;
    }
    setBusy("start");
    setError("");
    setNotice("");
    try {
      const now = new Date().toISOString();
      const initial: QuestPayload = {
        stage: selectedStage,
        startedAt: now,
        patientsProcessed: 0,
        totalServiceTime: 0,
        current: null,
      };
      const attempt: GameAttempt = {
        id: generateGameId(),
        taskCode: "queue_maestro",
        actorId: currentUser.id,
        payloadJson: JSON.stringify(initial),
        startedAt: now,
        status: "in_progress",
        _dirty: 1,
      };
      await gamificationDb.game_attempts.add(attempt);
      setCurrentAttempt(attempt);
      setLastResult(null);
    } catch (err) {
      console.error(
        "Error starting quest:",
        err instanceof Error ? err.name : err,
      );
      setError("The quest could not start because this device could not save it. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const callNextPatient = async () => {
    if (!currentAttempt || !payload || !currentUser || busy || current) return;
    if (!canWorkStage(payload.stage)) {
      setError(
        `You need ${QUEUE_STAGE_PERMISSION[payload.stage]} permission to call patients at ${stageLabel}.`,
      );
      return;
    }
    const next = waiting[0];
    if (!next) {
      setError(`No patients are waiting at ${stageLabel}.`);
      return;
    }
    const ticket = labelForItem(next);
    setBusy("call");
    setError("");
    setNotice("");
    try {
      await queueManagement.startService(next.id, {
        id: currentUser.id,
        name: currentUser.fullName,
      });
    } catch (err) {
      console.error(
        "Error calling next patient:",
        err instanceof Error ? err.name : err,
      );
      setError("The next patient could not be called. The queue was not changed.");
      setBusy(null);
      return;
    }
    await recordStageEvent({
      stage: next.stage,
      kind: "start",
      patientId: next.patientId,
      actorId: currentUser.id,
    });
    push({
      id: generateId(),
      tone: "success",
      title: `${ticket} called to ${stageLabel}`,
      body: savedNote,
    });
    try {
      await savePayload(currentAttempt, {
        ...payload,
        current: {
          queueItemId: next.id,
          ticket,
          calledAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      console.error(
        "Error saving called patient:",
        err instanceof Error ? err.name : err,
      );
      setError(
        `${ticket} is marked as being seen in the queue, but this quest could not record it. Finish ${ticket} as usual.`,
      );
    } finally {
      setBusy(null);
    }
  };

  const releaseCurrent = async () => {
    if (!currentAttempt || !payload || !current || busy) return;
    setBusy("release");
    setError("");
    try {
      await savePayload(currentAttempt, { ...payload, current: null });
      setNotice(
        `${current.ticket} is no longer counted in this quest. They are still marked as being seen at ${stageLabel} in the queue.`,
      );
    } catch (err) {
      console.error(
        "Error releasing patient from quest:",
        err instanceof Error ? err.name : err,
      );
      setError("That change could not be saved on this device. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const completeQuest = async () => {
    if (!currentAttempt || !currentUser || !payload || busy) return;
    setBusy("complete");
    setError("");
    try {
      const finishedAt = new Date().toISOString();
      const score = queueMaestroScore(
        payload.patientsProcessed,
        payload.totalServiceTime,
      );

      // Get user's current streak for streak bonus
      const wallet = await gamificationDb.wallets.get(currentUser.id);
      const streakDays = wallet?.streakDays || 0;

      const finalTokens = calculateTokens(score.baseTokens, {
        streak: streakDays,
        accuracy: 1.0,
        speedBonus: score.speedBonus,
        qualityBonus: score.volumeBonus,
      });

      await gamificationDb.game_attempts.update(currentAttempt.id, {
        finishedAt,
        status: "completed",
        score: Math.round(score.averageMinutes * 100) / 100, // Average service time as score
        tokens: finalTokens,
        multipliersJson: JSON.stringify({
          speedBonus: score.speedBonus,
          volumeBonus: score.volumeBonus,
          streakBonus: 1 + Math.min(streakDays, 5) * 0.1,
        }),
        _dirty: 1,
      });

      await updateWallet(currentUser.id, finalTokens, true);
      const newBadges = await checkBadgeEligibility(
        currentUser.id,
        "queue_maestro",
      );

      setCurrentAttempt(null);
      setNotice("");
      setLastResult({
        patients: payload.patientsProcessed,
        averageMinutes: score.averageMinutes,
        tokens: finalTokens,
        badges: newBadges,
        stillServing: current?.ticket,
      });
      push({
        id: generateId(),
        tone: "success",
        title: "Quest complete",
        body: `${finalTokens} tokens added to your quest wallet on this device.`,
      });
      onComplete?.(finalTokens, newBadges);
    } catch (err) {
      console.error(
        "Error completing quest:",
        err instanceof Error ? err.name : err,
      );
      setError("The quest could not be completed on this device. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const cancelQuest = async () => {
    if (!currentAttempt || !payload || busy) return;
    const serving = current?.ticket;
    const confirmed = window.confirm(
      `Cancel this quest? The ${payload.patientsProcessed} patients counted so far will not earn tokens.` +
        (serving
          ? ` ${serving} stays marked as being seen at ${stageLabel} in the queue.`
          : " The live queue is not changed."),
    );
    if (!confirmed) return;
    setBusy("cancel");
    setError("");
    try {
      await gamificationDb.game_attempts.delete(currentAttempt.id);
      setCurrentAttempt(null);
      setNotice("");
      push({
        id: generateId(),
        tone: "info",
        title: "Quest cancelled",
        body: serving
          ? `${serving} is still marked as being seen at ${stageLabel}. Finish or send them on from the patient queue.`
          : "The live queue was not changed.",
      });
      onCancel?.();
    } catch (err) {
      console.error(
        "Error canceling quest:",
        err instanceof Error ? err.name : err,
      );
      setError("The quest could not be cancelled on this device. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const average =
    payload && payload.patientsProcessed > 0
      ? payload.totalServiceTime / payload.patientsProcessed
      : null;

  const liveChanges = (
    <>
      Calling a patient here marks them as being seen by you in the live{" "}
      {stageLabel} queue, exactly like calling them from the queue board. You
      still do the real work and send them on in the usual screens; nothing
      here finishes a patient for you.
    </>
  );

  return (
    <TrainingModeFrame
      title="Queue Maestro"
      description="See patients from the live queue within the target time to earn quest tokens."
      liveChanges={liveChanges}
      actions={
        <Link to="/queue" className="btn-secondary">
          <QueueListIcon className="h-4 w-4" aria-hidden />
          Patient queue
        </Link>
      }
    >
      <div className="space-y-5">
        {error && (
          <div className="banner banner-danger" role="alert">
            <ExclamationCircleIcon className="h-5 w-5 shrink-0" aria-hidden />
            <p>{error}</p>
          </div>
        )}
        <div aria-live="polite">
          {notice && (
            <p className="banner banner-info">
              <InformationCircleIcon className="h-5 w-5 shrink-0" aria-hidden />
              {notice}
            </p>
          )}
        </div>

        {lastResult && (
          <section className="panel" aria-labelledby="maestro-result">
            <div className="panel-header">
              <h2 id="maestro-result" className="panel-title">
                Last quest
              </h2>
              <StatusBadge tone="success" icon>
                Complete
              </StatusBadge>
            </div>
            <div className="panel-body space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <TrainingStat label="Patients counted" value={lastResult.patients} />
                <TrainingStat
                  label="Average time"
                  value={`${lastResult.averageMinutes.toFixed(1)} min`}
                />
                <TrainingStat
                  label="Tokens"
                  value={lastResult.tokens}
                  hint="Added to your quest wallet"
                />
              </div>
              {lastResult.badges.length > 0 && (
                <p className="flex flex-wrap items-center gap-2 text-body text-ink">
                  New badges:
                  {lastResult.badges.map((b) => (
                    <StatusBadge key={b} tone="info">
                      {badgeLabel(b)}
                    </StatusBadge>
                  ))}
                </p>
              )}
              {lastResult.stillServing && (
                <p className="text-body text-ink-secondary">
                  {lastResult.stillServing} is still marked as being seen in the
                  queue and was not counted.
                </p>
              )}
            </div>
          </section>
        )}

        {currentAttempt && payload && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <TrainingStat label="Patients counted" value={payload.patientsProcessed} />
            <TrainingStat
              label="Average time"
              value={average === null ? "–" : `${average.toFixed(1)} min`}
            />
            <TrainingStat
              label="Target"
              value={`≤${QUEUE_MAESTRO.targetMinutes.toFixed(1)} min`}
              hint="Per patient, for the speed bonus"
            />
          </div>
        )}

        <section className="panel" aria-labelledby="maestro-stage">
          <div className="panel-header">
            <h2 id="maestro-stage" className="panel-title">
              Stage
            </h2>
            {currentAttempt && (
              <span className="text-caption text-ink-muted">
                Fixed while the quest runs
              </span>
            )}
          </div>
          <div className="panel-body">
            <div
              className="grid grid-cols-2 gap-3 md:grid-cols-4"
              role="group"
              aria-label="Choose a stage"
            >
              {STAGES.map((s) => {
                const count = (allQueue ?? []).filter(
                  (q) => q.stage === s && q.status !== "done",
                ).length;
                const permitted = canWorkStage(s);
                const isSelected = stage === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSelectedStage(s)}
                    disabled={!!currentAttempt || !permitted}
                    aria-pressed={isSelected}
                    className={`min-h-touch-target rounded-lg border p-4 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed ${
                      isSelected
                        ? "border-primary bg-primary-soft"
                        : "border-line bg-surface hover:bg-surface-hover"
                    } ${!permitted ? "opacity-60" : ""}`}
                  >
                    <span className="block text-h2 tabular-nums text-ink">{count}</span>
                    <span className="block text-label text-ink">
                      {QUEUE_STAGE_LABELS[s]}
                    </span>
                    <span className="block text-caption text-ink-muted">
                      {!permitted
                        ? `Needs ${QUEUE_STAGE_PERMISSION[s]} permission`
                        : isSelected
                          ? "Selected"
                          : "In the queue"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <section className="panel" aria-labelledby="maestro-quest">
          <div className="panel-header">
            <h2 id="maestro-quest" className="panel-title">
              Quest
            </h2>
            <span className="text-label text-ink-secondary">
              {QUEUE_MAESTRO.baseTokensPerPatient} base tokens per patient
            </span>
          </div>
          <div className="panel-body">
            {!attemptLoaded || allQueue === undefined ? (
              <p className="text-body text-ink-muted" role="status">
                Loading the queue…
              </p>
            ) : !currentAttempt ? (
              <div className="space-y-3">
                <p className="text-body text-ink-secondary">
                  Start a quest at {stageLabel}. {waiting.length} waiting.
                </p>
                <button
                  type="button"
                  onClick={() => void startQuest()}
                  disabled={
                    waiting.length === 0 || !canWorkStage(selectedStage) || busy !== null
                  }
                  className="btn-primary"
                >
                  <PlayIcon className="h-5 w-5" aria-hidden />
                  {busy === "start" ? "Starting…" : `Start quest at ${stageLabel}`}
                </button>
                {waiting.length === 0 && (
                  <p className="text-body text-ink-muted">
                    No patients waiting at {stageLabel}.
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {current ? (
                  <div className="rounded-lg border border-info-line bg-info-soft p-4 text-info-fg">
                    <p className="flex items-center gap-2 font-semibold">
                      <ClockIcon className="h-5 w-5 shrink-0" aria-hidden />
                      Now seeing {current.ticket}, called at{" "}
                      {formatTime(current.calledAt)}
                    </p>
                    <p className="mt-1 text-body">
                      Do the {stageLabel.toLowerCase()} work as usual. When{" "}
                      {current.ticket} is sent on or finished from the{" "}
                      {stageLabel.toLowerCase()} screen or the patient queue, it
                      is counted here automatically.
                    </p>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <Link to="/queue" className="btn-secondary">
                        <QueueListIcon className="h-4 w-4" aria-hidden />
                        Open patient queue
                      </Link>
                      <button
                        type="button"
                        onClick={() => void releaseCurrent()}
                        disabled={busy !== null}
                        className="btn-ghost"
                      >
                        Stop counting {current.ticket}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-body text-ink-secondary">
                    Ready for the next patient. {waiting.length} waiting at{" "}
                    {stageLabel}
                    {waiting[0] ? `; next is ${labelForItem(waiting[0])}.` : "."}
                  </p>
                )}

                {othersServing > 0 && (
                  <p className="text-caption text-ink-muted">
                    {othersServing} other {othersServing === 1 ? "patient is" : "patients are"}{" "}
                    being seen at {stageLabel} by other staff.
                  </p>
                )}

                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => void callNextPatient()}
                    disabled={waiting.length === 0 || !!current || busy !== null}
                    className="btn-primary sm:flex-1"
                  >
                    <MegaphoneIcon className="h-5 w-5" aria-hidden />
                    {busy === "call"
                      ? "Calling…"
                      : waiting[0]
                        ? `Call next patient (${labelForItem(waiting[0])})`
                        : "Call next patient"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void completeQuest()}
                    disabled={payload.patientsProcessed === 0 || busy !== null}
                    className="btn-secondary"
                  >
                    <CheckIcon className="h-5 w-5" aria-hidden />
                    {busy === "complete" ? "Completing…" : "Complete quest"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void cancelQuest()}
                    disabled={busy !== null}
                    className="btn-ghost text-danger-fg"
                  >
                    Cancel quest
                  </button>
                </div>
                {payload.patientsProcessed === 0 && (
                  <p className="text-caption text-ink-muted">
                    Complete quest becomes available after the first patient is
                    counted.
                  </p>
                )}
              </div>
            )}
          </div>
        </section>

        <ScoringRules>
          <li>
            Service time runs from when you call a patient here until their{" "}
            {stageLabel.toLowerCase()} stage is finished in the queue.
          </li>
          <li>
            {QUEUE_MAESTRO.baseTokensPerPatient} base tokens for each patient
            counted.
          </li>
          <li>
            Average of {QUEUE_MAESTRO.targetMinutes} minutes or less:{" "}
            {multiplierText(QUEUE_MAESTRO.fastBonus)}. Over{" "}
            {QUEUE_MAESTRO.slowMinutes} minutes:{" "}
            {multiplierText(QUEUE_MAESTRO.slowPenalty)}.
          </li>
          <li>
            {QUEUE_MAESTRO.volumeBonusAt} or more patients:{" "}
            {multiplierText(QUEUE_MAESTRO.volumeBonus)}.
          </li>
          <li>+10% for each day of your activity streak, up to +50%.</li>
          <li>
            Tokens go straight to your quest wallet on this device when you
            complete the quest.
          </li>
        </ScoringRules>

        <p className="flex items-start gap-2 text-caption text-ink-muted">
          <InformationCircleIcon className="h-4 w-4 shrink-0" aria-hidden />
          Speed never comes before care: take the time each patient needs.
        </p>
      </div>
    </TrainingModeFrame>
  );
}
