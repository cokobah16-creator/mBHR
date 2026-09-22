// Today's visit for a patient: the record every stage of care is filed
// under. Patients can reach a stage without one (registration only queues
// them), so stages that record care call this instead of creating visits
// ad hoc, which produced duplicate visits.
import { db, generateId, type Visit } from "@/db";
import { getActiveSiteName } from "@/services/activeSite";

function isToday(d: Date | string) {
  return new Date(d).toDateString() === new Date().toDateString();
}

export async function findTodaysOpenVisit(patientId: string): Promise<Visit | undefined> {
  const visits = await db.visits.where("patientId").equals(patientId).toArray();
  return visits
    .filter((v) => v.status === "open" && isToday(v.startedAt))
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0];
}

export async function ensureTodaysVisit(patientId: string): Promise<Visit> {
  const existing = await findTodaysOpenVisit(patientId);
  if (existing) return existing;
  const visit: Visit = {
    id: generateId(),
    patientId,
    startedAt: new Date(),
    siteName: await getActiveSiteName(),
    status: "open",
    _dirty: 1,
  };
  await db.visits.add(visit);
  return visit;
}
