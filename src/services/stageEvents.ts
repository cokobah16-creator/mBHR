// Helper for recording clinical handoff events into mbhrDb.stage_events.
// Form submits (vitals, consult, dispense) and explicit queue transitions
// call this so the Outreach Summary report's volunteer-attendance section,
// and the future patient timeline, have a unified activity feed.
import { mbhrDb, ulid } from "@/db/mbhr";
import { useAuthStore } from "@/stores/auth";

export type StageName =
  | "registration"
  | "vitals"
  | "consult"
  | "pharmacy"
  | string;

export interface StageEventInput {
  stage: StageName;
  kind: "start" | "finish";
  ticketId?: string;
  visitId?: string;
  patientId?: string;
  actorId?: string;
}

function currentActorId(): string | undefined {
  try {
    return useAuthStore.getState().currentUser?.id ?? undefined;
  } catch {
    return undefined;
  }
}

export async function recordStageEvent(input: StageEventInput): Promise<void> {
  const now = new Date().toISOString();
  const actorId = input.actorId ?? currentActorId();
  try {
    await mbhrDb.stage_events.add({
      id: ulid(),
      ticketId: input.ticketId,
      visitId: input.visitId,
      patientId: input.patientId,
      stage: input.stage,
      actorId,
      startedAt: input.kind === "start" ? now : undefined,
      finishedAt: input.kind === "finish" ? now : undefined,
    });
  } catch (err) {
    // Stage events are best-effort signal — never fail the parent flow.
    console.warn("Failed to record stage event:", err);
  }
}
