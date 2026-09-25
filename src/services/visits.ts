// Today's visit for a patient: the record every stage of care is filed
// under. Patients can reach a stage without one (registration only queues
// them), so stages that record care call this instead of creating visits
// ad hoc, which produced duplicate visits.
import { db, generateId, type Visit } from "@/db";
import { getActiveSiteName } from "@/services/activeSite";

function isToday(d: Date | string) {
  return new Date(d).toDateString() === new Date().toDateString();
}

/**
 * The latest open visit started today. `skipVisitIds` are visits not to
 * continue (for example one whose care is already complete).
 */
export async function findTodaysOpenVisit(
  patientId: string,
  skipVisitIds: readonly string[] = [],
): Promise<Visit | undefined> {
  const visits = await db.visits.where("patientId").equals(patientId).toArray();
  return visits
    .filter(
      (v) => v.status === "open" && isToday(v.startedAt) && !skipVisitIds.includes(v.id),
    )
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0];
}

export async function ensureTodaysVisit(
  patientId: string,
  skipVisitIds: readonly string[] = [],
): Promise<Visit> {
  const existing = await findTodaysOpenVisit(patientId, skipVisitIds);
  if (existing) return existing;
  const siteName = await getActiveSiteName();
  // Look again and add in one write transaction: a double tap, or two
  // screens at once, then continue the same visit instead of opening two.
  return db.transaction("rw", db.visits, async () => {
    const started = await findTodaysOpenVisit(patientId, skipVisitIds);
    if (started) return started;
    const visit: Visit = {
      id: generateId(),
      patientId,
      startedAt: new Date(),
      siteName,
      status: "open",
      _dirty: 1,
    };
    await db.visits.add(visit);
    return visit;
  });
}
