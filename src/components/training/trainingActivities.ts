// Catalogue and pure helpers for training mode: which activities exist, who
// can open them, what they change, quest status and the leaderboard.

import { can, type Permission, type Role } from "@/auth/roles";
import type { GameAttempt, GameTask } from "@/db/gamification";
import {
  KNOWLEDGE_BLITZ,
  QUEUE_MAESTRO,
  TRIAGE_SPRINT,
  VITALS_PRECISION,
} from "./trainingRules";

export type TrainingActivityId =
  | "knowledge-blitz"
  | "triage-sprint"
  | "vitals-precision"
  | "queue-maestro"
  | "restock";

export interface TrainingActivity {
  id: TrainingActivityId;
  name: string;
  description: string;
  href: string;
  /** Roles the route allows (mirrors App.tsx). */
  roles: Role[];
  /** Extra permission the page checks before it lets you play. */
  permission?: Permission;
  reward: string;
  timing: string;
  /**
   * Set when the activity changes real (non-practice) data. Says exactly
   * what changes; shown on the hub card and in the page ribbon.
   */
  liveData?: string;
}

/**
 * Who may open the prize shop and restock leaderboard (mirrors App.tsx):
 * everyone who can take part in training, including pharmacists, who earn
 * restock tokens.
 */
export const TOKEN_PAGE_ROLES: Role[] = ["volunteer", "nurse", "pharmacist", "admin"];

export const TRAINING_ACTIVITIES: TrainingActivity[] = [
  {
    id: "knowledge-blitz",
    name: "Knowledge Blitz",
    description: "Quick quiz on vitals, medicines, infection control and clinic workflow.",
    href: "/games/knowledge-blitz",
    roles: ["volunteer", "nurse", "admin"],
    reward: `${KNOWLEDGE_BLITZ.baseTokens} base tokens`,
    timing: `${KNOWLEDGE_BLITZ.questionsPerRound} questions in ${KNOWLEDGE_BLITZ.timeLimitSeconds} seconds`,
  },
  {
    id: "triage-sprint",
    name: "Triage Sprint",
    description: "Read a practice case and choose urgent, normal or low priority.",
    href: "/games/triage-sprint",
    roles: ["nurse", "doctor", "admin"],
    reward: `${TRIAGE_SPRINT.baseTokens} base tokens`,
    timing: `${TRIAGE_SPRINT.casesPerRound} cases, ${TRIAGE_SPRINT.secondsPerCase / 60} minutes each`,
  },
  {
    id: "vitals-precision",
    name: "Vitals Precision",
    description: "Decide whether each reading in a practice case is normal or abnormal.",
    href: "/games/vitals-precision",
    roles: ["volunteer", "nurse", "admin"],
    reward: `${VITALS_PRECISION.baseTokens} base tokens`,
    timing: `${VITALS_PRECISION.timeLimitSeconds / 60}-minute limit`,
  },
  {
    id: "queue-maestro",
    name: "Queue Maestro",
    description: "Call patients from the live queue and see them within the target time.",
    href: "/games/queue-maestro",
    roles: ["volunteer", "nurse", "admin"],
    reward: `${QUEUE_MAESTRO.baseTokensPerPatient} base tokens per patient`,
    timing: `Target ${QUEUE_MAESTRO.targetMinutes} minutes per patient`,
    liveData: "Calls real patients from the clinic queue.",
  },
  {
    id: "restock",
    name: "Restock game",
    description: "Record supplies you have put on the shelf and earn prize-shop tokens.",
    href: "/inv/game",
    // The route requires the inventory permission (App.tsx).
    roles: ["pharmacist", "admin"],
    permission: "inventory",
    reward: "1–5 tokens per tap",
    timing: "No time limit",
    liveData: "Adds to real non-medical supply counts.",
  },
];

/** Whether `role` passes both the route's role list and any page permission. */
export function canOpenActivity(
  activity: Pick<TrainingActivity, "roles" | "permission">,
  role: Role | null | undefined,
): boolean {
  if (!role) return false;
  if (!activity.roles.includes(role)) return false;
  if (activity.permission && !can(role, activity.permission)) return false;
  return true;
}

/** One-line reason shown on a card the player cannot open. */
export function activityAccessNote(
  activity: Pick<TrainingActivity, "roles" | "permission">,
  role: Role | null | undefined,
): string {
  if (!role || !activity.roles.includes(role)) {
    return `For ${listRoles(activity.roles)}.`;
  }
  if (activity.permission && !can(role, activity.permission)) {
    return `Needs ${activity.permission} permission.`;
  }
  return "";
}

