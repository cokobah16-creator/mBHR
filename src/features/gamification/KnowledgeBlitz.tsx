import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuthStore } from "@/stores/auth";
import { db, type GameSession } from "@/db";
import { GamificationService } from "@/services/gamification";
import {
  AcademicCapIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  PlayIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline";
import { TrainingModeFrame } from "@/components/training/TrainingModeFrame";
import {
  RoundTimer,
  ScoringRules,
  SessionSaveStatus,
  TrainingStat,
} from "@/components/training/TrainingWidgets";
import {
  EMPTY_ROUND_STATS,
  KNOWLEDGE_BLITZ,
  knowledgeBlitzMultipliers,
  multiplierText,
  percent,
  recordAnswer,
  shuffled,
  type RoundStats,
  type SaveState,
} from "@/components/training/trainingRules";
import { useCountdown } from "@/components/training/useCountdown";

interface QuizQuestion {
  id: string;
  topic: string;
  difficulty: "easy" | "medium" | "hard";
  stem: string;
  choices: string[];
  answerIndex: number;
  explanation: string;
}

// Practice questions (in production, these would come from the database).
const QUESTION_BANK: QuizQuestion[] = [
  {
    id: "1",
    topic: "vital_signs",
    difficulty: "easy",
    stem: "What is the normal resting heart rate range for adults?",
    choices: ["40-60 bpm", "60-100 bpm", "100-120 bpm", "120-140 bpm"],
    answerIndex: 1,
    explanation: "Normal adult resting heart rate is 60-100 beats per minute.",
  },
  {
    id: "2",
    topic: "medication",
    difficulty: "medium",
    stem: "Which medication should be stored in a cool, dry place?",
    choices: [
      "Paracetamol tablets",
      "Insulin vials",
      "Cough syrup",
      "All of the above",
    ],
    answerIndex: 3,
    explanation:
      "All medications should be stored properly to maintain efficacy.",
  },
  {
    id: "3",
    topic: "infection_control",
    difficulty: "easy",
    stem: "How long should you wash your hands with soap?",
    choices: ["5 seconds", "10 seconds", "20 seconds", "30 seconds"],
    answerIndex: 2,
    explanation:
      "Proper handwashing requires at least 20 seconds with soap and water.",
  },
  {
    id: "4",
    topic: "triage",
    difficulty: "medium",
    stem: "A patient with chest pain and difficulty breathing should be triaged as:",
    choices: ["Low priority", "Normal priority", "Urgent priority", "Can wait"],
    answerIndex: 2,
    explanation:
      "Chest pain with breathing difficulty indicates potential cardiac emergency.",
  },
  {
    id: "5",
    topic: "pharmacy",
    difficulty: "hard",
    stem: "FEFO stands for:",
    choices: [
      "First Expired, First Out",
      "First Entry, First Out",
      "Fast Expiry, Fast Out",
      "Final Entry, Final Out",
    ],
    answerIndex: 0,
    explanation:
      "FEFO ensures medications closest to expiry are dispensed first.",
  },
  {
    id: "6",
    topic: "vital_signs",
    difficulty: "medium",
    stem: "Normal body temperature range is:",
    choices: ["35.0-36.0°C", "36.1-37.2°C", "37.3-38.0°C", "38.1-39.0°C"],
    answerIndex: 1,
    explanation: "Normal body temperature ranges from 36.1°C to 37.2°C.",
  },
  {
    id: "7",
    topic: "workflow",
    difficulty: "easy",
    stem: "What is the correct patient flow sequence?",
    choices: [
      "Registration → Pharmacy → Vitals → Consult",
      "Registration → Vitals → Consult → Pharmacy",
      "Vitals → Registration → Consult → Pharmacy",
      "Consult → Vitals → Registration → Pharmacy",
    ],
    answerIndex: 1,
    explanation:
      "Patients flow from Registration → Vitals → Consultation → Pharmacy.",
  },
  {
    id: "8",
    topic: "safety",
    difficulty: "medium",
    stem: "If a patient reports an allergy to penicillin, you should:",
    choices: [
      "Give them penicillin anyway",
      "Note it clearly in their record",
      "Ignore the information",
      "Ask them to prove it",
    ],
    answerIndex: 1,
    explanation:
      "Drug allergies must be clearly documented to prevent adverse reactions.",
  },
];

/** Pause after each answer so the player can see whether it was right. */
const FEEDBACK_MS = 1000;
const LETTERS = ["A", "B", "C", "D", "E", "F"];

type Phase = "intro" | "playing" | "result";

function topicLabel(topic: string): string {
  const words = topic.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export default function KnowledgeBlitz() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const [phase, setPhase] = useState<Phase>("intro");
  const [session, setSession] = useState<GameSession | null>(null);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [answers, setAnswers] = useState<number[]>([]);
  const [stats, setStats] = useState<RoundStats>(EMPTY_ROUND_STATS);
  const [feedback, setFeedback] = useState<boolean | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [tokens, setTokens] = useState<number | null>(null);

  const { secondsLeft, reset } = useCountdown(
    KNOWLEDGE_BLITZ.timeLimitSeconds,
    phase === "playing",
  );

  const finishedRef = useRef(false);
  const lastRoundRef = useRef<{ stats: RoundStats; secondsLeft: number } | null>(null);
  const advanceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (advanceRef.current) clearTimeout(advanceRef.current);
    },
    [],
  );

  const saveResult = useCallback(async () => {
    const round = lastRoundRef.current;
    if (!round || !session || !currentUser) {
      setSaveState("failed");
      return;
    }
    setSaveState("saving");
    try {
      const m = knowledgeBlitzMultipliers({
        correct: round.stats.correct,
        questionCount: questions.length,
        secondsLeft: round.secondsLeft,
        maxStreak: round.stats.maxStreak,
      });
      const wallet = await db.gamificationWallets.get(currentUser.id);
      const tokensEarned = GamificationService.calculateTokens(
        KNOWLEDGE_BLITZ.baseTokens,
        {
          accuracy: m.accuracy,
          streak: wallet?.streakDays || 0,
          speedBonus: m.speedBonus,
          qualityBonus: m.qualityBonus,
        },
      );
      setTokens(tokensEarned);
      await GamificationService.completeSession(session.id, {
        score: round.stats.correct,
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
        "Could not save Knowledge Blitz result:",
        error instanceof Error ? error.name : error,
      );
      setSaveState("failed");
    }
  }, [session, currentUser, questions.length]);

  const finishRound = useCallback(
    (finalStats: RoundStats, finalSecondsLeft: number) => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      if (advanceRef.current) clearTimeout(advanceRef.current);
      setFeedback(null);
      lastRoundRef.current = { stats: finalStats, secondsLeft: finalSecondsLeft };
      setPhase("result");
      void saveResult();
    },
    [saveResult],
  );

  // Time up: score what has been answered so far.
  useEffect(() => {
    if (phase === "playing" && secondsLeft === 0) finishRound(stats, 0);
  }, [phase, secondsLeft, stats, finishRound]);

  const startGame = async () => {
    if (!currentUser || starting) return;
    setStarting(true);
    setStartError("");
    try {
      const round = shuffled(QUESTION_BANK).slice(
        0,
        KNOWLEDGE_BLITZ.questionsPerRound,
      );
      const newSession = await GamificationService.startSession(
        "quiz",
        currentUser.id,
        {
          totalQuestions: round.length,
          startTime: new Date().toISOString(),
        },
      );
      finishedRef.current = false;
      lastRoundRef.current = null;
      setSession(newSession);
      setQuestions(round);
      setIndex(0);
      setSelected(null);
      setAnswers([]);
      setStats(EMPTY_ROUND_STATS);
      setFeedback(null);
      setSaveState("idle");
      setTokens(null);
      reset(KNOWLEDGE_BLITZ.timeLimitSeconds);
      setPhase("playing");
    } catch (error) {
      console.error(
        "Could not start Knowledge Blitz:",
        error instanceof Error ? error.name : error,
      );
      setStartError(
        "The quiz could not start because this device could not save a new game session. Try again.",
      );
    } finally {
      setStarting(false);
    }
  };

  const submitAnswer = () => {
    if (phase !== "playing" || selected === null || feedback !== null) return;
    const question = questions[index];
    if (!question) return;
    const isCorrect = selected === question.answerIndex;
    const nextStats = recordAnswer(stats, isCorrect);
    const isLast = index >= questions.length - 1;
    const secondsAtSubmit = secondsLeft;
    setStats(nextStats);
    setAnswers((prev) => [...prev, selected]);
    setFeedback(isCorrect);
    advanceRef.current = setTimeout(() => {
      advanceRef.current = null;
      if (isLast) {
        finishRound(nextStats, secondsAtSubmit);
      } else {
        setFeedback(null);
        setIndex((i) => i + 1);
        setSelected(null);
      }
    }, FEEDBACK_MS);
  };

  const rules = (
    <ScoringRules>
      <li>
        {KNOWLEDGE_BLITZ.questionsPerRound} questions picked at random from{" "}
        {QUESTION_BANK.length}, with {KNOWLEDGE_BLITZ.timeLimitSeconds} seconds
        for the whole round.
      </li>
      <li>
        Base {KNOWLEDGE_BLITZ.baseTokens} tokens, scaled by the share you get
        right: all correct keeps the full amount, 80% or fewer correct gives
        0.8×.
      </li>
      <li>
        {multiplierText(KNOWLEDGE_BLITZ.speedBonus)} if{" "}
        {KNOWLEDGE_BLITZ.speedBonusMinSecondsLeft} or more seconds are left.
      </li>
      <li>
        {multiplierText(KNOWLEDGE_BLITZ.streakBonus)} for{" "}
        {KNOWLEDGE_BLITZ.streakBonusAt} correct answers in a row.
      </li>
      <li>+10% for each day of your activity streak, up to +50%.</li>
      <li>
        Tokens are added to your game wallet after an admin approves the
        session.
      </li>
    </ScoringRules>
  );

  const frameNote =
    "Questions are practice material. Follow your clinic's protocols for real patients.";

  if (phase === "intro") {
    return (
      <TrainingModeFrame
        title="Knowledge Blitz"
        description="A quick quiz on vitals, medicines, infection control and clinic workflow."
        note={frameNote}
      >
        <div className="card mx-auto max-w-2xl space-y-5">
          <div className="flex items-start gap-3">
            <AcademicCapIcon className="h-8 w-8 shrink-0 text-ink-muted" aria-hidden />
            <div>
              <h2 className="text-h2 text-ink">Ready for the quiz?</h2>
              <p className="text-body text-ink-secondary">
                Choose one answer per question, then select Submit answer. The
                clock runs for the whole round.
              </p>
            </div>
          </div>
          {rules}
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
            {starting ? "Starting…" : "Start Knowledge Blitz"}
          </button>
        </div>
      </TrainingModeFrame>
    );
  }

  if (phase === "result") {
    const answered = answers.length;
    return (
      <TrainingModeFrame
        title="Knowledge Blitz results"
        description={
          answered < questions.length
            ? `Time ran out after ${answered} of ${questions.length} questions.`
            : "You answered every question."
        }
        note={frameNote}
      >
        <div className="mx-auto max-w-3xl space-y-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <TrainingStat
              label="Correct"
              value={`${stats.correct}/${questions.length}`}
            />
            <TrainingStat
              label="Accuracy"
              value={`${percent(stats.correct, questions.length)}%`}
            />
            <TrainingStat label="Longest streak" value={stats.maxStreak} />
          </div>

          <SessionSaveStatus
            state={saveState}
            tokens={tokens}
            onRetry={() => void saveResult()}
          />

          <section className="panel" aria-labelledby="blitz-review">
            <div className="panel-header">
              <h2 id="blitz-review" className="panel-title">
                Review your answers
              </h2>
            </div>
            <ol className="divide-y divide-line">
              {questions.map((q, i) => {
                const given = answers[i];
                const wasAnswered = given !== undefined;
                const right = wasAnswered && given === q.answerIndex;
                return (
                  <li key={q.id} className="panel-body space-y-1">
                    <p className="text-body font-medium text-ink">
                      {i + 1}. {q.stem}
                    </p>
                    <p className="flex items-center gap-1.5 text-body">
                      {right ? (
                        <CheckCircleIcon className="h-5 w-5 shrink-0 text-success" aria-hidden />
                      ) : (
                        <XCircleIcon className="h-5 w-5 shrink-0 text-danger" aria-hidden />
                      )}
                      <span className={right ? "text-success-fg" : "text-danger-fg"}>
                        {!wasAnswered
                          ? "Not answered"
                          : right
                            ? `Correct: ${q.choices[given]}`
                            : `Your answer: ${q.choices[given]}`}
                      </span>
                    </p>
                    {!right && (
                      <p className="text-body text-ink-secondary">
                        Answer: {q.choices[q.answerIndex]}
                      </p>
                    )}
                    <p className="text-caption text-ink-muted">{q.explanation}</p>
                  </li>
                );
              })}
            </ol>
          </section>

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

  const question = questions[index];
  if (!question) return null;
  const locked = feedback !== null;

  return (
    <TrainingModeFrame
      title="Knowledge Blitz"
      description={`Question ${index + 1} of ${questions.length}`}
      note={frameNote}
    >
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="grid grid-cols-3 gap-3">
          <TrainingStat label="Correct" value={stats.correct} />
          <TrainingStat label="Streak" value={stats.streak} />
          <RoundTimer secondsLeft={secondsLeft} lowAt={10} />
        </div>

        <form
          className="card space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            submitAnswer();
          }}
        >
          <p className="text-caption text-ink-muted">
            {topicLabel(question.topic)} · {question.difficulty}
          </p>
          <fieldset disabled={locked}>
            <legend className="mb-4 text-h2 text-ink">{question.stem}</legend>
            <div className="space-y-3">
              {question.choices.map((choice, i) => {
                const isSelected = selected === i;
                return (
                  <label
                    key={choice}
                    className={`flex min-h-touch-target cursor-pointer items-center gap-3 rounded-lg border p-4 transition-colors ${
                      isSelected
                        ? "border-primary bg-primary-soft"
                        : "border-line bg-surface hover:bg-surface-hover"
                    }`}
                  >
                    <input
                      type="radio"
                      name={`blitz-${question.id}`}
                      value={i}
                      checked={isSelected}
                      onChange={() => setSelected(i)}
                      className="h-5 w-5 shrink-0 accent-primary"
                    />
                    <span className="w-5 shrink-0 text-label text-ink-muted">
                      {LETTERS[i]}
                    </span>
                    <span className="text-body text-ink">{choice}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div aria-live="polite">
            {feedback === true && (
              <p className="banner banner-success">
                <CheckCircleIcon className="h-5 w-5 shrink-0" aria-hidden />
                Correct.
              </p>
            )}
            {feedback === false && (
              <p className="banner banner-danger">
                <XCircleIcon className="h-5 w-5 shrink-0" aria-hidden />
                Not quite. The answer is {LETTERS[question.answerIndex]}:{" "}
                {question.choices[question.answerIndex]}.
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={selected === null || locked}
            className="btn-primary w-full sm:w-auto"
          >
            Submit answer
          </button>
        </form>
      </div>
    </TrainingModeFrame>
  );
}
