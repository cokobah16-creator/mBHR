// Pure helpers for the staff ticket screens (QueueBoard, TicketIssuer).
import { can, type Role } from "@/auth/roles";
import {
  FLOW_STAGES,
  FLOW_STAGE_LABELS,
  type FlowStage,
} from "@/services/patientFlow";

/**
 * roles.ts has no dedicated queue permission. Issuing, calling and finishing
 * tickets is front-desk logistics, so it is gated by the same permission as
 * registering patients (volunteer, nurse, doctor, lead clinician, admin).
 */
export const QUEUE_PERMISSION = "register" as const;

export function canManageQueue(role: Role | null | undefined): boolean {
  return !!role && can(role, QUEUE_PERMISSION);
}

export function isFlowStage(value: string): value is FlowStage {
  return (FLOW_STAGES as string[]).includes(value);
}

/** The stage after `stage`, or null after pharmacy (end of the visit). */
export function nextStageOf(stage: FlowStage): FlowStage | null {
  const i = FLOW_STAGES.indexOf(stage);
  return i >= 0 && i < FLOW_STAGES.length - 1 ? FLOW_STAGES[i + 1] : null;
}

export function minutesSince(
  d: Date | string | number | undefined | null,
  now: number,
): number {
  if (d === undefined || d === null) return 0;
  const t = new Date(d).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((now - t) / 60_000));
}

export function formatWait(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Ticket label for staff screens; falls back to the queue position. */
export function ticketLabel(item: {
  ticketNumber?: string;
  position: number;
}): string {
  const t = item.ticketNumber?.trim();
  return t ? t : `#${String(item.position).padStart(3, "0")}`;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

interface StageRow {
  stage: string;
  status: string;
  position: number;
  updatedAt: Date | string;
  queuedAt?: Date | string;
}

export interface StageCounts {
  waiting: number;
  inService: number;
  doneToday: number;
}

export function countByStage(
  items: StageRow[],
  now: number,
): Record<FlowStage, StageCounts> {
  const today = new Date(now);
  const out = Object.fromEntries(
    FLOW_STAGES.map((s) => [s, { waiting: 0, inService: 0, doneToday: 0 }]),
  ) as Record<FlowStage, StageCounts>;
  for (const i of items) {
    if (!isFlowStage(i.stage)) continue;
    const c = out[i.stage];
    if (i.status === "waiting") c.waiting += 1;
    else if (i.status === "in_progress") c.inService += 1;
    else if (i.status === "done" && sameDay(new Date(i.updatedAt), today)) {
      c.doneToday += 1;
    }
  }
  return out;
}

/** Waiting (by queue position) and in-service (earliest called first) rows for one stage. */
export function splitStage<T extends StageRow>(
  items: T[],
  stage: FlowStage,
): { waiting: T[]; inService: T[] } {
  const atStage = items.filter((i) => i.stage === stage);
  const waiting = atStage
    .filter((i) => i.status === "waiting")
    .sort((a, b) => a.position - b.position);
  const inService = atStage
    .filter((i) => i.status === "in_progress")
    .sort(
      (a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime(),
    );
  return { waiting, inService };
}

export function longestWaitMinutes(
  waiting: { queuedAt?: Date | string; updatedAt: Date | string }[],
  now: number,
): number {
  return waiting.reduce(
    (max, i) => Math.max(max, minutesSince(i.queuedAt ?? i.updatedAt, now)),
    0,
  );
}

export type TicketPriority = "urgent" | "normal" | "low";

export function isTicketPriority(value: string): value is TicketPriority {
  return value === "urgent" || value === "normal" || value === "low";
}

/**
 * Staff-facing message for a failed ticket. queueManagement throws plain
 * Errors whose text can include record ids, so the raw message is never
 * shown; known cases get a specific next step.
 */
export function issueErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : "";
  const already = /already in queue at (\w+)/i.exec(msg);
  if (already) {
    const stage = isFlowStage(already[1])
      ? FLOW_STAGE_LABELS[already[1]].toLowerCase()
      : "another";
    return `This patient already has a ticket in the ${stage} queue. Find it on the queue board instead of issuing a new one.`;
  }
  if (/not found/i.test(msg)) {
    return "This patient's record was not found on this device. Search again, or register the patient first.";
  }
  // addToQueue can fail after the row is written (while re-ordering the
  // queue), so do not claim nothing was saved. The issuer's live
  // "already in the queue" check shows the ticket if it exists.
  return "The ticket may not have been saved. If the patient now shows as already in the queue, it was. Otherwise, try again.";
}

/**
 * Honest save note for toasts: the write is on this device; with cloud sync
 * enabled it is queued for upload, not yet uploaded.
 */
export function savedNote(syncEnabled: boolean): string {
  return syncEnabled
    ? "Saved on this device. Waiting to sync."
    : "Saved on this device.";
}
