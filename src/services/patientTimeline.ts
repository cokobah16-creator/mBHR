// Aggregates a single chronological feed for a patient — registration,
// vitals, consultations, prescriptions/dispenses, referrals, messages,
// and upcoming appointments — sorted newest first.
import { db, Vital, Consultation, Dispense, Visit } from "@/db";

export type TimelineEventKind =
  | "registration"
  | "visit_start"
  | "visit_close"
  | "vitals"
  | "consultation"
  | "referral"
  | "dispense"
  | "message"
  | "appointment";

export interface BaseTimelineEvent<K extends TimelineEventKind, T> {
  id: string;
  kind: K;
  at: Date;
  title: string;
  detail?: string;
  data: T;
}

export type TimelineEvent =
  | BaseTimelineEvent<"registration", { patientId: string }>
  | BaseTimelineEvent<"visit_start", Visit>
  | BaseTimelineEvent<"visit_close", Visit>
  | BaseTimelineEvent<"vitals", Vital>
  | BaseTimelineEvent<"consultation", Consultation>
  | BaseTimelineEvent<"referral", Consultation>
  | BaseTimelineEvent<"dispense", Dispense>
  | BaseTimelineEvent<
      "message",
      { senderType: string; body: string; createdAt: Date }
    >
  | BaseTimelineEvent<
      "appointment",
      { scheduledAt: Date; status: string; reason?: string }
    >;

function vitalsSummary(v: Vital): string {
  const parts: string[] = [];
  if (v.systolic && v.diastolic) parts.push(`BP ${v.systolic}/${v.diastolic}`);
  if (v.pulseBpm) parts.push(`HR ${v.pulseBpm}`);
  if (v.tempC) parts.push(`Temp ${v.tempC}°C`);
  if (v.spo2) parts.push(`SpO₂ ${v.spo2}%`);
  if (v.bmi) parts.push(`BMI ${v.bmi}`);
  if (v.flags?.length) parts.push(`flags: ${v.flags.join(", ")}`);
  return parts.join(" • ");
}

function consultationSummary(c: Consultation): string {
  const dx = (c.provisionalDx ?? []).filter(Boolean);
  if (dx.length > 0) return dx.join(", ");
  return c.soapAssessment?.slice(0, 120) || "Consultation completed";
}

export async function getPatientTimeline(
  patientId: string,
): Promise<TimelineEvent[]> {
  const [patient, visits, vitals, consultations, dispenses] = await Promise.all(
    [
      db.patients.get(patientId),
      db.visits.where("patientId").equals(patientId).toArray(),
      db.vitals.where("patientId").equals(patientId).toArray(),
      db.consultations.where("patientId").equals(patientId).toArray(),
      db.dispenses.where("patientId").equals(patientId).toArray(),
    ],
  );

  // Optional sources — wrapped in try/catch so a missing table or sparse
  // data never blocks the timeline build.
  const portalMessages = await db.portalMessages
    .where("patientId")
    .equals(patientId)
    .toArray()
    .catch(() => []);
  const appointments = await db.appointments
    .where("patientId")
    .equals(patientId)
    .toArray()
    .catch(() => []);

  const events: TimelineEvent[] = [];

  if (patient) {
    events.push({
      id: `reg-${patient.id}`,
      kind: "registration",
      at: new Date(patient.createdAt),
      title: "Patient registered",
      detail: `${patient.givenName} ${patient.familyName} added to local registry`,
      data: { patientId: patient.id },
    });
  }

  for (const v of visits) {
    events.push({
      id: `visit-start-${v.id}`,
      kind: "visit_start",
      at: new Date(v.startedAt),
      title: "Visit started",
      detail: v.siteName,
      data: v,
    });
    if (v.status === "closed") {
      events.push({
        id: `visit-close-${v.id}`,
        kind: "visit_close",
        // Visit doesn't carry a closedAt; approximate with most recent
        // dispense within the visit, falling back to startedAt.
        at: lastDispenseAtForVisit(v.id, dispenses) ?? new Date(v.startedAt),
        title: "Visit completed",
        detail: v.siteName,
        data: v,
      });
    }
  }

  for (const v of vitals) {
    events.push({
      id: `vitals-${v.id}`,
      kind: "vitals",
      at: new Date(v.takenAt),
      title: "Vitals recorded",
      detail: vitalsSummary(v),
      data: v,
    });
  }

  for (const c of consultations) {
    events.push({
      id: `consult-${c.id}`,
      kind: "consultation",
      at: new Date(c.createdAt),
      title: `Consultation by ${c.providerName || "Provider"}`,
      detail: consultationSummary(c),
      data: c,
    });
    if (c.referred === true) {
      events.push({
        id: `referral-${c.id}`,
        kind: "referral",
        at: new Date(c.createdAt),
        title: "Referral issued",
        detail: c.referralNotes || "Patient referred for further care",
        data: c,
      });
    }
  }

  for (const d of dispenses) {
    events.push({
      id: `dispense-${d.id}`,
      kind: "dispense",
      at: new Date(d.dispensedAt),
      title: `Dispensed ${d.itemName}`,
      detail: [d.dosage, d.qty ? `qty ${d.qty}` : "", d.directions]
        .filter(Boolean)
        .join(" • "),
      data: d,
    });
  }

  for (const m of portalMessages) {
    const body = typeof m.messageBody === "string" ? m.messageBody : "";
    events.push({
      id: `msg-${m.id}`,
      kind: "message",
      at: new Date(m.createdAt),
      title:
        m.senderType === "staff"
          ? "Message sent to patient"
          : "Message from patient",
      detail: body.slice(0, 160),
      data: {
        senderType: m.senderType,
        body,
        createdAt: new Date(m.createdAt),
      },
    });
  }

  for (const a of appointments) {
    events.push({
      id: `appt-${a.id}`,
      kind: "appointment",
      at: new Date(a.scheduledAt),
      title: a.status === "scheduled" ? "Appointment scheduled" : "Appointment",
      detail: a.reason ? a.reason : undefined,
      data: {
        scheduledAt: new Date(a.scheduledAt),
        status: a.status,
        reason: a.reason,
      },
    });
  }

  events.sort((a, b) => b.at.getTime() - a.at.getTime());
  return events;
}

function lastDispenseAtForVisit(
  visitId: string,
  dispenses: Dispense[],
): Date | null {
  const matching = dispenses
    .filter((d) => d.visitId === visitId)
    .map((d) => new Date(d.dispensedAt).getTime())
    .filter((t) => !Number.isNaN(t));
  if (matching.length === 0) return null;
  return new Date(Math.max(...matching));
}
