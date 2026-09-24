// Pure rules for queue priority and position. No database access, so they
// can be unit tested directly (bun test / vitest).
//
// Triage priority is stored on each queue row. It is carried from stage to
// stage and only an authorised clinician (consult permission) can lower it,
// with a reason. Nothing here changes a clinical threshold: the priority
// itself is set by staff (ticket issue, triage) and only ordered here.
import { can, type Role } from "@/auth/roles";

export type QueuePriority = "urgent" | "normal" | "low";
export type QueueStageName = "registration" | "vitals" | "consult" | "pharmacy";

/** Higher number = more urgent. */
const PRIORITY_RANK: Record<QueuePriority, number> = {
  low: 0,
  normal: 1,
  urgent: 2,
};

export const PRIORITY_LABELS: Record<QueuePriority, string> = {
  urgent: "Urgent",
  normal: "Normal",
  low: "Low priority",
};

/** Missing or unknown priority is treated as normal (the old default). */
export function normalisePriority(p: string | null | undefined): QueuePriority {
  return p === "urgent" || p === "low" || p === "normal" ? p : "normal";
}

export function isDowngrade(from: QueuePriority, to: QueuePriority): boolean {
  return PRIORITY_RANK[to] < PRIORITY_RANK[from];
}

export function isEscalation(from: QueuePriority, to: QueuePriority): boolean {
  return PRIORITY_RANK[to] > PRIORITY_RANK[from];
}

/** Priorities a clinician may lower `from` to (empty when already lowest). */
export function downgradeOptions(from: QueuePriority): QueuePriority[] {
  return (["normal", "low"] as QueuePriority[]).filter((p) => isDowngrade(from, p));
}

interface WaitingRow {
  position: number;
  priority?: string | null;
}

/**
 * Place in the waiting line for a new ticket at a stage.
 *
 * - Urgent: immediately before the first waiting non-urgent ticket, so it
 *   goes ahead of every non-urgent ticket and behind urgent tickets that
 *   were already ahead of them. With no non-urgent tickets it joins the end.
 * - Normal and low: the end of the line (unchanged behaviour).
 *
 * Positions at or after the returned one must be shifted back by one
 * (see positionsToShift).
 */
export function insertionPosition(
  waiting: WaitingRow[],
  priority: QueuePriority,
): number {
  const sorted = [...waiting].sort((a, b) => a.position - b.position);
  if (priority === "urgent") {
    const firstNonUrgent = sorted.findIndex(
      (w) => normalisePriority(w.priority) !== "urgent",
    );
    if (firstNonUrgent !== -1) return firstNonUrgent + 1;
  }
  return sorted.length + 1;
}

/**
 * Final order of a stage's waiting line after inserting `newId` at
 * `position` (1-based). Existing rows keep their relative order.
 */
export function orderAfterInsert<T extends { id: string; position: number }>(
  waiting: T[],
  newId: string,
  position: number,
): string[] {
  const ids = [...waiting]
    .sort((a, b) => a.position - b.position)
    .map((w) => w.id)
    .filter((id) => id !== newId);
  const at = Math.max(0, Math.min(ids.length, position - 1));
  ids.splice(at, 0, newId);
  return ids;
}

/**
 * The clinical permission that also lets a role move tickets at a stage.
 * Moving patients is operational: "register" (queue staff) covers every
 * stage; a role may also move tickets at its own clinical stage (e.g. a
 * pharmacist finishing a visit at pharmacy), as the Queue Maestro screen
 * already allowed.
 */
const STAGE_PERMISSION = {
  registration: "register",
  vitals: "vitals",
  consult: "consult",
  pharmacy: "dispense",
} as const;

export function mayMoveQueue(
  role: string | null | undefined,
  stage: QueueStageName,
): boolean {
  if (!role) return false;
  const r = role as Role;
  return can(r, "register") || can(r, STAGE_PERMISSION[stage]);
}

/** Only an authorised clinician may lower triage priority. */
export function mayDowngradePriority(role: string | null | undefined): boolean {
  return !!role && can(role as Role, "consult");
}

/** Trimmed reason, or "" when it is blank. */
export function normaliseReason(reason: string | null | undefined): string {
  return (reason ?? "").trim();
}

export const MAX_REASON_LENGTH = 500;
