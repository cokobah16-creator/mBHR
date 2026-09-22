// Confirmation shown after registering a patient: who, and their ticket.
import { db } from "@/db";
import { useToast } from "@/stores/toast";

export async function announceRegistration(
  patientId: string,
  opts?: { existing?: boolean },
): Promise<void> {
  const push = useToast.getState().push;
  try {
    const [patient, queued] = await Promise.all([
      db.patients.get(patientId),
      db.queue
        .where("patientId")
        .equals(patientId)
        .and((q) => q.status !== "done")
        .first(),
    ]);
    const name = patient ? `${patient.givenName} ${patient.familyName}` : "Patient";
    push({
      id: crypto.randomUUID(),
      tone: queued || opts?.existing ? "success" : "warning",
      title: opts?.existing ? `Opened existing record for ${name}` : `${name} registered`,
      body: queued
        ? `${queued.ticketNumber ? `Ticket ${queued.ticketNumber} · ` : ""}in the queue.`
        : opts?.existing
          ? "No new record was created. Start a visit from their record."
          : "Not in the queue yet — start a visit from their record.",
    });
  } catch {
    push({ id: crypto.randomUUID(), tone: "success", title: "Patient registered" });
  }
}
