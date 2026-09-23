import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuthStore } from "@/stores/auth";
import { db, type GameSession } from "@/db";
import { GamificationService } from "@/services/gamification";
import {
  ArrowPathIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  HeartIcon,
  PlayIcon,
  UserIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { TrainingModeFrame } from "@/components/training/TrainingModeFrame";
import {
  RoundTimer,
  ScoringRules,
  SessionSaveStatus,
  TrainingStat,
} from "@/components/training/TrainingWidgets";
import {
  EMPTY_ROUND_STATS,
  VITALS_PRECISION,
  multiplierText,
  percent,
  recordAnswer,
  shuffled,
  vitalsPrecisionMultipliers,
  type RoundStats,
  type SaveState,
} from "@/components/training/trainingRules";
import { useCountdown } from "@/components/training/useCountdown";

interface VitalCase {
  id: string;
  patientAge: number;
  patientSex: "M" | "F";
  scenario: string;
  vitals: {
    hr?: number;
    temp?: number;
    sbp?: number;
    dbp?: number;
    rr?: number;
    spo2?: number;
  };
  normalRanges: {
    hr: [number, number];
    temp: [number, number];
    sbp: [number, number];
    dbp: [number, number];
    rr: [number, number];
    spo2: [number, number];
  };
}

type Metric = keyof VitalCase["normalRanges"];
type Answer = "normal" | "abnormal";

// Practice cases with age/sex-specific reference ranges. Made up; none is a
// real patient.
const VITAL_CASES: VitalCase[] = [
  {
    id: "1",
    patientAge: 35,
    patientSex: "M",
    scenario: "Adult male presenting with chest pain",
    vitals: { hr: 110, temp: 37.2, sbp: 150, dbp: 95, rr: 22, spo2: 97 },
    normalRanges: {
      hr: [60, 100],
      temp: [36.1, 37.2],
      sbp: [90, 140],
      dbp: [60, 90],
      rr: [12, 20],
      spo2: [95, 100],
    },
  },
  {
    id: "2",
    patientAge: 8,
    patientSex: "F",
    scenario: "Child with fever and cough",
    vitals: { hr: 130, temp: 39.1, sbp: 95, dbp: 60, rr: 28, spo2: 95 },
    normalRanges: {
      hr: [80, 120],
      temp: [36.1, 37.2],
      sbp: [85, 110],
      dbp: [50, 70],
      rr: [20, 30],
      spo2: [95, 100],
    },
  },
  {
    id: "3",
    patientAge: 65,
    patientSex: "F",
    scenario: "Elderly woman routine check",
    vitals: { hr: 72, temp: 36.8, sbp: 135, dbp: 85, rr: 16, spo2: 98 },
    normalRanges: {
      hr: [60, 100],
      temp: [36.1, 37.2],
      sbp: [90, 140],
      dbp: [60, 90],
      rr: [12, 20],
      spo2: [95, 100],
    },
  },
  {
    id: "4",
    patientAge: 25,
    patientSex: "M",
    scenario: "Young athlete post-exercise",
    vitals: { hr: 95, temp: 37.0, sbp: 120, dbp: 75, rr: 18, spo2: 99 },
    normalRanges: {
      hr: [60, 100],
      temp: [36.1, 37.2],
      sbp: [90, 140],
      dbp: [60, 90],
      rr: [12, 20],
      spo2: [95, 100],
    },
  },
  {
    id: "5",
    patientAge: 45,
    patientSex: "F",
    scenario: "Woman with headache",
    vitals: { hr: 88, temp: 36.5, sbp: 165, dbp: 100, rr: 20, spo2: 98 },
    normalRanges: {
      hr: [60, 100],
      temp: [36.1, 37.2],
      sbp: [90, 140],
      dbp: [60, 90],
      rr: [12, 20],
      spo2: [95, 100],
    },
  },
];

const METRIC_LABELS: Record<Metric, string> = {
  hr: "Heart rate",
  temp: "Temperature",
  sbp: "Systolic BP",
  dbp: "Diastolic BP",
  rr: "Respiratory rate",
  spo2: "SpO2",
};

const METRIC_UNITS: Record<Metric, string> = {
  hr: "bpm",
  temp: "°C",
  sbp: "mmHg",
  dbp: "mmHg",
  rr: "/min",
  spo2: "%",
};

type Phase = "intro" | "playing" | "result";

function checkAnswer(vitalCase: VitalCase, metric: string, answer: Answer): boolean {
  const value = vitalCase.vitals[metric as keyof typeof vitalCase.vitals];
  if (!value) return false;

  const range =
    vitalCase.normalRanges[metric as keyof typeof vitalCase.normalRanges];
  if (!range) return false;

  const isNormal = value >= range[0] && value <= range[1];
  return (answer === "normal") === isNormal;
}

const answerKey = (caseId: string, metric: string) => `${caseId}_${metric}`;

export default function VitalsPrecisionGame() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const [phase, setPhase] = useState<Phase>("intro");
  const [session, setSession] = useState<GameSession | null>(null);
  const [roundCases, setRoundCases] = useState<VitalCase[]>([]);
  const [caseIndex, setCaseIndex] = useState(0);
  const [userAnswers, setUserAnswers] = useState<Record<string, Answer>>({});
  const [stats, setStats] = useState<RoundStats>(EMPTY_ROUND_STATS);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [tokens, setTokens] = useState<number | null>(null);

  const currentCase = roundCases[caseIndex] ?? null;
  const caseMetrics = currentCase ? Object.keys(currentCase.vitals) : [];
  const answeredMetrics = currentCase
    ? caseMetrics.filter((metric) => userAnswers[answerKey(currentCase.id, metric)])
    : [];
  const caseComplete =
    caseMetrics.length > 0 && answeredMetrics.length === caseMetrics.length;
  const isLastCase = caseIndex >= roundCases.length - 1;
  // The clock stops once every reading in the round is answered, so time
  // spent reviewing the last case does not cost the speed bonus.
  const roundComplete = caseComplete && isLastCase;

  const { secondsLeft, reset } = useCountdown(
    VITALS_PRECISION.timeLimitSeconds,
    phase === "playing" && !roundComplete,
  );
  const finishedRef = useRef(false);
  const lastRoundRef = useRef<{ stats: RoundStats; secondsLeft: number } | null>(null);

  const saveResult = useCallback(async () => {
    const round = lastRoundRef.current;
    if (!round || !session || !currentUser) {
      setSaveState("failed");
      return;
    }
    setSaveState("saving");
    try {
      const m = vitalsPrecisionMultipliers(round.stats, round.secondsLeft);
      const wallet = await db.gamificationWallets.get(currentUser.id);
      const tokensEarned = GamificationService.calculateTokens(
        VITALS_PRECISION.baseTokens,
        {
          accuracy: m.accuracy,
          streak: wallet?.streakDays || 0,
          speedBonus: m.speedBonus,
          qualityBonus: m.qualityBonus,
        },
      );
      setTokens(tokensEarned);
      await GamificationService.completeSession(session.id, {
        score: Math.round(m.accuracy * 100),
        tokensEarned,
        badges: [],
        multipliers: {
          accuracy: m.accuracy,
          speed: m.speedBonus,
          quality: m.qualityBonus,
        },
      });
      setSaveState("saved");
    } catch (error) {
      console.error(
        "Could not save Vitals Precision result:",
        error instanceof Error ? error.name : error,
      );
      setSaveState("failed");
    }
  }, [session, currentUser]);

  /** Score and save the round once; later calls are ignored. */
  const recordRound = useCallback(
    (finalStats: RoundStats, finalSecondsLeft: number) => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      lastRoundRef.current = { stats: finalStats, secondsLeft: finalSecondsLeft };
      void saveResult();
    },
    [saveResult],
  );

  // Time up: score what has been assessed so far.
  useEffect(() => {
    if (phase === "playing" && secondsLeft === 0) {
      recordRound(stats, 0);
      setPhase("result");
    }
  }, [phase, secondsLeft, stats, recordRound]);

  const startGame = async () => {
    if (!currentUser || starting) return;
    setStarting(true);
    setStartError("");
    try {
      const round = shuffled(VITAL_CASES);
      const newSession = await GamificationService.startSession(
        "vitals",
        currentUser.id,
        {
          totalCases: round.length,
          startTime: new Date().toISOString(),
        },
      );
      finishedRef.current = false;
      lastRoundRef.current = null;
      setSession(newSession);
      setRoundCases(round);
      setCaseIndex(0);
      setUserAnswers({});
      setStats(EMPTY_ROUND_STATS);
      setSaveState("idle");
      setTokens(null);
      reset(VITALS_PRECISION.timeLimitSeconds);
      setPhase("playing");
    } catch (error) {
      console.error(
        "Could not start Vitals Precision:",
        error instanceof Error ? error.name : error,
      );
      setStartError(
        "The game could not start because this device could not save a new game session. Try again.",
      );
    } finally {
      setStarting(false);
    }
  };

  const submitAnswer = (metric: string, answer: Answer) => {
    if (phase !== "playing" || !currentCase) return;
    const key = answerKey(currentCase.id, metric);
    if (userAnswers[key]) return;
    const isCorrect = checkAnswer(currentCase, metric, answer);
    const nextAnswers = { ...userAnswers, [key]: answer };
    const nextStats = recordAnswer(stats, isCorrect);
    setUserAnswers(nextAnswers);
    setStats(nextStats);
    const caseDone = caseMetrics.every(
      (m) => !!nextAnswers[answerKey(currentCase.id, m)],
    );
    if (caseDone && isLastCase) {
      // Save the round now, while the answers are on screen, so leaving
      // before "See results" does not lose a finished round.
      recordRound(nextStats, secondsLeft);
    }
  };

  const goNext = () => {
    if (!caseComplete) return;
    if (isLastCase) {
      // The round was saved when its last reading was answered.
      setPhase("result");
      return;
    }
    setCaseIndex((i) => i + 1);
  };

  const frameNote = "The patients in these cases are made up for practice.";

  if (phase === "intro") {
    return (
      <TrainingModeFrame
        title="Vitals Precision"
        description="Decide whether each reading is normal or abnormal for the patient's age and sex."
        note={frameNote}
      >
        <div className="card mx-auto max-w-2xl space-y-5">
          <div className="flex items-start gap-3">
            <HeartIcon className="h-8 w-8 shrink-0 text-ink-muted" aria-hidden />
            <div>
              <h2 className="text-h2 text-ink">How it works</h2>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-body text-ink-secondary">
                <li>
                  Review {VITAL_CASES.length} practice cases with age and sex
                  context.
                </li>
                <li>
                  For each reading, compare it with the case&apos;s reference
                  range and choose Normal or Abnormal.
                </li>
                <li>Earn tokens for accuracy, speed and streaks.</li>
              </ol>
            </div>
          </div>
          <ScoringRules>
            <li>
              {VITALS_PRECISION.timeLimitSeconds / 60} minutes for the whole
              round.
            </li>
            <li>
              Base {VITALS_PRECISION.baseTokens} tokens, scaled by the share you
              get right: all correct keeps the full amount, 80% or fewer correct
              gives 0.8×.
            </li>
            <li>
              {multiplierText(VITALS_PRECISION.speedBonus)} if more than{" "}
              {VITALS_PRECISION.speedBonusAboveSecondsLeft / 60} minute is left
              when you finish.
            </li>
            <li>
              {multiplierText(VITALS_PRECISION.streakBonus)} for{" "}
              {VITALS_PRECISION.streakBonusAt} or more correct in a row.
            </li>
            <li>+10% for each day of your activity streak, up to +50%.</li>
            <li>
              Tokens are added to your game wallet after an admin approves the
              session.
            </li>
          </ScoringRules>
          {startError && (
            <div className="banner banner-danger" role="alert">
              <ExclamationCircleIcon className="h-5 w-5 shrink-0" aria-hidden />
              <p>{startError}</p>
            </div>
          )}
          <button
            type="button"
            onClick={startGame}
            disabled={!currentUser || starting}
            className="btn-primary w-full sm:w-auto"
          >
            <PlayIcon className="h-5 w-5" aria-hidden />
            {starting ? "Starting…" : "Start Vitals Precision"}
          </button>
        </div>
      </TrainingModeFrame>
    );
  }

  if (phase === "result") {
    return (
      <TrainingModeFrame
        title="Vitals Precision results"
        description={`${stats.correct} of ${stats.total} readings judged correctly.`}
        note={frameNote}
      >
        <div className="mx-auto max-w-3xl space-y-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <TrainingStat label="Correct" value={`${stats.correct}/${stats.total}`} />
            <TrainingStat
              label="Accuracy"
              value={`${percent(stats.correct, stats.total)}%`}
            />
            <TrainingStat label="Longest streak" value={stats.maxStreak} />
          </div>
          <SessionSaveStatus
            state={saveState}
            tokens={tokens}
            onRetry={() => void saveResult()}
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={startGame}
              disabled={starting}
              className="btn-primary"
            >
              <ArrowPathIcon className="h-5 w-5" aria-hidden />
              Play again
            </button>
            <Link to="/games" className="btn-secondary">
              Back to training
            </Link>
          </div>
          {startError && (
            <div className="banner banner-danger" role="alert">
              <ExclamationCircleIcon className="h-5 w-5 shrink-0" aria-hidden />
              <p>{startError}</p>
            </div>
          )}
        </div>
      </TrainingModeFrame>
    );
  }

  if (!currentCase) return null;
  const progress = Math.round((answeredMetrics.length / caseMetrics.length) * 100);

  return (
    <TrainingModeFrame
      title="Vitals Precision"
      description={`Case ${caseIndex + 1} of ${roundCases.length}`}
      note={frameNote}
    >
      <div className="space-y-5">
        <div className="grid grid-cols-3 gap-3">
          <TrainingStat label="Correct" value={`${stats.correct}/${stats.total}`} />
          <TrainingStat label="Streak" value={stats.streak} />
          <RoundTimer secondsLeft={secondsLeft} lowAt={60} />
        </div>

        <section className="panel" aria-labelledby="vitals-case-title">
          <div className="panel-header">
            <h2 id="vitals-case-title" className="panel-title">
              Practice case
            </h2>
            <StatusBadge tone="neutral">Made-up patient</StatusBadge>
          </div>
          <div className="panel-body space-y-5">
            <div className="flex items-start gap-3">
              <UserIcon className="h-6 w-6 shrink-0 text-ink-muted" aria-hidden />
              <div>
                <p className="text-label text-ink-secondary">
                  {currentCase.patientAge} years old ·{" "}
                  {currentCase.patientSex === "M" ? "Male" : "Female"}
                </p>
                <p className="text-h3 text-ink">{currentCase.scenario}</p>
              </div>
            </div>

            <div>
              <div className="mb-1 flex justify-between text-caption text-ink-muted">
                <span id="vitals-progress-label">
                  {answeredMetrics.length} of {caseMetrics.length} readings assessed
                </span>
                <span>{progress}%</span>
              </div>
              <div
                className="h-2 w-full rounded bg-surface-sunken"
                role="progressbar"
                aria-labelledby="vitals-progress-label"
                aria-valuemin={0}
                aria-valuemax={caseMetrics.length}
                aria-valuenow={answeredMetrics.length}
              >
                <div
                  className="h-2 rounded bg-primary transition-[width]"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {Object.entries(currentCase.vitals).map(([metric, value]) => {
                const m = metric as Metric;
                const answered = userAnswers[answerKey(currentCase.id, metric)];
                const range = currentCase.normalRanges[m];
                const isNormal = value >= range[0] && value <= range[1];
                const isCorrect = !!answered && (answered === "normal") === isNormal;
                const label = METRIC_LABELS[m];
                const unit = METRIC_UNITS[m];
                return (
                  <li
                    key={metric}
                    className={`rounded-lg border p-4 ${
                      answered
                        ? isCorrect
                          ? "border-success-line bg-success-soft"
                          : "border-danger-line bg-danger-soft"
                        : "border-line bg-surface"
                    }`}
                  >
                    <h3 className="text-label text-ink-secondary">{label}</h3>
                    <p className="mt-1 text-display tabular-nums text-ink">
                      {value}
                      <span className="ml-1 text-body text-ink-muted">{unit}</span>
                    </p>
                    <p className="text-caption text-ink-muted">
                      Reference range for this case: {range[0]}–{range[1]} {unit}
                    </p>

                    {answered ? (
                      <p
                        className={`mt-3 flex items-center gap-1.5 text-body font-medium ${
                          isCorrect ? "text-success-fg" : "text-danger-fg"
                        }`}
                      >
                        {isCorrect ? (
                          <CheckCircleIcon className="h-5 w-5 shrink-0" aria-hidden />
                        ) : (
                          <XCircleIcon className="h-5 w-5 shrink-0" aria-hidden />
                        )}
                        {isCorrect ? "Correct" : "Incorrect"}: you chose{" "}
                        {answered}; this reading is {isNormal ? "normal" : "abnormal"}.
                      </p>
                    ) : (
                      <div
                        className="mt-3 grid grid-cols-2 gap-2"
                        role="group"
                        aria-label={`${label}: ${value} ${unit}`}
                      >
                        <button
                          type="button"
                          onClick={() => submitAnswer(metric, "normal")}
                          className="btn-secondary px-3"
                        >
                          Normal
                        </button>
                        <button
                          type="button"
                          onClick={() => submitAnswer(metric, "abnormal")}
                          className="btn-secondary px-3"
                        >
                          Abnormal
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            <div aria-live="polite">
              {caseComplete && (
                <p className="banner banner-info">
                  <CheckCircleIcon className="h-5 w-5 shrink-0" aria-hidden />
                  Case complete. Check your answers, then continue.
                </p>
              )}
            </div>
            {caseComplete && (
              <button type="button" onClick={goNext} className="btn-primary">
                {isLastCase ? "See results" : "Next case"}
                <ArrowRightIcon className="h-5 w-5" aria-hidden />
              </button>
            )}
          </div>
        </section>

        {!roundComplete && (
          <div>
            <Link to="/games" className="btn-ghost">
              Leave game (this round is not scored)
            </Link>
          </div>
        )}
      </div>
    </TrainingModeFrame>
  );
}