function listRoles(roles: Role[]): string {
  if (roles.length <= 1) return roles.join("");
  return `${roles.slice(0, -1).join(", ")} or ${roles[roles.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Quest board
// ---------------------------------------------------------------------------

/** Where each seeded quest is played. Quests without a route cannot start. */
export const QUEST_ROUTES: Record<string, string> = {
  queue_maestro: "/games/queue-maestro",
  vitals_precision: "/games/vitals-precision",
  knowledge_blitz: "/games/knowledge-blitz",
  restock_blitz: "/inv/game",
};

/** The training activity a quest opens, when it has a page in this app. */
export function questActivity(code: string): TrainingActivity | undefined {
  const href = QUEST_ROUTES[code];
  return href ? TRAINING_ACTIVITIES.find((a) => a.href === href) : undefined;
}

/**
 * Quests whose finished games are stored as game sessions (db.gameSessions)
 * rather than quest attempts. Their progress is read from those sessions.
 */
export const QUEST_SESSION_TYPES: Record<string, "vitals" | "quiz" | "triage" | "shelf"> = {
  vitals_precision: "vitals",
  knowledge_blitz: "quiz",
};

/** Quests whose progress is recorded somewhere this board can read. */
export function questProgressTracked(code: string): boolean {
  return code === "queue_maestro" || code in QUEST_SESSION_TYPES;
}

export type QuestStatus = "in_progress" | "daily_limit" | "cooldown" | "available";

type AttemptLike = Pick<GameAttempt, "taskCode" | "status" | "finishedAt">;

export function completedToday(task: Pick<GameTask, "code">, attempts: AttemptLike[]): number {
  return attempts.filter(
    (a) =>
      a.taskCode === task.code &&
      (a.status === "completed" || a.status === "verified"),
  ).length;
}

/** Status of a quest from today's attempts (logic unchanged from QuestBoard). */
export function questStatus(
  task: Pick<GameTask, "code" | "maxPerDay" | "cooldownMinutes">,
  attempts: AttemptLike[],
  now: Date = new Date(),
): QuestStatus {
  const taskAttempts = attempts.filter((a) => a.taskCode === task.code);
  if (taskAttempts.some((a) => a.status === "in_progress")) return "in_progress";
  if (task.maxPerDay && completedToday(task, attempts) >= task.maxPerDay) {
    return "daily_limit";
  }
  if (task.cooldownMinutes && task.cooldownMinutes > 0) {
    const last = taskAttempts
      .filter((a) => a.finishedAt)
      .sort((a, b) => b.finishedAt!.localeCompare(a.finishedAt!))[0];
    if (last) {
      const cooldownEnd = new Date(last.finishedAt!);
      cooldownEnd.setMinutes(cooldownEnd.getMinutes() + task.cooldownMinutes);
      if (now < cooldownEnd) return "cooldown";
    }
  }
  return "available";
}

/** A Date or ISO string (older rows were normalised to strings) as a Date. */
export function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ---------------------------------------------------------------------------
// Leaderboard (prize-shop wallets)
// ---------------------------------------------------------------------------

/**
 * Before wallets were per person, the Restock game and Prize shop used one
 * shared placeholder wallet with this id. It belongs to nobody, so it is
 * left off the leaderboard.
 */
export const LEGACY_SHARED_WALLET_ID = "demo-volunteer";

export interface LeaderboardRow {
  rank: number;
  volunteerId: string;
  name: string;
  tokens: number;
  isYou: boolean;
}

export function buildLeaderboard(
  wallets: { volunteerId: string; tokens: number }[],
  users: { id: string; fullName?: string | null }[],
  currentUserId?: string | null,
): { rows: LeaderboardRow[]; hiddenLegacyWallet: boolean } {
  const names = new Map(users.map((u) => [u.id, u.fullName?.trim() || ""]));
  const hiddenLegacyWallet = wallets.some(
    (w) => w.volunteerId === LEGACY_SHARED_WALLET_ID,
  );
  const sorted = wallets
    .filter((w) => w.volunteerId !== LEGACY_SHARED_WALLET_ID)
    .map((w) => ({ ...w, tokens: w.tokens || 0 }))
    .sort((a, b) => b.tokens - a.tokens);

  const rows: LeaderboardRow[] = [];
  sorted.forEach((w, i) => {
    // Equal scores share a rank (1, 1, 3).
    const rank =
      i > 0 && sorted[i - 1].tokens === w.tokens ? rows[i - 1].rank : i + 1;
    rows.push({
      rank,
      volunteerId: w.volunteerId,
      name: names.get(w.volunteerId) || "Staff member not on this device",
      tokens: w.tokens,
      isYou: !!currentUserId && w.volunteerId === currentUserId,
    });
  });
  return { rows, hiddenLegacyWallet };
}
