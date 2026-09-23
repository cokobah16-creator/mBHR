import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuthStore } from "@/stores/auth";
import { db, type GameSession } from "@/db";
import { GamificationService } from "@/services/gamification";
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ClockIcon,
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
  PlayIcon,
  UserIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline";
import { StatusBadge, type Tone } from "@/components/ui/StatusBadge";
import { TrainingModeFrame } from "@/components/training/TrainingModeFrame";
import {
  RoundTimer,
  ScoringRules,
  SessionSaveStatus,
  TrainingStat,
} from "@/components/training/TrainingWidgets";
import {
  EMPTY_ROUND_STATS,
  TRIAGE_SPRINT,
  multiplierText,
  percent,
  recordAnswer,
  shuffled,
  triageSprintMultipliers,
  type RoundStats,
  type SaveState,
} from "@/components/training/trainingRules";
import { useCountdown } from "@/components/training/useCountdown";

type Priority = "urgent" | "normal" | "low";

interface TriageCase {
  id: string;
  scenario: string;
  patientAge: number;
  patientSex: "M" | "F";
  symptoms: string[];
  vitals: {
    conscious: boolean;
    breathing: boolean;
    pulse: "weak" | "normal" | "strong";
    skinColor: "normal" | "pale" | "cyanotic";
  };
  correctPriority: Priority;
  explanation: string;
}

// Practice cases. These are made up; none is a real patient.
const TRIAGE_CASES: TriageCase[] = [
  {
    id: "1",
    scenario: "Adult male collapsed at home",
    patientAge: 45,
    patientSex: "M",
    symptoms: ["chest pain", "difficulty breathing", "sweating"],
    vitals: {
      conscious: true,
      breathing: true,
      pulse: "weak",
      skinColor: "pale",
    },
    correctPriority: "urgent",
    explanation:
      "Chest pain with breathing difficulty and weak pulse suggests cardiac emergency",
  },
  {
    id: "2",
    scenario: "Child with fever and cough",
    patientAge: 6,
    patientSex: "F",
    symptoms: ["fever", "cough", "runny nose"],
    vitals: {
      conscious: true,
      breathing: true,
      pulse: "normal",
      skinColor: "normal",
    },
    correctPriority: "normal",
    explanation:
      "Common cold symptoms in stable child - routine care appropriate",
  },
  {
    id: "3",
    scenario: "Elderly woman with minor cut",
    patientAge: 70,
    patientSex: "F",
    symptoms: ["small laceration", "no bleeding"],
    vitals: {
      conscious: true,
      breathing: true,
      pulse: "normal",
      skinColor: "normal",
    },
    correctPriority: "low",
    explanation: "Minor wound in stable patient can wait for routine care",
  },
  {
    id: "4",
    scenario: "Unconscious patient brought by family",
    patientAge: 30,
    patientSex: "M",
    symptoms: ["unconscious", "unknown cause"],
    vitals: {
      conscious: false,
      breathing: true,
      pulse: "weak",
      skinColor: "pale",
    },
    correctPriority: "urgent",
    explanation:
      "Unconsciousness requires immediate assessment and intervention",
  },
  {
    id: "5",
    scenario: "Pregnant woman with contractions",
    patientAge: 28,
    patientSex: "F",
    symptoms: ["regular contractions", "back pain"],
    vitals: {
      conscious: true,
      breathing: true,
      pulse: "strong",
      skinColor: "normal",
    },
    correctPriority: "urgent",
    explanation: "Active labor requires immediate obstetric care",
  },
];

const PRIORITIES: {
  id: Priority;
  label: string;
  hint: string;
  tone: Tone;
}[] = [
  { id: "urgent", label: "Urgent", hint: "Immediate attention required", tone: "danger" },
  { id: "normal", label: "Normal", hint: "Standard care pathway", tone: "warning" },
  { id: "low", label: "Low", hint: "Can wait for routine care", tone: "success" },
];

const PRIORITY_LABEL: Record<Priority, string> = {
  urgent: "Urgent",
  normal: "Normal",
  low: "Low",
};

const SELECTED_CLASS: Record<Priority, string> = {
  urgent: "border-danger bg-danger-soft",
  normal: "border-warning bg-warning-soft",
  low: "border-success bg-success-soft",
};

