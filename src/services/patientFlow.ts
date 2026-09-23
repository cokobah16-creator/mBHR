// Derives where a patient is in the outreach flow for a single visit:
// registration → vitals → consultation → pharmacy.
//
// Everything here is computed from records the app already stores (visit,
// vitals, consultations, dispenses, queue rows), so the stepper can never
// claim a stage is complete unless the underlying clinical record exists.
import type { Consultation, Dispense, QueueItem, Visit, Vital } from "@/db";

export type FlowStage = "registration" | "vitals" | "consult" | "pharmacy";

export const FLOW_STAGES: FlowStage[] = [
  "registration",
  "vitals",
  "consult",
  "pharmacy",
];

export const FLOW_STAGE_LABELS: Record<FlowStage, string> = {
  registration: "Registration",
  vitals: "Vitals",
  consult: "Consultation",
  pharmacy: "Pharmacy",
};

export type FlowStepState = "done" | "current" | "waiting" | "upcoming";

export interface FlowStep {
  stage: FlowStage;
  label: string;
  state: FlowStepState;
  /** When the stage was completed (or entered, for the current step). */
  at?: Date;
}

export interface PatientFlowInput {
  visit?: Pick<Visit, "id" | "startedAt" | "status"> | null;
  vitals?: Pick<Vital, "visitId" | "takenAt">[];
  consultations?: Pick<Consultation, "visitId" | "createdAt">[];
  dispenses?: Pick<Dispense, "visitId" | "dispensedAt">[];
  /** Active queue row for this patient, if any. */
  queueItem?: Pick<QueueItem, "stage" | "status" | "updatedAt"> | null;
}

function earliest<T>(rows: T[], pick: (r: T) => Date | string | undefined) {
  let best: Date | undefined;
  for (const r of rows) {
    const raw = pick(r);
    if (!raw) continue;
    const d = raw instanceof Date ? raw : new Date(raw);
    if (Number.isNaN(d.getTime())) continue;
    if (!best || d < best) best = d;
  }
  return best;
}

export function derivePatientFlow(input: PatientFlowInput): FlowStep[] {
  const { visit, queueItem } = input;
  const visitId = visit?.id;
  const forVisit = <T extends { visitId: string }>(rows?: T[]) =>
    visitId ? (rows ?? []).filter((r) => r.visitId === visitId) : [];

  const completedAt: Record<FlowStage, Date | undefined> = {
    registration: visit?.startedAt ? new Date(visit.startedAt) : undefined,
    vitals: earliest(forVisit(input.vitals), (v) => v.takenAt),
    consult: earliest(forVisit(input.consultations), (c) => c.createdAt),
    pharmacy: earliest(forVisit(input.dispenses), (d) => d.dispensedAt),
  };

  // The queue can say pharmacy is done even when nothing was dispensed
  // (e.g. no prescription). Respect that so the flow can finish.
  if (
    !completedAt.pharmacy &&
    queueItem?.stage === "pharmacy" &&
    queueItem.status === "done"
  ) {
    completedAt.pharmacy = new Date(queueItem.updatedAt);
  }

  const visitClosed = visit?.status === "closed";
  let currentAssigned = false;

  return FLOW_STAGES.map((stage) => {
    const at = completedAt[stage];
    if (at) {
      return { stage, label: FLOW_STAGE_LABELS[stage], state: "done", at };
    }
    if (!visit || visitClosed || currentAssigned) {
      return { stage, label: FLOW_STAGE_LABELS[stage], state: "upcoming" };
    }
    currentAssigned = true;
    const inService =
      queueItem?.stage === stage && queueItem.status === "in_progress";
    return {
      stage,
      label: FLOW_STAGE_LABELS[stage],
      state: inService ? "current" : "waiting",
      at: queueItem?.stage === stage ? new Date(queueItem.updatedAt) : undefined,
    };
  });
}

/** The stage a patient is currently at, or null when the visit is finished. */
export function currentFlowStage(steps: FlowStep[]): FlowStage | null {
  const step = steps.find((s) => s.state === "current" || s.state === "waiting");
  return step ? step.stage : null;
}
