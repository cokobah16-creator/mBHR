// Derives the user-facing patient status badge from the existing queue,
// visit, and consultation rows. Avoids new schema enums by computing the
// label from a combination of stage + status + visit + consultation data.
import { db } from "@/db";

export type PatientStatusKind =
  | "registered"
  | "vitals_pending"
  | "vitals_in_progress"
  | "awaiting_doctor"
  | "with_doctor"
  | "prescription_ready"
  | "at_pharmacy"
  | "medicine_collected"
  | "completed"
  | "referred";

export interface PatientStatus {
  kind: PatientStatusKind;
  label: string;
  /** Tailwind class fragment for badge background + text colour. */
  classes: string;
  /** Optional one-line context, e.g. "since 10:42". */
  detail?: string;
}

const STATUS_META: Record<
  PatientStatusKind,
  { label: string; classes: string }
> = {
  registered: {
    label: "Registered",
    classes: "bg-stage-registration-soft text-stage-registration border-stage-registration-line",
  },
  vitals_pending: {
    label: "Vitals Pending",
    classes: "bg-stage-vitals-soft text-stage-vitals border-stage-vitals-line",
  },
  vitals_in_progress: {
    label: "Vitals In Progress",
    classes: "bg-stage-vitals-soft text-stage-vitals border-stage-vitals font-semibold",
  },
  awaiting_doctor: {
    label: "Awaiting Doctor",
    classes: "bg-stage-consult-soft text-stage-consult border-stage-consult-line",
  },
  with_doctor: {
    label: "With Doctor",
    classes: "bg-stage-consult-soft text-stage-consult border-stage-consult font-semibold",
  },
  prescription_ready: {
    label: "Prescription Ready",
    classes: "bg-stage-pharmacy-soft text-stage-pharmacy border-stage-pharmacy-line",
  },
  at_pharmacy: {
    label: "At Pharmacy",
    classes: "bg-stage-pharmacy-soft text-stage-pharmacy border-stage-pharmacy font-semibold",
  },
  medicine_collected: {
    label: "Medicine Collected",
    classes: "bg-success-soft text-success-fg border-success-line",
  },
  completed: {
    label: "Completed",
    classes: "bg-surface-sunken text-ink-secondary border-line",
  },
  referred: {
    label: "Referred",
    classes: "bg-warning-soft text-warning-fg border-warning-line",
  },
};

export function buildStatus(
  kind: PatientStatusKind,
  detail?: string,
): PatientStatus {
  const meta = STATUS_META[kind];
  return { kind, label: meta.label, classes: meta.classes, detail };
}

/**
 * Resolve the badge label for a queue item given its stage + status alone.
 * Used by the queue board renderers — they have the queue item in scope but
 * may not want to issue extra Dexie queries per row.
 */
export function patientStatusFromQueue(item: {
  stage: "registration" | "vitals" | "consult" | "pharmacy" | string;
  status: "waiting" | "in_progress" | "done" | string;
}): PatientStatus {
  const { stage, status } = item;
  if (stage === "registration") {
    return buildStatus("registered");
  }
  if (stage === "vitals") {
    return buildStatus(
      status === "in_progress" ? "vitals_in_progress" : "vitals_pending",
    );
  }
  if (stage === "consult") {
    return buildStatus(
      status === "in_progress" ? "with_doctor" : "awaiting_doctor",
    );
  }
  if (stage === "pharmacy") {
    if (status === "done") return buildStatus("medicine_collected");
    if (status === "in_progress") return buildStatus("at_pharmacy");
    return buildStatus("prescription_ready");
  }
  return buildStatus("registered");
}

/**
 * Resolve the patient-level status by checking, in order: an explicit
 * referral on their most recent consultation, the latest active queue
 * item, then visit closure. Used on the patient detail page.
 */
export async function getPatientStatus(
  patientId: string,
): Promise<PatientStatus> {
  // Most recent consultation; if it explicitly marks a referral, that
  // outcome supersedes whatever stage the queue might still hold.
  const consultations = await db.consultations
    .where("patientId")
    .equals(patientId)
    .toArray();
  consultations.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const latestConsult = consultations[0];
  if (latestConsult?.referred === true) {
    return buildStatus("referred");
  }

  // Active queue item — closest to the patient's "right now" position.
  const queueItems = await db.queue
    .where("patientId")
    .equals(patientId)
    .and((q) => q.status !== "done")
    .toArray();
  if (queueItems.length > 0) {
    queueItems.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    return patientStatusFromQueue(queueItems[0]);
  }

  // No active queue: did the most recent visit close? Then completed.
  const visits = await db.visits.where("patientId").equals(patientId).toArray();
  visits.sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
  );
  const latestVisit = visits[0];
  if (latestVisit?.status === "closed") {
    return buildStatus("completed");
  }

  // Was previously in a queue and finished pharmacy without a new visit?
  const allQueue = await db.queue
    .where("patientId")
    .equals(patientId)
    .toArray();
  const finishedPharmacy = allQueue
    .filter((q) => q.stage === "pharmacy" && q.status === "done")
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )[0];
  if (finishedPharmacy) {
    return buildStatus("medicine_collected");
  }

  return buildStatus("registered");
}
