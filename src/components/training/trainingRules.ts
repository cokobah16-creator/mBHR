// Scoring rules and small pure helpers shared by the training-mode games.
//
// The numbers here are the ones each game already used; they live in one
// place so the rules shown to players always match what is calculated.
// Token maths itself stays in GamificationService.calculateTokens /
// calculateTokens in db/gamification.

import type { Permission } from "@/auth/roles";

// ---------------------------------------------------------------------------
// Round statistics (quiz-style games)
// ---------------------------------------------------------------------------

export interface RoundStats {
  correct: number;
  total: number;
  /** Correct answers in a row, ending with the latest answer. */
  streak: number;
  /** Longest run of correct answers this round. */
  maxStreak: number;
}

export const EMPTY_ROUND_STATS: RoundStats = {
  correct: 0,
  total: 0,
  streak: 0,
  maxStreak: 0,
};

/** Stats after one more answer. Never mutates `stats`. */
export function recordAnswer(stats: RoundStats, isCorrect: boolean): RoundStats {
  const streak = isCorrect ? stats.streak + 1 : 0;
  return {
    correct: stats.correct + (isCorrect ? 1 : 0),
    total: stats.total + 1,
    streak,
    maxStreak: Math.max(stats.maxStreak, streak),
  };
}

/** Share of answers that were correct, 0–1 (0 when nothing was answered). */
export function accuracyOf(stats: Pick<RoundStats, "correct" | "total">): number {
  return stats.total > 0 ? stats.correct / stats.total : 0;
}

/** Whole-number percentage; 0 when `whole` is 0 (never NaN). */
export function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/** "m:ss" for a countdown. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Fisher–Yates shuffle using the platform CSPRNG when available. Returns a
 * new array; the input is left untouched.
 */
export function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j =
      typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function"
        ? crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1)
        : Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Where a finished game session is in being saved on this device. */
export type SaveState = "idle" | "saving" | "saved" | "failed";

// ---------------------------------------------------------------------------
// Per-game rules
// ---------------------------------------------------------------------------

export interface RoundMultipliers {
  /** 0–1. calculateTokens clamps it to 0.8–1.3, so in practice 0.8×–1×. */
  accuracy: number;
  speedBonus: number;
  qualityBonus: number;
}

export const KNOWLEDGE_BLITZ = {
  baseTokens: 10,
  questionsPerRound: 5,
  timeLimitSeconds: 60,
  /** Speed bonus when at least this many seconds are left. */
  speedBonusMinSecondsLeft: 10,
  speedBonus: 1.1,
  streakBonusAt: 5,
  streakBonus: 1.2,
} as const;

export function knowledgeBlitzMultipliers(input: {
  correct: number;
  questionCount: number;
  secondsLeft: number;
  maxStreak: number;
}): RoundMultipliers {
  return {
    accuracy: input.questionCount > 0 ? input.correct / input.questionCount : 0,
    speedBonus:
      input.secondsLeft >= KNOWLEDGE_BLITZ.speedBonusMinSecondsLeft
        ? KNOWLEDGE_BLITZ.speedBonus
        : 1.0,
    qualityBonus:
      input.maxStreak >= KNOWLEDGE_BLITZ.streakBonusAt
        ? KNOWLEDGE_BLITZ.streakBonus
        : 1.0,
  };
}

export const TRIAGE_SPRINT = {
  baseTokens: 15,
  casesPerRound: 3,
  secondsPerCase: 120,
  /** Speed bonus when more than this many seconds are left on the last case. */
  speedBonusAboveSecondsLeft: 30,
  speedBonus: 1.1,
  streakBonusAt: 3,
  streakBonus: 1.2,
} as const;

export function triageSprintMultipliers(
  stats: RoundStats,
  secondsLeft: number,
): RoundMultipliers {
  return {
    accuracy: accuracyOf(stats),
    speedBonus:
      secondsLeft > TRIAGE_SPRINT.speedBonusAboveSecondsLeft
        ? TRIAGE_SPRINT.speedBonus
        : 1.0,
    qualityBonus:
      stats.maxStreak >= TRIAGE_SPRINT.streakBonusAt
        ? TRIAGE_SPRINT.streakBonus
        : 1.0,
  };
}

export const VITALS_PRECISION = {
  baseTokens: 12,
  timeLimitSeconds: 300,
  /** Speed bonus when more than this many seconds are left. */
  speedBonusAboveSecondsLeft: 60,
  speedBonus: 1.1,
  streakBonusAt: 8,
  streakBonus: 1.2,
} as const;