type Phase = "intro" | "playing" | "result";

function PriorityIcon({ priority }: { priority: Priority }) {
  if (priority === "urgent") {
    return <ExclamationCircleIcon className="h-6 w-6 shrink-0 text-danger" aria-hidden />;
  }
  if (priority === "normal") {
    return <ClockIcon className="h-6 w-6 shrink-0 text-warning" aria-hidden />;
  }
  return <CheckCircleIcon className="h-6 w-6 shrink-0 text-success" aria-hidden />;
}

export default function TriageSprint() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const [phase, setPhase] = useState<Phase>("intro");
  const [session, setSession] = useState<GameSession | null>(null);
  const [roundCases, setRoundCases] = useState<TriageCase[]>([]);
  const [caseIndex, setCaseIndex] = useState(0);
  const [selectedPriority, setSelectedPriority] = useState<Priority | null>(null);
  // The priority that was actually submitted for the current case (null
  // when the case timed out with nothing chosen). Undefined until then.
  const [submitted, setSubmitted] = useState<Priority | null | undefined>(undefined);
  const [stats, setStats] = useState<RoundStats>(EMPTY_ROUND_STATS);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [tokens, setTokens] = useState<number | null>(null);

  const isAnswered = submitted !== undefined;
  const { secondsLeft, reset } = useCountdown(
    TRIAGE_SPRINT.secondsPerCase,
    phase === "playing" && !isAnswered,
  );
  const lastRoundRef = useRef<{ stats: RoundStats; secondsLeft: number } | null>(null);

  const currentCase = roundCases[caseIndex] ?? null;
  const isLastCase = caseIndex >= roundCases.length - 1;

  const saveResult = useCallback(async () => {
    const round = lastRoundRef.current;
    if (!round || !session || !currentUser) {
      setSaveState("failed");
      return;
    }
    setSaveState("saving");
    try {
      const m = triageSprintMultipliers(round.stats, round.secondsLeft);
      const wallet = await db.gamificationWallets.get(currentUser.id);
      const tokensEarned = GamificationService.calculateTokens(
        TRIAGE_SPRINT.baseTokens,
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
        "Could not save Triage Sprint result:",
        error instanceof Error ? error.name : error,
      );
      setSaveState("failed");
    }
  }, [session, currentUser]);

  const submitAnswer = useCallback(
    (choice: Priority | null) => {
      if (phase !== "playing" || !currentCase || submitted !== undefined) return;
      const isCorrect = choice === currentCase.correctPriority;
      const nextStats = recordAnswer(stats, isCorrect);
      setStats(nextStats);
      setSubmitted(choice);
      if (isLastCase) {
        // Save the round now, while the feedback is on screen, so leaving
        // before "See results" does not lose a finished round.
        lastRoundRef.current = { stats: nextStats, secondsLeft };
        void saveResult();
      }
    },
    [phase, currentCase, submitted, stats, isLastCase, secondsLeft, saveResult],
  );

  // Out of time on a case: submit whatever is chosen (nothing counts as wrong).
  useEffect(() => {
    if (phase === "playing" && !isAnswered && secondsLeft === 0) {
      submitAnswer(selectedPriority);
    }
  }, [phase, isAnswered, secondsLeft, selectedPriority, submitAnswer]);

  const startGame = async () => {
    if (!currentUser || starting) return;
    setStarting(true);
    setStartError("");
    try {
      const round = shuffled(TRIAGE_CASES).slice(0, TRIAGE_SPRINT.casesPerRound);
      const newSession = await GamificationService.startSession(
        "triage",
        currentUser.id,
        {
          totalCases: round.length,
          startTime: new Date().toISOString(),
        },
      );
      lastRoundRef.current = null;
      setSession(newSession);
      setRoundCases(round);
      setCaseIndex(0);
      setSelectedPriority(null);
      setSubmitted(undefined);
      setStats(EMPTY_ROUND_STATS);
      setSaveState("idle");
      setTokens(null);
      reset(TRIAGE_SPRINT.secondsPerCase);
      setPhase("playing");
    } catch (error) {
      console.error(
        "Could not start Triage Sprint:",
        error instanceof Error ? error.name : error,
      );
      setStartError(
        "The game could not start because this device could not save a new game session. Try again.",
      );
    } finally {
      setStarting(false);
    }
  };

  const goNext = () => {
    if (!isAnswered) return;
    if (isLastCase) {
      // The round was saved when the last case was answered.
      setPhase("result");
      return;
    }
    setCaseIndex((i) => i + 1);
    setSelectedPriority(null);
    setSubmitted(undefined);
    reset(TRIAGE_SPRINT.secondsPerCase);
  };

  const frameNote = "The patients in these cases are made up for practice.";

  if (phase === "intro") {
    return (
      <TrainingModeFrame
        title="Triage Sprint"
        description="Read a practice case and choose the priority it should get."
        note={frameNote}
      >
        <div className="card mx-auto max-w-2xl space-y-5">
          <div className="flex items-start gap-3">
            <ExclamationTriangleIcon className="h-8 w-8 shrink-0 text-ink-muted" aria-hidden />
            <div>
              <h2 className="text-h2 text-ink">Ready for triage practice?</h2>
              <p className="text-body text-ink-secondary">
                For each case, look at the airway, breathing and circulation
                findings, then choose urgent, normal or low priority.
              </p>
            </div>
          </div>
          <ScoringRules>
            <li>
              {TRIAGE_SPRINT.casesPerRound} cases picked at random from{" "}
              {TRIAGE_CASES.length}, with {TRIAGE_SPRINT.secondsPerCase / 60}{" "}
              minutes for each case.
            </li>
            <li>
              Base {TRIAGE_SPRINT.baseTokens} tokens for the round, scaled by
              the share you get right: all correct keeps the full amount, 80% or
              fewer correct gives 0.8×.
            </li>
            <li>
              {multiplierText(TRIAGE_SPRINT.streakBonus)} if you get{" "}
              {TRIAGE_SPRINT.streakBonusAt} right in a row.
            </li>
            <li>
              {multiplierText(TRIAGE_SPRINT.speedBonus)} if more than{" "}
              {TRIAGE_SPRINT.speedBonusAboveSecondsLeft} seconds are left when
              you answer the last case.
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
            {starting ? "Starting…" : "Start Triage Sprint"}
          </button>
        </div>
      </TrainingModeFrame>
    );
  }

  if (phase === "result") {
    return (
      <TrainingModeFrame
        title="Triage Sprint results"
        description={`${stats.correct} of ${stats.total} cases given the right priority.`}
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
  const wasCorrect = isAnswered && submitted === currentCase.correctPriority;

  return (
    <TrainingModeFrame
      title="Triage Sprint"
      description={`Case ${caseIndex + 1} of ${roundCases.length}`}
      note={frameNote}
    >
      <div className="space-y-5">
        <div className="grid grid-cols-3 gap-3">
          <TrainingStat label="Correct" value={`${stats.correct}/${stats.total}`} />
          <TrainingStat label="Streak" value={stats.streak} />
          <RoundTimer
            secondsLeft={secondsLeft}
            lowAt={30}
            label="Time left for this case"
          />
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <section className="panel" aria-labelledby="triage-case-title">
            <div className="panel-header">
              <h2 id="triage-case-title" className="panel-title">
                Practice case
              </h2>
              <StatusBadge tone="neutral">Made-up patient</StatusBadge>
            </div>
            <div className="panel-body space-y-5">
              <div className="flex items-start gap-3">
                <UserIcon className="h-6 w-6 shrink-0 text-ink-muted" aria-hidden />
                <div>
                  <p className="text-label text-ink-secondary">
                    {currentCase.patientAge} year old{" "}
                    {currentCase.patientSex === "M" ? "male" : "female"}
                  </p>
                  <p className="text-h3 text-ink">{currentCase.scenario}</p>
                </div>
              </div>

              <div>
                <h3 className="section-label mb-2">Symptoms</h3>
                <ul className="flex flex-wrap gap-2">
                  {currentCase.symptoms.map((symptom) => (
                    <li key={symptom}>
                      <StatusBadge tone="neutral">{symptom}</StatusBadge>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className="section-label mb-2">Quick assessment</h3>
                <dl className="grid grid-cols-2 gap-3">
                  <div className="rounded-md border border-line bg-surface-sunken p-3">
                    <dt className="text-caption text-ink-muted">Conscious</dt>
                    <dd className="mt-1">
                      <StatusBadge
                        tone={currentCase.vitals.conscious ? "success" : "danger"}
                        icon
                      >
                        {currentCase.vitals.conscious ? "Yes" : "No"}
                      </StatusBadge>
                    </dd>
                  </div>
                  <div className="rounded-md border border-line bg-surface-sunken p-3">
                    <dt className="text-caption text-ink-muted">Breathing</dt>
                    <dd className="mt-1">
                      <StatusBadge
                        tone={currentCase.vitals.breathing ? "success" : "danger"}
                        icon
                      >
                        {currentCase.vitals.breathing ? "Yes" : "No"}
                      </StatusBadge>
                    </dd>
                  </div>
                  <div className="rounded-md border border-line bg-surface-sunken p-3">
                    <dt className="text-caption text-ink-muted">Pulse</dt>
                    <dd className="mt-1 text-body font-semibold capitalize text-ink">
                      {currentCase.vitals.pulse}
                    </dd>
                  </div>
                  <div className="rounded-md border border-line bg-surface-sunken p-3">
                    <dt className="text-caption text-ink-muted">Skin colour</dt>
                    <dd className="mt-1 text-body font-semibold capitalize text-ink">
                      {currentCase.vitals.skinColor}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>
          </section>

          <form
            className="panel"
            onSubmit={(e) => {
              e.preventDefault();
              if (selectedPriority) submitAnswer(selectedPriority);
            }}
          >
            <div className="panel-header">
              <h2 className="panel-title">Assign priority</h2>
            </div>
            <div className="panel-body space-y-4">
              <fieldset disabled={isAnswered}>
                <legend className="mb-3 text-body text-ink-secondary">
                  Based on this presentation, what priority should the case get?
                </legend>
                <div className="space-y-3">
                  {PRIORITIES.map((p) => {
                    const isSelected = selectedPriority === p.id;
                    return (
                      <label
                        key={p.id}
                        className={`flex min-h-touch-target cursor-pointer items-center gap-4 rounded-lg border-2 p-4 transition-colors ${
                          isSelected
                            ? SELECTED_CLASS[p.id]
                            : "border-line bg-surface hover:bg-surface-hover"
                        }`}
                      >
                        <input
                          type="radio"
                          name="triage-priority"
                          value={p.id}
                          checked={isSelected}
                          onChange={() => setSelectedPriority(p.id)}
                          className="h-5 w-5 shrink-0 accent-primary"
                        />
                        <PriorityIcon priority={p.id} />
                        <span>
                          <span className="block text-h3 text-ink">{p.label}</span>
                          <span className="block text-body text-ink-secondary">
                            {p.hint}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              {!isAnswered && (
                <button
                  type="submit"
                  disabled={!selectedPriority}
                  className="btn-primary w-full"
                >
                  Submit priority
                </button>
              )}

              <div aria-live="polite">
                {isAnswered && (
                  <div className={`banner ${wasCorrect ? "banner-success" : "banner-danger"}`}>
                    {wasCorrect ? (
                      <CheckCircleIcon className="h-5 w-5 shrink-0" aria-hidden />
                    ) : (
                      <XCircleIcon className="h-5 w-5 shrink-0" aria-hidden />
                    )}
                    <div>
                      <p className="font-semibold">
                        {wasCorrect
                          ? "Correct."
                          : submitted === null
                            ? "Time ran out before a priority was chosen."
                            : "Not the expected priority."}
                      </p>
                      <p>
                        Expected priority:{" "}
                        {PRIORITY_LABEL[currentCase.correctPriority]}.
                      </p>
                      <p className="mt-1">{currentCase.explanation}</p>
                    </div>
                  </div>
                )}
              </div>

              {isAnswered && (
                <button type="button" onClick={goNext} className="btn-primary w-full">
                  {isLastCase ? "See results" : "Next case"}
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
    </TrainingModeFrame>
  );
}