export function vitalsPrecisionMultipliers(
  stats: RoundStats,
  secondsLeft: number,
): RoundMultipliers {
  return {
    accuracy: accuracyOf(stats),
    speedBonus:
      secondsLeft > VITALS_PRECISION.speedBonusAboveSecondsLeft
        ? VITALS_PRECISION.speedBonus
        : 1.0,
    qualityBonus:
      stats.maxStreak >= VITALS_PRECISION.streakBonusAt
        ? VITALS_PRECISION.streakBonus
        : 1.0,
  };
}

// ---------------------------------------------------------------------------
// Queue Maestro (acts on the live queue)
// ---------------------------------------------------------------------------

export type QueueStageName = "registration" | "vitals" | "consult" | "pharmacy";

export const QUEUE_STAGE_LABELS: Record<QueueStageName, string> = {
  registration: "Registration",
  vitals: "Vitals",
  consult: "Consultation",
  pharmacy: "Pharmacy",
};

/** Permission needed to call a patient for each stage of the real queue. */
export const QUEUE_STAGE_PERMISSION: Record<QueueStageName, Permission> = {
  registration: "register",
  vitals: "vitals",
  consult: "consult",
  pharmacy: "dispense",
};

export const QUEUE_MAESTRO = {
  baseTokensPerPatient: 15,
  targetMinutes: 4,
  slowMinutes: 6,
  fastBonus: 1.2,
  slowPenalty: 0.8,
  volumeBonusAt: 5,
  volumeBonus: 1.1,
} as const;

export interface QueueMaestroScore {
  averageMinutes: number;
  baseTokens: number;
  speedBonus: number;
  volumeBonus: number;
}

export function queueMaestroScore(
  patientsProcessed: number,
  totalServiceMinutes: number,
): QueueMaestroScore {
  const averageMinutes = totalServiceMinutes / Math.max(1, patientsProcessed);
  return {
    averageMinutes,
    baseTokens: QUEUE_MAESTRO.baseTokensPerPatient * patientsProcessed,
    speedBonus:
      averageMinutes <= QUEUE_MAESTRO.targetMinutes
        ? QUEUE_MAESTRO.fastBonus
        : averageMinutes <= QUEUE_MAESTRO.slowMinutes
          ? 1.0
          : QUEUE_MAESTRO.slowPenalty,
    volumeBonus:
      patientsProcessed >= QUEUE_MAESTRO.volumeBonusAt
        ? QUEUE_MAESTRO.volumeBonus
        : 1.0,
  };
}

/** Minutes between two instants, rounded to one decimal place; never negative. */
export function minutesBetween(
  from: Date | string | number,
  to: Date | string | number,
): number {
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round(((b - a) / 60000) * 10) / 10);
}

/**
 * What happened to the patient this player called, judged from their row in
 * the live queue:
 * - serving:  still being seen at this stage
 * - finished: the stage was completed (sent on, or ended) somewhere in the app
 * - returned: put back in the waiting list
 * - missing:  the queue row no longer exists on this device
 */
export type CalledPatientOutcome = "serving" | "finished" | "returned" | "missing";

/**
 * `calledAt` is when this player called the patient. A "waiting" row last
 * updated at or before then is a stale snapshot from before the call (the
 * live query had not caught up yet), not a patient put back in the list, so
 * it still counts as "serving".
 */
export function calledPatientOutcome(
  row:
    | {
        status: "waiting" | "in_progress" | "done";
        updatedAt?: Date | string | number;
      }
    | undefined,
  calledAt?: Date | string | number,
): CalledPatientOutcome {
  if (!row) return "missing";
  if (row.status === "done") return "finished";
  if (row.status === "waiting") {
    if (calledAt !== undefined && row.updatedAt !== undefined) {
      const updated = new Date(row.updatedAt).getTime();
      const called = new Date(calledAt).getTime();
      if (!Number.isNaN(updated) && !Number.isNaN(called) && updated <= called) {
        return "serving";
      }
    }
    return "returned";
  }
  return "serving";
}

// ---------------------------------------------------------------------------
// Restock game (changes real non-medical supply counts)
// ---------------------------------------------------------------------------

export const RESTOCK_TAP_AMOUNTS = [1, 5, 10] as const;
/** Session total at or above which the "swift_stocker" badge is awarded. */
export const SWIFT_STOCKER_MIN_TOKENS = 50;

export function restockTapTokens(amount: number): number {
  return Math.max(1, Math.floor(amount / 2));
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** "first_quest" → "First quest". */
export function badgeLabel(code: string): string {
  const words = code.replace(/[_-]+/g, " ").trim();
  if (!words) return code;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Percentage bonus text for a multiplier: 1.2 → "+20%", 0.8 → "−20%". */
export function multiplierText(multiplier: number): string {
  const pct = Math.round((multiplier - 1) * 100);
  if (pct === 0) return "no change";
  return pct > 0 ? `+${pct}%` : `−${Math.abs(pct)}%`;
}
